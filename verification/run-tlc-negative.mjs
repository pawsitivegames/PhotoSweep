import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, join } from "node:path"

import { runTlc } from "./run-tlc.mjs"

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (!value.startsWith("--")) continue
    const key = value.slice(2)
    args[key] = argv[index + 1]?.startsWith("--") ? true : argv[++index]
  }
  return args
}

export function runNegativeControl({
  root = process.cwd(),
  outputDirectory = resolve(root, "tmp/verification/current")
} = {}) {
  mkdirSync(outputDirectory, { recursive: true })
  const tlc = runTlc({
    root,
    outputDirectory,
    modulePath: "verification/model/TrashLifecycle.tla",
    configPath: "verification/model/TrashLifecycle.negative.cfg"
  })
  const log = existsSync(tlc.logPath) ? readFileSync(tlc.logPath, "utf8") : ""
  const detected =
    /Invariant .* is violated/.test(log) ||
    /Error: Invariant/.test(log) ||
    /Error: The invariant/.test(log)
  const result = {
    status: detected ? "PASS" : "FAIL",
    negativeControlDetected: detected,
    expectedTlcStatus: "FAIL",
    tlcStatus: tlc.status,
    checksRun: 1,
    modelComplete: detected,
    statesExplored: tlc.statesExplored ?? 0,
    artifact: tlc.logPath,
    message: detected
      ? "Unsafe pre-dispatch mutation produced the expected TLC invariant counterexample."
      : "Negative control did not produce the expected invariant counterexample."
  }
  const resultPath = join(outputDirectory, "model-counterexample.json")
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`)
  return { ...result, resultPath, exitCode: detected ? 0 : 1 }
}

if (process.argv[1]?.endsWith("/verification/run-tlc-negative.mjs")) {
  const args = parseArgs(process.argv.slice(2))
  const result = runNegativeControl({
    root: process.cwd(),
    outputDirectory: resolve(process.cwd(), args["out-dir"] ?? "tmp/verification/current")
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.exitCode
}
