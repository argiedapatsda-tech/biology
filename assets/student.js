(function () {
  const B = Backend, { $, esc, sfx } = EL;
  EL.paintIcons();
  BioBG.start({ level: 1 });
  const params = new URLSearchParams(location.search);

  let code = null, uid = null, name = '', meta = null, questions = [], paper = null, order = [], answers = {}, control = {};
  let stage = 'join', lockSeq = 0, leaves = 0, awayMs = 0, away = false, awayStart = 0, submitted = false, wasLocked = false;
  let timerInt = null, lastResult = null, closed = false, afterAway = false, afterLeaves = 0, gamesOn = false, gamesShut = false, overInt = null;
  const isPres = () => !!(meta && meta.kind === 'present');
  const P = () => `sessions/${code}/students/${uid}`;

  function show(id) {
    ['join', 'joining', 'wait', 'count', 'test', 'done', 'msg', 'present'].forEach(s => $('#scr-' + s).classList.toggle('hidden', s !== id));
    document.body.className = document.body.className.replace(/\bs-\w+/g, '').trim() + ' s-' + id;
    stage = id;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function event(type, extra) { try { B.push(`sessions/${code}/events`, Object.assign({ sid: uid, name, type, at: B.now() }, extra || {})); } catch (e) { console.error(e); } }

  // ---------------------------------------------------------------- join screen
  function boot() {
    EL.vault($('#vJoin'), 'idle', false);
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('examlock-student') || '{}'); } catch (e) {}
    const c = (params.get('c') || saved.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    $('#code').value = c; paintCode();
    if (saved.name) $('#name').value = saved.name;
    if (c.length === 5 && !saved.name) setTimeout(() => $('#name').focus(), 300);
  }
  function paintCode() {
    const v = $('#code').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    $('#code').value = v;
    document.querySelectorAll('.code-cells i').forEach((c, i) => {
      c.textContent = v[i] || '';
      c.classList.toggle('full', !!v[i]);
      c.classList.toggle('cur', document.activeElement === $('#code') && i === Math.min(v.length, 4));
    });
  }
  $('#code').addEventListener('input', () => { sfx.unlock(); sfx.key(); paintCode(); });
  $('#code').addEventListener('focus', paintCode); $('#code').addEventListener('blur', paintCode);

  $('#joinForm').addEventListener('submit', async e => {
    e.preventDefault(); sfx.unlock();
    const c = $('#code').value.trim().toUpperCase();
    const n = $('#name').value.trim().replace(/\s+/g, ' ');
    const err = $('#joinErr'); err.textContent = '';
    if (c.length !== 5) { err.textContent = 'The test code has 5 characters. · รหัสมี 5 ตัว'; return; }
    if (n.length < 2) { err.textContent = 'Please type your full name. · กรุณาพิมพ์ชื่อ-นามสกุล'; return; }
    $('#joinBtn').disabled = true; $('#joinBtn').textContent = 'Checking…';
    try {
      await B.authReady;
      if (!B.uid() || (B.user() && B.user().email)) await B.signInAnon();
      uid = B.uid();
      const m = await B.get(`sessions/${c}/meta`);
      if (!m) throw new Error('No test found with that code. Check it with your teacher.');
      if (m.status === 'ended') throw new Error(m.kind === 'present' ? 'This lesson has already ended.' : 'This test has already ended.');
      code = c; name = n; meta = m;
      try { localStorage.setItem('examlock-student', JSON.stringify({ code, name })); } catch (e2) {}
      await joinSequence();
      await enter();
    } catch (ex) {
      console.error(ex);
      err.textContent = ex.message || String(ex);
      $('#joinBtn').disabled = false; $('#joinBtn').textContent = 'Join test';
      show('join');
    }
  });

  async function joinSequence() {
    show('joining');
    EL.vault($('#vJoining'), 'idle', true);
    $('#jTitle').textContent = '';
    const bar = $('#jBar'), st = $('#jStage');
    const steps = ['Checking the code', 'Connecting to your teacher', 'Securing the test'];
    const t0 = performance.now(), dur = 1500;
    await new Promise(res => {
      (function f(t) {
        const p = Math.min(1, (t - t0) / dur);
        bar.style.transform = `scaleX(${p})`;
        const s = steps[Math.min(2, Math.floor(p * 3))];
        if (st.textContent !== s) { st.textContent = s; sfx.tick(); }
        if (p < 1) requestAnimationFrame(f); else res();
      })(t0);
    });
    EL.vault($('#vJoining'), 'ok', false); sfx.clunk();
    st.textContent = 'Locked in';
    $('#jTitle').textContent = "You're in, " + name.split(' ')[0];
    await wait(1100);
  }

  async function enter() {
    if (isPres()) return enterPresent();
    const existing = await B.get(P());
    const split = EL.splitPaper(await B.get(`sessions/${code}/questions`));
    questions = split.questions; paper = split.paper;
    const ids = questions.map(q => q.id);
    order = meta.shuffle ? EL.seededOrder(ids, uid) : ids;
    const device = EL.detectBrowser();
    if (existing) {
      answers = existing.answers || {}; lockSeq = existing.lockSeq || 0; leaves = existing.leaves || 0; awayMs = existing.awayMs || 0;
      submitted = existing.status === 'submitted';
      // reopening or reloading during a live test counts as leaving the page
      const reentry = existing.status === 'testing' && !submitted;
      if (reentry) { lockSeq++; leaves++; }
      // a reload starts on the page again, so the "away" flag from before is cleared
      await B.update(P(), { name, online: true, away: false, device, lastSeen: B.now(), lockSeq, leaves, order });
      event(reentry ? 'reload' : 'rejoin');
    } else {
      await B.set(P(), { name, device, joinedAt: B.now(), online: true, status: 'waiting', lockSeq: 0, leaves: 0, awayMs: 0, answered: 0, order, lastSeen: B.now() });
      event('join');
    }
    B.onConnected(on => { if (on) { B.onDisconnectUpdate(P(), { online: false }); B.update(P(), { online: true }); } });
    B.on(`sessions/${code}/control/${uid}`, c => { control = c || {}; if (control.kicked) return removed(); evalLock(); });
    B.on(`sessions/${code}/results/${uid}`, r => showResult(r));
    B.on(`sessions/${code}/meta`, m => onMeta(m));
    B.on(P() + '/chat', c => onChat(c || {}));
    if (submitted) return finish();
    paintWait();
    show('wait');
  }

  function paintWait() {
    $('#wName').textContent = name;
    $('#avatar').textContent = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    $('#wDevice').textContent = EL.detectBrowser() + ' · code ' + code;
    $('#wTitle').textContent = meta.title || 'Test';
    const tl = Number(meta.timeLimit) || 0;
    $('#wMeta').textContent = questions.length + ' questions · ' + (tl ? tl + ' minutes' : 'no time limit');
  }

  let starting = false;
  async function onMeta(m) {
    if (!m) return;
    meta = m;
    if (stage === 'wait') paintWait();
    if (m.status === 'live' && stage === 'wait' && !starting) {
      starting = true;
      show('count');
      for (const n of [3, 2, 1]) {
        const el = $('#countN'); el.textContent = n; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); sfx.tick(); await wait(850);
      }
      startTest();
    }
    if (m.status === 'ended' && (stage === 'test' || stage === 'wait' || stage === 'count')) submit(true);
    if (stage === 'done') { showResult(lastResult); if (m.status === 'ended') closedByTeacher(); }
  }

  // ---------------------------------------------------------------- test
  function startTest() {
    show('test');
    BioBG.setLevel(.4);   // calmer while answering
    $('#tTitle').textContent = meta.title || 'Test';
    $('#tWho').textContent = name + ' · code ' + code;
    $('#qlist').innerHTML = EL.renderTest(questions, order, answers, { paper });
    // page pictures change the page height once they load: tell the teacher's copy
    document.querySelectorAll('#qlist img').forEach(img => img.addEventListener('load', () => sendView(), { once: true }));
    progress();
    B.update(P(), { status: 'testing', startedAt: B.now() });
    timerInt = setInterval(tickTimer, 500); tickTimer();
    evalLock();
    sendView();
  }
  function progress() {
    const n = questions.filter(q => answers[q.id] != null && answers[q.id] !== '').length;
    $('#progFill').style.transform = 'scaleX(' + (questions.length ? n / questions.length : 0) + ')';
    $('#progTxt').textContent = n + ' / ' + questions.length;
    $('#submitHint').textContent = n + ' of ' + questions.length + ' answered';
    return n;
  }
  function saveAnswer(qid) {
    const n = progress();
    B.update(P(), { ['answers/' + qid]: answers[qid] === '' ? null : answers[qid], answered: n, lastActive: B.now() });
  }
  $('#qlist').addEventListener('click', e => {
    const b = e.target.closest('.opt'); if (!b || submitted) return;
    const qid = b.dataset.q, q = questions.find(x => x.id === qid);
    answers[qid] = q.type === 'mc' ? Number(b.dataset.v) : b.dataset.v;
    b.parentElement.querySelectorAll('.opt').forEach(o => o.classList.toggle('sel', o === b));
    b.closest('.qcard').classList.add('answered');
    sfx.select();
    saveAnswer(qid); sendView(qid);
  });
  const typeTimers = {};
  $('#qlist').addEventListener('input', e => {
    const t = e.target.closest('.short'); if (!t || submitted) return;
    const qid = t.dataset.q;
    answers[qid] = t.value;
    t.closest('.qcard').classList.toggle('answered', !!t.value.trim());
    clearTimeout(typeTimers[qid]); typeTimers[qid] = setTimeout(() => saveAnswer(qid), 250);
  });
  $('#qlist').addEventListener('focusin', e => { const c = e.target.closest('.qcard'); if (c) sendView(c.dataset.qid); });

  // live view: the teacher's screen follows this student's scroll position and focus
  let viewT = 0, viewTimer = null, focusQ = null;
  function sendView(fq) {
    if (fq) focusQ = fq;
    if (stage !== 'test' || submitted) return;
    const go = () => { viewT = Date.now(); B.update(P(), { view: { y: Math.round(window.scrollY), vw: window.innerWidth, vh: window.innerHeight, fq: focusQ || null, t: B.now() } }); };
    clearTimeout(viewTimer);
    if (Date.now() - viewT > 120) go(); else viewTimer = setTimeout(go, 120);
  }
  window.addEventListener('scroll', () => sendView(), { passive: true });
  window.addEventListener('resize', () => sendView());

  // ms left on the clock, or null when the test has no time limit / hasn't started
  function timeLeft() {
    const tl = Number(meta && meta.timeLimit) || 0;
    if (!tl || !meta.startedAt) return null;
    return meta.startedAt + tl * 60000 + (Number(meta.extraMs) || 0) - B.now();
  }
  const testOver = () => !!meta && (meta.status === 'ended' || (timeLeft() != null && timeLeft() <= 0));
  function tickTimer() {
    const el = $('#timer');
    const start = meta.startedAt || B.now();
    const left = timeLeft();
    if (left == null) { el.textContent = EL.fmtTime(B.now() - start); el.className = 'timer'; return; }
    el.textContent = EL.fmtTime(left);
    el.className = 'timer' + (left < 60000 ? ' crit' : left < 300000 ? ' warn' : '');
    if (left <= 0 && !submitted) submit(true);
  }

  // ---------------------------------------------------------------- leave detection + lock
  function goAway(reason) {
    if (stage === 'done' && submitted && !closed && code && !afterAway) {
      afterAway = true; afterLeaves++;
      B.update(P(), { awayAfter: true, afterLeaves });
      event('leftafter', { reason });
      return;
    }
    if (!watched() || away) return;
    away = true; awayStart = Date.now();
    lockSeq++; leaves++;
    evalLock();                      // lock locally first; the network may be frozen while away
    B.update(P(), { away: true, lockSeq, leaves, lastLeave: B.now() });
    event('left', { reason });
  }
  function comeBack() {
    if (afterAway) { afterAway = false; B.update(P(), { awayAfter: false }); event('backafter'); return; }
    if (!away) return;
    away = false;
    const ms = Date.now() - awayStart; awayMs += ms;
    B.update(P(), { away: false, awayMs, lastSeen: B.now() });
    event('back', { ms });
    sfx.alarm();
  }
  document.addEventListener('visibilitychange', () => { document.hidden ? goAway('Switched app or tab') : comeBack(); });
  window.addEventListener('blur', () => goAway('Left the page'));
  window.addEventListener('focus', comeBack);
  window.addEventListener('pageshow', comeBack);

  // the screens where leaving counts: the test itself, and a live presentation
  const watched = () => (stage === 'test' && !submitted) || stage === 'present';
  function evalLock() {
    const byLeave = lockSeq > (Number(control.unlockSeq) || 0);
    const locked = watched() && (byLeave || !!control.forceLock);
    const ov = $('#lock');
    if (locked) {
      if (!wasLocked) {
        ov.classList.remove('hidden', 'unlocking');
        document.body.classList.add('locked');
        EL.vault($('#vLock'), 'lock', false);
        $('#lkTime').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (document.activeElement) document.activeElement.blur();
      }
      $('#lkCount').textContent = leaves;
      ov.querySelector('h1').textContent = byLeave ? 'You left the ' + (isPres() ? 'lesson' : 'test') : 'Paused by your teacher';
      ov.querySelector('.label.red').textContent = isPres() ? 'Screen locked · หน้าจอถูกล็อก' : 'Test locked · ข้อสอบถูกล็อก';
      ov.querySelector('.lock-th').textContent = isPres() ? 'คุณออกจากหน้าบทเรียน ระบบแจ้งครูแล้ว กรุณายกมือ ครูเท่านั้นที่ปลดล็อกได้' : 'คุณออกจากหน้าข้อสอบ ระบบแจ้งครูแล้ว กรุณายกมือ ครูเท่านั้นที่ปลดล็อกได้';
      $('#lockMsg').textContent = byLeave
        ? 'Your teacher has been notified. Raise your hand. Only your teacher can unlock this screen.'
        : 'Your teacher paused your screen. Please wait.';
    } else if (wasLocked) {
      ov.classList.add('unlocking');
      EL.vault($('#vLock'), 'ok', true); sfx.granted();
      $('#lkStatus').textContent = 'Unlocked';
      setTimeout(() => { ov.classList.add('hidden'); ov.classList.remove('unlocking'); document.body.classList.remove('locked'); $('#lkStatus').textContent = 'Waiting'; }, 1200);
      EL.toast('<b>Unlocked</b><br><span class="muted">Your teacher unlocked your ' + (isPres() ? 'screen' : 'test') + '. Carry on.</span>', 'green');
    }
    wasLocked = locked;
  }

  // ---------------------------------------------------------------- messages from the teacher (one-way: students can't reply)
  let msgPrimed = false, lastMsgKey = null, shownKey = null;
  function onChat(c) {
    const lastT = Object.entries(c).map(([k, m]) => Object.assign({ k }, m)).filter(m => m.from === 't').sort((a, b) => a.at - b.at).pop();
    if (lastT && lastT.k !== lastMsgKey && (msgPrimed || !lastT.seen)) {
      sfx.msg();
      shownKey = lastT.k;
      $('#incomingTxt').textContent = lastT.text;
      $('#incomingTime').textContent = EL.clock(lastT.at).slice(0, 5);
      $('#incoming').classList.remove('hidden');
    }
    if (lastT) lastMsgKey = lastT.k;
    msgPrimed = true;
  }
  $('#incOk').addEventListener('click', () => {
    $('#incoming').classList.add('hidden');
    if (shownKey) B.update(P() + '/chat/' + shownKey, { seen: true });   // lets the teacher see it was read
  });

  // ---------------------------------------------------------------- submit
  $('#submitBtn').addEventListener('click', () => {
    const n = progress(), left = questions.length - n;
    $('#cfBody').textContent = left ? `You answered ${n} of ${questions.length}. ${left} still empty. You can't change answers after submitting.`
      : `All ${questions.length} questions answered. You can't change answers after submitting.`;
    $('#confirm').classList.remove('hidden');
  });
  $('#cfNo').addEventListener('click', () => $('#confirm').classList.add('hidden'));
  $('#cfYes').addEventListener('click', () => { $('#confirm').classList.add('hidden'); submit(false); });

  function submit(auto) {
    if (submitted) { if (stage !== 'done') finish(); return; }
    submitted = true;
    clearInterval(timerInt);
    const clean = {}; Object.keys(answers).forEach(k => { if (answers[k] !== '' && answers[k] != null) clean[k] = answers[k]; });
    B.update(P(), { status: 'submitted', submittedAt: B.now(), answers: clean, answered: Object.keys(clean).length, away: false, autoSubmitted: !!auto });
    event('submit', { auto: !!auto });
    finish(auto);
  }
  function finish(auto) {
    $('#lock').classList.add('hidden'); document.body.classList.remove('locked'); wasLocked = false;
    $('#confirm').classList.add('hidden');
    show('done');
    BioBG.setLevel(1);
    $('#doneTitle').textContent = auto ? 'Time is up. Test submitted.' : 'Test submitted';
    if (testOver()) shutGames(false);
    else if (!gamesOn) { gamesOn = true; Games.mount($('#gameHost')); }
    // the arcade is only for waiting: it shuts the moment time runs out or the teacher ends the test,
    // even mid-game. The clock is checked here too, so it shuts even if the iPad has lost the internet.
    clearInterval(overInt); if (!gamesShut) overInt = setInterval(() => { if (testOver()) shutGames(true); }, 1000);
    if (meta && meta.status === 'ended') closedByTeacher();
    sfx.ok();
    showResult(lastResult);
  }
  // the teacher ended the test: nothing more to watch, the student may close the page
  function shutGames(loud) {
    if (gamesShut) return;
    gamesShut = true; clearInterval(overInt);
    const wasPlaying = document.body.classList.contains('arcade-on');
    Games.close();
    $('#gameHost').innerHTML = ''; $('#gamesBox').classList.add('hidden');
    if (loud && gamesOn) {
      // when the clock ran out, say so, even if the test was also ended in the same second
      const outOfTime = timeLeft() != null && timeLeft() <= 2000;
      $('#overTitle').textContent = outOfTime || meta.status !== 'ended' ? "Time's up" : 'Your teacher ended the test';
      $('#over').classList.remove('hidden');
      if (wasPlaying) sfx.alarm();
    }
  }
  $('#overOk').addEventListener('click', () => $('#over').classList.add('hidden'));
  function closedByTeacher() {
    shutGames(true);
    if (closed) return;
    closed = true;
    $('#doneTitle').textContent = 'Test closed';
    $('#doneLead').innerHTML = 'Your teacher has closed the test. You can close this page now.<span class="th">ครูปิดการสอบแล้ว ปิดหน้านี้ได้เลย</span>';
    $('#stayNote').classList.add('hidden');
  }
  function showResult(r) {
    lastResult = r;
    if (stage !== 'done') return;
    if (r && meta && meta.release) {
      $('#result').classList.remove('hidden'); $('#doneWait').classList.add('hidden');
      $('#scoreTxt').textContent = r.score + ' / ' + r.total;
      setTimeout(() => { $('#scoreBar').style.transform = 'scaleX(' + (r.total ? r.score / r.total : 0) + ')'; }, 60);
    } else {
      $('#result').classList.add('hidden'); $('#doneWait').classList.remove('hidden');
    }
  }
  function removed() {
    clearInterval(timerInt); submitted = true;
    $('#lock').classList.add('hidden'); document.body.classList.remove('locked');
    $('#msgTitle').textContent = 'Removed from the test';
    $('#msgBody').textContent = 'Your teacher removed you from this test. · ครูได้นำคุณออกจากการสอบนี้';
    show('msg');
  }

  // ---------------------------------------------------------------- presentation: follow the teacher's slides
  const slideCache = {};
  let curSlide = -1;
  async function enterPresent() {
    const existing = await B.get(P());
    const device = EL.detectBrowser();
    if (existing) {
      lockSeq = existing.lockSeq || 0; leaves = existing.leaves || 0; awayMs = existing.awayMs || 0;
      // reopening the page during the lesson counts as leaving it
      lockSeq++; leaves++;
      await B.update(P(), { name, online: true, away: false, device, lastSeen: B.now(), lockSeq, leaves, status: 'watching' });
      event('reload');
    } else {
      await B.set(P(), { name, device, joinedAt: B.now(), online: true, status: 'watching', lockSeq: 0, leaves: 0, awayMs: 0, lastSeen: B.now() });
      event('join');
    }
    B.onConnected(on => { if (on) { B.onDisconnectUpdate(P(), { online: false }); B.update(P(), { online: true }); } });
    B.on(`sessions/${code}/control/${uid}`, c => { control = c || {}; if (control.kicked) return removed(); evalLock(); });
    B.on(P() + '/chat', c => onChat(c || {}));
    $('#pTitle').textContent = meta.title || 'Lesson';
    $('#pWho').textContent = name;
    show('present');
    BioBG.setLevel(.25);
    B.on(`sessions/${code}/meta`, m => onPresMeta(m));
    evalLock();
  }
  function getSlide(i) {
    if (i < 0 || i >= (Number(meta.n) || 0)) return Promise.resolve(null);
    if (!slideCache[i]) slideCache[i] = B.get(`sessions/${code}/questions/${i}`).then(s => s && s.img).catch(e => { delete slideCache[i]; throw e; });
    return slideCache[i];
  }
  async function onPresMeta(m) {
    if (!m) return;
    meta = m;
    if (m.status === 'ended') return lessonOver();
    const i = Number(m.slide) || 0;
    $('#pNum').textContent = (i + 1) + ' / ' + (m.n || 0);
    paintPtr(m.ptr);
    if (i === curSlide) return;
    curSlide = i;
    $('#pLoad').classList.remove('hidden');
    try {
      const src = await getSlide(i);
      if (curSlide !== i) return;           // the teacher already moved on
      const img = $('#pImg');
      if (src && img.getAttribute('src') !== src) { img.src = src; img.classList.remove('pop'); void img.offsetWidth; img.classList.add('pop'); }
    } catch (e) { console.error(e); } finally { if (curSlide === i) $('#pLoad').classList.add('hidden'); }
    getSlide(i + 1).catch(() => {});        // the next slide is ready before the teacher gets there
  }
  // the teacher's laser pointer, placed in slide coordinates (0..1)
  function paintPtr(p) {
    const dot = $('#pPtr'), img = $('#pImg');
    if (!p || !p.on || !img.naturalWidth) { dot.classList.add('hidden'); return; }
    const r = img.getBoundingClientRect(), k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    dot.style.transform = `translate(${r.left + (r.width - w) / 2 + p.x * w}px, ${r.top + (r.height - h) / 2 + p.y * h}px)`;
    dot.classList.remove('hidden');
  }
  $('#pImg').addEventListener('load', () => paintPtr(meta && meta.ptr));
  window.addEventListener('resize', () => { if (stage === 'present') paintPtr(meta && meta.ptr); });
  function lessonOver() {
    $('#lock').classList.add('hidden'); document.body.classList.remove('locked'); wasLocked = false;
    $('#msgTag').textContent = 'Lesson ended'; $('#msgTag').className = 'label';
    $('#msgTitle').textContent = 'The lesson has ended';
    $('#msgBody').innerHTML = 'Thank you for following along. You can close this page now.<span class="th">จบบทเรียนแล้ว ปิดหน้านี้ได้เลย</span>';
    show('msg');
    BioBG.setLevel(1);
  }

  boot();
})();
