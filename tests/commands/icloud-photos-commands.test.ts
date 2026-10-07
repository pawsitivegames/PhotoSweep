/**
 * Tests for scripts/icloud-photos-commands.js.
 *
 * @vitest-environment happy-dom
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import fc from "fast-check"
import {
  providerParityFixtureTimestamp,
  providerParityMixedMediaDatesV3
} from "../fixtures/provider-parity-mixed-media-dates-v3"

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
  await import("../../scripts/icloud-photos-commands.js")
})

describe("iCloud regional host contract", () => {
  it("accepts bare and www hosts for both supported iCloud regions", () => {
    const api = (window as any).__GPD_ICLOUD_COMMAND_TEST_API__ as {
      isIcloudPhotosHost: (hostname: string) => boolean
      isIcloudPhotosLocation: (locationLike: {
        hostname: string
        pathname: string
      }) => boolean
    }

    for (const hostname of [
      "icloud.com",
      "www.icloud.com",
      "icloud.com.cn",
      "www.icloud.com.cn"
    ]) {
      expect(api.isIcloudPhotosHost(hostname)).toBe(true)
      expect(
        api.isIcloudPhotosLocation({ hostname, pathname: "/photos" })
      ).toBe(true)
    }
    expect(api.isIcloudPhotosHost("support.icloud.com")).toBe(false)
    expect(
      api.isIcloudPhotosLocation({
        hostname: "www.icloud.com",
        pathname: "/account"
      })
    ).toBe(false)
  })
})

describe("iCloud shell health routing", () => {
  it("uses the embedded Photos application frame as the session authority", async () => {
    const originalBody = document.body.innerHTML
    const originalUrl = window.location.href
    const querySelectorAll = document.querySelectorAll.bind(document)
    const frameQuerySpy = vi.spyOn(document, "querySelectorAll")
    const { messages, restore } = collectMessages()

    try {
      ;(window as any).happyDOM.setURL("https://www.icloud.com/photos/#/")
      frameQuerySpy.mockImplementation((selectors) => {
        if (selectors === "iframe") {
          return [
            { src: "https://icloud.com/applications/photos" }
          ] as unknown as NodeListOf<Element>
        }
        return querySelectorAll(selectors)
      })

      sendCommand("healthCheck", "icloud-wrapper-health", {})
      await flushProviderWork()

      expect(
        messages.filter(
          (message) => message.requestId === "icloud-wrapper-health"
        )
      ).toHaveLength(0)

      frameQuerySpy.mockRestore()
      document.body.innerHTML = ""
      ;(window as any).happyDOM.setURL("https://icloud.com/applications/photos")
      sendCommand("healthCheck", "icloud-app-health", {})
      await flushProviderWork()

      const appHealth = messages.find(
        (message) => message.requestId === "icloud-app-health"
      )
      expect(appHealth).toMatchObject({
        action: "gptkResult",
        command: "healthCheck",
        success: true,
        data: {
          hasGptk: true,
          health: {
            status: "ready",
            provider: "icloud"
          }
        },
        providerSessionId: expect.any(String)
      })
    } finally {
      frameQuerySpy.mockRestore()
      ;(window as any).happyDOM.setURL(originalUrl)
      document.body.innerHTML = originalBody
      restore()
    }
  })
})

describe("iCloud account identity", () => {
  it.each([
    ["photo caption", '<div>Holiday photo from unrelated@example.test</div>'],
    ["file name", '<div aria-label="unrelated@example.test.jpg">Photo</div>'],
    ["image alternative", '<img alt="unrelated@example.test" title="unrelated@example.test">'],
    ["generic email class", '<span class="email">unrelated@example.test</span>'],
    ["unscoped signed-in label", '<div aria-label="Signed in as unrelated@example.test"></div>'],
    ["conflicting account labels", '<ui-menu-item aria-label="Signed in as first@example.test"></ui-menu-item><ui-menu-item aria-label="Signed in as second@example.test"></ui-menu-item>']
  ])("[PARITY-02] does not use %s as a signed-in account", async (_label, html) => {
    const originalBody = document.body.innerHTML
    const api = (window as any).__GPD_ICLOUD_COMMAND_TEST_API__ as {
      discoverIcloudAccountEmail: () => Promise<string>
    }
    try {
      document.body.innerHTML = html
      await expect(api.discoverIcloudAccountEmail()).resolves.toBe("")
    } finally {
      document.body.innerHTML = originalBody
    }
  })

  it("reads the signed-in email from the account popover when available", async () => {
    const originalBody = document.body.innerHTML
    document.body.innerHTML = '<div>Photo from unrelated@example.test</div><button aria-label="Account"></button>'
    const accountButton = document.querySelector(
      '[aria-label="Account"]'
    ) as HTMLButtonElement
    accountButton.addEventListener("click", () => {
      const menu = document.createElement("ui-menu-item")
      menu.setAttribute(
        "aria-label",
        "You are signed in as Pawsitive Games, pawsitivegames@gmail.com"
      )
      document.body.append(menu)
    })
    const api = (window as any).__GPD_ICLOUD_COMMAND_TEST_API__ as {
      discoverIcloudAccountEmail: () => Promise<string>
    }
    await expect(api.discoverIcloudAccountEmail()).resolves.toBe(
      "pawsitivegames@gmail.com"
    )
    document.body.innerHTML = originalBody
  })

  it.each(["listAlbums", "getAllMediaItems"])("[PARITY-02] rejects a %s response after an account change", async (command) => {
    const originalBody = document.body.innerHTML
    const originalUrl = window.location.href
    const { messages, restore } = collectMessages()
    ;(window as any).happyDOM.setURL("https://icloud.com/applications/photos")
    const accountLabel = (email: string) => {
      document.body.innerHTML = `<ui-menu-item aria-label="Signed in as ${email}"></ui-menu-item>`
    }
    const performanceSpy = vi.spyOn(window.performance, "getEntriesByType").mockReturnValue([
      {
        name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
      } as PerformanceEntry
    ])
    let mediaPageCalls = 0
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/internal/records/query/batch?")) {
        return {
          ok: true,
          json: async () => ({
            batch: [{ records: [{ fields: { itemCount: { value: 1 } } }] }]
          })
        } as Response
      }
      mediaPageCalls += 1
      return {
        ok: true,
        json: async () => {
          accountLabel("changed-during-page@example.test")
          return {
            records: command === "listAlbums"
              ? [{
                  recordType: "CPLAlbum", recordName: "personal-album",
                  fields: { albumNameEnc: { value: btoa("Personal album") }, albumType: { value: 0 } }
                }]
              : [{
                  recordType: "CPLMaster", recordName: "original-master",
                  fields: {
                    itemType: { value: "public.jpeg" },
                    resJPEGThumbRes: { value: { downloadURL: "https://cvws-h2.icloud-content.com/B/thumb/photo.jpg" } }
                  }
                }, {
                  recordType: "CPLAsset", recordName: "original-asset",
                  fields: { masterRef: { value: { recordName: "original-master" } } }
                }]
          }
        }
      } as Response
    })
    try {
      accountLabel("before-page@example.test")
      const healthId = `icloud-page-race-health-${command}`
      sendCommand("healthCheck", healthId, {}, "icloud")
      const health = await waitForProviderResult(messages, healthId)
      expect(health).toMatchObject({ success: true, data: { accountEmail: "before-page@example.test" } })
      const requestId = `icloud-page-race-${command}`
      sendCommand(command, requestId, { providerSessionId: health.providerSessionId }, "icloud")
      const result = await waitForProviderResult(messages, requestId)
      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/account changed/i) })
      expect(result.data).toBeUndefined()
      expect(mediaPageCalls).toBe(1)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      ;(window as any).happyDOM.setURL(originalUrl)
      document.body.innerHTML = originalBody
      restore()
    }
  })

  it("rotates the provider session when the signed-in account changes", async () => {
    const originalBody = document.body.innerHTML
    const originalUrl = window.location.href
    const { messages, restore } = collectMessages()
    ;(window as any).happyDOM.setURL("https://www.icloud.com/photos/#/")

    const setAccountEmail = (email: string) => {
      document.body.innerHTML = '<button aria-label="Account"></button>'
      document
        .querySelector('[aria-label="Account"]')
        ?.addEventListener("click", () => {
          const menu = document.createElement("ui-menu-item")
          menu.setAttribute("aria-label", `Signed in as ${email}`)
          document.body.append(menu)
        })
    }

    try {
      setAccountEmail("first@example.com")
      sendCommand("healthCheck", "icloud-account-first", {})
      await flushProviderWork()
      const firstHealth = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "healthCheck" &&
          msg.requestId === "icloud-account-first"
      )
      expect(firstHealth).toMatchObject({
        success: true,
        data: { accountEmail: "first@example.com" },
        providerSessionId: expect.any(String)
      })
      const firstSessionId = firstHealth.providerSessionId

      setAccountEmail("second@example.com")
      // The app may not have completed a health check between a provider-page
      // account switch and an album request. The adapter must revalidate the
      // account inside listAlbums instead of trusting the old opaque session.
      sendCommand("listAlbums", "icloud-race-session-albums", {
        providerSessionId: firstSessionId
      })
      await flushProviderWork()
      const raceAlbumResult = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "listAlbums" &&
          msg.requestId === "icloud-race-session-albums"
      )
      expect(raceAlbumResult).toMatchObject({
        success: false,
        error: expect.stringMatching(/account changed/i)
      })

      sendCommand("healthCheck", "icloud-account-second", {})
      await flushProviderWork()
      const secondHealth = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "healthCheck" &&
          msg.requestId === "icloud-account-second"
      )
      expect(secondHealth.providerSessionId).not.toBe(firstSessionId)

      sendCommand("getAllMediaItems", "icloud-old-session", {
        providerSessionId: firstSessionId
      })
      await flushProviderWork()
      const staleResult = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "getAllMediaItems" &&
          msg.requestId === "icloud-old-session"
      )
      expect(staleResult).toMatchObject({
        success: false,
        error: expect.stringMatching(/account changed/i)
      })

      sendCommand("listAlbums", "icloud-old-session-albums", {
        providerSessionId: firstSessionId
      })
      await flushProviderWork()
      const staleAlbumResult = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "listAlbums" &&
          msg.requestId === "icloud-old-session-albums"
      )
      expect(staleAlbumResult).toMatchObject({
        success: false,
        error: expect.stringMatching(/account changed/i)
      })
    } finally {
      ;(window as any).happyDOM.setURL(originalUrl)
      document.body.innerHTML = originalBody
      restore()
    }
  })

  it("uses the opaque page session when the account email is unavailable", async () => {
    const originalBody = document.body.innerHTML
    const originalUrl = window.location.href
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([])
    const { messages, restore } = collectMessages()

    try {
      ;(window as any).happyDOM.setURL("https://www.icloud.com/photos/#/")
      document.body.innerHTML = ""
      sendCommand("listAlbums", "icloud-session-fallback", {
        providerSessionId: (window as any).__GPD_COMMAND_HOST__.providerSessionId
      })
      // The adapter deliberately waits briefly for a CloudKit query resource;
      // let that bounded discovery finish before restoring the test fixture.
      await new Promise((resolve) => setTimeout(resolve, 2200))

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "listAlbums" &&
          msg.requestId === "icloud-session-fallback"
      )
      expect(result).toMatchObject({
        success: false,
        error: expect.stringMatching(/needs a signed-in CloudKit session/i)
      })
      expect(result.error).not.toMatch(/could not revalidate/i)
    } finally {
      ;(window as any).happyDOM.setURL(originalUrl)
      document.body.innerHTML = originalBody
      performanceSpy.mockRestore()
      restore()
    }
  })
})

function sendCommand(
  command: string,
  requestId: string,
  args: unknown,
  provider?: string
) {
  let commandArgs = args
  if (command === "getAllMediaItems") {
    const sourceArgs =
      args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {}
    commandArgs = {
      ...sourceArgs,
      scanScopeFingerprint:
        sourceArgs.scanScopeFingerprint || "icloud-command-test-scope"
    }
  } else if (command === "getOriginalContentHash") {
    const sourceArgs =
      args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {}
    commandArgs = {
      ...sourceArgs,
      ...(!Object.prototype.hasOwnProperty.call(sourceArgs, "aggregateBudgetBytes")
        ? { aggregateBudgetBytes: 100 * 1024 * 1024 }
        : {})
    }
  } else if (command === "trashItems" || command === "restoreItems") {
    const sourceArgs =
      args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {}
    commandArgs = {
        ...sourceArgs,
        ...(!Object.prototype.hasOwnProperty.call(sourceArgs, "providerSessionId")
        ? {
            providerSessionId: (window as any).__GPD_COMMAND_HOST__
              ?.requireCurrentDocumentSession()
          }
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
        args: commandArgs,
        ...(provider ? { provider } : {})
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

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function flushProviderWork() {
  for (let attempt = 0; attempt < 6; attempt += 1) await flush()
}

async function waitForProviderResult(messages: any[], requestId: string) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const result = messages.find(
      (message) =>
        message.requestId === requestId && message.action === "gptkResult"
    )
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for provider request ${requestId}.`)
}

describe("iCloud album listing capability", () => {
  it("[PARITY-03] lists personal albums and recursively includes folder albums", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const albumRecord = (
      recordName: string,
      title: string,
      albumType = 0,
      extraFields: Record<string, unknown> = {}
    ) => ({
      recordName,
      recordType: "CPLAlbum",
      fields: {
        albumNameEnc: { value: btoa(title) },
        albumType: { value: albumType },
        ...extraFields
      }
    })
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body || "{}"))
        expect(body.zoneID).toEqual({ zoneName: "PrimarySync" })
        expect(body.query.recordType).toBe("CPLAlbumByPositionLive")
        if (body.query.filterBy?.[0]?.fieldName === "parentId") {
          expect(body.query.filterBy[0].fieldValue.value).toBe("folder-1")
          return {
            ok: true,
            json: async () => ({
              records: [
                albumRecord("album-nested", "Beach", 0, {
                  parentId: { value: "folder-1" }
                })
              ]
            })
          } as Response
        }
        return {
          ok: true,
          json: async () => ({
            records: [
              { recordName: "----Root-Folder----", recordType: "CPLAlbum" },
              albumRecord("album-vacation", "Vacation"),
              albumRecord("folder-1", "Trips", 3),
              albumRecord("album-deleted", "Deleted", 0, {
                isDeleted: { value: 1 }
              })
            ]
          })
        } as Response
      })
    try {
      sendCommand("listAlbums", "icloud-albums-personal", {})
      await new Promise((resolve) => setTimeout(resolve, 120))

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "listAlbums" &&
          msg.requestId === "icloud-albums-personal"
      )
      expect(result).toMatchObject({
        success: true,
        data: [
          {
            mediaKey: "icloud-album-album-nested",
            title: "Trips / Beach",
            isShared: false
          },
          {
            mediaKey: "icloud-album-album-vacation",
            title: "Vacation",
            isShared: false
          }
        ]
      })
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-03] traverses paginated nested folders and preserves full album paths", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const requests: Array<{ parentId: string | null; marker: string | null }> = []
    const albumRecord = (
      recordName: string,
      title: string,
      albumType = 0,
      parentId?: string
    ) => ({
      recordName,
      recordType: "CPLAlbum",
      fields: {
        albumNameEnc: { value: btoa(title) },
        albumType: { value: albumType },
        ...(parentId ? { parentId: { value: parentId } } : {})
      }
    })
    const page = (records: unknown[], continuationMarker?: string) => ({
      ok: true,
      json: async () => ({
        records,
        ...(continuationMarker
          ? { continuationMarker, moreComing: true }
          : { moreComing: false })
      })
    })
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body || "{}"))
        const parentFilter = body.query.filterBy?.find(
          (filter: any) => filter.fieldName === "parentId"
        )
        const parentId = parentFilter?.fieldValue?.value ?? null
        const marker = body.continuationMarker ?? null
        requests.push({ parentId, marker })

        if (parentId === null && marker === null) {
          return page(
            [albumRecord("folder-trips", "Trips", 3)],
            "root-next"
          ) as Response
        }
        if (parentId === null && marker === "root-next") {
          return page([albumRecord("album-vacation", "Vacation")]) as Response
        }
        if (parentId === "folder-trips" && marker === null) {
          return page(
            [albumRecord("folder-2024", "2024", 3, "folder-trips")],
            "trips-next"
          ) as Response
        }
        if (parentId === "folder-trips" && marker === "trips-next") {
          return page([
            albumRecord("album-hiking", "Hiking", 0, "folder-trips")
          ]) as Response
        }
        if (parentId === "folder-2024" && marker === null) {
          return page([
            albumRecord("album-beach", "Beach", 0, "folder-2024")
          ]) as Response
        }
        throw new Error(
          `Unexpected CloudKit album query: ${JSON.stringify({ parentId, marker })}`
        )
      })

    try {
      sendCommand("listAlbums", "icloud-nested-album-pagination", {})
      await new Promise((resolve) => setTimeout(resolve, 400))

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "listAlbums" &&
          message.requestId === "icloud-nested-album-pagination"
      )
      expect(result).toMatchObject({ success: true })
      expect(result.data.map((album: any) => album.title)).toEqual([
        "Trips / 2024 / Beach",
        "Trips / Hiking",
        "Vacation"
      ])
      expect(result.data.map((album: any) => album.mediaKey)).toEqual([
        "icloud-album-album-beach",
        "icloud-album-album-hiking",
        "icloud-album-album-vacation"
      ])
      expect(requests).toEqual([
        { parentId: null, marker: null },
        { parentId: null, marker: "root-next" },
        { parentId: "folder-trips", marker: null },
        { parentId: "folder-trips", marker: "trips-next" },
        { parentId: "folder-2024", marker: null }
      ])
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-03] follows album continuation cursors and rejects a repeated cursor", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    let page = 0
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body || "{}"))
        expect(body.query.recordType).toBe("CPLAlbumByPositionLive")
        page += 1
        return {
          ok: true,
          json: async () => ({
            records: [
              {
                recordName: `album-${page}`,
                recordType: "CPLAlbum",
                fields: {
                  albumNameEnc: { value: btoa(`Album ${page}`) },
                  albumType: { value: 0 }
                }
              }
            ],
            ...(page === 1 ? { continuationMarker: "next-page" } : {})
          })
        } as Response
      })
    try {
      sendCommand("listAlbums", "icloud-albums-cursor", {})
      await new Promise((resolve) => setTimeout(resolve, 150))
      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "listAlbums" &&
          msg.requestId === "icloud-albums-cursor"
      )
      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(2)
      expect(JSON.parse(String(fetchSpy.mock.calls[1][1]?.body))).toMatchObject(
        {
          continuationMarker: "next-page"
        }
      )

      messages.length = 0
      page = 0
      fetchSpy.mockImplementation(async (_url, init) => {
        page += 1
        return {
          ok: true,
          json: async () => ({
            records: [
              {
                recordName: `repeated-${page}`,
                recordType: "CPLAlbum",
                fields: {
                  albumNameEnc: { value: btoa(`Repeated ${page}`) },
                  albumType: { value: 0 }
                }
              }
            ],
            continuationMarker: "next-page"
          })
        } as Response
      })
      sendCommand("listAlbums", "icloud-albums-repeated-cursor", {})
      await new Promise((resolve) => setTimeout(resolve, 150))
      const repeated = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "listAlbums" &&
          msg.requestId === "icloud-albums-repeated-cursor"
      )
      expect(repeated).toMatchObject({
        success: false,
        error: expect.stringMatching(/invalid album continuation cursor/i)
      })
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it.each([
    ["null", null],
    ["empty string", ""],
    ["boolean", true],
    ["fractional number", 0.5],
    ["negative number", -1],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1]
  ])(
    "[PARITY-03] rejects an album with a malformed albumType (%s)",
    async (_label, albumType) => {
      const { messages, restore } = collectMessages()
      const performanceSpy = vi
        .spyOn(window.performance, "getEntriesByType")
        .mockReturnValue([
          {
            name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
          } as PerformanceEntry
        ])
      const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          records: [
            {
              recordName: "album-invalid-type",
              recordType: "CPLAlbum",
              fields: {
                albumNameEnc: { value: btoa("Invalid type") },
                albumType: { value: albumType }
              }
            }
          ]
        })
      } as Response)
      try {
        const requestId = `icloud-albums-invalid-type-${String(_label).replace(/\s+/g, "-")}`
        sendCommand("listAlbums", requestId, {})
        await flush()
        expect(messages.find((msg) => msg.requestId === requestId)).toMatchObject({
          success: false,
          error: expect.stringMatching(/album with an invalid type/i)
        })
      } finally {
        fetchSpy.mockRestore()
        performanceSpy.mockRestore()
        restore()
      }
    }
  )

  it.each([
    ["text boolean", "true"],
    ["unknown number", 2],
    ["null", null],
    ["empty string", ""]
  ])(
    "[PARITY-03] rejects an album with a malformed isDeleted marker (%s)",
    async (_label, isDeleted) => {
      const { messages, restore } = collectMessages()
      const performanceSpy = vi
        .spyOn(window.performance, "getEntriesByType")
        .mockReturnValue([
          {
            name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
          } as PerformanceEntry
        ])
      const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          records: [
            {
              recordName: "album-invalid-deletion-marker",
              recordType: "CPLAlbum",
              fields: {
                albumNameEnc: { value: btoa("Invalid deletion marker") },
                albumType: { value: 0 },
                isDeleted: { value: isDeleted }
              }
            }
          ]
        })
      } as Response)
      try {
        const requestId = `icloud-albums-invalid-deletion-${String(_label).replace(/\s+/g, "-")}`
        sendCommand("listAlbums", requestId, {})
        await flush()
        expect(messages.find((msg) => msg.requestId === requestId)).toMatchObject({
          success: false,
          error: expect.stringMatching(/invalid deletion status/i)
        })
      } finally {
        fetchSpy.mockRestore()
        performanceSpy.mockRestore()
        restore()
      }
    }
  )

  it("[PARITY-03] rejects a non-boolean CloudKit tombstone marker", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [
          {
            recordName: "album-invalid-tombstone",
            recordType: "CPLAlbum",
            deleted: "false",
            fields: {
              albumNameEnc: { value: btoa("Invalid tombstone") },
              albumType: { value: 0 }
            }
          }
        ]
      })
    } as Response)
    try {
      sendCommand("listAlbums", "icloud-albums-invalid-tombstone", {})
      await flush()
      expect(
        messages.find(
          (msg) => msg.requestId === "icloud-albums-invalid-tombstone"
        )
      ).toMatchObject({
        success: false,
        error: expect.stringMatching(/invalid deletion status/i)
      })
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-03] distinguishes a valid empty list from a malformed album page", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ records: [] })
    } as Response)
    try {
      sendCommand("listAlbums", "icloud-albums-empty", {})
      await flush()
      expect(
        messages.find((msg) => msg.requestId === "icloud-albums-empty")
      ).toMatchObject({
        success: true,
        data: []
      })

      messages.length = 0
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ records: null })
      } as Response)
      sendCommand("listAlbums", "icloud-albums-malformed", {})
      await flush()
      expect(
        messages.find((msg) => msg.requestId === "icloud-albums-malformed")
      ).toMatchObject({
        success: false,
        error: expect.stringMatching(/invalid album-list page/i)
      })
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it.each([
    { success: false },
    { success: "true" },
    { partial: true },
    { partial: "false" }
  ])("[ICLOUD-ALBUM-ENVELOPE] never turns an incomplete envelope %j into an empty list", async (envelope) => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi.spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([{
        name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
      } as PerformanceEntry])
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true, json: async () => ({ records: [], ...envelope })
    } as Response)
    try {
      sendCommand("listAlbums", "icloud-albums-envelope", {})
      const result = await waitForProviderResult(messages, "icloud-albums-envelope")
      expect(result).toMatchObject({ success: false })
      expect(result.data).toBeUndefined()
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it.each([
    ["string true", "true"],
    ["string false", "false"],
    ["numeric flag", 1],
    ["null flag", null]
  ])(
    "[PARITY-03] rejects a malformed moreComing %s value",
    async (_label, moreComing) => {
      const { messages, restore } = collectMessages()
      const performanceSpy = vi
        .spyOn(window.performance, "getEntriesByType")
        .mockReturnValue([
          {
            name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
          } as PerformanceEntry
        ])
      const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ records: [], moreComing })
      } as Response)
      try {
        const requestId = `icloud-albums-invalid-more-coming-${String(moreComing)}`
        sendCommand("listAlbums", requestId, {})
        await flush()
        expect(
          messages.find((msg) => msg.requestId === requestId)
        ).toMatchObject({
          success: false,
          error: expect.stringMatching(/invalid album-list page/i)
        })
      } finally {
        fetchSpy.mockRestore()
        performanceSpy.mockRestore()
        restore()
      }
    }
  )

  it("[PARITY-03] rejects moreComing without a continuation marker", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ records: [], moreComing: true })
    } as Response)
    try {
      sendCommand("listAlbums", "icloud-albums-missing-cursor", {})
      await flush()
      expect(
        messages.find((msg) => msg.requestId === "icloud-albums-missing-cursor")
      ).toMatchObject({
        success: false,
        error: expect.stringMatching(/more albums without a continuation cursor/i)
      })
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-03] rejects a terminal moreComing flag with a continuation marker", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [
          {
            recordName: "album-terminal-with-cursor",
            recordType: "CPLAlbum",
            fields: {
              albumNameEnc: { value: btoa("Terminal with cursor") },
              albumType: { value: 0 }
            }
          }
        ],
        moreComing: false,
        continuationMarker: "unexpected-next-page"
      })
    } as Response)
    try {
      sendCommand("listAlbums", "icloud-albums-terminal-with-cursor", {})
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(
        messages.find(
          (msg) =>
            msg.action === "gptkResult" &&
            msg.command === "listAlbums" &&
            msg.requestId === "icloud-albums-terminal-with-cursor"
        )
      ).toMatchObject({
        success: false,
        error: expect.stringMatching(/invalid album-list page/i)
      })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it.each([
    ["missing record", null],
    [
      "missing record name",
      {
        recordType: "CPLAlbum",
        fields: {
          albumNameEnc: { value: btoa("Missing ID") },
          albumType: { value: 0 }
        }
      }
    ],
    [
      "control character in record name",
      {
        recordName: "album\u0001invalid",
        recordType: "CPLAlbum",
        fields: {
          albumNameEnc: { value: btoa("Invalid ID") },
          albumType: { value: 0 }
        }
      }
    ],
    [
      "unexpected record type",
      {
        recordName: "not-an-album",
        recordType: "CPLAsset",
        fields: {
          albumNameEnc: { value: btoa("Wrong type") },
          albumType: { value: 0 }
        }
      }
    ]
  ])(
    "[PARITY-03] rejects malformed album record envelopes (%s)",
    async (_label, record) => {
      const { messages, restore } = collectMessages()
      const performanceSpy = vi
        .spyOn(window.performance, "getEntriesByType")
        .mockReturnValue([
          {
            name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
          } as PerformanceEntry
        ])
      const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ records: [record] })
      } as Response)
      try {
        const requestId = `icloud-albums-invalid-envelope-${String(_label).replace(/\s+/g, "-")}`
        sendCommand("listAlbums", requestId, {})
        await flush()
        expect(messages.find((msg) => msg.requestId === requestId)).toMatchObject({
          success: false,
          error: expect.stringMatching(/album with an invalid schema/i)
        })
      } finally {
        fetchSpy.mockRestore()
        performanceSpy.mockRestore()
        restore()
      }
    }
  )

  it("[PARITY-03] rejects album data that changes during nested enumeration", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const albumRecord = (
      recordName: string,
      title: string,
      albumType: number,
      parentId?: string
    ) => ({
      recordName,
      recordType: "CPLAlbum",
      fields: {
        albumNameEnc: { value: btoa(title) },
        albumType: { value: albumType },
        ...(parentId ? { parentId: { value: parentId } } : {})
      }
    })
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body || "{}"))
        const parentId = body.query.filterBy?.find(
          (filter: any) => filter.fieldName === "parentId"
        )?.fieldValue?.value
        const records = parentId
          ? [albumRecord("album-changing", "After", 0, "folder-one")]
          : [
              albumRecord("folder-one", "Folder", 3),
              albumRecord("album-changing", "Before", 0)
            ]
        return { ok: true, json: async () => ({ records }) } as Response
      })
    try {
      sendCommand("listAlbums", "icloud-albums-changed-record", {})
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(
        messages.find(
          (message) => message.requestId === "icloud-albums-changed-record"
        )
      ).toMatchObject({
        success: false,
        error: expect.stringMatching(/album data changed during enumeration/i)
      })
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })
})

describe("iCloud album scans", () => {
  it("[PARITY-03] rejects explicit shared album scopes before CloudKit requests", async () => {
    const originalBody = document.body.innerHTML
    const originalUrl = window.location.href
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ records: [] })
    } as Response)

    try {
      ;(window as any).happyDOM.setURL("https://www.icloud.com/photos/#/")
      document.body.innerHTML = ""
      sendCommand("getAllMediaItems", "icloud-shared-album-scan", {
        albumScope: {
          mediaKey: "icloud-album-shared-1",
          title: "Shared album",
          isShared: true
        }
      })
      await flushProviderWork()

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "icloud-shared-album-scan"
      )
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        success: false,
        error: expect.stringMatching(/shared iCloud Photos albums are not supported/i),
        scanCoverage: {
          status: "failed",
          stopReason: "unsupported_scope",
          itemsVisited: 0,
          itemsReturned: 0,
          itemsSkipped: 0
        }
      })
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      ;(window as any).happyDOM.setURL(originalUrl)
      document.body.innerHTML = originalBody
      restore()
    }
  })

  it("[PARITY-03] does not trust a zero album count without an empty membership page", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const unexpectedMemberRecords = [
      {
        recordName: "master-hidden-by-zero-count",
        recordType: "CPLMaster",
        fields: {
          itemType: { value: "public.jpeg" },
          filenameEnc: { value: btoa("unexpected.jpg") },
          resJPEGThumbRes: {
            value: {
              downloadURL: "https://cvws-h2.icloud-content.com/B/thumb/${f}"
            }
          }
        }
      },
      {
        recordName: "asset-hidden-by-zero-count",
        recordType: "CPLAsset",
        fields: {
          masterRef: {
            value: { recordName: "master-hidden-by-zero-count" }
          },
          assetDate: { value: 1000 }
        }
      },
      {
        recordName: "relation-hidden-by-zero-count",
        recordType: "CPLContainerRelation"
      }
    ]
    const membershipRequests: unknown[] = []
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url, init) => {
        const body = JSON.parse(String(init?.body || "{}"))
        if (String(url).includes("/internal/records/query/batch?")) {
          expect(body.batch[0].query.filterBy.fieldValue.value).toEqual([
            "CPLContainerRelationNotDeletedByAssetDate:album-empty"
          ])
          return {
            ok: true,
            json: async () => ({
              batch: [{ records: [{ fields: { itemCount: { value: 0 } } }] }]
            })
          } as Response
        }
        if (body.query.recordType === "CPLAlbumByPositionLive") {
          return {
            ok: true,
            json: async () => ({
              records: [
                {
                  recordName: "album-empty",
                  recordType: "CPLAlbum",
                  fields: {
                    albumNameEnc: { value: btoa("Empty album") },
                    albumType: { value: 0 }
                  }
                }
              ]
            })
          } as Response
        }
        expect(body.query.recordType).toBe(
          "CPLContainerRelationLiveByAssetDate"
        )
        expect(body.query.filterBy).toContainEqual({
          fieldName: "parentId",
          fieldValue: { type: "STRING", value: "album-empty" },
          comparator: "EQUALS"
        })
        membershipRequests.push(body)
        return {
          ok: true,
          json: async () => ({ records: unexpectedMemberRecords })
        } as Response
      })

    try {
      sendCommand("getAllMediaItems", "icloud-zero-count-album", {
        albumScope: {
          mediaKey: "icloud-album-album-empty",
          title: "Empty album"
        }
      })
      await flush()

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "icloud-zero-count-album"
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
          totalItems: 0,
          pagesRead: 1,
          pageSizes: [1]
        }
      })
      expect(membershipRequests).toHaveLength(1)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-03] confirms an empty album with a terminal empty membership page", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const membershipRequests: unknown[] = []
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url, init) => {
        const body = JSON.parse(String(init?.body || "{}"))
        if (String(url).includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [{ records: [{ fields: { itemCount: { value: 0 } } }] }]
            })
          } as Response
        }
        if (body.query.recordType === "CPLAlbumByPositionLive") {
          return {
            ok: true,
            json: async () => ({
              records: [
                {
                  recordName: "album-empty",
                  recordType: "CPLAlbum",
                  fields: {
                    albumNameEnc: { value: btoa("Empty album") },
                    albumType: { value: 0 }
                  }
                }
              ]
            })
          } as Response
        }
        expect(body.query.recordType).toBe(
          "CPLContainerRelationLiveByAssetDate"
        )
        membershipRequests.push(body)
        return {
          ok: true,
          json: async () => ({ records: [], moreComing: false })
        } as Response
      })

    try {
      sendCommand("getAllMediaItems", "icloud-confirmed-empty-album", {
        albumScope: {
          mediaKey: "icloud-album-album-empty",
          title: "Empty album"
        }
      })
      await flush()

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "icloud-confirmed-empty-album"
      )
      expect(result).toMatchObject({
        success: true,
        data: [],
        scanCoverage: {
          status: "complete",
          stopReason: "exhausted",
          itemsVisited: 0,
          itemsReturned: 0,
          itemsSkipped: 0,
          totalItems: 0,
          pagesRead: 1,
          pageSizes: [0]
        }
      })
      expect(membershipRequests).toHaveLength(1)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-03] revalidates the selected personal album and scans its membership index", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const mediaRecords = [
      {
        recordName: "master-album-media-1",
        recordType: "CPLMaster",
        fields: {
          itemType: { value: "public.jpeg" },
          filenameEnc: { value: btoa("ALBUM_IMAGE.JPG") },
          resOriginalFingerprint: { value: "album-original-fingerprint" },
          resOriginalWidth: { value: 1600 },
          resOriginalHeight: { value: 1200 },
          resJPEGThumbRes: {
            value: {
              downloadURL:
                "https://cvws-h2.icloud-content.com/B/album-thumb/${f}"
            }
          }
        },
        created: { timestamp: 2000 }
      },
      {
        recordName: "asset-album-media-1",
        recordType: "CPLAsset",
        recordChangeTag: "album-change-tag",
        zoneID: { zoneName: "PrimarySync" },
        fields: {
          masterRef: { value: { recordName: "master-album-media-1" } },
          assetDate: { value: 1000 },
          addedDate: { value: 2000 }
        }
      }
    ]
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url, init) => {
        const body = JSON.parse(String(init?.body || "{}"))
        if (String(url).includes("/internal/records/query/batch?")) {
          expect(body.batch[0].query.filterBy.fieldValue.value).toEqual([
            "CPLContainerRelationNotDeletedByAssetDate:album-1"
          ])
          return {
            ok: true,
            json: async () => ({
              batch: [{ records: [{ fields: { itemCount: { value: 1 } } }] }]
            })
          } as Response
        }
        if (body.query.recordType === "CPLAlbumByPositionLive") {
          return {
            ok: true,
            json: async () => ({
              records: [
                {
                  recordName: "album-1",
                  recordType: "CPLAlbum",
                  fields: {
                    albumNameEnc: { value: btoa("Personal album") },
                    albumType: { value: 0 }
                  }
                }
              ]
            })
          } as Response
        }
        expect(body.query.recordType).toBe(
          "CPLContainerRelationLiveByAssetDate"
        )
        expect(body.query.filterBy).toContainEqual({
          fieldName: "parentId",
          fieldValue: { type: "STRING", value: "album-1" },
          comparator: "EQUALS"
        })
        // Album membership returns a master, asset, and relation record for
        // each media item, so the record window must cover three records per
        // item. A two-record window silently drops album members between
        // startRank pages in the live CloudKit response.
        expect(body.resultsLimit).toBe(300)
        return {
          ok: true,
          json: async () => ({ records: mediaRecords })
        } as Response
      })

    try {
      sendCommand("getAllMediaItems", "icloud-album-scan", {
        albumScope: {
          mediaKey: "icloud-album-album-1",
          title: "Personal album"
        }
      })
      await flush()

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "getAllMediaItems" &&
          msg.requestId === "icloud-album-scan"
      )
      expect(result).toMatchObject({
        success: true,
        data: [
          {
            mediaKey: "icloud-master-album-media-1",
            dedupKey: "master-album-media-1",
            fileName: "ALBUM_IMAGE.JPG",
            timestamp: 1000,
            provider: "icloud"
          }
        ],
        scanCoverage: {
          status: "complete",
          stopReason: "exhausted",
          itemsVisited: 1,
          itemsReturned: 1,
          itemsSkipped: 0,
          totalItems: 1,
          mediaTypesCovered: { photos: true, videos: true }
        }
      })
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-03] advances album startRank by mapped items when CloudKit caps records", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const mediaRecords = (suffix: string) => [
      {
        recordName: `master-${suffix}`,
        recordType: "CPLMaster",
        fields: {
          itemType: { value: "public.jpeg" },
          filenameEnc: { value: btoa(`${suffix}.JPG`) },
          resOriginalFingerprint: { value: `fingerprint-${suffix}` },
          resJPEGThumbRes: {
            value: {
              downloadURL: "https://cvws-h2.icloud-content.com/B/thumb/${f}"
            }
          }
        },
        created: { timestamp: 2000 }
      },
      {
        recordName: `asset-${suffix}`,
        recordType: "CPLAsset",
        recordChangeTag: `change-${suffix}`,
        zoneID: { zoneName: "PrimarySync" },
        fields: {
          masterRef: { value: { recordName: `master-${suffix}` } },
          assetDate: { value: 1000 },
          addedDate: { value: 2000 }
        }
      }
    ]
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url, init) => {
        const body = JSON.parse(String(init?.body || "{}"))
        if (String(url).includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [{ records: [{ fields: { itemCount: { value: 4 } } }] }]
            })
          } as Response
        }
        if (body.query.recordType === "CPLAlbumByPositionLive") {
          return {
            ok: true,
            json: async () => ({
              records: [
                {
                  recordName: "album-1",
                  recordType: "CPLAlbum",
                  fields: {
                    albumNameEnc: { value: btoa("Capped album") },
                    albumType: { value: 0 }
                  }
                }
              ]
            })
          } as Response
        }
        const offset = body.query.filterBy.find(
          (filter: { fieldName: string }) => filter.fieldName === "startRank"
        )?.fieldValue?.value
        expect(body.query.recordType).toBe(
          "CPLContainerRelationLiveByAssetDate"
        )
        expect(body.resultsLimit).toBe(300)
        return {
          ok: true,
          json: async () => ({
            records:
              offset === 0
                ? [...mediaRecords("A"), ...mediaRecords("B")]
                : offset === 2
                  ? [...mediaRecords("C"), ...mediaRecords("D")]
                  : []
          })
        } as Response
      })

    try {
      sendCommand("getAllMediaItems", "icloud-album-capped", {
        albumScope: {
          mediaKey: "icloud-album-album-1",
          title: "Capped album"
        }
      })
      await new Promise((resolve) => setTimeout(resolve, 900))

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "getAllMediaItems" &&
          msg.requestId === "icloud-album-capped"
      )
      expect(result?.success).toBe(true)
      expect(result?.data.map((item: { dedupKey: string }) => item.dedupKey)).toEqual([
        "master-A",
        "master-B",
        "master-C",
        "master-D"
      ])
      expect(result?.scanCoverage).toMatchObject({
        status: "complete",
        stopReason: "exhausted",
        itemsVisited: 4,
        itemsReturned: 4,
        itemsSkipped: 0,
        totalItems: 4,
        pagesRead: 2,
        pageSizes: [2, 2]
      })
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-03] reconciles every member across CloudKit's capped album pages", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const expectedCount = 216
    const recordsForItem = (index: number) => {
      const suffix = String(index).padStart(3, "0")
      const masterName = `album-master-${suffix}`
      return [
        {
          recordName: masterName,
          recordType: "CPLMaster",
          fields: {
            itemType: { value: "public.jpeg" },
            filenameEnc: { value: btoa(`ALBUM_${suffix}.JPG`) },
            resOriginalFingerprint: { value: `fingerprint-${suffix}` },
            resJPEGThumbRes: {
              value: {
                downloadURL:
                  "https://cvws-h2.icloud-content.com/B/thumb-" +
                  suffix +
                  "/${f}"
              }
            }
          },
          created: { timestamp: 2000 }
        },
        {
          recordName: `album-asset-${suffix}`,
          recordType: "CPLAsset",
          recordChangeTag: `change-${suffix}`,
          zoneID: { zoneName: "PrimarySync" },
          fields: {
            masterRef: { value: { recordName: masterName } },
            assetDate: { value: 1000 },
            addedDate: { value: 2000 }
          }
        },
        {
          recordName: `album-relation-${suffix}`,
          recordType: "CPLContainerRelationLiveByAssetDate",
          fields: { parentId: { value: "album-1" } }
        }
      ]
    }
    const membershipOffsets: number[] = []
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body || "{}"))
        if (body.batch) {
          return {
            ok: true,
            json: async () => ({
              batch: [
                { records: [{ fields: { itemCount: { value: expectedCount } } }] }
              ]
            })
          } as Response
        }
        if (body.query.recordType === "CPLAlbumByPositionLive") {
          return {
            ok: true,
            json: async () => ({
              records: [
                {
                  recordName: "album-1",
                  recordType: "CPLAlbum",
                  fields: {
                    albumNameEnc: { value: btoa("Known 216-item album") },
                    albumType: { value: 0 }
                  }
                }
              ]
            })
          } as Response
        }

        expect(body.query.recordType).toBe(
          "CPLContainerRelationLiveByAssetDate"
        )
        expect(body.query.filterBy).toContainEqual({
          fieldName: "parentId",
          fieldValue: { type: "STRING", value: "album-1" },
          comparator: "EQUALS"
        })
        expect(body.resultsLimit).toBe(300)
        const offset = body.query.filterBy.find(
          (filter: { fieldName: string }) => filter.fieldName === "startRank"
        ).fieldValue.value
        membershipOffsets.push(offset)

        // Model a private-route service that caps this three-record relation
        // query at 200 records: 66 complete master/asset/relation rows fit.
        const pageItemCount = 66
        const pageEnd = Math.min(offset + pageItemCount, expectedCount)
        const records = Array.from(
          { length: pageEnd - offset },
          (_, pageIndex) => recordsForItem(offset + pageIndex)
        ).flat()
        expect(records.length).toBeLessThanOrEqual(200)
        return {
          ok: true,
          json: async () => ({ records, syncToken: "stable-album-token" })
        } as Response
      })

    try {
      sendCommand("getAllMediaItems", "icloud-album-216-members", {
        albumScope: {
          mediaKey: "icloud-album-album-1",
          title: "Known 216-item album"
        }
      })
      await new Promise((resolve) => setTimeout(resolve, 1200))

      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "getAllMediaItems" &&
          msg.requestId === "icloud-album-216-members"
      )
      const returnedIds = result?.data.map(
        (item: { dedupKey: string }) => item.dedupKey
      )
      expect(membershipOffsets).toEqual([0, 66, 132, 198])
      expect(returnedIds).toEqual(
        Array.from(
          { length: expectedCount },
          (_, index) => `album-master-${String(index).padStart(3, "0")}`
        )
      )
      expect(result).toMatchObject({
        success: true,
        scanCoverage: {
          status: "complete",
          stopReason: "exhausted",
          itemsVisited: expectedCount,
          itemsReturned: expectedCount,
          itemsSkipped: 0,
          totalItems: expectedCount,
          pagesRead: 4,
          pageSizes: [66, 66, 66, 18]
        }
      })
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-03] fails closed when the selected album is no longer in the personal library", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ records: [] })
    } as Response)
    try {
      sendCommand("getAllMediaItems", "icloud-album-stale", {
        albumScope: { mediaKey: "icloud-album-stale-id", title: "Old album" }
      })
      await flush()
      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "getAllMediaItems" &&
          msg.requestId === "icloud-album-stale"
      )
      expect(result).toMatchObject({
        success: false,
        scanCoverage: {
          status: "failed",
          itemsVisited: 0,
          itemsReturned: 0
        },
        error: expect.stringMatching(/album is unavailable/i)
      })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-03] never falls back to loaded DOM items for an album scan", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([])
    const fetchSpy = vi.spyOn(window, "fetch")
    try {
      sendCommand("getAllMediaItems", "icloud-album-no-cloudkit", {
        albumScope: {
          mediaKey: "icloud-album-album-1",
          title: "Personal album"
        }
      })
      await vi.waitFor(
        () =>
          expect(
            messages.some(
              (message) =>
                message.action === "gptkResult" &&
                message.command === "getAllMediaItems" &&
                message.requestId === "icloud-album-no-cloudkit"
            )
          ).toBe(true),
        { timeout: 4000 }
      )
      const result = messages.find(
        (msg) =>
          msg.action === "gptkResult" &&
          msg.command === "getAllMediaItems" &&
          msg.requestId === "icloud-album-no-cloudkit"
      )
      expect(result).toMatchObject({
        success: false,
        scanCoverage: { status: "failed" },
        error: expect.stringMatching(/cannot be verified in this page session/i)
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      performanceSpy.mockRestore()
      restore()
    }
  })
})

describe("iCloud CloudKit count index", () => {
  const countResponse = (value: unknown) => ({
    batch: [{ records: [{ fields: { itemCount: { value } } }] }]
  })

  it.each([
    { label: "null", response: countResponse(null) },
    { label: "empty string", response: countResponse("") },
    { label: "boolean", response: countResponse(false) },
    { label: "numeric string", response: countResponse("0") },
    { label: "negative number", response: countResponse(-1) },
    { label: "fractional number", response: countResponse(0.5) },
    {
      label: "unsafe integer",
      response: countResponse(Number.MAX_SAFE_INTEGER + 1)
    },
    {
      label: "missing value",
      response: { batch: [{ records: [{ fields: {} }] }] }
    },
    {
      label: "missing count row",
      response: { batch: [{ records: [] }] }
    },
    { label: "missing batch row", response: {} },
    { label: "[ICLOUD-COUNT-ENVELOPE] root failure", response: {
      ...countResponse(1), success: false
    } },
    { label: "[ICLOUD-COUNT-ENVELOPE] failed batch", response: {
      batch: [{ ...countResponse(1).batch[0], serverErrorCode: "ZONE_NOT_FOUND" }]
    } },
    { label: "[ICLOUD-COUNT-ENVELOPE] failed record", response: {
      batch: [{ records: [{
        ...countResponse(1).batch[0].records[0], serverErrorCode: "UNKNOWN_ITEM"
      }] }]
    } },
    { label: "[ICLOUD-COUNT-ENVELOPE] extra batch", response: {
      batch: [countResponse(1).batch[0], countResponse(2).batch[0]]
    } },
    { label: "[ICLOUD-COUNT-ENVELOPE] extra count", response: {
      batch: [{ records: [
        countResponse(1).batch[0].records[0], countResponse(2).batch[0].records[0]
      ] }]
    } },
    { label: "[ICLOUD-COUNT-ENVELOPE] incomplete batch", response: {
      batch: [{ ...countResponse(1).batch[0], moreComing: true }]
    } }
  ])(
    "treats a $label count response as unknown and scans provider records",
    async ({ response }) => {
      const { messages, restore } = collectMessages()
      const performanceSpy = vi
        .spyOn(window.performance, "getEntriesByType")
        .mockReturnValue([
          {
            name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
          } as PerformanceEntry
        ])
      const mediaRecords = [
        {
          recordName: "master-count-null",
          recordType: "CPLMaster",
          fields: {
            itemType: { value: "public.jpeg" },
            filenameEnc: { value: btoa("count-null.jpg") },
            resJPEGThumbRes: {
              value: {
                downloadURL: "https://cvws-h2.icloud-content.com/B/thumb/${f}"
              }
            }
          }
        },
        {
          recordName: "asset-count-null",
          recordType: "CPLAsset",
          fields: {
            masterRef: { value: { recordName: "master-count-null" } },
            assetDate: { value: 1000 }
          }
        }
      ]
      const fetchSpy = vi
        .spyOn(window, "fetch")
        .mockImplementation(async (_url, init) => {
          const body = JSON.parse(String(init?.body || "{}"))
          if (body.batch) {
            return {
              ok: true,
              json: async () => response
            } as Response
          }
          return {
            ok: true,
            json: async () => ({ records: mediaRecords })
          } as Response
        })

      try {
        sendCommand("getAllMediaItems", "icloud-null-count-index", {})
        await flushProviderWork()

        const result = messages.find(
          (msg) =>
            msg.action === "gptkResult" &&
            msg.command === "getAllMediaItems" &&
            msg.requestId === "icloud-null-count-index"
        )
        expect(result).toMatchObject({
          success: true,
          data: [{ dedupKey: "master-count-null" }],
          scanCoverage: {
            status: "partial",
            stopReason: "coverage_unknown",
            itemsVisited: 1,
            itemsReturned: 1
          }
        })
        expect(result.scanCoverage).not.toHaveProperty("totalItems")
      } finally {
        fetchSpy.mockRestore()
        performanceSpy.mockRestore()
        restore()
      }
      })
  })
describe("iCloud mutation response reconciliation", () => {
  const queryUrl =
    "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
  const requestTargets = [
    {
      dedupKey: "icloud-a",
      mediaKey: "media-a",
      ref: {
        recordName: "asset-a",
        changeTag: "tag-before-a",
        zoneName: "PrimarySync",
        ownerRecordName: "_defaultOwner"
      }
    },
    {
      dedupKey: "icloud-b",
      mediaKey: "media-b",
      ref: {
        recordName: "asset-b",
        changeTag: "tag-before-b",
        zoneName: "PrimarySync",
        ownerRecordName: "_defaultOwner"
      }
    }
  ]
  const updatedRecord = (
    recordName: string,
    changeTag = `after-${recordName}`,
    isDeleted = 1
  ) => ({
    recordName,
    recordType: "CPLAsset",
    recordChangeTag: changeTag,
    zoneID: { zoneName: "PrimarySync", ownerRecordName: "_defaultOwner" },
    fields: { isDeleted: { value: isDeleted } }
  })

  const installMutationResponse = (
    modifyResponse: (body: any) => unknown
  ) =>
    vi.spyOn(window, "fetch").mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname
      const body = JSON.parse(String(init?.body || "{}"))
      if (path.endsWith("/records/lookup")) {
        return {
          ok: true,
          json: async () => ({
            records: (body.records || []).map((record: any) => ({
              recordName: record.recordName,
              recordType: "CPLAsset",
              recordChangeTag: `current-${record.recordName}`,
              zoneID: {
                zoneName: "PrimarySync",
                ownerRecordName: "_defaultOwner"
              },
              fields: {
                isFavorite: { value: 0 },
                isDeleted: { value: 0 }
              }
            }))
          })
        } as Response
      }
      if (path.endsWith("/records/modify")) {
        return (await modifyResponse(body)) as Response
      }
      throw new Error("Unexpected iCloud Photos mutation route.")
    })

  it("permits per-target results only for an explicitly non-atomic simulation", () => {
    const api = (window as any).__GPD_ICLOUD_COMMAND_TEST_API__
    const result = api.evaluateModifyResponse(
      {
        records: [
          updatedRecord("asset-a"),
          {
            recordName: "asset-b",
            reason: "The record change tag is stale.",
            serverErrorCode: "CONFLICT"
          }
        ]
      },
      requestTargets,
      1,
      false
    )
    expect(result).toMatchObject({
      success: false,
      status: "unknown",
      outcomesByDedupKey: {
        "icloud-a": { status: "confirmed" },
        "icloud-b": { status: "failed" }
      },
      refsByRecordName: {
        "asset-a": {
          recordName: "asset-a",
          changeTag: "after-asset-a",
          zoneName: "PrimarySync",
          ownerRecordName: "_defaultOwner"
        }
      }
    })
  })

  it.each([
    ["an empty object", {}],
    ["an empty records array", { records: [] }],
    ["a partial response", { records: [updatedRecord("asset-a")] }],
    [
      "a duplicate target",
      { records: [updatedRecord("asset-a"), updatedRecord("asset-a")] }
    ],
    [
      "an unrequested target",
      { records: [updatedRecord("asset-a"), updatedRecord("asset-other")] }
    ],
    [
      "a contradictory partial marker",
      {
        partial: true,
        records: [updatedRecord("asset-a"), updatedRecord("asset-b")]
      }
    ],
    [
      "partial records alongside a definitive root error",
      {
        serverErrorCode: "ACCESS_DENIED",
        records: [updatedRecord("asset-a")]
      }
    ],
    [
      "complete records alongside a contradictory root error",
      {
        serverErrorCode: "ACCESS_DENIED",
        records: [updatedRecord("asset-a"), updatedRecord("asset-b")]
      }
    ],
    [
      "definitive row errors alongside a contradictory root error",
      {
        serverErrorCode: "ACCESS_DENIED",
        records: [
          { ...updatedRecord("asset-a"), serverErrorCode: "NOT_FOUND" },
          updatedRecord("asset-b")
        ]
      }
    ],
    [
      "a wrong operation marker",
      {
        operationType: "delete",
        records: [updatedRecord("asset-a"), updatedRecord("asset-b")]
      }
    ]
  ])("does not confirm Trash after %s", async (_label, responseBody) => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = installMutationResponse(() => ({
      ok: true,
      json: async () => responseBody
    } as Response))

    sendCommand("trashItems", "icloud-invalid-trash-response", {
      dedupKeys: requestTargets.map((target) => target.dedupKey),
      mediaKeysToTrash: requestTargets.map((target) => target.mediaKey),
      icloudAssetRefs: requestTargets.map((target) => target.ref)
    })
    await flush()
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === "icloud-invalid-trash-response"
    )
    expect(result).toMatchObject({
      success: false,
      data: {
        trashedCount: 0,
        trashedKeys: [],
        trashedDedupKeys: [],
        outcomes: [
          {
            operation: "trash",
            targetKey: "icloud-a",
            status: "unknown"
          },
          {
            operation: "trash",
            targetKey: "icloud-b",
            status: "unknown"
          }
        ]
      }
    })

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it.each([
    [
      "a non-asset record",
      { ...updatedRecord("asset-a"), recordType: "CPLMaster" }
    ],
    ["a missing change tag", { ...updatedRecord("asset-a"), recordChangeTag: "" }],
    [
      "an unchanged change tag",
      { ...updatedRecord("asset-a"), recordChangeTag: "current-asset-a" }
    ],
    ["a contradictory deletion state", updatedRecord("asset-a", undefined, 0)]
  ])("keeps an atomic batch unknown when one returned row is %s", async (_label, invalidRecord) => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([{ name: queryUrl } as PerformanceEntry])
    const fetchSpy = installMutationResponse(() => ({
      ok: true,
      json: async () => ({
        records: [invalidRecord, updatedRecord("asset-b")]
      })
    } as Response))

    sendCommand("trashItems", "icloud-one-invalid-row", {
      dedupKeys: requestTargets.map((target) => target.dedupKey),
      mediaKeysToTrash: requestTargets.map((target) => target.mediaKey),
      icloudAssetRefs: requestTargets.map((target) => target.ref)
    })
    await flush()
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === "icloud-one-invalid-row"
    )
    expect(result).toMatchObject({
      success: false,
      data: {
        trashedCount: 0,
        trashedKeys: [],
        trashedDedupKeys: [],
        outcomes: [
          { operation: "trash", targetKey: "icloud-a", status: "unknown" },
          { operation: "trash", targetKey: "icloud-b", status: "unknown" }
        ]
      }
    })

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it.each([
    { serverErrorCode: "AUTHENTICATION_REQUIRED" },
    { serverErrorCode: "AUTHENTICATION_REQUIRED", records: [] }
  ])("preserves an explicit empty CloudKit rejection as failed: %o", async (body) => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([{ name: queryUrl } as PerformanceEntry])
    const fetchSpy = installMutationResponse(() => ({
      ok: true,
      json: async () => body
    } as Response))

    sendCommand("trashItems", "icloud-rejected-trash-response", {
      dedupKeys: requestTargets.map((target) => target.dedupKey),
      mediaKeysToTrash: requestTargets.map((target) => target.mediaKey),
      icloudAssetRefs: requestTargets.map((target) => target.ref)
    })
    await flush()
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === "icloud-rejected-trash-response"
    )
    expect(result).toMatchObject({
      success: false,
      data: {
        trashedCount: 0,
        outcomes: [
          { operation: "trash", targetKey: "icloud-a", status: "failed" },
          { operation: "trash", targetKey: "icloud-b", status: "failed" }
        ]
      }
    })

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it("marks an all-row definitive rejection failed for the atomic batch", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([{ name: queryUrl } as PerformanceEntry])
    const fetchSpy = installMutationResponse(() => ({
      ok: true,
      json: async () => ({
        records: requestTargets.map((target) => ({
          recordName: target.ref.recordName,
          reason: "The record change tag is stale.",
          serverErrorCode: "CONFLICT"
        }))
      })
    } as Response))

    sendCommand("trashItems", "icloud-atomic-definitive-row-errors", {
      dedupKeys: requestTargets.map((target) => target.dedupKey),
      mediaKeysToTrash: requestTargets.map((target) => target.mediaKey),
      icloudAssetRefs: requestTargets.map((target) => target.ref)
    })
    await flush()
    await flush()

    expect(
      messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "trashItems" &&
          message.requestId === "icloud-atomic-definitive-row-errors"
      )
    ).toMatchObject({
      success: false,
      data: {
        trashedCount: 0,
        outcomes: [
          { operation: "trash", targetKey: "icloud-a", status: "failed" },
          { operation: "trash", targetKey: "icloud-b", status: "failed" }
        ]
      }
    })

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it("keeps a mixed success and rejection unknown for the actual atomic batch", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([{ name: queryUrl } as PerformanceEntry])
    const fetchSpy = installMutationResponse(() => ({
      ok: true,
      json: async () => ({
        records: [
          updatedRecord("asset-a"),
          {
            recordName: "asset-b",
            reason: "The record change tag is stale.",
            serverErrorCode: "CONFLICT"
          }
        ]
      })
    } as Response))

    sendCommand("trashItems", "icloud-mixed-trash-response", {
      dedupKeys: requestTargets.map((target) => target.dedupKey),
      mediaKeysToTrash: requestTargets.map((target) => target.mediaKey),
      icloudAssetRefs: requestTargets.map((target) => target.ref)
    })
    await flush()
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === "icloud-mixed-trash-response"
    )
    expect(result).toMatchObject({
      success: false,
      data: {
        trashedCount: 0,
        trashedKeys: [],
        trashedDedupKeys: [],
        outcomes: [
          { operation: "trash", targetKey: "icloud-a", status: "unknown" },
          { operation: "trash", targetKey: "icloud-b", status: "unknown" }
        ]
      }
    })

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it("keeps an atomic batch unknown when another row has an ambiguous provider error", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([{ name: queryUrl } as PerformanceEntry])
    const fetchSpy = installMutationResponse(() => ({
      ok: true,
      json: async () => ({
        records: [
          updatedRecord("asset-a"),
          {
            recordName: "asset-b",
            reason: "An internal service error occurred.",
            serverErrorCode: "INTERNAL_ERROR"
          }
        ]
      })
    } as Response))

    sendCommand("trashItems", "icloud-ambiguous-row-error", {
      dedupKeys: requestTargets.map((target) => target.dedupKey),
      mediaKeysToTrash: requestTargets.map((target) => target.mediaKey),
      icloudAssetRefs: requestTargets.map((target) => target.ref)
    })
    await flush()
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === "icloud-ambiguous-row-error"
    )
    expect(result).toMatchObject({
      success: false,
      data: {
        trashedCount: 0,
        trashedDedupKeys: [],
        outcomes: [
          { operation: "trash", targetKey: "icloud-a", status: "unknown" },
          { operation: "trash", targetKey: "icloud-b", status: "unknown" }
        ]
      }
    })

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it.each([
    ["trashItems", "trash", 1],
    ["restoreItems", "restore", 0]
  ] as const)(
    "reports prior confirmed, current unknown, and never-dispatched targets for %s",
    async (command, operation, expectedDeletedState) => {
      const { messages, restore } = collectMessages()
      const targets = Array.from({ length: 101 }, (_, index) => ({
        dedupKey: `icloud-batch-${index}`,
        mediaKey: `media-batch-${index}`,
        ref: {
          recordName: `asset-batch-${index}`,
          changeTag: `before-${index}`,
          zoneName: "PrimarySync",
          ownerRecordName: "_defaultOwner"
        }
      }))
      const performanceSpy = vi
        .spyOn(window.performance, "getEntriesByType")
        .mockReturnValue([{ name: queryUrl } as PerformanceEntry])
      let modifyCalls = 0
      const fetchSpy = installMutationResponse((body) => {
        modifyCalls += 1
        if (modifyCalls !== 1) {
          return { ok: true, json: async () => ({}) } as Response
        }
        return {
          ok: true,
          json: async () => ({
            records: body.operations.map((entry: any) =>
              updatedRecord(
                entry.record.recordName,
                `after-${entry.record.recordName}`,
                expectedDeletedState
              )
            )
          })
        } as Response
      })
      const requestId = `icloud-not-dispatched-${operation}`
      sendCommand(command, requestId, {
        dedupKeys: targets.map((target) => target.dedupKey),
        ...(command === "trashItems"
          ? { mediaKeysToTrash: targets.map((target) => target.mediaKey) }
          : {}),
        icloudAssetRefs: targets.map((target) => target.ref)
      })

      await waitForProviderResult(messages, requestId)
      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === command &&
          message.requestId === requestId
      )

      expect(modifyCalls).toBe(2)
      expect(result.success).toBe(false)
      expect(result.data.outcomes).toHaveLength(targets.length)
      expect(result.data.outcomes.slice(0, 50)).toEqual(
        targets.slice(0, 50).map((target) => ({
          operation,
          targetKey: target.dedupKey,
          status: "confirmed"
        }))
      )
      expect(result.data.outcomes.slice(50, 100)).toEqual(
        targets.slice(50, 100).map((target) => ({
          operation,
          targetKey: target.dedupKey,
          status: "unknown",
          reason: expect.any(String)
        }))
      )
      expect(result.data.outcomes[100]).toMatchObject({
        operation,
        targetKey: targets[100].dedupKey,
        status: "failed",
        reason: expect.stringMatching(/not dispatched/i)
      })
      expect(result.data.notDispatchedDedupKeys).toEqual([
        targets[100].dedupKey
      ])

      const progress = messages.filter(
        (message) =>
          message.action === "gptkProgress" &&
          message.command === command &&
          message.requestId === requestId
      )
      expect(progress.length).toBeGreaterThan(0)
      expect(
        progress.map((message) => message.data?.outcomes?.length ?? 0)
      ).toEqual([0, 50, 50])
      expect(progress[1].data.outcomes).toEqual(
        targets.slice(0, 50).map((target) => ({
          operation,
          targetKey: target.dedupKey,
          status: "confirmed"
        }))
      )
      expect(progress[1].data.icloudAssetRefs).toHaveLength(50)
      for (const message of progress) {
        expect(message.data).not.toHaveProperty("notDispatchedDedupKeys")
        const keys = (message.data?.outcomes || []).map(
          (outcome: any) => outcome.targetKey
        )
        expect(new Set(keys).size).toBe(keys.length)
      }

      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  )

  it("does not confirm Trash when the returned deletion state contradicts the request", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([{ name: queryUrl } as PerformanceEntry])
    const fetchSpy = installMutationResponse(() => ({
      ok: true,
      json: async () => ({
        records: [
          updatedRecord("asset-a", undefined, 0),
          updatedRecord("asset-b", undefined, 1)
        ]
      })
    } as Response))

    sendCommand("trashItems", "icloud-wrong-state-trash-response", {
      dedupKeys: requestTargets.map((target) => target.dedupKey),
      mediaKeysToTrash: requestTargets.map((target) => target.mediaKey),
      icloudAssetRefs: requestTargets.map((target) => target.ref)
    })
    await flush()
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === "icloud-wrong-state-trash-response"
    )
    expect(result).toMatchObject({
      success: false,
      data: {
        trashedCount: 0,
        trashedDedupKeys: [],
        outcomes: [
          { operation: "trash", targetKey: "icloud-a", status: "unknown" },
          { operation: "trash", targetKey: "icloud-b", status: "unknown" }
        ]
      }
    })

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it("marks an HTTP 503 after dispatch unknown without retrying it", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([{ name: queryUrl } as PerformanceEntry])
    const fetchSpy = installMutationResponse(() => ({
      ok: false,
      status: 503,
      text: async () => "temporary service error"
    } as Response))

    sendCommand("trashItems", "icloud-ambiguous-trash-response", {
      dedupKeys: requestTargets.map((target) => target.dedupKey),
      mediaKeysToTrash: requestTargets.map((target) => target.mediaKey),
      icloudAssetRefs: requestTargets.map((target) => target.ref)
    })
    await flush()
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === "icloud-ambiguous-trash-response"
    )
    expect(result).toMatchObject({
      success: false,
      data: {
        trashedCount: 0,
        outcomes: [
          { operation: "trash", targetKey: "icloud-a", status: "unknown" },
          { operation: "trash", targetKey: "icloud-b", status: "unknown" }
        ]
      }
    })
    expect(
      fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes("/records/modify?")
      )
    ).toHaveLength(1)

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it.each([
    ["an empty object", {}],
    ["an empty records array", { records: [] }],
    ["a partial response", { records: [updatedRecord("asset-a")] }],
    [
      "duplicate records",
      { records: [updatedRecord("asset-a"), updatedRecord("asset-a")] }
    ],
    [
      "an unrequested record",
      { records: [updatedRecord("asset-a"), updatedRecord("asset-other")] }
    ],
    [
      "a stale reference",
      {
        records: [
          updatedRecord("asset-a"),
          { ...updatedRecord("asset-b"), recordChangeTag: undefined }
        ]
      }
    ]
  ])("does not confirm Restore after %s", async (_label, responseBody) => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([{ name: queryUrl } as PerformanceEntry])
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => responseBody
    } as Response)

    sendCommand("restoreItems", "icloud-invalid-restore-response", {
      dedupKeys: requestTargets.map((target) => target.dedupKey),
      icloudAssetRefs: requestTargets.map((target) => ({
        ...target.ref,
        changeTag: `trashed-${target.ref.changeTag}`
      }))
    })
    await flush()
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "restoreItems" &&
        message.requestId === "icloud-invalid-restore-response"
    )
    expect(result).toMatchObject({
      success: false,
      data: {
        restoredCount: 0,
        restoredDedupKeys: [],
        outcomes: [
          {
            operation: "restore",
            targetKey: "icloud-a",
            status: "unknown"
          },
          {
            operation: "restore",
            targetKey: "icloud-b",
            status: "unknown"
          }
        ]
      }
    })

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it("does not confirm Restore when the returned deletion state contradicts the request", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([{ name: queryUrl } as PerformanceEntry])
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [
          updatedRecord("asset-a", undefined, 1),
          updatedRecord("asset-b", undefined, 0)
        ]
      })
    } as Response)

    sendCommand("restoreItems", "icloud-wrong-state-restore-response", {
      dedupKeys: requestTargets.map((target) => target.dedupKey),
      icloudAssetRefs: requestTargets.map((target) => ({
        ...target.ref,
        changeTag: `trashed-${target.ref.changeTag}`
      }))
    })
    await flush()
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "restoreItems" &&
        message.requestId === "icloud-wrong-state-restore-response"
    )
    expect(result).toMatchObject({
      success: false,
      data: {
        restoredCount: 0,
        restoredDedupKeys: [],
        outcomes: [
          { operation: "restore", targetKey: "icloud-a", status: "unknown" },
          { operation: "restore", targetKey: "icloud-b", status: "unknown" }
        ]
      }
    })

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })
})

describe("iCloud Trash favorite preflight", () => {
  const queryUrl =
    "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"

  const target = (suffix: string) => ({
    dedupKey: `master-${suffix}`,
    mediaKey: `icloud-master-${suffix}`,
    ref: {
      recordName: `asset-${suffix}`,
      changeTag: `scan-tag-${suffix}`,
      zoneName: "PrimarySync",
      ownerRecordName: "_defaultOwner"
    }
  })

  const currentAsset = (
    selected: ReturnType<typeof target>,
    favorite: unknown,
    changeTag = `current-tag-${selected.ref.recordName}`,
    overrides: Record<string, unknown> = {}
  ) => ({
    recordName: selected.ref.recordName,
    recordType: "CPLAsset",
    recordChangeTag: changeTag,
    zoneID: {
      zoneName: selected.ref.zoneName,
      ownerRecordName: selected.ref.ownerRecordName
    },
    fields: {
      ...(favorite === undefined ? {} : { isFavorite: { value: favorite } }),
      ...overrides
    }
  })

  const successModifyResponse = (body: any) => ({
    records: body.operations.map((entry: any) => ({
      recordName: entry.record.recordName,
      recordType: "CPLAsset",
      recordChangeTag: `after-${entry.record.recordName}`,
      zoneID: { zoneName: "PrimarySync", ownerRecordName: "_defaultOwner" },
      fields: { isDeleted: { value: 1 } }
    }))
  })

  const installProviderRequests = (
    lookupResponse: (body: any) => unknown,
    modifyResponse: (body: any) => unknown = successModifyResponse
  ) => {
    const lookupBodies: any[] = []
    const modifyBodies: any[] = []
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      async (url, init) => {
        const path = new URL(String(url)).pathname
        const body = JSON.parse(String(init?.body || "{}"))
        if (path.endsWith("/records/lookup")) {
          lookupBodies.push(body)
          return {
            ok: true,
            json: async () => lookupResponse(body)
          } as Response
        }
        if (path.endsWith("/records/modify")) {
          modifyBodies.push(body)
          return {
            ok: true,
            json: async () => modifyResponse(body)
          } as Response
        }
        throw new Error("Unexpected iCloud Photos request route.")
      }
    )
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([{ name: queryUrl } as PerformanceEntry])
    return {
      fetchSpy,
      lookupBodies,
      modifyBodies,
      restore() {
        fetchSpy.mockRestore()
        performanceSpy.mockRestore()
      }
    }
  }

  const commandSession = () =>
    (window as any).__GPD_COMMAND_HOST__.providerSessionId as string

  const waitForTrash = async (messages: any[], requestId: string) => {
    await flushProviderWork()
    return messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "trashItems" &&
        message.requestId === requestId
    )
  }

  it("rechecks favorite state per exact asset and uses the fresh tag for eligible targets", async () => {
    document.body.innerHTML = ""
    const off = target("off")
    const becameFavorite = target("became-favorite")
    const { messages, restore } = collectMessages()
    const requests = installProviderRequests((body) => ({
      records: body.records.map((record: { recordName: string }) =>
        record.recordName === off.ref.recordName
          ? currentAsset(off, 0, "tag-current-off")
          : currentAsset(becameFavorite, 1, "tag-current-favorite")
      )
    }))

    try {
      sendCommand(
        "trashItems",
        "icloud-favorite-off-to-on",
        {
          providerSessionId: commandSession(),
          dedupKeys: [off.dedupKey, becameFavorite.dedupKey],
          mediaKeysToTrash: [off.mediaKey, becameFavorite.mediaKey],
          icloudAssetRefs: [off.ref, becameFavorite.ref]
        },
        "icloud"
      )
      const result = await waitForTrash(messages, "icloud-favorite-off-to-on")

      expect(requests.lookupBodies).toHaveLength(1)
      expect(requests.lookupBodies[0]).toMatchObject({
        records: [
          { recordName: off.ref.recordName },
          { recordName: becameFavorite.ref.recordName }
        ],
        zoneID: { zoneName: "PrimarySync", ownerRecordName: "_defaultOwner" },
        desiredKeys: expect.arrayContaining(["isFavorite", "isDeleted"])
      })
      expect(requests.modifyBodies).toHaveLength(1)
      expect(requests.modifyBodies[0]).toMatchObject({
        atomic: true,
        operations: [
          {
            operationType: "update",
            record: {
              recordName: off.ref.recordName,
              recordChangeTag: "tag-current-off",
              fields: { isDeleted: { value: 1 } }
            }
          }
        ]
      })
      expect(requests.modifyBodies[0].operations).toHaveLength(1)
      expect(result).toMatchObject({
        success: false,
        data: {
          trashedCount: 1,
          trashedDedupKeys: [off.dedupKey],
          outcomes: [
            { operation: "trash", targetKey: off.dedupKey, status: "confirmed" },
            { operation: "trash", targetKey: becameFavorite.dedupKey, status: "failed" }
          ],
          notDispatchedDedupKeys: [becameFavorite.dedupKey]
        }
      })
    } finally {
      requests.restore()
      document.body.innerHTML = ""
      restore()
    }
  })

  it("requires an exact unknown-favorite acknowledgement but never lets it override fresh true", async () => {
    document.body.innerHTML = ""
    const unknown = target("unknown")
    const turnedFavorite = target("turned-favorite")
    const { messages, restore } = collectMessages()
    const requests = installProviderRequests((body) => ({
      records: body.records.map((record: { recordName: string }) =>
        record.recordName === turnedFavorite.ref.recordName
          ? currentAsset(turnedFavorite, 1, "tag-current-true")
          : currentAsset(unknown, undefined, "tag-current-unknown")
      )
    }))

    try {
      sendCommand(
        "trashItems",
        "icloud-unknown-favorite-no-ack",
        {
          providerSessionId: commandSession(),
          dedupKeys: [unknown.dedupKey],
          mediaKeysToTrash: [unknown.mediaKey],
          icloudAssetRefs: [unknown.ref]
        },
        "icloud"
      )
      const unacknowledged = await waitForTrash(
        messages,
        "icloud-unknown-favorite-no-ack"
      )
      expect(requests.modifyBodies).toHaveLength(0)
      expect(unacknowledged).toMatchObject({
        success: false,
        data: {
          trashedCount: 0,
          outcomes: [
            { operation: "trash", targetKey: unknown.dedupKey, status: "failed" }
          ],
          notDispatchedDedupKeys: [unknown.dedupKey]
        }
      })

      sendCommand(
        "trashItems",
        "icloud-unknown-favorite-ack",
        {
          providerSessionId: commandSession(),
          dedupKeys: [unknown.dedupKey],
          mediaKeysToTrash: [unknown.mediaKey],
          icloudAssetRefs: [unknown.ref],
          acknowledgedUnknownFavoriteDedupKeys: [unknown.dedupKey]
        },
        "icloud"
      )
      const acknowledged = await waitForTrash(messages, "icloud-unknown-favorite-ack")
      expect(requests.modifyBodies).toHaveLength(1)
      expect(requests.modifyBodies[0].operations[0].record.recordChangeTag).toBe(
        "tag-current-unknown"
      )
      expect(acknowledged).toMatchObject({
        success: true,
        data: {
          trashedDedupKeys: [unknown.dedupKey],
          outcomes: [
            { operation: "trash", targetKey: unknown.dedupKey, status: "confirmed" }
          ]
        }
      })

      sendCommand(
        "trashItems",
        "icloud-unknown-ack-currently-favorite",
        {
          providerSessionId: commandSession(),
          dedupKeys: [turnedFavorite.dedupKey],
          mediaKeysToTrash: [turnedFavorite.mediaKey],
          icloudAssetRefs: [turnedFavorite.ref],
          acknowledgedUnknownFavoriteDedupKeys: [turnedFavorite.dedupKey]
        },
        "icloud"
      )
      const freshFavorite = await waitForTrash(
        messages,
        "icloud-unknown-ack-currently-favorite"
      )
      expect(requests.modifyBodies).toHaveLength(1)
      expect(freshFavorite).toMatchObject({
        success: false,
        data: {
          trashedCount: 0,
          outcomes: [
            { operation: "trash", targetKey: turnedFavorite.dedupKey, status: "failed" }
          ],
          notDispatchedDedupKeys: [turnedFavorite.dedupKey]
        }
      })
    } finally {
      requests.restore()
      document.body.innerHTML = ""
      restore()
    }
  })

  it("rejects foreign acknowledgements and non-personal asset refs before dispatch", async () => {
    document.body.innerHTML = ""
    const selected = target("selected")
    const foreignZone = {
      ...target("foreign-zone"),
      ref: {
        ...target("foreign-zone").ref,
        zoneName: "SharedAlbum"
      }
    }
    const { messages, restore } = collectMessages()
    const requests = installProviderRequests((body) => ({
      records: body.records.map((record: { recordName: string }) =>
        currentAsset(selected, undefined, "tag-current-selected")
      )
    }))

    try {
      sendCommand(
        "trashItems",
        "icloud-foreign-favorite-ack",
        {
          providerSessionId: commandSession(),
          dedupKeys: [selected.dedupKey],
          mediaKeysToTrash: [selected.mediaKey],
          icloudAssetRefs: [selected.ref],
          acknowledgedUnknownFavoriteDedupKeys: ["master-not-selected"]
        },
        "icloud"
      )
      const foreignAckResult = await waitForTrash(messages, "icloud-foreign-favorite-ack")
      expect(requests.lookupBodies).toHaveLength(0)
      expect(requests.modifyBodies).toHaveLength(0)
      expect(foreignAckResult).toMatchObject({
        success: false,
        data: {
          outcomes: [
            { operation: "trash", targetKey: selected.dedupKey, status: "failed" }
          ],
          notDispatchedDedupKeys: [selected.dedupKey]
        }
      })

      sendCommand(
        "trashItems",
        "icloud-foreign-zone-target",
        {
          providerSessionId: commandSession(),
          dedupKeys: [foreignZone.dedupKey],
          mediaKeysToTrash: [foreignZone.mediaKey],
          icloudAssetRefs: [foreignZone.ref],
          acknowledgedUnknownFavoriteDedupKeys: [foreignZone.dedupKey]
        },
        "icloud"
      )
      const foreignZoneResult = await waitForTrash(messages, "icloud-foreign-zone-target")
      expect(requests.lookupBodies).toHaveLength(0)
      expect(requests.modifyBodies).toHaveLength(0)
      expect(foreignZoneResult).toMatchObject({
        success: false,
        data: {
          outcomes: [
            { operation: "trash", targetKey: foreignZone.dedupKey, status: "failed" }
          ],
          notDispatchedDedupKeys: [foreignZone.dedupKey]
        }
      })
    } finally {
      requests.restore()
      document.body.innerHTML = ""
      restore()
    }
  })

  it("allows exact request-scoped lookup records when iCloud omits response zoneID", async () => {
    document.body.innerHTML = ""
    const acknowledgedUnknown = target("lookup-zone-unknown")
    const explicitNotFavorite = target("lookup-zone-false")
    const { messages, restore } = collectMessages()
    const requests = installProviderRequests((body) => ({
      records: body.records.map((requested: { recordName: string }) => {
        const selected =
          requested.recordName === acknowledgedUnknown.ref.recordName
            ? acknowledgedUnknown
            : explicitNotFavorite
        const favorite =
          selected === acknowledgedUnknown ? undefined : 0
        const record = currentAsset(
          selected,
          favorite,
          `tag-fresh-${selected.ref.recordName}`
        )
        delete (record as { zoneID?: unknown }).zoneID
        return record
      })
    }))

    try {
      sendCommand(
        "trashItems",
        "icloud-request-scoped-omitted-zone",
        {
          providerSessionId: commandSession(),
          dedupKeys: [
            acknowledgedUnknown.dedupKey,
            explicitNotFavorite.dedupKey
          ],
          mediaKeysToTrash: [
            acknowledgedUnknown.mediaKey,
            explicitNotFavorite.mediaKey
          ],
          icloudAssetRefs: [
            acknowledgedUnknown.ref,
            explicitNotFavorite.ref
          ],
          acknowledgedUnknownFavoriteDedupKeys: [
            acknowledgedUnknown.dedupKey
          ]
        },
        "icloud"
      )
      const result = await waitForTrash(
        messages,
        "icloud-request-scoped-omitted-zone"
      )

      expect(requests.lookupBodies).toHaveLength(1)
      expect(requests.lookupBodies[0]).toMatchObject({
        records: [
          { recordName: acknowledgedUnknown.ref.recordName },
          { recordName: explicitNotFavorite.ref.recordName }
        ],
        zoneID: { zoneName: "PrimarySync", ownerRecordName: "_defaultOwner" }
      })
      expect(requests.modifyBodies).toHaveLength(1)
      expect(requests.modifyBodies[0]).toMatchObject({
        atomic: true,
        zoneID: { zoneName: "PrimarySync", ownerRecordName: "_defaultOwner" },
        operations: [
          {
            operationType: "update",
            record: {
              recordName: acknowledgedUnknown.ref.recordName,
              recordChangeTag: `tag-fresh-${acknowledgedUnknown.ref.recordName}`,
              fields: { isDeleted: { value: 1 } }
            }
          },
          {
            operationType: "update",
            record: {
              recordName: explicitNotFavorite.ref.recordName,
              recordChangeTag: `tag-fresh-${explicitNotFavorite.ref.recordName}`,
              fields: { isDeleted: { value: 1 } }
            }
          }
        ]
      })
      expect(result).toMatchObject({
        success: true,
        data: {
          trashedDedupKeys: [
            acknowledgedUnknown.dedupKey,
            explicitNotFavorite.dedupKey
          ],
          outcomes: [
            {
              operation: "trash",
              targetKey: acknowledgedUnknown.dedupKey,
              status: "confirmed"
            },
            {
              operation: "trash",
              targetKey: explicitNotFavorite.dedupKey,
              status: "confirmed"
            }
          ]
        }
      })
    } finally {
      requests.restore()
      document.body.innerHTML = ""
      restore()
    }
  })

  it("fails closed when an acknowledged exact lookup is missing, foreign, or has no fresh tag", async () => {
    document.body.innerHTML = ""
    const foreign = target("lookup-foreign")
    const missing = target("lookup-missing")
    const missingTag = target("lookup-missing-tag")
    const malformedZone = target("lookup-malformed-zone")
    const selected = [foreign, missing, missingTag, malformedZone]
    const { messages, restore } = collectMessages()
    const requests = installProviderRequests((body) => ({
      records: body.records.flatMap((requested: { recordName: string }) => {
        if (requested.recordName === foreign.ref.recordName) {
          return [
            {
              ...currentAsset(foreign, undefined, "foreign-current-tag"),
              zoneID: {
                zoneName: "SharedAlbum",
                ownerRecordName: "_defaultOwner"
              }
            }
          ]
        }
        if (requested.recordName === missingTag.ref.recordName) {
          return [
            currentAsset(missingTag, undefined, "", {})
          ]
        }
        if (requested.recordName === malformedZone.ref.recordName) {
          return [
            {
              ...currentAsset(malformedZone, undefined),
              zoneID: { zoneName: "PrimarySync" }
            }
          ]
        }
        return []
      })
    }))

    try {
      sendCommand(
        "trashItems",
        "icloud-invalid-current-favorite-lookup",
        {
          providerSessionId: commandSession(),
          dedupKeys: selected.map((item) => item.dedupKey),
          mediaKeysToTrash: selected.map((item) => item.mediaKey),
          icloudAssetRefs: selected.map((item) => item.ref),
          acknowledgedUnknownFavoriteDedupKeys: selected.map(
            (item) => item.dedupKey
          )
        },
        "icloud"
      )
      const result = await waitForTrash(
        messages,
        "icloud-invalid-current-favorite-lookup"
      )

      expect(requests.lookupBodies).toHaveLength(1)
      expect(requests.modifyBodies).toHaveLength(0)
      expect(result).toMatchObject({
        success: false,
        data: {
          outcomes: selected.map((item) => ({
            operation: "trash",
            targetKey: item.dedupKey,
            status: "failed"
          })),
          notDispatchedDedupKeys: selected.map((item) => item.dedupKey)
        }
      })
    } finally {
      requests.restore()
      document.body.innerHTML = ""
      restore()
    }
  })

  it("stops before modify if the iCloud provider session changes after lookup", async () => {
    document.body.innerHTML = ""
    const selected = target("session-drift")
    const { messages, restore } = collectMessages()
    const host = (window as any).__GPD_COMMAND_HOST__
    const requests = installProviderRequests(async () => {
      await host.setProviderIdentity("second@example.com")
      return {
        records: [currentAsset(selected, 0, "tag-current-session-drift")]
      }
    })

    try {
      const originalSession = await host.setProviderIdentity("first@example.com")
      sendCommand(
        "trashItems",
        "icloud-session-drift-before-modify",
        {
          providerSessionId: originalSession,
          dedupKeys: [selected.dedupKey],
          mediaKeysToTrash: [selected.mediaKey],
          icloudAssetRefs: [selected.ref]
        },
        "icloud"
      )
      const result = await waitForTrash(messages, "icloud-session-drift-before-modify")
      expect(requests.lookupBodies).toHaveLength(1)
      expect(requests.modifyBodies).toHaveLength(0)
      expect(result).toMatchObject({
        success: false,
        data: {
          outcomes: [
            { operation: "trash", targetKey: selected.dedupKey, status: "failed" }
          ],
          notDispatchedDedupKeys: [selected.dedupKey]
        }
      })
    } finally {
      requests.restore()
      document.body.innerHTML = ""
      restore()
    }
  })

  it("does not confirm or replay Trash when CloudKit rejects the fresh conditional tag", async () => {
    document.body.innerHTML = ""
    const selected = target("conditional-tag")
    const { messages, restore } = collectMessages()
    const requests = installProviderRequests(
      () => ({ records: [currentAsset(selected, 0, "tag-current-before-modify")] }),
      () => ({
        records: [
          {
            recordName: selected.ref.recordName,
            reason: "The record change tag is stale.",
            serverErrorCode: "CONFLICT"
          }
        ]
      })
    )

    try {
      sendCommand(
        "trashItems",
        "icloud-conditional-tag-conflict",
        {
          providerSessionId: commandSession(),
          dedupKeys: [selected.dedupKey],
          mediaKeysToTrash: [selected.mediaKey],
          icloudAssetRefs: [selected.ref]
        },
        "icloud"
      )
      const result = await waitForTrash(messages, "icloud-conditional-tag-conflict")
      expect(requests.modifyBodies).toHaveLength(1)
      expect(requests.modifyBodies[0].operations[0].record.recordChangeTag).toBe(
        "tag-current-before-modify"
      )
      expect(result).toMatchObject({
        success: false,
        data: {
          trashedCount: 0,
          trashedDedupKeys: [],
          outcomes: [
            { operation: "trash", targetKey: selected.dedupKey, status: "failed" }
          ],
          notDispatchedDedupKeys: []
        }
      })
      expect(
        requests.fetchSpy.mock.calls.filter(([url]) =>
          String(url).includes("/records/modify?")
        )
      ).toHaveLength(1)
    } finally {
      requests.restore()
      document.body.innerHTML = ""
      restore()
    }
  })
})

describe("iCloud metadata and pagination evidence", () => {
  let requestSequence = 0

  async function scanFixture(
    masterFields: Record<string, unknown> = {},
    assetFields: Record<string, unknown> = {},
    pageEnvelope: Record<string, unknown> = {},
    indexedCount = 1,
    scanArgs: Record<string, unknown> = {},
    recordCopies = 1,
    transformRecords: (records: any[]) => any[] = (records) => records
  ) {
    const requestId = `icloud-evidence-${++requestSequence}`
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const records = Array.from({ length: recordCopies }, (_, index) => [
      {
        recordName: `master-evidence-${index}`,
        recordType: "CPLMaster",
        fields: {
          itemType: { value: "public.jpeg" },
          filenameEnc: { value: btoa("evidence.jpg") },
          resJPEGThumbRes: {
            value: {
              downloadURL: "https://cvws-h2.icloud-content.com/B/thumb/${f}"
            }
          },
          ...Object.fromEntries(
            Object.entries(masterFields).map(([key, value]) => [key, { value }])
          )
        }
      },
      {
        recordName: `asset-evidence-${index}`,
        recordType: "CPLAsset",
        fields: {
          masterRef: { value: { recordName: `master-evidence-${index}` } },
          ...Object.fromEntries(
            Object.entries(assetFields).map(([key, value]) => [key, { value }])
          )
        }
      }
    ]).flat()
    let pageCalls = 0
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/internal/records/query/batch?")) {
        return {
          ok: true,
          json: async () => ({
            batch: [{ records: [{ fields: { itemCount: { value: indexedCount } } }] }]
          })
        } as Response
      }
      pageCalls += 1
      return {
        ok: true,
        json: async () => ({ records: transformRecords(records), ...pageEnvelope })
      } as Response
    })
    try {
      sendCommand("getAllMediaItems", requestId, scanArgs)
      const result = await waitForProviderResult(messages, requestId)
      return { result, pageCalls }
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  }

  it("keeps iCloud original quality unknown despite original-resource metadata", async () => {
    const { result } = await scanFixture(
      {
        resOriginalWidth: 4000,
        resOriginalHeight: 3000,
        resOriginalFileSize: 5_000_000,
        resOriginalFileType: "public.jpeg",
        resOriginalFingerprint: "provider-original-fingerprint",
        resOriginalRes: {
          downloadURL: "https://cvws-h2.icloud-content.com/B/original/${f}"
        }
      },
      { assetDate: 1_000 }
    )

    expect(result).toMatchObject({
      success: true,
      data: [
        expect.objectContaining({
          mediaKind: "photo",
          resWidth: 4000,
          resHeight: 3000,
          size: 5_000_000,
          isOriginalQuality: null
        })
      ]
    })
  })

  it.each([
    ["boolean true", true],
    ["boolean false", false],
    ["numeric string", "1000"],
    ["whitespace", " "],
    ["empty array", []],
    ["numeric array", [1000]],
    ["empty object", {}],
    ["infinity", Infinity],
    ["negative infinity", -Infinity],
    ["NaN", NaN]
  ])("[PARITY-METADATA] rejects malformed CloudKit numeric %s values", async (_label, value) => {
    const { result } = await scanFixture(
      {
        originalCreationDate: value,
        resOriginalWidth: value,
        resOriginalHeight: value,
        resOriginalFileSize: value,
        resOriginalRes: { size: value },
        resJPEGMedRes: { size: 23 }
      },
      { assetDate: value, addedDate: value }
    )
    expect(result).toMatchObject({ success: true, data: [{ mediaKind: "photo" }] })
    const [item] = result.data
    expect(Number.isFinite(item.timestamp)).toBe(false)
    expect(Number.isFinite(item.creationTimestamp)).toBe(false)
    expect(item.timestampProvenance).toBe("unknown")
    expect(item.creationTimestampProvenance).toBe("unknown")
    expect(item.resWidth).toBeUndefined()
    expect(item.resHeight).toBeUndefined()
    expect(item.size).toBeUndefined()
  })

  it("[SAFE-04] does not promote an iCloud rendition fingerprint to exact-content identity", async () => {
    const { result } = await scanFixture({
      resJPEGMedFingerprint: "shared-medium-rendition-fingerprint"
    })

    expect(result).toMatchObject({
      success: true,
      data: [expect.objectContaining({ mediaKind: "photo" })]
    })
    expect(result.data[0].exactContentHash).toBeUndefined()
    expect(result.data[0].contentHash).toBeUndefined()
  })

  it("[PARITY-METADATA] uses finite original dimensions and original size without preview substitution", async () => {
    const { result } = await scanFixture(
      {
        resOriginalWidth: -1920,
        resOriginalHeight: Infinity,
        resJPEGMedRes: { size: 23 }
      },
      {
        assetDate: 0,
        addedDate: 2000,
        resOriginalWidth: 1920,
        resOriginalHeight: 1080
      }
    )
    expect(result).toMatchObject({
      success: true,
      data: [{ timestamp: 0, creationTimestamp: 2000, resWidth: 1920, resHeight: 1080 }]
    })
    expect(result.data[0].size).toBeUndefined()
  })

  it.each([
    ["remaining records", { moreComing: true }],
    ["malformed continuation flag", { moreComing: "false" }],
    ["terminal cursor contradiction", { moreComing: false, continuationMarker: "next" }],
    ["unconsumed cursor", { continuationMarker: "next" }]
  ])("[PARITY-06] refuses count-only exhaustion with %s", async (_label, pageEnvelope) => {
    const { result } = await scanFixture({}, { assetDate: 1000 }, pageEnvelope)
    expect(result.scanCoverage.status).not.toBe("complete")
    expect(result.providerSyncToken).toBeUndefined()
  })

  it.each([
    ["explicit failure", { success: false }],
    ["provider error", { serverErrorCode: "ZONE_NOT_FOUND" }],
    ["error payload", { error: { reason: "Incomplete provider query" } }],
    ["partial response", { partial: true }],
    ["malformed partial flag", { partial: "false" }]
  ])("[ICLOUD-QUERY-ENVELOPE] rejects %s even when rows match the index", async (_label, envelope) => {
    const { result } = await scanFixture(
      {}, { assetDate: 1000 }, { ...envelope, syncToken: "envelope-snapshot" }
    )
    expect(result.scanCoverage).toMatchObject({
      status: "partial", stopReason: "coverage_unknown", itemsReturned: 0
    })
    expect(result.data).toEqual([])
    expect(result.providerSyncToken).toBeUndefined()
  })

  it("[PARITY-06] probes a zero library index before claiming empty exhaustion", async () => {
    const { result, pageCalls } = await scanFixture({}, {}, {}, 0)
    expect(pageCalls).toBe(1)
    expect(result.scanCoverage).toMatchObject({
      status: "partial",
      stopReason: "pagination_error"
    })
  })

  it("[PARITY-06] confirms a zero library index with a terminal empty page", async () => {
    const { result, pageCalls } = await scanFixture({}, {}, { records: [] }, 0)
    expect(pageCalls).toBe(1)
    expect(result.scanCoverage).toMatchObject({
      status: "complete",
      stopReason: "exhausted",
      itemsVisited: 0,
      itemsReturned: 0,
      itemsSkipped: 0,
      totalItems: 0
    })
  })

  it.each([
    ["missing asset ID", (records: any[]) => {
      delete records[1].recordName
      return records
    }],
    ["missing master ID", (records: any[]) => {
      delete records[0].recordName
      delete records[1].fields.masterRef
      return records
    }],
    ["non-string master ID", (records: any[]) => {
      records[0].recordName = 42
      records[1].fields.masterRef.value.recordName = 42
      return records
    }],
    ["blank asset ID", (records: any[]) => {
      records[1].recordName = " "
      return records
    }],
    ["control character in asset ID", (records: any[]) => {
      records[1].recordName = "asset\u0000foreign"
      return records
    }],
    ["duplicate asset ID", (records: any[]) => [...records, { ...records[1] }]],
    ["two assets for one master", (records: any[]) => [
      ...records, { ...records[1], recordName: "asset-ambiguous" }
    ]],
    ["dangling master reference", (records: any[]) => {
      records[1].fields.masterRef.value.recordName = "missing-master"
      records[1].fields.itemType = records[0].fields.itemType
      records[1].fields.resJPEGThumbRes = records[0].fields.resJPEGThumbRes
      return records
    }],
    ["unpaired master beside valid media", (records: any[]) => [
      ...records, { ...records[0], recordName: "unpaired-master" }
    ]],
    ["foreign asset zone", (records: any[]) => {
      records[1].zoneID = { zoneName: "SharedSync" }
      return records
    }],
    ["error beside valid media", (records: any[]) => [
      ...records, { recordName: "unresolved", serverErrorCode: "UNKNOWN_ITEM" }
    ]]
  ])("[ICLOUD-SCAN-IDENTITY] refuses complete coverage for %s", async (_label, transformRecords) => {
    const { result } = await scanFixture(
      {}, { assetDate: 1000 }, { syncToken: "identity-snapshot" }, 1, {}, 1,
      transformRecords as (records: any[]) => any[]
    )
    expect(result.scanCoverage).toMatchObject({
      status: "partial",
      stopReason: "coverage_unknown",
      itemsVisited: 0,
      itemsReturned: 0
    })
    expect(result.data).toEqual([])
    expect(result.providerSyncToken).toBeUndefined()
  })

  it("[ICLOUD-SCAN-IDENTITY] preserves the exact two-asset inventory across every record ordering", async () => {
    const permutations = (values: number[]): number[][] => values.length === 0
      ? [[]]
      : values.flatMap((value, index) => permutations([
        ...values.slice(0, index), ...values.slice(index + 1)
      ]).map((tail) => [value, ...tail]))
    const orders = permutations([0, 1, 2, 3])
    expect(orders).toHaveLength(24)
    for (const order of orders) {
      const { result } = await scanFixture({}, { assetDate: 1000 }, {}, 2, {}, 2,
        (records) => {
          for (const record of records.filter((row) => row.recordType === "CPLAsset")) {
            record.recordChangeTag = "fixture-change"
            record.zoneID = { zoneName: "PrimarySync", ownerRecordName: "fixture-owner" }
          }
          return order.map((index) => records[index])
        }
      )
      expect(result.scanCoverage).toMatchObject({
        status: "complete", stopReason: "exhausted", itemsVisited: 2,
        itemsReturned: 2, itemsSkipped: 0, totalItems: 2
      })
      expect(result.data.map((item: any) => [item.dedupKey, item.icloudAsset.recordName]).sort())
        .toEqual([
          ["master-evidence-0", "asset-evidence-0"],
          ["master-evidence-1", "asset-evidence-1"]
        ])
    }
  })

  it("[ICLOUD-SCAN-IDENTITY-PROPERTY] never certifies a page with a corrupt identity or response", async () => {
    const partitions: Record<string, number> = {}
    const defects = ["missing-id", "blank-id", "control-id", "duplicate-id", "shared-master", "dangling-master", "unpaired-master", "foreign-zone", "provider-error", "partial-envelope"] as const
    const property = await fc.check(fc.asyncProperty(
      fc.integer({ min: 1, max: 6 }),
      fc.nat({ max: 5 }),
      fc.boolean(),
      fc.constantFrom(...defects),
      async (count, position, reversed, defect) => {
        partitions[defect] = (partitions[defect] || 0) + 1
        const pageEnvelope = defect === "partial-envelope" ? { partial: true } : {}
        const { result } = await scanFixture({}, { assetDate: 1000 },
          { syncToken: "property-snapshot", ...pageEnvelope }, count, {}, count,
          (records) => {
            const asset = records[(position % count) * 2 + 1]
            if (defect === "missing-id") delete asset.recordName
            if (defect === "blank-id") asset.recordName = "  "
            if (defect === "control-id") asset.recordName += "\u0000"
            if (defect === "duplicate-id") records.push({ ...asset })
            if (defect === "shared-master") records.push({ ...asset, recordName: "another-asset" })
            if (defect === "dangling-master") {
              asset.fields.masterRef.value.recordName = "missing-master"
              asset.fields.itemType = records[0].fields.itemType
              asset.fields.resJPEGThumbRes = records[0].fields.resJPEGThumbRes
            }
            if (defect === "unpaired-master") records.push({ ...records[0], recordName: "unpaired-master" })
            if (defect === "foreign-zone") asset.zoneID = { zoneName: "SharedSync" }
            if (defect === "provider-error") records.push({ recordName: "failed-row", serverErrorCode: "UNKNOWN_ITEM" })
            return reversed ? records.reverse() : records
          }
        )
        expect(result.scanCoverage).toMatchObject({
          status: "partial", stopReason: "coverage_unknown", itemsVisited: 0,
          itemsReturned: 0, itemsSkipped: 0
        })
        expect(result.data).toEqual([])
        expect(result.providerSyncToken).toBeUndefined()
      }
    ), {
      numRuns: 128,
      examples: defects.map((defect) => [1, 0, false, defect] as [number, number, boolean, typeof defect])
    })
    console.info("[ICLOUD-SCAN-IDENTITY-PROPERTY]", JSON.stringify({
      seed: property.seed, runs: property.numRuns, shrinks: property.numShrinks,
      failed: property.failed, partitions,
      ...(property.failed ? {
        counterexample: property.counterexample,
        counterexamplePath: property.counterexamplePath,
        error: property.error
      } : {})
    }))
    expect(property.failed, property.error || "Generated identity contract failed").toBe(false)
    expect(Object.keys(partitions).sort()).toEqual([
      "blank-id", "control-id", "dangling-master", "duplicate-id", "foreign-zone",
      "missing-id", "partial-envelope", "provider-error", "shared-master", "unpaired-master"
    ])
  })

  it.each([1, 2, 3])("[PARITY-06] rejects a page exceeding its indexed count of %i", async (indexedCount) => {
    const { result } = await scanFixture({}, {}, {}, indexedCount, {}, indexedCount + 1)
    expect(result.scanCoverage.status).toBe("partial")
    expect(result.scanCoverage.stopReason).toBe("pagination_error")
    expect(result.providerSyncToken).toBeUndefined()
  })

  it("[PARITY-METADATA] counts unsupported media as skipped without emitting a review identity", async () => {
    const { result } = await scanFixture({ itemType: "public.data" }, { assetDate: 1000 })
    expect(result).toMatchObject({
      success: true,
      data: [],
      scanCoverage: {
        status: "complete",
        itemsVisited: 1,
        itemsReturned: 0,
        itemsSkipped: 1,
        unknownDateItemsSkipped: 0
      }
    })
  })

  it.each([1, 2, 4, 16])("[ICLOUD-LIVE-PHOTO-BOUNDARY] never infers a pair from subtype %i and adjacent still/video records", async (subtype) => {
    const { result } = await scanFixture({}, { assetSubtypeV2: subtype }, {}, 2, {}, 2,
      (records) => {
        records[0].fields.filenameEnc.value = btoa("same-name.heic")
        records[0].fields.itemType.value = "public.heic"
        records[2].fields.filenameEnc.value = btoa("same-name.mov")
        records[2].fields.itemType.value = "com.apple.quicktime-movie"
        return records
      }
    )
    expect(result.scanCoverage).toMatchObject({ status: "complete", itemsReturned: 2 })
    expect(result.data.map((item: any) => [item.dedupKey, item.mediaKind])).toEqual([
      ["master-evidence-0", "photo"], ["master-evidence-1", "video"]
    ])
    for (const item of result.data) expect(item.livePhotoAssociationId).toBeUndefined()
  })
})

describe("iCloud trashItems dry-run", () => {
  it("maps CloudKit media metadata for the shared duplicate pipeline", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true&getCurrentSyncToken=true&dsid=123&clientBuildNumber=2622Build17&clientMasteringNumber=2622Build17&clientId=test"
        } as PerformanceEntry
      ])
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [
          {
            recordName: "master-video-1",
            recordType: "CPLMaster",
            recordChangeTag: "tag-master",
            fields: {
              itemType: { value: "public.quicktime-movie" },
              filenameEnc: { value: btoa("IMG_0001.MOV") },
              resOriginalFingerprint: { value: "original-fingerprint" },
              resOriginalWidth: { value: 1920 },
              resOriginalHeight: { value: 1080 },
              resOriginalRes: {
                value: {
                  size: 1234567,
                  fileChecksum: "original-file-checksum",
                  downloadURL:
                    "https://cvws-h2.icloud-content.com/B/original/${f}"
                }
              },
              resJPEGThumbRes: {
                value: {
                  downloadURL: "https://cvws-h2.icloud-content.com/B/thumb/${f}"
                }
              }
            },
            created: { timestamp: 2000 }
          },
          {
            recordName: "asset-video-1",
            recordType: "CPLAsset",
            recordChangeTag: "tag-asset",
            fields: {
              masterRef: { value: { recordName: "master-video-1" } },
              assetDate: { value: 1000 },
              addedDate: { value: 2000 },
              duration: { value: 500 }
            },
            created: { timestamp: 2000 }
          }
        ]
      })
    } as Response)

    sendCommand("getAllMediaItems", "icloud-cloudkit-scan", { limit: 1 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const result = messages.find(
      (msg) => msg.action === "gptkResult" && msg.command === "getAllMediaItems"
    )
    expect(result).toMatchObject({
      success: true,
      data: [
        {
          mediaKey: "icloud-master-video-1",
          dedupKey: "master-video-1",
          exactContentHash: "icloud-fingerprint-original-fingerprint",
          contentHash: {
            value: "original-fingerprint",
            algorithm: "provider-fingerprint",
            provenance: "original-content",
            verificationSource: "provider-fingerprint"
          },
          provider: "icloud",
          originalContentVerificationCapability: "available",
          mediaKind: "video",
          mimeType: "video/quicktime",
          timestamp: 1000,
          timestampProvenance: "unknown",
          creationTimestamp: 2000,
          creationTimestampProvenance: "creation",
          resWidth: 1920,
          resHeight: 1080,
          fileName: "IMG_0001.MOV",
          size: 1234567,
          duration: 500,
          favoriteStatus: "unknown",
          favoriteSource: "unavailable"
        }
      ]
    })
    expect(result.data[0].thumb).toBe(
      "https://cvws-h2.icloud-content.com/B/thumb/public.jpeg"
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/records/query?"),
      expect.objectContaining({
        method: "POST",
        credentials: "include"
      })
    )

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it("keeps ambiguous provider dates unknown when EXIF capture provenance is unavailable", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [
          {
            recordName: "master-heic",
            recordType: "CPLMaster",
            fields: {
              itemType: { value: "public.heic" },
              originalCreationDate: { value: 1800 },
              resOriginalFileSize: { value: 5000 },
              resOriginalFileType: { value: "public.heif" },
              filenameEnc: { value: btoa("IMG_0002.HEIC") },
              resOriginalRes: {
                value: {
                  size: 4096,
                  fileChecksum: "opaque-checksum-value",
                  downloadURL:
                    "https://cvws-h2.icloud-content.com/B/original/${f}"
                }
              },
              resJPEGThumbRes: {
                value: {
                  downloadURL: "https://cvws-h2.icloud-content.com/B/thumb/${f}"
                }
              }
            }
          },
          {
            recordName: "asset-heic",
            recordType: "CPLAsset",
            fields: {
              masterRef: { value: { recordName: "master-heic" } },
              assetDate: { value: 1800 }
            }
          }
        ]
      })
    } as Response)

    sendCommand("getAllMediaItems", "icloud-date-provenance", { limit: 1 })
    await flush()
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "icloud-date-provenance"
    )
    expect(result).toMatchObject({
      success: true,
      data: [
        {
          mediaKind: "photo",
          mimeType: "image/heif",
          size: 5000,
          exactContentHash: "icloud-checksum-opaque-checksum-value",
          timestamp: 1800,
          timestampProvenance: "unknown",
          creationTimestamp: 1800,
          creationTimestampProvenance: "unknown",
          favoriteStatus: "unknown",
          favoriteSource: "unavailable"
        }
      ]
    })
    expect(result.data[0].contentHash).toBeUndefined()

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it.each([
    ["favorite", 1, "favorite", true, undefined],
    ["favorite boolean", true, "favorite", true, undefined],
    ["favorite string", "1", "favorite", true, undefined],
    ["not-favorite", 0, "not-favorite", false, undefined],
    ["not-favorite boolean", false, "not-favorite", false, undefined],
    ["not-favorite string", "0", "not-favorite", false, undefined],
    ["positive favorite over false asset", false, "favorite", true, true],
    ["positive favorite over zero asset", 0, "favorite", true, 1],
    ["positive favorite over string zero asset", "0", "favorite", true, "1"],
    ["positive favorite over malformed asset", "invalid", "favorite", true, true]
  ])("maps explicit iCloud %s metadata without collapsing false", async (_label, value, status, legacyValue, masterFavorite) => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [
          {
            recordName: "master-favorite",
            recordType: "CPLMaster",
            fields: {
              itemType: { value: "public.jpeg" },
              filenameEnc: { value: btoa("favorite.jpg") },
              ...(masterFavorite === undefined
                ? {}
                : { isFavorite: { value: masterFavorite } }),
              resJPEGThumbRes: {
                value: {
                  downloadURL: "https://cvws-h2.icloud-content.com/B/thumb/${f}"
                }
              }
            }
          },
          {
            recordName: "asset-favorite",
            recordType: "CPLAsset",
            fields: {
              masterRef: { value: { recordName: "master-favorite" } },
              assetDate: { value: 1000 },
              isFavorite: { value }
            }
          }
        ]
      })
    } as Response)

    sendCommand("getAllMediaItems", "icloud-favorite-metadata", { limit: 1 })
    await flush()
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "icloud-favorite-metadata"
    )
    expect(result).toMatchObject({
      success: true,
      data: [
        {
          isFavorite: legacyValue,
          favoriteStatus: status,
          favoriteSource: "provider-metadata"
        }
      ]
    })
    const queryBody = fetchSpy.mock.calls
      .filter(([url]) => String(url).includes("/records/query?"))
      .map(([, init]) => JSON.parse(String(init?.body || "{}")))
      .find((body) => Array.isArray(body.desiredKeys))
    expect(queryBody?.desiredKeys).toContain("isFavorite")

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it("[SAFE-04][VIDEO-PLAYBACK] rejects partial and truncated original streams before hashing", async () => {
    const originalUrl = window.location.href
    const originalBody = document.body.innerHTML
    document.body.innerHTML = ""
    ;(window as any).happyDOM.setURL("https://icloud.com/applications/photos")
    const setAccountEmail = (email: string) => {
      document.body.innerHTML = '<button aria-label="Account"></button>'
      document
        .querySelector('[aria-label="Account"]')
        ?.addEventListener("click", () => {
          const menu = document.createElement("ui-menu-item")
          menu.setAttribute("aria-label", `Signed in as ${email}`)
          document.body.append(menu)
        })
    }
    setAccountEmail("icloud-fixture-before@example.test")
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const originalBytes = new TextEncoder().encode("icloud-original-bytes")
    const records = [
      {
        recordName: "master-original-photo",
        recordType: "CPLMaster",
        fields: {
          itemType: { value: "public.heic" },
          filenameEnc: { value: btoa("fixture-photo.heic") },
          resOriginalFileType: { value: "public.heic" },
          resOriginalFileSize: { value: originalBytes.byteLength },
          resOriginalRes: {
            value: {
              size: originalBytes.byteLength,
              downloadURL:
                "https://cvws-h2.icloud-content.com/B/original-photo/${f}"
            }
          },
          resJPEGThumbRes: {
            value: {
              downloadURL: "https://cvws-h2.icloud-content.com/B/thumb-photo/${f}"
            }
          }
        }
      },
      {
        recordName: "asset-original-photo",
        recordType: "CPLAsset",
        fields: {
          masterRef: { value: { recordName: "master-original-photo" } },
          assetDate: { value: 1000 }
        }
      },
      {
        recordName: "master-original-video",
        recordType: "CPLMaster",
        fields: {
          itemType: { value: "public.quicktime-movie" },
          filenameEnc: { value: btoa("fixture-video.mov") },
          resOriginalFileType: { value: "public.quicktime-movie" },
          resOriginalRes: {
            value: {
              size: 2048,
              downloadURL:
                "https://cvws-h2.icloud-content.com/B/playback-video/${f}"
            }
          },
          resJPEGThumbRes: {
            value: {
              downloadURL: "https://cvws-h2.icloud-content.com/B/thumb-video/${f}"
            }
          }
        }
      },
      {
        recordName: "asset-original-video",
        recordType: "CPLAsset",
        fields: {
          masterRef: { value: { recordName: "master-original-video" } },
          assetDate: { value: 2000 },
          duration: { value: 12 }
        }
      }
    ]
    let deferredOriginalFetch: {
      started: Promise<void>
      signal?: AbortSignal
      response: Promise<Response>
      start: () => void
      resolve: (response: Response) => void
      reject: (error: unknown) => void
    } | null = null
    let queuedOriginalResponse: Response | undefined
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
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes("/internal/records/query/batch?")) {
        return new Response(
          JSON.stringify({
            batch: [
              { records: [{ fields: { itemCount: { value: 2 } } }] }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      }
      if (url.includes("/records/query?")) {
        return new Response(JSON.stringify({ records }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      }
      if (url.includes("/B/original-photo/")) {
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
        if (queuedOriginalResponse) {
          const response = queuedOriginalResponse
          queuedOriginalResponse = undefined
          return response
        }
        return new Response(originalBytes, {
          status: 200,
          headers: { "content-type": "image/heic" }
        })
      }
      return new Response("not found", { status: 404 })
      })

    try {
      sendCommand("healthCheck", "icloud-retrieval-health", {}, "icloud")
      await flushProviderWork()
      const sessionMessage = messages.find(
        (message) =>
          message.requestId === "icloud-retrieval-health" &&
          message.action === "gptkResult"
      )
      expect(sessionMessage).toMatchObject({ success: true })
      const providerSessionId = sessionMessage.providerSessionId
      expect(providerSessionId).toEqual(expect.any(String))
      const scopeFingerprint = "c".repeat(64)

      sendCommand(
        "getAllMediaItems",
        "icloud-original-scan",
        {
          limit: 2,
          providerSessionId,
          scanScopeFingerprint: scopeFingerprint
        },
        "icloud"
      )
      await flushProviderWork()
      const scan = messages.find(
        (message) =>
          message.requestId === "icloud-original-scan" &&
          message.action === "gptkResult"
      )
      expect(scan).toMatchObject({
        success: true,
        scanCoverage: { status: "complete" },
        data: [
          { mediaKey: "icloud-master-original-photo", mediaKind: "photo" },
          {
            mediaKey: "icloud-master-original-video",
            mediaKind: "video",
            mimeType: "video/quicktime"
          }
        ]
      })
      expect(JSON.stringify(scan.data)).not.toContain("/B/original-photo/")
      const photo = scan.data.find(
        (item: any) => item.mediaKind === "photo"
      )
      const video = scan.data.find(
        (item: any) => item.mediaKind === "video"
      )
      const originalFetchCount = () =>
        fetchSpy.mock.calls.filter(([input]) =>
          String(input).includes("/B/original-photo/")
        ).length

      const missingBudgetRequestId = "icloud-original-missing-budget"
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: {
            app: "GPD",
            action: "gptkCommand",
            command: "getOriginalContentHash",
            provider: "icloud",
            requestId: missingBudgetRequestId,
            args: {
              requestId: missingBudgetRequestId,
              mediaKey: photo.mediaKey,
              userOptIn: true,
              providerSessionId,
              scanScopeFingerprint: scopeFingerprint,
              maxBytes: 1024
            }
          }
        })
      )
      await flushProviderWork()
      expect(
        messages.find(
          (message) =>
            message.requestId === missingBudgetRequestId &&
            message.action === "gptkResult"
        )
      ).toMatchObject({ success: false })
      expect(originalFetchCount()).toBe(0)

      sendCommand(
        "getOriginalContentHash",
        "icloud-original-no-opt-in",
        {
          requestId: "icloud-original-no-opt-in",
          mediaKey: photo.mediaKey,
          userOptIn: false,
          providerSessionId,
          scanScopeFingerprint: scopeFingerprint,
          maxBytes: 1024,
          aggregateBudgetBytes: 128
        },
        "icloud"
      )
      await flushProviderWork()
      expect(
        messages.find(
          (message) =>
            message.requestId === "icloud-original-no-opt-in" &&
            message.action === "gptkResult"
        )
      ).toMatchObject({ success: false })
      expect(originalFetchCount()).toBe(0)

      sendCommand(
        "getOriginalContentHash",
        "icloud-original-stale-session",
        {
          requestId: "icloud-original-stale-session",
          mediaKey: photo.mediaKey,
          userOptIn: true,
          providerSessionId: "stale-provider-session",
          scanScopeFingerprint: scopeFingerprint,
          maxBytes: 1024
        },
        "icloud"
      )
      await flushProviderWork()
      expect(
        messages.find(
          (message) =>
            message.requestId === "icloud-original-stale-session" &&
            message.action === "gptkResult"
        )
      ).toMatchObject({ success: false })
      expect(originalFetchCount()).toBe(0)

      sendCommand(
        "getOriginalContentHash",
        "icloud-original-wrong-scope",
        {
          requestId: "icloud-original-wrong-scope",
          mediaKey: photo.mediaKey,
          userOptIn: true,
          providerSessionId,
          scanScopeFingerprint: "d".repeat(64),
          maxBytes: 1024
        },
        "icloud"
      )
      await flushProviderWork()
      expect(
        messages.find(
          (message) =>
            message.requestId === "icloud-original-wrong-scope" &&
            message.action === "gptkResult"
        )
      ).toMatchObject({ success: false })
      expect(originalFetchCount()).toBe(0)

      sendCommand(
        "getOriginalContentHash",
        "icloud-original-byte-cap",
        {
          requestId: "icloud-original-byte-cap",
          mediaKey: photo.mediaKey,
          userOptIn: true,
          providerSessionId,
          scanScopeFingerprint: scopeFingerprint,
          maxBytes: 1,
          aggregateBudgetBytes: 128
        },
        "icloud"
      )
      await flushProviderWork()
      expect(
        messages.find(
          (message) =>
            message.requestId === "icloud-original-byte-cap" &&
            message.action === "gptkResult"
        )
      ).toMatchObject({ success: false })
      expect(originalFetchCount()).toBe(0)

      sendCommand(
        "getVideoPlaybackUrl",
        "icloud-photo-playback-rejected",
        {
          requestId: "icloud-photo-playback-rejected",
          mediaKey: photo.mediaKey,
          userOptIn: true,
          providerSessionId,
          scanScopeFingerprint: scopeFingerprint
        },
        "icloud"
      )
      await flushProviderWork()
      expect(
        messages.find(
          (message) =>
            message.requestId === "icloud-photo-playback-rejected" &&
            message.action === "gptkResult"
        )
      ).toMatchObject({ success: false })

      sendCommand(
        "getOriginalContentHash",
        "icloud-original-hash",
        {
          requestId: "icloud-original-hash",
          mediaKey: photo.mediaKey,
          userOptIn: true,
          providerSessionId,
          scanScopeFingerprint: scopeFingerprint,
          maxBytes: 1024,
          aggregateBudgetBytes: 128
        },
        "icloud"
      )
      await flushProviderWork()
      expect(
        messages.find(
          (message) =>
            message.requestId === "icloud-original-hash" &&
            message.action === "gptkResult"
        )
      ).toMatchObject({
        success: true,
        data: {
          mediaKey: photo.mediaKey,
          scopeFingerprint,
          byteLength: originalBytes.byteLength,
          mimeType: "image/heic",
          contentHash: {
            value: "da959d93ff7eaed6bd55231035ca0112a96f53412fa2d1302fde6423e898da52",
            algorithm: "sha256",
            provenance: "original-content",
            verificationSource: "local-original-bytes"
          }
        }
      })
      for (const [requestId, aggregateBudgetBytes] of [
        ["icloud-original-cap-lowered", 64],
        ["icloud-original-cap-raised", 256]
      ] as const) {
        sendCommand(
          "getOriginalContentHash",
          requestId,
          {
            requestId,
            mediaKey: photo.mediaKey,
            userOptIn: true,
            providerSessionId,
            scanScopeFingerprint: scopeFingerprint,
            maxBytes: 1024,
            aggregateBudgetBytes
          },
          "icloud"
        )
        await flushProviderWork()
        expect(
          messages.find(
            (message) =>
              message.requestId === requestId &&
              message.action === "gptkResult"
          )
        ).toMatchObject({ success: false })
        expect(originalFetchCount()).toBe(1)
      }

      const incompleteOriginalResponses: Array<[string, Response]> = [
        [
          "icloud-original-partial-206",
          new Response(originalBytes.slice(0, 5), {
            status: 206,
            headers: { "content-range": `bytes 0-4/${originalBytes.byteLength}` }
          })
        ],
        [
          "icloud-original-short-200",
          new Response(originalBytes.slice(0, -1), { status: 200 })
        ]
      ]
      const incompleteOriginalResults = []
      for (const [requestId, response] of incompleteOriginalResponses) {
        queuedOriginalResponse = response
        sendCommand(
          "getOriginalContentHash",
          requestId,
          {
            requestId,
            mediaKey: photo.mediaKey,
            userOptIn: true,
            providerSessionId,
            scanScopeFingerprint: scopeFingerprint,
            maxBytes: 1024,
            aggregateBudgetBytes: 128
          },
          "icloud"
        )
        incompleteOriginalResults.push(
          await waitForProviderResult(messages, requestId)
        )
      }
      expect(incompleteOriginalResults.map((result: any) => result.success)).toEqual([
        false,
        false
      ])
      expect(
        incompleteOriginalResults.every(
          (result: any) => result.data?.contentHash === undefined
        )
      ).toBe(true)
      expect(JSON.stringify(incompleteOriginalResults)).not.toContain(
        "/B/original-photo/"
      )

      sendCommand(
        "getVideoPlaybackUrl",
        "icloud-video-playback",
        {
          requestId: "icloud-video-playback",
          mediaKey: video.mediaKey,
          userOptIn: true,
          providerSessionId,
          scanScopeFingerprint: scopeFingerprint
        },
        "icloud"
      )
      await flushProviderWork()
      expect(
        messages.find(
          (message) =>
            message.requestId === "icloud-video-playback" &&
            message.action === "gptkResult"
        )
      ).toMatchObject({
        success: true,
        data: {
          mediaKey: video.mediaKey,
          scopeFingerprint,
          playbackUrl:
            "https://cvws-h2.icloud-content.com/B/playback-video/fixture-video.mov",
          mimeType: "video/quicktime"
        }
      })

      sendCommand(
        "getVideoPlaybackUrl",
        "icloud-video-playback-repeat",
        {
          requestId: "icloud-video-playback-repeat",
          mediaKey: video.mediaKey,
          userOptIn: true,
          providerSessionId,
          scanScopeFingerprint: scopeFingerprint
        },
        "icloud"
      )
      await flushProviderWork()
      expect(
        messages.find(
          (message) =>
            message.requestId === "icloud-video-playback-repeat" &&
            message.action === "gptkResult"
        )
      ).toMatchObject({
        success: true,
        data: {
          mediaKey: video.mediaKey,
          scopeFingerprint,
          playbackUrl:
            "https://cvws-h2.icloud-content.com/B/playback-video/fixture-video.mov"
        }
      })
      expect(fetchSpy.mock.calls.filter(([input]) =>
        String(input).includes("/B/playback-video/")
      )).toHaveLength(0)

      const cancelledGate = createDeferredOriginalFetch()
      deferredOriginalFetch = cancelledGate
      sendCommand(
        "getOriginalContentHash",
        "icloud-original-inflight-cancelled",
        {
          requestId: "icloud-original-inflight-cancelled",
          mediaKey: photo.mediaKey,
          userOptIn: true,
          providerSessionId,
          scanScopeFingerprint: scopeFingerprint,
          maxBytes: 1024,
          aggregateBudgetBytes: 128
        },
        "icloud"
      )
      await cancelledGate.started
      expect(cancelledGate.signal).toBeInstanceOf(AbortSignal)
      sendCommand(
        "cancelProviderRequest",
        "icloud-original-cancel-command",
        {
          targetRequestId: "icloud-original-inflight-cancelled",
          providerSessionId,
          scanScopeFingerprint: scopeFingerprint
        },
        "icloud"
      )
      await flushProviderWork()
      expect(
        messages.find(
          (message) =>
            message.requestId === "icloud-original-cancel-command" &&
            message.action === "gptkResult"
        )
      ).toMatchObject({ success: true, data: { cancelled: true } })
      await flushProviderWork()
      const cancelledResult = messages.find(
        (message) =>
          message.requestId === "icloud-original-inflight-cancelled" &&
          message.action === "gptkResult"
      )
      expect(cancelledGate.signal?.aborted).toBe(true)
      expect(cancelledResult).toMatchObject({
        success: false,
        error: expect.stringMatching(/cancelled/i)
      })
      expect(JSON.stringify(cancelledResult)).not.toContain(
        "/B/original-photo/"
      )

      const switchedAccountGate = createDeferredOriginalFetch()
      deferredOriginalFetch = switchedAccountGate
      sendCommand(
        "getOriginalContentHash",
        "icloud-original-inflight-account-switch",
        {
          requestId: "icloud-original-inflight-account-switch",
          mediaKey: photo.mediaKey,
          userOptIn: true,
          providerSessionId,
          scanScopeFingerprint: scopeFingerprint,
          maxBytes: 1024,
          aggregateBudgetBytes: 128
        },
        "icloud"
      )
      await switchedAccountGate.started
      setAccountEmail("icloud-fixture-after@example.test")
      sendCommand("healthCheck", "icloud-retrieval-account-switch", {}, "icloud")
      await flushProviderWork()
      const switchedHealth = messages.find(
        (message) =>
          message.requestId === "icloud-retrieval-account-switch" &&
          message.action === "gptkResult"
      )
      expect(switchedHealth).toMatchObject({
        success: true,
        data: { accountEmail: "icloud-fixture-after@example.test" }
      })
      expect(switchedHealth.providerSessionId).not.toBe(providerSessionId)
      await flushProviderWork()
      const switchedResult = messages.find(
        (message) =>
          message.requestId === "icloud-original-inflight-account-switch" &&
          message.action === "gptkResult"
      )
      expect(switchedAccountGate.signal?.aborted).toBe(true)
      expect(switchedResult).toMatchObject({ success: false })
      expect(JSON.stringify(switchedResult)).not.toContain(
        "/B/original-photo/"
      )

      // Account state can also change after the fetch revalidation while
      // WebCrypto is pending. No health command is sent for this switch.
      const digestScope = "icloud-digest-final-session-check"
      sendCommand("getAllMediaItems", "icloud-digest-rescan", {
        limit: 2,
        providerSessionId: switchedHealth.providerSessionId,
        scanScopeFingerprint: digestScope
      }, "icloud")
      expect(await waitForProviderResult(messages, "icloud-digest-rescan"))
        .toMatchObject({ success: true, scanCoverage: { status: "complete" } })
      const nativeDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle)
      let startDigest!: () => void
      let finishDigest!: (digest: ArrayBuffer) => void
      const digestStarted = new Promise<void>((resolve) => { startDigest = resolve })
      const digestResult = new Promise<ArrayBuffer>((resolve) => { finishDigest = resolve })
      const digestSpy = vi.spyOn(globalThis.crypto.subtle, "digest")
        .mockImplementation((algorithm, bytes) => {
          if (new TextDecoder().decode(bytes) === "icloud-original-bytes") {
            startDigest()
            return digestResult
          }
          return nativeDigest(algorithm, bytes)
        })
      try {
        sendCommand("getOriginalContentHash", "icloud-digest-account-switch", {
          requestId: "icloud-digest-account-switch",
          mediaKey: photo.mediaKey,
          userOptIn: true,
          providerSessionId: switchedHealth.providerSessionId,
          scanScopeFingerprint: digestScope,
          maxBytes: 1024,
          aggregateBudgetBytes: 128
        }, "icloud")
        expect(await Promise.race([
          digestStarted.then(() => "digest started"),
          waitForProviderResult(messages, "icloud-digest-account-switch")
        ])).toBe("digest started")
        setAccountEmail("icloud-fixture-during-digest@example.test")
        finishDigest(await nativeDigest("SHA-256", originalBytes))
        const lateDigestResult = await waitForProviderResult(
          messages, "icloud-digest-account-switch"
        )
        expect(lateDigestResult).toMatchObject({ success: false })
        expect(lateDigestResult.data?.contentHash).toBeUndefined()
      } finally {
        digestSpy.mockRestore()
      }
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      ;(window as any).happyDOM.setURL(originalUrl)
      document.body.innerHTML = originalBody
      restore()
    }
  })

  it("enforces streamed and aggregate original-byte budgets across concurrency and LRU eviction", async () => {
    const originalUrl = window.location.href
    const originalBody = document.body.innerHTML
    document.body.innerHTML = ""
    ;(window as any).happyDOM.setURL("https://icloud.com/applications/photos")
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const mib = 1024 * 1024
    const perItemLimit = 25 * mib
    const aggregateLimit = 100 * mib
    let activeRecords: unknown[] = []
    let activeCount = 1
    let oversizedNextOriginal = false
    let deferredOriginalFetch: {
      started: Promise<void>
      signal?: AbortSignal
      response: Promise<Response>
      start: () => void
      resolve: (response: Response) => void
      reject: (error: unknown) => void
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
    const sourceRecords = (count: number): unknown[] => {
      const result: unknown[] = []
      for (let index = 0; index < count; index += 1) {
        const suffix = index === 0 ? "large-original" : `lru-${index}`
        const size = index === 0 ? perItemLimit : 1
        result.push(
          {
            recordName: `master-${suffix}`,
            recordType: "CPLMaster",
            fields: {
              itemType: { value: "public.jpeg" },
              filenameEnc: { value: btoa(`${suffix}.jpg`) },
              resOriginalFileType: { value: "public.jpeg" },
              resOriginalFileSize: { value: size },
              resOriginalRes: {
                value: {
                  size,
                  downloadURL: `https://cvws-h2.icloud-content.com/B/${suffix}/\u0024{f}`
                }
              },
              resJPEGThumbRes: {
                value: {
                  downloadURL: `https://cvws-h2.icloud-content.com/B/thumb-${suffix}/\u0024{f}`
                }
              }
            }
          },
          {
            recordName: `asset-${suffix}`,
            recordType: "CPLAsset",
            fields: {
              masterRef: { value: { recordName: `master-${suffix}` } },
              assetDate: { value: 1000 }
            }
          }
        )
      }
      return result
    }
    const largeRecords = sourceRecords(1)
    activeRecords = largeRecords
    const largeResponse = (
      length = perItemLimit,
      contentLength = length
    ) => {
      let bytesRemaining = length
      const reusableChunk = new Uint8Array(mib)
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (bytesRemaining <= 0) {
            controller.close()
            return
          }
          const nextLength = Math.min(bytesRemaining, reusableChunk.byteLength)
          controller.enqueue(reusableChunk.subarray(0, nextLength))
          bytesRemaining -= nextLength
        }
      })
      return new Response(body, {
        status: 200,
        headers: {
          "content-length": String(contentLength),
          "content-type": "image/jpeg"
        }
      })
    }
    const createPausedOneByteResponse = (signal?: AbortSignal) => {
      let firstPull = true
      let unblockSecondPull!: () => void
      let resolveSecondPull!: () => void
      const secondPullStarted = new Promise<void>((resolve) => {
        resolveSecondPull = resolve
      })
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (firstPull) {
            firstPull = false
            controller.enqueue(new Uint8Array([1]))
            return
          }
          await new Promise<void>((resolve) => {
            unblockSecondPull = resolve
            resolveSecondPull()
          })
          controller.close()
        },
        cancel() {
          unblockSecondPull?.()
        }
      })
      signal?.addEventListener("abort", () => unblockSecondPull?.(), {
        once: true
      })
      return {
        response: new Response(body, {
          status: 200,
          headers: {
            "content-length": String(perItemLimit),
            "content-type": "image/jpeg"
          }
        }),
        secondPullStarted
      }
    }
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input)
        if (url.includes("/internal/records/query/batch?")) {
          return new Response(
            JSON.stringify({
              batch: [
                { records: [{ fields: { itemCount: { value: activeCount } } }] }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        }
        if (url.includes("/records/query?")) {
          return new Response(JSON.stringify({ records: activeRecords }), {
            status: 200,
            headers: { "content-type": "application/json" }
          })
        }
        if (url.includes("/B/large-original/")) {
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
          if (oversizedNextOriginal) {
            oversizedNextOriginal = false
            return largeResponse(perItemLimit + 1, 1)
          }
          return largeResponse()
        }
        return new Response("not found", { status: 404 })
      })

    try {
      sendCommand("healthCheck", "icloud-budget-health", {}, "icloud")
      const health = await waitForProviderResult(messages, "icloud-budget-health")
      expect(health).toMatchObject({ success: true })
      const providerSessionId = health.providerSessionId
      const scopeFingerprint = "b".repeat(64)
      sendCommand(
        "getAllMediaItems",
        "icloud-budget-initial-scan",
        { limit: 1, providerSessionId, scanScopeFingerprint: scopeFingerprint },
        "icloud"
      )
      const scan = await waitForProviderResult(messages, "icloud-budget-initial-scan")
      expect(scan).toMatchObject({
        success: true,
        scanCoverage: { status: "complete" }
      })
      const mediaKey = scan.data[0].mediaKey
      const rawOriginalFetchCount = () =>
        fetchSpy.mock.calls.filter(([input]) =>
          String(input).includes("/B/large-original/")
        ).length
      let originalFetchCountOffset = 0
      const originalFetchCount = () =>
        rawOriginalFetchCount() - originalFetchCountOffset
      const overlapFetchCount = () =>
        fetchSpy.mock.calls.filter(([input]) => {
          const url = String(input)
          return (
            url.includes("/B/large-original/") ||
            url.includes("/B/lru-1/")
          )
        }).length
      const requestHash = async (requestId: string) => {
        sendCommand(
          "getOriginalContentHash",
          requestId,
          {
            requestId,
            mediaKey,
            userOptIn: true,
            providerSessionId,
            scanScopeFingerprint: scopeFingerprint,
            maxBytes: perItemLimit
          },
          "icloud"
        )
        return waitForProviderResult(messages, requestId)
      }

      for (let index = 0; index < 3; index += 1) {
        const result = await requestHash(`icloud-budget-sequential-${index}`)
        expect(result).toMatchObject({
          success: true,
          data: {
            mediaKey,
            scopeFingerprint,
            byteLength: perItemLimit,
            contentHash: {
              algorithm: "sha256",
              verificationSource: "local-original-bytes"
            }
          }
        })
        expect(result.data.contentHash.value).toMatch(/^[a-f0-9]{64}$/)
      }
      expect(perItemLimit * 4).toBe(aggregateLimit)
      expect(originalFetchCount()).toBe(3)

      const overlapScopeFingerprint = "c".repeat(64)
      activeRecords = sourceRecords(2)
      activeCount = 2
      sendCommand(
        "getAllMediaItems",
        "icloud-budget-overlap-scan",
        {
          limit: 2,
          providerSessionId,
          scanScopeFingerprint: overlapScopeFingerprint
        },
        "icloud"
      )
      const overlapScan = await waitForProviderResult(
        messages,
        "icloud-budget-overlap-scan"
      )
      expect(overlapScan).toMatchObject({
        success: true,
        scanCoverage: { status: "complete" }
      })
      const overlapLargeMediaKey = overlapScan.data.find(
        (item: any) => item.mediaKey === "icloud-master-large-original"
      )?.mediaKey
      const overlapSmallMediaKey = overlapScan.data.find(
        (item: any) => item.mediaKey === "icloud-master-lru-1"
      )?.mediaKey
      expect(overlapLargeMediaKey).toBe("icloud-master-large-original")
      expect(overlapSmallMediaKey).toBe("icloud-master-lru-1")
      const requestOverlapHash = (
        requestId: string,
        targetMediaKey: string,
        maxBytes: number
      ) => {
        sendCommand(
          "getOriginalContentHash",
          requestId,
          {
            requestId,
            mediaKey: targetMediaKey,
            userOptIn: true,
            providerSessionId,
            scanScopeFingerprint: overlapScopeFingerprint,
            maxBytes,
            aggregateBudgetBytes: 2 * perItemLimit
          },
          "icloud"
        )
        return waitForProviderResult(messages, requestId)
      }
      const overlapA = createDeferredOriginalFetch()
      deferredOriginalFetch = overlapA
      sendCommand(
        "getOriginalContentHash",
        "icloud-budget-overlap-a",
        {
          requestId: "icloud-budget-overlap-a",
          mediaKey: overlapLargeMediaKey,
          userOptIn: true,
          providerSessionId,
          scanScopeFingerprint: overlapScopeFingerprint,
          maxBytes: perItemLimit,
          aggregateBudgetBytes: 2 * perItemLimit
        },
        "icloud"
      )
      await overlapA.started
      expect(overlapA.signal).toBeInstanceOf(AbortSignal)
      const pausedA = createPausedOneByteResponse(overlapA.signal)
      overlapA.resolve(pausedA.response)
      await pausedA.secondPullStarted

      const overlapB = createDeferredOriginalFetch()
      deferredOriginalFetch = overlapB
      sendCommand(
        "getOriginalContentHash",
        "icloud-budget-overlap-b",
        {
          requestId: "icloud-budget-overlap-b",
          mediaKey: overlapLargeMediaKey,
          userOptIn: true,
          providerSessionId,
          scanScopeFingerprint: overlapScopeFingerprint,
          maxBytes: perItemLimit,
          aggregateBudgetBytes: 2 * perItemLimit
        },
        "icloud"
      )
      await overlapB.started
      const countBeforeCapRejection = overlapFetchCount()
      const overlapCapRejected = await requestOverlapHash(
        "icloud-budget-overlap-c-cap",
        overlapSmallMediaKey,
        1
      )
      expect(overlapCapRejected).toMatchObject({ success: false })
      expect(overlapFetchCount()).toBe(countBeforeCapRejection)

      sendCommand(
        "cancelProviderRequest",
        "icloud-budget-overlap-cancel-a",
        {
          targetRequestId: "icloud-budget-overlap-a",
          providerSessionId,
          scanScopeFingerprint: overlapScopeFingerprint
        },
        "icloud"
      )
      const cancelAResult = await waitForProviderResult(
        messages,
        "icloud-budget-overlap-cancel-a"
      )
      expect(cancelAResult).toMatchObject({
        success: true,
        data: { cancelled: true }
      })
      const overlapAResult = await waitForProviderResult(
        messages,
        "icloud-budget-overlap-a"
      )
      expect(overlapAResult).toMatchObject({ success: false })
      expect(overlapA.signal?.aborted).toBe(true)

      const countBeforeRetainedReservationCheck = overlapFetchCount()
      const overlapRetainedReservationRejected = await requestOverlapHash(
        "icloud-budget-overlap-c-retained-b",
        overlapLargeMediaKey,
        perItemLimit
      )
      expect(overlapRetainedReservationRejected).toMatchObject({
        success: false
      })
      expect(overlapFetchCount()).toBe(countBeforeRetainedReservationCheck)

      sendCommand(
        "cancelProviderRequest",
        "icloud-budget-overlap-cancel-b",
        {
          targetRequestId: "icloud-budget-overlap-b",
          providerSessionId,
          scanScopeFingerprint: overlapScopeFingerprint
        },
        "icloud"
      )
      const cancelBResult = await waitForProviderResult(
        messages,
        "icloud-budget-overlap-cancel-b"
      )
      expect(cancelBResult).toMatchObject({
        success: true,
        data: { cancelled: true }
      })
      const overlapBResult = await waitForProviderResult(
        messages,
        "icloud-budget-overlap-b"
      )
      expect(overlapBResult).toMatchObject({ success: false })
      expect(overlapB.signal?.aborted).toBe(true)

      activeRecords = largeRecords
      activeCount = 1
      sendCommand(
        "getAllMediaItems",
        "icloud-budget-overlap-restore-scan",
        { limit: 1, providerSessionId, scanScopeFingerprint: scopeFingerprint },
        "icloud"
      )
      const overlapRestoredScan = await waitForProviderResult(
        messages,
        "icloud-budget-overlap-restore-scan"
      )
      expect(overlapRestoredScan).toMatchObject({ success: true })
      originalFetchCountOffset = rawOriginalFetchCount() - 3
      expect(originalFetchCount()).toBe(3)

      const fourthFetch = createDeferredOriginalFetch()
      deferredOriginalFetch = fourthFetch
      sendCommand(
        "getOriginalContentHash",
        "icloud-budget-concurrent-reserved",
        {
          requestId: "icloud-budget-concurrent-reserved",
          mediaKey,
          userOptIn: true,
          providerSessionId,
          scanScopeFingerprint: scopeFingerprint,
          maxBytes: perItemLimit
        },
        "icloud"
      )
      await fourthFetch.started
      expect(fourthFetch.signal).toBeInstanceOf(AbortSignal)
      const countBeforeConcurrentRejection = originalFetchCount()
      const concurrentRejected = await requestHash(
        "icloud-budget-concurrent-rejected"
      )
      expect(concurrentRejected).toMatchObject({ success: false })
      expect(originalFetchCount()).toBe(countBeforeConcurrentRejection)
      fourthFetch.resolve(largeResponse())
      const fourthResult = await waitForProviderResult(
        messages,
        "icloud-budget-concurrent-reserved"
      )
      expect(fourthResult).toMatchObject({ success: true })
      expect(originalFetchCount()).toBe(4)

      const exhausted = await requestHash("icloud-budget-exact-exhaustion")
      expect(exhausted).toMatchObject({ success: false })
      expect(originalFetchCount()).toBe(4)
      expect(JSON.stringify(exhausted)).not.toContain(
        "/B/large-original/"
      )

      activeRecords = sourceRecords(10001)
      activeCount = 10001
      sendCommand(
        "getAllMediaItems",
        "icloud-budget-lru-flood",
        {
          limit: 10001,
          providerSessionId,
          scanScopeFingerprint: scopeFingerprint
        },
        "icloud"
      )
      const floodedScan = await waitForProviderResult(
        messages,
        "icloud-budget-lru-flood"
      )
      expect(floodedScan).toMatchObject({
        success: true,
        scanCoverage: { status: "complete", itemsReturned: 10001 }
      })
      activeRecords = largeRecords
      activeCount = 1
      sendCommand(
        "getAllMediaItems",
        "icloud-budget-lru-rescan",
        { limit: 1, providerSessionId, scanScopeFingerprint: scopeFingerprint },
        "icloud"
      )
      const rescanned = await waitForProviderResult(
        messages,
        "icloud-budget-lru-rescan"
      )
      expect(rescanned).toMatchObject({
        success: true,
        scanCoverage: { status: "complete" }
      })
      const stillExhausted = await requestHash("icloud-budget-stays-exhausted")
      expect(stillExhausted).toMatchObject({ success: false })
      expect(originalFetchCount()).toBe(4)

      const oversizeScope = "e".repeat(64)
      oversizedNextOriginal = true
      sendCommand(
        "getAllMediaItems",
        "icloud-budget-oversize-scan",
        {
          limit: 1,
          providerSessionId,
          scanScopeFingerprint: oversizeScope
        },
        "icloud"
      )
      const oversizeScan = await waitForProviderResult(
        messages,
        "icloud-budget-oversize-scan"
      )
      expect(oversizeScan).toMatchObject({ success: true })
      const scopeCountBeforeOversize = originalFetchCount()
      sendCommand(
        "getOriginalContentHash",
        "icloud-stream-lies-about-length",
        {
          requestId: "icloud-stream-lies-about-length",
          mediaKey,
          userOptIn: true,
          providerSessionId,
          scanScopeFingerprint: oversizeScope,
          maxBytes: perItemLimit
        },
        "icloud"
      )
      const oversizedResult = await waitForProviderResult(
        messages,
        "icloud-stream-lies-about-length"
      )
      expect(oversizedResult).toMatchObject({ success: false })
      expect(JSON.stringify(oversizedResult)).not.toContain(
        "/B/large-original/"
      )
      expect(originalFetchCount()).toBe(scopeCountBeforeOversize + 1)
      sendCommand(
        "getOriginalContentHash",
        "icloud-stream-cap-reservation-released",
        {
          requestId: "icloud-stream-cap-reservation-released",
          mediaKey,
          userOptIn: true,
          providerSessionId,
          scanScopeFingerprint: oversizeScope,
          maxBytes: perItemLimit
        },
        "icloud"
      )
      const afterOversize = await waitForProviderResult(
        messages,
        "icloud-stream-cap-reservation-released"
      )
      expect(afterOversize).toMatchObject({ success: true })
      expect(originalFetchCount()).toBe(scopeCountBeforeOversize + 2)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      ;(window as any).happyDOM.setURL(originalUrl)
      document.body.innerHTML = originalBody
      restore()
    }
  })

  it("continues CloudKit pagination until the index count is reached", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const pageRecords = (suffix: string) => [
      {
        recordName: `master-${suffix}`,
        recordType: "CPLMaster",
        fields: {
          itemType: { value: "public.jpeg" },
          filenameEnc: { value: btoa(`IMG_${suffix}.JPG`) },
          resOriginalFingerprint: { value: `fingerprint-${suffix}` },
          resJPEGThumbRes: {
            value: {
              downloadURL: `https://cvws-h2.icloud-content.com/B/thumb-${suffix}/\${f}`
            }
          }
        },
        created: { timestamp: 2000 }
      },
      {
        recordName: `asset-${suffix}`,
        recordType: "CPLAsset",
        fields: {
          masterRef: { value: { recordName: `master-${suffix}` } },
          assetDate: { value: 1000 },
          addedDate: { value: 2000 }
        },
        created: { timestamp: 2000 }
      }
    ]
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body || "{}"))
        if (body.batch) {
          return {
            ok: true,
            json: async () => ({
              batch: [
                {
                  records: [
                    {
                      fields: { itemCount: { value: 101 } }
                    }
                  ]
                }
              ]
            })
          } as Response
        }
        const offset =
          body.query.filterBy.find(
            (filter: { fieldName: string }) => filter.fieldName === "startRank"
          )?.fieldValue?.value ?? 0
        return {
          ok: true,
          json: async () => ({
            records: offset === 0 ? pageRecords("A") : pageRecords("B")
          })
        } as Response
      })

    sendCommand("getAllMediaItems", "icloud-cloudkit-pagination", {})
    await new Promise((resolve) => setTimeout(resolve, 900))

    const result = messages.find(
      (msg) => msg.action === "gptkResult" && msg.command === "getAllMediaItems"
    )
    expect(result.success).toBe(true)
    expect(
      result.data.map((item: { dedupKey: string }) => item.dedupKey)
    ).toEqual(["master-A", "master-B"])
    expect(fetchSpy.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    )
    expect(
      fetchSpy.mock.calls.some(([, init]) =>
        String(init?.body).includes('"value":100')
      )
    ).toBe(true)

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it("scans the full library instead of using a capture-date watermark", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const mediaRecords = (suffix: string, assetDate: number): unknown[] => [
      {
        recordName: `master-${suffix}`,
        recordType: "CPLMaster",
        fields: {
          itemType: { value: "public.jpeg" },
          filenameEnc: { value: btoa(`${suffix}.jpg`) },
          resJPEGThumbRes: {
            value: { downloadURL: `https://thumb/${suffix}/\${f}` }
          }
        }
      },
      {
        recordName: `asset-${suffix}`,
        recordType: "CPLAsset",
        fields: {
          masterRef: { value: { recordName: `master-${suffix}` } },
          assetDate: { value: assetDate },
          addedDate: { value: assetDate }
        }
      }
    ]
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url, init) => {
        if (String(url).includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [
                {
                  records: [{ fields: { itemCount: { value: 3 } } }]
                }
              ]
            })
          } as Response
        }
        const body = JSON.parse(String(init?.body || "{}"))
        expect(
          body.query.filterBy.find(
            (filter: { fieldName: string }) => filter.fieldName === "direction"
          )?.fieldValue?.value
        ).toBe("ASCENDING")
        return {
          ok: true,
          json: async () => ({
            records: [
              ...mediaRecords("new", 3000),
              ...mediaRecords("boundary", 2000),
              ...mediaRecords("old", 1000)
            ]
          })
        } as Response
      })

    try {
      sendCommand("getAllMediaItems", "icloud-incremental", {
        sinceTimestamp: 2000
      })
      await new Promise((resolve) => setTimeout(resolve, 250))

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "icloud-incremental"
      )
      expect(result).toMatchObject({
        success: true,
        data: [
          expect.objectContaining({ dedupKey: "master-new" }),
          expect.objectContaining({ dedupKey: "master-boundary" }),
          expect.objectContaining({ dedupKey: "master-old" })
        ],
        scanCoverage: {
          status: "complete",
          stopReason: "exhausted",
          itemsVisited: 3,
          itemsReturned: 3,
          itemsSkipped: 0
        }
      })
      expect(result.providerSyncToken).toBeUndefined()
      expect(
        fetchSpy.mock.calls.filter(([url]) =>
          String(url).includes("/records/query?")
        )
      ).toHaveLength(1)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-07] reuses a complete iCloud snapshot only when the zone reports no changes", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true&getCurrentSyncToken=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        zones: [
          {
            zoneID: { zoneName: "PrimarySync" },
            syncToken: "next-zone-token",
            moreComing: false,
            records: []
          }
        ]
      })
    } as Response)

    try {
      sendCommand("getAllMediaItems", "icloud-zone-unchanged", {
        providerSyncToken: "stored-zone-token",
        cachedTotalItems: 42
      })
      await new Promise((resolve) => setTimeout(resolve, 250))

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "icloud-zone-unchanged"
      )
      expect(result).toMatchObject({
        success: true,
        data: [],
        providerSyncToken: "next-zone-token",
        scanCoverage: {
          status: "complete",
          stopReason: "watermark_reached",
          totalItems: 42,
          itemsVisited: 0,
          itemsReturned: 0,
          itemsSkipped: 0,
          mediaTypesCovered: { photos: true, videos: true }
        }
      })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(String(fetchSpy.mock.calls[0][0])).toContain("/changes/zone?")
      expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toMatchObject({
        zones: [
          {
            zoneID: { zoneName: "PrimarySync" },
            syncToken: "stored-zone-token",
            resultsLimit: 200
          }
        ]
      })
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-07] applies fully paginated paired photo changes before advancing the token", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true&getCurrentSyncToken=true"
        } as PerformanceEntry
      ])
    const mediaChangeRecords = (suffix: string): unknown[] => [
      {
        recordName: `master-${suffix}`,
        recordType: "CPLMaster",
        fields: {
          itemType: { value: "public.jpeg" },
          filenameEnc: { value: btoa(`${suffix}.jpg`) },
          resJPEGThumbRes: {
            value: { downloadURL: `https://thumb/${suffix}/\${f}` }
          }
        }
      },
      {
        recordName: `asset-${suffix}`,
        recordType: "CPLAsset",
        recordChangeTag: `tag-${suffix}`,
        zoneID: { zoneName: "PrimarySync" },
        fields: {
          masterRef: { value: { recordName: `master-${suffix}` } },
          assetDate: { value: 3000 },
          addedDate: { value: 3000 }
        }
      }
    ]
    let zoneChangeCall = 0
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url, init) => {
        if (String(url).includes("/changes/zone?")) {
          const request = JSON.parse(String(init?.body || "{}"))
          zoneChangeCall += 1
          if (zoneChangeCall === 1) {
            expect(request.zones[0]).toMatchObject({
              syncToken: "stored-zone-token",
              resultsLimit: 200
            })
            return {
              ok: true,
              json: async () => ({
                zones: [
                  {
                    zoneID: { zoneName: "PrimarySync" },
                    syncToken: "delta-page-one",
                    moreComing: true,
                    records: mediaChangeRecords("one")
                  }
                ]
              })
            } as Response
          }
          if (zoneChangeCall === 2) {
            expect(request.zones[0].syncToken).toBe("delta-page-one")
            return {
              ok: true,
              json: async () => ({
                zones: [
                  {
                    zoneID: { zoneName: "PrimarySync" },
                    syncToken: "delta-page-two",
                    moreComing: false,
                    records: mediaChangeRecords("two")
                  }
                ]
              })
            } as Response
          }
          expect(request.zones[0].syncToken).toBe("delta-page-two")
          return {
            ok: true,
            json: async () => ({
              zones: [
                {
                  zoneID: { zoneName: "PrimarySync" },
                  syncToken: "delta-caught-up",
                  moreComing: false,
                  records: []
                }
              ]
            })
          } as Response
        }
        if (String(url).includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [{ records: [{ fields: { itemCount: { value: 42 } } }] }]
            })
          } as Response
        }
        throw new Error(`Unexpected iCloud request: ${String(url)}`)
      })

    try {
      sendCommand("getAllMediaItems", "icloud-zone-delta", {
        providerSyncToken: "stored-zone-token",
        cachedTotalItems: 40
      })
      await new Promise((resolve) => setTimeout(resolve, 600))

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "icloud-zone-delta"
      )
      expect(result).toMatchObject({
        success: true,
        data: [
          expect.objectContaining({ mediaKey: "icloud-master-one" }),
          expect.objectContaining({ mediaKey: "icloud-master-two" })
        ],
        providerSyncToken: "delta-caught-up",
        scanCoverage: {
          status: "complete",
          stopReason: "changes_caught_up",
          itemsVisited: 2,
          itemsReturned: 2,
          itemsSkipped: 0,
          totalItems: 42,
          pagesRead: 3,
          mediaTypesCovered: { photos: true, videos: true }
        }
      })
      expect(zoneChangeCall).toBe(3)
      expect(
        fetchSpy.mock.calls.some(([url]) =>
          String(url).includes("/records/query?")
        )
      ).toBe(false)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-07] falls back to a full scan when changes arrive during delta reconciliation", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const mediaRecords = (suffix: string): unknown[] => [
      {
        recordName: `master-${suffix}`,
        recordType: "CPLMaster",
        fields: {
          itemType: { value: "public.jpeg" },
          filenameEnc: { value: btoa(`${suffix}.jpg`) },
          resJPEGThumbRes: {
            value: { downloadURL: `https://thumb/${suffix}/\${f}` }
          }
        }
      },
      {
        recordName: `asset-${suffix}`,
        recordType: "CPLAsset",
        fields: {
          masterRef: { value: { recordName: `master-${suffix}` } },
          assetDate: { value: 3000 },
          addedDate: { value: 3000 }
        }
      }
    ]
    let zoneChangeCall = 0
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url, init) => {
        const urlText = String(url)
        if (urlText.includes("/changes/zone?")) {
          zoneChangeCall += 1
          return {
            ok: true,
            json: async () => ({
              zones: [
                {
                  zoneID: { zoneName: "PrimarySync" },
                  syncToken:
                    zoneChangeCall === 1 ? "delta-first" : "delta-raced",
                  moreComing: false,
                  records: mediaRecords(
                    zoneChangeCall === 1 ? "first-change" : "raced-change"
                  )
                }
              ]
            })
          } as Response
        }
        if (urlText.includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [{ records: [{ fields: { itemCount: { value: 1 } } }] }]
            })
          } as Response
        }
        const body = JSON.parse(String(init?.body || "{}"))
        expect(
          body.query.filterBy.find(
            (filter: { fieldName: string }) => filter.fieldName === "direction"
          )?.fieldValue?.value
        ).toBe("ASCENDING")
        return {
          ok: true,
          json: async () => ({
            syncToken: "full-scan-token",
            records: mediaRecords("full-current")
          })
        } as Response
      })

    try {
      sendCommand("getAllMediaItems", "icloud-delta-race", {
        providerSyncToken: "stored-zone-token"
      })
      await new Promise((resolve) => setTimeout(resolve, 600))

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "icloud-delta-race"
      )
      expect(result).toMatchObject({
        success: true,
        data: [expect.objectContaining({ mediaKey: "icloud-master-full-current" })],
        providerSyncToken: "full-scan-token",
        scanCoverage: { status: "complete", stopReason: "exhausted" }
      })
      expect(zoneChangeCall).toBe(2)
      expect(
        fetchSpy.mock.calls.some(([url]) =>
          String(url).includes("/records/query?")
        )
      ).toBe(true)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  const changedPhotoPairWithFlag = (
    suffix: string,
    flag: "isHidden" | "isExpunged"
  ) => [
    {
      recordName: `master-${suffix}`,
      recordType: "CPLMaster",
      fields: {
        itemType: { value: "public.jpeg" },
        filenameEnc: { value: btoa(`${suffix}.jpg`) },
        resJPEGThumbRes: {
          value: { downloadURL: `https://thumb/${suffix}` }
        }
      }
    },
    {
      recordName: `asset-${suffix}`,
      recordType: "CPLAsset",
      recordChangeTag: `tag-${suffix}`,
      zoneID: { zoneName: "PrimarySync" },
      fields: {
        masterRef: { value: { recordName: `master-${suffix}` } },
        assetDate: { value: 3000 },
        addedDate: { value: 3000 },
        [flag]: { value: 1 }
      }
    }
  ]

  const foreignZoneChangePair: any[] = changedPhotoPairWithFlag(
    "foreign-zone-change",
    "isHidden"
  )
  foreignZoneChangePair[1].fields.isHidden = { value: 0 }
  foreignZoneChangePair[1].zoneID = { zoneName: "SharedSync" }

  const erroredChangePair: any[] = changedPhotoPairWithFlag(
    "errored-change",
    "isHidden"
  )
  erroredChangePair[1].fields.isHidden = { value: 0 }
  erroredChangePair[1].serverErrorCode = "UNKNOWN_ITEM"

  it.each([
    ["contains records", { moreComing: false, records: [{ recordName: "changed-record" }] }],
    ["contains a foreign-zone changed pair", { moreComing: false, records: foreignZoneChangePair }],
    ["contains a row-level error", { moreComing: false, records: erroredChangePair }],
    ["contains a hard deletion", { moreComing: false, records: [{ recordName: "deleted-record", recordType: null, deleted: true }] }],
    [
      "contains a soft-deleted photo",
      {
        moreComing: false,
        records: [
          { recordName: "master-deleted", recordType: "CPLMaster", fields: {} },
          {
            recordName: "asset-deleted",
            recordType: "CPLAsset",
            fields: {
              masterRef: { value: { recordName: "master-deleted" } },
              isDeleted: { value: 1 }
            }
          }
        ]
      }
    ],
    [
      "contains a nonempty deletes list",
      { moreComing: false, records: [], deletes: ["deleted-record"] }
    ],
    [
      "contains a nonempty deletedRecords list",
      {
        moreComing: false,
        records: [],
        deletedRecords: [{ recordName: "deleted-record" }]
      }
    ],
    [
      "contains a nonempty deletedRecordIDs list",
      {
        moreComing: false,
        records: [],
        deletedRecordIDs: ["deleted-record"]
      }
    ],
    [
      "contains a hidden photo pair",
      {
        moreComing: false,
        records: changedPhotoPairWithFlag("hidden", "isHidden")
      }
    ],
    [
      "contains an expunged photo pair",
      {
        moreComing: false,
        records: changedPhotoPairWithFlag("expunged", "isExpunged")
      }
    ],
    [
      "contains an incomplete photo pair",
      {
        moreComing: false,
        records: [{ recordName: "master-incomplete", recordType: "CPLMaster", fields: {} }]
      }
    ],
    ["is incomplete", { moreComing: true, records: [] }],
    ["contains a provider error", { serverErrorCode: "BAD_REQUEST" }],
    ["[ICLOUD-INCREMENTAL-ENVELOPE] has a partial zone", { moreComing: false, records: [], partial: true }],
    ["[ICLOUD-INCREMENTAL-ENVELOPE] has a failed zone", { moreComing: false, records: [], success: false }],
    ["[ICLOUD-INCREMENTAL-ENVELOPE] has a root error", { moreComing: false, records: [] }, { serverErrorCode: "ZONE_NOT_FOUND" }],
    ["[ICLOUD-INCREMENTAL-ENVELOPE] has a partial root", { moreComing: false, records: [] }, { partial: true }]
  ])("[PARITY-07] falls back to a full scan when the change response %s", async (_scenario, changeResponse, rootEnvelope?: Record<string, unknown>) => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    let zoneChangeCall = 0
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url, init) => {
        if (String(url).includes("/changes/zone?")) {
          const isConfirmation = zoneChangeCall > 0
          zoneChangeCall += 1
          return {
            ok: true,
            json: async () => ({
              ...rootEnvelope,
              zones: [
                {
                  zoneID: { zoneName: "PrimarySync" },
                  ...(isConfirmation
                    ? {
                        syncToken: "delta-caught-up",
                        moreComing: false,
                        records: []
                      }
                    : {
                        syncToken: "delta-token",
                        ...changeResponse
                      })
                }
              ]
            })
          } as Response
        }
        if (String(url).includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [
                { records: [{ fields: { itemCount: { value: 1 } } }] }
              ]
            })
          } as Response
        }
        const body = JSON.parse(String(init?.body || "{}"))
        expect(
          body.query.filterBy.find(
            (filter: { fieldName: string }) => filter.fieldName === "direction"
          )?.fieldValue?.value
        ).toBe("ASCENDING")
        return {
          ok: true,
          json: async () => ({
            syncToken: "full-scan-token",
            records: [
              {
                recordName: "master-current",
                recordType: "CPLMaster",
                fields: {
                  itemType: { value: "public.jpeg" },
                  filenameEnc: { value: btoa("current.jpg") },
                  resJPEGThumbRes: {
                    value: { downloadURL: "https://thumb/current/\${f}" }
                  }
                }
              },
              {
                recordName: "asset-current",
                recordType: "CPLAsset",
                fields: {
                  masterRef: { value: { recordName: "master-current" } },
                  assetDate: { value: 3000 },
                  addedDate: { value: 3000 }
                }
              }
            ]
          })
        } as Response
      })

    try {
      sendCommand("getAllMediaItems", "icloud-zone-changed", {
        providerSyncToken: "stored-zone-token"
      })
      await new Promise((resolve) => setTimeout(resolve, 250))

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "icloud-zone-changed"
      )
      expect(result).toMatchObject({
        success: true,
        data: [expect.objectContaining({ dedupKey: "master-current" })],
        providerSyncToken: "full-scan-token",
        scanCoverage: { status: "complete", stopReason: "exhausted" }
      })
      expect(result.providerSyncToken).not.toBe("stored-zone-token")
      expect(
        fetchSpy.mock.calls.map(([url]) => String(url))
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining("/changes/zone?"),
          expect.stringContaining("/internal/records/query/batch?"),
          expect.stringContaining("/records/query?")
        ])
      )
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-07] does not reuse or emit a library token for a date-scoped scan", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url) => {
        if (String(url).includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [
                { records: [{ fields: { itemCount: { value: 1 } } }] }
              ]
            })
          } as Response
        }
        return {
          ok: true,
          json: async () => ({
            syncToken: "scoped-token-must-not-escape",
            records: []
          })
        } as Response
      })

    try {
      sendCommand("getAllMediaItems", "icloud-date-scoped-token", {
        providerSyncToken: "stored-zone-token",
        dateRange: { from: "2024-06-15", to: "2024-06-15" }
      })
      await new Promise((resolve) => setTimeout(resolve, 250))

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "icloud-date-scoped-token"
      )
      expect(result?.success).toBe(true)
      expect(result?.providerSyncToken).toBeUndefined()
      expect(
        fetchSpy.mock.calls.some(([url]) =>
          String(url).includes("/changes/zone?")
        )
      ).toBe(false)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-07] does not reuse or emit a library token for an album-scoped scan", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const requestBodies: Array<{ url: string; body: any }> = []
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url, init) => {
        const urlText = String(url)
        const body = JSON.parse(String(init?.body || "{}"))
        requestBodies.push({ url: urlText, body })
        if (urlText.includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [{ records: [{ fields: { itemCount: { value: 0 } } }] }]
            })
          } as Response
        }
        if (body.query?.recordType === "CPLAlbumByPositionLive") {
          return {
            ok: true,
            json: async () => ({
              records: [
                {
                  recordName: "album-1",
                  recordType: "CPLAlbum",
                  fields: {
                    albumNameEnc: { value: btoa("Personal album") },
                    albumType: { value: 0 }
                  }
                }
              ]
            })
          } as Response
        }
        if (
          body.query?.recordType === "CPLContainerRelationLiveByAssetDate"
        ) {
          return {
            ok: true,
            json: async () => ({
              syncToken: "album-scope-token-must-not-escape",
              moreComing: false,
              records: []
            })
          } as Response
        }
        throw new Error(`Unexpected iCloud request: ${urlText}`)
      })

    try {
      sendCommand("getAllMediaItems", "icloud-album-scoped-token", {
        providerSyncToken: "stored-zone-token",
        albumScope: {
          mediaKey: "icloud-album-album-1",
          title: "Personal album"
        }
      })
      await new Promise((resolve) => setTimeout(resolve, 250))

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "icloud-album-scoped-token"
      )
      expect(result).toMatchObject({
        success: true,
        data: [],
        scanCoverage: { status: "complete", totalItems: 0 }
      })
      expect(result.providerSyncToken).toBeUndefined()
      expect(JSON.stringify(requestBodies)).not.toContain("stored-zone-token")
      expect(
        requestBodies.some(({ url }) => url.includes("/changes/zone?"))
      ).toBe(false)
      expect(
        requestBodies.some(({ body }) =>
          body.query?.recordType === "CPLContainerRelationLiveByAssetDate"
        )
      ).toBe(true)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-07] does not reuse or emit a library token for a limited scan", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const requestBodies: Array<{ url: string; body: any }> = []
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url, init) => {
        const urlText = String(url)
        const body = JSON.parse(String(init?.body || "{}"))
        requestBodies.push({ url: urlText, body })
        if (urlText.includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [{ records: [{ fields: { itemCount: { value: 2 } } }] }]
            })
          } as Response
        }
        if (urlText.includes("/records/query?")) {
          return {
            ok: true,
            json: async () => ({
              syncToken: "limited-scan-token-must-not-escape",
              records: [
                {
                  recordName: "master-limited",
                  recordType: "CPLMaster",
                  fields: {
                    itemType: { value: "public.jpeg" },
                    filenameEnc: { value: btoa("limited.jpg") },
                    resJPEGThumbRes: {
                      value: {
                        downloadURL: "https://thumb/limited"
                      }
                    }
                  }
                },
                {
                  recordName: "asset-limited",
                  recordType: "CPLAsset",
                  recordChangeTag: "limited-change-tag",
                  zoneID: { zoneName: "PrimarySync" },
                  fields: {
                    masterRef: { value: { recordName: "master-limited" } },
                    assetDate: { value: 3000 },
                    addedDate: { value: 3000 }
                  }
                }
              ]
            })
          } as Response
        }
        throw new Error(`Unexpected iCloud request: ${urlText}`)
      })

    try {
      sendCommand("getAllMediaItems", "icloud-limited-scan-token", {
        providerSyncToken: "stored-zone-token",
        limit: 1
      })
      await new Promise((resolve) => setTimeout(resolve, 250))

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "icloud-limited-scan-token"
      )
      expect(result).toMatchObject({
        success: true,
        data: [expect.objectContaining({ dedupKey: "master-limited" })],
        scanCoverage: {
          status: "partial",
          stopReason: "user_limit",
          itemsVisited: 1
        }
      })
      expect(result.providerSyncToken).toBeUndefined()
      expect(JSON.stringify(requestBodies)).not.toContain("stored-zone-token")
      expect(
        requestBodies.some(({ url }) => url.includes("/changes/zone?"))
      ).toBe(false)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-07] withholds a token when a full scan spans more than one zone version", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const mediaRecords = (suffix: string): unknown[] => [
      {
        recordName: `master-${suffix}`,
        recordType: "CPLMaster",
        fields: {
          itemType: { value: "public.jpeg" },
          filenameEnc: { value: btoa(`${suffix}.jpg`) },
          resJPEGThumbRes: {
            value: { downloadURL: `https://thumb/${suffix}/\${f}` }
          }
        }
      },
      {
        recordName: `asset-${suffix}`,
        recordType: "CPLAsset",
        fields: {
          masterRef: { value: { recordName: `master-${suffix}` } },
          assetDate: { value: 3000 },
          addedDate: { value: 3000 }
        }
      }
    ]
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url, init) => {
        if (String(url).includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [
                { records: [{ fields: { itemCount: { value: 201 } } }] }
              ]
            })
          } as Response
        }
        const body = JSON.parse(String(init?.body || "{}"))
        const offset = body.query.filterBy.find(
          (filter: { fieldName: string }) => filter.fieldName === "startRank"
        )?.fieldValue?.value
        const pageItems =
          offset === 0
            ? Array.from({ length: 200 }, (_, index) =>
                mediaRecords(`page-one-${index}`)
              ).flat()
            : mediaRecords("page-two")
        return {
          ok: true,
          json: async () => ({
            syncToken: offset === 0 ? "first-zone-version" : "second-zone-version",
            records: pageItems
          })
        } as Response
      })

    try {
      sendCommand("getAllMediaItems", "icloud-token-page-drift", {})
      await new Promise((resolve) => setTimeout(resolve, 600))

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "icloud-token-page-drift"
      )
      expect(result).toMatchObject({
        success: true,
        scanCoverage: {
          status: "complete",
          stopReason: "exhausted",
          itemsVisited: 201,
          itemsReturned: 201
        }
      })
      expect(result.providerSyncToken).toBeUndefined()
      expect(
        fetchSpy.mock.calls.filter(([url]) =>
          String(url).includes("/records/query?")
        )
      ).toHaveLength(2)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("does not claim an exhausted scan when CloudKit omits indexed records", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url) => {
        if (String(url).includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [{ records: [{ fields: { itemCount: { value: 1 } } }] }]
            })
          } as Response
        }
        return { ok: true, json: async () => ({ records: [] }) } as Response
      })

    sendCommand("getAllMediaItems", "icloud-missing-indexed-record", {})
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "icloud-missing-indexed-record"
    )
    expect(result).toMatchObject({
      success: true,
      data: [],
      scanCoverage: {
        status: "partial",
        stopReason: "coverage_unknown",
        itemsVisited: 0,
        itemsReturned: 0,
        itemsSkipped: 0,
        totalItems: 1
      }
    })

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it("[PARITY-06] marks repeated CloudKit pages incomplete", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const records = [
      {
        recordName: "master-repeated",
        recordType: "CPLMaster",
        fields: {
          itemType: { value: "public.jpeg" },
          filenameEnc: { value: btoa("repeated.jpg") },
          resJPEGThumbRes: {
            value: { downloadURL: "https://thumb/repeated" }
          }
        }
      },
      {
        recordName: "asset-repeated",
        recordType: "CPLAsset",
        fields: { masterRef: { value: { recordName: "master-repeated" } } }
      }
    ]
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url) => {
        if (String(url).includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [{ records: [{ fields: { itemCount: { value: 200 } } }] }]
            })
          } as Response
        }
        return { ok: true, json: async () => ({ records }) } as Response
      })

    try {
      sendCommand("getAllMediaItems", "icloud-repeated-page", {})
      await new Promise((resolve) => setTimeout(resolve, 300))

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "icloud-repeated-page"
      )
      expect(
        fetchSpy.mock.calls.filter(
          ([url]) => !String(url).includes("/internal/records/query/batch?")
        )
      ).toHaveLength(2)
      expect(result).toMatchObject({
        success: true,
        scanCoverage: {
          status: "partial",
          stopReason: "pagination_error",
          itemsVisited: 1,
          itemsReturned: 1,
          itemsSkipped: 0
        }
      })
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("[PARITY-06] stops after repeated empty CloudKit pages without claiming completion", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url) => {
        if (String(url).includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [{ records: [{ fields: { itemCount: { value: 300 } } }] }]
            })
          } as Response
        }
        return { ok: true, json: async () => ({ records: [] }) } as Response
      })

    try {
      sendCommand("getAllMediaItems", "icloud-empty-pages", {})
      await new Promise((resolve) => setTimeout(resolve, 600))

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "icloud-empty-pages"
      )
      expect(
        fetchSpy.mock.calls.filter(
          ([url]) => !String(url).includes("/internal/records/query/batch?")
        )
      ).toHaveLength(3)
      expect(result).toMatchObject({
        success: true,
        data: [],
        scanCoverage: {
          status: "partial",
          stopReason: "pagination_error",
          itemsVisited: 0,
          itemsReturned: 0,
          itemsSkipped: 0
        }
      })
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
    }
  })

  it("aborts an in-flight CloudKit page and reports cancelled coverage", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url, init) => {
        if (String(url).includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [{ records: [{ fields: { itemCount: { value: 1 } } }] }]
            })
          } as Response
        }
        return await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          )
        })
      })

    sendCommand("getAllMediaItems", "icloud-cancel", {})
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
    sendCommand("cancelScan", "icloud-cancel-command", {
      targetRequestId: "icloud-cancel"
    })
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "icloud-cancel"
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

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it("uses local inclusive dates and reports CloudKit coverage", async () => {
    const originalTimeZone = process.env.TZ
    process.env.TZ = "America/Los_Angeles"
    try {
      const { messages, restore } = collectMessages()
      const performanceSpy = vi
        .spyOn(window.performance, "getEntriesByType")
        .mockReturnValue([
          {
            name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
          } as PerformanceEntry
        ])
      const mediaRecords = (suffix: string, assetDate?: number): unknown[] => [
        {
          recordName: `master-${suffix}`,
          recordType: "CPLMaster",
          fields: {
            itemType: { value: "public.jpeg" },
            filenameEnc: { value: btoa(`IMG_${suffix}.JPG`) },
            resOriginalFingerprint: { value: `fingerprint-${suffix}` },
            resJPEGThumbRes: {
              value: {
                downloadURL: `https://cvws-h2.icloud-content.com/B/thumb-${suffix}/\${f}`
              }
            }
          }
        },
        {
          recordName: `asset-${suffix}`,
          recordType: "CPLAsset",
          fields: {
            masterRef: { value: { recordName: `master-${suffix}` } },
            ...(assetDate !== undefined
              ? { assetDate: { value: assetDate } }
              : {})
          }
        }
      ]
      const fetchSpy = vi
        .spyOn(window, "fetch")
        .mockImplementation(async (url) => {
          if (String(url).includes("/internal/records/query/batch?")) {
            return {
              ok: true,
              json: async () => ({
                batch: [
                  {
                    records: [{ fields: { itemCount: { value: 3 } } }]
                  }
                ]
              })
            } as Response
          }
          return {
            ok: true,
            json: async () => ({
              records: [
                ...mediaRecords(
                  "local-end-of-day",
                  new Date(2024, 5, 15, 23, 59).getTime()
                ),
                ...mediaRecords("unknown-date"),
                ...mediaRecords(
                  "next-day",
                  new Date(2024, 5, 16, 0, 0).getTime()
                )
              ]
            })
          } as Response
        })

      sendCommand("getAllMediaItems", "icloud-local-date-coverage", {
        dateRange: { from: "2024-06-15", to: "2024-06-15" }
      })
      await new Promise((resolve) => setTimeout(resolve, 300))

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems"
      )
      expect(result).toMatchObject({ success: true })
      expect(
        result?.data.map((item: { dedupKey: string }) => item.dedupKey)
      ).toEqual(["master-local-end-of-day"])
      expect(result?.scanCoverage).toEqual({
        status: "complete",
        stopReason: "exhausted",
        itemsVisited: 3,
        itemsReturned: 1,
        itemsSkipped: 2,
        unknownDateItemsSkipped: 1,
        pagesRead: 1,
        pageSizes: [3],
        totalItems: undefined,
        mediaTypesCovered: { photos: true, videos: true },
        canResume: false
      })

      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
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
    const records = fixture.items.flatMap((item, index) => {
      const suffix = String(index).padStart(2, "0")
      const masterName = `icloud-v3-master-${suffix}`
      const timestamp = providerParityFixtureTimestamp(item.captureTimeLocal)
      return [
        {
          recordName: masterName,
          recordType: "CPLMaster",
          fields: {
            itemType: {
              value: item.mediaType === "video" ? "public.movie" : "public.jpeg"
            },
            filenameEnc: { value: btoa(item.name) },
            resOriginalFingerprint: { value: `icloud-v3-fingerprint-${suffix}` },
            resJPEGThumbRes: {
              value: {
                downloadURL: "https://cvws-h2.icloud-content.com/B/thumb-${f}"
              }
            }
          }
        },
        {
          recordName: `icloud-v3-asset-${suffix}`,
          recordType: "CPLAsset",
          recordChangeTag: `icloud-v3-tag-${suffix}`,
          zoneID: { zoneName: "PrimarySync" },
          fields: {
            masterRef: { value: { recordName: masterName } },
            ...(Number.isFinite(timestamp)
              ? { assetDate: { value: timestamp } }
              : {}),
            ...(item.mediaType === "video" ? { duration: { value: 12.345 } } : {})
          }
        }
      ]
    })
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url) => {
        if (String(url).includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [
                {
                  records: [
                    { fields: { itemCount: { value: fixture.expected.itemCount } } }
                  ]
                }
              ]
            })
          } as Response
        }
        return {
          ok: true,
          json: async () => ({ records, syncToken: "mixed-media-date-v3" })
        } as Response
      })

    try {
      sendCommand("getAllMediaItems", "icloud-v3-mixed-date", {
        dateRange: fixture.dateRange
      })
      await new Promise((resolve) => setTimeout(resolve, 300))

      const result = messages.find(
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getAllMediaItems" &&
          message.requestId === "icloud-v3-mixed-date"
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
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      restore()
      if (originalTimeZone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimeZone
    }
  })

  it("fails closed when a complete CloudKit session is unavailable", async () => {
    const originalBody = document.body.innerHTML
    const image = document.createElement("img")
    image.src = "https://icloud-content.test/loaded-photo.jpg"
    image.alt = "Loaded iCloud photo"
    image.width = 120
    image.height = 80
    document.body.append(image)
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([])

    sendCommand("getAllMediaItems", "icloud-loaded-fallback", {})
    await vi.waitFor(
      () =>
        expect(
          messages.some(
            (message) =>
              message.action === "gptkResult" &&
              message.command === "getAllMediaItems" &&
              message.requestId === "icloud-loaded-fallback"
          )
        ).toBe(true),
      { timeout: 4000 }
    )

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "icloud-loaded-fallback"
    )
    expect(result).toMatchObject({
      success: false,
      scanCoverage: {
        status: "failed",
        stopReason: "auth_expired",
        itemsVisited: 0,
        itemsReturned: 0,
        itemsSkipped: 0,
        unknownDateItemsSkipped: 0,
        mediaTypesCovered: { photos: false, videos: false },
        canResume: false
      }
    })
    expect(result.error).toMatch(/complete CloudKit library session/i)

    document.body.innerHTML = originalBody
    performanceSpy.mockRestore()
    restore()
  })

  it("counts out-of-date CloudKit records toward the visit limit", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (url) => {
        if (String(url).includes("/internal/records/query/batch?")) {
          return {
            ok: true,
            json: async () => ({
              batch: [{ records: [{ fields: { itemCount: { value: 3 } } }] }]
            })
          } as Response
        }
        return {
          ok: true,
          json: async () => ({
            records: [
              {
                recordName: "master-outside-date",
                recordType: "CPLMaster",
                fields: {
                  itemType: { value: "public.jpeg" },
                  resJPEGThumbRes: {
                    value: {
                      downloadURL:
                        "https://cvws-h2.icloud-content.com/B/thumb/\\${f}"
                    }
                  }
                }
              },
              {
                recordName: "asset-outside-date",
                recordType: "CPLAsset",
                fields: {
                  masterRef: { value: { recordName: "master-outside-date" } },
                  assetDate: { value: new Date(2024, 5, 14, 12).getTime() }
                }
              }
            ]
          })
        } as Response
      })

    sendCommand("getAllMediaItems", "icloud-visit-limit", {
      dateRange: { from: "2024-06-15", to: "2024-06-15" },
      limit: 1
    })
    await flush()

    const result = messages.find(
      (message) =>
        message.action === "gptkResult" &&
        message.command === "getAllMediaItems" &&
        message.requestId === "icloud-visit-limit"
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

    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it("moves iCloud items to trash with CloudKit records/modify", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      async (url, init) => {
        if (String(url).includes("/records/lookup?")) {
          return {
            ok: true,
            json: async () => ({
              records: [
                {
                  recordName: "asset-a",
                  recordType: "CPLAsset",
                  recordChangeTag: "tag-current-trash",
                  zoneID: {
                    zoneName: "PrimarySync",
                    ownerRecordName: "_defaultOwner"
                  },
                  fields: {
                    isFavorite: { value: 0 },
                    isDeleted: { value: 0 }
                  }
                }
              ]
            })
          } as Response
        }
        if (String(url).includes("/records/modify?")) {
          return {
            ok: true,
            json: async () => ({
              records: [
                {
                  recordName: "asset-a",
                  recordType: "CPLAsset",
                  recordChangeTag: "tag-after-trash",
                  fields: { isDeleted: { value: 1 } },
                  zoneID: {
                    zoneName: "PrimarySync",
                    ownerRecordName: "_defaultOwner"
                  }
                }
              ]
            })
          } as Response
        }
        throw new Error("Unexpected iCloud Photos request route.")
      }
    )

    sendCommand("trashItems", "icloud-trash-real", {
      dedupKeys: ["icloud-a"],
      mediaKeysToTrash: ["icloud-media-a"],
      icloudAssetRefs: [
        {
          recordName: "asset-a",
          changeTag: "tag-before-trash",
          zoneName: "PrimarySync",
          ownerRecordName: "_defaultOwner"
        }
      ]
    })
    await flush()
    await flush()

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/records/modify?"),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: expect.stringContaining('"isDeleted":{"value":1}')
      })
    )
    const modifyCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes("/records/modify?")
    )
    const requestBody = JSON.parse(String(modifyCall?.[1]?.body))
    expect(requestBody).toMatchObject({
      atomic: true,
      zoneID: {
        zoneName: "PrimarySync",
        ownerRecordName: "_defaultOwner"
      },
      operations: [
        {
          operationType: "update",
          record: {
            recordName: "asset-a",
            recordChangeTag: "tag-current-trash",
            recordType: "CPLAsset",
            fields: { isDeleted: { value: 1 } }
          }
        }
      ]
    })

    const result = messages.find(
      (msg) => msg.action === "gptkResult" && msg.command === "trashItems"
    )
    expect(result).toMatchObject({
      success: true,
      data: {
        trashedCount: 1,
        trashedKeys: ["icloud-media-a"],
        trashedDedupKeys: ["icloud-a"],
        icloudAssetRefs: [
          {
            recordName: "asset-a",
            changeTag: "tag-after-trash",
            zoneName: "PrimarySync",
            ownerRecordName: "_defaultOwner"
          }
        ]
      }
    })
    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it("preserves original iCloud zone metadata when trash response omits zoneID", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation(
      async (url) => {
        if (String(url).includes("/records/lookup?")) {
          return {
            ok: true,
            json: async () => ({
              records: [
                {
                  recordName: "asset-a",
                  recordType: "CPLAsset",
                  recordChangeTag: "tag-current-trash",
                  zoneID: {
                    zoneName: "PrimarySync",
                    ownerRecordName: "_defaultOwner"
                  },
                  fields: {
                    isFavorite: { value: 0 },
                    isDeleted: { value: 0 }
                  }
                }
              ]
            })
          } as Response
        }
        if (String(url).includes("/records/modify?")) {
          return {
            ok: true,
            json: async () => ({
              records: [
                {
                  recordName: "asset-a",
                  recordType: "CPLAsset",
                  recordChangeTag: "tag-after-trash",
                  fields: { isDeleted: { value: 1 } }
                }
              ]
            })
          } as Response
        }
        throw new Error("Unexpected iCloud Photos request route.")
      }
    )

    sendCommand("trashItems", "icloud-trash-zone-fallback", {
      dedupKeys: ["icloud-a"],
      mediaKeysToTrash: ["icloud-media-a"],
      icloudAssetRefs: [
        {
          recordName: "asset-a",
          changeTag: "tag-before-trash",
          zoneName: "PrimarySync",
          ownerRecordName: "_defaultOwner"
        }
      ]
    })
    await flush()
    await flush()

    const result = messages.find(
      (msg) => msg.action === "gptkResult" && msg.command === "trashItems"
    )
    expect(result).toMatchObject({
      success: true,
      data: {
        trashedCount: 1,
        icloudAssetRefs: [
          {
            recordName: "asset-a",
            changeTag: "tag-after-trash",
            zoneName: "PrimarySync",
            ownerRecordName: "_defaultOwner"
          }
        ]
      }
    })
    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it("allows dry-run trash commands without deleting", async () => {
    const { messages, restore } = collectMessages()

    sendCommand("trashItems", "icloud-trash-dry-run", {
      dryRun: true,
      dedupKeys: ["icloud-a", "icloud-b"],
      mediaKeysToTrash: ["icloud-a", "icloud-b"]
    })
    await flush()

    const result = messages.find(
      (msg) => msg.action === "gptkResult" && msg.command === "trashItems"
    )
    expect(result).toMatchObject({
      success: true,
      data: {
        dryRun: true,
        requestedCount: 2,
        trashedCount: 0,
        trashedKeys: [],
        trashedDedupKeys: []
      }
    })
    restore()
  })
})

describe("restoreItems", () => {
  it("[PARITY-04] restores iCloud items with fresh CloudKit asset refs and exact result identities", async () => {
    const { messages, restore } = collectMessages()
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [
          {
            recordName: "asset-a",
            recordType: "CPLAsset",
            recordChangeTag: "tag-after-restore",
            fields: { isDeleted: { value: 0 } },
            zoneID: {
              zoneName: "PrimarySync",
              ownerRecordName: "_defaultOwner"
            }
          }
        ]
      })
    } as Response)

    sendCommand("restoreItems", "icloud-restore", {
      dedupKeys: ["icloud-a"],
      icloudAssetRefs: [
        {
          recordName: "asset-a",
          changeTag: "tag-after-trash",
          zoneName: "PrimarySync",
          ownerRecordName: "_defaultOwner"
        }
      ]
    })
    await flush()
    await flush()

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/records/modify?"),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: expect.stringContaining('"isDeleted":{"value":0}')
      })
    )

    const result = messages.find(
      (msg) => msg.action === "gptkResult" && msg.command === "restoreItems"
    )
    expect(result).toMatchObject({
      success: true,
      data: {
        restoredCount: 1,
        restoredDedupKeys: ["icloud-a"]
      }
    })
    fetchSpy.mockRestore()
    performanceSpy.mockRestore()
    restore()
  })

  it.each([
    ["a shared zone", { zoneName: "SharedSync", ownerRecordName: "_defaultOwner" }],
    ["a different owner", { zoneName: "PrimarySync", ownerRecordName: "other-owner" }]
  ])("rejects restore refs from %s before dispatch", async (_label, secondZone) => {
    const originalBody = document.body.innerHTML
    const originalUrl = window.location.href
    const { messages, restore } = collectMessages()
    ;(window as any).happyDOM.setURL("https://icloud.com/applications/photos")
    document.body.innerHTML =
      '<ui-menu-item aria-label="Signed in as restore-owner@example.test"></ui-menu-item>'
    const healthId = `icloud-restore-zone-health-${String(_label).replace(/\W+/g, "-")}`
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockRejectedValue(new Error("Unexpected provider request for invalid refs."))

    try {
      sendCommand("healthCheck", healthId, {}, "icloud")
      const health = await waitForProviderResult(messages, healthId)
      const requestId = `icloud-restore-invalid-zone-${String(_label).replace(/\W+/g, "-")}`
      sendCommand(
        "restoreItems",
        requestId,
        {
          providerSessionId: health.providerSessionId,
          dedupKeys: ["icloud-a", "icloud-b"],
          icloudAssetRefs: [
            {
              recordName: "asset-a",
              changeTag: "tag-a",
              zoneName: "PrimarySync",
              ownerRecordName: "_defaultOwner"
            },
            {
              recordName: "asset-b",
              changeTag: "tag-b",
              ...secondZone
            }
          ]
        },
        "icloud"
      )
      const result = await waitForProviderResult(messages, requestId)

      expect(result).toMatchObject({
        success: false,
        error: expect.stringMatching(/PrimarySync|same current personal/i)
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
      ;(window as any).happyDOM.setURL(originalUrl)
      document.body.innerHTML = originalBody
      restore()
    }
  })

  it("stops later restore batches when the account changes after a dispatched batch", async () => {
    const originalBody = document.body.innerHTML
    const originalUrl = window.location.href
    const { messages, restore } = collectMessages()
    ;(window as any).happyDOM.setURL("https://icloud.com/applications/photos")
    const setAccount = (email: string) => {
      document.body.innerHTML = `<ui-menu-item aria-label="Signed in as ${email}"></ui-menu-item>`
    }
    setAccount("restore-before@example.test")
    const healthId = "icloud-restore-batch-health"
    const performanceSpy = vi
      .spyOn(window.performance, "getEntriesByType")
      .mockReturnValue([
        {
          name: "https://p167-ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/private/records/query?remapEnums=true"
        } as PerformanceEntry
      ])
    const sentBodies: any[] = []
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"))
      sentBodies.push(body)
      return {
        ok: true,
        json: async () => ({
          records: body.operations.map((operation: any) => ({
            recordName: operation.record.recordName,
            recordType: "CPLAsset",
            recordChangeTag: `after-${operation.record.recordName}`,
            zoneID: {
              zoneName: "PrimarySync",
              ownerRecordName: "_defaultOwner"
            },
            fields: { isDeleted: { value: 0 } }
          }))
        })
      } as Response
    })
    vi.spyOn(window, "postMessage").mockImplementation((message) => {
      messages.push(message)
      if (
        message?.action === "gptkProgress" &&
        message?.command === "restoreItems" &&
        message?.message === "Restored 50 of 51 iCloud items from trash"
      ) {
        setAccount("restore-after@example.test")
      }
    })

    try {
      sendCommand("healthCheck", healthId, {}, "icloud")
      const health = await waitForProviderResult(messages, healthId)
      const dedupKeys = Array.from({ length: 51 }, (_, index) => `icloud-${index}`)
      sendCommand(
        "restoreItems",
        "icloud-restore-account-transition",
        {
          providerSessionId: health.providerSessionId,
          dedupKeys,
          icloudAssetRefs: dedupKeys.map((_, index) => ({
            recordName: `asset-${index}`,
            changeTag: `tag-${index}`,
            zoneName: "PrimarySync",
            ownerRecordName: "_defaultOwner"
          }))
        },
        "icloud"
      )
      const result = await waitForProviderResult(
        messages,
        "icloud-restore-account-transition"
      )

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(sentBodies[0].operations).toHaveLength(50)
      expect(result).toMatchObject({
        success: false,
        error: expect.stringMatching(/account changed/i),
        data: {
          restoredCount: 50,
          restoredDedupKeys: dedupKeys.slice(0, 50),
          outcomes: expect.arrayContaining([
            expect.objectContaining({
              operation: "restore",
              targetKey: "icloud-0",
              status: "confirmed"
            })
          ]),
          notDispatchedDedupKeys: ["icloud-50"]
        }
      })
      expect(result.data.outcomes).toHaveLength(51)
    } finally {
      fetchSpy.mockRestore()
      performanceSpy.mockRestore()
      ;(window as any).happyDOM.setURL(originalUrl)
      document.body.innerHTML = originalBody
      restore()
    }
  })
})
