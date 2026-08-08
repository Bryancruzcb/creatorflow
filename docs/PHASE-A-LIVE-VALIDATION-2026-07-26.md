# Phase A live validation — real Open Cloud calls from inside the app (2026-07-26)

Phase A shipped with every test running against **stub servers**. This is the first run of the
whole path against **Roblox's live API from inside the built desktop app** — the
`[offline-ish]` step of [`FRIEND-TEST.md`](FRIEND-TEST.md) (needs a key + internet, no Studio).
It can be done solo, so it was, to de-risk the live session.

**Result: the path works end to end against real Roblox, and both honest outcomes rendered
correctly. No defects found.**

## Setup

Built `frontend/dist`, launched the desktop app against an isolated scratch data dir, stored a
user-scoped Open Cloud API key through the real `OpenCloudSettings` class, and bound the test
project to a **real, group-owned** Roblox experience — deliberately, because a group-owned
experience is what exercises the membership-resolution path where the critical review finding
lived.

- Bound experience: universe `383310974` / place `920587237` (a public, group-owned game),
  owner resolved live as `groups/295182`.
- Verified animation: `507766388` (a public Roblox-authored R15 animation, creator `users/1`).

## Key storage, checked on disk

`OpenCloudSettings.save()` reported `mode=DPAPI_WINDOWS` and round-tripped the key. The written
`opencloud.properties` contains DPAPI ciphertext (`apiKey=AQAAANCMnd8BFdERjHoAwE/Cl+s...`), and a
literal search for the raw key against the file **does not match** — encryption at rest is real,
not just labeled. The session payload the browser receives carries only
`openCloudKeyConfigured: true` — no key, no prefix, no masked form.

## Outcome 1 — live MISMATCH (the membership path)

`POST /api/v1/assets/1/verify-ownership { robloxAssetId: 507766388 }` → `201`:

```json
{ "robloxAssetId": 507766388, "assetIdSource": "DECLARED_BY_USER",
  "creatorType": "USER", "creatorId": 1, "assetType": "Animation",
  "moderationState": "Approved", "ownerType": "GROUP", "ownerId": 295182,
  "memberRank": null, "outcome": "MISMATCH", "verified": true }
```

Correct: user 1 is genuinely not a member of group 295182 — an **observed empty membership
list**, which is the only input allowed to produce MISMATCH after the tri-state fix. The facts
are real, obtained live. The UI rendered:

> **Review lead: creator is not the experience owner** — Roblox reports the creator of the
> animation ID you entered is not the owner of this project's bound experience. This is a lead
> for a person to confirm the team has the right to ship it — **not an accusation**. […]
> You entered animation ID 507766388 for this file. CreatorFlow checked who owns that animation
> on Roblox — **it cannot check that this file is that animation, so the link between them stays
> your declaration.**
> Animation ID you entered · **Declared** — Entered by a person.
> Creator of that animation: User 1 · Experience owner: Group 295182 · Moderation: Approved
> *checked today · point-in-time observation, not a standing guarantee*

Every honesty invariant is visible in one screen: VERIFIED facts, a DECLARED linkage, review-lead
framing, and point-in-time staleness.

## Outcome 2 — live UNVERIFIABLE

A nonexistent animation id → Roblox `404` → `outcome: UNVERIFIABLE`, `verified: false`, and every
fact field `null`. An honest "could not check", never a false verdict.

## What this means for the friend test

`FRIEND-TEST.md` Part 2 step 4 is now **pre-validated end to end**; the friend session only needs
to confirm it behaves the same with *their* key and *their* experience. The remaining unproven
Phase A branch is a live **MATCH**, which needs an animation and an experience owned by the same
account — i.e. the friend's own assets.

## Note

The spike-note gap at line 48 (the group-membership *entry* shape when a user **is** a member) is
**still unobserved** — this run confirmed the not-a-member shape, not the member shape. The
tri-state fix is what makes that safe: an unrecognized member shape degrades to
`MEMBER_RANK_UNKNOWN` → MATCH, never a false MISMATCH.

Minor observation, not a defect: an absurdly large id typed into the panel loses precision in
JavaScript before it reaches the bridge (`99999999999999999` arrived as `100000000000000000`).
Real Roblox asset ids are ~10–11 digits, far inside the safe-integer range, so this is
theoretical — but the input could reject values above `Number.MAX_SAFE_INTEGER` rather than
silently rounding.

All key material used for this run was deleted afterwards (scratch key file and the app's
`opencloud.properties`).
