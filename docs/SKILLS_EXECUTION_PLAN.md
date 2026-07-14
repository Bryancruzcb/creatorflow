# CreatorFlow × new skills — execution plan

Written July 13, 2026, for an ultra-mode session. Baseline at time of writing: 91 Java tests,
22 frontend tests, typecheck + build green (per `docs/HANDOFF.md`, the consolidated handoff).

## Skills inventory (installed ~7:15–7:20 PM today) and verdicts

| Skill / plugin | Useful here? | Why |
| --- | --- | --- |
| **static-analysis** (Trail of Bits — Semgrep/CodeQL) | **Yes — highest value** | Originality/trust is the product's whole pitch, and the attack surface is real: file uploads, user SVG, Spring Security session + API-key auth, content-addressed file serving, the loopback desktop bridge with pairing tokens, and a Luau plugin posting JSON to it. A finding here is a product bug, not just hygiene. |
| **superpowers** (TDD, systematic-debugging, verification-before-completion, subagent-driven-development, worktrees) | **Yes — process backbone** | Three-module Maven + React repo with a strong existing test culture; TDD fits core-engine work (fingerprints, manifest, release gate) unusually well because everything is deterministic. |
| **superdesign** | **Yes — targeted** | The handoff's build-order items 5–6 (Release Flow as a Roblox checklist; Stress Lab device-evidence matrix) are UI-design problems before they are code problems. |
| **dataviz** | **Yes — targeted** | Stress Lab evidence matrix, Motion Lab score displays, diff heatmap legend — all charts. |
| **karpathy-guidelines** | **Yes — ambient** | Load during all implementation phases; zero-cost guardrail against overbuilding. |
| **/ship pipeline** (planner→coder→tester→reviewer agents) | **Situational** | Good for one well-scoped roadmap feature; in ultra mode, Workflow-orchestrated subagents cover the same ground with more control, so use one or the other per feature, not both. |
| **deep-research** | **Mostly no** | `docs/ROBLOX_WORKFLOW_RESEARCH.md` already covers the Roblox landscape; the remaining unknowns (Studio error copy, `GetAnimationClipAsync` behavior) need a live Studio client, not web research. Keep in reserve for Chromaprint/C2PA when those roadmap items come up. |

## Execution phases (ordered)

### Phase 1 — Security audit (static-analysis plugin)
Run `/static-analysis:semgrep` in **important-only** mode across `server/`, `core/`, `desktop/`,
`frontend/src/`, then escalate interesting areas with CodeQL (Spring taint tracking) if Semgrep
surfaces smoke. Priority review surfaces:
- Upload pipeline + content-addressed `FileStore` (path traversal, decompression, content-type)
- SVG handling and the no-script CSP claim in the README — verify it's actually enforced
- Session auth vs `X-Api-Key` boundary; API-key storage/comparison (timing, hashing)
- Desktop loopback bridge: pairing-token lifecycle, non-loopback rejection, 2 MiB bound
- Adversarially verify findings before fixing; fix confirmed ones with TDD (failing test first).

### Phase 2 — Review the freshly mirrored frontend
The React workspace was just moved into git from a non-git output dir. Run `/code-review` at
high effort on it (and the recent motion/bridge commits), then `/simplify` for cleanups. Fix
confirmed findings.

### Phase 3 — One feature from the handoff build order (superpowers TDD + subagents)
Recommended: **build-order #3 — last-known-good / last-published immutable animation snapshots**
(self-contained: core model + desktop persistence + UI surface; deterministic, so TDD-shaped;
doesn't require a live Studio friend test, which #1–#2 do).
Use `superpowers:writing-plans` → `subagent-driven-development`, karpathy-guidelines loaded,
`verification-before-completion` + `/verify` before claiming done.

### Phase 4 — UI design pass (superdesign + dataviz)
- Superdesign draft: **Release Flow as a Roblox release checklist** (build-order #5: version note,
  permission diff, rollback target, rollout, smoke test).
- Dataviz-guided **Stress Lab evidence matrix** (build-order #6), explicitly separating modeled
  vs measured results.
Design drafts first, implement only what Bryan approves.

### Phase 5 — Wrap-up
Full `mvn verify` + frontend test/typecheck/build, `superpowers:requesting-code-review` on the
diff, then `superpowers:finishing-a-development-branch`.

## Standing rules for the session
- Never touch the `* 2.java` shadow copies (see HANDOFF.md working-tree caution).
- Exclude `stress-fixtures/` from any repo-wide scan — its duplicated textures are deliberate.
- Don't merge the two Studio plugins' network/auth contracts.
- Don't commit 100 MB+ local fixture files.
