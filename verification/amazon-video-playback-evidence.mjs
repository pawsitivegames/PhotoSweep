import { createHash } from "node:crypto"
import { lstatSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"

export const AMAZON_VIDEO_PLAYBACK_EVIDENCE_TYPE =
  "photosweep.amazon-video-playback"
export const AMAZON_VIDEO_PLAYBACK_CAPTURE_TYPE =
  "photosweep.amazon-video-playback-capture"
export const AMAZON_VIDEO_PLAYBACK_CAPTURE_METHOD = "chrome-devtools-mcp"
export const AMAZON_VIDEO_PLAYBACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const FUTURE_CLOCK_TOLERANCE_MS = 5 * 60 * 1000

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  )
}

function parseTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function failResult(problems, checksRun = 1, summary = {}) {
  return {
    status: "FAIL",
    exitCode: 1,
    checksRun: Math.max(1, checksRun),
    problems,
    message:
      "Supplied Amazon regional video playback evidence failed validation.",
    ...summary
  }
}

/** Read the canonical marketplace host array from lib/provider-sites.ts. */
export function sourceDeclaredAmazonMarketplaceHosts(sourceText) {
  const match = sourceText.match(
    /export const AMAZON_MARKETPLACE_HOSTS = \[([\s\S]*?)\] as const/
  )
  if (!match) {
    throw new Error("AMAZON_MARKETPLACE_HOSTS source declaration is missing")
  }

  const hosts = []
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const hostMatch = trimmed.match(/^"([a-z0-9.-]+)",?$/)
    if (!hostMatch || !hostMatch[1].includes(".")) {
      throw new Error("AMAZON_MARKETPLACE_HOSTS is not a literal host list")
    }
    hosts.push(hostMatch[1])
  }

  if (hosts.length === 0 || new Set(hosts).size !== hosts.length) {
    throw new Error("AMAZON_MARKETPLACE_HOSTS is empty or contains duplicates")
  }
  return hosts
}

function readJsonFile(path) {
  const bytes = readFileSync(path)
  return { bytes, value: JSON.parse(bytes.toString("utf8")) }
}

function capturePathFor(manifestDirectory, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    isAbsolute(relativePath)
  ) {
    return null
  }
  const path = resolve(manifestDirectory, relativePath)
  const fromManifest = relative(manifestDirectory, path)
  if (
    fromManifest === "" ||
    fromManifest === ".." ||
    fromManifest.startsWith(`..${sep}`) ||
    isAbsolute(fromManifest)
  ) {
    return null
  }
  return path
}

/**
 * Validate externally captured, sanitized Amazon video playback evidence.
 * The runner never creates capture manifests or sidecars; it only consumes an
 * explicitly supplied manifest and verifies every referenced sidecar hash.
 */
export function validateAmazonVideoPlaybackEvidence({
  evidencePath,
  expectedPackageDigest,
  sourceText,
  now = Date.now(),
  maxAgeMs = AMAZON_VIDEO_PLAYBACK_MAX_AGE_MS
}) {
  if (typeof evidencePath !== "string" || evidencePath.length === 0) {
    return {
      status: "BLOCKED",
      exitCode: 2,
      checksRun: 0,
      problems: ["No external evidence manifest was supplied."],
      message:
        "Amazon regional video playback is BLOCKED because no external evidence manifest was supplied."
    }
  }

  if (!SHA256_PATTERN.test(expectedPackageDigest ?? "")) {
    return {
      status: "BLOCKED",
      exitCode: 2,
      checksRun: 0,
      problems: ["The current successful production package digest is unavailable."],
      message:
        "Amazon regional video playback is BLOCKED because the current production package could not be bound."
    }
  }

  let manifestBytes
  let manifest
  try {
    const read = readJsonFile(evidencePath)
    manifestBytes = read.bytes
    manifest = read.value
  } catch {
    return {
      status: "BLOCKED",
      exitCode: 2,
      checksRun: 0,
      problems: ["The supplied evidence manifest is unavailable or unreadable."],
      message:
        "Amazon regional video playback is BLOCKED because the supplied external evidence manifest could not be read."
    }
  }

  let expectedHosts
  try {
    expectedHosts = sourceDeclaredAmazonMarketplaceHosts(sourceText)
  } catch {
    return failResult([
      "The source-declared Amazon marketplace list could not be read safely."
    ])
  }

  const problems = []
  const require = (condition, message) => {
    if (!condition) problems.push(message)
  }
  require(
    hasExactKeys(manifest, [
      "schemaVersion",
      "evidenceType",
      "captureMethod",
      "packageDigest",
      "captures"
    ]),
    "The evidence manifest has missing or unsupported fields."
  )
  require(
    manifest?.schemaVersion === 1 &&
      manifest?.evidenceType === AMAZON_VIDEO_PLAYBACK_EVIDENCE_TYPE,
    "The evidence manifest schema or type is unsupported."
  )
  require(
    manifest?.captureMethod === AMAZON_VIDEO_PLAYBACK_CAPTURE_METHOD,
    "The manifest was not captured through the required Chrome DevTools source."
  )
  require(
    manifest?.packageDigest === expectedPackageDigest,
    "The evidence manifest is bound to a different package digest."
  )
  require(
    Array.isArray(manifest?.captures),
    "The manifest capture list is missing or invalid."
  )

  const captures = Array.isArray(manifest?.captures) ? manifest.captures : []
  const seenHosts = new Set()
  const seenIds = new Set()
  const seenPaths = new Set()
  const validated = []
  const manifestDirectory = dirname(resolve(evidencePath))

  for (const capture of captures) {
    const host = capture?.marketplaceHost
    const safeHost = typeof host === "string" ? host : "<invalid>"
    require(
      hasExactKeys(capture, [
        "marketplaceHost",
        "captureId",
        "captureArtifact",
        "captureSha256"
      ]),
      `Capture record for ${safeHost} has missing or unsupported fields.`
    )
    require(
      expectedHosts.includes(host),
      `Capture record names an undeclared marketplace: ${safeHost}.`
    )
    if (seenHosts.has(host)) {
      problems.push(`Duplicate capture record for marketplace ${safeHost}.`)
    }
    if (typeof host === "string") seenHosts.add(host)

    require(
      typeof capture?.captureId === "string" &&
        capture.captureId.length > 0 &&
        capture.captureId.length <= 128,
      `Capture ID for ${safeHost} is missing or invalid.`
    )
    if (typeof capture?.captureId === "string") {
      if (seenIds.has(capture.captureId)) {
        problems.push(`Capture ID is reused for marketplace ${safeHost}.`)
      }
      seenIds.add(capture.captureId)
    }
    require(
      SHA256_PATTERN.test(capture?.captureSha256 ?? ""),
      `Capture file hash for ${safeHost} is missing or invalid.`
    )

    const capturePath = capturePathFor(
      manifestDirectory,
      capture?.captureArtifact
    )
    require(
      capturePath !== null,
      `Capture file reference for ${safeHost} is unsafe or invalid.`
    )
    if (!capturePath) continue
    const captureRelativePath = relative(manifestDirectory, capturePath)
    if (seenPaths.has(captureRelativePath)) {
      problems.push(`Capture file is reused for marketplace ${safeHost}.`)
    }
    seenPaths.add(captureRelativePath)

    let captureBytes
    let captureRecord
    try {
      const fileStat = lstatSync(capturePath)
      require(
        fileStat.isFile() && !fileStat.isSymbolicLink(),
        `Capture file for ${safeHost} is not a regular file.`
      )
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue
      const read = readJsonFile(capturePath)
      captureBytes = read.bytes
      captureRecord = read.value
    } catch {
      problems.push(`Capture file for ${safeHost} is missing or unreadable.`)
      continue
    }

    require(
      sha256(captureBytes) === capture?.captureSha256,
      `Capture file hash does not match for ${safeHost}.`
    )
    require(
      hasExactKeys(captureRecord, [
        "schemaVersion",
        "evidenceType",
        "captureMethod",
        "captureId",
        "marketplaceHost",
        "packageDigest",
        "capturedAt",
        "browser",
        "playback"
      ]),
      `Capture file for ${safeHost} has missing or unsupported fields.`
    )
    require(
      captureRecord?.schemaVersion === 1 &&
        captureRecord?.evidenceType === AMAZON_VIDEO_PLAYBACK_CAPTURE_TYPE,
      `Capture file schema or type is unsupported for ${safeHost}.`
    )
    require(
      captureRecord?.captureMethod === AMAZON_VIDEO_PLAYBACK_CAPTURE_METHOD,
      `Capture file for ${safeHost} has an unsupported capture source.`
    )
    require(
      captureRecord?.captureId === capture?.captureId,
      `Capture ID does not match for ${safeHost}.`
    )
    require(
      captureRecord?.marketplaceHost === host,
      `Capture file is bound to a different marketplace than ${safeHost}.`
    )
    require(
      captureRecord?.packageDigest === expectedPackageDigest,
      `Capture file for ${safeHost} is bound to a different package digest.`
    )
    require(
      captureRecord?.browser === "Chrome Stable",
      `Capture file for ${safeHost} does not identify Chrome Stable.`
    )

    const capturedAt = parseTimestamp(captureRecord?.capturedAt)
    require(
      capturedAt !== null,
      `Capture timestamp is missing or invalid for ${safeHost}.`
    )
    if (capturedAt !== null) {
      require(
        capturedAt <= now + FUTURE_CLOCK_TOLERANCE_MS,
        `Capture timestamp is in the future for ${safeHost}.`
      )
      require(
        now - capturedAt <= maxAgeMs,
        `Capture is stale for ${safeHost}.`
      )
    }

    const playback = captureRecord?.playback
    require(
      hasExactKeys(playback, [
        "videoElementFound",
        "playbackStarted",
        "currentTimeBeforeSeconds",
        "currentTimeAfterSeconds",
        "playbackError"
      ]),
      `Playback observation for ${safeHost} has missing or unsupported fields.`
    )
    require(
      playback?.videoElementFound === true &&
        playback?.playbackStarted === true &&
        playback?.playbackError === null,
      `Playback did not complete successfully for ${safeHost}.`
    )
    require(
      Number.isFinite(playback?.currentTimeBeforeSeconds) &&
        playback.currentTimeBeforeSeconds >= 0 &&
        Number.isFinite(playback?.currentTimeAfterSeconds) &&
        playback.currentTimeAfterSeconds > playback.currentTimeBeforeSeconds,
      `Video playback time did not advance for ${safeHost}.`
    )

    validated.push({
      marketplaceHost: safeHost,
      captureId: capture?.captureId,
      capturedAt: captureRecord?.capturedAt,
      captureSha256: sha256(captureBytes)
    })
  }

  for (const host of expectedHosts) {
    if (!seenHosts.has(host)) {
      problems.push(`Missing playback evidence for marketplace ${host}.`)
    }
  }
  require(
    captures.length === expectedHosts.length,
    `Expected ${expectedHosts.length} marketplace captures; received ${captures.length}.`
  )

  if (problems.length > 0) {
    return failResult(problems, Math.max(captures.length, 1), {
      evidenceFileSha256: sha256(manifestBytes),
      expectedMarketplaces: expectedHosts.length,
      validatedMarketplaces: validated.length
    })
  }

  return {
    status: "PASS",
    exitCode: 0,
    checksRun: expectedHosts.length,
    problems: [],
    message:
      "Fresh independent Chrome Stable playback captures cover every source-declared Amazon marketplace for the exact current package.",
    evidenceFileSha256: sha256(manifestBytes),
    packageDigest: expectedPackageDigest,
    expectedMarketplaces: expectedHosts.length,
    validatedMarketplaces: validated.length,
    captures: validated
  }
}
