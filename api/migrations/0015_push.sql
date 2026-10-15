-- Push notifications. A device is either a browser (Web Push: endpoint + keys) or a phone app (an Expo push token).
CREATE TABLE push_subscription (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('web', 'expo')),
  endpoint   TEXT NOT NULL UNIQUE,            -- the push-service URL, or the Expo token
  p256dh     TEXT,
  auth       TEXT,
  created_at INTEGER NOT NULL,
  fails      INTEGER NOT NULL DEFAULT 0       -- consecutive failed deliveries; the device is dropped after a few
);
CREATE INDEX idx_push_user ON push_subscription(user_id);

-- What each person wants to hear about (defaults: everything, with message previews).
CREATE TABLE push_prefs (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  dm      INTEGER NOT NULL DEFAULT 1,
  grp     INTEGER NOT NULL DEFAULT 1,
  mention INTEGER NOT NULL DEFAULT 1,
  trade   INTEGER NOT NULL DEFAULT 1,
  waiver  INTEGER NOT NULL DEFAULT 1,
  preview INTEGER NOT NULL DEFAULT 1
);
