-- Friends: a request the other person declined, which the asker then cancelled. The row stays
-- (still declined, still purged 30 days after declined_at) instead of being deleted, so asking
-- again stays silent: deleting it would let the asker send a fresh request the other person
-- sees again, and again. cancelled_at is set when the asker cancels, cleared when they ask again.
ALTER TABLE friendships ADD COLUMN cancelled_at INTEGER;
