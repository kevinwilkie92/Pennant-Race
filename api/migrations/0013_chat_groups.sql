-- Group conversations (3 to 8 teams). A group's messages are chat_message rows with group_id set (to_team stays NULL).
CREATE TABLE chat_group (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT,
  created_by TEXT NOT NULL REFERENCES team(id),
  created_at INTEGER NOT NULL,
  member_key TEXT NOT NULL                      -- sorted team ids, to find "the group with exactly these teams"
);
CREATE TABLE chat_group_member (
  group_id INTEGER NOT NULL REFERENCES chat_group(id) ON DELETE CASCADE,
  team_id  TEXT NOT NULL REFERENCES team(id),
  from_id  INTEGER NOT NULL DEFAULT 0,          -- a member added later only sees messages newer than this
  PRIMARY KEY (group_id, team_id)
);
CREATE INDEX idx_group_member_team ON chat_group_member(team_id);
ALTER TABLE chat_message ADD COLUMN group_id INTEGER REFERENCES chat_group(id);
CREATE INDEX idx_chat_group_msg ON chat_message(group_id, id);
CREATE TABLE group_read (
  user_id  TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES chat_group(id) ON DELETE CASCADE,
  last_id  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, group_id)
);
