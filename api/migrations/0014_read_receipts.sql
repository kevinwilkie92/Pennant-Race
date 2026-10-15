-- Read receipts for private conversations (direct messages and groups). Each user can switch them off; like most
-- messengers it is reciprocal: with receipts off you neither share nor see them.
ALTER TABLE user ADD COLUMN read_receipts INTEGER NOT NULL DEFAULT 1;
-- The unread marker (last_id) always moves. What others may see (shared_id, read_at) only moves while receipts are on,
-- so reading with receipts off and switching them on later reveals nothing about the past.
ALTER TABLE dm_read ADD COLUMN shared_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dm_read ADD COLUMN read_at INTEGER;
ALTER TABLE group_read ADD COLUMN shared_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE group_read ADD COLUMN read_at INTEGER;
