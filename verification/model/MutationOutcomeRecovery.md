# Bounded mutation-outcome recovery model

`MutationOutcomeRecovery.tla` complements `TrashLifecycle.tla` with explicit
per-target mutation states. Its terminal outcomes are `confirmed`, `failed`,
and `unknown`; each terminal attempt also partitions its requested targets into
dispatched and never-dispatched sets. The never-dispatched set is specific to
the current attempt. `everNotDispatched` is the separate retained-history set.

The model has three items, arbitrary nonempty batches over those items, and at
most two restore attempts. It explores mixed confirmed/failed/unknown replies,
timeouts, a partial restore, persistence, a crash after a terminal checkpoint,
reload, and retry of failed targets. Unknown outcomes remain sticky; the retry
set is derived only from failed statuses captured before retry dispatch. The
durable confirmed-Trash set is the source universe, while the retry set is the
failed-only subset represented by the application's `restorableDedupKeys`.

`run-mutation-outcomes-tlc.mjs` verifies TLC 1.8.0 against its pinned JAR hash,
checks source hashes before and after both runs, and writes separate positive
and unsafe-retry artifacts. The positive run requires complete reachability
coverage for every listed action. The negative run sets
`UnsafeRetryUnknown = TRUE` and passes only when TLC reaches `RetryFailedRestore`
and reports the `InvRetryOnlyFailed` counterexample. TLC's trace-exploration
spec generation is disabled so a run cannot write beside source files.

This finite model exhausts the declared three-item state space. It does not
prove behavior at arbitrary collection sizes, a browser or service-worker
crash during an in-flight dispatch, a failed storage write, provider behavior,
or full TypeScript trace refinement. SAFE-12's generated property and explicit
`TrashLifecycle`/recovery-history test provide separate implementation-seam
evidence; they are not claimed as an unbounded proof. The generated
implementation-oracle test exhausts 1,000 three-target, two-attempt outcome
matrices, reloads JSON between attempts, and compares cumulative statuses,
failed-only retry keys, current-attempt never-issued keys, and retained
never-issued history against an independent transition rule. It does not read
or replay TLC traces. The hand-authored `TrashLifecycle` scenario remains a
separate deterministic seam check.

`RecoveryAuthority.tla` is a separate bounded model of service-worker storage
transactions, dispatch authorization, reload revocation, and safety-row
retention. Its finite authority model does not enlarge this outcome model's
three-target/two-attempt result partition proof. In the implementation, a
complete terminal for an exact still-live request may resolve that request's
provisional timeout unknowns; unknowns from another request or from a
reloaded/legacy attempt remain protected.
