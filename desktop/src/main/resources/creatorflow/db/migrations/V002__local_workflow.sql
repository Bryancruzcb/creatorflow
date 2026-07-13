CREATE TABLE IF NOT EXISTS local_projects (
  project_id          INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  root_path           TEXT NOT NULL UNIQUE,
  adopted_at          TEXT NOT NULL,
  active_scan_run_id  TEXT,
  ui_state_json       TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id                        TEXT PRIMARY KEY,
  project_id                INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_root              TEXT NOT NULL,
  release_name              TEXT NOT NULL,
  exclusions_json           TEXT NOT NULL DEFAULT '[]',
  supported_formats_json    TEXT NOT NULL DEFAULT '[]',
  state                     TEXT NOT NULL,
  discovered_count          INTEGER NOT NULL DEFAULT 0,
  processed_count           INTEGER NOT NULL DEFAULT 0,
  bytes_processed           INTEGER NOT NULL DEFAULT 0,
  supported_count           INTEGER NOT NULL DEFAULT 0,
  ignored_count             INTEGER NOT NULL DEFAULT 0,
  excluded_count            INTEGER NOT NULL DEFAULT 0,
  unreadable_count          INTEGER NOT NULL DEFAULT 0,
  missing_dependency_count  INTEGER NOT NULL DEFAULT 0,
  failed_count              INTEGER NOT NULL DEFAULT 0,
  warnings_json             TEXT NOT NULL DEFAULT '[]',
  error_message             TEXT,
  created_at                TEXT NOT NULL,
  started_at                TEXT,
  completed_at              TEXT
);

CREATE TABLE IF NOT EXISTS scan_assets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id      TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  ordinal          INTEGER NOT NULL,
  relative_path    TEXT NOT NULL,
  file_name        TEXT NOT NULL,
  file_type        TEXT NOT NULL,
  size_bytes       INTEGER NOT NULL,
  sha256           TEXT NOT NULL,
  width            INTEGER NOT NULL DEFAULT 0,
  height           INTEGER NOT NULL DEFAULT 0,
  dhash            TEXT,
  phash            TEXT,
  audio_fp         TEXT,
  verification     TEXT NOT NULL,
  findings_json    TEXT NOT NULL DEFAULT '[]',
  UNIQUE(scan_run_id, ordinal),
  UNIQUE(scan_run_id, relative_path)
);

CREATE TABLE IF NOT EXISTS scan_findings (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_asset_id          INTEGER NOT NULL REFERENCES scan_assets(id) ON DELETE CASCADE,
  code                   TEXT NOT NULL,
  severity               TEXT NOT NULL,
  message                TEXT NOT NULL,
  matched_asset_ordinal  INTEGER,
  match_layer            TEXT,
  match_distance         INTEGER
);

CREATE TABLE IF NOT EXISTS source_evidence (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_asset_id  INTEGER NOT NULL REFERENCES scan_assets(id) ON DELETE CASCADE,
  source_name    TEXT,
  license_name   TEXT,
  evidence_url   TEXT,
  resolved       INTEGER NOT NULL,
  recorded_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id                      TEXT PRIMARY KEY,
  scan_asset_id           INTEGER NOT NULL REFERENCES scan_assets(id) ON DELETE CASCADE,
  decision_type           TEXT NOT NULL,
  reason                  TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  supersedes_decision_id  TEXT REFERENCES decisions(id),
  created_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS releases (
  id             TEXT PRIMARY KEY,
  scan_run_id    TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  release_name   TEXT NOT NULL,
  manifest_json  TEXT NOT NULL,
  policy_result  TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id   TEXT REFERENCES scan_runs(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scan_runs_project ON scan_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_assets_run ON scan_assets(scan_run_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_scan_assets_sha ON scan_assets(sha256);
CREATE INDEX IF NOT EXISTS idx_findings_asset ON scan_findings(scan_asset_id);
CREATE INDEX IF NOT EXISTS idx_evidence_asset ON source_evidence(scan_asset_id);
CREATE INDEX IF NOT EXISTS idx_decisions_asset ON decisions(scan_asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_releases_run ON releases(scan_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_run ON audit_events(scan_run_id, created_at);
