import { availableParallelism } from "node:os"
import {
  MUTATION_TARGETS,
  MUTATION_TEST_FILES
} from "./verification/mutation-scope.mjs"

const mutationOutput =
  process.env.VERIFICATION_MUTATION_DIR ??
  "tmp/verification/current/mutation-run"
const rawMutationConcurrency = process.env.VERIFICATION_MUTATION_CONCURRENCY
const mutationConcurrency =
  rawMutationConcurrency === undefined
    ? Math.min(4, availableParallelism())
    : Number(rawMutationConcurrency)
const incrementalFile = process.env.VERIFICATION_MUTATION_INCREMENTAL_FILE

if (
  !Number.isInteger(mutationConcurrency) ||
  mutationConcurrency < 1 ||
  mutationConcurrency > 4
) {
  throw new Error(
    "VERIFICATION_MUTATION_CONCURRENCY must be an integer between 1 and 4."
  )
}

/**
 * The mutation scope is intentionally limited to the destructive-operation
 * seams. This keeps the result reviewable and prevents unrelated UI or build
 * code from diluting the safety signal.
 */
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: {
    configFile: "vitest.config.mts",
    related: false
  },
  ...(incrementalFile
    ? { incremental: true, incrementalFile }
    : {}),
  mutate: MUTATION_TARGETS,
  testFiles: MUTATION_TEST_FILES,
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: {
    fileName: `${mutationOutput}/stryker-raw.json`
  },
  packageManager: "pnpm",
  concurrency: mutationConcurrency,
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
    "/.chrome-profile/**",
    "/.chrome-live-validation/**",
    "/.claude/settings.local.json",
    "/.env",
    "/.env*.local",
    "/.gp-auth.json",
    "/.plasmo/**",
    "/.vscode/settings.json",
    "/.vscode/tasks.json",
    "/log/**/*.log*",
    "/playwright-report/**",
    "/tmp",
    "/tmp/**",
    "/tmp-live-duplicate-test/**",
    "/venv/**",
    "/build",
    "/Google-Photos-Toolkit",
    // The selected mutation tests do not run TLC; avoid copying its pinned JAR
    // into every disposable worker sandbox.
    "/verification/tooling/tla2tools-1.8.0.jar",
    "/test-results",
    "/states"
  ],
  tempDirName: `${mutationOutput}/stryker-tmp`,
  cleanTempDir: "always"
}
