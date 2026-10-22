# Study together: design

Date: 2026-10-21. Approved prototype: https://claude.ai/artifact/AZ8dFbcYmd4UnMeo8WErUw

People add each other as friends, then study in a shared room: one timer that everyone follows. Each person's minutes are logged to their own study sessions, and the room keeps a group record of who was there.

## Decisions

| Question | Decision |
|---|---|
| Who can study together | Friends. Anyone on the app can be added. |
| Adding a friend | Search by name or username, send a request, the other person accepts. |
| Starting | The host invites friends. A list shows which friends are studying now, with Join. |
| The timer | Shared. The host pauses, skips and ends it. Anyone can leave whenever they like. |
| Logging | Each person's own session (as today), plus a group record per room. |
| Keeping devices in sync | D1 plus polling (no Durable Objects). Free tier only. |

## 1. Friends

**Where.** A fifth Study tab, **Friends**, after Leaderboard. Until you have friends it shows a "New" pill; while requests are waiting it shows how many.

**Search.** "Add friends" takes at least 2 characters and returns up to 8 people whose username or display name contains the text, excluding you. People who turned off **Let people find me in search** (`friend_settings.findable = 0`) appear only when the text is their exact username. Each result shows its state: Add, Requested, Accept (they asked you first), or Friends. Searches share a limit of 30 per minute per user (`request_limits`).

**Requests.** Add sends a request. If the other person has already asked you, Add accepts their request instead. The other person sees the request on the Friends tab and in the inbox bell, and can Accept or Decline. Declining is silent: the sender keeps seeing "Requested" until they cancel, and the row is deleted after 30 days. Limits: 20 requests sent a day, 200 friends each. Remove deletes the friendship, and either person can send a new request later.

**Friends list.** First comes **Studying now**: friends who have **Show friends when I'm studying** on and have a run going. Each shows their class name and how long they've been going. A friend in a room has **Join**. A friend studying alone has **Invite**, which opens Study together with that friend already ticked. (The prototype's "Ask to join" became Invite; it does the same job without a new kind of message.) Under that comes everyone else, showing when they last studied, with Invite and Remove.

**Settings.** The two switches sit at the bottom of the Friends tab. Both are on by default and stored in `friend_settings` (no row means both on), so a change never moves the profile's revision.

## 2. Rooms

**Starting.** The Timer tab gets a second card, **Study together**. It opens a sheet with three parts: a flow picker (the same presets and custom flows as the solo timer), **Your class** (your own course or item, as in the solo timer), and friends to invite. If a solo run is already going, Start asks whether to end it first, the same as starting a new run does today.

**Who can join.** Anyone who was invited, or who is a friend of the host. A room holds up to 8 people. Each person can be in only one room at a time; joining another means leaving the first.

**The clock.** The room stores the same run record the solo timer uses (`core/timer.ts`): `{flow, startedAt, pausedAt, pausedMs, skippedMs, skippedStudyMs}`. Every device works out the clock locally from that record, so polls are needed only to catch changes. Only the host's Pause, Resume, Skip and End change the record, and each change bumps `rooms.version`.

**Your minutes.** When you join, the server stores the room's study time so far as `joined_study_ms`. When you leave, or the room ends, your study time is the room's study time at that moment minus `joined_study_ms`. Pauses and skips are already in the arithmetic, so they count the same way they do when you study alone.

**Leaving and the host.** Leave saves your session and takes you out of the room. If the host leaves, the member who has been there longest becomes host. The room ends when the last person leaves, when the host presses End for everyone, or when the flow finishes. A member counts as away if no poll has come from them for 2 minutes. After 10 minutes the server marks them as gone, and their device logs their minutes the next time it opens (see Offline).

**Your class in a room.** Each person picks their own course or item, and can change it during the session. The name of what they picked (`course_label`) is shown to the room. The ids stay on their device.

**The room screen.** It is the focus screen with a people panel. The panel lists each member with their class label and minutes so far, marks the host, and has an activity list (joined, left, paused, skipped). The host sees Pause/Resume for everyone, Skip, End for everyone, Leave, and Invite more. Other members see Pause disabled, the line "<Host> controls the timer", and Leave. Music works the same as it does alone.

## 3. Logging and the group record

- `study_sessions` gets a new column, `room_id`, which syncs as `roomId`. The session id is `r-` plus the room id, so two devices in the same room write one row and logging twice changes nothing. `roomId` goes in `KEPT_WHEN_ABSENT` in `worker/db.js`, so an older client that edits the session doesn't clear it.
- Because the minutes are an ordinary session, they count toward the daily goal, streak, history, achievements and leaderboard, and nothing in those places changes.
- **Summary at the end.** A sheet says "You studied 1h 40m with Priya and Sam" and shows bars for each person's minutes and the group total, with an Add a note button.
- **Group record.** `GET /api/rooms/:id/record` returns the members and each person's minutes. The minutes are the sum of the `study_sessions` rows with that `room_id`, so if someone edits or deletes their own session, their row in the record changes too. Only people who were in the room can read it.
- **History.** Sessions with a `roomId` show a "with" row of friend chips and a Group record button. A new Study tile, **With friends this week**, adds up those sessions.

## 4. Data

Each stage brings its own migration: `0006_friends.sql` (Stage 1, as built: `friendships` with a `declined_at` column so a decline never changes what the asker sees, and `friend_settings` in place of the two `users` columns below), then `0007_rooms.sql` and `0008_presence.sql`. The sketch below is the first design; Stage 1's file is the reference for the friends tables.

```sql
-- Built instead as friend_settings (user_id, findable, show_studying).
ALTER TABLE users ADD COLUMN findable      INTEGER NOT NULL DEFAULT 1 CHECK (findable IN (0, 1));
ALTER TABLE users ADD COLUMN show_studying INTEGER NOT NULL DEFAULT 1 CHECK (show_studying IN (0, 1));

-- One row per pair, smaller id first. pending → accepted or declined. Removing a friend or
-- cancelling a request deletes the row; a decline is kept 30 days so the sender is not told.
CREATE TABLE friendships (
  user_lo       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_hi       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at    INTEGER NOT NULL,
  accepted_at   INTEGER,
  PRIMARY KEY (user_lo, user_hi),
  CHECK (user_lo < user_hi AND requested_by IN (user_lo, user_hi))
);
CREATE INDEX friendships_hi ON friendships (user_hi);

CREATE TABLE rooms (
  id                TEXT PRIMARY KEY CHECK (length(id) = 12),
  host_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  flow              TEXT NOT NULL CHECK (json_valid(flow)),
  started_at        INTEGER NOT NULL,
  paused_at         INTEGER,
  paused_ms         INTEGER NOT NULL DEFAULT 0,
  skipped_ms        INTEGER NOT NULL DEFAULT 0,
  skipped_study_ms  INTEGER NOT NULL DEFAULT 0,
  ended_at          INTEGER,
  -- The last 20 room events (joined, left, paused, skipped), newest first.
  feed              TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(feed)),
  version           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX rooms_open ON rooms (ended_at) WHERE ended_at IS NULL;

-- Invited, in, or left. One row per person and room.
CREATE TABLE room_members (
  room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state            TEXT NOT NULL CHECK (state IN ('invited', 'in', 'left')),
  invited_by       TEXT,
  joined_at        INTEGER,
  joined_study_ms  INTEGER,
  left_at          INTEGER,
  last_seen        INTEGER,
  course_label     TEXT NOT NULL DEFAULT '' CHECK (length(course_label) <= 60),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX room_members_user ON room_members (user_id, state);

-- A solo run, so friends can see you studying. Deleted on stop; ends_at bounds a lost device.
CREATE TABLE presence (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  course_label  TEXT NOT NULL DEFAULT '' CHECK (length(course_label) <= 60),
  started_at    INTEGER NOT NULL,
  ends_at       INTEGER NOT NULL
);

ALTER TABLE study_sessions ADD COLUMN room_id TEXT CHECK (room_id IS NULL OR length(room_id) = 12);
CREATE INDEX study_sessions_room ON study_sessions (room_id) WHERE room_id IS NOT NULL;
```

Room events go in `rooms.feed`, not the `activity` table, because `activity` belongs to spaces. The nightly cron ends rooms that nobody has polled for 30 minutes, deletes `presence` rows past `ends_at`, deletes declined requests after 30 days, and deletes rooms 90 days after they end, keeping any room that sessions still point to.

## 5. API (worker/friends.js, worker/rooms.js)

| Route | What it does |
|---|---|
| `GET /api/friends` | friends (with live status), incoming and sent requests, the two settings |
| `GET /api/friends/search?q=` | up to 8 matches with their state |
| `POST /api/friends` `{username}` | request, or accept if they already asked |
| `PUT /api/friends/:userId` `{accept: bool}` | accept or decline |
| `DELETE /api/friends/:userId` | remove, or cancel a request |
| `PUT /api/friends/settings` `{findable, showStudying}` | the two switches |
| `PUT /api/presence` / `DELETE /api/presence` | a solo run started or stopped (sent only when show_studying is on) |
| `POST /api/rooms` `{flow, courseLabel, invite: [userId]}` | start a room; you are host and in it |
| `GET /api/rooms/:id?v=` | the room; 304 when `version` and the member list have not changed; updates your `last_seen` |
| `POST /api/rooms/:id/join` `{courseLabel}` | join (invited or a friend of the host, under 8, one room at a time) |
| `POST /api/rooms/:id/leave` | leave; hands over host if needed; ends the room if empty |
| `PUT /api/rooms/:id/clock` `{action: pause\|resume\|skip\|end}` | host only; bumps version |
| `POST /api/rooms/:id/invite` `{userIds}` | host only; friends only |
| `PUT /api/rooms/:id/me` `{courseLabel}` | change what you show |
| `GET /api/rooms/:id/record` | the group record; past members only |

`GET /api/inbox` also returns `friendRequests` and `roomInvites` (invites to rooms that are still open), and the bell counts both. Every route checks friendship or membership on the server. The client hides buttons for convenience only.

## 6. Polling and cost

- In a room, the client polls `GET /api/rooms/:id` every 5 s while the tab is visible and every 30 s while it is hidden. The clock runs locally either way. A hidden tab still has to poll, so it notices when the host ends the room (see the tab-hidden polling note in Stage 6).
- The Friends tab and the Timer card poll `GET /api/friends` every 60 s while the Study page is open. The inbox keeps its current schedule.
- Cost: one person in a room for an hour makes about 720 requests, so 10 people studying 2 hours a day is about 15k of the free 100k requests per day. Each poll is one small D1 read plus a `last_seen` write. The write is skipped if `last_seen` was set less than 30 s ago.

## 7. Offline and failures

- The run in a room is stored on the device the same way a solo run is (`run.ts`), with `roomId` added. A reload resumes it, and polling picks up from there.
- If you lose your connection, the clock keeps running locally from the last record and a "Reconnecting" note appears. When you reconnect, the latest record replaces yours. If the room ended while you were away, your session is logged up to the room's end.
- The session itself goes through the normal sync queue, so it is never lost even if Leave fails.
- If join fails because the room is full, ended, or you aren't allowed in, a toast says why. Pressing a host control after you've stopped being host shows a toast and refreshes the room.

## 8. Maintenance

`worker/maintenance.js` gets a new feature, `'friends'`, which covers the Friends tab, search, requests and rooms. When it's switched on, the tab and the Study together card show the maintenance message, and the routes return 503. Solo study is not affected.

## 9. Stages

1. **Friends.** Migration 0006 (friends tables only), friends routes, Friends tab (search, requests, list without live status), inbox entries, settings, maintenance switch.
2. **Rooms.** Rooms routes, Study together sheet, room focus screen, host controls, join from Friends and from the inbox, `run.ts` room runs, session `roomId` sync, polling.
3. **Presence and records.** Solo presence, "Studying now", end-of-session summary, group record, the "with" row in History, the With friends tile, cron cleanup.

Each stage is tested (vitest for routes and data; component tests for the tab and the room) and released on its own, and each stage applies its remote migration before deploy.
