// "Make from paper": the teacher uploads a paper, AI writes questions + answers, and they land in
// the normal editor to check. Two ways to run the AI, both free for the teacher:
//   A. Google Gemini with the teacher's own free key (kept only in this browser), one click
//   B. Claude Pro: copy the instructions, paste them into claude.ai with the file, paste the reply back
// Pictures: the AI says which page and which area; the page is cut out here (and can be re-cut by hand).
window.Maker = (function () {
  const { $, $$, esc, asArray, icon } = EL;
  const KEY = 'el-gemini-key', MODEL = 'el-gemini-model';
  const store = { get: k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} } };
  const MK = { src: null, hooks: null };
  const DEF = { mc: 10, tf: 5, match: 1, fill: 5, short: 3, essay: 1 };
  const LBL = { mc: 'Multiple choice', tf: 'True / false', match: 'Matching (sets of pairs)', fill: 'Fill in the blanks', short: 'Short answer', essay: 'Essay' };

  // ---------------------------------------------------------------- reading the paper
  const readB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
  const readBuf = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(f); });
  async function readPaper(files, progress) {
    files = Array.from(files || []);
    if (!files.length) throw new Error('No file chosen.');
    const isImg = f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(f.name);
    if (files.some(f => /\.(pptx?|doc)$/i.test(f.name))) throw new Error('Please save it as PDF (or .docx for Word) first, then upload that.');
    if (files.every(isImg)) {
      const pages = [];
      for (const f of files.slice(0, 20)) { progress(`Reading photo ${pages.length + 1} of ${Math.min(20, files.length)}…`); pages.push(await EL.loadImage(f, 1600, 0.85)); }
      return { kind: 'images', name: files.length === 1 ? files[0].name : files.length + ' photos', pages, pics: [], text: '' };
    }
    if (files.length > 1) throw new Error('Upload one PDF or one Word file at a time (several photos are fine).');
    const f = files[0];
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
      if (f.size > 18 * 1024 * 1024) throw new Error('This PDF is over 18 MB. Save just the pages you need as a new PDF and upload that.');
      progress('Opening the PDF…');
      await Importer.load(Importer.LIBS.pdf);
      pdfjsLib.GlobalWorkerOptions.workerSrc = Importer.LIBS.pdfWorker;
      const doc = await pdfjsLib.getDocument({ data: await readBuf(f) }).promise;
      const n = Math.min(doc.numPages, 40), pages = [];
      for (let i = 1; i <= n; i++) {
        progress(`Reading page ${i} of ${n}…`);
        const page = await doc.getPage(i), base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 1400 / base.width });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: vp }).promise;
        pages.push(c.toDataURL('image/jpeg', 0.8));
      }
      return { kind: 'pdf', name: f.name, pdf: await readB64(f), pages, pics: [], text: '', more: doc.numPages > n ? doc.numPages : 0 };
    }
    if (/\.docx$/i.test(f.name)) {
      progress('Opening the Word file…');
      await Importer.load(Importer.LIBS.docx);
      const buf = await readBuf(f);
      const html = (await mammoth.convertToHtml({ arrayBuffer: buf })).value || '';
      const text = ((await mammoth.extractRawText({ arrayBuffer: buf })).value || '').replace(/\n{3,}/g, '\n\n').trim();
      const pics = [];
      for (const m of html.matchAll(/<img[^>]+src="(data:image\/[^"]+)"/g)) {
        try { pics.push(await shrink(m[1], 1200)); } catch (e) {}
        if (pics.length >= 30) break;
      }
      if (!text && !pics.length) throw new Error('That Word file looks empty.');
      return { kind: 'docx', name: f.name, pages: [], pics, text };
    }
    throw new Error('Please upload a PDF, a Word .docx file, or photos.');
  }
  function shrink(src, max) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = rej; img.src = src;
    });
  }
  // cut a box (percent of the page) out of a page picture
  function crop(pageSrc, box, max) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        let [x1, y1, x2, y2] = asArray(box).map(Number);
        if (![x1, y1, x2, y2].every(isFinite)) return rej(new Error('bad box'));
        // accept 0-1 fractions too
        if (Math.max(x1, y1, x2, y2) <= 1) { x1 *= 100; y1 *= 100; x2 *= 100; y2 *= 100; }
        const cl = v => Math.max(0, Math.min(100, v));
        [x1, x2] = [cl(Math.min(x1, x2)), cl(Math.max(x1, x2))]; [y1, y2] = [cl(Math.min(y1, y2)), cl(Math.max(y1, y2))];
        const sx = img.width * x1 / 100, sy = img.height * y1 / 100, sw = img.width * (x2 - x1) / 100, sh = img.height * (y2 - y1) / 100;
        if (sw < 8 || sh < 8) return rej(new Error('box too small'));
        const k = Math.min(1, (max || 900) / Math.max(sw, sh)), c = document.createElement('canvas');
        c.width = Math.round(sw * k); c.height = Math.round(sh * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = rej; img.src = pageSrc;
    });
  }

  // ---------------------------------------------------------------- the instructions for the AI
  function wanted() {
    const w = {}; $$('#mkTypes input').forEach(i => { w[i.dataset.type] = Math.max(0, Math.min(60, Math.round(Number(i.value) || 0))); });
    return w;
  }
  function buildPrompt(forClaude) {
    const w = wanted(), src = MK.src;
    const lang = { same: 'Write in the same language as the paper.', th: 'Write everything in Thai.', en: 'Write everything in English.', both: 'Write each question in Thai, then the English underneath on a new line (choices too, as "ไทย / English").' }[$('#mkLang').value];
    const level = { easy: 'Level: easy, checking basic understanding and key words.', mixed: 'Level: mixed, about one third easy recall, one third understanding, one third applying ideas to new situations.', hard: 'Level: hard, Thai TCAS / A-Level biology style: application, data and diagram reading, situations, plausible distractors.' }[$('#mkLevel').value];
    const list = Object.keys(w).filter(t => w[t] > 0).map(t => `- ${w[t]} ${{ mc: 'multiple-choice questions (4 choices, exactly one correct)', tf: 'true/false statements (mix true and false about evenly)', match: 'matching questions (each with 4-6 pairs plus 1-2 extra wrong options)', fill: 'fill-in-the-blank sentences', short: 'short-answer questions (answer is a word or short phrase)', essay: 'essay questions (with a model answer)' }[t]}`).join('\n');
    const pic = src && src.kind === 'docx'
      ? `- The Word file's pictures are numbered 1, 2, 3 … in order (${src.pics.length} pictures). If a question needs one, add "picture": {"image": <number>}.`
      : `- If a question needs a diagram or picture from the paper, add "picture": {"page": <page number, 1 = first ${src && src.kind === 'images' ? 'photo' : 'page'}>, "box": [left, top, right, bottom]} where the box is the picture's area in percent (0-100) of that page's width and height. Box the whole picture with its labels, tightly. Never box plain text.`;
    return `You are helping a high-school biology teacher in Thailand. ${forClaude ? 'The attached file is' : 'The file below is'} their teaching material ("${src ? src.name : 'the paper'}"). Make a NEW test from it.

Make exactly:
${list || '- 10 multiple-choice questions'}

${lang}
${level}

Rules:
- Every question must be answerable from the paper and every answer must be correct. Check each one twice.
- Multiple choice: the wrong choices must look believable. Spread the correct letter across A, B, C and D.
- Fill in the blanks: put each missing word in double square brackets inside the sentence, e.g. "Plants make glucose by [[photosynthesis]]." Use 1-3 blanks per sentence, each a key word or short term. Give other accepted spellings with |, e.g. [[ATP|adenosine triphosphate]].
- Short answer: list every answer that should be accepted.
- Essay: write a model answer, give points (3-10) and say what earns the marks inside the model answer.
- Add a one-sentence "explain" for multiple-choice and true/false answers.
${pic}
- Do not number the questions and do not put letters in front of choices.

Reply with ONLY this JSON (no other text):
{
  "title": "short test title",
  "questions": [
    {"type": "mc", "q": "question", "choices": ["…", "…", "…", "…"], "answer": "B", "explain": "why"},
    {"type": "tf", "q": "statement", "answer": true, "explain": "why"},
    {"type": "match", "q": "Match each … with …", "pairs": [["left", "right"], ["left", "right"]], "extra": ["wrong option"]},
    {"type": "fill", "q": "The [[nucleus]] controls the cell."},
    {"type": "short", "q": "question", "answers": ["answer", "other accepted answer"]},
    {"type": "essay", "q": "question", "points": 6, "model": "model answer and how marks are given"}
  ]
}${!forClaude && src && src.kind === 'docx' ? '\n\nTHE PAPER (text of the Word file):\n' + src.text.slice(0, 120000) : ''}`;
  }

  // ---------------------------------------------------------------- Gemini (free key from Google AI Studio)
  const API = 'https://generativelanguage.googleapis.com/v1beta';
  async function pickModel(key) {
    const cached = store.get(MODEL); if (cached) return cached;
    const r = await fetch(API + '/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    if (!r.ok) throw await gemErr(r);
    const list = asArray((await r.json()).models).filter(m => asArray(m.supportedGenerationMethods).includes('generateContent')).map(m => String(m.name).replace(/^models\//, ''));
    const ok = list.filter(n => /^gemini-/.test(n) && /flash/.test(n) && !/(lite|image|tts|audio|live|thinking-exp|embedding|8b)/.test(n));
    const ver = n => { const m = n.match(/gemini-(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : 0; };
    const stable = ok.filter(n => !/(preview|exp)/.test(n));
    const pick = ok.includes('gemini-flash-latest') ? 'gemini-flash-latest'
      : (stable.sort((a, b) => ver(b) - ver(a))[0] || ok.sort((a, b) => ver(b) - ver(a))[0] || 'gemini-2.5-flash');
    store.set(MODEL, pick);
    return pick;
  }
  async function gemErr(r) {
    let msg = ''; try { const j = await r.json(); msg = (j.error && j.error.message) || ''; } catch (e) {}
    if (r.status === 400 && /api key|API_KEY/i.test(msg)) return new Error("That key doesn't work. Copy it again from Google AI Studio and paste it in.");
    if (r.status === 400 && /location|region|country/i.test(msg)) return new Error("Google doesn't allow free Gemini from this location. Use the Claude way below instead.");
    if (r.status === 403) return new Error("Google refused this key. Make a new key in Google AI Studio and paste it in.");
    if (r.status === 429) return new Error("Gemini's free limit is used up for now. Wait a minute and try again, or use the Claude way below.");
    if (r.status >= 500) return new Error('Gemini is busy right now. Try again in a minute.');
    const e = new Error('Gemini said: ' + (msg || r.status)); e.status = r.status; return e;
  }
  async function gemini(key, prompt, src) {
    const parts = [{ text: prompt }];
    if (src.kind === 'pdf') parts.push({ inline_data: { mime_type: 'application/pdf', data: src.pdf } });
    if (src.kind === 'images') src.pages.forEach((d, i) => { parts.push({ text: 'Photo ' + (i + 1) + ':' }, { inline_data: { mime_type: 'image/jpeg', data: d.split(',')[1] } }); });
    if (src.kind === 'docx') src.pics.forEach((d, i) => { parts.push({ text: 'Picture ' + (i + 1) + ':' }, { inline_data: { mime_type: 'image/jpeg', data: d.split(',')[1] } }); });
    const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 32768 } });
    for (let attempt = 0; attempt < 2; attempt++) {
      const model = await pickModel(key);
      const r = await fetch(`${API}/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body });
      if (r.status === 404 && attempt === 0) { store.set(MODEL, ''); continue; }   // that model was retired: pick again
      if (!r.ok) throw await gemErr(r);
      const j = await r.json();
      const c = asArray(j.candidates)[0];
      if (!c) throw new Error('Gemini gave no answer' + (j.promptFeedback && j.promptFeedback.blockReason ? ' (blocked: ' + j.promptFeedback.blockReason + ')' : '') + '. Try again or use Claude.');
      const text = asArray(c.content && c.content.parts).map(p => p.text || '').join('');
      if (c.finishReason === 'MAX_TOKENS') throw new Error('Too many questions for one go. Ask for fewer (for example half), then make the rest in a second go.');
      if (!text) throw new Error('Gemini stopped early (' + (c.finishReason || 'no text') + '). Try again or use Claude.');
      return text;
    }
  }

  // ---------------------------------------------------------------- reply -> questions (+ pictures)
  async function toQuestions(replyText) {
    const v = EL.readJSON(replyText);
    const qs = EL.fromAI(v.questions || v.items || v.test || []);
    if (!qs.length) throw new Error("No questions found in that reply. Make sure you copied all of it.");
    const src = MK.src;
    let pics = 0;
    for (const q of qs) {
      const p = q.src; delete q.src;
      if (!p || !src) continue;
      try {
        if (p.image != null && src.pics[Number(p.image) - 1]) { q.image = src.pics[Number(p.image) - 1]; pics++; }
        else if (p.page != null && src.pages[Number(p.page) - 1] && p.box) {
          q.image = await crop(src.pages[Number(p.page) - 1], p.box, 900);
          q.src = { page: Number(p.page), box: asArray(p.box).map(Number) }; pics++;
        }
      } catch (e) { /* a bad box just means no picture; the teacher can add one */ }
    }
    return { title: String(v.title || '').trim(), questions: qs, pics };
  }

  // ---------------------------------------------------------------- page
  function renderTypes() {
    $('#mkTypes').innerHTML = EL.TYPES.map(t => `<label class="mk-type"><span>${LBL[t]}</span><input class="input sm" type="number" min="0" max="60" data-type="${t}" value="${DEF[t]}"></label>`).join('');
    total();
  }
  function total() {
    const w = wanted(), n = Object.values(w).reduce((a, b) => a + b, 0);
    $('#mkTotal').textContent = n ? `${n} questions in total. Ask for more than you need: you choose how many each student answers.` : 'Choose at least one question.';
  }
  function renderKey() {
    const k = store.get(KEY);
    $('#mkKeyBox').innerHTML = k
      ? `<div class="mk-keyok">${icon('check')}<span>Your free Gemini key is saved in this browser.</span><button class="btn sm ghost" id="mkKeyChange" type="button">Change</button></div>`
      : `<ol class="pr-steps small"><li>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> and sign in with Gmail.</li><li>Press <b>Create API key</b> and copy it.</li><li>Paste it here. It stays only in this browser.</li></ol>
         <div class="mk-keyrow"><input class="input sm" id="mkKey" type="password" placeholder="Paste your key (starts with AIza…)" autocomplete="off"><button class="btn sm" id="mkKeySave" type="button">Save</button></div>`;
  }
  function renderSrc() {
    const s = MK.src;
    if (!s) { $('#mkSrc').innerHTML = 'Nothing chosen yet.'; return; }
    const what = s.kind === 'pdf' ? `${s.pages.length} page${s.pages.length === 1 ? '' : 's'}${s.more ? ` (first ${s.pages.length} of ${s.more})` : ''}` : s.kind === 'images' ? `${s.pages.length} photo${s.pages.length === 1 ? '' : 's'}` : `Word file · ${s.pics.length} picture${s.pics.length === 1 ? '' : 's'}`;
    const thumbs = (s.pages.length ? s.pages : s.pics).slice(0, 12);
    $('#mkSrc').innerHTML = `<div><b>${esc(s.name)}</b><div class="small muted">${what}</div></div>${thumbs.length ? `<div class="mk-thumbs">${thumbs.map((src, i) => `<figure><img src="${src}" alt=""><figcaption>${i + 1}</figcaption></figure>`).join('')}</div>` : ''}`;
  }
  function needSrc() { if (!MK.src) { EL.toast('Choose your paper first (step 1).', 'amber'); return false; } return true; }
  function showResult(r, how) {
    MK.last = r;
    const by = {}; r.questions.forEach(q => { by[q.type] = (by[q.type] || 0) + 1; });
    const need = r.questions.filter(q => q.needKey).length;
    const hasOpen = MK.hooks.editing();
    $('#mkResult').innerHTML = `<div class="mk-res-h">${icon('check')}<div><b>${how} made ${r.questions.length} questions</b><div class="small muted">${EL.TYPES.filter(t => by[t]).map(t => by[t] + ' ' + EL.TYPE_LABEL[t].toLowerCase()).join(' · ')}${r.pics ? ` · ${r.pics} with a picture from the paper` : ''}${need ? ` · <b style="color:var(--amber)">${need} need you to tick the answer</b>` : ''}</div></div></div>
      <p class="small muted" style="margin:0">AI can make mistakes. Check each question and answer in the editor before you start the test.</p>
      <div class="mk-res-b"><button class="btn primary" data-mk="new" type="button">Open as a new test</button>${hasOpen ? `<button class="btn" data-mk="add" type="button">Add to “${esc(hasOpen.title || 'the open test')}”</button>` : ''}</div>`;
    $('#mkResult').classList.remove('hidden');
    $('#mkResult').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function init(hooks) {
    MK.hooks = hooks;
    renderTypes(); renderKey();
    $('#mkTypes').addEventListener('input', total);
    $('#mkFile').addEventListener('change', async e => {
      const files = Array.from(e.target.files || []); e.target.value = '';   // copy first: clearing the input empties its list
      if (!files.length) return;
      try { MK.src = await readPaper(files, t => hooks.busy(t)); renderSrc(); }
      catch (ex) { console.error(ex); EL.toast('<b>Could not read that.</b><br><span class="muted">' + esc(ex.message || ex) + '</span>', 'red', 9000); }
      finally { hooks.busy(''); }
    });
    $('#mkKeyBox').addEventListener('click', e => {
      if (e.target.closest('#mkKeyChange')) { store.set(KEY, ''); store.set(MODEL, ''); renderKey(); setTimeout(() => $('#mkKey') && $('#mkKey').focus(), 30); }
      if (e.target.closest('#mkKeySave')) {
        const v = ($('#mkKey').value || '').trim();
        if (v.length < 20) return EL.toast('That doesn\'t look like a whole key. Copy it again.', 'amber');
        store.set(KEY, v); store.set(MODEL, ''); renderKey(); EL.toast('Key saved in this browser', 'green', 2000);
      }
    });
    $('#mkGemini').addEventListener('click', async () => {
      if (!needSrc()) return;
      let key = store.get(KEY);
      if (!key && $('#mkKey') && $('#mkKey').value.trim().length >= 20) { key = $('#mkKey').value.trim(); store.set(KEY, key); renderKey(); }
      if (!key) { EL.toast('Paste your free Gemini key first (or use the Claude way).', 'amber'); return; }
      hooks.busy('Gemini is reading the paper and writing questions… (about 30–90 seconds)');
      try { const r = await toQuestions(await gemini(key, buildPrompt(false), MK.src)); showResult(r, 'Gemini'); }
      catch (ex) { console.error(ex); EL.toast('<b>Gemini could not make the questions.</b><br><span class="muted">' + esc(ex.message || ex) + '</span>', 'red', 12000); }
      finally { hooks.busy(''); }
    });
    $('#mkCopy').addEventListener('click', () => {
      if (!needSrc()) return;
      const t = buildPrompt(true);
      const done = () => EL.toast('<b>Copied.</b><br><span class="muted">In claude.ai: attach ' + esc(MK.src.name) + ', paste (Ctrl + V) and send.</span>', 'green', 7000);
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(done).catch(() => {
        const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { EL.toast('Copy did not work in this browser.', 'red'); }
        ta.remove();
      });
    });
    $('#mkRead').addEventListener('click', async () => {
      const t = $('#mkPaste').value.trim();
      if (!t) return EL.toast("Paste Claude's reply into the box first.", 'amber');
      hooks.busy('Reading the reply…');
      try { const r = await toQuestions(t); showResult(r, 'Claude'); }
      catch (ex) { EL.toast('<b>That reply could not be used.</b><br><span class="muted">' + esc(ex.message || ex) + '</span>', 'red', 10000); }
      finally { hooks.busy(''); }
    });
    $('#mkResult').addEventListener('click', e => {
      const b = e.target.closest('[data-mk]'); if (!b || !MK.last) return;
      const title = MK.last.title || (MK.src ? MK.src.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') : 'New test');
      hooks.use(JSON.parse(JSON.stringify(MK.last.questions)), title, b.dataset.mk);
      $('#mkResult').classList.add('hidden'); $('#mkPaste').value = '';
    });
    initCrop();
  }

  // ---------------------------------------------------------------- crop a picture from a page by hand
  const CR = { page: 0, box: null, res: null };
  function initCrop() {
    const stage = $('#cropStage'), rect = $('#cropRect');
    let start = null;
    const pt = e => { const r = $('#cropImg').getBoundingClientRect(); return [Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)), Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100))]; };
    stage.addEventListener('pointerdown', e => { if (!e.target.closest('#cropImg, #cropRect')) return; e.preventDefault(); start = pt(e); CR.box = [start[0], start[1], start[0], start[1]]; stage.setPointerCapture(e.pointerId); drawRect(); });
    stage.addEventListener('pointermove', e => { if (!start) return; const p = pt(e); CR.box = [Math.min(start[0], p[0]), Math.min(start[1], p[1]), Math.max(start[0], p[0]), Math.max(start[1], p[1])]; drawRect(); });
    stage.addEventListener('pointerup', () => { start = null; });
    $('#cropPages').addEventListener('click', e => { const b = e.target.closest('[data-pg]'); if (!b) return; CR.page = Number(b.dataset.pg); CR.box = null; showPage(); });
    $('#cropNo').addEventListener('click', () => closeCrop(null));
    $('#cropYes').addEventListener('click', async () => {
      if (!CR.box || CR.box[2] - CR.box[0] < 2 || CR.box[3] - CR.box[1] < 2) return EL.toast('Drag over the picture first.', 'amber');
      try { const image = await crop(MK.src.pages[CR.page], CR.box, 900); closeCrop({ image, src: { page: CR.page + 1, box: CR.box.map(v => Math.round(v * 10) / 10) } }); }
      catch (e) { EL.toast('Could not cut that out. Try a bigger area.', 'red'); }
    });
  }
  function drawRect() {
    const rect = $('#cropRect'), b = CR.box;
    if (!b) { rect.classList.add('hidden'); return; }
    rect.classList.remove('hidden');
    Object.assign(rect.style, { left: b[0] + '%', top: b[1] + '%', width: (b[2] - b[0]) + '%', height: (b[3] - b[1]) + '%' });
  }
  function showPage() {
    $('#cropImg').src = MK.src.pages[CR.page];
    $$('#cropPages [data-pg]').forEach(x => x.classList.toggle('on', Number(x.dataset.pg) === CR.page));
    drawRect();
  }
  function closeCrop(v) { $('#cropModal').classList.add('hidden'); if (CR.res) { const r = CR.res; CR.res = null; r(v); } }
  function pickPicture(prev) {
    return new Promise(res => {
      CR.res = res;
      const pages = MK.src.pages;
      CR.page = prev && prev.page && pages[prev.page - 1] ? prev.page - 1 : 0;
      CR.box = prev && prev.box ? prev.box.slice() : null;
      $('#cropPages').innerHTML = pages.map((p, i) => `<button type="button" data-pg="${i}"><img src="${p}" alt=""><span>${i + 1}</span></button>`).join('');
      $('#cropModal').classList.remove('hidden');
      showPage();
    });
  }

  return {
    init, pickPicture, buildPrompt, toQuestions, readPaper, crop,
    hasPages: () => !!(MK.src && MK.src.pages.length),
    _set: src => { MK.src = src; renderSrc(); }
  };
})();
