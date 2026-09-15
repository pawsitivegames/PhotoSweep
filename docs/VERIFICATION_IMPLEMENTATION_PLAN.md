# Verification implementation work plan

Owner: Luna, maximum reasoning effort. Scope: implement the full local verification system described in `RIGOROUS_VERIFICATION_PLAN.md`, then execute it and document external evidence gaps. Preserve pre-existing work. Do not publish or use a personal photo library for destructive testing.

## Ordered deliverables

1. **Baseline and inventory.** Save initial status/diff, source and lockfile fingerprints, versions, and baseline logs under a dated `tmp/verification/` directory. Read repository instructions. Map SAFE-01 through SAFE-10 to actual seams and existing tests. Record existing failures separately.
2. **Executable property registry.** Add versioned machine-readable requirements and evidence schema under `verification/`. Define local, bounded-model, browser, production-package, and live-provider obligations separately. Do not silently weaken the strategy's requirements.
3. **Generated implementation tests.** Install compatible fast-check tooling with lockfile updates. Add meaningful generators and independent oracles for classification, keeper selection, review authorization, migration, Trash outcomes, recovery, and paid/context safety. Exercise production code. Persist reproducible seeds and minimized counterexamples. Fix demonstrated defects with regression evidence.
4. **Formal state model and implementation connection.** Add TLA+ specification/configuration for confirmation, context drift, dispatch, partial/late replies, persistence failure, crashes, and Undo. Provide a reproducible pinned TLC runner with integrity verification. Exhaustively check documented finite configurations. Add executable trace/conformance tests against the production lifecycle. State abstraction limits and remaining refinement obligations; do not call bounded checking an unbounded proof.
5. **Mutation checks.** Configure compatible Stryker tooling for critical modules, with reproducible reports and a scoped threshold. Also demonstrate detection of semantic safety defects identified in the strategy. Investigate critical survivors and improve tests or repair defects; preserve failed evidence.
6. **Boundary and fault tests.** Extend adapter/browser tests for account changes, reordered messages, timeouts, partial replies, restarts, persistence failure, and unauthorized messages. Test production entitlement flags in a production artifact. Provide a safe disposable-fixture contract and inventory checks for each live provider; unavailable live environments remain blocked.
7. **Corpus and performance.** Add deterministic labeled fixtures and quality measurements for supported evidence tiers. Add repeatable 1k/10k/50k synthetic benchmarks and measured budgets with environment metadata. Clearly distinguish synthetic fixtures from a representative real-world corpus. Cover destructive confirmation, keyboard/focus, and large text in browser journeys.
8. **Evidence engine and automation.** Implement a single documented verification entrypoint with fast, nightly, and release scopes. Reject missing/duplicate IDs, stale fingerprints, mandatory skips, incomplete checks, nonzero exits, and unavailable external gates. Test deliberate evidence corruption. Wire appropriate PR/nightly workflows without exposing credentials or running destructive live tests automatically.
9. **Final execution and review.** Execute applicable typecheck, complete unit suite, generated tests, models, mutation checks, browser tests, benchmarks, production build/package audits, and evidence aggregation. Review actual diffs for regressions and preservation of original work. Fix and rerun affected checks. Produce a property-by-property final report with exact logs and scope-specific PASS/FAIL/BLOCKED.

## Working rules

- Implement and verify each phase before moving on; continue independent local work when an external gate is unavailable.
- Production/build-flag mutation and full suites must be serialized when they share generated files. Preserve or isolate build outputs as needed.
- Use current primary documentation to resolve tooling compatibility. Read applicable property-testing, mutation-testing, and verification skills before applying them.
- Keep a durable progress ledger in the evidence directory, including completed deliverables, failures, commands, and next steps.
- Do not stop at scaffolding, instructions to run later, or a first passing subset. Execute all feasible local checks and explicitly enumerate any unfinished deliverables.
- No commits, pushes, publishing, personal-library mutation, invented provider results, or false whole-app proof claims.

## Acceptance

The deliverable is an executable verification system and evidence for the current source, not merely a plan. All SAFE IDs must have implemented checks or explicit blocking evidence. Local success and live-provider/release readiness have separate verdicts. Any unsupported mandatory claim prevents an overall PASS.
