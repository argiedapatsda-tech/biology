// Backend adapter: same small API over Firebase Realtime Database (online)
// or a localStorage tree shared between tabs (demo mode).
(function () {
  function splitPath(p) { return String(p).split('/').filter(Boolean); }
  function clone(v) { return v === undefined ? null : JSON.parse(JSON.stringify(v)); }

  // ---------------- Firebase ----------------
  function FirebaseBackend(cfg) {
    firebase.initializeApp(cfg);
    const db = firebase.database();
    const auth = firebase.auth();
    let offset = 0;
    db.ref('.info/serverTimeOffset').on('value', s => { offset = s.val() || 0; });
    const authReady = new Promise(res => { const off = auth.onAuthStateChanged(u => { off(); res(u); }); });
    return {
      mode: 'online',
      now: () => Date.now() + offset,
      authReady,
      user: () => auth.currentUser,
      uid: () => auth.currentUser && auth.currentUser.uid,
      signInAnon: () => auth.signInAnonymously().then(c => c.user),
      signInEmail: (e, p) => auth.signInWithEmailAndPassword(e, p).then(c => c.user),
      createEmail: (e, p) => auth.createUserWithEmailAndPassword(e, p).then(c => c.user),
      signOut: () => auth.signOut(),
      get: p => db.ref(p).get().then(s => s.val()),
      set: (p, v) => db.ref(p).set(v),
      update: (p, o) => db.ref(p).update(o),
      remove: p => db.ref(p).remove(),
      push: (p, v) => { const r = db.ref(p).push(); r.set(v); return r.key; },
      on(p, cb) {
        const r = db.ref(p);
        const h = s => cb(s.val());
        r.on('value', h, err => console.error('[ExamLock] read denied', p, err));
        return () => r.off('value', h);
      },
      onDisconnectUpdate: (p, o) => db.ref(p).onDisconnect().update(o),
      onConnected(cb) { const r = db.ref('.info/connected'); r.on('value', s => cb(!!s.val())); }
    };
  }

  // ---------------- Demo (localStorage) ----------------
  function DemoBackend() {
    const KEY = 'examlock-demo-db';
    const listeners = [];
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
    function getAt(root, p) {
      let cur = root;
      for (const k of splitPath(p)) { if (cur == null || typeof cur !== 'object') return null; cur = cur[k]; }
      return cur === undefined ? null : cur;
    }
    function prune(o) {
      if (o && typeof o === 'object') {
        for (const k of Object.keys(o)) {
          if (o[k] === null || o[k] === undefined) delete o[k];
          else { prune(o[k]); if (typeof o[k] === 'object' && !Array.isArray(o[k]) && !Object.keys(o[k]).length) delete o[k]; }
        }
      }
      return o;
    }
    function setAt(root, p, v) {
      const parts = splitPath(p);
      if (!parts.length) return clone(v) || {};
      let cur = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      const last = parts[parts.length - 1];
      if (v === null || v === undefined) delete cur[last]; else cur[last] = clone(v);
      return root;
    }
    function notify(root) {
      for (const l of listeners) {
        const v = getAt(root, l.p);
        const s = JSON.stringify(v);
        if (s !== l.last) { l.last = s; try { l.cb(clone(v)); } catch (e) { console.error(e); } }
      }
    }
    function writeNow(fn) {
      let root = read();
      root = fn(root) || root;
      prune(root);
      try { localStorage.setItem(KEY, JSON.stringify(root)); }
      catch (e) { console.error('[ExamLock demo] storage full', e); }
      notify(root);
    }
    // several tabs write the same localStorage tree; a cross-tab lock keeps
    // read-modify-write atomic so one tab never overwrites another's change
    function write(fn) {
      if (navigator.locks && navigator.locks.request) return navigator.locks.request(KEY, () => writeNow(fn));
      writeNow(fn); return Promise.resolve();
    }
    window.addEventListener('storage', e => { if (e.key === KEY) notify(read()); });
    // each tab = its own identity (survives reload of that tab)
    let myUid = null;
    try { myUid = sessionStorage.getItem('examlock-demo-uid'); } catch (e) {}
    const disconnects = [];
    window.addEventListener('pagehide', () => {
      if (!disconnects.length) return;
      let root = read();
      for (const d of disconnects) for (const k of Object.keys(d.o)) root = setAt(root, d.p + '/' + k, d.o[k]);
      prune(root);
      try { localStorage.setItem(KEY, JSON.stringify(root)); } catch (e) {}
    });
    const fakeUser = () => myUid ? { uid: myUid, email: myUid.startsWith('T') ? 'teacher@demo' : null } : null;
    return {
      mode: 'demo',
      now: () => Date.now(),
      authReady: Promise.resolve(fakeUser()),
      user: fakeUser,
      uid: () => myUid,
      signInAnon() {
        if (!myUid || myUid.startsWith('T')) { myUid = 'S' + Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem('examlock-demo-uid', myUid); } catch (e) {} }
        return Promise.resolve(fakeUser());
      },
      signInEmail() { myUid = 'TDEMO'; try { sessionStorage.setItem('examlock-demo-uid', myUid); } catch (e) {} return Promise.resolve(fakeUser()); },
      createEmail() { return this.signInEmail(); },
      signOut() { myUid = null; try { sessionStorage.removeItem('examlock-demo-uid'); } catch (e) {} return Promise.resolve(); },
      get: p => Promise.resolve(clone(getAt(read(), p))),
      set: (p, v) => write(r => setAt(r, p, v)),
      update: (p, o) => write(r => { for (const k of Object.keys(o)) r = setAt(r, p + '/' + k, o[k]); return r; }),
      remove: p => write(r => setAt(r, p, null)),
      push(p, v) {
        const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        write(r => setAt(r, p + '/' + key, v));
        return key;
      },
      on(p, cb) {
        const l = { p, cb, last: undefined };
        listeners.push(l);
        setTimeout(() => notify(read()), 0);
        return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
      },
      onDisconnectUpdate(p, o) { disconnects.push({ p, o }); return Promise.resolve(); },
      onConnected(cb) { setTimeout(() => cb(true), 0); }
    };
  }

  window.Backend = window.FIREBASE_CONFIG && window.firebase
    ? FirebaseBackend(window.FIREBASE_CONFIG)
    : DemoBackend();
})();
