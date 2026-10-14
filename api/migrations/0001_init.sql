-- Pennant Race schema (README "State Management"). Money is whole dollars.

CREATE TABLE league (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  name          TEXT NOT NULL,
  max_starts    INTEGER NOT NULL DEFAULT 12,
  faab_budget   INTEGER NOT NULL DEFAULT 300,
  scoring_json  TEXT NOT NULL DEFAULT '{}',
  settings_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE season (
  year    INTEGER PRIMARY KEY,
  status  TEXT NOT NULL CHECK (status IN ('live', 'archived'))
);

CREATE TABLE team (
  id          TEXT PRIMARY KEY,          -- e.g. 'AM'
  owner_name  TEXT NOT NULL,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  logo_key    TEXT,                      -- R2 object key
  faab        INTEGER NOT NULL DEFAULT 300,
  is_commissioner INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE user (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  team_id       TEXT REFERENCES team(id),
  created_at    INTEGER NOT NULL
);

CREATE TABLE session (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE mlb_team (
  abbr   TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  logo   TEXT,
  color  TEXT,
  color2 TEXT
);

CREATE TABLE player (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL UNIQUE,         -- Ohtani is two rows: '(Batter)' / '(Pitcher)'
  mlb_team TEXT REFERENCES mlb_team(abbr),
  pos      TEXT NOT NULL,                -- primary position
  pos2     TEXT                          -- secondary eligibility (seed data)
);

-- Eligible positions per season (sticky once earned).
CREATE TABLE player_position (
  player_id INTEGER NOT NULL REFERENCES player(id),
  season    INTEGER NOT NULL,
  position  TEXT NOT NULL,
  PRIMARY KEY (player_id, season, position)
);

CREATE TABLE roster_slot (
  season    INTEGER NOT NULL REFERENCES season(year),
  team_id   TEXT NOT NULL REFERENCES team(id),
  player_id INTEGER NOT NULL REFERENCES player(id),
  slot      TEXT NOT NULL,               -- ROSTER_LABELS id: 'C','OF2','Util1','SP3','B4'...
  PRIMARY KEY (season, team_id, slot),
  UNIQUE (season, player_id)
);

CREATE TABLE draft_sale (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  season    INTEGER NOT NULL REFERENCES season(year),
  player_id INTEGER NOT NULL REFERENCES player(id),
  team_id   TEXT NOT NULL REFERENCES team(id),
  price     INTEGER NOT NULL CHECK (price >= 1),
  seq       INTEGER NOT NULL,            -- order; undo removes the highest seq
  is_keeper INTEGER NOT NULL DEFAULT 0,
  UNIQUE (season, player_id),
  UNIQUE (season, seq)
);

CREATE TABLE keeper (
  season    INTEGER NOT NULL REFERENCES season(year),
  team_id   TEXT NOT NULL REFERENCES team(id),
  player_id INTEGER NOT NULL REFERENCES player(id),
  year      INTEGER NOT NULL CHECK (year IN (1, 2)),
  cost      INTEGER NOT NULL,
  PRIMARY KEY (season, player_id)
);

CREATE TABLE matchup (
  season  INTEGER NOT NULL,
  week    INTEGER NOT NULL,
  home    TEXT NOT NULL REFERENCES team(id),
  away    TEXT NOT NULL REFERENCES team(id),
  PRIMARY KEY (season, week, home)
);

CREATE TABLE daily_points (
  season    INTEGER NOT NULL,
  date      TEXT NOT NULL,               -- YYYY-MM-DD
  team_id   TEXT NOT NULL REFERENCES team(id),
  player_id INTEGER NOT NULL REFERENCES player(id),
  slot      TEXT NOT NULL,
  points    REAL NOT NULL,
  PRIMARY KEY (season, date, team_id, player_id)
);

CREATE TABLE "transaction" (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  season     INTEGER NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('draft', 'waiver', 'trade', 'add', 'drop')),
  team_id    TEXT REFERENCES team(id),
  player_id  INTEGER REFERENCES player(id),
  faab       INTEGER,
  status     TEXT NOT NULL DEFAULT 'done',
  detail_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE waiver_claim (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id   TEXT NOT NULL REFERENCES team(id),
  add_player_id  INTEGER NOT NULL REFERENCES player(id),
  drop_player_id INTEGER REFERENCES player(id),
  bid       INTEGER NOT NULL DEFAULT 0,
  priority  INTEGER NOT NULL,
  status    TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE trade_offer (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  from_team TEXT NOT NULL REFERENCES team(id),
  to_team   TEXT NOT NULL REFERENCES team(id),
  give_json TEXT NOT NULL,               -- player ids offered
  get_json  TEXT NOT NULL,               -- player ids requested
  status    TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at INTEGER NOT NULL
);

CREATE TABLE chat_message (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id   TEXT NOT NULL REFERENCES team(id),
  body      TEXT NOT NULL,
  pinned    INTEGER NOT NULL DEFAULT 0,
  reactions_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_roster_team ON roster_slot(season, team_id);
CREATE INDEX idx_sale_season ON draft_sale(season, seq);
