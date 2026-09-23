import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { signIn, BASE } from './helpers.js';
import { purgeTombstones } from '../worker/db.js';
const quote = (text) => ({ text, source: '' });
describe('revision and sequence protocol', () => {
 it('rejects a request tied to a different account after a cookie switch', async () => {
  const api=await signIn();
  const response=await api('/api/quotes/a',{method:'PUT',body:quote('Wrong account'),headers:{'x-rounds-user':'another-user'}});
  expect(response.status).toBe(401);
  expect((await response.json()).error).toBe('account_changed');
 });
 it('allows only one concurrent writer of the same revision', async () => {
  const api=await signIn();
  const row=await (await api('/api/quotes/a',{method:'PUT',body:quote('original')})).json();
  const results=await Promise.all(['left','right'].map(text=>api('/api/quotes/a',{method:'PUT',body:quote(text),headers:{'if-match':`"${row.revision}"`}})));
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const conflict=await results.find(r=>r.status===409).json();
  expect(conflict.current.revision).toBe(row.revision + 1);
 });
 it('rejects old clients without losing server data', async () => {
  const api=await signIn();
  await api('/api/quotes/a',{method:'PUT',body:quote('saved')});
  const res=await SELF.fetch(BASE+'/api/quotes/a',{method:'PUT',headers:{cookie:api.cookie,'content-type':'application/json'},body:JSON.stringify(quote('old tab'))});
  expect(res.status).toBe(428);
  expect((await (await api('/api/quotes/a')).json()).text).toBe('saved');
 });
 it('does not revive a purged record using an old revision', async () => {
  const api=await signIn();
  const row=await (await api('/api/quotes/a',{method:'PUT',body:quote('old')})).json();
  await api('/api/quotes/a',{method:'DELETE'});
  await purgeTombstones(env.DB,Date.now()+1000);
  const res=await api('/api/quotes/a',{method:'PUT',body:quote('stale'),headers:{'if-match':`"${row.revision}"`}});
  expect(res.status).toBe(409); expect((await res.json()).current).toBeNull();
 });
 it('does not reuse an old revision when a purged ID is recreated', async () => {
  const api=await signIn();
  const first=await (await api('/api/quotes/a',{method:'PUT',body:quote('first')})).json();
  await api('/api/quotes/a',{method:'DELETE'});
  await purgeTombstones(env.DB,Date.now()+1000);
  const second=await (await api('/api/quotes/a',{method:'PUT',body:quote('recreated'),headers:{'if-match':'"0"'}})).json();
  expect(second.revision).toBeGreaterThan(first.revision);
  const stale=await api('/api/quotes/a',{method:'PUT',body:quote('stale'),headers:{'if-match':`"${first.revision}"`}});
  expect(stale.status).toBe(409);
 });
 it('requests reconciliation after deletion history expires', async () => {
  const api=await signIn();
  await api('/api/quotes/a',{method:'PUT',body:quote('old')});
  const first=await (await api('/api/sync?v=2&cursor=0')).json();
  await api('/api/quotes/a',{method:'DELETE'});
  await purgeTombstones(env.DB,Date.now()+1000);
  expect((await (await api(`/api/sync?v=2&cursor=${first.cursor}`)).json()).reset).toBe(true);
  expect((await (await api('/api/sync?v=2&cursor=0')).json()).changes).toEqual([]);
 });
 it('paginates the change feed and isolates accounts', async () => {
  const api=await signIn(); const other=await signIn();
  const me=await (await api('/api/me')).json();
  const now=Date.now();
  await env.DB.batch(Array.from({length:105},(_,i)=>env.DB.prepare('INSERT INTO quotes(user_id,id,text,source,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(me.id,'q'+i,'Quote '+i,'',now,now)));
  await other('/api/quotes/private',{method:'PUT',body:quote('private')});
  const page=await (await api('/api/sync?v=2&cursor=0')).json();
  expect(page.changes).toHaveLength(100); expect(page.more).toBe(true);
  // A record updated between pages moves ahead of the cursor and remains visible.
  await api('/api/quotes/q0');
  await api('/api/quotes/q0',{method:'PUT',body:quote('updated')});
  const next=await (await api(`/api/sync?v=2&cursor=${page.cursor}`)).json();
  expect(next.changes).toHaveLength(6); expect(next.more).toBe(false);
  expect(next.changes.some(c=>c.row.text==='private')).toBe(false);
  expect(next.changes.at(-1).row.text).toBe('updated');
 });
 it('a stale course deletion cannot clear item references', async () => {
  const api=await signIn();
  const course={code:'A',name:'Course',color:'#E4749B',instructor:'',term:'',archived:false,meetings:[]};
  await api('/api/courses/a',{method:'PUT',body:course});
  const { normalizeItem }=await import('../public/js/model.js');
  await api('/api/items/a',{method:'PUT',body:normalizeItem({id:'a',title:'Work',courseId:'a',date:'2026-10-01'})});
  await api('/api/courses/a',{method:'PUT',body:{...course,name:'Changed'}});
  const res=await api('/api/courses/a',{method:'DELETE',headers:{'if-match':'"1"'}});
  expect(res.status).toBe(409);
  expect((await (await api('/api/items/a')).json()).courseId).toBe('a');
 });
});
