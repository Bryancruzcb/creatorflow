CREATE TABLE motion_snapshots (
  id                     TEXT PRIMARY KEY,
  project_id             INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id               TEXT NOT NULL,
  kind                   TEXT NOT NULL,
  source_comparison_id   TEXT,
  name                   TEXT NOT NULL,
  duration               REAL NOT NULL,
  fingerprint            TEXT NOT NULL,
  algorithm_version      TEXT NOT NULL,
  supersedes_snapshot_id TEXT,
  status                 TEXT NOT NULL,
  created_at             TEXT NOT NULL
);

CREATE INDEX idx_motion_snapshots_current
  ON motion_snapshots(project_id, asset_id, kind, created_at DESC);
