/* Shared-state store for the MIMU games.
   Firebase Realtime Database when js/config.js has a databaseURL (every phone, laptop and
   projector sees the same lobby / spin), otherwise localStorage (single machine, for previews).

   API:  Store.get(key) -> value|null            (from the live cache)
         Store.set(key, value)
         Store.update(key, fn)                   // fn(current) -> next, run as an atomic transaction
         Store.subscribe(key, fn) -> unsubscribe // fn(value) now and on every change
         Store.now()                             // server-synced clock (ms) — use instead of Date.now()
         Store.normalize(key, fn)                // fn(raw) -> value with defaults (Firebase drops empty arrays)
         Store.deviceId()
*/
window.Store = (() => {
  const PREFIX = window.FLOATZ_STORE_PREFIX || "floatz:";
  const cfg = (window.MIMU_BACKEND && window.MIMU_BACKEND.firebase) || {};
  const useFirebase = !!cfg.databaseURL && !(window.__SPRITE_DATA);   // hosted previews stay local
  const subs = new Map(), normalizers = new Map();
  const norm = (key, v) => { const f = normalizers.get(key); return f ? f(v) : v; };
  const emit = (key, value) => (subs.get(key) || []).forEach(fn => { try { fn(value); } catch (e) { console.error(e); } });
  const common = {
    normalize(key, fn) { normalizers.set(key, fn); },
    deviceId() {
      let id = null; try { id = localStorage.getItem("mimu:device"); } catch {}
      if (!id) { id = "d-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9); try { localStorage.setItem("mimu:device", id); } catch {} }
      return id;
    },
  };

  /* ---------------- localStorage (fallback) ---------------- */
  if (!useFirebase) {
    try { document.documentElement.dataset.backend = "local"; } catch {}
    const lastSeen = new Map();
    const read = key => { try { const raw = localStorage.getItem(PREFIX + key); return norm(key, raw ? JSON.parse(raw) : null); } catch { return norm(key, null); } };
    const write = (key, value) => { const raw = JSON.stringify(value); localStorage.setItem(PREFIX + key, raw); lastSeen.set(key, raw); emit(key, norm(key, value)); };
    const check = key => { const raw = localStorage.getItem(PREFIX + key); if (raw !== lastSeen.get(key)) { lastSeen.set(key, raw); emit(key, norm(key, raw ? JSON.parse(raw) : null)); } };
    window.addEventListener("storage", e => { if (e.key && e.key.startsWith(PREFIX)) check(e.key.slice(PREFIX.length)); });
    setInterval(() => subs.forEach((_, key) => check(key)), 700);
    return { ...common, backend: "local", now: () => Date.now(), get: read, set: write, preload: () => Promise.resolve(),
      update(key, fn) { const next = fn(read(key)); write(key, next); return next; },
      subscribe(key, fn) { if (!subs.has(key)) subs.set(key, new Set()); subs.get(key).add(fn); lastSeen.set(key, localStorage.getItem(PREFIX + key)); fn(read(key)); return () => subs.get(key)?.delete(fn); },
    };
  }

  /* ---------------- Firebase Realtime Database ---------------- */
  const cache = new Map(); let db = null, offset = 0, readyResolve; const ready = new Promise(r => (readyResolve = r));
  const path = key => PREFIX.replace(/:$/, "") + "/" + key;          // "floatz/lobby", "rocket/lobby", "wheel/wheel"
  const load = src => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  (async () => {
    try {
      await load("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
      await load("https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js");
      firebase.initializeApp(cfg); db = firebase.database();
      document.documentElement.dataset.backend = "live";
      db.ref(".info/serverTimeOffset").on("value", s => { offset = s.val() || 0; });
      readyResolve();
    } catch (e) { console.error("Firebase failed to load — falling back to this device only", e); document.body.classList.add("backend-offline"); readyResolve(); }
  })();
  const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v));   // strip undefined, keep arrays
  const loaded = new Set();
  return { ...common, backend: "firebase", ready,
    preload(keys) { return ready.then(() => db ? Promise.all(keys.map(k => db.ref(path(k)).once("value").then(snap => { cache.set(k, snap.val()); loaded.add(k); }))) : null).catch(e => console.error(e)); },
    now: () => Math.round(Date.now() + offset),
    get: key => norm(key, cache.has(key) ? cache.get(key) : null),
    set(key, value) { const v = clean(value); cache.set(key, v); emit(key, norm(key, v)); ready.then(() => db && db.ref(path(key)).set(v)); return value; },
    update(key, fn) {
      // optimistic local apply, then an atomic transaction on the server (fn is a pure reducer)
      const local = fn(norm(key, cache.has(key) ? cache.get(key) : null)); if (local !== undefined) { const v = clean(local); cache.set(key, v); emit(key, norm(key, v)); }
      ready.then(() => db && db.ref(path(key)).transaction(cur => { const next = fn(norm(key, cur === undefined ? null : cur)); return next === undefined ? cur : clean(next); }, (err, committed, snap) => { if (snap) { const v = snap.val(); cache.set(key, v); emit(key, norm(key, v)); } }));
      return local;
    },
    subscribe(key, fn) {
      if (!subs.has(key)) subs.set(key, new Set()); subs.get(key).add(fn);
      fn(norm(key, cache.has(key) ? cache.get(key) : null));
      ready.then(() => { if (!db) return; if (!subs.get(key).live) { subs.get(key).live = true; db.ref(path(key)).on("value", snap => { const v = snap.val(); cache.set(key, v); emit(key, norm(key, v)); }); } });
      return () => subs.get(key)?.delete(fn);
    },
  };
})();
