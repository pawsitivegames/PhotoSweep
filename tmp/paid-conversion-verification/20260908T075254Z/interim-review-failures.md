# Interim independent review — frozen candidate

Captured at `2026-09-08T07:52:54Z` while the implementation writer was
paused. This is a read-only review artifact. Root instructed the verifier to
pause expensive final tests/builds because these in-scope defects require a
repair and a new freeze.

## Candidate binding

- Base SHA: `dd28bca987f107210304a85e13a4f3844525d459`
- Candidate freeze record: `tmp/paid-conversion-implementation-20260908/CANDIDATE_FREEZE.md`
- Candidate tracked patch SHA-256:
  `5e24664bcd0145c090809e1ebdc9a2bf0bc09481a3860751c00f345cebeb1504`
- Candidate untracked patch SHA-256:
  `4f5dd4aebce9b56608a6d95123653093c2b89add8174307613d574c036a6b1cb`
- Frozen implementation hashes at capture:
  - `lib/paid-access-lifecycle.ts`
    `0ba57917f92e37ac2489e69e1c2aad50a6f023ab1ec40fc16bd59f1c10e5b555`
  - `tabs/app.tsx`
    `55eb9fa5d94bb857be5cf281767cc803de37a6abd23f4f351f7f32e441933621`
- The freeze status and complete changed-file hash manifest remain the
  authoritative candidate binding; the current worktree must be rebound after
  every repair.

## FAIL findings

### P2-R1 — invalidated context can reuse an old checkout response (HIGH)

`PaidAccessLifecycle.createCheckout` returns the existing
`checkoutInFlight.promise` for *any* requested plan at
`lib/paid-access-lifecycle.ts:127-136`. `tabs/app.tsx:1270-1282` invalidates
only the React-side generation and refs; it does not cancel or invalidate the
lifecycle's in-flight operation. The new caller at `tabs/app.tsx:1639-1655`
checks the new generation and `checkoutPlanRef`, but does not re-check
`checkout.planId` against its requested plan.

Deterministic reproduction:

1. From a connected Free state, start a `lifetime` checkout and leave the
   client promise unresolved.
2. Reset, switch account/provider, or otherwise call
   `invalidatePaidConversionContext()`; then start a `cleanup_pass` checkout
   before the old promise settles.
3. Resolve the old promise with `{planId: "lifetime", url: "https://..."}`.

The new generation accepts the old promise because its app ref is
`cleanup_pass`, then emits `checkout_started` for `cleanup_pass` and opens the
lifetime URL. This violates plan/session binding and can send a user through a
stale checkout after identity reset. The existing lifecycle test that expects a
different plan caller to receive the first plan's response does not cover this
invalidated-context case.

Required regression/pass condition: an old in-flight operation cannot satisfy a
new generation or a different plan. The new caller must fail/queue until a
fresh operation is created, and no stale URL/event may be opened. A same-plan
old operation after an identity reset also needs an explicit context lease or
cancellation policy; generation checks alone do not cancel the lifecycle
promise.

### P5-R1 — rating prompt can collide with undo/warning/recovery surfaces (MEDIUM/HIGH)

After a complete positive cleanup, `tabs/app.tsx:1881-1895` first sets
`undoData` and may set `trashWarning`, then asynchronously opens the rating
dialog when `recordSuccessfulCleanup` resolves. The gate checks only
`upgradePromptRef`, checkout `pending`/`refreshing`, and
`ratingPromptOpenRef`; it does not check `trashConfirm`, `undoData`, or
`trashWarning`. The rendered Undo and warning Snackbars are at
`tabs/app.tsx:4511-4555`, and the rating dialog is rendered at
`tabs/app.tsx:4419-4444`.

Deterministic reproduction: resolve a successful provider result with a
positive moved count and an undo snapshot; delay storage resolution inside
`recordSuccessfulCleanup`; let the callback resolve. The Undo snackbar and
rating dialog are both open. Repeat with a warning/recovery message. The plan
requires suppression while warning/recovery surfaces are active.

Related collision: `openUpgradePrompt` at `tabs/app.tsx:1360-1367` does not
close/suppress an already-open rating prompt. An asynchronous or user-triggered
locked action can therefore render both dialogs.

Required regression/pass condition: rating remains closed or deferred while
Trash confirmation, Undo/recovery, warning, upgrade, or checkout-return UI is
active; opening an upgrade prompt closes/suppresses rating; no callback can
resurrect it after those surfaces appear.

### P2-R2 — same-provider account change can leave pending checkout alive (HIGH)

The health-result account mismatch branch at `tabs/app.tsx:2200-2218` resets a
stale scan checkpoint but does not call `invalidatePaidConversionContext`.
The later invalidation effect at `tabs/app.tsx:2082-2110` runs only when
`state.status === "results"`. Therefore a pending checkout opened while the
app is in `connected` state can survive a same-provider account change.

Deterministic reproduction: connect account A, open the paywall and start a
checkout while `state.status` is `connected`, switch the provider session to
account B, let `healthCheck.result` report B, and fire window focus. The old
`checkoutPlanRef` remains available and reconciliation refreshes the new
session. This can attribute account B's signed access or stale account A state
to the old checkout.

Required regression/pass condition: account identity mismatch invalidates the
paid-conversion generation and clears pending checkout/reconcile/UI state in
all app states, including `connected`, `scanning`, and checkpoint-only states;
focus after the switch cannot reconcile the old checkout.

## Scope and evidence boundary

These are static/state-machine FAIL findings against the exact frozen
worktree, before final tests/build were run in this independent pass. The
writer's prior focused/full/build outputs are not promoted as independent
proof. Repaired candidates must be frozen again and rebound before any result
above is reused. No live provider, Stripe, store, public, revenue, or device
claim is made by this artifact.
