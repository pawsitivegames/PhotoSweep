import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PhotoSweepBrandMark } from "../../components/PhotoSweepBrandMark"

describe("PhotoSweepBrandMark", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("uses the active 128px icon from the extension manifest", () => {
    const getURL = vi.fn((path: string) => `chrome-extension://test/${path}`)
    vi.stubGlobal("chrome", {
      runtime: {
        getManifest: () => ({ icons: { "128": "icon128.png" } }),
        getURL
      }
    })

    const { container } = render(<PhotoSweepBrandMark />)
    const image = container.querySelector("img")

    expect(image).toHaveAttribute("src", "chrome-extension://test/icon128.png")
    expect(image).toHaveAttribute("alt", "")
    expect(image).toHaveAttribute("aria-hidden", "true")
    expect(image).toHaveStyle({ width: "34px", height: "34px" })
    expect(getURL).toHaveBeenCalledWith("icon128.png")
  })

  it("rejects a manifest without the packaged canonical icon", () => {
    vi.stubGlobal("chrome", {
      runtime: {
        getManifest: () => ({ icons: {} }),
        getURL: (path: string) => `chrome-extension://test/${path}`
      }
    })

    expect(() => render(<PhotoSweepBrandMark size={28} />)).toThrow(
      "The extension manifest is missing its 128px brand icon"
    )
  })
})
