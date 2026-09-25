import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, join } from "node:path"
import { spawnSync } from "node:child_process"

const PINNED_TLC_VERSION = "1.8.0"
const PINNED_TLC_SHA256 = "7c6a30fcfca96c6d7476e705a545837afbf66446c3fcb34bf39b838cd50ee0c0"

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
  mkdirSync(outputDirectory, { recursive: true })
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
    // TLC writes fingerprints, states, and counterexample traces relative to
    // its metadir. Keep those generated files beside the run's raw log and
    // result so source fingerprints never include model output.
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
  const result = runTlc({
    root,
    jarPath: args.jar,
    outputDirectory: resolve(root, args["out-dir"] ?? "tmp/verification/current")
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.status === "PASS" ? 0 : result.status === "BLOCKED" ? 2 : 1
}
