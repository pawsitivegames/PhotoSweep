const CHROME_VERSION_PARTS = 4
const CHROME_VERSION_MAX = 65535
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const BUILD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function getCwsReleaseIdentity(packageJson) {
  const appVersion = String(packageJson?.version ?? "")
  const chromeVersion = String(
    packageJson?.chromeVersion ?? packageJson?.manifest?.version ?? ""
  )

  assertChromeVersion(chromeVersion, appVersion)

  return { appVersion, chromeVersion }
}

export function assertChromeVersion(chromeVersion, appVersion = undefined) {
  const parts = String(chromeVersion).split(".")

  if (
    parts.length !== CHROME_VERSION_PARTS ||
    parts.some(
      (part) =>
        !/^\d+$/.test(part) ||
        (part.length > 1 && part.startsWith("0")) ||
        Number(part) > CHROME_VERSION_MAX
    )
  ) {
    throw new Error(
      `Chrome version must contain exactly four dot-separated integers from 0 to ${CHROME_VERSION_MAX}: ${chromeVersion}`
    )
  }

  if (appVersion) {
    const appBase = String(appVersion).match(/^\d+\.\d+\.\d+/)?.[0]
    const chromeBase = parts.slice(0, 3).join(".")
    if (!appBase || chromeBase !== appBase) {
      throw new Error(
        `Chrome version ${chromeVersion} must preserve the app version prefix ${appBase ?? appVersion}`
      )
    }
  }
}

export function cwsArtifactFileName(chromeVersion, sha256) {
  assertChromeVersion(chromeVersion)
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(
      "ZIP SHA-256 must be a lowercase 64-character hexadecimal digest"
    )
  }
  return `photosweep-cws-v${chromeVersion}-sha256-${sha256.slice(0, 12)}.zip`
}

export function cwsArtifactMetadataFileName(artifactFileName) {
  if (!artifactFileName.endsWith(".zip")) {
    throw new Error(`Expected a ZIP artifact filename: ${artifactFileName}`)
  }
  return artifactFileName.slice(0, -4) + ".json"
}

export function isCwsBuildId(value) {
  return typeof value === "string" && BUILD_ID_PATTERN.test(value)
}

export function assertCwsBuildId(value) {
  if (!isCwsBuildId(value)) {
    throw new Error("Package build ID must be a canonical UUID v4")
  }
  return value
}

export function createCwsArtifactMetadata(input) {
  const metadata = {
    schemaVersion: 2,
    artifactType: "chrome-web-store-zip",
    appVersion: input.appVersion,
    chromeVersion: input.chromeVersion,
    artifactFile: input.artifactFile,
    artifactSha256: input.artifactSha256,
    manifestSha256: input.manifestSha256,
    sourceCommit: input.sourceCommit,
    sourceDirty: input.sourceDirty,
    sourceStatusSha256: input.sourceStatusSha256,
    trackedDiffSha256: input.trackedDiffSha256,
    sourceFingerprint: input.sourceFingerprint,
    sourceFileCount: input.sourceFileCount,
    buildId: input.buildId,
    builtAt: input.builtAt
  }
  const problems = validateCwsArtifactMetadata(metadata)
  if (problems.length > 0) {
    throw new Error(`Invalid CWS artifact metadata: ${problems.join("; ")}`)
  }
  return metadata
}

export function validateCwsArtifactMetadata(metadata, expected = {}) {
  const problems = []
  const require = (condition, message) => {
    if (!condition) problems.push(message)
  }
  let expectedName = ""
  try {
    const identity = getCwsReleaseIdentity({
      version: metadata?.appVersion,
      chromeVersion: metadata?.chromeVersion
    })
    expectedName = cwsArtifactFileName(
      identity.chromeVersion,
      metadata?.artifactSha256
    )
  } catch {
    // Individual version and hash checks below carry the useful diagnostics.
  }

  require(metadata?.schemaVersion ===
    2, "artifact metadata schema version must be 2")
  require(metadata?.artifactType ===
    "chrome-web-store-zip", "artifact type must be chrome-web-store-zip")
  require(SHA256_PATTERN.test(
    metadata?.artifactSha256 ?? ""
  ), "artifact SHA-256 is invalid")
  require(SHA256_PATTERN.test(
    metadata?.manifestSha256 ?? ""
  ), "manifest SHA-256 is invalid")
  require(SHA256_PATTERN.test(
    metadata?.sourceStatusSha256 ?? ""
  ), "source status SHA-256 is invalid")
  require(SHA256_PATTERN.test(
    metadata?.trackedDiffSha256 ?? ""
  ), "tracked diff SHA-256 is invalid")
  require(SHA256_PATTERN.test(
    metadata?.sourceFingerprint ?? ""
  ), "source fingerprint is invalid")
  require(isCwsBuildId(metadata?.buildId), "package build ID is invalid")
  require(typeof metadata?.sourceFileCount === "number" &&
    Number.isSafeInteger(metadata.sourceFileCount) &&
    metadata.sourceFileCount > 0, "source file count is invalid")
  require(typeof metadata?.sourceDirty ===
    "boolean", "source dirty flag is invalid")
  require(typeof metadata?.sourceCommit === "string" &&
    /^[a-f0-9]{40,64}$/.test(metadata.sourceCommit), "source commit is invalid")
  require(typeof metadata?.builtAt === "string" &&
    Number.isFinite(Date.parse(metadata.builtAt)), "build timestamp is invalid")
  require(typeof metadata?.artifactFile === "string" &&
    metadata.artifactFile.replaceAll("\\", "/").split("/").at(-1) ===
      expectedName &&
    expectedName.length >
      0, "artifact filename does not match its Chrome version and SHA-256")

  if (expected.chromeVersion !== undefined) {
    require(metadata?.chromeVersion ===
      expected.chromeVersion, "Chrome version does not match the expected package")
  }
  if (expected.buildId !== undefined) {
    require(metadata?.buildId ===
      expected.buildId, "package build ID does not match the expected build")
  }
  if (expected.artifactSha256 !== undefined) {
    require(metadata?.artifactSha256 ===
      expected.artifactSha256, "artifact SHA-256 does not match the expected package")
  }
  if (expected.sourceFingerprint !== undefined) {
    require(metadata?.sourceFingerprint ===
      expected.sourceFingerprint, "source fingerprint does not match the expected source")
  }

  return problems
}
