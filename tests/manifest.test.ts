import { describe, expect, it } from "vitest"

import {
  AMAZON_ORIGIN_MATCHES,
  AMAZON_ORIGINS,
  GOOGLE_PHOTOS_ORIGIN_MATCHES,
  ICLOUD_ORIGIN_MATCHES
} from "../lib/provider-sites"
import packageJson from "../package.json"

describe("extension manifest", () => {
  it("uses a Chrome-safe four-part release version distinct from app semver", () => {
    const chromeVersion = packageJson.chromeVersion

    expect(chromeVersion).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    expect(chromeVersion.split(".").slice(0, 3).join(".")).toBe(
      packageJson.version
    )
  })

  it("locks the Chrome Web Store title and short description", () => {
    expect(packageJson.displayName).toBe("PhotoSweep for Google Photos™")
    expect(packageJson.description).toBe(
      "Find duplicate photos and videos in Google Photos. Matching stays in your browser. Review, then Trash only what you confirm."
    )
    expect([...packageJson.displayName].length).toBeLessThanOrEqual(75)
    expect([...packageJson.description].length).toBeLessThanOrEqual(132)
  })

  it("uses an injected license API origin for release packages", () => {
    expect(packageJson.manifest.host_permissions).toContain(
      "$PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION"
    )
  })

  it("allows the license API origin to handshake", () => {
    expect(packageJson.manifest.externally_connectable.matches).toEqual(
      expect.arrayContaining([
        "$PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION"
      ])
    )
  })

  it("keeps extension pages on bundled scripts only", () => {
    expect(packageJson.manifest.content_security_policy.extension_pages).toBe(
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
    )
    expect(
      packageJson.manifest.content_security_policy.extension_pages
    ).not.toMatch(/https?:|blob:|data:/)
  })

  it("does not expose remote executable JavaScript as web-accessible resources", () => {
    const resources = packageJson.manifest.web_accessible_resources.flatMap(
      (entry) => entry.resources
    )

    expect(resources).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^https?:/)])
    )
    expect(resources).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\/\/.*\.js(?:\?|$)/)])
    )
  })

  it("uses origin-scoped match patterns for Amazon web-accessible resources", () => {
    const matches = packageJson.manifest.web_accessible_resources.flatMap(
      (entry) => entry.matches
    )

    expect(matches.filter((match) => match.includes("amazon."))).toEqual(
      expect.arrayContaining([
        "https://www.amazon.com/*",
        "https://www.amazon.ca/*"
      ])
    )
    expect(matches.filter((match) => match.includes("amazon."))).not.toEqual(
      expect.arrayContaining([expect.stringContaining("/photos")])
    )
  })

  it("declares the complete explicit regional provider matrix", () => {
    const hostPermissions = packageJson.manifest.host_permissions
    const warMatches = packageJson.manifest.web_accessible_resources.flatMap(
      (entry) => entry.matches
    )
    const amazonPagePermissions = AMAZON_ORIGINS.map((origin) => `${origin}/*`)
    const amazonThumbnailPermissions = AMAZON_ORIGINS.map((origin) => {
      const host = new URL(origin).hostname.replace(/^www\./, "")
      return `https://thumbnails-photos.${host}/*`
    })

    expect(hostPermissions).toEqual(
      expect.arrayContaining([
        ...GOOGLE_PHOTOS_ORIGIN_MATCHES,
        ...ICLOUD_ORIGIN_MATCHES,
        ...amazonPagePermissions,
        ...amazonThumbnailPermissions
      ])
    )
    expect(warMatches).toEqual(
      expect.arrayContaining([
        ...GOOGLE_PHOTOS_ORIGIN_MATCHES,
        ...ICLOUD_ORIGIN_MATCHES,
        ...AMAZON_ORIGIN_MATCHES
      ])
    )
    expect(hostPermissions).not.toContain("https://www.amazon.be/*")
    expect(hostPermissions).not.toContain("https://amazon.be/*")
    expect(warMatches).not.toContain("https://www.amazon.be/*")
    expect(warMatches).not.toContain("https://amazon.be/*")
  })
})
