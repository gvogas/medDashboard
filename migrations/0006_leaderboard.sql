-- The study leaderboard is opt-in: 1 when the user has joined it. Only users who
-- have joined see it, and only they are listed (worker/leaderboard.js).

ALTER TABLE users ADD COLUMN leaderboard INTEGER NOT NULL DEFAULT 0 CHECK (leaderboard IN (0, 1));
