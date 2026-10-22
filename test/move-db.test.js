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

/* rounds-v7 rows, written with plain SQL; that schema's own triggers fill its change feed
   and the activity of the shared class. */
const CLASS = 'mvclass00001';
async function fillLegacy(db) {
  for (const id of ['ana', 'ben']) {
    await db.prepare(`INSERT INTO users (id, username, password_hash, display_name, types, study_flow, feed_gen, study_prefs, school_calendar, leaderboard, bg, is_admin, last_seen_day, hidden_sources, grading, created_at, updated_at)
      VALUES (?1, ?1, 'hash', upper(?1), '[{"id":"c-quiz1","label":"Quiz","color":"#B03A7A","kind":"graded"}]', '{"steps":[["study",50],["break",10]],"rounds":3}', ?2, '{"goal":105}', '{"terms":[]}', ?3, ?4, ?3, '2026-10-01', ?5, ?6, 100, 100)`)
      .bind(id, id === 'ana' ? 2 : null, id === 'ana' ? 1 : 0, id === 'ana' ? 'cs' : 'med', id === 'ana' ? '["personal"]' : '[]',
        id === 'ana' ? '{"scale":[{"letter":"A","min":85,"points":4}],"pass":[60]}' : '{}').run();
    await db.prepare(`INSERT INTO courses (scope, id, code, name, color, meetings, target, created_at, updated_at, revision)
      VALUES ('u:' || ?, 'bio', 'BIO', 'Biology ''n'' more', '#17B3AE', '[{"id":"m","kind":"Lecture","weekday":1,"start":"09:00","end":"10:00","room":"Hall B"}]', 85, 200, 200, 10)`).bind(id).run();
    await db.prepare(`INSERT INTO items (scope, id, type, title, course_id, date, start, end, location, status, grade, weight, notes, checklist, links, completed_at, created_at, updated_at, revision)
      VALUES ('u:' || ?, 'mid', 'exam', 'Midterm: α & β', 'bio', '2026-10-05', '09:00', '10:00', 'Hall B', 'graded', 87.5, 20, 'Line one
line ''two''', '[{"id":"s","text":"Review","done":true}]', '[{"label":"Notes","url":"https://example.edu"}]', 205, 210, 210, 11)`).bind(id).run();
    await db.prepare("INSERT INTO items (scope, id, type, title, date, status, created_at, updated_at, revision) VALUES ('u:' || ?, 'q', 'c-quiz1', 'Quiz', '2026-10-06', 'todo', 220, 220, 12)").bind(id).run();
    await db.prepare("INSERT INTO quotes (user_id, id, text, source, created_at, updated_at, revision) VALUES (?, 'k', 'Keep going', '', 230, 230, 13)").bind(id).run();
    await db.prepare(`INSERT INTO study_sessions (user_id, id, course_id, item_id, started_at, study_minutes, rounds_done, note, manual, created_at, updated_at, revision)
      VALUES (?, 's1', 'bio', 'mid', 1000, 50, 1, 'Krebs cycle, ''again''', 1, 235, 235, 14)`).bind(id).run();
    await db.prepare(`INSERT INTO achievements (user_id, id, name, sticker, rule, course_id, target, created_at, updated_at, revision)
      VALUES (?, 'a1', 'Bio buff', 'data:image/png;base64,iVBORw0KGgo=', 'hours', 'bio', 10, 236, 236, 15)`).bind(id).run();
  }
  await db.prepare("INSERT INTO items (scope, id, type, title, date, status, created_at, updated_at, deleted_at, revision) VALUES ('u:ana', 'old', 'task', 'Old', '2026-10-01', 'todo', 240, 250, 250, 16)").run();
  /* a later write replaces an earlier change, so the head sits above the last kept seq */
  await db.prepare("INSERT INTO courses (scope, id, code, name, color, created_at, updated_at, revision) VALUES ('u:ben', 'extra', 'X', 'Extra', '#8B5CC7', 260, 260, 17)").run();
  await db.prepare("UPDATE courses SET name = 'Extra 2', updated_at = 270, revision = 18 WHERE scope = 'u:ben' AND id = 'extra'").run();
  /* ana's class: its course and an item (whose insert the activity trigger records), ben invited, ana's own layer */
  await db.prepare(`INSERT INTO spaces (id, kind, school_calendar, created_at, updated_at, revision) VALUES ('${CLASS}', 'class', '{"terms":[]}', 300, 300, 19)`).run();
  await db.prepare(`INSERT INTO members (space_id, user_id, role, joined_at, updated_at, revision) VALUES ('${CLASS}', 'ana', 'owner', 300, 300, 19)`).run();
  await db.prepare(`INSERT INTO invites (space_id, user_id, invited_by, role, created_at, expires_at) VALUES ('${CLASS}', 'ben', 'ana', 'member', 301, 9001)`).run();
  /* the class's grade categories and credits, and its item's category (0007_grades) */
  await db.prepare(`INSERT INTO courses (scope, id, code, name, color, updated_by, credits, grade_categories, created_at, updated_at, revision)
    VALUES ('c:${CLASS}', 'web', 'WEB', 'Web', '#4F74D9', 'ana', 4.5, '[{"id":"qz","name":"Quizzes","weight":20,"drop":1}]', 302, 302, 20)`).run();
  await db.prepare(`INSERT INTO items (scope, id, type, title, course_id, date, status, weight, updated_by, category, created_at, updated_at, revision)
    VALUES ('c:${CLASS}', 'lab1', 'lab', 'Lab 1', 'web', '2026-10-15', 'todo', 10, 'ana', 'qz', 3_000_000, 3_000_000, 21)`).run();
  await db.prepare(`INSERT INTO marks (user_id, id, space_id, item_id, status, grade, created_at, updated_at, revision) VALUES ('ana', '${CLASS}:lab1', '${CLASS}', 'lab1', 'graded', 93, 304, 304, 22)`).run();
  await db.prepare(`INSERT INTO space_prefs (user_id, id, space_id, color, target, term, created_at, updated_at, revision) VALUES ('ana', '${CLASS}', '${CLASS}', '#4F74D9', 90, 'Fall 2026', 305, 305, 23)`).run();
  await db.prepare(`INSERT INTO activity (space_id, actor_id, verb, subject_user, detail, bucket, at) VALUES ('${CLASS}', 'ana', 'member.joined', 'ana', '{"by":"ANA"}', 0, 306)`).run();
  await db.prepare("INSERT INTO inbox_seen (user_id, seq) VALUES ('ana', 1)").run();
  /* push devices (0006_push) and friends (0008_friends) */
  await db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, tz, created_at, last_ok_at, last_sent_day, failures) VALUES
    ('https://fcm.googleapis.com/fcm/send/ana-phone', 'ana', 'America/Toronto', 310, 320, '2026-10-21', 0),
    ('https://updates.push.services.mozilla.com/wpush/v2/ana-laptop', 'ana', 'UTC', 311, NULL, NULL, 3),
    ('https://web.push.apple.com/ben-phone', 'ben', 'Europe/Paris', 312, 330, '2026-10-20', 1)`).run();
  await db.prepare("INSERT INTO friendships (user_lo, user_hi, requested_by, status, created_at, accepted_at) VALUES ('ana', 'ben', 'ben', 'accepted', 340, 341)").run();
  await db.prepare("INSERT INTO friend_settings (user_id, findable, show_studying) VALUES ('ben', 0, 1)").run();
  await db.prepare("INSERT INTO spotify_tokens (user_id, refresh_token, access_token, expires_at, updated_at) VALUES ('ana', 'enc', 'acc', 999, 280)").run();
  await db.prepare('UPDATE sync_state SET floor = 2 WHERE id = 1').run();
  await db.prepare("INSERT INTO login_throttle (username, fails, updated_at) VALUES ('ana', 3, 1)").run();
  await db.prepare("INSERT INTO admin_log (at, admin, action, target, detail) VALUES (5, 'ana', 'create', 'ben', '')").run();
  const head = (await db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'changes'").first()).seq;
  await db.prepare("INSERT INTO changes (seq, scope, kind, row_id, payload) VALUES (?, 'u:ana', 'x', 'x', '{}')").bind(head + 5).run();
  await db.prepare("DELETE FROM changes WHERE kind = 'x'").run();
}

it('copies a rounds-v7 database into today\'s schema, row for row, with the change feed, activity and their heads', async () => {
  const from = env.MIGRATION_DB, to = env.MOVE_DB;
  await applyD1Migrations(from, env.LEGACY_MIGRATIONS);
  await applyD1Migrations(to, env.TEST_MIGRATIONS);
  await fillLegacy(from);

  const source = await dump(from);
  expect(source.courses.map((c) => c.scope)).toEqual([`c:${CLASS}`, 'u:ana', 'u:ben', 'u:ben']);
  expect(source.spaces.map((s) => s.id)).toEqual([CLASS]);
  expect(source.invites).toHaveLength(1);
  expect(source.marks).toHaveLength(1);
  expect(source.space_prefs).toHaveLength(1);
  expect(source.activity.map((a) => a.verb)).toEqual(['item.created', 'member.joined']);
  expect(source.inbox_seen).toEqual([{ user_id: 'ana', seq: 1 }]);
  expect(source.push_subscriptions.map((p) => [p.user_id, p.tz, p.last_sent_day, p.failures])).toEqual([
    ['ana', 'America/Toronto', '2026-10-21', 0], ['ana', 'UTC', null, 3], ['ben', 'Europe/Paris', '2026-10-20', 1]]);
  expect(source.friendships).toEqual([{ user_lo: 'ana', user_hi: 'ben', requested_by: 'ben', status: 'accepted', created_at: 340, accepted_at: 341, declined_at: null }]);
  expect(source.friend_settings).toEqual([{ user_id: 'ben', findable: 0, show_studying: 1 }]);
  expect(source.users.map((u) => u.grading)).toEqual(['{"scale":[{"letter":"A","min":85,"points":4}],"pass":[60]}', '{}']);
  expect(source.courses[0]).toMatchObject({ credits: 4.5, grade_categories: '[{"id":"qz","name":"Quizzes","weight":20,"drop":1}]' });
  expect(source.courses.slice(1).every((c) => c.credits === null && c.grade_categories === '[]')).toBe(true);
  expect(source.items.find((i) => i.id === 'lab1').category).toBe('qz');
  /* the class course's change carries the new columns, from 0007's triggers */
  expect(JSON.parse(source.changes.find((c) => c.kind === 'courses' && c.row_id === 'web').payload)).toMatchObject({ credits: 4.5 });
  expect(source.state.head).toBeGreaterThan(Math.max(...source.changes.map((c) => c.seq)));

  await to.batch(copyStatements(source).map((sql) => to.prepare(sql)));
  const copied = await dump(to);
  expect(differences(source, copied)).toEqual([]);
  expect(copied).toEqual({ ...source, state: { ...source.state, activity_head: copied.state.activity_head } });
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
  /* the rounds-v7 source above and today's schema: TABLES covers both */
  expect(uncopied(await columns(env.MIGRATION_DB))).toEqual([]);
  expect(uncopied(await columns(env.DB))).toEqual([]);
  /* and a column added later is caught, not dropped */
  expect(uncopied([...await columns(env.DB), { tbl: 'users', col: 'shoe_size' }])).toEqual(['users.shoe_size']);
});

it('stops on a column missing from the source, rather than reading it as empty', async () => {
  const source = await columns(env.MIGRATION_DB);
  expect(() => readQueries(source.filter(({ tbl, col }) => !(tbl === 'users' && col === 'username')))).toThrow('users.username is not in the source database');
  expect(() => readQueries(source.filter(({ tbl, col }) => !(tbl === 'marks' && col === 'hidden')))).toThrow('marks.hidden is not in the source database');
  expect(() => readQueries(source.filter(({ tbl, col }) => !(tbl === 'items' && col === 'category')))).toThrow('items.category is not in the source database');
  expect(() => readQueries(source.filter(({ tbl }) => tbl !== 'push_subscriptions'))).toThrow('push_subscriptions.endpoint is not in the source database');
});

it('copies spaces, members and invites after users, in an order the foreign keys accept', () => {
  const sql = copyStatements({
    users: [{ id: 'ana', username: 'ana' }],
    spaces: [{ id: 'abcdefghij12', kind: 'class', archived: 0, created_at: 1, updated_at: 1, revision: 4 }],
    members: [{ space_id: 'abcdefghij12', user_id: 'ana', role: 'owner', joined_at: 1, updated_at: 1, revision: 4 }],
    invites: [{ space_id: 'abcdefghij12', user_id: 'ana', invited_by: null, role: 'member', status: 'pending', created_at: 1, expires_at: 2 }],
  });
  expect(sql.slice(0, 4).map((s) => s.split(' ').slice(0, 3).join(' '))).toEqual(['INSERT INTO users', 'INSERT INTO spaces', 'INSERT INTO members', 'INSERT INTO invites']);
});

it('copies marks and space prefs after users', () => {
  const sql = copyStatements({
    users: [{ id: 'ana', username: 'ana' }],
    marks: [{ user_id: 'ana', id: 'abcdefghij12:a1', space_id: 'abcdefghij12', item_id: 'a1', status: 'done', grade: null, weight: null, notes: '', checklist: '[]', completed_at: 5, hidden: 0, created_at: 1, updated_at: 1, deleted_at: null, revision: 3 }],
    space_prefs: [{ user_id: 'ana', id: 'abcdefghij12', space_id: 'abcdefghij12', color: '#17B3AE', target: null, term: '', archived: 0, created_at: 1, updated_at: 1, deleted_at: null, revision: 4 }],
  });
  expect(sql.filter((s) => s.startsWith('INSERT INTO ')).map((s) => s.split(' ')[2]).slice(0, 3)).toEqual(['users', 'marks', 'space_prefs']);
});

it('copies friendships, friend settings and push devices after users', () => {
  const sql = copyStatements({
    users: [{ id: 'ana', username: 'ana' }, { id: 'bo', username: 'bo' }],
    friendships: [{ user_lo: 'ana', user_hi: 'bo', requested_by: 'ana', status: 'accepted', created_at: 1, accepted_at: 2, declined_at: null }],
    friend_settings: [{ user_id: 'ana', findable: 0, show_studying: 1 }],
    push_subscriptions: [{ endpoint: 'https://fcm.googleapis.com/fcm/send/x', user_id: 'bo', tz: 'UTC', created_at: 1, last_ok_at: null, last_sent_day: null, failures: 0 }],
  });
  expect(sql.filter((s) => s.startsWith('INSERT INTO ')).map((s) => s.split(' ')[2]).slice(0, 5)).toEqual(['users', 'users', 'friendships', 'friend_settings', 'push_subscriptions']);
});

it('keeps the source activity and inbox_seen, not the triggers\' copy', async () => {
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
