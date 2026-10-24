import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { liveScanMatchesFixture, parseLiveScanFixture, requireLiveExtensionId } from "../e2e/fixtures/live-scan-contract"

const browserMocks = vi.hoisted(() => ({ connectOverCDP: vi.fn() }))
vi.mock("@playwright/test", () => ({
  chromium: { connectOverCDP: browserMocks.connectOverCDP }
}))

const fixture = {
  schemaVersion: 1, provider: "google", albumTitle: "Synthetic tiny album", albumId: "synthetic-album",
  expectedMediaKeys: ["original", "copy", "control"], expectedGroups: [["original", "copy"]]
}
const compactResult = {
  sourceProvider: "google", totalItems: 3, scanCoverage: { itemsReturned: 3 }, mediaItemsAreComplete: false,
  mediaItems: { original: {}, copy: {} }, groups: [{ mediaKeys: ["copy", "original"] }]
}

describe("live E2E scope and oracle", () => {
  it.each([undefined, "", "a".repeat(31), "z".repeat(32), "a".repeat(32) + "/tabs/app.html"])("rejects a missing or malformed explicit target", (id) => {
    expect(() => requireLiveExtensionId(id)).toThrow(/PHOTOSWEEP_E2E_EXTENSION_ID/)
  })
  it("requires an exact album identity and bounded unique oracle", () => {
    for (const bad of [null, { ...fixture, provider: "amazon" }, { ...fixture, albumId: "" },
      { ...fixture, expectedMediaKeys: [] }, { ...fixture, expectedMediaKeys: ["same", "same"] },
      { ...fixture, expectedMediaKeys: Array.from({ length: 101 }, (_, n) => String(n)) },
      { ...fixture, expectedGroups: [["original", "unknown"]] },
      { ...fixture, expectedGroups: [["original", "copy"], ["original", "control"]] }]) {
      expect(() => parseLiveScanFixture(bad)).toThrow()
    }
  })
  it("accepts compact results without claiming non-grouped inventory was retained", () => {
    expect(liveScanMatchesFixture(compactResult, parseLiveScanFixture(fixture))).toBe(true)
    expect(liveScanMatchesFixture({ ...compactResult, mediaItemsAreComplete: true }, parseLiveScanFixture(fixture))).toBe(false)
  })
  it("rejects wrong membership/grouping even when counts match", () => {
    const expected = parseLiveScanFixture(fixture)
    expect(liveScanMatchesFixture({ ...compactResult, mediaItems: { original: {}, stranger: {} } }, expected)).toBe(false)
    expect(liveScanMatchesFixture({ ...compactResult, groups: [{ mediaKeys: ["original", "control"] }] }, expected)).toBe(false)
    expect(liveScanMatchesFixture({ ...compactResult, scanCoverage: { itemsReturned: 2 } }, expected)).toBe(false)
    expect(liveScanMatchesFixture({ ...compactResult, totalItems: 2 }, expected)).toBe(false)
    expect(liveScanMatchesFixture({ ...compactResult, sourceProvider: "icloud" }, expected)).toBe(false)
  })
  it("accepts a genuine no-duplicate oracle and rejects invented duplicate groups", () => {
    const expected = parseLiveScanFixture({ ...fixture, expectedGroups: [] })
    expect(liveScanMatchesFixture({ ...compactResult, mediaItems: {}, groups: [] }, expected)).toBe(true)
    expect(liveScanMatchesFixture(compactResult, expected)).toBe(false)
  })
})

const scratch: string[] = []
afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

async function connectedTarget(actualId = "b".repeat(32), actualVersion = "2.3.6.20") {
  const base = resolve("tmp/verification")
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, "live-e2e-unit-"))
  scratch.push(directory)
  writeFileSync(join(directory, "manifest.json"), JSON.stringify({ name: "PhotoSweep test", version: "2.3.6.20" }))
  vi.stubEnv("PHOTOSWEEP_E2E_EXTENSION_ID", "b".repeat(32))
  vi.stubEnv("PHOTOSWEEP_E2E_EXTENSION_PATH", directory)
  vi.stubEnv("GPD_E2E_USER_DATA_DIR", "")
  const helper = { goto: vi.fn(), close: vi.fn(), evaluate: vi.fn().mockResolvedValue({ id: actualId, manifest: { name: "PhotoSweep test", version: actualVersion } }) }
  const context = { newPage: vi.fn().mockResolvedValue(helper), serviceWorkers: vi.fn().mockReturnValue([{ url: () => `chrome-extension://${"a".repeat(32)}/background.js` }]) }
  const browser = { contexts: () => [context], close: vi.fn() }
  browserMocks.connectOverCDP.mockResolvedValue(browser)
  vi.resetModules()
  const api = await import("../e2e/fixtures/extension")
  return { api, browser, context, helper }
}

describe("attached Chrome target safety", () => {
  it("ignores an unrelated first background worker and refuses live storage clearing", async () => {
    const { api, context, helper } = await connectedTarget()
    const selected = await api.connectToChrome()
    expect(selected.extensionId).toBe("b".repeat(32))
    expect(context.serviceWorkers).not.toHaveBeenCalled()
    expect(helper.goto).toHaveBeenCalledWith(`chrome-extension://${"b".repeat(32)}/manifest.json`)
    await expect(api.clearStorage(selected.context)).rejects.toThrow(/Refusing to clear storage/)
    expect(context.newPage).toHaveBeenCalledTimes(1)
  })
  it.each([["a".repeat(32), "2.3.6.20"], ["b".repeat(32), "0.0.1"]])("disconnects on runtime ID or version mismatch", async (id, version) => {
    const { api, browser, helper } = await connectedTarget(id, version)
    await expect(api.connectToChrome()).rejects.toThrow(/identity differs/)
    expect(browser.close).toHaveBeenCalledOnce()
    expect(helper.close).toHaveBeenCalledOnce()
  })
  it("does not connect at all without an explicit target", async () => {
    const { api } = await connectedTarget()
    vi.stubEnv("PHOTOSWEEP_E2E_EXTENSION_ID", "")
    await expect(api.connectToChrome()).rejects.toThrow(/PHOTOSWEEP_E2E_EXTENSION_ID/)
    expect(browserMocks.connectOverCDP).not.toHaveBeenCalled()
  })
  it("refuses an existing review/checkpoint without clearing it", async () => {
    const { api, helper } = await connectedTarget()
    const { context } = await api.connectToChrome()
    helper.evaluate.mockResolvedValue(true)
    await expect(api.assertEmptyLiveReviewState(context)).rejects.toThrow(/no storage was cleared/)
    expect(helper.close).toHaveBeenCalledTimes(2)
  })
  it("closes its helper tab and disconnects when target navigation fails", async () => {
    const { api, helper, browser } = await connectedTarget()
    helper.goto.mockRejectedValue(new Error("Navigation failed"))
    helper.close.mockResolvedValue(undefined)
    await expect(api.connectToChrome()).rejects.toThrow(/Navigation failed/)
    expect(helper.close).toHaveBeenCalledOnce()
    expect(browser.close).toHaveBeenCalledOnce()
  })
})
