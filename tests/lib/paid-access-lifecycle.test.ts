import { describe, expect, it, vi } from "vitest"

import type { Entitlement } from "../../lib/entitlement"
import {
  PaidAccessLifecycle,
  PaidAccessNotConfiguredError,
  type PaidAccessAdapter,
  type PaidAccessClient
} from "../../lib/paid-access-lifecycle"

function entitlement(
  planId: Entitlement["planId"],
  source: Entitlement["source"] = "signed_token"
): Entitlement {
  return { planId, active: true, source }
}

function fixture(options?: {
  initialPlan?: Entitlement["planId"]
  refreshedPlan?: Entitlement["planId"]
  token?: string
  configured?: boolean
}) {
  const fetchEntitlementToken = vi.fn(async () => "fresh-token")
  const createCheckout = vi.fn(async (planId) => ({
    url: "https://checkout.test",
    sessionId: "pls_checkout",
    planId
  }))
  const recoverLicense = vi.fn(async () => {})
  const client: PaidAccessClient = {
    isConfigured: () => options?.configured !== false,
    fetchEntitlementToken,
    createCheckout,
    recoverLicense
  }
  const saveVerifiedToken = vi.fn(async (token: string) => ({
    entitlement: entitlement(options?.refreshedPlan ?? "lifetime"),
    token,
    refreshedAt: 2
  }))
  const adapter: PaidAccessAdapter = {
    async load() {
      return {
        stored: {
          entitlement: entitlement(options?.initialPlan ?? "free"),
          token: options?.token,
          refreshedAt: 1
        },
        apiBaseUrl:
          options?.configured === false ? undefined : "https://license.test"
      }
    },
    saveVerifiedToken,
    createClient: () => client
  }
  return {
    lifecycle: new PaidAccessLifecycle(adapter),
    fetchEntitlementToken,
    createCheckout,
    recoverLicense,
    saveVerifiedToken
  }
}

describe("PaidAccessLifecycle", () => {
  it("loads verified access and refreshes a stored token once", async () => {
    const subject = fixture({ token: "stored-token" })
    const loaded = await subject.lifecycle.initialize()

    expect(loaded.storedTokenPresent).toBe(true)
    expect(
      (await subject.lifecycle.refreshStoredTokenOnce())?.stored.entitlement
    ).toMatchObject({ planId: "lifetime" })
    expect(await subject.lifecycle.refreshStoredTokenOnce()).toBeNull()
    expect(subject.fetchEntitlementToken).toHaveBeenCalledTimes(1)
  })

  it("refreshes Cleanup Pass before authorizing an action", async () => {
    const subject = fixture({
      initialPlan: "cleanup_pass",
      refreshedPlan: "cleanup_pass"
    })
    await subject.lifecycle.initialize()

    const authorized = await subject.lifecycle.authorizeAction()

    expect(authorized.planId).toBe("cleanup_pass")
    expect(subject.fetchEntitlementToken).toHaveBeenCalledOnce()
  })

  it("does not refresh lifetime access before an action", async () => {
    const subject = fixture({ initialPlan: "lifetime" })
    await subject.lifecycle.initialize()

    expect((await subject.lifecycle.authorizeAction()).planId).toBe("lifetime")
    expect(subject.fetchEntitlementToken).not.toHaveBeenCalled()
  })

  it("owns checkout and recovery ordering", async () => {
    const subject = fixture({ refreshedPlan: "lifetime" })
    await subject.lifecycle.initialize()

    expect(await subject.lifecycle.createCheckout("lifetime")).toEqual({
      url: "https://checkout.test",
      sessionId: "pls_checkout",
      planId: "lifetime"
    })
    await subject.lifecycle.recover("buyer@example.com")
    const refreshed = await subject.lifecycle.refresh()

    expect(subject.createCheckout).toHaveBeenCalledWith("lifetime")
    expect(subject.recoverLicense).toHaveBeenCalledWith("buyer@example.com")
    expect(refreshed.recovery).toBe("completed")
  })

  it("fails closed when paid access is not configured", async () => {
    const subject = fixture({ configured: false })
    await subject.lifecycle.initialize()

    await expect(
      subject.lifecycle.createCheckout("cleanup_pass")
    ).rejects.toBeInstanceOf(PaidAccessNotConfiguredError)
    await expect(subject.lifecycle.refresh()).rejects.toBeInstanceOf(
      PaidAccessNotConfiguredError
    )
  })

  it("deduplicates concurrent checkout starts and entitlement refreshes", async () => {
    let releaseCheckout!: (value: {
      url: string
      sessionId: string
      planId: "lifetime"
    }) => void
    const checkoutResult = new Promise<{
      url: string
      sessionId: string
      planId: "lifetime"
    }>((resolve) => {
      releaseCheckout = resolve
    })
    const fetchEntitlementToken = vi.fn(async () => "fresh-token")
    const createCheckout = vi.fn(() => checkoutResult)
    const saveVerifiedToken = vi.fn(async (token: string) => ({
      entitlement: entitlement("lifetime"),
      token,
      refreshedAt: 2
    }))
    const adapter: PaidAccessAdapter = {
      async load() {
        return {
          stored: {
            entitlement: entitlement("free"),
            token: "stored",
            refreshedAt: 1
          },
          apiBaseUrl: "https://license.test"
        }
      },
      saveVerifiedToken,
      createClient: () => ({
        isConfigured: () => true,
        createCheckout,
        fetchEntitlementToken,
        recoverLicense: async () => {}
      })
    }
    const lifecycle = new PaidAccessLifecycle(adapter)
    await lifecycle.initialize()

    const firstCheckout = lifecycle.createCheckout("lifetime")
    const secondCheckout = lifecycle.createCheckout("lifetime")
    const differentPlanCheckout = lifecycle.createCheckout("cleanup_pass")
    expect(createCheckout).toHaveBeenCalledOnce()
    await expect(differentPlanCheckout).rejects.toThrow("different plan")
    releaseCheckout({
      url: "https://checkout.test",
      sessionId: "pls_checkout",
      planId: "lifetime"
    })
    await expect(Promise.all([firstCheckout, secondCheckout])).resolves.toEqual(
      [
        {
          url: "https://checkout.test",
          sessionId: "pls_checkout",
          planId: "lifetime"
        },
        {
          url: "https://checkout.test",
          sessionId: "pls_checkout",
          planId: "lifetime"
        }
      ]
    )

    const firstRefresh = lifecycle.refresh()
    const secondRefresh = lifecycle.refresh()
    await expect(
      Promise.all([firstRefresh, secondRefresh])
    ).resolves.toHaveLength(2)
    expect(fetchEntitlementToken).toHaveBeenCalledOnce()
  })

  it("does not reuse a same-plan checkout after context invalidation", async () => {
    let releaseFirst!: (value: {
      url: string
      sessionId: string
      planId: "lifetime"
    }) => void
    let releaseSecond!: (value: {
      url: string
      sessionId: string
      planId: "lifetime"
    }) => void
    const firstResult = new Promise<{
      url: string
      sessionId: string
      planId: "lifetime"
    }>((resolve) => {
      releaseFirst = resolve
    })
    const secondResult = new Promise<{
      url: string
      sessionId: string
      planId: "lifetime"
    }>((resolve) => {
      releaseSecond = resolve
    })
    const subject = fixture()
    subject.createCheckout
      .mockReturnValueOnce(firstResult)
      .mockReturnValueOnce(secondResult)
    await subject.lifecycle.initialize()

    const firstCheckout = subject.lifecycle.createCheckout("lifetime")
    subject.lifecycle.invalidateCheckoutContext()
    const secondCheckout = subject.lifecycle.createCheckout("lifetime")

    expect(subject.createCheckout).toHaveBeenCalledTimes(2)
    expect(subject.createCheckout).toHaveBeenNthCalledWith(1, "lifetime")
    expect(subject.createCheckout).toHaveBeenNthCalledWith(2, "lifetime")

    releaseFirst({
      url: "https://checkout.first",
      sessionId: "pls_checkout",
      planId: "lifetime"
    })
    releaseSecond({
      url: "https://checkout.second",
      sessionId: "pls_checkout",
      planId: "lifetime"
    })
    await expect(firstCheckout).resolves.toEqual({
      url: "https://checkout.first",
      sessionId: "pls_checkout",
      planId: "lifetime"
    })
    await expect(secondCheckout).resolves.toEqual({
      url: "https://checkout.second",
      sessionId: "pls_checkout",
      planId: "lifetime"
    })
  })

  it("does not reuse a different-plan checkout after context invalidation", async () => {
    let releaseFirst!: (value: {
      url: string
      sessionId: string
      planId: "lifetime"
    }) => void
    let releaseSecond!: (value: {
      url: string
      sessionId: string
      planId: "cleanup_pass"
    }) => void
    const firstResult = new Promise<{
      url: string
      sessionId: string
      planId: "lifetime"
    }>((resolve) => {
      releaseFirst = resolve
    })
    const secondResult = new Promise<{
      url: string
      sessionId: string
      planId: "cleanup_pass"
    }>((resolve) => {
      releaseSecond = resolve
    })
    const subject = fixture()
    subject.createCheckout
      .mockReturnValueOnce(firstResult)
      .mockReturnValueOnce(secondResult)
    await subject.lifecycle.initialize()

    const firstCheckout = subject.lifecycle.createCheckout("lifetime")
    subject.lifecycle.invalidateCheckoutContext()
    const secondCheckout = subject.lifecycle.createCheckout("cleanup_pass")

    expect(subject.createCheckout).toHaveBeenCalledTimes(2)
    releaseFirst({
      url: "https://checkout.first",
      sessionId: "pls_checkout",
      planId: "lifetime"
    })
    releaseSecond({
      url: "https://checkout.second",
      sessionId: "pls_checkout",
      planId: "cleanup_pass"
    })
    await expect(firstCheckout).resolves.toEqual({
      url: "https://checkout.first",
      sessionId: "pls_checkout",
      planId: "lifetime"
    })
    await expect(secondCheckout).resolves.toEqual({
      url: "https://checkout.second",
      sessionId: "pls_checkout",
      planId: "cleanup_pass"
    })
  })

  it("stops bounded reconciliation at pending when the server has not activated access", async () => {
    const subject = fixture({ refreshedPlan: "free" })
    await subject.lifecycle.initialize()
    const result = await subject.lifecycle.reconcileCheckoutReturn({
      planId: "cleanup_pass",
      maxAttempts: 3,
      initialDelayMs: 0,
      backoffMs: 0
    })

    expect(result).toMatchObject({
      outcome: "pending",
      activation: "not_activated",
      attempts: 3
    })
    expect(subject.fetchEntitlementToken).toHaveBeenCalledTimes(3)
  })

  it("does not treat a different paid plan as checkout activation", async () => {
    const subject = fixture({ refreshedPlan: "mini_cleanup" })
    await subject.lifecycle.initialize()

    await expect(
      subject.lifecycle.reconcileCheckoutReturn({
        planId: "lifetime",
        maxAttempts: 1,
        initialDelayMs: 0,
        backoffMs: 0
      })
    ).resolves.toMatchObject({
      outcome: "pending",
      activation: "not_activated",
      attempts: 1,
      stored: { entitlement: { planId: "mini_cleanup" } }
    })
  })

  it("rejects a mismatched or insecure checkout response", async () => {
    const subject = fixture()
    await subject.lifecycle.initialize()
    subject.createCheckout.mockResolvedValueOnce({
      url: "http://checkout.test",
      sessionId: "pls_checkout",
      planId: "lifetime"
    })
    await expect(
      subject.lifecycle.createCheckout("cleanup_pass")
    ).rejects.toThrow("requested plan")

    subject.createCheckout.mockResolvedValueOnce({
      url: "http://checkout.test",
      sessionId: "pls_checkout",
      planId: "cleanup_pass"
    })
    await expect(
      subject.lifecycle.createCheckout("cleanup_pass")
    ).rejects.toThrow("secure URL")
  })

  it("never treats a return reconciliation error as paid access", async () => {
    const subject = fixture()
    subject.fetchEntitlementToken.mockRejectedValue(new TypeError("offline"))
    await subject.lifecycle.initialize()
    const result = await subject.lifecycle.reconcileCheckoutReturn({
      planId: "lifetime",
      maxAttempts: 2,
      initialDelayMs: 0,
      backoffMs: 0
    })

    expect(result).toMatchObject({
      outcome: "offline",
      activation: "not_activated",
      attempts: 2
    })
  })
})
