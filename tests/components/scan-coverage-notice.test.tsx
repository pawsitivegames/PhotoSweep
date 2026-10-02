import { ThemeProvider } from "@mui/material/styles"
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ScanCoverageNotice } from "../../components/ScanCoverageNotice"
import theme from "../../lib/theme"
import type { ScanCoverage } from "../../lib/types"

const loadedItemsCoverage: ScanCoverage = {
  status: "partial",
  stopReason: "loaded_items_only",
  itemsVisited: 12,
  itemsReturned: 9,
  itemsSkipped: 3,
  unknownDateItemsSkipped: 2,
  mediaTypesCovered: { photos: true, videos: false },
  canResume: false
}

function expectCoverageCount(label: string, value: number) {
  const labelNode = screen.getByText(label, { exact: true })
  const metricCell = labelNode.parentElement

  expect(metricCell).not.toBeNull()
  expect(
    within(metricCell as HTMLElement).getByText(value.toLocaleString(), {
      exact: true
    })
  ).toBeInTheDocument()
}

describe("scan coverage notice", () => {
  it("explains that all provider changes were applied", () => {
    const changesCoverage: ScanCoverage = {
      status: "complete",
      stopReason: "changes_caught_up",
      itemsVisited: 2,
      itemsReturned: 2,
      itemsSkipped: 0,
      unknownDateItemsSkipped: 0,
      totalItems: 40,
      pagesRead: 2,
      mediaTypesCovered: { photos: true, videos: true },
      canResume: false
    }
    render(
      <ThemeProvider theme={theme}>
        <ScanCoverageNotice coverage={changesCoverage} />
      </ThemeProvider>
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "All provider changes since the last scan were applied; cached results are included in this review."
    )
  })

  it("[PARITY-05] clearly labels loaded-only results and reports common coverage counts", () => {
    render(
      <ThemeProvider theme={theme}>
        <ScanCoverageNotice coverage={loadedItemsCoverage} />
      </ThemeProvider>
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Only items already loaded on the iCloud page were available; full-library coverage is unknown."
    )
    expectCoverageCount("Examined", 12)
    expectCoverageCount("In scope", 9)
    expectCoverageCount("Skipped", 3)
    expect(screen.getByRole("alert")).toHaveTextContent(
      "2 items had missing or invalid dates."
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "photos covered; videos not covered"
    )
  })

  it("warns when a saved scan predates coverage reporting", () => {
    render(
      <ThemeProvider theme={theme}>
        <ScanCoverageNotice />
      </ThemeProvider>
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Scan coverage was not recorded"
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Run a fresh scan to confirm whether the full library or requested scope was examined."
    )
  })

  it("explains when an authentication failure stopped the scan", () => {
    const failedCoverage: ScanCoverage = {
      status: "failed",
      stopReason: "auth_expired",
      itemsVisited: 4,
      itemsReturned: 0,
      itemsSkipped: 4,
      unknownDateItemsSkipped: 0,
      mediaTypesCovered: { photos: true, videos: true },
      canResume: false
    }
    render(
      <ThemeProvider theme={theme}>
        <ScanCoverageNotice coverage={failedCoverage} />
      </ThemeProvider>
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The provider session expired before the scan completed."
    )
    expectCoverageCount("Examined", 4)
    expectCoverageCount("In scope", 0)
    expectCoverageCount("Skipped", 4)
  })

  it("labels a paused scan as incomplete", () => {
    const cancelledCoverage: ScanCoverage = {
      status: "partial",
      stopReason: "cancelled",
      itemsVisited: 3,
      itemsReturned: 2,
      itemsSkipped: 1,
      unknownDateItemsSkipped: 0,
      mediaTypesCovered: { photos: true, videos: true },
      canResume: false
    }
    render(
      <ThemeProvider theme={theme}>
        <ScanCoverageNotice coverage={cancelledCoverage} />
      </ThemeProvider>
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The scan stopped before the provider scope was exhausted."
    )
    expectCoverageCount("Examined", 3)
    expectCoverageCount("In scope", 2)
    expectCoverageCount("Skipped", 1)
  })
})
