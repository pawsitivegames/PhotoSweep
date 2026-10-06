import { createHash, createPublicKey } from "node:crypto"
import { unzipSync } from "fflate"

const PUBLIC_KEY_CANDIDATE =
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{120,124}={0,2}(?![A-Za-z0-9_-])/g

function publicKeyFingerprint(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) {
    throw new Error(
      "configured entitlement key must be a base64url P-256 SPKI public key"
    )
  }

  const unpaddedValue = value.replace(/=+$/, "")
  const der = Buffer.from(unpaddedValue, "base64url")
  if (!der.length || der.toString("base64url") !== unpaddedValue) {
    throw new Error(
      "configured entitlement key must be a base64url P-256 SPKI public key"
    )
  }

  let key
  try {
    key = createPublicKey({ key: der, format: "der", type: "spki" })
  } catch {
    throw new Error(
      "configured entitlement key must be a base64url P-256 SPKI public key"
    )
  }
  if (
    key.asymmetricKeyType !== "ec" ||
    key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    throw new Error(
      "configured entitlement key must be a base64url P-256 SPKI public key"
    )
  }

  const canonicalDer = key.export({ format: "der", type: "spki" })
  if (!Buffer.from(canonicalDer).equals(der)) {
    throw new Error(
      "configured entitlement key must be a base64url P-256 SPKI public key"
    )
  }

  return createHash("sha256").update(canonicalDer).digest("hex")
}

function embeddedPublicKeyFingerprints(jsText) {
  const fingerprints = new Set()
  for (const match of jsText.matchAll(PUBLIC_KEY_CANDIDATE)) {
    try {
      fingerprints.add(publicKeyFingerprint(match[0]))
    } catch {
      // Most long strings in a bundle are not SPKI public keys.
    }
  }
  return fingerprints
}

export function auditZipEntitlementPublicKey(
  zipBytes,
  configuredPublicKey,
  expectedBuildId
) {
  const configuredFingerprint = publicKeyFingerprint(configuredPublicKey)

  let files
  try {
    files = unzipSync(zipBytes)
  } catch {
    throw new Error("final extension ZIP could not be inspected")
  }

  const matchingJavaScriptFiles = []
  let containsExpectedBuildId = !expectedBuildId
  for (const [fileName, fileBytes] of Object.entries(files)) {
    if (!fileName.endsWith(".js")) continue

    let jsText
    try {
      jsText = new TextDecoder("utf-8", { fatal: true }).decode(fileBytes)
    } catch {
      throw new Error(
        `final extension ZIP contains invalid JavaScript text: ${fileName}`
      )
    }
    if (expectedBuildId && jsText.includes(expectedBuildId)) {
      containsExpectedBuildId = true
    }
    if (embeddedPublicKeyFingerprints(jsText).has(configuredFingerprint)) {
      matchingJavaScriptFiles.push(fileName)
    }
  }

  if (!containsExpectedBuildId) {
    throw new Error(
      "final extension ZIP does not embed the expected package build ID"
    )
  }
  if (matchingJavaScriptFiles.length === 0) {
    throw new Error(
      "final extension ZIP does not embed the configured entitlement public key"
    )
  }

  return {
    sha256: configuredFingerprint,
    matchingJavaScriptFiles: matchingJavaScriptFiles.sort()
  }
}
