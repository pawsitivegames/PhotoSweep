import { describe, expect, it } from "vitest"
import {
  chromeExtensionIdForPath,
  getPlasmoDevExtensionPath
} from "../../tools/chrome-extension-id.mjs"

describe("Chrome unpacked extension identity", () => {
  it("derives the expected ID from Chromium's absolute-path hash", () => {
    expect(
      chromeExtensionIdForPath("/tmp/photosweep/build/chrome-mv3-dev")
    ).toBe("lcflieiblaimccbelfgemkffgelelfli")
  })

  it("requires an absolute unpacked-extension path", () => {
    expect(() => chromeExtensionIdForPath("build/chrome-mv3-dev")).toThrow(
      /absolute path/
    )
  })

  it("matches Plasmo's CLI and environment selection for the dev output path", () => {
    expect(getPlasmoDevExtensionPath("/tmp/photosweep", [], {})).toBe(
      "/tmp/photosweep/build/chrome-mv3-dev"
    )
    expect(
      getPlasmoDevExtensionPath(
        "/tmp/photosweep",
        ["--build-path=out", "--target=Chrome-MV3", "--tag=dev"],
        { PLASMO_BUILD_PATH: "ignored", PLASMO_TARGET: "firefox-mv2" }
      )
    ).toBe("/tmp/photosweep/out/chrome-mv3-dev")
    expect(
      getPlasmoDevExtensionPath("/tmp/photosweep", [], {
        PLASMO_BUILD_PATH: "artifacts",
        PLASMO_TARGET: "chrome-mv3",
        PLASMO_TAG: "qa"
      })
    ).toBe("/tmp/photosweep/artifacts/chrome-mv3-qa")
  })

  it("uses the development output when NODE_ENV=production is inherited", () => {
    expect(
      getPlasmoDevExtensionPath("/tmp/photosweep", [], {
        NODE_ENV: "production"
      })
    ).toBe("/tmp/photosweep/build/chrome-mv3-dev")
    expect(
      getPlasmoDevExtensionPath(
        "/tmp/photosweep",
        ["--tag=prod"],
        { NODE_ENV: "production" }
      )
    ).toBe("/tmp/photosweep/build/chrome-mv3-prod")
    expect(
      getPlasmoDevExtensionPath("/tmp/photosweep", [], {
        NODE_ENV: "production",
        PLASMO_TAG: "qa"
      })
    ).toBe("/tmp/photosweep/build/chrome-mv3-qa")
  })
})
