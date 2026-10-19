// Copy and paste a test: questions copied from a website, Word, a PDF or a chat reply become editable questions.
// Understands "1. / ข้อ 1 / Question 1", choices "A. / a) / (A) / ก. / 1) / • bullets / plain lines",
// answers "Answer: B", "ตอบ ข", "Correct answer: Mitochondria", a star or tick on the right choice,
// and an answer list at the end ("Answers: 1. B 2. C …" or "1-B" lines).
window.Paste = (function () {
  const THAI = 'กขคงจฉ';
  const letterIdx = l => { l = String(l).toLowerCase(); const t = THAI.indexOf(l); return t >= 0 ? t : 'abcdef'.indexOf(l); };
  const LET = '[A-Fa-f]|[กขคงจฉ]';

  // ---------------------------------------------------------------- copied web page -> plain lines
  // A browser's plain-text copy drops list numbers and letters (1. 2. / a. b.), so read the HTML copy instead.
  const BLOCK = /^(P|DIV|LI|H[1-6]|TR|UL|OL|TABLE|SECTION|ARTICLE|HEADER|FOOTER|DT|DD|DL|LABEL|FIELDSET|LEGEND|BLOCKQUOTE|PRE|FORM|FIGURE|FIGCAPTION|MAIN|ASIDE|NAV|CENTER)$/;
  function roman(n, upper) {
    const v = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = '';
    for (const [k, r] of v) while (n >= k) { s += r; n -= k; }
    return upper ? s.toUpperCase() : s;
  }
  function marker(ol, n) {
    const ty = (ol.getAttribute('type') || '') + ' ' + (ol.getAttribute('style') || '');
    if (/lower-(alpha|latin)|(^|\s)a(\s|$)/.test(ty)) return 'abcdefghij'[n - 1] + '.';
    if (/upper-(alpha|latin)|(^|\s)A(\s|$)/.test(ty)) return 'ABCDEFGHIJ'[n - 1] + '.';
    if (/lower-roman|(^|\s)i(\s|$)/.test(ty)) return roman(n) + '.';
    if (/upper-roman|(^|\s)I(\s|$)/.test(ty)) return roman(n, true) + '.';
    if (/thai/.test(ty)) return THAI[n - 1] + '.';
    return n + '.';
  }
  function toText(html, pics) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let out = '';
    const nl = () => { if (out && !out.endsWith('\n')) out += '\n'; };
    function walk(el) {
      for (const n of el.childNodes) {
        if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, ' '); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName;
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|BUTTON|SELECT|IFRAME)$/.test(tag) || n.hidden || /display\s*:\s*none/.test(n.getAttribute('style') || '')) continue;
        if (tag === 'BR') { out += '\n'; continue; }
        if (tag === 'IMG') {
          const src = n.getAttribute('src') || '';
          if (pics && /^(https?:|data:image)/.test(src) && !(Number(n.getAttribute('width')) > 0 && Number(n.getAttribute('width')) < 40)) {
            pics.push(src); nl(); out += `[picture ${pics.length}]\n`;
          }
          continue;
        }
        if (tag === 'INPUT') { if (/radio|checkbox/i.test(n.type)) { nl(); out += (n.hasAttribute('checked') ? '✓ ' : '• '); } continue; }
        const block = BLOCK.test(tag);
        if (block) nl();
        if (tag === 'LI') {
          const p = n.parentElement;
          if (p && p.tagName === 'OL') {
            const start = Number(p.getAttribute('start')) || 1;
            const k = Array.from(p.children).filter(c => c.tagName === 'LI').indexOf(n);
            out += marker(p, start + k) + ' ';
          } else out += '• ';
        }
        if (tag === 'TD' || tag === 'TH') out += ' ';
        walk(n);
        if (block) nl();
      }
    }
    walk(doc.body || doc.documentElement);
    return out.split('\n').map(s => s.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ---------------------------------------------------------------- lines -> questions
  const ANS_WORD = '(?:correct\\s+answers?|right\\s+answer|answers?|ans|correct\\s+option|key|คำตอบที่ถูก(?:ต้อง)?|คำตอบ|เฉลย|ตอบ)';
  const KEY_HEAD = new RegExp('^(?:answers?(?:\\s+key)?|answer\\s+sheet|key|solutions?|เฉลย(?:คำตอบ)?|คำตอบ)\\s*[:：]?\\s*$', 'i');
  const ANS_LINE = new RegExp('^\\(?' + ANS_WORD + '\\)?\\s*(?:is\\s*)?([:：=\\-–]|\\s)\\s*(.+)$', 'i');
  const ANS_TAIL = new RegExp('\\s+\\(?' + ANS_WORD + '\\s*[:：]\\s*([^)]+)\\)?\\s*$', 'i');
  const EXPL = /^(?:explanation|explain|why|reason|because|hint|คำอธิบาย|อธิบาย|เหตุผล)\s*[:：]\s*(.+)$/i;
  const Q_NUM = /^(?:ข้อ(?:ที่)?\s*|Q(?:uestion)?\s*\.?\s*(?:no\.?\s*)?|#\s*|No\.\s*)?(\d{1,3})\s*(?:[.)\]:：]|\s[-–]\s|\s*-(?=\s))\s*(.*)$/i;
  const Q_NUM2 = /^ข้อ(?:ที่)?\s*(\d{1,3})\s+(.+)$/;
  const Q_ALONE = /^(?:ข้อ(?:ที่)?|Q(?:uestion)?)\s*\.?\s*(\d{1,3})(?:\s*(?:of|\/|จาก)\s*\d+)?\s*[.:：)]?\s*$/i;
  const OPT = new RegExp('^(?:\\(\\s*(' + LET + ')\\s*\\)|(' + LET + ')\\s*[.)\\]:：])\\s*(.*)$');
  const BULLET = /^([•●○◯◦▪■□☐❍⚪✓✔☑✗✘\-–*])\s+(.+)$/;
  const PIC = /^\[picture (\d+)\]$/;
  // buttons and labels that quiz sites leave in a copy
  const JUNK = /^(?:(?:show|hide|check|reveal|view|see)\s+(?:the\s+)?(?:answers?|explanation|solution)s?|submit|next|previous|back|skip|clear(?:\s+selection)?|report|share|print|\d+\s*\/\s*\d+|ดูเฉลย|ส่งคำตอบ|ถัดไป|ย้อนกลับ)$/i;
  const TF_WORD = /^(true|false|t|f|ถูก|ผิด|yes|no)$/i;
  const isTrue = s => /^(true|t|ถูก|yes)$/i.test(s);
  // "1. B  2. C  3) A", "1-B, 2-C", "1.ก 2.ข"
  const PAIR = new RegExp('(\\d{1,3})\\s*[.)\\-:=–]?\\s*\\(?(' + LET + '|true|false|ถูก|ผิด|T|F)\\)?(?=[\\s,;/|]|$)', 'gi');
  function keyPairs(line) {
    const s = line.replace(/[,;|]/g, ' ').trim();
    const hits = []; let m, used = 0;
    PAIR.lastIndex = 0;
    while ((m = PAIR.exec(s))) { hits.push([Number(m[1]), m[2]]); used += m[0].length; }
    return hits.length && used >= s.replace(/\s+/g, '').length * 0.6 && s.replace(PAIR, '').trim() === '' ? hits : null;
  }
  // a choice is marked right with a star, a tick or "(correct)"
  const MARK = /(^\s*(?:\*|✓|✔|☑|✅)\s*|\s*(?:\*|✓|✔|☑|✅|\(correct\)|\[correct\]|←\s*correct|<-+\s*correct|\(ถูก\)|\(คำตอบ\))\s*$)/i;
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  // strip "(1 point)", "* (required)", "1 pt" left by quiz sites
  const tidyQ = s => clean(s).replace(/\s*\(\s*\d+(\.\d+)?\s*(points?|pts?|marks?|คะแนน)\s*\)\s*$/i, '').replace(/\s*\*\s*$/, '').replace(/\s+\d+\s*(points?|pts?)\s*$/i, '').trim();

  function parse(text) {
    const lines = [];
    String(text || '').replace(/\r/g, '').replace(/[   ]/g, ' ').replace(/[​‌‍﻿]/g, '')
      .split('\n').forEach(raw => {
        let l = raw.replace(/\t/g, ' ').trim();
        // "D. Golgi body   Answer: B" -> two lines
        const t = l.match(ANS_TAIL);
        if (t && t.index > 0 && !/^\(?(?:correct|answer|ans|key|ตอบ|เฉลย|คำตอบ)/i.test(l)) { lines.push(l.slice(0, t.index).trim()); l = 'Answer: ' + t[1].trim(); }
        lines.push(l);
      });

    const qs = [], key = {};
    let cur = null, inKey = false, title = '';
    const start = (num, text) => {
      finish();
      cur = { num, text: text || '', opts: [], marks: [], loose: [], pics: [], numbered: false, gapAfterText: false };
      inKey = false;
    };
    function finish() {
      if (!cur) return;
      // plain lines under a question (no letters) are its choices, e.g. a copied Google Form
      cur.text = tidyQ(cur.text);
      if (!cur.opts.length && cur.loose.length >= 2 && cur.loose.length <= 6 && cur.loose.every(s => s.length <= 140) &&
          (/[?？:：]\s*$/.test(cur.text) || cur.ans || cur.marks.length) ) {
        cur.loose.forEach(s => addOpt(s));
        cur.loose = [];
      }
      if (cur.loose.length) cur.text += ' ' + cur.loose.join(' ');
      cur.text = tidyQ(cur.text);
      if (cur.text || cur.opts.length || cur.pics.length) qs.push(cur);
      cur = null;
    }
    function addOpt(s) {
      let v = String(s), right = false;
      if (MARK.test(v)) { right = true; v = v.replace(MARK, ''); }
      cur.opts.push(clean(v));
      if (right) cur.marks.push(cur.opts.length - 1);
    }
    const expectNext = () => (cur ? cur.num : qs.length ? qs[qs.length - 1].num : 0) + 1;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (!line) { if (cur && !cur.opts.length && cur.loose.length) cur.gapAfterText = true; continue; }

      if (JUNK.test(line)) continue;
      if (KEY_HEAD.test(line)) { finish(); inKey = true; continue; }
      const pairs = keyPairs(line);
      if (pairs && (inKey || qs.length || cur)) { pairs.forEach(([n, a]) => { key[n] = a; }); finish(); inKey = true; continue; }
      if (inKey && /^\d{1,3}\s*[.)\-:=–]\s*.{1,80}$/.test(line) && !/[?？]$/.test(line)) {
        // "3. Mitochondria" in an answer list
        const m = line.match(/^(\d{1,3})\s*[.)\-:=–]\s*(.+)$/); key[Number(m[1])] = m[2]; continue;
      }

      const pic = line.match(PIC);
      if (pic) { if (!cur) start(expectNext(), ''); cur.pics.push(Number(pic[1]) - 1); continue; }

      if (cur) {
        const e = line.match(EXPL);
        if (e) { cur.explain = clean(e[1]); continue; }
        const a = line.match(ANS_LINE);
        // "Answer: B" — but not "Answer the following questions"
        if (a && (a[1] !== ' ' || new RegExp('^\\(?(' + LET + ')\\)?(?:[.)\\s]|$)').test(a[2]) || TF_WORD.test(a[2]))) { cur.ans = clean(a[2]); continue; }
      }

      const qa = line.match(Q_ALONE);
      if (qa) { start(Number(qa[1]), ''); continue; }

      const q = line.match(Q_NUM) || line.match(Q_NUM2);
      if (q) {
        const n = Number(q[1]);
        // numbered choices under a question: "1) ... 2) ... 3) ... 4)"
        const asOpt = cur && (cur.text || cur.loose.length) && n === cur.opts.length + 1 && n <= 6 &&
          (cur.numbered || (n === 1 && !cur.opts.length)) && !(n === cur.num + 1 && !cur.numbered);
        if (asOpt) { cur.numbered = true; addOpt(q[2]); continue; }
        if (!cur && !qs.length || n > (cur ? cur.num : qs[qs.length - 1].num) || n === 1) {
          if (!cur && !qs.length && lines.slice(0, li).some(Boolean) && !title) title = clean(lines.slice(0, li).filter(Boolean)[0]);
          start(n, q[2]);
          const inl = inlineOpts(cur.text);
          if (inl) { cur.text = inl.before; inl.opts.forEach(addOpt); }
          continue;
        }
      }

      if (cur) {
        const inl = inlineOpts(line);
        if (inl && !inl.before && letterIdx(inl.first) === cur.opts.length) { inl.opts.forEach(addOpt); continue; }
        const o = line.match(OPT);
        if (o && letterIdx(o[1] || o[2]) === cur.opts.length && (o[3] || '').trim()) {
          // "a) ..." straight after the question, or the next letter in the row
          if (cur.loose.length) { cur.text += ' ' + cur.loose.join(' '); cur.loose = []; }
          addOpt(o[3]); continue;
        }
        const b = line.match(BULLET);
        if (b && (cur.text || cur.loose.length)) {
          if (cur.loose.length) { cur.text += ' ' + cur.loose.join(' '); cur.loose = []; }
          addOpt((/[✓✔☑]/.test(b[1]) ? '✓ ' : '') + b[2]); continue;
        }
      }

      // a line ending in "?" with no number starts a new question when the last one already has its choices
      if (/[?？]\s*(\(\s*\d+\s*(points?|pts?|marks?)\s*\))?\s*\*?\s*$/.test(line) && (!cur || cur.opts.length >= 2 || (cur.loose.length >= 2 && cur.text))) {
        start(expectNext(), line); continue;
      }
      if (!cur) { if (!qs.length && !title && line.length < 90) title = line; continue; }
      if (cur.opts.length) {
        // a wrapped choice goes on in small letters; anything else after the choices is the next question
        if (/^[a-z(]/.test(line) || cur.opts.length < 2) cur.opts[cur.opts.length - 1] += ' ' + line;
        else start(expectNext(), line);
        continue;
      }
      if (!cur.text) cur.text = line; else cur.loose.push(line);
    }
    finish();

    return { title, questions: qs.map((c, i) => build(c, key[c.num] != null ? key[c.num] : key[i + 1])) };
  }

  // "A. cell B. tissue C. organ" on one line
  function inlineOpts(s) {
    const re = new RegExp('(?:^|\\s)\\(?(' + LET + ')[.)]\\s+', 'g'), hits = [];
    let m; while ((m = re.exec(s))) hits.push({ i: m.index + (/^\s/.test(m[0]) ? 1 : 0), end: re.lastIndex, l: m[1] });
    if (hits.length < 2 || letterIdx(hits[0].l) !== 0) return null;
    for (let k = 0; k < hits.length; k++) if (letterIdx(hits[k].l) !== k) return null;
    return { first: hits[0].l, before: s.slice(0, hits[0].i).trim(), opts: hits.map((h, k) => s.slice(h.end, k + 1 < hits.length ? hits[k + 1].i : s.length).trim()) };
  }

  // which choice an answer means: a letter, a number for numbered choices, or the words of the choice
  function pickChoice(ans, opts, numbered) {
    if (ans == null) return -1;
    const s = clean(ans);
    const m = s.match(new RegExp('^\\(?(' + LET + ')\\)?(?:[.):\\s]|$)'));
    if (m && letterIdx(m[1]) < opts.length) return letterIdx(m[1]);
    const d = s.match(/^\(?([1-6])\)?(?:[.):\s]|$)/);
    if (d && numbered && Number(d[1]) <= opts.length) return Number(d[1]) - 1;
    const norm = x => clean(x).toLowerCase().replace(new RegExp('^\\(?(' + LET + ')\\s*[.):]\\s*'), '').replace(/[.。]$/, '');
    const a = norm(s);
    let k = opts.findIndex(o => norm(o) === a);
    if (k < 0 && a.length > 2) k = opts.findIndex(o => norm(o).length > 2 && (norm(o).includes(a) || a.includes(norm(o))));
    return k;
  }

  function build(c, keyAns) {
    let text = c.text, ans = c.ans != null ? c.ans : keyAns;
    const opts = c.opts.filter(Boolean);
    const base = { text, explain: c.explain || '', pics: c.pics };
    const tfOpts = opts.length === 2 && TF_WORD.test(opts[0]) && TF_WORD.test(opts[1]) && isTrue(opts[0]) !== isTrue(opts[1]);
    const tfLead = /^(?:true\s*(?:or|\/)\s*false|t\s*\/\s*f|ถูกหรือผิด)\s*[:：.\-–)]\s*/i;
    if (tfOpts || (!opts.length && (tfLead.test(text) || (ans != null && TF_WORD.test(clean(ans)))))) {
      base.text = text.replace(tfLead, '');
      let v = null;
      if (c.marks.length && tfOpts) v = isTrue(opts[c.marks[0]]);
      else if (ans != null) {
        const s = clean(ans);
        if (TF_WORD.test(s.split(/[\s.,]/)[0])) v = isTrue(s.split(/[\s.,]/)[0]);
        else if (tfOpts) { const k = pickChoice(s, opts); if (k >= 0) v = isTrue(opts[k]); }
      }
      return Object.assign(base, { type: 'tf', answer: v === false ? 'false' : 'true', needKey: v == null });
    }
    if (opts.length >= 2) {
      let k = c.marks.length ? c.marks[0] : pickChoice(ans, opts, c.numbered);
      return Object.assign(base, { type: 'mc', options: opts.slice(0, 6), answer: k >= 0 && k < 6 ? k : 0, needKey: !(k >= 0 && k < 6) });
    }
    // one missing word: "The ____ controls the cell." + "Answer: nucleus" -> fill in the blank
    const a = ans != null ? clean(ans) : '';
    const blanks = text.match(/_{3,}|…{2,}|\.{4,}/g);
    if (a && blanks && blanks.length === 1) return Object.assign(base, { type: 'fill', text: text.replace(/_{3,}|…{2,}|\.{4,}/, '[[' + a.replace(/[\[\]]/g, '') + ']]') });
    return Object.assign(base, { type: 'short', answer: a.replace(/\s*(?:,|\bor\b|หรือ)\s*/g, ' | ') });
  }

  return { parse, toText };
})();
