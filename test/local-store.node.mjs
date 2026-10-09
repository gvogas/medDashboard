import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { openDb, deleteDb } from '../src/core/db.ts';
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) || null, setItem: (k,v) => storage.set(k,v), removeItem: (k) => storage.delete(k) };
// Connections, rather than broadcasts, exercise the shared transaction boundary.
globalThis.BroadcastChannel = undefined;
const first = await import('../src/core/store.ts?first');
const second = await import('../src/core/store.ts?second');
let counter = 0;
const p = () => ({ id: 'test-' + ++counter, username: 'tester', revision: 1, coat: {} });
afterEach(async () => { await first.close(); await second.close(); });

test('row and pending operation roll back together', async () => {
 const db = await openDb('rollback');
 await assert.rejects(db.transaction(['items', 'pending'], 'readwrite', async (a) => {
   await a('items').put({ id: 'x', title: 'Never committed' });
   await a('pending').put({ key: 'items:x' });
   throw new Error('simulated interruption');
 }));
 assert.equal(await db.get('items', 'x'), undefined);
 assert.equal(await db.get('pending', 'items:x'), undefined);
 db.close();
});
test('two connections preserve independent queued edits', async () => {
 const user = p(); await first.open(user); await second.open(user);
 await Promise.all([first.saveItem({ id: 'a', title: 'A' }), second.saveItem({ id: 'b', title: 'B' })]);
 assert.deepEqual((await first.pending()).map((op) => op.key).sort(), ['items:a','items:b']);
 await first.reload(); assert.equal(first.data.items.length, 2);
});
test('an edit made during upload survives acknowledgement and gets the new revision', async () => {
 await first.open(p());
 await first.saveItem({ id: 'a', title: 'First', revision: 1 });
 const [sent] = await first.pending();
 await first.saveItem({ id: 'a', title: 'Second', revision: 1 });
 await first.settleOperation(sent, { ...sent.body, revision: 2 });
 const [pending] = await first.pending();
 assert.equal(pending.body.title, 'Second'); assert.equal(pending.revision, 2);
 assert.equal(first.item('a').title, 'Second');
 assert.equal(first.item('a').revision, 2);
});
test('another tab editing the same pending record preserves the first copy', async () => {
 const user = p(); await first.open(user); await second.open(user);
 await first.saveItem({ id: 'a', title: 'First' });
 await second.saveItem({ id: 'a', title: 'Second' });
 assert.equal(second.conflicts[0].body.title, 'First');
 assert.equal((await second.pending())[0].body.title, 'Second');
});
test('full reconciliation removes stale clean rows but preserves pending work', async () => {
 await first.open(p());
 await first.applyPage({ changes: [{ kind: 'items', row: { id:'old', title:'Deleted remotely', revision:1 } }], cursor:1 });
 await first.saveItem({ id:'pending', title:'Offline work' });
 await first.applyPage({ changes: [], cursor: 50 }, true);
 assert.equal(first.item('old'), null); assert.equal(first.item('pending').title, 'Offline work');
});
test('conflict remains recoverable after closing and reopening', async () => {
 const user = p(); await first.open(user);
 await first.saveItem({ id:'a', title:'My work', revision:1 });
 const [op] = await first.pending();
 await first.rejectOperation(op, { id:'a', title:'Other device', revision:2 }, 'Conflict');
 await first.close(); await first.open(user);
 assert.equal(first.conflicts[0].body.title, 'My work');
 await first.resolveConflict(first.conflicts[0].id, true);
 const [retry] = await first.pending(); assert.equal(retry.revision, 2); assert.equal(retry.body.title, 'My work');
});

test('restoring a saved copy builds on the latest locally known server revision', async () => {
 await first.open(p());
 await first.saveItem({ id: 'a', title: 'My work', revision: 1 });
 const [op] = await first.pending();
 await first.rejectOperation(op, { id: 'a', title: 'Other device', revision: 2 }, 'Conflict');
 await first.applyPage({ changes: [{ kind: 'items', row: { id: 'a', title: 'Latest', revision: 3 } }], cursor: 3 });
 await first.resolveConflict(first.conflicts[0].id, true);
 const [retry] = await first.pending();
 assert.equal(retry.revision, 3);
 assert.equal(retry.body.title, 'My work');
});

test('editing a legacy pending record does not remove its review requirement', async () => {
 const user = p(); await first.open(user);
 const db = await openDb(`rounds:${user.id}`);
 await db.put('pending', { key: 'items:a', op: 'put', body: { id: 'a', title: 'Legacy' }, revision: 0, reviewRequired: true, token: 'legacy', owner: 'migration' });
 db.close();
 await first.saveItem({ id: 'a', title: 'Still needs review' });
 assert.equal((await first.pending())[0].reviewRequired, true);
});
test('version 1 migration keeps the old dirty map and row in the new queue', async () => {
 const user=p(), name=`rounds:${user.id}`;
 await new Promise((resolve,reject) => {
  const request=indexedDB.open(name,1);
  request.onupgradeneeded=()=>{ for(const kind of ['items','courses','quotes','meta']) request.result.createObjectStore(kind,{keyPath:kind==='meta'?'key':'id'}); };
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{
   const db=request.result, tx=db.transaction(['items','meta'],'readwrite');
   tx.objectStore('items').put({id:'a',title:'Old unsynced edit'});
   tx.objectStore('meta').put({key:'dirty',value:{'items:a':'put'}});
   tx.oncomplete=()=>{db.close();resolve();};
  };
 });
 await first.open(user);
 const [op]=await first.pending(); assert.equal(op.body.title,'Old unsynced edit'); assert.equal(op.revision,0);
});
test('versionchange closes another connection before wipe resolves', async () => {
 const user=p(); await first.open(user); await second.open(user);
 await first.saveItem({id:'a',title:'Private'});
 await first.wipe(user.id);
 const db=await openDb(`rounds:${user.id}`);
 assert.deepEqual(await db.all('items'),[]); db.close();
});

test('blocked database deletion is reported as a failure, not success', async () => {
 const name='blocked-wipe';
 const connection=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try { await assert.rejects(deleteDb(name), /Close other Term tabs/); }
 finally { connection.close(); }
});
test('saveRows writes many rows and their pending operations in one change', async () => {
 await first.open(p());
 const events = [];
 const off = first.subscribe((e) => events.push(e.type));
 await first.saveRows([{ kind: 'courses', row: { id: 'c1', code: 'C1', name: 'One' } }, { kind: 'items', row: { id: 'a', title: 'A', courseId: 'c1' } }, { kind: 'items', row: { id: 'b', title: 'B' } }]);
 off();
 assert.deepEqual(events, ['change']);
 assert.deepEqual((await first.pending()).map((op) => op.key).sort(), ['courses:c1', 'items:a', 'items:b']);
 assert.equal(first.item('a').title, 'A');
 assert.equal(first.course('c1').name, 'One');
});
test('lookups by id follow reloads', async () => {
 await first.open(p());
 await first.saveItem({ id: 'x', title: 'Old' });
 await first.saveItem({ id: 'x', title: 'New' });
 assert.equal(first.item('x').title, 'New');
 assert.equal(first.item('missing'), null);
});
test('clearing a stored item\'s title keeps the old one, so the server never refuses it', async () => {
 await first.open(p());
 await first.saveItem({ id: 'a', title: 'Anatomy essay' });
 await first.saveItem({ id: 'a', title: '   ' });
 assert.equal(first.item('a').title, 'Anatomy essay');
 assert.equal((await first.pending())[0].body.title, 'Anatomy essay');
 await first.saveItem({ id: 'b', title: '' });
 assert.equal(first.item('b').title, 'Untitled');
});
test('a quiet rejection takes the server copy without saving a conflict', async () => {
 await first.open(p());
 await first.saveItem({ id: 'rv0000abc1', title: 'Review 1/4 · X' });
 const [op] = await first.pending();
 await first.rejectOperation(op, { id: 'rv0000abc1', title: 'Review 1/4 · X', revision: 3, deletedAt: 5 }, '', { quiet: true });
 assert.equal(first.conflicts.length, 0);
 assert.equal(first.item('rv0000abc1'), null);
 assert.equal((await first.pending()).length, 0);
});
test('a reloaded tab editing its own unsynced record saves no conflict copy', async () => {
 const tab = new Map();
 globalThis.sessionStorage = { getItem: (k) => tab.get(k) || null, setItem: (k, v) => tab.set(k, v) };
 const before = await import('../src/core/store.ts?before-reload');
 const after = await import('../src/core/store.ts?after-reload');
 delete globalThis.sessionStorage;
 const user = p();
 await before.open(user);
 await before.saveItem({ id: 'a', title: 'Offline edit' });
 await before.close();
 await after.open(user);
 await after.saveItem({ id: 'a', title: 'Edited again after reload' });
 assert.equal(after.conflicts.length, 0);
 await after.close();
});
test('version 4 upgrade keeps pending edits and moves the cursor to the person\'s own scope', async () => {
 const user = p(), name = `rounds:${user.id}`;
 await new Promise((resolve, reject) => {
  const request = indexedDB.open(name, 4);
  request.onupgradeneeded = () => { for (const s of ['courses', 'items', 'quotes', 'study_sessions', 'achievements', 'meta', 'pending', 'conflicts']) request.result.createObjectStore(s, { keyPath: ['meta', 'pending'].includes(s) ? 'key' : 'id' }); };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
   const db = request.result, tx = db.transaction(['items', 'meta', 'pending'], 'readwrite');
   tx.objectStore('items').put({ id: 'a', title: 'Unsent', revision: 3 });
   tx.objectStore('pending').put({ key: 'items:a', op: 'put', body: { id: 'a', title: 'Unsent', revision: 3 }, revision: 3, reviewRequired: false, token: 't', owner: 'old-tab' });
   tx.objectStore('meta').put({ key: 'syncCursor', value: 812 });
   tx.oncomplete = () => { db.close(); resolve(); };
  };
 });
 await first.open(user);
 assert.deepEqual((await first.pending()).map((op) => op.key), ['items:a']);
 assert.deepEqual(await first.meta.get('cursors'), { [`u:${user.id}`]: 812 });
 assert.equal(await first.meta.get('syncCursor'), undefined);
 assert.equal(first.item('a').title, 'Unsent');
});

const WEB = 'c:abcdefghij12', LAB = 'c:bbbbbbbbbbb2';
const webSpace = (over = {}) => ({ id: 'abcdefghij12', scope: WEB, kind: 'class', role: 'member', archived: false, name: 'Web', parent: null, revision: 6, ...over });

test('a v3 page files shared rows by scope beside a personal row with the same id; revoking the space removes them', async () => {
 const user = p(); await first.open(user);
 const own = `u:${user.id}`;
 await first.applyPage({ cursors: { [own]: 5, [WEB]: 6 }, scopes: [webSpace({ members: [{ userId: 'g', name: 'Gabriel', role: 'owner' }] })], changes: [
  { scope: own, kind: 'items', row: { id: 'a', title: 'Mine', revision: 4 } },
  { scope: WEB, kind: 'items', row: { id: 'a', title: 'Class', courseId: 'web', revision: 5 } },
  { scope: WEB, kind: 'courses', row: { id: 'web', code: 'WEB', name: 'Web', revision: 6 } },
 ] });
 assert.equal(first.item('a').title, 'Mine');
 assert.deepEqual(first.data.shared_items.map((r) => [r.scope, r.id, r.title]), [[WEB, 'a', 'Class']]);
 assert.deepEqual(first.data.shared_courses.map((r) => [r.scope, r.id]), [[WEB, 'web']]);
 assert.equal(first.spaceRevision(), 6);
 assert.deepEqual(await first.meta.get('cursors'), { [own]: 5, [WEB]: 6 });
 /* a page without the member list keeps the one held */
 await first.applyPage({ cursors: { [WEB]: 'r7.40' }, scopes: [webSpace()], changes: [] });
 assert.equal(first.data.spaces[0].members[0].name, 'Gabriel');
 /* a resync's tagged cursor is kept as it came, to go back on the next page */
 assert.deepEqual(await first.meta.get('cursors'), { [own]: 5, [WEB]: 'r7.40' });
 await first.applyRevoked([WEB]);
 assert.deepEqual([first.data.shared_items, first.data.shared_courses, first.data.spaces], [[], [], []]);
 assert.deepEqual(await first.meta.get('cursors'), { [own]: 5 });
 assert.equal(first.item('a').title, 'Mine');
});

test('a shared edit queues under its scope with the row it started from', async () => {
 await first.open(p());
 await first.applyPage({ cursors: {}, changes: [{ scope: WEB, kind: 'items', row: { id: 'x', title: 'Old', date: '2026-10-15', courseId: 'web', revision: 7 } }] });
 const [stored] = first.data.shared_items;
 await first.saveShared('shared_items', { ...stored, title: 'New' });
 await first.saveShared('shared_items', { ...stored, title: 'Newer' });
 const [op] = await first.pending();
 assert.equal(op.key, `shared_items:${WEB}:x`);
 assert.equal(op.base.title, 'Old'); assert.equal(op.body.title, 'Newer'); assert.equal(op.revision, 7);
 /* a page cannot overwrite a row with a pending edit */
 await first.applyPage({ cursors: {}, changes: [{ scope: WEB, kind: 'items', row: { ...stored, title: 'Server', revision: 8 } }] });
 assert.equal(first.data.shared_items[0].title, 'Newer');
 await first.settleOperation(op, { ...op.body, scope: WEB, revision: 9 });
 assert.equal(first.data.shared_items[0].revision, 9);
 assert.deepEqual(await first.pending(), []);
 await first.removeShared('shared_items', WEB, 'x');
 assert.deepEqual(first.data.shared_items, []);
 assert.deepEqual((await first.pending()).map((o) => [o.key, o.op]), [[`shared_items:${WEB}:x`, 'delete']]);
});

test('a reset of one space wipes only that space\'s clean rows', async () => {
 await first.open(p());
 await first.applyPage({ cursors: {}, changes: [
  { scope: WEB, kind: 'items', row: { id: 'a', title: 'Web A', revision: 1 } },
  { scope: WEB, kind: 'items', row: { id: 'b', title: 'Web B', revision: 1 } },
  { scope: LAB, kind: 'items', row: { id: 'a', title: 'Lab A', revision: 1 } },
  { kind: 'items', row: { id: 'a', title: 'Mine', revision: 1 } },
 ] });
 await first.saveShared('shared_items', { ...first.data.shared_items.find((r) => r.scope === WEB && r.id === 'b'), title: 'Offline' });
 await first.applyPage({ cursors: { [WEB]: 9 }, changes: [] }, [WEB]);
 assert.deepEqual(first.data.shared_items.map((r) => `${r.scope}/${r.id}:${r.title}`).sort(), [`${WEB}/b:Offline`, `${LAB}/a:Lab A`]);
 assert.equal(first.item('a').title, 'Mine');
});

test('a page that only moves a space is reported as a change', async () => {
 await first.open(p());
 assert.equal(await first.applyPage({ cursors: {}, changes: [], scopes: [webSpace()] }), true);
 assert.equal(await first.applyPage({ cursors: {}, changes: [] }), false);
});
test('the profile keeps maintenance only as the server can mean it, and an acknowledged edit keeps it', async () => {
 const user = { ...p(), maintenance: { features: ['week', 'bogus'], message: 'Soon', updatedAt: 1 }, announcement: { id: 1, text: 'Hi', until: 9e15 } };
 await first.open(user); await first.reload();
 assert.deepEqual(first.data.profile.maintenance, { features: ['week'], message: 'Soon', updatedAt: 1 });
 await first.applyServerProfile({ ...user, revision: 1, maintenance: 'everything' });
 assert.equal(first.data.profile.maintenance, null);
 await first.applyServerProfile({ ...user, revision: 1 });
 await first.saveProfile({ displayName: 'New' });
 const [sent] = await first.pending();
 /* PUT /api/me answers the profile alone: the switches stay until the pull after it */
 await first.settleOperation(sent, { id: user.id, username: 'tester', displayName: 'New', revision: 2, coat: {} });
 assert.deepEqual(first.data.profile.maintenance, { features: ['week'], message: 'Soon', updatedAt: 1 });
 assert.equal(first.data.profile.announcement.text, 'Hi');
 assert.equal(first.data.profile.displayName, 'New');
});

test('version 5 upgrade adds your marks and space prefs, and keeps pending edits', async () => {
 const user = p(), name = `rounds:${user.id}`;
 await new Promise((resolve, reject) => {
  const request = indexedDB.open(name, 5);
  request.onupgradeneeded = () => {
   for (const s of ['courses', 'items', 'quotes', 'study_sessions', 'achievements', 'shared_courses', 'shared_items', 'spaces', 'meta', 'pending', 'conflicts']) {
    request.result.createObjectStore(s, { keyPath: ['meta', 'pending'].includes(s) ? 'key' : s.startsWith('shared_') ? ['scope', 'id'] : 'id' });
   }
  };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
   const db = request.result, tx = db.transaction(['items', 'pending'], 'readwrite');
   tx.objectStore('items').put({ id: 'a', title: 'Unsent', revision: 3 });
   tx.objectStore('pending').put({ key: 'items:a', op: 'put', body: { id: 'a', title: 'Unsent', revision: 3 }, revision: 3, reviewRequired: false, token: 't', owner: 'old-tab' });
   tx.oncomplete = () => { db.close(); resolve(); };
  };
 });
 await first.open(user);
 assert.deepEqual((await first.pending()).map((op) => op.key), ['items:a']);
 assert.deepEqual([first.data.marks, first.data.space_prefs], [[], []]);
});

test('pages bring your marks and prefs; a mark queues with the mark it started from, prefs whole', async () => {
 const user = p(); await first.open(user);
 const own = `u:${user.id}`, id = 'abcdefghij12:a1';
 await first.applyPage({ cursors: { [own]: 4 }, changes: [
  { scope: own, kind: 'marks', row: { id, spaceId: 'abcdefghij12', itemId: 'a1', status: 'todo', notes: 'old', revision: 3 } },
  { scope: own, kind: 'space_prefs', row: { id: 'abcdefghij12', spaceId: 'abcdefghij12', color: '#4F74D9', term: 'Fall', revision: 4 } },
 ] });
 assert.deepEqual(first.data.marks.map((m) => [m.id, m.notes, m.hidden, m.checklist]), [[id, 'old', false, []]]);
 assert.deepEqual(first.data.space_prefs.map((x) => [x.id, x.color, x.archived]), [['abcdefghij12', '#4F74D9', false]]);
 await first.saveMark({ ...first.data.marks[0], notes: 'new' });
 await first.saveMark({ ...first.data.marks[0], status: 'done' });
 const [op] = await first.pending();
 assert.equal(op.key, `marks:${id}`);
 assert.equal(op.base.notes, 'old'); assert.equal(op.body.notes, 'new'); assert.equal(op.body.status, 'done'); assert.equal(op.revision, 3);
 await first.saveSpacePref({ ...first.data.space_prefs[0], archived: true });
 const pref = (await first.pending()).find((o) => o.key === 'space_prefs:abcdefghij12');
 assert.equal(pref.body.archived, true); assert.equal(pref.base, undefined);
 /* items keep their class label; the profile its hidden sources */
 await first.saveItem({ id: 'f1', title: 'Extra quiz', classId: 'abcdefghij12' });
 assert.equal(first.item('f1').classId, 'abcdefghij12');
 await first.saveProfile({ hiddenSources: ['personal'] });
 assert.deepEqual(first.data.profile.hiddenSources, ['personal']);
});

/* a recent deletion: one past the tombstone time leaves the device */
const NOW = Date.now();
test('a removed class item stays as a tombstone, apart from the live ones, and a restore revives it', async () => {
 await first.open(p());
 await first.applyPage({ cursors: {}, changes: [{ scope: WEB, kind: 'items', row: { id: 'x', title: 'Lab 3', revision: 4 } }] });
 await first.applyPage({ cursors: {}, changes: [{ scope: WEB, kind: 'items', row: { id: 'x', title: 'Lab 3', revision: 5, deletedAt: NOW + 77, updatedBy: 'u-alex' } }] });
 assert.deepEqual(first.data.shared_items, []);
 assert.deepEqual(first.data.removed_items.map((r) => [r.id, r.deletedAt, r.updatedBy]), [['x', NOW + 77, 'u-alex']]);
 await first.restoreShared(WEB, 'x');
 assert.deepEqual(first.data.shared_items.map((r) => [r.id, r.deletedAt]), [['x', null]]);
 assert.deepEqual(first.data.removed_items, []);
 const [op] = await first.pending();
 assert.equal(op.key, `shared_items:${WEB}:x`); assert.equal(op.base.deletedAt, NOW + 77); assert.equal(op.revision, 5);
 /* a course's tombstone still goes */
 await first.applyPage({ cursors: {}, changes: [{ scope: WEB, kind: 'courses', row: { id: 'web', code: 'WEB', revision: 1 } }] });
 await first.applyPage({ cursors: {}, changes: [{ scope: WEB, kind: 'courses', row: { id: 'web', code: 'WEB', revision: 2, deletedAt: 9 } }] });
 assert.deepEqual(first.data.shared_courses, []);
});

test('losing a class drops your layer there and carries a waiting mark edit onto your copy', async () => {
 const user = p(); await first.open(user);
 const own = `u:${user.id}`, sid = 'abcdefghij12';
 await first.applyPage({ cursors: { [own]: 3 }, changes: [
  { scope: own, kind: 'marks', row: { id: sid + ':a1', spaceId: sid, itemId: 'a1', notes: 'old', grade: 70, revision: 2, updatedAt: 10 } },
  { scope: own, kind: 'marks', row: { id: sid + ':q1', spaceId: sid, itemId: 'q1', hidden: true, revision: 2, updatedAt: 10 } },
  { scope: own, kind: 'space_prefs', row: { id: sid, spaceId: sid, color: '#4F74D9', revision: 2 } },
 ] });
 await first.saveMark({ ...first.data.marks.find((m) => m.itemId === 'a1'), notes: 'new', grade: 91 });
 /* the copy arrives in your own scope on the same sync, then the class is revoked */
 await first.applyPage({ cursors: { [own]: 9 }, changes: [
  { scope: own, kind: 'items', row: { id: 'a1', title: 'Lab', courseId: 'web', notes: 'old\n\nClass notes:\nBring a laptop', grade: 70, revision: 1, updatedAt: 20 } },
 ] });
 await first.applyRevoked([WEB]);
 assert.equal(first.item('a1').notes, 'new\n\nClass notes:\nBring a laptop');
 assert.equal(first.item('a1').grade, 91);
 assert.deepEqual((await first.pending()).map((o) => o.key), ['items:a1']);
 assert.deepEqual([first.data.marks, first.data.space_prefs], [[], []]);
});

test('a waiting mark edit finds your copy under a k id, past a row of yours that had the id, and keeps the class notes apart', async () => {
 const user = p(); await first.open(user);
 const own = `u:${user.id}`, sid = 'abcdefghij12';
 await first.applyPage({ cursors: { [own]: 3, [WEB]: 4 }, changes: [
  { scope: WEB, kind: 'items', row: { id: 'a1', type: 'lab', title: 'Lab', date: '2026-10-15', notes: 'Bring a laptop', revision: 1 } },
  { scope: own, kind: 'items', row: { id: 'a1', type: 'lab', title: 'Lab', date: '2026-10-15', revision: 1 } },
  { scope: own, kind: 'items', row: { id: 'ka1', type: 'lab', title: 'Lab', date: '2026-10-15', notes: 'Kept last time', revision: 1 } },
  { scope: own, kind: 'marks', row: { id: sid + ':a1', spaceId: sid, itemId: 'a1', revision: 2, updatedAt: 10 } },
 ] });
 await first.saveMark({ ...first.data.marks[0], notes: 'mine' });
 /* a1 and ka1 were live, so the copy took k1a1 */
 await first.applyPage({ cursors: { [own]: 9 }, changes: [
  { scope: own, kind: 'items', row: { id: 'k1a1', type: 'lab', title: 'Lab', date: '2026-10-15', notes: 'Class notes:\nBring a laptop', revision: 1, updatedAt: 50 } },
 ] });
 await first.applyRevoked([WEB]);
 assert.equal(first.item('k1a1').notes, 'mine\n\nClass notes:\nBring a laptop');
 assert.equal(first.item('ka1').notes, 'Kept last time');
 assert.deepEqual((await first.pending()).map((o) => o.key), ['items:k1a1']);
 assert.deepEqual(first.data.marks, []);
});

test('a waiting mark edit with no copy stays queued; a lost class\'s removed items go too', async () => {
 const user = p(); await first.open(user);
 const own = `u:${user.id}`, sid = 'abcdefghij12';
 await first.applyPage({ cursors: { [own]: 3 }, changes: [
  { scope: WEB, kind: 'items', row: { id: 'r1', title: 'Gone', revision: 2, deletedAt: 5 } },
  { scope: own, kind: 'marks', row: { id: sid + ':a1', spaceId: sid, itemId: 'a1', revision: 2, updatedAt: 10 } },
 ] });
 await first.saveMark({ ...first.data.marks[0], notes: 'mine' });
 await first.applyRevoked([WEB]);
 assert.deepEqual((await first.pending()).map((o) => o.key), [`marks:${sid}:a1`]);
 assert.equal(first.data.marks.length, 1);
 assert.deepEqual(first.data.removed_items, []);
});

test('a waiting mark edit never lands on an older row of yours that only shares the id', async () => {
 const user = p(); await first.open(user);
 const own = `u:${user.id}`, sid = 'abcdefghij12';
 await first.applyPage({ cursors: { [own]: 3 }, changes: [
  /* kept from an earlier leave; this time you left without a copy */
  { scope: own, kind: 'items', row: { id: 'a1', title: 'Lab', notes: 'My precious notes from last term', grade: 50, revision: 1, updatedAt: 5 } },
  { scope: own, kind: 'marks', row: { id: sid + ':a1', spaceId: sid, itemId: 'a1', notes: 'old', revision: 2, updatedAt: 10 } },
 ] });
 await first.saveMark({ ...first.data.marks[0], notes: 'new', grade: 91 });
 /* a mark made here, never uploaded, with the class item not held */
 await first.saveMark({ id: sid + ':ka1', spaceId: sid, itemId: 'ka1', notes: 'offline' });
 await first.applyPage({ cursors: { [own]: 4 }, changes: [{ scope: own, kind: 'items', row: { id: 'kka1', title: 'Other', revision: 1, updatedAt: 30 } }] });
 await first.applyRevoked([WEB]);
 assert.deepEqual([first.item('a1').notes, first.item('a1').grade], ['My precious notes from last term', 50]);
 assert.equal(first.item('kka1').title, 'Other');
 assert.deepEqual((await first.pending()).map((o) => o.key).sort(), [`marks:${sid}:a1`, `marks:${sid}:ka1`]);
});

test('a waiting edit that only hides a lost class item carries nothing and goes', async () => {
 const user = p(); await first.open(user);
 const own = `u:${user.id}`, sid = 'abcdefghij12';
 await first.applyPage({ cursors: { [own]: 3 }, changes: [
  { scope: own, kind: 'marks', row: { id: sid + ':a1', spaceId: sid, itemId: 'a1', revision: 2, updatedAt: 10 } },
  { scope: own, kind: 'items', row: { id: 'a1', title: 'Lab', revision: 1, updatedAt: 20 } },
 ] });
 await first.saveMark({ ...first.data.marks[0], hidden: true });
 await first.applyRevoked([WEB]);
 assert.deepEqual(await first.pending(), []);
 assert.deepEqual(first.data.marks, []);
 assert.equal(first.item('a1').revision, 1);
});

test('a shared edit refused by a class item\'s tombstone keeps it as removed; a project\'s goes', async () => {
 await first.open(p());
 const PRJ = 'p:cccccccccccc';
 await first.applyPage({ cursors: {}, changes: [
  { scope: WEB, kind: 'items', row: { id: 'x', title: 'Lab 3', revision: 4 } },
  { scope: WEB, kind: 'items', row: { id: 'y', title: 'Lab 4', revision: 2, deletedAt: NOW + 70 } },
  { scope: PRJ, kind: 'items', row: { id: 't', title: 'Task', revision: 1 } },
 ] });
 /* edit against delete */
 await first.saveShared('shared_items', { ...first.data.shared_items.find((r) => r.id === 'x'), title: 'Mine' });
 let [op] = await first.pending();
 await first.rejectOperation(op, { id: 'x', title: 'Lab 3', revision: 5, deletedAt: NOW + 77, updatedBy: 'u-alex' }, 'Deleted');
 assert.deepEqual(first.data.removed_items.map((r) => [r.scope, r.id, r.title, r.deletedAt]).sort(), [[WEB, 'x', 'Lab 3', NOW + 77], [WEB, 'y', 'Lab 4', NOW + 70]]);
 /* a restore refused */
 await first.restoreShared(WEB, 'y');
 [op] = await first.pending();
 await first.rejectOperation(op, { id: 'y', title: 'Lab 4', revision: 3, deletedAt: NOW + 71 }, 'Refused');
 assert.equal(first.data.removed_items.find((r) => r.id === 'y').deletedAt, NOW + 71);
 assert.deepEqual(first.data.shared_items.filter((r) => r.scope === WEB), []);
 /* a 404 still drops it */
 await first.restoreShared(WEB, 'y');
 [op] = await first.pending();
 await first.rejectOperation(op, null, 'Gone');
 assert.deepEqual(first.data.removed_items.map((r) => r.id), ['x']);
 /* a project's tombstone is not kept, from a refusal or a page */
 await first.saveShared('shared_items', { ...first.data.shared_items.find((r) => r.id === 't'), title: 'Mine' });
 [op] = await first.pending();
 await first.rejectOperation(op, { id: 't', title: 'Task', revision: 2, deletedAt: 9 }, 'Deleted');
 await first.applyPage({ cursors: {}, changes: [{ scope: PRJ, kind: 'items', row: { id: 'u', title: 'Other', revision: 1, deletedAt: 9 } }] });
 assert.deepEqual(first.data.removed_items.map((r) => r.scope), [WEB]);
 assert.deepEqual(first.data.shared_items, []);
});

test('a removed item past the tombstone time leaves the device, unless your mark holds something', async () => {
 const user = p(); await first.open(user);
 const own = `u:${user.id}`, sid = 'abcdefghij12', old = Date.now() - 31 * 24 * 60 * 60 * 1000;
 await first.applyPage({ cursors: {}, changes: [
  { scope: WEB, kind: 'items', row: { id: 'x', title: 'Old', revision: 2, deletedAt: old } },
  { scope: WEB, kind: 'items', row: { id: 'y', title: 'Graded', revision: 2, deletedAt: old } },
  { scope: WEB, kind: 'items', row: { id: 'z', title: 'Hidden only', revision: 2, deletedAt: old } },
  { scope: WEB, kind: 'items', row: { id: 'w', title: 'Recent', revision: 2, deletedAt: Date.now() - 1000 } },
  { scope: own, kind: 'marks', row: { id: sid + ':y', spaceId: sid, itemId: 'y', grade: 88, revision: 1 } },
  { scope: own, kind: 'marks', row: { id: sid + ':z', spaceId: sid, itemId: 'z', hidden: true, revision: 1 } },
 ] });
 assert.deepEqual(first.data.removed_items.map((r) => r.id).sort(), ['w', 'y']);
 /* gone from the store, not only from the list: a mark arriving later does not bring it back */
 await first.applyPage({ cursors: {}, changes: [{ scope: own, kind: 'marks', row: { id: sid + ':x', spaceId: sid, itemId: 'x', notes: 'late', revision: 1 } }] });
 assert.deepEqual(first.data.removed_items.map((r) => r.id).sort(), ['w', 'y']);
});
