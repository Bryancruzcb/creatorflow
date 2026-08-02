# Tier 3 — web-scale motion fingerprinting

**Status: design only. Nothing here is built, and nothing here should be built yet.**

Closes the documentation half of issue #17. This describes how motion matching would scale past
pairwise comparison *if* the friend test and a shared registry ever justify it. `ROADMAP.md` gates
every phase after A on validation; this document is deliberately downstream of all of them.

## The problem this would solve

Today the engine answers **"are these two clips related?"** — `compareMotion(source, candidate)`,
one pair at a time. Every product surface is built on that shape: the Motion Lab compares two
chosen clips, and the desktop bridge compares a scanned file against a nominated animation id.

A registry answers a different question: **"is this clip related to anything we have seen?"** That
is a search, not a comparison, and pairwise scoring does not become a search by being run more
often. At *n* registered animations, a naive scan is *n* DTW alignments per query — DTW is
O(len²) even banded, and the current engine samples 48–96 frames per clip. A few thousand
animations makes each upload take minutes; a few hundred thousand makes it impossible.

The fix is the standard two-stage retrieval shape: a cheap vector that can be indexed, then the
expensive verifier applied only to what survives.

## Stage 0 — exact hash (already exists)

`sha256` on the canonical keyframe stream. Catches byte-identical re-uploads for free and should
always run first, because it is the only stage that returns a certainty rather than a score.

## Stage 1 — a fingerprint vector

The requirement is a fixed-length vector where **near in vector space ⇒ plausibly related**, so an
ANN index can do the recall.

**Hand-crafted DCT over normalised curves, not learned embeddings.** For each joint channel,
resample to a fixed frame count, take the low-order DCT coefficients, and concatenate into an
L2-normalised vector of roughly 64–128 dimensions.

Two inputs, both already normalised by `clipToNormalized`:

1. **Joint-angle curves** — the existing normalised representation.
2. **FK'd end-effector trajectories** — hands, feet and head positions after forward kinematics.

The second is the interesting one. End-effector paths are **skeleton-independent** in a way named
joint tracks are not, which is the only credible route to the retargeting blind spot documented in
the root README and issue #44. A clip retargeted onto a different rig keeps its end-effector
trajectory shape while sharing zero joint names.

### Why forward kinematics is mandatory here, not an optimisation

It is tempting to attack the retargeting gap more cheaply — keep the current normalised
representation and match tracks by curve *shape* instead of by name, discovering the joint
correspondence rather than trusting the names. That cannot be graded, and the reason is worth
recording because it looks like a testing problem and is actually a representation problem.

To grade it you need a cross-rig positive. The only such fixture that can be built honestly from
what the pipeline currently carries is "the same curves, every joint renamed" — and that is
**byte-identical in construction to the `partial-coverage` negatives at `sharedCount = 0`**
(`copyDetectionCases.ts`), which the test set deliberately labels as *not* evidence: "sharing one
limb's curves with an otherwise unrelated rig is not theft evidence." Labelling the same
construction a positive would make the set self-contradictory, and an engine tuned to satisfy both
labels at once is being asked to distinguish cases that are identical in its input.

That is the blind spot restated precisely: **it is not that the engine scores retargeted copies
badly, it is that joint-name-keyed curve data does not contain the information needed to tell a
retarget from an unrelated rig.** No amount of scoring work closes it. The representation has to
change first — FK'd end-effector trajectories, which need the bind pose and parent chain that
`clipToNormalized` drops on purpose — and only then does a gradeable fixture become constructible.

So the order is forced: extend the adapter to carry hierarchy, build cross-rig fixtures against the
new representation, and only then write a matcher. Anything that starts at the matcher is ungraded
by construction, which in a tool whose output is evidence is the worst place to be.

**Do not fingerprint raw quaternion components.** `q` and `−q` are the same rotation, so the raw
components are not a function of the pose — the double cover would put identical poses at opposite
ends of the vector space. The existing engine already handles this (`motionCurves`, the Shepperd
path in the Java kernel); a fingerprint that forgot it would fail in a way that looks like bad
recall rather than a bug.

## Stage 2 — the index

- **ANN**: pgvector if the registry is already Postgres, hnswlib if it is not. Either is fine at
  the scale this would first matter at; the choice should follow the deployment, not lead it.
- **Verbatim segment lifts**: rolling-hash shingling over the canonical keyframe stream, so that
  "the middle two seconds of my walk cycle" is findable even when the whole-clip vectors are far
  apart. This is a different query than whole-clip similarity and needs its own index.

## Stage 3 — re-rank with the engine we already trust

ANN recall is coarse by design. Take the top *k* candidates and re-score them with **banded DTW —
the shipped verifier**, unchanged.

This is the property that makes the whole design safe: the number a human is finally shown comes
from the same engine that produces today's numbers, graded by the same scorecard and the same
threshold. The index only decides *what gets compared*. A retrieval bug costs recall; it cannot
invent a false accusation, because nothing reaches a person without passing the verifier.

## Explicitly deferred: learned embeddings

ST-GCN or similar, exported to ONNX, would likely beat a DCT fingerprint on recall. It is still the
wrong thing to build here, for reasons that are not about effort:

- It is a months-long data and evaluation project, and the training data would have to be licensed
  animation — in a tool about provenance, training on scraped animations would be self-refuting.
- **Over-invariance is a false-accusation risk.** A learned embedding trained to be invariant to
  style and speed can place two genuinely independent walk cycles next to each other. The product's
  standing constraint is precision over recall, and an embedding that cannot explain *why* two
  clips are close is very hard to hold to that.
- A hand-crafted DCT fingerprint is inspectable. When it puts two clips together you can say which
  coefficients drove it. That is worth a great deal in a tool whose output is evidence.

Revisit only with a real labelled corpus and a scorecard that measures false accusations on it.

## What would have to be true first

1. Real teams use shared provenance at all (`ROADMAP.md` Phase E). *(2026-08-02: the friend
   test that was to prove demand is permanently cancelled; Phase E is approved to build by
   owner decision. The precondition is now "Phase E ships and real teams adopt it" — still
   unmet, so nothing here unlocks.)*
2. A registry exists with enough registered animations that pairwise scanning is genuinely too
   slow — below roughly a thousand, it is not.
3. ~~Mirror canonicalisation (#16) has landed.~~ **Satisfied.** Mirroring used to be detected by
   accident — 31.6% recall, and effectively 0% on three of the four graded rigs — and a fingerprint
   built on top of that gap would have baked it into the index. #16 closed it by scoring each pair
   in both orientations: mirror recall 6/19 → 19/19 with no added false positives at any threshold.
   Note the caveat that came with it (`testset/README.md`): the canonicalisation inverts the same
   simplified reflection the fixtures are generated from, so a real Blender- or Studio-produced
   mirror is still unmeasured.

The first two do not hold, and the order matters more than the design does. Precondition 1 now
rides on Phase E shipping and being adopted, which gates everything anyway.
