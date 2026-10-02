import { describe, expect, it } from "vitest"

import {
  buildFunnelEvidenceSummary,
  computeFunnelMetrics
} from "../../server/funnel-evidence.mjs"

const CURRENT_VERSION = "2.3.0.1"
const INSTALL_A = "123e4567-e89b-42d3-a456-426614174000"
const INSTALL_B = "223e4567-e89b-42d3-a456-426614174000"
const INSTALL_C = "323e4567-e89b-42d3-a456-426614174000"

function event(
  installId: string,
  name: string,
  recordedAt: number,
  dayKey: string,
  extensionVersion = CURRENT_VERSION
) {
  return { installId, name, recordedAt, dayKey, extensionVersion }
}

describe("funnel evidence", () => {
  it("derives the eight standing-board metrics deterministically", () => {
    const rows = [
      event(INSTALL_A, "provider_connected", 1_000, "2026-01-01"),
      event(INSTALL_A, "scan_started", 2_000, "2026-01-01"),
      event(INSTALL_A, "scan_completed", 3_000, "2026-01-01"),
      event(INSTALL_A, "trash_completed", 10_000, "2026-01-01"),
      event(INSTALL_A, "error", 11_000, "2026-01-01"),
      event(INSTALL_A, "app_opened", 20_000, "2026-01-08", "02.3.0.1"),
      event(INSTALL_B, "provider_connected", 30_000, "2026-01-02"),
      event(INSTALL_B, "scan_started", 31_000, "2026-01-02"),
      event(INSTALL_B, "scan_completed", 35_000, "2026-01-02"),
      event(INSTALL_B, "undo_completed", 38_000, "2026-01-02"),
      event(INSTALL_B, "error", 39_000, "2026-01-02"),
      event(INSTALL_B, "app_opened", 40_000, "2026-01-09"),
      event(INSTALL_C, "app_opened", 50_000, "2026-01-01", "2.2.9.0"),
      event(INSTALL_C, "scan_started", 51_000, "2026-01-01", "2.2.9.0"),
      event(INSTALL_C, "scan_completed", 52_000, "2026-01-01", "2.2.9.0"),
      event(
        INSTALL_C,
        "trash_completed",
        53_000,
        "2026-01-01",
        "2.2.9.0"
      )
    ]

    const options = {
      currentVersion: CURRENT_VERSION,
      from: "2026-01-01",
      to: "2026-01-09",
      cohortFrom: "2026-01-01",
      cohortTo: "2026-01-02"
    }

    expect(computeFunnelMetrics(rows, options)).toEqual({
      first_connect: 2,
      first_scan_started: 2,
      first_scan_completed: 2,
      first_trash_or_undo: 2,
      median_time_to_value: 8_500,
      d7_retention: 2 / 3,
      error_rate: 2 / 9,
      old_version_share: 1 / 3
    })
    expect(buildFunnelEvidenceSummary(rows, options).firstValueEventTypeCounts).toEqual({
      trash_completed: 1,
      undo_completed: 1
    })
  })

  it("exports only aggregate counts and distributions", () => {
    const summary = buildFunnelEvidenceSummary(
      [
        event(INSTALL_A, "provider_connected", 1_000, "2026-01-01"),
        event(INSTALL_A, "app_opened", 2_000, "2026-01-01"),
        event(INSTALL_B, "app_opened", 3_000, "2026-01-02", "2.2.9.0")
      ],
      {
        currentVersion: CURRENT_VERSION,
        from: "2026-01-01",
        to: "2026-01-02",
        cohortFrom: "2026-01-01",
        cohortTo: "2026-01-01"
      }
    )

    expect(summary).toMatchObject({
      schemaVersion: 1,
      currentVersion: CURRENT_VERSION,
      eventCount: 3,
      installCount: 2,
      metrics: {
        first_connect: 1,
        old_version_share: 1 / 2
      }
    })
    expect(summary.firstValueEventTypeCounts).toEqual({
      trash_completed: 0,
      undo_completed: 0
    })
    expect(summary).not.toHaveProperty("installIds")
    expect(JSON.stringify(summary)).not.toContain(INSTALL_A)
  })
})
