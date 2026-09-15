import { describe, expect, it } from "vitest"

import {
  createPendingRecoveryRecord,
  isRecoveryRestorable,
  markRecoveryRestore,
  sanitizeRecoveryHistory,
  updateRecoveryRecordFromTrash,
  type RecoveryHistoryContext
} from "../../lib/recovery-history"
import type { DeleteReport } from "../../lib/delete-report"
import { buildTrashResultReport } from "../../lib/trash-result-report"

const context: RecoveryHistoryContext = {
  operationId: "cleanup-1",
  provider: "google",
  accountEmail: "buyer@example.com",
  scopeLabel: "Tiny duplicate test",
  scopeFingerprint: "scope-1",
  attemptedDedupKeys: ["asset-1", "asset-2"],
  attemptedMediaKeys: ["media-1", "media-2"]
}
const deleteReport: DeleteReport = {
  reportId: "pre-1",
  operationId: context.operationId,
  createdAt: "2026-09-15T00:00:00.000Z",
  totalGroupsAffected: 1,
  totalItemsKept: 1,
  totalItemsSelectedForTrash: 2,
  trashBatchSize: 25,
  items: []
}

describe("recovery history", () => {
  it("creates a pending record before provider mutation", () => {
    const record = createPendingRecoveryRecord(
      deleteReport,
      context,
      new Date("2026-09-15T00:01:00.000Z")
    )
    expect(record).toMatchObject({
      operationId: "cleanup-1",
      status: "pending",
      attemptedCount: 2,
      movedCount: 0,
      restorableDedupKeys: []
    })
    expect(record.accountFingerprint).toBeTruthy()
  })

  it("retains only provider-confirmed moved keys for recovery", () => {
    const pending = createPendingRecoveryRecord(
      deleteReport,
      context,
      new Date("2026-09-15T00:01:00.000Z")
    )
    const report = buildTrashResultReport({
      operationId: context.operationId,
      attemptedMediaKeys: context.attemptedMediaKeys,
      attemptedDedupKeys: context.attemptedDedupKeys,
      movedMediaKeys: ["media-1"],
      movedDedupKeys: ["asset-1"],
      error: "second batch failed"
    })
    const updated = updateRecoveryRecordFromTrash(
      [pending],
      report,
      context,
      new Date("2026-09-15T00:02:00.000Z")
    )
    expect(updated[0]).toMatchObject({
      status: "partial",
      movedCount: 1,
      failedCount: 1,
      restorableDedupKeys: ["asset-1"]
    })
    expect(isRecoveryRestorable(updated[0]!)).toBe(true)
  })

  it("marks a record restored and removes its future restore targets", () => {
    const pending = createPendingRecoveryRecord(
      deleteReport,
      context,
      new Date("2026-09-15T00:01:00.000Z")
    )
    const report = buildTrashResultReport({
      operationId: context.operationId,
      attemptedMediaKeys: context.attemptedMediaKeys,
      attemptedDedupKeys: context.attemptedDedupKeys,
      movedMediaKeys: context.attemptedMediaKeys,
      movedDedupKeys: context.attemptedDedupKeys
    })
    const updated = updateRecoveryRecordFromTrash(
      [pending],
      report,
      context,
      new Date("2026-09-15T00:02:00.000Z")
    )
    const restored = markRecoveryRestore(
      updated,
      context.operationId,
      { success: true },
      new Date("2026-09-15T00:03:00.000Z")
    )
    expect(restored[0]).toMatchObject({ status: "restored", restoreAttempts: 1 })
    expect(restored[0]?.restorableDedupKeys).toEqual([])
    expect(isRecoveryRestorable(restored[0]!)).toBe(false)
  })

  it("drops malformed and expired records while keeping a bounded safe shape", () => {
    const records = sanitizeRecoveryHistory(
      [
        {
          version: 1,
          operationId: "good",
          preTrashReportId: "pre",
          provider: "google",
          createdAt: "2026-09-15T00:00:00.000Z",
          updatedAt: "2026-09-15T00:00:00.000Z",
          attemptedCount: 1,
          movedCount: 1,
          failedCount: 0,
          status: "complete",
          restorableDedupKeys: ["asset"],
          restorableMediaKeys: ["media"],
          restoreAttempts: 0
        },
        { version: 1, operationId: "bad" },
        {
          version: 1,
          operationId: "old",
          preTrashReportId: "pre-old",
          provider: "google",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          attemptedCount: 1,
          movedCount: 1,
          failedCount: 0,
          status: "complete",
          restorableDedupKeys: ["asset"],
          restorableMediaKeys: ["media"],
          restoreAttempts: 0
        }
      ],
      Date.parse("2026-09-15T00:00:00.000Z")
    )
    expect(records.map((record) => record.operationId)).toEqual(["good"])
  })
})
