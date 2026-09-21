import { describe, expect, it } from "vitest"

import {
  assertChromeVersion,
  cwsArtifactFileName,
  cwsArtifactMetadataFileName,
  getCwsReleaseIdentity
} from "../../tools/cws-artifact.mjs"

describe("Chrome Web Store artifact identity", () => {
  it("keeps the app semver prefix while adding a Chrome-only build component", () => {
    expect(
      getCwsReleaseIdentity({
        version: "2.2.9",
        manifest: { version: "2.2.9.1" }
      })
    ).toEqual({ appVersion: "2.2.9", chromeVersion: "2.2.9.1" })
  })

  it.each([
    ["2.3.0", "2.3.0.1"],
    ["3.0.0", "3.0.0.1"]
  ])("supports the %s release level as %s", (appVersion, chromeVersion) => {
    expect(
      getCwsReleaseIdentity({ version: appVersion, chromeVersion })
    ).toEqual({ appVersion, chromeVersion })
  })

  it("rejects plus metadata and mismatched app prefixes", () => {
    expect(() => assertChromeVersion("2.2.9+1", "2.2.9")).toThrow(
      /exactly four dot-separated integers/
    )
    expect(() => assertChromeVersion("2.3.0.1", "2.2.9")).toThrow(
      /preserve the app version prefix/
    )
  })

  it("names an artifact from both Chrome version and ZIP digest", () => {
    const digest = "a".repeat(64)
    const zip = cwsArtifactFileName("2.2.9.1", digest)

    expect(zip).toBe("photosweep-cws-v2.2.9.1-sha256-aaaaaaaaaaaa.zip")
    expect(cwsArtifactMetadataFileName(zip)).toBe(
      "photosweep-cws-v2.2.9.1-sha256-aaaaaaaaaaaa.json"
    )
  })
})
