CREATE TABLE animation_comparisons (
  id                    TEXT PRIMARY KEY,
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_asset_id       TEXT NOT NULL,
  candidate_asset_id    TEXT NOT NULL,
  source_name           TEXT NOT NULL,
  candidate_name        TEXT NOT NULL,
  source_duration       REAL NOT NULL,
  candidate_duration    REAL NOT NULL,
  source_fingerprint    TEXT NOT NULL,
  candidate_fingerprint TEXT NOT NULL,
  overall_score         INTEGER NOT NULL,
  pose_score            INTEGER NOT NULL,
  timing_score          INTEGER NOT NULL,
  coverage_score        INTEGER NOT NULL,
  exact_curve_data      INTEGER NOT NULL,
  result_json           TEXT NOT NULL,
  algorithm_version     TEXT NOT NULL,
  created_at            TEXT NOT NULL
);

CREATE INDEX idx_animation_comparisons_project
  ON animation_comparisons(project_id, created_at DESC);
