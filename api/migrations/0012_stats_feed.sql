-- MLB stats feed: our players' MLB ids, one scored row per player per game, and which games are finished.
ALTER TABLE player ADD COLUMN mlb_id INTEGER;           -- Ohtani's two rows share one id
CREATE INDEX idx_player_mlb ON player(mlb_id);

CREATE TABLE player_game (
  game_pk   INTEGER NOT NULL,
  player_id INTEGER NOT NULL REFERENCES player(id),
  season    INTEGER NOT NULL,
  date      TEXT NOT NULL,                  -- the game's official date (YYYY-MM-DD)
  role      TEXT NOT NULL CHECK (role IN ('H', 'P')),
  points    REAL NOT NULL,
  line_json TEXT NOT NULL,                  -- the scored stat line (HitLine / PitLine)
  pos       TEXT NOT NULL,                  -- position played ('P' for pitchers)
  started   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_pk, player_id)
);
CREATE INDEX idx_pg_player ON player_game(player_id, date);
CREATE INDEX idx_pg_date ON player_game(date);

CREATE TABLE stats_game (
  game_pk      INTEGER PRIMARY KEY,
  date         TEXT NOT NULL,
  final        INTEGER NOT NULL DEFAULT 0,  -- once final it is never fetched again
  processed_at INTEGER NOT NULL
);

-- Who set an injury status: the commissioner by hand, or the feed (the feed only ever touches its own rows).
ALTER TABLE player_status ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

CREATE TABLE feed_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
