// A 40-line IndexedDB wrapper. One database per signed-in user, four stores.

const STORES = ['courses', 'items', 'quotes', 'meta'];

export function openDb(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const run = (store, mode, fn) =>
        new Promise((res, rej) => {
          const tx = db.transaction(store, mode);
          const r = fn(tx.objectStore(store));
          tx.oncomplete = () => res(r.result);
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
        });
      resolve({
        get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
        all: (store) => run(store, 'readonly', (s) => s.getAll()),
        put: (store, value) => run(store, 'readwrite', (s) => s.put(value)),
        del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
        clear: (store) => run(store, 'readwrite', (s) => s.clear()),
        close: () => db.close(),
      });
    };
  });
}

export function deleteDb(name) {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
