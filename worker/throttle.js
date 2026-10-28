// Brute-force protection for sign-in. Five free tries per username; after that each
// attempt locks the name for twice as long as the last, from one minute up to an hour.
// A successful sign-in clears the count. Unknown usernames are counted too, so a
// guesser gets no cheaper by picking names that do not exist.
//
// A lock refuses the right password too, or a guesser could keep guessing through it.
// So that a stranger cannot lock the owner out, a browser that has signed in as a name
// before is counted under its own key, `name#device` (see trustedDevice in auth.js).
//
// An attempt is counted before its password is checked, in one statement that also
// refuses it while the name is locked. Checking first and counting after the failure
// would let a burst of parallel guesses all pass the check before any was counted.

const FREE_TRIES = 5;

/** The sign-in reply says how many tries are left from this many on. */
export const WARN_LEFT = 2;
const FIRST_LOCK_S = 60;
const MAX_LOCK_S = 60 * 60;

/** Seconds until this username may try again, or 0. */
async function lockedFor(db, username, now = Date.now()) {
  const row = await db.prepare('SELECT locked_until FROM login_throttle WHERE username = ?').bind(username).first();
  if (!row || row.locked_until <= now) return 0;
  return Math.ceil((row.locked_until - now) / 1000);
}

/**
 * Count one sign-in attempt. `wait` is 0 when it may go ahead, else the seconds to wait.
 * `left` is how many free tries remain after it. The attempt that reaches FREE_TRIES still goes ahead; it sets the lock for the next.
 * `pastLock` lets one attempt through a standing lock, for a caller that has passed a CAPTCHA (worker/captcha.js). It is still counted, so
 * a wrong password extends the lock as usual and the CAPTCHA is needed again for the next attempt.
 */
export async function claimAttempt(db, username, now = Date.now(), { pastLock = false } = {}) {
  // In the DO UPDATE, `fails` and `locked_until` are the stored row's values.
  const row = await db
    .prepare(
      `INSERT INTO login_throttle (username, fails, locked_until, updated_at) VALUES (?1, 1, 0, ?2)
       ON CONFLICT (username) DO UPDATE SET
         fails = fails + 1,
         locked_until = CASE WHEN fails + 1 >= ?3 THEN ?2 + min(?4, ?5 << min(fails + 1 - ?3, 6)) * 1000 ELSE 0 END,
         updated_at = ?2
       WHERE ?6 OR locked_until <= ?2
       RETURNING fails`,
    )
    .bind(username, now, FREE_TRIES, MAX_LOCK_S, FIRST_LOCK_S, pastLock ? 1 : 0)
    .first();
  if (row) return { wait: 0, left: Math.max(0, FREE_TRIES - row.fails) };
  return { wait: Math.max(1, await lockedFor(db, username, now)), left: 0 };
}

export async function recordSuccess(db, username) {
  await db.prepare('DELETE FROM login_throttle WHERE username = ?').bind(username).run();
}

/** Nightly housekeeping: forget names whose lock has long expired. */
export async function purgeThrottle(db, before) {
  await db.prepare('DELETE FROM login_throttle WHERE updated_at < ? AND locked_until < ?').bind(before, before).run();
}
