-- Row revisions and a compact, ordered change feed. Each entity retains its latest change.
ALTER TABLE users ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE courses ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE items ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE quotes ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE TABLE sync_state (id INTEGER PRIMARY KEY CHECK(id = 1), floor INTEGER NOT NULL DEFAULT 0);
INSERT INTO sync_state (id) VALUES (1);
CREATE TABLE changes (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,
 row_id TEXT NOT NULL,
 payload TEXT NOT NULL,
 deleted_at INTEGER,
 UNIQUE(user_id, kind, row_id)
);
CREATE INDEX changes_user_seq ON changes(user_id, seq);
CREATE INDEX changes_deleted ON changes(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TRIGGER courses_change_insert AFTER INSERT ON courses BEGIN
 DELETE FROM changes WHERE user_id = NEW.user_id AND kind = 'courses' AND row_id = NEW.id;
 INSERT INTO changes(user_id, kind, row_id, payload, deleted_at)
 VALUES(NEW.user_id, 'courses', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'code', NEW.code, 'name', NEW.name, 'color', NEW.color, 'instructor', NEW.instructor, 'term', NEW.term, 'archived', NEW.archived, 'meetings', NEW.meetings, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER courses_change_update AFTER UPDATE ON courses BEGIN
 DELETE FROM changes WHERE user_id = NEW.user_id AND kind = 'courses' AND row_id = NEW.id;
 INSERT INTO changes(user_id, kind, row_id, payload, deleted_at)
 VALUES(NEW.user_id, 'courses', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'code', NEW.code, 'name', NEW.name, 'color', NEW.color, 'instructor', NEW.instructor, 'term', NEW.term, 'archived', NEW.archived, 'meetings', NEW.meetings, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
INSERT INTO changes(user_id, kind, row_id, payload, deleted_at) SELECT user_id, 'courses', id, json_object('user_id', user_id, 'id', id, 'code', code, 'name', name, 'color', color, 'instructor', instructor, 'term', term, 'archived', archived, 'meetings', meetings, 'created_at', created_at, 'updated_at', updated_at, 'deleted_at', deleted_at, 'revision', revision), deleted_at FROM courses;
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
INSERT INTO changes(user_id, kind, row_id, payload, deleted_at) SELECT user_id, 'items', id, json_object('user_id', user_id, 'id', id, 'type', type, 'title', title, 'course_id', course_id, 'date', date, 'start', start, 'end', end, 'location', location, 'status', status, 'grade', grade, 'weight', weight, 'notes', notes, 'checklist', checklist, 'links', links, 'recur', recur, 'weekday', weekday, 'recur_until', recur_until, 'dept', dept, 'completed_at', completed_at, 'created_at', created_at, 'updated_at', updated_at, 'deleted_at', deleted_at, 'revision', revision), deleted_at FROM items;
CREATE TRIGGER quotes_change_insert AFTER INSERT ON quotes BEGIN
 DELETE FROM changes WHERE user_id = NEW.user_id AND kind = 'quotes' AND row_id = NEW.id;
 INSERT INTO changes(user_id, kind, row_id, payload, deleted_at)
 VALUES(NEW.user_id, 'quotes', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'text', NEW.text, 'source', NEW.source, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER quotes_change_update AFTER UPDATE ON quotes BEGIN
 DELETE FROM changes WHERE user_id = NEW.user_id AND kind = 'quotes' AND row_id = NEW.id;
 INSERT INTO changes(user_id, kind, row_id, payload, deleted_at)
 VALUES(NEW.user_id, 'quotes', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'text', NEW.text, 'source', NEW.source, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
INSERT INTO changes(user_id, kind, row_id, payload, deleted_at) SELECT user_id, 'quotes', id, json_object('user_id', user_id, 'id', id, 'text', text, 'source', source, 'created_at', created_at, 'updated_at', updated_at, 'deleted_at', deleted_at, 'revision', revision), deleted_at FROM quotes;
