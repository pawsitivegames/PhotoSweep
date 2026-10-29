# Verification results

> Storage note (2026-10-26): Raw artifacts under `tmp/verification/` were removed from this checkout to reclaim space. Historical summaries remain, but those files are unavailable for inspection and do not verify the current candidate.

## Latest package status — 2026-10-20 (v2.3.6.20, 495da9d7ece1)

The current ZIP is [SHA-256 `495da9d7ece1`](../build/photosweep-cws-v2.3.6.20-sha256-495da9d7ece1.zip), full digest `495da9d7ece1d80ae1671728c0e68e521b928d9881e9c4566c636dd56162e61b`, build ID `3a2e99f7-7a6d-4af0-b149-4d5a91fe5d2b`, and source fingerprint `906b8c027f6065c9ed6bea40427b338172f809aa555e985e04810454c9bbf286` over 345 registered files. It was built with Node 24.20.0 from dirty source at commit `024d56ccd3ab1e7130bc4234a0552a074855cf34`; both internal and separate recorded-artifact audits passed. The local package record had preserved the sidecar and log hashes before the local verification artifacts were removed on 2026-10-26 (former path: `tmp/verification/release-package-current.sSdogZ/result.json`).

Current-fingerprint targeted regressions passed: 67/67 across five server, Firestore, export, and health test files, and 31/31 across the dev-server origin guard and verification lifecycle files. `npm run typecheck` also passed, and the fingerprint still matches the package sidecar afterward. Full unit, full headless integration, mutation testing, and exact-package browser runtime checks remain unrun on this ZIP, per the staged verification plan. The previous 9af package's 51 PASS / 3 BLOCKED release run and Amazon video pass do not transfer to 495da.

**Overall release status: NOT READY.** A fresh production `GET /health` returned 404 at 14:09Z; no deployment was performed. Production and test Cloud Run services still share the project default Compute service account and Firestore database, with unconditioned project-level roles; no Cloud Run or IAM changes were made. The current ZIP has no package-bound provider scan or video capture. Three Trash/Undo obligations remain blocked by the scans-only rule. Hosted Verification Scopes run [39393798185](https://github.com/pawsitivegames/PhotoSweep/actions/runs/39393798185) failed before tests at TLC installation; the local vendored-pin fix remains uncommitted. The full dependency audit reports four moderate development-only Parcel advisories while production dependencies are clean; the supported `npm run dev` path has a tested HTTP/WebSocket Origin guard. The public listing remains `2.3.0.2`, the Developer Dashboard draft is `2.3.6.1`, and Store, billing/signer, support, monitoring, and rollback evidence remain open. See the [current detailed gate status](REMAINING_GATES_STATUS.md), current health observation (former local path: `tmp/verification/production-health-current.hcpZo0/health-status.json`), current Cloud Run/IAM observation (former local path: `tmp/verification/cloudrun-runtime-isolation-current-20261020.json`), focused server/export log (former local path: `tmp/verification/release-package-current.sSdogZ/focused-firestore-health-tests.log`), focused origin/lifecycle record (former local path: `tmp/verification/focused-origin-lifecycle-20261020/result.json`), dependency audit record (former local path: `tmp/verification/dependency-audit-20261020/result.json`), and [candidate-bound Store draft](CHROME_WEB_STORE_LISTING_DRAFT_2026-10-20.md).

## Superseded exact-package status — 2026-10-19 (v2.3.6.15, e109c074)

**Local release verification: BLOCKED (51 PASS / 3 BLOCKED / 0 FAIL).** The fresh Node 24.20.0 run completed 17 commands and 54 evidence entries with `sourceDrift=false`. Only `LIVE-GOOGLE-01`, `LIVE-ICLOUD-01`, and `LIVE-AMAZON-01` remain blocked because their configured destructive round-trip records refer to superseded ZIPs. See the verification summary (former local path: `tmp/verification/release-final-e109c074-20261019-run2/verification-summary.json`), evidence ledger (former local path: `tmp/verification/release-final-e109c074-20261019-run2/evidence.json`), and aggregate result (former local path: `tmp/verification/release-final-e109c074-20261019-run2/aggregate-result.json`).

Candidate: PhotoSweep 2.3.6.15, ZIP [SHA-256 e109c074486a](../build/photosweep-cws-v2.3.6.15-sha256-e109c074486a.zip), full SHA-256 `e109c074486a7f573153a3197449f11c3350f360006c3ec4f1f249cb9007bf8c`, build ID `a107049b-cbfd-438c-833a-87296f752f3b`, source fingerprint `5e4a43c9d3abd4d17f1d115ab397efb392fa7e3ce3c766669d4ad6353ec398c2` across 342 registered files. The package sidecar matches the current source fingerprint, but `sourceDirty=true`, so this is not an immutable hosted-CI candidate. See the [provenance sidecar](../build/photosweep-cws-v2.3.6.15-sha256-e109c074486a.json).

The release-scope mutation gate passed with 4,171 mutants, 3,956 killed, 191 survived, 24 without coverage, and a 94.85% score. All 215 non-killed mutant keys match reviewed dispositions; there are zero critical survivors, timeouts, errors, or unresolved items, and no thresholds changed. The exact ZIP and strict package audit passed. Exact-package video evidence passed for Google, iCloud, and Amazon; Amazon evidence covers `amazon.ca`. See the mutation result (former local path: `tmp/verification/release-final-e109c074-20261019-run2/mutation.json`), [mutation-policy audit](../verification/evidence/mutation-policy-rebind-audit-20261019-current-candidate.json), package audit (former local path: `tmp/verification/release-final-e109c074-20261019-run2/package-audit.json`), and video evidence (former local path: `tmp/verification/release-final-e109c074-20261019-run2/video-playback.json`).

`npm test`, `npm run typecheck`, and the full headless integration suite remain deferred until the final full verification pass. A focused Node 24.20.0 headless integration subset passed 3/3 album Refresh regressions: timeout and retry with late-response rejection, service-worker request rejection and retry recovery, and a delayed response from a superseded Google page session. Both integration-runner builds succeeded, and the current source fingerprint was restored to an exact match with this candidate after normalizing the generated release manifests. This focused subset is not a substitute for the final full suite. Fresh dependency audits show zero production vulnerabilities for both the root app and Google Photos Toolkit, with four moderate root development-tree Parcel/Plasmo findings. A fresh production health request returned 404, and the public Store listing remains v2.3.0.2 with an in-app-purchase badge and copy that does not describe candidate 2.3.6.15. Current external observations are in the status refresh record (former local path: `tmp/verification/release-status-refresh-e109-20261019.json`). The full launch remains **NOT READY**.
## Superseded exact-package status — 2026-10-17 (v2.3.6.10)

**Local release verification: PASS. Overall release readiness: NOT READY.** The exact candidate passed the registered local release scope with no source drift. Production and publisher-side gates remain open.

Candidate: PhotoSweep v2.3.6.10, ZIP [SHA-256 700d6f254edd](../build/photosweep-cws-v2.3.6.10-sha256-700d6f254edd.zip), full SHA-256 700d6f254edd2d684a7411e95ceeeb4d38046df850404c6f6088f2d5acaff048, build ID ad1d6915-93ae-4b45-9367-be34c907ee74, source fingerprint c2aae33a2bcdc15f697aae514150e77c367fc1a27f0729af71d2a98c91ff7265 across 339 registered files. Built with Node 24.20.0 from dirty main at 024d56ccd3ab1e7130bc4234a0552a074855cf34. The exact 44-file package passed the strict ZIP/provenance audit; package tree digest is 8ec667e022313660640991230c4bd59bf47b8c484d5bea9a38926370eb063014. See the [provenance sidecar](../build/photosweep-cws-v2.3.6.10-sha256-700d6f254edd.json).

The latest frozen-candidate release run (former local path: `tmp/verification/release-v23610-frozen-700d-20261017T0654Z/verification-summary.json`) passed 17/17 commands and 54/54 evidence entries with sourceDrift=false. Its evidence ledger (former local path: `tmp/verification/release-v23610-frozen-700d-20261017T0654Z/evidence.json`) includes exact-package Google, iCloud, Amazon Canada, and video checks. The Node 24 full unit suite passed 118 files / 2,243 tests, typecheck passed, and headless integration passed 72/72 in the same source-bound verification series. The fresh mutation gate passed with 4,108 mutants, 3,897 killed, 187 survived, 24 no-coverage, and a 94.86% score. All 211 non-killed mutants were reviewed and resolved; there were zero unresolved, unreviewed, timed-out, errored, or critical mutants. The incremental mutation cache was reused. See the mutation result (former local path: `tmp/verification/release-v23610-frozen-700d-20261017T0654Z/mutation.json`) and the separate strict package audit (former local path: `tmp/verification/candidate-c671-preserved-20261017/audit-700d.log`).

Chrome Stable runtime checks were bound to this ZIP, build ID, source fingerprint, and extension ID beoghgenbddhgcdenohnnpmkogapbamf. Google Photos, iCloud Photos, and Amazon Photos Canada each passed an exact-package six-item synthetic album scan, one-item Trash/Undo cycle, fresh six-item scan, and synthetic video playback in the PhotoSweep viewer. The round-trip ledger (former local path: `tmp/verification/live-package-20261017T050240Z-v2367-final/ROUNDTRIP-LEDGER.md`) and provider records capture the runtime evidence. Amazon playback evidence applies to the Canada marketplace only.

After verification, the six named synthetic fixtures in each provider were moved to recoverable Trash/Recently Deleted, and the empty synthetic albums were removed or trashed. Google showed six newly moved items in Trash; iCloud showed the six selected items in Recently Deleted; Amazon showed all six expected fixture IDs in Trash. No permanent deletion occurred, and existing Trash contents were left untouched. See the cleanup record (former local path: `tmp/verification/release-v23610-20261017T0611Z/synthetic-fixture-cleanup.json`).

The fresh full dependency audit reports four moderate development-only Parcel findings; the production-only audit reports zero. The local dev command has a tested HTTP/WebSocket Origin guard. The patched reporter-only override clears npm audit but fails Plasmo compatibility because it requires Parcel core `^2.16.4` while the supported adapter pins core `2.9.3`; the override was reverted. See the trial record (former local path: `tmp/verification/parcel-reporter-override-trial-20261017/trial-result.md`). The latest production GET /health returned 404; the local route and regression test pass, but deployment remains required. The public [Chrome Web Store listing](https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo) remains v2.3.0.2 with Google-only album scope and an in-app-purchase badge that conflicts with Stripe checkout. The latest hosted [Verification Scopes run](https://github.com/pawsitivegames/PhotoSweep/actions/runs/38871666641) failed before tests because the committed workflow's mutable TLC download did not match the required checksum; the dirty local workflow uses the pinned installer, but it has not run in hosted CI. Production billing, signer equivalence, current Dashboard declarations, monitoring, and rollback evidence remain unverified. The live 90-day privacy wording and approved refund spacing are corrected.

**Overall release status: NOT READY.** No production deployment, Chrome Web Store edit/upload/submission, commit, or push was made. The source tree remains dirty, and the open external gates still require their respective owner actions and evidence.

## Historical verification snapshot — 2026-09-18

The prior release run was `20260918T092322Z` (executed 2026-09-18,
America/Vancouver).

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
`aggregate-result.json` (`../tmp/verification/20260918T092322Z/aggregate-result.json`),
source fingerprint
`7eb7852cd55a60db47b5f0bd2878b00cce201a150f3261d5541f5eebbeb368aa`.

## External and bounded evidence

On 2026-09-16, the dedicated Google Photos fixture was executed in Aside using
`pawsitivegames@gmail.com`. PhotoSweep moved exactly one manually confirmed
similar-copy fixture to Google Photos Trash, the exact target was checked in
the provider Trash URL, PhotoSweep Undo was invoked, and a fresh scan reported
all six fixtures restored. See
`LIVE_ROUNDTRIP_20260916.md` (`../tmp/verification/20260916-live-google/LIVE_ROUNDTRIP_20260916.md`).

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
iCloud live round-trip record (`../tmp/verification/20260917-live-icloud/LIVE_ROUNDTRIP_20260917.md`)
and the Amazon live round-trip record (`../tmp/verification/20260916-live-amazon/LIVE_ROUNDTRIP_20260916.md`).
The latest isolated payment/license lifecycle and public-listing refresh is
recorded in [`CLOUD_TEST_PREPAYMENT.md`](../tmp/verification-live-payment-20260918T074901/CLOUD_TEST_PREPAYMENT.md)
and [`store-readonly-check-20260918T080804Z.md`](../tmp/verification-live-payment-20260918T074901/store-readonly-check-20260918T080804Z.md).
The fresh Web Store package and public-listing preflight is recorded in
`STORE_PREFLIGHT.md` (`../tmp/verification/20260917-store-preflight/STORE_PREFLIGHT.md`);
the public listing is reachable, but the public artifact comparison fails for
the current candidate and publisher-side maintenance remains blocked.

## Authoritative evidence bundle

- Release run (`../tmp/verification/20260918T092322Z`)
- Aggregate result (`../tmp/verification/20260918T092322Z/aggregate-result.json`)
- Evidence ledger (`../tmp/verification/20260918T092322Z/evidence.json`)
- Verification summary (`../tmp/verification/20260918T092322Z/verification-summary.json`)
- Source fingerprint: `7eb7852cd55a60db47b5f0bd2878b00cce201a150f3261d5541f5eebbeb368aa`
- Production build directory digest: `b11f44dc061a009ef8566a9b37a8b5cb8a8c6ed0a14fb1cdd33167055fd30d54` (40 files)
- Production build flags: `PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=0`

## Gate results

| Gate | Result | Fresh evidence |
| --- | --- | --- |
| Property tests | **PASS** | All registered SAFE implementation properties passed in the release run. |
| Finite TLC model | **PASS** | 13,065 states generated, 4,636 explored, depth 11; all required invariants and action coverage passed. `model.json` (`../tmp/verification/20260918T092322Z/model-run/model.json`) |
| TLC to TypeScript replay, supported projection | **PASS** | 256 traces, 5,926 supported steps, 0 supported failures, and 0 unsupported steps; coverage is complete with nonempty moved and Undo witnesses. `replay-report.json` (`../tmp/verification/20260918T092322Z/model-trace-replay/replay-report.json`) |
| TLC to TypeScript replay, abstraction gaps | **PASS** | The current bounded adapter projection reports no unsupported steps. The crossed-identity-pair seam remains explicitly outside the abstraction boundary and is not claimed as an unbounded theorem. |
| Evidence engine | **PASS** | Fresh source/artifact identity, stale-output, corruption, incomplete-check, and mandatory-skip regressions passed. |
| Corpus and performance | **PASS** | Synthetic 1k/10k/50k review-plan construction passed in the current release bundle. `performance.json` (`../tmp/verification/20260918T092322Z/performance.json`) |
| Browser boundaries | **PASS** | Dispatch authorization 2/2 and security boundary 1/1 Playwright checks passed against mocked provider seams. |
| Production build/package | **PASS** | Fresh Manifest V3 production build and package audit passed; all 40 packaged file digests are recorded. `package-audit.json` (`../tmp/verification/20260918T092322Z/package-audit.json`) |
| Mutation testing | **PASS** | 1,148 mutants; 1,134 killed (98.78%); 14 survivors independently triaged as equivalent or unreachable; 0 unresolved, no-coverage, timeout, or error results. `mutation.json` (`../tmp/verification/20260918T092322Z/mutation.json`) |
| Google Photos live fixture | **PASS (scoped)** | Six synthetic photos in the disposable `pawsitivegames@gmail.com` album completed an Aside-driven scan, one-item Trash action, provider-side Trash observation, PhotoSweep Undo, and fresh six-item rescan. `live-google.json` (`../tmp/verification/20260918T092322Z/live-google.json`) and `LIVE_ROUNDTRIP_20260916.md` (`../tmp/verification/20260916-live-google/LIVE_ROUNDTRIP_20260916.md`) |
| iCloud Photos live fixture | **PASS (scoped)** | Six synthetic items completed one-item Trash, provider-side Recently Deleted observation, PhotoSweep Undo, empty-trash check, and fresh six-item rescan. `live-icloud.json` (`../tmp/verification/20260918T092322Z/live-icloud.json`) and `LIVE_ROUNDTRIP_20260917.md` (`../tmp/verification/20260917-live-icloud/LIVE_ROUNDTRIP_20260917.md`) |
| Amazon Photos live fixture | **PASS (scoped)** | Six synthetic items completed one-item Trash, provider Trash observation, PhotoSweep Undo, provider Trash-empty check, and fresh six-item rescan. `LIVE_ROUNDTRIP_20260916.md` (`../tmp/verification/20260916-live-amazon/LIVE_ROUNDTRIP_20260916.md`) |
| Chrome Web Store public listing | **PASS (scoped)** | Aside loaded the public PhotoSweep listing at version 2.2.8 with 29 users and no ratings; privacy and support destinations were read-only checked. Exact ZIP identity and publisher-side edit access remain unverified. `PUBLIC_LISTING_PREFLIGHT.md` (`../tmp/verification/20260917-store-preflight/PUBLIC_LISTING_PREFLIGHT.md`) |
| Chrome Web Store current-candidate publication | **FAIL / BLOCKED** | The public CRX3 payload is valid, but only 8/27 common paths match the current local build; 19 common paths differ and 13 hashed asset paths differ on each side. Publisher access is still required to upload or update the intended candidate. `PUBLIC_LISTING_PREFLIGHT.md` (`../tmp/verification/20260917-store-preflight/PUBLIC_LISTING_PREFLIGHT.md`) |

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
- Stryker mutation testing now records native results plus a canonical, source-bound triage policy. The validated policy for this source fingerprint is `mutation-triage-policy.json` (`../tmp/verification/mutation-followup-20260918T085234Z/mutation-triage-policy.json`).
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
