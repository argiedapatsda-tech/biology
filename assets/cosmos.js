// Background: neurons and galaxies. Real rat neurons (NeuroMorpho.org) glow along the edges with
// signals travelling down their branches; real Hubble galaxies turn slowly; a Webb nebula (recoloured
// violet) drifts; stars twinkle. Same API the pages already use: BioBG.start({ level }), BioBG.setLevel(0..1).
// Assets: assets/cosmos/ (made by _holo/gen_cosmos.py; credits in the page footers).
window.BioBG = (function () {
  const base = (document.querySelector('script[src*="cosmos.js"]').getAttribute('src') || '').replace(/cosmos\.js.*$/, '') + 'cosmos/';
  const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ipad = /iPad|iPhone|Android/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  let cv, g, W = 0, H = 0, dpr = 1, level = 1, calm = false, running = false, last = 0, t0 = 0;
  let layer = null, neurons = [], paths = [], pulses = [], gal = {}, neb = null, twinkle = [];
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  const img = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = base + src; });
  const dec = (s, T) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new T(u.buffer); };

  // where things sit (fractions of the screen) — like the reference: neurons on both sides, galaxies in the corners
  const NPOS = [
    { x: 0.04, y: 0.58, s: 0.62, r: -0.35 }, { x: 0.97, y: 0.30, s: 0.56, r: 2.75 },
    { x: 0.88, y: 0.88, s: 0.42, r: 0.7 }, { x: 0.12, y: 0.10, s: 0.36, r: 1.3 }
  ];
  const GPOS = [
    { k: 'm51', x: 0.13, y: 0.86, s: 0.30, spin: 0.012 }, { k: 'm101', x: 0.92, y: 0.10, s: 0.24, spin: -0.009 },
    { k: 'm74', x: 0.84, y: 0.66, s: 0.17, spin: 0.015 }, { k: 'ngc1300', x: 0.06, y: 0.30, s: 0.12, spin: -0.02 }
  ];

  function build() {
    W = innerWidth; H = innerHeight; dpr = Math.min(devicePixelRatio || 1, ipad ? 1.25 : 1.5);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const m = Math.min(W, H) * 1.0;
    // static layer: deep space colour, stars, the neurons themselves (drawn once with their glow)
    layer = document.createElement('canvas'); layer.width = cv.width; layer.height = cv.height;
    const x = layer.getContext('2d'); x.scale(dpr, dpr);
    const bg = x.createRadialGradient(W * .5, H * .45, 0, W * .5, H * .45, Math.max(W, H) * .8);
    bg.addColorStop(0, '#08131c'); bg.addColorStop(.55, '#050c13'); bg.addColorStop(1, '#02050a');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    for (let i = 0; i < Math.round(W * H / 4200); i++) {
      const a = Math.random() ** 3; x.fillStyle = `rgba(${200 + Math.random() * 55 | 0},${220 + Math.random() * 35 | 0},255,${.15 + a * .7})`;
      x.fillRect(Math.random() * W, Math.random() * H, a > .6 ? 1.6 : 1, a > .6 ? 1.6 : 1);
    }
    paths = [];
    neurons.forEach((n, k) => {
      const p = NPOS[k]; if (!p) return;
      const S = m * p.s, cx = p.x * W, cy = p.y * H, c = Math.cos(p.r), s = Math.sin(p.r);
      const X = new Float32Array(n.n), Y = new Float32Array(n.n);
      for (let i = 0; i < n.n; i++) { const u = n.xy[i * 2] / 30000 * S, v = n.xy[i * 2 + 1] / 30000 * S; X[i] = cx + u * c - v * s; Y[i] = cy + u * s + v * c; }
      n.X = X; n.Y = Y;
      x.lineCap = 'round';
      for (const pass of [0, 1]) {
        x.save();
        if (pass === 0) { x.shadowColor = 'rgba(70,235,215,.9)'; x.shadowBlur = 10; x.strokeStyle = 'rgba(60,210,200,.30)'; }
        else { x.strokeStyle = 'rgba(150,255,240,.55)'; }
        for (let i = 0; i < n.n; i++) {
          const q = n.p[i]; if (q < 0) continue;
          x.lineWidth = Math.max(.5, Math.min(3, n.r[i] / 1000 * S * (pass ? .6 : 1.3)));
          x.beginPath(); x.moveTo(X[q], Y[q]); x.lineTo(X[i], Y[i]); x.stroke();
        }
        x.restore();
      }
      // cell body
      const sx = X[0], sy = Y[0], gr = x.createRadialGradient(sx, sy, 0, sx, sy, 16);
      gr.addColorStop(0, 'rgba(230,255,250,.95)'); gr.addColorStop(.3, 'rgba(90,240,220,.6)'); gr.addColorStop(1, 'rgba(90,240,220,0)');
      x.fillStyle = gr; x.beginPath(); x.arc(sx, sy, 16, 0, 6.283); x.fill();
      // signal paths: from tips back to the cell body (dendrites carry signals in)
      const kids = new Uint16Array(n.n); for (let i = 0; i < n.n; i++) if (n.p[i] >= 0) kids[n.p[i]]++;
      const tips = []; for (let i = 0; i < n.n; i++) if (!kids[i]) tips.push(i);
      for (let j = 0; j < 14; j++) {
        let i = tips[(Math.random() * tips.length) | 0]; const pts = [];
        while (i >= 0 && pts.length < 2000) { pts.push([X[i], Y[i]]); i = n.p[i]; }
        if (pts.length > 8) paths.push(pts);
      }
    });
    pulses = Array.from({ length: Math.min(28, paths.length) }, (_, i) => ({ path: i, t: Math.random() }));
    twinkle = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H, p: Math.random() * 6.28, s: .6 + Math.random() * 1.4 }));
  }

  function along(path, t) {
    const f = t * (path.length - 1), i = Math.floor(f), k = f - i, a = path[i], b = path[Math.min(path.length - 1, i + 1)];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const cap = calm ? 1000 / 12 : 1000 / 30;
    if (now - last < cap) return;
    const dt = Math.min(.1, (now - (last || now)) / 1000); last = now;
    const T = (now - t0) / 1000;
    mouse.sx += (mouse.x - mouse.sx) * .05; mouse.sy += (mouse.y - mouse.sy) * .05;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.drawImage(layer, mouse.sx * -6 * dpr, mouse.sy * -6 * dpr, cv.width + 12 * dpr, cv.height + 12 * dpr);
    g.scale(dpr, dpr);
    const m = Math.min(W, H);
    g.globalCompositeOperation = 'screen';
    // nebula drifting, two pieces
    if (neb) {
      g.globalAlpha = .55 * level;
      const sw = W * 1.15, sh = sw * neb.height / neb.width, dx = Math.sin(T * .02) * 30;
      g.drawImage(neb, -W * .25 + dx, H - sh * .62, sw, sh);
      g.save(); g.translate(W * 1.2 - dx, sh * .45); g.scale(-1, -1); g.globalAlpha = .4 * level; g.drawImage(neb, 0, 0, sw * .9, sh * .9); g.restore();
    }
    // galaxies turning
    for (const p of GPOS) {
      const im = gal[p.k]; if (!im) continue;
      const S = m * p.s * 1.6;
      g.save(); g.globalAlpha = .9 * level;
      g.translate(p.x * W + mouse.sx * -14, p.y * H + mouse.sy * -14); g.rotate(T * p.spin); g.scale(1, .72);
      g.drawImage(im, -S / 2, -S / 2, S, S); g.restore();
    }
    // twinkling stars
    g.globalCompositeOperation = 'lighter';
    for (const s of twinkle) { const a = (.5 + .5 * Math.sin(T * s.s + s.p)) * .8 * level; g.fillStyle = `rgba(200,240,255,${a})`; g.fillRect(s.x, s.y, 1.6, 1.6); }
    // signals moving along the neurons
    if (!calm) for (const q of pulses) {
      q.t += dt * .22; if (q.t > 1) { q.t = 0; q.path = (Math.random() * paths.length) | 0; }
      const path = paths[q.path]; if (!path) continue;
      for (let k = 0; k < 6; k++) {
        const tt = Math.max(0, q.t - k * .012), [px, py] = along(path, tt), r = 7 - k;
        const gr = g.createRadialGradient(px, py, 0, px, py, r * 2.2);
        gr.addColorStop(0, `rgba(220,255,250,${(.9 - k * .13) * level})`); gr.addColorStop(.35, `rgba(90,245,220,${(.45 - k * .06) * level})`); gr.addColorStop(1, 'rgba(90,245,220,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(px, py, r * 2.2, 0, 6.283); g.fill();
      }
    }
    // keep the middle calm and dark so text reads well
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    const v = g.createRadialGradient(W / 2, H * .5, Math.min(W, H) * .15, W / 2, H * .5, Math.max(W, H) * .65);
    v.addColorStop(0, `rgba(3,8,14,${calm ? .85 : .12})`); v.addColorStop(1, `rgba(3,8,14,${calm ? .55 : 0})`);
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  }

  async function start(opts) {
    if (cv) return setLevel(opts && opts.level);
    cv = document.createElement('canvas'); cv.className = 'cosmos'; cv.setAttribute('aria-hidden', 'true');
    document.body.prepend(cv);
    g = cv.getContext('2d');
    setLevel(opts && opts.level != null ? opts.level : 1);
    try { neurons = (await (await fetch(base + 'neurons.json')).json()).map(n => ({ n: n.n, xy: dec(n.xy, Int16Array), p: dec(n.p, Int32Array), r: dec(n.r, Uint8Array) })); } catch (e) { neurons = []; }
    const ims = await Promise.all(GPOS.map(p => img('g_' + p.k + '.jpg')));
    GPOS.forEach((p, i) => { gal[p.k] = ims[i]; });
    neb = await img('nebula.jpg');
    build();
    addEventListener('resize', () => { clearTimeout(start._r); start._r = setTimeout(build, 200); });
    addEventListener('pointermove', e => { mouse.x = e.clientX / innerWidth * 2 - 1; mouse.y = e.clientY / innerHeight * 2 - 1; }, { passive: true });
    t0 = performance.now(); running = true;
    if (still) { calm = true; frame(performance.now()); running = false; return; }
    requestAnimationFrame(frame);
  }
  function setLevel(l) {
    l = l == null ? 1 : Number(l);
    calm = l < 0.6; level = calm ? 0.55 : 1;
    document.body.classList.toggle('bg-calm', calm);
  }
  return { start, setLevel };
})();
