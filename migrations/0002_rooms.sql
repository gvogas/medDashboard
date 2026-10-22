-- Rooms (study together, Stage 2; spec docs/superpowers/specs/2026-10-21-study-together-design.md §2-§4).
-- One shared timer: the room keeps the same run record the solo timer keeps on a device
-- (src/core/timer.ts), and every device works out the clock from it. Only the host changes it,
-- and each change, or a change to who is in, bumps version.
CREATE TABLE rooms (
  id                TEXT PRIMARY KEY CHECK (length(id) = 12),
  host_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  flow              TEXT NOT NULL CHECK (json_valid(flow)),
  started_at        INTEGER NOT NULL,
  paused_at         INTEGER,
  paused_ms         INTEGER NOT NULL DEFAULT 0,
  skipped_ms        INTEGER NOT NULL DEFAULT 0,
  skipped_study_ms  INTEGER NOT NULL DEFAULT 0,
  -- Set when the host ends it, the last person leaves or the flow is over. The record is
  -- paused at that moment, so everyone's minutes come out the same at any later time.
  ended_at          INTEGER,
  -- The last 20 room events (started, joined, left, paused, resumed, skipped, ended, host), newest first.
  feed              TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(feed)),
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL
);
CREATE INDEX rooms_open ON rooms (ended_at) WHERE ended_at IS NULL;

-- Invited, in, or left. One row per person and room. A study minute counts from joined_study_ms
-- (the room's study time when you joined); earlier_ms keeps what earlier stints in the room
-- came to, so leaving and coming back still makes one session.
CREATE TABLE room_members (
  room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state            TEXT NOT NULL CHECK (state IN ('invited', 'in', 'left')),
  invited_by       TEXT,
  invited_at       INTEGER,
  joined_at        INTEGER,
  joined_study_ms  INTEGER,
  earlier_ms       INTEGER NOT NULL DEFAULT 0,
  left_at          INTEGER,
  last_seen        INTEGER,
  course_label     TEXT NOT NULL DEFAULT '' CHECK (length(course_label) <= 60),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX room_members_user ON room_members (user_id, state);

-- A session studied in a room: its id is 'r-' + the room id.
ALTER TABLE study_sessions ADD COLUMN room_id TEXT CHECK (room_id IS NULL OR length(room_id) = 12);
CREATE INDEX study_sessions_room ON study_sessions (room_id) WHERE room_id IS NOT NULL;

-- The change feed's triggers name every column, so they are made again with room_id.
DROP TRIGGER study_sessions_change_insert;
DROP TRIGGER study_sessions_change_update;
CREATE TRIGGER study_sessions_change_insert AFTER INSERT ON study_sessions BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'study_sessions' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'study_sessions', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'space_id', NEW.space_id, 'room_id', NEW.room_id, 'started_at', NEW.started_at, 'study_minutes', NEW.study_minutes, 'rounds_done', NEW.rounds_done, 'note', NEW.note, 'manual', NEW.manual, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER study_sessions_change_update AFTER UPDATE ON study_sessions BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'study_sessions' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'study_sessions', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'space_id', NEW.space_id, 'room_id', NEW.room_id, 'started_at', NEW.started_at, 'study_minutes', NEW.study_minutes, 'rounds_done', NEW.rounds_done, 'note', NEW.note, 'manual', NEW.manual, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
