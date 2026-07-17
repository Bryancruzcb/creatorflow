CREATE TABLE IF NOT EXISTS plugin_pairings (
  id          TEXT PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  issued_at   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_pairings_token_hash ON plugin_pairings(token_hash);
CREATE INDEX IF NOT EXISTS idx_plugin_pairings_project ON plugin_pairings(project_id, revoked_at);
