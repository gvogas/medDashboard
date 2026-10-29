-- The sessions a browser holds right now, one row each: the sid in the cookie, the password
-- generation it was issued under (a row behind users.pw_gen is dead), and its current expiry.
-- A push device is held by whoever has a live row, so it cannot change hands mid-session.
-- Sign-out deletes the row; the nightly purge deletes it once expires_at has passed.
CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);
