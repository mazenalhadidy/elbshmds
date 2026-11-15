/* =====================================================================
   SAVING ON THIS DEVICE
   Small values: localStorage. The changes not yet confirmed by the server are saved in
   TWO places (localStorage + the browser database IndexedDB), so losing one copy loses nothing.
   ===================================================================== */
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
export { ls };

let db = null;
/** Open the browser database (once). Works without it if the browser refuses. */
export function openIdb() {
  if (db || typeof indexedDB === 'undefined') return Promise.resolve(db);
  return new Promise(res => {
    try {
      const r = indexedDB.open('elbshmds', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { db = r.result; res(db); };
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}
export function idbSet(k, v) {
  if (!db) return Promise.resolve(false);
  return new Promise(res => { try { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(JSON.parse(JSON.stringify(v)), k); t.oncomplete = () => res(true); t.onerror = t.onabort = () => res(false); } catch { res(false); } });
}
export function idbGet(k) {
  if (!db) return Promise.resolve(undefined);
  return new Promise(res => { try { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch { res(undefined); } });
}

/**
 * The unsent changes. `n` counts saves so the newest of the two copies wins at start.
 * Returns false only if NO copy could be written (then the app refuses the change instead of pretending).
 */
export function saveUnsent(n, pending, failed) {
  const ok = ls.set('elb_failed', failed) && ls.set('elb_pending', pending) && ls.set('elb_n', n);
  idbSet('unsent', { n, pending, failed });
  return ok || !!db;
}
export async function loadUnsent() {
  const local = { n: ls.get('elb_n', 0), pending: ls.get('elb_pending', []), failed: ls.get('elb_failed', []) };
  const other = await idbGet('unsent');
  return other && other.n > local.n ? other : local;     // the newer copy wins
}
