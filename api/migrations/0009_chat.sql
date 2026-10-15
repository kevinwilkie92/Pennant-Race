-- League chat. Messages and reactions use the existing chat_message table; this tracks each user's read position
-- so the app can show an unread badge.
CREATE TABLE chat_read (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  last_id INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_chat_team_time ON chat_message(team_id, created_at);
