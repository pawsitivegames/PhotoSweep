import { existsSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"

const root = resolve(process.env.VERIFICATION_ROOT ?? process.cwd())
const runs = Math.max(
  1,
  Number.parseInt(
    process.env.FAST_CHECK_NUM_RUNS ??
      (process.env.VERIFICATION_SCOPE === "nightly" ? "10000" : "1000"),
    10
  ) || 1000
)
const outputFile = resolve(
  root,
  process.env.VERIFICATION_PROPERTIES_JSON ??
    "tmp/verification/current/properties-raw.json"
)
mkdirSync(resolve(outputFile, ".."), { recursive: true })

const vitest = resolve(root, "node_modules/.bin/vitest")
if (!existsSync(vitest)) {
  process.stderr.write(`Vitest is unavailable at ${vitest}\n`)
  process.exitCode = 2
} else {
  const result = spawnSync(
    vitest,
    [
      "run",
      "tests/verification/safety-properties.test.ts",
      "tests/verification/mutation-outcome-recovery-refinement.test.ts",
      "tests/verification/mutation-outcome-model-evidence.test.ts",
      "tests/verification/recovery-authority-correspondence-map.test.ts",
      "tests/verification/recovery-authority-model-evidence.test.ts",
      "tests/verification/recovery-capacity.test.ts",
      "tests/verification/model-conformance.test.ts",
      "tests/lib/provider-session-binding.test.ts",
      "tests/commands/provider-session-host.test.ts",
      "tests/lib/stored-review-scope.test.ts",
      "tests/lib/provider-review-storage.test.ts",
      "tests/lib/provider-operations.test.ts",
      "tests/lib/provider-retrieval.test.ts",
      "tests/lib/trash-lifecycle.test.ts",
      "tests/lib/recovery-history.test.ts",
      "tests/lib/recovery-history-capacity.test.ts",
      "tests/lib/scan-coverage.test.ts",
      "tests/lib/scan-results.test.ts",
      "tests/lib/app-reducer.test.ts",
      "tests/lib/provider-scan-cancellation.test.ts",
      "tests/components/scan-coverage-notice.test.tsx",
      "tests/components/recovery-history-dialog.test.tsx",
      "tests/components/scan-empty-state.test.tsx",
      "tests/components/photo-viewer-modal.test.tsx",
      "tests/verification/live-provider-evidence.test.ts",
      "tests/verification/runner-live-package-binding.test.ts",
      "tests/verification/release-candidate.test.ts",
      "tests/lib/runtime-build-identity.test.ts",
      "tests/tools/cws-artifact.test.ts",
      "tests/lib/privacy-analytics.test.ts",
      "tests/background/service-worker.test.ts",
      "tests/components/scan-config.test.tsx",
      "tests/commands/google-photos-commands.test.ts",
      "tests/commands/icloud-photos-commands.test.ts",
      "tests/commands/amazon-photos-commands.test.ts",
      "--reporter=json",
      "--outputFile",
      outputFile
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        FAST_CHECK_NUM_RUNS: String(runs),
        VERIFICATION_SCOPE: process.env.VERIFICATION_SCOPE ?? "fast"
      },
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    }
  )
  process.stdout.write(result.stdout ?? "")
  process.stderr.write(result.stderr ?? "")
  process.stdout.write(
    `${JSON.stringify({
      status: result.status === 0 ? "PASS" : "FAIL",
      exitCode: result.status ?? 1,
      checksRun: existsSync(outputFile) ? "raw-vitest-report-written" : 0,
      fastCheckRuns: runs,
      rawReport: outputFile
    }, null, 2)}\n`
  )
  process.exitCode = result.status ?? 1
}
