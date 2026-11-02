-- Study Buddy, Stage 3 (docs/superpowers/specs/2026-10-14-study-buddy-spec.md §2, §5): flashcard
-- decks, their cards, each person's schedule for a card, and each review. All four sync: decks
-- and cards in their scope's feed like items ('u:<user>' when yours; 'c:<space>' once shared
-- with a class, Stage 7), card_state and card_reviews in your own 'u:' feed only, so one shared
-- deck serves a class while each person's progress stays theirs. Sync v3 never sends these
-- kinds (worker/db.js V3_KINDS); v4 does.

-- A deck: a titled set of cards for one of your courses (course_id), or one filed under a class
-- (class_id), or neither. Labels only, like an item's: the deck stays when the course goes.
CREATE TABLE decks (
  scope       TEXT NOT NULL CHECK (scope GLOB 'u:?*' OR (scope GLOB 'c:?*' AND length(scope) = 14)),
  id          TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  author_id   TEXT NOT NULL CHECK (length(author_id) BETWEEN 1 AND 64),
  course_id   TEXT CHECK (course_id IS NULL OR length(course_id) BETWEEN 1 AND 40),
  class_id    TEXT CHECK (class_id IS NULL OR (length(class_id) = 12 AND class_id NOT GLOB '*[^a-z0-9]*')),
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (scope, id)
);
CREATE INDEX decks_deleted ON decks (deleted_at) WHERE deleted_at IS NOT NULL;

-- A card in a live deck of the same scope (the Worker checks it in the write). `source` is how it
-- was made: by hand, by Workers AI, pasted from your own AI, or through the connector.
CREATE TABLE cards (
  scope       TEXT NOT NULL CHECK (scope GLOB 'u:?*' OR (scope GLOB 'c:?*' AND length(scope) = 14)),
  id          TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  deck_id     TEXT NOT NULL CHECK (length(deck_id) BETWEEN 1 AND 24),
  author_id   TEXT NOT NULL CHECK (length(author_id) BETWEEN 1 AND 64),
  front       TEXT NOT NULL CHECK (length(front) BETWEEN 1 AND 500),
  back        TEXT NOT NULL CHECK (length(back) BETWEEN 1 AND 1000),
  source      TEXT NOT NULL DEFAULT 'hand' CHECK (source IN ('hand', 'ai', 'paste', 'connector')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (scope, id)
);
CREATE INDEX cards_deck ON cards (scope, deck_id);
CREATE INDEX cards_deleted ON cards (deleted_at) WHERE deleted_at IS NOT NULL;

-- Your schedule for one card (src/core/srs.ts), its id the card's: when it is next due, the
-- gap in days, the ease, and how often it was got right in a row or forgotten.
CREATE TABLE card_state (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id          TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  due         TEXT NOT NULL CHECK (due GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  interval    INTEGER NOT NULL CHECK (typeof(interval) = 'integer' AND interval BETWEEN 0 AND 180),
  ease        REAL NOT NULL CHECK (ease BETWEEN 1.3 AND 3.0),
  reps        INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reps) = 'integer' AND reps >= 0),
  lapses      INTEGER NOT NULL DEFAULT 0 CHECK (typeof(lapses) = 'integer' AND lapses >= 0),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX card_state_due ON card_state (user_id, due) WHERE deleted_at IS NULL;
CREATE INDEX card_state_deleted ON card_state (deleted_at) WHERE deleted_at IS NOT NULL;

-- One review of a card, kept as it was (two devices reviewing offline both keep theirs): the
-- card and its deck, your local day, the grade, and when.
CREATE TABLE card_reviews (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id          TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  card_ref    TEXT NOT NULL CHECK (length(card_ref) BETWEEN 1 AND 24),
  deck_ref    TEXT NOT NULL CHECK (length(deck_ref) BETWEEN 1 AND 24),
  day         TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  grade       TEXT NOT NULL CHECK (grade IN ('again', 'good', 'easy')),
  at          INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX card_reviews_day ON card_reviews (user_id, day);
CREATE INDEX card_reviews_deleted ON card_reviews (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TRIGGER decks_change_insert AFTER INSERT ON decks BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'decks' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'decks', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'author_id', NEW.author_id, 'course_id', NEW.course_id, 'class_id', NEW.class_id, 'title', NEW.title, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER decks_change_update AFTER UPDATE ON decks BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'decks' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'decks', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'author_id', NEW.author_id, 'course_id', NEW.course_id, 'class_id', NEW.class_id, 'title', NEW.title, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

CREATE TRIGGER cards_change_insert AFTER INSERT ON cards BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'cards' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'cards', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'deck_id', NEW.deck_id, 'author_id', NEW.author_id, 'front', NEW.front, 'back', NEW.back, 'source', NEW.source, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER cards_change_update AFTER UPDATE ON cards BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'cards' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'cards', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'deck_id', NEW.deck_id, 'author_id', NEW.author_id, 'front', NEW.front, 'back', NEW.back, 'source', NEW.source, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

CREATE TRIGGER card_state_change_insert AFTER INSERT ON card_state BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'card_state' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'card_state', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'due', NEW.due, 'interval', NEW.interval, 'ease', NEW.ease, 'reps', NEW.reps, 'lapses', NEW.lapses, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER card_state_change_update AFTER UPDATE ON card_state BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'card_state' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'card_state', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'due', NEW.due, 'interval', NEW.interval, 'ease', NEW.ease, 'reps', NEW.reps, 'lapses', NEW.lapses, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

CREATE TRIGGER card_reviews_change_insert AFTER INSERT ON card_reviews BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'card_reviews' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'card_reviews', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'card_ref', NEW.card_ref, 'deck_ref', NEW.deck_ref, 'day', NEW.day, 'grade', NEW.grade, 'at', NEW.at, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER card_reviews_change_update AFTER UPDATE ON card_reviews BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'card_reviews' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'card_reviews', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'card_ref', NEW.card_ref, 'deck_ref', NEW.deck_ref, 'day', NEW.day, 'grade', NEW.grade, 'at', NEW.at, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

-- "Review cards in my calendar": all-day "Flashcards: N due" events in the calendar feed.
ALTER TABLE buddy_settings ADD COLUMN cards_in_feed INTEGER NOT NULL DEFAULT 0 CHECK (cards_in_feed IN (0, 1));
