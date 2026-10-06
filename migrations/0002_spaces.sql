-- Shared spaces: a class ('c:<id>' scope) or a team project ('p:<id>'), and who is in it.
-- A space has no name of its own: a class is named by its one course, a project by its
-- 'project' item. Spec: docs/superpowers/specs/2026-10-02-shared-classes-design.md §3.

CREATE TABLE spaces (
  -- 12 characters of [a-z0-9], made by the Worker, never by a client.
  id              TEXT PRIMARY KEY CHECK (length(id) = 12 AND id NOT GLOB '*[^a-z0-9]*'),
  kind            TEXT NOT NULL CHECK (kind IN ('class', 'project')),
  archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  -- The owner's school calendar, offered to joiners who have none (class only).
  school_calendar TEXT CHECK (school_calendar IS NULL OR (json_valid(school_calendar) AND json_type(school_calendar) = 'object')),
  -- The class assignment a project belongs to (project only; ids, no foreign key).
  parent_space    TEXT CHECK (parent_space IS NULL OR length(parent_space) = 12),
  parent_item     TEXT CHECK (parent_item IS NULL OR length(parent_item) BETWEEN 1 AND 24),
  -- The join code, stored as its SHA-256 (hex), with its expiry and uses left.
  code_hash       TEXT CHECK (code_hash IS NULL OR length(code_hash) = 64),
  code_expires    INTEGER,
  code_uses_left  INTEGER CHECK (code_uses_left IS NULL OR code_uses_left BETWEEN 0 AND 10),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER,
  -- Moved on by every change to the space or its members (worker/spaces.js), so sync
  -- can tell which member lists moved.
  revision        INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  CHECK (school_calendar IS NULL OR kind = 'class'),
  CHECK ((parent_space IS NULL AND parent_item IS NULL) OR (kind = 'project' AND parent_space IS NOT NULL AND parent_item IS NOT NULL))
);
CREATE INDEX spaces_revision ON spaces (revision);
CREATE INDEX spaces_code ON spaces (code_hash) WHERE code_hash IS NOT NULL;
CREATE INDEX spaces_deleted ON spaces (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE members (
  space_id    TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  -- Deleting an account deletes its memberships; Stage 5 transfers or deletes the
  -- spaces it owns first.
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'member')),
  joined_at   INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  -- Left or removed. A rejoin revives the row.
  deleted_at  INTEGER,
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (space_id, user_id)
);
-- Exactly one live owner, stored nowhere else. A transfer demotes before it promotes.
CREATE UNIQUE INDEX members_one_owner ON members (space_id) WHERE role = 'owner' AND deleted_at IS NULL;
-- My spaces, on every sync.
CREATE INDEX members_user ON members (user_id) WHERE deleted_at IS NULL;
CREATE INDEX members_deleted ON members (deleted_at) WHERE deleted_at IS NOT NULL;
