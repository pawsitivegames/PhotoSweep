import { describe, expect, it } from "vitest"

import {
  getProviderOperations,
  providerBatchLimit,
  providerFromUrl,
  providerLabel
} from "../../lib/provider-operations"
import {
  AMAZON_MARKETPLACE_HOSTS,
  GOOGLE_PHOTOS_ORIGINS,
  ICLOUD_HOSTS
} from "../../lib/provider-sites"
import { DEFAULT_SETTINGS } from "../../lib/types"

describe("provider operations", () => {
  it.each([
    ["https://photos.google.com/u/0/albums?hl=fr", "google"],
    ["https://www.icloud.com/photos/", "icloud"],
    ["https://icloud.com/photos/", "icloud"],
    ["https://www.icloud.com.cn/photos/", "icloud"],
    ["https://icloud.com.cn/photos/", "icloud"],
    ["https://www.amazon.ca/photos?sf=1", "amazon"],
    ["https://amazon.in/photos?sf=1", "amazon"],
    ["https://www.amazon.com.be/photos?sf=1", "amazon"],
    ["https://amazon.ie/photos?sf=1", "amazon"]
  ] as const)("resolves %s to the %s adapter", (url, provider) => {
    expect(providerFromUrl(url)).toBe(provider)
  })

  it("covers every official Amazon locale on bare and www hosts", () => {
    const amazon = getProviderOperations("amazon")
    const expectedOrigins = AMAZON_MARKETPLACE_HOSTS.flatMap((host) => [
      `https://www.${host}`,
      `https://${host}`
    ])

    expect(amazon.origins).toEqual(expectedOrigins)
    for (const origin of expectedOrigins) {
      expect(amazon.matchesUrl(`${origin}/photos?sf=1`, true)).toBe(true)
      expect(providerFromUrl(`${origin}/photos?sf=1`)).toBe("amazon")
    }
    expect(amazon.matchesUrl("https://www.amazon.be/photos", true)).toBe(false)
    expect(amazon.matchesUrl("https://amazon.co.za/photos", true)).toBe(false)
  })

  it("covers iCloud regional and bare-host variants without broadening scope", () => {
    const icloud = getProviderOperations("icloud")
    expect(icloud.origins).toEqual(
      ICLOUD_HOSTS.map((host) => `https://${host}`)
    )
    for (const host of ICLOUD_HOSTS) {
      expect(icloud.matchesUrl(`https://${host}/photos`, true)).toBe(true)
    }
    expect(icloud.matchesUrl("https://support.icloud.com/photos", true)).toBe(
      false
    )
  })

  it("keeps Google Photos locale/account paths on the canonical host", () => {
    expect(getProviderOperations("google").origins).toEqual(
      GOOGLE_PHOTOS_ORIGINS
    )
    expect(providerFromUrl("https://photos.google.com/u/2/albums?hl=de")).toBe(
      "google"
    )
    expect(providerFromUrl("https://photos.google.ca/u/2/albums")).toBe(null)
  })

  it("keeps Amazon navigation on a supported regional origin", () => {
    expect(
      getProviderOperations("amazon").openUrl("https://www.amazon.ca")
    ).toBe("https://www.amazon.ca/photos?sf=1")
    expect(
      getProviderOperations("amazon").openUrl("https://malicious.example")
    ).toBe("https://www.amazon.com/photos?sf=1")
  })

  it("distinguishes a provider tab from its photos page", () => {
    const amazon = getProviderOperations("amazon")
    expect(amazon.matchesUrl("https://www.amazon.com/orders")).toBe(true)
    expect(amazon.matchesUrl("https://www.amazon.com/orders", true)).toBe(false)
  })

  it("owns provider-specific batch limits and capabilities", () => {
    expect(
      providerBatchLimit({
        ...DEFAULT_SETTINGS,
        sourceProvider: "amazon",
        amazonBatchLimit: 25.9
      })
    ).toBe(25)
    expect(getProviderOperations("google").supportsAlbumScope).toBe(true)
    expect(getProviderOperations("icloud").injectBridgeIntoAllFrames).toBe(true)
  })

  it("provides one canonical label", () => {
    expect(providerLabel(undefined)).toBe("Google Photos")
    expect(providerLabel("icloud")).toBe("iCloud Photos")
  })
})
