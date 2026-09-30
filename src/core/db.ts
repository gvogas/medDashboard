// Atomic IndexedDB transactions shared by every tab of this account.
import type { Achievement, Course, Item, Quote, StudySession } from './types.ts';

/** A row as the server and the queue know it: an id and whatever fields its kind has. */
export interface Row { id: string; revision?: number; updatedAt?: number | null; deletedAt?: number | null; [field: string]: unknown }

/** An edit waiting to upload: `key` is 'profile' or '<kind>:<id>'. */
export interface PendingOp {
  key: string;
  op: string;
  body: Row | null;
  revision: number;
  reviewRequired: boolean;
  token: string;
  owner: string;
}

/** An edit the server turned down (or another tab overwrote), kept for review. */
export interface Conflict extends PendingOp { id: string; current?: Row | null; reason: string; at: number }

/** What each object store holds. */
export interface Rows {
  courses: Course;
  items: Item;
  quotes: Quote;
  study_sessions: StudySession;
  achievements: Achievement;
  meta: { key: string; value: unknown };
  pending: PendingOp;
  conflicts: Conflict;
}
export type StoreName = keyof Rows;

/** One object store inside a transaction. */
export interface Access<S extends StoreName> {
  get(key: IDBValidKey): Promise<Rows[S] | undefined>;
  all(): Promise<Rows[S][]>;
  put(row: Rows[S]): Promise<IDBValidKey>;
  del(key: IDBValidKey): Promise<undefined>;
  clear(): Promise<undefined>;
}
export type Accessor = <S extends StoreName>(s: S) => Access<S>;

export interface Db {
  transaction<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (a: Accessor) => T | Promise<T>): Promise<T>;
  get<S extends StoreName>(s: S, key: IDBValidKey): Promise<Rows[S] | undefined>;
  all<S extends StoreName>(s: S): Promise<Rows[S][]>;
  put<S extends StoreName>(s: S, row: Rows[S]): Promise<unknown>;
  close(): void;
}

export const STORES: StoreName[] = ['courses', 'items', 'quotes', 'study_sessions', 'achievements', 'meta', 'pending', 'conflicts'];
const result = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export function openDb(name: string, onVersionChange: () => void = () => {}): Promise<Db> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 4);
    let blocked = false;
    req.onupgradeneeded = () => {
      const db = req.result, tx = req.transaction!;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: ['meta', 'pending'].includes(s) ? 'key' : 'id' });
      // Version 1 stored one dirty map. Move it without discarding unsent edits.
      const old: IDBRequest<{ value?: Record<string, string> } | undefined> = tx.objectStore('meta').get('dirty');
      old.onsuccess = () => {
        for (const [key, op] of Object.entries(old.result?.value || {})) {
          const [kind, id] = key.split(/:(.*)/s);
          const row: IDBRequest<Row & { value?: Row } | undefined> = tx.objectStore(key === 'profile' ? 'meta' : kind).get(key === 'profile' ? 'profile' : id);
          row.onsuccess = () => {
            const body = key === 'profile' ? row.result?.value : row.result;
            tx.objectStore('pending').put({ key, op, body, revision: body?.revision || 0, reviewRequired: !body?.revision && (op === 'delete' || !!body?.updatedAt), token: crypto.randomUUID(), owner: 'migration' });
          };
        }
        tx.objectStore('meta').delete('dirty');
      };
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => { blocked = true; reject(new Error('Close older Term tabs, then reload to upgrade local storage.')); };
    req.onsuccess = () => {
      const db = req.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); onVersionChange(); };
      const transaction = <T>(stores: StoreName[], mode: IDBTransactionMode, fn: (a: Accessor) => T | Promise<T>) => new Promise<T>((res, rej) => {
        const tx = db.transaction(stores, mode);
        let value: T;
        const access = <S extends StoreName>(s: S): Access<S> => ({
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

export function deleteDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    const timer = setTimeout(() => reject(new Error('Close other Term tabs and retry clearing this device.')), 5000);
    req.onsuccess = () => { clearTimeout(timer); resolve(); };
    req.onerror = () => { clearTimeout(timer); reject(req.error); };
    // A blocked request is still pending, never a successful deletion.
  });
}
