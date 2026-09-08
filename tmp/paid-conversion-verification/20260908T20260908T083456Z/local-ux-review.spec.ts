import path from "path"
import { expect, test, type BrowserContext, type Page } from "@playwright/test"

import {
  clearStorage,
  injectEntitlement,
  injectScanResults,
  injectSelections,
  launchExtension,
  makeGroups,
  openAppTab,
  openGptkStubPage
} from "../../../tests/e2e/fixtures/extension"

const evidenceDir = path.resolve(__dirname)

let context: BrowserContext
let extensionId: string

test.beforeAll(async () => {
  ;({ context, extensionId } = await launchExtension())
})

test.afterAll(async () => {
  await context.close()
})

async function assertDialogFitsViewport(
  page: Page,
  label: string
): Promise<void> {
  const metrics = await page.evaluate(() => {
    const visible = (element: Element): boolean => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0
      )
    }
    const dialog = Array.from(
      document.querySelectorAll('[role="dialog"]')
    ).find(visible)
    if (!dialog) return { error: "no visible dialog" }
    const paper = dialog.querySelector(".MuiDialog-paper")
    const rect = (paper ?? dialog).getBoundingClientRect()
    const controls = Array.from(
      dialog.querySelectorAll("button, input, [role='button']")
    )
      .filter(visible)
      .map((element) => {
        const bounds = element.getBoundingClientRect()
        return {
          name:
            element.getAttribute("aria-label") || element.textContent?.trim(),
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom
        }
      })
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      paper: {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      },
      controls
    }
  })

  expect(metrics, `${label}: dialog metrics`).not.toHaveProperty("error")
  expect(
    metrics.documentScrollWidth,
    `${label}: document horizontal overflow`
  ).toBeLessThanOrEqual(metrics.viewport.width + 1)
  expect(
    metrics.bodyScrollWidth,
    `${label}: body horizontal overflow`
  ).toBeLessThanOrEqual(metrics.viewport.width + 1)
  expect(
    metrics.paper.left,
    `${label}: dialog left edge`
  ).toBeGreaterThanOrEqual(-1)
  expect(
    metrics.paper.right,
    `${label}: dialog right edge`
  ).toBeLessThanOrEqual(metrics.viewport.width + 1)
  for (const control of metrics.controls) {
    expect(
      control.left,
      `${label}: ${control.name} left edge`
    ).toBeGreaterThanOrEqual(-1)
    expect(
      control.right,
      `${label}: ${control.name} right edge`
    ).toBeLessThanOrEqual(metrics.viewport.width + 1)
  }
}

async function activeElementSummary(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement
    return {
      tag: element?.tagName,
      role: element?.getAttribute("role"),
      ariaLabel: element?.getAttribute("aria-label"),
      text: element?.textContent?.trim()
    }
  })
}

test("upgrade scope copy, plan comparison, responsive bounds, and keyboard free exit", async () => {
  await clearStorage(context)
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
    const trigger = page.getByRole("button", {
      name: /Review & move 12 to Trash/i
    })
    await trigger.click()
    const dialog = page.getByRole("dialog")
    await expect(
      dialog.getByRole("heading", { name: "Unlock larger cleanup" })
    ).toBeVisible()

    const copy = await dialog.innerText()
    expect(copy).toContain("Scope:")
    expect(copy).toContain("12 items selected for cleanup")
    expect(copy).toContain("Trash moves remaining this session")
    expect(copy).toContain("Mini Cleanup")
    expect(copy).toContain("Cleanup Pass")
    expect(copy).toContain("Lifetime Early Access")
    expect(copy).toContain("One-time payments through Stripe")
    expect(copy).toContain("Purchase email")
    expect(copy).toContain("Recover")
    expect(copy).toContain("Keep reviewing free results")
    expect(copy).not.toMatch(
      /free up|storage saved|entire library[^ ]* coverage|guarantee/i
    )

    for (const plan of [
      /Choose Mini Cleanup for \$2\.99 USD/i,
      /Choose Cleanup Pass for \$4\.99 USD/i,
      /Choose Lifetime Early Access for \$14\.99 USD/i
    ]) {
      await expect(dialog.getByRole("button", { name: plan })).toBeVisible()
    }

    await page.setViewportSize({ width: 360, height: 800 })
    await expect(dialog).toBeVisible()
    console.log(
      "upgrade-narrow-metrics",
      await page.evaluate(() => {
        const paper = document.querySelector<HTMLElement>(".MuiDialog-paper")
        const content = document.querySelector<HTMLElement>(
          ".MuiDialogContent-root"
        )
        const buttons = Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"] button')
        ).map((button) => {
          const rect = button.getBoundingClientRect()
          return {
            name:
              button.getAttribute("aria-label") || button.textContent?.trim(),
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height
          }
        })
        return {
          viewportHeight: window.innerHeight,
          paperClientHeight: paper?.clientHeight,
          paperScrollHeight: paper?.scrollHeight,
          paperScrollTop: paper?.scrollTop,
          paperOverflowY: paper ? getComputedStyle(paper).overflowY : undefined,
          contentClientHeight: content?.clientHeight,
          contentScrollHeight: content?.scrollHeight,
          contentScrollTop: content?.scrollTop,
          contentOverflowY: content
            ? getComputedStyle(content).overflowY
            : undefined,
          buttons
        }
      })
    )
    const dialogContent = page.locator(".MuiDialogContent-root").first()
    await dialogContent.hover()
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(250)
    console.log(
      "upgrade-narrow-after-wheel",
      await page.evaluate(() => {
        const paper = document.querySelector<HTMLElement>(".MuiDialog-paper")
        const content = document.querySelector<HTMLElement>(
          ".MuiDialogContent-root"
        )
        const names = [
          "Choose Cleanup Pass for $4.99 USD",
          "Choose Mini Cleanup for $2.99 USD",
          "Recover"
        ]
        const buttons = Array.from(
          document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')
        )
          .filter((button) =>
            names.includes(
              button.getAttribute("aria-label") ||
                button.textContent?.trim() ||
                ""
            )
          )
          .map((button) => {
            const rect = button.getBoundingClientRect()
            return {
              name:
                button.getAttribute("aria-label") || button.textContent?.trim(),
              top: rect.top,
              bottom: rect.bottom
            }
          })
        return {
          paperScrollTop: paper?.scrollTop,
          contentScrollTop: content?.scrollTop,
          paperScrollHeight: paper?.scrollHeight,
          contentScrollHeight: content?.scrollHeight,
          buttons
        }
      })
    )
    await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>(
        ".MuiDialogContent-root"
      )
      if (content) content.scrollTop = 0
    })
    await dialog
      .getByRole("button", { name: /Choose Lifetime Early Access/ })
      .focus()
    const tabStops: Array<{
      ariaLabel: string | null
      text: string | undefined
      contentScrollTop: number | undefined
    }> = []
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press("Tab")
      tabStops.push(
        await page.evaluate(() => {
          const content = document.querySelector<HTMLElement>(
            ".MuiDialogContent-root"
          )
          const active = document.activeElement
          return {
            ariaLabel: active?.getAttribute("aria-label"),
            text: active?.textContent?.trim(),
            contentScrollTop: content?.scrollTop
          }
        })
      )
    }
    console.log("upgrade-narrow-tab-stops", tabStops)
    expect(
      tabStops.some((stop) => stop.ariaLabel?.includes("Choose Cleanup Pass"))
    ).toBe(true)
    expect(
      tabStops.some((stop) => stop.ariaLabel?.includes("Choose Mini Cleanup"))
    ).toBe(true)
    await assertDialogFitsViewport(page, "upgrade-narrow")
    await page.screenshot({
      path: path.join(evidenceDir, "upgrade-dialog-narrow.png"),
      fullPage: true
    })
    await page.screenshot({
      path: path.join(evidenceDir, "upgrade-dialog-narrow-viewport.png"),
      fullPage: false
    })

    await page.setViewportSize({ width: 1024, height: 900 })
    await assertDialogFitsViewport(page, "upgrade-wide")
    await page.screenshot({
      path: path.join(evidenceDir, "upgrade-dialog-wide.png"),
      fullPage: true
    })
    await page.screenshot({
      path: path.join(evidenceDir, "upgrade-dialog-wide-viewport.png"),
      fullPage: false
    })

    await dialog
      .getByRole("button", { name: "Keep reviewing free results" })
      .focus()
    expect((await activeElementSummary(page)).text).toContain(
      "Keep reviewing free results"
    )
    await page.keyboard.press("Enter")
    await expect(dialog).not.toBeVisible()
    expect((await activeElementSummary(page)).text).toMatch(
      /Review & move 12 to Trash/i
    )

    await trigger.click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(dialog).not.toBeVisible()
    expect((await activeElementSummary(page)).text).toMatch(
      /Review & move 12 to Trash/i
    )
  } finally {
    await page.close()
    await stub.close()
    await clearStorage(context)
  }
})

test("positive cleanup rating copy offers honest review and feedback", async () => {
  await clearStorage(context)
  await injectEntitlement(context, "lifetime")
  const { groups, mediaItems } = makeGroups(3, 2)
  await injectScanResults(
    context,
    groups,
    mediaItems,
    Object.keys(mediaItems).length,
    "test@example.com"
  )

  const stub = await openGptkStubPage(context)
  const page = await openAppTab(context, extensionId)
  try {
    await expect(
      page.getByRole("heading", {
        name: "3 Duplicate Sets to Review",
        exact: true
      })
    ).toBeVisible({ timeout: 8_000 })
    await page.getByRole("button", { name: /^Include all(?: sets)?$/i }).click()
    await page
      .getByRole("button", { name: /Review & move 3 to Trash/i })
      .click()
    await expect(
      page.getByRole("heading", { name: "Move to Trash" })
    ).toBeVisible()
    await page.getByLabel("Type 3 to confirm").fill("3")
    await page
      .getByRole("button", { name: /^Move to Trash$/i })
      .last()
      .click()
    await expect(page.getByText(/moved to trash/i)).toBeVisible({
      timeout: 10_000
    })
    await page
      .getByRole("button", { name: "Dismiss undo notification" })
      .click()

    const dialog = page.getByRole("dialog")
    await expect(
      dialog.getByRole("heading", { name: "How was your PhotoSweep cleanup?" })
    ).toBeVisible()
    const copy = await dialog.innerText()
    expect(copy).toContain(
      "Whether everything worked well or something could be better"
    )
    expect(copy).toContain("honest public review")
    expect(copy).toContain("Send feedback")
    expect(copy).toContain("Maybe later")
    expect(copy).toContain("Don't ask again")
    expect(copy).not.toMatch(/five stars|love it|satisfied|positive review/i)

    await page.setViewportSize({ width: 360, height: 800 })
    await assertDialogFitsViewport(page, "rating-narrow")
    await page.screenshot({
      path: path.join(evidenceDir, "rating-dialog-narrow.png"),
      fullPage: true
    })
    await page.screenshot({
      path: path.join(evidenceDir, "rating-dialog-narrow-viewport.png"),
      fullPage: false
    })
    await page.setViewportSize({ width: 1024, height: 900 })
    await assertDialogFitsViewport(page, "rating-wide")
    await page.screenshot({
      path: path.join(evidenceDir, "rating-dialog-wide.png"),
      fullPage: true
    })
    await page.screenshot({
      path: path.join(evidenceDir, "rating-dialog-wide-viewport.png"),
      fullPage: false
    })
  } finally {
    await page.close()
    await stub.close()
    await clearStorage(context)
  }
})
