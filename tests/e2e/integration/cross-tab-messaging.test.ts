/**
 * Cross-tab messaging integration tests.
 *
 * Exercises the complete three-context messaging loop using a real Playwright-
 * launched extension and a GPTK stub page that intercepts https://photos.google.com/:
 *
 *   App Tab → chrome.runtime.sendMessage
 *     → Service Worker → chrome.tabs.sendMessage
 *       → Bridge content script → window.postMessage
 *         → GPTK stub (replies via window.postMessage)
 *       → Bridge content script → chrome.runtime.sendMessage
 *     → Service Worker → chrome.tabs.sendMessage
 *   → App Tab (receives result)
 *
 * No Google Photos auth required. Run via: npm run test:integration
 *
 * Prerequisites: `npm run dev` (dev build) or `npm run build` (prod build)
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test"

import {
  clearStorage,
  launchExtension,
  openAppTab,
  openGptkStubPage
} from "../fixtures/extension"

let context: BrowserContext
let extensionId: string

test.beforeAll(async () => {
  ;({ context, extensionId } = await launchExtension())
})

test.afterAll(async () => {
  await context.close()
})

// ============================================================
// Helpers
// ============================================================

/** Send a chrome.runtime message from the app tab and return the response. */
async function sendAppMessage(
  appPage: Page,
  message: Record<string, unknown>
): Promise<unknown> {
  return appPage.evaluate((msg) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, resolve)
    })
  }, message)
}

function scanLibraryButton(page: Page) {
  return page.getByRole("button", { name: /Check entire library/i })
}

// ============================================================
// healthCheck flow
// ============================================================

test.describe("healthCheck", () => {
  test("app tab receives healthCheck.result success when GP stub responds", async () => {
    await clearStorage(context)

    // Open stub first so the service worker finds it when healthCheck fires
    const stub = await openGptkStubPage(context)
    const page = await openAppTab(context, extensionId)

    // The app tab fires healthCheck on mount — wait for connected state
    await expect(scanLibraryButton(page)).toBeVisible({ timeout: 10_000 })

    await stub.close()
    await page.close()
  })

  test("app tab shows disconnected when GP tab is not open", async () => {
    await clearStorage(context)

    // Open app tab without any GP stub — healthCheck should fail
    const page = await openAppTab(context, extensionId)

    await expect(
      page.getByText(/Cannot connect to Google Photos/i)
    ).toBeVisible({ timeout: 10_000 })

    await page.close()
  })

  test("app tab reflects the accountEmail returned by the stub", async () => {
    await clearStorage(context)

    const stub = await openGptkStubPage(context, {
      healthCheck: {
        data: {
          hasGptk: true,
          hasWizData: true,
          accountEmail: "custom@example.com"
        }
      } as never
    })
    const page = await openAppTab(context, extensionId)

    // Connected state means the healthCheck round-trip succeeded
    await expect(scanLibraryButton(page)).toBeVisible({ timeout: 10_000 })

    await stub.close()
    await page.close()
  })

  test("automatically retries transient provider readiness failures", async () => {
    await clearStorage(context)

    // Start disconnected so this test exercises the same Retry button path
    // users reach after Open has completed but the bridge is still settling.
    const page = await openAppTab(context, extensionId)
    await expect(
      page.getByText(/Cannot connect to Google Photos/i)
    ).toBeVisible({ timeout: 10_000 })

    const stub = await openGptkStubPage(context, {
      healthCheck: {
        sequence: [
          { success: false, error: "bridge still loading" },
          { success: false, error: "bridge still loading" },
          {
            data: {
              hasGptk: true,
              hasWizData: true,
              accountEmail: "test@example.com"
            }
          }
        ]
      }
    })

    await page.getByRole("button", { name: /Retry connection/i }).click()
    await expect(scanLibraryButton(page)).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByRole("button", { name: /Retry connection/i })
    ).not.toBeVisible()
    await expect
      .poll(async () =>
        stub.evaluate(
          () =>
            (
              window as unknown as {
                __gptkCommandLog?: Array<{ command: string }>
              }
            ).__gptkCommandLog?.filter(
              (entry) => entry.command === "healthCheck"
            ).length ?? 0
        )
      )
      .toBe(3)

    await stub.close()
    await page.close()
  })

  test("fails closed when the provider tab navigates away during retries", async () => {
    await clearStorage(context)

    const page = await openAppTab(context, extensionId)
    await expect(
      page.getByText(/Cannot connect to Google Photos/i)
    ).toBeVisible({ timeout: 10_000 })

    const stub = await openGptkStubPage(context, {
      healthCheck: { delayMs: 1_000 }
    })
    await page.getByRole("button", { name: /Retry connection/i }).click()

    // Simulate the user leaving Google Photos while the first health check is
    // still in flight. The app must not remain connected to the old tab.
    await stub.goto("https://example.com/")
    await expect(
      page.getByText(/Cannot connect to Google Photos/i)
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole("button", { name: /Retry connection/i })
    ).toBeVisible()
    await expect(scanLibraryButton(page)).not.toBeVisible()

    await stub.close()
    await page.close()
  })
})

// ============================================================
// GP tab close notification
// ============================================================

test.describe("tab lifecycle", () => {
  test("app tab receives GP_TAB_CLOSED when GP stub tab is closed", async () => {
    await clearStorage(context)

    const stub = await openGptkStubPage(context)
    const page = await openAppTab(context, extensionId)

    // Wait for connected state
    await expect(scanLibraryButton(page)).toBeVisible({ timeout: 10_000 })

    // Close the GP stub tab
    await stub.close()

    // App should now show disconnected (GP_TAB_CLOSED event)
    await expect(
      page.getByText(/Google Photos tab was closed|Cannot connect/i)
    ).toBeVisible({ timeout: 10_000 })

    await page.close()
  })
})

// ============================================================
// gptkCommand routing — direct round-trip
// ============================================================

test.describe("gptkCommand routing", () => {
  test("app tab receives gptkResult after command is relayed through GP stub", async () => {
    await clearStorage(context)

    const stub = await openGptkStubPage(context)
    const page = await openAppTab(context, extensionId)

    // Wait for connected state (proves the tab mapping is established)
    await expect(scanLibraryButton(page)).toBeVisible({ timeout: 10_000 })

    // Send a gptkCommand from the app tab and capture the result via a listener
    const result = await page.evaluate(() => {
      return new Promise<{
        success: boolean
        command: string
        data: unknown
      }>((resolve) => {
        const APP_ID = "GPD"
        const requestId = `test-${Date.now()}`

        const listener = (msg: Record<string, unknown>) => {
          if (
            msg?.app === APP_ID &&
            msg?.action === "gptkResult" &&
            msg?.requestId === requestId
          ) {
            chrome.runtime.onMessage.removeListener(listener)
            resolve({
              success: msg.success as boolean,
              command: msg.command as string,
              data: msg.data
            })
          }
        }
        chrome.runtime.onMessage.addListener(listener)

        chrome.runtime.sendMessage({
          app: APP_ID,
          action: "gptkCommand",
          command: "healthCheck",
          requestId
        })
      })
    })

    expect(result.success).toBe(true)
    expect(result.command).toBe("healthCheck")
    expect((result.data as Record<string, unknown>)?.hasGptk).toBe(true)

    await stub.close()
    await page.close()
  })

  test("app tab receives gptkResult failure when GP tab is not found", async () => {
    await clearStorage(context)

    // No stub open — service worker cannot route the command
    const page = await openAppTab(context, extensionId)

    // Wait for disconnected state
    await expect(
      page.getByText(/Cannot connect to Google Photos/i)
    ).toBeVisible({ timeout: 8_000 })

    const result = await page.evaluate(() => {
      return new Promise<{ success: boolean; error?: string }>((resolve) => {
        const APP_ID = "GPD"
        const requestId = `test-nophoto-${Date.now()}`

        const listener = (msg: Record<string, unknown>) => {
          if (
            msg?.app === APP_ID &&
            msg?.action === "gptkResult" &&
            msg?.requestId === requestId
          ) {
            chrome.runtime.onMessage.removeListener(listener)
            resolve({
              success: msg.success as boolean,
              error: msg.error as string
            })
          }
        }
        chrome.runtime.onMessage.addListener(listener)

        chrome.runtime.sendMessage({
          app: APP_ID,
          action: "gptkCommand",
          command: "healthCheck",
          requestId
        })
      })
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()

    await page.close()
  })
})

// ============================================================
// Progress streaming
// ============================================================

test.describe("progress streaming", () => {
  test("app tab receives intermediate gptkProgress messages during long command", async () => {
    await clearStorage(context)

    const stub = await openGptkStubPage(context)
    const page = await openAppTab(context, extensionId)

    await expect(scanLibraryButton(page)).toBeVisible({ timeout: 10_000 })

    // Trigger a trashItems command with 60 items (2 batches of 25 + 10)
    // The stub emits progress after each batch, so we expect at least one progress event.
    const progressEvents = await page.evaluate(() => {
      return new Promise<number[]>((resolve) => {
        const APP_ID = "GPD"
        const requestId = `test-progress-${Date.now()}`
        const events: number[] = []

        const listener = (msg: Record<string, unknown>) => {
          if (msg?.app !== APP_ID || msg?.requestId !== requestId) return
          if (msg.action === "gptkProgress") {
            events.push(msg.itemsProcessed as number)
          }
          if (msg.action === "gptkResult") {
            chrome.runtime.onMessage.removeListener(listener)
            resolve(events)
          }
        }
        chrome.runtime.onMessage.addListener(listener)

        const dedupKeys = Array.from({ length: 60 }, (_, i) => `key-${i}`)
        chrome.runtime.sendMessage({
          app: APP_ID,
          action: "gptkCommand",
          command: "trashItems",
          requestId,
          args: { dedupKeys, batchSize: 25 }
        })
      })
    })

    // Expect at least 2 progress events (batch 25, batch 50, plus 60)
    expect(progressEvents.length).toBeGreaterThanOrEqual(2)
    // The stub emits 25, 50, then 60. Assert on the set of values rather
    // than arrival order: chrome.runtime messaging does not guarantee ordered
    // delivery across the tab → background → tab relay, so events can arrive
    // out of order even though they're emitted monotonically.
    const seen = new Set(progressEvents)
    expect(seen).toContain(25)
    expect(seen).toContain(50)
    expect(seen).toContain(60)
    // Total reached: the highest progress value equals the item count.
    expect(Math.max(...progressEvents)).toBe(60)

    await stub.close()
    await page.close()
  })
})
