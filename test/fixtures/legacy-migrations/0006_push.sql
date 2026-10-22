-- Push reminders: each device that turned on the morning digest (worker/push.js). The push
-- carries no payload, so only the endpoint is kept: the service worker fetches the digest
-- itself when the push arrives. A row goes with its account (ON DELETE CASCADE), when the push
-- service says the endpoint is gone (404 or 410), or after five failures in a row.

CREATE TABLE push_subscriptions (
  -- Only the browser push services' hosts are accepted (worker/push.js PUSH_HOSTS).
  endpoint       TEXT PRIMARY KEY CHECK (length(endpoint) BETWEEN 20 AND 1000 AND substr(endpoint, 1, 8) = 'https://'),
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The device's IANA time zone, so the digest comes at 07:00 there.
  tz             TEXT NOT NULL DEFAULT 'UTC' CHECK (length(tz) BETWEEN 1 AND 64),
  created_at     INTEGER NOT NULL,
  last_ok_at     INTEGER,
  -- The local day ('YYYY-MM-DD') the digest last went out, so the hourly cron sends once a day.
  last_sent_day  TEXT CHECK (last_sent_day IS NULL OR length(last_sent_day) = 10),
  failures       INTEGER NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 100)
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);
