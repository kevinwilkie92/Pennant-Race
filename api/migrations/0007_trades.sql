-- Trades. A traded player gets a "left" row for one team and an "arrived" row for another on the same date,
-- so the lineup history key must include the team (it didn't before).
CREATE TABLE lineup_history_new (
  season    INTEGER NOT NULL REFERENCES season(year),
  team_id   TEXT NOT NULL REFERENCES team(id),
  player_id INTEGER NOT NULL REFERENCES player(id),
  slot      TEXT NOT NULL,
  from_date TEXT NOT NULL,
  PRIMARY KEY (season, team_id, player_id, from_date)
);
INSERT INTO lineup_history_new (season, team_id, player_id, slot, from_date)
  SELECT season, team_id, player_id, slot, from_date FROM lineup_history;
DROP TABLE lineup_history;
ALTER TABLE lineup_history_new RENAME TO lineup_history;
CREATE INDEX idx_lineup_history_team ON lineup_history(season, team_id);

ALTER TABLE trade_offer ADD COLUMN season INTEGER;
ALTER TABLE trade_offer ADD COLUMN reason TEXT;
ALTER TABLE trade_offer ADD COLUMN resolved_at INTEGER;
ALTER TABLE "transaction" ADD COLUMN detail TEXT;
CREATE INDEX idx_trade_status ON trade_offer(season, status);
