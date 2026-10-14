-- ESPN average salary per player per season, entered by the commissioner. Used for Year-2 keeper cost.
CREATE TABLE player_value (
  season     INTEGER NOT NULL REFERENCES season(year),
  player_id  INTEGER NOT NULL REFERENCES player(id),
  avg_salary REAL NOT NULL CHECK (avg_salary >= 0),
  PRIMARY KEY (season, player_id)
);
