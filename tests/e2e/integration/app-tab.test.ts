/**
 * Integration E2E tests for the extension app tab.
 * No Google Photos auth required — uses injected mock data.
 *
 * Prerequisites: `npm run build`
 * Run: `npm run test:integration`
 */
import { expect, test, type BrowserContext } from "@playwright/test"

import { providerReviewStorageKey } from "../../../lib/provider-review-storage"
import {
  clearStorage,
  injectScanCheckpoint,
  injectScanResults,
  injectSelections,
  launchExtension,
  makeGroups,
  openAppTab,
  openGptkStubPage,
  readLocalStorage
} from "../fixtures/extension"

let context: BrowserContext
let extensionId: string

test.beforeAll(async () => {
  ;({ context, extensionId } = await launchExtension())
})

test.beforeEach(async () => {
  // Shared persistent context can die after checkout-tab teardown flakes.
  // Relaunch once so later tests are not stranded on a closed BrowserContext.
  try {
    const probe = await context.newPage()
    await probe.close()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      !message.includes("has been closed") &&
      !message.includes("Target.createTarget") &&
      !message.includes("Failed to open a new tab")
    ) {
      throw error
    }
    await context.close().catch(() => {})
    ;({ context, extensionId } = await launchExtension())
  }
})

test.afterEach(async () => {
  for (const page of context.pages()) {
    if (page.url().startsWith("https://photos.google.com/")) {
      await page.close().catch(() => {})
    }
  }
  await context.unroute("https://photos.google.com/**").catch(() => {})
})

test.afterAll(async () => {
  await context.close()
})

// ============================================================

test("restores saved scan results from storage on load", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      },
      {
        id: "g2",
        mediaKeys: ["key3", "key4"],
        originalMediaKey: "key3",
        similarity: 0.98
      }
    ],
    {
      key1: {
        mediaKey: "key1",
        dedupKey: "d1",
        thumb: "",
        timestamp: 0,
        creationTimestamp: 0,
        resWidth: 100,
        resHeight: 100,
        duration: null,
        isOwned: true,
        fileName: "photo1.jpg"
      },
      key2: {
        mediaKey: "key2",
        dedupKey: "d2",
        thumb: "",
        timestamp: 0,
        creationTimestamp: 0,
        resWidth: 100,
        resHeight: 100,
        duration: null,
        isOwned: true,
        fileName: "photo2.jpg"
      },
      key3: {
        mediaKey: "key3",
        dedupKey: "d3",
        thumb: "",
        timestamp: 0,
        creationTimestamp: 0,
        resWidth: 100,
        resHeight: 100,
        duration: null,
        isOwned: true,
        fileName: "photo3.jpg"
      },
      key4: {
        mediaKey: "key4",
        dedupKey: "d4",
        thumb: "",
        timestamp: 0,
        creationTimestamp: 0,
        resWidth: 100,
        resHeight: 100,
        duration: null,
        isOwned: true,
        fileName: "photo4.jpg"
      }
    },
    4
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByRole("heading", {
      name: "2 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 5000
  })
  await expect(page.getByText("4 photos and videos checked")).toBeVisible()
  await expect(
    page.getByText("2 duplicate sets to review", { exact: true }).first()
  ).toBeVisible()
  await expect(
    page.getByText("How was your PhotoSweep scan?")
  ).not.toBeVisible()

  await page.close()
  await stub.close()
  await clearStorage(context)
})

test("filters review groups by exact and similar classification", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "exact-group",
        mediaKeys: ["exact1", "exact2"],
        originalMediaKey: "exact1",
        similarity: 0.99,
        duplicateKind: "exact",
        matchReasons: ["same dedupKey"]
      },
      {
        id: "similar-group",
        mediaKeys: ["similar1", "similar2"],
        originalMediaKey: "similar1",
        similarity: 0.95,
        duplicateKind: "similar",
        matchReasons: []
      }
    ],
    {
      exact1: {
        mediaKey: "exact1",
        dedupKey: "exact-dedup-1",
        thumb: "",
        timestamp: 0,
        creationTimestamp: 0,
        resWidth: 100,
        resHeight: 100,
        fileName: "exact1.jpg",
        contentHash: {
          value: "a".repeat(64),
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes"
        },
        provider: "google"
      },
      exact2: {
        mediaKey: "exact2",
        dedupKey: "exact-dedup-2",
        thumb: "",
        timestamp: 0,
        creationTimestamp: 0,
        resWidth: 100,
        resHeight: 100,
        fileName: "exact2.jpg",
        contentHash: {
          value: "a".repeat(64),
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes"
        },
        provider: "google"
      },
      similar1: {
        mediaKey: "similar1",
        dedupKey: "s1",
        thumb: "",
        timestamp: 0,
        creationTimestamp: 0,
        resWidth: 100,
        resHeight: 100,
        fileName: "similar1.jpg"
      },
      similar2: {
        mediaKey: "similar2",
        dedupKey: "s2",
        thumb: "",
        timestamp: 0,
        creationTimestamp: 0,
        resWidth: 100,
        resHeight: 100,
        fileName: "similar2.jpg"
      }
    },
    4
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByText("Verified identical", { exact: true })
  ).toBeVisible({
    timeout: 5000
  })
  await expect(page.getByText("Similar", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: /Verified identical \(1\)/i }).click()
  await expect(
    page.getByText("Verified identical", { exact: true })
  ).toBeVisible()
  await expect(page.getByText("Similar", { exact: true })).not.toBeVisible()
  await expect(page.getByText("2 sets total")).toBeVisible()
  await page
    .getByRole("button", { name: /^(Auto Keep|Selection)$/i })
    .first()
    .click()
  await page.getByRole("menuitem", { name: "Best quality" }).click()
  await expect(
    page
      .getByRole("region", { name: "Cleanup summary" })
      .getByRole("status")
  ).toHaveText(
    "2 sets included · 2 media items proposed for Trash · 2 sets left to review"
  )
  await expect(page.getByText("Verified identical", { exact: true })).toBeVisible()
  await expect(page.getByText("Similar", { exact: true })).not.toBeVisible()
  await expect(
    page.getByRole("button", { name: /Review 2 more to continue/i })
  ).toBeDisabled()
  await expect
    .poll(async () => {
      const stored = await readLocalStorage(context, ["selections"])
      return stored.selections as
        | { selectedGroupIds?: string[]; reviewedGroupIds?: string[] }
        | undefined
    })
    .toMatchObject({
      selectedGroupIds: ["exact-group", "similar-group"],
      reviewedGroupIds: []
    })

  await page
    .getByRole("button", { name: /Candidates & similar \(1\)/i })
    .click()
  await expect(page.getByText("Similar", { exact: true })).toBeVisible()
  await expect(
    page.getByText("Verified identical", { exact: true })
  ).not.toBeVisible()

  await page.close()
  await stub.close()
  await clearStorage(context)
})

test("clears saved results and selections when a different Google account is detected", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      }
    ],
    { key1: BASE_MEDIA_ITEMS.key1, key2: BASE_MEDIA_ITEMS.key2 },
    2,
    "alice@example.com"
  )
  await injectSelections(context, ["g1"], { g1: ["key2"] })

  const stub = await openGptkStubPage(context, {
    healthCheck: {
      data: {
        hasGptk: true,
        hasWizData: true,
        accountEmail: "bob@example.com"
      }
    }
  })
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByText("Find copies across your photo library")
  ).toBeVisible({
    timeout: 8_000
  })
  await expect(page.getByText("Signed in · bob@example.com")).toBeVisible()
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).not.toBeVisible()

  await expect
    .poll(() => readLocalStorage(context, ["scanResults", "selections"]))
    .toEqual({})

  await page.close()
  await stub.close()
  await clearStorage(context)
})

test("closes a paid prompt when a connected account changes", async () => {
  await clearStorage(context)
  const { groups, mediaItems } = makeGroups(2, 7)
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length,
    "alice@example.com"
  )

  const stub = await openGptkStubPage(context, {
    healthCheck: {
      data: {
        hasGptk: true,
        hasWizData: true,
        accountEmail: "alice@example.com"
      }
    }
  })
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByRole("heading", {
      name: "2 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({ timeout: 8_000 })
  await page.getByRole("button", { name: /^Include all(?: sets)?$/i }).click()
  await page.getByRole("button", { name: /Review & move 12 to Trash/i }).click()
  await expect(
    page.getByRole("heading", { name: "Unlock larger cleanup" })
  ).toBeVisible()

  await stub.evaluate(() => {
    ;(
      window as unknown as {
        __gptkOverrides: Record<string, unknown>
      }
    ).__gptkOverrides.healthCheck = {
      data: {
        hasGptk: true,
        hasWizData: true,
        accountEmail: "bob@example.com"
      }
    }
  })
  await page.evaluate(() => {
    chrome.runtime.sendMessage({
      app: "GPD",
      action: "healthCheck",
      provider: "google"
    })
  })

  await expect(
    page.getByRole("heading", { name: "Unlock larger cleanup" })
  ).not.toBeVisible({ timeout: 8_000 })
  await expect(page.getByText("Signed in · bob@example.com")).toBeVisible()

  await page.close()
  await stub.close()
  await clearStorage(context)
})

test("drops a delayed old-account trash result after identity changes", async () => {
  await clearStorage(context)
  const { groups, mediaItems } = makeGroups(2, 5)
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length,
    "alice@example.com"
  )

  const stub = await openGptkStubPage(context, {
    healthCheck: {
      data: {
        hasGptk: true,
        hasWizData: true,
        accountEmail: "alice@example.com"
      }
    },
    trashItems: { data: {}, delayMs: 1_000 }
  })
  const page = await openAppTab(context, extensionId)

  try {
    await expect(
      page.getByRole("heading", {
        name: "2 Duplicate Sets to Review",
        exact: true
      })
    ).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText("Signed in · alice@example.com")).toBeVisible()
    await page.getByRole("button", { name: /^Include all(?: sets)?$/i }).click()
    await page
      .getByRole("button", { name: /Review & move 8 to Trash/i })
      .click()
    await expect(
      page.getByRole("heading", { name: "Move to Trash" })
    ).toBeVisible()
    await page.getByLabel("Type 8 to confirm").fill("8")
    await page
      .getByRole("checkbox", {
        name: "I understand these items may be favorites"
      })
      .check()
    await page
      .getByRole("button", { name: /^Move to Trash$/i })
      .last()
      .click()

    await stub.evaluate(() => {
      ;(
        window as unknown as {
          __gptkOverrides: Record<string, unknown>
        }
      ).__gptkOverrides.healthCheck = {
        data: {
          hasGptk: true,
          hasWizData: true,
          accountEmail: "bob@example.com"
        }
      }
    })
    await page.evaluate(() => {
      chrome.runtime.sendMessage({
        app: "GPD",
        action: "healthCheck",
        provider: "google"
      })
    })

    await expect(page.getByText("Signed in · bob@example.com")).toBeVisible({
      timeout: 8_000
    })
    await expect(page.getByText(/moved to trash/i)).not.toBeVisible()
    await page.waitForTimeout(1_200)
    await expect(page.getByText(/moved to trash/i)).not.toBeVisible()
    await expect(
      page.getByRole("button", { name: /Undo moved items/i })
    ).not.toBeVisible()
  } finally {
    await page.close()
    await stub.close()
  }
})

test("dispatch-authorization rejects account drift during deferred audit persistence", async () => {
  await clearStorage(context)
  const { groups, mediaItems } = makeGroups(2, 5)
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length,
    "alice@example.com"
  )

  const stub = await openGptkStubPage(context, {
    healthCheck: {
      data: {
        hasGptk: true,
        hasWizData: true,
        accountEmail: "alice@example.com"
      }
    }
  })
  const page = await openAppTab(context, extensionId)

  try {
    await expect(
      page.getByRole("heading", {
        name: "2 Duplicate Sets to Review",
        exact: true
      })
    ).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText("Signed in · alice@example.com")).toBeVisible()
    await page.getByRole("button", { name: /^Include all(?: sets)?$/i }).click()
    await page
      .getByRole("button", { name: /Review & move 8 to Trash/i })
      .click()
    await page.getByLabel("Type 8 to confirm").fill("8")
    await page
      .getByRole("checkbox", {
        name: "I understand these items may be favorites"
      })
      .check()

    // Hold only the pre-trash report write. The confirmation handler must
    // re-read current selections after this await boundary before dispatching.
    await page.evaluate(() => {
      const barrier = {
        pending: false,
        release: null as (() => void) | null
      }
      ;(
        window as unknown as {
          __photosweepAuditBarrier: typeof barrier
        }
      ).__photosweepAuditBarrier = barrier
      const storage = chrome.storage.local as unknown as {
        set: (items: Record<string, unknown>) => Promise<void>
      }
      const originalSet = storage.set.bind(storage)
      storage.set = (items) => {
        if (!Object.prototype.hasOwnProperty.call(items, "deleteReports")) {
          return originalSet(items)
        }
        return new Promise<void>((resolve, reject) => {
          barrier.pending = true
          barrier.release = () => {
            originalSet(items).then(resolve).catch(reject)
          }
        })
      }
    })

    await page
      .getByRole("button", { name: /^Move to Trash$/i })
      .last()
      .click()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __photosweepAuditBarrier?: { pending: boolean }
              }
            ).__photosweepAuditBarrier?.pending ?? false
        )
      )
      .toBe(true)

    // Change the connected provider account while savePreTrashReport is still
    // pending. This is the real health-check message path used by the app.
    await stub.evaluate(() => {
      ;(
        window as unknown as {
          __gptkOverrides: Record<string, unknown>
        }
      ).__gptkOverrides.healthCheck = {
        data: {
          hasGptk: true,
          hasWizData: true,
          accountEmail: "bob@example.com"
        }
      }
    })
    await page.evaluate(() => {
      chrome.runtime.sendMessage({
        app: "GPD",
        action: "healthCheck",
        provider: "google"
      })
    })
    await expect(page.getByText("Signed in · bob@example.com")).toBeVisible({
      timeout: 8_000
    })
    await page.evaluate(() => {
      ;(
        window as unknown as {
          __photosweepAuditBarrier?: { release?: (() => void) | null }
        }
      ).__photosweepAuditBarrier?.release?.()
    })

    // The identity change invalidates the paid conversion generation before
    // dispatch. The deferred handler must therefore complete without opening
    // a Trash result or issuing a destructive provider command.
    await expect(page.getByText("Signed in · bob@example.com")).toBeVisible()
    await expect(page.getByText(/moved to trash/i)).not.toBeVisible()
    const commands = await stub.evaluate(
      () =>
        (
          window as unknown as {
            __gptkCommandLog?: Array<{ command: string }>
          }
        ).__gptkCommandLog || []
    )
    expect(commands.length).toBeGreaterThan(0)
    expect(commands.map((entry) => entry.command)).toContain("healthCheck")
    expect(commands.map((entry) => entry.command)).not.toContain("trashItems")
  } finally {
    await page.close()
    await stub.close()
    await clearStorage(context)
  }
})

test("dispatch-authorization rejects selection drift during deferred audit persistence", async () => {
  await clearStorage(context)
  const { groups, mediaItems } = makeGroups(2, 5)
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length,
    "alice@example.com"
  )

  const stub = await openGptkStubPage(context, {
    healthCheck: {
      data: {
        hasGptk: true,
        hasWizData: true,
        accountEmail: "alice@example.com"
      }
    }
  })
  const page = await openAppTab(context, extensionId)

  try {
    await expect(
      page.getByRole("heading", {
        name: "2 Duplicate Sets to Review",
        exact: true
      })
    ).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText("Signed in · alice@example.com")).toBeVisible()
    await page.getByRole("button", { name: /^Include all(?: sets)?$/i }).click()
    await page
      .getByRole("button", { name: /Review & move 8 to Trash/i })
      .click()
    await page.getByLabel("Type 8 to confirm").fill("8")
    await page
      .getByRole("checkbox", {
        name: "I understand these items may be favorites"
      })
      .check()

    await page.evaluate(() => {
      const barrier = {
        pending: false,
        release: null as (() => void) | null
      }
      ;(
        window as unknown as {
          __photosweepAuditBarrier: typeof barrier
        }
      ).__photosweepAuditBarrier = barrier
      const storage = chrome.storage.local as unknown as {
        set: (items: Record<string, unknown>) => Promise<void>
      }
      const originalSet = storage.set.bind(storage)
      storage.set = (items) => {
        if (!Object.prototype.hasOwnProperty.call(items, "deleteReports")) {
          return originalSet(items)
        }
        return new Promise<void>((resolve, reject) => {
          barrier.pending = true
          barrier.release = () => {
            originalSet(items).then(resolve).catch(reject)
          }
        })
      }
    })

    await page
      .getByRole("button", { name: /^Move to Trash$/i })
      .last()
      .click()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __photosweepAuditBarrier?: { pending: boolean }
              }
            ).__photosweepAuditBarrier?.pending ?? false
        )
      )
      .toBe(true)

    // The dialog backdrop blocks ordinary pointer input to the review list;
    // force-click the real group checkbox to exercise the React selection path
    // while the report write is held. The dispatch guard must reject the stale
    // confirmed plan after the await boundary.
    const changedSelection = page
      .locator('[role="checkbox"][aria-label^="Include duplicate set"]')
      .first()
    await expect(changedSelection).toHaveAttribute("aria-checked", "true")
    await changedSelection.evaluate((node) => (node as HTMLElement).click())
    await expect(changedSelection).toHaveAttribute("aria-checked", "false")

    await page.evaluate(() => {
      ;(
        window as unknown as {
          __photosweepAuditBarrier?: { release?: (() => void) | null }
        }
      ).__photosweepAuditBarrier?.release?.()
    })

    await expect(
      page.getByText(
        "Cleanup review changed while preparing the provider request. Review the current results again before moving anything to Trash."
      )
    ).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText(/moved to trash/i)).not.toBeVisible()
    const commands = await stub.evaluate(
      () =>
        (
          window as unknown as {
            __gptkCommandLog?: Array<{ command: string }>
          }
        ).__gptkCommandLog || []
    )
    expect(commands.length).toBeGreaterThan(0)
    expect(commands.map((entry) => entry.command)).toContain("healthCheck")
    expect(commands.map((entry) => entry.command)).not.toContain("trashItems")
  } finally {
    await page.close()
    await stub.close()
    await clearStorage(context)
  }
})

test("retires a deferred scan upgrade suggestion after identity changes", async () => {
  await clearStorage(context)
  const now = Date.now()
  const mediaItems = Array.from({ length: 1_001 }, (_, index) => {
    const key = `deferred-item-${index}`
    return {
      mediaKey: key,
      dedupKey: index < 2 ? "deferred-duplicate" : `deferred-${index}`,
      // Only the exact duplicate pair needs thumbnails. The remaining 999
      // items still count toward the free scan cap but do not enter detection.
      thumb:
        index < 2
          ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
          : "",
      productUrl: `https://photos.google.com/photo/${key}`,
      timestamp: now - index * 60_000,
      creationTimestamp: now - index * 60_000,
      resWidth: 100,
      resHeight: 100,
      fileName: `${key}.jpg`,
      isOwned: true
    }
  })
  const stub = await openGptkStubPage(context, {
    healthCheck: {
      data: {
        hasGptk: true,
        hasWizData: true,
        accountEmail: "alice@example.com"
      }
    }
  })
  await stub.evaluate((items) => {
    ;(
      window as unknown as {
        __gptkOverrides: Record<string, unknown>
      }
    ).__gptkOverrides.getAllMediaItems = { data: items }
  }, mediaItems)
  const page = await openAppTab(context, extensionId)

  try {
    await expect(page.getByText("Signed in · alice@example.com")).toBeVisible({
      timeout: 8_000
    })
    await page
      .getByRole("button", {
        name: /^(Scan recent 30 days|Check entire library(?: instead)?)$/i
      })
      .first()
      .click()
    await expect(
      page.getByText("Keep reviewing or unlock more of this cleanup")
    ).toBeVisible({ timeout: 30_000 })

    await stub.evaluate(() => {
      ;(
        window as unknown as {
          __gptkOverrides: Record<string, unknown>
        }
      ).__gptkOverrides.healthCheck = {
        data: {
          hasGptk: true,
          hasWizData: true,
          accountEmail: "bob@example.com"
        }
      }
    })
    await page.evaluate(() => {
      chrome.runtime.sendMessage({
        app: "GPD",
        action: "healthCheck",
        provider: "google"
      })
    })

    await expect(page.getByText("Signed in · bob@example.com")).toBeVisible({
      timeout: 8_000
    })
    await expect(
      page.getByText("Keep reviewing or unlock more of this cleanup")
    ).not.toBeVisible()
    await expect(
      page.getByRole("button", { name: "Compare plans" })
    ).not.toBeVisible()
  } finally {
    await page.close()
    await stub.close()
  }
})

test("does not open a stale checkout tab after results reset", async () => {
  await clearStorage(context)
  const apiBaseUrl =
    process.env.PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL ??
    "https://photosweep-license-api-206538169327.us-west1.run.app"
  const { groups, mediaItems } = makeGroups(2, 7)
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length,
    "test@example.com"
  )

  let checkoutRequested = false
  let releaseCheckout!: () => void
  const checkoutReleased = new Promise<void>((resolve) => {
    releaseCheckout = resolve
  })
  await context.route(`${apiBaseUrl}/checkout`, async (route) => {
    checkoutRequested = true
    await checkoutReleased
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "https://checkout.stripe.com/c/pay/stale",
        sessionId: "pls_stale",
        planId: "lifetime"
      })
    })
  })

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  try {
    await expect(
      page.getByRole("heading", {
        name: "2 Duplicate Sets to Review",
        exact: true
      })
    ).toBeVisible({ timeout: 8_000 })
    await page.getByRole("button", { name: /^Include all(?: sets)?$/i }).click()
    await page
      .getByRole("button", { name: /Review & move 12 to Trash/i })
      .click()
    await expect(
      page.getByRole("heading", { name: "Unlock larger cleanup" })
    ).toBeVisible()

    await page
      .getByRole("button", { name: /Choose Lifetime Early Access/i })
      .click()
    await expect.poll(() => checkoutRequested).toBe(true)

    await page
      .getByRole("button", { name: "Keep reviewing free results" })
      .click()
    await page.getByRole("button", { name: "New scan", exact: true }).click()

    releaseCheckout()
    await page.waitForTimeout(300)
    expect(
      context
        .pages()
        .filter((candidate) =>
          candidate.url().includes("checkout.stripe.com/c/pay/stale")
        )
    ).toHaveLength(0)
  } finally {
    releaseCheckout()
    await context.unroute(`${apiBaseUrl}/checkout`)
    await clearStorage(context)
    await page.close()
    await stub.close()
  }
})

test("keeps the free-results exit clickable after an unverified checkout return", async () => {
  await clearStorage(context)
  const apiBaseUrl =
    process.env.PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL ??
    "https://photosweep-license-api-206538169327.us-west1.run.app"
  const { groups, mediaItems } = makeGroups(2, 7)
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length,
    "test@example.com"
  )
  await injectSelections(
    context,
    groups.map((group) => group.id)
  )

  let checkoutStarts = 0
  let entitlementRefreshes = 0
  await context.route(`${apiBaseUrl}/checkout`, async (route) => {
    checkoutStarts += 1
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "https://checkout.stripe.com/c/pay/return",
        sessionId: "pls_return",
        planId: "lifetime"
      })
    })
  })
  await context.route(`${apiBaseUrl}/entitlement`, async (route) => {
    entitlementRefreshes += 1
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: "not-a-signed-entitlement" })
    })
  })

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  try {
    await expect(
      page.getByRole("heading", {
        name: "2 Duplicate Sets to Review",
        exact: true
      })
    ).toBeVisible({ timeout: 8_000 })
    await page.getByRole("button", { name: /^Include all(?: sets)?$/i }).click()
    await page
      .getByRole("button", { name: /Review & move 12 to Trash/i })
      .click()
    await expect(
      page.getByRole("heading", { name: "Unlock larger cleanup" })
    ).toBeVisible()
    await page
      .getByRole("button", { name: /Choose Lifetime Early Access/i })
      .click()
    await expect.poll(() => checkoutStarts).toBe(1)

    // The checkout-opened recovery message is retained for after-close
    // visibility but must not render an alert above the open dialog.
    await expect(
      page.getByRole("alert").filter({ hasText: /Checkout opened/i })
    ).not.toBeVisible()

    await page.bringToFront()
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect.poll(() => entitlementRefreshes).toBeGreaterThan(0)
    await expect(
      page.getByText(
        /Payment is still being confirmed|Payment could not be verified yet/i
      )
    ).toBeVisible({ timeout: 8_000 })

    // This is intentionally a normal pointer click. A persistent Snackbar
    // must not intercept the dialog's free exit.
    await page
      .getByRole("button", { name: "Keep reviewing free results" })
      .click()
    await expect(
      page.getByRole("button", { name: /Review & move 12 to Trash/i })
    ).toBeVisible()
    await expect(page.getByText(/moved to trash/i)).not.toBeVisible()
  } finally {
    await context.unroute(`${apiBaseUrl}/checkout`)
    await context.unroute(`${apiBaseUrl}/entitlement`)
    await clearStorage(context)
    for (const candidate of context.pages()) {
      if (candidate !== page && candidate !== stub) {
        await candidate.close().catch(() => {})
      }
    }
    await page.close()
    await stub.close()
  }
})

test("clears legacy saved results when the current Google account is known", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      }
    ],
    { key1: BASE_MEDIA_ITEMS.key1, key2: BASE_MEDIA_ITEMS.key2 },
    2,
    null
  )
  await injectSelections(context, ["g1"], { g1: ["key2"] })

  const stub = await openGptkStubPage(context, {
    healthCheck: {
      data: {
        hasGptk: true,
        hasWizData: true,
        accountEmail: "known@example.com"
      }
    }
  })
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByText("Find copies across your photo library")
  ).toBeVisible({
    timeout: 8_000
  })
  await expect(page.getByText("Signed in · known@example.com")).toBeVisible()
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).not.toBeVisible()

  await expect
    .poll(() => readLocalStorage(context, ["scanResults", "selections"]))
    .toEqual({})

  await page.close()
  await stub.close()
  await clearStorage(context)
})

test("shows 'no duplicates found' when scan returns zero groups", async () => {
  await clearStorage(context)
  await injectScanResults(context, [], {}, 500)

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByText("No duplicate sets found in this scan.")
  ).toBeVisible({ timeout: 5000 })
  await expect(page.getByText(/try Full scan/i)).toBeVisible()

  await page.close()
  await stub.close()
  await clearStorage(context)
})

test("a delayed identity restore released after scan completion cannot replace its results", async () => {
  await clearStorage(context)
  const savedReview = makeGroups(1, 2)
  await injectScanResults(
    context,
    savedReview.groups,
    savedReview.mediaItems,
    Object.keys(savedReview.mediaItems).length
  )
  const scanResultsStorageKey = providerReviewStorageKey("google", "scanResults")
  const scanCheckpointStorageKey = providerReviewStorageKey(
    "google",
    "scanCheckpoint"
  )
  await context.addInitScript(
    ({ scanResultsStorageKey, scanCheckpointStorageKey }) => {
      if (
        !location.pathname.endsWith("/tabs/app.html") ||
        !location.search.includes("delay-review-restore")
      ) {
        return
      }
      const storage = chrome.storage.local
      const originalGet = storage.get.bind(storage)
      let reviewRestoreReads = 0
      ;(
        window as unknown as {
          __gpdReviewRestoreReads?: number
          __gpdReviewRestorePaused?: boolean
          __gpdReleaseReviewRestore?: (() => void) | null
        }
      ).__gpdReleaseReviewRestore = null
      storage.get = ((keys: string | string[] | null, callback?: (items: Record<string, unknown>) => void) => {
        const isReviewRestoreRead =
          Array.isArray(keys) &&
          keys.includes(scanResultsStorageKey) &&
          keys.includes(scanCheckpointStorageKey)
        if (isReviewRestoreRead) reviewRestoreReads += 1
        return originalGet(keys).then((items) => {
          if (isReviewRestoreRead && reviewRestoreReads === 2) {
            const globals = window as unknown as {
              __gpdReviewRestoreReads?: number
              __gpdReviewRestorePaused?: boolean
              __gpdReleaseReviewRestore?: (() => void) | null
            }
            globals.__gpdReviewRestoreReads = reviewRestoreReads
            globals.__gpdReviewRestorePaused = true
            return new Promise<Record<string, unknown>>((resolve) => {
              globals.__gpdReleaseReviewRestore = () => {
                callback?.(items)
                resolve(items)
              }
            })
          }
          const globals = window as unknown as {
            __gpdReviewRestoreReads?: number
          }
          globals.__gpdReviewRestoreReads = reviewRestoreReads
          callback?.(items)
          return items
        })
      }) as typeof storage.get
    },
    { scanResultsStorageKey, scanCheckpointStorageKey }
  )

  const stub = await openGptkStubPage(context, {
    // Keep the first read identity-pending so the second read is deterministically
    // the current-owner restore that this test releases after a new scan.
    healthCheck: { delayMs: 500 }
  })
  await stub.evaluate(() => {
    ;(
      window as unknown as {
        __gptkOverrides: Record<string, unknown>
      }
    ).__gptkOverrides.getAllMediaItems = { data: [], delayMs: 700 }
  })
  const page = await context.newPage()
  await page.goto(
    `chrome-extension://${extensionId}/tabs/app.html?delay-review-restore`
  )

  try {
    const consentButton = page.getByRole("button", {
      name: "I understand, continue",
      exact: true
    })
    if (await consentButton.isVisible().catch(() => false)) {
      await consentButton.click()
    }
    await expect(page.getByText("Signed in · test@example.com")).toBeVisible({
      timeout: 8_000
    })
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __gpdReviewRestorePaused?: boolean
              }
            ).__gpdReviewRestorePaused === true
        )
      )
      .toBe(true)

    const analyticsNoticeDismiss = page.getByRole("button", {
      name: "No thanks",
      exact: true
    })
    if (await analyticsNoticeDismiss.isVisible().catch(() => false)) {
      await analyticsNoticeDismiss.click({ timeout: 5_000 })
    }
    const dateInputs = page.locator('input[type="date"]')
    await dateInputs.nth(0).fill("2026-10-02")
    await dateInputs.nth(1).fill("2026-10-03")
    const scanButton = page.getByRole("button", {
      name: "Check this date range",
      exact: true
    })
    await expect(scanButton).toBeEnabled()
    await scanButton.click({ timeout: 5_000 })
    await expect
      .poll(
        () =>
          stub.evaluate(
            () =>
              (
                window as unknown as {
                  __gptkCommandLog?: Array<{ command: string }>
                }
              ).__gptkCommandLog?.some(
                (entry) => entry.command === "getAllMediaItems"
              ) ?? false
          ),
        { timeout: 8_000 }
      )
      .toBe(true)

    await expect(
      page.getByText("No duplicate sets found in this scan.")
    ).toBeVisible({ timeout: 10_000 })
    const savedResultsBeforeRelease = await readLocalStorage(context, [
      "scanResults"
    ])
    expect(
      (savedResultsBeforeRelease.scanResults as { groups?: unknown[] })?.groups
    ).toHaveLength(1)
    await page.evaluate(() => {
      ;(
        window as unknown as {
          __gpdReleaseReviewRestore?: (() => void) | null
        }
      ).__gpdReleaseReviewRestore?.()
    })
    await expect(
      page.getByRole("heading", {
        name: "1 Duplicate Set to Review",
        exact: true
      })
    ).not.toBeVisible()
    await expect(
      page.getByText("No duplicate sets found in this scan.")
    ).toBeVisible()
    await expect
      .poll(async () => (await readLocalStorage(context, ["scanResults"])).scanResults)
      .toBeUndefined()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __gpdReviewRestoreReads?: number
              }
            ).__gpdReviewRestoreReads
        )
      )
      .toBe(2)
  } finally {
    await page
      .evaluate(() => {
        ;(
          window as unknown as {
            __gpdReleaseReviewRestore?: (() => void) | null
          }
        ).__gpdReleaseReviewRestore?.()
      })
      .catch(() => {})
    await page.close()
    await stub.close()
    await clearStorage(context)
  }
})

test("migrates untouched old smart defaults to full scan", async () => {
  await clearStorage(context)
  const gpPage = await openGptkStubPage(context)
  const sw = context.serviceWorkers()[0]
  await sw.evaluate(
    () =>
      new Promise<void>((resolve) => {
        chrome.storage.local.set(
          {
            settings: {
              scanMode: "smart",
              similarityThreshold: 0.99,
              smartWindowSec: 1
            }
          },
          resolve
        )
      })
  )

  const page = await openAppTab(context, extensionId)
  await page.getByRole("button", { name: /Advanced matching/i }).click()

  await expect(page.getByRole("button", { name: /^Smart$/i })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  await expect(page.getByText(/Sensitivity:/i)).toContainText("0.95")

  await page.close()
  await gpPage.close()
  await clearStorage(context)
})

test("preserves intentional strict similarity settings", async () => {
  await clearStorage(context)
  const gpPage = await openGptkStubPage(context)
  const sw = context.serviceWorkers()[0]
  await sw.evaluate(
    () =>
      new Promise<void>((resolve) => {
        chrome.storage.local.set(
          {
            settings: {
              scanMode: "full",
              similarityThreshold: 0.99,
              smartWindowSec: 1
            }
          },
          resolve
        )
      })
  )

  const page = await openAppTab(context, extensionId)
  await page.getByRole("button", { name: /Advanced matching/i }).click()

  await expect(page.getByRole("button", { name: /^Smart$/i })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  await expect(page.getByText(/Sensitivity:/i)).toContainText("0.99")

  await page.close()
  await gpPage.close()
  await clearStorage(context)
})

test("opens feedback from settings with the support inbox prefilled", async () => {
  await clearStorage(context)
  const gpPage = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)

  try {
    await expect(
      page.getByText("Find copies across your photo library")
    ).toBeVisible({ timeout: 8_000 })
    await page.getByRole("button", { name: /Help & feedback/i }).click()

    await expect(
      page.getByText("Opens a new email addressed to pawsitivegames@gmail.com.")
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Send feedback" })
    ).toHaveAttribute(
      "href",
      "mailto:pawsitivegames@gmail.com?subject=PhotoSweep%20feedback"
    )
  } finally {
    await page.close()
    await gpPage.close()
    await clearStorage(context)
  }
})

test("shows disconnected state when GP tab is not open and no saved results", async () => {
  await clearStorage(context)

  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByText(/Cannot connect to Google Photos|open photos\.google\.com/i)
  ).toBeVisible({ timeout: 8000 })

  await page.close()
})

test("offers resume when a previous scan checkpoint was interrupted", async () => {
  await clearStorage(context)
  const gpPage = await openGptkStubPage(context)
  await injectScanCheckpoint(context, {
    id: "req-interrupted",
    status: "active",
    startedAt: Date.now() - 60_000,
    updatedAt: Date.now() - 30_000,
    accountEmail: "test@example.com",
    settings: {
      scanMode: "smart",
      similarityThreshold: 0.99,
      smartWindowSec: 1,
      dateRange: { from: "2024-01-01", to: "2024-12-31" }
    },
    phase: "computing_embeddings",
    itemsProcessed: 50,
    totalEstimate: 100,
    message: "computing_embeddings: 50/100"
  })

  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByRole("button", { name: /Continue previous scan/i })
  ).toBeVisible({ timeout: 5000 })
  await expect(page.getByText(/Previous smart scan/i)).toContainText(
    "2024-01-01 to 2024-12-31"
  )

  await page.close()
  await gpPage.close()
  await clearStorage(context)
})

test("clears resumable checkpoint when a different Google account is detected", async () => {
  await clearStorage(context)
  const gpPage = await openGptkStubPage(context, {
    healthCheck: {
      data: {
        hasGptk: true,
        hasWizData: true,
        accountEmail: "bob@example.com"
      }
    }
  })
  await injectScanCheckpoint(context, {
    id: "req-wrong-account",
    status: "interrupted",
    startedAt: Date.now() - 60_000,
    updatedAt: Date.now() - 30_000,
    accountEmail: "alice@example.com",
    settings: {
      scanMode: "smart",
      similarityThreshold: 0.99,
      smartWindowSec: 1
    },
    phase: "computing_embeddings",
    itemsProcessed: 50,
    totalEstimate: 100,
    message: "computing_embeddings: 50/100"
  })

  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByText("Find copies across your photo library")
  ).toBeVisible({
    timeout: 8_000
  })
  await expect(
    page.getByRole("button", { name: /Continue previous scan/i })
  ).not.toBeVisible()

  const stored = await readLocalStorage(context, ["scanCheckpoint"])
  expect(stored.scanCheckpoint).toBeUndefined()

  await page.close()
  await gpPage.close()
  await clearStorage(context)
})

test("resumes duplicate detection from a checkpointed media list without refetching", async () => {
  await clearStorage(context)
  const gpPage = await openGptkStubPage(context)
  const { mediaItems } = makeGroups(1, 2)
  await injectScanCheckpoint(context, {
    id: "req-media-checkpoint",
    status: "interrupted",
    startedAt: Date.now() - 60_000,
    updatedAt: Date.now() - 30_000,
    accountEmail: "test@example.com",
    settings: {
      scanMode: "smart",
      similarityThreshold: 0.99,
      smartWindowSec: 1
    },
    phase: "computing_embeddings",
    itemsProcessed: 1,
    totalEstimate: 2,
    message: "computing_embeddings: 1/2",
    mediaItems: Object.values(mediaItems)
  })

  const page = await openAppTab(context, extensionId)

  await expect(page.getByText(/Fetched media list \(2 items\)/i)).toBeVisible({
    timeout: 5000
  })
  await page.getByRole("button", { name: /Continue previous scan/i }).click()
  await expect(
    page.getByText("No duplicate sets found in this scan.")
  ).toBeVisible({ timeout: 10_000 })
  await expect(
    page.getByText("How was your PhotoSweep cleanup?")
  ).not.toBeVisible()

  const ratingPrompt = await context.serviceWorkers()[0].evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve) => {
        chrome.storage.local.get("ratingPrompt", resolve)
      })
  )
  expect(ratingPrompt.ratingPrompt).toBeUndefined()

  const commands = await gpPage.evaluate(
    () =>
      (
        window as unknown as {
          __gptkCommandLog?: Array<{ command: string }>
        }
      ).__gptkCommandLog || []
  )
  expect(commands.map((entry) => entry.command)).not.toContain(
    "getAllMediaItems"
  )

  await page.close()
  await gpPage.close()
  await clearStorage(context)
})

test("loads albums and allows choosing an album scan scope", async () => {
  await clearStorage(context)
  const gpPage = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)

  await page.getByRole("button", { name: /Advanced matching/i }).click()
  await expect(
    page.getByText("1 album available.", { exact: true })
  ).toBeVisible({ timeout: 5000 })
  const albumRequest = await gpPage.evaluate(() => {
    const commands =
      (
        window as unknown as {
          __gptkCommandLog?: Array<{
            command: string
            args?: Record<string, unknown>
          }>
        }
      ).__gptkCommandLog || []
    return commands.find((entry) => entry.command === "listAlbums")
  })
  expect(albumRequest?.args).toMatchObject({ accountEmail: "test@example.com" })
  expect(albumRequest?.args?.providerSessionId).toEqual(expect.any(String))
  await page.getByRole("combobox", { name: /Library area/i }).click()
  await page.getByRole("option", { name: /Tiny test album/i }).click()

  await expect(
    page.getByRole("button", { name: /Check this album/i })
  ).toBeVisible()
  await expect(page.getByText(/Only checking Tiny test album/i)).toBeVisible()

  await page.close()
  await gpPage.close()
  await clearStorage(context)
})

test("drops a delayed Google album response after the same account gets a new page session", async () => {
  await clearStorage(context)
  const firstSession = "google-page-session-first"
  const nextSession = "google-page-session-next"
  const gpPage = await openGptkStubPage(context, {
    healthCheck: {
      data: {
        hasGptk: true,
        hasWizData: true,
        accountEmail: "same@example.com",
        providerSessionId: firstSession
      }
    },
    listAlbums: {
      sequence: [
        {
          data: [
            {
              mediaKey: "old-page-album",
              title: "Old page album",
              isShared: false
            }
          ],
          delayMs: 1_200
        },
        {
          data: [
            {
              mediaKey: "new-page-album",
              title: "New page album",
              isShared: false
            }
          ]
        }
      ]
    }
  })
  const page = await openAppTab(context, extensionId)

  try {
    await expect(page.getByText("Signed in · same@example.com")).toBeVisible({
      timeout: 8_000
    })
    await expect
      .poll(() =>
        gpPage.evaluate(
          () =>
            (
              window as unknown as {
                __gptkCommandLog?: Array<{ command: string }>
              }
            ).__gptkCommandLog?.filter(
              (entry) => entry.command === "listAlbums"
            ).length ?? 0
        )
      )
      .toBe(1)

    await gpPage.evaluate((sessionId) => {
      ;(
        window as unknown as {
          __gptkOverrides: Record<string, unknown>
        }
      ).__gptkOverrides.healthCheck = {
        data: {
          hasGptk: true,
          hasWizData: true,
          accountEmail: "same@example.com",
          providerSessionId: sessionId
        }
      }
    }, nextSession)
    await page.evaluate(() => {
      chrome.runtime.sendMessage({
        app: "GPD",
        action: "healthCheck",
        provider: "google"
      })
    })

    await expect
      .poll(() =>
        gpPage.evaluate(() => {
          const requests =
            (
              window as unknown as {
                __gptkCommandLog?: Array<{
                  command: string
                  args?: Record<string, unknown>
                }>
              }
            ).__gptkCommandLog?.filter(
              (entry) => entry.command === "listAlbums"
            ) || []
          return requests[1]?.args?.providerSessionId
        })
      )
      .toBe(nextSession)

    await page.getByRole("button", { name: /Advanced matching/i }).click()
    await page.getByRole("combobox", { name: /Library area/i }).click()
    await expect(
      page.getByRole("option", { name: "New page album" })
    ).toBeVisible({ timeout: 5_000 })
    await page.waitForTimeout(1_300)
    await expect(
      page.getByRole("option", { name: "Old page album" })
    ).toHaveCount(0)
    await expect(
      page.getByRole("option", { name: "New page album" })
    ).toBeVisible()
  } finally {
    await page.close()
    await gpPage.close()
    await clearStorage(context)
  }
})

// ============================================================
// Selection persistence
// ============================================================

const BASE_MEDIA_ITEMS = {
  key1: {
    mediaKey: "key1",
    dedupKey: "d1",
    thumb: "",
    timestamp: 0,
    creationTimestamp: 0,
    resWidth: 100,
    resHeight: 100,
    duration: null,
    isOwned: true,
    fileName: "photo1.jpg"
  },
  key2: {
    mediaKey: "key2",
    dedupKey: "d2",
    thumb: "",
    timestamp: 0,
    creationTimestamp: 0,
    resWidth: 100,
    resHeight: 100,
    duration: null,
    isOwned: true,
    fileName: "photo2.jpg"
  },
  key3: {
    mediaKey: "key3",
    dedupKey: "d3",
    thumb: "",
    timestamp: 0,
    creationTimestamp: 0,
    resWidth: 100,
    resHeight: 100,
    duration: null,
    isOwned: true,
    fileName: "photo3.jpg"
  },
  key4: {
    mediaKey: "key4",
    dedupKey: "d4",
    thumb: "",
    timestamp: 0,
    creationTimestamp: 0,
    resWidth: 100,
    resHeight: 100,
    duration: null,
    isOwned: true,
    fileName: "photo4.jpg"
  },
  key5: {
    mediaKey: "key5",
    dedupKey: "d5",
    thumb: "",
    timestamp: 0,
    creationTimestamp: 0,
    resWidth: 100,
    resHeight: 100,
    duration: null,
    isOwned: true,
    fileName: "photo5.jpg"
  },
  key6: {
    mediaKey: "key6",
    dedupKey: "d6",
    thumb: "",
    timestamp: 0,
    creationTimestamp: 0,
    resWidth: 100,
    resHeight: 100,
    duration: null,
    isOwned: true,
    fileName: "photo6.jpg"
  }
}

test("persists group selections through page reload", async () => {
  // 3 groups; only g1 and g3 are selected (g2 is deselected)
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      },
      {
        id: "g2",
        mediaKeys: ["key3", "key4"],
        originalMediaKey: "key3",
        similarity: 0.98
      },
      {
        id: "g3",
        mediaKeys: ["key5", "key6"],
        originalMediaKey: "key5",
        similarity: 0.97
      }
    ],
    BASE_MEDIA_ITEMS,
    6
  )
  await injectSelections(context, ["g1", "g3"], {})

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 5000
  })

  const checkboxes = page.locator('input[type="checkbox"]')
  await expect(checkboxes.nth(0)).toBeChecked() // g1 selected
  await expect(checkboxes.nth(1)).not.toBeChecked() // g2 deselected
  await expect(checkboxes.nth(2)).toBeChecked() // g3 selected

  await checkboxes.nth(1).check()
  await expect(checkboxes.nth(1)).toBeChecked()
  await expect
    .poll(async () => {
      const stored = await readLocalStorage(context, ["selections"])
      return (
        stored.selections as { selectedGroupIds?: string[] } | undefined
      )?.selectedGroupIds
    })
    .toEqual(["g1", "g3", "g2"])

  await page.reload()
  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 5000
  })
  await expect(checkboxes.nth(0)).toBeChecked()
  await expect(checkboxes.nth(1)).toBeChecked()
  await expect(checkboxes.nth(2)).toBeChecked()
  await expect(
    page.getByText("3 media items proposed for Trash", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: /Review & move 3 to Trash/i })
  ).toBeVisible()

  await page.close()
  await stub.close()
  await context.unroute("https://photos.google.com/**")
  await clearStorage(context)
})

test("re-scan clears saved results, selections, and resumable checkpoint", async () => {
  await clearStorage(context)
  const gpPage = await openGptkStubPage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      }
    ],
    { key1: BASE_MEDIA_ITEMS.key1, key2: BASE_MEDIA_ITEMS.key2 },
    2
  )
  await injectSelections(context, ["g1"], { g1: ["key2"] })
  await injectScanCheckpoint(context, {
    id: "req-stale",
    status: "interrupted",
    startedAt: Date.now() - 60_000,
    updatedAt: Date.now() - 30_000,
    accountEmail: "test@example.com",
    settings: {
      scanMode: "smart",
      similarityThreshold: 0.99,
      smartWindowSec: 1
    },
    phase: "computing_embeddings",
    itemsProcessed: 50,
    totalEstimate: 100,
    message: "computing_embeddings: 50/100"
  })

  const page = await openAppTab(context, extensionId)
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 5_000
  })

  await page.getByRole("button", { name: /Scan again/i }).click()
  await expect(
    page.getByText("Find copies across your photo library")
  ).toBeVisible({
    timeout: 8_000
  })

  const stored = await readLocalStorage(context, [
    "scanResults",
    "selections",
    "scanCheckpoint"
  ])
  expect(stored.scanResults).toBeUndefined()
  expect(stored.selections).toBeUndefined()
  expect(stored.scanCheckpoint).toBeUndefined()

  await page.reload()
  await expect(
    page.getByText("Find copies across your photo library")
  ).toBeVisible({
    timeout: 8_000
  })
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).not.toBeVisible()

  await page.close()
  await gpPage.close()
  await clearStorage(context)
})

test("persists kept overrides through page reload", async () => {
  // g1 has 2 items; default keep is key1 but we override to keep key2 instead
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      }
    ],
    { key1: BASE_MEDIA_ITEMS.key1, key2: BASE_MEDIA_ITEMS.key2 },
    2
  )
  await injectSelections(
    context,
    ["g1"],
    { g1: ["key2"] },
    "google",
    { g1: { source: "manual" } }
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 5000
  })

  // key2 (second card) should have the Keep chip; key1 (first card) should not
  const cards = page.locator(".MuiCard-root")
  await expect(cards.nth(0)).not.toContainText("Keep") // key1 — not kept
  await expect(cards.nth(1)).toContainText("Keep") // key2 — kept

  await page.reload()
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 5000
  })
  await expect(cards.nth(0)).not.toContainText("Keep")
  await expect(cards.nth(1)).toContainText("Keep")

  await page.close()
  await stub.close()
  await clearStorage(context)
})

test("applies an automatic keep strategy and preserves it after reload", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      }
    ],
    {
      key1: {
        ...BASE_MEDIA_ITEMS.key1,
        isOriginalQuality: true,
        resWidth: 100,
        resHeight: 100,
        fileName: "key1.jpg"
      },
      key2: {
        ...BASE_MEDIA_ITEMS.key2,
        isOriginalQuality: false,
        resWidth: 400,
        resHeight: 400,
        fileName: "key2.jpg"
      }
    },
    2
  )
  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible({ timeout: 5000 })

  await expect(
    page.getByRole("button", {
      name: /Keep key1\.jpg \(currently kept; this is the last kept copy/
    })
  ).toHaveAttribute("aria-pressed", "true")

  await page
    .getByRole("button", { name: /^(Auto Keep|Selection)$/i })
    .first()
    .click()
  await page.getByRole("menuitem", { name: "Largest resolution" }).click()

  await expect(page.getByTestId("keep-decision-g1")).toHaveText(
    "Suggested keep: Largest resolution"
  )
  await expect(
    page.getByRole("button", {
      name: /Keep key2\.jpg \(currently kept; this is the last kept copy/
    })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(
    page.getByRole("button", {
      name: /Keep key1\.jpg \(currently moves to Trash; favorite status unknown; click to keep\)/
    })
  ).toHaveAttribute("aria-pressed", "false")

  await page.reload()
  await expect(page.getByTestId("keep-decision-g1")).toHaveText(
    "Suggested keep: Largest resolution"
  )
  await expect(
    page.getByRole("button", {
      name: /Keep key2\.jpg \(currently kept; this is the last kept copy/
    })
  ).toHaveAttribute("aria-pressed", "true")

  await page.close()
  await stub.close()
  await clearStorage(context)
})

test("applies all six keep strategies through the app toolbar", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      }
    ],
    {
      key1: {
        ...BASE_MEDIA_ITEMS.key1,
        isOriginalQuality: true,
        resWidth: 100,
        resHeight: 100,
        timestamp: 200,
        timestampProvenance: "capture",
        creationTimestamp: 200,
        creationTimestampProvenance: "creation",
        takesUpSpace: true,
        fileName: "key1.jpg"
      },
      key2: {
        ...BASE_MEDIA_ITEMS.key2,
        isOriginalQuality: false,
        resWidth: 400,
        resHeight: 400,
        timestamp: 100,
        timestampProvenance: "capture",
        creationTimestamp: 100,
        creationTimestampProvenance: "creation",
        takesUpSpace: false,
        fileName: "key2.jpg"
      }
    },
    2
  )

  // Saved account-scoped results are intentionally held until the provider
  // identity is known. This intercepted stub supplies that identity without
  // contacting Google Photos.
  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible({ timeout: 5000 })

  const strategies = [
    { label: "Largest resolution", keptKey: "key2" },
    { label: "Newest taken date", keptKey: "key1" },
    { label: "Oldest taken date", keptKey: "key2" },
    { label: "Newest upload date", keptKey: "key1" },
    { label: "Non-storage-counting", keptKey: "key2" },
    { label: "Best quality", keptKey: "key1" }
  ] as const
  const initialProviderCommands = await stub.evaluate(
    () =>
      (
        window as unknown as {
          __gptkCommandLog?: Array<{ command: string }>
        }
      ).__gptkCommandLog?.length ?? 0
  )

  for (const strategy of strategies) {
    await page
      .getByRole("button", { name: /^(Auto Keep|Selection)$/i })
      .first()
      .click()
    await page.getByRole("menuitem", { name: strategy.label }).click()

    await expect(
      page.getByRole("status").filter({
        hasText: `${strategy.label} was applied and saved as the default: 1 set changed`
      })
    ).toContainText(
      "1 set included for cleanup review; 1 media item proposed for Trash"
    )
    await expect(
      page
        .getByRole("region", { name: "Cleanup summary" })
        .getByRole("status")
    ).toHaveText(
      "1 set included · 1 media item proposed for Trash · 1 set left to review"
    )
    await expect(page.getByRole("checkbox", { name: /Include duplicate set/ })).toHaveAttribute(
      "aria-checked",
      "true"
    )
    await expect(
      page.getByRole("button", {
        name: /Keep key1\.jpg /
      })
    ).toHaveAttribute(
      "aria-pressed",
      strategy.keptKey === "key1" ? "true" : "false"
    )
    await expect(
      page.getByRole("button", {
        name: /Keep key2\.jpg /
      })
    ).toHaveAttribute(
      "aria-pressed",
      strategy.keptKey === "key2" ? "true" : "false"
    )
    const trashTarget =
      strategy.keptKey === "key1"
        ? page.getByRole("button", {
            name: /Keep key2\.jpg \(currently moves to Trash/
          })
        : page.getByRole("button", {
            name: /Keep key1\.jpg \(currently moves to Trash/
          })
    await expect(trashTarget).toHaveAttribute("aria-pressed", "false")
    await expect(
      page.getByRole("button", { name: /Review 1 more to continue/i })
    ).toBeDisabled()
    await expect(
      page.getByRole("button", { name: /Review & move 1 to Trash/i })
    ).not.toBeVisible()
  }

  await expect
    .poll(async () => {
      const stored = await readLocalStorage(context, ["selections"])
      return stored.selections as
        | {
            keptOverrides?: Record<string, string[]>
            keepDecisionProvenance?: Record<
              string,
              { source: string; strategy?: string }
            >
            selectedGroupIds?: string[]
            reviewedGroupIds?: string[]
          }
        | undefined
    })
    .toMatchObject({
      keptOverrides: { g1: ["key1"] },
      keepDecisionProvenance: {
        g1: { source: "automatic", strategy: "best_quality" }
      },
      selectedGroupIds: ["g1"],
      reviewedGroupIds: []
    })

  await page.reload()
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible({ timeout: 5_000 })
  await expect(
    page.getByRole("region", { name: "Cleanup summary" }).getByRole("status")
  ).toHaveText(
    "1 set included · 1 media item proposed for Trash · 1 set left to review"
  )
  await expect(
    page.getByRole("button", { name: /Review 1 more to continue/i })
  ).toBeDisabled()
  await expect(
    page.getByRole("button", {
      name: /Keep key1\.jpg \(currently kept; this is the last kept copy/
    })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(
    page.getByRole("button", {
      name: /Keep key2\.jpg \(currently moves to Trash; favorite status unknown/
    })
  ).toHaveAttribute("aria-pressed", "false")

  const newProviderCommands = await stub.evaluate(
    (initialCount) =>
      (
        window as unknown as {
          __gptkCommandLog?: Array<{ command: string }>
        }
      ).__gptkCommandLog?.slice(initialCount) ?? [],
    initialProviderCommands
  )
  expect(
    newProviderCommands.map((entry) => entry.command).filter((command) =>
      /trash|delete|remove/i.test(command)
    )
  ).toEqual([])

  await page.close()
  await stub.close()
  await context.unroute("https://photos.google.com/**")
  await clearStorage(context)
})

test("applies Best quality independently across two completed duplicate sets", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "quality-set-a",
        mediaKeys: ["quality-a-best", "quality-a-high-resolution"],
        originalMediaKey: "quality-a-high-resolution",
        similarity: 0.99
      },
      {
        id: "quality-set-b",
        mediaKeys: ["quality-b-high-resolution", "quality-b-best"],
        originalMediaKey: "quality-b-high-resolution",
        similarity: 0.98
      }
    ],
    {
      "quality-a-best": {
        ...BASE_MEDIA_ITEMS.key1,
        mediaKey: "quality-a-best",
        dedupKey: "quality-a-best",
        isOriginalQuality: true,
        resWidth: 100,
        resHeight: 100,
        fileName: "quality-a-best.jpg"
      },
      "quality-a-high-resolution": {
        ...BASE_MEDIA_ITEMS.key2,
        mediaKey: "quality-a-high-resolution",
        dedupKey: "quality-a-high-resolution",
        isOriginalQuality: false,
        resWidth: 4000,
        resHeight: 3000,
        fileName: "quality-a-high-resolution.jpg"
      },
      "quality-b-high-resolution": {
        ...BASE_MEDIA_ITEMS.key3,
        mediaKey: "quality-b-high-resolution",
        dedupKey: "quality-b-high-resolution",
        isOriginalQuality: false,
        resWidth: 5000,
        resHeight: 4000,
        fileName: "quality-b-high-resolution.jpg"
      },
      "quality-b-best": {
        ...BASE_MEDIA_ITEMS.key4,
        mediaKey: "quality-b-best",
        dedupKey: "quality-b-best",
        isOriginalQuality: true,
        resWidth: 200,
        resHeight: 150,
        fileName: "quality-b-best.jpg"
      }
    },
    4
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  await expect(
    page.getByRole("heading", {
      name: "2 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({ timeout: 5000 })
  const initialProviderCommands = await stub.evaluate(
    () =>
      (
        window as unknown as {
          __gptkCommandLog?: Array<{ command: string }>
        }
      ).__gptkCommandLog?.length ?? 0
  )

  await page
    .getByRole("button", { name: /^(Auto Keep|Selection)$/i })
    .first()
    .click()
  await page.getByRole("menuitem", { name: "Best quality" }).click()

  await expect(page.getByTestId("keep-decision-quality-set-a")).toHaveText(
    "Suggested keep: Best quality"
  )
  await expect(page.getByTestId("keep-decision-quality-set-b")).toHaveText(
    "Suggested keep: Best quality"
  )
  await expect(
    page.getByRole("region", { name: "Cleanup summary" }).getByRole("status")
  ).toHaveText(
    "2 sets included · 2 media items proposed for Trash · 2 sets left to review"
  )

  const expectedKeeperStates = [
    ["quality-a-best.jpg", true],
    ["quality-a-high-resolution.jpg", false],
    ["quality-b-high-resolution.jpg", false],
    ["quality-b-best.jpg", true]
  ] as const
  for (const [fileName, isKept] of expectedKeeperStates) {
    const filePattern = fileName.replaceAll(".", "\\.")
    const itemButton = page.getByRole("button", {
      name: new RegExp(`^Keep ${filePattern} \\(`)
    })
    await expect(itemButton).toHaveAttribute(
      "aria-pressed",
      isKept ? "true" : "false"
    )
    if (!isKept) {
      await expect(itemButton).toHaveAttribute(
        "aria-label",
        /currently moves to Trash/
      )
    }
  }

  await expect
    .poll(async () => {
      const stored = await readLocalStorage(context, ["selections"])
      return stored.selections as
        | {
            keptOverrides?: Record<string, string[]>
            selectedGroupIds?: string[]
          }
        | undefined
    })
    .toMatchObject({
      keptOverrides: {
        "quality-set-a": ["quality-a-best"],
        "quality-set-b": ["quality-b-best"]
      },
      selectedGroupIds: ["quality-set-a", "quality-set-b"]
    })

  await page.reload()
  await expect(
    page.getByRole("region", { name: "Cleanup summary" }).getByRole("status")
  ).toHaveText(
    "2 sets included · 2 media items proposed for Trash · 2 sets left to review"
  )
  for (const [fileName, isKept] of expectedKeeperStates) {
    const filePattern = fileName.replaceAll(".", "\\.")
    const itemButton = page.getByRole("button", {
      name: new RegExp(`^Keep ${filePattern} \\(`)
    })
    await expect(itemButton).toHaveAttribute(
      "aria-pressed",
      isKept ? "true" : "false"
    )
    if (!isKept) {
      await expect(itemButton).toHaveAttribute(
        "aria-label",
        /currently moves to Trash/
      )
    }
  }

  const newProviderCommands = await stub.evaluate(
    (initialCount) =>
      (
        window as unknown as {
          __gptkCommandLog?: Array<{ command: string }>
        }
      ).__gptkCommandLog?.slice(initialCount) ?? [],
    initialProviderCommands
  )
  expect(
    newProviderCommands.map((entry) => entry.command).filter((command) =>
      /trash|delete|remove/i.test(command)
    )
  ).toEqual([])

  await page.close()
  await stub.close()
  await context.unroute("https://photos.google.com/**")
  await clearStorage(context)
})

test("uses a deterministic keeper and proposes non-keepers without dispatching Trash", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      }
    ],
    {
      key1: {
        ...BASE_MEDIA_ITEMS.key1,
        isOriginalQuality: null,
        fileName: "key1.jpg"
      },
      key2: {
        ...BASE_MEDIA_ITEMS.key2,
        isOriginalQuality: null,
        fileName: "key2.jpg"
      }
    },
    2
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible({ timeout: 5000 })

  await page
    .getByRole("button", { name: /^(Auto Keep|Selection)$/i })
    .first()
    .click()
  await page.getByRole("menuitem", { name: "Best quality" }).click()

  const autoKeepStatus = page
    .getByRole("status")
    .filter({ hasText: "Best quality was applied" })
  await expect(autoKeepStatus).toContainText("0 sets changed")
  await expect(autoKeepStatus).toContainText(
    "1 set resolved by deterministic tie-break"
  )
  await expect(autoKeepStatus).toContainText(
    "1 set included for cleanup review; 1 media item proposed for Trash"
  )
  await expect(page.getByTestId("keep-decision-g1")).toHaveText(
    "Suggested keep: Best quality (deterministic tie-break)"
  )
  for (const [fileName, isKept] of [
    ["key1.jpg", true],
    ["key2.jpg", false]
  ] as const) {
    const itemButton = page.getByRole("button", {
      name: new RegExp(`^Keep ${fileName.replace(".", "\\.")} \\(`)
    })
    await expect(itemButton).toHaveAttribute(
      "aria-pressed",
      isKept ? "true" : "false"
    )
    await expect(itemButton).toHaveAttribute(
      "aria-label",
      isKept ? /currently kept/ : /currently moves to Trash/
    )
  }
  await expect(
    page.getByRole("region", { name: "Cleanup summary" }).getByRole("status")
  ).toHaveText(
    "1 set included · 1 media item proposed for Trash · 1 set left to review"
  )

  await expect
    .poll(async () => {
      const stored = await readLocalStorage(context, ["selections"])
      return stored.selections as
        | {
            selectedGroupIds?: string[]
            reviewedGroupIds?: string[]
            keptOverrides?: Record<string, string[]>
            keepDecisionProvenance?: Record<
              string,
              { source: string; strategy?: string }
            >
          }
        | undefined
    })
    .toMatchObject({
      selectedGroupIds: ["g1"],
      reviewedGroupIds: [],
      keptOverrides: { g1: ["key1"] },
      keepDecisionProvenance: {
        g1: { source: "automatic", strategy: "best_quality" }
      }
    })

  await page.reload()
  await expect(
    page.getByRole("region", { name: "Cleanup summary" }).getByRole("status")
  ).toHaveText(
    "1 set included · 1 media item proposed for Trash · 1 set left to review"
  )
  const restoredSettings = await readLocalStorage(context, ["settings"])
  expect(restoredSettings.settings).toMatchObject({
    defaultKeepStrategy: "best_quality"
  })
  await expect(page.getByTestId("keep-decision-g1")).toHaveText(
    "Suggested keep: Best quality (deterministic tie-break)"
  )
  for (const [fileName, isKept] of [
    ["key1.jpg", true],
    ["key2.jpg", false]
  ] as const) {
    const itemButton = page.getByRole("button", {
      name: new RegExp(`^Keep ${fileName.replace(".", "\\.")} \\(`)
    })
    await expect(itemButton).toHaveAttribute(
      "aria-pressed",
      isKept ? "true" : "false"
    )
    await expect(itemButton).toHaveAttribute(
      "aria-label",
      isKept ? /currently kept/ : /currently moves to Trash/
    )
  }
  await expect(
    page.getByRole("button", { name: /Review 1 more to continue/i })
  ).toBeDisabled()

  const commandsAfterStrategy = await stub.evaluate(
    () =>
      (
        window as unknown as {
          __gptkCommandLog?: Array<{ command: string }>
        }
      ).__gptkCommandLog ?? []
  )
  expect(
    commandsAfterStrategy.map((entry) => entry.command).filter((command) =>
      /trash|delete|remove/i.test(command)
    )
  ).toEqual([])

  await page.close()
  await stub.close()
  await context.unroute("https://photos.google.com/**")
  await clearStorage(context)
})

test("Auto Keep includes sets for review while Include all and Skip all remain explicit selection controls", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      }
    ],
    {
      key1: {
        ...BASE_MEDIA_ITEMS.key1,
        isOriginalQuality: true,
        resWidth: 100,
        resHeight: 100,
        fileName: "key1.jpg"
      },
      key2: {
        ...BASE_MEDIA_ITEMS.key2,
        isOriginalQuality: false,
        resWidth: 400,
        resHeight: 400,
        fileName: "key2.jpg"
      }
    },
    2
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible({ timeout: 5000 })
  await expect(
    page.getByText("0 media items proposed for Trash", { exact: true })
  ).toBeVisible()

  await page
    .getByRole("button", { name: /^(Auto Keep|Selection)$/i })
    .first()
    .click()
  await page.getByRole("menuitem", { name: "Largest resolution" }).click()
  await expect(
    page.getByRole("button", {
      name: /Keep key2\.jpg \(currently kept; this is the last kept copy/
    })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(
    page.getByText("1 media item proposed for Trash", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: /Review 1 more to continue/i })
  ).toBeDisabled()

  await expect
    .poll(() => readLocalStorage(context, ["settings", "selections"]))
    .toMatchObject({
      settings: { defaultKeepStrategy: "largest_resolution" },
      selections: {
        selectedGroupIds: ["g1"],
        reviewedGroupIds: [],
        keptOverrides: { g1: ["key2"] },
        keepDecisionProvenance: {
          g1: { source: "automatic", strategy: "largest_resolution" }
        }
      }
    })

  await page.getByRole("button", { name: /^Skip all$/i }).click()
  await expect(
    page.getByRole("button", { name: /No media items proposed for Trash/i })
  ).toBeVisible()

  await page.getByRole("button", { name: /^Include all$/i }).click()
  await expect(
    page.getByText("1 media item proposed for Trash", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: /Review & move 1 to Trash/i })
  ).toBeVisible()

  await page.getByRole("button", { name: /^Include all$/i }).click()
  await expect(
    page.getByText("1 media item proposed for Trash", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: /Review & move 1 to Trash/i })
  ).toBeVisible()

  await expect
    .poll(async () => {
      return readLocalStorage(context, ["settings", "selections"])
    })
    .toMatchObject({
      settings: { defaultKeepStrategy: "largest_resolution" },
      selections: {
        selectedGroupIds: ["g1"],
        reviewedGroupIds: ["g1"],
        keptOverrides: { g1: ["key2"] },
        keepDecisionProvenance: {
          g1: { source: "automatic", strategy: "largest_resolution" }
        }
      }
    })
  await page.reload()
  await expect(
    page.getByText("1 media item proposed for Trash", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("region", { name: "Cleanup summary" }).getByRole("status")
  ).toHaveText(
    "1 set included · 1 media item proposed for Trash"
  )
  await expect(
    page.getByRole("button", { name: /Review & move 1 to Trash/i })
  ).toBeVisible()
  await expect
    .poll(() => readLocalStorage(context, ["settings", "selections"]))
    .toMatchObject({
      settings: { defaultKeepStrategy: "largest_resolution" },
      selections: {
        selectedGroupIds: ["g1"],
        reviewedGroupIds: ["g1"],
        keptOverrides: { g1: ["key2"] },
        keepDecisionProvenance: {
          g1: { source: "automatic", strategy: "largest_resolution" }
        }
      }
    })
  await expect(
    page.getByRole("button", { name: /^Keep key2\.jpg\b/ })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(
    page.getByRole("button", { name: /^Keep key1\.jpg\b/ })
  ).toHaveAttribute("aria-pressed", "false")
  await expect(
    page.getByRole("button", {
      name: /^Keep key1\.jpg \(currently moves to Trash/
    })
  ).toHaveAttribute("aria-pressed", "false")

  await page.getByRole("button", { name: /^Skip all$/i }).click()
  await expect(
    page.getByRole("button", { name: /Review & move 1 to Trash/i })
  ).not.toBeVisible()
  await expect(
    page.getByRole("button", {
      name: /^Keep key2\.jpg\b/
    })
  ).toHaveAttribute("aria-pressed", "true")

  await expect
    .poll(async () => {
      return readLocalStorage(context, ["settings", "selections"])
    })
    .toMatchObject({
      settings: { defaultKeepStrategy: "largest_resolution" },
      selections: {
        selectedGroupIds: [],
        reviewedGroupIds: ["g1"],
        keptOverrides: { g1: ["key2"] },
        keepDecisionProvenance: {
          g1: { source: "automatic", strategy: "largest_resolution" }
        }
      }
    })
  await page.reload()
  await expect(
    page.getByText("0 media items proposed for Trash", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: /Review & move 1 to Trash/i })
  ).not.toBeVisible()
  await expect
    .poll(() => readLocalStorage(context, ["settings", "selections"]))
    .toMatchObject({
      settings: { defaultKeepStrategy: "largest_resolution" },
      selections: {
        selectedGroupIds: [],
        reviewedGroupIds: ["g1"],
        keptOverrides: { g1: ["key2"] },
        keepDecisionProvenance: {
          g1: { source: "automatic", strategy: "largest_resolution" }
        }
      }
    })
  await expect(
    page.getByRole("button", {
      name: /^Keep key2\.jpg\b/
    })
  ).toHaveAttribute("aria-pressed", "true")

  const trashCommands = await stub.evaluate(
    () =>
      (
        window as unknown as {
          __gptkCommandLog?: Array<{ command: string }>
        }
      ).__gptkCommandLog?.filter((entry) => /trash|delete|remove/i.test(entry.command)) ?? []
  )
  expect(trashCommands).toEqual([])

  await page.close()
  await stub.close()
  await context.unroute("https://photos.google.com/**")
  await clearStorage(context)
})

test("per-photo Keep and per-set Skip update the visible review state", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      }
    ],
    {
      key1: {
        ...BASE_MEDIA_ITEMS.key1,
        isOriginalQuality: true,
        resWidth: 100,
        resHeight: 100,
        fileName: "key1.jpg"
      },
      key2: {
        ...BASE_MEDIA_ITEMS.key2,
        isOriginalQuality: false,
        resWidth: 400,
        resHeight: 400,
        fileName: "key2.jpg"
      }
    },
    2
  )
  await injectSelections(context, ["g1"])

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible({ timeout: 8_000 })

  await expect(
    page.getByRole("button", {
      name: /Keep key1\.jpg \(currently kept; this is the last kept copy/
    })
  ).toHaveAttribute("aria-pressed", "true")
  await page
    .getByRole("button", {
      name: /Keep key2\.jpg \(currently moves to Trash; favorite status unknown; click to keep\)/
    })
    .click()
  await expect(
    page.getByRole("button", {
      name: /Keep key1\.jpg \(currently kept; click to move to Trash\)/
    })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(
    page.getByRole("button", {
      name: /Keep key2\.jpg \(currently kept; click to move to Trash\)/
    })
  ).toHaveAttribute("aria-pressed", "true")

  await expect
    .poll(async () => {
      const stored = await readLocalStorage(context, ["selections"])
      return (
        stored.selections as {
          keptOverrides?: Record<string, string[]>
          selectedGroupIds?: string[]
        } | undefined
      )
    })
    .toMatchObject({
      keptOverrides: { g1: ["key1", "key2"] },
      selectedGroupIds: ["g1"]
    })

  await page.reload()
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible({ timeout: 8_000 })
  for (const fileName of ["key1.jpg", "key2.jpg"]) {
    await expect(
      page.getByRole("button", {
        name: new RegExp(
          `Keep ${fileName.replace(".", "\\.")} \\(currently kept; click to move to Trash\\)`
        )
      })
    ).toHaveAttribute("aria-pressed", "true")
  }
  await page
    .getByRole("button", {
      name: /Keep key1\.jpg \(currently kept; click to move to Trash\)/
    })
    .click()
  await expect(
    page.getByRole("button", {
      name: /Keep key1\.jpg \(currently moves to Trash; favorite status unknown; click to keep\)/
    })
  ).toHaveAttribute("aria-pressed", "false")
  await expect(
    page.getByRole("button", {
      name: /Keep key2\.jpg \(currently kept; this is the last kept copy/
    })
  ).toHaveAttribute("aria-pressed", "true")

  await page.getByRole("button", { name: "Skip this set" }).click()
  await expect(
    page.getByText("0 media items proposed for Trash", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: /Review & move 1 to Trash/i })
  ).not.toBeVisible()

  await expect
    .poll(async () => {
      const stored = await readLocalStorage(context, ["selections"])
      return (
        stored.selections as {
          keptOverrides?: Record<string, string[]>
          selectedGroupIds?: string[]
        } | undefined
      )
    })
    .toMatchObject({
      keptOverrides: { g1: ["key2"] },
      selectedGroupIds: []
    })
  await page.reload()
  await expect(
    page.getByText("0 media items proposed for Trash", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("button", {
      name: /Keep key1\.jpg \(not in the current Trash proposal; click to change the decision\)/
    })
  ).toHaveAttribute("aria-pressed", "false")
  await expect(
    page.getByRole("button", {
      name: /Keep key2\.jpg \(currently kept; this is the last kept copy/
    })
  ).toHaveAttribute("aria-pressed", "true")

  await page.close()
  await stub.close()
  await context.unroute("https://photos.google.com/**")
  await clearStorage(context)
})

test("bulk Auto Keep reopens a per-set skipped group for review without dispatching Trash", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      }
    ],
    {
      key1: {
        ...BASE_MEDIA_ITEMS.key1,
        isOriginalQuality: true,
        resWidth: 100,
        resHeight: 100,
        fileName: "key1.jpg"
      },
      key2: {
        ...BASE_MEDIA_ITEMS.key2,
        isOriginalQuality: false,
        resWidth: 400,
        resHeight: 400,
        fileName: "key2.jpg"
      }
    },
    2
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible({ timeout: 8_000 })

  await page.getByRole("button", { name: "Skip this set" }).click()
  await expect(
    page.getByText("0 media items proposed for Trash", { exact: true })
  ).toBeVisible()
  await expect
    .poll(async () => {
      const stored = await readLocalStorage(context, ["selections"])
      return stored.selections as
        | { selectedGroupIds?: string[]; reviewedGroupIds?: string[] }
        | undefined
    })
    .toMatchObject({ selectedGroupIds: [], reviewedGroupIds: ["g1"] })

  await page
    .getByRole("button", { name: /^(Auto Keep|Selection)$/i })
    .first()
    .click()
  await page.getByRole("menuitem", { name: "Best quality" }).click()

  await expect(
    page.getByRole("status").filter({
      hasText: "Best quality was applied and saved as the default"
    })
  ).toContainText(
    "1 set included for cleanup review; 1 media item proposed for Trash"
  )
  await expect(
    page.getByRole("region", { name: "Cleanup summary" }).getByRole("status")
  ).toHaveText(
    "1 set included · 1 media item proposed for Trash · 1 set left to review"
  )
  await expect(
    page.getByRole("button", { name: /Review 1 more to continue/i })
  ).toBeDisabled()
  await expect(
    page.getByRole("button", {
      name: /Keep key1\.jpg \(currently kept; this is the last kept copy/
    })
  ).toHaveAttribute("aria-pressed", "true")

  await expect
    .poll(async () => {
      const stored = await readLocalStorage(context, ["selections"])
      return stored.selections as
        | {
            selectedGroupIds?: string[]
            reviewedGroupIds?: string[]
            keptOverrides?: Record<string, string[]>
          }
        | undefined
    })
    .toMatchObject({
      selectedGroupIds: ["g1"],
      reviewedGroupIds: [],
      keptOverrides: { g1: ["key1"] }
    })

  await page.reload()
  await expect(
    page.getByRole("region", { name: "Cleanup summary" }).getByRole("status")
  ).toHaveText(
    "1 set included · 1 media item proposed for Trash · 1 set left to review"
  )
  await expect(
    page.getByRole("button", { name: /Review 1 more to continue/i })
  ).toBeDisabled()

  const trashCommands = await stub.evaluate(
    () =>
      (
        window as unknown as {
          __gptkCommandLog?: Array<{ command: string }>
        }
      ).__gptkCommandLog?.filter((entry) => /trash|delete|remove/i.test(entry.command)) ?? []
  )
  expect(trashCommands).toEqual([])

  await page.close()
  await stub.close()
  await context.unroute("https://photos.google.com/**")
  await clearStorage(context)
})

test("bulk Auto Keep replaces manual overrides and reopens their skipped sets", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "manual-keeper-group",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      },
      {
        id: "manual-trash-all-group",
        mediaKeys: ["key3", "key4"],
        originalMediaKey: "key3",
        similarity: 0.99
      }
    ],
    {
      key1: {
        ...BASE_MEDIA_ITEMS.key1,
        isOriginalQuality: true,
        resWidth: 400,
        resHeight: 400
      },
      key2: {
        ...BASE_MEDIA_ITEMS.key2,
        isOriginalQuality: false,
        resWidth: 100,
        resHeight: 100
      },
      key3: BASE_MEDIA_ITEMS.key3,
      key4: BASE_MEDIA_ITEMS.key4
    },
    4
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  await expect(
    page.getByTestId("keep-decision-manual-keeper-group")
  ).toBeVisible({ timeout: 8_000 })
  await expect(
    page.getByTestId("keep-decision-manual-trash-all-group")
  ).toBeVisible()

  const manualKeeperSet = page
    .getByTestId("keep-decision-manual-keeper-group")
    .locator("xpath=ancestor::div[contains(@class,'MuiPaper-root')][1]")
  const manualTrashAllSet = page
    .getByTestId("keep-decision-manual-trash-all-group")
    .locator("xpath=ancestor::div[contains(@class,'MuiPaper-root')][1]")
  await manualKeeperSet
    .getByRole("button", { name: /Keep photo2\.jpg/i })
    .click()
  await manualKeeperSet
    .getByRole("button", { name: /Keep photo1\.jpg/i })
    .click()
  await manualTrashAllSet
    .getByRole("button", { name: /Mark all copies for Trash/i })
    .click()
  const skipButton = manualKeeperSet.getByRole("button", {
    name: "Skip this set"
  })
  await skipButton.scrollIntoViewIfNeeded()
  await expect
    .poll(() =>
      skipButton.evaluate((button) => {
        const bounds = button.getBoundingClientRect()
        const row = button.closest('div[style*="top"]')
        const rowBounds = row?.getBoundingClientRect()
        const hit = document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2
        )
        return Boolean(
          rowBounds &&
            bounds.bottom <= rowBounds.bottom + 1 &&
            (hit === button || button.contains(hit))
        )
      })
    )
    .toBe(true)
  await skipButton.click()
  await manualTrashAllSet
    .getByRole("button", { name: "Skip this set" })
    .click()

  await expect(
    page.getByRole("region", { name: "Cleanup summary" }).getByRole("status")
  ).toHaveText("0 sets included · 0 media items proposed for Trash")
  await page
    .getByRole("button", { name: /^(Auto Keep|Selection)$/i })
    .first()
    .click()
  await page.getByRole("menuitem", { name: "Best quality" }).click()

  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Best quality was applied and saved as the default" })
  ).toContainText("2 manual choices replaced")

  await expect(
    page.getByRole("region", { name: "Cleanup summary" }).getByRole("status")
  ).toHaveText(
    "2 sets included · 2 media items proposed for Trash · 2 sets left to review"
  )
  await expect(
    page.getByRole("button", { name: /Review 2 more to continue/i })
  ).toBeDisabled()
  await expect(
    manualKeeperSet.getByRole("button", { name: /Keep photo1\.jpg \(currently kept/i })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(
    manualKeeperSet.getByRole("button", { name: /Keep photo2\.jpg \(currently moves to Trash/i })
  ).toHaveAttribute("aria-pressed", "false")
  await expect(
    manualTrashAllSet.getByRole("button", { name: /Keep photo3\.jpg \(currently kept/i })
  ).toHaveAttribute("aria-pressed", "true")

  await expect
    .poll(async () => {
      const stored = await readLocalStorage(context, ["selections"])
      return stored.selections as
        | {
            selectedGroupIds?: string[]
      reviewedGroupIds?: string[]
      keptOverrides?: Record<string, string[]>
      keepDecisionProvenance?: Record<string, { source: string; strategy?: string }>
          }
        | undefined
    })
    .toMatchObject({
      selectedGroupIds: ["manual-keeper-group", "manual-trash-all-group"],
      reviewedGroupIds: [],
      keptOverrides: {
        "manual-keeper-group": ["key1"],
        "manual-trash-all-group": ["key3"]
      },
      keepDecisionProvenance: {
        "manual-keeper-group": { source: "automatic", strategy: "best_quality" },
        "manual-trash-all-group": { source: "automatic", strategy: "best_quality" }
      }
    })

  await page.reload()
  await expect(
    page.getByRole("region", { name: "Cleanup summary" }).getByRole("status")
  ).toHaveText(
    "2 sets included · 2 media items proposed for Trash · 2 sets left to review"
  )
  await expect(
    page.getByRole("button", { name: /Review 2 more to continue/i })
  ).toBeDisabled()

  const trashCommands = await stub.evaluate(
    () =>
      (
        window as unknown as {
          __gptkCommandLog?: Array<{ command: string }>
        }
      ).__gptkCommandLog?.filter((entry) => /trash|delete|remove/i.test(entry.command)) ?? []
  )
  expect(trashCommands).toEqual([])

  await page.close()
  await stub.close()
  await context.unroute("https://photos.google.com/**")
  await clearStorage(context)
})

test("persists trash-all copy choices through page reload", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      }
    ],
    { key1: BASE_MEDIA_ITEMS.key1, key2: BASE_MEDIA_ITEMS.key2 },
    2
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 5000
  })

  await page.getByRole("button", { name: /Mark all copies for Trash/i }).click()
  await expect(
    page.getByRole("button", { name: /Review & move 2 to Trash/i })
  ).toBeVisible()
  await expect(page.locator(".MuiCard-root").nth(0)).toContainText(
    "Moves to Trash"
  )
  await expect(page.locator(".MuiCard-root").nth(1)).toContainText(
    "Moves to Trash"
  )

  const sw = context.serviceWorkers()[0]
  await expect
    .poll(async () => {
      const stored = await readLocalStorage(context, ["selections"]) as {
        selections?: { keptOverrides?: Record<string, string[]> }
      }
      return stored.selections?.keptOverrides?.g1
    })
    .toEqual([])

  await page.reload()
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 5000
  })
  await expect(
    page.getByRole("button", { name: /Review & move 2 to Trash/i })
  ).toBeVisible()
  await expect(page.locator(".MuiCard-root").nth(0)).toContainText(
    "Moves to Trash"
  )
  await expect(page.locator(".MuiCard-root").nth(1)).toContainText(
    "Moves to Trash"
  )

  await page.close()
  await stub.close()
  await clearStorage(context)
})

test("keeps all current copies when every saved keeper key is stale", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      }
    ],
    { key1: BASE_MEDIA_ITEMS.key1, key2: BASE_MEDIA_ITEMS.key2 },
    2
  )
  await injectSelections(context, ["g1"], { g1: ["missing-key"] })

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 5000
  })
  await expect(
    page.getByRole("button", { name: /No media items proposed for Trash/i })
  ).toBeVisible()
  await expect(
    page.getByText("0 media items proposed for Trash", { exact: true })
  ).toBeVisible()
  await expect(page.locator(".MuiCard-root").nth(0)).not.toContainText(
    "Moves to Trash"
  )
  await expect(page.locator(".MuiCard-root").nth(1)).not.toContainText(
    "Moves to Trash"
  )

  await expect
    .poll(async () => {
      const stored = await readLocalStorage(context, ["selections"]) as {
        selections?: {
          keptOverrides?: Record<string, string[]>
          keepDecisionProvenance?: Record<string, { source: string }>
        }
      }
      return stored.selections
    })
    .toMatchObject({
      keptOverrides: { g1: ["key1", "key2"] },
      keepDecisionProvenance: { g1: { source: "stale_fallback" } }
    })

  await page.close()
  await stub.close()
  await clearStorage(context)
})

test("shows the stale-keeper keep-all fallback in the compact scanner panel", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      }
    ],
    { key1: BASE_MEDIA_ITEMS.key1, key2: BASE_MEDIA_ITEMS.key2 },
    2
  )
  await injectSelections(context, ["g1"], { g1: ["missing-key"] })

  const stub = await openGptkStubPage(context, {
    healthCheck: {
      data: {
        hasGptk: true,
        hasWizData: true,
        accountEmail: "test@example.com"
      }
    }
  })
  const page = await context.newPage()
  await stub.bringToFront()
  await page.goto(`chrome-extension://${extensionId}/tabs/scanner-panel.html`)
  await expect(
    page.getByText("Keeping all copies until saved keeper data is reviewed", {
      exact: true
    })
  ).toBeVisible({ timeout: 5000 })
  await expect(
    page.getByText("Moves to Trash", { exact: true })
  ).not.toBeVisible()
  await expect(
    page.getByRole("button", {
      name: /currently kept; click to move to Trash/i
    })
  ).toHaveCount(2)

  await page.close()
  await stub.close()
  await clearStorage(context)
})

test("uses a deterministic tie-break for unknown quality in the compact scanner panel", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      }
    ],
    {
      key1: { ...BASE_MEDIA_ITEMS.key1, isOriginalQuality: null },
      key2: { ...BASE_MEDIA_ITEMS.key2, isOriginalQuality: null }
    },
    2
  )

  const stub = await openGptkStubPage(context, {
    healthCheck: {
      data: {
        hasGptk: true,
        hasWizData: true,
        accountEmail: "test@example.com"
      }
    }
  })
  const page = await context.newPage()
  await stub.bringToFront()
  try {
    await page.goto(`chrome-extension://${extensionId}/tabs/scanner-panel.html`)
    await expect(
      page.getByText("Suggested keep: Best quality (deterministic tie-break)", {
        exact: true
      })
    ).toBeVisible({ timeout: 5_000 })
    await page
      .getByRole("checkbox", { name: "Include duplicate set of 2 photos" })
      .click()
    await expect(page.getByText("Suggested keep", { exact: true })).toBeVisible()
    await expect(
      page.getByText("Moves to Trash · favorite unknown", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("button", {
        name: /photo1\.jpg \(currently kept;/i
      })
    ).toHaveCount(1)
    await expect(
      page.getByRole("button", {
        name: /photo2\.jpg \(currently moves to Trash;/i
      })
    ).toHaveCount(1)
  } finally {
    await page.close()
    await stub.close()
    await clearStorage(context)
  }
})

test("ignores malformed saved selections without crashing on load", async () => {
  await clearStorage(context)
  await injectScanResults(
    context,
    [
      {
        id: "g1",
        mediaKeys: ["key1", "key2"],
        originalMediaKey: "key1",
        similarity: 0.99
      }
    ],
    { key1: BASE_MEDIA_ITEMS.key1, key2: BASE_MEDIA_ITEMS.key2 },
    2
  )

  const sw = context.serviceWorkers()[0]
  const selectionStorageKey = providerReviewStorageKey("google", "selections")
  await sw.evaluate(
    (selectionStorageKey) =>
      new Promise<void>((resolve) => {
        chrome.storage.local.set(
          {
            [selectionStorageKey]: {
              selectedGroupIds: "g1",
              keptOverrides: {
                g1: "key2",
                bad: [null, 42]
              }
            }
          },
          resolve
        )
      }),
    selectionStorageKey
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 5000
  })
  await expect(
    page.getByRole("button", { name: /Review & move 1 to Trash/i })
  ).not.toBeVisible()

  await page.close()
  await stub.close()
  await clearStorage(context)
})
