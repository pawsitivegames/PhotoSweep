import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const repositoryRoot = resolve(process.cwd())
const mutationRunner = join(repositoryRoot, "verification/run-mutation.mjs")
const requiredMutationFiles = [
  "lib/trash-lifecycle.ts",
  "lib/trash-dispatch-guard.ts",
  "lib/review-preflight.ts",
  "lib/duplicate-review-session.ts",
  "lib/keep-strategy.ts",
  "scripts/photo-provider-command-host.js"
]

type RunnerOptions = {
  report?: unknown
  triagePolicy?: unknown
  bindTriagePolicy?: boolean
  mode?: string
  exitCode?: number
  mutateSource?: boolean
  outputEntries?: Array<[string, string]>
  runnerKind?: string
  resultKind?: "file" | "directory"
}

function mutationReport(statuses = ["Killed"]) {
  const file = (fileName: string) => ({
    language: "typescript",
    source: `export const fixture = ${JSON.stringify(fileName)}`,
    mutants: statuses.map((status, index) => ({
      id: `${fileName}-${index}`,
      mutatorName: "FixtureMutator",
      replacement: String(status),
      status,
      location: {
        start: { line: index + 1, column: 1 },
        end: { line: index + 1, column: 2 }
      }
    }))
  })
  return {
    schemaVersion: "1.0",
    thresholds: { high: 90, low: 90, break: 90 },
    files: Object.fromEntries(
      requiredMutationFiles.map((name) => [name, file(name)])
    )
  }
}

function sha256File(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function canonicalMutationReportHash(report: unknown) {
  const canonical = JSON.parse(JSON.stringify(report))
  for (const file of Object.values(canonical.files ?? {}) as Array<Record<string, unknown>>) {
    for (const mutant of (file.mutants ?? []) as Array<Record<string, unknown>>) {
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
  for (const testFile of Object.values(canonical.testFiles ?? {}) as Array<Record<string, unknown>>) {
    for (const test of (testFile.tests ?? []) as Array<Record<string, unknown>>) delete test.id
  }
  if (canonical.config?.jsonReporter?.fileName) {
    canonical.config.jsonReporter.fileName = "<mutation-report>"
  }
  if (canonical.config?.tempDirName) canonical.config.tempDirName = "<stryker-tmp>"
  if (canonical.projectRoot) canonical.projectRoot = "<project-root>"
  canonical.files = Object.fromEntries(Object.entries(canonical.files ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  canonical.testFiles = Object.fromEntries(Object.entries(canonical.testFiles ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  function sortCanonicalKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortCanonicalKeys)
    if (value === null || typeof value !== "object") return value
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortCanonicalKeys(entry)])
    )
  }
  return createHash("sha256")
    .update(JSON.stringify(sortCanonicalKeys(canonical)))
    .digest("hex")
}

function triageEntry(
  report: ReturnType<typeof mutationReport>,
  file: string,
  index: number,
  classification: string,
  critical = false
) {
  const mutant = report.files[file].mutants[index]
  return {
    file,
    id: mutant.id,
    status: mutant.status,
    location: mutant.location,
    mutatorName: mutant.mutatorName,
    replacement: mutant.replacement,
    sourceHash: createHash("sha256")
      .update(report.files[file].source)
      .digest("hex"),
    classification,
    critical,
    evidence: `Integrity fixture proves ${classification.toLowerCase()} classification for ${file} mutant ${mutant.id}.`,
    reviewer: "mutation-runner-integrity"
  }
}

function triagePolicyFor(
  report: ReturnType<typeof mutationReport>,
  classification: string,
  critical = false
) {
  const entries = []
  for (const file of requiredMutationFiles) {
    for (const [index, mutant] of report.files[file].mutants.entries()) {
      if (mutant.status !== "Killed") {
        entries.push(triageEntry(report, file, index, classification, critical))
      }
    }
  }
  return {
    schemaVersion: 1,
    sourceFingerprint: "bound-by-invoke-helper",
    rawReportSha256: "bound-by-invoke-helper",
    entries
  }
}

function invokeMutationRunner({
  report = mutationReport(),
  triagePolicy,
  bindTriagePolicy = true,
  mode = "write",
  exitCode = 0,
  mutateSource = false,
  outputEntries = [] as Array<[string, string]>,
  runnerKind = "stub",
  resultKind = "file"
}: RunnerOptions = {}) {
  const temporaryRoot = mkdtempSync(
    join(repositoryRoot, "tmp/mutation-runner-integrity-")
  )
  const outputDirectory = join(temporaryRoot, "mutation-run")
  const resultPath = join(
    temporaryRoot,
    resultKind === "directory" ? "mutation-result" : "mutation.json"
  )
  const reportInput = join(temporaryRoot, "report-input.json")
  const triagePolicyInput = join(temporaryRoot, "triage-policy.json")
  const strykerPath = join(temporaryRoot, "node_modules/.bin/stryker")
  mkdirSync(join(temporaryRoot, "lib"), { recursive: true })
  writeFileSync(join(temporaryRoot, "lib/source.js"), "before\n")
  if (resultKind === "directory") mkdirSync(resultPath, { recursive: true })
  const git = spawnSync("git", ["init", "--quiet"], {
    cwd: temporaryRoot,
    encoding: "utf8"
  })
  if (git.status !== 0) {
    throw new Error(`${git.stdout ?? ""}${git.stderr ?? ""}`)
  }

  for (const [relativePath, contents] of outputEntries) {
    const path = join(outputDirectory, relativePath)
    mkdirSync(resolve(path, ".."), { recursive: true })
    writeFileSync(path, contents)
  }

  if (runnerKind === "stub") {
    mkdirSync(resolve(strykerPath, ".."), { recursive: true })
    writeFileSync(
      strykerPath,
      `#!/usr/bin/env node
const fs = require("node:fs")
const path = require("node:path")
const mode = process.env.VERIFICATION_STUB_MODE
if (mode === "write") {
  fs.mkdirSync(process.env.VERIFICATION_MUTATION_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(process.env.VERIFICATION_MUTATION_DIR, "stryker-raw.json"),
    fs.readFileSync(process.env.VERIFICATION_STUB_REPORT)
  )
}
if (process.env.VERIFICATION_STUB_MUTATE_SOURCE === "1") {
  fs.writeFileSync(path.join(process.env.VERIFICATION_ROOT, "lib/source.js"), "after\\n")
}
if (mode === "signal") process.kill(process.pid, "SIGTERM")
process.exit(Number.parseInt(process.env.VERIFICATION_STUB_EXIT ?? "0", 10))
`
    )
    chmodSync(strykerPath, 0o755)
    // The runner executes this file directly, so the test stub must be
    // executable just like node_modules/.bin/stryker.
    writeFileSync(
      reportInput,
      typeof report === "string" ? report : JSON.stringify(report)
    )
    if (triagePolicy !== undefined) {
      let policyValue = triagePolicy
      if (bindTriagePolicy && typeof triagePolicy === "object" && triagePolicy !== null) {
        const fingerprint = spawnSync(
          process.execPath,
          [join(repositoryRoot, "verification/source-fingerprint.mjs"), temporaryRoot],
          { encoding: "utf8" }
        )
        if (fingerprint.status !== 0) {
          throw new Error(`${fingerprint.stdout ?? ""}${fingerprint.stderr ?? ""}`)
        }
        policyValue = {
          ...triagePolicy,
          sourceFingerprint: JSON.parse(fingerprint.stdout).digest,
          rawReportSha256: canonicalMutationReportHash(report)
        }
      }
      writeFileSync(
        triagePolicyInput,
        typeof policyValue === "string"
          ? policyValue
          : JSON.stringify(policyValue)
      )
    }
  } else if (runnerKind === "directory") {
    mkdirSync(strykerPath, { recursive: true })
  }

  try {
    const child = spawnSync(process.execPath, [mutationRunner], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        VERIFICATION_ROOT: temporaryRoot,
        VERIFICATION_MUTATION_DIR: outputDirectory,
        VERIFICATION_MUTATION_OUTPUT: resultPath,
        VERIFICATION_RUN_ID: "mutation-runner-integrity-test",
        VERIFICATION_STUB_MODE: mode,
        VERIFICATION_STUB_EXIT: String(exitCode),
        VERIFICATION_STUB_MUTATE_SOURCE: mutateSource ? "1" : "0",
        VERIFICATION_STUB_REPORT: reportInput,
        ...(triagePolicy !== undefined
          ? { VERIFICATION_MUTATION_TRIAGE_POLICY: triagePolicyInput }
          : {})
      },
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    })
    const result =
      resultKind === "file" && existsSync(resultPath)
        ? JSON.parse(readFileSync(resultPath, "utf8"))
        : null
    const markerPath = join(outputDirectory, "stale-marker.json")
    return {
      child,
      result,
      marker: existsSync(markerPath) ? readFileSync(markerPath, "utf8") : null,
      rawReport: existsSync(join(outputDirectory, "stryker-raw.json"))
        ? readFileSync(join(outputDirectory, "stryker-raw.json"), "utf8")
        : null,
      triage: existsSync(join(outputDirectory, "mutation-triage.json"))
        ? JSON.parse(
            readFileSync(join(outputDirectory, "mutation-triage.json"), "utf8")
          )
        : null,
      stdout: child.stdout ?? "",
      stderr: child.stderr ?? ""
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

describe("mutation runner integrity", () => {
  it("binds a valid PASS to matching source fingerprints", () => {
    const run = invokeMutationRunner()

    expect(run.child.status).toBe(0)
    expect(run.result).toMatchObject({
      status: "PASS",
      exitCode: 0,
      checksRun: 1,
      filesMutated: 6,
      sourceDrift: false
    })
    expect(run.result.sourceFingerprintBefore).toBe(
      run.result.sourceFingerprintAfter
    )
    expect(run.triage).toMatchObject({
      schemaVersion: 1,
      rawReportSha256: expect.any(String),
      sourceFingerprint: run.result.sourceFingerprint,
      sourceFingerprintBefore: run.result.sourceFingerprintBefore,
      sourceFingerprintAfter: run.result.sourceFingerprintAfter,
      policyStatus: "NOT_REQUIRED",
      summary: {
        mutantsTotal: 6,
        mutantsReviewed: 0,
        mutantsResolved: 0,
        mutantsUnresolved: 0,
        mutantsUnreviewed: 0,
        criticalSurvivors: 0
      }
    })
    expect(run.triage.entries).toHaveLength(6)
    for (const entry of run.triage.entries) {
      expect(entry).toMatchObject({
        file: expect.any(String),
        id: expect.any(String),
        status: "Killed",
        location: {
          start: { line: expect.any(Number), column: expect.any(Number) },
          end: { line: expect.any(Number), column: expect.any(Number) }
        },
        sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    }
  })

  it("never reports PASS when the child exits nonzero with a passing raw report", () => {
    const run = invokeMutationRunner({ exitCode: 7 })

    expect(run.child.status).toBe(7)
    expect(run.result).toMatchObject({
      status: "FAIL",
      exitCode: 7,
      childExitCode: 7,
      sourceDrift: false
    })
  })

  it("rejects a nonempty mutation directory before launch and preserves stale files", () => {
    const staleRaw = JSON.stringify(mutationReport(["Killed"]))
    const run = invokeMutationRunner({
      outputEntries: [
        ["stale-marker.json", '{"status":"PASS"}\n'],
        ["stryker-raw.json", staleRaw]
      ],
      exitCode: 9
    })

    expect(run.child.status).toBe(2)
    expect(run.result).toMatchObject({
      status: "BLOCKED",
      exitCode: 2,
      checksRun: 0
    })
    expect(run.result.message).toContain("not empty")
    expect(run.marker).toBe('{"status":"PASS"}\n')
    expect(run.rawReport).toBe(`${staleRaw}`)
  })

  it("fails when a successful child omits the raw report", () => {
    const run = invokeMutationRunner({ mode: "missing" })

    expect(run.child.status).toBe(1)
    expect(run.result).toMatchObject({
      status: "FAIL",
      exitCode: 1,
      childExitCode: 0,
      checksRun: 0
    })
    expect(run.result.message).toContain(
      "did not produce a raw mutation report"
    )
  })

  it("fails malformed JSON and reports the parse boundary", () => {
    const run = invokeMutationRunner({ report: "{malformed", mode: "write" })

    expect(run.child.status).toBe(1)
    expect(run.result).toMatchObject({
      status: "FAIL",
      exitCode: 1,
      childExitCode: 0,
      checksRun: 0
    })
    expect(run.result.message).toContain("not valid JSON")
  })

  it("fails structurally malformed reports", () => {
    const run = invokeMutationRunner({
      report: {
        schemaVersion: "1.0",
        thresholds: { high: 90, low: 90, break: 90 },
        files: null
      }
    })

    expect(run.child.status).toBe(1)
    expect(run.result).toMatchObject({
      status: "FAIL",
      exitCode: 1,
      childExitCode: 0,
      checksRun: 0
    })
    expect(run.result.message).toContain("missing its files object")
  })

  it("fails reports with unknown mutant statuses", () => {
    const run = invokeMutationRunner({
      report: mutationReport(["NotARealStrykerStatus"])
    })

    expect(run.child.status).toBe(1)
    expect(run.result).toMatchObject({
      status: "FAIL",
      exitCode: 1,
      childExitCode: 0,
      checksRun: 0
    })
    expect(run.result.message).toContain("unknown mutant status")
  })

  it.each(["Pending", "Ignored"])(
    "fails a 95 percent report with incomplete %s mutants",
    (incompleteStatus) => {
      const statuses = [
        ...Array.from({ length: 95 }, () => "Killed"),
        ...Array.from({ length: 5 }, () => incompleteStatus)
      ]
      const run = invokeMutationRunner({ report: mutationReport(statuses) })

      expect(run.child.status).toBe(1)
      expect(run.result).toMatchObject({
        status: "FAIL",
        exitCode: 1,
        childExitCode: 0,
        mutationScorePercent: 95,
        mutantsTotal: 600,
        mutantsKilled: 570,
        mutantsIncomplete: 30
      })
      expect(run.result.statusCounts[incompleteStatus]).toBe(30)
    }
  )

  it("fails a high raw score when NoCoverage mutants are unreviewed", () => {
    const statuses = [
      ...Array.from({ length: 95 }, () => "Killed"),
      ...Array.from({ length: 5 }, () => "NoCoverage")
    ]
    const run = invokeMutationRunner({ report: mutationReport(statuses) })

    expect(run.child.status).toBe(1)
    expect(run.result).toMatchObject({
      status: "FAIL",
      exitCode: 1,
      childExitCode: 0,
      mutationScorePercent: 95,
      coveredMutationScorePercent: 100,
      mutantsTotal: 600,
      mutantsKilled: 570,
      mutantsNoCoverage: 30,
      mutantsNoCoverageUnresolved: 30,
      mutantsUnreviewed: 30,
      mutantsUnresolved: 30,
      mutationTriagePolicyStatus: "NOT_CONFIGURED"
    })
  })

  it("accepts reviewed equivalent NoCoverage while preserving the raw denominator", () => {
    const report = mutationReport([
      ...Array.from({ length: 95 }, () => "Killed"),
      ...Array.from({ length: 5 }, () => "NoCoverage")
    ])
    const run = invokeMutationRunner({
      report,
      triagePolicy: triagePolicyFor(report, "UNREACHABLE")
    })

    expect(run.child.status).toBe(0)
    expect(run.result).toMatchObject({
      status: "PASS",
      exitCode: 0,
      mutationScorePercent: 95,
      coveredMutationScorePercent: 100,
      mutantsTotal: 600,
      mutantsKilled: 570,
      mutantsNoCoverage: 30,
      mutantsNoCoverageUnresolved: 0,
      mutantsUnreviewed: 0,
      mutantsUnresolved: 0,
      criticalSurvivors: 0,
      mutationTriagePolicyStatus: "VALID"
    })
    expect(run.triage.summary).toMatchObject({
      mutantsReviewed: 30,
      mutantsResolved: 30,
      mutantsUnresolved: 0
    })
  })

  it("uses per-mutant triage so reviewed non-critical survivors do not become critical by file", () => {
    const report = mutationReport([
      ...Array.from({ length: 95 }, () => "Killed"),
      ...Array.from({ length: 5 }, () => "Survived")
    ])
    const run = invokeMutationRunner({
      report,
      triagePolicy: triagePolicyFor(report, "EQUIVALENT")
    })

    expect(run.child.status).toBe(0)
    expect(run.result).toMatchObject({
      status: "PASS",
      mutationScorePercent: 95,
      mutantsSurvived: 30,
      criticalSurvivors: 0,
      mutantsUnreviewed: 0,
      mutantsUnresolved: 0
    })
  })

  it("keeps tool-limited survivor classifications as an unresolved strict failure", () => {
    const report = mutationReport([
      ...Array.from({ length: 95 }, () => "Killed"),
      ...Array.from({ length: 5 }, () => "Survived")
    ])
    const run = invokeMutationRunner({
      report,
      triagePolicy: triagePolicyFor(report, "STATIC_TOOL_LIMITED", true)
    })

    expect(run.child.status).toBe(1)
    expect(run.result).toMatchObject({
      status: "FAIL",
      criticalSurvivors: 30,
      mutantsUnresolved: 30,
      mutantsUnreviewed: 0,
      mutationTriagePolicyStatus: "VALID"
    })
  })

  it.each([
    ["source", { sourceFingerprint: "stale-source" }],
    ["report", { rawReportSha256: "stale-report" }],
    ["classification", { entries: [{ classification: "UNKNOWN" }] }]
  ])("fails closed for stale or malformed triage policy (%s)", (_label, change) => {
    const report = mutationReport(["Killed", "NoCoverage"])
    const run = invokeMutationRunner({
      report,
      triagePolicy: { ...triagePolicyFor(report, "UNREACHABLE"), ...change },
      bindTriagePolicy: false
    })

    expect(run.child.status).toBe(1)
    expect(run.result).toMatchObject({
      status: "FAIL",
      mutantsNoCoverage: 6,
      mutantsUnresolved: 6,
      mutationTriagePolicyStatus: expect.stringMatching(/INVALID|STALE/)
    })
    expect(run.triage).toMatchObject({
      rawReportSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      sourceFingerprint: run.result.sourceFingerprint,
      summary: { mutantsUnreviewed: 6, mutantsNoCoverageUnresolved: 6 }
    })
  })

  it("rejects a report missing five required mutation modules", () => {
    const report = mutationReport()
    for (const fileName of requiredMutationFiles.slice(1)) {
      delete report.files[fileName]
    }
    const run = invokeMutationRunner({ report })

    expect(run.child.status).toBe(1)
    expect(run.result).toMatchObject({
      status: "FAIL",
      exitCode: 1,
      childExitCode: 0,
      checksRun: 0
    })
    expect(run.result.message).toContain("exactly 6 configured mutation files")
    expect(run.result.message).toContain("missing:")
  })

  it("blocks launch errors and records signal termination", () => {
    const launch = invokeMutationRunner({ runnerKind: "directory" })
    expect(launch.child.status).toBe(2)
    expect(launch.result).toMatchObject({ status: "BLOCKED", exitCode: 2 })
    expect(launch.result.childError?.code).toBe("EACCES")

    const signal = invokeMutationRunner({ mode: "signal" })
    expect(signal.child.status).toBe(2)
    expect(signal.result).toMatchObject({
      status: "BLOCKED",
      exitCode: 2,
      signal: "SIGTERM"
    })
  })

  it("blocks a run whose source changes during execution", () => {
    const run = invokeMutationRunner({ mutateSource: true })

    expect(run.child.status).toBe(1)
    expect(run.result).toMatchObject({
      status: "FAIL",
      exitCode: 1,
      checksRun: 0,
      sourceDrift: true
    })
    expect(run.result.sourceFingerprintBefore).not.toBe(
      run.result.sourceFingerprintAfter
    )
  })

  it("fails closed when the result artifact cannot be written", () => {
    const run = invokeMutationRunner({ resultKind: "directory" })

    expect(run.child.status).toBe(1)
    expect(run.result).toBeNull()
    expect(run.stderr).toContain("Could not write mutation result")
    expect(run.stdout).toContain('"status": "FAIL"')
    expect(run.stdout).toContain("artifactWriteError")
  })

  it("preserves native timeout and error counts instead of treating them as killed", () => {
    const run = invokeMutationRunner({
      report: mutationReport([
        "Killed",
        "NoCoverage",
        "Timeout",
        "RuntimeError",
        "CompileError",
        "Survived",
        "Ignored",
        "Pending"
      ])
    })

    expect(run.child.status).toBe(1)
    expect(run.result).toMatchObject({
      status: "FAIL",
      childExitCode: 0,
      mutantsTotal: 48,
      mutantsKilled: 6,
      mutantsNoCoverage: 6,
      mutantsTimedOut: 6,
      mutantsErrored: 12,
      mutantsIncomplete: 12,
      mutationScorePercent: 12.5,
      statusCounts: {
        Killed: 6,
        NoCoverage: 6,
        Timeout: 6,
        RuntimeError: 6,
        CompileError: 6,
        Survived: 6,
        Ignored: 6,
        Pending: 6
      }
    })
    expect(
      Object.values(run.result.statusCounts as Record<string, number>).reduce(
        (sum, count) => sum + count,
        0
      )
    ).toBe(run.result.mutantsTotal)
  })
})
