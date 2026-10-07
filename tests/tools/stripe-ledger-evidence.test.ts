// @vitest-environment node

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  fetchStripeLedgerObjects,
  runStripeLedgerEvidenceExport
} from "../../tools/export-stripe-ledger-evidence.mjs"

describe("Stripe ledger evidence exporter", () => {
  it("reads offline exports, writes aggregate JSON, and excludes customer PII", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "photosweep-stripe-evidence-")
    )
    const ledgerPath = path.join(directory, "ledger.json")
    const stripePath = path.join(directory, "stripe.json")
    const outputPath = path.join(directory, "evidence.json")
    const enrichmentReportPath = path.join(directory, "enrichment.json")
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
        livemode: true,
        checkoutSessions: [
          {
            id: "cs_cli",
            livemode: true,
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
            livemode: true,
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
        outputPath,
        "--enrich-report",
        enrichmentReportPath
      ],
      now: new Date("2026-10-01T00:00:00.000Z")
    })

    expect(result).toHaveProperty("outputPath", outputPath)
    if (!("outputPath" in result)) throw new Error("Expected an output path.")
    const output = await fs.readFile(outputPath, "utf8")
    const evidence = JSON.parse(output)
    expect(evidence).toMatchObject({
      generatedAt: "2026-10-01T00:00:00.000Z",
      stripeMode: "live",
      livemode: true,
      liveOnly: true,
      modeProvenance: {
        source: "offline_export",
        modeFrom: "object_fields_or_explicit_collection_marker"
      },
      metrics: {
        paid_checkouts: 1,
        paid_customers: 1,
        gross_revenue: { amountMinor: 1499, currency: "usd" },
        net_revenue: { amountMinor: 1499, currency: "usd" }
      }
    })
    expect(output).not.toContain("private@example.com")
    expect(output).not.toContain("cus_cli")
    const enrichment = JSON.parse(
      await fs.readFile(enrichmentReportPath, "utf8")
    )
    expect(enrichment).toMatchObject({
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
    expect(enrichment.rows[0].candidate).not.toHaveProperty(
      "customerIdentityKey"
    )
  })

  it("expands customer paths for live Stripe reads without mutating anything", async () => {
    const requests: URL[] = []
    const result = await fetchStripeLedgerObjects({
      fromMs: Date.parse("2026-09-01T00:00:00.000Z"),
      toMs: Date.parse("2026-10-01T00:00:00.000Z"),
      secret: "sk_test_not_written",
      fetchImpl: async (input, init) => {
        requests.push(new URL(String(input)))
        expect(init?.headers).toMatchObject({
          authorization: "Bearer sk_test_not_written"
        })
        return {
          ok: true,
          async json() {
            return { data: [], has_more: false }
          }
        } as Response
      }
    })

    expect(result).toMatchObject({
      livemode: false,
      checkoutSessions: [],
      paymentIntents: [],
      charges: [],
      refunds: []
    })
    expect(requests).toHaveLength(4)
    const expandsByPath = new Map(
      requests.map((request) => [
        request.pathname,
        request.searchParams.getAll("expand[]")
      ])
    )
    expect(expandsByPath.get("/v1/checkout/sessions")).toEqual(
      expect.arrayContaining(["data.customer", "data.payment_intent.customer"])
    )
    expect(expandsByPath.get("/v1/payment_intents")).toEqual(
      expect.arrayContaining(["data.customer"])
    )
    expect(expandsByPath.get("/v1/charges")).toEqual(
      expect.arrayContaining(["data.customer", "data.payment_intent.customer"])
    )
    expect(expandsByPath.get("/v1/refunds")).toEqual(
      expect.arrayContaining(["data.charge.customer"])
    )
  })

  it("records that live-read mode provenance comes from the Stripe key prefix", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "photosweep-stripe-api-provenance-")
    )
    const ledgerPath = path.join(directory, "ledger.json")
    await fs.writeFile(ledgerPath, JSON.stringify({ purchases: [] }))

    const result = await runStripeLedgerEvidenceExport({
      argv: [
        "--from",
        "2026-09-01T00:00:00.000Z",
        "--to",
        "2026-10-01T00:00:00.000Z",
        "--ledger-export",
        ledgerPath
      ],
      env: { NODE_ENV: "development", STRIPE_SECRET: "sk_live_not_written" },
      fetchImpl: async () =>
        ({
          ok: true,
          async json() {
            return { data: [], has_more: false }
          }
        }) as Response
    })

    expect(result).toMatchObject({
      evidence: {
        stripeMode: "live",
        livemode: true,
        liveOnly: true,
        modeProvenance: {
          source: "stripe_api",
          modeFrom: "secret_key_mode_prefix"
        }
      }
    })
    if (!("serialized" in result)) {
      throw new Error("Expected serialized evidence output.")
    }
    expect(result.serialized).not.toContain("sk_live_not_written")
  })

  it("rejects a Stripe key from the wrong mode before making API requests", async () => {
    let requestMade = false
    await expect(
      fetchStripeLedgerObjects({
        fromMs: Date.parse("2026-09-01T00:00:00.000Z"),
        toMs: Date.parse("2026-10-01T00:00:00.000Z"),
        secret: "sk_test_not_written",
        stripeMode: "live",
        fetchImpl: async () => {
          requestMade = true
          return {
            ok: true,
            async json() {
              return { data: [], has_more: false }
            }
          } as Response
        }
      })
    ).rejects.toThrow(
      "STRIPE_SECRET is sandbox, but the requested mode is live"
    )
    expect(requestMade).toBe(false)
  })

  it("requires an explicit sandbox mode and labels empty sandbox evidence", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "photosweep-stripe-sandbox-evidence-")
    )
    const ledgerPath = path.join(directory, "ledger.json")
    const stripePath = path.join(directory, "stripe.json")
    await fs.writeFile(ledgerPath, JSON.stringify({ purchases: [] }))
    await fs.writeFile(
      stripePath,
      JSON.stringify({
        livemode: false,
        checkoutSessions: [],
        paymentIntents: [],
        charges: [],
        refunds: []
      })
    )

    await expect(
      runStripeLedgerEvidenceExport({
        argv: [
          "--from",
          "2026-09-01T00:00:00.000Z",
          "--to",
          "2026-10-01T00:00:00.000Z",
          "--ledger-export",
          ledgerPath,
          "--stripe-export",
          stripePath
        ]
      })
    ).rejects.toThrow("requested mode is live")

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
        "--stripe-mode",
        "sandbox"
      ]
    })

    expect(result).toMatchObject({
      evidence: {
        stripeMode: "sandbox",
        livemode: false,
        liveOnly: false,
        modeProvenance: {
          source: "offline_export",
          modeFrom: "object_fields_or_explicit_collection_marker"
        }
      }
    })
  })

  it("rejects output paths that would overwrite read-only inputs", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "photosweep-stripe-path-safety-")
    )
    const ledgerPath = path.join(directory, "ledger.json")
    const stripePath = path.join(directory, "stripe.json")
    await fs.writeFile(ledgerPath, JSON.stringify({ purchases: [] }))
    await fs.writeFile(stripePath, JSON.stringify({ refunds: [] }))

    await expect(
      runStripeLedgerEvidenceExport({
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
          ledgerPath
        ]
      })
    ).rejects.toThrow("would overwrite a read-only input export")
    await expect(fs.readFile(ledgerPath, "utf8")).resolves.toBe(
      JSON.stringify({ purchases: [] })
    )
  })
})
