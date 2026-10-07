/**
 * Tests for scripts/amazon-photos-commands.js.
 *
 * @vitest-environment happy-dom
 * @vitest-environment-options {"url":"https://www.amazon.ca/photos?sf=1"}
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import fc from "fast-check"
import { mergeCachedScanResults } from "../../lib/scan-results"
import {
  providerParityFixtureTimestamp,
  providerParityMixedMediaDatesV3
} from "../fixtures/provider-parity-mixed-media-dates-v3"

const realSetTimeout = globalThis.setTimeout.bind(globalThis)

let amazonTestSessionId = ""

beforeAll(async () => {
  ;(window as any).__GPD_COMMAND_TEST_MODE__ = true
  const providerUrl = window.location.href
  ;(window as any).happyDOM.setURL("about:blank")
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await import("../../scripts/photo-provider-command-host.js")
  ;(window as any).happyDOM.setURL(providerUrl)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await import("../../scripts/amazon-photos-commands.js")
})

describe("Amazon regional host contract", () => {
  it("accepts every supported locale and maps bare hosts to regional thumbnails", () => {
    const api = (window as any).__GPD_AMAZON_COMMAND_TEST_API__ as {
      isAmazonPhotosHost: (hostname: string) => boolean
      isAmazonPhotosLocation: (locationLike: {
        hostname: string
        pathname: string
      }) => boolean
      amazonThumbnailOrigin: (locationLike: {
        protocol: string
        hostname: string
        port: string
      }) => string
    }
    const hosts = [
      "amazon.com",
      "amazon.ca",
      "amazon.co.uk",
      "amazon.de",
      "amazon.fr",
      "amazon.it",
      "amazon.es",
      "amazon.co.jp",
      "amazon.com.au",
      "amazon.in",
      "amazon.com.br",
      "amazon.com.mx",
      "amazon.nl",
      "amazon.sg",
      "amazon.ae",
      "amazon.sa",
      "amazon.se",
      "amazon.pl",
      "amazon.com.tr",
      "amazon.com.be",
      "amazon.eg",
      "amazon.ie"
    ]

    for (const hostname of hosts) {
      expect(api.isAmazonPhotosHost(hostname)).toBe(true)
      expect(api.isAmazonPhotosHost(`www.${hostname}`)).toBe(true)
      expect(
        api.isAmazonPhotosLocation({ hostname, pathname: "/photos" })
      ).toBe(true)
      expect(
        api.amazonThumbnailOrigin({
          protocol: "https:",
          hostname: `www.${hostname}`,
          port: ""
        })
      ).toBe(`https://thumbnails-photos.${hostname}`)
    }
    expect(api.isAmazonPhotosHost("amazon.be")).toBe(false)
    expect(api.isAmazonPhotosHost("amazon.co.za")).toBe(false)
  })

  it("fails closed when a regional marketplace returns a 404 page", async () => {
    const { messages, restore } = collectMessages()
    const originalTitle = document.title
    const originalBody = document.body.innerHTML
    document.title = "Page Not Found"
    document.body.innerHTML =
      "Looking for something? The Web address you entered is not a functioning page."

    sendCommand("healthCheck", "amazon-regional-404", {})
    await flush()

    const result = messages.find(
      (msg) =>
        msg.action === "gptkResult" &&
        msg.command === "healthCheck" &&
        msg.requestId === "amazon-regional-404"
    )
    expect(result?.data?.hasGptk).toBe(false)
    document.title = originalTitle
    document.body.innerHTML = originalBody
    restore()
  })

  it("reports an unavailable health probe when Amazon requires sign-in", async () => {
    const { messages, restore } = collectMessages()
    const originalTitle = document.title
    const originalBody = document.body.innerHTML
    document.title = "Amazon Sign In"
    document.body.innerHTML =
      '<main><h1>Sign in</h1><button>Sign in</button></main>'

    try {
      sendCommand("healthCheck", "amazon-auth-expired", {})
      await flush()

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "healthCheck" &&
          msg.requestId === "amazon-auth-expired"
      )
      expect(result).toMatchObject({
        success: true,
        data: {
          hasGptk: false,
          health: {
            schemaVersion: 1,
            contractVersion: "provider-parity-v1",
            provider: "amazon",
            status: "unavailable",
            checks: { page: false, readPath: false }
          }
        }
      })
    } finally {
      document.title = originalTitle
      document.body.innerHTML = originalBody
      restore()
    }
  })
})

describe("Amazon provider identity binding", () => {
  it("binds health to the private owner marker and rejects an older session after an account switch", async () => {
    const { messages, restore } = collectMessages()
    const originalBody = document.body.innerHTML
    document.body.innerHTML =
      '<header id="primary-header"><button class="expandable-nav user-settings-menu toggle">Pawsitive Games</button></header>'
    let ownerId = "owner-a"
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 1,
            data: [{ id: "photo-1", ownerId }]
          })
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    try {
      sendCommand("healthCheck", "amazon-owner-a", {})
      await flushProviderWork()
      const firstHealth = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "healthCheck" &&
          msg.requestId === "amazon-owner-a"
      )
      expect(firstHealth).toMatchObject({
        success: true,
        data: {
          hasGptk: true,
          accountDisplayName: "Pawsitive Games"
        },
        providerSessionId: expect.any(String)
      })
      const identityProbeUrl = new URL(String(fetchMock.mock.calls[0][0]))
      expect(identityProbeUrl.searchParams.get("limit")).toBe("1")
      const firstSessionId = firstHealth.providerSessionId
      expect(firstSessionId).not.toContain("Pawsitive Games")

      ownerId = "owner-b"
      sendCommand("healthCheck", "amazon-owner-b", {})
      await flushProviderWork()
      const secondHealth = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "healthCheck" &&
          msg.requestId === "amazon-owner-b"
      )
      expect(secondHealth).toMatchObject({
        success: true,
        data: { hasGptk: true },
        providerSessionId: expect.any(String)
      })
      expect(secondHealth.providerSessionId).not.toBe(firstSessionId)

      sendCommand("getAllMediaItems", "amazon-old-session", {
        providerSessionId: firstSessionId
      })
      await flushProviderWork()
      const staleResult = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "getAllMediaItems" &&
          msg.requestId === "amazon-old-session"
      )
      expect(staleResult).toMatchObject({
        success: false,
        error: expect.stringMatching(/account changed/i)
      })
    } finally {
      document.body.innerHTML = originalBody
      restore()
    }
  })

  it("omits an ambiguous Amazon profile name while keeping session health usable", async () => {
    const { messages, restore } = collectMessages()
    const originalBody = document.body.innerHTML
    document.body.innerHTML =
      '<header id="primary-header"><button class="user-settings-menu">Pawsitive Games</button><button class="user-settings-menu">Other Profile</button></header>'
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          count: 1,
          data: [{ id: "photo-1", ownerId: "owner-a" }]
        })
      })
    )

    try {
      sendCommand("healthCheck", "amazon-ambiguous-profile", {})
      await flushProviderWork()
      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "healthCheck" &&
          msg.requestId === "amazon-ambiguous-profile"
      )
      expect(result).toMatchObject({
        success: true,
        data: { hasGptk: true },
        providerSessionId: expect.any(String)
      })
      expect(result.data.accountDisplayName).toBeUndefined()
    } finally {
      document.body.innerHTML = originalBody
      restore()
    }
  })

  it("keeps a signed-in empty library usable with a hashed session-cookie marker", async () => {
    const { messages, restore } = collectMessages()
    const originalCookie = document.cookie
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ count: 0, data: [] })
    })
    vi.stubGlobal("fetch", fetchMock)
    document.cookie = "session-id=empty-library-session; path=/"

    try {
      sendCommand("healthCheck", "amazon-empty-library", {})
      await flushProviderWork()
      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "healthCheck" &&
          msg.requestId === "amazon-empty-library"
      )
      expect(result).toMatchObject({
        success: true,
        data: { hasGptk: true },
        providerSessionId: expect.any(String)
      })
      expect(
        fetchMock.mock.calls.map(([url]) =>
          new URL(String(url)).searchParams.get("limit")
        )
      ).toEqual(["1", "1"])
    } finally {
      document.cookie = originalCookie
      restore()
    }
  })
})

beforeEach(async () => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
  amazonTestSessionId = await (window as any).__GPD_COMMAND_HOST__.setProviderIdentity(
    "owner-1"
  )
})

function sendCommand(command: string, requestId: string, args: unknown) {
  let commandArgs = args
  if (command === "trashItems" || command === "restoreItems") {
    const sourceArgs =
      args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {}
    const withSession = {
      ...sourceArgs,
      providerSessionId: sourceArgs.providerSessionId || amazonTestSessionId
    }
    commandArgs = withSession
  } else if (command === "getAllMediaItems") {
    const sourceArgs =
      args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {}
    commandArgs = {
      ...sourceArgs,
      scanScopeFingerprint:
        sourceArgs.scanScopeFingerprint || "amazon-command-test-scope"
    }
  }
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: { app: "GPD", action: "gptkCommand", command, requestId, args: commandArgs }
    })
  )
}

function sendAmazonProviderCommand(
  command: string,
  requestId: string,
  args: unknown
) {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        app: "GPD",
        action: "gptkCommand",
        provider: "amazon",
        command,
        requestId,
        args
      }
    })
  )
}

function collectMessages(): { messages: any[]; restore: () => void } {
  const messages: any[] = []
  const spy = vi.spyOn(window, "postMessage").mockImplementation((msg) => {
    messages.push(msg)
  })
  return { messages, restore: () => spy.mockRestore() }
}

async function waitForCommandResult(
  messages: any[],
  command: string,
  requestId: string
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === command &&
        message.requestId === requestId
    )
    if (result) return result
    await new Promise((resolve) => realSetTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for Amazon ${command} result (${requestId})`)
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function flushProviderWork() {
  for (let attempt = 0; attempt < 6; attempt += 1) await flush()
}

function stubAmazonMutationProvider(options: {
  initialTrash?: string[]
  favorites?: Record<string, boolean | undefined>
  ownerId?: string
  applyPatch?: (operation: string, ids: string[], trash: Set<string>) => void
  patchStatus?: number
  switchOwnerAfterPatch?: boolean
  invalidTrashRead?: boolean
} = {}) {
  let currentOwnerId = options.ownerId || "owner-1"
  const trash = new Set(options.initialTrash || [])
  const favorites = options.favorites || {}
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const method = init?.method || "GET"
      if (url.pathname === "/drive/v1/search" && method === "GET") {
        return {
          ok: true,
          json: async () => ({
            count: 1,
            data: [{ id: "identity-probe", ownerId: currentOwnerId }]
          })
        }
      }
      if (url.pathname === "/drive/v1/trash" && method === "GET") {
        const data = [...trash].map((id) => ({ id }))
        return {
          ok: true,
          json: async () =>
            options.invalidTrashRead
              ? { count: data.length + 1, data }
              : { count: data.length, data }
        }
      }
      if (url.pathname === "/drive/v1/trash" && method === "PATCH") {
        const payload = JSON.parse(String(init?.body || "{}"))
        const ids = Array.isArray(payload.value) ? payload.value : []
        if (options.patchStatus) {
          return {
            ok: false,
            status: options.patchStatus,
            headers: { get: () => null },
            text: async () => "provider rejection"
          }
        }
        if (options.applyPatch) {
          options.applyPatch(payload.op, ids, trash)
        } else if (payload.op === "add") {
          ids.forEach((id: string) => trash.add(id))
        } else if (payload.op === "remove") {
          ids.forEach((id: string) => trash.delete(id))
        }
        if (options.switchOwnerAfterPatch) currentOwnerId = "owner-after-switch"
        return { ok: true, text: async () => "{}" }
      }
      const nodeMatch = url.pathname.match(/^\/drive\/v1\/nodes\/([^/]+)$/)
      if (nodeMatch && method === "GET") {
        const id = decodeURIComponent(nodeMatch[1])
        return {
          ok: true,
          json: async () => ({
            id,
            ownerId: currentOwnerId,
            isShared: false,
            settings: {
              ...(favorites[id] === undefined ? {} : { favorite: favorites[id] })
            },
            contentProperties: { contentType: "image/jpeg", size: 12 }
          })
        }
      }
      throw new Error(`Unexpected Amazon test request: ${method} ${url.pathname}`)
    }
  )
  vi.stubGlobal("fetch", fetchMock)
  return { fetchMock, trash }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

function amazonAlbumNode(id: string, isShared = false) {
  return {
    id,
    ownerId: "owner-1",
    name: `Album ${id}`,
    kind: "VISUAL_COLLECTION",
    isShared
  }
}

describe("Amazon album listing capability", () => {
  it("[PARITY-03] lists complete personal albums and omits shared albums", async () => {
    const { messages, restore } = collectMessages()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          count: 2,
          data: [
            amazonAlbumNode("personal-1"),
            amazonAlbumNode("shared-1", true)
          ]
        })
    })
    vi.stubGlobal("fetch", fetchMock)
    try {
      sendCommand("listAlbums", "amazon-albums-personal", {})
      await flush()

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "listAlbums" &&
          msg.requestId === "amazon-albums-personal"
      )
      expect(result).toMatchObject({
        success: true,
        data: [
          {
            mediaKey: "amazon-album-personal-1",
            title: "Album personal-1",
            isShared: false
          }
        ]
      })
      const requestUrl = new URL(fetchMock.mock.calls[0][0] as URL)
      expect(requestUrl.pathname).toBe("/drive/v1/nodes")
      expect(requestUrl.searchParams.get("filters")).toBe(
        "kind:VISUAL_COLLECTION"
      )
      expect(requestUrl.searchParams.get("limit")).toBe("200")
      expect(requestUrl.searchParams.get("offset")).toBe("0")
    } finally {
      restore()
    }
  })

  it("[PARITY-03] rejects an incomplete album list instead of reporting no albums", async () => {
    const { messages, restore } = collectMessages()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ count: 2, data: [amazonAlbumNode("only-one")] })
      })
    )
    try {
      sendCommand("listAlbums", "amazon-albums-incomplete", {})
      await flush()
      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "listAlbums" &&
          msg.requestId === "amazon-albums-incomplete"
      )
      expect(result).toMatchObject({
        success: false,
        error: expect.stringMatching(
          /pagination ended before its reported count/i
        )
      })
      expect(result?.data).toBeUndefined()
    } finally {
      restore()
    }
  })

  it("follows continuation tokens while listing personal albums", async () => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 2,
            data: [amazonAlbumNode("album-page-1")],
            nextToken: "album-page-2"
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ count: 2, data: [amazonAlbumNode("album-page-2")] })
      })
    vi.stubGlobal("fetch", fetchMock)

    try {
      sendCommand("listAlbums", "amazon-albums-token", {})
      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(1000)
      await flushMicrotasks()

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "listAlbums" &&
          msg.requestId === "amazon-albums-token"
      )
      const continuationUrl = new URL(fetchMock.mock.calls[1][0] as URL)
      expect(continuationUrl.searchParams.get("startToken")).toBe(
        "album-page-2"
      )
      expect(continuationUrl.searchParams.has("offset")).toBe(false)
      expect(result).toMatchObject({
        success: true,
        data: [
          {
            mediaKey: "amazon-album-album-page-1",
            title: "Album album-page-1",
            isShared: false
          },
          {
            mediaKey: "amazon-album-album-page-2",
            title: "Album album-page-2",
            isShared: false
          }
        ]
      })
    } finally {
      restore()
      vi.useRealTimers()
    }
  })

  it("fails closed when a full album page has no continuation token", async () => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 201,
            data: Array.from({ length: 200 }, (_, index) =>
              amazonAlbumNode(`missing-token-${index}`)
            )
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 201,
            data: [amazonAlbumNode("unverified-offset-page")]
          })
      })
    vi.stubGlobal("fetch", fetchMock)

    try {
      sendCommand("listAlbums", "amazon-albums-missing-token", {})
      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(1000)
      await flushMicrotasks()

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "listAlbums" &&
          msg.requestId === "amazon-albums-missing-token"
      )
      expect(result).toMatchObject({
        success: false,
        error: expect.stringMatching(
          /album pagination ended before its reported count/i
        )
      })
      expect(result?.data).toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      restore()
      vi.useRealTimers()
    }
  })

  it.each([
    {
      scenario: "a repeated continuation token",
      pages: [
        {
          count: 3,
          data: [amazonAlbumNode("repeat-token-1")],
          nextToken: "album-page-loop"
        },
        {
          count: 3,
          data: [amazonAlbumNode("repeat-token-2")],
          nextToken: "album-page-loop"
        }
      ],
      error: /repeated an album pagination token/i
    },
    {
      scenario: "a changing provider count",
      pages: [
        {
          count: 3,
          data: [amazonAlbumNode("changed-count-1")],
          nextToken: "album-page-2"
        },
        {
          count: 4,
          data: [amazonAlbumNode("changed-count-2")]
        }
      ],
      error: /album count changed during pagination/i
    },
    {
      scenario: "an album ID repeated across pages",
      pages: [
        {
          count: 3,
          data: [amazonAlbumNode("overlap-1")],
          nextToken: "album-page-2"
        },
        {
          count: 3,
          data: [amazonAlbumNode("overlap-1"), amazonAlbumNode("overlap-2")]
        }
      ],
      error: /album with an invalid schema/i
    }
  ])("rejects $scenario instead of completing an album list", async ({
    pages,
    error
  }) => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const fetchMock = vi.fn()
    for (const page of pages) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(page)
      })
    }
    vi.stubGlobal("fetch", fetchMock)

    try {
      sendCommand("listAlbums", "amazon-albums-invalid-page", {})
      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(1000)
      await flushMicrotasks()

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "listAlbums" &&
          msg.requestId === "amazon-albums-invalid-page"
      )
      expect(result).toMatchObject({
        success: false,
        error: expect.stringMatching(error)
      })
      expect(result?.data).toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      restore()
      vi.useRealTimers()
    }
  })
})

function amazonNode(id: string) {
  return {
    id,
    ownerId: "owner-1",
    settings: { favorite: false },
    name: `${id}.jpg`,
    createdDate: "2026-06-28T12:00:00.000Z",
    contentProperties: {
      contentType: "image/jpeg",
      contentDate: "2026-06-28T12:00:00.000Z"
    },
    image: {
      width: 1200,
      height: 800
    }
  }
}

function amazonNodeWithCreatedDate(id: string, createdDate: string) {
  return {
    ...amazonNode(id),
    createdDate,
    contentProperties: {
      ...amazonNode(id).contentProperties,
      contentDate: createdDate
    }
  }
}

function amazonPageRequestCalls(fetchMock: any) {
  return fetchMock.mock.calls.filter(([input]: [RequestInfo | URL]) => {
    const pathname = new URL(String(input)).pathname
    return (
      pathname === "/drive/v1/search" ||
      pathname === "/drive/v1/nodes" ||
      pathname.endsWith("/children") ||
      pathname === "/drive/v1/trash"
    )
  })
}

function amazonVideoNode(id: string) {
  return {
    id,
    ownerId: "owner-1",
    isShared: false,
    name: `${id}.mp4`,
    createdDate: "2026-06-28T12:00:00.000Z",
    contentProperties: {
      contentType: "video/mp4",
      contentDate: "2026-06-28T12:00:00.000Z",
      md5: "abcdef0123456789abcdef0123456789",
      size: 123456,
      video: {
        width: 1920,
        height: 1080,
        durationMillis: 12345
      }
    }
  }
}

async function stubAmazonOriginalProvider(scopeFingerprint: string) {
  const mediaId = "controlled-original"
  const mediaKey = `amazon-${mediaId}`
  const bytes = new TextEncoder().encode("ABCD")
  let ownerId = "owner-1"
  let checksum = createHash("md5").update(bytes).digest("hex")
  const node = () => ({
    ...amazonNode(mediaId), kind: "FILE", isShared: false, ownerId,
    contentProperties: { contentType: "image/jpeg", size: bytes.byteLength, md5: checksum }
  })
  let download = async (_signal?: AbortSignal): Promise<any> => new Response(bytes.slice(), {
    status: 200, headers: { "content-type": "image/jpeg", "content-length": String(bytes.byteLength) }
  })
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<any> => {
    const url = new URL(String(input))
    if (url.pathname === "/drive/v1/search") {
      return { ok: true, json: async () => url.searchParams.get("limit") === "1"
        ? { count: 1, data: [{ id: "owner-probe", ownerId }] }
        : { count: 1, data: [node()] }
      }
    }
    if (url.pathname === `/drive/v1/nodes/${mediaId}`) return { ok: true, json: async () => node() }
    if (url.hostname === "download-photos.amazon.ca") return download(init?.signal as AbortSignal | undefined)
    throw new Error(`Unexpected controlled route ${url.pathname}`)
  })
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async (_algorithm: string, data: ArrayBuffer) =>
    Uint8Array.from(createHash("sha256").update(Buffer.from(data)).digest()).buffer
  ) } })
  const { messages, restore } = collectMessages()
  sendAmazonProviderCommand("getAllMediaItems", `controlled-scan-${scopeFingerprint}`, {
    providerSessionId: amazonTestSessionId, scanScopeFingerprint: scopeFingerprint
  })
  const scan = await waitForCommandResult(messages, "getAllMediaItems", `controlled-scan-${scopeFingerprint}`)
  expect(scan).toMatchObject({ success: true, data: [{ mediaKey }], scanCoverage: { status: "complete" } })
  return {
    messages, restore, bytes, fetchMock, mediaKey,
    setDownload: (reader: typeof download) => { download = reader },
    changeOwner: () => { ownerId = "other-owner" },
    changeChecksum: () => { checksum = createHash("md5").update("WXYZ").digest("hex") },
    hash: async (requestId: string) => {
      sendAmazonProviderCommand("getOriginalContentHash", requestId, {
        requestId, mediaKey, userOptIn: true, providerSessionId: amazonTestSessionId,
        scanScopeFingerprint: scopeFingerprint, maxBytes: bytes.byteLength, aggregateBudgetBytes: bytes.byteLength * 10
      })
      return waitForCommandResult(messages, "getOriginalContentHash", requestId)
    }
  }
}

describe("Amazon getAllMediaItems", () => {
  it("[PARITY-03] scans a validated personal album through its child pages", async () => {
    const { messages, restore } = collectMessages()
    const albumMediaNode = {
      ...amazonNode("album-photo"),
      kind: "FILE",
      image: undefined,
      contentProperties: {
        ...amazonNode("album-photo").contentProperties,
        image: { width: 640, height: 480 }
      }
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ count: 1, data: [amazonAlbumNode("personal-1")] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 1, data: [albumMediaNode] })
      })
    vi.stubGlobal("fetch", fetchMock)

    try {
      sendCommand("getAllMediaItems", "amazon-album-scan", {
        albumScope: {
          mediaKey: "amazon-album-personal-1",
          title: "Personal album"
        }
      })
      await flush()

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "getAllMediaItems" &&
          msg.requestId === "amazon-album-scan"
      )
      const pageCalls = amazonPageRequestCalls(fetchMock)
      expect(pageCalls).toHaveLength(2)
      expect(new URL(pageCalls[0][0] as URL).pathname).toBe(
        "/drive/v1/nodes"
      )
      const childUrl = new URL(pageCalls[1][0] as URL)
      expect(childUrl.pathname).toBe("/drive/v1/nodes/personal-1/children")
      expect(result).toMatchObject({
        success: true,
        data: [
          expect.objectContaining({
            mediaKey: "amazon-album-photo",
            provider: "amazon",
            resWidth: 640,
            resHeight: 480
          })
        ],
        scanCoverage: {
          status: "complete",
          stopReason: "exhausted",
          itemsVisited: 1,
          itemsReturned: 1,
          itemsSkipped: 0,
          totalItems: 1
        }
      })
    } finally {
      restore()
    }
  })

  it("follows Amazon continuation tokens when an album page provides one", async () => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const firstMediaNode = {
      ...amazonNode("album-token-photo-1"),
      kind: "FILE"
    }
    const secondMediaNode = {
      ...amazonNode("album-token-photo-2"),
      kind: "FILE"
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ count: 1, data: [amazonAlbumNode("token-1")] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 2,
            data: [firstMediaNode],
            nextToken: "album-token-2"
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 2, data: [secondMediaNode] })
      })
    vi.stubGlobal("fetch", fetchMock)

    try {
      sendCommand("getAllMediaItems", "amazon-album-token", {
        albumScope: { mediaKey: "amazon-album-token-1" }
      })
      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(1000)
      await flushMicrotasks()

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "getAllMediaItems" &&
          msg.requestId === "amazon-album-token"
      )
      const continuationUrl = new URL(amazonPageRequestCalls(fetchMock)[2][0] as URL)
      expect(continuationUrl.searchParams.get("startToken")).toBe(
        "album-token-2"
      )
      expect(continuationUrl.searchParams.has("offset")).toBe(false)
      expect(result).toMatchObject({
        success: true,
        scanCoverage: {
          status: "complete",
          stopReason: "exhausted",
          itemsVisited: 2,
          itemsReturned: 2,
          itemsSkipped: 0,
          totalItems: 2
        }
      })
    } finally {
      restore()
      vi.useRealTimers()
    }
  })

  it("uses a search continuation token before falling back to offsets", async () => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 2,
            data: [amazonNode("search-token-1")],
            next_page_token: "search-token-2"
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 2, data: [amazonNode("search-token-2")] })
      })
    vi.stubGlobal("fetch", fetchMock)

    try {
      sendCommand("getAllMediaItems", "amazon-search-token", {})
      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(1000)
      await flushMicrotasks()

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "getAllMediaItems" &&
          msg.requestId === "amazon-search-token"
      )
      const continuationUrl = new URL(amazonPageRequestCalls(fetchMock)[1][0] as URL)
      expect(continuationUrl.searchParams.get("startToken")).toBe(
        "search-token-2"
      )
      expect(continuationUrl.searchParams.has("offset")).toBe(false)
      expect(result).toMatchObject({
        success: true,
        data: [
          expect.objectContaining({ mediaKey: "amazon-search-token-1" }),
          expect.objectContaining({ mediaKey: "amazon-search-token-2" })
        ],
        scanCoverage: {
          status: "complete",
          stopReason: "exhausted",
          itemsVisited: 2,
          itemsReturned: 2,
          itemsSkipped: 0,
          totalItems: 2
        }
      })
    } finally {
      restore()
      vi.useRealTimers()
    }
  })

  it("keeps Amazon original quality unknown when scans expose file metadata only", async () => {
    const { messages, restore } = collectMessages()
    const node = {
      ...amazonNode("quality-unclassified"),
      image: undefined,
      kind: "FILE",
      isShared: false,
      contentProperties: {
        ...amazonNode("quality-unclassified").contentProperties,
        size: 1_234_567,
        md5: "a".repeat(32),
        image: { width: 4000, height: 3000 }
      }
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: 1, data: [node] })
    })
    vi.stubGlobal("fetch", fetchMock)

    try {
      sendCommand("getAllMediaItems", "amazon-quality-unclassified", { limit: 1 })
      const result = await waitForCommandResult(
        messages,
        "getAllMediaItems",
        "amazon-quality-unclassified"
      )

      expect(result).toMatchObject({
        success: true,
        data: [
          expect.objectContaining({
            mediaKey: "amazon-quality-unclassified",
            size: 1_234_567,
            resWidth: 4000,
            resHeight: 3000,
            isOriginalQuality: null
          })
        ]
      })
    } finally {
      restore()
    }
  })

  it("fails closed when Amazon repeats a continuation token", async () => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const repeatedToken = "search-token-loop"
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          count: 400,
          data: [amazonNode("search-token-loop-node")],
          nextToken: repeatedToken
        })
    })
    vi.stubGlobal("fetch", fetchMock)

    try {
      sendCommand("getAllMediaItems", "amazon-search-token-loop", {})
      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(1000)
      await flushMicrotasks()

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "getAllMediaItems" &&
          msg.requestId === "amazon-search-token-loop"
      )
      expect(amazonPageRequestCalls(fetchMock)).toHaveLength(2)
      expect(result).toMatchObject({
        success: true,
        scanCoverage: {
          status: "partial",
          stopReason: "pagination_error",
          itemsVisited: 1,
          itemsReturned: 1,
          itemsSkipped: 0,
          totalItems: 400
        }
      })
    } finally {
      restore()
      vi.useRealTimers()
    }
  })

  it("rejects a shared album scope before fetching its media", async () => {
    const { messages, restore } = collectMessages()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ count: 1, data: [amazonAlbumNode("shared-1", true)] })
    })
    vi.stubGlobal("fetch", fetchMock)

    try {
      sendCommand("getAllMediaItems", "amazon-shared-album-scan", {
        albumScope: { mediaKey: "amazon-album-shared-1" }
      })
      await flush()

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "getAllMediaItems" &&
          msg.requestId === "amazon-shared-album-scan"
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({
        success: false,
        error: expect.stringMatching(/not a personal album/i),
        scanCoverage: { status: "failed" }
      })
    } finally {
      restore()
    }
  })

  it("[PARITY-03] fails closed when a personal album contains another owner's item", async () => {
    const { messages, restore } = collectMessages()
    const foreignOwnerNode = {
      ...amazonNode("foreign-owner-photo"),
      kind: "FILE",
      ownerId: "different-owner"
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ count: 1, data: [amazonAlbumNode("personal-1")] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 1, data: [foreignOwnerNode] })
      })
    vi.stubGlobal("fetch", fetchMock)

    try {
      sendCommand("getAllMediaItems", "amazon-album-foreign-owner", {
        albumScope: { mediaKey: "amazon-album-personal-1" }
      })
      await flush()
      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "getAllMediaItems" &&
          msg.requestId === "amazon-album-foreign-owner"
      )
      expect(result).toMatchObject({
        success: false,
        error: expect.stringMatching(/cannot be scanned safely/i),
        scanCoverage: { status: "failed", itemsVisited: 1 }
      })
    } finally {
      restore()
    }
  })

  it("falls back from an Amazon creation watermark to an authoritative full inventory", async () => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const sinceTimestamp = Date.parse("2026-06-20T00:00:00.000Z")
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 2,
            data: [
              amazonNodeWithCreatedDate("new-node", "2026-06-28T00:00:00.000Z")
            ],
            nextToken: "full-inventory-page-2"
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 2,
            data: [
              amazonNodeWithCreatedDate("old-node", "2026-06-01T00:00:00.000Z")
            ]
          })
      })
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("getAllMediaItems", "amazon-incremental", {
      sinceTimestamp
    })
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(1000)
    await flushMicrotasks()

    expect(amazonPageRequestCalls(fetchMock)).toHaveLength(2)
    const result = messages.find(
      (msg) =>
        msg.action === "gptkResult" &&
        msg.command === "getAllMediaItems" &&
        msg.requestId === "amazon-incremental"
    )
    expect(result?.data).toEqual([
      expect.objectContaining({ mediaKey: "amazon-new-node" }),
      expect.objectContaining({ mediaKey: "amazon-old-node" })
    ])
    expect(result?.scanCoverage).toMatchObject({
      status: "complete",
      stopReason: "exhausted",
      itemsReturned: 2,
      totalItems: 2,
      pagesRead: 2,
      pageSizes: [1, 1]
    })
    expect(messages).toContainEqual(
      expect.objectContaining({
        action: "gptkProgress",
        requestId: "amazon-incremental",
        itemsProcessed: 0,
        message: expect.stringMatching(/cannot detect edits or deletions from createdDate/i)
      })
    )
    restore()
    vi.useRealTimers()
  })

  it("keeps missing creation dates and old items in an authoritative Amazon refresh", async () => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const sinceTimestamp = Date.parse("2026-06-20T00:00:00.000Z")
    const firstPage = Array.from({ length: 199 }, (_, index) =>
      amazonNodeWithCreatedDate(`recent-${index}`, "2026-06-28T00:00:00.000Z")
    )
    const missingSortDateNode = {
      ...amazonNode("missing-sort-date"),
      createdDate: undefined,
      modifiedDate: "2026-06-01T00:00:00.000Z"
    }
    firstPage.push(missingSortDateNode)
    const secondPage = [
      amazonNodeWithCreatedDate("later-new-item", "2026-06-28T00:00:00.000Z"),
      ...Array.from({ length: 199 }, (_, index) =>
        amazonNodeWithCreatedDate(`cached-${index}`, "2026-06-01T00:00:00.000Z")
      )
    ]
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 400, data: firstPage })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 400, data: secondPage })
      })
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("getAllMediaItems", "amazon-incremental-unknown-sort", {
      limit: 400,
      sinceTimestamp
    })
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(1000)
    await flushMicrotasks()

    const result = messages.find(
      (msg) =>
        msg.action === "gptkResult" &&
        msg.command === "getAllMediaItems" &&
        msg.requestId === "amazon-incremental-unknown-sort"
    )
    expect(amazonPageRequestCalls(fetchMock)).toHaveLength(2)
    expect(result?.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mediaKey: "amazon-missing-sort-date" }),
        expect.objectContaining({ mediaKey: "amazon-later-new-item" })
      ])
    )
    expect(
      result?.data?.find(
        (item: { mediaKey: string }) =>
          item.mediaKey === "amazon-missing-sort-date"
      )?.creationTimestamp
    ).toBeNaN()
    expect(result?.scanCoverage).toMatchObject({
      status: "complete",
      stopReason: "exhausted",
      itemsVisited: 400,
      itemsReturned: 400,
      pagesRead: 2,
      pageSizes: [200, 200]
    })
    restore()
    vi.useRealTimers()
  })

  it("returns the full inventory when Amazon pages contradict created-date order", async () => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const sinceTimestamp = Date.parse("2026-06-20T00:00:00.000Z")
    const firstPage = Array.from({ length: 198 }, (_, index) =>
      amazonNodeWithCreatedDate(
        `ordered-recent-${index}`,
        "2026-06-28T00:00:00.000Z"
      )
    )
    firstPage.push(
      amazonNodeWithCreatedDate(
        "misordered-cached",
        "2026-06-01T00:00:00.000Z"
      ),
      amazonNodeWithCreatedDate("misordered-new", "2026-06-27T00:00:00.000Z")
    )
    const secondPage = [
      amazonNodeWithCreatedDate(
        "new-on-later-page",
        "2026-06-26T00:00:00.000Z"
      ),
      ...Array.from({ length: 199 }, (_, index) =>
        amazonNodeWithCreatedDate(
          `later-cached-${index}`,
          "2026-06-01T00:00:00.000Z"
        )
      )
    ]
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 400, data: firstPage })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 400, data: secondPage })
      })
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("getAllMediaItems", "amazon-incremental-bad-sort-order", {
      limit: 400,
      sinceTimestamp
    })
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(1000)
    await flushMicrotasks()

    const result = messages.find(
      (msg) =>
        msg.action === "gptkResult" &&
        msg.command === "getAllMediaItems" &&
        msg.requestId === "amazon-incremental-bad-sort-order"
    )
    expect(amazonPageRequestCalls(fetchMock)).toHaveLength(2)
    expect(result?.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mediaKey: "amazon-new-on-later-page" })
      ])
    )
    expect(result?.scanCoverage).toMatchObject({
      status: "complete",
      stopReason: "exhausted",
      itemsVisited: 400,
      itemsReturned: 400,
      pagesRead: 2,
      pageSizes: [200, 200]
    })
    restore()
    vi.useRealTimers()
  })

  it("does not truncate an Amazon refresh at a cross-page created-date contradiction", async () => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const sinceTimestamp = Date.parse("2026-06-20T00:00:00.000Z")
    const firstPage = Array.from({ length: 200 }, (_, index) =>
      amazonNodeWithCreatedDate(
        `cross-page-recent-${index}`,
        "2026-06-28T00:00:00.000Z"
      )
    )
    const secondPage = [
      amazonNodeWithCreatedDate("cross-page-ahead", "2026-06-29T00:00:00.000Z"),
      ...Array.from({ length: 199 }, (_, index) =>
        amazonNodeWithCreatedDate(
          `cross-page-cached-${index}`,
          "2026-06-01T00:00:00.000Z"
        )
      )
    ]
    const thirdPage = [
      amazonNodeWithCreatedDate(
        "cross-page-later-new",
        "2026-06-27T00:00:00.000Z"
      ),
      ...Array.from({ length: 199 }, (_, index) =>
        amazonNodeWithCreatedDate(
          `cross-page-later-cached-${index}`,
          "2026-06-01T00:00:00.000Z"
        )
      )
    ]
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 600, data: firstPage })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 600, data: secondPage })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 600, data: thirdPage })
      })
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("getAllMediaItems", "amazon-incremental-cross-page-sort", {
      limit: 600,
      sinceTimestamp
    })
    await vi.runAllTimersAsync()

    const result = messages.find(
      (msg) =>
        msg.action === "gptkResult" &&
        msg.command === "getAllMediaItems" &&
        msg.requestId === "amazon-incremental-cross-page-sort"
    )
    expect(amazonPageRequestCalls(fetchMock)).toHaveLength(3)
    expect(result?.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mediaKey: "amazon-cross-page-later-new" })
      ])
    )
    expect(result?.scanCoverage).toMatchObject({
      status: "complete",
      stopReason: "exhausted",
      itemsVisited: 600,
      itemsReturned: 600,
      pagesRead: 3,
      pageSizes: [200, 200, 200]
    })
    restore()
    vi.useRealTimers()
  })

  it("maps Amazon video metadata for shared duplicate detection", async () => {
    const { messages, restore } = collectMessages()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          count: 1,
          data: [amazonVideoNode("video-node")]
        })
    })
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("getAllMediaItems", "amazon-video-mapping", { limit: 1 })
    await flush()
    await flush()

    const result = messages.find(
      (msg) =>
        msg.action === "gptkResult" &&
        msg.command === "getAllMediaItems" &&
        msg.requestId === "amazon-video-mapping"
    )
    expect(result?.data?.[0]).toMatchObject({
      mediaKey: "amazon-video-node",
      dedupKey: "video-node",
      exactContentHash: "amazon-md5-abcdef0123456789abcdef0123456789",
      contentHash: {
        value: "abcdef0123456789abcdef0123456789",
        algorithm: "md5",
        verificationSource: "provider-checksum"
      },
      resWidth: 1920,
      resHeight: 1080,
      duration: 12345,
      mediaKind: "video",
      originalContentVerificationCapability: "available",
      videoPlaybackCapability: "available",
      mimeType: "video/mp4",
      timestampProvenance: "unknown",
      creationTimestampProvenance: "creation",
      favoriteStatus: "unknown",
      favoriteSource: "unavailable",
      size: 123456
    })
    restore()
  })

  it("offers original-byte verification only for confirmed personal items", () => {
    const originalUrl = window.location.href
    ;(window as any).happyDOM.setURL("https://www.amazon.ca/photos?sf=1")
    const api = (window as any).__GPD_AMAZON_COMMAND_TEST_API__ as {
      mapAmazonNode: (node: object, index: number) => {
        originalContentVerificationCapability?: string
      } | null
    }
    const baseNode = {
      ...amazonNode("amazon-shared-status-capability"),
      contentProperties: {
        ...amazonNode("amazon-shared-status-capability").contentProperties,
        size: 321
      }
    }

    try {
      expect(
        api.mapAmazonNode({ ...baseNode, isShared: false }, 0)
          ?.originalContentVerificationCapability
      ).toBe("available")
      expect(
        api.mapAmazonNode({ ...baseNode, isShared: true }, 0)
          ?.originalContentVerificationCapability
      ).toBe("unavailable")
      expect(
        api.mapAmazonNode(baseNode, 0)?.originalContentVerificationCapability
      ).toBe("unavailable")
      expect(
        api.mapAmazonNode({ ...baseNode, isShared: "false" }, 0)
          ?.originalContentVerificationCapability
      ).toBe("unavailable")
    } finally {
      ;(window as any).happyDOM.setURL(originalUrl)
    }
  })

  it("keeps Canada Live Photo hash verification unavailable even with an original resource", async () => {
    const originalUrl = window.location.href
    ;(window as any).happyDOM.setURL("https://www.amazon.ca/photos?sf=1")
    const { messages, restore } = collectMessages()
    const livePhoto = {
      ...amazonNode("live-photo-original-route"),
      isLivePhoto: true,
      contentProperties: {
        ...amazonNode("live-photo-original-route").contentProperties,
        size: 321
      }
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: 1, data: [livePhoto] })
    })
    vi.stubGlobal("fetch", fetchMock)

    try {
      sendCommand("getAllMediaItems", "amazon-live-photo-hash-capability", { limit: 1 })
      await flush()
      await flush()

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "amazon-live-photo-hash-capability"
      )
      expect(result?.data?.[0]).toMatchObject({
        mediaKey: "amazon-live-photo-original-route",
        provider: "amazon",
        mediaKind: "live-photo",
        originalContentVerificationCapability: "unavailable"
      })
    } finally {
      restore()
      ;(window as any).happyDOM.setURL(originalUrl)
    }
  })

  it("marks Amazon video playback unavailable outside Canada and fails original retrieval closed", async () => {
    const originalUrl = window.location.href
    ;(window as any).happyDOM.setURL("https://www.amazon.com/photos?sf=1")
    const { messages, restore } = collectMessages()
    const video = {
      ...amazonVideoNode("regional-video"),
      settings: { favorite: false }
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === "/drive/v1/search") {
        return { ok: true, json: async () => ({ count: 1, data: [video] }) }
      }
      throw new Error(`Unexpected Amazon regional capability request: ${url.pathname}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    try {
      const scopeFingerprint = "amazon-non-canada-media-review"
      sendAmazonProviderCommand("getAllMediaItems", "amazon-regional-media-scan", {
        providerSessionId: amazonTestSessionId,
        scanScopeFingerprint: scopeFingerprint
      })
      const scan = await waitForCommandResult(
        messages,
        "getAllMediaItems",
        "amazon-regional-media-scan"
      )
      expect(scan).toMatchObject({
        success: true,
        data: [
          {
            mediaKey: "amazon-regional-video",
            originalContentVerificationCapability: "unsupported-region",
            videoPlaybackCapability: "unavailable"
          }
        ]
      })

      sendAmazonProviderCommand("getOriginalContentHash", "amazon-regional-hash", {
        requestId: "amazon-regional-hash",
        mediaKey: "amazon-regional-video",
        providerSessionId: amazonTestSessionId,
        scanScopeFingerprint: scopeFingerprint,
        userOptIn: true,
        maxBytes: 25 * 1024 * 1024,
        aggregateBudgetBytes: 100 * 1024 * 1024
      })
      sendAmazonProviderCommand("getVideoPlaybackUrl", "amazon-regional-playback", {
        requestId: "amazon-regional-playback",
        mediaKey: "amazon-regional-video",
        providerSessionId: amazonTestSessionId,
        scanScopeFingerprint: scopeFingerprint,
        userOptIn: true
      })
      const [hashResult, playbackResult] = await Promise.all([
        waitForCommandResult(messages, "getOriginalContentHash", "amazon-regional-hash"),
        waitForCommandResult(messages, "getVideoPlaybackUrl", "amazon-regional-playback")
      ])
      expect(hashResult).toMatchObject({
        success: false,
        error: expect.stringContaining("only on Amazon Photos Canada")
      })
      expect(playbackResult).toMatchObject({
        success: false,
        error: expect.stringContaining("only on Amazon Photos Canada")
      })
      expect(
        fetchMock.mock.calls.some(
          ([input]) => new URL(String(input)).hostname === "download-photos.amazon.ca"
        )
      ).toBe(false)
    } finally {
      restore()
      ;(window as any).happyDOM.setURL(originalUrl)
    }
  })

  it("maps the verified nested Amazon duration in seconds and handles explicit units", async () => {
    const { messages, restore } = collectMessages()
    const ambiguous = {
      ...amazonVideoNode("video-duration-unknown"),
      video: { width: 1920, height: 1080, duration: 0.5 },
      contentProperties: {
        ...amazonVideoNode("video-duration-unknown").contentProperties,
        video: { width: 1920, height: 1080 }
      }
    }
    const milliseconds = {
      ...amazonVideoNode("video-duration-ms"),
      contentProperties: {
        ...amazonVideoNode("video-duration-ms").contentProperties,
        video: { width: 1920, height: 1080, durationMs: 500 }
      }
    }
    const seconds = {
      ...amazonVideoNode("video-duration-seconds"),
      contentProperties: {
        ...amazonVideoNode("video-duration-seconds").contentProperties,
        video: { width: 1920, height: 1080, durationSeconds: 1200 }
      }
    }
    const verifiedNestedSeconds = {
      ...amazonVideoNode("video-duration-provider-native"),
      contentProperties: {
        ...amazonVideoNode("video-duration-provider-native").contentProperties,
        video: { width: 1920, height: 1080, duration: 2 }
      }
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          count: 4,
          data: [ambiguous, milliseconds, seconds, verifiedNestedSeconds]
        })
    })
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("getAllMediaItems", "amazon-video-duration-units", { limit: 4 })
    await flushProviderWork()

    const result = messages.find(
      (msg) =>
        msg.action === "gptkResult" &&
        msg.command === "getAllMediaItems" &&
        msg.requestId === "amazon-video-duration-units"
    )
    expect(result?.data.map((item: { duration?: number }) => item.duration)).toEqual([
      undefined,
      500,
      1_200_000,
      2000
    ])
    restore()
  })

  it("keeps favorite state unknown when Amazon does not return favorite metadata", async () => {
    const { messages, restore } = collectMessages()
    const missingFavorite = {
      ...amazonNode("favorite-unknown"),
      settings: undefined
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ count: 1, data: [missingFavorite] })
    })
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("getAllMediaItems", "amazon-favorite-unknown", { limit: 1 })
    await flushProviderWork()

    const result = messages.find(
      (msg) =>
        msg.action === "gptkResult" &&
        msg.command === "getAllMediaItems" &&
        msg.requestId === "amazon-favorite-unknown"
    )
    expect(result?.data?.[0]).toMatchObject({
      favoriteStatus: "unknown",
      favoriteSource: "unavailable",
      mediaKind: "photo",
      mimeType: "image/jpeg",
      timestampProvenance: "unknown"
    })
    expect(result?.data?.[0]).not.toHaveProperty("isFavorite")
    restore()
  })

  it("maps only explicit Amazon favorite booleans and marks capture date provenance", async () => {
    const { messages, restore } = collectMessages()
    const sourceNode = {
      ...amazonNode("known-favorite"),
      settings: { favorite: false },
      image: {
        width: 1200,
        height: 800,
        dateTimeOriginal: "2026-06-27T08:30:00.000Z"
      }
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ count: 1, data: [sourceNode] })
      })
    )

    sendCommand("getAllMediaItems", "amazon-known-favorite", { limit: 1 })
    await flush()
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "amazon-known-favorite"
    )
    expect(result?.data?.[0]).toMatchObject({
      isFavorite: false,
      favoriteStatus: "not-favorite",
      favoriteSource: "provider-metadata",
      timestampProvenance: "capture",
      mediaKind: "photo"
    })
    restore()
  })

  it("reads omitted Amazon favorite metadata through an exact personal-node lookup", async () => {
    const { messages, restore } = collectMessages()
    const searched = {
      ...amazonNode("favorite-lookup"),
      settings: undefined
    }
    const exact = {
      ...searched,
      isShared: false,
      settings: { favorite: true }
    }
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === "/drive/v1/search") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ count: 1, data: [searched] })
        })
      }
      if (url.pathname === "/drive/v1/nodes/favorite-lookup") {
        return Promise.resolve({ ok: true, json: async () => exact })
      }
      throw new Error(`Unexpected Amazon request path: ${url.pathname}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("getAllMediaItems", "amazon-favorite-lookup", { limit: 1 })
    await flushProviderWork()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "amazon-favorite-lookup"
    )
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)).toContain(
      "/drive/v1/nodes/favorite-lookup"
    )
    expect(result?.data?.[0]).toMatchObject({
      isFavorite: true,
      favoriteStatus: "favorite",
      favoriteSource: "provider-lookup"
    })
    restore()
  })

  it("hashes bounded Amazon original bytes from the exact owner-bound download route", async () => {
    const { messages, restore } = collectMessages()
    const content = new TextEncoder().encode("exact original bytes")
    const mimeType = "image/jpeg"
    const exactNode = {
      ...amazonNode("hash-original"),
      ownerId: "owner-1",
      isShared: false,
      settings: { favorite: false },
      contentProperties: {
        ...amazonNode("hash-original").contentProperties,
        contentType: mimeType,
        size: content.byteLength
      }
    }
    const downloadHref =
      "https://download-photos.amazon.ca/v2/download/signed/hash-original?ownerId=owner-1"
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === "/drive/v1/search") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () =>
            url.searchParams.get("limit") === "1"
              ? { count: 1, data: [{ id: "seed", ownerId: "owner-1" }] }
              : { count: 1, data: [exactNode] }
        })
      }
      if (url.pathname === "/drive/v1/nodes/hash-original") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => exactNode
        })
      }
      if (url.href === downloadHref) {
        let emitted = false
        return Promise.resolve({
          ok: true,
          status: 200,
          url: downloadHref,
          redirected: false,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "content-type"
                ? mimeType
                : name.toLowerCase() === "content-length"
                  ? String(content.byteLength)
                  : null
          },
          body: {
            getReader: () => ({
              read: async () => {
                if (emitted) return { done: true, value: undefined }
                emitted = true
                return { done: false, value: content.slice() }
              },
              cancel: vi.fn().mockResolvedValue(undefined)
            })
          }
        })
      }
      throw new Error(`Unexpected Amazon request path: ${url.pathname}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn(async (_algorithm: string, bytes: ArrayBuffer) =>
          Uint8Array.from(
            createHash("sha256")
              .update(Buffer.from(bytes))
              .digest()
          ).buffer
        )
      }
    })

    const scanRequestId = "amazon-original-hash-scan"
    const scanArgs = {
      limit: 1,
      providerSessionId: amazonTestSessionId,
      scanScopeFingerprint: "test-scan-scope"
    }
    sendAmazonProviderCommand("getAllMediaItems", scanRequestId, scanArgs)
    await flushProviderWork()
    const scan = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === scanRequestId
    )
    expect(scan).toMatchObject({
      success: true,
      scanCoverage: { status: "complete" },
      data: [expect.objectContaining({ mediaKey: "amazon-hash-original" })]
    })

    for (const [suffix, mediaKey, scanScopeFingerprint] of [
      ["unscanned-item", "amazon-personal-item-outside-review", "test-scan-scope"],
      ["stale-scope", "amazon-hash-original", "different-review-scope"]
    ] as const) {
      const rejectedRequestId = `amazon-original-hash-${suffix}`
      sendAmazonProviderCommand("getOriginalContentHash", rejectedRequestId, {
        requestId: rejectedRequestId,
        mediaKey,
        providerSessionId: amazonTestSessionId,
        scanScopeFingerprint,
        userOptIn: true,
        aggregateBudgetBytes: 100 * 1024 * 1024,
        maxBytes: 1024 * 1024
      })
      await flushProviderWork()
      const rejected = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getOriginalContentHash" &&
          message.requestId === rejectedRequestId
      )
      expect(rejected).toMatchObject({ success: false })
      expect(JSON.stringify(rejected)).not.toMatch(/download-photos\.amazon\.ca/i)
    }
    sendAmazonProviderCommand(
      "getOriginalContentHash",
      "amazon-original-hash-over-budget-request",
      {
        requestId: "amazon-original-hash-over-budget-request",
        mediaKey: "amazon-hash-original",
        providerSessionId: amazonTestSessionId,
        scanScopeFingerprint: "test-scan-scope",
        userOptIn: true,
        aggregateBudgetBytes: 100 * 1024 * 1024 + 1,
        maxBytes: 1024 * 1024
      }
    )
    await flushProviderWork()
    expect(
      messages.find(
        (message) =>
          message.requestId === "amazon-original-hash-over-budget-request" &&
          message.action === "gptkResult"
      )
    ).toMatchObject({ success: false })
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => new URL(String(input)).hostname === "download-photos.amazon.ca"
      )
    ).toHaveLength(0)

    const requestId = "amazon-original-hash"
    sendAmazonProviderCommand("getOriginalContentHash", requestId, {
      requestId,
      mediaKey: "amazon-hash-original",
      providerSessionId: amazonTestSessionId,
      scanScopeFingerprint: "test-scan-scope",
      userOptIn: true,
      aggregateBudgetBytes: 100 * 1024 * 1024,
      maxBytes: 1024 * 1024
    })
    await flushProviderWork()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "getOriginalContentHash" &&
        message.requestId === requestId
    )
    const downloadCall = fetchMock.mock.calls.find(
      ([input]) => new URL(String(input)).hostname === "download-photos.amazon.ca"
    )
    expect(downloadCall?.[1]).toMatchObject({
      credentials: "include",
      redirect: "manual"
    })
    expect(result).toMatchObject({
      success: true,
      data: {
        mediaKey: "amazon-hash-original",
        scopeFingerprint: "test-scan-scope",
        contentHash: {
          algorithm: "sha256",
          verificationSource: "local-original-bytes",
          value: createHash("sha256").update(Buffer.from(content)).digest("hex")
        },
        byteLength: content.byteLength,
        mimeType
      }
    })
    expect(JSON.stringify(result)).not.toContain(downloadHref)
    restore()
  })

  it("[VIDEO-PLAYBACK] hashes the exact owner-bound Amazon video original route", async () => {
    const { messages, restore } = collectMessages()
    const content = new TextEncoder().encode("verified original video bytes")
    const video = {
      ...amazonVideoNode("video-original-route"),
      isShared: false,
      settings: { favorite: false },
      contentProperties: {
        ...amazonVideoNode("video-original-route").contentProperties,
        contentType: "video/mp4",
        size: content.byteLength
      }
    }
    const downloadHref =
      "https://download-photos.amazon.ca/v2/download/signed/video-original-route?ownerId=owner-1"
    const fetchMock = vi
      .fn()
      .mockImplementation((input: RequestInfo | URL) => {
        const url = new URL(String(input))
        if (url.pathname === "/drive/v1/search") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () =>
              url.searchParams.get("limit") === "1"
                ? { count: 1, data: [{ id: "seed", ownerId: "owner-1" }] }
                : { count: 1, data: [video] }
          })
        }
        if (url.pathname === "/drive/v1/nodes/video-original-route") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => video
          })
        }
        if (url.href === downloadHref) {
          let emitted = false
          return Promise.resolve({
            ok: true,
            status: 200,
            url: downloadHref,
            redirected: false,
            headers: {
              get: (name: string) =>
                name.toLowerCase() === "content-type"
                  ? "video/mp4"
                  : name.toLowerCase() === "content-length"
                    ? String(content.byteLength)
                    : null
            },
            body: {
              getReader: () => ({
                read: async () => {
                  if (emitted) return { done: true, value: undefined }
                  emitted = true
                  return { done: false, value: content.slice() }
                },
                cancel: vi.fn().mockResolvedValue(undefined)
              })
            }
          })
        }
        throw new Error(`Unexpected Amazon video request path: ${url.pathname}`)
      })
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn(async (_algorithm: string, bytes: ArrayBuffer) =>
          Uint8Array.from(
            createHash("sha256").update(Buffer.from(bytes)).digest()
          ).buffer
        )
      }
    })

    const scanScopeFingerprint = "amazon-video-original-review"
    sendAmazonProviderCommand("getAllMediaItems", "amazon-video-original-scan", {
      limit: 1,
      providerSessionId: amazonTestSessionId,
      scanScopeFingerprint
    })
    await flushProviderWork()
    expect(
      messages.find(
        (message) =>
          message.requestId === "amazon-video-original-scan" &&
          message.action === "gptkResult"
      )
    ).toMatchObject({ success: true, scanCoverage: { status: "complete" } })

    sendAmazonProviderCommand("getOriginalContentHash", "amazon-video-original-hash", {
      requestId: "amazon-video-original-hash",
      mediaKey: "amazon-video-original-route",
      providerSessionId: amazonTestSessionId,
      scanScopeFingerprint,
      userOptIn: true,
      aggregateBudgetBytes: 100 * 1024 * 1024,
      maxBytes: 25 * 1024 * 1024
    })
    await flushProviderWork()
    const result = messages.find(
      (message) =>
        message.requestId === "amazon-video-original-hash" &&
        message.action === "gptkResult"
    )
    expect(result).toMatchObject({
      success: true,
      data: {
        mediaKey: "amazon-video-original-route",
        contentHash: {
          algorithm: "sha256",
          verificationSource: "local-original-bytes",
          value: createHash("sha256").update(Buffer.from(content)).digest("hex")
        },
        byteLength: content.byteLength,
        mimeType: "video/mp4"
      }
    })
    expect(
      fetchMock.mock.calls.some(
        ([input]) => new URL(String(input)).hostname === "download-photos.amazon.ca"
      )
    ).toBe(true)
    expect(JSON.stringify(result)).not.toContain(downloadHref)

    sendAmazonProviderCommand("getVideoPlaybackUrl", "amazon-video-playback-url", {
      requestId: "amazon-video-playback-url",
      mediaKey: "amazon-video-original-route",
      providerSessionId: amazonTestSessionId,
      scanScopeFingerprint,
      userOptIn: true
    })
    await flushProviderWork()
    const playbackResult = messages.find(
      (message) =>
        message.requestId === "amazon-video-playback-url" &&
        message.action === "gptkResult"
    )
    expect(playbackResult).toMatchObject({
      success: true,
      data: {
        mediaKey: "amazon-video-original-route",
        scopeFingerprint: scanScopeFingerprint,
        playbackUrl: downloadHref,
        mimeType: "video/mp4"
      }
    })
    restore()
  })

  it("enforces original byte budgets through public scans and streams across concurrency and LRU eviction", async () => {
    const { messages, restore } = collectMessages()
    const mib = 1024 * 1024
    const perItemLimit = 25 * mib
    const aggregateLimit = 100 * mib
    const mediaKey = "amazon-budget-original"
    const mediaId = "budget-original"
    const scopeFingerprint = "amazon-original-budget-review"
    const nodeFor = (id: string, size: number) => ({
      ...amazonNode(id),
      kind: "FILE",
      isShared: false,
      settings: { favorite: false },
      contentProperties: {
        ...amazonNode(id).contentProperties,
        contentType: "image/jpeg",
        size
      }
    })
    const exactNode = nodeFor(mediaId, perItemLimit)
    let activeNodes: any[] = [exactNode]
    let deferredOriginalFetch: {
      started: Promise<void>
      response: Promise<Response>
      start: () => void
      resolve: (response: Response) => void
      reject: (error: unknown) => void
      signal?: AbortSignal
    } | null = null
    const createDeferredOriginalFetch = () => {
      let start!: () => void
      let resolve!: (response: Response) => void
      let reject!: (error: unknown) => void
      const started = new Promise<void>((resolveStarted) => {
        start = resolveStarted
      })
      const response = new Promise<Response>((resolveResponse, rejectResponse) => {
        resolve = resolveResponse
        reject = rejectResponse
      })
      return {
        started,
        response,
        start,
        resolve,
        reject,
        signal: undefined as AbortSignal | undefined
      }
    }
    const largeResponse = (length = perItemLimit) => {
      let remaining = length
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (remaining <= 0) {
            controller.close()
            return
          }
          const nextLength = Math.min(remaining, mib)
          const chunk = new Uint8Array(nextLength).fill(97)
          controller.enqueue(chunk)
          remaining -= nextLength
        }
      })
      return new Response(body, {
        status: 200,
        headers: {
          "content-length": String(length),
          "content-type": "image/jpeg"
        }
      })
    }
    const fetchMock = vi.fn().mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        if (url.pathname === "/drive/v1/search") {
          if (url.searchParams.get("limit") === "1") {
            return new Response(
              JSON.stringify({
                count: 1,
                data: [{ id: "identity-seed", ownerId: "owner-1" }]
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
          }
          const offset = Number(url.searchParams.get("offset") || 0)
          const limit = Number(url.searchParams.get("limit") || 200)
          return new Response(
            JSON.stringify({
              count: activeNodes.length,
              data: activeNodes.slice(offset, offset + limit)
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        }
        if (url.pathname.startsWith("/drive/v1/nodes/")) {
          const id = decodeURIComponent(url.pathname.split("/").pop() || "")
          const exact = activeNodes.find((node) => node.id === id) || exactNode
          return new Response(JSON.stringify(exact), {
            status: 200,
            headers: { "content-type": "application/json" }
          })
        }
        if (
          url.hostname === "download-photos.amazon.ca" &&
          url.pathname === `/v2/download/signed/${mediaId}` &&
          url.searchParams.get("ownerId") === "owner-1"
        ) {
          const deferred = deferredOriginalFetch
          if (deferred) {
            deferredOriginalFetch = null
            deferred.signal = init?.signal as AbortSignal | undefined
            deferred.signal?.addEventListener(
              "abort",
              () => deferred.reject(new DOMException("Aborted", "AbortError")),
              { once: true }
            )
            deferred.start()
            return deferred.response
          }
          return largeResponse()
        }
        throw new Error(`Unexpected Amazon request path: ${url.pathname}`)
      }
    )
    vi.useFakeTimers()
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn(async (_algorithm: string, bytes: ArrayBuffer) =>
          Uint8Array.from(
            createHash("sha256").update(Buffer.from(bytes)).digest()
          ).buffer
        )
      }
    })

    const findResult = (requestId: string) =>
      messages.find(
        (message) =>
          message.action === "gptkResult" && message.requestId === requestId
      )
    const waitForResult = async (requestId: string) => {
      for (let attempt = 0; attempt < 500; attempt += 1) {
        const result = findResult(requestId)
        if (result) return result
        await vi.advanceTimersByTimeAsync(1000)
        await Promise.resolve()
      }
      throw new Error(`Timed out waiting for Amazon Photos command ${requestId}`)
    }
    const scanFor = async (
      requestId: string,
      nodes: any[],
      limit: number,
      scope = scopeFingerprint
    ) => {
      activeNodes = nodes
      sendAmazonProviderCommand("getAllMediaItems", requestId, {
        limit,
        providerSessionId: amazonTestSessionId,
        scanScopeFingerprint: scope
      })
      return waitForResult(requestId)
    }
    const requestHash = async (
      requestId: string,
      aggregateBudgetBytes = aggregateLimit,
      scope = scopeFingerprint
    ) => {
      sendAmazonProviderCommand("getOriginalContentHash", requestId, {
        requestId,
        mediaKey,
        userOptIn: true,
        providerSessionId: amazonTestSessionId,
        scanScopeFingerprint: scope,
        aggregateBudgetBytes,
        maxBytes: perItemLimit
      })
      return waitForResult(requestId)
    }
    const originalFetchCount = () =>
      fetchMock.mock.calls.filter(
        ([input]) => new URL(String(input)).hostname === "download-photos.amazon.ca"
      ).length

    try {
      const constrainedScope = `${scopeFingerprint}-sticky-caller-cap`
      const constrainedScan = await scanFor(
        "amazon-budget-sticky-cap-scan",
        [exactNode],
        1,
        constrainedScope
      )
      expect(constrainedScan).toMatchObject({
        success: true,
        scanCoverage: { status: "complete" }
      })
      const constrainedBudget = perItemLimit * 2
      expect(
        await requestHash(
          "amazon-budget-sticky-cap-first",
          constrainedBudget,
          constrainedScope
        )
      ).toMatchObject({ success: true })
      expect(
        await requestHash(
          "amazon-budget-sticky-cap-second",
          constrainedBudget,
          constrainedScope
        )
      ).toMatchObject({ success: true })
      const fetchesAtConstrainedCap = originalFetchCount()
      expect(
        await requestHash(
          "amazon-budget-sticky-cap-increase-rejected",
          aggregateLimit,
          constrainedScope
        )
      ).toMatchObject({ success: false })
      expect(originalFetchCount()).toBe(fetchesAtConstrainedCap)

      const initialFetchCount = originalFetchCount()
      const initialScan = await scanFor("amazon-budget-initial-scan", [exactNode], 1)
      expect(initialScan).toMatchObject({
        success: true,
        scanCoverage: { status: "complete" },
        data: [expect.objectContaining({ mediaKey })]
      })

      for (let index = 0; index < 3; index += 1) {
        const result = await requestHash(`amazon-budget-sequential-${index}`)
        expect(result).toMatchObject({
          success: true,
          data: {
            mediaKey,
            scopeFingerprint,
            byteLength: perItemLimit,
            contentHash: {
              algorithm: "sha256",
              verificationSource: "local-original-bytes",
              value: expect.stringMatching(/^[a-f0-9]{64}$/)
            }
          }
        })
      }
      expect(perItemLimit * 4).toBe(aggregateLimit)
      expect(originalFetchCount()).toBe(initialFetchCount + 3)

      const fourthFetch = createDeferredOriginalFetch()
      deferredOriginalFetch = fourthFetch
      sendAmazonProviderCommand("getOriginalContentHash", "amazon-budget-concurrent", {
        requestId: "amazon-budget-concurrent",
        mediaKey,
        userOptIn: true,
        providerSessionId: amazonTestSessionId,
        scanScopeFingerprint: scopeFingerprint,
        aggregateBudgetBytes: aggregateLimit,
        maxBytes: perItemLimit
      })
      await fourthFetch.started
      expect(fourthFetch.signal).toBeInstanceOf(AbortSignal)
      const beforeConcurrentReject = originalFetchCount()
      const concurrentRejected = await requestHash("amazon-budget-concurrent-rejected")
      expect(concurrentRejected).toMatchObject({ success: false })
      expect(originalFetchCount()).toBe(beforeConcurrentReject)
      const concurrentLowerCapRejected = await requestHash(
        "amazon-budget-concurrent-lower-cap-rejected",
        aggregateLimit - 1
      )
      expect(concurrentLowerCapRejected).toMatchObject({ success: false })
      expect(originalFetchCount()).toBe(beforeConcurrentReject)
      fourthFetch.resolve(largeResponse())
      const fourthResult = await waitForResult("amazon-budget-concurrent")
      expect(fourthResult).toMatchObject({ success: true })
      expect(originalFetchCount()).toBe(initialFetchCount + 4)

      const exhausted = await requestHash("amazon-budget-exact-exhaustion")
      expect(exhausted).toMatchObject({ success: false })
      expect(originalFetchCount()).toBe(initialFetchCount + 4)

      const floodedNodes = Array.from({ length: 10001 }, (_, index) =>
        nodeFor(`budget-lru-${index}`, 1)
      )
      const floodedScan = await scanFor(
        "amazon-budget-lru-flood",
        floodedNodes,
        10001
      )
      expect(floodedScan).toMatchObject({
        success: true,
        scanCoverage: { status: "complete", itemsReturned: 10001 }
      })
      const rescanned = await scanFor("amazon-budget-lru-rescan", [exactNode], 1)
      expect(rescanned).toMatchObject({ success: true })
      const stillExhausted = await requestHash("amazon-budget-budget-survives-lru")
      expect(stillExhausted).toMatchObject({ success: false })
      expect(originalFetchCount()).toBe(initialFetchCount + 4)
    } finally {
      vi.useRealTimers()
      restore()
    }
  })

  it("maps an Amazon node-id alias to its synthesized thumbnail", async () => {
    const { messages, restore } = collectMessages()
    const aliasedNode = {
      ...amazonNode("node-id-alias"),
      id: undefined,
      nodeId: "node-id-alias"
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: 1, data: [aliasedNode] })
    })
    vi.stubGlobal("fetch", fetchMock)

    try {
      sendCommand("getAllMediaItems", "amazon-node-id-alias", { limit: 1 })
      await flush()

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "getAllMediaItems" &&
          msg.requestId === "amazon-node-id-alias"
      )
      expect(result).toMatchObject({
        success: true,
        data: [
          expect.objectContaining({
            mediaKey: "amazon-node-id-alias",
            thumb: expect.stringContaining(
              "/v1/thumbnail/node-id-alias?ownerId=owner-1"
            )
          })
        ],
        scanCoverage: {
          status: "complete",
          stopReason: "exhausted",
          itemsVisited: 1,
          itemsReturned: 1
        }
      })
    } finally {
      restore()
    }
  })

  it("uses local inclusive dates and reports Amazon scan coverage", async () => {
    const originalTimeZone = process.env.TZ
    process.env.TZ = "America/Los_Angeles"
    try {
      const { messages, restore } = collectMessages()
      const localEnd = new Date(2024, 5, 15, 23, 59).toISOString()
      const nextDay = new Date(2024, 5, 16, 0, 0).toISOString()
      const unknownDate = {
        ...amazonNode("unknown-date"),
        createdDate: undefined,
        contentProperties: {
          ...amazonNode("unknown-date").contentProperties,
          contentDate: undefined
        }
      }
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 3,
            data: [
              amazonNodeWithCreatedDate("local-end-of-day", localEnd),
              unknownDate,
              amazonNodeWithCreatedDate("next-day", nextDay)
            ]
          })
      })
      vi.stubGlobal("fetch", fetchMock)

      sendCommand("getAllMediaItems", "amazon-local-date-coverage", {
        dateRange: { from: "2024-06-15", to: "2024-06-15" }
      })
      await flush()

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "amazon-local-date-coverage"
      )
      expect(result).toMatchObject({ success: true })
      expect(
        result?.data.map((item: { mediaKey: string }) => item.mediaKey)
      ).toEqual(["amazon-local-end-of-day"])
      expect(result?.scanCoverage).toMatchObject({
        status: "complete",
        stopReason: "exhausted",
        itemsVisited: 3,
        itemsReturned: 1,
        itemsSkipped: 2,
        unknownDateItemsSkipped: 1,
        unmappedItemsSkipped: 0,
        mediaTypesCovered: { photos: true, videos: true },
        canResume: false
      })
      expect(result?.scanCoverage).not.toHaveProperty("totalItems")
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
    const nodes = fixture.items.map((item, index) => {
      const base =
        item.mediaType === "video"
          ? amazonVideoNode(`amazon-v3-${index}`)
          : amazonNode(`amazon-v3-${index}`)
      const timestamp = providerParityFixtureTimestamp(item.captureTimeLocal)
      const providerDate = Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString()
        : undefined
      return {
        ...base,
        name: item.name,
        createdDate: providerDate,
        contentProperties: {
          ...base.contentProperties,
          contentType: item.mediaType === "video" ? "video/mp4" : "image/png",
          contentDate: providerDate
        }
      }
    })
    const { messages, restore } = collectMessages()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: fixture.expected.itemCount, data: nodes })
    })
    vi.stubGlobal("fetch", fetchMock)

    try {
      sendCommand("getAllMediaItems", "amazon-v3-mixed-date", {
        dateRange: fixture.dateRange
      })
      await flush()

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "amazon-v3-mixed-date"
      )
      expect(result?.success).toBe(true)
      expect(result?.data.map((item: { fileName: string }) => item.fileName)).toEqual(
        fixture.expected.includedNames
      )
      expect(
        result?.data
          .filter((item: { fileName: string }) => item.fileName.endsWith(".mp4"))
          .every((item: { duration?: number }) => (item.duration ?? 0) > 0)
      ).toBe(true)
      expect(result?.scanCoverage).toMatchObject({
        status: "complete",
        stopReason: "exhausted",
        itemsVisited: fixture.expected.itemsVisited,
        itemsReturned: fixture.expected.itemsReturned,
        itemsSkipped: fixture.expected.itemsSkipped,
        unknownDateItemsSkipped: fixture.expected.unknownDateItemsSkipped,
        unmappedItemsSkipped: 0,
        pagesRead: 1,
        pageSizes: [fixture.expected.itemCount],
        mediaTypesCovered: { photos: true, videos: true },
        canResume: false
      })
      expect(
        result.scanCoverage.itemsSkipped -
          result.scanCoverage.unknownDateItemsSkipped
      ).toBe(fixture.expected.outOfRangeDateItems)
      expect(result?.scanCoverage).not.toHaveProperty("totalItems")
    } finally {
      restore()
      if (originalTimeZone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimeZone
    }
  })

  it("counts out-of-date Amazon records toward the visit limit", async () => {
    const { messages, restore } = collectMessages()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          count: 400,
          data: [
            amazonNodeWithCreatedDate("outside-date", "2024-06-14T18:00:00Z"),
            amazonNodeWithCreatedDate("inside-date", "2024-06-15T18:00:00Z")
          ]
        })
    })
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("getAllMediaItems", "amazon-visit-limit", {
      dateRange: { from: "2024-06-15", to: "2024-06-15" },
      limit: 1
    })
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "amazon-visit-limit"
    )
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

  it("[PARITY-06] marks an empty page before a reported total as incomplete", async () => {
    const { messages, restore } = collectMessages()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: 400, data: [] })
    })
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("getAllMediaItems", "amazon-empty-page", {})
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "amazon-empty-page"
    )
    expect(result).toMatchObject({
      success: true,
      data: [],
      scanCoverage: {
        status: "partial",
        stopReason: "pagination_error",
        itemsVisited: 0,
        itemsReturned: 0,
        itemsSkipped: 0,
        totalItems: 400
      }
    })
    restore()
  })

  it("[PARITY-06] detects an identical Amazon page returned at a later offset", async () => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const repeatedPage = Array.from({ length: 200 }, (_, index) =>
      amazonNode(`repeat-${index}`)
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 400, data: repeatedPage })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 400, data: repeatedPage })
      })
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("getAllMediaItems", "amazon-repeated-page", {})
    await vi.advanceTimersByTimeAsync(1200)
    await flushMicrotasks()

    try {
      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "amazon-repeated-page"
      )
      expect(amazonPageRequestCalls(fetchMock)).toHaveLength(2)
      expect(result).toMatchObject({
        success: true,
        scanCoverage: {
          status: "partial",
          stopReason: "pagination_error",
          itemsVisited: 200,
          itemsReturned: 200,
          itemsSkipped: 0
        }
      })
    } finally {
      restore()
    }
  })

  it("[PARITY-06] rejects a changed whole-library count across pages", async () => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const firstPage = Array.from({ length: 200 }, (_, index) =>
      amazonNode(`count-page-1-${index}`)
    )
    const secondPage = Array.from({ length: 200 }, (_, index) =>
      amazonNode(`count-page-2-${index}`)
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 400, data: firstPage })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: 401, data: secondPage })
      })
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("getAllMediaItems", "amazon-count-drift", {})
    await vi.advanceTimersByTimeAsync(1200)
    await flushMicrotasks()

    try {
      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "amazon-count-drift"
      )
      expect(amazonPageRequestCalls(fetchMock)).toHaveLength(2)
      expect(result).toMatchObject({
        success: true,
        scanCoverage: {
          status: "partial",
          stopReason: "pagination_error",
          itemsVisited: 200,
          itemsReturned: 200,
          itemsSkipped: 0,
          totalItems: 400
        }
      })
    } finally {
      restore()
    }
  })

  it("[PARITY-06] rejects a whole-library page larger than its reported count", async () => {
    const { messages, restore } = collectMessages()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          count: 1,
          data: [amazonNode("oversized-page-1"), amazonNode("oversized-page-2")]
        })
    })
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("getAllMediaItems", "amazon-oversized-page", {})
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "amazon-oversized-page"
    )
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/inconsistent media page/i),
      scanCoverage: {
        status: "failed",
        stopReason: "provider_error",
        itemsVisited: 0,
        itemsReturned: 0,
        itemsSkipped: 0
      }
    })
    restore()
  })

  it("aborts an in-flight Amazon page and reports cancelled coverage", async () => {
    const { messages, restore } = collectMessages()
    const fetchMock = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          )
        })
    )
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("getAllMediaItems", "amazon-cancel", {})
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    sendCommand("cancelScan", "amazon-cancel-command", {
      targetRequestId: "amazon-cancel"
    })
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "amazon-cancel"
    )
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

  it("waits and retries when Amazon rate-limits a search page", async () => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 2,
            data: [amazonNode("node-a")]
          })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => null },
        text: () => Promise.resolve('{"message":"Rate exceeded"}')
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            count: 2,
            data: [amazonNode("node-b")]
          })
      })
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("getAllMediaItems", "amazon-rate-limit", { limit: 400 })
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(1000)
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(15000)
    await flushMicrotasks()

    expect(amazonPageRequestCalls(fetchMock)).toHaveLength(3)
    expect(
      messages.some((msg) =>
        String(msg.message || "").includes(
          "Amazon rate limit hit at offset 1"
        )
      )
    ).toBe(true)
    const result = messages.find(
      (msg) =>
        msg.action === "gptkResult" &&
        msg.command === "getAllMediaItems" &&
        msg.requestId === "amazon-rate-limit"
    )
    expect(result).toMatchObject({
      success: true,
      data: [
        expect.objectContaining({ mediaKey: "amazon-node-a" }),
        expect.objectContaining({ mediaKey: "amazon-node-b" })
      ]
    })
    restore()
    vi.useRealTimers()
  })
})

describe("Amazon trashItems", () => {
  it("revalidates personal-node favorite state and confirms exact Trash transitions", async () => {
    const { messages, restore } = collectMessages()
    const { fetchMock, trash } = stubAmazonMutationProvider({
      favorites: { "node-a": false, "node-b": false }
    })

    sendCommand("trashItems", "amazon-trash", {
      dedupKeys: ["node-a", "node-b"],
      mediaKeysToTrash: ["amazon-node-a", "amazon-node-b"],
      batchSize: 25
    })
    await waitForCommandResult(messages, "trashItems", "amazon-trash")

    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")
    expect(patchCalls).toHaveLength(1)
    expect(JSON.parse(String(patchCalls[0][1]?.body))).toMatchObject({
      op: "add",
      value: ["node-a", "node-b"]
    })
    expect(trash).toEqual(new Set(["node-a", "node-b"]))
    const result = messages.find(
      (msg) => msg.action === "gptkResult" && msg.command === "trashItems" && msg.requestId === "amazon-trash"
    )
    expect(result).toMatchObject({
      success: true,
      data: {
        trashedCount: 2,
        trashedKeys: ["amazon-node-a", "amazon-node-b"],
        trashedDedupKeys: ["node-a", "node-b"],
        retryAttempts: 0,
        outcomes: [
          { operation: "trash", targetKey: "node-a", status: "confirmed" },
          { operation: "trash", targetKey: "node-b", status: "confirmed" }
        ]
      }
    })
    restore()
  })

  it("caps Amazon trash batches at 50 node ids", async () => {
    const { messages, restore } = collectMessages()
    const dedupKeys = Array.from({ length: 51 }, (_, index) => `node-${index}`)
    const mediaKeysToTrash = dedupKeys.map((key) => `amazon-${key}`)
    const { fetchMock } = stubAmazonMutationProvider({
      favorites: Object.fromEntries(dedupKeys.map((key) => [key, false]))
    })

    sendCommand("trashItems", "amazon-trash-batches", {
      dedupKeys,
      mediaKeysToTrash,
      batchSize: 999
    })
    await waitForCommandResult(messages, "trashItems", "amazon-trash-batches")

    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "PATCH"
    )
    expect(patchCalls).toHaveLength(2)
    expect(JSON.parse(String(patchCalls[0][1]?.body)).value).toHaveLength(50)
    expect(JSON.parse(String(patchCalls[1][1]?.body)).value).toEqual(["node-50"])
    restore()
  })

  it("never trashes a favorite or a target with unknown favorite state", async () => {
    const { messages, restore } = collectMessages()
    const { fetchMock, trash } = stubAmazonMutationProvider({
      favorites: { "favorite-node": true, "not-favorite-node": false }
    })

    sendCommand("trashItems", "amazon-trash-unconfirmed", {
      dedupKeys: ["favorite-node", "unknown-node", "not-favorite-node"],
      mediaKeysToTrash: ["amazon-favorite", "amazon-unknown", "amazon-clear"]
    })
    await waitForCommandResult(messages, "trashItems", "amazon-trash-unconfirmed")

    const result = messages.find(
      (msg) =>
        msg.action === "gptkResult" &&
        msg.command === "trashItems" &&
        msg.requestId === "amazon-trash-unconfirmed"
    )
    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")
    expect(patchCalls).toHaveLength(1)
    expect(JSON.parse(String(patchCalls[0][1]?.body)).value).toEqual(["not-favorite-node"])
    expect(trash).toEqual(new Set(["not-favorite-node"]))
    expect(result).toMatchObject({
      success: false,
      data: {
        partial: true,
        trashedCount: 1,
        trashedKeys: ["amazon-clear"],
        trashedDedupKeys: ["not-favorite-node"],
        noOpDedupKeys: ["favorite-node"],
        unknownDedupKeys: [],
        outcomes: [
          { targetKey: "favorite-node", status: "failed", reason: "favorite-protected-noop" },
          { targetKey: "unknown-node", status: "failed", reason: "favorite-state-unknown-not-acknowledged" },
          { targetKey: "not-favorite-node", status: "confirmed" }
        ]
      }
    })
    restore()
  })

  it("allows acknowledged unknown favorite state only for the exact personal target", async () => {
    const { messages, restore } = collectMessages()
    const { fetchMock, trash } = stubAmazonMutationProvider({
      favorites: { "favorite-node": true, "not-favorite-node": false }
    })

    sendCommand("trashItems", "amazon-trash-favorite-ack", {
      dedupKeys: ["favorite-node", "unknown-node", "not-favorite-node"],
      mediaKeysToTrash: ["amazon-favorite", "amazon-unknown", "amazon-clear"],
      acknowledgedUnknownFavoriteDedupKeys: ["favorite-node", "unknown-node"]
    })
    await waitForCommandResult(messages, "trashItems", "amazon-trash-favorite-ack")

    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")
    expect(patchCalls).toHaveLength(1)
    expect(JSON.parse(String(patchCalls[0][1]?.body)).value).toEqual([
      "unknown-node",
      "not-favorite-node"
    ])
    expect(trash).toEqual(new Set(["unknown-node", "not-favorite-node"]))
    const result = messages.find(
      (msg) =>
        msg.action === "gptkResult" &&
        msg.command === "trashItems" &&
        msg.requestId === "amazon-trash-favorite-ack"
    )
    expect(result).toMatchObject({
      success: false,
      data: {
        trashedDedupKeys: ["unknown-node", "not-favorite-node"],
        notDispatchedDedupKeys: ["favorite-node"],
        outcomes: [
          { targetKey: "favorite-node", status: "failed", reason: "favorite-protected-noop" },
          { targetKey: "unknown-node", status: "confirmed" },
          { targetKey: "not-favorite-node", status: "confirmed" }
        ]
      }
    })
    restore()
  })

  it("rejects Amazon favorite acknowledgements for unrequested targets", async () => {
    const { messages, restore } = collectMessages()
    const { fetchMock } = stubAmazonMutationProvider({
      favorites: { "not-favorite-node": false }
    })

    sendCommand("trashItems", "amazon-trash-foreign-favorite-ack", {
      dedupKeys: ["not-favorite-node"],
      mediaKeysToTrash: ["amazon-clear"],
      acknowledgedUnknownFavoriteDedupKeys: ["foreign-node"]
    })
    await waitForCommandResult(
      messages,
      "trashItems",
      "amazon-trash-foreign-favorite-ack"
    )

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0)
    const result = messages.find(
      (msg) =>
        msg.action === "gptkResult" &&
        msg.command === "trashItems" &&
        msg.requestId === "amazon-trash-foreign-favorite-ack"
    )
    expect(result).toMatchObject({
      success: false,
      data: {
        notDispatchedDedupKeys: ["not-favorite-node"],
        outcomes: [
          {
            targetKey: "not-favorite-node",
            status: "failed",
            reason: "invalid-favorite-acknowledgement"
          }
        ]
      }
    })
    restore()
  })

  it("does not replay a timed-out Amazon mutation and reports unknown state", async () => {
    const { messages, restore } = collectMessages()
    const { fetchMock, trash } = stubAmazonMutationProvider({
      favorites: { "node-a": false },
      applyPatch: () => undefined,
      patchStatus: 504
    })

    sendCommand("trashItems", "amazon-trash-token", {
      dedupKeys: ["node-a"],
      mediaKeysToTrash: ["amazon-node-a"]
    })
    const result = await waitForCommandResult(
      messages,
      "trashItems",
      "amazon-trash-token"
    )
    expect(result).toMatchObject({
      success: false,
      data: {
        trashedDedupKeys: [],
        unknownDedupKeys: ["node-a"],
        retryAttempts: 0,
        outcomes: [{ targetKey: "node-a", status: "unknown" }]
      }
    })
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1)
    expect(trash).toEqual(new Set())
    restore()
  })

  it("does not treat a resolved PATCH as proof when Trash remains unchanged", async () => {
    const { messages, restore } = collectMessages()
    const { fetchMock } = stubAmazonMutationProvider({
      favorites: { "node-a": false },
      applyPatch: () => undefined
    })
    sendCommand("trashItems", "amazon-trash-resolved-no-transition", {
      dedupKeys: ["node-a"],
      mediaKeysToTrash: ["amazon-node-a"]
    })
    await waitForCommandResult(
      messages,
      "trashItems",
      "amazon-trash-resolved-no-transition"
    )
    const result = messages.find(
      (msg) =>
        msg.action === "gptkResult" &&
        msg.command === "trashItems" &&
        msg.requestId === "amazon-trash-resolved-no-transition"
    )
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1)
    expect(result).toMatchObject({
      success: false,
      data: {
        trashedDedupKeys: [],
        unknownDedupKeys: ["node-a"],
        outcomes: [{ status: "unknown", reason: "post-dispatch-trash-transition-unverified" }]
      }
    })
    restore()
  })

  it("keeps mixed exact transitions and unresolved targets separate after a partial PATCH", async () => {
    const { messages, restore } = collectMessages()
    stubAmazonMutationProvider({
      favorites: { "node-a": false, "node-b": false },
      applyPatch: (operation, ids, trash) => {
        if (operation === "add") trash.add(ids[0])
      }
    })
    sendCommand("trashItems", "amazon-trash-partial-transition", {
      dedupKeys: ["node-a", "node-b"],
      mediaKeysToTrash: ["amazon-node-a", "amazon-node-b"]
    })
    await waitForCommandResult(messages, "trashItems", "amazon-trash-partial-transition")
    const result = messages.find(
      (msg) =>
        msg.action === "gptkResult" &&
        msg.command === "trashItems" &&
        msg.requestId === "amazon-trash-partial-transition"
    )
    expect(result).toMatchObject({
      success: false,
      data: {
        partial: true,
        trashedDedupKeys: ["node-a"],
        trashedKeys: ["amazon-node-a"],
        unknownDedupKeys: ["node-b"],
        outcomes: [
          { targetKey: "node-a", status: "confirmed" },
          { targetKey: "node-b", status: "unknown" }
        ]
      }
    })
    restore()
  })

  it("does not dispatch when Trash preflight is malformed", async () => {
    const { messages, restore } = collectMessages()
    const { fetchMock } = stubAmazonMutationProvider({
      favorites: { "node-a": false },
      invalidTrashRead: true
    })
    sendCommand("trashItems", "amazon-trash-invalid-state", {
      dedupKeys: ["node-a"],
      mediaKeysToTrash: ["amazon-node-a"]
    })
    await waitForCommandResult(messages, "trashItems", "amazon-trash-invalid-state")
    const result = messages.find(
      (msg) => msg.action === "gptkResult" && msg.command === "trashItems" && msg.requestId === "amazon-trash-invalid-state"
    )
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0)
    expect(result).toMatchObject({
      success: false,
      data: { unknownDedupKeys: [], outcomes: [{ status: "failed", reason: "preflight-trash-state-unavailable" }] }
    })
    restore()
  })

  it("marks a dispatched target unknown when the Amazon owner changes before readback", async () => {
    const { messages, restore } = collectMessages()
    const { fetchMock } = stubAmazonMutationProvider({
      favorites: { "node-a": false },
      switchOwnerAfterPatch: true
    })
    sendCommand("trashItems", "amazon-trash-session-switch", {
      dedupKeys: ["node-a"],
      mediaKeysToTrash: ["amazon-node-a"]
    })
    const result = await waitForCommandResult(
      messages,
      "trashItems",
      "amazon-trash-session-switch"
    )
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1)
    expect(result).toMatchObject({
      success: false,
      data: { unknownDedupKeys: ["node-a"], outcomes: [{ status: "unknown", reason: "session-changed-after-dispatch" }] }
    })
    restore()
  })
})

// Amazon restore = same /drive/v1/trash endpoint as trash, with op:"remove".
// Exact pre/post-state checks keep Undo from reporting ambiguous requests.
describe("restoreItems", () => {
  it("allows Undo from the Trash route only after exact restore state reconciliation", async () => {
    const { messages, restore } = collectMessages()
    const { fetchMock } = stubAmazonMutationProvider({ initialTrash: ["node-a"] })
    window.history.pushState({}, "", "/photos/trash")

    try {
      sendCommand("restoreItems", "amazon-restore-trash-route", {
        dedupKeys: ["node-a"]
      })
      await waitForCommandResult(
        messages,
        "restoreItems",
        "amazon-restore-trash-route"
      )

      const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")
      expect(patchCalls).toHaveLength(1)
      expect(JSON.parse(String(patchCalls[0][1]?.body))).toMatchObject({ op: "remove", value: ["node-a"] })
      expect(
        messages.find(
          (msg) =>
            msg.action === "gptkResult" &&
            msg.command === "restoreItems" &&
            msg.requestId === "amazon-restore-trash-route"
        )
        ).toMatchObject({ success: true, data: { restoredDedupKeys: ["node-a"] } })
    } finally {
      window.history.pushState({}, "", "/photos?sf=1")
      restore()
    }
  })

  it("restores only ids proven to be in Trash and returns confirmed identities", async () => {
    const { messages, restore } = collectMessages()
    const { fetchMock } = stubAmazonMutationProvider({ initialTrash: ["node-a", "node-b"] })

    sendCommand("restoreItems", "amazon-restore", {
      dedupKeys: ["node-a", "node-b"],
      batchSize: 25
    })
    const result = await waitForCommandResult(
      messages,
      "restoreItems",
      "amazon-restore"
    )

    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")
    expect(patchCalls).toHaveLength(1)
    expect(JSON.parse(String(patchCalls[0][1]?.body))).toMatchObject({ op: "remove", value: ["node-a", "node-b"] })
    expect(result).toMatchObject({
      success: true,
      data: {
        restoredCount: 2,
        restoredDedupKeys: ["node-a", "node-b"],
        outcomes: [
          { operation: "restore", targetKey: "node-a", status: "confirmed" },
          { operation: "restore", targetKey: "node-b", status: "confirmed" }
        ]
      }
    })
    restore()
  })

  it("caps Amazon restore batches at 50 node ids", async () => {
    const { messages, restore } = collectMessages()
    const dedupKeys = Array.from({ length: 51 }, (_, index) => `node-${index}`)
    const { fetchMock } = stubAmazonMutationProvider({ initialTrash: dedupKeys })

    sendCommand("restoreItems", "amazon-restore-batches", {
      dedupKeys,
      batchSize: 999
    })
    await waitForCommandResult(
      messages,
      "restoreItems",
      "amazon-restore-batches"
    )

    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "PATCH"
    )
    expect(patchCalls).toHaveLength(2)
    expect(JSON.parse(String(patchCalls[0][1]?.body)).value).toHaveLength(50)
    expect(JSON.parse(String(patchCalls[1][1]?.body)).value).toEqual(["node-50"])
    restore()
  })

  it("distinguishes already-restored targets from actual restore operations", async () => {
    const { messages, restore } = collectMessages()
    const { fetchMock } = stubAmazonMutationProvider()
    sendCommand("restoreItems", "amazon-already-restored", { dedupKeys: ["node-a"] })
    await waitForCommandResult(messages, "restoreItems", "amazon-already-restored")

    const result = messages.find(
      (msg) =>
        msg.action === "gptkResult" &&
        msg.command === "restoreItems" &&
        msg.requestId === "amazon-already-restored"
    )
    expect(result).toMatchObject({
      success: false,
      data: { restoredDedupKeys: [], noOpDedupKeys: ["node-a"], outcomes: [{ status: "failed", reason: "already-restored-noop" }] }
    })
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0)
    restore()
  })

  it("reports a restore timeout as unknown without retrying", async () => {
    const { messages, restore } = collectMessages()
    const { fetchMock, trash } = stubAmazonMutationProvider({
      initialTrash: ["node-a"],
      patchStatus: 504
    })
    sendCommand("restoreItems", "amazon-restore-timeout", { dedupKeys: ["node-a"] })
    const result = await waitForCommandResult(
      messages,
      "restoreItems",
      "amazon-restore-timeout"
    )
    expect(result).toMatchObject({
      success: false,
      data: {
        restoredDedupKeys: [],
        unknownDedupKeys: ["node-a"],
        outcomes: [{ status: "unknown", reason: "post-dispatch-trash-transition-unverified" }]
      }
    })
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1)
    expect(trash).toEqual(new Set(["node-a"]))
    restore()
  })

  it("reports restore post-state per target when the PATCH changes only part of a batch", async () => {
    const { messages, restore } = collectMessages()
    const { fetchMock, trash } = stubAmazonMutationProvider({
      initialTrash: ["node-a", "node-b"],
      applyPatch: (operation, ids, currentTrash) => {
        if (operation === "remove") currentTrash.delete(ids[0])
      }
    })
    sendCommand("restoreItems", "amazon-restore-partial-transition", {
      dedupKeys: ["node-a", "node-b"]
    })
    const result = await waitForCommandResult(
      messages,
      "restoreItems",
      "amazon-restore-partial-transition"
    )
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1)
    expect(trash).toEqual(new Set(["node-b"]))
    expect(result).toMatchObject({
      success: false,
      data: {
        partial: true,
        restoredDedupKeys: ["node-a"],
        unknownDedupKeys: ["node-b"],
        outcomes: [
          { targetKey: "node-a", status: "confirmed" },
          { targetKey: "node-b", status: "unknown" }
        ]
      }
    })
    restore()
  })

  it("rejects restore without valid dedupKeys", async () => {
    const { messages, restore } = collectMessages()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    sendCommand("restoreItems", "amazon-restore-invalid", {})
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    const result = messages.find(
      (msg) => msg.action === "gptkResult" && msg.command === "restoreItems"
    )
    expect(result).toMatchObject({ success: false })
    expect(result.error).toContain("dedupKeys")
    restore()
  })
})

describe("Amazon parity evidence boundaries", () => {
  it.each(["library", "album"])("[SCAN-EXHAUSTION] rejects a coerced continuation-page count in %s scope", async (scope) => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const requestId = `amazon-coerced-page-count-${scope}`
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === "/drive/v1/nodes") {
        return { ok: true, json: async () => ({ count: 1, data: [amazonAlbumNode("count-control")] }) }
      }
      return { ok: true, json: async () => url.searchParams.has("startToken")
        ? { count: [2], data: [{ ...amazonNode("count-second"), kind: "FILE" }] }
        : { count: 2, data: [{ ...amazonNode("count-first"), kind: "FILE" }], nextToken: "count-second-page" }
      }
    })
    vi.stubGlobal("fetch", fetchMock)
    try {
      sendCommand("getAllMediaItems", requestId, scope === "album" ? {
        albumScope: { mediaKey: "amazon-album-count-control", isShared: false }
      } : {})
      await vi.advanceTimersByTimeAsync(1000)
      const result = await waitForCommandResult(messages, "getAllMediaItems", requestId)
      expect(result).toMatchObject({ success: true, scanCoverage: {
        status: "partial", stopReason: "pagination_error", itemsVisited: 1, itemsReturned: 1,
        itemsSkipped: 0, totalItems: 2
      } })
      expect(result.data.map((item: { mediaKey: string }) => item.mediaKey)).toEqual(["amazon-count-first"])
    } finally {
      restore()
      vi.useRealTimers()
    }
  })

  it.each(["library", "album"])("[SCAN-EXHAUSTION] stops an empty nonterminal %s page even when it advertises a cursor", async (scope) => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const requestId = `amazon-empty-cursor-page-${scope}`
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === "/drive/v1/nodes") {
        return { ok: true, json: async () => ({ count: 1, data: [amazonAlbumNode("empty-cursor-control")] }) }
      }
      return { ok: true, json: async () => url.searchParams.has("startToken")
        ? { count: 2, data: ["one", "two"].map((id) => ({ ...amazonNode(id), kind: "FILE" })) }
        : { count: 2, data: [], nextToken: "after-empty" }
      }
    })
    vi.stubGlobal("fetch", fetchMock)
    try {
      sendCommand("getAllMediaItems", requestId, scope === "album" ? {
        albumScope: { mediaKey: "amazon-album-empty-cursor-control", isShared: false }
      } : {})
      await vi.advanceTimersByTimeAsync(1000)
      const result = await waitForCommandResult(messages, "getAllMediaItems", requestId)
      expect(result).toMatchObject({ success: true, data: [], scanCoverage: {
        status: "partial", stopReason: "pagination_error", itemsVisited: 0, itemsReturned: 0,
        itemsSkipped: 0, pagesRead: 1, pageSizes: [0]
      } })
      expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).searchParams.has("startToken"))).toBe(false)
    } finally {
      restore()
      vi.useRealTimers()
    }
  })

  it("[SCAN-EXHAUSTION] advances library offsets by the delivered page size when Amazon caps pages below 200", async () => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    const nodes = Array.from({ length: 5 }, (_, index) => amazonNode(`small-page-${index}`))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const offset = Number(new URL(String(input)).searchParams.get("offset"))
      return { ok: true, json: async () => ({ count: nodes.length, data: nodes.slice(offset, offset + 2) }) }
    })
    vi.stubGlobal("fetch", fetchMock)
    try {
      sendCommand("getAllMediaItems", "amazon-provider-capped-offsets", {})
      await vi.advanceTimersByTimeAsync(2000)
      const result = await waitForCommandResult(messages, "getAllMediaItems", "amazon-provider-capped-offsets")
      expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("offset"))).toEqual(["0", "2", "4"])
      expect(result).toMatchObject({ success: true, scanCoverage: {
        status: "complete", stopReason: "exhausted", itemsVisited: 5, itemsReturned: 5,
        itemsSkipped: 0, totalItems: 5, pagesRead: 3, pageSizes: [2, 2, 1]
      } })
      expect(result.data.map((item: { mediaKey: string }) => item.mediaKey)).toEqual(nodes.map((node) => `amazon-${node.id}`))
    } finally {
      restore()
      vi.useRealTimers()
    }
  })

  it.each(["library", "album"])("[SCAN-EXHAUSTION] records the terminal empty %s page in coverage", async (scope) => {
    const { messages, restore } = collectMessages()
    const requestId = `amazon-terminal-empty-page-${scope}`
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({ ok: true, json: async () =>
      new URL(String(input)).pathname === "/drive/v1/nodes"
        ? { count: 1, data: [amazonAlbumNode("terminal-empty-control")] }
        : { count: 0, data: [] }
    })))
    try {
      sendCommand("getAllMediaItems", requestId, scope === "album" ? {
        albumScope: { mediaKey: "amazon-album-terminal-empty-control", isShared: false }
      } : {})
      const result = await waitForCommandResult(messages, "getAllMediaItems", requestId)
      expect(result).toMatchObject({ success: true, data: [], scanCoverage: {
        status: "complete", stopReason: "exhausted", itemsVisited: 0, itemsReturned: 0,
        itemsSkipped: 0, totalItems: 0, pagesRead: 1, pageSizes: [0]
      } })
    } finally { restore() }
  })

  it("[SCAN-EXHAUSTION] generated capped inventories preserve exact scoped identities and coverage partitions", async () => {
    vi.useFakeTimers()
    const { messages, restore } = collectMessages()
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async (_algorithm: string, data: ArrayBuffer) =>
      Uint8Array.from(createHash("sha256").update(Buffer.from(data)).digest()).buffer
    ) } })
    let ordinal = 0
    const roles = fc.array(fc.constantFrom("photo", "video", "outside", "unknown-date", "unsupported"), { minLength: 1, maxLength: 16 })
    try {
      await fc.assert(fc.asyncProperty(roles, fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 20 }), fc.boolean(), async (inventory, pageCap, limit, stringCount) => {
        const requestId = `amazon-generated-capped-inventory-${ordinal++}`
        const nodes = inventory.map((role, index) => {
          const id = `${requestId}-${index}`
          const base = role === "video" ? amazonVideoNode(id) : amazonNode(id)
          return {
            ...base, kind: "FILE", isShared: false, settings: { favorite: false },
            ...(role === "unknown-date" ? { createdDate: undefined } : {}),
            ...(role === "unsupported" ? { image: undefined } : {}),
            contentProperties: {
              ...base.contentProperties,
              ...(role === "unknown-date" ? { contentDate: undefined } : {}),
              ...(role === "outside" ? { contentDate: "2026-05-31T12:00:00.000Z" } : {}),
              ...(role === "unsupported" ? { contentType: "application/pdf" } : {})
            }
          }
        })
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
          const url = new URL(String(input))
          return { ok: true, json: async () => url.searchParams.get("limit") === "1"
            ? { count: nodes.length, data: [{ id: "owner-probe", ownerId: "owner-1" }] }
            : { count: stringCount ? String(nodes.length) : nodes.length, data: nodes.slice(Number(url.searchParams.get("offset")), Number(url.searchParams.get("offset")) + pageCap) }
          }
        })
        vi.stubGlobal("fetch", fetchMock)
        sendAmazonProviderCommand("getAllMediaItems", requestId, {
          providerSessionId: amazonTestSessionId, scanScopeFingerprint: requestId,
          dateRange: { from: "2026-06-01", to: "2026-06-30" }, limit
        })
        await vi.advanceTimersByTimeAsync(16000)
        const result = await waitForCommandResult(messages, "getAllMediaItems", requestId)
        const examined = inventory.slice(0, limit)
        const expectedKeys = examined.flatMap((role, index) => ["photo", "video"].includes(role) ? [`amazon-${requestId}-${index}`] : [])
        expect(result).toMatchObject({ success: true, providerSessionId: amazonTestSessionId, scanCoverage: {
          status: limit < inventory.length ? "partial" : "complete",
          stopReason: limit < inventory.length ? "user_limit" : "exhausted",
          itemsVisited: examined.length, itemsReturned: expectedKeys.length,
          itemsSkipped: examined.length - expectedKeys.length,
          unknownDateItemsSkipped: examined.filter((role) => role === "unknown-date").length,
          unmappedItemsSkipped: examined.filter((role) => role === "unsupported").length,
          mediaTypesCovered: { photos: true, videos: true }
        } })
        expect(result.data.map((item: { mediaKey: string }) => item.mediaKey)).toEqual(expectedKeys)
        expect(new Set(result.data.map((item: { mediaKey: string }) => item.mediaKey)).size).toBe(expectedKeys.length)
        expect(result.scanCoverage.itemsVisited).toBe(result.scanCoverage.itemsReturned + result.scanCoverage.itemsSkipped)
        expect(result.scanCoverage.unknownDateItemsSkipped).toBeLessThanOrEqual(result.scanCoverage.itemsSkipped)
      }), { numRuns: 80, seed: 20260930 })
    } finally {
      restore()
      vi.useRealTimers()
    }
  })

  it.each([0, 0.5, -1, Number.POSITIVE_INFINITY, Number.NaN, "2"])("[SHARED-SCAN-LIFECYCLE] rejects an invalid visit limit before provider reads (%#)", async (limit) => {
    const { messages, restore } = collectMessages()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 1, data: [amazonNode("invalid-limit-control")] }) })
    vi.stubGlobal("fetch", fetchMock)
    try {
      sendCommand("getAllMediaItems", "amazon-invalid-visit-limit", { limit })
      const result = await waitForCommandResult(messages, "getAllMediaItems", "amazon-invalid-visit-limit")
      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/limit/i), scanCoverage: { status: "failed", itemsVisited: 0 } })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally { restore() }
  })
  it("[CONTENT-IDENTITY] rejects a same-size original change between download and exact-node revalidation", async () => {
    const provider = await stubAmazonOriginalProvider("amazon-content-version-drift")
    provider.setDownload(async () => {
      provider.changeChecksum()
      return new Response(provider.bytes.slice(), { status: 200, headers: { "content-type": "image/jpeg" } })
    })
    try {
      const result = await provider.hash("amazon-same-size-content-change")
      expect(result).toMatchObject({ success: false })
      expect(result.data).toBeUndefined()
    } finally { provider.restore() }
  })

  it.each(["declared", "streamed"])("[CONTENT-IDENTITY] rejects %s byte overflow without returning a digest", async (mode) => {
    const provider = await stubAmazonOriginalProvider(`amazon-overflow-${mode}`)
    provider.setDownload(async () => new Response(new Uint8Array(5), { status: 200, headers: {
      "content-type": "image/jpeg", ...(mode === "declared" ? { "content-length": "5" } : {})
    } }))
    try {
      const result = await provider.hash(`amazon-original-${mode}-overflow`)
      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/byte|budget/i) })
      expect(result.data).toBeUndefined()
    } finally { provider.restore() }
  })

  it("[CONTENT-IDENTITY] aborts original download through the public cancellation command", async () => {
    const scope = "amazon-cancel-original-scope"
    const provider = await stubAmazonOriginalProvider(scope)
    let started!: () => void
    const downloadStarted = new Promise<void>((resolve) => { started = resolve })
    let downloadSignal: AbortSignal | undefined
    provider.setDownload(async (signal) => {
      downloadSignal = signal
      started()
      return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }))
    })
    try {
      const resultPromise = provider.hash("amazon-public-original-cancel")
      await downloadStarted
      sendAmazonProviderCommand("cancelProviderRequest", "amazon-public-original-cancel-command", {
        targetRequestId: "amazon-public-original-cancel", providerSessionId: amazonTestSessionId, scanScopeFingerprint: scope
      })
      const result = await resultPromise
      expect(downloadSignal?.aborted).toBe(true)
      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/cancelled|timed out/i) })
      expect(result.data).toBeUndefined()
    } finally { provider.restore() }
  })

  it.each(["owner", "scope"])("[CONTENT-IDENTITY] discards a fetched original after %s drift", async (drift) => {
    const scope = `amazon-original-${drift}-drift`
    const provider = await stubAmazonOriginalProvider(scope)
    provider.setDownload(async () => {
      if (drift === "owner") provider.changeOwner()
      else {
        sendAmazonProviderCommand("getAllMediaItems", "amazon-new-review-scope", {
          providerSessionId: amazonTestSessionId, scanScopeFingerprint: `${scope}-new`
        })
        await waitForCommandResult(provider.messages, "getAllMediaItems", "amazon-new-review-scope")
      }
      return new Response(provider.bytes.slice(), { status: 200, headers: { "content-type": "image/jpeg" } })
    })
    try {
      const result = await provider.hash(`amazon-original-${drift}-result`)
      expect(result).toMatchObject({ success: false })
      expect(result.data).toBeUndefined()
      expect(JSON.stringify(result)).not.toContain("download-photos")
      expect(JSON.stringify(result)).not.toContain("owner-1")
    } finally { provider.restore() }
  })

  it.each(["redirect", "mime", "non-streaming"])("[CONTENT-IDENTITY] rejects %s original responses without leaking transport data", async (mode) => {
    const provider = await stubAmazonOriginalProvider(`amazon-original-invalid-${mode}`)
    provider.setDownload(async () => mode === "redirect"
      ? { ok: true, status: 200, redirected: true, url: "https://unapproved.invalid/private?token=secret" }
      : mode === "non-streaming"
        ? { ok: true, status: 200, headers: { get: () => null }, body: {} }
        : new Response(provider.bytes.slice(), { status: 200, headers: { "content-type": "text/html" } })
    )
    try {
      const result = await provider.hash(`amazon-original-invalid-${mode}-result`)
      expect(result).toMatchObject({ success: false })
      expect(result.data).toBeUndefined()
      expect(JSON.stringify(result)).not.toContain("unapproved.invalid")
      expect(JSON.stringify(result)).not.toContain("token=secret")
    } finally { provider.restore() }
  })
  it("[FAVORITE-RACE-BOUNDARY] records the current non-conditional Trash window after favorite preflight", async () => {
    const { messages, restore } = collectMessages()
    const favorites = { "race-fixture": false }
    const { fetchMock, trash } = stubAmazonMutationProvider({ favorites })
    const providerFetch = fetchMock.getMockImplementation()!
    let favoriteChangedAfterLookup = false
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname === "/drive/v1/trash" && init?.method === "PATCH") {
        // Diagnostic counterexample: the provider changes after the last read.
        // This is not a live-provider assertion or proof of atomic protection.
        favorites["race-fixture"] = true
        favoriteChangedAfterLookup = true
      }
      return providerFetch(input, init)
    })
    try {
      sendCommand("trashItems", "amazon-favorite-after-preflight-race", { dedupKeys: ["race-fixture"], mediaKeysToTrash: ["amazon-race-fixture"] })
      const result = await waitForCommandResult(messages, "trashItems", "amazon-favorite-after-preflight-race")
      expect(favoriteChangedAfterLookup).toBe(true)
      expect(favorites["race-fixture"]).toBe(true)
      expect(trash.has("race-fixture")).toBe(true)
      expect(result).toMatchObject({ data: { outcomes: [{ targetKey: "race-fixture", status: "confirmed" }] } })
    } finally { restore() }
  })
  it("[INCREMENTAL-SEMANTICS] refreshes an authoritative inventory so edited old items replace cache and deleted items stay absent", async () => {
    const { messages, restore } = collectMessages()
    const edited = { ...amazonNodeWithCreatedDate("edited-old-item", "2026-06-01T00:00:00.000Z"), image: { width: 2400, height: 1600 } }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 1, data: [edited] }) }))
    try {
      sendCommand("getAllMediaItems", "amazon-authoritative-refresh", { sinceTimestamp: Date.parse("2026-06-20T00:00:00.000Z") })
      const result = await waitForCommandResult(messages, "getAllMediaItems", "amazon-authoritative-refresh")
      expect(result).toMatchObject({ data: [{ mediaKey: "amazon-edited-old-item", resWidth: 2400 }], scanCoverage: {
        status: "complete", stopReason: "exhausted", itemsVisited: 1, itemsReturned: 1, itemsSkipped: 0, totalItems: 1
      } })
      const cachedTimestamp = Date.parse("2026-06-01T00:00:00.000Z")
      const cached = {
        "amazon-deleted-item": { mediaKey: "amazon-deleted-item", dedupKey: "deleted-item", thumb: "https://example.invalid/deleted.jpg", timestamp: cachedTimestamp, creationTimestamp: cachedTimestamp },
        "amazon-edited-old-item": { mediaKey: "amazon-edited-old-item", dedupKey: "edited-old-item", thumb: "https://example.invalid/old.jpg", resWidth: 1200, timestamp: cachedTimestamp, creationTimestamp: cachedTimestamp }
      }
      expect(mergeCachedScanResults(result.data, cached, result.scanCoverage)).toEqual(result.data)
      expect(result.data.map((item: { mediaKey: string }) => item.mediaKey)).not.toContain("amazon-deleted-item")
    } finally { restore() }
  })

  it("[AMAZON-ALBUM-LISTING] preserves a canonical album ID when the provider uses its nodeId alias", async () => {
    const { messages, restore } = collectMessages()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 1, data: [{
      ...amazonAlbumNode("aliased-personal"), id: undefined, nodeId: "aliased-personal"
    }] }) }))
    try {
      sendCommand("listAlbums", "amazon-album-canonical-alias", {})
      const result = await waitForCommandResult(messages, "listAlbums", "amazon-album-canonical-alias")
      expect(result).toMatchObject({ success: true, data: [{ mediaKey: "amazon-album-aliased-personal", isShared: false }] })
    } finally { restore() }
  })

  it("[SHARED-ALBUM-EXCLUSION] rejects an explicitly shared caller scope before any provider read", async () => {
    const { messages, restore } = collectMessages()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    try {
      sendCommand("getAllMediaItems", "amazon-explicit-shared-scope", { albumScope: {
        mediaKey: "amazon-album-shared-control", isShared: true
      } })
      const result = await waitForCommandResult(messages, "getAllMediaItems", "amazon-explicit-shared-scope")
      expect(result).toMatchObject({ success: false, scanCoverage: { status: "failed", stopReason: "unsupported_scope", itemsVisited: 0 } })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally { restore() }
  })

  it("[SCAN-EXHAUSTION] counts a duplicated page identity only once", async () => {
    const { messages, restore } = collectMessages()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      count: 2, data: [amazonNode("duplicated-id"), amazonNode("duplicated-id")]
    }) }))
    try {
      sendCommand("getAllMediaItems", "amazon-unique-visited-ids", {})
      const result = await waitForCommandResult(messages, "getAllMediaItems", "amazon-unique-visited-ids")
      expect(result.scanCoverage).toMatchObject({ status: "partial", stopReason: "pagination_error", itemsVisited: 1, itemsReturned: 1, itemsSkipped: 0 })
    } finally { restore() }
  })

  it("[MUTATION-AMBIGUITY] rejects a Trash preflight whose terminal count still advertises another page", async () => {
    const { messages, restore } = collectMessages()
    const { fetchMock, trash } = stubAmazonMutationProvider({ favorites: { "guarded-target": false } })
    const providerFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname === "/drive/v1/trash" && init?.method !== "PATCH") {
        return { ok: true, json: async () => ({ count: 0, data: [], nextToken: "unread-trash-page" }) }
      }
      return providerFetch(input, init)
    })
    try {
      sendCommand("trashItems", "amazon-unread-trash-preflight", { dedupKeys: ["guarded-target"], mediaKeysToTrash: ["amazon-guarded-target"] })
      const result = await waitForCommandResult(messages, "trashItems", "amazon-unread-trash-preflight")
      expect(result).toMatchObject({ data: { notDispatchedDedupKeys: ["guarded-target"], unknownDedupKeys: [], outcomes: [{
        status: "failed", reason: "preflight-trash-state-unavailable"
      }] } })
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0)
      expect(trash.size).toBe(0)
    } finally { restore() }
  })

  it("[FAVORITE-PROTECTION] generated favorite-field combinations never downgrade positive evidence", async () => {
    const { messages, restore } = collectMessages()
    let ordinal = 0
    const favoriteField = fc.constantFrom(true, false, undefined, "true", 1, null)
    try {
      await fc.assert(fc.asyncProperty(fc.tuple(favoriteField, favoriteField, favoriteField, favoriteField), async (fields) => {
        const requestId = `amazon-generated-favorite-${ordinal++}`
        const [setting, direct, contentFavorite, contentIsFavorite] = fields
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 1, data: [{
          ...amazonNode(requestId), isShared: false, settings: { favorite: setting }, isFavorite: direct,
          contentProperties: { ...amazonNode(requestId).contentProperties, favorite: contentFavorite, isFavorite: contentIsFavorite }
        }] }) }))
        sendCommand("getAllMediaItems", requestId, {})
        const result = await waitForCommandResult(messages, "getAllMediaItems", requestId)
        const expected = fields.includes(true) ? "favorite" : fields.includes(false) ? "not-favorite" : "unknown"
        expect(result.data[0].favoriteStatus).toBe(expected)
        if (expected === "unknown") expect(result.data[0].isFavorite).toBeUndefined()
        expect(result.scanCoverage.itemsVisited).toBe(result.scanCoverage.itemsReturned + result.scanCoverage.itemsSkipped)
      }), { numRuns: 128, seed: 20260930 })
    } finally { restore() }
  })

  it("[SCAN-EXHAUSTION] generated count-equal pages with unread cursors never become complete", async () => {
    const { messages, restore } = collectMessages()
    let ordinal = 0
    try {
      await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 1, max: 100000 }), async (count, token) => {
        const requestId = `amazon-generated-unread-cursor-${ordinal++}`
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
          count, data: Array.from({ length: count }, (_, index) => amazonNode(`${requestId}-${index}`)), nextToken: `unread-${token}`
        }) })
        vi.stubGlobal("fetch", fetchMock)
        sendCommand("getAllMediaItems", requestId, {})
        const result = await waitForCommandResult(messages, "getAllMediaItems", requestId)
        expect(result.scanCoverage.status).not.toBe("complete")
        expect(result.scanCoverage.itemsVisited).toBe(result.scanCoverage.itemsReturned + result.scanCoverage.itemsSkipped)
        expect(fetchMock).toHaveBeenCalledTimes(1)
      }), { numRuns: 128, seed: 20260931 })
    } finally { restore() }
  })
  it.each([
    { settings: { favorite: false }, isFavorite: true },
    { settings: { favorite: false }, contentProperties: { favorite: true } },
    { isFavorite: false, contentProperties: { isFavorite: true } },
    { contentProperties: { favorite: false, isFavorite: true } }
  ])("[FAVORITE-PROTECTION] preserves positive favorite evidence despite contradictory metadata (%#)", async (fields) => {
    const { messages, restore } = collectMessages()
    const node = amazonNode("contradictory-favorite")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ count: 1, data: [{
        ...node,
        settings: undefined,
        ...fields,
        contentProperties: { ...node.contentProperties, ...fields.contentProperties }
      }] })
    }))
    try {
      sendCommand("getAllMediaItems", "amazon-contradictory-favorite", {})
      const result = await waitForCommandResult(messages, "getAllMediaItems", "amazon-contradictory-favorite")
      expect(result).toMatchObject({
        success: true,
        data: [{ isFavorite: true, favoriteStatus: "favorite", favoriteSource: "provider-metadata" }]
      })
    } finally { restore() }
  })

  it("[FAVORITE-PROTECTION] refuses Trash when any exact-node field confirms favorite", async () => {
    const { messages, restore } = collectMessages()
    const { fetchMock, trash } = stubAmazonMutationProvider({ favorites: { "conflicting-favorite": false } })
    const providerFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await providerFetch(input, init)
      if (new URL(String(input)).pathname === "/drive/v1/nodes/conflicting-favorite") {
        const node = await response.json?.()
        if (!node || !("id" in node)) throw new Error("The exact-node fixture did not return node metadata.")
        return { ok: true, json: async () => ({ ...node, isFavorite: true }) }
      }
      return response
    })
    try {
      sendCommand("trashItems", "amazon-trash-conflicting-favorite", {
        dedupKeys: ["conflicting-favorite"], mediaKeysToTrash: ["amazon-conflicting-favorite"]
      })
      const result = await waitForCommandResult(messages, "trashItems", "amazon-trash-conflicting-favorite")
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0)
      expect(trash.size).toBe(0)
      expect(result).toMatchObject({ data: {
        trashedDedupKeys: [], notDispatchedDedupKeys: ["conflicting-favorite"],
        outcomes: [{ targetKey: "conflicting-favorite", status: "failed", reason: "favorite-protected-noop" }]
      } })
    } finally { restore() }
  })

  it("[AMAZON-ALBUM-LISTING] rejects a non-shared album belonging to another Photos owner", async () => {
    const { messages, restore } = collectMessages()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => new URL(String(input)).pathname === "/drive/v1/search"
        ? { count: 1, data: [{ id: "owner-probe", ownerId: "owner-1" }] }
        : { count: 1, data: [{ ...amazonAlbumNode("foreign-personal"), ownerId: "other-owner" }] }
    }))
    vi.stubGlobal("fetch", fetchMock)
    try {
      sendAmazonProviderCommand("listAlbums", "amazon-foreign-album-owner", { providerSessionId: amazonTestSessionId })
      const result = await waitForCommandResult(messages, "listAlbums", "amazon-foreign-album-owner")
      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/owner|personal library/i) })
      expect(result.data).toBeUndefined()
    } finally { restore() }
  })

  it.each([0, 1])("[AMAZON-ALBUM-LISTING] rejects a terminal count with a live continuation token (count=%i)", async (count) => {
    const { messages, restore } = collectMessages()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      count, data: count === 0 ? [] : [amazonAlbumNode("declared-terminal")], nextToken: "unread-page"
    }) }))
    try {
      sendCommand("listAlbums", "amazon-album-unread-terminal", {})
      const result = await waitForCommandResult(messages, "listAlbums", "amazon-album-unread-terminal")
      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/cursor|token|continuation|count/i) })
    } finally { restore() }
  })

  it.each([true, 17, {}, "   "])("[SCAN-EXHAUSTION] rejects malformed Amazon continuation fields (%#)", async (nextToken) => {
    const { messages, restore } = collectMessages()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 1, data: [amazonNode("invalid-cursor")], nextToken }) }))
    try {
      sendCommand("getAllMediaItems", "amazon-invalid-cursor", {})
      const result = await waitForCommandResult(messages, "getAllMediaItems", "amazon-invalid-cursor")
      expect(result.scanCoverage?.status).not.toBe("complete")
    } finally { restore() }
  })

  it.each([0, 1])("[SCAN-EXHAUSTION] preserves incomplete coverage when count matches but a cursor remains (count=%i)", async (count) => {
    const { messages, restore } = collectMessages()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      count, data: count === 0 ? [] : [amazonNode("unread-terminal")], nextToken: "unread-page"
    }) }))
    try {
      sendCommand("getAllMediaItems", "amazon-media-unread-terminal", {})
      const result = await waitForCommandResult(messages, "getAllMediaItems", "amazon-media-unread-terminal")
      expect(result.scanCoverage?.status).not.toBe("complete")
    } finally { restore() }
  })

  it("[SCAN-EXHAUSTION] does not accept a media page above its requested 200-record cap", async () => {
    const { messages, restore } = collectMessages()
    const nodes = Array.from({ length: 201 }, (_, index) => amazonNode(`over-cap-${index}`))
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: nodes.length, data: nodes }) }))
    try {
      sendCommand("getAllMediaItems", "amazon-media-over-cap", {})
      const result = await waitForCommandResult(messages, "getAllMediaItems", "amazon-media-over-cap")
      expect(result.scanCoverage?.status).not.toBe("complete")
    } finally { restore() }
  })

  it("[SCAN-EXHAUSTION] cannot prove exhaustive coverage from records missing media identities", async () => {
    const { messages, restore } = collectMessages()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      count: 2, data: [amazonNode("known-id"), { ...amazonNode("missing-id"), id: undefined }]
    }) }))
    try {
      sendCommand("getAllMediaItems", "amazon-media-missing-id", {})
      const result = await waitForCommandResult(messages, "getAllMediaItems", "amazon-media-missing-id")
      expect(result.scanCoverage).toMatchObject({ status: "partial", stopReason: "coverage_unknown", itemsVisited: 2, itemsReturned: 1, itemsSkipped: 1 })
    } finally { restore() }
  })

  it("[MIXED-MEDIA-DATES] excludes unsupported media and accounts for the skipped record", async () => {
    const { messages, restore } = collectMessages()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 1, data: [{
      ...amazonNode("unsupported-media"), image: undefined,
      contentProperties: { contentType: "application/pdf", size: 100 }
    }] }) }))
    try {
      sendCommand("getAllMediaItems", "amazon-unsupported-media", {})
      const result = await waitForCommandResult(messages, "getAllMediaItems", "amazon-unsupported-media")
      expect(result).toMatchObject({ success: true, data: [], scanCoverage: {
        itemsVisited: 1, itemsReturned: 0, itemsSkipped: 1, unmappedItemsSkipped: 1
      } })
    } finally { restore() }
  })

  it("[METADATA-PROVENANCE] does not coerce booleans or arrays into media measurements", async () => {
    const { messages, restore } = collectMessages()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 1, data: [{
      ...amazonVideoNode("invalid-numeric-metadata"),
      video: { width: true, height: [2], durationSeconds: true },
      contentProperties: { contentType: "video/mp4", size: true }
    }] }) }))
    try {
      sendCommand("getAllMediaItems", "amazon-invalid-numeric-metadata", {})
      const result = await waitForCommandResult(messages, "getAllMediaItems", "amazon-invalid-numeric-metadata")
      expect(result.data).toHaveLength(1)
      expect(result.data[0].resWidth).toBeUndefined()
      expect(result.data[0].resHeight).toBeUndefined()
      expect(result.data[0].duration).toBeUndefined()
      expect(result.data[0].size).toBeUndefined()
    } finally { restore() }
  })

  it.each(["invalid-md5", true, { digest: "abcdef0123456789abcdef0123456789" }])("[CONTENT-IDENTITY] excludes malformed checksums from both evidence interfaces (%#)", async (md5) => {
    const { messages, restore } = collectMessages()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 1, data: [{
      ...amazonNode("invalid-checksum"), contentProperties: { ...amazonNode("invalid-checksum").contentProperties, md5 }
    }] }) }))
    try {
      sendCommand("getAllMediaItems", "amazon-invalid-checksum", {})
      const result = await waitForCommandResult(messages, "getAllMediaItems", "amazon-invalid-checksum")
      expect(result.data[0].contentHash).toBeUndefined()
      expect(result.data[0].exactContentHash).toBeUndefined()
    } finally { restore() }
  })

  it("[SESSION-TRANSITION] rejects foreign-owner media before returning a limited scan", async () => {
    const { messages, restore } = collectMessages()
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({ ok: true, json: async () => {
      const url = new URL(String(input))
      return url.searchParams.get("limit") === "1"
        ? { count: 1, data: [{ id: "owner-probe", ownerId: "owner-1" }] }
        : { count: 3, data: [amazonNode("current-owner-media"), { ...amazonNode("changed-owner-media"), ownerId: "other-owner" }] }
    } })))
    try {
      sendAmazonProviderCommand("getAllMediaItems", "amazon-limited-owner-transition", {
        providerSessionId: amazonTestSessionId, scanScopeFingerprint: "amazon-owner-transition-scope", limit: 2
      })
      const result = await waitForCommandResult(messages, "getAllMediaItems", "amazon-limited-owner-transition")
      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/owner|account|personal library/i) })
      expect(result.data).toBeUndefined()
    } finally { restore() }
  })
})
