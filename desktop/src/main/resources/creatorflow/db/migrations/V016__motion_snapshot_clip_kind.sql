-- How the clip behind a snapshot was read: "KEYFRAME" (direct KeyframeSequence read) or
-- "CURVE_SAMPLED" (baked by sampling a CurveAnimation). Phase C already records this per side on
-- animation_comparisons; without it here, a pinned sampled reference is indistinguishable from an
-- exactly-read one, and so is any later CHANGED verdict on it.
--
-- Nullable with no DEFAULT, on purpose. Every snapshot pinned before this migration reads NULL,
-- and NULL means UNKNOWN — never "KEYFRAME". Backfilling it from the source comparison would be
-- guessing on the rows that matter least (a snapshot with no source_comparison_id has nothing to
-- read from) and asserting provenance the record never captured, so nothing is backfilled.
ALTER TABLE motion_snapshots ADD COLUMN clip_kind TEXT;
