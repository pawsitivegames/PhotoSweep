import { expect, test, type BrowserContext } from "@playwright/test"
import { clearStorage, launchExtension, openAppTab, openGptkStubPage } from "../fixtures/extension"

let context: BrowserContext
let extensionId: string
const endpoint = "https://photosweep-license-api.test/analytics"
test.beforeAll(async () => { ({ context, extensionId } = await launchExtension()) })
test.afterAll(async () => { await context.close() })

test("default-off metrics replay the current connection on opt-in and disclose identity fields", async () => {
  await clearStorage(context)
  const events: Record<string, unknown>[] = []
  await context.route(endpoint, async route => {
    events.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  })
  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  try {
    await expect(page.getByText("Signed in · test@example.com")).toBeVisible({ timeout: 10000 })
    expect(events).toEqual([])
    await expect(page.getByText(/a random install identifier, extension version, and UTC day/)).toBeVisible()
    await page.getByRole("button", { name: "Allow", exact: true }).click()
    await expect.poll(() => events.filter(event => event.name === "provider_connected").length).toBe(1)
    expect(events.find(event => event.name === "provider_connected")).toMatchObject({ provider: "google" })
    await page.getByRole("button", { name: "Change", exact: true }).click()
    await page.getByRole("button", { name: "No thanks", exact: true }).click()
    await expect(page.getByText(/Usage metrics off/)).toBeVisible()
    await page.getByRole("button", { name: "Change", exact: true }).click()
    await page.getByRole("button", { name: "Allow", exact: true }).click()
    await expect.poll(() => events.filter(event => event.name === "provider_connected").length).toBe(2)
  } finally {
    await page.close(); await stub.close(); await context.unroute(endpoint)
    await context.unroute("https://photos.google.com/**")
  }
})

test("revoking consent drops events awaiting install identity", async () => {
  await clearStorage(context)
  const events: Record<string, unknown>[] = []
  await context.route(endpoint, async route => {
    events.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  })
  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  try {
    await expect(page.getByText("Signed in · test@example.com")).toBeVisible({ timeout: 10000 })
    await page.evaluate(() => {
      const original = chrome.storage.local.get.bind(chrome.storage.local)
      const win = window as unknown as { releaseIdentity?: () => void; identityPending?: boolean }
      chrome.storage.local.get = ((keys: unknown) => {
        if (keys === "photoSweepInstallId") {
          win.identityPending = true
          return new Promise(resolve => { win.releaseIdentity = () => resolve({ photoSweepInstallId: "123e4567-e89b-42d3-a456-426614174000" }) })
        }
        return original(keys as string)
      }) as typeof chrome.storage.local.get
    })
    await page.getByRole("button", { name: "Allow", exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { identityPending?: boolean }).identityPending)).toBe(true)
    await page.getByRole("button", { name: "Change", exact: true }).click()
    await page.getByRole("button", { name: "No thanks", exact: true }).click()
    await page.evaluate(async () => {
      (window as unknown as { releaseIdentity: () => void }).releaseIdentity()
      // Drain the production promise chain before checking that nothing was sent.
      await new Promise(resolve => setTimeout(resolve, 50))
    })
    expect(events).toEqual([])
  } finally {
    await page.close(); await stub.close(); await context.unroute(endpoint)
    await context.unroute("https://photos.google.com/**")
  }
})
test("re-allowing consent does not revive events from the revoked generation", async () => {
  await clearStorage(context)
  const events: Record<string, unknown>[] = []
  await context.route(endpoint, async route => {
    events.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  })
  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  try {
    await expect(page.getByText("Signed in · test@example.com")).toBeVisible({ timeout: 10000 })
    await page.evaluate(() => {
      const original = chrome.storage.local.get.bind(chrome.storage.local)
      const win = window as unknown as { releaseIdentity?: () => void; identityPending?: boolean }
      chrome.storage.local.get = ((keys: unknown) => {
        if (keys === "photoSweepInstallId") {
          win.identityPending = true
          return new Promise(resolve => { win.releaseIdentity = () => resolve({ photoSweepInstallId: "123e4567-e89b-42d3-a456-426614174000" }) })
        }
        return original(keys as string)
      }) as typeof chrome.storage.local.get
    })
    await page.getByRole("button", { name: "Allow", exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { identityPending?: boolean }).identityPending)).toBe(true)
    await page.getByRole("button", { name: "Change", exact: true }).click()
    await page.getByRole("button", { name: "No thanks", exact: true }).click()
    await page.getByRole("button", { name: "Change", exact: true }).click()
    await page.getByRole("button", { name: "Allow", exact: true }).click()
    await page.evaluate(async () => {
      (window as unknown as { releaseIdentity: () => void }).releaseIdentity()
      // Drain the production promise chain before checking that nothing was sent.
      await new Promise(resolve => setTimeout(resolve, 50))
    })
    await expect.poll(() => events.length).toBe(1)
    expect(events[0]).toMatchObject({ name: "provider_connected", provider: "google" })
  } finally {
    await page.close(); await stub.close(); await context.unroute(endpoint)
    await context.unroute("https://photos.google.com/**")
  }
})


test("a scan paused during cache lookup emits no scan attempt or provider dispatch", async () => {
  await clearStorage(context)
  const events: Record<string, unknown>[] = []
  await context.route(endpoint, async route => {
    events.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  })
  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  try {
    await expect(page.getByText("Signed in · test@example.com")).toBeVisible({ timeout: 10000 })
    await page.getByRole("button", { name: "Allow", exact: true }).click()
    await expect.poll(() => events.filter(event => event.name === "provider_connected").length).toBe(1)
    await page.evaluate(() => {
      const original = chrome.storage.local.get.bind(chrome.storage.local)
      const win = window as unknown as { releaseCache?: () => void; cachePending?: boolean }
      chrome.storage.local.get = ((keys: unknown) => {
        if (Array.isArray(keys) && keys.some(key => String(key).endsWith(".scanResults"))) {
          win.cachePending = true
          return new Promise(resolve => { win.releaseCache = () => { chrome.storage.local.get = original; resolve({}) } })
        }
        return original(keys as string)
      }) as typeof chrome.storage.local.get
    })
    await page.getByRole("button", { name: /^Scan recent 30 days$/ }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { cachePending?: boolean }).cachePending)).toBe(true)
    await page.getByRole("button", { name: "Pause Scan", exact: true }).click()
    await page.evaluate(async () => {
      (window as unknown as { releaseCache: () => void }).releaseCache()
      await new Promise(resolve => setTimeout(resolve, 50))
    })
    expect(events.filter(event => event.name === "scan_started")).toEqual([])
    expect(await stub.evaluate(() => (window as unknown as { __gptkCommandLog: { command: string }[] }).__gptkCommandLog.filter(entry => entry.command === "getAllMediaItems"))).toEqual([])
    await page.getByRole("button", { name: /^(Check|Scan) this date range$/ }).click()
    await expect.poll(() => events.filter(event => event.name === "scan_started").length).toBe(1)
    await expect.poll(() => stub.evaluate(() => (window as unknown as { __gptkCommandLog: { command: string }[] }).__gptkCommandLog.filter(entry => entry.command === "getAllMediaItems").length)).toBe(1)
  } finally {
    await page.close(); await stub.close(); await context.unroute(endpoint)
    await context.unroute("https://photos.google.com/**")
  }
})
