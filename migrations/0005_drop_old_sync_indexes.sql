-- Sync reads the change feed (changes (user_id, seq)) now; these three served the old
-- pull by timestamp and only cost writes.

DROP INDEX courses_user_updated;
DROP INDEX items_user_updated;
DROP INDEX quotes_user_updated;
