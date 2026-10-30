-- Room chat (study together): short messages between the people in a room. They are not synced
-- and are not in the change feed. They go when the room does (the nightly purge deletes rooms
-- 90 days after they end).
CREATE TABLE room_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at  INTEGER NOT NULL
);
CREATE INDEX room_messages_room ON room_messages (room_id, id);
