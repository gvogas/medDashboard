-- Sessions signed out of (the sid in the cookie). A row is only needed until the session would
-- have expired anyway, so the nightly purge deletes it at expires_at.
CREATE TABLE revoked_sessions (
  sid TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_revoked_sessions_expires ON revoked_sessions (expires_at);
