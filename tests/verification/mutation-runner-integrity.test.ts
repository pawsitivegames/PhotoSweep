import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import {
  computeMutationIncrementalCacheFingerprint,
  MUTATION_CACHE_SOURCE_ROOTS
} from "../../verification/mutation-incremental-cache.mjs"
import {
  MUTATION_TARGETS,
  MUTATION_TEST_FILES
} from "../../verification/mutation-scope.mjs"
import { applyStrykerVitestRunnerCompat } from "../../verification/stryker-vitest-runner-compat.mjs"

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
  policyReport?: unknown
  triagePolicy?: unknown
  bindTriagePolicy?: boolean
  policyOverrides?: Record<string, unknown>
  diagnosticTriageRefresh?: boolean
  preserveExistingGateResult?: boolean
  locale?: string
  mode?: string
  exitCode?: number
  mutateSource?: boolean
  initialTestBuildFlags?: boolean
  mutateBuildFlags?: boolean
  outputEntries?: Array<[string, string]>
  runnerKind?: string
  resultKind?: "file" | "directory"
  sourceRoots?: string[]
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

function writeStrykerVitestRunnerFixture(root: string, version = "10.0.0") {
  const packageRoot = join(root, "node_modules/@stryker-mutator/vitest-runner")
  mkdirSync(join(packageRoot, "dist/src"), { recursive: true })
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ version })
  )
  writeFileSync(
    join(packageRoot, "dist/src/test-helpers.js"),
    `export function collectTestName({ name, suite }) {
    const nameParts = [name];
    return nameParts.join(' ').trim();
}
`
  )
  writeFileSync(
    join(packageRoot, "dist/src/stryker-setup.js"),
    `function collectTestName({ name, suite }) {
    const nameParts = [name];
    return nameParts.join(' ').trim();
}
`
  )
  writeFileSync(
    join(packageRoot, "dist/src/vitest-test-runner.js"),
    `        const dryRunResult = await this.run({
            testIds: options.testFilter,
            relatedFiles: [options.sandboxFileName],
        });
        const hitCount = this.readHitCount();`
  )
  return packageRoot
}

function writeStrykerCoreFixture(root: string, version = "10.0.0") {
  const packageRoot = join(root, "node_modules/@stryker-mutator/core")
  mkdirSync(join(packageRoot, "dist/src/sandbox"), { recursive: true })
  writeStrykerLegacyTypescriptFixture(root)
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ version })
  )
  writeFileSync(
    join(packageRoot, "dist/src/sandbox/ts-config-preprocessor.js"),
    `import path from 'path';
import { tokens, commonTokens } from '@stryker-mutator/api/plugin';
/**
 * A helper class that rewrites \`references\` and \`extends\` file paths
 */
export class TSConfigPreprocessor {
    async rewriteTSConfigFile(project, tsconfigFileName) {
        const tsconfigFile = project.files.get(tsconfigFileName);
        if (tsconfigFile) {
                const { default: ts } = await import('typescript');
                const { config } = ts.parseConfigFileTextToJson(tsconfigFileName, await tsconfigFile.readContent());
            if (config) {
                this.rewriteProjectReferences(project, config, tsconfigFileName);
            }
        }
    }
    async rewriteProjectReferences(project, config, originTSConfigFileName) {
        const { default: ts } = await import('typescript');
        if (Array.isArray(config.references)) {
            for (const reference of config.references) {
                const referencePath = ts.resolveProjectReferencePath(reference);
                this.tryRewriteReference(referencePath, originTSConfigFileName);
            }
        }
    }
}
`
  )
  return packageRoot
}

function writeStrykerLegacyTypescriptFixture(
  root: string,
  version = "5.8.2",
  includeRequiredApis = true
) {
  const packageRoot = join(
    root,
    "node_modules/typescript-stryker-compat"
  )
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "typescript", version })
  )
  writeFileSync(
    join(packageRoot, "index.js"),
    includeRequiredApis
      ? "module.exports = { parseConfigFileTextToJson() {}, resolveProjectReferencePath() {} }\n"
      : "module.exports = {}\n"
  )
  return packageRoot
}

function patchStrykerCoreWithPreviousTypescript7Compat(packageRoot: string) {
  const path = join(
    packageRoot,
    "dist/src/sandbox/ts-config-preprocessor.js"
  )
  const original = readFileSync(path, "utf8")
  const manualHelpers = String.raw`function parseTSConfig(content) {
    const parseErrors = [];
    // TypeScript ignores a byte order mark, but jsonc-parser does not.
    const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
    const config = parse(text, parseErrors, { allowTrailingComma: true });
    return parseErrors.length ? undefined : config;
}

function resolveProjectReferencePath(reference) {
    const project = reference.path.replace(/\\/g, '/');
    return project.endsWith('.json') ? project : project.replace(/\\/+$/, '') + '/tsconfig.json';
}

`
  const legacyPatched = original
    .replace(
      "import path from 'path';",
      "import path from 'path';\nimport { parse } from 'jsonc-parser';"
    )
    .replace(
      "/**\n * A helper class that rewrites `references` and `extends` file paths",
      `${manualHelpers}/**\n * A helper class that rewrites \`references\` and \`extends\` file paths`
    )
    .replace(
      "                const { default: ts } = await import('typescript');\n                const { config } = ts.parseConfigFileTextToJson(tsconfigFileName, await tsconfigFile.readContent());",
      "                const config = parseTSConfig(await tsconfigFile.readContent());"
    )
    .replace(
      "        const { default: ts } = await import('typescript');\n        if (Array.isArray(config.references)) {\n            for (const reference of config.references) {\n                const referencePath = ts.resolveProjectReferencePath(reference);",
      "        if (Array.isArray(config.references)) {\n            for (const reference of config.references) {\n                const referencePath = resolveProjectReferencePath(reference);"
    )
  if (legacyPatched === original) {
    throw new Error("Could not construct the previous Stryker compatibility fixture.")
  }
  writeFileSync(path, legacyPatched)
}

function compareCanonicalStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
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
  for (const file of Object.values(canonical.files ?? {}) as Array<Record<string, unknown>>) {
    const mutants = file.mutants
    if (!Array.isArray(mutants)) continue
    mutants.sort((left, right) => {
      const leftCanonical = JSON.stringify(sortCanonicalKeys(left))
      const rightCanonical = JSON.stringify(sortCanonicalKeys(right))
      return compareCanonicalStrings(leftCanonical, rightCanonical)
    })
  }
  if (canonical.config?.jsonReporter?.fileName) {
    canonical.config.jsonReporter.fileName = "<mutation-report>"
  }
  if (canonical.config?.tempDirName) canonical.config.tempDirName = "<stryker-tmp>"
  if (canonical.config?.incrementalFile) {
    canonical.config.incrementalFile = "<mutation-incremental-cache>"
  }
  if (canonical.projectRoot) canonical.projectRoot = "<project-root>"
  if (
    canonical.config?.testRunner === "vitest" &&
    canonical.framework?.dependencies
  ) {
    delete canonical.framework.dependencies.mocha
  }
  canonical.files = Object.fromEntries(
    Object.entries(canonical.files ?? {}).sort(([a], [b]) =>
      compareCanonicalStrings(a, b)
    )
  )
  canonical.testFiles = Object.fromEntries(
    Object.entries(canonical.testFiles ?? {}).sort(([a], [b]) =>
      compareCanonicalStrings(a, b)
    )
  )
  function sortCanonicalKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortCanonicalKeys)
    if (value === null || typeof value !== "object") return value
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCanonicalStrings(left, right))
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
  policyReport = report,
  triagePolicy,
  bindTriagePolicy = true,
  policyOverrides = {},
  diagnosticTriageRefresh = false,
  preserveExistingGateResult = false,
  locale,
  mode = "write",
  exitCode = 0,
  mutateSource = false,
  initialTestBuildFlags = false,
  mutateBuildFlags = false,
  outputEntries = [] as Array<[string, string]>,
  runnerKind = "stub",
  resultKind = "file",
  sourceRoots
}: RunnerOptions = {}) {
  const temporaryRoot = mkdtempSync(
    join(repositoryRoot, "tmp/mutation-runner-integrity-")
  )
  const outputDirectory = join(temporaryRoot, "mutation-run")
  const resultPath = join(
    temporaryRoot,
    resultKind === "directory" ? "mutation-result" : "mutation.json"
  )
  const gateResultPath = join(
    temporaryRoot,
    "tmp/verification/current/mutation.json"
  )
  const gateResultFields = {
    schemaVersion: 1,
    runId: "prior-gate-run",
    sourceFingerprint: "a".repeat(64),
    sourceFingerprintBefore: "a".repeat(64),
    sourceFingerprintAfter: "a".repeat(64),
    sourceDrift: false,
    status: "PASS",
    exitCode: 0,
    checksRun: 1,
    mutationScorePercent: 100,
    criticalSurvivors: 0
  }
  const gateResultSentinel = `${JSON.stringify(gateResultFields, null, 2)}\n`
  if (preserveExistingGateResult) {
    mkdirSync(resolve(gateResultPath, ".."), { recursive: true })
    writeFileSync(gateResultPath, gateResultSentinel)
  }
  const reportInput = join(temporaryRoot, "report-input.json")
  const triagePolicyInput = join(temporaryRoot, "triage-policy.json")
  const strykerPath = join(temporaryRoot, "node_modules/.bin/stryker")
  mkdirSync(join(temporaryRoot, "lib"), { recursive: true })
  writeFileSync(join(temporaryRoot, "lib/source.js"), "before\n")
  if (initialTestBuildFlags) {
    mkdirSync(join(temporaryRoot, "tools"), { recursive: true })
    mkdirSync(join(temporaryRoot, "lib/generated"), { recursive: true })
    writeFileSync(
      join(temporaryRoot, "lib/generated/build-flags.ts"),
      "export const ALLOW_DEV_ENTITLEMENT = true\n"
    )
    writeFileSync(
      join(temporaryRoot, "tools/write-build-flags.mjs"),
      [
        'import fs from "node:fs"',
        'import path from "node:path"',
        'const allowDev = process.env.PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT === "1"',
        'const output = path.join(process.cwd(), "lib/generated/build-flags.ts")',
        'fs.mkdirSync(path.dirname(output), { recursive: true })',
        'fs.writeFileSync(output, "export const ALLOW_DEV_ENTITLEMENT = " + allowDev)'
      ].join("\n")
    )
  }
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

  writeStrykerVitestRunnerFixture(temporaryRoot)
  writeStrykerCoreFixture(temporaryRoot)
  if (runnerKind === "stub") {
    mkdirSync(resolve(strykerPath, ".."), { recursive: true })
    writeFileSync(
      strykerPath,
      `#!/usr/bin/env node
const fs = require("node:fs")
const path = require("node:path")
const mode = process.env.VERIFICATION_STUB_MODE
fs.writeFileSync(
  path.join(process.env.VERIFICATION_MUTATION_DIR, "incremental-file.txt"),
  process.env.VERIFICATION_MUTATION_INCREMENTAL_FILE ?? ""
)
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
if (process.env.VERIFICATION_STUB_MUTATE_BUILD_FLAGS === "1") {
  fs.writeFileSync(path.join(process.env.VERIFICATION_ROOT, "lib/generated/build-flags.ts"), "test build flags\\n")
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
          rawReportSha256: canonicalMutationReportHash(policyReport),
          ...policyOverrides
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
    const childEnvironment = {
      ...process.env,
      ...(locale ? { LANG: locale, LC_ALL: locale } : {}),
      VERIFICATION_ROOT: temporaryRoot,
      VERIFICATION_MUTATION_DIR: outputDirectory,
      VERIFICATION_MUTATION_OUTPUT: preserveExistingGateResult
        ? gateResultPath
        : resultPath,
      VERIFICATION_RUN_ID: "mutation-runner-integrity-test",
      VERIFICATION_STUB_MODE: mode,
      VERIFICATION_STUB_EXIT: String(exitCode),
      VERIFICATION_STUB_MUTATE_SOURCE: mutateSource ? "1" : "0",
      VERIFICATION_STUB_MUTATE_BUILD_FLAGS: mutateBuildFlags ? "1" : "0",
      VERIFICATION_STUB_REPORT: reportInput,
      ...(sourceRoots
        ? { VERIFICATION_SOURCE_ROOTS: JSON.stringify(sourceRoots) }
        : {}),
      ...(triagePolicy !== undefined
        ? { VERIFICATION_MUTATION_TRIAGE_POLICY: triagePolicyInput }
        : {})
    }
    const child = spawnSync(
      process.execPath,
      [
        mutationRunner,
        ...(diagnosticTriageRefresh ? ["--diagnostic-refresh-triage"] : [])
      ],
      {
        cwd: repositoryRoot,
        env: childEnvironment,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024
      }
    )
    const expectedMutationCacheFingerprint = computeMutationIncrementalCacheFingerprint({
      root: temporaryRoot,
      sourceRoots: [...MUTATION_CACHE_SOURCE_ROOTS],
      mutationTargets: [...MUTATION_TARGETS],
      mutationTestFiles: [...MUTATION_TEST_FILES],
      env: childEnvironment
    })
    const diagnosticResultRoot = join(
      temporaryRoot,
      "tmp/verification/diagnostic-refresh"
    )
    const diagnosticResultPath =
      diagnosticTriageRefresh && existsSync(diagnosticResultRoot)
        ? join(diagnosticResultRoot, readdirSync(diagnosticResultRoot)[0], "mutation.json")
        : null
    const effectiveResultPath = diagnosticResultPath ?? resultPath
    const result =
      resultKind === "file" && existsSync(effectiveResultPath)
        ? JSON.parse(readFileSync(effectiveResultPath, "utf8"))
        : null
    const markerPath = join(outputDirectory, "stale-marker.json")
    return {
      child,
      result,
      diagnosticResultPath,
      gateResultAfterRun: existsSync(gateResultPath)
        ? readFileSync(gateResultPath, "utf8")
        : null,
      gateResultSentinel,
      marker: existsSync(markerPath) ? readFileSync(markerPath, "utf8") : null,
      rawReport: existsSync(join(outputDirectory, "stryker-raw.json"))
        ? readFileSync(join(outputDirectory, "stryker-raw.json"), "utf8")
        : null,
      incrementalFile: existsSync(join(outputDirectory, "incremental-file.txt"))
        ? readFileSync(join(outputDirectory, "incremental-file.txt"), "utf8")
        : null,
      expectedMutationCacheFingerprint: expectedMutationCacheFingerprint.digest,
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
  it("keeps the pinned TLC JAR out of disposable Stryker worker copies", async () => {
    const config = await import("../../stryker.config.mjs")

    expect(config.default.ignorePatterns).toContain(
      "/verification/tooling/tla2tools-1.8.0.jar"
    )
    expect(config.default.ignorePatterns).toContain("/tmp/**")
  })

  it("patches the pinned Vitest runner and is idempotent", () => {
    const temporaryRoot = mkdtempSync(
      join(repositoryRoot, "tmp/stryker-vitest-compat-integrity-")
    )
    try {
      const packageRoot = writeStrykerVitestRunnerFixture(temporaryRoot)
      const corePackageRoot = writeStrykerCoreFixture(temporaryRoot)
      const patched = applyStrykerVitestRunnerCompat(temporaryRoot)
      expect(patched).toMatchObject({
        runnerVersion: "10.0.0",
        coreVersion: "10.0.0",
        legacyTypescriptVersion: "5.8.2",
        changedFiles: [
          "dist/src/test-helpers.js",
          "dist/src/stryker-setup.js",
          "dist/src/vitest-test-runner.js",
          "@stryker-mutator/core/dist/src/sandbox/ts-config-preprocessor.js"
        ]
      })
      expect(
        readFileSync(join(packageRoot, "dist/src/test-helpers.js"), "utf8")
      ).toContain("nameParts.join(' > ')")
      expect(
        readFileSync(join(packageRoot, "dist/src/stryker-setup.js"), "utf8")
      ).toContain("nameParts.join(' > ')")
      expect(
        readFileSync(
          join(packageRoot, "dist/src/vitest-test-runner.js"),
          "utf8"
        )
      ).toContain("retrying (' + retries + '/3)")
      const coreSource = readFileSync(
        join(
          corePackageRoot,
          "dist/src/sandbox/ts-config-preprocessor.js"
        ),
        "utf8"
      )
      expect(
        coreSource.match(/import\('typescript-stryker-compat'\)/g)
      ).toHaveLength(2)
      expect(coreSource).toContain("ts.parseConfigFileTextToJson")
      expect(coreSource).toContain("ts.resolveProjectReferencePath")
      expect(coreSource).not.toContain("jsonc-parser")
      expect(coreSource).not.toContain("function parseTSConfig")
      expect(coreSource).not.toContain("function resolveProjectReferencePath")
      expect(coreSource).not.toContain("import('typescript')")
      expect(applyStrykerVitestRunnerCompat(temporaryRoot).changedFiles).toEqual(
        []
      )
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it("routes Stryker config parsing and project references through pinned TypeScript APIs", () => {
    const temporaryRoot = mkdtempSync(
      join(repositoryRoot, "tmp/stryker-typescript-alias-integrity-")
    )
    try {
      writeStrykerVitestRunnerFixture(temporaryRoot)
      const corePackageRoot = writeStrykerCoreFixture(temporaryRoot)
      writeStrykerLegacyTypescriptFixture(temporaryRoot)

      const patched = applyStrykerVitestRunnerCompat(temporaryRoot)
      const coreSource = readFileSync(
        join(
          corePackageRoot,
          "dist/src/sandbox/ts-config-preprocessor.js"
        ),
        "utf8"
      )

      expect(patched).toMatchObject({ legacyTypescriptVersion: "5.8.2" })
      expect(
        coreSource.match(/import\('typescript-stryker-compat'\)/g)
      ).toHaveLength(2)
      expect(coreSource).toContain("ts.parseConfigFileTextToJson")
      expect(coreSource).toContain("ts.resolveProjectReferencePath")
      expect(coreSource).not.toContain("jsonc-parser")
      expect(coreSource).not.toContain("function parseTSConfig")
      expect(coreSource).not.toContain("function resolveProjectReferencePath")
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it("migrates an existing manual Stryker compatibility patch", () => {
    const temporaryRoot = mkdtempSync(
      join(repositoryRoot, "tmp/stryker-typescript-alias-migration-")
    )
    try {
      writeStrykerVitestRunnerFixture(temporaryRoot)
      const corePackageRoot = writeStrykerCoreFixture(temporaryRoot)
      patchStrykerCoreWithPreviousTypescript7Compat(corePackageRoot)

      expect(() => applyStrykerVitestRunnerCompat(temporaryRoot)).not.toThrow()

      const coreSource = readFileSync(
        join(
          corePackageRoot,
          "dist/src/sandbox/ts-config-preprocessor.js"
        ),
        "utf8"
      )
      expect(
        coreSource.match(/import\('typescript-stryker-compat'\)/g)
      ).toHaveLength(2)
      expect(coreSource).not.toContain("jsonc-parser")
      expect(coreSource).not.toContain("function parseTSConfig")
      expect(coreSource).not.toContain("function resolveProjectReferencePath")
      expect(coreSource).toContain("ts.parseConfigFileTextToJson")
      expect(coreSource).toContain("ts.resolveProjectReferencePath")
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it("keeps Stryker's TypeScript 5 APIs isolated from the TypeScript 7 app compiler", async () => {
    const legacyTypescript = (await import("typescript-stryker-compat")).default
    const appTypescript = (await import("typescript")).default
    const parsed = legacyTypescript.parseConfigFileTextToJson(
      "tsconfig.json",
      `{
        // TypeScript configuration accepts JSONC comments and trailing commas.
        "references": [{ "path": "./model" },],
      }`
    )

    expect(legacyTypescript.version).toBe("5.8.2")
    expect(parsed.error).toBeUndefined()
    expect(parsed.config.references).toEqual([{ path: "./model" }])
    expect(legacyTypescript.resolveProjectReferencePath({ path: "./model" })).toBe(
      "./model/tsconfig.json"
    )
    expect(appTypescript.version).toMatch(/^7\./)
    expect("parseConfigFileTextToJson" in appTypescript).toBe(false)
    expect("resolveProjectReferencePath" in appTypescript).toBe(false)
  })

  it("runs the real Stryker preprocessor on a JSONC project config", async () => {
    applyStrykerVitestRunnerCompat(repositoryRoot)
    const preprocessorModule = await import(
      pathToFileURL(
        join(
          repositoryRoot,
          "node_modules/@stryker-mutator/core/dist/src/sandbox/ts-config-preprocessor.js"
        )
      ).href
    )
    const tsconfigFileName = join(
      repositoryRoot,
      "tmp/stryker-preprocessor-compat/tsconfig.json"
    )
    const original = `\uFEFF{
      // Preserve TypeScript's supported JSONC config behavior.
      "references": [{ "path": "./model" },],
    }`
    let rewritten: string | undefined
    const file = {
      readContent: async () => original,
      setContent: (content: string) => {
        rewritten = content
      }
    }
    const preprocessor = new preprocessorModule.TSConfigPreprocessor(
      { debug: () => undefined },
      { inPlace: false, tsconfigFile: tsconfigFileName }
    )

    await preprocessor.preprocess({
      files: new Map([[tsconfigFileName, file]])
    })

    expect(JSON.parse(rewritten ?? "{}")).toMatchObject({
      references: [{ path: "./model" }]
    })
  })

  it("fails closed when the legacy TypeScript alias lacks Stryker APIs", () => {
    const temporaryRoot = mkdtempSync(
      join(repositoryRoot, "tmp/stryker-typescript-alias-api-")
    )
    try {
      writeStrykerVitestRunnerFixture(temporaryRoot)
      writeStrykerCoreFixture(temporaryRoot)
      writeStrykerLegacyTypescriptFixture(temporaryRoot, "5.8.2", false)

      expect(() => applyStrykerVitestRunnerCompat(temporaryRoot)).toThrow(
        "typescript-stryker-compat does not expose the Stryker TypeScript APIs"
      )
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it("fails closed when the Stryker TypeScript alias version changes", () => {
    const temporaryRoot = mkdtempSync(
      join(repositoryRoot, "tmp/stryker-typescript-alias-version-")
    )
    try {
      writeStrykerVitestRunnerFixture(temporaryRoot)
      writeStrykerCoreFixture(temporaryRoot)
      writeStrykerLegacyTypescriptFixture(temporaryRoot, "5.9.3")

      expect(() => applyStrykerVitestRunnerCompat(temporaryRoot)).toThrow(
        "expected typescript-stryker-compat alias for TypeScript 5.8.2, found typescript@5.9.3"
      )
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it("fails closed when the Stryker Vitest runner version changes", () => {
    const temporaryRoot = mkdtempSync(
      join(repositoryRoot, "tmp/stryker-vitest-compat-version-")
    )
    try {
      writeStrykerVitestRunnerFixture(temporaryRoot, "10.1.0")
      expect(() => applyStrykerVitestRunnerCompat(temporaryRoot)).toThrow(
        "expected @stryker-mutator/vitest-runner 10.0.0, found 10.1.0"
      )
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it("fails closed when the Stryker core version changes", () => {
    const temporaryRoot = mkdtempSync(
      join(repositoryRoot, "tmp/stryker-core-compat-version-")
    )
    try {
      writeStrykerVitestRunnerFixture(temporaryRoot)
      writeStrykerCoreFixture(temporaryRoot, "10.1.0")
      expect(() => applyStrykerVitestRunnerCompat(temporaryRoot)).toThrow(
        "expected @stryker-mutator/core 10.0.0, found 10.1.0"
      )
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it("fails closed when the pinned Stryker core preprocessor anchor changes", () => {
    const temporaryRoot = mkdtempSync(
      join(repositoryRoot, "tmp/stryker-core-compat-anchor-")
    )
    try {
      writeStrykerVitestRunnerFixture(temporaryRoot)
      const corePackageRoot = writeStrykerCoreFixture(temporaryRoot)
      const preprocessorPath = join(
        corePackageRoot,
        "dist/src/sandbox/ts-config-preprocessor.js"
      )
      writeFileSync(
        preprocessorPath,
        readFileSync(preprocessorPath, "utf8").replace(
          "ts.parseConfigFileTextToJson",
          "ts.parseUnknownConfigFormat"
        )
      )
      expect(() => applyStrykerVitestRunnerCompat(temporaryRoot)).toThrow(
        "expected one TypeScript 7 tsconfig parsing anchor"
      )
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

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
    expect(run.incrementalFile).toBe(
      `tmp/verification/mutation-incremental/${run.result.mutationIncrementalCacheFingerprint}-node-${process.versions.node}.json`
    )
    expect(run.result.mutationIncrementalCacheFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(run.result.mutationIncrementalCompatibilitySourceFingerprint).toMatch(
      /^[a-f0-9]{64}$/
    )
    expect(run.result.mutationIncrementalCacheFingerprint).not.toBe(
      run.result.sourceFingerprint
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

  it("keeps the mutation cache scoped when verification supplies broad source roots", () => {
    const run = invokeMutationRunner({
      sourceRoots: ["lib", "verification", "docs"]
    })

    expect(run.child.status).toBe(0)
    expect(run.result).toMatchObject({ status: "PASS", sourceDrift: false })
    expect(run.result.mutationIncrementalCacheFingerprint).toBe(
      run.expectedMutationCacheFingerprint
    )
    expect(run.incrementalFile).toBe(
      `tmp/verification/mutation-incremental/${run.expectedMutationCacheFingerprint}-node-${process.versions.node}.json`
    )
  })

  it("matches triage policy locations regardless of JSON property order", () => {
    const report = mutationReport([
      "Killed",
      "Killed",
      "Killed",
      "Killed",
      "Killed",
      "Killed",
      "Killed",
      "Killed",
      "Killed",
      "Survived"
    ])
    const triagePolicy = triagePolicyFor(report, "EQUIVALENT")
    for (const entry of triagePolicy.entries) {
      entry.location = {
        end: entry.location.end,
        start: entry.location.start
      }
    }

    const run = invokeMutationRunner({ report, triagePolicy })

    expect(run.result).toMatchObject({
      status: "PASS",
      mutationTriagePolicyStatus: "VALID",
      mutantsReviewed: 6,
      mutantsResolved: 6,
      mutantsUnresolved: 0,
      mutantsUnreviewed: 0
    })
    expect(run.triage?.summary).toMatchObject({
      mutantsResolved: 6,
      mutantsUnresolved: 0,
      mutantsUnreviewed: 0
    })
  })

  it("fails before starting Stryker when the triage source fingerprint is stale", () => {
    const report = mutationReport(["Survived"])
    const triagePolicy = {
      ...triagePolicyFor(report, "EQUIVALENT"),
      sourceFingerprint: "stale-source-fingerprint",
      rawReportSha256: "0".repeat(64)
    }
    const run = invokeMutationRunner({
      report,
      triagePolicy,
      bindTriagePolicy: false
    })

    expect(run.result).toMatchObject({
      status: "FAIL",
      exitCode: 1,
      checksRun: 0,
      mutantsTotal: 0,
      mutationTriagePolicyStatus: "STALE_OR_INVALID",
      mutationTriagePolicyError: expect.stringContaining("source fingerprint")
    })
    expect(run.rawReport).toBeNull()
    expect(run.triage).toBeNull()
    expect(run.stdout).toContain("Stryker was not run")
  })

  it("keeps an explicit stale-policy report refresh diagnostic-only", () => {
    const report = mutationReport(["Killed"])
    const triagePolicy = {
      ...triagePolicyFor(report, "EQUIVALENT"),
      sourceFingerprint: "stale-source-fingerprint"
    }
    const run = invokeMutationRunner({
      report,
      triagePolicy,
      bindTriagePolicy: false,
      diagnosticTriageRefresh: true,
      preserveExistingGateResult: true
    })

    expect(run.child.status).toBe(1)
    expect(run.gateResultAfterRun).toBe(run.gateResultSentinel)
    expect(run.diagnosticResultPath).toContain("diagnostic-refresh")
    expect(run.diagnosticResultPath).not.toBe(
      join(repositoryRoot, "tmp/verification/current/mutation.json")
    )
    expect(run.result).toMatchObject({
      status: "FAIL",
      exitCode: 1,
      childExitCode: 0,
      checksRun: 1,
      mutantsTotal: 6,
      mutationTriagePolicyStatus: "STALE_OR_INVALID",
      mutationTriagePolicyError: expect.stringContaining("source fingerprint")
    })
    expect(run.rawReport).not.toBeNull()
    expect(run.triage?.rawReportSha256).toEqual(expect.any(String))
    expect(run.stdout).toContain("cannot be accepted as PASS")
  })

  it("never accepts an explicit diagnostic refresh, even with a current policy", () => {
    const run = invokeMutationRunner({
      triagePolicy: triagePolicyFor(mutationReport(), "EQUIVALENT"),
      diagnosticTriageRefresh: true
    })

    expect(run.child.status).toBe(1)
    expect(run.result).toMatchObject({
      status: "FAIL",
      exitCode: 1,
      childExitCode: 0,
      checksRun: 1,
      mutationTriagePolicyStatus: "VALID",
      message: "Diagnostic triage refresh produced evidence for manual review; this run cannot be accepted as PASS."
    })
    expect(run.rawReport).not.toBeNull()
  })

  it("normalizes generated test entitlement flags before binding the source fingerprint", () => {
    const run = invokeMutationRunner({
      initialTestBuildFlags: true,
      mutateBuildFlags: true
    })

    expect(run.child.status).toBe(0)
    expect(run.result).toMatchObject({
      status: "PASS",
      exitCode: 0,
      checksRun: 1,
      sourceDrift: false
    })
    expect(run.result.sourceFingerprintBefore).toBe(
      run.result.sourceFingerprintAfter
    )
  })

  it("keeps Vitest triage bindings stable without optional Mocha metadata", () => {
    const reportWithoutMocha = {
      ...mutationReport(["Killed"]),
      config: { testRunner: "vitest" },
      framework: { dependencies: { typescript: "5.3.3" } }
    }
    const reportWithMocha = JSON.parse(JSON.stringify(reportWithoutMocha))
    reportWithMocha.framework.dependencies.mocha = "10.3.0"
    const triagePolicy = triagePolicyFor(reportWithoutMocha, "UNREACHABLE")

    const withoutMocha = invokeMutationRunner({
      report: reportWithoutMocha,
      triagePolicy
    })
    const withMocha = invokeMutationRunner({
      report: reportWithMocha,
      triagePolicy
    })

    expect(withoutMocha.child.status).toBe(0)
    expect(withMocha.child.status).toBe(0)
    expect(withMocha.triage.rawReportSha256).toBe(
      withoutMocha.triage.rawReportSha256
    )
    expect(withoutMocha.triage.policyStatus).toBe("VALID")
    expect(withMocha.triage.policyStatus).toBe("VALID")
  })

  it("keeps triage bindings stable when mutant arrays are reordered", () => {
    const report = mutationReport([
      ...Array.from({ length: 9 }, () => "Killed"),
      "Survived"
    ])
    const reorderedReport = JSON.parse(JSON.stringify(report))
    for (const file of Object.values(reorderedReport.files) as Array<{
      mutants: Array<Record<string, unknown>>
    }>) {
      file.mutants.reverse()
    }

    const run = invokeMutationRunner({
      report: reorderedReport,
      policyReport: report,
      triagePolicy: triagePolicyFor(report, "EQUIVALENT")
    })

    expect(run.result).toMatchObject({
      status: "PASS",
      mutationTriagePolicyStatus: "VALID",
      mutantsUnresolved: 0
    })
    expect(run.triage.rawReportSha256).toBe(
      canonicalMutationReportHash(report)
    )
  })

  it("keeps triage bindings stable when the runner uses another locale", () => {
    const report = mutationReport([
      ...Array.from({ length: 9 }, () => "Killed"),
      "Survived"
    ])
    Object.assign(report, { localeProbe: { z: "last in English", ä: "last in Swedish" } })

    const run = invokeMutationRunner({
      report,
      triagePolicy: triagePolicyFor(report, "EQUIVALENT"),
      locale: "sv_SE.UTF-8"
    })

    expect(run.result).toMatchObject({
      status: "PASS",
      mutationTriagePolicyStatus: "VALID",
      mutantsUnresolved: 0
    })
    expect(run.triage.rawReportSha256).toBe(
      canonicalMutationReportHash(report)
    )
  })

  it("keeps triage bindings stable when the incremental cache file changes", () => {
    const policyReport = mutationReport([
      ...Array.from({ length: 9 }, () => "Killed"),
      "Survived"
    ])
    Object.assign(policyReport, {
      config: {
        testRunner: "vitest",
        incrementalFile:
          "tmp/verification/mutation-incremental/old-source-node-24.json"
      }
    })
    const report = JSON.parse(JSON.stringify(policyReport))
    report.config.incrementalFile =
      "tmp/verification/mutation-incremental/new-source-node-24.json"

    const run = invokeMutationRunner({
      report,
      policyReport,
      triagePolicy: triagePolicyFor(policyReport, "EQUIVALENT")
    })

    expect(run.result).toMatchObject({
      status: "PASS",
      mutationTriagePolicyStatus: "VALID",
      mutantsUnresolved: 0
    })
    expect(run.triage.rawReportSha256).toBe(
      canonicalMutationReportHash(policyReport)
    )
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
      triagePolicy: triagePolicyFor(report, "UNREACHABLE"),
      policyOverrides: change as Record<string, unknown>
    })

    expect(run.child.status).toBe(1)
    expect(run.result.status).toBe("FAIL")
    expect(run.result.mutationTriagePolicyStatus).toMatch(/INVALID|STALE/)

    if (_label !== "report") {
      expect(run.result.checksRun).toBe(0)
      expect(run.rawReport).toBeNull()
      expect(run.triage).toBeNull()
      return
    }

    expect(run.result).toMatchObject({
      checksRun: 1,
      mutantsNoCoverage: 6,
      mutantsUnresolved: 6
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
