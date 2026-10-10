(function () {
  const B = Backend, { $, esc, sfx } = EL;
  const params = new URLSearchParams(location.search);

  // where the 3D lock sits for each screen (fractions of the visible area)
  let heroMode = 'join';
  const portrait = (w, h) => w / h < 1.1;
  const LAYOUT = {
    join:    (w, h) => portrait(w, h) ? { x: 0, y: 0.29, size: 0.3 } : { x: 0.24, y: -0.02, size: 0.62 },
    joining: (w, h) => portrait(w, h) ? { x: 0, y: 0.12, size: 0.42 } : { x: 0, y: 0.1, size: 0.55 },
    wait:    (w, h) => portrait(w, h) ? { x: 0, y: 0.33, size: 0.2 } : { x: 0.26, y: 0, size: 0.5 },
    count:   (w, h) => portrait(w, h) ? { x: 0, y: 0.18, size: 0.32 } : { x: 0, y: 0.14, size: 0.42 },
    lock:    (w, h) => portrait(w, h) ? { x: 0, y: 0.24, size: 0.32 } : { x: 0, y: 0.2, size: 0.42 },
    done:    (w, h) => portrait(w, h) ? { x: 0, y: 0.3, size: 0.22 } : { x: 0.26, y: 0, size: 0.48 }
  };
  const hero = FX.lock($('#hero'), (w, h) => (LAYOUT[heroMode] || LAYOUT.join)(w, h));
  function heroTo(mode) { heroMode = mode; hero.relayout && hero.relayout(); }

  let code = null, uid = null, name = '', meta = null, questions = [], order = [], answers = {}, control = {};
  let stage = 'join', lockSeq = 0, leaves = 0, awayMs = 0, away = false, awayStart = 0, submitted = false, wasLocked = false;
  let timerInt = null, lastResult = null;
  const P = () => `sessions/${code}/students/${uid}`;

  function show(id) {
    ['join', 'joining', 'wait', 'count', 'test', 'done', 'msg'].forEach(s => $('#scr-' + s).classList.toggle('hidden', s !== id));
    document.body.classList.remove('s-join', 's-joining', 's-wait', 's-count', 's-test', 's-done', 's-msg');
    document.body.classList.add('s-' + id);
    stage = id;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function event(type, extra) { try { B.push(`sessions/${code}/events`, Object.assign({ sid: uid, name, type, at: B.now() }, extra || {})); } catch (e) { console.error(e); } }

  // ---------------------------------------------------------------- join screen
  async function boot() {
    hero.setOpen(true); hero.setState('idle'); heroTo('join');
    const tick = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    const items = ['Secure connection', EL.detectBrowser(), B.mode === 'demo' ? 'Demo mode (this browser only)' : 'Encrypted'];
    $('#checks').innerHTML = items.map((t, i) => `<span style="animation-delay:${0.4 + i * 0.25}s">${tick}${esc(t)}</span>`).join('');
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('examlock-student') || '{}'); } catch (e) {}
    const c = (params.get('c') || saved.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    $('#code').value = c; paintCode();
    if (saved.name) $('#name').value = saved.name;
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
    if (c.length !== 5) { err.textContent = 'The test code has 5 characters.'; return; }
    if (n.length < 2) { err.textContent = 'Please type your full name.'; return; }
    $('#joinBtn').disabled = true; $('#joinBtn').textContent = 'Checking…';
    try {
      await B.authReady;
      if (!B.uid() || (B.user() && B.user().email)) await B.signInAnon();
      uid = B.uid();
      const m = await B.get(`sessions/${c}/meta`);
      if (!m) throw new Error('No test found with that code. Check it with your teacher.');
      if (m.status === 'ended') throw new Error('This test has already ended.');
      code = c; name = n; meta = m;
      try { localStorage.setItem('examlock-student', JSON.stringify({ code, name })); } catch (e2) {}
      await joinSequence();
      await enter();
    } catch (ex) {
      console.error(ex);
      err.textContent = ex.message || String(ex);
      $('#joinBtn').disabled = false; $('#joinBtn').textContent = 'Join test';
      show('join'); heroTo('join'); hero.setOpen(true); hero.setState('idle');
    }
  });

  async function joinSequence() {
    show('joining'); heroTo('joining'); hero.setState('scan');
    $('#jTitle').textContent = '';
    const bar = $('#jBar'), st = $('#jStage');
    const steps = ['Verifying', 'Connecting to your teacher', 'Securing session'];
    const t0 = performance.now(), dur = 1800;
    await new Promise(res => {
      (function f(t) {
        const p = Math.min(1, (t - t0) / dur);
        bar.style.transform = `scaleX(${p})`;
        const s = steps[Math.min(2, Math.floor(p * 3))];
        if (st.textContent !== s) { st.textContent = s; sfx.tick(); }
        if (p < 1) requestAnimationFrame(f); else res();
      })(t0);
    });
    hero.snap(); hero.setState('ok'); sfx.clunk();
    st.textContent = 'Locked in';
    EL.scramble($('#jTitle'), "You're in, " + name.split(' ')[0], 500);
    await wait(1500);
  }

  async function enter() {
    const existing = await B.get(P());
    questions = EL.asArray(await B.get(`sessions/${code}/questions`));
    const ids = questions.map(q => q.id);
    order = meta.shuffle ? EL.seededOrder(ids, uid) : ids;
    const device = EL.detectBrowser();
    if (existing) {
      answers = existing.answers || {}; lockSeq = existing.lockSeq || 0; leaves = existing.leaves || 0; awayMs = existing.awayMs || 0;
      submitted = existing.status === 'submitted';
      // reopening or reloading during a live test counts as leaving the page
      const reentry = existing.status === 'testing' && !submitted;
      if (reentry) { lockSeq++; leaves++; }
      await B.update(P(), { name, online: true, device, lastSeen: B.now(), lockSeq, leaves, order });
      event(reentry ? 'reload' : 'rejoin');
    } else {
      await B.set(P(), { name, device, joinedAt: B.now(), online: true, status: 'waiting', lockSeq: 0, leaves: 0, awayMs: 0, answered: 0, order, lastSeen: B.now() });
      event('join');
    }
    B.onConnected(on => { if (on) { B.onDisconnectUpdate(P(), { online: false }); B.update(P(), { online: true }); } });
    B.on(`sessions/${code}/control/${uid}`, c => { control = c || {}; if (control.kicked) return removed(); evalLock(); });
    B.on(`sessions/${code}/results/${uid}`, r => showResult(r));
    B.on(`sessions/${code}/meta`, m => onMeta(m));
    if (submitted) return finish();
    paintWait();
    show('wait'); heroTo('wait'); hero.setState('idle');
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
      show('count'); heroTo('count');
      for (const n of [3, 2, 1]) {
        const el = $('#countN'); el.textContent = n; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); sfx.tick(); await wait(900);
      }
      startTest();
    }
    if (m.status === 'ended' && (stage === 'test' || stage === 'wait' || stage === 'count')) submit(true);
    if (stage === 'done') showResult(lastResult);
  }

  // ---------------------------------------------------------------- test
  function startTest() {
    show('test'); setTimeout(() => { if (stage === 'test' && !document.body.classList.contains('locked')) hero.pause(); }, 700);
    $('#tTitle').textContent = meta.title || 'Test';
    $('#tAgent').textContent = name + ' · code ' + code;
    $('#qlist').innerHTML = EL.renderTest(questions, order, answers);
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

  function tickTimer() {
    const el = $('#timer');
    const tl = Number(meta.timeLimit) || 0;
    const start = meta.startedAt || B.now();
    if (!tl) { el.textContent = EL.fmtTime(B.now() - start); el.className = 'timer mono'; return; }
    const left = start + tl * 60000 + (Number(meta.extraMs) || 0) - B.now();
    el.textContent = EL.fmtTime(left);
    el.className = 'timer mono' + (left < 60000 ? ' crit' : left < 300000 ? ' warn' : '');
    if (left <= 0 && !submitted) submit(true);
  }

  // ---------------------------------------------------------------- leave detection + lock
  function goAway(reason) {
    if (stage !== 'test' || submitted || away) return;
    away = true; awayStart = Date.now();
    lockSeq++; leaves++;
    evalLock();                      // lock locally first; the network may be frozen while away
    B.update(P(), { away: true, lockSeq, leaves, lastLeave: B.now() });
    event('left', { reason });
  }
  function comeBack() {
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

  function evalLock() {
    const byLeave = lockSeq > (Number(control.unlockSeq) || 0);
    const locked = stage === 'test' && !submitted && (byLeave || !!control.forceLock);
    const ov = $('#lock');
    if (locked) {
      if (!wasLocked) {
        ov.classList.remove('hidden', 'unlocking');
        document.body.classList.add('locked');
        hero.resume(); heroTo('lock'); hero.setState('lock'); hero.snap();
        $('#lkTime').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (document.activeElement) document.activeElement.blur();
      }
      $('#lkCount').textContent = leaves;
      ov.querySelector('h1').textContent = byLeave ? 'You left the test' : 'Paused by your teacher';
      $('#lockMsg').textContent = byLeave
        ? 'Your teacher has been notified. Raise your hand. Only your teacher can unlock this screen.'
        : 'Your teacher paused your screen. Please wait.';
    } else if (wasLocked) {
      ov.classList.add('unlocking');
      hero.setState('ok'); hero.setOpen(true); sfx.granted();
      setTimeout(() => {
        ov.classList.add('hidden'); document.body.classList.remove('locked'); hero.setOpen(false);
        if (stage === 'test') hero.pause();
      }, 1100);
      EL.toast('<b>Unlocked</b><br><span class="muted">Your teacher unlocked your test. Carry on.</span>', 'green');
    }
    wasLocked = locked;
  }

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
    show('done'); hero.resume(); heroTo('done'); hero.setState('ok'); hero.setOpen(true);
    $('#doneTitle').textContent = auto ? 'Time is up. Test submitted.' : 'Test submitted';
    sfx.ok();
    showResult(lastResult);
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
    show('msg'); hero.resume(); heroTo('done'); hero.setState('lock');
  }

  boot();
})();
