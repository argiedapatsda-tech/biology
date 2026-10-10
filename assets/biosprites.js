// Life-like cell sprites, baked once into small canvases with per-pixel lighting.
// Each sprite is a real 3-D surface (a height field or a cluster of spheres in a z-buffer);
// normals come from the surface, then diffuse + specular + rim light + translucency are applied,
// so cells read as wet, rounded, lit objects instead of flat drawings.
//
// Shapes (checked against SEM reference circ-sem-blood-cells.jpg):
//   red blood cell  - biconcave disc, Evans-Fung profile, no nucleus, thinner (paler) centre
//   neutrophil      - sphere with dense ruffles; 3-lobed nucleus faintly visible through it
//   B lymphocyte    - smaller sphere, fine microvilli; round nucleus fills most of the cell
//   macrophage      - largest, irregular with pseudopods; kidney-shaped nucleus, vacuoles
//   bacillus        - capsule (rounded rod); flagella drawn live by the game
//   virus           - spherical capsid with spike proteins on a 3-D sphere (rotates per frame)
//   antibody (IgG)  - Y of globular domains; O2 = two oxygen atoms (CPK red) sharing a bond
window.BioSprites = (function () {
  const L = norm([-0.5, -0.62, 0.62]), H = norm([L[0], L[1], L[2] + 1]);
  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  // ---------------------------------------------------------------- noise
  function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }
  function fbm(x, y, s, oct) { let t = 0, a = .5, f = 1; for (let i = 0; i < (oct || 4); i++) { t += a * vnoise(x * f, y * f, s + i * 17); a *= .5; f *= 2; } return t; }
  // periodic Voronoi (period p in cells) → [d1, d2, cell id]
  function voronoi(x, y, p, s, stretch) {
    const sx = stretch || 1, xi = Math.floor(x), yi = Math.floor(y);
    let d1 = 9, d2 = 9, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j, wx = ((cx % p) + p) % p, wy = ((cy % p) + p) % p;
      const px = cx + hash(wx, wy, s), py = cy + hash(wx, wy, s + 7);
      const d = Math.hypot((px - x) * sx, py - y);
      if (d < d1) { d2 = d1; d1 = d; id = wx * 131 + wy; } else if (d < d2) d2 = d;
    }
    return [d1, d2, id];
  }
  // ---------------------------------------------------------------- baking
  // fn(x, y) → null | { h (pixels), c: [r,g,b] 0-1, a (alpha 0-1), s (spec 0-1), sh (shininess), t (translucency 0-1) }
  function bake(w, h, fn, opt) {
    opt = opt || {};
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'), img = g.createImageData(w, h), D = img.data;
    const hf = new Float32Array(w * h), cell = new Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const r = fn(x + .5, y + .5); cell[y * w + x] = r; hf[y * w + x] = r ? r.h : -1; }
    const amb = opt.amb == null ? .34 : opt.amb, rim = opt.rim || [.5, .7, 1], rimK = opt.rimK == null ? .35 : opt.rimK;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, r = cell[i]; if (!r) continue;
      const hl = x > 0 && cell[i - 1] ? hf[i - 1] : r.h - 1.5, hr = x < w - 1 && cell[i + 1] ? hf[i + 1] : r.h - 1.5;
      const hu = y > 0 && cell[i - w] ? hf[i - w] : r.h - 1.5, hd = y < h - 1 && cell[i + w] ? hf[i + w] : r.h - 1.5;
      const n = norm([(hl - hr) * .5, (hu - hd) * .5, 1]);
      const dif = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
      const spe = Math.pow(Math.max(0, n[0] * H[0] + n[1] * H[1] + n[2] * H[2]), r.sh || 40) * (r.s == null ? .5 : r.s);
      const fr = Math.pow(1 - n[2], 2) * rimK;
      const back = (r.t || 0) * (1 - dif) * .35;          // light scattering through thin, translucent parts
      for (let k = 0; k < 3; k++) {
        const v = r.c[k] * (amb + dif * .9 + back) + spe + fr * rim[k] * r.c[k] * 1.4;
        D[i * 4 + k] = Math.max(0, Math.min(255, v * 255));
      }
      D[i * 4 + 3] = Math.max(0, Math.min(255, (r.a == null ? 1 : r.a) * 255));
    }
    g.putImageData(img, 0, 0);
    return cv;
  }
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // spheres in 3-D, z-buffered; each: {x,y,z,r,c,s,sh,t} in pixel units
  function spheres(w, h, list, opt) {
    return bake(w, h, (x, y) => {
      let best = null, bz = -1e9;
      for (const s of list) {
        const dx = x - s.x, dy = y - s.y, d2 = dx * dx + dy * dy; if (d2 > s.r * s.r) continue;
        let z = s.z + Math.sqrt(s.r * s.r - d2);
        if (s.bump) z += s.bump(x, y) * s.r;
        if (z > bz) { bz = z; best = { h: z, c: s.c, s: s.s, sh: s.sh, t: s.t, a: sstep(0, 1.2, s.r - Math.sqrt(d2)) }; }
      }
      return best;
    }, opt);
  }

  // ---------------------------------------------------------------- the sprites
  const SP = {};
  function rbc(size) {
    const R = size / 2 - 1;
    return bake(size, size, (x, y) => {
      const u = (x - size / 2) / R, v = (y - size / 2) / R, p = Math.hypot(u, v); if (p > 1) return null;
      const p2 = p * p, z = Math.sqrt(1 - p2) * (0.0518 + 2.0026 * p2 - 4.491 * p2 * p2);   // Evans-Fung (in radii)
      const th = Math.max(0, z) / .32;                                                        // relative thickness
      const c = mix(hex('#ff7a6a'), hex('#9c0f1a'), Math.min(1, .25 + th * .8));
      const n = fbm(u * 6, v * 6, 3, 3) * .015;
      return { h: (z + n) * R * 1.25, c, s: .55, sh: 30, t: 1 - th, a: sstep(1, .97, p) };
    }, { amb: .3, rim: [1, .5, .45], rimK: .45 });
  }
  function ruffledCell(size, opt) {   // spherical leukocyte with microvilli/ruffles, nucleus seen through it
    const R = size / 2 - 2;
    return bake(size, size, (x, y) => {
      const u = (x - size / 2) / R, v = (y - size / 2) / R, ang = Math.atan2(v, u);
      const edge = 1 + (opt.lobe || 0) * (fbm(Math.cos(ang) * 1.6 + opt.ph, Math.sin(ang) * 1.6, opt.seed, 3) - .5) * 2;
      const p = Math.hypot(u, v) / edge; if (p > 1) return null;
      let z = Math.sqrt(1 - p * p);
      const rough = fbm(u * opt.freq + 3, v * opt.freq, opt.seed + 1, 4);
      z += (rough - .5) * opt.ruff * (0.5 + 0.5 * z);
      const nuc = opt.nucleus(u, v);
      const c = mix(opt.c, opt.nc, nuc * .55 * (0.6 + 0.4 * z));
      return { h: z * R * .9, c, s: .35, sh: 22, t: .5, a: sstep(1, .96, p) };
    }, { amb: .36, rim: opt.rim || [.8, .9, 1], rimK: .5 });
  }
  function capsule(w, h, col, seed) {    // bacillus: rounded rod along x
    const r = h / 2 - 1.5, a = w / 2 - r - 1.5;
    return bake(w, h, (x, y) => {
      const px = x - w / 2, py = y - h / 2, qx = Math.max(-a, Math.min(a, px)), d = Math.hypot(px - qx, py);
      if (d > r) return null;
      const z = Math.sqrt(1 - (d / r) ** 2) + (fbm(x * .18, y * .18, seed, 3) - .5) * .12;
      const c = mix(col, [col[0] * .6, col[1] * .6, col[2] * .55], fbm(x * .06, y * .2, seed + 5, 2) * .6);
      return { h: z * r, c, s: .6, sh: 35, t: .3, a: sstep(r, r - 1.2, d) };
    }, { amb: .32, rim: [.9, 1, .7], rimK: .45 });
  }
  function fibSphere(n) { const pts = [], g = Math.PI * (3 - Math.sqrt(5)); for (let i = 0; i < n; i++) { const y = 1 - (i + .5) / n * 2, r = Math.sqrt(1 - y * y); pts.push([Math.cos(g * i) * r, y, Math.sin(g * i) * r]); } return pts; }
  function virusFrame(size, rot) {
    const R = size * .3, cx = size / 2, list = [];
    const body = { x: cx, y: cx, z: 0, r: R, c: hex('#9aa7b8'), s: .4, sh: 25, t: .2, bump: (x, y) => (fbm(x * .25, y * .25, 9, 3) - .5) * .08 };
    list.push(body);
    for (const p of fibSphere(34)) {
      const x = p[0] * Math.cos(rot) + p[2] * Math.sin(rot), z = -p[0] * Math.sin(rot) + p[2] * Math.cos(rot), y = p[1];
      for (const [k, rr] of [[1.18, .1], [1.36, .17]]) {             // stalk + club-shaped spike head
        list.push({ x: cx + x * R * k, y: cx + y * R * k, z: z * R * k, r: R * rr, c: k > 1.3 ? hex('#e8445f') : hex('#c9707f'), s: .5, sh: 30, t: .2 });
      }
    }
    return spheres(size, size, list, { amb: .32, rim: [1, .7, .8], rimK: .4 });
  }
  function antibody(size) {               // IgG: Fc stem + two Fab arms, each a chain of globular domains
    const c = size / 2, list = [], col = hex('#ffd24d'), col2 = hex('#f2a93b');
    const beads = (x0, y0, x1, y1, n, r, cc) => { for (let i = 0; i < n; i++) { const t = i / (n - 1); list.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, z: Math.sin(t * 3) * r * .4, r, c: i % 2 ? cc : col, s: .5, sh: 30 }); } };
    beads(c, c + size * .38, c, c + size * .02, 4, size * .075, col2);
    beads(c, c, c - size * .32, c - size * .34, 4, size * .07, col2);
    beads(c, c, c + size * .32, c - size * .34, 4, size * .07, col2);
    return spheres(size, size, list, { amb: .35, rimK: .3 });
  }
  function oxygen(size) {
    const r = size * .26, c = size / 2;
    return spheres(size, size, [
      { x: c - r * .78, y: c, z: 0, r, c: hex('#e8312a'), s: .8, sh: 60 },
      { x: c + r * .78, y: c, z: 0, r, c: hex('#e8312a'), s: .8, sh: 60 }], { amb: .35, rim: [1, .8, .8], rimK: .3 });
  }
  function lysosome(size) {              // membrane-bound vesicle packed with enzyme granules
    const R = size / 2 - 2;
    return bake(size, size, (x, y) => {
      const u = (x - size / 2) / R, v = (y - size / 2) / R, p = Math.hypot(u, v); if (p > 1) return null;
      const z = Math.sqrt(1 - p * p), gr = fbm(u * 5, v * 5, 21, 3);
      const c = mix(hex('#7df0a8'), hex('#1f7a45'), sstep(.45, .7, gr) * .8);
      return { h: z * R + (gr - .5) * 3, c, s: .9, sh: 80, t: .8, a: sstep(1, .95, p) };
    }, { amb: .35, rim: [.7, 1, .8], rimK: .6 });
  }
  function apoptotic(size, seed) {        // dying cell: shrunken, blebbing membrane, condensed nucleus fragments
    const c = size / 2, R = size * .3, list = [{ x: c, y: c, z: 0, r: R, c: hex('#8d7a9e'), s: .35, sh: 20, t: .2, bump: (x, y) => (fbm(x * .2, y * .2, seed, 3) - .5) * .15 }];
    for (let i = 0; i < 9; i++) { const a = hash(i, seed, 1) * Math.PI * 2, e = hash(i, seed, 2) * 1.2 - .3; list.push({ x: c + Math.cos(a) * R * .95, y: c + Math.sin(a) * R * .95, z: e * R * .5, r: R * (.22 + hash(i, seed, 3) * .18), c: hex('#a893b8'), s: .4, sh: 25 }); }
    return spheres(size, size, list, { amb: .3, rimK: .35 });
  }
  function platelet(size, seed) {
    const R = size / 2 - 1;
    return bake(size, size, (x, y) => {
      const u = (x - size / 2) / R, v = (y - size / 2) / R * 1.5, a = Math.atan2(v, u), e = .75 + fbm(Math.cos(a) * 2, Math.sin(a) * 2, seed, 3) * .4;
      const p = Math.hypot(u, v) / e; if (p > 1) return null;
      return { h: Math.sqrt(1 - p * p) * R * .4, c: hex('#f2b8c6'), s: .4, sh: 20, a: sstep(1, .9, p) };
    }, { amb: .4 });
  }

  // ---------------------------------------------------------------- tiling textures
  function tissue(size, cellPx) {          // square, tileable sheet of domed cells with nuclei (H&E colours)
    const p = Math.max(2, Math.round(size / cellPx)), w = size, h = size;
    return bake(w, h, (x, y) => {
      const [d1, d2] = voronoi(x / w * p, y / h * p, p, 4);
      const e = d2 - d1, dome = sstep(0, .35, e), nuc = sstep(.24, .12, d1);
      const c = mix(mix(hex('#c98aa6'), hex('#efc1cf'), dome * .7), hex('#6a3d8f'), nuc * .85);
      return { h: dome * cellPx * .22 + nuc * 2 + fbm(x * .1, y * .1, 2, 3) * 2, c, s: .25, sh: 18, t: .3 };
    }, { amb: .38, rimK: .1 });
  }
  function fat(w, h, cellPx) {             // lipid-laden plaque: glossy yellow globules
    const p = Math.max(2, Math.round(w / cellPx)), py = Math.max(2, Math.round(h / cellPx));
    return bake(w, h, (x, y) => {
      const [d1, , id] = voronoi(x / w * p, y / h * py, Math.max(p, py), 31);
      const z = Math.sqrt(Math.max(0, 1 - (d1 / .62) ** 2));
      const c = mix(hex('#ffe08a'), hex('#c99526'), hash(id, 3, 3) * .6 + (1 - z) * .4);
      return { h: z * cellPx * .45, c, s: .9, sh: 70, t: .5 };
    }, { amb: .32, rim: [1, .9, .6], rimK: .3 });
  }
  function endothelium(w, h) {             // vessel lining: long, flat cells in the direction of flow, wet sheen
    const p = Math.max(2, Math.round(w / 70));
    return bake(w, h, (x, y) => {
      const [d1, d2] = voronoi(x / w * p, y / h * p * (h / w) * 3.2, p, 12, .35);
      const e = d2 - d1, dome = sstep(0, .3, e);
      const c = mix(hex('#6d0f1c'), hex('#c8414f'), dome * .8);
      return { h: dome * 5 + fbm(x * .05, y * .2, 5, 3) * 3, c, s: .7, sh: 45, t: .4 };
    }, { amb: .35, rim: [1, .6, .6], rimK: .25 });
  }
  function collagen(w, h, seed) {          // hard wall: bundle of collagen fibres
    return bake(w, h, (x, y) => {
      const f = Math.sin((y + fbm(x * .03, y * .03, seed, 3) * 30) * .55);
      const z = (f * .5 + .5) * 3 + fbm(x * .02, y * .15, seed + 2, 3) * 4;
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y), round = sstep(0, 5, edge);
      return { h: z * round + round * 6, c: mix(hex('#c9b99a'), hex('#8e7f66'), fbm(x * .05, y * .05, seed + 4, 2)), s: .3, sh: 20 };
    }, { amb: .33 });
  }
  function ecm(w, h) {                     // floor: extracellular matrix with thin fibres
    return bake(w, h, (x, y) => {
      const fx = Math.abs(Math.sin((x * .7 + y * .4 + fbm(x * .05, y * .05, 41, 3) * 40) * .25));
      const fiber = sstep(.92, 1, fx), n = fbm(x * .06, y * .06, 42, 3);
      return { h: fiber * 2 + n * 2, c: mix(hex('#13262f'), hex('#3b5a66'), fiber * .7 + n * .2), s: .2, sh: 15 };
    }, { amb: .5, rimK: 0 });
  }

  let built = false;
  function build() {
    if (built) return SP; built = true;
    SP.rbc = rbc(96);
    SP.neutrophil = ruffledCell(128, { c: hex('#efe4f4'), nc: hex('#6c3f9e'), freq: 9, ruff: .55, lobe: .05, ph: 1, seed: 3,
      nucleus: (u, v) => Math.max(sstep(.3, .18, Math.hypot(u + .32, v + .1)), sstep(.3, .18, Math.hypot(u, v - .2)), sstep(.3, .18, Math.hypot(u - .32, v + .08)), sstep(.09, .05, Math.abs(v - (.2 - Math.abs(u) * .9))) * (Math.abs(u) < .34 ? 1 : 0)) });
    SP.bcell = ruffledCell(112, { c: hex('#dfeaf7'), nc: hex('#2c4f9e'), freq: 14, ruff: .3, lobe: .02, ph: 2, seed: 7, rim: [.7, .85, 1],
      nucleus: (u, v) => sstep(.78, .6, Math.hypot(u - .05, v + .03)) });
    SP.macro = [];
    for (let f = 0; f < 8; f++) {
      const ph = f / 8 * Math.PI * 2;
      SP.macro.push(ruffledCell(160, { c: hex('#e3efe4'), nc: hex('#3d6f8f'), freq: 7, ruff: .4, lobe: .38, ph: Math.sin(ph) * .5, seed: 11 + (f % 2), rim: [.8, 1, .85],
        nucleus: (u, v) => { const d = Math.hypot((u + .05) / 1.25, (v + .02) / .85); const notch = sstep(.22, .12, Math.hypot(u - .3, v + .02)); return sstep(.42, .3, d) * (1 - notch) + sstep(.16, .1, Math.hypot(u - .45, v - .4)) * -.6; } }));
    }
    SP.bact = capsule(104, 40, hex('#a9d35a'), 5);
    SP.bactTough = capsule(120, 46, hex('#e09a3c'), 8);
    SP.virus = []; for (let f = 0; f < 12; f++) SP.virus.push(virusFrame(96, f / 12 * Math.PI * 2 / 5));
    SP.antibody = antibody(64);
    SP.oxygen = oxygen(48);
    SP.lyso = lysosome(72);
    SP.debris = [apoptotic(96, 1), apoptotic(96, 2), apoptotic(96, 3)];
    SP.platelet = [platelet(28, 1), platelet(28, 2), platelet(28, 3)];
    // soft, out-of-focus copies for background depth (downscale = blur)
    SP.rbcBlur = blurCopy(SP.rbc, .22);
    return SP;
  }
  function blurCopy(src, k) {
    const s = document.createElement('canvas'); s.width = Math.max(4, src.width * k | 0); s.height = Math.max(4, src.height * k | 0);
    s.getContext('2d').drawImage(src, 0, 0, s.width, s.height); return s;
  }
  return { build, tissue, fat, endothelium, collagen, ecm, blurCopy };
})();
