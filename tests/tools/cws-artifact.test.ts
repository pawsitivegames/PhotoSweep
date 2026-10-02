import { describe, expect, it } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
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
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  assertCwsBuildId,
  cwsArtifactFileName,
  cwsArtifactMetadataFileName,
  createCwsArtifactMetadata,
  validateCwsArtifactMetadata
} from "../../tools/cws-artifact.mjs"

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
)

const buildId = "123e4567-e89b-42d3-a456-426614174000"
const artifactSha256 = "a".repeat(64)
const sourceFingerprint = "b".repeat(64)

function validMetadata() {
  return createCwsArtifactMetadata({
    appVersion: "2.3.0",
    chromeVersion: "2.3.0.3",
    artifactFile: `build/photosweep-cws-v2.3.0.3-sha256-${artifactSha256.slice(0, 12)}.zip`,
    artifactSha256,
    manifestSha256: "c".repeat(64),
    sourceCommit: "d".repeat(40),
    sourceDirty: true,
    sourceStatusSha256: "e".repeat(64),
    trackedDiffSha256: "f".repeat(64),
    sourceFingerprint,
    sourceFileCount: 258,
    buildId,
    builtAt: "2026-09-28T23:00:00.000Z"
  })
}

describe("CWS package provenance", () => {
  it("[PARITY-08] binds a build ID to the package hash and source fingerprint", () => {
    const metadata = validMetadata()

    expect(metadata.schemaVersion).toBe(2)
    expect(metadata.buildId).toBe(buildId)
    expect(
      validateCwsArtifactMetadata(metadata, {
        chromeVersion: "2.3.0.3",
        buildId,
        artifactSha256,
        sourceFingerprint
      })
    ).toEqual([])
  })

  it("[PARITY-08] rejects invalid or mismatched package provenance", () => {
    const metadata = validMetadata()
    metadata.buildId = "not-a-build-id"
    metadata.artifactSha256 = "0".repeat(64)

    const problems = validateCwsArtifactMetadata(metadata, {
      chromeVersion: "2.3.0.3",
      buildId,
      artifactSha256,
      sourceFingerprint
    })

    expect(problems).toContain("package build ID is invalid")
    expect(problems).toContain(
      "package build ID does not match the expected build"
    )
    expect(problems).toContain(
      "artifact SHA-256 does not match the expected package"
    )
    expect(() => assertCwsBuildId("invalid")).toThrow(
      "Package build ID must be a canonical UUID v4"
    )
  })
})

const fixtureBuildId = "123e4567-e89b-42d3-a456-426614174000"
const fixtureZip = Buffer.from("isolated CWS package fixture")
const fixtureZipSha256 = createHash("sha256")
  .update(fixtureZip)
  .digest("hex")

function createRecorderFixture() {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "photosweep-cws-artifact-")
  )
  const root = path.join(temporaryRoot, "repo")
  const toolsDir = path.join(root, "tools")
  const verificationDir = path.join(root, "verification")
  const productionBuildDir = path.join(root, "build", "chrome-mv3-prod")
  mkdirSync(toolsDir, { recursive: true })
  mkdirSync(verificationDir, { recursive: true })
  mkdirSync(productionBuildDir, { recursive: true })

  for (const relativePath of [
    "tools/record-cws-artifact.mjs",
    "tools/cws-artifact.mjs",
    "verification/source-fingerprint.mjs"
  ]) {
    copyFileSync(
      path.join(projectRoot, relativePath),
      path.join(root, relativePath)
    )
  }

  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ version: "2.3.0", chromeVersion: "2.3.0.3" })
  )
  writeFileSync(
    path.join(verificationDir, "requirements.json"),
    JSON.stringify({
      sourceRoots: ["package.json", "build/chrome-mv3-prod/manifest.json"]
    })
  )
  writeFileSync(
    path.join(productionBuildDir, "manifest.json"),
    JSON.stringify({ manifest_version: 3, version: "2.3.0.3" })
  )
  writeFileSync(
    path.join(productionBuildDir, "app.js"),
    `const packageBuildId = "${fixtureBuildId}";\n`
  )
  writeFileSync(path.join(root, "build", "chrome-mv3-prod.zip"), fixtureZip)
  writeFileSync(path.join(root, "tracked.bin"), Buffer.alloc(2 * 1024 * 1024))

  execFileSync("git", ["init", "-q"], { cwd: root })
  execFileSync("git", ["add", "--all"], { cwd: root })
  execFileSync(
    "git",
    [
      "-c",
      "user.name=PhotoSweep test",
      "-c",
      "user.email=photosweep-test@example.invalid",
      "commit",
      "-m",
      "fixture"
    ],
    { cwd: root, stdio: "ignore" }
  )

  const artifactFile = cwsArtifactFileName("2.3.0.3", fixtureZipSha256)
  return {
    root,
    temporaryRoot,
    metadataPath: path.join(
      root,
      "build",
      cwsArtifactMetadataFileName(artifactFile)
    )
  }
}

function runRecorder(
  fixture: ReturnType<typeof createRecorderFixture>,
  extraEnv: Partial<NodeJS.ProcessEnv> = {}
) {
  return spawnSync(
    process.execPath,
    [path.join(fixture.root, "tools", "record-cws-artifact.mjs")],
    {
      cwd: fixture.root,
      env: {
        ...process.env,
        PHOTOSWEEP_PACKAGE_BUILD_ID: fixtureBuildId,
        ...extraEnv
      },
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024
    }
  )
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

describe("CWS tracked-diff provenance capture", () => {
  it("hashes a tracked binary diff larger than spawnSync's default buffer", () => {
    const fixture = createRecorderFixture()
    try {
      writeFileSync(
        path.join(fixture.root, "tracked.bin"),
        randomBytes(2 * 1024 * 1024)
      )
      const expectedDiff = execFileSync(
        "git",
        ["diff", "--binary", "HEAD"],
        { cwd: fixture.root, maxBuffer: 16 * 1024 * 1024 }
      )
      expect(expectedDiff.byteLength).toBeGreaterThan(1024 * 1024)

      const result = runRecorder(fixture)

      expect(result.status).toBe(0)
      const metadata = JSON.parse(readFileSync(fixture.metadataPath, "utf8"))
      expect(metadata.trackedDiffSha256).toBe(sha256(expectedDiff))
    } finally {
      rmSync(fixture.temporaryRoot, { recursive: true, force: true })
    }
  })

  it("records the empty-diff digest when the tracked worktree is clean", () => {
    const fixture = createRecorderFixture()
    try {
      const result = runRecorder(fixture)

      expect(result.status).toBe(0)
      const metadata = JSON.parse(readFileSync(fixture.metadataPath, "utf8"))
      expect(metadata.trackedDiffSha256).toBe(sha256(Buffer.alloc(0)))
      expect(metadata.sourceDirty).toBe(false)
    } finally {
      rmSync(fixture.temporaryRoot, { recursive: true, force: true })
    }
  })

  it("fails closed without writing a sidecar when Git diff fails", () => {
    const fixture = createRecorderFixture()
    try {
      const gitPath = process.env.PATH?.split(path.delimiter)
        .map((directory) => path.join(directory, "git"))
        .find((candidate) => existsSync(candidate))
      expect(gitPath).toBeDefined()
      if (!gitPath) throw new Error("Git executable is unavailable")

      const wrapperDir = path.join(fixture.temporaryRoot, "bin")
      mkdirSync(wrapperDir)
      const wrapperPath = path.join(wrapperDir, "git")
      writeFileSync(
        wrapperPath,
        [
          "#!/usr/bin/env node",
          'import { spawnSync } from "node:child_process";',
          "const args = process.argv.slice(2);",
          'if (args[0] === "diff" && args[1] === "--binary" && args[2] === "HEAD") process.exit(73);',
          `const result = spawnSync(${JSON.stringify(gitPath)}, args, { stdio: "inherit" });`,
          "process.exit(result.status ?? 74);"
        ].join("\n") + "\n"
      )
      chmodSync(wrapperPath, 0o755)

      const result = runRecorder(fixture, {
        PATH: `${wrapperDir}${path.delimiter}${process.env.PATH ?? ""}`
      })

      expect(result.status).not.toBe(0)
      expect(existsSync(fixture.metadataPath)).toBe(false)
    } finally {
      rmSync(fixture.temporaryRoot, { recursive: true, force: true })
    }
  })
})
