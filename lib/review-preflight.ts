import type { PhotoProvider, ScanSettings } from "./types"

/**
 * A destructive action must be tied to the same provider, account, and scan
 * scope that produced the review.  The provider adapters intentionally expose
 * an account identity only where the provider makes one available, so an
 * unavailable identity is represented explicitly instead of being treated as
 * a match.
 */
export const REVIEW_PREFLIGHT_MAX_AGE_MS = 24 * 60 * 60 * 1000

export type ReviewPreflightReasonCode =
  | "no_selection"
  | "connection_unverified"
  | "provider_mismatch"
  | "account_mismatch"
  | "account_unknown"
  | "scan_date_unknown"
  | "scan_stale"
  | "scope_unknown"
  | "scope_changed"

export interface ReviewPreflightReason {
  code: ReviewPreflightReasonCode
  message: string
}

export interface ReviewPreflightResult {
  allowed: boolean
  accountStatus: "verified" | "unavailable" | "mismatch" | "unknown"
  freshness: "fresh" | "stale" | "unknown"
  scopeStatus: "matched" | "changed" | "unknown"
  summary: string
  reasons: ReviewPreflightReason[]
}

export interface ReviewPreflightInput {
  scanProvider?: PhotoProvider | string
  currentProvider?: PhotoProvider | string
  scanAccountEmail?: string
  currentAccountEmail?: string
  scanDate?: number
  scanScopeFingerprint?: string
  currentScopeFingerprint?: string
  selectedCount: number
  connectionValidated: boolean
  /** iCloud and Amazon currently do not expose a stable account email. */
  allowUnavailableAccountIdentity?: boolean
  requireFreshScan?: boolean
  requireKnownScope?: boolean
  now?: number
  maxAgeMs?: number
}

function normalizedProvider(value: string | undefined): string {
  return value || "google"
}

function normalizedEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized || undefined
}

function accountStatusFor(
  input: ReviewPreflightInput
): ReviewPreflightResult["accountStatus"] {
  const scanAccount = normalizedEmail(input.scanAccountEmail)
  const currentAccount = normalizedEmail(input.currentAccountEmail)
  if (scanAccount && currentAccount) {
    return scanAccount === currentAccount ? "verified" : "mismatch"
  }
  if (scanAccount || currentAccount) return "unknown"
  return input.allowUnavailableAccountIdentity ? "unavailable" : "unknown"
}

function freshnessFor(
  scanDate: number | undefined,
  now: number,
  maxAgeMs: number
): ReviewPreflightResult["freshness"] {
  if (typeof scanDate !== "number" || !Number.isFinite(scanDate)) {
    return "unknown"
  }
  if (scanDate > now || now - scanDate < 0) return "unknown"
  return now - scanDate <= maxAgeMs ? "fresh" : "stale"
}

function scopeStatusFor(
  scanScopeFingerprint: string | undefined,
  currentScopeFingerprint: string | undefined
): ReviewPreflightResult["scopeStatus"] {
  if (!scanScopeFingerprint || !currentScopeFingerprint) return "unknown"
  return scanScopeFingerprint === currentScopeFingerprint
    ? "matched"
    : "changed"
}

function reason(
  code: ReviewPreflightReasonCode,
  message: string
): ReviewPreflightReason {
  return { code, message }
}

export function buildScanScopeFingerprint(settings: ScanSettings): string {
  const provider = normalizedProvider(settings.sourceProvider)
  const dateRange = settings.dateRange
    ? {
        from: settings.dateRange.from ?? null,
        to: settings.dateRange.to ?? null
      }
    : null
  const album = settings.albumScope
    ? {
        mediaKey: settings.albumScope.mediaKey,
        title: settings.albumScope.title ?? null
      }
    : null

  return JSON.stringify({
    provider,
    scanMode: settings.scanMode,
    similarityThreshold: settings.similarityThreshold,
    smartWindowSec: settings.smartWindowSec ?? 1,
    dateRange,
    album,
    amazonBatchLimit: settings.amazonBatchLimit ?? null,
    icloudBatchLimit: settings.icloudBatchLimit ?? null,
    exactOnly: settings.exactOnly ?? false
  })
}

export function evaluateReviewPreflight(
  input: ReviewPreflightInput
): ReviewPreflightResult {
  const scanProvider = normalizedProvider(input.scanProvider)
  const currentProvider = normalizedProvider(input.currentProvider)
  const accountStatus = accountStatusFor(input)
  const freshness = freshnessFor(
    input.scanDate,
    input.now ?? Date.now(),
    input.maxAgeMs ?? REVIEW_PREFLIGHT_MAX_AGE_MS
  )
  const scopeStatus = scopeStatusFor(
    input.scanScopeFingerprint,
    input.currentScopeFingerprint
  )
  const reasons: ReviewPreflightReason[] = []

  if (!input.connectionValidated) {
    reasons.push(
      reason(
        "connection_unverified",
        "The current photo-provider connection has not passed a fresh health check."
      )
    )
  }
  if (input.selectedCount <= 0) {
    reasons.push(reason("no_selection", "No reviewed items are selected."))
  }
  if (scanProvider !== currentProvider) {
    reasons.push(
      reason(
        "provider_mismatch",
        `These results belong to ${scanProvider}, but the active provider is ${currentProvider}.`
      )
    )
  }
  if (accountStatus === "mismatch") {
    reasons.push(
      reason(
        "account_mismatch",
        "The signed-in photo-provider account changed since this scan."
      )
    )
  } else if (accountStatus === "unknown" || accountStatus === "unavailable") {
    reasons.push(
      reason(
        "account_unknown",
        "The scan and current provider session do not expose enough account identity to prove they match."
      )
    )
  }
  if (freshness === "unknown") {
    if (input.requireFreshScan) {
      reasons.push(
        reason(
          "scan_date_unknown",
          "The scan age is unknown. Run a fresh scoped scan before changing provider state."
        )
      )
    }
  } else if (freshness === "stale" && input.requireFreshScan) {
    reasons.push(
      reason(
        "scan_stale",
        "These results are more than a day old. Run a fresh scoped scan before changing provider state."
      )
    )
  }
  if (scopeStatus === "unknown" && input.requireKnownScope) {
    reasons.push(
      reason(
        "scope_unknown",
        "The reviewed scope cannot be proven to match the current scan settings. Run the scan again."
      )
    )
  } else if (scopeStatus === "changed") {
    reasons.push(
      reason(
        "scope_changed",
        "The scan settings or library scope changed after these results were created."
      )
    )
  }

  const blockingReasons = reasons.filter((current) => {
    if (
      current.code === "account_unknown" &&
      input.allowUnavailableAccountIdentity
    ) {
      return false
    }
    if (current.code === "scan_date_unknown" || current.code === "scan_stale") {
      return Boolean(input.requireFreshScan)
    }
    if (current.code === "scope_unknown") {
      return Boolean(input.requireKnownScope)
    }
    return true
  })

  const accountSummary =
    accountStatus === "verified"
      ? "account verified"
      : accountStatus === "unavailable"
        ? "account identity unavailable"
        : accountStatus === "unknown"
          ? "account identity unverified"
          : "account mismatch"
  const scopeSummary =
    scopeStatus === "matched"
      ? "scope matched"
      : scopeStatus === "unknown"
        ? "scope unverified"
        : "scope changed"
  const summary = `${scanProvider} · ${input.selectedCount.toLocaleString()} selected · ${accountSummary} · ${scopeSummary}`

  return {
    allowed: blockingReasons.length === 0,
    accountStatus,
    freshness,
    scopeStatus,
    summary,
    reasons
  }
}

export function accountFingerprint(
  email: string | undefined
): string | undefined {
  const normalized = normalizedEmail(email)
  if (!normalized) return undefined
  let hash = 2166136261
  for (let index = 0; index < normalized.length; index++) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `account-${(hash >>> 0).toString(16)}`
}

export function evaluateRecoveryRestorePreflight(input: {
  recordProvider: PhotoProvider
  currentProvider?: PhotoProvider
  recordAccountFingerprint?: string
  currentAccountEmail?: string
  connectionValidated: boolean
}): ReviewPreflightResult {
  const currentAccountFingerprint = accountFingerprint(
    input.currentAccountEmail
  )
  const reasons: ReviewPreflightReason[] = []
  if (!input.connectionValidated) {
    reasons.push(
      reason(
        "connection_unverified",
        "The current photo-provider connection has not passed a fresh health check."
      )
    )
  }
  if (input.recordProvider !== (input.currentProvider ?? "google")) {
    reasons.push(
      reason(
        "provider_mismatch",
        "The recovery record belongs to a different photo provider."
      )
    )
  }
  if (input.recordAccountFingerprint) {
    if (!currentAccountFingerprint) {
      reasons.push(
        reason(
          "account_unknown",
          "The provider has not exposed the account needed to verify this recovery record."
        )
      )
    } else if (input.recordAccountFingerprint !== currentAccountFingerprint) {
      reasons.push(
        reason(
          "account_mismatch",
          "This recovery record belongs to a different provider account."
        )
      )
    }
  }
  const blockingReasons = reasons.filter(
    (current) =>
      current.code !== "account_unknown" || input.recordProvider === "google"
  )
  const accountStatus = input.recordAccountFingerprint
    ? currentAccountFingerprint
      ? input.recordAccountFingerprint === currentAccountFingerprint
        ? "verified"
        : "mismatch"
      : "unknown"
    : "unavailable"
  return {
    allowed: blockingReasons.length === 0,
    accountStatus,
    freshness: "unknown",
    scopeStatus: "unknown",
    summary: `${input.recordProvider} recovery · ${
      accountStatus === "verified"
        ? "account verified"
        : "account identity unavailable"
    }`,
    reasons
  }
}
