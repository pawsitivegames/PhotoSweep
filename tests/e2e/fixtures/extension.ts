/**
 * Shared helpers for all E2E tests.
 * Handles extension launch, storage injection, and GP auth cookie injection.
 */
import { requireLiveExtensionId } from "./live-scan-contract"
import fs from "fs"
import path from "path"
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test"

import type { PlanId } from "../../../lib/entitlement"
import type { KeepDecisionProvenance } from "../../../lib/duplicate-review-session"
import { BUILD_ID } from "../../../lib/generated/build-flags"
import { buildScanScopeFingerprint } from "../../../lib/review-preflight"
import { providerReviewStorageKey } from "../../../lib/provider-review-storage"
import { PHOTO_DATA_CONSENT_STORAGE_KEY } from "../../../lib/privacy-disclosure"
import type { ScanCheckpoint } from "../../../lib/scan-checkpoint"
import type { DuplicateGroup, GpdMediaItem } from "../../../lib/types"
import { DEFAULT_SETTINGS } from "../../../lib/types"

export const extensionPath = process.env.PHOTOSWEEP_E2E_EXTENSION_PATH
  ? path.resolve(process.env.PHOTOSWEEP_E2E_EXTENSION_PATH)
  : path.resolve(__dirname, "../../../build/chrome-mv3-dev")

const extensionIds = new WeakMap<BrowserContext, string>()
const liveContexts = new WeakSet<BrowserContext>()

function installedChromiumExecutable(): string | undefined {
  const configured = process.env.PHOTOSWEEP_E2E_EXECUTABLE_PATH
  if (configured) return configured
  return fs.existsSync(chromium.executablePath())
    ? chromium.executablePath()
    : undefined
}

function rememberExtensionId(
  context: BrowserContext,
  extensionId: string
): void {
  extensionIds.set(context, extensionId)
}

async function openExtensionStoragePage(
  context: BrowserContext
): Promise<Page> {
  const extensionId = extensionIds.get(context)
  if (!extensionId) {
    throw new Error("Extension ID is unavailable for the test context.")
  }

  // Chromium extension contexts occasionally fail Target.createTarget when
  // opening a helper tab (CI flake). Retry before failing the suite.
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let page: Page | undefined
    try {
      page = await context.newPage()
      // A static extension resource gives this page chrome.storage access without
      // booting the app, whose startup effects would race test storage setup.
      await page.goto(`chrome-extension://${extensionId}/manifest.json`)
      return page
    } catch (error) {
      await page?.close().catch(() => {})
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (
        !message.includes("Target.createTarget") &&
        !message.includes("Failed to open a new tab")
      ) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
    }
  }
  throw lastError
}

// ============================================================
// Connect to an already-running Chrome (full E2E only)
// ============================================================

/** Connect only to an explicitly selected PhotoSweep installation.
 * The default is the existing Chrome CDP endpoint. An explicitly configured
 * GPD_E2E_USER_DATA_DIR remains opt-in; neither path permits clearing live storage.
 */
export async function connectToChrome(
  cdpUrl = process.env.CDP_URL || "http://localhost:9222"
): Promise<{ browser: Browser; context: BrowserContext; extensionId: string }> {
  const extensionId = requireLiveExtensionId(process.env.PHOTOSWEEP_E2E_EXTENSION_ID)
  const expected = JSON.parse(fs.readFileSync(path.join(extensionPath, "manifest.json"), "utf8"))
  const userDataDir = process.env.GPD_E2E_USER_DATA_DIR
  let browser: Browser
  let context: BrowserContext
  if (userDataDir) {
    const installedBrowser = installedChromiumExecutable()
    context = await chromium.launchPersistentContext(path.resolve(userDataDir), {
      headless: false,
      ...(installedBrowser ? { executablePath: installedBrowser } : {}),
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--enable-unsafe-extension-debugging",
        "--no-sandbox"
      ]
    })
    browser = { close: () => context.close() } as Browser
  } else {
    try {
      browser = await chromium.connectOverCDP(cdpUrl)
    } catch {
      throw new Error("Could not connect to the configured Chrome CDP endpoint. Keep the signed-in profile in place; configure CDP_URL explicitly if needed.")
    }
    context = browser.contexts()[0]
    if (!context) {
      await browser.close()
      throw new Error("No browser context found in connected Chrome.")
    }
  }
  try {
    // A direct manifest page wakes the selected installation without guessing
    // from unrelated service workers or the first open extension tab.
    rememberExtensionId(context, extensionId)
    liveContexts.add(context)
    await withExtensionStorage(context, async (page) => {
      const actual = await page.evaluate(() => ({
        id: chrome.runtime.id,
        manifest: chrome.runtime.getManifest()
      }))
      if (actual.id !== extensionId || actual.manifest.name !== expected.name ||
          actual.manifest.version !== expected.version) {
        throw new Error("Installed test extension identity differs from PHOTOSWEEP_E2E_EXTENSION_PATH.")
      }
    })
    return { browser, context, extensionId }
  } catch (error) {
    await browser.close()
    throw error
  }
}

export async function assertEmptyLiveReviewState(context: BrowserContext): Promise<void> {
  const keys = ["scanResults", "selections", "scanCheckpoint", ...["google", "icloud", "amazon"].flatMap((provider) =>
    ["scanResults", "selections", "scanCheckpoint"].map((key) => `providerReview.v1.${provider}.${key}`)
  )]
  const present = await withExtensionStorage(context, (page) => page.evaluate((keys) =>
    chrome.storage.local.get(keys).then((stored) => Object.keys(stored).length > 0), keys
  ))
  if (present) throw new Error("Live test target already has saved review/checkpoint state. Use a dedicated empty test installation; no storage was cleared.")
}

// ============================================================
// Extension launch
// ============================================================

export async function reviewShownKeepers(page: Page): Promise<void> {
  for (const card of await page.locator("[data-review-group-id]").all()) {
    // Confirm the existing sole keeper through the production UI. This marks
    // review complete without changing the intended Trash target identities.
    await card.getByRole("button", { name: /currently kept; this is the last kept copy/ }).click()
  }
}

export async function launchExtension(): Promise<{
  context: BrowserContext
  extensionId: string
}> {
  // Prefer a locally installed Chromium-family browser when Playwright's
  // downloaded bundle is unavailable on the host. The persistent profile is
  // still temporary and isolated for each test run.
  const installedBrowser = installedChromiumExecutable()
  const context = await chromium.launchPersistentContext("", {
    headless: process.env.PHOTOSWEEP_INTEGRATION_HEADLESS === "1",
    ...(installedBrowser ? { executablePath: installedBrowser } : {}),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-sandbox"
    ]
  })

  // Keep integration checkout flows offline even when the backend fixture
  // returns a Stripe-shaped URL.
  await context.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Checkout test fixture</title>"
    })
  )

  let sw = context.serviceWorkers()[0]
  if (!sw) sw = await context.waitForEvent("serviceworker")
  const extensionId = new URL(sw.url()).hostname
  rememberExtensionId(context, extensionId)

  return { context, extensionId }
}

export function openAppTab(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  return context.newPage().then((page) => {
    return page
      .goto(`chrome-extension://${extensionId}/tabs/app.html`)
      .then(() => page)
  })
}

// ============================================================
// Storage helpers (via an extension page, not the ephemeral MV3 worker)
// ============================================================

async function withExtensionStorage<T>(
  context: BrowserContext,
  operation: (page: Page) => Promise<T>
): Promise<T> {
  const page = await openExtensionStoragePage(context)
  try {
    return await operation(page)
  } finally {
    await page.close()
  }
}

export async function injectScanResults(
  context: BrowserContext,
  groups: object[],
  mediaItems: Record<string, object>,
  totalItems: number,
  accountEmail: string | null = "test@example.com"
): Promise<void> {
  const scopeFingerprint = buildScanScopeFingerprint(DEFAULT_SETTINGS)
  const storageKey = providerReviewStorageKey("google", "scanResults")
  await withExtensionStorage(context, (page) =>
    page.evaluate(
      ({ groups, mediaItems, totalItems, accountEmail, scopeFingerprint, storageKey }) =>
        new Promise<void>((resolve) => {
          chrome.storage.local.set(
            {
              [storageKey]: {
                groups,
                mediaItems,
                totalItems,
                scanDate: Date.now(),
                sourceProvider: "google",
                scopeFingerprint,
                ...(accountEmail ? { accountEmail } : {})
              }
            },
            resolve
          )
        }),
      { groups, mediaItems, totalItems, accountEmail, scopeFingerprint, storageKey }
    )
  )
}

export async function injectSelections(
  context: BrowserContext,
  selectedGroupIds: string[],
  keptOverrides: Record<string, string[]> = {},
  provider: "google" | "icloud" | "amazon" = "google",
  keepDecisionProvenance?: Record<string, KeepDecisionProvenance>
): Promise<void> {
  const storageKey = providerReviewStorageKey(provider, "selections")
  await withExtensionStorage(context, (page) =>
    page.evaluate(
      ({ selectedGroupIds, keptOverrides, keepDecisionProvenance, storageKey }) =>
        new Promise<void>((resolve) => {
          chrome.storage.local.set(
            {
              [storageKey]: {
                selectedGroupIds,
                keptOverrides,
                ...(keepDecisionProvenance ? { keepDecisionProvenance } : {})
              }
            },
            resolve
          )
        }),
      { selectedGroupIds, keptOverrides, keepDecisionProvenance, storageKey }
    )
  )
}

export async function injectScanCheckpoint(
  context: BrowserContext,
  scanCheckpoint: ScanCheckpoint
): Promise<void> {
  const provider = scanCheckpoint.settings.sourceProvider ?? "google"
  const storageKey = providerReviewStorageKey(provider, "scanCheckpoint")
  await withExtensionStorage(context, (page) =>
    page.evaluate(
      ({ scanCheckpoint, storageKey }) =>
        new Promise<void>((resolve) => {
          chrome.storage.local.set({ [storageKey]: scanCheckpoint }, resolve)
        }),
      { scanCheckpoint, storageKey }
    )
  )
}

export async function injectEntitlement(
  context: BrowserContext,
  planId: Exclude<PlanId, "free">
): Promise<void> {
  await withExtensionStorage(context, (page) =>
    page.evaluate(
      (planId) =>
        new Promise<void>((resolve) => {
          chrome.storage.local.set(
            {
              photoSweepDevEntitlement: {
                planId,
                active: true,
                source: "local_dev"
              }
            },
            resolve
          )
        }),
      planId
    )
  )
}

export async function readLocalStorage(
  context: BrowserContext,
  keys?: string | string[]
): Promise<Record<string, unknown>> {
  return withExtensionStorage(context, (page) =>
    page.evaluate(
      (keys) =>
        new Promise<Record<string, unknown>>((resolve) => {
          if (keys === undefined) {
            chrome.storage.local.get(resolve)
            return
          }
          const requested = Array.isArray(keys) ? keys : [keys]
          chrome.storage.local.get(["settings"]).then((settingsResult) => {
            const settingsValue = settingsResult.settings
            const configuredProvider =
              settingsValue !== null &&
              typeof settingsValue === "object" &&
              "sourceProvider" in settingsValue
                ? settingsValue.sourceProvider
                : undefined
            const provider =
              configuredProvider === "icloud" || configuredProvider === "amazon"
                ? configuredProvider
                : "google"
            const reviewKeys = new Set([
              "scanResults",
              "selections",
              "scanCheckpoint"
            ])
            const physical = requested.map((key) =>
              reviewKeys.has(key)
                ? `providerReview.v1.${provider}.${key}`
                : key
            )
            chrome.storage.local.get(physical, (stored) => {
              const logical: Record<string, unknown> = {}
              requested.forEach((key, index) => {
                if (Object.prototype.hasOwnProperty.call(stored, physical[index])) {
                  logical[key] = stored[physical[index]]
                }
              })
              resolve(logical)
            })
          })
        }),
      keys
    )
  )
}

export async function clearStorage(context: BrowserContext): Promise<void> {
  if (liveContexts.has(context)) {
    throw new Error("Refusing to clear storage in a live Chrome test context.")
  }
  // Best-effort: Playwright Chromium extension contexts sometimes reject
  // helper tabs during teardown (createTarget / closed context). Do not fail
  // an otherwise-passing test from cleanup alone.
  try {
    await withExtensionStorage(context, (page) =>
      page.evaluate(
        (consentKey) =>
          new Promise<void>((resolve) => {
            chrome.storage.local.clear(() => {
              chrome.storage.local.set({ [consentKey]: true }, resolve)
            })
          }),
        PHOTO_DATA_CONSENT_STORAGE_KEY
      )
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes("Target.createTarget") ||
      message.includes("Failed to open a new tab") ||
      message.includes("has been closed")
    ) {
      return
    }
    throw error
  }
}

// ============================================================
// GPTK stub helpers (integration tests)
// ============================================================

const gptkStubHtml = fs.readFileSync(
  path.resolve(__dirname, "gptk-stub.html"),
  "utf-8"
)

/**
 * Per-command response overrides for the GPTK stub.
 * Set `success: false` to force a command to fail.
 */
export interface GptkOverride {
  success?: false
  error?: string
  data?: unknown
  delayMs?: number
  holdResponse?: boolean
  progressData?: unknown
  progressItemsProcessed?: number
  sequence?: GptkOverride[]
}

export interface GptkOverrides {
  [command: string]: GptkOverride | undefined
}

/**
 * Intercept https://photos.google.com/* and serve the GPTK stub page.
 * The extension's bridge content script is injected automatically because the
 * intercepted URL matches the content script's "matches" pattern.
 *
 * Call this before opening the stub page. Returns the opened stub Page so tests
 * can close it, inspect state, or inject overrides via page.evaluate().
 *
 * @param overrides  Per-command response overrides (e.g. force trashItems to fail)
 */
export async function openGptkStubPage(
  context: BrowserContext,
  overrides: GptkOverrides = {}
): Promise<Page> {
  // Intercept ALL requests to photos.google.com so the content script host loads
  await context.route("https://photos.google.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: gptkStubHtml
    })
  })

  const page = await context.newPage()
  await page.goto("https://photos.google.com/")

  // The stub supplies its own provider command handler. Mark it with the same
  // owner identity used by the service worker so test setup does not inject a
  // second, real command handler that races the stub's responses.
  const extensionId = extensionIds.get(context)
  if (!extensionId) {
    throw new Error("Extension ID is unavailable for the GPTK stub page.")
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(extensionPath, "manifest.json"), "utf-8")
  ) as { version?: unknown }
  const ownerVersion =
    typeof BUILD_ID === "string" && BUILD_ID.length > 0
      ? BUILD_ID
      : typeof manifest.version === "string"
        ? manifest.version
        : undefined
  if (!ownerVersion) {
    throw new Error("Extension build identity is unavailable for the GPTK stub.")
  }
  const ownerId = `${extensionId}:${ownerVersion}`
  await page.evaluate((commandOwnerId) => {
    const stubWindow = window as unknown as {
      __GPD_COMMAND_HOST__?: unknown
      __GPD_COMMAND_HOST_OWNER_ID__?: string
      __GPD_GOOGLE_COMMAND_HANDLER_OWNER_ID__?: string
    }
    stubWindow.__GPD_COMMAND_HOST__ = { register: () => undefined }
    stubWindow.__GPD_COMMAND_HOST_OWNER_ID__ = commandOwnerId
    stubWindow.__GPD_GOOGLE_COMMAND_HANDLER_OWNER_ID__ = commandOwnerId
  }, ownerId)

  // Inject overrides so the stub responds as configured
  if (Object.keys(overrides).length > 0) {
    await page.evaluate((ov) => {
      ;(
        window as unknown as { __gptkOverrides: GptkOverrides }
      ).__gptkOverrides = ov
    }, overrides)
  }

  return page
}

/**
 * Wait for a given text or pattern to become visible on the app tab.
 * Reloads the page once if not visible within `timeout / 2` ms, then waits again.
 * This handles the case where the app tab loads before the stub page is ready.
 */
export async function waitForAppState(
  page: Page,
  matcher: string | RegExp,
  timeout = 10_000
): Promise<void> {
  await page.waitForSelector(
    typeof matcher === "string"
      ? `text=${matcher}`
      : `:text-matches(${matcher.source}, ${matcher.flags || "i"})`,
    { timeout }
  )
}

/**
 * Build N duplicate groups where each group has `itemsPerGroup` items.
 * Returns both the groups array and a matching mediaItems record.
 *
 * Total dedupKeys = N * (itemsPerGroup - 1) after one keep item per group
 * — useful for constructing payloads that span multiple 25-item trash batches.
 */
export function makeGroups(
  groupCount: number,
  itemsPerGroup: number
): { groups: DuplicateGroup[]; mediaItems: Record<string, GpdMediaItem> } {
  const groups: DuplicateGroup[] = []
  const mediaItems: Record<string, GpdMediaItem> = {}

  for (let g = 0; g < groupCount; g++) {
    const mediaKeys: string[] = []
    for (let i = 0; i < itemsPerGroup; i++) {
      const key = `group${g}-item${i}`
      mediaKeys.push(key)
      mediaItems[key] = {
        mediaKey: key,
        dedupKey: `dedup-${key}`,
        thumb: "",
        productUrl: `https://photos.google.com/photo/${key}`,
        timestamp: 1_600_000_000_000 + g * 1000 + i,
        creationTimestamp: 1_700_000_000_000 + g * 1000 + i,
        resWidth: 1920,
        resHeight: 1080,
        fileName: `photo-${key}.jpg`,
        isOwned: true,
        // Keep the integration fixture's default strategy deterministic while
        // dedicated uncertainty tests can omit or null this field explicitly.
        isOriginalQuality: i === 0
      }
    }
    groups.push({
      id: `group-${g}`,
      mediaKeys,
      originalMediaKey: mediaKeys[0],
      similarity: 0.95
    })
  }

  return { groups, mediaItems }
}
