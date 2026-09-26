// Atomic IndexedDB transactions shared by every tab of this account.
const STORES = ['courses', 'items', 'quotes', 'study_sessions', 'achievements', 'meta', 'pending', 'conflicts'];
const result = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export function openDb(name, onVersionChange = () => {}) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 4);
    let blocked = false;
    req.onupgradeneeded = () => {
      const db = req.result, tx = req.transaction;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: ['meta', 'pending'].includes(s) ? 'key' : 'id' });
      // Version 1 stored one dirty map. Move it without discarding unsent edits.
      const old = tx.objectStore('meta').get('dirty');
      old.onsuccess = () => {
        for (const [key, op] of Object.entries(old.result?.value || {})) {
          const [kind, id] = key.split(/:(.*)/s);
          const row = tx.objectStore(key === 'profile' ? 'meta' : kind).get(key === 'profile' ? 'profile' : id);
          row.onsuccess = () => {
            const body = key === 'profile' ? row.result?.value : row.result;
            tx.objectStore('pending').put({ key, op, body, revision: body?.revision || 0, reviewRequired: !body?.revision && (op === 'delete' || !!body?.updatedAt), token: crypto.randomUUID(), owner: 'migration' });
          };
        }
        tx.objectStore('meta').delete('dirty');
      };
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => { blocked = true; reject(new Error('Close older Rounds tabs, then reload to upgrade local storage.')); };
    req.onsuccess = () => {
      const db = req.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); onVersionChange(); };
      const transaction = (stores, mode, fn) => new Promise((res, rej) => {
        const tx = db.transaction(stores, mode);
        let value;
        const access = (s) => ({
          get: (key) => result(tx.objectStore(s).get(key)),
          all: () => result(tx.objectStore(s).getAll()),
          put: (row) => result(tx.objectStore(s).put(row)),
          del: (key) => result(tx.objectStore(s).delete(key)),
          clear: () => result(tx.objectStore(s).clear()),
        });
        tx.oncomplete = () => res(value);
        tx.onerror = tx.onabort = () => rej(tx.error || new Error('Local save was interrupted.'));
        Promise.resolve().then(() => fn(access)).then((v) => { value = v; }, (e) => { try { tx.abort(); } catch {} rej(e); });
      });
      resolve({
        transaction,
        get: (s, key) => transaction([s], 'readonly', (a) => a(s).get(key)),
        all: (s) => transaction([s], 'readonly', (a) => a(s).all()),
        put: (s, row) => transaction([s], 'readwrite', (a) => a(s).put(row)),
        close: () => db.close(),
      });
    };
  });
}

export function deleteDb(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    const timer = setTimeout(() => reject(new Error('Close other Rounds tabs and retry clearing this device.')), 5000);
    req.onsuccess = () => { clearTimeout(timer); resolve(); };
    req.onerror = () => { clearTimeout(timer); reject(req.error); };
    // A blocked request is still pending, never a successful deletion.
  });
}
