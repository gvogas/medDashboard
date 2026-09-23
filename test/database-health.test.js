import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { databaseChecks, databaseCountsSql, summarizeDatabase } from '../scripts/lib/database-health.js';
import { upsertRow } from '../worker/db.js';

const check = async () => summarizeDatabase(await env.DB.batch(
  [...databaseChecks.map((entry) => entry.sql), databaseCountsSql].map((sql) => env.DB.prepare(sql)),
));

describe('read-only database checks', () => {
  it('reports healthy data using only aggregate counts', async () => {
    const id = await createUser('health-check');
    await upsertRow(env.DB, 'quotes', id, 'q', { text: 'Private content', source: 'Private source' });
    const report = await check();
    expect(report.ok).toBe(true);
    expect(report.tables).toContainEqual({ name: 'quotes', rows: 1 });
    expect(JSON.stringify(report)).not.toMatch(/Private|password_hash|refresh_token/);
  });

  it('detects a missing change entry and does not repair or erase data', async () => {
    const id = await createUser('health-missing');
    await upsertRow(env.DB, 'quotes', id, 'q', { text: 'Keep this', source: '' });
    await env.DB.prepare('DELETE FROM changes WHERE user_id = ?').bind(id).run();
    const report = await check();
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual({ name: 'Change-feed record coverage', issues: 1 });
    expect(await env.DB.prepare('SELECT text FROM quotes WHERE user_id = ?').bind(id).first()).toEqual({ text: 'Keep this' });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM changes WHERE user_id = ?').bind(id).first()).toEqual({ n: 0 });
  });

  it('fails closed on incomplete command output', () => {
    expect(() => summarizeDatabase([])).toThrow(/incomplete result/);
  });
});
