import { existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const root = resolve(process.env.VERIFICATION_ROOT ?? process.cwd())
const output = resolve(
  root,
  process.env.VERIFICATION_PERF_OUTPUT ??
    "tmp/verification/current/performance.json"
)
mkdirSync(dirname(output), { recursive: true })
const vitest = resolve(root, "node_modules/.bin/vitest")
if (!existsSync(vitest)) {
  process.stderr.write(`Vitest is unavailable at ${vitest}\n`)
  process.exitCode = 2
} else {
  const result = spawnSync(
    vitest,
    [
      "run",
      "tests/verification/performance.test.ts",
      "--reporter=verbose"
    ],
    {
      cwd: root,
      env: { ...process.env, VERIFICATION_PERF_OUTPUT: output },
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    }
  )
  process.stdout.write(result.stdout ?? "")
  process.stderr.write(result.stderr ?? "")
  process.stdout.write(
    `${JSON.stringify({
      status: result.status === 0 && existsSync(output) ? "PASS" : "FAIL",
      exitCode: result.status ?? 1,
      checksRun: existsSync(output) ? 1 : 0,
      artifact: output
    }, null, 2)}\n`
  )
  process.exitCode = result.status ?? 1
}
