-- Each season's schedule keeps the format it was created with (regular weeks and playoff size), so changing the league
-- rules later affects only schedules created afterwards. Existing schedules keep the original 23 weeks and 6 playoff teams.
CREATE TABLE season_format (
  season        INTEGER PRIMARY KEY REFERENCES season(year),
  regular_weeks INTEGER NOT NULL,
  playoff_teams INTEGER NOT NULL
);
INSERT INTO season_format (season, regular_weeks, playoff_teams)
  SELECT w.season, COALESCE((SELECT MAX(m.week) FROM matchup m WHERE m.season = w.season), 23), 6 FROM (SELECT DISTINCT season FROM week) w;
