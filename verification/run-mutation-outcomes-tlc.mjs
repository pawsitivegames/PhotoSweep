import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { parseArgs } from "./parse-args.mjs"

const TLC_VERSION = "1.8.0"
const TLC_SHA256 = "7beec0f04818732a62fa193731711a99aa4f11279499b2360a7d156c519ea78d"
const MODULE_PATH = "verification/model/MutationOutcomeRecovery.tla"
const POSITIVE_CONFIG_PATH = "verification/model/MutationOutcomeRecovery.cfg"
const NEGATIVE_CONFIG_PATH = "verification/model/MutationOutcomeRecovery.negative.cfg"
const REQUIRED_ACTIONS = [
  "BeginTrash",
  "DispatchTrashChunk",
  "RecordTrashBatch",
  "TimeoutTrashBatch",
  "FinalizeTrash",
  "BeginRestore",
  "BeginLegacyRestore",
  "PersistRestoreIntent",
  "FailRestoreIntentWrite",
  "DispatchRestoreChunk",
  "RecordRestoreBatch",
  "TimeoutRestoreBatch",
  "FinalizeRestore",
  "PersistProvisionalRecovery",
  "FailRecoveryWrite",
  "PersistRecovery",
  "LateTerminalRestore",
  "RejectLateTerminal",
  "Crash",
  "ReloadRecovery",
  "RetryFailedRestore",
  "CompleteWithoutRestore",
  "FinishAfterReload"
]

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function sha256File(path) {
  return sha256(readFileSync(path))
}

function newestLocalJar(root) {
  const verificationRoot = resolve(root, "tmp/verification")
  if (!existsSync(verificationRoot)) return null
  const candidates = []
  for (const directory of readdirSync(verificationRoot)) {
    const candidate = join(
      verificationRoot,
      directory,
      "tooling",
      `tla2tools-${TLC_VERSION}.jar`
    )
    if (existsSync(candidate)) candidates.push(candidate)
  }
  return candidates.sort().at(-1) ?? null
}

function parseCoverage(output) {
  return Object.fromEntries(
    REQUIRED_ACTIONS.map((action) => {
      const match = output.match(
        new RegExp(`<${action} line[^>]*>:\\s*([0-9]+)(?::([0-9]+))?`)
      )
      return [action, match ? Number(match[2] ?? match[1]) : 0]
    })
  )
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function runTlcOnce({ root, jarPath, outputDirectory, configPath, runId }) {
  const moduleAbsolute = resolve(root, MODULE_PATH)
  const configAbsolute = resolve(root, configPath)
  const logPath = join(outputDirectory, "tlc.log")
  mkdirSync(outputDirectory, { recursive: true })
  const command = [
    "-cp",
    jarPath,
    "tlc2.TLC",
    "-noGenerateSpecTE",
    "-nowarning",
    "-metadir",
    outputDirectory,
    "-coverage",
    "1",
    "-config",
    configAbsolute,
    "-workers",
    "1",
    moduleAbsolute
  ]
  let processResult
  try {
    processResult = spawnSync("java", command, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    })
  } catch (caught) {
    const message = `Java/TLC could not start: ${caught instanceof Error ? caught.message : String(caught)}`
    writeFileSync(logPath, `${message}\n`)
    return {
      status: "BLOCKED",
      runId,
      exitCode: 2,
      checksRun: 0,
      modelComplete: false,
      message,
      artifact: logPath
    }
  }
  const output = `${processResult.stdout ?? ""}${processResult.stderr ?? ""}`
  writeFileSync(logPath, output)
  const generated = output.match(/(\d+) states generated, (\d+) distinct states found/)
  const depth = output.match(/depth of the complete state graph search is (\d+)/)
  return {
    output,
    exitCode: processResult.status ?? 1,
    logPath,
    statesGenerated: generated ? Number(generated[1]) : 0,
    statesExplored: generated ? Number(generated[2]) : 0,
    depth: depth ? Number(depth[1]) : 0,
    coverageCounts: parseCoverage(output)
  }
}

function captureSourceHashes({ root, jarPath }) {
  const runnerPath = fileURLToPath(import.meta.url)
  return {
    moduleSha256: sha256File(resolve(root, MODULE_PATH)),
    runnerSha256: sha256File(runnerPath),
    positiveConfigSha256: sha256File(resolve(root, POSITIVE_CONFIG_PATH)),
    negativeConfigSha256: sha256File(resolve(root, NEGATIVE_CONFIG_PATH)),
    jarSha256: sha256File(jarPath)
  }
}

function expectedSourceBinding({
  configPath,
  outputDirectory,
  runId,
  jarPath,
  sourceHashes
}) {
  return {
    schemaVersion: 1,
    runId,
    modulePath: MODULE_PATH,
    moduleSha256: sourceHashes.moduleSha256,
    configPath,
    configSha256:
      configPath === POSITIVE_CONFIG_PATH
        ? sourceHashes.positiveConfigSha256
        : sourceHashes.negativeConfigSha256,
    runnerPath: "verification/run-mutation-outcomes-tlc.mjs",
    runnerSha256: sourceHashes.runnerSha256,
    jarVersion: TLC_VERSION,
    jarSha256: sourceHashes.jarSha256,
    jarPath,
    outputDirectory
  }
}

function positiveResult({
  root,
  outputDirectory,
  runId,
  jarPath,
  result,
  sourceHashesBefore,
  sourceHashesAfter,
  sourceStable
}) {
  const coverageComplete = REQUIRED_ACTIONS.every(
    (action) => result.coverageCounts?.[action] > 0
  )
  const modelComplete =
    sourceStable &&
    result.exitCode === 0 &&
    /Model checking completed\. No error has been found\./.test(result.output ?? "") &&
    coverageComplete
  const base = expectedSourceBinding({
    configPath: POSITIVE_CONFIG_PATH,
    outputDirectory,
    runId,
    jarPath,
    sourceHashes: sourceHashesBefore
  })
  return {
    ...base,
    id: "SAFE-12-model",
    requirementId: "SAFE-12",
    proofClass: "finite-model",
    kind: "model",
    status: modelComplete ? "PASS" : "FAIL",
    exitCode: modelComplete ? 0 : result.exitCode ?? 1,
    checksRun: 1,
    modelComplete,
    statesGenerated: result.statesGenerated ?? 0,
    statesExplored: result.statesExplored ?? 0,
    depth: result.depth ?? 0,
    requiredActions: REQUIRED_ACTIONS,
    coverageCounts: result.coverageCounts ?? {},
    coverageComplete,
    sourceStable,
    sourceHashesBefore,
    sourceHashesAfter,
    output: result.output,
    artifact: result.logPath
  }
}

function negativeResult({
  root,
  outputDirectory,
  runId,
  jarPath,
  result,
  sourceHashesBefore,
  sourceHashesAfter,
  sourceStable
}) {
  const targetInvariant = "InvRetryOnlyFailed"
  const expectedCounterexampleDetected =
    result.exitCode !== 0 &&
    new RegExp(`Invariant ${targetInvariant} is violated`).test(result.output ?? "") &&
    new RegExp(`State \\d+: <RetryFailedRestore line`).test(result.output ?? "") &&
    sourceStable
  const base = expectedSourceBinding({
    configPath: NEGATIVE_CONFIG_PATH,
    outputDirectory,
    runId,
    jarPath,
    sourceHashes: sourceHashesBefore
  })
  return {
    ...base,
    id: "SAFE-12-negative-control",
    requirementId: "SAFE-12",
    proofClass: "finite-model-negative-control",
    kind: "model",
    status: expectedCounterexampleDetected ? "PASS" : "FAIL",
    // A detected counterexample is the expected successful result of this verifier.
    exitCode: expectedCounterexampleDetected ? 0 : 1,
    checksRun: 1,
    modelComplete: expectedCounterexampleDetected,
    expectedCounterexampleDetected,
    violatedInvariant: expectedCounterexampleDetected ? targetInvariant : null,
    tlcExitCode: result.exitCode,
    statesGenerated: result.statesGenerated ?? 0,
    statesExplored: result.statesExplored ?? 0,
    depth: result.depth ?? 0,
    output: result.output,
    sourceStable,
    sourceHashesBefore,
    sourceHashesAfter,
    artifact: result.logPath
  }
}

export function runMutationOutcomeModels({
  root = process.cwd(),
  jarPath = process.env.TLA_TOOLS_JAR,
  outputDirectory = resolve(root, "tmp/verification/current/mutation-outcomes"),
  runId = process.env.VERIFICATION_RUN_ID ?? null
} = {}) {
  if (existsSync(outputDirectory) && readdirSync(outputDirectory).length > 0) {
    throw new Error(
      `Model output directory is not empty; refusing stale evidence reuse: ${outputDirectory}`
    )
  }
  mkdirSync(outputDirectory, { recursive: true })
  const positiveDirectory = join(outputDirectory, "positive")
  const negativeDirectory = join(outputDirectory, "negative")
  mkdirSync(positiveDirectory, { recursive: true })
  mkdirSync(negativeDirectory, { recursive: true })
  const jarCandidate = jarPath ?? newestLocalJar(root)
  const resolvedJar = jarCandidate ? resolve(root, jarCandidate) : null
  const summaryPath = join(outputDirectory, "mutation-outcomes-model.json")
  const positivePath = join(outputDirectory, "model-SAFE-12.json")
  const negativePath = join(outputDirectory, "negative-SAFE-12.json")

  if (!resolvedJar || !existsSync(resolvedJar) || !statSync(resolvedJar).isFile()) {
    const message = `Pinned TLC ${TLC_VERSION} jar is unavailable or not a file: ${resolvedJar ?? "no local candidate"}`
    writeFileSync(join(positiveDirectory, "tlc.log"), `${message}\n`)
    writeFileSync(join(negativeDirectory, "tlc.log"), `${message}\n`)
    const blocked = {
      status: "BLOCKED",
      runId,
      exitCode: 2,
      checksRun: 0,
      modelComplete: false,
      message,
      artifact: join(outputDirectory, "positive", "tlc.log")
    }
    writeJson(positivePath, { ...blocked, id: "SAFE-12-model", requirementId: "SAFE-12" })
    writeJson(negativePath, {
      ...blocked,
      id: "SAFE-12-negative-control",
      requirementId: "SAFE-12",
      expectedCounterexampleDetected: false
    })
    writeJson(summaryPath, { status: "BLOCKED", runId, positive: positivePath, negative: negativePath })
    return { status: "BLOCKED", exitCode: 2, summaryPath, positivePath, negativePath }
  }

  const actualJarHash = sha256File(resolvedJar)
  if (actualJarHash !== TLC_SHA256) {
    const message = `Pinned TLC jar integrity mismatch: expected ${TLC_SHA256}, got ${actualJarHash}`
    writeFileSync(join(positiveDirectory, "tlc.log"), `${message}\n`)
    writeFileSync(join(negativeDirectory, "tlc.log"), `${message}\n`)
    const failed = {
      status: "FAIL",
      runId,
      exitCode: 1,
      checksRun: 0,
      modelComplete: false,
      message,
      artifact: join(outputDirectory, "positive", "tlc.log"),
      jarPath: resolvedJar,
      jarSha256: actualJarHash
    }
    writeJson(positivePath, { ...failed, id: "SAFE-12-model", requirementId: "SAFE-12" })
    writeJson(negativePath, {
      ...failed,
      id: "SAFE-12-negative-control",
      requirementId: "SAFE-12",
      expectedCounterexampleDetected: false
    })
    writeJson(summaryPath, { status: "FAIL", runId, positive: positivePath, negative: negativePath })
    return { status: "FAIL", exitCode: 1, summaryPath, positivePath, negativePath }
  }

  const sourceHashesBefore = captureSourceHashes({ root, jarPath: resolvedJar })

  const positiveRun = runTlcOnce({
    root,
    jarPath: resolvedJar,
    outputDirectory: positiveDirectory,
    configPath: POSITIVE_CONFIG_PATH,
    runId
  })
  positiveRun.jarPath = resolvedJar
  const sourceHashesAfterPositive = captureSourceHashes({
    root,
    jarPath: resolvedJar
  })
  const positiveSourceStable =
    JSON.stringify(sourceHashesBefore) ===
    JSON.stringify(sourceHashesAfterPositive)

  const sourceHashesBeforeNegative = captureSourceHashes({
    root,
    jarPath: resolvedJar
  })
  const negativeRun = runTlcOnce({
    root,
    jarPath: resolvedJar,
    outputDirectory: negativeDirectory,
    configPath: NEGATIVE_CONFIG_PATH,
    runId
  })
  negativeRun.jarPath = resolvedJar
  const sourceHashesAfter = captureSourceHashes({ root, jarPath: resolvedJar })
  const negativeSourceStable =
    JSON.stringify(sourceHashesBeforeNegative) ===
      JSON.stringify(sourceHashesAfter) &&
    JSON.stringify(sourceHashesAfterPositive) ===
      JSON.stringify(sourceHashesBeforeNegative)
  const sourceStable = positiveSourceStable && negativeSourceStable
  const positiveBound = positiveResult({
    root,
    outputDirectory,
    runId,
    jarPath: resolvedJar,
    result: positiveRun,
    sourceHashesBefore,
    sourceHashesAfter: sourceHashesAfterPositive,
    sourceStable: positiveSourceStable
  })
  const negative = negativeResult({
    root,
    outputDirectory,
    runId,
    jarPath: resolvedJar,
    result: negativeRun,
    sourceHashesBefore: sourceHashesBeforeNegative,
    sourceHashesAfter,
    sourceStable: negativeSourceStable
  })
  writeJson(positivePath, positiveBound)
  writeJson(negativePath, negative)

  const status = positiveBound.status === "PASS" && negative.status === "PASS" ? "PASS" : "FAIL"
  const summary = {
    schemaVersion: 1,
    id: "SAFE-12-model-suite",
    requirementId: "SAFE-12",
    status,
    runId,
    exitCode: status === "PASS" ? 0 : 1,
    checksRun: 2,
    modelComplete: status === "PASS",
    positive: positivePath,
    negative: negativePath,
    sourceStable,
    sourceHashesBefore,
    sourceHashesAfterPositive,
    sourceHashesBeforeNegative,
    sourceHashesAfter,
    positiveStatus: positiveBound.status,
    negativeStatus: negative.status
  }
  writeJson(summaryPath, summary)
  return { ...summary, summaryPath, positivePath, negativePath }
}

if (process.argv[1]?.endsWith("/verification/run-mutation-outcomes-tlc.mjs")) {
  const args = parseArgs(process.argv.slice(2))
  const root = resolve(args.root ?? process.cwd())
  const outputDirectory = resolve(
    root,
    args["out-dir"] ?? `tmp/verification/runs/mutation-outcomes-${Date.now()}`
  )
  const result = runMutationOutcomeModels({
    root,
    jarPath: args.jar,
    outputDirectory,
    runId: process.env.VERIFICATION_RUN_ID ?? null
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.exitCode
}
