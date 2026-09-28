-- Study history: a note on each session and whether it was logged by hand, and the
-- person's study goal, streak rules and celebrations.
--
-- study_sessions gains `note` (what was covered) and `manual` (1 when typed in from
-- Log study rather than recorded by the timer). Its change-feed triggers are
-- recreated to carry both.
--
-- users.study_prefs is a JSON object: {goal, dayMin, rest, celebrate}. The Worker
-- checks its shape (worker/validate.js); this only checks it is an object.

ALTER TABLE study_sessions ADD COLUMN note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 200);
ALTER TABLE study_sessions ADD COLUMN manual INTEGER NOT NULL DEFAULT 0 CHECK (manual IN (0, 1));

DROP TRIGGER study_sessions_change_insert;
DROP TRIGGER study_sessions_change_update;
CREATE TRIGGER study_sessions_change_insert AFTER INSERT ON study_sessions BEGIN
 DELETE FROM changes WHERE user_id = NEW.user_id AND kind = 'study_sessions' AND row_id = NEW.id;
 INSERT INTO changes(user_id, kind, row_id, payload, deleted_at)
 VALUES(NEW.user_id, 'study_sessions', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'started_at', NEW.started_at, 'study_minutes', NEW.study_minutes, 'rounds_done', NEW.rounds_done, 'note', NEW.note, 'manual', NEW.manual, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER study_sessions_change_update AFTER UPDATE ON study_sessions BEGIN
 DELETE FROM changes WHERE user_id = NEW.user_id AND kind = 'study_sessions' AND row_id = NEW.id;
 INSERT INTO changes(user_id, kind, row_id, payload, deleted_at)
 VALUES(NEW.user_id, 'study_sessions', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'started_at', NEW.started_at, 'study_minutes', NEW.study_minutes, 'rounds_done', NEW.rounds_done, 'note', NEW.note, 'manual', NEW.manual, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

ALTER TABLE users ADD COLUMN study_prefs TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(study_prefs) AND json_type(study_prefs) = 'object');
