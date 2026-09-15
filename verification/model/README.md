# Bounded TrashLifecycle model

`TrashLifecycle.tla` is a finite state model of the destructive review seam. It
uses three provider items, two review contexts, two operation IDs, and two
selection revisions. The bounds are deliberate: they make adversarial reply,
reset, crash, context drift, and duplicate-reply interleavings reproducible
while keeping the TLC run fast enough for local verification.

The model includes both automatic confirmation with a nonempty keeper set and
an explicit `ManualTrashAllConfirm` action. `InvKeeperSafety` proves that an
automatic confirmation never requests a keeper; the manual action is the only
path that may request every bounded item. Provider replies are existentially
nondeterministic subsets, and `ProviderSuccessWithUnknown` injects a foreign
identity only in the negative configuration.

`verification/run-tlc.mjs` pins and hashes TLC, routes all TLC metadir state and
counterexample traces to the run output directory, and requires coverage of
every listed action. It also requires positive `Undo` coverage; because `Undo`
has a `moved # {}` guard, that coverage is a reachable nonempty-moved witness.
`run-tlc-negative.mjs` runs the same module with `UnsafeProvider = TRUE` and
passes only when TLC finds the expected real-model invariant violation.

This is a finite model proof of the specified abstraction. It is not a proof
that the TypeScript implementation refines every model transition, nor a proof
of the whole extension, provider APIs, browser, store, or production account.
The TypeScript scenario tests replay adversarial cases through
`TrashLifecycle`; they are implementation seam tests rather than a formal
trace import or refinement proof.
