// Data layer. One small API used by every screen, backed either by
// Firebase (real use) or by an in-browser store (demo mode).
import { FIREBASE, DEMO_MODE } from './config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
let impl = null;

export const isDemo = DEMO_MODE;
export const newId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function initStore() {
  impl = DEMO_MODE ? await demoImpl() : await firebaseImpl();
  return impl;
}

// ---- public API (thin wrappers so screens never touch Firebase directly) ----
export const auth = {
  onChange: (cb) => impl.onAuth(cb),
  uid: () => impl.uid(),
  email: () => impl.email(),
  signIn: (e, p) => impl.signIn(e, p),
  signUp: (e, p) => impl.signUp(e, p),
  google: () => impl.google(),
  reset: (e) => impl.reset(e),
  signOut: () => impl.signOut(),
};
export const get = (path) => impl.get(path);
// Start-up reads: answer from the copy saved on this device when there is one, else ask the server.
export const getFast = (path) => (impl.getFast ? impl.getFast(path) : impl.get(path));
export const set = (path, data, merge = false) => impl.set(path, data, merge);
export const update = (path, data) => impl.update(path, data);
export const add = (path, data) => impl.add(path, data);
export const del = (path) => impl.del(path);
export const batch = (ops) => impl.batch(ops);
export const watchDoc = (path, cb) => impl.watchDoc(path, cb);
export const watchColl = (path, q, cb) => impl.watchColl(path, q || {}, cb);
export const getColl = (path, q) => impl.getColl(path, q || {});
export const upload = (path, file, onProgress) => impl.upload(path, file, onProgress);
export const demo = () => impl.demo || null;

// ───────────────────────── Firebase ─────────────────────────
async function firebaseImpl() {
  const [{ initializeApp }, A, F, S] = await Promise.all([
    import(FB + 'firebase-app.js'),
    import(FB + 'firebase-auth.js'),
    import(FB + 'firebase-firestore.js'),
    import(FB + 'firebase-storage.js'),
  ]);
  const app = initializeApp(FIREBASE);
  const a = A.getAuth(app);
  let db;
  try {
    db = F.initializeFirestore(app, {
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
    });
  } catch (e) { db = F.getFirestore(app); }
  const st = S.getStorage(app);

  const withId = (snap) => (snap.exists() ? { id: snap.id, ...snap.data() } : null);
  const buildQuery = (path, q) => {
    const parts = [F.collection(db, path)];
    (q.where || []).forEach(([f, op, v]) => parts.push(F.where(f, op, v)));
    if (q.orderBy) parts.push(F.orderBy(q.orderBy[0], q.orderBy[1] || 'asc'));
    if (q.limit) parts.push(F.limit(q.limit));
    return F.query(...parts);
  };

  return {
    onAuth: (cb) => A.onAuthStateChanged(a, (u) => cb(u ? { uid: u.uid, email: u.email } : null)),
    uid: () => a.currentUser?.uid || null,
    email: () => a.currentUser?.email || '',
    signIn: (e, p) => A.signInWithEmailAndPassword(a, e, p),
    signUp: (e, p) => A.createUserWithEmailAndPassword(a, e, p),
    google: () => A.signInWithPopup(a, new A.GoogleAuthProvider()),
    reset: (e) => A.sendPasswordResetEmail(a, e),
    signOut: () => A.signOut(a),
    get: async (path) => withId(await F.getDoc(F.doc(db, path))),
    getFast: async (path) => {
      try { const c = await F.getDocFromCache(F.doc(db, path)); if (c.exists()) return withId(c); } catch (e) { /* not saved yet */ }
      return withId(await F.getDoc(F.doc(db, path)));
    },
    set: (path, data, merge) => F.setDoc(F.doc(db, path), data, { merge }),
    update: (path, data) => F.updateDoc(F.doc(db, path), data),
    add: async (path, data) => (await F.addDoc(F.collection(db, path), data)).id,
    del: (path) => F.deleteDoc(F.doc(db, path)),
    batch: async (ops) => {
      const b = F.writeBatch(db);
      for (const o of ops) {
        const r = F.doc(db, o.path);
        if (o.op === 'set') b.set(r, o.data, { merge: !!o.merge });
        else if (o.op === 'update') b.update(r, o.data);
        else if (o.op === 'delete') b.delete(r);
      }
      await b.commit();
    },
    watchDoc: (path, cb) => F.onSnapshot(F.doc(db, path), (s) => cb(withId(s)), (e) => { console.warn(path, e); cb(null); }),
    watchColl: (path, q, cb) => F.onSnapshot(buildQuery(path, q),
      (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => { console.warn(path, e); cb([]); }),
    getColl: async (path, q) => (await F.getDocs(buildQuery(path, q))).docs.map((d) => ({ id: d.id, ...d.data() })),
    upload: (path, file, onProgress) => new Promise((resolve, reject) => {
      // Uploads the original file untouched (no shrinking).
      const task = S.uploadBytesResumable(S.ref(st, path), file, { contentType: file.type || undefined });
      task.on('state_changed',
        (s) => onProgress && onProgress(s.bytesTransferred / Math.max(1, s.totalBytes)),
        reject,
        async () => resolve(await S.getDownloadURL(task.snapshot.ref)));
    }),
  };
}

// ───────────────────────── Demo (in this browser only) ─────────────────────────
async function demoImpl() {
  const KEY = 'oc-demo-db-v2';
  let db = {};
  try { db = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { db = {}; }
  if (!Object.keys(db).length) {
    const { seed } = await import('./demo-seed.js');
    db = seed();
  }
  let uid = null;
  try { uid = localStorage.getItem('oc-demo-uid'); } catch (e) {}
  const authCbs = new Set();
  const watchers = new Set();

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} };
  const parent = (p) => p.split('/').slice(0, -1).join('/');
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const getPath = (o, k) => k.split('.').reduce((a, s) => (a == null ? a : a[s]), o);

  const match = (d, q) => (q.where || []).every(([f, op, v]) => {
    const x = getPath(d, f);
    if (op === '==') return x === v;
    if (op === '!=') return x !== v;
    if (op === 'array-contains') return Array.isArray(x) && x.includes(v);
    if (op === 'in') return v.includes(x);
    if (op === '>=') return x >= v;
    if (op === '<=') return x <= v;
    if (op === '>') return x > v;
    if (op === '<') return x < v;
    return true;
  });
  const collDocs = (path, q) => {
    const depth = path.split('/').length + 1;
    let rows = Object.keys(db)
      .filter((k) => k.startsWith(path + '/') && k.split('/').length === depth)
      .map((k) => ({ id: k.split('/').pop(), ...clone(db[k]) }))
      .filter((d) => match(d, q));
    if (q.orderBy) {
      const [f, dir] = q.orderBy;
      rows.sort((a, b) => ((getPath(a, f) ?? 0) > (getPath(b, f) ?? 0) ? 1 : -1) * (dir === 'desc' ? -1 : 1));
    }
    if (q.limit) rows = rows.slice(0, q.limit);
    return rows;
  };
  const notify = (path) => {
    save();
    for (const w of watchers) {
      if (w.kind === 'doc' && w.path === path) queueMicrotask(() => w.cb(api.getSync(path)));
      if (w.kind === 'coll' && w.path === parent(path)) queueMicrotask(() => w.cb(collDocs(w.path, w.q)));
    }
  };
  const applyUpdate = (cur, data) => {
    const out = clone(cur) || {};
    for (const [k, v] of Object.entries(data)) {
      const segs = k.split('.');
      let o = out;
      segs.slice(0, -1).forEach((s) => { o[s] = o[s] && typeof o[s] === 'object' ? o[s] : {}; o = o[s]; });
      o[segs[segs.length - 1]] = clone(v);
    }
    return out;
  };

  const api = {
    getSync: (path) => (db[path] ? { id: path.split('/').pop(), ...clone(db[path]) } : null),
    onAuth: (cb) => { authCbs.add(cb); queueMicrotask(() => cb(uid ? { uid, email: uid + '@demo' } : null)); return () => authCbs.delete(cb); },
    uid: () => uid,
    email: () => (uid ? uid + '@demo' : ''),
    signIn: async () => api.demo.switchTo('u_spencer'),
    signUp: async () => api.demo.switchTo('u_spencer'),
    google: async () => api.demo.switchTo('u_spencer'),
    reset: async () => {},
    signOut: async () => { uid = null; try { localStorage.removeItem('oc-demo-uid'); } catch (e) {} authCbs.forEach((cb) => cb(null)); },
    get: async (path) => api.getSync(path),
    set: async (path, data, merge) => { db[path] = merge ? applyUpdate(db[path], data) : clone(data); notify(path); },
    update: async (path, data) => { if (!db[path]) throw new Error('Not found: ' + path); db[path] = applyUpdate(db[path], data); notify(path); },
    add: async (path, data) => { const id = newId(); db[path + '/' + id] = clone(data); notify(path + '/' + id); return id; },
    del: async (path) => { delete db[path]; notify(path); },
    batch: async (ops) => { for (const o of ops) { if (o.op === 'delete') await api.del(o.path); else if (o.op === 'update') await api.update(o.path, o.data); else await api.set(o.path, o.data, o.merge); } },
    watchDoc: (path, cb) => { const w = { kind: 'doc', path, cb }; watchers.add(w); queueMicrotask(() => cb(api.getSync(path))); return () => watchers.delete(w); },
    watchColl: (path, q, cb) => { const w = { kind: 'coll', path, q, cb }; watchers.add(w); queueMicrotask(() => cb(collDocs(path, q))); return () => watchers.delete(w); },
    getColl: async (path, q) => collDocs(path, q),
    upload: (path, file, onProgress) => new Promise((resolve) => {
      onProgress && onProgress(1);
      // Small images are kept as data URLs so they survive a reload; bigger files last for this visit.
      if (file.size < 1.5e6) { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(file); }
      else resolve(URL.createObjectURL(file));
    }),
    demo: {
      switchTo: (u) => { uid = u; try { localStorage.setItem('oc-demo-uid', u); } catch (e) {} authCbs.forEach((cb) => cb({ uid, email: uid + '@demo' })); },
      reset: () => { try { localStorage.removeItem(KEY); localStorage.removeItem('oc-demo-uid'); } catch (e) {} location.reload(); },
      people: () => Object.keys(db).filter((k) => /^circles\/[^/]+\/access\//.test(k)).map((k) => ({ uid: k.split('/').pop(), memberId: db[k].memberId })),
    },
  };
  return api;
}
