-- The admin dashboard (worker/admin.js): who may open it, when each person was last
-- seen, the errors the Worker caught, what admins did, and a few app-wide values.

-- 1 for an account that may open the Admin page. Set the first one with
-- `npm run user:add -- <name> --admin --remote`; after that, from the page.
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1));
-- The last UTC day the person opened the app ('YYYY-MM-DD'), written by GET /api/me at
-- most once a day, so it costs one write per person per day.
ALTER TABLE users ADD COLUMN last_seen_day TEXT
  CHECK (last_seen_day IS NULL OR last_seen_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

-- Unexpected failures the Worker caught: 500s and failed AI reads. Capped per day
-- (worker/errors.js) and kept 30 days by the nightly cron.
CREATE TABLE error_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       INTEGER NOT NULL,
  method   TEXT NOT NULL DEFAULT '' CHECK (length(method) <= 8),
  route    TEXT NOT NULL DEFAULT '' CHECK (length(route) <= 200),
  status   INTEGER NOT NULL DEFAULT 500,
  message  TEXT NOT NULL DEFAULT '' CHECK (length(message) <= 500),
  user_id  TEXT
);
CREATE INDEX error_log_at ON error_log (at);

-- What admins did. Names, not foreign keys: the entry outlives a deleted account.
-- Kept 90 days by the nightly cron.
CREATE TABLE admin_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       INTEGER NOT NULL,
  admin    TEXT NOT NULL,          -- the admin's username
  action   TEXT NOT NULL CHECK (action IN ('create', 'reset', 'revoke', 'delete', 'promote', 'demote', 'unlock', 'announce', 'unannounce')),
  target   TEXT NOT NULL DEFAULT '',
  detail   TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 300)
);
CREATE INDEX admin_log_at ON admin_log (at);

-- App-wide values: 'announcement' (JSON {id, text, until}) and 'cron' (the nightly
-- run's time).
CREATE TABLE app_meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
