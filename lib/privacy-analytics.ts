import type { TrashOutcome, RestoreOutcome } from "./trash-lifecycle"
import type { Entitlement } from "./entitlement"
import type {
  ActivationOutcome,
  CheckoutReturnOutcome,
  UpgradeReason
} from "./paid-conversion"
import { isValidInstallId } from "./install-identity"
import type { PhotoProvider, ScanMode } from "./types"

export const ANALYTICS_CONSENT_STORAGE_KEY = "photoSweepAnalyticsConsent"

const ANALYTICS_EVENT_NAMES = new Set<AnalyticsEventName>([
  "app_opened",
  "scan_started",
  "scan_completed",
  "provider_connected",
  "upgrade_prompt_shown",
  "upgrade_prompt_dismissed",
  "checkout_started",
  "paid_return",
  "restore_requested",
  "restore_completed",
  "restore_not_found",
  "entitlement_refreshed",
  "export_clicked",
  "trash_attempted",
  "trash_completed",
  "undo_attempted",
  "undo_completed",
  "error"
])
const ANALYTICS_PROVIDERS = new Set<PhotoProvider>([
  "google",
  "icloud",
  "amazon"
])
const ANALYTICS_SCAN_MODES = new Set<ScanMode>(["smart", "full"])
const ANALYTICS_COUNT_BUCKETS = new Set([
  "0",
  "1-99",
  "0-99",
  "100-999",
  "1k-5k",
  "5k-10k",
  "10k-50k",
  "50k+"
])
const ANALYTICS_ERROR_CATEGORIES = new Set([
  "license_refresh",
  "scan",
  "trash",
  "trash_partial",
  "undo",
  "undo_partial"
])
const ANALYTICS_PLAN_IDS = new Set<Entitlement["planId"]>([
  "free",
  "mini_cleanup",
  "cleanup_pass",
  "lifetime"
])
const ANALYTICS_UPGRADE_REASONS = new Set<UpgradeReason>([
  "scan",
  "groups",
  "trash",
  "export",
  "resume",
  "provider"
])
const ANALYTICS_DISMISSAL_REASONS = new Set(["continue_free", "dismissed"])
const ANALYTICS_PAID_RETURN_OUTCOMES = new Set<CheckoutReturnOutcome>([
  "activated",
  "pending",
  "failed",
  "offline"
])
const ANALYTICS_ACTIVATION_OUTCOMES = new Set<ActivationOutcome>([
  "access_reconciled",
  "restore",
  "not_activated"
])

export type AnalyticsEventName =
  | "app_opened"
  | "scan_started"
  | "scan_completed"
  | "provider_connected"
  | "upgrade_prompt_shown"
  | "upgrade_prompt_dismissed"
  | "checkout_started"
  | "paid_return"
  | "restore_requested"
  | "restore_completed"
  | "restore_not_found"
  | "entitlement_refreshed"
  | "export_clicked"
  | "trash_attempted"
  | "trash_completed"
  | "undo_attempted"
  | "undo_completed"
  | "error"

export interface PrivacySafeAnalyticsEvent {
  name: AnalyticsEventName
  provider?: PhotoProvider
  scanMode?: ScanMode
  planId?: Entitlement["planId"]
  photoCountBucket?: string
  duplicateGroupCountBucket?: string
  errorCategory?: string
  upgradeReason?: UpgradeReason
  dismissalReason?: "continue_free" | "dismissed"
  paidReturnOutcome?: CheckoutReturnOutcome
  activationOutcome?: ActivationOutcome
  installId?: string
  extensionVersion?: string
  dayKey?: string
}

export function countBucket(count: number): string {
  if (count <= 0) return "0"
  if (count < 100) return "1-99"
  if (count < 1000) return "100-999"
  if (count < 5000) return "1k-5k"
  if (count < 10000) return "5k-10k"
  if (count < 50000) return "10k-50k"
  return "50k+"
}

export function buildAnalyticsEvent(
  event: PrivacySafeAnalyticsEvent
): PrivacySafeAnalyticsEvent | undefined {
  const name = optionalAllowed(event.name, ANALYTICS_EVENT_NAMES)
  if (!name) return undefined
  return {
    name,
    provider: optionalAllowed(event.provider, ANALYTICS_PROVIDERS),
    scanMode: optionalAllowed(event.scanMode, ANALYTICS_SCAN_MODES),
    planId: optionalAllowed(event.planId, ANALYTICS_PLAN_IDS),
    photoCountBucket: optionalAllowed(
      event.photoCountBucket,
      ANALYTICS_COUNT_BUCKETS
    ),
    duplicateGroupCountBucket: optionalAllowed(
      event.duplicateGroupCountBucket,
      ANALYTICS_COUNT_BUCKETS
    ),
    errorCategory: optionalAllowed(
      event.errorCategory,
      ANALYTICS_ERROR_CATEGORIES
    ),
    ...(optionalAllowed(event.upgradeReason, ANALYTICS_UPGRADE_REASONS)
      ? {
          upgradeReason: optionalAllowed(
            event.upgradeReason,
            ANALYTICS_UPGRADE_REASONS
          )
        }
      : {}),
    ...(optionalAllowed(event.dismissalReason, ANALYTICS_DISMISSAL_REASONS)
      ? {
          dismissalReason: optionalAllowed(
            event.dismissalReason,
            ANALYTICS_DISMISSAL_REASONS
          )
        }
      : {}),
    ...(optionalAllowed(event.paidReturnOutcome, ANALYTICS_PAID_RETURN_OUTCOMES)
      ? {
          paidReturnOutcome: optionalAllowed(
            event.paidReturnOutcome,
            ANALYTICS_PAID_RETURN_OUTCOMES
          )
        }
      : {}),
    ...(optionalAllowed(event.activationOutcome, ANALYTICS_ACTIVATION_OUTCOMES)
      ? {
          activationOutcome: optionalAllowed(
            event.activationOutcome,
            ANALYTICS_ACTIVATION_OUTCOMES
          )
        }
      : {}),
    ...(optionalInstallId(event.installId)
      ? { installId: optionalInstallId(event.installId) }
      : {}),
    ...(optionalExtensionVersion(event.extensionVersion)
      ? { extensionVersion: optionalExtensionVersion(event.extensionVersion) }
      : {}),
    ...(optionalDayKey(event.dayKey)
      ? { dayKey: optionalDayKey(event.dayKey) }
      : {})
  }
}

function optionalAllowed<T extends string>(
  value: T | undefined,
  allowed: ReadonlySet<string>
): T | undefined {
  return typeof value === "string" && allowed.has(value) ? value : undefined
}

function optionalInstallId(value: string | undefined): string | undefined {
  return isValidInstallId(value) ? value : undefined
}

function optionalExtensionVersion(
  value: string | undefined
): string | undefined {
  return typeof value === "string" &&
    value.length <= 32 &&
    /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:\.\d{1,5})?$/.test(value)
    ? value
    : undefined
}

function optionalDayKey(value: string | undefined): string | undefined {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return undefined
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined
}

export function utcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export function trashOutcomeAnalytics(
  outcome: Pick<TrashOutcome, "kind" | "movedCount">
): PrivacySafeAnalyticsEvent[] {
  if (outcome.kind === "dry_run") return []
  return mutationOutcomeAnalytics("trash", outcome.kind, outcome.movedCount)
}

export function restoreOutcomeAnalytics(
  outcome: Pick<RestoreOutcome, "kind" | "restoredDedupKeys">
): PrivacySafeAnalyticsEvent[] {
  return mutationOutcomeAnalytics("undo", outcome.kind, outcome.restoredDedupKeys.length)
}

function mutationOutcomeAnalytics(
  operation: "trash" | "undo",
  kind: "complete" | "partial" | "failed" | "unknown",
  count: number
): PrivacySafeAnalyticsEvent[] {
  const events: PrivacySafeAnalyticsEvent[] = []
  if (kind === "complete" || kind === "partial") {
    events.push({ name: `${operation}_completed`, photoCountBucket: countBucket(count),
      ...(kind === "partial" ? { errorCategory: `${operation}_partial` } : {}) })
  }
  if (kind !== "complete") {
    events.push({ name: "error", errorCategory: kind === "partial" ? `${operation}_partial` : operation })
  }
  return events
}

export class ProviderConnectionTracker {
  private connectedProvider: PhotoProvider | null = null
  private reportedProvider: PhotoProvider | null = null

  markConnected(provider: PhotoProvider, consent = true): boolean {
    if (this.connectedProvider !== provider) this.reportedProvider = null
    this.connectedProvider = provider
    return this.connectionForConsent(consent) !== null
  }

  connectionForConsent(consent: boolean): PhotoProvider | null {
    if (!consent) { this.reportedProvider = null; return null }
    if (!this.connectedProvider || this.reportedProvider === this.connectedProvider) return null
    this.reportedProvider = this.connectedProvider
    return this.connectedProvider
  }

  markDisconnected(provider: PhotoProvider): void {
    if (this.connectedProvider === provider) this.reset()
  }

  reset(): void {
    this.connectedProvider = null
    this.reportedProvider = null
  }
}

export async function sendPrivacySafeAnalyticsEvent(
  apiBaseUrl: string | undefined,
  event: PrivacySafeAnalyticsEvent,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  if (!apiBaseUrl) return false
  const safeEvent = buildAnalyticsEvent(event)
  if (
    !safeEvent?.installId ||
    !safeEvent.extensionVersion ||
    !safeEvent.dayKey
  ) {
    return false
  }
  const response = await fetchImpl(`${apiBaseUrl}/analytics`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(safeEvent)
  })
  return response.ok
}
