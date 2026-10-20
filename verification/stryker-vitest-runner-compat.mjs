import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

export const STRYKER_VITEST_COMPAT_PATCH_ID =
  "photosweep-stryker-vitest-runner-compat-v3"

const EXPECTED_RUNNER_VERSION = "10.0.0"
const EXPECTED_CORE_VERSION = "10.0.0"
const EXPECTED_LEGACY_TYPESCRIPT_VERSION = "5.8.2"

function replaceExactlyOnce(source, before, after, label) {
  if (source.includes(after)) return { source, changed: false }
  const first = source.indexOf(before)
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(
      `Cannot apply ${STRYKER_VITEST_COMPAT_PATCH_ID}: expected one ${label} anchor.`
    )
  }
  return {
    source: `${source.slice(0, first)}${after}${source.slice(first + before.length)}`,
    changed: true
  }
}

function removeExactlyOnce(source, value, label) {
  const first = source.indexOf(value)
  if (first < 0 || source.indexOf(value, first + value.length) >= 0) {
    throw new Error(
      `Cannot apply ${STRYKER_VITEST_COMPAT_PATCH_ID}: expected one ${label} anchor.`
    )
  }
  return `${source.slice(0, first)}${source.slice(first + value.length)}`
}

function patchFile(packageRoot, relativePath, before, after, label) {
  const path = join(packageRoot, relativePath)
  if (!existsSync(path)) {
    throw new Error(
      `Cannot apply ${STRYKER_VITEST_COMPAT_PATCH_ID}: missing ${relativePath}.`
    )
  }
  const source = readFileSync(path, "utf8")
  const result = replaceExactlyOnce(source, before, after, label)
  if (result.changed) writeFileSync(path, result.source)
  return result.changed
}

function normalizePreviousCoreCompatibility(source) {
  const previousMarkers = [
    "import { parse } from 'jsonc-parser';",
    "function parseTSConfig(content) {",
    "function resolveProjectReferencePath(reference) {",
    "const config = parseTSConfig(await tsconfigFile.readContent());",
    "const referencePath = resolveProjectReferencePath(reference);"
  ]
  const foundMarkers = previousMarkers.filter((marker) =>
    source.includes(marker)
  ).length
  if (foundMarkers === 0) return source
  if (foundMarkers !== previousMarkers.length) {
    throw new Error(
      `Cannot apply ${STRYKER_VITEST_COMPAT_PATCH_ID}: expected a complete previous Stryker compatibility patch.`
    )
  }

  const helperStart = source.indexOf("function parseTSConfig(content) {")
  const helperEnd = source.indexOf("/**", helperStart)
  const helperBlock = source.slice(helperStart, helperEnd)
  if (
    helperStart < 0 ||
    helperEnd < 0 ||
    !helperBlock.includes("parseErrors.length ? undefined : config") ||
    !helperBlock.includes("reference.path.replace") ||
    !helperBlock.includes("project.endsWith('.json')")
  ) {
    throw new Error(
      `Cannot apply ${STRYKER_VITEST_COMPAT_PATCH_ID}: previous Stryker compatibility helpers changed.`
    )
  }

  source = removeExactlyOnce(
    source,
    "import { parse } from 'jsonc-parser';\n",
    "previous JSONC parser import"
  )
  source = `${source.slice(0, source.indexOf(helperBlock))}${source.slice(
    source.indexOf(helperBlock) + helperBlock.length
  )}`
  source = replaceExactlyOnce(
    source,
    "                const config = parseTSConfig(await tsconfigFile.readContent());",
    "                const { default: ts } = await import('typescript');\n                const { config } = ts.parseConfigFileTextToJson(tsconfigFileName, await tsconfigFile.readContent());",
    "previous TypeScript config parser"
  ).source
  source = replaceExactlyOnce(
    source,
    "    async rewriteProjectReferences(project, config, originTSConfigFileName) {\n        if (Array.isArray(config.references)) {",
    "    async rewriteProjectReferences(project, config, originTSConfigFileName) {\n        const { default: ts } = await import('typescript');\n        if (Array.isArray(config.references)) {",
    "previous TypeScript project reference resolver import"
  ).source
  source = replaceExactlyOnce(
    source,
    "                const referencePath = resolveProjectReferencePath(reference);",
    "                const referencePath = ts.resolveProjectReferencePath(reference);",
    "previous TypeScript project reference resolver"
  ).source
  return source
}

function patchStrykerCore(root) {
  const packageRoot = join(root, "node_modules/@stryker-mutator/core")
  const packageJsonPath = join(packageRoot, "package.json")
  if (!existsSync(packageJsonPath)) {
    throw new Error(
      `Cannot apply ${STRYKER_VITEST_COMPAT_PATCH_ID}: Stryker core is not installed.`
    )
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
  if (packageJson.version !== EXPECTED_CORE_VERSION) {
    throw new Error(
      `Cannot apply ${STRYKER_VITEST_COMPAT_PATCH_ID}: expected @stryker-mutator/core ${EXPECTED_CORE_VERSION}, found ${packageJson.version ?? "unknown"}.`
    )
  }

  const legacyTypescriptPackagePath = join(
    root,
    "node_modules/typescript-stryker-compat/package.json"
  )
  if (!existsSync(legacyTypescriptPackagePath)) {
    throw new Error(
      `Cannot apply ${STRYKER_VITEST_COMPAT_PATCH_ID}: typescript-stryker-compat is not installed.`
    )
  }
  const legacyTypescriptPackage = JSON.parse(
    readFileSync(legacyTypescriptPackagePath, "utf8")
  )
  if (
    legacyTypescriptPackage.version !== EXPECTED_LEGACY_TYPESCRIPT_VERSION ||
    legacyTypescriptPackage.name !== "typescript"
  ) {
    throw new Error(
      `Cannot apply ${STRYKER_VITEST_COMPAT_PATCH_ID}: expected typescript-stryker-compat alias for TypeScript ${EXPECTED_LEGACY_TYPESCRIPT_VERSION}, found ${legacyTypescriptPackage.name ?? "unknown"}@${legacyTypescriptPackage.version ?? "unknown"}.`
    )
  }
  let legacyTypescriptApi
  try {
    legacyTypescriptApi = createRequire(join(root, "package.json"))(
      "typescript-stryker-compat"
    )
  } catch {
    throw new Error(
      `Cannot apply ${STRYKER_VITEST_COMPAT_PATCH_ID}: typescript-stryker-compat could not be loaded.`
    )
  }
  const legacyTypescript = legacyTypescriptApi.default ?? legacyTypescriptApi
  if (
    typeof legacyTypescript.parseConfigFileTextToJson !== "function" ||
    typeof legacyTypescript.resolveProjectReferencePath !== "function"
  ) {
    throw new Error(
      `Cannot apply ${STRYKER_VITEST_COMPAT_PATCH_ID}: typescript-stryker-compat does not expose the Stryker TypeScript APIs.`
    )
  }

  const relativePath = "dist/src/sandbox/ts-config-preprocessor.js"
  const path = join(packageRoot, relativePath)
  if (!existsSync(path)) {
    throw new Error(
      `Cannot apply ${STRYKER_VITEST_COMPAT_PATCH_ID}: missing @stryker-mutator/core/${relativePath}.`
    )
  }
  const originalSource = readFileSync(path, "utf8")
  let source = normalizePreviousCoreCompatibility(originalSource)
  let changed = source !== originalSource
  for (const [before, after, label] of [
    [
      "                const { default: ts } = await import('typescript');\n                const { config } = ts.parseConfigFileTextToJson(tsconfigFileName, await tsconfigFile.readContent());",
      "                const { default: ts } = await import('typescript-stryker-compat');\n                const { config } = ts.parseConfigFileTextToJson(tsconfigFileName, await tsconfigFile.readContent());",
      "TypeScript 7 tsconfig parsing"
    ],
    [
      "        const { default: ts } = await import('typescript');\n        if (Array.isArray(config.references)) {\n            for (const reference of config.references) {\n                const referencePath = ts.resolveProjectReferencePath(reference);",
      "        const { default: ts } = await import('typescript-stryker-compat');\n        if (Array.isArray(config.references)) {\n            for (const reference of config.references) {\n                const referencePath = ts.resolveProjectReferencePath(reference);",
      "TypeScript 7 project reference resolution"
    ]
  ]) {
    const result = replaceExactlyOnce(source, before, after, label)
    source = result.source
    changed ||= result.changed
  }
  if (changed) writeFileSync(path, source)
  return {
    coreVersion: packageJson.version,
    legacyTypescriptVersion: legacyTypescriptPackage.version,
    changed
  }
}

export function applyStrykerVitestRunnerCompat(root) {
  const packageRoot = join(
    root,
    "node_modules/@stryker-mutator/vitest-runner"
  )
  const packageJsonPath = join(packageRoot, "package.json")
  if (!existsSync(packageJsonPath)) {
    throw new Error(
      `Cannot apply ${STRYKER_VITEST_COMPAT_PATCH_ID}: Stryker Vitest runner is not installed.`
    )
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
  if (packageJson.version !== EXPECTED_RUNNER_VERSION) {
    throw new Error(
      `Cannot apply ${STRYKER_VITEST_COMPAT_PATCH_ID}: expected @stryker-mutator/vitest-runner ${EXPECTED_RUNNER_VERSION}, found ${packageJson.version ?? "unknown"}.`
    )
  }

  const changedFiles = []
  const nameJoinBefore = "    return nameParts.join(' ').trim();"
  const nameJoinAfter = "    return nameParts.join(' > ').trim();"
  for (const relativePath of [
    "dist/src/test-helpers.js",
    "dist/src/stryker-setup.js"
  ]) {
    if (
      patchFile(
        packageRoot,
        relativePath,
        nameJoinBefore,
        nameJoinAfter,
        "nested test-name separator"
      )
    ) {
      changedFiles.push(relativePath)
    }
  }

  const runBefore = `        const dryRunResult = await this.run({
            testIds: options.testFilter,
            relatedFiles: [options.sandboxFileName],
        });
        const hitCount = this.readHitCount();`
  const runAfter = `        const runFilter = {
            testIds: options.testFilter,
            relatedFiles: [options.sandboxFileName],
        };
        let dryRunResult = await this.run(runFilter);
        const isEmptyFilteredRun = () =>
            (options.testFilter?.length ?? 0) > 0 &&
                dryRunResult.status === DryRunStatus.Complete &&
                dryRunResult.tests.length === 0;
        let retries = 0;
        while (isEmptyFilteredRun() && retries < 3) {
            retries += 1;
            this.log.warn('Vitest selected ' + options.testFilter.length + ' tests for mutant ' + options.activeMutant.id + ', but executed none; retrying (' + retries + '/3).');
            dryRunResult = await this.run(runFilter);
        }
        if (isEmptyFilteredRun()) {
            return toMutantRunResult({
                status: DryRunStatus.Error,
                errorMessage: 'Vitest completed the mutant run without executing any of the ' + options.testFilter.length + ' tests selected for mutant ' + options.activeMutant.id + ' (after ' + retries + ' retries).',
            });
        }
        const hitCount = this.readHitCount();`
  if (
    patchFile(
      packageRoot,
      "dist/src/vitest-test-runner.js",
      runBefore,
      runAfter,
      "empty filtered mutant-run guard"
    )
  ) {
    changedFiles.push("dist/src/vitest-test-runner.js")
  }

  const coreCompatibility = patchStrykerCore(root)
  if (coreCompatibility.changed) {
    changedFiles.push(
      "@stryker-mutator/core/dist/src/sandbox/ts-config-preprocessor.js"
    )
  }

  return {
    patchId: STRYKER_VITEST_COMPAT_PATCH_ID,
    runnerVersion: packageJson.version,
    coreVersion: coreCompatibility.coreVersion,
    legacyTypescriptVersion: coreCompatibility.legacyTypescriptVersion,
    changedFiles
  }
}
