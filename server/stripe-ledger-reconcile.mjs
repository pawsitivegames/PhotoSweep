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

function stripeLicenseSessionId(object) {
  const candidates = [
    object?.metadata?.licenseSessionId,
    object?.metadata?.license_session_id,
    object?.client_reference_id
  ]
  return candidates.find(
    (value) => typeof value === "string" && value.length > 0
  )
}

function customerIdentityFromIds({
  stripeCustomerId,
  paymentIntentId,
  chargeId
} = {}) {
  if (stripeCustomerId) {
    return {
      key: `stripe_customer:${stripeCustomerId}`,
      type: "stripe_customer",
      stripeCustomerId
    }
  }
  if (paymentIntentId) {
    return {
      key: `guest_payment_intent:${paymentIntentId}`,
      type: "guest_payment_intent"
    }
  }
  if (chargeId) {
    return {
      key: `guest_charge:${chargeId}`,
      type: "guest_charge"
    }
  }
  return undefined
}

function customerIdentity(object) {
  return customerIdentityFromIds({
    stripeCustomerId: customerId(object),
    paymentIntentId: paymentIntentId(object),
    chargeId: chargeId(object)
  })
}

function customerIdentityPriority(type) {
  return type === "stripe_customer"
    ? 3
    : type === "guest_payment_intent"
      ? 2
      : type === "guest_charge"
        ? 1
        : 0
}

function mergeCustomerIdentity(target, identity) {
  if (!identity) return target
  if (identity.stripeCustomerId && !target.stripeCustomerId) {
    target.stripeCustomerId = identity.stripeCustomerId
  }
  if (
    identity.stripeCustomerId &&
    target.customerIdentityType !== "stripe_customer"
  ) {
    target.customerIdentityKey = identity.key
    target.customerIdentityType = identity.type
    return target
  }
  if (
    !target.customerIdentityKey ||
    customerIdentityPriority(identity.type) >
      customerIdentityPriority(target.customerIdentityType)
  ) {
    target.customerIdentityKey = identity.key
    target.customerIdentityType = identity.type
  }
  return target
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

function ledgerRowsFromLicense(license, fallbackSessionId) {
  if (!isRecord(license)) return []
  const licenseSessionId =
    typeof license.sessionId === "string" && license.sessionId
      ? license.sessionId
      : fallbackSessionId
  if (Array.isArray(license.purchases)) {
    return license.purchases.filter(isRecord).map((row) => ({
      row,
      sessionId:
        typeof row.sessionId === "string" && row.sessionId
          ? row.sessionId
          : licenseSessionId
    }))
  }
  const { purchases: _purchases, ...purchase } = license
  return [
    {
      row: purchase,
      sessionId:
        typeof purchase.sessionId === "string" && purchase.sessionId
          ? purchase.sessionId
          : licenseSessionId
    }
  ]
}

function rawLedgerRowsWithContext(input) {
  if (Array.isArray(input)) {
    return input.filter(isRecord).map((row) => ({
      row,
      sessionId:
        typeof row.sessionId === "string" && row.sessionId
          ? row.sessionId
          : undefined
    }))
  }
  if (!isRecord(input)) return []
  if (Array.isArray(input.purchases)) {
    return input.purchases.filter(isRecord).map((row) => ({
      row,
      sessionId:
        typeof row.sessionId === "string" && row.sessionId
          ? row.sessionId
          : typeof input.sessionId === "string" && input.sessionId
            ? input.sessionId
            : undefined
    }))
  }
  if (Array.isArray(input.licenses)) {
    return input.licenses.flatMap(ledgerRowsFromLicense)
  }
  if (isRecord(input.licensesBySessionId)) {
    return Object.entries(input.licensesBySessionId).flatMap(
      ([sessionId, license]) => ledgerRowsFromLicense(license, sessionId)
    )
  }
  if (isRecord(input.licenses)) {
    return Object.entries(input.licenses).flatMap(([sessionId, license]) =>
      ledgerRowsFromLicense(license, sessionId)
    )
  }
  if (isRecord(input.data)) return rawLedgerRowsWithContext(input.data)
  return [
    {
      row: input,
      sessionId:
        typeof input.sessionId === "string" && input.sessionId
          ? input.sessionId
          : undefined
    }
  ]
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
  return normalizedLedgerRowsWithContext(input, { fromMs, toMs }).map(
    ({ row }) => row
  )
}

function normalizedLedgerRowsWithContext(input, { fromMs, toMs } = {}) {
  const rows = []
  for (const entry of rawLedgerRowsWithContext(input)) {
    const row = normalizedLedgerRow(entry.row)
    if (!valueInWindow(row.purchasedAt, fromMs, toMs)) continue
    rows.push({
      row,
      rowIndex: rows.length,
      sourceSessionId: entry.sessionId
    })
  }
  return rows
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
  mergeCustomerIdentity(
    target,
    source.stripeCustomerId
      ? customerIdentityFromIds({
          stripeCustomerId: source.stripeCustomerId
        })
      : source.customerIdentityKey
        ? {
            key: source.customerIdentityKey,
            type: source.customerIdentityType
          }
        : undefined
  )
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
  const identity = customerIdentity(object)
  return {
    key: `${kind}:${objectId(object) ?? `${kind}-anonymous`}`,
    stripeCheckoutSessionId: ids.checkoutSessionId,
    stripePaymentIntentId: ids.paymentIntentId,
    stripeChargeId: ids.chargeId,
    stripeCustomerId: identity?.stripeCustomerId,
    customerIdentityKey: identity?.key,
    customerIdentityType: identity?.type,
    licenseSessionId: stripeLicenseSessionId(object),
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

function metricAmount(
  totals,
  currencies,
  complete,
  missing,
  count,
  { amountComplete = true } = {}
) {
  const currency = currencies.length === 1 ? currencies[0] : null
  return {
    amountMinor:
      currencies.length === 1 && missing === 0 && amountComplete
        ? totals[currency]
        : null,
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

function paymentCustomerIdentity(payment) {
  if (payment?.customerIdentityKey) {
    return {
      key: payment.customerIdentityKey,
      type: payment.customerIdentityType
    }
  }
  return customerIdentityFromIds({
    stripeCustomerId: payment?.stripeCustomerId,
    paymentIntentId: payment?.stripePaymentIntentId,
    chargeId: payment?.stripeChargeId
  })
}

function customerIdentityStats(payments) {
  const identities = new Map()
  let unresolvedCount = 0
  for (const payment of payments) {
    const identity = paymentCustomerIdentity(payment)
    if (!identity) {
      unresolvedCount += 1
      continue
    }
    identities.set(identity.key, identity.type)
  }
  let stripeCustomerCount = 0
  let guestSurrogateCount = 0
  for (const type of identities.values()) {
    if (type === "stripe_customer") stripeCustomerCount += 1
    else if (type?.startsWith("guest_")) guestSurrogateCount += 1
  }
  return {
    identities,
    unresolvedCount,
    stripeCustomerCount,
    guestSurrogateCount
  }
}

function paymentMatchReasons(row, sourceSessionId, payment) {
  const reasons = []
  if (
    row.stripeCheckoutSessionId &&
    row.stripeCheckoutSessionId === payment.stripeCheckoutSessionId
  ) {
    reasons.push("checkout_session_id")
  }
  if (
    row.stripePaymentIntentId &&
    row.stripePaymentIntentId === payment.stripePaymentIntentId
  ) {
    reasons.push("payment_intent_id")
  }
  if (row.stripeChargeId && row.stripeChargeId === payment.stripeChargeId) {
    reasons.push("charge_id")
  }
  if (sourceSessionId && sourceSessionId === payment.licenseSessionId) {
    reasons.push("license_session_id")
  }
  return reasons
}

function enrichableStripeFields(row, payment) {
  return [
    "stripeCheckoutSessionId",
    "stripePaymentIntentId",
    "stripeChargeId",
    "stripeCustomerId",
    "stripeAmount",
    "stripeCurrency"
  ].filter((field) => row[field] === undefined && payment[field] !== undefined)
}

function enrichmentCandidate(payment, matchedBy) {
  const identity = paymentCustomerIdentity(payment)
  return {
    matchedBy,
    stripeCheckoutSessionId: payment.stripeCheckoutSessionId,
    stripePaymentIntentId: payment.stripePaymentIntentId,
    stripeChargeId: payment.stripeChargeId,
    stripeCustomerId: payment.stripeCustomerId,
    stripeAmount: payment.stripeAmount,
    stripeCurrency: payment.stripeCurrency,
    planId: payment.planId,
    customerIdentityType: identity?.type
  }
}

function knownPaymentKeysForLedgerIdentifiers(row, payments) {
  const keys = new Set()
  for (const field of [
    "stripeCheckoutSessionId",
    "stripePaymentIntentId",
    "stripeChargeId"
  ]) {
    if (!row[field]) continue
    for (const payment of payments) {
      if (payment[field] === row[field]) keys.add(payment.key)
    }
  }
  return keys
}

function buildEnrichmentReport({
  ledgerRowContexts,
  payments,
  fromMs,
  toMs,
  generatedAt
}) {
  const evaluations = ledgerRowContexts.map(
    ({ row, rowIndex, sourceSessionId }) => {
      const candidates = []
      for (const payment of payments) {
        const matchedBy = paymentMatchReasons(row, sourceSessionId, payment)
        if (matchedBy.length === 0) continue
        candidates.push({
          payment,
          matchedBy,
          planMismatch:
            Boolean(row.planId) &&
            Boolean(payment.planId) &&
            row.planId !== payment.planId
        })
      }
      const planMismatchCandidates = candidates.filter(
        ({ planMismatch }) => planMismatch
      )
      const usableCandidates = candidates.filter(
        ({ planMismatch }) => !planMismatch
      )
      const knownIdentifierPaymentKeys = knownPaymentKeysForLedgerIdentifiers(
        row,
        payments
      )
      let status = "unmatched"
      let candidate
      let candidateList = []
      let fieldsToEnrich = []
      let candidatePaymentKey
      let candidatePayment
      let ambiguityReason
      let conflictingRowIndexes
      if (knownIdentifierPaymentKeys.size > 1) {
        status = "conflicting_identifiers"
        ambiguityReason = "conflicting_existing_stripe_ids"
        candidateList = candidates.map(({ payment, matchedBy }) =>
          enrichmentCandidate(payment, matchedBy)
        )
      } else if (candidates.length > 0 && usableCandidates.length === 0) {
        status = "plan_mismatch"
        candidateList = planMismatchCandidates.map(({ payment, matchedBy }) =>
          enrichmentCandidate(payment, matchedBy)
        )
      } else if (usableCandidates.length > 1) {
        status = "ambiguous"
        candidateList = usableCandidates.map(({ payment, matchedBy }) =>
          enrichmentCandidate(payment, matchedBy)
        )
      } else if (usableCandidates.length === 1) {
        const match = usableCandidates[0]
        candidate = enrichmentCandidate(match.payment, match.matchedBy)
        candidatePaymentKey = match.payment.key
        candidatePayment = match.payment
        fieldsToEnrich = enrichableStripeFields(row, match.payment)
        status = fieldsToEnrich.length > 0 ? "unique" : "already_reconciled"
      }
      return {
        rowIndex,
        firestoreSessionId: sourceSessionId ?? null,
        status,
        matchedBy: candidate?.matchedBy ?? [],
        fieldsToEnrich,
        candidate,
        candidatePaymentKey,
        candidatePayment,
        candidateList,
        ambiguityReason,
        conflictingRowIndexes
      }
    }
  )
  const rowsByCandidate = new Map()
  for (const evaluation of evaluations) {
    if (!evaluation.candidatePaymentKey) continue
    const rows = rowsByCandidate.get(evaluation.candidatePaymentKey) ?? []
    rows.push(evaluation)
    rowsByCandidate.set(evaluation.candidatePaymentKey, rows)
  }
  const candidateReuseRows = new Map(
    [...rowsByCandidate.entries()].map(([candidateKey, rows]) => [
      candidateKey,
      rows.filter(
        ({ status, fieldsToEnrich }) =>
          status === "unique" && fieldsToEnrich.length > 0
      )
    ])
  )
  for (const evaluation of evaluations) {
    if (evaluation.status !== "unique" || !evaluation.candidatePaymentKey) {
      continue
    }
    const conflictingRows =
      candidateReuseRows.get(evaluation.candidatePaymentKey) ?? []
    if (conflictingRows.length <= 1) continue
    evaluation.status = "ambiguous"
    evaluation.matchedBy = []
    evaluation.fieldsToEnrich = []
    evaluation.candidateList = evaluation.candidate
      ? [evaluation.candidate]
      : []
    evaluation.candidate = undefined
    evaluation.ambiguityReason = "candidate_reused_by_rows"
    evaluation.conflictingRowIndexes = conflictingRows.map(
      ({ rowIndex }) => rowIndex
    )
  }
  const rows = evaluations.map(
    ({
      rowIndex,
      firestoreSessionId,
      status,
      matchedBy,
      fieldsToEnrich,
      candidate,
      candidateList,
      ambiguityReason,
      conflictingRowIndexes
    }) => ({
      rowIndex,
      firestoreSessionId,
      status,
      matchedBy,
      fieldsToEnrich,
      ...(candidate ? { candidate } : {}),
      ...(candidateList.length > 0 ? { candidates: candidateList } : {}),
      ...(ambiguityReason ? { ambiguityReason } : {}),
      ...(conflictingRowIndexes ? { conflictingRowIndexes } : {})
    })
  )
  const count = (status) => rows.filter((row) => row.status === status).length
  return {
    schemaVersion: 1,
    ...(generatedAt ? { generatedAt } : {}),
    window: {
      from: fromMs === undefined ? null : new Date(fromMs).toISOString(),
      to: toMs === undefined ? null : new Date(toMs).toISOString()
    },
    readOnly: true,
    dryRun: true,
    backfillRequiresOwnerApproval: true,
    privacy: {
      containsEmails: false,
      containsNames: false,
      containsFullCustomerPii: false,
      containsOpaqueStripeCustomerIds: true,
      ownerOnlyArtifact: true
    },
    summary: {
      purchaseRowCount: rows.length,
      uniqueMatchCount: count("unique"),
      alreadyReconciledCount: count("already_reconciled"),
      ambiguousCount: count("ambiguous"),
      conflictingIdentifierCount: count("conflicting_identifiers"),
      planMismatchCount: count("plan_mismatch"),
      unmatchedCount: count("unmatched"),
      enrichableRowCount: rows.filter(
        (row) => row.status === "unique" && row.fieldsToEnrich.length > 0
      ).length
    },
    rows
  }
}

export function reconcileStripeLedger({
  ledger,
  stripe,
  fromMs,
  toMs,
  pricePlanMap = {},
  generatedAt = undefined,
  includeEnrichmentReport = false
} = {}) {
  const ledgerRowContexts = normalizedLedgerRowsWithContext(ledger, {
    fromMs,
    toMs
  })
  const ledgerRows = ledgerRowContexts.map(({ row }) => row)
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
    ...customerIdentity(session),
    id: objectId(session),
    planId: planIdFromObject(session, pricePlanMap),
    paymentIntentId: paymentIntentId(session),
    chargeId: chargeId(session),
    customerId: customerId(session),
    licenseSessionId: stripeLicenseSessionId(session),
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
      customerIdentityKey: session.key,
      customerIdentityType: session.type,
      licenseSessionId: session.licenseSessionId,
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
    mergeCustomerIdentity(
      payment,
      customerIdentityFromIds({
        stripeCustomerId: row?.stripeCustomerId,
        paymentIntentId: payment.stripePaymentIntentId,
        chargeId: payment.stripeChargeId
      })
    )
  }

  const refunds = []
  const refundIds = new Set()
  let refundAggregateFallbackUsed = false
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
    const identity = customerIdentity(refund)
    refunds.push({
      id,
      paymentIntentId: ids.paymentIntentId,
      chargeId: ids.chargeId,
      stripeCustomerId: identity?.stripeCustomerId,
      customerIdentityKey: identity?.key,
      customerIdentityType: identity?.type,
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
      refundAggregateFallbackUsed = true
      const identity = customerIdentity(charge)
      refunds.push({
        id,
        paymentIntentId: ids.paymentIntentId,
        chargeId: ids.chargeId,
        stripeCustomerId: identity?.stripeCustomerId,
        customerIdentityKey: identity?.key,
        customerIdentityType: identity?.type,
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
    mergeCustomerIdentity(
      payment,
      refund.stripeCustomerId
        ? customerIdentityFromIds({
            stripeCustomerId: refund.stripeCustomerId
          })
        : refund.customerIdentityKey
          ? {
              key: refund.customerIdentityKey,
              type: refund.customerIdentityType
            }
          : undefined
    )
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
  const paidCustomerStats = customerIdentityStats(nonRefundedPayments)
  const refundedCustomerStats = customerIdentityStats(
    eligiblePayments.filter((payment) => refundedPaymentKeys.has(payment.key))
  )
  const paidCustomerIds = new Set(paidCustomerStats.identities.keys())
  const refundedCustomerIds = new Set(refundedCustomerStats.identities.keys())

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
  const checkoutMatchedByLicenseSessionId = paidCheckoutSessions.filter(
    (session) =>
      session.licenseSessionId &&
      ledgerRowContexts.some(
        ({ sourceSessionId }) => sourceSessionId === session.licenseSessionId
      )
  ).length
  const ledgerCheckoutMatched = ledgerRows.filter((row) =>
    paidCheckoutSessions.some(
      (session) => row.stripeCheckoutSessionId === session.id
    )
  ).length
  const ledgerLicenseSessionMatched = ledgerRowContexts.filter(
    ({ sourceSessionId }) =>
      sourceSessionId &&
      paidCheckoutSessions.some(
        (session) => session.licenseSessionId === sourceSessionId
      )
  ).length
  const ledgerAnyMatched = ledgerRows.filter((row) =>
    matchLedgerRow(
      row,
      payments,
      paidCheckoutSessions.map((session) => ({ id: session.id }))
    )
  ).length
  const ledgerAnyMatchedWithLicenseSession = ledgerRowContexts.filter(
    (context) =>
      eligiblePayments.some(
        (payment) =>
          paymentMatchReasons(context.row, context.sourceSessionId, payment)
            .length > 0
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
  const enrichmentReport = buildEnrichmentReport({
    ledgerRowContexts,
    payments: eligiblePayments,
    fromMs,
    toMs,
    generatedAt
  })

  const grossRecords = eligiblePayments
  const gross = amountByCurrency(grossRecords)
  const refundSummary = summarizeRefunds(refunds)
  const eligibleRefunds = []
  const currencyMismatchedRefunds = []
  for (const [paymentKey, matchedRefunds] of refundsByPayment) {
    const payment = paymentsByKey.get(paymentKey)
    if (!payment || !ALLOWLISTED_PLAN_SET.has(payment.planId)) continue
    for (const refund of matchedRefunds) {
      eligibleRefunds.push(refund)
      const paymentCurrencyValue = normalizeCurrency(payment.stripeCurrency)
      const refundCurrency = normalizeCurrency(refund.currency)
      if (
        paymentCurrencyValue &&
        refundCurrency &&
        paymentCurrencyValue !== refundCurrency
      ) {
        currencyMismatchedRefunds.push(refund)
      }
    }
  }
  const eligibleRefundSummary = summarizeRefunds(eligibleRefunds)
  const refundTotals = summarizeRefunds(
    eligibleRefunds.filter(
      (refund) => !currencyMismatchedRefunds.includes(refund)
    )
  ).totals
  const netTotals = { ...gross.totals }
  for (const [currency, amount] of Object.entries(refundTotals)) {
    netTotals[currency] = (netTotals[currency] ?? 0) - amount
  }
  const netCurrencies = Object.keys(netTotals).sort()
  const netAmountComplete =
    gross.missing === 0 &&
    gross.currencies.length === 1 &&
    refundSummary.missing === 0 &&
    currencyMismatchedRefunds.length === 0 &&
    unmatchedRefunds === 0 &&
    !refundAggregateFallbackUsed
  const netMissingAmountOrCurrencyCount = gross.missing + refundSummary.missing
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
      netMissingAmountOrCurrencyCount,
      grossRecords.length,
      { amountComplete: netAmountComplete }
    ),
    refundAmountMinorByCurrency: refundTotals
  }

  const eligibleCustomerStats = customerIdentityStats(eligiblePayments)
  const unresolvedCustomerPayments = eligibleCustomerStats.unresolvedCount
  const unresolvedRefundedPayments = refundedCustomerStats.unresolvedCount
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
    appendBlocker(blockers, "successful_payments_without_customer_identity")
  }
  if (unresolvedRefundedPayments > 0) {
    appendBlocker(blockers, "refunds_without_customer_identity")
  }
  if (gross.missing > 0 || gross.currencies.length !== 1) {
    appendBlocker(blockers, "gross_revenue_currency_or_amount_gap")
  }
  if (refundSummary.missing > 0) {
    appendBlocker(blockers, "refunds_missing_amount_or_currency")
  }
  if (currencyMismatchedRefunds.length > 0) {
    appendBlocker(blockers, "refund_currency_mismatch")
  }
  if (Object.values(netTotals).some((amount) => amount < 0)) {
    appendBlocker(blockers, "refunds_exceed_gross_revenue")
  }
  if (unmatchedRefunds > 0) {
    appendBlocker(blockers, "refunds_without_original_payment_match")
  }
  if (refundAggregateFallbackUsed) {
    appendBlocker(blockers, "refund_feed_missing_using_charge_aggregate")
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
      ) &&
      currencyMismatchedRefunds.length === 0,
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
        ).length,
        guestSurrogateCheckoutCount: paidCheckoutSessions.filter((session) =>
          session.type?.startsWith("guest_")
        ).length
      },
      paid_customers: {
        eligibleSuccessfulPaymentCount: eligiblePayments.length,
        unresolvedCustomerPaymentCount: unresolvedCustomerPayments,
        stripeCustomerCount: paidCustomerStats.stripeCustomerCount,
        guestSurrogateCount: paidCustomerStats.guestSurrogateCount,
        refundedPaymentCount: refundedPaymentKeys.size
      },
      refunded_customers: {
        refundedPaymentCount: refundedPaymentKeys.size,
        unresolvedCustomerPaymentCount: unresolvedRefundedPayments,
        stripeCustomerCount: refundedCustomerStats.stripeCustomerCount,
        guestSurrogateCount: refundedCustomerStats.guestSurrogateCount
      },
      gross_revenue: {
        successfulPaymentCount: grossRecords.length,
        unmappedSuccessfulPaymentCount: unmappedSuccessfulPayments
      },
      net_revenue: {
        matchedRefundCount: [...refundsByPayment.values()].flat().length,
        eligibleRefundCount: eligibleRefunds.length,
        reconciledRefundCount:
          eligibleRefunds.length - eligibleRefundSummary.missing,
        unmatchedRefundCount: unmatchedRefunds,
        missingAmountOrCurrencyCount: refundSummary.missing,
        currencyMismatchedRefundCount: currencyMismatchedRefunds.length,
        refundAggregateFallbackUsed,
        netAssertable: netAmountComplete
      }
    },
    reconciliation: {
      paidCheckoutSessions: {
        ...reconciliation(paidCheckoutSessions.length, checkoutMatchedById),
        matchedByAnyStripeId: checkoutMatchedByAnyId,
        matchedByLicenseSessionId: checkoutMatchedByLicenseSessionId,
        unmatchedByCheckoutId: paidCheckoutSessions.length - checkoutMatchedById
      },
      purchaseRows: {
        ...reconciliation(ledgerRows.length, ledgerCheckoutMatched),
        matchedByCheckoutId: ledgerCheckoutMatched,
        matchedByAnyStripeId: ledgerAnyMatched,
        matchedByLicenseSessionId: ledgerLicenseSessionMatched,
        matchedByAnyStripeIdOrLicenseSessionId:
          ledgerAnyMatchedWithLicenseSession,
        uniquelyMatchableForEnrich: enrichmentReport.summary.uniqueMatchCount,
        alreadyReconciled: enrichmentReport.summary.alreadyReconciledCount,
        ambiguousForEnrich: enrichmentReport.summary.ambiguousCount,
        unmatchedForEnrich: enrichmentReport.summary.unmatchedCount
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
      guestSurrogatePaymentCount:
        paidCustomerStats.guestSurrogateCount +
        refundedCustomerStats.guestSurrogateCount,
      unmatchedRefundCount: unmatchedRefunds,
      refundAggregateFallbackUsed,
      unmappedSuccessfulPaymentCount: unmappedSuccessfulPayments,
      currencyMismatchedRefundCount: currencyMismatchedRefunds.length,
      ledgerRowCount: ledgerRows.length
    },
    privacy: {
      containsEmails: false,
      containsNames: false,
      containsFullCustomerPii: false,
      customerIdsExported: false,
      customerIdentitySurrogatesExported: false
    },
    ...(includeEnrichmentReport ? { enrichmentReport } : {})
  }

  return result
}

export { ALLOWLISTED_PLAN_IDS }
