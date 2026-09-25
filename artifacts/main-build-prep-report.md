# PhotoSweep main build-prep report

Date: 2026-09-25  
Base `main` verified before branching: `bbc378f815c47895ad9e69a1680854f96567864f`  
PR: [#19 — Prepare main for next CWS reupload](https://github.com/pawsitivegames/PhotoSweep/pull/19)

## A. Inventory and proof status

| Item | OBSERVED | VERIFIED | BLOCKED |
| --- | --- | --- | --- |
| `first_connect` | `provider_connected` is emitted from the consent-gated client tracker. | Stable install identity, server sanitization, and first-connect aggregation are covered by source inspection and focused tests. | No consented production rows can count until the API is redeployed from the merged tip. |
| `first_scan_started` | `scan_started` is emitted after scan gating. | Funnel ordering and install-level aggregation are covered by `tests/server/funnel-evidence.test.ts`. | Production evidence window is not populated. |
| `first_scan_completed` | `scan_completed` is emitted after scan completion. | Funnel ordering and distinct-install aggregation are verified by the focused suite and CI. | Production evidence window is not populated. |
| `first_trash_or_undo` | `trash_completed` and successful `undo_completed` are wired. | Value-event type counts and ordering are verified by the funnel tests. | Production evidence and Store Growth import are not complete. |
| `median_time_to_value` | The exporter derives matched connect-to-value durations. | Non-negative interval and median behavior are covered by funnel tests. | No live observation rows have been exported. |
| `d7_retention` | The exporter uses the same install identity and UTC day keys for the cohort/return window. | Fixed-window retention derivation is covered by funnel tests. | A real cohort and later return window are unavailable. |
| `error_rate` | Scan, Trash, and license-refresh errors use the allowlisted `error` contract. | Sanitization, denominator handling, and null-on-empty behavior are tested. | No live denominator or production export exists. |
| `old_version_share` | Version observations carry the manifest version. | Numeric version comparison and export shape are tested. | No post-reupload population exists. |
| Client identity contract | `tabs/app.tsx` obtains one `chrome.storage.local` UUID v4 and attaches `installId`, manifest `extensionVersion`, and UTC `dayKey` after consent for the requested funnel events. | `privacy-analytics`, `install-identity`, API, funnel, manifest, and CWS-artifact tests pass; full CI passes. | This PR does not create consented production rows. |
| API sanitizer | `server/license-api.mjs` requires `installId`, `extensionVersion`, and `dayKey`, and rejects unknown/invalid fields. | Focused license API tests pass. | Live API is still pre-Phase-A and is not redeployed by this PR. |
| Analytics export | `analytics:export` points to `tools/export-funnel-evidence.mjs`; `--help` works without credentials. | Exporter help and funnel tests pass; no Firestore read was attempted locally. | Authorized production credentials, rows, re-export, and Store Growth import remain. |
| Release identity | App `version` remains `2.3.0`; PR changes `chromeVersion` to `2.3.0.3`, above the public `2.3.0.2` context. | Typecheck, manifest, CWS-artifact tests, and CI pass. | Fresh `.3` package/audit and owner-approved CWS upload/publication remain. |

## B. PR and CI

- PR: [https://github.com/pawsitivegames/PhotoSweep/pull/19](https://github.com/pawsitivegames/PhotoSweep/pull/19)
- CI status: **SUCCESS**
- Successful checks: CI Unit & integration tests; CI Performance benchmarks;
  Verification Scopes Fast verification; CodeRabbit.
- Skipped: Verification Scopes Nightly verification.
- Local validation: `npm run typecheck`; focused Phase A/API/package suite
  (7 files, 63 tests); `npm run analytics:export -- --help`; and full
  `npm test` with the CI-pinned TLC 1.8.0 JAR (68 files, 794 tests).
- No Cloud Run deployment, CWS upload/publication, or merge was performed.

## C. Ready-for-owner-reupload checklist

- [x] PR source keeps app version `2.3.0`.
- [x] PR source sets Chrome version `2.3.0.3`.
- [x] Phase A client identity fields are wired through the consent-gated
      tracker.
- [ ] Merge PR #19, then record the exact resulting `main` SHA as the API tip
      SHA to redeploy.
- [ ] Obtain owner approval and redeploy the API from that exact merged SHA.
- [ ] Build and audit a fresh CWS package from merged `main`; do not reuse the
      historical `2.3.0.1` artifact.
- [ ] Collect consented Phase A rows in the agreed observation window.
- [ ] Re-export the privacy-safe funnel artifact with the published Chrome
      version and reconcile it.
- [ ] Import the reviewed artifact into Store Growth.
- [ ] Obtain owner approval for CWS upload/publication after the remaining
      product features land.
- [ ] Do not claim a standing-board PASS until the observed pass conditions and
      evidence import are complete.

## D. Proof labels summary

- **OBSERVED:** base `main` at `bbc378f...`; pre-change package metadata at
  `2.3.0` / `2.3.0.1`; Phase A client/API/export code and requested event
  call sites on the branch; public `2.3.0.2` version as provided in the task
  context.
- **VERIFIED:** `chromeVersion` bump, source wiring, API contract, aggregation
  behavior, exporter entrypoint, typecheck, focused tests, full local suite
  with pinned TLC, and all terminal PR CI checks.
- **BLOCKED:** live API redeploy, consented production event collection,
  privacy-safe re-export, Store Growth import, fresh owner-approved CWS
  upload/publication, and any standing-board PASS claim.

