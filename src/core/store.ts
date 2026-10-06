// The database is authoritative; memory is a render cache, never the shared queue.
import { openDb, deleteDb, STORES as stores } from './db.ts';
import { normalizeItem, normalizeCourse, normalizeQuote, normalizeStudySession, normalizeAchievement, normalizeFlow, normalizePrefs, DEFAULT_COAT } from './model.ts';
import type { Accessor, Conflict, Db, PendingOp, Row, Rows } from './db.ts';
import type { Raw, RawCourse, RawItem } from './model.ts';
import type { Achievement, Coat, Course, Item, Profile, Quote, StudySession } from './types.ts';

/** The kinds of row the store keeps, each in its own object store. */
export type Kind = 'items' | 'courses' | 'quotes' | 'study_sessions' | 'achievements';
/** What each kind's normalizer takes. */
interface RawOf { items: RawItem; courses: RawCourse; quotes: Raw<Quote>; study_sessions: Raw<StudySession>; achievements: Raw<Achievement> }
/** A row to save, with its kind. */
export type SaveRow = { [K in Kind]: { kind: K; row: RawOf[K] } }[Kind];
/** What the store says happened: a change here, in another tab, from a sync, and so on. */
export interface StoreEvent { type: string; message?: string }
/** The profile as the server sends it; the store fills in what it lacks. */
export type ServerProfile = Omit<Partial<Profile>, 'coat'> & { id: string; coat?: Partial<Coat> };
/** A page of changes from the server. */
export interface Page { cursor: number; changes: { kind: Kind; row: Row }[] }

export const data: {
  profile: Profile | null;
  courses: Course[];
  items: Item[];
  quotes: Quote[];
  study_sessions: StudySession[];
  achievements: Achievement[];
} = { profile: null, courses: [], items: [], quotes: [], study_sessions: [], achievements: [] };
const dirty: Record<string, string> = {};
export const conflicts: Conflict[] = [];
const listeners = new Set<(evt: StoreEvent) => void>();
const normal: { [K in Kind]: (raw: RawOf[K]) => Rows[K] } = { items: normalizeItem, courses: normalizeCourse, quotes: normalizeQuote, study_sessions: normalizeStudySession, achievements: normalizeAchievement };
const kinds = Object.keys(normal) as Kind[];
/* A stored or downloaded row may hold anything; each normalizer takes whatever it is given. */
const normalizer = (kind: Kind) => normal[kind] as (raw: unknown, index?: number) => Rows[Kind];
/* Which tab queued an edit. It lasts as long as the tab, reloads included: a new id on
   every load made an unsynced edit look like another tab's once the page reloaded. */
const owner = (() => {
  try {
    const kept = sessionStorage.getItem('rounds.tab');
    if (kept) return kept;
    const id = crypto.randomUUID();
    sessionStorage.setItem('rounds.tab', id);
    return id;
  } catch { return crypto.randomUUID(); }
})();
let db: Db | null = null, channel: BroadcastChannel | null = null, userId: string | null = null, localTail: Promise<unknown> = Promise.resolve();
const dbName = (id: string) => `rounds:${id}`;
const notify = (evt: StoreEvent) => { for (const fn of listeners) fn(evt); };
export function subscribe(fn: (evt: StoreEvent) => void): () => boolean { listeners.add(fn); return () => listeners.delete(fn); }
// Lookups by id run inside sorts and searches, so they use maps rebuilt on every reload.
let byId = { courses: new Map<string, Course>(), items: new Map<string, Item>() };
export const course = (id: string | null | undefined): Course | null => byId.courses.get(id!) || null;
export const item = (id: string | null | undefined): Item | null => byId.items.get(id!) || null;
const index = () => { byId = { courses: new Map(data.courses.map((r) => [r.id, r])), items: new Map(data.items.map((r) => [r.id, r])) }; };
const profile = (p: ServerProfile): Profile => ({ ...p, types: Array.isArray(p.types) ? p.types : [], studyFlow: normalizeFlow(p.studyFlow), studyPrefs: normalizePrefs(p.studyPrefs), coat: { name: '', role: '', color: DEFAULT_COAT, ...p.coat }, revision: p.revision || 0 });
const rowStore = (key: string) => (key === 'profile' ? 'meta' : key.split(':')[0]) as Kind | 'meta';
const rowId = (key: string) => key === 'profile' ? 'profile' : key.slice(key.indexOf(':') + 1);
/* The profile is kept in `meta` under its key; any other row is stored as it is. */
const wrap: { (key: 'profile', row: unknown): Rows['meta']; (key: string, row: unknown): Rows[Kind | 'meta'] } =
  (key: string, row: unknown) => (key === 'profile' ? { key: 'profile', value: row } : row) as Rows['meta'];

/* Rows a delete is waiting on: gone from every view while Undo can still bring them back. */
const hidden = new Set<string>();   /* 'items:id', 'courses:id' */
export async function hide(key: string, on = true): Promise<void> {
  if (on) hidden.add(key); else hidden.delete(key);
  await reload();
  notify({ type: 'hidden' });
}

export async function reload(): Promise<void> {
  const handle = db;
  if (!handle) return;
  const snapshot = await handle.transaction(stores, 'readonly', async (a) => ({
    courses: await a('courses').all(), items: await a('items').all(), quotes: await a('quotes').all(), study_sessions: await a('study_sessions').all(), achievements: await a('achievements').all(),
    profile: (await a('meta').get('profile'))?.value as Profile | undefined,
    pending: await a('pending').all(), conflicts: await a('conflicts').all(),
  }));
  if (db !== handle) return;
  for (const kind of kinds) (data as Record<Kind, Rows[Kind][]>)[kind] = snapshot[kind].filter((r) => !hidden.has(kind + ':' + r.id)).map(normalizer(kind));
  index();
  data.profile = snapshot.profile || null;
  for (const key of Object.keys(dirty)) delete dirty[key];
  for (const op of snapshot.pending) dirty[op.key] = op.op;
  conflicts.splice(0, conflicts.length, ...snapshot.conflicts);
}

export async function open(p: ServerProfile): Promise<void> {
  await close();
  if (localStorage.getItem(`rounds.wipe:${p.id}`)) {
    await deleteDb(dbName(p.id));
    localStorage.removeItem(`rounds.wipe:${p.id}`);
  }
  userId = p.id;
  db = await openDb(dbName(p.id), () => { close().finally(() => notify({ type: 'signed-out' })); }, p.id);
  await db.transaction(['meta', 'pending'], 'readwrite', async (a) => {
    const cached = (await a('meta').get('profile'))?.value;
    if (!cached || (!(await a('pending').get('profile')) && p.revision)) await a('meta').put(wrap('profile', profile(p)));
  });
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(dbName(p.id));
    channel.onmessage = async ({ data: event }) => {
      if (event === 'close') { await close(); notify({ type: 'signed-out' }); }
      else { await reload(); notify({ type: 'remote' }); }
    };
  }
  await reload();
  localStorage.setItem('rounds.session', JSON.stringify({ id: p.id, username: p.username }));
}

export async function close(): Promise<void> {
  await localTail.catch(() => {});
  db?.close(); db = null; userId = null; hidden.clear();
  channel?.close(); channel = null;
  data.profile = null;
  for (const kind of kinds) data[kind] = [];
  index();
  for (const key of Object.keys(dirty)) delete dirty[key];
  conflicts.length = 0;
}

export async function wipe(id: string): Promise<void> {
  localStorage.setItem(`rounds.wipe:${id}`, '1');
  localStorage.removeItem('rounds.session');
  channel?.postMessage('close');
  await close();
  await deleteDb(dbName(id));
  localStorage.removeItem(`rounds.wipe:${id}`);
}

// Serialize mutations in this tab; IndexedDB serializes transactions across tabs.
function mutate<T>(fn: (a: Accessor) => T | Promise<T>, event = 'change'): Promise<T> {
  const handle = db;
  const run = localTail.then(async () => {
    if (!handle || db !== handle) throw new Error('Sign in again before saving.');
    const value = await handle.transaction(stores, 'readwrite', fn);
    await reload();
    if (event === 'change' || value === true) channel?.postMessage('changed');
    notify({ type: event });
    return value;
  });
  localTail = run.catch((error) => { notify({ type: 'save-error', message: error.message }); });
  return run;
}

async function queue(a: Accessor, key: string, op: string, body: Row | null) {
  const previous = await a('pending').get(key);
  if (previous && previous.owner !== owner) {
    await a('conflicts').put({ id: crypto.randomUUID(), ...previous, reason: 'Another tab edited this record.', at: Date.now() });
  }
  const revision = previous?.revision ?? body?.revision ?? 0;
  await a('pending').put({ key, op, body, revision, reviewRequired: !!previous?.reviewRequired, token: crypto.randomUUID(), owner });
}

/* The server refuses an item with no title. A title cleared while editing keeps the
   one already stored, so the edit is never refused and moved to the conflicts. */
async function keepTitle(a: Accessor, kind: Kind, row: Rows[Kind]) {
  if (kind !== 'items' || (row as Item).title.trim()) return;
  (row as Item).title = (await a('items').get(row.id))?.title || 'Untitled';
}

const saveRow = <K extends Kind>(kind: K, row: RawOf[K]): Promise<Rows[K]> => saveRows([{ kind, row } as SaveRow]).then(([saved]) => saved as Rows[K]);
/* `after` does what the server does in the same change, e.g. clearing links to the row. */
function deleteRow(kind: Kind, id: string, after?: (a: Accessor) => Promise<void>) {
  return mutate(async (a) => {
    const row = await a(kind).get(id);
    await queue(a, `${kind}:${id}`, 'delete', (row || { id }) as Row);
    await a(kind).del(id);
    await after?.(a);
  });
}
const clean = <K extends Kind>(r: { kind: K; row: RawOf[K] }) => ({ kind: r.kind, row: normal[r.kind](structuredClone(r.row)) });
/** Save many rows, `[{ kind, row }]`, as one change: one transaction, one reload, one broadcast. */
export function saveRows(rows: SaveRow[]): Promise<Rows[Kind][]> {
  const cleaned = rows.map(clean);
  return mutate(async (a) => {
    for (const { kind, row } of cleaned) {
      await keepTitle(a, kind, row);
      await a(kind).put(row);
      await queue(a, `${kind}:${row.id}`, 'put', row as unknown as Row);
    }
    return cleaned.map(({ row }) => row);
  });
}
export const saveItem = (row: RawItem) => saveRow('items', row);
export const saveCourse = (row: RawCourse) => saveRow('courses', row);
export const saveQuote = (row: Raw<Quote>) => saveRow('quotes', row);
export const saveStudySession = (row: Raw<StudySession>) => saveRow('study_sessions', row);
export const deleteStudySession = (id: string) => deleteRow('study_sessions', id);
export const saveAchievement = (row: Raw<Achievement>) => saveRow('achievements', row);
export const deleteAchievement = (id: string) => deleteRow('achievements', id);
export const deleteItem = (id: string) => deleteRow('items', id, (a) => unlinkSessions(a, 'itemId', id));
/* The server clears a deleted course's or item's link on its sessions in the same
   change; this does the same on this device, pending uploads included. */
async function unlinkSessions(a: Accessor, field: 'itemId' | 'courseId', id: string) {
  for (const s of await a('study_sessions').all()) if (s[field] === id) {
    s[field] = null;
    await a('study_sessions').put(s);
    const pending = await a('pending').get(`study_sessions:${s.id}`);
    if (pending?.body) { pending.body[field] = null; await a('pending').put(pending); }
  }
}
export const deleteQuote = (id: string) => deleteRow('quotes', id);
export function deleteCourse(id: string): Promise<void> {
  return deleteRow('courses', id, async (a) => {
    for (const it of await a('items').all()) if (it.courseId === id) {
      // Server clears this reference atomically with the course deletion.
      it.courseId = null;
      await a('items').put(it);
      const pending = await a('pending').get(`items:${it.id}`);
      if (pending?.body) { pending.body.courseId = null; await a('pending').put(pending); }
    }
    await unlinkSessions(a, 'courseId', id);
  });
}
/** What a profile edit can change. */
export type ProfilePatch = Omit<Partial<Profile>, 'coat'> & { coat?: Partial<Coat> };
export function saveProfile(patch: ProfilePatch): Promise<void> {
  const copy = structuredClone(patch);
  return mutate(async (a) => {
    const p = (await a('meta').get('profile'))!.value as Profile;
    if (copy.coat) Object.assign(p.coat, copy.coat);
    for (const key of ['displayName', 'theme', 'bg', 'termStart', 'types', 'studyFlow', 'studyPrefs', 'schoolCalendar'] as const) if (key in copy) (p as unknown as Record<string, unknown>)[key] = copy[key];
    await a('meta').put(wrap('profile', p));
    await queue(a, 'profile', 'put', p as unknown as Row);
  });
}
export const pendingCount = (): number => Object.keys(dirty).length;
export const pending = (): Promise<PendingOp[]> => db!.all('pending');
export const meta = {
  get: async (key: string): Promise<unknown> => (await db!.get('meta', key))?.value,
  set: (key: string, value: unknown) => db!.put('meta', { key, value }),
};

export function settleOperation(op: PendingOp, saved: Row | null | undefined): Promise<boolean | undefined> {
  return mutate(async (a) => {
    const current = await a('pending').get(op.key);
    if (!current) return;
    if (current.token !== op.token) {
      // An edit made while uploading builds on the write we just acknowledged.
      if (saved) {
        current.revision = saved.revision!;
        if (current.body) current.body.revision = saved.revision;
        await a('pending').put(current);
        const stored = await a(rowStore(op.key)).get(rowId(op.key));
        const local = (op.key === 'profile' ? (stored as Rows['meta'] | undefined)?.value : stored) as { revision?: number } | undefined;
        if (local) {
          local.revision = saved.revision;
          await a(rowStore(op.key)).put(wrap(op.key, local));
        }
      }
      return !!saved;
    }
    await a('pending').del(op.key);
    if (saved) await a(rowStore(op.key)).put(wrap(op.key, saved));
    return true;
  }, 'synced');
}

/** Take the server's copy in place of a refused edit; unless `quiet`, the edit is kept for review. */
export function rejectOperation(op: PendingOp, current: Row | null | undefined, reason: string, { quiet = false } = {}): Promise<true | undefined> {
  return mutate(async (a) => {
    if (!quiet) await a('conflicts').put({ ...op, id: crypto.randomUUID(), current, reason, at: Date.now() });
    if ((await a('pending').get(op.key))?.token !== op.token) return;
    await a('pending').del(op.key);
    if (current && !current.deletedAt) await a(rowStore(op.key)).put(wrap(op.key, current));
    else if (op.key !== 'profile') await a(rowStore(op.key)).del(rowId(op.key));
    return true;
  }, 'synced');
}

export function applyPage(page: Page, reset = false): Promise<boolean> {
  return mutate(async (a) => {
    if (reset) for (const kind of kinds) {
      for (const row of await a(kind).all()) if (!(await a('pending').get(`${kind}:${row.id}`))) await a(kind).del(row.id);
    }
    for (const { kind, row } of page.changes) {
      if (await a('pending').get(`${kind}:${row.id}`)) continue;
      const local = await a(kind).get(row.id);
      if (local && local.revision! > row.revision!) continue;
      if (row.deletedAt) await a(kind).del(row.id);
      else await a(kind).put(normalizer(kind)(row));
    }
    await a('meta').put({ key: 'syncCursor', value: page.cursor });
    return reset || page.changes.length > 0;
  }, 'synced');
}
export function applyServerProfile(p: ServerProfile): Promise<void> {
  return mutate(async (a) => {
    if (!(await a('pending').get('profile'))) {
      const old = (await a('meta').get('profile'))?.value as Profile | undefined;
      if (!old || old.revision! <= p.revision!) await a('meta').put(wrap('profile', profile(p)));
    }
  }, 'synced');
}

export function resolveConflict(id: string, restore: boolean): Promise<void> {
  return mutate(async (a) => {
    const conflict = await a('conflicts').get(id);
    if (!conflict) return;
    if (restore) {
      const stored = await a(rowStore(conflict.key)).get(rowId(conflict.key));
      const local = (conflict.key === 'profile' ? (stored as Rows['meta'] | undefined)?.value : stored) as { revision?: number } | undefined;
      // The saved copy may predate subsequent pulls. Restore against the latest
      // revision we know, while the server still checks for unseen changes.
      const current = (local?.revision || 0) >= (conflict.current?.revision || 0) ? local : conflict.current;
      const body = { ...conflict.body, revision: current?.revision || 0 } as Row;
      const existing = await a('pending').get(conflict.key);
      if (existing) throw new Error('Wait for the pending edit to sync before restoring this copy.');
      await queue(a, conflict.key, conflict.op, body);
      if (conflict.op === 'put') await a(rowStore(conflict.key)).put(wrap(conflict.key, body));
      else await a(rowStore(conflict.key)).del(rowId(conflict.key));
    }
    await a('conflicts').del(id);
  });
}

export async function withSyncLock<T>(fn: () => T | Promise<T>, { signal }: { signal?: AbortSignal } = {}): Promise<T | false> {
  const id = userId;
  const run = async () => {
    signal?.throwIfAborted();
    if (id && id === userId) return fn();
    return false as const;
  };
  return navigator.locks ? navigator.locks.request(`rounds-sync:${id}`, { signal }, run) : run();
}
