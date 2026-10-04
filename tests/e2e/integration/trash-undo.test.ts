/**
 * Trash & Undo integration tests.
 *
 * Covers the app-tab UI layer for the full trash/restore workflow using a real
 * Playwright-launched extension and the GPTK stub page. No Google auth required.
 *
 * The GPTK command layer (chunking, progress) is already unit-tested in
 * tests/commands/google-photos-commands.test.ts — these tests focus on the
 * UI integration: button → confirm dialog → progress display → snackbar → undo.
 *
 * Run via: npm run test:integration
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test"

import {
  clearStorage,
  injectEntitlement,
  injectScanResults,
  launchExtension,
  makeGroups,
  openAppTab,
  openGptkStubPage
} from "../fixtures/extension"

let context: BrowserContext
let extensionId: string

test.beforeAll(async () => {
  ;({ context, extensionId } = await launchExtension())
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
// Test data helpers
// ============================================================

/**
 * Standard small dataset: 3 groups x 2 items each -> 3 dedupKeys to trash.
 * Small enough to fit in a single 25-item trash batch.
 */
function smallPayload() {
  return makeGroups(3, 2)
}

async function confirmTrashDialog(page: Page, count: number): Promise<void> {
  const confirmButton = page
    .getByRole("button", { name: /^Move to Trash$/i })
    .last()
  const unknownFavoriteAcknowledgment = page.getByRole("checkbox", {
    name: "I understand these items may be favorites"
  })
  await expect(unknownFavoriteAcknowledgment).toBeVisible()
  await page.getByLabel(`Type ${count} to confirm`).fill(String(count))
  await expect(confirmButton).toBeDisabled()
  await unknownFavoriteAcknowledgment.check()
  await expect(confirmButton).toBeEnabled()
  await confirmButton.click()
}

async function includeAllAndOpenTrashDialog(
  page: Page,
  accountEmail = "test@example.com"
): Promise<void> {
  // Trash preflight requires a fresh provider health result. Waiting for the
  // signed-in banner avoids racing the health-check response after the saved
  // results have already rendered.
  await expect(page.getByText(`Signed in · ${accountEmail}`)).toBeVisible({
    timeout: 8_000
  })
  await page.getByRole("button", { name: /^Include all(?: sets)?$/i }).click()
  await page
    .getByRole("button", { name: /Review & move \d+ to Trash/i })
    .click()
}

type RecoveryTransactionFaultPhase = "begin" | "terminal" | "nonterminal"
type RecoveryTransactionFaultMode =
  | "reject-before-worker"
  | "drop-ack-after-worker-commit"

async function openAppTabWithRecoveryTransactionFault(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const page = await context.newPage()
  await page.addInitScript(() => {
    if (!location.pathname.endsWith("/tabs/app.html")) return
    const runtime = chrome.runtime
    const originalSendMessage = runtime.sendMessage.bind(runtime)
    const control = {
      armed: false,
      failOnPhase: "" as RecoveryTransactionFaultPhase | "",
      mode: "reject-before-worker" as RecoveryTransactionFaultMode,
      recoveryTransactions: 0,
      failures: 0,
      failedPhase: "" as string,
      arm(
        failOnPhase: RecoveryTransactionFaultPhase,
        mode: RecoveryTransactionFaultMode = "reject-before-worker"
      ) {
        this.armed = true
        this.failOnPhase = failOnPhase
        this.mode = mode
        this.recoveryTransactions = 0
        this.failedPhase = ""
      }
    }
    ;(
      window as unknown as {
        __gpdRecoveryTransactionFault: typeof control
      }
    ).__gpdRecoveryTransactionFault = control
    runtime.sendMessage = ((message, ...args) => {
      const transactionMessage = message as {
        action?: string
        transaction?: { kind?: string; params?: { terminal?: boolean } }
      }
      const transaction = transactionMessage?.transaction
      const isRecoveryMutation =
        transactionMessage?.action === "recoveryHistory.transaction" &&
        transaction?.kind !== "read"
      if (isRecoveryMutation) {
        control.recoveryTransactions += 1
        const phase =
          transaction?.kind === "beginRestore"
            ? "begin"
            : transaction?.kind === "updateRestore"
              ? transaction.params?.terminal === true
                ? "terminal"
                : transaction.params?.terminal === false
                  ? "nonterminal"
                  : ""
              : ""
        if (
          control.armed &&
          phase === control.failOnPhase &&
          control.mode === "reject-before-worker"
        ) {
          control.armed = false
          control.failures += 1
          control.failedPhase = phase
          return Promise.reject(
            new Error("injected recovery transaction non-delivery")
          )
        }
        const response = originalSendMessage(message, ...args)
        if (
          control.armed &&
          phase === control.failOnPhase &&
          control.mode === "drop-ack-after-worker-commit"
        ) {
          return Promise.resolve(response).then(() => {
            control.armed = false
            control.failures += 1
            control.failedPhase = phase
            return Promise.reject(
              new Error("injected recovery transaction acknowledgement loss")
            )
          })
        }
        return response
      }
      return originalSendMessage(message, ...args)
    }) as typeof runtime.sendMessage
  })
  await page.goto(`chrome-extension://${extensionId}/tabs/app.html`)
  return page
}

async function prepareTrashedReviewForRestore(
  context: BrowserContext,
  extensionId: string,
  restoreOverride: Parameters<typeof openGptkStubPage>[1]["restoreItems"] = {}
): Promise<{ page: Page; stub: Page }> {
  await clearStorage(context)
  const { groups, mediaItems } = smallPayload()
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length
  )
  const stub = await openGptkStubPage(context, {
    restoreItems: restoreOverride
  })
  const page = await openAppTabWithRecoveryTransactionFault(context, extensionId)
  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({ timeout: 8_000 })
  await includeAllAndOpenTrashDialog(page)
  await confirmTrashDialog(page, 3)
  await expect(page.getByText(/moved to trash/i)).toBeVisible({
    timeout: 10_000
  })
  return { page, stub }
}

async function readRecoveryHistory(context: BrowserContext): Promise<any[]> {
  const serviceWorker = context.serviceWorkers()[0]
  return serviceWorker.evaluate(
    () =>
      new Promise<any[]>((resolve) => {
        chrome.storage.local.get("recoveryHistory", (result) => {
          resolve((result.recoveryHistory as any[]) || [])
        })
      })
  )
}

// ============================================================
// Trash: baseline (< 25 items, single batch)
// ============================================================

test("trashes selected groups and removes them from the UI", async () => {
  await clearStorage(context)
  const { groups, mediaItems } = smallPayload()
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)

  // App should load results from storage (no GP auth needed for results view)
  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 8_000
  })

  // Click the count-aware cleanup action below the duplicate review.
  await includeAllAndOpenTrashDialog(page)

  // Confirm dialog appears
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Move to Trash" })
  ).toBeVisible()
  await expect(
    page.getByText(
      "Google Photos keeps deleted items in Trash for up to 30 days."
    )
  ).toBeVisible()

  // Confirm by typing the exact item count
  await confirmTrashDialog(page, 3)

  // Undo snackbar should appear (trash complete)
  await expect(page.getByText(/moved to trash/i)).toBeVisible({
    timeout: 10_000
  })
  await expect(
    page.getByText("How was your PhotoSweep cleanup?")
  ).not.toBeVisible()
  await page.getByRole("button", { name: "Dismiss undo notification" }).click()
  await expect(page.getByText("How was your PhotoSweep cleanup?")).toBeVisible()
  await page.getByRole("button", { name: "Maybe later" }).click()

  // Review list should no longer show duplicate sets
  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).not.toBeVisible()

  const sw = context.serviceWorkers()[0]
  const reports = await sw.evaluate(
    () =>
      new Promise<any[]>((resolve) => {
        chrome.storage.local.get("trashResultReports", (result) => {
          resolve((result.trashResultReports as any[]) || [])
        })
      })
  )
  expect(reports).toHaveLength(1)
  expect(reports[0]).toMatchObject({
    status: "complete",
    attemptedCount: 3,
    movedCount: 3,
    movedDedupKeys: [
      "dedup-group0-item1",
      "dedup-group1-item1",
      "dedup-group2-item1"
    ]
  })

  await stub.close()
  await page.close()
})

test("free Trash cap is cumulative across the cleanup session", async () => {
  await clearStorage(context)
  const { groups, mediaItems } = makeGroups(2, 2)
  groups[0].mediaKeys = Array.from(
    { length: 11 },
    (_, i) => `cap-group0-item${i}`
  )
  for (let i = 0; i < 11; i++) {
    const key = `cap-group0-item${i}`
    mediaItems[key] = {
      mediaKey: key,
      dedupKey: `dedup-${key}`,
      thumb: "",
      productUrl: `https://photos.google.com/photo/${key}`,
      timestamp: 1_600_000_000_000 + i,
      creationTimestamp: 1_700_000_000_000 + i,
      resWidth: 1920,
      resHeight: 1080,
      fileName: `photo-${key}.jpg`,
      isOwned: true,
      isOriginalQuality: i === 0
    }
  }
  groups[0].originalMediaKey = "cap-group0-item0"

  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByRole("heading", {
      name: "2 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 8_000
  })

  await page.getByRole("button", { name: "Skip all" }).click()
  await page.locator('input[type="checkbox"]').first().click()
  await page
    .getByRole("button", { name: /Review & move \d+ to Trash/i })
    .click()
  await confirmTrashDialog(page, 10)
  await expect(page.getByText(/moved to trash/i)).toBeVisible({
    timeout: 10_000
  })

  // Select the one remaining group directly. This preserves the same cleanup
  // session, so the dialog must enforce the already-used free allowance.
  await page.locator('input[type="checkbox"]').first().click()
  await page.getByRole("button", { name: /Review & move 1 to Trash/i }).click()

  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(
    page.getByText(/You have 0 remaining and selected 1/i)
  ).toBeVisible()
  await expect(page.getByLabel("Type 1 to confirm")).not.toBeVisible()

  await stub.close()
  await page.close()
})

// ============================================================
// Trash: multi-batch (> 25 items)
// ============================================================

test("shows trashing state for multi-batch trash (> 25 items)", async () => {
  await clearStorage(context)
  await injectEntitlement(context, "lifetime")

  // 3 groups x 101 items -> 300 dedupKeys to trash across multiple 25-item batches
  const { groups, mediaItems } = makeGroups(3, 101)
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 8_000
  })

  await includeAllAndOpenTrashDialog(page)
  await expect(page.getByRole("dialog")).toBeVisible()
  await confirmTrashDialog(page, 300)

  // After all batches complete: undo snackbar appears
  await expect(page.getByText(/moved to trash/i)).toBeVisible({
    timeout: 15_000
  })

  // Groups should be gone
  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).not.toBeVisible()

  await stub.close()
  await page.close()
})

// ============================================================
// Undo: baseline restore
// ============================================================

test("undo restores all groups to the UI", async () => {
  await clearStorage(context)
  const { groups, mediaItems } = smallPayload()
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 8_000
  })

  // Trash all groups
  await includeAllAndOpenTrashDialog(page)
  await confirmTrashDialog(page, 3)
  await expect(page.getByText(/moved to trash/i)).toBeVisible({
    timeout: 10_000
  })

  // Click Undo in the snackbar
  await page.getByRole("button", { name: /^Undo$/i }).click()

  // All 3 groups should be restored
  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 10_000
  })

  // Undo snackbar should be dismissed
  await expect(page.getByText(/moved to trash/i)).not.toBeVisible()

  await stub.close()
  await page.close()
})

// ============================================================
// Undo: multi-batch restore
// ============================================================

test("undo after multi-batch trash restores all groups", async () => {
  await clearStorage(context)
  await injectEntitlement(context, "lifetime")

  const { groups, mediaItems } = makeGroups(3, 101) // 303 dedupKeys
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 8_000
  })

  await includeAllAndOpenTrashDialog(page)
  await confirmTrashDialog(page, 300)
  await expect(page.getByText(/moved to trash/i)).toBeVisible({
    timeout: 15_000
  })

  await page.getByRole("button", { name: /^Undo$/i }).click()

  // Pre-trash state fully restored
  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 10_000
  })

  await stub.close()
  await page.close()
})

test("shows a retryable warning when restore undo fails", async () => {
  await clearStorage(context)
  const { groups, mediaItems } = smallPayload()
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length
  )

  const stub = await openGptkStubPage(context, {
    restoreItems: {
      success: false,
      error: "HTTP 504 restore failed",
      data: {
        outcomes: [
          {
            operation: "restore",
            targetKey: "dedup-group0-item1",
            status: "failed"
          },
          {
            operation: "restore",
            targetKey: "dedup-group1-item1",
            status: "failed"
          },
          {
            operation: "restore",
            targetKey: "dedup-group2-item1",
            status: "failed"
          }
        ]
      }
    }
  })
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 8_000
  })

  await includeAllAndOpenTrashDialog(page)
  await confirmTrashDialog(page, 3)
  await expect(page.getByText(/moved to trash/i)).toBeVisible({
    timeout: 10_000
  })

  await page.getByRole("button", { name: /^Undo$/i }).click()

  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 10_000
  })
  await expect(
    page.getByText(/Restore failed: HTTP 504 restore failed/i)
  ).toBeVisible({
    timeout: 10_000
  })
  await expect(
    page.getByRole("button", { name: /Undo moved items/i })
  ).toBeVisible()

  await stub.close()
  await page.close()
})

test("reconciles a same-page late restore but seals uncertainty after reload", async () => {
  await clearStorage(context)
  const { groups, mediaItems } = smallPayload()
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length
  )

  const stub = await openGptkStubPage(context, {
    restoreItems: {
      holdResponse: true,
      progressItemsProcessed: 1,
      progressData: {
        outcomes: [
          {
            operation: "restore",
            targetKey: "dedup-group0-item1",
            status: "confirmed"
          }
        ]
      }
    }
  })
  const page = await openAppTab(context, extensionId)
  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({ timeout: 8_000 })

  await includeAllAndOpenTrashDialog(page)
  await confirmTrashDialog(page, 3)
  await expect(page.getByText(/moved to trash/i)).toBeVisible({
    timeout: 10_000
  })

  // Install the page clock only after setup, then advance the app's bounded
  // restore timer without waiting two real minutes.
  await page.clock.install()
  await page.getByRole("button", { name: /^Undo$/i }).click()
  await stub.waitForFunction(
    () => {
      const stubWindow = window as unknown as {
        __gptkHeldRestoreResponses?: Record<string, unknown>
      }
      return Object.keys(stubWindow.__gptkHeldRestoreResponses ?? {}).length === 1
    },
    undefined,
    { timeout: 8_000 }
  )
  const requestId = await stub.evaluate(() => {
    const stubWindow = window as unknown as {
      __gptkCommandLog: Array<{ command: string; requestId: string }>
    }
    const command = stubWindow.__gptkCommandLog.find(
      (entry) => entry.command === "restoreItems"
    )
    return command?.requestId ?? null
  })
  if (!requestId) throw new Error("The stub did not receive restoreItems.")

  await page.clock.fastForward(120_001)
  await expect(
    page.getByText(/has not returned a terminal restore result/i)
  ).toBeVisible({ timeout: 8_000 })

  const sw = context.serviceWorkers()[0]
  await expect
    .poll(async () =>
      sw.evaluate(
        () =>
          new Promise<any[]>((resolve) => {
            chrome.storage.local.get("recoveryHistory", (result) => {
              resolve((result.recoveryHistory as any[]) || [])
            })
          })
      )
    )
    .toMatchObject([
      {
        restoreUnknownCount: 2,
        restoreOutcomeHistory: [
          {
            requestId,
            terminal: false,
            outcomes: [
              { targetKey: "dedup-group0-item1", status: "confirmed" },
              { targetKey: "dedup-group1-item1", status: "unknown" },
              { targetKey: "dedup-group2-item1", status: "unknown" }
            ]
          }
        ]
      }
    ])

  await stub.evaluate((restoreRequestId) => {
    const stubWindow = window as unknown as {
      __gptkHeldRestoreResponses?: Record<
        string,
        (data: unknown) => void
      >
      __gptkCommandLog: Array<{
        command: string
        requestId: string
        args?: { dedupKeys?: unknown }
      }>
    }
    const restore = stubWindow.__gptkHeldRestoreResponses?.[restoreRequestId]
    const command = stubWindow.__gptkCommandLog.find(
      (entry) =>
        entry.command === "restoreItems" && entry.requestId === restoreRequestId
    )
    const dedupKeys = Array.isArray(command?.args?.dedupKeys)
      ? command.args.dedupKeys
      : []
    restore?.({
      restoredDedupKeys: dedupKeys,
      outcomes: dedupKeys.map((targetKey) => ({
        operation: "restore",
        targetKey,
        status: "confirmed"
      }))
    })
  }, requestId)

  await expect
    .poll(async () =>
      sw.evaluate(
        () =>
          new Promise<any[]>((resolve) => {
            chrome.storage.local.get("recoveryHistory", (result) => {
              resolve((result.recoveryHistory as any[]) || [])
            })
          })
      )
    )
    .toMatchObject([
      {
        status: "restored",
        restoreUnknownCount: 0,
        restorableDedupKeys: [],
        restoreOutcomeHistory: [
          { requestId, terminal: true }
        ]
      }
    ])
  await expect(
    page.getByText(/Provider restore completed/i)
  ).toBeVisible({ timeout: 8_000 })

  await stub.close()
  await page.close()
  await context.unroute("https://photos.google.com/**")

  // A terminal provider reply held by the old page must not authorize a
  // completion after the app has reloaded and lost its live request binding.
  const reloadedCase = await prepareTrashedReviewForRestore(
    context,
    extensionId,
    {
      holdResponse: true,
      progressItemsProcessed: 1,
      progressData: {
        outcomes: [
          {
            operation: "restore",
            targetKey: "dedup-group0-item1",
            status: "confirmed"
          }
        ]
      }
    }
  )
  const reloadedPage = reloadedCase.page
  const reloadedStub = reloadedCase.stub
  try {
    await reloadedPage.clock.install()
    await reloadedPage.getByRole("button", { name: /^Undo$/i }).click()
    await reloadedStub.waitForFunction(
      () => {
        const stubWindow = window as unknown as {
          __gptkHeldRestoreResponses?: Record<string, unknown>
        }
        return Object.keys(stubWindow.__gptkHeldRestoreResponses ?? {}).length === 1
      },
      undefined,
      { timeout: 8_000 }
    )
    const lateRequestId = await reloadedStub.evaluate(() => {
      const commands = (
        window as unknown as {
          __gptkCommandLog: Array<{ command: string; requestId: string }>
        }
      ).__gptkCommandLog.filter((entry) => entry.command === "restoreItems")
      return commands.at(-1)?.requestId ?? null
    })
    if (!lateRequestId) {
      throw new Error("The reloaded-case stub did not receive restoreItems.")
    }

    await reloadedPage.clock.fastForward(120_001)
    await expect(
      reloadedPage.getByText(/has not returned a terminal restore result/i)
    ).toBeVisible({ timeout: 8_000 })
    const beforeReload = await readRecoveryHistory(context)
    expect(
      beforeReload.find((record) =>
        record.restoreOutcomeHistory?.some(
          (entry: { requestId?: string }) => entry.requestId === lateRequestId
        )
      )
    ).toMatchObject({ status: "restore_unknown", restoreUnknownCount: 2 })

    await reloadedPage.reload()
    await expect(
      reloadedPage.getByRole("button", {
        name: "Recovery · 1",
        exact: true
      })
    ).toBeVisible({ timeout: 10_000 })
    await reloadedPage.getByRole("button", { name: "Recovery · 1" }).click()
    await expect(
      reloadedPage.getByText("Restore outcome unknown", { exact: true })
    ).toBeVisible()

    await reloadedStub.evaluate((restoreRequestId) => {
      const stubWindow = window as unknown as {
        __gptkHeldRestoreResponses?: Record<
          string,
          (data: unknown) => void
        >
        __gptkCommandLog: Array<{
          command: string
          requestId: string
          args?: { dedupKeys?: unknown }
        }>
      }
      const restore =
        stubWindow.__gptkHeldRestoreResponses?.[restoreRequestId]
      const command = stubWindow.__gptkCommandLog.find(
        (entry) =>
          entry.command === "restoreItems" &&
          entry.requestId === restoreRequestId
      )
      const dedupKeys = Array.isArray(command?.args?.dedupKeys)
        ? command.args.dedupKeys
        : []
      restore?.({
        restoredDedupKeys: dedupKeys,
        outcomes: dedupKeys.map((targetKey) => ({
          operation: "restore",
          targetKey,
          status: "confirmed"
        }))
      })
    }, lateRequestId)

    await expect
      .poll(async () => {
        const records = await readRecoveryHistory(context)
        return records.find((record) =>
          record.restoreOutcomeHistory?.some(
            (entry: { requestId?: string }) => entry.requestId === lateRequestId
          )
        )
      })
      .toMatchObject({
        status: "restore_unknown",
        restoreUnknownCount: 2,
        restoreOutcomeHistory: [{ requestId: lateRequestId, terminal: false }]
      })
    await expect(
      reloadedPage.getByText("Restore outcome unknown", { exact: true })
    ).toBeVisible()
    await expect(
      reloadedPage.getByText(/Provider restore completed/i)
    ).not.toBeVisible()
  } finally {
    await reloadedStub.close()
    await reloadedPage.close()
    await context.unroute("https://photos.google.com/**")
    await clearStorage(context)
  }
})

test("does not dispatch restore when the begin request is rejected before worker delivery", async () => {
  const { page, stub } = await prepareTrashedReviewForRestore(
    context,
    extensionId
  )
  try {
    await page.evaluate(() => {
      ;(
        window as unknown as {
          __gpdRecoveryTransactionFault: {
            arm(
              failOnPhase: "begin" | "terminal" | "nonterminal",
              mode?: "reject-before-worker" | "drop-ack-after-worker-commit"
            ): void
          }
        }
      ).__gpdRecoveryTransactionFault.arm("begin")
    })
    await page.getByRole("button", { name: /^Undo$/i }).click()

    await expect(
      page.getByText(
        /Restore was not sent because its per-target recovery guard could not be saved\. No provider targets were dispatched\./i
      )
    ).toBeVisible({ timeout: 8_000 })
    const restoreCommands = await stub.evaluate(() => {
      const commands = (
        window as unknown as {
          __gptkCommandLog: Array<{ command: string }>
        }
      ).__gptkCommandLog
      return commands.filter((entry) => entry.command === "restoreItems")
        .length
    })
    expect(restoreCommands).toBe(0)

    const records = await readRecoveryHistory(context)
    expect(records[0]?.restorableDedupKeys).toEqual([
      "dedup-group0-item1",
      "dedup-group1-item1",
      "dedup-group2-item1"
    ])
    expect(records[0]?.restoreOutcomeHistory ?? []).toEqual([])
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              __gpdRecoveryTransactionFault: {
                recoveryTransactions: number
                failures: number
                failedPhase: string
              }
            }
          ).__gpdRecoveryTransactionFault
      )
    ).toMatchObject({
      recoveryTransactions: 1,
      failures: 1,
      failedPhase: "begin"
    })
  } finally {
    await stub.close()
    await page.close()
    await clearStorage(context)
  }
})

test("does not dispatch restore when the committed begin guard acknowledgement is lost", async () => {
  const { page, stub } = await prepareTrashedReviewForRestore(
    context,
    extensionId
  )
  try {
    await page.evaluate(() => {
      ;(
        window as unknown as {
          __gpdRecoveryTransactionFault: {
            arm(
              failOnPhase: "begin" | "terminal" | "nonterminal",
              mode?: "reject-before-worker" | "drop-ack-after-worker-commit"
            ): void
          }
        }
      ).__gpdRecoveryTransactionFault.arm(
        "begin",
        "drop-ack-after-worker-commit"
      )
    })
    await page.getByRole("button", { name: /^Undo$/i }).click()

    await expect(
      page.getByText(
        /Restore was not sent because its per-target recovery guard could not be saved\. No provider targets were dispatched\./i
      )
    ).toBeVisible({ timeout: 8_000 })
    const restoreCommands = await stub.evaluate(() => {
      const commands = (
        window as unknown as {
          __gptkCommandLog: Array<{ command: string }>
        }
      ).__gptkCommandLog
      return commands.filter((entry) => entry.command === "restoreItems")
        .length
    })
    expect(restoreCommands).toBe(0)

    const records = await readRecoveryHistory(context)
    expect(records[0]).toMatchObject({
      status: "restore_unknown",
      restorableDedupKeys: [],
      restoreUnknownCount: 3,
      restoreOutcomes: [
        {
          targetKey: "dedup-group0-item1",
          status: "unknown",
          reason: "durable-pre-dispatch-intent"
        },
        {
          targetKey: "dedup-group1-item1",
          status: "unknown",
          reason: "durable-pre-dispatch-intent"
        },
        {
          targetKey: "dedup-group2-item1",
          status: "unknown",
          reason: "durable-pre-dispatch-intent"
        }
      ],
      restoreOutcomeHistory: [{ terminal: false }]
    })
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              __gpdRecoveryTransactionFault: {
                recoveryTransactions: number
                failures: number
                failedPhase: string
                mode: string
              }
            }
          ).__gpdRecoveryTransactionFault
      )
    ).toMatchObject({
      recoveryTransactions: 1,
      failures: 1,
      failedPhase: "begin",
      mode: "drop-ack-after-worker-commit"
    })
  } finally {
    await stub.close()
    await page.close()
    await clearStorage(context)
  }
})

test("keeps the prewritten guard when a terminal update is rejected before worker delivery", async () => {
  const { page, stub } = await prepareTrashedReviewForRestore(
    context,
    extensionId
  )
  try {
    await page.evaluate(() => {
      ;(
        window as unknown as {
          __gpdRecoveryTransactionFault: {
            arm(
              failOnPhase: "begin" | "terminal" | "nonterminal",
              mode?: "reject-before-worker" | "drop-ack-after-worker-commit"
            ): void
          }
        }
      ).__gpdRecoveryTransactionFault.arm("terminal")
    })
    await page.getByRole("button", { name: /^Undo$/i }).click()

    await expect(
      page.getByText(
        /terminal restore result, but its final outcome could not be saved/i
      )
    ).toBeVisible({ timeout: 10_000 })
    const restoreCommands = await stub.evaluate(() => {
      const commands = (
        window as unknown as {
          __gptkCommandLog: Array<{ command: string }>
        }
      ).__gptkCommandLog
      return commands.filter((entry) => entry.command === "restoreItems")
        .length
    })
    expect(restoreCommands).toBe(1)

    const records = await readRecoveryHistory(context)
    expect(records[0]).toMatchObject({
      status: "restore_unknown",
      restorableDedupKeys: [],
      restoreUnknownCount: 3,
      restoreOutcomeHistory: [
        {
          terminal: false,
          outcomes: [
            { targetKey: "dedup-group0-item1", status: "unknown" },
            { targetKey: "dedup-group1-item1", status: "unknown" },
            { targetKey: "dedup-group2-item1", status: "unknown" }
          ]
        }
      ]
    })
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              __gpdRecoveryTransactionFault: {
                recoveryTransactions: number
                failures: number
                failedPhase: string
              }
            }
          ).__gpdRecoveryTransactionFault
      )
    ).toMatchObject({ failures: 1, failedPhase: "terminal" })
  } finally {
    await stub.close()
    await page.close()
    await clearStorage(context)
  }
})

test("a timeout update rejected before worker delivery cannot reopen its prewritten guard", async () => {
  const { page, stub } = await prepareTrashedReviewForRestore(
    context,
    extensionId,
    { holdResponse: true }
  )
  try {
    await page.clock.install()
    await page.getByRole("button", { name: /^Undo$/i }).click()
    await stub.waitForFunction(
      () => {
        const held = (
          window as unknown as {
            __gptkHeldRestoreResponses?: Record<string, unknown>
          }
        ).__gptkHeldRestoreResponses
        return Object.keys(held ?? {}).length === 1
      },
      undefined,
      { timeout: 8_000 }
    )
    await page.evaluate(() => {
      ;(
        window as unknown as {
          __gpdRecoveryTransactionFault: {
            arm(
              failOnPhase: "begin" | "terminal" | "nonterminal",
              mode?: "reject-before-worker" | "drop-ack-after-worker-commit"
            ): void
          }
        }
      ).__gpdRecoveryTransactionFault.arm("nonterminal")
    })
    await page.clock.fastForward(120_001)

    await expect(
      page.getByText(
        /latest progress could not be saved.*durable pre-dispatch guard remains in recovery history/i
      )
    ).toBeVisible({ timeout: 8_000 })
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              __gpdRecoveryTransactionFault: {
                mode: "reject-before-worker" | "drop-ack-after-worker-commit"
                failures: number
                failedPhase: string
              }
            }
          ).__gpdRecoveryTransactionFault
      )
      ).toMatchObject({
        mode: "reject-before-worker",
        failures: 1,
        failedPhase: "nonterminal"
      })
    let records = await readRecoveryHistory(context)
    expect(records[0]).toMatchObject({
      status: "restore_unknown",
      restorableDedupKeys: [],
      restoreUnknownCount: 3,
      restoreOutcomeHistory: [{ terminal: false }]
    })

    await page.reload()
    await expect(
      page.getByRole("heading", {
        name: "3 Duplicate Sets to Review",
        exact: true
      })
    ).toBeVisible({ timeout: 10_000 })
    records = await readRecoveryHistory(context)
    expect(records[0]?.restorableDedupKeys).toEqual([])
    expect(records[0]?.restoreUnknownCount).toBe(3)
    const restoreCommands = await stub.evaluate(() => {
      const commands = (
        window as unknown as {
          __gptkCommandLog: Array<{ command: string }>
        }
      ).__gptkCommandLog
      return commands.filter((entry) => entry.command === "restoreItems")
        .length
    })
    expect(restoreCommands).toBe(1)
  } finally {
    await stub.close()
    await page.close()
    await clearStorage(context)
  }
})

test("retires an old Undo restore when the connected account changes", async () => {
  await clearStorage(context)
  const { groups, mediaItems } = smallPayload()
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
    restoreItems: { data: {}, delayMs: 1_000 }
  })
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({ timeout: 8_000 })

  await includeAllAndOpenTrashDialog(page, "alice@example.com")
  await confirmTrashDialog(page, 3)
  await expect(page.getByText(/moved to trash/i)).toBeVisible({
    timeout: 10_000
  })
  await page.getByRole("button", { name: /^Undo$/i }).click()

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
  await expect(
    page.getByRole("button", { name: /Undo moved items/i })
  ).not.toBeVisible()

  // The delayed response belongs to Alice's retired restore operation. It must
  // not recreate Alice's Undo state or a recovery warning for Bob.
  await page.waitForTimeout(1_200)
  await expect(page.getByText(/Restore failed:/i)).not.toBeVisible()
  await expect(
    page.getByRole("button", { name: /Undo moved items/i })
  ).not.toBeVisible()

  await stub.close()
  await page.close()
  await clearStorage(context)
})

// ============================================================
// Error: trash API failure
// ============================================================

test("shows error state when trashItems fails", async () => {
  await clearStorage(context)
  const { groups, mediaItems } = smallPayload()
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length
  )

  // Configure stub to return failure for trashItems
  const stub = await openGptkStubPage(context, {
    trashItems: { success: false, error: "HTTP 504" }
  })
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 8_000
  })

  await includeAllAndOpenTrashDialog(page)
  await confirmTrashDialog(page, 3)

  // TRASH_ERROR dispatches { status: "disconnected", error: "HTTP 504" }.
  // The disconnected state shows the error string in an Alert and a "Retry Connection" button.
  await expect(
    page.getByRole("button", { name: /Retry Connection/i })
  ).toBeVisible({ timeout: 10_000 })
  // The raw error from the stub is surfaced in the Alert
  await expect(page.getByRole("main").getByText(/HTTP 504/)).toBeVisible()

  await stub.close()
  await page.close()
})

test("surfaces provider failure for a dry-run result", async () => {
  await clearStorage(context)
  const { groups, mediaItems } = smallPayload()
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length
  )

  const stub = await openGptkStubPage(context, {
    trashItems: {
      success: false,
      error: "dry-run provider failure",
      data: { dryRun: true, requestedCount: 3 }
    }
  })
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({ timeout: 8_000 })

  await includeAllAndOpenTrashDialog(page)
  await confirmTrashDialog(page, 3)

  await expect(
    page.getByRole("button", { name: /Retry Connection/i })
  ).toBeVisible({ timeout: 10_000 })
  await expect(
    page.getByRole("main").getByText("dry-run provider failure")
  ).toBeVisible()
  await expect(
    page.getByRole("main").getByText(/iCloud delete dry-run completed/i)
  ).not.toBeVisible()

  await stub.close()
  await page.close()
})

test("keeps failed items visible and reports partial trash results", async () => {
  await clearStorage(context)
  const { groups, mediaItems } = smallPayload()
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length
  )

  const stub = await openGptkStubPage(context, {
    trashItems: {
      success: false,
      error: "Google Photos reported 1 of 3 items moved",
      data: {
        partial: true,
        trashedCount: 1,
        trashedKeys: ["group0-item1"],
        trashedDedupKeys: ["dedup-group0-item1"],
        outcomes: [
          {
            operation: "trash",
            targetKey: "dedup-group0-item1",
            status: "confirmed"
          },
          {
            operation: "trash",
            targetKey: "dedup-group1-item1",
            status: "failed"
          },
          {
            operation: "trash",
            targetKey: "dedup-group2-item1",
            status: "failed"
          }
        ],
        retryAttempts: 0
      }
    }
  })
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 8_000
  })

  await includeAllAndOpenTrashDialog(page)
  await confirmTrashDialog(page, 3)

  await expect(page.getByText(/Moved 1 item before trash failed/i)).toBeVisible(
    {
      timeout: 10_000
    }
  )
  await expect(page.getByText("photo-group1-item1.jpg")).toBeVisible({
    timeout: 10_000
  })
  await expect(page.getByText("photo-group2-item1.jpg")).toBeVisible()
  await expect(page.getByText("photo-group0-item1.jpg")).not.toBeVisible()

  const sw = context.serviceWorkers()[0]
  const reports = await sw.evaluate(
    () =>
      new Promise<any[]>((resolve) => {
        chrome.storage.local.get("trashResultReports", (result) => {
          resolve((result.trashResultReports as any[]) || [])
        })
      })
  )
  expect(reports).toHaveLength(1)
  expect(reports[0]).toMatchObject({
    status: "partial",
    attemptedCount: 3,
    movedCount: 1,
    failedCount: 2,
    movedMediaKeys: ["group0-item1"],
    failedMediaKeys: ["group1-item1", "group2-item1"],
    error: "Google Photos reported 1 of 3 items moved"
  })

  await stub.close()
  await page.close()
})

// ============================================================
// Cancel: dismiss confirm dialog without trashing
// ============================================================

test("cancel dialog does not trigger trash", async () => {
  await clearStorage(context)
  const { groups, mediaItems } = smallPayload()
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)

  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible({
    timeout: 8_000
  })

  await includeAllAndOpenTrashDialog(page)
  await expect(page.getByRole("dialog")).toBeVisible()

  // Click Cancel in the dialog
  await page.getByRole("button", { name: /^Cancel$/i }).click()

  // Dialog should close; groups remain intact
  await expect(page.getByRole("dialog")).not.toBeVisible()
  await expect(
    page.getByRole("heading", {
      name: "3 Duplicate Sets to Review",
      exact: true
    })
  ).toBeVisible()
  await expect(page.getByText(/moved to trash/i)).not.toBeVisible()

  await stub.close()
  await page.close()
})
