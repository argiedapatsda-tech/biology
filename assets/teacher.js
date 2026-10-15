(function () {
  const B = Backend, { $, $$, esc, sfx, icon } = EL;
  EL.paintIcons();
  BioBG.start({ level: .85 });
  const S = {
    uid: null, code: null, meta: null, students: {}, control: {}, events: {}, key: {}, questions: [], paper: null, overrides: {},
    selected: null, tab: 'screen', zoom: 'read', tests: {}, history: {}, editing: null, dirty: false, sound: true,
    kind: 'test', mode: 'slides', slides: [], deck: null
  };
  const isPres = () => S.kind === 'present';
  // a presentation either sends picture slides, or streams the teacher's screen (PowerPoint with animations)
  const isScreen = () => isPres() && S.mode === 'screen';
  const SS = { code: null, stream: null, peers: {} };   // screen sharing: the stream and one connection per student
  const stText = st => st === 'active' && isPres() ? 'Watching' : STATUS_TXT[st];
  let sessionSubs = [], renderQueued = false;
  const seenEvents = new Set(); let eventsPrimed = false;
  const resultCache = {};
  const studentURL = c => new URL('student.html' + (c ? '?c=' + c : ''), location.href).href;
  const STATUS_TXT = { active: 'Working', waiting: 'Waiting', away: 'Left the test', locked: 'Locked', submitted: 'Submitted', offline: 'Offline', kicked: 'Removed' };
  const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  // ================================================================ helpers
  function confirmBox(title, body, yes, danger) {
    return new Promise(res => {
      $('#tcTitle').textContent = title; $('#tcBody').textContent = body || '';
      $('#tcYes').textContent = yes || 'Confirm';
      $('#tcYes').className = 'btn ' + (danger ? 'solid-danger' : 'primary');
      $('#tConfirm').classList.remove('hidden');
      const done = v => { $('#tConfirm').classList.add('hidden'); $('#tcYes').onclick = $('#tcNo').onclick = null; res(v); };
      $('#tcYes').onclick = () => done(true); $('#tcNo').onclick = () => done(false);
    });
  }
  const play = n => { if (S.sound) sfx[n](); };
  const P = p => `sessions/${S.code}/${p}`;
  const busy = t => { $('#busyTxt').textContent = t || ''; $('#busy').classList.toggle('hidden', !t); };

  // ================================================================ sign in
  async function initAuth() {
    const u = await B.authReady;
    if (B.mode === 'demo') {
      $('#authForm').classList.add('hidden'); $('#demoAuth').classList.remove('hidden');
      if (u && u.email) enterApp();
    } else if (u && u.email) enterApp();
  }
  const authMsg = e => {
    const c = (e && e.code) || '';
    if (c.includes('invalid') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Wrong email or password.';
    if (c.includes('email-already')) return 'That email already has an account. Press Sign in.';
    if (c.includes('weak-password')) return 'Password must be at least 6 characters.';
    if (c.includes('operation-not-allowed')) return 'Email sign-in is not switched on in Firebase yet.';
    return (e && e.message) || String(e);
  };
  $('#authForm').addEventListener('submit', async e => {
    e.preventDefault(); sfx.unlock();
    try { await B.signInEmail($('#aEmail').value.trim(), $('#aPass').value); enterApp(); }
    catch (ex) { $('#aErr').textContent = authMsg(ex); }
  });
  if ($('#aCreate')) $('#aCreate').addEventListener('click', async () => {
    sfx.unlock();
    try { await B.createEmail($('#aEmail').value.trim(), $('#aPass').value); enterApp(); }
    catch (ex) { $('#aErr').textContent = authMsg(ex); }
  });
  $('#demoBtn').addEventListener('click', async () => { sfx.unlock(); await B.signInEmail(); enterApp(); });
  $('#logoutBtn').addEventListener('click', async () => { await B.signOut(); location.reload(); });

  function enterApp() {
    S.uid = B.uid();
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    BioBG.setLevel(.8);
    const mp = $('#modePill');
    mp.className = 'modepill ' + (B.mode === 'demo' ? 'demo' : 'online');
    mp.title = B.mode === 'demo' ? 'Demo: this browser only' : 'Online: iPads can join';
    mp.querySelector('span').textContent = B.mode === 'demo' ? 'Demo · this browser only' : 'Online';
    B.on(`teachers/${S.uid}/tests`, t => { S.tests = t || {}; renderTestList(); });
    B.on(`teachers/${S.uid}/folders`, f => { S.folders = f || {}; renderTestList(); if (S.editing) fillFolderSelect(); });
    B.on(`teachers/${S.uid}/history`, h => { S.history = h || {}; renderArchive(); });
    renderSetup();
    let active = null; try { active = localStorage.getItem('examlock-active-' + S.uid); } catch (e) {}
    if (active) openSession(active); else showLiveEmpty();
    setInterval(tick, 1000); tick();
  }

  // ================================================================ navigation
  function go(v) {
    $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    ['live', 'tests', 'make', 'present', 'archive', 'setup'].forEach(x => $('#v-' + x).classList.toggle('hidden', x !== v));
  }
  $('#nav').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.v === 'archive') { $('#arcDetail').classList.add('hidden'); $('#arcListWrap').classList.remove('hidden'); }
    if (b.dataset.v === 'live' && !S.code) showLiveEmpty(false);
    go(b.dataset.v);
  });
  $('#goTests').addEventListener('click', () => go('tests'));
  // dashboard tiles
  $('#emptyIdle').addEventListener('click', e => {
    const t = e.target.closest('[data-go]'); if (!t) return;
    if (t.dataset.go === 'new') { go('tests'); $('#newTest').click(); } else go(t.dataset.go);
  });
  $('#soundBtn').addEventListener('click', () => { S.sound = !S.sound; $('#soundBtn').textContent = S.sound ? 'Sound on' : 'Sound off'; sfx.unlock(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#projector').classList.contains('hidden')) closeProjector(); else if (!$('#presFull').classList.contains('hidden')) closeFull(); else if (S.selected && document.activeElement !== $('#chatInput')) closeStudent();
  });

  // ================================================================ live session
  function showLiveEmpty(ended) {
    $('#liveEmpty').classList.remove('hidden'); $('#liveMain').classList.add('hidden');
    $('#emptyIdle').classList.toggle('hidden', !!ended); $('#emptyEnded').classList.toggle('hidden', !ended);
  }
  $('#endTests').addEventListener('click', () => { showLiveEmpty(false); go('tests'); });
  $('#endOpen').addEventListener('click', () => { const c = $('#endOpen').dataset.c; showLiveEmpty(false); openMarksheet(c); });

  // The test is over: work out every score, save a summary, and clear the live screen.
  let finishing = false;
  async function finishSession() {
    if (finishing || !S.code) return;
    finishing = true;
    const code = S.code, ids = Object.keys(S.students).filter(id => statusOf(id) !== 'kicked');
    const grades = ids.map(id => gradeOf(id));
    const avg = grades.length ? Math.round(grades.reduce((a, g) => a + g.pct, 0) / grades.length) : 0;
    const pres = isPres(), leftN = ids.filter(id => (S.students[id].leaves || 0) > 0).length;
    const summary = pres
      ? { kind: 'present', mode: S.mode, title: S.meta.title || 'Lesson', createdAt: S.meta.createdAt || B.now(), endedAt: S.meta.endedAt || B.now(), n: S.slides.length, students: ids.length, left: leftN }
      : { title: S.meta.title || 'Test', createdAt: S.meta.createdAt || B.now(), endedAt: S.meta.endedAt || B.now(), n: metaSets(S.meta) ? EL.asArray(metaSets(S.meta)[0].ids).length : S.questions.length, students: ids.length, avg, testId: S.meta.testId || null, pending: grades.reduce((a, g) => a + g.pending, 0) };
    try { await B.update(`teachers/${S.uid}/history/${code}`, summary); } catch (e) { console.error(e); }
    sessionSubs.forEach(u => u()); sessionSubs = [];
    try { localStorage.removeItem('examlock-active-' + S.uid); } catch (e) {}
    closeStudent(); closeProjector(); closeFull(); stopShare();
    for (const k of Object.keys(alarmLog)) delete alarmLog[k];
    S.code = null; S.meta = null; S.students = {}; rowEls.clear(); $('#roster').innerHTML = '';
    $('#endTitle').textContent = summary.title;
    $('#endSum').textContent = pres
      ? (ids.length ? `${ids.length} student${ids.length === 1 ? '' : 's'} watched · ${leftN} left the page at least once. Attendance is saved in Past results.` : 'Nobody joined this lesson.')
      : (ids.length ? `${ids.length} student${ids.length === 1 ? '' : 's'} · class average ${avg}%. Every answer is marked and saved in Past results.` : 'Nobody joined this test.');
    $('#endLabel').textContent = pres ? 'Lesson finished' : 'Test finished';
    $('#endOpen').textContent = pres ? 'See attendance' : 'See mark sheet';
    S.kind = 'test'; S.mode = 'slides'; S.slides = []; document.body.classList.remove('presenting', 'screenmode');
    $('#endOpen').dataset.c = code;
    showLiveEmpty(true);
    play('ok');
    finishing = false;
  }

  async function openSession(code) {
    sessionSubs.forEach(u => u()); sessionSubs = [];
    seenEvents.clear(); eventsPrimed = false;
    Object.assign(S, { code, meta: null, students: {}, control: {}, events: {}, key: {}, questions: [], paper: null, overrides: {}, selected: null, slides: [] });
    assigning = {};
    rowEls.clear(); $('#roster').innerHTML = ''; feedKeys.clear(); $('#feed').innerHTML = '';
    closeStudent();
    if (SS.code && SS.code !== code) stopShare();
    const meta = await B.get(`sessions/${code}/meta`);
    if (!meta) { try { localStorage.removeItem('examlock-active-' + S.uid); } catch (e) {} S.code = null; return showLiveEmpty(); }
    try { localStorage.setItem('examlock-active-' + S.uid, code); } catch (e) {}
    S.kind = meta.kind === 'present' ? 'present' : 'test';
    S.mode = meta.mode === 'screen' ? 'screen' : 'slides';
    document.body.classList.toggle('presenting', isPres());
    document.body.classList.toggle('screenmode', isScreen());
    $('#stats').innerHTML = ''; $('#mActions').dataset.sig = '';
    if (!isPres() && S.tab !== 'screen') { S.tab = 'screen'; $$('#fpTabs > button').forEach(x => x.classList.toggle('on', x.dataset.t === 'screen')); ['screen', 'answers', 'log'].forEach(t => $('#dt-' + t).classList.toggle('hidden', t !== 'screen')); $('#zoomSeg').classList.remove('hidden'); }
    $('#quick').innerHTML = (isPres()
      ? ['Please look at the slide.', 'Please stay on this page.', "I'm coming to you.", 'Put your iPad down for now.']
      : ['Read the question again carefully.', "I'm coming to you.", 'Please stay on the test page.', 'You have 5 minutes left.']).map(t => `<button>${esc(t)}</button>`).join('');
    if (isScreen()) {
      S.questions = []; S.paper = null; S.key = {};
      // reopened (e.g. after a reload): nothing is being shared until the teacher picks the window again
      if (!SS.stream && meta.status !== 'ended') B.update(`sessions/${code}/meta`, { sharing: false });
      showPreview();
    } else if (isPres()) {
      // the slides travel in the "questions" list, which students may read one item at a time
      busy('Loading the slides…');
      try { S.slides = EL.asArray(await B.get(P('questions'))).map(x => x && x.img).filter(Boolean); } finally { busy(''); }
      S.questions = []; S.paper = null; S.key = {};
    } else {
      const split = EL.splitPaper(await B.get(P('questions')));
      S.questions = split.questions; S.paper = split.paper;
      S.key = (await B.get(P('key'))) || {};
    }
    $('#liveEmpty').classList.add('hidden'); $('#liveMain').classList.remove('hidden');
    $('#mCode').textContent = code;
    sessionSubs.push(B.on(P('meta'), m => { if (!m) return; S.meta = m; renderBar(); queue(); if (isPres() && !isScreen()) renderSlide(); rtcSync(); if (m.status === 'ended') setTimeout(finishSession, 1500); }));
    sessionSubs.push(B.on(P('students'), s => { S.students = s || {}; queue(); rtcSync(); }));
    sessionSubs.push(B.on(P('control'), c => { S.control = c || {}; queue(); rtcSync(); }));
    sessionSubs.push(B.on(P('overrides'), o => { S.overrides = o || {}; queue(); }));
    sessionSubs.push(B.on(P('events'), ev => onEvents(ev || {})));
    go('live');
  }

  function statusOf(sid) {
    const s = S.students[sid] || {}, c = S.control[sid] || {};
    if (c.kicked) return 'kicked';
    if (s.status === 'submitted') return 'submitted';
    // only a student who is still locked counts as "left"; once unlocked the alert clears
    if ((s.lockSeq || 0) > (c.unlockSeq || 0) || c.forceLock) return s.away ? 'away' : 'locked';
    if (s.online === false) return 'offline';
    return s.status === 'testing' || s.status === 'watching' ? 'active' : 'waiting';
  }
  // A test made in sets: meta.sets = [{ n: 'A', ids: [...] }]. Each student answers only their set.
  const metaSets = m => m && m.sets ? EL.asArray(m.sets) : null;
  function setOfIn(sid, students, control) {
    const s = students[sid] || {}, c = control[sid] || {};
    return s.set != null ? Number(s.set) : c.set != null ? Number(c.set) : null;
  }
  const setOf = sid => setOfIn(sid, S.students, S.control);
  function qsFor(all, sets, set) {
    if (!sets || set == null || !sets[set]) return all;
    const ids = new Set(EL.asArray(sets[set].ids));
    return all.filter(q => ids.has(q.id));
  }
  const qsOf = sid => qsFor(S.questions, metaSets(S.meta), setOf(sid));
  const gradeOf = sid => EL.grade(qsOf(sid), S.key, (S.students[sid] || {}).answers, S.overrides[sid]);
  const multiSets = () => { const m = metaSets(S.meta); return m && m.length > 1 ? m : null; };
  // online: sets are shared out evenly as students join (A, B, C, D, A, B …, with a random pick among the emptiest)
  let assigning = {};
  function assignSets() {
    const sets = multiSets(); if (!sets || isPres()) return;
    const count = sets.map(() => 0), ids = rosterOrder();
    ids.forEach(id => { const k = setOf(id) != null ? setOf(id) : assigning[id]; if (k != null && count[k] != null) count[k]++; });
    for (const id of ids) {
      if (setOf(id) != null || assigning[id] != null || statusOf(id) === 'kicked') continue;
      const min = Math.min(...count), low = count.map((c, i) => c === min ? i : -1).filter(i => i >= 0);
      const k = low[Math.floor(Math.random() * low.length)];
      assigning[id] = k; count[k]++;
      B.update(P('control/' + id), { set: k });
    }
  }

  function queue() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderAll(); }); }
  // when every student has submitted, the test ends by itself
  let autoEnding = false;
  function checkAllDone() {
    const m = S.meta; if (!m || m.status !== 'live' || autoEnding || isPres()) return;
    const ids = Object.keys(S.students).filter(id => statusOf(id) !== 'kicked');
    if (ids.length && ids.every(id => statusOf(id) === 'submitted')) {
      autoEnding = true;
      EL.toast('<b>Everyone has submitted.</b><br><span class="muted">Ending the test and saving the results.</span>', 'green', 5000);
      Promise.resolve(B.update(P('meta'), { status: 'ended', endedAt: B.now() })).finally(() => { autoEnding = false; });
    }
  }
  function renderAll() {
    if (!S.code) return;
    checkAllDone(); assignSets();
    renderStats(); renderRoster(); renderAlerts();
    if (isPres() && fullOpen()) bumpFullQuiet();
    if (S.selected) renderStudent();
    syncResults();
    renderBar();
  }

  // ---------------- header + actions
  function renderBar() {
    const m = S.meta; if (!m) return;
    $('#mTitle').textContent = m.title || 'Test';
    const st = m.status;
    $('#mStatus').className = 'pill ' + (st === 'live' ? 'live' : st === 'ended' ? 'ended' : 'waiting');
    $('#mStatus').textContent = isPres() ? (st === 'ended' ? 'Lesson ended' : 'Presenting') : st === 'live' ? 'Test in progress' : st === 'ended' ? 'Test ended' : 'Waiting for students';
    const sig = S.kind + '|' + S.mode + '|' + st + '|' + !!m.release + '|' + !!SS.stream;
    if ($('#mActions').dataset.sig === sig) return;
    $('#mActions').dataset.sig = sig;
    const btn = (act, ic, label, cls) => `<button class="btn sm ${cls || ''}" data-mact="${act}">${ic ? icon(ic) : ''}${label}</button>`;
    let h = '';
    if (isPres()) {
      h += (isScreen() ? (SS.stream ? btn('share', 'present', 'Share a different window') : btn('share', 'present', 'Share my screen', 'green')) : btn('full', 'play', 'Present full screen', 'green')) + btn('end', 'stop', 'End lesson', 'danger') + btn('lockall', 'pause', 'Pause everyone', 'warn') + btn('unlockall', 'unlock', 'Unlock everyone');
      h += '<span class="sep"></span>' + btn('projector', 'qr', 'Join screen') + btn('csv', 'download', 'Attendance');
      $('#mActions').innerHTML = h;
      return;
    }
    if (st === 'waiting') h += btn('start', 'play', 'Start the test', 'green');
    if (st === 'live') h += btn('end', 'stop', 'End test', 'danger') + btn('time', 'clock', '+5 min') + btn('lockall', 'pause', 'Pause everyone', 'warn') + btn('unlockall', 'unlock', 'Unlock everyone');
    h += '<span class="sep"></span>';
    h += btn('projector', 'qr', 'Join screen');
    h += btn('release', 'score', m.release ? 'Scores shown ✓' : 'Show scores', m.release ? 'on' : '');
    h += btn('csv', 'download', 'Download results');
    $('#mActions').innerHTML = h;
  }
  $('#mActions').addEventListener('click', async e => {
    const b = e.target.closest('[data-mact]'); if (!b) return;
    sfx.unlock();
    const a = b.dataset.mact, m = S.meta;
    if (a === 'start') { await B.update(P('meta'), { status: 'live', startedAt: B.now() }); play('granted'); }
    if (a === 'full') openFull();
    if (a === 'share') reshare();
    if (a === 'end' && isPres() && await confirmBox('End this lesson?', 'Every student screen closes and the attendance is saved.', 'End lesson', true)) {
      await B.update(P('meta'), { status: 'ended', endedAt: B.now(), ptr: null });
    }
    if (a === 'end' && !isPres() && await confirmBox('End this test?', 'Anyone still working will be submitted automatically. This cannot be undone.', 'End test', true)) {
      await B.update(P('meta'), { status: 'ended', endedAt: B.now() });
    }
    if (a === 'time') { await B.update(P('meta'), { extraMs: (Number(m.extraMs) || 0) + 300000 }); EL.toast('Added 5 minutes for everyone', 'green'); }
    if (a === 'lockall') { const u = {}; Object.keys(S.students).forEach(id => { if (statusOf(id) !== 'submitted') u[id + '/forceLock'] = true; }); if (Object.keys(u).length) await B.update(P('control'), u); B.push(P('events'), { sid: '*', name: 'Everyone', type: 'lock', at: B.now() }); }
    if (a === 'unlockall') unlockAll();
    if (a === 'release') await B.update(P('meta'), { release: !m.release });
    if (a === 'csv') exportCSV();
    if (a === 'projector') openProjector();
    if (a === 'close') { try { localStorage.removeItem('examlock-active-' + S.uid); } catch (x) {} sessionSubs.forEach(u => u()); sessionSubs = []; S.code = null; showLiveEmpty(); }
  });
  $('#codeChip').addEventListener('click', openProjector);

  // unlockSeq only ever goes up, and covers every leave the student has made so far
  const unlockTo = id => Math.max(Number((S.students[id] || {}).lockSeq) || 0, Number((S.control[id] || {}).unlockSeq) || 0);
  function unlock(sid) {
    const s = S.students[sid]; if (!s) return;
    B.update(P('control/' + sid), { unlockSeq: unlockTo(sid), forceLock: false });
    delete alarmLog[sid];
    B.push(P('events'), { sid, name: s.name, type: 'unlock', at: B.now() });
    play('ok');
  }
  function unlockAll() {
    const u = {};
    Object.keys(S.students).forEach(id => { u[id + '/unlockSeq'] = unlockTo(id); u[id + '/forceLock'] = false; delete alarmLog[id]; });
    if (Object.keys(u).length) B.update(P('control'), u);
    B.push(P('events'), { sid: '*', name: 'Everyone', type: 'unlock', at: B.now() });
    play('ok');
  }

  // ---------------- stats (numbers only change, the boxes stay put)
  function renderStats() {
    const ids = Object.keys(S.students);
    const c = { total: ids.length, active: 0, alert: 0, submitted: 0, offline: 0 };
    let sum = 0, n = 0;
    ids.forEach(id => {
      const st = statusOf(id);
      if (st === 'active') c.active++;
      if (st === 'away' || st === 'locked') c.alert++;
      if (st === 'offline') c.offline++;
      if (st === 'submitted') { c.submitted++; sum += gradeOf(id).pct; n++; }
    });
    if (!$('#stats').children.length) {
      $('#stats').innerHTML = (isPres() ? ['Joined', 'Watching', 'Left / locked', 'Offline', isScreen() ? 'See your screen' : 'Slide'] : ['Joined', 'Working', 'Left / locked', 'Submitted', 'Average score'])
        .map((l, i) => `<div class="stat ${['', 'green', 'red', 'amber', ''][i]}"><b>0</b><span>${l}</span></div>`).join('');
    }
    const vals = isPres() ? [c.total, c.active, c.alert, c.offline, isScreen() ? Object.values(SS.peers).filter(p => p.state === 'connected').length + '/' + c.total : ((Number(S.meta && S.meta.slide) || 0) + 1) + '/' + S.slides.length]
      : [c.total, c.active, c.alert, c.submitted, n ? Math.round(sum / n) + '%' : '–'];
    $$('#stats .stat').forEach((el, i) => { const b = el.firstElementChild; if (b.textContent !== String(vals[i])) b.textContent = vals[i]; });
    $$('#stats .stat')[2].classList.toggle('hot', c.alert > 0);
    $('#projCount').textContent = c.total + (c.total === 1 ? ' student joined' : ' students joined');
    $('#rosterLabel').textContent = `Students · ${c.total}`;
  }

  // ---------------- roster: fixed order (when they joined), rows are updated in place
  const rowEls = new Map();
  function rosterOrder() {
    return Object.keys(S.students).sort((a, b) => ((S.students[a].joinedAt || 0) - (S.students[b].joinedAt || 0)) || a.localeCompare(b));
  }
  function rowHTML(id) {
    const s = S.students[id], st = statusOf(id), mine = qsOf(id).length, total = mine || 1, ms = multiSets(), k = setOf(id);
    const sub = st === 'away' ? (isPres() ? 'Left the lesson now' : 'Left the test now') : st === 'locked' ? 'Locked · waiting for you'
      : st === 'submitted' && s.awayAfter ? 'Finished · outside the page now' : stText(st) + (isScreen() && st === 'active' ? ' · ' + screenTxt(id) : '');
    const prog = isPres() ? '' : `${ms && k != null ? `<span class="s-set" title="Test set">${EL.setLetter(k)}</span>` : ''}<span class="s-prog">${s.answered || 0}/${mine}</span>
        <span class="s-bar"><i style="transform:scaleX(${(s.answered || 0) / total})"></i></span>`;
    return `<div class="s-av">${esc(initials(s.name))}</div>
      <div class="s-main"><div class="s-name">${esc(s.name)}</div><div class="s-sub">${esc(sub)}</div></div>
      <div class="s-right">${prog}
        <span class="s-flags"><span class="s-msgbtn" data-msg="${id}" role="button" title="Send a private message">${icon('chat')}</span>${s.leaves ? `<span class="s-badge left" title="Times left the page">${icon('leave')}${s.leaves}</span>` : ''}${s.afterLeaves ? `<span class="s-badge after" title="Times left after finishing">${icon('leave')}${s.afterLeaves}</span>` : ''}</span></div>`;
  }
  function renderRoster() {
    const host = $('#roster');
    const ids = rosterOrder();
    if (!ids.length) {
      if (!host.querySelector('.empty-roster')) host.innerHTML = `<div class="empty-roster">No students yet. They scan the QR code or type the code<b>${esc(S.code || '')}</b></div>`;
      return;
    }
    const empty = host.querySelector('.empty-roster'); if (empty) empty.remove();
    const q = ($('#search').value || '').trim().toLowerCase();
    let prev = null;
    for (const id of ids) {
      let el = rowEls.get(id);
      if (!el) {
        el = document.createElement('button'); el.type = 'button'; el.className = 'srow'; el.dataset.sid = id;
        rowEls.set(id, el);
      }
      // keep DOM order equal to join order without touching rows that are already in place
      const want = prev ? prev.nextSibling : host.firstChild;
      if (want !== el) host.insertBefore(el, want);
      prev = el;
      const st = statusOf(id);
      const html = rowHTML(id);
      if (el._html !== html) { el.innerHTML = html; el._html = html; }
      if (el.dataset.st !== st) el.dataset.st = st;
      el.classList.toggle('alert', st === 'away' || st === 'locked');
      el.classList.toggle('dim', st === 'offline' || st === 'kicked');
      el.classList.toggle('warnafter', st === 'submitted' && !!S.students[id].awayAfter);
      el.classList.toggle('sel', id === S.selected);
      el.classList.toggle('hidden', !!q && !(S.students[id].name || '').toLowerCase().includes(q));
      el.title = S.students[id].name || '';
    }
    for (const [id, el] of rowEls) if (!S.students[id]) { el.remove(); rowEls.delete(id); }
  }
  $('#search').addEventListener('input', renderRoster);
  $('#roster').addEventListener('click', e => {
    const m = e.target.closest('[data-msg]'); if (m) { openStudent(m.dataset.msg, { chat: true }); return; }
    const r = e.target.closest('.srow'); if (r) openStudent(r.dataset.sid);
  });

  // who needs attention, listed above the roster so nobody has to move
  function renderAlerts() {
    const ids = rosterOrder().filter(id => { const st = statusOf(id); return st === 'away' || st === 'locked'; });
    const bar = $('#alertBar');
    if (!ids.length) { bar.classList.add('hidden'); bar.innerHTML = ''; bar._sig = ''; return; }
    const sig = ids.join(',');
    if (bar._sig === sig) return;
    bar._sig = sig;
    bar.innerHTML = `${icon('lock')}<b>${ids.length} need${ids.length === 1 ? 's' : ''} you:</b>` +
      ids.map(id => `<button data-sid="${id}">${esc(S.students[id].name)}</button>`).join('') +
      (ids.length > 1 ? `<button data-all="1" style="margin-left:auto">Unlock all</button>` : '');
    bar.classList.remove('hidden');
  }
  $('#alertBar').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.all) unlockAll(); else openStudent(b.dataset.sid);
  });

  // ---------------- activity feed (new lines are added, old lines never redraw)
  const feedKeys = new Set();
  const EV_TXT = e => ({
    join: 'joined', rejoin: 'reconnected', reload: 'reloaded the page (locked)',
    left: (isPres() ? 'left the lesson' : 'left the test') + (e.net === undefined ? (e.reason ? ' · ' + e.reason.toLowerCase() : '')
      : ' · pressed Home or opened another app' + (e.net === true ? ' · internet was ON' : e.net === false ? ' · internet was off then' : '')),
    back: 'came back after ' + EL.fmtDur(e.ms), net: 'lost internet for ' + EL.fmtDur(e.ms) + ' (stayed on the page)',
    submit: e.auto ? 'was auto-submitted' : 'submitted', leftafter: 'left the page after finishing', backafter: 'came back after finishing', unlock: 'unlocked by you', lock: 'paused by you', kick: 'removed by you'
  }[e.type] || e.type);
  function onEvents(ev) {
    S.events = ev;
    const list = Object.keys(ev).map(k => Object.assign({ k }, ev[k])).sort((a, b) => a.at - b.at);
    for (const e of list) {
      if (seenEvents.has(e.k)) continue;
      seenEvents.add(e.k);
      addFeed(e, eventsPrimed);
      if (!eventsPrimed) continue;
      if (e.type === 'left' || e.type === 'reload') {
        play('emergency'); alarmLog[e.sid] = { n: 1, last: Date.now() };
        if (fullOpen()) bumpFull();
        EL.toast(`<b>${esc(e.name)} left the ${isPres() ? 'lesson' : 'test'}</b><br><span class="muted">${e.type === 'reload' ? 'They reloaded the page.' : 'Pressed Home or opened another app. Their screen is now locked.'}${e.net === true ? '<br><b>Internet was working</b>: this alert came through it live.' : ''} Click to view.</span>`, 'red', 7000, () => openStudent(e.sid));
      } else if (e.type === 'join') { play('join'); }
      else if (e.type === 'leftafter') {
        play('alarm');
        EL.toast(`<b>${esc(e.name)} left the page after finishing</b><br><span class="muted">They may be looking things up for someone. Click to view.</span>`, 'amber', 8000, () => openStudent(e.sid));
      }
      else if (e.type === 'submit') { play('ok'); EL.toast(`<b>${esc(e.name)}</b> ${e.auto ? 'was auto-submitted' : 'submitted'}`, 'amber', 3000); }
    }
    eventsPrimed = true;
    if (!list.length && !$('#feed').children.length) $('#feed').innerHTML = '<div class="muted small" id="feedEmpty">Nothing yet.</div>';
    if (S.selected && S.tab === 'log') renderLog(S.selected);
  }
  function addFeed(e, isNew) {
    if (feedKeys.has(e.k)) return; feedKeys.add(e.k);
    const em = $('#feedEmpty'); if (em) em.remove();
    const d = document.createElement('div');
    d.className = 'feed-item ' + e.type + (isNew ? ' new' : '');
    d.innerHTML = `<time>${EL.clock(e.at).slice(0, 5)}</time><span><b>${esc(e.name)}</b> ${esc(EV_TXT(e))}</span>`;
    $('#feed').prepend(d);
    while ($('#feed').children.length > 120) $('#feed').lastChild.remove();
  }

  // ---------------- scores to students (only once released)
  function syncResults() {
    if (!S.meta || !S.meta.release) return;
    const u = {};
    Object.keys(S.students).forEach(id => {
      if (S.students[id].status !== 'submitted') return;
      const g = gradeOf(id); const v = { score: g.score, total: g.total };
      const sig = JSON.stringify(v);
      if (resultCache[S.code + id] !== sig) { resultCache[S.code + id] = sig; u[id] = v; }
    });
    if (Object.keys(u).length) B.update(P('results'), u);
  }

  // ================================================================ one student: live screen, answers, chat
  function openStudent(sid, opts) {
    if (!S.students[sid]) return;
    go('live');
    S.selected = sid;
    $('#liveBody').classList.add('focus'); $('#liveMain').classList.add('focus');
    $('#feedPanel').classList.add('hidden'); $('#focusPanel').classList.remove('hidden');
    $('#fpActions').dataset.sig = '';
    lastMirrorSig = ''; lastScrollY = -1; chatSig = '';
    $$('#fpTabs [data-t=screen], #fpTabs [data-t=answers]').forEach(b => b.classList.toggle('hidden', isPres()));
    if (isPres() && S.tab !== 'log') $('#fpTabs [data-t=log]').click();
    renderStudent(); renderRoster();
    if (opts && opts.chat) setTimeout(focusChat, 60);
  }
  // bring the private-message box into view and put the cursor in it
  function focusChat() {
    const box = $('#chatBox'), inp = $('#chatInput');
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    inp.focus({ preventScroll: true });
    box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
  }
  function closeStudent() {
    S.selected = null;
    $('#liveBody').classList.remove('focus'); $('#liveMain').classList.remove('focus');
    $('#focusPanel').classList.add('hidden'); $('#feedPanel').classList.remove('hidden');
    if (S.code) renderRoster();
  }
  $('#fpClose').addEventListener('click', closeStudent);
  $('#fpTabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.z) { S.zoom = b.dataset.z; $$('#zoomSeg button').forEach(x => x.classList.toggle('on', x === b)); lastScrollY = -1; renderStudent(); return; }
    if (!b.dataset.t) return;
    S.tab = b.dataset.t;
    $$('#fpTabs > button').forEach(x => x.classList.toggle('on', x === b));
    ['screen', 'answers', 'log'].forEach(t => $('#dt-' + t).classList.toggle('hidden', t !== S.tab));
    $('#zoomSeg').classList.toggle('hidden', S.tab !== 'screen');
    lastMirrorSig = ''; lastScrollY = -1; renderStudent();
  });

  function renderStudent() {
    const sid = S.selected, s = S.students[sid]; if (!s) return closeStudent();
    const st = statusOf(sid), c = S.control[sid] || {};
    $('#fpStatus').className = 'pill ' + st;
    $('#fpStatus').textContent = stText(st);
    $('#fpAvatar').textContent = initials(s.name);
    $('#fpName').textContent = s.name;
    $('#fpMeta').textContent = `${s.device || ''} · joined ${s.joinedAt ? EL.clock(s.joinedAt).slice(0, 5) : '–'} · left ${s.leaves || 0}× · away ${EL.fmtDur(s.awayMs)}`;
    const sig = st + '|' + !!c.forceLock + '|' + !!c.kicked;
    if ($('#fpActions').dataset.sig !== sig) {
      $('#fpActions').dataset.sig = sig;
      let h = `<button class="btn sm msg" data-dact="msg">${icon('chat')}Message</button>`;
      if (st === 'away' || st === 'locked') h += `<button class="btn sm green" data-dact="unlock">${icon('unlock')}Unlock</button>`;
      if (st !== 'submitted' && st !== 'kicked') h += c.forceLock ? `<button class="btn sm" data-dact="unfreeze">${icon('play')}Resume</button>` : `<button class="btn sm warn" data-dact="freeze">${icon('pause')}Pause</button>`;
      if (st !== 'kicked') h += `<button class="btn sm ghost" data-dact="kick" title="Remove from the test">${icon('trash')}</button>`;
      $('#fpActions').innerHTML = h;
    }
    if (S.tab === 'screen') renderMirror(s, st);
    if (S.tab === 'answers') renderAnswers(sid);
    if (S.tab === 'log') renderLog(sid);
    renderChat(sid);
  }
  $('#fpActions').addEventListener('click', async e => {
    const b = e.target.closest('[data-dact]'); if (!b) return;
    const sid = S.selected, s = S.students[sid], a = b.dataset.dact;
    if (a === 'msg') return focusChat();
    if (a === 'unlock') unlock(sid);
    if (a === 'freeze') { B.update(P('control/' + sid), { forceLock: true }); B.push(P('events'), { sid, name: s.name, type: 'lock', at: B.now() }); }
    if (a === 'unfreeze') B.update(P('control/' + sid), { forceLock: false, unlockSeq: unlockTo(sid) });
    if (a === 'kick' && await confirmBox('Remove ' + s.name + '?', 'Their screen will say they were removed. Their answers stay saved.', 'Remove', true)) {
      B.update(P('control/' + sid), { kicked: true }); B.push(P('events'), { sid, name: s.name, type: 'kick', at: B.now() });
    }
  });

  // The student's test is drawn at their real screen width, then scaled down, so their
  // scroll position lines up exactly. "Zoom in" fits the width instead of the whole screen.
  let lastMirrorSig = '', lastScrollY = -1;
  function renderMirror(s, st) {
    const v = s.view || {};
    const vw = v.vw || 820, vh = v.vh || 1180;
    const stage = $('#ffStage');
    const W = Math.max(200, stage.clientWidth - 24), H = Math.max(200, stage.clientHeight - 24);
    const scale = S.zoom === 'read' ? Math.min(1.15, W / vw) : Math.min(W / vw, H / vh);
    const cw = Math.round(vw * scale), ch = Math.round(Math.min(vh * scale, S.zoom === 'read' ? H : Infinity));
    $('#mClip').style.width = cw + 'px'; $('#mClip').style.height = ch + 'px';
    const scr = $('#mScreen');
    scr.style.width = vw + 'px'; scr.style.height = vh + 'px';
    scr.style.transform = `scale(${scale})`;
    const sig = JSON.stringify([s.answers || {}, s.order || [], v.fq || null, vw]);
    if (sig !== lastMirrorSig) {
      lastMirrorSig = sig;
      $('#mmList').innerHTML = EL.renderTest(S.questions, s.order, s.answers || {}, { readonly: true, paper: S.paper });
      if (v.fq) { const f = $(`#mmList .qcard[data-qid="${v.fq}"]`); if (f) f.classList.add('focus'); }
      lastScrollY = -1;
    }
    $('#mmTitle').textContent = (S.meta ? S.meta.title : '') + (multiSets() && setOf(S.selected) != null ? ' · Set ' + EL.setLetter(setOf(S.selected)) : '');
    $('#mmWho').textContent = (s.name || '') + ' · code ' + S.code;
    const n = s.answered || 0, mine = qsOf(S.selected).length, total = mine || 1;
    $('#mmProg').style.transform = `scaleX(${n / total})`;
    $('#mmProgTxt').textContent = n + ' / ' + mine;
    const y = v.y || 0;
    if (y !== lastScrollY) {
      const sc = $('#mScroll');
      if (lastScrollY < 0) sc.scrollTop = y; else sc.scrollTo({ top: y, behavior: 'smooth' });
      lastScrollY = y;
    }
    const veil = $('#mVeil');
    const set = (cls, h) => { if (veil._h === cls + h) return; veil._h = cls + h; veil.className = 'm-veil on ' + cls; veil.innerHTML = h; };
    if (st === 'away') set('red', `<div><div class="label red">Right now</div><h4>Left the test</h4><p>${esc(s.name)} is outside the test page.</p></div>`);
    else if (st === 'locked') set('red', `<div><div class="label red">Locked</div><h4>Waiting for you</h4><p>Their screen shows the red lock. Press Unlock when ready.</p></div>`);
    else if (st === 'waiting') set('blue', `<div><div class="label">Waiting room</div><h4>Not started</h4><p>Their test shows here once you start it.</p></div>`);
    else if (st === 'offline') set('blue', `<div><div class="label">No signal</div><h4>Offline</h4><p>Their iPad may be asleep or disconnected.</p></div>`);
    else if (st === 'kicked') set('blue', `<div><h4>Removed</h4></div>`);
    else if (veil._h) { veil._h = ''; veil.className = 'm-veil'; veil.innerHTML = ''; }
    const age = v.t ? Math.round((B.now() - v.t) / 1000) : null;
    const live = st === 'active' || st === 'away' || st === 'locked';
    $('#ffRec').classList.toggle('off', !live);
    $('#ffRec').textContent = st === 'submitted' ? 'FINAL' : live ? 'LIVE' : 'IDLE';
    $('#ffDevice').textContent = `${s.device || 'Device'} · ${vw}×${vh}`;
    $('#mirrorNote').textContent = st === 'submitted' ? 'Final answers' : age == null ? 'waiting for first movement' : 'last moved ' + (age < 2 ? 'just now' : EL.fmtDur(age * 1000) + ' ago');
  }
  window.addEventListener('resize', () => { if (S.selected && S.tab === 'screen') { lastScrollY = -1; renderStudent(); } if (isPres()) paintOwnPtr(); });

  // ---------------- one student's answers, for every question type
  const LT = EL.LETTERS;
  function plainAnswer(q, a) {
    if (!EL.isAnswered(q, a)) return '';
    if (q.type === 'mc') return LT[a] || a;
    if (q.type === 'tf') return a === 'true' ? 'True' : 'False';
    if (q.type === 'match') return EL.parts(a).map((v, k) => (k + 1) + '-' + (v === '' ? '?' : LT[v] || v)).join(' ');
    if (q.type === 'fill') return EL.parts(a).map((v, k) => '(' + (k + 1) + ') ' + v).join(' ');
    return String(a);
  }
  function fmtAnswer(q, a) {
    if (!EL.isAnswered(q, a)) return '<span class="muted">(no answer)</span>';
    if (q.type === 'mc') { const t = EL.asArray(q.options)[a]; return `<b>${LT[a]}</b>${t ? ' · ' + esc(t) : ''}`; }
    if (q.type === 'tf') return a === 'true' ? 'True' : 'False';
    if (q.type === 'match') { const R = EL.asArray(q.right); return EL.parts(a, EL.asArray(q.left).length).map((v, k) => `<span class="pair">${k + 1} → <b>${v === '' ? '–' : LT[v]}</b>${v !== '' && R[v] ? ' ' + esc(R[v]) : ''}</span>`).join(''); }
    if (q.type === 'fill') return EL.parts(a).map((v, k) => `<span class="pair">(${k + 1}) <b>${v ? esc(v) : '–'}</b></span>`).join('');
    return `<span class="long">${esc(a)}</span>`;
  }
  function fmtKeyOf(q, k) {
    if (q.type === 'mc') { if (k == null) return '–'; const t = EL.asArray(q.options)[k]; return `<b>${LT[k]}</b>${t ? ' · ' + esc(t) : ''}`; }
    if (q.type === 'tf') return k === 'true' ? 'True' : 'False';
    if (q.type === 'match') { const R = EL.asArray(q.right); return EL.asArray(k).map((r, i) => `<span class="pair">${i + 1} → <b>${LT[r]}</b> ${esc(R[r] || '')}</span>`).join(''); }
    if (q.type === 'fill') return EL.asArray(k).map((acc, i) => `<span class="pair">(${i + 1}) <b>${EL.asArray(acc).map(esc).join(' / ')}</b></span>`).join('');
    if (q.type === 'essay') return k ? `<span class="long">${esc(k)}</span>` : '<span class="muted">no model answer</span>';
    const arr = EL.asArray(k); return arr.length ? arr.map(esc).join(' <span class="muted">or</span> ') : '<span class="muted">you mark this one</span>';
  }
  const fmtKey = q => fmtKeyOf(q, S.key[q.id]);
  const handMarked = q => ['short', 'essay', 'fill', 'match'].includes(q.type);
  const STATE_TXT = { ok: 'Correct', bad: 'Wrong', part: 'Part marks', pend: 'To mark', blank: 'No answer' };
  const stateOf = (g, q) => { const st = g.state[q.id]; if (st !== 'set') return st; const pts = Number(q.points) || 1; return g.got[q.id] >= pts ? 'ok' : g.got[q.id] > 0 ? 'part' : 'bad'; };
  function renderAnswers(sid) {
    const s = S.students[sid], g = gradeOf(sid), ov = S.overrides[sid] || {};
    const byId = {}; S.questions.forEach(q => { byId[q.id] = q; });
    const order = (s.order && s.order.length ? s.order : qsOf(sid).map(q => q.id)).filter(id => byId[id]);
    const ms = multiSets(), k = setOf(sid);
    const html = `<div class="ans-sum"><b>${EL.fmtPts(g.score)} / ${g.total}</b><span class="muted">${g.pct}%${ms && k != null ? ' · Set ' + EL.setLetter(k) : ''} · marked automatically${Object.keys(ov).length ? ' + your marks' : ''}${g.pending ? ` · <b style="color:var(--amber)">${g.pending} to mark</b>` : ''}</span></div>` +
      order.map((id, i) => {
        const q = byId[id], a = (s.answers || {})[id], st = stateOf(g, q), pts = Number(q.points) || 1;
        const own = ov[id] != null;
        const sug = q.type === 'short' && !own && st !== 'blank' ? ' (suggested)' : '';
        let ctl = '';
        if (handMarked(q) && st !== 'blank') {
          ctl = `<label class="ov-pts">Points <input class="input sm ovpts" type="number" min="0" max="${pts}" step="0.5" data-q="${id}" value="${own || st !== 'pend' ? EL.fmtPts(g.got[id]) : ''}" placeholder="?"> / ${pts}</label>`;
          if (q.type === 'short' || q.type === 'essay') ctl += `<button class="btn sm" data-ov="full" data-q="${id}">Full marks</button><button class="btn sm" data-ov="0" data-q="${id}">0</button>`;
          if (own) ctl += `<button class="btn sm ghost" data-ov="auto" data-q="${id}">Undo</button>`;
        }
        return `<div class="ans-row ${st === 'ok' ? 'ok' : st === 'part' ? 'part' : st === 'pend' ? 'pend' : 'bad'}">
          <div class="ans-q"><b>${q.sheet ? q.n : i + 1}</b>${q.sheet ? '<span class="muted">Answer sheet</span>' : esc(q.type === 'fill' ? String(q.text).replace(/\[\[\]\]/g, '____') : q.text)}</div>
          <div class="ans-line"><span>Answer</span><span>${fmtAnswer(q, a)}</span></div>
          <div class="ans-line"><span>${q.type === 'essay' ? 'Model' : 'Correct'}</span><span>${fmtKey(q)}</span></div>
          <div class="ans-mark"><span class="pill ${st === 'ok' ? 'active' : st === 'pend' || st === 'part' ? 'submitted' : 'away'}">${STATE_TXT[st]}${sug} · ${st === 'pend' ? '?' : EL.fmtPts(g.got[id])}/${pts}</span>${ctl}</div></div>`;
      }).join('');
    if ($('#dt-answers')._h !== html) { $('#dt-answers')._h = html; $('#dt-answers').innerHTML = html; }
  }
  const qById = id => S.questions.find(q => q.id === id) || {};
  $('#dt-answers').addEventListener('click', e => {
    const b = e.target.closest('[data-ov]'); if (!b) return;
    const v = b.dataset.ov, q = qById(b.dataset.q);
    B.update(P('overrides/' + S.selected), { [b.dataset.q]: v === 'auto' ? null : v === 'full' ? (Number(q.points) || 1) : 0 });
  });
  $('#dt-answers').addEventListener('change', e => {
    const i = e.target.closest('.ovpts'); if (!i) return;
    const q = qById(i.dataset.q), pts = Number(q.points) || 1;
    const v = i.value.trim() === '' ? null : Math.max(0, Math.min(pts, Math.round(Number(i.value) * 2) / 2 || 0));
    B.update(P('overrides/' + S.selected), { [i.dataset.q]: v });
  });
  function renderLog(sid) {
    const list = Object.values(S.events || {}).filter(e => e.sid === sid || e.sid === '*').sort((a, b) => b.at - a.at);
    const html = list.map(e => `<div class="log-item ${e.type}"><time>${EL.clock(e.at)}</time><span>${esc(EV_TXT(e))}</span></div>`).join('') || '<p class="muted">Nothing yet.</p>';
    if ($('#dt-log')._h !== html) { $('#dt-log')._h = html; $('#dt-log').innerHTML = html; }
  }

  // ---------------- messages to one student (one-way; stored at students/<id>/chat, so only that student sees them)
  let chatSig = '';
  const sentTo = sid => Object.entries((S.students[sid] || {}).chat || {}).map(([k, m]) => Object.assign({ k }, m)).filter(m => m.from === 't').sort((a, b) => a.at - b.at);
  function renderChat(sid) {
    const s = S.students[sid], list = sentTo(sid), first = (s.name || '').split(' ')[0];
    $('#chatTitle').textContent = 'Message ' + first;
    $('#chatTo').textContent = 'only ' + first + ' sees it · no replies';
    $('#chatInput').placeholder = 'Type a message to ' + first + '…';
    const sig = sid + '|' + list.map(m => m.k + (m.seen ? 's' : '')).join(',');
    if (sig === chatSig) return;
    chatSig = sig;
    const host = $('#chatList');
    host.innerHTML = list.length ? list.map(m => `<div class="bubble me">${esc(m.text)}<time>${EL.clock(m.at).slice(0, 5)} · ${m.seen ? 'seen ✓' : 'sent'}</time></div>`).join('')
      : `<div class="chat-empty">${icon('chat')}<br>Send ${esc(first)} a message.<br>It pops up on their screen. They can't reply.</div>`;
    host.scrollTop = host.scrollHeight;
  }
  function sendChat(text) {
    text = String(text || '').trim(); if (!text || !S.selected) return;
    B.push(P('students/' + S.selected + '/chat'), { from: 't', text: text.slice(0, 300), at: B.now() });
    play('select');
  }
  $('#chatForm').addEventListener('submit', e => { e.preventDefault(); sendChat($('#chatInput').value); $('#chatInput').value = ''; });
  $('#quick').addEventListener('click', e => { const b = e.target.closest('button'); if (b) sendChat(b.textContent); });

  // ================================================================ results file
  function exportCSV() {
    if (isPres()) return attendanceCSV(S.meta, S.students, S.control, S.code);
    const qs = S.questions;
    const head = ['Name', 'Set', 'Status', 'Score', 'Total', 'Percent', 'Times left', 'Seconds away', 'Device', 'Joined', 'Submitted'].concat(qs.map((q, i) => 'Q' + (q.sheet ? q.n : i + 1)));
    const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = Object.keys(S.students).map(id => {
      const s = S.students[id], g = gradeOf(id), a = s.answers || {};
      return [s.name, setOf(id) != null && multiSets() ? EL.setLetter(setOf(id)) : '', STATUS_TXT[statusOf(id)], g.score, g.total, g.pct, s.leaves || 0, Math.round((s.awayMs || 0) / 1000), s.device,
        s.joinedAt ? new Date(s.joinedAt).toLocaleString() : '', s.submittedAt ? new Date(s.submittedAt).toLocaleString() : '']
        .concat(qs.map(q => plainAnswer(q, a[q.id])));
    }).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
    const csv = '﻿' + [head].concat(rows).map(r => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${(S.meta.title || 'test').replace(/[^\w\- ]+/g, '').trim() || 'test'}_${S.code}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ================================================================ join screen
  function openProjector() {
    if (!S.code) return;
    $('#projector').classList.remove('hidden');
    $('#projTitle').textContent = S.meta ? S.meta.title : '';
    $('#projLabel').textContent = isPres() ? 'Join the lesson' : 'Join the test';
    $('#projUrl').textContent = studentURL().replace(/^https?:\/\//, '');
    $('#projCode').textContent = S.code;
    $('#projQr').innerHTML = '';
    if (window.QRCode) new QRCode($('#projQr'), { text: studentURL(S.code), width: 320, height: 320, colorDark: '#08090b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    else $('#projQr').innerHTML = '<div style="color:#000;padding:20px">QR needs internet</div>';
  }
  function closeProjector() { $('#projector').classList.add('hidden'); }
  $('#projClose').addEventListener('click', closeProjector);

  // ================================================================ clock
  // the emergency tone repeats every 7 s (up to 5 times) until that student is dealt with
  const alarmLog = {};
  function repeatAlarm() {
    let due = false;
    for (const sid of Object.keys(alarmLog)) {
      const st = statusOf(sid), a = alarmLog[sid];
      if (st !== 'away' && st !== 'locked') { delete alarmLog[sid]; continue; }
      if (S.selected === sid) continue;
      if (a.n < 5 && Date.now() - a.last > 7000) { a.n++; a.last = Date.now(); due = true; }
    }
    if (due) play('emergency');
  }
  document.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
  function tick() {
    repeatAlarm();
    ssStats();
    const m = S.meta; if (!m || !S.code) return;
    const n = Object.keys(S.students).length;
    let sub = `${metaSets(m) ? EL.asArray(metaSets(m)[0].ids).length : S.questions.length} questions · code ${S.code}`;
    let timerTxt = '--:--', cls = '';
    if (isPres()) {
      sub = isScreen() ? `${SS.stream ? 'Sharing your screen' : 'Not sharing'} · code ${S.code} · ${n} watching`
        : `Slide ${(Number(m.slide) || 0) + 1} of ${S.slides.length} · code ${S.code} · ${n} watching`;
      timerTxt = m.status === 'ended' ? 'Ended' : EL.fmtTime(B.now() - (m.startedAt || B.now()));
    } else if (m.status === 'live' && m.startedAt) {
      const tl = Number(m.timeLimit) || 0;
      if (tl) {
        const left = m.startedAt + tl * 60000 + (Number(m.extraMs) || 0) - B.now();
        sub += ' · time left'; timerTxt = EL.fmtTime(left); cls = left < 60000 ? 'crit' : left < 300000 ? 'warn' : '';
        // time is up: end the test for everyone (a few seconds' grace lets the last answers arrive)
        if (left < -3000 && !autoEnding) {
          autoEnding = true;
          EL.toast("<b>Time's up.</b><br><span class=\"muted\">The test is ended and the results are saved.</span>", 'green', 5000);
          Promise.resolve(B.update(P('meta'), { status: 'ended', endedAt: B.now() })).finally(() => { autoEnding = false; });
        }
      } else { sub += ' · time running'; timerTxt = EL.fmtTime(B.now() - m.startedAt); }
    } else if (m.status === 'waiting') sub += ` · ${n} waiting`;
    else if (m.status === 'ended') timerTxt = 'Ended';
    $('#mSub').textContent = sub;
    $('#mClock').textContent = timerTxt; $('#mClock').className = 'lh-clock ' + cls;
    $('#mmTimer').textContent = timerTxt;
    if (S.selected && S.tab === 'screen') { const s = S.students[S.selected]; if (s) renderMirror(s, statusOf(S.selected)); }
  }

  // ================================================================ tests editor
  // ---------------- folders: teachers/<uid>/folders/<id> = { name, createdAt }; a test keeps its folder id in t.folder
  const folderOpen = id => { try { return localStorage.getItem('el-fold-' + id) !== '0'; } catch (e) { return true; } };
  const setFolderOpen = (id, on) => { try { localStorage.setItem('el-fold-' + id, on ? '1' : '0'); } catch (e) {} };
  function testCard(id) {
    const t = S.tests[id], n = EL.asArray(t.questions).length;
    return `<div class="tcard ${S.editing && S.editing.id === id ? 'on' : ''}" data-tid="${id}" draggable="true"><b>${esc(t.title || 'Untitled')}</b>
      <span>${t.pick && t.pick < n ? t.pick + ' of ' + n : n} question${n === 1 ? '' : 's'}${t.nsets > 1 ? ' · ' + t.nsets + ' sets' : ''} · ${t.timeLimit ? t.timeLimit + ' min' : 'no time limit'}${t.paper ? ' · has file' : ''}</span></div>`;
  }
  function renderTestList() {
    const folders = S.folders || {};
    const ids = Object.keys(S.tests).sort((a, b) => (S.tests[b].updatedAt || 0) - (S.tests[a].updatedAt || 0));
    const inF = fid => ids.filter(id => (folders[S.tests[id].folder] ? S.tests[id].folder : '') === fid);
    const fids = Object.keys(folders).sort((a, b) => String(folders[a].name).localeCompare(String(folders[b].name)));
    const group = (fid, name, list) => {
      const open = folderOpen(fid || 'none');
      return `<div class="fgroup ${open ? 'open' : ''}" data-fid="${fid}">
        <div class="fhead" data-fold="${fid}"><span class="fcaret">${open ? '▾' : '▸'}</span>${icon('archive')}<b>${esc(name)}</b><span class="fcount">${list.length}</span>
          ${fid ? `<span class="fbtns"><button type="button" class="ibtn" data-frename="${fid}" title="Rename folder">✎</button><button type="button" class="ibtn del" data-fdel="${fid}" title="Delete folder (tests are kept)">✕</button></span>` : ''}</div>
        <div class="fbody">${list.map(testCard).join('') || '<p class="fempty">Empty. Drag a test here, or pick this folder at the top of a test.</p>'}</div></div>`;
    };
    if (!ids.length && !fids.length) { $('#testList').innerHTML = '<p class="muted small">No tests yet.</p>'; return; }
    $('#testList').innerHTML = fids.map(fid => group(fid, folders[fid].name, inF(fid))).join('') + group('', fids.length ? 'No folder' : 'All tests', inF(''));
  }
  function fillFolderSelect() {
    const f = S.folders || {}, cur = S.editing && f[S.editing.folder] ? S.editing.folder : '';
    $('#edFolder').innerHTML = '<option value="">No folder</option>' + Object.keys(f).sort((a, b) => String(f[a].name).localeCompare(String(f[b].name)))
      .map(id => `<option value="${id}" ${id === cur ? 'selected' : ''}>${esc(f[id].name)}</option>`).join('');
  }
  function askFolderName(title, value) {
    return new Promise(res => {
      $('#fmTitle').textContent = title; $('#fmName').value = value || '';
      $('#folderModal').classList.remove('hidden'); setTimeout(() => $('#fmName').focus(), 30);
      const done = v => { $('#folderModal').classList.add('hidden'); $('#fmYes').onclick = $('#fmNo').onclick = $('#fmName').onkeydown = null; res(v); };
      $('#fmYes').onclick = () => { const v = $('#fmName').value.trim(); if (!v) return $('#fmName').focus(); done(v.slice(0, 60)); };
      $('#fmNo').onclick = () => done(null);
      $('#fmName').onkeydown = e => { if (e.key === 'Enter') $('#fmYes').click(); if (e.key === 'Escape') done(null); };
    });
  }
  async function moveTest(tid, fid) {
    if (!S.tests[tid]) return;
    if ((S.tests[tid].folder || '') === fid) return;
    await B.update(`teachers/${S.uid}/tests/${tid}`, { folder: fid || null });
    if (S.editing && S.editing.id === tid) { S.editing.folder = fid || ''; fillFolderSelect(); }
    const f = (S.folders || {})[fid];
    EL.toast(`Moved to <b>${esc(f ? f.name : 'No folder')}</b>`, 'green', 2000);
  }
  $('#newFolder').addEventListener('click', async () => {
    const name = await askFolderName('New folder'); if (!name) return;
    const id = 'f' + EL.rid(8);
    await B.set(`teachers/${S.uid}/folders/${id}`, { name, createdAt: B.now() });
    setFolderOpen(id, true);
  });
  // drag a test onto a folder to move it
  let dragTid = null;
  $('#testList').addEventListener('dragstart', e => { const c = e.target.closest('.tcard'); if (!c) return; dragTid = c.dataset.tid; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragTid); } catch (x) {} c.classList.add('dragging'); });
  $('#testList').addEventListener('dragend', () => { dragTid = null; $$('#testList .dragging, #testList .drop').forEach(x => x.classList.remove('dragging', 'drop')); });
  $('#testList').addEventListener('dragover', e => { const g = e.target.closest('.fgroup'); if (!g || !dragTid) return; e.preventDefault(); $$('#testList .drop').forEach(x => x !== g && x.classList.remove('drop')); g.classList.add('drop'); });
  $('#testList').addEventListener('drop', e => { const g = e.target.closest('.fgroup'); if (!g || !dragTid) return; e.preventDefault(); g.classList.remove('drop'); moveTest(dragTid, g.dataset.fid); });
  $('#testList').addEventListener('click', async e => {
    const rn = e.target.closest('[data-frename]');
    if (rn) { e.stopPropagation(); const id = rn.dataset.frename, f = S.folders[id]; const name = await askFolderName('Rename folder', f && f.name); if (name) B.update(`teachers/${S.uid}/folders/${id}`, { name }); return; }
    const dl = e.target.closest('[data-fdel]');
    if (dl) {
      e.stopPropagation(); const id = dl.dataset.fdel, f = S.folders[id];
      const inside = Object.keys(S.tests).filter(t => S.tests[t].folder === id);
      if (!(await confirmBox(`Delete the folder "${f ? f.name : ''}"?`, inside.length ? `The ${inside.length} test${inside.length === 1 ? '' : 's'} inside are kept and move to "No folder".` : 'It is empty.', 'Delete folder', true))) return;
      const u = {}; inside.forEach(t => { u[`tests/${t}/folder`] = null; }); u[`folders/${id}`] = null;
      await B.update(`teachers/${S.uid}`, u);
      if (S.editing && S.editing.folder === id) S.editing.folder = '';
      return;
    }
    const fh = e.target.closest('[data-fold]');
    if (fh) { const fid = fh.dataset.fold; setFolderOpen(fid || 'none', !folderOpen(fid || 'none')); renderTestList(); return; }
    const c = e.target.closest('.tcard'); if (!c) return;
    if (S.dirty && !(await confirmBox('Discard unsaved changes?', '', 'Discard', true))) return;
    openEditor(JSON.parse(JSON.stringify(S.tests[c.dataset.tid])));
  });
  const newQ = type => {
    const q = { id: 'q' + EL.rid(6), type, text: '', points: type === 'essay' ? 5 : type === 'match' ? 4 : 1, options: null, answer: '' };
    if (type === 'mc') { q.options = ['', '', '', '']; q.answer = 0; }
    if (type === 'tf') q.answer = 'true';
    if (type === 'match') { q.pairs = [['', ''], ['', ''], ['', ''], ['', '']]; q.extra = ''; q.text = 'Match each item on the left with the correct answer on the right.'; }
    if (type === 'essay') q.model = '';
    return q;
  };
  $('#newTest').addEventListener('click', async () => {
    if (S.dirty && !(await confirmBox('Discard unsaved changes?', '', 'Discard', true))) return;
    // a new test goes into the folder that is open on its own (if exactly one is open)
    const open = Object.keys(S.folders || {}).filter(folderOpen);
    openEditor({ id: 't' + EL.rid(8), title: '', timeLimit: 0, shuffle: false, pick: 0, nsets: 1, folder: open.length === 1 ? open[0] : '', questions: [newQ('mc')] });
    S.dirty = true;
  });
  function openEditor(t) {
    t.questions = EL.asArray(t.questions).map(q => {
      q.options = q.type === 'mc' ? EL.asArray(q.options) : null;
      if (q.type === 'match') q.pairs = EL.asArray(q.pairs).map(p => { const a = EL.asArray(p); return [a[0] || '', a[1] || '']; });
      if (q.src) q.src = { page: q.src.page, box: EL.asArray(q.src.box) };
      return q;
    });
    if (t.paper) t.paper.pages = EL.asArray(t.paper.pages);
    t.pick = Number(t.pick) || 0; t.nsets = Number(t.nsets) || 1;
    t.sets = EL.asArray(t.sets).map(x => ({ n: x.n, ids: EL.asArray(x.ids) }));
    t.paperClass = EL.asArray(t.paperClass);
    S.editing = t; S.dirty = false;
    go('tests');
    $('#edEmpty').classList.add('hidden'); $('#edMain').classList.remove('hidden');
    $('#edTitle').value = t.title || ''; $('#edTime').value = t.timeLimit || 0; $('#edShuffle').checked = !!t.shuffle;
    $('#edPick').value = t.pick || 0; $('#edSets').value = String(Math.min(6, t.nsets));
    fillFolderSelect();
    edTab('qs');
    renderEditor(); renderTestList();
  }
  const hasSheet = t => t.questions.some(q => q.sheet);
  function renderPaper() {
    const p = S.editing.paper;
    if (!p) { $('#edPaper').innerHTML = ''; return; }
    const pages = EL.asArray(p.pages);
    $('#edPaper').innerHTML = `<div class="paper-edit">
      <div class="row-between"><div><span class="label">Test paper shown to students</span><div style="font-weight:600;margin-top:2px">${esc(p.name || 'File')}</div>
        <div class="small muted">${pages.length ? pages.length + ' page' + (pages.length === 1 ? '' : 's') : 'Text from the file'} · shown above the questions</div></div>
        <button class="btn sm danger" id="paperRemove">${icon('trash')}Remove file</button></div>
      ${pages.length ? `<div class="paper-thumbs">${pages.map(src => `<img src="${src}" alt="">`).join('')}</div>` : `<div class="paper-text-prev">${esc((p.text || '').slice(0, 600))}${(p.text || '').length > 600 ? '…' : ''}</div>`}
    </div>`;
  }
  $('#edPaper').addEventListener('click', e => { if (e.target.closest('#paperRemove')) { delete S.editing.paper; markDirty(); renderEditor(); } });
  function fillPrev(text) {
    const b = EL.blanksOf(text);
    return b.length ? `${b.length} blank${b.length === 1 ? '' : 's'}: ` + b.map((acc, k) => `<b>(${k + 1})</b> ${acc.length ? acc.map(esc).join(' / ') : '<span style="color:var(--amber)">empty</span>'}`).join(' · ')
      : '<b style="color:var(--amber)">No blanks yet. Put each missing word in [[ ]].</b>';
  }
  const typeSelect = (q, i) => `<select class="input" data-i="${i}" data-f="type">${EL.TYPES.map(t => `<option value="${t}" ${q.type === t ? 'selected' : ''}>${EL.TYPE_LABEL[t]}</option>`).join('')}</select>`;
  function renderEditor() {
    const t = S.editing;
    renderPaper();
    $('#edShuffle').disabled = hasSheet(t);
    if (hasSheet(t)) $('#edShuffle').checked = t.shuffle = false;
    const pages = window.Maker && Maker.hasPages();
    $('#edQs').innerHTML = t.questions.map((q, i) => {
      let body = '';
      if (q.sheet) {
        const choices = q.type === 'tf' ? [['true', 'True'], ['false', 'False']] : q.options.map((o, k) => [k, EL.LETTERS[k]]);
        body = `<div class="sheet-pick"><span class="eq-hint">Correct answer:</span>${choices.map(([v, l]) =>
          `<label class="${String(q.answer) === String(v) ? 'on' : ''}"><input type="radio" name="c_${q.id}" data-i="${i}" data-f="answer" value="${v}" ${String(q.answer) === String(v) ? 'checked' : ''}>${l}</label>`).join('')}</div>`;
        return `<div class="eq sheet ${q.needKey ? 'need' : ''}" data-i="${i}"><div class="eq-head"><span class="eq-num">${q.n}</span>${body}
          <div class="eq-tools"><button class="ibtn del" data-qa="del" data-i="${i}" title="Delete">✕</button></div></div></div>`;
      }
      if (q.type === 'mc') {
        body = q.options.map((o, k) => `<div class="eq-opt ${q.answer === k && !q.needKey ? 'correct' : ''}">
          <input type="radio" name="c_${q.id}" data-i="${i}" data-f="answer" value="${k}" ${q.answer === k && !q.needKey ? 'checked' : ''} title="Correct answer">
          <span class="letter">${EL.LETTERS[k]}</span><input class="input sm" data-i="${i}" data-f="opt" data-k="${k}" value="${esc(o)}" placeholder="Choice ${EL.LETTERS[k]}">
          ${q.options.length > 2 ? `<button class="ibtn del" data-qa="delopt" data-i="${i}" data-k="${k}" title="Remove choice">✕</button>` : ''}</div>`).join('') +
          `<div class="row-between"><span class="eq-hint">${q.needKey ? '<b style="color:var(--amber)">Tick the correct answer</b>' : 'Tick the circle next to the correct answer'}</span>${q.options.length < 6 ? `<button class="btn sm" data-qa="addopt" data-i="${i}">+ Choice</button>` : ''}</div>`;
      } else if (q.type === 'tf') {
        body = `<div class="tf-pick">${['true', 'false'].map(v => `<label><input type="radio" name="c_${q.id}" data-i="${i}" data-f="answer" value="${v}" ${q.answer === v ? 'checked' : ''}>${v === 'true' ? 'True' : 'False'} is correct</label>`).join('')}</div>`;
      } else if (q.type === 'match') {
        body = `<div class="eq-pairs">${q.pairs.map((p, k) => `<div class="eq-pair"><span class="letter">${k + 1}</span>
            <input class="input sm" data-i="${i}" data-f="pl" data-k="${k}" value="${esc(p[0])}" placeholder="Left side, e.g. Ribosome">
            <span class="eq-arrow">→</span>
            <input class="input sm" data-i="${i}" data-f="pr" data-k="${k}" value="${esc(p[1])}" placeholder="Its match, e.g. Makes proteins">
            ${q.pairs.length > 2 ? `<button class="ibtn del" data-qa="delpair" data-i="${i}" data-k="${k}" title="Remove pair">✕</button>` : '<span></span>'}</div>`).join('')}</div>
          <div class="row-between"><span class="eq-hint">Students see the right-hand side mixed up and lettered A, B, C … Part marks for each correct pair.</span>${q.pairs.length < 10 ? `<button class="btn sm" data-qa="addpair" data-i="${i}">+ Pair</button>` : ''}</div>
          <input class="input sm" data-i="${i}" data-f="extra" value="${esc(q.extra || '')}" placeholder="Extra wrong answers on the right (optional), separated by |">`;
      } else if (q.type === 'fill') {
        body = `<span class="eq-hint">Put each missing word in [[double brackets]]: The [[nucleus]] controls the cell. Other accepted answers go after |, e.g. [[ATP|adenosine triphosphate]]. Part marks for each blank.</span>
          <div class="fill-prev" data-fp="${i}">${fillPrev(q.text)}</div>`;
      } else if (q.type === 'essay') {
        body = `<textarea class="input" rows="3" data-i="${i}" data-f="model" placeholder="Model answer and how to give the marks (only you see this)">${esc(q.model || '')}</textarea>
          <span class="eq-hint">You mark essays yourself. This model answer shows next to each student's answer and prints on the answer key.</span>`;
      } else {
        body = `<input class="input sm" data-i="${i}" data-f="answer" value="${esc(q.answer || '')}" placeholder="Accepted answers, separated by |   e.g.  mitochondria | mitochondrion">
          <span class="eq-hint">A matching answer gets a suggested mark that you can change. Capital letters don't matter. Leave empty to mark it all yourself.</span>`;
      }
      if (q.explain && (q.type === 'mc' || q.type === 'tf')) body += `<div class="eq-hint eq-explain">Why: ${esc(q.explain)}</div>`;
      return `<div class="eq ${q.needKey ? 'need' : ''}" data-i="${i}">
        <div class="eq-head"><span class="eq-num">${i + 1}</span>
          ${typeSelect(q, i)}
          <input class="input pts" type="number" min="1" max="100" data-i="${i}" data-f="points" value="${q.points || 1}" title="Points"><span class="eq-hint">points</span>
          <div class="eq-tools">
            <button class="ibtn" data-qa="up" data-i="${i}" title="Move up">↑</button><button class="ibtn" data-qa="down" data-i="${i}" title="Move down">↓</button>
            <button class="ibtn" data-qa="dup" data-i="${i}" title="Duplicate">⧉</button><button class="ibtn del" data-qa="del" data-i="${i}" title="Delete">✕</button></div></div>
        <textarea class="input" rows="2" data-i="${i}" data-f="text" placeholder="${q.type === 'fill' ? 'e.g. Plants make glucose by [[photosynthesis]] in the [[chloroplast]].' : q.type === 'tf' ? 'Statement' : 'Question'}">${esc(q.text)}</textarea>
        <div class="eq-img">${q.image ? `<img src="${q.image}" alt=""><button class="btn sm danger" data-qa="delimg" data-i="${i}">Remove picture</button>` : `<label class="btn sm">Add picture<input type="file" accept="image/*" hidden data-i="${i}" data-f="image"></label>`}
          ${pages ? `<button class="btn sm" data-qa="crop" data-i="${i}">${q.image ? 'Re-cut from the paper' : 'Picture from the paper'}</button>` : ''}</div>
        ${body}</div>`;
    }).join('');
    infoLine();
  }
  function infoLine() {
    const t = S.editing; const pts = t.questions.reduce((a, q) => a + (Number(q.points) || 1), 0);
    const need = t.questions.filter(q => q.needKey).length;
    $('#edInfo').innerHTML = `${t.questions.length} questions · ${pts} points${need ? ` · <b style="color:var(--amber)">${need} still need a correct answer</b>` : ''}${S.dirty ? ' · not saved' : ''}`;
    poolNote();
  }
  // "each student answers N" and "how many sets"
  function poolNote() {
    const t = S.editing, pool = t.questions.length, sheet = hasSheet(t);
    $('#edPick').disabled = $('#edSets').disabled = sheet;
    const n = Number(t.nsets) || 1, pick = Number(t.pick) || 0;
    let h;
    if (sheet) h = 'Sets and picking need typed questions, so they are off for answer-sheet rows.';
    else {
      const each = pick > 0 && pick < pool;
      h = each ? `Pool of <b>${pool}</b> questions · each student gets <b>${pick}</b> picked from it` : `Every student answers all <b>${pool}</b> questions`;
      if (n > 1) h += ` · <b>${n} sets</b> (${Array.from({ length: n }, (_, k) => EL.setLetter(k)).join(' ')}), shared out evenly online`;
      else if (each) h += ' · everyone gets the same pick (choose 2+ sets to mix it up)';
      if (pick > pool) h += ` · <span style="color:var(--amber)">that's more than the ${pool} in the pool, so everyone gets all of them</span>`;
    }
    $('#edPool').innerHTML = h;
  }
  function markDirty() { S.dirty = true; infoLine(); }
  $('#edTitle').addEventListener('input', () => { S.editing.title = $('#edTitle').value; markDirty(); });
  $('#edTime').addEventListener('input', () => { S.editing.timeLimit = Math.max(0, Number($('#edTime').value) || 0); markDirty(); });
  $('#edShuffle').addEventListener('change', () => { S.editing.shuffle = $('#edShuffle').checked; markDirty(); });
  $('#edFolder').addEventListener('change', () => {
    S.editing.folder = $('#edFolder').value || '';
    // a saved test moves right away; a new one moves when it is saved
    if (S.tests[S.editing.id]) moveTest(S.editing.id, S.editing.folder); else markDirty();
  });
  $('#edPick').addEventListener('input', () => { S.editing.pick = Math.max(0, Math.round(Number($('#edPick').value) || 0)); markDirty(); });
  $('#edSets').addEventListener('change', () => { S.editing.nsets = Number($('#edSets').value) || 1; markDirty(); if (S.edTab === 'sets') renderSetsPane(); });
  $('#edQs').addEventListener('input', e => {
    const el = e.target, i = Number(el.dataset.i), f = el.dataset.f; if (isNaN(i) || !f) return;
    const q = S.editing.questions[i];
    if (f === 'text') { q.text = el.value; if (q.type === 'fill') { const fp = $(`[data-fp="${i}"]`); if (fp) fp.innerHTML = fillPrev(q.text); } }
    else if (f === 'opt') q.options[Number(el.dataset.k)] = el.value;
    else if (f === 'points') q.points = Math.max(1, Number(el.value) || 1);
    else if (f === 'answer' && q.type === 'short') q.answer = el.value;
    else if (f === 'pl') q.pairs[Number(el.dataset.k)][0] = el.value;
    else if (f === 'pr') q.pairs[Number(el.dataset.k)][1] = el.value;
    else if (f === 'extra') q.extra = el.value;
    else if (f === 'model') q.model = el.value;
    markDirty();
  });
  $('#edQs').addEventListener('change', e => {
    const el = e.target, i = Number(el.dataset.i), f = el.dataset.f; if (isNaN(i) || !f) return;
    const q = S.editing.questions[i];
    if (f === 'answer' && q.type === 'mc') { q.answer = Number(el.value); delete q.needKey; renderEditor(); }
    else if (f === 'answer' && q.type === 'tf') { q.answer = el.value; delete q.needKey; if (q.sheet) renderEditor(); }
    else if (f === 'type') {
      const n = newQ(el.value); n.id = q.id; if (q.text || n.type !== 'match') n.text = q.text;
      if (q.points > 1 && n.type !== 'essay' && q.type !== 'essay') n.points = q.points;
      if (q.image) n.image = q.image; if (q.src) n.src = q.src;
      S.editing.questions[i] = n; renderEditor();
    }
    else if (f === 'image' && el.files[0]) { EL.loadImage(el.files[0], 900).then(url => { q.image = url; delete q.src; markDirty(); renderEditor(); }); return; }
    markDirty();
  });
  $('#edQs').addEventListener('click', async e => {
    const b = e.target.closest('[data-qa]'); if (!b) return;
    const qs = S.editing.questions, i = Number(b.dataset.i), a = b.dataset.qa;
    if (a === 'crop') {
      const r = await Maker.pickPicture(qs[i].src); if (!r) return;
      qs[i].image = r.image; qs[i].src = r.src; markDirty(); renderEditor(); return;
    }
    if (a === 'up' && i > 0) [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]];
    if (a === 'down' && i < qs.length - 1) [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]];
    if (a === 'dup') { const c = JSON.parse(JSON.stringify(qs[i])); c.id = 'q' + EL.rid(6); qs.splice(i + 1, 0, c); }
    if (a === 'del') qs.splice(i, 1);
    if (a === 'addopt') qs[i].options.push('');
    if (a === 'delopt') { const k = Number(b.dataset.k); qs[i].options.splice(k, 1); if (qs[i].answer === k) qs[i].answer = 0; else if (qs[i].answer > k) qs[i].answer--; }
    if (a === 'addpair') qs[i].pairs.push(['', '']);
    if (a === 'delpair') qs[i].pairs.splice(Number(b.dataset.k), 1);
    if (a === 'delimg') { delete qs[i].image; delete qs[i].src; }
    markDirty(); renderEditor();
  });
  $$('[data-add]').forEach(b => b.addEventListener('click', () => {
    S.editing.questions.push(newQ(b.dataset.add)); markDirty(); renderEditor();
    setTimeout(() => { const all = $$('#edQs .eq'); const last = all[all.length - 1]; if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); const ta = last.querySelector('textarea'); if (ta) ta.focus(); } }, 50);
  }));

  // ---------------- sets: one fixed pick per set, saved with the test, so paper and iPad match
  function ensureSets(t) {
    const pool = t.questions;
    if (!pool.length || hasSheet(t)) { t.sets = null; return false; }
    const n = Math.max(1, Math.min(6, Number(t.nsets) || 1));
    const pick = Number(t.pick) > 0 && Number(t.pick) < pool.length ? Number(t.pick) : pool.length;
    if (n === 1 && pick === pool.length) { t.sets = [{ n: 'A', ids: pool.map(q => q.id) }]; return false; }
    const ids = new Set(pool.map(q => q.id));
    const ok = EL.asArray(t.sets).length === n && t.sets.every(x => { const a = EL.asArray(x.ids); return a.length === pick && new Set(a).size === pick && a.every(id => ids.has(id)); });
    if (ok) return false;
    t.sets = EL.makeSets(pool, n, pick);
    return true;
  }
  function edTab(which) {
    S.edTab = which;
    $$('#edTabs button').forEach(b => b.classList.toggle('on', b.dataset.et === which));
    $('#edQsPane').classList.toggle('hidden', which !== 'qs');
    $('#edSetsPane').classList.toggle('hidden', which !== 'sets');
    if (which === 'sets') { renderSetsPane(); loadSetResults(S.editing).then(() => { if (S.edTab === 'sets') renderSetsPane(); }); }
  }
  $('#edTabs').addEventListener('click', e => { const b = e.target.closest('[data-et]'); if (b) edTab(b.dataset.et); });

  // students who took this test online, per set (read from each finished session of this test)
  const SV = { set: 0, results: {} };
  async function loadSetResults(t) {
    if (!t) return;
    const codes = Object.keys(S.history).filter(c => S.history[c].testId === t.id && S.history[c].kind !== 'present');
    const out = [];
    for (const c of codes) {
      let d; try { d = await B.get(`sessions/${c}`); } catch (e) { continue; }
      if (!d || !d.meta) continue;
      const split = EL.splitPaper(d.questions), sets = metaSets(d.meta), studs = d.students || {}, ctl = d.control || {};
      const rows = Object.keys(studs).filter(id => !(ctl[id] || {}).kicked).map(id => {
        const k = setOfIn(id, studs, ctl), g = EL.grade(qsFor(split.questions, sets, k), d.key || {}, studs[id].answers, (d.overrides || {})[id]);
        return { name: studs[id].name, set: k == null ? 0 : k, score: g.score, total: g.total, pending: g.pending, done: studs[id].status === 'submitted' };
      });
      out.push({ code: c, at: d.meta.createdAt, rows });
    }
    SV.results[t.id] = out.sort((a, b) => b.at - a.at);
  }
  function editorKey(q) {
    const LT = EL.LETTERS;
    if (q.type === 'mc') return `<b>${LT[q.answer]}</b> · ${esc(EL.asArray(q.options)[q.answer] || '')}`;
    if (q.type === 'tf') return `<b>${q.answer === 'true' ? 'True' : 'False'}</b>`;
    if (q.type === 'match') { const m = Printer.layout(q); return m.key.map((r, k) => `${k + 1}→<b>${LT[r]}</b>`).join(' · '); }
    if (q.type === 'fill') return EL.blanksOf(q.text).map((acc, k) => `(${k + 1}) <b>${acc.map(esc).join(' / ')}</b>`).join(' · ');
    if (q.type === 'short') return String(q.answer || '').trim() ? '<b>' + String(q.answer).split('|').map(x => esc(x.trim())).join(' / ') + '</b>' : '<span class="muted">you mark it</span>';
    return `<span class="muted">Model:</span> ${esc(String(q.model || '').slice(0, 220))}${String(q.model || '').length > 220 ? '…' : ''}`;
  }
  function renderSetsPane() {
    const t = S.editing, host = $('#edSetsPane');
    if (hasSheet(t)) { host.innerHTML = '<div class="sets-empty muted">Sets need typed questions. This test uses answer-sheet rows for a paper you already have, so print that paper yourself.</div>'; return; }
    if (!t.questions.length) { host.innerHTML = '<div class="sets-empty muted">Add some questions first.</div>'; return; }
    if (ensureSets(t)) markDirty();
    const sets = t.sets, n = sets.length; if (SV.set >= n) SV.set = 0;
    const byId = {}; t.questions.forEach(q => { byId[q.id] = q; });
    const cur = sets[SV.set], qs = cur.ids.map(id => byId[id]).filter(Boolean);
    const pts = qs.reduce((a, q) => a + (Number(q.points) || 1), 0);
    const totals = sets.map(x => x.ids.reduce((a, id) => a + (Number((byId[id] || {}).points) || 1), 0));
    const online = SV.results[t.id] || [], paper = t.paperClass || [];
    const cnt = k => online.reduce((a, r) => a + r.rows.filter(x => x.set === k).length, 0) + paper.filter(p => Number(p.set) === k).length;
    const name = k => n > 1 ? 'Set ' + sets[k].n : 'The test';
    const onl = online.map(r => ({ r, rows: r.rows.filter(x => x.set === SV.set) })).filter(x => x.rows.length);
    const pap = paper.map((p, i) => Object.assign({ i }, p)).filter(p => Number(p.set) === SV.set);
    const studs = (onl.length || pap.length) ? onl.map(({ r, rows }) => `<div class="ss-group"><span class="small muted">Online · ${new Date(r.at).toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${r.code}</span>` +
        rows.sort((a, b) => a.name.localeCompare(b.name)).map(x => `<div class="ss-row"><span>${esc(x.name)}</span><b>${x.done ? EL.fmtPts(x.score) + '/' + x.total : '<span class="muted">not finished</span>'}</b>${x.pending ? `<span class="pendtag">${x.pending} to mark</span>` : ''}</div>`).join('') + '</div>').join('') +
      (pap.length ? `<div class="ss-group"><span class="small muted">Paper</span>${pap.map(p => `<div class="ss-row"><span>${esc(p.name)}</span><b>${p.score !== '' && p.score != null ? esc(p.score) + '/' + totals[SV.set] : '<span class="muted">no score yet</span>'}</b></div>`).join('')}</div>` : '')
      : '<p class="muted small">Nobody yet. Online students appear here after a test. Add a paper class below.</p>';
    host.innerHTML = `
      <div class="sets-head">
        <div class="set-chips">${sets.map((x, k) => `<button type="button" class="set-chip ${k === SV.set ? 'on' : ''}" data-set="${k}"><b>${n > 1 ? x.n : 'All'}</b><span>${cnt(k)} student${cnt(k) === 1 ? '' : 's'}</span></button>`).join('')}</div>
        <div class="sets-acts">${n > 1 || (t.pick && t.pick < t.questions.length) ? `<button class="btn sm" data-sa="remake" type="button">Make new sets</button>` : ''}
          ${n > 1 ? `<button class="btn sm" data-sa="printall" type="button">${icon('print')}All test papers</button><button class="btn sm" data-sa="keyall" type="button">${icon('print')}All answer keys</button>` : ''}</div>
      </div>
      ${S.dirty ? '<div class="sets-warn small">Not saved yet. Printing saves the test first, so the papers and the online test stay the same.</div>' : ''}
      <div class="set-card">
        <div class="set-top"><div><span class="label">${name(SV.set)}</span><h3>${qs.length} questions · ${pts} points</h3></div>
          <div class="set-btns"><button class="btn primary sm" data-sa="print" type="button">${icon('print')}Print test paper</button><button class="btn sm" data-sa="key" type="button">${icon('print')}Print answer key</button></div></div>
        <div class="set-body">
          <div class="set-qs">${qs.map((q, i) => `<div class="set-q"><b>${i + 1}</b><div><div class="set-qt"><span class="kind">${EL.TYPE_LABEL[q.type]}</span>${esc(q.type === 'fill' ? String(q.text).replace(/\[\[(.*?)\]\]/g, '____') : q.text)}</div><div class="set-ans">${editorKey(q)}</div></div></div>`).join('')}</div>
          <div class="set-studs"><span class="label">Who got ${n > 1 ? 'set ' + cur.n : 'it'}</span>${studs}</div>
        </div>
      </div>
      <div class="paper-class">
        <div class="pc-head"><div><span class="label">Paper test · who gets which set</span><div class="small muted">Giving it on paper? Add your class, pick the set next to each name, print, then type each score after marking.</div></div>
          <div class="sets-acts">${n > 1 ? `<button class="btn sm" data-sa="even" type="button">Share sets out evenly</button>` : ''}${paper.length ? `<button class="btn sm" data-sa="classlist" type="button">${icon('print')}Print class list</button>` : ''}</div></div>
        <div class="pc-add"><textarea class="input" id="pcNames" rows="2" placeholder="Paste student names, one per line"></textarea><button class="btn sm" data-sa="addnames" type="button">Add names</button></div>
        ${paper.length ? `<table class="pc-table"><thead><tr><th>No.</th><th>Name</th><th>Set</th><th>Score</th><th></th></tr></thead><tbody>${paper.map((p, i) => `<tr>
          <td class="mono">${i + 1}</td><td><input class="input sm" data-pc="name" data-i="${i}" value="${esc(p.name)}"></td>
          <td><select class="input sm" data-pc="set" data-i="${i}">${sets.map((x, k) => `<option value="${k}" ${Number(p.set) === k ? 'selected' : ''}>${n > 1 ? x.n : '–'}</option>`).join('')}</select></td>
          <td class="pc-score"><input class="input sm" type="number" min="0" step="0.5" data-pc="score" data-i="${i}" value="${esc(p.score == null ? '' : p.score)}"><span class="muted">/ ${totals[Number(p.set)] || totals[0]}</span></td>
          <td><button class="ibtn del" data-sa="delname" data-i="${i}" type="button" title="Remove">✕</button></td></tr>`).join('')}</tbody></table>` : ''}
      </div>`;
  }
  async function saveForPrint() {
    if (!S.dirty) return true;
    if (!$('#edTitle').value.trim()) { EL.toast('Give the test a title first.', 'red'); return false; }
    try { await saveTest(); return true; } catch (ex) { EL.toast('Could not save: ' + esc(ex.message || ex), 'red', 8000); return false; }
  }
  $('#edSetsPane').addEventListener('click', async e => {
    const c = e.target.closest('[data-set]'); if (c) { SV.set = Number(c.dataset.set); renderSetsPane(); return; }
    const b = e.target.closest('[data-sa]'); if (!b) return;
    const t = S.editing, a = b.dataset.sa, all = (t.sets || []).map((_, k) => k);
    if (a === 'remake') {
      if (!(await confirmBox('Make new sets?', 'Each set gets a new random pick. Papers you already printed will not match the new sets.', 'Make new sets'))) return;
      t.sets = EL.makeSets(t.questions, t.nsets, Number(t.pick) || 0); markDirty(); renderSetsPane(); return;
    }
    if (a === 'print' || a === 'key' || a === 'printall' || a === 'keyall') {
      // open the tab first (pop-up blockers allow it only straight from the click), then save
      const w = Printer.blank();
      if (!(await saveForPrint())) { if (w) w.close(); return; }
      const which = a.endsWith('all') ? all : [SV.set];
      if (a.startsWith('print')) Printer.paper(t, which, w); else Printer.key(t, which, w);
      renderSetsPane(); return;
    }
    if (a === 'even') { t.paperClass.forEach((p, i) => { p.set = i % t.sets.length; }); markDirty(); renderSetsPane(); return; }
    if (a === 'addnames') {
      const names = ($('#pcNames').value || '').split(/\r?\n/).map(x => x.replace(/^\s*\d+[.)]?\s+/, '').trim()).filter(Boolean);
      if (!names.length) return EL.toast('Paste the names first, one per line.', 'amber');
      const start = t.paperClass.length;
      names.forEach((nm, k) => t.paperClass.push({ name: nm.slice(0, 80), set: (start + k) % t.sets.length, score: '' }));
      markDirty(); renderSetsPane(); return;
    }
    if (a === 'delname') { t.paperClass.splice(Number(b.dataset.i), 1); markDirty(); renderSetsPane(); return; }
    if (a === 'classlist') {
      const byId = {}; t.questions.forEach(q => { byId[q.id] = q; });
      Printer.classList(t, t.paperClass, t.sets.map(x => x.ids.reduce((s, id) => s + (Number((byId[id] || {}).points) || 1), 0)));
    }
  });
  $('#edSetsPane').addEventListener('input', e => {
    const f = e.target.dataset.pc; if (!f || f === 'set') return;
    const p = S.editing.paperClass[Number(e.target.dataset.i)]; if (!p) return;
    p[f] = f === 'score' ? e.target.value : e.target.value.slice(0, 80);
    S.dirty = true; $('#edInfo') && infoLine();
  });
  $('#edSetsPane').addEventListener('change', e => {
    if (e.target.dataset.pc !== 'set') return;
    S.editing.paperClass[Number(e.target.dataset.i)].set = Number(e.target.value); markDirty(); renderSetsPane();
  });

  // answer-sheet rows: for a paper/scanned test, students just pick A-D per number
  function sheetRows(n, kind, start) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const q = { id: 'q' + EL.rid(6), sheet: true, n: start + k, text: '', points: 1, needKey: true };
      if (kind === 'tf') Object.assign(q, { type: 'tf', options: null, answer: 'true' });
      else Object.assign(q, { type: 'mc', options: new Array(Number(kind)).fill(''), answer: 0 });
      out.push(q);
    }
    return out;
  }
  function askSheet(title, body, n) {
    return new Promise(res => {
      $('#smTitle').textContent = title; $('#smBody').textContent = body; $('#smN').value = n || 20;
      $('#sheetModal').classList.remove('hidden');
      const done = v => { $('#sheetModal').classList.add('hidden'); $('#smYes').onclick = $('#smNo').onclick = null; res(v); };
      $('#smYes').onclick = () => done({ n: Math.max(1, Math.min(100, Number($('#smN').value) || 1)), kind: $('#smK').value });
      $('#smNo').onclick = () => done(null);
    });
  }
  $('#addSheet').addEventListener('click', async () => {
    const r = await askSheet('Add answer rows', 'Students read the questions on the test paper and pick their answers here.', 10);
    if (!r) return;
    const t = S.editing, start = t.questions.filter(q => q.sheet).reduce((m, q) => Math.max(m, q.n), 0) + 1;
    t.questions.push(...sheetRows(r.n, r.kind, start)); markDirty(); renderEditor();
  });

  // ---------------- upload a file (PDF / Word / photo)
  // Upload on the Tests page = make questions from it with AI (the Make from paper page, file already loaded)
  $('#uploadInput').addEventListener('change', async e => {
    const files = Array.from(e.target.files || []); e.target.value = ''; if (!files.length) return;
    go('make');
    Maker.load(files);
  });
  // "Use my paper as it is" (no AI): typed questions are picked out of the file, else students see the file + answer rows
  async function useAsIs(file) {
    if (!file) return;
    if (S.dirty && S.editing && !(await confirmBox('Discard unsaved changes?', 'This makes a new test from the file.', 'Continue', true))) return;
    busy('Reading ' + file.name + '…');
    let r;
    try { r = await Importer.read(file, msg => busy(msg)); }
    catch (ex) { busy(''); console.error(ex); return EL.toast('<b>Could not read that file.</b><br><span class="muted">' + esc(ex.message || ex) + '</span>', 'red', 8000); }
    busy('');
    const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    const t = { id: 't' + EL.rid(8), title, timeLimit: 0, shuffle: false, questions: [] };
    if (r.pages.length || (!r.questions.length && r.text)) t.paper = { name: file.name, pages: r.pages, text: r.pages.length ? '' : r.text };
    if (r.questions.length) {
      t.questions = r.questions.map(q => Object.assign(newQ(q.type), q, { id: 'q' + EL.rid(6) }));
      if (t.paper && t.paper.pages.length) t.paper = (await confirmBox(`Found ${r.questions.length} questions`, 'Also show the original file to students above the questions? (Useful if it has pictures or diagrams.)', 'Show file too')) ? t.paper : undefined;
      if (!t.paper) delete t.paper;
      openEditor(t); S.dirty = true; infoLine();
      const need = t.questions.filter(q => q.needKey).length;
      EL.toast(`<b>Made ${t.questions.length} questions from the file.</b><br><span class="muted">${need ? `Tick the correct answer for ${need} of them (marked in amber).` : 'Correct answers were found in the file. Check them.'}</span>`, 'green', 9000);
    } else {
      const s = await askSheet('Add an answer sheet', `We couldn't read separate questions from "${file.name}", so students will see the file itself. How many questions are on it?`, 20);
      t.questions = s ? sheetRows(s.n, s.kind, 1) : [newQ('mc')];
      openEditor(t); S.dirty = true; infoLine();
      if (s) EL.toast('<b>Answer sheet added.</b><br><span class="muted">Tick the correct answer for each number, then Save.</span>', 'green', 8000);
    }
  }

  function validate(t) {
    if (!t.title.trim()) return 'Give the test a title.';
    if (!t.questions.length) return 'Add at least one question.';
    for (let i = 0; i < t.questions.length; i++) {
      const q = t.questions[i], label = q.sheet ? 'Number ' + q.n : 'Question ' + (i + 1);
      if (q.needKey) return `${label}: tick the correct answer.`;
      if (q.sheet) continue;
      if (!q.text.trim() && !q.image) return `${label} is empty.`;
      if (q.type === 'mc' && q.options.filter(o => o.trim()).length < 2) return `${label} needs at least 2 choices.`;
      if (q.type === 'mc' && !(q.options[q.answer] || '').trim()) return `${label}: the correct choice is empty.`;
      if (q.type === 'match') {
        if (q.pairs.some(p => !!p[0].trim() !== !!p[1].trim())) return `${label}: one pair has only one side filled in.`;
        if (q.pairs.filter(p => p[0].trim() && p[1].trim()).length < 2) return `${label} needs at least 2 pairs.`;
      }
      if (q.type === 'fill') {
        const b = EL.blanksOf(q.text);
        if (!b.length) return `${label}: put the missing words in [[double brackets]].`;
        if (b.some(acc => !acc.length)) return `${label}: one of the [[ ]] blanks is empty.`;
      }
    }
    return null;
  }
  async function saveTest() {
    const t = S.editing;
    t.title = $('#edTitle').value.trim(); t.updatedAt = B.now();
    t.questions.forEach(q => {
      if (q.type === 'mc' && !q.sheet) q.options = q.options.map(o => o.trim());
      if (q.type === 'match') q.pairs = q.pairs.map(p => [p[0].trim(), p[1].trim()]).filter(p => p[0] || p[1]);
    });
    const had = EL.asArray(t.sets).length > 1 || EL.asArray(t.sets).some(x => EL.asArray(x.ids).length < t.questions.length);
    if (ensureSets(t) && had) EL.toast('<b>The sets were made again</b><br><span class="muted">The questions changed, so each set has a new pick. Print the papers again.</span>', 'amber', 8000);
    await B.set(`teachers/${S.uid}/tests/${t.id}`, JSON.parse(JSON.stringify(t)));
    S.dirty = false; renderEditor(); renderTestList();
    if (S.edTab === 'sets') renderSetsPane();
  }
  $('#edSave').addEventListener('click', async () => {
    if (!$('#edTitle').value.trim()) return EL.toast('Give the test a title first.', 'red');
    try { await saveTest(); EL.toast('Saved', 'green', 2000); } catch (ex) { EL.toast('Could not save: ' + esc(ex.message || ex), 'red', 8000); }
  });
  $('#edDelete').addEventListener('click', async () => {
    if (!(await confirmBox('Delete this test?', 'Results in Past results are kept.', 'Delete', true))) return;
    await B.remove(`teachers/${S.uid}/tests/${S.editing.id}`);
    S.editing = null; S.dirty = false; $('#edMain').classList.add('hidden'); $('#edEmpty').classList.remove('hidden');
  });
  $('#edDeploy').addEventListener('click', async () => {
    S.editing.title = $('#edTitle').value;
    const err = validate(S.editing); if (err) return EL.toast(err, 'red');
    if (S.code && S.meta && S.meta.status === 'live' && !(await confirmBox('Another test is still running', 'Starting this one switches your screen away from it. It keeps running and you can reopen it from Past results.', 'Start anyway'))) return;
    try { await saveTest(); await deploy(S.editing); } catch (ex) { console.error(ex); EL.toast('Could not start: ' + esc(ex.message || ex), 'red', 8000); }
  });

  // What students may read (questions, no answers) and what only the teacher reads (key).
  // Fill-in sentences go out with the answers taken out; matching goes out already mixed.
  function forStudents(q) {
    const o = { id: q.id, type: q.type, text: q.text || '', points: Number(q.points) || 1 };
    if (q.type === 'mc') o.options = q.options;
    if (q.type === 'fill') o.text = EL.hideBlanks(q.text);
    if (q.type === 'match') { const m = Printer.layout(q); o.left = m.left; o.right = m.right; }
    if (q.image) o.image = q.image; if (q.sheet) { o.sheet = true; o.n = q.n; }
    return o;
  }
  function keyOf(q) {
    if (q.type === 'short') return String(q.answer || '').split('|').map(x => x.trim()).filter(Boolean);
    if (q.type === 'fill') return EL.blanksOf(q.text);
    if (q.type === 'match') return Printer.layout(q).key;
    if (q.type === 'essay') return q.model || '';
    return q.answer;
  }
  async function deploy(t) {
    let code = null;
    for (let i = 0; i < 6; i++) { const c = EL.makeCode(); if (!(await B.get(`sessions/${c}/meta`))) { code = c; break; } }
    if (!code) return EL.toast('Could not make a code. Try again.', 'red');
    const now = B.now();
    // a pool or several sets: every student gets their own set; otherwise everyone gets everything
    const sets = !hasSheet(t) && EL.asArray(t.sets).length && (t.sets.length > 1 || t.sets[0].ids.length < t.questions.length) ? t.sets : null;
    const used = sets ? new Set(sets.flatMap(x => x.ids)) : null;
    const list = used ? t.questions.filter(q => used.has(q.id)) : t.questions;
    busy('Starting the test…');
    try {
      await B.set(`sessions/${code}/meta`, Object.assign({ title: t.title.trim(), status: 'waiting', createdAt: now, timeLimit: Number(t.timeLimit) || 0, shuffle: !!t.shuffle, release: false, owner: S.uid, testId: t.id },
        sets ? { sets: sets.map(x => ({ n: x.n, ids: x.ids })) } : {}));
      const questions = list.map(forStudents);
      // the test paper travels as the first item of the questions list (students can read that list)
      if (t.paper) questions.unshift({ id: 'paper', type: 'paper', name: t.paper.name || '', pages: EL.asArray(t.paper.pages), text: t.paper.text || '' });
      const key = {};
      list.forEach(q => { key[q.id] = keyOf(q); });
      await B.update(`sessions/${code}`, { questions, key });
      await B.set(`teachers/${S.uid}/history/${code}`, { title: t.title.trim(), createdAt: now, n: sets ? sets[0].ids.length : list.length, testId: t.id });
    } finally { busy(''); }
    play('granted');
    await openSession(code);
    openProjector();
  }

  // ================================================================ past results + mark sheet
  function renderArchive() {
    const ids = Object.keys(S.history).sort((a, b) => S.history[b].createdAt - S.history[a].createdAt);
    $('#archiveList').innerHTML = ids.map(c => {
      const h = S.history[c], done = !!h.endedAt, pres = h.kind === 'present';
      const facts = pres ? `${h.mode === 'screen' ? 'Screen share' : h.n + ' slides'}${done ? ` · ${h.students || 0} students · ${h.left || 0} left the page` : ''}`
        : `${h.n} questions${done ? ` · ${h.students || 0} students · average ${h.avg || 0}%` : ''}${done && h.pending ? ` · <span style="color:var(--amber)">${h.pending} to mark</span>` : ''}`;
      return `<div class="arow" data-arc="${done ? 'sheet' : 'open'}" data-c="${c}"><span class="code">${c}</span>
        <div class="grow"><b>${pres ? `<span class="kind-tag">${h.mode === 'screen' ? 'PowerPoint' : 'Slides'}</span>` : ''}${esc(h.title)}</b><div class="small muted">${new Date(h.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${facts}${done ? '' : ' · <span style="color:var(--gfp)">still open</span>'}</div></div>
        ${pres && done ? `<button class="btn sm" data-arc="again" data-c="${c}">${icon('play')}Present again</button>` : ''}
        <button class="btn sm ${done ? 'primary' : ''}" data-arc="${done ? 'sheet' : 'open'}" data-c="${c}">${done ? (pres ? 'Attendance' : 'Mark sheet') : 'Open live'}</button>
        <button class="btn sm iconbtn ghost" data-arc="del" data-c="${c}" title="Delete">${icon('trash')}</button></div>`;
    }).join('') || '<p class="muted">No tests given yet.</p>';
  }
  $('#archiveList').addEventListener('click', async e => {
    const b = e.target.closest('[data-arc]'); if (!b) return;
    e.stopPropagation();
    const c = b.dataset.c;
    if (b.dataset.arc === 'open') openSession(c);
    if (b.dataset.arc === 'sheet') openMarksheet(c);
    if (b.dataset.arc === 'again') presentAgain(c);
    if (b.dataset.arc === 'del' && await confirmBox('Delete results for ' + c + '?', 'All answers and activity for this test are erased for good.', 'Delete', true)) {
      await B.remove(`sessions/${c}`); await B.remove(`teachers/${S.uid}/history/${c}`);
      if (S.code === c) { sessionSubs.forEach(u => u()); sessionSubs = []; S.code = null; showLiveEmpty(); }
    }
  });

  // one row per student, one small mark per question (blank where a question wasn't in their set)
  let MS = null;
  async function openMarksheet(code) {
    go('archive');
    $('#arcListWrap').classList.add('hidden'); $('#arcDetail').classList.remove('hidden');
    $('#arcDetail').innerHTML = '<div class="spinner" style="margin:40px auto"></div>';
    const d = (await B.get(`sessions/${code}`)) || {};
    if ((d.meta || {}).kind === 'present') return renderAttendance(code, d);
    const split = EL.splitPaper(d.questions);
    MS = { code, meta: d.meta || {}, questions: split.questions, key: d.key || {}, students: d.students || {}, control: d.control || {}, overrides: d.overrides || {}, sets: metaSets(d.meta) };
    renderMarksheet();
  }
  function msRows() {
    const m = MS;
    return Object.keys(m.students).filter(id => !(m.control[id] || {}).kicked)
      .sort((a, b) => (m.students[a].name || '').localeCompare(m.students[b].name || ''))
      .map(id => {
        const k = setOfIn(id, m.students, m.control), mine = qsFor(m.questions, m.sets, k);
        return { id, s: m.students[id], k, mine: new Set(mine.map(q => q.id)), g: EL.grade(mine, m.key, m.students[id].answers, m.overrides[id]) };
      });
  }
  function msPending(rows) {
    const out = [];
    rows.forEach(r => MS.questions.forEach(q => { if (r.mine.has(q.id) && r.g.state[q.id] === 'pend') out.push([r.id, q.id]); }));
    return out;
  }
  function renderMarksheet() {
    const m = MS, qs = m.questions, multi = m.sets && m.sets.length > 1;
    const rows = msRows();
    const had = q => rows.filter(r => r.mine.has(q.id));
    const qRight = qs.map(q => { const h = had(q); return h.length ? Math.round(h.filter(r => r.g.marks[q.id]).length / h.length * 100) + '%' : '–'; });
    const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.g.pct, 0) / rows.length) : 0;
    const pend = msPending(rows).length;
    const sym = (st, got) => ({ ok: '✓', bad: '✗', blank: '·', pend: '?', part: EL.fmtPts(got) }[st]);
    $('#arcDetail').innerHTML = `
      <div class="ms-head">
        <button class="btn sm ghost" id="msBack">← Past results</button>
        <div class="ms-title"><span class="label">Mark sheet · ${esc(m.code)}</span><h2>${esc(m.meta.title || 'Test')}</h2>
          <div class="small muted">${m.meta.createdAt ? new Date(m.meta.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''} · ${rows.length} students · ${multi ? m.sets.length + ' sets · ' : ''}${multi || (m.sets && m.sets[0] && EL.asArray(m.sets[0].ids).length < qs.length) ? EL.asArray(m.sets[0].ids).length + ' questions each from ' + qs.length : qs.length + ' questions'} · class average <b>${avg}%</b></div></div>
        ${pend ? `<button class="btn sm primary" id="msMark">${icon('check')}Mark written answers (${pend})</button>` : ''}
        <button class="btn sm" id="msCsv">${icon('download')}Download</button>
      </div>
      <div class="ms-wrap"><table class="ms">
        <thead><tr><th class="ms-name">Student</th>${multi ? '<th class="ms-num">Set</th>' : ''}<th class="ms-num">Score</th><th class="ms-num">Left</th>
          ${qs.map((q, i) => `<th class="ms-q" title="${esc(q.sheet ? 'Number ' + q.n : EL.TYPE_LABEL[q.type] + ': ' + q.text)}">${q.sheet ? q.n : i + 1}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr><td class="ms-name">${esc(r.s.name)}${r.s.status !== 'submitted' ? ' <span class="small muted">(not submitted)</span>' : ''}</td>
          ${multi ? `<td class="ms-num"><b>${r.k == null ? '–' : EL.setLetter(r.k)}</b></td>` : ''}
          <td class="ms-num"><b>${EL.fmtPts(r.g.score)}/${r.g.total}</b> <span class="muted">${r.g.pct}%</span>${r.g.pending ? ` <span class="pendtag">${r.g.pending} to mark</span>` : ''}</td>
          <td class="ms-num ${r.s.leaves ? 'bad' : ''}">${r.s.leaves || 0}</td>
          ${qs.map(q => {
            if (!r.mine.has(q.id)) return '<td class="ms-c na" title="Not in this student\'s set"></td>';
            const a = (r.s.answers || {})[q.id], st = stateOf(r.g, q);
            const can = handMarked(q) && st !== 'blank';
            return `<td class="ms-c ${st} ${can ? 'can' : ''}" title="Answer: ${esc(plainAnswer(q, a) || '-').slice(0, 200)}${can ? ' (click to mark)' : ''}" ${can ? `data-sid="${r.id}" data-q="${q.id}"` : ''}>${sym(st, r.g.got[q.id])}</td>`;
          }).join('')}</tr>`).join('')}
        </tbody>
        <tfoot><tr><td class="ms-name muted">Got it right</td>${multi ? '<td></td>' : ''}<td></td><td></td>${qRight.map(p => `<td class="ms-c pct">${p}</td>`).join('')}</tr></tfoot>
      </table></div>
      <p class="small muted ms-key">✓ correct · ✗ wrong · a number = part marks · <b>?</b> waiting for you to mark · <b>·</b> no answer${multi ? ' · empty = not in their set' : ''}. Hover a mark to see the answer. Click a written answer, matching or fill-in mark to change it.</p>`;
  }
  $('#arcDetail').addEventListener('click', async e => {
    if (e.target.closest('#msBack')) { $('#arcDetail').classList.add('hidden'); $('#arcListWrap').classList.remove('hidden'); return; }
    if (e.target.closest('#msCsv')) return MS && MS.attendance ? attendanceCSV(MS.meta, MS.students, MS.control, MS.code) : marksheetCSV();
    if (e.target.closest('#msMark')) { const p = msPending(msRows())[0]; if (p) openMark(p[0], p[1]); return; }
    const c = e.target.closest('.ms-c.can'); if (!c) return;
    openMark(c.dataset.sid, c.dataset.q);
  });

  // ---------------- marking one answer (essays, short answers, or changing a part mark)
  let MM = null;
  function openMark(sid, qid) {
    const q = MS.questions.find(x => x.id === qid), s = MS.students[sid]; if (!q || !s) return;
    const n = MS.questions.indexOf(q) + 1, pts = Number(q.points) || 1;
    const k = setOfIn(sid, MS.students, MS.control);
    const g = EL.grade(qsFor(MS.questions, MS.sets, k), MS.key, s.answers, MS.overrides[sid]);
    const own = (MS.overrides[sid] || {})[qid];
    MM = { sid, qid, pts };
    $('#mkmTag').textContent = `Question ${n} · ${EL.TYPE_LABEL[q.type]}`;
    $('#mkmWho').textContent = s.name || '';
    $('#mkmQ').innerHTML = esc(q.type === 'fill' ? String(q.text).replace(/\[\[\]\]/g, '____') : q.text).replace(/\n/g, '<br>') + (q.image ? `<img src="${q.image}" alt="">` : '');
    $('#mkmA').innerHTML = fmtAnswer(q, (s.answers || {})[qid]);
    $('#mkmKeyL').textContent = q.type === 'essay' ? 'Model answer' : 'Correct answer';
    $('#mkmK').innerHTML = fmtKeyOf(q, MS.key[qid]);
    const steps = pts <= 10 ? Array.from({ length: pts + 1 }, (_, i) => i) : [0, pts / 4, pts / 2, pts * 3 / 4, pts].map(v => Math.round(v * 2) / 2);
    $('#mkmQuick').innerHTML = steps.map(v => `<button type="button" class="btn sm" data-v="${v}">${EL.fmtPts(v)}</button>`).join('');
    $('#mkmPts').max = pts;
    $('#mkmPts').value = own != null ? EL.fmtPts(g.got[qid]) : g.state[qid] === 'pend' ? '' : EL.fmtPts(g.got[qid]);
    $('#mkmOf').textContent = '/ ' + pts;
    const left = msPending(msRows()).length;
    $('#mkmLeft').textContent = left ? left + ' still to mark' : 'All marked';
    $('#markModal').classList.remove('hidden');
    setTimeout(() => $('#mkmPts').focus(), 30);
  }
  $('#mkmQuick').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { $('#mkmPts').value = b.dataset.v; $$('#mkmQuick .btn').forEach(x => x.classList.toggle('primary', x === b)); } });
  async function saveMark() {
    const raw = $('#mkmPts').value.trim();
    if (raw === '') { EL.toast('Type the points first (or press one of the numbers).', 'amber'); return false; }
    const v = Math.max(0, Math.min(MM.pts, Math.round(Number(raw) * 2) / 2 || 0));
    MS.overrides[MM.sid] = Object.assign({}, MS.overrides[MM.sid], { [MM.qid]: v });
    await B.update(`sessions/${MS.code}/overrides/${MM.sid}`, { [MM.qid]: v });
    // keep the class average in Past results up to date
    const rows = msRows();
    B.update(`teachers/${S.uid}/history/${MS.code}`, { avg: rows.length ? Math.round(rows.reduce((a, r) => a + r.g.pct, 0) / rows.length) : 0, pending: msPending(rows).length });
    renderMarksheet();
    return true;
  }
  $('#mkmNo').addEventListener('click', () => $('#markModal').classList.add('hidden'));
  $('#mkmSave').addEventListener('click', async () => { if (await saveMark()) $('#markModal').classList.add('hidden'); });
  $('#mkmNext').addEventListener('click', async () => {
    if (!(await saveMark())) return;
    const next = msPending(msRows())[0];
    if (next) openMark(next[0], next[1]);
    else { $('#markModal').classList.add('hidden'); EL.toast('<b>Everything is marked.</b>', 'green', 3000); }
  });
  $('#mkmPts').addEventListener('keydown', e => { if (e.key === 'Enter') $('#mkmNext').click(); });

  function marksheetCSV() {
    const m = MS, qs = m.questions, multi = m.sets && m.sets.length > 1;
    const head = ['Name'].concat(multi ? ['Set'] : [], ['Score', 'Total', 'Percent', 'Still to mark', 'Times left'], qs.map((q, i) => 'Q' + (q.sheet ? q.n : i + 1)));
    const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = msRows().map(r => [r.s.name].concat(multi ? [r.k == null ? '' : EL.setLetter(r.k)] : [], [r.g.score, r.g.total, r.g.pct, r.g.pending || '', r.s.leaves || 0],
      qs.map(q => !r.mine.has(q.id) ? '' : r.g.state[q.id] === 'pend' ? '?' : r.g.got[q.id])));
    const csv = '﻿' + [head].concat(rows).map(r => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${(m.meta.title || 'test').replace(/[^\w\- ]+/g, '').trim() || 'test'}_${m.code}_marks.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ================================================================ make from paper (AI)
  Maker.init({
    busy, asIs: useAsIs,
    editing: () => S.editing && !$('#edMain').classList.contains('hidden') ? S.editing : null,
    use: async (qs, title, mode) => {
      const make = q => Object.assign(newQ(q.type), q, { id: 'q' + EL.rid(6) });
      if (mode === 'add' && S.editing) {
        S.editing.questions.push(...qs.map(make));
        go('tests'); edTab('qs'); markDirty(); renderEditor();
      } else {
        if (S.dirty && S.editing && !(await confirmBox('Discard unsaved changes?', 'The open test has changes that are not saved.', 'Discard', true))) return;
        openEditor({ id: 't' + EL.rid(8), title, timeLimit: 0, shuffle: false, pick: 0, nsets: 1, questions: qs.map(make) });
        S.dirty = true; infoLine();
      }
      EL.toast('<b>Check every question and answer.</b><br><span class="muted">Then choose how many each student answers and how many sets, and press Save.</span>', 'green', 9000);
    }
  });

  // ================================================================ presentation
  // Slides are pictures in sessions/<code>/questions/<i> (students may read that list, so no
  // rule change is needed). meta.slide = the slide on show, meta.ptr = the laser pointer.
  const PS = { files: null, slides: [] };
  $('#prFile').addEventListener('change', async e => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    try {
      const slides = await Importer.readSlides(files, t => busy(t));
      PS.slides = slides;
      if (!$('#prTitle').value.trim()) $('#prTitle').value = files[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      renderDeck();
    } catch (ex) { console.error(ex); EL.toast(esc(ex.message || ex), 'red', 10000); }
    finally { busy(''); }
  });
  function renderDeck() {
    const n = PS.slides.length;
    $('#prThumbs').innerHTML = PS.slides.map((src, i) => `<figure class="pr-th"><img src="${src}" alt=""><figcaption>${i + 1}</figcaption><button class="pr-del" data-del="${i}" title="Remove this slide">${icon('x')}</button></figure>`).join('');
    $('#prEmpty').classList.toggle('hidden', !!n);
    $('#prReady').classList.toggle('hidden', !n);
    const kb = Math.round(PS.slides.reduce((a, x) => a + x.length, 0) * .75 / 1024);
    $('#prInfo').textContent = n ? `${n} slide${n === 1 ? '' : 's'} · about ${kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'} in total` : '';
  }
  $('#prThumbs').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; PS.slides.splice(Number(b.dataset.del), 1); renderDeck(); });
  $('#prClear').addEventListener('click', () => { PS.slides = []; $('#prTitle').value = ''; renderDeck(); });
  $('#prStart').addEventListener('click', () => {
    const title = $('#prTitle').value.trim();
    if (!title) return EL.toast('Give the lesson a title first.', 'red');
    startDeck(title, PS.slides);
  });
  async function presentAgain(old) {
    if ((S.history[old] || {}).mode === 'screen') return startScreen(S.history[old].title || 'Lesson');
    busy('Loading the slides…');
    let slides = [], title = (S.history[old] || {}).title || 'Lesson';
    try { slides = EL.asArray(await B.get(`sessions/${old}/questions`)).map(x => x && x.img).filter(Boolean); } finally { busy(''); }
    if (!slides.length) return EL.toast('Those slides are no longer saved.', 'red');
    startDeck(title, slides);
  }
  async function startDeck(title, slides) {
    if (!slides.length) return;
    if (S.code && S.meta && S.meta.status !== 'ended' && !(await confirmBox('Something is still running', 'Starting this lesson switches your screen away from it. It keeps running and you can reopen it from Past results.', 'Start anyway'))) return;
    let code = null;
    for (let i = 0; i < 6; i++) { const c = EL.makeCode(); if (!(await B.get(`sessions/${c}/meta`))) { code = c; break; } }
    if (!code) return EL.toast('Could not make a code. Try again.', 'red');
    const now = B.now();
    try {
      // the session exists first ("waiting"), then the slides go up one by one, then it opens
      busy('Getting the lesson ready…');
      await B.set(`sessions/${code}/meta`, { kind: 'present', title, status: 'waiting', createdAt: now, n: slides.length, slide: 0, owner: S.uid });
      for (let i = 0; i < slides.length; i++) {
        busy(`Sending slide ${i + 1} of ${slides.length}…`);
        await B.update(`sessions/${code}/questions`, { [i]: { type: 'slide', img: slides[i] } });
      }
      await B.update(`sessions/${code}/meta`, { status: 'live', startedAt: B.now() });
      await B.set(`teachers/${S.uid}/history/${code}`, { kind: 'present', title, createdAt: now, n: slides.length });
    } catch (ex) { console.error(ex); busy(''); return EL.toast('Could not start: ' + esc(ex.message || ex), 'red', 8000); }
    busy('');
    PS.slides = []; $('#prTitle').value = ''; renderDeck();
    play('granted');
    await openSession(code);
    openProjector();
  }

  // ---------------- presenting: the teacher's own view
  const curIdx = () => Math.max(0, Math.min(S.slides.length - 1, Number(S.meta && S.meta.slide) || 0));
  function goSlide(i) {
    if (!isPres() || !S.meta || S.meta.status === 'ended') return;
    i = Math.max(0, Math.min(S.slides.length - 1, i));
    if (i === curIdx()) return;
    S.meta.slide = i; renderSlide(); renderStats(); tick();
    B.update(P('meta'), { slide: i, ptr: null });
  }
  function renderSlide() {
    const i = curIdx(), n = S.slides.length, src = S.slides[i] || '';
    for (const img of [$('#psImg'), $('#pfImg')]) if (img.getAttribute('src') !== src) img.src = src;
    $('#psNext').src = S.slides[i + 1] || '';
    $('#psNextBox').classList.toggle('hidden', i + 1 >= n);
    $('#psNum').textContent = `${i + 1} / ${n}`; $('#pfNum').textContent = `${i + 1} / ${n}`;
    const strip = $('#psStrip');
    if (strip._n !== n || strip._code !== S.code) {
      strip._n = n; strip._code = S.code;
      strip.innerHTML = S.slides.map((s2, k) => `<button class="ps-mini" data-go="${k}"><img src="${s2}" alt=""><span>${k + 1}</span></button>`).join('');
    }
    strip.querySelectorAll('.ps-mini').forEach((b, k) => b.classList.toggle('on', k === i));
    const on = strip.querySelector('.ps-mini.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    paintOwnPtr();
  }
  $('#psStrip').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) goSlide(Number(b.dataset.go)); });
  $('#psPrev').addEventListener('click', () => goSlide(curIdx() - 1));
  $('#psNextBtn').addEventListener('click', () => goSlide(curIdx() + 1));
  $('#pfPrev').addEventListener('click', () => goSlide(curIdx() - 1));
  $('#pfNextBtn').addEventListener('click', () => goSlide(curIdx() + 1));
  // arrow keys, space and presentation clickers (they send PageUp / PageDown)
  document.addEventListener('keydown', e => {
    if (!isPres() || isScreen() || !S.code || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if ($('#v-live').classList.contains('hidden') && !fullOpen()) return;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(e.key)) { e.preventDefault(); goSlide(curIdx() + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(e.key)) { e.preventDefault(); goSlide(curIdx() - 1); }
    else if (e.key === 'Home') goSlide(0);
    else if (e.key === 'End') goSlide(S.slides.length - 1);
    else if (e.key === 'l' || e.key === 'L') setLaser(!laser);
    else if ((e.key === 'f' || e.key === 'F5') && !fullOpen()) { e.preventDefault(); openFull(); }
  });

  // ---------------- laser pointer: hold it over the slide, students see a red dot in the same spot
  let laser = false, ptrT = 0, ptrTimer = null, ownPtr = null;
  function setLaser(on) {
    laser = on;
    document.body.classList.toggle('laser', on);
    $$('.laser-btn').forEach(b => b.classList.toggle('on', on));
    if (!on) { ownPtr = null; paintOwnPtr(); if (S.code && isPres()) B.update(P('meta'), { ptr: null }); }
  }
  $$('.laser-btn').forEach(b => b.addEventListener('click', () => setLaser(!laser)));
  function sendPtr(p) {
    ownPtr = p; paintOwnPtr();
    clearTimeout(ptrTimer);
    const go = () => { ptrT = Date.now(); B.update(P('meta'), { ptr: p }); };
    if (Date.now() - ptrT > 70) go(); else ptrTimer = setTimeout(go, 70);
  }
  function slideXY(img, e) {
    const r = img.getBoundingClientRect(), k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k, ox = r.left + (r.width - w) / 2, oy = r.top + (r.height - h) / 2;
    const x = (e.clientX - ox) / w, y = (e.clientY - oy) / h;
    return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, on: true };
  }
  for (const id of ['#psImg', '#pfImg']) {
    const img = $(id);
    img.addEventListener('pointermove', e => { if (!laser || !img.naturalWidth || !isPres()) return; const p = slideXY(img, e); if (p) sendPtr(p); });
    img.addEventListener('pointerleave', () => { if (laser && isPres()) sendPtr(null); });
  }
  function paintOwnPtr() {
    for (const [imgId, dotId] of [['#psImg', '#psPtr'], ['#pfImg', '#pfPtr']]) {
      const img = $(imgId), dot = $(dotId);
      if (!ownPtr || !img.naturalWidth || !img.offsetParent) { dot.classList.add('hidden'); continue; }
      const host = img.parentElement.getBoundingClientRect(), r = img.getBoundingClientRect(), k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
      const w = img.naturalWidth * k, h = img.naturalHeight * k;
      dot.style.transform = `translate(${r.left - host.left + (r.width - w) / 2 + ownPtr.x * w}px, ${r.top - host.top + (r.height - h) / 2 + ownPtr.y * h}px)`;
      dot.classList.remove('hidden');
    }
  }

  // ---------------- full screen for the projector: just the slide. Names never show here,
  // only a small red count, so the class doesn't see who left; the alarm still sounds.
  const fullOpen = () => !$('#presFull').classList.contains('hidden');
  function openFull() {
    if (!isPres()) return;
    $('#presFull').classList.remove('hidden');
    renderSlide(); bumpFull();
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
  }
  function closeFull() {
    $('#presFull').classList.add('hidden');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }
  $('#pfClose').addEventListener('click', closeFull);
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && fullOpen()) $('#presFull').classList.add('hidden'); });
  function bumpFullQuiet() {
    const n = Object.keys(S.students).filter(id => { const st = statusOf(id); return st === 'away' || st === 'locked'; }).length;
    const b = $('#pfAlert'); if (b.textContent !== (n ? n + ' left' : '')) bumpFull();
  }
  function bumpFull() {
    const n = Object.keys(S.students).filter(id => { const st = statusOf(id); return st === 'away' || st === 'locked'; }).length;
    const b = $('#pfAlert');
    b.textContent = n ? n + ' left' : '';
    b.classList.toggle('hidden', !n);
    if (n) { b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); }
  }
  $('#pfAlert').addEventListener('click', () => { closeFull(); const ids = rosterOrder().filter(id => ['away', 'locked'].includes(statusOf(id))); if (ids[0]) openStudent(ids[0]); });

  // ---------------- attendance (past lessons)
  function renderAttendance(code, d) {
    const m = d.meta || {}, studs = d.students || {}, ctl = d.control || {};
    const ids = Object.keys(studs).filter(id => !(ctl[id] || {}).kicked).sort((a, b) => (studs[a].name || '').localeCompare(studs[b].name || ''));
    MS = { code, meta: m, students: studs, control: ctl, attendance: true };
    $('#arcDetail').innerHTML = `
      <div class="ms-head">
        <button class="btn sm ghost" id="msBack">← Past results</button>
        <div class="ms-title"><span class="label">Attendance · ${esc(code)}</span><h2>${esc(m.title || 'Lesson')}</h2>
          <div class="small muted">${m.createdAt ? new Date(m.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''} · ${m.mode === 'screen' ? 'PowerPoint screen share' : (m.n || 0) + ' slides'} · ${ids.length} students · ${ids.filter(id => studs[id].leaves).length} left the page</div></div>
        <button class="btn sm" id="msCsv">${icon('download')}Download</button>
      </div>
      <div class="ms-wrap"><table class="ms">
        <thead><tr><th class="ms-name">Student</th><th class="ms-num">Joined</th><th class="ms-num">Times left</th><th class="ms-num">Time away</th><th class="ms-num">Device</th></tr></thead>
        <tbody>${ids.map(id => { const s = studs[id]; return `<tr><td class="ms-name">${esc(s.name)}</td>
          <td class="ms-num">${s.joinedAt ? EL.clock(s.joinedAt).slice(0, 5) : '–'}</td>
          <td class="ms-num ${s.leaves ? 'bad' : ''}">${s.leaves || 0}</td>
          <td class="ms-num">${s.awayMs ? EL.fmtDur(s.awayMs) : '–'}</td>
          <td class="ms-num muted">${esc(s.device || '')}</td></tr>`; }).join('') || '<tr><td class="ms-name muted">Nobody joined.</td><td></td><td></td><td></td><td></td></tr>'}</tbody>
      </table></div>`;
  }
  function attendanceCSV(m, studs, ctl, code) {
    const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = Object.keys(studs || {}).filter(id => !((ctl || {})[id] || {}).kicked).map(id => {
      const s = studs[id];
      return [s.name, s.joinedAt ? new Date(s.joinedAt).toLocaleString() : '', s.leaves || 0, Math.round((s.awayMs || 0) / 1000), s.device || ''];
    }).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
    const csv = '﻿' + [['Name', 'Joined', 'Times left', 'Seconds away', 'Device']].concat(rows).map(r => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${((m || {}).title || 'lesson').replace(/[^\w\- ]+/g, '').trim() || 'lesson'}_${code}_attendance.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ================================================================ screen sharing
  // PowerPoint keeps its animations: the teacher shares the slide show window and it streams straight
  // to every iPad (WebRTC, one connection per student, over the classroom Wi-Fi). The database only
  // carries the handshake: the student asks (students/<sid>/rtcWant), the teacher offers
  // (control/<sid>/rtc), the student answers (students/<sid>/rtcAns). No rule change is needed.
  const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const canShare = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.RTCPeerConnection);
  function gathered(pc, ms) {
    return new Promise(res => {
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(res, ms);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }
  async function grabScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      // 1280x720 is the most H.264 level 3.1 allows; bigger pictures are refused by the decoder
      video: { frameRate: { ideal: 30, max: 30 }, width: { max: 1280 }, height: { max: 720 } },
      audio: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include'
    });
    const tr = stream.getVideoTracks()[0];
    try { tr.contentHint = 'detail'; } catch (e) {}
    tr.addEventListener('ended', () => { if (SS.stream === stream) shareEnded(); });
    return stream;
  }
  function shareError(ex) {
    if (ex && ex.name === 'NotAllowedError') return EL.toast('Sharing was cancelled.', 'amber');
    console.error(ex); EL.toast('Could not share the screen: ' + esc((ex && ex.message) || ex), 'red', 8000);
  }
  async function startScreen(title) {
    if (!canShare()) return EL.toast("This browser can't share the screen. Open this page in Chrome or Edge on a computer.", 'red', 9000);
    if (S.code && S.meta && S.meta.status !== 'ended' && !(await confirmBox('Something is still running', 'Starting this lesson switches your screen away from it. It keeps running and you can reopen it from Past results.', 'Start anyway'))) return;
    let stream;
    try { stream = await grabScreen(); } catch (ex) { return shareError(ex); }
    let code = null;
    for (let i = 0; i < 6; i++) { const c = EL.makeCode(); if (!(await B.get(`sessions/${c}/meta`))) { code = c; break; } }
    if (!code) { stream.getTracks().forEach(t => t.stop()); return EL.toast('Could not make a code. Try again.', 'red'); }
    const now = B.now();
    try {
      busy('Getting the lesson ready…');
      await B.set(`sessions/${code}/meta`, { kind: 'present', mode: 'screen', title, status: 'live', createdAt: now, startedAt: now, n: 0, slide: 0, sharing: true, owner: S.uid });
      await B.set(`teachers/${S.uid}/history/${code}`, { kind: 'present', mode: 'screen', title, createdAt: now, n: 0 });
    } catch (ex) { console.error(ex); busy(''); stream.getTracks().forEach(t => t.stop()); return EL.toast('Could not start: ' + esc(ex.message || ex), 'red', 8000); }
    busy('');
    stopShare();
    SS.code = code; SS.stream = stream;
    $('#ssTitle').value = '';
    play('granted');
    await openSession(code);
    showPreview();
    openProjector();
  }
  $('#ssStart').addEventListener('click', () => {
    const t = $('#ssTitle').value.trim();
    if (!t) { $('#ssTitle').focus(); return EL.toast('Give the lesson a title first.', 'red'); }
    startScreen(t);
  });
  // pick the window again (after the slide show was closed, or to show a different window)
  async function reshare() {
    if (!isScreen() || !S.code) return;
    if (!canShare()) return EL.toast("This browser can't share the screen. Use Chrome or Edge on a computer.", 'red', 9000);
    let stream;
    try { stream = await grabScreen(); } catch (ex) { return shareError(ex); }
    const old = SS.stream;
    SS.stream = stream; SS.code = S.code;
    if (old) old.getTracks().forEach(t => t.stop());
    const tr = stream.getVideoTracks()[0];
    for (const p of Object.values(SS.peers)) if (p.sender) p.sender.replaceTrack(tr).catch(console.error);
    retune();   // the new window may be a different size
    B.update(P('meta'), { sharing: true });
    showPreview(); tick();
  }
  // the teacher pressed "Stop sharing", or closed the slide show window
  function shareEnded() {
    SS.stream = null;
    for (const p of Object.values(SS.peers)) if (p.sender) p.sender.replaceTrack(null).catch(() => {});
    if (S.code && isScreen() && S.meta && S.meta.status !== 'ended') {
      B.update(P('meta'), { sharing: false });
      EL.toast('<b>Screen sharing stopped.</b><br><span class="muted">Students see "paused". Press Share my screen to carry on.</span>', 'amber', 9000);
    }
    showPreview(); tick();
  }
  $('#ssShare').addEventListener('click', reshare);
  $('#ssStop').addEventListener('click', () => { if (!SS.stream) return; SS.stream.getTracks().forEach(t => t.stop()); shareEnded(); });
  function showPreview() {
    const v = $('#psVid');
    if (v.srcObject !== SS.stream) v.srcObject = SS.stream;
    if (SS.stream) v.play().catch(() => {});
    $('#ssPaused').classList.toggle('hidden', !!SS.stream);
    $('#ssShare').innerHTML = icon('present') + (SS.stream ? 'Share a different window' : 'Share my screen');
    $('#ssShare').className = 'btn sm ' + (SS.stream ? '' : 'primary');
    $('#ssStop').classList.toggle('hidden', !SS.stream);
    renderBar();
  }
  function stopShare() {
    for (const id of Object.keys(SS.peers)) closePeer(id);
    if (SS.stream) SS.stream.getTracks().forEach(t => t.stop());
    SS.stream = null; SS.code = null;
    $('#psVid').srcObject = null;
  }
  function closePeer(id) {
    const p = SS.peers[id]; if (!p) return;
    delete SS.peers[id];
    try { p.pc.close(); } catch (e) {}
  }
  // The computer encodes the picture once per iPad, so a big class gets a lighter stream: measured on a
  // Core i5 laptop, this keeps ~20 frames/s up to 20 iPads and ~14 frames/s for 30. The class also
  // shares one Wi-Fi, so a fixed bandwidth budget is split between the iPads that are watching.
  function encFor(n) {
    n = Math.max(1, n);
    // never more than 1280x720 (H.264 level 3.1), even if the browser hands over a bigger picture
    const tr = SS.stream && SS.stream.getVideoTracks()[0], st = (tr && tr.getSettings && tr.getSettings()) || {};
    const base = Math.max(1, (st.width || 0) / 1280, (st.height || 0) / 720);
    return { maxBitrate: Math.round(Math.max(500e3, Math.min(2.5e6, 30e6 / n))), maxFramerate: n > 20 ? 15 : n > 10 ? 20 : 30, scaleResolutionDownBy: Math.round(base * (n > 20 ? 1.25 : 1) * 100) / 100 };
  }
  const watchingN = () => Object.values(SS.peers).filter(p => p.state === 'connected').length;
  function tuneSender(p, enc) {
    const prm = p.sender.getParameters();
    if (!prm.encodings || !prm.encodings.length) return;
    Object.assign(prm.encodings[0], enc);
    prm.degradationPreference = 'balanced';   // keep animations moving, not only sharp
    p.enc = JSON.stringify(enc);
    p.sender.setParameters(prm).catch(e => console.warn('[screen] setParameters', e));
  }
  function retune() { const enc = encFor(watchingN()), sig = JSON.stringify(enc); for (const p of Object.values(SS.peers)) if (p.state === 'connected' && p.enc !== sig) tuneSender(p, enc); }
  // H.264: cheapest for the computer to send (measured 3x more iPads than VP8) and the iPad decodes it in hardware
  function preferH264(tx) {
    try {
      const caps = RTCRtpSender.getCapabilities && RTCRtpSender.getCapabilities('video');
      if (!caps || !tx.setCodecPreferences || window.__ssCodec === 'default') return;
      // Constrained Baseline, packetization-mode 1: the profile every iPad decodes in hardware
      const rank = c => !/h264/i.test(c.mimeType) ? 9 : /packetization-mode=1/.test(c.sdpFmtpLine || '') ? (/profile-level-id=42e0/i.test(c.sdpFmtpLine) ? 0 : /profile-level-id=4200/i.test(c.sdpFmtpLine) ? 1 : 2) : 3;
      const sorted = caps.codecs.slice().sort((a, b) => rank(a) - rank(b));
      if (rank(sorted[0]) < 9) tx.setCodecPreferences(sorted);
    } catch (e) { console.warn('[screen] codec', e); }
  }
  // what the teacher sees under the preview: how many iPads, how smooth
  let ssStatsT = 0;
  async function ssStats() {
    if (!isScreen() || !SS.stream || Date.now() - ssStatsT < 2500) return;
    ssStatsT = Date.now();
    const fps = [];
    for (const p of Object.values(SS.peers)) {
      if (p.state !== 'connected') continue;
      try { (await p.sender.getStats()).forEach(x => { if (x.type === 'outbound-rtp') fps.push(x.framesPerSecond || 0); }); } catch (e) {}
    }
    const n = fps.length, med = n ? fps.sort((a, b) => a - b)[n >> 1] : 0;
    $('#ssInfo').textContent = n ? `Sending to ${n} iPad${n === 1 ? '' : 's'} · about ${Math.round(med)} pictures a second while something moves · present in PowerPoint as normal`
      : 'Present in PowerPoint as normal. Every click and animation shows on the iPads.';
  }
  async function connectPeer(sid, want) {
    closePeer(sid);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const p = SS.peers[sid] = { pc, want, id: Math.random().toString(36).slice(2, 10), state: 'connecting', offered: false, answered: false, code: S.code };
    const tr = SS.stream ? SS.stream.getVideoTracks()[0] : null;
    const enc = encFor(watchingN() + 1);
    const tx = pc.addTransceiver(tr || 'video', { direction: 'sendonly', streams: SS.stream ? [SS.stream] : [], sendEncodings: [enc] });
    preferH264(tx);
    p.sender = tx.sender;
    tuneSender(p, enc);   // set before connecting: changing it mid-stream makes the iPad wait for a fresh keyframe
    pc.addEventListener('connectionstatechange', () => {
      if (SS.peers[sid] !== p) return;
      p.state = pc.connectionState;
      if (p.state === 'connected' || p.state === 'failed' || p.state === 'closed') retune();
      queue();
    });
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc, 2500);
      if (SS.peers[sid] !== p || S.code !== p.code) return;
      await B.set(P(`control/${sid}/rtc`), { want, id: p.id, offer: pc.localDescription.sdp });
      p.offered = true;
      rtcSync();
    } catch (e) { console.error(e); if (SS.peers[sid] === p) { p.state = 'failed'; queue(); } }
  }
  // every student who asks gets a connection; a new ask (reload, lost Wi-Fi) gets a fresh one
  function rtcSync() {
    if (!isScreen() || !S.code || !window.RTCPeerConnection) return;
    if (S.meta && S.meta.status === 'ended') return;
    for (const id of Object.keys(S.students)) {
      const s = S.students[id], p = SS.peers[id];
      if ((S.control[id] || {}).kicked) { closePeer(id); continue; }
      if (!s.rtcWant) continue;
      if (!p || p.want !== s.rtcWant) { connectPeer(id, s.rtcWant); continue; }
      const a = s.rtcAns;
      if (p.offered && !p.answered && a && a.id === p.id) {
        p.answered = true;
        p.pc.setRemoteDescription({ type: 'answer', sdp: a.sdp }).catch(e => { console.error(e); p.state = 'failed'; queue(); });
      }
    }
    for (const id of Object.keys(SS.peers)) if (!S.students[id]) closePeer(id);
  }
  function screenTxt(id) {
    const st = (SS.peers[id] || {}).state;
    return st === 'connected' ? 'sees your screen' : st === 'failed' || st === 'disconnected' ? "can't see your screen" : 'connecting…';
  }
  window.__ss = SS;   // for testing

  // ================================================================ setup guide
  const RULES = `{
  "rules": {
    "teachers": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid && auth.token.firebase.sign_in_provider !== 'anonymous'"
      }
    },
    "sessions": {
      "$code": {
        ".read": "auth != null && root.child('sessions/' + $code + '/meta/owner').val() === auth.uid",
        ".write": "auth != null && (root.child('sessions/' + $code + '/meta/owner').val() === auth.uid || (!root.child('sessions/' + $code + '/meta').exists() && newData.child('meta/owner').val() === auth.uid && auth.token.firebase.sign_in_provider !== 'anonymous'))",
        "meta": { ".read": "auth != null" },
        "questions": { ".read": "auth != null" },
        "students": {
          "$sid": {
            ".read": "auth != null && auth.uid === $sid",
            ".write": "auth != null && auth.uid === $sid",
            ".validate": "!data.exists() || newData.child('lockSeq').val() >= data.child('lockSeq').val()"
          }
        },
        "control": { "$sid": { ".read": "auth != null && auth.uid === $sid" } },
        "results": { "$sid": { ".read": "auth != null && auth.uid === $sid" } },
        "events": { "$eid": { ".write": "auth != null && !data.exists() && newData.child('sid').val() === auth.uid" } }
      }
    }
  }
}`;
  // Rules that let ONLY this teacher account make tests and run classes (students still join with a code)
  const ownerRules = uid => `{
  "rules": {
    "teachers": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid && auth.uid === '${uid}'",
        ".write": "auth != null && auth.uid === $uid && auth.uid === '${uid}'"
      }
    },
    "sessions": {
      "$code": {
        ".read": "auth != null && root.child('sessions/' + $code + '/meta/owner').val() === auth.uid",
        ".write": "auth != null && auth.uid === '${uid}' && (root.child('sessions/' + $code + '/meta/owner').val() === auth.uid || (!root.child('sessions/' + $code + '/meta').exists() && newData.child('meta/owner').val() === auth.uid))",
        "meta": { ".read": "auth != null" },
        "questions": { ".read": "auth != null" },
        "students": {
          "$sid": {
            ".read": "auth != null && auth.uid === $sid",
            ".write": "auth != null && auth.uid === $sid",
            ".validate": "!data.exists() || newData.child('lockSeq').val() >= data.child('lockSeq').val()"
          }
        },
        "control": { "$sid": { ".read": "auth != null && auth.uid === $sid" } },
        "results": { "$sid": { ".read": "auth != null && auth.uid === $sid" } },
        "events": { "$eid": { ".write": "auth != null && !data.exists() && newData.child('sid').val() === auth.uid" } }
      }
    }
  }
}`;
  function renderSetup() {
    const online = B.mode !== 'demo';
    $('#setupBody').innerHTML = `
      <h2>${online ? 'Online' : 'Demo mode'}</h2>
      <p class="muted">${online ? 'Students can join from any iPad with the link or QR code.' : 'Right now everything stays inside this one browser.'}</p>
      <div class="card"><span class="label">Student link</span><div class="copyrow" style="margin-top:8px"><code id="stuLink">${esc(studentURL())}</code><button class="btn sm" data-copy="stuLink">Copy</button><a class="btn sm" href="${esc(studentURL())}" target="_blank">Open</a></div></div>
      <h3>Lock the iPad for real</h3>
      <div class="card warn"><p style="margin-top:0">A website can't stop an iPad from going to the home screen. This site <b>notices</b> right away, alerts you and locks the test until you unlock it. To <b>block</b> leaving completely, add one of these:</p>
      <p><b>Guided Access (built into every iPad, free).</b> Settings → Accessibility → Guided Access → On. The student opens the test in Safari, triple-clicks the top button, and you type your passcode to start. They can't leave Safari until you end it.</p>
      <p style="margin-bottom:0"><b>Safe Exam Browser (free App Store app).</b> Full exam lockdown. It only exits with your password.</p></div>
      <h3>Only you · private website</h3>
      <div class="card"><p style="margin-top:0">These rules let <b>only your account</b> make tests and run classes. Nobody else can, even if they find the website. Students still join your tests with a code.</p>
      <ol class="pr-steps">
        <li>Press <b>Copy</b> below.</li>
        <li>Open <a href="https://console.firebase.google.com/project/examlock-6f9d3/database/examlock-6f9d3-default-rtdb/rules" target="_blank" rel="noopener">Firebase → Realtime Database → Rules</a> and sign in with the Google account you used to set up Firebase.</li>
        <li>Click inside the rules box, press <b>Ctrl + A</b>, then <b>Ctrl + V</b> to replace everything.</li>
        <li>Press <b>Publish</b>.</li>
      </ol>
      <div class="copyrow" style="margin-top:10px"><span class="small muted">Your account id: <code>${esc(S.uid || '')}</code></span><button class="btn sm primary" data-copy="ownerRulesPre">Copy</button></div>
      <pre id="ownerRulesPre">${esc(ownerRules(S.uid || ''))}</pre></div>
      <details style="margin-top:14px"><summary class="small muted">Older open rules (any teacher account)</summary>
      <div class="copyrow"><span class="small muted">Only for reference.</span><button class="btn sm" data-copy="rulesPre">Copy</button></div>
      <pre id="rulesPre">${esc(RULES)}</pre></details>`;
  }
  $('#setupBody').addEventListener('click', e => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const t = document.getElementById(b.dataset.copy).textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => EL.toast('Copied', 'green', 1500)).catch(() => EL.toast('Select the text and copy it yourself', 'amber'));
  });

  window.addEventListener('beforeunload', e => { if (S.dirty || SS.stream) { e.preventDefault(); e.returnValue = ''; } });
  initAuth();
})();
