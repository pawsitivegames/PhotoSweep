import { createHash } from "node:crypto"
import { readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"

import { computeSourceFingerprint } from "./source-fingerprint.mjs"

// These are the runtime inputs to the configured mutation tests. Stryker
// tracks selected test and target contents itself, so unrelated CI workflows,
// tests, and release-verification scripts do not belong in this key.
export const MUTATION_CACHE_SOURCE_ROOTS = Object.freeze([
  "lib",
  "components",
  "tabs",
  "scripts",
  "workers",
  "background",
  "contents",
  "server",
  "Google-Photos-Toolkit",
  "tests/fixtures",
  "tests/setup.ts",
  "tools/write-build-flags.mjs",
  "verification/mutation-scope.mjs",
  "verification/source-fingerprint.mjs",
  "verification/stryker-vitest-runner-compat.mjs",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "lib/generated/build-flags.ts",
  "tsconfig.json",
  "tsconfig.test.json",
  "vitest.config.mts",
  "stryker.config.mjs"
])

const CACHE_ENVIRONMENT_KEYS = [
  "CI",
  "FAST_CHECK_NUM_RUNS",
  "FAST_CHECK_SEED",
  "LANG",
  "LC_ALL",
  "NODE_ENV",
  "NODE_OPTIONS",
  "PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT",
  "PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL",
  "PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION",
  "TLA_TOOLS_JAR",
  "TZ",
  "VERIFICATION_SCOPE",
  "VERIFICATION_TLC_JAR"
]

function externalFileIdentity(root, configuredPath) {
  if (!configuredPath) return null
  const absolutePath = resolve(root, configuredPath)
  try {
    if (!statSync(absolutePath).isFile()) {
      return { configuredPath, status: "not-a-file" }
    }
    return {
      configuredPath,
      status: "file",
      sha256: createHash("sha256")
        .update(readFileSync(absolutePath))
        .digest("hex")
    }
  } catch {
    return { configuredPath, status: "missing" }
  }
}

/**
 * Stryker can safely compare edits to configured mutation targets and test
 * files with its incremental report. Keep shared setup and every other source
 * input in this compatibility key because Stryker does not detect those
 * inputs changing.
 * @param {{
 *   root?: string,
 *   sourceRoots?: string[],
 *   mutationTargets?: string[],
 *   mutationTestFiles?: string[],
 *   env?: Record<string, string | undefined>,
 *   runtime?: { versions?: { node?: string }, platform?: string, arch?: string }
 * }} options
 */
export function computeMutationIncrementalCacheFingerprint({
  root = process.cwd(),
  sourceRoots = MUTATION_CACHE_SOURCE_ROOTS,
  mutationTargets = [],
  mutationTestFiles = [],
  env = process.env,
  runtime = process
} = {}) {
  const normalizedRoot = resolve(root)
  const excludedPaths = [...new Set([...mutationTargets, ...mutationTestFiles])].sort()
  const compatibilitySource = computeSourceFingerprint(
    normalizedRoot,
    sourceRoots,
    { excludePaths: excludedPaths }
  )
  const environment = Object.fromEntries(
    CACHE_ENVIRONMENT_KEYS.map((key) => [key, env[key] ?? null])
  )
  const externalInputs = [
    externalFileIdentity(normalizedRoot, env.TLA_TOOLS_JAR),
    externalFileIdentity(normalizedRoot, env.VERIFICATION_TLC_JAR)
  ]
  const payload = {
    schemaVersion: 2,
    root: normalizedRoot,
    sourceRoots: [...sourceRoots].sort(),
    excludedPaths,
    mutationTestFiles: [...mutationTestFiles].sort(),
    compatibilitySourceFingerprint: compatibilitySource.digest,
    runtime: {
      node: runtime.versions?.node ?? null,
      platform: runtime.platform ?? null,
      arch: runtime.arch ?? null
    },
    environment,
    externalInputs
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
  return {
    algorithm: "sha256",
    digest,
    compatibilitySourceFingerprint: compatibilitySource.digest,
    compatibilityFileCount: compatibilitySource.fileCount,
    excludedPaths
  }
}
