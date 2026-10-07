/**
 * Tests for scripts/google-photos-commands.js
 *
 * The commands script runs in a MAIN world context — it registers a
 * window "message" listener on import and uses window.postMessage to
 * communicate results back to the bridge. Tests drive it by dispatching
 * MessageEvents and inspecting postMessage calls.
 *
 * @vitest-environment happy-dom
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest"
import {
  providerParityFixtureTimestamp,
  providerParityMixedMediaDatesV3
} from "../fixtures/provider-parity-mixed-media-dates-v3"
import gptkBatchMediaInfoFixture from "../../Google-Photos-Toolkit/tests/fixtures/parser/EWgK9e.json"

const realSetTimeout = globalThis.setTimeout.bind(globalThis)

// ============================================================
// Globals the script expects at runtime
// ============================================================

const mockMoveItemsToTrash = vi.fn()
const mockRestoreFromTrash = vi.fn()
const mockGetTrashItems = vi.fn()
const mockGetItemInfo = vi.fn()
const googleLibraryKeys = new Set<string>()
const googleTrashKeys = new Set<string>()
const googleTestEmail = "test@example.com"
let googleTestSessionId = ""

const mockApi = {
  moveItemsToTrash: mockMoveItemsToTrash,
  restoreFromTrash: mockRestoreFromTrash,
  getTrashItems: mockGetTrashItems,
  getItemInfo: mockGetItemInfo
}

// Set up window globals BEFORE importing the module so the script
// sees them when it first executes.
Object.defineProperty(window, "gptkApiUtils", {
  value: { api: mockApi },
  writable: true,
  configurable: true
})

// ============================================================
// Import the commands script (registers listener on window)
// ============================================================

beforeAll(async () => {
  // google-photos-commands.js is a side-effect-only MAIN world script (no exports).
  // We import it here purely to register its window "message" listener.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await import("../../scripts/photo-provider-command-host.js")
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await import("../../scripts/google-photos-commands.js")
})

// ============================================================
// Helpers
// ============================================================

/** Dispatch a gptkCommand message the same way the bridge does. */
function sendCommand(
  command: string,
  requestId: string,
  args: unknown,
  seedMutationState = true
) {
  let commandArgs = args
  if (command === "trashItems" || command === "restoreItems") {
    const sourceArgs =
      args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {}
    const dedupKeys = Array.isArray(sourceArgs.dedupKeys)
      ? sourceArgs.dedupKeys.filter(
          (key): key is string => typeof key === "string" && key.length > 0
        )
      : []
    if (!seedMutationState) {
      // Some mutation tests need to exercise a provider pre-state such as an
      // already-restored item without the helper manufacturing that state.
    } else if (command === "trashItems") {
      for (const key of dedupKeys) googleLibraryKeys.add(key)
    } else {
      for (const key of dedupKeys) {
        googleLibraryKeys.delete(key)
        googleTrashKeys.add(key)
      }
    }
    commandArgs = {
      ...sourceArgs,
      accountEmail: sourceArgs.accountEmail || googleTestEmail,
      providerSessionId: sourceArgs.providerSessionId || googleTestSessionId
    }
  } else if (command === "listAlbums") {
    const sourceArgs =
      args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {}
    commandArgs = {
      ...sourceArgs,
      accountEmail: sourceArgs.accountEmail ?? googleTestEmail,
      providerSessionId: sourceArgs.providerSessionId ?? googleTestSessionId
    }
  } else if (command === "getAllMediaItems") {
    const sourceArgs =
      args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {}
    commandArgs = {
      ...sourceArgs,
      scanScopeFingerprint:
        sourceArgs.scanScopeFingerprint || "google-command-test-scope"
    }
  } else if (
    command === "getOriginalContentHash" ||
    command === "getVideoPlaybackUrl"
  ) {
    const sourceArgs =
      args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {}
    commandArgs = {
      ...sourceArgs,
      requestId: sourceArgs.requestId || requestId,
      providerSessionId: sourceArgs.providerSessionId || googleTestSessionId,
      scanScopeFingerprint:
        sourceArgs.scanScopeFingerprint || "google-command-test-scope",
      ...(command === "getOriginalContentHash" &&
      !Object.prototype.hasOwnProperty.call(sourceArgs, "aggregateBudgetBytes")
        ? { aggregateBudgetBytes: 100 * 1024 * 1024 }
        : {})
    }
  }
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command,
        requestId,
        args: commandArgs
      }
    })
  )
}

function googleRawAlbum(
  mediaKey: string,
  title: string,
  isShared?: boolean,
  itemCount?: number
) {
  const albumProperties: any[] = []
  albumProperties[1] = title
  if (itemCount !== undefined) albumProperties[3] = itemCount
  if (typeof isShared === "boolean") albumProperties[4] = isShared
  const metadata: Record<string, any> = {}
  metadata[72930366] = albumProperties
  return [mediaKey, [`https://thumb/${mediaKey}`], null, null, null, null, null, metadata]
}

function yieldOneRealEventLoopTurn() {
  return new Promise<void>((resolve) => realSetTimeout(resolve, 0))
}

/** Collect window.postMessage calls during an async operation. */
function collectMessages(): {
  messages: unknown[]
  setPostMessageHandler: (handler: ((message: any) => void) | undefined) => void
  restore: () => void
} {
  const messages: unknown[] = []
  let postMessageHandler: ((message: any) => void) | undefined
  const spy = vi.spyOn(window, "postMessage").mockImplementation((msg) => {
    messages.push(msg)
    postMessageHandler?.(msg)
  })
  return {
    messages,
    setPostMessageHandler: (handler) => { postMessageHandler = handler },
    restore: () => spy.mockRestore()
  }
}

async function waitForMessage(messages: unknown[], requestId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const message = messages.find(
      (candidate: any) =>
        candidate?.action === "gptkResult" &&
        candidate?.requestId === requestId
    )
    if (message) return message as any
    await new Promise((resolve) => realSetTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for provider test response ${requestId}`)
}

async function waitForCondition(
  condition: () => boolean,
  description: string
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => realSetTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function waitForMessageWithFakeTimers(
  messages: unknown[],
  requestId: string
) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const message = messages.find(
      (candidate: any) =>
        candidate?.action === "gptkResult" &&
        candidate?.requestId === requestId
    )
    if (message) return message as any
    await new Promise((resolve) => realSetTimeout(resolve, 10))
    await vi.advanceTimersByTimeAsync(1000)
  }
  throw new Error(`Timed out waiting for provider test response ${requestId}`)
}

async function waitForPostedAction(
  messages: unknown[],
  action: string,
  requestId: string
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const message = messages.find(
      (candidate: any) =>
        candidate?.action === action && candidate?.requestId === requestId
    )
    if (message) return message as any
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${action} (${requestId})`)
}

function dispatchOriginalHashRelayResult(
  request: any,
  overrides: Record<string, unknown> = {}
) {
  const mediaKind = request.mediaKind === "video" ? "video" : "photo"
  const contentRole =
    request.mediaKind === "live-photo" ? "live-photo-still" : "single-file"
  const defaultData = {
    mediaKey: request.mediaKey,
    scopeFingerprint: request.scanScopeFingerprint,
    contentHash: {
      value: "a".repeat(64),
      algorithm: "sha256",
      provenance: "original-content",
      verificationSource: "local-original-bytes",
      contentRole
    },
    byteLength: Math.min(1, request.maxBytes),
    mimeType: mediaKind === "video" ? "video/mp4" : "image/jpeg"
  }
  const result = {
    app: "GPD",
    action: "providerOriginalHash.result",
    requestId: request.requestId,
    providerSessionId: request.providerSessionId,
    scanScopeFingerprint: request.scanScopeFingerprint,
    mediaKey: request.mediaKey,
    success: true,
    data: { ...defaultData, ...overrides }
  }
  window.dispatchEvent(
    new MessageEvent("message", { source: window, data: result })
  )
}

// ============================================================
// Reset between tests
// ============================================================

beforeEach(async () => {
  mockMoveItemsToTrash.mockReset()
  mockRestoreFromTrash.mockReset()
  mockGetTrashItems.mockReset()
  mockGetItemInfo.mockReset()
  googleLibraryKeys.clear()
  googleTrashKeys.clear()
  mockMoveItemsToTrash.mockImplementation(async (keys: string[]) => {
    for (const key of keys) {
      googleLibraryKeys.delete(key)
      googleTrashKeys.add(key)
    }
    return undefined
  })
  mockRestoreFromTrash.mockImplementation(async (keys: string[]) => {
    for (const key of keys) {
      googleTrashKeys.delete(key)
      googleLibraryKeys.add(key)
    }
    return undefined
  })
  mockGetTrashItems.mockImplementation(async () => ({
    items: [...googleTrashKeys].map((dedupKey) => ({ dedupKey })),
    nextPageId: null
  }))
  mockGetItemInfo.mockImplementation(async (mediaKey: string) => ({
    mediaKey,
    isFavorite: false
  }))
  ;(window as any).WIZ_global_data = { oPEP7c: googleTestEmail }
  googleTestSessionId = await (window as any).__GPD_COMMAND_HOST__.setProviderIdentity(
    googleTestEmail
  )
  ;(window as any).gptkApiUtils = { api: mockApi }
  ;(window as any).gptkApi = {
    getItemsByUploadedDate: vi.fn(async () => ({
      items: [...googleLibraryKeys].map((dedupKey) => ({ dedupKey })),
      nextPageId: null
    }))
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ============================================================
// Unit tests: getAllMediaItems
// ============================================================

describe("Google provider health", () => {
  it("requires the Photos origin, a bound account, and a callable read path", async () => {
    const originalUrl = window.location.href
    const originalWizData = (window as any).WIZ_global_data
    const originalGptkApi = (window as any).gptkApi
    const { messages, restore } = collectMessages()
    try {
      ;(window as any).happyDOM.setURL("https://photos.google.com/")
      ;(window as any).WIZ_global_data = { oPEP7c: googleTestEmail }
      ;(window as any).gptkApi = {
        getItemsByUploadedDate: vi.fn()
      }
      sendCommand("healthCheck", "google-health-ready", {})
      expect(await waitForMessage(messages, "google-health-ready")).toMatchObject({
        data: {
          health: {
            status: "ready",
            provider: "google",
            checks: { page: true, session: true, readPath: true }
          }
        }
      })

      ;(window as any).happyDOM.setURL("https://example.com/")
      ;(window as any).gptkApi = {}
      sendCommand("healthCheck", "google-health-wrong-page", {})
      expect(
        await waitForMessage(messages, "google-health-wrong-page")
      ).toMatchObject({
        data: {
          health: {
            status: "unavailable",
            checks: { page: false, session: true, readPath: false }
          }
        }
      })

      ;(window as any).happyDOM.setURL("https://photos.google.com/")
      ;(window as any).WIZ_global_data = {}
      ;(window as any).gptkApi = {
        getItemsByUploadedDate: vi.fn()
      }
      sendCommand("healthCheck", "google-health-no-account", {})
      expect(
        await waitForMessage(messages, "google-health-no-account")
      ).toMatchObject({
        data: {
          accountEmail: "",
          health: {
            status: "unavailable",
            checks: { page: true, session: false, readPath: true }
          }
        }
      })
    } finally {
      restore()
      ;(window as any).happyDOM.setURL(originalUrl)
      ;(window as any).WIZ_global_data = originalWizData
      ;(window as any).gptkApi = originalGptkApi
    }
  })
})

describe("getAllMediaItems — field mapping", () => {
  function setupGptkApi(items: unknown[], nextPageId: string | null = null) {
    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi.fn().mockResolvedValue({ items, nextPageId })
    }
  }

  function setupGptkAlbumApi(items: unknown[]) {
    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi.fn()
    }
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getAlbums: vi
          .fn()
          .mockResolvedValue([
            [googleRawAlbum("album-key", "Tiny test album", false)],
            null
          ])
      },
      getAllMediaInAlbum: vi.fn().mockResolvedValue(items)
    }
  }

  afterEach(() => {
    delete (window as any).gptkApi
  })

  it("declares original-byte verification only for supported Google media kinds", async () => {
    setupGptkApi([
      {
        mediaKey: "google-hash-photo",
        dedupKey: "google-hash-photo",
        thumb: "https://thumb/google-hash-photo",
        mimeType: "image/jpeg",
        isVideo: false
      },
      {
        mediaKey: "google-hash-unknown",
        dedupKey: "google-hash-unknown",
        thumb: "https://thumb/google-hash-unknown"
      }
    ])
    const { messages, restore } = collectMessages()

    sendCommand("getAllMediaItems", "google-hash-capability", {})
    await waitForMessage(messages, "google-hash-capability")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-hash-capability"
    ) as any
    expect(result?.data).toMatchObject([
      {
        mediaKey: "google-hash-photo",
        originalContentVerificationCapability: "available"
      },
      {
        mediaKey: "google-hash-unknown",
        originalContentVerificationCapability: "unavailable"
      }
    ])
    restore()
  })

  it("reports coverage when GPTK is unavailable", async () => {
    delete (window as any).gptkApi
    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-missing-gptk", {})
    await waitForMessage(messages, "req-missing-gptk")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems"
    ) as any
    expect(result?.success).toBe(false)
    expect(result?.scanCoverage).toEqual({
      status: "failed",
      stopReason: "provider_error",
      itemsVisited: 0,
      itemsReturned: 0,
      itemsSkipped: 0,
      unknownDateItemsSkipped: 0,
      mediaTypesCovered: { photos: true, videos: true },
      canResume: false
    })
    restore()
  })

  it("does not treat a malformed Google page as an exhausted empty library", async () => {
    const { messages, restore } = collectMessages()
    const getPage = vi.fn().mockResolvedValue({})
    ;(window as any).gptkApi = { getItemsByUploadedDate: getPage }

    sendCommand("getAllMediaItems", "google-malformed-library-page", {})
    await waitForMessage(messages, "google-malformed-library-page")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-malformed-library-page"
    ) as any
    expect(result).toMatchObject({
      success: true,
      data: [],
      scanCoverage: {
        status: "partial",
        stopReason: "coverage_unknown",
        itemsVisited: 0,
        itemsReturned: 0,
        itemsSkipped: 0
      }
    })
    expect(getPage).toHaveBeenCalledTimes(1)
    restore()
  })

  it("marks rows without stable media and trash identities as unmapped instead of complete", async () => {
    setupGptkApi([
      {
        mediaKey: "known-google-row",
        dedupKey: "known-google-row-dedup",
        thumb: "https://thumb/known-google-row",
        timestamp: 1000,
        creationTimestamp: 2000
      },
      {
        mediaKey: "missing-dedup-key",
        thumb: "https://thumb/missing-dedup-key",
        timestamp: 1001,
        creationTimestamp: 2001
      }
    ])
    const { messages, restore } = collectMessages()

    sendCommand("getAllMediaItems", "google-unmapped-library-row", {})
    await waitForMessage(messages, "google-unmapped-library-row")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-unmapped-library-row"
    ) as any
    expect(result).toMatchObject({
      success: true,
      data: [{ mediaKey: "known-google-row" }],
      scanCoverage: {
        status: "partial",
        stopReason: "coverage_unknown",
        itemsVisited: 2,
        itemsReturned: 1,
        itemsSkipped: 1,
        unmappedItemsSkipped: 1
      }
    })
    restore()
  })

  it("does not use a timestamp watermark as a Google library change feed", async () => {
    const item = (mediaKey: string, creationTimestamp: number) => ({
      mediaKey,
      dedupKey: `${mediaKey}-dedup`,
      thumb: `https://thumb/${mediaKey}`,
      timestamp: creationTimestamp,
      creationTimestamp
    })
    const getPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [item("google-recent-addition", 3000)],
        nextPageId: "older"
      })
      .mockResolvedValueOnce({
        items: [item("google-older-existing-item", 1000)],
        nextPageId: null
      })
    ;(window as any).gptkApi = { getItemsByUploadedDate: getPage }
    const { messages, restore } = collectMessages()

    sendCommand("getAllMediaItems", "google-full-refresh-not-delta", {
      sinceTimestamp: 2000
    })
    await waitForMessage(messages, "google-full-refresh-not-delta")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-full-refresh-not-delta"
    ) as any
    expect(getPage).toHaveBeenCalledTimes(2)
    expect(result?.data.map((media: any) => media.mediaKey)).toEqual([
      "google-recent-addition",
      "google-older-existing-item"
    ])
    expect(result?.scanCoverage).toMatchObject({
      status: "complete",
      stopReason: "exhausted",
      itemsVisited: 2,
      itemsReturned: 2
    })
    expect(result?.scanCoverage.stopReason).not.toBe("watermark_reached")
    expect(messages).toContainEqual(
      expect.objectContaining({
        action: "gptkProgress",
        requestId: "google-full-refresh-not-delta",
        itemsProcessed: 0,
        message: expect.stringMatching(/timestamp watermark cannot report edits or deletions/i)
      })
    )
    restore()
  })

  it("rejects an empty nonterminal Google page as incomplete pagination", async () => {
    const { messages, restore } = collectMessages()
    const getPage = vi.fn().mockResolvedValue({ items: [], nextPageId: "next" })
    ;(window as any).gptkApi = { getItemsByUploadedDate: getPage }

    sendCommand("getAllMediaItems", "google-empty-nonterminal-page", {})
    await waitForMessage(messages, "google-empty-nonterminal-page")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-empty-nonterminal-page"
    ) as any
    expect(getPage).toHaveBeenCalledTimes(1)
    expect(result?.scanCoverage).toMatchObject({
      status: "partial",
      stopReason: "pagination_error",
      itemsVisited: 0,
      itemsReturned: 0,
      itemsSkipped: 0
    })
    restore()
  })

  it("[PARITY-03] reports coverage when the album media API is unavailable", async () => {
    ;(window as any).gptkApi = { getItemsByUploadedDate: vi.fn() }
    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-missing-album-api", {
      albumScope: { mediaKey: "album-1", title: "Album 1" }
    })
    await waitForMessage(messages, "req-missing-album-api")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems"
    ) as any
    expect(result?.success).toBe(false)
    expect(result?.scanCoverage).toMatchObject({
      status: "failed",
      stopReason: "provider_error",
      itemsVisited: 0,
      itemsReturned: 0,
      itemsSkipped: 0
    })
    restore()
  })

  it("[PARITY-03] fails closed when the guarded album helper returns a repeated media ID", async () => {
    const repeated = {
      mediaKey: "fallback-repeated-media",
      dedupKey: "fallback-repeated-media",
      thumb: "https://thumb/fallback-repeated-media",
      timestamp: Date.parse("2024-06-15T12:00:00.000Z")
    }
    setupGptkAlbumApi([
      repeated,
      repeated,
      {
        mediaKey: "fallback-new-media",
        dedupKey: "fallback-new-media",
        thumb: "https://thumb/fallback-new-media",
        timestamp: Date.parse("2024-06-15T12:01:00.000Z")
      }
    ])

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-fallback-duplicate-id", {
      albumScope: { mediaKey: "album-key", title: "Fallback album" }
    })
    await waitForMessage(messages, "req-fallback-duplicate-id")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "req-fallback-duplicate-id"
    ) as any
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/repeated album media/i),
      scanCoverage: {
        status: "failed",
        stopReason: "pagination_error",
        itemsVisited: 1,
        itemsReturned: 1,
        itemsSkipped: 0
      }
    })
    expect(result.scanCoverage.itemsVisited).toBe(
      result.scanCoverage.itemsReturned + result.scanCoverage.itemsSkipped
    )
    restore()
  })

  it("[PARITY-03] detects guarded album overlap before applying a date filter", async () => {
    const repeated = {
      mediaKey: "fallback-out-of-range-repeat",
      dedupKey: "fallback-out-of-range-repeat",
      thumb: "https://thumb/fallback-out-of-range-repeat",
      timestamp: Date.parse("2023-06-15T12:00:00.000Z")
    }
    setupGptkAlbumApi([repeated, repeated])

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-fallback-date-duplicate", {
      albumScope: { mediaKey: "album-key", title: "Fallback album" },
      dateRange: { from: "2024-06-15", to: "2024-06-15" }
    })
    await waitForMessage(messages, "req-fallback-date-duplicate")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "req-fallback-date-duplicate"
    ) as any
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/repeated album media/i),
      scanCoverage: {
        status: "failed",
        stopReason: "pagination_error",
        itemsVisited: 1,
        itemsReturned: 0,
        itemsSkipped: 1
      }
    })
    expect(result.scanCoverage.itemsVisited).toBe(
      result.scanCoverage.itemsReturned + result.scanCoverage.itemsSkipped
    )
    restore()
  })

  it("[PARITY-03] counts a repeated dedup-key collision only once in album coverage", async () => {
    const itemA = {
      mediaKey: "album-media-A",
      dedupKey: "album-shared-dedup-X",
      thumb: "https://thumb/album-media-A",
      timestamp: Date.parse("2024-06-15T12:00:00.000Z")
    }
    const itemB = {
      mediaKey: "album-media-B",
      dedupKey: "album-shared-dedup-X",
      thumb: "https://thumb/album-media-B",
      timestamp: Date.parse("2024-06-15T12:01:00.000Z")
    }
    setupGptkAlbumApi([])
    ;(window as any).gptkApiUtils.api.getAlbumPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [itemA, itemB], nextPageId: "next" })
      .mockResolvedValueOnce({ items: [itemB], nextPageId: null })

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "google-album-repeated-dedup-key", {
      albumScope: { mediaKey: "album-key", title: "Fallback album" }
    })
    await waitForMessage(messages, "google-album-repeated-dedup-key")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-album-repeated-dedup-key"
    ) as any
    expect(result?.data).toBeUndefined()
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/repeated album media/i),
      scanCoverage: {
        status: "failed",
        stopReason: "pagination_error",
        itemsVisited: 2,
        itemsReturned: 1,
        itemsSkipped: 1,
        unmappedItemsSkipped: 1
      }
    })
    expect(result.scanCoverage.itemsVisited).toBe(
      result.scanCoverage.itemsReturned + result.scanCoverage.itemsSkipped
    )
    restore()
  })

  it("[PARITY-03] counts a repeated identifiable malformed album row only once", async () => {
    const malformed = {
      mediaKey: "album-malformed-media",
      timestamp: Date.parse("2024-06-15T12:00:00.000Z")
    }
    setupGptkAlbumApi([])
    ;(window as any).gptkApiUtils.api.getAlbumPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [malformed], nextPageId: "next" })
      .mockResolvedValueOnce({ items: [malformed], nextPageId: null })

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "google-album-repeated-malformed", {
      albumScope: { mediaKey: "album-key", title: "Fallback album" }
    })
    await waitForMessage(messages, "google-album-repeated-malformed")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-album-repeated-malformed"
    ) as any
    expect(result?.data).toBeUndefined()
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/repeated album media/i),
      scanCoverage: {
        status: "failed",
        stopReason: "pagination_error",
        itemsVisited: 1,
        itemsReturned: 0,
        itemsSkipped: 1,
        unmappedItemsSkipped: 1
      }
    })
    expect(result.scanCoverage.itemsVisited).toBe(
      result.scanCoverage.itemsReturned + result.scanCoverage.itemsSkipped
    )
    restore()
  })

  it("[PARITY-03] rejects shared album scopes before fetching media", async () => {
    setupGptkAlbumApi([])
    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-shared-album", {
      albumScope: {
        mediaKey: "shared-album",
        title: "Shared album",
        isShared: true
      }
    })
    await waitForMessage(messages, "req-shared-album")

    expect(
      (window as any).gptkApiUtils.getAllMediaInAlbum
    ).not.toHaveBeenCalled()
    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "req-shared-album"
    ) as any
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/shared Google Photos albums are not supported/i),
      scanCoverage: {
        status: "failed",
        stopReason: "unsupported_scope",
        itemsVisited: 0,
        itemsReturned: 0,
        itemsSkipped: 0
      }
    })
    restore()
  })

  it("[PARITY-03] revalidates a direct album scope against the current personal album list", async () => {
    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi.fn().mockResolvedValue({ items: [], nextPageId: null })
    }
    const getAllMediaInAlbum = vi.fn().mockResolvedValue([])
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getAlbums: vi.fn().mockResolvedValue([
          [googleRawAlbum("shared-album", "Now shared", true)],
          null
        ])
      },
      getAllMediaInAlbum
    }

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-direct-shared-album", {
      albumScope: {
        mediaKey: "shared-album",
        title: "Old personal label"
        // A stale caller must not be able to omit or falsify isShared.
      }
    })
    await waitForMessage(messages, "req-direct-shared-album")

    expect(getAllMediaInAlbum).not.toHaveBeenCalled()
    expect(
      (window as any).gptkApiUtils.api.getAlbums
    ).toHaveBeenCalledTimes(1)
    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "req-direct-shared-album"
    ) as any
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/personal album/i),
      scanCoverage: { status: "failed", stopReason: "unsupported_scope" }
    })
    restore()
  })

  it("classifies a Google authorization failure in the shared coverage model", async () => {
    vi.useFakeTimers()
    const error = Object.assign(new Error("HTTP 403: Forbidden"), {
      status: 403
    })
    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi.fn().mockRejectedValue(error)
    }
    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-google-auth-expired", {})
    const result = await waitForMessageWithFakeTimers(
      messages,
      "req-google-auth-expired"
    )
    expect(result).toMatchObject({
      success: false,
      scanCoverage: {
        status: "failed",
        stopReason: "auth_expired",
        itemsVisited: 0,
        itemsReturned: 0,
        itemsSkipped: 0,
        canResume: false
      }
    })
    restore()
    vi.useRealTimers()
  })

  it("cancels an in-flight Google page and reports partial coverage", async () => {
    const getItemsByUploadedDate = vi.fn(() => new Promise(() => {}))
    ;(window as any).gptkApi = { getItemsByUploadedDate }
    const { messages, restore } = collectMessages()

    sendCommand("getAllMediaItems", "req-google-cancel", {})
    await waitForCondition(
      () => getItemsByUploadedDate.mock.calls.length === 1,
      "the in-flight Google provider page"
    )
    sendCommand("cancelScan", "req-google-cancel-command", {
      targetRequestId: "req-google-cancel"
    })
    await waitForMessage(messages, "req-google-cancel-command")
    await waitForMessage(messages, "req-google-cancel")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "req-google-cancel"
    ) as any
    expect(result).toMatchObject({
      success: true,
      data: [],
      scanCoverage: {
        status: "partial",
        stopReason: "cancelled",
        itemsVisited: 0,
        itemsReturned: 0,
        itemsSkipped: 0,
        canResume: false
      }
    })
    restore()
  })

  it("remembers a cancel command that arrives before its scan command", async () => {
    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi.fn(() => new Promise(() => {}))
    }
    const { messages, restore } = collectMessages()

    sendCommand("cancelScan", "req-google-early-cancel-command", {
      targetRequestId: "req-google-early-cancel"
    })
    await waitForMessage(messages, "req-google-early-cancel-command")
    sendCommand("getAllMediaItems", "req-google-early-cancel", {})
    await waitForMessage(messages, "req-google-early-cancel")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "req-google-early-cancel"
    ) as any
    expect(result).toMatchObject({
      success: true,
      scanCoverage: {
        status: "partial",
        stopReason: "cancelled",
        itemsVisited: 0,
        itemsReturned: 0,
        itemsSkipped: 0
      }
    })
    restore()
  })

  it("passes isOriginalQuality=true through to output item", async () => {
    setupGptkApi([
      {
        mediaKey: "mk1",
        dedupKey: "dk1",
        thumb: "https://thumb/1",
        timestamp: 1000,
        creationTimestamp: 2000,
        isOriginalQuality: true
      }
    ])

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-oq-1", {})
    await waitForMessage(messages, "req-oq-1")

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "getAllMediaItems"
    ) as any
    expect(result?.success).toBe(true)
    expect(result?.data[0].isOriginalQuality).toBe(true)
    restore()
  })

  it("enriches the captured EWgK9e response and leaves unknown quality codes unknown", async () => {
    type RawBatchItem = [string, unknown[], ...unknown[]]
    const fixtureRows = gptkBatchMediaInfoFixture as unknown as RawBatchItem[]
    const originalQualityRow = fixtureRows[0]
    const unknownQualityRow = [...fixtureRows[1]] as RawBatchItem
    const unknownProviderFields = [...unknownQualityRow[1]]
    const originalQualityFields = unknownProviderFields.at(-1)
    expect(Array.isArray(originalQualityFields)).toBe(true)
    const unknownQualityFields = [...(originalQualityFields as unknown[])]
    unknownQualityFields[2] = 999
    unknownProviderFields[unknownProviderFields.length - 1] = unknownQualityFields
    unknownQualityRow[1] = unknownProviderFields

    const rawBatchResponse = [...fixtureRows]
    rawBatchResponse[1] = unknownQualityRow
    const rowsToScan = [originalQualityRow, unknownQualityRow]
    const mediaItems = rowsToScan.map((row) => ({
      mediaKey: row[0],
      dedupKey: `dedup-${row[0]}`,
      thumb: `https://thumb/${row[0]}`,
      timestamp: 1_761_753_048_000,
      creationTimestamp: 1_761_755_803_160
    }))
    setupGptkApi(mediaItems)

    const previousUnsafeWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      "unsafeWindow"
    )
    Object.defineProperty(globalThis, "unsafeWindow", {
      configurable: true,
      value: { WIZ_global_data: {} }
    })

    const { messages, restore } = collectMessages()
    try {
      // Production uses parseResponse=false so raw codes survive to enrichment;
      // the generic parser classifies every defined non-2 code as false.
      const { default: GooglePhotosApi } = await import(
        "../../Google-Photos-Toolkit/src/api/api"
      )
      const api = new GooglePhotosApi()
      const makeApiRequest = vi
        .spyOn(api, "makeApiRequest")
        .mockResolvedValue([[null, rawBatchResponse]])
      const getBatchMediaInfo = vi.spyOn(api, "getBatchMediaInfo")
      ;(window as any).gptkApiUtils = { api, infoSize: 5_000 }

      sendCommand("getAllMediaItems", "req-ewgk9e-quality", {})
      await waitForMessage(messages, "req-ewgk9e-quality")

      const result = messages.find(
        (message: any) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "req-ewgk9e-quality"
      ) as any
      expect(getBatchMediaInfo).toHaveBeenCalledWith(
        mediaItems.map((item) => item.mediaKey),
        false
      )
      expect(makeApiRequest).toHaveBeenCalledWith(
        "EWgK9e",
        expect.any(Array)
      )
      expect(result?.data.map((item: any) => item.isOriginalQuality)).toEqual([
        true,
        null
      ])
    } finally {
      restore()
      if (previousUnsafeWindow) {
        Object.defineProperty(globalThis, "unsafeWindow", previousUnsafeWindow)
      } else {
        delete (globalThis as any).unsafeWindow
      }
    }
  })

  it("passes isOriginalQuality=false (storage saver) through to output item", async () => {
    setupGptkApi([
      {
        mediaKey: "mk2",
        dedupKey: "dk2",
        thumb: "https://thumb/2",
        timestamp: 1000,
        creationTimestamp: 2000,
        isOriginalQuality: false
      }
    ])

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-oq-2", {})
    await waitForMessage(messages, "req-oq-2")

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "getAllMediaItems"
    ) as any
    expect(result?.data[0].isOriginalQuality).toBe(false)
    restore()
  })

  it("maps undefined isOriginalQuality to null", async () => {
    setupGptkApi([
      {
        mediaKey: "mk3",
        dedupKey: "dk3",
        thumb: "https://thumb/3",
        timestamp: 1000,
        creationTimestamp: 2000
        // isOriginalQuality intentionally absent
      }
    ])

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-oq-3", {})
    await waitForMessage(messages, "req-oq-3")

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "getAllMediaItems"
    ) as any
    expect(result?.data[0].isOriginalQuality).toBeNull()
    restore()
  })

  it("maps explicit Google favorite encodings and preserves millisecond video duration", async () => {
    setupGptkApi([
      {
        mediaKey: "favorite-video",
        dedupKey: "favorite-video-key",
        thumb: "https://thumb/favorite-video",
        timestamp: 1718452800000,
        creationTimestamp: 1718456400000,
        isFavorite: 1,
        isLivePhoto: false,
        mimeType: "video/mp4; codecs=h264",
        duration: 2000
      },
      {
        mediaKey: "explicit-not-favorite",
        dedupKey: "explicit-not-favorite-key",
        thumb: "https://thumb/explicit-not-favorite",
        timestamp: 1718452800000,
        creationTimestamp: 1718456400000,
        isFavorite: 0
      },
      {
        mediaKey: "unknown-favorite",
        dedupKey: "unknown-favorite-key",
        thumb: "https://thumb/unknown-favorite",
        timestamp: 1718452800000,
        creationTimestamp: 1718456400000
      }
    ])

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-google-favorite-metadata", {})
    await waitForMessage(messages, "req-google-favorite-metadata")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "req-google-favorite-metadata"
    ) as any
    expect(result?.data[0]).toMatchObject({
      isFavorite: true,
      favoriteStatus: "favorite",
      favoriteSource: "provider-metadata",
      mediaKind: "video",
      mimeType: "video/mp4",
      duration: 2000,
      timestampProvenance: "unknown",
      creationTimestampProvenance: "unknown"
    })
    expect(result?.data[1]).toMatchObject({
      isFavorite: false,
      favoriteStatus: "not-favorite",
      favoriteSource: "provider-metadata"
    })
    expect(result?.data[2]).toMatchObject({
      favoriteStatus: "unknown",
      favoriteSource: "unavailable",
      mediaKind: "unknown",
      timestampProvenance: "unknown",
      creationTimestampProvenance: "unknown"
    })
    expect(result?.data[0].timestamp).toBe(1718452800000)
    expect(result?.data[0].creationTimestamp).toBe(1718456400000)
    expect(result?.data[2]).not.toHaveProperty("isFavorite")
    restore()
  })

  it.each([true, false, null, [], [1], {}, "123", -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
    "[METADATA-PROVENANCE] keeps malformed Google measurements and boolean flags unknown (%#)",
    async (value) => {
      setupGptkApi([{
        mediaKey: "google-malformed-metadata", dedupKey: "google-malformed-metadata-key",
        thumb: "https://thumb/google-malformed-metadata", timestamp: value, creationTimestamp: value,
        resWidth: value, resHeight: value, size: value, spaceTaken: value,
        isOriginalQuality: typeof value === "boolean" ? "true" : value,
        takesUpSpace: typeof value === "boolean" ? "false" : value
      }])
      const { messages, restore } = collectMessages()
      try {
        sendCommand("getAllMediaItems", "google-malformed-metadata", {})
        const result = await waitForMessage(messages, "google-malformed-metadata") as any
        expect(result.data[0].resWidth).toBeUndefined()
        expect(result.data[0].resHeight).toBeUndefined()
        expect(result.data[0].size).toBeUndefined()
        expect(result.data[0].spaceTaken).toBeUndefined()
        expect(result.data[0].isOriginalQuality).toBeNull()
        expect(result.data[0].takesUpSpace).toBeNull()
        if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 8.64e15) {
          expect(result.data[0].timestamp).toBeUndefined()
          expect(result.data[0].creationTimestamp).toBeUndefined()
        }
      } finally { restore() }
    }
  )

  it("[MIXED-MEDIA-DATES] excludes an explicit unsupported Google MIME type and counts its visit", async () => {
    setupGptkApi([{
      mediaKey: "google-unsupported-mime", dedupKey: "google-unsupported-mime-key",
      thumb: "https://thumb/google-unsupported-mime", mimeType: "application/pdf"
    }])
    const { messages, restore } = collectMessages()
    try {
      sendCommand("getAllMediaItems", "google-unsupported-mime", {})
      const result = await waitForMessage(messages, "google-unsupported-mime") as any
      expect(result).toMatchObject({ success: true, data: [], scanCoverage: {
        status: "complete", itemsVisited: 1, itemsReturned: 0, itemsSkipped: 1, unmappedItemsSkipped: 1
      } })
    } finally { restore() }
  })

  it("passes storage accounting fields through to output item", async () => {
    setupGptkApi([
      {
        mediaKey: "mk-storage",
        dedupKey: "dk-storage",
        thumb: "https://thumb/storage",
        timestamp: 1000,
        creationTimestamp: 2000,
        takesUpSpace: false,
        spaceTaken: 0
      }
    ])

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-storage-1", {})
    await waitForMessage(messages, "req-storage-1")

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "getAllMediaItems"
    ) as any
    expect(result?.data[0]).toMatchObject({
      takesUpSpace: false,
      spaceTaken: 0
    })
    restore()
  })

  it("keeps the standard account prefix in product links", async () => {
    window.history.pushState({}, "", "/")
    setupGptkApi([
      {
        mediaKey: "mk-single",
        dedupKey: "dk-single",
        thumb: "https://thumb/single",
        timestamp: 1000,
        creationTimestamp: 2000
      }
    ])

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-url-1", {})
    await waitForMessage(messages, "req-url-1")

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "getAllMediaItems"
    ) as any
    expect(result?.data[0].productUrl).toBe(
      "https://photos.google.com/photo/mk-single"
    )
    restore()
  })

  it("keeps the secondary-account prefix in product links", async () => {
    window.history.pushState({}, "", "/u/2/search/")
    setupGptkApi([
      {
        mediaKey: "mk-multi",
        dedupKey: "dk-multi",
        thumb: "https://thumb/multi",
        timestamp: 1000,
        creationTimestamp: 2000
      }
    ])

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-url-2", {})
    await waitForMessage(messages, "req-url-2")

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "getAllMediaItems"
    ) as any
    expect(result?.data[0].productUrl).toBe(
      "https://photos.google.com/u/2/photo/mk-multi"
    )
    restore()
  })

  it("filters items outside the requested taken date range", async () => {
    setupGptkApi([
      {
        mediaKey: "before",
        dedupKey: "dk-before",
        thumb: "https://thumb/before",
        timestamp: Date.parse("2023-12-31T23:59:59.999Z"),
        creationTimestamp: Date.parse("2024-01-02T00:00:00.000Z")
      },
      {
        mediaKey: "inside",
        dedupKey: "dk-inside",
        thumb: "https://thumb/inside",
        timestamp: Date.parse("2024-06-15T12:00:00.000Z"),
        creationTimestamp: Date.parse("2024-06-16T00:00:00.000Z")
      },
      {
        mediaKey: "after",
        dedupKey: "dk-after",
        thumb: "https://thumb/after",
        timestamp: Date.parse("2025-01-01T12:00:00.000Z"),
        creationTimestamp: Date.parse("2025-01-02T00:00:00.000Z")
      }
    ])

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-range-1", {
      dateRange: { from: "2024-01-01", to: "2024-12-31" }
    })
    await waitForMessage(messages, "req-range-1")

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "getAllMediaItems"
    ) as any
    expect(result?.success).toBe(true)
    expect(result?.data.map((item: any) => item.mediaKey)).toEqual(["inside"])
    restore()
  })

  it("[PARITY-06] rejects a repeated provider page token as incomplete coverage", async () => {
    const { messages, restore } = collectMessages()
    const getPage = vi.fn().mockResolvedValue({
      items: [
        {
          mediaKey: "repeated-page-item",
          dedupKey: "repeated-page-item",
          thumb: "https://thumb/repeated-page-item",
          timestamp: Date.parse("2024-06-15T12:00:00.000Z")
        }
      ],
      nextPageId: "same-next-page"
    })
    ;(window as any).gptkApi = { getItemsByUploadedDate: getPage }

    sendCommand("getAllMediaItems", "google-repeated-page-token", {})
    await waitForMessage(messages, "google-repeated-page-token")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-repeated-page-token"
    ) as any
    expect(getPage).toHaveBeenCalledTimes(2)
    expect(result?.scanCoverage).toMatchObject({
      status: "partial",
      stopReason: "pagination_error",
      itemsVisited: 1,
      itemsReturned: 1,
      itemsSkipped: 0
    })
    expect(result.scanCoverage.itemsVisited).toBe(
      result.scanCoverage.itemsReturned + result.scanCoverage.itemsSkipped
    )
    restore()
  })

  it("completes a full Google refresh even after it reaches the old timestamp watermark", async () => {
    const { messages, restore } = collectMessages()
    const getPage = vi.fn()
      .mockResolvedValueOnce({
        items: [
          {
            mediaKey: "google-new-3000",
            dedupKey: "google-new-3000",
            thumb: "https://thumb/google-new-3000",
            timestamp: 3000,
            creationTimestamp: 3000
          },
          {
            mediaKey: "google-new-2500",
            dedupKey: "google-new-2500",
            thumb: "https://thumb/google-new-2500",
            timestamp: 2500,
            creationTimestamp: 2500
          },
          {
            mediaKey: "google-cached-2000",
            dedupKey: "google-cached-2000",
            thumb: "https://thumb/google-cached-2000",
            timestamp: 2000,
            creationTimestamp: 2000
          }
        ],
        nextPageId: "older-page"
      })
      .mockResolvedValueOnce({
        items: [
          {
            mediaKey: "google-older-1500",
            dedupKey: "google-older-1500",
            thumb: "https://thumb/google-older-1500",
            timestamp: 1500,
            creationTimestamp: 1500
          }
        ],
        nextPageId: null
      })
    ;(window as any).gptkApi = { getItemsByUploadedDate: getPage }

    sendCommand("getAllMediaItems", "google-incremental-verified-order", {
      sinceTimestamp: 2000
    })
    await waitForMessage(messages, "google-incremental-verified-order")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-incremental-verified-order"
    ) as any
    expect(getPage).toHaveBeenCalledTimes(2)
    expect(result?.data.map((item: any) => item.mediaKey)).toEqual([
      "google-new-3000",
      "google-new-2500",
      "google-cached-2000",
      "google-older-1500"
    ])
    expect(result?.scanCoverage).toMatchObject({
      status: "complete",
      stopReason: "exhausted",
      itemsVisited: 4
    })
    restore()
  })

  it("rechecks every Google page when the prior ordering is contradictory", async () => {
    const { messages, restore } = collectMessages()
    const sinceTimestamp = 2000
    const item = (key: string, creationTimestamp: number) => ({
      mediaKey: key,
      dedupKey: key,
      thumb: `https://thumb/${key}`,
      timestamp: creationTimestamp,
      creationTimestamp
    })
    const pages = [
      {
        items: [item("cached-old", 1000), item("new-after-old", 3000)],
        nextPageId: "next"
      },
      {
        items: [item("new-next-page", 2500), item("cached-older", 900)],
        nextPageId: null
      }
    ]
    const getPage = vi
      .fn()
      .mockResolvedValueOnce(pages[0])
      .mockResolvedValueOnce(pages[1])
    ;(window as any).gptkApi = { getItemsByUploadedDate: getPage }

    sendCommand("getAllMediaItems", "google-incremental-contradictory-order", {
      sinceTimestamp
    })
    await waitForMessage(messages, "google-incremental-contradictory-order")
    const incrementalResult = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-incremental-contradictory-order"
    ) as any
    expect(getPage).toHaveBeenCalledTimes(2)
    expect(incrementalResult?.scanCoverage).toMatchObject({
      status: "complete",
      stopReason: "exhausted"
    })

    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi.fn().mockResolvedValue({
        items: pages.flatMap((page) => page.items),
        nextPageId: null
      })
    }
    sendCommand("getAllMediaItems", "google-incremental-full-oracle", {})
    await waitForMessage(messages, "google-incremental-full-oracle")
    const fullResult = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-incremental-full-oracle"
    ) as any
    expect(
      incrementalResult.data.map((media: any) => media.mediaKey)
    ).toEqual(fullResult.data.map((media: any) => media.mediaKey))
    expect(incrementalResult.data.map((media: any) => media.mediaKey)).toEqual([
      "cached-old",
      "new-after-old",
      "new-next-page",
      "cached-older"
    ])
    restore()
  })

  it("[PARITY-06] rejects an overlapping record across exhausted pages", async () => {
    const { messages, restore } = collectMessages()
    const duplicate = {
      mediaKey: "same-record-on-two-pages",
      dedupKey: "same-record-on-two-pages",
      thumb: "https://thumb/same-record-on-two-pages",
      timestamp: Date.parse("2024-06-15T12:00:00.000Z")
    }
    const getPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [duplicate], nextPageId: "next" })
      .mockResolvedValueOnce({ items: [duplicate], nextPageId: null })
    ;(window as any).gptkApi = { getItemsByUploadedDate: getPage }

    sendCommand("getAllMediaItems", "google-overlapping-page-record", {})
    await waitForMessage(messages, "google-overlapping-page-record")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-overlapping-page-record"
    ) as any
    expect(result?.data).toHaveLength(1)
    expect(result?.scanCoverage).toMatchObject({
      status: "partial",
      stopReason: "pagination_error",
      itemsVisited: 1,
      itemsReturned: 1,
      itemsSkipped: 0
    })
    expect(result.scanCoverage.itemsVisited).toBe(
      result.scanCoverage.itemsReturned + result.scanCoverage.itemsSkipped
    )
    restore()
  })

  it("counts a repeated dedup-key collision only once in timeline coverage", async () => {
    const { messages, restore } = collectMessages()
    const itemA = {
      mediaKey: "timeline-media-A",
      dedupKey: "shared-dedup-X",
      thumb: "https://thumb/timeline-media-A",
      timestamp: Date.parse("2024-06-15T12:00:00.000Z")
    }
    const itemB = {
      mediaKey: "timeline-media-B",
      dedupKey: "shared-dedup-X",
      thumb: "https://thumb/timeline-media-B",
      timestamp: Date.parse("2024-06-15T12:01:00.000Z")
    }
    const getPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [itemA, itemB], nextPageId: "next" })
      .mockResolvedValueOnce({ items: [itemB], nextPageId: null })
    ;(window as any).gptkApi = { getItemsByUploadedDate: getPage }

    sendCommand("getAllMediaItems", "google-repeated-dedup-key-identity", {})
    await waitForMessage(messages, "google-repeated-dedup-key-identity")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-repeated-dedup-key-identity"
    ) as any
    expect(result?.data.map((item: any) => item.mediaKey)).toEqual([
      "timeline-media-A"
    ])
    expect(result?.scanCoverage).toMatchObject({
      status: "partial",
      stopReason: "pagination_error",
      itemsVisited: 2,
      itemsReturned: 1,
      itemsSkipped: 1,
      unmappedItemsSkipped: 1
    })
    expect(result.scanCoverage.itemsVisited).toBe(
      result.scanCoverage.itemsReturned + result.scanCoverage.itemsSkipped
    )
    restore()
  })

  it("counts a repeated identifiable malformed timeline row only once", async () => {
    const { messages, restore } = collectMessages()
    const malformed = {
      mediaKey: "timeline-malformed-media",
      timestamp: Date.parse("2024-06-15T12:00:00.000Z")
    }
    const getPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [malformed], nextPageId: "next" })
      .mockResolvedValueOnce({ items: [malformed], nextPageId: null })
    ;(window as any).gptkApi = { getItemsByUploadedDate: getPage }

    sendCommand("getAllMediaItems", "google-repeated-malformed-identity", {})
    await waitForMessage(messages, "google-repeated-malformed-identity")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-repeated-malformed-identity"
    ) as any
    expect(result?.data).toEqual([])
    expect(result?.scanCoverage).toMatchObject({
      status: "partial",
      stopReason: "pagination_error",
      itemsVisited: 1,
      itemsReturned: 0,
      itemsSkipped: 1,
      unmappedItemsSkipped: 1
    })
    expect(result.scanCoverage.itemsVisited).toBe(
      result.scanCoverage.itemsReturned + result.scanCoverage.itemsSkipped
    )
    restore()
  })

  it("reports scanned items for date ranges even before any item matches", async () => {
    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi
        .fn()
        .mockResolvedValueOnce({
          items: [
            {
              mediaKey: "newer-outside-1",
              dedupKey: "dk-newer-outside-1",
              thumb: "https://thumb/newer-outside-1",
              timestamp: Date.parse("2026-01-01T00:00:00.000Z"),
              creationTimestamp: Date.parse("2026-01-02T00:00:00.000Z")
            },
            {
              mediaKey: "newer-outside-2",
              dedupKey: "dk-newer-outside-2",
              thumb: "https://thumb/newer-outside-2",
              timestamp: Date.parse("2025-01-01T12:00:00.000Z"),
              creationTimestamp: Date.parse("2025-01-02T00:00:00.000Z")
            }
          ],
          nextPageId: "next-page"
        })
        .mockResolvedValueOnce({
          items: [
            {
              mediaKey: "inside",
              dedupKey: "dk-inside",
              thumb: "https://thumb/inside",
              timestamp: Date.parse("2024-06-15T12:00:00.000Z"),
              creationTimestamp: Date.parse("2026-06-01T00:00:00.000Z")
            }
          ],
          nextPageId: null
        })
    }

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-range-progress-1", {
      dateRange: { from: "2024-01-01", to: "2024-12-31" }
    })
    await waitForMessage(messages, "req-range-progress-1")

    const progressMsgs = messages.filter(
      (m: any) =>
        m.action === "gptkProgress" &&
        typeof m.message === "string" &&
        m.message.startsWith("Scanned ")
    ) as any[]
    expect(progressMsgs.map((m) => m.itemsProcessed)).toEqual([2, 3])
    expect(progressMsgs[0].message).toBe("Scanned 2 items, matched 0")
    expect(progressMsgs[1].message).toBe("Scanned 3 items, matched 1")

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "getAllMediaItems"
    ) as any
    expect(result?.success).toBe(true)
    expect(result?.data.map((item: any) => item.mediaKey)).toEqual(["inside"])
    restore()
  })

  it("uses local inclusive dates and reports exact provider coverage", async () => {
    const originalTimeZone = process.env.TZ
    process.env.TZ = "America/Los_Angeles"
    try {
      const dateHost = (window as any).__GPD_COMMAND_HOST__
      const dateBounds = dateHost.dateRangeBounds({
        from: "2024-06-15",
        to: "2024-06-15"
      })
      expect(dateBounds.fromMs).toBe(new Date(2024, 5, 15).getTime())
      expect(dateBounds.toMs).toBe(
        new Date(2024, 5, 15, 23, 59, 59, 999).getTime()
      )
      setupGptkApi([
        {
          mediaKey: "local-end-of-day",
          dedupKey: "dk-local-end-of-day",
          thumb: "https://thumb/local-end-of-day",
          timestamp: new Date(2024, 5, 15, 23, 59).getTime(),
          creationTimestamp: Date.parse("2024-06-16T00:00:00.000Z")
        },
        {
          mediaKey: "unknown-date",
          dedupKey: "dk-unknown-date",
          thumb: "https://thumb/unknown-date",
          timestamp: Number.NaN,
          creationTimestamp: 0
        },
        {
          mediaKey: "next-day",
          dedupKey: "dk-next-day",
          thumb: "https://thumb/next-day",
          timestamp: new Date(2024, 5, 16, 0, 0).getTime(),
          creationTimestamp: Date.parse("2024-06-16T07:00:00.000Z")
        }
      ])

      const { messages, restore } = collectMessages()
      sendCommand("getAllMediaItems", "req-local-date-coverage", {
        dateRange: { from: "2024-06-15", to: "2024-06-15" }
      })
      await waitForMessage(messages, "req-local-date-coverage")

      const result = messages.find(
        (message: any) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems"
      ) as any
      expect(result?.data.map((item: any) => item.mediaKey)).toEqual([
        "local-end-of-day"
      ])
      expect(result?.scanCoverage).toEqual({
        status: "complete",
        stopReason: "exhausted",
        itemsVisited: 3,
        itemsReturned: 1,
        itemsSkipped: 2,
        unknownDateItemsSkipped: 1,
        pagesRead: 1,
        pageSizes: [3],
        mediaTypesCovered: { photos: true, videos: true },
        canResume: false
      })
      restore()
    } finally {
      if (originalTimeZone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimeZone
    }
  })

  it("[PARITY-MIXED] matches the v3 mixed-media inclusive-date contract", async () => {
    const originalTimeZone = process.env.TZ
    process.env.TZ = "America/Los_Angeles"
    const fixture = providerParityMixedMediaDatesV3
    setupGptkApi(
      fixture.items.map((item, index) => ({
        mediaKey: `google-v3-${index}`,
        dedupKey: `google-v3-${index}`,
        thumb: `https://thumb/google-v3-${index}`,
        fileName: item.name,
        timestamp: providerParityFixtureTimestamp(item.captureTimeLocal),
        duration: item.mediaType === "video" ? 12_345 : undefined
      }))
    )
    const { messages, restore } = collectMessages()

    try {
      sendCommand("getAllMediaItems", "google-v3-mixed-date", {
        dateRange: fixture.dateRange
      })
      await waitForMessage(messages, "google-v3-mixed-date")

      const result = messages.find(
        (message: any) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems"
      ) as any
      expect(fixture.items).toHaveLength(fixture.expected.itemCount)
      expect(
        fixture.items.filter((item) => item.mediaType === "photo")
      ).toHaveLength(fixture.expected.photoCount)
      expect(
        fixture.items.filter((item) => item.mediaType === "video")
      ).toHaveLength(fixture.expected.videoCount)
      expect(result?.data.map((item: any) => item.fileName)).toEqual(
        fixture.expected.includedNames
      )
      expect(
        result.data
          .filter((item: any) => item.fileName.endsWith(".mp4"))
          .every((item: any) => item.duration > 0)
      ).toBe(true)
      expect(result?.scanCoverage).toMatchObject({
        status: "complete",
        stopReason: "exhausted",
        itemsVisited: fixture.expected.itemsVisited,
        itemsReturned: fixture.expected.itemsReturned,
        itemsSkipped: fixture.expected.itemsSkipped,
        unknownDateItemsSkipped: fixture.expected.unknownDateItemsSkipped,
        pagesRead: 1,
        pageSizes: [fixture.expected.itemCount],
        mediaTypesCovered: { photos: true, videos: true },
        canResume: false
      })
      expect(
        result.scanCoverage.itemsSkipped -
          result.scanCoverage.unknownDateItemsSkipped
      ).toBe(fixture.expected.outOfRangeDateItems)
    } finally {
      restore()
      if (originalTimeZone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimeZone
    }
  })

  it("counts an out-of-date record toward the provider visit limit", async () => {
    setupGptkApi(
      [
        {
          mediaKey: "outside-date",
          dedupKey: "dk-outside-date",
          thumb: "https://thumb/outside-date",
          timestamp: Date.parse("2024-06-14T12:00:00.000Z")
        },
        {
          mediaKey: "inside-date",
          dedupKey: "dk-inside-date",
          thumb: "https://thumb/inside-date",
          timestamp: Date.parse("2024-06-15T12:00:00.000Z")
        }
      ],
      "next-page"
    )
    const { messages, restore } = collectMessages()

    sendCommand("getAllMediaItems", "req-google-visit-limit", {
      dateRange: { from: "2024-06-15", to: "2024-06-15" },
      limit: 1
    })
    await waitForMessage(messages, "req-google-visit-limit")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "req-google-visit-limit"
    ) as any
    expect(result).toMatchObject({
      success: true,
      data: [],
      scanCoverage: {
        status: "partial",
        stopReason: "user_limit",
        itemsVisited: 1,
        itemsReturned: 0,
        itemsSkipped: 1,
        canResume: false
      }
    })
    restore()
  })

  it("[PARITY-03] fetches media from a requested album scope", async () => {
    setupGptkAlbumApi([
      {
        mediaKey: "album-1",
        dedupKey: "dk-album-1",
        thumb: "https://thumb/album-1",
        timestamp: Date.parse("2024-06-15T12:00:00.000Z"),
        creationTimestamp: Date.parse("2024-06-16T00:00:00.000Z"),
        descriptionShort: "album-photo.jpg"
      },
      {
        mediaKey: "outside-date",
        dedupKey: "dk-outside-date",
        thumb: "https://thumb/outside-date",
        timestamp: Date.parse("2023-06-15T12:00:00.000Z"),
        creationTimestamp: Date.parse("2023-06-16T00:00:00.000Z")
      }
    ])

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-album-1", {
      albumScope: { mediaKey: "album-key", title: "Tiny test album" },
      dateRange: { from: "2024-01-01", to: "2024-12-31" }
    })
    await waitForMessage(messages, "req-album-1")

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "getAllMediaItems"
    ) as any
    expect(result).toMatchObject({ success: true })
    expect(result?.scanCoverage).toMatchObject({
      status: "partial",
      stopReason: "coverage_unknown"
    })

    expect(
      (window as any).gptkApiUtils.getAllMediaInAlbum
    ).toHaveBeenCalledWith("album-key")
    expect(
      (window as any).gptkApi.getItemsByUploadedDate
    ).not.toHaveBeenCalled()

    expect(result?.success).toBe(true)
    expect(result?.data).toMatchObject([
      {
        mediaKey: "album-1",
        fileName: "album-photo.jpg"
      }
    ])
    restore()
  })

  it("[PARITY-03] fetches album media through the low-level page API when the GPTK helper is guarded", async () => {
    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi.fn()
    }
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getAlbums: vi
          .fn()
          .mockResolvedValue([
            [googleRawAlbum("album-key", "Tiny test album", false)],
            null
          ]),
        getAlbumPage: vi
          .fn()
          .mockResolvedValueOnce({
            items: [
              {
                mediaKey: "album-page-1",
                dedupKey: "dk-album-page-1",
                thumb: "https://thumb/album-page-1",
                timestamp: Date.parse("2024-06-15T12:00:00.000Z"),
                creationTimestamp: Date.parse("2024-06-16T00:00:00.000Z")
              }
            ],
            nextPageId: "next"
          })
          .mockResolvedValueOnce({
            items: [
              {
                mediaKey: "album-page-2",
                dedupKey: "dk-album-page-2",
                thumb: "https://thumb/album-page-2",
                timestamp: Date.parse("2024-06-15T12:01:00.000Z"),
                creationTimestamp: Date.parse("2024-06-16T00:01:00.000Z")
              }
            ],
            nextPageId: null
          })
      },
      getAllMediaInAlbum: vi.fn().mockResolvedValue([])
    }

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-album-page-1", {
      albumScope: { mediaKey: "album-key", title: "Tiny test album" }
    })
    await waitForMessage(messages, "req-album-page-1")

    const getAlbumPage = (window as any).gptkApiUtils.api.getAlbumPage
    expect(getAlbumPage).toHaveBeenCalledWith("album-key", null)
    expect(getAlbumPage).toHaveBeenCalledWith("album-key", "next")
    expect(
      (window as any).gptkApiUtils.getAllMediaInAlbum
    ).not.toHaveBeenCalled()

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "getAllMediaItems"
    ) as any
    expect(result?.success).toBe(true)
    expect(result?.data.map((item: any) => item.mediaKey)).toEqual([
      "album-page-1",
      "album-page-2"
    ])
    expect(result?.scanCoverage).toMatchObject({
      pagesRead: 2,
      pageSizes: [1, 1]
    })
    restore()
  })

  it("[PARITY-03] does not mark a complete Google album scan when its provider count disagrees", async () => {
    const albumItem = {
      mediaKey: "counted-album-member",
      dedupKey: "counted-album-member-dedup",
      thumb: "https://thumb/counted-album-member",
      timestamp: 1000,
      creationTimestamp: 2000
    }
    ;(window as any).gptkApi = { getItemsByUploadedDate: vi.fn() }
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getAlbums: vi.fn().mockResolvedValue([
          [googleRawAlbum("counted-album", "Counted album", false, 2)],
          null
        ]),
        getAlbumPage: vi.fn().mockResolvedValue({
          items: [albumItem],
          nextPageId: null
        })
      },
      getAllMediaInAlbum: vi.fn().mockResolvedValue([])
    }
    const { messages, restore } = collectMessages()

    sendCommand("getAllMediaItems", "google-album-count-mismatch", {
      albumScope: { mediaKey: "counted-album", title: "Counted album" }
    })
    await waitForMessage(messages, "google-album-count-mismatch")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-album-count-mismatch"
    ) as any
    expect(result).toMatchObject({
      success: true,
      data: [{ mediaKey: "counted-album-member" }],
      scanCoverage: {
        status: "partial",
        stopReason: "coverage_unknown",
        itemsVisited: 1,
        itemsReturned: 1,
        itemsSkipped: 0,
        totalItems: 2
      }
    })
    restore()
  })

  it("[PARITY-03] fails closed when a present Google album item count is malformed", async () => {
    const getAlbumPage = vi.fn().mockResolvedValue({
      items: [
        {
          mediaKey: "malformed-count-member",
          dedupKey: "malformed-count-member-dedup",
          thumb: "https://thumb/malformed-count-member",
          timestamp: 1000,
          creationTimestamp: 2000
        }
      ],
      nextPageId: null
    })
    ;(window as any).gptkApi = { getItemsByUploadedDate: vi.fn() }
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getAlbums: vi.fn().mockResolvedValue([
          [googleRawAlbum("malformed-count-album", "Malformed count", false, -1)],
          null
        ]),
        getAlbumPage
      }
    }
    const { messages, restore } = collectMessages()

    sendCommand("getAllMediaItems", "google-album-malformed-count", {
      albumScope: {
        mediaKey: "malformed-count-album",
        title: "Malformed count"
      }
    })
    await waitForMessage(messages, "google-album-malformed-count")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-album-malformed-count"
    ) as any
    expect(getAlbumPage).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/invalid album item count/i),
      scanCoverage: { status: "failed" }
    })
    restore()
  })

  it("[PARITY-03] stops fetching Google album pages at the configured provider visit limit", async () => {
    const getAlbumPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            mediaKey: "limited-album-one",
            dedupKey: "limited-album-one-dedup",
            thumb: "https://thumb/limited-album-one",
            timestamp: 1000,
            creationTimestamp: 2000
          },
          {
            mediaKey: "limited-album-two",
            dedupKey: "limited-album-two-dedup",
            thumb: "https://thumb/limited-album-two",
            timestamp: 1001,
            creationTimestamp: 2001
          }
        ],
        nextPageId: "unvisited-page"
      })
      .mockResolvedValueOnce({
        items: [
          {
            mediaKey: "should-not-be-read",
            dedupKey: "should-not-be-read-dedup",
            thumb: "https://thumb/should-not-be-read",
            timestamp: 1002,
            creationTimestamp: 2002
          }
        ],
        nextPageId: null
      })
    ;(window as any).gptkApi = { getItemsByUploadedDate: vi.fn() }
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getAlbums: vi.fn().mockResolvedValue([
          [googleRawAlbum("limited-album", "Limited album", false)],
          null
        ]),
        getAlbumPage
      }
    }
    const { messages, restore } = collectMessages()

    sendCommand("getAllMediaItems", "google-album-visit-limit", {
      albumScope: { mediaKey: "limited-album", title: "Limited album" },
      limit: 1
    })
    await waitForMessage(messages, "google-album-visit-limit")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "google-album-visit-limit"
    ) as any
    expect(getAlbumPage).toHaveBeenCalledTimes(1)
    expect(result?.data.map((item: any) => item.mediaKey)).toEqual([
      "limited-album-one"
    ])
    expect(result?.scanCoverage).toMatchObject({
      status: "partial",
      stopReason: "user_limit",
      itemsVisited: 1,
      itemsReturned: 1,
      itemsSkipped: 0,
      pagesRead: 1,
      pageSizes: [2]
    })
    restore()
  })

  it("[PARITY-03] fails closed when album media repeats an ID across pages", async () => {
    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi.fn()
    }
    const repeated = {
      mediaKey: "album-repeated-media",
      dedupKey: "album-repeated-media",
      thumb: "https://thumb/album-repeated-media",
      timestamp: Date.parse("2024-06-15T12:00:00.000Z")
    }
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getAlbums: vi
          .fn()
          .mockResolvedValue([
            [googleRawAlbum("album-key", "Duplicate album", false)],
            null
          ]),
        getAlbumPage: vi
          .fn()
          .mockResolvedValueOnce({ items: [repeated], nextPageId: "next" })
          .mockResolvedValueOnce({
            items: [
              repeated,
              {
                mediaKey: "album-new-media",
                dedupKey: "album-new-media",
                thumb: "https://thumb/album-new-media",
                timestamp: Date.parse("2024-06-15T12:01:00.000Z")
              }
            ],
            nextPageId: null
          })
      },
      getAllMediaInAlbum: vi.fn().mockResolvedValue([])
    }

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-album-duplicate-id", {
      albumScope: { mediaKey: "album-key", title: "Duplicate album" }
    })
    await waitForMessage(messages, "req-album-duplicate-id")

    const result = messages.find(
      (m: any) =>
        m.action === "gptkResult" &&
        m.command === "getAllMediaItems" &&
        m.requestId === "req-album-duplicate-id"
    ) as any
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/repeated album media/i),
      scanCoverage: { status: "failed" }
    })
    restore()
  })

  it("[PARITY-03] fails closed when album media repeats a continuation cursor", async () => {
    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi.fn()
    }
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getAlbums: vi
          .fn()
          .mockResolvedValue([
            [googleRawAlbum("album-key", "Repeated cursor album", false)],
            null
          ]),
        getAlbumPage: vi
          .fn()
          .mockResolvedValueOnce({
            items: [
              {
                mediaKey: "album-cursor-1",
                dedupKey: "album-cursor-1",
                thumb: "https://thumb/album-cursor-1",
                timestamp: Date.parse("2024-06-15T12:00:00.000Z")
              }
            ],
            nextPageId: "same-cursor"
          })
          .mockResolvedValueOnce({
            items: [
              {
                mediaKey: "album-cursor-2",
                dedupKey: "album-cursor-2",
                thumb: "https://thumb/album-cursor-2",
                timestamp: Date.parse("2024-06-15T12:01:00.000Z")
              }
            ],
            nextPageId: "same-cursor"
          })
      },
      getAllMediaInAlbum: vi.fn().mockResolvedValue([])
    }

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-album-repeated-cursor", {
      albumScope: { mediaKey: "album-key", title: "Repeated cursor album" }
    })
    await waitForMessage(messages, "req-album-repeated-cursor")

    const result = messages.find(
      (m: any) =>
        m.action === "gptkResult" &&
        m.command === "getAllMediaItems" &&
        m.requestId === "req-album-repeated-cursor"
    ) as any
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/invalid album-media continuation cursor/i),
      scanCoverage: { status: "failed" }
    })
    restore()
  })
})

describe("listAlbums", () => {
  it("[PARITY-03] rejects an album request from a stale same-account page session", async () => {
    const getAlbums = vi.fn()
    ;(window as any).gptkApiUtils = { api: { ...mockApi, getAlbums } }

    const { messages, restore } = collectMessages()
    sendCommand("listAlbums", "req-albums-stale-session", {
      accountEmail: googleTestEmail,
      providerSessionId: "stale-google-page-session"
    })
    await waitForMessage(messages, "req-albums-stale-session")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "listAlbums" &&
        message.requestId === "req-albums-stale-session"
    ) as any
    expect(getAlbums).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/account or page session changed/i)
    })
    restore()
  })

  it("[PARITY-03] rejects an album request from a different Google account", async () => {
    const getAlbums = vi.fn()
    ;(window as any).gptkApiUtils = { api: { ...mockApi, getAlbums } }

    const { messages, restore } = collectMessages()
    sendCommand("listAlbums", "req-albums-stale-account", {
      accountEmail: "another@example.com",
      providerSessionId: googleTestSessionId
    })
    await waitForMessage(messages, "req-albums-stale-account")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "listAlbums" &&
        message.requestId === "req-albums-stale-account"
    ) as any
    expect(getAlbums).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/account or page session changed/i)
    })
    restore()
  })

  it("[PARITY-03] returns mapped GPTK albums for the scan picker", async () => {
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getAlbums: vi.fn().mockResolvedValue([
          [
          googleRawAlbum("album-1", "Tiny test album", false, 3),
            googleRawAlbum("album-2", "(Untitled album)", true)
          ],
          null
        ])
      }
    }

    const { messages, restore } = collectMessages()
    sendCommand("listAlbums", "req-albums-1", {})
    await waitForMessage(messages, "req-albums-1")

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "listAlbums"
    ) as any
    expect(result?.success).toBe(true)
    expect(result?.data).toEqual([
      {
        mediaKey: "album-1",
        title: "Tiny test album",
        itemCount: 3,
        isShared: false,
        thumb: "https://thumb/album-1"
      }
    ])
    restore()
  })

  it("[PARITY-03] lists albums through the low-level page API when the GPTK helper is guarded", async () => {
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getAlbums: vi
          .fn()
          .mockResolvedValueOnce([
            [googleRawAlbum("album-page-1", "Tiny duplicate test", false)],
            "next"
          ])
          .mockResolvedValueOnce([
            [googleRawAlbum("album-page-2", "Older album", true)],
            null
          ])
      },
      getAllAlbums: vi.fn().mockResolvedValue([])
    }

    const { messages, restore } = collectMessages()
    sendCommand("listAlbums", "req-albums-pages-1", {})
    await waitForMessage(messages, "req-albums-pages-1")

    const getAlbums = (window as any).gptkApiUtils.api.getAlbums
    expect(getAlbums).toHaveBeenCalledWith(null, 100, false)
    expect(getAlbums).toHaveBeenCalledWith("next", 100, false)
    expect((window as any).gptkApiUtils.getAllAlbums).not.toHaveBeenCalled()

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "listAlbums"
    ) as any
    expect(result?.success).toBe(true)
    expect(result?.data.map((album: any) => album.title)).toEqual([
      "Tiny duplicate test"
    ])
    expect(result?.data.every((album: any) => album.isShared !== true)).toBe(true)
    restore()
  })

  it("[PARITY-03] fails closed when album listing repeats an ID across pages", async () => {
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getAlbums: vi
          .fn()
          .mockResolvedValueOnce([
            [googleRawAlbum("album-repeat", "First", false)],
            "next"
          ])
          .mockResolvedValueOnce([
            [
              googleRawAlbum("album-repeat", "First again", false),
              googleRawAlbum("album-new", "Second", false)
            ],
            null
          ])
      },
      getAllAlbums: vi.fn().mockResolvedValue([])
    }

    const { messages, restore } = collectMessages()
    sendCommand("listAlbums", "req-albums-duplicate-id", {})
    await waitForMessage(messages, "req-albums-duplicate-id")

    const result = messages.find(
      (m: any) =>
        m.action === "gptkResult" &&
        m.command === "listAlbums" &&
        m.requestId === "req-albums-duplicate-id"
    ) as any
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/repeated an album across pages/i)
    })
    restore()
  })

  it("[PARITY-03] reads raw Google shared flags and omits album records with missing privacy metadata", async () => {
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getAlbums: vi.fn().mockResolvedValue([
          [
            googleRawAlbum("raw-personal", "Personal", false),
            googleRawAlbum("raw-shared", "Shared", true),
            googleRawAlbum("raw-unknown", "Unknown")
          ],
          null
        ])
      }
    }

    const { messages, restore } = collectMessages()
    sendCommand("listAlbums", "req-albums-raw-state", {})
    await waitForMessage(messages, "req-albums-raw-state")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "listAlbums" &&
        message.requestId === "req-albums-raw-state"
    ) as any
    expect(result).toMatchObject({
      success: true,
      data: [
        {
          mediaKey: "raw-personal",
          title: "Personal",
          isShared: false
        }
      ]
    })
    restore()
  })
})

describe("Google original media retrieval", () => {
  const bytesForHash = new TextEncoder().encode("google-original-photo")
  const photoUrl = "https://lh3.google.com/original/exact-photo?signature=secret"
  const playbackUrls = [
    "https://video-downloads.googleusercontent.com/play/exact-video?signature=one",
    "https://video-downloads.googleusercontent.com/play/exact-video?signature=two"
  ]

  function makeItem(mediaKey: string, extra: Record<string, unknown> = {}) {
    return {
      mediaKey,
      dedupKey: `${mediaKey}-dedup`,
      thumb: `https://thumb/${mediaKey}`,
      timestamp: 1718452800000,
      creationTimestamp: 1718456400000,
      ...extra
    }
  }

  async function scanWithMessages(
    messages: unknown[],
    items: unknown[],
    requestId: string,
    scopeFingerprint: string
  ) {
    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi.fn().mockResolvedValue({ items, nextPageId: null })
    }
    sendCommand("getAllMediaItems", requestId, { scanScopeFingerprint: scopeFingerprint })
    return waitForMessage(messages, requestId)
  }

  it("evicts prior same-scope review membership on a valid Google rescan", async () => {
    const scopeFingerprint = "google-same-scope-rescan-membership"
    const { messages, restore } = collectMessages()
    const commandHost = (window as any).__GPD_COMMAND_HOST__
    const resources = commandHost.originalMediaRetrieval
    resources.reset()

    try {
      const initial = await scanWithMessages(
        messages,
        [
          makeItem("google-rescan-omitted", { mediaKind: "photo", mimeType: "image/jpeg", size: 32 }),
          makeItem("google-rescan-retained", { mediaKind: "photo", mimeType: "image/jpeg", size: 48 })
        ],
        "google-rescan-membership-first",
        scopeFingerprint
      )
      expect(initial).toMatchObject({ success: true, scanCoverage: { status: "complete" } })
      expect(
        resources.getResource("google", googleTestSessionId, scopeFingerprint, "google-rescan-omitted")
      ).toMatchObject({ mediaKey: "google-rescan-omitted", mediaKind: "photo" })
      expect(
        resources.getResource("google", googleTestSessionId, scopeFingerprint, "google-rescan-retained")
      ).toMatchObject({ mediaKey: "google-rescan-retained", mediaKind: "photo" })

      const rescanned = await scanWithMessages(
        messages,
        [
          makeItem("google-rescan-retained", { mediaKind: "photo", mimeType: "image/jpeg", size: 48 }),
          makeItem("google-rescan-added", { mediaKind: "photo", mimeType: "image/jpeg", size: 64 })
        ],
        "google-rescan-membership-second",
        scopeFingerprint
      )
      expect(rescanned).toMatchObject({ success: true, scanCoverage: { status: "complete" } })
      expect(
        resources.getResource("google", googleTestSessionId, scopeFingerprint, "google-rescan-omitted")
      ).toBeUndefined()
      expect(
        resources.getResource("google", googleTestSessionId, scopeFingerprint, "google-rescan-retained")
      ).toMatchObject({ mediaKey: "google-rescan-retained", mediaKind: "photo" })
      expect(
        resources.getResource("google", googleTestSessionId, scopeFingerprint, "google-rescan-added")
      ).toMatchObject({ mediaKey: "google-rescan-added", mediaKind: "photo" })
    } finally {
      restore()
    }
  })

  it("rejects original retrieval after a same-scope rescan invalidates its cached resource", async () => {
    const scopeFingerprint = "google-inflight-resource-invalidation-scope"
    const requestId = "google-inflight-resource-invalidation-hash"
    const { messages, restore } = collectMessages()
    const commandHost = (window as any).__GPD_COMMAND_HOST__
    const resources = commandHost.originalMediaRetrieval
    resources.reset()
    let resolveItemInfo!: (info: {
      mediaKey: string
      downloadOriginalUrl: string
    }) => void
    const getItemInfo = vi.fn(
      (mediaKey: string) =>
        new Promise<{ mediaKey: string; downloadOriginalUrl: string }>((resolve) => {
          resolveItemInfo = resolve
        })
    )
    ;(window as any).gptkApiUtils = { api: { ...mockApi, getItemInfo } }

    try {
      await scanWithMessages(
        messages,
        [
          makeItem("google-inflight-evicted", { mediaKind: "photo", mimeType: "image/jpeg", size: 32 }),
          makeItem("google-inflight-retained", { mediaKind: "photo", mimeType: "image/jpeg", size: 48 })
        ],
        "google-inflight-invalidation-first-scan",
        scopeFingerprint
      )

      sendCommand("getOriginalContentHash", requestId, {
        requestId,
        mediaKey: "google-inflight-evicted",
        userOptIn: true,
        providerSessionId: googleTestSessionId,
        scanScopeFingerprint: scopeFingerprint,
        maxBytes: 1024,
        aggregateBudgetBytes: 4096
      })
      await waitForCondition(
        () => getItemInfo.mock.calls.length === 1,
        "Google original metadata lookup before the rescan"
      )

      const rescanned = await scanWithMessages(
        messages,
        [
          makeItem("google-inflight-retained", { mediaKind: "photo", mimeType: "image/jpeg", size: 48 }),
          makeItem("google-inflight-added", { mediaKind: "photo", mimeType: "image/jpeg", size: 64 })
        ],
        "google-inflight-invalidation-rescan",
        scopeFingerprint
      )
      expect(rescanned).toMatchObject({ success: true, scanCoverage: { status: "complete" } })
      expect(
        resources.getResource("google", googleTestSessionId, scopeFingerprint, "google-inflight-evicted")
      ).toBeUndefined()
      expect(
        resources.getResource("google", googleTestSessionId, scopeFingerprint, "google-inflight-retained")
      ).toMatchObject({ mediaKey: "google-inflight-retained", mediaKind: "photo" })

      resolveItemInfo({
        mediaKey: "google-inflight-evicted",
        downloadOriginalUrl: photoUrl
      })
      const invalidated = await waitForMessage(messages, requestId)
      expect(invalidated).toMatchObject({
        success: false,
        error: expect.stringContaining("review scope changed during media retrieval")
      })
      expect(
        messages.filter(
          (message: any) =>
            message?.action === "providerOriginalHash.fetch" &&
            message?.requestId === requestId
        )
      ).toHaveLength(0)
    } finally {
      if (resolveItemInfo) {
        resolveItemInfo({
          mediaKey: "google-inflight-evicted",
          downloadOriginalUrl: photoUrl
        })
      }
      restore()
    }
  })

  it("[VIDEO-PLAYBACK] hashes the exact photo original and reacquires transient video links when reopened", async () => {
    const scopeFingerprint = "google-retrieval-success-scope"
    const { messages, setPostMessageHandler, restore } = collectMessages()
    const expectedDigest = new Uint8Array(
      await window.crypto.subtle.digest("SHA-256", bytesForHash.slice().buffer)
    )
    const expectedHash = Array.from(expectedDigest, (value) =>
      value.toString(16).padStart(2, "0")
    ).join("")
    const getItemInfo = vi.fn(async (mediaKey: string) => {
      if (mediaKey === "google-hash-photo") {
        return {
          mediaKey,
          downloadOriginalUrl: photoUrl,
          downloadUrl: "https://photos.fife.usercontent.google.com/preview/photo"
        }
      }
      if (mediaKey === "google-hash-video") {
        return {
          mediaKey,
          downloadOriginalUrl:
            "https://video-downloads.googleusercontent.com/original/exact-video?signature=video-secret",
          downloadUrl:
            "https://video-downloads.googleusercontent.com/play/exact-video?signature=playback-secret",
          mimeType: "video/mp4"
        }
      }
      const playbackUrl = playbackUrls[getItemInfo.mock.calls.filter(
        ([key]) => key === "google-play-video"
      ).length - 1]
      return {
        mediaKey,
        downloadUrl: playbackUrl,
        duration: 2000,
        mimeType: "video/mp4"
      }
    })
    ;(window as any).gptkApiUtils = {
      api: { ...mockApi, getItemInfo }
    }
    setPostMessageHandler((message) => {
      if (message?.action === "providerOriginalHash.fetch") {
        dispatchOriginalHashRelayResult(message, {
          contentHash: {
            value:
              message.mediaKind === "video" ? "b".repeat(64) : expectedHash,
            algorithm: "sha256",
            provenance: "original-content",
            verificationSource: "local-original-bytes",
            contentRole: "single-file"
          },
          byteLength:
            message.mediaKind === "video" ? 13 : bytesForHash.byteLength,
          mimeType: message.mediaKind === "video" ? "video/mp4" : "image/jpeg"
        })
      }
    })
    const scan = await scanWithMessages(
      messages,
      [
        makeItem("google-hash-photo", {
          mediaKind: "photo",
          mimeType: "image/jpeg",
          size: bytesForHash.byteLength,
          isFavorite: false
        }),
        makeItem("google-hash-video", {
          mediaKind: "video",
          mimeType: "video/mp4"
        }),
        makeItem("google-play-video", {
          mediaKind: "video",
          mimeType: "video/mp4",
          duration: 2000
        })
      ],
      "google-original-success-scan",
      scopeFingerprint
    )
    expect(scan).toMatchObject({ success: true, scanCoverage: { status: "complete" } })
    expect(JSON.stringify(scan.data)).not.toContain("googleusercontent.com")
    expect(JSON.stringify(scan.data)).not.toContain("signature=")

    sendCommand("getOriginalContentHash", "google-original-hash", {
      requestId: "google-original-hash",
      mediaKey: "google-hash-photo",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: bytesForHash.byteLength
    })
    const hashResult = await waitForMessage(messages, "google-original-hash")
    expect(hashResult).toMatchObject({
      success: true,
      data: {
        mediaKey: "google-hash-photo",
        scopeFingerprint,
        byteLength: bytesForHash.byteLength,
        mimeType: "image/jpeg",
        contentHash: {
          value: expectedHash,
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes",
          contentRole: "single-file"
        }
      }
    })
    const relayRequest = messages.find(
      (message: any) => message?.action === "providerOriginalHash.fetch"
    ) as any
    expect(relayRequest).toMatchObject({
      app: "GPD",
      requestId: "google-original-hash",
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      mediaKey: "google-hash-photo",
      resourceUrl: photoUrl,
      mediaKind: "photo",
      maxBytes: bytesForHash.byteLength,
      aggregateBudgetBytes: 100 * 1024 * 1024
    })
    expect(JSON.stringify(relayRequest)).not.toContain(bytesForHash.toString())
    expect(JSON.stringify(hashResult)).not.toContain("signature=")

    sendCommand("getOriginalContentHash", "google-original-video-hash", {
      requestId: "google-original-video-hash",
      mediaKey: "google-hash-video",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: 1024
    })
    const videoHashResult = await waitForMessage(
      messages,
      "google-original-video-hash"
    )
    expect(videoHashResult).toMatchObject({
      success: true,
      data: {
        mediaKey: "google-hash-video",
        scopeFingerprint,
        byteLength: 13,
        mimeType: "video/mp4",
        contentHash: {
          value: "b".repeat(64),
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes",
          contentRole: "single-file"
        }
      }
    })
    const videoRelayRequest = messages.find(
      (message: any) =>
        message?.action === "providerOriginalHash.fetch" &&
        message?.mediaKey === "google-hash-video"
    ) as any
    expect(videoRelayRequest).toMatchObject({
      mediaKey: "google-hash-video",
      resourceUrl:
        "https://video-downloads.googleusercontent.com/original/exact-video?signature=video-secret",
      mediaKind: "video"
    })
    expect(JSON.stringify(videoHashResult)).not.toContain("video-secret")

    for (const requestId of ["google-play-open-one", "google-play-open-two"]) {
      sendCommand("getVideoPlaybackUrl", requestId, {
        requestId,
        mediaKey: "google-play-video",
        userOptIn: true,
        providerSessionId: googleTestSessionId,
        scanScopeFingerprint: scopeFingerprint
      })
      const playback = await waitForMessage(messages, requestId)
      expect(playback).toMatchObject({
        success: true,
        data: {
          mediaKey: "google-play-video",
          scopeFingerprint,
          playbackUrl: expect.stringMatching(
            /^https:\/\/video-downloads\.googleusercontent\.com\//
          )
        }
      })
      expect(JSON.stringify(playback)).not.toContain("signature=secret")
    }
    expect(getItemInfo).toHaveBeenCalledTimes(4)
    restore()
  })

  it("does not label a generic video playback URL as original content", async () => {
    const scopeFingerprint = "google-video-original-url-required-scope"
    const { messages, setPostMessageHandler, restore } = collectMessages()
    const playbackUrl =
      "https://video-downloads.googleusercontent.com/play/not-original?signature=playback-secret"
    const getItemInfo = vi.fn(async (mediaKey: string) => ({
      mediaKey,
      downloadUrl: playbackUrl,
      mimeType: "video/mp4"
    }))
    ;(window as any).gptkApiUtils = {
      api: { ...mockApi, getItemInfo }
    }
    await scanWithMessages(
      messages,
      [makeItem("google-video-with-playback-only", { mediaKind: "video", mimeType: "video/mp4" })],
      "google-video-original-url-required-scan",
      scopeFingerprint
    )

    let originalFetchCount = 0
    setPostMessageHandler((message) => {
      if (message?.action === "providerOriginalHash.fetch") originalFetchCount += 1
    })
    sendCommand("getOriginalContentHash", "google-video-playback-not-original", {
      requestId: "google-video-playback-not-original",
      mediaKey: "google-video-with-playback-only",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: 1024,
      aggregateBudgetBytes: 1024
    })

    const rejected = await waitForMessage(messages, "google-video-playback-not-original")
    expect(getItemInfo).toHaveBeenCalledTimes(1)
    expect(rejected).toMatchObject({ success: false })
    expect(JSON.stringify(rejected)).not.toContain("contentHash")
    expect(JSON.stringify(rejected)).not.toContain("playback-secret")
    expect(originalFetchCount).toBe(0)
    expect(messages.filter((message: any) => message?.action === "providerOriginalHash.fetch")).toHaveLength(0)
    restore()
  })

  it("[VIDEO-PLAYBACK] rejects non-video and unscanned playback targets before item lookup", async () => {
    const scopeFingerprint = "google-playback-target-validation-scope"
    const { messages, restore } = collectMessages()
    const getItemInfo = vi.fn()
    ;(window as any).gptkApiUtils = {
      api: { ...mockApi, getItemInfo }
    }
    await scanWithMessages(
      messages,
      [makeItem("google-photo-not-video", { mediaKind: "photo" })],
      "google-playback-target-scan",
      scopeFingerprint
    )

    sendCommand("getVideoPlaybackUrl", "google-playback-non-video", {
      requestId: "google-playback-non-video",
      mediaKey: "google-photo-not-video",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint
    })
    expect(await waitForMessage(messages, "google-playback-non-video")).toMatchObject({
      success: false,
      error: expect.stringMatching(/not a verified video/i)
    })

    sendCommand("getVideoPlaybackUrl", "google-playback-unscanned", {
      requestId: "google-playback-unscanned",
      mediaKey: "google-not-in-review",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint
    })
    expect(await waitForMessage(messages, "google-playback-unscanned")).toMatchObject({
      success: false,
      error: expect.stringMatching(/not present in this recent review/i)
    })
    expect(getItemInfo).not.toHaveBeenCalled()
    restore()
  })

  it("[VIDEO-PLAYBACK] rejects unsafe or missing playback URLs without returning transport details", async () => {
    const scopeFingerprint = "google-playback-url-validation-scope"
    const { messages, restore } = collectMessages()
    const getItemInfo = vi
      .fn()
      .mockResolvedValueOnce({
        mediaKey: "google-video-unsafe-url",
        downloadUrl: "http://video-downloads.googleusercontent.com/video?secret=unsafe"
      })
      .mockResolvedValueOnce({ mediaKey: "google-video-missing-url" })
    ;(window as any).gptkApiUtils = {
      api: { ...mockApi, getItemInfo }
    }
    await scanWithMessages(
      messages,
      [
        makeItem("google-video-unsafe-url", {
          mediaKind: "video",
          mimeType: "video/mp4"
        }),
        makeItem("google-video-missing-url", {
          mediaKind: "video",
          mimeType: "video/mp4"
        })
      ],
      "google-playback-url-scan",
      scopeFingerprint
    )

    for (const [requestId, mediaKey] of [
      ["google-playback-unsafe-url", "google-video-unsafe-url"],
      ["google-playback-missing-url", "google-video-missing-url"]
    ]) {
      sendCommand("getVideoPlaybackUrl", requestId, {
        requestId,
        mediaKey,
        userOptIn: true,
        providerSessionId: googleTestSessionId,
        scanScopeFingerprint: scopeFingerprint
      })
      const result = await waitForMessage(messages, requestId)
      expect(result).toMatchObject({
        success: false,
        error: expect.stringMatching(/verified video playback resource/i)
      })
      expect(JSON.stringify(result)).not.toContain("video-downloads.googleusercontent.com")
      expect(JSON.stringify(result)).not.toContain("secret=unsafe")
    }
    expect(getItemInfo).toHaveBeenCalledTimes(2)
    restore()
  })

  it("[VIDEO-PLAYBACK] cancels an in-flight video metadata lookup without returning its URL", async () => {
    const scopeFingerprint = "google-playback-cancellation-scope"
    const requestId = "google-playback-cancelled"
    let resolveItemInfo: ((value: unknown) => void) | undefined
    const pendingItemInfo = new Promise<unknown>((resolve) => {
      resolveItemInfo = resolve
    })
    const getItemInfo = vi.fn(() => pendingItemInfo)
    const { messages, restore } = collectMessages()
    ;(window as any).gptkApiUtils = {
      api: { ...mockApi, getItemInfo }
    }
    await scanWithMessages(
      messages,
      [
        makeItem("google-video-cancel", {
          mediaKind: "video",
          mimeType: "video/mp4"
        })
      ],
      "google-playback-cancel-scan",
      scopeFingerprint
    )

    sendCommand("getVideoPlaybackUrl", requestId, {
      requestId,
      mediaKey: "google-video-cancel",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint
    })
    await waitForCondition(() => getItemInfo.mock.calls.length === 1, "video metadata lookup")
    sendCommand("cancelProviderRequest", "google-playback-cancel-command", {
      targetRequestId: requestId,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint
    })
    await waitForMessage(messages, "google-playback-cancel-command")
    const cancelled = await waitForMessage(messages, requestId)
    expect(cancelled).toMatchObject({
      success: false,
      error: expect.stringMatching(/retrieval was cancelled/i)
    })
    expect(JSON.stringify(cancelled)).not.toContain("playbackUrl")
    resolveItemInfo?.({
      mediaKey: "google-video-cancel",
      downloadUrl: playbackUrls[0]
    })
    await yieldOneRealEventLoopTurn()
    const playbackResults = messages.filter(
      (candidate: any) =>
        candidate?.action === "gptkResult" && candidate?.requestId === requestId
    )
    expect(playbackResults).toHaveLength(1)
    expect(playbackResults[0]).toMatchObject({
      success: false,
      error: expect.stringMatching(/retrieval was cancelled/i)
    })
    expect(JSON.stringify(playbackResults)).not.toContain(playbackUrls[0])
    expect(JSON.stringify(playbackResults)).not.toContain("playbackUrl")
    restore()
  })

  it("[VIDEO-PLAYBACK] cancels playback when the Google account and session change during metadata lookup", async () => {
    const scopeFingerprint = "google-playback-account-drift-scope"
    const requestId = "google-playback-account-drift"
    let resolveItemInfo: ((value: unknown) => void) | undefined
    const pendingItemInfo = new Promise<unknown>((resolve) => {
      resolveItemInfo = resolve
    })
    const getItemInfo = vi.fn(() => pendingItemInfo)
    const { messages, restore } = collectMessages()
    ;(window as any).gptkApiUtils = {
      api: { ...mockApi, getItemInfo }
    }
    await scanWithMessages(
      messages,
      [
        makeItem("google-video-account-drift", {
          mediaKind: "video",
          mimeType: "video/mp4"
        })
      ],
      "google-playback-account-drift-scan",
      scopeFingerprint
    )

    sendCommand("getVideoPlaybackUrl", requestId, {
      requestId,
      mediaKey: "google-video-account-drift",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint
    })
    await waitForCondition(() => getItemInfo.mock.calls.length === 1, "video metadata lookup")
    ;(window as any).WIZ_global_data = { oPEP7c: "different-account@example.com" }
    resolveItemInfo?.({
      mediaKey: "google-video-account-drift",
      downloadUrl: playbackUrls[0]
    })

    const rejected = await waitForMessage(messages, requestId)
    expect(rejected).toMatchObject({
      success: false,
      error: expect.stringMatching(/retrieval was cancelled/i)
    })
    expect(JSON.stringify(rejected)).not.toContain(playbackUrls[0])
    expect(JSON.stringify(rejected)).not.toContain("playbackUrl")
    expect((window as any).__GPD_COMMAND_HOST__.providerSessionId).not.toBe(
      googleTestSessionId
    )
    restore()
  })

  it("[VIDEO-PLAYBACK] cancels playback when a newer scan changes the active scope", async () => {
    const originalScope = "google-playback-old-scope"
    const newerScope = "google-playback-new-scope"
    const requestId = "google-playback-scope-drift"
    let resolveItemInfo: ((value: unknown) => void) | undefined
    const pendingItemInfo = new Promise<unknown>((resolve) => {
      resolveItemInfo = resolve
    })
    const getItemInfo = vi.fn(() => pendingItemInfo)
    const { messages, restore } = collectMessages()
    ;(window as any).gptkApiUtils = {
      api: { ...mockApi, getItemInfo }
    }
    await scanWithMessages(
      messages,
      [
        makeItem("google-video-scope-drift", {
          mediaKind: "video",
          mimeType: "video/mp4"
        })
      ],
      "google-playback-scope-drift-scan",
      originalScope
    )

    sendCommand("getVideoPlaybackUrl", requestId, {
      requestId,
      mediaKey: "google-video-scope-drift",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: originalScope
    })
    await waitForCondition(() => getItemInfo.mock.calls.length === 1, "video metadata lookup")
    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi.fn().mockResolvedValue({ items: [], nextPageId: null })
    }
    sendCommand("getAllMediaItems", "google-playback-new-scope-scan", {
      scanScopeFingerprint: newerScope
    })
    await waitForMessage(messages, "google-playback-new-scope-scan")
    const rejected = await waitForMessage(messages, requestId)
    expect(rejected).toMatchObject({
      success: false,
      error: expect.stringMatching(/retrieval was cancelled/i)
    })
    expect(JSON.stringify(rejected)).not.toContain(playbackUrls[0])
    expect(JSON.stringify(rejected)).not.toContain("playbackUrl")
    resolveItemInfo?.({
      mediaKey: "google-video-scope-drift",
      downloadUrl: playbackUrls[0]
    })
    await yieldOneRealEventLoopTurn()
    const playbackResults = messages.filter(
      (candidate: any) =>
        candidate?.action === "gptkResult" && candidate?.requestId === requestId
    )
    expect(playbackResults).toHaveLength(1)
    expect(playbackResults[0]).toMatchObject({
      success: false,
      error: expect.stringMatching(/retrieval was cancelled/i)
    })
    expect(JSON.stringify(playbackResults)).not.toContain(playbackUrls[0])
    expect(JSON.stringify(playbackResults)).not.toContain("playbackUrl")
    restore()
  })

  it("preserves still-only Live Photo hash evidence and rejects a whole-file claim", async () => {
    const scopeFingerprint = "google-live-photo-role-scope"
    const { messages, setPostMessageHandler, restore } = collectMessages()
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getItemInfo: vi.fn(async (mediaKey: string) => ({
          mediaKey,
          downloadOriginalUrl: photoUrl
        }))
      }
    }
    await scanWithMessages(
      messages,
      [
        makeItem("google-live-photo-role", {
          isLivePhoto: true,
          mimeType: "image/jpeg"
        })
      ],
      "google-live-photo-role-scan",
      scopeFingerprint
    )
    let relayCount = 0
    setPostMessageHandler((message) => {
      if (message?.action !== "providerOriginalHash.fetch") return
      relayCount += 1
      if (relayCount === 1) {
        dispatchOriginalHashRelayResult(message)
        return
      }
      dispatchOriginalHashRelayResult(message, {
        contentHash: {
          value: "c".repeat(64),
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes",
          contentRole: "single-file"
        }
      })
    })

    sendCommand("getOriginalContentHash", "google-live-photo-role-hash", {
      requestId: "google-live-photo-role-hash",
      mediaKey: "google-live-photo-role",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: 1024
    })
    const stillHash = await waitForMessage(messages, "google-live-photo-role-hash")
    expect(stillHash).toMatchObject({
      success: true,
      data: {
        contentHash: {
          verificationSource: "local-original-bytes",
          contentRole: "live-photo-still"
        }
      }
    })

    sendCommand("getOriginalContentHash", "google-live-photo-role-mismatch", {
      requestId: "google-live-photo-role-mismatch",
      mediaKey: "google-live-photo-role",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: 1024
    })
    const mismatchedHash = await waitForMessage(
      messages,
      "google-live-photo-role-mismatch"
    )
    expect(mismatchedHash).toMatchObject({ success: false })
    expect(JSON.stringify(mismatchedHash)).not.toContain("contentHash")
    restore()
  })

  it("rejects unscanned, non-opted-in, stale-session, invalid-size, and oversized-known targets before original fetch", async () => {
    const scopeFingerprint = "google-retrieval-reject-scope"
    const { messages, restore } = collectMessages()
    const getItemInfo = vi.fn(async (mediaKey: string) => ({
      mediaKey,
      downloadOriginalUrl: photoUrl
    }))
    ;(window as any).gptkApiUtils = { api: { ...mockApi, getItemInfo } }
    await scanWithMessages(
      messages,
      [makeItem("google-known-large", { mimeType: "image/jpeg", size: 2048 })],
      "google-original-reject-scan",
      scopeFingerprint
    )

    sendCommand("getOriginalContentHash", "google-no-opt-in", {
      requestId: "google-no-opt-in",
      mediaKey: "google-known-large",
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: 1024
    })
    expect(await waitForMessage(messages, "google-no-opt-in")).toMatchObject({
      success: false
    })

    sendCommand("getOriginalContentHash", "google-unscanned-target", {
      requestId: "google-unscanned-target",
      mediaKey: "not-in-scan",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: 4096
    })
    expect(await waitForMessage(messages, "google-unscanned-target")).toMatchObject({
      success: false
    })

    sendCommand("getOriginalContentHash", "google-wrong-scope", {
      requestId: "google-wrong-scope",
      mediaKey: "google-known-large",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: "a-different-scope",
      maxBytes: 4096
    })
    expect(await waitForMessage(messages, "google-wrong-scope")).toMatchObject({
      success: false
    })

    sendCommand("getOriginalContentHash", "google-known-size-over-limit", {
      requestId: "google-known-size-over-limit",
      mediaKey: "google-known-large",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: 1024
    })
    const oversized = await waitForMessage(messages, "google-known-size-over-limit")
    expect(oversized).toMatchObject({ success: false })
    expect(JSON.stringify(oversized)).not.toContain("lh3.google.com")

    sendCommand("getOriginalContentHash", "google-over-per-item-cap", {
      requestId: "google-over-per-item-cap",
      mediaKey: "google-known-large",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: 25 * 1024 * 1024 + 1
    })
    expect(await waitForMessage(messages, "google-over-per-item-cap")).toMatchObject({
      success: false
    })
    sendCommand("getOriginalContentHash", "google-over-review-cap", {
      requestId: "google-over-review-cap",
      mediaKey: "google-known-large",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: 1024,
      aggregateBudgetBytes: 100 * 1024 * 1024 + 1
    })
    expect(await waitForMessage(messages, "google-over-review-cap")).toMatchObject({
      success: false
    })
    expect(getItemInfo).not.toHaveBeenCalled()
    expect(messages.filter((message: any) => message?.action === "providerOriginalHash.fetch")).toHaveLength(0)
    restore()
  })

  it("requires an explicit aggregate review budget before item lookup or fetch", async () => {
    const scopeFingerprint = "google-retrieval-budget-required-scope"
    const { messages, restore } = collectMessages()
    const getItemInfo = vi.fn(async (mediaKey: string) => ({
      mediaKey,
      downloadOriginalUrl: photoUrl
    }))
    ;(window as any).gptkApiUtils = { api: { ...mockApi, getItemInfo } }
    await scanWithMessages(
      messages,
      [makeItem("google-required-budget-photo", { mimeType: "image/jpeg" })],
      "google-required-budget-scan",
      scopeFingerprint
    )

    const requestId = "google-required-budget-missing"
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          app: "GPD",
          action: "gptkCommand",
          command: "getOriginalContentHash",
          requestId,
          args: {
            requestId,
            mediaKey: "google-required-budget-photo",
            userOptIn: true,
            providerSessionId: googleTestSessionId,
            scanScopeFingerprint: scopeFingerprint,
            maxBytes: 1024
          }
        }
      })
    )

    expect(await waitForMessage(messages, requestId)).toMatchObject({
      success: false
    })
    expect(getItemInfo).not.toHaveBeenCalled()
    expect(messages.filter((message: any) => message?.action === "providerOriginalHash.fetch")).toHaveLength(0)
    restore()
  })

  it("rejects an account switch before item metadata lookup", async () => {
    const scopeFingerprint = "google-retrieval-account-scope"
    const { messages, restore } = collectMessages()
    const getItemInfo = vi.fn()
    ;(window as any).gptkApiUtils = { api: { ...mockApi, getItemInfo } }
    await scanWithMessages(
      messages,
      [makeItem("google-account-bound-photo", { mimeType: "image/jpeg" })],
      "google-account-bound-scan",
      scopeFingerprint
    )
    ;(window as any).WIZ_global_data = { oPEP7c: "different-account@example.com" }
    sendCommand("getOriginalContentHash", "google-account-changed", {
      requestId: "google-account-changed",
      mediaKey: "google-account-bound-photo",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: 1024
    })
    const changed = await waitForMessage(messages, "google-account-changed")
    expect(changed).toMatchObject({ success: false })
    expect(getItemInfo).not.toHaveBeenCalled()
    expect(messages.filter((message: any) => message?.action === "providerOriginalHash.fetch")).toHaveLength(0)
    restore()
  })

  it("rejects unapproved original routes without exposing signed URLs", async () => {
    const scopeFingerprint = "google-retrieval-unapproved-route-scope"
    const { messages, restore } = collectMessages()
    const getItemInfo = vi.fn(async (mediaKey: string) => ({
      mediaKey,
      downloadOriginalUrl: "https://attacker.example/private?secret=secret"
    }))
    ;(window as any).gptkApiUtils = { api: { ...mockApi, getItemInfo } }
    await scanWithMessages(
      messages,
      [makeItem("google-unapproved-resource", { mimeType: "image/jpeg" })],
      "google-unapproved-route-scan",
      scopeFingerprint
    )
    sendCommand("getOriginalContentHash", "google-unapproved-resource-hash", {
      requestId: "google-unapproved-resource-hash",
      mediaKey: "google-unapproved-resource",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: 1024
    })
    const rejected = await waitForMessage(
      messages,
      "google-unapproved-resource-hash"
    )
    expect(rejected).toMatchObject({ success: false })
    expect(JSON.stringify(rejected)).not.toContain("attacker.example")
    expect(JSON.stringify(rejected)).not.toContain("secret")
    expect(messages.filter((message: any) => message?.action === "providerOriginalHash.fetch")).toHaveLength(0)
    restore()
  })

  it("cancels matching in-flight retrieval and rejects malformed relay hash evidence", async () => {
    const scopeFingerprint = "google-retrieval-abort-scope"
    const { messages, restore } = collectMessages()
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getItemInfo: vi.fn(async (mediaKey: string) => ({
          mediaKey,
          downloadOriginalUrl: photoUrl
        }))
      }
    }
    await scanWithMessages(
      messages,
      [makeItem("google-cancellable-photo", { mimeType: "image/jpeg" })],
      "google-cancellable-scan",
      scopeFingerprint
    )
    sendCommand("getOriginalContentHash", "google-cancellable-fetch", {
      requestId: "google-cancellable-fetch",
      mediaKey: "google-cancellable-photo",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: 1024
    })
    await waitForPostedAction(
      messages,
      "providerOriginalHash.fetch",
      "google-cancellable-fetch"
    )
    sendCommand("cancelProviderRequest", "google-cancel-command", {
      targetRequestId: "google-cancellable-fetch",
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint
    })
    await waitForMessage(messages, "google-cancel-command")
    const cancelled = await waitForMessage(messages, "google-cancellable-fetch")
    expect(cancelled).toMatchObject({ success: false })
    expect(JSON.stringify(cancelled)).not.toContain("contentHash")
    expect(messages).toContainEqual(
      expect.objectContaining({
        app: "GPD",
        action: "providerOriginalHash.cancel",
        requestId: "google-cancellable-fetch",
        providerSessionId: googleTestSessionId,
        scanScopeFingerprint: scopeFingerprint,
        mediaKey: "google-cancellable-photo"
      })
    )

    const streamedScope = "google-retrieval-stream-overflow"
    const streamedMessages = collectMessages()
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getItemInfo: vi.fn(async (mediaKey: string) => ({
          mediaKey,
          downloadOriginalUrl: photoUrl
        }))
      }
    }
    await scanWithMessages(
      streamedMessages.messages,
      [makeItem("google-stream-overflow", { mimeType: "image/jpeg" })],
      "google-stream-overflow-scan",
      streamedScope
    )
    streamedMessages.setPostMessageHandler((message) => {
      if (message?.action === "providerOriginalHash.fetch") {
        dispatchOriginalHashRelayResult(message, { byteLength: 8 })
      }
    })
    sendCommand("getOriginalContentHash", "google-stream-overflow-fetch", {
      requestId: "google-stream-overflow-fetch",
      mediaKey: "google-stream-overflow",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: streamedScope,
      maxBytes: 4
    })
    const overflow = await waitForMessage(
      streamedMessages.messages,
      "google-stream-overflow-fetch"
    )
    expect(overflow).toMatchObject({ success: false })
    expect(JSON.stringify(overflow)).not.toContain("contentHash")
    expect(JSON.stringify(overflow)).not.toContain("lh3.google.com")
    expect(
      streamedMessages.messages.filter(
        (message: any) => message?.action === "providerOriginalHash.fetch"
      )
    ).toHaveLength(1)
    streamedMessages.restore()
    restore()
  })

  it("reserves aggregate bytes before concurrent downloads and keeps the budget outside the LRU cache", async () => {
    const scopeFingerprint = "google-retrieval-budget-scope"
    const { messages, setPostMessageHandler, restore } = collectMessages()
    const getItemInfo = vi.fn(async (mediaKey: string) => ({
      mediaKey,
      downloadOriginalUrl: `https://lh3.google.com/original/${mediaKey}`
    }))
    ;(window as any).gptkApiUtils = {
      api: {
        ...mockApi,
        getItemInfo
      }
    }
    let originalFetchCount = 0
    setPostMessageHandler((message) => {
      if (message?.action === "providerOriginalHash.fetch") originalFetchCount += 1
    })
    const pair = [
      makeItem("google-budget-first", { mimeType: "image/jpeg" }),
      makeItem("google-budget-second", { mimeType: "image/jpeg" })
    ]
    await scanWithMessages(
      messages,
      pair,
      "google-budget-initial-scan",
      scopeFingerprint
    )
    const hashArgs = (requestId: string, mediaKey: string) => ({
      requestId,
      mediaKey,
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: 8,
      aggregateBudgetBytes: 8
    })
    sendCommand(
      "getOriginalContentHash",
      "google-budget-inflight-first",
      hashArgs("google-budget-inflight-first", "google-budget-first")
    )
    const firstRelay = await waitForPostedAction(
      messages,
      "providerOriginalHash.fetch",
      "google-budget-inflight-first"
    )
    sendCommand(
      "getOriginalContentHash",
      "google-budget-inflight-second",
      hashArgs("google-budget-inflight-second", "google-budget-second")
    )
    expect(
      await waitForMessage(messages, "google-budget-inflight-second")
    ).toMatchObject({ success: false })
    expect(originalFetchCount).toBe(1)
    dispatchOriginalHashRelayResult(firstRelay, { byteLength: 8 })
    expect(
      await waitForMessage(messages, "google-budget-inflight-first")
    ).toMatchObject({ success: true })
    sendCommand(
      "getOriginalContentHash",
      "google-budget-after-exhaustion",
      hashArgs("google-budget-after-exhaustion", "google-budget-second")
    )
    expect(
      await waitForMessage(messages, "google-budget-after-exhaustion")
    ).toMatchObject({ success: false })
    expect(originalFetchCount).toBe(1)
    sendCommand("getOriginalContentHash", "google-budget-cannot-be-tightened", {
      requestId: "google-budget-cannot-be-tightened",
      mediaKey: "google-budget-second",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: 8,
      aggregateBudgetBytes: 4
    })
    expect(
      await waitForMessage(messages, "google-budget-cannot-be-tightened")
    ).toMatchObject({ success: false })
    expect(getItemInfo).toHaveBeenCalledTimes(1)
    expect(originalFetchCount).toBe(1)
    sendCommand("getOriginalContentHash", "google-budget-cannot-be-raised", {
      requestId: "google-budget-cannot-be-raised",
      mediaKey: "google-budget-second",
      userOptIn: true,
      providerSessionId: googleTestSessionId,
      scanScopeFingerprint: scopeFingerprint,
      maxBytes: 8,
      aggregateBudgetBytes: 100 * 1024 * 1024
    })
    expect(
      await waitForMessage(messages, "google-budget-cannot-be-raised")
    ).toMatchObject({ success: false })
    expect(originalFetchCount).toBe(1)

    const manyItems = Array.from({ length: 10001 }, (_, index) =>
      makeItem(`google-lru-${index}`, { mimeType: "image/jpeg" })
    )
    const manyPages = Array.from(
      { length: Math.ceil(manyItems.length / 1000) },
      (_, pageIndex) => {
        const start = pageIndex * 1000
        return {
          items: manyItems.slice(start, start + 1000),
          nextPageId:
            start + 1000 < manyItems.length
              ? `page-${pageIndex + 1}`
              : null
        }
      }
    )
    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi.fn((pageId: string | null) => {
        const pageIndex = pageId ? Number(pageId.slice("page-".length)) : 0
        return Promise.resolve(manyPages[pageIndex])
      })
    }
    sendCommand("getAllMediaItems", "google-budget-lru-churn-one", {
      scanScopeFingerprint: scopeFingerprint
    })
    expect(
      await waitForMessage(messages, "google-budget-lru-churn-one")
    ).toMatchObject({ scanCoverage: { status: "complete", itemsReturned: 10001 } })
    sendCommand(
      "getOriginalContentHash",
      "google-budget-post-churn",
      {
        requestId: "google-budget-post-churn",
        mediaKey: "google-lru-10000",
        userOptIn: true,
        providerSessionId: googleTestSessionId,
        scanScopeFingerprint: scopeFingerprint,
        maxBytes: 8,
        aggregateBudgetBytes: 8
      }
    )
    expect(await waitForMessage(messages, "google-budget-post-churn")).toMatchObject({
      success: false
    })
    expect(originalFetchCount).toBe(1)
    restore()
  })

  it("freezes the first explicit review cap and rejects either later cap change before lookup", async () => {
    const scopeFingerprint = "google-retrieval-immutable-cap-scope"
    const { messages, setPostMessageHandler, restore } = collectMessages()
    const getItemInfo = vi.fn(async (mediaKey: string) => ({
      mediaKey,
      downloadOriginalUrl: `https://lh3.google.com/original/${mediaKey}`
    }))
    ;(window as any).gptkApiUtils = {
      api: { ...mockApi, getItemInfo }
    }
    let relayFetchCount = 0
    setPostMessageHandler((message) => {
      if (message?.action === "providerOriginalHash.fetch") {
        relayFetchCount += 1
        dispatchOriginalHashRelayResult(message, { byteLength: 1 })
      }
    })
    await scanWithMessages(
      messages,
      [
        makeItem("google-cap-first", { mimeType: "image/jpeg" }),
        makeItem("google-cap-lower", { mimeType: "image/jpeg" }),
        makeItem("google-cap-higher", { mimeType: "image/jpeg" })
      ],
      "google-cap-initial-scan",
      scopeFingerprint
    )

    const requestHash = (requestId: string, mediaKey: string, aggregateBudgetBytes: number) => {
      sendCommand("getOriginalContentHash", requestId, {
        requestId,
        mediaKey,
        userOptIn: true,
        providerSessionId: googleTestSessionId,
        scanScopeFingerprint: scopeFingerprint,
        maxBytes: 8,
        aggregateBudgetBytes
      })
    }
    requestHash("google-cap-first-request", "google-cap-first", 16)
    expect(await waitForMessage(messages, "google-cap-first-request")).toMatchObject({
      success: true
    })
    expect(relayFetchCount).toBe(1)
    expect(getItemInfo).toHaveBeenCalledTimes(1)

    requestHash("google-cap-lower-request", "google-cap-lower", 8)
    expect(await waitForMessage(messages, "google-cap-lower-request")).toMatchObject({
      success: false
    })
    requestHash("google-cap-higher-request", "google-cap-higher", 32)
    expect(await waitForMessage(messages, "google-cap-higher-request")).toMatchObject({
      success: false
    })
    expect(getItemInfo).toHaveBeenCalledTimes(1)
    expect(relayFetchCount).toBe(1)
    restore()
  })
})

// ============================================================
// Unit tests: trashItems
// ============================================================

describe("trashItems — chunking", () => {
  it("rechecks current favorite metadata and dispatches only explicit non-favorites", async () => {
    const favoriteByMediaKey = new Map<string, boolean | undefined | string>([
      ["media-now-favorite", true],
      ["media-favorite-unknown", undefined],
      ["media-malformed-favorite", "false"],
      ["media-explicitly-not-favorite", false]
    ])
    mockGetItemInfo.mockImplementation(async (mediaKey: string) => {
      const isFavorite = favoriteByMediaKey.get(mediaKey)
      return {
        mediaKey,
        ...(isFavorite === undefined ? {} : { isFavorite })
      }
    })
    const { messages, restore } = collectMessages()
    const dedupKeys = [
      "dedup-favorite",
      "dedup-unknown",
      "dedup-malformed",
      "dedup-not-favorite"
    ]
    const mediaKeysToTrash = [
      "media-now-favorite",
      "media-favorite-unknown",
      "media-malformed-favorite",
      "media-explicitly-not-favorite"
    ]

    sendCommand("trashItems", "req-trash-fresh-favorites", {
      dedupKeys,
      mediaKeysToTrash,
      batchSize: 4
    })
    await waitForMessage(messages, "req-trash-fresh-favorites")

    expect(mockGetItemInfo.mock.calls.map(([mediaKey]) => mediaKey)).toEqual(
      mediaKeysToTrash
    )
    expect(mockMoveItemsToTrash).toHaveBeenCalledTimes(1)
    expect(mockMoveItemsToTrash).toHaveBeenCalledWith(["dedup-not-favorite"])

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === "req-trash-fresh-favorites"
    ) as any
    expect(result?.success).toBe(false)
    expect(result?.data).toMatchObject({
      trashedCount: 1,
      trashedDedupKeys: ["dedup-not-favorite"],
      notDispatchedDedupKeys: [
        "dedup-favorite",
        "dedup-unknown",
        "dedup-malformed"
      ],
      outcomes: [
        {
          operation: "trash",
          targetKey: "dedup-favorite",
          status: "failed",
          reason: "favorite-protected-current-state"
        },
        {
          operation: "trash",
          targetKey: "dedup-unknown",
          status: "failed",
          reason: "favorite-state-unknown-not-acknowledged"
        },
        {
          operation: "trash",
          targetKey: "dedup-malformed",
          status: "failed",
          reason: "favorite-state-unknown-not-acknowledged"
        },
        {
          operation: "trash",
          targetKey: "dedup-not-favorite",
          status: "confirmed"
        }
      ]
    })
    restore()
  })

  it("protects a photo favorited after its scan snapshot was not-favorite", async () => {
    const mediaKey = "media-favorite-changed-after-scan"
    const dedupKey = "dedup-favorite-changed-after-scan"
    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi.fn(async () => ({
        items: [
          {
            mediaKey,
            dedupKey,
            thumb: `https://thumb/${mediaKey}`,
            timestamp: 1_700_000_000_000,
            creationTimestamp: 1_700_000_000_000,
            isFavorite: false,
            isOwned: true
          }
        ],
        nextPageId: null
      }))
    }
    const { messages, restore } = collectMessages()

    sendCommand("getAllMediaItems", "req-scan-not-favorite", {})
    await waitForMessage(messages, "req-scan-not-favorite")
    const scanResult = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "req-scan-not-favorite"
    ) as any
    expect(scanResult?.data).toMatchObject([
      { mediaKey, dedupKey, favoriteStatus: "not-favorite" }
    ])

    mockGetItemInfo.mockResolvedValue({ mediaKey, isFavorite: true })
    sendCommand("trashItems", "req-trash-now-favorite", {
      dedupKeys: [dedupKey],
      mediaKeysToTrash: [mediaKey]
    })
    await waitForMessage(messages, "req-trash-now-favorite")

    expect(mockMoveItemsToTrash).not.toHaveBeenCalled()
    const trashResult = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === "req-trash-now-favorite"
    ) as any
    expect(trashResult?.data).toMatchObject({
      notDispatchedDedupKeys: [dedupKey],
      outcomes: [
        {
          targetKey: dedupKey,
          status: "failed",
          reason: "favorite-protected-current-state"
        }
      ]
    })
    restore()
  })

  it("records the non-atomic favorite race after preflight and immediately before Trash dispatch", async () => {
    const mediaKey = "media-favorite-race"
    const dedupKey = "dedup-favorite-race"
    let favoriteAtProvider = false
    let favoriteChangedAfterPreflight = false
    mockGetItemInfo.mockImplementation(async (requestedMediaKey: string) => {
      // The adapter's last client read sees false. Queue the user-side toggle
      // before the caller resumes from this await, placing it between preflight
      // and moveItemsToTrash dispatch.
      const observedFavorite = favoriteAtProvider
      queueMicrotask(() => {
        favoriteAtProvider = true
        favoriteChangedAfterPreflight = true
      })
      return { mediaKey: requestedMediaKey, isFavorite: observedFavorite }
    })
    mockMoveItemsToTrash.mockImplementationOnce(async (keys: string[]) => {
      expect(favoriteChangedAfterPreflight).toBe(true)
      expect(favoriteAtProvider).toBe(true)
      // The GPTK trash call takes only target keys; it has no expected-favorite
      // condition/CAS parameter, so this models the provider accepting the call
      // after the favorite toggle won the race.
      for (const key of keys) {
        googleLibraryKeys.delete(key)
        googleTrashKeys.add(key)
      }
    })

    const { messages, restore } = collectMessages()
    sendCommand("trashItems", "req-trash-favorite-race", {
      dedupKeys: [dedupKey],
      mediaKeysToTrash: [mediaKey]
    })
    const result = await waitForMessage(messages, "req-trash-favorite-race")

    expect(mockGetItemInfo).toHaveBeenCalledTimes(1)
    expect(mockMoveItemsToTrash).toHaveBeenCalledWith([dedupKey])
    expect(result).toMatchObject({
      success: true,
      data: {
        trashedDedupKeys: [dedupKey],
        outcomes: [{ targetKey: dedupKey, status: "confirmed" }]
      }
    })
    restore()
  })

  it("blocks a previously not-favorite scan item when fresh favorite state becomes unknown", async () => {
    const mediaKey = "media-favorite-became-unknown"
    const dedupKey = "dedup-favorite-became-unknown"
    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi.fn(async () => ({
        items: [
          {
            mediaKey,
            dedupKey,
            thumb: `https://thumb/${mediaKey}`,
            timestamp: 1_700_000_000_000,
            creationTimestamp: 1_700_000_000_000,
            isFavorite: false,
            isOwned: true
          }
        ],
        nextPageId: null
      }))
    }
    const { messages, restore } = collectMessages()

    sendCommand("getAllMediaItems", "req-scan-known-not-favorite", {})
    await waitForMessage(messages, "req-scan-known-not-favorite")
    const scanResult = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "req-scan-known-not-favorite"
    ) as any
    expect(scanResult?.data).toMatchObject([
      { mediaKey, dedupKey, favoriteStatus: "not-favorite" }
    ])

    mockGetItemInfo.mockResolvedValue({ mediaKey })
    sendCommand("trashItems", "req-trash-favorite-now-unknown", {
      dedupKeys: [dedupKey],
      mediaKeysToTrash: [mediaKey]
    })
    const trashResult = await waitForMessage(
      messages,
      "req-trash-favorite-now-unknown"
    )

    expect(mockMoveItemsToTrash).not.toHaveBeenCalled()
    expect(trashResult).toMatchObject({
      action: "gptkResult",
      command: "trashItems",
      requestId: "req-trash-favorite-now-unknown",
      data: {
        notDispatchedDedupKeys: [dedupKey],
        outcomes: [
          {
            targetKey: dedupKey,
            status: "failed",
            reason: "favorite-state-unknown-not-acknowledged"
          }
        ]
      }
    })
    restore()
  })

  it("allows acknowledged exact-item unknown favorites but never overrides a fresh favorite", async () => {
    mockGetItemInfo.mockImplementation(async (mediaKey: string) => {
      if (mediaKey === "media-current-favorite") {
        return { mediaKey, isFavorite: 1 }
      }
      if (mediaKey === "media-malformed-favorite") {
        return { mediaKey, isFavorite: "false" }
      }
      return { mediaKey }
    })
    const { messages, restore } = collectMessages()
    const dedupKeys = [
      "dedup-current-favorite",
      "dedup-acknowledged-unknown",
      "dedup-malformed-favorite"
    ]
    const mediaKeysToTrash = [
      "media-current-favorite",
      "media-acknowledged-unknown",
      "media-malformed-favorite"
    ]

    sendCommand("trashItems", "req-trash-acknowledged-unknown", {
      dedupKeys,
      mediaKeysToTrash,
      acknowledgedUnknownFavoriteDedupKeys: dedupKeys
    })
    await waitForMessage(messages, "req-trash-acknowledged-unknown")

    expect(mockMoveItemsToTrash).toHaveBeenCalledTimes(1)
    expect(mockMoveItemsToTrash).toHaveBeenCalledWith([
      "dedup-acknowledged-unknown",
      "dedup-malformed-favorite"
    ])
    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === "req-trash-acknowledged-unknown"
    ) as any
    expect(result?.data).toMatchObject({
      trashedDedupKeys: [
        "dedup-acknowledged-unknown",
        "dedup-malformed-favorite"
      ],
      notDispatchedDedupKeys: ["dedup-current-favorite"],
      outcomes: [
        {
          targetKey: "dedup-current-favorite",
          status: "failed",
          reason: "favorite-protected-current-state"
        },
        {
          targetKey: "dedup-acknowledged-unknown",
          status: "confirmed"
        },
        {
          targetKey: "dedup-malformed-favorite",
          status: "confirmed"
        }
      ]
    })
    restore()
  })

  it("rejects a foreign media-key response even when that target is acknowledged", async () => {
    mockGetItemInfo.mockResolvedValue({
      mediaKey: "another-google-item",
      isFavorite: false
    })
    const { messages, restore } = collectMessages()

    sendCommand("trashItems", "req-trash-favorite-alias", {
      dedupKeys: ["dedup-alias-target"],
      mediaKeysToTrash: ["media-alias-target"],
      acknowledgedUnknownFavoriteDedupKeys: ["dedup-alias-target"]
    })
    await waitForMessage(messages, "req-trash-favorite-alias")

    expect(mockMoveItemsToTrash).not.toHaveBeenCalled()
    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === "req-trash-favorite-alias"
    ) as any
    expect(result?.data).toMatchObject({
      notDispatchedDedupKeys: ["dedup-alias-target"],
      outcomes: [
        {
          targetKey: "dedup-alias-target",
          status: "failed",
          reason: "favorite-item-identity-mismatch"
        }
      ]
    })
    restore()
  })

  it("rejects a favorite acknowledgement containing an unrequested target", async () => {
    const { messages, restore } = collectMessages()

    sendCommand("trashItems", "req-trash-foreign-favorite-ack", {
      dedupKeys: ["dedup-requested"],
      mediaKeysToTrash: ["media-requested"],
      acknowledgedUnknownFavoriteDedupKeys: ["dedup-foreign"]
    })
    await waitForMessage(messages, "req-trash-foreign-favorite-ack")

    expect(mockGetItemInfo).not.toHaveBeenCalled()
    expect(mockMoveItemsToTrash).not.toHaveBeenCalled()
    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === "req-trash-foreign-favorite-ack"
    ) as any
    expect(result?.data).toMatchObject({
      notDispatchedDedupKeys: ["dedup-requested"],
      outcomes: [
        {
          targetKey: "dedup-requested",
          status: "failed",
          reason: "invalid-favorite-acknowledgement"
        }
      ]
    })
    restore()
  })

  it("fails closed when favorite lookup rejects, even for an acknowledged key", async () => {
    mockGetItemInfo.mockRejectedValue(new Error("provider lookup failed"))
    const { messages, restore } = collectMessages()

    sendCommand("trashItems", "req-trash-favorite-lookup-error", {
      dedupKeys: ["dedup-lookup-error"],
      mediaKeysToTrash: ["media-lookup-error"],
      acknowledgedUnknownFavoriteDedupKeys: ["dedup-lookup-error"]
    })
    await waitForMessage(messages, "req-trash-favorite-lookup-error")

    expect(mockMoveItemsToTrash).not.toHaveBeenCalled()
    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === "req-trash-favorite-lookup-error"
    ) as any
    expect(result?.data).toMatchObject({
      notDispatchedDedupKeys: ["dedup-lookup-error"],
      outcomes: [
        {
          targetKey: "dedup-lookup-error",
          status: "failed",
          reason: "favorite-lookup-failed"
        }
      ]
    })
    restore()
  })

  it("does not dispatch after the signed-in Google account changes during favorite lookup", async () => {
    mockGetItemInfo.mockImplementation(async (mediaKey: string) => {
      ;(window as any).WIZ_global_data = { oPEP7c: "other@example.com" }
      return { mediaKey, isFavorite: false }
    })
    const { messages, restore } = collectMessages()

    sendCommand("trashItems", "req-trash-favorite-session-drift", {
      dedupKeys: ["dedup-session-drift"],
      mediaKeysToTrash: ["media-session-drift"],
      acknowledgedUnknownFavoriteDedupKeys: ["dedup-session-drift"]
    })
    await waitForMessage(messages, "req-trash-favorite-session-drift")

    expect(mockMoveItemsToTrash).not.toHaveBeenCalled()
    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === "req-trash-favorite-session-drift"
    ) as any
    expect(result?.data).toMatchObject({
      notDispatchedDedupKeys: ["dedup-session-drift"],
      outcomes: [
        {
          targetKey: "dedup-session-drift",
          status: "failed",
          reason: "session-changed-before-dispatch"
        }
      ]
    })
    restore()
  })

  it("times out bounded favorite preflight without dispatching an unresolved item", async () => {
    vi.useFakeTimers()
    mockGetItemInfo.mockImplementation(() => new Promise(() => {}))
    const { messages, restore } = collectMessages()

    sendCommand("trashItems", "req-trash-favorite-lookup-timeout", {
      dedupKeys: ["dedup-lookup-timeout"],
      mediaKeysToTrash: ["media-lookup-timeout"],
      acknowledgedUnknownFavoriteDedupKeys: ["dedup-lookup-timeout"]
    })
    for (
      let attempt = 0;
      attempt < 50 && mockGetItemInfo.mock.calls.length === 0;
      attempt += 1
    ) {
      await yieldOneRealEventLoopTurn()
    }
    expect(mockGetItemInfo).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(15_001)
    await waitForMessage(messages, "req-trash-favorite-lookup-timeout")

    expect(mockMoveItemsToTrash).not.toHaveBeenCalled()
    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === "req-trash-favorite-lookup-timeout"
    ) as any
    expect(result?.data).toMatchObject({
      notDispatchedDedupKeys: ["dedup-lookup-timeout"],
      outcomes: [
        {
          targetKey: "dedup-lookup-timeout",
          status: "failed",
          reason: "favorite-lookup-timeout"
        }
      ]
    })
    restore()
  })

  it("sends a single API call when items fit in one conservative batch (≤ 25)", async () => {
    const { messages, restore } = collectMessages()
    const dedupKeys = Array.from({ length: 20 }, (_, i) => `dk-${i}`)

    sendCommand("trashItems", "req-1", { dedupKeys })
    await waitForMessage(messages, "req-1")

    expect(mockMoveItemsToTrash).toHaveBeenCalledTimes(1)
    expect(mockMoveItemsToTrash).toHaveBeenCalledWith(dedupKeys)

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "trashItems"
    ) as any
    expect(result?.success).toBe(true)
    expect(result?.data?.trashedCount).toBe(20)
    restore()
  })

  it("splits 55 items into 3 chunks: 25 + 25 + 5", async () => {
    const { messages, restore } = collectMessages()
    const dedupKeys = Array.from({ length: 55 }, (_, i) => `dk-${i}`)

    sendCommand("trashItems", "req-2", { dedupKeys })
    await waitForMessage(messages, "req-2")

    expect(mockMoveItemsToTrash).toHaveBeenCalledTimes(3)
    expect(mockMoveItemsToTrash.mock.calls[0][0]).toHaveLength(25)
    expect(mockMoveItemsToTrash.mock.calls[1][0]).toHaveLength(25)
    expect(mockMoveItemsToTrash.mock.calls[2][0]).toHaveLength(5)
    restore()
  })

  it("caps requested trash batch size at 25", async () => {
    const { messages, restore } = collectMessages()
    const dedupKeys = Array.from({ length: 60 }, (_, i) => `dk-${i}`)

    sendCommand("trashItems", "req-2b", {
      dedupKeys,
      batchSize: 250
    })
    await waitForMessage(messages, "req-2b")

    expect(mockMoveItemsToTrash).toHaveBeenCalledTimes(3)
    expect(mockMoveItemsToTrash.mock.calls[0][0]).toHaveLength(25)
    expect(mockMoveItemsToTrash.mock.calls[1][0]).toHaveLength(25)
    expect(mockMoveItemsToTrash.mock.calls[2][0]).toHaveLength(10)
    restore()
  })

  it("posts a progress message after each chunk", async () => {
    const { messages, restore } = collectMessages()
    const dedupKeys = Array.from({ length: 50 }, (_, i) => `dk-${i}`)
    const mediaKeysToTrash = Array.from({ length: 50 }, (_, i) => `mk-${i}`)

    sendCommand("trashItems", "req-3", { dedupKeys, mediaKeysToTrash })
    await waitForMessage(messages, "req-3")

    const progressMsgs = messages.filter(
      (m: any) =>
        m.action === "gptkProgress" &&
        m.command === "trashItems" &&
        m.requestId === "req-3"
    ) as any[]

    // One progress message per chunk (2 chunks for 50 items)
    expect(progressMsgs).toHaveLength(2)
    expect(progressMsgs[0].itemsProcessed).toBe(25)
    expect(progressMsgs[0].data).toMatchObject({
      trashedKeys: mediaKeysToTrash.slice(0, 25),
      trashedDedupKeys: dedupKeys.slice(0, 25)
    })
    expect(progressMsgs[1].itemsProcessed).toBe(50)
    expect(progressMsgs[1].data).toMatchObject({
      trashedKeys: mediaKeysToTrash,
      trashedDedupKeys: dedupKeys
    })
    restore()
  })

  it("does not replay an ambiguous trash batch and reports its exact unknown targets", async () => {
    mockMoveItemsToTrash.mockRejectedValue(new Error("HTTP 504"))

    const { messages, restore } = collectMessages()
    const dedupKeys = Array.from({ length: 20 }, (_, i) => `dk-${i}`)

    sendCommand("trashItems", "req-4", { dedupKeys })
    await waitForMessage(messages, "req-4")

    expect(mockMoveItemsToTrash).toHaveBeenCalledTimes(1)

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "trashItems"
    ) as any
    expect(result?.success).toBe(false)
    expect(result?.data).toMatchObject({
      partial: false,
      trashedCount: 0,
      trashedKeys: [],
      trashedDedupKeys: [],
      unknownDedupKeys: dedupKeys,
      retryAttempts: 0,
      outcomes: dedupKeys.map((targetKey) => ({
        operation: "trash",
        targetKey,
        status: "unknown",
        reason: "post-dispatch-trash-transition-unverified"
      }))
    })
    restore()
  })

  it("classifies an explicit provider rejection as failed without retrying", async () => {
    mockMoveItemsToTrash.mockRejectedValue(new Error("HTTP 403"))

    const { messages, restore } = collectMessages()
    const dedupKeys = Array.from({ length: 20 }, (_, i) => `dk-${i}`)

    sendCommand("trashItems", "req-4-explicit-failure", { dedupKeys })
    await waitForMessage(messages, "req-4-explicit-failure")

    expect(mockMoveItemsToTrash).toHaveBeenCalledTimes(1)
    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "trashItems"
    ) as any
    expect(result?.success).toBe(false)
    expect(result?.data).toMatchObject({
      trashedCount: 0,
      unknownDedupKeys: [],
      retryAttempts: 0,
      outcomes: dedupKeys.map((targetKey) => ({
        operation: "trash",
        targetKey,
        status: "failed",
        reason: "provider-rejected-without-observed-state-change"
      }))
    })
    restore()
  })

  it("uses explicit moved keys from a structured trash response", async () => {
    const dedupKeys = Array.from({ length: 3 }, (_, i) => `dk-${i}`)
    const mediaKeysToTrash = Array.from({ length: 3 }, (_, i) => `mk-${i}`)
    mockMoveItemsToTrash.mockImplementationOnce(async (keys: string[]) => {
      for (const key of keys) {
        googleLibraryKeys.delete(key)
        googleTrashKeys.add(key)
      }
      return { movedDedupKeys: dedupKeys }
    })

    const { messages, restore } = collectMessages()

    sendCommand("trashItems", "req-4-structured", {
      dedupKeys,
      mediaKeysToTrash,
      batchSize: 3
    })
    await waitForMessage(messages, "req-4-structured")

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "trashItems"
    ) as any
    expect(result?.success).toBe(true)
    expect(result?.data).toMatchObject({
      trashedCount: 3,
      trashedKeys: mediaKeysToTrash,
      trashedDedupKeys: dedupKeys
    })
    restore()
  })

  it("fails closed when a structured trash response reports a partial chunk", async () => {
    const dedupKeys = ["dk-0", "dk-1", "dk-2"]
    const mediaKeysToTrash = ["mk-0", "mk-1", "mk-2"]
    mockMoveItemsToTrash.mockImplementationOnce(async (keys: string[]) => {
      for (const key of ["dk-0", "dk-2"]) {
        googleLibraryKeys.delete(key)
        googleTrashKeys.add(key)
      }
      return {
        movedDedupKeys: ["dk-0", "dk-2"],
        failedDedupKeys: ["dk-1"]
      }
    })

    const { messages, restore } = collectMessages()

    sendCommand("trashItems", "req-4-partial", {
      dedupKeys,
      mediaKeysToTrash,
      batchSize: 3
    })
    await waitForMessage(messages, "req-4-partial")

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "trashItems"
    ) as any
    expect(result?.success).toBe(false)
    expect(result?.error).toContain("2 of 3 trash operations")
    expect(result?.data).toMatchObject({
      partial: true,
      trashedCount: 2,
      trashedKeys: ["mk-0", "mk-2"],
      trashedDedupKeys: ["dk-0", "dk-2"],
      unknownDedupKeys: [],
      retryAttempts: 0
    })
    expect(result?.data.outcomes).toEqual([
      { operation: "trash", targetKey: "dk-0", status: "confirmed" },
      {
        operation: "trash",
        targetKey: "dk-1",
        status: "failed",
        reason: "provider-rejected-without-observed-state-change"
      },
      { operation: "trash", targetKey: "dk-2", status: "confirmed" }
    ])
    restore()
  })

  it("reports completed batches when a later batch fails", async () => {
    mockMoveItemsToTrash
      .mockImplementationOnce(async (keys: string[]) => {
        for (const key of keys) {
          googleLibraryKeys.delete(key)
          googleTrashKeys.add(key)
        }
      })
      .mockRejectedValue(new Error("HTTP 504"))

    const { messages, restore } = collectMessages()
    const dedupKeys = Array.from({ length: 40 }, (_, i) => `dk-${i}`)
    const mediaKeysToTrash = Array.from({ length: 40 }, (_, i) => `mk-${i}`)

    sendCommand("trashItems", "req-4b", { dedupKeys, mediaKeysToTrash })
    await waitForMessage(messages, "req-4b")

    expect(mockMoveItemsToTrash).toHaveBeenCalledTimes(2)

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "trashItems"
    ) as any
    expect(result?.success).toBe(false)
    expect(result?.data).toMatchObject({
      partial: true,
      trashedCount: 25,
      trashedKeys: mediaKeysToTrash.slice(0, 25),
      trashedDedupKeys: dedupKeys.slice(0, 25),
      unknownDedupKeys: dedupKeys.slice(25),
      retryAttempts: 0
    })
    restore()
  })

  it("times out and reports completed batches when a later batch hangs", async () => {
    mockMoveItemsToTrash
      .mockImplementationOnce(async (keys: string[]) => {
        for (const key of keys) {
          googleLibraryKeys.delete(key)
          googleTrashKeys.add(key)
        }
      })
      .mockImplementation(() => new Promise(() => {}))

    const { messages, restore } = collectMessages()
    const dedupKeys = Array.from({ length: 40 }, (_, i) => `dk-${i}`)
    const mediaKeysToTrash = Array.from({ length: 40 }, (_, i) => `mk-${i}`)

    sendCommand("trashItems", "req-4c", {
      dedupKeys,
      mediaKeysToTrash,
      chunkTimeoutMs: 10
    })
    await waitForMessage(messages, "req-4c")

    expect(mockMoveItemsToTrash).toHaveBeenCalledTimes(2)

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "trashItems"
    ) as any
    expect(result?.success).toBe(false)
    expect(result?.data).toMatchObject({
      partial: true,
      trashedCount: 25,
      trashedKeys: mediaKeysToTrash.slice(0, 25),
      trashedDedupKeys: dedupKeys.slice(0, 25),
      unknownDedupKeys: dedupKeys.slice(25),
      retryAttempts: 0
    })
    restore()
  })
})

describe("trashItems — argument validation", () => {
  it("rejects missing dedupKeys without calling the API", async () => {
    const { messages, restore } = collectMessages()

    sendCommand("trashItems", "req-trash-invalid-1", {})
    await waitForMessage(messages, "req-trash-invalid-1")

    expect(mockMoveItemsToTrash).not.toHaveBeenCalled()
    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "trashItems"
    ) as any
    expect(result?.success).toBe(false)
    expect(result?.error).toContain("dedupKeys")
    restore()
  })

  it("rejects empty, non-string, and duplicate dedupKeys", async () => {
    const cases = [
      { dedupKeys: [] },
      { dedupKeys: ["dk-1", ""] },
      { dedupKeys: ["dk-1", 123] },
      { dedupKeys: ["dk-1", "dk-1"] }
    ]

    for (const [index, args] of cases.entries()) {
      const { messages, restore } = collectMessages()

      sendCommand("trashItems", `req-trash-invalid-${index + 2}`, args)
      await waitForMessage(messages, `req-trash-invalid-${index + 2}`)

      const result = messages.find(
        (m: any) => m.action === "gptkResult" && m.command === "trashItems"
      ) as any
      expect(result?.success).toBe(false)
      expect(result?.error).toContain("dedupKeys")
      restore()
    }
    expect(mockMoveItemsToTrash).not.toHaveBeenCalled()
  })

  it("rejects mismatched mediaKeysToTrash without calling the API", async () => {
    const { messages, restore } = collectMessages()

    sendCommand("trashItems", "req-trash-invalid-media", {
      dedupKeys: ["dk-1", "dk-2"],
      mediaKeysToTrash: ["mk-1"]
    })
    await waitForMessage(messages, "req-trash-invalid-media")

    expect(mockMoveItemsToTrash).not.toHaveBeenCalled()
    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "trashItems"
    ) as any
    expect(result?.success).toBe(false)
    expect(result?.error).toContain("mediaKeysToTrash")
    restore()
  })

  it("rejects invalid mediaKeysToTrash values without calling the API", async () => {
    const { messages, restore } = collectMessages()

    sendCommand("trashItems", "req-trash-invalid-media-value", {
      dedupKeys: ["dk-1", "dk-2"],
      mediaKeysToTrash: ["mk-1", ""]
    })
    await waitForMessage(messages, "req-trash-invalid-media-value")

    expect(mockMoveItemsToTrash).not.toHaveBeenCalled()
    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "trashItems"
    ) as any
    expect(result?.success).toBe(false)
    expect(result?.error).toContain("mediaKeysToTrash")
    restore()
  })
})

// ============================================================
// Unit tests: restoreItems
// ============================================================

describe("restoreItems — chunking", () => {
  it("sends a single API call for ≤ 250 items", async () => {
    const { messages, restore } = collectMessages()
    const dedupKeys = Array.from({ length: 100 }, (_, i) => `dk-${i}`)

    sendCommand("restoreItems", "req-5", { dedupKeys })
    await waitForMessage(messages, "req-5")

    expect(mockRestoreFromTrash).toHaveBeenCalledTimes(1)
    expect(mockRestoreFromTrash).toHaveBeenCalledWith(dedupKeys)
    restore()
  })

  it("splits 750 items into 3 chunks: 250 + 250 + 250", async () => {
    const { messages, restore } = collectMessages()
    const dedupKeys = Array.from({ length: 750 }, (_, i) => `dk-${i}`)

    sendCommand("restoreItems", "req-6", { dedupKeys })
    await waitForMessage(messages, "req-6")

    expect(mockRestoreFromTrash).toHaveBeenCalledTimes(3)
    for (const call of mockRestoreFromTrash.mock.calls) {
      expect(call[0]).toHaveLength(250)
    }
    restore()
  })

  it("[PARITY-04] posts confirmed restore identities after each chunk", async () => {
    const { messages, restore } = collectMessages()
    const dedupKeys = Array.from({ length: 500 }, (_, i) => `dk-${i}`)

    sendCommand("restoreItems", "req-7", { dedupKeys })
    await waitForMessage(messages, "req-7")

    const progressMsgs = messages.filter(
      (m: any) =>
        m.action === "gptkProgress" &&
        m.command === "restoreItems" &&
        m.requestId === "req-7"
    ) as any[]

    expect(progressMsgs).toHaveLength(2)
    expect(progressMsgs[0].itemsProcessed).toBe(250)
    expect(progressMsgs[1].itemsProcessed).toBe(500)
    expect(progressMsgs[0].data.restoredDedupKeys).toEqual(
      dedupKeys.slice(0, 250)
    )
    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "restoreItems"
    ) as any
    expect(result?.data).toMatchObject({
      restoredCount: dedupKeys.length,
      restoredDedupKeys: dedupKeys
    })
    restore()
  })

  it("[PARITY-04] retains completed chunk identities when a later restore chunk fails", async () => {
    const { messages, restore } = collectMessages()
    const dedupKeys = Array.from({ length: 251 }, (_, i) => `partial-${i}`)
    mockRestoreFromTrash
      .mockImplementationOnce(async (keys: string[]) => {
        for (const key of keys) {
          googleTrashKeys.delete(key)
          googleLibraryKeys.add(key)
        }
      })
      .mockRejectedValueOnce(new Error("HTTP 504 on second restore chunk"))

    sendCommand("restoreItems", "req-restore-partial", { dedupKeys })
    await waitForMessage(messages, "req-restore-partial")

    const result = messages.find(
      (m: any) =>
        m.action === "gptkResult" &&
        m.command === "restoreItems" &&
        m.requestId === "req-restore-partial"
    ) as any
    expect(result).toMatchObject({
      success: false,
      data: {
        partial: true,
        restoredCount: 250,
        restoredDedupKeys: dedupKeys.slice(0, 250)
      }
    })
    restore()
  })

  it("does not confirm a resolved restore promise without the exact Trash-to-library transition", async () => {
    mockRestoreFromTrash.mockImplementationOnce(async () => undefined)
    const { messages, restore } = collectMessages()
    const dedupKeys = ["restore-no-transition"]

    sendCommand("restoreItems", "req-restore-no-transition", { dedupKeys })
    await waitForMessage(messages, "req-restore-no-transition")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "restoreItems" &&
        message.requestId === "req-restore-no-transition"
    ) as any
    expect(mockRestoreFromTrash).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      success: false,
      data: {
        restoredDedupKeys: [],
        unknownDedupKeys: dedupKeys,
        outcomes: [
          {
            operation: "restore",
            targetKey: dedupKeys[0],
            status: "unknown",
            reason: "post-dispatch-library-and-trash-state-unverified"
          }
        ]
      }
    })
    restore()
  })

  it("distinguishes an already-restored library item without dispatching Restore", async () => {
    const { messages, restore } = collectMessages()
    googleLibraryKeys.add("already-restored")

    sendCommand(
      "restoreItems",
      "req-restore-already-restored",
      { dedupKeys: ["already-restored"] },
      false
    )
    await waitForMessage(messages, "req-restore-already-restored")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "restoreItems" &&
        message.requestId === "req-restore-already-restored"
    ) as any
    expect(mockRestoreFromTrash).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      success: false,
      data: {
        restoredDedupKeys: [],
        noOpDedupKeys: ["already-restored"],
        outcomes: [
          {
            operation: "restore",
            targetKey: "already-restored",
            status: "failed",
            reason: "already-restored-noop"
          }
        ]
      }
    })
    restore()
  })

  it("marks dispatched restores unknown after an account switch before readback", async () => {
    mockRestoreFromTrash.mockImplementationOnce(async (keys: string[]) => {
      for (const key of keys) {
        googleTrashKeys.delete(key)
        googleLibraryKeys.add(key)
      }
      ;(window as any).WIZ_global_data.oPEP7c = "other@example.com"
    })
    const { messages, restore } = collectMessages()
    const dedupKeys = Array.from({ length: 251 }, (_, index) => `session-${index}`)

    sendCommand("restoreItems", "req-restore-session-switch", { dedupKeys })
    await waitForMessage(messages, "req-restore-session-switch")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "restoreItems" &&
        message.requestId === "req-restore-session-switch"
    ) as any
    expect(mockRestoreFromTrash).toHaveBeenCalledTimes(1)
    expect(result?.success).toBe(false)
    expect(result?.data.restoredDedupKeys).toEqual([])
    expect(result?.data.unknownDedupKeys).toEqual(dedupKeys.slice(0, 250))
    expect(result?.data.outcomes[0]).toMatchObject({
      operation: "restore",
      targetKey: "session-0",
      status: "unknown",
      reason: "session-changed-after-dispatch"
    })
    expect(result?.data.outcomes[250]).toMatchObject({
      operation: "restore",
      targetKey: "session-250",
      status: "failed",
      reason: "not-dispatched-after-session-change"
    })
    restore()
  })

  it("fails closed on incomplete Trash preflight without calling Restore", async () => {
    mockGetTrashItems.mockResolvedValueOnce({ items: null, nextPageId: null })
    const { messages, restore } = collectMessages()

    sendCommand("restoreItems", "req-restore-invalid-trash-page", {
      dedupKeys: ["preflight-invalid"]
    })
    await waitForMessage(messages, "req-restore-invalid-trash-page")

    const result = messages.find(
      (message: any) =>
        message.action === "gptkResult" &&
        message.command === "restoreItems" &&
        message.requestId === "req-restore-invalid-trash-page"
    ) as any
    expect(mockRestoreFromTrash).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      success: false,
      data: {
        unknownDedupKeys: [],
        outcomes: [
          {
            operation: "restore",
            targetKey: "preflight-invalid",
            status: "failed",
            reason: "preflight-trash-state-unavailable"
          }
        ]
      }
    })
    restore()
  })
})

describe("restoreItems — argument validation", () => {
  it("rejects missing dedupKeys without calling the API", async () => {
    const { messages, restore } = collectMessages()

    sendCommand("restoreItems", "req-restore-invalid-1", {})
    await waitForMessage(messages, "req-restore-invalid-1")

    expect(mockRestoreFromTrash).not.toHaveBeenCalled()
    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "restoreItems"
    ) as any
    expect(result?.success).toBe(false)
    expect(result?.error).toContain("dedupKeys")
    restore()
  })

  it("rejects empty, non-string, and duplicate dedupKeys", async () => {
    const cases = [
      { dedupKeys: [] },
      { dedupKeys: ["dk-1", ""] },
      { dedupKeys: ["dk-1", 123] },
      { dedupKeys: ["dk-1", "dk-1"] }
    ]

    for (const [index, args] of cases.entries()) {
      const { messages, restore } = collectMessages()

      sendCommand("restoreItems", `req-restore-invalid-${index + 2}`, args)
      await waitForMessage(messages, `req-restore-invalid-${index + 2}`)

      const result = messages.find(
        (m: any) => m.action === "gptkResult" && m.command === "restoreItems"
      ) as any
      expect(result?.success).toBe(false)
      expect(result?.error).toContain("dedupKeys")
      restore()
    }
    expect(mockRestoreFromTrash).not.toHaveBeenCalled()
  })
})

// ============================================================
// Integration test: full trash flow with a realistic large batch
// ============================================================

describe("integration: trashItems full flow", () => {
  it("chunks 110 items into 5 conservative batches, reports progress, and returns correct result", async () => {
    const { messages, restore } = collectMessages()

    const total = 110
    const dedupKeys = Array.from({ length: total }, (_, i) => `dedup-${i}`)
    const mediaKeysToTrash = Array.from(
      { length: total },
      (_, i) => `media-${i}`
    )

    sendCommand("trashItems", "req-int-1", { dedupKeys, mediaKeysToTrash })
    await waitForMessage(messages, "req-int-1")

    // 110 / 25 = 4 full chunks + 1 remainder of 10 → 5 calls
    expect(mockMoveItemsToTrash).toHaveBeenCalledTimes(5)
    expect(mockMoveItemsToTrash.mock.calls[0][0]).toHaveLength(25)
    expect(mockMoveItemsToTrash.mock.calls[1][0]).toHaveLength(25)
    expect(mockMoveItemsToTrash.mock.calls[2][0]).toHaveLength(25)
    expect(mockMoveItemsToTrash.mock.calls[3][0]).toHaveLength(25)
    expect(mockMoveItemsToTrash.mock.calls[4][0]).toHaveLength(10)

    // Keys are passed in order and cover the full set
    const allSentKeys = mockMoveItemsToTrash.mock.calls.flatMap((c) => c[0])
    expect(allSentKeys).toEqual(dedupKeys)

    // 5 progress messages, monotonically increasing
    const progressMsgs = messages.filter(
      (m: any) => m.action === "gptkProgress" && m.command === "trashItems"
    ) as any[]
    expect(progressMsgs).toHaveLength(5)
    expect(progressMsgs.map((p: any) => p.itemsProcessed)).toEqual([
      25, 50, 75, 100, 110
    ])

    // Final result message
    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "trashItems"
    ) as any
    expect(result?.success).toBe(true)
    expect(result?.data?.trashedCount).toBe(total)
    expect(result?.data?.trashedKeys).toEqual(mediaKeysToTrash)

    restore()
  })
})

// ============================================================
// getAllMediaItems — per-page timeout (PR #122)
//
// Google's pagination endpoint occasionally hangs without ever rejecting
// fetch(), which used to lock the UI on "Fetching media items" forever.
// withTimeout() races each page against a short timer so a stall surfaces as a
// real error instead of an indefinite hang.
// ============================================================

describe("getAllMediaItems — page timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as any).gptkApi
  })

  it("surfaces a timeout error when a page fetch never resolves", async () => {
    ;(window as any).gptkApi = {
      // Never resolves — simulates Google's pagination endpoint hanging.
      getItemsByUploadedDate: vi.fn(() => new Promise(() => {}))
    }

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-timeout-1", {})
    const getItemsByUploadedDate = (window as any).gptkApi
      .getItemsByUploadedDate as ReturnType<typeof vi.fn>
    for (
      let attempt = 0;
      attempt < 50 && getItemsByUploadedDate.mock.calls.length === 0;
      attempt += 1
    ) {
      await yieldOneRealEventLoopTurn()
    }
    expect(getItemsByUploadedDate).toHaveBeenCalledTimes(1)

    // Advance past all page timeout retries to trip the withTimeout race.
    await vi.advanceTimersByTimeAsync(65_000)
    await waitForMessage(messages, "req-timeout-1")

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "getAllMediaItems"
    ) as any
    expect(result?.success).toBe(false)
    expect(result?.error).toMatch(/timed out/i)
    expect((window as any).gptkApi.getItemsByUploadedDate).toHaveBeenCalledTimes(
      3
    )
    restore()
  })

  it("does not error when the page resolves before the timeout fires", async () => {
    ;(window as any).gptkApi = {
      getItemsByUploadedDate: vi
        .fn()
        .mockResolvedValue({ items: [], nextPageId: null })
    }

    const { messages, restore } = collectMessages()
    sendCommand("getAllMediaItems", "req-timeout-2", {})
    await yieldOneRealEventLoopTurn()

    // Flush microtasks (no real delay needed — the page resolves immediately).
    await vi.advanceTimersByTimeAsync(0)
    await waitForMessage(messages, "req-timeout-2")

    const result = messages.find(
      (m: any) => m.action === "gptkResult" && m.command === "getAllMediaItems"
    ) as any
    expect(result?.success).toBe(true)
    restore()
  })
})
