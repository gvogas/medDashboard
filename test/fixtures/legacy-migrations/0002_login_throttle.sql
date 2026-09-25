-- Failed sign-in counts per username, so a password cannot be guessed by brute force.
-- Rows are written only on failure and removed on success; see worker/throttle.js.

CREATE TABLE login_throttle (
  username      TEXT PRIMARY KEY,
  fails         INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER NOT NULL DEFAULT 0,   -- ms since the epoch; 0 = not locked
  updated_at    INTEGER NOT NULL
);
