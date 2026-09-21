import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { spawnSync } from "node:child_process"

import { computeSourceFingerprint } from "./source-fingerprint.mjs"
import { classifyTraceReplayResult } from "./trace-replay-status.mjs"
import { chromium } from "@playwright/test"

const root = resolve(process.env.VERIFICATION_ROOT ?? process.cwd())
const scopeOrder = ["fast", "nightly", "release"]
const browserExecutablePath =
  process.env.PHOTOSWEEP_E2E_EXECUTABLE_PATH ?? chromium.executablePath()

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

const args = parseArgs(process.argv.slice(2))
const scope = args.scope ?? process.env.VERIFICATION_SCOPE ?? "fast"
if (!scopeOrder.includes(scope)) {
  throw new Error(`Unknown verification scope: ${scope}`)
}
const runId =
  process.env.VERIFICATION_RUN_ID ??
  `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${process.pid}`
const configuredOutputDirectory =
  args["out-dir"] ?? process.env.VERIFICATION_OUTPUT_DIR
const outputDirectory = resolve(
  root,
  configuredOutputDirectory ?? join("tmp/verification/runs", runId)
)
const archiveDirectory = resolve(
  root,
  args["archive-dir"] ??
    process.env.VERIFICATION_ARCHIVE_DIR ??
    join(
      root,
      "tmp/verification",
      process.env.VERIFICATION_RUN_ID ??
        new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
    )
)
// Every invocation owns a fresh directory. Reusing a previous directory would
// allow a failed command to be paired with a stale PASS artifact. Callers that
// intentionally choose --out-dir must provide a new/empty directory; the
// default is already unique per run.
if (existsSync(outputDirectory) && readdirSync(outputDirectory).length > 0) {
  throw new Error(
    `Verification output directory is not empty; refusing stale evidence reuse: ${relative(root, outputDirectory)}`
  )
}
mkdirSync(outputDirectory, { recursive: true })

const registry = JSON.parse(
  readFileSync(resolve(root, "verification/requirements.json"), "utf8")
)

function runPath(...parts) {
  return relative(root, join(outputDirectory, ...parts)).split("\\").join("/")
}

// The product registry keeps its canonical current-artifact paths for direct
// evidence-engine use. A runner invocation gets a temporary registry clone
// whose paths point into this fresh run directory, so concurrent/archived runs
// remain self-contained and cannot validate one another's files.
const runRegistry = JSON.parse(JSON.stringify(registry))
for (const property of runRegistry.properties ?? []) {
  for (const obligation of property.obligations ?? []) {
    const prefix = "tmp/verification/current/"
    if (obligation.artifact?.startsWith(prefix)) {
      obligation.artifact = runPath(obligation.artifact.slice(prefix.length))
    }
  }
}
const runRegistryPath = runPath("requirements.json")
writeJson(join(outputDirectory, "requirements.json"), runRegistry)

const commands = []
function commandLogPath(label) {
  return join(outputDirectory, `command-${label}.log`)
}

function runCommand(label, executable, commandArgs = [], env = {}) {
  const logPath = commandLogPath(label)
  const startedAt = new Date().toISOString()
  const child = spawnSync(executable, commandArgs, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024
  })
  const output = `${child.stdout ?? ""}${child.stderr ?? ""}`
  writeFileSync(logPath, output)
  const result = {
    label,
    executable,
    args: commandArgs,
    declaredCommand: `${label}: ${executable} ${commandArgs.join(" ")}`,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: child.status ?? 1,
    signal: child.signal ?? null,
    logPath: relative(root, logPath),
    outputBytes: Buffer.byteLength(output)
  }
  commands.push(result)
  return result
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function artifactHash(path) {
  return sha256File(resolve(root, path))
}

function activeObligations() {
  const activeScopes = new Set([scope])
  for (let index = scopeOrder.indexOf(scope) - 1; index >= 0; index -= 1) {
    activeScopes.add(scopeOrder[index])
  }
  return runRegistry.properties.flatMap((property) =>
    property.obligations
      .filter((obligation) => activeScopes.has(obligation.scope))
      .map((obligation) => ({ ...obligation, requirementId: property.id }))
  )
}

function flattenAssertions(report) {
  return (report?.testResults ?? []).flatMap((suite) =>
    (suite.assertionResults ?? []).map((assertion) => ({
      ...assertion,
      suite: suite.name,
      fullName:
        assertion.fullName ??
        [...(assertion.ancestorTitles ?? []), assertion.title].join(" ")
    }))
  )
}

function readVitestReport(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function testArtifact({
  obligation,
  command,
  commandResult,
  rawPath,
  pattern,
  note
}) {
  const raw = readVitestReport(resolve(root, rawPath))
  const assertions = flattenAssertions(raw)
  const matcher = pattern instanceof RegExp ? pattern : new RegExp(pattern)
  const matched = assertions.filter((assertion) => matcher.test(assertion.fullName))
  const passed = matched.filter((assertion) => assertion.status === "passed")
  const status =
    commandResult.exitCode === 0 &&
    matched.length > 0 &&
    matched.length === passed.length
      ? "PASS"
      : "FAIL"
  return {
    schemaVersion: 1,
    id: obligation.id,
    requirementId: obligation.requirementId,
    proofClass: obligation.proofClass,
    kind: obligation.kind,
    status,
    exitCode: status === "PASS" ? 0 : commandResult.exitCode,
    checksRun: matched.length,
    passedAssertions: passed.length,
    failedAssertions: matched.length - passed.length,
    testNames: matched.map((assertion) => assertion.fullName),
    rawReport: rawPath,
    rawReportSha256: existsSync(resolve(root, rawPath))
      ? artifactHash(rawPath)
      : null,
    command,
    commandLog: commandResult.logPath,
    sourceFingerprint: sourceFingerprint.digest,
    ...(note ? { note } : {})
  }
}

function modelArtifact({ obligation, rawPath, result, invariant }) {
  const raw = JSON.parse(readFileSync(resolve(root, rawPath), "utf8"))
  const configuredInvariants = readFileSync(
    resolve(root, "verification/model/TrashLifecycle.cfg"),
    "utf8"
  )
    .split("\n")
    .filter((line) => line.startsWith("INVARIANT "))
    .map((line) => line.slice("INVARIANT ".length).trim())
  const supported = configuredInvariants.includes(invariant)
  const freshResult =
    result?.exitCode === 0 &&
    raw.runId === runId &&
    raw.status === "PASS"
  return {
    schemaVersion: 1,
    id: obligation.id,
    requirementId: obligation.requirementId,
    proofClass: obligation.proofClass,
    kind: obligation.kind,
    status: freshResult && supported ? "PASS" : "FAIL",
    exitCode: freshResult && supported ? 0 : result?.exitCode ?? raw.exitCode ?? 1,
    checksRun: raw.checksRun,
    modelComplete: freshResult && raw.modelComplete === true && supported,
    statesExplored: raw.statesExplored,
    statesGenerated: raw.statesGenerated,
    depth: raw.depth,
    coverageActions: raw.coverageActions,
    coverageCounts: raw.coverageCounts,
    coverageRanges: raw.coverageRanges,
    nonEmptyUndoWitness: raw.nonEmptyUndoWitness,
    invariant,
    configuredInvariants,
    invariantConfigured: supported,
    modelModule: raw.modulePath,
    modelConfig: raw.configPath,
    modelModuleSha256: raw.moduleSha256,
    modelConfigSha256: raw.configSha256,
    rawResult: rawPath,
    rawResultSha256: artifactHash(rawPath),
    rawLog: raw.artifact,
    runId: raw.runId,
    commandExitCode: result?.exitCode ?? null,
    sourceFingerprint: sourceFingerprint.digest,
    proofBoundary:
      "TLC exhausts the declared finite constants and transitions; it does not prove TypeScript refinement or whole-app behavior."
  }
}

function traceReplayArtifact({ obligation, rawPath, result, supported }) {
  const raw = existsSync(resolve(root, rawPath))
    ? JSON.parse(readFileSync(resolve(root, rawPath), "utf8"))
    : null
  const replay = raw?.replay ?? null
  const classification = classifyTraceReplayResult({ raw, result, supported })
  const status = classification.status
  const unsupportedActions = replay?.unsupportedActions ?? []
  return {
    schemaVersion: 1,
    id: obligation.id,
    requirementId: obligation.requirementId,
    proofClass: obligation.proofClass,
    kind: obligation.kind,
    status,
    exitCode: status === "PASS" ? 0 : status === "BLOCKED" ? 2 : result.exitCode || 1,
    checksRun: replay?.counts?.traces ?? 0,
    supportedProjectionStatus: replay?.supportedProjectionStatus ?? "FAIL",
    replayStatus: replay?.status ?? null,
    replayCounts: replay?.counts ?? null,
    coverage: replay?.coverage ?? null,
    unsupportedActions,
    unsupportedReasons: replay?.unsupportedReasons ?? [],
    failureReasons: classification.failureReasons,
    runId: raw?.runId ?? null,
    buildId: raw?.buildId ?? null,
    exportManifest: raw?.export?.manifestPath ?? null,
    exportManifestSha256: raw?.export?.manifestSha256 ?? null,
    replayReport: replay?.reportPath ?? null,
    replayReportSha256: replay?.reportSha256 ?? null,
    rawResult: rawPath,
    rawResultSha256: existsSync(resolve(root, rawPath))
      ? artifactHash(rawPath)
      : null,
    command: "pnpm test:model-replay",
    commandLog: result.logPath,
    sourceFingerprint: sourceFingerprint.digest,
    ...(status === "BLOCKED"
      ? {
          message:
            unsupportedActions.length > 0
              ? `Replay retains unsupported action seams: ${unsupportedActions.join(", ")}.`
              : raw?.proofBoundary ?? "Trace replay did not produce a supported projection."
        }
      : {}),
    proofBoundary:
      supported
        ? "PASS covers only the bounded supported TypeScript projection. Unsupported model actions remain a separate mandatory blocker."
        : "BLOCKED records unsupported timeout/request identity, crossed-pair, or other adapter seams; it is not treated as a replay pass."
  }
}

function modelRawPath() {
  return runPath("model-run", "model.json")
}

function makeBlockedArtifact(obligation, message, command) {
  return {
    schemaVersion: 1,
    id: obligation.id,
    requirementId: obligation.requirementId,
    proofClass: obligation.proofClass,
    kind: obligation.kind,
    status: "BLOCKED",
    exitCode: 2,
    checksRun: 0,
    mandatorySkip: false,
    message,
    command,
    sourceFingerprint: sourceFingerprint.digest
  }
}

function readJsonIfPresent(path) {
  if (!path || !existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function liveProviderArtifact(obligation, fixture) {
  const evidence = fixture?.evidence
  const roundTripPath = evidence?.roundTrip
    ? resolve(root, evidence.roundTrip)
    : null
  const roundTrip = readJsonIfPresent(roundTripPath)
  const deleteReportPath = roundTrip?.trash?.deleteReport
  const deleteReport = readJsonIfPresent(deleteReportPath)
  const targetPhotoId = roundTrip?.trash?.targetPhotoId
  const providerTrashItemId = roundTrip?.trash?.providerTrashItemId
  const trashItems = Array.isArray(deleteReport?.items)
    ? deleteReport.items.filter((item) => item?.action === "trash")
    : []
  const providerTrashLocationValid =
    roundTrip?.trash?.providerTrashUrl?.includes(targetPhotoId) ||
    (typeof providerTrashItemId === "string" &&
      providerTrashItemId === targetPhotoId)
  const valid =
    fixture?.configured === true &&
    fixture.status === "PASS" &&
    evidence?.syntheticOnly === true &&
    evidence?.itemCount === 6 &&
    evidence?.trashPerformed === true &&
    evidence?.appBuildVerified === true &&
    evidence?.appScanVerified === true &&
    evidence?.appTrashUndoVerified === true &&
    typeof evidence?.account === "string" &&
    evidence.account.length > 0 &&
    typeof evidence?.albumUrl === "string" &&
    typeof evidence?.inventory === "string" &&
    existsSync(resolve(root, evidence.inventory)) &&
    typeof evidence.roundTrip === "string" &&
    typeof evidence.roundTripLedger === "string" &&
    existsSync(resolve(root, evidence.roundTripLedger)) &&
    roundTrip?.schemaVersion === 1 &&
    roundTrip.status === "PASS" &&
    roundTrip.provider === obligation.id.split("-")[1]?.toLowerCase() &&
    roundTrip.account === evidence.account &&
    roundTrip.albumUrl === evidence.albumUrl &&
    roundTrip.preAction?.itemCount === evidence.itemCount &&
    roundTrip.preAction.allItemsSynthetic === true &&
    roundTrip.preAction.scanStatus === "Done" &&
    roundTrip.preAction.checkedCount === evidence.itemCount &&
    roundTrip.preAction.controlsSelected === false &&
    roundTrip.preAction.pairBSelected === false &&
    roundTrip.trash?.selectedCount === 1 &&
    typeof targetPhotoId === "string" &&
    targetPhotoId.length > 0 &&
    typeof roundTrip.trash?.keeperPhotoId === "string" &&
    roundTrip.trash.providerTrashObserved === true &&
    providerTrashLocationValid &&
    roundTrip.restore?.method === "PhotoSweep Undo" &&
    roundTrip.restore.albumItemCountAfterUndo === evidence.itemCount &&
    roundTrip.restore.targetReappearedInAlbum === true &&
    roundTrip.restore.keeperPreserved === true &&
    roundTrip.restore.controlsPreserved === true &&
    roundTrip.restore.freshScanStatus === "Done" &&
    roundTrip.restore.freshCheckedCount === evidence.itemCount &&
    roundTrip.noPermanentDelete === true &&
    deleteReport?.totalGroupsAffected === 1 &&
    deleteReport.totalItemsKept === 1 &&
    deleteReport.totalItemsSelectedForTrash === 1 &&
    trashItems.length === 1 &&
    trashItems[0]?.mediaKey === targetPhotoId

  if (!valid) {
    return makeBlockedArtifact(
      obligation,
      `Recorded ${obligation.command} evidence is missing, stale, or incomplete; live provider PASS requires a validated round-trip artifact.`,
      obligation.command
    )
  }

  return {
    schemaVersion: 1,
    id: obligation.id,
    requirementId: obligation.requirementId,
    proofClass: obligation.proofClass,
    kind: obligation.kind,
    status: "PASS",
    exitCode: 0,
    checksRun: 1,
    manualEvidence: true,
    evidenceSource: evidence.roundTrip,
    command: obligation.command,
    sourceFingerprint: sourceFingerprint.digest,
    message:
      "Validated pre-recorded external evidence for one disposable provider Trash/Undo round trip; this is not a substitute for other provider or production gates."
  }
}

function writeEvidenceArtifact(path, value) {
  writeJson(resolve(root, path), value)
  return {
    artifact: path,
    artifactSha256: artifactHash(path)
  }
}

function buildEntry(artifactPath, artifact) {
  const entry = {
    id: artifact.id,
    requirementId: artifact.requirementId,
    proofClass: artifact.proofClass,
    kind: artifact.kind,
    status: artifact.status,
    exitCode: artifact.exitCode,
    checksRun: artifact.checksRun,
    sourceFingerprint: artifact.sourceFingerprint,
    artifact: artifactPath,
    artifactSha256: artifactHash(artifactPath)
  }
  for (const key of [
    "modelComplete",
    "statesExplored",
    "mutantsTotal",
    "mutantsKilled",
    "criticalSurvivors"
  ]) {
    if (artifact[key] !== undefined) entry[key] = artifact[key]
  }
  if (artifact.message) entry.message = artifact.message
  if (artifact.mandatorySkip !== undefined) entry.mandatorySkip = artifact.mandatorySkip
  return entry
}

function discoverBuildDigest(buildDirectory) {
  const files = []
  function walk(directory) {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  walk(buildDirectory)
  files.sort()
  const hash = createHash("sha256")
  const fileHashes = files.map((path) => {
    const digest = sha256File(path)
    hash.update(relative(root, path))
    hash.update("\0")
    hash.update(digest)
    hash.update("\0")
    return { path: relative(root, path), sha256: digest, bytes: statSync(path).size }
  })
  return {
    directory: relative(root, buildDirectory),
    exists: existsSync(buildDirectory),
    fileCount: fileHashes.length,
    digest: hash.digest("hex"),
    files: fileHashes
  }
}

// Release package evidence must be produced from the same fresh packaging
// pipeline that creates the upload artifact. That pipeline patches the
// Chrome-only fourth version component after Plasmo builds the app.
// Build flags are set explicitly so a test entitlement cannot enter the build.
let buildResult = null
let buildDigest = null
let integrationBuildResult = null
if (scope === "release") {
  buildResult = runCommand("production-package", "npm", ["run", "package:cws"], {
    PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT: "0"
  })
  buildDigest = discoverBuildDigest(resolve(root, "build/chrome-mv3-prod"))
}

// Compute the source baseline after the release build has completed. Generated
// build flags and the production manifest are material inputs, so treating a
// normal build update as "mid-run drift" would invalidate an otherwise fresh
// package result.
const sourceBefore = computeSourceFingerprint(root, registry.sourceRoots)
const sourceFingerprint = sourceBefore
writeJson(join(outputDirectory, "source-before.json"), sourceBefore)
writeJson(join(outputDirectory, "run-metadata.json"), {
  schemaVersion: 1,
  runId,
  scope,
  startedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  sourceFingerprint: sourceBefore.digest,
  registry: runRegistryPath,
  buildCommand: buildResult?.declaredCommand ?? null,
  buildExitCode: buildResult?.exitCode ?? null
})

const propertyRaw = runPath("properties-raw.json")
const propertyCommand = runCommand(
  "properties",
  resolve(root, "node_modules/.bin/vitest"),
  [
    "run",
    "tests/verification/safety-properties.test.ts",
    "tests/verification/model-conformance.test.ts",
    "--reporter=json",
    "--outputFile",
    resolve(root, propertyRaw)
  ],
  {
    FAST_CHECK_NUM_RUNS:
      process.env.FAST_CHECK_NUM_RUNS ??
      (scope === "nightly" || scope === "release" ? "10000" : "1000"),
    VERIFICATION_SCOPE: scope
  }
)

const evidenceEntries = []
const propertyPatterns = {
  "SAFE-01-properties": /SAFE-01\b/,
  "SAFE-02-properties": /SAFE-02\b/,
  "SAFE-03-properties": /SAFE-03\b/,
  "SAFE-04-properties": /SAFE-04\b/,
  "SAFE-05-properties": /SAFE-05\b/,
  "SAFE-06-properties": /SAFE-06\b/,
  "SAFE-08-properties": /SAFE-08\b/,
  "SAFE-09-properties": /SAFE-09\b/
}
for (const obligation of activeObligations().filter((item) => item.kind === "test" && item.id.endsWith("-properties"))) {
  const pattern = propertyPatterns[obligation.id]
  const artifact = testArtifact({
    obligation,
    command: "pnpm test:properties",
    commandResult: propertyCommand,
    rawPath: propertyRaw,
    pattern,
    note:
      "Assertions are selected by their explicit SAFE identifier from the raw Vitest report; aggregate suite counts are not used as proof for another property."
  })
  const artifactPath = runPath(`properties-${obligation.requirementId}.json`)
  writeEvidenceArtifact(artifactPath, artifact)
  evidenceEntries.push(buildEntry(artifactPath, artifact))
}

const modelObligations = activeObligations().filter((item) => item.kind === "model")
let modelCommand = null
if (modelObligations.length > 0) {
  const modelOutputDirectory = runPath("model-run")
  const modelArgs = ["verification/run-tlc.mjs", "--out-dir", modelOutputDirectory]
  // Test-only fault injection lets the end-to-end runner regression prove that
  // a failed fresh TLC command cannot fall back to a pre-existing PASS file.
  if (process.env.VERIFICATION_TLC_JAR) {
    modelArgs.push("--jar", process.env.VERIFICATION_TLC_JAR)
  }
  modelCommand = runCommand(
    "model",
    process.execPath,
    modelArgs,
    { VERIFICATION_SCOPE: scope, VERIFICATION_RUN_ID: runId }
  )
  for (const obligation of modelObligations) {
    const invariant = {
      "SAFE-01-model": "InvKeeperSafety",
      "SAFE-02-model": "InvDispatchBound",
      "SAFE-05-model": "InvReportedDoesNotAuthorize",
      "SAFE-06-model": "InvUndoSubset",
      "SAFE-07-model": "InvNoTrashBeforeDispatch"
    }[obligation.id]
    const rawPath = modelRawPath()
    let artifact
    if (existsSync(resolve(root, rawPath))) {
      artifact = modelArtifact({ obligation, rawPath, result: modelCommand, invariant })
    } else {
      artifact = makeBlockedArtifact(obligation, "TLC did not produce a result artifact.", "pnpm verify:model")
      artifact.status = "FAIL"
      artifact.exitCode = modelCommand.exitCode
    }
    const artifactPath = runPath(`model-${obligation.id.replace(/-model$/, "")}.json`)
    writeEvidenceArtifact(artifactPath, artifact)
    evidenceEntries.push(buildEntry(artifactPath, artifact))
  }
}

const traceReplayObligations = activeObligations().filter((item) =>
  ["MODEL-TRACE-REPLAY-supported", "MODEL-TRACE-REPLAY-gaps"].includes(item.id)
)
if (traceReplayObligations.length > 0) {
  const traceReplayDirectory = runPath("model-trace-replay")
  const traceReplayEnvironment = {
    VERIFICATION_SCOPE: scope,
    VERIFICATION_RUN_ID: runId,
    ...(process.env.VERIFICATION_TLC_JAR
      ? { TLA_TOOLS_JAR: process.env.VERIFICATION_TLC_JAR }
      : {})
  }
  const traceReplayCommand = runCommand(
    "model-trace-replay",
    process.execPath,
    [
      "verification/trace-replay-runner.mjs",
      "--out-dir",
      traceReplayDirectory,
      "--run-id",
      runId,
      "--seed",
      "20260915",
      "--depth",
      "24",
      "--traces",
      "256"
    ],
    traceReplayEnvironment
  )
  const rawPath = runPath("model-trace-replay", "trace-replay-result.json")
  for (const obligation of traceReplayObligations) {
    const artifact = traceReplayArtifact({
      obligation,
      rawPath,
      result: traceReplayCommand,
      supported: obligation.id === "MODEL-TRACE-REPLAY-supported"
    })
    const artifactPath = runPath(
      `model-trace-replay-${obligation.id.endsWith("-supported") ? "supported" : "gaps"}.json`
    )
    writeEvidenceArtifact(artifactPath, artifact)
    evidenceEntries.push(buildEntry(artifactPath, artifact))
  }
}

const evidenceTestObligation = activeObligations().find((item) => item.id === "EVIDENCE-ENGINE-01")
if (evidenceTestObligation) {
  const rawPath = runPath("evidence-engine-raw.json")
  const result = runCommand(
    "evidence-tests",
    resolve(root, "node_modules/.bin/vitest"),
    [
      "run",
      "tests/verification/evidence-engine.test.ts",
      "--reporter=json",
      "--outputFile",
      resolve(root, rawPath)
    ]
  )
  const artifact = testArtifact({
    obligation: evidenceTestObligation,
    command: "pnpm test:evidence",
    commandResult: result,
    rawPath,
    pattern: /^evidence engine integrity /,
    note: "The raw report contains corruption, zero-check, model-incomplete, blocked, mutation-threshold, and empty-registry regressions."
  })
  const artifactPath = runPath("evidence-engine.json")
  writeEvidenceArtifact(artifactPath, artifact)
  evidenceEntries.push(buildEntry(artifactPath, artifact))
}

const baselineObligation = activeObligations().find((item) => item.id === "BASELINE-01")
if (baselineObligation) {
  const statusLines = spawnSync("git", ["status", "--short"], {
    cwd: root,
    encoding: "utf8"
  }).stdout
  const baselinePath = runPath("baseline-inventory.md")
  const baselineText = [
    "# Fresh verification inventory",
    "",
    `Generated: ${new Date().toISOString()}`,
    `HEAD: ${spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim()}`,
    `Scope: ${scope}`,
    `Source fingerprint before gates: ${sourceBefore.digest}`,
    `Source file count: ${sourceBefore.fileCount}`,
    "",
    "## Working-tree snapshot",
    "",
    "```text",
    statusLines.trimEnd(),
    "```",
    "",
    "The dated pre-change baseline is preserved at `tmp/verification/20260915T212410Z/baseline.md` and `baseline-execution.md`. This fresh inventory is additive and does not reclassify concurrent user changes."
  ].join("\n")
  writeFileSync(resolve(root, baselinePath), `${baselineText}\n`)
  const artifact = {
    schemaVersion: 1,
    id: baselineObligation.id,
    requirementId: baselineObligation.requirementId,
    proofClass: baselineObligation.proofClass,
    kind: baselineObligation.kind,
    status: "PASS",
    exitCode: 0,
    checksRun: 1,
    sourceFingerprint: sourceBefore.digest
  }
  evidenceEntries.push(buildEntry(baselinePath, artifact))
}

const nightly = scope === "nightly" || scope === "release"
if (nightly) {
  const boundaryRaw = runPath("boundary-raw.json")
  const boundaryCommand = runCommand(
    "boundary",
    resolve(root, "node_modules/.bin/vitest"),
    [
      "run",
      "tests/verification/fault-boundary.test.ts",
      "--reporter=json",
      "--outputFile",
      resolve(root, boundaryRaw)
    ]
  )
  for (const obligation of activeObligations().filter((item) =>
    ["SAFE-03-provider-contract", "SAFE-07-faults", "SAFE-10-boundary"].includes(item.id)
  )) {
    const artifact = testArtifact({
      obligation,
      command: "pnpm test:boundary",
      commandResult: boundaryCommand,
      rawPath: boundaryRaw,
      pattern: new RegExp(`${obligation.requirementId}\\b`),
      note: "Boundary evidence is derived from the production command-host VM and TrashLifecycle fault tests."
    })
    const artifactPath = runPath(`boundary-${obligation.requirementId}.json`)
    writeEvidenceArtifact(artifactPath, artifact)
    evidenceEntries.push(buildEntry(artifactPath, artifact))
  }

  const corpusObligation = activeObligations().find((item) => item.id === "SAFE-04-corpus")
  if (corpusObligation) {
    const rawPath = runPath("corpus-raw.json")
    const corpusCommand = runCommand(
      "corpus",
      resolve(root, "node_modules/.bin/vitest"),
      [
        "run",
        "tests/verification/corpus-quality.test.ts",
        "--reporter=json",
        "--outputFile",
        resolve(root, rawPath)
      ]
    )
    const artifact = testArtifact({
      obligation: corpusObligation,
      command: "pnpm test:corpus",
      commandResult: corpusCommand,
      rawPath,
      pattern: /^labeled safety corpus /,
      note: "Seven synthetic fixtures cover provenance labels and explicit negative identity cases; no claim is made that they represent a production library."
    })
    const artifactPath = runPath("corpus.json")
    writeEvidenceArtifact(artifactPath, artifact)
    evidenceEntries.push(buildEntry(artifactPath, artifact))
  }

  const perfObligation = activeObligations().find((item) => item.id === "PERF-01")
  if (perfObligation) {
    const performanceRawPath = runPath("performance-raw.json")
    const performanceArtifactPath = runPath("performance.json")
    const performanceCommand = runCommand(
      "performance",
      process.execPath,
      ["verification/run-performance.mjs"],
      { VERIFICATION_PERF_OUTPUT: resolve(root, performanceRawPath) }
    )
    const raw = existsSync(resolve(root, performanceRawPath))
      ? JSON.parse(readFileSync(resolve(root, performanceRawPath), "utf8"))
      : null
    const measurements = raw?.measurements ?? raw?.cases ?? []
    const artifact = {
      schemaVersion: 1,
      id: perfObligation.id,
      requirementId: perfObligation.requirementId,
      proofClass: perfObligation.proofClass,
      kind: perfObligation.kind,
      status: performanceCommand.exitCode === 0 && measurements.length === 3 ? "PASS" : "FAIL",
      exitCode: performanceCommand.exitCode,
      checksRun: measurements.length,
      cases: measurements,
      rawRunner: performanceRawPath,
      command: "pnpm test:bench:verification",
      commandLog: performanceCommand.logPath,
      sourceFingerprint: sourceBefore.digest,
      note: "These are review-plan construction timings for synthetic 1k/10k/50k sets; they do not establish full scanning, browser rendering, or provider performance."
    }
    writeEvidenceArtifact(performanceArtifactPath, artifact)
    evidenceEntries.push(buildEntry(performanceArtifactPath, artifact))
  }

  const mutationObligation = activeObligations().find((item) => item.id === "MUTATION-01")
  if (mutationObligation) {
    const mutationPath = runPath("mutation.json")
    const mutationDirectory = resolve(root, runPath("mutation-run"))
    const mutationCommand = runCommand(
      "mutation",
      process.execPath,
      ["verification/run-mutation.mjs"],
      {
        VERIFICATION_MUTATION_DIR: mutationDirectory,
        VERIFICATION_MUTATION_OUTPUT: resolve(root, mutationPath),
        VERIFICATION_RUN_ID: runId
      }
    )
    let artifact
    if (existsSync(resolve(root, mutationPath))) {
      const freshMutation = JSON.parse(readFileSync(resolve(root, mutationPath), "utf8"))
      const isFresh = freshMutation.runId === runId
      artifact = isFresh
        ? freshMutation
        : {
            schemaVersion: 1,
            status: "FAIL",
            exitCode: mutationCommand.exitCode,
            checksRun: 0,
            message: `Mutation summary runId ${String(freshMutation.runId)} does not match ${runId}.`
          }
      artifact.id = mutationObligation.id
      artifact.requirementId = mutationObligation.requirementId
      artifact.proofClass = mutationObligation.proofClass
      artifact.kind = mutationObligation.kind
      artifact.sourceFingerprint = sourceBefore.digest
      artifact.command = "pnpm test:mutation"
      artifact.commandLog = mutationCommand.logPath
      artifact.checksRun = artifact.checksRun ?? 1
    } else {
      artifact = makeBlockedArtifact(mutationObligation, "Mutation runner produced no summary.", "pnpm test:mutation")
      artifact.status = "FAIL"
      artifact.exitCode = mutationCommand.exitCode
    }
    const artifactPath = mutationPath
    writeEvidenceArtifact(artifactPath, artifact)
    evidenceEntries.push(buildEntry(artifactPath, artifact))
  }
}

if (scope === "release") {
  // Browser boundary tests use the isolated extension harness, including the
  // local-dev entitlement fixture used by deferred Trash authorization tests.
  // The upload candidate must remain production-only, so restore it after the
  // browser checks and before package evidence is recorded.
  integrationBuildResult = runCommand("integration-build", "npm", ["run", "build"], {
    PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT: "1"
  })

  const browserObligation = activeObligations().find((item) => item.id === "SAFE-02-browser")
  if (browserObligation) {
    const browserLog = runPath("browser-dispatch.log")
    const browserCommand = runCommand(
      "browser-dispatch",
      resolve(root, "node_modules/.bin/playwright"),
      [
        "test",
        "--config",
        "playwright.config.ts",
        "tests/e2e/integration/app-tab.test.ts",
        "--grep",
        "dispatch-authorization"
      ]
    )
    writeFileSync(resolve(root, browserLog), readFileSync(resolve(root, browserCommand.logPath), "utf8"))
    const passedMatch = readFileSync(resolve(root, browserCommand.logPath), "utf8").match(/(\d+) passed/)
    const passed = passedMatch ? Number(passedMatch[1]) : 0
    const artifact = {
      schemaVersion: 1,
      id: browserObligation.id,
      requirementId: browserObligation.requirementId,
      proofClass: browserObligation.proofClass,
      kind: browserObligation.kind,
      status:
        integrationBuildResult.exitCode === 0 &&
        browserCommand.exitCode === 0 &&
        passed >= 2
          ? "PASS"
          : "FAIL",
      exitCode:
        integrationBuildResult.exitCode === 0 &&
        browserCommand.exitCode === 0 &&
        passed >= 2
          ? 0
          : browserCommand.exitCode || integrationBuildResult.exitCode || 1,
      checksRun: passed,
      passedTests: passed,
      // The mocked boundary suite uses Playwright's isolated Chromium. Live
      // provider journeys are separately run through the user's Aside session.
      executablePath: browserExecutablePath,
      command: "pnpm test:integration -- --grep dispatch-authorization",
      commandLog: browserCommand.logPath,
      sourceFingerprint: sourceBefore.digest,
      proofBoundary: "Two mocked-provider browser regressions exercise account and selection drift; this is not live provider proof."
    }
    const artifactPath = runPath("browser-dispatch.json")
    writeEvidenceArtifact(artifactPath, artifact)
    evidenceEntries.push(buildEntry(artifactPath, artifact))
  }

  const browserSecurityObligation = activeObligations().find((item) => item.id === "SAFE-10-browser")
  if (browserSecurityObligation) {
    const browserSecurityCommand = runCommand(
      "browser-security",
      resolve(root, "node_modules/.bin/playwright"),
      [
        "test",
        "--config",
        "playwright.config.ts",
        "tests/e2e/integration/security-boundary.test.ts",
        "--grep",
        "security-boundary"
      ]
    )
    const browserSecurityLog = readFileSync(
      resolve(root, browserSecurityCommand.logPath),
      "utf8"
    )
    const passedMatch = browserSecurityLog.match(/(\d+) passed/)
    const passed = passedMatch ? Number(passedMatch[1]) : 0
    const artifact = {
      schemaVersion: 1,
      id: browserSecurityObligation.id,
      requirementId: browserSecurityObligation.requirementId,
      proofClass: browserSecurityObligation.proofClass,
      kind: browserSecurityObligation.kind,
      status: browserSecurityCommand.exitCode === 0 && passed >= 1 ? "PASS" : "FAIL",
      exitCode:
        browserSecurityCommand.exitCode === 0 && passed >= 1
          ? 0
          : browserSecurityCommand.exitCode || 1,
      checksRun: passed,
      passedTests: passed,
      executablePath: browserExecutablePath,
      command: "pnpm test:integration -- tests/e2e/integration/security-boundary.test.ts --grep security-boundary",
      commandLog: browserSecurityCommand.logPath,
      sourceFingerprint: sourceBefore.digest,
      proofBoundary:
        "A real Playwright browser document loads the production command-host script and observes control dispatch while asserting that unauthorized messages never reach a destructive handler; this is a mocked boundary fixture, not live provider proof."
    }
    const artifactPath = runPath("browser-security.json")
    writeEvidenceArtifact(artifactPath, artifact)
    evidenceEntries.push(buildEntry(artifactPath, artifact))
  }

  buildResult = runCommand("production-package-final", "npm", ["run", "package:cws"], {
    PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT: "0"
  })
  buildDigest = discoverBuildDigest(resolve(root, "build/chrome-mv3-prod"))

  const packageObligation = activeObligations().find((item) => item.id === "SAFE-09-package")
  if (packageObligation) {
    const example = readFileSync(resolve(root, ".env.example"), "utf8")
    const envFromExample = Object.fromEntries(
      [...example.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((match) => [match[1], match[2]])
    )
    const packageCommand = runCommand(
      "package-audit",
      process.execPath,
      ["tools/audit-extension-package.mjs"],
      {
        PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL:
          process.env.PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL ??
          envFromExample.PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL,
        PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION:
          process.env.PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION ??
          envFromExample.PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION,
        PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY:
          process.env.PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY ??
          envFromExample.PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY,
        PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT: "0"
      }
    )
    const artifact = {
      schemaVersion: 1,
      id: packageObligation.id,
      requirementId: packageObligation.requirementId,
      proofClass: packageObligation.proofClass,
      kind: packageObligation.kind,
      status: packageCommand.exitCode === 0 && buildResult?.exitCode === 0 ? "PASS" : "FAIL",
      exitCode: packageCommand.exitCode === 0 && buildResult?.exitCode === 0 ? 0 : packageCommand.exitCode || buildResult?.exitCode || 1,
      checksRun: packageCommand.exitCode === 0 && buildResult?.exitCode === 0 ? 1 : 0,
      command: "pnpm audit:extension-package",
      commandLog: packageCommand.logPath,
      buildCommandLog: buildResult?.logPath ?? null,
      buildDigest,
      buildFlags: { allowDevEntitlement: "0" },
      sourceFingerprint: sourceBefore.digest,
      note: "Package evidence binds the fresh production build manifest and every file digest in build/chrome-mv3-prod."
    }
    const artifactPath = runPath("package-audit.json")
    writeEvidenceArtifact(artifactPath, artifact)
    evidenceEntries.push(buildEntry(artifactPath, artifact))
  }

  const fixtureFile = resolve(root, "verification/provider-fixtures.json")
  const fixtures = existsSync(fixtureFile)
    ? JSON.parse(readFileSync(fixtureFile, "utf8"))
    : { providers: [] }
  for (const provider of ["google", "icloud", "amazon"]) {
    const obligation = activeObligations().find((item) => item.id === `LIVE-${provider.toUpperCase()}-01`)
    if (!obligation) continue
    const fixture = fixtures.providers.find((item) => item.provider === provider)
    const artifact = liveProviderArtifact(obligation, fixture)
    const artifactPath = runPath(`live-${provider}.json`)
    writeEvidenceArtifact(artifactPath, { ...artifact, fixture })
    evidenceEntries.push(buildEntry(artifactPath, artifact))
  }
}

// Rebind all entries to the final source state and record any concurrent drift.
const sourceAfter = computeSourceFingerprint(root, registry.sourceRoots)
const sourceDrift = sourceAfter.digest !== sourceBefore.digest
if (sourceDrift) {
  writeJson(join(outputDirectory, "source-drift.json"), {
    before: sourceBefore,
    after: sourceAfter,
    message: "Source changed during verification; evidence is not attributed to an unchanged source tree."
  })
  for (const entry of evidenceEntries) entry.sourceFingerprint = sourceAfter.digest
}
writeJson(join(outputDirectory, "evidence.json"), {
  schemaVersion: 1,
  scope,
  sourceFingerprint: sourceAfter.digest,
  entries: evidenceEntries,
  sourceDrift
})

const evidenceCheck = runCommand(
  "aggregate",
  process.execPath,
  [
    "verification/evidence-engine.mjs",
    "--scope",
    scope,
    "--registry",
    runRegistryPath,
    "--evidence",
    runPath("evidence.json"),
    "--source-fingerprint",
    sourceAfter.digest
  ]
)
const evidenceCheckPath = runPath("aggregate-result.json")
writeJson(resolve(root, evidenceCheckPath), {
  schemaVersion: 1,
  status: evidenceCheck.exitCode === 0 ? "PASS" : evidenceCheck.exitCode === 2 ? "BLOCKED" : "FAIL",
  exitCode: evidenceCheck.exitCode,
  sourceBefore: sourceBefore.digest,
  sourceAfter: sourceAfter.digest,
  sourceDrift,
  evidenceEngineLog: evidenceCheck.logPath,
  commands
})

writeJson(join(outputDirectory, "commands.json"), commands)
writeJson(join(outputDirectory, "verification-summary.json"), {
  schemaVersion: 1,
  runId,
  scope,
  status:
    sourceDrift || evidenceCheck.exitCode === 1
      ? "FAIL"
      : evidenceCheck.exitCode === 2
        ? "BLOCKED"
        : "PASS",
  sourceBefore,
  sourceAfter,
  sourceDrift,
  commandCount: commands.length,
  evidenceEntryCount: evidenceEntries.length,
  evidenceEngineExitCode: evidenceCheck.exitCode,
  outputDirectory: relative(root, outputDirectory),
  registry: runRegistryPath,
  archiveDirectory: relative(root, archiveDirectory),
  buildResult,
  buildDigest
})

if (archiveDirectory !== outputDirectory) {
  mkdirSync(dirname(archiveDirectory), { recursive: true })
  cpSync(outputDirectory, archiveDirectory, { recursive: true })
}

process.stdout.write(
  `${JSON.stringify({
    status:
      sourceDrift || evidenceCheck.exitCode === 1
        ? "FAIL"
        : evidenceCheck.exitCode === 2
          ? "BLOCKED"
          : "PASS",
    scope,
    sourceBefore: sourceBefore.digest,
    sourceAfter: sourceAfter.digest,
    sourceDrift,
    evidenceEntries: evidenceEntries.length,
    commandCount: commands.length,
    archiveDirectory: relative(root, archiveDirectory)
  }, null, 2)}\n`
)
process.exitCode = sourceDrift ? 1 : evidenceCheck.exitCode
