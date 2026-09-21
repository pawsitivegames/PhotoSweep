const CHROME_VERSION_PARTS = 4
const CHROME_VERSION_MAX = 65535

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
    throw new Error("ZIP SHA-256 must be a lowercase 64-character hexadecimal digest")
  }
  return `photosweep-cws-v${chromeVersion}-sha256-${sha256.slice(0, 12)}.zip`
}

export function cwsArtifactMetadataFileName(artifactFileName) {
  if (!artifactFileName.endsWith(".zip")) {
    throw new Error(`Expected a ZIP artifact filename: ${artifactFileName}`)
  }
  return artifactFileName.slice(0, -4) + ".json"
}
