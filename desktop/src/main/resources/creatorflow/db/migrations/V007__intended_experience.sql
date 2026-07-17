-- A project may declare (but not have verified) an intended Roblox experience.
-- All three columns are nullable: an unbound project or pre-existing release leaves them NULL.
ALTER TABLE local_projects ADD COLUMN universe_id INTEGER;
ALTER TABLE local_projects ADD COLUMN place_id INTEGER;
ALTER TABLE local_projects ADD COLUMN experience_name TEXT;

ALTER TABLE releases ADD COLUMN universe_id INTEGER;
ALTER TABLE releases ADD COLUMN place_id INTEGER;
ALTER TABLE releases ADD COLUMN experience_name TEXT;
