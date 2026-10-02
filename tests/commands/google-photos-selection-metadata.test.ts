/**
 * Exercises the active Google scan parser and adapter together. The raw
 * batchexecute tuples are synthetic; no provider account or network is used.
 * @vitest-environment happy-dom
 */
import { beforeAll, describe, expect, it, vi } from "vitest"

import { recommendDefaultKeepForGroup } from "../../lib/keep-strategy"

declare global {
  var unsafeWindow: Window &
    typeof globalThis & {
      WIZ_global_data: Record<string, unknown>
    }

  interface Window {
    happyDOM: {
      setURL(url: string): void
    }
    WIZ_global_data: {
      oPEP7c: string
      [key: string]: unknown
    }
  }
}

const testAccount = "google-parser-fixture@example.invalid"
const scanScopeFingerprint = "google-parser-quality-fixture"
const requestId = "google-parser-quality-scan"
let gptkApi: any
let gptkApiUtils: any
let commandHost: any

function libraryRow(
  mediaKey: string,
  dedupKey: string,
  width: number,
  height: number
) {
  const row: any[] = []
  row[0] = mediaKey
  row[1] = [`https://thumb.invalid/${mediaKey}`, width, height]
  row[2] = 1_700_000_000_000
  row[3] = dedupKey
  row[4] = 0
  row[5] = 1_700_000_100_000
  row[7] = []
  return row
}

function batchInfoRow(
  mediaKey: string,
  size: number,
  qualityCode?: number
) {
  const properties: any[] = []
  properties[2] = ""
  properties[3] = `${mediaKey}.jpg`
  properties[6] = 1_700_000_000_000
  properties[7] = 0
  properties[8] = 1_700_000_100_000
  properties[9] = size
  properties[30] =
    qualityCode === undefined ? [1, size] : [1, size, qualityCode]
  return [mediaKey, properties]
}

function captureMessages() {
  const messages: any[] = []
  const spy = vi.spyOn(window, "postMessage").mockImplementation((message) => {
    messages.push(message)
  })
  return { messages, restore: () => spy.mockRestore() }
}

async function waitForResult(messages: any[], targetRequestId = requestId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = messages.find(
      (message) =>
        message?.action === "gptkResult" && message.requestId === targetRequestId
    )
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error("Timed out waiting for parsed Google scan output")
}

beforeAll(async () => {
  window.happyDOM.setURL("http://localhost/")
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn()
  })
  ;(window as any).WIZ_global_data = {
    Dbw5Ud: "rapt-fixture",
    oPEP7c: testAccount,
    FdrFJe: "sid-fixture",
    cfb2h: "bl-fixture",
    eptZe: "/",
    SNlM0e: "at-fixture"
  }
  ;(globalThis as any).unsafeWindow = window
  ;(globalThis as any).GM_registerMenuCommand = vi.fn()

  // Import the real GPTK script so getItemsByUploadedDate and
  // getBatchMediaInfo run their production tuple parsers.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await import("../../scripts/google-photos-toolkit.user.js")
  gptkApi = (window as any).gptkApi
  gptkApiUtils = (window as any).gptkApiUtils

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await import("../../scripts/photo-provider-command-host.js")
  commandHost = (window as any).__GPD_COMMAND_HOST__
  await commandHost.setProviderIdentity(testAccount)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await import("../../scripts/google-photos-commands.js")
})

describe("Google completed-scan quality metadata", () => {
  it("parses active EzkLib and batch metadata before recommending a keeper", async () => {
    const items = [
      libraryRow("quality-original", "quality-original-dedup", 1_000, 1_000),
      libraryRow("quality-code-1-large", "quality-code-1-large-dedup", 4_000, 3_000),
      libraryRow("quality-code-99-largest", "quality-code-99-largest-dedup", 5_000, 4_000),
      libraryRow("quality-absent", "quality-absent-dedup", 6_000, 5_000),
      libraryRow("quality-duplicate", "quality-duplicate-dedup", 1_280, 720),
      libraryRow("quality-missing", "quality-missing-dedup", 1_280, 720),
      libraryRow("size-smaller", "size-smaller-dedup", 1_920, 1_080),
      libraryRow("size-larger", "size-larger-dedup", 1_920, 1_080)
    ]
    // Deliberately reorder the raw batch response, omit one requested item,
    // include an unrelated key, and duplicate one key. Only unique exact-key
    // matches may add metadata.
    const batchRows = [
      batchInfoRow("quality-code-99-largest", 999_999, 99),
      batchInfoRow("unrequested-extra", 9_999_999, 2),
      batchInfoRow("size-larger", 250_000, 2),
      batchInfoRow("quality-duplicate", 77_777, 2),
      batchInfoRow("quality-original", 1_000, 2),
      batchInfoRow("quality-absent", 888_888),
      batchInfoRow("quality-duplicate", 88_888, 2),
      batchInfoRow("quality-code-1-large", 99_999, 1),
      batchInfoRow("size-smaller", 100_000, 2),
    ]
    const previousInfoSize = gptkApiUtils.infoSize
    gptkApiUtils.infoSize = 2
    const listRequest = vi.spyOn(gptkApi, "makeApiRequest").mockImplementation(
      async (rpcId: string) => {
        if (rpcId === "EzkLib") return [items, null]
        throw new Error(`Unexpected GPTK request: ${rpcId}`)
      }
    )
    const infoRequest = vi
      .spyOn(gptkApiUtils.api, "makeApiRequest")
      .mockImplementation(async (rpcId: string, requestData: any) => {
        if (rpcId === "EWgK9e") {
          const requestedKeys = requestData[0][0][0].map(
            ([mediaKey]: [string]) => mediaKey
          )
          return [
            [
              null,
              batchRows.filter((row) => requestedKeys.includes(row[0]))
            ]
          ]
        }
        throw new Error(`Unexpected GPTK metadata request: ${rpcId}`)
      })
    const { messages, restore } = captureMessages()

    try {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: {
            app: "GPD",
            action: "gptkCommand",
            command: "getAllMediaItems",
            requestId,
            args: { scanScopeFingerprint }
          }
        })
      )
      const result = await waitForResult(messages)
      expect(result.scanCoverage).toMatchObject({ status: "complete" })
      expect(listRequest).toHaveBeenCalledWith("EzkLib", expect.any(Array))
      expect(infoRequest).toHaveBeenCalledTimes(Math.ceil(items.length / 2))
      expect(
        infoRequest.mock.calls.map(
          ([, requestData]) => requestData[0][0][0].length
        )
      ).toEqual([2, 2, 2, 2])

      const mediaItems = Object.fromEntries(
        result.data.map((item: any) => [item.mediaKey, item])
      )
      expect(mediaItems["quality-original"]).toMatchObject({
        isOriginalQuality: true,
        resWidth: 1_000,
        resHeight: 1_000,
        size: 1_000,
        timestampProvenance: "unknown",
        creationTimestampProvenance: "unknown"
      })
      expect(mediaItems["quality-code-1-large"]).toMatchObject({
        isOriginalQuality: null,
        resWidth: 4_000,
        resHeight: 3_000,
        size: 99_999
      })
      expect(mediaItems["quality-code-99-largest"].isOriginalQuality).toBeNull()
      expect(mediaItems["quality-absent"].isOriginalQuality).toBeNull()
      expect(mediaItems["quality-duplicate"]).toMatchObject({
        isOriginalQuality: null,
        size: undefined
      })
      expect(mediaItems["quality-missing"]).toMatchObject({
        isOriginalQuality: null,
        size: undefined
      })
      expect(mediaItems["unrequested-extra"]).toBeUndefined()
      expect(mediaItems["size-larger"].size).toBe(250_000)

      expect(
        recommendDefaultKeepForGroup(
          {
            mediaKeys: [
              "quality-original",
              "quality-code-1-large",
              "quality-code-99-largest",
              "quality-absent"
            ]
          },
          mediaItems,
          "best_quality"
        ).keptMediaKeys
      ).toEqual(["quality-original"])
      expect(
        recommendDefaultKeepForGroup(
          { mediaKeys: ["size-smaller", "size-larger"] },
          mediaItems,
          "best_quality"
        ).keptMediaKeys
      ).toEqual(["size-larger"])
    } finally {
      restore()
      listRequest.mockRestore()
      infoRequest.mockRestore()
      gptkApiUtils.infoSize = previousInfoSize
    }
  })

  it("keeps a complete scan usable when the supplemental metadata call fails", async () => {
    const failedMetadataRequestId = `${requestId}-metadata-error`
    const listRequest = vi.spyOn(gptkApi, "makeApiRequest").mockImplementation(
      async (rpcId: string) => {
        if (rpcId === "EzkLib") {
          return [[libraryRow("metadata-error", "metadata-error-dedup", 800, 600)], null]
        }
        throw new Error(`Unexpected GPTK request: ${rpcId}`)
      }
    )
    const infoRequest = vi
      .spyOn(gptkApiUtils.api, "makeApiRequest")
      .mockRejectedValue(new Error("Supplemental metadata unavailable"))
    const { messages, restore } = captureMessages()

    try {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: {
            app: "GPD",
            action: "gptkCommand",
            command: "getAllMediaItems",
            requestId: failedMetadataRequestId,
            args: { scanScopeFingerprint }
          }
        })
      )
      const result = await waitForResult(messages, failedMetadataRequestId)
      expect(result.scanCoverage).toMatchObject({ status: "complete" })
      expect(result.data[0]).toMatchObject({
        mediaKey: "metadata-error",
        isOriginalQuality: null,
        resWidth: 800,
        resHeight: 600,
        timestampProvenance: "unknown",
        creationTimestampProvenance: "unknown"
      })
      expect(result.data[0].size).toBeUndefined()
      expect(infoRequest).toHaveBeenCalledWith("EWgK9e", expect.any(Array))
    } finally {
      restore()
      listRequest.mockRestore()
      infoRequest.mockRestore()
    }
  })

  it("rejects results if the provider account changes during failed enrichment", async () => {
    const changedAccountRequestId = `${requestId}-account-change`
    const originalAccount = window.WIZ_global_data.oPEP7c
    const listRequest = vi.spyOn(gptkApi, "makeApiRequest").mockImplementation(
      async (rpcId: string) => {
        if (rpcId === "EzkLib") {
          return [[libraryRow("account-change", "account-change-dedup", 800, 600)], null]
        }
        throw new Error(`Unexpected GPTK request: ${rpcId}`)
      }
    )
    const infoRequest = vi
      .spyOn(gptkApiUtils.api, "makeApiRequest")
      .mockImplementation(async () => {
        window.WIZ_global_data.oPEP7c = "different-account@example.invalid"
        throw new Error("Supplemental metadata unavailable")
      })
    const { messages, restore } = captureMessages()

    try {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: {
            app: "GPD",
            action: "gptkCommand",
            command: "getAllMediaItems",
            requestId: changedAccountRequestId,
            args: { scanScopeFingerprint }
          }
        })
      )
      const result = await waitForResult(messages, changedAccountRequestId)
      expect(result.scanCoverage?.status).not.toBe("complete")
      expect(result.error).toContain("account changed during the scan")
      expect(infoRequest).toHaveBeenCalledWith("EWgK9e", expect.any(Array))
    } finally {
      window.WIZ_global_data.oPEP7c = originalAccount
      restore()
      listRequest.mockRestore()
      infoRequest.mockRestore()
    }
  })
})
