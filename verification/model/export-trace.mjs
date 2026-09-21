import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs"
import { join, relative, resolve } from "node:path"

export const TRACE_SCHEMA_VERSION = 1
export const PINNED_TLC_VERSION = "1.8.0"
export const PINNED_TLC_SHA256 =
  "20322939d1b55bb0a3f674ab34bb69b87c711a6b35559d32445cb7d7f6d3bb58"
export const TRACE_MODEL_PATH = "verification/model/TrashLifecycle.tla"
export const TRACE_CONFIG_PATH = "verification/model/TrashLifecycle.cfg"

export const TRACE_VARIABLES = [
  "phase",
  "operation",
  "context",
  "selectionRevision",
  "confirmed",
  "requested",
  "confirmedContext",
  "confirmedRevision",
  "keepers",
  "manualTrashAll",
  "auditSaved",
  "dispatchedTargets",
  "dispatchedOperation",
  "dispatchedContext",
  "dispatchedRevision",
  "reported",
  "replyOperation",
  "moved",
  "undoTargets",
  "replyKind",
  "crashed"
]

export const TRACE_ACTIONS = [
  "Init",
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

export const TRACE_REPLAY_SOURCE_PATHS = [
  "lib/trash-lifecycle.ts",
  "lib/trash-dispatch-guard.ts",
  "lib/review-preflight.ts",
  "verification/model/export-trace.mjs",
  "verification/trace-replay.ts",
  "verification/trace-replay-runner.mjs",
  "verification/trace-replay-status.mjs"
]

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex")
}

export function sha256File(path) {
  return sha256Bytes(readFileSync(path))
}

const SET_VARIABLES = new Set([
  "confirmed",
  "requested",
  "keepers",
  "dispatchedTargets",
  "reported",
  "moved",
  "undoTargets"
])

function canonicalize(value, key = "") {
  if (value instanceof Set) return [...value].sort()
  if (Array.isArray(value)) {
    const mapped = value.map((item) => canonicalize(item, key))
    return SET_VARIABLES.has(key)
      ? mapped.sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right))
        )
      : mapped
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entryKey, entryValue]) => [
          entryKey,
          canonicalize(entryValue, entryKey)
        ])
    )
  }
  return value
}

function jsonStable(value) {
  return JSON.stringify(canonicalize(value))
}

function stableDigest(value) {
  return sha256Bytes(Buffer.from(jsonStable(value)))
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function splitTlaList(value) {
  const parts = []
  let start = 0
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = 0; index < value.length; index++) {
    const character = value[index]
    if (quoted) {
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === '"') {
        quoted = false
      }
      continue
    }
    if (character === '"') {
      quoted = true
      continue
    }
    if (character === "{") depth += 1
    if (character === "}") depth -= 1
    if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  const last = value.slice(start).trim()
  if (last) parts.push(last)
  return parts
}

function parseTlaValue(value) {
  const normalized = value.trim()
  if (normalized === "TRUE") return true
  if (normalized === "FALSE") return false
  if (/^-?\d+$/.test(normalized)) return Number(normalized)
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    return JSON.parse(normalized)
  }
  if (normalized.startsWith("{") && normalized.endsWith("}")) {
    const body = normalized.slice(1, -1).trim()
    return body ? splitTlaList(body).map(parseTlaValue).sort() : []
  }
  throw new Error(`Unsupported TLA value: ${normalized}`)
}

function parseActionComment(line) {
  const match = line.match(/^\s*\\\*\s+<([A-Za-z][A-Za-z0-9_]*)\s+(.+)>\s*$/)
  if (!match) return null
  return {
    name: match[1],
    location: match[2]
  }
}

/**
 * Parse one trace module written by TLC's `-simulate file=...` option.
 * The returned states are derived directly from the raw module; callers must
 * retain and hash the raw module when they persist the parsed JSON.
 */
export function parseTraceModule(text, sourcePath = null) {
  const lines = text.split(/\r?\n/)
  const states = []
  let action = null
  let current = null

  for (const line of lines) {
    const actionComment = parseActionComment(line)
    if (actionComment) {
      action = actionComment
      continue
    }
    const stateHeader = line.match(/^STATE_(\d+)\s*==\s*$/)
    if (stateHeader) {
      current = {
        index: Number(stateHeader[1]),
        action: action?.name ?? null,
        actionLocation: action?.location ?? null,
        state: {}
      }
      states.push(current)
      continue
    }
    if (!current) continue
    const variable = line.match(/^\/\\\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/)
    if (!variable) continue
    current.state[variable[1]] = parseTlaValue(variable[2])
  }

  if (states.length === 0) {
    throw new Error(
      `TLC trace has no STATE_n blocks: ${sourcePath ?? "<text>"}`
    )
  }
  if (states[0].action !== "Init") {
    throw new Error(
      `TLC trace does not begin with Init: ${sourcePath ?? "<text>"}`
    )
  }
  states.forEach((entry, index) => {
    if (entry.index !== index + 1) {
      throw new Error(
        `TLC trace state numbering is not contiguous: ${sourcePath ?? "<text>"}`
      )
    }
    if (!entry.action || !TRACE_ACTIONS.includes(entry.action)) {
      throw new Error(
        `TLC trace has an unknown action: ${String(entry.action)}`
      )
    }
    const missing = TRACE_VARIABLES.filter(
      (variable) => !Object.prototype.hasOwnProperty.call(entry.state, variable)
    )
    if (missing.length > 0) {
      throw new Error(
        `TLC trace state ${entry.index} is missing variables: ${missing.join(", ")}`
      )
    }
  })

  return {
    stateCount: states.length,
    actions: states.map((entry) => entry.action),
    states
  }
}

function newestLocalJar(root) {
  const verificationRoot = resolve(root, "tmp/verification")
  if (!existsSync(verificationRoot)) return null
  const candidates = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "build") continue
        visit(path)
      } else if (
        entry.isFile() &&
        entry.name === `tla2tools-${PINNED_TLC_VERSION}.jar`
      ) {
        candidates.push(path)
      }
    }
  }
  visit(verificationRoot)
  return candidates.sort().at(-1) ?? null
}

function commandLine(args) {
  return ["java", ...args]
    .map((part) =>
      /^[A-Za-z0-9_./:=,+-]+$/.test(part) ? part : JSON.stringify(part)
    )
    .join(" ")
}

function gitMetadata(root) {
  const commit = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8"
  })
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8"
  })
  return {
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    dirty: status.status === 0 && status.stdout.trim().length > 0
  }
}

export function computeSourceMetadata(root, modulePath, configPath) {
  const paths = [modulePath, configPath, ...TRACE_REPLAY_SOURCE_PATHS]
  const files = paths.map((path) => {
    const absolute = resolve(root, path)
    if (!isFile(absolute)) throw new Error(`Missing source input: ${path}`)
    return {
      path,
      sha256: sha256File(absolute),
      bytes: statSync(absolute).size
    }
  })
  return {
    files,
    digest: stableDigest(files)
  }
}

export function computeTraceSourceMetadata(
  root,
  modulePath = TRACE_MODEL_PATH,
  configPath = TRACE_CONFIG_PATH
) {
  const resolvedRoot = resolve(root)
  const moduleAbsolute = resolve(resolvedRoot, modulePath)
  const configAbsolute = resolve(resolvedRoot, configPath)
  const sourceFiles = computeSourceMetadata(
    resolvedRoot,
    modulePath,
    configPath
  )
  const git = gitMetadata(resolvedRoot)
  const buildId = `${git.commit ?? "no-git"}:${sourceFiles.digest}`
  return {
    ...sourceFiles,
    modulePath,
    configPath,
    moduleSha256: sha256File(moduleAbsolute),
    configSha256: sha256File(configAbsolute),
    git,
    buildId
  }
}

function parseConfigConstants(configText) {
  const constants = {}
  for (const line of configText.split(/\r?\n/)) {
    const match = line.match(/^CONSTANT\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/)
    if (!match) continue
    try {
      constants[match[1]] = parseTlaValue(match[2])
    } catch {
      constants[match[1]] = match[2].trim()
    }
  }
  return constants
}

function validatePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
}

function relativeOrAbsolute(root, path) {
  const relativePath = relative(root, path)
  return relativePath && !relativePath.startsWith("..") ? relativePath : path
}

function traceFiles(rawDirectory) {
  return readdirSync(rawDirectory)
    .filter((name) => /^trace_\d+_\d+$/.test(name))
    .sort((left, right) => {
      const leftParts = left.slice(6).split("_").map(Number)
      const rightParts = right.slice(6).split("_").map(Number)
      return leftParts[0] - rightParts[0] || leftParts[1] - rightParts[1]
    })
    .map((name) => join(rawDirectory, name))
}

function writeManifest(outputDirectory, manifest) {
  const path = join(outputDirectory, "trace-manifest.json")
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  return path
}

function failedResult({
  root,
  outputDirectory,
  runId,
  status,
  message,
  options,
  source
}) {
  const manifest = {
    schemaVersion: TRACE_SCHEMA_VERSION,
    artifactType: "photosweep.tlc-trace-bundle",
    status,
    runId,
    buildId: source?.buildId ?? null,
    message,
    bounds: options,
    source: source ?? null,
    traces: [],
    proofBoundary:
      "TLC random simulation produces bounded traces for replay; it does not prove TypeScript refinement or whole-application behavior."
  }
  const manifestPath = writeManifest(outputDirectory, manifest)
  return {
    ...manifest,
    outputDirectory,
    manifestPath,
    exitCode: status === "BLOCKED" ? 2 : 1
  }
}

/**
 * Run a pinned, single-worker TLC simulation and export the raw TLC trace
 * modules plus a hash-bound parsed bundle. A non-empty output directory is
 * rejected so an old trace can never be silently reused.
 */
export function exportTraceBundle({
  root = process.cwd(),
  jarPath = process.env.TLA_TOOLS_JAR,
  outputDirectory = resolve(root, "tmp/verification/trace-replay/current"),
  modulePath = TRACE_MODEL_PATH,
  configPath = TRACE_CONFIG_PATH,
  seed = 20260915,
  depth = 24,
  traces = 256,
  runId = process.env.VERIFICATION_RUN_ID ?? `trace-${randomUUID()}`
} = {}) {
  validatePositiveInteger(depth, "depth")
  validatePositiveInteger(traces, "traces")
  if (!Number.isSafeInteger(seed))
    throw new Error("seed must be a safe integer")

  mkdirSync(outputDirectory, { recursive: true })
  if (readdirSync(outputDirectory).length > 0) {
    throw new Error(`Trace output directory must be empty: ${outputDirectory}`)
  }
  const rawDirectory = join(outputDirectory, "raw")
  const metadir = join(outputDirectory, "tlc-metadir")
  mkdirSync(rawDirectory, { recursive: true })
  mkdirSync(metadir, { recursive: true })

  const resolvedRoot = resolve(root)
  const moduleAbsolute = resolve(resolvedRoot, modulePath)
  const configAbsolute = resolve(resolvedRoot, configPath)
  const source = computeTraceSourceMetadata(
    resolvedRoot,
    modulePath,
    configPath
  )
  const buildId = source.buildId
  const options = {
    seed,
    depth,
    tracesRequested: traces,
    workers: 1,
    constants: parseConfigConstants(readFileSync(configAbsolute, "utf8"))
  }

  const resolvedJar = resolve(
    resolvedRoot,
    jarPath ?? newestLocalJar(resolvedRoot) ?? ""
  )
  if (!isFile(resolvedJar)) {
    return failedResult({
      root: resolvedRoot,
      outputDirectory,
      runId,
      status: "BLOCKED",
      message: `Pinned TLC ${PINNED_TLC_VERSION} jar is unavailable: ${resolvedJar}`,
      options,
      source
    })
  }
  const jarSha256 = sha256File(resolvedJar)
  if (jarSha256 !== PINNED_TLC_SHA256) {
    return failedResult({
      root: resolvedRoot,
      outputDirectory,
      runId,
      status: "FAIL",
      message: `Pinned TLC jar integrity mismatch: expected ${PINNED_TLC_SHA256}, got ${jarSha256}`,
      options,
      source
    })
  }

  const tlcArgs = [
    "-cp",
    resolvedJar,
    "tlc2.TLC",
    "-nowarning",
    "-workers",
    "1",
    "-simulate",
    `file=${join(rawDirectory, "trace")},num=${traces}`,
    "-depth",
    String(depth),
    "-seed",
    String(seed),
    "-metadir",
    metadir,
    "-config",
    configAbsolute,
    moduleAbsolute
  ]
  let processResult
  try {
    processResult = spawnSync("java", tlcArgs, {
      cwd: resolvedRoot,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024
    })
  } catch (caught) {
    const message = `Java/TLC could not start: ${caught instanceof Error ? caught.message : String(caught)}`
    const logPath = join(outputDirectory, "tlc-simulation.log")
    writeFileSync(logPath, `${message}\n`)
    return failedResult({
      root: resolvedRoot,
      outputDirectory,
      runId,
      status: "BLOCKED",
      message,
      options: {
        ...options,
        command: commandLine(tlcArgs),
        jarPath: relativeOrAbsolute(resolvedRoot, resolvedJar),
        jarSha256
      },
      source: {
        ...source,
        tool: {
          name: "TLC",
          version: PINNED_TLC_VERSION,
          jarSha256
        },
        logPath: relative(outputDirectory, logPath),
        logSha256: sha256File(logPath)
      }
    })
  }

  const output = `${processResult.stdout ?? ""}${processResult.stderr ?? ""}`
  const logPath = join(outputDirectory, "tlc-simulation.log")
  writeFileSync(logPath, output)
  const sourceAfter = computeTraceSourceMetadata(
    resolvedRoot,
    modulePath,
    configPath
  )
  const sourceDrift = sourceAfter.digest !== source.digest
  const files = traceFiles(rawDirectory)
  const parsedTraces = []
  const parseErrors = []
  for (const path of files) {
    try {
      const raw = readFileSync(path, "utf8")
      const parsed = parseTraceModule(raw, path)
      parsedTraces.push({
        traceId: relative(outputDirectory, path),
        rawPath: relative(outputDirectory, path),
        rawSha256: sha256Bytes(Buffer.from(raw)),
        rawBytes: Buffer.byteLength(raw),
        ...parsed
      })
    } catch (caught) {
      parseErrors.push(
        `${path}: ${caught instanceof Error ? caught.message : String(caught)}`
      )
    }
  }
  const tracesPath = join(outputDirectory, "traces.json")
  writeFileSync(
    tracesPath,
    `${JSON.stringify(
      {
        schemaVersion: TRACE_SCHEMA_VERSION,
        artifactType: "photosweep.tlc-traces",
        runId,
        buildId,
        traces: parsedTraces
      },
      null,
      2
    )}\n`
  )

  const exitCode = processResult.status ?? 1
  const logHasSeed = new RegExp(`Simulation using seed ${seed}(?:\\s|$)`).test(
    output
  )
  const finished = /Finished in /.test(output)
  const status =
    exitCode === 0 &&
    logHasSeed &&
    finished &&
    !sourceDrift &&
    files.length === traces &&
    parsedTraces.length === traces &&
    parseErrors.length === 0
      ? "PASS"
      : "FAIL"
  const manifest = {
    schemaVersion: TRACE_SCHEMA_VERSION,
    artifactType: "photosweep.tlc-trace-bundle",
    status,
    runId,
    buildId,
    source,
    tool: {
      name: "TLC",
      version: PINNED_TLC_VERSION,
      jarPath: relativeOrAbsolute(resolvedRoot, resolvedJar),
      jarSha256
    },
    bounds: options,
    execution: {
      exitCode,
      command: commandLine(tlcArgs),
      logPath: relative(outputDirectory, logPath),
      logSha256: sha256File(logPath),
      tracesPath: relative(outputDirectory, tracesPath),
      tracesSha256: sha256File(tracesPath),
      rawDirectory: relative(outputDirectory, rawDirectory),
      tracesProduced: files.length,
      tlcSeedObserved: logHasSeed,
      finished,
      parseErrors,
      sourceDrift,
      sourceAfter: sourceDrift ? sourceAfter : null
    },
    traces: parsedTraces.map((trace) => ({
      traceId: trace.traceId,
      rawPath: trace.rawPath,
      rawSha256: trace.rawSha256,
      rawBytes: trace.rawBytes,
      stateCount: trace.stateCount,
      actions: trace.actions
    })),
    proofBoundary:
      "TLC random simulation produces bounded traces for replay; it does not prove TypeScript refinement or whole-application behavior."
  }
  const manifestPath = writeManifest(outputDirectory, manifest)
  return {
    ...manifest,
    outputDirectory,
    manifestPath,
    tracesPath,
    logPath,
    exitCode,
    parsedTraces
  }
}

function pathInside(directory, candidate) {
  const resolvedDirectory = resolve(directory)
  const resolvedCandidate = resolve(directory, candidate)
  return (
    resolvedCandidate === resolvedDirectory ||
    resolvedCandidate.startsWith(`${resolvedDirectory}/`)
  )
}

function compareJson(left, right) {
  return jsonStable(left) === jsonStable(right)
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

function sourceMetadataErrors(observed, expected, label = "Trace source") {
  const errors = []
  if (!observed || typeof observed !== "object") {
    return [`${label} metadata is missing.`]
  }
  if (!Array.isArray(observed.files) || observed.files.length === 0) {
    errors.push(`${label} file list is missing or empty.`)
  }
  if (observed.modulePath !== expected.modulePath) {
    errors.push(
      `${label} module path is not the required model: ${String(observed.modulePath)}`
    )
  }
  if (observed.configPath !== expected.configPath) {
    errors.push(
      `${label} config path is not the required model config: ${String(observed.configPath)}`
    )
  }
  if (!validSha256(observed.moduleSha256)) {
    errors.push(`${label} moduleSha256 is missing or malformed.`)
  }
  if (!validSha256(observed.configSha256)) {
    errors.push(`${label} configSha256 is missing or malformed.`)
  }
  if (observed.moduleSha256 !== expected.moduleSha256) {
    errors.push(`${label} module hash does not match the current model.`)
  }
  if (observed.configSha256 !== expected.configSha256) {
    errors.push(`${label} config hash does not match the current model config.`)
  }
  if (observed.digest !== expected.digest) {
    errors.push(`${label} digest does not match the current required sources.`)
  }
  if (observed.buildId !== expected.buildId) {
    errors.push(`${label} buildId does not match the current source build.`)
  }
  if (observed.git?.commit !== expected.git.commit) {
    errors.push(`${label} git commit does not match the current source build.`)
  }

  const files = Array.isArray(observed.files) ? observed.files : []
  const seen = new Set()
  for (const file of files) {
    if (!file || typeof file !== "object") {
      errors.push(`${label} contains a malformed file record.`)
      continue
    }
    if (typeof file.path !== "string") {
      errors.push(`${label} contains a file without a path.`)
    } else if (seen.has(file.path)) {
      errors.push(`${label} contains a duplicate file path: ${file.path}`)
    } else {
      seen.add(file.path)
    }
    if (!validSha256(file.sha256)) {
      errors.push(
        `${label} file hash is missing or malformed: ${String(file.path)}`
      )
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      errors.push(
        `${label} file byte count is missing or malformed: ${String(file.path)}`
      )
    }
  }

  if (files.length !== expected.files.length) {
    errors.push(
      `${label} file count ${files.length} does not match required count ${expected.files.length}.`
    )
  }
  const max = Math.max(files.length, expected.files.length)
  for (let index = 0; index < max; index++) {
    const actual = files[index]
    const required = expected.files[index]
    if (!actual || !required) continue
    if (actual.path !== required.path) {
      errors.push(
        `${label} file ${index} is ${String(actual.path)}; required ${required.path}.`
      )
      continue
    }
    if (actual.sha256 !== required.sha256 || actual.bytes !== required.bytes) {
      errors.push(`${label} file digest changed: ${required.path}`)
    }
  }
  return errors
}

/**
 * Verify the complete provenance chain and reparse every raw TLC module. This
 * rejects hand-edited `traces.json`, stale output, missing raw traces, and a
 * source/tool mismatch before a replay adapter can consume a bundle.
 */
export function verifyTraceBundle(manifestPath, { root = process.cwd() } = {}) {
  const errors = []
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  } catch (caught) {
    return {
      ok: false,
      errors: [
        `Could not read trace manifest: ${caught instanceof Error ? caught.message : String(caught)}`
      ]
    }
  }
  const bundleDirectory = resolve(manifestPath, "..")
  if (manifest.schemaVersion !== TRACE_SCHEMA_VERSION) {
    errors.push(`Unsupported trace schema: ${String(manifest.schemaVersion)}`)
  }
  if (manifest.artifactType !== "photosweep.tlc-trace-bundle") {
    errors.push("Trace manifest artifactType is not a TLC trace bundle.")
  }
  if (manifest.status !== "PASS") {
    errors.push(`Trace export status is ${String(manifest.status)}.`)
  }
  if (!manifest.runId || !manifest.buildId) {
    errors.push("Trace manifest is missing runId or buildId.")
  }
  if (!manifest.bounds || !Number.isSafeInteger(manifest.bounds.seed)) {
    errors.push("Trace manifest is missing a reproducible safe-integer seed.")
  }
  if (!Number.isInteger(manifest.bounds?.depth) || manifest.bounds.depth <= 0) {
    errors.push("Trace manifest is missing a positive finite depth bound.")
  }
  if (
    !Number.isInteger(manifest.bounds?.tracesRequested) ||
    manifest.bounds.tracesRequested <= 0
  ) {
    errors.push("Trace manifest is missing a positive trace-count bound.")
  }

  const readBundleFile = (path, label) => {
    if (typeof path !== "string" || !pathInside(bundleDirectory, path)) {
      errors.push(`${label} path escapes the trace bundle.`)
      return null
    }
    const absolute = resolve(bundleDirectory, path)
    if (!isFile(absolute)) {
      errors.push(`${label} is missing: ${path}`)
      return null
    }
    return absolute
  }
  const logPath = readBundleFile(manifest.execution?.logPath, "TLC log")
  const tracesPath = readBundleFile(
    manifest.execution?.tracesPath,
    "parsed traces"
  )
  if (logPath && sha256File(logPath) !== manifest.execution.logSha256) {
    errors.push("TLC log hash does not match the manifest.")
  }
  if (
    tracesPath &&
    sha256File(tracesPath) !== manifest.execution.tracesSha256
  ) {
    errors.push("Parsed traces hash does not match the manifest.")
  }
  let parsedBundle = null
  if (tracesPath) {
    try {
      parsedBundle = JSON.parse(readFileSync(tracesPath, "utf8"))
    } catch (caught) {
      errors.push(
        `Parsed traces JSON is invalid: ${caught instanceof Error ? caught.message : String(caught)}`
      )
    }
  }
  const traces = Array.isArray(parsedBundle?.traces) ? parsedBundle.traces : []
  if (parsedBundle?.schemaVersion !== TRACE_SCHEMA_VERSION) {
    errors.push("Parsed traces schema does not match the manifest schema.")
  }
  if (parsedBundle?.artifactType !== "photosweep.tlc-traces") {
    errors.push("Parsed traces artifactType is not a TLC trace bundle payload.")
  }
  if (
    parsedBundle?.runId !== manifest.runId ||
    parsedBundle?.buildId !== manifest.buildId
  ) {
    errors.push(
      "Parsed traces provenance does not match the manifest runId/buildId."
    )
  }
  if (traces.length !== manifest.bounds?.tracesRequested) {
    errors.push(
      `Parsed trace count ${traces.length} does not match requested ${String(manifest.bounds?.tracesRequested)}.`
    )
  }
  if (manifest.execution?.tracesProduced !== traces.length) {
    errors.push("Manifest trace count does not match parsed trace count.")
  }

  if (manifest.execution?.sourceDrift === true) {
    errors.push("TLC export observed source drift during the bounded run.")
  }

  for (const trace of traces) {
    const rawPath = readBundleFile(
      trace.rawPath,
      `Raw trace ${String(trace.traceId)}`
    )
    if (!rawPath) continue
    const raw = readFileSync(rawPath, "utf8")
    if (sha256Bytes(Buffer.from(raw)) !== trace.rawSha256) {
      errors.push(`Raw trace hash mismatch: ${String(trace.traceId)}`)
      continue
    }
    let reparsed
    try {
      reparsed = parseTraceModule(raw, rawPath)
    } catch (caught) {
      errors.push(
        `Raw trace is not parseable: ${String(trace.traceId)}: ${caught instanceof Error ? caught.message : String(caught)}`
      )
      continue
    }
    const reparsedRecord = {
      traceId: trace.traceId,
      rawPath: trace.rawPath,
      rawSha256: trace.rawSha256,
      rawBytes: trace.rawBytes,
      ...reparsed
    }
    const parsedTrace = parsedBundle?.traces?.find(
      (item) => item.traceId === trace.traceId
    )
    if (!parsedTrace || !compareJson(parsedTrace, reparsedRecord)) {
      errors.push(
        `Parsed trace content does not match its raw TLC module: ${String(trace.traceId)}`
      )
    }
    if (trace.stateCount !== reparsed.stateCount) {
      errors.push(`State count mismatch for ${String(trace.traceId)}.`)
    }
    if (
      !Array.isArray(trace.actions) ||
      !compareJson(trace.actions, reparsed.actions)
    ) {
      errors.push(`Action sequence mismatch for ${String(trace.traceId)}.`)
    }
  }

  let currentSource = null
  try {
    currentSource = computeTraceSourceMetadata(
      root,
      TRACE_MODEL_PATH,
      TRACE_CONFIG_PATH
    )
    errors.push(
      ...sourceMetadataErrors(manifest.source, currentSource, "Exported source")
    )
    if (manifest.buildId !== currentSource.buildId) {
      errors.push(
        "Trace manifest buildId is not bound to the current source build."
      )
    }
  } catch (caught) {
    errors.push(
      `Could not compute required current replay source metadata: ${caught instanceof Error ? caught.message : String(caught)}`
    )
  }

  const modulePath = resolve(root, manifest.source?.modulePath ?? "")
  const configPath = resolve(root, manifest.source?.configPath ?? "")
  if (
    !isFile(modulePath) ||
    sha256File(modulePath) !== manifest.source?.moduleSha256
  ) {
    errors.push("Current model module does not match the exported source hash.")
  }
  if (
    !isFile(configPath) ||
    sha256File(configPath) !== manifest.source?.configSha256
  ) {
    errors.push("Current model config does not match the exported source hash.")
  }
  if (currentSource && manifest.execution?.sourceAfter) {
    if (!compareJson(manifest.execution.sourceAfter, currentSource)) {
      errors.push(
        "Source metadata after export does not match current source metadata."
      )
    }
  }
  const jarPath = resolve(root, manifest.tool?.jarPath ?? "")
  if (!isFile(jarPath) || sha256File(jarPath) !== manifest.tool?.jarSha256) {
    errors.push("Pinned TLC jar does not match the exported tool hash.")
  }
  if (logPath) {
    const output = readFileSync(logPath, "utf8")
    if (
      !new RegExp(
        `Simulation using seed ${manifest.bounds.seed}(?:\\s|$)`
      ).test(output)
    ) {
      errors.push("TLC log does not record the manifest seed.")
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    manifest,
    traces: parsedBundle?.traces ?? []
  }
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

if (process.argv[1]?.endsWith("/verification/model/export-trace.mjs")) {
  const args = parseArgs(process.argv.slice(2))
  const root = resolve(args.root ?? process.cwd())
  try {
    const result = exportTraceBundle({
      root,
      jarPath: args.jar,
      outputDirectory: resolve(
        root,
        args["out-dir"] ??
          `tmp/verification/trace-replay/${args["run-id"] ?? `trace-${Date.now()}`}`
      ),
      seed: args.seed === undefined ? 20260915 : Number(args.seed),
      depth: args.depth === undefined ? 24 : Number(args.depth),
      traces: args.traces === undefined ? 256 : Number(args.traces),
      runId: args["run-id"]
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    process.exitCode =
      result.status === "PASS" ? 0 : result.status === "BLOCKED" ? 2 : 1
  } catch (caught) {
    process.stderr.write(
      `${caught instanceof Error ? caught.message : String(caught)}\n`
    )
    process.exitCode = 1
  }
}
