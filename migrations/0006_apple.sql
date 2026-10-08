-- Sign in with Apple (worker/apple.js). One row per Apple ID linked to a Term account: Apple's
-- stable user id (`sub`) for the app and the website alike. A person has at most one. The
-- refresh token, encrypted, is kept only to revoke Apple's grant when the account is deleted,
-- as Apple requires.

CREATE TABLE apple_accounts (
  sub            TEXT PRIMARY KEY CHECK (length(sub) BETWEEN 1 AND 100),
  user_id        TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  -- The address Apple gave (often a private relay); shown in Settings, never used to sign in.
  email          TEXT NOT NULL DEFAULT '' CHECK (length(email) <= 200),
  -- Which of our client ids the grant was made for: the app's bundle id or the website's Services ID.
  client_id      TEXT NOT NULL DEFAULT '' CHECK (length(client_id) <= 100),
  refresh_token  TEXT CHECK (refresh_token IS NULL OR length(refresh_token) <= 1000),
  created_at     INTEGER NOT NULL
);
