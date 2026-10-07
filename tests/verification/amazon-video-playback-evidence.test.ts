import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
})
