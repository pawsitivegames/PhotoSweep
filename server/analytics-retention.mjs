export const ANALYTICS_RETENTION_DAYS = 90
export const ANALYTICS_RETENTION_MS =
  ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000

export function pruneAnalyticsEvents(events, currentTime = Date.now()) {
  const cutoff = currentTime - ANALYTICS_RETENTION_MS
  return (Array.isArray(events) ? events : []).filter(
    (event) =>
      typeof event?.recordedAt === "number" &&
      Number.isFinite(event.recordedAt) &&
      event.recordedAt >= cutoff
  )
}
