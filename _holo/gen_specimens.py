"""All hologram specimens from real data -> _holo/specimens.js (compact base64 arrays).
  DNA        PDB 1BNA (via gen_dna.py's dna_data.js)          atoms
  Hemoglobin PDB 2HHB (Fermi & Perutz)                         heavy atoms + 4 hemes, CA trace per chain
  Virus      PDB 1A34 satellite tobacco mosaic virus           60 copies of the coat protein (BIOMT), CA traces
  Neuron     NeuroMorpho.org CSp0114-1 (Kawaguchi archive)     rat motor cortex layer 5b pyramidal cell
  Cell       HoloCell model (sample_cell.py)                   organelle surfaces and particles
Each point: position, colour group, size. Lines: index pairs into the points.
Run: python _holo/gen_specimens.py"""
import json, base64, os, re, numpy as np
H = os.path.dirname(os.path.abspath(__file__)); REF = os.path.join(H, 'ref')
rng = np.random.default_rng(7)
NMAX = 9000

def b64(a): return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()

def finish(key, name, th, note, src, pos, cat, size, lines, pal, fit, shape):
    """pos (n,3) in any unit, y up. fit = target size of the longest axis (scene units)."""
    pos = np.asarray(pos, float); pos -= (pos.max(0) + pos.min(0)) / 2
    k = fit / np.ptp(pos, 0).max(); pos *= k
    q = np.round(pos * 3000).astype('<i2')
    sz = np.clip(np.round(np.asarray(size) * k / 0.004), 1, 255).astype('u1')
    L = np.asarray(lines, dtype='<u2').reshape(-1, 2) if len(lines) else np.zeros((0, 2), '<u2')
    print(f'{key:7s} {len(pos):5d} points {len(L):5d} lines  extent {np.ptp(pos,0).round(2)}  scale {k:.4f}/unit')
    return dict(key=key, name=name, th=th, note=note, src=src, n=len(pos), shape=shape, pal=pal,
                pos=b64(q), cat=b64(np.asarray(cat, 'u1')), size=b64(sz), lines=b64(L))

def pdb_atoms(path, het=True):
    out = []
    for l in open(path):
        rec = l[:6]
        if rec not in ('ATOM  ', 'HETATM') or (rec == 'HETATM' and not het): continue
        out.append(dict(rec=rec.strip(), name=l[12:16].strip(), res=l[17:20].strip(), ch=l[21], num=int(l[22:26]),
                        xyz=np.array([float(l[30:38]), float(l[38:46]), float(l[46:54])]), el=(l[76:78].strip() or l[12:14].strip()[0])))
    return out

specs = []
# ---------------------------------------------------------------- DNA
d = json.loads(open(os.path.join(H, 'dna_data.js'), encoding='utf-8').read().split('export const DNA = ', 1)[1].rstrip().rstrip(';'))
P = np.array(d['pos'], float).reshape(-1, 3) / 10            # Å
pos = P[:, [0, 2, 1]]                                         # helix axis -> y
cat = [2 if e == 3 else r for e, r in zip(d['el'], d['role'])]
R = {0: 1.7, 1: 1.55, 2: 1.52, 3: 1.8}
size = [R[e] * 1.0 for e in d['el']]
lines = []
for st in (0, 1):
    idx = [i for i in range(d['n']) if d['el'][i] == 3 and d['strand'][i] == st]
    idx.sort(key=lambda i: pos[i, 1])
    lines += [x for a, b in zip(idx, idx[1:]) for x in (a, b)]
specs.append(finish('dna', 'DNA double helix', 'ดีเอ็นเอ เกลียวคู่', 'The molecule that stores genes. 10.5 base pairs per turn.',
                    'PDB 1BNA · Drew & Dickerson 1981', pos, cat, size, lines,
                    [[0.2, 0.72, 1.0], [0.62, 0.93, 1.0], [1.0, 0.74, 0.32]], 8.2, 'tall'))

# ---------------------------------------------------------------- hemoglobin
A = [a for a in pdb_atoms(os.path.join(REF, '2hhb.pdb')) if a['res'] not in ('HOH', 'PO4') and a['el'] != 'H']
pos = np.array([a['xyz'] for a in A]); pos = pos[:, [0, 2, 1]]
cat, size = [], []
for a in A:
    if a['res'] == 'HEM': c = 3 if a['el'] == 'FE' or a['name'] == 'FE' else 2
    else: c = 0 if a['ch'] in 'AC' else 1
    cat.append(c); size.append(1.7 if c < 2 else 1.9)
lines = []
for ch in 'ABCD':
    ca = [i for i, a in enumerate(A) if a['ch'] == ch and a['name'] == 'CA' and a['rec'] == 'ATOM']
    lines += [x for a, b in zip(ca, ca[1:]) for x in (a, b)]
specs.append(finish('protein', 'Hemoglobin', 'ฮีโมโกลบิน', 'Carries oxygen in red blood cells: 4 protein chains, each holding an iron heme.',
                    'PDB 2HHB · Fermi et al. 1984', pos, cat, size, lines,
                    [[0.25, 0.75, 1.0], [0.55, 0.95, 0.95], [1.0, 0.72, 0.3], [1.0, 0.45, 0.35]], 6.2, 'round'))

# ---------------------------------------------------------------- virus capsid (60 copies)
txt = open(os.path.join(REF, '1a34.pdb')).read().splitlines()
mats = {}
for l in txt:
    m = re.match(r'REMARK 350\s+BIOMT(\d)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)', l)
    if m:
        r, i = int(m.group(1)), int(m.group(2))
        mats.setdefault(i, np.zeros((3, 4)))[r - 1] = [float(m.group(k)) for k in range(3, 7)]
A = pdb_atoms(os.path.join(REF, '1a34.pdb'), het=False)
prot = [a for a in A if a['ch'] == 'A' and a['name'] == 'CA']
rna = [a for a in A if a['ch'] != 'A' and a['name'] == 'P']
pts, cat, size, lines = [], [], [], []
for i, M in sorted(mats.items()):
    base = len(pts)
    for a in prot:
        pts.append(M[:, :3] @ a['xyz'] + M[:, 3]); cat.append(i % 3); size.append(3.4)
    lines += [x for j in range(len(prot) - 1) for x in (base + j, base + j + 1)]
    for a in rna:
        pts.append(M[:, :3] @ a['xyz'] + M[:, 3]); cat.append(3); size.append(3.0)
pos = np.array(pts)
specs.append(finish('virus', 'Virus shell', 'เปลือกไวรัส', 'A tiny plant virus: 60 copies of one protein lock together into a 17 nm ball around its RNA.',
                    'PDB 1A34 · satellite tobacco mosaic virus', pos, cat, size, lines,
                    [[0.25, 0.72, 1.0], [0.45, 0.88, 1.0], [0.7, 0.96, 1.0], [1.0, 0.72, 0.32]], 6.4, 'round'))

# ---------------------------------------------------------------- neuron
S = np.array([[float(x) for x in l.split()] for l in open(os.path.join(REF, 'CSp0114-1.swc')) if l.strip() and not l.startswith('#')])
ids = {int(r[0]): i for i, r in enumerate(S)}
par = np.array([ids.get(int(r[6]), -1) for r in S])
keep = np.zeros(len(S), bool)
depth = np.zeros(len(S), int)
for i in range(len(S)):
    depth[i] = depth[par[i]] + 1 if par[i] >= 0 else 0
nchild = np.bincount(par[par >= 0], minlength=len(S))
keep |= (nchild != 1) | (par < 0) | (depth % 2 == 0) | (S[:, 1] == 1)
newi = -np.ones(len(S), int); newi[keep] = np.arange(keep.sum())
def kept_parent(i):
    p = par[i]
    while p >= 0 and not keep[p]: p = par[p]
    return p
pos = S[keep][:, 2:5].copy(); typ = S[keep][:, 1]
cat = [0 if t == 1 else 2 if t == 4 else 1 for t in typ]
size = [max(1.6, r * 2) for r in S[keep][:, 5]]
lines = []
for i in np.where(keep)[0]:
    p = kept_parent(i)
    if p >= 0: lines += [newi[p], newi[i]]
# soma as a shell of points
soma = S[S[:, 1] == 1]; sc = soma[:, 2:5].mean(0); sr = soma[:, 5].max()
v = rng.normal(size=(140, 3)); v /= np.linalg.norm(v, axis=1)[:, None]
pos = np.vstack([pos, sc + v * sr * np.array([1, 1.3, 1])]); cat += [0] * 140; size += [3.0] * 140
specs.append(finish('neuron', 'Neuron', 'เซลล์ประสาท', 'A real pyramidal neuron from the motor cortex: branching dendrites collect signals for the cell body.',
                    'NeuroMorpho.org · CSp0114-1 (Kawaguchi)', pos, cat, size, lines,
                    [[1.0, 0.75, 0.35], [0.3, 0.78, 1.0], [0.62, 0.94, 1.0]], 8.4, 'tall'))

# ---------------------------------------------------------------- cell
C = np.array(json.load(open(os.path.join(REF, 'cell_points.json'))))
rgb = C[:, 3:6]
key = np.round(rgb * 6).astype(int); groups = {}
for i, k in enumerate(map(tuple, key)): groups.setdefault(k, []).append(i)
order = sorted(groups.items(), key=lambda kv: -len(kv[1]))
pal_src, sel, cat = [], [], []
budget = NMAX
total = sum(min(len(v), 2200) for k, v in order)
for gi, (k, v) in enumerate(order[:10]):
    take = min(len(v), 2200, int(budget * min(len(v), 2200) / total) + 30)
    pick = rng.choice(v, size=min(take, len(v)), replace=False)
    sel += list(pick); cat += [gi] * len(pick)
    c = rgb[v].mean(0)
    pal_src.append(c)
pal = []
for c in pal_src:   # hologram tint: keep the organelle's hue, lift it toward cyan light
    c = np.clip(0.55 * c / max(c.max(), 1e-3) + 0.45 * np.array([0.45, 0.85, 1.0]), 0, 1)
    pal.append([round(float(x), 3) for x in c])
pos = C[sel, :3]
size = [0.28] * len(sel)
specs.append(finish('cell', 'Animal cell', 'เซลล์สัตว์', 'Inside a cell: nucleus with pores, ER, Golgi, mitochondria, ribosomes and vesicles.',
                    'HoloCell model · organelles to scale', pos, cat, size, [], pal, 7.4, 'round'))

with open(os.path.join(H, 'specimens.js'), 'w', encoding='utf-8') as f:
    f.write('// generated by gen_specimens.py from real structures - do not edit\nexport const SPECIMENS = ' + json.dumps(specs, ensure_ascii=False) + ';\n')
print('specimens.js', os.path.getsize(os.path.join(H, 'specimens.js')) // 1024, 'KB')
