import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, join } from "node:path"
import { spawnSync } from "node:child_process"

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
  const coverageActions = requiredActions.filter((action) =>
    new RegExp(`<${action} line`).test(output)
  )
  const coverageCounts = Object.fromEntries(
    requiredActions.map((action) => {
      const match = output.match(
        new RegExp(`<${action} line[^>]*>:\\s*([0-9]+)`)
      )
      return [action, match ? Number(match[1]) : 0]
    })
  )
  const coverageComplete = coverageActions.length === requiredActions.length
  // Undo is guarded by moved # {}, so observing a positive TLC coverage count
  // for that action is a concrete reachable nonempty-moved witness. This keeps
  // a vacuous model run from being accepted as lifecycle evidence.
  const nonEmptyUndoWitness = coverageCounts.Undo > 0
  return {
    statesGenerated: generated ? Number(generated[1]) : 0,
    statesExplored: generated ? Number(generated[2]) : 0,
    depth: depth ? Number(depth[1]) : 0,
    coverageCounts,
    coverageActions,
    nonEmptyUndoWitness,
    coverageComplete: coverageComplete && nonEmptyUndoWitness,
    modelComplete:
      /Model checking completed\. No error has been found\./.test(output) &&
      coverageComplete
  }
}

export function runTlc({
  root = process.cwd(),
  jarPath = process.env.TLA_TOOLS_JAR,
  outputDirectory = resolve(root, "tmp/verification/current"),
  modulePath = "verification/model/TrashLifecycle.tla",
  configPath = "verification/model/TrashLifecycle.cfg"
} = {}) {
  mkdirSync(outputDirectory, { recursive: true })
  const resolvedJar = resolve(root, jarPath ?? newestLocalJar(root) ?? "")
  const logPath = join(outputDirectory, "model-tlc.log")
  const resultPath = join(outputDirectory, "model.json")
  if (!existsSync(resolvedJar)) {
    const result = {
      status: "BLOCKED",
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
