-- Shared across Worker isolates: bounded request windows and upstream cooldowns.
CREATE TABLE request_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);
CREATE INDEX request_limits_reset ON request_limits (reset_at);

-- Bind OAuth attempts to the initiating account and consume them exactly once.
CREATE TABLE spotify_oauth_states (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- A short lease prevents simultaneous refresh-token rotation across isolates.
CREATE TABLE spotify_refresh_locks (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
