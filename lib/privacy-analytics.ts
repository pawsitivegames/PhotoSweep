import type { Entitlement } from "./entitlement"
import type {
  ActivationOutcome,
  CheckoutReturnOutcome,
  UpgradeReason
} from "./paid-conversion"
import type { PhotoProvider, ScanMode } from "./types"

export const ANALYTICS_CONSENT_STORAGE_KEY = "photoSweepAnalyticsConsent"

const ANALYTICS_PROVIDERS = new Set<PhotoProvider>([
  "google",
  "icloud",
  "amazon"
])
const ANALYTICS_SCAN_MODES = new Set<ScanMode>(["smart", "full"])
const ANALYTICS_COUNT_BUCKETS = new Set([
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
  "trash_partial"
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
}

export function countBucket(count: number): string {
  if (count < 100) return "0-99"
  if (count < 1000) return "100-999"
  if (count < 5000) return "1k-5k"
  if (count < 10000) return "5k-10k"
  if (count < 50000) return "10k-50k"
  return "50k+"
}

export function buildAnalyticsEvent(
  event: PrivacySafeAnalyticsEvent
): PrivacySafeAnalyticsEvent {
  return {
    name: event.name,
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
      : {})
  }
}

function optionalAllowed<T extends string>(
  value: T | undefined,
  allowed: ReadonlySet<string>
): T | undefined {
  return typeof value === "string" && allowed.has(value) ? value : undefined
}

export async function sendPrivacySafeAnalyticsEvent(
  apiBaseUrl: string | undefined,
  event: PrivacySafeAnalyticsEvent,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  if (!apiBaseUrl) return false
  const response = await fetchImpl(`${apiBaseUrl}/analytics`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildAnalyticsEvent(event))
  })
  return response.ok
}
