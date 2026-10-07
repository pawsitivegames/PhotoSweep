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
import {
  RECOVERY_AUTHORITY_CORRESPONDENCE_PATHS,
  RECOVERY_AUTHORITY_REQUIRED_ACTIONS
} from "./recovery-authority-model-evidence.mjs"

const TLC_VERSION = "1.8.0"
const TLC_SHA256 = "7beec0f04818732a62fa193731711a99aa4f11279499b2360a7d156c519ea78d"
const MODULE_PATH = "verification/model/RecoveryAuthority.tla"
const POSITIVE_CONFIG_PATH = "verification/model/RecoveryAuthority.cfg"
const NEGATIVE_CONFIG_PATH = "verification/model/RecoveryAuthority.negative.cfg"
const CLEAR_NEGATIVE_CONFIG_PATH = "verification/model/RecoveryAuthority.clear-negative.cfg"
const REQUIRED_ACTIONS = RECOVERY_AUTHORITY_REQUIRED_ACTIONS

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
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      candidates.push(candidate)
    }
  }
  return candidates.sort().at(-1) ?? null
}

function parseCoverage(output) {
  return Object.fromEntries(
    REQUIRED_ACTIONS.map((action) => {
      const match = output.match(
        new RegExp(`<${action}[^>]*>:\\s*([0-9]+)(?::([0-9]+))?`)
      )
      return [action, match ? Number(match[2] ?? match[1]) : 0]
    })
  )
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function captureSourceHashes({ root, jarPath }) {
  const runnerPath = fileURLToPath(import.meta.url)
  const hashes = {
    moduleSha256: sha256File(resolve(root, MODULE_PATH)),
    runnerSha256: sha256File(runnerPath),
    positiveConfigSha256: sha256File(resolve(root, POSITIVE_CONFIG_PATH)),
    negativeConfigSha256: sha256File(resolve(root, NEGATIVE_CONFIG_PATH)),
    clearNegativeConfigSha256: sha256File(
      resolve(root, CLEAR_NEGATIVE_CONFIG_PATH)
    ),
    jarSha256: sha256File(jarPath)
  }
  for (const sourcePath of RECOVERY_AUTHORITY_CORRESPONDENCE_PATHS) {
    hashes[`correspondence:${sourcePath}`] = sha256File(resolve(root, sourcePath))
  }
  return hashes
}

function runTlc({ root, jarPath, outputDirectory, configPath }) {
  mkdirSync(outputDirectory, { recursive: true })
  const logPath = join(outputDirectory, "tlc.log")
  let child
  try {
    child = spawnSync(
      "java",
      [
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
        resolve(root, configPath),
        "-workers",
        "1",
        resolve(root, MODULE_PATH)
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 40 * 1024 * 1024 }
    )
  } catch (caught) {
    const message = `Java/TLC could not start: ${caught instanceof Error ? caught.message : String(caught)}`
    writeFileSync(logPath, `${message}\n`)
    return { exitCode: 2, output: message, logPath }
  }
  const output = `${child.stdout ?? ""}${child.stderr ?? ""}`
  writeFileSync(logPath, output)
  const generated = output.match(/(\d+) states generated, (\d+) distinct states found/)
  const depth = output.match(/depth of the complete state graph search is (\d+)/)
  return {
    exitCode: child.status ?? 1,
    output,
    logPath,
    statesGenerated: generated ? Number(generated[1]) : 0,
    statesExplored: generated ? Number(generated[2]) : 0,
    depth: depth ? Number(depth[1]) : 0,
    coverageCounts: parseCoverage(output)
  }
}

function bindingFor(configPath, outputDirectory, runId, jarPath, hashes) {
  const configSha256 =
    configPath === POSITIVE_CONFIG_PATH
      ? hashes.positiveConfigSha256
      : configPath === NEGATIVE_CONFIG_PATH
        ? hashes.negativeConfigSha256
        : hashes.clearNegativeConfigSha256
  return {
    schemaVersion: 1,
    runId,
    modulePath: MODULE_PATH,
    moduleSha256: hashes.moduleSha256,
    configPath,
    configSha256,
    runnerPath: "verification/run-recovery-authority-tlc.mjs",
    runnerSha256: hashes.runnerSha256,
    jarVersion: TLC_VERSION,
    jarSha256: hashes.jarSha256,
    jarPath,
    outputDirectory
  }
}

function blockedArtifact({ id, runId, outputDirectory, message }) {
  const logPath = join(outputDirectory, "tlc.log")
  writeFileSync(logPath, `${message}\n`)
  return {
    schemaVersion: 1,
    id,
    requirementId: "SAFE-12",
    proofClass: id.endsWith("negative-control")
      ? "finite-model-negative-control"
      : "finite-model",
    kind: "model",
    status: "BLOCKED",
    exitCode: 2,
    checksRun: 0,
    modelComplete: false,
    runId,
    message,
    artifact: logPath
  }
}

function positiveArtifact({ runId, result, before, after, stable, binding }) {
  const coverageComplete = REQUIRED_ACTIONS.every(
    (action) => result.coverageCounts?.[action] > 0
  )
  const passed =
    stable &&
    result.exitCode === 0 &&
    /Model checking completed\. No error has been found\./.test(result.output) &&
    coverageComplete
  return {
    ...binding,
    id: "SAFE-12-authority-model",
    requirementId: "SAFE-12",
    proofClass: "finite-service-worker-authority-model",
    kind: "model",
    status: passed ? "PASS" : "FAIL",
    exitCode: passed ? 0 : result.exitCode || 1,
    checksRun: 1,
    modelComplete: passed,
    statesGenerated: result.statesGenerated ?? 0,
    statesExplored: result.statesExplored ?? 0,
    depth: result.depth ?? 0,
    requiredActions: REQUIRED_ACTIONS,
    coverageCounts: result.coverageCounts ?? {},
    coverageComplete,
    sourceStable: stable,
    sourceHashesBefore: before,
    sourceHashesAfter: after,
    output: result.output,
    artifact: result.logPath,
    proofBoundary:
      "Exhaustive finite TLC exploration of two caller slots, two operation/request identities, two targets, one abstract provider/session namespace, one service-worker authority, and a two-entry completed-history pressure bound. BeginPersistGuardAck abstracts durable set, exact readback, and ACK as one transition; worker-boundary tests separately exercise write/readback failures. The model does not prove the concrete worker handler, 21-record retention boundary, arbitrary collection sizes, multiple workers, provider atomicity, or whole-app refinement. Terminal-unknown rows are retained safety rows, while global overlap reservation applies only to active intents."
  }
}

function negativeArtifact({
  id,
  result,
  before,
  after,
  stable,
  binding,
  invariant,
  counterexampleAction,
  proofBoundary
}) {
  const caught =
    stable &&
    result.exitCode === 12 &&
    new RegExp(`Invariant ${invariant} is violated`).test(result.output) &&
    new RegExp(`State \\d+: <${counterexampleAction} line`).test(result.output)
  return {
    ...binding,
    id,
    requirementId: "SAFE-12",
    proofClass: "finite-model-negative-control",
    kind: "model",
    status: caught ? "PASS" : "FAIL",
    exitCode: caught ? 0 : 1,
    checksRun: 1,
    modelComplete: caught,
    expectedCounterexampleDetected: caught,
    violatedInvariant: caught ? invariant : null,
    counterexampleAction: caught ? counterexampleAction : null,
    requiredActions: REQUIRED_ACTIONS,
    coverageCounts: result.coverageCounts ?? {},
    tlcExitCode: result.exitCode,
    statesGenerated: result.statesGenerated ?? 0,
    statesExplored: result.statesExplored ?? 0,
    depth: result.depth ?? 0,
    output: result.output,
    sourceStable: stable,
    sourceHashesBefore: before,
    sourceHashesAfter: after,
    artifact: result.logPath,
    proofBoundary
  }
}

export function runRecoveryAuthorityModels({
  root = process.cwd(),
  jarPath = process.env.TLA_TOOLS_JAR,
  outputDirectory = resolve(root, "tmp/verification/current/recovery-authority"),
  runId = process.env.VERIFICATION_RUN_ID ?? null
} = {}) {
  if (existsSync(outputDirectory) && readdirSync(outputDirectory).length > 0) {
    throw new Error(
      `Model output directory is not empty; refusing stale evidence reuse: ${outputDirectory}`
    )
  }
  const positiveDirectory = join(outputDirectory, "positive")
  const negativeDirectory = join(outputDirectory, "negative")
  const clearNegativeDirectory = join(outputDirectory, "clear-negative")
  mkdirSync(positiveDirectory, { recursive: true })
  mkdirSync(negativeDirectory, { recursive: true })
  mkdirSync(clearNegativeDirectory, { recursive: true })
  const positivePath = join(outputDirectory, "authority-SAFE-12.json")
  const negativePath = join(outputDirectory, "negative-authority-SAFE-12.json")
  const clearNegativePath = join(
    outputDirectory,
    "clear-negative-authority-SAFE-12.json"
  )
  const summaryPath = join(outputDirectory, "recovery-authority-model.json")

  const jarCandidate = jarPath ?? newestLocalJar(root)
  const resolvedJar = jarCandidate ? resolve(root, jarCandidate) : null
  if (!resolvedJar || !existsSync(resolvedJar) || !statSync(resolvedJar).isFile()) {
    const message = `Pinned TLC ${TLC_VERSION} jar is unavailable or not a file: ${resolvedJar ?? "no local candidate"}`
    const positive = blockedArtifact({ id: "SAFE-12-authority-model", runId, outputDirectory: positiveDirectory, message })
    const negative = blockedArtifact({ id: "SAFE-12-authority-negative-control", runId, outputDirectory: negativeDirectory, message })
    const clearNegative = blockedArtifact({ id: "SAFE-12-authority-clear-negative-control", runId, outputDirectory: clearNegativeDirectory, message })
    writeJson(positivePath, positive)
    writeJson(negativePath, negative)
    writeJson(clearNegativePath, clearNegative)
    writeJson(summaryPath, {
      schemaVersion: 1,
      id: "SAFE-12-authority-model-suite",
      requirementId: "SAFE-12",
      status: "BLOCKED",
      exitCode: 2,
      runId,
      positive: positivePath,
      negative: negativePath,
      clearNegative: clearNegativePath
    })
    return { status: "BLOCKED", exitCode: 2, positivePath, negativePath, clearNegativePath, summaryPath }
  }

  const jarHash = sha256File(resolvedJar)
  if (jarHash !== TLC_SHA256) {
    const message = `Pinned TLC jar integrity mismatch: expected ${TLC_SHA256}, got ${jarHash}`
    const positive = blockedArtifact({ id: "SAFE-12-authority-model", runId, outputDirectory: positiveDirectory, message })
    const negative = blockedArtifact({ id: "SAFE-12-authority-negative-control", runId, outputDirectory: negativeDirectory, message })
    const clearNegative = blockedArtifact({ id: "SAFE-12-authority-clear-negative-control", runId, outputDirectory: clearNegativeDirectory, message })
    positive.status = negative.status = "FAIL"
    positive.exitCode = negative.exitCode = 1
    clearNegative.status = "FAIL"
    clearNegative.exitCode = 1
    writeJson(positivePath, positive)
    writeJson(negativePath, negative)
    writeJson(clearNegativePath, clearNegative)
    writeJson(summaryPath, {
      schemaVersion: 1,
      id: "SAFE-12-authority-model-suite",
      requirementId: "SAFE-12",
      status: "FAIL",
      exitCode: 1,
      runId,
      positive: positivePath,
      negative: negativePath,
      clearNegative: clearNegativePath
    })
    return { status: "FAIL", exitCode: 1, positivePath, negativePath, clearNegativePath, summaryPath }
  }

  const before = captureSourceHashes({ root, jarPath: resolvedJar })
  const positiveResult = runTlc({
    root,
    jarPath: resolvedJar,
    outputDirectory: positiveDirectory,
    configPath: POSITIVE_CONFIG_PATH
  })
  const negativeResult = runTlc({
    root,
    jarPath: resolvedJar,
    outputDirectory: negativeDirectory,
    configPath: NEGATIVE_CONFIG_PATH
  })
  const clearNegativeResult = runTlc({
    root,
    jarPath: resolvedJar,
    outputDirectory: clearNegativeDirectory,
    configPath: CLEAR_NEGATIVE_CONFIG_PATH
  })
  const after = captureSourceHashes({ root, jarPath: resolvedJar })
  const stable = JSON.stringify(before) === JSON.stringify(after)

  const positiveBinding = bindingFor(
    POSITIVE_CONFIG_PATH,
    outputDirectory,
    runId,
    resolvedJar,
    before
  )
  const negativeBinding = bindingFor(
    NEGATIVE_CONFIG_PATH,
    outputDirectory,
    runId,
    resolvedJar,
    before
  )
  const clearNegativeBinding = bindingFor(
    CLEAR_NEGATIVE_CONFIG_PATH,
    outputDirectory,
    runId,
    resolvedJar,
    before
  )
  const positive = positiveArtifact({
    runId,
    result: positiveResult,
    before,
    after,
    stable,
    binding: positiveBinding
  })
  const negative = negativeArtifact({
    id: "SAFE-12-authority-negative-control",
    runId,
    result: negativeResult,
    before,
    after,
    stable,
    binding: negativeBinding,
    invariant: "InvActiveIntentGuardRetained",
    counterexampleAction: "PruneCompletedHistory",
    proofBoundary:
      "This unsafe configuration enables deletion of an active intent guard. PASS requires a real TLC counterexample violating InvActiveIntentGuardRetained at PruneCompletedHistory."
  })
  const clearNegative = negativeArtifact({
    id: "SAFE-12-authority-clear-negative-control",
    result: clearNegativeResult,
    before,
    after,
    stable,
    binding: clearNegativeBinding,
    invariant: "InvSafetyRowsRetained",
    counterexampleAction: "ClearRecovery",
    proofBoundary:
      "This unsafe configuration enables ClearRecovery to delete a terminal-unknown safety row. PASS requires a real TLC counterexample violating InvSafetyRowsRetained at ClearRecovery."
  })
  writeJson(positivePath, positive)
  writeJson(negativePath, negative)
  writeJson(clearNegativePath, clearNegative)
  const status =
    positive.status === "PASS" &&
    negative.status === "PASS" &&
    clearNegative.status === "PASS"
      ? "PASS"
      : "FAIL"
  const summary = {
    schemaVersion: 1,
    id: "SAFE-12-authority-model-suite",
    requirementId: "SAFE-12",
    status,
    exitCode: status === "PASS" ? 0 : 1,
    runId,
    checksRun: 3,
    modelComplete: status === "PASS",
    positive: positivePath,
    negative: negativePath,
    clearNegative: clearNegativePath,
    sourceStable: stable,
    sourceHashesBefore: before,
    sourceHashesAfter: after,
    positiveStatesGenerated: positive.statesGenerated,
    positiveStatesExplored: positive.statesExplored,
    positiveDepth: positive.depth,
    positiveCoverageComplete: positive.coverageComplete,
    negativeCounterexampleDetected: negative.expectedCounterexampleDetected,
    clearNegativeCounterexampleDetected: clearNegative.expectedCounterexampleDetected
  }
  writeJson(summaryPath, summary)
  return { ...summary, positivePath, negativePath, clearNegativePath, summaryPath }
}

if (process.argv[1]?.endsWith("/verification/run-recovery-authority-tlc.mjs")) {
  const args = parseArgs(process.argv.slice(2))
  const root = resolve(args.root ?? process.cwd())
  const outputDirectory = resolve(
    root,
    args["out-dir"] ?? `tmp/verification/runs/recovery-authority-${Date.now()}`
  )
  const result = runRecoveryAuthorityModels({
    root,
    jarPath: args.jar,
    outputDirectory,
    runId: process.env.VERIFICATION_RUN_ID ?? null
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.exitCode
}
