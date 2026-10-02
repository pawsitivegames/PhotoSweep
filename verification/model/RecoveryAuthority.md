# Bounded recovery transaction authority model

`RecoveryAuthority.tla` models the service-worker transaction boundary that
persists restore intent and recovery history. It complements
`MutationOutcomeRecovery.tla`: the latter checks target-by-target mutation
outcome partitions and failed-only retry; this model checks when a caller may
dispatch, what a worker reload revokes, and which recovery rows may be retained
or cleared.

The positive configuration exhausts two caller slots, two target IDs, two
operation/request identities, one provider/session namespace, one service
worker authority, one worker reload, and a two-entry history-pressure counter.
It requires coverage for every action named in
`recovery-authority-model-evidence.mjs`. A fresh caller may submit after the
reload, and the separate after-reload overlap action must reject it against an
active persisted guard that was already present at reload. The model's
`ReloadWorker` action deliberately abstracts both loss of the worker process
and loss of the app's in-memory request lease; it is not evidence that a
worker-only restart revokes an otherwise live app's exact-request terminal
authority. The current worker test gate separately covers replay denial after
worker restart; the exact app-lease/reload composition remains a bounded model
assumption until exercised at the real app boundary. Confirmed progress remains in the durable status
ledger through terminal persistence. Active intents reserve overlapping
targets across operations. Terminal unknown rows remain safety rows for
retention and selective clear, but they do not remain global overlap
reservations after becoming terminal, matching the current helper's
`terminal === false` predicate.

The model treats begin's storage write, exact readback, and accepted ACK as one
abstract transition. It models write failure as no effect and a committed but
lost ACK as a durable guard with no live dispatch authorization. The concrete
worker has separate awaited set/get/readback operations; its selected
service-worker tests are a distinct behavior-evidence obligation for write,
readback, terminal-write, and lost-ACK boundaries. The static correspondence
test checks registered action names and links to current test titles; it is
not a behavioral refinement proof.

`ClearRecovery` removes ordinary terminal rows and preserves active guards and
terminal-unknown safety rows. This is a preservation abstraction, not an exact
model of every record field or clear response. The pruning negative control
enables deletion of active guards and must fail `InvActiveIntentGuardRetained`
at `PruneCompletedHistory`. The clear negative control enables deletion of a
terminal-unknown safety row and must fail `InvSafetyRowsRetained` at
`ClearRecovery`.

Run all three checks with:

```sh
node verification/run-recovery-authority-tlc.mjs --out-dir tmp/verification/runs/recovery-authority-<fresh-id>
```

The runner requires the pinned TLC 1.8.0 JAR, disables trace-spec generation
beside model source, and fingerprints the model, all three configs, runner,
JAR, and listed current worker/helper/app/test/registry sources before and
after the suite. Positive evidence is accepted only with a complete required
action list, positive state/depth counts, no TLC invariant error, and positive
action counts. Negative evidence is accepted only for the exact configured
invariant and counterexample action, with TLC's invariant-violation exit code.

These finite checks do not prove arbitrary list sizes, the concrete 21-row
capacity boundary, multiple independent service workers, whole-app
TypeScript trace equivalence, all browser/storage failure schedules, provider
mutation atomicity, or that `recordChangeTag` prevents a favorite/Trash race.
The single namespace also does not establish cross-account rejection; that
boundary is covered by separately scoped worker tests. Actual provider
favorite checks remain best-effort snapshots before dispatch.
