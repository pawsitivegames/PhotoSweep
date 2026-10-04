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

function trashedRecoveryRecord(
  dedupKeys: string[],
  mediaKeys = dedupKeys.map((key) => `media-${key}`)
) {
  const record = createPendingRecoveryRecord(
    deleteReport,
    {
      ...context,
      attemptedDedupKeys: dedupKeys,
      attemptedMediaKeys: mediaKeys
    },
    new Date("2026-09-15T00:01:00.000Z")
  )
  const report = buildTrashResultReport({
    operationId: context.operationId,
    attemptedMediaKeys: mediaKeys,
    attemptedDedupKeys: dedupKeys,
    movedMediaKeys: mediaKeys,
    movedDedupKeys: dedupKeys
  })
  return updateRecoveryRecordFromTrash(
    [record],
    report,
    {
      ...context,
      attemptedDedupKeys: dedupKeys,
      attemptedMediaKeys: mediaKeys
    },
    new Date("2026-09-15T00:02:00.000Z")
  )
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

  it("[PARITY-04] marks a record restored and removes its future restore targets", () => {
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
      {
        outcome: "complete",
        restoredDedupKeys: context.attemptedDedupKeys
      },
      new Date("2026-09-15T00:03:00.000Z")
    )
    expect(restored[0]).toMatchObject({ status: "restored", restoreAttempts: 1 })
    expect(restored[0]?.restorableDedupKeys).toEqual([])
    expect(isRecoveryRestorable(restored[0]!)).toBe(false)
  })

  it("[PARITY-04] stores fresh iCloud refs and preserves partial restore targets after reload", () => {
    const icloudContext: RecoveryHistoryContext = {
      operationId: "icloud-cleanup",
      provider: "icloud",
      providerSessionId: "session-a",
      attemptedDedupKeys: ["master-a", "master-b"],
      attemptedMediaKeys: ["media-a", "media-b"],
      icloudAssetRefs: [
        {
          recordName: "asset-a",
          changeTag: "pre-trash-a",
          zoneName: "PrimarySync",
          ownerRecordName: "owner"
        },
        {
          recordName: "asset-b",
          changeTag: "pre-trash-b",
          zoneName: "PrimarySync",
          ownerRecordName: "owner"
        }
      ],
      confirmedIcloudAssetRefs: [
        {
          recordName: "asset-a",
          changeTag: "fresh-a",
          zoneName: "PrimarySync",
          ownerRecordName: "owner"
        },
        {
          recordName: "asset-b",
          changeTag: "fresh-b",
          zoneName: "PrimarySync",
          ownerRecordName: "owner"
        }
      ]
    }
    const pending = createPendingRecoveryRecord(
      deleteReport,
      { ...context, ...icloudContext },
      new Date("2026-09-15T00:01:00.000Z")
    )
    expect(pending.icloudAssetRefs).toBeUndefined()
    const report = buildTrashResultReport({
      operationId: icloudContext.operationId,
      attemptedMediaKeys: icloudContext.attemptedMediaKeys,
      attemptedDedupKeys: icloudContext.attemptedDedupKeys,
      movedMediaKeys: icloudContext.attemptedMediaKeys,
      movedDedupKeys: icloudContext.attemptedDedupKeys
    })
    const updated = updateRecoveryRecordFromTrash(
      [pending],
      report,
      icloudContext,
      new Date("2026-09-15T00:02:00.000Z")
    )

    expect(updated[0]?.icloudAssetRefs?.map((ref) => ref.changeTag)).toEqual([
      "fresh-a",
      "fresh-b"
    ])
    const partial = markRecoveryRestore(
      updated,
      icloudContext.operationId,
      {
        outcome: "partial",
        restoredDedupKeys: ["master-a"],
        outcomes: [
          { operation: "restore", targetKey: "master-a", status: "confirmed" },
          { operation: "restore", targetKey: "master-b", status: "failed" }
        ],
        error: "second restore batch failed"
      },
      new Date("2026-09-15T00:03:00.000Z")
    )
    const afterReload = sanitizeRecoveryHistory(
      JSON.parse(JSON.stringify(partial)),
      Date.parse("2026-09-15T00:04:00.000Z")
    )

    expect(afterReload[0]).toMatchObject({
      status: "restore_partial",
      restorableDedupKeys: ["master-b"],
      restorableMediaKeys: ["media-b"],
      icloudAssetRefs: [
        {
          recordName: "asset-b",
          changeTag: "fresh-b"
        }
      ]
    })
    expect(isRecoveryRestorable(afterReload[0]!)).toBe(true)
  })

  it("keeps an unknown target sticky while a separate failed target succeeds after reload", () => {
    const pending = createPendingRecoveryRecord(
      deleteReport,
      {
        ...context,
        attemptedDedupKeys: ["restore-a", "restore-b", "restore-c"],
        attemptedMediaKeys: ["media-a", "media-b", "media-c"]
      },
      new Date("2026-09-15T00:01:00.000Z")
    )
    const report = buildTrashResultReport({
      operationId: context.operationId,
      attemptedMediaKeys: ["media-a", "media-b", "media-c"],
      attemptedDedupKeys: ["restore-a", "restore-b", "restore-c"],
      movedMediaKeys: ["media-a", "media-b", "media-c"],
      movedDedupKeys: ["restore-a", "restore-b", "restore-c"]
    })
    const trashed = updateRecoveryRecordFromTrash(
      [pending],
      report,
      {
        ...context,
        attemptedDedupKeys: ["restore-a", "restore-b", "restore-c"],
        attemptedMediaKeys: ["media-a", "media-b", "media-c"]
      },
      new Date("2026-09-15T00:02:00.000Z")
    )
    const firstAttempt = markRecoveryRestore(
      trashed,
      context.operationId,
      {
        outcome: "partial",
        restoredDedupKeys: ["restore-a"],
        outcomes: [
          { operation: "restore", targetKey: "restore-a", status: "confirmed" },
          { operation: "restore", targetKey: "restore-b", status: "unknown" },
          { operation: "restore", targetKey: "restore-c", status: "failed" }
        ],
        notDispatchedDedupKeys: ["restore-c"],
        unknownDedupKeys: ["restore-b"],
        error: "one target remained ambiguous"
      },
      new Date("2026-09-15T00:03:00.000Z")
    )
    const afterFirstReload = sanitizeRecoveryHistory(
      JSON.parse(JSON.stringify(firstAttempt)),
      Date.parse("2026-09-15T00:04:00.000Z")
    )[0]!

    expect(afterFirstReload).toMatchObject({
      status: "restore_unknown",
      restoreUnknownCount: 1,
      restorableDedupKeys: ["restore-c"],
      restorableMediaKeys: ["media-c"],
      restoreOutcomes: [
        { targetKey: "restore-a", status: "confirmed" },
        { targetKey: "restore-b", status: "unknown" },
        { targetKey: "restore-c", status: "failed" }
      ],
      restoreEverNotDispatchedDedupKeys: ["restore-c"]
    })
    expect(isRecoveryRestorable(afterFirstReload)).toBe(true)

    const retried = markRecoveryRestore(
      [afterFirstReload],
      context.operationId,
      {
        outcome: "complete",
        restoredDedupKeys: ["restore-c"],
        outcomes: [
          { operation: "restore", targetKey: "restore-c", status: "confirmed" }
        ]
      },
      new Date("2026-09-15T00:05:00.000Z")
    )
    const afterRetryReload = sanitizeRecoveryHistory(
      JSON.parse(JSON.stringify(retried)),
      Date.parse("2026-09-15T00:06:00.000Z")
    )[0]!

    expect(afterRetryReload).toMatchObject({
      status: "restore_unknown",
      restoreUnknownCount: 1,
      restorableDedupKeys: [],
      restoreOutcomes: [
        { targetKey: "restore-a", status: "confirmed" },
        { targetKey: "restore-b", status: "unknown" },
        { targetKey: "restore-c", status: "confirmed" }
      ],
      restoreEverNotDispatchedDedupKeys: ["restore-c"],
      restoreOutcomeHistory: [
        {
          outcomes: [
            { targetKey: "restore-a", status: "confirmed" },
            { targetKey: "restore-b", status: "unknown" },
            { targetKey: "restore-c", status: "failed" }
          ],
          notDispatchedDedupKeys: ["restore-c"]
        },
        {
          outcomes: [{ targetKey: "restore-c", status: "confirmed" }],
          notDispatchedDedupKeys: []
        }
      ]
    })
    expect(isRecoveryRestorable(afterRetryReload)).toBe(false)
  })

  // This reducer test covers persisted request-ID matching only. The app's
  // in-memory live-request map is the boundary that rejects replies after reload.
  it("resolves provisional timeout unknowns from a complete terminal for the same persisted request", () => {
    const keys = ["late-a", "late-b", "late-c"]
    const requestId = "live-restore-request"
    const timeout = markRecoveryRestore(
      trashedRecoveryRecord(keys),
      context.operationId,
      {
        outcome: "partial",
        requestId,
        terminal: false,
        restoredDedupKeys: ["late-a"],
        unknownDedupKeys: ["late-b", "late-c"],
        outcomes: [
          { operation: "restore", targetKey: "late-a", status: "confirmed" },
          { operation: "restore", targetKey: "late-b", status: "unknown" },
          { operation: "restore", targetKey: "late-c", status: "unknown" }
        ]
      },
      new Date("2026-09-15T00:03:00.000Z")
    )
    const afterTimeoutReload = sanitizeRecoveryHistory(
      JSON.parse(JSON.stringify(timeout)),
      Date.parse("2026-09-15T00:04:00.000Z")
    )
    expect(afterTimeoutReload[0]).toMatchObject({
      status: "restore_unknown",
      restoreUnknownCount: 2,
      restorableDedupKeys: [],
      restoreOutcomeHistory: [
        {
          requestId,
          terminal: false,
          outcomes: [
            { targetKey: "late-a", status: "confirmed" },
            { targetKey: "late-b", status: "unknown" },
            { targetKey: "late-c", status: "unknown" }
          ]
        }
      ]
    })

    const terminal = markRecoveryRestore(
      afterTimeoutReload,
      context.operationId,
      {
        outcome: "complete",
        requestId,
        terminal: true,
        restoredDedupKeys: keys,
        outcomes: keys.map((targetKey) => ({
          operation: "restore" as const,
          targetKey,
          status: "confirmed" as const
        }))
      },
      new Date("2026-09-15T00:05:00.000Z")
    )
    const afterTerminalReload = sanitizeRecoveryHistory(
      JSON.parse(JSON.stringify(terminal)),
      Date.parse("2026-09-15T00:06:00.000Z")
    )
    expect(afterTerminalReload[0]).toMatchObject({
      status: "restored",
      restoreAttempts: 1,
      restoreUnknownCount: 0,
      restorableDedupKeys: [],
      restoreOutcomes: keys.map((targetKey) => ({
        operation: "restore",
        targetKey,
        status: "confirmed"
      })),
      restoreOutcomeHistory: [{ requestId, terminal: true }]
    })

    const duplicateTerminal = markRecoveryRestore(
      afterTerminalReload,
      context.operationId,
      {
        outcome: "partial",
        requestId,
        terminal: true,
        restoredDedupKeys: [],
        unknownDedupKeys: keys,
        outcomes: keys.map((targetKey) => ({
          operation: "restore" as const,
          targetKey,
          status: "unknown" as const
        }))
      },
      new Date("2026-09-15T00:07:00.000Z")
    )
    expect(duplicateTerminal).toEqual(afterTerminalReload)
  })

  it("keeps unknowns from distinct or legacy requests sticky and ignores malformed same-request terminals", () => {
    const keys = ["sealed-unknown", "retry-failed"]
    const first = markRecoveryRestore(
      trashedRecoveryRecord(keys),
      context.operationId,
      {
        outcome: "partial",
        requestId: "attempt-one",
        restoredDedupKeys: [],
        unknownDedupKeys: ["sealed-unknown"],
        outcomes: [
          { operation: "restore", targetKey: "sealed-unknown", status: "unknown" },
          { operation: "restore", targetKey: "retry-failed", status: "failed" }
        ]
      },
      new Date("2026-09-15T00:03:00.000Z")
    )
    const afterReload = sanitizeRecoveryHistory(
      JSON.parse(JSON.stringify(first)),
      Date.parse("2026-09-15T00:04:00.000Z")
    )
    const retry = markRecoveryRestore(
      afterReload,
      context.operationId,
      {
        outcome: "complete",
        requestId: "attempt-two",
        restoredDedupKeys: ["retry-failed"],
        outcomes: [
          { operation: "restore", targetKey: "retry-failed", status: "confirmed" }
        ]
      },
      new Date("2026-09-15T00:05:00.000Z")
    )
    expect(retry[0]).toMatchObject({
      status: "restore_unknown",
      restoreUnknownCount: 1,
      restoreOutcomes: [
        { targetKey: "sealed-unknown", status: "unknown" },
        { targetKey: "retry-failed", status: "confirmed" }
      ]
    })

    const legacy = markRecoveryRestore(
      trashedRecoveryRecord(["legacy-unknown"]),
      context.operationId,
      {
        outcome: "unknown",
        restoredDedupKeys: [],
        unknownDedupKeys: ["legacy-unknown"],
        outcomes: [
          { operation: "restore", targetKey: "legacy-unknown", status: "unknown" }
        ]
      },
      new Date("2026-09-15T00:03:00.000Z")
    )
    const malformedTerminal = markRecoveryRestore(
      legacy,
      context.operationId,
      {
        outcome: "complete",
        restoredDedupKeys: ["legacy-unknown"],
        outcomes: [
          { operation: "restore", targetKey: "foreign-target", status: "confirmed" }
        ]
      },
      new Date("2026-09-15T00:04:00.000Z")
    )
    expect(malformedTerminal[0]).toMatchObject({
      status: "restore_unknown",
      restoreUnknownCount: 1,
      restoreOutcomes: [
        { targetKey: "legacy-unknown", status: "unknown" }
      ]
    })
  })

  it("preserves an older unknown through same-request resolution beyond the ten-attempt history window", () => {
    let record = trashedRecoveryRecord(["older-unknown", "retry"])[0]!
    record = markRecoveryRestore(
      [record],
      context.operationId,
      {
        outcome: "partial",
        requestId: "older-attempt",
        restoredDedupKeys: [],
        unknownDedupKeys: ["older-unknown"],
        outcomes: [
          { operation: "restore", targetKey: "older-unknown", status: "unknown" },
          { operation: "restore", targetKey: "retry", status: "failed" }
        ]
      },
      new Date("2026-09-15T00:03:00.000Z")
    )[0]!
    for (let index = 0; index < 10; index += 1) {
      record = markRecoveryRestore(
        [record],
        context.operationId,
        {
          outcome: "failed",
          requestId: `retry-${index}`,
          restoredDedupKeys: [],
          outcomes: [
            { operation: "restore", targetKey: "retry", status: "failed" }
          ]
        },
        new Date(Date.parse("2026-09-15T00:04:00.000Z") + index * 1000)
      )[0]!
    }
    const currentRequestId = "still-live-after-cap"
    const timeout = markRecoveryRestore(
      [record],
      context.operationId,
      {
        outcome: "unknown",
        requestId: currentRequestId,
        terminal: false,
        restoredDedupKeys: [],
        unknownDedupKeys: ["retry"],
        outcomes: [
          { operation: "restore", targetKey: "retry", status: "unknown" }
        ]
      },
      new Date("2026-09-15T00:05:00.000Z")
    )[0]!
    const lateTerminal = markRecoveryRestore(
      [timeout],
      context.operationId,
      {
        outcome: "complete",
        requestId: currentRequestId,
        terminal: true,
        restoredDedupKeys: ["retry"],
        outcomes: [
          { operation: "restore", targetKey: "retry", status: "confirmed" }
        ]
      },
      new Date("2026-09-15T00:06:00.000Z")
    )
    expect(lateTerminal[0]).toMatchObject({
      status: "restore_unknown",
      restoreUnknownCount: 1,
      restoreOutcomes: [
        { targetKey: "older-unknown", status: "unknown" },
        { targetKey: "retry", status: "confirmed" }
      ]
    })
    expect(lateTerminal[0]?.restoreOutcomeHistory).toHaveLength(10)
  })

  it("removes persisted confirmed and unknown outcomes from malformed retry targets while keeping aligned failed targets", () => {
    const record = trashedRecoveryRecord(
      ["unknown", "confirmed", "failed"],
      ["media-u", "media-c", "media-f"]
    )[0]!
    const malformedPersisted = {
      ...record,
      status: "restore_partial" as const,
      restoreUnknownCount: 1,
      restoreOutcomes: [
        { operation: "restore" as const, targetKey: "unknown", status: "unknown" as const },
        { operation: "restore" as const, targetKey: "confirmed", status: "confirmed" as const },
        { operation: "restore" as const, targetKey: "failed", status: "failed" as const }
      ],
      restorableDedupKeys: ["unknown", "confirmed", "failed"],
      restorableMediaKeys: ["media-u", "media-c", "media-f"],
      icloudAssetRefs: [
        { recordName: "ref-u", changeTag: "tag-u", zoneName: "PrimarySync", ownerRecordName: "owner" },
        { recordName: "ref-c", changeTag: "tag-c", zoneName: "PrimarySync", ownerRecordName: "owner" },
        { recordName: "ref-f", changeTag: "tag-f", zoneName: "PrimarySync", ownerRecordName: "owner" }
      ]
    }

    const reloaded = sanitizeRecoveryHistory([malformedPersisted])[0]!
    expect(reloaded).toMatchObject({
      status: "restore_unknown",
      restorableDedupKeys: ["failed"],
      restorableMediaKeys: ["media-f"],
      icloudAssetRefs: [
        { recordName: "ref-f", changeTag: "tag-f" }
      ]
    })
    expect(isRecoveryRestorable(reloaded)).toBe(true)

    const unknownOnly = sanitizeRecoveryHistory([
      {
        ...malformedPersisted,
        restorableDedupKeys: ["unknown"],
        restorableMediaKeys: ["media-u"],
        icloudAssetRefs: [malformedPersisted.icloudAssetRefs[0]]
      }
    ])[0]!
    expect(unknownOnly.restorableDedupKeys).toEqual([])
    expect(unknownOnly.restorableMediaKeys).toEqual([])
    expect(unknownOnly.icloudAssetRefs).toBeUndefined()
    expect(isRecoveryRestorable(unknownOnly)).toBe(false)
  })

  it("allows exact live progress to replace only the same request's durable pre-dispatch guard", () => {
    const initial = trashedRecoveryRecord(["a", "b"])[0]!
    const requestId = "restore-intent-progress"
    const guarded = markRecoveryRestore(
      [initial],
      context.operationId,
      {
        outcome: "unknown",
        requestId,
        terminal: false,
        restoredDedupKeys: [],
        unknownDedupKeys: ["a", "b"],
        outcomes: [
          { operation: "restore", targetKey: "a", status: "unknown", reason: "durable-pre-dispatch-intent" },
          { operation: "restore", targetKey: "b", status: "unknown", reason: "durable-pre-dispatch-intent" }
        ]
      }
    )[0]!

    const progressed = markRecoveryRestore(
      [guarded],
      context.operationId,
      {
        outcome: "unknown",
        requestId,
        terminal: false,
        restoredDedupKeys: ["a"],
        unknownDedupKeys: ["b"],
        outcomes: [
          { operation: "restore", targetKey: "a", status: "confirmed" },
          { operation: "restore", targetKey: "b", status: "unknown" }
        ]
      }
    )[0]!

    expect(progressed.restoreOutcomes).toEqual([
      { operation: "restore", targetKey: "a", status: "confirmed" },
      { operation: "restore", targetKey: "b", status: "unknown" }
    ])
    expect(progressed.restoreOutcomeHistory?.[0]?.terminal).toBe(false)
    expect(progressed.restorableDedupKeys).toEqual([])
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
