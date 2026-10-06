# Release-gate fixtures

Push CI (the `release-gate` job in `.github/workflows/ci.yml`) runs `ReleaseGateCli` on the two manifests in this directory.

`creatorflow-manifest.json` is a complete release of the four screenshots in `docs/screenshots/`. The job requires exit 0. If that manifest is BLOCKED, the push fails.

`creatorflow-manifest-blocked.json` is the same scan with no source evidence and every decision left `PENDING`. The gate answers it with `UNRESOLVED_SOURCE` and exit 2. The job requires that exit code. If the gate accepts this manifest, the push fails.

Neither file is a release manifest for the repository. A `PASS` means the checklist is complete for those four screenshots. It is not an originality or copyright verdict.

Both came from one scan of `docs/screenshots/`:

```bash
mvn -B -q -pl core package dependency:copy-dependencies -DincludeScope=runtime
java -cp 'core/target/classes:core/target/dependency/*' \
  creatorflow.manifest.ManifestCli docs/screenshots creatorflow-docs-screenshots 0.0.0-ci-fixture out.json
```

`ManifestCli` leaves every asset unresolved and `PENDING`, which is the blocked file, kept unedited. The passing file fills `source` and sets `decision` to `APPROVED`, then writes the manifest back through `ManifestJson` so the bytes are the writer's own. It is `creatorflow.manifest/v0.2` with an embedded `gate` of `PASS`, so the run also exercises the embedded-gate check.

A manual run of either file uses `.github/workflows/creatorflow-release-gate.yml`. The default input is the passing fixture. Pass the blocked path to watch "Enforce result" fail the run.
