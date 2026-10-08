import {
  getProviderOperations,
  providerLabel as providerName,
  providerMatchesUrl,
  providerOpenUrl,
  providerTabPatterns
} from "../lib/provider-operations"
import { ProviderConnectionSession } from "../lib/provider-connection-session"
import {
  isAllowedLicenseSessionSender,
  isLicenseSessionExternalMessage,
  LICENSE_SESSION_STORAGE_KEY
} from "../lib/license-session"
import {
  getProviderCommandPublicKey,
  withProviderCommandCapability
} from "../lib/provider-command-capability"
import { attachRuntimeBuildIdentity } from "../lib/runtime-build-identity"
import { handleRecoveryHistoryTransaction } from "./recovery-history-transactions"
import {
  fetchGoogleOriginalHash,
  GoogleOriginalReviewBudget,
  GOOGLE_ORIGINAL_ITEM_MAX_BYTES,
  GOOGLE_ORIGINAL_REVIEW_MAX_BYTES
} from "../lib/google-original-fetch"
import {
  GoogleCompletedScanRegistry,
  type GoogleOriginalRelayMediaKind
} from "../lib/google-original-relay"
import { APP_ID } from "../lib/types"
import type {
  AppMessage,
  GptkCommandMessage,
  GptkProgressMessage,
  GptkResultMessage,
  LaunchProviderResult,
  ProviderOriginalHashCancelMessage,
  ProviderOriginalHashFetchMessage,
  ProviderOriginalHashRelayResponse,
  RecoveryHistoryTransactionMessage,
  PhotoProvider
} from "../lib/types"

// Service worker for PhotoSweep.
// Routes messages between the app tab and the active photo-provider tab.

const connectionSession = new ProviderConnectionSession()
const googleCompletedScans = new GoogleCompletedScanRegistry()
const googleOriginalReviewBudget = new GoogleOriginalReviewBudget()
const activeSidePanelClientIds = new Set<string>()

interface GoogleOriginalRequestContext {
  requestId: string
  appTabId: number | null
  appClientId?: string
  providerTabId: number
  accountEmail: string
  providerSessionId: string
  scopeFingerprint: string
  mediaKey: string
  mediaKind: GoogleOriginalRelayMediaKind
  maxBytes: number
  aggregateBudgetBytes: number
  used: boolean
}

interface ActiveGoogleOriginalFetch {
  context: GoogleOriginalRequestContext
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  reservation: ReturnType<GoogleOriginalReviewBudget["reserve"]>
}

const pendingGoogleScanContexts = new Map<
  string,
  {
    appTabId: number | null
    appClientId?: string
    providerTabId: number
    accountEmail: string
    scopeFingerprint: string
  }
>()
const pendingGoogleOriginalRequests = new Map<string, GoogleOriginalRequestContext>()
const activeGoogleOriginalFetches = new Map<string, ActiveGoogleOriginalFetch>()
const knownGoogleProviderSessions = new Map<number, string>()

type ChromeWithSidePanel = typeof chrome & {
  sidePanel?: {
    setPanelBehavior?: (options: {
      openPanelOnActionClick: boolean
    }) => Promise<void>
    setOptions?: (options: {
      tabId?: number
      path?: string
      enabled?: boolean
    }) => Promise<void>
    open?: (options: { tabId?: number; windowId?: number }) => Promise<void>
  }
}

const sidePanelApi = (chrome as ChromeWithSidePanel).sidePanel
const SIDE_PANEL_PATH = "tabs/scanner-panel.html"
const GPTK_COMMAND_TIMEOUT_MS = 3500
const GOOGLE_ORIGINAL_RELAY_TIMEOUT_MS = 60_000

type ManifestWithExternalConnectable = {
  externally_connectable?: {
    matches?: unknown
  }
}

function externalMessageMatchPatterns(): readonly string[] {
  try {
    const manifest = chrome.runtime.getManifest() as unknown as
      ManifestWithExternalConnectable
    const matches = manifest.externally_connectable?.matches
    return Array.isArray(matches)
      ? matches.filter((match): match is string => typeof match === "string")
      : []
  } catch {
    return []
  }
}

const externalLicenseSessionMatchPatterns = externalMessageMatchPatterns()

export async function handleExternalLicenseSessionMessage(
  message: unknown,
  senderUrl: unknown,
  matchPatterns: readonly string[] = externalLicenseSessionMatchPatterns,
  storage: Pick<chrome.storage.StorageArea, "set"> = chrome.storage.local
): Promise<boolean> {
  if (
    !isLicenseSessionExternalMessage(message) ||
    !isAllowedLicenseSessionSender(senderUrl, matchPatterns)
  ) {
    return false
  }

  await storage.set({
    [LICENSE_SESSION_STORAGE_KEY]: message.licenseSessionId
  })
  return true
}

function disableDefaultSidePanel(): void {
  if (!sidePanelApi?.setOptions) return
  sidePanelApi.setOptions({ enabled: false }).catch((error) => {
    console.warn("[GPD] unable to disable default side panel", error)
  })
}

disableDefaultSidePanel()

function configureActionSidePanelBehavior(): void {
  if (!sidePanelApi?.setPanelBehavior) return
  sidePanelApi
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => {
      console.warn(
        "[GPD] unable to configure side panel action behavior",
        error
      )
    })
}

async function enableSidePanelForTab(tabId: number): Promise<void> {
  if (!sidePanelApi?.setOptions) return
  await sidePanelApi.setOptions({
    tabId,
    path: SIDE_PANEL_PATH,
    enabled: true
  })
}

function enableActiveSidePanels(): void {
  chrome.tabs
    .query({ active: true })
    .then((tabs) => {
      for (const tab of tabs) {
        if (hasTabId(tab)) {
          enableSidePanelForTab(tab.id).catch((error) => {
            console.warn("[GPD] unable to enable tab side panel", error)
          })
        }
      }
    })
    .catch(() => {})
}

configureActionSidePanelBehavior()

function providerOpenUrlForTab(
  provider: PhotoProvider,
  tab: Pick<chrome.tabs.Tab, "url"> | undefined
): string {
  if (!tab?.url || !providerMatchesUrl(tab.url, provider)) {
    return providerOpenUrl(provider)
  }
  try {
    const url = new URL(tab.url)
    return providerOpenUrl(provider, url.origin)
  } catch {
    // Fall back to the default provider URL.
  }
  return providerOpenUrl(provider)
}

function isProviderPhotosPage(
  tab: Pick<chrome.tabs.Tab, "url"> | undefined,
  provider: PhotoProvider
): boolean {
  return providerMatchesUrl(tab?.url, provider, true)
}

function tabMatchesProvider(
  tab: Pick<chrome.tabs.Tab, "url"> | undefined,
  provider: PhotoProvider
): boolean {
  return providerMatchesUrl(tab?.url, provider)
}

function canInjectProviderBridge(
  tab: Pick<chrome.tabs.Tab, "url"> | undefined,
  provider: PhotoProvider
): boolean {
  // Amazon's bridge must never be injected into ordinary shopping pages. The
  // other providers already scope their bridge behavior to their provider tab
  // and retain their established origin matching here.
  return provider === "amazon"
    ? isProviderPhotosPage(tab, provider)
    : tabMatchesProvider(tab, provider)
}

function canNavigateTabToProvider(tab: Pick<chrome.tabs.Tab, "url">): boolean {
  return !tab.url?.startsWith("chrome-extension://")
}

function hasTabId(tab: Pick<chrome.tabs.Tab, "id">): tab is chrome.tabs.Tab & {
  id: number
} {
  return tab.id !== undefined && tab.id !== null
}

function isSidePanelSender(sender: chrome.runtime.MessageSender): boolean {
  return Boolean(
    sender.url?.includes(SIDE_PANEL_PATH) ||
      sender.tab?.url?.includes(SIDE_PANEL_PATH)
  )
}

function trustedExtensionUiContext(
  sender: chrome.runtime.MessageSender,
  clientId?: string
): { appTabId: number | null; clientId?: string } | null {
  if (sender.id !== chrome.runtime.id) return null
  const senderUrl = sender.url ?? sender.tab?.url
  if (typeof senderUrl !== "string") return null
  let parsed: URL
  try {
    parsed = new URL(senderUrl)
  } catch {
    return null
  }
  if (
    parsed.protocol !== "chrome-extension:" ||
    parsed.host !== chrome.runtime.id
  ) {
    return null
  }
  if (parsed.pathname === "/tabs/app.html") {
    return {
      appTabId: sender.tab?.id ?? null,
      ...(clientId ? { clientId } : {})
    }
  }
  if (
    parsed.pathname === `/${SIDE_PANEL_PATH}` &&
    typeof clientId === "string" &&
    clientId.length > 0 &&
    clientId.length <= 128 &&
    activeSidePanelClientIds.has(clientId)
  ) {
    return { appTabId: null, clientId }
  }
  return null
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 && normalized.length <= 320 ? normalized : null
}

function validGoogleOriginalKind(value: unknown): value is GoogleOriginalRelayMediaKind {
  return value === "photo" || value === "video" || value === "live-photo"
}

function validScopeFingerprint(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function isGooglePhotosPageSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0) return false
  const pageUrl = sender.url ?? sender.tab?.url
  if (typeof pageUrl !== "string") return false
  try {
    const parsed = new URL(pageUrl)
    return parsed.protocol === "https:" && parsed.hostname === "photos.google.com"
  } catch {
    return false
  }
}

function sameOriginalRequest(
  context: GoogleOriginalRequestContext,
  message: Pick<ProviderOriginalHashFetchMessage, "requestId" | "providerSessionId" | "scanScopeFingerprint" | "mediaKey" | "mediaKind" | "maxBytes" | "aggregateBudgetBytes">
): boolean {
  return (
    context.requestId === message.requestId &&
    context.providerSessionId === message.providerSessionId &&
    context.scopeFingerprint === message.scanScopeFingerprint &&
    context.mediaKey === message.mediaKey &&
    context.mediaKind === message.mediaKind &&
    context.maxBytes === message.maxBytes &&
    context.aggregateBudgetBytes === message.aggregateBudgetBytes
  )
}

function abortGoogleOriginalFetch(requestId: string): void {
  const active = activeGoogleOriginalFetches.get(requestId)
  if (!active) return
  active.controller.abort()
  clearTimeout(active.timer)
  active.reservation.release()
}

function cancelGoogleOriginalRequestsForOwner(
  appTabId: number | null,
  clientId: string | undefined,
  providerTabId: number
): void {
  for (const [requestId, context] of pendingGoogleOriginalRequests) {
    if (
      context.appTabId === appTabId &&
      context.appClientId === clientId &&
      context.providerTabId === providerTabId
    ) {
      abortGoogleOriginalFetch(requestId)
      pendingGoogleOriginalRequests.delete(requestId)
    }
  }
  for (const [requestId, context] of pendingGoogleScanContexts) {
    if (
      context.appTabId === appTabId &&
      context.appClientId === clientId &&
      context.providerTabId === providerTabId
    ) {
      pendingGoogleScanContexts.delete(requestId)
    }
  }
  googleCompletedScans.invalidateOwner(appTabId, clientId, providerTabId)
}

function invalidateGoogleProviderTab(providerTabId: number): void {
  googleCompletedScans.invalidateProviderTab(providerTabId)
  knownGoogleProviderSessions.delete(providerTabId)
  for (const [requestId, context] of pendingGoogleOriginalRequests) {
    if (context.providerTabId !== providerTabId) continue
    abortGoogleOriginalFetch(requestId)
    pendingGoogleOriginalRequests.delete(requestId)
  }
  for (const [requestId, context] of pendingGoogleScanContexts) {
    if (context.providerTabId === providerTabId) {
      pendingGoogleScanContexts.delete(requestId)
    }
  }
}

function rememberGoogleProviderSession(
  providerTabId: number,
  providerSessionId: string
): void {
  const previous = knownGoogleProviderSessions.get(providerTabId)
  if (previous && previous !== providerSessionId) {
    invalidateGoogleProviderTab(providerTabId)
  }
  knownGoogleProviderSessions.set(providerTabId, providerSessionId)
}

// ============================================================
// Find tabs
// ============================================================

/**
 * Find a Google Photos tab that the bridge content script can actually reach.
 *
 * When the user has multiple photos.google.com tabs open (e.g. opened before
 * the extension was installed, or duplicated via the "Open Google Photos"
 * button), picking the first one returned by chrome.tabs.query is unreliable:
 * the bridge may not be loaded in it, and chrome.tabs.sendMessage rejects with
 * "Receiving end does not exist", surfacing as a spurious "Cannot connect to
 * Google Photos" error.
 *
 * Strategy: prefer the active tab, then sort by lastAccessed descending, and
 * ping each one until we find a reachable bridge. The bridge ignores
 * unrecognized actions, so a no-op ping resolves with undefined when reachable
 * and rejects when no content script is present.
 */
async function findProviderTab(
  provider: PhotoProvider = "google",
  preferredTabId?: number | null
): Promise<chrome.tabs.Tab | null> {
  if (preferredTabId !== undefined && preferredTabId !== null) {
    try {
      const preferredTab = await chrome.tabs.get(preferredTabId)
      if (
        hasTabId(preferredTab) &&
        canInjectProviderBridge(preferredTab, provider) &&
        (await ensureProviderBridge(preferredTab.id, provider))
      ) {
        return preferredTab
      }
    } catch {
      // Fall back to scanning provider tabs below.
    }
  }

  const tabResults = await Promise.all(
    providerTabPatterns(provider).map((url) => chrome.tabs.query({ url }))
  )
  const tabs = tabResults.flat()
  if (tabs.length === 0) return null

  // `lastAccessed` is available in Chrome 121+ but missing from this version
  // of @types/chrome.
  type TabWithLastAccessed = chrome.tabs.Tab & { lastAccessed?: number }
  const sorted = [...tabs].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    const aAccessed = (a as TabWithLastAccessed).lastAccessed ?? 0
    const bAccessed = (b as TabWithLastAccessed).lastAccessed ?? 0
    return bAccessed - aAccessed
  })

  for (const candidate of sorted) {
    if (!hasTabId(candidate)) continue
    if (provider === "amazon" && !isProviderPhotosPage(candidate, provider)) {
      continue
    }
    if (await ensureProviderBridge(candidate.id, provider)) {
      return candidate
    }
  }
  return null
}

async function pingProviderBridge(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      app: APP_ID,
      action: "ping"
    })
    return true
  } catch {
    return false
  }
}

async function ensureGoogleMainWorldScripts(tabId: number): Promise<boolean> {
  const [ready] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => ({
      hasGptk: typeof window.gptkApi !== "undefined",
      hasCommandHost: Boolean(
        (
          window as typeof window & {
            __GPD_COMMAND_HOST__?: unknown
          }
        ).__GPD_COMMAND_HOST__
      ),
      hasCommandHandler: Boolean(
        (
          window as typeof window & {
            __GPD_GOOGLE_COMMAND_HANDLER_LOADED__?: boolean
          }
        ).__GPD_GOOGLE_COMMAND_HANDLER_LOADED__
      )
    })
  })
  const state = ready?.result as
    | {
        hasGptk?: boolean
        hasCommandHost?: boolean
        hasCommandHandler?: boolean
      }
    | undefined
  if (state?.hasGptk && state.hasCommandHost && state.hasCommandHandler) {
    return true
  }

  if (!state?.hasGptk) {
    for (const file of [
      "scripts/unsafewindow-shim.js",
      "scripts/google-photos-toolkit.user.js"
    ]) {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        files: [file]
      })
    }
  }

  if (!state?.hasCommandHost) {
    const publicKey = await getProviderCommandPublicKey()
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (key: unknown) => {
        ;(
          window as typeof window & {
            __GPD_PROVIDER_COMMAND_PUBLIC_KEY__?: unknown
          }
        ).__GPD_PROVIDER_COMMAND_PUBLIC_KEY__ = key
      },
      args: [publicKey]
    })
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["scripts/photo-provider-command-host.js"]
    })
  }

  if (!state?.hasCommandHandler) {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["scripts/google-photos-commands.js"]
    })
  }

  const [after] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => ({
      hasGptk: typeof window.gptkApi !== "undefined",
      hasCommandHost: Boolean(
        (
          window as typeof window & {
            __GPD_COMMAND_HOST__?: unknown
          }
        ).__GPD_COMMAND_HOST__
      ),
      hasCommandHandler: Boolean(
        (
          window as typeof window & {
            __GPD_GOOGLE_COMMAND_HANDLER_LOADED__?: boolean
          }
        ).__GPD_GOOGLE_COMMAND_HANDLER_LOADED__
      )
    })
  })
  const afterState = after?.result as
    | {
        hasGptk?: boolean
        hasCommandHost?: boolean
        hasCommandHandler?: boolean
      }
    | undefined
  return afterState
    ? Boolean(afterState.hasCommandHost && afterState.hasCommandHandler)
    : true
}

function contentScriptFilesForProvider(provider: PhotoProvider): string[] {
  const patterns = providerTabPatterns(provider)
  const manifest = chrome.runtime.getManifest()
  return (
    manifest.content_scripts
      ?.filter((script) =>
        script.matches?.some((match) =>
          provider === "amazon"
            ? /^https:\/\/(?:www\.)?amazon\.[^/]+\/photos\*$/.test(match)
            : patterns.includes(match)
        )
      )
      .flatMap((script) => script.js ?? []) ?? []
  )
}

async function ensureProviderBridge(
  tabId: number,
  provider: PhotoProvider
): Promise<boolean> {
  if (await pingProviderBridge(tabId)) {
    if (provider !== "google") return true
    return ensureGoogleMainWorldScripts(tabId)
  }

  const files = contentScriptFilesForProvider(provider)
  if (files.length === 0) return false

  try {
    for (const file of files) {
      await chrome.scripting.executeScript({
        target: {
          tabId,
          allFrames: getProviderOperations(provider).injectBridgeIntoAllFrames
        },
        files: [file]
      })
    }
    if (provider === "google") {
      await ensureGoogleMainWorldScripts(tabId)
    }
    return pingProviderBridge(tabId)
  } catch (error) {
    console.warn("[GPD] unable to inject provider bridge", error)
    return false
  }
}

async function resolveProviderTab(
  appTabId: number | null,
  provider: PhotoProvider
): Promise<number | null> {
  return connectionSession.resolveProviderTab(appTabId, provider, {
    ensureReachable: ensureProviderBridge,
    async findProviderTab(requestedProvider, preferredTabId) {
      const tab = await findProviderTab(requestedProvider, preferredTabId)
      return tab && hasTabId(tab) ? tab.id : null
    }
  })
}

/**
 * Get the sender's tab ID. For content scripts, sender.tab is set.
 * For extension pages (tabs/app.html), sender.tab is undefined —
 * we resolve it from sender.url via chrome.tabs.query.
 */
async function getSenderTabId(
  sender: chrome.runtime.MessageSender
): Promise<number | null> {
  if (isSidePanelSender(sender)) return null
  if (sender.tab?.id !== undefined && sender.tab.id !== null) {
    return sender.tab.id
  }

  // Extension page: find tab by URL
  if (sender.url) {
    const tabs = await chrome.tabs.query({ url: sender.url })
    if (tabs.length > 0 && hasTabId(tabs[0])) return tabs[0].id
  }
  return null
}

function appMessage<T extends AppMessage>(message: T, clientId?: string): T {
  return clientId ? ({ ...message, clientId } as T) : message
}

function sendToAppContext(
  tabId: number | null,
  message: AppMessage,
  clientId?: string
): void {
  const targetedMessage = attachRuntimeBuildIdentity(
    appMessage(message, clientId),
    chrome.runtime
  )
  if (tabId !== null) {
    Promise.resolve(chrome.tabs.sendMessage(tabId, targetedMessage)).catch(
      () => {
        if (clientId) {
          Promise.resolve(chrome.runtime.sendMessage(targetedMessage)).catch(
            () => {}
          )
        }
      }
    )
    return
  }
  if (clientId) {
    Promise.resolve(chrome.runtime.sendMessage(targetedMessage)).catch(() => {})
  }
}

async function openSidePanelForTab(tabId: number): Promise<boolean> {
  if (!sidePanelApi?.setOptions || !sidePanelApi.open) return false

  await sidePanelApi.setOptions({
    tabId,
    path: SIDE_PANEL_PATH,
    enabled: true
  })
  await sidePanelApi.open({ tabId })
  return true
}

async function handleActionClick(tab: chrome.tabs.Tab): Promise<void> {
  if (!hasTabId(tab)) return
  connectionSession.setHostTab(tab.id)
  const opened = await openSidePanelForTab(tab.id)
  if (!opened) {
    await chrome.tabs.create({ url: chrome.runtime.getURL("tabs/app.html") })
  }
}

chrome.action.onClicked.addListener((tab) => {
  handleActionClick(tab).catch((error) => {
    console.warn("[GPD] unable to open tab-scoped side panel", error)
  })
})

chrome.tabs.onActivated?.addListener((activeInfo) => {
  connectionSession.setHostTab(activeInfo.tabId)
  enableSidePanelForTab(activeInfo.tabId).catch((error) => {
    console.warn("[GPD] unable to enable activated tab side panel", error)
  })
})

chrome.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && providerMatchesUrl(changeInfo.url, "google")) {
    invalidateGoogleProviderTab(tabId)
  }
  if (!tab.active && changeInfo.status !== "complete") return
  enableSidePanelForTab(tabId).catch((error) => {
    console.warn("[GPD] unable to enable updated tab side panel", error)
  })
})

enableActiveSidePanels()

async function openProviderInCurrentTab(
  provider: PhotoProvider,
  tab?: chrome.tabs.Tab,
  preferredTabId?: number | null,
  allowCreate = true
): Promise<{ tab: chrome.tabs.Tab; alreadyOpen: boolean } | null> {
  const seenTabIds = new Set<number>()

  async function tryOpenCandidate(
    targetTab: chrome.tabs.Tab | undefined
  ): Promise<{ tab: chrome.tabs.Tab; alreadyOpen: boolean } | null> {
    if (!targetTab || !hasTabId(targetTab) || seenTabIds.has(targetTab.id)) {
      return null
    }
    seenTabIds.add(targetTab.id)
    if (!canNavigateTabToProvider(targetTab)) return null
    const alreadyOpen = isProviderPhotosPage(targetTab, provider)
    if (alreadyOpen) {
      const focusedTab =
        (await chrome.tabs
          .update(targetTab.id, { active: true })
          .catch(() => undefined)) ?? targetTab
      return { tab: focusedTab, alreadyOpen }
    }
    try {
      const openedTab = await chrome.tabs.update(targetTab.id, {
        url: providerOpenUrlForTab(provider, targetTab),
        active: true
      })
      return { tab: openedTab, alreadyOpen }
    } catch {
      // Some Chrome-owned pages reject tab updates. Try another real tab in
      // the same window before falling back to create/failure behavior.
      return null
    }
  }

  const senderTabResult = await tryOpenCandidate(tab)
  if (senderTabResult) return senderTabResult

  if (preferredTabId !== undefined && preferredTabId !== null) {
    const preferredTab = await chrome.tabs
      .get(preferredTabId)
      .catch(() => undefined)
    const preferredResult = await tryOpenCandidate(preferredTab)
    if (preferredResult) return preferredResult
  }

  const existingProviderTabs = (
    await Promise.all(
      providerTabPatterns(provider).map((url) => chrome.tabs.query({ url }))
    )
  ).flat()
  for (const providerTab of existingProviderTabs) {
    const providerResult = await tryOpenCandidate(providerTab)
    if (providerResult) return providerResult
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  })
  const activeResult = await tryOpenCandidate(activeTab)
  if (activeResult) return activeResult

  for (const windowTab of await chrome.tabs.query({ currentWindow: true })) {
    const windowResult = await tryOpenCandidate(windowTab)
    if (windowResult) return windowResult
  }

  if (!allowCreate) return null
  const createdTab = await chrome.tabs.create({
    url: providerOpenUrl(provider),
    active: true
  })
  return { tab: createdTab, alreadyOpen: false }
}

function launchProviderError(
  provider: PhotoProvider,
  error: string
): LaunchProviderResult {
  return {
    success: false,
    provider,
    error
  }
}

// ============================================================
// Send a GPTK command to a provider tab and await its result
// ============================================================

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stopPendingCommandsForSidePanel(clientId?: string): void {
  connectionSession.stopClient(clientId)
}

async function sendGptkCommand(
  gpTabId: number,
  command: string,
  args?: unknown,
  provider: PhotoProvider = "google"
): Promise<unknown> {
  const requestId = generateRequestId()

  const unsignedMessage: GptkCommandMessage = {
    app: APP_ID,
    action: "gptkCommand",
    command,
    requestId,
    args,
    provider
  }
  const message = await withProviderCommandCapability(unsignedMessage)

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      connectionSession.cancelCommand(requestId)
      reject(
        `Timed out waiting for ${providerName(provider)} to respond. Please reload the tab and try again.`
      )
    }, GPTK_COMMAND_TIMEOUT_MS)
    connectionSession.startCommand(requestId, {
      resolve: (data) => {
        clearTimeout(timeoutId)
        resolve(data)
      },
      reject: (error) => {
        clearTimeout(timeoutId)
        reject(error)
      },
      appTabId: null,
      providerTabId: gpTabId,
      provider,
      command
    })
    const delivery =
      provider === "icloud"
        ? chrome.scripting.executeScript({
            target: { tabId: gpTabId, allFrames: true },
            world: "MAIN",
            func: (commandMessage: GptkCommandMessage) => {
              window.postMessage(commandMessage, "*")
            },
            args: [message]
          })
        : chrome.tabs.sendMessage(gpTabId, message)

    delivery.catch(() => {
      clearTimeout(timeoutId)
      connectionSession.cancelCommand(requestId)
      reject(
        `Unable to connect to ${providerName(provider)} tab. Please reload the tab and try again.`
      )
    })
  })
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "gpd-side-panel") return

  let clientId: string | undefined
  port.onMessage.addListener((message: unknown) => {
    const payload = message as {
      app?: string
      action?: string
      clientId?: string
      activeTabId?: number
    }
    if (payload?.app !== APP_ID || payload.action !== "sidePanel.ready") return
    if (
      typeof payload.clientId === "string" &&
      payload.clientId.length > 0 &&
      payload.clientId.length <= 128
    ) {
      clientId = payload.clientId
      activeSidePanelClientIds.add(clientId)
    }
    if (typeof payload.activeTabId === "number") {
      connectionSession.setHostTab(payload.activeTabId)
    }
  })
  port.onDisconnect.addListener(() => {
    if (clientId) {
      activeSidePanelClientIds.delete(clientId)
      const providerTabId = connectionSession.mappedProviderTabId(null, "google")
      if (providerTabId !== null) {
        cancelGoogleOriginalRequestsForOwner(null, clientId, providerTabId)
      }
    }
    stopPendingCommandsForSidePanel(clientId)
  })
})

// ============================================================
// Message handler
// ============================================================

chrome.runtime.onMessage.addListener(
  (
    message: AppMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    if (message?.app !== APP_ID) return

    switch (message.action) {
      case "launchApp":
        handleLaunchApp(sender)
        break
      case "launchProvider":
        handleLaunchProvider(
          message.provider ?? "google",
          sender,
          message.hostTabId
        )
          .then(sendResponse)
          .catch((error) => {
            sendResponse(
              launchProviderError(
                message.provider ?? "google",
                error instanceof Error ? error.message : String(error)
              )
            )
          })
        return true
      case "healthCheck":
        handleHealthCheck(message, sender)
        break
      case "providerCommandKey":
        getProviderCommandPublicKey()
          .then((publicKey) =>
            sendResponse({
              app: APP_ID,
              action: "providerCommandKey.result",
              publicKey
            })
          )
          .catch((error) =>
            sendResponse({
              app: APP_ID,
              action: "providerCommandKey.result",
              error: error instanceof Error ? error.message : String(error)
            })
          )
        return true
      case "gptkCommand":
        handleGptkCommand(message as GptkCommandMessage, sender)
        break
      case "gptkResult":
        handleGptkResult(message as GptkResultMessage, sender)
        break
      case "gptkProgress":
        handleGptkProgress(message as GptkProgressMessage, sender)
        break
      case "providerOriginalHash.fetch":
        void handleGoogleOriginalHashFetch(
          message as ProviderOriginalHashFetchMessage,
          sender,
          sendResponse
        )
        return true
      case "providerOriginalHash.cancel":
        handleGoogleOriginalHashCancel(
          message as ProviderOriginalHashCancelMessage,
          sender
        )
        break
      case "recoveryHistory.transaction":
        void handleRecoveryHistoryTransaction(
          message as RecoveryHistoryTransactionMessage,
          sender
        ).then(sendResponse)
        return true
    }
  }
)

chrome.runtime.onMessageExternal?.addListener((message, sender, sendResponse) => {
  void handleExternalLicenseSessionMessage(
    message,
    sender.url,
    externalLicenseSessionMatchPatterns
  ).then(
    (accepted) =>
      sendResponse(
        accepted
          ? { ok: true }
          : { ok: false, error: "Invalid license session message or sender." }
      ),
    () => sendResponse({ ok: false, error: "Could not store license session." })
  )
  return true
})

// ============================================================
// Handlers
// ============================================================

async function handleLaunchApp(
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const appTab = await chrome.tabs.create({
    url: chrome.runtime.getURL("tabs/app.html")
  })
  if (
    sender.tab?.id !== undefined &&
    sender.tab.id !== null &&
    hasTabId(appTab)
  ) {
    connectionSession.linkTabs(sender.tab.id, appTab.id)
  }
}

async function handleLaunchProvider(
  provider: PhotoProvider,
  sender: chrome.runtime.MessageSender,
  hostTabId?: number
): Promise<LaunchProviderResult> {
  const fromSidePanel = isSidePanelSender(sender)
  const preferredTabId =
    typeof hostTabId === "number" ? hostTabId : connectionSession.hostTabId
  const providerOpenResult = await openProviderInCurrentTab(
    provider,
    fromSidePanel ? undefined : sender.tab,
    preferredTabId,
    !fromSidePanel
  )
  const providerTab = providerOpenResult?.tab
  if (!providerTab || !hasTabId(providerTab)) {
    return launchProviderError(
      provider,
      `Could not open ${providerName(provider)} in this window. Open a normal web tab, then click the extension again.`
    )
  }

  connectionSession.rememberSidePanelProvider(providerTab.id, provider)
  try {
    await openSidePanelForTab(providerTab.id)
  } catch (error) {
    console.warn("[GPD] unable to open side panel", error)
  }
  return {
    success: true,
    provider,
    tabId: providerTab.id,
    alreadyOpen: providerOpenResult.alreadyOpen
  }
}

async function handleHealthCheck(
  message: AppMessage,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const provider =
    message.action === "healthCheck" ? message.provider ?? "google" : "google"
  const requestId = (message as { requestId?: string }).requestId
  const senderTabId = await getSenderTabId(sender)
  const clientId = message.clientId

  const providerTabId = await resolveProviderTab(senderTabId, provider)
  if (providerTabId === null) {
    sendToAppContext(
      senderTabId,
      {
        app: APP_ID,
        action: "healthCheck.result",
        provider,
        requestId,
        success: false,
        hasGptk: false
      },
      clientId
    )
    return
  }

  try {
    const outcome = await connectionSession.checkProviderHealth(
      providerTabId,
      provider,
      {
        async check(tabId, requestedProvider) {
          return (await sendGptkCommand(
            tabId,
            "healthCheck",
            undefined,
            requestedProvider
          )) as GptkResultMessage
        },
        ensureGoogleMainWorldScripts,
        rememberGoogleSession: rememberGoogleProviderSession,
        invalidateGoogleSession: invalidateGoogleProviderTab
      }
    )
    sendToAppContext(
      senderTabId,
      {
        app: APP_ID,
        action: "healthCheck.result",
        provider,
        requestId,
        ...outcome
      },
      clientId
    )
  } catch (error) {
    sendToAppContext(
      senderTabId,
      {
        app: APP_ID,
        action: "healthCheck.result",
        provider,
        requestId,
        success: false,
        hasGptk: false,
        error: error instanceof Error ? error.message : String(error)
      },
      clientId
    )
  }
}

async function handleGptkCommand(
  message: GptkCommandMessage,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const senderTabId = await getSenderTabId(sender)
  const provider = message.provider ?? "google"
  const trustedUiBase = trustedExtensionUiContext(sender, message.clientId)
  const trustedUi = trustedUiBase
    ? { ...trustedUiBase, appTabId: senderTabId }
    : null
  const retrievalCommand =
    provider === "google" &&
    (message.command === "getOriginalContentHash" ||
      message.command === "getVideoPlaybackUrl")

  if (retrievalCommand && !trustedUi) {
    sendToAppContext(
      senderTabId,
      {
        app: APP_ID,
        action: "gptkResult",
        command: message.command,
        requestId: message.requestId,
        provider,
        success: false,
        error: "Original media is available only from the active PhotoSweep review."
      },
      message.clientId
    )
    return
  }

  const providerTabId = await resolveProviderTab(senderTabId, provider)
  if (providerTabId === null) {
    sendToAppContext(
      senderTabId,
      {
        app: APP_ID,
        action: "gptkResult",
        command: message.command,
        requestId: message.requestId,
        provider,
        success: false,
        error: `${providerName(provider)} tab not found. Please open ${providerOpenUrl(provider)}.`
      } as GptkResultMessage,
      message.clientId
    )
    return
  }

  const commandArgs =
    message.args && typeof message.args === "object"
      ? (message.args as Record<string, unknown>)
      : {}

  if (provider === "google" && message.command === "getAllMediaItems") {
    cancelGoogleOriginalRequestsForOwner(
      senderTabId,
      trustedUi?.clientId,
      providerTabId
    )
    const accountEmail = normalizedEmail(commandArgs.accountEmail)
    if (
      trustedUi &&
      accountEmail &&
      validScopeFingerprint(commandArgs.scanScopeFingerprint)
    ) {
      pendingGoogleScanContexts.set(message.requestId, {
        appTabId: senderTabId,
        ...(trustedUi.clientId ? { appClientId: trustedUi.clientId } : {}),
        providerTabId,
        accountEmail,
        scopeFingerprint: commandArgs.scanScopeFingerprint
      })
    }
  }

  if (retrievalCommand) {
    const accountEmail = normalizedEmail(commandArgs.accountEmail)
    const mediaKind = commandArgs.mediaKind
    const mediaKey = commandArgs.mediaKey
    const providerSessionId = commandArgs.providerSessionId
    const scopeFingerprint = commandArgs.scanScopeFingerprint
    const expectedMediaKind = validGoogleOriginalKind(mediaKind)
      ? mediaKind
      : null
    const argsMatch = Boolean(
      trustedUi &&
        commandArgs.userOptIn === true &&
        commandArgs.requestId === message.requestId &&
        accountEmail &&
        typeof providerSessionId === "string" &&
        providerSessionId.length > 0 &&
        validScopeFingerprint(scopeFingerprint) &&
        typeof mediaKey === "string" &&
        mediaKey.length > 0 &&
        expectedMediaKind &&
        (message.command !== "getVideoPlaybackUrl" ||
          expectedMediaKind === "video")
    )
    const item = argsMatch
      ? googleCompletedScans.hasItem({
          appTabId: senderTabId,
          ...(trustedUi?.clientId ? { clientId: trustedUi.clientId } : {}),
          providerTabId,
          provider: "google",
          accountEmail: accountEmail!,
          providerSessionId: providerSessionId as string,
          scopeFingerprint: scopeFingerprint as string,
          mediaKey: mediaKey as string,
          expectedMediaKind: expectedMediaKind!
        })
      : null
    const hashLimitsValid =
      message.command !== "getOriginalContentHash" ||
      (Number.isSafeInteger(commandArgs.maxBytes) &&
        (commandArgs.maxBytes as number) >= 1 &&
        (commandArgs.maxBytes as number) <= GOOGLE_ORIGINAL_ITEM_MAX_BYTES &&
        Number.isSafeInteger(commandArgs.aggregateBudgetBytes) &&
        (commandArgs.aggregateBudgetBytes as number) >= 1 &&
        (commandArgs.aggregateBudgetBytes as number) <=
          GOOGLE_ORIGINAL_REVIEW_MAX_BYTES)

    if (!argsMatch || !item || !hashLimitsValid || !expectedMediaKind) {
      sendToAppContext(
        senderTabId,
        {
          app: APP_ID,
          action: "gptkResult",
          command: message.command,
          requestId: message.requestId,
          provider,
          success: false,
          error: "The Google Photos item is outside the active scanned review. Scan again before retrieving media."
        },
        message.clientId
      )
      return
    }

    if (message.command === "getOriginalContentHash") {
      pendingGoogleOriginalRequests.set(message.requestId, {
        requestId: message.requestId,
        appTabId: senderTabId,
        ...(trustedUi?.clientId ? { appClientId: trustedUi.clientId } : {}),
        providerTabId,
        accountEmail: accountEmail!,
        providerSessionId: providerSessionId as string,
        scopeFingerprint: scopeFingerprint as string,
        mediaKey: mediaKey as string,
        mediaKind: expectedMediaKind,
        maxBytes: commandArgs.maxBytes as number,
        aggregateBudgetBytes: commandArgs.aggregateBudgetBytes as number,
        used: false
      })
    }
  }

  if (message.command === "cancelProviderRequest" && provider === "google") {
    const targetRequestId = commandArgs.targetRequestId
    const target =
      typeof targetRequestId === "string"
        ? pendingGoogleOriginalRequests.get(targetRequestId)
        : undefined
    if (
      target &&
      trustedUi &&
      target.appTabId === senderTabId &&
      target.appClientId === trustedUi.clientId &&
      target.providerTabId === providerTabId &&
      target.providerSessionId === commandArgs.providerSessionId &&
      target.scopeFingerprint === commandArgs.scanScopeFingerprint
    ) {
      abortGoogleOriginalFetch(target.requestId)
      pendingGoogleOriginalRequests.delete(target.requestId)
    }
  }

  let routedMessage: GptkCommandMessage
  try {
    routedMessage = await withProviderCommandCapability({
      ...message,
      provider
    })
  } catch {
    pendingGoogleScanContexts.delete(message.requestId)
    pendingGoogleOriginalRequests.delete(message.requestId)
    sendToAppContext(
      senderTabId,
      {
        app: APP_ID,
        action: "gptkResult",
        command: message.command,
        requestId: message.requestId,
        provider,
        success: false,
        error: "The provider command could not be authorized. Reload the provider tab and try again."
      },
      message.clientId
    )
    return
  }

  connectionSession.startCommand(message.requestId, {
    resolve: () => {},
    reject: () => {},
    appTabId: senderTabId,
    providerTabId,
    provider,
    command: message.command,
    appClientId: message.clientId
  })

  if (
    provider === "icloud" &&
    (message.command === "getAllMediaItems" ||
      message.command === "trashItems" ||
      message.command === "restoreItems")
  ) {
    await chrome.tabs.update(providerTabId, { active: true }).catch(() => {})
    await sleep(1500)
  }

  if (provider === "icloud") {
    const frames = await chrome.webNavigation
      .getAllFrames({ tabId: providerTabId })
      .catch(() => [])
    const appFrameIds =
      frames
        ?.filter((frame) => frame.url.includes("/applications/photos"))
        .map((frame) => frame.frameId) ?? []
    chrome.scripting
      .executeScript({
        target:
          appFrameIds.length > 0
            ? { tabId: providerTabId, frameIds: appFrameIds }
            : { tabId: providerTabId, allFrames: true },
        world: "MAIN",
        func: (commandMessage: GptkCommandMessage) => {
          window.postMessage(commandMessage, "*")
        },
        args: [routedMessage]
      })
      .catch(() => {
        sendToAppContext(
          senderTabId,
          {
            app: APP_ID,
            action: "gptkResult",
            command: message.command,
            requestId: message.requestId,
            success: false,
            error: `Unable to connect to ${providerName(provider)} frames. Please reload the tab and try again.`
          } as GptkResultMessage,
          message.clientId
        )
        connectionSession.cancelCommand(message.requestId)
      })
    return
  }

  chrome.tabs.sendMessage(providerTabId, routedMessage).catch(() => {
    pendingGoogleScanContexts.delete(message.requestId)
    pendingGoogleOriginalRequests.delete(message.requestId)
    abortGoogleOriginalFetch(message.requestId)
    sendToAppContext(
      senderTabId,
      {
        app: APP_ID,
        action: "gptkResult",
        command: message.command,
        requestId: message.requestId,
        success: false,
        error: `Unable to connect to ${providerName(provider)} tab. Please reload the tab and try again.`
      } as GptkResultMessage,
      message.clientId
    )
    connectionSession.cancelCommand(message.requestId)
  })
}

function handleGptkResult(
  message: GptkResultMessage,
  sender: chrome.runtime.MessageSender
): void {
  const pending = connectionSession.commandFromProvider(
    message.requestId,
    sender.tab?.id
  )
  if (!pending) return

  // A successful original hash is an assertion about bytes read by this
  // worker. Page-world messages are observable and forgeable, so only the
  // worker's bounded fetch handler may finish a successful hash command.
  if (
    pending.provider === "google" &&
    pending.command === "getOriginalContentHash" &&
    message.success === true
  ) {
    return
  }

  const finished = connectionSession.finishCommand(message.requestId)
  if (!finished) return

  const responseMatchesRequest =
    (!finished.command || message.command === finished.command) &&
    (!message.provider || !finished.provider || message.provider === finished.provider)
  const routedResult: GptkResultMessage = responseMatchesRequest
    ? { ...message, ...(finished.provider ? { provider: finished.provider } : {}) }
    : {
        app: APP_ID,
        action: "gptkResult",
        command: finished.command ?? message.command,
        requestId: message.requestId,
        provider: finished.provider,
        success: false,
        error: "The provider response did not match the routed command."
      }

  const scanContext = pendingGoogleScanContexts.get(message.requestId)
  pendingGoogleScanContexts.delete(message.requestId)
  if (
    responseMatchesRequest &&
    routedResult.success &&
    finished.provider === "google" &&
    finished.command === "getAllMediaItems" &&
    scanContext &&
    scanContext.providerTabId === finished.providerTabId &&
    scanContext.appTabId === finished.appTabId &&
    scanContext.appClientId === finished.appClientId &&
    routedResult.providerSessionId &&
    (routedResult.scanCoverage?.status === "complete" ||
      routedResult.scanCoverage?.status === "partial") &&
    Array.isArray(routedResult.data)
  ) {
    rememberGoogleProviderSession(
      scanContext.providerTabId,
      routedResult.providerSessionId
    )
    googleCompletedScans.register({
      appTabId: scanContext.appTabId,
      ...(scanContext.appClientId ? { clientId: scanContext.appClientId } : {}),
      providerTabId: scanContext.providerTabId,
      provider: "google",
      accountEmail: scanContext.accountEmail,
      providerSessionId: routedResult.providerSessionId,
      scopeFingerprint: scanContext.scopeFingerprint,
      coverageStatus: routedResult.scanCoverage.status,
      mediaItems: routedResult.data
    })
  }

  if (
    finished.provider === "google" &&
    (finished.command === "getOriginalContentHash" ||
      finished.command === "getVideoPlaybackUrl")
  ) {
    abortGoogleOriginalFetch(message.requestId)
    pendingGoogleOriginalRequests.delete(message.requestId)
  }

  // The worker stamps the provider identity from the exact routed tab; provider
  // page payloads cannot choose how the app binds a retrieval response.
  sendToAppContext(finished.appTabId, routedResult, finished.appClientId)

  // Resolve/reject the promise if anyone is awaiting
  if (routedResult.success) {
  finished.resolve(routedResult)
  } else {
    finished.reject(routedResult.error || "Unknown error")
  }
}

function googleOriginalRelayResponse(
  message: ProviderOriginalHashFetchMessage,
  success: boolean,
  data?: ProviderOriginalHashRelayResponse["data"]
): ProviderOriginalHashRelayResponse {
  return {
    requestId: message.requestId,
    providerSessionId: message.providerSessionId,
    scanScopeFingerprint: message.scanScopeFingerprint,
    mediaKey: message.mediaKey,
    success,
    ...(success && data ? { data } : {}),
    ...(!success
      ? { error: "The original could not be verified. The item remains unverified." }
      : {})
  }
}

function routeGoogleOriginalHashResult(
  context: GoogleOriginalRequestContext,
  success: boolean,
  data?: ProviderOriginalHashRelayResponse["data"]
): void {
  const pending = connectionSession.pendingCommand(context.requestId)
  if (
    !pending ||
    pending.command !== "getOriginalContentHash" ||
    pending.provider !== "google" ||
    pending.providerTabId !== context.providerTabId ||
    pending.appTabId !== context.appTabId ||
    pending.appClientId !== context.appClientId
  ) {
    return
  }

  const finished = connectionSession.finishCommand(context.requestId)
  if (!finished) return
  pendingGoogleOriginalRequests.delete(context.requestId)

  const error = "The original could not be verified. The item remains unverified."
  const result: GptkResultMessage = {
    app: APP_ID,
    action: "gptkResult",
    command: "getOriginalContentHash",
    requestId: context.requestId,
    provider: "google",
    providerSessionId: context.providerSessionId,
    success: success && data !== undefined,
    ...(success && data ? { data } : { error })
  }
  sendToAppContext(finished.appTabId, result, finished.appClientId)
  if (result.success) finished.resolve(result)
  else finished.reject(error)
}

async function handleGoogleOriginalHashFetch(
  message: ProviderOriginalHashFetchMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): Promise<void> {
  const pendingCommand = connectionSession.pendingCommand(message.requestId)
  const context = pendingGoogleOriginalRequests.get(message.requestId)
  const matches = Boolean(
    pendingCommand &&
      pendingCommand.command === "getOriginalContentHash" &&
      pendingCommand.provider === "google" &&
      context &&
      sameOriginalRequest(context, message) &&
      message.provider === "google" &&
      sender.tab?.id === context.providerTabId &&
      isGooglePhotosPageSender(sender) &&
      !context.used
  )
  if (!matches || !context) {
    sendResponse(googleOriginalRelayResponse(message, false))
    return
  }

  const item = googleCompletedScans.hasItem({
    appTabId: context.appTabId,
    ...(context.appClientId ? { clientId: context.appClientId } : {}),
    providerTabId: context.providerTabId,
    provider: "google",
    accountEmail: context.accountEmail,
    providerSessionId: context.providerSessionId,
    scopeFingerprint: context.scopeFingerprint,
    mediaKey: context.mediaKey,
    expectedMediaKind: context.mediaKind
  })
  if (!item) {
    context.used = true
    sendResponse(googleOriginalRelayResponse(message, false))
    return
  }

  // Claim the one-use in-flight provider URL before any validation or fetch.
  // A page cannot retry the same request ID with a different URL.
  context.used = true
  let reservation: ReturnType<GoogleOriginalReviewBudget["reserve"]>
  try {
    reservation = googleOriginalReviewBudget.reserve(
      JSON.stringify([
        context.accountEmail,
        context.providerSessionId,
        context.scopeFingerprint
      ]),
      context.maxBytes,
      context.aggregateBudgetBytes,
      item.size
    )
  } catch {
    sendResponse(googleOriginalRelayResponse(message, false))
    return
  }

  const controller = new AbortController()
  const active: ActiveGoogleOriginalFetch = {
    context,
    controller,
    timer: setTimeout(
      () => controller.abort(),
      GOOGLE_ORIGINAL_RELAY_TIMEOUT_MS
    ),
    reservation
  }
  activeGoogleOriginalFetches.set(message.requestId, active)

  try {
    const data = await fetchGoogleOriginalHash({
      resourceUrl: message.resourceUrl,
      mediaKey: context.mediaKey,
      scopeFingerprint: context.scopeFingerprint,
      mediaKind: context.mediaKind,
      maxBytes: reservation.maxBytes,
      expectedByteLength: item.size,
      expectedMimeType: item.mimeType,
      signal: controller.signal,
      onFetchStart: () => reservation.start(),
      onBytesReceived: (byteLength) => reservation.consume(byteLength)
    })
    const isStillCurrent =
      activeGoogleOriginalFetches.get(message.requestId) === active &&
      connectionSession.pendingCommand(message.requestId) === pendingCommand &&
      googleCompletedScans.hasItem({
        appTabId: context.appTabId,
        ...(context.appClientId ? { clientId: context.appClientId } : {}),
        providerTabId: context.providerTabId,
        provider: "google",
        accountEmail: context.accountEmail,
        providerSessionId: context.providerSessionId,
        scopeFingerprint: context.scopeFingerprint,
        mediaKey: context.mediaKey,
        expectedMediaKind: context.mediaKind
      }) !== null
    if (!isStillCurrent || controller.signal.aborted) {
      reservation.release()
      routeGoogleOriginalHashResult(context, false)
      sendResponse(googleOriginalRelayResponse(message, false))
      return
    }
    reservation.complete(data.byteLength)
    routeGoogleOriginalHashResult(context, true, data)
    sendResponse(googleOriginalRelayResponse(message, true, data))
  } catch {
    reservation.release()
    routeGoogleOriginalHashResult(context, false)
    sendResponse(googleOriginalRelayResponse(message, false))
  } finally {
    clearTimeout(active.timer)
    if (activeGoogleOriginalFetches.get(message.requestId) === active) {
      activeGoogleOriginalFetches.delete(message.requestId)
    }
  }
}

function handleGoogleOriginalHashCancel(
  message: ProviderOriginalHashCancelMessage,
  sender: chrome.runtime.MessageSender
): void {
  if (
    message.provider !== "google" ||
    sender.tab?.id === undefined ||
    sender.tab.id === null ||
    !isGooglePhotosPageSender(sender)
  ) {
    return
  }
  const active = activeGoogleOriginalFetches.get(message.requestId)
  if (
    active &&
    active.context.providerTabId === sender.tab.id &&
    active.context.providerSessionId === message.providerSessionId &&
    active.context.scopeFingerprint === message.scanScopeFingerprint &&
    active.context.mediaKey === message.mediaKey
  ) {
    abortGoogleOriginalFetch(message.requestId)
  }
}

function handleGptkProgress(
  message: GptkProgressMessage,
  sender: chrome.runtime.MessageSender
): void {
  const pending = connectionSession.commandFromProvider(
    message.requestId,
    sender.tab?.id
  )
  if (!pending) return

  // Relay progress to the app tab
  sendToAppContext(pending.appTabId, message, pending.appClientId)
}

// ============================================================
// Tab cleanup
// ============================================================

chrome.tabs.onRemoved.addListener((tabId) => {
  const mappedTabId = connectionSession.removeTab(tabId)
  googleCompletedScans.invalidateAppTab(tabId)
  invalidateGoogleProviderTab(tabId)
  for (const [requestId, context] of pendingGoogleOriginalRequests) {
    if (context.appTabId !== tabId) continue
    abortGoogleOriginalFetch(requestId)
    pendingGoogleOriginalRequests.delete(requestId)
  }
  for (const [requestId, context] of pendingGoogleScanContexts) {
    if (context.appTabId === tabId) pendingGoogleScanContexts.delete(requestId)
  }
  if (mappedTabId !== null) {
    invalidateGoogleProviderTab(mappedTabId)
    // If a GP tab closed, notify the app tab
    chrome.tabs
      .sendMessage(mappedTabId, {
        app: APP_ID,
        action: "gptkLog",
        level: "error",
        message: "Connected photo source tab was closed."
      })
      .catch(() => {
        // App tab may also be gone
      })
  }
})

console.log("GPD: Service worker loaded")
