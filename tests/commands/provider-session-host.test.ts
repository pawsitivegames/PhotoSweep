/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type ProviderCommandHost = {
  providerSessionId: string
  originalMediaRetrieval: object
  setProviderIdentity: (identity: string) => Promise<string>
  requireCurrentDocumentSession: () => string
  postResult: (
    command: string,
    requestId: string,
    data: unknown,
    scanCoverage?: unknown
  ) => void
  postError: (
    command: string,
    requestId: string,
    error: unknown,
    data?: unknown,
    scanCoverage?: unknown,
    errorCode?: string
  ) => void
  postProgress: (
    requestId: string,
    itemsProcessed: number,
    message: string,
    command?: string,
    data?: unknown
  ) => void
  classifyProviderFailure: (error: unknown) => string
  createProviderHealth: (
    provider: string,
    checks: { page?: boolean; session?: boolean; readPath?: boolean }
  ) => Record<string, unknown>
  createAbortError: () => DOMException
  throwIfAborted: (signal?: AbortSignal | null) => void
  withAbort: <T>(promise: Promise<T>, signal?: AbortSignal | null) => Promise<T>
  delay: (milliseconds: number, signal?: AbortSignal | null) => Promise<void>
  dateRangeBounds: (
    dateRange: { from?: string; to?: string } | null | undefined
  ) => { fromMs: number; toMs: number; valid: boolean } | null
  isTimestampInDateRange: (
    timestamp: number,
    bounds: { fromMs: number; toMs: number; valid: boolean } | null
  ) => boolean
  register: (params: {
    handlers: Record<
      string,
      (
        requestId: string,
        args: Record<string, unknown>,
        signal?: AbortSignal
      ) => void
    >
    unsupportedMessage?: (command: string) => string
  }) => void
}

type ProviderAdapterCommandHost = Pick<
  ProviderCommandHost,
  | "providerSessionId"
  | "originalMediaRetrieval"
  | "setProviderIdentity"
  | "requireCurrentDocumentSession"
  | "postResult"
  | "postError"
  | "postProgress"
  | "dateRangeBounds"
  | "isTimestampInDateRange"
  | "classifyProviderFailure"
  | "createProviderHealth"
  | "createAbortError"
  | "throwIfAborted"
  | "delay"
  | "register"
>

declare global {
  interface Window {
    __GPD_COMMAND_HOST__?: ProviderAdapterCommandHost
    __GPD_COMMAND_HOST_TEST_MODE__?: boolean
    __GPD_COMMAND_HOST_TEST_FACTORY__?: (
      targetWindow: Record<string, unknown>,
      publicKey?: unknown
    ) => ProviderCommandHost
  }
}

const PROVIDER_SESSION_KEY = "__GPD_PROVIDER_SESSION_ID__"
let activeTestHost: ProviderCommandHost | undefined

const trashHandler = vi.fn((requestId: string) => {
  activeTestHost?.postResult("trashItems", requestId, {
    trashedCount: 1
  })
})
const listAlbumsHandler = vi.fn((requestId: string) => {
  activeTestHost?.postResult("listAlbums", requestId, [])
})
const mediaItemsHandler = vi.fn((requestId: string) => {
  activeTestHost?.postResult("getAllMediaItems", requestId, [])
})
const restoreHandler = vi.fn((requestId: string) => {
  activeTestHost?.postResult("restoreItems", requestId, {
    restoredCount: 1
  })
})
const healthCheckHandler = vi.fn((requestId: string) => {
  activeTestHost?.postResult("healthCheck", requestId, {
    ok: true
  })
})
const retrievalHandler = vi.fn(
  (_requestId: string, _args: Record<string, unknown>, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (!signal || signal.aborted) {
        resolve()
        return
      }
      signal.addEventListener("abort", () => resolve(), { once: true })
    })
)

let hostMessageListener: EventListener | undefined

beforeEach(async () => {
  vi.resetModules()
  delete window.__GPD_COMMAND_HOST__
  window.__GPD_COMMAND_HOST_TEST_MODE__ = true
  const addEventListenerSpy = vi.spyOn(window, "addEventListener")
  // Import the production host for each test so mutation runs exercise the
  // current source instead of a module cached by an earlier test.
  // @ts-expect-error Vite resolves this JavaScript module in the test bundle.
  await import("../../scripts/photo-provider-command-host.js")
  const adapterHost = window.__GPD_COMMAND_HOST__
  if (!adapterHost) throw new Error("Provider command host was not initialized")
  window.dispatchEvent(new Event("gpd-command-host-test"))
  const createHost = window.__GPD_COMMAND_HOST_TEST_FACTORY__
  if (!createHost) throw new Error("Provider command-host test factory is missing")
  delete window.__GPD_COMMAND_HOST__
  activeTestHost = createHost(window as unknown as Record<string, unknown>)
  activeTestHost.register({
    handlers: {
      trashItems: trashHandler,
      listAlbums: listAlbumsHandler,
      getAllMediaItems: mediaItemsHandler,
      restoreItems: restoreHandler,
      getOriginalContentHash: retrievalHandler,
      getVideoPlaybackUrl: retrievalHandler,
      healthCheck: healthCheckHandler
    }
  })
  const messageListener = addEventListenerSpy.mock.calls
    .filter(([type]) => type === "message")
    .at(-1)?.[1]
  addEventListenerSpy.mockRestore()
  if (typeof messageListener !== "function") {
    throw new Error("Provider command-host message listener was not registered")
  }
  hostMessageListener = messageListener as EventListener

  trashHandler.mockClear()
  listAlbumsHandler.mockClear()
  mediaItemsHandler.mockClear()
  restoreHandler.mockClear()
  healthCheckHandler.mockClear()
  retrievalHandler.mockClear()
})

afterEach(() => {
  if (hostMessageListener) {
    window.removeEventListener("message", hostMessageListener)
    hostMessageListener = undefined
  }
  activeTestHost = undefined
  delete window.__GPD_COMMAND_HOST_TEST_FACTORY__
  delete window.__GPD_COMMAND_HOST_TEST_MODE__
  delete window.__GPD_COMMAND_HOST__
})

async function sendTrashCommand(sessionId: string): Promise<void> {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "trashItems",
        requestId: `trash-${sessionId}`,
        provider: "icloud",
        args: { providerSessionId: sessionId }
      }
    })
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function sendTrashCommandWithoutSession(): Promise<void> {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "trashItems",
        requestId: "trash-without-session",
        provider: "icloud",
        args: {}
      }
    })
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function sendTrashCommandWithoutArgs(): Promise<void> {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "trashItems",
        requestId: "trash-without-args",
        provider: "icloud"
      }
    })
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function sendListAlbumsCommand(
  sessionId?: string,
  provider = "amazon"
): Promise<void> {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "listAlbums",
        requestId: "albums-session-binding",
        provider,
        args: sessionId ? { providerSessionId: sessionId } : {}
      }
    })
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function sendDefaultProviderAlbumCommand(): Promise<void> {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "listAlbums",
        requestId: "albums-default-provider",
        args: {}
      }
    })
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function sendSessionCommand(
  command: "getAllMediaItems" | "restoreItems",
  sessionId: string,
  provider = "amazon",
  scopeFingerprint = "test-current-scope"
): Promise<void> {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command,
        requestId: `${command}-${sessionId}`,
        provider,
        args: {
          providerSessionId: sessionId,
          ...(command === "getAllMediaItems"
            ? { scanScopeFingerprint: scopeFingerprint }
            : {})
        }
      }
    })
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function sendOriginalRetrieval(
  requestId: string,
  sessionId: string,
  scopeFingerprint: string,
  provider = "amazon",
  userOptIn = true
): Promise<void> {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "getOriginalContentHash",
        requestId,
        provider,
        args: {
          requestId,
          providerSessionId: sessionId,
          scanScopeFingerprint: scopeFingerprint,
          userOptIn
        }
      }
    })
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function sendOriginalRetrievalWithArgs(
  requestId: string,
  args: Record<string, unknown>,
  provider = "amazon"
): Promise<void> {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "getOriginalContentHash",
        requestId,
        provider,
        args
      }
    })
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function sendVideoPlaybackRetrievalWithArgs(
  requestId: string,
  args: Record<string, unknown>,
  provider = "amazon"
): Promise<void> {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "getVideoPlaybackUrl",
        requestId,
        provider,
        args
      }
    })
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function sendProviderRetrievalCancellation(
  requestId: string,
  targetRequestId: string,
  sessionId: string,
  scopeFingerprint: string,
  provider = "amazon"
): Promise<void> {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "cancelProviderRequest",
        requestId,
        provider,
        args: {
          targetRequestId,
          providerSessionId: sessionId,
          scanScopeFingerprint: scopeFingerprint
        }
      }
    })
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("PARITY-02 provider command host session binding", () => {
  it("persists the generated session ID in tab sessionStorage", () => {
    const host = activeTestHost!

    expect(window.sessionStorage.getItem(PROVIDER_SESSION_KEY)).toBe(
      host.providerSessionId
    )
  })

  it("reattaches a valid persisted session ID and preserves its marker", async () => {
    window.__GPD_COMMAND_HOST_TEST_MODE__ = true
    window.dispatchEvent(new Event("gpd-command-host-test"))
    const createCommandHost = window.__GPD_COMMAND_HOST_TEST_FACTORY__
    if (!createCommandHost) throw new Error("test command-host factory missing")

    const storedSessionId = "persisted-provider-page-session"
    const fakeWindow: Record<string, unknown> = {
      location: { origin: "https://www.amazon.ca" },
      sessionStorage: {
        getItem: vi.fn(() => storedSessionId),
        setItem: vi.fn()
      },
      postMessage: vi.fn()
    }
    fakeWindow.top = fakeWindow

    const host = createCommandHost(fakeWindow)
    expect(host.providerSessionId).toBe(storedSessionId)
    expect(fakeWindow[PROVIDER_SESSION_KEY]).toBe(storedSessionId)
    expect(
      Object.getOwnPropertyDescriptor(fakeWindow, PROVIDER_SESSION_KEY)
    ).toMatchObject({
      configurable: false,
      enumerable: false,
      set: undefined,
      get: expect.any(Function)
    })
  })

  it("rotates a persisted provider session after an owner change across reloads", async () => {
    window.__GPD_COMMAND_HOST_TEST_MODE__ = true
    window.dispatchEvent(new Event("gpd-command-host-test"))
    const createCommandHost = window.__GPD_COMMAND_HOST_TEST_FACTORY__
    if (!createCommandHost) throw new Error("test command-host factory missing")

    const values = new Map<string, string>()
    const sessionStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    }
    const makeWindow = () => {
      const fakeWindow: Record<string, unknown> = {
        location: { origin: "https://www.amazon.ca" },
        sessionStorage,
        postMessage: vi.fn()
      }
      fakeWindow.top = fakeWindow
      return fakeWindow
    }

    const firstHost = createCommandHost(makeWindow())
    const firstSessionId = await firstHost.setProviderIdentity("owner-a")
    const storedIdentityFingerprint = values.get(
      "__GPD_PROVIDER_IDENTITY_FINGERPRINT__"
    )
    expect(storedIdentityFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(storedIdentityFingerprint).not.toContain("owner-a")
    const sameOwnerAfterReload = createCommandHost(makeWindow())
    expect(sameOwnerAfterReload.providerSessionId).toBe(firstSessionId)
    expect(
      await sameOwnerAfterReload.setProviderIdentity("owner-a")
    ).toBe(firstSessionId)

    const changedOwnerAfterReload = createCommandHost(makeWindow())
    expect(changedOwnerAfterReload.providerSessionId).toBe(firstSessionId)
    const changedSessionId = await changedOwnerAfterReload.setProviderIdentity(
      "owner-b"
    )
    expect(changedSessionId).not.toBe(firstSessionId)
    expect(values.get(PROVIDER_SESSION_KEY)).toBe(changedSessionId)
  })

  it("rotates a restored session when its identity fingerprint is missing [PARITY-02]", async () => {
    window.__GPD_COMMAND_HOST_TEST_MODE__ = true
    window.dispatchEvent(new Event("gpd-command-host-test"))
    const createCommandHost = window.__GPD_COMMAND_HOST_TEST_FACTORY__
    if (!createCommandHost) throw new Error("test command-host factory missing")

    const previousSessionId = "restored-without-identity-fingerprint"
    const values = new Map<string, string>([[PROVIDER_SESSION_KEY, previousSessionId]])
    const fakeWindow: Record<string, unknown> = {
      location: { origin: "https://www.amazon.ca" },
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      },
      postMessage: vi.fn()
    }
    fakeWindow.top = fakeWindow

    const host = createCommandHost(fakeWindow)
    const currentSessionId = await host.setProviderIdentity("owner-a")

    expect(currentSessionId).not.toBe(previousSessionId)
    expect(values.get(PROVIDER_SESSION_KEY)).toBe(currentSessionId)
    expect(values.get("__GPD_PROVIDER_IDENTITY_FINGERPRINT__")).toMatch(
      /^[a-f0-9]{64}$/
    )
  })

  it("keeps the latest rotated session when the host is recreated in the same tab [PARITY-02]", async () => {
    window.__GPD_COMMAND_HOST_TEST_MODE__ = true
    window.dispatchEvent(new Event("gpd-command-host-test"))
    const createCommandHost = window.__GPD_COMMAND_HOST_TEST_FACTORY__
    if (!createCommandHost) throw new Error("test command-host factory missing")

    const values = new Map<string, string>()
    const fakeWindow: Record<string, unknown> = {
      location: { origin: "https://www.amazon.ca" },
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      },
      postMessage: vi.fn()
    }
    fakeWindow.top = fakeWindow

    const firstHost = createCommandHost(fakeWindow)
    const firstSessionId = await firstHost.setProviderIdentity("owner-a")
    const rotatedSessionId = await firstHost.setProviderIdentity("owner-b")
    expect(rotatedSessionId).not.toBe(firstSessionId)
    expect(firstHost.requireCurrentDocumentSession()).toBe(rotatedSessionId)

    delete fakeWindow.__GPD_COMMAND_HOST__
    const recreatedHost = createCommandHost(fakeWindow)
    expect(recreatedHost.providerSessionId).toBe(rotatedSessionId)
    expect(await recreatedHost.setProviderIdentity("owner-b")).toBe(
      rotatedSessionId
    )
  })

  it("rotates a same-document restored session when the next identity changes [PARITY-02]", async () => {
    window.__GPD_COMMAND_HOST_TEST_MODE__ = true
    window.dispatchEvent(new Event("gpd-command-host-test"))
    const createCommandHost = window.__GPD_COMMAND_HOST_TEST_FACTORY__
    if (!createCommandHost) throw new Error("test command-host factory missing")

    const values = new Map<string, string>()
    const fakeWindow: Record<string, unknown> = {
      location: { origin: "https://www.amazon.ca" },
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      },
      postMessage: vi.fn()
    }
    fakeWindow.top = fakeWindow

    const firstHost = createCommandHost(fakeWindow)
    const firstSessionId = await firstHost.setProviderIdentity("owner-a")
    delete fakeWindow.__GPD_COMMAND_HOST__

    const recreatedHost = createCommandHost(fakeWindow)
    expect(recreatedHost.providerSessionId).toBe(firstSessionId)
    const changedSessionId = await recreatedHost.setProviderIdentity("owner-b")

    expect(changedSessionId).not.toBe(firstSessionId)
    expect(values.get(PROVIDER_SESSION_KEY)).toBe(changedSessionId)
  })

  it("rotates a same-document restored session when identity is unavailable [PARITY-02]", () => {
    window.__GPD_COMMAND_HOST_TEST_MODE__ = true
    window.dispatchEvent(new Event("gpd-command-host-test"))
    const createCommandHost = window.__GPD_COMMAND_HOST_TEST_FACTORY__
    if (!createCommandHost) throw new Error("test command-host factory missing")

    const values = new Map<string, string>()
    const fakeWindow: Record<string, unknown> = {
      location: { origin: "https://www.icloud.com" },
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      },
      postMessage: vi.fn()
    }
    fakeWindow.top = fakeWindow

    const firstHost = createCommandHost(fakeWindow)
    const firstSessionId = firstHost.providerSessionId
    delete fakeWindow.__GPD_COMMAND_HOST__
    const recreatedHost = createCommandHost(fakeWindow)

    expect(recreatedHost.providerSessionId).toBe(firstSessionId)
    const currentSessionId = recreatedHost.requireCurrentDocumentSession()
    expect(currentSessionId).not.toBe(firstSessionId)
    expect(values.get(PROVIDER_SESSION_KEY)).toBe(currentSessionId)
  })

  it("rotates when a persisted identity fingerprint cannot be read [PARITY-02]", async () => {
    window.__GPD_COMMAND_HOST_TEST_MODE__ = true
    window.dispatchEvent(new Event("gpd-command-host-test"))
    const createCommandHost = window.__GPD_COMMAND_HOST_TEST_FACTORY__
    if (!createCommandHost) throw new Error("test command-host factory missing")

    const previousSessionId = "restored-with-unreadable-fingerprint"
    const values = new Map<string, string>([[PROVIDER_SESSION_KEY, previousSessionId]])
    const fakeWindow: Record<string, unknown> = {
      location: { origin: "https://www.amazon.ca" },
      sessionStorage: {
        getItem: (key: string) => {
          if (key === "__GPD_PROVIDER_IDENTITY_FINGERPRINT__") {
            throw new Error("identity fingerprint is unreadable")
          }
          return values.get(key) ?? null
        },
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      },
      postMessage: vi.fn()
    }
    fakeWindow.top = fakeWindow

    const host = createCommandHost(fakeWindow)
    const currentSessionId = await host.setProviderIdentity("owner-a")

    expect(currentSessionId).not.toBe(previousSessionId)
    expect(values.get(PROVIDER_SESSION_KEY)).toBe(currentSessionId)
  })

  it("omits the identity fingerprint when WebCrypto hashing fails [PARITY-02]", async () => {
    window.__GPD_COMMAND_HOST_TEST_MODE__ = true
    window.dispatchEvent(new Event("gpd-command-host-test"))
    const createCommandHost = window.__GPD_COMMAND_HOST_TEST_FACTORY__
    if (!createCommandHost) throw new Error("test command-host factory missing")

    const values = new Map<string, string>()
    const fakeWindow: Record<string, unknown> = {
      location: { origin: "https://www.amazon.ca" },
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      },
      postMessage: vi.fn()
    }
    fakeWindow.top = fakeWindow

    const digest = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockRejectedValueOnce(new Error("WebCrypto digest unavailable"))
    try {
      const host = createCommandHost(fakeWindow)
      await host.setProviderIdentity("owner-a")
      expect(values.has("__GPD_PROVIDER_IDENTITY_FINGERPRINT__")).toBe(false)
    } finally {
      digest.mockRestore()
    }
  })

  it("does not rotate a current document after stable identity checks [PARITY-02]", async () => {
    window.__GPD_COMMAND_HOST_TEST_MODE__ = true
    window.dispatchEvent(new Event("gpd-command-host-test"))
    const createCommandHost = window.__GPD_COMMAND_HOST_TEST_FACTORY__
    if (!createCommandHost) throw new Error("test command-host factory missing")

    const fakeWindow: Record<string, unknown> = {
      location: { origin: "https://www.amazon.ca" },
      sessionStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn()
      },
      postMessage: vi.fn()
    }
    fakeWindow.top = fakeWindow
    const host = createCommandHost(fakeWindow)
    const currentSessionId = await host.setProviderIdentity("owner-a")
    expect(host.requireCurrentDocumentSession()).toBe(currentSessionId)

    await host.setProviderIdentity("owner-a")
    expect(host.requireCurrentDocumentSession()).toBe(currentSessionId)
  })

  it("preserves a restored session when its stored identity fingerprint matches", async () => {
    window.__GPD_COMMAND_HOST_TEST_MODE__ = true
    window.dispatchEvent(new Event("gpd-command-host-test"))
    const createCommandHost = window.__GPD_COMMAND_HOST_TEST_FACTORY__
    if (!createCommandHost) throw new Error("test command-host factory missing")

    const restoredSessionId = "restored-owner-session"
    const values = new Map<string, string>([
      ["__GPD_PROVIDER_SESSION_ID__", restoredSessionId],
      [
        "__GPD_PROVIDER_IDENTITY_FINGERPRINT__",
        "95256875151043abdcafdd26fd390c650d6311e1d7185df477ce50736b6a5d0b"
      ]
    ])
    const fakeWindow: Record<string, unknown> = {
      location: { origin: "https://www.amazon.ca" },
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      },
      postMessage: vi.fn()
    }
    fakeWindow.top = fakeWindow

    const host = createCommandHost(fakeWindow)
    expect(host.providerSessionId).toBe(restoredSessionId)

    await host.setProviderIdentity("owner-a")

    expect(host.providerSessionId).toBe(restoredSessionId)
    expect(values.get("__GPD_PROVIDER_IDENTITY_FINGERPRINT__")).toBe(
      "95256875151043abdcafdd26fd390c650d6311e1d7185df477ce50736b6a5d0b"
    )
  })

  it("rotates a restored session when no stable provider identity is available", async () => {
    window.__GPD_COMMAND_HOST_TEST_MODE__ = true
    window.dispatchEvent(new Event("gpd-command-host-test"))
    const createCommandHost = window.__GPD_COMMAND_HOST_TEST_FACTORY__
    if (!createCommandHost) throw new Error("test command-host factory missing")

    const values = new Map<string, string>()
    const sessionStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    }
    const makeWindow = () => {
      const fakeWindow: Record<string, unknown> = {
        location: { origin: "https://www.icloud.com" },
        sessionStorage,
        postMessage: vi.fn()
      }
      fakeWindow.top = fakeWindow
      return fakeWindow
    }

    const previousHost = createCommandHost(makeWindow())
    await previousHost.setProviderIdentity("owner-a@example.com")
    const previousSessionId = previousHost.providerSessionId

    const reloadedHost = createCommandHost(makeWindow())
    expect(reloadedHost.providerSessionId).toBe(previousSessionId)
    const currentSessionId = reloadedHost.requireCurrentDocumentSession()
    expect(currentSessionId).not.toBe(previousSessionId)
    expect(values.get(PROVIDER_SESSION_KEY)).toBe(currentSessionId)
    expect(values.has("__GPD_PROVIDER_IDENTITY_FINGERPRINT__")).toBe(false)
  })

  it("generates a fresh ID for empty, unavailable, or throwing storage", () => {
    window.__GPD_COMMAND_HOST_TEST_MODE__ = true
    window.dispatchEvent(new Event("gpd-command-host-test"))
    const createCommandHost = window.__GPD_COMMAND_HOST_TEST_FACTORY__
    if (!createCommandHost) throw new Error("test command-host factory missing")

    const makeWindow = (sessionStorage?: unknown) => {
      const fakeWindow: Record<string, unknown> = {
        location: { origin: "https://www.amazon.ca" },
        postMessage: vi.fn()
      }
      fakeWindow.top = fakeWindow
      if (sessionStorage !== undefined) fakeWindow.sessionStorage = sessionStorage
      return fakeWindow
    }

    const emptyStorage = makeWindow({
      getItem: vi.fn(() => ""),
      setItem: vi.fn()
    })
    const emptyHost = createCommandHost(emptyStorage)
    expect(emptyHost.providerSessionId).not.toBe("")
    expect(emptyStorage[PROVIDER_SESSION_KEY]).toBe(emptyHost.providerSessionId)

    const throwingStorage = makeWindow({
      getItem: vi.fn(() => {
        throw new Error("storage unavailable")
      }),
      setItem: vi.fn()
    })
    expect(() => createCommandHost(throwingStorage)).not.toThrow()

    const unavailableStorage = makeWindow()
    expect(() => createCommandHost(unavailableStorage)).not.toThrow()
  })

  it("rejects destructive commands from an older provider page session", async () => {
    const host = activeTestHost!
    const postMessage = vi.spyOn(window, "postMessage")

    await sendTrashCommand("stale-provider-page-session")

    expect(trashHandler).not.toHaveBeenCalled()
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "trashItems",
        success: false,
        providerSessionId: host.providerSessionId,
        error: expect.stringContaining("page session changed")
      }),
      "*"
    )
    postMessage.mockRestore()
  })

  it("rejects destructive commands with no provider page session", async () => {
    const host = activeTestHost!
    const postMessage = vi.spyOn(window, "postMessage")

    await sendTrashCommandWithoutSession()

    expect(trashHandler).not.toHaveBeenCalled()
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "trashItems",
        success: false,
        providerSessionId: host.providerSessionId,
        error: expect.stringContaining("page session changed")
      }),
      "*"
    )

    postMessage.mockClear()
    await sendTrashCommandWithoutArgs()
    expect(trashHandler).not.toHaveBeenCalled()
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "trashItems",
        success: false,
        providerSessionId: host.providerSessionId,
        error: expect.stringContaining("page session changed")
      }),
      "*"
    )
    postMessage.mockRestore()
  })

  it("dispatches only when the expected provider page session matches", async () => {
    const host = activeTestHost!

    await sendTrashCommand(host.providerSessionId)

    expect(trashHandler).toHaveBeenCalledTimes(1)
    expect(trashHandler).toHaveBeenCalledWith(
      `trash-${host.providerSessionId}`,
      { providerSessionId: host.providerSessionId },
      undefined
    )
  })

  it("binds original retrieval to explicit opt-in, current session, and scope", async () => {
    const host = activeTestHost!
    const postMessage = vi.spyOn(window, "postMessage")

    await sendOriginalRetrieval(
      "hash-missing-opt-in",
      host.providerSessionId,
      "scan-scope",
      "amazon",
      false
    )
    expect(retrievalHandler).not.toHaveBeenCalled()
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "getOriginalContentHash",
        success: false,
        error: expect.stringContaining("explicit opt-in")
      }),
      "*"
    )

    await sendOriginalRetrieval(
      "hash-stale-session",
      "stale-session",
      "scan-scope"
    )
    expect(retrievalHandler).not.toHaveBeenCalled()

    await sendOriginalRetrieval(
      "hash-current-session",
      host.providerSessionId,
      "scan-scope"
    )
    expect(retrievalHandler).not.toHaveBeenCalled()
    await sendSessionCommand(
      "getAllMediaItems",
      host.providerSessionId,
      "amazon",
      "scan-scope"
    )
    await sendOriginalRetrieval(
      "hash-current-session-after-scan",
      host.providerSessionId,
      "scan-scope"
    )
    expect(retrievalHandler).toHaveBeenCalledTimes(1)
    expect(retrievalHandler.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal)
    postMessage.mockRestore()
  })

  it("binds video playback retrieval and cancellation to the current request identity", async () => {
    const host = activeTestHost!
    const scopeFingerprint = "video-playback-current-scope"
    const postMessage = vi.spyOn(window, "postMessage")
    try {
      await sendSessionCommand(
        "getAllMediaItems",
        host.providerSessionId,
        "amazon",
        scopeFingerprint
      )

      const invalidRequests = [
        {
          requestId: "video-stale-session",
          args: {
            requestId: "video-stale-session",
            providerSessionId: "stale-session",
            scanScopeFingerprint: scopeFingerprint,
            userOptIn: true
          }
        },
        {
          requestId: "video-mismatched-request",
          args: {
            requestId: "different-video-request",
            providerSessionId: host.providerSessionId,
            scanScopeFingerprint: scopeFingerprint,
            userOptIn: true
          }
        },
        {
          requestId: "video-stale-scope",
          args: {
            requestId: "video-stale-scope",
            providerSessionId: host.providerSessionId,
            scanScopeFingerprint: "stale-video-scope",
            userOptIn: true
          }
        },
        {
          requestId: "video-missing-opt-in",
          args: {
            requestId: "video-missing-opt-in",
            providerSessionId: host.providerSessionId,
            scanScopeFingerprint: scopeFingerprint,
            userOptIn: false
          }
        }
      ]

      for (const { requestId, args } of invalidRequests) {
        await sendVideoPlaybackRetrievalWithArgs(requestId, args)
        expect(retrievalHandler).not.toHaveBeenCalled()
        expect(postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            command: "getVideoPlaybackUrl",
            requestId,
            success: false
          }),
          "*"
        )
      }

      const validRequestId = "video-playback-bound-request"
      await sendVideoPlaybackRetrievalWithArgs(validRequestId, {
        requestId: validRequestId,
        providerSessionId: host.providerSessionId,
        scanScopeFingerprint: scopeFingerprint,
        userOptIn: true
      })
      const signal = retrievalHandler.mock.calls[0]?.[2]
      if (!signal) {
        throw new Error("video playback handler did not receive an abort signal")
      }
      expect(signal.aborted).toBe(false)

      await sendProviderRetrievalCancellation(
        "cancel-video-wrong-scope",
        validRequestId,
        host.providerSessionId,
        "stale-video-scope"
      )
      expect(signal.aborted).toBe(false)

      await sendProviderRetrievalCancellation(
        "cancel-video-current-scope",
        validRequestId,
        host.providerSessionId,
        scopeFingerprint
      )
      expect(signal.aborted).toBe(true)
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "cancelProviderRequest",
          requestId: "cancel-video-current-scope",
          data: { targetRequestId: validRequestId, cancelled: true }
        }),
        "*"
      )
    } finally {
      postMessage.mockRestore()
    }
  })

  it("returns protocol errors when provider commands have no argument object", async () => {
    const host = activeTestHost!
    const postMessage = vi.spyOn(window, "postMessage")
    const sendWithoutArgs = async (
      command: string,
      requestId: string,
      provider: string
    ) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: { app: "GPD", action: "gptkCommand", command, requestId, provider }
        })
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    try {
      await sendWithoutArgs("getOriginalContentHash", "missing-retrieval-args", "amazon")
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "getOriginalContentHash",
          requestId: "missing-retrieval-args",
          success: false,
          error:
            "Original media retrieval requires explicit opt-in and a current provider session, request, and scan scope."
        }),
        "*"
      )

      await sendWithoutArgs("getAllMediaItems", "missing-scan-args", "google")
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "getAllMediaItems",
          requestId: "missing-scan-args",
          success: false,
          error: "The scan scope is missing or invalid. Restart the scan from PhotoSweep."
        }),
        "*"
      )
      expect(retrievalHandler).not.toHaveBeenCalled()
      expect(mediaItemsHandler).not.toHaveBeenCalled()
      expect(host.providerSessionId).toBeTruthy()
    } finally {
      postMessage.mockRestore()
    }
  })

  it.each([
    ["a mismatched provider session", { providerSessionId: "stale-session" }],
    ["a missing provider session", { providerSessionId: undefined }],
    ["a non-string provider session", { providerSessionId: 17 }],
    ["a mismatched request identity", { requestId: "different-request" }],
    ["a missing scan scope", { scanScopeFingerprint: undefined }],
    ["an empty scan scope", { scanScopeFingerprint: "" }],
    ["a non-string scan scope", { scanScopeFingerprint: 17 }],
    ["a scan scope from another scan", { scanScopeFingerprint: "stale-scope" }]
  ] as const)(
    "rejects original retrieval before handler dispatch when only %s is invalid",
    async (_label, invalidField) => {
      const host = activeTestHost!
      const scopeFingerprint = "established-current-scope"
      const requestId = "hash-invalid-session-or-scope-field"
      await sendSessionCommand(
        "getAllMediaItems",
        host.providerSessionId,
        "amazon",
        scopeFingerprint
      )

      retrievalHandler.mockClear()
      const postMessage = vi.spyOn(window, "postMessage")
      const args = {
        requestId,
        providerSessionId: host.providerSessionId,
        scanScopeFingerprint: scopeFingerprint,
        userOptIn: true,
        ...invalidField
      }

      try {
        await sendOriginalRetrievalWithArgs(requestId, args)

        expect(retrievalHandler).not.toHaveBeenCalled()
        const response = postMessage.mock.calls
          .map(([message]) => message as Record<string, unknown>)
          .find(
            (message) =>
              message.command === "getOriginalContentHash" &&
              message.requestId === requestId
          )
        expect(response).toMatchObject({
          command: "getOriginalContentHash",
          requestId,
          success: false
        })
        if (_label === "a scan scope from another scan") {
          expect(response?.error).toBe(
            "Original media retrieval must match the most recent scan scope in this provider page session. Scan again and review the current items."
          )
        }
        if (
          _label === "a missing scan scope" ||
          _label === "an empty scan scope"
        ) {
          expect(response?.error).toBe(
            "Original media retrieval requires explicit opt-in and a current provider session, request, and scan scope."
          )
        }
      } finally {
        postMessage.mockRestore()
      }
    }
  )

  it("cancels only the matching retrieval session and scan scope", async () => {
    const host = activeTestHost!
    const postMessage = vi.spyOn(window, "postMessage")
    const scopeFingerprint = "current-scope"
    const targetRequestId = "hash-cancellable"

    await sendSessionCommand(
      "getAllMediaItems",
      host.providerSessionId,
      "amazon",
      scopeFingerprint
    )

    await sendOriginalRetrieval(
      targetRequestId,
      host.providerSessionId,
      scopeFingerprint
    )
    const signal = retrievalHandler.mock.calls[0]?.[2]
    if (!signal) throw new Error("retrieval handler did not receive a signal")

    await sendProviderRetrievalCancellation(
      "cancel-wrong-scope",
      targetRequestId,
      host.providerSessionId,
      "stale-scope"
    )
    expect(signal.aborted).toBe(false)
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "cancelProviderRequest",
        data: { targetRequestId, cancelled: false }
      }),
      "*"
    )

    await sendProviderRetrievalCancellation(
      "cancel-current-scope",
      targetRequestId,
      host.providerSessionId,
      scopeFingerprint
    )
    expect(signal.aborted).toBe(true)
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "cancelProviderRequest",
        data: { targetRequestId, cancelled: true }
      }),
      "*"
    )
    postMessage.mockRestore()
  })

  it("aborts active retrieval when the provider account session rotates", async () => {
    const host = activeTestHost!
    await host.setProviderIdentity("approved-owner-a")
    const firstSessionId = host.providerSessionId
    await sendSessionCommand(
      "getAllMediaItems",
      firstSessionId,
      "amazon",
      "scope-before-account-change"
    )
    await sendOriginalRetrieval(
      "hash-account-switch",
      firstSessionId,
      "scope-before-account-change"
    )
    const signal = retrievalHandler.mock.calls[0]?.[2]
    if (!signal) throw new Error("retrieval handler did not receive a signal")

    await host.setProviderIdentity("approved-owner-b")

    expect(host.providerSessionId).not.toBe(firstSessionId)
    expect(signal.aborted).toBe(true)
  })

  it("rotates the opaque session when a provider account changes in the same tab", async () => {
    const host = activeTestHost!
    const firstIdentitySessionId = await host.setProviderIdentity("owner-a")
    const rotatedSessionId = await host.setProviderIdentity("owner-b")

    expect(rotatedSessionId).not.toBe(firstIdentitySessionId)
    expect(host.providerSessionId).toBe(rotatedSessionId)
    expect(window.sessionStorage.getItem(PROVIDER_SESSION_KEY)).toBe(
      rotatedSessionId
    )

    const postMessage = vi.spyOn(window, "postMessage")
    await sendTrashCommand(firstIdentitySessionId)
    expect(trashHandler).not.toHaveBeenCalled()
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "trashItems",
        success: false,
        providerSessionId: rotatedSessionId,
        error: expect.stringContaining("page session changed")
      }),
      "*"
    )
    postMessage.mockRestore()
  })

  it("normalizes provider identity markers and ignores blank or non-string values", async () => {
    window.__GPD_COMMAND_HOST_TEST_MODE__ = true
    window.dispatchEvent(new Event("gpd-command-host-test"))
    const createCommandHost = window.__GPD_COMMAND_HOST_TEST_FACTORY__
    if (!createCommandHost) throw new Error("test command-host factory missing")

    const makeHost = () => {
      const fakeWindow: Record<string, unknown> = {
        location: { origin: "https://www.amazon.ca" },
        sessionStorage: {
          getItem: vi.fn(() => null),
          setItem: vi.fn()
        },
        postMessage: vi.fn()
      }
      fakeWindow.top = fakeWindow
      return createCommandHost(fakeWindow)
    }

    const blankHost = makeHost()
    const blankSessionId = blankHost.providerSessionId
    expect(await blankHost.setProviderIdentity("   ")).toBe(blankSessionId)
    expect(await blankHost.setProviderIdentity("owner-a")).toBe(blankSessionId)

    const nonStringHost = makeHost()
    const nonStringSessionId = nonStringHost.providerSessionId
    expect(
      await nonStringHost.setProviderIdentity(42 as unknown as string)
    ).toBe(nonStringSessionId)
    expect(await nonStringHost.setProviderIdentity("owner-a")).toBe(
      nonStringSessionId
    )

    const trimmedHost = makeHost()
    const trimmedSessionId = trimmedHost.providerSessionId
    expect(await trimmedHost.setProviderIdentity(" owner-a ")).toBe(
      trimmedSessionId
    )
    expect(await trimmedHost.setProviderIdentity("owner-a")).toBe(
      trimmedSessionId
    )

    const stableHost = makeHost()
    const stableSessionId = stableHost.providerSessionId
    expect(await stableHost.setProviderIdentity("owner-a")).toBe(
      stableSessionId
    )
    expect(await stableHost.setProviderIdentity("owner-a")).toBe(
      stableSessionId
    )
  })

  it("creates a versioned bounded provider health snapshot", () => {
    const host = activeTestHost!

    expect(
      host.createProviderHealth("google", {
        page: true,
        session: true,
        readPath: true
      })
    ).toMatchObject({ provider: "google", status: "ready" })
    expect(
      host.createProviderHealth("unknown", {
        page: true,
        session: true,
        readPath: true
      })
    ).toMatchObject({ provider: "google", status: "ready" })
    expect(
      host.createProviderHealth("icloud", {
        page: true,
        session: true,
        readPath: true
      })
    ).toEqual({
      schemaVersion: 1,
      contractVersion: "provider-parity-v1",
      provider: "icloud",
      status: "ready",
      checks: { page: true, session: true, readPath: true }
    })
    expect(
      host.createProviderHealth("amazon", {
        page: true,
        session: false,
        readPath: false
      })
    ).toMatchObject({
      provider: "amazon",
      status: "unavailable",
      checks: { page: true, session: false, readPath: false }
    })

    for (const checks of [
      { page: false, session: true, readPath: true },
      { page: true, session: false, readPath: true },
      { page: true, session: true, readPath: false }
    ]) {
      expect(host.createProviderHealth("google", checks)).toMatchObject({
        status: "unavailable",
        checks
      })
    }
    expect(
      host.createProviderHealth(
        "google",
        undefined as unknown as {
          page?: boolean
          session?: boolean
          readPath?: boolean
        }
      )
    ).toMatchObject({
      status: "unavailable",
      checks: { page: false, session: false, readPath: false }
    })
  })

  it("[PARITY-03] binds Amazon album listing to the provider page session", async () => {
    const host = activeTestHost!
    const postMessage = vi.spyOn(window, "postMessage")

    await sendListAlbumsCommand("stale-provider-page-session")
    expect(listAlbumsHandler).not.toHaveBeenCalled()
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "listAlbums",
        success: false,
        providerSessionId: host.providerSessionId,
        error: expect.stringContaining("page session changed")
      }),
      "*"
    )

    postMessage.mockClear()
    await sendListAlbumsCommand(host.providerSessionId)
    expect(listAlbumsHandler).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "listAlbums",
        success: true,
        providerSessionId: host.providerSessionId,
        data: []
      }),
      "*"
    )
    postMessage.mockRestore()
  })

  it("binds media enumeration and restore to the current provider session", async () => {
    const host = activeTestHost!
    const postMessage = vi.spyOn(window, "postMessage")

    await sendSessionCommand("getAllMediaItems", "stale-session")
    await sendSessionCommand("restoreItems", "stale-session")
    expect(mediaItemsHandler).not.toHaveBeenCalled()
    expect(restoreHandler).not.toHaveBeenCalled()
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "getAllMediaItems",
        success: false,
        providerSessionId: host.providerSessionId,
        error: expect.stringContaining("page session changed")
      }),
      "*"
    )
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "restoreItems",
        success: false,
        providerSessionId: host.providerSessionId,
        error: expect.stringContaining("page session changed")
      }),
      "*"
    )

    postMessage.mockClear()
    await sendSessionCommand("getAllMediaItems", host.providerSessionId)
    await sendSessionCommand("restoreItems", host.providerSessionId)
    expect(mediaItemsHandler).toHaveBeenCalledTimes(1)
    expect(restoreHandler).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "getAllMediaItems",
        success: true,
        providerSessionId: host.providerSessionId,
        data: []
      }),
      "*"
    )
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "restoreItems",
        success: true,
        providerSessionId: host.providerSessionId,
        data: { restoredCount: 1 }
      }),
      "*"
    )
    postMessage.mockRestore()
  })

  it("keeps Google and non-session commands outside page-session binding", async () => {
    const host = activeTestHost!
    const postMessage = vi.spyOn(window, "postMessage")

    await sendListAlbumsCommand(undefined, "google")
    await sendDefaultProviderAlbumCommand()
    await sendSessionCommand("getAllMediaItems", "stale-session", "google")
    await new Promise<void>((resolve) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: {
            app: "GPD",
            action: "gptkCommand",
            command: "healthCheck",
            requestId: "health-check-stale-session",
            provider: "amazon",
            args: { providerSessionId: "stale-session" }
          }
        })
      )
      setTimeout(resolve, 0)
    })

    expect(listAlbumsHandler).toHaveBeenCalledTimes(2)
    expect(mediaItemsHandler).toHaveBeenCalledTimes(1)
    expect(healthCheckHandler).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "getAllMediaItems",
        success: true,
        providerSessionId: host.providerSessionId
      }),
      "*"
    )
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        command: "healthCheck",
        success: false,
        error: expect.stringContaining("page session changed")
      }),
      "*"
    )
    postMessage.mockRestore()
  })

  it("verifies shared response, progress, coverage, and provider-error envelopes", () => {
    const host = activeTestHost!
    const postMessage = vi.spyOn(window, "postMessage")
    const scanCoverage = { status: "partial", itemsVisited: 2 }

    host.postResult("getAllMediaItems", "result-1", { items: [] }, scanCoverage)
    host.postError(
      "getAllMediaItems",
      "error-1",
      new Error("provider unavailable"),
      { returned: 0 },
      scanCoverage,
      "provider_error"
    )
    host.postError("listAlbums", "error-2", "not signed in")
    host.postProgress("scan-1", 2, "Reading items", "getAllMediaItems", {
      visited: 2
    })
    host.postProgress("scan-2", 0, "Connecting")

    expect(postMessage.mock.calls).toEqual([
      [
        expect.objectContaining({
          app: "GPD",
          action: "gptkResult",
          command: "getAllMediaItems",
          requestId: "result-1",
          success: true,
          data: { items: [] },
          providerSessionId: host.providerSessionId,
          scanCoverage
        }),
        "*"
      ],
      [
        expect.objectContaining({
          app: "GPD",
          action: "gptkResult",
          command: "getAllMediaItems",
          requestId: "error-1",
          success: false,
          error: "provider unavailable",
          providerSessionId: host.providerSessionId,
          errorCode: "provider_error",
          data: { returned: 0 },
          scanCoverage
        }),
        "*"
      ],
      [
        expect.objectContaining({
          command: "listAlbums",
          requestId: "error-2",
          success: false,
          error: "not signed in",
          providerSessionId: host.providerSessionId
        }),
        "*"
      ],
      [
        expect.objectContaining({
          app: "GPD",
          action: "gptkProgress",
          requestId: "scan-1",
          itemsProcessed: 2,
          message: "Reading items",
          command: "getAllMediaItems",
          data: { visited: 2 }
        }),
        "*"
      ],
      [
        expect.objectContaining({
          action: "gptkProgress",
          requestId: "scan-2",
          itemsProcessed: 0,
          message: "Connecting"
        }),
        "*"
      ]
    ])
    expect(
      (postMessage.mock.calls[2]?.[0] as Record<string, unknown>).errorCode
    ).toBeUndefined()
    expect(
      (postMessage.mock.calls[4]?.[0] as Record<string, unknown>).command
    ).toBeUndefined()
    postMessage.mockRestore()
  })

  it("classifies provider authorization failures without hiding other errors", () => {
    const host = activeTestHost!

    expect(host.classifyProviderFailure({ status: 401 })).toBe("auth_expired")
    expect(host.classifyProviderFailure({ status: 403 })).toBe("auth_expired")
    expect(host.classifyProviderFailure(null)).toBe("provider_error")
    expect(host.classifyProviderFailure(new Error("Sign-in required"))).toBe(
      "auth_expired"
    )
    expect(host.classifyProviderFailure("signin required")).toBe("auth_expired")
    expect(host.classifyProviderFailure(new Error("Unauthorised"))).toBe(
      "auth_expired"
    )
    expect(host.classifyProviderFailure(new Error("FORBIDDEN"))).toBe(
      "auth_expired"
    )
    expect(host.classifyProviderFailure("session expired")).toBe("auth_expired")
    expect(host.classifyProviderFailure("permission denied by policy")).toBe(
      "provider_error"
    )
    expect(host.classifyProviderFailure(new Error("server returned 500"))).toBe(
      "provider_error"
    )
  })

  it("uses inclusive local date boundaries and rejects invalid timestamps", () => {
    const host = activeTestHost!
    const bounds = host.dateRangeBounds({
      from: "2024-02-29",
      to: "2024-02-29"
    })
    expect(bounds?.valid).toBe(true)
    expect(host.dateRangeBounds(undefined)).toBeNull()
    expect(host.dateRangeBounds({})).toBeNull()
    expect(host.isTimestampInDateRange(0, null)).toBe(true)
    if (!bounds) throw new Error("date range bounds were not created")
    expect(bounds.fromMs).toBe(new Date(2024, 1, 29, 0, 0, 0, 0).getTime())
    expect(bounds.toMs).toBe(new Date(2024, 1, 29, 23, 59, 59, 999).getTime())
    expect(host.isTimestampInDateRange(bounds.fromMs, bounds)).toBe(true)
    expect(host.isTimestampInDateRange(bounds.toMs, bounds)).toBe(true)
    expect(host.isTimestampInDateRange(bounds.fromMs - 1, bounds)).toBe(false)
    expect(host.isTimestampInDateRange(bounds.toMs + 1, bounds)).toBe(false)
    expect(host.isTimestampInDateRange(Number.NaN, bounds)).toBe(false)
    const earlyLeapDay = host.dateRangeBounds({
      from: "0024-02-29",
      to: "0024-02-29"
    })
    expect(earlyLeapDay?.valid).toBe(true)
    if (!earlyLeapDay) throw new Error("early-year leap-day bounds were not created")
    expect(new Date(earlyLeapDay.fromMs).getFullYear()).toBe(24)
    expect(new Date(earlyLeapDay.fromMs).getMonth()).toBe(1)
    expect(new Date(earlyLeapDay.fromMs).getDate()).toBe(29)
    expect(
      host.dateRangeBounds({ from: "2024-02-30", to: "2024-03-01" })?.valid
    ).toBe(false)
    for (const value of [
      "prefix-2024-02-29",
      "2024-02-29-suffix",
      "2024-02-29-2025-01-01",
      "2024-13-01",
      "0024-02-30",
      { toString: () => "2024-02-29" } as unknown as string,
      20240229 as unknown as string
    ]) {
      expect(host.dateRangeBounds({ from: value })?.valid).toBe(false)
    }
    expect(
      host.dateRangeBounds({ from: "2024-03-02", to: "2024-03-01" })?.valid
    ).toBe(false)
    const fromOnly = host.dateRangeBounds({ from: "2024-02-29" })
    const toOnly = host.dateRangeBounds({ to: "2024-02-29" })
    expect(fromOnly?.fromMs).toBe(bounds.fromMs)
    expect(fromOnly?.toMs).toBe(Number.POSITIVE_INFINITY)
    expect(toOnly?.fromMs).toBe(Number.NEGATIVE_INFINITY)
    expect(toOnly?.toMs).toBe(bounds.toMs)
    expect(
      host.isTimestampInDateRange(100, {
        fromMs: 0,
        toMs: 200,
        valid: false
      })
    ).toBe(false)
  })


  it("rejects the Apia date skipped by the international date-line transition", () => {
    const host = activeTestHost!
    const isPacificApia =
      Intl.DateTimeFormat().resolvedOptions().timeZone === "Pacific/Apia"
    const nativeGetDate = Date.prototype.getDate
    const nativeGetMonth = Date.prototype.getMonth
    const nativeGetFullYear = Date.prototype.getFullYear
    const simulatedGap = isPacificApia
      ? undefined
      : vi.spyOn(Date.prototype, "getDate").mockImplementation(function (this: Date) {
          const day = nativeGetDate.call(this)
          return day === 30 &&
            nativeGetMonth.call(this) === 11 &&
            nativeGetFullYear.call(this) === 2011
            ? 31
            : day
        })

    try {
      expect(host.dateRangeBounds({ from: "2011-12-30" })?.valid).toBe(false)
    } finally {
      simulatedGap?.mockRestore()
    }
  })

  it("cancels abort-aware promises and delays with AbortError semantics", async () => {
    const host = activeTestHost!
    const abortError = host.createAbortError()
    expect(abortError.name).toBe("AbortError")
    expect(abortError.message).toBe("The operation was aborted.")

    const controller = new AbortController()
    expect(() => host.throwIfAborted(controller.signal)).not.toThrow()
    controller.abort()
    expect(() => host.throwIfAborted(controller.signal)).toThrow(
      "The operation was aborted."
    )
    await expect(host.withAbort(Promise.resolve("done"))).resolves.toBe("done")

    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await expect(
      host.withAbort(Promise.resolve("ignored"), alreadyAborted.signal)
    ).rejects.toMatchObject({ name: "AbortError" })

    const pendingAbort = new AbortController()
    const pending = host.withAbort(
      new Promise<string>(() => {}),
      pendingAbort.signal
    )
    pendingAbort.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })

    const providerFailure = new Error("network failed")
    await expect(
      host.withAbort(Promise.reject(providerFailure), undefined)
    ).rejects.toBe(providerFailure)

    vi.useFakeTimers()
    try {
      const resolvedSignal = new AbortController()
      const resolvedCleanup = vi.spyOn(
        resolvedSignal.signal,
        "removeEventListener"
      )
      await expect(
        host.withAbort(Promise.resolve("done"), resolvedSignal.signal)
      ).resolves.toBe("done")
      expect(resolvedCleanup).toHaveBeenCalledWith(
        "abort",
        expect.any(Function)
      )
      const rejectedSignal = new AbortController()
      const rejectedCleanup = vi.spyOn(
        rejectedSignal.signal,
        "removeEventListener"
      )
      const providerFailure = new Error("provider request failed")
      await expect(
        host.withAbort(Promise.reject(providerFailure), rejectedSignal.signal)
      ).rejects.toBe(providerFailure)
      expect(rejectedCleanup).toHaveBeenCalledWith(
        "abort",
        expect.any(Function)
      )

      const immediateDelay = host.delay(0)
      expect(vi.getTimerCount()).toBe(0)
      await expect(immediateDelay).resolves.toBeUndefined()
      const negativeDelay = host.delay(-10)
      expect(vi.getTimerCount()).toBe(0)
      await expect(negativeDelay).resolves.toBeUndefined()
      const invalidDelay = host.delay(Number.NaN)
      expect(vi.getTimerCount()).toBe(0)
      await expect(invalidDelay).resolves.toBeUndefined()

      const noSignalDelay = host.delay(50)
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(50)
      await expect(noSignalDelay).resolves.toBeUndefined()

      const completedDelayController = new AbortController()
      const completedDelayCleanup = vi.spyOn(
        completedDelayController.signal,
        "removeEventListener"
      )
      const completedDelay = host.delay(50, completedDelayController.signal)
      await vi.advanceTimersByTimeAsync(50)
      await expect(completedDelay).resolves.toBeUndefined()
      expect(completedDelayCleanup).toHaveBeenCalledWith(
        "abort",
        expect.any(Function)
      )

      const delayAbort = new AbortController()
      const removeListener = vi.spyOn(delayAbort.signal, "removeEventListener")
      const delayed = host.delay(50, delayAbort.signal)
      expect(vi.getTimerCount()).toBe(1)
      delayAbort.abort()
      await expect(delayed).rejects.toMatchObject({ name: "AbortError" })
      expect(vi.getTimerCount()).toBe(0)
      expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function))

      const alreadyAbortedDelay = new AbortController()
      alreadyAbortedDelay.abort()
      expect(() => host.delay(50, alreadyAbortedDelay.signal)).toThrow(
        "The operation was aborted."
      )
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })
})

describe("provider command-host retrieval cache and budget oracles", () => {
  const maxItemBytes = 25 * 1024 * 1024
  const maxReviewBytes = 100 * 1024 * 1024
  const resource = (host: ProviderCommandHost) =>
    (host as any).originalMediaRetrieval as {
      rememberResource: (
        provider: string,
        sessionId: string,
        scopeFingerprint: string,
        mediaKey: string,
        value: unknown
      ) => boolean
      getResource: (
        provider: string,
        sessionId: string,
        scopeFingerprint: string,
        mediaKey: string,
        refresh?: boolean
      ) => unknown
      isCurrentResource: (
        provider: string,
        sessionId: string,
        scopeFingerprint: string,
        mediaKey: string,
        value: unknown
      ) => boolean
      clearResources: (provider?: string) => void
      reserveBudget: (input: Record<string, unknown>) => any
      consumeChunk: (reservation: any, byteLength: number) => boolean
      accountResult: (reservation: any, byteLength: number) => void
      releaseBudget: (reservation: any) => void
      reset: () => void
    }

  async function activateScope(
    host: ProviderCommandHost,
    provider: string,
    scopeFingerprint: string
  ) {
    await sendSessionCommand(
      "getAllMediaItems",
      host.providerSessionId,
      provider,
      scopeFingerprint
    )
  }

  function expectPolicyError(
    action: () => unknown,
    code: string,
    message: string
  ) {
    let error: unknown
    try {
      action()
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code, message })
  }

  function reservationInput(
    host: ProviderCommandHost,
    provider: string,
    scopeFingerprint: string,
    overrides: Record<string, unknown> = {}
  ) {
    return {
      provider,
      sessionId: host.providerSessionId,
      scopeFingerprint,
      maxBytes: 8,
      aggregateBudgetBytes: 16,
      maxBudgetScopes: 10,
      ...overrides
    }
  }

  it("binds cached resources to the current session and scope, replaces by key, and clears only one provider", async () => {
    const host = activeTestHost!
    const cache = resource(host)
    const scope = "cache-membership-scope"
    const current = { mediaKey: "same-key", mediaKind: "photo" }
    const replacement = { mediaKey: "same-key", mediaKind: "video" }
    await activateScope(host, "google", scope)

    expect(cache.rememberResource("google", host.providerSessionId, scope, "same-key", current)).toBe(true)
    expect(cache.rememberResource("google", "stale-session", scope, "foreign", current)).toBe(false)
    expect(cache.rememberResource("google", host.providerSessionId, "stale-scope", "foreign", current)).toBe(false)
    expect(cache.rememberResource("google", host.providerSessionId, scope, "", current)).toBe(false)
    expect(cache.rememberResource("google", host.providerSessionId, scope, "function-value", () => undefined)).toBe(false)
    expect(cache.getResource("google", "stale-session", scope, "same-key")).toBeUndefined()
    expect(cache.getResource("google", host.providerSessionId, "stale-scope", "same-key")).toBeUndefined()

    expect(cache.rememberResource("google", host.providerSessionId, scope, "same-key", replacement)).toBe(true)
    expect(cache.getResource("google", host.providerSessionId, scope, "same-key")).toBe(replacement)
    cache.rememberResource("amazon", host.providerSessionId, scope, "amazon-key", { owner: "amazon" })
    cache.clearResources("google")
    expect(cache.getResource("google", host.providerSessionId, scope, "same-key")).toBeUndefined()
    expect(cache.getResource("amazon", host.providerSessionId, scope, "amazon-key")).toEqual({ owner: "amazon" })
    cache.clearResources()
    expect(cache.getResource("amazon", host.providerSessionId, scope, "amazon-key")).toBeUndefined()

    const previousScope = "cache-previous-scope"
    const currentScope = "cache-current-scope"
    const previousResource = { id: "previous-scope-resource" }
    const currentResource = { id: "current-scope-resource" }
    await activateScope(host, "google", previousScope)
    expect(
      cache.rememberResource(
        "google",
        host.providerSessionId,
        previousScope,
        "previous-item",
        previousResource
      )
    ).toBe(true)
    await activateScope(host, "google", currentScope)
    expect(
      cache.rememberResource(
        "google",
        host.providerSessionId,
        currentScope,
        "current-item",
        currentResource
      )
    ).toBe(true)
    expect(
      cache.getResource("google", host.providerSessionId, previousScope, "previous-item")
    ).toBeUndefined()
    expect(
      cache.isCurrentResource(
        "google",
        host.providerSessionId,
        previousScope,
        "previous-item",
        previousResource
      )
    ).toBe(false)
    expect(
      cache.getResource("google", host.providerSessionId, currentScope, "current-item")
    ).toBe(currentResource)
  })

  it("rejects malformed cache keys and values and invalidates replaced resources safely", async () => {
    const host = activeTestHost!
    const cache = resource(host)
    const scope = "cache-malformed-values-scope"
    const current = { mediaKey: "same-key", version: 1 }
    const replacement = { mediaKey: "same-key", version: 2 }
    await activateScope(host, "google", scope)

    expect(cache.rememberResource("google", host.providerSessionId, scope, "same-key", current)).toBe(true)
    expect(cache.isCurrentResource("google", host.providerSessionId, scope, "same-key", current)).toBe(true)
    expect(cache.rememberResource("google", host.providerSessionId, scope, 17 as unknown as string, { invalid: "number-key" })).toBe(false)
    expect(cache.rememberResource("google", host.providerSessionId, scope, null as unknown as string, { invalid: "null-key" })).toBe(false)
    expect(cache.rememberResource("google", host.providerSessionId, scope, undefined as unknown as string, { invalid: "undefined-key" })).toBe(false)
    expect(cache.rememberResource("google", host.providerSessionId, scope, "null-resource", null)).toBe(false)
    expect(cache.rememberResource("google", host.providerSessionId, scope, "undefined-resource", undefined)).toBe(false)
    expect(cache.rememberResource("google", host.providerSessionId, scope, "primitive-resource", "not-an-object")).toBe(false)
    expect(cache.getResource("google", host.providerSessionId, scope, 17 as unknown as string)).toBeUndefined()
    expect(cache.getResource("google", host.providerSessionId, scope, null as unknown as string)).toBeUndefined()
    expect(cache.getResource("google", host.providerSessionId, scope, undefined as unknown as string)).toBeUndefined()
    const objectKeyAlias = { toJSON: () => "same-key" } as unknown as string
    expect(cache.getResource("google", host.providerSessionId, scope, objectKeyAlias)).toBeUndefined()
    expect(cache.getResource("google", host.providerSessionId, scope, "same-key")).toBe(current)

    expect(cache.rememberResource("google", host.providerSessionId, scope, "same-key", replacement)).toBe(true)
    expect(cache.isCurrentResource("google", host.providerSessionId, scope, "same-key", current)).toBe(false)
    expect(cache.isCurrentResource("google", host.providerSessionId, scope, "same-key", replacement)).toBe(true)
    cache.clearResources("google")
    expect(cache.isCurrentResource("google", host.providerSessionId, scope, "same-key", replacement)).toBe(false)
  })

  it("expires old cache entries and evicts the least-recently-used key at capacity", async () => {
    const host = activeTestHost!
    const cache = resource(host)
    const scope = "cache-expiry-and-capacity-scope"
    await activateScope(host, "google", scope)

    const originalNow = Date.now()
    vi.useFakeTimers()
    try {
      vi.setSystemTime(originalNow)
      cache.rememberResource("google", host.providerSessionId, scope, "expires", { id: "expires" })
      vi.setSystemTime(originalNow + 15 * 60 * 1000)
      expect(cache.getResource("google", host.providerSessionId, scope, "expires")).toEqual({ id: "expires" })
      vi.setSystemTime(originalNow + 15 * 60 * 1000 + 1)
      expect(cache.getResource("google", host.providerSessionId, scope, "expires")).toBeUndefined()
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }

    cache.reset()
    for (let index = 0; index < 10_000; index += 1) {
      cache.rememberResource("google", host.providerSessionId, scope, `resource-${index}`, { index })
    }
    expect(cache.getResource("google", host.providerSessionId, scope, "resource-0")).toEqual({ index: 0 })
    cache.rememberResource("google", host.providerSessionId, scope, "resource-10000", { index: 10000 })
    expect(cache.getResource("google", host.providerSessionId, scope, "resource-0")).toEqual({ index: 0 })
    expect(cache.getResource("google", host.providerSessionId, scope, "resource-1")).toBeUndefined()
    expect(cache.getResource("google", host.providerSessionId, scope, "resource-10000")).toEqual({ index: 10000 })

    const replacement = { index: 2, version: "refreshed" }
    cache.rememberResource("google", host.providerSessionId, scope, "resource-2", replacement)
    cache.rememberResource("google", host.providerSessionId, scope, "resource-10001", { index: 10001 })
    expect(cache.getResource("google", host.providerSessionId, scope, "resource-2")).toBe(replacement)
    expect(cache.getResource("google", host.providerSessionId, scope, "resource-3")).toBeUndefined()

    cache.reset()
    for (let index = 0; index < 10_000; index += 1) {
      cache.rememberResource("google", host.providerSessionId, scope, `unrefreshed-${index}`, { index })
    }
    expect(cache.getResource("google", host.providerSessionId, scope, "unrefreshed-0", false)).toEqual({ index: 0 })
    cache.rememberResource("google", host.providerSessionId, scope, "unrefreshed-10000", { index: 10000 })
    expect(cache.getResource("google", host.providerSessionId, scope, "unrefreshed-0")).toBeUndefined()
    expect(cache.getResource("google", host.providerSessionId, scope, "unrefreshed-1")).toEqual({ index: 1 })
  })

  it("preserves provider-specific policy codes and messages at invalid boundaries", async () => {
    const host = activeTestHost!
    const cache = resource(host)
    const labels = [
      ["amazon", "Amazon Photos"],
      ["google", "Google Photos"],
      ["icloud", "iCloud"]
    ] as const

    for (const [provider, label] of labels) {
      const scope = `invalid-item-limit-${provider}`
      await activateScope(host, provider, scope)
      expectPolicyError(
        () => cache.reserveBudget(reservationInput(host, provider, scope, { maxBytes: 0 })),
        "invalid-item-limit",
        `The ${label} original byte limit must be between 1 byte and 25 MiB.`
      )
      expectPolicyError(
        () => cache.reserveBudget(reservationInput(host, provider, scope, { aggregateBudgetBytes: 0 })),
        "invalid-review-limit",
        `The ${label} review byte budget must be between 1 byte and 100 MiB.`
      )
      expectPolicyError(
        () => cache.reserveBudget(reservationInput(host, provider, scope, { aggregateBudgetBytes: maxReviewBytes + 1 })),
        "invalid-review-limit",
        `The ${label} review byte budget must be between 1 byte and 100 MiB.`
      )
    }

    const unknownProviderScope = "unknown-provider-policy-scope"
    await activateScope(host, "other", unknownProviderScope)
    expectPolicyError(
      () => cache.reserveBudget(reservationInput(host, "other", unknownProviderScope, { maxBytes: 0 })),
      "invalid-item-limit",
      "The Photo Provider original byte limit must be between 1 byte and 25 MiB."
    )

    const amazonScope = "amazon-budget-policy-scope"
    await activateScope(host, "amazon", amazonScope)
    const first = cache.reserveBudget(reservationInput(host, "amazon", amazonScope, { aggregateBudgetBytes: 16 }))
    cache.releaseBudget(first)
    expectPolicyError(
      () => cache.reserveBudget(reservationInput(host, "amazon", amazonScope, { aggregateBudgetBytes: 15 })),
      "review-limit-changed",
      "The Amazon Photos review byte budget cannot change after hashing begins."
    )

    expectPolicyError(
      () => cache.reserveBudget(reservationInput(host, "google", "not-current-scope")),
      "stale-scope",
      "Original media retrieval must match the current provider session and scan scope."
    )
  })

  it("asserts provider-specific budget-change, scope-capacity, and known-size messages", async () => {
    const host = activeTestHost!
    const cache = resource(host)
    const labels = [
      ["amazon", "Amazon Photos"],
      ["google", "Google Photos"],
      ["icloud", "iCloud"]
    ] as const

    for (const [provider, label] of labels) {
      cache.reset()
      const firstScope = `scope-capacity-first-${provider}`
      await activateScope(host, provider, firstScope)
      const firstScopeReservation = cache.reserveBudget(
        reservationInput(host, provider, firstScope, { maxBudgetScopes: 1 })
      )
      cache.releaseBudget(firstScopeReservation)
      const secondScope = `scope-capacity-second-${provider}`
      await activateScope(host, provider, secondScope)
      expectPolicyError(
        () => cache.reserveBudget(reservationInput(host, provider, secondScope, { maxBudgetScopes: 1 })),
        "scope-capacity",
        `Too many ${label} review scopes are active in this page session.`
      )

      cache.reset()
      const budgetScope = `review-limit-changed-${provider}`
      await activateScope(host, provider, budgetScope)
      const initialReservation = cache.reserveBudget(
        reservationInput(host, provider, budgetScope, { aggregateBudgetBytes: 16 })
      )
      cache.releaseBudget(initialReservation)
      expectPolicyError(
        () => cache.reserveBudget(reservationInput(host, provider, budgetScope, { aggregateBudgetBytes: 15 })),
        "review-limit-changed",
        provider === "amazon"
          ? "The Amazon Photos review byte budget cannot change after hashing begins."
          : `The ${label} review byte budget changed. Start a new review before retrieving originals.`
      )
    }

    cache.reset()
    const googleScope = "google-known-size-message-scope"
    await activateScope(host, "google", googleScope)
    expectPolicyError(
      () => cache.reserveBudget(reservationInput(host, "google", googleScope, {
        maxBytes: 1,
        aggregateBudgetBytes: 8,
        resourceSize: 2
      })),
      "original-exceeds-budget",
      "The Google Photos original exceeds the remaining approved byte budget."
    )
  })

  it("enforces byte and scope limits while accepting exact valid reservation boundaries", async () => {
    const host = activeTestHost!
    const cache = resource(host)
    const scope = "valid-budget-boundaries-scope"
    await activateScope(host, "amazon", scope)
    const oneByte = cache.reserveBudget(
      reservationInput(host, "amazon", scope, {
        maxBytes: 1,
        aggregateBudgetBytes: 1,
        resourceSize: 1,
        reserveKnownResourceSize: true
      })
    )
    expect(oneByte.reservedBytes).toBe(1)
    cache.accountResult(oneByte, 1)

    cache.reset()
    const maximum = cache.reserveBudget(
      reservationInput(host, "amazon", scope, {
        maxBytes: maxItemBytes,
        aggregateBudgetBytes: maxReviewBytes
      })
    )
    expect(maximum.reservedBytes).toBe(maxItemBytes)
    cache.releaseBudget(maximum)
    expectPolicyError(
      () =>
        cache.reserveBudget(
          reservationInput(host, "amazon", scope, {
            maxBytes: maxItemBytes + 1,
            aggregateBudgetBytes: maxReviewBytes
          })
        ),
      "invalid-item-limit",
      "The Amazon Photos original byte limit must be between 1 byte and 25 MiB."
    )

    cache.reset()
    const filled = cache.reserveBudget(
      reservationInput(host, "amazon", scope, {
        maxBytes: 8,
        aggregateBudgetBytes: 10,
        resourceSize: 4,
        reserveKnownResourceSize: true
      })
    )
    expect(filled.reservedBytes).toBe(4)
    const remaining = cache.reserveBudget(
      reservationInput(host, "amazon", scope, {
        maxBytes: 8,
        aggregateBudgetBytes: 10
      })
    )
    expect(filled.reservedBytes + remaining.reservedBytes).toBe(10)
    expect(remaining.reservedBytes).toBeLessThanOrEqual(remaining.maxBytes)
    expectPolicyError(
      () => cache.reserveBudget(reservationInput(host, "amazon", scope, { maxBytes: 1, aggregateBudgetBytes: 10 })),
      "review-budget-exhausted",
      "The Amazon Photos review has reached its 100 MiB original-fetch budget."
    )

    const oversizeScope = "known-resource-size-overrun-scope"
    await activateScope(host, "amazon", oversizeScope)
    expectPolicyError(
      () => cache.reserveBudget(reservationInput(host, "amazon", oversizeScope, { maxBytes: 1, aggregateBudgetBytes: 4, resourceSize: 2 })),
      "original-exceeds-budget",
      "The Amazon Photos original exceeds the remaining review byte budget."
    )

    const emptyGoogleScope = "google-empty-original-scope"
    await activateScope(host, "google", emptyGoogleScope)
    expectPolicyError(
      () => cache.reserveBudget(reservationInput(host, "google", emptyGoogleScope, { provider: "google", resourceSize: 0 })),
      "empty-original",
      "Google Photos did not report a nonempty original file size."
    )

    const nonemptyGoogleScope = "google-nonempty-original-scope"
    await activateScope(host, "google", nonemptyGoogleScope)
    const nonemptyGoogleReservation = cache.reserveBudget(
      reservationInput(host, "google", nonemptyGoogleScope, {
        maxBytes: 8,
        aggregateBudgetBytes: 16,
        resourceSize: 4,
        reserveKnownResourceSize: true
      })
    )
    expect(nonemptyGoogleReservation.reservedBytes).toBe(4)
    cache.releaseBudget(nonemptyGoogleReservation)

    const zeroKnownSizeScope = "amazon-zero-known-size-scope"
    await activateScope(host, "amazon", zeroKnownSizeScope)
    expectPolicyError(
      () =>
        cache.reserveBudget(
          reservationInput(host, "amazon", zeroKnownSizeScope, {
            resourceSize: 0,
            reserveKnownResourceSize: true
          })
        ),
      "review-budget-exhausted",
      "The Amazon Photos review has reached its 100 MiB original-fetch budget."
    )

    const firstScope = "scope-capacity-first"
    cache.reset()
    await activateScope(host, "amazon", firstScope)
    const scoped = cache.reserveBudget(reservationInput(host, "amazon", firstScope, { maxBudgetScopes: 1 }))
    cache.releaseBudget(scoped)
    const secondScope = "scope-capacity-second"
    await activateScope(host, "amazon", secondScope)
    expectPolicyError(
      () => cache.reserveBudget(reservationInput(host, "amazon", secondScope, { maxBudgetScopes: 1 })),
      "scope-capacity",
      "Too many Amazon Photos review scopes are active in this page session."
    )
  })

  it("reserves the requested limit when a known size is supplied without the opt-in flag", async () => {
    const host = activeTestHost!
    const cache = resource(host)
    const scope = "known-size-without-explicit-reservation-scope"
    await activateScope(host, "amazon", scope)

    const reservation = cache.reserveBudget(
      reservationInput(host, "amazon", scope, {
        maxBytes: 8,
        aggregateBudgetBytes: 16,
        resourceSize: 4
      })
    )
    expect(reservation.reservedBytes).toBe(8)
    expect(reservation.maxBytes).toBe(8)
    cache.releaseBudget(reservation)
  })

  it("accounts exact chunks, partial results, overruns, and reservation cleanup without releasing another item", async () => {
    const host = activeTestHost!
    const cache = resource(host)
    const scope = "chunk-accounting-scope"
    await activateScope(host, "amazon", scope)
    const first = cache.reserveBudget(reservationInput(host, "amazon", scope, { maxBytes: 4, aggregateBudgetBytes: 8 }))
    const second = cache.reserveBudget(reservationInput(host, "amazon", scope, { maxBytes: 4, aggregateBudgetBytes: 8 }))

    expect(first.budget.limitBytes).toBe(8)
    expect(cache.consumeChunk(first, 2)).toBe(true)
    expect(cache.consumeChunk(first, 2)).toBe(true)
    expect(first.budget.limitBytes).toBe(8)
    expect(first.budget).toMatchObject({ bytesRead: 4, bytesReserved: 4 })
    cache.releaseBudget(first)
    expect(first.budget.bytesReserved).toBe(4)
    cache.accountResult(second, 3)
    expect(second.budget).toMatchObject({ bytesRead: 7, bytesReserved: 0 })

    const unknownResultScope = "chunk-unknown-result-scope"
    await activateScope(host, "amazon", unknownResultScope)
    const unknownResult = cache.reserveBudget(
      reservationInput(host, "amazon", unknownResultScope, {
        maxBytes: 4,
        aggregateBudgetBytes: 8
      })
    )
    const remainingReservation = cache.reserveBudget(
      reservationInput(host, "amazon", unknownResultScope, {
        maxBytes: 4,
        aggregateBudgetBytes: 8
      })
    )
    cache.accountResult(unknownResult, undefined as unknown as number)
    expect(unknownResult.budget).toMatchObject({ bytesRead: 4, bytesReserved: 4 })
    expect(unknownResult).toMatchObject({ bytesConsumed: 4, reservedBytes: 0 })
    expect(remainingReservation.reservedBytes).toBe(4)
    expect(remainingReservation.budget.bytesReserved).toBe(4)
    cache.releaseBudget(remainingReservation)

    const overrunScope = "chunk-overrun-scope"
    await activateScope(host, "amazon", overrunScope)
    const overrun = cache.reserveBudget(reservationInput(host, "amazon", overrunScope, { maxBytes: 4, aggregateBudgetBytes: 8 }))
    const protectedReservation = cache.reserveBudget(reservationInput(host, "amazon", overrunScope, { maxBytes: 4, aggregateBudgetBytes: 8 }))
    expect(cache.consumeChunk(overrun, 5)).toBe(false)
    expect(overrun.budget).toMatchObject({ bytesRead: 5, bytesReserved: 4 })
    expect(overrun).toMatchObject({ bytesConsumed: 5, reservedBytes: 0 })
    expect(cache.consumeChunk(overrun, 0)).toBe(false)
    expect(overrun.budget).toMatchObject({ bytesRead: 5, bytesReserved: 4 })
    cache.releaseBudget(overrun)
    expect(protectedReservation.budget.bytesReserved).toBe(4)

    const knownSizeOverrunScope = "known-size-chunk-overrun-scope"
    await activateScope(host, "amazon", knownSizeOverrunScope)
    const knownSizeOverrun = cache.reserveBudget(
      reservationInput(host, "amazon", knownSizeOverrunScope, {
        maxBytes: 8,
        aggregateBudgetBytes: 16,
        resourceSize: 4,
        reserveKnownResourceSize: true
      })
    )
    expect(knownSizeOverrun.reservedBytes).toBe(4)
    expect(cache.consumeChunk(knownSizeOverrun, 5)).toBe(false)
    cache.releaseBudget(knownSizeOverrun)

    const releasedReservationScope = "released-known-size-chunk-scope"
    await activateScope(host, "amazon", releasedReservationScope)
    const releasedKnownSize = cache.reserveBudget(
      reservationInput(host, "amazon", releasedReservationScope, {
        maxBytes: 8,
        aggregateBudgetBytes: 16,
        resourceSize: 4,
        reserveKnownResourceSize: true
      })
    )
    expect(releasedKnownSize.reservedBytes).toBe(4)
    expect(releasedKnownSize.maxBytes).toBe(4)
    cache.releaseBudget(releasedKnownSize)
    expect(cache.consumeChunk(releasedKnownSize, 1)).toBe(false)
  })

  it("rejects mutated and copied reservations without changing their budget", async () => {
    const host = activeTestHost!
    const cache = resource(host)
    const scope = "immutable-reservation-accounting-scope"
    await activateScope(host, "amazon", scope)
    const reservation = cache.reserveBudget(
      reservationInput(host, "amazon", scope, {
        maxBytes: 4,
        aggregateBudgetBytes: 8
      })
    )
    const protectedReservation = cache.reserveBudget(
      reservationInput(host, "amazon", scope, {
        maxBytes: 4,
        aggregateBudgetBytes: 8
      })
    )

    const budgetView = reservation.budget
    expect(reservation.key).toBe(
      JSON.stringify(["amazon", host.providerSessionId, scope])
    )
    expect(reservation.budget).toBe(budgetView)
    expect(protectedReservation.budget).toBe(budgetView)
    expect(Object.keys(reservation)).toEqual([
      "key",
      "budget",
      "maxBytes",
      "reservedBytes",
      "bytesConsumed"
    ])
    for (const property of [
      "key",
      "budget",
      "maxBytes",
      "reservedBytes",
      "bytesConsumed"
    ]) {
      expect(Object.getOwnPropertyDescriptor(reservation, property)).toMatchObject({
        configurable: false,
        enumerable: true,
        get: expect.any(Function),
        set: undefined
      })
    }
    expect(Object.keys(budgetView)).toEqual([
      "limitBytes",
      "bytesRead",
      "bytesReserved"
    ])
    for (const property of ["limitBytes", "bytesRead", "bytesReserved"]) {
      expect(Object.getOwnPropertyDescriptor(budgetView, property)).toMatchObject({
        configurable: false,
        enumerable: true,
        get: expect.any(Function),
        set: undefined
      })
    }
    expect(Object.isFrozen(reservation)).toBe(true)
    expect(Object.isFrozen(reservation.budget)).toBe(true)
    expect(Reflect.set(reservation, "reservedBytes", 100)).toBe(false)
    expect(Reflect.set(reservation, "maxBytes", 100)).toBe(false)
    expect(Reflect.set(reservation.budget, "bytesReserved", 0)).toBe(false)

    expect(cache.consumeChunk(reservation, 2)).toBe(true)
    expect(reservation).toMatchObject({ bytesConsumed: 2, reservedBytes: 2 })
    const forgedReservation = {
      ...reservation,
      maxBytes: 100,
      reservedBytes: 100,
      bytesConsumed: 0
    }
    expect(cache.consumeChunk(forgedReservation, 100)).toBe(false)
    cache.accountResult(forgedReservation, 100)
    cache.releaseBudget(forgedReservation)
    expect(reservation.budget).toMatchObject({ bytesRead: 2, bytesReserved: 6 })

    cache.releaseBudget(reservation)
    cache.releaseBudget(protectedReservation)
    expect(reservation.budget).toMatchObject({ bytesRead: 2, bytesReserved: 0 })
  })


  it("prioritizes exhausted review budget over known item size when no bytes remain", async () => {
    const host = activeTestHost!
    const cache = resource(host)
    const scope = "known-item-after-review-budget-is-full"
    await activateScope(host, "google", scope)

    for (let item = 0; item < 4; item += 1) {
      const reservation = cache.reserveBudget(
        reservationInput(host, "google", scope, {
          maxBytes: maxItemBytes,
          aggregateBudgetBytes: maxReviewBytes
        })
      )
      cache.accountResult(reservation, maxItemBytes)
    }

    expectPolicyError(
      () => cache.reserveBudget(
        reservationInput(host, "google", scope, {
          maxBytes: maxItemBytes,
          aggregateBudgetBytes: maxReviewBytes,
          resourceSize: 1,
          reserveKnownResourceSize: true
        })
      ),
      "review-budget-exhausted",
      "The Google Photos review has reached its 100 MiB original-fetch budget."
    )
  })

  it("charges invalid result lengths fully and counts a valid positive result once through the page-world API", async () => {
    const host = activeTestHost!
    const cache = resource(host)
    const validScope = "valid-page-world-result-accounting-scope"
    await activateScope(host, "google", validScope)

    const validReservation = cache.reserveBudget(
      reservationInput(host, "google", validScope, {
        maxBytes: 4,
        aggregateBudgetBytes: 8
      })
    )
    cache.accountResult(validReservation, 3)
    cache.accountResult(validReservation, 3)
    expect(validReservation.budget).toMatchObject({ bytesRead: 3, bytesReserved: 0 })
    expect(validReservation).toMatchObject({ bytesConsumed: 3, reservedBytes: 0 })
    const remaining = cache.reserveBudget(
      reservationInput(host, "google", validScope, {
        maxBytes: 5,
        aggregateBudgetBytes: 8
      })
    )
    expect(remaining.reservedBytes).toBe(5)
    cache.releaseBudget(remaining)

    for (const byteLength of [-4, 0]) {
      const scope = `invalid-page-world-result-accounting-${byteLength}`
      await activateScope(host, "google", scope)
      const reservation = cache.reserveBudget(
        reservationInput(host, "google", scope, {
          maxBytes: 4,
          aggregateBudgetBytes: 4
        })
      )
      cache.accountResult(reservation, byteLength)

      expect(reservation.budget).toMatchObject({ bytesRead: 4, bytesReserved: 0 })
      expect(reservation).toMatchObject({ bytesConsumed: 4, reservedBytes: 0 })
      expectPolicyError(
        () => cache.reserveBudget(
          reservationInput(host, "google", scope, {
            maxBytes: 1,
            aggregateBudgetBytes: 4
          })
        ),
        "review-budget-exhausted",
        "The Google Photos review has reached its 100 MiB original-fetch budget."
      )
    }
  })

  it("accepts zero-byte chunks and safely resets and releases live reservations", async () => {
    const host = activeTestHost!
    const cache = resource(host)
    const scope = "zero-chunk-and-live-reset-scope"
    await activateScope(host, "amazon", scope)

    const zeroChunkReservation = cache.reserveBudget(
      reservationInput(host, "amazon", scope, { maxBytes: 4, aggregateBudgetBytes: 16 })
    )
    expect(zeroChunkReservation.budget).toMatchObject({ bytesRead: 0, bytesReserved: 4 })
    expect(cache.consumeChunk(undefined as unknown as object, 0)).toBe(false)
    expect(cache.consumeChunk(zeroChunkReservation, -1)).toBe(false)
    expect(() => cache.accountResult(undefined as unknown as object, 4)).not.toThrow()
    expect(() => cache.releaseBudget(undefined as unknown as object)).not.toThrow()
    expect(cache.consumeChunk(zeroChunkReservation, 0)).toBe(true)
    expect(zeroChunkReservation.budget).toMatchObject({ bytesRead: 0, bytesReserved: 4 })

    cache.releaseBudget(zeroChunkReservation)
    expect(zeroChunkReservation.budget).toMatchObject({ bytesRead: 0, bytesReserved: 0 })
    const liveReservation = cache.reserveBudget(
      reservationInput(host, "amazon", scope, { maxBytes: 8, aggregateBudgetBytes: 16 })
    )
    expect(liveReservation.budget).toMatchObject({ bytesRead: 0, bytesReserved: 8 })

    cache.reset()
    const replacementReservation = cache.reserveBudget(
      reservationInput(host, "amazon", scope, { maxBytes: 8, aggregateBudgetBytes: 16 })
    )
    expect(cache.consumeChunk(liveReservation, 1)).toBe(false)
    cache.accountResult(liveReservation, 4)
    cache.releaseBudget(liveReservation)
    expect(replacementReservation.budget).toMatchObject({ bytesRead: 0, bytesReserved: 8 })

    cache.releaseBudget(replacementReservation)
    expect(replacementReservation.budget).toMatchObject({ bytesRead: 0, bytesReserved: 0 })
  })
})

describe("provider command-host scan scope and cancellation lifecycle oracles", () => {
  async function activateScope(host: ProviderCommandHost, scopeFingerprint: string) {
    await sendSessionCommand("getAllMediaItems", host.providerSessionId, "amazon", scopeFingerprint)
  }

  function dispatchCommand(
    command: string,
    requestId: string,
    args: Record<string, unknown>,
    provider = "amazon"
  ) {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: { app: "GPD", action: "gptkCommand", command, requestId, provider, args }
      })
    )
  }

  async function flushCommandHostMicrotasks() {
    await Promise.resolve()
    await Promise.resolve()
  }

  it("rejects malformed scan-scope fingerprints and aborts only work from an older scope", async () => {
    const host = activeTestHost!
    const postMessage = vi.spyOn(window, "postMessage")
    const invalidScopes: unknown[] = ["", " padded", "padded ", "bad\u0000scope", "s".repeat(513), 17]
    try {
      for (const [index, scope] of invalidScopes.entries()) {
        dispatchCommand(
          "getAllMediaItems",
          `invalid-scan-scope-${index}`,
          { providerSessionId: host.providerSessionId, scanScopeFingerprint: scope as string }
        )
        await flushCommandHostMicrotasks()
        expect(postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            command: "getAllMediaItems",
            requestId: `invalid-scan-scope-${index}`,
            success: false,
            error: expect.stringContaining("scope is missing or invalid")
          }),
          "*"
        )
      }
      expect(mediaItemsHandler).not.toHaveBeenCalled()

      const validBoundary = "v".repeat(512)
      await activateScope(host, validBoundary)
      expect(mediaItemsHandler).toHaveBeenCalledTimes(1)

      const oldScope = "old-review-scope"
      await activateScope(host, oldScope)
      await sendOriginalRetrieval("retrieval-old-scope", host.providerSessionId, oldScope)
      const oldSignal = retrievalHandler.mock.calls.at(-1)?.[2]
      if (!oldSignal) throw new Error("old-scope retrieval did not receive an abort signal")

      const newScope = "new-review-scope"
      await activateScope(host, newScope)
      expect(oldSignal.aborted).toBe(true)

      await sendOriginalRetrieval("retrieval-current-scope", host.providerSessionId, newScope)
      const currentSignal = retrievalHandler.mock.calls.at(-1)?.[2]
      if (!currentSignal) throw new Error("current-scope retrieval did not receive an abort signal")
      await activateScope(host, newScope)
      expect(currentSignal.aborted).toBe(false)
      await activateScope(host, "cleanup-review-scope")
      expect(currentSignal.aborted).toBe(true)
    } finally {
      postMessage.mockRestore()
    }
  })

  it("expires and replaces pending cancellation markers, and delivers an early exact cancel as an already-aborted signal", async () => {
    const host = activeTestHost!
    const scope = "pending-cancel-scope"
    await activateScope(host, scope)
    const postMessage = vi.spyOn(window, "postMessage")
    vi.useFakeTimers()
    try {
      dispatchCommand("cancelProviderRequest", "cancel-before-request", {
        targetRequestId: "replacement-target",
        providerSessionId: host.providerSessionId,
        scanScopeFingerprint: scope
      })
      await flushCommandHostMicrotasks()
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "cancelProviderRequest",
          requestId: "cancel-before-request",
          success: true,
          data: { targetRequestId: "replacement-target", cancelled: true }
        }),
        "*"
      )
      await vi.advanceTimersByTimeAsync(30_000)

      dispatchCommand("cancelProviderRequest", "cancel-before-request-again", {
        targetRequestId: "replacement-target",
        providerSessionId: host.providerSessionId,
        scanScopeFingerprint: scope
      })
      await flushCommandHostMicrotasks()
      await vi.advanceTimersByTimeAsync(30_001)

      dispatchCommand("getOriginalContentHash", "replacement-target", {
        requestId: "replacement-target",
        providerSessionId: host.providerSessionId,
        scanScopeFingerprint: scope,
        userOptIn: true
      })
      await flushCommandHostMicrotasks()
      const replacementSignal = retrievalHandler.mock.calls.at(-1)?.[2]
      if (!replacementSignal) throw new Error("replacement retrieval did not receive an abort signal")
      expect(replacementSignal.aborted).toBe(true)

      dispatchCommand("getOriginalContentHash", "replacement-target", {
        requestId: "replacement-target",
        providerSessionId: host.providerSessionId,
        scanScopeFingerprint: scope,
        userOptIn: true
      })
      await flushCommandHostMicrotasks()
      const repeatedSignal = retrievalHandler.mock.calls.at(-1)?.[2]
      if (!repeatedSignal) throw new Error("reused retrieval did not receive an abort signal")
      expect(repeatedSignal.aborted).toBe(false)

      dispatchCommand("cancelProviderRequest", "cancel-expiring-request", {
        targetRequestId: "expired-target",
        providerSessionId: host.providerSessionId,
        scanScopeFingerprint: scope
      })
      await flushCommandHostMicrotasks()
      await vi.advanceTimersByTimeAsync(60_001)
      dispatchCommand("getOriginalContentHash", "expired-target", {
        requestId: "expired-target",
        providerSessionId: host.providerSessionId,
        scanScopeFingerprint: scope,
        userOptIn: true
      })
      await flushCommandHostMicrotasks()
      const expiredSignal = retrievalHandler.mock.calls.at(-1)?.[2]
      if (!expiredSignal) throw new Error("expired retrieval did not receive an abort signal")
      expect(expiredSignal.aborted).toBe(false)

      dispatchCommand("cancelProviderRequest", "cleanup-expired-target", {
        targetRequestId: "expired-target",
        providerSessionId: host.providerSessionId,
        scanScopeFingerprint: scope
      })
      await flushCommandHostMicrotasks()
      expect(expiredSignal.aborted).toBe(true)
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "cancelProviderRequest", success: true }),
        "*"
      )
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
      postMessage.mockRestore()
    }
  })

  it("does not apply pending or active cancellations across provider, session, or scope identities", async () => {
    const host = activeTestHost!
    const postMessage = vi.spyOn(window, "postMessage")
    const scope = "cancellation-identity-mismatch-scope"
    await host.setProviderIdentity("cancellation-owner-before-mismatch")
    const initialSessionId = host.providerSessionId
    await activateScope(host, scope)

    try {
      const activeProviderTarget = "active-provider-mismatch-target"
      await sendOriginalRetrieval(activeProviderTarget, initialSessionId, scope, "amazon")
      const activeProviderSignal = retrievalHandler.mock.calls.at(-1)?.[2]
      if (!activeProviderSignal) throw new Error("active provider-mismatch retrieval did not start")
      dispatchCommand("cancelProviderRequest", "cancel-active-wrong-provider", {
        targetRequestId: activeProviderTarget,
        providerSessionId: initialSessionId,
        scanScopeFingerprint: scope
      }, "google")
      await flushCommandHostMicrotasks()
      expect(activeProviderSignal.aborted).toBe(false)
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "cancelProviderRequest",
          requestId: "cancel-active-wrong-provider",
          success: true,
          data: { targetRequestId: activeProviderTarget, cancelled: false }
        }),
        "*"
      )
      await sendProviderRetrievalCancellation(
        "cancel-active-provider-exact",
        activeProviderTarget,
        initialSessionId,
        scope,
        "amazon"
      )
      expect(activeProviderSignal.aborted).toBe(true)

      const pendingProviderTarget = "pending-provider-mismatch-target"
      dispatchCommand("cancelProviderRequest", "cancel-pending-wrong-provider", {
        targetRequestId: pendingProviderTarget,
        providerSessionId: initialSessionId,
        scanScopeFingerprint: scope
      }, "google")
      await flushCommandHostMicrotasks()
      await sendOriginalRetrieval(pendingProviderTarget, initialSessionId, scope, "amazon")
      const pendingProviderSignal = retrievalHandler.mock.calls.at(-1)?.[2]
      if (!pendingProviderSignal) throw new Error("pending provider-mismatch retrieval did not start")
      expect(pendingProviderSignal.aborted).toBe(false)
      await sendProviderRetrievalCancellation(
        "cancel-pending-provider-exact",
        pendingProviderTarget,
        initialSessionId,
        scope,
        "amazon"
      )
      expect(pendingProviderSignal.aborted).toBe(true)

      const pendingScopeTarget = "pending-scope-mismatch-target"
      dispatchCommand("cancelProviderRequest", "cancel-pending-wrong-scope", {
        targetRequestId: pendingScopeTarget,
        providerSessionId: initialSessionId,
        scanScopeFingerprint: "different-pending-scope"
      })
      await flushCommandHostMicrotasks()
      await sendOriginalRetrieval(pendingScopeTarget, initialSessionId, scope)
      const pendingScopeSignal = retrievalHandler.mock.calls.at(-1)?.[2]
      if (!pendingScopeSignal) throw new Error("pending scope-mismatch retrieval did not start")
      expect(pendingScopeSignal.aborted).toBe(false)
      await sendProviderRetrievalCancellation(
        "cancel-pending-scope-exact",
        pendingScopeTarget,
        initialSessionId,
        scope
      )
      expect(pendingScopeSignal.aborted).toBe(true)

      const pendingSessionTarget = "pending-session-mismatch-target"
      dispatchCommand("cancelProviderRequest", "cancel-pending-before-session-rotation", {
        targetRequestId: pendingSessionTarget,
        providerSessionId: initialSessionId,
        scanScopeFingerprint: scope
      })
      await flushCommandHostMicrotasks()
      await host.setProviderIdentity("cancellation-owner-after-mismatch")
      const rotatedSessionId = host.providerSessionId
      expect(rotatedSessionId).not.toBe(initialSessionId)
      await activateScope(host, scope)
      await sendOriginalRetrieval(pendingSessionTarget, rotatedSessionId, scope)
      const pendingSessionSignal = retrievalHandler.mock.calls.at(-1)?.[2]
      if (!pendingSessionSignal) throw new Error("pending session-mismatch retrieval did not start")
      expect(pendingSessionSignal.aborted).toBe(false)
      await sendProviderRetrievalCancellation(
        "cancel-pending-session-exact",
        pendingSessionTarget,
        rotatedSessionId,
        scope
      )
      expect(pendingSessionSignal.aborted).toBe(true)
    } finally {
      postMessage.mockRestore()
    }
  })

  it("rejects malformed provider retrieval cancellation arguments with a protocol error", async () => {
    const host = activeTestHost!
    const postMessage = vi.spyOn(window, "postMessage")
    const validScope = "valid-cancellation-validation-scope"
    const validTarget = "valid-cancellation-validation-target"
    const invalidArguments: Array<{
      requestId: string
      args?: Record<string, unknown>
    }> = [
      { requestId: "cancel-missing-args" },
      {
        requestId: "cancel-missing-target",
        args: {
          providerSessionId: host.providerSessionId,
          scanScopeFingerprint: validScope
        }
      },
      {
        requestId: "cancel-non-string-target",
        args: {
          targetRequestId: 17,
          providerSessionId: host.providerSessionId,
          scanScopeFingerprint: validScope
        }
      },
      {
        requestId: "cancel-empty-target",
        args: {
          targetRequestId: "",
          providerSessionId: host.providerSessionId,
          scanScopeFingerprint: validScope
        }
      },
      {
        requestId: "cancel-missing-session",
        args: { targetRequestId: validTarget, scanScopeFingerprint: validScope }
      },
      {
        requestId: "cancel-stale-session",
        args: {
          targetRequestId: validTarget,
          providerSessionId: "stale-provider-session",
          scanScopeFingerprint: validScope
        }
      },
      {
        requestId: "cancel-missing-scope",
        args: { targetRequestId: validTarget, providerSessionId: host.providerSessionId }
      },
      {
        requestId: "cancel-non-string-scope",
        args: {
          targetRequestId: validTarget,
          providerSessionId: host.providerSessionId,
          scanScopeFingerprint: 17 as unknown as string
        }
      },
      {
        requestId: "cancel-empty-scope",
        args: {
          targetRequestId: validTarget,
          providerSessionId: host.providerSessionId,
          scanScopeFingerprint: ""
        }
      }
    ]

    try {
      for (const { requestId, args } of invalidArguments) {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: window,
            data: {
              app: "GPD",
              action: "gptkCommand",
              command: "cancelProviderRequest",
              requestId,
              provider: "amazon",
              ...(args ? { args } : {})
            }
          })
        )
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            command: "cancelProviderRequest",
            requestId,
            success: false,
            error:
              "The media retrieval request session or scan scope changed before cancellation."
          }),
          "*"
        )
      }
    } finally {
      postMessage.mockRestore()
    }
  })

  it("clears a consumed cancellation timer before reusing its request ID", async () => {
    const host = activeTestHost!
    const scope = "consumed-cancellation-timer-scope"
    const targetRequestId = "consumed-cancellation-timer-target"
    await activateScope(host, scope)
    vi.useFakeTimers()

    try {
      dispatchCommand("cancelProviderRequest", "cancel-timer-first", {
        targetRequestId,
        providerSessionId: host.providerSessionId,
        scanScopeFingerprint: scope
      })
      await flushCommandHostMicrotasks()
      await vi.advanceTimersByTimeAsync(10_000)

      dispatchCommand("getOriginalContentHash", targetRequestId, {
        requestId: targetRequestId,
        providerSessionId: host.providerSessionId,
        scanScopeFingerprint: scope,
        userOptIn: true
      })
      await flushCommandHostMicrotasks()
      await vi.advanceTimersByTimeAsync(0)
      const firstSignal = retrievalHandler.mock.calls.at(-1)?.[2]
      if (!firstSignal) throw new Error("first timer-target retrieval did not start")
      expect(firstSignal.aborted).toBe(true)

      dispatchCommand("cancelProviderRequest", "cancel-timer-second", {
        targetRequestId,
        providerSessionId: host.providerSessionId,
        scanScopeFingerprint: scope
      })
      await flushCommandHostMicrotasks()
      await vi.advanceTimersByTimeAsync(50_000)

      dispatchCommand("getOriginalContentHash", targetRequestId, {
        requestId: targetRequestId,
        providerSessionId: host.providerSessionId,
        scanScopeFingerprint: scope,
        userOptIn: true
      })
      await flushCommandHostMicrotasks()
      await vi.advanceTimersByTimeAsync(0)
      const secondSignal = retrievalHandler.mock.calls.at(-1)?.[2]
      if (!secondSignal) throw new Error("second timer-target retrieval did not start")
      expect(secondSignal.aborted).toBe(true)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it("registers an early cancel after a completed request releases its active entry", async () => {
    const host = activeTestHost!
    const scope = "completed-request-cleanup-scope"
    const targetRequestId = "completed-request-cleanup-target"
    await activateScope(host, scope)
    retrievalHandler.mockImplementationOnce(() => Promise.resolve())

    await sendOriginalRetrieval(targetRequestId, host.providerSessionId, scope)
    expect(retrievalHandler).toHaveBeenCalledTimes(1)

    dispatchCommand("cancelProviderRequest", "cancel-after-completion", {
      targetRequestId,
      providerSessionId: host.providerSessionId,
      scanScopeFingerprint: scope
    })
    await flushCommandHostMicrotasks()

    dispatchCommand("getOriginalContentHash", targetRequestId, {
      requestId: targetRequestId,
      providerSessionId: host.providerSessionId,
      scanScopeFingerprint: scope,
      userOptIn: true
    })
    await flushCommandHostMicrotasks()
    const signal = retrievalHandler.mock.calls.at(-1)?.[2]
    if (!signal) throw new Error("retrieval after completion did not start")
    expect(signal.aborted).toBe(true)
  })

  it("keeps a newer active request registered when an older request with the same ID finishes", async () => {
    const host = activeTestHost!
    const scope = "reused-request-id-scope"
    await activateScope(host, scope)
    let finishFirst!: () => void
    retrievalHandler.mockImplementationOnce(
      (_requestId: string, _args: Record<string, unknown>, signal?: AbortSignal) =>
        new Promise<void>((resolve) => {
          finishFirst = resolve
          signal?.addEventListener("abort", () => resolve(), { once: true })
        })
    )

    await sendOriginalRetrieval("reused-provider-request", host.providerSessionId, scope)
    const firstSignal = retrievalHandler.mock.calls.at(-1)?.[2]
    await sendOriginalRetrieval("reused-provider-request", host.providerSessionId, scope)
    const secondSignal = retrievalHandler.mock.calls.at(-1)?.[2]
    if (!firstSignal || !secondSignal || !finishFirst) {
      throw new Error("reused retrieval requests did not start")
    }

    finishFirst()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await sendProviderRetrievalCancellation(
      "cancel-newer-reused-request",
      "reused-provider-request",
      host.providerSessionId,
      scope
    )
    expect(firstSignal.aborted).toBe(false)
    expect(secondSignal.aborted).toBe(true)
  })

  it("completes reused request IDs newer-first without unhandled rejection when the older request finishes", async () => {
    const host = activeTestHost!
    const scope = "newer-first-reused-request-id-scope"
    await activateScope(host, scope)

    let finishOlder!: () => void
    let finishNewer!: () => void
    let invocation = 0
    retrievalHandler.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          invocation += 1
          if (invocation === 1) finishOlder = resolve
          else if (invocation === 2) finishNewer = resolve
        })
    )

    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason)
    }
    process.on("unhandledRejection", onUnhandledRejection)

    try {
      await sendOriginalRetrieval("newer-first-reused-id", host.providerSessionId, scope)
      await sendOriginalRetrieval("newer-first-reused-id", host.providerSessionId, scope)
      expect(invocation).toBe(2)
      if (!finishOlder || !finishNewer) {
        throw new Error("both requests with the reused ID did not start")
      }

      finishNewer()
      await new Promise((resolve) => setTimeout(resolve, 0))
      finishOlder()
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(unhandledRejections).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandledRejection)
    }
  })
})
