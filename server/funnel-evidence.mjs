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
  "undo_completed",
  "error"
]

const EVENT_NAME_SET = new Set(EVENT_NAMES)
const ACTION_EVENT_NAMES = new Set([
  "scan_started",
  "scan_completed",
  "trash_attempted",
  "trash_completed",
  "undo_completed"
])
const VALUE_EVENT_NAMES = new Set(["trash_completed", "undo_completed"])

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
    .map((row, index) => {
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
      if (timestamp === undefined) return undefined
      if (from && row.dayKey < from) return undefined
      if (to && row.dayKey > to) return undefined
      return {
        name: row.name,
        installId: row.installId.toLowerCase(),
        extensionVersion: row.extensionVersion,
        dayKey: row.dayKey,
        recordedAt: timestamp,
        index
      }
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        left.recordedAt - right.recordedAt || left.index - right.index
    )
}

function eventIsAfter(candidate, previous) {
  return (
    candidate.recordedAt > previous.recordedAt ||
    (candidate.recordedAt === previous.recordedAt &&
      candidate.index > previous.index)
  )
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
    const firstConnect = installEvents.find(
      (event) => event.name === "provider_connected"
    )
    const firstScanStarted = firstConnect
      ? installEvents.find(
          (event) =>
            event.name === "scan_started" &&
            eventIsAfter(event, firstConnect)
        )
      : undefined
    const firstScanCompleted = firstScanStarted
      ? installEvents.find(
          (event) =>
            event.name === "scan_completed" &&
            eventIsAfter(event, firstScanStarted)
        )
      : undefined
    const firstValue = firstScanCompleted
      ? installEvents.find(
          (event) =>
            VALUE_EVENT_NAMES.has(event.name) &&
            eventIsAfter(event, firstScanCompleted)
        )
      : undefined
    milestones.set(installId, {
      firstConnect,
      firstScanStarted,
      firstScanCompleted,
      firstValue
    })
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

function d7Retention(events, options) {
  const window = cohortWindow(options)
  let cohortCount = 0
  let retainedCount = 0
  for (const installEvents of eventsByInstall(events).values()) {
    const day0 = installEvents.reduce(
      (earliest, event) => (event.dayKey < earliest ? event.dayKey : earliest),
      installEvents[0].dayKey
    )
    if (
      (window.from && day0 < window.from) ||
      (window.to && day0 > window.to)
    ) {
      continue
    }
    cohortCount += 1
    if (
      installEvents.some((event) => dayDifference(day0, event.dayKey) >= 7)
    ) {
      retainedCount += 1
    }
  }
  return {
    rate: cohortCount === 0 ? null : retainedCount / cohortCount,
    cohortCount,
    retainedCount,
    window
  }
}

function parseVersion(value) {
  return value.split(".").map((part) => Number(part))
}

function sameVersion(left, right) {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    if ((leftParts[index] ?? 0) !== (rightParts[index] ?? 0)) return false
  }
  return true
}

export function computeFunnelMetrics(rows, options = {}) {
  assertCurrentVersion(options.currentVersion)
  const events = normalizedEvents(rows, options)
  const installs = new Set(events.map((event) => event.installId))
  const milestones = funnelMilestones(events)

  const timeToValue = []
  for (const milestone of milestones.values()) {
    const connected = milestone.firstConnect
    const value = milestone.firstValue
    if (!connected || !value) continue
    const duration = value.recordedAt - connected.recordedAt
    if (duration >= 0) timeToValue.push(duration)
  }

  const retention = d7Retention(events, options)

  const errorCount = events.filter((event) => event.name === "error").length
  const actionCount = events.filter((event) =>
    ACTION_EVENT_NAMES.has(event.name)
  ).length
  const latestVersionByInstall = new Map()
  for (const event of events) {
    latestVersionByInstall.set(event.installId, event.extensionVersion)
  }
  const oldVersionCount = [...latestVersionByInstall.values()].filter(
    (version) => !sameVersion(version, options.currentVersion)
  ).length
  const firstCount = (milestoneName) =>
    [...milestones.values()].filter((milestone) => milestone[milestoneName])
      .length
  const firstValueCount = [...milestones.values()].filter(
    (milestone) => milestone.firstValue
  ).length

  return {
    first_connect: firstCount("firstConnect"),
    first_scan_started: firstCount("firstScanStarted"),
    first_scan_completed: firstCount("firstScanCompleted"),
    first_trash_or_undo: firstValueCount,
    median_time_to_value: median(timeToValue),
    d7_retention: retention.rate,
    error_rate: actionCount === 0 ? null : errorCount / actionCount,
    old_version_share:
      installs.size === 0 ? null : oldVersionCount / installs.size
  }
}

export function buildFunnelEvidenceSummary(rows, options = {}) {
  assertCurrentVersion(options.currentVersion)
  const events = normalizedEvents(rows, options)
  const metrics = computeFunnelMetrics(rows, options)
  const milestones = funnelMilestones(events)
  const eventCountsByName = Object.fromEntries(
    EVENT_NAMES.map((name) => [
      name,
      events.filter((event) => event.name === name).length
    ])
  )
  const latestVersionByInstall = new Map()
  for (const event of events) {
    latestVersionByInstall.set(event.installId, event.extensionVersion)
  }
  const latestExtensionVersionCounts = Object.fromEntries(
    [...latestVersionByInstall.values()]
      .sort()
      .reduce((counts, version) => {
        counts.set(version, (counts.get(version) ?? 0) + 1)
        return counts
      }, new Map())
  )
  const firstValueEventTypeCounts = Object.fromEntries(
    [...VALUE_EVENT_NAMES].map((name) => [
      name,
      [...milestones.values()].filter(
        (milestone) => milestone.firstValue?.name === name
      ).length
    ])
  )
  const retention = d7Retention(events, options)

  return {
    schemaVersion: 1,
    currentVersion: options.currentVersion,
    window: {
      from: options.from ?? null,
      to: options.to ?? null
    },
    cohortWindow: {
      from: retention.window.from ?? null,
      to: retention.window.to ?? null
    },
    eventCount: events.length,
    installCount: new Set(events.map((event) => event.installId)).size,
    d7CohortInstallCount: retention.cohortCount,
    d7RetainedInstallCount: retention.retainedCount,
    eventCountsByName,
    latestExtensionVersionCounts,
    firstValueEventTypeCounts,
    metrics
  }
}
