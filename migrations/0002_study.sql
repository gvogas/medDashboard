-- The study timer: the person's flow on their profile, and one row per logged session.

-- Study and Break steps, each 1-180 minutes, repeated 1-12 rounds. The Worker checks
-- the shape (worker/validate.js); this only checks it is a JSON object.
ALTER TABLE users ADD COLUMN study_flow TEXT NOT NULL
  DEFAULT '{"steps":[["study",25],["break",5]],"rounds":4}'
  CHECK (json_valid(study_flow) AND json_type(study_flow) = 'object');

-- Study time only; breaks are never logged. The course and item are plain references:
-- deleting either clears them here (worker/db.js), and a session outlives both.
CREATE TABLE study_sessions (
  user_id        TEXT NOT NULL REFERENCES users(id),
  id             TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  course_id      TEXT CHECK (course_id IS NULL OR length(course_id) BETWEEN 1 AND 40),
  item_id        TEXT CHECK (item_id IS NULL OR length(item_id) BETWEEN 1 AND 24),
  started_at     INTEGER NOT NULL CHECK (typeof(started_at) = 'integer' AND started_at > 0),
  study_minutes  INTEGER NOT NULL CHECK (typeof(study_minutes) = 'integer' AND study_minutes BETWEEN 1 AND 1440),
  rounds_done    INTEGER NOT NULL DEFAULT 0 CHECK (typeof(rounds_done) = 'integer' AND rounds_done BETWEEN 0 AND 12),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  revision       INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX study_sessions_user_started ON study_sessions (user_id, started_at);
CREATE INDEX study_sessions_user_course  ON study_sessions (user_id, course_id);
CREATE INDEX study_sessions_user_item    ON study_sessions (user_id, item_id);
CREATE INDEX study_sessions_deleted      ON study_sessions (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TRIGGER study_sessions_change_insert AFTER INSERT ON study_sessions BEGIN
 DELETE FROM changes WHERE user_id = NEW.user_id AND kind = 'study_sessions' AND row_id = NEW.id;
 INSERT INTO changes(user_id, kind, row_id, payload, deleted_at)
 VALUES(NEW.user_id, 'study_sessions', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'started_at', NEW.started_at, 'study_minutes', NEW.study_minutes, 'rounds_done', NEW.rounds_done, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER study_sessions_change_update AFTER UPDATE ON study_sessions BEGIN
 DELETE FROM changes WHERE user_id = NEW.user_id AND kind = 'study_sessions' AND row_id = NEW.id;
 INSERT INTO changes(user_id, kind, row_id, payload, deleted_at)
 VALUES(NEW.user_id, 'study_sessions', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'started_at', NEW.started_at, 'study_minutes', NEW.study_minutes, 'rounds_done', NEW.rounds_done, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

DROP VIEW account_summary;
CREATE VIEW account_summary AS
SELECT u.id AS user_id, u.username, u.created_at,
       (SELECT count(*) FROM courses AS c WHERE c.user_id = u.id AND c.deleted_at IS NULL) AS courses,
       (SELECT count(*) FROM items AS i WHERE i.user_id = u.id AND i.deleted_at IS NULL) AS items,
       (SELECT count(*) FROM quotes AS q WHERE q.user_id = u.id AND q.deleted_at IS NULL) AS quotes,
       (SELECT count(*) FROM study_sessions AS s WHERE s.user_id = u.id AND s.deleted_at IS NULL) AS study_sessions
FROM users AS u;
