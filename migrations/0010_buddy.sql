-- Study Buddy, Stage 1 (docs/superpowers/specs/2026-10-14-study-buddy-spec.md): the Gameplay
-- switch and the wallet. XP, tier, health and streak are worked out on read; only coins are kept.
-- Neither table is synced or in the change feed: the browser reads them through /api/buddy.

-- One row per person who has ever turned gameplay on. `since` is the first time (it never
-- changes: nothing before it counts); `on_at` the latest; `reconciled_at` the last time the
-- Worker looked for new awards (a finish is dated no earlier than this). `tz` is the browser's
-- zone, which days are counted in. `look` is the chosen {buddy, bg, name}: buddy 'auto' follows
-- the profile's theme. `xp_bonus` is admin-granted XP for testing.
CREATE TABLE buddy_settings (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled        INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  since          INTEGER CHECK (since IS NULL OR typeof(since) = 'integer'),
  on_at          INTEGER CHECK (on_at IS NULL OR typeof(on_at) = 'integer'),
  reconciled_at  INTEGER NOT NULL DEFAULT 0,
  tz             TEXT NOT NULL DEFAULT 'UTC' CHECK (length(tz) BETWEEN 1 AND 64),
  look           TEXT NOT NULL DEFAULT '{"buddy":"auto","bg":"none","name":""}' CHECK (json_valid(look) AND json_type(look) = 'object'),
  xp_bonus       INTEGER NOT NULL DEFAULT 0 CHECK (typeof(xp_bonus) = 'integer' AND xp_bonus BETWEEN 0 AND 100000)
);

-- One row per award or spend; the source names what paid (session:<id>, item:u:<id>,
-- item:c:<space>:<id>, streak:<day>, claim:<tier>, admin:<at>, later buy:<sku>:<level>), so
-- nothing pays twice. Balance = sum(amount). An earn of 0 records a finish over the day's limit,
-- so it never pays later.
CREATE TABLE buddy_ledger (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source   TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 64),
  kind     TEXT NOT NULL CHECK (kind IN ('earn', 'spend')),
  amount   INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND ((kind = 'earn' AND amount >= 0) OR (kind = 'spend' AND amount < 0))),
  day      TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  at       INTEGER NOT NULL,
  PRIMARY KEY (user_id, source)
);
CREATE INDEX buddy_ledger_day ON buddy_ledger (user_id, day);
CREATE INDEX buddy_ledger_at ON buddy_ledger (user_id, at);

-- admin_log's CHECK lists its actions; SQLite cannot change a CHECK, so the table is made again
-- with 'grant' (coins or XP given to an account for testing). No triggers or keys point at it.
CREATE TABLE admin_log_new (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       INTEGER NOT NULL,
  admin    TEXT NOT NULL,          -- the admin's username
  action   TEXT NOT NULL CHECK (action IN ('create', 'reset', 'revoke', 'delete', 'promote', 'demote', 'unlock', 'announce', 'unannounce', 'grant')),
  target   TEXT NOT NULL DEFAULT '',
  detail   TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 300)
);
INSERT INTO admin_log_new (id, at, admin, action, target, detail) SELECT id, at, admin, action, target, detail FROM admin_log;
DROP TABLE admin_log;
ALTER TABLE admin_log_new RENAME TO admin_log;
CREATE INDEX admin_log_at ON admin_log (at);
