# Remaining gate status

Last verified: 2026-09-15T22:10:04Z

This ledger is for the current uncommitted PhotoSweep candidate. A local test,
package, or browser stub does not close a provider, device, payment, account,
store, or production gate.

## Implemented and locally verified

| Slice                            | Local result   | Evidence                                                                                                                                                                                                                                     |
| -------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account/provider/scope preflight | PASS           | `lib/review-preflight.ts`; blocks unknown or changed Google account, provider, stale scan, unknown/changed scope, and unvalidated connection before Trash; the confirmation path rechecks the same conditions after its async save boundary. |
| Recovery history                 | PASS           | `lib/recovery-history.ts` and `components/RecoveryHistoryDialog.tsx`; bounded 20-record local history, 180-day expiry, hashed account identity, and only provider-confirmed moved identifiers become restorable.                             |
| Cross-scan decision memory       | PASS           | `lib/decision-memory.ts`; manual decisions only, stable member-set identities, provider/account partitioning, 100-record bound, and 180-day expiry. Changed members fail closed.                                                             |
| Trash/Undo integration           | PASS           | 43/43 Chromium extension integration tests, including account drift, stale restore rejection, partial provider results, multi-batch Trash, Undo, and cancellation.                                                                           |
| Unit/component/server coverage   | PASS           | 617/617 Vitest tests. License API, Stripe webhook/idempotency, recovery, JSON/Firestore adapters, and privacy-safe analytics are included.                                                                                                   |
| Type and package checks          | PASS           | `npm run typecheck`; production package audit reports Manifest V3, version 2.2.8, and the configured license host permission.                                                                                                                |
| Production artifact hygiene      | PASS           | `build/chrome-mv3-prod.zip`, 14,683,367 bytes, SHA-256 `c1e9307be20bf1aa2b885a1c94c1081d2401ec5df0135d420f9bef7ad544ffa4`; development entitlement markers are absent.                                                                       |
| Dependency install/security      | PASS with note | npm lockfile is synchronized and `npm ci --dry-run` passes; npm production audit reports zero vulnerabilities; pnpm production audit has no high-severity findings but still reports two moderate transitive advisories.                     |

## Separately gated and not closed

### Live provider Trash/restore — BLOCKED

The current candidate has not been run against a fresh provider session. The
existing historical Google, Amazon, and iCloud entries in `VALIDATION.md` are
not current-candidate proof after these lifecycle and preflight changes.

Required evidence:

1. A named, disposable fixture account/album containing synthetic duplicates
   and a control item.
2. A fresh provider health/account/scope check immediately before scanning.
3. App-driven scan, exact-count confirmation, Trash result reconciliation,
   provider-side absence check, restore, and provider-side reappearance check.
4. A saved pre-Trash report and result report whose moved/failed identifiers
   match the provider response.

No destructive live command was run because no disposable fixture and explicit
Trash authorization were supplied. The live harness remains opt-in and refuses
to treat a missing fixture as success.

### Device testing — NOT APPLICABLE TO THIS REPOSITORY

PhotoSweep in this checkout is a Chrome Manifest V3 extension with a side panel;
there is no Android/iOS project, APK, AAB, or mobile runtime to install. The
Chromium Playwright suite is browser integration evidence, not physical-device
evidence. Android Play Console metrics must be handled in the Android product
repository/release gate, not this checkout.

### Payment/license production lifecycle — BLOCKED EXTERNALLY

The local backend and client contracts are implemented and tested. Production
proof still requires a deployed Firestore-backed service and Stripe test-mode
credentials/configuration for all three plans, signed entitlement refresh,
delayed payment, refund, dispute, recovery, and multi-instance persistence.
No Stripe secret, Firestore credential, webhook delivery, checkout, refund, or
production deployment was used in this run.

### Store submission — NOT SUBMITTED

The production ZIP is built and audited, but no Chrome Web Store upload or
publication was performed. Store submission requires the owner’s CWS account,
final listing/privacy/support artifacts, reviewer notes, and explicit
publication approval. Build success is not a store result.

## Commands used for this status

```bash
npm run typecheck
npm test -- --run
npm run test:integration
npx vitest run tests/server tests/lib/license-client.test.ts \
  tests/lib/entitlement.test.ts tests/lib/license-session.test.ts
env -u PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT pnpm run package
PHOTOSWEEP_AUDIT_STRICT_DEV_KEY_ABSENCE=1 npm run audit:extension-package
npm ci --dry-run --ignore-scripts --no-audit --no-fund
npm audit --omit=dev --audit-level=high
pnpm audit --prod --audit-level high
npm run test:e2e -- --list
```

All source and documentation changes remain uncommitted for review.

Note: the full release runner was also executed after a clean `npm ci`. Its
first integration attempt failed before test execution because the host lacked
the Playwright Chromium executable; a subsequent browser download was
incomplete and was stopped. This is an environment failure, not a failing test
assertion. The direct 43/43 run above completed before that clean-install
environment change.
