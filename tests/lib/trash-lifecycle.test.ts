import { describe, expect, it } from "vitest"

import type { DeleteReport } from "../../lib/delete-report"
import { DuplicateReviewSession } from "../../lib/duplicate-review-session"
import {
  TrashLifecycle,
  type TrashAuditAdapter,
  type TrashUndoData
} from "../../lib/trash-lifecycle"
import type { TrashResultReport } from "../../lib/trash-result-report"
import type { DuplicateGroup, GpdMediaItem } from "../../lib/types"

function fixture() {
  const mediaItems: Record<string, GpdMediaItem> = {
    keep: {
      mediaKey: "keep",
      dedupKey: "dedup-keep",
      thumb: "keep",
      timestamp: 1,
      creationTimestamp: 1,
      provider: "google"
    },
    trash: {
      mediaKey: "trash",
      dedupKey: "dedup-trash",
      thumb: "trash",
      timestamp: 1,
      creationTimestamp: 2,
      provider: "google"
    }
  }
  const groups: DuplicateGroup[] = [
    {
      id: "group",
      mediaKeys: ["keep", "trash"],
      originalMediaKey: "keep",
      similarity: 1
    }
  ]
  const reviewSession = new DuplicateReviewSession({
    groups,
    mediaItems,
    selections: {
      selectedGroupIds: new Set(["group"]),
      reviewedGroupIds: new Set(["group"]),
      keptOverrides: { group: new Set(["keep"]) }
    }
  })
  return { groups, mediaItems, reviewSession }
}

function inMemoryAudit() {
  const deleteReports: DeleteReport[] = []
  const resultReports: TrashResultReport[] = []
  const adapter: TrashAuditAdapter = {
    async savePreTrashReport(report) {
      deleteReports.push(report)
    },
    async saveTrashResultReport(report) {
      resultReports.push(report)
    }
  }
  return { adapter, deleteReports, resultReports }
}

async function begin(lifecycle: TrashLifecycle) {
  const { groups, mediaItems, reviewSession } = fixture()
  const plan = reviewSession.trashPlan(groups)
  const command = await lifecycle.begin({
    plan,
    reviewSession,
    groups,
    snapshot: { mediaItems, groups, totalItems: 2 },
    batchPolicy: {
      batchSize: 25,
      batchPauseMs: 1000,
      retryCount: 2,
      retryBackoffMs: 1000
    }
  })
  return { command, plan }
}

describe("TrashLifecycle", () => {
  it("persists the pre-trash audit before exposing the provider command", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)

    const { command } = await begin(lifecycle)

    expect(audit.deleteReports).toHaveLength(1)
    expect(command).toMatchObject({
      provider: "google",
      totalToTrash: 1,
      args: {
        dedupKeys: ["dedup-trash"],
        mediaKeysToTrash: ["trash"],
        batchSize: 25
      }
    })
  })

  it("reconciles a complete outcome with an undo snapshot", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    await begin(lifecycle)

    const outcome = await lifecycle.reconcile({
      success: true,
      data: {
        trashedKeys: ["trash"],
        trashedDedupKeys: ["dedup-trash"]
      }
    })

    expect(outcome.kind).toBe("complete")
    expect(outcome.movedCount).toBe(1)
    expect(outcome.undo?.provider).toBe("google")
    expect(outcome.undo?.snapshot.totalItems).toBe(2)
    expect(audit.resultReports[0]).toMatchObject({
      status: "complete",
      attemptedMediaKeys: ["trash"],
      movedMediaKeys: ["trash"]
    })
  })

  it("keeps partial failure auditable and restorable", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    await begin(lifecycle)

    const outcome = await lifecycle.reconcile({
      success: false,
      error: "provider stopped",
      data: {
        partial: true,
        trashedKeys: ["trash"],
        trashedDedupKeys: ["dedup-trash"],
        retryAttempts: 2
      }
    })

    expect(outcome).toMatchObject({
      kind: "partial",
      movedMediaKeys: ["trash"],
      movedCount: 1
    })
    if (outcome.kind !== "partial") throw new Error("expected partial outcome")
    expect(outcome.message).toContain("provider stopped")
    expect(audit.resultReports[0]).toMatchObject({
      status: "partial",
      retryAttempts: 2,
      error: "provider stopped"
    })
  })

  it("fails without creating undo when nothing moved", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    await begin(lifecycle)

    const outcome = await lifecycle.reconcile({
      success: false,
      error: "nothing moved"
    })

    expect(outcome).toEqual({
      kind: "failed",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      error: "nothing moved",
      undo: null
    })
  })

  it("returns failed restore data only for the current request", () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const undo = {
      provider: "google",
      dedupKeys: ["dedup-trash"],
      count: 1,
      snapshot: {
        mediaItems: {},
        groups: [],
        totalItems: 2
      }
    } satisfies TrashUndoData

    const command = lifecycle.beginRestore(undo, "restore-current")

    expect(command.args.dedupKeys).toEqual(["dedup-trash"])
    expect(
      lifecycle.reconcileRestore({
        requestId: "restore-stale",
        success: false
      })
    ).toBeUndefined()
    expect(
      lifecycle.reconcileRestore({
        requestId: "restore-current",
        success: false
      })
    ).toBe(undo)
  })

  it("does not infer that every requested item moved when a success omits identities", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    await begin(lifecycle)

    const outcome = await lifecycle.reconcile({ success: true, data: {} })

    expect(outcome).toMatchObject({
      kind: "failed",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      undo: null
    })
    if (outcome.kind !== "failed") throw new Error("expected failed outcome")
    expect(outcome.error).toContain("did not confirm")
    expect(audit.resultReports[0]).toMatchObject({
      status: "failed",
      attemptedMediaKeys: ["trash"],
      movedMediaKeys: []
    })
  })

  it("filters unrequested and mismatched provider identities to the exact pending pair", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    await begin(lifecycle)

    const outcome = await lifecycle.reconcile({
      success: true,
      data: {
        trashedKeys: ["unrequested", "trash"],
        trashedDedupKeys: ["unrequested-dedup", "dedup-trash"]
      }
    })

    expect(outcome).toMatchObject({
      kind: "partial",
      movedMediaKeys: ["trash"],
      movedDedupKeys: ["dedup-trash"],
      movedCount: 1
    })
  })

  it("keeps a success response with only one of two requested pairs partial", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const mediaItems: Record<string, GpdMediaItem> = {
      keepA: { ...fixture().mediaItems.keep, mediaKey: "keepA", dedupKey: "keep-dedup-a" },
      trashA: { ...fixture().mediaItems.trash, mediaKey: "trashA", dedupKey: "dedup-trash-a" },
      keepB: { ...fixture().mediaItems.keep, mediaKey: "keepB", dedupKey: "keep-dedup-b" },
      trashB: { ...fixture().mediaItems.trash, mediaKey: "trashB", dedupKey: "dedup-trash-b" }
    }
    const groups: DuplicateGroup[] = [
      { id: "group-a", mediaKeys: ["keepA", "trashA"], originalMediaKey: "keepA", similarity: 1 },
      { id: "group-b", mediaKeys: ["keepB", "trashB"], originalMediaKey: "keepB", similarity: 1 }
    ]
    const reviewSession = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(groups.map((group) => group.id)),
        reviewedGroupIds: new Set(groups.map((group) => group.id)),
        keptOverrides: { "group-a": new Set(["keepA"]), "group-b": new Set(["keepB"]) }
      }
    })
    const plan = reviewSession.trashPlan(groups)
    await lifecycle.begin({
      plan,
      reviewSession,
      groups,
      snapshot: { mediaItems, groups, totalItems: 4 },
      batchPolicy: { batchSize: 25, batchPauseMs: 0, retryCount: 0, retryBackoffMs: 0 }
    })

    const outcome = await lifecycle.reconcile({
      success: true,
      data: { trashedKeys: ["trashA"], trashedDedupKeys: ["dedup-trash-a"] }
    })

    expect(outcome.kind).toBe("partial")
    expect(outcome.movedMediaKeys).toEqual(["trashA"])
    expect(outcome.movedDedupKeys).toEqual(["dedup-trash-a"])
    expect(outcome.undo?.dedupKeys).toEqual(["dedup-trash-a"])
    expect(audit.resultReports[0]).toMatchObject({
      status: "partial",
      attemptedMediaKeys: ["trashA", "trashB"],
      movedMediaKeys: ["trashA"]
    })
  })

  it.each([
    ["foreign media only", { trashedKeys: ["foreign", "trash"], trashedDedupKeys: ["dedup-trash"] }],
    ["foreign dedup only", { trashedKeys: ["trash"], trashedDedupKeys: ["foreign-dedup", "dedup-trash"] }]
  ])("rejects an asymmetric %s identity response", async (_label, data) => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    await begin(lifecycle)

    const outcome = await lifecycle.reconcile({ success: true, data })

    expect(outcome.kind).toBe("partial")
    expect(outcome.movedMediaKeys).toEqual(["trash"])
    expect(outcome.movedDedupKeys).toEqual(["dedup-trash"])
    expect(outcome).toMatchObject({
      message: expect.stringContaining("outside the confirmed request")
    })
    expect(audit.resultReports[0]).toMatchObject({
      status: "partial",
      movedMediaKeys: ["trash"],
      movedDedupKeys: ["dedup-trash"],
      error: "Trash provider response included identities outside the confirmed request."
    })
  })

  it("does not cross-pair media and dedup identities from different requested items", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const mediaItems: Record<string, GpdMediaItem> = {
      keepA: { ...fixture().mediaItems.keep, mediaKey: "keepA", dedupKey: "keep-dedup-a" },
      trashA: { ...fixture().mediaItems.trash, mediaKey: "trashA", dedupKey: "dedup-trash-a" },
      keepB: { ...fixture().mediaItems.keep, mediaKey: "keepB", dedupKey: "keep-dedup-b" },
      trashB: { ...fixture().mediaItems.trash, mediaKey: "trashB", dedupKey: "dedup-trash-b" }
    }
    const groups: DuplicateGroup[] = [
      { id: "cross-a", mediaKeys: ["keepA", "trashA"], originalMediaKey: "keepA", similarity: 1 },
      { id: "cross-b", mediaKeys: ["keepB", "trashB"], originalMediaKey: "keepB", similarity: 1 }
    ]
    const reviewSession = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(groups.map((group) => group.id)),
        reviewedGroupIds: new Set(groups.map((group) => group.id)),
        keptOverrides: { "cross-a": new Set(["keepA"]), "cross-b": new Set(["keepB"]) }
      }
    })
    const plan = reviewSession.trashPlan(groups)
    await lifecycle.begin({
      plan,
      reviewSession,
      groups,
      snapshot: { mediaItems, groups, totalItems: 4 },
      batchPolicy: { batchSize: 25, batchPauseMs: 0, retryCount: 0, retryBackoffMs: 0 }
    })

    const outcome = await lifecycle.reconcile({
      success: true,
      data: { trashedKeys: ["trashA"], trashedDedupKeys: ["dedup-trash-b"] }
    })

    expect(outcome.kind).toBe("failed")
    expect(outcome.movedMediaKeys).toEqual([])
    expect(outcome.movedDedupKeys).toEqual([])
    expect(outcome.undo).toBeNull()
  })

  it("rejects a concurrent begin while the first pre-trash audit is unresolved", async () => {
    const base = fixture()
    let releaseAudit: (() => void) | undefined
    let auditStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      auditStarted = resolve
    })
    const audit: TrashAuditAdapter = {
      async savePreTrashReport() {
        auditStarted?.()
        await new Promise<void>((resolve) => {
          releaseAudit = resolve
        })
      },
      async saveTrashResultReport() {}
    }
    const lifecycle = new TrashLifecycle(audit)
    const params = {
      plan: base.reviewSession.trashPlan(base.groups),
      reviewSession: base.reviewSession,
      groups: base.groups,
      snapshot: { mediaItems: base.mediaItems, groups: base.groups, totalItems: 2 },
      batchPolicy: { batchSize: 25, batchPauseMs: 0, retryCount: 0, retryBackoffMs: 0 }
    }
    const first = lifecycle.begin(params)
    await started
    await expect(lifecycle.begin(params)).rejects.toThrow(
      "Another trash operation is already pending."
    )
    releaseAudit?.()
    const command = await first
    expect(command.args.mediaKeysToTrash).toEqual(["trash"])
    expect(
      await lifecycle.reconcile({
        success: true,
        data: { trashedKeys: ["trash"], trashedDedupKeys: ["dedup-trash"] }
      })
    ).toMatchObject({ kind: "complete", movedCount: 1 })
  })

  it("ignores a late reply after the operation has been reset", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    await begin(lifecycle)
    lifecycle.reset()

    const outcome = await lifecycle.reconcile({
      success: true,
      data: {
        trashedKeys: ["trash"],
        trashedDedupKeys: ["dedup-trash"]
      }
    })

    expect(outcome).toMatchObject({
      kind: "failed",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      undo: null
    })
  })

  it("does not consume a pending operation for a mismatched request ID", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const { command } = await begin(lifecycle)

    const stale = await lifecycle.reconcile({
      requestId: "stale-request",
      success: true,
      data: {
        trashedKeys: ["trash"],
        trashedDedupKeys: ["dedup-trash"]
      }
    })

    expect(stale).toMatchObject({
      kind: "failed",
      error: "Trash response did not match the pending request."
    })
    expect(lifecycle.isPending(command.requestId)).toBe(true)
    expect(audit.resultReports).toHaveLength(0)

    await expect(
      lifecycle.reconcile({
        requestId: command.requestId,
        success: true,
        data: {
          trashedKeys: ["trash"],
          trashedDedupKeys: ["dedup-trash"]
        }
      })
    ).resolves.toMatchObject({ kind: "complete", movedCount: 1 })
  })

  it("records a timeout as ambiguous and accepts only the matching late reply", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const { command } = await begin(lifecycle)

    await expect(
      lifecycle.timeout({ requestId: command.requestId, error: "provider timeout" })
    ).resolves.toMatchObject({
      kind: "failed",
      error: "provider timeout"
    })
    expect(lifecycle.isPending(command.requestId)).toBe(true)
    expect(audit.resultReports[0]).toMatchObject({
      status: "failed",
      error: "provider timeout",
      movedMediaKeys: []
    })
    expect(audit.resultReports[0].movedMediaKeys).toEqual([])
    expect(audit.resultReports[0].movedDedupKeys).toEqual([])

    await expect(
      lifecycle.reconcile({
        requestId: command.requestId,
        success: true,
        data: {
          trashedKeys: ["trash"],
          trashedDedupKeys: ["dedup-trash"]
        }
      })
    ).resolves.toMatchObject({ kind: "complete", movedCount: 1 })
    expect(lifecycle.isPending()).toBe(false)
    expect(audit.resultReports).toHaveLength(2)
  })

  it("generates a request identity when the caller supplies only whitespace", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const { groups, mediaItems, reviewSession } = fixture()

    const command = await lifecycle.begin({
      plan: reviewSession.trashPlan(groups),
      reviewSession,
      groups,
      snapshot: { mediaItems, groups, totalItems: 2 },
      requestId: "   ",
      batchPolicy: {
        batchSize: 25,
        batchPauseMs: 0,
        retryCount: 0,
        retryBackoffMs: 0
      }
    })

    expect(command.requestId).toMatch(/^gpd-trash-request-\d+-[a-z0-9]+$/)
    expect(lifecycle.isPending(command.requestId)).toBe(true)
  })

  it("rejects a timeout for a stale request and records the default timeout safely", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const { command } = await begin(lifecycle)

    await expect(
      lifecycle.timeout({ requestId: "stale-request" })
    ).resolves.toEqual({
      kind: "failed",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      error: "Trash timeout did not match the pending request.",
      undo: null
    })
    expect(audit.resultReports).toHaveLength(0)

    await expect(lifecycle.timeout({ requestId: command.requestId })).resolves.toEqual({
      kind: "failed",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      error:
        "Trash provider did not respond before the safety timeout. Do not retry until the result is reconciled.",
      undo: null
    })
    expect(lifecycle.isPending(command.requestId)).toBe(true)
    expect(audit.resultReports[0]).toMatchObject({
      status: "failed",
      movedMediaKeys: [],
      movedDedupKeys: [],
      error:
        "Trash provider did not respond before the safety timeout. Do not retry until the result is reconciled."
    })

    await expect(
      lifecycle.timeout({ requestId: command.requestId })
    ).resolves.toEqual({
      kind: "failed",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      error: "Trash request is already awaiting provider reconciliation.",
      undo: null
    })
    expect(audit.resultReports).toHaveLength(1)
  })

  it("cancels only the matching pending request", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const { command } = await begin(lifecycle)

    expect(lifecycle.isPending()).toBe(true)
    expect(lifecycle.cancel("stale-request")).toBe(false)
    expect(lifecycle.isPending("stale-request")).toBe(false)
    expect(lifecycle.isPending(command.requestId)).toBe(true)
    expect(lifecycle.cancel(command.requestId)).toBe(true)
    expect(lifecycle.isPending()).toBe(false)
  })

  it("consumes the pending operation before an async audit save so duplicate replies cannot replay it", async () => {
    const audit = inMemoryAudit()
    let releaseResultAudit: (() => void) | undefined
    const resultAuditPending = new Promise<void>((resolve) => {
      releaseResultAudit = resolve
    })
    const originalSave = audit.adapter.saveTrashResultReport
    audit.adapter.saveTrashResultReport = async (...args) => {
      await resultAuditPending
      return originalSave(...args)
    }
    const lifecycle = new TrashLifecycle(audit.adapter)
    await begin(lifecycle)

    const first = lifecycle.reconcile({
      success: true,
      data: {
        trashedKeys: ["trash"],
        trashedDedupKeys: ["dedup-trash"]
      }
    })
    const duplicate = await lifecycle.reconcile({
      success: true,
      data: {
        trashedKeys: ["trash"],
        trashedDedupKeys: ["dedup-trash"]
      }
    })

    expect(duplicate).toMatchObject({ kind: "failed", movedCount: 0 })
    releaseResultAudit?.()
    expect(await first).toMatchObject({ kind: "complete", movedCount: 1 })
  })
})
