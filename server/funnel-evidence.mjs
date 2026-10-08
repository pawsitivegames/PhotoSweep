const EVENT_NAMES = [
  "app_opened",
  "scan_started",
  "scan_completed",
  "provider_connected",
  "upgrade_prompt_shown",
  "upgrade_prompt_dismissed",
  "checkout_started",
  "paid_return",
  "restore_requested",
  "restore_completed",
  "restore_not_found",
  "entitlement_refreshed",
  "export_clicked",
  "trash_attempted",
  "trash_completed",
  "undo_attempted",
  "undo_completed",
  "error"
]

const EVENT_NAME_SET = new Set(EVENT_NAMES)
const VALUE_EVENT_NAMES = new Set(["trash_completed", "undo_completed"])
const POSITIVE_BUCKETS = new Set(["1-99", "100-999", "1k-5k", "5k-10k", "10k-50k", "50k+"])

function isValidInstallId(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  )
}

function isValidVersion(value) {
  return (
    typeof value === "string" &&
    value.length <= 32 &&
    /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:\.\d{1,5})?$/.test(value)
  )
}

function isValidDayKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function assertDayKey(value, field) {
  if (value !== undefined && !isValidDayKey(value)) {
    throw new Error(`${field} must be a valid UTC YYYY-MM-DD date.`)
  }
}

function assertCurrentVersion(value) {
  if (!isValidVersion(value)) {
    throw new Error(
      "currentVersion must be a Chrome version with three or four numeric components."
    )
  }
}

function recordedAtMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (value && typeof value.toMillis === "function") {
    const parsed = value.toMillis()
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (
    value &&
    typeof value === "object" &&
    typeof value.seconds === "number"
  ) {
    const nanos = typeof value.nanoseconds === "number" ? value.nanoseconds : 0
    return value.seconds * 1000 + nanos / 1_000_000
  }
  return undefined
}

function normalizedEvents(rows, { from, to } = {}) {
  assertDayKey(from, "from")
  assertDayKey(to, "to")
  if (from && to && from > to) {
    throw new Error("from must not be later than to.")
  }

  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return undefined
      if (
        !isValidInstallId(row.installId) ||
        !isValidVersion(row.extensionVersion) ||
        !isValidDayKey(row.dayKey) ||
        !EVENT_NAME_SET.has(row.name)
      ) {
        return undefined
      }
      const timestamp = recordedAtMs(row.recordedAt)
      if (timestamp === undefined || !Number.isFinite(timestamp)) return undefined
      if (from && row.dayKey < from) return undefined
      if (to && row.dayKey > to) return undefined
      return {
        name: row.name,
        installId: row.installId.toLowerCase(),
        extensionVersion: row.extensionVersion,
        dayKey: row.dayKey,
        recordedAt: timestamp,
        provider: ["google", "icloud", "amazon"].includes(row.provider) ? row.provider : undefined,
        photoCountBucket: row.photoCountBucket,
        errorCategory: row.errorCategory
      }
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        left.recordedAt - right.recordedAt || JSON.stringify(left).localeCompare(JSON.stringify(right))
    )
}

function eventIsAfter(candidate, previous) {
  // Equal receipt timestamps cannot establish causality, regardless of input order.
  return candidate.recordedAt > previous.recordedAt
}

function isPositiveValue(event) {
  return VALUE_EVENT_NAMES.has(event.name) && !event.errorCategory &&
    POSITIVE_BUCKETS.has(event.photoCountBucket)
}

function eventsByInstall(events) {
  const grouped = new Map()
  for (const event of events) {
    let installEvents = grouped.get(event.installId)
    if (!installEvents) {
      installEvents = []
      grouped.set(event.installId, installEvents)
    }
    installEvents.push(event)
  }
  return grouped
}

function funnelMilestones(events) {
  const milestones = new Map()
  for (const [installId, installEvents] of eventsByInstall(events)) {
    const firstConnect = installEvents.find(event => event.name === "provider_connected")
    const candidates = ["google", "icloud", "amazon"].map(provider => {
      const scoped = installEvents.filter(event => event.provider === provider)
      const connect = scoped.find(event => event.name === "provider_connected")
      const start = connect && scoped.find(event => event.name === "scan_started" && eventIsAfter(event, connect))
      const completed = start && scoped.find(event => event.name === "scan_completed" && eventIsAfter(event, start))
      const value = completed && scoped.find(event => isPositiveValue(event) && eventIsAfter(event, completed))
      return { firstConnect: connect, firstScanStarted: start, firstScanCompleted: completed, firstValue: value }
    })
    // Select one provider chain; never splice unrelated providers into a funnel.
    candidates.sort((a, b) => Boolean(b.firstValue) - Boolean(a.firstValue) ||
      Boolean(b.firstScanCompleted) - Boolean(a.firstScanCompleted) ||
      Boolean(b.firstScanStarted) - Boolean(a.firstScanStarted) ||
      (a.firstConnect?.recordedAt ?? Infinity) - (b.firstConnect?.recordedAt ?? Infinity))
    milestones.set(installId, { ...candidates[0], observedConnect: firstConnect })
  }
  return milestones
}

function median(values) {
  if (values.length === 0) return null
  const ordered = [...values].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 1
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2
}

function dayDifference(start, end) {
  return (
    (Date.parse(`${end}T00:00:00.000Z`) -
      Date.parse(`${start}T00:00:00.000Z`)) /
    86_400_000
  )
}

function cohortWindow(options) {
  const from = options.cohortFrom ?? options.from
  const to = options.cohortTo ?? options.to
  assertDayKey(from, "cohortFrom")
  assertDayKey(to, "cohortTo")
  if (from && to && from > to) {
    throw new Error("cohortFrom must not be later than cohortTo.")
  }
  return { from, to }
}

function d7Retention(allEvents, options) {
  const window = cohortWindow(options)
  assertDayKey(options.historyFrom, "historyFrom")
  assertDayKey(options.historyThrough, "historyThrough")
  if (options.historyFrom && options.historyThrough && options.historyFrom > options.historyThrough) {
    throw new Error("historyFrom must not be later than historyThrough.")
  }
  const adequateHistory = Boolean(window.from && window.to && options.historyFrom &&
    options.historyThrough && options.historyFrom <= window.from && options.historyThrough >= window.to)
  let cohortCount = 0
  let retainedCount = 0
  let immatureCount = 0
  if (adequateHistory) {
    const history = allEvents.filter(event => event.dayKey >= options.historyFrom && event.dayKey <= options.historyThrough)
    for (const installEvents of eventsByInstall(history).values()) {
      const day0 = installEvents.reduce((earliest, event) => event.dayKey < earliest ? event.dayKey : earliest, installEvents[0].dayKey)
      if (day0 < window.from || day0 > window.to) continue
      if (dayDifference(day0, options.historyThrough) < 7) { immatureCount++; continue }
      cohortCount++
      if (installEvents.some(event => dayDifference(day0, event.dayKey) === 7)) retainedCount++
    }
  }
  return { rate: cohortCount ? retainedCount / cohortCount : null, cohortCount, retainedCount, immatureCount, window, adequateHistory }
}

function parseVersion(value) {
  return value.split(".").map((part) => Number(part))
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference) return difference
  }
  return 0
}

function versionObservations(events, currentVersion) {
  let ambiguousCount = 0
  const versions = []
  for (const installEvents of eventsByInstall(events).values()) {
    const latestTime = installEvents[installEvents.length - 1].recordedAt
    const latest = installEvents.filter(event => event.recordedAt === latestTime)
    if (latest.some(event => compareVersions(event.extensionVersion, latest[0].extensionVersion) !== 0)) {
      ambiguousCount++
      continue
    }
    versions.push(latest[0].extensionVersion)
  }
  return { versions, ambiguousCount,
    oldShare: ambiguousCount || !versions.length ? null : versions.filter(version => compareVersions(version, currentVersion) < 0).length / versions.length }
}

function operationReceipts(events) {
  return Object.fromEntries(["scan", "trash", "undo"].map(operation => [operation, {
    attempted: events.filter(event => event.name === (operation === "scan" ? "scan_started" : `${operation}_attempted`)).length,
    completed: events.filter(event => event.name === `${operation}_completed`).length,
    failed: events.filter(event => event.name === "error" &&
      (event.errorCategory === operation || event.errorCategory === `${operation}_partial`)).length
  }]))
}

export function computeFunnelMetrics(rows, options = {}) {
  return buildFunnelEvidenceSummary(rows, options).metrics
}

export function buildFunnelEvidenceSummary(rows, options = {}) {
  assertCurrentVersion(options.currentVersion)
  const allEvents = normalizedEvents(rows)
  const events = normalizedEvents(rows, options)
  const milestones = funnelMilestones(events)
  const retention = d7Retention(allEvents, options)
  const version = versionObservations(events, options.currentVersion)
  const count = key => [...milestones.values()].filter(milestone => milestone[key]).length
  const durations = [...milestones.values()].filter(milestone => milestone.firstConnect && milestone.firstValue)
    .map(milestone => milestone.firstValue.recordedAt - milestone.firstConnect.recordedAt)
  return {
    schemaVersion: 2,
    currentVersion: options.currentVersion,
    window: { from: options.from ?? null, to: options.to ?? null },
    cohortWindow: { from: retention.window.from ?? null, to: retention.window.to ?? null },
    historyWindow: { from: options.historyFrom ?? null, through: options.historyThrough ?? null },
    eventCount: events.length,
    installCount: new Set(events.map(event => event.installId)).size,
    d7CohortInstallCount: retention.cohortCount,
    d7RetainedInstallCount: retention.retainedCount,
    d7ImmatureInstallCount: retention.immatureCount,
    eventCountsByName: Object.fromEntries(EVENT_NAMES.map(name => [name, events.filter(event => event.name === name).length])),
    latestExtensionVersionCounts: Object.fromEntries(version.versions.sort().reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map())),
    firstValueEventTypeCounts: Object.fromEntries([...VALUE_EVENT_NAMES].map(name => [name, [...milestones.values()].filter(milestone => milestone.firstValue?.name === name).length])),
    metrics: {
      first_connect: count("observedConnect"),
      first_scan_started: null,
      first_scan_completed: null,
      first_trash_or_undo: null,
      median_time_to_value: null,
      d7_retention: null,
      error_rate: null,
      old_version_share: version.oldShare
    },
    observedReceiptProxies: {
      first_scan_started: count("firstScanStarted"),
      first_scan_completed: count("firstScanCompleted"),
      first_trash_or_undo: count("firstValue"),
      median_connect_to_value_ms: median(durations),
      d7_return_rate: retention.rate
    },
    operationReceipts: operationReceipts(events),
    qualityFlags: {
      receiptCountsNotDeduplicated: true,
      attemptCorrelationUnavailable: true,
      installTimestampUnavailable: true,
      retentionHistoryUnavailable: !retention.adequateHistory,
      invalidRowsExcluded: allEvents.length !== rows.length,
      ambiguousLatestVersions: version.ambiguousCount
    },
    definitions: {
      first_connect: "Distinct consented install identities observed connecting in the selected window; not a lifetime installation cohort.",
      observedReceiptProxies: "Strictly ordered server receipts for one provider per install within the observed window; not correlated operation attempts or client occurrence times.",
      d7_return_rate: "Exact client UTC day 7 after first observation within explicitly attested complete history, mature cohorts only; not install retention.",
      error_rate: "Unavailable without operation correlation and deduplication; operationReceipts reports separate attempts, completions and failures without a ratio.",
      old_version_share: "Latest unambiguous numeric version strictly older than configured threshold; missing components compare as zero."
    }
  }
}
