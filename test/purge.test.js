import { env, createScheduledController, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../worker/index.js';
import { signIn } from './helpers.js';

describe('nightly purge', () => {
  it('hard-deletes tombstones older than 30 days and keeps newer ones', async () => {
    const api = await signIn();
    await api('/api/quotes/old', { method: 'PUT', body: { text: 'old', source: '' } });
    await api('/api/quotes/new', { method: 'PUT', body: { text: 'new', source: '' } });
    await api('/api/quotes/old', { method: 'DELETE' });
    await api('/api/quotes/new', { method: 'DELETE' });
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await env.DB.prepare("UPDATE quotes SET deleted_at = ? WHERE id = 'old'").bind(old).run();

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: '0 3 * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);

    const { results } = await env.DB.prepare("SELECT id FROM quotes WHERE id IN ('old', 'new') ORDER BY id").all();
    expect(results.map((r) => r.id)).toEqual(['new']);
  });
});
