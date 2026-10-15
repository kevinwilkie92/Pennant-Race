-- Lineup history. A player's slot on a date is the latest row with from_date <= that date; the baseline
-- row (from_date '0000-00-00') records where he sat before any edit. The stats feed uses this to credit
-- each day's points to the slot he occupied that day.
CREATE TABLE lineup_history (
  season    INTEGER NOT NULL REFERENCES season(year),
  team_id   TEXT NOT NULL REFERENCES team(id),
  player_id INTEGER NOT NULL REFERENCES player(id),
  slot      TEXT NOT NULL,
  from_date TEXT NOT NULL,
  PRIMARY KEY (season, player_id, from_date)
);
CREATE INDEX idx_lineup_history_team ON lineup_history(season, team_id);

-- First-pitch times per MLB team per date, filled by the stats feed. A player is locked for a date once
-- his team's game has started. With no rows nobody is locked.
CREATE TABLE mlb_game (
  date      TEXT NOT NULL,
  team      TEXT NOT NULL REFERENCES mlb_team(abbr),
  start_utc TEXT NOT NULL,      -- ISO 8601, e.g. 2027-04-01T17:05:00Z
  PRIMARY KEY (date, team)
);
