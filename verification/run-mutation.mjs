import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from "node:fs"
import { dirname, resolve } from "node:path"

import { computeSourceFingerprint } from "./source-fingerprint.mjs"

const root = resolve(process.env.VERIFICATION_ROOT ?? process.cwd())
const outputDirectory = resolve(
  root,
  process.env.VERIFICATION_MUTATION_DIR ??
    "tmp/verification/current/mutation-run"
)
const rawReport = resolve(outputDirectory, "stryker-raw.json")
const mutationTriage = resolve(outputDirectory, "mutation-triage.json")
const logPath = resolve(outputDirectory, "stryker.log")
const resultPath = resolve(
  root,
  process.env.VERIFICATION_MUTATION_OUTPUT ??
    "tmp/verification/current/mutation.json"
)
const runId = process.env.VERIFICATION_RUN_ID ?? null

const NATIVE_MUTATION_STATUSES = new Set([
  "Killed",
  "Survived",
  "NoCoverage",
  "CompileError",
  "RuntimeError",
  "Timeout",
  "Ignored",
  "Pending"
])

const REQUIRED_MUTATION_FILES = [
  "lib/trash-lifecycle.ts",
  "lib/trash-dispatch-guard.ts",
  "lib/review-preflight.ts",
  "lib/duplicate-review-session.ts",
  "lib/keep-strategy.ts",
  "scripts/photo-provider-command-host.js"
]

const TRIAGE_CLASSIFICATIONS = new Set([
  "EQUIVALENT",
  "UNREACHABLE",
  "DUPLICATE",
  "STATIC_TOOL_LIMITED",
  "BEHAVIORAL",
  "UNREVIEWED"
])
const REVIEWED_TRIAGE_CLASSIFICATIONS = new Set([
  "EQUIVALENT",
  "UNREACHABLE",
  "DUPLICATE"
])
const STRICT_UNRESOLVED_STATUSES = new Set([
  "Timeout",
  "RuntimeError",
  "CompileError",
  "Pending",
  "Ignored"
])

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex")
}

/**
 * Stryker includes output paths, test IDs, and failure prose in its JSON
 * report. Those fields vary between isolated runs without changing the
 * mutation set. Triage binds to this canonical projection while the result
 * still records the exact raw-file SHA separately.
 */
function canonicalMutationReport(report) {
  const canonical = JSON.parse(JSON.stringify(report))
  for (const file of Object.values(canonical.files ?? {})) {
    for (const mutant of file.mutants ?? []) {
      for (const field of [
        "coveredBy",
        "killedBy",
        "testsCompleted",
        "statusReason",
        "failureMessage",
        "failureLocation"
      ]) {
        delete mutant[field]
      }
    }
  }
  for (const testFile of Object.values(canonical.testFiles ?? {})) {
    for (const test of testFile.tests ?? []) delete test.id
  }
  if (canonical.config?.jsonReporter?.fileName) {
    canonical.config.jsonReporter.fileName = "<mutation-report>"
  }
  if (canonical.config?.tempDirName) {
    canonical.config.tempDirName = "<stryker-tmp>"
  }
  if (canonical.projectRoot) canonical.projectRoot = "<project-root>"
  canonical.files = Object.fromEntries(
    Object.entries(canonical.files ?? {}).sort(([a], [b]) => a.localeCompare(b))
  )
  canonical.testFiles = Object.fromEntries(
    Object.entries(canonical.testFiles ?? {}).sort(([a], [b]) => a.localeCompare(b))
  )
  return canonical
}

function canonicalMutationReportHash(report) {
  return sha256Text(JSON.stringify(sortCanonicalKeys(canonicalMutationReport(report))))
}

function sortCanonicalKeys(value) {
  if (Array.isArray(value)) return value.map(sortCanonicalKeys)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortCanonicalKeys(entry)])
  )
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function validateMutationReport(report) {
  if (!isRecord(report)) {
    throw new Error("Raw mutation report must be a JSON object.")
  }
  if (
    (typeof report.schemaVersion !== "string" &&
      typeof report.schemaVersion !== "number") ||
    (typeof report.schemaVersion === "string" &&
      report.schemaVersion.trim().length === 0) ||
    (typeof report.schemaVersion === "number" &&
      !Number.isFinite(report.schemaVersion))
  ) {
    throw new Error("Raw mutation report is missing a valid schemaVersion.")
  }
  if (!isRecord(report.files)) {
    throw new Error("Raw mutation report is missing its files object.")
  }
  if (!isRecord(report.thresholds)) {
    throw new Error("Raw mutation report is missing its thresholds object.")
  }
  for (const threshold of ["high", "low", "break"]) {
    if (!Number.isFinite(report.thresholds[threshold])) {
      throw new Error(
        `Raw mutation report has an invalid ${threshold} threshold.`
      )
    }
  }
  for (const [fileName, file] of Object.entries(report.files)) {
    if (!isRecord(file) || !Array.isArray(file.mutants)) {
      throw new Error(
        `Raw mutation report has invalid mutants for ${fileName}.`
      )
    }
    for (const [index, mutant] of file.mutants.entries()) {
      if (!isRecord(mutant) || typeof mutant.status !== "string") {
        throw new Error(
          `Raw mutation report has an invalid mutant at ${fileName}[${index}].`
        )
      }
      if (!NATIVE_MUTATION_STATUSES.has(mutant.status)) {
        throw new Error(
          `Raw mutation report has unknown mutant status ${mutant.status} at ${fileName}[${index}].`
        )
      }
    }
  }
  const reportedFiles = Object.keys(report.files)
  const missingFiles = REQUIRED_MUTATION_FILES.filter(
    (fileName) => !Object.prototype.hasOwnProperty.call(report.files, fileName)
  )
  if (
    reportedFiles.length !== REQUIRED_MUTATION_FILES.length ||
    missingFiles.length > 0
  ) {
    throw new Error(
      `Raw mutation report must contain exactly ${REQUIRED_MUTATION_FILES.length} configured mutation files; reported ${reportedFiles.length}, missing: ${missingFiles.join(", ") || "none"}.`
    )
  }
}

function mutationLocation(mutant) {
  const start = mutant.location?.start
  const end = mutant.location?.end ?? start
  if (
    !isRecord(start) ||
    !Number.isInteger(start.line) ||
    !Number.isInteger(start.column) ||
    start.line < 1 ||
    start.column < 1 ||
    !isRecord(end) ||
    !Number.isInteger(end.line) ||
    !Number.isInteger(end.column) ||
    end.line < 1 ||
    end.column < 1
  ) {
    throw new Error(
      `Raw mutation report has an invalid location for mutant ${String(mutant.id)}.`
    )
  }
  return {
    start: { line: start.line, column: start.column },
    end: { line: end.line, column: end.column }
  }
}

function mutationSourceHash(file) {
  if (typeof file.source !== "string") {
    throw new Error("Raw mutation report is missing a source string for a mutated file.")
  }
  return sha256Text(file.source)
}

function flattenMutationReport(report) {
  return Object.entries(report.files ?? {}).flatMap(([fileName, file]) => {
    const sourceHash = mutationSourceHash(file)
    return (file.mutants ?? []).map((mutant) => ({
      ...mutant,
      fileName,
      location: mutationLocation(mutant),
      sourceHash
    }))
  })
}

function mutationKey(mutant) {
  return JSON.stringify({
    file: mutant.fileName,
    id: String(mutant.id),
    status: mutant.status,
    location: mutant.location,
    mutatorName: mutant.mutatorName ?? null,
    replacement: mutant.replacement ?? null,
    sourceHash: mutant.sourceHash
  })
}

function triagePolicyPath() {
  const configured = process.env.VERIFICATION_MUTATION_TRIAGE_POLICY
  return configured ? resolve(root, configured) : null
}

function readTriagePolicy(path, sourceDigest, rawHash) {
  if (!path) return { status: "NOT_CONFIGURED", entries: new Map() }
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    return {
      status: "MISSING",
      entries: new Map(),
      error: `Mutation triage policy is unavailable at ${path}.`
    }
  }

  let policy
  try {
    policy = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    return {
      status: "INVALID",
      entries: new Map(),
      error: `Mutation triage policy is not valid JSON: ${errorMessage(error)}`
    }
  }
  try {
    if (!isRecord(policy) || policy.schemaVersion !== 1) {
      throw new Error("Mutation triage policy has an unsupported schemaVersion.")
    }
    if (policy.sourceFingerprint !== sourceDigest) {
      throw new Error(
        "Mutation triage policy source fingerprint does not match this run."
      )
    }
    if (policy.rawReportSha256 !== rawHash) {
      throw new Error(
        "Mutation triage policy raw report hash does not match this run."
      )
    }
    if (!Array.isArray(policy.entries)) {
      throw new Error("Mutation triage policy is missing its entries array.")
    }

    const entries = new Map()
    for (const [index, entry] of policy.entries.entries()) {
      if (!isRecord(entry)) {
        throw new Error(`Mutation triage policy entry ${index} is invalid.`)
      }
      if (
        (typeof entry.id !== "string" && typeof entry.id !== "number") ||
        typeof entry.file !== "string" ||
        typeof entry.status !== "string" ||
        typeof entry.mutatorName !== "string" ||
        typeof entry.replacement !== "string" ||
        typeof entry.sourceHash !== "string" ||
        !isRecord(entry.location) ||
        !isRecord(entry.location.start) ||
        !isRecord(entry.location.end) ||
        typeof entry.critical !== "boolean" ||
        typeof entry.classification !== "string" ||
        !TRIAGE_CLASSIFICATIONS.has(entry.classification) ||
        typeof entry.evidence !== "string" ||
        entry.evidence.trim().length === 0 ||
        typeof entry.reviewer !== "string" ||
        entry.reviewer.trim().length === 0
      ) {
        throw new Error(`Mutation triage policy entry ${index} is invalid.`)
      }
      const key = mutationKey({
        fileName: entry.file,
        id: entry.id,
        status: entry.status,
        location: entry.location,
        mutatorName: entry.mutatorName,
        replacement: entry.replacement,
        sourceHash: entry.sourceHash
      })
      if (entries.has(key)) {
        throw new Error(`Mutation triage policy entry ${index} duplicates another entry.`)
      }
      entries.set(key, {
        classification: entry.classification,
        critical: entry.critical,
        evidence: entry.evidence,
        reviewer: entry.reviewer
      })
    }
    return { status: "VALID", entries }
  } catch (error) {
    return {
      status: "STALE_OR_INVALID",
      entries: new Map(),
      error: errorMessage(error)
    }
  }
}

function triageResolution(mutant, entry) {
  if (!entry) {
    return {
      classification: "UNREVIEWED",
      critical: null,
      evidence: null,
      reviewer: null,
      resolved: false
    }
  }
  const resolved =
    mutant.status === "Killed"
      ? true
      : REVIEWED_TRIAGE_CLASSIFICATIONS.has(entry.classification) &&
        !STRICT_UNRESOLVED_STATUSES.has(mutant.status)
  return { ...entry, resolved }
}

function buildMutationTriage({
  report,
  sourceBefore,
  sourceAfter,
  rawHash
}) {
  const mutants = flattenMutationReport(report)
  const policyPath = triagePolicyPath()
  const policy = readTriagePolicy(
    policyPath,
    sourceBefore.digest,
    rawHash
  )
  const entries = mutants.map((mutant) => {
    const resolution = triageResolution(
      mutant,
      policy.entries.get(mutationKey(mutant))
    )
    return {
      key: mutationKey(mutant),
      file: mutant.fileName,
      id: mutant.id,
      status: mutant.status,
      location: mutant.location,
      mutatorName: mutant.mutatorName ?? null,
      replacement: mutant.replacement ?? null,
      sourceHash: mutant.sourceHash,
      ...resolution
    }
  })
  const nonKilled = entries.filter((entry) => entry.status !== "Killed")
  const unresolved = nonKilled.filter((entry) => !entry.resolved)
  const criticalFiles = new Set(REQUIRED_MUTATION_FILES)
  const criticalSurvivors = unresolved.filter(
    (entry) =>
      criticalFiles.has(entry.file) &&
      entry.critical === true &&
      ["Survived", "NoCoverage", "Timeout", "RuntimeError", "CompileError"].includes(
        entry.status
      )
  )
  const unreviewed = nonKilled.filter(
    (entry) => entry.classification === "UNREVIEWED"
  )
  const triageStatus =
    nonKilled.length === 0 && policy.status === "NOT_CONFIGURED"
      ? "NOT_REQUIRED"
      : policy.status
  return {
    schemaVersion: 1,
    rawReport,
    rawReportSha256: rawHash,
    sourceFingerprint: sourceBefore.digest,
    sourceFingerprintBefore: sourceBefore.digest,
    sourceFingerprintAfter: sourceAfter.digest,
    policyPath,
    policyStatus: triageStatus,
    policyError: policy.error ?? null,
    entries,
    summary: {
      mutantsTotal: mutants.length,
      mutantsReviewed: nonKilled.length - unreviewed.length,
      mutantsResolved: nonKilled.length - unresolved.length,
      mutantsUnresolved: unresolved.length,
      mutantsUnreviewed: unreviewed.length,
      mutantsNoCoverageUnresolved: unresolved.filter(
        (entry) => entry.status === "NoCoverage"
      ).length,
      criticalSurvivors: criticalSurvivors.length
    }
  }
}

function parseMutationReport(report) {
  validateMutationReport(report)
  const mutants = flattenMutationReport(report)
  const counts = {}
  for (const mutant of mutants) {
    counts[mutant.status] = (counts[mutant.status] ?? 0) + 1
  }
  const killed = counts.Killed ?? 0
  const total = mutants.length
  const covered = total - (counts.NoCoverage ?? 0)
  const score = total > 0 ? (killed / total) * 100 : 0
  const coveredScore = covered > 0 ? (killed / covered) * 100 : 0
  return {
    schemaVersion: 1,
    framework: report.framework ?? "stryker",
    testFiles: report.testFiles ?? [],
    filesMutated: Object.keys(report.files ?? {}).length,
    mutantsTotal: total,
    mutantsKilled: killed,
    mutantsCovered: covered,
    mutantsNoCoverage: counts.NoCoverage ?? 0,
    mutantsSurvived: counts.Survived ?? 0,
    mutantsIgnored: counts.Ignored ?? 0,
    mutantsPending: counts.Pending ?? 0,
    mutantsIncomplete: (counts.Ignored ?? 0) + (counts.Pending ?? 0),
    mutantsTimedOut: counts.Timeout ?? 0,
    mutantsErrored: (counts.RuntimeError ?? 0) + (counts.CompileError ?? 0),
    mutationScorePercent: Number(score.toFixed(2)),
    coveredMutationScorePercent: Number(coveredScore.toFixed(2)),
    statusCounts: counts,
    criticalSurvivors: null,
    criticalSurvivorDetails: [],
    rawReport,
    rawReportSha256: sha256File(rawReport)
  }
}

function sourceBinding(sourceBefore, sourceAfter = null) {
  const beforeDigest = sourceBefore?.digest ?? null
  const afterDigest = sourceAfter?.digest ?? null
  return {
    sourceFingerprint: beforeDigest,
    sourceFingerprintBefore: beforeDigest,
    sourceFingerprintAfter: afterDigest,
    sourceDrift:
      beforeDigest !== null && afterDigest !== null
        ? beforeDigest !== afterDigest
        : null
  }
}

function makeResult(sourceBefore, fields = {}) {
  const { sourceAfter = null, ...rest } = fields
  return {
    schemaVersion: 1,
    runId,
    ...sourceBinding(sourceBefore, sourceAfter),
    ...rest
  }
}

function emitResult(result) {
  let emittedResult = result
  try {
    mkdirSync(dirname(resultPath), { recursive: true })
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(
      `Could not write mutation result ${resultPath}: ${errorMessage(error)}\n`
    )
    emittedResult = {
      ...result,
      status: result.status === "BLOCKED" ? "BLOCKED" : "FAIL",
      exitCode: result.status === "BLOCKED" ? 2 : 1,
      artifactWriteError: {
        name: error instanceof Error ? error.name : "Error",
        message: errorMessage(error),
        code: error?.code ?? null
      },
      message: `Could not write mutation result artifact: ${errorMessage(error)}`
    }
  }
  const serialized = `${JSON.stringify(emittedResult, null, 2)}\n`
  process.stdout.write(serialized)
  process.exitCode = emittedResult.exitCode
  return emittedResult
}

function ensureFreshOutputDirectory() {
  if (existsSync(outputDirectory)) {
    const stats = lstatSync(outputDirectory)
    if (!stats.isDirectory()) {
      throw new Error(
        `Mutation output path is not a directory: ${outputDirectory}`
      )
    }
    const entries = readdirSync(outputDirectory)
    if (entries.length > 0) {
      throw new Error(
        `Mutation output directory is not empty; refusing stale evidence reuse: ${outputDirectory}`
      )
    }
  }
  mkdirSync(outputDirectory, { recursive: true })
}

function childFields(child) {
  return {
    childExitCode: Number.isInteger(child?.status) ? child.status : null,
    signal: child?.signal ?? null,
    childError: child?.error
      ? {
          name: child.error.name ?? "Error",
          message: errorMessage(child.error),
          code: child.error.code ?? null
        }
      : null
  }
}

function readRawMutationReport() {
  if (!existsSync(rawReport)) {
    throw new Error("Stryker did not produce a raw mutation report.")
  }
  if (!lstatSync(rawReport).isFile()) {
    throw new Error("Stryker raw mutation report is not a regular file.")
  }
  const serialized = readFileSync(rawReport, "utf8")
  if (serialized.trim().length === 0) {
    throw new Error("Stryker raw mutation report is empty.")
  }
  try {
    return JSON.parse(serialized)
  } catch (error) {
    throw new Error(
      `Stryker raw mutation report is not valid JSON: ${errorMessage(error)}`
    )
  }
}

function run() {
  let sourceBefore = null
  try {
    ensureFreshOutputDirectory()
  } catch (error) {
    return emitResult(
      makeResult(null, {
        status: "BLOCKED",
        exitCode: 2,
        checksRun: 0,
        mutantsTotal: 0,
        mutantsKilled: 0,
        criticalSurvivors: 0,
        message: errorMessage(error)
      })
    )
  }

  try {
    sourceBefore = computeSourceFingerprint(root)
  } catch (error) {
    return emitResult(
      makeResult(null, {
        status: "BLOCKED",
        exitCode: 2,
        checksRun: 0,
        mutantsTotal: 0,
        mutantsKilled: 0,
        criticalSurvivors: 0,
        message: `Could not fingerprint mutation sources before launch: ${errorMessage(error)}`
      })
    )
  }

  const stryker = resolve(root, "node_modules/.bin/stryker")
  if (!existsSync(stryker)) {
    return emitResult(
      makeResult(sourceBefore, {
        status: "BLOCKED",
        exitCode: 2,
        checksRun: 0,
        mutantsTotal: 0,
        mutantsKilled: 0,
        criticalSurvivors: 0,
        runnerPath: stryker,
        message: `Stryker is unavailable at ${stryker}`
      })
    )
  }

  let child
  try {
    child = spawnSync(stryker, ["run", "stryker.config.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        VERIFICATION_MUTATION_DIR: outputDirectory
      },
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024
    })
  } catch (error) {
    return emitResult(
      makeResult(sourceBefore, {
        status: "BLOCKED",
        exitCode: 2,
        checksRun: 0,
        mutantsTotal: 0,
        mutantsKilled: 0,
        criticalSurvivors: 0,
        runnerPath: stryker,
        childError: {
          name: error instanceof Error ? error.name : "Error",
          message: errorMessage(error),
          code: error?.code ?? null
        },
        message: `Stryker could not start: ${errorMessage(error)}`
      })
    )
  }

  const log = `${child.stdout ?? ""}${child.stderr ?? ""}`
  let logError = null
  try {
    writeFileSync(logPath, log)
  } catch (error) {
    logError = error
  }
  if (logError) {
    return emitResult(
      makeResult(sourceBefore, {
        status: "BLOCKED",
        exitCode: 2,
        checksRun: 0,
        ...childFields(child),
        runnerPath: stryker,
        message: `Could not record Stryker output: ${errorMessage(logError)}`
      })
    )
  }

  let sourceAfter = null
  try {
    sourceAfter = computeSourceFingerprint(root)
  } catch (error) {
    return emitResult(
      makeResult(sourceBefore, {
        status: "BLOCKED",
        exitCode: 2,
        checksRun: 0,
        ...childFields(child),
        rawLog: logPath,
        message: `Could not fingerprint mutation sources after launch: ${errorMessage(error)}`
      })
    )
  }

  if (child.error || child.signal || !Number.isInteger(child.status)) {
    const reason = child.error
      ? `Stryker could not start: ${errorMessage(child.error)}`
      : child.signal
        ? `Stryker terminated by signal ${child.signal}.`
        : "Stryker exited without a numeric status."
    return emitResult(
      makeResult(sourceBefore, {
        status: "BLOCKED",
        exitCode: 2,
        checksRun: 0,
        ...childFields(child),
        rawLog: logPath,
        sourceAfter,
        message: reason
      })
    )
  }

  if (sourceBefore.digest !== sourceAfter.digest) {
    return emitResult(
      makeResult(sourceBefore, {
        status: "FAIL",
        exitCode: 1,
        checksRun: 0,
        ...childFields(child),
        rawLog: logPath,
        rawReport: existsSync(rawReport) ? rawReport : null,
        sourceAfter,
        message:
          "Mutation sources changed while the mutation runner was executing."
      })
    )
  }

  let report
  try {
    report = readRawMutationReport()
  } catch (error) {
    const exitCode = child.status === 0 ? 1 : child.status
    return emitResult(
      makeResult(sourceBefore, {
        status: "FAIL",
        exitCode,
        checksRun: 0,
        ...childFields(child),
        rawLog: logPath,
        sourceAfter,
        message: errorMessage(error)
      })
    )
  }

  let summary
  try {
    summary = parseMutationReport(report)
  } catch (error) {
    return emitResult(
      makeResult(sourceBefore, {
        status: "FAIL",
        exitCode: child.status === 0 ? 1 : child.status,
        checksRun: 0,
        ...childFields(child),
        rawLog: logPath,
        sourceAfter,
        message: errorMessage(error)
      })
    )
  }

  let triage
  try {
    const rawHash = canonicalMutationReportHash(report)
    triage = buildMutationTriage({
      report,
      sourceBefore,
      sourceAfter,
      rawHash
    })
    writeFileSync(mutationTriage, `${JSON.stringify(triage, null, 2)}\n`)
  } catch (error) {
    return emitResult(
      makeResult(sourceBefore, {
        status: "FAIL",
        exitCode: child.status === 0 ? 1 : child.status,
        checksRun: 0,
        ...childFields(child),
        rawLog: logPath,
        rawReport,
        sourceAfter,
        message: `Could not record mutation triage: ${errorMessage(error)}`
      })
    )
  }
  summary = {
    ...summary,
    criticalSurvivors: triage.summary.criticalSurvivors,
    criticalSurvivorDetails: triage.entries
      .filter(
        (entry) =>
          entry.critical === true &&
          !entry.resolved &&
          ["Survived", "NoCoverage", "Timeout", "RuntimeError", "CompileError"].includes(
            entry.status
          )
      )
      .map((entry) => ({
        file: entry.file,
        line: entry.location.start.line,
        column: entry.location.start.column,
        mutatorName: entry.mutatorName,
        status: entry.status,
        replacement: entry.replacement,
        classification: entry.classification,
        evidence: entry.evidence,
        reviewer: entry.reviewer
      })),
    mutantsReviewed: triage.summary.mutantsReviewed,
    mutantsResolved: triage.summary.mutantsResolved,
    mutantsUnresolved: triage.summary.mutantsUnresolved,
    mutantsUnreviewed: triage.summary.mutantsUnreviewed,
    mutantsNoCoverageUnresolved: triage.summary.mutantsNoCoverageUnresolved,
    mutationTriage,
    mutationTriagePolicyStatus: triage.policyStatus,
    mutationTriagePolicyPath: triage.policyPath,
    mutationTriagePolicyError: triage.policyError,
    mutationTriageSha256: sha256File(mutationTriage)
  }
  const policyPass =
    summary.mutationScorePercent >= 90 &&
    ["NOT_REQUIRED", "VALID"].includes(summary.mutationTriagePolicyStatus) &&
    summary.criticalSurvivors === 0 &&
    summary.mutantsUnreviewed === 0 &&
    summary.mutantsUnresolved === 0 &&
    summary.mutantsNoCoverageUnresolved === 0 &&
    summary.mutantsIncomplete === 0 &&
    summary.mutantsTimedOut === 0 &&
    summary.mutantsErrored === 0
  const status = child.status === 0 && policyPass ? "PASS" : "FAIL"
  const result = {
    ...summary,
    ...makeResult(sourceBefore, {
      status,
      exitCode: status === "PASS" ? 0 : child.status === 0 ? 1 : child.status,
      checksRun: 1,
      ...childFields(child),
      rawLog: logPath,
      sourceAfter,
      threshold: {
        minimumKilledPercent: 90,
        maximumCriticalSurvivors: 0
      },
      message:
        status === "PASS"
          ? "Scoped semantic mutation run met its score and critical-survivor gates."
          : child.status !== 0
            ? `Stryker exited with status ${child.status}; mutation evidence is not accepted as PASS.`
            : "Scoped mutation run recorded surviving, uncovered, incomplete, timed-out, or errored mutants."
    })
  }
  return emitResult(result)
}

run()
