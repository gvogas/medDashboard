-- Rounds — med school tracker. D1 (SQLite) schema.
--
-- Every user-owned table is keyed by (user_id, id): ownership is part of the key,
-- not a filter a handler might forget. Shape is enforced here with CHECK constraints
-- so a client bug cannot write an unknown type, a malformed date or a huge note.
-- Timestamps are integer milliseconds since the epoch, the unit of Date.now().
-- Deletes are soft (deleted_at); a nightly cron purges tombstones after 30 days.

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE CHECK (username GLOB '[a-z0-9]*' AND length(username) BETWEEN 3 AND 32),
  password_hash  TEXT NOT NULL,                 -- see worker/password.js
  display_name   TEXT NOT NULL DEFAULT '' CHECK (length(display_name) <= 60),
  coat_name      TEXT NOT NULL DEFAULT '' CHECK (length(coat_name) <= 28),
  coat_role      TEXT NOT NULL DEFAULT '' CHECK (length(coat_role) <= 34),
  coat_color     TEXT NOT NULL DEFAULT '#17B3AE'
                 CHECK (coat_color IN ('#E4749B', '#8B5CC7', '#17B3AE', '#79B6EA', '#BCA6E6')),
  theme          TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  term_start     TEXT CHECK (term_start IS NULL
                             OR term_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  imported_at    INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE courses (
  user_id     TEXT NOT NULL REFERENCES users(id),
  id          TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  code        TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 8),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  color       TEXT NOT NULL CHECK (color IN ('#E4749B', '#8B5CC7', '#17B3AE', '#79B6EA', '#BCA6E6')),
  instructor  TEXT NOT NULL DEFAULT '' CHECK (length(instructor) <= 60),
  term        TEXT NOT NULL DEFAULT '' CHECK (length(term) <= 40),
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  -- The weekly class timetable: [{id, kind, weekday, start, end, room}], at most 12.
  -- Each entry is validated in the Worker; SQLite checks it is a bounded JSON array.
  meetings    TEXT NOT NULL DEFAULT '[]'
              CHECK (json_valid(meetings) AND json_type(meetings) = 'array'
                     AND json_array_length(meetings) <= 12),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE items (
  user_id       TEXT NOT NULL REFERENCES users(id),
  id            TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  type          TEXT NOT NULL CHECK (type IN ('exam', 'assignment', 'lab', 'tutoring', 'office', 'task')),
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
  PRIMARY KEY (user_id, id),
  -- A course reference can only point at the same user's course.
  FOREIGN KEY (user_id, course_id) REFERENCES courses(user_id, id) ON DELETE SET NULL,
  -- A weekly slot needs a weekday.
  CHECK (recur IS NULL OR weekday IS NOT NULL)
);

CREATE TABLE quotes (
  user_id     TEXT NOT NULL REFERENCES users(id),
  id          TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  text        TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 300),
  source      TEXT NOT NULL DEFAULT '' CHECK (length(source) <= 80),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (user_id, id)
);

-- The sync pull: every row of mine changed since a timestamp.
CREATE INDEX courses_user_updated ON courses (user_id, updated_at);
CREATE INDEX items_user_updated   ON items   (user_id, updated_at);
CREATE INDEX quotes_user_updated  ON quotes  (user_id, updated_at);

-- A future "this term only" query.
CREATE INDEX items_user_date ON items (user_id, date);

-- The nightly tombstone purge.
CREATE INDEX courses_deleted ON courses (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX items_deleted   ON items   (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX quotes_deleted  ON quotes  (deleted_at) WHERE deleted_at IS NOT NULL;
