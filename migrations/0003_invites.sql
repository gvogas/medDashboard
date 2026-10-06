-- Invitations to a space by username (spec §11). One row per person and space: a repeat
-- refreshes it. Accepting makes the membership and marks the row, so the inviter sees what
-- became of it. Join codes live on spaces (0002). Stage 5's nightly purge deletes invites
-- 90 days after they were made.

CREATE TABLE invites (
  space_id    TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  -- The person invited; deleting their account deletes their invites.
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Who sent it; NULL once that account is gone.
  invited_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- The role accepting gives. Never 'owner': ownership moves only by a transfer.
  role        TEXT NOT NULL CHECK (role IN ('editor', 'member')),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL CHECK (expires_at > created_at),
  PRIMARY KEY (space_id, user_id)
);
-- Invites to me: the invites list, and from Stage 7 the inbox count.
CREATE INDEX invites_user ON invites (user_id) WHERE status = 'pending';
-- The nightly purge (Stage 5).
CREATE INDEX invites_created ON invites (created_at);
