-- Rounds — med school tracker. D1 (SQLite) schema, in one piece.
--
-- This replaces every earlier migration: the live data was copied into a fresh
-- database built from this file (scripts/move-db.mjs), so no table carries the
-- patches of earlier versions. Change the schema with a new numbered file.
--
-- Every table is keyed by its owner and an id: ownership is part of the key, not a
-- filter a handler might forget. Courses and items belong to a scope: 'u:<user id>' for a
-- person's own rows, 'c:<space id>' for a shared class's, 'p:<space id>' for a team
-- project's. The other tables belong to a user. Shape is enforced here with CHECK constraints
-- so a client bug cannot write an unknown type, a malformed date or a huge note.
-- Timestamps are integer milliseconds since the epoch, the unit of Date.now().
-- Deletes are soft (deleted_at); a nightly cron purges tombstones after 30 days.
-- Every synced row has a revision, taken from the change feed's sequence.

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE CHECK (username GLOB '[a-z0-9]*' AND length(username) BETWEEN 3 AND 32),
  password_hash  TEXT NOT NULL,                 -- see worker/password.js
  -- A counter baked into every session cookie. Bumping it (password reset, "sign
  -- out everywhere") makes every existing cookie for that user invalid at once.
  pw_gen         INTEGER NOT NULL DEFAULT 0,
  display_name   TEXT NOT NULL DEFAULT '' CHECK (length(display_name) <= 60),
  coat_name      TEXT NOT NULL DEFAULT '' CHECK (length(coat_name) <= 28),
  coat_role      TEXT NOT NULL DEFAULT '' CHECK (length(coat_role) <= 34),
  coat_color     TEXT NOT NULL DEFAULT '#17B3AE'
                 CHECK (coat_color IN ('#E4749B', '#8B5CC7', '#17B3AE', '#79B6EA', '#BCA6E6')),
  theme          TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  -- The theme (Medicine, Computer Science, Law, Aviation, Sports, Engineering),
  -- independent of the light/dark appearance.
  bg             TEXT NOT NULL DEFAULT 'med' CHECK (bg IN ('med', 'cs', 'law', 'pilot', 'sports', 'eng')),
  term_start     TEXT CHECK (term_start IS NULL
                             OR term_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- The person's item types as JSON: overrides for the built-ins (label, colour,
  -- hidden, order) and their own types, ids 'c-' plus 1-12 lowercase letters or
  -- digits. The Worker validates the shape; this only checks a bounded array.
  types          TEXT NOT NULL DEFAULT '[]'
                 CHECK (json_valid(types) AND json_type(types) = 'array' AND json_array_length(types) <= 20),
  -- The study timer's Study and Break steps, each 1-180 minutes, repeated 1-12
  -- rounds. The Worker checks the shape (worker/validate.js); this only checks it is
  -- a JSON object.
  study_flow     TEXT NOT NULL DEFAULT '{"steps":[["study",25],["break",5]],"rounds":4}'
                 CHECK (json_valid(study_flow) AND json_type(study_flow) = 'object'),
  -- The calendar feed: a number while it is on, NULL when off. The feed's URL carries
  -- an HMAC of the user id and this number (worker/calendar.js), so bumping it
  -- retires every earlier link and nothing secret is stored.
  feed_gen       INTEGER CHECK (feed_gen IS NULL OR (typeof(feed_gen) = 'integer' AND feed_gen > 0)),
  -- The study goal, streak rules and celebrations: {goal, dayMin, rest, celebrate}. The
  -- Worker checks the shape (worker/validate.js); this only checks it is an object.
  study_prefs    TEXT NOT NULL DEFAULT '{}'
                 CHECK (json_valid(study_prefs) AND json_type(study_prefs) = 'object'),
  -- The school's academic calendar: its semesters and special days (no classes, study
  -- break, exams, a day on another weekday's timetable, markers); {} is none. Checked in
  -- the Worker (worker/validate.js); src/core/school.ts reads it, as does the calendar feed.
  school_calendar TEXT NOT NULL DEFAULT '{}'
                 CHECK (json_valid(school_calendar) AND json_type(school_calendar) = 'object'),
  -- 1 when the person has joined the study leaderboard, which is opt-in: only those who
  -- have joined see it, and only they are listed (worker/leaderboard.js).
  leaderboard    INTEGER NOT NULL DEFAULT 0 CHECK (leaderboard IN (0, 1)),
  -- 1 for an account that may open the Admin page (worker/admin.js). Set the first one
  -- with `npm run user:add -- <name> --admin --remote`; after that, from the page.
  is_admin       INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  -- The last UTC day the person opened the app ('YYYY-MM-DD'), written by GET /api/me at
  -- most once a day, so it costs one write per person per day.
  last_seen_day  TEXT CHECK (last_seen_day IS NULL
                             OR last_seen_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- What the person has hidden from their calendar: 'course:<id>', 'space:<id>' and
  -- 'personal'. The calendar feed honours it too.
  hidden_sources TEXT NOT NULL DEFAULT '[]'
                 CHECK (json_valid(hidden_sources) AND json_type(hidden_sources) = 'array'
                        AND json_array_length(hidden_sources) <= 40),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  revision       INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0)
);

CREATE TABLE courses (
  -- 'u:<user id>' for a person's own course, 'c:<space id>' for a shared class's one course.
  scope       TEXT NOT NULL CHECK ((scope GLOB 'u:?*' OR scope GLOB 'c:?*') AND length(scope) <= 40),
  id          TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  code       TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 8),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  -- The twelve course colours; the first five are also the coat colours.
  color       TEXT NOT NULL CHECK (color IN ('#E4749B', '#8B5CC7', '#17B3AE', '#79B6EA', '#BCA6E6',
                                              '#F08A6C', '#E8B33A', '#4FBF8B', '#8FAE86', '#4F74D9', '#B8457E', '#7D8A99')),
  instructor  TEXT NOT NULL DEFAULT '' CHECK (length(instructor) <= 60),
  term        TEXT NOT NULL DEFAULT '' CHECK (length(term) <= 40),
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  -- The weekly class timetable: [{id, kind, weekday, start, end, room}], at most 12.
  -- Each entry is validated in the Worker; SQLite checks it is a bounded JSON array.
  meetings    TEXT NOT NULL DEFAULT '[]'
              CHECK (json_valid(meetings) AND json_type(meetings) = 'array'
                     AND json_array_length(meetings) <= 12),
  -- The final grade the person is aiming for, or none.
  target      INTEGER CHECK (target IS NULL OR (typeof(target) = 'integer' AND target BETWEEN 1 AND 100)),
  -- The member who last wrote a shared class's course; NULL on a person's own.
  updated_by  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (scope, id),
  -- A class's course holds the class's facts only: each member's target and "archived in
  -- my sidebar" live in their space_prefs. Its colour and term are the class's defaults.
  CHECK (scope GLOB 'u:*' OR (target IS NULL AND archived = 0))
);

CREATE TABLE items (
  -- 'u:<user id>', 'c:<space id>' (a class's item) or 'p:<space id>' (a project item or task).
  scope         TEXT NOT NULL CHECK ((scope GLOB 'u:?*' OR scope GLOB 'c:?*' OR scope GLOB 'p:?*') AND length(scope) <= 40),
  id            TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  -- A built-in type, or one of the person's own ('c-' ids, see users.types).
  type          TEXT NOT NULL CHECK (type IN ('exam', 'quiz', 'assignment', 'lab', 'tutoring', 'office', 'task', 'project')
                                 OR (type GLOB 'c-?*' AND length(type) <= 14 AND substr(type, 3) NOT GLOB '*[^a-z0-9]*')),
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
  -- The member who last wrote a shared row; NULL on a person's own.
  updated_by    TEXT,
  -- A personal item kept under a shared class (the class's space id): an extra quiz, a
  -- lecture review. No foreign key, since it crosses scopes. A label on the person's own
  -- row: it is shape-checked only and never grants access.
  class_id      TEXT CHECK (class_id IS NULL OR length(class_id) BETWEEN 1 AND 24),
  -- A task's assignees: user ids, or ["*"] for everyone. Project rows only.
  assignees     TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(assignees) AND json_type(assignees) = 'array'
                       AND json_array_length(assignees) <= 30),
  -- Who finished a project task. Project rows only.
  completed_by  TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  revision      INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (scope, id),
  -- A course reference can only point at a course in the same scope. SET NULL would
  -- also null the scope, so a hard delete is refused while references remain: the API
  -- soft-deletes a course and detaches its items together, and the nightly purge comes after.
  FOREIGN KEY (scope, course_id) REFERENCES courses(scope, id) ON DELETE RESTRICT,
  -- A weekly slot needs a weekday.
  CHECK (recur IS NULL OR weekday IS NOT NULL),
  -- What each kind of scope may hold. A class row hangs off the class's one course and is
  -- the class's facts only: everyone's
  -- status, grade and checklist live in their own marks. A project row's status,
  -- completion and checklist (subtasks) are the team's; it never carries a grade or weight.
  CHECK (CASE substr(scope, 1, 2)
    WHEN 'u:' THEN assignees = '[]' AND completed_by IS NULL AND (class_id IS NULL OR course_id IS NULL)
    WHEN 'c:' THEN course_id IS NOT NULL AND grade IS NULL AND checklist = '[]' AND status = 'todo' AND completed_at IS NULL
                   AND completed_by IS NULL AND assignees = '[]' AND class_id IS NULL AND type NOT GLOB 'c-*'
    ELSE grade IS NULL AND weight IS NULL AND course_id IS NULL AND class_id IS NULL AND type IN ('project', 'task')
  END)
);

CREATE TABLE quotes (
  user_id     TEXT NOT NULL REFERENCES users(id),
  id          TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  text        TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 300),
  source      TEXT NOT NULL DEFAULT '' CHECK (length(source) <= 80),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (user_id, id)
);

-- Study time only; breaks are never logged. The course and item are plain references:
-- deleting either clears them here (worker/db.js), and a session outlives both.
CREATE TABLE study_sessions (
  user_id        TEXT NOT NULL REFERENCES users(id),
  id             TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  course_id      TEXT CHECK (course_id IS NULL OR length(course_id) BETWEEN 1 AND 40),
  item_id        TEXT CHECK (item_id IS NULL OR length(item_id) BETWEEN 1 AND 24),
  -- The shared space course_id or item_id belongs to, when it is a class's or a project's.
  space_id       TEXT CHECK (space_id IS NULL OR length(space_id) BETWEEN 1 AND 24),
  started_at     INTEGER NOT NULL CHECK (typeof(started_at) = 'integer' AND started_at > 0),
  study_minutes  INTEGER NOT NULL CHECK (typeof(study_minutes) = 'integer' AND study_minutes BETWEEN 1 AND 1440),
  rounds_done    INTEGER NOT NULL DEFAULT 0 CHECK (typeof(rounds_done) = 'integer' AND rounds_done BETWEEN 0 AND 12),
  note           TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 200),   -- what was covered
  manual         INTEGER NOT NULL DEFAULT 0 CHECK (manual IN (0, 1)),    -- 1 when typed in with Log study, not timed
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

-- Your own achievements: a sticker you uploaded, a name, and what earns it: hours studied
-- on one course, or a grade on one exam or quiz. Earned or not is worked out on the
-- device from sessions and items; nothing here records it. The sticker is the picture
-- itself, a small data: URL (256px, cut to a circle in the browser), so it syncs and
-- works offline like every other row, and is only ever served to the account that owns
-- it. The course and item are plain references, like a study session's: a deleted one
-- leaves the achievement locked. At most 30 live rows per account (worker/db.js).
CREATE TABLE achievements (
  user_id     TEXT NOT NULL REFERENCES users(id),
  id          TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  sticker     TEXT NOT NULL CHECK (length(sticker) BETWEEN 1 AND 90000 AND sticker LIKE 'data:image/%'),
  rule        TEXT NOT NULL CHECK (rule IN ('hours', 'grade')),
  course_id   TEXT CHECK (course_id IS NULL OR length(course_id) BETWEEN 1 AND 40),
  item_id     TEXT CHECK (item_id IS NULL OR length(item_id) BETWEEN 1 AND 24),
  -- The shared space course_id or item_id belongs to, when it is a class's or a project's.
  space_id       TEXT CHECK (space_id IS NULL OR length(space_id) BETWEEN 1 AND 24),
  target     INTEGER NOT NULL CHECK (typeof(target) = 'integer' AND target BETWEEN 1 AND 1000),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (user_id, id),
  CHECK ((rule = 'hours' AND course_id IS NOT NULL AND item_id IS NULL)
      OR (rule = 'grade' AND item_id IS NOT NULL AND course_id IS NULL AND target <= 100))
);
CREATE INDEX achievements_deleted ON achievements (deleted_at) WHERE deleted_at IS NOT NULL;

-- A term's items, and a course's.
CREATE INDEX items_scope_date   ON items (scope, date);
CREATE INDEX items_scope_course ON items (scope, course_id);

-- The nightly tombstone purge.
CREATE INDEX courses_deleted ON courses (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX items_deleted   ON items   (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX quotes_deleted  ON quotes  (deleted_at) WHERE deleted_at IS NOT NULL;

-- A compact, ordered change feed: each row keeps only its latest change, and a
-- device pulls everything after its cursor. Tombstones below the floor are purged;
-- a cursor below the floor or past the head starts a full resync.
CREATE TABLE changes (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Whose feed: 'u:<user id>', 'c:<space id>' or 'p:<space id>'. No foreign key, so
  -- deleting an account deletes its 'u:' rows explicitly (worker/accounts.js).
  scope       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  payload     TEXT NOT NULL,
  deleted_at  INTEGER,
  UNIQUE (scope, kind, row_id)
);
CREATE INDEX changes_scope_seq ON changes (scope, seq);
CREATE INDEX changes_deleted  ON changes (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), floor INTEGER NOT NULL DEFAULT 0);
INSERT INTO sync_state (id) VALUES (1);

CREATE TRIGGER courses_change_insert AFTER INSERT ON courses BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'courses' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'courses', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'code', NEW.code, 'name', NEW.name, 'color', NEW.color, 'instructor', NEW.instructor, 'term', NEW.term, 'archived', NEW.archived, 'meetings', NEW.meetings, 'target', NEW.target, 'updated_by', NEW.updated_by, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER courses_change_update AFTER UPDATE ON courses BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'courses' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'courses', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'code', NEW.code, 'name', NEW.name, 'color', NEW.color, 'instructor', NEW.instructor, 'term', NEW.term, 'archived', NEW.archived, 'meetings', NEW.meetings, 'target', NEW.target, 'updated_by', NEW.updated_by, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

CREATE TRIGGER items_change_insert AFTER INSERT ON items BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'items' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'items', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'type', NEW.type, 'title', NEW.title, 'course_id', NEW.course_id, 'date', NEW.date, 'start', NEW.start, 'end', NEW.end, 'location', NEW.location, 'status', NEW.status, 'grade', NEW.grade, 'weight', NEW.weight, 'notes', NEW.notes, 'checklist', NEW.checklist, 'links', NEW.links, 'recur', NEW.recur, 'weekday', NEW.weekday, 'recur_until', NEW.recur_until, 'dept', NEW.dept, 'completed_at', NEW.completed_at, 'updated_by', NEW.updated_by, 'class_id', NEW.class_id, 'assignees', NEW.assignees, 'completed_by', NEW.completed_by, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER items_change_update AFTER UPDATE ON items BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'items' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'items', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'type', NEW.type, 'title', NEW.title, 'course_id', NEW.course_id, 'date', NEW.date, 'start', NEW.start, 'end', NEW.end, 'location', NEW.location, 'status', NEW.status, 'grade', NEW.grade, 'weight', NEW.weight, 'notes', NEW.notes, 'checklist', NEW.checklist, 'links', NEW.links, 'recur', NEW.recur, 'weekday', NEW.weekday, 'recur_until', NEW.recur_until, 'dept', NEW.dept, 'completed_at', NEW.completed_at, 'updated_by', NEW.updated_by, 'class_id', NEW.class_id, 'assignees', NEW.assignees, 'completed_by', NEW.completed_by, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

CREATE TRIGGER quotes_change_insert AFTER INSERT ON quotes BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'quotes' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'quotes', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'text', NEW.text, 'source', NEW.source, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER quotes_change_update AFTER UPDATE ON quotes BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'quotes' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'quotes', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'text', NEW.text, 'source', NEW.source, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

CREATE TRIGGER study_sessions_change_insert AFTER INSERT ON study_sessions BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'study_sessions' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'study_sessions', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'space_id', NEW.space_id, 'started_at', NEW.started_at, 'study_minutes', NEW.study_minutes, 'rounds_done', NEW.rounds_done, 'note', NEW.note, 'manual', NEW.manual, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER study_sessions_change_update AFTER UPDATE ON study_sessions BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'study_sessions' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'study_sessions', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'space_id', NEW.space_id, 'started_at', NEW.started_at, 'study_minutes', NEW.study_minutes, 'rounds_done', NEW.rounds_done, 'note', NEW.note, 'manual', NEW.manual, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

CREATE TRIGGER achievements_change_insert AFTER INSERT ON achievements BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'achievements' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'achievements', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'name', NEW.name, 'sticker', NEW.sticker, 'rule', NEW.rule, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'space_id', NEW.space_id, 'target', NEW.target, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER achievements_change_update AFTER UPDATE ON achievements BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'achievements' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'achievements', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'name', NEW.name, 'sticker', NEW.sticker, 'rule', NEW.rule, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'space_id', NEW.space_id, 'target', NEW.target, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

-- Failed sign-in counts per username, so a password cannot be guessed by brute force.
-- Rows are written only on failure and removed on success; see worker/throttle.js.
CREATE TABLE login_throttle (
  username      TEXT PRIMARY KEY,
  fails         INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER NOT NULL DEFAULT 0,   -- ms since the epoch; 0 = not locked
  updated_at    INTEGER NOT NULL
);
CREATE INDEX login_throttle_updated ON login_throttle (updated_at, locked_until);

-- Shared across Worker isolates: bounded request windows and upstream cooldowns.
CREATE TABLE request_limits (
  key       TEXT PRIMARY KEY,
  hits      INTEGER NOT NULL DEFAULT 0,
  reset_at  INTEGER NOT NULL
);
CREATE INDEX request_limits_reset ON request_limits (reset_at);

-- One Spotify connection per user. The refresh token is AES-GCM ciphertext under a
-- key derived from SESSION_SECRET (see worker/spotify.js); the access token is
-- short-lived and stored in clear.
CREATE TABLE spotify_tokens (
  user_id        TEXT PRIMARY KEY REFERENCES users(id),
  refresh_token  TEXT NOT NULL,
  access_token   TEXT NOT NULL,
  expires_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- Bind OAuth attempts to the initiating account and consume them exactly once.
CREATE TABLE spotify_oauth_states (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX spotify_oauth_states_expires ON spotify_oauth_states (expires_at);

-- A short lease prevents simultaneous refresh-token rotation across isolates.
CREATE TABLE spotify_refresh_locks (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX spotify_refresh_locks_expires ON spotify_refresh_locks (expires_at);

-- Read-only views for looking around with `wrangler d1 execute`.
CREATE VIEW active_items AS
SELECT substr(i.scope, 3) AS user_id, i.id, i.type, i.title, i.date, i.start, i.end, i.status,
       i.course_id, c.code AS course_code, c.name AS course_name, i.revision
FROM items AS i
LEFT JOIN courses AS c
  ON c.scope = i.scope AND c.id = i.course_id AND c.deleted_at IS NULL
WHERE i.deleted_at IS NULL AND i.scope GLOB 'u:*';

CREATE VIEW account_summary AS
SELECT u.id AS user_id, u.username, u.created_at,
       (SELECT count(*) FROM courses AS c WHERE c.scope = 'u:' || u.id AND c.deleted_at IS NULL) AS courses,
       (SELECT count(*) FROM items AS i WHERE i.scope = 'u:' || u.id AND i.deleted_at IS NULL) AS items,
       (SELECT count(*) FROM quotes AS q WHERE q.user_id = u.id AND q.deleted_at IS NULL) AS quotes,
       (SELECT count(*) FROM study_sessions AS s WHERE s.user_id = u.id AND s.deleted_at IS NULL) AS study_sessions
FROM users AS u;

-- ── the Admin page (worker/admin.js) ──────────────────────────────────────────

-- Unexpected failures the Worker caught: 500s and failed AI reads. Capped per day
-- (worker/errors.js) and kept 30 days by the nightly cron.
CREATE TABLE error_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       INTEGER NOT NULL,
  method   TEXT NOT NULL DEFAULT '' CHECK (length(method) <= 8),
  route    TEXT NOT NULL DEFAULT '' CHECK (length(route) <= 200),
  status   INTEGER NOT NULL DEFAULT 500,
  message  TEXT NOT NULL DEFAULT '' CHECK (length(message) <= 500),
  user_id  TEXT
);
CREATE INDEX error_log_at ON error_log (at);

-- What admins did. Names, not foreign keys: the entry outlives a deleted account.
-- Kept 90 days by the nightly cron.
CREATE TABLE admin_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       INTEGER NOT NULL,
  admin    TEXT NOT NULL,          -- the admin's username
  action   TEXT NOT NULL CHECK (action IN ('create', 'reset', 'revoke', 'delete', 'promote', 'demote', 'unlock', 'announce', 'unannounce')),
  target   TEXT NOT NULL DEFAULT '',
  detail   TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 300)
);
CREATE INDEX admin_log_at ON admin_log (at);

-- App-wide values: 'announcement' (JSON {id, text, until}) and 'cron' (the nightly
-- run's time).
CREATE TABLE app_meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
