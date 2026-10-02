import { describe, expect, it } from "vitest"

import type { DeleteReport } from "../../lib/delete-report"
import {
  createPendingRecoveryRecord,
  markRecoveryRestore,
  sanitizeRecoveryHistory,
  updateRecoveryRecordFromTrash,
  type RecoveryHistoryContext
} from "../../lib/recovery-history"
import {
  TrashLifecycle,
  type TrashUndoData
} from "../../lib/trash-lifecycle"
import { buildTrashResultReport } from "../../lib/trash-result-report"
import type { MutationOutcome } from "../../lib/types"

const operationId = "safe-12-refinement"
const dedupKeys = ["asset-a", "asset-b", "asset-c", "asset-d"]
const mediaKeys = ["media-a", "media-b", "media-c", "media-d"]
const timestamps = [
  new Date("2026-09-29T12:00:00.000Z"),
  new Date("2026-09-29T12:01:00.000Z"),
  new Date("2026-09-29T12:02:00.000Z"),
  new Date("2026-09-29T12:03:00.000Z"),
  new Date("2026-09-29T12:04:00.000Z")
]

function initialRecoveryRecord(selectedDedupKeys = dedupKeys) {
  const selectedMediaKeys = selectedDedupKeys.map((key) => {
    const index = dedupKeys.indexOf(key)
    if (index < 0) throw new Error(`Unknown recovery fixture key: ${key}`)
    return mediaKeys[index]!
  })
  const context: RecoveryHistoryContext = {
    operationId,
    provider: "google",
    providerSessionId: "fixture-session",
    scopeFingerprint: "fixture-scope",
    attemptedDedupKeys: selectedDedupKeys,
    attemptedMediaKeys: selectedMediaKeys
  }
  const report: DeleteReport = {
    reportId: "safe-12-before-trash",
    operationId,
    createdAt: timestamps[0]!.toISOString(),
    totalGroupsAffected: 1,
    totalItemsKept: 1,
    totalItemsSelectedForTrash: selectedDedupKeys.length,
    trashBatchSize: selectedDedupKeys.length,
    items: []
  }
  const pending = createPendingRecoveryRecord(report, context, timestamps[0])
  const trashResult = buildTrashResultReport({
    operationId,
    attemptedDedupKeys: selectedDedupKeys,
    attemptedMediaKeys: selectedMediaKeys,
    movedDedupKeys: selectedDedupKeys,
    movedMediaKeys: selectedMediaKeys
  })
  return updateRecoveryRecordFromTrash(
    [pending],
    trashResult,
    context,
    timestamps[1]
  )
}

function restoreData(dedupKeysToRestore: string[]): TrashUndoData {
  return {
    operationId,
    provider: "google",
    dedupKeys: dedupKeysToRestore,
    count: dedupKeysToRestore.length,
    snapshot: { mediaItems: {}, groups: [], totalItems: dedupKeysToRestore.length },
    providerSessionId: "fixture-session",
    scopeFingerprint: "fixture-scope"
  }
}

function reloadHistory(records: ReturnType<typeof initialRecoveryRecord>) {
  const reloaded = sanitizeRecoveryHistory(
    JSON.parse(JSON.stringify(records)),
    timestamps[3]!.getTime()
  )
  if (!reloaded[0]) throw new Error("Expected recovery record after JSON reload.")
  return reloaded
}

describe("[SAFE-12] mutation outcome recovery implementation seams", () => {
  it("keeps a deterministic partial-restore scenario through reload and failed-only retry", () => {
    const lifecycle = new TrashLifecycle({
      async savePreTrashReport() {},
      async saveTrashResultReport() {}
    })
    const beforeRestore = initialRecoveryRecord()
    const firstRequestId = "restore-attempt-1"
    const firstDispatch = lifecycle.beginRestore(
      restoreData(dedupKeys),
      firstRequestId
    )
    expect(firstDispatch.args.dedupKeys).toEqual(dedupKeys)

    const firstOutcomes: MutationOutcome[] = [
      { operation: "restore", targetKey: dedupKeys[0]!, status: "confirmed" },
      { operation: "restore", targetKey: dedupKeys[1]!, status: "unknown" },
      { operation: "restore", targetKey: dedupKeys[2]!, status: "failed" },
      { operation: "restore", targetKey: dedupKeys[3]!, status: "failed" }
    ]
    const first = lifecycle.reconcileRestore({
      requestId: firstRequestId,
      success: true,
      outcomes: firstOutcomes,
      notDispatchedDedupKeys: [dedupKeys[3]!]
    })
    if (first?.kind !== "partial") {
      throw new Error("Expected a partial first restore with an unknown target.")
    }

    const firstHistory = markRecoveryRestore(
      beforeRestore,
      operationId,
      {
        outcome: first.kind,
        restoredDedupKeys: first.restoredDedupKeys,
        unknownDedupKeys: first.unknownDedupKeys,
        outcomes: first.outcomes,
        notDispatchedDedupKeys: first.notDispatchedDedupKeys
      },
      timestamps[2]
    )
    const afterFirstReload = reloadHistory(firstHistory)[0]!

    expect(first.undo.dedupKeys).toEqual([dedupKeys[2], dedupKeys[3]])
    expect(afterFirstReload.restoreOutcomes).toEqual([
      { operation: "restore", targetKey: dedupKeys[0]!, status: "confirmed" },
      { operation: "restore", targetKey: dedupKeys[1]!, status: "unknown" },
      { operation: "restore", targetKey: dedupKeys[2]!, status: "failed" },
      {
        operation: "restore",
        targetKey: dedupKeys[3]!,
        status: "failed",
        reason: "not-dispatched"
      }
    ])
    expect(afterFirstReload.restoreUnknownCount).toBe(1)
    expect(afterFirstReload.restoreEverNotDispatchedDedupKeys).toEqual([
      dedupKeys[3]
    ])

    const retryRequestId = "restore-attempt-2"
    const retryDispatch = lifecycle.beginRestore(first.undo, retryRequestId)
    expect(retryDispatch.args.dedupKeys).toEqual([dedupKeys[2], dedupKeys[3]])
    expect(retryDispatch.args.dedupKeys).not.toContain(dedupKeys[1])
    const retryOutcomes: MutationOutcome[] = [
      { operation: "restore", targetKey: dedupKeys[2]!, status: "confirmed" },
      { operation: "restore", targetKey: dedupKeys[3]!, status: "failed" }
    ]
    const retry = lifecycle.reconcileRestore({
      requestId: retryRequestId,
      success: false,
      outcomes: retryOutcomes,
      notDispatchedDedupKeys: [dedupKeys[3]!]
    })
    if (retry?.kind !== "partial") {
      throw new Error("Expected the retry to retain its failed never-issued target.")
    }

    const afterRetry = markRecoveryRestore(
      [afterFirstReload],
      operationId,
      {
        outcome: retry.kind,
        restoredDedupKeys: retry.restoredDedupKeys,
        unknownDedupKeys: retry.unknownDedupKeys,
        outcomes: retry.outcomes,
        notDispatchedDedupKeys: retry.notDispatchedDedupKeys
      },
      timestamps[3]
    )
    const afterRetryReload = reloadHistory(afterRetry)[0]!

    expect(afterRetryReload.status).toBe("restore_unknown")
    expect(afterRetryReload.restoreUnknownCount).toBe(1)
    expect(afterRetryReload.restoreOutcomes).toEqual([
      { operation: "restore", targetKey: dedupKeys[0]!, status: "confirmed" },
      { operation: "restore", targetKey: dedupKeys[1]!, status: "unknown" },
      { operation: "restore", targetKey: dedupKeys[2]!, status: "confirmed" },
      {
        operation: "restore",
        targetKey: dedupKeys[3]!,
        status: "failed",
        reason: "not-dispatched"
      }
    ])
    expect(afterRetryReload.restorableDedupKeys).toEqual([dedupKeys[3]])
    expect(afterRetryReload.restoreEverNotDispatchedDedupKeys).toEqual([
      dedupKeys[3]
    ])
    expect(afterRetryReload.restoreOutcomeHistory?.map((attempt) =>
      attempt.outcomes.map((outcome) => [outcome.targetKey, outcome.status])
    )).toEqual([
      [
        [dedupKeys[0], "confirmed"],
        [dedupKeys[1], "unknown"],
        [dedupKeys[2], "failed"],
        [dedupKeys[3], "failed"]
      ],
      [
        [dedupKeys[2], "confirmed"],
        [dedupKeys[3], "failed"]
      ]
    ])
  })

  it("refines same-request late terminals without clearing unrelated sticky unknowns", () => {
    const keys = dedupKeys.slice(0, 3)
    const requestId = "late-terminal-live-request"
    const provisional = markRecoveryRestore(
      initialRecoveryRecord(keys),
      operationId,
      {
        outcome: "partial",
        requestId,
        terminal: false,
        restoredDedupKeys: [keys[0]!],
        unknownDedupKeys: [keys[1]!],
        outcomes: [
          { operation: "restore", targetKey: keys[0]!, status: "confirmed" },
          { operation: "restore", targetKey: keys[1]!, status: "unknown" },
          { operation: "restore", targetKey: keys[2]!, status: "failed" }
        ]
      },
      timestamps[2]
    )
    // Re-reading the serialized record in the still-live document must keep
    // the exact request binding needed to accept its late terminal response.
    const afterTimeoutStorageRead = reloadHistory(provisional)[0]!
    const lateTerminal = markRecoveryRestore(
      [afterTimeoutStorageRead],
      operationId,
      {
        outcome: "partial",
        requestId,
        terminal: true,
        restoredDedupKeys: [keys[1]!],
        outcomes: [
          // A terminal response cannot contradict a confirmed progress update.
          { operation: "restore", targetKey: keys[0]!, status: "failed" },
          { operation: "restore", targetKey: keys[1]!, status: "confirmed" },
          { operation: "restore", targetKey: keys[2]!, status: "failed" }
        ]
      },
      timestamps[3]
    )
    const afterLateTerminal = reloadHistory(lateTerminal)[0]!
    expect(afterLateTerminal.restoreOutcomes).toEqual([
      { operation: "restore", targetKey: keys[0]!, status: "confirmed" },
      { operation: "restore", targetKey: keys[1]!, status: "confirmed" },
      { operation: "restore", targetKey: keys[2]!, status: "failed" }
    ])
    expect(afterLateTerminal.restoreUnknownCount).toBe(0)
    expect(afterLateTerminal.restorableDedupKeys).toEqual([keys[2]])
    expect(afterLateTerminal.restoreOutcomeHistory?.[0]).toMatchObject({
      requestId,
      terminal: true
    })

    const distinctUnknown = markRecoveryRestore(
      initialRecoveryRecord(keys.slice(0, 2)),
      operationId,
      {
        outcome: "partial",
        requestId: "first-terminal-request",
        terminal: true,
        restoredDedupKeys: [],
        unknownDedupKeys: [keys[0]!],
        outcomes: [
          { operation: "restore", targetKey: keys[0]!, status: "unknown" },
          { operation: "restore", targetKey: keys[1]!, status: "failed" }
        ]
      },
      timestamps[2]
    )
    const distinctRetry = markRecoveryRestore(
      distinctUnknown,
      operationId,
      {
        outcome: "complete",
        requestId: "different-request",
        terminal: true,
        restoredDedupKeys: [keys[1]!],
        outcomes: [
          { operation: "restore", targetKey: keys[1]!, status: "confirmed" }
        ]
      },
      timestamps[3]
    )
    expect(distinctRetry[0]?.restoreOutcomes).toEqual([
      { operation: "restore", targetKey: keys[0]!, status: "unknown" },
      { operation: "restore", targetKey: keys[1]!, status: "confirmed" }
    ])

    const legacyUnknown = markRecoveryRestore(
      initialRecoveryRecord(keys.slice(0, 2)),
      operationId,
      {
        outcome: "partial",
        restoredDedupKeys: [],
        unknownDedupKeys: [keys[0]!],
        outcomes: [
          { operation: "restore", targetKey: keys[0]!, status: "unknown" },
          { operation: "restore", targetKey: keys[1]!, status: "failed" }
        ]
      },
      timestamps[2]
    )
    const legacyRetry = markRecoveryRestore(
      legacyUnknown,
      operationId,
      {
        outcome: "complete",
        requestId: "later-request",
        terminal: true,
        restoredDedupKeys: [keys[1]!],
        outcomes: [
          { operation: "restore", targetKey: keys[1]!, status: "confirmed" }
        ]
      },
      timestamps[3]
    )
    expect(legacyRetry[0]?.restoreOutcomes).toEqual([
      { operation: "restore", targetKey: keys[0]!, status: "unknown" },
      { operation: "restore", targetKey: keys[1]!, status: "confirmed" }
    ])
  })

  it("keeps cumulative unknown protection when its attempt summary ages out", () => {
    const [olderUnknown, retryKey] = dedupKeys
    let record = markRecoveryRestore(
      initialRecoveryRecord([olderUnknown!, retryKey!]),
      operationId,
      {
        outcome: "partial",
        requestId: "older-unknown-request",
        terminal: true,
        restoredDedupKeys: [],
        unknownDedupKeys: [olderUnknown!],
        outcomes: [
          { operation: "restore", targetKey: olderUnknown!, status: "unknown" },
          { operation: "restore", targetKey: retryKey!, status: "failed" }
        ]
      },
      timestamps[2]
    )[0]!

    for (let index = 0; index < 10; index += 1) {
      record = markRecoveryRestore(
        [record],
        operationId,
        {
          outcome: "failed",
          requestId: `summary-window-${index}`,
          terminal: true,
          restoredDedupKeys: [],
          outcomes: [
            { operation: "restore", targetKey: retryKey!, status: "failed" }
          ]
        },
        new Date(timestamps[2]!.getTime() + (index + 1) * 1000)
      )[0]!
    }

    const requestId = "live-after-summary-window"
    const timeout = markRecoveryRestore(
      [record],
      operationId,
      {
        outcome: "unknown",
        requestId,
        terminal: false,
        restoredDedupKeys: [],
        unknownDedupKeys: [retryKey!],
        outcomes: [
          { operation: "restore", targetKey: retryKey!, status: "unknown" }
        ]
      },
      timestamps[3]
    )[0]!
    const afterLateTerminal = markRecoveryRestore(
      [timeout],
      operationId,
      {
        outcome: "complete",
        requestId,
        terminal: true,
        restoredDedupKeys: [retryKey!],
        outcomes: [
          { operation: "restore", targetKey: retryKey!, status: "confirmed" }
        ]
      },
      timestamps[4]
    )[0]!

    expect(afterLateTerminal.restoreOutcomeHistory).toHaveLength(10)
    expect(
      afterLateTerminal.restoreOutcomeHistory?.some(
        (attempt) => attempt.requestId === "older-unknown-request"
      )
    ).toBe(false)
    expect(afterLateTerminal.restoreOutcomes).toEqual([
      { operation: "restore", targetKey: olderUnknown!, status: "unknown" },
      { operation: "restore", targetKey: retryKey!, status: "confirmed" }
    ])
    expect(afterLateTerminal.restoreUnknownCount).toBe(1)
    expect(afterLateTerminal.status).toBe("restore_unknown")
  })

  it("[SAFE-12 generated 2-attempt status oracle] checks the complete three-target matrix across durable reload", () => {
    type Cell = {
      status: MutationOutcome["status"]
      neverIssued: boolean
    }

    const cells: Cell[] = [
      { status: "confirmed", neverIssued: false },
      { status: "unknown", neverIssued: false },
      { status: "failed", neverIssued: false },
      { status: "failed", neverIssued: true }
    ]
    const keys = dedupKeys.slice(0, 3)
    let tracesChecked = 0
    let sawPreviouslyDispatchedFailureBecomeNeverIssued = false

    function matrices(length: number): Cell[][] {
      if (length === 0) return [[]]
      return matrices(length - 1).flatMap((prefix) =>
        cells.map((cell) => [...prefix, cell])
      )
    }

    for (const firstCells of matrices(keys.length)) {
      const firstFailedIndexes = firstCells.flatMap((cell, index) =>
        cell.status === "failed" ? [index] : []
      )

      for (const secondCells of matrices(firstFailedIndexes.length)) {
        const lifecycle = new TrashLifecycle({
          async savePreTrashReport() {},
          async saveTrashResultReport() {}
        })
        const firstRequestId = `matrix-first-${tracesChecked}`
        const beforeRestore = initialRecoveryRecord(keys)
        const firstDispatch = lifecycle.beginRestore(
          restoreData(keys),
          firstRequestId
        )
        expect(firstDispatch.args.dedupKeys).toEqual(keys)

        const firstOutcomes: MutationOutcome[] = keys.map((targetKey, index) => ({
          operation: "restore",
          targetKey,
          status: firstCells[index]!.status
        }))
        const firstNotDispatched = keys.filter((_, index) =>
          firstCells[index]!.neverIssued
        )
        const first = lifecycle.reconcileRestore({
          requestId: firstRequestId,
          success: true,
          outcomes: firstOutcomes,
          notDispatchedDedupKeys: firstNotDispatched
        })!
        const firstUnknownDedupKeys =
          "unknownDedupKeys" in first ? first.unknownDedupKeys : []
        const firstFailedKeys = keys.filter((_, index) =>
          firstCells[index]!.status === "failed"
        )
        const firstHistory = markRecoveryRestore(
          beforeRestore,
          operationId,
          {
            outcome: first.kind,
            restoredDedupKeys: first.restoredDedupKeys,
            unknownDedupKeys: firstUnknownDedupKeys,
            outcomes: first.outcomes,
            notDispatchedDedupKeys: first.notDispatchedDedupKeys
          },
          timestamps[2]
        )
        const afterFirstReload = reloadHistory(firstHistory)[0]!

        // The independent oracle keeps confirmed/unknown terminal and retries
        // only targets whose cumulative status is failed.
        expect(
          afterFirstReload.restoreOutcomes?.map((entry) => entry.status)
        ).toEqual(firstCells.map((cell) => cell.status))
        expect(afterFirstReload.restorableDedupKeys).toEqual(firstFailedKeys)
        expect(afterFirstReload.restoreUnknownCount).toBe(
          firstCells.filter((cell) => cell.status === "unknown").length
        )
        expect(afterFirstReload.restoreEverNotDispatchedDedupKeys).toEqual(
          firstNotDispatched.length > 0 ? firstNotDispatched : undefined
        )

        if (firstFailedKeys.length === 0) {
          expect(secondCells).toEqual([])
          tracesChecked += 1
          continue
        }
        if (!("undo" in first)) {
          throw new Error("Expected failed first-attempt targets to remain retryable.")
        }

        const retryRequestId = `matrix-second-${tracesChecked}`
        const retryDispatch = lifecycle.beginRestore(first.undo, retryRequestId)
        expect(retryDispatch.args.dedupKeys).toEqual(firstFailedKeys)
        expect(
          retryDispatch.args.dedupKeys.some((key) =>
            firstCells[keys.indexOf(key)]!.status === "unknown"
          )
        ).toBe(false)

        const secondByIndex = new Map(
          firstFailedIndexes.map((targetIndex, retryIndex) => [
            targetIndex,
            secondCells[retryIndex]!
          ])
        )
        const secondOutcomes: MutationOutcome[] = firstFailedKeys.map(
          (targetKey, retryIndex) => ({
            operation: "restore",
            targetKey,
            status: secondCells[retryIndex]!.status
          })
        )
        const secondNotDispatched = firstFailedKeys.filter((_, retryIndex) =>
          secondCells[retryIndex]!.neverIssued
        )
        const second = lifecycle.reconcileRestore({
          requestId: retryRequestId,
          success: true,
          outcomes: secondOutcomes,
          notDispatchedDedupKeys: secondNotDispatched
        })!
        const secondUnknownDedupKeys =
          "unknownDedupKeys" in second ? second.unknownDedupKeys : []
        const afterRetry = markRecoveryRestore(
          [afterFirstReload],
          operationId,
          {
            outcome: second.kind,
            restoredDedupKeys: second.restoredDedupKeys,
            unknownDedupKeys: secondUnknownDedupKeys,
            outcomes: second.outcomes,
            notDispatchedDedupKeys: second.notDispatchedDedupKeys
          },
          timestamps[4]
        )
        const afterSecondReload = reloadHistory(afterRetry)[0]!

        const expectedFinalStatuses = firstCells.map((firstCell, index) =>
          firstCell.status === "failed"
            ? secondByIndex.get(index)!.status
            : firstCell.status
        )
        const expectedRemainingFailed = keys.filter((_, index) =>
          expectedFinalStatuses[index] === "failed"
        )
        const expectedEverNotDispatched = [
          ...firstNotDispatched,
          ...secondNotDispatched.filter((key) => !firstNotDispatched.includes(key))
        ]

        expect(
          afterSecondReload.restoreOutcomes?.map((entry) => entry.status)
        ).toEqual(expectedFinalStatuses)
        expect(afterSecondReload.restorableDedupKeys).toEqual(
          expectedRemainingFailed
        )
        expect(afterSecondReload.restoreUnknownCount).toBe(
          expectedFinalStatuses.filter((status) => status === "unknown").length
        )
        expect(
          afterSecondReload.restoreOutcomeHistory?.[1]?.notDispatchedDedupKeys
        ).toEqual(secondNotDispatched)
        expect(afterSecondReload.restoreEverNotDispatchedDedupKeys).toEqual(
          expectedEverNotDispatched.length > 0
            ? expectedEverNotDispatched
            : undefined
        )
        expect(
          afterSecondReload.restoreOutcomes
            ?.filter((entry) => entry.status === "unknown")
            .map((entry) => entry.targetKey)
        ).toEqual(
          keys.filter((_, index) => expectedFinalStatuses[index] === "unknown")
        )

        firstFailedIndexes.forEach((targetIndex, retryIndex) => {
          if (
            !firstCells[targetIndex]!.neverIssued &&
            secondCells[retryIndex]!.neverIssued
          ) {
            sawPreviouslyDispatchedFailureBecomeNeverIssued = true
          }
        })
        tracesChecked += 1
      }
    }

    expect(tracesChecked).toBe(1000)
    expect(sawPreviouslyDispatchedFailureBecomeNeverIssued).toBe(true)
  })
})
