-- The Roblox place version a team reports having published this release as.
-- A human declaration only, entered post-publish — CreatorFlow does not verify it against Roblox.
-- Nullable: unset until a team records it.
ALTER TABLE releases ADD COLUMN published_place_version INTEGER;
