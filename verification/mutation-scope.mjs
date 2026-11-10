export const MUTATION_TARGETS = Object.freeze([
  "lib/trash-lifecycle.ts",
  "lib/trash-execution.ts",
  "lib/trash-dispatch-guard.ts",
  "lib/review-preflight.ts",
  "lib/duplicate-review-session.ts",
  "lib/keep-strategy.ts",
  "scripts/photo-provider-command-host.js"
])

export const MUTATION_TEST_FILES = Object.freeze([
  "tests/lib/trash-lifecycle.test.ts",
  "tests/lib/trash-execution.test.ts",
  "tests/lib/trash-dispatch-guard.test.ts",
  "tests/lib/review-preflight.test.ts",
  "tests/lib/keep-strategy.test.ts",
  "tests/lib/keeper-decisions.test.ts",
  "tests/lib/multi-keep.test.ts",
  "tests/lib/decision-memory.test.ts",
  "tests/lib/stored-review-scope.test.ts",
  "tests/lib/review-report.test.ts",
  "tests/lib/duplicate-detector.test.ts",
  "tests/lib/mutation-closure.test.ts",
  "tests/commands/google-photos-commands.test.ts",
  "tests/commands/icloud-photos-commands.test.ts",
  "tests/commands/amazon-photos-commands.test.ts",
  "tests/commands/provider-session-host.test.ts",
  "tests/commands/provider-command-host-injection.test.ts",
  "tests/commands/provider-capability-host.test.ts",
  "tests/verification/safety-properties.test.ts",
  "tests/verification/model-conformance.test.ts",
  "tests/verification/fault-boundary.test.ts"
])
