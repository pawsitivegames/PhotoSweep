import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs"
import { join, resolve } from "node:path"

const TRACE_TEST = "tests/verification/model-trace-replay.test.ts"

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith("--")) continue
    const key = value.slice(2)
    args[key] = argv[index + 1]?.startsWith("--") ? true : argv[++index]
  }
  return args
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function runTraceReplay({
  root = process.cwd(),
  outputDirectory = resolve(root, "tmp/verification/trace-replay-run"),
  runId = process.env.VERIFICATION_RUN_ID ?? `trace-replay-${Date.now()}`,
  seed = 20260915,
  depth = 24,
  traces = 256
} = {}) {
  const resolvedRoot = resolve(root)
  const resolvedOutput = resolve(resolvedRoot, outputDirectory)
  mkdirSync(resolvedOutput, { recursive: true })
  if (readdirSync(resolvedOutput).length > 0) {
    throw new Error(
      `Trace replay output directory is not empty: ${resolvedOutput}`
    )
  }

  const testLogPath = join(resolvedOutput, "replay-test.log")
  const testResult = spawnSync(
    resolve(resolvedRoot, "node_modules/.bin/vitest"),
    ["run", TRACE_TEST, "--reporter=verbose"],
    {
      cwd: resolvedRoot,
      env: {
        ...process.env,
        MODEL_TRACE_REPLAY_OUTPUT: resolvedOutput,
        MODEL_TRACE_REPLAY_RUN_ID: runId,
        MODEL_TRACE_REPLAY_SEED: String(seed),
        MODEL_TRACE_REPLAY_DEPTH: String(depth),
        MODEL_TRACE_REPLAY_TRACES: String(traces)
      },
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024
    }
  )
  const testOutput = `${testResult.stdout ?? ""}${testResult.stderr ?? ""}`
  writeFileSync(testLogPath, testOutput)

  const manifestPath = join(resolvedOutput, "trace-manifest.json")
  const replayPath = join(resolvedOutput, "replay-report.json")
  const manifest = isFile(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : null
  const replay = isFile(replayPath)
    ? JSON.parse(readFileSync(replayPath, "utf8"))
    : null
  const supportedProjectionStatus =
    testResult.status === 0 &&
    manifest?.status === "PASS" &&
    replay &&
    ["PASS", "PASS_WITH_UNSUPPORTED"].includes(replay.status) &&
    replay.counts?.fail === 0 &&
    replay.coverage?.complete === true
      ? "PASS"
      : "FAIL"
  const hasUnsupported = Boolean(
    replay &&
      (replay.counts?.unsupported > 0 ||
        replay.status === "PASS_WITH_UNSUPPORTED")
  )
  const status =
    testResult.status !== 0 ||
    manifest?.status !== "PASS" ||
    supportedProjectionStatus !== "PASS"
      ? "FAIL"
      : hasUnsupported
        ? "BLOCKED"
        : "PASS"
  const result = {
    schemaVersion: 1,
    artifactType: "photosweep.tlc-trace-replay-run",
    status,
    exitCode: status === "PASS" ? 0 : status === "BLOCKED" ? 2 : 1,
    runId,
    buildId: manifest?.buildId ?? replay?.provenance?.buildId ?? null,
    source: manifest?.source ?? replay?.provenance?.source ?? null,
    bounds: {
      seed,
      depth,
      tracesRequested: traces,
      workers: 1
    },
    test: {
      command: `vitest run ${TRACE_TEST} --reporter=verbose`,
      exitCode: testResult.status ?? 1,
      signal: testResult.signal ?? null,
      logPath: testLogPath,
      logSha256: sha256File(testLogPath)
    },
    export: {
      manifestPath,
      manifestSha256: isFile(manifestPath) ? sha256File(manifestPath) : null,
      status: manifest?.status ?? null
    },
    replay: {
      reportPath: replayPath,
      reportSha256: isFile(replayPath) ? sha256File(replayPath) : null,
      status: replay?.status ?? null,
      supportedProjectionStatus,
      counts: replay?.counts ?? null,
      coverage: replay?.coverage ?? null,
      unsupportedActions: replay?.unsupportedActions ?? [],
      unsupportedReasons: replay?.unsupportedReasons ?? []
    },
    proofBoundary:
      "This runner reports a bounded imported-TLC supported projection. It covers request-bound timeout, late/stale replies, cancellation, and crossed-pair seams remain outside the abstraction; no unbounded refinement or whole-application theorem is claimed."
  }
  const resultPath = join(resolvedOutput, "trace-replay-result.json")
  writeJson(resultPath, result)
  return { ...result, outputDirectory: resolvedOutput, resultPath }
}

if (process.argv[1]?.endsWith("/verification/trace-replay-runner.mjs")) {
  const args = parseArgs(process.argv.slice(2))
  try {
    const result = runTraceReplay({
      root: resolve(args.root ?? process.cwd()),
      outputDirectory: args["out-dir"] ?? "tmp/verification/trace-replay-run",
      runId: args["run-id"] ?? process.env.VERIFICATION_RUN_ID,
      seed: args.seed === undefined ? 20260915 : Number(args.seed),
      depth: args.depth === undefined ? 24 : Number(args.depth),
      traces: args.traces === undefined ? 256 : Number(args.traces)
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    process.exitCode = result.exitCode
  } catch (caught) {
    process.stderr.write(
      `${caught instanceof Error ? caught.stack : String(caught)}\n`
    )
    process.exitCode = 1
  }
}
