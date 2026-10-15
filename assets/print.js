// Printable A4 test papers and answer keys, one per set. The page opens in a new tab and the
// browser's own Print / Save as PDF does the rest, so Thai text shapes correctly (Sarabun).
window.Printer = (function () {
  const { esc, asArray, LETTERS, TYPES, TYPE_LABEL, TYPE_TH, blanksOf } = EL;

  // Matching: the right-hand column (answers + extra wrong ones) is mixed once, the same way
  // for the printed paper and the online test, so set A on paper = set A on the iPad.
  function layout(q) {
    const pairs = asArray(q.pairs).map(p => asArray(p)).filter(p => (p[0] || '').trim() && (p[1] || '').trim());
    const R0 = pairs.map(p => p[1].trim()).concat(String(q.extra || '').split('|').map(x => x.trim()).filter(Boolean));
    const order = EL.seededOrder(R0.map((_, i) => i), q.id + ':m');
    return { left: pairs.map(p => p[0].trim()), right: order.map(i => R0[i]), key: pairs.map((_, i) => order.indexOf(i)) };
  }

  const CSS = `
    @page { size: A4; margin: 15mm 14mm 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Sarabun", "Leelawadee UI", "Tahoma", sans-serif; font-size: 11.5pt; line-height: 1.5; color: #111; background: #fff; }
    .sheet { break-after: page; }
    .sheet:last-child { break-after: auto; }
    .hd { display: grid; grid-template-columns: 1fr auto; gap: 10px 18px; align-items: start; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
    .hd h1 { margin: 0; font-size: 19pt; line-height: 1.15; }
    .hd .sub { font-size: 10pt; color: #444; }
    .setbox { border: 2.5px solid #111; border-radius: 6px; padding: 2px 12px 4px; text-align: center; min-width: 76px; }
    .setbox small { display: block; font-size: 8.5pt; letter-spacing: .12em; text-transform: uppercase; }
    .setbox b { font-size: 26pt; line-height: 1; }
    .who { display: grid; grid-template-columns: 3fr 1fr 1.3fr 1.3fr; gap: 14px; margin: 4px 0 12px; font-size: 10.5pt; }
    .who span { display: flex; gap: 6px; align-items: end; white-space: nowrap; }
    .who i { flex: 1; border-bottom: 1px dotted #333; height: 1.2em; }
    .part { break-inside: avoid; margin: 14px 0 6px; padding: 5px 9px; background: #eee; border-left: 4px solid #111; font-weight: 700; }
    .part .ins { font-weight: 400; font-size: 10pt; color: #333; }
    .q { break-inside: avoid; margin: 0 0 10px; display: grid; grid-template-columns: 2.1em 1fr; }
    .q .n { font-weight: 700; }
    .q .pts { float: right; font-size: 9pt; color: #555; margin-left: 8px; }
    .q img { display: block; max-width: 70%; max-height: 62mm; margin: 5px 0; border: 1px solid #ccc; }
    .ops { display: grid; grid-template-columns: 1fr 1fr; gap: 1px 18px; margin-top: 2px; }
    .ops.one { grid-template-columns: 1fr; }
    .ops div { display: flex; gap: 6px; }
    .tfb { display: inline-block; width: 2.4em; border-bottom: 1px solid #111; margin-right: 6px; }
    .bl { display: inline-block; min-width: 30mm; border-bottom: 1px solid #111; text-align: center; font-size: 8pt; color: #888; vertical-align: baseline; }
    .lines div { border-bottom: 1px solid #999; height: 8.2mm; }
    .mt { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 22px; margin-top: 4px; }
    .mt .l, .mt .r { display: grid; gap: 3px; align-content: start; }
    .mt .l div { display: grid; grid-template-columns: 1.6em 1fr auto; gap: 4px; }
    .mt .br { white-space: nowrap; }
    .ft { margin-top: 16px; text-align: center; font-size: 9pt; color: #666; }
    .kgrid { display: grid; grid-template-columns: repeat(5, 1fr); border-top: 1px solid #111; border-left: 1px solid #111; margin: 6px 0 12px; }
    .kgrid div { border-right: 1px solid #111; border-bottom: 1px solid #111; padding: 3px 8px; display: flex; justify-content: space-between; }
    .kgrid b { font-size: 12.5pt; }
    .kq { break-inside: avoid; margin: 0 0 9px; display: grid; grid-template-columns: 2.1em 1fr; }
    .kq .a { font-weight: 700; }
    .kq .x { font-size: 9.5pt; color: #444; }
    .model { white-space: pre-wrap; border-left: 3px solid #999; padding-left: 8px; margin-top: 2px; }
    table.cl { width: 100%; border-collapse: collapse; margin-top: 8px; }
    table.cl th, table.cl td { border: 1px solid #111; padding: 4px 8px; text-align: left; }
    table.cl th { background: #eee; }
    .tip { position: fixed; top: 0; left: 0; right: 0; padding: 10px; background: #fff7d6; border-bottom: 1px solid #e0c35a; font: 14px system-ui, sans-serif; text-align: center; }
    @media print { .tip { display: none; } }
    @media screen { body { padding: 54px 24px 24px; max-width: 210mm; margin: 0 auto; } .sheet { padding-bottom: 28px; margin-bottom: 28px; border-bottom: 3px dashed #bbb; } }`;

  const INS = {
    mc: 'Circle the best answer. · วงกลมคำตอบที่ถูกที่สุดเพียงข้อเดียว',
    tf: 'Write T (true) or F (false) in the space. · เขียน T (ถูก) หรือ F (ผิด)',
    match: 'Write the letter of the matching answer in the brackets. · เขียนตัวอักษรที่จับคู่ได้ลงในวงเล็บ',
    fill: 'Fill in each blank. · เติมคำลงในช่องว่าง',
    short: 'Answer briefly. · ตอบสั้น ๆ',
    essay: 'Answer in full sentences. · ตอบอย่างละเอียด'
  };
  const txt = s => esc(s).replace(/\n/g, '<br>');
  const ptsLabel = n => n + ' pt' + (n === 1 ? '' : 's');

  function setQuestions(t, set) {
    const byId = {}; asArray(t.questions).forEach(q => { byId[q.id] = q; });
    const s = asArray(t.sets)[set];
    return s ? asArray(s.ids).map(id => byId[id]).filter(Boolean) : asArray(t.questions).filter(q => !q.sheet);
  }
  // questions grouped into parts by type, numbered straight through
  function parts(qs) {
    const out = []; let n = 0;
    TYPES.forEach(type => {
      const list = qs.filter(q => q.type === type);
      if (list.length) out.push({ type, list: list.map(q => ({ q, n: ++n })) });
    });
    return out;
  }
  function header(t, set, nSets, qs, label) {
    const total = qs.reduce((a, q) => a + (Number(q.points) || 1), 0);
    return `<div class="hd"><div><h1>${esc(t.title || 'Test')}</h1>
      <div class="sub">${label ? label + ' · ' : ''}${qs.length} questions · ${total} points${t.timeLimit ? ' · ' + t.timeLimit + ' minutes' : ''}</div></div>
      ${nSets > 1 ? `<div class="setbox"><small>Set · ชุด</small><b>${EL.setLetter(set)}</b></div>` : ''}</div>`;
  }

  function paperHTML(t, set, nSets) {
    const qs = setQuestions(t, set);
    let body = header(t, set, nSets, qs, '') +
      `<div class="who"><span>Name · ชื่อ <i></i></span><span>No. · เลขที่ <i></i></span><span>Class · ชั้น <i></i></span><span>Date · วันที่ <i></i></span></div>`;
    parts(qs).forEach((p, pi) => {
      const pts = p.list.reduce((a, x) => a + (Number(x.q.points) || 1), 0);
      body += `<div class="part">Part ${pi + 1} · ${TYPE_LABEL[p.type]} · ตอนที่ ${pi + 1} ${TYPE_TH[p.type]} <span class="ins">(${p.list.length} question${p.list.length === 1 ? '' : 's'}, ${ptsLabel(pts)}) · ${INS[p.type]}</span></div>`;
      p.list.forEach(({ q, n }) => {
        const pt = Number(q.points) || 1;
        const img = q.image ? `<img src="${q.image}" alt="">` : '';
        const ptsTag = p.type === 'essay' || p.type === 'match' || p.type === 'fill' || pt > 1 ? `<span class="pts">${ptsLabel(pt)}</span>` : '';
        let inner = '';
        if (q.type === 'mc') {
          const ops = asArray(q.options), long = ops.some(o => String(o).length > 34);
          inner = `${ptsTag}${txt(q.text)}${img}<div class="ops${long ? ' one' : ''}">${ops.map((o, k) => `<div><b>${LETTERS[k]}.</b><span>${txt(o)}</span></div>`).join('')}</div>`;
        } else if (q.type === 'tf') {
          inner = `${ptsTag}<span class="tfb"></span>${txt(q.text)}${img}`;
        } else if (q.type === 'match') {
          const L = layout(q);
          inner = `${ptsTag}${txt(q.text)}${img}<div class="mt"><div class="l">${L.left.map((l, k) => `<div><b>${k + 1}.</b><span>${txt(l)}</span><span class="br">( &nbsp;&nbsp;&nbsp; )</span></div>`).join('')}</div>
            <div class="r">${L.right.map((r, j) => `<div><b>${LETTERS[j] || j + 1}.</b> ${txt(r)}</div>`).join('')}</div></div>`;
        } else if (q.type === 'fill') {
          let k = 0;
          inner = `${ptsTag}${esc(q.text).replace(/\[\[(.*?)\]\]/g, () => `<span class="bl">(${++k})</span>`).replace(/\n/g, '<br>')}${img}`;
        } else {
          const lines = q.type === 'essay' ? Math.max(5, Math.min(16, pt * 2)) : 2;
          inner = `${ptsTag}${txt(q.text)}${img}<div class="lines">${'<div></div>'.repeat(lines)}</div>`;
        }
        body += `<div class="q"><span class="n">${n}.</span><div>${inner}</div></div>`;
      });
    });
    body += `<div class="ft">— End of test · จบข้อสอบ —</div>`;
    return `<section class="sheet">${body}</section>`;
  }

  function keyHTML(t, set, nSets) {
    const qs = setQuestions(t, set);
    let body = header(t, set, nSets, qs, 'ANSWER KEY · เฉลย');
    parts(qs).forEach((p, pi) => {
      body += `<div class="part">Part ${pi + 1} · ${TYPE_LABEL[p.type]} · ตอนที่ ${pi + 1} ${TYPE_TH[p.type]}</div>`;
      if (p.type === 'mc' || p.type === 'tf') {
        body += `<div class="kgrid">${p.list.map(({ q, n }) => `<div><span>${n}.</span><b>${q.type === 'mc' ? LETTERS[q.answer] : q.answer === 'true' ? 'T' : 'F'}</b></div>`).join('')}</div>`;
        const ex = p.list.filter(x => x.q.explain);
        ex.forEach(({ q, n }) => { body += `<div class="kq"><span>${n}.</span><div class="x">${txt(q.explain)}</div></div>`; });
        return;
      }
      p.list.forEach(({ q, n }) => {
        let a = '';
        if (q.type === 'match') { const L = layout(q); a = L.key.map((r, k) => `${k + 1} → ${LETTERS[r] || r + 1}`).join(' &nbsp; '); }
        else if (q.type === 'fill') a = blanksOf(q.text).map((acc, k) => `(${k + 1}) ${acc.map(esc).join(' / ')}`).join(' &nbsp; ');
        else if (q.type === 'short') a = String(q.answer || '').split('|').map(x => esc(x.trim())).filter(Boolean).join(' / ') || '<i>teacher marks</i>';
        else a = `<div class="model">${esc(q.model || '(no model answer written)')}</div>`;
        body += `<div class="kq"><span>${n}.</span><div>${q.type === 'essay' ? `<div class="x">${esc(String(q.text).slice(0, 140))}${String(q.text).length > 140 ? '…' : ''} · ${ptsLabel(Number(q.points) || 1)}</div>` : ''}<span class="a">${a}</span>${q.explain ? `<div class="x">${txt(q.explain)}</div>` : ''}</div></div>`;
      });
    });
    return `<section class="sheet">${body}</section>`;
  }

  function classListHTML(t, rows, totals) {
    const nSets = asArray(t.sets).length || 1;
    let body = `<div class="hd"><div><h1>${esc(t.title || 'Test')}</h1><div class="sub">Who gets which set · รายชื่อและชุดข้อสอบ</div></div></div>`;
    body += `<table class="cl"><thead><tr><th>No.</th><th>Name · ชื่อ</th><th>Set · ชุด</th><th>Score · คะแนน</th></tr></thead><tbody>` +
      rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td><b>${nSets > 1 ? EL.setLetter(r.set) : '–'}</b></td><td>${r.score != null && r.score !== '' ? esc(r.score) + ' / ' + (totals[r.set] || '') : ''}</td></tr>`).join('') + '</tbody></table>';
    return `<section class="sheet">${body}</section>`;
  }

  // blank() opens the tab straight from the click (pop-up blockers allow that), it's filled a moment later
  const blank = () => { const w = window.open('', '_blank'); if (w) w.document.write('<p style="font:16px system-ui;padding:30px">Preparing the paper…</p>'); return w; };
  function open(title, sheets, w) {
    w = w || window.open('', '_blank');
    if (!w) { EL.toast('<b>The print page was blocked.</b><br><span class="muted">Allow pop-ups for this site, then press the button again.</span>', 'red', 8000); return; }
    w.document.open();
    w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
      <style>${CSS}</style></head><body>
      <div class="tip">The print window opens by itself. Choose <b>Save as PDF</b> to keep a PDF, or your printer to print.</div>
      ${sheets.join('')}
      <script>
        const imgs = [...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }));
        Promise.all([document.fonts.ready, ...imgs]).then(() => setTimeout(() => window.print(), 250));
      <\/script></body></html>`);
    w.document.close();
  }

  const name = (t, what, set, n) => `${t.title || 'Test'}${n > 1 ? ' - Set ' + EL.setLetter(set) : ''} - ${what}`;
  return {
    layout,
    blank,
    paper(t, sets, w) { const n = asArray(t.sets).length || 1; open(sets.length === 1 ? name(t, 'Test', sets[0], n) : (t.title || 'Test') + ' - all sets', sets.map(i => paperHTML(t, i, n)), w); },
    key(t, sets, w) { const n = asArray(t.sets).length || 1; open(sets.length === 1 ? name(t, 'Answer key', sets[0], n) : (t.title || 'Test') + ' - all answer keys', sets.map(i => keyHTML(t, i, n)), w); },
    classList(t, rows, totals, w) { open((t.title || 'Test') + ' - class list', [classListHTML(t, rows, totals)], w); },
    _paperHTML: paperHTML, _keyHTML: keyHTML
  };
})();
