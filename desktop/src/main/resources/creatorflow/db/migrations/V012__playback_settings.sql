-- Record an animation's playback settings (loop flag, priority) alongside its curve fingerprint.
--
-- The fingerprint is a digest of curve data only, deliberately: two clips with identical curves
-- and different loop flags really do have identical curve data, which is what EXACT_CURVE_DATA
-- reports. But last-known-good drift detection (MotionSnapshots.classify) compared fingerprints
-- alone, so flipping Looped -- a change that alters how the animation plays in a live experience
-- -- was reported as UNCHANGED by a tool whose whole job is saying what changed.
--
-- Rather than fold these into the fingerprint (which would make EXACT_CURVE_DATA lie in the other
-- direction and invalidate every stored fingerprint), they are stored beside it and compared
-- separately. All columns are nullable: rows written before this migration have no recorded
-- playback settings, and "unknown" must never be reported as a change.

ALTER TABLE animation_comparisons ADD COLUMN source_looped INTEGER;
ALTER TABLE animation_comparisons ADD COLUMN source_priority TEXT;
ALTER TABLE animation_comparisons ADD COLUMN candidate_looped INTEGER;
ALTER TABLE animation_comparisons ADD COLUMN candidate_priority TEXT;

ALTER TABLE motion_snapshots ADD COLUMN looped INTEGER;
ALTER TABLE motion_snapshots ADD COLUMN priority TEXT;
