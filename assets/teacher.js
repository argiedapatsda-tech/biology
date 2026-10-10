(function () {
  const B = Backend, { $, $$, esc, sfx } = EL;
  const S = {
    uid: null, code: null, meta: null, students: {}, control: {}, events: {}, key: {}, questions: [], overrides: {},
    selected: null, drTab: 'screen', tests: {}, history: {}, editing: null, dirty: false, sound: true
  };
  let sessionSubs = [], authHero = null, projHero = null, renderQueued = false;
  const seenEvents = new Set(); let eventsPrimed = false;
  const resultCache = {};
  const studentURL = c => new URL('student.html' + (c ? '?c=' + c : ''), location.href).href;
  const STATUS_TXT = { active: 'Working', waiting: 'Waiting', away: 'Left the test', locked: 'Locked', submitted: 'Submitted', offline: 'Offline', kicked: 'Removed' };
  const initials = n => String(n || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  // ================================================================ helpers
  function confirmBox(title, body, yes, danger) {
    return new Promise(res => {
      $('#tcTitle').textContent = title; $('#tcBody').textContent = body || '';
      $('#tcYes').textContent = yes || 'Confirm';
      $('#tcYes').className = 'btn ' + (danger ? 'red solid' : 'primary');
      $('#tConfirm').classList.remove('hidden');
      const done = v => { $('#tConfirm').classList.add('hidden'); $('#tcYes').onclick = $('#tcNo').onclick = null; res(v); };
      $('#tcYes').onclick = () => done(true); $('#tcNo').onclick = () => done(false);
    });
  }
  const play = n => { if (S.sound) sfx[n](); };
  const P = p => `sessions/${S.code}/${p}`;

  // ================================================================ sign in
  async function initAuth() {
    authHero = FX.lock($('#authHero'), (w, h) => w / h < 1.1 ? { x: 0, y: 0.27, size: 0.3 } : { x: 0.24, y: 0, size: 0.62 });
    authHero.setOpen(true);
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
    if (c.includes('operation-not-allowed')) return 'Email sign-in is not switched on in Firebase yet (Setup, step 3).';
    return (e && e.message) || String(e);
  };
  async function signedIn() { authHero.snap(); authHero.setState('ok'); play('clunk'); await new Promise(r => setTimeout(r, 650)); enterApp(); }
  $('#authForm').addEventListener('submit', async e => {
    e.preventDefault(); sfx.unlock();
    try { await B.signInEmail($('#aEmail').value.trim(), $('#aPass').value); signedIn(); }
    catch (ex) { $('#aErr').textContent = authMsg(ex); authHero.setState('lock'); setTimeout(() => authHero.setState('idle'), 1200); }
  });
  $('#aCreate').addEventListener('click', async () => {
    sfx.unlock();
    try { await B.createEmail($('#aEmail').value.trim(), $('#aPass').value); signedIn(); }
    catch (ex) { $('#aErr').textContent = authMsg(ex); }
  });
  $('#demoBtn').addEventListener('click', async () => { sfx.unlock(); await B.signInEmail(); signedIn(); });
  $('#logoutBtn').addEventListener('click', async () => { await B.signOut(); location.reload(); });

  function enterApp() {
    S.uid = B.uid();
    $('#auth').classList.add('hidden'); if (authHero) authHero.pause();
    $('#app').classList.remove('hidden');
    $('#modePill').textContent = B.mode === 'demo' ? 'Demo · this browser only' : 'Online';
    $('#modePill').className = 'modepill ' + (B.mode === 'demo' ? 'demo' : 'online');
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
    if (v !== 'live') closeDrawer();
  }
  $('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.v); });
  $('#goTests').addEventListener('click', () => go('tests'));
  $('#soundBtn').addEventListener('click', () => { S.sound = !S.sound; $('#soundBtn').textContent = S.sound ? 'Sound on' : 'Sound off'; sfx.unlock(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); closeProjector(); } });

  // ================================================================ live session
  function showLiveEmpty() { $('#liveEmpty').classList.remove('hidden'); $('#liveMain').classList.add('hidden'); }

  async function openSession(code) {
    sessionSubs.forEach(u => u()); sessionSubs = [];
    seenEvents.clear(); eventsPrimed = false;
    Object.assign(S, { code, meta: null, students: {}, control: {}, events: {}, key: {}, questions: [], overrides: {}, selected: null });
    closeDrawer();
    const meta = await B.get(`sessions/${code}/meta`);
    if (!meta) { try { localStorage.removeItem('examlock-active-' + S.uid); } catch (e) {} S.code = null; return showLiveEmpty(); }
    try { localStorage.setItem('examlock-active-' + S.uid, code); } catch (e) {}
    S.questions = EL.asArray(await B.get(P('questions')));
    S.key = (await B.get(P('key'))) || {};
    $('#liveEmpty').classList.add('hidden'); $('#liveMain').classList.remove('hidden');
    $('#mCode').textContent = code;
    sessionSubs.push(B.on(P('meta'), m => { if (!m) return; S.meta = m; renderBar(); queue(); }));
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
    if (s.away) return 'away';
    if ((s.lockSeq || 0) > (c.unlockSeq || 0) || c.forceLock) return 'locked';
    if (s.online === false) return 'offline';
    return s.status === 'testing' ? 'active' : 'waiting';
  }
  const gradeOf = sid => EL.grade(S.questions, S.key, (S.students[sid] || {}).answers, S.overrides[sid]);

  function queue() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderAll(); }); }
  function renderAll() {
    renderStats(); renderRoster();
    if (S.selected) renderDrawer();
    syncResults();
    renderBar();
  }

  // ---------------- header + actions
  function renderBar() {
    const m = S.meta; if (!m) return;
    $('#mTitle').textContent = m.title || 'Test';
    const st = m.status;
    $('#mStatus').className = 'chip ' + (st === 'live' ? 'st-live' : st === 'ended' ? 'st-ended' : 'waiting');
    $('#mStatus').textContent = st === 'live' ? 'Test in progress' : st === 'ended' ? 'Test ended' : 'Waiting for students';
    const sig = st + '|' + !!m.release;
    if ($('#mActions').dataset.sig === sig) return;
    $('#mActions').dataset.sig = sig;
    const btn = (act, label, cls) => `<button class="btn sm ${cls || ''}" data-mact="${act}">${label}</button>`;
    let h = '';
    if (st === 'waiting') h += btn('start', 'Start the test', 'green');
    if (st === 'live') h += btn('end', 'End test', 'red') + btn('time', '+5 minutes') + btn('lockall', 'Pause everyone', 'amber') + btn('unlockall', 'Unlock everyone');
    h += btn('release', m.release ? 'Scores visible to students ✓' : 'Show scores to students', m.release ? 'green' : '');
    h += btn('csv', 'Download results') + btn('projector', 'Join screen');
    if (st === 'ended') h += btn('close', 'Close');
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

  function unlock(sid) {
    const s = S.students[sid]; if (!s) return;
    B.update(P('control/' + sid), { unlockSeq: s.lockSeq || 0, forceLock: false });
    B.push(P('events'), { sid, name: s.name, type: 'unlock', at: B.now() });
    play('ok');
  }
  function unlockAll() {
    const u = {};
    Object.keys(S.students).forEach(id => { u[id + '/unlockSeq'] = S.students[id].lockSeq || 0; u[id + '/forceLock'] = false; });
    if (Object.keys(u).length) B.update(P('control'), u);
    B.push(P('events'), { sid: '*', name: 'Everyone', type: 'unlock', at: B.now() });
    play('ok');
  }

  // ---------------- stats
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
    $('#stats').innerHTML =
      `<div class="stat"><b>${c.total}</b><span>Joined</span></div>
       <div class="stat green"><b>${c.active}</b><span>Working</span></div>
       <div class="stat red ${c.alert ? 'hot' : ''}"><b>${c.alert}</b><span>Left / locked</span></div>
       <div class="stat amber"><b>${c.submitted}</b><span>Submitted</span></div>
       <div class="stat"><b>${n ? Math.round(sum / n) + '%' : '–'}</b><span>Average score</span></div>`;
    $('#projCount').textContent = c.total + (c.total === 1 ? ' student joined' : ' students joined');
  }

  // ---------------- class grid
  const ORDER = { away: 0, locked: 1, active: 2, waiting: 3, offline: 4, submitted: 5, kicked: 6 };
  function renderRoster() {
    const q = ($('#search').value || '').toLowerCase();
    const ids = Object.keys(S.students).filter(id => (S.students[id].name || '').toLowerCase().includes(q));
    ids.sort((a, b) => (ORDER[statusOf(a)] - ORDER[statusOf(b)]) || (S.students[a].name || '').localeCompare(S.students[b].name || ''));
    if (!ids.length) {
      $('#roster').innerHTML = `<div class="empty-roster">${Object.keys(S.students).length ? 'No student with that name.' : 'No students yet.<br>They open the student page and type the code<br><b>' + S.code + '</b>'}</div>`;
      return;
    }
    const total = S.questions.length || 1;
    $('#roster').innerHTML = ids.map(id => {
      const s = S.students[id], st = statusOf(id);
      const alert = st === 'away' || st === 'locked';
      const g = (s.status === 'testing' || s.status === 'submitted') ? gradeOf(id) : null;
      return `<div class="tile ${alert ? 'alert' : ''} ${st === 'offline' || st === 'kicked' ? 'dim' : ''} ${id === S.selected ? 'sel' : ''}" data-sid="${id}">
        <div class="t-top"><div class="t-av">${esc(initials(s.name))}</div><span class="t-name">${esc(s.name)}</span><span class="chip ${st}">${STATUS_TXT[st]}</span></div>
        <div class="t-bar"><i style="transform:scaleX(${(s.answered || 0) / total})"></i></div>
        <div class="t-meta">
          <span><b>${s.answered || 0}</b>/${S.questions.length} done</span>
          <span class="${s.leaves ? 'bad' : ''}">left <b>${s.leaves || 0}×</b></span>
          ${g ? `<span>score <b>${g.score}/${g.total}</b></span>` : ''}
          ${alert ? `<button class="btn sm green t-unlock" data-act="unlock" data-sid="${id}">Unlock</button>` : ''}
        </div></div>`;
    }).join('');
  }
  $('#search').addEventListener('input', renderRoster);
  $('#roster').addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (a) { e.stopPropagation(); if (a.dataset.act === 'unlock') unlock(a.dataset.sid); return; }
    const c = e.target.closest('.tile'); if (c) openDrawer(c.dataset.sid);
  });

  // ---------------- activity + alerts
  const EV_TXT = e => ({
    join: 'joined', rejoin: 'reconnected', reload: 'reloaded the page (locked)',
    left: 'left the test' + (e.reason ? ' · ' + e.reason.toLowerCase() : ''), back: 'came back after ' + EL.fmtDur(e.ms),
    submit: e.auto ? 'was auto-submitted' : 'submitted', unlock: 'unlocked by you', lock: 'paused by you', kick: 'removed by you'
  }[e.type] || e.type);
  function onEvents(ev) {
    S.events = ev;
    const list = Object.keys(ev).map(k => Object.assign({ k }, ev[k])).sort((a, b) => a.at - b.at);
    for (const e of list) {
      if (seenEvents.has(e.k)) continue;
      seenEvents.add(e.k);
      if (!eventsPrimed) continue;
      if (e.type === 'left' || e.type === 'reload') {
        play('alarm');
        EL.toast(`<b>${esc(e.name)} left the test</b><br><span class="muted">${e.type === 'reload' ? 'They reloaded the page.' : 'Their screen is now locked.'}</span>`, 'red', 6500);
      } else if (e.type === 'join') { play('join'); EL.toast(`<b>${esc(e.name)}</b> joined`, '', 2500); }
      else if (e.type === 'submit') { play('ok'); EL.toast(`<b>${esc(e.name)}</b> ${e.auto ? 'was auto-submitted' : 'submitted'}`, 'amber', 3000); }
    }
    eventsPrimed = true;
    $('#feed').innerHTML = list.slice(-60).reverse().map(e =>
      `<div class="feed-item ${e.type}"><time>${EL.clock(e.at).slice(0, 5)}</time><span><b>${esc(e.name)}</b> ${esc(EV_TXT(e))}</span></div>`).join('')
      || '<div class="muted small">Nothing yet.</div>';
    if (S.selected && S.drTab === 'log') renderDrawer();
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

  // ================================================================ student sheet + live screen
  function openDrawer(sid) {
    if (!S.students[sid]) return;
    S.selected = sid;
    $('#drawer').classList.remove('hidden');
    lastMirrorSig = ''; lastScrollY = -1;
    renderDrawer(); renderRoster();
  }
  function closeDrawer() { S.selected = null; $('#drawer').classList.add('hidden'); if (S.code) renderRoster(); }
  $('#drClose').addEventListener('click', closeDrawer);
  $('#drTabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.drTab = b.dataset.t;
    $$('#drTabs button').forEach(x => x.classList.toggle('on', x === b));
    ['screen', 'answers', 'log'].forEach(t => $('#dt-' + t).classList.toggle('hidden', t !== S.drTab));
    lastMirrorSig = ''; lastScrollY = -1; renderDrawer();
  });

  function renderDrawer() {
    const sid = S.selected, s = S.students[sid]; if (!s) return closeDrawer();
    const st = statusOf(sid), c = S.control[sid] || {};
    $('#drStatus').className = 'chip ' + st;
    $('#drStatus').textContent = STATUS_TXT[st];
    $('#drAvatar').textContent = initials(s.name);
    $('#drName').textContent = s.name;
    $('#drMeta').textContent = `${s.device || ''} · joined ${s.joinedAt ? EL.clock(s.joinedAt).slice(0, 5) : '–'} · left ${s.leaves || 0}× · away ${EL.fmtDur(s.awayMs)}`;
    const sig = st + '|' + !!c.forceLock + '|' + !!c.kicked;
    if ($('#drActions').dataset.sig !== sig) {
      $('#drActions').dataset.sig = sig;
      let h = '';
      if (st === 'away' || st === 'locked') h += `<button class="btn sm green" data-dact="unlock">Unlock</button>`;
      if (st !== 'submitted' && st !== 'kicked') h += c.forceLock ? `<button class="btn sm" data-dact="unfreeze">Resume</button>` : `<button class="btn sm amber" data-dact="freeze">Pause screen</button>`;
      if (st !== 'kicked') h += `<button class="btn sm red" data-dact="kick">Remove</button>`;
      $('#drActions').innerHTML = h;
    }
    if (S.drTab === 'screen') renderMirror(s, st);
    if (S.drTab === 'answers') renderAnswers(sid);
    if (S.drTab === 'log') renderLog(sid);
  }
  $('#drActions').addEventListener('click', async e => {
    const b = e.target.closest('[data-dact]'); if (!b) return;
    const sid = S.selected, s = S.students[sid], a = b.dataset.dact;
    if (a === 'unlock') unlock(sid);
    if (a === 'freeze') { B.update(P('control/' + sid), { forceLock: true }); B.push(P('events'), { sid, name: s.name, type: 'lock', at: B.now() }); }
    if (a === 'unfreeze') B.update(P('control/' + sid), { forceLock: false, unlockSeq: s.lockSeq || 0 });
    if (a === 'kick' && await confirmBox('Remove ' + s.name + '?', 'Their screen will say they were removed. Their answers stay saved.', 'Remove', true)) {
      B.update(P('control/' + sid), { kicked: true }); B.push(P('events'), { sid, name: s.name, type: 'kick', at: B.now() });
    }
  });

  let lastMirrorSig = '', lastScrollY = -1;
  function renderMirror(s, st) {
    const v = s.view || {};
    const vw = v.vw || 820, vh = v.vh || 1180;
    const avail = Math.max(240, $('#drawer').clientWidth - 40 - 20);
    const scale = Math.min(avail / vw, (window.innerHeight - 330) / vh);
    const mirror = $('#mirror'), scr = $('#mScreen');
    mirror.style.width = Math.round(vw * scale) + 20 + 'px';
    mirror.style.height = Math.round(vh * scale) + 20 + 'px';
    scr.style.width = vw + 'px'; scr.style.height = vh + 'px';
    scr.style.transform = `scale(${scale})`;
    scr.style.borderRadius = Math.round(16 / scale) + 'px';
    const sig = JSON.stringify([s.answers || {}, s.order || [], v.fq || null, vw]);
    if (sig !== lastMirrorSig) {
      lastMirrorSig = sig;
      $('#mmList').innerHTML = EL.renderTest(S.questions, s.order, s.answers || {}, { readonly: true });
      if (v.fq) { const f = $(`#mmList .qcard[data-qid="${v.fq}"]`); if (f) f.classList.add('focus'); }
      lastScrollY = -1;
    }
    $('#mmTitle').textContent = S.meta ? S.meta.title : '';
    $('#mmAgent').textContent = (s.name || '') + ' · code ' + S.code;
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
    const set = (cls, h) => { veil.className = 'm-veil on ' + cls; veil.innerHTML = h; };
    if (st === 'away') set('red', `<div><div class="eyebrow red">Right now</div><h4>Left the test</h4><p>${esc(s.name)} is outside the test page.</p></div>`);
    else if (st === 'locked') set('red', `<div><div class="eyebrow red">Locked</div><h4>Waiting for you</h4><p>Their screen shows the red lock. Press Unlock when ready.</p></div>`);
    else if (st === 'waiting') set('blue', `<div><div class="eyebrow accent">Waiting room</div><h4>Not started</h4><p>Their test shows here once you start it.</p></div>`);
    else if (st === 'offline') set('blue', `<div><div class="eyebrow">No signal</div><h4>Offline</h4><p>Their iPad may be asleep or disconnected.</p></div>`);
    else if (st === 'kicked') set('blue', `<div><h4>Removed</h4></div>`);
    else { veil.className = 'm-veil'; veil.innerHTML = ''; }
    const age = v.t ? Math.round((B.now() - v.t) / 1000) : null;
    $('#mirrorNote').textContent = st === 'submitted' ? 'Final answers' : `Live · ${age == null ? 'waiting for first movement' : 'last moved ' + (age < 2 ? 'just now' : age + 's ago')}`;
  }
  window.addEventListener('resize', () => { if (S.selected && S.drTab === 'screen') renderDrawer(); });

  function fmtAnswer(q, a) {
    if (a == null || a === '') return '<span class="muted">(no answer)</span>';
    if (q.type === 'mc') return `<b>${EL.LETTERS[a]}</b> · ${esc(EL.asArray(q.options)[a])}`;
    if (q.type === 'tf') return a === 'true' ? 'True' : 'False';
    return esc(a);
  }
  function fmtKey(q) {
    const k = S.key[q.id];
    if (q.type === 'mc') return k == null ? '–' : `<b>${EL.LETTERS[k]}</b> · ${esc(EL.asArray(q.options)[k])}`;
    if (q.type === 'tf') return k === 'true' ? 'True' : 'False';
    const arr = EL.asArray(k); return arr.length ? arr.map(esc).join(' <span class="muted">or</span> ') : '<span class="muted">you mark this one</span>';
  }
  function renderAnswers(sid) {
    const s = S.students[sid], g = gradeOf(sid), ov = S.overrides[sid] || {};
    const byId = {}; S.questions.forEach(q => { byId[q.id] = q; });
    const order = (s.order && s.order.length ? s.order : S.questions.map(q => q.id));
    $('#dt-answers').innerHTML = `<div class="ans-sum"><b>${g.score} / ${g.total}</b><span class="muted">${g.pct}% · marked automatically${Object.keys(ov).length ? ' + your changes' : ''}</span></div>` +
      order.map((id, i) => {
        const q = byId[id]; if (!q) return '';
        const a = (s.answers || {})[id], ok = g.marks[id];
        return `<div class="ans-row ${ok ? 'ok' : 'bad'}">
          <div class="ans-q"><b>${i + 1}</b>${esc(q.text)}</div>
          <div class="ans-line"><span>Answer</span><span>${fmtAnswer(q, a)}</span></div>
          <div class="ans-line"><span>Correct</span><span>${fmtKey(q)}</span></div>
          <div class="ans-mark"><span class="chip ${ok ? 'active' : 'away'}">${ok ? 'Correct' : 'Wrong'} · ${ok ? q.points || 1 : 0}/${q.points || 1}</span>
            ${q.type === 'short' ? `<button class="btn sm green" data-ov="1" data-q="${id}">Mark correct</button><button class="btn sm red" data-ov="0" data-q="${id}">Mark wrong</button>${ov[id] != null ? `<button class="btn sm" data-ov="auto" data-q="${id}">Undo</button>` : ''}` : ''}
          </div></div>`;
      }).join('');
  }
  $('#dt-answers').addEventListener('click', e => {
    const b = e.target.closest('[data-ov]'); if (!b) return;
    const v = b.dataset.ov;
    B.update(P('overrides/' + S.selected), { [b.dataset.q]: v === 'auto' ? null : v === '1' });
  });
  function renderLog(sid) {
    const list = Object.values(S.events || {}).filter(e => e.sid === sid || e.sid === '*').sort((a, b) => b.at - a.at);
    $('#dt-log').innerHTML = list.map(e => `<div class="log-item ${e.type}"><time>${EL.clock(e.at)}</time><span>${esc(EV_TXT(e))}</span></div>`).join('') || '<p class="muted">Nothing yet.</p>';
  }

  // ================================================================ results file
  function exportCSV() {
    const qs = S.questions;
    const head = ['Name', 'Status', 'Score', 'Total', 'Percent', 'Times left', 'Seconds away', 'Device', 'Joined', 'Submitted'].concat(qs.map((q, i) => 'Q' + (i + 1)));
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
    if (!projHero) { projHero = FX.lock($('#projHero'), (w, h) => w / h < 1.1 ? { x: 0, y: 0.3, size: 0.25 } : { x: 0.27, y: 0, size: 0.6 }); }
    else projHero.resume();
    projHero.setOpen(true); projHero.setState('idle');
    $('#projUrl').textContent = studentURL().replace(/^https?:\/\//, '');
    $('#projCode').textContent = S.code;
    $('#projQr').innerHTML = '';
    if (window.QRCode) new QRCode($('#projQr'), { text: studentURL(S.code), width: 150, height: 150, colorDark: '#05060a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    else $('#projQr').innerHTML = '<div style="color:#000;padding:20px">QR unavailable offline</div>';
  }
  function closeProjector() { $('#projector').classList.add('hidden'); if (projHero) projHero.pause(); }
  $('#projClose').addEventListener('click', closeProjector);

  // ================================================================ clock
  function tick() {
    const m = S.meta; if (!m || !S.code) return;
    const n = Object.keys(S.students).length;
    let sub = `${S.questions.length} questions · ${n} student${n === 1 ? '' : 's'}`;
    let timerTxt = '--:--';
    if (m.status === 'live' && m.startedAt) {
      const tl = Number(m.timeLimit) || 0;
      if (tl) { const left = m.startedAt + tl * 60000 + (Number(m.extraMs) || 0) - B.now(); sub += ` · ${EL.fmtTime(left)} left`; timerTxt = EL.fmtTime(left); }
      else { const el = B.now() - m.startedAt; sub += ` · running ${EL.fmtTime(el)}`; timerTxt = EL.fmtTime(el); }
    }
    $('#mSub').textContent = sub;
    $('#mmTimer').textContent = timerTxt;
    if (S.selected && S.drTab === 'screen') { const s = S.students[S.selected]; if (s) renderMirror(s, statusOf(S.selected)); }
  }

  // ================================================================ tests editor
  function renderTestList() {
    const ids = Object.keys(S.tests).sort((a, b) => (S.tests[b].updatedAt || 0) - (S.tests[a].updatedAt || 0));
    $('#testList').innerHTML = ids.map(id => {
      const t = S.tests[id], n = EL.asArray(t.questions).length;
      return `<div class="tcard ${S.editing && S.editing.id === id ? 'on' : ''}" data-tid="${id}"><b>${esc(t.title || 'Untitled')}</b>
        <span>${n} question${n === 1 ? '' : 's'} · ${t.timeLimit ? t.timeLimit + ' min' : 'no time limit'}</span></div>`;
    }).join('') || '<p class="muted small">No tests yet. Press + New test.</p>';
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
    S.editing = t; S.dirty = false;
    $('#edEmpty').classList.add('hidden'); $('#edMain').classList.remove('hidden');
    $('#edTitle').value = t.title || ''; $('#edTime').value = t.timeLimit || 0; $('#edShuffle').checked = !!t.shuffle;
    renderEditor(); renderTestList();
  }
  function renderEditor() {
    const t = S.editing;
    $('#edQs').innerHTML = t.questions.map((q, i) => {
      let body = '';
      if (q.type === 'mc') {
        body = q.options.map((o, k) => `<div class="eq-opt ${q.answer === k ? 'correct' : ''}">
          <input type="radio" name="c_${q.id}" data-i="${i}" data-f="answer" value="${k}" ${q.answer === k ? 'checked' : ''} title="Correct answer">
          <span class="letter">${EL.LETTERS[k]}</span><input class="input sm" data-i="${i}" data-f="opt" data-k="${k}" value="${esc(o)}" placeholder="Choice ${EL.LETTERS[k]}">
          ${q.options.length > 2 ? `<button class="ibtn del" data-qa="delopt" data-i="${i}" data-k="${k}" title="Remove choice">✕</button>` : ''}</div>`).join('') +
          `<div class="row-between"><span class="eq-hint">Tick the circle next to the correct answer</span>${q.options.length < 6 ? `<button class="btn sm" data-qa="addopt" data-i="${i}">+ Choice</button>` : ''}</div>`;
      } else if (q.type === 'tf') {
        body = `<div class="tf-pick">${['true', 'false'].map(v => `<label><input type="radio" name="c_${q.id}" data-i="${i}" data-f="answer" value="${v}" ${q.answer === v ? 'checked' : ''}>${v === 'true' ? 'True' : 'False'} is correct</label>`).join('')}</div>`;
      } else {
        body = `<input class="input sm" data-i="${i}" data-f="answer" value="${esc(q.answer || '')}" placeholder="Accepted answers, separated by |   e.g.  mitochondria | mitochondrion">
          <span class="eq-hint">Capital letters don't matter. Leave empty to mark it yourself.</span>`;
      }
      return `<div class="eq" data-i="${i}">
        <div class="eq-head"><span class="eq-num">${i + 1}</span>
          <select class="input" data-i="${i}" data-f="type"><option value="mc" ${q.type === 'mc' ? 'selected' : ''}>Multiple choice</option><option value="tf" ${q.type === 'tf' ? 'selected' : ''}>True / False</option><option value="short" ${q.type === 'short' ? 'selected' : ''}>Short answer</option></select>
          <input class="input pts" type="number" min="1" max="100" data-i="${i}" data-f="points" value="${q.points || 1}" title="Points"><span class="eq-hint">points</span>
          <div class="eq-tools">
            <button class="ibtn" data-qa="up" data-i="${i}" title="Move up">↑</button><button class="ibtn" data-qa="down" data-i="${i}" title="Move down">↓</button>
            <button class="ibtn" data-qa="dup" data-i="${i}" title="Duplicate">⧉</button><button class="ibtn del" data-qa="del" data-i="${i}" title="Delete">✕</button></div></div>
        <textarea class="input" rows="2" data-i="${i}" data-f="text" placeholder="Question">${esc(q.text)}</textarea>
        <div class="eq-img">${q.image ? `<img src="${q.image}" alt=""><button class="btn sm red" data-qa="delimg" data-i="${i}">Remove picture</button>` : `<label class="btn sm">Add picture<input type="file" accept="image/*" hidden data-i="${i}" data-f="image"></label>`}</div>
        ${body}</div>`;
    }).join('');
    infoLine();
  }
  function infoLine() { const t = S.editing; const pts = t.questions.reduce((a, q) => a + (Number(q.points) || 1), 0); $('#edInfo').textContent = `${t.questions.length} questions · ${pts} points${S.dirty ? ' · not saved' : ''}`; }
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
    if (f === 'answer' && q.type === 'mc') { q.answer = Number(el.value); renderEditor(); }
    else if (f === 'answer' && q.type === 'tf') q.answer = el.value;
    else if (f === 'type') { const n = newQ(el.value); n.id = q.id; n.text = q.text; n.points = q.points; if (q.image) n.image = q.image; S.editing.questions[i] = n; renderEditor(); }
    else if (f === 'image' && el.files[0]) { loadImage(el.files[0]).then(url => { q.image = url; markDirty(); renderEditor(); }); return; }
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
  function loadImage(file) {
    return new Promise((res, rej) => {
      const img = new Image(), r = new FileReader();
      r.onload = () => { img.src = r.result; };
      img.onload = () => {
        const max = 900, k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = rej; r.readAsDataURL(file);
    });
  }
  function validate(t) {
    if (!t.title.trim()) return 'Give the test a title.';
    if (!t.questions.length) return 'Add at least one question.';
    for (let i = 0; i < t.questions.length; i++) {
      const q = t.questions[i];
      if (!q.text.trim() && !q.image) return `Question ${i + 1} is empty.`;
      if (q.type === 'mc' && q.options.filter(o => o.trim()).length < 2) return `Question ${i + 1} needs at least 2 choices.`;
      if (q.type === 'mc' && !(q.options[q.answer] || '').trim()) return `Question ${i + 1}: the correct choice is empty.`;
    }
    return null;
  }
  async function saveTest() {
    const t = S.editing;
    t.title = $('#edTitle').value.trim(); t.updatedAt = B.now();
    t.questions.forEach(q => { if (q.type === 'mc') q.options = q.options.map(o => o.trim()); });
    await B.set(`teachers/${S.uid}/tests/${t.id}`, t);
    S.dirty = false; renderEditor(); renderTestList();
  }
  $('#edSave').addEventListener('click', async () => { if (!$('#edTitle').value.trim()) return EL.toast('Give the test a title first.', 'red'); await saveTest(); EL.toast('Saved', 'green', 2000); });
  $('#edDelete').addEventListener('click', async () => {
    if (!(await confirmBox('Delete this test?', 'Results in Past results are kept.', 'Delete', true))) return;
    await B.remove(`teachers/${S.uid}/tests/${S.editing.id}`);
    S.editing = null; S.dirty = false; $('#edMain').classList.add('hidden'); $('#edEmpty').classList.remove('hidden');
  });
  $('#edDeploy').addEventListener('click', async () => {
    S.editing.title = $('#edTitle').value;
    const err = validate(S.editing); if (err) return EL.toast(err, 'red');
    if (S.code && S.meta && S.meta.status === 'live' && !(await confirmBox('Another test is still running', 'Starting this one switches your screen away from it. It keeps running and you can reopen it from Past results.', 'Start anyway'))) return;
    await saveTest();
    await deploy(S.editing);
  });

  async function deploy(t) {
    let code = null;
    for (let i = 0; i < 6; i++) { const c = EL.makeCode(); if (!(await B.get(`sessions/${c}/meta`))) { code = c; break; } }
    if (!code) return EL.toast('Could not make a code. Try again.', 'red');
    const now = B.now();
    await B.set(`sessions/${code}/meta`, { title: t.title.trim(), status: 'waiting', createdAt: now, timeLimit: Number(t.timeLimit) || 0, shuffle: !!t.shuffle, release: false, owner: S.uid, testId: t.id });
    const questions = t.questions.map(q => { const o = { id: q.id, type: q.type, text: q.text, points: Number(q.points) || 1 }; if (q.type === 'mc') o.options = q.options; if (q.image) o.image = q.image; return o; });
    const key = {};
    t.questions.forEach(q => { key[q.id] = q.type === 'short' ? String(q.answer || '').split('|').map(x => x.trim()).filter(Boolean) : q.answer; });
    await B.update(`sessions/${code}`, { questions, key });
    await B.set(`teachers/${S.uid}/history/${code}`, { title: t.title.trim(), createdAt: now, n: questions.length });
    play('granted');
    await openSession(code);
    openProjector();
  }

  // ================================================================ past results
  function renderArchive() {
    const ids = Object.keys(S.history).sort((a, b) => S.history[b].createdAt - S.history[a].createdAt);
    $('#archiveList').innerHTML = ids.map(c => {
      const h = S.history[c];
      return `<div class="arow"><span class="code">${c}</span><div class="grow"><b>${esc(h.title)}</b><div class="small muted">${new Date(h.createdAt).toLocaleString()} · ${h.n} questions</div></div>
        <button class="btn sm" data-arc="open" data-c="${c}">Open</button><button class="btn sm red" data-arc="del" data-c="${c}">Delete</button></div>`;
    }).join('') || '<p class="muted">No tests given yet.</p>';
  }
  $('#archiveList').addEventListener('click', async e => {
    const b = e.target.closest('[data-arc]'); if (!b) return;
    const c = b.dataset.c;
    if (b.dataset.arc === 'open') openSession(c);
    if (b.dataset.arc === 'del' && await confirmBox('Delete results for ' + c + '?', 'All answers and activity for this test are erased for good.', 'Delete', true)) {
      await B.remove(`sessions/${c}`); await B.remove(`teachers/${S.uid}/history/${c}`);
      if (S.code === c) { sessionSubs.forEach(u => u()); sessionSubs = []; S.code = null; showLiveEmpty(); }
    }
  });

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
      <h2>${online ? 'Online ✓' : 'Demo mode'}</h2>
      <p class="muted">${online ? 'Students can join from any iPad with the link below.' : 'Right now everything stays inside this one browser. Connect the free Firebase database to use real iPads.'}</p>
      <div class="card"><div class="eyebrow">Student link</div><div class="copyrow" style="margin-top:8px"><code id="stuLink">${esc(studentURL())}</code><button class="btn sm" data-copy="stuLink">Copy</button><a class="btn sm" href="${esc(studentURL())}" target="_blank">Open</a></div></div>
      <h3>Lock the iPad for real</h3>
      <div class="card warn"><p style="margin-top:0">A website can't stop an iPad from going to the home screen. This website <b>notices</b> right away, alerts you and locks the test until you unlock it. To <b>block</b> leaving completely, add one of these:</p>
      <p><b>Guided Access (built into every iPad, free).</b> Settings → Accessibility → Guided Access → On. The student opens the test in Safari, triple-clicks the top button, and you type your passcode to start. They can't leave Safari until you end it.</p>
      <p style="margin-bottom:0"><b>Safe Exam Browser (free App Store app).</b> Full exam lockdown. It only exits with your password.</p></div>
      <h3>Connecting Firebase (one time)</h3>
      <ol><li><a href="https://console.firebase.google.com" target="_blank">console.firebase.google.com</a> → create a project.</li>
      <li>Build → Realtime Database → Create (Singapore) → Rules tab → paste the rules below → Publish.</li>
      <li>Build → Authentication → turn on <b>Anonymous</b> and <b>Email/Password</b>. Add the site's domain under Authorized domains.</li>
      <li>Project settings → Web app → copy the config into <code>assets/config.js</code>.</li></ol>
      <div class="copyrow"><span class="eyebrow">Security rules</span><button class="btn sm" data-copy="rulesPre">Copy</button></div>
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
