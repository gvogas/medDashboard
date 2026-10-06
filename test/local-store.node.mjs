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
