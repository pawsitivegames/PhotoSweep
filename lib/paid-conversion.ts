import type { PlanId } from "./entitlement"
import type { PhotoProvider } from "./types"

export type UpgradeReason =
  | "scan"
  | "groups"
  | "trash"
  | "export"
  | "resume"
  | "provider"

/** Facts that are safe to show on an upgrade surface when they came from the
 * current review session. Undefined facts are intentionally omitted. */
export interface UpgradeValueFacts {
  provider?: PhotoProvider
  scopeLabel?: string
  scopeIsFullLibrary?: boolean
  itemsChecked?: number
  additionalItemsUnavailable?: number
  duplicateGroupCount?: number
  visibleGroupCount?: number
  lockedGroupCount?: number
  selectedCleanupCount?: number
  remainingTrashMoves?: number | "unlimited"
}

export interface DeferredUpgradePrompt {
  reason: UpgradeReason
  facts: UpgradeValueFacts
}

export type CheckoutReturnOutcome =
  | "activated"
  | "pending"
  | "failed"
  | "offline"

export type ActivationOutcome =
  | "access_reconciled"
  | "restore"
  | "not_activated"

export interface CheckoutReturnState {
  status: "idle" | "pending" | "refreshing" | "active" | "retryable" | "failed"
  planId?: Exclude<PlanId, "free">
  outcome?: CheckoutReturnOutcome
  activation?: ActivationOutcome
  message?: string
}

export function shouldShowDeferredUpgrade(
  deferred: DeferredUpgradePrompt | null | undefined,
  groupsFound: number,
  isResultsState: boolean
): deferred is DeferredUpgradePrompt {
  return Boolean(deferred && isResultsState && groupsFound > 0)
}

export function clearDeferredUpgrade(): null {
  return null
}

export function formatUpgradeScope(
  facts: UpgradeValueFacts
): string | undefined {
  if (facts.scopeLabel) return facts.scopeLabel
  if (facts.scopeIsFullLibrary === true) return "your loaded library"
  return undefined
}

export function boundedRetryDelays(
  maxAttempts = 3,
  initialDelayMs = 0,
  backoffMs = 500
): number[] {
  const attempts = Math.max(1, Math.floor(maxAttempts))
  const initial = Math.max(0, Math.floor(initialDelayMs))
  const backoff = Math.max(0, Math.floor(backoffMs))
  return Array.from({ length: attempts }, (_, index) =>
    index === 0 ? initial : backoff * 2 ** (index - 1)
  )
}

export function describePaidReturnOutcome(
  outcome: CheckoutReturnOutcome,
  planLabel: string
): string {
  switch (outcome) {
    case "activated":
      return `${planLabel} is active. Your review results remain available.`
    case "offline":
      return "Could not reach the license service. Keep reviewing free results and retry when online."
    case "failed":
      return "Payment could not be verified yet. Refresh the license or retry checkout."
    case "pending":
      return "Payment is still being confirmed. Refresh the license when the payment provider finishes."
  }
}
