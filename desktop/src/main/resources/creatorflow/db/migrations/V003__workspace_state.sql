CREATE TABLE IF NOT EXISTS workspace_state (
  singleton_id       INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  active_project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  active_scan_run_id TEXT REFERENCES scan_runs(id) ON DELETE SET NULL,
  selected_asset_id  INTEGER REFERENCES scan_assets(id) ON DELETE SET NULL,
  selected_finding_id INTEGER REFERENCES scan_findings(id) ON DELETE SET NULL,
  filters_json       TEXT NOT NULL DEFAULT '{}',
  queue_json         TEXT NOT NULL DEFAULT '[]',
  updated_at         TEXT NOT NULL
);
