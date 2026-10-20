import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  sourceDeclaredVideoPlaybackTargets,
  validateVideoPlaybackEvidence,
  VIDEO_PLAYBACK_CAPTURE_METHOD,
  VIDEO_PLAYBACK_CAPTURE_TYPE,
  VIDEO_PLAYBACK_EVIDENCE_TYPE
} from "../../verification/video-playback-evidence.mjs"

const root = resolve(process.cwd())
const packageDigest = "a".repeat(64)
const artifactSha256 = "b".repeat(64)
const sourceFingerprint = "c".repeat(64)
const buildId = "550e8400-e29b-41d4-a716-446655440000"
const extensionId = "abcdefghijklmnopabcdefghijklmnop"
const extensionVersion = "2.3.6.1"
const now = Date.parse("2026-10-10T04:00:00.000Z")
const temporaryRoots: string[] = []

function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function sourceText(): string {
  return readFileSync(join(root, "lib/provider-sites.ts"), "utf8")
}

function inventory(extension = extensionId) {
  return {
    source: "chrome-devtools.list_extensions",
    extensionId: extension
  }
}

function makeSyntheticCompleteEvidence(
  options: {
    capturedAt?: string
    currentTimeAfterSeconds?: number
    playbackStarted?: boolean
    playbackError?: string | null
    extension?: string
  } = {}
) {
  const directory = mkdtempSync(join(tmpdir(), "video-playback-evidence-test-"))
  temporaryRoots.push(directory)
  const captureDirectory = join(directory, "captures")
  mkdirSync(captureDirectory)
  const targets = sourceDeclaredVideoPlaybackTargets(sourceText())
  const capturedAt = options.capturedAt ?? new Date(now - 60_000).toISOString()
  const captures = targets.map(({ provider, host }, index) => {
    const captureId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    const captureArtifact = `captures/${provider}.json`
    const capture = {
      schemaVersion: 1,
      evidenceType: VIDEO_PLAYBACK_CAPTURE_TYPE,
      captureMethod: VIDEO_PLAYBACK_CAPTURE_METHOD,
      captureId,
      provider,
      host,
      packageDigest,
      artifactSha256,
      buildId,
      sourceFingerprint,
      capturedAt,
      browser: "Chrome Stable",
      extensionId: options.extension ?? extensionId,
      extensionVersion,
      playback: {
        videoElementFound: true,
        playbackStarted: options.playbackStarted ?? true,
        currentTimeBeforeSeconds: 0,
        currentTimeAfterSeconds: options.currentTimeAfterSeconds ?? 1.25,
        playbackError: options.playbackError ?? null
      }
    }
    const captureBytes = `${JSON.stringify(capture, null, 2)}\n`
    writeFileSync(join(directory, captureArtifact), captureBytes)
    return {
      provider,
      host,
      captureId,
      captureArtifact,
      captureSha256: digest(captureBytes)
    }
  })
  const manifestPath = join(directory, "manifest.json")
  const manifest = {
    schemaVersion: 1,
    evidenceType: VIDEO_PLAYBACK_EVIDENCE_TYPE,
    captureMethod: VIDEO_PLAYBACK_CAPTURE_METHOD,
    syntheticOnly: true,
    packageDigest,
    artifactSha256,
    buildId,
    sourceFingerprint,
    captures
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { directory, manifestPath, manifest }
}

function rewriteCapture(
  fixture: ReturnType<typeof makeSyntheticCompleteEvidence>,
  index: number,
  mutate: (capture: Record<string, any>) => void
) {
  const entry = fixture.manifest.captures[index]
  const capturePath = join(fixture.directory, entry.captureArtifact)
  const capture = JSON.parse(readFileSync(capturePath, "utf8"))
  mutate(capture)
  const captureBytes = `${JSON.stringify(capture, null, 2)}\n`
  writeFileSync(capturePath, captureBytes)
  entry.captureSha256 = digest(captureBytes)
  writeFileSync(
    fixture.manifestPath,
    `${JSON.stringify(fixture.manifest, null, 2)}\n`
  )
}

function validate(
  evidencePath: string | undefined,
  options: Record<string, unknown> = {}
) {
  return validateVideoPlaybackEvidence({
    evidencePath,
    expectedPackageDigest: packageDigest,
    expectedArtifactSha256: artifactSha256,
    expectedBuildId: buildId,
    expectedSourceFingerprint: sourceFingerprint,
    expectedExtensionVersion: extensionVersion,
    trustedDevToolsInventory: inventory(),
    sourceText: sourceText(),
    now,
    ...options
  })
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("exact-package video playback evidence", () => {
  it("derives one capture target for each provider from the source declarations", () => {
    expect(sourceDeclaredVideoPlaybackTargets(sourceText())).toEqual([
      { provider: "google", host: "photos.google.com" },
      { provider: "icloud", host: "www.icloud.com" },
      { provider: "amazon", host: "amazon.ca" }
    ])
  })

  it("accepts fresh successful playback bound to the exact source, ZIP, build, and installed extension", () => {
    const fixture = makeSyntheticCompleteEvidence()
    const result = validate(fixture.manifestPath)

    expect(result.status).toBe("PASS")
    if (!("validatedProviders" in result) || !("packageDigest" in result)) {
      throw new Error("Expected complete provider evidence to pass")
    }
    expect(result.checksRun).toBe(3)
    expect(result.validatedProviders).toBe(3)
    expect(result.packageDigest).toBe(packageDigest)
  })

  it("keeps absent evidence BLOCKED", () => {
    const result = validate(undefined)

    expect(result.status).toBe("BLOCKED")
    expect(result.exitCode).toBe(2)
  })

  it("requires exactly one capture for each declared provider", () => {
    const fixture = makeSyntheticCompleteEvidence()
    fixture.manifest.captures.pop()
    writeFileSync(
      fixture.manifestPath,
      `${JSON.stringify(fixture.manifest, null, 2)}\n`
    )
    const result = validate(fixture.manifestPath)

    expect(result.status).toBe("FAIL")
    expect(
      result.problems.some((problem) =>
        problem.includes("Missing playback evidence for amazon")
      )
    ).toBe(true)
  })

  it("rejects package, source, and build identity drift", () => {
    const fixture = makeSyntheticCompleteEvidence()
    fixture.manifest.buildId = "650e8400-e29b-41d4-a716-446655440000"
    writeFileSync(
      fixture.manifestPath,
      `${JSON.stringify(fixture.manifest, null, 2)}\n`
    )
    const result = validate(fixture.manifestPath)

    expect(result.status).toBe("FAIL")
    expect(result.problems).toContain(
      "The evidence manifest is bound to a different package build ID."
    )
  })

  it.each([
    ["package tree digest", "packageDigest", "different package tree digest"],
    ["package ZIP hash", "artifactSha256", "different package ZIP SHA-256"],
    ["source fingerprint", "sourceFingerprint", "different source fingerprint"]
  ])("rejects a mismatched %s", (_label, field, problem) => {
    const fixture = makeSyntheticCompleteEvidence()
    fixture.manifest[field] = "d".repeat(64)
    writeFileSync(
      fixture.manifestPath,
      `${JSON.stringify(fixture.manifest, null, 2)}\n`
    )

    const result = validate(fixture.manifestPath)
    expect(result.status).toBe("FAIL")
    expect(result.problems.some((message) => message.includes(problem))).toBe(
      true
    )
  })

  it("blocks when the trusted DevTools extension inventory is absent", () => {
    const fixture = makeSyntheticCompleteEvidence()
    const result = validateVideoPlaybackEvidence({
      evidencePath: fixture.manifestPath,
      expectedPackageDigest: packageDigest,
      expectedArtifactSha256: artifactSha256,
      expectedBuildId: buildId,
      expectedSourceFingerprint: sourceFingerprint,
      expectedExtensionVersion: extensionVersion,
      sourceText: sourceText(),
      now
    })

    expect(result.status).toBe("BLOCKED")
    expect(result.problems).toContain(
      "Missing current trusted Chrome DevTools extension inventory."
    )
  })

  it("blocks when exact candidate package identity is unavailable", () => {
    const fixture = makeSyntheticCompleteEvidence()
    const result = validate(fixture.manifestPath, {
      expectedArtifactSha256: undefined
    })

    expect(result.status).toBe("BLOCKED")
    expect(result.problems).toContain("Missing current package ZIP SHA-256.")
  })

  it("rejects duplicate providers and extra manifest fields", () => {
    const duplicateFixture = makeSyntheticCompleteEvidence()
    duplicateFixture.manifest.captures[2] = {
      ...duplicateFixture.manifest.captures[0],
      captureId: "00000000-0000-4000-8000-000000000004"
    }
    writeFileSync(
      duplicateFixture.manifestPath,
      `${JSON.stringify(duplicateFixture.manifest, null, 2)}\n`
    )
    const duplicateResult = validate(duplicateFixture.manifestPath)
    expect(duplicateResult.status).toBe("FAIL")
    expect(
      duplicateResult.problems.some((problem) =>
        problem.includes("Duplicate playback evidence for google")
      )
    ).toBe(true)
    expect(
      duplicateResult.problems.some((problem) =>
        problem.includes("Missing playback evidence for amazon")
      )
    ).toBe(true)

    const extraFieldFixture = makeSyntheticCompleteEvidence()
    Object.assign(extraFieldFixture.manifest, {
      privateMediaId: "must-not-be-accepted"
    })
    writeFileSync(
      extraFieldFixture.manifestPath,
      `${JSON.stringify(extraFieldFixture.manifest, null, 2)}\n`
    )
    expect(validate(extraFieldFixture.manifestPath).problems).toContain(
      "The evidence manifest has missing or unsupported fields."
    )
  })

  it.each([
    ["stale", new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(), "stale"],
    ["future", new Date(now + 6 * 60 * 1000).toISOString(), "future"]
  ])("rejects %s captures", (_label, capturedAt, problem) => {
    const fixture = makeSyntheticCompleteEvidence({ capturedAt })
    const result = validate(fixture.manifestPath)

    expect(result.status).toBe("FAIL")
    expect(result.problems.some((message) => message.includes(problem))).toBe(
      true
    )
  })

  it("rejects sidecars that claim a different packaged extension version", () => {
    const fixture = makeSyntheticCompleteEvidence()
    rewriteCapture(fixture, 0, (capture) => {
      capture.extensionVersion = "2.3.7.0"
    })

    const result = validate(fixture.manifestPath)
    expect(result.status).toBe("FAIL")
    expect(result.problems).toContain(
      "Capture extension version does not match the current package for google."
    )
  })

  it("rejects sidecar fields and capture IDs that could carry private data", () => {
    const extraFieldFixture = makeSyntheticCompleteEvidence()
    rewriteCapture(extraFieldFixture, 0, (capture) => {
      capture.privateMediaId = "synthetic-media-identifier"
    })
    expect(validate(extraFieldFixture.manifestPath).problems).toContain(
      "Capture sidecar has missing or unsupported fields for google."
    )

    const privateIdFixture = makeSyntheticCompleteEvidence()
    privateIdFixture.manifest.captures[0].captureId = "user@example.test"
    writeFileSync(
      privateIdFixture.manifestPath,
      `${JSON.stringify(privateIdFixture.manifest, null, 2)}\n`
    )
    expect(validate(privateIdFixture.manifestPath).problems).toContain(
      "Capture ID is invalid for google."
    )
  })

  it("requires an independently supplied matching DevTools extension identity", () => {
    const fixture = makeSyntheticCompleteEvidence({
      extension: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    })
    const result = validate(fixture.manifestPath)

    expect(result.status).toBe("FAIL")
    expect(
      result.problems.some((problem) => problem.includes("extension ID"))
    ).toBe(true)
    expect(
      validateVideoPlaybackEvidence({
        evidencePath: fixture.manifestPath,
        expectedPackageDigest: packageDigest,
        expectedArtifactSha256: artifactSha256,
        expectedBuildId: buildId,
        expectedSourceFingerprint: sourceFingerprint,
        expectedExtensionVersion: extensionVersion,
        sourceText: sourceText(),
        now
      }).status
    ).toBe("BLOCKED")
  })

  it("rejects stale or timezone-free captures", () => {
    const fixture = makeSyntheticCompleteEvidence({
      capturedAt: "2026-10-01T04:00:00"
    })
    const result = validate(fixture.manifestPath)

    expect(result.status).toBe("FAIL")
    expect(
      result.problems.some((problem) => problem.includes("timestamp"))
    ).toBe(true)
  })

  it("rejects stalled, failed, or non-video playback", () => {
    const fixture = makeSyntheticCompleteEvidence({
      currentTimeAfterSeconds: 0,
      playbackError: "decode failed"
    })
    const result = validate(fixture.manifestPath)

    expect(result.status).toBe("FAIL")
    expect(
      result.problems.some((problem) => problem.includes("Playback"))
    ).toBe(true)
  })

  it("rejects changed sidecars and symbolic links", () => {
    const fixture = makeSyntheticCompleteEvidence()
    const capture = fixture.manifest.captures[0]
    const capturePath = join(fixture.directory, capture.captureArtifact)
    writeFileSync(capturePath, "{}\n")
    expect(validate(fixture.manifestPath).problems).toContain(
      "Capture file hash does not match for google."
    )

    const linkedFixture = makeSyntheticCompleteEvidence()
    const linkedCapture = linkedFixture.manifest.captures[0]
    const realCapture = join(
      linkedFixture.directory,
      linkedCapture.captureArtifact
    )
    const linkPath = join(
      linkedFixture.directory,
      "captures",
      "google-link.json"
    )
    symlinkSync(realCapture, linkPath)
    linkedCapture.captureArtifact = "captures/google-link.json"
    writeFileSync(
      linkedFixture.manifestPath,
      `${JSON.stringify(linkedFixture.manifest, null, 2)}\n`
    )
    expect(validate(linkedFixture.manifestPath).problems).toContain(
      "Capture file path traverses a symlink for google."
    )
  })

  it("rejects capture paths that escape the manifest directory", () => {
    const fixture = makeSyntheticCompleteEvidence()
    fixture.manifest.captures[0].captureArtifact = "../../outside.json"
    writeFileSync(
      fixture.manifestPath,
      `${JSON.stringify(fixture.manifest, null, 2)}\n`
    )

    const result = validate(fixture.manifestPath)
    expect(result.status).toBe("FAIL")
    expect(result.problems).toContain(
      "Capture file path is invalid for google."
    )
  })
})
