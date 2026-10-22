-- Friends (study together, Stage 1; spec docs/superpowers/specs/2026-10-21-study-together-design.md §1, §4).
-- One row per pair, smaller id first. pending → accepted or declined. Removing a friend or
-- cancelling a request deletes the row; a decline is kept 30 days (from declined_at; created_at
-- stays as it was) so the sender keeps seeing "Requested" unchanged and is never told. The
-- nightly purge drops it.
CREATE TABLE friendships (
  user_lo       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_hi       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at    INTEGER NOT NULL,
  accepted_at   INTEGER,
  declined_at   INTEGER,
  PRIMARY KEY (user_lo, user_hi),
  CHECK (user_lo < user_hi AND requested_by IN (user_lo, user_hi))
);
-- Rows where you are the larger id (the primary key covers the smaller).
CREATE INDEX friendships_hi ON friendships (user_hi);
-- The nightly purge of old declines.
CREATE INDEX friendships_declined ON friendships (declined_at) WHERE status = 'declined';

-- The two switches on the Friends tab. No row means both on. Kept off users, so a change
-- never moves the profile's revision.
CREATE TABLE friend_settings (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  findable       INTEGER NOT NULL DEFAULT 1 CHECK (findable IN (0, 1)),
  show_studying  INTEGER NOT NULL DEFAULT 1 CHECK (show_studying IN (0, 1))
);
