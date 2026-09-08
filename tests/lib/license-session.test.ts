import { describe, expect, it } from "vitest"

import {
  isAllowedLicenseSessionSender,
  isLicenseSessionExternalMessage,
  isValidLicenseSessionId,
  LICENSE_SESSION_MESSAGE_TYPE
} from "../../lib/license-session"

describe("license session helpers", () => {
  it("accepts only bounded extension-safe session ids", () => {
    expect(isValidLicenseSessionId("a")).toBe(true)
    expect(isValidLicenseSessionId("A-z_09")).toBe(true)
    expect(isValidLicenseSessionId("a".repeat(256))).toBe(true)
    expect(isValidLicenseSessionId("")).toBe(false)
    expect(isValidLicenseSessionId("a".repeat(257))).toBe(false)
    expect(isValidLicenseSessionId("session id")).toBe(false)
    expect(isValidLicenseSessionId("session/one")).toBe(false)
  })

  it("guards the external handshake message shape", () => {
    expect(
      isLicenseSessionExternalMessage({
        type: LICENSE_SESSION_MESSAGE_TYPE,
        licenseSessionId: "pls_valid"
      })
    ).toBe(true)
    expect(
      isLicenseSessionExternalMessage({
        type: LICENSE_SESSION_MESSAGE_TYPE,
        licenseSessionId: "bad session"
      })
    ).toBe(false)
    expect(isLicenseSessionExternalMessage(null)).toBe(false)
  })

  it("matches HTTPS sender URLs against Chrome match patterns", () => {
    const patterns = ["https://license.example/*"]
    expect(
      isAllowedLicenseSessionSender(
        "https://license.example/checkout/success?licenseSessionId=pls_valid",
        patterns
      )
    ).toBe(true)
    expect(
      isAllowedLicenseSessionSender("http://license.example/", patterns)
    ).toBe(false)
    expect(
      isAllowedLicenseSessionSender(
        "https://user:password@license.example/",
        patterns
      )
    ).toBe(false)
    expect(
      isAllowedLicenseSessionSender("https://attacker.example/", patterns)
    ).toBe(false)
  })

  it("supports wildcard subdomains without widening the base host", () => {
    const patterns = ["https://*.license.example/checkout/*"]
    expect(
      isAllowedLicenseSessionSender(
        "https://api.license.example/checkout/success",
        patterns
      )
    ).toBe(true)
    expect(
      isAllowedLicenseSessionSender(
        "https://license.example/checkout/success",
        patterns
      )
    ).toBe(true)
    expect(
      isAllowedLicenseSessionSender(
        "https://license.example/account",
        patterns
      )
    ).toBe(false)
    expect(
      isAllowedLicenseSessionSender(
        "https://notlicense.example/checkout/success",
        patterns
      )
    ).toBe(false)
  })
})
