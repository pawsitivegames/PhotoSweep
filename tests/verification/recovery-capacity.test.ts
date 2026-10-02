import { describe, expect, it } from "vitest"

import {
  createPendingRecoveryRecord,
  markRecoveryRestore,
  sanitizeRecoveryHistory,
  updateRecoveryRecordFromTrash,
  type RecoveryHistoryContext,
  type RecoveryHistoryRecord
} from "../../lib/recovery-history"
import type { DeleteReport } from "../../lib/delete-report"
import { buildTrashResultReport } from "../../lib/trash-result-report"
import type { MutationOutcome } from "../../lib/types"

const targetCount = 1001
const dedupKeys = Array.from({ length: targetCount }, (_, index) => `asset-${index}`)
const mediaKeys = Array.from({ length: targetCount }, (_, index) => `media-${index}`)
const lastDedupKey = dedupKeys.at(-1)!
const operationId = "capacity-restore-fixture"
const fixedNow = new Date("2026-09-29T12:00:00.000Z")

function recoveryContext(): RecoveryHistoryContext {
  return {
    operationId,
    provider: "google",
    attemptedDedupKeys: dedupKeys,
    attemptedMediaKeys: mediaKeys
  }
}

function trashedRecord(): RecoveryHistoryRecord {
  const context = recoveryContext()
  const pending = createPendingRecoveryRecord(
    {
      reportId: "capacity-pre-trash",
      operationId,
      createdAt: fixedNow.toISOString(),
      totalGroupsAffected: 1,
      totalItemsKept: 1,
      totalItemsSelectedForTrash: targetCount,
      trashBatchSize: targetCount,
      items: []
    } satisfies DeleteReport,
    context,
    fixedNow
  )
  const trashReport = buildTrashResultReport({
    operationId,
    attemptedMediaKeys: mediaKeys,
    attemptedDedupKeys: dedupKeys,
    movedMediaKeys: mediaKeys,
    movedDedupKeys: dedupKeys
  })
  return updateRecoveryRecordFromTrash(
    [pending],
    trashReport,
    context,
    new Date(fixedNow.getTime() + 1000)
  )[0]!
}

function rawTrashedRecord(): RecoveryHistoryRecord {
  return {
    version: 1,
    operationId,
    preTrashReportId: "capacity-pre-trash",
    provider: "google",
    createdAt: fixedNow.toISOString(),
    updatedAt: fixedNow.toISOString(),
    attemptedCount: targetCount,
    movedCount: targetCount,
    failedCount: 0,
    unknownCount: 0,
    notDispatchedCount: 0,
    restoreUnknownCount: 0,
    status: "complete",
    restorableDedupKeys: dedupKeys,
    restorableMediaKeys: mediaKeys,
    restoreAttempts: 0
  }
}

function reload(record: RecoveryHistoryRecord): RecoveryHistoryRecord {
  const [reloaded] = sanitizeRecoveryHistory(
    JSON.parse(JSON.stringify([record])),
    fixedNow.getTime() + 60_000
  )
  if (!reloaded) throw new Error("The recovery fixture did not survive reload.")
  return reloaded
}

function restoreOutcomes(
  statuses: MutationOutcome["status"][]
): MutationOutcome[] {
  return dedupKeys.map((targetKey, index) => ({
    operation: "restore",
    targetKey,
    status: statuses[index]!
  }))
}

describe("[SAFE-12] recovery evidence capacity", () => {
  it("persists every confirmed-trash restore reference beyond the prior 1000-entry cap", () => {
    const record = trashedRecord()
    const reloaded = reload(record)

    expect(reloaded.restorableDedupKeys).toHaveLength(targetCount)
    expect(reloaded.restorableMediaKeys).toHaveLength(targetCount)
    expect(reloaded.restorableDedupKeys.at(-1)).toBe(lastDedupKey)
  })

  it("keeps the 1001st unknown restore target and exact unknown count after reload", () => {
    const statuses: MutationOutcome["status"][] = Array.from(
      { length: targetCount },
      (_, index) => (index === targetCount - 1 ? "unknown" : "confirmed")
    )
    const outcomes = restoreOutcomes(statuses)
    const result = markRecoveryRestore(
      [rawTrashedRecord()],
      operationId,
      {
        outcome: "partial",
        restoredDedupKeys: dedupKeys.slice(0, -1),
        unknownDedupKeys: [lastDedupKey],
        outcomes
      },
      new Date(fixedNow.getTime() + 2000)
    )[0]!
    const reloaded = reload(result)

    expect(reloaded.status).toBe("restore_unknown")
    expect(reloaded.restoreUnknownCount).toBe(1)
    expect(reloaded.restoreOutcomes).toHaveLength(targetCount)
    expect(reloaded.restoreOutcomes?.at(-1)).toMatchObject({
      targetKey: lastDedupKey,
      status: "unknown"
    })
    expect(reloaded.restorableDedupKeys).toEqual([])
  })

  it("retries the 1001st failed target while earlier unknown outcomes stay sticky", () => {
    const unknownKey = dedupKeys.at(-2)!
    const failedKey = lastDedupKey
    const firstStatuses: MutationOutcome["status"][] = Array.from(
      { length: targetCount },
      (_, index) =>
        index === targetCount - 2
          ? "unknown"
          : index === targetCount - 1
            ? "failed"
            : "confirmed"
    )
    const firstOutcomes = restoreOutcomes(firstStatuses)
    const first = markRecoveryRestore(
      [rawTrashedRecord()],
      operationId,
      {
        outcome: "partial",
        restoredDedupKeys: dedupKeys.slice(0, -2),
        unknownDedupKeys: [unknownKey],
        outcomes: firstOutcomes,
        notDispatchedDedupKeys: [failedKey]
      },
      new Date(fixedNow.getTime() + 2000)
    )[0]!
    const afterFirstReload = reload(first)

    expect(afterFirstReload.restoreUnknownCount).toBe(1)
    expect(afterFirstReload.restorableDedupKeys).toEqual([failedKey])
    expect(afterFirstReload.restoreOutcomes?.find((entry) => entry.targetKey === unknownKey)?.status).toBe("unknown")

    const retried = markRecoveryRestore(
      [afterFirstReload],
      operationId,
      {
        outcome: "complete",
        restoredDedupKeys: [failedKey],
        outcomes: [
          { operation: "restore", targetKey: failedKey, status: "confirmed" }
        ]
      },
      new Date(fixedNow.getTime() + 3000)
    )[0]!
    const afterRetryReload = reload(retried)

    expect(afterRetryReload.status).toBe("restore_unknown")
    expect(afterRetryReload.restoreUnknownCount).toBe(1)
    expect(afterRetryReload.restoreOutcomes?.find((entry) => entry.targetKey === unknownKey)?.status).toBe("unknown")
    expect(afterRetryReload.restoreOutcomes?.find((entry) => entry.targetKey === failedKey)?.status).toBe("confirmed")
    expect(afterRetryReload.restorableDedupKeys).toEqual([])
  })
})
