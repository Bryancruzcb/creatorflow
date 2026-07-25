-- Insert-only ledger of Open Cloud ownership verifications. A verification is a point-in-time
-- observation: who created an animation asset, who owns the target experience, and whether they
-- match. Rows are never updated or deleted (re-verifying inserts a new row); the latest row per
-- asset is the current answer. Raw facts are stored alongside the computed outcome so a later
-- policy change (e.g. tightening the group-rank rule) does not require re-verification.
--
-- Every column here has a writer. The ledger has exactly one (the bridge's verify-ownership route,
-- via OwnershipVerificationRepository) and each insert supplies all of them. Raw upstream response
-- bodies are deliberately not stored: a column no writer fills would be an audit promise this
-- schema cannot keep.
CREATE TABLE IF NOT EXISTS ownership_verifications (
  id                 TEXT PRIMARY KEY,
  scan_asset_id      INTEGER NOT NULL REFERENCES scan_assets(id) ON DELETE CASCADE,
  roblox_asset_id    INTEGER NOT NULL,
  universe_id        INTEGER NOT NULL,
  creator_type       TEXT,
  creator_id         INTEGER,
  asset_type         TEXT,
  moderation_state   TEXT,
  owner_type         TEXT,
  owner_id           INTEGER,
  member_rank        INTEGER,
  outcome            TEXT NOT NULL,
  checked_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ownership_verifications_asset
  ON ownership_verifications(scan_asset_id, checked_at DESC);
