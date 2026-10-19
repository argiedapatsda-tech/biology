// Draw on a question picture right in the editor: pen, arrow, box, cover-up (hide a label), text, numbers.
// Draw.open(dataURL or null) -> Promise<new JPEG dataURL | null>. null picture = blank white page.
// Everything drawn is kept as a list of marks until Done, so Undo / Redo / Start over work; Done flattens it.
window.Draw = (function () {
  const COLORS = ['#e53935', '#1e63d6', '#13a35b', '#111111', '#ffffff', '#ff9800'];
  const SIZES = { thin: 1, mid: 2, thick: 4 };
  const TOOLS = [
    ['pen', '✎', 'Pen'], ['line', '╱', 'Line'], ['arrow', '➜', 'Arrow'], ['box', '▭', 'Box'],
    ['cover', '■', 'Cover up (hide a label)'], ['text', 'T', 'Text'], ['num', '①', 'Number labels'], ['erase', '⌫', 'Rub out a mark']
  ];
  let ui = null, S = null;

  function build() {
    const d = document.createElement('div');
    d.id = 'drawModal'; d.className = 'modal hidden';
    d.innerHTML = `<div class="draw-box">
      <div class="draw-bar">
        <div class="draw-tools">${TOOLS.map(([t, ic, tip]) => `<button type="button" class="dt-btn" data-tool="${t}" title="${tip}"><b>${ic}</b><span>${tip.split(' (')[0]}</span></button>`).join('')}</div>
        <div class="draw-colors">${COLORS.map(c => `<button type="button" class="dc-btn" data-color="${c}" style="--c:${c}" title="Colour"></button>`).join('')}</div>
        <div class="draw-sizes">${Object.keys(SIZES).map(s => `<button type="button" class="ds-btn" data-size="${s}" title="${s === 'mid' ? 'Medium' : s[0].toUpperCase() + s.slice(1)}"><i style="--w:${SIZES[s] * 3}px"></i></button>`).join('')}</div>
        <div class="draw-acts"><button type="button" class="btn sm" data-da="undo">Undo</button><button type="button" class="btn sm" data-da="redo">Redo</button><button type="button" class="btn sm" data-da="clear">Start over</button></div>
      </div>
      <div class="draw-stage"><div class="draw-wrap"><canvas id="drawCv"></canvas><input id="drawTxt" class="draw-txt hidden" type="text" placeholder="Type, then Enter"></div></div>
      <div class="draw-foot"><span class="eq-hint" id="drawHint"></span><div class="modal-actions"><button type="button" class="btn" data-da="cancel">Cancel</button><button type="button" class="btn primary" data-da="done">Done</button></div></div>
    </div>`;
    document.body.appendChild(d);
    const cv = d.querySelector('#drawCv');
    ui = { d, cv, g: cv.getContext('2d'), txt: d.querySelector('#drawTxt'), hint: d.querySelector('#drawHint') };

    d.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tool) { commitText(); S.tool = b.dataset.tool; paintBar(); }
      else if (b.dataset.color) { S.color = b.dataset.color; paintBar(); }
      else if (b.dataset.size) { S.size = b.dataset.size; paintBar(); }
      else if (b.dataset.da === 'undo') { commitText(); if (S.marks.length) { S.redo.push(S.marks.pop()); redraw(); } }
      else if (b.dataset.da === 'redo') { if (S.redo.length) { S.marks.push(S.redo.pop()); redraw(); } }
      else if (b.dataset.da === 'clear') { commitText(); if (S.marks.length) { S.redo = []; S.marks = []; redraw(); } }
      else if (b.dataset.da === 'cancel') close(null);
      else if (b.dataset.da === 'done') { commitText(); close(S.marks.length || !S.hadImage ? flatten() : null); }
    });
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    ui.txt.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitText(); } if (e.key === 'Escape') { ui.txt.classList.add('hidden'); S.typing = null; } });
    document.addEventListener('keydown', e => {
      if (!S || d.classList.contains('hidden') || e.target === ui.txt) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); d.querySelector(`[data-da=${e.shiftKey ? 'redo' : 'undo'}]`).click(); }
      if (e.key === 'Escape') close(null);
    });
    window.addEventListener('resize', () => S && fit());
  }

  const HINT = {
    pen: 'Draw with the mouse, a finger or an Apple Pencil.', line: 'Drag to draw a straight line.', arrow: 'Drag from the tail to the point.',
    box: 'Drag to draw a box around something.', cover: 'Drag over a label to hide it, so students must name the part.',
    text: 'Click where the words should go, type, then press Enter.', num: 'Click to drop numbers 1, 2, 3 … onto the parts.', erase: 'Click on a mark to rub it out.'
  };
  function paintBar() {
    ui.d.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === S.tool));
    ui.d.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('on', b.dataset.color === S.color));
    ui.d.querySelectorAll('[data-size]').forEach(b => b.classList.toggle('on', b.dataset.size === S.size));
    ui.hint.textContent = HINT[S.tool];
    ui.cv.style.cursor = S.tool === 'text' ? 'text' : S.tool === 'erase' ? 'pointer' : 'crosshair';
  }

  // the canvas keeps the picture's real size; CSS shrinks it to fit the screen
  function fit() {
    const st = ui.d.querySelector('.draw-stage'), W = st.clientWidth - 8, H = st.clientHeight - 8;
    const k = Math.min(W / S.w, H / S.h, 2);
    ui.cv.style.width = Math.floor(S.w * k) + 'px'; ui.cv.style.height = Math.floor(S.h * k) + 'px';
  }
  const pt = e => { const r = ui.cv.getBoundingClientRect(); return [(e.clientX - r.left) * S.w / r.width, (e.clientY - r.top) * S.h / r.height]; };
  const unit = () => Math.max(S.w, S.h) / 320;

  function down(e) {
    e.preventDefault();
    const p = pt(e);
    if (S.tool === 'text') { startText(p); return; }
    commitText();
    if (S.tool === 'erase') { const k = hit(p); if (k >= 0) { S.redo = []; S.redo.push(S.marks.splice(k, 1)[0]); redraw(); } return; }
    if (S.tool === 'num') { S.marks.push({ t: 'num', p, n: S.marks.filter(m => m.t === 'num').length + 1, c: S.color, s: SIZES[S.size] }); S.redo = []; redraw(); return; }
    ui.cv.setPointerCapture(e.pointerId);
    S.cur = { t: S.tool, c: S.tool === 'cover' ? '#ffffff' : S.color, s: SIZES[S.size], pts: [p, p] };
  }
  function move(e) {
    if (!S || !S.cur) return;
    e.preventDefault();
    const p = pt(e);
    if (S.cur.t === 'pen') S.cur.pts.push(p); else S.cur.pts[1] = p;
    redraw();
  }
  function up() {
    if (!S || !S.cur) return;
    const m = S.cur, [a, b] = [m.pts[0], m.pts[m.pts.length - 1]];
    S.cur = null;
    if (m.t !== 'pen' && Math.hypot(b[0] - a[0], b[1] - a[1]) < unit() * 2) { redraw(); return; } // a tap, not a drag
    S.marks.push(m); S.redo = []; redraw();
  }

  function startText(p) {
    commitText();
    const r = ui.cv.getBoundingClientRect(), k = r.width / S.w;
    S.typing = p;
    Object.assign(ui.txt.style, { left: p[0] * k + 'px', top: p[1] * k + 'px', color: S.color, fontSize: Math.max(14, unit() * 7 * SIZES[S.size] ** 0.5 * k) + 'px' });
    ui.txt.value = ''; ui.txt.classList.remove('hidden');
    setTimeout(() => ui.txt.focus(), 0);
  }
  function commitText() {
    if (!S || !S.typing) return;
    const v = ui.txt.value.trim();
    if (v) { S.marks.push({ t: 'text', p: S.typing, v, c: S.color, s: SIZES[S.size] }); S.redo = []; }
    S.typing = null; ui.txt.classList.add('hidden'); redraw();
  }

  // rough bounding box of each mark, so "rub out" can find the one clicked (last drawn wins)
  function bbox(m) {
    const u = unit();
    if (m.t === 'text') { ui.g.font = font(m); const w = ui.g.measureText(m.v).width; return [m.p[0], m.p[1], m.p[0] + w, m.p[1] + u * 7 * m.s ** 0.5 * 1.2]; }
    if (m.t === 'num') { const r = u * 6 * m.s ** 0.4; return [m.p[0] - r, m.p[1] - r, m.p[0] + r, m.p[1] + r]; }
    const xs = m.pts.map(p => p[0]), ys = m.pts.map(p => p[1]), pad = u * 3 * m.s;
    return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  }
  function hit(p) {
    for (let k = S.marks.length - 1; k >= 0; k--) { const b = bbox(S.marks[k]); if (p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]) return k; }
    return -1;
  }

  const font = m => `700 ${unit() * 7 * m.s ** 0.5}px "Chakra Petch", "IBM Plex Sans Thai", Arial, sans-serif`;
  function paint(g, m) {
    const u = unit(), lw = u * 1.2 * m.s;
    g.save(); g.strokeStyle = g.fillStyle = m.c; g.lineWidth = lw; g.lineCap = g.lineJoin = 'round';
    const [a, b] = [m.pts ? m.pts[0] : null, m.pts ? m.pts[m.pts.length - 1] : null];
    if (m.t === 'pen') { g.beginPath(); m.pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); if (m.pts.length < 3) g.lineTo(a[0] + .1, a[1]); g.stroke(); }
    else if (m.t === 'line' || m.t === 'arrow') {
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      if (m.t === 'arrow') { const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = Math.max(lw * 4.5, u * 9); g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[0] - h * Math.cos(ang - .45), b[1] - h * Math.sin(ang - .45)); g.lineTo(b[0] - h * Math.cos(ang + .45), b[1] - h * Math.sin(ang + .45)); g.closePath(); g.fill(); }
    }
    else if (m.t === 'box') g.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    else if (m.t === 'cover') { g.fillStyle = '#ffffff'; g.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = u * .6; g.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); }
    else if (m.t === 'text') { g.font = font(m); g.textBaseline = 'top'; g.lineWidth = u * 1.6; g.strokeStyle = m.c === '#ffffff' ? '#000' : '#fff'; g.strokeText(m.v, m.p[0], m.p[1]); g.fillText(m.v, m.p[0], m.p[1]); }
    else if (m.t === 'num') {
      const r = u * 6 * m.s ** 0.4;
      g.beginPath(); g.arc(m.p[0], m.p[1], r, 0, Math.PI * 2); g.fill();
      g.fillStyle = m.c === '#ffffff' ? '#111' : '#fff'; g.font = `700 ${r * 1.2}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(m.n), m.p[0], m.p[1] + r * .06);
    }
    g.restore();
  }
  function redraw() {
    const g = ui.g;
    g.fillStyle = '#fff'; g.fillRect(0, 0, S.w, S.h);
    if (S.img) g.drawImage(S.img, 0, 0, S.w, S.h);
    S.marks.forEach(m => paint(g, m));
    if (S.cur) paint(g, S.cur);
  }
  function flatten() { S.cur = null; redraw(); return ui.cv.toDataURL('image/jpeg', 0.82); }

  function close(v) {
    ui.d.classList.add('hidden'); ui.txt.classList.add('hidden');
    const r = S.resolve; S = null; r(v);
  }

  function open(src) {
    if (!ui) build();
    return new Promise(resolve => {
      const go = img => {
        S = { resolve, img, hadImage: !!img, w: img ? img.naturalWidth : 900, h: img ? img.naturalHeight : 600, marks: [], redo: [], cur: null, typing: null,
          tool: 'pen', color: COLORS[0], size: 'mid' };
        ui.cv.width = S.w; ui.cv.height = S.h;
        ui.d.classList.remove('hidden');
        paintBar(); fit(); redraw();
      };
      if (!src) return go(null);
      const img = new Image();
      img.onload = () => go(img);
      img.onerror = () => go(null);
      img.src = src;
    });
  }
  return { open };
})();
