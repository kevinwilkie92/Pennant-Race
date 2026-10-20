-- Career stats come from MLB on demand and are kept here so a player card opens fast and works if MLB is down.
CREATE TABLE career_cache (
  mlb_id     INTEGER NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('H', 'P')),
  json       TEXT NOT NULL,                 -- the computed seasons and totals
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (mlb_id, role)
);
-- Quality starts aren't in MLB's season totals, so they're counted from each season's game log (once; finished seasons never change).
CREATE TABLE qs_cache (
  mlb_id     INTEGER NOT NULL,
  season     INTEGER NOT NULL,
  qs         INTEGER NOT NULL,
  final      INTEGER NOT NULL,              -- 1 once the season is over: never fetched again
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (mlb_id, season)
);
