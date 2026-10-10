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

  // Render the test body. Used live by the student and read-only by the teacher mirror,
  // so both produce identical layout (that's what makes scroll mirroring line up).
  function renderTest(questions, order, answers, opts) {
    opts = opts || {};
    answers = answers || {};
    const byId = {};
    questions.forEach(q => { byId[q.id] = q; });
    const list = (order && order.length ? order.map(id => byId[id]).filter(Boolean) : questions);
    return list.map((q, i) => {
      const a = answers[q.id];
      let body = '';
      if (q.type === 'mc') {
        body = '<div class="opts">' + asArray(q.options).map((o, k) =>
          `<button type="button" class="opt${a === k ? ' sel' : ''}" data-q="${q.id}" data-v="${k}" ${opts.readonly ? 'tabindex="-1"' : ''}>
             <span class="opt-l">${LETTERS[k]}</span><span class="opt-t">${esc(o)}</span></button>`).join('') + '</div>';
      } else if (q.type === 'tf') {
        body = '<div class="opts tf">' + [['true', 'True · จริง'], ['false', 'False · เท็จ']].map(([v, l]) =>
          `<button type="button" class="opt${String(a) === v ? ' sel' : ''}" data-q="${q.id}" data-v="${v}" ${opts.readonly ? 'tabindex="-1"' : ''}>
             <span class="opt-l">${v === 'true' ? 'T' : 'F'}</span><span class="opt-t">${l}</span></button>`).join('') + '</div>';
      } else {
        body = `<textarea class="short" data-q="${q.id}" rows="3" placeholder="Type your answer…" ${opts.readonly ? 'readonly tabindex="-1"' : ''}>${esc(a || '')}</textarea>`;
      }
      const mark = opts.marks && opts.marks[q.id];
      const markCls = mark == null ? '' : (mark ? ' m-ok' : ' m-bad');
      return `<section class="qcard${a != null && a !== '' ? ' answered' : ''}${markCls}" data-qid="${q.id}">
        <div class="q-head"><span class="q-num">${i + 1}</span>
          <span class="q-type">${TYPE_LABEL[q.type] || ''}</span>
          <span class="q-pts">${q.points || 1} pt${(q.points || 1) > 1 ? 's' : ''}</span></div>
        <div class="q-text">${esc(q.text).replace(/\n/g, '<br>')}</div>
        ${q.image ? `<img class="q-img" src="${q.image}" alt="">` : ''}
        ${body}
      </section>`;
    }).join('');
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
    alarm() { for (let i = 0; i < 3; i++) { tone(880, 0.14, 'sawtooth', 0.05, i * 0.32); tone(440, 0.14, 'sawtooth', 0.05, i * 0.32 + 0.16); } },
    join() { tone(440, 0.08, 'sine', 0.05); tone(880, 0.12, 'sine', 0.05, 0.07); },
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

  function toast(html, kind, ms) {
    let host = $('#toasts');
    if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.innerHTML = html;
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

  return { $, $$, esc, rid, makeCode, asArray, seededOrder, fmtTime, fmtDur, clock, renderTest, grade, norm, sfx, scramble, toast, detectBrowser, LETTERS };
})();
