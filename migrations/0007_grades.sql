-- Grade categories, credits and the grading scale (src/core/grades.ts).
--
-- A course can split its grade into categories ("Quizzes 20%, drop the lowest 2") and an
-- item can belong to one: the category's weight is then shared by its items, and the item's
-- own weight is left aside. A course carries its credits for the GPA, and each person keeps
-- a grading scale (letters and grade points) and their own pass marks.
--
-- A class's course holds its categories and credits for everyone, and a class item its
-- category, as the class's other facts. An old client never sends these fields: the Worker
-- keeps the stored values when a write leaves them out (worker/db.js `KEPT_WHEN_ABSENT`).

-- [{id, name, weight, drop}], at most 12. Each entry is validated in the Worker; SQLite
-- checks it is a bounded JSON array. NULL credits count as the default (3).
ALTER TABLE courses ADD COLUMN credits REAL CHECK (credits IS NULL OR credits BETWEEN 0 AND 30);
ALTER TABLE courses ADD COLUMN grade_categories TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(grade_categories) AND json_type(grade_categories) = 'array' AND json_array_length(grade_categories) <= 12);

-- The id of one of its course's grade categories, or none. A label: an id the course no
-- longer has reads as none, and the item's own weight counts again.
ALTER TABLE items ADD COLUMN category TEXT CHECK (category IS NULL OR length(category) BETWEEN 1 AND 24);

-- The person's grading: {scale: [{letter, min, points}], pass: [marks]}; {} is the default
-- 4.0 scale and the pass marks 50, 60 and 70. Checked in the Worker (worker/validate.js).
ALTER TABLE users ADD COLUMN grading TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(grading) AND json_type(grading) = 'object');

-- The change feed carries the new columns.
DROP TRIGGER courses_change_insert;
DROP TRIGGER courses_change_update;
DROP TRIGGER items_change_insert;
DROP TRIGGER items_change_update;

CREATE TRIGGER courses_change_insert AFTER INSERT ON courses BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'courses' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'courses', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'code', NEW.code, 'name', NEW.name, 'color', NEW.color, 'instructor', NEW.instructor, 'term', NEW.term, 'archived', NEW.archived, 'meetings', NEW.meetings, 'target', NEW.target, 'credits', NEW.credits, 'grade_categories', NEW.grade_categories, 'updated_by', NEW.updated_by, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER courses_change_update AFTER UPDATE ON courses BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'courses' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'courses', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'code', NEW.code, 'name', NEW.name, 'color', NEW.color, 'instructor', NEW.instructor, 'term', NEW.term, 'archived', NEW.archived, 'meetings', NEW.meetings, 'target', NEW.target, 'credits', NEW.credits, 'grade_categories', NEW.grade_categories, 'updated_by', NEW.updated_by, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

CREATE TRIGGER items_change_insert AFTER INSERT ON items BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'items' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'items', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'type', NEW.type, 'title', NEW.title, 'course_id', NEW.course_id, 'date', NEW.date, 'start', NEW.start, 'end', NEW.end, 'location', NEW.location, 'status', NEW.status, 'grade', NEW.grade, 'weight', NEW.weight, 'notes', NEW.notes, 'checklist', NEW.checklist, 'links', NEW.links, 'recur', NEW.recur, 'weekday', NEW.weekday, 'recur_until', NEW.recur_until, 'dept', NEW.dept, 'completed_at', NEW.completed_at, 'updated_by', NEW.updated_by, 'class_id', NEW.class_id, 'category', NEW.category, 'assignees', NEW.assignees, 'completed_by', NEW.completed_by, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER items_change_update AFTER UPDATE ON items BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'items' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'items', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'type', NEW.type, 'title', NEW.title, 'course_id', NEW.course_id, 'date', NEW.date, 'start', NEW.start, 'end', NEW.end, 'location', NEW.location, 'status', NEW.status, 'grade', NEW.grade, 'weight', NEW.weight, 'notes', NEW.notes, 'checklist', NEW.checklist, 'links', NEW.links, 'recur', NEW.recur, 'weekday', NEW.weekday, 'recur_until', NEW.recur_until, 'dept', NEW.dept, 'completed_at', NEW.completed_at, 'updated_by', NEW.updated_by, 'class_id', NEW.class_id, 'category', NEW.category, 'assignees', NEW.assignees, 'completed_by', NEW.completed_by, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
