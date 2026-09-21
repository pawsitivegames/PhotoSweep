const mutationOutput =
  process.env.VERIFICATION_MUTATION_DIR ?? "tmp/verification/current/mutation-run"

/**
 * The mutation scope is intentionally limited to the destructive-operation
 * seams. This keeps the result reviewable and prevents unrelated UI or build
 * code from diluting the safety signal.
 */
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: {
    configFile: "vitest.config.ts",
    related: false
  },
  mutate: [
    "lib/trash-lifecycle.ts",
    "lib/trash-dispatch-guard.ts",
    "lib/review-preflight.ts",
    "lib/duplicate-review-session.ts",
    "lib/keep-strategy.ts",
    "scripts/photo-provider-command-host.js"
  ],
  testFiles: [
    "tests/lib/trash-lifecycle.test.ts",
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
    "tests/verification/safety-properties.test.ts",
    "tests/verification/model-conformance.test.ts",
    "tests/verification/fault-boundary.test.ts"
  ],
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: {
    fileName: `${mutationOutput}/stryker-raw.json`
  },
  packageManager: "pnpm",
  concurrency: 1,
  timeoutFactor: 3,
  timeoutMS: 20_000,
  thresholds: {
    high: 90,
    low: 90,
    break: 90
  },
  disableTypeChecks: true,
  ignorePatterns: [
    "/.agents/**",
    "/tmp",
    "/build",
    "/Google-Photos-Toolkit",
    "/test-results",
    "/states"
  ],
  tempDirName: `${mutationOutput}/stryker-tmp`,
  cleanTempDir: "always"
}
