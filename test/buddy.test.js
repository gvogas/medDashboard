// Study Buddy, Stage 1: settings, the ledger, the Buddy read, claim, look, admin grant.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';

describe('the buddy tables', () => {
  it('keeps one settings row per person, gone with the account', async () => {
    const id = await createUser('bd-a');
    await env.DB.prepare('INSERT INTO buddy_settings (user_id, enabled, since, on_at, reconciled_at) VALUES (?, 1, 1, 1, 1)').bind(id).run();
    await expect(env.DB.prepare('INSERT INTO buddy_settings (user_id) VALUES (?)').bind(id).run()).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
    await expect(env.DB.prepare('UPDATE buddy_settings SET enabled = 2 WHERE user_id = ?').bind(id).run()).rejects.toThrow(/CHECK/);
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    expect(await env.DB.prepare('SELECT 1 FROM buddy_settings WHERE user_id = ?').bind(id).first()).toBeNull();
  });

  it('pays each source once; earn rows are never negative, spend rows always are', async () => {
    const id = await createUser('bd-b');
    const ins = (source, kind, amount) => env.DB.prepare("INSERT INTO buddy_ledger (user_id, source, kind, amount, day, at) VALUES (?, ?, ?, ?, '2026-11-02', 1)").bind(id, source, kind, amount).run();
    await ins('session:s1', 'earn', 3);
    await expect(ins('session:s1', 'earn', 3)).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
    await ins('item:u:t6', 'earn', 0);                                 /* over the day's limit: counted, pays nothing */
    await expect(ins('x:1', 'earn', -1)).rejects.toThrow(/CHECK/);
    await expect(ins('buy:x:1', 'spend', 5)).rejects.toThrow(/CHECK/);
    await expect(ins('a'.repeat(65), 'earn', 1)).rejects.toThrow(/CHECK/);
  });

  it('lets admin_log record a grant', async () => {
    await env.DB.prepare("INSERT INTO admin_log (at, admin, action, target) VALUES (1, 'root', 'grant', 'bd-b')").run();
    await expect(env.DB.prepare("INSERT INTO admin_log (at, admin, action, target) VALUES (1, 'root', 'steal', 'bd-b')").run()).rejects.toThrow(/CHECK/);
  });
});
