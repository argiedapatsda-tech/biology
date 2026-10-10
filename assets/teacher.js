(function () {
  const B = Backend, { $, $$, esc, sfx, icon } = EL;
  EL.paintIcons();
  BioBG.start({ level: .85 });
  const S = {
    uid: null, code: null, meta: null, students: {}, control: {}, events: {}, key: {}, questions: [], paper: null, overrides: {},
    selected: null, tab: 'screen', zoom: 'read', tests: {}, history: {}, editing: null, dirty: false, sound: true
  };
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
  $('#aCreate').addEventListener('click', async () => {
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
    const mp = $('#modePill');
    mp.className = 'modepill ' + (B.mode === 'demo' ? 'demo' : 'online');
    mp.title = B.mode === 'demo' ? 'Demo: this browser only' : 'Online: iPads can join';
    mp.querySelector('span').textContent = B.mode === 'demo' ? 'Demo · this browser only' : 'Online';
    B.on(`teachers/${S.uid}/tests`, t => { S.tests = t || {}; renderTestList(); });
    B.on(`teachers/${S.uid}/history`, h => { S.history = h || {}; renderArchive(); });
    renderSetup();
    let active = null; try { active = localStorage.getItem('examlock-active-' + S.uid); } catch (e) {}
    if (active) openSession(active); else showLiveEmpty();
    setInterval(tick, 1000); tick();
  }

  // ================================================================ navigation
  function go(v) {
    $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    ['live', 'tests', 'archive', 'setup'].forEach(x => $('#v-' + x).classList.toggle('hidden', x !== v));
  }
  $('#nav').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.v === 'archive') { $('#arcDetail').classList.add('hidden'); $('#arcListWrap').classList.remove('hidden'); }
    if (b.dataset.v === 'live' && !S.code) showLiveEmpty(false);
    go(b.dataset.v);
  });
  $('#goTests').addEventListener('click', () => go('tests'));
  $('#soundBtn').addEventListener('click', () => { S.sound = !S.sound; $('#soundBtn').textContent = S.sound ? 'Sound on' : 'Sound off'; sfx.unlock(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#projector').classList.contains('hidden')) closeProjector(); else if (S.selected && document.activeElement !== $('#chatInput')) closeStudent();
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
    const summary = { title: S.meta.title || 'Test', createdAt: S.meta.createdAt || B.now(), endedAt: S.meta.endedAt || B.now(), n: S.questions.length, students: ids.length, avg };
    try { await B.update(`teachers/${S.uid}/history/${code}`, summary); } catch (e) { console.error(e); }
    sessionSubs.forEach(u => u()); sessionSubs = [];
    try { localStorage.removeItem('examlock-active-' + S.uid); } catch (e) {}
    closeStudent(); closeProjector();
    for (const k of Object.keys(alarmLog)) delete alarmLog[k];
    S.code = null; S.meta = null; S.students = {}; rowEls.clear(); $('#roster').innerHTML = '';
    $('#endTitle').textContent = summary.title;
    $('#endSum').textContent = ids.length ? `${ids.length} student${ids.length === 1 ? '' : 's'} · class average ${avg}%. Every answer is marked and saved in Past results.` : 'Nobody joined this test.';
    $('#endOpen').dataset.c = code;
    showLiveEmpty(true);
    play('ok');
    finishing = false;
  }

  async function openSession(code) {
    sessionSubs.forEach(u => u()); sessionSubs = [];
    seenEvents.clear(); eventsPrimed = false;
    Object.assign(S, { code, meta: null, students: {}, control: {}, events: {}, key: {}, questions: [], paper: null, overrides: {}, selected: null });
    rowEls.clear(); $('#roster').innerHTML = ''; feedKeys.clear(); $('#feed').innerHTML = '';
    closeStudent();
    const meta = await B.get(`sessions/${code}/meta`);
    if (!meta) { try { localStorage.removeItem('examlock-active-' + S.uid); } catch (e) {} S.code = null; return showLiveEmpty(); }
    try { localStorage.setItem('examlock-active-' + S.uid, code); } catch (e) {}
    const split = EL.splitPaper(await B.get(P('questions')));
    S.questions = split.questions; S.paper = split.paper;
    S.key = (await B.get(P('key'))) || {};
    $('#liveEmpty').classList.add('hidden'); $('#liveMain').classList.remove('hidden');
    $('#mCode').textContent = code;
    sessionSubs.push(B.on(P('meta'), m => { if (!m) return; S.meta = m; renderBar(); queue(); if (m.status === 'ended') setTimeout(finishSession, 1500); }));
    sessionSubs.push(B.on(P('students'), s => { S.students = s || {}; queue(); }));
    sessionSubs.push(B.on(P('control'), c => { S.control = c || {}; queue(); }));
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
    return s.status === 'testing' ? 'active' : 'waiting';
  }
  const gradeOf = sid => EL.grade(S.questions, S.key, (S.students[sid] || {}).answers, S.overrides[sid]);

  function queue() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderAll(); }); }
  // when every student has submitted, the test ends by itself
  let autoEnding = false;
  function checkAllDone() {
    const m = S.meta; if (!m || m.status !== 'live' || autoEnding) return;
    const ids = Object.keys(S.students).filter(id => statusOf(id) !== 'kicked');
    if (ids.length && ids.every(id => statusOf(id) === 'submitted')) {
      autoEnding = true;
      EL.toast('<b>Everyone has submitted.</b><br><span class="muted">Ending the test and saving the results.</span>', 'green', 5000);
      Promise.resolve(B.update(P('meta'), { status: 'ended', endedAt: B.now() })).finally(() => { autoEnding = false; });
    }
  }
  function renderAll() {
    if (!S.code) return;
    checkAllDone();
    renderStats(); renderRoster(); renderAlerts();
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
    $('#mStatus').textContent = st === 'live' ? 'Test in progress' : st === 'ended' ? 'Test ended' : 'Waiting for students';
    const sig = st + '|' + !!m.release;
    if ($('#mActions').dataset.sig === sig) return;
    $('#mActions').dataset.sig = sig;
    const btn = (act, ic, label, cls) => `<button class="btn sm ${cls || ''}" data-mact="${act}">${ic ? icon(ic) : ''}${label}</button>`;
    let h = '';
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
    if (a === 'end' && await confirmBox('End this test?', 'Anyone still working will be submitted automatically. This cannot be undone.', 'End test', true)) {
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
    const c = { total: ids.length, active: 0, alert: 0, submitted: 0 };
    let sum = 0, n = 0;
    ids.forEach(id => {
      const st = statusOf(id);
      if (st === 'active') c.active++;
      if (st === 'away' || st === 'locked') c.alert++;
      if (st === 'submitted') { c.submitted++; sum += gradeOf(id).pct; n++; }
    });
    if (!$('#stats').children.length) {
      $('#stats').innerHTML = ['Joined', 'Working', 'Left / locked', 'Submitted', 'Average score']
        .map((l, i) => `<div class="stat ${['', 'green', 'red', 'amber', ''][i]}"><b>0</b><span>${l}</span></div>`).join('');
    }
    const vals = [c.total, c.active, c.alert, c.submitted, n ? Math.round(sum / n) + '%' : '–'];
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
    const s = S.students[id], st = statusOf(id), total = S.questions.length || 1;
    const sub = st === 'away' ? 'Left the test now' : st === 'locked' ? 'Locked · waiting for you'
      : st === 'submitted' && s.awayAfter ? 'Finished · outside the page now' : STATUS_TXT[st];
    return `<div class="s-av">${esc(initials(s.name))}</div>
      <div class="s-main"><div class="s-name">${esc(s.name)}</div><div class="s-sub">${esc(sub)}</div></div>
      <div class="s-right"><span class="s-prog">${s.answered || 0}/${S.questions.length}</span>
        <span class="s-bar"><i style="transform:scaleX(${(s.answered || 0) / total})"></i></span>
        <span class="s-flags"><span class="s-msgbtn" data-msg="${id}" role="button" title="Send a private message">${icon('chat')}</span>${s.leaves ? `<span class="s-badge left" title="Times left the test">${icon('leave')}${s.leaves}</span>` : ''}${s.afterLeaves ? `<span class="s-badge after" title="Times left after finishing">${icon('leave')}${s.afterLeaves}</span>` : ''}</span></div>`;
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
    left: 'left the test' + (e.reason ? ' · ' + e.reason.toLowerCase() : ''), back: 'came back after ' + EL.fmtDur(e.ms),
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
        EL.toast(`<b>${esc(e.name)} left the test</b><br><span class="muted">${e.type === 'reload' ? 'They reloaded the page.' : 'Their screen is now locked.'} Click to view.</span>`, 'red', 7000, () => openStudent(e.sid));
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
    $('#fpStatus').textContent = STATUS_TXT[st];
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
    $('#mmTitle').textContent = S.meta ? S.meta.title : '';
    $('#mmWho').textContent = (s.name || '') + ' · code ' + S.code;
    const n = s.answered || 0, total = S.questions.length || 1;
    $('#mmProg').style.transform = `scaleX(${n / total})`;
    $('#mmProgTxt').textContent = n + ' / ' + S.questions.length;
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
  window.addEventListener('resize', () => { if (S.selected && S.tab === 'screen') { lastScrollY = -1; renderStudent(); } });

  function fmtAnswer(q, a) {
    if (a == null || a === '') return '<span class="muted">(no answer)</span>';
    if (q.type === 'mc') { const t = EL.asArray(q.options)[a]; return `<b>${EL.LETTERS[a]}</b>${t ? ' · ' + esc(t) : ''}`; }
    if (q.type === 'tf') return a === 'true' ? 'True' : 'False';
    return esc(a);
  }
  function fmtKey(q) {
    const k = S.key[q.id];
    if (q.type === 'mc') { if (k == null) return '–'; const t = EL.asArray(q.options)[k]; return `<b>${EL.LETTERS[k]}</b>${t ? ' · ' + esc(t) : ''}`; }
    if (q.type === 'tf') return k === 'true' ? 'True' : 'False';
    const arr = EL.asArray(k); return arr.length ? arr.map(esc).join(' <span class="muted">or</span> ') : '<span class="muted">you mark this one</span>';
  }
  function renderAnswers(sid) {
    const s = S.students[sid], g = gradeOf(sid), ov = S.overrides[sid] || {};
    const byId = {}; S.questions.forEach(q => { byId[q.id] = q; });
    const order = (s.order && s.order.length ? s.order : S.questions.map(q => q.id));
    const html = `<div class="ans-sum"><b>${g.score} / ${g.total}</b><span class="muted">${g.pct}% · marked automatically${Object.keys(ov).length ? ' + your changes' : ''}</span></div>` +
      order.map((id, i) => {
        const q = byId[id]; if (!q) return '';
        const a = (s.answers || {})[id], ok = g.marks[id];
        return `<div class="ans-row ${ok ? 'ok' : 'bad'}">
          <div class="ans-q"><b>${q.sheet ? q.n : i + 1}</b>${q.sheet ? '<span class="muted">Answer sheet</span>' : esc(q.text)}</div>
          <div class="ans-line"><span>Answer</span><span>${fmtAnswer(q, a)}</span></div>
          <div class="ans-line"><span>Correct</span><span>${fmtKey(q)}</span></div>
          <div class="ans-mark"><span class="pill ${ok ? 'active' : 'away'}">${ok ? 'Correct' : 'Wrong'} · ${ok ? q.points || 1 : 0}/${q.points || 1}</span>
            ${q.type === 'short' ? `<button class="btn sm" data-ov="1" data-q="${id}">Mark correct</button><button class="btn sm" data-ov="0" data-q="${id}">Mark wrong</button>${ov[id] != null ? `<button class="btn sm ghost" data-ov="auto" data-q="${id}">Undo</button>` : ''}` : ''}
          </div></div>`;
      }).join('');
    if ($('#dt-answers')._h !== html) { $('#dt-answers')._h = html; $('#dt-answers').innerHTML = html; }
  }
  $('#dt-answers').addEventListener('click', e => {
    const b = e.target.closest('[data-ov]'); if (!b) return;
    const v = b.dataset.ov;
    B.update(P('overrides/' + S.selected), { [b.dataset.q]: v === 'auto' ? null : v === '1' });
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
    const qs = S.questions;
    const head = ['Name', 'Status', 'Score', 'Total', 'Percent', 'Times left', 'Seconds away', 'Device', 'Joined', 'Submitted'].concat(qs.map((q, i) => 'Q' + (q.sheet ? q.n : i + 1)));
    const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = Object.keys(S.students).map(id => {
      const s = S.students[id], g = gradeOf(id), a = s.answers || {};
      return [s.name, STATUS_TXT[statusOf(id)], g.score, g.total, g.pct, s.leaves || 0, Math.round((s.awayMs || 0) / 1000), s.device,
        s.joinedAt ? new Date(s.joinedAt).toLocaleString() : '', s.submittedAt ? new Date(s.submittedAt).toLocaleString() : '']
        .concat(qs.map(q => { const v = a[q.id]; if (v == null) return ''; return q.type === 'mc' ? EL.LETTERS[v] : v; }));
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
    const m = S.meta; if (!m || !S.code) return;
    const n = Object.keys(S.students).length;
    let sub = `${S.questions.length} questions · code ${S.code}`;
    let timerTxt = '--:--', cls = '';
    if (m.status === 'live' && m.startedAt) {
      const tl = Number(m.timeLimit) || 0;
      if (tl) {
        const left = m.startedAt + tl * 60000 + (Number(m.extraMs) || 0) - B.now();
        sub += ' · time left'; timerTxt = EL.fmtTime(left); cls = left < 60000 ? 'crit' : left < 300000 ? 'warn' : '';
      } else { sub += ' · time running'; timerTxt = EL.fmtTime(B.now() - m.startedAt); }
    } else if (m.status === 'waiting') sub += ` · ${n} waiting`;
    else if (m.status === 'ended') timerTxt = 'Ended';
    $('#mSub').textContent = sub;
    $('#mClock').textContent = timerTxt; $('#mClock').className = 'lh-clock ' + cls;
    $('#mmTimer').textContent = timerTxt;
    if (S.selected && S.tab === 'screen') { const s = S.students[S.selected]; if (s) renderMirror(s, statusOf(S.selected)); }
  }

  // ================================================================ tests editor
  function renderTestList() {
    const ids = Object.keys(S.tests).sort((a, b) => (S.tests[b].updatedAt || 0) - (S.tests[a].updatedAt || 0));
    $('#testList').innerHTML = ids.map(id => {
      const t = S.tests[id], n = EL.asArray(t.questions).length;
      return `<div class="tcard ${S.editing && S.editing.id === id ? 'on' : ''}" data-tid="${id}"><b>${esc(t.title || 'Untitled')}</b>
        <span>${n} question${n === 1 ? '' : 's'} · ${t.timeLimit ? t.timeLimit + ' min' : 'no time limit'}${t.paper ? ' · has file' : ''}</span></div>`;
    }).join('') || '<p class="muted small">No tests yet.</p>';
  }
  $('#testList').addEventListener('click', async e => {
    const c = e.target.closest('.tcard'); if (!c) return;
    if (S.dirty && !(await confirmBox('Discard unsaved changes?', '', 'Discard', true))) return;
    openEditor(JSON.parse(JSON.stringify(S.tests[c.dataset.tid])));
  });
  const newQ = type => ({ id: 'q' + EL.rid(6), type, text: '', points: 1, options: type === 'mc' ? ['', '', '', ''] : null, answer: type === 'tf' ? 'true' : type === 'mc' ? 0 : '' });
  $('#newTest').addEventListener('click', async () => {
    if (S.dirty && !(await confirmBox('Discard unsaved changes?', '', 'Discard', true))) return;
    openEditor({ id: 't' + EL.rid(8), title: '', timeLimit: 0, shuffle: false, questions: [newQ('mc')] });
    S.dirty = true;
  });
  function openEditor(t) {
    t.questions = EL.asArray(t.questions).map(q => Object.assign(q, { options: q.type === 'mc' ? EL.asArray(q.options) : null }));
    if (t.paper) t.paper.pages = EL.asArray(t.paper.pages);
    S.editing = t; S.dirty = false;
    go('tests');
    $('#edEmpty').classList.add('hidden'); $('#edMain').classList.remove('hidden');
    $('#edTitle').value = t.title || ''; $('#edTime').value = t.timeLimit || 0; $('#edShuffle').checked = !!t.shuffle;
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
  function renderEditor() {
    const t = S.editing;
    renderPaper();
    $('#edShuffle').disabled = hasSheet(t);
    if (hasSheet(t)) $('#edShuffle').checked = t.shuffle = false;
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
      } else {
        body = `<input class="input sm" data-i="${i}" data-f="answer" value="${esc(q.answer || '')}" placeholder="Accepted answers, separated by |   e.g.  mitochondria | mitochondrion">
          <span class="eq-hint">Capital letters don't matter. Leave empty to mark it yourself.</span>`;
      }
      return `<div class="eq ${q.needKey ? 'need' : ''}" data-i="${i}">
        <div class="eq-head"><span class="eq-num">${i + 1}</span>
          <select class="input" data-i="${i}" data-f="type"><option value="mc" ${q.type === 'mc' ? 'selected' : ''}>Multiple choice</option><option value="tf" ${q.type === 'tf' ? 'selected' : ''}>True / False</option><option value="short" ${q.type === 'short' ? 'selected' : ''}>Short answer</option></select>
          <input class="input pts" type="number" min="1" max="100" data-i="${i}" data-f="points" value="${q.points || 1}" title="Points"><span class="eq-hint">points</span>
          <div class="eq-tools">
            <button class="ibtn" data-qa="up" data-i="${i}" title="Move up">↑</button><button class="ibtn" data-qa="down" data-i="${i}" title="Move down">↓</button>
            <button class="ibtn" data-qa="dup" data-i="${i}" title="Duplicate">⧉</button><button class="ibtn del" data-qa="del" data-i="${i}" title="Delete">✕</button></div></div>
        <textarea class="input" rows="2" data-i="${i}" data-f="text" placeholder="Question">${esc(q.text)}</textarea>
        <div class="eq-img">${q.image ? `<img src="${q.image}" alt=""><button class="btn sm danger" data-qa="delimg" data-i="${i}">Remove picture</button>` : `<label class="btn sm">Add picture<input type="file" accept="image/*" hidden data-i="${i}" data-f="image"></label>`}</div>
        ${body}</div>`;
    }).join('');
    infoLine();
  }
  function infoLine() {
    const t = S.editing; const pts = t.questions.reduce((a, q) => a + (Number(q.points) || 1), 0);
    const need = t.questions.filter(q => q.needKey).length;
    $('#edInfo').innerHTML = `${t.questions.length} questions · ${pts} points${need ? ` · <b style="color:var(--amber)">${need} still need a correct answer</b>` : ''}${S.dirty ? ' · not saved' : ''}`;
  }
  function markDirty() { S.dirty = true; infoLine(); }
  $('#edTitle').addEventListener('input', () => { S.editing.title = $('#edTitle').value; markDirty(); });
  $('#edTime').addEventListener('input', () => { S.editing.timeLimit = Math.max(0, Number($('#edTime').value) || 0); markDirty(); });
  $('#edShuffle').addEventListener('change', () => { S.editing.shuffle = $('#edShuffle').checked; markDirty(); });
  $('#edQs').addEventListener('input', e => {
    const el = e.target, i = Number(el.dataset.i), f = el.dataset.f; if (isNaN(i) || !f) return;
    const q = S.editing.questions[i];
    if (f === 'text') q.text = el.value;
    else if (f === 'opt') q.options[Number(el.dataset.k)] = el.value;
    else if (f === 'points') q.points = Math.max(1, Number(el.value) || 1);
    else if (f === 'answer' && q.type === 'short') q.answer = el.value;
    markDirty();
  });
  $('#edQs').addEventListener('change', e => {
    const el = e.target, i = Number(el.dataset.i), f = el.dataset.f; if (isNaN(i) || !f) return;
    const q = S.editing.questions[i];
    if (f === 'answer' && q.type === 'mc') { q.answer = Number(el.value); delete q.needKey; renderEditor(); }
    else if (f === 'answer' && q.type === 'tf') { q.answer = el.value; delete q.needKey; if (q.sheet) renderEditor(); }
    else if (f === 'type') { const n = newQ(el.value); n.id = q.id; n.text = q.text; n.points = q.points; if (q.image) n.image = q.image; S.editing.questions[i] = n; renderEditor(); }
    else if (f === 'image' && el.files[0]) { EL.loadImage(el.files[0], 900).then(url => { q.image = url; markDirty(); renderEditor(); }); return; }
    markDirty();
  });
  $('#edQs').addEventListener('click', e => {
    const b = e.target.closest('[data-qa]'); if (!b) return;
    const qs = S.editing.questions, i = Number(b.dataset.i), a = b.dataset.qa;
    if (a === 'up' && i > 0) [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]];
    if (a === 'down' && i < qs.length - 1) [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]];
    if (a === 'dup') { const c = JSON.parse(JSON.stringify(qs[i])); c.id = 'q' + EL.rid(6); qs.splice(i + 1, 0, c); }
    if (a === 'del') qs.splice(i, 1);
    if (a === 'addopt') qs[i].options.push('');
    if (a === 'delopt') { const k = Number(b.dataset.k); qs[i].options.splice(k, 1); if (qs[i].answer === k) qs[i].answer = 0; else if (qs[i].answer > k) qs[i].answer--; }
    if (a === 'delimg') delete qs[i].image;
    markDirty(); renderEditor();
  });
  $$('[data-add]').forEach(b => b.addEventListener('click', () => {
    S.editing.questions.push(newQ(b.dataset.add)); markDirty(); renderEditor();
    setTimeout(() => { const all = $$('#edQs .eq'); const last = all[all.length - 1]; if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); const ta = last.querySelector('textarea'); if (ta) ta.focus(); } }, 50);
  }));

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
  $('#uploadInput').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    if (S.dirty && S.editing && !(await confirmBox('Discard unsaved changes?', 'Uploading makes a new test from the file.', 'Continue', true))) return;
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
  });

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
    }
    return null;
  }
  async function saveTest() {
    const t = S.editing;
    t.title = $('#edTitle').value.trim(); t.updatedAt = B.now();
    t.questions.forEach(q => { if (q.type === 'mc' && !q.sheet) q.options = q.options.map(o => o.trim()); });
    await B.set(`teachers/${S.uid}/tests/${t.id}`, JSON.parse(JSON.stringify(t)));
    S.dirty = false; renderEditor(); renderTestList();
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

  async function deploy(t) {
    let code = null;
    for (let i = 0; i < 6; i++) { const c = EL.makeCode(); if (!(await B.get(`sessions/${c}/meta`))) { code = c; break; } }
    if (!code) return EL.toast('Could not make a code. Try again.', 'red');
    const now = B.now();
    busy('Starting the test…');
    try {
      await B.set(`sessions/${code}/meta`, { title: t.title.trim(), status: 'waiting', createdAt: now, timeLimit: Number(t.timeLimit) || 0, shuffle: !!t.shuffle, release: false, owner: S.uid, testId: t.id });
      const questions = t.questions.map(q => {
        const o = { id: q.id, type: q.type, text: q.text || '', points: Number(q.points) || 1 };
        if (q.type === 'mc') o.options = q.options; if (q.image) o.image = q.image; if (q.sheet) { o.sheet = true; o.n = q.n; }
        return o;
      });
      // the test paper travels as the first item of the questions list (students can read that list)
      if (t.paper) questions.unshift({ id: 'paper', type: 'paper', name: t.paper.name || '', pages: EL.asArray(t.paper.pages), text: t.paper.text || '' });
      const key = {};
      t.questions.forEach(q => { key[q.id] = q.type === 'short' ? String(q.answer || '').split('|').map(x => x.trim()).filter(Boolean) : q.answer; });
      await B.update(`sessions/${code}`, { questions, key });
      await B.set(`teachers/${S.uid}/history/${code}`, { title: t.title.trim(), createdAt: now, n: t.questions.length });
    } finally { busy(''); }
    play('granted');
    await openSession(code);
    openProjector();
  }

  // ================================================================ past results + mark sheet
  function renderArchive() {
    const ids = Object.keys(S.history).sort((a, b) => S.history[b].createdAt - S.history[a].createdAt);
    $('#archiveList').innerHTML = ids.map(c => {
      const h = S.history[c], done = !!h.endedAt;
      return `<div class="arow" data-arc="${done ? 'sheet' : 'open'}" data-c="${c}"><span class="code">${c}</span>
        <div class="grow"><b>${esc(h.title)}</b><div class="small muted">${new Date(h.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${h.n} questions${done ? ` · ${h.students || 0} students · average ${h.avg || 0}%` : ' · <span style="color:var(--green)">still open</span>'}</div></div>
        <button class="btn sm ${done ? 'primary' : ''}" data-arc="${done ? 'sheet' : 'open'}" data-c="${c}">${done ? 'Mark sheet' : 'Open live'}</button>
        <button class="btn sm iconbtn ghost" data-arc="del" data-c="${c}" title="Delete">${icon('trash')}</button></div>`;
    }).join('') || '<p class="muted">No tests given yet.</p>';
  }
  $('#archiveList').addEventListener('click', async e => {
    const b = e.target.closest('[data-arc]'); if (!b) return;
    e.stopPropagation();
    const c = b.dataset.c;
    if (b.dataset.arc === 'open') openSession(c);
    if (b.dataset.arc === 'sheet') openMarksheet(c);
    if (b.dataset.arc === 'del' && await confirmBox('Delete results for ' + c + '?', 'All answers and activity for this test are erased for good.', 'Delete', true)) {
      await B.remove(`sessions/${c}`); await B.remove(`teachers/${S.uid}/history/${c}`);
      if (S.code === c) { sessionSubs.forEach(u => u()); sessionSubs = []; S.code = null; showLiveEmpty(); }
    }
  });

  // one row per student, one small mark per question
  let MS = null;
  async function openMarksheet(code) {
    go('archive');
    $('#arcListWrap').classList.add('hidden'); $('#arcDetail').classList.remove('hidden');
    $('#arcDetail').innerHTML = '<div class="spinner" style="margin:40px auto"></div>';
    const d = (await B.get(`sessions/${code}`)) || {};
    const split = EL.splitPaper(d.questions);
    MS = { code, meta: d.meta || {}, questions: split.questions, key: d.key || {}, students: d.students || {}, control: d.control || {}, overrides: d.overrides || {} };
    renderMarksheet();
  }
  function renderMarksheet() {
    const m = MS, qs = m.questions;
    const ids = Object.keys(m.students).filter(id => !(m.control[id] || {}).kicked)
      .sort((a, b) => (m.students[a].name || '').localeCompare(m.students[b].name || ''));
    const rows = ids.map(id => ({ id, s: m.students[id], g: EL.grade(qs, m.key, m.students[id].answers, m.overrides[id]) }));
    const qRight = qs.map(q => rows.filter(r => r.g.marks[q.id]).length);
    const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.g.pct, 0) / rows.length) : 0;
    const shortAns = (q, a) => a == null || a === '' ? '-' : q.type === 'mc' ? EL.LETTERS[a] : q.type === 'tf' ? (a === 'true' ? 'True' : 'False') : String(a);
    $('#arcDetail').innerHTML = `
      <div class="ms-head">
        <button class="btn sm ghost" id="msBack">← Past results</button>
        <div class="ms-title"><span class="label">Mark sheet · ${esc(m.code)}</span><h2>${esc(m.meta.title || 'Test')}</h2>
          <div class="small muted">${m.meta.createdAt ? new Date(m.meta.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''} · ${rows.length} students · ${qs.length} questions · class average <b>${avg}%</b></div></div>
        <button class="btn sm" id="msCsv">${icon('download')}Download</button>
      </div>
      <div class="ms-wrap"><table class="ms">
        <thead><tr><th class="ms-name">Student</th><th class="ms-num">Score</th><th class="ms-num">Left</th>
          ${qs.map((q, i) => `<th class="ms-q" title="${esc(q.sheet ? 'Number ' + q.n : q.text)}">${q.sheet ? q.n : i + 1}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr><td class="ms-name">${esc(r.s.name)}${r.s.status !== 'submitted' ? ' <span class="small muted">(not submitted)</span>' : ''}</td>
          <td class="ms-num"><b>${r.g.score}/${r.g.total}</b> <span class="muted">${r.g.pct}%</span></td>
          <td class="ms-num ${r.s.leaves ? 'bad' : ''}">${r.s.leaves || 0}</td>
          ${qs.map(q => {
            const a = (r.s.answers || {})[q.id], ok = r.g.marks[q.id], blank = a == null || a === '';
            const can = q.type === 'short' && !blank;
            return `<td class="ms-c ${ok ? 'ok' : blank ? 'blank' : 'bad'} ${can ? 'can' : ''}" title="Answer: ${esc(shortAns(q, a))}${can ? ' (click to change the mark)' : ''}" ${can ? `data-sid="${r.id}" data-q="${q.id}"` : ''}>${ok ? '✓' : blank ? '·' : '✗'}</td>`;
          }).join('')}</tr>`).join('')}
        </tbody>
        <tfoot><tr><td class="ms-name muted">Got it right</td><td></td><td></td>${qRight.map(n => `<td class="ms-c pct">${rows.length ? Math.round(n / rows.length * 100) : 0}%</td>`).join('')}</tr></tfoot>
      </table></div>
      <p class="small muted ms-key">✓ correct · ✗ wrong · <b>·</b> no answer. Hover a mark to see what they answered. Short answers: click a mark to switch it between right and wrong.</p>`;
  }
  $('#arcDetail').addEventListener('click', async e => {
    if (e.target.closest('#msBack')) { $('#arcDetail').classList.add('hidden'); $('#arcListWrap').classList.remove('hidden'); return; }
    if (e.target.closest('#msCsv')) return marksheetCSV();
    const c = e.target.closest('.ms-c.can'); if (!c) return;
    const sid = c.dataset.sid, q = c.dataset.q;
    const now = EL.grade(MS.questions, MS.key, MS.students[sid].answers, MS.overrides[sid]).marks[q];
    MS.overrides[sid] = Object.assign({}, MS.overrides[sid], { [q]: !now });
    await B.update(`sessions/${MS.code}/overrides/${sid}`, { [q]: !now });
    renderMarksheet();
  });
  function marksheetCSV() {
    const m = MS, qs = m.questions;
    const head = ['Name', 'Score', 'Total', 'Percent', 'Times left'].concat(qs.map((q, i) => 'Q' + (q.sheet ? q.n : i + 1)));
    const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = Object.keys(m.students).filter(id => !(m.control[id] || {}).kicked).map(id => {
      const s = m.students[id], g = EL.grade(qs, m.key, s.answers, m.overrides[id]);
      return [s.name, g.score, g.total, g.pct, s.leaves || 0].concat(qs.map(q => g.marks[q.id] ? 1 : 0));
    }).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
    const csv = '﻿' + [head].concat(rows).map(r => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${(m.meta.title || 'test').replace(/[^\w\- ]+/g, '').trim() || 'test'}_${m.code}_marks.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

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
      <h3>Firebase security rules</h3>
      <div class="copyrow"><span class="small muted">Already set up. Kept here in case you ever need to paste them again.</span><button class="btn sm" data-copy="rulesPre">Copy</button></div>
      <pre id="rulesPre">${esc(RULES)}</pre>`;
  }
  $('#setupBody').addEventListener('click', e => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const t = document.getElementById(b.dataset.copy).textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => EL.toast('Copied', 'green', 1500)).catch(() => EL.toast('Select the text and copy it yourself', 'amber'));
  });

  window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
  initAuth();
})();
