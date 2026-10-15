-- Chat: direct messages, replies, @mentions, images, edits.
ALTER TABLE chat_message ADD COLUMN to_team TEXT REFERENCES team(id);   -- NULL = league room, else a direct message to that team
ALTER TABLE chat_message ADD COLUMN reply_to INTEGER;                   -- id of the message being replied to (may since have been deleted)
ALTER TABLE chat_message ADD COLUMN edited_at INTEGER;
ALTER TABLE chat_message ADD COLUMN image_key TEXT;
ALTER TABLE chat_message ADD COLUMN mentions_json TEXT NOT NULL DEFAULT '[]';
CREATE INDEX idx_chat_dm ON chat_message(to_team, team_id, id);

-- An uploaded image waits here until a message uses it; only the uploader may attach it, and only once.
CREATE TABLE chat_upload (
  key        TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL REFERENCES team(id),
  created_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);

-- Read position per direct-message conversation (the league room keeps using chat_read).
CREATE TABLE dm_read (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  partner TEXT NOT NULL,
  last_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, partner)
);
