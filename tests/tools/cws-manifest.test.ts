import { describe, expect, it } from "vitest"

import { orderProviderContentScripts } from "../../tools/cws-manifest.mjs"

const entry = (name: string) => ({ js: [`${name}.0123abcd.js`] })

describe("Chrome package provider content script order", () => {
  it("places each provider bridge before its injector in a stable order", () => {
    const shuffled = [
      entry("amazon-photos-inject"),
      entry("icloud-photos-inject"),
      entry("google-photos-inject"),
      entry("amazon-photos-bridge"),
      entry("google-photos-bridge"),
      entry("icloud-photos-bridge")
    ]

    expect(orderProviderContentScripts(shuffled).map(({ js }) => js[0])).toEqual([
      "google-photos-bridge.0123abcd.js",
      "google-photos-inject.0123abcd.js",
      "icloud-photos-bridge.0123abcd.js",
      "icloud-photos-inject.0123abcd.js",
      "amazon-photos-bridge.0123abcd.js",
      "amazon-photos-inject.0123abcd.js"
    ])
    expect(orderProviderContentScripts(shuffled.slice().reverse())).toEqual(
      orderProviderContentScripts(shuffled)
    )
  })

  it("rejects missing, duplicate, and unclassified content scripts", () => {
    const complete = [
      entry("google-photos-bridge"),
      entry("google-photos-inject"),
      entry("icloud-photos-bridge"),
      entry("icloud-photos-inject"),
      entry("amazon-photos-bridge"),
      entry("amazon-photos-inject")
    ]

    expect(() => orderProviderContentScripts(complete.slice(1))).toThrow(
      "Missing provider content script: google:bridge"
    )
    expect(() =>
      orderProviderContentScripts([...complete, complete[0]])
    ).toThrow("Duplicate provider content script: google:bridge")
    expect(() =>
      orderProviderContentScripts([...complete.slice(0, 5), entry("other-script")])
    ).toThrow("Unclassified provider content script: other-script.0123abcd.js")
  })
})
