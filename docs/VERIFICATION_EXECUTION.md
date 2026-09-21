# Verification execution

The executable entrypoint is `verification/verification-runner.mjs`. It creates
one fresh run directory, clones the requirements registry with artifact paths
bound to that directory, records command logs and source fingerprints, and
invokes `verification/evidence-engine.mjs` against the same run. A selected
output directory must be empty; this prevents a failed command from reusing a
previous result.

## Scopes

Run the local scopes with npm:

```sh
npm run verify:all       # fast: 1,000 generated cases and bounded TLC
npm run verify:nightly   # fast plus 10,000 cases, boundaries, corpus, bench, mutation
npm run verify:release   # nightly plus production build/package and browser gates
```

The default output is a unique directory under `tmp/verification/runs/`.
For a named run, pass a new directory and preserve the resulting directory as
the evidence bundle:

```sh
node verification/verification-runner.mjs \
  --scope fast \
  --out-dir tmp/verification/<run-id> \
  --archive-dir tmp/verification/<run-id>-archive
```

`nightly` inherits `fast`; `release` inherits both. The GitHub workflow runs
`fast` on pushes and pull requests and `nightly` on schedule or manual request.
It uploads the complete run directory and never invokes destructive live
provider operations.

## Evidence boundaries

- `PASS` implementation entries come from assertions selected by their exact
  SAFE identifier in a fresh raw Vitest report.
- `PASS` finite-model entries require a successful pinned TLC run, positive
  state exploration, complete required-action coverage, and a reachable
  nonempty Undo witness. TLC exhausts only the finite constants in
  `verification/model/TrashLifecycle.cfg`; it does not prove TypeScript
  refinement or whole-app behavior.
- Mutation evidence reports the full scoped Stryker result and fails below the
  threshold or with critical survivors. A percentage does not waive an
  unexplained safety survivor.
- Browser entries cover the mocked-provider dispatch boundary. They do not
  establish live provider behavior.
- The production package entry binds the fresh build flags, manifest, and
  digest of every file in the production build directory.
- `verification/provider-fixtures.json` records the disposable provider
  fixture contract. A provider may be marked `PASS` only when its contract
  points to a structured round-trip artifact that validates the account,
  synthetic six-item scope, exact one-item Trash result, provider-side Trash
  observation, PhotoSweep Undo, and fresh restored scan. Missing or incomplete
  external evidence remains `BLOCKED`; personal libraries are never used for
  destructive tests.

Raw logs, reports, summaries, and source fingerprints are retained in the
dated `tmp/verification/` evidence directory. The registry and evidence engine
reject missing or duplicate obligations, path/hash/fingerprint mismatches,
zero-check success, incomplete models, nonzero successful exits, and mandatory
blocked evidence.

The source fingerprint canonicalizes the order of semantically equivalent
`content_scripts` entries in the generated production manifest. This prevents
Plasmo filesystem traversal order from creating false source drift while the
package audit still records the raw manifest bytes and every packaged-file
digest.
