-- What members did in a shared space, as they read it (spec §12): the inbox and each space's
-- Activity tab. Separate from `changes`, which keeps only the latest state of a row for sync.
-- Rows about shared items and courses come from the triggers below, which see OLD and NEW, so
-- "from → to" is the real previous value and the actor is NEW.updated_by; member and space
-- rows are written by their routes (worker/activity.js noteStmt). Rows coalesce per
-- (space, actor, verb, subject, person, 10-minute bucket), keeping the first "from"; a change
-- that returns to where it started deletes its row. Kept 90 days (the nightly purge).

CREATE TABLE activity (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- No foreign key: rows about a person outlive the space (a removal, a deleted space).
  space_id      TEXT NOT NULL CHECK (length(space_id) = 12),
  -- Who acted: the user id, '' when unknown. No foreign key: the row outlives the account.
  actor_id      TEXT NOT NULL DEFAULT '',
  verb          TEXT NOT NULL CHECK (verb IN ('item.created', 'item.deleted', 'item.date', 'item.weight', 'item.title',
                  'course.meetings', 'course.instructor', 'task.assigned', 'task.unassigned', 'task.status',
                  'member.joined', 'member.left', 'member.removed', 'member.role',
                  'space.archived', 'space.linked', 'space.transferred', 'space.deleted')),
  -- The item or course id; '' for creations (an import is one row) and space events.
  subject       TEXT NOT NULL DEFAULT '',
  -- Whom it is about (an assignee, a removed member, a new owner); '' for everyone. Never
  -- NULL, so the unique key below can match.
  subject_user  TEXT NOT NULL DEFAULT '',
  old_value     TEXT,
  new_value     TEXT,
  -- {by, title | titles, whom, space, assignees}: names as they were, so a row still reads
  -- after the item, the account or the space is gone.
  detail        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail) AND json_type(detail) = 'object'),
  -- How many changes this row stands for (creations coalesced into one).
  n             INTEGER NOT NULL DEFAULT 1 CHECK (n >= 1),
  bucket        INTEGER NOT NULL,
  at            INTEGER NOT NULL,
  UNIQUE (space_id, actor_id, verb, subject, subject_user, bucket)
);
-- A space's activity, newest first (the Activity tab; the inbox per space you are in).
CREATE INDEX activity_space ON activity (space_id, seq);
-- Rows about a person (the inbox, even after they left the space).
CREATE INDEX activity_about ON activity (subject_user, seq) WHERE subject_user != '';
-- The nightly purge.
CREATE INDEX activity_at ON activity (at);

-- The last activity row a person read. Kept off users, so reading never moves the profile's revision.
CREATE TABLE inbox_seen (
  user_id  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  seq      INTEGER NOT NULL DEFAULT 0 CHECK (seq >= 0)
);

-- A shared item made: one row per actor and bucket, holding up to ten titles; and each assignee
-- a new task starts with. The space's own 'project' item is made with the space and is not news.
CREATE TRIGGER activity_items_insert AFTER INSERT ON items
WHEN NEW.scope NOT GLOB 'u:*' AND NEW.deleted_at IS NULL AND NEW.id != 'project' BEGIN
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'item.created', '', '',
   json_object('titles', json_array(NEW.title), 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE true
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET n = activity.n + 1, at = excluded.at,
   detail = CASE WHEN json_array_length(activity.detail, '$.titles') < 10
     THEN json_insert(activity.detail, '$.titles[#]', json_extract(excluded.detail, '$.titles[0]')) ELSE activity.detail END;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'task.assigned', NEW.id, CASE WHEN a.value = '*' THEN '' ELSE a.value END, a.value,
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by),
     'whom', (SELECT COALESCE(NULLIF(w.display_name, ''), w.username) FROM users AS w WHERE w.id = a.value)),
   NEW.updated_at / 600000, NEW.updated_at
 FROM json_each(NEW.assignees) AS a WHERE NEW.type = 'task'
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET at = excluded.at, detail = excluded.detail;
END;

-- A shared item changed. Each statement records one kind of change; the last deletes any row
-- this change brought back to where it started.
CREATE TRIGGER activity_items_update AFTER UPDATE ON items WHEN NEW.scope NOT GLOB 'u:*' BEGIN
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'item.deleted', NEW.id, '',
   CASE WHEN OLD.deleted_at IS NULL THEN '0' ELSE '1' END, CASE WHEN NEW.deleted_at IS NULL THEN '0' ELSE '1' END,
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE (OLD.deleted_at IS NULL) != (NEW.deleted_at IS NULL)
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'item.date', NEW.id, '',
   OLD.date || '|' || OLD.start || '|' || OLD.end, NEW.date || '|' || NEW.start || '|' || NEW.end,
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE NEW.deleted_at IS NULL AND (OLD.date != NEW.date OR OLD.start != NEW.start OR OLD.end != NEW.end)
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'item.weight', NEW.id, '', CAST(OLD.weight AS TEXT), CAST(NEW.weight AS TEXT),
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE NEW.deleted_at IS NULL AND OLD.weight IS NOT NEW.weight
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'item.title', NEW.id, '', OLD.title, NEW.title,
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE NEW.deleted_at IS NULL AND OLD.title != NEW.title
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'task.assigned', NEW.id, CASE WHEN a.value = '*' THEN '' ELSE a.value END, a.value,
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by),
     'whom', (SELECT COALESCE(NULLIF(w.display_name, ''), w.username) FROM users AS w WHERE w.id = a.value)),
   NEW.updated_at / 600000, NEW.updated_at
 FROM json_each(NEW.assignees) AS a
 WHERE NEW.type = 'task' AND NEW.deleted_at IS NULL AND a.value NOT IN (SELECT o.value FROM json_each(OLD.assignees) AS o)
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET at = excluded.at, detail = excluded.detail;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'task.unassigned', NEW.id, '', OLD.assignees, '[]',
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE NEW.type = 'task' AND NEW.deleted_at IS NULL AND NEW.assignees = '[]' AND OLD.assignees != '[]'
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'task.status', NEW.id, '',
   CASE WHEN OLD.completed_at IS NULL THEN 'todo' ELSE 'done' END, CASE WHEN NEW.completed_at IS NULL THEN 'todo' ELSE 'done' END,
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by),
     'assignees', json(NEW.assignees)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE NEW.scope GLOB 'p:*' AND NEW.type = 'task' AND NEW.deleted_at IS NULL AND (OLD.completed_at IS NULL) != (NEW.completed_at IS NULL)
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 DELETE FROM activity WHERE space_id = substr(NEW.scope, 3) AND actor_id = COALESCE(NEW.updated_by, '') AND bucket = NEW.updated_at / 600000
   AND subject = NEW.id AND subject_user = '' AND verb IN ('item.deleted', 'item.date', 'item.weight', 'item.title', 'task.status') AND old_value IS new_value;
END;

-- A class's course changed: its weekly times and rooms, or its instructor.
CREATE TRIGGER activity_courses_update AFTER UPDATE ON courses WHEN NEW.scope GLOB 'c:*' AND NEW.deleted_at IS NULL BEGIN
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'course.meetings', NEW.id, '', OLD.meetings, NEW.meetings,
   json_object('title', NEW.name, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE OLD.meetings != NEW.meetings
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'course.instructor', NEW.id, '', OLD.instructor, NEW.instructor,
   json_object('title', NEW.name, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE OLD.instructor != NEW.instructor
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 DELETE FROM activity WHERE space_id = substr(NEW.scope, 3) AND actor_id = COALESCE(NEW.updated_by, '') AND bucket = NEW.updated_at / 600000
   AND subject = NEW.id AND subject_user = '' AND verb IN ('course.meetings', 'course.instructor') AND old_value IS new_value;
END;
