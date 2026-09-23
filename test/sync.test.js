import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../public/js/api.js';
import * as store from '../public/js/store.js';
import * as sync from '../public/js/sync.js';
vi.mock('../public/js/store.js', () => ({
 data: { profile: { id: 'u1' } }, conflicts: [], pending: vi.fn(), pendingCount: vi.fn(() => 0),
 settleOperation: vi.fn(), rejectOperation: vi.fn(), applyPage: vi.fn(), applyServerProfile: vi.fn(),
 meta: { get: vi.fn(() => 1) }, withSyncLock: (fn) => fn(), subscribe: vi.fn(),
}));
const op = { key: 'items:i1', body: { id: 'i1', title: 'Study' }, revision: 1, op: 'put', token: 'a' };
beforeEach(() => {
 vi.useFakeTimers();
 vi.stubGlobal('document', { addEventListener: vi.fn() });
 vi.stubGlobal('window', { addEventListener: vi.fn() });
 sync.init();
 store.data.profile = { id: 'u1' };
 store.pending.mockResolvedValue([op]);
 vi.spyOn(api, 'put').mockResolvedValue({ ...op.body, revision: 2 });
 vi.spyOn(api, 'sync').mockResolvedValue({ changes: [], cursor: 1, more: false });
 vi.spyOn(api, 'me').mockResolvedValue({ id: 'u1', revision: 1 });
});
afterEach(() => { sync.stop(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('persisted operation synchronization', () => {
 it.each([403, 408, 429, 500, 502, 503])('retains edits on HTTP %s', async (code) => {
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
 it('reconciles an expired cursor and follows every page', async () => {
   api.sync.mockResolvedValueOnce({ reset: true }).mockResolvedValueOnce({ changes: [], cursor: 10, more: true }).mockResolvedValueOnce({ changes: [], cursor: 12, more: false });
   await sync.syncNow();
   expect(api.sync.mock.calls.map(([cursor]) => cursor)).toEqual([1, 0, 10]);
   expect(store.applyPage).toHaveBeenNthCalledWith(1, { changes: [], cursor: 10, more: true }, true);
 });
 it('does not sync a closed store', async () => {
   store.data.profile = null;
   expect(await sync.syncNow()).toBe(false);
   expect(api.put).not.toHaveBeenCalled();
 });
});
