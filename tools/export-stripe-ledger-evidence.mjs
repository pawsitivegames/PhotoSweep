#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createFirestoreLicenseStore } from "../server/firestore-license-store.mjs"
import { reconcileStripeLedger } from "../server/stripe-ledger-reconcile.mjs"

const STRIPE_API_BASE = "https://api.stripe.com/v1"
const STRIPE_API_VERSION = "2026-02-25.clover"

function usage() {
  return `Usage:
  npm run stripe:reconcile -- --from <ISO> --to <ISO> \\
    --ledger-export <path> --stripe-export <path> [--output <path>]

Live sources:
  --live-firestore       Read the Firestore license snapshot using ADC.
  (omit --stripe-export) List Stripe objects with STRIPE_SECRET.

Offline sources:
  --ledger-export <path> JSON Firestore snapshot or purchase-row export.
  --stripe-export <path> JSON object with checkoutSessions, paymentIntents,
                         charges, and refunds arrays.

Required:
  --from <ISO>           Inclusive window start.
  --to <ISO>             Exclusive window end.
  One ledger source and one Stripe source.
`
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--help" || argument === "-h") {
      args.help = true
      continue
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`)
    }
    const key = argument.slice(2)
    if (key === "live-firestore") {
      args.liveFirestore = true
      continue
    }
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}.`)
    }
    args[key] = value
    index += 1
  }
  return args
}

function parseTimestamp(value, option) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${option} must be an ISO-8601 timestamp.`)
  }
  return parsed
}

function requiredSecret(env) {
  const secret = env.STRIPE_SECRET ?? env.STRIPE_SECRET_KEY
  if (!secret) {
    throw new Error(
      "Missing STRIPE_SECRET. Set it outside the repository before a live Stripe run."
    )
  }
  return secret
}

function pricePlanMap(env) {
  return Object.fromEntries(
    [
      [env.PHOTOSWEEP_STRIPE_PRICE_MINI_CLEANUP, "mini_cleanup"],
      [env.PHOTOSWEEP_STRIPE_PRICE_CLEANUP_PASS_7D, "cleanup_pass"],
      [env.PHOTOSWEEP_STRIPE_PRICE_LIFETIME_EARLY_ACCESS, "lifetime"]
    ].filter(([priceId]) => priceId)
  )
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"))
}

async function listStripeCollection({
  resource,
  fromMs,
  toMs,
  secret,
  expands,
  fetchImpl = fetch
}) {
  const objects = []
  let startingAfter
  while (true) {
    const url = new URL(`${STRIPE_API_BASE}${resource}`)
    url.searchParams.set("limit", "100")
    url.searchParams.set("created[gte]", String(Math.floor(fromMs / 1000)))
    url.searchParams.set("created[lt]", String(Math.floor(toMs / 1000)))
    for (const expand of expands) url.searchParams.append("expand[]", expand)
    if (startingAfter) url.searchParams.set("starting_after", startingAfter)

    const response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${secret}`,
        "stripe-version": STRIPE_API_VERSION
      }
    })
    if (!response.ok) {
      throw new Error(`Stripe ${resource} request failed (${response.status}).`)
    }
    const body = await response.json()
    const page = Array.isArray(body?.data) ? body.data : []
    objects.push(...page)
    if (!body?.has_more || page.length === 0) break
    const nextId = page[page.length - 1]?.id
    if (!nextId || nextId === startingAfter) {
      throw new Error(`Stripe ${resource} pagination did not advance.`)
    }
    startingAfter = nextId
  }
  return objects
}

export async function fetchStripeLedgerObjects({
  fromMs,
  toMs,
  secret,
  fetchImpl = fetch
}) {
  const [checkoutSessions, paymentIntents, charges, refunds] =
    await Promise.all([
      listStripeCollection({
        resource: "/checkout/sessions",
        fromMs,
        toMs,
        secret,
        fetchImpl,
        expands: ["data.payment_intent", "data.customer"]
      }),
      listStripeCollection({
        resource: "/payment_intents",
        fromMs,
        toMs,
        secret,
        fetchImpl,
        expands: ["data.customer", "data.latest_charge"]
      }),
      listStripeCollection({
        resource: "/charges",
        fromMs,
        toMs,
        secret,
        fetchImpl,
        expands: ["data.payment_intent", "data.customer"]
      }),
      listStripeCollection({
        resource: "/refunds",
        fromMs,
        toMs,
        secret,
        fetchImpl,
        expands: ["data.charge", "data.payment_intent"]
      })
    ])
  return { checkoutSessions, paymentIntents, charges, refunds }
}

async function loadLedger(args, env) {
  const ledgerPath = args["ledger-export"] ?? args.ledger
  if (ledgerPath) return readJson(ledgerPath)
  if (!args.liveFirestore) {
    throw new Error(
      "Provide --ledger-export <path> or --live-firestore for the ledger source."
    )
  }
  const store = createFirestoreLicenseStore({
    collectionPrefix: env.PHOTOSWEEP_FIRESTORE_COLLECTION_PREFIX
  })
  return store.snapshot()
}

async function loadStripe(args, { fromMs, toMs, env, fetchImpl }) {
  const stripePath = args["stripe-export"] ?? args.stripe
  if (stripePath) return readJson(stripePath)
  return fetchStripeLedgerObjects({
    fromMs,
    toMs,
    secret: requiredSecret(env),
    fetchImpl
  })
}

export async function runStripeLedgerEvidenceExport({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  now = new Date()
} = {}) {
  const args = parseArgs(argv)
  if (args.help) return { help: usage() }
  const fromMs = parseTimestamp(args.from, "--from")
  const toMs = parseTimestamp(args.to, "--to")
  if (toMs <= fromMs) throw new Error("--to must be after --from.")
  const ledger = await loadLedger(args, env)
  const stripe = await loadStripe(args, { fromMs, toMs, env, fetchImpl })
  const evidence = reconcileStripeLedger({
    ledger,
    stripe,
    fromMs,
    toMs,
    pricePlanMap: pricePlanMap(env),
    generatedAt: now.toISOString()
  })
  const outputPath = args.output
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`
  if (outputPath) {
    const absolutePath = path.resolve(outputPath)
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, serialized)
    return { outputPath: absolutePath, evidence }
  }
  return { evidence, serialized }
}

const currentFile = fileURLToPath(import.meta.url)
const invokedFile = process.argv[1]
  ? fileURLToPath(pathToFileURL(process.argv[1]))
  : ""

if (currentFile === invokedFile) {
  runStripeLedgerEvidenceExport()
    .then((result) => {
      if (result.help) {
        process.stdout.write(result.help)
        return
      }
      if (result.serialized) {
        process.stdout.write(result.serialized)
        return
      }
      process.stdout.write(`Wrote ${result.outputPath}\n`)
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      )
      process.stderr.write(usage())
      process.exitCode = 1
    })
}
