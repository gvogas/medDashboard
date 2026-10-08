-- Paid plans (docs/MONETIZATION.md). One row per person who has, or had, Term Pro: from an
-- App Store subscription (reported by RevenueCat's webhook, worker/plans.js), a web payment
-- later, or a free one an admin gives ('comp'). No row means the free plan. It is kept out of
-- `users` so a store renewal never bumps the profile's revision and conflicts with an edit.

CREATE TABLE plans (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier        TEXT NOT NULL CHECK (tier IN ('pro')),
  source      TEXT NOT NULL CHECK (source IN ('app_store', 'web', 'comp')),
  -- When it ends, ms since the epoch; NULL for no end (a comp). Pro while it is in the future.
  expires_at  INTEGER CHECK (expires_at IS NULL OR typeof(expires_at) = 'integer'),
  product     TEXT NOT NULL DEFAULT '' CHECK (length(product) <= 100),
  -- 1 while the subscription will renew; 0 once the person has cancelled (it still runs to expires_at).
  renews      INTEGER NOT NULL DEFAULT 0 CHECK (renews IN (0, 1)),
  -- The store event this row was last written from, so an older event arriving late cannot undo a newer one.
  event_at    INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

-- Webhook deliveries already applied, by the store's event id: a retry is answered and skipped.
-- The nightly cron drops ids older than 30 days.
CREATE TABLE billing_events (
  id  TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
  at  INTEGER NOT NULL
);
CREATE INDEX billing_events_at ON billing_events (at);

-- The audit log learns 'comp' and 'uncomp' (an admin giving or taking back Pro). SQLite cannot
-- change a CHECK in place, so the table is rebuilt with its rows.
CREATE TABLE admin_log_new (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       INTEGER NOT NULL,
  admin    TEXT NOT NULL,          -- the admin's username
  action   TEXT NOT NULL CHECK (action IN ('create', 'reset', 'revoke', 'delete', 'promote', 'demote', 'unlock', 'announce', 'unannounce', 'comp', 'uncomp')),
  target   TEXT NOT NULL DEFAULT '',
  detail   TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 300)
);
INSERT INTO admin_log_new (id, at, admin, action, target, detail) SELECT id, at, admin, action, target, detail FROM admin_log;
DROP TABLE admin_log;
ALTER TABLE admin_log_new RENAME TO admin_log;
CREATE INDEX admin_log_at ON admin_log (at);
