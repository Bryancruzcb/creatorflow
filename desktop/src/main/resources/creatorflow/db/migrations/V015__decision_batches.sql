-- One row per batch act, plus a nullable batch_id on every record a batch can write.
-- The batch does NOT collapse N assets into one record: each asset keeps its own decision (or
-- source-evidence) row, its own id and its own created_at, and they share this batch_id. That is
-- the honest shape — one human act labelling N records — and it is also the only shape that keeps
-- DecisionRepository.latestFor / latestForRun working.
CREATE TABLE IF NOT EXISTS decision_batches (
  id           TEXT PRIMARY KEY,
  scan_run_id  TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,     -- DECISION | SOURCE_EVIDENCE
  group_code   TEXT NOT NULL,     -- the ReleaseGate.Code the group was formed on
  action       TEXT NOT NULL,     -- EXCLUDED | NEEDS_REVIEW | SOURCE_EVIDENCE
  rationale    TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  asset_count  INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);

-- Nullable with no DEFAULT, which is what SQLite requires of an ADD COLUMN carrying a REFERENCES
-- clause while PRAGMA foreign_keys is ON (Database.java sets it). Every row written before this
-- migration reads NULL, and NULL here means "not part of a batch" — never "unknown".
ALTER TABLE decisions ADD COLUMN batch_id TEXT REFERENCES decision_batches(id);
ALTER TABLE source_evidence ADD COLUMN batch_id TEXT REFERENCES decision_batches(id);

CREATE INDEX IF NOT EXISTS idx_decision_batches_run ON decision_batches(scan_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_batch ON decisions(batch_id);
CREATE INDEX IF NOT EXISTS idx_source_evidence_batch ON source_evidence(batch_id);
