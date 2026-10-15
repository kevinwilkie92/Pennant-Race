-- Players tab: watchlist, FAAB waiver claims, rolling waiver order.
ALTER TABLE waiver_claim ADD COLUMN season INTEGER;
ALTER TABLE waiver_claim ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE waiver_claim ADD COLUMN reason TEXT;
ALTER TABLE waiver_claim ADD COLUMN processed_at INTEGER;

-- Rolling waiver order: breaks ties between equal FAAB bids. Starts alphabetical; a team that wins a claim moves to the back.
ALTER TABLE team ADD COLUMN waiver_pos INTEGER NOT NULL DEFAULT 0;
UPDATE team SET waiver_pos = (SELECT COUNT(*) FROM team t2 WHERE t2.id <= team.id);

CREATE TABLE watchlist (
  user_id   TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES player(id),
  PRIMARY KEY (user_id, player_id)
);
CREATE INDEX idx_claim_team ON waiver_claim(team_id, status, priority);
CREATE INDEX idx_txn_season ON "transaction"(season, id);
