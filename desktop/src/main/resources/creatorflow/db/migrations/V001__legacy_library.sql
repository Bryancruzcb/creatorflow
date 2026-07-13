-- The original CreatorFlow desktop schema. CREATE IF NOT EXISTS makes this migration a
-- safe baseline for databases created before schema_migrations existed.
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name          TEXT NOT NULL,
  stored_path        TEXT NOT NULL,
  file_type          TEXT NOT NULL,
  size_bytes         INTEGER NOT NULL,
  width              INTEGER NOT NULL DEFAULT 0,
  height             INTEGER NOT NULL DEFAULT 0,
  sha256             TEXT NOT NULL,
  dhash              INTEGER,
  phash              INTEGER,
  audio_fp           INTEGER,
  license            TEXT NOT NULL,
  ownership_declared INTEGER NOT NULL,
  status             TEXT NOT NULL,
  findings           TEXT NOT NULL DEFAULT '',
  added_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_matches (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id          INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  matched_asset_id  INTEGER NOT NULL,
  matched_file_name TEXT NOT NULL,
  layer             TEXT NOT NULL,
  distance          INTEGER NOT NULL,
  note              TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_sha ON assets(sha256);
CREATE INDEX IF NOT EXISTS idx_matches_asset ON asset_matches(asset_id);
