// Arcade games for students who finished early. They run full-screen on the same page,
// so the teacher is still told if a finished student leaves to help someone.
//   1. Bloodstream Dash  - Flappy-style: a red blood cell squeezing past fatty plaque
//   2. Immune Defense    - tower defense: white blood cells guard a capillary
//   3. Lysosome Blast    - Bomberman-style: a macrophage clears bacteria with lysosome bombs
// All cells are lit 3-D bakes from biosprites.js (shapes checked against an SEM reference).
// Microbes are drawn far larger than real scale so the games are playable.
window.Games = (function () {
  const TAU = Math.PI * 2;
  // older iPads (iPadOS < 16) lack roundRect
  if (!CanvasRenderingContext2D.prototype.roundRect) CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2); this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
  };
  let host = null, cur = null;
  const best = k => { try { return Number(localStorage.getItem('bio-arcade-' + k)) || 0; } catch (e) { return 0; } };
  const saveBest = (k, v) => { try { if (v > best(k)) localStorage.setItem('bio-arcade-' + k, v); } catch (e) {} };
  const sfx = n => { try { EL.sfx[n](); } catch (e) {} };

  // ================================================================ sprites (lit 3-D bakes)
  let SP = null;
  const sp = () => SP || (SP = BioSprites.build());
  const S = {
    rbc(g, x, y, r, tilt, alpha) {            // tilt squashes the biconcave disc as it turns edge-on
      const P = sp(), img = alpha != null && alpha < .4 ? P.rbcBlur : P.rbc;
      g.save(); g.translate(x, y); g.rotate((tilt || 0) * .35); g.scale(1, 1 - Math.min(.55, Math.abs(tilt || 0) * .55));
      g.globalAlpha = alpha == null ? 1 : alpha; g.drawImage(img, -r, -r, r * 2, r * 2); g.restore();
    },
    platelet(g, x, y, r, a) { const P = sp(); g.save(); g.translate(x, y); g.rotate(a); g.drawImage(P.platelet[Math.abs(Math.round(a * 7)) % 3], -r, -r, r * 2, r * 2); g.restore(); },
    bacterium(g, x, y, len, ang, t, tough, hurt) {
      const P = sp(), img = tough ? P.bactTough : P.bact, w = len, h = len * img.height / img.width;
      g.save(); g.translate(x, y); g.rotate(ang);
      for (let k = 0; k < 3; k++) {                // flagella: long helical filaments trailing from one pole
        g.beginPath(); for (let i = 0; i <= 18; i++) { const u = i / 18; g.lineTo(-w * .45 - u * w * 1.1, (k - 1) * h * .18 + Math.sin(u * 10 - t * 14 + k * 2) * h * .3 * u); }
        g.strokeStyle = 'rgba(40,60,20,.6)'; g.lineWidth = Math.max(1.2, h * .09); g.stroke();
        g.strokeStyle = 'rgba(220,255,170,.45)'; g.lineWidth = Math.max(.6, h * .04); g.stroke();
      }
      g.drawImage(img, -w / 2, -h / 2, w, h);
      if (hurt) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = .6; g.drawImage(img, -w / 2, -h / 2, w, h); }
      g.restore();
    },
    virus(g, x, y, r, t, hurt) {
      const P = sp(), img = P.virus[Math.floor(t * 8) % P.virus.length], s = r / .3;
      g.drawImage(img, x - s / 2, y - s / 2, s, s);
      if (hurt) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = .6; g.drawImage(img, x - s / 2, y - s / 2, s, s); g.restore(); }
    },
    neutrophil(g, x, y, r, t) { const P = sp(); g.save(); g.translate(x, y); g.rotate(Math.sin(t * .7) * .15); g.drawImage(P.neutrophil, -r * 1.05, -r * 1.05, r * 2.1, r * 2.1); g.restore(); },
    bcell(g, x, y, r, t) { const P = sp(); g.save(); g.translate(x, y); g.rotate(Math.sin(t * .6) * .12); g.drawImage(P.bcell, -r * 1.05, -r * 1.05, r * 2.1, r * 2.1); g.restore(); },
    macrophage(g, x, y, r, t, eating) {
      const P = sp(), img = P.macro[Math.floor(t * 3) % P.macro.length];
      g.save(); g.translate(x, y);
      if (eating) { g.rotate(eating); g.scale(1.15, .92); g.rotate(-eating); }   // reaches toward what it engulfs
      g.drawImage(img, -r * 1.2, -r * 1.2, r * 2.4, r * 2.4); g.restore();
    },
    antibody(g, x, y, ang, s) { const P = sp(); g.save(); g.translate(x, y); g.rotate(ang + Math.PI / 2); g.drawImage(P.antibody, -s * 2, -s * 2, s * 4, s * 4); g.restore(); },
    oxygen(g, x, y, r, t) { const P = sp(); g.save(); g.translate(x, y); g.rotate(t); g.drawImage(P.oxygen, -r * 1.6, -r * 1.6, r * 3.2, r * 3.2); g.restore(); }
  };

  // ================================================================ shell: full-screen arcade
  function open(title, build) {
    close();
    const el = document.createElement('div');
    el.className = 'arcade';
    el.innerHTML = `<div class="arc-top"><button class="btn sm" data-a="exit">← Exit</button><b>${title}</b><span class="arc-score" id="arcScore"></span></div>
      <div class="arc-stage"><canvas class="arc-cv"></canvas><div class="arc-msg hidden" id="arcMsg"></div></div><div class="arc-pad" id="arcPad"></div>`;
    document.body.appendChild(el);
    document.body.classList.add('arcade-on');
    const cv = el.querySelector('canvas'), g = cv.getContext('2d');
    const st = { el, cv, g, W: 0, H: 0, raf: 0, last: 0, alive: true, keys: {} };
    st.score = t => { el.querySelector('#arcScore').textContent = t; };
    st.msg = (h, onTap) => { const m = el.querySelector('#arcMsg'); if (!h) { m.classList.add('hidden'); m.onclick = null; return; } m.innerHTML = h; m.classList.remove('hidden'); m.onclick = onTap || null; };
    st.resize = () => {
      const stage = el.querySelector('.arc-stage'), dpr = Math.min(2, devicePixelRatio || 1);
      st.W = stage.clientWidth; st.H = stage.clientHeight;
      cv.width = Math.round(st.W * dpr); cv.height = Math.round(st.H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      st.onResize && st.onResize();
    };
    const kd = e => { st.keys[e.key] = true; st.onKey && st.onKey(e.key, e); if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault(); };
    const ku = e => { st.keys[e.key] = false; };
    addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('resize', st.resize);
    st.cleanup = () => { removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('resize', st.resize); };
    el.querySelector('[data-a=exit]').onclick = () => { close(); menu(); };
    cur = st; window.__arcade = st;   // handle for automated play-tests
    // baking the lit sprites takes a moment on an iPad: show a message first, then build
    st.msg('<b>Loading cells…</b>');
    setTimeout(() => {
      if (!st.alive) return;
      sp(); st.msg(null);
      build(st);
      st.resize();
      const loop = now => { if (!st.alive) return; const dt = Math.min(.04, (now - (st.last || now)) / 1000); st.last = now; st.frame(dt, now / 1000); st.raf = requestAnimationFrame(loop); };
      st.raf = requestAnimationFrame(loop);
    }, 30);
  }
  function close() {
    if (!cur) return;
    cur.alive = false; cancelAnimationFrame(cur.raf); cur.cleanup(); cur.el.remove(); cur = null;
    document.body.classList.remove('arcade-on');
  }

  // ================================================================ menu
  function menu() {
    if (!host) return;
    host.innerHTML = `<div class="game-menu">
      <button class="game-tile" data-play="dash"><canvas class="gt-art" data-art="dash"></canvas><b>Bloodstream Dash</b><span>Tap to swim a red blood cell past fatty plaque. Grab oxygen.</span><em>Best ${best('dash')}</em></button>
      <button class="game-tile" data-play="td"><canvas class="gt-art" data-art="td"></canvas><b>Immune Defense</b><span>Place white blood cells to stop germs reaching the heart.</span><em>Best wave ${best('td')}</em></button>
      <button class="game-tile" data-play="bomb"><canvas class="gt-art" data-art="bomb"></canvas><b>Lysosome Blast</b><span>Drop lysosome bombs as a macrophage. Wipe out every bacterium.</span><em>Best ${best('bomb')}</em></button>
    </div>`;
    host.querySelectorAll('[data-play]').forEach(b => b.onclick = () => ({ dash, td, bomb })[b.dataset.play]());
    setTimeout(paintArt, 60);   // the menu shows at once; the lit art follows
  }
  function paintArt() {
    if (!host) return;
    host.querySelectorAll('.gt-art').forEach(c => {
      const w = c.clientWidth || 200, h = c.clientHeight || 90, d = Math.min(2, devicePixelRatio || 1);
      c.width = w * d; c.height = h * d; const g = c.getContext('2d'); g.scale(d, d);
      if (c.dataset.art === 'dash') {
        const bg = g.createRadialGradient(w / 2, h / 2, 5, w / 2, h / 2, w * .7); bg.addColorStop(0, '#5e0d18'); bg.addColorStop(1, '#16030a'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 5; i++) S.rbc(g, (i * 53) % w, (i * 37) % h, 16, i, .3);
        const fat = BioSprites.fat(64, 128, 16); g.drawImage(fat, w * .62, -4, 30, h * .34); g.drawImage(fat, w * .62, h * .7, 30, h * .32);
        S.rbc(g, w * .3, h * .5, 20, -.2); S.oxygen(g, w * .82, h * .5, 6, .4);
      }
      if (c.dataset.art === 'td') {
        g.fillStyle = g.createPattern(BioSprites.tissue(128, 26), 'repeat'); g.fillRect(0, 0, w, h);
        g.lineCap = 'round'; g.lineJoin = 'round';
        [[22, '#5a0b15'], [16, '#9a1f2b'], [8, '#c13a47']].forEach(([lw, col]) => { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(0, h * .72); g.lineTo(w * .45, h * .72); g.lineTo(w * .45, h * .3); g.lineTo(w, h * .3); g.stroke(); });
        S.neutrophil(g, w * .22, h * .35, 16, 0); S.bcell(g, w * .72, h * .7, 13, 0); S.bacterium(g, w * .45, h * .52, 26, Math.PI / 2, 0); S.virus(g, w * .86, h * .3, 6, 0);
      }
      if (c.dataset.art === 'bomb') {
        g.fillStyle = g.createPattern(BioSprites.ecm(128, 128), 'repeat'); g.fillRect(0, 0, w, h);
        const s = h / 3, col = BioSprites.collagen(Math.round(s), Math.round(s), 2);
        for (let x = 0; x < w; x += s * 2) g.drawImage(col, x + s, s, s, s);
        g.drawImage(sp().debris[0], w * .55, 0, s, s); g.drawImage(sp().lyso, w * .1, s * 2, s * .8, s * .8);
        S.macrophage(g, w * .25, h * .5, s * .45, 0); S.bacterium(g, w * .82, h * .82, s * .9, .3, 0);
      }
    });
  }

  // ================================================================ 1. Bloodstream Dash (Flappy-style)
  function dash() {
    open('Bloodstream Dash', st => {
      const { g } = st;
      const WALL = 30, tex = { endo: BioSprites.endothelium(512, 44), fat: BioSprites.fat(128, 512, 24) };
      let state = 'ready', y, vy, pipes, spawnX, score, speed, t0, bgCells, plateletsF, o2s, wallPhase = 0;
      const R = () => Math.max(14, Math.min(st.W, st.H) * .045);
      function reset() {
        y = st.H * .45; vy = 0; pipes = []; score = 0; speed = Math.max(150, st.W * .22); spawnX = st.W * .55; o2s = []; t0 = 0;
        bgCells = Array.from({ length: 12 }, () => ({ x: Math.random() * st.W, y: Math.random() * st.H, r: 7 + Math.random() * 12, s: .3 + Math.random() * .5, a: Math.random() * TAU }));
        plateletsF = Array.from({ length: 26 }, () => ({ x: Math.random() * st.W, y: Math.random() * st.H, r: 3 + Math.random() * 4, s: .6 + Math.random() * .8, a: Math.random() * TAU }));
        st.score('Score 0 · Best ' + best('dash'));
        st.msg('<b>Bloodstream Dash</b><span>You are a red blood cell. Tap / click / Space to swim up and squeeze through the gaps in the fatty plaque.<br>Oxygen molecules = +2.</span><em>Tap to start</em>');
      }
      st.onResize = () => { if (state !== 'play') reset(); };
      function flap() {
        if (state === 'ready') { state = 'play'; st.msg(null); }
        if (state === 'over') { if (performance.now() - t0 > 600) { state = 'ready'; reset(); } return; }
        vy = -Math.max(300, st.H * .56); sfx('select');
      }
      st.cv.addEventListener('pointerdown', flap);
      st.el.querySelector('#arcMsg').addEventListener('pointerdown', e => { e.stopPropagation(); flap(); });
      st.onKey = k => { if (k === ' ' || k === 'ArrowUp') flap(); };
      function addPipe() {
        const gap = Math.max(R() * 6, st.H * (.44 - Math.min(.14, score * .006)));      // wide at first, narrows as you score
        const top = WALL + st.H * .06 + Math.random() * Math.max(1, st.H - 2 * WALL - st.H * .12 - gap);
        const w = Math.max(54, st.W * .075);
        pipes.push({ x: st.W + 60, w, top, bot: top + gap, seed: Math.random() * 100, passed: false });
        if (Math.random() < .55) o2s.push({ x: st.W + 60 + w / 2, y: top + gap / 2 + (Math.random() - .5) * gap * .4, got: false });
      }
      function plaque(x, y0, y1, w, seed, fromTop) {   // atheroma: a mound of lipid globules under a thin fibrous cap, rising from the wall
        const hgt = y1 - y0; if (hgt < 4) return;
        const base = fromTop ? y0 : y1, tip = fromTop ? y1 : y0, steps = 14;
        g.save(); g.beginPath(); g.moveTo(x - w * .25, base);
        for (let i = 0; i <= steps; i++) {
          const u = i / steps, xx = x - w * .25 + u * w * 1.5, prof = Math.pow(Math.sin(u * Math.PI), .55);   // broad shoulders into the wall
          g.lineTo(xx, base + (tip - base) * prof + Math.sin(u * 11 + seed) * 4 * prof);
        }
        g.lineTo(x + w * 1.25, base); g.closePath();
        g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 18; g.shadowOffsetY = fromTop ? 6 : -6; g.fillStyle = '#b8862a'; g.fill();
        g.shadowColor = 'transparent';
        g.save(); g.clip();
        const sh = Math.min(512, hgt * 128 / (w * 1.5));
        g.drawImage(tex.fat, 0, (seed * 37) % Math.max(1, 512 - sh), 128, sh, x - w * .25, Math.min(y0, y1), w * 1.5, hgt);
        const cap = g.createLinearGradient(0, tip, 0, base); cap.addColorStop(0, 'rgba(255,190,170,.35)'); cap.addColorStop(.25, 'rgba(255,190,170,0)');
        g.fillStyle = cap; g.fillRect(x - w * .3, Math.min(y0, y1), w * 1.6, hgt);
        g.restore();
        g.strokeStyle = 'rgba(255,215,200,.45)'; g.lineWidth = 2; g.stroke();
        g.restore();
      }
      function wall(top) {                     // vessel lining (endothelium), scrolling with the flow
        const tw = tex.endo.width, off = wallPhase % tw;
        g.save(); if (top) { g.translate(0, WALL); g.scale(1, -1); } else g.translate(0, st.H - WALL);
        for (let x = -off; x < st.W; x += tw) g.drawImage(tex.endo, x, 0, tw, WALL);
        const sh = g.createLinearGradient(0, 0, 0, WALL); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.45)');
        g.fillStyle = sh; g.fillRect(0, 0, st.W, WALL); g.restore();
      }
      st.peek = () => ({ y, vy, H: st.H, W: st.W, state, score, next: pipes.find(p => p.x + p.w > st.W * .28 - R()) });
      st.frame = (dt, t) => {
        const W = st.W, H = st.H, r = R();
        const bg = g.createRadialGradient(W * .5, H * .5, H * .1, W * .5, H * .5, Math.max(W, H) * .75);
        bg.addColorStop(0, '#5e0d18'); bg.addColorStop(.6, '#370710'); bg.addColorStop(1, '#16030a');
        g.fillStyle = bg; g.fillRect(0, 0, W, H);
        const move = state === 'play' ? speed : speed * .25;
        for (const c of bgCells) { c.x -= move * c.s * .35 * dt; c.a += dt * .3; if (c.x < -60) { c.x = W + 60; c.y = Math.random() * H; } S.rbc(g, c.x, c.y, c.r * 2.2, Math.sin(c.a), .3); }
        for (const p of plateletsF) { p.x -= move * p.s * dt; if (p.x < -10) { p.x = W + 10; p.y = Math.random() * H; } S.platelet(g, p.x, p.y, p.r, p.a + t * .5); }
        wallPhase += move * dt;
        wall(true); wall(false);
        if (state === 'play') {
          vy += Math.max(860, H * 1.8) * dt; y += vy * dt; speed += dt * 4;
          spawnX -= speed * dt; if (spawnX <= 0) { addPipe(); spawnX = Math.max(W * .45, 260); }
          for (const p of pipes) {
            p.x -= speed * dt;
            if (!p.passed && p.x + p.w < W * .28 - r) { p.passed = true; score++; sfx('tick'); }
            if (W * .28 + r * .75 > p.x && W * .28 - r * .75 < p.x + p.w && (y - r * .6 < p.top || y + r * .6 > p.bot)) die();
          }
          for (const o of o2s) { o.x -= speed * dt; if (!o.got && Math.hypot(o.x - W * .28, o.y - y) < r + 18) { o.got = true; score += 2; sfx('ok'); } }
          pipes = pipes.filter(p => p.x > -p.w * 1.5); o2s = o2s.filter(o => o.x > -20 && !o.got);
          if (y < WALL + r * .6 || y > H - WALL - r * .6) die();
          st.score(`Score ${score} · Best ${best('dash')}`);
        } else if (state === 'ready') { y = H * .26 + Math.sin(t * 3) * 10; }
        for (const p of pipes) { plaque(p.x, WALL - 4, p.top, p.w, p.seed, true); plaque(p.x, p.bot, H - WALL + 4, p.w, p.seed + 3, false); }
        for (const o of o2s) S.oxygen(g, o.x, o.y, 15, t * 2);
        g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 16; g.shadowOffsetY = 8;
        S.rbc(g, W * .28, y, r * 1.15, Math.max(-.6, Math.min(.8, vy / 900))); g.restore();
        const vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.max(W, H) * .7);
        vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.5)'); g.fillStyle = vig; g.fillRect(0, 0, W, H);
      };
      function die() {
        if (state !== 'play') return;
        state = 'over'; t0 = performance.now(); saveBest('dash', score); sfx('alarm'); st.score(`Score ${score} · Best ${best('dash')}`);
        st.msg(`<b>Blocked artery!</b><span>Score ${score} · Best ${best('dash')}</span><em>Tap to try again</em>`, () => flap());
      }
      reset();
    });
  }

  // ================================================================ 2. Immune Defense (tower defense)
  function td() {
    open('Immune Defense', st => {
      const { g } = st;
      // capillary path through the tissue, from the edge to the exit (on to the heart); turned on its side for a portrait iPad
      const portrait = st.el.querySelector('.arc-stage').clientHeight > st.el.querySelector('.arc-stage').clientWidth;
      const COLS = portrait ? 8 : 14, ROWS = portrait ? 14 : 8;
      const WAY0 = [[0, 1], [3, 1], [3, 5], [6, 5], [6, 2], [9, 2], [9, 6], [12, 6], [12, 3], [13, 3]];
      const WAY = portrait ? WAY0.map(([x, y]) => [y, x]) : WAY0;
      const pathCells = new Set(), path = [];
      for (let i = 0; i < WAY.length - 1; i++) {
        let [x, y] = WAY[i]; const [x2, y2] = WAY[i + 1];
        while (x !== x2 || y !== y2) { pathCells.add(x + ',' + y); path.push([x, y]); x += Math.sign(x2 - x); y += Math.sign(y2 - y); }
      }
      pathCells.add(WAY[WAY.length - 1].join(',')); path.push(WAY[WAY.length - 1]);
      const TOWERS = {
        neutrophil: { name: 'Neutrophil', cost: 30, range: 2.1, rate: 2.2, dmg: 5, note: 'fast, short range' },
        macrophage: { name: 'Macrophage', cost: 55, range: 1.5, rate: .8, dmg: 22, note: 'engulfs one germ, big hit' },
        bcell: { name: 'B cell', cost: 70, range: 3.2, rate: 1.1, dmg: 3, note: 'antibodies slow germs' }
      };
      let tile = 0, ox = 0, oy = 0, towers, foes, shots, atp, lives, wave, waveLeft, spawnT, betweenT, sel = 'neutrophil', over, fx;
      let tissuePat = null, tissueFor = 0;
      const pad = st.el.querySelector('#arcPad');
      pad.innerHTML = `<div class="td-bar">${Object.entries(TOWERS).map(([k, t]) => `<button class="td-btn" data-t="${k}"><canvas data-k="${k}"></canvas><span><b>${t.name}</b><i>${t.cost} ATP · ${t.note}</i></span></button>`).join('')}
        <button class="btn sm primary" id="tdWave">Next wave ▶</button></div>`;
      pad.querySelectorAll('.td-btn canvas').forEach(c => { c.width = 72; c.height = 72; const x = c.getContext('2d'); ({ neutrophil: S.neutrophil, macrophage: S.macrophage, bcell: S.bcell })[c.dataset.k](x, 36, 36, 28, 0); });
      const paintSel = () => pad.querySelectorAll('.td-btn').forEach(b => b.classList.toggle('on', b.dataset.t === sel));
      pad.querySelectorAll('.td-btn').forEach(b => b.onclick = () => { sel = b.dataset.t; paintSel(); });
      pad.querySelector('#tdWave').onclick = () => { if (!over && waveLeft === 0 && !foes.length) startWave(); };
      function reset() {
        towers = []; foes = []; shots = []; fx = []; atp = 100; lives = 20; wave = 0; waveLeft = 0; spawnT = 0; betweenT = 4; over = false; paintSel();
        st.msg('<b>Immune Defense</b><span>Bacteria and viruses travel along the capillary toward the heart. Pick a white blood cell below, then tap the tissue beside the vessel to place it. Each germ destroyed gives ATP.</span><em>Tap to start</em>', () => { st.msg(null); startWave(); });
      }
      st.onResize = () => {
        tile = Math.floor(Math.min(st.W / COLS, st.H / ROWS)); ox = Math.floor((st.W - tile * COLS) / 2); oy = Math.floor((st.H - tile * ROWS) / 2);
        if (tissueFor !== tile) { tissueFor = tile; tissuePat = g.createPattern(BioSprites.tissue(256, Math.max(30, tile * .55)), 'repeat'); }
      };
      const cx = c => ox + (c + .5) * tile, cy = r => oy + (r + .5) * tile;
      function startWave() { wave++; waveLeft = 6 + wave * 2; spawnT = 0; sfx('granted'); }
      function spawn() {
        const kind = wave >= 4 && Math.random() < .15 ? 'tough' : Math.random() < .45 ? 'virus' : 'bact';
        const hp = { bact: 18, virus: 10, tough: 70 }[kind] * (1 + wave * .18);
        foes.push({ kind, hp, max: hp, d: 0, speed: { bact: 1.1, virus: 1.7, tough: .7 }[kind], slow: 0, hurt: 0 });
      }
      function posOf(f) {
        const i = Math.min(path.length - 2, Math.floor(f.d)), u = f.d - i;
        const [x1, y1] = path[i], [x2, y2] = path[i + 1];
        return [cx(x1 + (x2 - x1) * u), cy(y1 + (y2 - y1) * u), Math.atan2(y2 - y1, x2 - x1)];
      }
      st.cv.addEventListener('pointerdown', e => {
        if (over) return;
        const r = st.cv.getBoundingClientRect(), c = Math.floor((e.clientX - r.left - ox) / tile), rr = Math.floor((e.clientY - r.top - oy) / tile);
        if (c < 0 || rr < 0 || c >= COLS || rr >= ROWS) return;
        if (pathCells.has(c + ',' + rr) || towers.some(t => t.c === c && t.r === rr)) { fx.push({ x: cx(c), y: cy(rr), t: .8, txt: 'Place it beside the vessel' }); return; }
        const T = TOWERS[sel];
        if (atp < T.cost) { fx.push({ x: cx(c), y: cy(rr), t: 1, txt: 'Need ' + T.cost + ' ATP' }); sfx('tick'); return; }
        atp -= T.cost; towers.push({ c, r: rr, k: sel, cd: 0, eat: 0, eatAng: 0 }); sfx('join');
      });
      function hit(f, dmg, slow) {
        f.hp -= dmg; f.hurt = .12; if (slow) f.slow = 2;
        if (f.hp <= 0 && !f.dead) { f.dead = true; const gain = f.kind === 'tough' ? 15 : 6; atp += gain; const [x, y] = posOf(f); fx.push({ x, y, t: .8, txt: '+' + gain + ' ATP', col: '#46f08f' }); }
      }
      function end() { over = true; saveBest('td', wave); st.msg(`<b>The infection reached the heart</b><span>You held out to wave ${wave}. Best: wave ${best('td')}</span><em>Tap to play again</em>`, () => { st.msg(null); reset(); }); }
      st.frame = (dt, t) => {
        const W = st.W, H = st.H;
        g.fillStyle = '#1a0d14'; g.fillRect(0, 0, W, H);
        g.save(); g.translate(ox, oy); g.fillStyle = tissuePat; g.fillRect(0, 0, tile * COLS, tile * ROWS); g.restore();
        g.strokeStyle = 'rgba(40,10,30,.22)'; g.lineWidth = 1;               // faint placement grid
        for (let c = 1; c < COLS; c++) { g.beginPath(); g.moveTo(ox + c * tile, oy); g.lineTo(ox + c * tile, oy + tile * ROWS); g.stroke(); }
        for (let r = 1; r < ROWS; r++) { g.beginPath(); g.moveTo(ox, oy + r * tile); g.lineTo(ox + tile * COLS, oy + r * tile); g.stroke(); }
        // capillary: a round tube, shaded from the dark wall edge to the bright lumen centre
        g.lineCap = 'round'; g.lineJoin = 'round';
        const d0 = [path[1][0] - path[0][0], path[1][1] - path[0][1]];
        const tube = () => { g.beginPath(); path.forEach(([c, r], i) => i ? g.lineTo(cx(c), cy(r)) : g.moveTo(cx(c) - d0[0] * tile, cy(r) - d0[1] * tile)); };
        g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = tile * .3; tube(); g.strokeStyle = '#3d0710'; g.lineWidth = tile * .9; g.stroke(); g.restore();
        [[.84, '#6e0d18'], [.7, '#8e1824'], [.55, '#a82431'], [.36, '#bd3442']].forEach(([k, c]) => { tube(); g.strokeStyle = c; g.lineWidth = tile * k; g.stroke(); });
        g.save(); g.translate(-tile * .08, -tile * .1); tube(); g.strokeStyle = 'rgba(255,190,190,.18)'; g.lineWidth = tile * .12; g.stroke(); g.restore();
        for (let i = 0; i < path.length * 1.5; i++) {                         // red cells streaming through the capillary
          const d = (t * .9 + i * .67) % (path.length - 1), k = Math.floor(d), u = d - k, [x1, y1] = path[k], [x2, y2] = path[k + 1];
          S.rbc(g, cx(x1 + (x2 - x1) * u), cy(y1 + (y2 - y1) * u) + Math.sin(i * 2.1) * tile * .08, tile * .16, Math.sin(t * 2 + i), .85);
        }
        const [hc, hr] = path[path.length - 1], [pc, pr] = path[path.length - 2], ex = cx(hc) + (hc - pc) * tile * .45, ey = cy(hr) + (hr - pr) * tile * .45;
        const glow = g.createRadialGradient(ex, ey, 2, ex, ey, tile * (1 + .08 * Math.sin(t * 6)));
        glow.addColorStop(0, lives > 5 ? 'rgba(255,90,100,.9)' : 'rgba(255,200,200,.95)'); glow.addColorStop(1, 'rgba(255,60,80,0)');
        g.fillStyle = glow; g.beginPath(); g.arc(ex, ey, tile, 0, TAU); g.fill();
        g.fillStyle = '#fff'; g.font = `700 ${Math.max(10, tile * .2)}px "IBM Plex Mono", monospace`; g.textAlign = 'center'; g.fillText('TO HEART', ex - (hc - pc) * tile * .9 - (hr - pr) * tile * .9, ey - (hr - pr) * tile * .7 + (hc - pc) * tile * .66);

        if (!over && wave > 0) {
          if (waveLeft > 0) { spawnT -= dt; if (spawnT <= 0) { spawn(); waveLeft--; spawnT = Math.max(.35, 1 - wave * .05); } }
          else if (!foes.length) { betweenT -= dt; if (betweenT <= 0) { betweenT = 5; startWave(); } }
          for (const f of foes) {
            f.d += f.speed * (f.slow > 0 ? .5 : 1) * dt; f.slow -= dt; f.hurt -= dt;
            if (f.d >= path.length - 1) { f.dead = true; lives -= f.kind === 'tough' ? 3 : 1; sfx('alarm'); if (lives <= 0) end(); }
          }
          for (const tw of towers) {
            const T = TOWERS[tw.k]; tw.cd -= dt; tw.eat = Math.max(0, tw.eat - dt);
            if (tw.cd > 0) continue;
            let target = null, bestD = -1;
            for (const f of foes) { if (f.dead) continue; const [x, y] = posOf(f); if (Math.hypot(x - cx(tw.c), y - cy(tw.r)) <= T.range * tile && f.d > bestD) { bestD = f.d; target = f; } }
            if (!target) continue;
            tw.cd = 1 / T.rate;
            if (tw.k === 'macrophage') { hit(target, T.dmg, false); tw.eat = .4; const [x, y] = posOf(target); tw.eatAng = Math.atan2(y - cy(tw.r), x - cx(tw.c)) || .001; }
            else shots.push({ x: cx(tw.c), y: cy(tw.r), f: target, k: tw.k, dmg: T.dmg, ang: 0 });
          }
          for (const s of shots) {
            if (s.f.dead) { s.done = true; continue; }
            const [x, y] = posOf(s.f), d = Math.hypot(x - s.x, y - s.y), stp = 420 * dt;
            s.ang = Math.atan2(y - s.y, x - s.x);
            if (d < stp + 4) { hit(s.f, s.dmg, s.k === 'bcell'); s.done = true; } else { s.x += (x - s.x) / d * stp; s.y += (y - s.y) / d * stp; }
          }
          shots = shots.filter(s => !s.done); foes = foes.filter(f => !f.dead);
        }
        g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 12; g.shadowOffsetY = 5;
        for (const tw of towers) {
          const draw = { neutrophil: S.neutrophil, macrophage: S.macrophage, bcell: S.bcell }[tw.k];
          draw(g, cx(tw.c), cy(tw.r), tile * (tw.k === 'macrophage' ? .38 : tw.k === 'bcell' ? .3 : .36), t + tw.c, tw.eat ? tw.eatAng : 0);
        }
        g.restore();
        for (const f of foes) {
          const [x, y, a] = posOf(f);
          g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 8; g.shadowOffsetY = 3;
          if (f.kind === 'virus') S.virus(g, x, y, tile * .15, t, f.hurt > 0); else S.bacterium(g, x, y, tile * (f.kind === 'tough' ? .7 : .56), a, t, f.kind === 'tough', f.hurt > 0);
          g.restore();
          if (f.slow > 0) { g.strokeStyle = 'rgba(255,224,102,.8)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, tile * .3, 0, TAU); g.stroke(); }
          g.fillStyle = 'rgba(30,0,0,.8)'; g.fillRect(x - tile * .25, y - tile * .4, tile * .5, 4); g.fillStyle = '#46f08f'; g.fillRect(x - tile * .25, y - tile * .4, tile * .5 * Math.max(0, f.hp / f.max), 4);
        }
        for (const s of shots) {
          if (s.k === 'bcell') S.antibody(g, s.x, s.y, s.ang, Math.max(5, tile * .09));
          else { const gr = g.createRadialGradient(s.x - 1, s.y - 1, .5, s.x, s.y, 4.5); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(190,140,255,.2)'); g.fillStyle = gr; g.beginPath(); g.arc(s.x, s.y, 4.5, 0, TAU); g.fill(); }   // enzyme granule
        }
        fx = fx.filter(f => (f.t -= dt) > 0);
        for (const f of fx) { g.globalAlpha = Math.min(1, f.t * 2); g.fillStyle = f.col || '#fff'; g.font = '700 13px Archivo, sans-serif'; g.textAlign = 'center'; g.fillText(f.txt, f.x, f.y - (1 - f.t) * 24); g.globalAlpha = 1; }
        st.score(`Wave ${wave} · ATP ${atp} · Heart ${Math.max(0, lives)}/20`);
        pad.querySelectorAll('.td-btn').forEach(b => b.classList.toggle('poor', atp < TOWERS[b.dataset.t].cost));
      };
      reset();
    });
  }

  // ================================================================ 3. Lysosome Blast (Bomberman-style)
  function bomb() {
    open('Lysosome Blast', st => {
      const { g } = st;
      const portrait = st.el.querySelector('.arc-stage').clientHeight > st.el.querySelector('.arc-stage').clientWidth;
      const C = portrait ? 9 : 13, R = portrait ? 13 : 9;
      let tile = 0, ox = 0, oy = 0, grid, me, bombs, blasts, bugs, pows, level = 1, score = 0, lives = 3, state = 'ready', held = null;
      let floorPat = null, walls = [], texFor = 0;
      const pad = st.el.querySelector('#arcPad');
      pad.innerHTML = `<div class="bm-pad"><div class="dpad">
          <button data-d="up">▲</button><button data-d="left">◀</button><button data-d="right">▶</button><button data-d="down">▼</button></div>
        <button class="bm-bomb" data-d="bomb">Drop<br>lysosome</button></div>`;
      const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
      pad.querySelectorAll('[data-d]').forEach(b => {
        const d = b.dataset.d;
        b.addEventListener('pointerdown', e => { e.preventDefault(); start(); if (d === 'bomb') drop(); else held = d; });
        b.addEventListener('pointerup', () => { if (held === d) held = null; });
        b.addEventListener('pointerleave', () => { if (held === d) held = null; });
        b.addEventListener('pointercancel', () => { if (held === d) held = null; });
      });
      st.onKey = k => { if (k === ' ') { start(); drop(); } else if ({ ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, w: 1, a: 1, s: 1, d: 1 }[k]) start(); };
      function build() {
        grid = [];
        for (let y = 0; y < R; y++) { grid.push([]); for (let x = 0; x < C; x++) {
          const wallCell = x === 0 || y === 0 || x === C - 1 || y === R - 1 || (x % 2 === 0 && y % 2 === 0);
          grid[y].push(wallCell ? 2 : !(x <= 2 && y <= 2) && Math.random() < .5 ? 1 : 0);
        } }
        me = { x: 1, y: 1, px: 1, py: 1, range: 2, max: 1, inv: 2 };
        bombs = []; blasts = []; pows = []; bugs = [];
        const n = 3 + level;
        while (bugs.length < n) {
          const x = 1 + Math.floor(Math.random() * (C - 2)), y = 1 + Math.floor(Math.random() * (R - 2));
          if (grid[y][x] === 0 && x + y > 6 && !bugs.some(b => b.x === x && b.y === y)) bugs.push({ x, y, px: x, py: y, dir: null, sp: 1.6 + level * .15, ang: 0 });
        }
      }
      function start() {
        if (state === 'ready') { state = 'play'; st.msg(null); }
        else if (state === 'over') { level = 1; score = 0; lives = 3; build(); state = 'play'; st.msg(null); }
      }
      function reset() {
        build(); state = 'ready';
        st.msg('<b>Lysosome Blast</b><span>You are a macrophage. Drop lysosomes: they burst and their enzymes digest dead-cell debris and bacteria. Clear every bacterium, and keep out of your own enzyme blast!<br>Arrows / D-pad to move · Space / button to drop.</span><em>Tap to start</em>', start);
      }
      st.onResize = () => {
        tile = Math.floor(Math.min(st.W / C, st.H / R)); ox = Math.floor((st.W - tile * C) / 2); oy = Math.floor((st.H - tile * R) / 2);
        if (texFor !== tile) { texFor = tile; floorPat = g.createPattern(BioSprites.ecm(256, 256), 'repeat'); walls = [1, 2, 3].map(k => BioSprites.collagen(tile, tile, k)); }
      };
      const free = (x, y) => grid[y] && grid[y][x] === 0 && !bombs.some(b => b.x === x && b.y === y);
      function drop() {
        if (state !== 'play') return;
        if (bombs.length >= me.max || bombs.some(b => b.x === me.x && b.y === me.y)) return;
        bombs.push({ x: me.x, y: me.y, t: 2, range: me.range }); sfx('select');
      }
      function explode(b) {
        b.done = true; sfx('clunk');
        const cells = [[b.x, b.y]];
        for (const [dx, dy] of Object.values(DIRS)) for (let i = 1; i <= b.range; i++) {
          const x = b.x + dx * i, y = b.y + dy * i; if (grid[y][x] === 2) break;
          cells.push([x, y]);
          if (grid[y][x] === 1) { grid[y][x] = 0; score += 10; if (Math.random() < .22) pows.push({ x, y, k: Math.random() < .5 ? 'range' : 'max' }); break; }
          const chain = bombs.find(o => !o.done && o.x === x && o.y === y); if (chain) chain.t = 0;
        }
        blasts.push({ cells, t: .5 });
      }
      function hurt() {
        lives--; me.inv = 2; sfx('alarm');
        if (lives <= 0) { state = 'over'; saveBest('bomb', score); st.msg(`<b>Macrophage down</b><span>Score ${score} · Best ${best('bomb')}</span><em>Tap to play again</em>`, start); }
        else { me.x = me.px = 1; me.y = me.py = 1; }
      }
      st.frame = (dt, t) => {
        const W = st.W, H = st.H;
        if (state === 'play') {
          // move the macrophage tile by tile, smoothly
          const want = held || (st.keys.ArrowUp || st.keys.w ? 'up' : st.keys.ArrowDown || st.keys.s ? 'down' : st.keys.ArrowLeft || st.keys.a ? 'left' : st.keys.ArrowRight || st.keys.d ? 'right' : null);
          const at = Math.abs(me.px - me.x) < .001 && Math.abs(me.py - me.y) < .001;
          if (at && want) { const [dx, dy] = DIRS[want], nx = me.x + dx, ny = me.y + dy; if (grid[ny][nx] === 0 && !bombs.some(b => b.x === nx && b.y === ny)) { me.x = nx; me.y = ny; } }
          const spd = 5 * dt; me.px += Math.max(-spd, Math.min(spd, me.x - me.px)); me.py += Math.max(-spd, Math.min(spd, me.y - me.py));
          me.inv -= dt;
          for (const b of bombs) { b.t -= dt; if (b.t <= 0 && !b.done) explode(b); }
          bombs = bombs.filter(b => !b.done);
          blasts.forEach(bl => bl.t -= dt); blasts = blasts.filter(bl => bl.t > 0);
          const hot = (x, y) => blasts.some(bl => bl.cells.some(([a, b]) => a === x && b === y));
          for (const p of pows) if (p.x === me.x && p.y === me.y && !p.got) { p.got = true; if (p.k === 'range') me.range++; else me.max++; sfx('ok'); }
          pows = pows.filter(p => !p.got);
          for (const bg of bugs) {
            const atB = Math.abs(bg.px - bg.x) < .001 && Math.abs(bg.py - bg.y) < .001;
            if (atB) {
              const opts = Object.entries(DIRS).filter(([, [dx, dy]]) => free(bg.x + dx, bg.y + dy));
              if (opts.length) { let pick = opts.find(([k]) => k === bg.dir); if (!pick || Math.random() < .25) pick = opts[Math.floor(Math.random() * opts.length)]; bg.dir = pick[0]; bg.x += pick[1][0]; bg.y += pick[1][1]; bg.ang = Math.atan2(pick[1][1], pick[1][0]); }
            }
            const s2 = bg.sp * dt; bg.px += Math.max(-s2, Math.min(s2, bg.x - bg.px)); bg.py += Math.max(-s2, Math.min(s2, bg.y - bg.py));
            if (hot(Math.round(bg.px), Math.round(bg.py))) { bg.dead = true; score += 100; sfx('ok'); }
            if (!bg.dead && me.inv <= 0 && Math.hypot(bg.px - me.px, bg.py - me.py) < .6) hurt();
          }
          bugs = bugs.filter(b => !b.dead);
          if (state === 'play' && me.inv <= 0 && hot(me.x, me.y)) hurt();
          if (state === 'play' && !bugs.length) {
            level++; score += 250; sfx('granted'); state = 'between';
            st.msg(`<b>Tissue cleared!</b><span>Level ${level} has ${3 + level} bacteria.</span><em>Tap to continue</em>`, () => { build(); state = 'play'; st.msg(null); });
          }
        }
        // extracellular-matrix floor, collagen bundles (hard), apoptotic debris (soft)
        g.fillStyle = '#040b10'; g.fillRect(0, 0, W, H);
        g.save(); g.translate(ox, oy); g.fillStyle = floorPat; g.fillRect(0, 0, tile * C, tile * R); g.restore();
        for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
          const X = ox + x * tile, Y = oy + y * tile, v = grid[y][x];
          if (v === 2) {
            g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = tile * .25; g.shadowOffsetY = tile * .08;
            if ((x + y) % 2) { g.translate(X + tile / 2, Y + tile / 2); g.rotate(Math.PI / 2); g.drawImage(walls[(x * 3 + y) % 3], -tile / 2, -tile / 2, tile, tile); }
            else g.drawImage(walls[(x * 3 + y) % 3], X, Y, tile, tile);
            g.restore();
          } else if (v === 1) {
            g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 8; g.shadowOffsetY = 3;
            g.drawImage(sp().debris[(x * 5 + y * 3) % 3], X - tile * .05, Y - tile * .05, tile * 1.1, tile * 1.1); g.restore();
          }
        }
        for (const p of pows) {   // power-ups: ATP = bigger blast, +1 = carry another lysosome
          const X = ox + (p.x + .5) * tile, Y = oy + (p.y + .5) * tile, s2 = tile * (.3 + .03 * Math.sin(t * 6));
          const gr = g.createRadialGradient(X - s2 * .3, Y - s2 * .3, 1, X, Y, s2); gr.addColorStop(0, '#fff'); gr.addColorStop(.35, p.k === 'range' ? '#ffd24d' : '#8cf5b8'); gr.addColorStop(1, p.k === 'range' ? 'rgba(200,130,20,.2)' : 'rgba(40,160,90,.2)');
          g.fillStyle = gr; g.beginPath(); g.arc(X, Y, s2, 0, TAU); g.fill();
          g.fillStyle = '#02060a'; g.font = `800 ${tile * .22}px "IBM Plex Mono", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p.k === 'range' ? 'ATP' : '+1', X, Y + 1);
        }
        for (const b of bombs) {  // lysosome vesicle, pulsing faster before it bursts
          const X = ox + (b.x + .5) * tile, Y = oy + (b.y + .5) * tile, pulse = 1 + .1 * Math.sin(t * (6 + (2 - b.t) * 10)), s2 = tile * .8 * pulse;
          g.save(); g.shadowColor = 'rgba(70,240,143,.6)'; g.shadowBlur = 14 * (2.2 - b.t); g.drawImage(sp().lyso, X - s2 / 2, Y - s2 / 2, s2, s2); g.restore();
        }
        for (const bl of blasts) for (const [x, y] of bl.cells) {   // released hydrolytic enzymes
          const X = ox + x * tile, Y = oy + y * tile; g.globalAlpha = Math.min(1, bl.t * 2.5);
          const gr = g.createRadialGradient(X + tile / 2, Y + tile / 2, 2, X + tile / 2, Y + tile / 2, tile * .7); gr.addColorStop(0, '#f6ffe0'); gr.addColorStop(.5, 'rgba(120,255,170,.85)'); gr.addColorStop(1, 'rgba(70,240,143,0)');
          g.fillStyle = gr; g.fillRect(X, Y, tile, tile); g.globalAlpha = 1;
        }
        g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 10; g.shadowOffsetY = 4;
        for (const bg of bugs) S.bacterium(g, ox + (bg.px + .5) * tile, oy + (bg.py + .5) * tile, tile * .82, bg.ang, t);
        if (!(state === 'play' && me.inv > 0 && Math.floor(t * 10) % 2)) S.macrophage(g, ox + (me.px + .5) * tile, oy + (me.py + .5) * tile, tile * .4, t);
        g.restore();
        st.score(`Level ${level} · Score ${score} · Lives ${Math.max(0, lives)} · Blast ${me.range} · Lysosomes ${me.max}`);
      };
      reset();
    });
  }

  function mount(el) { host = el; menu(); }
  return { mount, close };
})();
