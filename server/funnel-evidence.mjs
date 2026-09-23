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

function firstEventsByInstall(events, names) {
  const first = new Map()
  for (const event of events) {
    if (!names.has(event.name)) continue
    let byName = first.get(event.installId)
    if (!byName) {
      byName = new Map()
      first.set(event.installId, byName)
    }
    if (!byName.has(event.name)) byName.set(event.name, event)
  }
  return first
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

export function computeFunnelMetrics(rows, options = {}) {
  assertCurrentVersion(options.currentVersion)
  const events = normalizedEvents(rows, options)
  const installs = new Set(events.map((event) => event.installId))
  const first = firstEventsByInstall(events, new Set([
    "provider_connected",
    "scan_started",
    "scan_completed",
    ...VALUE_EVENT_NAMES
  ]))
  const firstConnect = new Map()
  const firstValue = new Map()

  for (const [installId, byName] of first) {
    const connected = byName.get("provider_connected")
    if (connected) firstConnect.set(installId, connected)
    const valueEvents = [...byName.values()]
      .filter((event) => VALUE_EVENT_NAMES.has(event.name))
      .sort(
        (left, right) =>
          left.recordedAt - right.recordedAt || left.index - right.index
      )
    if (valueEvents[0]) firstValue.set(installId, valueEvents[0])
  }

  const timeToValue = []
  for (const installId of installs) {
    const connected = firstConnect.get(installId)
    const value = firstValue.get(installId)
    if (!connected || !value) continue
    const duration = value.recordedAt - connected.recordedAt
    if (duration >= 0) timeToValue.push(duration)
  }

  let d7Retained = 0
  for (const installId of installs) {
    const installEvents = events.filter((event) => event.installId === installId)
    const day0 = installEvents.reduce(
      (earliest, event) => (event.dayKey < earliest ? event.dayKey : earliest),
      installEvents[0].dayKey
    )
    if (
      installEvents.some((event) => dayDifference(day0, event.dayKey) >= 7)
    ) {
      d7Retained += 1
    }
  }

  const errorCount = events.filter((event) => event.name === "error").length
  const actionCount = events.filter((event) =>
    ACTION_EVENT_NAMES.has(event.name)
  ).length
  const latestVersionByInstall = new Map()
  for (const event of events) {
    latestVersionByInstall.set(event.installId, event.extensionVersion)
  }
  const oldVersionCount = [...latestVersionByInstall.values()].filter(
    (version) => version !== options.currentVersion
  ).length
  const firstCount = (name) =>
    new Set(
      events
        .filter((event) => event.name === name)
        .map((event) => event.installId)
    ).size
  const firstValueCount = new Set(firstValue.keys()).size

  return {
    first_connect: firstCount("provider_connected"),
    first_scan_started: firstCount("scan_started"),
    first_scan_completed: firstCount("scan_completed"),
    first_trash_or_undo: firstValueCount,
    median_time_to_value: median(timeToValue),
    d7_retention: installs.size === 0 ? null : d7Retained / installs.size,
    error_rate: actionCount === 0 ? null : errorCount / actionCount,
    old_version_share:
      installs.size === 0 ? null : oldVersionCount / installs.size
  }
}

export function buildFunnelEvidenceSummary(rows, options = {}) {
  assertCurrentVersion(options.currentVersion)
  const events = normalizedEvents(rows, options)
  const metrics = computeFunnelMetrics(rows, options)
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

  return {
    schemaVersion: 1,
    currentVersion: options.currentVersion,
    window: {
      from: options.from ?? null,
      to: options.to ?? null
    },
    eventCount: events.length,
    installCount: new Set(events.map((event) => event.installId)).size,
    eventCountsByName,
    latestExtensionVersionCounts,
    metrics
  }
}
