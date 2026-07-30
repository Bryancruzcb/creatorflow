# Codebase triage — what is actually left

**Date:** 2026-07-29
**Method:** ran the builds and gates rather than reading the docs. Everything below is a
reproduced observation with the command that produced it, or it is labelled as a judgement.

## Bottom line

There is very little engineering left that is not gated. `ROADMAP.md` makes every phase after A
conditional on the friend test, and Track A already passed on 2026-07-20. The roadmap is waiting on
a human session in Studio, not on code.

What is left that is *not* gated is three build/CI defects that no document records, and which
between them stop the friend test from being runnable at all.

---

## 1. Broken now

### 1.1 The Java half does not build on the dev machine

```
$ mvn -pl core test
[ERROR] Fatal error compiling: error: release version 24 not supported
```

`JAVA_HOME` points at `temurin21-jdk` (Maven reports `Java version: 21.0.11`), while #92 raised the
project to `maven.compiler.release=24`. CI is unaffected — `ci.yml` pins `java-version: '24'`.

JDK 26 is already installed at `C:\Program Files\Java\jdk-26` and is already `javac` on PATH; only
`JAVA_HOME` is stale. Confirmed the whole module compiles and tests once it is pointed there:

```
$ JAVA_HOME="/c/Program Files/Java/jdk-26" mvn -pl core test
# compiles; every test passes except the one in 1.3
```

**Why it matters beyond convenience:** `FRIEND-TEST.md` step one is
`mvn -pl desktop javafx:run -Dcreatorflow.web.root=...`. #92 silently blocked the single highest
item on the roadmap, and nothing failed loudly enough to say so.

**Fix:** document the JDK ≥24 requirement in `HANDOFF.md` "Build, test, verify (Windows quirks
included)" and in `FRIEND-TEST.md` setup, since that is where someone hits it. The Java baseline
moved; the runbooks did not.

### 1.2 The release gate would fail the first time it is dispatched

`.github/workflows/creatorflow-release-gate.yml` pins:

```yaml
java-version: "21"
```

against a project that now needs 24. `javac --release 24` cannot run on a JDK 21, so the
`Build release-gate CLI` step fails before it ever evaluates a manifest.

It is `workflow_dispatch`-only and **has never run** (`gh run list --workflow=creatorflow-release-gate.yml`
returns nothing), which is why nothing caught it. This is latent rather than currently red.

Worth fixing on principle as much as function: a release-preflight product whose own release gate
errors on first invocation undercuts the thing it is selling.

### 1.3 Issue #18 still reproduces

With the correct JDK, `mvn -pl core test` is one failure away from green:

```
[ERROR] creatorflow.manifest.ProjectScannerTest.followedSymlinkCannotEscapeTheSelectedRoot
Tests run: 8, Failures: 0, Errors: 1
```

Everything else passes. The issue already proposes the fix — guard with `Assumptions.assumeTrue` on
an attempted symlink creation so stock Windows skips with a reason while CI and Linux still enforce
the security behaviour.

---

## 2. Docs that no longer match the code

### 2.1 `frontend/audit/README.md` is stale

It publishes a type-floor debt table — *"Current debt, measured on `8e996db2`: 84 rules across 10 of
16 surfaces"* — that no longer exists. #93 emptied the ratchet:

```ts
const UNMIGRATED = new Set<string>([]);
```

Verified by running it: `npx playwright test --config playwright.audit.config.ts type-floor` →
**16 passed**, zero debt logged. The README should record that the ratchet reached zero, and that
the rule is now simply "nothing may be added".

### 2.2 Issue #40 is half-obsolete

It triages two blocked dependency majors. JavaFX 26 (#11) was unblocked and merged by #92. Only
Spring Boot 4 (#8) remains blocked. The issue should be narrowed rather than left implying both.

---

## 3. Genuinely clean

Stated because it is worth knowing where *not* to spend time:

- **One TODO in the entire source tree**: `roblox-plugin/src/Main.server.luau:26`, a placeholder
  toolbar icon (`rbxassetid://0`). No FIXME, HACK or XXX anywhere in `frontend/src`, `core`,
  `server` or `desktop`.
- No `* 2.java` duplicates remain (the `HANDOFF.md` "Working-tree caution" note is now historical).
- Zero open PRs. Working tree clean.
- Frontend: 386 unit tests, 170 audit gates, all green.

---

## 4. The gate

`ROADMAP.md`, "The gate before more building: validate":

> The redirect's own final instruction is to validate with a real Roblox dev before expanding the
> roadmap. What a real user trips on reorders everything below.

Track A (solo, offline) ran 2026-07-20, passed every offline behaviour, and found + fixed two
launch-path blockers. What remains is Part 1 and Part 2 of `FRIEND-TEST.md` with a real Roblox dev:
pair the plugin, compare two Animation IDs they can actually access, walk the preflight.

Phases B (runtime playability probe), C (CurveAnimation), D (team polish), and E (shared team
provenance) are all explicitly validation-gated behind it.

**This is a human blocker and it cannot be worked around.** Section 1.1 currently prevents even
starting it.

---

## 5. Decidable without the friend test

### 5.1 Issue #43 — the review threshold

The measurement is already committed (`frontend/src/motion/testset/sweep.baseline.json`, 133
positives / 97 negatives). This is a product decision, not a research task:

| threshold | FP | precision | recall | F1 |
|---|---|---|---|---|
| 85 (shipped) | 4 | 0.968 | 0.917 | 0.942 |
| **90** | **1** | **0.992** | 0.902 | **0.945** |

Moving to 90 removes 3 of 4 false positives for 2 recall cases. `ROADMAP.md`'s own standing
constraint is *"precision over recall — a false accusation is the worst possible output; when in
doubt, under-flag."* The data and the stated principle both point at 90. Recommendation: take it.

### 5.2 Issue #44 — document the retargeting blind spot

Pure documentation, and the honest kind this product trades on: an animation retargeted onto a
different skeleton shares zero joint names, so it non-matches by construction and is never
measured. Belongs somewhere a user reads, not only in a test-file comment.

### 5.3 Issue #17 — write `docs/TIER3-ROADMAP.md`

Design only, explicitly no build. Self-contained.

---

## 6. Gated, and worth it when the gate lifts

**"Join the two halves"** (`HANDOFF.md`, what-to-build-next item 2) is the highest-value item on the
list. Motion-comparison evidence should be able to cite a registry asset — *"94% similar to
WalkCycle V3, registered by mira, mapped to ID 222 under your group"* — with the fingerprint as the
join key.

`HANDOFF.md` argues this is the feature no first-party Roblox tool can replicate, because Roblox
does not know two asset IDs are the same creative work and CreatorFlow does. That claim is worth
taking seriously, and it is also worth *not* building until the friend test says the two halves are
the halves a real team wants joined.

Then, in the handoff's order: team registries (the server API is per-account; real teams need
memberships), a fuller experience-permission graph, and issue #16 (mirror canonicalization —
measured mirror recall is 58.8%, and mirrored copies are a common Roblox theft pattern).

---

## Suggested order

1. **1.1 / 1.2 / 1.3** — unblock the build, unpin the release gate, guard the symlink test. Small,
   independently verifiable, and 1.1 is a prerequisite for the friend test.
2. **2.1 / 2.2** — refresh the two stale docs while the findings are fresh.
3. **Friend test.** Human. Everything below reorders around what it surfaces.
4. **5.1** — take the threshold decision; it needs no new work.
5. **6** — join the two halves, once validated.
