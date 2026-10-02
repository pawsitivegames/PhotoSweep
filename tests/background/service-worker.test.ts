/**
 * Integration tests for background/index.ts message routing.
 *
 * Chrome APIs are mocked via globalThis.chrome so the service worker
 * module can be imported and its message handlers exercised directly.
 * Listeners are captured at import time and reused across tests.
 *
 * @vitest-environment happy-dom
 */
// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { APP_ID } from "../../lib/types"
import type { RecoveryHistoryTransactionMessage } from "../../lib/types"
import {
  RECOVERY_HISTORY_STORAGE_KEY,
  createPendingRecoveryRecord,
  updateRecoveryRecordFromTrash,
  type RecoveryHistoryContext
} from "../../lib/recovery-history"
import type { DeleteReport } from "../../lib/delete-report"
import type { TrashResultReport } from "../../lib/trash-result-report"

vi.mock("../../lib/generated/build-flags", () => ({
  BUILD_ID: "123e4567-e89b-42d3-a456-426614174000"
}))

// ============================================================
// Chrome API mock setup — must be done before the module import
// ============================================================

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (r?: unknown) => void
) => boolean | void
type TabRemovedListener = (tabId: number) => void
type TabActivatedListener = (activeInfo: chrome.tabs.TabActiveInfo) => void
type TabUpdatedListener = (
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
) => void
type ActionClickListener = (tab: chrome.tabs.Tab) => void
type PortMessageListener = (message: unknown) => void
type PortDisconnectListener = () => void
type ConnectListener = (port: chrome.runtime.Port) => void

// Persistent listener arrays — the SW registers into these once at import
const messageListeners: MessageListener[] = []
const externalMessageListeners: MessageListener[] = []
const tabRemovedListeners: TabRemovedListener[] = []
const tabActivatedListeners: TabActivatedListener[] = []
const tabUpdatedListeners: TabUpdatedListener[] = []
const actionClickListeners: ActionClickListener[] = []
const connectListeners: ConnectListener[] = []

const licenseStorage = new Map<string, unknown>()
const storageLocal = {
  get: vi.fn(async (key: string) => {
    const value = licenseStorage.get(key)
    return value === undefined ? {} : { [key]: value }
  }),
  set: vi.fn(async (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) {
      licenseStorage.set(key, value)
    }
  }),
  remove: vi.fn(async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      licenseStorage.delete(key)
    }
  })
}

const mockChrome = {
  action: {
    onClicked: {
      addListener: vi.fn((fn: ActionClickListener) =>
        actionClickListeners.push(fn)
      )
    }
  },
  sidePanel: {
    setPanelBehavior: vi.fn(() => Promise.resolve()),
    setOptions: vi.fn(() => Promise.resolve()),
    open: vi.fn(() => Promise.resolve())
  },
  tabs: {
    query: vi.fn((_query: unknown) => Promise.resolve([])),
    get: vi.fn(),
    sendMessage: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    onRemoved: {
      addListener: vi.fn((fn: TabRemovedListener) =>
        tabRemovedListeners.push(fn)
      )
    },
    onActivated: {
      addListener: vi.fn((fn: TabActivatedListener) =>
        tabActivatedListeners.push(fn)
      )
    },
    onUpdated: {
      addListener: vi.fn((fn: TabUpdatedListener) =>
        tabUpdatedListeners.push(fn)
      )
    }
  },
  scripting: {
    executeScript: vi.fn()
  },
  webNavigation: {
    getAllFrames: vi.fn()
  },
  runtime: {
    id: "abcdefghijklmnopabcdefghijklmnop",
    getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    getManifest: vi.fn(() => ({
      version: "2.3.0.3",
      externally_connectable: {
        matches: ["https://license.test/*"]
      },
      content_scripts: [
        {
          matches: ["https://photos.google.com/*"],
          js: ["google-photos-inject.js", "google-photos-bridge.js"]
        },
        {
          matches: ["https://www.icloud.com/*"],
          js: ["icloud-photos-inject.js", "icloud-photos-bridge.js"]
        },
        {
          matches: ["https://www.amazon.ca/photos*"],
          js: ["amazon-photos-inject.js", "amazon-photos-bridge.js"]
        }
      ]
    })),
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((fn: MessageListener) => messageListeners.push(fn))
    },
    onMessageExternal: {
      addListener: vi.fn((fn: MessageListener) =>
        externalMessageListeners.push(fn)
      )
    },
    onConnect: {
      addListener: vi.fn((fn: ConnectListener) => connectListeners.push(fn))
    }
  },
  storage: {
    local: storageLocal
  }
}

vi.stubGlobal("chrome", mockChrome)
let startupSetOptionsCalls: unknown[][] = []

// ============================================================
// Import the service worker AFTER mocks are installed
// ============================================================

beforeAll(async () => {
  await import("../../background/index")
  startupSetOptionsCalls = mockChrome.sidePanel.setOptions.mock.calls.map(
    (call) => [...call]
  )
})

// ============================================================
// Helpers
// ============================================================

function dispatchMessage(
  message: unknown,
  sender: Partial<chrome.runtime.MessageSender> = {}
) {
  for (const fn of messageListeners) {
    fn(message, sender as chrome.runtime.MessageSender, () => {})
  }
}

async function dispatchMessageWithResponse(
  message: unknown,
  sender: Partial<chrome.runtime.MessageSender> = {}
): Promise<unknown> {
  let response: unknown
  for (const fn of messageListeners) {
    fn(message, sender as chrome.runtime.MessageSender, (nextResponse) => {
      response = nextResponse
    })
  }
  await new Promise((r) => setTimeout(r, 20))
  return response
}

async function waitForTabMessage(
  tabId: number,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 1000
): Promise<void> {
  const startedAt = Date.now()
  const wasSent = () =>
    mockChrome.tabs.sendMessage.mock.calls.some(
      ([sentTabId, message]) =>
        sentTabId === tabId &&
        Boolean(message) &&
        predicate(message as Record<string, unknown>)
    )

  while (!wasSent()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for a message to tab ${tabId}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function dispatchExternalMessageWithResponse(
  message: unknown,
  senderUrl?: string
): Promise<unknown> {
  let response: unknown
  for (const fn of externalMessageListeners) {
    fn(
      message,
      { url: senderUrl } as chrome.runtime.MessageSender,
      (nextResponse) => {
        response = nextResponse
      }
    )
  }
  await new Promise((r) => setTimeout(r, 20))
  return response
}

function dispatchActionClick(tab: chrome.tabs.Tab) {
  for (const fn of actionClickListeners) {
    fn(tab)
  }
}

function createMockPort(name = "gpd-side-panel") {
  const messageListeners: PortMessageListener[] = []
  const disconnectListeners: PortDisconnectListener[] = []
  return {
    name,
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: vi.fn((fn: PortMessageListener) => messageListeners.push(fn))
    },
    onDisconnect: {
      addListener: vi.fn((fn: PortDisconnectListener) =>
        disconnectListeners.push(fn)
      )
    },
    dispatchMessage(message: unknown) {
      messageListeners.forEach((fn) => fn(message))
    },
    dispatchDisconnect() {
      disconnectListeners.forEach((fn) => fn())
    }
  }
}

/** App tab sender: no sender.tab (extension page). Resolved via tabs.query by URL. */
function appSender(): Partial<chrome.runtime.MessageSender> {
  return { url: "chrome-extension://test/tabs/app.html" }
}

/** Content script sender: has sender.tab set. */
function gpSender(tabId: number): Partial<chrome.runtime.MessageSender> {
  return { tab: { id: tabId } as chrome.tabs.Tab }
}

function trustedAppSender(tabId: number): Partial<chrome.runtime.MessageSender> {
  const url = `chrome-extension://${mockChrome.runtime.id}/tabs/app.html`
  return {
    id: mockChrome.runtime.id,
    url,
    frameId: 0,
    tab: { id: tabId, url } as chrome.tabs.Tab
  }
}

function trustedGoogleProviderSender(
  tabId: number,
  frameId = 0
): Partial<chrome.runtime.MessageSender> {
  const url = "https://photos.google.com/"
  return {
    id: mockChrome.runtime.id,
    url,
    frameId,
    tab: { id: tabId, url } as chrome.tabs.Tab
  }
}

function dispatchMessageAndWaitForResponse(
  message: unknown,
  sender: Partial<chrome.runtime.MessageSender>,
  timeoutMs = 1000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error("Timed out waiting for a service worker response."))
    }, timeoutMs)
    const respond = (value?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(value)
    }
    for (const listener of messageListeners) {
      listener(message, sender as chrome.runtime.MessageSender, respond)
    }
  })
}

function createRestorableAmazonRecord(
  operationId: string,
  dedupKey: string,
  mediaKey: string
) {
  const createdAt = new Date().toISOString()
  const context: RecoveryHistoryContext = {
    operationId,
    provider: "amazon",
    providerSessionId: "amazon-session-a",
    attemptedDedupKeys: [dedupKey],
    attemptedMediaKeys: [mediaKey]
  }
  const preTrash: DeleteReport = {
    reportId: `pre-${operationId}`,
    operationId,
    createdAt,
    totalGroupsAffected: 1,
    totalItemsKept: 1,
    totalItemsSelectedForTrash: 1,
    trashBatchSize: 25,
    items: []
  }
  const pending = createPendingRecoveryRecord(preTrash, context)
  const trashResult: TrashResultReport = {
    reportId: `trash-${operationId}`,
    operationId,
    createdAt,
    status: "complete",
    attemptedCount: 1,
    movedCount: 1,
    failedCount: 0,
    attemptedMediaKeys: [mediaKey],
    attemptedDedupKeys: [dedupKey],
    movedMediaKeys: [mediaKey],
    movedDedupKeys: [dedupKey],
    failedMediaKeys: [],
    failedDedupKeys: [],
    retryAttempts: 0,
    error: null
  }
  return {
    context,
    preTrashReport: preTrash,
    trashResult,
    record: updateRecoveryRecordFromTrash([pending], trashResult, context)[0]!
  }
}

function createRestorableFingerprintRecord(
  provider: "google" | "icloud",
  operationId: string,
  dedupKey: string,
  mediaKey: string,
  accountEmail: string,
  providerSessionId: string
) {
  const createdAt = new Date().toISOString()
  const context: RecoveryHistoryContext = {
    operationId,
    provider,
    accountEmail,
    providerSessionId,
    attemptedDedupKeys: [dedupKey],
    attemptedMediaKeys: [mediaKey]
  }
  const preTrash: DeleteReport = {
    reportId: `pre-${operationId}`,
    operationId,
    createdAt,
    totalGroupsAffected: 1,
    totalItemsKept: 1,
    totalItemsSelectedForTrash: 1,
    trashBatchSize: 25,
    items: []
  }
  const pending = createPendingRecoveryRecord(preTrash, context)
  const trashResult: TrashResultReport = {
    reportId: `trash-${operationId}`,
    operationId,
    createdAt,
    status: "complete",
    attemptedCount: 1,
    movedCount: 1,
    failedCount: 0,
    attemptedMediaKeys: [mediaKey],
    attemptedDedupKeys: [dedupKey],
    movedMediaKeys: [mediaKey],
    movedDedupKeys: [dedupKey],
    failedMediaKeys: [],
    failedDedupKeys: [],
    retryAttempts: 0,
    error: null
  }
  return {
    context,
    record: updateRecoveryRecordFromTrash([pending], trashResult, context)[0]!
  }
}

let recoveryTransactionSequence = 0
function recoveryMessage(transaction: unknown) {
  recoveryTransactionSequence += 1
  return {
    app: APP_ID,
    action: "recoveryHistory.transaction",
    transactionId: `recovery-tx-${recoveryTransactionSequence}`,
    transaction
  }
}

const recoveryAppSender = () => trustedAppSender(701)

function beginAmazonRestore(operationId: string, targetDedupKey: string) {
  return {
    kind: "beginRestore",
    operationId,
    requestId: `restore-${operationId}`,
    provider: "amazon",
    providerSessionId: "amazon-session-a",
    targetDedupKeys: [targetDedupKey]
  }
}

function completeAmazonRestore(
  operationId: string,
  targetDedupKey: string,
  requestId = `restore-${operationId}`
) {
  return {
    kind: "updateRestore",
    operationId,
    requestId,
    provider: "amazon",
    providerSessionId: "amazon-session-a",
    params: {
      outcome: "complete",
      requestId,
      terminal: true,
      restoredDedupKeys: [targetDedupKey],
      unknownDedupKeys: [],
      notDispatchedDedupKeys: [],
      outcomes: [
        {
          operation: "restore",
          targetKey: targetDedupKey,
          status: "confirmed"
        }
      ]
    }
  }
}

function beginFingerprintRestore(
  provider: "google" | "icloud",
  operationId: string,
  targetDedupKey: string,
  providerSessionId: string,
  accountEmail: string,
  requestId = `restore-${operationId}-${providerSessionId}`
) {
  return {
    kind: "beginRestore",
    operationId,
    requestId,
    provider,
    providerSessionId,
    accountEmail,
    targetDedupKeys: [targetDedupKey]
  }
}

// Reset call history (not implementations) between tests
beforeEach(() => {
  vi.clearAllMocks()
  licenseStorage.clear()
  storageLocal.get.mockImplementation(async (key: string) => {
    const value = licenseStorage.get(key)
    return value === undefined ? {} : { [key]: value }
  })
  storageLocal.set.mockImplementation(async (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) {
      licenseStorage.set(key, value)
    }
  })
  storageLocal.remove.mockImplementation(async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      licenseStorage.delete(key)
    }
  })
  mockChrome.tabs.get.mockResolvedValue(undefined)
  mockChrome.tabs.update.mockResolvedValue({})
  mockChrome.tabs.create.mockResolvedValue({})
  mockChrome.sidePanel.setOptions.mockResolvedValue(undefined)
  mockChrome.sidePanel.open.mockResolvedValue(undefined)
  mockChrome.scripting.executeScript.mockResolvedValue([])
  mockChrome.webNavigation.getAllFrames.mockResolvedValue([])
})

describe("external license session handshake", () => {
  it("stores valid sessions only from manifest-allowed origins", async () => {
    await expect(
      dispatchExternalMessageWithResponse(
        {
          type: "photosweep-license-session",
          licenseSessionId: "pls_external"
        },
        "https://license.test/checkout/success?licenseSessionId=pls_external"
      )
    ).resolves.toEqual({ ok: true })
    expect(licenseStorage.get("photoSweepLicenseSessionId")).toBe(
      "pls_external"
    )

    await expect(
      dispatchExternalMessageWithResponse(
        {
          type: "photosweep-license-session",
          licenseSessionId: "pls_attacker"
        },
        "https://attacker.test/"
      )
    ).resolves.toMatchObject({ ok: false, error: expect.any(String) })
    expect(licenseStorage.get("photoSweepLicenseSessionId")).toBe(
      "pls_external"
    )
  })

  it("rejects malformed session messages", async () => {
    await expect(
      dispatchExternalMessageWithResponse(
        {
          type: "photosweep-license-session",
          licenseSessionId: "bad session"
        },
        "https://license.test/"
      )
    ).resolves.toMatchObject({ ok: false, error: expect.any(String) })
    expect(licenseStorage.size).toBe(0)
  })
})

describe("provider command key relay", () => {
  it("returns only the per-install public key to provider content scripts", async () => {
    const response = await dispatchMessageWithResponse({
      app: APP_ID,
      action: "providerCommandKey"
    })

    expect(response).toMatchObject({
      app: APP_ID,
      action: "providerCommandKey.result",
      publicKey: {
        kty: "EC",
        crv: "P-256",
        x: expect.any(String),
        y: expect.any(String)
      }
    })
    expect(response).not.toHaveProperty("publicKey.d")
  })
})

// ============================================================
// Launch flow
// ============================================================

describe("launch flow", () => {
  it("disables the global default side panel on startup", () => {
    expect(startupSetOptionsCalls).toContainEqual([{ enabled: false }])
  })

  it("opens a tab-scoped side panel from the extension action", async () => {
    dispatchActionClick({
      id: 7,
      url: "https://example.com/"
    } as chrome.tabs.Tab)

    await new Promise((r) => setTimeout(r, 20))

    expect(mockChrome.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 7,
      path: "tabs/scanner-panel.html",
      enabled: true
    })
    expect(mockChrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 })
    expect(mockChrome.tabs.update).not.toHaveBeenCalled()
    expect(mockChrome.tabs.create).not.toHaveBeenCalled()
  })

  it("updates the side-panel host tab when the side panel opens a provider", async () => {
    dispatchActionClick({
      id: 11,
      url: "https://example.com/"
    } as chrome.tabs.Tab)
    await new Promise((r) => setTimeout(r, 20))
    vi.clearAllMocks()

    mockChrome.tabs.get.mockResolvedValue({
      id: 11,
      url: "https://example.com/"
    })
    mockChrome.tabs.update.mockResolvedValue({
      id: 11,
      url: "https://www.icloud.com/photos"
    })

    dispatchMessage(
      { app: APP_ID, action: "launchProvider", provider: "icloud" },
      { url: "chrome-extension://test/tabs/scanner-panel.html" }
    )

    await new Promise((r) => setTimeout(r, 20))

    expect(mockChrome.tabs.get).toHaveBeenCalledWith(11)
    expect(mockChrome.tabs.query).not.toHaveBeenCalledWith({
      active: true,
      currentWindow: true
    })
    expect(mockChrome.tabs.update).toHaveBeenCalledWith(11, {
      url: "https://www.icloud.com/photos",
      active: true
    })
    expect(mockChrome.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 11,
      path: "tabs/scanner-panel.html",
      enabled: true
    })
    expect(mockChrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 11 })
    expect(mockChrome.tabs.create).not.toHaveBeenCalled()
  })

  it("uses the active host tab reported by the side panel before creating provider tabs", async () => {
    const port = createMockPort()
    connectListeners.forEach((fn) => fn(port as unknown as chrome.runtime.Port))
    port.dispatchMessage({
      app: APP_ID,
      action: "sidePanel.ready",
      clientId: "panel-client-1",
      activeTabId: 31
    })

    mockChrome.tabs.get.mockResolvedValue({
      id: 31,
      url: "https://example.com/"
    })
    mockChrome.tabs.update.mockResolvedValue({
      id: 31,
      url: "https://photos.google.com/"
    })

    dispatchMessage(
      { app: APP_ID, action: "launchProvider", provider: "google" },
      {
        url: "chrome-extension://test/tabs/scanner-panel.html",
        tab: {
          id: 99,
          url: "chrome-extension://test/tabs/scanner-panel.html"
        } as chrome.tabs.Tab
      }
    )

    await new Promise((r) => setTimeout(r, 20))

    expect(mockChrome.tabs.get).toHaveBeenCalledWith(31)
    expect(mockChrome.tabs.update).toHaveBeenCalledWith(31, {
      url: "https://photos.google.com/",
      active: true
    })
    expect(mockChrome.tabs.create).not.toHaveBeenCalled()
  })

  it("uses the side-panel supplied host tab id when opening a provider", async () => {
    mockChrome.tabs.get.mockResolvedValue({
      id: 52,
      url: "https://example.com/"
    })
    mockChrome.tabs.update.mockResolvedValue({
      id: 52,
      url: "https://www.amazon.ca/photos?sf=1"
    })

    const response = await dispatchMessageWithResponse(
      {
        app: APP_ID,
        action: "launchProvider",
        provider: "amazon",
        hostTabId: 52
      },
      { url: "chrome-extension://test/tabs/scanner-panel.html" }
    )

    expect(mockChrome.tabs.get).toHaveBeenCalledWith(52)
    expect(mockChrome.tabs.update).toHaveBeenCalledWith(52, {
      url: "https://www.amazon.com/photos?sf=1",
      active: true
    })
    expect(mockChrome.tabs.create).not.toHaveBeenCalled()
    expect(response).toMatchObject({
      success: true,
      provider: "amazon",
      tabId: 52,
      alreadyOpen: false
    })
  })

  it("focuses the active main tab without reloading when it already matches the selected provider", async () => {
    mockChrome.tabs.query.mockResolvedValue([
      { id: 12, url: "https://www.amazon.ca/photos?sf=1" }
    ])

    dispatchMessage(
      { app: APP_ID, action: "launchProvider", provider: "amazon" },
      { url: "chrome-extension://test/tabs/scanner-panel.html" }
    )

    await new Promise((r) => setTimeout(r, 20))

    expect(mockChrome.tabs.update).toHaveBeenCalledWith(12, { active: true })
    expect(mockChrome.tabs.create).not.toHaveBeenCalled()
  })

  it("marks launchProvider as alreadyOpen only when the chosen tab matched before navigation", async () => {
    mockChrome.tabs.query.mockResolvedValue([
      { id: 12, url: "https://www.amazon.ca/photos?sf=1" }
    ])
    mockChrome.tabs.update.mockResolvedValue({
      id: 12,
      url: "https://www.amazon.ca/photos?sf=1"
    })

    const response = await dispatchMessageWithResponse(
      { app: APP_ID, action: "launchProvider", provider: "amazon" },
      { url: "chrome-extension://test/tabs/scanner-panel.html" }
    )

    expect(response).toMatchObject({
      success: true,
      provider: "amazon",
      tabId: 12,
      alreadyOpen: true
    })
  })

  it("navigates a Chrome-owned active tab instead of failing side-panel Open", async () => {
    mockChrome.tabs.query.mockImplementation(
      (query: { active?: boolean; currentWindow?: boolean }) => {
        if (query.active && query.currentWindow) {
          return Promise.resolve([{ id: 45, url: "chrome://extensions/" }])
        }
        return Promise.resolve([])
      }
    )
    mockChrome.tabs.update.mockResolvedValue({
      id: 45,
      url: "https://photos.google.com/"
    })

    const response = await dispatchMessageWithResponse(
      { app: APP_ID, action: "launchProvider", provider: "google" },
      { url: "chrome-extension://test/tabs/scanner-panel.html" }
    )

    expect(mockChrome.tabs.update).toHaveBeenCalledWith(45, {
      url: "https://photos.google.com/",
      active: true
    })
    expect(mockChrome.tabs.create).not.toHaveBeenCalled()
    expect(response).toMatchObject({
      success: true,
      provider: "google",
      tabId: 45
    })
  })

  it("falls back to another normal window tab when the active tab is an extension page", async () => {
    mockChrome.tabs.query.mockImplementation(
      (query: { active?: boolean; currentWindow?: boolean }) => {
        if (query.active && query.currentWindow) {
          return Promise.resolve([
            {
              id: 61,
              url: "chrome-extension://test/tabs/scanner-panel.html"
            }
          ])
        }
        if (query.currentWindow) {
          return Promise.resolve([
            {
              id: 61,
              url: "chrome-extension://test/tabs/scanner-panel.html"
            },
            { id: 62, url: "https://example.com/" }
          ])
        }
        return Promise.resolve([])
      }
    )
    mockChrome.tabs.update.mockResolvedValue({
      id: 62,
      url: "https://www.icloud.com/photos"
    })

    const response = await dispatchMessageWithResponse(
      { app: APP_ID, action: "launchProvider", provider: "icloud" },
      { url: "chrome-extension://test/tabs/scanner-panel.html" }
    )

    expect(mockChrome.tabs.update).toHaveBeenCalledWith(62, {
      url: "https://www.icloud.com/photos",
      active: true
    })
    expect(mockChrome.tabs.create).not.toHaveBeenCalled()
    expect(response).toMatchObject({
      success: true,
      provider: "icloud",
      tabId: 62
    })
  })

  it("does not create a new tab when a side-panel provider switch has no navigable host", async () => {
    mockChrome.tabs.query.mockResolvedValue([
      {
        id: 44,
        url: "chrome-extension://test/tabs/scanner-panel.html"
      }
    ])

    dispatchMessage(
      { app: APP_ID, action: "launchProvider", provider: "icloud" },
      { url: "chrome-extension://test/tabs/scanner-panel.html" }
    )

    await new Promise((r) => setTimeout(r, 20))

    expect(mockChrome.tabs.update).not.toHaveBeenCalled()
    expect(mockChrome.tabs.create).not.toHaveBeenCalled()
    expect(mockChrome.sidePanel.open).not.toHaveBeenCalled()
  })
})

// ============================================================
// healthCheck — GP tab not found
// ============================================================

describe("healthCheck", () => {
  it("[PARITY-08] attaches service-worker package identity to app results", async () => {
    const appTabId = 20

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com")) return Promise.resolve([])
      // App tab lookup by URL
      return Promise.resolve([{ id: appTabId }])
    })

    dispatchMessage({ app: APP_ID, action: "healthCheck" }, appSender())
    await new Promise((r) => setTimeout(r, 20))
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({
        action: "healthCheck.result",
        success: false,
        runtimeBuildIdentity: {
          extensionId: "abcdefghijklmnopabcdefghijklmnop",
          packageVersion: "2.3.0.3",
          buildId: "123e4567-e89b-42d3-a456-426614174000"
        }
      })
    )
  })

  it("treats app tab id 0 as a valid sender tab", async () => {
    const appTabId = 0

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com")) return Promise.resolve([])
      return Promise.resolve([{ id: appTabId }])
    })

    dispatchMessage({ app: APP_ID, action: "healthCheck" }, appSender())
    await new Promise((r) => setTimeout(r, 20))
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({ action: "healthCheck.result", success: false })
    )
  })

  it("forwards the Amazon Photos profile label to the app context", async () => {
    const gpTabId = 10
    const appTabId = 20

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("amazon"))
        return Promise.resolve([
          { id: gpTabId, url: "https://www.amazon.ca/photos?sf=1" }
        ])
      return Promise.resolve([{ id: appTabId }])
    })

    // GPTK result arrives from GP tab after command is forwarded
    mockChrome.tabs.sendMessage.mockImplementation(
      (_tabId: number, msg: { command?: string; requestId?: string }) => {
        if (msg?.command === "healthCheck") {
          setTimeout(() => {
            dispatchMessage(
              {
                app: APP_ID,
                action: "gptkResult",
                command: "healthCheck",
                requestId: msg.requestId,
                success: true,
                data: {
                  hasGptk: true,
                  accountDisplayName: " Pawsitive Games "
                }
              },
              gpSender(gpTabId)
            )
          }, 0)
        }
        return Promise.resolve()
      }
    )

    dispatchMessage(
      { app: APP_ID, action: "healthCheck", provider: "amazon" },
      appSender()
    )
    await new Promise((r) => setTimeout(r, 30))

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({
        action: "healthCheck.result",
        provider: "amazon",
        success: true,
        hasGptk: true,
        accountDisplayName: "Pawsitive Games"
      })
    )
  })

  it("reinjects Google MAIN world scripts and retries when healthCheck reports missing GPTK", async () => {
    const gpTabId = 23
    const appTabId = 24
    let healthChecks = 0

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com"))
        return Promise.resolve([
          { id: gpTabId, url: "https://photos.google.com/" }
        ])
      return Promise.resolve([{ id: appTabId }])
    })
    mockChrome.scripting.executeScript.mockImplementation(
      ({ files }: { files?: string[] }) => {
        if (files) return Promise.resolve([])
        return Promise.resolve([
          {
            result:
              healthChecks === 0
                ? {
                    hasGptk: false,
                    hasCommandHost: true,
                    hasCommandHandler: true
                  }
                : {
                    hasGptk: true,
                    hasCommandHost: true,
                    hasCommandHandler: true
                  }
          }
        ])
      }
    )
    mockChrome.tabs.sendMessage.mockImplementation(
      (
        _tabId: number,
        msg: { action?: string; command?: string; requestId?: string }
      ) => {
        if (msg?.action === "ping") return Promise.resolve()
        if (msg?.command === "healthCheck") {
          healthChecks++
          const hasGptk = healthChecks > 1
          setTimeout(() => {
            dispatchMessage(
              {
                app: APP_ID,
                action: "gptkResult",
                command: "healthCheck",
                requestId: msg.requestId,
                success: true,
                data: { hasGptk }
              },
              gpSender(gpTabId)
            )
          }, 0)
        }
        return Promise.resolve()
      }
    )

    dispatchMessage({ app: APP_ID, action: "healthCheck" }, appSender())
    await waitForTabMessage(
      appTabId,
      (message) =>
        message.action === "healthCheck.result" &&
        message.success === true &&
        message.hasGptk === true
    )

    expect(healthChecks).toBe(2)
    expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: gpTabId },
      world: "MAIN",
      files: ["scripts/unsafewindow-shim.js"]
    })
    expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: gpTabId },
      world: "MAIN",
      files: ["scripts/google-photos-toolkit.user.js"]
    })
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({
        action: "healthCheck.result",
        success: true,
        hasGptk: true
      })
    )
  })

  it("reports healthCheck failure when the provider handler is not ready", async () => {
    const icloudTabId = 21
    const appTabId = 22

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("icloud.com"))
        return Promise.resolve([
          { id: icloudTabId, url: "https://www.icloud.com/photos" }
        ])
      return Promise.resolve([{ id: appTabId }])
    })
    mockChrome.tabs.sendMessage.mockImplementation(
      (_tabId: number, msg: { action?: string }) => {
        if (msg?.action === "ping") return Promise.resolve()
        return Promise.resolve()
      }
    )
    mockChrome.scripting.executeScript.mockImplementation(
      ({
        args
      }: {
        args?: Array<{ command?: string; requestId?: string }>
      }) => {
        const msg = args?.[0]
        if (msg?.command === "healthCheck") {
          setTimeout(() => {
            dispatchMessage(
              {
                app: APP_ID,
                action: "gptkResult",
                command: "healthCheck",
                requestId: msg.requestId,
                success: true,
                data: { hasGptk: false }
              },
              gpSender(icloudTabId)
            )
          }, 0)
        }
        return Promise.resolve()
      }
    )

    dispatchMessage(
      { app: APP_ID, action: "healthCheck", provider: "icloud" },
      appSender()
    )
    await new Promise((r) => setTimeout(r, 30))

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({
        action: "healthCheck.result",
        provider: "icloud",
        success: false,
        hasGptk: false
      })
    )
  })

  it("reports Amazon sign-in guidance when its health probe is unavailable", async () => {
    const amazonTabId = 31
    const appTabId = 32

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("amazon.com"))
        return Promise.resolve([
          { id: amazonTabId, url: "https://www.amazon.com/photos?sf=1" }
        ])
      return Promise.resolve([{ id: appTabId }])
    })
    mockChrome.tabs.sendMessage.mockImplementation(
      (
        _tabId: number,
        msg: { action?: string; command?: string; requestId?: string }
      ) => {
        if (msg?.action === "ping") return Promise.resolve()
        if (msg?.command === "healthCheck") {
          setTimeout(() => {
            dispatchMessage(
              {
                app: APP_ID,
                action: "gptkResult",
                command: "healthCheck",
                requestId: msg.requestId,
                success: true,
                data: {
                  hasGptk: false,
                  health: {
                    schemaVersion: 1,
                    contractVersion: "provider-parity-v1",
                    provider: "amazon",
                    status: "unavailable",
                    checks: { page: true, session: false, readPath: false }
                  }
                }
              },
              gpSender(amazonTabId)
            )
          }, 0)
        }
        return Promise.resolve()
      }
    )
    dispatchMessage(
      { app: APP_ID, action: "healthCheck", provider: "amazon" },
      appSender()
    )
    await new Promise((r) => setTimeout(r, 30))

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({
        action: "healthCheck.result",
        provider: "amazon",
        success: false,
        hasGptk: false,
        error: expect.stringMatching(
          /Amazon Photos is not ready.*sign in again if needed/i
        )
      })
    )
  })

  it("injects the Google Photos bridge when an already-open tab is missing content scripts", async () => {
    const gpTabId = 3010
    const appTabId = 3011
    let bridgeInjected = false

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com"))
        return Promise.resolve([
          { id: gpTabId, url: "https://photos.google.com/" }
        ])
      return Promise.resolve([{ id: appTabId }])
    })
    mockChrome.scripting.executeScript.mockImplementation(
      ({ files }: { files?: string[] }) => {
        if (files?.includes("google-photos-bridge.js")) bridgeInjected = true
        return Promise.resolve([])
      }
    )
    mockChrome.tabs.sendMessage.mockImplementation(
      (
        _tabId: number,
        msg: { action?: string; command?: string; requestId?: string }
      ) => {
        if (msg?.action === "ping") {
          return bridgeInjected
            ? Promise.resolve()
            : Promise.reject(new Error("Receiving end does not exist"))
        }
        if (msg?.command === "healthCheck") {
          setTimeout(() => {
            dispatchMessage(
              {
                app: APP_ID,
                action: "gptkResult",
                command: "healthCheck",
                requestId: msg.requestId,
                success: true,
                data: { hasGptk: true, hasWizData: true }
              },
              gpSender(gpTabId)
            )
          }, 0)
        }
        return Promise.resolve()
      }
    )

    dispatchMessage({ app: APP_ID, action: "healthCheck" }, appSender())
    await new Promise((r) => setTimeout(r, 30))

    expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: gpTabId, allFrames: false },
      files: ["google-photos-inject.js"]
    })
    expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: gpTabId, allFrames: false },
      files: ["google-photos-bridge.js"]
    })
    expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: gpTabId },
      world: "MAIN",
      files: ["scripts/google-photos-commands.js"]
    })
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({
        action: "healthCheck.result",
        success: true,
        hasGptk: true
      })
    )
  })

  it("checks the side-panel host Photos tab first on first extension open", async () => {
    const staleTabId = 4010
    const hostTabId = 4011
    const appTabId = 4012

    dispatchActionClick({
      id: hostTabId,
      url: "https://photos.google.com/"
    } as chrome.tabs.Tab)
    await new Promise((r) => setTimeout(r, 20))
    vi.clearAllMocks()

    mockChrome.tabs.get.mockResolvedValue({
      id: hostTabId,
      url: "https://photos.google.com/"
    })
    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com")) {
        return Promise.resolve([
          { id: staleTabId, url: "https://photos.google.com/", active: false },
          { id: hostTabId, url: "https://photos.google.com/", active: true }
        ])
      }
      return Promise.resolve([{ id: appTabId }])
    })
    mockChrome.tabs.sendMessage.mockImplementation(
      (
        tabId: number,
        msg: { action?: string; command?: string; requestId?: string }
      ) => {
        if (msg?.action === "ping") {
          return tabId === hostTabId
            ? Promise.resolve()
            : Promise.reject(new Error("stale tab"))
        }
        if (msg?.command === "healthCheck") {
          expect(tabId).toBe(hostTabId)
          setTimeout(() => {
            dispatchMessage(
              {
                app: APP_ID,
                action: "gptkResult",
                command: "healthCheck",
                requestId: msg.requestId,
                success: true,
                data: { hasGptk: true, hasWizData: true }
              },
              gpSender(hostTabId)
            )
          }, 0)
        }
        return Promise.resolve()
      }
    )

    dispatchMessage({ app: APP_ID, action: "healthCheck" }, appSender())
    await new Promise((r) => setTimeout(r, 30))

    expect(mockChrome.tabs.get).toHaveBeenCalledWith(hostTabId)
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      hostTabId,
      expect.objectContaining({ command: "healthCheck" })
    )
    expect(mockChrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      staleTabId,
      expect.objectContaining({ command: "healthCheck" })
    )
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({
        action: "healthCheck.result",
        success: true
      })
    )
  })
})

// ============================================================
// findGooglePhotosTab — multi-tab selection (PR #120)
//
// When several photos.google.com tabs are open, picking tabs[0] was
// unreliable: the bridge may not be loaded in it, and sendMessage rejects
// with "Receiving end does not exist". The SW now pings each candidate —
// preferring the active tab, then most-recently-accessed — until one replies.
// ============================================================

describe("findGooglePhotosTab — multi-tab selection", () => {
  /** Filter recorded sendMessage calls down to ping probes. */
  function pingCalls() {
    return mockChrome.tabs.sendMessage.mock.calls.filter(
      (c: unknown[]) => (c[1] as { action?: string })?.action === "ping"
    )
  }

  it("skips an unreachable tab and forwards to the reachable one", async () => {
    const unreachableId = 31
    const reachableId = 32
    const appTabId = 33

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com"))
        return Promise.resolve([
          { id: unreachableId, active: false, lastAccessed: 200 },
          { id: reachableId, active: false, lastAccessed: 100 }
        ])
      return Promise.resolve([{ id: appTabId }])
    })

    mockChrome.tabs.sendMessage.mockImplementation(
      (
        tabId: number,
        msg: { action?: string; command?: string; requestId?: string }
      ) => {
        // The more-recently-accessed tab has no bridge loaded → ping rejects.
        if (msg?.action === "ping") {
          return tabId === unreachableId
            ? Promise.reject(new Error("Receiving end does not exist"))
            : Promise.resolve()
        }
        // healthCheck forwarded to the chosen tab → reply with success.
        if (msg?.command === "healthCheck") {
          setTimeout(() => {
            dispatchMessage(
              {
                app: APP_ID,
                action: "gptkResult",
                command: "healthCheck",
                requestId: msg.requestId,
                success: true,
                data: { hasGptk: true, hasWizData: true }
              },
              gpSender(reachableId)
            )
          }, 0)
        }
        return Promise.resolve()
      }
    )

    dispatchMessage({ app: APP_ID, action: "healthCheck" }, appSender())
    await new Promise((r) => setTimeout(r, 30))

    // Command went to the reachable tab, never to the unreachable one.
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      reachableId,
      expect.objectContaining({ command: "healthCheck" })
    )
    expect(mockChrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      unreachableId,
      expect.objectContaining({ command: "healthCheck" })
    )
    // And the app tab sees a successful connection.
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({ action: "healthCheck.result", success: true })
    )
  })

  it("prefers the active tab over a more-recently-accessed inactive one", async () => {
    const activeId = 41
    const inactiveId = 42
    const appTabId = 43

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com"))
        return Promise.resolve([
          { id: inactiveId, active: false, lastAccessed: 999 },
          { id: activeId, active: true, lastAccessed: 1 }
        ])
      return Promise.resolve([{ id: appTabId }])
    })
    // Both tabs reachable — selection comes down purely to ordering.
    mockChrome.tabs.sendMessage.mockResolvedValue(undefined)

    dispatchMessage({ app: APP_ID, action: "healthCheck" }, appSender())
    await waitForTabMessage(activeId, (message) => message.command === "healthCheck")

    // The first (and only) ping hits the active tab; the inactive one is
    // never probed because the active tab answers first.
    const pings = pingCalls()
    expect(pings[0][0]).toBe(activeId)
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      activeId,
      expect.objectContaining({ command: "healthCheck" })
    )
  })

  it("treats Google Photos tab id 0 as a valid reachable tab", async () => {
    const gpTabId = 0
    const appTabId = 58

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com"))
        return Promise.resolve([{ id: gpTabId, active: true, lastAccessed: 1 }])
      return Promise.resolve([{ id: appTabId }])
    })

    mockChrome.tabs.sendMessage.mockImplementation(
      (
        _tabId: number,
        msg: { action?: string; command?: string; requestId?: string }
      ) => {
        if (msg?.command === "healthCheck") {
          setTimeout(() => {
            dispatchMessage(
              {
                app: APP_ID,
                action: "gptkResult",
                command: "healthCheck",
                requestId: msg.requestId,
                success: true,
                data: { hasGptk: true, hasWizData: true }
              },
              gpSender(gpTabId)
            )
          }, 0)
        }
        return Promise.resolve()
      }
    )

    dispatchMessage({ app: APP_ID, action: "healthCheck" }, appSender())
    await new Promise((r) => setTimeout(r, 30))

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      gpTabId,
      expect.objectContaining({ action: "ping" })
    )
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      gpTabId,
      expect.objectContaining({ command: "healthCheck" })
    )
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({ action: "healthCheck.result", success: true })
    )
  })

  it("reports failure when no Google Photos tab has the bridge loaded", async () => {
    const tabA = 51
    const tabB = 52
    const appTabId = 53

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com"))
        return Promise.resolve([
          { id: tabA, active: false, lastAccessed: 2 },
          { id: tabB, active: false, lastAccessed: 1 }
        ])
      return Promise.resolve([{ id: appTabId }])
    })
    // Every ping rejects → no reachable bridge anywhere.
    mockChrome.tabs.sendMessage.mockImplementation(
      (_tabId: number, msg: { action?: string }) => {
        if (msg?.action === "ping")
          return Promise.reject(new Error("no bridge"))
        return Promise.resolve()
      }
    )

    dispatchMessage({ app: APP_ID, action: "healthCheck" }, appSender())
    await new Promise((r) => setTimeout(r, 30))

    // Both candidates were probed before giving up.
    const pingedIds = pingCalls().map((c: unknown[]) => c[0])
    expect(pingedIds).toContain(tabA)
    expect(pingedIds).toContain(tabB)
    // App tab is told it cannot connect.
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({ action: "healthCheck.result", success: false })
    )
  })
})

// ============================================================
// gptkCommand routing
// ============================================================

describe("gptkCommand routing", () => {
  it("forwards command to GP tab", async () => {
    const gpTabId = 10
    const appTabId = 20
    const requestId = "test-req-1"

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com"))
        return Promise.resolve([{ id: gpTabId }])
      return Promise.resolve([{ id: appTabId }])
    })
    mockChrome.tabs.sendMessage.mockResolvedValue(undefined)
    mockChrome.webNavigation.getAllFrames.mockResolvedValue([
      {
        frameId: 9,
        parentFrameId: 0,
        url: "https://www.icloud.com/applications/photos3/current/en-us/index.html"
      }
    ])
    mockChrome.webNavigation.getAllFrames.mockResolvedValue([
      {
        frameId: 9,
        parentFrameId: 0,
        url: "https://www.icloud.com/applications/photos3/current/en-us/index.html"
      }
    ])
    mockChrome.webNavigation.getAllFrames.mockResolvedValue([
      {
        frameId: 9,
        parentFrameId: 0,
        url: "https://www.icloud.com/applications/photos3/current/en-us/index.html"
      }
    ])

    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkCommand",
        command: "getAllMediaItems",
        requestId,
        args: {}
      },
      appSender()
    )
    await waitForTabMessage(
      gpTabId,
      (message) => message.requestId === requestId
    )

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      gpTabId,
      expect.objectContaining({ command: "getAllMediaItems", requestId })
    )
  })

  it("drops side-panel commands when the side panel closes", async () => {
    const gpTabId = 81
    const requestId = "side-panel-scan"
    const clientId = "panel-client-1"
    const port = createMockPort()

    connectListeners.forEach((fn) => fn(port as unknown as chrome.runtime.Port))
    port.dispatchMessage({
      app: APP_ID,
      action: "sidePanel.ready",
      clientId
    })

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com"))
        return Promise.resolve([{ id: gpTabId }])
      return Promise.resolve([])
    })
    mockChrome.tabs.sendMessage.mockResolvedValue(undefined)

    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkCommand",
        command: "getAllMediaItems",
        requestId,
        clientId,
        args: {}
      },
      { url: "chrome-extension://test/tabs/scanner-panel.html" }
    )
    await new Promise((r) => setTimeout(r, 20))

    port.dispatchDisconnect()
    vi.clearAllMocks()

    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkResult",
        command: "getAllMediaItems",
        requestId,
        success: true,
        data: []
      },
      gpSender(gpTabId)
    )

    expect(mockChrome.runtime.sendMessage).not.toHaveBeenCalled()
    expect(mockChrome.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it("routes iCloud scan commands to an iCloud Photos tab", async () => {
    const appTabId = 71
    const icloudTabId = 72
    const requestId = "test-icloud-scan"

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("icloud.com"))
        return Promise.resolve([{ id: icloudTabId, active: true }])
      if (query?.url?.includes("photos.google.com")) return Promise.resolve([])
      return Promise.resolve([{ id: appTabId }])
    })
    mockChrome.tabs.sendMessage.mockResolvedValue(undefined)
    mockChrome.webNavigation.getAllFrames.mockResolvedValue([
      {
        frameId: 9,
        parentFrameId: 0,
        url: "https://www.icloud.com/applications/photos3/current/en-us/index.html"
      }
    ])

    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkCommand",
        command: "getAllMediaItems",
        provider: "icloud",
        requestId,
        args: { limit: 25 }
      },
      appSender()
    )
    await new Promise((r) => setTimeout(r, 1600))

    expect(mockChrome.tabs.update).toHaveBeenCalledWith(icloudTabId, {
      active: true
    })
    expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: icloudTabId, frameIds: [9] },
        func: expect.any(Function),
        args: [
          expect.objectContaining({
            command: "getAllMediaItems",
            provider: "icloud",
            requestId,
            args: expect.objectContaining({ limit: 25 })
          })
        ]
      })
    )
  })

  it("routes iCloud trash dry-run commands to an iCloud Photos tab", async () => {
    const appTabId = 173
    const icloudTabId = 174
    const requestId = "test-icloud-trash-dry-run"

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("icloud.com"))
        return Promise.resolve([{ id: icloudTabId, active: true }])
      if (query?.url?.includes("photos.google.com")) return Promise.resolve([])
      return Promise.resolve([{ id: appTabId }])
    })
    mockChrome.tabs.sendMessage.mockResolvedValue(undefined)

    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkCommand",
        command: "trashItems",
        provider: "icloud",
        requestId,
        args: {
          dryRun: true,
          dedupKeys: ["icloud-a"],
          mediaKeysToTrash: ["icloud-a"]
        }
      },
      appSender()
    )
    await new Promise((r) => setTimeout(r, 1600))

    expect(mockChrome.tabs.update).toHaveBeenCalledWith(icloudTabId, {
      active: true
    })
    expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: icloudTabId, allFrames: true },
        args: [
          expect.objectContaining({
            command: "trashItems",
            provider: "icloud",
            requestId,
            args: expect.objectContaining({ dryRun: true })
          })
        ]
      })
    )
  })

  it("routes Amazon scan commands without activating the Amazon Photos tab", async () => {
    const appTabId = 73
    const amazonTabId = 74
    const requestId = "test-amazon-scan"

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("amazon.ca"))
        return Promise.resolve([
          {
            id: amazonTabId,
            active: true,
            url: "https://www.amazon.ca/photos?sf=1"
          }
        ])
      if (query?.url?.includes("photos.google.com")) return Promise.resolve([])
      return Promise.resolve([{ id: appTabId }])
    })
    mockChrome.tabs.sendMessage.mockResolvedValue(undefined)

    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkCommand",
        command: "getAllMediaItems",
        provider: "amazon",
        requestId,
        args: {}
      },
      appSender()
    )
    await waitForTabMessage(
      amazonTabId,
      (message) => message.requestId === requestId
    )

    expect(mockChrome.tabs.update).not.toHaveBeenCalled()
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      amazonTabId,
      expect.objectContaining({
        command: "getAllMediaItems",
        provider: "amazon",
        requestId
      })
    )
  })

  it("does not inject or route Amazon commands from ordinary shopping pages", async () => {
    const appTabId = 75
    const shoppingTabId = 76
    const requestId = "test-amazon-shopping-page"

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("amazon.ca"))
        return Promise.resolve([
          {
            id: shoppingTabId,
            active: true,
            url: "https://www.amazon.ca/gp/browse.html"
          }
        ])
      if (query?.url?.includes("photos.google.com")) return Promise.resolve([])
      return Promise.resolve([{ id: appTabId }])
    })
    mockChrome.tabs.sendMessage.mockResolvedValue(undefined)

    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkCommand",
        command: "getAllMediaItems",
        provider: "amazon",
        requestId,
        args: {}
      },
      appSender()
    )
    await waitForTabMessage(
      appTabId,
      (message) =>
        message.action === "gptkResult" && message.requestId === requestId
    )

    expect(mockChrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      shoppingTabId,
      expect.objectContaining({ command: "getAllMediaItems", requestId })
    )
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({
        action: "gptkResult",
        command: "getAllMediaItems",
        requestId,
        success: false
      })
    )
  })

  it("relays gptkResult from GP tab back to app tab", async () => {
    const gpTabId = 10
    const appTabId = 20
    const requestId = "test-req-2"

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com"))
        return Promise.resolve([{ id: gpTabId }])
      return Promise.resolve([{ id: appTabId }])
    })
    mockChrome.tabs.sendMessage.mockResolvedValue(undefined)

    // First send a command so the SW registers the pending requestId → appTabId mapping
    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkCommand",
        command: "getAllMediaItems",
        requestId,
        args: {}
      },
      appSender()
    )
    await waitForTabMessage(
      gpTabId,
      (message) => message.requestId === requestId
    )

    // Now simulate result arriving from GP content script
    vi.clearAllMocks()
    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkResult",
        command: "getAllMediaItems",
        requestId,
        success: true,
        data: []
      },
      gpSender(gpTabId)
    )
    await waitForTabMessage(
      appTabId,
      (message) => message.action === "gptkResult"
    )

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({
        action: "gptkResult",
        command: "getAllMediaItems",
        success: true
      })
    )
  })

  it("ignores provider results and progress from an unrelated tab", async () => {
    const gpTabId = 110
    const appTabId = 120
    const requestId = "test-req-wrong-provider-tab"

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com"))
        return Promise.resolve([{ id: gpTabId }])
      return Promise.resolve([{ id: appTabId }])
    })
    mockChrome.tabs.sendMessage.mockResolvedValue(undefined)

    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkCommand",
        command: "getAllMediaItems",
        requestId,
        args: {}
      },
      appSender()
    )
    await waitForTabMessage(
      gpTabId,
      (message) => message.requestId === requestId
    )
    vi.clearAllMocks()

    const unrelatedTabId = 999
    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkProgress",
        command: "getAllMediaItems",
        requestId,
        itemsProcessed: 999,
        message: "forged progress"
      },
      gpSender(unrelatedTabId)
    )
    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkResult",
        command: "getAllMediaItems",
        requestId,
        success: true,
        data: [{ mediaKey: "forged" }]
      },
      gpSender(unrelatedTabId)
    )
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(mockChrome.tabs.sendMessage).not.toHaveBeenCalled()

    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkResult",
        command: "getAllMediaItems",
        requestId,
        success: true,
        data: []
      },
      gpSender(gpTabId)
    )
    await waitForTabMessage(
      appTabId,
      (message) => message.action === "gptkResult"
    )

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({
        action: "gptkResult",
        requestId,
        success: true
      })
    )
  })

  it("sends error result when GP tab not found", async () => {
    // Use unique IDs — tabMap is module-level and persists across tests
    const appTabId = 30

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com")) return Promise.resolve([])
      return Promise.resolve([{ id: appTabId }])
    })

    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkCommand",
        command: "trashItems",
        requestId: "req-err-2",
        args: {}
      },
      appSender()
    )
    await waitForTabMessage(
      appTabId,
      (message) =>
        message.action === "gptkResult" && message.requestId === "req-err-2"
    )

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({ action: "gptkResult", success: false })
    )
  })

  it("forwards commands from app tab id 0", async () => {
    const appTabId = 0
    const gpTabId = 61
    const requestId = "test-req-zero-app"

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com"))
        return Promise.resolve([{ id: gpTabId, active: true }])
      return Promise.resolve([{ id: appTabId }])
    })
    mockChrome.tabs.sendMessage.mockImplementation(
      (tabId: number, msg: { action?: string }) => {
        if (msg?.action === "ping" && tabId !== gpTabId) {
          return Promise.reject(new Error("stale mapping"))
        }
        return Promise.resolve()
      }
    )

    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkCommand",
        command: "getAllMediaItems",
        requestId,
        args: {}
      },
      appSender()
    )
    await new Promise((r) => setTimeout(r, 20))

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      gpTabId,
      expect.objectContaining({ command: "getAllMediaItems", requestId })
    )
  })

  it("relays progress back to app tab id 0", async () => {
    const appTabId = 0
    const gpTabId = 62
    const requestId = "test-req-zero-progress"

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com"))
        return Promise.resolve([{ id: gpTabId, active: true }])
      return Promise.resolve([{ id: appTabId }])
    })
    mockChrome.tabs.sendMessage.mockImplementation(
      (tabId: number, msg: { action?: string }) => {
        if (msg?.action === "ping" && tabId !== gpTabId) {
          return Promise.reject(new Error("stale mapping"))
        }
        return Promise.resolve()
      }
    )

    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkCommand",
        command: "getAllMediaItems",
        requestId,
        args: {}
      },
      appSender()
    )
    await new Promise((r) => setTimeout(r, 20))

    vi.clearAllMocks()
    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkProgress",
        command: "getAllMediaItems",
        requestId,
        itemsProcessed: 25,
        message: "Fetched 25"
      },
      gpSender(gpTabId)
    )
    await new Promise((r) => setTimeout(r, 10))

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      appTabId,
      expect.objectContaining({
        action: "gptkProgress",
        command: "getAllMediaItems",
        requestId,
        itemsProcessed: 25
      })
    )
  })
})

describe("Google original hash relay", () => {
  it("hashes only a one-use exact item from the current completed review", async () => {
    const appTabId = 801
    const providerTabId = 802
    const accountEmail = "reviewer@example.test"
    const providerSessionId = "google-session-current"
    const scopeFingerprint = "review-scope-current"
    const mediaKey = "scanned-photo-1"
    const scanRequestId = "relay-scan-1"
    const hashRequestId = "relay-hash-1"
    const url = "https://lh3.google.com/original/signed-resource"
    const originalFetch = globalThis.fetch
    const originalCrypto = globalThis.crypto

    mockChrome.tabs.query.mockImplementation((query: { url?: string }) => {
      if (query?.url?.includes("photos.google.com")) {
        return Promise.resolve([
          { id: providerTabId, url: "https://photos.google.com/" }
        ])
      }
      return Promise.resolve([])
    })
    mockChrome.tabs.sendMessage.mockResolvedValue(undefined)

    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkCommand",
        command: "getAllMediaItems",
        requestId: scanRequestId,
        provider: "google",
        args: {
          accountEmail,
          scanScopeFingerprint: scopeFingerprint
        }
      },
      trustedAppSender(appTabId)
    )
    await waitForTabMessage(
      providerTabId,
      (message) => message.requestId === scanRequestId
    )
    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkResult",
        command: "getAllMediaItems",
        provider: "google",
        requestId: scanRequestId,
        providerSessionId,
        scanCoverage: { status: "partial", stopReason: "user_limit" },
        success: true,
        data: [
          {
            mediaKey,
            mediaKind: "photo",
            mimeType: "image/jpeg",
            size: 4
          }
        ]
      },
      trustedGoogleProviderSender(providerTabId)
    )

    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("jpeg"))
        controller.close()
      }
    })
    const fetchResponse = {
      ok: true,
      status: 200,
      url: "https://lh3.googleusercontent.com/original/verified-resource",
      headers: new Headers({
        "content-type": "image/jpeg",
        "content-length": "4"
      }),
      body: responseBody
    } as Response
    const fetchMock = vi.fn(async () => fetchResponse)

    try {
      dispatchMessage(
        {
          app: APP_ID,
          action: "gptkCommand",
          command: "getOriginalContentHash",
          requestId: hashRequestId,
          provider: "google",
          args: {
            requestId: hashRequestId,
            mediaKey,
            mediaKind: "photo",
            providerSessionId,
            scanScopeFingerprint: scopeFingerprint,
            accountEmail,
            userOptIn: true,
            maxBytes: 100,
            aggregateBudgetBytes: 100
          }
        },
        trustedAppSender(appTabId)
      )
      await waitForTabMessage(
        providerTabId,
        (message) => message.requestId === hashRequestId
      )

      const appHashResults = () =>
        mockChrome.tabs.sendMessage.mock.calls.filter(
          ([tabId, message]) =>
            tabId === appTabId &&
            (message as { action?: string; command?: string })?.action ===
              "gptkResult" &&
            (message as { command?: string })?.command ===
              "getOriginalContentHash"
        )
      // Model same-window page scripts forwarding plausible, correctly bound
      // hash results through the isolated bridge. No page-provided digest may
      // complete the trusted app request.
      for (let sample = 0; sample < 16; sample += 1) {
        const forgedDigest = sample.toString(16).padStart(2, "0").repeat(32)
        dispatchMessage(
          {
            app: APP_ID,
            action: "gptkResult",
            command: "getOriginalContentHash",
            requestId: hashRequestId,
            provider: "google",
            providerSessionId,
            success: true,
            data: {
              mediaKey,
              scopeFingerprint,
              byteLength: 4,
              mimeType: "image/jpeg",
              contentHash: {
                value: forgedDigest,
                algorithm: "sha256",
                provenance: "original-content",
                verificationSource: "local-original-bytes",
                contentRole: "single-file"
              }
            }
          },
          trustedGoogleProviderSender(providerTabId)
        )
      }
      expect(appHashResults()).toHaveLength(0)

      vi.stubGlobal("fetch", fetchMock)
      vi.stubGlobal("crypto", {
        subtle: {
          digest: vi.fn(async () => new Uint8Array(32).buffer)
        }
      })

      const wrongFrame = await dispatchMessageAndWaitForResponse(
        {
          app: APP_ID,
          action: "providerOriginalHash.fetch",
          requestId: hashRequestId,
          provider: "google",
          providerSessionId,
          scanScopeFingerprint: scopeFingerprint,
          mediaKey,
          resourceUrl: url,
          mediaKind: "photo",
          maxBytes: 100,
          aggregateBudgetBytes: 100
        },
        trustedGoogleProviderSender(providerTabId, 1)
      )
      expect(wrongFrame).toMatchObject({ success: false })
      expect(fetchMock).not.toHaveBeenCalled()

      const response = await dispatchMessageAndWaitForResponse(
        {
          app: APP_ID,
          action: "providerOriginalHash.fetch",
          requestId: hashRequestId,
          provider: "google",
          providerSessionId,
          scanScopeFingerprint: scopeFingerprint,
          mediaKey,
          resourceUrl: url,
          mediaKind: "photo",
          maxBytes: 100,
          aggregateBudgetBytes: 100
        },
        trustedGoogleProviderSender(providerTabId)
      )
      await waitForTabMessage(
        appTabId,
        (message) =>
          message.action === "gptkResult" &&
          message.command === "getOriginalContentHash" &&
          message.requestId === hashRequestId
      )
      expect(response).toMatchObject({
        requestId: hashRequestId,
        providerSessionId,
        scanScopeFingerprint: scopeFingerprint,
        mediaKey,
        success: true,
        data: {
          mediaKey,
          scopeFingerprint,
          byteLength: 4,
          mimeType: "image/jpeg",
          contentHash: {
            algorithm: "sha256",
            provenance: "original-content",
            verificationSource: "local-original-bytes",
            value: "0".repeat(64),
            contentRole: "single-file"
          }
        }
      })
      expect(response).not.toHaveProperty("url")
      expect(JSON.stringify(response)).not.toContain("signed-resource")
      expect(fetchMock).toHaveBeenCalledTimes(1)

      const replay = await dispatchMessageAndWaitForResponse(
        {
          app: APP_ID,
          action: "providerOriginalHash.fetch",
          requestId: hashRequestId,
          provider: "google",
          providerSessionId,
          scanScopeFingerprint: scopeFingerprint,
          mediaKey,
          resourceUrl: url,
          mediaKind: "photo",
          maxBytes: 100,
          aggregateBudgetBytes: 100
        },
        trustedGoogleProviderSender(providerTabId)
      )
      expect(replay).toMatchObject({ success: false })
      expect(fetchMock).toHaveBeenCalledTimes(1)

      dispatchMessage(
        {
          app: APP_ID,
          action: "gptkResult",
          command: "getOriginalContentHash",
          requestId: hashRequestId,
          provider: "google",
          providerSessionId,
          success: true,
          data: { mediaKey, scopeFingerprint, contentHash: { value: "0".repeat(64) } }
        },
        trustedGoogleProviderSender(providerTabId)
      )
      expect(appHashResults()).toHaveLength(1)
      expect(appHashResults()[0]?.[1]).toMatchObject({
        command: "getOriginalContentHash",
        requestId: hashRequestId,
        provider: "google",
        providerSessionId,
        success: true,
        data: {
          mediaKey,
          scopeFingerprint,
          contentHash: { value: "0".repeat(64) }
        }
      })
    } finally {
      vi.stubGlobal("fetch", originalFetch)
      vi.stubGlobal("crypto", originalCrypto)
    }
  })

  it("does not route original retrieval for an item absent from the registered scan", async () => {
    const appTabId = 811
    const providerTabId = 812
    mockChrome.tabs.query.mockImplementation((query: { url?: string }) =>
      query?.url?.includes("photos.google.com")
        ? Promise.resolve([{ id: providerTabId, url: "https://photos.google.com/" }])
        : Promise.resolve([])
    )
    mockChrome.tabs.sendMessage.mockResolvedValue(undefined)

    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkCommand",
        command: "getAllMediaItems",
        requestId: "relay-scan-foreign",
        provider: "google",
        args: {
          accountEmail: "reviewer@example.test",
          scanScopeFingerprint: "foreign-scope"
        }
      },
      trustedAppSender(appTabId)
    )
    await waitForTabMessage(
      providerTabId,
      (message) => message.requestId === "relay-scan-foreign"
    )
    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkResult",
        command: "getAllMediaItems",
        provider: "google",
        requestId: "relay-scan-foreign",
        providerSessionId: "google-session-foreign-test",
        scanCoverage: { status: "complete", stopReason: "exhausted" },
        success: true,
        data: [{ mediaKey: "scanned-only", mediaKind: "photo", size: 4 }]
      },
      trustedGoogleProviderSender(providerTabId)
    )

    const callCountBefore = mockChrome.tabs.sendMessage.mock.calls.filter(
      ([tabId, message]) =>
        tabId === providerTabId &&
        (message as { command?: string }).command === "getOriginalContentHash"
    ).length
    dispatchMessage(
      {
        app: APP_ID,
        action: "gptkCommand",
        command: "getOriginalContentHash",
        requestId: "relay-hash-foreign",
        provider: "google",
        args: {
          requestId: "relay-hash-foreign",
          mediaKey: "never-scanned",
          mediaKind: "photo",
          providerSessionId: "google-session-foreign-test",
          scanScopeFingerprint: "foreign-scope",
          accountEmail: "reviewer@example.test",
          userOptIn: true,
          maxBytes: 100,
          aggregateBudgetBytes: 100
        }
      },
      trustedAppSender(appTabId)
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    const callCountAfter = mockChrome.tabs.sendMessage.mock.calls.filter(
      ([tabId, message]) =>
        tabId === providerTabId &&
        (message as { command?: string }).command === "getOriginalContentHash"
    ).length
    expect(callCountAfter).toBe(callCountBefore)
  })
})

// ============================================================
// Message filter
// ============================================================

describe("message filtering", () => {
  it("ignores messages from other extensions", () => {
    dispatchMessage({ app: "other-extension", action: "healthCheck" }, {})
    expect(mockChrome.tabs.sendMessage).not.toHaveBeenCalled()
    expect(mockChrome.tabs.query).not.toHaveBeenCalled()
  })

  it("ignores messages without app field", () => {
    dispatchMessage({ action: "healthCheck" }, {})
    expect(mockChrome.tabs.sendMessage).not.toHaveBeenCalled()
  })
})

describe("recovery history transaction authority", () => {
  it("serializes independent app callers across the full storage read/modify/write", async () => {
    const first = createRestorableAmazonRecord("operation-a", "dedup-a", "media-a")
    const secondContext: RecoveryHistoryContext = {
      operationId: "operation-b",
      provider: "amazon",
      providerSessionId: "amazon-session-a",
      attemptedDedupKeys: ["dedup-b"],
      attemptedMediaKeys: ["media-b"]
    }
    const secondReport: DeleteReport = {
      reportId: "pre-operation-b",
      operationId: "operation-b",
      createdAt: new Date().toISOString(),
      totalGroupsAffected: 1,
      totalItemsKept: 1,
      totalItemsSelectedForTrash: 1,
      trashBatchSize: 25,
      items: []
    }
    licenseStorage.set(RECOVERY_HISTORY_STORAGE_KEY, [first.record])

    let releaseFirstRead!: () => void
    let markFirstReadStarted!: () => void
    const firstReadStarted = new Promise<void>((resolve) => {
      markFirstReadStarted = resolve
    })
    const firstReadGate = new Promise<void>((resolve) => {
      releaseFirstRead = resolve
    })
    let heldFirstRead = false
    storageLocal.get.mockImplementation(async (key: string) => {
      if (key === RECOVERY_HISTORY_STORAGE_KEY && !heldFirstRead) {
        heldFirstRead = true
        markFirstReadStarted()
        await firstReadGate
      }
      const value = licenseStorage.get(key)
      return value === undefined ? {} : { [key]: value }
    })

    const firstCall = dispatchMessageAndWaitForResponse(
      recoveryMessage(beginAmazonRestore("operation-a", "dedup-a")),
      recoveryAppSender()
    )
    await firstReadStarted
    const secondCall = dispatchMessageAndWaitForResponse(
      recoveryMessage({
        kind: "createPendingTrash",
        report: secondReport,
        context: secondContext
      }),
      recoveryAppSender()
    )
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(storageLocal.get).toHaveBeenCalledTimes(1)

    releaseFirstRead()
    const [firstResponse, secondResponse] = await Promise.all([
      firstCall,
      secondCall
    ])
    expect(firstResponse).toMatchObject({ success: true })
    expect(secondResponse).toMatchObject({ success: true })
    const records = licenseStorage.get(
      RECOVERY_HISTORY_STORAGE_KEY
    ) as Array<{
      operationId: string
      restorableDedupKeys: string[]
      restoreOutcomeHistory?: Array<{ terminal?: boolean; outcomes: Array<{ targetKey: string }> }>
    }>
    expect(records.map((record) => record.operationId).sort()).toEqual([
      "operation-a",
      "operation-b"
    ])
    expect(
      records.find((record) => record.operationId === "operation-a")
        ?.restoreOutcomeHistory?.[0]
    ).toMatchObject({ terminal: false, outcomes: [{ targetKey: "dedup-a" }] })
  })

  it("rejects same-scope overlap across separate recovery operations", async () => {
    const first = createRestorableAmazonRecord("operation-a", "same-target", "media-a")
    const second = createRestorableAmazonRecord("operation-b", "same-target", "media-b")
    licenseStorage.set(RECOVERY_HISTORY_STORAGE_KEY, [first.record, second.record])

    const firstResponse = await dispatchMessageAndWaitForResponse(
      recoveryMessage(beginAmazonRestore("operation-a", "same-target")),
      recoveryAppSender()
    )
    const secondResponse = await dispatchMessageAndWaitForResponse(
      recoveryMessage(beginAmazonRestore("operation-b", "same-target")),
      recoveryAppSender()
    )
    expect(firstResponse).toMatchObject({ success: true })
    expect(secondResponse).toMatchObject({ success: false })
    const records = licenseStorage.get(
      RECOVERY_HISTORY_STORAGE_KEY
    ) as Array<{ operationId: string; restoreOutcomeHistory?: Array<unknown> }>
    expect(
      records.find((record) => record.operationId === "operation-a")
        ?.restoreOutcomeHistory
    ).toHaveLength(1)
    expect(
      records.find((record) => record.operationId === "operation-b")
        ?.restoreOutcomeHistory
    ).toBeUndefined()
  })

  it("retains an unresolved restore guard beyond the ordinary history capacity", async () => {
    const active = createRestorableAmazonRecord(
      "operation-active",
      "capacity-target",
      "media-active"
    )
    licenseStorage.set(RECOVERY_HISTORY_STORAGE_KEY, [active.record])
    const activeBegin = await dispatchMessageAndWaitForResponse(
      recoveryMessage(beginAmazonRestore("operation-active", "capacity-target")),
      recoveryAppSender()
    )
    expect(activeBegin).toMatchObject({ success: true })

    let latestOperationId = ""
    for (let index = 0; index < 20; index += 1) {
      latestOperationId = `operation-later-${index}`
      const later = createRestorableAmazonRecord(
        latestOperationId,
        "capacity-target",
        `media-later-${index}`
      )
      const pending = await dispatchMessageAndWaitForResponse(
        recoveryMessage({
          kind: "createPendingTrash",
          report: later.preTrashReport,
          context: later.context
        }),
        recoveryAppSender()
      )
      expect(pending).toMatchObject({ success: true })
      const confirmed = await dispatchMessageAndWaitForResponse(
        recoveryMessage({
          kind: "recordTrashResult",
          report: later.trashResult,
          context: later.context
        }),
        recoveryAppSender()
      )
      expect(confirmed).toMatchObject({ success: true })
    }

    const stored = licenseStorage.get(
      RECOVERY_HISTORY_STORAGE_KEY
    ) as Array<{
      operationId: string
      restoreOutcomeHistory?: Array<{ requestId?: string; terminal?: boolean }>
    }>
    expect(stored).toHaveLength(20)
    expect(stored.map((record) => record.operationId)).toContain(
      "operation-active"
    )
    expect(
      stored.find((record) => record.operationId === "operation-active")
        ?.restoreOutcomeHistory?.[0]
    ).toMatchObject({ requestId: "restore-operation-active", terminal: false })

    const replay = await dispatchMessageAndWaitForResponse(
      recoveryMessage(beginAmazonRestore(latestOperationId, "capacity-target")),
      recoveryAppSender()
    )
    expect(replay).toMatchObject({ success: false })
  })

  it("accepts only an exact target vector for an idempotent terminal update", async () => {
    const operationId = "operation-exact-terminal"
    const targetDedupKeys = ["target-a", "target-b"]
    const attemptedMediaKeys = ["media-a", "media-b"]
    const context: RecoveryHistoryContext = {
      operationId,
      provider: "amazon",
      providerSessionId: "amazon-session-a",
      attemptedDedupKeys: targetDedupKeys,
      attemptedMediaKeys
    }
    const preTrashReport: DeleteReport = {
      reportId: "pre-exact-terminal",
      operationId,
      createdAt: new Date().toISOString(),
      totalGroupsAffected: 2,
      totalItemsKept: 2,
      totalItemsSelectedForTrash: 2,
      trashBatchSize: 25,
      items: []
    }
    const pending = createPendingRecoveryRecord(preTrashReport, context)
    const trashResult: TrashResultReport = {
      reportId: "trash-exact-terminal",
      operationId,
      createdAt: new Date().toISOString(),
      status: "complete",
      attemptedCount: 2,
      movedCount: 2,
      failedCount: 0,
      attemptedMediaKeys,
      attemptedDedupKeys: targetDedupKeys,
      movedMediaKeys: attemptedMediaKeys,
      movedDedupKeys: targetDedupKeys,
      failedMediaKeys: [],
      failedDedupKeys: [],
      retryAttempts: 0,
      error: null
    }
    const record = updateRecoveryRecordFromTrash(
      [pending],
      trashResult,
      context
    )[0]!
    licenseStorage.set(RECOVERY_HISTORY_STORAGE_KEY, [record])
    const requestId = "restore-exact-vector"
    const begin = await dispatchMessageAndWaitForResponse(
      recoveryMessage({
        ...beginAmazonRestore(operationId, targetDedupKeys[0]!),
        requestId,
        targetDedupKeys
      }),
      recoveryAppSender()
    )
    expect(begin).toMatchObject({ success: true })

    const confirmedOutcomes = targetDedupKeys.map((targetKey) => ({
      operation: "restore",
      targetKey,
      status: "confirmed"
    }))
    const terminalParams = {
      outcome: "complete",
      requestId,
      terminal: true,
      restoredDedupKeys: targetDedupKeys,
      unknownDedupKeys: [],
      notDispatchedDedupKeys: [],
      outcomes: confirmedOutcomes
    }
    const terminal = await dispatchMessageAndWaitForResponse(
      recoveryMessage({
        kind: "updateRestore",
        operationId,
        requestId,
        provider: "amazon",
        providerSessionId: "amazon-session-a",
        params: terminalParams
      }),
      recoveryAppSender()
    )
    expect(terminal).toMatchObject({ success: true })

    const duplicateTerminal = await dispatchMessageAndWaitForResponse(
      recoveryMessage({
        kind: "updateRestore",
        operationId,
        requestId,
        provider: "amazon",
        providerSessionId: "amazon-session-a",
        params: terminalParams
      }),
      recoveryAppSender()
    )
    expect(duplicateTerminal).toMatchObject({ success: true })

    const malformedDuplicate = await dispatchMessageAndWaitForResponse(
      recoveryMessage({
        kind: "updateRestore",
        operationId,
        requestId,
        provider: "amazon",
        providerSessionId: "amazon-session-a",
        params: {
          ...terminalParams,
          outcomes: [confirmedOutcomes[0], confirmedOutcomes[0]]
        }
      }),
      recoveryAppSender()
    )
    expect(malformedDuplicate).toMatchObject({ success: false })
  })

  it.each(["google", "icloud"] as const)(
    "allows a verified %s account to restore after its provider page session refreshes",
    async (provider) => {
      const email = "pawsitivegames@example.test"
      const stored = createRestorableFingerprintRecord(
        provider,
        `refresh-${provider}`,
        `dedup-${provider}`,
        `media-${provider}`,
        email,
        `${provider}-old-session`
      )
      licenseStorage.set(RECOVERY_HISTORY_STORAGE_KEY, [stored.record])

      const response = await dispatchMessageAndWaitForResponse(
        recoveryMessage(
          beginFingerprintRestore(
            provider,
            `refresh-${provider}`,
            `dedup-${provider}`,
            `${provider}-new-session`,
            email
          )
        ),
        recoveryAppSender()
      )

      expect(response).toMatchObject({ success: true })
      expect(
        (licenseStorage.get(RECOVERY_HISTORY_STORAGE_KEY) as Array<{
          providerSessionId: string
          restoreOutcomeHistory?: Array<{ terminal?: boolean }>
        }>)[0]?.restoreOutcomeHistory?.[0]
      ).toMatchObject({ terminal: false })
    }
  )

  it("rejects a changed verified account and reserves overlap across refreshed sessions", async () => {
    const email = "pawsitivegames@example.test"
    const first = createRestorableFingerprintRecord(
      "icloud",
      "fingerprint-operation-a",
      "fingerprint-shared-target",
      "fingerprint-media-a",
      email,
      "icloud-old-session"
    )
    const second = createRestorableFingerprintRecord(
      "icloud",
      "fingerprint-operation-b",
      "fingerprint-shared-target",
      "fingerprint-media-b",
      email,
      "icloud-old-session"
    )
    licenseStorage.set(RECOVERY_HISTORY_STORAGE_KEY, [first.record])

    const changedAccount = await dispatchMessageAndWaitForResponse(
      recoveryMessage(
        beginFingerprintRestore(
          "icloud",
          "fingerprint-operation-a",
          "fingerprint-shared-target",
          "icloud-new-session",
          "different@example.test",
          "restore-changed-account"
        )
      ),
      recoveryAppSender()
    )
    expect(changedAccount).toMatchObject({ success: false })
    expect(
      (licenseStorage.get(RECOVERY_HISTORY_STORAGE_KEY) as Array<{
        restorableDedupKeys: string[]
      }>)[0]?.restorableDedupKeys
    ).toEqual(["fingerprint-shared-target"])

    licenseStorage.set(RECOVERY_HISTORY_STORAGE_KEY, [first.record, second.record])
    const firstBegin = await dispatchMessageAndWaitForResponse(
      recoveryMessage(
        beginFingerprintRestore(
          "icloud",
          "fingerprint-operation-a",
          "fingerprint-shared-target",
          "icloud-session-b",
          email,
          "restore-first-fingerprint-target"
        )
      ),
      recoveryAppSender()
    )
    const overlappingBegin = await dispatchMessageAndWaitForResponse(
      recoveryMessage(
        beginFingerprintRestore(
          "icloud",
          "fingerprint-operation-b",
          "fingerprint-shared-target",
          "icloud-session-c",
          email,
          "restore-second-fingerprint-target"
        )
      ),
      recoveryAppSender()
    )
    expect(firstBegin).toMatchObject({ success: true })
    expect(overlappingBegin).toMatchObject({ success: false })
  })

  it("fails closed on write or readback failure and leaves any committed guard in storage", async () => {
    const first = createRestorableAmazonRecord("operation-a", "dedup-a", "media-a")
    licenseStorage.set(RECOVERY_HISTORY_STORAGE_KEY, [first.record])
    storageLocal.set.mockRejectedValueOnce(new Error("storage unavailable"))

    const failedWrite = await dispatchMessageAndWaitForResponse(
      recoveryMessage(beginAmazonRestore("operation-a", "dedup-a")),
      recoveryAppSender()
    )
    expect(failedWrite).toMatchObject({ success: false })
    expect(
      (licenseStorage.get(RECOVERY_HISTORY_STORAGE_KEY) as Array<{
        restorableDedupKeys: string[]
      }>)[0]?.restorableDedupKeys
    ).toEqual(["dedup-a"])

    let readCount = 0
    storageLocal.get.mockImplementation(async (key: string) => {
      if (key === RECOVERY_HISTORY_STORAGE_KEY) {
        readCount += 1
        if (readCount === 2) return { [key]: [first.record] }
      }
      const value = licenseStorage.get(key)
      return value === undefined ? {} : { [key]: value }
    })
    const failedReadback = await dispatchMessageAndWaitForResponse(
      recoveryMessage(beginAmazonRestore("operation-a", "dedup-a")),
      recoveryAppSender()
    )
    expect(failedReadback).toMatchObject({ success: false })
    const committed = licenseStorage.get(
      RECOVERY_HISTORY_STORAGE_KEY
    ) as Array<{
      restorableDedupKeys: string[]
      restoreOutcomes?: Array<{ targetKey: string; status: string }>
    }>
    expect(committed[0]?.restorableDedupKeys).toEqual([])
    expect(committed[0]?.restoreOutcomes).toContainEqual({
      operation: "restore",
      targetKey: "dedup-a",
      status: "unknown",
      reason: "durable-pre-dispatch-intent"
    })
  })

  it("keeps a provisional guard after terminal set failure and accepts only the exact late result", async () => {
    const first = createRestorableAmazonRecord("operation-terminal-set", "dedup-terminal-set", "media-terminal-set")
    licenseStorage.set(RECOVERY_HISTORY_STORAGE_KEY, [first.record])
    const begin = await dispatchMessageAndWaitForResponse(
      recoveryMessage(beginAmazonRestore("operation-terminal-set", "dedup-terminal-set")),
      recoveryAppSender()
    )
    expect(begin).toMatchObject({ success: true })

    storageLocal.set.mockRejectedValueOnce(new Error("terminal write unavailable"))
    const failedTerminal = await dispatchMessageAndWaitForResponse(
      recoveryMessage(completeAmazonRestore("operation-terminal-set", "dedup-terminal-set")),
      recoveryAppSender()
    )
    expect(failedTerminal).toMatchObject({ success: false })
    expect(
      (licenseStorage.get(RECOVERY_HISTORY_STORAGE_KEY) as Array<{
        restorableDedupKeys: string[]
        restoreOutcomeHistory?: Array<{ requestId?: string; terminal?: boolean }>
      }>)[0]
    ).toMatchObject({
      restorableDedupKeys: [],
      restoreOutcomeHistory: [{ requestId: "restore-operation-terminal-set", terminal: false }]
    })

    const competingBegin = await dispatchMessageAndWaitForResponse(
      recoveryMessage({
        ...beginAmazonRestore("operation-terminal-set", "dedup-terminal-set"),
        requestId: "restore-operation-terminal-set-replay"
      }),
      recoveryAppSender()
    )
    expect(competingBegin).toMatchObject({ success: false })

    const exactLateTerminal = await dispatchMessageAndWaitForResponse(
      recoveryMessage(completeAmazonRestore("operation-terminal-set", "dedup-terminal-set")),
      recoveryAppSender()
    )
    expect(exactLateTerminal).toMatchObject({ success: true })
    const resolved = (licenseStorage.get(
      RECOVERY_HISTORY_STORAGE_KEY
    ) as Array<{
      status: string
      restorableDedupKeys: string[]
      restoreUnknownCount?: number
      restoreOutcomeHistory?: Array<{
        requestId?: string
        terminal?: boolean
        outcomes: Array<{ targetKey: string; status: string }>
      }>
    }>)[0]
    expect(resolved).toMatchObject({
      status: "restored",
      restorableDedupKeys: [],
      restoreUnknownCount: 0,
      restoreOutcomeHistory: [
        {
          requestId: "restore-operation-terminal-set",
          terminal: true,
          outcomes: [{ targetKey: "dedup-terminal-set", status: "confirmed" }]
        }
      ]
    })
  })

  it.each(["mismatched-readback", "failed-readback"] as const)(
    "does not reopen a committed terminal target when terminal %s cannot be verified",
    async (readbackFailure) => {
      const operationId = `operation-terminal-${readbackFailure}`
      const targetDedupKey = `dedup-terminal-${readbackFailure}`
      const first = createRestorableAmazonRecord(
        operationId,
        targetDedupKey,
        `media-terminal-${readbackFailure}`
      )
      licenseStorage.set(RECOVERY_HISTORY_STORAGE_KEY, [first.record])
      const begin = await dispatchMessageAndWaitForResponse(
        recoveryMessage(beginAmazonRestore(operationId, targetDedupKey)),
        recoveryAppSender()
      )
      expect(begin).toMatchObject({ success: true })
      const provisional = structuredClone(
        licenseStorage.get(RECOVERY_HISTORY_STORAGE_KEY)
      )

      let historyReads = 0
      storageLocal.get.mockImplementation(async (key: string) => {
        if (key === RECOVERY_HISTORY_STORAGE_KEY) {
          historyReads += 1
          if (historyReads === 2) {
            if (readbackFailure === "failed-readback") {
              throw new Error("terminal readback unavailable")
            }
            return { [key]: provisional }
          }
        }
        const value = licenseStorage.get(key)
        return value === undefined ? {} : { [key]: value }
      })

      const terminal = await dispatchMessageAndWaitForResponse(
        recoveryMessage(completeAmazonRestore(operationId, targetDedupKey)),
        recoveryAppSender()
      )
      expect(terminal).toMatchObject({ success: false })

      const committed = (licenseStorage.get(
        RECOVERY_HISTORY_STORAGE_KEY
      ) as Array<{
        status: string
        restorableDedupKeys: string[]
        restoreOutcomeHistory?: Array<{
          requestId?: string
          terminal?: boolean
          outcomes: Array<{ targetKey: string; status: string }>
        }>
      }>)[0]
      expect(committed).toMatchObject({
        status: "restored",
        restorableDedupKeys: [],
        restoreOutcomeHistory: [
          {
            requestId: `restore-${operationId}`,
            terminal: true,
            outcomes: [{ targetKey: targetDedupKey, status: "confirmed" }]
          }
        ]
      })

      storageLocal.get.mockImplementation(async (key: string) => {
        const value = licenseStorage.get(key)
        return value === undefined ? {} : { [key]: value }
      })
      const replay = await dispatchMessageAndWaitForResponse(
        recoveryMessage({
          ...beginAmazonRestore(operationId, targetDedupKey),
          requestId: `new-${operationId}`
        }),
        recoveryAppSender()
      )
      expect(replay).toMatchObject({ success: false })
    }
  )

  it("preserves a terminal vector committed before storage reports an error", async () => {
    const operationId = "operation-terminal-committed-error"
    const targetDedupKey = "dedup-terminal-committed-error"
    const first = createRestorableAmazonRecord(
      operationId,
      targetDedupKey,
      "media-terminal-committed-error"
    )
    licenseStorage.set(RECOVERY_HISTORY_STORAGE_KEY, [first.record])
    const begin = await dispatchMessageAndWaitForResponse(
      recoveryMessage(beginAmazonRestore(operationId, targetDedupKey)),
      recoveryAppSender()
    )
    expect(begin).toMatchObject({ success: true })

    storageLocal.set.mockImplementationOnce(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) {
        licenseStorage.set(key, value)
      }
      throw new Error("storage reported failure after commit")
    })
    const ambiguousAck = await dispatchMessageAndWaitForResponse(
      recoveryMessage(completeAmazonRestore(operationId, targetDedupKey)),
      recoveryAppSender()
    )
    expect(ambiguousAck).toMatchObject({ success: false })

    const stored = (licenseStorage.get(
      RECOVERY_HISTORY_STORAGE_KEY
    ) as Array<{
      status: string
      restorableDedupKeys: string[]
      restoreOutcomeHistory?: Array<{ terminal?: boolean; outcomes: Array<{ targetKey: string; status: string }> }>
    }>)[0]
    expect(stored).toMatchObject({
      status: "restored",
      restorableDedupKeys: [],
      restoreOutcomeHistory: [
        {
          terminal: true,
          outcomes: [{ targetKey: targetDedupKey, status: "confirmed" }]
        }
      ]
    })

    const writesBeforeIdempotentReply = storageLocal.set.mock.calls.length
    const exactRetry = await dispatchMessageAndWaitForResponse(
      recoveryMessage(completeAmazonRestore(operationId, targetDedupKey)),
      recoveryAppSender()
    )
    expect(exactRetry).toMatchObject({ success: true })
    expect(storageLocal.set).toHaveBeenCalledTimes(writesBeforeIdempotentReply)

    const newAttempt = await dispatchMessageAndWaitForResponse(
      recoveryMessage({
        ...beginAmazonRestore(operationId, targetDedupKey),
        requestId: "new-terminal-committed-error-attempt"
      }),
      recoveryAppSender()
    )
    expect(newAttempt).toMatchObject({ success: false })
  })

  it("retains active guards on clear and prevents late trash-result overwrite", async () => {
    const active = createRestorableAmazonRecord("operation-a", "dedup-a", "media-a")
    const completed = createRestorableAmazonRecord(
      "operation-b",
      "dedup-b",
      "media-b"
    )
    licenseStorage.set(RECOVERY_HISTORY_STORAGE_KEY, [active.record, completed.record])
    const begin = await dispatchMessageAndWaitForResponse(
      recoveryMessage(beginAmazonRestore("operation-a", "dedup-a")),
      recoveryAppSender()
    )
    expect(begin).toMatchObject({ success: true })

    const clear = await dispatchMessageAndWaitForResponse(
      recoveryMessage({ kind: "clear" }),
      recoveryAppSender()
    )
    expect(clear).toMatchObject({ success: true })
    expect((clear as { records: Array<{ operationId: string }> }).records).toEqual(
      expect.arrayContaining([expect.objectContaining({ operationId: "operation-a" })])
    )
    expect(
      (clear as { records: Array<{ operationId: string }> }).records.map(
        (record) => record.operationId
      )
    ).toEqual(["operation-a"])

    const staleTrashResult: TrashResultReport = {
      reportId: "late-trash-operation-a",
      operationId: "operation-a",
      createdAt: new Date().toISOString(),
      status: "complete",
      attemptedCount: 1,
      movedCount: 1,
      failedCount: 0,
      attemptedMediaKeys: ["media-a"],
      attemptedDedupKeys: ["dedup-a"],
      movedMediaKeys: ["media-a"],
      movedDedupKeys: ["dedup-a"],
      failedMediaKeys: [],
      failedDedupKeys: [],
      retryAttempts: 0,
      error: null
    }
    const trashResult = await dispatchMessageAndWaitForResponse(
      recoveryMessage({
        kind: "recordTrashResult",
        report: staleTrashResult,
        context: active.context
      }),
      recoveryAppSender()
    )
    expect(trashResult).toMatchObject({ success: false })
    expect(
      (licenseStorage.get(RECOVERY_HISTORY_STORAGE_KEY) as Array<{
        operationId: string
        restoreOutcomeHistory?: Array<{ terminal?: boolean }>
      }>)[0]?.restoreOutcomeHistory?.[0]
    ).toMatchObject({ terminal: false })
  })

  it("rejects provider-page messages and a fresh worker cannot replay a persisted guard", async () => {
    const active = createRestorableAmazonRecord("operation-a", "dedup-a", "media-a")
    licenseStorage.set(RECOVERY_HISTORY_STORAGE_KEY, [active.record])
    const unauthorized = await dispatchMessageAndWaitForResponse(
      recoveryMessage(beginAmazonRestore("operation-a", "dedup-a")),
      {
        id: mockChrome.runtime.id,
        url: "https://www.amazon.ca/photos",
        frameId: 0,
        tab: { id: 77, url: "https://www.amazon.ca/photos" } as chrome.tabs.Tab
      }
    )
    expect(unauthorized).toMatchObject({ success: false })
    expect(storageLocal.get).not.toHaveBeenCalled()

    const firstWorker = await dispatchMessageAndWaitForResponse(
      recoveryMessage(beginAmazonRestore("operation-a", "dedup-a")),
      recoveryAppSender()
    )
    expect(firstWorker).toMatchObject({ success: true })

    await vi.resetModules()
    const restarted = await import("../../background/recovery-history-transactions")
    const afterRestart = await restarted.handleRecoveryHistoryTransaction(
      recoveryMessage({
        ...beginAmazonRestore("operation-a", "dedup-a"),
        requestId: "restore-after-worker-restart"
      }) as RecoveryHistoryTransactionMessage,
      recoveryAppSender() as chrome.runtime.MessageSender
    )
    expect(afterRestart).toMatchObject({ success: false })
    expect(
      (licenseStorage.get(RECOVERY_HISTORY_STORAGE_KEY) as Array<{
        restoreOutcomeHistory?: Array<{ requestId?: string; terminal?: boolean }>
      }>)[0]?.restoreOutcomeHistory?.[0]
    ).toMatchObject({ requestId: "restore-operation-a", terminal: false })
  })

  it("accepts native extension app contexts without tab/frame metadata and rejects explicit child or foreign contexts", async () => {
    for (const path of ["/tabs/app.html", "/tabs/scanner-panel.html"]) {
      const response = await dispatchMessageAndWaitForResponse(
        recoveryMessage({ kind: "read" }),
        {
          id: mockChrome.runtime.id,
          url: `chrome-extension://${mockChrome.runtime.id}${path}`
        }
      )
      expect(response).toMatchObject({ success: true })
    }

    const childFrame = await dispatchMessageAndWaitForResponse(
      recoveryMessage({ kind: "read" }),
      {
        id: mockChrome.runtime.id,
        url: `chrome-extension://${mockChrome.runtime.id}/tabs/app.html`,
        frameId: 2
      }
    )
    const foreignExtensionPath = await dispatchMessageAndWaitForResponse(
      recoveryMessage({ kind: "read" }),
      {
        id: mockChrome.runtime.id,
        url: `chrome-extension://${mockChrome.runtime.id}/provider/index.html`
      }
    )
    expect(childFrame).toMatchObject({ success: false })
    expect(foreignExtensionPath).toMatchObject({ success: false })
  })
})
