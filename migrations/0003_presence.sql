-- Presence (study together, Stage 3; spec docs/superpowers/specs/2026-10-21-study-together-design.md §1, §4).
-- A solo run, so friends can see you studying: written when a run starts or resumes (only while
-- Show friends when I'm studying is on), deleted when it stops. ends_at bounds a lost device:
-- a row past it reads as nobody studying, and the nightly cron deletes it.
CREATE TABLE presence (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  course_label  TEXT NOT NULL DEFAULT '' CHECK (length(course_label) <= 60),
  started_at    INTEGER NOT NULL,
  ends_at       INTEGER NOT NULL
);
CREATE INDEX presence_ends ON presence (ends_at);
-- Rooms that ended long ago, for the nightly purge.
CREATE INDEX rooms_ended ON rooms (ended_at) WHERE ended_at IS NOT NULL;
