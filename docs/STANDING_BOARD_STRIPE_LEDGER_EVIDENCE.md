# Standing Board Stripe Ledger Evidence

This document defines the Phase B Stripe ledger evidence export. The exporter is
read-only: it reads a Firestore/license-ledger snapshot and Stripe objects for a
bounded time window, then writes aggregate JSON. It does not change Stripe,
Firestore, entitlements, or board status.

## Pass conditions

The standing board pass conditions are:

1. `paid_checkouts` — “Checkout events are reconciled to Stripe event IDs and mapped to an allow-listed plan.”
2. `paid_customers` — “Distinct paid customer identities are derived from successful, non-refunded Stripe payments.”
3. `refunded_customers` — “Refunds are matched to their original payment and customer identity without double counting.”
4. `gross_revenue` — “All included successful payments share an explicit currency and reconcile to Stripe totals.”
5. `net_revenue` — “Net revenue equals reconciled gross revenue minus reconciled refunds for the same period and currency.”

The exporter does not emit a board PASS. Import the evidence only after the
owner or CoS reviews the `quality.blockers` and reconciliation rates.

## Ledger fields

For a successful Checkout webhook, the purchase row is backfilled without
replacing an existing entitlement decision. When available, it stores:

- `stripeCheckoutSessionId`
- `stripePaymentIntentId`
- `stripeChargeId`
- `stripeCustomerId`
- `stripeAmount` in the smallest currency unit
- `stripeCurrency`
- allow-listed `planId` (`mini_cleanup`, `cleanup_pass`, or `lifetime`)
- the existing entitlement `status`
- `stripeEventIds` and the latest `stripeEventId`
- `purchasedAt`, preserving an existing value when present
- `refundedAt` when a refund is observed

Full refunds and disputes still make only the matching purchase inactive.
Partial refunds enrich the row but do not revoke the whole entitlement. Stripe
event IDs are retained so a later webhook replay can fill missing fields while
remaining idempotent.

## Run the exporter

The package command is:

```bash
npm run stripe:reconcile -- \
  --from 2026-09-01T00:00:00Z \
  --to 2026-10-01T00:00:00Z \
  --ledger-export /secure/input/firestore-ledger.json \
  --stripe-export /secure/input/stripe-window.json \
  --output /secure/output/photosweep-stripe-ledger-evidence.json \
  --enrich-report /secure/output/photosweep-stripe-ledger-enrich-report.json
```

The ledger export may be a Firestore `snapshot()` JSON object containing
`licensesBySessionId`, a `purchases` array, a `licenses` array, or a direct
purchase-row array. The Stripe export contains
`checkoutSessions`, `paymentIntents`, `charges`, and `refunds` arrays. Offline
exports are useful for review and deterministic tests.

For an authorized live run, set credentials outside the repository and use
Firestore plus live Stripe reads:

```bash
export STRIPE_SECRET='<owner-provided Stripe restricted/read key>'
export GOOGLE_APPLICATION_CREDENTIALS='/secure/path/to/application-default-credentials.json'
export PHOTOSWEEP_FIRESTORE_COLLECTION_PREFIX='prod'
export GOOGLE_CLOUD_PROJECT='photosweep-prod'

npm run stripe:reconcile -- \
  --from 2026-09-01T00:00:00Z \
  --to 2026-10-01T00:00:00Z \
  --live-firestore \
  --output /secure/output/photosweep-stripe-ledger-evidence.json \
  --enrich-report /secure/output/photosweep-stripe-ledger-enrich-report.json
```

`STRIPE_SECRET` is required for live Stripe reads. The existing
`STRIPE_SECRET_KEY` name is accepted as a compatibility fallback, but new
evidence runs should use `STRIPE_SECRET`. Google Cloud authentication uses
Application Default Credentials; `GOOGLE_CLOUD_PROJECT` may also be set when
the runtime cannot infer the project. The three
`PHOTOSWEEP_STRIPE_PRICE_*` variables are optional for the exporter and let it
map an expanded Checkout line-item price when `metadata[planId]` is absent.
The exporter never prints credential values.

The live run lists Checkout Sessions, PaymentIntents, Charges, and Refunds with
the requested window and follows Stripe pagination. It expands the Stripe
Customer relationship where available, but does not use customer email,
customer name, receipt email, or other full customer PII in either output.
`--enrich-report` is an optional dry run: it lists row indexes and opaque Stripe
IDs that are uniquely matchable, plus ambiguous/unmatched rows, for a later
owner/CoS-approved backfill. It never writes Firestore.

## Reading the JSON

The five board metrics are in `metrics`:

- `paid_checkouts`, `paid_customers`, and `refunded_customers` are counts.
- `gross_revenue.amountMinor` and `net_revenue.amountMinor` are integer
  amounts in the reported currency.
- A `null` revenue amount means the run found a currency/amount completeness
  problem. `amountsByCurrency` remains available for review.
- `currencyConsistent` must be true before treating a single-currency revenue
  result as complete.

Store Growth should import these exact top-level JSON paths:

- `metrics.paid_checkouts`
- `metrics.paid_customers`
- `metrics.refunded_customers`
- `metrics.gross_revenue.amountMinor` and `.currency`
- `metrics.net_revenue.amountMinor` and `.currency`
- `quality.blockers`
- `reconciliation`

Do not convert a metric into a board PASS while `quality.blockers` is
non-empty or the relevant `reconciliation.*.rate` is below the owner-approved
threshold.

`reconciliation` reports `total`, `matched`, `unmatched`, and `rate` for:

- `paidCheckoutSessions`: an exact Checkout Session ID match is the primary
  rate. `matchedByAnyStripeId` separately shows a match through PaymentIntent
  or Charge.
- `purchaseRows`: `matchedByCheckoutId` exposes the specific historical gap
  where a purchase row lacks a Checkout Session ID. `matchedByAnyStripeId`
  shows whether another Stripe identifier still ties it to a payment.
  `matchedByLicenseSessionId` and
  `matchedByAnyStripeIdOrLicenseSessionId` expose the durable Checkout
  metadata/session link used by the optional dry-run report. The report's
  `uniqueMatchCount` is not a write or a PASS.
- `successfulPayments`: payment rows matched to the ledger by Checkout
  Session, PaymentIntent, or Charge.
- `refunds`: refund objects paired to a successful payment.

`quality.blockers` is intentionally evidence-oriented. Examples include
`purchase_rows_missing_stripe_checkout_match`,
`successful_payments_without_customer_identity`,
`refunds_without_customer_identity`,
`refunds_without_original_payment_match`, and
`gross_revenue_currency_or_amount_gap`. Unknown or expired/unpaid Checkout
Sessions are not counted as `paid_checkouts`; successful payments without an
allow-listed plan are not included in revenue or customer counts and are
reported as an unmapped-payment blocker.

Refunds are deduplicated by Stripe refund ID, paired by PaymentIntent or
Charge, and subtracted once from the matching payment in the same currency.
`refund_currency_mismatch` blocks a net amount rather than subtracting a
cross-currency value.
Customers with a successful payment and any matched refund are excluded from
`paid_customers`; `refunded_customers` counts each resolved customer once.
The exporter prefers an expanded Stripe Customer object (or its opaque ID) from
the Checkout Session, PaymentIntent, Charge, or Refund. Guest Checkout can
legitimately have no Stripe Customer object: in that case it uses an internal,
non-exported guest surrogate keyed by the PaymentIntent ID, or by the Charge ID
when no PaymentIntent exists. This is a payment-level identity, not a claim
that two guest payments belong to the same person. It never uses email, name,
receipt email, or other customer PII. A payment with neither a Stripe Customer
nor a PaymentIntent/Charge identity remains unresolved and blocks the customer
metric.

The exporter is read-only. A future webhook replay enriches rows that are
already identifiable by the license session or a Stripe payment identifier.
Historical rows that remain unmatched after the authorized export require a
separate owner-run one-time backfill/replay; this PR does not invent evidence
for those rows. The optional report is a dry run only and sets
`backfillRequiresOwnerApproval: true`.

## Revenue and balance transactions

For these standing-board metrics, `net_revenue` is explicitly defined as
successful payment amounts minus successful refunds in the same bounded window
and currency. Charges and Refunds therefore provide the required gross-minus-
refunds arithmetic; this is not Stripe payout net, and it does not subtract
processing fees or disputes. Balance Transactions are intentionally not used by
this exporter. If Store Growth needs fee-adjusted payout reporting later, that
must be a separate, currency-safe balance-transaction reconciliation.
