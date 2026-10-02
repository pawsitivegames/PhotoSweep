import { describe, expect, it } from "vitest"

import { buildTrashResultReport } from "../../lib/trash-result-report"

describe("trash result report", () => {
  it("marks a full trash response as complete", () => {
    const report = buildTrashResultReport({
      attemptedMediaKeys: ["m1", "m2"],
      attemptedDedupKeys: ["d1", "d2"],
      movedMediaKeys: ["m1", "m2"],
      movedDedupKeys: ["d1", "d2"]
    })

    expect(report.status).toBe("complete")
    expect(report.attemptedCount).toBe(2)
    expect(report.movedCount).toBe(2)
    expect(report.failedCount).toBe(0)
    expect(report.failedMediaKeys).toEqual([])
    expect(report.retryAttempts).toBe(0)
    expect(report.error).toBeNull()
  })

  it("keeps failed keys in attempted order for partial trash responses", () => {
    const report = buildTrashResultReport({
      attemptedMediaKeys: ["m1", "m2", "m3"],
      attemptedDedupKeys: ["d1", "d2", "d3"],
      movedMediaKeys: ["m2"],
      movedDedupKeys: ["d2"],
      retryAttempts: 2,
      error: "Button disappeared"
    })

    expect(report.status).toBe("partial")
    expect(report.movedCount).toBe(1)
    expect(report.failedCount).toBe(2)
    expect(report.failedMediaKeys).toEqual(["m1", "m3"])
    expect(report.failedDedupKeys).toEqual(["d1", "d3"])
    expect(report.retryAttempts).toBe(2)
    expect(report.error).toBe("Button disappeared")
  })

  it("marks a trash response with no moved items as failed", () => {
    const report = buildTrashResultReport({
      attemptedMediaKeys: ["m1"],
      attemptedDedupKeys: ["d1"],
      movedMediaKeys: [],
      movedDedupKeys: [],
      error: "Trash failed"
    })

    expect(report.status).toBe("failed")
    expect(report.movedCount).toBe(0)
    expect(report.failedCount).toBe(1)
    expect(report.failedMediaKeys).toEqual(["m1"])
    expect(report.failedDedupKeys).toEqual(["d1"])
  })

  it("partitions confirmed, failed, ambiguous, and never-issued targets without overlap", () => {
    const report = buildTrashResultReport({
      attemptedMediaKeys: ["m1", "m2", "m3", "m4"],
      attemptedDedupKeys: ["d1", "d2", "d3", "d4"],
      movedMediaKeys: ["m1"],
      movedDedupKeys: ["d1"],
      outcomes: [
        { operation: "trash", targetKey: "d1", status: "confirmed" },
        { operation: "trash", targetKey: "d2", status: "unknown" },
        { operation: "trash", targetKey: "d3", status: "failed" },
        { operation: "trash", targetKey: "d4", status: "failed" }
      ],
      notDispatchedDedupKeys: ["d4"]
    })

    expect(report).toMatchObject({
      status: "partial",
      attemptedCount: 4,
      movedCount: 1,
      failedCount: 1,
      unknownCount: 1,
      notDispatchedCount: 1,
      movedDedupKeys: ["d1"],
      failedDedupKeys: ["d3"],
      unknownDedupKeys: ["d2"],
      notDispatchedDedupKeys: ["d4"]
    })
    expect(
      report.movedCount +
        report.failedCount +
        report.unknownCount +
        report.notDispatchedCount
    ).toBe(report.attemptedCount)
    expect(new Set(report.outcomes.map((outcome) => outcome.targetKey)).size).toBe(
      report.attemptedCount
    )
  })

  it("ignores moved keys that were not attempted", () => {
    const report = buildTrashResultReport({
      attemptedMediaKeys: ["m1", "m2"],
      attemptedDedupKeys: ["d1", "d2"],
      movedMediaKeys: ["m2", "extra-media"],
      movedDedupKeys: ["extra-dedup", "d2"]
    })

    expect(report.status).toBe("partial")
    expect(report.attemptedCount).toBe(2)
    expect(report.movedCount).toBe(1)
    expect(report.failedCount).toBe(1)
    expect(report.movedMediaKeys).toEqual(["m2"])
    expect(report.movedDedupKeys).toEqual(["d2"])
    expect(report.failedMediaKeys).toEqual(["m1"])
    expect(report.failedDedupKeys).toEqual(["d1"])
  })
})
