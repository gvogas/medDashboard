-- Study Buddy, Stage 2 (docs/superpowers/specs/2026-10-14-study-buddy-spec.md): the shop and the
-- custom buddy. Not synced: the browser reads both through /api/buddy.

-- What each person has bought: an upgrade's level (1-5), or 1 for a background or frame. The
-- coins are a `buy:<sku>:<level>` spend in buddy_ledger, written in the same batch.
CREATE TABLE buddy_owned (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sku      TEXT NOT NULL CHECK (length(sku) BETWEEN 1 AND 24),
  level    INTEGER NOT NULL CHECK (typeof(level) = 'integer' AND level BETWEEN 1 AND 5),
  at       INTEGER NOT NULL,
  PRIMARY KEY (user_id, sku)
);

-- The custom buddy, made in the browser from a picture: {palette: [hex] 1-16, rows: [string]},
-- n rows of n characters (n 4-24), each a palette index 0-f or '.' for empty. worker/buddy.js
-- checks the shape; this keeps it JSON and small. Never the uploaded file.
ALTER TABLE buddy_settings ADD COLUMN custom TEXT
  CHECK (custom IS NULL OR (json_valid(custom) AND json_type(custom) = 'object' AND length(custom) <= 1024));
