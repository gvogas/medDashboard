-- The calendar feed's off switch. feed_gen only ever counts up (a stopped feed keeps its number, so
-- no link is issued twice); whether the feed is on is this flag. The CHECK on feed_gen still
-- requires a positive number or NULL.
ALTER TABLE users ADD COLUMN feed_off INTEGER NOT NULL DEFAULT 0 CHECK (feed_off IN (0, 1));
