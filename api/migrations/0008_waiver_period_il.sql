-- Waiver period after a drop, and injury status (feeds the injured list).
CREATE TABLE waiver_clear (
  season     INTEGER NOT NULL REFERENCES season(year),
  player_id  INTEGER NOT NULL REFERENCES player(id),
  clears_on  TEXT NOT NULL,          -- first date he can be won (YYYY-MM-DD, Eastern)
  dropped_by TEXT NOT NULL REFERENCES team(id),
  PRIMARY KEY (season, player_id)
);

-- Global injury status. The stats feed will keep this current; until then the commissioner sets it by hand.
CREATE TABLE player_status (
  player_id  INTEGER PRIMARY KEY REFERENCES player(id),
  status     TEXT NOT NULL CHECK (status IN ('DTD', 'IL', 'OUT')),
  note       TEXT,
  updated_at INTEGER NOT NULL
);
