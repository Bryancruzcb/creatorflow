# Track A results — solo offline friend-test dry run (2026-07-20)

Solo execution of every **[offline]** step in [`FRIEND-TEST.md`](FRIEND-TEST.md), run before
scheduling the live-Studio session, per `ROADMAP.md` ("Track A (solo, offline) can be run
today"). Driven end-to-end against the real desktop app (`LocalBridgeServer` + built
`frontend/dist`) on Windows 11; the browser side ran in Chromium against the served bundle,
the plugin side was simulated with `curl` against the documented `/plugin/v1` contract.

**Bottom line: every offline product behavior passed. The launch path itself had two
step-zero blockers — both found by this dry run, both fixed in this change. The friend test
would have dead-ended at "open the workspace" twice over.**

## Blockers found (and fixed here)

### 1. Desktop-served workspace was a blank page (CSP × Ajv)
`frontend/src/manifest/manifest.ts` compiled its two JSON schemas with Ajv **at module
scope**. Ajv's runtime `compile()` generates code via `new Function(...)`, which the
bridge's deliberate CSP (`script-src 'self'`, no `unsafe-eval`) blocks. The exception at
bundle-evaluation time meant **React never mounted — `#root` stayed empty** on exactly the
path the friend test uses. Never seen before because UI development runs on the Vite dev
server, which serves without the CSP. Fix: the schemas are now compiled at build time into
`frontend/src/manifest/validators.generated.js` (Ajv standalone codegen, no runtime eval);
the CSP is unchanged.

### 2. The documented launch command never delivered its settings
`mvn -pl desktop javafx:run -Djavafx.options="-Dcreatorflow.web.root=... -Dcreatorflow.web.open=true"`
(as documented in FRIEND-TEST.md, HANDOFF.md, and the README) does not forward those `-D`
properties to the forked app JVM — verified live: the app served the classpath placeholder
page ("The production React bundle was not packaged with this desktop build") and wrote its
database to `~/.creatorflow` despite an explicit `data.dir` override. Fix: the desktop pom
now wires `<options>` through Maven properties, so the launch command is plain:

```bash
mvn -pl desktop javafx:run -Dcreatorflow.web.root=<ABS-PATH>/frontend/dist -Dcreatorflow.web.open=true
```

`AppContext`/`LibraryPaths` treat blank property values as unset (the pom defaults are
empty). Verified: the fixed command serves the real bundle and honors `creatorflow.data.dir`.

### 3. No way to recover the workspace URL
The workspace URL (random port + one-shot `/launch` token) was only ever exposed by
auto-opening the OS browser. If that fails — or on a headless/remote setup — the runbook
dead-ends with no fallback. Fix: the app now prints
`CreatorFlow workspace: http://127.0.0.1:<port>/launch?token=...` to stdout at startup.

## Offline capture template (filled)

```
Env: solo dry run, Bryan's machine (automation-driven)  OS: Windows 11 Pro  Date: 2026-07-20
Part 1:
  restart persistence ..... token still valid after restart? Y (hard process kill, not a
                            clean close — same token returned 200 on the relaunched bridge)
                            revoke kills it? Y (401 {"error":"A valid CreatorFlow Studio
                            pairing is required"})
Part 2:
  experience binding ...... persisted? Y (survives restart; stamped into manifest under
                            top-level key "experience") ; labeled declared-not-verified?
                            API yes — UI wording check pending the visual pass
  tri-state badges ........ VERIFIED/DECLARED/NOT_VERIFIED shown correctly? Y (manifest
                            evidenceBases: verification VERIFIED, source DECLARED,
                            ownership NOT_VERIFIED, decision DECLARED) ; ownership
                            NOT_VERIFIED? Y (all 79 assets)
  required-reason gate .... blocked on empty reason? Y — 400 "reason must be non-blank
                            text" for both "" and "   " ; append-only history with
                            supersede chain verified (NEEDS_REVIEW → APPROVED)
  release PASS/BLOCKED .... BLOCKED with 101 reasons (78 UNRESOLVED_SOURCE +
                            23 FLAGGED_WITHOUT_APPROVAL); after resolving/excluding all:
                            PASS. Reason wording carries asset path + message.
  manifest determinism .... two exports byte-identical? Y — same release re-download
                            SHA-256-identical AND two separately created releases from the
                            same scan are byte-identical (generatedAt derives from scan
                            completion, not wall clock)
  gate CLI integrity ...... matches UI? Y (PASS→exit 0, BLOCKED→exit 2, 101 violations
                            matching) ; tampered gate rejected? Y (hand-flipped
                            gate.result → exit 4, "embedded gate is tampered or stale")
  rollback target ......... shown + links prior manifest? Y at the API (release C →
                            comparison.previousReleaseId → release B → release A); UI
                            rendering check pending the visual pass
  published version ....... recorded + labeled self-reported? Y recorded (42); UI label
                            check pending the visual pass
  pairing list/revoke ..... list works? Y (id/issued/expires/status; token never
                            re-exposed) ; revoke invalidates token? Y
  anything stumbled on:     see Blockers above + Notes below
```

## Extra coverage beyond the template

- **Scan engine on the demo root** (`frontend/public`, 107 files): 80 supported assets,
  23 DUPLICATE + 1 SIMILAR (the stress-fixture identical PNGs), 2 MISSING_DEPENDENCY
  findings from the broken `.gltf` fixtures, and the 8192×8192 stress PNG correctly
  rejected by the `SafeImageIo` 40 MP decompression-bomb cap.
- **Simulated plugin comparison** (`POST /plugin/v1/motion-comparisons`, synthetic
  KeyframeSequence self-pair): 201, identical fingerprints, `EXACT_CURVE_DATA`, verdict
  wording "Exact curve data — provenance required", limitations text present
  ("Similarity is evidence, not a determination of ownership or infringement").
- **Plugin auth edge**: 1-character token change → clean 401 (checklist item passes).
- **Session hygiene observed**: launch token is strictly single-use; `/api/*` requires
  session cookie + CSRF header + exact-origin; plugin routes bypass session but require
  Bearer + loopback Host.

## Notes for the live friend test (not fixed here)

1. **Restart changes the bridge port.** The pairing token survives a desktop restart
   (SQLite-backed, hashed at rest) but the endpoint URL does not — the bridge binds a fresh
   ephemeral port every launch. FRIEND-TEST step 2d should tell the friend to re-copy the
   endpoint URL into the plugin (keeping the same token) after any restart.
2. A release that PASSes still reports its excluded assets inside
   `comparison.unresolved` (excluded assets keep unresolved source; they just don't
   block). Worth a wording check in the UI so "unresolved: 23" next to a PASS doesn't
   read as a contradiction.
3. `favicon.ico` 404s on the served workspace (cosmetic).
4. UI-level wording/badge checks that need eyes on the rendered app were **pending the
   CSP fix** at the time of the API pass — see the visual-pass section below if present,
   otherwise treat them as the first item of the live session.

## What this dry run deliberately could not cover

Everything tagged **[live-Studio]** in FRIEND-TEST.md: real Animation ID reads through a
signed-in Studio user, Roblox permission/moderation error copy, the HTTP-permission prompt
flow, the >2,000-keyframe dense-clip failure UX, last-known-good pinning from real
comparisons, and the actual Studio publish → place-version handoff.
