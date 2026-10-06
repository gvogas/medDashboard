import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/core/api.ts';
import * as store from '../src/core/store.ts';
import * as sync from '../src/core/sync.ts';
vi.mock('../src/core/store.ts', () => ({
 data: { profile: { id: 'u1' } }, conflicts: [], pending: vi.fn(), pendingCount: vi.fn(() => 0),
 settleOperation: vi.fn(), rejectOperation: vi.fn(), applyPage: vi.fn(), applyServerProfile: vi.fn(),
 applyRevoked: vi.fn(), spaceRevision: vi.fn(() => 0),
 meta: { get: vi.fn(() => 1) }, withSyncLock: vi.fn((fn) => fn()), subscribe: vi.fn(),
}));
const op = { key: 'items:i1', body: { id: 'i1', title: 'Study' }, revision: 1, op: 'put', token: 'a' };
beforeEach(() => {
 vi.useFakeTimers();
 vi.stubGlobal('document', { addEventListener: vi.fn() });
 vi.stubGlobal('window', { addEventListener: vi.fn() });
 sync.init();
 store.data.profile = { id: 'u1' };
 store.pending.mockResolvedValue([op]);
 store.withSyncLock.mockImplementation((fn) => fn());
 vi.spyOn(api, 'put').mockResolvedValue({ ...op.body, revision: 2 });
 vi.spyOn(api, 'syncV3').mockResolvedValue({ changes: [], cursors: { 'u:u1': 1 }, scopes: [], more: false, reset: [], revoked: [] });
 vi.spyOn(api, 'me').mockResolvedValue({ id: 'u1', revision: 1 });
});
afterEach(() => { sync.stop(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('persisted operation synchronization', () => {
 it.each([408, 429, 500, 502, 503])('retains edits on HTTP %s', async (code) => {
   api.put.mockRejectedValue(new ApiError(code, { error: 'unavailable' }));
   expect(await sync.syncNow()).toBe(false);
   expect(store.settleOperation).not.toHaveBeenCalled();
   expect(store.rejectOperation).not.toHaveBeenCalled();
 });
 it('preserves a conflicting edit for review', async () => {
   const current = { id: 'i1', title: 'Newer', revision: 3 };
   api.put.mockRejectedValue(new ApiError(409, { error: 'conflict', current }));
   await sync.syncNow();
   expect(store.rejectOperation).toHaveBeenCalledWith(op, current, expect.any(String));
   expect(store.settleOperation).not.toHaveBeenCalled();
 });
 it('preserves a legacy edit for review without attempting an unconditional write', async () => {
   store.pending.mockResolvedValue([{ ...op, reviewRequired: true }]);
   vi.spyOn(api, 'get').mockRejectedValue(new ApiError(404, { error: 'not_found' }));
   await sync.syncNow();
   expect(api.put).not.toHaveBeenCalled();
   expect(store.rejectOperation).toHaveBeenCalledWith(expect.objectContaining({ reviewRequired: true }), null, expect.stringContaining('before conflict protection'));
 });
 it('acknowledges exactly the uploaded operation', async () => {
   await sync.syncNow();
   expect(store.settleOperation).toHaveBeenCalledWith(op, expect.objectContaining({ revision: 2 }));
 });
 it('follows every page with a cursor per scope, wipes a reset scope on the reset page itself, and revokes after the last page', async () => {
   store.meta.get.mockImplementation(async (key) => (key === 'cursors' ? { 'u:u1': 7, 'c:abcdefghij12': 3 } : undefined));
   const page = (over) => ({ changes: [], scopes: [], more: false, reset: [], revoked: ['c:zzzzzzzzzzzz'], ...over });
   api.syncV3.mockResolvedValueOnce(page({ cursors: { 'u:u1': 9, 'c:abcdefghij12': 0 }, more: true, reset: ['c:abcdefghij12'] }))
     .mockResolvedValueOnce(page({ cursors: { 'u:u1': 12, 'c:abcdefghij12': 10 }, more: true }))
     .mockResolvedValueOnce(page({ cursors: { 'u:u1': 12, 'c:abcdefghij12': 12 } }));
   await sync.syncNow();
   expect(api.syncV3.mock.calls.map(([cursors]) => cursors)).toEqual([
     { 'u:u1': 7, 'c:abcdefghij12': 3 }, { 'u:u1': 9, 'c:abcdefghij12': 0 }, { 'u:u1': 12, 'c:abcdefghij12': 10 }]);
   expect(store.applyPage.mock.calls.map(([, wipe]) => wipe)).toEqual([['c:abcdefghij12'], [], []]);
   expect(store.applyRevoked).toHaveBeenCalledTimes(1);
   expect(store.applyRevoked).toHaveBeenCalledWith(['c:zzzzzzzzzzzz']);
   store.meta.get.mockImplementation(() => 1);
 });
 it("sends a resync's tagged cursor back while the scope is below the floor, and the plain one once past it", async () => {
   store.meta.get.mockImplementation(async (key) => (key === 'cursors' ? {} : undefined));
   const page = (over) => ({ changes: [], scopes: [], more: true, reset: [], revoked: [], ...over });
   api.syncV3.mockResolvedValueOnce(page({ cursors: { 'u:u1': 'r3.9' } }))
     .mockResolvedValueOnce(page({ cursors: { 'u:u1': 'r6.9' } }))
     .mockResolvedValueOnce(page({ cursors: { 'u:u1': 12 }, more: false }));
   await sync.syncNow();
   expect(api.syncV3.mock.calls.map(([cursors]) => cursors)).toEqual([{}, { 'u:u1': 'r3.9' }, { 'u:u1': 'r6.9' }]);
   expect(store.applyPage.mock.calls.at(-1)[0].cursors).toEqual({ 'u:u1': 12 });
   store.meta.get.mockImplementation(() => 1);
 });
 it("sends sv 0 on an account's first sync after the app opens, then the highest space revision held", async () => {
   store.data.profile = { id: 'u9' };
   store.spaceRevision.mockReturnValue(42);
   await sync.syncNow();
   await sync.syncNow();
   expect(api.syncV3.mock.calls.map(([, sv]) => sv)).toEqual([0, 42]);
   store.spaceRevision.mockReturnValue(0);
 });
 it('uploads a shared edit with the fields it changed since it was queued', async () => {
   const shared = { key: 'shared_items:c:abcdefghij12:x', op: 'put', body: { id: 'x', scope: 'c:abcdefghij12', title: 'New', date: '2026-10-18', revision: 4 }, base: { id: 'x', title: 'Old', date: '2026-10-18', revision: 4 }, revision: 4, token: 's' };
   store.pending.mockResolvedValue([shared]);
   vi.spyOn(api.shared, 'put').mockResolvedValue({ ...shared.body, revision: 5 });
   await sync.syncNow();
   expect(api.shared.put).toHaveBeenCalledWith('c:abcdefghij12', 'items', 'x', { ...shared.body, revision: 4 }, { title: 'Old' });
   expect(store.settleOperation).toHaveBeenCalledWith(shared, expect.objectContaining({ revision: 5 }));
 });
 it('wipes a reset scope on the reset page, so a failed next request leaves nothing half done', async () => {
   store.meta.get.mockImplementation(async (key) => (key === 'cursors' ? { 'u:u1': 7, 'c:abcdefghij12': 3 } : undefined));
   api.syncV3.mockResolvedValueOnce({ changes: [], scopes: [], reset: ['c:abcdefghij12'], revoked: [], more: true, cursors: { 'u:u1': 9, 'c:abcdefghij12': 0 } })
     .mockRejectedValueOnce(new ApiError(503, { error: 'unavailable' }));
   await sync.syncNow();
   expect(store.applyPage).toHaveBeenCalledTimes(1);
   expect(store.applyPage.mock.calls[0][1]).toEqual(['c:abcdefghij12']);
   store.meta.get.mockImplementation(() => 1);
 });
 it('wipes the personal scope when its stored cursor is 0 or missing', async () => {
   store.meta.get.mockImplementation(async (key) => (key === 'cursors' ? { 'c:abcdefghij12': 3 } : undefined));
   api.syncV3.mockResolvedValueOnce({ changes: [], scopes: [], reset: [], revoked: [], more: true, cursors: { 'u:u1': 4 } })
     .mockResolvedValueOnce({ changes: [], scopes: [], reset: [], revoked: [], more: false, cursors: { 'u:u1': 5 } });
   await sync.syncNow();
   expect(store.applyPage.mock.calls.map(([, wipe]) => wipe)).toEqual([['u:u1'], []]);
   store.meta.get.mockImplementation(() => 1);
 });
 it.each([['cross_site'], ['rate']])('keeps a personal write that answers 403 %s on the retry path', async (error) => {
   api.put.mockRejectedValue(new ApiError(403, { error }));
   vi.spyOn(api, 'get').mockResolvedValue({ id: 'i1', revision: 1 });
   expect(await sync.syncNow()).toBe(false);
   expect(store.rejectOperation).not.toHaveBeenCalled();
 });
 it('sets a personal write aside on 403 archived', async () => {
   api.put.mockRejectedValue(new ApiError(403, { error: 'archived' }));
   vi.spyOn(api, 'get').mockResolvedValue({ id: 'i1', revision: 1 });
   await sync.syncNow();
   expect(store.rejectOperation).toHaveBeenCalled();
 });
 it('sets a refused shared edit aside at once on 403, saying why', async () => {
   const shared = { key: 'shared_items:c:abcdefghij12:x', op: 'put', body: { id: 'x', title: 'New', revision: 4 }, base: { id: 'x', title: 'Old', revision: 4 }, revision: 4, token: 's' };
   store.pending.mockResolvedValue([shared]);
   vi.spyOn(api.shared, 'put').mockRejectedValue(new ApiError(403, { error: 'forbidden' }));
   vi.spyOn(api.shared, 'get').mockResolvedValue({ id: 'x', title: 'Old', revision: 4 });
   await sync.syncNow();
   expect(store.rejectOperation).toHaveBeenCalledWith(shared, { id: 'x', title: 'Old', revision: 4 }, 'You no longer have permission to change this.');
 });
 it('keeps a shared edit pending while classes are in maintenance, and still uploads and downloads the rest', async () => {
   const shared = { key: 'shared_items:c:abcdefghij12:x', op: 'put', body: { id: 'x', title: 'New', revision: 4 }, base: { id: 'x', title: 'Old', revision: 4 }, revision: 4, token: 'm' };
   store.pending.mockResolvedValue([shared, op]);
   vi.spyOn(api.shared, 'put').mockRejectedValue(new ApiError(503, { error: 'maintenance', feature: 'classes' }));
   for (let cycle = 0; cycle < 4; cycle++) expect(await sync.syncNow()).toBe(true);
   expect(store.settleOperation).toHaveBeenCalledWith(op, expect.objectContaining({ revision: 2 }));
   expect(store.settleOperation).not.toHaveBeenCalledWith(shared, expect.anything());
   expect(store.rejectOperation).not.toHaveBeenCalled();
   expect(api.syncV3).toHaveBeenCalledTimes(4);
   expect(sync.status.message).toContain('being worked on');
   /* asked about again in a minute, not straight away */
   api.syncV3.mockClear();
   await vi.advanceTimersByTimeAsync(30000);
   expect(api.syncV3).not.toHaveBeenCalled();
   await vi.advanceTimersByTimeAsync(31000);
   expect(api.syncV3).toHaveBeenCalled();
 });
 it('keeps a shared delete that answers 404 for review, since it may mean lost access', async () => {
   const gone = { key: 'shared_items:c:abcdefghij12:x', op: 'delete', body: { id: 'x' }, base: { id: 'x' }, revision: 4, token: 'd' };
   store.pending.mockResolvedValue([gone]);
   vi.spyOn(api.shared, 'del').mockRejectedValue(new ApiError(404, { error: 'not_found' }));
   vi.spyOn(api.shared, 'get').mockRejectedValue(new ApiError(404, { error: 'not_found' }));
   await sync.syncNow();
   expect(store.rejectOperation).toHaveBeenCalledWith(gone, null, 'The server could not accept this edit.');
 });
 it('does not sync a closed store', async () => {
   store.data.profile = null;
   expect(await sync.syncNow()).toBe(false);
   expect(api.put).not.toHaveBeenCalled();
 });
 it('does not acknowledge an upload after stop, even after another account resumes', async () => {
   let finish;
   api.put.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
   const running = sync.syncNow();
   await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
   sync.stop();
   store.data.profile = { id: 'u2' };
   sync.init();
   finish({ ...op.body, revision: 2 });
   expect(await running).toBe(false);
   expect(store.settleOperation).not.toHaveBeenCalled();
   expect(api.syncV3).not.toHaveBeenCalled();
   api.put.mockResolvedValue({ ...op.body, revision: 2 });
   expect(await sync.syncNow()).toBe(true);
 });
 it('does not apply a delayed change page after stop', async () => {
   let finish;
   api.syncV3.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
   const pulled = vi.fn(); sync.onPulled(pulled);
   const running = sync.syncNow();
   await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
   sync.stop();
   finish({ changes: [], cursor: 10, more: false });
   expect(await running).toBe(false);
   expect(store.applyPage).not.toHaveBeenCalled();
   expect(api.me).not.toHaveBeenCalled();
   expect(pulled).not.toHaveBeenCalled();
 });
 it('does not apply a delayed profile after stop', async () => {
   let finish;
   api.me.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
   const running = sync.syncNow();
   await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
   sync.stop();
   finish({ id: 'u1', revision: 2 });
   expect(await running).toBe(false);
   expect(store.applyServerProfile).not.toHaveBeenCalled();
 });
 it('handles a failed cross-tab lock without leaking a rejected promise', async () => {
   store.withSyncLock.mockRejectedValue(new Error('Lock unavailable'));
   expect(await sync.syncNow()).toBe(false);
   expect(api.put).not.toHaveBeenCalled();
   expect(sync.status.message).toBe('Lock unavailable');
 });
 it('cancels a queued cross-tab lock so sign-out can drain', async () => {
   store.withSyncLock.mockImplementation((fn, { signal } = {}) => new Promise((resolve, reject) => {
     signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
   }));
   const running = sync.syncNow();
   sync.stop();
   expect(await running).toBe(false);
   await sync.drain();
   expect(api.put).not.toHaveBeenCalled();
 });
 it('uploads the other edits and still downloads while one edit keeps failing', async () => {
   const other = { ...op, key: 'items:i2', body: { id: 'i2', title: 'Other' }, token: 'b' };
   store.pending.mockResolvedValue([op, other]);
   api.put.mockImplementation(async (kind, id, body) => {
     if (id === 'i1') throw new ApiError(500, { error: 'internal' });
     return { ...body, revision: 2 };
   });
   expect(await sync.syncNow()).toBe(false);
   expect(store.settleOperation).toHaveBeenCalledWith(other, expect.objectContaining({ revision: 2 }));
   expect(api.syncV3).toHaveBeenCalled();
   expect(sync.status.state).toBe('error');
   expect(store.rejectOperation).not.toHaveBeenCalled();
 });
 it('sets an edit aside after it fails three cycles with the server otherwise up', async () => {
   const stuck = { ...op, token: 'stuck-1' };
   store.pending.mockResolvedValue([stuck]);
   api.put.mockRejectedValue(new ApiError(500, { error: 'internal' }));
   vi.spyOn(api, 'get').mockResolvedValue({ id: 'i1', title: 'Server', revision: 1 });
   await sync.syncNow(); await sync.syncNow();
   expect(store.rejectOperation).not.toHaveBeenCalled();
   await sync.syncNow();
   expect(store.rejectOperation).toHaveBeenCalledWith(stuck, { id: 'i1', title: 'Server', revision: 1 }, expect.stringContaining('kept failing'));
 });
 it('does not count a failure while the server is down', async () => {
   const stuck = { ...op, token: 'stuck-2' };
   store.pending.mockResolvedValue([stuck]);
   api.put.mockRejectedValue(new ApiError(500, { error: 'internal' }));
   api.syncV3.mockRejectedValue(new ApiError(500, { error: 'internal' }));
   for (let i = 0; i < 4; i++) await sync.syncNow();
   expect(store.rejectOperation).not.toHaveBeenCalled();
 });
 it('holds back items after a new course that failed, but still downloads', async () => {
   const courseOp = { key: 'courses:c1', op: 'put', body: { id: 'c1' }, revision: 0, token: 'c' };
   store.pending.mockResolvedValue([op, courseOp]);
   api.put.mockRejectedValue(new ApiError(500, { error: 'internal' }));
   await sync.syncNow();
   expect(api.put).toHaveBeenCalledTimes(1);
   expect(api.put).toHaveBeenCalledWith('courses', 'c1', expect.anything());
   expect(api.syncV3).toHaveBeenCalled();
 });
 it('lets an untouched review step give way to the copy another device made', async () => {
   const review = { key: 'items:rv0000abc1', op: 'put', revision: 0, token: 'r',
     body: { id: 'rv0000abc1', type: 'task', title: 'Review 1/4 · ANAT Lecture Mon 14 Sep', status: 'todo', notes: '', checklist: [], links: [] } };
   store.pending.mockResolvedValue([review]);
   const current = { ...review.body, revision: 3, deletedAt: 123 };
   api.put.mockRejectedValue(new ApiError(409, { error: 'conflict', current }));
   await sync.syncNow();
   expect(store.rejectOperation).toHaveBeenCalledWith(review, current, '', { quiet: true });
 });
 it('keeps a review step the user worked on for review', async () => {
   const review = { key: 'items:rv0000abc1', op: 'put', revision: 0, token: 'r2',
     body: { id: 'rv0000abc1', type: 'task', title: 'Review 1/4 · ANAT Lecture Mon 14 Sep', status: 'done', notes: '', checklist: [], links: [] } };
   store.pending.mockResolvedValue([review]);
   api.put.mockRejectedValue(new ApiError(409, { error: 'conflict', current: null }));
   await sync.syncNow();
   expect(store.rejectOperation).toHaveBeenCalledWith(review, null, expect.stringContaining('another device'));
 });
 it('keeps a bounded, incomplete pull pending and schedules the next page', async () => {
   let cursor = 1;
   api.syncV3.mockImplementation(async () => ({ changes: [], cursor: ++cursor, more: true }));
   expect(await sync.syncNow()).toBe(true);
   expect(api.syncV3).toHaveBeenCalledTimes(20);
   expect(sync.status.state).toBe('pending');
   api.syncV3.mockResolvedValue({ changes: [], cursor: ++cursor, more: false });
   await vi.advanceTimersByTimeAsync(1000);
   expect(sync.status.state).toBe('idle');
 });
 it('pushes a mark to its own route with the fields it changed', async () => {
   const mark = { key: 'marks:abcdefghij12:a1', op: 'put', revision: 3, token: 'm', owner: 'x',
     body: { id: 'abcdefghij12:a1', notes: 'new', status: 'todo', revision: 3 }, base: { id: 'abcdefghij12:a1', notes: 'old', status: 'todo', revision: 3 } };
   store.pending.mockResolvedValue([mark]);
   api.put.mockResolvedValue({ ...mark.body, revision: 4 });
   await sync.syncNow();
   expect(api.put).toHaveBeenCalledWith('marks', 'abcdefghij12:a1', { ...mark.body, revision: 3 }, { notes: 'old' });
 });
 it('uploads course puts, then items, then marks and prefs, then course deletes', async () => {
   const at = (key, op = 'put') => ({ key, op, revision: 1, token: key, owner: 'x', body: { id: key.split(/:(.*)/s)[1], revision: 1 } });
   store.pending.mockResolvedValue([at('marks:abcdefghij12:a1'), at('courses:c1', 'delete'), at('space_prefs:abcdefghij12'), at('items:i1'), at('courses:c2')]);
   const order = [];
   api.put.mockImplementation(async (kind, id) => { order.push(kind + ':' + id); return { id, revision: 2 }; });
   vi.spyOn(api, 'del').mockImplementation(async (kind, id) => { order.push('del ' + kind + ':' + id); return null; });
   await sync.syncNow();
   expect(order).toEqual(['courses:c2', 'items:i1', 'marks:abcdefghij12:a1', 'space_prefs:abcdefghij12', 'del courses:c1']);
 });
});
describe('opening the app', () => {
 const remembered = { id: 'u1', username: 'george' };
 it('opens a remembered account once the server confirms the session', async () => {
   expect(await sync.startingProfile(remembered)).toEqual({ id: 'u1', revision: 1 });
 });
 it('shows sign-in, not the remembered data, when the server says the session ended', async () => {
   api.me.mockRejectedValue(new ApiError(401, { error: 'unauthenticated' }));
   expect(await sync.startingProfile(remembered)).toBe(null);
 });
 it.each([500, 502, 429])('opens the remembered account when the server answers %s', async (code) => {
   api.me.mockRejectedValue(new ApiError(code, { error: 'x' }));
   expect(await sync.startingProfile(remembered)).toBe(remembered);
 });
 it('opens the remembered account when the server is slow, without waiting for it', async () => {
   api.me.mockReturnValue(new Promise(() => {}));
   const opened = sync.startingProfile(remembered);
   await vi.advanceTimersByTimeAsync(1500);
   expect(await opened).toBe(remembered);
 });
 it('asks the server when nothing is remembered', async () => {
   expect(await sync.startingProfile(null)).toEqual({ id: 'u1', revision: 1 });
 });
 it.each([401, 429, 500, 502])('shows sign-in when nothing is remembered and the server answers %s', async (code) => {
   api.me.mockRejectedValue(new ApiError(code, { error: 'x' }));
   expect(await sync.startingProfile(null)).toBe(null);
 });
});
