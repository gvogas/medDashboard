-- Your own achievements: a sticker you uploaded, a name, and what earns it: hours studied
-- on one course, or a grade on one exam or quiz. Earned or not is worked out on the
-- device from sessions and items; nothing here records it.
--
-- The sticker is the picture itself, a small data: URL (256px, cut to a circle in the
-- browser), so it syncs and works offline like every other row, and is only ever
-- served through the API to the account that owns it. The course and item are plain
-- references, like a study session's: a deleted one leaves the achievement locked.
-- At most 30 live rows per account; worker/db.js holds the line.

CREATE TABLE achievements (
  user_id     TEXT NOT NULL REFERENCES users(id),
  id          TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  sticker     TEXT NOT NULL CHECK (length(sticker) BETWEEN 1 AND 90000 AND sticker LIKE 'data:image/%'),
  rule        TEXT NOT NULL CHECK (rule IN ('hours', 'grade')),
  course_id   TEXT CHECK (course_id IS NULL OR length(course_id) BETWEEN 1 AND 40),
  item_id     TEXT CHECK (item_id IS NULL OR length(item_id) BETWEEN 1 AND 24),
  target      INTEGER NOT NULL CHECK (typeof(target) = 'integer' AND target BETWEEN 1 AND 1000),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (user_id, id),
  CHECK ((rule = 'hours' AND course_id IS NOT NULL AND item_id IS NULL)
      OR (rule = 'grade' AND item_id IS NOT NULL AND course_id IS NULL AND target <= 100))
);
CREATE INDEX achievements_deleted ON achievements (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TRIGGER achievements_change_insert AFTER INSERT ON achievements BEGIN
 DELETE FROM changes WHERE user_id = NEW.user_id AND kind = 'achievements' AND row_id = NEW.id;
 INSERT INTO changes(user_id, kind, row_id, payload, deleted_at)
 VALUES(NEW.user_id, 'achievements', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'name', NEW.name, 'sticker', NEW.sticker, 'rule', NEW.rule, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'target', NEW.target, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER achievements_change_update AFTER UPDATE ON achievements BEGIN
 DELETE FROM changes WHERE user_id = NEW.user_id AND kind = 'achievements' AND row_id = NEW.id;
 INSERT INTO changes(user_id, kind, row_id, payload, deleted_at)
 VALUES(NEW.user_id, 'achievements', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'name', NEW.name, 'sticker', NEW.sticker, 'rule', NEW.rule, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'target', NEW.target, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
