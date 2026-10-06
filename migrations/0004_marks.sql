-- Your layer on a shared class or project (spec §3, §4). Your status, grade, weight
-- override, checklist, notes and "not mine" on a shared item live in `marks`; your colour,
-- grade target, semester and "archived in my sidebar" for a space in `space_prefs`. Each
-- belongs to one person, is read only with their user id, and writes its changes into that
-- person's own feed ('u:' || user_id), so no other member's sync ever pages it. One text id
-- each, like every other personal row: a mark's is '<space id>:<item id>', a prefs row's the
-- space id. Deleting an account deletes both.

CREATE TABLE marks (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id            TEXT NOT NULL CHECK (length(id) <= 40 AND id = space_id || ':' || item_id),
  space_id      TEXT NOT NULL CHECK (length(space_id) = 12 AND space_id NOT GLOB '*[^a-z0-9]*'),
  item_id       TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 24),
  status        TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'submitted', 'graded', 'done', 'missed')),
  grade         REAL CHECK (grade IS NULL OR grade BETWEEN 0 AND 100),
  -- Your weight for the item, when it differs from the class's; NULL uses the class's.
  weight        REAL CHECK (weight IS NULL OR weight BETWEEN 0 AND 100),
  notes         TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 5000),
  -- [{id, text, done}], at most 50: exam prep's topics on a class exam.
  checklist     TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(checklist) AND json_type(checklist) = 'array' AND json_array_length(checklist) <= 50),
  completed_at  INTEGER,
  -- "Not mine": left out of your views, grades and stats until shown again.
  hidden        INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  revision      INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (user_id, id),
  -- One mark per person and item; also "my marks in a space" (detach, revocation).
  UNIQUE (user_id, space_id, item_id)
);
CREATE INDEX marks_deleted ON marks (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE space_prefs (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id          TEXT NOT NULL CHECK (id = space_id),
  space_id    TEXT NOT NULL CHECK (length(space_id) = 12 AND space_id NOT GLOB '*[^a-z0-9]*'),
  -- Your colour for the space: one of the twelve course colours.
  color       TEXT NOT NULL CHECK (color IN ('#E4749B', '#8B5CC7', '#17B3AE', '#79B6EA', '#BCA6E6',
                                              '#F08A6C', '#E8B33A', '#4FBF8B', '#8FAE86', '#4F74D9', '#B8457E', '#7D8A99')),
  target      INTEGER CHECK (target IS NULL OR (typeof(target) = 'integer' AND target BETWEEN 1 AND 100)),
  -- Your semester for a class ('' is every semester), as a course's own term is.
  term        TEXT NOT NULL DEFAULT '' CHECK (length(term) <= 40),
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX space_prefs_deleted ON space_prefs (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TRIGGER marks_change_insert AFTER INSERT ON marks BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'marks' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'marks', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'space_id', NEW.space_id, 'item_id', NEW.item_id, 'status', NEW.status, 'grade', NEW.grade, 'weight', NEW.weight, 'notes', NEW.notes, 'checklist', NEW.checklist, 'completed_at', NEW.completed_at, 'hidden', NEW.hidden, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER marks_change_update AFTER UPDATE ON marks BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'marks' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'marks', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'space_id', NEW.space_id, 'item_id', NEW.item_id, 'status', NEW.status, 'grade', NEW.grade, 'weight', NEW.weight, 'notes', NEW.notes, 'checklist', NEW.checklist, 'completed_at', NEW.completed_at, 'hidden', NEW.hidden, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

CREATE TRIGGER space_prefs_change_insert AFTER INSERT ON space_prefs BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'space_prefs' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'space_prefs', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'space_id', NEW.space_id, 'color', NEW.color, 'target', NEW.target, 'term', NEW.term, 'archived', NEW.archived, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER space_prefs_change_update AFTER UPDATE ON space_prefs BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'space_prefs' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'space_prefs', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'space_id', NEW.space_id, 'color', NEW.color, 'target', NEW.target, 'term', NEW.term, 'archived', NEW.archived, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

-- Stage 3 made memberships before this table existed (its plan, Decision 3). Each live
-- membership of a live class gets the prefs a join writes from now on (worker/spaces.js
-- joinPrefs): the class course's colour unless the person already uses it on a course of
-- their own, else the first of the twelve they do not use; the class's term. Run again, it
-- leaves a prefs row already there as it is.
INSERT INTO space_prefs (user_id, id, space_id, color, target, term, archived, created_at, updated_at, revision)
SELECT m.user_id, m.space_id, m.space_id,
  COALESCE(
    (SELECT c.color FROM courses AS c WHERE c.scope = 'c:' || m.space_id AND c.deleted_at IS NULL
      AND c.color NOT IN (SELECT u.color FROM courses AS u WHERE u.scope = 'u:' || m.user_id AND u.deleted_at IS NULL AND u.archived = 0)),
    (SELECT p.value FROM json_each('["#E4749B","#8B5CC7","#17B3AE","#79B6EA","#BCA6E6","#F08A6C","#E8B33A","#4FBF8B","#8FAE86","#4F74D9","#B8457E","#7D8A99"]') AS p
      WHERE p.value NOT IN (SELECT u.color FROM courses AS u WHERE u.scope = 'u:' || m.user_id AND u.deleted_at IS NULL AND u.archived = 0)
      ORDER BY p.key LIMIT 1),
    (SELECT c.color FROM courses AS c WHERE c.scope = 'c:' || m.space_id LIMIT 1),
    '#17B3AE'),
  NULL,
  COALESCE((SELECT c.term FROM courses AS c WHERE c.scope = 'c:' || m.space_id AND c.deleted_at IS NULL LIMIT 1), ''),
  0,
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
  COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) + 1
FROM members AS m JOIN spaces AS s ON s.id = m.space_id
WHERE m.deleted_at IS NULL AND s.deleted_at IS NULL AND s.kind = 'class'
  AND NOT EXISTS (SELECT 1 FROM space_prefs AS q WHERE q.user_id = m.user_id AND q.id = m.space_id);
