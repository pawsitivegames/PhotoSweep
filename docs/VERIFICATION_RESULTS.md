# Verification results

**Current release run:** `20260918T092322Z` (executed 2026-09-18,
America/Vancouver)

**Formal verdict:** `FORMAL-VERIFICATION: PASS` for the repository release
scope. Launch readiness remains externally blocked by payment/license
production verification and exact Chrome Web Store candidate-publication
binding.

The current release verifier completed 29 mandatory evidence entries across 13
commands with `sourceDrift=false`; every entry passed. This includes the
finite-model, bounded replay, mutation, browser-boundary, performance,
evidence-integrity, production-package, Google, iCloud, and Amazon live
fixture entries. Payment/license production proof remains open. A public
Chrome Web Store listing is reachable, but the public artifact is not
byte-identical to the current candidate and publisher-side maintenance remains
blocked.

Authoritative aggregate:
[`aggregate-result.json`](../tmp/verification/20260918T092322Z/aggregate-result.json),
source fingerprint
`7eb7852cd55a60db47b5f0bd2878b00cce201a150f3261d5541f5eebbeb368aa`.

## External and bounded evidence

On 2026-09-16, the dedicated Google Photos fixture was executed in Aside using
`pawsitivegames@gmail.com`. PhotoSweep moved exactly one manually confirmed
similar-copy fixture to Google Photos Trash, the exact target was checked in
the provider Trash URL, PhotoSweep Undo was invoked, and a fresh scan reported
all six fixtures restored. See
[`LIVE_ROUNDTRIP_20260916.md`](../tmp/verification/20260916-live-google/LIVE_ROUNDTRIP_20260916.md).

A fresh bounded replay at the same 256-trace, depth-24 scope passed with 5,926
passes, 0 failures, and 0 unsupported steps after the request-bound timeout,
late/stale response, and local cancellation seams were added. The Google,
iCloud, and Amazon live fixtures also passed separately in Aside. The
crossed-identity-pair seam remains outside the model abstraction, and
payment/license production proof plus exact candidate-to-listing binding
remain open.

The iCloud live round trip moved the reviewed synthetic Pair A target to
Recently Deleted, restored it through PhotoSweep Undo, confirmed an empty
Recently Deleted view, and completed a fresh six-item scan. See the
[iCloud live round-trip record](../tmp/verification/20260917-live-icloud/LIVE_ROUNDTRIP_20260917.md)
and the [Amazon live round-trip record](../tmp/verification/20260916-live-amazon/LIVE_ROUNDTRIP_20260916.md).
The latest isolated payment/license lifecycle and public-listing refresh is
recorded in [`CLOUD_TEST_PREPAYMENT.md`](../tmp/verification-live-payment-20260918T074901/CLOUD_TEST_PREPAYMENT.md)
and [`store-readonly-check-20260918T080804Z.md`](../tmp/verification-live-payment-20260918T074901/store-readonly-check-20260918T080804Z.md).
The fresh Web Store package and public-listing preflight is recorded in
[`STORE_PREFLIGHT.md`](../tmp/verification/20260917-store-preflight/STORE_PREFLIGHT.md);
the public listing is reachable, but the public artifact comparison fails for
the current candidate and publisher-side maintenance remains blocked.

## Authoritative evidence bundle

- [Release run](../tmp/verification/20260918T092322Z)
- [Aggregate result](../tmp/verification/20260918T092322Z/aggregate-result.json)
- [Evidence ledger](../tmp/verification/20260918T092322Z/evidence.json)
- [Verification summary](../tmp/verification/20260918T092322Z/verification-summary.json)
- Source fingerprint: `7eb7852cd55a60db47b5f0bd2878b00cce201a150f3261d5541f5eebbeb368aa`
- Production build directory digest: `b11f44dc061a009ef8566a9b37a8b5cb8a8c6ed0a14fb1cdd33167055fd30d54` (40 files)
- Production build flags: `PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=0`

## Gate results

| Gate | Result | Fresh evidence |
| --- | --- | --- |
| Property tests | **PASS** | All registered SAFE implementation properties passed in the release run. |
| Finite TLC model | **PASS** | 13,065 states generated, 4,636 explored, depth 11; all required invariants and action coverage passed. [`model.json`](../tmp/verification/20260918T092322Z/model-run/model.json) |
| TLC to TypeScript replay, supported projection | **PASS** | 256 traces, 5,926 supported steps, 0 supported failures, and 0 unsupported steps; coverage is complete with nonempty moved and Undo witnesses. [`replay-report.json`](../tmp/verification/20260918T092322Z/model-trace-replay/replay-report.json) |
| TLC to TypeScript replay, abstraction gaps | **PASS** | The current bounded adapter projection reports no unsupported steps. The crossed-identity-pair seam remains explicitly outside the abstraction boundary and is not claimed as an unbounded theorem. |
| Evidence engine | **PASS** | Fresh source/artifact identity, stale-output, corruption, incomplete-check, and mandatory-skip regressions passed. |
| Corpus and performance | **PASS** | Synthetic 1k/10k/50k review-plan construction passed in the current release bundle. [`performance.json`](../tmp/verification/20260918T092322Z/performance.json) |
| Browser boundaries | **PASS** | Dispatch authorization 2/2 and security boundary 1/1 Playwright checks passed against mocked provider seams. |
| Production build/package | **PASS** | Fresh Manifest V3 production build and package audit passed; all 40 packaged file digests are recorded. [`package-audit.json`](../tmp/verification/20260918T092322Z/package-audit.json) |
| Mutation testing | **PASS** | 1,148 mutants; 1,134 killed (98.78%); 14 survivors independently triaged as equivalent or unreachable; 0 unresolved, no-coverage, timeout, or error results. [`mutation.json`](../tmp/verification/20260918T092322Z/mutation.json) |
| Google Photos live fixture | **PASS (scoped)** | Six synthetic photos in the disposable `pawsitivegames@gmail.com` album completed an Aside-driven scan, one-item Trash action, provider-side Trash observation, PhotoSweep Undo, and fresh six-item rescan. [`live-google.json`](../tmp/verification/20260918T092322Z/live-google.json) and [`LIVE_ROUNDTRIP_20260916.md`](../tmp/verification/20260916-live-google/LIVE_ROUNDTRIP_20260916.md) |
| iCloud Photos live fixture | **PASS (scoped)** | Six synthetic items completed one-item Trash, provider-side Recently Deleted observation, PhotoSweep Undo, empty-trash check, and fresh six-item rescan. [`live-icloud.json`](../tmp/verification/20260918T092322Z/live-icloud.json) and [`LIVE_ROUNDTRIP_20260917.md`](../tmp/verification/20260917-live-icloud/LIVE_ROUNDTRIP_20260917.md) |
| Amazon Photos live fixture | **PASS (scoped)** | Six synthetic items completed one-item Trash, provider Trash observation, PhotoSweep Undo, provider Trash-empty check, and fresh six-item rescan. [`LIVE_ROUNDTRIP_20260916.md`](../tmp/verification/20260916-live-amazon/LIVE_ROUNDTRIP_20260916.md) |
| Chrome Web Store public listing | **PASS (scoped)** | Aside loaded the public PhotoSweep listing at version 2.2.8 with 29 users and no ratings; privacy and support destinations were read-only checked. Exact ZIP identity and publisher-side edit access remain unverified. [`PUBLIC_LISTING_PREFLIGHT.md`](../tmp/verification/20260917-store-preflight/PUBLIC_LISTING_PREFLIGHT.md) |
| Chrome Web Store current-candidate publication | **FAIL / BLOCKED** | The public CRX3 payload is valid, but only 8/27 common paths match the current local build; 19 common paths differ and 13 hashed asset paths differ on each side. Publisher access is still required to upload or update the intended candidate. [`PUBLIC_LISTING_PREFLIGHT.md`](../tmp/verification/20260917-store-preflight/PUBLIC_LISTING_PREFLIGHT.md) |

## Independent checks

- `npm test -- --run`: **733/733 tests passed**, 61 files.
- `pnpm exec tsc --noEmit --project tsconfig.json`: **PASS**.
- `git diff --check`: **PASS**.
- Fresh production build inside the release run: **PASS**; build flags restored to production-safe values afterward.

## What was implemented

- A versioned registry in [`verification/requirements.json`](../verification/requirements.json) defines mandatory safety properties, proof classes, scopes, commands, and artifacts.
- [`verification/verification-runner.mjs`](../verification/verification-runner.mjs) creates isolated run directories, binds every artifact to a source fingerprint and run ID, and fails closed on stale output or source drift.
- Safety seams now enforce exact media/dedup pairing, account/provider/scope authorization, audit snapshot immutability, provider command envelopes, and browser message boundaries.
- The finite TLC model, source-bound trace export, and TypeScript replay compare the supported projection; the current bounded replay covers request identity, timeout, late/stale responses, and local cancellation with no unsupported steps.
- Stryker mutation testing now records native results plus a canonical, source-bound triage policy. The validated policy for this source fingerprint is [`mutation-triage-policy.json`](../tmp/verification/mutation-followup-20260918T085234Z/mutation-triage-policy.json).
- CI entrypoint: [`.github/workflows/verification.yml`](../.github/workflows/verification.yml).
- User-facing support destinations use the approved PhotoSweep Site or
  `pawsitivegames@gmail.com`; provider photo links and the runtime payment
  endpoint remain functional integration URLs.
- Amazon’s persisted test-batch state now exposes a one-click clear action and
  a direct full-scan purchase path when the current plan is locked.

## Proof boundary and next gates

This is rigorous bounded and source-bound verification. TLC exhausts only the
finite constants in its configuration; local tests and mocked browser checks
do not prove device runtime, store processing, or payment/license production
behavior. The provider PASS entries are limited to the named disposable
account, fixture album, and observed one-item round trips.

The repository release scope is now unblocked. Remaining external launch gates:

1. Complete separately authorized payment/license production lifecycle checks
   against the deployed service and Stripe test mode.
2. Obtain the publisher session and authorization needed to verify the exact
   candidate artifact and correct the stale support destination on the public
   Chrome Web Store listing.
