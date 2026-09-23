// @vitest-environment node

import { describe, expect, it } from "vitest"

import { reconcileStripeLedger } from "../../server/stripe-ledger-reconcile.mjs"

const fromMs = Date.parse("2026-09-01T00:00:00.000Z")
const toMs = Date.parse("2026-10-01T00:00:00.000Z")
const created = Math.floor(fromMs / 1000) + 60

function checkout({
  id,
  paymentIntentId,
  customerId,
  planId = "cleanup_pass",
  amount = 499,
  currency = "usd"
}: {
  id: string
  paymentIntentId: string
  customerId?: string
  planId?: string
  amount?: number
  currency?: string
}) {
  return {
    id,
    created,
    payment_status: "paid",
    payment_intent: paymentIntentId,
    customer: customerId,
    amount_total: amount,
    currency,
    customer_details: { email: "private@example.com" },
    metadata: { planId }
  }
}

function paymentIntent({
  id,
  customerId,
  amount = 499,
  currency = "usd",
  planId = "cleanup_pass"
}: {
  id: string
  customerId?: string
  amount?: number
  currency?: string
  planId?: string
}) {
  return {
    id,
    created,
    status: "succeeded",
    amount,
    amount_received: amount,
    currency,
    customer: customerId,
    metadata: { planId }
  }
}

function ledgerRow({
  checkoutSessionId,
  paymentIntentId,
  chargeId,
  customerId,
  planId = "cleanup_pass",
  purchasedAt = fromMs + 60_000
}: {
  checkoutSessionId?: string
  paymentIntentId: string
  chargeId?: string
  customerId?: string
  planId?: string
  purchasedAt?: number
}) {
  return {
    planId,
    status: "active",
    stripeCheckoutSessionId: checkoutSessionId,
    stripePaymentIntentId: paymentIntentId,
    stripeChargeId: chargeId,
    stripeCustomerId: customerId,
    purchasedAt
  }
}

describe("reconcileStripeLedger", () => {
  it("reports a purchase row missing its checkout id without losing payment reconciliation", () => {
    const evidence = reconcileStripeLedger({
      fromMs,
      toMs,
      ledger: {
        licensesBySessionId: {
          license_1: {
            sessionId: "license_1",
            purchases: [
              ledgerRow({
                paymentIntentId: "pi_1",
                customerId: "cus_1"
              })
            ]
          }
        }
      },
      stripe: {
        checkoutSessions: [
          checkout({
            id: "cs_1",
            paymentIntentId: "pi_1",
            customerId: "cus_1"
          })
        ],
        paymentIntents: [paymentIntent({ id: "pi_1", customerId: "cus_1" })],
        charges: [
          {
            id: "ch_1",
            created,
            payment_intent: "pi_1",
            paid: true,
            amount: 499,
            currency: "usd",
            customer: "cus_1"
          }
        ],
        refunds: []
      }
    })

    expect(evidence.metrics.paid_checkouts).toBe(1)
    expect(evidence.metrics.paid_customers).toBe(1)
    expect(evidence.metrics.gross_revenue).toMatchObject({
      amountMinor: 499,
      currency: "usd"
    })
    expect(evidence.reconciliation.paidCheckoutSessions).toMatchObject({
      matched: 0,
      unmatched: 1,
      matchedByAnyStripeId: 1
    })
    expect(evidence.reconciliation.purchaseRows).toMatchObject({
      matchedByCheckoutId: 0,
      matchedByAnyStripeId: 1
    })
    expect(evidence.quality.blockers).toContain(
      "purchase_rows_missing_stripe_checkout_match"
    )
  })

  it("enriches a payment without a customer id from the Checkout session", () => {
    const evidence = reconcileStripeLedger({
      fromMs,
      toMs,
      ledger: {
        purchases: [
          ledgerRow({
            checkoutSessionId: "cs_customer",
            paymentIntentId: "pi_customer"
          })
        ]
      },
      stripe: {
        checkoutSessions: [
          checkout({
            id: "cs_customer",
            paymentIntentId: "pi_customer",
            customerId: "cus_enriched"
          })
        ],
        paymentIntents: [
          paymentIntent({ id: "pi_customer", customerId: undefined })
        ],
        charges: [],
        refunds: []
      }
    })

    expect(evidence.metrics.paid_customers).toBe(1)
    expect(evidence.metricDetails.paid_customers).toMatchObject({
      unresolvedCustomerPaymentCount: 0
    })
    expect(JSON.stringify(evidence)).not.toContain("private@example.com")
    expect(JSON.stringify(evidence)).not.toContain("cus_enriched")
    expect(evidence.privacy).toMatchObject({
      containsEmails: false,
      customerIdsExported: false
    })
  })

  it("pairs multiple refunds once and removes the refunded customer from paid customers", () => {
    const evidence = reconcileStripeLedger({
      fromMs,
      toMs,
      ledger: {
        purchases: [
          ledgerRow({
            checkoutSessionId: "cs_refund",
            paymentIntentId: "pi_refund",
            chargeId: "ch_refund",
            customerId: "cus_refund"
          })
        ]
      },
      stripe: {
        checkoutSessions: [
          checkout({
            id: "cs_refund",
            paymentIntentId: "pi_refund",
            customerId: "cus_refund",
            amount: 1499
          })
        ],
        paymentIntents: [
          paymentIntent({
            id: "pi_refund",
            customerId: "cus_refund",
            amount: 1499
          })
        ],
        charges: [
          {
            id: "ch_refund",
            created,
            payment_intent: "pi_refund",
            paid: true,
            amount: 1499,
            amount_refunded: 1499,
            currency: "usd",
            customer: "cus_refund"
          }
        ],
        refunds: [
          {
            id: "re_part_1",
            created: created + 10,
            payment_intent: "pi_refund",
            charge: "ch_refund",
            amount: 500,
            currency: "usd",
            status: "succeeded"
          },
          {
            id: "re_part_2",
            created: created + 20,
            payment_intent: "pi_refund",
            charge: "ch_refund",
            amount: 999,
            currency: "usd",
            status: "succeeded"
          },
          {
            id: "re_orphan",
            created: created + 30,
            payment_intent: "pi_missing",
            amount: 100,
            currency: "usd",
            status: "succeeded"
          },
          {
            id: "re_part_2",
            created: created + 20,
            payment_intent: "pi_refund",
            charge: "ch_refund",
            amount: 999,
            currency: "usd",
            status: "succeeded"
          }
        ]
      }
    })

    expect(evidence.metrics.paid_customers).toBe(0)
    expect(evidence.metrics.refunded_customers).toBe(1)
    expect(evidence.metrics.gross_revenue).toMatchObject({
      amountMinor: 1499,
      currency: "usd"
    })
    expect(evidence.metrics.net_revenue).toMatchObject({
      amountMinor: 0,
      refundAmountMinorByCurrency: { usd: 1499 }
    })
    expect(evidence.metricDetails.net_revenue).toMatchObject({
      matchedRefundCount: 2,
      unmatchedRefundCount: 1
    })
    expect(evidence.reconciliation.refunds).toMatchObject({
      total: 3,
      matched: 2,
      unmatched: 1
    })
  })

  it("blocks a single-currency revenue assertion when successful payments mix currencies", () => {
    const evidence = reconcileStripeLedger({
      fromMs,
      toMs,
      ledger: {
        purchases: [
          ledgerRow({
            checkoutSessionId: "cs_usd",
            paymentIntentId: "pi_usd",
            customerId: "cus_usd"
          }),
          ledgerRow({
            checkoutSessionId: "cs_eur",
            paymentIntentId: "pi_eur",
            customerId: "cus_eur",
            planId: "mini_cleanup"
          })
        ]
      },
      stripe: {
        checkoutSessions: [
          checkout({
            id: "cs_usd",
            paymentIntentId: "pi_usd",
            customerId: "cus_usd",
            amount: 499,
            currency: "usd"
          }),
          checkout({
            id: "cs_eur",
            paymentIntentId: "pi_eur",
            customerId: "cus_eur",
            amount: 299,
            currency: "eur",
            planId: "mini_cleanup"
          })
        ],
        paymentIntents: [
          paymentIntent({
            id: "pi_usd",
            customerId: "cus_usd",
            amount: 499,
            currency: "usd"
          }),
          paymentIntent({
            id: "pi_eur",
            customerId: "cus_eur",
            amount: 299,
            currency: "eur",
            planId: "mini_cleanup"
          })
        ],
        charges: [],
        refunds: []
      }
    })

    expect(evidence.currency).toBeNull()
    expect(evidence.currencyConsistent).toBe(false)
    expect(evidence.metrics.gross_revenue).toMatchObject({
      amountMinor: null,
      amountsByCurrency: { eur: 299, usd: 499 }
    })
    expect(evidence.metrics.net_revenue).toMatchObject({
      amountMinor: null,
      amountsByCurrency: { eur: 299, usd: 499 }
    })
    expect(evidence.quality.blockers).toContain(
      "gross_revenue_currency_or_amount_gap"
    )
  })
})
