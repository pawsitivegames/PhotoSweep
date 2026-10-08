# Global preferences

## Token efficiency (general practice)

Think thoroughly; act economically. Spend reasoning freely, but minimize expensive
actions. Apply across all projects:

- **Prefer text over images.** Verify with text tools (DOM/page snapshots, console &
  network logs, command output) first. Capture a screenshot/image only when the visual
  itself is the evidence (layout, color, contrast, spacing) -- not as a routine step.
- **Read narrow, search smart.** Locate code with grep/glob or an Explore subagent
  (their file dumps stay in the subagent; only the conclusion returns), then read just
  the needed line ranges -- not whole files. Don't re-read a file just edited.
- **Edit only when required.** No speculative refactors or "while I'm here" cleanups
  beyond the task. Fix what's asked + clearly necessary; skip the rest.
- **Persist, don't re-hold.** Write long-lived output (findings, plans, logs) to a file
  as you go, so context compaction never forces re-reading.
- **Reuse work.** Keep a dev/preview server running and reuse builds when inputs are
  unchanged, instead of rebuilding/restarting per step.
- **Be concise.** Lead with the answer; keep narration proportional to the task.

These optimize cost, not quality -- never skip genuinely needed verification or thinking.

## PhotoSweep maintenance command contract

Keep the existing npm entry points stable. Update `tests/verification/verification-lifecycle.test.ts` with any intentional interface change.

- Local Node is pinned by `.nvmrc` (24); `tools/check-node-version.js` requires Node 22 or newer. CI uses Node 22 for verification and Node 24 for packages.
- Setup from a fresh checkout: `git submodule update --init --recursive`, `npm ci`, then `npm ci` in `Google-Photos-Toolkit`.
- Build with `npm run build`; typecheck with `npm run typecheck`; run unit tests with `npm test` or target a file with `npm test -- --run <test-path>`.
- `npm test` runs the `pretest` hook, which builds GPTK and writes test build flags. `npm run build` runs `prebuild`, which writes flags and prepares GPTK, WASM, and the worker. `npm run typecheck` runs `pretypecheck` to write build flags.
- Run browser integration tests with `npm run test:integration`. Run signed-in provider E2E tests with `npm run test:e2e` only when the configured test browser and account are available.
- Use `npm run verify:all`, `npm run verify:nightly`, and `npm run verify:release` for the fast, nightly, and release verification scopes. Give each run a new, empty `--out-dir` under `tmp/verification/` when preserving evidence.
- `npm run package` builds, runs an internal strict audit, and records the Chrome Web Store artifact. Release workflows must then run `npm run audit:extension-package` to validate the recorded ZIP and provenance sidecar; these are distinct gates. Use the audit command directly only when rechecking an already-created package.
- No `lint` script is defined. Do not invent a substitute check or add a new verification framework to fill that gap.

## Verification and maintenance rules

- Treat every result as bound to its terminal run, exact commit and dirty source, submodule revision, lockfiles, configuration, toolchain, and fixtures. Preserve the registered source-fingerprint roots; change them only with regression tests.
- Never reuse stale or nonterminal results. `PASS` requires fresh accepted evidence; `FAIL` means a checked property failed; `BLOCKED` means a required environment or prerequisite is unavailable; skipped checks are `NOT RUN`.
- Check prerequisites before expensive runs: supported Node, installed root and GPTK dependencies, generated build inputs, a regular pinned TLC JAR with the expected digest, and the required browser executable. Missing or non-file TLC input is `BLOCKED`; an incorrect digest is `FAIL`.
- Default model-backed commands use `tmp/verification/ci-tlc/tooling/tla2tools-1.8.0.jar`. The pinned SHA-256 is `7beec0f04818732a62fa193731711a99aa4f11279499b2360a7d156c519ea78d`; `TLA_TOOLS_JAR` is an explicit path override and does not bypass the checksum check.
- Use bounded retries only after a transient condition is identified or a prerequisite has changed. Record the attempt and distinguish environment failures from product failures. Keep one owner on each mutable verification candidate and use a fresh output directory.
- Preserve failure logs, review evidence, canonical artifacts, and interrupted runs. Clean only scratch owned by the current successful run; do not use broad cleanup commands.
- Keep mocked behavior separate from live provider success and evidence freshness. Provider fixtures must retain absent-field, deleted-object tombstone, and expanded-relationship cases. Mutation waivers require a detected peer and observable behavior equivalence; do not lower thresholds to make a run green.
- Preserve unrelated tracked, staged, and untracked work. Maintenance does not authorize feature work, credentials, commits, pushes, merges, releases, or publication.
