-- The CS background and the project item type.
--
-- users.bg picks the background art (Med or CS); it is independent of the
-- light/dark theme. Adding a column with a CHECK is allowed in place.
--
-- items.type gains 'project'. SQLite cannot alter a CHECK, so the items table is
-- rebuilt exactly as in 0007: copy first, then restore indexes and the change-feed
-- triggers, so revisions, cursors and change payloads stay as they were. The two
-- inspection views read items, so they are dropped before the rebuild and
-- recreated unchanged after it.

ALTER TABLE users ADD COLUMN bg TEXT NOT NULL DEFAULT 'med' CHECK (bg IN ('med', 'cs'));

DROP VIEW active_items;
DROP VIEW account_summary;

CREATE TABLE items_next (
  user_id       TEXT NOT NULL REFERENCES users(id),
  id            TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  type          TEXT NOT NULL CHECK (type IN ('exam', 'assignment', 'lab', 'tutoring', 'office', 'task', 'project')),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 140),
  course_id     TEXT,
  date          TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start         TEXT NOT NULL DEFAULT '' CHECK (start = '' OR start GLOB '[0-2][0-9]:[0-5][0-9]'),
  end           TEXT NOT NULL DEFAULT '' CHECK (end = '' OR end GLOB '[0-2][0-9]:[0-5][0-9]'),
  location      TEXT NOT NULL DEFAULT '' CHECK (length(location) <= 80),   -- "where" in the API
  status        TEXT NOT NULL CHECK (status IN ('todo', 'submitted', 'graded', 'done', 'missed')),
  grade         REAL CHECK (grade IS NULL OR grade BETWEEN 0 AND 100),
  weight        REAL CHECK (weight IS NULL OR weight BETWEEN 0 AND 100),
  notes         TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 5000),
  -- [{id, text, done}], at most 50
  checklist     TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(checklist) AND json_type(checklist) = 'array'
                       AND json_array_length(checklist) <= 50),
  -- [{label, url}], at most 20
  links         TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(links) AND json_type(links) = 'array'
                       AND json_array_length(links) <= 20),
  recur         TEXT CHECK (recur IS NULL OR recur = 'weekly'),
  weekday       INTEGER CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
  recur_until   TEXT CHECK (recur_until IS NULL
                            OR recur_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  dept          TEXT NOT NULL DEFAULT '' CHECK (length(dept) <= 40),
  completed_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  revision      INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (user_id, id),
  -- A course reference can only point at the same user's course.
  FOREIGN KEY (user_id, course_id) REFERENCES courses(user_id, id) ON DELETE RESTRICT,
  -- A weekly slot needs a weekday.
  CHECK (recur IS NULL OR weekday IS NOT NULL)
);

INSERT INTO items_next (user_id, id, type, title, course_id, date, start, end, location, status, grade, weight, notes, checklist, links, recur, weekday, recur_until, dept, completed_at, created_at, updated_at, deleted_at, revision)
SELECT user_id, id, type, title, course_id, date, start, end, location, status, grade, weight, notes, checklist, links, recur, weekday, recur_until, dept, completed_at, created_at, updated_at, deleted_at, revision FROM items;

DROP TABLE items;
ALTER TABLE items_next RENAME TO items;

CREATE INDEX items_user_updated ON items (user_id, updated_at);
CREATE INDEX items_user_date ON items (user_id, date);
CREATE INDEX items_deleted ON items (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX items_user_course ON items (user_id, course_id);

CREATE TRIGGER items_change_insert AFTER INSERT ON items BEGIN
 DELETE FROM changes WHERE user_id = NEW.user_id AND kind = 'items' AND row_id = NEW.id;
 INSERT INTO changes(user_id, kind, row_id, payload, deleted_at)
 VALUES(NEW.user_id, 'items', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'type', NEW.type, 'title', NEW.title, 'course_id', NEW.course_id, 'date', NEW.date, 'start', NEW.start, 'end', NEW.end, 'location', NEW.location, 'status', NEW.status, 'grade', NEW.grade, 'weight', NEW.weight, 'notes', NEW.notes, 'checklist', NEW.checklist, 'links', NEW.links, 'recur', NEW.recur, 'weekday', NEW.weekday, 'recur_until', NEW.recur_until, 'dept', NEW.dept, 'completed_at', NEW.completed_at, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER items_change_update AFTER UPDATE ON items BEGIN
 DELETE FROM changes WHERE user_id = NEW.user_id AND kind = 'items' AND row_id = NEW.id;
 INSERT INTO changes(user_id, kind, row_id, payload, deleted_at)
 VALUES(NEW.user_id, 'items', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'type', NEW.type, 'title', NEW.title, 'course_id', NEW.course_id, 'date', NEW.date, 'start', NEW.start, 'end', NEW.end, 'location', NEW.location, 'status', NEW.status, 'grade', NEW.grade, 'weight', NEW.weight, 'notes', NEW.notes, 'checklist', NEW.checklist, 'links', NEW.links, 'recur', NEW.recur, 'weekday', NEW.weekday, 'recur_until', NEW.recur_until, 'dept', NEW.dept, 'completed_at', NEW.completed_at, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

CREATE VIEW active_items AS
SELECT i.user_id, i.id, i.type, i.title, i.date, i.start, i.end, i.status,
       i.course_id, c.code AS course_code, c.name AS course_name, i.revision
FROM items AS i
LEFT JOIN courses AS c
  ON c.user_id = i.user_id AND c.id = i.course_id AND c.deleted_at IS NULL
WHERE i.deleted_at IS NULL;

CREATE VIEW account_summary AS
SELECT u.id AS user_id, u.username, u.created_at,
       (SELECT count(*) FROM courses AS c WHERE c.user_id = u.id AND c.deleted_at IS NULL) AS courses,
       (SELECT count(*) FROM items AS i WHERE i.user_id = u.id AND i.deleted_at IS NULL) AS items,
       (SELECT count(*) FROM quotes AS q WHERE q.user_id = u.id AND q.deleted_at IS NULL) AS quotes
FROM users AS u;
