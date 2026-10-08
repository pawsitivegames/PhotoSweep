import { describe, expect, it } from "vitest"
import { buildFunnelEvidenceSummary } from "../../server/funnel-evidence.mjs"

const id = "123e4567-e89b-42d3-a456-426614174000"
const row = (name: string, dayKey: string, extra = {}) => ({
  installId: id, extensionVersion: "2.3.0.4", name, dayKey,
  recordedAt: Date.parse(`${dayKey}T00:00:00Z`), provider: "google", ...extra
})
const options = { currentVersion: "2.3.0.4" }

describe("conservative funnel evidence regressions", () => {
  it("counts older versions, never newer versions, and pads numeric components", () => {
    expect(buildFunnelEvidenceSummary([
      row("app_opened", "2026-01-01", { extensionVersion: "2.3.0.5" })
    ], options).metrics.old_version_share).toBe(0)
  })

  it("does not call receipt-order events a verified attempt funnel or install duration", () => {
    const summary = buildFunnelEvidenceSummary([
      row("provider_connected", "2026-01-01"),
      row("scan_started", "2026-01-02"),
      row("scan_completed", "2026-01-03"),
      row("trash_completed", "2026-01-04", { photoCountBucket: "1-99" })
    ], options)
    expect(summary.metrics.first_scan_completed).toBeNull()
    expect(summary.metrics.median_time_to_value).toBeNull()
    expect(summary.observedReceiptProxies.median_connect_to_value_ms).toBe(3 * 86400000)
  })

  it("does not join different providers or ambiguous simultaneous transitions", () => {
    const rows = [row("provider_connected", "2026-01-01"),
      row("scan_started", "2026-01-02", { provider: "icloud" }),
      row("scan_completed", "2026-01-03", { provider: "icloud" })]
    expect(buildFunnelEvidenceSummary(rows, options).observedReceiptProxies.first_scan_completed).toBe(0)
    const tied = [row("provider_connected", "2026-01-01"), row("scan_started", "2026-01-01")]
    expect(buildFunnelEvidenceSummary(tied, options)).toEqual(buildFunnelEvidenceSummary(tied.reverse(), options))
    expect(buildFunnelEvidenceSummary(tied, options).observedReceiptProxies.first_scan_started).toBe(0)
  })

  it("keeps missing history unavailable rather than returning a retention value", () => {
    expect(buildFunnelEvidenceSummary([row("app_opened", "2026-01-01")], options).metrics.d7_retention).toBeNull()
  })

  it("uses full attested history, exact D7 and mature first-observed cohorts", () => {
    const summary = buildFunnelEvidenceSummary([
      row("app_opened", "2026-01-01"), row("app_opened", "2026-01-09"),
      row("app_opened", "2026-01-08", { installId: "223e4567-e89b-42d3-a456-426614174000" })
    ], { ...options, from: "2026-01-08", to: "2026-01-09", cohortFrom: "2026-01-01", cohortTo: "2026-01-08", historyFrom: "2026-01-01", historyThrough: "2026-01-09" })
    expect(summary.d7CohortInstallCount).toBe(1)
    expect(summary.d7RetainedInstallCount).toBe(0)
    expect(summary.observedReceiptProxies.d7_return_rate).toBe(0)
  })

  it("keeps uncorrelated operation errors unavailable and does not mix license errors", () => {
    const summary = buildFunnelEvidenceSummary([
      row("scan_started", "2026-01-01"), row("scan_completed", "2026-01-02"),
      row("error", "2026-01-03", { errorCategory: "license_refresh" })
    ], options)
    expect(summary.metrics.error_rate).toBeNull()
    expect(summary.operationReceipts.scan).toEqual({ attempted: 1, completed: 1, failed: 0 })
  })

  it("excludes zero, legacy ambiguous buckets and partial cleanup from value milestones", () => {
    const base = [row("provider_connected", "2026-01-01"), row("scan_started", "2026-01-02"), row("scan_completed", "2026-01-03")]
    for (const extra of [{ photoCountBucket: "0" }, { photoCountBucket: "0-99" }, { photoCountBucket: "1-99", errorCategory: "trash_partial" }]) {
      expect(buildFunnelEvidenceSummary([...base, row("trash_completed", "2026-01-04", extra)], options).observedReceiptProxies.first_trash_or_undo).toBe(0)
    }
  })
})
