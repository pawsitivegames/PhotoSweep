import { execFileSync, spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { runKeeperSelectionTlc } from "../../verification/run-keeper-selection-tlc.mjs"
import { RECOVERY_AUTHORITY_CORRESPONDENCE_PATHS } from "../../verification/recovery-authority-model-evidence.mjs"
import {
  computeMutationIncrementalCacheFingerprint,
  MUTATION_CACHE_SOURCE_ROOTS
} from "../../verification/mutation-incremental-cache.mjs"
import { computeSourceFingerprint } from "../../verification/source-fingerprint.mjs"

const root = resolve(process.cwd())

describe("verification runner integrity", () => {
  it("keeps the SAFE-13 evidence selector matched to its registered assertion", () => {
    const runnerSource = readFileSync(
      join(root, "verification/verification-runner.mjs"),
      "utf8"
    )
    const selectorSource = runnerSource.match(
      /"SAFE-13-properties":\s*\/([^/]+)\//
    )
    const propertiesSource = readFileSync(
      join(root, "tests/verification/safety-properties.test.ts"),
      "utf8"
    )
    const assertionTitle = propertiesSource.match(
      /it\("([^"]*SAFE-13[^"]*)"/
    )?.[1]

    expect(selectorSource).not.toBeNull()
    expect(assertionTitle).toBeDefined()
    const selector = new RegExp(selectorSource?.[1] ?? "(?!)")
    expect(
      selector.test(`generated safety properties ${assertionTitle}`)
    ).toBe(true)
  })

  it("rejects a stale PASS artifact when a fresh model command fails", () => {
    const temporaryRoot = mkdtempSync(
      join(root, "tmp/verification-runner-stale-pass-")
    )
    const runDirectory = join(temporaryRoot, "tmp/verification/runner-run")
    const archiveDirectory = join(temporaryRoot, "tmp/verification/runner-archive")
    const stalePath = join(
      temporaryRoot,
      "tmp/verification/current/model-SAFE-01.json"
    )
    const invalidTlcJarPath = join(
      temporaryRoot,
      "tmp/verification/invalid-tlc-tools.jar"
    )
    const vitestStubPath = join(temporaryRoot, "node_modules/.bin/vitest")
    const stalePass = JSON.stringify(
      {
        schemaVersion: 1,
        id: "SAFE-01-model",
        status: "PASS",
        runId: "stale-run-that-must-not-be-used",
        modelComplete: true,
        statesExplored: 999999
      },
      null,
      2
    )
    try {
      const sourceRegistry = JSON.parse(
        readFileSync(join(root, "verification/requirements.json"), "utf8")
      )
      const fixtureAuthorityModelIds = [
        "SAFE-12-authority-model",
        "SAFE-12-authority-negative-control",
        "SAFE-12-authority-clear-negative-control"
      ]
      const selectedIds = new Set([
        "SAFE-01-model",
        ...fixtureAuthorityModelIds
      ])
      const properties = sourceRegistry.properties
        .map((property: { obligations: Array<{ id: string }> }) => ({
          ...property,
          obligations: property.obligations.filter((item) =>
            selectedIds.has(item.id)
          )
        }))
        .filter((property: { obligations: Array<unknown> }) =>
          property.obligations.length > 0
        )
      const fixtureFiles = [
        "verification/verification-runner.mjs",
        "verification/package-environment.mjs",
        "verification/evidence-engine.mjs",
        "verification/parse-args.mjs",
        "verification/source-fingerprint.mjs",
        "verification/run-tlc.mjs",
        "verification/run-keeper-selection-tlc.mjs",
        "verification/tlc-tooling.mjs",
        "verification/run-recovery-authority-tlc.mjs",
        "verification/recovery-authority-model-evidence.mjs",
        "verification/model/TrashLifecycle.tla",
        "verification/model/TrashLifecycle.cfg",
        "verification/model/KeeperSelection.tla",
        "verification/model/KeeperSelection.cfg",
        "verification/model/KeeperSelection.negative.cfg",
        "verification/model/RecoveryAuthority.tla",
        "verification/model/RecoveryAuthority.cfg",
        "verification/model/RecoveryAuthority.negative.cfg",
        "verification/model/RecoveryAuthority.clear-negative.cfg",
        ...RECOVERY_AUTHORITY_CORRESPONDENCE_PATHS
      ].filter((path, index, paths) => paths.indexOf(path) === index)
      for (const path of fixtureFiles) {
        if (path === "verification/requirements.json") continue
        const destination = join(temporaryRoot, path)
        mkdirSync(resolve(destination, ".."), { recursive: true })
        copyFileSync(join(root, path), destination)
      }
      const sourceRoots = [...fixtureFiles, "verification/requirements.json"]
      writeFileSync(
        join(temporaryRoot, "verification/requirements.json"),
        `${JSON.stringify(
          { ...sourceRegistry, sourceRoots, properties },
          null,
          2
        )}\n`
      )
      mkdirSync(join(temporaryRoot, "node_modules/.bin"), { recursive: true })
      writeFileSync(vitestStubPath, "#!/usr/bin/env node\nprocess.exit(0)\n")
      chmodSync(vitestStubPath, 0o755)
      mkdirSync(join(temporaryRoot, "tmp/verification/current"), {
        recursive: true
      })
      writeFileSync(stalePath, `${stalePass}\n`)
      writeFileSync(invalidTlcJarPath, "not the pinned TLC jar\n")

      const result = spawnSync(
        process.execPath,
        [
          join(root, "verification/verification-runner.mjs"),
          "--scope",
          "fast",
          "--out-dir",
          "tmp/verification/runner-run",
          "--archive-dir",
          "tmp/verification/runner-archive"
        ],
        {
          cwd: temporaryRoot,
          env: {
            ...process.env,
            VERIFICATION_ROOT: temporaryRoot,
            // A present jar with the wrong digest makes the model command
            // produce a fresh FAIL. A missing jar is correctly BLOCKED.
            VERIFICATION_TLC_JAR: invalidTlcJarPath
          },
          encoding: "utf8"
        }
      )
      expect(result.status).toBe(1)

      const summary = JSON.parse(
        readFileSync(join(runDirectory, "aggregate-result.json"), "utf8")
      )
      expect(summary.status).toBe("FAIL")
      const modelCommand = summary.commands.find(
        (command: { label: string }) => command.label === "model"
      )
      expect(modelCommand?.exitCode).not.toBe(0)

      const runRegistry = JSON.parse(
        readFileSync(join(runDirectory, "requirements.json"), "utf8")
      )
      const canonicalRegistry = JSON.parse(
        readFileSync(join(temporaryRoot, "verification/requirements.json"), "utf8")
      )
      const evidence = JSON.parse(
        readFileSync(join(runDirectory, "evidence.json"), "utf8")
      )
      const authorityModelIds = [
        "SAFE-12-authority-model",
        "SAFE-12-authority-negative-control",
        "SAFE-12-authority-clear-negative-control"
      ]
      for (const id of authorityModelIds) {
        const runObligation = runRegistry.properties
          .flatMap((property: { obligations: Array<{ id: string; artifact: string }> }) => property.obligations)
          .find((obligation: { id: string }) => obligation.id === id)
        expect(runObligation).toBeDefined()
        const canonicalObligation = canonicalRegistry.properties
          .flatMap((property: { obligations: Array<{ id: string; artifact: string }> }) => property.obligations)
          .find((obligation: { id: string }) => obligation.id === id)
        expect(canonicalObligation).toBeDefined()
        const registryArtifactSuffix = canonicalObligation.artifact.replace(
          "tmp/verification/current/",
          ""
        )
        const expectedArtifact = join(
          relative(temporaryRoot, runDirectory),
          registryArtifactSuffix
        ).split("\\").join("/")
        expect(runObligation.artifact).toBe(expectedArtifact)

        const evidenceEntry = evidence.entries.find(
          (entry: { id: string }) => entry.id === id
        )
        expect(evidenceEntry?.artifact).toBe(runObligation.artifact)
        expect(existsSync(join(temporaryRoot, evidenceEntry.artifact))).toBe(true)
        const artifact = JSON.parse(
          readFileSync(join(temporaryRoot, evidenceEntry.artifact), "utf8")
        )
        expect(artifact.id).toBe(id)
      }

      const freshModel = JSON.parse(
        readFileSync(join(runDirectory, "model-SAFE-01.json"), "utf8")
      )
      const freshRawModel = JSON.parse(
        readFileSync(
          join(runDirectory, "model-run/safe01-selection.json"),
          "utf8"
        )
      )
      expect(freshModel.status).toBe("FAIL")
      expect(freshModel.runId).not.toBe("stale-run-that-must-not-be-used")
      expect(freshRawModel.status).toBe("FAIL")
      expect(freshRawModel.message).toContain("integrity mismatch")
      expect(readFileSync(stalePath, "utf8")).toBe(`${stalePass}\n`)
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  }, 60_000)

  it("classifies an unavailable pinned TLC jar as BLOCKED", () => {
    const outputDirectory = join(
      root,
      "tmp/verification",
      `runner-missing-tlc-${Date.now()}-${process.pid}`
    )
    const result = runKeeperSelectionTlc({
      root,
      jarPath: join(outputDirectory, "missing-tla-tools.jar"),
      outputDirectory,
      runId: `missing-tlc-${process.pid}`
    })

    try {
      expect(result.status).toBe("BLOCKED")
      expect(result.exitCode).toBe(2)
      expect(result.sourceDrift).toBe(false)
      const artifact = JSON.parse(readFileSync(result.resultPath, "utf8"))
      expect(artifact.status).toBe("BLOCKED")
      expect(artifact.runId).toBe(`missing-tlc-${process.pid}`)
      expect(artifact.message).toContain("jar is unavailable")
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true })
    }
  })

  it("refuses to reuse a nonempty explicitly selected output directory", () => {
    const runDirectory = join(
      root,
      "tmp/verification",
      `runner-reuse-${Date.now()}-${process.pid}`
    )
    mkdirSync(runDirectory, { recursive: true })
    const marker = join(runDirectory, "stale-marker.json")
    writeFileSync(marker, '{"status":"PASS"}\n')
    try {
      const result = spawnSync(
        process.execPath,
        [
          "verification/verification-runner.mjs",
          "--scope",
          "fast",
          "--out-dir",
          runDirectory
        ],
        { cwd: root, encoding: "utf8" }
      )
      expect(result.status).toBe(1)
      expect(`${result.stdout}${result.stderr}`).toContain("not empty")
      expect(readFileSync(marker, "utf8")).toBe('{"status":"PASS"}\n')
    } finally {
      rmSync(runDirectory, { recursive: true, force: true })
    }
  })

  it("keeps the source fingerprint stable across generated manifest entry order", () => {
    const temporaryRoot = mkdtempSync("/tmp/photosweep-source-fingerprint-")
    const manifestPath = join(
      temporaryRoot,
      "build/chrome-mv3-prod/manifest.json"
    )
    const googleScript = {
      matches: ["https://photos.google.com/*"],
      js: ["google-photos-bridge.js"],
      run_at: "document_idle",
      css: []
    }
    const amazonScript = {
      matches: ["https://www.amazon.com/photos*"],
      js: ["amazon-photos-bridge.js"],
      run_at: "document_idle",
      css: []
    }

    try {
      expect(
        spawnSync("git", ["init", "--quiet"], {
          cwd: temporaryRoot,
          encoding: "utf8"
        }).status
      ).toBe(0)
      mkdirSync(join(temporaryRoot, "build/chrome-mv3-prod"), {
        recursive: true
      })
      writeFileSync(
        manifestPath,
        JSON.stringify({ manifest_version: 3, content_scripts: [googleScript, amazonScript] })
      )
      const first = computeSourceFingerprint(temporaryRoot, [
        "build/chrome-mv3-prod/manifest.json"
      ])

      writeFileSync(
        manifestPath,
        JSON.stringify({ manifest_version: 3, content_scripts: [amazonScript, googleScript] })
      )
      const second = computeSourceFingerprint(temporaryRoot, [
        "build/chrome-mv3-prod/manifest.json"
      ])

      expect(first.digest).toBe(second.digest)
      expect(first.fileCount).toBe(1)
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it("reuses Stryker cache identity for target and selected-test edits but invalidates shared setup and other inputs", () => {
    const temporaryRoot = mkdtempSync("/tmp/photosweep-mutation-cache-fingerprint-")
    const sourcePath = join(temporaryRoot, "lib/trash-lifecycle.ts")
    const testPath = join(temporaryRoot, "tests/trash-lifecycle.test.ts")
    const setupPath = join(temporaryRoot, "tests/setup.ts")
    const configPath = join(temporaryRoot, "vitest.config.mts")

    try {
      expect(
        spawnSync("git", ["init", "--quiet"], {
          cwd: temporaryRoot,
          encoding: "utf8"
        }).status
      ).toBe(0)
      mkdirSync(join(temporaryRoot, "lib"), { recursive: true })
      mkdirSync(join(temporaryRoot, "tests"), { recursive: true })
      writeFileSync(sourcePath, "export const guard = true\n")
      writeFileSync(testPath, "expect(true).toBe(true)\n")
      writeFileSync(setupPath, "globalThis.testSetup = true\n")
      writeFileSync(configPath, "export default { test: { maxWorkers: 4 } }\n")
      const sourceRoots = [
        "lib/trash-lifecycle.ts",
        "tests/trash-lifecycle.test.ts",
        "tests/setup.ts",
        "vitest.config.mts"
      ]
      const cacheInputs = {
        root: temporaryRoot,
        sourceRoots,
        mutationTargets: ["lib/trash-lifecycle.ts"],
        mutationTestFiles: ["tests/trash-lifecycle.test.ts"],
        env: { FAST_CHECK_NUM_RUNS: "250", FAST_CHECK_SEED: "20260915" },
        runtime: {
          versions: { node: "24.20.0" },
          platform: "darwin",
          arch: "arm64"
        }
      }
      const first = computeMutationIncrementalCacheFingerprint(cacheInputs)

      writeFileSync(sourcePath, "export const guard = false\n")
      const afterTargetChange = computeMutationIncrementalCacheFingerprint(
        cacheInputs
      )
      expect(afterTargetChange.digest).toBe(first.digest)
      expect(afterTargetChange.excludedPaths).toEqual([
        "lib/trash-lifecycle.ts",
        "tests/trash-lifecycle.test.ts"
      ])

      writeFileSync(testPath, "expect(false).toBe(false)\n")
      const afterTestChange = computeMutationIncrementalCacheFingerprint(
        cacheInputs
      )
      expect(afterTestChange.digest).toBe(first.digest)

      const afterTestListChange = computeMutationIncrementalCacheFingerprint({
        ...cacheInputs,
        mutationTestFiles: [
          ...cacheInputs.mutationTestFiles,
          "tests/another-mutation.test.ts"
        ]
      })
      expect(afterTestListChange.digest).not.toBe(afterTestChange.digest)

      writeFileSync(setupPath, "globalThis.testSetup = false\n")
      const afterSharedSetupChange = computeMutationIncrementalCacheFingerprint(
        cacheInputs
      )
      expect(afterSharedSetupChange.digest).not.toBe(afterTestChange.digest)

      writeFileSync(configPath, "export default { test: { maxWorkers: 2 } }\n")
      const afterCompatibilityChange = computeMutationIncrementalCacheFingerprint(
        cacheInputs
      )
      expect(afterCompatibilityChange.digest).not.toBe(afterSharedSetupChange.digest)

      const afterEnvironmentChange = computeMutationIncrementalCacheFingerprint({
        ...cacheInputs,
        env: { ...cacheInputs.env, FAST_CHECK_NUM_RUNS: "10000" }
      })
      expect(afterEnvironmentChange.digest).not.toBe(
        afterCompatibilityChange.digest
      )
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it("limits Stryker cache invalidation to files that affect its mutation tests", () => {
    const temporaryRoot = mkdtempSync(
      "/tmp/photosweep-mutation-cache-inputs-"
    )

    try {
      expect(
        spawnSync("git", ["init", "--quiet"], {
          cwd: temporaryRoot,
          encoding: "utf8"
        }).status
      ).toBe(0)

      const files = {
        "lib/trash-lifecycle.ts": "export const guard = true\n",
        "tests/setup.ts": "globalThis.testSetup = true\n",
        "tests/fixtures/provider.json": "{\"provider\":\"icloud\"}\n",
        "tests/unrelated.test.ts": "expect(true).toBe(true)\n",
        ".github/workflows/ci.yml": "name: ci\n",
        "verification/run-tlc.mjs": "export const model = true\n",
        "vitest.config.mts": "export default { test: { maxWorkers: 4 } }\n"
      }
      for (const [path, contents] of Object.entries(files)) {
        const fullPath = join(temporaryRoot, path)
        mkdirSync(resolve(fullPath, ".."), { recursive: true })
        writeFileSync(fullPath, contents)
      }

      const cacheInputs = {
        root: temporaryRoot,
        mutationTargets: ["lib/trash-lifecycle.ts"],
        mutationTestFiles: ["tests/trash-lifecycle.test.ts"],
        env: { FAST_CHECK_NUM_RUNS: "250" },
        runtime: {
          versions: { node: "24.20.0" },
          platform: "darwin",
          arch: "arm64"
        }
      }
      const first = computeMutationIncrementalCacheFingerprint(cacheInputs)

      writeFileSync(
        join(temporaryRoot, "tests/unrelated.test.ts"),
        "expect(false).toBe(false)\n"
      )
      writeFileSync(
        join(temporaryRoot, ".github/workflows/ci.yml"),
        "name: changed-ci\n"
      )
      writeFileSync(
        join(temporaryRoot, "verification/run-tlc.mjs"),
        "export const model = false\n"
      )
      expect(computeMutationIncrementalCacheFingerprint(cacheInputs).digest).toBe(
        first.digest
      )

      writeFileSync(
        join(temporaryRoot, "tests/fixtures/provider.json"),
        "{\"provider\":\"google\"}\n"
      )
      const afterFixtureChange = computeMutationIncrementalCacheFingerprint(
        cacheInputs
      )
      expect(afterFixtureChange.digest).not.toBe(first.digest)

      writeFileSync(
        join(temporaryRoot, "tests/setup.ts"),
        "globalThis.testSetup = false\n"
      )
      expect(
        computeMutationIncrementalCacheFingerprint(cacheInputs).digest
      ).not.toBe(afterFixtureChange.digest)

      expect(MUTATION_CACHE_SOURCE_ROOTS).toContain("tests/fixtures")
      expect(MUTATION_CACHE_SOURCE_ROOTS).toContain("tests/setup.ts")
      expect(MUTATION_CACHE_SOURCE_ROOTS).not.toContain(".github")
      expect(MUTATION_CACHE_SOURCE_ROOTS).not.toContain("tests")
      expect(MUTATION_CACHE_SOURCE_ROOTS).not.toContain("verification")
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it("binds dirty nested repository source, lockfile, and untracked test changes", () => {
    const temporaryRoot = mkdtempSync("/tmp/photosweep-dirty-nested-repository-")
    const submodulePath = join(temporaryRoot, "Nested-Submodule-Fixture")
    const sourceFile = join(submodulePath, "src/api.ts")

    try {
      execFileSync("git", ["init", "--quiet"], { cwd: temporaryRoot })
      mkdirSync(join(submodulePath, "src"), { recursive: true })
      execFileSync("git", ["init", "--quiet"], { cwd: submodulePath })
      writeFileSync(sourceFile, "export const token = 'initial'\n")
      writeFileSync(join(submodulePath, "package-lock.json"), "{\"lockfileVersion\": 1}\n")
      execFileSync("git", ["add", "."], { cwd: submodulePath })
      execFileSync(
        "git",
        [
          "-c",
          "user.name=PhotoSweep verification",
          "-c",
          "user.email=verification@example.invalid",
          "commit",
          "--quiet",
          "-m",
          "initial"
        ],
        { cwd: submodulePath }
      )
      const submoduleCommit = execFileSync(
        "git",
        ["rev-parse", "HEAD"],
        { cwd: submodulePath, encoding: "utf8" }
      ).trim()
      execFileSync(
        "git",
        [
          "update-index",
          "--add",
          "--cacheinfo",
          `160000,${submoduleCommit},Nested-Submodule-Fixture`
        ],
        { cwd: temporaryRoot }
      )

      const cleanFingerprint = computeSourceFingerprint(temporaryRoot, [
        "Nested-Submodule-Fixture"
      ])
      writeFileSync(sourceFile, "export const token = 'modified'\n")
      const modifiedSourceFingerprint = computeSourceFingerprint(
        temporaryRoot,
        ["Nested-Submodule-Fixture"]
      )

      expect(modifiedSourceFingerprint.digest).not.toBe(cleanFingerprint.digest)

      mkdirSync(join(submodulePath, "tests"), { recursive: true })
      writeFileSync(join(submodulePath, "tests/api.test.ts"), "export {}\n")
      const untrackedTestFingerprint = computeSourceFingerprint(temporaryRoot, [
        "Nested-Submodule-Fixture"
      ])
      expect(untrackedTestFingerprint.digest).not.toBe(
        modifiedSourceFingerprint.digest
      )
      expect(
        computeSourceFingerprint(temporaryRoot, ["Nested-Submodule-Fixture"]).digest
      ).toBe(untrackedTestFingerprint.digest)
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
})
