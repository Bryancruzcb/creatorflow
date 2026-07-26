# CreatorFlow: resume and interview guide

> **Refreshed 2026-07-26** to describe the product as it is after the 2026-07-17 redirect. The
> earlier version pitched a general "creative asset bill of materials"; CreatorFlow is now a
> **local-first release-preflight tool for small Roblox teams**, which is a narrower and much more
> defensible claim. It also undersold the strongest engineering in the repo — the parity-proven
> engine port and the honesty constraints — so those are here now.

## The shortest correct explanation

CreatorFlow answers one question before a Roblox team publishes an update: **can these exact assets
safely ship to this experience, what changed since the last known good, and what evidence is
missing?** It scans locally, compares changed assets against immutable snapshots, records human
decisions with required reasons, and emits a deterministic PASS/BLOCKED release manifest naming the
version to roll back to. Publishing itself stays in Roblox Studio.

The design principle that runs through all of it: **detection finds conflicts; it never claims
originality, ownership, or infringement.**

## Thirty-second pitch

"Small Roblox teams ship updates without being able to answer basic questions: is this animation the
one we approved, did anything change since the last good build, who actually owns it, and what do we
roll back to if it breaks. CreatorFlow runs locally, pairs with a Roblox Studio plugin over a
loopback bridge, fingerprints animation curve data, compares it against immutable last-known-good
snapshots, and turns findings into decisions a person records with a reason. The output is a
deterministic release manifest that says PASS or BLOCKED, cites its evidence, and names a rollback
target. Similarity is always a review lead — never proof of copying."

## Resume bullets

Pick two or three; they are ordered strongest-first.

- Built a local-first release-preflight system for Roblox teams (Java 21 + React 19 + SQLite) that
  fingerprints animation data through a hardened loopback bridge to a Studio plugin, tracks drift
  against immutable snapshots, and emits byte-deterministic PASS/BLOCKED release manifests with
  rollback targets.
- Reimplemented a Java motion-comparison engine in TypeScript and **proved numeric parity against a
  Java-generated oracle before changing any math**, then used that locked baseline to measure three
  tuning changes — cutting false positives from 14.4% to 4.1% while holding recall at 92.4%.
- Integrated Roblox Open Cloud to verify an animation's creator against the target experience's
  owner, designed so that obtained facts read VERIFIED, an unresolvable check reads UNVERIFIABLE,
  and the human-entered link between a local file and an asset ID stays DECLARED — the tool never
  borrows credibility it did not earn.
- Diagnosed and fixed a blank-page failure that only appeared in the packaged desktop build: the
  JSON-Schema validator used runtime code generation, which the app's `script-src 'self'` CSP
  blocks; replaced it with build-time compiled validators plus a CI drift check.
- Hardened a SQLite evidence store: fixed lexicographic timestamp ordering that could return a
  superseded decision from "latest wins" queries, and made snapshot drift detection catch playback
  changes (loop/priority) that leave curve data byte-identical.
- Ran an adversarial multi-agent review of my own feature branch and fixed the critical finding it
  surfaced — a path where a real group member could be reported as a *verified* ownership mismatch,
  i.e. an authoritative false accusation.

## The three stories worth telling in an interview

### 1. Proving parity before optimizing

The accurate engine was Java, reachable only through the desktop bridge; the website ran a
different TypeScript engine. Java cannot run in a browser, and serving it would have meant a paid
JVM tier plus a network round trip to run code that can't run where the users are. So I ported the
Java algorithm to TypeScript and **committed the port only once it matched a Java-generated oracle**
(rounded fields within 0.01, intermediates ~1e-6). That ordering is the whole point: every
improvement afterwards was measured against a provably identical baseline, so the 14.4% → 4.1%
false-positive number means something. The engine is pinned by 23 golden vectors and a parity test
that fails if the port drifts.

**What it shows:** I can tell the difference between "the numbers improved" and "I can prove the
numbers improved."

### 2. The bug that only existed in the build

Every check was green — unit tests, typecheck, production build, schema parity — and the desktop app
still rendered a blank page. The manifest validator compiled JSON Schemas with Ajv at module scope;
Ajv generates validator code with `new Function`, and the bridge serves the bundle under a strict
CSP with no `unsafe-eval`. The exception during module evaluation took down the whole bundle. It was
invisible because development runs on the Vite dev server, which has no CSP, and because every test
exercised TypeScript source rather than the built output.

The fix was build-time standalone codegen with the generated validators committed and drift-checked
in CI. A later variant of the same class of bug — a CommonJS `default` export binding to the module
object under one interop and the function under another — got past me too, and was caught by the
Playwright suite, the only check that drives the built bundle.

**What it shows:** where the test gap was, not just where the bug was. "It passes locally" is a
claim about an environment, not about the artifact you ship.

### 3. Designing so the tool cannot lie

The worst output this product can produce is a confident false accusation. That constraint drove
concrete engineering, not just copy:

- Ownership verification separates *facts obtained* (VERIFIED) from *facts unobtainable*
  (UNVERIFIABLE) from *a human's claim* (DECLARED). A mismatch is worded as a review lead and
  requires a person to record a decision; it never auto-blocks and the word "infringement" never
  appears.
- A review of my own branch found that group-membership lookup collapsed "not a member" and "is a
  member, rank unresolvable" into the same value — so an unexpected API shape could publish a
  *verified* claim that someone was not in a group they were actually in. Fixed by making membership
  a genuine tri-state where unknown degrades to a match, never to an accusation.
- Anything the tool did not observe renders as unknown. A snapshot from before a field was recorded
  never reads as drift just because newer snapshots know more.

**What it shows:** I can take a product constraint and turn it into type-level and test-level
guarantees.

## Two-minute architecture explanation

"The architecture separates detection from judgment. `core` is plain Java — no UI, no database, no
Spring — so a fingerprint means exactly the same thing in the CLI as in the desktop app; it owns
hashing, perceptual and motion comparison, the versioned manifest model, and the release gate. The
`desktop` module owns everything stateful and everything that touches the network: a loopback-only
HTTP bridge with a single-use launch token, same-origin plus CSRF enforcement, a SQLite store with
insert-only ledgers, and the one component allowed to call Roblox. The React workspace is served by
that bridge and talks to it over the same origin.

The rule I'd highlight: the export path never makes a network call. Manifests are built from
persisted rows only, which is what makes them byte-deterministic — regenerate a release and you get
identical bytes, so a CLI can verify the embedded gate result and exit non-zero if someone edited
it."

## Questions and answers

**"Is it an originality detector?"** No. It finds exact and perceptual conflicts and missing
evidence. A clean result means no conflict was found in what was checked. Ownership comes from
source records, licenses, declarations, and human review.

**"What does VERIFIED mean, exactly?"** That CreatorFlow obtained the fact itself — for ownership,
that Roblox's API returned a creator and an experience owner. It does *not* mean the team has the
right to ship the asset, and it never applies to a link a human typed in.

**"Why local-first?"** Projects contain unreleased game art and licensed material. Fingerprinting
locally reduces exposure, and the bridge is loopback-only by design — Studio and the app must be on
the same machine.

**"Why not just use Git?"** Git versions files well but does not explain perceptual similarity,
reconstruct a missing license, or produce a release-focused inventory with a rollback target.

**"What was the hardest product decision?"** Cutting the community gallery from the center. It was
visually familiar and strategically broad. Narrowing to release preflight for one platform produced
a clearer user, workflow, and roadmap — and the old server is frozen, still green in CI, rather than
deleted or half-maintained.

**"What's the biggest risk?"** That no Roblox developer wants this workflow. It has not been
validated with a real team yet; that test is the next step, and it is deliberately the gate before
any further roadmap expansion.

## Honest boundaries — say these out loud

- It does not prove copyright ownership, and a perceptual match is not infringement.
- Exported manifests are deterministic and integrity-checkable, but not cryptographically signed.
- Ownership verification covers an animation ID a person supplies; CreatorFlow cannot tell which
  Roblox asset a local file corresponds to, so that link is always labeled as declared.
- The product has not yet been used by a real Roblox team.

These limits make the project sound more mature, not less: they show the difference between a
convincing demo and a system someone could trust.
