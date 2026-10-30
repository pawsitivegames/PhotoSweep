import crypto from "node:crypto"
import { FieldValue } from "@google-cloud/firestore"
import { describe, expect, it, vi } from "vitest"

import { createFirestoreLicenseStore } from "../../server/firestore-license-store.mjs"
import { createLicenseApi } from "../../server/license-api.mjs"

class FakeDocSnapshot {
  constructor(
    public id: string,
    private value: unknown
  ) {}
  get exists() {
    return this.value !== undefined
  }
  data() {
    return this.value
  }
}

class FakeQuerySnapshot {
  constructor(public docs: FakeDocSnapshot[]) {}
}

class FakeDocRef {
  constructor(
    private readonly store: Map<string, unknown>,
    public readonly id: string
  ) {}
  async get() {
    return new FakeDocSnapshot(this.id, this.store.get(this.id))
  }
  async set(value: Record<string, unknown>, options?: { merge?: boolean }) {
    const previous = options?.merge
      ? (this.store.get(this.id) as object)
      : undefined
    const next: Record<string, unknown> = { ...(previous ?? {}) }
    for (const [field, item] of Object.entries(value)) {
      if (item instanceof FieldValue && item.isEqual(FieldValue.delete())) {
        delete next[field]
      } else {
        next[field] = item
      }
    }
    this.store.set(this.id, next)
  }
}

class FakeQuery {
  constructor(private docs: FakeDocSnapshot[]) {}
  where(field: string, op: string, expected: unknown) {
    if (op !== ">") throw new Error(`Unsupported fake query operator: ${op}`)
    const expectedTime =
      expected instanceof Date ? expected.getTime() : Number(expected)
    return new FakeQuery(
      this.docs.filter((doc) => {
        const value = (doc.data() as Record<string, unknown>)?.[field]
        const actualTime = value instanceof Date ? value.getTime() : Number(value)
        return actualTime > expectedTime
      })
    )
  }
  orderBy(field: string, direction: "asc" | "desc") {
    const docs = [...this.docs].sort((a, b) => {
      const value = (doc: FakeDocSnapshot) => {
        const item = (doc.data() as Record<string, unknown>)?.[field]
        return item instanceof Date ? item.getTime() : Number(item ?? 0)
      }
      return direction === "desc" ? value(b) - value(a) : value(a) - value(b)
    })
    return new FakeQuery(docs)
  }
  limit(count: number) {
    return new FakeQuery(this.docs.slice(0, count))
  }
  async get() {
    return new FakeQuerySnapshot(this.docs)
  }
}

class FakeCollectionRef {
  private autoId = 0
  constructor(private readonly store: Map<string, unknown>) {}
  doc(id: string) {
    return new FakeDocRef(this.store, id)
  }
  async add(value: Record<string, unknown>) {
    const id = `auto_${++this.autoId}`
    await this.doc(id).set(value)
    return this.doc(id)
  }
  async get() {
    return new FakeQuerySnapshot(
      [...this.store.entries()].map(
        ([id, value]) => new FakeDocSnapshot(id, value)
      )
    )
  }
  where(field: string, op: string, expected: unknown) {
    return this.query().where(field, op, expected)
  }
  orderBy(field: string, direction: "asc" | "desc") {
    return this.query().orderBy(field, direction)
  }
  private query() {
    return new FakeQuery(
      [...this.store.entries()].map(
        ([id, value]) => new FakeDocSnapshot(id, value)
      )
    )
  }
}

class FakeTransaction {
  constructor(private readonly writes: Array<() => Promise<void>>) {}
  get(ref: FakeDocRef) {
    return ref.get()
  }
  set(
    ref: FakeDocRef,
    value: Record<string, unknown>,
    options?: { merge?: boolean }
  ) {
    this.writes.push(() => ref.set(value, options))
  }
}

class FakeFirestore {
  collections = new Map<string, Map<string, unknown>>()
  collection(name: string) {
    if (!this.collections.has(name)) this.collections.set(name, new Map())
    return new FakeCollectionRef(this.collections.get(name)!)
  }
  async runTransaction<T>(
    callback: (transaction: FakeTransaction) => Promise<T>
  ) {
    const writes: Array<() => Promise<void>> = []
    const result = await callback(new FakeTransaction(writes))
    for (const write of writes) await write()
    return result
  }
}

describe("createFirestoreLicenseStore", () => {
  it("stores licenses and lookup indexes", async () => {
    const firestore = new FakeFirestore()
    const store = createFirestoreLicenseStore({ firestore: firestore as never })

    await store.upsertLicense({
      sessionId: "sess_1",
      planId: "lifetime",
      status: "active",
      email: "Buyer@Example.com",
      stripeCustomerId: "cus_123",
      stripeCheckoutSessionId: "cs_123",
      stripePaymentIntentId: "pi_123",
      stripeChargeId: "ch_123",
      purchasedAt: 1000
    })

    await expect(store.getLicenseBySessionId("sess_1")).resolves.toMatchObject({
      planId: "lifetime",
      status: "active"
    })
    await expect(store.getSessionIdByEmail("buyer@example.com")).resolves.toBe(
      "sess_1"
    )
    await expect(store.getSessionIdByStripeCustomerId("cus_123")).resolves.toBe(
      "sess_1"
    )
    await expect(
      store.getSessionIdByStripeCheckoutSessionId("cs_123")
    ).resolves.toBe("sess_1")
    await expect(
      store.getSessionIdByStripePaymentIntentId("pi_123")
    ).resolves.toBe("sess_1")
    await expect(store.getSessionIdByStripeChargeId("ch_123")).resolves.toBe(
      "sess_1"
    )
  })

  it.each(["mini_cleanup", "lifetime"])(
    "removes an old Cleanup Pass expiry when upserting %s without an expiry",
    async (planId) => {
      const firestore = new FakeFirestore()
      const store = createFirestoreLicenseStore({
        firestore: firestore as never
      })
      await store.upsertLicense({
        sessionId: "sess_upgrade",
        planId: "cleanup_pass",
        status: "active",
        purchasedAt: 1000,
        expiresAt: 2000,
        supportNote: "Preserve unrelated license metadata"
      })

      await store.upsertLicense({
        sessionId: "sess_upgrade",
        planId,
        status: "active",
        purchasedAt: 1500,
        expiresAt: undefined
      })

      const license = await store.getLicenseBySessionId("sess_upgrade")
      expect(license).toMatchObject({
        planId,
        supportNote: "Preserve unrelated license metadata"
      })
      expect(license).not.toHaveProperty("expiresAt")
    }
  )

  it("keeps a Lifetime upgrade active after the earlier Cleanup Pass expires", async () => {
    vi.useFakeTimers()
    try {
      const purchasedAt = Date.UTC(2026, 7, 19, 16, 45)
      vi.setSystemTime(purchasedAt)
      const keys = crypto.generateKeyPairSync("ec", {
        namedCurve: "prime256v1"
      })
      const secret = "whsec_cleanup_lifetime_regression"
      const store = createFirestoreLicenseStore({
        firestore: new FakeFirestore() as never
      })
      const api = createLicenseApi({
        store,
        env: {
          NODE_ENV: "production",
          STRIPE_WEBHOOK_SECRET: secret,
          PHOTOSWEEP_ENTITLEMENT_PRIVATE_KEY: Buffer.from(
            keys.privateKey.export({ type: "pkcs8", format: "pem" })
          ).toString("base64url")
        }
      })
      const sessionId = "pls_cleanup_lifetime_regression"

      for (const planId of ["cleanup_pass", "lifetime"]) {
        const body = JSON.stringify({
          id: `evt_${planId}`,
          type: "checkout.session.completed",
          data: {
            object: {
              id: `cs_test_${planId}`,
              payment_intent: `pi_${planId}`,
              payment_status: "paid",
              created: Math.floor(Date.now() / 1000),
              metadata: { planId, licenseSessionId: sessionId }
            }
          }
        })
        const timestamp = Math.floor(Date.now() / 1000)
        const signature = crypto
          .createHmac("sha256", secret)
          .update(`${timestamp}.${body}`)
          .digest("hex")
        const response = await api(
          new Request("https://license.test/stripe/webhook", {
            method: "POST",
            headers: {
              "stripe-signature": `t=${timestamp},v1=${signature}`
            },
            body
          })
        )
        expect(response.status).toBe(200)
        vi.setSystemTime(Date.now() + 5 * 60_000)
      }

      vi.setSystemTime(purchasedAt + 8 * 24 * 60 * 60_000)
      const response = await api(
        new Request("https://license.test/entitlement", {
          headers: { "x-photosweep-license-session": sessionId }
        })
      )
      expect(response.status).toBe(200)
      const { token } = await response.json()
      const [payload, signature] = token.split(".")
      expect(
        crypto.verify(
          "sha256",
          Buffer.from(payload),
          { key: keys.publicKey, dsaEncoding: "ieee-p1363" },
          Buffer.from(signature, "base64url")
        )
      ).toBe(true)
      expect(
        JSON.parse(Buffer.from(payload, "base64url").toString())
      ).toMatchObject({
        planId: "lifetime",
        active: true
      })
      const license = await store.getLicenseBySessionId(sessionId)
      expect(license).not.toHaveProperty("expiresAt")
      expect(license.purchases).toEqual([
        expect.objectContaining({
          planId: "cleanup_pass",
          expiresAt: purchasedAt + 7 * 24 * 60 * 60_000
        }),
        expect.objectContaining({ planId: "lifetime" })
      ])
      expect(license.purchases[1]).not.toHaveProperty("expiresAt")
    } finally {
      vi.useRealTimers()
    }
  })

  it("claims recovery email cooldowns transactionally per normalized email", async () => {
    const firestore = new FakeFirestore()
    const store = createFirestoreLicenseStore({ firestore: firestore as never })
    await store.upsertLicense({
      sessionId: "sess_recovery",
      planId: "lifetime",
      status: "active",
      email: "Buyer@Example.com",
      purchasedAt: 1000
    })

    await expect(
      store.claimRecoveryEmailCooldown("buyer@example.com", 100_000, 900_000)
    ).resolves.toBe(true)
    await expect(
      store.claimRecoveryEmailCooldown("BUYER@example.com", 999_999, 900_000)
    ).resolves.toBe(false)
    await expect(
      store.claimRecoveryEmailCooldown("buyer@example.com", 1_000_000, 900_000)
    ).resolves.toBe(true)
  })

  it("indexes every purchase in a multi-purchase ledger", async () => {
    const firestore = new FakeFirestore()
    const store = createFirestoreLicenseStore({ firestore: firestore as never })

    await store.upsertLicense({
      sessionId: "sess_multi",
      purchases: [
        {
          planId: "mini_cleanup",
          status: "inactive",
          stripeCheckoutSessionId: "cs_old",
          stripePaymentIntentId: "pi_old",
          stripeChargeId: "ch_old",
          purchasedAt: 1000
        },
        {
          planId: "lifetime",
          status: "active",
          stripeCheckoutSessionId: "cs_new",
          stripePaymentIntentId: "pi_new",
          stripeChargeId: "ch_new",
          purchasedAt: 2000
        }
      ]
    })

    await expect(
      store.getSessionIdByStripeCheckoutSessionId("cs_old")
    ).resolves.toBe("sess_multi")
    await expect(
      store.getSessionIdByStripePaymentIntentId("pi_old")
    ).resolves.toBe("sess_multi")
    await expect(store.getSessionIdByStripeChargeId("ch_old")).resolves.toBe(
      "sess_multi"
    )
    await expect(
      store.getSessionIdByStripeCheckoutSessionId("cs_new")
    ).resolves.toBe("sess_multi")
    await expect(
      store.getSessionIdByStripePaymentIntentId("pi_new")
    ).resolves.toBe("sess_multi")
    await expect(store.getSessionIdByStripeChargeId("ch_new")).resolves.toBe(
      "sess_multi"
    )
  })

  it("deactivates licenses and tracks processed Stripe events", async () => {
    const firestore = new FakeFirestore()
    const store = createFirestoreLicenseStore({ firestore: firestore as never })

    await store.upsertLicense({
      sessionId: "sess_2",
      planId: "cleanup_pass",
      status: "active",
      purchasedAt: 1000
    })
    await store.deactivateLicense("sess_2", "charge.refunded")
    await expect(store.getLicenseBySessionId("sess_2")).resolves.toMatchObject({
      status: "inactive",
      inactiveReason: "charge.refunded"
    })

    await expect(store.hasProcessedStripeEvent("evt_1")).resolves.toBe(false)
    await store.markStripeEventProcessed("evt_1")
    await expect(store.hasProcessedStripeEvent("evt_1")).resolves.toBe(true)
  })

  it("stores pending Stripe revocations for lookup by payment identifiers", async () => {
    const firestore = new FakeFirestore()
    const store = createFirestoreLicenseStore({ firestore: firestore as never })

    await store.recordPendingStripeRevocation({
      paymentIntentId: "pi_pending",
      checkoutSessionId: "cs_pending",
      chargeId: "ch_pending",
      reason: "charge.dispute.created"
    })

    await expect(
      store.getPendingStripeRevocation({ paymentIntentId: "pi_pending" })
    ).resolves.toMatchObject({
      reason: "charge.dispute.created",
      checkoutSessionId: "cs_pending",
      chargeId: "ch_pending"
    })
    await expect(
      store.getPendingStripeRevocation({ checkoutSessionId: "cs_pending" })
    ).resolves.toMatchObject({
      paymentIntentId: "pi_pending",
      reason: "charge.dispute.created"
    })
    await expect(
      store.getPendingStripeRevocation({ chargeId: "ch_pending" })
    ).resolves.toMatchObject({
      reason: "charge.dispute.created"
    })
    await expect(
      store.getPendingStripeRevocation({ paymentIntentId: "pi_other" })
    ).resolves.toBeUndefined()

    const snapshot = await store.snapshot()
    expect(snapshot.pendingStripeRevocations["pi:pi_pending"]).toMatchObject({
      reason: "charge.dispute.created"
    })
  })

  it("records analytics events and exposes a snapshot", async () => {
    const firestore = new FakeFirestore()
    const store = createFirestoreLicenseStore({ firestore: firestore as never })

    await store.recordAnalyticsEvent({
      name: "app_opened",
      planId: "free",
      installId: "123e4567-e89b-42d3-a456-426614174000",
      extensionVersion: "2.3.0.1",
      dayKey: "2026-09-23"
    })
    const snapshot = await store.snapshot()

    expect(snapshot.analyticsEvents).toHaveLength(1)
    expect(snapshot.analyticsEvents[0]).toMatchObject({
      name: "app_opened",
      planId: "free",
      installId: "123e4567-e89b-42d3-a456-426614174000",
      extensionVersion: "2.3.0.1",
      dayKey: "2026-09-23"
    })
  })

  it("sets a 90-day Firestore TTL expiry and omits expired analytics rows", async () => {
    vi.useFakeTimers()
    try {
      const currentTime = Date.parse("2026-10-12T12:00:00.000Z")
      const retentionMs = 90 * 24 * 60 * 60 * 1000
      vi.setSystemTime(currentTime)
      const firestore = new FakeFirestore()
      const store = createFirestoreLicenseStore({ firestore: firestore as never })
      const analyticsRows = firestore.collections.get("photosweep_analytics_events")!
      analyticsRows.set("expired", {
        name: "expired",
        recordedAt: currentTime - retentionMs - 1,
        expiresAt: new Date(currentTime - 1)
      })

      await store.recordAnalyticsEvent({ name: "app_opened", planId: "free" })
      const stored = analyticsRows.get("auto_1") as Record<string, unknown>
      expect(stored).toMatchObject({ name: "app_opened", recordedAt: currentTime })
      expect(stored.expiresAt).toEqual(new Date(currentTime + retentionMs))

      const snapshot = await store.snapshot()
      expect(snapshot.analyticsEvents.map((event) => event.name)).toEqual([
        "app_opened"
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})
