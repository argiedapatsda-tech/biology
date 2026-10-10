// Turns an uploaded file into a test.
//   PDF   -> page pictures (shown to students) + any typed questions found in its text
//   .docx -> typed questions found in its text (or the text itself as the test paper)
//   photo -> one page picture
// Questions are recognised from lines like "1. ..." / "ข้อ 1 ..." with choices "A. ..." / "ก. ...".
window.Importer = (function () {
  const LIBS = {
    pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    docx: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js'
  };
  const MAX_PAGES = 20;
  const loaded = {};
  function load(src) {
    if (!loaded[src]) loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src;
      s.onload = res; s.onerror = () => rej(new Error('Could not load the file reader. Check the internet connection.'));
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  const readBuf = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(f); });

  async function read(file, progress) {
    const name = file.name.toLowerCase();
    progress = progress || (() => {});
    if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|gif)$/.test(name)) {
      return { pages: [await EL.loadImage(file, 1400, 0.8)], questions: [], text: '' };
    }
    if (name.endsWith('.pdf') || file.type === 'application/pdf') return readPdf(file, progress);
    if (name.endsWith('.docx')) return readDocx(file, progress);
    if (name.endsWith('.doc')) throw new Error('Old .doc files can\'t be read. In Word, use File → Save As → .docx (or PDF), then upload that.');
    throw new Error('Please upload a PDF, a Word .docx file, or a photo.');
  }

  async function readPdf(file, progress) {
    progress('Opening the PDF…');
    await load(LIBS.pdf);
    pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
    const doc = await pdfjsLib.getDocument({ data: await readBuf(file) }).promise;
    const n = Math.min(doc.numPages, MAX_PAGES);
    const pages = [], lines = [];
    for (let i = 1; i <= n; i++) {
      progress(`Reading page ${i} of ${n}…`);
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 1100 / base.width });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      pages.push(c.toDataURL('image/jpeg', 0.72));
      lines.push(...textLines(await page.getTextContent()));
    }
    const text = lines.join('\n');
    return { pages, questions: parse(text), text };
  }
  // PDF text comes as loose pieces; group them into lines by their height on the page
  function textLines(tc) {
    const rows = [];
    for (const it of tc.items) {
      if (!it.str) continue;
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find(r => Math.abs(r.y - y) < Math.max(2.5, (it.height || 10) * 0.45));
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, s: it.str, w: it.width || 0 });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map(r => {
      r.parts.sort((a, b) => a.x - b.x);
      let out = '', end = null;
      for (const p of r.parts) { if (end != null && p.x - end > 1.5 && !/\s$/.test(out) && !/^\s/.test(p.s)) out += ' '; out += p.s; end = p.x + p.w; }
      return out.replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
  }

  async function readDocx(file, progress) {
    progress('Opening the Word file…');
    await load(LIBS.docx);
    const r = await mammoth.extractRawText({ arrayBuffer: await readBuf(file) });
    const text = (r.value || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    return { pages: [], questions: parse(text), text };
  }

  // ---------------------------------------------------------------- question finder
  const Q_RE = /^\s*(?:ข้อ(?:ที่)?\s*|Q(?:uestion)?\s*)?(\d{1,3})\s*[.)\]:：]\s*(.+)$/i;
  const Q_RE2 = /^\s*ข้อ(?:ที่)?\s*(\d{1,3})\s+(.+)$/;
  const OPT_RE = /^\s*\(?([A-Fa-f]|[กขคงจ])\s*[.)\]:：]\s*(.*)$/;
  const ANS_RE = /^\s*(?:answer|ans|correct answer|ตอบ|เฉลย|คำตอบ)\s*[:：.\-=]?\s*\(?([A-Fa-f]|[กขคงจ]|true|false|ถูก|ผิด)\)?\s*$/i;
  const THAI = 'กขคงจ';
  const idx = l => { const t = THAI.indexOf(l); return t >= 0 ? t : 'abcdef'.indexOf(l.toLowerCase()); };
  // "A. cell B. tissue C. organ" on one line
  function inlineOpts(s) {
    const re = /(?:^|\s)\(?([A-Fa-f]|[กขคงจ])[.)]\s+/g, hits = [];
    let m; while ((m = re.exec(s))) hits.push({ i: m.index + (m[0].startsWith(' ') ? 1 : 0), end: re.lastIndex, l: m[1] });
    if (hits.length < 2 || idx(hits[0].l) !== 0) return null;
    for (let k = 0; k < hits.length; k++) if (idx(hits[k].l) !== k) return null;
    return { before: s.slice(0, hits[0].i).trim(), opts: hits.map((h, k) => s.slice(h.end, k + 1 < hits.length ? hits[k + 1].i : s.length).trim()) };
  }

  function parse(text) {
    const out = [];
    let cur = null, lastOpt = -1, expect = 1;
    const finish = () => {
      if (!cur) return;
      cur.text = cur.text.replace(/\s+/g, ' ').trim();
      if (cur.text) out.push(cur);
      cur = null;
    };
    for (const raw of String(text || '').split('\n')) {
      const line = raw.replace(/ /g, ' ').trim();
      if (!line) continue;
      const a = line.match(ANS_RE);
      if (a && cur) { cur.ans = a[1]; continue; }
      const q = line.match(Q_RE) || line.match(Q_RE2);
      // a new number that follows on (1, 2, 3 …) starts a question; a stray number does not
      if (q && (Number(q[1]) === expect || (Number(q[1]) === expect + 1 && out.length))) {
        finish();
        expect = Number(q[1]) + 1;
        cur = { num: Number(q[1]), text: q[2], opts: [] }; lastOpt = -1;
        const inl = inlineOpts(cur.text);
        if (inl) { cur.text = inl.before; cur.opts = inl.opts; lastOpt = inl.opts.length - 1; }
        continue;
      }
      if (!cur) continue;
      const inl = inlineOpts(line);
      if (inl && !inl.before && idx(line.trim().replace(/^\(/, '')[0]) === cur.opts.length) { cur.opts.push(...inl.opts); lastOpt = cur.opts.length - 1; continue; }
      const o = line.match(OPT_RE);
      if (o && idx(o[1]) === cur.opts.length) { cur.opts.push(o[2]); lastOpt = cur.opts.length - 1; continue; }
      if (lastOpt >= 0) cur.opts[lastOpt] += ' ' + line; else cur.text += ' ' + line;
    }
    finish();
    if (out.length < 2) return [];
    return out.map(c => {
      const opts = c.opts.map(o => o.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const tf = opts.length === 2 && /^(true|ถูก)$/i.test(opts[0]) && /^(false|ผิด)$/i.test(opts[1]);
      if (tf || (!opts.length && c.ans && /^(true|false|ถูก|ผิด)$/i.test(c.ans))) {
        const known = c.ans && /^(true|false|ถูก|ผิด|a|b|ก|ข)$/i.test(c.ans);
        return { type: 'tf', text: c.text, answer: known ? (/^(true|ถูก|a|ก)$/i.test(c.ans) ? 'true' : 'false') : 'true', needKey: !known };
      }
      if (opts.length >= 2) {
        const k = c.ans ? idx(c.ans) : -1;
        return { type: 'mc', text: c.text, options: opts.slice(0, 6), answer: k >= 0 && k < opts.length ? k : 0, needKey: !(k >= 0 && k < opts.length) };
      }
      return { type: 'short', text: c.text, answer: '' };
    });
  }

  // ---------------------------------------------------------------- slides for a presentation
  // A browser can't open .pptx, so PowerPoint decks come in as PDF (File → Export → PDF).
  // Every page becomes one sharp picture; WebP where the browser can make it (half the size of JPEG).
  const SLIDE_W = 1600, MAX_SLIDES = 150;
  function slidePic(c) {
    const w = c.toDataURL('image/webp', 0.8);
    return w.startsWith('data:image/webp') ? w : c.toDataURL('image/jpeg', 0.8);
  }
  function fileToCanvas(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, SLIDE_W / img.width), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(file.name + ' could not be opened.')); };
      img.src = url;
    });
  }
  async function readSlides(files, progress) {
    progress = progress || (() => {});
    files = Array.from(files || []);
    if (!files.length) throw new Error('No file chosen.');
    const bad = files.find(f => /\.(pptx?|key|odp)$/i.test(f.name));
    if (bad) throw new Error('PowerPoint files can\'t be opened in a web browser. In PowerPoint press File → Export → Create PDF, then upload the PDF. (Google Slides: File → Download → PDF.)');
    const slides = [];
    for (const f of files) {
      const name = f.name.toLowerCase();
      if (name.endsWith('.pdf') || f.type === 'application/pdf') {
        progress('Opening the PDF…');
        await load(LIBS.pdf);
        pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
        const doc = await pdfjsLib.getDocument({ data: await readBuf(f) }).promise;
        const n = Math.min(doc.numPages, MAX_SLIDES - slides.length);
        for (let i = 1; i <= n; i++) {
          progress(`Making slide ${slides.length + 1} (page ${i} of ${n})…`);
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: SLIDE_W / Math.max(base.width, base.height * 16 / 9) });
          const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: g, viewport: vp }).promise;
          slides.push(slidePic(c));
        }
      } else if (f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/.test(name)) {
        progress(`Adding picture ${slides.length + 1}…`);
        slides.push(slidePic(await fileToCanvas(f)));
      } else throw new Error(f.name + ': please upload a PDF of the slides or pictures.');
      if (slides.length >= MAX_SLIDES) break;
    }
    return slides;
  }

  return { read, parse, readSlides };
})();
