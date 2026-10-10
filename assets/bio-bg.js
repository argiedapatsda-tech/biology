// Living background: cultured cells as seen in a fluorescence microscope, drifting at
// three depths, plus a slowly turning B-DNA helix and small glowing vesicles.
// Reference: NIH endothelial cells (Wikimedia "FluorescentCells.jpg"):
//   nucleus = DAPI blue, one per cell, oval, off-centre
//   microtubules = green, radiate from beside the nucleus (centrosome) to the edge
//   actin = red, bright cortex along the ruffled edge + long straight stress fibres
//   cells are flat and spread, with lamellipodia and thin filopodia; colours add (red+green = yellow)
window.BioBG = (function () {
  const TAU = Math.PI * 2;
  let cv, g, W = 0, H = 0, dpr = 1, items = [], vesicles = [], helices = [], running = false, last = 0, opts = { level: 1 };
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------------------------------------------------------------- one cell sprite
  function makeCell(size, res) {
    const S = Math.round(size * res), c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d'), k = S / 400;               // draw in a 400-unit box
    x.scale(k, k);
    const cx = 200, cy = 200, R = rnd(72, 86), elong = rnd(1.15, 1.5), rot = rnd(0, TAU);
    const ph = [rnd(0, TAU), rnd(0, TAU), rnd(0, TAU), rnd(0, TAU), rnd(0, TAU)];
    // spread outline: low harmonics for the overall shape, high ones for the ruffled edge
    const rad = t => R * (1 + .22 * Math.sin(2 * t + ph[0]) + .14 * Math.sin(3 * t + ph[1]) + .07 * Math.sin(5 * t + ph[2]) + .035 * Math.sin(11 * t + ph[3]) + .02 * Math.sin(23 * t + ph[4]));
    const pt = (t, s) => { const r = rad(t) * (s || 1), ex = Math.cos(t) * r * elong, ey = Math.sin(t) * r / elong;
      return [cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)]; };
    const outline = new Path2D();
    for (let i = 0; i <= 180; i++) { const p = pt(i / 180 * TAU); i ? outline.lineTo(p[0], p[1]) : outline.moveTo(p[0], p[1]); }
    outline.closePath();
    x.globalCompositeOperation = 'lighter';
    x.lineCap = 'round';

    // nucleus sits off-centre; the centrosome (microtubule origin) sits just beside it
    const na = rnd(0, TAU), nd = rnd(10, 35);
    const nx = cx + Math.cos(na) * nd, ny = cy + Math.sin(na) * nd;
    const cxm = nx + Math.cos(na + Math.PI) * 26, cym = ny + Math.sin(na + Math.PI) * 26;

    x.save(); x.clip(outline);
    // faint cytoplasm haze
    const haze = x.createRadialGradient(cxm, cym, 10, cx, cy, R * 1.5);
    haze.addColorStop(0, 'rgba(70,170,60,.42)'); haze.addColorStop(1, 'rgba(60,110,30,.14)');
    x.fillStyle = haze; x.fillRect(0, 0, 400, 400);
    // stress fibres: long, nearly parallel red bundles along the cell's long axis
    const fa = rot + rnd(-.25, .25);
    for (let i = 0; i < 70; i++) {
      const off = rnd(-R * 1.2, R * 1.2), len = rnd(R * 1.2, R * 3), a = fa + rnd(-.07, .07);
      const mx = cx - Math.sin(fa) * off, my = cy + Math.cos(fa) * off;
      x.strokeStyle = `rgba(255,${rnd(30, 70) | 0},40,${rnd(.14, .34).toFixed(2)})`; x.lineWidth = rnd(.4, 1.2);
      x.beginPath(); x.moveTo(mx - Math.cos(a) * len / 2, my - Math.sin(a) * len / 2); x.lineTo(mx + Math.cos(a) * len / 2, my + Math.sin(a) * len / 2); x.stroke();
    }
    // microtubules: curving green filaments from the centrosome out to the edge
    for (let i = 0; i < 260; i++) {
      let a = rnd(0, TAU), px = cxm + rnd(-6, 6), py = cym + rnd(-6, 6), bend = rnd(-.03, .03);
      x.strokeStyle = `rgba(80,255,${rnd(60, 120) | 0},${rnd(.08, .24).toFixed(2)})`; x.lineWidth = rnd(.4, 1);
      x.beginPath(); x.moveTo(px, py);
      for (let s = 0; s < 70; s++) { bend += rnd(-.01, .01); a += bend + rnd(-.09, .09); px += Math.cos(a) * 4; py += Math.sin(a) * 4; x.lineTo(px, py); }
      x.stroke();
    }
    // the centrosome glows where all the microtubules meet
    const cg = x.createRadialGradient(cxm, cym, 0, cxm, cym, 26);
    cg.addColorStop(0, 'rgba(150,255,150,.55)'); cg.addColorStop(1, 'rgba(60,200,80,0)');
    x.fillStyle = cg; x.fillRect(cxm - 30, cym - 30, 60, 60);
    x.restore();

    // actin cortex: bright red rim along the ruffled edge, with small focal spots
    // lamellipodium: a diffuse red band just inside the edge
    x.save(); x.clip(outline); x.strokeStyle = 'rgba(255,50,40,.16)'; x.lineWidth = 16; x.stroke(outline); x.restore();
    // cortex: short rim segments of varying brightness and width (ruffled, patchy, never one neon line)
    for (let i = 0; i < 90; i++) {
      const t0 = rnd(0, TAU), t1 = t0 + rnd(.04, .22), w = rnd(.6, 2.6), sc = rnd(.97, 1.01);
      x.strokeStyle = `rgba(255,${rnd(35, 90) | 0},50,${rnd(.15, .7).toFixed(2)})`; x.lineWidth = w;
      x.beginPath();
      for (let j = 0; j <= 8; j++) { const p = pt(t0 + (t1 - t0) * j / 8, sc); j ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]); }
      x.stroke();
    }
    for (let i = 0; i < 40; i++) {
      const t = rnd(0, TAU), p = pt(t, rnd(.86, .99));
      x.fillStyle = `rgba(255,${rnd(40, 110) | 0},60,${rnd(.25, .6).toFixed(2)})`;
      x.beginPath(); x.ellipse(p[0], p[1], rnd(1.5, 4), rnd(1, 2.4), t, 0, TAU); x.fill();
    }
    // filopodia: thin actin spikes past the edge
    const nf = 3 + (Math.random() * 5 | 0);
    for (let i = 0; i < nf; i++) {
      const t = rnd(0, TAU), p = pt(t), q = pt(t + rnd(-.05, .05), rnd(1.12, 1.3));
      x.strokeStyle = 'rgba(255,60,50,.55)'; x.lineWidth = rnd(.8, 1.6);
      x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.stroke();
    }

    // nucleus: one oval, DAPI blue, mottled chromatin, nucleoli slightly darker
    const nr = R * rnd(.2, .26), nAng = rnd(0, TAU);
    x.save(); x.translate(nx, ny); x.rotate(nAng);
    const ng = x.createRadialGradient(-nr * .2, -nr * .2, nr * .1, 0, 0, nr * 1.25);
    ng.addColorStop(0, 'rgba(90,140,255,.95)'); ng.addColorStop(.75, 'rgba(40,80,240,.85)'); ng.addColorStop(1, 'rgba(30,60,220,0)');
    x.fillStyle = ng; x.beginPath(); x.ellipse(0, 0, nr * 1.25, nr * .95, 0, 0, TAU); x.fill();
    x.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 70; i++) {
      const a = rnd(0, TAU), d = Math.sqrt(Math.random()) * nr;
      x.fillStyle = Math.random() < .5 ? 'rgba(150,190,255,.18)' : 'rgba(10,20,90,.22)';
      x.beginPath(); x.arc(Math.cos(a) * d * 1.15, Math.sin(a) * d * .85, rnd(1, 3), 0, TAU); x.fill();
    }
    for (let i = 0; i < 2; i++) { x.fillStyle = 'rgba(15,30,120,.45)'; x.beginPath(); x.ellipse(rnd(-nr * .4, nr * .4), rnd(-nr * .3, nr * .3), nr * .18, nr * .14, rnd(0, 3), 0, TAU); x.fill(); }
    x.restore();
    return c;
  }

  // ---------------------------------------------------------------- B-DNA, drawn live in 3-D
  // axis along local +x; strand point (y, z) = r(cos θ, sin θ), θ = 2π·x/pitch, z into the screen.
  // With canvas y down, that frame is right-handed, so the helix is right-handed like B-DNA.
  // Second strand is 144° behind → narrow minor groove on one side, wide major groove on the other.
  const BP = ['#4fe08a', '#ff5a6e', '#5a8cff', '#ffc94d'];   // A, T, G, C
  function drawHelix(h, t) {
    const pitch = 10.5, r = h.r, step = (2 * r * 1.7) / pitch, n = Math.round(h.len / step), spin = t * h.spin;
    g.save(); g.translate(h.x, h.y); g.rotate(h.ang); g.globalCompositeOperation = 'lighter';
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const th = i / pitch * TAU + spin, X = i * step - h.len / 2;
      pts.push([X, r * Math.cos(th), Math.sin(th), r * Math.cos(th - 2.513), Math.sin(th - 2.513)]);
    }
    // rungs first (behind the backbones), coloured by base pair, faded by depth
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i], z = (p[2] + p[4]) / 2, a = .18 + .32 * (1 - (z + 1) / 2);
      const pair = (h.seq[i % h.seq.length]);
      const c1 = BP[pair], c2 = BP[pair ^ 1];
      g.globalAlpha = a * h.alpha; g.lineWidth = 2.2;
      g.strokeStyle = c1; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0], (p[1] + p[3]) / 2); g.stroke();
      g.strokeStyle = c2; g.beginPath(); g.moveTo(p[0], (p[1] + p[3]) / 2); g.lineTo(p[0], p[3]); g.stroke();
    }
    // sugar-phosphate backbones: continuous ribbons, wider and brighter where nearer
    g.lineCap = 'round';
    for (const k of [1, 3]) {
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1], near = 1 - ((p[k + 1] + q[k + 1]) / 2 + 1) / 2;
        g.globalAlpha = (.2 + .8 * near) * h.alpha;
        g.strokeStyle = k === 1 ? '#8fd8ff' : '#c4b0ff';
        g.lineWidth = 2 + 4.5 * near;
        g.beginPath(); g.moveTo(p[0], p[k]); g.lineTo(q[0], q[k]); g.stroke();
      }
    }
    g.restore(); g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- scene
  function build() {
    items = []; vesicles = []; helices = [];
    const area = W * H, L = opts.level;
    const n = Math.max(5, Math.min(11, Math.round(area / 190000)));
    // depth layers: 0 far (small, soft, dim) · 1 mid · 2 near (big, soft, faint)
    const layers = [{ k: .5, res: .28, a: .45, sp: .25 }, { k: .9, res: .8, a: .7, sp: .5 }, { k: 1.7, res: .35, a: .32, sp: .9 }];
    for (let i = 0; i < n; i++) {
      const d = i < n * .45 ? 0 : i < n * .85 ? 1 : 2, Ly = layers[d];
      const size = Math.min(W, H) * rnd(.62, .9) * Ly.k + 200;
      items.push({ spr: makeCell(size, Ly.res), size, x: rnd(-.1, 1.1) * W, y: rnd(-.1, 1.1) * H, a: Ly.a * L, d,
        vx: rnd(-6, 6) * Ly.sp, vy: rnd(-4, 4) * Ly.sp, rot: rnd(0, TAU), vr: rnd(-.02, .02) * Ly.sp, ph: rnd(0, TAU) });
    }
    items.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.round(area / 9000); i++) {
      const red = Math.random() < .45;
      vesicles.push({ x: rnd(0, W), y: rnd(0, H), r: rnd(.6, 2.2), vx: rnd(-8, 8), vy: rnd(-6, 6), c: red ? '255,90,80' : Math.random() < .5 ? '90,255,140' : '120,170,255', a: rnd(.2, .7) * L, ph: rnd(0, TAU) });
    }
    const nh = W > 900 ? 2 : 1;
    for (let i = 0; i < nh; i++) {
      helices.push({ x: rnd(.15, .85) * W, y: rnd(.2, .8) * H, ang: rnd(-.7, .7), len: Math.min(W, H) * rnd(.55, .8), bp: 0, r: rnd(13, 18),
        spin: rnd(.25, .4) * (Math.random() < .5 ? 1 : 1), vx: rnd(-5, 5), vy: rnd(-3, 3), va: rnd(-.01, .01), alpha: .55 * L,
        seq: Array.from({ length: 64 }, () => (Math.random() * 4) | 0) });
    }
  }
  function resize() {
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }
  function wrap(o, m) { if (o.x < -m) o.x += W + 2 * m; if (o.x > W + m) o.x -= W + 2 * m; if (o.y < -m) o.y += H + 2 * m; if (o.y > H + m) o.y -= H + 2 * m; }
  function frame(now) {
    if (!running) return;
    const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
    const t = now / 1000;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.fillStyle = '#02060a'; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    let hi = 0;
    for (const it of items) {
      it.x += it.vx * dt; it.y += it.vy * dt; it.rot += it.vr * dt; wrap(it, it.size * .6);
      const breathe = 1 + .025 * Math.sin(t * .6 + it.ph);
      g.save(); g.translate(it.x, it.y); g.rotate(it.rot); g.scale(breathe, 1 / breathe);
      g.globalAlpha = it.a; g.drawImage(it.spr, -it.size / 2, -it.size / 2, it.size, it.size);
      g.restore();
      if (it.d === 1 && hi < helices.length) { drawHelix(helices[hi], t); hi++; }
    }
    while (hi < helices.length) drawHelix(helices[hi++], t);
    for (const h of helices) { h.x += h.vx * dt; h.y += h.vy * dt; h.ang += h.va * dt; wrap(h, h.len * .6); }
    for (const v of vesicles) {
      v.x += v.vx * dt + Math.sin(t + v.ph) * .1; v.y += v.vy * dt + Math.cos(t * .8 + v.ph) * .1; wrap(v, 10);
      g.globalAlpha = v.a * (.6 + .4 * Math.sin(t * 2 + v.ph));
      g.fillStyle = `rgb(${v.c})`; g.beginPath(); g.arc(v.x, v.y, v.r, 0, TAU); g.fill();
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    requestAnimationFrame(frame);
  }
  function start(o) {
    opts = Object.assign({ level: 1 }, o || {});
    if (!cv) {
      cv = document.createElement('canvas'); cv.className = 'biobg'; cv.setAttribute('aria-hidden', 'true');
      document.body.prepend(cv); g = cv.getContext('2d');
      window.addEventListener('resize', () => { clearTimeout(cv._rt); cv._rt = setTimeout(resize, 200); });
      document.addEventListener('visibilitychange', () => { if (document.hidden) running = false; else if (!running) { running = true; last = 0; requestAnimationFrame(frame); } });
    }
    resize();
    if (!running) { running = true; requestAnimationFrame(frame); }
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { running = false; requestAnimationFrame(t => { running = true; frame(t); running = false; }); }
  }
  // calmer while a student is answering
  function setLevel(l) { opts.level = l; const f = l; items.forEach(it => { it.a = [.45, .7, .32][it.d] * f; }); vesicles.forEach(v => { v.a = Math.min(v.a, .7) * (f / (v.lvl || 1)); v.lvl = f; }); helices.forEach(h => { h.alpha = .55 * f; }); }
  return { start, setLevel };
})();
