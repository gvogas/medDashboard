// Atomic IndexedDB transactions shared by every tab of this account.
import type { Achievement, Course, Item, Mark, Quote, SharedCourse, SharedItem, Space, SpacePref, StudySession } from './types.ts';

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
  /** A shared row's edit: the row as it was when first queued, from which sync works out `changed`. */
  base?: Row | null;
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
  shared_courses: SharedCourse;
  shared_items: SharedItem;
  spaces: Space;
  marks: Mark;
  space_prefs: SpacePref;
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

export const STORES: StoreName[] = ['courses', 'items', 'quotes', 'study_sessions', 'achievements', 'shared_courses', 'shared_items', 'spaces', 'marks', 'space_prefs', 'meta', 'pending', 'conflicts'];
/* Shared rows are keyed [scope, id], so a class's id can never shadow a personal row (spec §7). */
const keyPathOf = (s: StoreName): string | string[] =>
  s === 'meta' || s === 'pending' ? 'key' : s === 'shared_courses' || s === 'shared_items' ? ['scope', 'id'] : 'id';
const result = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** Version 6: version 5's shared rows, spaces and cursor per scope (spec §7), and your marks
    and space prefs (Stage 4). Roll-forward only: a version 5 client cannot open it.
    `account` names whose cursor version 4 kept. */
export function openDb(name: string, onVersionChange: () => void = () => {}, account: string | null = null): Promise<Db> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 6);
    let blocked = false;
    req.onupgradeneeded = (event) => {
      const db = req.result, tx = req.transaction!;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: keyPathOf(s) });
      // Version 4 kept one cursor, for the person's own rows: it becomes theirs in the map.
      if (event.oldVersion >= 1 && event.oldVersion < 5 && account) {
        const meta = tx.objectStore('meta'), old: IDBRequest<{ value?: number } | undefined> = meta.get('syncCursor');
        old.onsuccess = () => {
          if (old.result?.value) meta.put({ key: 'cursors', value: { ['u:' + account]: old.result.value } });
          meta.delete('syncCursor');
        };
      }
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
