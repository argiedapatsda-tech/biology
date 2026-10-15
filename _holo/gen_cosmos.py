"""Assets for the 'neurons and galaxies' background + glowing biology icons.
  galaxies   Hubble M51, M101, M74, NGC 1300 (Wikimedia Commons, see credits)  -> assets/cosmos/g_*.jpg (edges faded to black)
  nebula     Webb 'Cosmic Cliffs' recoloured violet/teal                       -> assets/cosmos/nebula.jpg
  neurons    4 real rat neurons (NeuroMorpho.org) flattened to 2D              -> assets/cosmos/neurons.json
  icons      glowing renders of the real DNA / virus / cell / neuron / hemoglobin data -> assets/cosmos/i_*.png
Run: python _holo/gen_cosmos.py"""
import os, json, base64, numpy as np
from PIL import Image, ImageFilter, ImageDraw
H = os.path.dirname(os.path.abspath(__file__)); R = os.path.dirname(H)
OUT = os.path.join(R, 'assets', 'cosmos'); os.makedirs(OUT, exist_ok=True)
SP = os.path.join(H, 'space'); REF = os.path.join(H, 'ref')

# ---------------------------------------------------------------- galaxies: square, centred, faded edges
for k in ['m51', 'm101', 'm74', 'ngc1300']:
    im = Image.open(os.path.join(SP, k + '.jpg')).convert('RGB')
    s = min(im.size); l, t = (im.width - s) // 2, (im.height - s) // 2
    if k == 'm51': l = max(0, int(im.width * 0.08))
    im = im.crop((l, t, l + s, t + s)).resize((512, 512), Image.LANCZOS)
    a = np.asarray(im).astype(float)
    y, x = np.mgrid[0:512, 0:512]; r = np.hypot(x - 256, y - 256) / 256
    fade = np.clip(1.15 - r * 1.05, 0, 1) ** 1.6
    a = a * fade[..., None]
    a = np.clip((a - 6) * 1.12, 0, 255)          # deepen the black so 'screen' blending leaves no box
    Image.fromarray(a.astype('uint8')).save(os.path.join(OUT, f'g_{k}.jpg'), quality=82)

# ---------------------------------------------------------------- nebula: Webb gas, recoloured violet / teal, soft
im = Image.open(os.path.join(SP, 'carina.jpg')).convert('RGB').resize((1600, 900), Image.LANCZOS)
a = np.asarray(im).astype(float) / 255
lum = (a[..., 0] * 0.6 + a[..., 1] * 0.3 + a[..., 2] * 0.1)
warm = np.clip(a[..., 0] - a[..., 2] * 0.6, 0, 1)                   # the glowing gas (orange in the original)
violet = np.array([0.55, 0.22, 0.85]); teal = np.array([0.1, 0.55, 0.6])
col = warm[..., None] * violet * 1.4 + (lum - warm).clip(0)[..., None] * teal * 0.6
col = np.clip(col, 0, 1) ** 1.3
yy, xx = np.mgrid[0:900, 0:1600]
edge = np.clip(np.minimum.reduce([xx / 380, (1599 - xx) / 380, yy / 260, (899 - yy) / 260]), 0, 1) ** 1.8   # soft wisps, no hard border
col = col * edge[..., None]
neb = Image.fromarray((col * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(3))
neb.save(os.path.join(OUT, 'nebula.jpg'), quality=80)

# ---------------------------------------------------------------- neurons: real reconstructions, flattened to 2D
neurons = []
for name, src in [('CSp0114-1', 'Kawaguchi'), ('CSp0302-1', 'Kawaguchi'), ('Fig2c_Rat_78', 'Tamas'), ('5-27-11cell1-nonFS-BC', 'Santhakumar')]:
    S = np.array([[float(x) for x in l.split()[:7]] for l in open(os.path.join(REF, name + '.swc')) if l.strip() and not l.startswith('#')])
    ids = {int(r[0]): i for i, r in enumerate(S)}
    par = np.array([ids.get(int(r[6]), -1) for r in S])
    nchild = np.bincount(par[par >= 0], minlength=len(S))
    depth = np.zeros(len(S), int)
    for i in range(len(S)): depth[i] = depth[par[i]] + 1 if par[i] >= 0 else 0
    keep = (nchild != 1) | (par < 0) | (depth % 3 == 0)
    newi = -np.ones(len(S), int); newi[keep] = np.arange(keep.sum())
    def kp(i):
        p = par[i]
        while p >= 0 and not keep[p]: p = par[p]
        return p
    xy = S[keep][:, [2, 3]].copy(); xy[:, 1] *= -1            # screen y goes down
    soma = S[(S[:, 1] == 1)][:, [2, 3]].mean(0) * [1, -1] if (S[:, 1] == 1).any() else xy[0]
    xy -= soma; k = 1 / np.abs(xy).max(); xy *= k
    P = [int(newi[kp(i)]) if kp(i) >= 0 else -1 for i in np.where(keep)[0]]
    rad = np.clip(S[keep][:, 5] * k * 1000, 1, 255)
    typ = S[keep][:, 1].astype(int)
    neurons.append(dict(name=name, src=src, n=int(keep.sum()),
                        xy=base64.b64encode(np.round(xy * 30000).astype('<i2').tobytes()).decode(),
                        p=base64.b64encode(np.array(P, '<i4').tobytes()).decode(),
                        r=base64.b64encode(rad.astype('u1').tobytes()).decode(),
                        t=base64.b64encode(typ.astype('u1').tobytes()).decode()))
    print(name, keep.sum(), 'points')
json.dump(neurons, open(os.path.join(OUT, 'neurons.json'), 'w'))

# ---------------------------------------------------------------- glowing icons from the real specimens
spec = json.loads(open(os.path.join(H, 'specimens.js'), encoding='utf-8').read().split('export const SPECIMENS = ', 1)[1].rstrip().rstrip(';'))
def dec(s, t): return np.frombuffer(base64.b64decode(s), dtype=t)
def render(key, S=288, rot=(0.35, 0.6), cols=None, size_k=1.0, lines=True, keep=None, gain=1.0, cat_override=None):
    sp = next(x for x in spec if x['key'] == key)
    P = dec(sp['pos'], '<i2').reshape(-1, 3) / 3000.0; cat = dec(sp['cat'], 'u1').copy(); sz = dec(sp['size'], 'u1') * 0.004
    if cat_override is not None: cat = cat_override(P, cat)
    if keep:
        sel = np.zeros(len(P), bool); sel[np.random.default_rng(3).choice(len(P), min(keep, len(P)), replace=False)] = True
    else: sel = np.ones(len(P), bool)
    L = dec(sp['lines'], '<u2').reshape(-1, 2)
    ax, ay = rot
    Rx = np.array([[1, 0, 0], [0, np.cos(ax), -np.sin(ax)], [0, np.sin(ax), np.cos(ax)]]); Ry = np.array([[np.cos(ay), 0, np.sin(ay)], [0, 1, 0], [-np.sin(ay), 0, np.cos(ay)]])
    Q = P @ (Ry @ Rx).T
    ext = np.abs(Q[:, :2]).max(); sc = S * 0.42 / ext
    X = S / 2 + Q[:, 0] * sc; Y = S / 2 - Q[:, 1] * sc
    order = [i for i in np.argsort(Q[:, 2]) if sel[i]]
    pal = cols or sp['pal']
    acc = np.zeros((S, S, 3))
    layer = Image.new('RGB', (S, S)); d = ImageDraw.Draw(layer)
    if lines and len(L):
        for a, b in L:
            if not (sel[a] and sel[b]): continue
            c = tuple(int(v * 140) for v in pal[cat[a]][:3]); d.line([(X[a], Y[a]), (X[b], Y[b])], fill=c, width=1)
    acc += np.asarray(layer, float)
    dots = Image.new('RGB', (S, S)); dd = ImageDraw.Draw(dots)
    for i in order:
        r = max(0.8, sz[i] * sc * 0.5 * size_k); c = pal[cat[i]]
        depth = 0.55 + 0.45 * (Q[i, 2] - Q[:, 2].min()) / (np.ptp(Q[:, 2]) + 1e-9)
        dd.ellipse([X[i] - r, Y[i] - r, X[i] + r, Y[i] + r], outline=tuple(int(v * 255 * depth) for v in c[:3]))
    acc += np.asarray(dots, float)
    sharp = Image.fromarray(np.clip(acc, 0, 255).astype('uint8'))
    glow = sharp.filter(ImageFilter.GaussianBlur(6))
    out = np.clip((np.asarray(sharp, float) + np.asarray(glow, float) * 1.6) * gain, 0, 255)
    alpha = np.clip(out.max(-1) * 1.4, 0, 255)
    img = Image.fromarray(np.dstack([out, alpha]).astype('uint8'), 'RGBA')
    img.save(os.path.join(OUT, f'i_{key}.png'))
TEAL, MAG, VIO, ICE = [0.25, 0.95, 0.85], [0.95, 0.35, 0.85], [0.6, 0.4, 1.0], [0.7, 1.0, 0.95]
render('dna', rot=(0.15, 0.9), cols=[TEAL, ICE, MAG], size_k=0.9)
render('virus', rot=(0.4, 0.4), cols=[MAG, VIO, [0.9, 0.55, 1.0], TEAL], size_k=0.5, lines=False, keep=2600, gain=0.75)
render('neuron', rot=(0.0, 0.0), cols=[MAG, TEAL, ICE], size_k=0.6)
render('protein', rot=(0.3, 0.8), cols=[TEAL, VIO, MAG, [1, 0.6, 0.9]], size_k=0.6)
# the cell: membrane teal, nucleus magenta (points near the nucleus centre)
def cell_cats(P, cat):
    c = P[np.argsort(np.linalg.norm(P - np.median(P, 0), axis=1))[:1]][0]
    big = np.bincount(cat).argmax()
    nuc = np.linalg.norm(P - P[cat == np.bincount(cat)[1:].argmax() + 1].mean(0), axis=1) < 1.3
    out = np.where(nuc, 0, 1); out[cat == big] = 2
    return out.astype('u1')
render('cell', rot=(0.5, 0.3), cols=[MAG, TEAL, [0.55, 0.95, 0.9]], size_k=0.9, lines=False, keep=3800, gain=0.9, cat_override=cell_cats)
print('icons done')
