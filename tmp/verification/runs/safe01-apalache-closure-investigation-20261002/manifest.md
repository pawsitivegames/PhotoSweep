# SAFE-01 Apalache action-closure evidence — 2026-10-02

## Verdict

**PASS — one-step action closure of the full `InvSelectionSafety` predicate** for the finite abstraction and exact query recorded below. Apalache 0.62.3 checked `InvSelectionSafety` as both the initial predicate and invariant, with `Next` as the transition and length 1. This is the inductive step `InvSelectionSafety ∧ Next ⇒ InvSelectionSafety'`. The model's full predicate and every transition action are unchanged in the temporary module; three `TypeOK` subset expressions use an exactly equivalent power-set membership form so Apalache's `TransitionFinder` recognizes the variables' assignments.

This result is **not** an unbounded reachability proof, an implementation-refinement proof, all-provider parity evidence, or a pass of canonical `pnpm verify:all`. `pnpm verify:all` remains **NOT CHECKED**. The existing TLC reachability result remains a separate bounded check. TLC closure remains **BLOCKED** by initial-state enumeration.

## Bound source identities

- Canonical model `verification/model/KeeperSelection.tla`: SHA-256 `aebf558cfee46c37b082d28e09249de663d1232fd35802bb1290ddeda191e0a1`.
- Canonical closure config `verification/model/KeeperSelection.closure.cfg`: SHA-256 `61a9ec47210f11e626659c5355b8288dd630ea8ad685c07a1d78cc684e5129fe`.
- Canonical TLC runner `verification/run-keeper-selection-tlc.mjs`: SHA-256 `a563b22357585313a934d0c791b3f92267aefe874771885e8ba1f1f33c905abf`.
- Equivalent Apalache module SHA-256: `d8e6449bebf69078eb2e0327796f5d91bfb90aad3dc29c2a33b023227113c83f`.
- Positive query config SHA-256: `378d0f4d9102daaf9334045eb07165d8d714de72151a4f2a81a4df5de8ee8b38`; negative config SHA-256: `7311cac94cfe4f72d1fcd40ab815016300c4c704b0a280a5a777407270f86d04`.
- Exact source-to-copy hashes and log hashes are in `COPY-SOURCE-CHECKS.tsv` and `SHA256SUMS`.
- The pre-UI query snapshot was recorded as a 289-file default fingerprint, `23bede660dad0aa56b001a7dcb4e658ea53006645dd77d5d0b3a720ec52fdd08`. A separately registered 290-file snapshot, `0a5f4b9a1b8f52708036e3130e5efcce3a2b6b1c2557402d18df8214617ff0db`, additionally included `docs/PLATFORM_PARITY_PLAN.md`. These are historical context snapshots from before later UI and ledger edits; neither should be treated as the final working-tree fingerprint. The final post-ledger working-tree capture is `source-fingerprints-after-ledger.json`: base HEAD `6cd0af92767a8ae585cc4738fd2fc07f9ae8c23f`, default 289-file fingerprint `4499a4221959b9f1b1b803c832a98b6c99ed5a313888266c103aba0c929df712`, and registered 290-file fingerprint `e7b571bb6674cd3300b19829fe7ee7ae494b6ea8383618d6fce2b4448876ca45`. The proof itself is bound directly to the exact model, equivalent copy, query config/options, and official tool digests above; these broader source fingerprints are checkout context. The final post-ledger working-tree capture is `source-fingerprints-after-ledger.json`: base HEAD `6cd0af92767a8ae585cc4738fd2fc07f9ae8c23f`, default 289-file fingerprint `4499a4221959b9f1b1b803c832a98b6c99ed5a313888266c103aba0c929df712`, and registered 290-file fingerprint `e7b571bb6674cd3300b19829fe7ee7ae494b6ea8383618d6fce2b4448876ca45`. The proof itself is bound directly to the exact model, equivalent copy, query config/options, and official tool digests above; these broader source fingerprints are checkout context.
- Exact transformation: see `source/KeeperSelection.apalache-equivalent.tla` and `source/typeok-equivalence.patch` (patch SHA-256 `003a0169313bc4230effc61c7bf3860a31033a25407f999b852fc6603b3fde7e`).

## Equivalence and full-invariant scope

The only module edits are:

- `includedGroups ⊆ EligibleGroups` → `includedGroups ∈ SUBSET EligibleGroups`
- `reviewedGroups ⊆ EligibleGroups` → `reviewedGroups ∈ SUBSET EligibleGroups`
- `reviewedGroupsAtDispatch ⊆ EligibleGroups` → `reviewedGroupsAtDispatch ∈ SUBSET EligibleGroups`

For each set `X`, `X ⊆ S` iff `X ∈ SUBSET S`. Thus `TypeOK`, `InvSelectionSafety`, and the allowed state set are equivalent. All `Next` disjuncts/actions remain identical. The query checks the aggregate `InvSelectionSafety` conjunction, which contains the complete declared selection safety invariant, including `TypeOK` and each constituent selection safety property. Stuttering preserves any state predicate and does not add a separate closure obligation.

The positive and negative configs bind the same constants and query; only `UnsafeAutoTrash` differs (`FALSE` / `TRUE`). The positive run ended with `The outcome is: NoError`, no error through computation length 1, in 45.212 seconds. The negative control found the expected `bulkDispatchOccurred` safety violation after `Next`, exit 12, in 33.768 seconds.

## Original TransitionFinder diagnostic

On the canonical syntax, Apalache 0.62.3 fails before checking the query: `Assignment error: KeeperSelection.tla:285:6-285:19: includedGroups' is used before it is assigned.` Apalache 0.58.3 reports the same diagnostic. The assignment guide documents that its transition finder recognizes primed equality and membership assignment forms. The set-equivalent `X ∈ SUBSET S` normalization resolved this syntactic extraction limitation without changing the transition relation or invariant semantics.

## TLC initial-state enumeration

The canonical closure config sets `INIT ClosureInit`, where `ClosureInit == InvSelectionSafety`, and checks `Next` against every constituent safety predicate. TLC's log remains at `Computing initial states...` without generating a state. The typed Cartesian assignment space before invariant filtering is about `6 × 27 × 4³ × 2³ × (2¹⁸)³ ≈ 1.49 × 10²¹` valuations: six strategies; 27 `decisionSource` assignments; three subsets of two eligible groups; three booleans/binary counters; and three group-to-subsets-of-six-members functions (each has `64³ = 2¹⁸` valuations). TLC must enumerate typed candidate states before filtering them through the arbitrary invariant initial predicate, which accounts for the stall. This is not an invariant counterexample.

## Tool and artifacts

- Apalache release: **0.62.3**, official GitHub release `https://github.com/apalache-mc/apalache/releases/tag/v0.62.3`.
- Official release archive SHA-256: see `official-artifact.sha256` (`apalache-0.62.3.tgz`, `14482cc91a3184cf5612d304a245c25126c01cf7ef0a8fe9d56bcf174167850e`).
- Extracted `apalache.jar` SHA-256: `bca3f4935953e22c5bc30b2bff3326193021aa5df35d07373e947827a21ffb1f`.
- TLC pin: 1.8.0, SHA-256 `b490f45c1de08e4ff9753259a00338981b9cf464f01ca9e9cd5f19f33cf0bb92`.

## Logs and references

- Positive run: `logs/apalache-0623-indnext-equivalent.log`, plus `runs/positive/` tool log files.
- Expected negative control: `logs/apalache-0623-negative.log`, plus complete trace artifacts in `runs/negative/`.
- Canonical-syntax TransitionFinder failures: `logs/apalache-0623-indnext.log` and `logs/apalache-indnext.log`.
- TLC initial-state stall and process capture: `logs/tlc-original/`.
- Source docs: [Apalache inductive invariant check](https://apalache-mc.org/docs/apalache/running.html), [Apalache assignment recognition](https://apalache-mc.org/docs/apalache/principles/assignments.html), [Lamport on inductive invariants and TLC enumeration](https://lamport.azurewebsites.net/tla/inductive-invariant.pdf), and [Lamport's TLA+ manual](https://lamport.azurewebsites.net/tla/p-manual.pdf).

`COPY-SOURCE-CHECKS.tsv` records matching SHA-256 comparisons for each copied source and log. `SHA256SUMS` covers all files in this directory except itself. Generated positive intermediate formulas are omitted because their directory is 180 MiB; the full CLI and detailed logs, exact input module/config/diff, and all negative counterexample artifacts are retained.
