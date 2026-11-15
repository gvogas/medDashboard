-- The leaderboard (worker/leaderboard.js TOTALS) sums every joined person's study minutes on each
-- view. Without these it scans every user, then reads each session row for its minutes and its
-- tombstone. With them it reads the joined users from a small partial index and their minutes from
-- a covering index, touching no table row. Additive: no data changes.
CREATE INDEX users_leaderboard ON users (id) WHERE leaderboard = 1;
CREATE INDEX study_sessions_board ON study_sessions (user_id, deleted_at, started_at, study_minutes);
