-- Sign in with Google / Apple. One row per linked provider account; the user keeps their team and history.
-- Accounts created through a provider have no usable password (password_hash = '!').
CREATE TABLE identity (
  provider   TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  subject    TEXT NOT NULL,                 -- the provider's stable user id (the token's `sub`)
  user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX idx_identity_user ON identity(user_id);
