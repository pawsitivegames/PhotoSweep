# PhotoSweep paid conversion and recovery plan

Status: implementation candidate plan for extension `2.2.6`
Owner: Luna Max implementation pass
Date: 2026-09-08

This plan is bounded to the existing browser extension checkout and signed-license
system. It improves when and how the product explains paid value, reconciles a
checkout return, and measures the consented funnel. It does not change prices,
Stripe price IDs, durations, entitlement limits, provider availability claims,
refund policy, analytics consent policy, public listing state, or publication.

## 1. Code-verified baseline

The baseline was re-read from the current checkout before edits.

| Area              | Current behavior                                                                                                                                                                                                             | Source of truth                                                                | Gap addressed by this plan                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Plans             | `Mini Cleanup` `$2.99`, `Cleanup Pass` `$4.99`, `Lifetime Early Access` `$14.99`; all are one-time Stripe purchases and taxes may apply                                                                                      | `lib/entitlement.ts`, `components/UpgradeDialog.tsx`, `server/license-api.mjs` | Preserve contract; make the factual comparison easier to scan                                       |
| Entitlements      | Free: 1,000 photos, 25 groups, 10 Trash moves/session; Mini: 2,500/75/100; Pass: 10,000/unlimited/unlimited plus full scan/resume; Lifetime: unlimited                                                                       | `lib/entitlement.ts`                                                           | Preserve every limit and fail-closed expiry                                                         |
| Checkout          | `PaidAccessLifecycle.createCheckout` calls `LicenseClient.createCheckout`, opens the returned URL in a new tab, then asks the user to refresh manually                                                                       | `lib/paid-access-lifecycle.ts`, `lib/license-client.ts`, `tabs/app.tsx`        | Track one pending attempt, refresh on return/focus with bounded retries, and retain manual recovery |
| Payment proof     | Extension only treats a verified signed token returned by `/entitlement` as access; the server grants only after paid Stripe webhook events                                                                                  | `lib/license-client.ts`, `server/license-api.mjs`                              | Preserve the security boundary and distinguish server purchase from client refresh                  |
| Scan-cap trigger  | When `getAllMediaItems` returns more than the current limit, the app immediately opens an upgrade modal before detection; it truncates to the entitlement limit                                                              | `tabs/app.tsx` around the `getAllMediaItems` handler; `lib/entitlement.ts`     | Defer automatic prompt until completed detection and show a nonblocking results CTA                 |
| Other gates       | Explicit full-scan, resume, export, provider, and Trash-move gates already open contextual upgrade prompts                                                                                                                   | `tabs/app.tsx`, `components/ScanConfig.tsx`, `components/ActionBar.tsx`        | Keep explicit feature gates available and truthful                                                  |
| Paywall value     | The dialog states the plan limits and reason, but receives only a free-form detail string; it does not display scoped result or selection facts as structured fields                                                         | `components/UpgradeDialog.tsx`                                                 | Add only actual result/selection/remaining-limit facts, with clear scope labels                     |
| Rating request    | `recordSuccessfulScan` increments after every completed scan and can show after the first scan                                                                                                                               | `lib/rating-prompt.ts`, `tabs/app.tsx`                                         | Move eligibility to a confirmed successful cleanup with positive actual moves                       |
| Analytics         | Consent-controlled client events are allowlisted and bucketed, including prompt shown and checkout started; server allowlist accepts the same client event set; Stripe webhooks record server purchase/refund/failure events | `lib/privacy-analytics.ts`, `server/license-api.mjs`                           | Add reason/dismissal and paid-return/activation outcomes without PII or raw counts                  |
| External evidence | Existing repository docs state that local tests/mocks do not prove live Stripe, email recovery, providers, store, public listing, or revenue                                                                                 | `docs/MONETIZATION_SYSTEM_AUDIT.md`, `docs/LICENSING_BACKEND.md`               | Carry these boundaries into the candidate ledger and rollout documentation                          |

The task context supplies a prior public listing observation of 21 users and no
ratings. That observation is not repository evidence and is not a conversion,
revenue, or product-quality result; it must not be used as a success
denominator.

## 2. Requirements and invariants

### P1: Value before the automatic ask

1. Keep enforcement at the existing item, group, scan-mode, resume, export, and
   Trash gates.
2. If a fetch is larger than the current scan limit, record a deferred prompt
   reason and continue detection for the allowed items.
3. Open no automatic modal while the scan is fetching, detecting, paused,
   cancelled, failed, or empty.
4. After a successful completed detection with at least one visible duplicate
   group, show an inline nonblocking call to action. The call to action must
   explain the actual scope and locked group count when those values exist.
5. A user may dismiss the call to action. Respect dismissal for the current
   results session and avoid stacking it with the rating dialog, checkout return,
   Trash confirmation, or another upgrade dialog.
6. Clear deferred and dismissal state on error, cancellation, new scan, reset,
   provider change, account change, and invalidated/restored results.
7. Never invent full-library counts. Labels must say `items checked`, `duplicate
sets found`, `visible on Free`, or `additional sets unavailable in this scan`
   according to the actual source data.

### P2: Automatic payment return and recovery

1. A checkout attempt has an explicit lifecycle: idle, pending, refreshing,
   active, failed, or retryable. It is not success merely because a tab opened,
   a URL contains a return marker, or a tab was closed.
2. Prevent duplicate checkout starts while one request is pending. A failed
   request can be retried; an opened checkout remains pending until bounded
   return/focus reconciliation or explicit manual refresh.
3. Reuse `PaidAccessLifecycle` and the existing signed-token verification path.
   The authoritative result is still `saveVerifiedEntitlementToken` after a
   successful `/entitlement` response.
4. On window focus/visibility return after a checkout was opened, perform a
   bounded retry schedule with cleanup of focus, visibility, timer, and promise
   listeners. Use a small fixed backoff and stop when paid access is verified or
   the attempt budget expires.
5. Keep the review groups, media map, selected groups, kept overrides, and
   reports intact while reconciling. Never auto-trash or auto-select as a side
   effect of payment.
6. Surface unpaid or otherwise unverified checkout, delayed webhook, offline
   refresh, expiry, refund, repeated focus events, browser/session changes, and
   account changes as retryable or free states with a clear manual recovery
   path. The client does not label a return as cancelled unless a future
   authoritative server signal supplies that fact.
7. A verified expired/refunded entitlement must fail closed immediately through
   existing `getEffectivePlanId`; a stale signed token must not prolong access.

### P3: Factual paywall value

1. The dialog may show only structured facts supplied by the current scan/review
   session: provider, scoped item count, actual duplicate-set count, visible-set
   count, locked-set count, selected cleanup count, and remaining Trash moves.
2. Every fact must be labeled with its scope. Do not call a scoped scan a full
   library, and do not show a value for a missing/unknown field.
3. Storage estimates are optional and must be omitted unless source metadata is
   reliable. No guaranteed storage-saving claim or invented estimate.
4. Keep a clear free exit and accessible buttons/labels. Do not block review or
   imply that paid access guarantees provider availability.

### P4: Simpler offer without changing the offer

1. Keep all existing prices, durations, entitlements, taxes/refund disclosures,
   and recovery controls.
2. Let users compare Pass and Lifetime quickly; retain Mini as a factual,
   secondary option unless a future product decision explicitly changes it.
3. Do not add fabricated popularity, urgency, discount, countdown, or automatic
   pricing experiments. Any future experiment is a separately documented,
   sequential product decision.

### P5: Review request after successful cleanup

1. Do not increment review eligibility at scan completion.
2. Record eligibility only when a provider result confirms `movedCount > 0`.
3. Failed, dry-run, zero-move, partial-with-zero, cancelled, restored-old-report,
   and colliding-dialog flows do not prompt.
4. Preserve the existing completed/deferred preferences and migrate old state
   safely without treating historical scans as cleanup.
5. Suppress the rating dialog while upgrade, checkout-return, Trash-confirm, or
   warning/recovery surfaces are active.

### P6: Privacy-safe funnel measurement

1. Keep analytics opt-in and consent-gated. Extend the existing allowlist only
   with bounded enum fields: upgrade reason, dismissal reason, paid-return
   outcome, and activation outcome.
2. Preserve bucketed counts; do not send photo content, filenames, URLs, email,
   album names, exact raw counts, or cross-site tracking identifiers.
3. Keep server-authoritative `purchase_completed`, `purchase_failed`, and
   `purchase_refunded` distinct from client `entitlement_refreshed` and
   `paid_return_*`. An existing entitlement or restore is not a new purchase.
4. Reject unknown event names/enum values server-side and test both client and
   server sanitization.
5. If true revenue attribution requires external configuration, document the
   gate rather than infer revenue from checkout starts or local mocks.

### P7: Documentation-only acquisition and measurement

Document a truthful demo outline and listing experiment using observed small
cohorts, sequential variable changes, revenue per activated user, and refunds.
Do not generate media, contact creators, change public listings, or claim
conversion uplift in this implementation pass.

## 3. Dependency-ordered implementation steps

The following order keeps the contract and pure state seams ahead of UI wiring.

### Step 1: Add pure contracts and state helpers

Files:

- `lib/paid-conversion.ts` (new): deferred prompt/CTA state, checkout-return
  state, bounded retry schedule, result value facts, and enum validators.
- `lib/entitlement.ts`: reuse existing limits only; add no new commercial
  limits. Add small formatting helpers only if they are source-backed.
- `lib/privacy-analytics.ts`: extend the typed allowlist with the bounded funnel
  fields and sanitizer.

Acceptance:

- Pure functions are deterministic for empty, scoped, locked, paid, unknown,
  dismissed, reset, and expired inputs.
- No browser, Stripe, provider, or network side effects occur in these helpers.

### Step 2: Extend lifecycle refresh safely

Files:

- `lib/paid-access-lifecycle.ts`: add a pending checkout record, in-flight
  refresh deduplication, bounded reconciliation API, and explicit outcome
  values while preserving `initialize`, `refresh`, `authorizeAction`, `recover`,
  and signed-token persistence.
- `lib/license-client.ts`: keep checkout and entitlement requests unchanged in
  authority; require the checkout response to echo the requested plan and use
  an HTTPS URL before opening it, while preserving manual refresh/recovery.

Acceptance:

- Concurrent callers share one refresh promise and one checkout start.
- Retry/backoff stops at its budget, handles offline/rejected fetches, and
  never returns paid without a verified token.
- Expiry/refund returns the existing free entitlement immediately.

### Step 3: Move automatic scan-cap ask to post-detection value

Files:

- `tabs/app.tsx`: replace the fetch-time `openTrackedUpgradePrompt("scan", ...)`
  side effect with deferred facts; consume them after successful detection.
- `lib/app-reducer.ts` only if a result-state field is needed; preserve state
  transitions and account/provider identity.

Acceptance:

- No modal appears before `SCAN_COMPLETE`.
- Results with zero groups show no automatic upgrade CTA.
- Results with groups show a dismissible nonblocking CTA using actual counts.
- Scan error, cancel, reset, provider/account change, and restored invalid
  results clear the deferred state.

### Step 4: Make the dialog factual and plan-comparable

Files:

- `components/UpgradeDialog.tsx`: accept structured value facts, show actual
  scoped counts, provide a free exit, keep prices/durations/refund/tax text,
  and improve Pass/Lifetime comparison while retaining Mini.
- `tabs/app.tsx`: pass current facts and reason/dismissal tracking.

Acceptance:

- Unknown/undefined facts are omitted, and no copy claims full library coverage
  without a full-library source marker.
- Keyboard/focus/accessible labels remain valid in component tests.

### Step 5: Reconcile checkout return/focus in the app

Files:

- `tabs/app.tsx`: track pending checkout and install one cleanup-safe focus /
  visibility reconciliation effect; preserve manual refresh and recovery UI.
- `components/UpgradeDialog.tsx`: show pending, active, retryable, and
  refresh-failed states without closing the results surface or silently
  granting access.

Acceptance:

- One click starts one checkout; repeated click/focus events do not duplicate
  requests.
- A return marker/tab close alone cannot unlock.
- A verified entitlement restores paid gates without losing selections or
  deleting/reordering review results.
- Failed/offline/delayed webhook paths expose a retry or refresh action.

### Step 6: Move rating eligibility to confirmed cleanup

Files:

- `lib/rating-prompt.ts`: add `recordSuccessfulCleanup(movedCount)` and a
  migration-safe state field while preserving completed/deferred preferences.
- `tabs/app.tsx`: remove scan-completion prompt call; call cleanup eligibility
  only from the successful provider result with positive actual moves; suppress
  while competing dialogs are active.

Acceptance:

- Scan-only, no-match, failed, dry-run, zero-move, cancelled, restored, and
  partial-zero flows do not prompt.
- A successful positive move can prompt once at the existing threshold and
  Later/Never/Review/Feedback preferences persist.

### Step 7: Add privacy-safe client/server funnel events

Files:

- `lib/privacy-analytics.ts`: add bounded fields/events and tests.
- `server/license-api.mjs`: mirror enum allowlists and preserve server-generated
  Stripe purchase/refund/failure distinctions.
- `tests/lib/privacy-analytics.test.ts`, `tests/server/license-api.test.ts`:
  add unknown-field/enum rejection and distinct purchase-vs-refresh assertions.

Acceptance:

- Consent false/unknown sends nothing from the client.
- Sanitization strips unknown fields, raw values, URLs, and PII.
- Server rejects malformed enum values and stores only bounded events.
- Existing licenses, restore, and entitlement refresh emit only access
  reconciliation outcomes; `purchase_completed` remains server-generated from
  an authoritative Stripe webhook.

### Step 8: Add regression tests and documentation

Files:

- `tests/lib/paid-conversion.test.ts` (new)
- `tests/lib/paid-access-lifecycle.test.ts`
- `tests/components/upgrade-dialog.test.tsx`
- `tests/lib/rating-prompt.test.ts`
- `tests/lib/privacy-analytics.test.ts`
- `tests/server/license-api.test.ts`
- `docs/PAID_CONVERSION_PLAN.md` (this contract), plus a durable evidence log
  under `tmp/paid-conversion-*`.

Acceptance:

- Tests cover positive and negative paths from the edge-case matrix below.
- No existing unrelated `tmp/` files are deleted or rewritten.

## 4. Edge cases and observable acceptance criteria

| ID  | Scenario                                             | Observable acceptance                                                                                                   |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| E1  | Fetch exceeds Free cap                               | Detection continues on allowed items; no modal before completed results; CTA contains only actual checked/locked values |
| E2  | No matches                                           | No automatic CTA or upgrade modal; results remain usable                                                                |
| E3  | Detection error/cancel                               | Deferred prompt and CTA state are cleared; no payment/rating dialog opens                                               |
| E4  | New scan/reset                                       | Prior CTA dismissal/facts cannot leak into the new scan                                                                 |
| E5  | Provider/account switch                              | Review, pending CTA, and checkout reconciliation reset for the new identity                                             |
| E6  | Explicit full scan/resume/export/provider/Trash gate | Existing contextual upgrade prompt still appears with truthful reason                                                   |
| E7  | Duplicate checkout click                             | One checkout request and one opened tab; UI shows pending/retryable state                                               |
| E8  | Checkout cancel/tab close                            | No entitlement change; free gates remain enforced; manual refresh/retry available                                       |
| E9  | Delayed webhook                                      | Bounded retries can end retryable; a later manual refresh can activate only after signed server token                   |
| E10 | Offline refresh                                      | Review is preserved; clear retry state; no local unlock                                                                 |
| E11 | Expiry/refund/dispute                                | Signed entitlement verifies as free at authority boundary; paid features are not retained                               |
| E12 | Repeated focus/visibility                            | Listener/timer cleanup prevents duplicate requests or state races                                                       |
| E13 | Payment while selections exist                       | Groups, selected IDs, kept overrides, and review ordering remain unchanged                                              |
| E14 | Rating after scan only                               | No rating prompt                                                                                                        |
| E15 | Rating after positive actual moves                   | Eligibility increments once and prompt respects existing preferences                                                    |
| E16 | Dry-run/failed/zero moves                            | No rating prompt or success event                                                                                       |
| E17 | Consent unknown/false                                | No client analytics request                                                                                             |
| E18 | Unknown analytics field/value                        | Client strips; server rejects invalid event/value                                                                       |
| E19 | Existing paid entitlement/restore                    | Refresh/restore event only; no `purchase_completed` client claim                                                        |
| E20 | Scoped data/value copy                               | Dialog omits unavailable estimates and labels scope explicitly                                                          |

## 5. Verification commands and evidence plan

Run fresh commands against the final candidate after all edits. Every command
must write its complete stdout/stderr and exit code to a new task-specific file
under `tmp/paid-conversion-*`; preserve existing `tmp/` contents.

1. `git status --short --branch` and `git diff --check` establish changed paths
   and whitespace evidence.
2. Focused red/green regression lane:

   `npx vitest run tests/lib/paid-conversion.test.ts tests/lib/paid-access-lifecycle.test.ts tests/components/upgrade-dialog.test.tsx tests/lib/rating-prompt.test.ts tests/lib/privacy-analytics.test.ts tests/server/license-api.test.ts`

   Where a new regression is safe, capture a pre-fix failing assertion, apply
   the fix, and capture the passing rerun. Do not weaken or delete a failing
   verifier.

3. `npm run typecheck` checks TypeScript compilation.
4. `npm test -- --reporter=verbose` checks the full repository suite; report
   unrelated pre-existing failures separately if present.
5. `npm run build` checks the extension build when dependencies/toolchain permit.
6. If available and relevant, `npm run test:integration` and `npm run test:e2e`
   cover mocked browser integration; annotate skipped/unavailable lanes.
7. Re-read this plan and build a formal evidence matrix with one row per
   requirement/invariant. Each row must include ID, claim, proof class, exact
   verifier, pass condition, fresh actual result, durable evidence path, and
   `PASS`, `FAIL`, or `BLOCKED`.
8. Freeze the candidate with exact base SHA, final SHA or working-tree diff,
   SHA-256 hashes for changed/new files, commands/log paths, requirement mapping,
   and limitations. The frozen candidate is then handed to the independent Luna
   Max verifier; implementation edits stop at that boundary.

## 6. Proof boundaries

| Evidence class       | What this candidate can prove locally                                    | What remains outside local proof                                              |
| -------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Static               | Code paths, allowlists, state cleanup, exact price/limit preservation    | Live configuration, deployed source, human clarity                            |
| Test                 | Declared unit/component/server mocks and negative cases                  | Real browser focus lifecycle, real provider pages, real Stripe                |
| Build                | Extension compiles/packages if the toolchain completes                   | Chrome Web Store review, public deployment                                    |
| Runtime/browser mock | Results CTA, dialog states, fake delayed refresh, selection preservation | Real signed payment/session cookies and payment provider timing               |
| Provider             | None unless a separate authorized real provider run is performed         | Google/iCloud/Amazon account/library availability and Trash behavior          |
| Payment/provider     | Server code verifies webhook semantics in tests                          | Live Stripe catalog, webhook delivery, tax, refunds, disputes, email recovery |
| Store/public         | Documentation only; no publication                                       | Listing visibility, installs, ratings, public click-through, revenue          |
| Human                | Copy can be reviewed by the independent verifier                         | User satisfaction and conversion uplift                                       |

Overall formal status is `BLOCKED` until every mandatory property has fresh
evidence. Local mocks cannot establish live payment, provider, store, public,
or revenue outcomes.

## 7. Rollout and revenue measurement

Keep the first experiment sequential and fixed-price. The treatment is the
post-value, nonblocking results CTA plus factual scope copy. Do not change the
catalog, entitlements, price, or discount mechanics while measuring it.

The funnel is defined as:

`first scan started → useful matches (completed scan with ≥1 group) → free successful cleanup (server/provider confirms movedCount > 0) → upgrade prompt shown → checkout started → server purchase_completed → verified entitlement refresh → paid successful cleanup`

Use only consented, bucketed event denominators. Report `unknown` when a stage
is not observable; never turn missing provider/server events into zero. Measure
prompt-to-checkout, checkout-to-server-purchase, purchase-to-verified-activation,
activation-to-paid-cleanup, refunds/disputes, recovery completion, support
contacts, and revenue per activated user only after the external server/payment
configuration supplies authoritative records.

Roll out to a small observed cohort only after the local candidate passes and a
human reviews copy/accessibility. Keep the existing free path as the rollback
state. A rollback can disable the new CTA/return reconciliation in a follow-up
build; it must not issue unsigned entitlements or alter provider data. Public
listing experiments, live payments, outreach, and revenue claims require their
own authorization and evidence.

## 8. Formal verification row template

Use this table in the final evidence log and fill every mandatory row before
handing the candidate to the independent verifier.

| ID    | Claim                                                                          | Proof class                | Exact verifier                               | Pass condition                                                            | Actual result            | Evidence                                              | Verdict |
| ----- | ------------------------------------------------------------------------------ | -------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------- | ------- |
| P1.1  | Scan-cap automatic ask is deferred until completed useful results              | test/static/runtime        | Focused tests plus source inspection         | No pre-detection modal; CTA only after completed results with groups      | pending                  | `tmp/paid-conversion-*`                               | BLOCKED |
| P1.2  | Deferred state clears across error/cancel/reset/provider/account changes       | test/static                | Focused state/app tests                      | No stale CTA/facts after each reset path                                  | pending                  | `tmp/paid-conversion-*`                               | BLOCKED |
| P2.1  | Checkout starts are deduplicated and return proof is signed entitlement only   | test/static                | Lifecycle tests and license-client tests     | One request; tab/URL alone never activates                                | pending                  | `tmp/paid-conversion-*`                               | BLOCKED |
| P2.2  | Focus/visibility retry is bounded and listeners are cleaned up                 | test/static                | Lifecycle/app tests                          | Retry budget stops and cleanup is observed                                | pending                  | `tmp/paid-conversion-*`                               | BLOCKED |
| P2.3  | Review state survives refresh/reconciliation                                   | test/runtime               | Component/app integration test               | Groups/selections/kept overrides remain equal                             | pending                  | `tmp/paid-conversion-*`                               | BLOCKED |
| P3.1  | Paywall value copy uses actual scoped facts only                               | test/static/human          | Component tests plus independent copy review | Unknown facts omitted; scope labels are clear                             | pending                  | `tmp/paid-conversion-*`                               | BLOCKED |
| P4.1  | Existing prices, durations, limits, disclosures, and recovery remain unchanged | static/test                | Diff and entitlement/paywall tests           | Exact baseline contract preserved                                         | pending                  | `tmp/paid-conversion-*`                               | BLOCKED |
| P5.1  | Rating eligibility requires positive actual cleanup                            | test/static                | Rating/app tests                             | Scan-only/zero/failed/dry-run never prompts; positive moves can prompt    | pending                  | `tmp/paid-conversion-*`                               | BLOCKED |
| P6.1  | Client/server analytics are consented, allowlisted, bucketed                   | test/static                | Client/server analytics tests                | Unknown fields/values are stripped/rejected; no PII/raw counts            | pending                  | `tmp/paid-conversion-*`                               | BLOCKED |
| P6.2  | Purchase success is server-authoritative and distinct from refresh/restore     | test/static                | Webhook and lifecycle tests                  | Only paid webhook yields purchase event; refresh/restore remains separate | pending                  | `tmp/paid-conversion-*`                               | BLOCKED |
| EXT.1 | Live Stripe/provider/store/public/revenue outcomes                             | provider/public/production | Authoritative external records               | Fresh external evidence exists                                            | unavailable in this pass | `docs/MONETIZATION_SYSTEM_AUDIT.md` plus verifier log | BLOCKED |
