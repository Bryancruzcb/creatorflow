-- Normalize the TEXT timestamp columns to a fixed width so that ORDER BY on them is
-- chronological.
--
-- Rows written before creatorflow.db.Timestamps came from Instant.toString(), which omits
-- trailing zeros in the fractional second. That makes the stored values variable-width, and
-- SQLite compares TEXT lexicographically: '2026-07-21T02:35:21.5Z' sorts BEFORE
-- '2026-07-21T02:35:21Z' because '.' (0x2E) < 'Z' (0x5A), even though it is half a second later.
-- Every "latest wins" read (an asset's current decision, its newest source evidence, the most
-- recent ownership verification) could therefore return a stale row.
--
-- Each UPDATE rewrites only the shapes Instant.toString() can emit:
--   * '...:SSZ'          -> '...:SS.000000000Z'   (no fractional part)
--   * '...:SS.fffZ'      -> right-padded to nine fractional digits
-- Values already nine digits wide are left alone, so this migration is idempotent.

-- No fractional part at all: swap the trailing 'Z' for '.000000000Z'.
UPDATE scan_runs SET created_at = substr(created_at, 1, length(created_at) - 1) || '.000000000Z'
  WHERE created_at LIKE '____-__-__T__:__:__Z';
UPDATE scan_runs SET started_at = substr(started_at, 1, length(started_at) - 1) || '.000000000Z'
  WHERE started_at LIKE '____-__-__T__:__:__Z';
UPDATE scan_runs SET completed_at = substr(completed_at, 1, length(completed_at) - 1) || '.000000000Z'
  WHERE completed_at LIKE '____-__-__T__:__:__Z';
UPDATE decisions SET created_at = substr(created_at, 1, length(created_at) - 1) || '.000000000Z'
  WHERE created_at LIKE '____-__-__T__:__:__Z';
UPDATE source_evidence SET recorded_at = substr(recorded_at, 1, length(recorded_at) - 1) || '.000000000Z'
  WHERE recorded_at LIKE '____-__-__T__:__:__Z';
UPDATE releases SET created_at = substr(created_at, 1, length(created_at) - 1) || '.000000000Z'
  WHERE created_at LIKE '____-__-__T__:__:__Z';
UPDATE audit_events SET created_at = substr(created_at, 1, length(created_at) - 1) || '.000000000Z'
  WHERE created_at LIKE '____-__-__T__:__:__Z';
UPDATE projects SET created_at = substr(created_at, 1, length(created_at) - 1) || '.000000000Z'
  WHERE created_at LIKE '____-__-__T__:__:__Z';
UPDATE local_projects SET adopted_at = substr(adopted_at, 1, length(adopted_at) - 1) || '.000000000Z'
  WHERE adopted_at LIKE '____-__-__T__:__:__Z';
UPDATE assets SET added_at = substr(added_at, 1, length(added_at) - 1) || '.000000000Z'
  WHERE added_at LIKE '____-__-__T__:__:__Z';
UPDATE animation_comparisons SET created_at = substr(created_at, 1, length(created_at) - 1) || '.000000000Z'
  WHERE created_at LIKE '____-__-__T__:__:__Z';
UPDATE motion_snapshots SET created_at = substr(created_at, 1, length(created_at) - 1) || '.000000000Z'
  WHERE created_at LIKE '____-__-__T__:__:__Z';
UPDATE plugin_pairings SET issued_at = substr(issued_at, 1, length(issued_at) - 1) || '.000000000Z'
  WHERE issued_at LIKE '____-__-__T__:__:__Z';
UPDATE plugin_pairings SET expires_at = substr(expires_at, 1, length(expires_at) - 1) || '.000000000Z'
  WHERE expires_at LIKE '____-__-__T__:__:__Z';
UPDATE plugin_pairings SET revoked_at = substr(revoked_at, 1, length(revoked_at) - 1) || '.000000000Z'
  WHERE revoked_at LIKE '____-__-__T__:__:__Z';
UPDATE ownership_verifications SET checked_at = substr(checked_at, 1, length(checked_at) - 1) || '.000000000Z'
  WHERE checked_at LIKE '____-__-__T__:__:__Z';

-- Short fractional part: right-pad the digits to nine before the trailing 'Z'.
UPDATE scan_runs SET created_at = substr(created_at, 1, instr(created_at, '.'))
  || substr(replace(substr(created_at, instr(created_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(created_at, '.') > 0 AND length(created_at) <> 30;
UPDATE scan_runs SET started_at = substr(started_at, 1, instr(started_at, '.'))
  || substr(replace(substr(started_at, instr(started_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(started_at, '.') > 0 AND length(started_at) <> 30;
UPDATE scan_runs SET completed_at = substr(completed_at, 1, instr(completed_at, '.'))
  || substr(replace(substr(completed_at, instr(completed_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(completed_at, '.') > 0 AND length(completed_at) <> 30;
UPDATE decisions SET created_at = substr(created_at, 1, instr(created_at, '.'))
  || substr(replace(substr(created_at, instr(created_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(created_at, '.') > 0 AND length(created_at) <> 30;
UPDATE source_evidence SET recorded_at = substr(recorded_at, 1, instr(recorded_at, '.'))
  || substr(replace(substr(recorded_at, instr(recorded_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(recorded_at, '.') > 0 AND length(recorded_at) <> 30;
UPDATE releases SET created_at = substr(created_at, 1, instr(created_at, '.'))
  || substr(replace(substr(created_at, instr(created_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(created_at, '.') > 0 AND length(created_at) <> 30;
UPDATE audit_events SET created_at = substr(created_at, 1, instr(created_at, '.'))
  || substr(replace(substr(created_at, instr(created_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(created_at, '.') > 0 AND length(created_at) <> 30;
UPDATE projects SET created_at = substr(created_at, 1, instr(created_at, '.'))
  || substr(replace(substr(created_at, instr(created_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(created_at, '.') > 0 AND length(created_at) <> 30;
UPDATE local_projects SET adopted_at = substr(adopted_at, 1, instr(adopted_at, '.'))
  || substr(replace(substr(adopted_at, instr(adopted_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(adopted_at, '.') > 0 AND length(adopted_at) <> 30;
UPDATE assets SET added_at = substr(added_at, 1, instr(added_at, '.'))
  || substr(replace(substr(added_at, instr(added_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(added_at, '.') > 0 AND length(added_at) <> 30;
UPDATE animation_comparisons SET created_at = substr(created_at, 1, instr(created_at, '.'))
  || substr(replace(substr(created_at, instr(created_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(created_at, '.') > 0 AND length(created_at) <> 30;
UPDATE motion_snapshots SET created_at = substr(created_at, 1, instr(created_at, '.'))
  || substr(replace(substr(created_at, instr(created_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(created_at, '.') > 0 AND length(created_at) <> 30;
UPDATE plugin_pairings SET issued_at = substr(issued_at, 1, instr(issued_at, '.'))
  || substr(replace(substr(issued_at, instr(issued_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(issued_at, '.') > 0 AND length(issued_at) <> 30;
UPDATE plugin_pairings SET expires_at = substr(expires_at, 1, instr(expires_at, '.'))
  || substr(replace(substr(expires_at, instr(expires_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(expires_at, '.') > 0 AND length(expires_at) <> 30;
UPDATE plugin_pairings SET revoked_at = substr(revoked_at, 1, instr(revoked_at, '.'))
  || substr(replace(substr(revoked_at, instr(revoked_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(revoked_at, '.') > 0 AND length(revoked_at) <> 30;
UPDATE ownership_verifications SET checked_at = substr(checked_at, 1, instr(checked_at, '.'))
  || substr(replace(substr(checked_at, instr(checked_at, '.') + 1), 'Z', '') || '000000000', 1, 9) || 'Z'
  WHERE instr(checked_at, '.') > 0 AND length(checked_at) <> 30;
