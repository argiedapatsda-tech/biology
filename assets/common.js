// Shared helpers: escaping, ids, test rendering (student page + teacher live mirror), grading, sound.
window.EL = (function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rid = (n = 8) => Math.random().toString(36).slice(2, 2 + n);
  const LETTERS = 'ABCDEF';

  function makeCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }
  function asArray(v) { if (!v) return []; return Array.isArray(v) ? v.filter(x => x != null) : Object.values(v); }

  // deterministic shuffle seeded by a string (so the teacher mirror can reproduce order)
  function seededOrder(ids, seed) {
    let h = 2166136261;
    for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
    const a = ids.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function fmtTime(ms) {
    ms = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(ms / 60), s = ms % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtDur(ms) {
    const s = Math.round((ms || 0) / 1000);
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  }
  function clock(t) { const d = new Date(t); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

  const TYPE_LABEL = { mc: 'Multiple choice', tf: 'True or false', short: 'Short answer' };

  // The test paper (uploaded file) travels as the first item of the questions list.
  function splitPaper(raw) {
    const all = asArray(raw);
    return { paper: all.find(q => q && q.type === 'paper') || null, questions: all.filter(q => q && q.type !== 'paper') };
  }

  // Render the test body. Used live by the student and read-only by the teacher mirror,
  // so both produce identical layout (that's what makes scroll mirroring line up).
  function renderTest(questions, order, answers, opts) {
    opts = opts || {};
    answers = answers || {};
    const byId = {};
    questions.forEach(q => { byId[q.id] = q; });
    const list = (order && order.length ? order.map(id => byId[id]).filter(Boolean) : questions);
    const ro = opts.readonly ? 'tabindex="-1"' : '';
    let paper = '';
    const pp = opts.paper;
    if (pp && (asArray(pp.pages).length || pp.text)) {
      paper = `<section class="paper"><div class="paper-head"><span class="label">Test paper</span><span class="small muted">${esc(pp.name || '')}</span></div>` +
        (asArray(pp.pages).length ? asArray(pp.pages).map((src, i) => `<img class="paper-page" src="${src}" alt="Page ${i + 1}">`).join('')
          : `<div class="paper-text">${esc(pp.text).replace(/\n/g, '<br>')}</div>`) + '</section>';
    }
    const sheetRows = list.some(q => q.sheet) ? '<div class="sheet-title"><span class="label">Answer sheet</span><span class="small muted">Pick your answer for each number on the test paper</span></div>' : '';
    let sheetShown = false;
    return paper + list.map((q, i) => {
      const a = answers[q.id];
      const ans = a != null && a !== '';
      if (q.sheet) {
        const head = sheetShown ? '' : sheetRows; sheetShown = true;
        const choices = q.type === 'tf' ? [['true', 'True'], ['false', 'False']] : asArray(q.options).map((o, k) => [k, LETTERS[k]]);
        return head + `<section class="qcard sheet${ans ? ' answered' : ''}" data-qid="${q.id}"><span class="q-num">${q.n}</span><div class="bubbles">` +
          choices.map(([v, l]) => `<button type="button" class="opt bub${String(a) === String(v) ? ' sel' : ''}" data-q="${q.id}" data-v="${v}" ${ro}>${l}</button>`).join('') + '</div></section>';
      }
      let body = '';
      if (q.type === 'mc') {
        body = '<div class="opts">' + asArray(q.options).map((o, k) =>
          `<button type="button" class="opt${a === k ? ' sel' : ''}" data-q="${q.id}" data-v="${k}" ${ro}>
             <span class="opt-l">${LETTERS[k]}</span><span class="opt-t">${esc(o)}</span></button>`).join('') + '</div>';
      } else if (q.type === 'tf') {
        body = '<div class="opts tf">' + [['true', 'True · จริง'], ['false', 'False · เท็จ']].map(([v, l]) =>
          `<button type="button" class="opt${String(a) === v ? ' sel' : ''}" data-q="${q.id}" data-v="${v}" ${ro}>
             <span class="opt-l">${v === 'true' ? 'T' : 'F'}</span><span class="opt-t">${l}</span></button>`).join('') + '</div>';
      } else {
        body = `<textarea class="short" data-q="${q.id}" rows="3" placeholder="Type your answer…" ${opts.readonly ? 'readonly tabindex="-1"' : ''}>${esc(a || '')}</textarea>`;
      }
      return `<section class="qcard${ans ? ' answered' : ''}" data-qid="${q.id}">
        <div class="q-head"><span class="q-num">${i + 1}</span>
          <span class="q-type">${TYPE_LABEL[q.type] || ''}</span>
          <span class="q-pts">${q.points || 1} pt${(q.points || 1) > 1 ? 's' : ''}</span></div>
        <div class="q-text">${esc(q.text).replace(/\n/g, '<br>')}</div>
        ${q.image ? `<img class="q-img" src="${q.image}" alt="">` : ''}
        ${body}
      </section>`;
    }).join('');
  }

  // shrink a picture file to a JPEG data URL
  function loadImage(file, max, quality) {
    return new Promise((res, rej) => {
      const img = new Image(), r = new FileReader();
      r.onload = () => { img.src = r.result; };
      img.onload = () => {
        const k = Math.min(1, (max || 900) / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', quality || 0.78));
      };
      img.onerror = () => rej(new Error('That picture could not be opened.')); r.onerror = rej; r.readAsDataURL(file);
    });
  }

  // Vault dial: line-art padlock inside slowly turning, ticked rings.
  // state: 'idle' (teal) | 'lock' (red) | 'ok' (green); open: shackle raised.
  function vault(el, state, open) {
    if (!el._vault) {
      const ticks = (r, n, len, w) => Array.from({ length: n }, (_, i) => {
        const a = i / n * Math.PI * 2, big = i % 5 === 0;
        const r1 = r - (big ? len * 1.8 : len);
        return `<line x1="${(100 + Math.cos(a) * r).toFixed(2)}" y1="${(100 + Math.sin(a) * r).toFixed(2)}" x2="${(100 + Math.cos(a) * r1).toFixed(2)}" y2="${(100 + Math.sin(a) * r1).toFixed(2)}" stroke-width="${big ? w * 1.6 : w}"/>`;
      }).join('');
      el.innerHTML = `<svg class="vault" viewBox="0 0 200 200" aria-hidden="true">
        <circle class="v-glow" cx="100" cy="100" r="62"/>
        <g class="v-ring v-r1"><circle cx="100" cy="100" r="94" stroke-dasharray="2 5"/></g>
        <g class="v-ring v-r2">${ticks(84, 60, 4, .8)}</g>
        <g class="v-ring v-r3"><circle cx="100" cy="100" r="70" stroke-dasharray="44 12 6 12"/></g>
        <g class="v-lock">
          <path class="v-shackle" d="M84 96V82a16 16 0 0 1 32 0v14"/>
          <rect x="74" y="94" width="52" height="40" rx="9"/>
          <circle cx="100" cy="111" r="4.2"/><path d="M100 115v8"/>
        </g></svg>`;
      el._vault = true;
    }
    const svg = el.firstElementChild;
    svg.setAttribute('class', 'vault v-' + (state || 'idle') + (open ? ' v-open' : ''));
  }

  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,!?;:'"]/g, '').trim(); }

  // key: { qid: index | 'true'/'false' | [accepted strings] }   overrides: { qid: true/false } (teacher manual marking)
  function grade(questions, key, answers, overrides) {
    answers = answers || {}; key = key || {}; overrides = overrides || {};
    let score = 0, total = 0;
    const marks = {};
    for (const q of questions) {
      const pts = Number(q.points) || 1;
      total += pts;
      const a = answers[q.id];
      let ok = false;
      if (overrides[q.id] != null) ok = !!overrides[q.id];
      else if (a == null || a === '') ok = false;
      else if (q.type === 'mc') ok = Number(a) === Number(key[q.id]);
      else if (q.type === 'tf') ok = String(a) === String(key[q.id]);
      else ok = asArray(key[q.id]).some(k => norm(k) && norm(k) === norm(a));
      marks[q.id] = ok;
      if (ok) score += pts;
    }
    return { score, total, pct: total ? Math.round(score / total * 100) : 0, marks };
  }

  // -------- synthesized UI sounds (no files needed) --------
  let actx = null;
  function ctx() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } return actx; }
  function tone(freq, dur, type, vol, when) {
    const c = ctx(); if (!c) return;
    const t = c.currentTime + (when || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol || 0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const sfx = {
    unlock() { const c = ctx(); if (c && c.state === 'suspended') c.resume(); },
    tick() { tone(1800, 0.03, 'square', 0.02); },
    key() { tone(900 + Math.random() * 400, 0.025, 'square', 0.015); },
    ok() { tone(660, 0.09, 'sine', 0.07); tone(990, 0.14, 'sine', 0.07, 0.09); },
    granted() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'triangle', 0.06, i * 0.08)); },
    // student device: short warning buzz when they come back to the test
    alarm() { for (let i = 0; i < 3; i++) { tone(880, 0.14, 'sawtooth', 0.05, i * 0.32); tone(440, 0.14, 'sawtooth', 0.05, i * 0.32 + 0.16); } },
    // teacher: emergency-broadcast attention signal (853 Hz + 960 Hz together), three long bursts
    emergency() {
      const c = ctx(); if (!c) return;
      const t0 = c.currentTime + 0.02;
      const master = c.createGain(); master.gain.value = 0.16;
      const comp = c.createDynamicsCompressor(); master.connect(comp); comp.connect(c.destination);
      for (let b = 0; b < 3; b++) {
        const s = t0 + b * 0.62, e = s + 0.5;
        const g = c.createGain();
        g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(1, s + 0.015);
        g.gain.setValueAtTime(1, e - 0.03); g.gain.linearRampToValueAtTime(0, e);
        g.connect(master);
        for (const f of [853, 960]) {
          const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f;
          const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
          const og = c.createGain(); og.gain.value = 0.32;
          o.connect(lp); lp.connect(og); og.connect(g); o.start(s); o.stop(e + 0.02);
        }
      }
    },
    join() { tone(440, 0.08, 'sine', 0.05); tone(880, 0.12, 'sine', 0.05, 0.07); },
    msg() { tone(784, 0.1, 'sine', 0.07); tone(1175, 0.16, 'sine', 0.07, 0.1); },
    select() { tone(1200, 0.05, 'sine', 0.04); },
    clunk() {
      const c = ctx(); if (!c) return;
      tone(90, 0.22, 'sine', 0.12); tone(2400, 0.03, 'square', 0.03, 0.005); tone(1600, 0.04, 'triangle', 0.04, 0.02);
    }
  };

  // Text "decrypt" scramble effect
  function scramble(el, text, dur) {
    dur = dur || 700;
    const chars = '!<>-_\\/[]{}=+*^?#ABCDEF0123456789';
    const start = performance.now();
    function frame(t) {
      const p = Math.min(1, (t - start) / dur);
      const n = Math.floor(text.length * p);
      let out = text.slice(0, n);
      for (let i = n; i < text.length; i++) out += text[i] === ' ' ? ' ' : chars[Math.floor(Math.random() * chars.length)];
      el.textContent = out;
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function toast(html, kind, ms, onClick) {
    let host = $('#toasts');
    if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '') + (onClick ? ' click' : '');
    t.innerHTML = html;
    if (onClick) t.addEventListener('click', () => { onClick(); t.remove(); });
    host.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms || 4200);
  }

  function detectBrowser() {
    const ua = navigator.userAgent;
    if (/SEB/i.test(ua)) return 'SEB';
    const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (ipad) return /CriOS/.test(ua) ? 'iPad Chrome' : 'iPad Safari';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/Android/.test(ua)) return 'Android';
    if (/Edg\//.test(ua)) return 'Edge';
    if (/Chrome/.test(ua)) return 'Chrome';
    if (/Safari/.test(ua)) return 'Safari';
    return 'Browser';
  }

  // line icons (24px grid, stroke = currentColor)
  const ICONS = {
    live: '<circle cx="12" cy="12" r="2.5"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M9.2 9.2a4 4 0 0 0 0 5.6M14.8 9.2a4 4 0 0 1 0 5.6"/>',
    tests: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8h6M9 12h6M9 16h3.5"/>',
    archive: '<rect x="3.5" y="4" width="17" height="4.5" rx="1.2"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4"/>',
    setup: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5M12 14.5v2.5"/>',
    unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2M12 14.5v2.5"/>',
    shield: '<path d="M12 3l7 3v5.5c0 4.3-3 7.8-7 9.5-4-1.7-7-5.2-7-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    chat: '<path d="M20 12.5a7.5 7.5 0 0 1-11 6.6L4 20l1-4.4A7.5 7.5 0 1 1 20 12.5z"/>',
    send: '<path d="M5 12h13M13 6l6 6-6 6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
    pause: '<path d="M9 6v12M15 6v12"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18v2"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    eyeoff: '<path d="M4 4l16 16M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3 3.6M6.3 7.6A16 16 0 0 0 2.5 12S6 18 12 18a9 9 0 0 0 4-.9"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    leave: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
    ipad: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
    laptop: '<rect x="4" y="5" width="16" height="10.5" rx="1.8"/><path d="M2.5 19h19"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    score: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19l7-7"/>',
    sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5"/>',
    out: '<path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M15 8l4 4-4 4M9 12h10"/>',
    present: '<rect x="3" y="4" width="18" height="12" rx="1.8"/><path d="M12 16v4M8.5 20h7M7.5 12l3-3 2.5 2 3.5-4"/>',
    cam: '<path d="M3.5 8a2 2 0 0 1 2-2h8.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z"/><path d="M16 10.5l4.5-2.8v8.6L16 13.5"/>',
    laser: '<circle cx="17.5" cy="6.5" r="2.2"/><path d="M4 20l9.5-9.5"/><path d="M17.5 1.8v1.4M17.5 9.8v1.4M22.2 6.5h-1.4M14.2 6.5h-1.4"/>'
  };
  const icon = (n, cls) => `<svg class="i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  // fills <i data-icon="name"></i> placeholders in static HTML
  function paintIcons(root) { $$('[data-icon]', root).forEach(el => { el.outerHTML = icon(el.dataset.icon, el.dataset.cls); }); }

  return { $, $$, esc, rid, makeCode, icon, paintIcons, splitPaper, loadImage, vault, asArray, seededOrder, fmtTime, fmtDur, clock, renderTest, grade, norm, sfx, scramble, toast, detectBrowser, LETTERS };
})();
