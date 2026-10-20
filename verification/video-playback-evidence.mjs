import { createHash } from "node:crypto"
import { lstatSync, readFileSync, realpathSync } from "node:fs"
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep
} from "node:path"

import { sourceDeclaredAmazonMarketplaceHosts } from "./amazon-video-playback-evidence.mjs"

export const VIDEO_PLAYBACK_EVIDENCE_TYPE = "photosweep.video-playback"
export const VIDEO_PLAYBACK_CAPTURE_TYPE = "photosweep.video-playback-capture"
export const VIDEO_PLAYBACK_CAPTURE_METHOD = "chrome-devtools-mcp"
export const VIDEO_PLAYBACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/
const CAPTURE_ID_PATTERN = UUID_V4_PATTERN
const FUTURE_CLOCK_TOLERANCE_MS = 5 * 60 * 1000
const TRUSTED_DEVTOOLS_INVENTORY_SOURCE = "chrome-devtools.list_extensions"

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value, keys) {
  return (
    isRecord(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  )
}

function parseTimestamp(value) {
  if (typeof value !== "string") return null
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/
  )
  if (!match) return null

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    zone
  ] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ]
  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null
  }
  if (zone !== "Z") {
    const [offsetHour, offsetMinute] = zone.slice(1).split(":").map(Number)
    if (offsetHour > 23 || offsetMinute > 59 || zone === "-00:00") {
      return null
    }
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseStringArray(sourceText, exportName) {
  const expression = new RegExp(
    `export const ${exportName} = \\[([\\s\\S]*?)\\](?: as const)?`
  )
  const match = sourceText.match(expression)
  if (!match) throw new Error(`${exportName} source declaration is missing`)

  const values = []
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const valueMatch = trimmed.match(/^"([^"\r\n]+)",?$/)
    if (!valueMatch)
      throw new Error(`${exportName} is not a literal string list`)
    values.push(valueMatch[1])
  }
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new Error(`${exportName} is empty or contains duplicates`)
  }
  return values
}

/** Derive the representative live playback host from the provider declarations. */
export function sourceDeclaredVideoPlaybackTargets(sourceText) {
  const googleOrigins = parseStringArray(sourceText, "GOOGLE_PHOTOS_ORIGINS")
  if (googleOrigins.length !== 1) {
    throw new Error("GOOGLE_PHOTOS_ORIGINS must declare exactly one host")
  }
  const googleOrigin = new URL(googleOrigins[0])
  if (
    googleOrigin.protocol !== "https:" ||
    googleOrigin.username ||
    googleOrigin.password ||
    googleOrigin.pathname !== "/" ||
    googleOrigin.search ||
    googleOrigin.hash
  ) {
    throw new Error("GOOGLE_PHOTOS_ORIGINS contains an invalid secure origin")
  }
  const googleHost = googleOrigin.hostname
  const icloudHosts = parseStringArray(sourceText, "ICLOUD_HOSTS")
  if (icloudHosts.some((host) => !/^[a-z0-9.-]+$/.test(host))) {
    throw new Error("ICLOUD_HOSTS contains an invalid hostname")
  }
  const amazonHosts = sourceDeclaredAmazonMarketplaceHosts(sourceText)
  const amazonHost = amazonHosts.includes("amazon.ca")
    ? "amazon.ca"
    : amazonHosts[0]

  if (
    !googleHost ||
    !icloudHosts[0] ||
    !amazonHost ||
    !amazonHosts.includes(amazonHost)
  ) {
    throw new Error("Provider playback target declarations are invalid")
  }

  return [
    { provider: "google", host: googleHost },
    { provider: "icloud", host: icloudHosts[0] },
    { provider: "amazon", host: amazonHost }
  ]
}

function blockedResult(message, problems = [message]) {
  return {
    status: "BLOCKED",
    exitCode: 2,
    checksRun: 0,
    problems,
    message
  }
}

function failResult(problems, summary = {}) {
  return {
    status: "FAIL",
    exitCode: 1,
    checksRun: Math.max(1, problems.length),
    problems,
    message:
      "Supplied exact-package video playback evidence failed validation.",
    ...summary
  }
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

function hasSymlinkedPathComponent(directory, path) {
  const pathFromDirectory = relative(directory, path)
  let current = directory
  for (const component of pathFromDirectory.split(sep)) {
    current = resolve(current, component)
    try {
      if (lstatSync(current).isSymbolicLink()) return true
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false
      throw error
    }
  }
  return false
}

function validatePlayback(playback, provider, require) {
  require(hasExactKeys(playback, [
    "videoElementFound",
    "playbackStarted",
    "currentTimeBeforeSeconds",
    "currentTimeAfterSeconds",
    "playbackError"
  ]), `Playback observation has missing or unsupported fields for ${provider}.`)
  require(playback?.videoElementFound ===
    true, `No video element was observed for ${provider}.`)
  require(playback?.playbackStarted ===
    true, `Playback did not start for ${provider}.`)
  require(Number.isFinite(playback?.currentTimeBeforeSeconds) &&
    playback.currentTimeBeforeSeconds >= 0 &&
    Number.isFinite(playback?.currentTimeAfterSeconds) &&
    playback.currentTimeAfterSeconds >
      playback.currentTimeBeforeSeconds, `Playback timeline did not advance for ${provider}.`)
  require(playback?.playbackError ===
    null, `Playback reported an error for ${provider}.`)
}

/**
 * Validate externally captured, sanitized provider playback evidence.
 * Passing means the manifest, sidecars, bindings, and reported observations
 * are internally consistent. It does not authenticate the capture source.
 */
export function validateVideoPlaybackEvidence({
  evidencePath,
  expectedPackageDigest,
  expectedArtifactSha256,
  expectedBuildId,
  expectedSourceFingerprint,
  expectedExtensionVersion,
  trustedDevToolsInventory = undefined,
  sourceText,
  now = Date.now(),
  maxAgeMs = VIDEO_PLAYBACK_MAX_AGE_MS
}) {
  if (typeof evidencePath !== "string" || evidencePath.length === 0) {
    return blockedResult(
      "All-provider video playback is BLOCKED because no external evidence manifest was supplied."
    )
  }

  const missingBindings = []
  if (expectedPackageDigest == null) missingBindings.push("package tree digest")
  if (expectedArtifactSha256 == null)
    missingBindings.push("package ZIP SHA-256")
  if (expectedBuildId == null) missingBindings.push("package build ID")
  if (expectedSourceFingerprint == null) {
    missingBindings.push("source fingerprint")
  }
  if (expectedExtensionVersion == null)
    missingBindings.push("extension version")
  if (trustedDevToolsInventory == null) {
    missingBindings.push("trusted Chrome DevTools extension inventory")
  }
  if (missingBindings.length > 0) {
    return blockedResult(
      `All-provider video playback is BLOCKED because the current candidate binding is unavailable: ${missingBindings.join(", ")}.`,
      missingBindings.map((binding) => `Missing current ${binding}.`)
    )
  }

  if (
    !SHA256_PATTERN.test(expectedPackageDigest) ||
    !SHA256_PATTERN.test(expectedArtifactSha256) ||
    !UUID_V4_PATTERN.test(expectedBuildId) ||
    !SHA256_PATTERN.test(expectedSourceFingerprint) ||
    typeof expectedExtensionVersion !== "string" ||
    expectedExtensionVersion.length === 0 ||
    trustedDevToolsInventory?.source !== TRUSTED_DEVTOOLS_INVENTORY_SOURCE ||
    !EXTENSION_ID_PATTERN.test(trustedDevToolsInventory?.extensionId ?? "")
  ) {
    return failResult([
      "The current candidate or trusted extension identity is invalid."
    ])
  }

  const suppliedManifestPath = resolve(evidencePath)
  let manifestStat
  try {
    manifestStat = lstatSync(suppliedManifestPath)
  } catch {
    return blockedResult(
      "All-provider video playback is BLOCKED because the supplied external evidence manifest is unavailable or unreadable."
    )
  }
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    return failResult([
      "The supplied evidence manifest must be a regular, non-symlink file."
    ])
  }

  let manifestBytes
  let manifest
  let manifestDirectory
  try {
    manifestDirectory = realpathSync(dirname(suppliedManifestPath))
    const actualManifestPath = resolve(
      manifestDirectory,
      basename(suppliedManifestPath)
    )
    manifestBytes = readFileSync(actualManifestPath)
  } catch {
    return blockedResult(
      "All-provider video playback is BLOCKED because the supplied external evidence manifest is unavailable or unreadable."
    )
  }
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"))
  } catch {
    return failResult(["The supplied evidence manifest is not valid JSON."])
  }

  let targets
  try {
    targets = sourceDeclaredVideoPlaybackTargets(sourceText)
  } catch {
    return failResult([
      "The source-declared provider playback targets could not be read safely."
    ])
  }

  const problems = []
  const require = (condition, message) => {
    if (!condition) problems.push(message)
  }
  require(hasExactKeys(manifest, [
    "schemaVersion",
    "evidenceType",
    "captureMethod",
    "syntheticOnly",
    "packageDigest",
    "artifactSha256",
    "buildId",
    "sourceFingerprint",
    "captures"
  ]), "The evidence manifest has missing or unsupported fields.")
  require(manifest?.schemaVersion === 1 &&
    manifest?.evidenceType === VIDEO_PLAYBACK_EVIDENCE_TYPE &&
    manifest?.syntheticOnly ===
      true, "The evidence manifest schema, type, or synthetic-only declaration is unsupported.")
  require(manifest?.captureMethod ===
    VIDEO_PLAYBACK_CAPTURE_METHOD, "The manifest was not captured through the required Chrome DevTools source.")
  require(manifest?.packageDigest ===
    expectedPackageDigest, "The evidence manifest is bound to a different package tree digest.")
  require(manifest?.artifactSha256 ===
    expectedArtifactSha256, "The evidence manifest is bound to a different package ZIP SHA-256.")
  require(manifest?.buildId ===
    expectedBuildId, "The evidence manifest is bound to a different package build ID.")
  require(manifest?.sourceFingerprint ===
    expectedSourceFingerprint, "The evidence manifest is bound to a different source fingerprint.")

  const entries = Array.isArray(manifest?.captures) ? manifest.captures : []
  require(Array.isArray(manifest?.captures) &&
    entries.length ===
      targets.length, "The evidence manifest must contain exactly one capture for each provider.")
  const capturesByProvider = new Map()
  const captureIds = new Set()
  const artifactPaths = new Set()
  const summaryCaptures = []

  for (const entry of entries) {
    if (
      !hasExactKeys(entry, [
        "provider",
        "host",
        "captureId",
        "captureArtifact",
        "captureSha256"
      ])
    ) {
      problems.push("A capture entry has missing or unsupported fields.")
      continue
    }

    const target = targets.find(
      (candidate) => candidate.provider === entry.provider
    )
    require(Boolean(target), `Unexpected playback provider: ${entry.provider}.`)
    if (target) {
      require(entry.host ===
        target.host, `Playback host does not match the source-declared target for ${entry.provider}.`)
    }
    require(!capturesByProvider.has(
      entry.provider
    ), `Duplicate playback evidence for ${entry.provider}.`)
    capturesByProvider.set(entry.provider, entry)
    require(typeof entry.captureId === "string" &&
      CAPTURE_ID_PATTERN.test(
        entry.captureId
      ), `Capture ID is invalid for ${entry.provider}.`)
    require(!captureIds.has(entry.captureId), "Capture IDs must be unique.")
    captureIds.add(entry.captureId)
    require(typeof entry.captureSha256 === "string" &&
      SHA256_PATTERN.test(
        entry.captureSha256
      ), `Capture SHA-256 is invalid for ${entry.provider}.`)

    const capturePath = capturePathFor(manifestDirectory, entry.captureArtifact)
    require(capturePath !==
      null, `Capture file path is invalid for ${entry.provider}.`)
    if (!capturePath) continue
    const pathKey = relative(manifestDirectory, capturePath)
    require(!artifactPaths.has(
      pathKey
    ), "Capture artifact paths must be unique.")
    artifactPaths.add(pathKey)
    if (hasSymlinkedPathComponent(manifestDirectory, capturePath)) {
      problems.push(
        `Capture file path traverses a symlink for ${entry.provider}.`
      )
      continue
    }

    let captureStat
    let captureBytes
    try {
      captureStat = lstatSync(capturePath)
      if (!captureStat.isFile() || captureStat.isSymbolicLink()) {
        problems.push(
          `Capture artifact must be a regular, non-symlink file for ${entry.provider}.`
        )
        continue
      }
      captureBytes = readFileSync(capturePath)
    } catch {
      problems.push(`Capture artifact is unavailable for ${entry.provider}.`)
      continue
    }
    require(sha256(captureBytes) ===
      entry.captureSha256, `Capture file hash does not match for ${entry.provider}.`)

    let capture
    try {
      capture = JSON.parse(captureBytes.toString("utf8"))
    } catch {
      problems.push(`Capture sidecar is not valid JSON for ${entry.provider}.`)
      continue
    }
    require(hasExactKeys(capture, [
      "schemaVersion",
      "evidenceType",
      "captureMethod",
      "captureId",
      "provider",
      "host",
      "packageDigest",
      "artifactSha256",
      "buildId",
      "sourceFingerprint",
      "capturedAt",
      "browser",
      "extensionId",
      "extensionVersion",
      "playback"
    ]), `Capture sidecar has missing or unsupported fields for ${entry.provider}.`)
    require(capture?.schemaVersion === 1 &&
      capture?.evidenceType === VIDEO_PLAYBACK_CAPTURE_TYPE &&
      capture?.captureMethod ===
        VIDEO_PLAYBACK_CAPTURE_METHOD, `Capture sidecar schema, type, or method is unsupported for ${entry.provider}.`)
    require(capture?.captureId === entry.captureId &&
      capture?.provider === entry.provider &&
      capture?.host ===
        entry.host, `Capture sidecar identity does not match the manifest for ${entry.provider}.`)
    require(capture?.packageDigest === expectedPackageDigest &&
      capture?.artifactSha256 === expectedArtifactSha256 &&
      capture?.buildId === expectedBuildId &&
      capture?.sourceFingerprint ===
        expectedSourceFingerprint, `Capture sidecar is bound to a different package or source for ${entry.provider}.`)
    require(capture?.browser ===
      "Chrome Stable", `Capture browser is not Chrome Stable for ${entry.provider}.`)
    require(capture?.extensionId ===
      trustedDevToolsInventory.extensionId, `Capture extension ID does not match the trusted DevTools inventory for ${entry.provider}.`)
    require(capture?.extensionVersion ===
      expectedExtensionVersion, `Capture extension version does not match the current package for ${entry.provider}.`)

    const capturedAt = parseTimestamp(capture?.capturedAt)
    require(capturedAt !==
      null, `Capture timestamp is missing or invalid for ${entry.provider}.`)
    if (capturedAt !== null) {
      require(now - capturedAt <=
        maxAgeMs, `Capture evidence is stale for ${entry.provider}.`)
      require(capturedAt - now <=
        FUTURE_CLOCK_TOLERANCE_MS, `Capture timestamp is too far in the future for ${entry.provider}.`)
    }
    validatePlayback(capture?.playback, entry.provider, require)
    summaryCaptures.push({
      provider: entry.provider,
      host: entry.host,
      captureId: entry.captureId,
      capturedAt: capture?.capturedAt ?? null
    })
  }

  for (const target of targets) {
    require(capturesByProvider.has(
      target.provider
    ), `Missing playback evidence for ${target.provider}.`)
  }
  if (problems.length > 0) {
    return failResult(problems, {
      checksRun: targets.length,
      packageDigest: expectedPackageDigest,
      artifactSha256: expectedArtifactSha256,
      buildId: expectedBuildId,
      sourceFingerprint: expectedSourceFingerprint,
      expectedProviders: targets.map(({ provider, host }) => ({
        provider,
        host
      })),
      validatedProviders: 0,
      manifestSha256: sha256(manifestBytes),
      captures: summaryCaptures
    })
  }

  return {
    status: "PASS",
    exitCode: 0,
    checksRun: targets.length,
    problems: [],
    message:
      "All source-declared provider playback evidence passed consistency validation.",
    packageDigest: expectedPackageDigest,
    artifactSha256: expectedArtifactSha256,
    buildId: expectedBuildId,
    sourceFingerprint: expectedSourceFingerprint,
    manifestSha256: sha256(manifestBytes),
    expectedProviders: targets.map(({ provider, host }) => ({
      provider,
      host
    })),
    validatedProviders: targets.length,
    captures: summaryCaptures
  }
}
