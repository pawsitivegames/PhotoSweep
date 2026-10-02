import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { computeSourceFingerprint } from "./source-fingerprint.mjs"

const TLC_VERSION = "1.8.0"
const TLC_SHA256 = "20322939d1b55bb0a3f674ab34bb69b87c711a6b35559d32445cb7d7f6d3bb58"
const MODULE_PATH = "verification/model/KeeperSelection.tla"
const CONFIG_PATH = "verification/model/KeeperSelection.cfg"
const CLOSURE_CONFIG_PATH = "verification/model/KeeperSelection.closure.cfg"
const NEGATIVE_CONFIG_PATH = "verification/model/KeeperSelection.negative.cfg"
const NEGATIVE_INVARIANT = "InvBulkStrategyDoesNotDispatchTrash"
const NEGATIVE_ACTION = "BulkApplyStrategy"
const REQUIRED_ACTIONS = [
  "BulkApplyStrategy",
  "ManualChoose",
  "ManualTrashAll",
  "SkipGroup",
  "SelectGroup",
  "ReviewGroup",
  "ConfirmTrash"
]
const REQUIRED_INVARIANTS = [
  "TypeOK",
  "InvExactlyOneKeeper",
  "InvKeeperBelongsToGroup",
  "InvGroupsHaveDisjointMembers",
  "InvTotalRanking",
  "InvStrictRanking",
  "InvAutomaticKeeperIsBest",
  "InvDecisionProvenanceConsistent",
  "InvNoLockedGroupProposal",
  "InvLockedGroupImmutable",
  "InvProposedTrashTargetsAreExact",
  "InvEveryIncludedNonKeeperIsProposed",
  "InvNoKeeperIsProposedForTrash",
  "InvManualTrashAllTargetsAllMedia",
  NEGATIVE_INVARIANT,
  "InvDispatchMatchesConfirmation",
  "InvSelectionSafety"
]
const REQUIRED_PROPERTIES = [
  "PropBulkIncludesEligibleGroups",
  "PropBulkDoesNotReviewGroups",
  "PropBulkReopensChangedPlans",
  "PropBulkOverridesManualChoices",
  "PropBulkDoesNotDispatchTrash",
  "PropSelectGroupIsExplicitPerSetReview"
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
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      candidates.push(candidate)
    }
  }
  return candidates.sort().at(-1) ?? null
}

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

function parseSummary(output) {
  const generated = output.match(/(\d+) states generated, (\d+) distinct states found/)
  const depth = output.match(/depth of the complete state graph search is (\d+)/)
  const coverageRanges = Object.fromEntries(
    REQUIRED_ACTIONS.map((action) => {
      const match = output.match(
        new RegExp(`<${action} line[^>]*>:\\s*([0-9]+)(?::([0-9]+))?`)
      )
      return [
        action,
        {
          minimum: match ? Number(match[1]) : 0,
          maximum: match ? Number(match[2] ?? match[1]) : 0
        }
      ]
    })
  )
  const coverageCounts = Object.fromEntries(
    REQUIRED_ACTIONS.map((action) => [action, coverageRanges[action].maximum])
  )
  const coverageActions = REQUIRED_ACTIONS.filter(
    (action) => coverageCounts[action] > 0
  )
  const coverageComplete = REQUIRED_ACTIONS.every(
    (action) => coverageCounts[action] > 0
  )
  return {
    statesGenerated: generated ? Number(generated[1]) : 0,
    statesExplored: generated ? Number(generated[2]) : 0,
    depth: depth ? Number(depth[1]) : 0,
    coverageCounts,
    coverageRanges,
    coverageActions,
    coverageComplete,
    modelComplete:
      /Model checking completed\. No error has been found\./.test(output) &&
      coverageComplete
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function registeredFingerprint(root) {
  const registry = JSON.parse(
    readFileSync(resolve(root, "verification/requirements.json"), "utf8")
  )
  return computeSourceFingerprint(root, registry.sourceRoots)
}

export function runKeeperSelectionTlc({
  root = process.cwd(),
  jarPath = process.env.TLA_TOOLS_JAR,
  outputDirectory = resolve(root, "tmp/verification/current"),
  runId = process.env.VERIFICATION_RUN_ID ?? null,
  negativeControl = false,
  closure = false
} = {}) {
  const variant = negativeControl ? "negative" : closure ? "closure" : "reachability"
  const outputDirectoryAbsolute = resolve(root, outputDirectory)
  mkdirSync(outputDirectoryAbsolute, { recursive: true })
  const prefix =
    variant === "negative"
      ? "safe01-selection-negative"
      : variant === "closure"
        ? "safe01-selection-closure"
        : "safe01-selection"
  const logPath = join(outputDirectoryAbsolute, `${prefix}-tlc.log`)
  const resultPath = join(outputDirectoryAbsolute, `${prefix}.json`)
  const resolvedJar = resolve(root, jarPath ?? newestLocalJar(root) ?? "")
  const activeConfigPath =
    variant === "negative"
      ? NEGATIVE_CONFIG_PATH
      : variant === "closure"
        ? CLOSURE_CONFIG_PATH
        : CONFIG_PATH
  const moduleAbsolute = resolve(root, MODULE_PATH)
  const configAbsolute = resolve(root, activeConfigPath)
  const configuredLines = readFileSync(configAbsolute, "utf8").split("\n")
  const configuredInvariants = configuredLines
    .filter((line) => line.startsWith("INVARIANT "))
    .map((line) => line.slice("INVARIANT ".length).trim())
  const configuredProperties = configuredLines
    .filter((line) => line.startsWith("PROPERTY "))
    .map((line) => line.slice("PROPERTY ".length).trim())
  const requiredInvariants = negativeControl
    ? [NEGATIVE_INVARIANT]
    : REQUIRED_INVARIANTS
  const missingInvariants = requiredInvariants.filter(
    (invariant) => !configuredInvariants.includes(invariant)
  )
  const missingProperties = negativeControl
    ? []
    : REQUIRED_PROPERTIES.filter(
        (property) => !configuredProperties.includes(property)
      )
  const sourceFingerprintBefore = registeredFingerprint(root)

  if (missingInvariants.length > 0 || missingProperties.length > 0) {
    const sourceFingerprintAfter = registeredFingerprint(root)
    const result = {
      id: negativeControl
        ? "SAFE-01-negative-control"
        : closure
          ? "SAFE-01-closure-model"
          : "SAFE-01-model",
      status: "FAIL",
      runId,
      modelComplete: false,
      checksRun: 0,
      statesExplored: 0,
      modulePath: MODULE_PATH,
      configPath: activeConfigPath,
      configuredInvariants,
      configuredProperties,
      sourceRoots: JSON.parse(
        readFileSync(resolve(root, "verification/requirements.json"), "utf8")
      ).sourceRoots,
      sourceFingerprintBefore: sourceFingerprintBefore.digest,
      sourceFingerprintAfter: sourceFingerprintAfter.digest,
      sourceFileCountBefore: sourceFingerprintBefore.fileCount,
      sourceFileCountAfter: sourceFingerprintAfter.fileCount,
      sourceDrift: sourceFingerprintBefore.digest !== sourceFingerprintAfter.digest,
      message: [
        missingInvariants.length
          ? `Missing invariants: ${missingInvariants.join(", ")}`
          : "",
        missingProperties.length
          ? `Missing properties: ${missingProperties.join(", ")}`
          : ""
      ].filter(Boolean).join("; "),
      artifact: logPath
    }
    writeFileSync(logPath, `${result.message}\n`)
    writeJson(resultPath, result)
    return { ...result, exitCode: 1, logPath, resultPath }
  }

  if (!existsSync(resolvedJar)) {
    const sourceFingerprintAfter = registeredFingerprint(root)
    const sourceDrift =
      sourceFingerprintBefore.digest !== sourceFingerprintAfter.digest
    const result = {
      id: negativeControl
        ? "SAFE-01-negative-control"
        : closure
          ? "SAFE-01-closure-model"
          : "SAFE-01-model",
      status: sourceDrift ? "FAIL" : "BLOCKED",
      runId,
      modelComplete: false,
      checksRun: 0,
      statesExplored: 0,
      modulePath: MODULE_PATH,
      configPath: activeConfigPath,
      configuredInvariants,
      configuredProperties,
      sourceFingerprintBefore: sourceFingerprintBefore.digest,
      sourceFingerprintAfter: sourceFingerprintAfter.digest,
      sourceFileCountBefore: sourceFingerprintBefore.fileCount,
      sourceFileCountAfter: sourceFingerprintAfter.fileCount,
      sourceDrift,
      message: `Pinned TLC ${TLC_VERSION} jar is unavailable: ${resolvedJar}`,
      artifact: logPath
    }
    writeFileSync(logPath, `${result.message}\n`)
    writeJson(resultPath, result)
    return { ...result, exitCode: sourceDrift ? 1 : 2, logPath, resultPath }
  }

  const actualHash = sha256File(resolvedJar)
  if (actualHash !== TLC_SHA256) {
    const sourceFingerprintAfter = registeredFingerprint(root)
    const result = {
      id: negativeControl
        ? "SAFE-01-negative-control"
        : closure
          ? "SAFE-01-closure-model"
          : "SAFE-01-model",
      status: "FAIL",
      runId,
      modelComplete: false,
      checksRun: 0,
      statesExplored: 0,
      modulePath: MODULE_PATH,
      configPath: activeConfigPath,
      configuredInvariants,
      configuredProperties,
      sourceFingerprintBefore: sourceFingerprintBefore.digest,
      sourceFingerprintAfter: sourceFingerprintAfter.digest,
      sourceFileCountBefore: sourceFingerprintBefore.fileCount,
      sourceFileCountAfter: sourceFingerprintAfter.fileCount,
      sourceDrift: sourceFingerprintBefore.digest !== sourceFingerprintAfter.digest,
      message: `Pinned TLC jar integrity mismatch: expected ${TLC_SHA256}, got ${actualHash}`,
      artifact: logPath,
      jarPath: resolvedJar,
      jarSha256: actualHash
    }
    writeFileSync(logPath, `${result.message}\n`)
    writeJson(resultPath, result)
    return { ...result, exitCode: 1, logPath, resultPath }
  }

  const metadir = join(outputDirectoryAbsolute, `${prefix}-metadir`)
  mkdirSync(metadir, { recursive: true })
  const command = [
    "-cp",
    resolvedJar,
    "tlc2.TLC",
    "-nowarning",
    "-metadir",
    metadir,
    "-teSpecOutDir",
    outputDirectoryAbsolute,
    "-coverage",
    "1",
    "-config",
    configAbsolute,
    "-workers",
    "1",
    moduleAbsolute
  ]
  const processResult = spawnSync("java", command, {
    cwd: outputDirectoryAbsolute,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  })
  const sourceFingerprintAfter = registeredFingerprint(root)
  const sourceDrift = sourceFingerprintBefore.digest !== sourceFingerprintAfter.digest

  if (processResult.error) {
    const result = {
      id: negativeControl
        ? "SAFE-01-negative-control"
        : closure
          ? "SAFE-01-closure-model"
          : "SAFE-01-model",
      status: sourceDrift ? "FAIL" : "BLOCKED",
      runId,
      modelComplete: false,
      checksRun: 0,
      statesExplored: 0,
      modulePath: MODULE_PATH,
      configPath: activeConfigPath,
      configuredInvariants,
      configuredProperties,
      sourceFingerprintBefore: sourceFingerprintBefore.digest,
      sourceFingerprintAfter: sourceFingerprintAfter.digest,
      sourceFileCountBefore: sourceFingerprintBefore.fileCount,
      sourceFileCountAfter: sourceFingerprintAfter.fileCount,
      sourceDrift,
      message: `Java/TLC could not start: ${processResult.error.message}`,
      artifact: logPath,
      jarPath: resolvedJar,
      jarSha256: actualHash
    }
    writeFileSync(logPath, `${result.message}\n`)
    writeJson(resultPath, result)
    return { ...result, exitCode: sourceDrift ? 1 : 2, logPath, resultPath }
  }

  const output = `${processResult.stdout ?? ""}${processResult.stderr ?? ""}`
  writeFileSync(logPath, output)
  const summary = parseSummary(output)
  const tlcExitCode = processResult.status ?? 1
  const expectedCounterexampleDetected =
    negativeControl &&
    new RegExp(`Invariant ${NEGATIVE_INVARIANT} is violated\\.`).test(output)
  const counterexampleActionDetected =
    negativeControl && new RegExp(`<${NEGATIVE_ACTION}(?:\\s|>)`).test(output)
  const modelComplete = !negativeControl && summary.modelComplete && !sourceDrift
  const negativeControlPassed =
    negativeControl &&
    tlcExitCode !== 0 &&
    expectedCounterexampleDetected &&
    counterexampleActionDetected &&
    !sourceDrift
  const rawStatus = negativeControl
    ? negativeControlPassed
      ? "PASS"
      : "FAIL"
    : tlcExitCode === 0 && summary.modelComplete
      ? "PASS"
      : "FAIL"
  const status = sourceDrift ? "FAIL" : rawStatus
  const result = {
    ...summary,
    id: negativeControl
      ? "SAFE-01-negative-control"
      : closure
        ? "SAFE-01-closure-model"
        : "SAFE-01-model",
    status,
    runId,
    exitCode: status === "PASS" ? 0 : tlcExitCode || 1,
    tlcExitCode,
    checksRun: negativeControl
      ? 1
      : REQUIRED_INVARIANTS.length + REQUIRED_PROPERTIES.length,
    modelComplete,
    ...(negativeControl
      ? {
          expectedInvariant: NEGATIVE_INVARIANT,
          expectedCounterexampleDetected,
          expectedAction: NEGATIVE_ACTION,
          counterexampleActionDetected,
          negativeControlPassed
        }
      : {}),
    modulePath: MODULE_PATH,
    configPath: activeConfigPath,
    configuredInvariants,
    configuredProperties,
    sourceRoots: JSON.parse(
      readFileSync(resolve(root, "verification/requirements.json"), "utf8")
    ).sourceRoots,
    sourceFingerprintBefore: sourceFingerprintBefore.digest,
    sourceFingerprintAfter: sourceFingerprintAfter.digest,
    sourceFileCountBefore: sourceFingerprintBefore.fileCount,
    sourceFileCountAfter: sourceFingerprintAfter.fileCount,
    sourceDrift,
    moduleSha256: sha256File(moduleAbsolute),
    configSha256: sha256File(configAbsolute),
    jarVersion: TLC_VERSION,
    jarPath: resolvedJar,
    jarSha256: actualHash,
    artifact: logPath
  }
  writeJson(resultPath, result)
  return { ...result, logPath, resultPath }
}

if (process.argv[1]?.endsWith("/verification/run-keeper-selection-tlc.mjs")) {
  const args = parseArgs(process.argv.slice(2))
  const root = resolve(args.root ?? process.cwd())
  const result = runKeeperSelectionTlc({
    root,
    jarPath: args.jar,
    outputDirectory: resolve(root, args["out-dir"] ?? "tmp/verification/current"),
    negativeControl: args.negative === true,
    closure: args.closure === true
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.exitCode
}
