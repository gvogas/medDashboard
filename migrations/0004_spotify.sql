-- One Spotify connection per user. The refresh token is AES-GCM ciphertext under a
-- key derived from SESSION_SECRET (see worker/spotify.js); the access token lives
-- an hour and is kept in clear.

CREATE TABLE spotify_tokens (
  user_id        TEXT PRIMARY KEY REFERENCES users(id),
  refresh_token  TEXT NOT NULL,     -- base64(iv ‖ ciphertext)
  access_token   TEXT NOT NULL,
  expires_at     INTEGER NOT NULL,  -- ms since epoch
  updated_at     INTEGER NOT NULL
);
