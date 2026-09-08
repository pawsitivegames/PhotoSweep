import { expect, test, type BrowserContext, type Page } from "@playwright/test"

import {
  clearStorage,
  injectScanResults,
  injectSelections,
  launchExtension,
  makeGroups,
  openAppTab,
  openGptkStubPage
} from "../../../tests/e2e/fixtures/extension"

const apiBaseUrl =
  process.env.PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL ??
  "https://photosweep-license-api-206538169327.us-west1.run.app"

let context: BrowserContext
let extensionId: string

async function closePagesExcept(page: Page): Promise<void> {
  for (const candidate of context.pages()) {
    if (candidate !== page) await candidate.close()
  }
}

test.beforeAll(async () => {
  ;({ context, extensionId } = await launchExtension())
})

test.afterAll(async () => {
  await context.close()
})

test("consent opt-out is silent and allow sends only an allowlisted event", async () => {
  const events: Record<string, unknown>[] = []
  await context.route(`${apiBaseUrl}/analytics`, async (route) => {
    const body = route.request().postData()
    if (body) events.push(JSON.parse(body) as Record<string, unknown>)
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true })
    })
  })

  await clearStorage(context)
  const stub = await openGptkStubPage(context)
  let page = await openAppTab(context, extensionId)
  try {
    await expect(page.getByText("Optional private usage metrics")).toBeVisible({
      timeout: 8_000
    })
    await page.waitForTimeout(250)
    expect(events).toHaveLength(0)
    await page.getByRole("button", { name: "No thanks" }).click()
    await expect(
      page.getByText("Optional private usage metrics")
    ).not.toBeVisible()
    expect(events).toHaveLength(0)
    await page.close()
    await stub.close()

    await clearStorage(context)
    const allowStub = await openGptkStubPage(context)
    page = await openAppTab(context, extensionId)
    await expect(
      page.getByText("Optional private usage metrics")
    ).toBeVisible({ timeout: 8_000 })
    await page.getByRole("button", { name: "Allow" }).click()
    await expect.poll(() => events.length, { timeout: 8_000 }).toBeGreaterThan(0)
    expect(events[0]).toMatchObject({ name: "app_opened" })
    for (const event of events) {
      expect(Object.keys(event)).toEqual(
        expect.arrayContaining(["name"])
      )
      expect(event).not.toHaveProperty("email")
      expect(event).not.toHaveProperty("filename")
      expect(event).not.toHaveProperty("mediaKey")
      expect(event).not.toHaveProperty("token")
      expect(event).not.toHaveProperty("exactCount")
    }
    const storagePage = await context.newPage()
    await storagePage.goto(`chrome-extension://${new URL(page.url()).hostname}/manifest.json`)
    const consent = await storagePage.evaluate(
      () =>
        new Promise<unknown>((resolve) =>
          chrome.storage.local.get("photoSweepAnalyticsConsent", resolve)
        )
    )
    expect(consent).toMatchObject({ photoSweepAnalyticsConsent: true })
    await storagePage.close()
    await page.close()
    await allowStub.close()
  } finally {
    await closePagesExcept(page)
    await clearStorage(context).catch(() => {})
  }
})

test("checkout return with an unverifiable token stays retryable and preserves review", async () => {
  await clearStorage(context)
  const { groups, mediaItems } = makeGroups(2, 7)
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length,
    "test@example.com"
  )
  await injectSelections(context, groups.map((group) => group.id))

  let checkoutStarts = 0
  let entitlementRefreshes = 0
  await context.route(`${apiBaseUrl}/checkout`, async (route) => {
    checkoutStarts += 1
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "https://checkout.test/return",
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
    await page.bringToFront()
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect.poll(() => entitlementRefreshes).toBeGreaterThan(0)
    await expect(
      page.getByText(/Payment is still being confirmed|Payment could not be verified yet/i)
    ).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText(/3 Duplicate Sets to Review|2 Duplicate Sets to Review/i)).not.toHaveCount(0)
    await page.getByRole("button", { name: "Keep reviewing free results" }).click()
    await expect(
      page.getByRole("button", { name: /Review & move 12 to Trash/i })
    ).toBeVisible()
    await expect(page.getByText(/moved to trash/i)).not.toBeVisible()
  } finally {
    for (const candidate of context.pages()) {
      if (candidate !== page && candidate !== stub) {
        await candidate.close().catch(() => {})
      }
    }
    await page.close()
    await stub.close()
    await context.unroute(`${apiBaseUrl}/checkout`)
    await context.unroute(`${apiBaseUrl}/entitlement`)
  }
})
