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
  currency = "usd",
  licenseSessionId,
  createdAt = created
}: {
  id: string
  paymentIntentId: string
  customerId?: string
  planId?: string
  amount?: number
  currency?: string
  licenseSessionId?: string
  createdAt?: number
}) {
  return {
    id,
    created: createdAt,
    payment_status: "paid",
    payment_intent: paymentIntentId,
    customer: customerId,
    amount_total: amount,
    currency,
    customer_details: { email: "private@example.com" },
    metadata: {
      planId,
      ...(licenseSessionId ? { licenseSessionId } : {})
    }
  }
}

function paymentIntent({
  id,
  customerId,
  amount = 499,
  currency = "usd",
  planId = "cleanup_pass",
  createdAt = created
}: {
  id: string
  customerId?: string
  amount?: number
  currency?: string
  planId?: string
  createdAt?: number
}) {
  return {
    id,
    created: createdAt,
    status: "succeeded",
    amount,
    amount_received: amount,
    currency,
    customer: customerId,
    metadata: { planId }
  }
}

function charge({
  id,
  paymentIntentId,
  customerId,
  amount = 499,
  currency = "usd",
  planId = "cleanup_pass",
  createdAt = created
}: {
  id: string
  paymentIntentId: string
  customerId?: string
  amount?: number
  currency?: string
  planId?: string
  createdAt?: number
}) {
  return {
    id,
    created: createdAt,
    payment_intent: paymentIntentId,
    paid: true,
    amount,
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

  it("excludes superseded same-session plan checkouts from the blocker", () => {
    const upgradeCases = [
      {
        licenseSessionId: "pls_LNUm8rvNO5qm2JMjl6vJGELh",
        customerId: "cus_upgrade_1",
        earlier: {
          id: "cs_live_a1HdbMmZbjgTUNWVxg00MUSTaU5PZ4a0sKYhrRQkPeh9xSSshjsxkIwWU5",
          paymentIntentId: "pi_3U6CcLLuiS5pnsDP15K5zfEd",
          chargeId: "ch_3U6CcLLuiS5pnsDP1oyTNGNT",
          planId: "cleanup_pass",
          amount: 499,
          createdAt: created + 10
        },
        current: {
          id: "cs_live_a1TARvTW5gVP5UYZRloThT88V9k4P1fLYjyHXMOuAZruYKvZ0GlL6OYGri",
          paymentIntentId: "pi_3U6ChWLuiS5pnsDP0qn2GNrj",
          chargeId: "ch_upgrade_lifetime_1",
          planId: "lifetime",
          amount: 999,
          createdAt: created + 370
        }
      },
      {
        licenseSessionId: "pls_yMmTsLt_PQGtYV0FcvMNQSX1",
        customerId: "cus_upgrade_2",
        earlier: {
          id: "cs_live_a1NALDKcL5cKwXIwj5hmoUIXGViHfITGt3e2evMqE5h2ieeri6p55EO2JO",
          paymentIntentId: "pi_3Tz6O8LuiS5pnsDP0mUCIsJ4",
          chargeId: "ch_3Tz6O8LuiS5pnsDP0cCZT6sF",
          planId: "mini_cleanup",
          amount: 299,
          createdAt: created + 20
        },
        current: {
          id: "cs_live_a1Pt6lNYdxifRVME1RwoGBPsTRXM5YQxnFEDDQmpKXljuVEZztid1xbPcg",
          paymentIntentId: "pi_upgrade_lifetime_2",
          chargeId: "ch_upgrade_lifetime_2",
          planId: "lifetime",
          amount: 999,
          createdAt: created + 33_002
        }
      }
    ]

    const evidence = reconcileStripeLedger({
      fromMs,
      toMs,
      ledger: {
        licensesBySessionId: Object.fromEntries(
          upgradeCases.map(({ licenseSessionId, customerId, current }) => [
            licenseSessionId,
            {
              sessionId: licenseSessionId,
              purchases: [
                ledgerRow({
                  checkoutSessionId: current.id,
                  paymentIntentId: current.paymentIntentId,
                  chargeId: current.chargeId,
                  customerId,
                  planId: current.planId
                })
              ]
            }
          ])
        )
      },
      stripe: {
        checkoutSessions: upgradeCases.flatMap(
          ({ licenseSessionId, customerId, earlier, current }) => [
            checkout({ ...earlier, customerId, licenseSessionId }),
            checkout({ ...current, customerId, licenseSessionId })
          ]
        ),
        paymentIntents: upgradeCases.flatMap(
          ({ customerId, earlier, current }) => [
            paymentIntent({
              id: earlier.paymentIntentId,
              customerId,
              amount: earlier.amount,
              planId: earlier.planId,
              createdAt: earlier.createdAt
            }),
            paymentIntent({
              id: current.paymentIntentId,
              customerId,
              amount: current.amount,
              planId: current.planId,
              createdAt: current.createdAt
            })
          ]
        ),
        charges: upgradeCases.flatMap(({ customerId, earlier, current }) => [
          charge({
            id: earlier.chargeId,
            paymentIntentId: earlier.paymentIntentId,
            customerId,
            amount: earlier.amount,
            planId: earlier.planId,
            createdAt: earlier.createdAt
          }),
          charge({
            id: current.chargeId,
            paymentIntentId: current.paymentIntentId,
            customerId,
            amount: current.amount,
            planId: current.planId,
            createdAt: current.createdAt
          })
        ]),
        refunds: []
      }
    })

    expect(evidence.metrics).toMatchObject({
      paid_checkouts: 4,
      gross_revenue: {
        amountMinor: 2796,
        currency: "usd"
      },
      net_revenue: {
        amountMinor: 2796,
        currency: "usd"
      }
    })
    expect(evidence.reconciliation.paidCheckoutSessions).toMatchObject({
      total: 4,
      matched: 2,
      unmatched: 2,
      matchedByAnyStripeId: 2,
      supersededPaidCheckoutSessions: 2,
      nonSupersededPaidCheckoutSessions: 2,
      matchedByCheckoutIdExcludingSuperseded: 2,
      unmatchedByCheckoutIdExcludingSuperseded: 0,
      rateExcludingSuperseded: 1
    })
    expect(evidence.quality).toMatchObject({
      supersededPaidCheckoutSessions: 2,
      unmatchedByCheckoutIdExcludingSuperseded: 0
    })
    expect(evidence.quality.blockers).not.toContain(
      "unmatched_paid_checkout_sessions"
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

  it("uses a payment-level guest surrogate when Stripe has no Customer object", () => {
    const evidence = reconcileStripeLedger({
      fromMs,
      toMs,
      ledger: {
        purchases: [
          {
            planId: "cleanup_pass",
            status: "active",
            stripeCheckoutSessionId: "cs_guest",
            stripePaymentIntentId: "pi_guest",
            purchasedAt: fromMs + 60_000
          },
          {
            planId: "cleanup_pass",
            status: "inactive",
            stripeCheckoutSessionId: "cs_guest_refunded",
            stripePaymentIntentId: "pi_guest_refunded",
            purchasedAt: fromMs + 120_000
          }
        ]
      },
      stripe: {
        checkoutSessions: [
          checkout({
            id: "cs_guest",
            paymentIntentId: "pi_guest"
          }),
          checkout({
            id: "cs_guest_refunded",
            paymentIntentId: "pi_guest_refunded"
          })
        ],
        paymentIntents: [
          paymentIntent({ id: "pi_guest" }),
          paymentIntent({ id: "pi_guest_refunded" })
        ],
        charges: [],
        refunds: [
          {
            id: "re_guest",
            created: created + 10,
            payment_intent: "pi_guest_refunded",
            amount: 499,
            currency: "usd",
            status: "succeeded"
          }
        ]
      }
    })

    expect(evidence.metrics).toMatchObject({
      paid_checkouts: 2,
      paid_customers: 1,
      refunded_customers: 1
    })
    expect(evidence.metricDetails.paid_customers).toMatchObject({
      unresolvedCustomerPaymentCount: 0,
      guestSurrogateCount: 1
    })
    expect(evidence.metricDetails.refunded_customers).toMatchObject({
      unresolvedCustomerPaymentCount: 0,
      guestSurrogateCount: 1
    })
    expect(evidence.quality.blockers).not.toContain(
      "successful_payments_without_customer_identity"
    )
    expect(evidence.quality.blockers).not.toContain(
      "refunds_without_customer_identity"
    )
    expect(JSON.stringify(evidence)).not.toContain("guest_payment_intent")
  })

  it("reports uniquely matchable historical rows without writing a backfill", () => {
    const evidence = reconcileStripeLedger({
      fromMs,
      toMs,
      includeEnrichmentReport: true,
      ledger: {
        licensesBySessionId: {
          license_session_1: {
            sessionId: "license_session_1",
            purchases: [
              {
                planId: "cleanup_pass",
                status: "active",
                purchasedAt: fromMs + 60_000
              }
            ]
          }
        }
      },
      stripe: {
        checkoutSessions: [
          {
            id: "cs_historical",
            created,
            payment_status: "paid",
            payment_intent: "pi_historical",
            amount_total: 499,
            currency: "usd",
            metadata: {
              planId: "cleanup_pass",
              licenseSessionId: "license_session_1"
            }
          }
        ],
        paymentIntents: [
          paymentIntent({
            id: "pi_historical",
            planId: "cleanup_pass"
          })
        ],
        charges: [],
        refunds: []
      }
    })

    expect(evidence.reconciliation.purchaseRows).toMatchObject({
      matchedByCheckoutId: 0,
      matchedByLicenseSessionId: 1,
      uniquelyMatchableForEnrich: 1
    })
    expect(evidence.quality.blockers).toContain(
      "purchase_rows_missing_stripe_checkout_match"
    )
    expect(evidence.enrichmentReport).toMatchObject({
      readOnly: true,
      dryRun: true,
      backfillRequiresOwnerApproval: true,
      privacy: {
        ownerOnlyArtifact: true,
        containsOpaqueStripeCustomerIds: true
      },
      summary: {
        uniqueMatchCount: 1,
        enrichableRowCount: 1
      }
    })
    expect(evidence.enrichmentReport.rows[0]).toMatchObject({
      rowIndex: 0,
      firestoreSessionId: "license_session_1",
      status: "unique",
      matchedBy: ["license_session_id"],
      candidate: {
        stripeCheckoutSessionId: "cs_historical",
        stripePaymentIntentId: "pi_historical"
      }
    })
    expect(JSON.stringify(evidence.enrichmentReport)).not.toContain(
      "customer_details"
    )
  })

  it("marks shared license-session candidates ambiguous across purchase rows", () => {
    const evidence = reconcileStripeLedger({
      fromMs,
      toMs,
      includeEnrichmentReport: true,
      ledger: {
        licensesBySessionId: {
          shared_session: {
            sessionId: "shared_session",
            purchases: [
              {
                planId: "cleanup_pass",
                status: "active",
                purchasedAt: fromMs + 60_000
              },
              {
                planId: "cleanup_pass",
                status: "active",
                purchasedAt: fromMs + 120_000
              }
            ]
          }
        }
      },
      stripe: {
        checkoutSessions: [
          {
            id: "cs_shared",
            created,
            payment_status: "paid",
            payment_intent: "pi_shared",
            amount_total: 499,
            currency: "usd",
            metadata: {
              planId: "cleanup_pass",
              licenseSessionId: "shared_session"
            }
          }
        ],
        paymentIntents: [
          paymentIntent({
            id: "pi_shared",
            planId: "cleanup_pass"
          })
        ],
        charges: [],
        refunds: []
      }
    })

    expect(evidence.enrichmentReport.summary).toMatchObject({
      uniqueMatchCount: 0,
      ambiguousCount: 2,
      enrichableRowCount: 0
    })
    expect(evidence.enrichmentReport.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "ambiguous",
          ambiguityReason: "candidate_reused_by_rows",
          conflictingRowIndexes: [0, 1]
        }),
        expect.objectContaining({
          status: "ambiguous",
          ambiguityReason: "candidate_reused_by_rows",
          conflictingRowIndexes: [0, 1]
        })
      ])
    )
  })

  it("does not propose enrichment when existing Stripe identifiers conflict", () => {
    const evidence = reconcileStripeLedger({
      fromMs,
      toMs,
      includeEnrichmentReport: true,
      ledger: {
        purchases: [
          {
            planId: "cleanup_pass",
            status: "active",
            stripePaymentIntentId: "pi_first",
            stripeChargeId: "ch_second",
            purchasedAt: fromMs + 60_000
          }
        ]
      },
      stripe: {
        checkoutSessions: [],
        paymentIntents: [
          paymentIntent({
            id: "pi_first",
            planId: "cleanup_pass"
          })
        ],
        charges: [
          {
            id: "ch_second",
            created,
            payment_intent: "pi_second",
            paid: true,
            amount: 499,
            currency: "usd",
            metadata: { planId: "cleanup_pass" }
          }
        ],
        refunds: []
      }
    })

    expect(evidence.enrichmentReport.summary).toMatchObject({
      uniqueMatchCount: 0,
      conflictingIdentifierCount: 1
    })
    expect(evidence.enrichmentReport.rows[0]).toMatchObject({
      status: "conflicting_identifiers",
      ambiguityReason: "conflicting_existing_stripe_ids",
      fieldsToEnrich: []
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
      amountMinor: null,
      refundAmountMinorByCurrency: { usd: 1499 }
    })
    expect(evidence.metricDetails.net_revenue).toMatchObject({
      matchedRefundCount: 2,
      unmatchedRefundCount: 1,
      netAssertable: false
    })
    expect(evidence.reconciliation.refunds).toMatchObject({
      total: 3,
      matched: 2,
      unmatched: 1
    })
  })

  it("does not assert net revenue from a charge aggregate without a refund feed", () => {
    const evidence = reconcileStripeLedger({
      fromMs,
      toMs,
      ledger: {
        purchases: [
          ledgerRow({
            checkoutSessionId: "cs_aggregate",
            paymentIntentId: "pi_aggregate"
          })
        ]
      },
      stripe: {
        checkoutSessions: [
          checkout({
            id: "cs_aggregate",
            paymentIntentId: "pi_aggregate"
          })
        ],
        paymentIntents: [
          paymentIntent({
            id: "pi_aggregate"
          })
        ],
        charges: [
          {
            id: "ch_aggregate",
            created,
            payment_intent: "pi_aggregate",
            paid: true,
            amount: 499,
            amount_refunded: 100,
            currency: "usd"
          }
        ]
      }
    })

    expect(evidence.metrics.net_revenue.amountMinor).toBeNull()
    expect(evidence.metricDetails.net_revenue).toMatchObject({
      refundAggregateFallbackUsed: true,
      netAssertable: false
    })
    expect(evidence.quality.blockers).toContain(
      "refund_feed_missing_using_charge_aggregate"
    )
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

  it("does not subtract a refund in a different currency", () => {
    const evidence = reconcileStripeLedger({
      fromMs,
      toMs,
      ledger: {
        purchases: [
          ledgerRow({
            checkoutSessionId: "cs_currency_refund",
            paymentIntentId: "pi_currency_refund"
          })
        ]
      },
      stripe: {
        checkoutSessions: [
          checkout({
            id: "cs_currency_refund",
            paymentIntentId: "pi_currency_refund"
          })
        ],
        paymentIntents: [
          paymentIntent({
            id: "pi_currency_refund",
            currency: "usd"
          })
        ],
        charges: [],
        refunds: [
          {
            id: "re_currency_mismatch",
            created: created + 10,
            payment_intent: "pi_currency_refund",
            amount: 100,
            currency: "eur",
            status: "succeeded"
          }
        ]
      }
    })

    expect(evidence.metrics.net_revenue).toMatchObject({
      amountMinor: null,
      amountsByCurrency: { usd: 499 },
      refundAmountMinorByCurrency: {}
    })
    expect(evidence.currencyConsistent).toBe(false)
    expect(evidence.quality.blockers).toContain("refund_currency_mismatch")
  })
})
