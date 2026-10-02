import { describe, expect, it } from "vitest"

import {
  createPendingRecoveryRecord,
  markRecoveryRestore,
  sanitizeRecoveryHistory,
  updateRecoveryRecordFromTrash,
  type RecoveryHistoryContext
} from "../../lib/recovery-history"
import type { DeleteReport } from "../../lib/delete-report"
import { buildTrashResultReport } from "../../lib/trash-result-report"
import type { MutationOutcome } from "../../lib/types"

const targetCount = 1001
const operationId = "icloud-capacity-fixture"
const keys = Array.from({ length: targetCount }, (_, index) => `asset-${index}`)
const mediaKeys = Array.from({ length: targetCount }, (_, index) => `media-${index}`)
const refs = Array.from({ length: targetCount }, (_, index) => ({
  recordName: `record-${index}`,
  changeTag: `fresh-${index}`,
  zoneName: "PrimarySync",
  ownerRecordName: "owner"
}))
const now = new Date("2026-09-29T17:00:00.000Z")

function context(): RecoveryHistoryContext {
  return {
    operationId,
    provider: "icloud",
    providerSessionId: "icloud-session",
    attemptedDedupKeys: keys,
    attemptedMediaKeys: mediaKeys,
    confirmedIcloudAssetRefs: refs
  }
}

function trashedRecord() {
  const ctx = context()
  const report: DeleteReport = {
    reportId: "pre-trash-capacity",
    createdAt: now.toISOString(),
    totalGroupsAffected: 1,
    totalItemsKept: 0,
    totalItemsSelectedForTrash: targetCount,
    trashBatchSize: targetCount,
    items: []
  }
  const pending = createPendingRecoveryRecord(report, ctx, now)
  const trashReport = buildTrashResultReport({
    operationId,
    attemptedMediaKeys: mediaKeys,
    attemptedDedupKeys: keys,
    movedMediaKeys: mediaKeys,
    movedDedupKeys: keys
  })
  const [record] = updateRecoveryRecordFromTrash(
    [pending],
    trashReport,
    ctx,
    new Date(now.getTime() + 1000)
  )
  if (!record) throw new Error("The iCloud recovery fixture was not created.")
  return record
}

function reload(record: ReturnType<typeof trashedRecord>) {
  const [reloaded] = sanitizeRecoveryHistory(
    JSON.parse(JSON.stringify([record])),
    now.getTime() + 60_000
  )
  if (!reloaded) throw new Error("The recovery fixture did not survive reload.")
  return reloaded
}

describe("recovery history exact capacity", () => {
  it("keeps aligned iCloud recovery refs and every terminal not-dispatched key past 1000", () => {
    const restoredTargets: MutationOutcome[] = keys.map((targetKey) => ({
      operation: "restore",
      targetKey,
      status: "failed",
      reason: "not-dispatched"
    }))
    const firstReload = reload(trashedRecord())

    expect(firstReload.restorableDedupKeys).toEqual(keys)
    expect(firstReload.restorableMediaKeys).toEqual(mediaKeys)
    expect(firstReload.icloudAssetRefs).toHaveLength(targetCount)
    expect(firstReload.icloudAssetRefs?.at(-1)).toEqual(refs.at(-1))

    const [failedRestore] = markRecoveryRestore(
      [firstReload],
      operationId,
      {
        outcome: "failed",
        restoredDedupKeys: [],
        outcomes: restoredTargets,
        notDispatchedDedupKeys: keys
      },
      new Date(now.getTime() + 2000)
    )
    if (!failedRestore) throw new Error("The restore fixture was not updated.")
    const afterRestoreReload = reload(failedRestore)

    expect(afterRestoreReload.restoreOutcomeHistory?.[0]?.outcomes).toHaveLength(
      targetCount
    )
    expect(
      afterRestoreReload.restoreOutcomeHistory?.[0]?.notDispatchedDedupKeys
    ).toEqual(keys)
    expect(afterRestoreReload.restoreEverNotDispatchedDedupKeys).toEqual(keys)
    expect(afterRestoreReload.icloudAssetRefs).toHaveLength(targetCount)
    expect(afterRestoreReload.icloudAssetRefs?.at(-1)).toEqual(refs.at(-1))
  })

  it("retains unresolved no-replay guards beyond the ordinary count and age limits", () => {
    const base = trashedRecord()
    const provisionalUpdate: Parameters<typeof markRecoveryRestore>[2] = {
      outcome: "unknown",
      requestId: "provisional-restore",
      terminal: false,
      targetDedupKeys: [keys[0]!],
      restoredDedupKeys: [],
      unknownDedupKeys: [keys[0]!],
      outcomes: [
        {
          operation: "restore",
          targetKey: keys[0]!,
          status: "unknown"
        }
      ]
    }
    const [provisional] = markRecoveryRestore(
      [base],
      operationId,
      provisionalUpdate,
      new Date(now.getTime() + 2_000)
    )
    if (!provisional) throw new Error("The provisional fixture was not created.")

    const terminalBase = {
      ...base,
      operationId: "terminal-unknown-fixture",
      preTrashReportId: "pre-terminal-unknown",
      restoreOutcomes: undefined,
      restoreOutcomeHistory: undefined,
      restoreUnknownCount: 0,
      status: "complete" as const
    }
    const [terminalUnknown] = markRecoveryRestore(
      [terminalBase],
      terminalBase.operationId,
      {
        ...provisionalUpdate,
        requestId: "terminal-restore",
        terminal: true
      },
      new Date(now.getTime() + 3_000)
    )
    if (!terminalUnknown) {
      throw new Error("The terminal unknown fixture was not created.")
    }

    const ordinaryRecords = Array.from({ length: 25 }, (_, index) => ({
      ...base,
      operationId: `ordinary-${index}`,
      preTrashReportId: `pre-ordinary-${index}`,
      updatedAt: new Date(now.getTime() + index + 10_000).toISOString(),
      status: "complete" as const,
      unknownCount: 0,
      restoreUnknownCount: 0,
      restoreOutcomes: undefined,
      restoreOutcomeHistory: undefined,
      restorableDedupKeys: [],
      restorableMediaKeys: [],
      icloudAssetRefs: undefined
    }))
    const oldDate = "2025-01-01T00:00:00.000Z"
    const reloaded = sanitizeRecoveryHistory(
      [
        ...ordinaryRecords,
        { ...provisional, updatedAt: oldDate },
        { ...terminalUnknown, updatedAt: oldDate }
      ],
      now.getTime() + 20_000
    )

    expect(reloaded).toHaveLength(20)
    expect(reloaded.map((record) => record.operationId)).toContain(operationId)
    expect(reloaded.map((record) => record.operationId)).toContain(
      "terminal-unknown-fixture"
    )
    expect(
      reloaded.find((record) => record.operationId === operationId)
        ?.restoreOutcomeHistory?.[0]
    ).toMatchObject({ requestId: "provisional-restore", terminal: false })
    expect(
      reloaded.find(
        (record) => record.operationId === "terminal-unknown-fixture"
      )?.restoreOutcomes
    ).toEqual([
      {
        operation: "restore",
        targetKey: keys[0],
        status: "unknown"
      }
    ])
  })

  it("retains every unresolved safety row when their count exceeds the ordinary history cap", () => {
    const base = trashedRecord()
    const provisional: Parameters<typeof markRecoveryRestore>[2] = {
      outcome: "unknown",
      requestId: "active-capacity-restore",
      terminal: false,
      targetDedupKeys: [keys[0]!],
      restoredDedupKeys: [],
      unknownDedupKeys: [keys[0]!],
      outcomes: [{
        operation: "restore",
        targetKey: keys[0]!,
        status: "unknown"
      }]
    }
    const [activeRestore] = markRecoveryRestore(
      [base],
      operationId,
      provisional,
      new Date(now.getTime() + 2_000)
    )
    if (!activeRestore) throw new Error("The active restore fixture was not created.")

    const [terminalUnknown] = markRecoveryRestore(
      [
        {
          ...base,
          operationId: "terminal-capacity-base",
          preTrashReportId: "pre-terminal-capacity",
          status: "complete" as const
        }
      ],
      "terminal-capacity-base",
      { ...provisional, requestId: "terminal-capacity-restore", terminal: true },
      new Date(now.getTime() + 3_000)
    )
    if (!terminalUnknown) {
      throw new Error("The terminal unknown fixture was not created.")
    }

    const oldDate = "2025-01-01T00:00:00.000Z"
    const safetyRecords = [
      { ...activeRestore, updatedAt: oldDate },
      { ...terminalUnknown, updatedAt: oldDate },
      ...Array.from({ length: 19 }, (_, index) => {
        const operationId = `safety-capacity-${index}`
        const preTrashReportId = `pre-safety-capacity-${index}`
        if (index % 3 === 0) {
          return {
            ...base,
            operationId,
            preTrashReportId,
            status: "pending" as const,
            updatedAt: oldDate
          }
        }
        const source = index % 3 === 1 ? activeRestore : terminalUnknown
        return {
          ...source,
          operationId,
          preTrashReportId,
          updatedAt: oldDate
        }
      })
    ]
    const ordinaryRecords = Array.from({ length: 25 }, (_, index) => ({
      ...base,
      operationId: `ordinary-overflow-${index}`,
      preTrashReportId: `pre-ordinary-overflow-${index}`,
      updatedAt: new Date(now.getTime() + index + 10_000).toISOString(),
      status: "complete" as const,
      unknownCount: 0,
      restoreUnknownCount: 0,
      restoreOutcomes: undefined,
      restoreOutcomeHistory: undefined,
      restorableDedupKeys: [],
      restorableMediaKeys: [],
      icloudAssetRefs: undefined
    }))

    const reloaded = sanitizeRecoveryHistory(
      [...ordinaryRecords, ...safetyRecords],
      now.getTime() + 20_000
    )
    const safetyIds = safetyRecords.map((record) => record.operationId)

    expect(safetyRecords).toHaveLength(21)
    expect(reloaded).toHaveLength(21)
    expect(reloaded.map((record) => record.operationId).sort()).toEqual(
      safetyIds.sort()
    )
    expect(reloaded.every((record) => record.updatedAt === oldDate)).toBe(true)
    expect(
      reloaded.some((record) => record.operationId.startsWith("ordinary-overflow-"))
    ).toBe(false)
    expect(
      reloaded.filter((record) => record.status === "pending")
    ).toHaveLength(7)
    expect(
      reloaded.filter((record) =>
        record.restoreOutcomeHistory?.some((attempt) => attempt.terminal === false)
      )
    ).toHaveLength(7)
    expect(
      reloaded.filter((record) =>
        record.restoreOutcomeHistory?.some(
          (attempt) =>
            attempt.terminal === true &&
            attempt.outcomes.some((outcome) => outcome.status === "unknown")
        )
      )
    ).toHaveLength(7)
  })

  it("keeps the ordinary history limit when no unresolved safety record exists", () => {
    const base = trashedRecord()
    const ordinary = Array.from({ length: 25 }, (_, index) => ({
      ...base,
      operationId: `ordinary-bounded-${index}`,
      preTrashReportId: `pre-ordinary-bounded-${index}`,
      updatedAt: new Date(now.getTime() + index + 10_000).toISOString(),
      restorableDedupKeys: [],
      restorableMediaKeys: [],
      icloudAssetRefs: undefined
    }))

    const reloaded = sanitizeRecoveryHistory(
      ordinary,
      now.getTime() + 20_000
    )

    expect(reloaded).toHaveLength(20)
    expect(reloaded.map((record) => record.operationId)).not.toContain(
      "ordinary-bounded-0"
    )
    expect(reloaded.map((record) => record.operationId)).toContain(
      "ordinary-bounded-24"
    )
  })
})
