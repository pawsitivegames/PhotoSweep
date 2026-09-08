# Paid conversion candidate freeze

Freeze captured 2026-09-08 in `/Users/mustafadungarpurwala/Dev/GitHub/PhotoDuplicateFinder` after the scoped verifier repairs.

## Candidate identity

- Base commit: `dd28bca987f107210304a85e13a4f3844525d459` (see `base-sha.txt`).
- Branch/worktree: `main`, uncommitted working tree; pre-existing `tmp/ocr.swift` is preserved.
- Git status: `candidate-status.txt`.
- Tracked patch: `candidate-tracked.patch`.
- New-file patch: `candidate-untracked.patch`.
- SHA-256 manifest for changed/new source, tests, docs, and patch artifacts: `candidate-sha256.txt`.
- Git executable used for status/diff: `/Users/mustafadungarpurwala/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/git`.
- Build workaround: `DEVELOPER_DIR=/Library/Developer/CommandLineTools`; global Xcode selection was not changed. The task-local workaround was needed because the default Xcode-beta `xcrun` loader has an arm64/arm64e mismatch.

## Scoped repairs since the prior freeze

- Cross-context checkout invalidation retires the lifecycle's in-flight promise and rejects mismatched concurrent plans, so a later context cannot reuse or open an old checkout URL.
- Common paid-conversion invalidation clears deferred scan CTA state, Upgrade/Rating surfaces, Trash confirmation/warning, Undo state, pending TrashLifecycle operations, checkout state, and restore/trash generation maps.
- Trash and restore provider responses are bound to the request's start generation and request identity. Late responses from a retired account/provider are discarded before they can recreate Undo, recovery warnings, rating eligibility, cleanup counts, or review state.
- UpgradeDialog checkout and recovery messages remain retained in state for after-close visibility, while both persistent Snackbars are suppressed while the modal is open. The free-results exit therefore remains a normal pointer-click path during pending/retryable checkout.
- Identity-change, reset, deferred CTA, delayed Trash/Undo response, and unverifiable-checkout free-exit regressions are covered by browser tests. Current-context restore failure remains covered and still restores valid Undo.

## Changed behavior delivered for P1–P7

- P1: scan-cap conversion is deferred until completed results with useful duplicate groups; result CTA facts are scoped, dismissible, and cleared on error/cancel/new scan/reset/provider/account invalidation.
- P2: signed entitlement refresh remains authoritative; checkout starts are deduplicated, server response plan IDs and HTTPS URLs are validated, return reconciliation has a cumulative bounded retry budget and generation guards, mismatched existing plans remain pending, and review state is not mutated by payment reconciliation.
- P3/P4: paywall facts are current-session values with an explicit scope, exact existing prices/durations/limits/disclosures, Mini retained, recovery and free exit retained, and provider availability qualified. Persistent recovery Snackbars do not intercept the open dialog.
- P5: rating eligibility is tied to a confirmed complete cleanup with a positive moved count; scan-only, zero, failed, partial, dry-run, restore, and stale async outcomes do not prompt.
- P6: consent-controlled funnel fields have finite client/server allowlists; access reconciliation is distinct from server-authoritative `purchase_completed`; no client cancellation claim is emitted without an authoritative signal.
- P7: plan documentation records truthful acquisition/measurement definitions and keeps provider, Stripe, store, public, and revenue proof outside local claims.

## Fresh local evidence

- `npm test -- --reporter=dot` — PASS; 43 files, 538 tests; `full-test-free-exit-repair.log`, `full-test-free-exit-repair-exit.txt`.
- `DEVELOPER_DIR=/Library/Developer/CommandLineTools npm run typecheck` — PASS; `typecheck-free-exit-repair.log`, `typecheck-free-exit-repair-exit.txt`.
- Dev entitlement fixture build with `PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=1` — PASS; `build-free-exit-repair-dev.log`, `build-free-exit-repair-dev-exit.txt`. This build exists only to exercise mocked browser fixtures.
- Mocked Playwright app/trash integration suites — PASS; 33 tests, `integration-free-exit-repair-full.log`, `integration-free-exit-repair-full-exit.txt`.
- Permanent normal-click free-exit regression — PASS; `integration-free-exit-repair.log`, `integration-free-exit-repair-exit.txt`.
- Independent verifier exact runtime probe — PASS; 2 tests covering consent and unverifiable checkout return/free exit, `final-runtime-probes-free-exit-repair.log`, `final-runtime-probes-free-exit-repair-exit.txt`. The probe source/config and prior failure report under `tmp/paid-conversion-verification/20260908T20260908T083456Z/` are verifier-owned evidence and were not edited.
- Production-default build with no dev entitlement override — PASS; `build-free-exit-repair-production.log`, `build-free-exit-repair-production-exit.txt`; generated flags captured in `build-free-exit-repair-production-flags.txt` show `ALLOW_DEV_ENTITLEMENT = false` and no dev entitlement storage key.
- Prettier check over changed implementation/docs/tests excluding the independent verifier report — PASS; `prettier-free-exit-repair-check.log`, `prettier-free-exit-repair-check-exit.txt`.
- Fallback `git diff --check` — PASS; `diff-check-free-exit-repair.log`, `diff-check-free-exit-repair-exit.txt`.
- Earlier focused and integration logs remain in this directory for audit history; the files named above are the final post-repair gates.

## Verification mapping

- P1: `tabs/app.tsx`, `lib/paid-conversion.ts`, app-tab integration tests, and lifecycle/component tests cover deferred state, scoped result CTA, reset guards, and account retirement.
- P2: `lib/paid-access-lifecycle.ts`, `lib/license-client.ts`, `server/license-api.mjs`, lifecycle/license/server tests, and stale-checkout/unverifiable-return integration cover dedupe, secure plan echo, signed refresh, exact target matching, bounded retry, offline/pending behavior, and server webhook authority.
- P3/P4: `components/UpgradeDialog.tsx`, `tabs/app.tsx`, upgrade-dialog tests, and the normal-click integration probe cover scoped facts, existing offer contract, recovery, pending actions, free exit, and modal/snackbar stacking; human accessibility/copy review remains separate.
- P5: `lib/rating-prompt.ts`, `tabs/app.tsx`, rating tests, and trash/Undo integration cover positive complete cleanup and negative paths.
- P6: client/server analytics allowlists and tests cover consent boundary, buckets, enum rejection, unknown-field stripping, and purchase-versus-refresh distinction.
- P7: `docs/PAID_CONVERSION_PLAN.md` records hypotheses, denominators, sequential experiments, evidence limits, and external gates without claiming uplift or revenue.

## Proof boundaries and limitations

Local tests, mocked provider/license responses, typecheck, build, and source review do not establish live provider behavior, Stripe payment/refund/dispute delivery, deployed service configuration, store/public listing state, analytics consented cohort results, revenue, or conversion uplift. The public listing observation supplied in task context (21 users/no ratings) remains labeled as prior conversational observation rather than repository evidence.

The independent verifier must rebind `docs/PAID_CONVERSION_FORMAL_VERIFICATION.md` to this exact base SHA, worktree diff, and file hashes before issuing formal verdicts. That verifier-owned report was preserved unchanged during this repair. No implementation files are edited after this freeze unless the independent verifier returns a concrete defect.
