# Dependency overrides

Last reviewed: 2026-10-03

PhotoSweep temporarily applies compatibility and advisory overrides to
transitive dependencies in the Google Cloud and Plasmo dependency graphs:

```json
{
  "@grpc/grpc-js": "1.14.5",
  "gaxios": "7.1.5",
  "minimatch@^10.0.0": {
    "brace-expansion": "5.0.12"
  },
  "minimatch@^9.0.0": {
    "brace-expansion": "2.1.7"
  },
  "rimraf": "6.1.3"
}
```

## Why

- `gcp-metadata` pins `gaxios` 7.1.3, which retains the vulnerable Rimraf 5
  dependency path.
- The Firestore and Google GAX paths admit `@grpc/grpc-js` 1.14.5, the first
  release outside the current vulnerable range.
- `google-gax` permits Rimraf 5, whose Glob/Minimatch dependency path retains
  the vulnerable `brace-expansion` release.
- Gaxios 7.1.5 removes its Rimraf dependency. Rimraf 6 resolves to Glob 13,
  Minimatch 10, and the scoped `brace-expansion` override keeps that path on
  patched `5.0.12`. The scope preserves `brace-expansion` 2 for Minimatch 9,
  which depends on its callable CommonJS export; `2.1.7` remains within the
  declared `^2.0.1` range and includes the patched 2.x release.

The scoped Minimatch 9 and 10 overrides in `pnpm-workspace.yaml` mirror the
rules used by npm.

The overrides are a temporary compatibility measure, not a waiver. They must
be removed once Google Cloud packages publish compatible dependency ranges.

## Required verification

Before release, run the full CI suite and a deployed Firestore-backed license
service smoke test. Verify checkout, signed entitlement refresh, Stripe webhook
processing, recovery, and rollback with the overridden dependency graph.

## Sources

- https://github.com/googleapis/google-cloud-node-core/issues/925
- https://osv.dev/vulnerability/GHSA-mh99-v99m-4gvg
- https://github.com/advisories/GHSA-m9gg-hp2v-232j
- https://github.com/advisories/GHSA-q2hr-2g5m-vwhr
- https://github.com/advisories/GHSA-qhr7-859c-m2p7
- https://github.com/advisories/GHSA-6j4f-fj2g-mc7p
- https://github.com/juliangruber/brace-expansion/blob/714b6228a5878cfc6b07dc319db0eb6376ab2c4d/index.js
