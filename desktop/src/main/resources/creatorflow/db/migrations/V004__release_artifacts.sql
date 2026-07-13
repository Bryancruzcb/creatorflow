ALTER TABLE releases ADD COLUMN report_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE releases ADD COLUMN comparison_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_releases_created ON releases(created_at DESC);
