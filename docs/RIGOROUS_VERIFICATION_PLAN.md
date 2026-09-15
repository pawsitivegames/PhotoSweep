# PhotoSweep rigorous verification plan

Status: proposed verification contract, 2026-09-15. This document is not a proof or a fresh test result.

## Scope and baseline

This checkout is a Plasmo/React/TypeScript Chrome MV3 extension. Its safety boundary includes duplicate classification, review selections, provider/account binding, Trash, Undo, persisted recovery, and paid access. Existing working-tree changes were inspected and preserved.

Existing infrastructure includes Vitest unit/component/provider-command/server tests, Playwright extension integration tests, gated live Google Photos tests, performance benchmarks, and a paid-conversion evidence matrix. `package.json` and `vitest.config.ts` do not currently configure fast-check, Stryker, or a formal model checker. No test suite was executed for this planning pass; earlier result counts are not a current baseline.

## What a verification claim means

- Example tests demonstrate particular executions.
- Property-based tests search many generated inputs and event sequences; they are not exhaustive mathematical proofs.
- Model checking exhaustively checks the configured finite model. The report must state bounds, assumptions, state counts, and whether exploration completed.
- A deductive proof establishes a stated theorem under explicit assumptions. A proof about an abstract model does not automatically establish correctness of the TypeScript implementation.
- Provider/browser evidence demonstrates integration behavior for a particular build, environment, account, and time.

Use these labels independently. An internal `FORMAL-VERIFICATION: PASS` checklist label must not be presented as proof of the entire app.

## Safety contract to implement and verify

Assign each property a stable ID and link it to the implementation, specification, tests, and evidence. The following are proposed requirements, not assertions that all currently hold.

| ID | Requirement | Primary seam and verification |
| --- | --- | --- |
| SAFE-01 | Automatic selection keeps at least one distinct provider item in every nonempty group; insufficient evidence keeps all. Explicit manual Trash-all is a separate, confirmed transition. | `keep-strategy`, `duplicate-review-session`; generated collections, identity collisions, model invariant |
| SAFE-02 | Every dispatched target belongs to the exact confirmed review and provider/session context. Changes to selections or context invalidate authorization. | `review-preflight`, review session, command host; state model and real dispatch assertions |
| SAFE-03 | Unknown account identity is never reported as verified. Provider-session-only operation has an explicitly weaker claim and documented policy. | Preflight and provider adapters; contract tests and provider-specific evidence |
| SAFE-04 | Similarity, metadata, thumbnail hashes, and legacy labels cannot establish original-content identity. Verified identity requires the defined provenance contract. | `duplicate-classifier`, scan-result migration; generated evidence and adversarial corpus |
| SAFE-05 | Reported successful targets are a subset of both requested targets and provider-confirmed successful targets. Timeout or an ambiguous response remains unknown until reconciled. | `trash-lifecycle`, result reports, provider adapters; partial responses and fault injection |
| SAFE-06 | Undo targets only confirmed moved items in the matching operation/context; unrelated, stale, duplicated, or reordered responses cannot change that set. | Trash lifecycle and recovery history; generated event sequences and model checking |
| SAFE-07 | A crash, reload, failed persistence, or service-worker restart cannot initiate unconfirmed Trash. Ambiguous in-flight operations require reconciliation before replay. | Audit persistence, recovery, background worker; crash injection at each side effect |
| SAFE-08 | Saved selection migration never turns stale or malformed keeper IDs into unintended automatic Trash. Manual choices remain authoritative. | Decision memory and review serialization; round-trip and migration properties |
| SAFE-09 | Account changes and stale payment responses cannot grant access in another context. Production artifacts cannot enable test entitlement bypass. | Paid-access lifecycle, server verification, package audit; production-build tests |
| SAFE-10 | Untrusted page messages cannot trigger unauthorized provider operations or expose sensitive data. | Command host, background messaging, manifest; sender/schema validation and network assertions |

For SAFE-02, model `Dispatched ⊆ ConfirmedTargets` and require confirmation to bind the context and selection revision. For SAFE-06, model `UndoTargets ⊆ ConfirmedMovedTargets`. Separate automatic keeper safety from explicitly confirmed manual Trash-all.

Original-content hash equality relies on algorithm/collision and provenance assumptions. Do not describe equal hashes as unconditional mathematical proof of byte equality. If byte equality is the required contract, compare trusted original bytes.

## Implementation sequence

### 1. Establish the baseline and traceability

Record commit, dirty patch and untracked source digests, lockfile digest, tool versions, build flags, and timestamp. Preserve current unrelated edits. Run existing typecheck, unit tests, browser integration tests, benchmarks, and production package audit using isolated build outputs where flags differ. Treat live tests separately.

Create a machine-readable registry with property ID, requirement, implementation seam, evidence type, mandatory scope, command, status, and artifact path. Missing evidence is BLOCKED; a counterexample is FAIL. Never infer PASS from a stale log or a skipped test.

### 2. Add generated properties around the real core

Use fast-check with Vitest. Generate empty/large groups, repeated provider identities, invalid hashes, missing metadata, NaN timestamps, legacy records, stale keeper IDs, arbitrary ordering, and provider/account changes. Compare production functions with an independently written small reference model.

Start with 1,000 generated cases per property on pull requests and 10,000 nightly; tune runtime from measurement. Persist the seed, shrink path, and minimized counterexample. Case counts are search budgets, not proof strength or completion criteria.

### 3. Model Trash/Undo concurrency

Write a TLA+ specification covering review, confirmation, preflight, audit persistence, dispatch, provider result, partial result, timeout, account switch, crash/restart, and Undo. Begin with two contexts, two operations, and three distinct items, documenting every finite bound. Include delayed/duplicated replies and mutation between confirmation and dispatch.

Check SAFE-01/02/05/06/07 invariants with TLC. Check progress only under explicit assumptions such as eventual provider response and fair scheduling; permanent offline operation cannot promise eventual success. Expand bounds after the first complete run. A timeout or truncated exploration is BLOCKED.

Replay model traces against the TypeScript lifecycle and adapter boundary. Record remaining abstraction gaps. If an unbounded mathematical theorem is required, add a deductive invariant proof and a separate implementation-refinement argument; finite model checking alone cannot supply either claim.

### 4. Check whether tests catch defects

Use Stryker on safety-critical modules. Seed semantic defects such as bypassing account checks, dropping the last keeper, accepting thumbnail hashes, applying an old response to a new operation, and treating partial success as complete.

Require every designated safety defect to be detected. Triage every surviving critical mutant; distinguish equivalent mutations, uncovered code, and weak assertions. Use an initial 90% non-equivalent mutation target for scoped core code, with no unexplained critical survivors. A percentage alone cannot waive a safety failure.

### 5. Validate the browser and provider boundary

Exercise service-worker suspension, tab closure, two tabs operating concurrently, quota/persistence errors, offline transitions, 429/5xx, malformed responses, and account changes during a batch. Assert command targets and persisted state as well as visible copy.

Run a separate production build with test entitlement disabled. Developer-flag browser tests do not establish production paid-access behavior.

Live Trash/Undo validation must use a dedicated disposable fixture library with known item identities and an independently recorded inventory. Undo is itself under test, so automatic Undo does not make a personal library an appropriate test fixture. Verify final provider state rather than trusting a success toast. The existing live test is gated by `GPD_E2E_ALLOW_TRASH`; its comment claiming safety for any account is not a verification guarantee.

Verify each supported provider separately. Unavailable account identity or restore support must remain an explicit capability/claim limitation.

### 6. Cover detection quality and scale

Maintain a labeled, consented corpus: byte-identical files, recompression, edits, crops, bursts, RAW/JPEG companions, videos, and visually similar unrelated photos. Measure false-positive/false-negative rates by evidence tier, and preserve each discovered false positive as a regression fixture. Zero observed false positives is a corpus result, not a universal guarantee.

Measure 1k/10k/50k-item synthetic libraries on a documented reference machine. Establish measured time, peak-memory, UI responsiveness, cancellation, and recovery budgets before gating regressions. Check keyboard navigation, focus, large text, and clear destructive confirmation in browser journeys.

## Acceptance and execution cadence

- Pull request: typecheck, unit/component/contract tests, generated core properties, small complete model check, affected browser journeys, production flag audit.
- Nightly: larger generated runs/models, scoped mutation testing, fault injection, labeled corpus, performance budgets.
- Release: all mandatory checks against the same source/build identity, production package verification, and dedicated live provider evidence for the claims being released.

Initial coverage target: 95% branch coverage in designated safety modules plus explicit coverage of every authorization and failure transition. Coverage is diagnostic, not proof. Every critical invariant needs positive, negative, and adversarial evidence; every intentional exception needs a narrower claim.

The evidence aggregator must reject missing properties, duplicate IDs, stale or mismatched artifact hashes, nonzero exits, incomplete model exploration, mandatory skips, and absent live gates. Test the aggregator with deliberately invalid evidence.

Report separately: MODEL CHECK, IMPLEMENTATION TESTS, MUTATION CHECK, BROWSER, LIVE PROVIDERS, and RELEASE. Overall PASS requires all mandatory evidence for the stated scope. At this planning stage, overall verification is BLOCKED because fresh implementation and proof evidence have not been produced.

## Tool references

- [fast-check model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/)
- [TLC finite model checking](https://docs.tlapl.us/using%3Atlc%3Astart)
- [Stryker mutation testing](https://stryker-mutator.io/docs/)
