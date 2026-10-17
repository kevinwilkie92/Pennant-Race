-- A short history of commissioner actions (who changed what), shown on the league settings screen.
CREATE TABLE league_audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  team_id TEXT,                    -- the acting commissioner's team
  action  TEXT NOT NULL,           -- short machine name, e.g. 'commissioner_added'
  detail  TEXT NOT NULL            -- human sentence
);
CREATE INDEX idx_league_audit_at ON league_audit(at);
