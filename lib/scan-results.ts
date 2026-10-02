import type { GpdMediaItem, ScanCoverage } from "./types"
import { isScanCoverage } from "./scan-coverage"

/**
 * Returns true if stored scan results are valid for the given context.
 * Used by both the UI (mount load, incremental cache) and the reducer
 * (health check) so future invalidation conditions only need to be added here.
 */
export function areScanResultsValid(
  stored: {
    accountEmail?: string
    sourceProvider?: string
    providerSessionId?: string
  },
  context: {
    accountEmail?: string
    sourceProvider?: string
    providerSessionId?: string
  }
): boolean {
  const storedProvider = stored.sourceProvider ?? "google"
  const contextProvider = context.sourceProvider ?? "google"
  if (storedProvider !== contextProvider) return false
  if (storedProvider !== "google") {
    // iCloud and Amazon do not expose a stable account identifier in the
    // current adapters. Their persisted results are valid only in the exact
    // provider page session that produced them.
    if (
      !stored.providerSessionId ||
      !context.providerSessionId ||
      stored.providerSessionId !== context.providerSessionId
    ) {
      return false
    }
  }
  // Once the current account is known, unknown-account saved results are not
  // safe to reuse for review/trash actions. Apply this uniformly so a future
  // provider adapter cannot accidentally inherit Google-only behavior.
  if (!stored.accountEmail && context.accountEmail) return false
  // Account mismatch: results belong to a different account.
  if (
    stored.accountEmail &&
    context.accountEmail &&
    stored.accountEmail.trim().toLowerCase() !==
      context.accountEmail.trim().toLowerCase()
  )
    return false
  return true
}

/**
 * Return a reusable iCloud zone cursor only with the complete library snapshot
 * and provider page session that produced it. Scoped, partial, or cross-session
 * results must bootstrap with a full read-only scan.
 */
export function reusableICloudSyncToken(
  stored: {
    accountEmail?: string
    sourceProvider?: string
    providerSessionId?: string
    providerSyncToken?: string
    mediaItems?: Record<string, GpdMediaItem>
    totalItems?: number
    mediaItemsAreComplete?: boolean
    scanCoverage?: ScanCoverage
    dateRange?: unknown
    albumScope?: unknown
  },
  context: {
    accountEmail?: string
    sourceProvider?: string
    providerSessionId?: string
  }
): string | undefined {
  if (
    (stored.sourceProvider ?? "google") !== "icloud" ||
    context.sourceProvider !== "icloud" ||
    !areScanResultsValid(stored, context) ||
    stored.mediaItemsAreComplete !== true ||
    !isScanCoverage(stored.scanCoverage) ||
    stored.scanCoverage.status !== "complete" ||
    (stored.scanCoverage.stopReason !== "exhausted" &&
      stored.scanCoverage.stopReason !== "watermark_reached" &&
      stored.scanCoverage.stopReason !== "changes_caught_up") ||
    stored.dateRange != null ||
    stored.albumScope != null ||
    !stored.mediaItems ||
    typeof stored.mediaItems !== "object" ||
    Array.isArray(stored.mediaItems)
  ) {
    return undefined
  }

  const token = stored.providerSyncToken
  return isValidICloudSyncToken(token) ? token : undefined
}

export function isValidICloudSyncToken(token: unknown): token is string {
  return (
    typeof token === "string" &&
    token.length > 0 &&
    token.length <= 4096 &&
    token.trim() === token &&
    !/[\u0000-\u001f\u007f]/.test(token)
  )
}

/**
 * Cached-only records are safe to retain only when the provider explicitly
 * stopped at the cache watermark. A complete exhausted scan is authoritative:
 * records missing from that response may have been deleted upstream and must
 * not be resurrected by a cache merge.
 */
export function shouldMergeCachedScanResults(
  scanCoverage: ScanCoverage | undefined
): boolean {
  return (
    scanCoverage?.status === "complete" &&
    (scanCoverage.stopReason === "watermark_reached" ||
      scanCoverage.stopReason === "changes_caught_up")
  )
}

/**
 * Merge a provider's watermark result with the previous complete cache while
 * preserving provider order and letting newly fetched records replace cached
 * records with the same media key.
 */
export function mergeCachedScanResults(
  fetchedItems: GpdMediaItem[],
  cachedItems: Record<string, GpdMediaItem> | undefined,
  scanCoverage: ScanCoverage | undefined
): GpdMediaItem[] {
  if (!cachedItems || !shouldMergeCachedScanResults(scanCoverage)) {
    return fetchedItems
  }
  const fetchedKeys = new Set(fetchedItems.map((item) => item.mediaKey))
  const cachedOnly = Object.values(cachedItems).filter(
    (item) => !fetchedKeys.has(item.mediaKey)
  )
  return [...fetchedItems, ...cachedOnly]
}
