// The database is authoritative; memory is a render cache, never the shared queue.
import { openDb, deleteDb, STORES as stores } from './db.ts';
import { normalizeItem, normalizeCourse, normalizeQuote, normalizeStudySession, normalizeAchievement, normalizeMark, normalizeSpacePref, normalizeFlow, normalizePrefs, DEFAULT_COAT } from './model.ts';
import { parseKey, sharedKey, stable, meaningfulMark, MARK_DEFAULTS, SHARED_STORES, TOMBSTONE_TTL_MS, type SharedStore } from './shared.ts';
import { parseMaintenance } from './maintenance.ts';
import type { Access, Accessor, Conflict, Db, PendingOp, Row, Rows } from './db.ts';
import type { Raw, RawCourse, RawItem } from './model.ts';
import type { Achievement, Coat, Course, Item, Mark, Profile, Quote, SharedCourse, SharedItem, Space, SpacePref, StudySession } from './types.ts';

/** The kinds of row the store keeps, each in its own object store. */
export type Kind = 'items' | 'courses' | 'quotes' | 'study_sessions' | 'achievements' | 'marks' | 'space_prefs';
/** What each kind's normalizer takes. */
interface RawOf { items: RawItem; courses: RawCourse; quotes: Raw<Quote>; study_sessions: Raw<StudySession>; achievements: Raw<Achievement>; marks: Raw<Mark>; space_prefs: Raw<SpacePref> }
/** A row to save, with its kind. */
export type SaveRow = { [K in Kind]: { kind: K; row: RawOf[K] } }[Kind];
/** What the store says happened: a change here, in another tab, from a sync, and so on. */
export interface StoreEvent { type: string; message?: string }
/** The profile as the server sends it; the store fills in what it lacks. */
export type ServerProfile = Omit<Partial<Profile>, 'coat'> & { id: string; coat?: Partial<Coat> };
/**
 * A page of changes from the server. v3 names each change's scope (none: the person's
 * own), carries a cursor per scope and the person's spaces; v2's single `cursor` is the
 * person's own.
 */
/** A v3 cursor: a sequence, or `r<seq>.<floor>` while a scope's resync from 0 is still below
    the floor. Kept as it came and sent back as it is; the Worker drops the tag once past. */
export type Cursor = number | string;
export interface Page { cursor?: number; cursors?: Record<string, Cursor>; scopes?: Space[]; changes: { scope?: string; kind: Kind; row: Row }[] }

export const data: {
  profile: Profile | null;
  courses: Course[];
  items: Item[];
  quotes: Quote[];
  study_sessions: StudySession[];
  achievements: Achievement[];
  /* your layer on your spaces: marks on their items, prefs for each (spec §4) */
  marks: Mark[];
  space_prefs: SpacePref[];
  /* a class's or a project's rows, and the spaces themselves (spec §7) */
  shared_courses: SharedCourse[];
  shared_items: SharedItem[];
  /* class items an editor deleted, kept as tombstones until you choose (spec §13 Keep as mine / Dismiss) */
  removed_items: SharedItem[];
  spaces: Space[];
} = { profile: null, courses: [], items: [], quotes: [], study_sessions: [], achievements: [], marks: [], space_prefs: [], shared_courses: [], shared_items: [], removed_items: [], spaces: [] };
const dirty: Record<string, string> = {};
export const conflicts: Conflict[] = [];
const listeners = new Set<(evt: StoreEvent) => void>();
const normal: { [K in Kind]: (raw: RawOf[K]) => Rows[K] } = { items: normalizeItem, courses: normalizeCourse, quotes: normalizeQuote, study_sessions: normalizeStudySession, achievements: normalizeAchievement, marks: normalizeMark, space_prefs: normalizeSpacePref };
const kinds = Object.keys(normal) as Kind[];
/* A stored or downloaded row may hold anything; each normalizer takes whatever it is given. */
const normalizer = (kind: Kind) => normal[kind] as (raw: unknown, index?: number) => Rows[Kind];
/* A shared row keeps its scope, who last wrote it and, for an item, the team's fields. */
const normalShared = {
  shared_courses: (r: Row): SharedCourse => ({ ...normalizeCourse(r as unknown as RawCourse), scope: r.scope as string, updatedBy: (r.updatedBy as string | null) ?? null }),
  shared_items: (r: Row): SharedItem => ({
    ...normalizeItem(r as unknown as RawItem), scope: r.scope as string, updatedBy: (r.updatedBy as string | null) ?? null,
    assignees: Array.isArray(r.assignees) ? r.assignees as string[] : [], completedBy: (r.completedBy as string | null) ?? null,
    deletedAt: typeof r.deletedAt === 'number' ? r.deletedAt : null,
  }),
};
/* The shared store a change of `kind` goes to: only courses and items are shared. */
/* A removed class item past the server's tombstone time: the purge has taken it, unless your mark
   holds something (then it waits for you, and the purge keeps it as yours: spec §13). */
const expired = (r: { scope: string; id: string; deletedAt?: unknown }, marks: Mark[]) =>
  typeof r.deletedAt === 'number' && r.deletedAt < Date.now() - TOMBSTONE_TTL_MS
  && !marks.some((m) => m.spaceId === r.scope.slice(2) && m.itemId === r.id && meaningfulMark(m as unknown as Record<string, unknown>));
const sharedStoreOf = (kind: Kind): SharedStore | null => (kind === 'courses' ? 'shared_courses' : kind === 'items' ? 'shared_items' : null);
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
const profile = (p: ServerProfile): Profile => ({
  ...p, maintenance: parseMaintenance(p.maintenance), types: Array.isArray(p.types) ? p.types : [],
  hiddenSources: Array.isArray(p.hiddenSources) ? p.hiddenSources.filter((s): s is string => typeof s === 'string') : [],
  studyFlow: normalizeFlow(p.studyFlow), studyPrefs: normalizePrefs(p.studyPrefs), coat: { name: '', role: '', color: DEFAULT_COAT, ...p.coat }, revision: p.revision || 0,
});
/* A pending key's store, and the row's key in it: [scope, id] for a shared row (src/core/shared.ts). */
const rowStore = (key: string) => parseKey(key).store as Kind | SharedStore | 'meta';
const rowId = (key: string): IDBValidKey => { const k = parseKey(key); return k.scope ? [k.scope, k.id] : k.id; };
/* The profile is kept in `meta` under its key; any other row is stored as it is. */
const wrap: { (key: 'profile', row: unknown): Rows['meta']; (key: string, row: unknown): Rows[Kind | SharedStore | 'meta'] } =
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
    marks: await a('marks').all(), space_prefs: await a('space_prefs').all(),
    shared_courses: await a('shared_courses').all(), shared_items: await a('shared_items').all(), spaces: await a('spaces').all(),
    profile: (await a('meta').get('profile'))?.value as Profile | undefined,
    pending: await a('pending').all(), conflicts: await a('conflicts').all(),
  }));
  if (db !== handle) return;
  for (const kind of kinds) (data as Record<Kind, Rows[Kind][]>)[kind] = snapshot[kind].filter((r) => !hidden.has(kind + ':' + r.id)).map(normalizer(kind));
  data.shared_courses = snapshot.shared_courses.filter((r) => !hidden.has(sharedKey('shared_courses', r.scope, r.id))).map((r) => normalShared.shared_courses(r as unknown as Row));
  const sharedItems = snapshot.shared_items.filter((r) => !hidden.has(sharedKey('shared_items', r.scope, r.id))).map((r) => normalShared.shared_items(r as unknown as Row));
  data.shared_items = sharedItems.filter((r) => !r.deletedAt);
  data.removed_items = sharedItems.filter((r) => !!r.deletedAt && !expired(r, data.marks));
  data.spaces = snapshot.spaces;
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
  data.shared_courses = []; data.shared_items = []; data.removed_items = []; data.spaces = [];
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

/* `base` (a shared row's edit only): the row before this edit; an op already queued keeps
   the base it started from, so `changed` covers every edit since the last upload. */
async function queue(a: Accessor, key: string, op: string, body: Row | null, base?: Row | null) {
  const previous = await a('pending').get(key);
  if (previous && previous.owner !== owner) {
    await a('conflicts').put({ id: crypto.randomUUID(), ...previous, reason: 'Another tab edited this record.', at: Date.now() });
  }
  const revision = previous?.revision ?? body?.revision ?? 0;
  const kept = base === undefined ? {} : { base: previous ? previous.base ?? null : base };
  await a('pending').put({ key, op, body, revision, reviewRequired: !!previous?.reviewRequired, token: crypto.randomUUID(), owner, ...kept });
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
/** Your prefs for a space: whole-row, like your other rows. */
export const saveSpacePref = (row: Raw<SpacePref>) => saveRow('space_prefs', row);
/** Your mark on a shared item: it uploads with the mark it started from, since marks merge field by field (spec §6). */
export function saveMark(row: Raw<Mark>): Promise<Mark> {
  const normalized = normalizeMark(structuredClone(row));
  return mutate(async (a) => {
    const before = await a('marks').get(normalized.id);
    await a('marks').put(normalized);
    await queue(a, `marks:${normalized.id}`, 'put', normalized as unknown as Row, (before as unknown as Row | undefined) ?? null);
    return normalized;
  });
}
/** Save a class's or a project's course or item; it uploads with the row it started from (spec §6 Push). The UI calls this from Stage 4. */
export function saveShared(store: SharedStore, row: Row & { scope: string }): Promise<SharedCourse | SharedItem> {
  const normalized = normalShared[store](structuredClone(row));
  return mutate(async (a) => {
    const shared = a(store) as unknown as Access<'shared_items'>;
    const before = await shared.get([normalized.scope, normalized.id]);
    await shared.put(normalized as SharedItem);
    await queue(a, sharedKey(store, normalized.scope, normalized.id), 'put', normalized as unknown as Row, (before as unknown as Row | undefined) ?? null);
    return normalized;
  });
}
/** Delete a class's or a project's row on this device and queue the delete. */
export function removeShared(store: SharedStore, scope: string, id: string): Promise<void> {
  return mutate(async (a) => {
    const before = await a(store).get([scope, id]) as unknown as Row | undefined;
    await queue(a, sharedKey(store, scope, id), 'delete', before ?? { id, scope }, before ?? null);
    await a(store).del([scope, id]);
  });
}
/** Bring a removed class item back for everyone (owner and editors, spec §13): the whole row at its tombstone's revision, which the Worker revives. */
export function restoreShared(scope: string, id: string): Promise<void> {
  return mutate(async (a) => {
    const before = await a('shared_items').get([scope, id]);
    if (!before?.deletedAt) return;
    const row = { ...before, deletedAt: null };
    await a('shared_items').put(row);
    await queue(a, sharedKey('shared_items', scope, id), 'put', row as unknown as Row, before as unknown as Row);
  });
}
/** Dismiss (spec §13): your mark on a removed class item goes. */
export const deleteMark = (id: string) => deleteRow('marks', id);
export const deleteAchievement = (id: string) => deleteRow('achievements', id);
export const deleteItem = (id: string) => deleteRow('items', id, (a) => unlinkSessions(a, 'itemId', id));
/* The server clears a deleted course's or item's link on its sessions in the same
   change; this does the same on this device, pending uploads included. */
async function unlinkSessions(a: Accessor, field: 'itemId' | 'courseId', id: string) {
  for (const s of await a('study_sessions').all()) if (s[field] === id) {
    s[field] = null;
    await a('study_sessions').put(s);
    const queued = await a('pending').get(`study_sessions:${s.id}`);
    if (queued?.body) { queued.body[field] = null; await a('pending').put(queued); }
  }
}
export const deleteQuote = (id: string) => deleteRow('quotes', id);
export function deleteCourse(id: string): Promise<void> {
  return deleteRow('courses', id, async (a) => {
    for (const it of await a('items').all()) if (it.courseId === id) {
      // Server clears this reference atomically with the course deletion.
      it.courseId = null;
      await a('items').put(it);
      const queued = await a('pending').get(`items:${it.id}`);
      if (queued?.body) { queued.body.courseId = null; await a('pending').put(queued); }
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
    for (const key of ['displayName', 'theme', 'bg', 'termStart', 'types', 'studyFlow', 'studyPrefs', 'schoolCalendar', 'hiddenSources', 'grading'] as const) if (key in copy) (p as unknown as Record<string, unknown>)[key] = copy[key];
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
    if (saved && op.key === 'profile') {
      /* PUT /api/me answers the profile alone: the announcement and maintenance it held stay
         until the pull that follows brings them again */
      const local = (await a('meta').get('profile'))?.value as Profile | undefined;
      await a('meta').put(wrap('profile', { ...saved, announcement: local?.announcement ?? null, maintenance: local?.maintenance ?? null }));
    } else if (saved) await a(rowStore(op.key)).put(wrap(op.key, saved));
    return true;
  }, 'synced');
}

/** Take the server's copy in place of a refused edit; unless `quiet`, the edit is kept for review. */
export function rejectOperation(op: PendingOp, current: Row | null | undefined, reason: string, { quiet = false } = {}): Promise<true | undefined> {
  return mutate(async (a) => {
    if (!quiet) await a('conflicts').put({ ...op, id: crypto.randomUUID(), current, reason, at: Date.now() });
    if ((await a('pending').get(op.key))?.token !== op.token) return;
    await a('pending').del(op.key);
    const s = rowStore(op.key), scope = parseKey(op.key).scope;
    /* a class item another editor deleted stays as its tombstone (Stage 5 plan, Decision 6) */
    const kept = s === 'shared_items' && !!scope?.startsWith('c:');
    if (current && (!current.deletedAt || kept)) await a(s).put(kept ? normalShared.shared_items({ ...current, scope: scope! }) : wrap(op.key, current));
    else if (op.key !== 'profile') await a(s).del(rowId(op.key));
    return true;
  }, 'synced');
}

/**
 * Apply a page. A change in the person's own scope (or with none) goes to the personal
 * stores; a class's or a project's course or item to the shared ones, under [scope, id].
 * `reset` lists scopes whose clean rows are wiped first, in the same transaction that
 * stores their cursors (true: the person's own). A row with a pending edit, or held at a newer revision, is left alone.
 * A class item's tombstone is kept in its store (Stage 5 plan, Decision 6); `reload` lists it apart,
 * and one past the tombstone time goes unless your mark holds something.
 */
export function applyPage(page: Page, reset: boolean | string[] = false): Promise<boolean> {
  return mutate(async (a) => {
    const own = 'u:' + userId;
    const wiped = reset === true ? [own] : reset || [];
    for (const scope of wiped) {
      if (scope === own) {
        for (const kind of kinds) for (const row of await a(kind).all()) if (!(await a('pending').get(`${kind}:${row.id}`))) await a(kind).del(row.id);
      } else for (const s of SHARED_STORES) {
        for (const row of await a(s).all()) if (row.scope === scope && !(await a('pending').get(sharedKey(s, scope, row.id)))) await a(s).del([scope, row.id]);
      }
    }
    const detached: Record<string, number> = {};
    for (const { scope = own, kind, row } of page.changes) {
      if (scope === own) {
        /* the newest of your marks deleted in each space: a detach deletes them as it writes the copy (applyRevoked) */
        const spaceId = (row as Partial<Mark>).spaceId;
        if (kind === 'marks' && row.deletedAt && spaceId) detached[spaceId] = Math.max(detached[spaceId] ?? 0, row.updatedAt ?? 0);
        if (await a('pending').get(`${kind}:${row.id}`)) continue;
        const local = await a(kind).get(row.id);
        if (local && local.revision! > row.revision!) continue;
        if (row.deletedAt) await a(kind).del(row.id);
        else await a(kind).put(normalizer(kind)(row));
        continue;
      }
      const s = sharedStoreOf(kind);
      if (!s || await a('pending').get(sharedKey(s, scope, row.id))) continue;
      const store = a(s) as unknown as Access<'shared_items'>;
      const local = await store.get([scope, row.id]);
      if (local && local.revision! > row.revision!) continue;
      if (row.deletedAt && !(s === 'shared_items' && scope.startsWith('c:'))) await store.del([scope, row.id]);
      else await store.put(normalShared[s]({ ...row, scope }) as SharedItem);
    }
    /* the server never says when it purges a removed item: drop the ones past their time */
    const marks = await a('marks').all();
    for (const r of await a('shared_items').all()) if (expired(r, marks) && !(await a('pending').get(sharedKey('shared_items', r.scope, r.id)))) await a('shared_items').del([r.scope, r.id]);
    /* a space's member list comes only when it moved (spec §6): keep the one held */
    for (const space of page.scopes || []) {
      const held = await a('spaces').get(space.id);
      await a('spaces').put({ ...space, members: space.members ?? held?.members ?? [] });
    }
    if (Object.keys(detached).length) {
      const held = (await a('meta').get('detached'))?.value as Record<string, number> | undefined;
      for (const [id, at] of Object.entries(held ?? {})) detached[id] = Math.max(detached[id] ?? 0, at);
      await a('meta').put({ key: 'detached', value: detached });
    }
    const changed = wiped.length > 0 || page.changes.length > 0 || (page.scopes?.length ?? 0) > 0;
    const cursors = (await a('meta').get('cursors'))?.value as Record<string, Cursor> | undefined;
    await a('meta').put({ key: 'cursors', value: { ...cursors, ...(page.cursors ?? (page.cursor !== undefined ? { [own]: page.cursor } : {})) } });
    return changed;
  }, 'synced');
}

/* A mark edit not yet uploaded, carried onto the copy of its item you were given (spec §6
   Revocation): each field changed since the edit began; your notes replace your part of the
   copy's notes, which a detach wrote as yours, a blank line, then "Class notes:" and the class's. */
const CARRIED = ['status', 'grade', 'weight', 'notes', 'checklist', 'completedAt'] as const;
const movedSince = (mark: Mark, base: Record<string, unknown>) => (f: keyof Mark) => stable(mark[f]) !== stable(base[f] ?? MARK_DEFAULTS[f]);
function carryMark(copy: Item, mark: Mark, base: Record<string, unknown>, held: SharedItem | undefined): Item {
  const out = { ...copy };
  const moved = movedSince(mark, base);
  if (moved('status')) out.status = mark.status;
  if (moved('grade')) out.grade = mark.grade;
  if (moved('checklist')) out.checklist = mark.checklist;
  if (moved('completedAt')) out.completedAt = mark.completedAt;
  if (moved('weight')) out.weight = mark.weight ?? held?.weight ?? out.weight;
  if (moved('notes')) {
    /* the class's part: what follows your notes as they were, else from its "Class notes:" on */
    const was = typeof base.notes === 'string' ? base.notes : '', rest = copy.notes.slice(was.length), at = copy.notes.indexOf('Class notes:\n');
    const theirs = copy.notes.startsWith(was) ? (was && rest.startsWith('\n\n') ? rest.slice(2) : rest)
      : at === 0 || (at > 0 && copy.notes.slice(at - 2, at) === '\n\n') ? copy.notes.slice(at) : '';
    out.notes = (mark.notes && theirs ? mark.notes + '\n\n' + theirs : mark.notes || theirs).slice(0, 5000);
  }
  return out;
}

/* Your copy of a lost class's item `id`, among the ids a detach may have given it (worker/leaving.js
   `freeIds`): its own, 'k' and its first 23 characters, then 'k', a counter and as much as fits.
   Only a row this detach wrote is one: never one filed under a class, nor one with other facts
   than the class item held; and when the mark was on the server (`base`), only one written after
   it (a detach soft-deletes your mark as it writes the copy). A mark made here with no copy of it
   on the server needs the class item held and its facts, else a row of yours from an earlier leave
   or a Stage 3 copy could take it. And only one written at or after `detached`, the time the
   pull's newest delete of your marks in the space says the detach ran (leaving without a copy
   deletes them too, so an older copy of yours, even one edited since your mark, is never taken).
   Of several, the newest written wins, then the one furthest along: a detach takes the first id
   free, so the rows before it were already yours. */
function copyOf(items: Map<string, Item>, id: string, held: SharedItem | undefined, base: Record<string, unknown> | null, detached: number): Item | null {
  const ids = [id, 'k' + id.slice(0, 23)];
  for (let n = 1; n <= items.size; n++) ids.push('k' + n + id.slice(0, 23 - String(n).length));
  const since = typeof base?.updatedAt === 'number' ? base.updatedAt : 0;
  const rank = (r: Item, at: number) => [r.updatedAt ?? 0, at];
  let best: Item | null = null, bestRank: number[] = [];
  for (const [at, candidate] of ids.entries()) {
    const r = items.get(candidate);
    if (!r || r.classId || (r.updatedAt ?? 0) < detached) continue;
    if (held ? r.type !== held.type || r.title !== held.title || r.date !== held.date : !base) continue;
    if (base && (r.updatedAt ?? 0) <= since) continue;
    const k = rank(r, at), i = k.findIndex((v, j) => v !== bestRank[j]);
    if (!best || (i >= 0 && k[i] > bestRank[i])) { best = r; bestRank = k; }
  }
  return best;
}

/**
 * Take away what this device holds of scopes it may no longer read (sync's `revoked`,
 * applied after the cycle's last page): their shared rows (removed ones too), their space,
 * their cursor, and your marks and prefs there. A mark edit still waiting is carried onto
 * your copy of the item when one came; any other pending edit stays queued and, refused
 * with 404, moves to the saved copies, so nothing is silently thrown away (spec §6 Revocation).
 * Runs after every complete pull: it forgets the deletes of your marks the pull saw (`detached`).
 */
export async function applyRevoked(scopes: string[]): Promise<boolean> {
  if (!scopes.length) {
    if (await meta.get('detached')) await mutate((a) => a('meta').del('detached'), 'synced');
    return false;
  }
  return mutate(async (a) => {
    const lost = new Set(scopes.map((s) => s.slice(2)));
    const detached = ((await a('meta').get('detached'))?.value ?? {}) as Record<string, number>;
    await a('meta').del('detached');
    const items = new Map((await a('items').all()).map((r) => [r.id, r]));
    const classItems = new Map((await a('shared_items').all()).filter((r) => scopes.includes(r.scope)).map((r) => [`${r.scope.slice(2)}:${r.id}`, r]));
    for (const op of await a('pending').all()) {
      if (!op.key.startsWith('marks:') || op.op !== 'put' || !op.body) continue;
      const mark = op.body as unknown as Mark;
      if (!lost.has(mark.spaceId)) continue;
      const base = (op.base ?? null) as Record<string, unknown> | null;
      /* an edit that changed nothing a copy holds ("not mine" alone) has nothing to carry */
      if (CARRIED.some(movedSince(mark, base ?? {}))) {
        const held = classItems.get(`${mark.spaceId}:${mark.itemId}`);
        /* no delete of your marks there in the pull: nothing says a copy was written now */
        const copy = detached[mark.spaceId] === undefined ? null : copyOf(items, mark.itemId, held, base, detached[mark.spaceId]);
        if (!copy) continue;
        const moved = carryMark(copy, mark, base ?? {}, held);
        await a('items').put(moved);
        items.set(moved.id, moved);
        await queue(a, `items:${moved.id}`, 'put', moved as unknown as Row);
      }
      await a('pending').del(op.key);
      await a('marks').del(mark.id);
    }
    for (const m of await a('marks').all()) if (lost.has(m.spaceId) && !(await a('pending').get(`marks:${m.id}`))) await a('marks').del(m.id);
    for (const p of await a('space_prefs').all()) if (lost.has(p.spaceId) && !(await a('pending').get(`space_prefs:${p.id}`))) await a('space_prefs').del(p.id);
    for (const s of SHARED_STORES) for (const row of await a(s).all()) if (scopes.includes(row.scope)) await a(s).del([row.scope, row.id]);
    for (const space of await a('spaces').all()) if (scopes.includes(space.scope)) await a('spaces').del(space.id);
    const cursors = { ...((await a('meta').get('cursors'))?.value as Record<string, Cursor> | undefined) };
    for (const s of scopes) delete cursors[s];
    await a('meta').put({ key: 'cursors', value: cursors });
    return true;
  }, 'synced');
}

/** The highest space revision this device holds: sync's `sv`. */
export const spaceRevision = (): number => Math.max(0, ...data.spaces.map((s) => s.revision));
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
      /* a shared copy restored merges against the server's row as it now is */
      const merges = !!parseKey(conflict.key).scope || conflict.key.startsWith('marks:');
      await queue(a, conflict.key, conflict.op, body, merges ? (current as Row | undefined) ?? null : undefined);
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
