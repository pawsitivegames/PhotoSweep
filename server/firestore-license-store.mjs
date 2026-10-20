import { Firestore } from "@google-cloud/firestore"
import { ANALYTICS_RETENTION_MS } from "./analytics-retention.mjs"

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

function purchasesForLicense(license) {
  if (!license) return []
  return Array.isArray(license.purchases)
    ? license.purchases
    : (() => {
        const { purchases: _purchases, ...purchase } = license
        return [purchase]
      })()
}

export function createFirestoreLicenseStore({
  firestore = undefined,
  firestoreFactory = undefined,
  databaseId = undefined,
  collectionPrefix = process.env.PHOTOSWEEP_FIRESTORE_COLLECTION_PREFIX ??
    DEFAULT_COLLECTION_PREFIX
} = {}) {
  const createFirestore = firestoreFactory ?? ((options) =>
    options ? new Firestore(options) : new Firestore()
  )
  const firestoreClient =
    firestore ??
    (databaseId
      ? createFirestore({ databaseId })
      : createFirestore())
  const licenses = firestoreClient.collection(
    `${collectionPrefix}_licenses`
  )
  const indexes = firestoreClient.collection(
    `${collectionPrefix}_license_indexes`
  )
  const stripeEvents = firestoreClient.collection(
    `${collectionPrefix}_stripe_events`
  )
  const pendingRevocations = firestoreClient.collection(
    `${collectionPrefix}_pending_stripe_revocations`
  )
  const analytics = firestoreClient.collection(
    `${collectionPrefix}_analytics_events`
  )

  async function setIndex(kind, value, sessionId, transaction) {
    if (!value) return
    const ref = indexes.doc(`${kind}_${encodeKey(value)}`)
    const data = {
      kind,
      value: String(value).toLowerCase(),
      sessionId,
      updatedAt: now()
    }
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
      await firestoreClient.runTransaction(async (transaction) => {
        transaction.set(licenses.doc(cleanLicense.sessionId), cleanLicense, {
          merge: true
        })
        for (const purchase of purchasesForLicense(cleanLicense)) {
          await setIndex(
            "email",
            purchase.email,
            cleanLicense.sessionId,
            transaction
          )
          await setIndex(
            "stripe_customer",
            purchase.stripeCustomerId,
            cleanLicense.sessionId,
            transaction
          )
          await setIndex(
            "stripe_checkout_session",
            purchase.stripeCheckoutSessionId,
            cleanLicense.sessionId,
            transaction
          )
          await setIndex(
            "stripe_payment_intent",
            purchase.stripePaymentIntentId,
            cleanLicense.sessionId,
            transaction
          )
          await setIndex(
            "stripe_charge",
            purchase.stripeChargeId,
            cleanLicense.sessionId,
            transaction
          )
        }
      })
    },

    async deactivateLicense(sessionId, reason) {
      const ref = licenses.doc(sessionId)
      await firestoreClient.runTransaction(async (transaction) => {
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

    async claimRecoveryEmailCooldown(email, currentTime, cooldownMs) {
      const ref = indexes.doc(`email_${encodeKey(email)}`)
      return firestoreClient.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref)
        const sentAt = snapshot.exists
          ? Number(snapshot.data()?.recoveryEmailSentAt)
          : undefined
        if (
          Number.isFinite(sentAt) &&
          currentTime - sentAt < cooldownMs
        ) {
          return false
        }
        transaction.set(
          ref,
          { recoveryEmailSentAt: currentTime },
          { merge: true }
        )
        return true
      })
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

    async getSessionIdByStripeChargeId(chargeId) {
      return getIndex("stripe_charge", chargeId)
    },

    async recordPendingStripeRevocation(revocation) {
      const keys = pendingStripeRevocationKeys(revocation)
      if (keys.length === 0) return
      const recorded = stripUndefined({
        ...revocation,
        recordedAt: revocation.recordedAt ?? now()
      })
      await firestoreClient.runTransaction(async (transaction) => {
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
      await stripeEvents
        .doc(eventId)
        .set({ eventId, processedAt: now() }, { merge: true })
    },

    async recordAnalyticsEvent(event) {
      const recordedAt = now()
      const cleanEvent = stripUndefined({ ...event, recordedAt })
      await analytics.add({
        ...cleanEvent,
        expiresAt: new Date(recordedAt + ANALYTICS_RETENTION_MS)
      })
    },

    async snapshot() {
      const currentTime = now()
      const [licenseDocs, indexDocs, eventDocs, pendingDocs, analyticsDocs] =
        await Promise.all([
          licenses.get(),
          indexes.get(),
          stripeEvents.get(),
          pendingRevocations.get(),
          analytics
            .where("expiresAt", ">", new Date(currentTime))
            .orderBy("expiresAt", "desc")
            .limit(MAX_STORED_ANALYTICS_EVENTS)
            .get()
        ])
      return {
        licensesBySessionId: Object.fromEntries(
          licenseDocs.docs.map((doc) => [doc.id, doc.data()])
        ),
        indexes: Object.fromEntries(
          indexDocs.docs.map((doc) => [doc.id, doc.data()])
        ),
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
