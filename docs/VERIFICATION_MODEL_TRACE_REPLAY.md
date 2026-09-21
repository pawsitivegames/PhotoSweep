# Bounded TLC to TypeScript trace replay

`verification/model/export-trace.mjs` runs the pinned TLC simulator and keeps
the raw `-simulate file=...` modules as the source of every replayed event and
state. It writes a parsed `traces.json` only as a convenience view. The bundle
checker reparses every raw module and compares its content and SHA-256 hash, so
hand-authored JSON or an old trace directory cannot be accepted as TLC output.

## Reproduce a bounded run

From the repository root:

```sh
node verification/model/export-trace.mjs \
  --run-id model-trace-replay-20260915 \
  --seed 20260915 \
  --depth 24 \
  --traces 256 \
  --out-dir tmp/verification/trace-replay/model-trace-replay-20260915

npx vitest run tests/verification/model-trace-replay.test.ts --reporter=verbose

# The package/verification-runner integration preserves the same bounded
# result and exits 2 only when explicit unsupported seams remain.
pnpm test:model-replay -- --run-id model-trace-replay-20260915-integrated \
  --seed 20260915 --depth 24 --traces 256 \
  --out-dir tmp/verification/trace-replay/model-trace-replay-20260915-integrated
```

The focused test writes `replay-report.json` beside the bundle. That report
retains per-step expected/actual projections, unsupported reasons, coverage,
the negative-control mismatch, and the same run/build/source provenance even
when a required replay assertion fails.

The exporter rejects a nonempty output directory. The manifest records the
seed, finite depth, requested trace count, one-worker setting, TLC version and
JAR hash, command line, run ID, and a build ID. The build ID binds the model,
model configuration, exporter inputs, and the replay implementation seams:

- `verification/model/TrashLifecycle.tla`
- `verification/model/TrashLifecycle.cfg`
- `lib/trash-lifecycle.ts`
- `lib/trash-dispatch-guard.ts`
- `lib/review-preflight.ts`
- `verification/model/export-trace.mjs`
- `verification/trace-replay.ts`
- `verification/trace-replay-runner.mjs`
- `verification/trace-replay-status.mjs`

The exporter checks the source again after TLC exits. Replay recomputes the
required source file set and digests before and after the adapter runs. It
rejects an empty, duplicate, unexpected, or changed source list and rejects a
build ID that is not derived from the current commit and source digest. A
scenario fixture or hand-authored JSON cannot be presented as a TLC replay.
The replay entry points also require this verified provenance record.

## What the adapter compares

Supported imported TLC actions drive the actual TypeScript seams:

| Model action                          | TypeScript seam and observable result                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Confirm`, `ManualTrashAllConfirm`    | `TrashLifecycle.begin`, preflight result, audit count, keeper-safe command targets                                                          |
| `PersistAudit`, `PersistAuditFailure` | Atomic pre-trash audit behavior; the adapter looks ahead one action because `begin()` persists the audit before returning a command         |
| `Dispatch`                            | `captureTrashDispatchAuthorization` and `isTrashDispatchAuthorizationCurrent`; expected command fields come from model `dispatched*` state  |
| provider success/error actions        | `TrashLifecycle.reconcile`, exact media/dedup identities, outcome kind, and Undo data                                                       |
| `DuplicateReply`                      | A second public `reconcile` call and its ignored/failed result                                                                              |
| `DriftSelection`, `DriftContext`      | Preflight and dispatch guard rejection followed by request-bound `TrashLifecycle.cancel`; a public no-pending probe supplies the pending-state observation |
| `Crash`, `Recover`                    | Request-bound cancellation/reset and the public no-pending probe                                                                            |
| `Timeout`, `LateProviderReply`        | `TrashLifecycle.timeout` retains ambiguity; the matching request ID can later reconcile the provider reply                                  |
| `StaleProviderReply`                  | A mismatched request ID is rejected without consuming the current operation                                                               |
| `Undo`                                | `TrashLifecycle.beginRestore` and exact Undo dedup targets                                                                                  |

Each supported step compares expected model-derived fields with actual seam
results. The negative control runs the same adapter with a test-only provider
fault that removes one confirmed media/dedup pair from the provider data before
calling `TrashLifecycle.reconcile`, then preserves the first expected/actual
mismatch as `DETECTED` evidence. It exercises the replay boundary without
changing the production source; it demonstrates comparator sensitivity to a
fault injected at the provider seam rather than claiming a live production
mutation.

When the model is at a valid supported seam, a missing actual command or
dispatch state is an implementation/model `FAIL`. `UNSUPPORTED` is reserved
for a model transition that the current public seams cannot represent, so an
implementation failure cannot be hidden by the abstraction inventory.

## Explicit limits and coverage

`TrashLifecycle` now binds `begin`, `timeout`, and `reconcile` to a request ID.
Timeouts retain an ambiguous pending operation, matching late replies can
reconcile it, and mismatched or duplicate replies are ignored without
consuming the current operation. Drift and crash replay use the explicit local
cancel seam. The TLA+ model still cannot express crossed media/dedup identity
pairs, so that obligation is reported as the `crossed-identity-pair`
abstraction gap. An unsupported step is never counted as a pass. If a future
trace reaches a context that has no directly comparable seam, the occurrence
is named in `unsupportedActions`, counted in `unsupportedActionCounts`, and
explained by `unsupportedReasons`; totals are reconciled against the
unsupported step count.

Replay coverage records all 18 non-`Init` TLC action families in
`actionCounts`. Only a passing supported step counts toward
`supportedActionCounts`. It also requires a nonempty confirmed moved-set reply and a nonempty Undo
witness. A seeded sample that misses any supported action or witness reports
the uncovered item and cannot satisfy `requireCoverage`; unsupported action
counts are reported separately for every generated action family and never
satisfy supported coverage. `PASS_WITH_UNSUPPORTED` means all replayed
supported steps matched while explicit gaps remain; `PASS` requires complete
supported action and witness coverage. A mixed export, test, or replay failure
is `FAIL` even when unsupported actions are present. These are bounded trace
results, not an unbounded refinement proof, whole-application theorem, provider
proof, or release gate.

## Current release snapshot

The current release run `release-followup-20260916T135500Z` replayed 256
source-bound TLC traces with 5,926 passes, 0 failures, and 0 unsupported steps
after the request/timeout/local-cancel implementation. The crossed-identity-pair
seam remains outside this adapter abstraction, so these are bounded trace
results rather than an unbounded refinement proof or whole-application theorem.
