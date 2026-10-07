import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { chromium } from "@playwright/test"

import {
  cwsArtifactFileName,
  cwsArtifactMetadataFileName,
  validateCwsArtifactMetadata
} from "../tools/cws-artifact.mjs"
import { validateLiveProviderBinding } from "./live-provider-evidence.mjs"
import {
  MUTATION_OUTCOME_REQUIRED_ACTIONS,
  validateMutationOutcomeModelEvidence
} from "./mutation-outcome-model-evidence.mjs"
import { validateAmazonVideoPlaybackEvidence } from "./amazon-video-playback-evidence.mjs"
import {
  expectedRecoveryAuthorityBinding,
  RECOVERY_AUTHORITY_REQUIRED_ACTIONS,
  validateRecoveryAuthorityModelEvidence
} from "./recovery-authority-model-evidence.mjs"
import { computeSourceFingerprint } from "./source-fingerprint.mjs"
import { classifyTraceReplayResult } from "./trace-replay-status.mjs"

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
const frozenCandidatePath = args["candidate-package"]
if (
  frozenCandidatePath !== undefined &&
  (scope !== "release" || typeof frozenCandidatePath !== "string")
) {
  throw new Error(
    "--candidate-package requires release scope and an explicit hash-named ZIP path"
  )
}
const runId =
  process.env.VERIFICATION_RUN_ID ??
  `${new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")}-${process.pid}`
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
        new Date()
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}Z$/, "Z")
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
  return relative(root, join(outputDirectory, ...parts))
    .split("\\")
    .join("/")
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
  const matched = assertions.filter((assertion) =>
    matcher.test(assertion.fullName)
  )
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
  const modelConfig =
    obligation.id === "SAFE-01-model"
      ? "verification/model/KeeperSelection.cfg"
      : "verification/model/TrashLifecycle.cfg"
  const configuredInvariants = readFileSync(
    resolve(root, modelConfig),
    "utf8"
  )
    .split("\n")
    .filter((line) => line.startsWith("INVARIANT "))
    .map((line) => line.slice("INVARIANT ".length).trim())
  const supported = configuredInvariants.includes(invariant)
  const negativeControlPath = rawPath.replace(
    /safe01-selection\.json$/,
    "safe01-selection-negative.json"
  )
  const negativeControl =
    obligation.id === "SAFE-01-model" &&
    existsSync(resolve(root, negativeControlPath))
      ? JSON.parse(readFileSync(resolve(root, negativeControlPath), "utf8"))
      : null
  const negativeControlPassed =
    obligation.id !== "SAFE-01-model" ||
    (negativeControl?.runId === runId &&
      negativeControl?.id === "SAFE-01-negative-control" &&
      negativeControl?.status === "PASS" &&
      negativeControl?.expectedInvariant ===
        "InvBulkStrategyDoesNotDispatchTrash" &&
      negativeControl?.expectedCounterexampleDetected === true &&
      negativeControl?.expectedAction === "BulkApplyStrategy" &&
      negativeControl?.counterexampleActionDetected === true)
  const freshResult =
    result !== null &&
    raw.runId === runId &&
    raw.status === "PASS" &&
    (obligation.id !== "SAFE-01-model" || raw.modelComplete === true) &&
    (obligation.id !== "SAFE-01-model" ||
      (raw.sourceDrift === false &&
        raw.sourceFingerprintBefore === sourceFingerprint.digest &&
        raw.sourceFingerprintAfter === sourceFingerprint.digest)) &&
    (obligation.id !== "SAFE-01-model" ||
      negativeControlPassed) &&
    (obligation.id !== "SAFE-01-model" || raw.id === obligation.id)
  const safe01Blocked =
    obligation.id === "SAFE-01-model" &&
    supported &&
    result !== null &&
    raw.id === obligation.id &&
    raw.runId === runId &&
    raw.status === "BLOCKED" &&
    raw.sourceDrift === false &&
    raw.sourceFingerprintBefore === sourceFingerprint.digest &&
    raw.sourceFingerprintAfter === sourceFingerprint.digest
  const artifactStatus = safe01Blocked
    ? "BLOCKED"
    : freshResult && supported
      ? "PASS"
      : "FAIL"
  return {
    schemaVersion: 1,
    id: obligation.id,
    requirementId: obligation.requirementId,
    proofClass: obligation.proofClass,
    kind: obligation.kind,
    status: artifactStatus,
    exitCode:
      artifactStatus === "PASS"
        ? 0
        : artifactStatus === "BLOCKED"
          ? 2
          : result?.exitCode ?? raw.exitCode ?? 1,
    checksRun: raw.checksRun,
    modelComplete:
      freshResult &&
      raw.modelComplete === true &&
      supported,
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
    ...(obligation.id === "SAFE-01-model"
      ? {
          negativeControl: {
            status: negativeControl?.status ?? "MISSING",
            expectedInvariant: negativeControl?.expectedInvariant ?? null,
            expectedCounterexampleDetected:
              negativeControl?.expectedCounterexampleDetected ?? false,
            expectedAction: negativeControl?.expectedAction ?? null,
            counterexampleActionDetected:
              negativeControl?.counterexampleActionDetected ?? false,
            rawResult: negativeControlPath,
            rawResultSha256: existsSync(resolve(root, negativeControlPath))
              ? artifactHash(negativeControlPath)
              : null
          }
        }
      : {}),
    modelModule: raw.modulePath,
    modelConfig: raw.configPath ?? modelConfig,
    modelModuleSha256: raw.moduleSha256,
    modelConfigSha256: raw.configSha256,
    rawResult: rawPath,
    rawResultSha256: artifactHash(rawPath),
    rawLog: raw.artifact,
    runId: raw.runId,
    commandExitCode: result?.exitCode ?? null,
    sourceFingerprint: sourceFingerprint.digest,
    proofBoundary:
      obligation.id === "SAFE-01-model"
        ? "TLC exhaustively checks the complete graph reachable from Init under the declared finite constants, including all configured safety invariants and action properties. It does not check arbitrary InvSelectionSafety initial valuations or prove TypeScript refinement or whole-app behavior."
        : "TLC exhaustively checks the declared finite transition model and its reachable states; it does not prove TypeScript refinement or whole-app behavior."
  }
}

function mutationOutcomeModelArtifact({ obligation, rawPath, result }) {
  const raw = readJsonIfPresent(resolve(root, rawPath))
  const isNegativeControl = obligation.id === "SAFE-12-negative-control"
  const modelRunnerPath = "verification/run-mutation-outcomes-tlc.mjs"
  const modelRunnerSource = readFileSync(resolve(root, modelRunnerPath), "utf8")
  const jarVersion = modelRunnerSource.match(
    /const TLC_VERSION = "([^"]+)"/
  )?.[1]
  const jarSha256 = modelRunnerSource.match(
    /const TLC_SHA256 = "([a-f0-9]{64})"/
  )?.[1]
  const modulePath = "verification/model/MutationOutcomeRecovery.tla"
  const positiveConfigPath = "verification/model/MutationOutcomeRecovery.cfg"
  const negativeConfigPath =
    "verification/model/MutationOutcomeRecovery.negative.cfg"
  const expectedBinding = {
    modulePath,
    positiveConfigPath,
    negativeConfigPath,
    runnerPath: modelRunnerPath,
    jarVersion,
    jarSha256,
    moduleSha256: sha256File(resolve(root, modulePath)),
    positiveConfigSha256: sha256File(resolve(root, positiveConfigPath)),
    negativeConfigSha256: sha256File(resolve(root, negativeConfigPath)),
    runnerSha256: sha256File(resolve(root, modelRunnerPath))
  }
  const validation = validateMutationOutcomeModelEvidence({
    obligationId: obligation.id,
    requirementId: obligation.requirementId,
    runId,
    raw,
    expectedBinding
  })
  const sourceHashesStable =
    raw?.sourceStable === true &&
    JSON.stringify(raw.sourceHashesBefore) ===
      JSON.stringify(raw.sourceHashesAfter)
  const freshResult =
    raw?.id === obligation.id &&
    raw.requirementId === obligation.requirementId &&
    raw.runId === runId
  const passed = result?.exitCode === 0 && validation.valid
  const blocked = freshResult && raw.status === "BLOCKED"
  const status = passed ? "PASS" : blocked ? "BLOCKED" : "FAIL"

  return {
    schemaVersion: 1,
    id: obligation.id,
    requirementId: obligation.requirementId,
    proofClass: obligation.proofClass,
    kind: obligation.kind,
    status,
    exitCode:
      status === "PASS" ? 0 : status === "BLOCKED" ? 2 : result?.exitCode || 1,
    checksRun: raw?.checksRun ?? 0,
    modelComplete: raw?.modelComplete === true && passed,
    proofClassDetail: raw?.proofClass ?? null,
    statesGenerated: raw?.statesGenerated ?? 0,
    statesExplored: raw?.statesExplored ?? 0,
    depth: raw?.depth ?? 0,
    requiredActions: raw?.requiredActions ?? MUTATION_OUTCOME_REQUIRED_ACTIONS,
    coverageCounts: raw?.coverageCounts ?? {},
    coverageComplete: raw?.coverageComplete ?? false,
    expectedCounterexampleDetected:
      raw?.expectedCounterexampleDetected ?? false,
    violatedInvariant: raw?.violatedInvariant ?? null,
    sourceStable: sourceHashesStable,
    validationReasons: validation.reasons,
    expectedBinding,
    sourceHashesBefore: raw?.sourceHashesBefore ?? null,
    sourceHashesAfter: raw?.sourceHashesAfter ?? null,
    modelModule: raw?.modulePath ?? null,
    modelConfig: raw?.configPath ?? null,
    modelModuleSha256: raw?.moduleSha256 ?? null,
    modelConfigSha256: raw?.configSha256 ?? null,
    runnerSha256: raw?.runnerSha256 ?? null,
    jarSha256: raw?.jarSha256 ?? null,
    rawResult: rawPath,
    rawResultSha256: existsSync(resolve(root, rawPath))
      ? artifactHash(rawPath)
      : null,
    rawLog: raw?.artifact ?? null,
    runId: raw?.runId ?? null,
    command: obligation.command,
    commandLog: result?.logPath ?? null,
    commandExitCode: result?.exitCode ?? null,
    sourceFingerprint: sourceFingerprint.digest,
    proofBoundary:
      "Finite TLC proof over the declared three-target, two-restore-attempt model; it is separate from the generated TypeScript implementation oracle and does not prove unbounded TypeScript refinement or whole-app behavior."
  }
}

function recoveryAuthorityModelArtifact({ obligation, rawPath, result }) {
  const raw = readJsonIfPresent(resolve(root, rawPath))
  const expectedBinding = expectedRecoveryAuthorityBinding(root)
  const validation = validateRecoveryAuthorityModelEvidence({
    obligationId: obligation.id,
    requirementId: obligation.requirementId,
    runId,
    raw,
    expectedBinding
  })
  const freshResult =
    raw?.id === obligation.id &&
    raw.requirementId === obligation.requirementId &&
    raw.runId === runId
  const passed = result?.exitCode === 0 && validation.valid
  const blocked = freshResult && raw.status === "BLOCKED"
  const status = passed ? "PASS" : blocked ? "BLOCKED" : "FAIL"

  return {
    schemaVersion: 1,
    id: obligation.id,
    requirementId: obligation.requirementId,
    proofClass: obligation.proofClass,
    kind: obligation.kind,
    status,
    exitCode:
      status === "PASS" ? 0 : status === "BLOCKED" ? 2 : result?.exitCode || 1,
    checksRun: raw?.checksRun ?? 0,
    modelComplete: raw?.modelComplete === true && passed,
    proofClassDetail: raw?.proofClass ?? null,
    statesGenerated: raw?.statesGenerated ?? 0,
    statesExplored: raw?.statesExplored ?? 0,
    depth: raw?.depth ?? 0,
    requiredActions:
      raw?.requiredActions ?? RECOVERY_AUTHORITY_REQUIRED_ACTIONS,
    coverageCounts: raw?.coverageCounts ?? {},
    coverageComplete: raw?.coverageComplete ?? false,
    expectedCounterexampleDetected:
      raw?.expectedCounterexampleDetected ?? false,
    violatedInvariant: raw?.violatedInvariant ?? null,
    counterexampleAction: raw?.counterexampleAction ?? null,
    sourceStable: raw?.sourceStable === true,
    validationReasons: validation.reasons,
    expectedBinding,
    sourceHashesBefore: raw?.sourceHashesBefore ?? null,
    sourceHashesAfter: raw?.sourceHashesAfter ?? null,
    modelModule: raw?.modulePath ?? null,
    modelConfig: raw?.configPath ?? null,
    modelModuleSha256: raw?.moduleSha256 ?? null,
    modelConfigSha256: raw?.configSha256 ?? null,
    runnerSha256: raw?.runnerSha256 ?? null,
    jarSha256: raw?.jarSha256 ?? null,
    rawResult: rawPath,
    rawResultSha256: existsSync(resolve(root, rawPath))
      ? artifactHash(rawPath)
      : null,
    rawLog: raw?.artifact ?? null,
    runId: raw?.runId ?? null,
    command: obligation.command,
    commandLog: result?.logPath ?? null,
    commandExitCode: result?.exitCode ?? null,
    sourceFingerprint: sourceFingerprint.digest,
    proofBoundary:
      raw?.proofBoundary ??
      "Finite single-service-worker authority model; exact bounds and abstraction limits are documented by the raw model artifact."
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
    exitCode:
      status === "PASS" ? 0 : status === "BLOCKED" ? 2 : result.exitCode || 1,
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
              : raw?.proofBoundary ??
                "Trace replay did not produce a supported projection."
        }
      : {}),
    proofBoundary: supported
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

function currentPackageBinding(roundTrip, expectedChromeVersion) {
  const artifactSha256 = roundTrip?.artifactSha256
  const buildId = roundTrip?.runtime?.buildId
  const problems = []
  if (
    typeof artifactSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(artifactSha256)
  ) {
    return {
      metadata: null,
      problems: ["live evidence does not contain a valid package ZIP SHA-256"]
    }
  }
  if (typeof buildId !== "string") {
    return {
      metadata: null,
      problems: ["live evidence does not contain the runtime package build ID"]
    }
  }

  let artifactFileName
  try {
    artifactFileName = cwsArtifactFileName(
      expectedChromeVersion,
      artifactSha256
    )
  } catch (error) {
    return {
      metadata: null,
      problems: [error instanceof Error ? error.message : String(error)]
    }
  }
  const metadataPath = resolve(
    root,
    "build",
    cwsArtifactMetadataFileName(artifactFileName)
  )
  const metadata = readJsonIfPresent(metadataPath)
  if (!metadata) {
    return {
      metadata: null,
      problems: [
        `package metadata sidecar is missing: ${relative(root, metadataPath)}`
      ]
    }
  }
  problems.push(
    ...validateCwsArtifactMetadata(metadata, {
      chromeVersion: expectedChromeVersion,
      buildId,
      artifactSha256,
      sourceFingerprint: sourceFingerprint.digest
    })
  )
  if (metadata.sourceFileCount !== sourceFingerprint.fileCount) {
    problems.push(
      "Package source file count does not match the current source fingerprint"
    )
  }
  if (metadata.artifactFile !== join("build", artifactFileName)) {
    problems.push(
      "package metadata artifact path does not match its hash-derived filename"
    )
  }

  const artifactPath = resolve(root, "build", artifactFileName)
  if (!existsSync(artifactPath)) {
    problems.push(`package ZIP is missing: ${relative(root, artifactPath)}`)
  } else if (sha256File(artifactPath) !== artifactSha256) {
    problems.push(
      "package ZIP bytes do not match the recorded artifact SHA-256"
    )
  }
  // A retained hash-named ZIP can have the same source and manifest as a newly
  // rebuilt package while carrying a different runtime build UUID. Evidence
  // must describe the final candidate produced by this release run.
  const currentArtifactPath = resolve(root, "build/chrome-mv3-prod.zip")
  if (!existsSync(currentArtifactPath)) {
    problems.push("current production package ZIP is missing")
  } else if (sha256File(currentArtifactPath) !== artifactSha256) {
    problems.push(
      "live evidence does not match the current production package ZIP"
    )
  }
  const manifestPath = resolve(root, "build/chrome-mv3-prod/manifest.json")
  if (!existsSync(manifestPath)) {
    problems.push("current production manifest is missing")
  } else if (sha256File(manifestPath) !== metadata.manifestSha256) {
    problems.push(
      "package metadata manifest SHA-256 does not match the production manifest"
    )
  }

  return { metadata, problems }
}

function liveProviderArtifact(obligation, fixture) {
  const evidence = fixture?.evidence
  const roundTripPath = evidence?.roundTrip
    ? resolve(root, evidence.roundTrip)
    : null
  const roundTrip = readJsonIfPresent(roundTripPath)
  const extensionManifest = readJsonIfPresent(
    resolve(root, "build/chrome-mv3-prod/manifest.json")
  )
  const packageBinding = currentPackageBinding(
    roundTrip,
    extensionManifest?.version
  )
  const liveBinding = validateLiveProviderBinding({
    evidence,
    roundTrip,
    expectedExtensionVersion: extensionManifest?.version,
    expectedSourceFingerprint: sourceFingerprint.digest,
    expectedBuildId: packageBinding.metadata?.buildId,
    expectedArtifactSha256: packageBinding.metadata?.artifactSha256,
    // Set only from a separate trusted Chrome DevTools extension inventory;
    // runtime/evidence JSON cannot establish its own extension identity.
    trustedDevToolsInventory: process.env
      .PHOTOSWEEP_TRUSTED_DEVTOOLS_EXTENSION_ID
      ? {
          source: "chrome-devtools.list_extensions",
          extensionId: process.env.PHOTOSWEEP_TRUSTED_DEVTOOLS_EXTENSION_ID
        }
      : undefined
  })
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
    // Exact-package destructive records require v2, including runtime build ID
    // and ZIP hash; read-only scenario records cannot authorize this gate.
    roundTrip?.schemaVersion === 2 &&
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
    packageBinding.problems.length === 0 &&
    liveBinding.valid &&
    roundTrip.noPermanentDelete === true &&
    deleteReport?.totalGroupsAffected === 1 &&
    deleteReport.totalItemsKept === 1 &&
    deleteReport.totalItemsSelectedForTrash === 1 &&
    trashItems.length === 1 &&
    trashItems[0]?.mediaKey === targetPhotoId

  if (!valid) {
    return makeBlockedArtifact(
      obligation,
      `Recorded ${obligation.command} evidence is missing, stale, or incomplete; live provider PASS requires a validated round-trip artifact. Package binding failures: ${packageBinding.problems.join("; ") || "none"}. Runtime binding failures: ${liveBinding.problems.join("; ") || "round-trip validation failed"}.`,
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
  if (artifact.mandatorySkip !== undefined)
    entry.mandatorySkip = artifact.mandatorySkip
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
    return {
      path: relative(root, path),
      sha256: digest,
      bytes: statSync(path).size
    }
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
  buildResult = frozenCandidatePath
    ? runCommand("frozen-candidate", process.execPath, [
        "verification/release-candidate.mjs",
        frozenCandidatePath
      ])
    : runCommand("production-package", "npm", ["run", "package:cws"], {
        PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT: "0"
      })
  if (frozenCandidatePath && buildResult.exitCode !== 0) {
    throw new Error(
      `Frozen release candidate validation failed; see ${buildResult.logPath}`
    )
  }
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
    "tests/verification/mutation-outcome-recovery-refinement.test.ts",
    "tests/verification/mutation-outcome-model-evidence.test.ts",
    "tests/background/service-worker.test.ts",
    "tests/verification/recovery-authority-model-evidence.test.ts",
    "tests/verification/recovery-authority-correspondence-map.test.ts",
    "tests/verification/recovery-capacity.test.ts",
    "tests/verification/model-conformance.test.ts",
    "tests/verification/live-provider-evidence.test.ts",
    "tests/verification/runner-live-package-binding.test.ts",
    "tests/verification/release-candidate.test.ts",
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
    "tests/components/scan-config.test.tsx",
    "tests/components/photo-viewer-modal.test.tsx",
    "tests/commands/google-photos-commands.test.ts",
    "tests/commands/icloud-photos-commands.test.ts",
    "tests/commands/amazon-photos-commands.test.ts",
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
  "SAFE-09-properties": /SAFE-09\b/,
  "SAFE-13-properties":
    /SAFE-13 explicitly replaces manual choices, re-includes groups, and reopens changed plans/,
  "SAFE-12-properties": /SAFE-12 refines generated per-target restore states/,
  "SAFE-12-capacity":
    /\[SAFE-12\] recovery evidence capacity|recovery history exact capacity/,
  "SAFE-12-generated-oracle": /\[SAFE-12 generated 2-attempt status oracle\]/,
  "SAFE-12-evidence-binding": /\[SAFE-12 evidence verifier\]/,
  "SAFE-12-authority-correspondence-map":
    /\[SAFE-12 authority correspondence map\]/,
  "SAFE-12-authority-evidence-binding":
    /\[SAFE-12 authority evidence verifier\]/,
  "SAFE-12-worker-authority":
    /serializes independent app callers across the full storage read\/modify\/write|rejects same-scope overlap across separate recovery operations|retains an unresolved restore guard beyond the ordinary history capacity|accepts only an exact target vector for an idempotent terminal update|fails closed on write or readback failure|keeps a provisional guard after terminal set failure|does not reopen a committed terminal target|preserves a terminal vector committed before storage reports an error|retains active guards on clear|fresh worker cannot replay a persisted guard/,
  "PARITY-01-properties":
    /provider operations declares the same capability vocabulary|scan coverage contract|scan coverage notice|provider scan cancellation|describes iCloud provider fetch behavior|reports coverage when GPTK is unavailable|reports coverage when the album media API is unavailable|Google authorization failure|reports exact provider coverage|provider visit limit|CloudKit coverage|loaded-page fallback|CloudKit records toward the visit limit|omits indexed records|Amazon scan coverage|Amazon records toward the visit limit|SCAN_ERROR.*disconnected state|cancels an in-flight Google page|remembers a cancel command|aborts an in-flight Amazon page|aborts an in-flight CloudKit page|labels a paused scan as incomplete/,
  "PARITY-02-properties": /PARITY-02/,
  "PARITY-03-properties": /\[PARITY-03\]/,
  "PARITY-04-properties": /\[PARITY-04\]/,
  "PARITY-05-properties": /\[PARITY-05\]/,
  "PARITY-06-properties": /\[PARITY-06\]/,
  "PARITY-07-properties": /\[PARITY-07\]/,
  "PARITY-08-properties": /\[PARITY-08\]/,
  "PARITY-09-properties":
    /PARITY-09 provider-scoped review storage preserves buckets across generated interleavings|PARITY-09 negative unscoped-key witness|PARITY-09 serializes a newer provider review write behind an in-flight legacy migration/,
  "VIDEO-PLAYBACK-properties": /\[VIDEO-PLAYBACK\]/
}
for (const obligation of activeObligations().filter(
  (item) => item.kind === "test" && Object.hasOwn(propertyPatterns, item.id)
)) {
  const pattern = propertyPatterns[obligation.id]
  const artifact = testArtifact({
    obligation,
    command: "pnpm test:properties",
    commandResult: propertyCommand,
    rawPath: propertyRaw,
    pattern,
    note:
      obligation.id === "SAFE-12-generated-oracle"
        ? "Exhaustively checks the three-target, two-attempt status matrix against an independent transition oracle with JSON reload between attempts; it does not consume TLC traces or claim unbounded TypeScript refinement."
        : obligation.id === "SAFE-12-evidence-binding"
          ? "Rejects stale, misbound, incomplete-coverage, and ineffective-negative-control artifacts before SAFE-12 model evidence is accepted."
          : obligation.id === "SAFE-12-authority-correspondence-map"
            ? "Checks that the finite model registers its declared actions and links them to named current source-test scenarios; this is a static correspondence map, not behavioral refinement proof."
            : obligation.id === "SAFE-12-authority-evidence-binding"
              ? "Rejects wrong model/config/JAR identity, source drift, incomplete action lists, and negative controls without the exact expected invariant/action trace."
              : obligation.id === "SAFE-12-worker-authority"
                ? "Runs the selected current service-worker transaction tests for serialization, exact targets, prewrite/readback failures, terminal persistence ambiguity, overlap, clear retention, and reload replay guards. This is bounded handler test evidence, not provider atomicity or whole-app proof."
                : obligation.id === "VIDEO-PLAYBACK-properties"
                  ? "Selects only tagged provider-adapter and viewer tests from the raw Vitest report. These mocked tests prove the local command/viewer contract and do not prove playback in the exact packaged extension."
                  : "Assertions are selected by their registered property identifier or explicit tag from the raw Vitest report; aggregate suite counts are not used as proof for another property."
  })
  const artifactPath = obligation.artifact
  writeEvidenceArtifact(artifactPath, artifact)
  evidenceEntries.push(buildEntry(artifactPath, artifact))
}

const allModelObligations = activeObligations().filter(
  (item) => item.kind === "model"
)
const mutationOutcomeModelObligations = allModelObligations.filter((item) =>
  ["SAFE-12-model", "SAFE-12-negative-control"].includes(item.id)
)
const recoveryAuthorityModelObligations = allModelObligations.filter((item) =>
  [
    "SAFE-12-authority-model",
    "SAFE-12-authority-negative-control",
    "SAFE-12-authority-clear-negative-control"
  ].includes(item.id)
)
const modelObligations = allModelObligations.filter(
  (item) =>
    !mutationOutcomeModelObligations.includes(item) &&
    !recoveryAuthorityModelObligations.includes(item)
)
let modelCommand = null
if (modelObligations.length > 0) {
  const modelOutputDirectory = runPath("model-run")
  const modelArgs = [
    "verification/run-tlc.mjs",
    "--out-dir",
    modelOutputDirectory
  ]
  // Test-only fault injection lets the end-to-end runner regression prove that
  // a failed fresh TLC command cannot fall back to a pre-existing PASS file.
  if (process.env.VERIFICATION_TLC_JAR) {
    modelArgs.push("--jar", process.env.VERIFICATION_TLC_JAR)
  }
  modelCommand = runCommand("model", process.execPath, modelArgs, {
    VERIFICATION_SCOPE: scope,
    VERIFICATION_RUN_ID: runId
  })
  for (const obligation of modelObligations) {
    const invariant = {
      "SAFE-01-model": "InvSelectionSafety",
      "SAFE-02-model": "InvDispatchBound",
      "SAFE-05-model": "InvReportedDoesNotAuthorize",
      "SAFE-06-model": "InvUndoSubset",
      "SAFE-07-model": "InvNoTrashBeforeDispatch"
    }[obligation.id]
    const rawPath =
      obligation.id === "SAFE-01-model"
        ? runPath("model-run", "safe01-selection.json")
        : modelRawPath()
    let artifact
    if (existsSync(resolve(root, rawPath))) {
      artifact = modelArtifact({
        obligation,
        rawPath,
        result: modelCommand,
        invariant
      })
    } else {
      artifact = makeBlockedArtifact(
        obligation,
        "TLC did not produce a result artifact.",
        "pnpm verify:model"
      )
      artifact.status = "FAIL"
      artifact.exitCode = modelCommand.exitCode
    }
    const artifactPath = runPath(
      `model-${obligation.id.replace(/-model$/, "")}.json`
    )
    writeEvidenceArtifact(artifactPath, artifact)
    evidenceEntries.push(buildEntry(artifactPath, artifact))
  }
}

if (mutationOutcomeModelObligations.length > 0) {
  const modelOutputDirectory = runPath("mutation-outcome-model")
  const modelArgs = [
    "verification/run-mutation-outcomes-tlc.mjs",
    "--out-dir",
    modelOutputDirectory
  ]
  if (process.env.VERIFICATION_TLC_JAR) {
    modelArgs.push("--jar", process.env.VERIFICATION_TLC_JAR)
  }
  const mutationOutcomeModelCommand = runCommand(
    "model-outcomes",
    process.execPath,
    modelArgs,
    { VERIFICATION_SCOPE: scope, VERIFICATION_RUN_ID: runId }
  )
  for (const obligation of mutationOutcomeModelObligations) {
    const isNegativeControl = obligation.id === "SAFE-12-negative-control"
    const rawPath = runPath(
      "mutation-outcome-model",
      isNegativeControl ? "negative-SAFE-12.json" : "model-SAFE-12.json"
    )
    const artifact = mutationOutcomeModelArtifact({
      obligation,
      rawPath,
      result: mutationOutcomeModelCommand
    })
    const artifactPath = runPath(
      isNegativeControl
        ? "model-SAFE-12-negative-control.json"
        : "model-SAFE-12.json"
    )
    writeEvidenceArtifact(artifactPath, artifact)
    evidenceEntries.push(buildEntry(artifactPath, artifact))
  }
}

if (recoveryAuthorityModelObligations.length > 0) {
  const modelOutputDirectory = runPath("recovery-authority-model")
  const modelArgs = [
    "verification/run-recovery-authority-tlc.mjs",
    "--out-dir",
    modelOutputDirectory
  ]
  if (process.env.VERIFICATION_TLC_JAR) {
    modelArgs.push("--jar", process.env.VERIFICATION_TLC_JAR)
  }
  const recoveryAuthorityModelCommand = runCommand(
    "model-recovery-authority",
    process.execPath,
    modelArgs,
    { VERIFICATION_SCOPE: scope, VERIFICATION_RUN_ID: runId }
  )
  const rawFileFor = {
    "SAFE-12-authority-model": "authority-SAFE-12.json",
    "SAFE-12-authority-negative-control": "negative-authority-SAFE-12.json",
    "SAFE-12-authority-clear-negative-control":
      "clear-negative-authority-SAFE-12.json"
  }
  for (const obligation of recoveryAuthorityModelObligations) {
    const rawPath = runPath(
      "recovery-authority-model",
      rawFileFor[obligation.id]
    )
    const artifact = recoveryAuthorityModelArtifact({
      obligation,
      rawPath,
      result: recoveryAuthorityModelCommand
    })
    const artifactPath = obligation.artifact
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

const evidenceTestObligation = activeObligations().find(
  (item) => item.id === "EVIDENCE-ENGINE-01"
)
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

const baselineObligation = activeObligations().find(
  (item) => item.id === "BASELINE-01"
)
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
    [
      "SAFE-03-provider-contract",
      "SAFE-07-faults",
      "SAFE-10-boundary"
    ].includes(item.id)
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

  const corpusObligation = activeObligations().find(
    (item) => item.id === "SAFE-04-corpus"
  )
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

  const perfObligation = activeObligations().find(
    (item) => item.id === "PERF-01"
  )
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
      status:
        performanceCommand.exitCode === 0 && measurements.length === 3
          ? "PASS"
          : "FAIL",
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

  const mutationObligation = activeObligations().find(
    (item) => item.id === "MUTATION-01"
  )
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
        VERIFICATION_RUN_ID: runId,
        VERIFICATION_SOURCE_ROOTS: JSON.stringify(registry.sourceRoots),
        VERIFICATION_MUTATION_TRIAGE_POLICY:
          process.env.VERIFICATION_MUTATION_TRIAGE_POLICY ??
          (existsSync(
            resolve(root, "verification/evidence/mutation-triage-policy.json")
          )
            ? resolve(root, "verification/evidence/mutation-triage-policy.json")
            : "")
      }
    )
    let artifact
    if (existsSync(resolve(root, mutationPath))) {
      const freshMutation = JSON.parse(
        readFileSync(resolve(root, mutationPath), "utf8")
      )
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
      artifact = makeBlockedArtifact(
        mutationObligation,
        "Mutation runner produced no summary.",
        "pnpm test:mutation"
      )
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
  // Preserve the already-tested production candidate while the browser fixture
  // uses a separate dev-entitlement build. Finalization restores these bytes
  // and validates the original ZIP instead of assigning another build UUID.
  const frozenBuildDirectory = join(outputDirectory, "frozen-production-build")
  const generatedFlagsPath = resolve(root, "lib/generated/build-flags.ts")
  const frozenGeneratedFlags = frozenCandidatePath
    ? readFileSync(generatedFlagsPath)
    : null
  if (frozenCandidatePath)
    cpSync(resolve(root, "build/chrome-mv3-prod"), frozenBuildDirectory, {
      recursive: true
    })
  const productionDirectory = resolve(root, "build/chrome-mv3-prod")
  const browserFixtureDirectory = join(outputDirectory, "browser-fixture-build")
  let frozenCandidateRestored = !frozenCandidatePath
  const restoreFrozenCandidate = () => {
    if (frozenCandidateRestored) return
    try {
      if (existsSync(productionDirectory)) {
        try {
          renameSync(productionDirectory, browserFixtureDirectory)
        } catch {
          rmSync(productionDirectory, { recursive: true, force: true })
        }
      }
      if (!existsSync(productionDirectory)) {
        cpSync(frozenBuildDirectory, productionDirectory, { recursive: true })
      }
    } finally {
      writeFileSync(generatedFlagsPath, frozenGeneratedFlags)
    }
    frozenCandidateRestored = true
  }

  try {
    integrationBuildResult = runCommand(
      "integration-build",
      "npm",
      ["run", "build"],
      {
        PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT: "1"
      }
    )

    const browserObligation = activeObligations().find(
      (item) => item.id === "SAFE-02-browser"
    )
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
      writeFileSync(
        resolve(root, browserLog),
        readFileSync(resolve(root, browserCommand.logPath), "utf8")
      )
      const passedMatch = readFileSync(
        resolve(root, browserCommand.logPath),
        "utf8"
      ).match(/(\d+) passed/)
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
        proofBoundary:
          "Two mocked-provider browser regressions exercise account and selection drift; this is not live provider proof."
      }
      const artifactPath = runPath("browser-dispatch.json")
      writeEvidenceArtifact(artifactPath, artifact)
      evidenceEntries.push(buildEntry(artifactPath, artifact))
    }

    const browserSecurityObligation = activeObligations().find(
      (item) => item.id === "SAFE-10-browser"
    )
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
        status:
          browserSecurityCommand.exitCode === 0 && passed >= 1
            ? "PASS"
            : "FAIL",
        exitCode:
          browserSecurityCommand.exitCode === 0 && passed >= 1
            ? 0
            : browserSecurityCommand.exitCode || 1,
        checksRun: passed,
        passedTests: passed,
        executablePath: browserExecutablePath,
        command:
          "pnpm test:integration -- tests/e2e/integration/security-boundary.test.ts --grep security-boundary",
        commandLog: browserSecurityCommand.logPath,
        sourceFingerprint: sourceBefore.digest,
        proofBoundary:
          "A real Playwright browser document loads the production command-host script and observes control dispatch while asserting that unauthorized messages never reach a destructive handler; this is a mocked boundary fixture, not live provider proof."
      }
      const artifactPath = runPath("browser-security.json")
      writeEvidenceArtifact(artifactPath, artifact)
      evidenceEntries.push(buildEntry(artifactPath, artifact))
    }

    if (frozenCandidatePath) {
      restoreFrozenCandidate()
      buildResult = runCommand("frozen-candidate-final", process.execPath, [
        "verification/release-candidate.mjs",
        frozenCandidatePath
      ])
    } else {
      buildResult = runCommand(
        "production-package-final",
        "npm",
        ["run", "package:cws"],
        {
          PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT: "0"
        }
      )
    }
    buildDigest = discoverBuildDigest(resolve(root, "build/chrome-mv3-prod"))
  } finally {
    restoreFrozenCandidate()
  }

  const packageObligation = activeObligations().find(
    (item) => item.id === "SAFE-09-package"
  )
  if (packageObligation) {
    const example = readFileSync(resolve(root, ".env.example"), "utf8")
    const envFromExample = Object.fromEntries(
      [...example.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((match) => [
        match[1],
        match[2]
      ])
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
      status:
        packageCommand.exitCode === 0 && buildResult?.exitCode === 0
          ? "PASS"
          : "FAIL",
      exitCode:
        packageCommand.exitCode === 0 && buildResult?.exitCode === 0
          ? 0
          : packageCommand.exitCode || buildResult?.exitCode || 1,
      checksRun:
        packageCommand.exitCode === 0 && buildResult?.exitCode === 0 ? 1 : 0,
      command: "pnpm audit:extension-package",
      commandLog: packageCommand.logPath,
      buildCommandLog: buildResult?.logPath ?? null,
      buildDigest,
      candidatePackage: frozenCandidatePath ?? null,
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
    const obligation = activeObligations().find(
      (item) => item.id === `LIVE-${provider.toUpperCase()}-01`
    )
    if (!obligation) continue
    const fixture = fixtures.providers.find(
      (item) => item.provider === provider
    )
    const artifact = liveProviderArtifact(obligation, fixture)
    const artifactPath = runPath(`live-${provider}.json`)
    writeEvidenceArtifact(artifactPath, { ...artifact, fixture })
    evidenceEntries.push(buildEntry(artifactPath, artifact))
  }

  const videoPlaybackObligation = activeObligations().find(
    (item) => item.id === "VIDEO-PLAYBACK-live"
  )
  if (videoPlaybackObligation) {
    const suppliedEvidencePath =
      args["amazon-video-playback-evidence"] ??
      process.env.PHOTOSWEEP_AMAZON_VIDEO_PLAYBACK_EVIDENCE
    const validation = validateAmazonVideoPlaybackEvidence({
      evidencePath:
        typeof suppliedEvidencePath === "string" &&
        suppliedEvidencePath.length > 0
          ? resolve(root, suppliedEvidencePath)
          : suppliedEvidencePath,
      expectedPackageDigest:
        buildResult?.exitCode === 0 ? buildDigest : null,
      sourceText: readFileSync(
        resolve(root, "lib/provider-sites.ts"),
        "utf8"
      )
    })
    const artifact = {
      schemaVersion: 1,
      id: videoPlaybackObligation.id,
      requirementId: videoPlaybackObligation.requirementId,
      proofClass: videoPlaybackObligation.proofClass,
      kind: videoPlaybackObligation.kind,
      status: validation.status,
      exitCode: validation.exitCode,
      checksRun: validation.checksRun,
      command: videoPlaybackObligation.command,
      sourceFingerprint: sourceBefore.digest,
      message: validation.message,
      problems: validation.problems,
      evidenceFileSha256: validation.evidenceFileSha256 ?? null,
      packageDigest: validation.packageDigest ?? null,
      expectedMarketplaces: validation.expectedMarketplaces ?? null,
      validatedMarketplaces: validation.validatedMarketplaces ?? 0,
      captures: validation.captures ?? []
    }
    const artifactPath = runPath("video-playback.json")
    writeEvidenceArtifact(artifactPath, artifact)
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
    message:
      "Source changed during verification; evidence is not attributed to an unchanged source tree."
  })
  for (const entry of evidenceEntries)
    entry.sourceFingerprint = sourceAfter.digest
}
writeJson(join(outputDirectory, "evidence.json"), {
  schemaVersion: 1,
  scope,
  sourceFingerprint: sourceAfter.digest,
  entries: evidenceEntries,
  sourceDrift
})

const evidenceCheck = runCommand("aggregate", process.execPath, [
  "verification/evidence-engine.mjs",
  "--scope",
  scope,
  "--registry",
  runRegistryPath,
  "--evidence",
  runPath("evidence.json"),
  "--source-fingerprint",
  sourceAfter.digest
])
const evidenceCheckPath = runPath("aggregate-result.json")
writeJson(resolve(root, evidenceCheckPath), {
  schemaVersion: 1,
  status:
    evidenceCheck.exitCode === 0
      ? "PASS"
      : evidenceCheck.exitCode === 2
        ? "BLOCKED"
        : "FAIL",
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
  `${JSON.stringify(
    {
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
    },
    null,
    2
  )}\n`
)
process.exitCode = sourceDrift ? 1 : evidenceCheck.exitCode
