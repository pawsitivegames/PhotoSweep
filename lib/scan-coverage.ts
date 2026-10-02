import type { ScanCoverage } from "./types"

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

/**
 * Runtime validation for coverage reported across the provider-page message
 * seam. In particular, only exhausted provider traversal may claim complete.
 */
export function isScanCoverage(value: unknown): value is ScanCoverage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const coverage = value as Record<string, unknown>
  const mediaTypes = coverage.mediaTypesCovered

  if (
    !isNonnegativeSafeInteger(coverage.itemsVisited) ||
    !isNonnegativeSafeInteger(coverage.itemsReturned) ||
    !isNonnegativeSafeInteger(coverage.itemsSkipped) ||
    !isNonnegativeSafeInteger(coverage.unknownDateItemsSkipped) ||
    (coverage.unmappedItemsSkipped !== undefined &&
      (!isNonnegativeSafeInteger(coverage.unmappedItemsSkipped) ||
        (coverage.unmappedItemsSkipped as number) >
          (coverage.itemsSkipped as number))) ||
    (coverage.itemsReturned as number) + (coverage.itemsSkipped as number) !==
      (coverage.itemsVisited as number) ||
    (coverage.unknownDateItemsSkipped as number) >
      (coverage.itemsSkipped as number) ||
    typeof coverage.canResume !== "boolean" ||
    (coverage.pagesRead !== undefined &&
      (!isNonnegativeSafeInteger(coverage.pagesRead) ||
        (coverage.pagesRead as number) === 0)) ||
    (coverage.pageSizes !== undefined &&
      (!Array.isArray(coverage.pageSizes) ||
        coverage.pageSizes.length === 0 ||
        !coverage.pageSizes.every(isNonnegativeSafeInteger) ||
        (coverage.pagesRead !== undefined &&
          coverage.pageSizes.length !== coverage.pagesRead))) ||
    (coverage.totalItems !== undefined &&
      !isNonnegativeSafeInteger(coverage.totalItems)) ||
    !mediaTypes ||
    typeof mediaTypes !== "object" ||
    Array.isArray(mediaTypes) ||
    typeof (mediaTypes as Record<string, unknown>).photos !== "boolean" ||
    typeof (mediaTypes as Record<string, unknown>).videos !== "boolean"
  ) {
    return false
  }

  if (coverage.status === "complete") {
    return (
      (coverage.stopReason === "exhausted" ||
        coverage.stopReason === "watermark_reached" ||
        coverage.stopReason === "changes_caught_up") &&
      coverage.canResume === false
    )
  }

  if (coverage.status === "partial") {
    return (
      coverage.stopReason === "user_limit" ||
      coverage.stopReason === "cancelled" ||
      coverage.stopReason === "loaded_items_only" ||
      coverage.stopReason === "auth_expired" ||
      coverage.stopReason === "provider_error" ||
      coverage.stopReason === "pagination_error" ||
      coverage.stopReason === "coverage_unknown"
    )
  }

  if (coverage.status === "failed") {
    return (
      coverage.stopReason === "auth_expired" ||
      coverage.stopReason === "provider_error" ||
      coverage.stopReason === "pagination_error"
    )
  }

  return false
}
