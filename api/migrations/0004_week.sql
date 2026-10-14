-- Calendar for a season: 26 Monday-Sunday weeks (1-23 regular season, 24-26 playoffs).
CREATE TABLE week (
  season     INTEGER NOT NULL REFERENCES season(year),
  week       INTEGER NOT NULL,
  start_date TEXT NOT NULL,     -- YYYY-MM-DD (Monday)
  end_date   TEXT NOT NULL,     -- YYYY-MM-DD (Sunday)
  PRIMARY KEY (season, week)
);
CREATE INDEX idx_daily_points_week ON daily_points(season, date, team_id);
