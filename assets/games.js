// Three short biology games for students who finished early (they stay on the test page,
// so the teacher still knows if they leave to help someone).
window.Games = (function () {
  const { esc } = EL;
  let host = null, stopCur = null;
  const best = k => { try { return Number(localStorage.getItem('bio-best-' + k)) || 0; } catch (e) { return 0; } };
  const saveBest = (k, v) => { try { if (v > best(k)) localStorage.setItem('bio-best-' + k, v); } catch (e) {} };

  function frame(title, sub) {
    stop();
    host.innerHTML = `<div class="game">
      <div class="game-top"><button class="btn sm ghost" data-g="back">← Games</button><b>${esc(title)}</b><span class="game-score" id="gScore"></span></div>
      <div class="game-sub small muted">${sub}</div>
      <div class="game-area" id="gArea"></div></div>`;
    host.querySelector('[data-g=back]').onclick = menu;
    return host.querySelector('#gArea');
  }
  function stop() { if (stopCur) { stopCur(); stopCur = null; } }
  const score = t => { const s = host.querySelector('#gScore'); if (s) s.textContent = t; };

  function menu() {
    stop();
    host.innerHTML = `<div class="game-menu">
      <button class="game-tile" data-play="defend"><span class="gt-ico">${EL.icon('shield')}</span><b>Cell Defender</b><span>Tap the viruses before they reach the cell.</span><em>Best ${best('defend')}</em></button>
      <button class="game-tile" data-play="match"><span class="gt-ico">${EL.icon('tests')}</span><b>Organelle Match</b><span>Pair each organelle with its job.</span><em>Best ${best('match') ? best('match') + ' moves' : '–'}</em></button>
      <button class="game-tile" data-play="pairs"><span class="gt-ico">${EL.icon('leaf')}</span><b>Base-Pair Rush</b><span>A–T, G–C. Match as many as you can in 30 s.</span><em>Best ${best('pairs')}</em></button>
    </div>`;
    host.querySelectorAll('[data-play]').forEach(b => b.onclick = () => ({ defend, match, pairs })[b.dataset.play]());
  }

  // ---------------------------------------------------------------- 1. Cell Defender
  function defend() {
    const area = frame('Cell Defender', 'Viruses are heading for the cell. Tap them. 3 hits and the cell is infected.');
    const cv = document.createElement('canvas'); cv.className = 'game-canvas'; area.appendChild(cv);
    const g = cv.getContext('2d');
    let W, H, dpr, raf, pts = 0, lives = 3, foes = [], pops = [], spawnT = 0, t0 = performance.now(), over = false;
    function size() { dpr = Math.min(2, devicePixelRatio || 1); W = area.clientWidth; H = Math.max(320, Math.min(520, innerHeight * .55)); cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px'; g.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size(); addEventListener('resize', size);
    function spawn() {
      const a = Math.random() * Math.PI * 2, d = Math.max(W, H) * .6;
      const speed = 40 + Math.min(110, (performance.now() - t0) / 400);
      foes.push({ x: W / 2 + Math.cos(a) * d, y: H / 2 + Math.sin(a) * d, sp: speed, r: 14, rot: 0 });
    }
    function virus(f) {   // icosahedral capsid with spike proteins
      g.save(); g.translate(f.x, f.y); g.rotate(f.rot);
      g.strokeStyle = '#ff6b7a'; g.lineWidth = 2;
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * f.r, Math.sin(a) * f.r); g.lineTo(Math.cos(a) * (f.r + 7), Math.sin(a) * (f.r + 7)); g.stroke(); g.beginPath(); g.arc(Math.cos(a) * (f.r + 8), Math.sin(a) * (f.r + 8), 2.4, 0, 7); g.fillStyle = '#ff9aa4'; g.fill(); }
      g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.lineTo(Math.cos(a) * f.r, Math.sin(a) * f.r); } g.closePath();
      g.fillStyle = 'rgba(255,80,100,.35)'; g.fill(); g.stroke(); g.restore();
    }
    function loop(now) {
      const dt = Math.min(.05, (now - (loop.l || now)) / 1000); loop.l = now;
      g.clearRect(0, 0, W, H);
      // the cell: membrane, cytoplasm, nucleus
      const cr = Math.min(W, H) * .16;
      const grd = g.createRadialGradient(W / 2, H / 2, cr * .2, W / 2, H / 2, cr);
      grd.addColorStop(0, 'rgba(70,240,143,.25)'); grd.addColorStop(1, 'rgba(70,240,143,.08)');
      g.fillStyle = grd; g.beginPath(); g.arc(W / 2, H / 2, cr, 0, 7); g.fill();
      g.strokeStyle = lives > 1 ? '#46f08f' : '#ff4d5e'; g.lineWidth = 3; g.stroke();
      g.fillStyle = 'rgba(91,140,255,.75)'; g.beginPath(); g.ellipse(W / 2 + cr * .15, H / 2 - cr * .1, cr * .36, cr * .28, .4, 0, 7); g.fill();
      if (!over) {
        spawnT -= dt; if (spawnT <= 0) { spawn(); spawnT = Math.max(.35, 1.2 - (now - t0) / 30000); }
        for (const f of foes) {
          const dx = W / 2 - f.x, dy = H / 2 - f.y, d = Math.hypot(dx, dy);
          f.x += dx / d * f.sp * dt; f.y += dy / d * f.sp * dt; f.rot += dt * 1.5;
          if (d < cr + f.r) { f.dead = true; lives--; navigator.vibrate && navigator.vibrate(60); EL.sfx.alarm && EL.sfx.tick(); if (lives <= 0) end(); }
        }
        foes = foes.filter(f => !f.dead);
      }
      foes.forEach(virus);
      pops = pops.filter(p => (p.t -= dt) > 0);
      for (const p of pops) { g.strokeStyle = `rgba(70,240,143,${p.t * 2})`; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, 30 - p.t * 30, 0, 7); g.stroke(); }
      score(`Score ${pts} · Cell health ${'●'.repeat(Math.max(0, lives))}${'○'.repeat(3 - Math.max(0, lives))}`);
      if (over) { g.fillStyle = 'rgba(2,6,10,.6)'; g.fillRect(0, 0, W, H); g.fillStyle = '#e7f4f8'; g.textAlign = 'center'; g.font = '800 34px Archivo, sans-serif'; g.fillText('CELL INFECTED', W / 2, H / 2 - 6); g.font = '500 16px Archivo, sans-serif'; g.fillText(`Score ${pts} · tap to play again`, W / 2, H / 2 + 24); }
      raf = requestAnimationFrame(loop);
    }
    function end() { over = true; saveBest('defend', pts); EL.sfx.ok(); }
    cv.addEventListener('pointerdown', e => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (over) { pts = 0; lives = 3; foes = []; over = false; t0 = performance.now(); return; }
      let hit = false;
      for (const f of foes) if (!f.dead && Math.hypot(f.x - x, f.y - y) < f.r + 16) { f.dead = true; pts++; hit = true; pops.push({ x: f.x, y: f.y, t: .5 }); }
      foes = foes.filter(f => !f.dead);
      if (hit) EL.sfx.select();
    });
    raf = requestAnimationFrame(loop);
    stopCur = () => { cancelAnimationFrame(raf); removeEventListener('resize', size); };
  }

  // ---------------------------------------------------------------- 2. Organelle Match (memory)
  function match() {
    const area = frame('Organelle Match', 'Flip two cards. Match each organelle with its job in as few moves as you can.');
    const PAIRS = [['Mitochondrion', 'Releases energy (ATP) from food'], ['Ribosome', 'Builds proteins'], ['Nucleus', 'Holds the DNA, controls the cell'],
      ['Chloroplast', 'Photosynthesis'], ['Cell membrane', 'Controls what enters and leaves'], ['Golgi apparatus', 'Packages and ships proteins']];
    const cards = [];
    PAIRS.forEach((p, i) => { cards.push({ id: i, t: p[0], k: 'name' }); cards.push({ id: i, t: p[1], k: 'job' }); });
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [cards[i], cards[j]] = [cards[j], cards[i]]; }
    area.innerHTML = '<div class="mgrid">' + cards.map((c, i) => `<button class="mcard ${c.k}" data-i="${i}"><span class="mback">?</span><span class="mface">${esc(c.t)}</span></button>`).join('') + '</div>';
    let open = [], moves = 0, done = 0, busy = false;
    score('Moves 0');
    area.querySelector('.mgrid').onclick = e => {
      const b = e.target.closest('.mcard'); if (!b || busy || b.classList.contains('up') || b.classList.contains('ok')) return;
      b.classList.add('up'); open.push(b); EL.sfx.select();
      if (open.length < 2) return;
      moves++; score('Moves ' + moves);
      const [a, c] = open, A = cards[a.dataset.i], C = cards[c.dataset.i];
      if (A.id === C.id && A.k !== C.k) {
        a.classList.add('ok'); c.classList.add('ok'); open = []; done++; EL.sfx.ok();
        if (done === PAIRS.length) { const prev = best('match'); if (!prev || moves < prev) try { localStorage.setItem('bio-best-match', moves); } catch (x) {} score(`All matched in ${moves} moves!`); EL.sfx.granted(); }
      } else { busy = true; setTimeout(() => { a.classList.remove('up'); c.classList.remove('up'); open = []; busy = false; }, 800); }
    };
  }

  // ---------------------------------------------------------------- 3. Base-Pair Rush
  function pairs() {
    const area = frame('Base-Pair Rush', 'A pairs with T, G pairs with C. Tap the partner of the glowing base. 30 seconds.');
    const PART = { A: 'T', T: 'A', G: 'C', C: 'G' };
    area.innerHTML = `<div class="rush"><div class="rush-strand" id="rStrand"></div><div class="rush-base" id="rBase"></div>
      <div class="rush-time"><i id="rBar"></i></div>
      <div class="rush-btns">${['A', 'T', 'G', 'C'].map(b => `<button class="rb rb-${b}" data-b="${b}">${b}</button>`).join('')}</div>
      <button class="btn primary" id="rStart">Start</button></div>`;
    let cur = null, pts = 0, streak = 0, end = 0, raf = null, strand = [];
    const next = () => { cur = 'ATGC'[Math.random() * 4 | 0]; area.querySelector('#rBase').textContent = cur; area.querySelector('#rBase').className = 'rush-base rb-' + cur; };
    const paintStrand = () => { area.querySelector('#rStrand').innerHTML = strand.slice(-12).map(([a, b]) => `<span><i class="rb-${a}">${a}</i><i class="rb-${b}">${b}</i></span>`).join(''); };
    function tick() {
      const left = end - performance.now();
      area.querySelector('#rBar').style.transform = `scaleX(${Math.max(0, left / 30000)})`;
      if (left <= 0) { cur = null; area.querySelector('#rBase').textContent = 'Done'; area.querySelector('#rStart').classList.remove('hidden'); area.querySelector('#rStart').textContent = 'Play again'; saveBest('pairs', pts); score(`Score ${pts} · best ${best('pairs')}`); EL.sfx.ok(); return; }
      raf = requestAnimationFrame(tick);
    }
    area.querySelector('#rStart').onclick = e => { pts = 0; streak = 0; strand = []; paintStrand(); end = performance.now() + 30000; e.target.classList.add('hidden'); next(); score('Score 0'); raf = requestAnimationFrame(tick); };
    area.querySelector('.rush-btns').onclick = e => {
      const b = e.target.closest('[data-b]'); if (!b || !cur) return;
      if (b.dataset.b === PART[cur]) { streak++; pts += streak >= 5 ? 2 : 1; strand.push([cur, b.dataset.b]); paintStrand(); EL.sfx.select(); next(); }
      else { streak = 0; b.classList.add('bad'); setTimeout(() => b.classList.remove('bad'), 250); EL.sfx.tick(); }
      score(`Score ${pts}${streak >= 5 ? ' · streak ×2' : ''}`);
    };
    stopCur = () => cancelAnimationFrame(raf);
  }

  function mount(el) { host = el; menu(); }
  return { mount, stop };
})();
