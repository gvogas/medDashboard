// Brute-force protection for sign-in. Five free tries per username; after that each
// failure locks the name for twice as long as the last, from one minute up to an hour.
// A successful sign-in clears the count. Unknown usernames are counted too, so a
// guesser gets no cheaper by picking names that do not exist.

const FREE_TRIES = 5;
const FIRST_LOCK_S = 60;
const MAX_LOCK_S = 60 * 60;

/** Seconds until this username may try again, or 0. */
export async function lockedFor(db, username, now = Date.now()) {
  const row = await db.prepare('SELECT locked_until FROM login_throttle WHERE username = ?').bind(username).first();
  if (!row || row.locked_until <= now) return 0;
  return Math.ceil((row.locked_until - now) / 1000);
}

export async function recordFailure(db, username, now = Date.now()) {
  const row = await db.prepare('SELECT fails FROM login_throttle WHERE username = ?').bind(username).first();
  const fails = (row ? row.fails : 0) + 1;
  const over = fails - FREE_TRIES;
  const lockS = over >= 0 ? Math.min(MAX_LOCK_S, FIRST_LOCK_S * 2 ** over) : 0;
  await db
    .prepare(
      `INSERT INTO login_throttle (username, fails, locked_until, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (username) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until, updated_at = excluded.updated_at`,
    )
    .bind(username, fails, lockS ? now + lockS * 1000 : 0, now)
    .run();
}

export async function recordSuccess(db, username) {
  await db.prepare('DELETE FROM login_throttle WHERE username = ?').bind(username).run();
}

/** Nightly housekeeping: forget names whose lock has long expired. */
export async function purgeThrottle(db, before) {
  await db.prepare('DELETE FROM login_throttle WHERE updated_at < ? AND locked_until < ?').bind(before, before).run();
}
