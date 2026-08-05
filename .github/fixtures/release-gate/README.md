# Release-gate dispatch fixture

`creatorflow-manifest.json` here exists so the **CreatorFlow release gate** workflow
(`.github/workflows/creatorflow-release-gate.yml`) can actually be dispatched and watched end to
end. The workflow is `workflow_dispatch`-only and refuses to run without a manifest, and `main`
carries no committed manifest — choosing the manifest that represents this repository is a product
decision (issue #123). So this branch, `claude/release-gate-fixture-dispatch`, carries a fixture
instead, and the gate is dispatched with `--ref` pointed at it. `main` stays clean.

There are two fixtures, because a gate that only ever passes proves nothing:

```bash
# passes — the whole workflow goes green
gh workflow run creatorflow-release-gate.yml \
  --repo Bryancruzcb/creatorflow \
  --ref claude/release-gate-fixture-dispatch \
  -f manifest=.github/fixtures/release-gate/creatorflow-manifest.json

# policy-blocked — "Evaluate manifest" records exit 2, the report still uploads,
# and "Enforce result" fails the run. A red run here is the gate working.
gh workflow run creatorflow-release-gate.yml \
  --repo Bryancruzcb/creatorflow \
  --ref claude/release-gate-fixture-dispatch \
  -f manifest=.github/fixtures/release-gate/creatorflow-manifest-blocked.json
```

## What it is

A real scan of `docs/screenshots/` — the four UI screenshots the README embeds. Sizes, SHA-256
digests, dimensions, perceptual fingerprints and verification statuses are whatever the scanner
computed; nothing in the evidence half is invented.

Produced with the workflow's own build command and the repo's own CLI:

```bash
mvn -B -q -pl core package dependency:copy-dependencies -DincludeScope=runtime
java -cp 'core/target/classes:core/target/dependency/*' \
  creatorflow.manifest.ManifestCli docs/screenshots creatorflow-docs-screenshots 0.0.0-ci-fixture out.json
```

`ManifestCli` scans with `SourceEvidenceResolver.unresolved()`, so every asset comes out of a scan
with no source, no license and a `PENDING` decision — which the gate blocks on
(`UNRESOLVED_SOURCE`), by design. Two fields per asset were then filled in, exactly as the desktop
review records them, and the manifest was re-serialized through `ManifestJson` so the bytes are the
writer's own:

- `source` — original CreatorFlow UI screenshots owned by the repository owner, MIT per `LICENSE`,
  each pointing at the committed file as its evidence URL.
- `decision` — `APPROVED`.

The result is a `creatorflow.manifest/v0.2` manifest carrying an embedded `gate` block of `PASS`,
so a dispatch also exercises `ReleaseGateCli`'s embedded-gate integrity check (exit 4 when a
manifest's own claimed result disagrees with a fresh evaluation) rather than only the pass path.

`creatorflow-manifest-blocked.json` is the *unedited* output of that same `ManifestCli` command —
`creatorflow.manifest/v0.1`, four assets, no source evidence, all decisions `PENDING`. The gate
answers it with four `UNRESOLVED_SOURCE` violations and exit 2. Keep it unedited: it is the
counterexample that shows the workflow can still fail.

## What it is not

Not a release manifest for CreatorFlow, and not a claim about the repository as a whole — it covers
four screenshots and nothing else. A `PASS` here means the release checklist is complete for those
four files: evidence recorded, decisions made. It is not an originality or copyright verdict.

Keep this file on this branch. It is the standing fixture for re-dispatching the gate; it should
not be merged to `main` as if it described the repository.
