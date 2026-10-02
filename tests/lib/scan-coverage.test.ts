import { describe, expect, it } from "vitest"

import { isScanCoverage } from "../../lib/scan-coverage"
import type { ScanCoverage } from "../../lib/types"

const completeCoverage: ScanCoverage = {
  status: "complete",
  stopReason: "exhausted",
  itemsVisited: 2,
  itemsReturned: 2,
  itemsSkipped: 0,
  unknownDateItemsSkipped: 0,
  mediaTypesCovered: { photos: true, videos: true },
  canResume: false
}

describe("scan coverage contract", () => {
  it("accepts a fully exhausted scan with nonnegative counts", () => {
    expect(isScanCoverage(completeCoverage)).toBe(true)
  })

  it("accepts page diagnostics only when they reconcile with the page count", () => {
    expect(
      isScanCoverage({
        ...completeCoverage,
        pagesRead: 2,
        pageSizes: [200, 26]
      })
    ).toBe(true)
    expect(
      isScanCoverage({
        ...completeCoverage,
        pagesRead: 2,
        pageSizes: [200]
      })
    ).toBe(false)
    expect(
      isScanCoverage({
        ...completeCoverage,
        pagesRead: 0,
        pageSizes: []
      })
    ).toBe(false)
  })

  it("accepts a completed incremental window stopped at its cached watermark", () => {
    expect(
      isScanCoverage({
        ...completeCoverage,
        stopReason: "watermark_reached"
      })
    ).toBe(true)
  })

  it("accepts a fully applied change-token window as complete coverage", () => {
    expect(
      isScanCoverage({
        ...completeCoverage,
        stopReason: "changes_caught_up",
        pagesRead: 2
      })
    ).toBe(true)
  })

  it("accepts a loaded-items fallback only as partial coverage", () => {
    expect(
      isScanCoverage({
        ...completeCoverage,
        status: "partial",
        stopReason: "loaded_items_only",
        mediaTypesCovered: { photos: true, videos: false }
      })
    ).toBe(true)
  })

  it("accepts explicit unknown-date and resumability accounting", () => {
    expect(
      isScanCoverage({
        ...completeCoverage,
        status: "partial",
        stopReason: "user_limit",
        itemsVisited: 4,
        itemsReturned: 2,
        itemsSkipped: 2,
        unknownDateItemsSkipped: 1,
        canResume: true,
        totalItems: 8
      })
    ).toBe(true)
  })

  it("rejects a partial fallback labeled complete", () => {
    expect(
      isScanCoverage({
        ...completeCoverage,
        stopReason: "loaded_items_only"
      })
    ).toBe(false)
  })

  it("rejects impossible count arithmetic and malformed media coverage", () => {
    expect(isScanCoverage({ ...completeCoverage, itemsReturned: 3 })).toBe(
      false
    )
    expect(
      isScanCoverage({
        ...completeCoverage,
        mediaTypesCovered: { photos: true, videos: "unknown" }
      })
    ).toBe(false)
    expect(
      isScanCoverage({
        ...completeCoverage,
        itemsVisited: 3
      })
    ).toBe(false)
    expect(
      isScanCoverage({
        ...completeCoverage,
        unknownDateItemsSkipped: 1
      })
    ).toBe(false)
    expect(
      isScanCoverage({
        ...completeCoverage,
        canResume: undefined
      })
    ).toBe(false)
    expect(
      isScanCoverage({
        ...completeCoverage,
        canResume: true
      })
    ).toBe(false)
  })

  it("accepts provider failures only with a failed or partial status", () => {
    expect(
      isScanCoverage({
        ...completeCoverage,
        status: "failed",
        stopReason: "pagination_error",
        itemsVisited: 0,
        itemsReturned: 0,
        itemsSkipped: 0
      })
    ).toBe(true)
    expect(
      isScanCoverage({
        ...completeCoverage,
        status: "complete",
        stopReason: "provider_error"
      })
    ).toBe(false)
  })
})
