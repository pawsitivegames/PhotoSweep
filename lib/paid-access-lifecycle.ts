import {
  FREE_ENTITLEMENT,
  getEffectivePlanId,
  type Entitlement,
  type PlanId
} from "./entitlement"
import type { CheckoutResponse, StoredEntitlement } from "./license-client"
import {
  boundedRetryDelays,
  type ActivationOutcome,
  type CheckoutReturnOutcome
} from "./paid-conversion"

export interface PaidAccessClient {
  isConfigured(): boolean
  createCheckout(planId: Exclude<PlanId, "free">): Promise<CheckoutResponse>
  recoverLicense(email: string): Promise<void>
  fetchEntitlementToken(): Promise<string>
}

export interface PaidAccessAdapter {
  load(): Promise<{
    stored: StoredEntitlement
    apiBaseUrl?: string
  }>
  saveVerifiedToken(token: string): Promise<StoredEntitlement>
  createClient(apiBaseUrl?: string): PaidAccessClient
}

export class PaidAccessNotConfiguredError extends Error {
  constructor() {
    super("Paid access is not configured.")
    this.name = "PaidAccessNotConfiguredError"
  }
}

export interface PaidAccessRefresh {
  stored: StoredEntitlement
  recovery: "completed" | "not_found" | null
}

export interface PaidAccessCheckoutReconciliation {
  outcome: CheckoutReturnOutcome
  activation: ActivationOutcome
  stored?: StoredEntitlement
  attempts: number
  error?: unknown
}

export interface PaidAccessCheckoutReconciliationOptions {
  planId: Exclude<PlanId, "free">
  maxAttempts?: number
  initialDelayMs?: number
  backoffMs?: number
  sleep?: (delayMs: number) => Promise<void>
}

export class PaidAccessLifecycle {
  private entitlement: Entitlement = FREE_ENTITLEMENT
  private apiBaseUrl?: string
  private storedTokenPresent = false
  private startupRefreshAttempted = false
  private recoveryPending = false
  private checkoutInFlight: {
    planId: Exclude<PlanId, "free">
    promise: Promise<CheckoutResponse>
  } | null = null
  private refreshInFlight: Promise<PaidAccessRefresh> | null = null

  constructor(private readonly adapter: PaidAccessAdapter) {}

  async initialize(): Promise<{
    entitlement: Entitlement
    apiBaseUrl?: string
    storedTokenPresent: boolean
  }> {
    const loaded = await this.adapter.load()
    this.entitlement = loaded.stored.entitlement
    this.apiBaseUrl = loaded.apiBaseUrl
    this.storedTokenPresent = Boolean(loaded.stored.token)
    return {
      entitlement: this.entitlement,
      apiBaseUrl: this.apiBaseUrl,
      storedTokenPresent: this.storedTokenPresent
    }
  }

  async refreshStoredTokenOnce(): Promise<PaidAccessRefresh | null> {
    if (!this.storedTokenPresent || this.startupRefreshAttempted) return null
    this.startupRefreshAttempted = true
    return this.refresh()
  }

  async refresh(): Promise<PaidAccessRefresh> {
    if (this.refreshInFlight) return this.refreshInFlight
    const operation = this.refreshInternal()
    this.refreshInFlight = operation
    try {
      return await operation
    } finally {
      if (this.refreshInFlight === operation) this.refreshInFlight = null
    }
  }

  private async refreshInternal(): Promise<PaidAccessRefresh> {
    const client = this.configuredClient()
    const token = await client.fetchEntitlementToken()
    const stored = await this.adapter.saveVerifiedToken(token)
    this.entitlement = stored.entitlement
    this.storedTokenPresent = Boolean(stored.token)
    const recovery = this.recoveryPending
      ? getEffectivePlanId(stored.entitlement) === "free"
        ? "not_found"
        : "completed"
      : null
    this.recoveryPending = false
    return { stored, recovery }
  }

  async authorizeAction(): Promise<Entitlement> {
    if (getEffectivePlanId(this.entitlement) !== "cleanup_pass") {
      return this.entitlement
    }
    return (await this.refresh()).stored.entitlement
  }

  async createCheckout(
    planId: Exclude<PlanId, "free">
  ): Promise<CheckoutResponse> {
    if (this.checkoutInFlight) {
      if (this.checkoutInFlight.planId === planId) {
        return this.checkoutInFlight.promise
      }
      return Promise.reject(
        new Error(
          "Another checkout is already in progress for a different plan."
        )
      )
    }
    const operation = this.configuredClient()
      .createCheckout(planId)
      .then((response) => validateCheckoutResponse(response, planId))
    this.checkoutInFlight = { planId, promise: operation }
    try {
      return await operation
    } finally {
      if (this.checkoutInFlight?.promise === operation) {
        this.checkoutInFlight = null
      }
    }
  }

  /**
   * Drops an in-flight checkout from the current app identity/context.
   *
   * The underlying request cannot be cancelled reliably across browsers, but
   * its promise must not be reused by a later account/provider context. The
   * completion still validates the plan it was created for; the app's
   * generation guard then ignores the stale result and never opens its URL.
   */
  invalidateCheckoutContext(): void {
    this.checkoutInFlight = null
  }

  async reconcileCheckoutReturn(
    options: PaidAccessCheckoutReconciliationOptions
  ): Promise<PaidAccessCheckoutReconciliation> {
    const delays = boundedRetryDelays(
      options.maxAttempts,
      options.initialDelayMs,
      options.backoffMs
    )
    const sleep = options.sleep ?? defaultSleep
    let lastError: unknown

    for (let index = 0; index < delays.length; index += 1) {
      if (delays[index] > 0) await sleep(delays[index])
      try {
        const refreshed = await this.refresh()
        const refreshedPlan = getEffectivePlanId(refreshed.stored.entitlement)
        if (refreshedPlan === options.planId) {
          return {
            outcome: "activated",
            activation: "access_reconciled",
            stored: refreshed.stored,
            attempts: index + 1
          }
        }
        if (index === delays.length - 1) {
          return {
            outcome: "pending",
            activation: "not_activated",
            stored: refreshed.stored,
            attempts: index + 1
          }
        }
      } catch (error) {
        lastError = error
        if (index === delays.length - 1) {
          return {
            outcome: isOfflineLikeError(error) ? "offline" : "failed",
            activation: "not_activated",
            attempts: index + 1,
            error
          }
        }
      }
    }

    return {
      outcome: lastError ? "failed" : "pending",
      activation: "not_activated",
      attempts: delays.length,
      ...(lastError ? { error: lastError } : {})
    }
  }

  async recover(email: string): Promise<void> {
    await this.configuredClient().recoverLicense(email)
    this.recoveryPending = true
  }

  private configuredClient(): PaidAccessClient {
    const client = this.adapter.createClient(this.apiBaseUrl)
    if (!client.isConfigured()) throw new PaidAccessNotConfiguredError()
    return client
  }
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function validateCheckoutResponse(
  response: CheckoutResponse,
  expectedPlanId: Exclude<PlanId, "free">
): CheckoutResponse {
  if (!response || response.planId !== expectedPlanId) {
    throw new Error("Checkout response did not match the requested plan.")
  }
  let parsed: URL
  try {
    parsed = new URL(response.url)
  } catch {
    throw new Error("Checkout response did not contain a valid URL.")
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Checkout response did not contain a secure URL.")
  }
  return response
}

function isOfflineLikeError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  return message.includes("network") || message.includes("offline")
}
