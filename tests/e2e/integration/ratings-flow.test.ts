import { expect, test, type BrowserContext, type Page } from "@playwright/test"

import {
  CHROME_WEB_STORE_REVIEWS_URL,
  FEEDBACK_MAILTO_URL
} from "../../../lib/feedback"
import { buildFunnelEvidenceSummary } from "../../../server/funnel-evidence.mjs"
import {
  createLicenseApi,
  createMemoryLicenseStore
} from "../../../server/license-api.mjs"
import {
  clearStorage,
  injectScanResults,
  launchExtension,
  makeGroups,
  openAppTab,
  openGptkStubPage,
  type GptkOverrides
} from "../fixtures/extension"

let context: BrowserContext
let extensionId: string
const analyticsEndpoint = "https://photosweep-license-api.test/analytics"
const invitation = (page: Page) =>
  page.getByRole("region", { name: "PhotoSweep review invitation" })

test.beforeAll(async () => {
  ;({ context, extensionId } = await launchExtension())
})
test.afterEach(async () => {
  await context.serviceWorkers()[0].evaluate(async (url) => {
    const tabs = (await chrome.tabs.query({})).filter(
      (tab) => tab.url === url || tab.pendingUrl === url
    )
    await chrome.tabs.remove(
      tabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id]))
    )
  }, CHROME_WEB_STORE_REVIEWS_URL)
  for (const page of context.pages()) await page.close()
  await context.unrouteAll({ behavior: "wait" })
})
test.afterAll(async () => {
  await context.close()
})

async function setup({
  consent = false,
  saved = undefined,
  overrides = {}
}: {
  consent?: boolean
  saved?: Record<string, unknown>
  overrides?: GptkOverrides
} = {}) {
  await clearStorage(context)
  const data = makeGroups(1, 2)
  await injectScanResults(context, data.groups, data.mediaItems, 2)
  await context.serviceWorkers()[0].evaluate(
    async ({ consent, saved }) => {
      await chrome.storage.local.set({
        photoSweepAnalyticsConsent: consent,
        ...(saved ? { ratingPrompt: saved } : {})
      })
    },
    { consent, saved }
  )
  const events: Record<string, unknown>[] = []
  const store = createMemoryLicenseStore()
  const api = createLicenseApi({
    store,
    env: {
      NODE_ENV: "development",
      PHOTOSWEEP_ALLOWED_ORIGINS: `chrome-extension://${extensionId}`
    }
  })
  await context.route(analyticsEndpoint, async (route) => {
    const request = route.request()
    const response = await api(
      new Request(request.url(), {
        method: request.method(),
        headers: {
          "content-type": "application/json",
          origin: `chrome-extension://${extensionId}`
        },
        body: request.postData()
      })
    )
    expect(response.status).toBe(200)
    events.push(request.postDataJSON())
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text()
    })
  })
  const stub = await openGptkStubPage(context, overrides)
  const page = await openAppTab(context, extensionId)
  await expect(page.getByText("Signed in · test@example.com")).toBeVisible({
    timeout: 10000
  })
  return { page, stub, events, store }
}

async function cleanup(page: Page, layout: "page" | "panel" = "page") {
  await page
    .getByRole("button", {
      name:
        layout === "panel"
          ? /^Include all 1 available set in cleanup$/i
          : /^Include all 1 shown set in cleanup$/i
    })
    .click()
  await page
    .locator("[data-review-group-id]")
    .getByRole("button", { name: /currently kept; this is the last kept copy/ })
    .click()
  await page.getByRole("button", { name: /Review & move 1 to Trash/i }).click()
  await page.getByLabel("Type 1 to confirm").fill("1")
  await page
    .getByRole("checkbox", {
      name: "I understand these items may be favorites"
    })
    .check()
  await page
    .getByRole("button", { name: /^Move to Trash$/ })
    .last()
    .click()
}

// Assert the browser-created tab, independently of the third-party site's load
// time. No review is submitted and the Store page is never intercepted.
async function openReviewTabUrls() {
  return context
    .serviceWorkers()[0]
    .evaluate(async () =>
      (await chrome.tabs.query({})).flatMap((tab) =>
        [tab.url, tab.pendingUrl].filter(Boolean)
      )
    )
}

async function preferences() {
  return context
    .serviceWorkers()[0]
    .evaluate(
      async () => (await chrome.storage.local.get("ratingPrompt")).ratingPrompt
    )
}

test("scan-only results have a voluntary review link and no automatic invitation", async () => {
  const { page, events } = await setup()
  await expect(invitation(page)).not.toBeVisible()
  const link = page
    .getByRole("contentinfo")
    .getByRole("link", { name: "Leave an honest review" })
  await expect(link).toHaveAttribute("href", CHROME_WEB_STORE_REVIEWS_URL)
  await page.getByRole("button", { name: /Scan again/i }).click()
  await page.getByText("Help & feedback", { exact: true }).click()
  await expect(
    page.getByRole("link", { name: "Leave an honest review" }).first()
  ).toHaveAttribute("href", CHROME_WEB_STORE_REVIEWS_URL)
  expect(await preferences()).toBeUndefined()
  expect(events).toEqual([])
})

test("review opens the Store while Undo remains available and restores the moved item", async () => {
  const { page, stub, events } = await setup()
  await cleanup(page)
  await expect(invitation(page)).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Undo", exact: true })
  ).toBeVisible()
  await expect(page.getByRole("dialog")).not.toBeVisible()
  await invitation(page)
    .getByRole("link", { name: "Leave an honest review" })
    .click({ noWaitAfter: true })
  await expect.poll(openReviewTabUrls).toContain(CHROME_WEB_STORE_REVIEWS_URL)
  await expect
    .poll(preferences)
    .toMatchObject({ completed: false, lastAction: "review_opened" })
  await page.bringToFront()
  await expect(
    page.getByRole("button", { name: "Undo", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(
    page.getByRole("heading", {
      name: "1 Duplicate Set to Review",
      exact: true
    })
  ).toBeVisible()
  await expect(invitation(page)).not.toBeVisible()
  const commands = await stub.evaluate(() =>
    (
      window as unknown as { __gptkCommandLog: { command: string }[] }
    ).__gptkCommandLog.map((x) => x.command)
  )
  expect(commands.filter((x) => x === "trashItems")).toHaveLength(1)
  expect(commands.filter((x) => x === "restoreItems")).toHaveLength(1)
  expect(events).toEqual([])
})

test("an unanswered invitation survives reload without changing Undo history", async () => {
  const { page } = await setup()
  await cleanup(page)
  await expect(invitation(page)).toBeVisible()
  const before = await context
    .serviceWorkers()[0]
    .evaluate(
      async () =>
        (await chrome.storage.local.get("recoveryHistory")).recoveryHistory
    )
  await page.reload()
  await expect(invitation(page)).toBeVisible()
  expect(
    await context
      .serviceWorkers()[0]
      .evaluate(
        async () =>
          (await chrome.storage.local.get("recoveryHistory")).recoveryHistory
      )
  ).toEqual(before)
})

test("the narrow side panel supports keyboard deferral while keeping Undo available", async () => {
  const { page } = await setup()
  await page.close()
  const panel = await context.newPage()
  await panel.setViewportSize({ width: 360, height: 800 })
  await panel.emulateMedia({ reducedMotion: "reduce" })
  await panel.goto(`chrome-extension://${extensionId}/tabs/scanner-panel.html`)
  await expect(
    panel.getByRole("button", {
      name: /^Include all 1 available set in cleanup$/i
    })
  ).toBeVisible()
  await cleanup(panel, "panel")
  await expect(invitation(panel)).toBeVisible()
  await expect(invitation(panel)).toHaveJSProperty(
    "scrollWidth",
    await invitation(panel).evaluate((el) => el.clientWidth)
  )
  const link = invitation(panel).getByRole("link", {
    name: "Leave an honest review"
  })
  await link.focus()
  await panel.keyboard.press("Tab")
  await expect(
    invitation(panel).getByRole("button", { name: "Send feedback" })
  ).toBeFocused()
  await panel.keyboard.press("Tab")
  await expect(
    invitation(panel).getByRole("button", { name: "Maybe later" })
  ).toBeFocused()
  await panel.keyboard.press("Enter")
  await expect(invitation(panel)).not.toBeVisible()
  await expect(
    panel.getByRole("button", { name: "Undo", exact: true })
  ).toBeVisible()
})

test("Maybe later persists and consented impressions and dismissal are counted once", async () => {
  const { page, events, store } = await setup({ consent: true })
  await cleanup(page)
  await expect(invitation(page)).toBeVisible()
  await expect
    .poll(() => events.filter((e) => e.name === "review_prompt_shown").length)
    .toBe(1)
  await invitation(page).getByRole("button", { name: "Maybe later" }).click()
  await expect
    .poll(preferences)
    .toMatchObject({ completed: false, lastAction: "later", nextPromptAt: 4 })
  await expect
    .poll(() => events.filter((e) => e.name === "review_prompt_dismissed"))
    .toMatchObject([
      { reviewSource: "cleanup", reviewDismissalReason: "later" }
    ])
  await page.reload()
  await expect(
    page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Leave an honest review" })
  ).toBeVisible()
  await expect(invitation(page)).not.toBeVisible()
  expect(events.filter((e) => e.name === "review_prompt_shown")).toHaveLength(1)
  const summary = buildFunnelEvidenceSummary(store.snapshot().analyticsEvents, {
    currentVersion: "2.3.6.25"
  })
  expect(summary.eventCountsByName).toMatchObject({
    review_prompt_shown: 1,
    review_prompt_dismissed: 1
  })
  expect(summary).not.toHaveProperty("ratingsSubmitted")
})

test("email feedback defers without permanently opting out", async () => {
  const { page } = await setup()
  await cleanup(page)
  await expect(invitation(page)).toBeVisible()
  await page.evaluate(() => {
    chrome.tabs.create = ((options: chrome.tabs.CreateProperties) => {
      ;(
        window as unknown as { feedbackTarget: string | undefined }
      ).feedbackTarget = options.url
      return Promise.resolve({} as chrome.tabs.Tab)
    }) as typeof chrome.tabs.create
  })
  await invitation(page).getByRole("button", { name: "Send feedback" }).click()
  await expect
    .poll(preferences)
    .toMatchObject({ completed: false, lastAction: "feedback_opened" })
  expect(
    await page.evaluate(
      () => (window as unknown as { feedbackTarget: string }).feedbackTarget
    )
  ).toBe(FEEDBACK_MAILTO_URL)
  await expect(
    page.getByRole("button", { name: "Undo", exact: true })
  ).toBeVisible()
})

test("Don't ask again persists after reload and still permits voluntary review", async () => {
  const { page, events, store } = await setup({ consent: true })
  await cleanup(page)
  await invitation(page)
    .getByRole("button", { name: "Don't ask again" })
    .click()
  await expect
    .poll(preferences)
    .toMatchObject({ completed: true, lastAction: "never" })
  await page.reload()
  await expect(
    page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Leave an honest review" })
  ).toBeVisible()
  await expect(invitation(page)).not.toBeVisible()
  await page
    .getByRole("contentinfo")
    .getByRole("link", { name: "Leave an honest review" })
    .click({ noWaitAfter: true })
  await expect.poll(openReviewTabUrls).toContain(CHROME_WEB_STORE_REVIEWS_URL)
  await expect
    .poll(() => events.filter((e) => e.name === "review_link_clicked"))
    .toMatchObject([{ reviewSource: "help" }])
  expect(await preferences()).toMatchObject({
    completed: true,
    lastAction: "never"
  })
  expect(
    buildFunnelEvidenceSummary(store.snapshot().analyticsEvents, {
      currentVersion: "2.3.6.25"
    }).eventCountsByName.review_link_clicked
  ).toBe(1)
  expect(
    events.filter((e) => e.name === "review_prompt_dismissed")
  ).toMatchObject([{ reviewDismissalReason: "never" }])
})

test("legacy completed records remain opted out after another cleanup", async () => {
  const saved = {
    successfulScans: 5,
    successfulCleanups: 1,
    nextPromptAt: 1,
    completed: true
  }
  const { page } = await setup({ saved })
  await expect(invitation(page)).not.toBeVisible()
  await cleanup(page)
  await expect(
    page.getByRole("button", { name: "Undo", exact: true })
  ).toBeVisible()
  await expect(invitation(page)).not.toBeVisible()
  expect(await preferences()).toEqual(saved)
})

for (const [name, outcome] of [
  ["failed", { success: false, error: "Rating fixture failure" }],
  ["dry-run", { data: { dryRun: true, requestedCount: 1, trashedCount: 0 } }],
  [
    "zero-move",
    { data: { trashedCount: 0, trashedKeys: [], trashedDedupKeys: [] } }
  ]
] as const) {
  test(`${name} cleanup does not create rating eligibility`, async () => {
    const { page, stub } = await setup({ overrides: { trashItems: outcome } })
    await cleanup(page)
    await expect
      .poll(async () =>
        stub.evaluate(
          () =>
            (
              window as unknown as { __gptkCommandLog: { command: string }[] }
            ).__gptkCommandLog.filter((x) => x.command === "trashItems").length
        )
      )
      .toBe(1)
    await expect(
      page
        .getByRole("button", { name: /Retry Connection/i })
        .or(page.getByText(/dry.run|No items|not confirmed/i).first())
    ).toBeVisible()
    await expect(invitation(page)).not.toBeVisible()
    expect(await preferences()).toBeUndefined()
  })
}
