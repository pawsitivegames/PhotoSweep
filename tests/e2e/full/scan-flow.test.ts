/** Signed-in Google scan only; requires an explicit installation and tiny synthetic oracle. */
import fs from "node:fs"
import { expect, test } from "@playwright/test"

import { assertEmptyLiveReviewState, connectToChrome, readLocalStorage } from "../fixtures/extension"
import { liveScanMatchesFixture, parseLiveScanFixture } from "../fixtures/live-scan-contract"

test.setTimeout(600_000)

test("connects to Google Photos and completes the exact synthetic-album scan", async () => {
  const fixturePath = process.env.PHOTOSWEEP_E2E_FIXTURE_MANIFEST
  if (!fixturePath || process.env.GPD_E2E_SYNTHETIC_FIXTURE !== "1") {
    throw new Error("Set PHOTOSWEEP_E2E_FIXTURE_MANIFEST and GPD_E2E_SYNTHETIC_FIXTURE=1 for a reviewed tiny synthetic album.")
  }
  const fixture = parseLiveScanFixture(JSON.parse(fs.readFileSync(fixturePath, "utf8")))
  if (process.env.GPD_E2E_ALBUM_TITLE !== fixture.albumTitle ||
      process.env.GPD_E2E_DATE_FROM || process.env.GPD_E2E_DATE_TO) {
    throw new Error("The configured synthetic album must match its oracle; date/library fallback is not allowed.")
  }
  const { browser, context, extensionId } = await connectToChrome()
  let gpPage: Awaited<ReturnType<typeof context.newPage>> | undefined
  let appPage: Awaited<ReturnType<typeof context.newPage>> | undefined
  try {
    // Never reset an installed extension's settings, licenses, consent or review.
    // A dedicated empty review target avoids overwriting an owner's prior work.
    await assertEmptyLiveReviewState(context)
    if (context.pages().some((page) => page.url().startsWith(`chrome-extension://${extensionId}/tabs/`))) {
      throw new Error("Close the selected test installation's existing app panels before running live automation.")
    }
    gpPage = await context.newPage()
    await gpPage.goto("https://photos.google.com")
    if (new URL(gpPage.url()).hostname !== "photos.google.com") {
      throw new Error("Google Photos sign-in is required in the configured Chrome profile.")
    }
    appPage = await context.newPage()
    await appPage.goto(`chrome-extension://${extensionId}/tabs/scanner-panel.html`)
    const disclosure = appPage.getByRole("button", { name: "I understand, continue", exact: true })
    const source = appPage.getByRole("combobox", { name: "Photo source", exact: true })
    await expect(source.or(disclosure)).toBeVisible({ timeout: 20_000 })
    if (await disclosure.isVisible()) await disclosure.click()
    await expect(source).toHaveText("Google Photos")
    const area = appPage.getByRole("combobox", { name: "Library area", exact: true })
    await expect(area).toBeVisible({ timeout: 30_000 })
    await area.click()
    await appPage.getByRole("option", { name: fixture.albumTitle, exact: true }).click()
    await expect.poll(() => area.evaluate((el, expected) =>
      (el.parentElement?.querySelector("input") as HTMLInputElement | null)?.value === expected,
      fixture.albumId
    )).toBe(true)
    await appPage.getByRole("button", { name: /Scan options/ }).click()
    await appPage.getByLabel("From", { exact: true }).fill("")
    await appPage.getByLabel("To", { exact: true }).fill("")
    const scan = appPage.getByRole("button", { name: "Scan this album", exact: true })
    await expect(scan).toBeEnabled()
    await scan.click()
    // A tiny fixture can finish before a transient progress label is observed.
    await expect(appPage.getByText(/Scan complete ·/)).toBeVisible({ timeout: 300_000 })
    await expect.poll(async () => {
      const saved = await readLocalStorage(context, ["scanResults"])
      return liveScanMatchesFixture(saved.scanResults, fixture)
    }, { timeout: 15_000, message: "Synthetic album count/membership/group oracle must match" }).toBe(true)
    test.info().annotations.push({ type: "live-scope", description: "Reviewed synthetic Google album; exact scope ID/count/groups checked; scan only" })
  } finally {
    // Only pages opened by this test are closed. Pause an unfinished owned scan
    // before disconnecting; preserve any synthetic checkpoint for diagnosis.
    try {
      if (appPage && !appPage.isClosed()) {
        const pause = appPage.getByRole("button", { name: "Pause Scan", exact: true })
        if (await pause.isVisible()) {
          await pause.click()
          await expect(pause).not.toBeVisible({ timeout: 30_000 })
        }
      }
    } finally {
      await appPage?.close()
      await gpPage?.close()
      await browser.close()
    }
  }
})
