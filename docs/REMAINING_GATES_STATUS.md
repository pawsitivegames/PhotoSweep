# Remaining gate status

Last verified: 2026-09-20T08:06:37Z (fresh release formal verification, final CWS artifact, and current-candidate provider round trips; payment and store evidence remain separately scoped); current release run: `release-formal-20260919T0135Z`; current-candidate live evidence: `tmp/verification-live-current-candidate-20260920T080000Z/`

This ledger is for the current uncommitted PhotoSweep candidate. A local test,
package, or browser stub does not close a provider, device, payment, account,
store, or production gate.

## Implemented and locally verified

| Slice                            | Local result   | Evidence                                                                                                                                                                                                                                     |
| -------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account/provider/scope preflight | PASS           | `lib/review-preflight.ts`; blocks unknown or changed Google account, provider, stale scan, unknown/changed scope, and unvalidated connection before Trash; the confirmation path rechecks the same conditions after its async save boundary. |
| Regional provider routing        | PASS           | `lib/provider-sites.ts`, `lib/provider-operations.ts`, `tests/lib/provider-operations.test.ts`, and `tests/manifest.test.ts` cover 22 explicit Amazon marketplaces on bare/www `/photos` hosts, iCloud bare/www `.com` and `.com.cn` hosts, and Google Photos account/locale paths on canonical `photos.google.com`; unsupported lookalike domains fail closed. |
| Recovery history                 | PASS           | `lib/recovery-history.ts` and `components/RecoveryHistoryDialog.tsx`; bounded 20-record local history, 180-day expiry, hashed account identity, and only provider-confirmed moved identifiers become restorable.                             |
| Cross-scan decision memory       | PASS           | `lib/decision-memory.ts`; manual decisions only, stable member-set identities, provider/account partitioning, 100-record bound, and 180-day expiry. Changed members fail closed.                                                             |
| Approved user-facing destinations | PASS           | In-app site/support destinations use `https://photosweep.pawsitivegames.chatgpt.site/` or `pawsitivegames@gmail.com`; the public Site now serves verified `/privacy` and `/refunds` policy routes. Stale CWS review, `photosweep.app`, and GitHub-only support targets are absent from the app bundle. |
| Amazon full-scan purchase path   | PASS           | A persisted Amazon test batch now has explicit `Clear test batch` and `Purchase full scan` actions; the purchase action opens the existing upgrade flow without changing provider mutation behavior. |
| Trash/Undo integration           | PASS           | 48/48 Chromium extension integration tests, including account drift, stale restore rejection, partial provider results, multi-batch Trash, Undo, cancellation, deferred full-scan upgrade, and reload persistence.                |
| Request-bound timeout/recovery  | PASS           | Bounded source-bound replay: 256 traces, 5,926 passes, 0 failures, 0 unsupported steps; request IDs, timeout ambiguity, late/stale replies, drift/crash cancellation, duplicate replies, and Undo are covered. |
| Unit/component/server coverage   | PASS           | 765/765 Vitest tests across 64 files. License API, Stripe webhook/idempotency, recovery, JSON/Firestore adapters, privacy-safe analytics, and the Smart metadata-only video path are included.                                                     |
| Type and package checks          | PASS           | `npm run typecheck`; production package audit reports Manifest V3, app version 2.3.0, Chrome version 2.3.0.1, and the configured license host permission.                                                                                  |
| Production artifact hygiene      | PASS           | Fresh CWS ZIP audit: 40 files; ZIP SHA-256 and manifest SHA-256 are recorded in the matching sidecar; development entitlement markers are absent.                                                                                           |
| Dependency install/security      | PASS with note | npm lockfile is synchronized and `npm ci --dry-run` passes; npm production audit reports zero vulnerabilities; pnpm production audit has no high-severity findings but still reports two moderate transitive advisories.                     |

### Current release-scope aggregate — PASS

The current full release run completed 29 evidence entries across 13 commands
with `sourceDrift=false`; all 29 entries passed, including Google, iCloud, and
Amazon live-provider fixture evidence. Source fingerprint:
`f946eefa73f559eb36be90f0a1787ece1016ca2f95fdd4a06fd82feabab2f95f`.
Payment/license production lifecycle remains open. Public Chrome Web Store
listing existence is separately verified; exact candidate-artifact binding and
publisher-side maintenance remain open.
See the [release result](../tmp/verification/runs/release-formal-20260919T0135Z/aggregate-result.json),
[verification summary](../tmp/verification/runs/release-formal-20260919T0135Z/verification-summary.json),
[evidence ledger](../tmp/verification/runs/release-formal-20260919T0135Z/evidence.json),
and [provider fixture ledger](../verification/provider-fixtures.json).

The latest external read-only refresh is recorded in
[`CLOUD_TEST_PREPAYMENT.md`](../tmp/verification-live-payment-20260918T074901/CLOUD_TEST_PREPAYMENT.md)
and [`store-readonly-check-20260918T080804Z.md`](../tmp/verification-live-payment-20260918T074901/store-readonly-check-20260918T080804Z.md).

### Current-candidate provider round trips — PASS (scoped)

On 2026-09-20, the current loaded PhotoSweep candidate was exercised in Aside
against the user's disposable `pawsitivegames@gmail.com` test account/session:

- Amazon Photos: Amazon.ca library, 6-item scan, one provider Trash move,
  provider Trash observation, PhotoSweep Undo, provider-empty verification, and
  fresh 6-item/2-set rescan. [`AMAZON_CURRENT_CANDIDATE_ROUNDTRIP.md`](../tmp/verification-live-current-candidate-20260920T080000Z/AMAZON_CURRENT_CANDIDATE_ROUNDTRIP.md)
- Google Photos: account selector switched to `pawsitivegames@gmail.com`,
  11-item/2-set scan, one provider Trash move, provider-backed Recovery history
  Restore, provider-empty verification, and fresh 11-item/2-set rescan. The
  notification-only Undo interaction remains a separate regression boundary.
  [`GOOGLE_CURRENT_CANDIDATE_ROUNDTRIP.md`](../tmp/verification-live-current-candidate-20260920T080000Z/GOOGLE_CURRENT_CANDIDATE_ROUNDTRIP.md)
- iCloud Photos: 9-photo library, 6-item/2-set scan, one Recently Deleted move,
  provider observation, Recovery history Restore, provider-empty verification,
  return to 9 photos, and fresh bounded 6-item/2-set rescan. The iCloud page did
  not expose account identity, so this is session-scoped evidence.
  [`ICLOUD_CURRENT_CANDIDATE_ROUNDTRIP.md`](../tmp/verification-live-current-candidate-20260920T080000Z/ICLOUD_CURRENT_CANDIDATE_ROUNDTRIP.md)

These are current-candidate, account/session-scoped passes. They do not prove
permanent deletion, every provider account or region, device coverage, payment
activation, or Chrome Web Store publication.

## Separately gated and not closed

### Google Photos live Trash/restore — PASS (scoped)

Aside was used with the disposable `pawsitivegames@gmail.com` account and the
dedicated six-fixture album. The current PhotoSweep runtime completed an
album-scoped scan, manually selected exactly one confirmed similar-copy target,
moved it to Google Photos Trash, verified the exact provider Trash URL, invoked
PhotoSweep Undo, and completed a fresh six-item scan after restoration. No
permanent deletion was performed.

Evidence: [`LIVE_ROUNDTRIP_20260916.md`](../tmp/verification/20260916-live-google/LIVE_ROUNDTRIP_20260916.md),
the pre-action inventory
[`provider-inventory-before.json`](../tmp/verification/20260916-live-google/provider-inventory-before.json),
and the downloaded review/delete reports linked from the round-trip ledger.

This is a provider/account/album-specific PASS. It does not establish iCloud,
device, payment, store, or production behavior.

### iCloud live Trash/restore — PASS (scoped)

The disposable six-item synthetic fixture was exercised in iCloud through
Aside. PhotoSweep completed the review, moved exactly one Pair A target to
Recently Deleted, restored it through PhotoSweep Undo, confirmed the provider
trash was empty, and completed a fresh six-item scan. Personal-library items
remain out of scope. No permanent deletion was performed.

- iCloud: `Sep 15, 2026 · 6 Items` before the action.
- Recently Deleted: exactly `1 Item`, synthetic `TEST ONLY // PAIR A`, `29 days`
  remaining.
- After PhotoSweep Undo: `No Photos or Videos` in Recently Deleted and
  `Sep 15, 2026 · 6 Items` in the album.
- Fresh PhotoSweep result: `Done, 6 items checked`, `2 duplicate sets`.
- Evidence: [`LIVE_ROUNDTRIP_20260917.md`](../tmp/verification/20260917-live-icloud/LIVE_ROUNDTRIP_20260917.md),
  [`live-roundtrip.json`](../tmp/verification/20260917-live-icloud/live-roundtrip.json),
  and [`provider-inventory-before.json`](../tmp/verification/20260917-live-icloud/provider-inventory-before.json).

The artifact records this one disposable account, album, build, and target.
It does not generalize to other iCloud accounts or production data.

The live harness now accepts the recorded round trip; it continues to require
the same exact-count and provider-state checks for future fixtures.

A fresh read-only Aside check loaded both `www.icloud.com/photos` and
`www.icloud.com.cn/photos`; both regional routes passed navigation coverage.
After the user signed in, the current iCloud Photos application loaded with
Library and Recently Deleted visible and 9 photos reported. PhotoSweep 2.2.9
also logged successful iCloud bridge, command-handler, and MAIN-world injection
startup. This closes the current read-only account/bridge smoke check; it does
not replace the disposable-fixture scan and Trash/restore evidence. See
[`provider-route-smoke-20260918T213342Z.md`](../tmp/verification/20260918T212131Z/provider-route-smoke-20260918T213342Z.md).

The same signed-in test account then passed a fresh bounded live round trip:
the `2026-06-28` through `2026-09-15` scan checked 3 items and found the
identified `gpd-live-duplicate-copy-1.jpg` / `gpd-live-duplicate-copy-2.jpg`
duplicate set; exactly one copy moved to Recently Deleted; iCloud showed
1 item with 29 days remaining; PhotoSweep Undo restored it; Recently Deleted
returned to `No Photos or Videos`; the library returned to 9 photos; and a
fresh post-recovery scan again checked 3 items and found 1 duplicate set.
Evidence: [`current-library-roundtrip.md`](../tmp/verification-live-icloud-20260918T214953Z/current-library-roundtrip.md).
This closes the signed-in test-account/provider round trip for that bounded
range. An unbounded paid full-library scan remains license-gated and is not
claimed by this scoped PASS.

### Amazon live Trash/restore — PASS (scoped)

The disposable six-item Amazon Photos batch completed one-item Trash,
provider-side observation of the synthetic Pair A target, PhotoSweep Undo,
provider-side Trash-empty verification, and a fresh six-item scan. Evidence:
[`LIVE_ROUNDTRIP_20260916.md`](../tmp/verification/20260916-live-amazon/LIVE_ROUNDTRIP_20260916.md),
[`live-roundtrip.json`](../tmp/verification/20260916-live-amazon/live-roundtrip.json),
and [`provider-inventory-before.json`](../tmp/verification/20260916-live-amazon/provider-inventory-before.json).

The round trip used the already-running `2.2.8` instance on the supported
library route. The source now also permits Undo while `/photos/trash` is open,
with a local regression test; that new route branch was not exercised live in
this round. A fresh read-only Aside smoke check requested `amazon.in/photos`
and `amazon.com/photos`; both redirected to the signed-in test account's
`amazon.ca/photos` library, which rendered the six-item fixture. This confirms
the observed account-region routing but is not independent India or US library
evidence. No permanent delete was performed. The route record is
[`amazon-regional-route-smoke-20260918T211902Z.md`](../tmp/verification/20260918T210708Z/amazon-regional-route-smoke-20260918T211902Z.md).

### Device testing — NOT APPLICABLE TO THIS REPOSITORY

PhotoSweep in this checkout is a Chrome Manifest V3 extension with a side panel;
there is no Android/iOS project, APK, AAB, or mobile runtime to install. The
Chromium Playwright suite is browser integration evidence, not physical-device
evidence. Android Play Console metrics must be handled in the Android product
repository/release gate, not this checkout.

### Payment/license lifecycle — PARTIALLY VERIFIED; paid action remains externally gated

The isolated test deployment `photosweep-license-api-test` uses Firestore and
test-only Secret Manager bindings; the production `photosweep-license-api`
service was not changed. Read-only route checks passed, and a separate
`cleanup_pass` Checkout was expired through Stripe test mode. Stripe exposed a
real `checkout.session.expired` event, and the isolated Firestore store recorded
that event as processed without creating a license or unlocking access. The
expired session returned the `free` entitlement. Unknown and known-email
recovery requests returned the same generic response, and analytics persistence
contained only allow-listed fields.

The paid success path remains open: the fresh `mini_cleanup` Checkout is still
`open`/`unpaid`, with no card data entered. The remaining lifecycle evidence
needed is successful test-card checkout, signed entitlement activation, delayed
payment, refund, dispute, and active-license recovery. The action-time test-card
submission is awaiting direct confirmation; no production service or live
Stripe resource was exercised.

Evidence: [`CLOUD_TEST_PREPAYMENT.md`](../tmp/verification-live-payment-20260918T074901/CLOUD_TEST_PREPAYMENT.md)
The latest production-shaped read-only route recheck returned `200`, `200`,
and unauthenticated `401` for `/checkout/success`, `/checkout/cancel`, and
`/entitlement`, respectively: [`api-readonly-recheck-20260918T220342Z.md`](../tmp/verification-live-payment-20260918T074901/api-readonly-recheck-20260918T220342Z.md).

### Chrome Web Store public listing — PASS (scoped); older candidate draft saved; current candidate upload/publication — UNVERIFIED

The current locally verified candidate is distinct from the earlier saved
Chrome draft: app version `2.3.0`, Chrome Web Store version `2.3.0.1`, ZIP
[`photosweep-cws-v2.3.0.1-sha256-9e42d6ba5981.zip`](../build/photosweep-cws-v2.3.0.1-sha256-9e42d6ba5981.zip),
SHA-256 `9e42d6ba598195864806421ad741c82adee62fc416c7ace81960008406e2f861`,
and matching metadata sidecar
[`photosweep-cws-v2.3.0.1-sha256-9e42d6ba5981.json`](../build/photosweep-cws-v2.3.0.1-sha256-9e42d6ba5981.json).
The ZIP manifest, sidecar hash, package audit, formal release run, typecheck, and 765-test suite
were freshly checked. This dirty-worktree artifact has not been uploaded; the
draft evidence below refers to the older `2.2.9` candidate and must not be
interpreted as proof that `2.3.0.1` is in Chrome.

Historical draft evidence:

The public listing is reachable at
`https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo`.
The public listing still serves version `2.2.8`, with 29 users and no ratings.
The reviewed local candidate version `2.2.9` is built and audited, and it is
now uploaded into the authenticated Chrome Web Store developer draft under
`pawsitivegames@gmail.com`; the Package page reports draft `2.2.9` and
published `2.2.8`. The candidate ZIP is
`build/photosweep-cws-v2.2.9.zip` with SHA-256
`a466cef257dbb4a82f129e72e132dd7bfbb35183240690eb4a71ae0bb331cb46`.
The public listing therefore remains unchanged until the saved draft is
submitted for review and accepted. The production ZIP is also built and
audited, and all seven proposed 1280x800 screenshots are present. The fresh preflight is
recorded in
[`STORE_PREFLIGHT.md`](../tmp/verification/20260917-store-preflight/STORE_PREFLIGHT.md).
The linked privacy page loaded and contains the intended PhotoSweep disclosure.
The public PhotoSweep Site now also serves the verified refund policy at
`https://photosweep.pawsitivegames.chatgpt.site/refunds`; the live route check
is [`public-site-route-check-20260918T084500Z.md`](../tmp/verification-live-payment-20260918T074901/public-site-route-check-20260918T084500Z.md).
The authenticated Store Listing editor has both Homepage URL and Support URL
saved as `https://photosweep.pawsitivegames.chatgpt.site/`. The prior public
support URL was the legacy `pawsitivegames/Google-Photos-Deduper` issues page
with no open issues.

This is a scoped public-listing PASS, not proof of exact ZIP-to-listing byte
identity. A read-only CRX3 payload comparison found 19 SHA-256 mismatches among
27 common paths and 13 hashed asset paths present only on each side; the public
version is therefore not the current local production build. The publisher
session is available, the candidate upload is saved in the draft, and the
listing editor reports Save draft disabled. Submit for review has not been
performed; the fresh Status page explicitly reports `This draft is
unpublished`, so no new public version has been published.
See the [public listing preflight](../tmp/verification/20260917-store-preflight/PUBLIC_LISTING_PREFLIGHT.md).
The fresh pre-upload check is [`store-readonly-check-20260918T080804Z.md`](../tmp/verification-live-payment-20260918T074901/store-readonly-check-20260918T080804Z.md); the current authenticated draft state was observed directly in Aside on 2026-09-18.

A fresh read-only attempt to reopen the developer dashboard in Aside at
2026-09-18T21:31:58Z redirected to the public Web Store because that session
was signed into a different Google account. No upload, edit, submission, or
publication was attempted. See
[`cws-dashboard-readonly-20260918T213158Z.md`](../tmp/verification/20260918T212131Z/cws-dashboard-readonly-20260918T213158Z.md).

A second read-only attempt at 2026-09-18T22:04:43Z produced the same safe
result: the developer-dashboard URL redirected to the public Web Store and
the visible publisher session was not the authorized PhotoSweep publisher
account. No account login, upload, edit, submission, or publication was
attempted. See
[`cws-dashboard-readonly-20260918T220443Z.md`](../tmp/verification/20260918T215309Z/cws-dashboard-readonly-20260918T220443Z.md).

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
