import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, join, relative } from "node:path"
import { spawnSync } from "node:child_process"
import { runKeeperSelectionTlc } from "./run-keeper-selection-tlc.mjs"
import { computeSourceFingerprint } from "./source-fingerprint.mjs"

const PINNED_TLC_VERSION = "1.8.0"
const PINNED_TLC_SHA256 = "20322939d1b55bb0a3f674ab34bb69b87c711a6b35559d32445cb7d7f6d3bb58"

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
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
      `tla2tools-${PINNED_TLC_VERSION}.jar`
    )
    if (existsSync(candidate)) candidates.push(candidate)
  }
  return candidates.sort().at(-1) ?? null
}

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

function parseSummary(output) {
  const generated = output.match(/(\d+) states generated, (\d+) distinct states found/)
  const depth = output.match(/depth of the complete state graph search is (\d+)/)
  const requiredActions = [
    "Confirm",
    "ManualTrashAllConfirm",
    "PersistAudit",
    "PersistAuditFailure",
    "Dispatch",
    "DriftSelection",
    "DriftContext",
    "StaleProviderReply",
    "ProviderSuccessEmpty",
    "ProviderSuccessSubset",
    "ProviderSuccessWithUnknown",
    "ProviderErrorPartial",
    "Timeout",
    "LateProviderReply",
    "DuplicateReply",
    "Undo",
    "Crash",
    "Recover"
  ]
  const coverageRanges = Object.fromEntries(
    requiredActions.map((action) => {
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
  // TLC prints a minimum:maximum range for each covered action. A zero
  // minimum does not mean the action is unreachable; it means some explored
  // state did not enable it. Reachability is established by the maximum.
  const coverageCounts = Object.fromEntries(
    requiredActions.map((action) => [action, coverageRanges[action].maximum])
  )
  const coverageActions = requiredActions.filter(
    (action) => coverageCounts[action] > 0
  )
  const coverageComplete = requiredActions.every(
    (action) => coverageCounts[action] > 0
  )
  // Undo is guarded by moved # {}, so observing a positive TLC coverage count
  // for that action is a concrete reachable nonempty-moved witness. This keeps
  // a vacuous model run from being accepted as lifecycle evidence.
  const nonEmptyUndoWitness = coverageCounts.Undo > 0
  return {
    statesGenerated: generated ? Number(generated[1]) : 0,
    statesExplored: generated ? Number(generated[2]) : 0,
    depth: depth ? Number(depth[1]) : 0,
    coverageCounts,
    coverageRanges,
    coverageActions,
    nonEmptyUndoWitness,
    coverageComplete: coverageComplete && nonEmptyUndoWitness,
    modelComplete:
      /Model checking completed\. No error has been found\./.test(output) &&
      coverageComplete &&
      nonEmptyUndoWitness
  }
}

export function runTlc({
  root = process.cwd(),
  jarPath = process.env.TLA_TOOLS_JAR,
  outputDirectory = resolve(root, "tmp/verification/current"),
  modulePath = "verification/model/TrashLifecycle.tla",
  configPath = "verification/model/TrashLifecycle.cfg",
  runId = process.env.VERIFICATION_RUN_ID ?? null
} = {}) {
  const outputDirectoryAbsolute = resolve(root, outputDirectory)
  mkdirSync(outputDirectoryAbsolute, { recursive: true })
  const resolvedJar = resolve(root, jarPath ?? newestLocalJar(root) ?? "")
  const logPath = join(outputDirectory, "model-tlc.log")
  const resultPath = join(outputDirectory, "model.json")
  if (!existsSync(resolvedJar)) {
    const result = {
      status: "BLOCKED",
      runId,
      modelComplete: false,
      checksRun: 0,
      statesExplored: 0,
      message: `Pinned TLC ${PINNED_TLC_VERSION} jar is unavailable: ${resolvedJar}`,
      artifact: logPath
    }
    writeFileSync(logPath, `${result.message}\n`)
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`)
    return { ...result, exitCode: 2, logPath, resultPath }
  }
  const actualHash = sha256File(resolvedJar)
  if (actualHash !== PINNED_TLC_SHA256) {
    const result = {
      status: "FAIL",
      runId,
      modelComplete: false,
      checksRun: 0,
      statesExplored: 0,
      message: `Pinned TLC jar integrity mismatch: expected ${PINNED_TLC_SHA256}, got ${actualHash}`,
      artifact: logPath,
      jarPath: resolvedJar,
      jarSha256: actualHash
    }
    writeFileSync(logPath, `${result.message}\n`)
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`)
    return { ...result, exitCode: 1, logPath, resultPath }
  }

  const moduleAbsolute = resolve(root, modulePath)
  const configAbsolute = resolve(root, configPath)
  const command = [
    "-cp",
    resolvedJar,
    "tlc2.TLC",
    "-nowarning",
    // Keep TLC state and counterexample output inside this run directory so
    // source fingerprints never include generated model artifacts.
    "-metadir",
    outputDirectoryAbsolute,
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
  let processResult
  try {
    processResult = spawnSync("java", command, {
      cwd: outputDirectoryAbsolute,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    })
  } catch (caught) {
    const result = {
      status: "BLOCKED",
      runId,
      modelComplete: false,
      checksRun: 0,
      statesExplored: 0,
      message: `Java/TLC could not start: ${caught instanceof Error ? caught.message : String(caught)}`,
      artifact: logPath,
      jarPath: resolvedJar,
      jarSha256: actualHash
    }
    writeFileSync(logPath, `${result.message}\n`)
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`)
    return { ...result, exitCode: 2, logPath, resultPath }
  }
  const output = `${processResult.stdout ?? ""}${processResult.stderr ?? ""}`
  writeFileSync(logPath, output)
  const summary = parseSummary(output)
  const exitCode = processResult.status ?? 1
  const result = {
    status: exitCode === 0 && summary.modelComplete ? "PASS" : "FAIL",
    runId,
    exitCode,
    checksRun: 1,
    ...summary,
    jarPath: resolvedJar,
    jarVersion: PINNED_TLC_VERSION,
    jarSha256: actualHash,
    modulePath,
    configPath,
    moduleSha256: sha256File(moduleAbsolute),
    configSha256: sha256File(configAbsolute),
    artifact: logPath
  }
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`)
  return { ...result, logPath, resultPath }
}

if (process.argv[1]?.endsWith("/verification/run-tlc.mjs")) {
  const args = parseArgs(process.argv.slice(2))
  const root = resolve(args.root ?? process.cwd())
  const outputDirectory = resolve(root, args["out-dir"] ?? "tmp/verification/current")
  const sourceRoots = JSON.parse(
    readFileSync(resolve(root, "verification/requirements.json"), "utf8")
  ).sourceRoots
  const lifecycle = runTlc({
    root,
    jarPath: args.jar,
    outputDirectory
  })
  const selection = runKeeperSelectionTlc({
    root,
    jarPath: args.jar,
    outputDirectory,
    runId: process.env.VERIFICATION_RUN_ID ?? null
  })
  const selectionClosure = runKeeperSelectionTlc({
    root,
    jarPath: args.jar,
    outputDirectory,
    runId: process.env.VERIFICATION_RUN_ID ?? null,
    closure: true
  })
  const selectionNegativeControl = runKeeperSelectionTlc({
    root,
    jarPath: args.jar,
    outputDirectory,
    runId: process.env.VERIFICATION_RUN_ID ?? null,
    negativeControl: true
  })
  const selectionArtifactPath = join(outputDirectory, "model-SAFE-01.json")
  const sourceFingerprintAfter = computeSourceFingerprint(root, sourceRoots).digest
  const sourceFingerprintBefore = selection.sourceFingerprintBefore
  const sourceDrift =
    selection.sourceDrift ||
    selectionClosure.sourceDrift ||
    selectionNegativeControl.sourceDrift ||
    selection.sourceFingerprintAfter !==
      selectionClosure.sourceFingerprintBefore ||
    selectionClosure.sourceFingerprintAfter !==
      selectionNegativeControl.sourceFingerprintBefore ||
    selectionNegativeControl.sourceFingerprintAfter !== sourceFingerprintAfter ||
    sourceFingerprintBefore !== sourceFingerprintAfter
  const selectionRuns = [selection, selectionClosure, selectionNegativeControl]
  const selectionHasBlockedRun = selectionRuns.some(
    (run) => run.status === "BLOCKED"
  )
  const selectionAllPassed = selectionRuns.every(
    (run) => run.status === "PASS"
  )
  const selectionAggregateStatus = sourceDrift
    ? "FAIL"
    : selectionAllPassed
      ? "PASS"
      : selectionHasBlockedRun
        ? "BLOCKED"
        : "FAIL"
  const selectionAggregateExitCode =
    selectionAggregateStatus === "PASS"
      ? 0
      : selectionAggregateStatus === "BLOCKED"
        ? 2
        : 1
  const selectionArtifact = {
    schemaVersion: 1,
    id: "SAFE-01-model",
    requirementId: "SAFE-01",
    proofClass: "finite-model",
    kind: "model",
    status: selectionAggregateStatus,
    exitCode: selectionAggregateExitCode,
    checksRun: selection.checksRun + selectionClosure.checksRun,
    modelComplete:
      selection.modelComplete && selectionClosure.modelComplete && !sourceDrift,
    statesExplored: selection.statesExplored,
    statesGenerated: selection.statesGenerated,
    depth: selection.depth,
    coverageActions: selection.coverageActions,
    coverageCounts: selection.coverageCounts,
    coverageRanges: selection.coverageRanges,
    invariant: "InvSelectionSafety",
    configuredInvariants: selection.configuredInvariants,
    invariantConfigured: selection.configuredInvariants.includes(
      "InvSelectionSafety"
    ),
    modelModule: selection.modulePath,
    modelConfig: selection.configPath,
    modelModuleSha256: selection.moduleSha256,
    modelConfigSha256: selection.configSha256,
    rawResult: relative(root, selection.resultPath),
    rawResultSha256: sha256File(selection.resultPath),
    rawLog: relative(root, selection.logPath),
    runId: selection.runId,
    commandExitCode: selection.exitCode,
    sourceFingerprintBefore,
    sourceFingerprintAfter,
    sourceFingerprint: sourceFingerprintAfter,
    sourceDrift,
    closure: {
      id: selectionClosure.id,
      status: selectionClosure.status,
      exitCode: selectionClosure.exitCode,
      modelComplete: selectionClosure.modelComplete,
      checksRun: selectionClosure.checksRun,
      statesExplored: selectionClosure.statesExplored,
      statesGenerated: selectionClosure.statesGenerated,
      depth: selectionClosure.depth,
      coverageActions: selectionClosure.coverageActions,
      coverageCounts: selectionClosure.coverageCounts,
      configuredInvariants: selectionClosure.configuredInvariants,
      configuredProperties: selectionClosure.configuredProperties,
      modelConfig: selectionClosure.configPath,
      modelModuleSha256: selectionClosure.moduleSha256,
      modelConfigSha256: selectionClosure.configSha256,
      sourceFingerprintBefore: selectionClosure.sourceFingerprintBefore,
      sourceFingerprintAfter: selectionClosure.sourceFingerprintAfter,
      sourceFileCountBefore: selectionClosure.sourceFileCountBefore,
      sourceFileCountAfter: selectionClosure.sourceFileCountAfter,
      sourceDrift: selectionClosure.sourceDrift,
      rawResult: relative(root, selectionClosure.resultPath),
      rawResultSha256: sha256File(selectionClosure.resultPath),
      rawLog: relative(root, selectionClosure.logPath),
      runId: selectionClosure.runId
    },
    negativeControl: {
      id: selectionNegativeControl.id,
      status: selectionNegativeControl.status,
      exitCode: selectionNegativeControl.exitCode,
      tlcExitCode: selectionNegativeControl.tlcExitCode,
      expectedInvariant: selectionNegativeControl.expectedInvariant,
      expectedCounterexampleDetected:
        selectionNegativeControl.expectedCounterexampleDetected,
      expectedAction: selectionNegativeControl.expectedAction,
      counterexampleActionDetected:
        selectionNegativeControl.counterexampleActionDetected,
      modelConfig: selectionNegativeControl.configPath,
      modelConfigSha256: selectionNegativeControl.configSha256,
      rawResult: relative(root, selectionNegativeControl.resultPath),
      rawResultSha256: sha256File(selectionNegativeControl.resultPath),
      rawLog: relative(root, selectionNegativeControl.logPath),
      runId: selectionNegativeControl.runId
    },
    proofBoundary:
      "TLC exhausts the declared finite constants and transitions; it does not prove TypeScript refinement or whole-app behavior."
  }
  writeFileSync(
    selectionArtifactPath,
    `${JSON.stringify(selectionArtifact, null, 2)}\n`
  )
  const result = {
    ...lifecycle,
    status:
      lifecycle.status === "PASS" &&
      selection.status === "PASS" &&
      selectionClosure.status === "PASS" &&
      selectionNegativeControl.status === "PASS"
        ? "PASS"
        : lifecycle.status === "BLOCKED" ||
            selection.status === "BLOCKED" ||
            selectionClosure.status === "BLOCKED" ||
            selectionNegativeControl.status === "BLOCKED"
          ? "BLOCKED"
          : "FAIL",
    exitCode:
      lifecycle.exitCode === 0 &&
      selection.exitCode === 0 &&
      selectionClosure.exitCode === 0 &&
      selectionNegativeControl.exitCode === 0
        ? 0
        : lifecycle.exitCode === 2 ||
            selection.exitCode === 2 ||
            selectionClosure.exitCode === 2 ||
            selectionNegativeControl.exitCode === 2
          ? 2
          : 1,
    models: {
      trashLifecycle: {
        status: lifecycle.status,
        exitCode: lifecycle.exitCode,
        statesExplored: lifecycle.statesExplored
      },
      safe01KeeperSelection: {
        id: selection.id,
        status: selection.status,
        exitCode: selection.exitCode,
        statesExplored: selection.statesExplored,
        statesGenerated: selection.statesGenerated,
        depth: selection.depth,
        resultPath: relative(root, selectionArtifactPath),
        rawResultPath: relative(root, selection.resultPath),
        closure: {
          id: selectionClosure.id,
          status: selectionClosure.status,
          exitCode: selectionClosure.exitCode,
          statesExplored: selectionClosure.statesExplored,
          statesGenerated: selectionClosure.statesGenerated,
          resultPath: relative(root, selectionClosure.resultPath),
          rawLogPath: relative(root, selectionClosure.logPath)
        },
        negativeControl: {
          status: selectionNegativeControl.status,
          exitCode: selectionNegativeControl.exitCode,
          rawResultPath: relative(root, selectionNegativeControl.resultPath),
          rawLogPath: relative(root, selectionNegativeControl.logPath),
          expectedInvariant: selectionNegativeControl.expectedInvariant,
          expectedAction: selectionNegativeControl.expectedAction,
          expectedCounterexampleDetected:
            selectionNegativeControl.expectedCounterexampleDetected,
          counterexampleActionDetected:
            selectionNegativeControl.counterexampleActionDetected
        }
      }
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.exitCode
}
