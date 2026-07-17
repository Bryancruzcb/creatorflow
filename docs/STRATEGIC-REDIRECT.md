---
type: project-strategy
project: CreatorFlow
status: proposed
date: 2026-07-17
tags:
  - creatorflow
  - roblox
  - fable
  - product-strategy
  - prompt
---

# CreatorFlow — Fable Strategic Redirect

## Product decision

CreatorFlow should narrow its focus the way WhatTheDiff narrowed its focus, without copying WhatTheDiff's purpose.

- **WhatTheDiff:** “What changed between these two 3D models?”
- **CreatorFlow:** “Can these exact Roblox assets safely ship to this intended experience, what changed, what permission or provenance evidence is missing, and what can the team roll back to?”

CreatorFlow becomes a **local-first Roblox release-preflight tool for small teams**. Visual comparison and similarity remain supporting evidence, not the entire product and never a copyright verdict.

The focused workflow is:

1. Choose a Roblox project and intended release.
2. Check animation IDs and available permission evidence.
3. Compare changed assets against immutable last-known-good snapshots.
4. Resolve provenance or production-readiness findings.
5. Produce a deterministic PASS or BLOCKED release record with a rollback target.
6. Hand publishing back to Roblox Studio.

The gallery, marketplace, generalized creative-platform features, direct publishing, and copied/not-copied framing become secondary or deferred.

## Paste-ready Fable prompt

<role>
You are the lead product architect and engineering orchestrator for CreatorFlow.
Your immediate job is to consolidate the existing multi-agent effort and align it
with a narrower product strategy. This is an assessment and planning task, not an
authorization to implement the redirect yet.
</role>

<context>
CreatorFlow has accumulated several product directions: an originality-checked
gallery, creative-asset scanning, 3D comparison, Roblox animation analysis,
provenance tracking, and release gating.

The underlying engineering is valuable, but the product story is too broad.
WhatTheDiff succeeded because it made one painful workflow immediately legible.
CreatorFlow needs comparable focus without copying WhatTheDiff's purpose.

The chosen direction is a local-first release-preflight tool for small Roblox
teams. The redirect is happening now to prevent further work from increasing
scope without validating user demand.
</context>

<product_decision>
CreatorFlow answers one primary question:

“Can these exact Roblox assets safely ship to the intended experience, what
changed, what permission or provenance evidence is missing, and what can the
team roll back to?”

The intended user is a small Roblox studio, agency, technical artist, animation
lead, or release owner preparing a real release.

The product's primary value is release confidence and evidence. Similarity is
one supporting signal, never the central product promise.
</product_decision>

<product_boundaries>
CreatorFlow is not primarily:

- A community gallery or marketplace.
- A copied/not-copied detector.
- A copyright, infringement, or authorship judge.
- A general-purpose animation editor.
- A direct Roblox publisher.
- A replacement for Roblox Studio.
- A clone of WhatTheDiff.

Treat similarity as a review lead only. Clearly distinguish verified facts,
modeled analysis, human declarations, and unknown or unverified conditions.
</product_boundaries>

<immediate_action>
Do not begin the new implementation yet.

Do not spawn additional agents until the existing agent effort has been
inventoried. Use the existing agents to report their status when useful.

Collect a checkpoint from every active, paused, or recently completed agent:

1. Assigned task.
2. Current status.
3. Files, branches, or artifacts changed.
4. Tests and verification actually run.
5. Remaining work.
6. Dependencies or blockers.
7. Relevance to the narrowed product direction.
8. Recommended disposition.

Preserve all existing work. Do not delete changes, discard branches, merge,
push, or rewrite history during this consolidation.
</immediate_action>

<classification_rules>
Assign every workstream exactly one disposition:

<finish>
Work that directly improves security, correctness, data integrity, test
coverage, motion-algorithm consistency, Studio-plugin reliability, immutable
snapshots, provenance decisions, release-gate behavior, or required
documentation.
</finish>

<checkpoint>
Partially completed work that can be brought to a safe, documented, testable
state with limited effort but should not expand further.
</checkpoint>

<defer>
Gallery and marketplace expansion, social features, generalized creator-platform
functionality, additional showcase or visual polish, speculative AI or copyright
detection, direct publishing, and work that does not strengthen the focused
Roblox release-preflight workflow.
</defer>
</classification_rules>

<focused_milestone>
Design the smallest credible end-to-end milestone containing:

1. Selection of one local CreatorFlow project and intended Roblox experience.
2. Secure pairing with the existing Roblox Studio plugin.
3. Reading permitted KeyframeSequence Animation IDs.
4. Immutable current and last-known-good snapshots.
5. Understandable motion and version-change evidence.
6. Owner, group, experience, and permission evidence where genuinely verifiable.
7. Explicit “not verified” states where verification is unavailable.
8. Human provenance decisions with required reasons.
9. A deterministic PASS or BLOCKED release manifest.
10. A visible rollback target.
11. An explicit handoff to Roblox Studio for publishing.

Reuse existing implementation wherever possible. Do not redesign or rebuild a
working layer simply to match the new terminology.
</focused_milestone>

<acceptance_criteria>
The milestone must let a Roblox developer complete this task without coaching:

“Determine whether these animations are ready for the intended production
experience, resolve the important findings, and show which evidence and rollback
information will travel with the release.”

Success means:

- A small-project flow can be completed in under five minutes.
- Every PASS or BLOCKED result identifies its supporting evidence.
- Similarity is never presented as proof of copying.
- Unknown permission or runtime state is not reported as verified.
- Results survive restart where persistence is claimed.
- The exported manifest is deterministic and machine-verifiable.
- Existing automated tests remain green.
- Any requirement needing live Roblox Studio testing is labeled accordingly.
</acceptance_criteria>

<execution_policy>
When enough information is available, act instead of repeatedly reconsidering
the strategy.

Run independent repository inspections and agent-status checks in parallel.
Run dependent operations sequentially.

Do not add features, perform unrelated refactors, or introduce abstractions for
hypothetical future requirements.

Before reporting progress, verify every claim against tool output, repository
evidence, or an agent result from this session. If something was not verified,
state that explicitly.

Use a fresh-context verifier agent to review the final consolidation against
this prompt. The verifier should inspect the evidence and identify omissions;
it should not implement changes.

Pause only for a destructive or irreversible action, a real scope expansion, or
information only the user can provide.
</execution_policy>

<deliverable>
Return one concise consolidation report with these exact sections:

## Recommendation
State the recommended disposition of the current agent effort and the smallest
next milestone.

## Agent checkpoint
Provide a table with one row per agent or workstream:
Agent | Task | Evidence-backed status | Files/artifacts | Tests | Disposition

## Preserve and finish
List work that directly supports the narrowed product and why.

## Safe checkpoints
List work that should be stabilized without further expansion.

## Deferred scope
List work removed from the immediate roadmap and why.

## Existing coverage
Map each focused-milestone requirement to existing code, tests, or documentation.

## Missing capabilities
Identify only the gaps necessary for the focused milestone. Separate code gaps
from live Roblox or human-validation gaps.

## Smallest implementation plan
Provide ordered, independently verifiable increments. Include completion tests
for every increment.

## Risks and honest limitations
Identify false-verification risks, duplicated implementations, stale
documentation, and unvalidated product assumptions.

## Approval gate
End with the exact decisions requiring user approval before implementation.
Do not end with a generic offer to continue.
</deliverable>

<completion_condition>
This task is complete when the existing agent effort has been accounted for,
the work has been classified, the focused milestone has been mapped against
current implementation, and the user has a concrete approval decision.

Do not implement the redirect until the consolidation report is delivered and
approved.
</completion_condition>

## Intended sequence

1. Paste the XML prompt into Fable when the session resumes.
2. Receive the consolidation report before authorizing more implementation.
3. Finish, checkpoint, or defer existing agent work based on evidence.
4. Approve only the smallest Roblox release-preflight milestone.
5. Test it with real Roblox developers before expanding the roadmap.