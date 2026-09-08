import { Firestore } from "@google-cloud/firestore"

const DEFAULT_COLLECTION_PREFIX = "photosweep"
const MAX_STORED_ANALYTICS_EVENTS = 1000

function encodeKey(value) {
  return Buffer.from(String(value).toLowerCase()).toString("base64url")
}

function now() {
  return Date.now()
}

function pendingStripeRevocationKeys({
  paymentIntentId,
  checkoutSessionId,
  chargeId
} = {}) {
  return [
    paymentIntentId ? `pi:${paymentIntentId}` : undefined,
    checkoutSessionId ? `cs:${checkoutSessionId}` : undefined,
    chargeId ? `ch:${chargeId}` : undefined
  ].filter(Boolean)
}

function stripUndefined(value) {
  if (!value || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(stripUndefined)
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefined(item)])
  )
}

export function createFirestoreLicenseStore({
  firestore = new Firestore(),
  collectionPrefix = process.env.PHOTOSWEEP_FIRESTORE_COLLECTION_PREFIX ??
    DEFAULT_COLLECTION_PREFIX
} = {}) {
  const licenses = firestore.collection(`${collectionPrefix}_licenses`)
  const indexes = firestore.collection(`${collectionPrefix}_license_indexes`)
  const stripeEvents = firestore.collection(`${collectionPrefix}_stripe_events`)
  const pendingRevocations = firestore.collection(
    `${collectionPrefix}_pending_stripe_revocations`
  )
  const analytics = firestore.collection(`${collectionPrefix}_analytics_events`)

  async function setIndex(kind, value, sessionId, transaction) {
    if (!value) return
    const ref = indexes.doc(`${kind}_${encodeKey(value)}`)
    const data = { kind, value: String(value).toLowerCase(), sessionId, updatedAt: now() }
    if (transaction) transaction.set(ref, data, { merge: true })
    else await ref.set(data, { merge: true })
  }

  async function getIndex(kind, value) {
    if (!value) return undefined
    const snapshot = await indexes.doc(`${kind}_${encodeKey(value)}`).get()
    return snapshot.exists ? snapshot.data()?.sessionId : undefined
  }

  return {
    async getLicenseBySessionId(sessionId) {
      const snapshot = await licenses.doc(sessionId).get()
      return snapshot.exists ? snapshot.data() : undefined
    },

    async upsertLicense(license) {
      const cleanLicense = stripUndefined(license)
      await firestore.runTransaction(async (transaction) => {
        transaction.set(licenses.doc(cleanLicense.sessionId), cleanLicense, {
          merge: true
        })
        await setIndex("email", cleanLicense.email, cleanLicense.sessionId, transaction)
        await setIndex(
          "stripe_customer",
          cleanLicense.stripeCustomerId,
          cleanLicense.sessionId,
          transaction
        )
        await setIndex(
          "stripe_checkout_session",
          cleanLicense.stripeCheckoutSessionId,
          cleanLicense.sessionId,
          transaction
        )
        await setIndex(
          "stripe_payment_intent",
          cleanLicense.stripePaymentIntentId,
          cleanLicense.sessionId,
          transaction
        )
      })
    },

    async deactivateLicense(sessionId, reason) {
      const ref = licenses.doc(sessionId)
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return
        transaction.set(
          ref,
          { status: "inactive", inactiveReason: reason, updatedAt: now() },
          { merge: true }
        )
      })
    },

    async getSessionIdByEmail(email) {
      return getIndex("email", email)
    },

    async getSessionIdByStripeCustomerId(customerId) {
      return getIndex("stripe_customer", customerId)
    },

    async getSessionIdByStripeCheckoutSessionId(checkoutSessionId) {
      return getIndex("stripe_checkout_session", checkoutSessionId)
    },

    async getSessionIdByStripePaymentIntentId(paymentIntentId) {
      return getIndex("stripe_payment_intent", paymentIntentId)
    },

    async recordPendingStripeRevocation(revocation) {
      const keys = pendingStripeRevocationKeys(revocation)
      if (keys.length === 0) return
      const recorded = stripUndefined({
        ...revocation,
        recordedAt: revocation.recordedAt ?? now()
      })
      await firestore.runTransaction(async (transaction) => {
        for (const key of keys) {
          transaction.set(
            pendingRevocations.doc(encodeKey(key)),
            { ...recorded, key },
            { merge: true }
          )
        }
      })
    },

    async getPendingStripeRevocation(query) {
      for (const key of pendingStripeRevocationKeys(query)) {
        const snapshot = await pendingRevocations.doc(encodeKey(key)).get()
        if (snapshot.exists) return snapshot.data()
      }
    },

    async hasProcessedStripeEvent(eventId) {
      const snapshot = await stripeEvents.doc(eventId).get()
      return snapshot.exists
    },

    async markStripeEventProcessed(eventId) {
      await stripeEvents.doc(eventId).set(
        { eventId, processedAt: now() },
        { merge: true }
      )
    },

    async recordAnalyticsEvent(event) {
      await analytics.add(stripUndefined({ ...event, recordedAt: now() }))
    },

    async snapshot() {
      const [licenseDocs, indexDocs, eventDocs, pendingDocs, analyticsDocs] =
        await Promise.all([
          licenses.get(),
          indexes.get(),
          stripeEvents.get(),
          pendingRevocations.get(),
          analytics
            .orderBy("recordedAt", "desc")
            .limit(MAX_STORED_ANALYTICS_EVENTS)
            .get()
        ])
      return {
        licensesBySessionId: Object.fromEntries(
          licenseDocs.docs.map((doc) => [doc.id, doc.data()])
        ),
        indexes: Object.fromEntries(indexDocs.docs.map((doc) => [doc.id, doc.data()])),
        pendingStripeRevocations: Object.fromEntries(
          pendingDocs.docs.map((doc) => {
            const data = doc.data()
            return [data?.key ?? doc.id, data]
          })
        ),
        processedStripeEvents: eventDocs.docs.map((doc) => doc.id),
        analyticsEvents: analyticsDocs.docs.map((doc) => doc.data()).reverse()
      }
    }
  }
}
