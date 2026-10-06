import { createHash, createPublicKey } from "node:crypto"
import { strToU8, zipSync } from "fflate"
import { describe, expect, it } from "vitest"

import { auditZipEntitlementPublicKey } from "../../tools/cws-entitlement-key-audit.mjs"

const PUBLIC_POINTS = {
  first: {
    x: "6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296",
    y: "4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5"
  },
  second: {
    x: "7cf27b188d034f7e8a52380304b51ac3c08969e277f21b35a60b48fc47669978",
    y: "07775510db8ed040293d9ac69f7430dbba7dade63ce982299e04b79d227873d1"
  }
}

function encodedPublicKey(
  point: (typeof PUBLIC_POINTS)[keyof typeof PUBLIC_POINTS]
) {
  const publicKey = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: Buffer.from(point.x, "hex").toString("base64url"),
      y: Buffer.from(point.y, "hex").toString("base64url")
    },
    format: "jwk"
  })
  return publicKey.export({ format: "der", type: "spki" }).toString("base64url")
}

function packageZip(files: Record<string, string>) {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, text]) => [name, strToU8(text)])
    ),
    { level: 6 }
  )
}

describe("auditZipEntitlementPublicKey", () => {
  const configuredKey = encodedPublicKey(PUBLIC_POINTS.first)

  it("matches the configured P-256 SPKI fingerprint in final ZIP JavaScript", () => {
    const result = auditZipEntitlementPublicKey(
      packageZip({
        "background.js": `const entitlementKey = "${configuredKey}";`
      }),
      configuredKey
    )

    const expectedSha256 = createHash("sha256")
      .update(Buffer.from(configuredKey, "base64url"))
      .digest("hex")
    expect(result).toEqual({
      sha256: expectedSha256,
      matchingJavaScriptFiles: ["background.js"]
    })
  })

  it("requires the expected package build ID in final ZIP JavaScript", () => {
    const expectedBuildId = "123e4567-e89b-42d3-a456-426614174000"
    const expectedSha256 = createHash("sha256")
      .update(Buffer.from(configuredKey, "base64url"))
      .digest("hex")
    const matchingZip = packageZip({
      "background.js": `const entitlementKey = "${configuredKey}"; const buildId = "${expectedBuildId}";`
    })
    const missingBuildIdZip = packageZip({
      "background.js": `const entitlementKey = "${configuredKey}";`
    })
    const wrongBuildIdZip = packageZip({
      "background.js": `const entitlementKey = "${configuredKey}"; const buildId = "00000000-0000-4000-8000-000000000000";`
    })

    expect(
      auditZipEntitlementPublicKey(matchingZip, configuredKey, expectedBuildId)
    ).toEqual({
      sha256: expectedSha256,
      matchingJavaScriptFiles: ["background.js"]
    })

    for (const zipBytes of [missingBuildIdZip, wrongBuildIdZip]) {
      expect(() =>
        auditZipEntitlementPublicKey(zipBytes, configuredKey, expectedBuildId)
      ).toThrow(
        "final extension ZIP does not embed the expected package build ID"
      )
    }
  })

  it("rejects a different valid P-256 key embedded in the final ZIP", () => {
    const otherKey = encodedPublicKey(PUBLIC_POINTS.second)

    expect(() =>
      auditZipEntitlementPublicKey(
        packageZip({
          "background.js": `const entitlementKey = "${otherKey}";`
        }),
        configuredKey
      )
    ).toThrow(
      "final extension ZIP does not embed the configured entitlement public key"
    )
  })

  it("rejects an invalid configured key and an unreadable ZIP", () => {
    expect(() =>
      auditZipEntitlementPublicKey(
        packageZip({ "background.js": "empty" }),
        "not-a-key"
      )
    ).toThrow(
      "configured entitlement key must be a base64url P-256 SPKI public key"
    )

    expect(() =>
      auditZipEntitlementPublicKey(new Uint8Array(), configuredKey)
    ).toThrow("final extension ZIP could not be inspected")
  })
})
