# Phase A Task 0 — Open Cloud spike note (2026-07-23)

Live results against `apis.roblox.com` with a user-scoped API key (scopes: Assets read,
Universes read, Groups read; created at `create.roblox.com/dashboard/credentials`). This
note is the contract Tasks 3–4 code against. All responses below were actually observed;
anything marked *inferred* was not.

## Step 2 (GATE) — cross-creator GetAsset: **YES**

`GET https://apis.roblox.com/assets/v1/assets/{assetId}` with header `x-api-key: <key>`
returns **200 for assets the key owner does not own** (tested on ROBLOX-owned R15
default animations 507766388 "R15Idle" and 507777826 "R15Walk"):

```json
{
  "path": "assets/507766388",
  "revisionId": "17",
  "revisionCreateTime": "2026-06-23T20:14:26.688Z",
  "assetId": "507766388",
  "displayName": "R15Idle",
  "description": "R15Idle",
  "assetType": "Animation",
  "creationContext": { "creator": { "userId": "1" } },
  "moderationResult": { "moderationState": "Approved" },
  "state": "Active"
}
```

The feature proceeds as planned — no re-scope needed.

## Field contract

| Fact | Value / shape | Observed |
|---|---|---|
| Auth header | `x-api-key: <key>` (all endpoints) | yes |
| Animation `assetType` enum | exactly `"Animation"` | yes |
| Asset creator (user-created) | `creationContext.creator.userId` — **bare id string** (`"1"`) | yes |
| Asset creator (group-created) | `creationContext.creator.groupId` — *inferred from docs, not observed*; client must handle both | no |
| Asset moderation | `moderationResult.moderationState` = `"Approved"`; asset `state` = `"Active"` | yes |
| Missing/deleted asset | **404** `{"code":"NOT_FOUND","message":"AssetId N is not found"}` | yes |
| GetUniverse | `GET /cloud/v2/universes/{universeId}` | yes |
| Universe owner (user) | `"user": "users/82914"` — **path string** | yes (universe 90110) |
| Universe owner (group) | `"group": "groups/295182"` — **path string** | yes (universe 383310974) |
| Universe root place | `"rootPlace": "universes/{u}/places/{placeId}"` | yes |
| GetGroup | `GET /cloud/v2/groups/{groupId}`; owner = `"owner": "users/13953438"` path string | yes |
| Membership check (per group) | `GET /cloud/v2/groups/{groupId}/memberships?maxPageSize=1&filter=user == 'users/{userId}'` (URL-encoded) → 200 `{"groupMemberships":[],"nextPageToken":""}` when NOT a member (empty list, **not** an error) | yes |
| Membership check (wildcard) | `GET /cloud/v2/groups/-/memberships?filter=user == 'users/{userId}'` also works (200) | yes |
| Membership entry shape when member | *not observed* (test user belongs to no groups); docs say entries carry `user` and `role` resource paths — pin during Task 3 stub tests and verify on first real member lookup | no |
| Group roles | `GET /cloud/v2/groups/{groupId}/roles` → `groupRoles[]` with `id`, `displayName`, **numeric `rank` 0–255**, `memberCount`, paginated via `nextPageToken` | yes |
| Rate limit (429) | *not provoked*; Task 3 must still map 429 → `RateLimitedException` per plan | no |

## Notable asymmetry

Asset creator ids are **bare strings** (`creator.userId: "1"`), while universe/group
owner references are **resource paths** (`users/123`, `groups/123`). The
`OwnershipOutcome` evaluator must normalize both to one id form before comparing.

## Key handling during the spike

The key was used from a local scratch file outside the repo, read-only scopes, and is
not stored anywhere in the repo, logs, or this note. Desktop-side storage design is
Task 2 (masked properties file, OS-credential-store follow-up issue).
