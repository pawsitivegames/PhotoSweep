const ALLOWLISTED_PLAN_IDS = Object.freeze([
  "mini_cleanup",
  "cleanup_pass",
  "lifetime"
])
const ALLOWLISTED_PLAN_SET = new Set(ALLOWLISTED_PLAN_IDS)

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function integerAmount(value) {
  const number = finiteNumber(value)
  return Number.isInteger(number) && number >= 0 ? number : undefined
}

function objectId(value) {
  if (typeof value === "string" && value) return value
  if (isRecord(value) && typeof value.id === "string" && value.id) {
    return value.id
  }
  return undefined
}

function normalizeCurrency(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : undefined
}

function timestampMs(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) < 100_000_000_000 ? value * 1000 : value
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function stripeCreatedAtMs(value) {
  return timestampMs(value?.created)
}

function valueInWindow(value, fromMs, toMs) {
  const valueMs = timestampMs(value)
  if (valueMs === undefined) return true
  if (fromMs !== undefined && valueMs < fromMs) return false
  if (toMs !== undefined && valueMs >= toMs) return false
  return true
}

function resourceArray(value) {
  if (Array.isArray(value)) return value
  if (isRecord(value) && Array.isArray(value.data)) return value.data
  return []
}

function collection(input, ...keys) {
  for (const key of keys) {
    if (input && Object.prototype.hasOwnProperty.call(input, key)) {
      return resourceArray(input[key])
    }
  }
  return []
}

function uniqueObjects(objects, fallbackPrefix) {
  const result = []
  const seen = new Set()
  for (const [index, object] of objects.entries()) {
    if (!isRecord(object)) continue
    const key = objectId(object) ?? `${fallbackPrefix}:${index}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(object)
  }
  return result
}

function paymentIntentId(object) {
  const id =
    objectId(object?.payment_intent) ??
    objectId(object?.paymentIntentId) ??
    objectId(object?.charge?.payment_intent) ??
    objectId(object?.latest_charge?.payment_intent)
  if (id) return id
  return typeof object?.id === "string" && object.id.startsWith("pi_")
    ? object.id
    : undefined
}

function checkoutSessionId(object) {
  const id =
    objectId(object?.checkout_session) ??
    objectId(object?.checkoutSessionId) ??
    objectId(object?.session)
  if (id) return id
  return typeof object?.id === "string" && object.id.startsWith("cs_")
    ? object.id
    : undefined
}

function chargeId(object) {
  const id =
    objectId(object?.charge) ??
    objectId(object?.latest_charge) ??
    objectId(object?.chargeId) ??
    objectId(object?.payment_intent?.latest_charge)
  if (id) return id
  return typeof object?.id === "string" && object.id.startsWith("ch_")
    ? object.id
    : undefined
}

function customerId(object) {
  return (
    objectId(object?.customer) ??
    objectId(object?.payment_intent?.customer) ??
    objectId(object?.charge?.customer) ??
    objectId(object?.latest_charge?.customer)
  )
}

function paymentAmount(object) {
  const candidates = [
    object?.amount_received,
    object?.amount_total,
    object?.amount,
    object?.payment_intent?.amount_received,
    object?.payment_intent?.amount,
    object?.charge?.amount,
    object?.latest_charge?.amount
  ]
  return candidates.map(integerAmount).find((value) => value !== undefined)
}

function paymentCurrency(object) {
  return (
    normalizeCurrency(object?.currency) ??
    normalizeCurrency(object?.payment_intent?.currency) ??
    normalizeCurrency(object?.charge?.currency) ??
    normalizeCurrency(object?.latest_charge?.currency)
  )
}

function metadataPlanId(object) {
  const candidates = [
    object?.metadata?.planId,
    object?.metadata?.plan_id,
    object?.payment_intent?.metadata?.planId,
    object?.payment_intent?.metadata?.plan_id,
    object?.charge?.metadata?.planId,
    object?.latest_charge?.metadata?.planId
  ]
  return candidates.find(
    (value) => typeof value === "string" && ALLOWLISTED_PLAN_SET.has(value)
  )
}

function priceIds(object) {
  const values = []
  const lineItems = [
    ...(Array.isArray(object?.line_items?.data) ? object.line_items.data : []),
    ...(Array.isArray(object?.lineItems) ? object.lineItems : [])
  ]
  for (const item of lineItems) {
    const price = item?.price ?? item
    const id = objectId(price)
    if (id) values.push(id)
  }
  const directPriceId = objectId(object?.price)
  if (directPriceId) values.push(directPriceId)
  return values
}

function planIdFromObject(object, pricePlanMap = {}) {
  const metadataPlan = metadataPlanId(object)
  if (metadataPlan) return metadataPlan
  for (const priceId of priceIds(object)) {
    const planId = pricePlanMap[priceId]
    if (ALLOWLISTED_PLAN_SET.has(planId)) return planId
  }
  return undefined
}

function stripeIds(object) {
  return {
    checkoutSessionId: checkoutSessionId(object),
    paymentIntentId: paymentIntentId(object),
    chargeId: chargeId(object)
  }
}

function ledgerRowsFromLicense(license) {
  if (!isRecord(license)) return []
  if (Array.isArray(license.purchases)) {
    return license.purchases.filter(isRecord)
  }
  const { purchases: _purchases, ...purchase } = license
  return [purchase]
}

function rawLedgerRows(input) {
  if (Array.isArray(input)) return input.filter(isRecord)
  if (!isRecord(input)) return []
  if (Array.isArray(input.purchases)) return input.purchases.filter(isRecord)
  if (Array.isArray(input.licenses)) {
    return input.licenses.flatMap(ledgerRowsFromLicense)
  }
  if (isRecord(input.licensesBySessionId)) {
    return Object.values(input.licensesBySessionId).flatMap(
      ledgerRowsFromLicense
    )
  }
  if (isRecord(input.licenses)) {
    return Object.values(input.licenses).flatMap(ledgerRowsFromLicense)
  }
  if (isRecord(input.data)) return rawLedgerRows(input.data)
  return [input]
}

function normalizedLedgerRow(row) {
  return {
    ...row,
    planId: ALLOWLISTED_PLAN_SET.has(row.planId) ? row.planId : undefined,
    stripeCheckoutSessionId:
      objectId(row.stripeCheckoutSessionId) ?? objectId(row.checkoutSessionId),
    stripePaymentIntentId:
      objectId(row.stripePaymentIntentId) ?? objectId(row.paymentIntentId),
    stripeChargeId: objectId(row.stripeChargeId) ?? objectId(row.chargeId),
    stripeCustomerId:
      objectId(row.stripeCustomerId) ?? objectId(row.customerId),
    stripeAmount:
      integerAmount(row.stripeAmount) ??
      integerAmount(row.amount) ??
      integerAmount(row.amountMinor),
    stripeCurrency:
      normalizeCurrency(row.stripeCurrency) ?? normalizeCurrency(row.currency)
  }
}

export function normalizeLedgerPurchases(input, { fromMs, toMs } = {}) {
  return rawLedgerRows(input)
    .map(normalizedLedgerRow)
    .filter((row) => valueInWindow(row.purchasedAt, fromMs, toMs))
}

function hasSuccessfulPaymentStatus(paymentIntent) {
  if (paymentIntent?.status === "succeeded") return true
  return (
    paymentIntent?.status === undefined &&
    integerAmount(paymentIntent?.amount_received) !== undefined &&
    paymentIntent.amount_received > 0
  )
}

function hasSuccessfulChargeStatus(charge) {
  if (charge?.paid === true || charge?.status === "succeeded") return true
  return (
    charge?.paid === undefined &&
    charge?.status === undefined &&
    integerAmount(charge?.amount) !== undefined &&
    charge.amount > 0
  )
}

function isSuccessfulRefund(refund) {
  return refund?.status === undefined || refund.status === "succeeded"
}

function isPaidCheckout(session) {
  return session?.payment_status === "paid"
}

function mergeDefined(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && target[key] === undefined) target[key] = value
  }
  return target
}

function mergePaymentRecord(target, source) {
  mergeDefined(target, source)
  if (!target.planId && source.planId) target.planId = source.planId
  if (!target.stripeCustomerId && source.stripeCustomerId) {
    target.stripeCustomerId = source.stripeCustomerId
  }
  if (!target.stripeCheckoutSessionId && source.stripeCheckoutSessionId) {
    target.stripeCheckoutSessionId = source.stripeCheckoutSessionId
  }
  if (!target.stripeChargeId && source.stripeChargeId) {
    target.stripeChargeId = source.stripeChargeId
  }
  if (!target.stripeAmount && source.stripeAmount !== undefined) {
    target.stripeAmount = source.stripeAmount
  }
  if (!target.stripeCurrency && source.stripeCurrency) {
    target.stripeCurrency = source.stripeCurrency
  }
  return target
}

function paymentRecordFromObject(object, pricePlanMap, kind) {
  const ids = stripeIds(object)
  return {
    key: `${kind}:${objectId(object) ?? `${kind}-anonymous`}`,
    stripeCheckoutSessionId: ids.checkoutSessionId,
    stripePaymentIntentId: ids.paymentIntentId,
    stripeChargeId: ids.chargeId,
    stripeCustomerId: customerId(object),
    stripeAmount: paymentAmount(object),
    stripeCurrency: paymentCurrency(object),
    planId: planIdFromObject(object, pricePlanMap),
    createdAtMs: stripeCreatedAtMs(object),
    success: true
  }
}

function findPayment(payments, ids) {
  return payments.find(
    (payment) =>
      (ids.paymentIntentId &&
        payment.stripePaymentIntentId === ids.paymentIntentId) ||
      (ids.chargeId && payment.stripeChargeId === ids.chargeId) ||
      (ids.checkoutSessionId &&
        payment.stripeCheckoutSessionId === ids.checkoutSessionId)
  )
}

function matchLedgerRow(row, payments, checkoutSessions) {
  return (
    checkoutSessions.some(
      (session) =>
        row.stripeCheckoutSessionId &&
        row.stripeCheckoutSessionId === session.id
    ) ||
    payments.some(
      (payment) =>
        (row.stripePaymentIntentId &&
          row.stripePaymentIntentId === payment.stripePaymentIntentId) ||
        (row.stripeChargeId && row.stripeChargeId === payment.stripeChargeId) ||
        (row.stripeCheckoutSessionId &&
          row.stripeCheckoutSessionId === payment.stripeCheckoutSessionId)
    )
  )
}

function ledgerRowForPayment(payment, ledger) {
  return ledger.find(
    (row) =>
      (payment.stripePaymentIntentId &&
        row.stripePaymentIntentId === payment.stripePaymentIntentId) ||
      (payment.stripeChargeId &&
        row.stripeChargeId === payment.stripeChargeId) ||
      (payment.stripeCheckoutSessionId &&
        row.stripeCheckoutSessionId === payment.stripeCheckoutSessionId)
  )
}

function reconciliation(total, matched) {
  return {
    total,
    matched,
    unmatched: total - matched,
    rate: total === 0 ? null : matched / total
  }
}

function amountByCurrency(records, amountField = "stripeAmount") {
  const totals = {}
  let complete = 0
  let missing = 0
  for (const record of records) {
    const amount = integerAmount(record[amountField])
    const currency = normalizeCurrency(record.stripeCurrency)
    if (amount === undefined || !currency) {
      missing += 1
      continue
    }
    totals[currency] = (totals[currency] ?? 0) + amount
    complete += 1
  }
  const currencies = Object.keys(totals).sort()
  return { totals, currencies, complete, missing }
}

function summarizeRefunds(refunds) {
  const totals = {}
  const currencies = new Set()
  let missing = 0
  for (const refund of refunds) {
    const amount = integerAmount(refund.amount)
    const currency = normalizeCurrency(refund.currency)
    if (amount === undefined || !currency) {
      missing += 1
      continue
    }
    currencies.add(currency)
    totals[currency] = (totals[currency] ?? 0) + amount
  }
  return { totals, currencies: [...currencies].sort(), missing }
}

function metricAmount(totals, currencies, complete, missing, count) {
  const currency = currencies.length === 1 ? currencies[0] : null
  return {
    amountMinor:
      currencies.length === 1 && missing === 0 ? totals[currency] : null,
    currency,
    currencies,
    amountsByCurrency: totals,
    count,
    completeCount: complete,
    missingAmountOrCurrencyCount: missing
  }
}

function idSet(rows, field) {
  return new Set(rows.map((row) => row[field]).filter(Boolean))
}

function appendBlocker(blockers, value) {
  if (!blockers.includes(value)) blockers.push(value)
}

export function reconcileStripeLedger({
  ledger,
  stripe,
  fromMs,
  toMs,
  pricePlanMap = {},
  generatedAt = undefined
} = {}) {
  const ledgerRows = normalizeLedgerPurchases(ledger, { fromMs, toMs })
  const stripeInput = isRecord(stripe) ? stripe : {}
  const checkoutSessionObjects = uniqueObjects(
    collection(
      stripeInput,
      "checkoutSessions",
      "checkout_sessions",
      "sessions"
    ),
    "checkout"
  ).filter((session) => valueInWindow(session.created, fromMs, toMs))
  const paymentIntentObjects = uniqueObjects(
    collection(stripeInput, "paymentIntents", "payment_intents"),
    "payment_intent"
  ).filter((paymentIntent) =>
    valueInWindow(paymentIntent.created, fromMs, toMs)
  )
  const chargeObjects = uniqueObjects(
    collection(stripeInput, "charges"),
    "charge"
  ).filter((charge) => valueInWindow(charge.created, fromMs, toMs))
  const refundFeedPresent =
    Object.prototype.hasOwnProperty.call(stripeInput, "refunds") ||
    Object.prototype.hasOwnProperty.call(stripeInput, "refundsList")
  const refundObjects = uniqueObjects(
    collection(stripeInput, "refunds", "refundsList"),
    "refund"
  ).filter((refund) => valueInWindow(refund.created, fromMs, toMs))

  const checkoutSessions = checkoutSessionObjects.map((session) => ({
    id: objectId(session),
    planId: planIdFromObject(session, pricePlanMap),
    paymentIntentId: paymentIntentId(session),
    chargeId: chargeId(session),
    customerId: customerId(session),
    amount: paymentAmount(session),
    currency: paymentCurrency(session),
    paid: isPaidCheckout(session)
  }))

  const paymentsByKey = new Map()
  function addPayment(record) {
    if (!record.key) return
    const existing = paymentsByKey.get(record.key)
    if (existing) mergePaymentRecord(existing, record)
    else paymentsByKey.set(record.key, record)
  }

  for (const paymentIntent of paymentIntentObjects) {
    if (!hasSuccessfulPaymentStatus(paymentIntent)) continue
    addPayment(
      paymentRecordFromObject(paymentIntent, pricePlanMap, "payment_intent")
    )
  }

  for (const charge of chargeObjects) {
    if (!hasSuccessfulChargeStatus(charge)) continue
    const record = paymentRecordFromObject(charge, pricePlanMap, "charge")
    const existing = [...paymentsByKey.values()].find(
      (payment) =>
        (record.stripePaymentIntentId &&
          record.stripePaymentIntentId === payment.stripePaymentIntentId) ||
        (record.stripeChargeId &&
          record.stripeChargeId === payment.stripeChargeId)
    )
    if (existing) mergePaymentRecord(existing, record)
    else addPayment(record)
  }

  for (const session of checkoutSessions) {
    if (!session.paid || !session.planId) continue
    const payment = findPayment([...paymentsByKey.values()], {
      paymentIntentId: session.paymentIntentId,
      chargeId: session.chargeId,
      checkoutSessionId: session.id
    })
    const sessionRecord = {
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: session.paymentIntentId,
      stripeChargeId: session.chargeId,
      stripeCustomerId: session.customerId,
      stripeAmount: session.amount,
      stripeCurrency: session.currency,
      planId: session.planId,
      createdAtMs: stripeCreatedAtMs(
        checkoutSessionObjects.find((item) => objectId(item) === session.id)
      ),
      success: true
    }
    if (payment) {
      mergePaymentRecord(payment, sessionRecord)
    } else {
      addPayment({
        ...sessionRecord,
        key: `checkout:${session.id}`
      })
    }
  }

  const payments = [...paymentsByKey.values()]
  for (const payment of payments) {
    const row = ledgerRowForPayment(payment, ledgerRows)
    if (!payment.planId && row?.planId) payment.planId = row.planId
    if (!payment.stripeCustomerId && row?.stripeCustomerId) {
      payment.stripeCustomerId = row.stripeCustomerId
    }
  }

  const refunds = []
  const refundIds = new Set()
  for (const refund of refundObjects) {
    if (!isSuccessfulRefund(refund)) continue
    const id =
      objectId(refund) ??
      [paymentIntentId(refund), chargeId(refund), refund.created, refund.amount]
        .filter((value) => value !== undefined)
        .join(":")
    if (refundIds.has(id)) continue
    refundIds.add(id)
    const ids = stripeIds(refund)
    refunds.push({
      id,
      paymentIntentId: ids.paymentIntentId,
      chargeId: ids.chargeId,
      customerId: customerId(refund),
      amount: integerAmount(refund.amount),
      currency: paymentCurrency(refund),
      createdAtMs: stripeCreatedAtMs(refund)
    })
  }

  if (!refundFeedPresent) {
    for (const charge of chargeObjects) {
      const amountRefunded = integerAmount(charge.amount_refunded)
      if (!amountRefunded || amountRefunded <= 0) continue
      const ids = stripeIds(charge)
      const id = `charge-aggregate:${ids.chargeId ?? ids.paymentIntentId}`
      if (refundIds.has(id)) continue
      refundIds.add(id)
      refunds.push({
        id,
        paymentIntentId: ids.paymentIntentId,
        chargeId: ids.chargeId,
        customerId: customerId(charge),
        amount: amountRefunded,
        currency: paymentCurrency(charge),
        createdAtMs: stripeCreatedAtMs(charge)
      })
    }
  }

  const refundsByPayment = new Map()
  let unmatchedRefunds = 0
  for (const refund of refunds) {
    const payment = findPayment(payments, {
      paymentIntentId: refund.paymentIntentId,
      chargeId: refund.chargeId
    })
    if (!payment) {
      unmatchedRefunds += 1
      continue
    }
    if (!payment.stripeCustomerId && refund.customerId) {
      payment.stripeCustomerId = refund.customerId
    }
    const matched = refundsByPayment.get(payment.key) ?? []
    matched.push(refund)
    refundsByPayment.set(payment.key, matched)
  }

  const paidCheckoutSessions = checkoutSessions.filter(
    (session) => session.paid && session.planId
  )
  const eligiblePayments = payments.filter(
    (payment) => payment.success && ALLOWLISTED_PLAN_SET.has(payment.planId)
  )
  const refundedPaymentKeys = new Set()
  for (const [key, matchedRefunds] of refundsByPayment) {
    if (matchedRefunds.some((refund) => (refund.amount ?? 0) > 0)) {
      refundedPaymentKeys.add(key)
    }
  }
  const nonRefundedPayments = eligiblePayments.filter(
    (payment) => !refundedPaymentKeys.has(payment.key)
  )
  const paidCustomerIds = new Set(
    nonRefundedPayments
      .map((payment) => payment.stripeCustomerId)
      .filter(Boolean)
  )
  const refundedCustomerIds = new Set(
    eligiblePayments
      .filter((payment) => refundedPaymentKeys.has(payment.key))
      .map((payment) => payment.stripeCustomerId)
      .filter(Boolean)
  )

  const checkoutMatchedById = paidCheckoutSessions.filter((session) =>
    ledgerRows.some((row) => row.stripeCheckoutSessionId === session.id)
  ).length
  const checkoutMatchedByAnyId = paidCheckoutSessions.filter((session) =>
    ledgerRows.some(
      (row) =>
        row.stripeCheckoutSessionId === session.id ||
        row.stripePaymentIntentId === session.paymentIntentId ||
        row.stripeChargeId === session.chargeId
    )
  ).length
  const ledgerCheckoutMatched = ledgerRows.filter((row) =>
    paidCheckoutSessions.some(
      (session) => row.stripeCheckoutSessionId === session.id
    )
  ).length
  const ledgerAnyMatched = ledgerRows.filter((row) =>
    matchLedgerRow(
      row,
      payments,
      paidCheckoutSessions.map((session) => ({ id: session.id }))
    )
  ).length
  const paymentMatched = eligiblePayments
    .filter((payment) =>
      matchLedgerRow(
        {
          stripeCheckoutSessionId: payment.stripeCheckoutSessionId,
          stripePaymentIntentId: payment.stripePaymentIntentId,
          stripeChargeId: payment.stripeChargeId
        },
        payments,
        paidCheckoutSessions.map((session) => ({ id: session.id }))
      )
    )
    .filter((payment) => ledgerRowForPayment(payment, ledgerRows)).length

  const grossRecords = eligiblePayments
  const gross = amountByCurrency(grossRecords)
  const refundSummary = summarizeRefunds(refunds)
  const refundTotals = summarizeRefunds(
    [...refundsByPayment.values()].flat().filter((refund) => {
      const payment = payments.find((item) =>
        (refundsByPayment.get(item.key) ?? []).includes(refund)
      )
      return payment && ALLOWLISTED_PLAN_SET.has(payment.planId)
    })
  ).totals
  const netTotals = { ...gross.totals }
  for (const [currency, amount] of Object.entries(refundTotals)) {
    netTotals[currency] = (netTotals[currency] ?? 0) - amount
  }
  const netCurrencies = Object.keys(netTotals).sort()
  const grossMetric = metricAmount(
    gross.totals,
    gross.currencies,
    gross.complete,
    gross.missing,
    grossRecords.length
  )
  const netMetric = {
    ...metricAmount(
      netTotals,
      netCurrencies,
      gross.complete,
      gross.missing,
      grossRecords.length
    ),
    refundAmountMinorByCurrency: refundTotals
  }

  const unresolvedCustomerPayments = eligiblePayments.filter(
    (payment) => !payment.stripeCustomerId
  ).length
  const unresolvedRefundedPayments = eligiblePayments.filter(
    (payment) =>
      refundedPaymentKeys.has(payment.key) && !payment.stripeCustomerId
  ).length
  const unmappedSuccessfulPayments = payments.filter(
    (payment) => payment.success && !ALLOWLISTED_PLAN_SET.has(payment.planId)
  ).length
  const blockers = []
  if (checkoutMatchedById !== paidCheckoutSessions.length) {
    appendBlocker(blockers, "unmatched_paid_checkout_sessions")
  }
  if (ledgerCheckoutMatched !== ledgerRows.length) {
    appendBlocker(blockers, "purchase_rows_missing_stripe_checkout_match")
  }
  if (unmappedSuccessfulPayments > 0) {
    appendBlocker(blockers, "successful_payments_without_allowlisted_plan")
  }
  if (unresolvedCustomerPayments > 0) {
    appendBlocker(blockers, "successful_payments_without_customer_id")
  }
  if (unresolvedRefundedPayments > 0) {
    appendBlocker(blockers, "refunds_without_customer_id")
  }
  if (gross.missing > 0 || gross.currencies.length !== 1) {
    appendBlocker(blockers, "gross_revenue_currency_or_amount_gap")
  }
  if (refundSummary.missing > 0) {
    appendBlocker(blockers, "refunds_missing_amount_or_currency")
  }
  if (Object.values(netTotals).some((amount) => amount < 0)) {
    appendBlocker(blockers, "refunds_exceed_gross_revenue")
  }
  if (unmatchedRefunds > 0) {
    appendBlocker(blockers, "refunds_without_original_payment_match")
  }

  const result = {
    schemaVersion: 1,
    ...(generatedAt ? { generatedAt } : {}),
    window: {
      from: fromMs === undefined ? null : new Date(fromMs).toISOString(),
      to: toMs === undefined ? null : new Date(toMs).toISOString()
    },
    currency:
      gross.currencies.length === 1 && netCurrencies.length === 1
        ? gross.currencies[0]
        : null,
    currencyConsistent:
      gross.missing === 0 &&
      refundSummary.missing === 0 &&
      gross.currencies.length === 1 &&
      netCurrencies.length === 1 &&
      netCurrencies[0] === gross.currencies[0] &&
      refundSummary.currencies.every(
        (currency) => currency === gross.currencies[0]
      ),
    metrics: {
      paid_checkouts: paidCheckoutSessions.length,
      paid_customers: paidCustomerIds.size,
      refunded_customers: refundedCustomerIds.size,
      gross_revenue: grossMetric,
      net_revenue: netMetric
    },
    metricDetails: {
      paid_checkouts: {
        mappedToAllowlistedPlan: paidCheckoutSessions.length,
        unmatchedCustomerIdCount: paidCheckoutSessions.filter(
          (session) => !session.customerId
        ).length
      },
      paid_customers: {
        eligibleSuccessfulPaymentCount: eligiblePayments.length,
        unresolvedCustomerPaymentCount: unresolvedCustomerPayments,
        refundedPaymentCount: refundedPaymentKeys.size
      },
      refunded_customers: {
        refundedPaymentCount: refundedPaymentKeys.size,
        unresolvedCustomerPaymentCount: unresolvedRefundedPayments
      },
      gross_revenue: {
        successfulPaymentCount: grossRecords.length,
        unmappedSuccessfulPaymentCount: unmappedSuccessfulPayments
      },
      net_revenue: {
        matchedRefundCount: [...refundsByPayment.values()].flat().length,
        unmatchedRefundCount: unmatchedRefunds,
        missingAmountOrCurrencyCount: refundSummary.missing
      }
    },
    reconciliation: {
      paidCheckoutSessions: {
        ...reconciliation(paidCheckoutSessions.length, checkoutMatchedById),
        matchedByAnyStripeId: checkoutMatchedByAnyId,
        unmatchedByCheckoutId: paidCheckoutSessions.length - checkoutMatchedById
      },
      purchaseRows: {
        ...reconciliation(ledgerRows.length, ledgerCheckoutMatched),
        matchedByCheckoutId: ledgerCheckoutMatched,
        matchedByAnyStripeId: ledgerAnyMatched
      },
      successfulPayments: reconciliation(
        eligiblePayments.length,
        paymentMatched
      ),
      refunds: reconciliation(refunds.length, refunds.length - unmatchedRefunds)
    },
    quality: {
      blockers,
      unresolvedCustomerPaymentCount: unresolvedCustomerPayments,
      unmatchedRefundCount: unmatchedRefunds,
      unmappedSuccessfulPaymentCount: unmappedSuccessfulPayments,
      ledgerRowCount: ledgerRows.length
    },
    privacy: {
      containsEmails: false,
      containsNames: false,
      containsFullCustomerPii: false,
      customerIdsExported: false
    }
  }

  return result
}

export { ALLOWLISTED_PLAN_IDS }
