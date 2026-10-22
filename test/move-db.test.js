import { applyD1Migrations, env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { upsertRow, syncPage } from '../worker/db.js';
import { normalizeCourse } from '../src/core/model.ts';
import { readQueries, copyStatements, COLUMNS_QUERY, uncopied, differences } from '../scripts/lib/move-db.js';

const columns = async (db) => (await db.prepare(COLUMNS_QUERY).all()).results;
async function dump(db) {
  const out = {};
  for (const [name, sql] of readQueries(await columns(db))) {
    const rows = (await db.prepare(sql).all()).results;
    out[name] = name === 'state' ? rows[0] : rows;
  }
  return out;
}

/* rounds-v6 rows, written with plain SQL (today's Worker writes the new shape); that
   schema's own triggers fill its change feed. */
async function fillLegacy(db) {
  for (const id of ['ana', 'ben']) {
    await db.prepare(`INSERT INTO users (id, username, password_hash, types, study_flow, feed_gen, study_prefs, school_calendar, leaderboard, bg, is_admin, last_seen_day, created_at, updated_at)
      VALUES (?1, ?1, 'hash', '[{"id":"c-quiz1","label":"Quiz","color":"#B03A7A","kind":"graded"}]', '{"steps":[["study",50],["break",10]],"rounds":3}', ?2, '{"goal":105}', '{"terms":[]}', ?3, ?4, ?3, '2026-10-01', 100, 100)`)
      .bind(id, id === 'ana' ? 2 : null, id === 'ana' ? 1 : 0, id === 'ana' ? 'cs' : 'med').run();
    await db.prepare(`INSERT INTO courses (user_id, id, code, name, color, meetings, target, created_at, updated_at, revision)
      VALUES (?, 'bio', 'BIO', 'Biology ''n'' more', '#17B3AE', '[{"id":"m","kind":"Lecture","weekday":1,"start":"09:00","end":"10:00","room":"Hall B"}]', 85, 200, 200, 10)`).bind(id).run();
    await db.prepare(`INSERT INTO items (user_id, id, type, title, course_id, date, start, end, location, status, grade, weight, notes, checklist, links, completed_at, created_at, updated_at, revision)
      VALUES (?, 'mid', 'exam', 'Midterm: α & β', 'bio', '2026-10-05', '09:00', '10:00', 'Hall B', 'graded', 87.5, 20, 'Line one
line ''two''', '[{"id":"s","text":"Review","done":true}]', '[{"label":"Notes","url":"https://example.edu"}]', 205, 210, 210, 11)`).bind(id).run();
    await db.prepare("INSERT INTO items (user_id, id, type, title, date, status, created_at, updated_at, revision) VALUES (?, 'q', 'c-quiz1', 'Quiz', '2026-10-06', 'todo', 220, 220, 12)").bind(id).run();
    await db.prepare("INSERT INTO quotes (user_id, id, text, source, created_at, updated_at, revision) VALUES (?, 'k', 'Keep going', '', 230, 230, 13)").bind(id).run();
    await db.prepare(`INSERT INTO study_sessions (user_id, id, course_id, item_id, started_at, study_minutes, rounds_done, note, manual, created_at, updated_at, revision)
      VALUES (?, 's1', 'bio', 'mid', 1000, 50, 1, 'Krebs cycle, ''again''', 1, 235, 235, 14)`).bind(id).run();
    await db.prepare(`INSERT INTO achievements (user_id, id, name, sticker, rule, course_id, target, created_at, updated_at, revision)
      VALUES (?, 'a1', 'Bio buff', 'data:image/png;base64,iVBORw0KGgo=', 'hours', 'bio', 10, 236, 236, 15)`).bind(id).run();
  }
  await db.prepare("INSERT INTO items (user_id, id, type, title, date, status, created_at, updated_at, deleted_at, revision) VALUES ('ana', 'old', 'task', 'Old', '2026-10-01', 'todo', 240, 250, 250, 16)").run();
  /* a later write replaces an earlier change, so the head sits above the last kept seq */
  await db.prepare("INSERT INTO courses (user_id, id, code, name, color, created_at, updated_at, revision) VALUES ('ben', 'extra', 'X', 'Extra', '#8B5CC7', 260, 260, 17)").run();
  await db.prepare("UPDATE courses SET name = 'Extra 2', updated_at = 270, revision = 18 WHERE user_id = 'ben' AND id = 'extra'").run();
  await db.prepare("INSERT INTO spotify_tokens (user_id, refresh_token, access_token, expires_at, updated_at) VALUES ('ana', 'enc', 'acc', 999, 280)").run();
  await db.prepare('UPDATE sync_state SET floor = 2 WHERE id = 1').run();
  await db.prepare("INSERT INTO login_throttle (username, fails, updated_at) VALUES ('ana', 3, 1)").run();
  await db.prepare("INSERT INTO admin_log (at, admin, action, target, detail) VALUES (5, 'ana', 'create', 'ben', '')").run();
  const head = (await db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'changes'").first()).seq;
  await db.prepare("INSERT INTO changes (seq, user_id, kind, row_id, payload) VALUES (?, 'ana', 'x', 'x', '{}')").bind(head + 5).run();
  await db.prepare("DELETE FROM changes WHERE kind = 'x'").run();
}

it('copies a rounds-v6 database into the scoped schema, row for row, with the change feed and its head', async () => {
  const from = env.MIGRATION_DB, to = env.MOVE_DB;
  await applyD1Migrations(from, env.LEGACY_MIGRATIONS);
  await applyD1Migrations(to, env.TEST_MIGRATIONS);
  await fillLegacy(from);

  const source = await dump(from);
  /* read through the adapter: owners are scopes, a course's or item's change names its scope */
  expect(source.courses.map((c) => c.scope)).toEqual(['u:ana', 'u:ben', 'u:ben']);
  expect(source.items.every((i) => i.assignees === '[]' && i.class_id === null)).toBe(true);
  expect(source.users.every((u) => u.hidden_sources === '[]')).toBe(true);
  for (const change of source.changes) {
    const payload = JSON.parse(change.payload);
    if (change.kind === 'courses' || change.kind === 'items') {
      expect(payload.scope).toBe(change.scope);
      expect(payload).not.toHaveProperty('user_id');
    } else expect(change.scope).toBe('u:' + payload.user_id);
  }
  expect(source.state.head).toBeGreaterThan(Math.max(...source.changes.map((c) => c.seq)));

  await to.batch(copyStatements(source).map((sql) => to.prepare(sql)));
  expect(await dump(to)).toEqual(source);
  expect((await to.prepare('SELECT count(*) AS n FROM login_throttle').first()).n).toBe(0);
  expect(await to.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] });

  /* devices sync on from the same cursor: ben's feed in the copy holds his rows */
  const page = await syncPage(to, 'ben', 0, 50);
  expect(page.changes.map((c) => `${c.kind}:${c.row.id}`).sort())
    .toEqual(['achievements:a1', 'courses:bio', 'courses:extra', 'items:mid', 'items:q', 'quotes:k', 'study_sessions:s1']);
  expect(page.changes.find((c) => c.row.id === 'extra').row.name).toBe('Extra 2');
  expect(page.changes.find((c) => c.kind === 'items' && c.row.id === 'mid').row).toMatchObject({ grade: 87.5, weight: 20, courseId: 'bio' });
  expect(page.cursor).toBe(source.state.head);
  /* the next write numbers on from the old head, in the person's own scope */
  const next = await upsertRow(to, 'courses', 'ana', 'n', normalizeCourse({ id: 'n', code: 'N', name: 'New', color: '#7D8A99' }), 300);
  expect(next.revision).toBe(source.state.head + 1);
  expect(await to.prepare("SELECT scope FROM courses WHERE id = 'n'").first()).toEqual({ scope: 'u:ana' });
});

it('names every source column the copy would leave behind, so a move stops before losing data', async () => {
  /* the rounds-v6 source above and today's schema: TABLES (with the scope adapter) covers both */
  expect(uncopied(await columns(env.MIGRATION_DB))).toEqual([]);
  expect(uncopied(await columns(env.DB))).toEqual([]);
  /* and a column added later is caught, not dropped */
  expect(uncopied([...await columns(env.DB), { tbl: 'users', col: 'shoe_size' }])).toEqual(['users.shoe_size']);
});

it('reads only the columns rounds-v7 added as defaults, and stops on any other gap', async () => {
  const source = await columns(env.MIGRATION_DB);
  expect(() => readQueries(source.filter(({ tbl, col }) => !(tbl === 'users' && col === 'username')))).toThrow('users.username is not in the source database');
});

it('reads spaces and members as empty from a database made before them, and copies them after users', async () => {
  const queries = new Map(readQueries(await columns(env.MIGRATION_DB)));
  expect((await env.MIGRATION_DB.prepare(queries.get('spaces')).all()).results).toEqual([]);
  expect((await env.MIGRATION_DB.prepare(queries.get('members')).all()).results).toEqual([]);
  const sql = copyStatements({
    users: [{ id: 'ana', username: 'ana' }],
    spaces: [{ id: 'abcdefghij12', kind: 'class', archived: 0, created_at: 1, updated_at: 1, revision: 4 }],
    members: [{ space_id: 'abcdefghij12', user_id: 'ana', role: 'owner', joined_at: 1, updated_at: 1, revision: 4 }],
  });
  expect(sql.slice(0, 3).map((s) => s.split(' ').slice(0, 3).join(' '))).toEqual(['INSERT INTO users', 'INSERT INTO spaces', 'INSERT INTO members']);
});

it('reads invites as empty from a database made before them, and copies them after members', async () => {
  const queries = new Map(readQueries(await columns(env.MIGRATION_DB)));
  expect((await env.MIGRATION_DB.prepare(queries.get('invites')).all()).results).toEqual([]);
  const sql = copyStatements({
    users: [{ id: 'ana', username: 'ana' }],
    spaces: [{ id: 'abcdefghij12', kind: 'class', archived: 0, created_at: 1, updated_at: 1, revision: 4 }],
    members: [{ space_id: 'abcdefghij12', user_id: 'ana', role: 'owner', joined_at: 1, updated_at: 1, revision: 4 }],
    invites: [{ space_id: 'abcdefghij12', user_id: 'ana', invited_by: null, role: 'member', status: 'pending', created_at: 1, expires_at: 2 }],
  });
  expect(sql.slice(0, 4).map((s) => s.split(' ').slice(0, 3).join(' '))).toEqual(['INSERT INTO users', 'INSERT INTO spaces', 'INSERT INTO members', 'INSERT INTO invites']);
});

it('reads marks and space prefs as empty from a database made before them, and copies them after users', async () => {
  const queries = new Map(readQueries(await columns(env.MIGRATION_DB)));
  expect((await env.MIGRATION_DB.prepare(queries.get('marks')).all()).results).toEqual([]);
  expect((await env.MIGRATION_DB.prepare(queries.get('space_prefs')).all()).results).toEqual([]);
  const sql = copyStatements({
    users: [{ id: 'ana', username: 'ana' }],
    marks: [{ user_id: 'ana', id: 'abcdefghij12:a1', space_id: 'abcdefghij12', item_id: 'a1', status: 'done', grade: null, weight: null, notes: '', checklist: '[]', completed_at: 5, hidden: 0, created_at: 1, updated_at: 1, deleted_at: null, revision: 3 }],
    space_prefs: [{ user_id: 'ana', id: 'abcdefghij12', space_id: 'abcdefghij12', color: '#17B3AE', target: null, term: '', archived: 0, created_at: 1, updated_at: 1, deleted_at: null, revision: 4 }],
  });
  expect(sql.filter((s) => s.startsWith('INSERT INTO ')).map((s) => s.split(' ')[2]).slice(0, 3)).toEqual(['users', 'marks', 'space_prefs']);
});

it('reads friendships and friend settings as empty from a database made before them, and copies them after users', async () => {
  const queries = new Map(readQueries(await columns(env.MIGRATION_DB)));
  expect((await env.MIGRATION_DB.prepare(queries.get('friendships')).all()).results).toEqual([]);
  expect((await env.MIGRATION_DB.prepare(queries.get('friend_settings')).all()).results).toEqual([]);
  const sql = copyStatements({
    users: [{ id: 'ana', username: 'ana' }, { id: 'bo', username: 'bo' }],
    friendships: [{ user_lo: 'ana', user_hi: 'bo', requested_by: 'ana', status: 'accepted', created_at: 1, accepted_at: 2, declined_at: null }],
    friend_settings: [{ user_id: 'ana', findable: 0, show_studying: 1 }],
  });
  expect(sql.filter((s) => s.startsWith('INSERT INTO ')).map((s) => s.split(' ')[2]).slice(0, 4)).toEqual(['users', 'users', 'friendships', 'friend_settings']);
});

it('reads activity and inbox_seen as empty from a database made before them, and keeps the source activity, not the triggers\' copy', async () => {
  const queries = new Map(readQueries(await columns(env.MIGRATION_DB)));
  expect((await env.MIGRATION_DB.prepare(queries.get('activity')).all()).results).toEqual([]);
  expect((await env.MIGRATION_DB.prepare(queries.get('inbox_seen')).all()).results).toEqual([]);
  /* into today's schema (MOVE_DB already holds the first test's copy): the shared item's insert fires the activity trigger */
  const to = env.DB;
  await to.prepare("INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES ('u-mvcara', 'mvcara', 'h', 'Cara', 1, 1)").run();
  const activity = [{ seq: 41, space_id: 'mvact0000001', actor_id: 'u-mvcara', verb: 'item.created', subject: '', subject_user: '', old_value: null, new_value: null, detail: '{"titles":["Lab"],"by":"Cara"}', n: 1, bucket: 5, at: 3_000_000 }];
  const sql = copyStatements({
    spaces: [{ id: 'mvact0000001', kind: 'class', archived: 0, created_at: 1, updated_at: 1, revision: 4 }],
    courses: [{ scope: 'c:mvact0000001', id: 'web', code: 'WEB', name: 'Web', color: '#17B3AE', instructor: '', term: '', archived: 0, meetings: '[]', created_at: 1, updated_at: 1, revision: 1 }],
    items: [{ scope: 'c:mvact0000001', id: 'a1', type: 'lab', title: 'Lab', course_id: 'web', date: '2026-10-15', start: '', end: '', location: '', status: 'todo', notes: '', checklist: '[]', links: '[]', dept: '', updated_by: 'u-mvcara', assignees: '[]', created_at: 3_000_000, updated_at: 3_000_000, revision: 1 }],
    activity,
    inbox_seen: [{ user_id: 'u-mvcara', seq: 41 }],
  }).filter((s) => !/^(DELETE FROM changes|UPDATE sync_state)/.test(s));
  await to.batch(sql.map((s) => to.prepare(s)));
  expect((await to.prepare("SELECT * FROM activity WHERE space_id = 'mvact0000001'").all()).results).toEqual(activity);
  expect(sql.filter((s) => s.includes('activity')).map((s) => s.split(' (')[0])).toEqual(['DELETE FROM activity', 'INSERT INTO activity']);
  expect(await to.prepare("SELECT seq FROM inbox_seen WHERE user_id = 'u-mvcara'").first()).toEqual({ seq: 41 });
});

it('keeps activity numbering above every read marker, so a row written after the move is never already read', async () => {
  const to = env.MOVE_DB;
  await applyD1Migrations(to, env.TEST_MIGRATIONS);
  /* the source's newest rows (up to 60) were purged; dan had read up to 60 */
  await to.prepare("INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES ('u-mvdan', 'mvdan', 'h', 'Dan', 1, 1)").run();
  const sql = copyStatements({
    spaces: [{ id: 'mvact0000002', kind: 'class', archived: 0, created_at: 1, updated_at: 1, revision: 4 }],
    courses: [{ scope: 'c:mvact0000002', id: 'web', code: 'WEB', name: 'Web', color: '#17B3AE', instructor: '', term: '', archived: 0, meetings: '[]', created_at: 1, updated_at: 1, revision: 1 }],
    activity: [{ seq: 41, space_id: 'mvact0000002', actor_id: 'u-mvdan', verb: 'item.created', subject: '', subject_user: '', old_value: null, new_value: null, detail: '{"titles":["Lab"]}', n: 1, bucket: 5, at: 3_000_000 }],
    inbox_seen: [{ user_id: 'u-mvdan', seq: 60 }],
    state: { floor: 0, head: 0, activity_head: 60 },
  }).filter((s) => !/^(DELETE FROM changes|UPDATE sync_state)/.test(s));
  await to.batch(sql.map((s) => to.prepare(s)));
  expect((await to.prepare('SELECT seq FROM activity').all()).results).toEqual([{ seq: 41 }]);
  await to.prepare("INSERT INTO items (scope, id, type, title, course_id, date, status, updated_by, created_at, updated_at) VALUES ('c:mvact0000002', 'b1', 'lab', 'Lab 2', 'web', '2026-10-16', 'todo', 'u-mvdan', 9_000_000, 9_000_000)").run();
  const next = await to.prepare("SELECT seq FROM activity WHERE seq != 41").first();
  expect(next.seq).toBeGreaterThanOrEqual(61);
});

it('judges a copy by its rows and the feed\'s floor and head, letting only the activity counter end higher', () => {
  const made = (state, items = [{ id: 'a' }]) => ({ items, state: { floor: 2, head: 90, activity_head: 41, ...state } });
  expect(differences(made(), made())).toEqual([]);
  expect(differences(made(), made({ activity_head: 60 }))).toEqual([]);
  expect(differences(made(), made({ activity_head: 40 }))).toEqual(['state']);
  expect(differences(made(), made({ head: 91 }))).toEqual(['state']);
  expect(differences(made(), made({ floor: 3 }))).toEqual(['state']);
  expect(differences(made(), made({}, [{ id: 'b' }]))).toEqual(['items']);
});
