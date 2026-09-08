# Paid Conversion Formal Verification Matrix

Status: **FINAL VERIFICATION REPORT — scoped BLOCKED**

This document is the independent verifier's contract for the paid-conversion
work described by `docs/PAID_CONVERSION_PLAN.md`. It is intentionally separate
from the implementation plan. The writer may add or change product code and
tests, but this file records what must be proven and what evidence is required
before any completion claim.

The current baseline observed while preparing this matrix is commit
`dd28bca987f107210304a85e13a4f3844525d459` on `main`. At matrix preparation,
the only worktree item was a pre-existing untracked `tmp/` directory. That is a
baseline observation, not candidate evidence. Final verification must rebind
every result to the frozen candidate SHA and changed-file hashes.

## Evidence contract

Every row in the final ledger must contain the following fields:

| Field          | Requirement                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| ID             | Stable property ID from this document or an explicitly added child ID                                                                   |
| Claim          | One bounded behavior or invariant                                                                                                       |
| Proof class    | `static`, `test`, `build`, `runtime`, `visual`, `independent review`, `device`, `provider`, `store`, `public`, `human`, or `production` |
| Verifier       | Exact command, fixture, browser state, or authoritative external source                                                                 |
| Pass condition | Observable condition required for `PASS`                                                                                                |
| Actual result  | Complete fresh output or observation, including failures                                                                                |
| Evidence       | Durable log/report path, artifact hash, or authoritative URL                                                                            |
| Verdict        | Exactly `PASS`, `FAIL`, or `BLOCKED`                                                                                                    |

`PASS` means the verifier ran against the exact frozen candidate and its output
meets the pass condition. `FAIL` means the output contradicts the claim.
`BLOCKED` means the required proof is unavailable, ambiguous, or outside the
local test boundary. A focused test cannot promote an unverified provider,
store, public, revenue, or production claim.

Formal verification here is an auditable evidence contract. It is not a claim
of theorem proving and it does not turn mocked payment behavior into live
Stripe evidence.

## Candidate binding procedure

Run this only after the implementation writer declares the candidate frozen and
stops editing. Store all output under a new UTC directory such as
`tmp/paid-conversion-verification/20260908T000000Z/`; do not reuse the old
release-gate directory.

```bash
VERIFY_DIR="tmp/paid-conversion-verification/<UTC>"
mkdir -p "$VERIFY_DIR"
git status --short
git rev-parse HEAD
git diff --name-status
git ls-files --others --exclude-standard
git diff --check
git diff > "$VERIFY_DIR/candidate.diff"
git diff --stat > "$VERIFY_DIR/diff-stat.txt"
```

The verifier must record:

1. Base SHA before the writer's changes, candidate `HEAD` if it changed, and
   the exact candidate status output.
2. Every tracked and untracked changed file in the candidate scope. Existing
   `tmp/` evidence is not silently treated as implementation.
3. SHA-256 hashes for every candidate file and the diff artifact, for example:

   ```bash
   shasum -a 256 docs/PAID_CONVERSION_PLAN.md \
     docs/PAID_CONVERSION_FORMAL_VERIFICATION.md <each changed source/test file> \
     > "$VERIFY_DIR/file-sha256.txt"
   shasum -a 256 "$VERIFY_DIR/candidate.diff" >> "$VERIFY_DIR/file-sha256.txt"
   ```

4. A copy of the final plan and this matrix in the evidence directory, or
   their hashes plus immutable candidate paths. The evidence copy is for audit
   readability; the working files remain the source of truth.

No final result may be attributed to `dd28bca` or to a moving worktree after
the writer resumes editing. If the candidate changes after any verifier runs,
discard that result for the affected claim and repeat it against the new hash.

## Baseline implementation anchors

These are the surfaces the independent verifier must inspect again after the
freeze; they are not proof that the requested changes are present:

| Surface                                                        | Baseline responsibility                                                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/entitlement.ts`                                           | Plan IDs, prices, scan/group/Trash/report/resume limits, expiry, and effective-plan fail-closed behavior                                               |
| `lib/license-client.ts`                                        | Signed entitlement token verification and storage; checkout, recovery, and refresh HTTP boundary                                                       |
| `lib/paid-access-lifecycle.ts`                                 | Startup refresh, time-limited action refresh, checkout, and recovery state                                                                             |
| `server/license-api.mjs`                                       | Stripe checkout, signed webhook handling, purchase ledger, event deduplication, entitlement token issuance, analytics allowlist                        |
| `server/firestore-license-store.mjs`                           | Persistent license/event indexes used by deployed storage                                                                                              |
| `tabs/app.tsx`                                                 | Scan gates, result state, upgrade prompt state, checkout/recovery/refresh, selection persistence, Trash lifecycle, rating request, and telemetry calls |
| `components/UpgradeDialog.tsx`                                 | Plan comparison, contextual copy, recovery controls, and free-result dismissal                                                                         |
| `components/RatingPromptDialog.tsx` and `lib/rating-prompt.ts` | Honest review/feedback choices and prompt preference state                                                                                             |
| `lib/privacy-analytics.ts`                                     | Consent boundary, event names, count buckets, and client payload allowlist                                                                             |
| `tests/e2e/integration/app-tab.test.ts`                        | Extension-page result, account, scan, selection, resume, and rating journeys                                                                           |
| `tests/e2e/integration/trash-undo.test.ts`                     | Mock-provider Trash success/failure/zero/undo behavior                                                                                                 |
| `tests/server/license-api.test.ts`                             | Signed Stripe lifecycle and server-side payment-event authority                                                                                        |

The existing commercial contract must remain truthful unless the plan
explicitly changes it and the plan, entitlement model, dialog copy, server
prices, and tests are updated together:

| Plan                  |      Price | Entitlement contract to verify                                                                       |
| --------------------- | ---------: | ---------------------------------------------------------------------------------------------------- |
| Free                  |         $0 | 1,000 photos/scan, 25 visible groups, 10 Trash moves/session, limited report                         |
| Mini Cleanup          |  $2.99 USD | Permanent limited unlock: 2,500 photos/scan, 75 visible groups, 100 Trash moves/session, full report |
| Cleanup Pass          |  $4.99 USD | Seven days: 10,000 photos/scan, unlimited groups/Trash, full report, full scan, large-library resume |
| Lifetime Early Access | $14.99 USD | One-time unlimited cleanup limits for the supported product lifetime                                 |

## Property matrix

### P1 — Value before a scan-limit ask and stable free safety

| ID   | Claim                                                                                                                                     | Proof class             | Verifier                                                                                                                                                        | Pass condition                                                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1.1 | A scan-limit condition cannot open an upgrade modal while a scan is still fetching, detecting, or otherwise before a usable result state. | static + test + runtime | Inspect scan-result and `UpgradeDialog` state transitions; run focused component/unit tests and the integration scan fixture with more than the Free photo cap. | The modal is absent throughout in-progress/error/cancel states and appears, if applicable, only after a completed result state exposes an honest locked remainder.                                              |
| P1.2 | Free and paid scan/group/Trash/report/resume caps remain enforced exactly by the entitlement model.                                       | test                    | `npm exec vitest run tests/lib/entitlement.test.ts` plus any new cap regression tests.                                                                          | Boundary vectors pass: 1,000 vs 1,001 Free photos; 25 vs 26 groups; 10 vs 11 Free Trash moves; Mini 2,500/75/100; Cleanup Pass 7-day/full-scan/resume; Lifetime unlimited. Dismissal never changes entitlement. |
| P1.3 | Zero duplicate results are a useful free outcome and do not trigger an upgrade prompt.                                                    | test + runtime          | Integration zero-result fixture and `npx playwright test --config playwright.config.ts tests/e2e/integration/app-tab.test.ts -g "zero                           | no duplicates"`.                                                                                                                                                                                                | The no-duplicates result is visible, no upgrade dialog is present, and no upgrade-impression event is emitted solely because the result is empty. |
| P1.4 | Provider errors do not trigger a conversion modal or falsely imply a paid fix.                                                            | test + runtime          | Stub provider error through the app integration fixture; inspect rendered error and event calls.                                                                | Error state is shown; no upgrade dialog, checkout, entitlement mutation, or `upgrade_prompt_shown` occurs unless the user separately invokes a real locked feature.                                             |
| P1.5 | User cancellation leaves the free flow dismissible and does not trigger a conversion modal.                                               | test + runtime          | Exercise scan cancellation/pause in the integration fixture or the narrowest available component harness.                                                       | Cancellation returns to a usable retry/resume state without an automatic paywall, Trash command, entitlement grant, or lost saved selections.                                                                   |
| P1.6 | Provider/account reset clears stale paid-conversion UI state.                                                                             | test + runtime          | Account-change/reset integration cases, including a pending checkout and an open prompt.                                                                        | A changed provider/account or explicit reset closes the prompt and pending checkout state, re-evaluates entitlement safely, and cannot reuse stale counts or stale account data.                                |
| P1.7 | Dismissal is a real free exit and repeated triggers do not stack dialogs.                                                                 | test + runtime          | Render the paywall, click `Keep reviewing free results`/close/Escape, trigger the same boundary again, and inspect dialog count.                                | Exactly one modal exists at a time; dismissal returns to the same results and selections; a second prompt requires a new eligible user action and does not duplicate backdrops or event listeners.              |

Required negative controls for P1 are: scan over the cap before results, zero groups,
provider failure, user cancel, account change, prompt dismissal, and a repeated
locked action. A test that only checks that an upgrade button exists does not
prove this property.

### P2 — Checkout return, authoritative entitlements, and lifecycle recovery

| ID    | Claim                                                                                                                          | Proof class             | Verifier                                                                                                                                                            | Pass condition                                                                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2.1  | Returning from hosted checkout causes a bounded entitlement refresh, with no polling loop or refresh storm.                    | static + test + runtime | Inspect checkout-return/visibility/tab-listener code; run a fake tab return with a pending checkout and count refresh calls.                                        | One bounded refresh is attempted for one pending checkout return; no unbounded timer, duplicate listener, or refresh on unrelated tab updates remains; cleanup removes every listener on unmount/reset.                             |
| P2.2  | Only a valid server-signed entitlement can unlock paid behavior.                                                               | static + test           | `npm exec vitest run tests/lib/license-client.test.ts tests/lib/paid-access-lifecycle.test.ts tests/server/license-api.test.ts`; inspect all unlock paths.          | Forged, edited, malformed, expired, locally injected, or unsigned tokens resolve to Free; only a token verified against the bundled public key changes the effective plan. No success callback or local flag bypasses verification. |
| P2.3  | Checkout cancellation, failure, unpaid completion, and a duplicate purchase click do not unlock or create duplicate purchases. | test                    | Server webhook matrix plus component/app double-click test with mocked checkout.                                                                                    | No entitlement before authoritative paid event; one checkout request per deliberate click/guarded attempt; duplicate Stripe event or same checkout session is idempotent; UI stays Free after cancel/failure.                       |
| P2.4  | The local implementation preserves delayed-payment, refund/dispute/expiry/offline/replay semantics.                            | static + test           | `npm exec vitest run tests/server/license-api.test.ts tests/lib/license-client.test.ts`; inspect the local lifecycle and server replay matrix.                      | Unpaid completion stays locked; paid async success unlocks; refund/dispute/expired refresh downgrades; offline cache fails closed at signed expiry; repeated IDs are idempotent.                                                    |
| P2.4b | The deployed provider/store executes the same delayed-payment, refund/dispute/expiry/offline/replay lifecycle.                 | provider + store        | Authorized deployed Stripe/provider test-mode matrix.                                                                                                               | The full external lifecycle passes against deployed systems.                                                                                                                                                                        |
| P2.5  | Refresh/recovery preserves review selections and never starts Trash automatically.                                             | test + runtime          | Integration fixture with saved `selectedGroupIds`/`keptOverrides`, pending checkout return, refresh, and account recovery; inspect service-worker command messages. | Selection state is byte-for-byte equivalent before/after refresh/recovery; no `trashItems`, `TRASH_STARTED`, provider mutation, or auto-confirm occurs; the user must explicitly initiate review and confirmation.                  |
| P2.6  | Recovery remains generic and preserves Mini/Lifetime entitlements without exposing account existence.                          | test                    | Existing and new recovery tests in `tests/components/upgrade-dialog.test.tsx`, `tests/lib/paid-access-lifecycle.test.ts`, and `tests/server/license-api.test.ts`.   | Valid and unknown emails receive the same acknowledgement; only the signed recovery path can rebind/refresh; Mini remains permanent limited access and Lifetime remains intact after recovery.                                      |

The provider/store boundary remains separate: mocked webhook and token tests
can make P2.2–P2.4 `PASS` at local code level, but cannot make a live Stripe
purchase, email delivery, fresh-profile recovery, or deployed store `PASS`.
P2.4b is the external child property for that unavailable proof.

### P3 — Truthful result-specific paywall and accessible free exit

| ID   | Claim                                                                                                                       | Proof class             | Verifier                                                                                                 | Pass condition                                                                                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3.1 | The paywall describes the actual locked result and the user's actual scope.                                                 | test + runtime + visual | V2/V5 rendered result assertions and V11 narrow/wide browser inspection of scope/count copy.             | Counts come from the completed result and current scope; the dialog identifies the unlocked remainder or feature without inventing totals. Zero or unknown counts are not formatted as fake numbers. |
| P3.2 | Copy does not claim storage saved, full-library coverage, provider success, or other outcomes the result did not establish. | static + test + visual  | V10 claim search plus V11 rendered copy assertions and screenshot inspection.                            | Any claim is tied to observed scope/results and documented capability; unsupported storage/full-library/provider claims are absent or explicitly qualified.                                          |
| P3.3 | The free exit is visible, keyboard accessible, and does not trap the user.                                                  | test + runtime + visual | V11 keyboard Tab/Escape/focus-return and real-wheel scroll probe at 360x800 and 1024x900.                | A named close/continue-free action is present and operable by keyboard, Escape/backdrop dismissal works as designed, focus returns to the triggering control, and results remain available.          |
| P3.4 | Dismissing the result paywall retains the reviewed result set and selection choices.                                        | test + runtime          | Integration result fixture with selected groups and kept overrides; dismiss and assert DOM plus storage. | No result, scope, selection, or review preference is cleared by viewing or dismissing the paywall.                                                                                                   |

### P4 — Simple, complete comparison with recovery intact

| ID   | Claim                                                                                                                              | Proof class             | Verifier                                                                                                                                 | Pass condition                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------- | ---------- | ------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| P4.1 | All existing plans display their exact price, duration, and core entitlements.                                                     | test + runtime + visual | V2 plan/component assertions plus V11 rendered comparison at narrow and wide viewports.                                                  | Mini `$2.99 USD` permanent limited; Cleanup Pass `$4.99 USD` seven days; Lifetime `$14.99 USD` one-time unlimited. The displayed promises match `PLAN_LIMITS` and backend price aliases. |
| P4.2 | Mini Cleanup remains a recoverable permanent limited purchase, and recovery controls remain available.                             | test                    | `npm exec vitest run tests/components/upgrade-dialog.test.tsx tests/lib/paid-access-lifecycle.test.ts tests/server/license-api.test.ts`. | Mini is selectable, its permanent limits are stated, recovery accepts a purchase email, acknowledgement is generic, and refresh can restore a verified Mini token.                       |
| P4.3 | The comparison is simple enough to scan while keeping one clear CTA per plan and a visible free exit.                              | test + runtime + visual | V11 narrow/wide screenshots, real-wheel reachability, Tab reachability, and one-CTA/free-exit assertions.                                | No plan price, duration, entitlement, recovery, or free-exit control is hidden behind hover, clipping, or ambiguous nested actions; each plan has one clearly named CTA.                 |
| P4.4 | Paid copy does not imply subscriptions, recurring billing, guaranteed results, or unlimited provider coverage beyond the contract. | static + test           | `rg -n -i "subscription                                                                                                                  | monthly                                                                                                                                                                                  | annual | recurring | guaranteed | all providers | unlimited.\*provider" components docs/PAID_CONVERSION_PLAN.md docs/MONETIZATION_SYSTEM_AUDIT.md`; rendered text assertions. | The words are absent or explicitly used only to explain that the product is not offering that behavior; plan promises remain bounded. |

### P5 — Honest rating request after confirmed positive cleanup

| ID   | Claim                                                                                            | Proof class             | Verifier                                                                                                                                                             | Pass condition                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P5.1 | A rating request appears only after a confirmed successful cleanup with at least one item moved. | test + runtime          | Exercise scan completion, zero groups, zero-move review, successful Trash result with `trashedCount > 0`, failed/partial Trash, undo/restore, and report-only paths. | Only the successful positive cleanup path can open the rating prompt; scan completion, no duplicates, failed/zero moves, restore, and report-only actions do not.            |
| P5.2 | Failed cleanup and zero-move outcomes never count as successful rating opportunities.            | test                    | `npm exec vitest run tests/lib/rating-prompt.test.ts tests/e2e/integration/trash-undo.test.ts`; add result-specific prompt tests if the prompt logic moves.          | A failed provider response, zero selected items, zero moved items, or partial failure that does not meet the explicit success condition leaves rating eligibility unchanged. |
| P5.3 | Prompt preferences are preserved and remain user-controlled.                                     | test                    | Existing rating storage tests plus reload/defer/never/review journeys.                                                                                               | `Maybe later` schedules the documented retry; review and `Don't ask again` persist dismissal; unrelated scan/result/entitlement state is unchanged.                          |
| P5.4 | Rating copy requests an honest review and offers feedback without sentiment filtering.           | test + runtime + visual | V2 dialog assertions plus V11 positive-cleanup copy and narrow/wide screenshot inspection.                                                                           | Review and feedback are both offered; no five-star/love/satisfaction gate, hidden negative exit, or filtering branch exists.                                                 |

### P6 — Consent-respecting, privacy-safe, authoritative funnel measurement

| ID   | Claim                                                                                                       | Proof class    | Verifier                                                                                                                                                                             | Pass condition                                                                                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P6.1 | Client funnel analytics are silent until explicit consent and remain silent after opt-out.                  | test + runtime | `npm exec vitest run tests/lib/privacy-analytics.test.ts`; integration first-run consent/no-thanks/allow/reload path with intercepted requests.                                      | No analytics request is sent before Allow; No thanks/opt-out persists; Allow sends only the documented allowlisted events. Analytics failures never interrupt scan, review, Trash, or checkout.                           |
| P6.2 | Client payloads are allowlisted, bucketed, and free of new PII or photo identifiers.                        | static + test  | Unit/server sanitization tests; serialize events containing hostile extra fields such as email, URL, filename, media key, exact count, or token.                                     | Only event name, provider, scan mode, plan ID, approved reason/dismissal fields, count buckets, and approved error category survive; no email, photo URL, filename, media key, account ID, token, or exact count is sent. |
| P6.3 | Upgrade reason and dismissal are measurable without conflating distinct funnel stages.                      | test + static  | Event-schema tests and intercepted client event calls for scan/group/Trash/export/resume/provider reasons plus dismissal.                                                            | Every paywall impression carries the actual bounded reason; dismissal has its own explicit event or field; reasons are not inferred from a generic event after the fact.                                                  |
| P6.4 | Purchase completion is authoritative, deduplicated, and distinct from refresh and restore events.           | test           | `npm exec vitest run tests/server/license-api.test.ts tests/lib/paid-access-lifecycle.test.ts`; inspect server rejection of client-forged payment events and duplicate event replay. | Only verified server Stripe lifecycle produces `purchase_completed`; replay produces no second grant/event; `entitlement_refreshed`, `restore_requested`, `restore_completed`, and `restore_not_found` remain distinct.   |
| P6.5 | React rerenders, checkout return listeners, and refresh/recovery retries do not duplicate funnel events.    | test + runtime | Mock event sink; rerender/return/retry each scenario and count events by stable key.                                                                                                 | One user-visible action yields at most one corresponding event; provider retries and webhook replay are deduplicated by authoritative event ID; refresh does not masquerade as purchase.                                  |
| P6.6 | Recovery email is used only by the recovery boundary and is never copied into analytics or paywall metrics. | static + test  | Search event builders and test with a real-looking email; inspect serialized requests and server snapshot.                                                                           | Email may appear only in the recovery request path; analytics payloads, logs, and event snapshots contain no email or account identifier.                                                                                 |

### P7 — Truthful acquisition and measurement plan

| ID   | Claim                                                                                                                                                                                   | Proof class                 | Verifier                                                                                           | Pass condition                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P7.1 | The acquisition plan states hypotheses, audience, funnel definitions, experiment boundaries, and required evidence without inventing performance.                                       | static + independent review | V10 plan inspection and independent verifier review of every numeric/observed claim.               | No fabricated conversion rate, revenue, reach, install, ROI, provider success, or customer quote is presented as observed; unknowns remain explicitly unknown.                   |
| P7.2 | Acquisition measurement uses the allowlisted consented funnel and distinguishes impressions, checkout starts, authoritative purchases, refresh/recovery, refunds, and support outcomes. | static + test               | Cross-check plan against P6 event tests, `lib/privacy-analytics.ts`, and `server/license-api.mjs`. | Every proposed metric maps to an emitted event or is marked as a future external measurement; no raw signup/click/view is called a paid conversion.                              |
| P7.3 | The plan preserves the external evidence boundary.                                                                                                                                      | static + independent review | V10 plan/audit inspection and independent verifier review.                                         | Local tests/builds are not described as live Stripe/store/public/revenue proof; live-provider, payment, store, and publication actions remain separate blocked or pending gates. |

## Exact verification sequence after freeze

The verifier should run the smallest relevant checks first, then broaden only
when a failure or changed surface requires it. Every command must be run fresh
and its complete stdout/stderr plus exit code saved under `VERIFY_DIR`.

### 1. Static and artifact checks

```bash
git diff --check
npm exec prettier -- --check \
  docs/PAID_CONVERSION_PLAN.md \
  docs/PAID_CONVERSION_FORMAL_VERIFICATION.md \
  <each changed source/test file>
npm run typecheck
```

Use the repository's actual formatter configuration. If Prettier's CLI shape
differs, record the exact command that was run and its exit code rather than
silently substituting an incomplete check.

For copy claims and forbidden leakage, record the complete output of targeted
searches such as:

```bash
rg -n -i \
  "storage|free up|entire library|full library|guarantee|always|subscription|monthly|annual|recurring|five star|love" \
  components tabs lib server docs/PAID_CONVERSION_PLAN.md
rg -n -i \
  "email|photoUrl|filename|mediaKey|accountId|token|exactCount" \
  lib/privacy-analytics.ts server/license-api.mjs tabs/app.tsx
```

Search output is a review input, not a blind fail rule: a qualified policy or
test fixture may contain a term. The reviewer must inspect every hit and record
the disposition in the P3/P4/P6/P7 rows.

### 2. Focused unit/component/server tests

Run the existing relevant tests plus every new test file introduced by the
writer. The minimum command is:

```bash
npm exec vitest run \
  tests/components/upgrade-dialog.test.tsx \
  tests/components/rating-prompt-dialog.test.tsx \
  tests/lib/entitlement.test.ts \
  tests/lib/license-client.test.ts \
  tests/lib/paid-access-lifecycle.test.ts \
  tests/lib/privacy-analytics.test.ts \
  tests/lib/rating-prompt.test.ts \
  tests/server/license-api.test.ts
```

Record the full test count, skipped count, failed test names, and exit code.
A focused green run proves only those declared fixtures and proof classes.

### 3. Integration browser journeys

After a build suitable for the integration fixture, run the relevant journeys:

```bash
npx playwright test --config playwright.config.ts \
  tests/e2e/integration/app-tab.test.ts \
  tests/e2e/integration/trash-undo.test.ts \
  tests/e2e/integration/cross-tab-messaging.test.ts
```

The verifier must inspect the complete report and independently reproduce at
least these browser cases: over-cap scan, zero-result scan, provider error,
cancel, account reset, result-specific paywall, dismissal with selected groups,
checkout-return refresh, no automatic Trash, successful positive Trash, failed
Trash, zero-move/restore, consent opt-out/allow, and rating preferences.

If a browser journey is not implemented in the existing fixture, the row is
`BLOCKED` until a deterministic mocked fixture or a justified manual runtime
observation exists. A component render alone does not prove cross-screen state,
listener cleanup, storage retention, or provider command absence.

### 4. Full local gates and package boundary

Run the full local suite after focused checks are green:

```bash
npm test
npm run build
```

If paid-conversion changes touch package/runtime wiring, also run a production
environment build with the actual approved non-secret build inputs and then:

```bash
npm run audit:extension-package
```

Do not paste private keys or Stripe secrets into evidence. If the required
production variables are unavailable, record the package proof as `BLOCKED` and
keep any development-entitlement build clearly labeled as local/test evidence.

### 5. External boundaries

The following require separate authorized evidence and are never inferred from
local tests:

| Boundary         | Required evidence for a broader `PASS`                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider         | Tiny non-sensitive Google/iCloud/Amazon scan → review → Trash → restore where the claim covers that provider                                                        |
| Stripe/provider  | Test-mode checkout, cancellation, payment failure, delayed success, partial/full refund, dispute, expiry, replay, and signed token refresh against deployed service |
| Store/deployment | Production configuration, deployed license API, package host permissions, Chrome Web Store dashboard and policy parity                                              |
| Human            | Keyboard/accessibility and copy review for truthful scope, free exit, comparison clarity, and rating honesty                                                        |
| Public/revenue   | Published state and real funnel/revenue evidence; no local test substitutes                                                                                         |

Absent or ambiguous external proof yields `BLOCKED` for that broader claim,
while the bounded local property may still be `PASS`.

## Final verdict rule

The verifier must publish three scoped verdicts:

1. **Local formal verdict:** `PASS` only if every mandatory P1–P7 property
   claimed as local/static/test/build/runtime proof is `PASS` against one frozen
   candidate. Any failed property is `FAIL`; any required unavailable local
   proof is `BLOCKED`.
2. **External lifecycle verdict:** `PASS`, `FAIL`, or `BLOCKED` separately for
   provider, Stripe/store, and production/public evidence.
3. **Overall formal verdict:** `FORMAL-VERIFICATION: PASS` only when every
   mandatory claimed property and every required external gate for the stated
   completion claim passes. Otherwise report `FAIL` or `BLOCKED` with the exact
   property IDs and next action.

Do not describe a paid-conversion implementation as complete, revenue-ready,
store-ready, or live-provider verified from a passing typecheck, focused test,
mocked webhook, local build, or pending checkout tab.

## Final evidence ledger — repaired frozen candidate

The writer froze the candidate at base `dd28bca987f107210304a85e13a4f3844525d459`.
The frozen manifest, status, tracked patch, and untracked patch are in
`tmp/paid-conversion-implementation-20260908/`; the independent evidence
directory is `tmp/paid-conversion-verification/20260908T20260908T083456Z/`.
The verifier's pre-report binding is recorded in
`final-post-check-binding.txt`: the base SHA matched, every implementation,
test, plan, freeze, and candidate-patch hash matched the writer manifest, and
`git diff --check` passed. The only source delta since the prior candidate was
the repaired free-exit Snackbar visibility plus the permanent app-tab normal
pointer regression; it is recorded in `free-exit-repair-delta.patch`.

The following verifier IDs are exact commands or durable observations used by
the rows below. All commands were run with the task-local
`DEVELOPER_DIR=/Library/Developer/CommandLineTools` where Xcode tooling was
involved; no global developer-directory setting was changed.

| Verifier | Exact command or observation                                                                                                                                                                                                                                                                                                                                                                     | Evidence                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1       | `shasum -a 256 -c tmp/paid-conversion-implementation-20260908/candidate-sha256.txt`; `git diff --check`                                                                                                                                                                                                                                                                                          | `final-post-check-binding.txt`, `final-post-check-binding-exit.txt`                                                                                                                                |
| V2       | `npm test -- --reporter=dot`                                                                                                                                                                                                                                                                                                                                                                     | `final-full-unit.log`, `final-full-unit-exit.txt`; 43 files and 538 tests passed, exit 0                                                                                                           |
| V3       | `DEVELOPER_DIR=/Library/Developer/CommandLineTools npm run typecheck`                                                                                                                                                                                                                                                                                                                            | `final-typecheck.log`, `final-typecheck-exit.txt`; exit 0                                                                                                                                          |
| V4       | `npx prettier --check` over every changed source/test file and `docs/PAID_CONVERSION_PLAN.md`                                                                                                                                                                                                                                                                                                    | `final-prettier.log`, `final-prettier-exit.txt`; all matched, exit 0                                                                                                                               |
| V5       | `DEVELOPER_DIR=/Library/Developer/CommandLineTools npx playwright test --config playwright.config.ts tests/e2e/integration/app-tab.test.ts tests/e2e/integration/trash-undo.test.ts --workers=1`                                                                                                                                                                                                 | `final-free-exit-app-trash.log`, `final-free-exit-app-trash-exit.txt`; 33/33 passed, exit 0                                                                                                        |
| V6       | `DEVELOPER_DIR=/Library/Developer/CommandLineTools PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL=https://photosweep-license-api-206538169327.us-west1.run.app npx playwright test --config tmp/paid-conversion-verification/20260908T20260908T083456Z/final-runtime-probes.config.ts`                                                                                                            | `final-free-exit-runtime-probe.log`, `final-free-exit-runtime-probe-exit.txt`; consent and invalid-token checkout-return probes 2/2 passed, exit 0                                                 |
| V7       | `DEVELOPER_DIR=/Library/Developer/CommandLineTools PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL=https://photosweep-license-api-206538169327.us-west1.run.app PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=1 npm run build`                                                                                                                                                                    | `final-free-exit-fixture-build.log`, `final-free-exit-fixture-build-exit.txt`; fixture-only build passed with the dev entitlement flag true                                                        |
| V8       | `DEVELOPER_DIR=/Library/Developer/CommandLineTools env -u PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL=https://photosweep-license-api-206538169327.us-west1.run.app npm run build`                                                                                                                                                               | `final-production-restore-build.log`, `final-production-restore-build-exit.txt`; production-default rebuild passed after the fixture build                                                         |
| V9       | `DEVELOPER_DIR=/Library/Developer/CommandLineTools PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL=https://photosweep-license-api-206538169327.us-west1.run.app PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=0 PHOTOSWEEP_AUDIT_STRICT_DEV_KEY_ABSENCE=1 npm run audit:extension-package` plus generated-flag and bundle-key search                                                              | `final-production-flags-package.log`, `final-production-flags-package-exit.txt`; audit exit 0, generated flag false, dev storage key absent                                                        |
| V10      | Fresh targeted `rg` review for claim language, analytics-sensitive fields, generation guards, and rating eligibility                                                                                                                                                                                                                                                                             | `final-static-searches.log`, `final-static-searches-exit.txt`; reviewed qualified policy/UI terms and allowlisted payload boundaries                                                               |
| V11      | `DEVELOPER_DIR=/Library/Developer/CommandLineTools npx playwright test --config tmp/paid-conversion-verification/20260908T20260908T083456Z/local-ux-review.config.ts` against the fixture build; screenshots at 360x800 and 1024x900; inspect `.MuiDialogContent-root` as the actual scroll container; perform real wheel, Tab, Escape, focus-return, plan/recovery copy, and rating-copy checks | `local-ux-review-complete.log`, `local-ux-review-complete-exit.txt`, `local-ux-upgrade-keyboard-scroll.log`, `upgrade-dialog-*-viewport.png`, `rating-dialog-*-viewport.png`; final run 2/2 passed |

The fixture build in V7 is test evidence only. V8/V9 are the production-
default local package boundary; they do not prove a deployed payment provider,
store listing, public release, or revenue result. The production bundle retains
an inert `local_dev` entitlement type string, while the generated
`ALLOW_DEV_ENTITLEMENT` flag is `false`, `DEV_ENTITLEMENT_STORAGE_KEY` is
`undefined`, and `photoSweepDevEntitlement` is absent from the audited package.

Because V11 used the dev fixture build, the production artifact was restored
again afterward. The final restore and package audit are recorded in
`final-production-restore-build-v2.log`, `final-production-restore-build-v2-exit.txt`,
`final-production-flags-package-v2.log`, `final-production-flags-package-v2-exit.txt`,
and `final-production-flags-v2.txt` (all exit 0).

The earlier free-exit defect is retained as historical evidence in
`checkout-free-exit-failure.md`. It was caused by persistent warning/Undo
Snackbars intercepting the UpgradeDialog's free-exit control. The repaired
candidate suppresses those Snackbars while the dialog is open, retains their
state for later dismissal, and passes the current V6 normal-pointer probe and
V5 app-tab regression. It is therefore not a current candidate failure.

A preliminary narrow-layout observation is retained in
`local-ux-review-failure.md`. It inspected the static Dialog paper and appeared
to show the lower plans outside the viewport. The follow-up V11 probe inspected
the actual `.MuiDialogContent-root` scroll container: a real wheel moved its
scroll position from `0` to `613.5`, and Tab reached the Cleanup Pass and Mini
buttons while automatically scrolling them into view. The preliminary result
was therefore a false alarm caused by observing the wrong scrolling element,
not a product failure.

### P1 — Value before ask and safe free flow

| ID   | Claim                                                         | Proof class         | Verifier                                           | Pass condition                                                                                                                   | Actual result                                                                                                          | Evidence                                                                                             | Verdict |
| ---- | ------------------------------------------------------------- | ------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------- |
| P1.1 | Scan-limit conversion waits for a usable result.              | static/test/runtime | V2 and V5 over-cap and in-progress/result journeys | No automatic modal while fetching/detecting/error/cancel; only a completed locked result may qualify.                            | Full suite and the 33-case app integration passed; over-cap conversion is result-bound in the fixture.                 | `final-full-unit.log`; `final-free-exit-app-trash.log`                                               | PASS    |
| P1.2 | Entitlement scan/group/Trash/report/resume caps remain exact. | test                | V2 entitlement boundary vectors                    | Free 1000/25/10 and Mini 2500/75/100 boundaries, Cleanup Pass duration/full-scan/resume, and Lifetime unlimited remain enforced. | 43/43 files and 538/538 tests passed, including entitlement and cap regressions.                                       | `final-full-unit.log`                                                                                | PASS    |
| P1.3 | Zero duplicate results remain useful and do not upsell.       | test/runtime        | V5 zero-result/no-duplicates journey               | Result is visible with no upgrade prompt or impression caused only by emptiness.                                                 | Zero-result integration case passed with no automatic upgrade.                                                         | `final-free-exit-app-trash.log`                                                                      | PASS    |
| P1.4 | Provider errors do not imply that payment fixes the error.    | test/runtime        | V5 provider-error journey                          | Error is shown without automatic upgrade, checkout, or entitlement mutation.                                                     | Provider-error integration case passed without an automatic conversion prompt.                                         | `final-free-exit-app-trash.log`                                                                      | PASS    |
| P1.5 | Cancellation leaves a usable dismissible free flow.           | test/runtime        | V5 cancellation journey                            | Cancellation returns to retry/resume without paywall, Trash, entitlement grant, or lost selections.                              | Cancellation integration case passed.                                                                                  | `final-free-exit-app-trash.log`                                                                      | PASS    |
| P1.6 | Account/provider reset retires stale conversion state.        | test/runtime        | V2 and V5 account-reset/deferred-CTA cases         | Prompt, pending checkout, deferred CTA, selections, and account-bound state cannot leak across reset.                            | Full suite and app integration reset cases passed; repair delta remains hash-bound.                                    | `final-full-unit.log`; `final-free-exit-app-trash.log`                                               | PASS    |
| P1.7 | Dismissal is a real free exit and dialogs do not stack.       | test/runtime        | V5 and V6 normal-pointer/free-exit cases           | One dialog, usable free exit, retained review state, and no duplicate backdrop/listener.                                         | V6 consent plus invalid-token checkout-return probe passed 2/2; V5 permanent app-tab normal-pointer regression passed. | `final-free-exit-runtime-probe.log`; `final-free-exit-app-trash.log`; `free-exit-repair-delta.patch` | PASS    |

### P2 — Checkout return and authoritative lifecycle

| ID    | Claim                                                                                                      | Proof class         | Verifier                                                                    | Pass condition                                                                                                                                          | Actual result                                                                                                    | Evidence                                                             | Verdict |
| ----- | ---------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------- |
| P2.1  | Hosted checkout return uses bounded refresh and cleans listeners.                                          | static/test/runtime | V2 and V6 invalid-token return with mocked checkout/entitlement             | One bounded retry budget, no refresh storm, and no listener leak on return/reset.                                                                       | Unit lifecycle tests passed; V6 returned to a retryable pending state with no loop observed.                     | `final-full-unit.log`; `final-free-exit-runtime-probe.log`           | PASS    |
| P2.2  | Only a valid server-signed entitlement unlocks paid behavior.                                              | static/test         | V2 license-client/lifecycle/server tests                                    | Forged, malformed, expired, unsigned, or local-injected tokens remain Free; verified signatures alone change plan.                                      | Full suite passed the token verification and fail-closed cases.                                                  | `final-full-unit.log`; `final-static-searches.log`                   | PASS    |
| P2.3  | Cancel/failure/unpaid/duplicate checkout attempts do not unlock or duplicate purchase.                     | test                | V2 lifecycle/server tests and V5 mocked checkout paths                      | No entitlement before authoritative paid event; guarded attempt and idempotent event behavior.                                                          | Mocked checkout, lifecycle, and server matrix passed; no live checkout was used.                                 | `final-full-unit.log`                                                | PASS    |
| P2.4  | Local delayed-payment, refund/dispute/expiry/offline/replay semantics are correct.                         | static + test       | V2 mocked server/lifecycle matrix and local implementation review           | Unpaid completion stays locked; paid async success unlocks; refund/dispute/expiry refresh downgrades; offline cache fails closed; replay is idempotent. | Full local mocked server/lifecycle matrix passed; this is not deployed-provider proof.                           | `final-full-unit.log`; `final-static-searches.log`                   | PASS    |
| P2.4b | Deployed provider/store executes the same delayed-payment, refund/dispute/expiry/offline/replay lifecycle. | provider + store    | Authorized deployed Stripe/provider test-mode matrix                        | Full external lifecycle passes against deployed systems.                                                                                                | No deployed Stripe/provider/store exercise was authorized or available.                                          | External boundary ledger below                                       | BLOCKED |
| P2.5  | Refresh/recovery retains review selections and never starts Trash automatically.                           | test/runtime        | V2 and V6 saved selection plus invalid-token return; V5 Trash/Undo journeys | Selection state survives return/recovery and no `trashItems`, `TRASH_STARTED`, provider mutation, or auto-confirm occurs.                               | V6 retained review and free exit after an unverifiable return with no Trash command; V5 Trash/Undo suite passed. | `final-free-exit-runtime-probe.log`; `final-free-exit-app-trash.log` | PASS    |
| P2.6  | Recovery is generic and preserves Mini/Lifetime entitlements.                                              | test                | V2 recovery, plan, and server tests                                         | Known/unknown recovery acknowledgements match and only signed recovery rebinds; plan limits remain intact.                                              | Full suite passed recovery and plan-preservation cases.                                                          | `final-full-unit.log`                                                | PASS    |

### P3 — Truthful result-specific paywall and free exit

| ID   | Claim                                                                           | Proof class             | Verifier                                                                                | Pass condition                                                                   | Actual result                                                                                                                                                                   | Evidence                                                                                                          | Verdict |
| ---- | ------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------- |
| P3.1 | Paywall scope and counts describe the actual locked result.                     | test + runtime + visual | V2/V5 rendered result assertions and V11 scope/count copy plus screenshots              | Counts and scope come from completed result; no invented totals.                 | V11 showed the actual Google Photos loaded-library scope, 14 checked items, 2 duplicate sets, and 12 selected cleanup items; no fabricated totals.                              | `local-ux-review-complete.log`; `upgrade-dialog-wide-viewport.png`                                                | PASS    |
| P3.2 | Paywall copy does not claim unsupported storage/full-library/provider outcomes. | static + test + visual  | V10 claim search plus V11 rendered copy and screenshot inspection                       | Unsupported claims are absent or qualified.                                      | V10 and V11 found truthful scope/plan copy; no storage-saved, guarantee, or unqualified provider-success claim.                                                                 | `final-static-searches.log`; `local-ux-review-complete.log`; `upgrade-dialog-wide-viewport.png`                   | PASS    |
| P3.3 | Free exit is visible, keyboard accessible, and non-trapping.                    | test + runtime + visual | V11 real wheel, Tab, Escape, focus-return, and normal-pointer probe at 360x800/1024x900 | Named free action and Escape/backdrop behavior work; focus returns correctly.    | V11 2/2 passed; real wheel moved `.MuiDialogContent-root` 0→613.5, Tab reached Cleanup Pass/Mini, Escape/free exit closed the dialog, and focus returned to the review control. | `local-ux-upgrade-keyboard-scroll.log`; `final-free-exit-runtime-probe.log`; `upgrade-dialog-narrow-viewport.png` | PASS    |
| P3.4 | Dismissing the paywall retains results and selections.                          | test + runtime          | V6 selected review plus V5 app integration                                              | Result scope, selected groups, and kept overrides are unchanged after dismissal. | V6 retained the selected review after invalid-token return and free exit; V5 passed related dismissal paths.                                                                    | `final-free-exit-runtime-probe.log`; `final-free-exit-app-trash.log`                                              | PASS    |

### P4 — Complete simple comparison and recovery

| ID   | Claim                                                                            | Proof class             | Verifier                                                                                                 | Pass condition                                                                                                          | Actual result                                                                                                                        | Evidence                                                                                                                                         | Verdict |
| ---- | -------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| P4.1 | Every existing plan shows exact price, duration, and core entitlements.          | test + runtime + visual | V2 plan/component assertions plus V11 rendered comparison at narrow and wide viewports                   | Mini $2.99 permanent limited, Cleanup Pass $4.99 seven days, Lifetime $14.99 one-time unlimited; promises match limits. | V11 found all three prices, durations, entitlements, and one-time Stripe/tax/refund copy at both viewport sizes.                     | `final-full-unit.log`; `local-ux-review-complete.log`; `upgrade-dialog-wide-viewport.png`                                                        | PASS    |
| P4.2 | Mini remains a recoverable permanent limited purchase.                           | test                    | V2 component/lifecycle/server recovery tests                                                             | Mini selection, permanent limits, generic recovery, and signed refresh all pass.                                        | Full suite passed Mini/recovery cases.                                                                                               | `final-full-unit.log`                                                                                                                            | PASS    |
| P4.3 | Comparison is scannable with one CTA per plan and a visible free exit.           | test + runtime + visual | V11 narrow/wide screenshots, real-wheel reachability, Tab reachability, and one-CTA/free-exit assertions | No clipping/hidden controls; one named CTA per plan; free exit is visible.                                              | V11 showed all plan CTAs/recovery/free exit; real wheel and Tab brought offscreen narrow controls into view; no horizontal overflow. | `local-ux-review-complete.log`; `local-ux-upgrade-keyboard-scroll.log`; `upgrade-dialog-narrow-viewport.png`; `upgrade-dialog-wide-viewport.png` | PASS    |
| P4.4 | Copy does not imply subscriptions, guarantees, or unsupported provider coverage. | static + test           | V2 and V10 prohibited-term/copy review                                                                   | Unsupported recurring/guarantee/provider claims are absent or explicitly bounded.                                       | Static and test checks passed; plan terms remain one-time/limited as specified.                                                      | `final-static-searches.log`; `final-full-unit.log`                                                                                               | PASS    |

### P5 — Honest post-cleanup rating request

| ID   | Claim                                                                                  | Proof class             | Verifier                                                                                  | Pass condition                                                                                  | Actual result                                                                                                                 | Evidence                                                                                                                      | Verdict |
| ---- | -------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------- |
| P5.1 | Rating appears only after confirmed positive cleanup with at least one moved item.     | test + runtime          | V2 and V5 positive, zero, failed, partial, Undo/restore, and report-only journeys         | Only a wholly successful positive cleanup with `movedCount > 0` can open the prompt.            | Full rating tests and 33-case Trash/Undo integration passed all outcome gates.                                                | `final-full-unit.log`; `final-free-exit-app-trash.log`                                                                        | PASS    |
| P5.2 | Failed and zero-move outcomes never create rating eligibility.                         | test                    | V2 rating and Trash/Undo tests                                                            | Failed, zero selected, zero moved, and disallowed partial outcomes leave eligibility unchanged. | Full unit and Trash/Undo cases passed.                                                                                        | `final-full-unit.log`; `final-free-exit-app-trash.log`                                                                        | PASS    |
| P5.3 | Rating preferences remain persistent and user-controlled.                              | test                    | V2 rating preference tests                                                                | Maybe later/review/Don't ask again persist without altering scan, result, or entitlement state. | Full rating preference tests passed.                                                                                          | `final-full-unit.log`                                                                                                         | PASS    |
| P5.4 | Rating copy asks for an honest review and offers feedback without sentiment filtering. | test + runtime + visual | V2 dialog assertions plus V11 positive-cleanup copy and narrow/wide screenshot inspection | Review and feedback paths are both offered with no satisfaction gate or hidden negative exit.   | V11 showed honest-review, Send feedback, Maybe later, and Don't ask again at both viewport sizes; no sentiment gate appeared. | `final-full-unit.log`; `local-ux-review-complete.log`; `rating-dialog-narrow-viewport.png`; `rating-dialog-wide-viewport.png` | PASS    |

### P6 — Consent, privacy, and authoritative funnel measurement

| ID   | Claim                                                                                  | Proof class    | Verifier                                                                   | Pass condition                                                                                                                   | Actual result                                                                                                     | Evidence                                                                                | Verdict |
| ---- | -------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------- |
| P6.1 | Analytics remain silent until consent and after opt-out.                               | test + runtime | V2 privacy tests and V6 intercepted first-run No thanks/Allow/reload probe | No pre-consent/opt-out events; Allow emits only allowlisted events; analytics failure cannot interrupt work.                     | V6 consent probe passed; no pre-consent or opt-out event and only the allowlisted `app_opened` event after Allow. | `final-free-exit-runtime-probe.log`; `final-full-unit.log`                              | PASS    |
| P6.2 | Funnel payloads are allowlisted, bucketed, and free of new PII/photo identifiers.      | static + test  | V2 privacy/server tests and V10 sensitive-field search                     | Email, URLs, filenames, media keys, account IDs, tokens, and exact counts do not survive serialization.                          | Full tests passed; V6 inspected payloads and found no prohibited fields.                                          | `final-full-unit.log`; `final-free-exit-runtime-probe.log`; `final-static-searches.log` | PASS    |
| P6.3 | Upgrade reasons and dismissal remain distinct measurable events.                       | test + static  | V2 schema/event tests and V10 event-builder review                         | Actual bounded reason is recorded; dismissal is explicit and not inferred from generic activity.                                 | Full privacy/lifecycle tests and static review passed.                                                            | `final-full-unit.log`; `final-static-searches.log`                                      | PASS    |
| P6.4 | Purchase completion is authoritative, deduplicated, and distinct from refresh/restore. | test           | V2 server/lifecycle replay and event-separation tests                      | Only verified server Stripe lifecycle emits purchase completion; replay is idempotent and refresh/restore names remain distinct. | Mocked server/lifecycle matrix passed; no live Stripe webhook was exercised.                                      | `final-full-unit.log`                                                                   | PASS    |
| P6.5 | Rerenders, returns, and recovery retries do not duplicate funnel events.               | test + runtime | V2 event counts and V6 return/consent interception                         | One action yields at most one event; refresh is not purchase; retries are bounded/deduplicated.                                  | Full tests and V6 runtime probe passed with no duplicate event or refresh storm.                                  | `final-full-unit.log`; `final-free-exit-runtime-probe.log`                              | PASS    |
| P6.6 | Recovery email stays inside recovery and never enters analytics.                       | static + test  | V2 recovery/privacy tests and V10 sensitive-field search                   | Email appears only in recovery request handling; analytics and snapshots contain no email/account identifier.                    | Full tests and static review passed; recovery remains a separate boundary.                                        | `final-full-unit.log`; `final-static-searches.log`                                      | PASS    |

### P7 — Truthful acquisition and measurement plan

| ID   | Claim                                                                                                              | Proof class                 | Verifier                                                                            | Pass condition                                                                                                         | Actual result                                                                                                                          | Evidence                                                                                         | Verdict |
| ---- | ------------------------------------------------------------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------- |
| P7.1 | Acquisition plan states hypotheses and evidence boundaries without inventing performance.                          | static + independent review | V10 plan inspection and independent verifier review of every numeric/observed claim | No fabricated conversion, revenue, reach, install, ROI, provider-success, or quote claim; unknowns remain unknown.     | Independent review found bounded hypotheses and explicitly unknown outcomes; no observed conversion/revenue/reach claim was presented. | `final-static-searches.log`; `docs/PAID_CONVERSION_PLAN.md`                                      | PASS    |
| P7.2 | Measurement distinguishes consented impressions, checkout, authoritative purchase, recovery, refunds, and support. | static + test               | V2/V10 cross-check of plan, privacy analytics, and server lifecycle                 | Each metric maps to an emitted event or is explicitly future external measurement; raw clicks/views are not purchases. | Full schema tests and static cross-check passed.                                                                                       | `final-full-unit.log`; `final-static-searches.log`                                               | PASS    |
| P7.3 | Plan preserves the external evidence boundary.                                                                     | static + independent review | V10 plan/audit inspection and independent verifier review                           | Local tests/builds are not represented as live Stripe/store/public/revenue proof.                                      | Independent review confirmed the plan keeps provider, payment, store, public, and revenue evidence separate from local mocks/builds.   | `docs/PAID_CONVERSION_PLAN.md`; `docs/MONETIZATION_SYSTEM_AUDIT.md`; `final-static-searches.log` | PASS    |

### External and release boundaries

| Boundary                  | Claim                                                                                       | Proof class               | Verifier                                                  | Pass condition                                                          | Actual result                                                                          | Evidence                                                        | Verdict |
| ------------------------- | ------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------- |
| External provider         | Google/iCloud/Amazon live scan → review → Trash → restore works.                            | provider                  | Authorized non-sensitive live provider fixture            | Exact provider lifecycle succeeds for each claimed provider.            | No live provider fixture was run. Local browser stubs do not prove provider behavior.  | `CANDIDATE_FREEZE.md`; this report's external-boundary contract | BLOCKED |
| External Stripe/store     | Deployed signed checkout/webhook/refund/dispute/expiry/replay and store configuration work. | provider/store/public     | Authorized deployed test-mode provider and store evidence | Full external payment and store matrix passes against deployed systems. | No deployed Stripe, webhook, store dashboard, or refund/replay evidence was available. | `final-full-unit.log` is mock-only; no live proof               | BLOCKED |
| Production/public/revenue | Published extension, public funnel, and real revenue outcome are verified.                  | production/public/revenue | Authoritative public/store/revenue sources                | Public state and real funnel/revenue evidence match the stated claim.   | No publication, outreach, charge/refund, or revenue activity was performed.            | `docs/MONETIZATION_SYSTEM_AUDIT.md`; this report                | BLOCKED |

## Final scoped verdict

- **Bounded local automated implementation evidence:** `PASS` for the rows
  whose required proof is static, unit, build, or mocked-runtime evidence and
  is explicitly marked `PASS` above. The exact candidate hashes, fresh full
  suite, typecheck, formatter, repaired browser regression, production-default
  build, and package audit are recorded in the evidence directory.
- **Local formal verdict:** `PASS` for the bounded local/static/test/build/
  runtime/visual/independent-review properties. V11 independently verified
  scope-aware copy, plan comparison, recovery reachability, real wheel and Tab
  scrolling, Escape/free-exit focus return, and rating review/feedback copy.
  P2.4 is explicitly local mocked lifecycle evidence; P2.4b is the separate
  unavailable deployed-provider child property.
- **External lifecycle verdict:** `BLOCKED` for provider and Stripe/store.
- **Production/public/revenue verdict:** `BLOCKED`.
- **Overall:** `FORMAL-VERIFICATION: BLOCKED`. The remaining actions are an
  authorized deployed provider/payment lifecycle matrix, store/deployment
  evidence, and public/revenue evidence. No local mock or build result
  substitutes for those external gates.

The report itself was updated after the pre-report candidate binding. Its final
verifier-owned hash and the implementation-only post-report hash check are
recorded in `final-report-sha256.txt` and
`final-post-report-binding-v3.txt`; the frozen implementation hashes remain
the writer manifest's source of truth.
