// @vitest-environment node

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { runStripeLedgerEvidenceExport } from "../../tools/export-stripe-ledger-evidence.mjs"

describe("Stripe ledger evidence exporter", () => {
  it("reads offline exports, writes aggregate JSON, and excludes customer PII", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "photosweep-stripe-evidence-")
    )
    const ledgerPath = path.join(directory, "ledger.json")
    const stripePath = path.join(directory, "stripe.json")
    const outputPath = path.join(directory, "evidence.json")
    await fs.writeFile(
      ledgerPath,
      JSON.stringify({
        purchases: [
          {
            planId: "lifetime",
            status: "active",
            stripeCheckoutSessionId: "cs_cli",
            stripePaymentIntentId: "pi_cli",
            stripeCustomerId: "cus_cli",
            purchasedAt: "2026-09-01T00:01:00.000Z"
          }
        ]
      })
    )
    await fs.writeFile(
      stripePath,
      JSON.stringify({
        checkoutSessions: [
          {
            id: "cs_cli",
            created: 1788220860,
            payment_status: "paid",
            payment_intent: "pi_cli",
            customer: "cus_cli",
            amount_total: 1499,
            currency: "usd",
            customer_details: { email: "private@example.com" },
            metadata: { planId: "lifetime" }
          }
        ],
        paymentIntents: [
          {
            id: "pi_cli",
            created: 1788220860,
            status: "succeeded",
            amount: 1499,
            amount_received: 1499,
            currency: "usd",
            customer: "cus_cli",
            metadata: { planId: "lifetime" }
          }
        ],
        charges: [],
        refunds: []
      })
    )

    const result = await runStripeLedgerEvidenceExport({
      argv: [
        "--from",
        "2026-09-01T00:00:00.000Z",
        "--to",
        "2026-10-01T00:00:00.000Z",
        "--ledger-export",
        ledgerPath,
        "--stripe-export",
        stripePath,
        "--output",
        outputPath
      ],
      now: new Date("2026-10-01T00:00:00.000Z")
    })

    expect(result.outputPath).toBe(outputPath)
    const output = await fs.readFile(outputPath, "utf8")
    const evidence = JSON.parse(output)
    expect(evidence).toMatchObject({
      generatedAt: "2026-10-01T00:00:00.000Z",
      metrics: {
        paid_checkouts: 1,
        paid_customers: 1,
        gross_revenue: { amountMinor: 1499, currency: "usd" },
        net_revenue: { amountMinor: 1499, currency: "usd" }
      }
    })
    expect(output).not.toContain("private@example.com")
    expect(output).not.toContain("cus_cli")
  })
})
