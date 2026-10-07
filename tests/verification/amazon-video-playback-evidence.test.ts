import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"

import {
  AMAZON_VIDEO_PLAYBACK_CAPTURE_METHOD,
  AMAZON_VIDEO_PLAYBACK_CAPTURE_TYPE,
  AMAZON_VIDEO_PLAYBACK_EVIDENCE_TYPE,
  AMAZON_VIDEO_PLAYBACK_MAX_AGE_MS,
  sourceDeclaredAmazonMarketplaceHosts,
  validateAmazonVideoPlaybackEvidence
} from "../../verification/amazon-video-playback-evidence.mjs"

const root = resolve(process.cwd())
const packageDigest = "a".repeat(64)
const now = Date.parse("2026-10-07T18:00:00.000Z")
const temporaryRoots: string[] = []

function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function sourceText(): string {
  return readFileSync(join(root, "lib/provider-sites.ts"), "utf8")
}

// Complete evidence is synthetic and exists only as a validator test fixture.
function makeSyntheticCompleteEvidence(options: {
  capturedAt?: string
  currentTimeAfterSeconds?: number
  playbackStarted?: boolean
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "amazon-video-evidence-test-"))
  temporaryRoots.push(directory)
  const captureDirectory = join(directory, "captures")
  mkdirSync(captureDirectory)
  const capturedAt =
    options.capturedAt ?? new Date(now - 60_000).toISOString()
  const captures = sourceDeclaredAmazonMarketplaceHosts(sourceText()).map(
    (marketplaceHost, index) => {
      const captureId = `synthetic-test-capture-${index + 1}`
      const captureArtifact = `captures/market-${index + 1}.json`
      const capture = {
        schemaVersion: 1,
        evidenceType: AMAZON_VIDEO_PLAYBACK_CAPTURE_TYPE,
        captureMethod: AMAZON_VIDEO_PLAYBACK_CAPTURE_METHOD,
        captureId,
        marketplaceHost,
        packageDigest,
        capturedAt,
        browser: "Chrome Stable",
        playback: {
          videoElementFound: true,
          playbackStarted:
            options.playbackStarted ?? true,
          currentTimeBeforeSeconds: 0,
          currentTimeAfterSeconds:
            options.currentTimeAfterSeconds ?? 1.25,
          playbackError: null
        }
      }
      const captureBytes = `${JSON.stringify(capture, null, 2)}\n`
      writeFileSync(join(directory, captureArtifact), captureBytes)
      return {
        marketplaceHost,
        captureId,
        captureArtifact,
        captureSha256: digest(captureBytes)
      }
    }
  )
  const manifestPath = join(directory, "manifest.json")
  const manifest = {
    schemaVersion: 1,
    evidenceType: AMAZON_VIDEO_PLAYBACK_EVIDENCE_TYPE,
    captureMethod: AMAZON_VIDEO_PLAYBACK_CAPTURE_METHOD,
    packageDigest,
    captures
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { directory, manifestPath, manifest }
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("Amazon regional video playback evidence", () => {
  it("preserves the existing all-provider gate and registers a separate Amazon gate", () => {
    const registry = JSON.parse(
      readFileSync(join(root, "verification/requirements.json"), "utf8")
    )
    const allProviderProperty = registry.properties.find(
      (property: { id: string }) => property.id === "VIDEO-PLAYBACK"
    )
    const allProviderObligation = allProviderProperty.obligations.find(
      (obligation: { id: string }) => obligation.id === "VIDEO-PLAYBACK-live"
    )
    const amazonProperty = registry.properties.find(
      (property: { id: string }) => property.id === "AMAZON-VIDEO-PLAYBACK"
    )
    const amazonObligation = amazonProperty.obligations.find(
      (obligation: { id: string }) =>
        obligation.id === "AMAZON-VIDEO-PLAYBACK-live"
    )
    const runnerSource = readFileSync(
      join(root, "verification/verification-runner.mjs"),
      "utf8"
    )

    expect(allProviderObligation.command).toBe(
      "Exact-current-candidate disposable video playback across Google Photos, iCloud Photos, and Amazon Photos"
    )
    expect(allProviderObligation.artifact).toBe(
      "tmp/verification/current/video-playback.json"
    )
    expect(allProviderObligation.mandatory).toBe(true)
    expect(amazonObligation.scope).toBe("release")
    expect(amazonObligation.mandatory).toBe(true)
    expect(amazonObligation.artifact).toBe(
      "tmp/verification/current/amazon-video-playback.json"
    )
    expect(runnerSource).toContain('item.id === "VIDEO-PLAYBACK-live"')
    expect(runnerSource).toContain(
      'item.id === "AMAZON-VIDEO-PLAYBACK-live"'
    )
  })

  it("derives the current 22 marketplaces from the source declaration", () => {
    const hosts = sourceDeclaredAmazonMarketplaceHosts(sourceText())

    expect(hosts).toHaveLength(22)
    expect(hosts[0]).toBe("amazon.com")
    expect(hosts.at(-1)).toBe("amazon.ie")
    expect(new Set(hosts).size).toBe(hosts.length)
  })

  it("keeps a missing external manifest BLOCKED", () => {
    const directory = mkdtempSync(join(tmpdir(), "amazon-video-evidence-missing-"))
    temporaryRoots.push(directory)
    const result = validateAmazonVideoPlaybackEvidence({
      evidencePath: join(directory, "manifest.json"),
      expectedPackageDigest: packageDigest,
      sourceText: sourceText(),
      now
    })

    expect(result.status).toBe("BLOCKED")
    expect(result.exitCode).toBe(2)
  })

  it("accepts fresh independent captures for every exact-package marketplace", () => {
    const fixture = makeSyntheticCompleteEvidence()
    try {
      const result = validateAmazonVideoPlaybackEvidence({
        evidencePath: fixture.manifestPath,
        expectedPackageDigest: packageDigest,
        sourceText: sourceText(),
        now
      })

      expect(result.status).toBe("PASS")
      if (!("validatedMarketplaces" in result) || !("captures" in result)) {
        throw new Error("Expected complete marketplace evidence to pass")
      }
      expect(result.exitCode).toBe(0)
      expect(result.checksRun).toBe(22)
      expect(result.validatedMarketplaces).toBe(22)
      expect(result.captures).toHaveLength(22)
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it("rejects stale captures", () => {
    const fixture = makeSyntheticCompleteEvidence({
      capturedAt: new Date(now - AMAZON_VIDEO_PLAYBACK_MAX_AGE_MS - 1).toISOString()
    })
    try {
      const result = validateAmazonVideoPlaybackEvidence({
        evidencePath: fixture.manifestPath,
        expectedPackageDigest: packageDigest,
        sourceText: sourceText(),
        now
      })

      expect(result.status).toBe("FAIL")
      expect(result.problems.some((problem) => problem.includes("stale"))).toBe(
        true
      )
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it("rejects timestamps without an explicit ISO-8601 timezone", () => {
    const fixture = makeSyntheticCompleteEvidence()
    try {
      const captureEntry = fixture.manifest.captures[0]
      const capturePath = join(fixture.directory, captureEntry.captureArtifact)
      const capture = JSON.parse(readFileSync(capturePath, "utf8"))
      capture.capturedAt = "2026-10-07T17:59:00"
      const captureBytes = `${JSON.stringify(capture, null, 2)}\n`
      writeFileSync(capturePath, captureBytes)
      captureEntry.captureSha256 = digest(captureBytes)
      writeFileSync(
        fixture.manifestPath,
        `${JSON.stringify(fixture.manifest, null, 2)}\n`
      )
      const result = validateAmazonVideoPlaybackEvidence({
        evidencePath: fixture.manifestPath,
        expectedPackageDigest: packageDigest,
        sourceText: sourceText(),
        now
      })

      expect(result.status).toBe("FAIL")
      expect(result.problems).toContain(
        "Capture timestamp is missing or invalid for amazon.com."
      )
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it("rejects evidence bound to a different package", () => {
    const fixture = makeSyntheticCompleteEvidence()
    try {
      fixture.manifest.packageDigest = "b".repeat(64)
      writeFileSync(
        fixture.manifestPath,
        `${JSON.stringify(fixture.manifest, null, 2)}\n`
      )
      const result = validateAmazonVideoPlaybackEvidence({
        evidencePath: fixture.manifestPath,
        expectedPackageDigest: packageDigest,
        sourceText: sourceText(),
        now
      })

      expect(result.status).toBe("FAIL")
      expect(result.problems).toContain(
        "The evidence manifest is bound to a different package digest."
      )
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it("rejects duplicate marketplace captures", () => {
    const fixture = makeSyntheticCompleteEvidence()
    try {
      fixture.manifest.captures[1].marketplaceHost =
        fixture.manifest.captures[0].marketplaceHost
      writeFileSync(
        fixture.manifestPath,
        `${JSON.stringify(fixture.manifest, null, 2)}\n`
      )
      const result = validateAmazonVideoPlaybackEvidence({
        evidencePath: fixture.manifestPath,
        expectedPackageDigest: packageDigest,
        sourceText: sourceText(),
        now
      })

      expect(result.status).toBe("FAIL")
      expect(result.problems.some((problem) => problem.includes("Duplicate capture"))).toBe(
        true
      )
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it("rejects incomplete source marketplace coverage", () => {
    const fixture = makeSyntheticCompleteEvidence()
    try {
      fixture.manifest.captures.pop()
      writeFileSync(
        fixture.manifestPath,
        `${JSON.stringify(fixture.manifest, null, 2)}\n`
      )
      const result = validateAmazonVideoPlaybackEvidence({
        evidencePath: fixture.manifestPath,
        expectedPackageDigest: packageDigest,
        sourceText: sourceText(),
        now
      })

      expect(result.status).toBe("FAIL")
      expect(result.problems.some((problem) => problem.includes("Missing playback evidence"))).toBe(
        true
      )
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it("rejects playback failures and a non-advancing video timeline", () => {
    for (const options of [
      { playbackStarted: false },
      { currentTimeAfterSeconds: 0 }
    ]) {
      const fixture = makeSyntheticCompleteEvidence(options)
      try {
        const result = validateAmazonVideoPlaybackEvidence({
          evidencePath: fixture.manifestPath,
          expectedPackageDigest: packageDigest,
          sourceText: sourceText(),
          now
        })

        expect(result.status).toBe("FAIL")
      } finally {
        rmSync(fixture.directory, { recursive: true, force: true })
      }
    }
  })

  it("rejects a capture whose sidecar no longer matches its recorded hash", () => {
    const fixture = makeSyntheticCompleteEvidence()
    try {
      const capturePath = join(fixture.directory, fixture.manifest.captures[0].captureArtifact)
      writeFileSync(capturePath, `${readFileSync(capturePath, "utf8")} `)
      const result = validateAmazonVideoPlaybackEvidence({
        evidencePath: fixture.manifestPath,
        expectedPackageDigest: packageDigest,
        sourceText: sourceText(),
        now
      })

      expect(result.status).toBe("FAIL")
      expect(result.problems).toContain(
        "Capture file hash does not match for amazon.com."
      )
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it("rejects symlinked sidecar parents and a symlinked manifest", () => {
    const fixture = makeSyntheticCompleteEvidence()
    const externalDirectory = mkdtempSync(
      join(tmpdir(), "amazon-video-evidence-external-")
    )
    temporaryRoots.push(externalDirectory)
    const capturesDirectory = join(fixture.directory, "captures")
    renameSync(capturesDirectory, join(fixture.directory, "original-captures"))
    symlinkSync(externalDirectory, capturesDirectory, "dir")

    const sidecarPathResult = validateAmazonVideoPlaybackEvidence({
      evidencePath: fixture.manifestPath,
      expectedPackageDigest: packageDigest,
      sourceText: sourceText(),
      now
    })
    expect(sidecarPathResult.status).toBe("FAIL")
    expect(sidecarPathResult.problems).toContain(
      "Capture file path traverses a symlink for amazon.com."
    )

    const manifestFixture = makeSyntheticCompleteEvidence()
    const manifestSymlink = join(manifestFixture.directory, "manifest-link.json")
    symlinkSync(manifestFixture.manifestPath, manifestSymlink)
    const manifestPathResult = validateAmazonVideoPlaybackEvidence({
      evidencePath: manifestSymlink,
      expectedPackageDigest: packageDigest,
      sourceText: sourceText(),
      now
    })
    expect(manifestPathResult.status).toBe("FAIL")
    expect(manifestPathResult.problems).toContain(
      "The supplied evidence manifest must be a regular, non-symlink file."
    )
  })
})
