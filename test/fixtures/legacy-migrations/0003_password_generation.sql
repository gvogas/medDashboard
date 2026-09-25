-- A per-user counter baked into every session cookie. Bumping it (password reset,
-- "sign out everywhere") makes every existing cookie for that user invalid at once.

ALTER TABLE users ADD COLUMN pw_gen INTEGER NOT NULL DEFAULT 0;
