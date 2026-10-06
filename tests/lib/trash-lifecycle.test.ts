import { describe, expect, it } from "vitest"

import type { DeleteReport } from "../../lib/delete-report"
import { DuplicateReviewSession } from "../../lib/duplicate-review-session"
import {
  TrashLifecycle,
  type IcloudAssetRef,
  type TrashAuditAdapter,
  type TrashAuditContext,
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
      provider: "google",
      favoriteStatus: "not-favorite",
      favoriteSource: "provider-metadata"
    },
    trash: {
      mediaKey: "trash",
      dedupKey: "dedup-trash",
      thumb: "trash",
      timestamp: 1,
      creationTimestamp: 2,
      provider: "google",
      favoriteStatus: "not-favorite",
      favoriteSource: "provider-metadata"
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
  const deleteContexts: Array<TrashAuditContext | undefined> = []
  const resultReports: TrashResultReport[] = []
  const resultContexts: Array<TrashAuditContext | undefined> = []
  const adapter: TrashAuditAdapter = {
    async savePreTrashReport(report, context) {
      deleteReports.push(report)
      deleteContexts.push(context)
    },
    async saveTrashResultReport(report, context) {
      resultReports.push(report)
      resultContexts.push(context)
    }
  }
  return {
    adapter,
    deleteReports,
    deleteContexts,
    resultReports,
    resultContexts
  }
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

function icloudFixture() {
  const audit = inMemoryAudit()
  const lifecycle = new TrashLifecycle(audit.adapter)
  const assetRef = (recordName: string, changeTag: string): IcloudAssetRef => ({
    recordName,
    changeTag,
    zoneName: "PrimarySync",
    ownerRecordName: "owner"
  })
  const mediaItems: Record<string, GpdMediaItem> = {
    keep: {
      ...fixture().mediaItems.keep,
      provider: "icloud",
      icloudAsset: assetRef("asset-keep", "old-keep")
    },
    trash: {
      ...fixture().mediaItems.trash,
      provider: "icloud",
      icloudAsset: assetRef("asset-trash", "old-trash")
    }
  }
  const groups: DuplicateGroup[] = [
    {
      id: "icloud-group",
      mediaKeys: ["keep", "trash"],
      originalMediaKey: "keep",
      similarity: 1
    }
  ]
  const reviewSession = new DuplicateReviewSession({
    groups,
    mediaItems,
    selections: {
      selectedGroupIds: new Set(["icloud-group"]),
      reviewedGroupIds: new Set(["icloud-group"]),
      keptOverrides: { "icloud-group": new Set(["keep"]) }
    }
  })
  return {
    audit,
    lifecycle,
    groups,
    mediaItems,
    reviewSession,
    plan: reviewSession.trashPlan(groups),
    assetRef
  }
}

describe("TrashLifecycle", () => {
  it("requires a current unknown-favorite acknowledgement at dispatch", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const { groups, mediaItems, reviewSession } = fixture()
    mediaItems.trash!.favoriteStatus = "unknown"
    mediaItems.trash!.favoriteSource = "unavailable"
    const plan = reviewSession.trashPlan(groups)
    const params = {
      plan,
      reviewSession,
      groups,
      snapshot: { mediaItems, groups, totalItems: 2 },
      batchPolicy: {
        batchSize: 25,
        batchPauseMs: 1_000,
        retryCount: 2,
        retryBackoffMs: 1_000
      }
    }

    await expect(lifecycle.begin(params)).rejects.toThrow(
      /explicit acknowledgement is required/
    )
    expect(audit.deleteReports).toHaveLength(0)

    const command = await lifecycle.begin({
      ...params,
      unknownFavoriteAcknowledged: true
    })
    expect(command.args.mediaKeysToTrash).toEqual(["trash"])
    expect(command.args.acknowledgedUnknownFavoriteDedupKeys).toEqual([
      "dedup-trash"
    ])
    expect(audit.deleteReports).toHaveLength(1)
  })

  it("rejects malformed Trash identities before dispatching an unknown-favorite target", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const { groups, mediaItems, reviewSession } = fixture()
    mediaItems.trash!.favoriteStatus = "unknown"
    mediaItems.trash!.favoriteSource = "unavailable"
    const plan = {
      ...reviewSession.trashPlan(groups),
      dedupKeys: [""]
    }

    await expect(
      lifecycle.begin({
        plan,
        reviewSession,
        groups,
        snapshot: { mediaItems, groups, totalItems: 2 },
        batchPolicy: {
          batchSize: 25,
          batchPauseMs: 0,
          retryCount: 0,
          retryBackoffMs: 0
        },
        unknownFavoriteAcknowledged: true
      })
    ).rejects.toThrow(/Trash plan identities are inconsistent/)
    expect(audit.deleteReports).toHaveLength(0)
    expect(lifecycle.isPending()).toBe(false)
  })

  it.each([
    ["unequal identity list lengths", ["dedup-trash"], ["trash", "trash-second"]],
    ["empty dedup identity", ["", "dedup-second"], ["trash", "trash-second"]],
    ["empty media identity", ["dedup-trash", "dedup-second"], ["trash", ""]],
    [
      "duplicate dedup identity",
      ["dedup-trash", "dedup-trash"],
      ["trash", "trash-second"]
    ],
    [
      "duplicate media identity",
      ["dedup-trash", "dedup-second"],
      ["trash", "trash"]
    ],
    ["non-string dedup identity", [123, "dedup-second"], ["trash", "trash-second"]],
    ["non-string media identity", ["dedup-trash", "dedup-second"], ["trash", 123]]
  ] as const)("rejects %s before dispatch", async (_, dedupKeys, mediaKeysToTrash) => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const { groups, mediaItems, reviewSession } = fixture()
    const second = { ...mediaItems.trash!, mediaKey: "trash-second", dedupKey: "dedup-second" }
    const empty = { ...mediaItems.trash!, mediaKey: "" }
    const snapshotMediaItems = {
      ...mediaItems,
      "trash-second": second,
      "": empty
    }
    const plan = {
      ...reviewSession.trashPlan(groups),
      dedupKeys: dedupKeys as unknown as string[],
      mediaKeysToTrash: mediaKeysToTrash as unknown as string[],
      unknownFavoriteMediaKeys: []
    }

    await expect(
      lifecycle.begin({
        plan,
        reviewSession,
        groups,
        snapshot: {
          mediaItems: snapshotMediaItems,
          groups,
          totalItems: Object.keys(snapshotMediaItems).length
        },
        batchPolicy: {
          batchSize: 25,
          batchPauseMs: 0,
          retryCount: 0,
          retryBackoffMs: 0
        }
      })
    ).rejects.toThrow(/Trash plan identities are inconsistent/)
    expect(audit.deleteReports).toHaveLength(0)
    expect(lifecycle.isPending()).toBe(false)
  })

  it("accepts valid multi-target plans with distinct provider identities", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const base = fixture()
    const mediaItems = {
      ...base.mediaItems,
      "trash-second": {
        ...base.mediaItems.trash!,
        mediaKey: "trash-second",
        dedupKey: "dedup-trash-second",
        thumb: "trash-second",
        timestamp: 2,
        creationTimestamp: 2
      }
    }
    const groups: DuplicateGroup[] = [
      {
        ...base.groups[0]!,
        mediaKeys: ["keep", "trash", "trash-second"]
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
    const plan = reviewSession.trashPlan(groups)

    expect(plan.mediaKeysToTrash).toEqual(["trash", "trash-second"])
    expect(plan.dedupKeys).toEqual(["dedup-trash", "dedup-trash-second"])
    const command = await lifecycle.begin({
      plan,
      reviewSession,
      groups,
      snapshot: { mediaItems, groups, totalItems: 3 },
      batchPolicy: {
        batchSize: 25,
        batchPauseMs: 0,
        retryCount: 0,
        retryBackoffMs: 0
      }
    })

    expect(command.totalToTrash).toBe(2)
    expect(command.args.mediaKeysToTrash).toEqual(["trash", "trash-second"])
    expect(command.args.dedupKeys).toEqual([
      "dedup-trash",
      "dedup-trash-second"
    ])
  })

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

  it("keeps an identity-free negative mutation result ambiguous", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    await begin(lifecycle)

    const outcome = await lifecycle.reconcile({
      success: false,
      error: "nothing moved"
    })

    expect(outcome).toMatchObject({
      kind: "unknown",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      error: "nothing moved",
      undo: null,
      unknownMediaKeys: ["trash"],
      unknownDedupKeys: ["dedup-trash"]
    })
  })

  it("[PARITY-04] requires provider-confirmed identities for a complete restore", () => {
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
    ).toMatchObject({
      kind: "unknown",
      restoredDedupKeys: [],
      undo: { dedupKeys: [], count: 0 },
      error: expect.stringMatching(/valid identity/i)
    })
  })

  it.each([
    ["a non-array identity response", undefined],
    ["a non-string item identity", ["dedup-a", 17]],
    ["an unrequested identity mixed with a requested one", ["dedup-a", "foreign"]],
    ["a duplicate identity", ["dedup-a", "dedup-a"]]
  ])("rejects %s without acknowledging a restored item", (_label, identities) => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const undo = {
      provider: "google",
      dedupKeys: ["dedup-a", "dedup-b"],
      count: 2,
      snapshot: { mediaItems: {}, groups: [], totalItems: 2 }
    } satisfies TrashUndoData
    lifecycle.beginRestore(undo, "restore-invalid-identities")

    const outcome = lifecycle.reconcileRestore({
      requestId: "restore-invalid-identities",
      success: true,
      restoredDedupKeys: identities
    })

    expect(outcome).toMatchObject({
      kind: "unknown",
      restoredDedupKeys: [],
      undo: { dedupKeys: [], count: 0 },
      error: expect.stringMatching(/valid identity/i)
    })
  })

  it("[PARITY-04] keeps only provider-unrestored keys and aligned iCloud refs for retry", () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const undo = {
      provider: "icloud",
      dedupKeys: ["master-a", "master-b", "master-c"],
      count: 3,
      snapshot: { mediaItems: {}, groups: [], totalItems: 3 },
      icloudAssetRefs: [
        {
          recordName: "asset-a",
          changeTag: "tag-a",
          zoneName: "PrimarySync",
          ownerRecordName: "owner"
        },
        {
          recordName: "asset-b",
          changeTag: "tag-b",
          zoneName: "PrimarySync",
          ownerRecordName: "owner"
        },
        {
          recordName: "asset-c",
          changeTag: "tag-c",
          zoneName: "PrimarySync",
          ownerRecordName: "owner"
        }
      ]
    } satisfies TrashUndoData
    lifecycle.beginRestore(undo, "restore-partial")

    const outcome = lifecycle.reconcileRestore({
      requestId: "restore-partial",
      success: false,
      restoredDedupKeys: ["master-a", "master-b"],
      outcomes: [
        { operation: "restore", targetKey: "master-a", status: "confirmed" },
        { operation: "restore", targetKey: "master-b", status: "confirmed" },
        { operation: "restore", targetKey: "master-c", status: "failed" }
      ],
      error: "third item conflicted"
    })

    expect(outcome).toMatchObject({
      kind: "partial",
      restoredDedupKeys: ["master-a", "master-b"],
      undo: {
        dedupKeys: ["master-c"],
        count: 1,
        icloudAssetRefs: [
          {
            recordName: "asset-c",
            changeTag: "tag-c"
          }
        ]
      },
      error: "third item conflicted"
    })
  })

  it("does not attach iCloud refs to remaining keys when the original ref list is misaligned", () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const undo = {
      provider: "icloud",
      dedupKeys: ["master-a", "master-b"],
      count: 2,
      snapshot: { mediaItems: {}, groups: [], totalItems: 2 },
      providerSessionId: "icloud-page-session-a",
      icloudAssetRefs: [
        {
          recordName: "asset-a",
          changeTag: "tag-a",
          zoneName: "PrimarySync",
          ownerRecordName: "owner"
        }
      ]
    } satisfies TrashUndoData
    lifecycle.beginRestore(undo, "restore-misaligned-refs")

    const outcome = lifecycle.reconcileRestore({
      requestId: "restore-misaligned-refs",
      success: false,
      restoredDedupKeys: ["master-a"],
      outcomes: [
        { operation: "restore", targetKey: "master-a", status: "confirmed" },
        { operation: "restore", targetKey: "master-b", status: "failed" }
      ],
      error: "partial provider restore"
    })

    expect(outcome).toMatchObject({
      kind: "partial",
      restoredDedupKeys: ["master-a"],
      undo: {
        dedupKeys: ["master-b"],
        count: 1,
        providerSessionId: "icloud-page-session-a"
      },
      error: "partial provider restore"
    })
    if (outcome?.kind !== "partial") {
      throw new Error("expected a partial provider restore")
    }
    expect(outcome.undo.icloudAssetRefs).toBeUndefined()
  })

  it("keeps a partial Google restore usable without iCloud refs", () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const undo = {
      provider: "google",
      dedupKeys: ["google-a", "google-b"],
      count: 2,
      snapshot: { mediaItems: {}, groups: [], totalItems: 2 }
    } satisfies TrashUndoData
    lifecycle.beginRestore(undo, "google-partial-restore")

    const outcome = lifecycle.reconcileRestore({
      requestId: "google-partial-restore",
      success: true,
      restoredDedupKeys: ["google-a"],
      outcomes: [
        { operation: "restore", targetKey: "google-a", status: "confirmed" },
        { operation: "restore", targetKey: "google-b", status: "failed" }
      ]
    })

    expect(outcome).toMatchObject({
      kind: "partial",
      restoredDedupKeys: ["google-a"],
      undo: { provider: "google", dedupKeys: ["google-b"], count: 1 }
    })
    if (outcome?.kind !== "partial") {
      throw new Error("expected a partial Google restore")
    }
    expect(outcome.undo.icloudAssetRefs).toBeUndefined()
    expect(
      lifecycle.beginRestore(outcome.undo, "google-partial-retry").args
    ).toEqual({ dedupKeys: ["google-b"] })
  })

  it("rejects a non-string restore identity before mutation dispatch", () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const undo = {
      provider: "google",
      dedupKeys: [17],
      count: 1,
      snapshot: { mediaItems: {}, groups: [], totalItems: 1 }
    } as unknown as TrashUndoData
    expect(() => lifecycle.beginRestore(undo, "malformed-undo-identity")).toThrow(
      /invalid or duplicated/i
    )
  })

  it("does not let a malformed restore response collide with an opaque request identity", () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const undo = {
      provider: "google",
      dedupKeys: ["Stryker was here"],
      count: 1,
      snapshot: { mediaItems: {}, groups: [], totalItems: 1 }
    } satisfies TrashUndoData
    lifecycle.beginRestore(undo, "opaque-restore-identity")

    expect(
      lifecycle.reconcileRestore({
        requestId: "opaque-restore-identity",
        success: true,
        restoredDedupKeys: undefined
      })
    ).toMatchObject({
      kind: "unknown",
      restoredDedupKeys: [],
      undo: { dedupKeys: [], count: 0 },
      error: expect.stringMatching(/valid identity/i)
    })
  })

  it("[PARITY-04] carries provider-refreshed iCloud tags into Undo and recovery audit", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const icloudAsset = (recordName: string, changeTag: string) => ({
      recordName,
      changeTag,
      zoneName: "PrimarySync",
      ownerRecordName: "owner"
    })
    const mediaItems: Record<string, GpdMediaItem> = {
      keep: {
        mediaKey: "keep",
        dedupKey: "master-keep",
        thumb: "keep",
        timestamp: 1,
        creationTimestamp: 1,
        provider: "icloud",
        favoriteStatus: "not-favorite",
        favoriteSource: "provider-metadata",
        icloudAsset: icloudAsset("asset-keep", "old-keep")
      },
      trash: {
        mediaKey: "trash",
        dedupKey: "master-trash",
        thumb: "trash",
        timestamp: 1,
        creationTimestamp: 2,
        provider: "icloud",
        favoriteStatus: "not-favorite",
        favoriteSource: "provider-metadata",
        icloudAsset: icloudAsset("asset-trash", "old-trash")
      }
    }
    const groups: DuplicateGroup[] = [
      {
        id: "icloud-group",
        mediaKeys: ["keep", "trash"],
        originalMediaKey: "keep",
        similarity: 1
      }
    ]
    const reviewSession = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(["icloud-group"]),
        reviewedGroupIds: new Set(["icloud-group"]),
        keptOverrides: { "icloud-group": new Set(["keep"]) }
      }
    })
    const plan = reviewSession.trashPlan(groups)
    await lifecycle.begin({
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

    const freshRef = icloudAsset("asset-trash", "fresh-after-trash")
    const outcome = await lifecycle.reconcile({
      success: true,
      data: {
        trashedKeys: ["trash"],
        trashedDedupKeys: ["master-trash"],
        icloudAssetRefs: [freshRef]
      }
    })

    expect(outcome.kind).toBe("complete")
    expect(outcome.undo?.icloudAssetRefs).toEqual([freshRef])
    expect(audit.resultContexts[0]?.icloudAssetRefs).toEqual([
      icloudAsset("asset-trash", "old-trash")
    ])
    expect(audit.resultContexts[0]?.confirmedIcloudAssetRefs).toEqual([
      freshRef
    ])
  })

  it("preserves confirmed iCloud progress refs through a lost terminal response", async () => {
    const {
      audit,
      lifecycle,
      groups: initialGroups,
      mediaItems: initialItems,
      assetRef
    } = icloudFixture()
    const mediaItems = {
      ...initialItems,
      "trash-second": {
        ...initialItems.trash!,
        mediaKey: "trash-second",
        dedupKey: "dedup-trash-second",
        icloudAsset: assetRef("asset-trash-second", "old-trash-second")
      }
    }
    const groups: DuplicateGroup[] = [
      {
        ...initialGroups[0]!,
        mediaKeys: ["keep", "trash", "trash-second"]
      }
    ]
    const reviewSession = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(["icloud-group"]),
        reviewedGroupIds: new Set(["icloud-group"]),
        keptOverrides: { "icloud-group": new Set(["keep"]) }
      }
    })
    const plan = reviewSession.trashPlan(groups)
    const command = await lifecycle.begin({
      plan,
      reviewSession,
      groups,
      snapshot: { mediaItems, groups, totalItems: 3 },
      requestId: "icloud-progress-timeout",
      batchPolicy: {
        batchSize: 25,
        batchPauseMs: 0,
        retryCount: 0,
        retryBackoffMs: 0
      }
    })
    const freshTrashRef = assetRef("asset-trash", "fresh-trash")
    const freshSecondTrashRef = assetRef(
      "asset-trash-second",
      "fresh-trash-second"
    )

    expect(
      lifecycle.recordProgress({
        requestId: command.requestId,
        data: {
          // The provider reports both identity and ref pairs in reverse plan order.
          trashedKeys: ["trash-second", "trash"],
          trashedDedupKeys: ["dedup-trash-second", "dedup-trash"],
          icloudAssetRefs: [freshSecondTrashRef, freshTrashRef],
          outcomes: [
            {
              operation: "trash",
              targetKey: "dedup-trash-second",
              status: "confirmed"
            },
            {
              operation: "trash",
              targetKey: "dedup-trash",
              status: "confirmed"
            }
          ]
        }
      })
    ).toBe(true)

    const outcome = await lifecycle.timeout({
      requestId: command.requestId,
      error: "provider terminal response lost"
    })

    expect(outcome).toMatchObject({
      kind: "partial",
      movedDedupKeys: ["dedup-trash", "dedup-trash-second"],
      movedMediaKeys: ["trash", "trash-second"],
      unknownDedupKeys: [],
      undo: {
        provider: "icloud",
        dedupKeys: ["dedup-trash", "dedup-trash-second"],
        icloudAssetRefs: [freshTrashRef, freshSecondTrashRef]
      }
    })
    expect(audit.resultContexts[0]?.confirmedIcloudAssetRefs).toEqual([
      freshTrashRef,
      freshSecondTrashRef
    ])
    expect(audit.resultReports[0]).toMatchObject({
      status: "partial",
      movedMediaKeys: ["trash", "trash-second"],
      movedDedupKeys: ["dedup-trash", "dedup-trash-second"],
      error: "provider terminal response lost"
    })
  })

  it("does not bind iCloud progress refs when the optional dedup identity list is malformed", async () => {
    const { audit, lifecycle, groups, mediaItems, reviewSession, assetRef } =
      icloudFixture()
    const targetKey = "Stryker was here"
    mediaItems.trash!.dedupKey = targetKey
    const targetReview = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: reviewSession.selections
    })
    const command = await lifecycle.begin({
      plan: targetReview.trashPlan(groups),
      reviewSession: targetReview,
      groups,
      snapshot: { mediaItems, groups, totalItems: 2 },
      requestId: "icloud-malformed-progress-identities",
      batchPolicy: {
        batchSize: 25,
        batchPauseMs: 0,
        retryCount: 0,
        retryBackoffMs: 0
      }
    })
    const freshRef = assetRef("asset-trash", "fresh-after-trash")

    expect(lifecycle.recordProgress({
      requestId: command.requestId,
      data: {
        trashedDedupKeys: "not-an-identity-array" as never,
        icloudAssetRefs: [freshRef],
        outcomes: [
          { operation: "trash", targetKey, status: "confirmed" }
        ]
      }
    })).toBe(true)

    const outcome = await lifecycle.timeout({ requestId: command.requestId })

    expect(outcome).toMatchObject({
      kind: "partial",
      movedDedupKeys: [targetKey],
      undo: { dedupKeys: [targetKey] }
    })
    if (outcome.kind !== "partial") {
      throw new Error("expected retained confirmed Trash progress")
    }
    expect(outcome.undo.icloudAssetRefs).toBeUndefined()
    expect(audit.resultContexts[0]?.confirmedIcloudAssetRefs).toBeUndefined()
  })

  it("rejects incomplete fresh iCloud refs when multiple Trash targets are confirmed", async () => {
    const {
      audit,
      lifecycle,
      groups: initialGroups,
      mediaItems: initialItems,
      assetRef
    } = icloudFixture()
    const mediaItems = {
      ...initialItems,
      "trash-second": {
        ...initialItems.trash!,
        mediaKey: "trash-second",
        dedupKey: "dedup-trash-second",
        icloudAsset: assetRef("asset-trash-second", "old-trash-second")
      }
    }
    const groups: DuplicateGroup[] = [
      { ...initialGroups[0]!, mediaKeys: ["keep", "trash", "trash-second"] }
    ]
    const reviewSession = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(["icloud-group"]),
        reviewedGroupIds: new Set(["icloud-group"]),
        keptOverrides: { "icloud-group": new Set(["keep"]) }
      }
    })
    const command = await lifecycle.begin({
      plan: reviewSession.trashPlan(groups),
      reviewSession,
      groups,
      snapshot: { mediaItems, groups, totalItems: 3 },
      batchPolicy: {
        batchSize: 25,
        batchPauseMs: 0,
        retryCount: 0,
        retryBackoffMs: 0
      }
    })
    const freshRef = assetRef("asset-trash", "fresh-trash")
    const outcome = await lifecycle.reconcile({
      requestId: command.requestId,
      success: true,
      data: {
        outcomes: [
          { operation: "trash", targetKey: "dedup-trash", status: "confirmed" },
          { operation: "trash", targetKey: "dedup-trash-second", status: "confirmed" }
        ],
        trashedDedupKeys: ["dedup-trash"],
        icloudAssetRefs: [freshRef]
      }
    })

    expect(outcome).toMatchObject({
      kind: "complete",
      undo: {
        dedupKeys: ["dedup-trash", "dedup-trash-second"]
      }
    })
    if (outcome.kind !== "complete") throw new Error("expected complete Trash")
    expect(outcome.undo.icloudAssetRefs).toBeUndefined()
    expect(audit.resultContexts[0]?.confirmedIcloudAssetRefs).toBeUndefined()
  })

  it("[PARITY-02] carries the iCloud page session through Trash, Undo, and restore", async () => {
    const { audit, lifecycle, groups, mediaItems, reviewSession, plan, assetRef } =
      icloudFixture()
    const command = await lifecycle.begin({
      plan,
      reviewSession,
      groups,
      snapshot: { mediaItems, groups, totalItems: 2 },
      accountEmail: "owner@example.com",
      providerSessionId: "icloud-page-session-a",
      scopeFingerprint: "scope-a",
      scopeLabel: "Personal album: Summer",
      requestId: "icloud-trash-request",
      batchPolicy: {
        batchSize: 25,
        batchPauseMs: 0,
        retryCount: 0,
        retryBackoffMs: 0
      }
    })

    expect(command.args.providerSessionId).toBe("icloud-page-session-a")
    expect(command.args.accountEmail).toBe("owner@example.com")
    expect(command.args.icloudAssetRefs).toEqual([
      assetRef("asset-trash", "old-trash")
    ])
    expect(audit.deleteContexts[0]).toMatchObject({
      provider: "icloud",
      accountEmail: "owner@example.com",
      providerSessionId: "icloud-page-session-a",
      scopeFingerprint: "scope-a",
      scopeLabel: "Personal album: Summer"
    })

    const freshRef = assetRef("asset-trash", "fresh-after-trash")
    const outcome = await lifecycle.reconcile({
      requestId: command.requestId,
      success: true,
      data: {
        trashedKeys: ["trash"],
        trashedDedupKeys: ["dedup-trash"],
        icloudAssetRefs: [freshRef]
      }
    })
    if (outcome.kind !== "complete") {
      throw new Error("expected a complete iCloud trash outcome")
    }
    expect(outcome.undo).toMatchObject({
      provider: "icloud",
      accountEmail: "owner@example.com",
      providerSessionId: "icloud-page-session-a",
      scopeFingerprint: "scope-a",
      scopeLabel: "Personal album: Summer",
      icloudAssetRefs: [freshRef]
    })

    const restore = lifecycle.beginRestore(outcome.undo, "icloud-restore")
    expect(restore.args).toMatchObject({
      dedupKeys: ["dedup-trash"],
      accountEmail: "owner@example.com",
      providerSessionId: "icloud-page-session-a",
      icloudAssetRefs: [freshRef]
    })

    const google = fixture()
    const googleAudit = inMemoryAudit()
    const googleLifecycle = new TrashLifecycle(googleAudit.adapter)
    const googleCommand = await googleLifecycle.begin({
      plan: google.reviewSession.trashPlan(google.groups),
      reviewSession: google.reviewSession,
      groups: google.groups,
      snapshot: {
        mediaItems: google.mediaItems,
        groups: google.groups,
        totalItems: 2
      },
      providerSessionId: "must-not-bind-google",
      batchPolicy: {
        batchSize: 25,
        batchPauseMs: 0,
        retryCount: 0,
        retryBackoffMs: 0
      }
    })
    expect(googleCommand.args.providerSessionId).toBe("must-not-bind-google")
    expect(googleAudit.deleteContexts[0]?.providerSessionId).toBe(
      "must-not-bind-google"
    )
  })

  it.each([
    ["no iCloud references", undefined],
    ["an incomplete reference list", []],
    [
      "a null reference",
      [null as unknown as IcloudAssetRef]
    ],
    [
      "a reference without a record name",
      [
        {
          recordName: undefined,
          changeTag: "fresh",
          zoneName: "PrimarySync",
          ownerRecordName: "owner"
        } as unknown as IcloudAssetRef
      ]
    ],
    [
      "a reference without a change tag",
      [
        {
          recordName: "asset-trash",
          changeTag: undefined,
          zoneName: "PrimarySync",
          ownerRecordName: "owner"
        } as unknown as IcloudAssetRef
      ]
    ],
    [
      "a reference without a zone name",
      [
        {
          recordName: "asset-trash",
          changeTag: "fresh",
          zoneName: undefined,
          ownerRecordName: "owner"
        } as unknown as IcloudAssetRef
      ]
    ],
    [
      "a reference without an owner record name",
      [
        {
          recordName: "asset-trash",
          changeTag: "fresh",
          zoneName: "PrimarySync",
          ownerRecordName: undefined
        } as unknown as IcloudAssetRef
      ]
    ],
    [
      "an extra reference",
      [
        {
          recordName: "asset-trash",
          changeTag: "fresh",
          zoneName: "PrimarySync",
          ownerRecordName: "owner"
        },
        {
          recordName: "asset-extra",
          changeTag: "fresh-extra",
          zoneName: "PrimarySync",
          ownerRecordName: "owner"
        }
      ]
    ]
  ])("does not attach %s to an iCloud Undo record", async (_label, refs) => {
    const { audit, lifecycle, groups, mediaItems, reviewSession, plan } =
      icloudFixture()
    const command = await lifecycle.begin({
      plan,
      reviewSession,
      groups,
      snapshot: { mediaItems, groups, totalItems: 2 },
      requestId: "icloud-invalid-ref-trash",
      batchPolicy: {
        batchSize: 25,
        batchPauseMs: 0,
        retryCount: 0,
        retryBackoffMs: 0
      }
    })
    const outcome = await lifecycle.reconcile({
      requestId: command.requestId,
      success: true,
      data: {
        trashedKeys: ["trash"],
        trashedDedupKeys: ["dedup-trash"],
        ...(refs === undefined
          ? {}
          : { icloudAssetRefs: refs as IcloudAssetRef[] })
      }
    })

    expect(outcome.kind).toBe("complete")
    if (outcome.kind !== "complete") {
      throw new Error("expected confirmed Trash with incomplete restore refs")
    }
    expect(outcome.undo?.icloudAssetRefs).toBeUndefined()
    expect(audit.resultContexts[0]?.confirmedIcloudAssetRefs).toBeUndefined()
  })

  it("rejects duplicate iCloud result identities when binding fresh restore refs", async () => {
    const { audit, lifecycle, groups, mediaItems, reviewSession, plan, assetRef } =
      icloudFixture()
    const command = await lifecycle.begin({
      plan,
      reviewSession,
      groups,
      snapshot: { mediaItems, groups, totalItems: 2 },
      requestId: "icloud-duplicate-ref-trash",
      batchPolicy: {
        batchSize: 25,
        batchPauseMs: 0,
        retryCount: 0,
        retryBackoffMs: 0
      }
    })
    const freshRef = assetRef("asset-trash", "fresh-after-trash")
    const outcome = await lifecycle.reconcile({
      requestId: command.requestId,
      success: true,
      data: {
        trashedKeys: ["trash"],
        trashedDedupKeys: ["dedup-trash", "dedup-trash"],
        icloudAssetRefs: [freshRef, freshRef]
      }
    })

    expect(outcome.kind).toBe("complete")
    if (outcome.kind !== "complete") {
      throw new Error("expected the confirmed Trash identity to remain complete")
    }
    expect(outcome.undo?.dedupKeys).toEqual(["dedup-trash"])
    expect(outcome.undo?.icloudAssetRefs).toBeUndefined()
    expect(audit.resultContexts[0]?.confirmedIcloudAssetRefs).toBeUndefined()
  })

  it("does not attach iCloud refs when no requested identity was confirmed", async () => {
    const { audit, lifecycle, groups, mediaItems, reviewSession, plan, assetRef } =
      icloudFixture()
    const command = await lifecycle.begin({
      plan,
      reviewSession,
      groups,
      snapshot: { mediaItems, groups, totalItems: 2 },
      requestId: "icloud-no-confirmed-trash",
      batchPolicy: {
        batchSize: 25,
        batchPauseMs: 0,
        retryCount: 0,
        retryBackoffMs: 0
      }
    })

    const outcome = await lifecycle.reconcile({
      requestId: command.requestId,
      success: true,
      data: {
        trashedKeys: ["foreign-media"],
        trashedDedupKeys: ["dedup-trash"],
        icloudAssetRefs: [assetRef("asset-trash", "fresh-after-trash")]
      }
    })

    expect(outcome).toMatchObject({
      kind: "unknown",
      movedCount: 0,
      undo: null,
      unknownDedupKeys: ["dedup-trash"]
    })
    expect(audit.resultContexts[0]?.confirmedIcloudAssetRefs).toBeUndefined()
    expect(
      Object.hasOwn(audit.resultContexts[0] ?? {}, "confirmedIcloudAssetRefs")
    ).toBe(false)
  })

  it("does not bind iCloud refs when the confirmed media identity has no returned dedup identity", async () => {
    const { audit, lifecycle, groups, mediaItems, reviewSession, plan } =
      icloudFixture()
    const command = await lifecycle.begin({
      plan,
      reviewSession,
      groups,
      snapshot: { mediaItems, groups, totalItems: 2 },
      requestId: "icloud-media-only-trash",
      batchPolicy: {
        batchSize: 25,
        batchPauseMs: 0,
        retryCount: 0,
        retryBackoffMs: 0
      }
    })

    const outcome = await lifecycle.reconcile({
      requestId: command.requestId,
      success: true,
      data: { trashedKeys: ["trash"], icloudAssetRefs: [] }
    })

    expect(outcome.kind).toBe("complete")
    if (outcome.kind !== "complete") {
      throw new Error("expected the provider-confirmed media identity")
    }
    expect(outcome.undo?.icloudAssetRefs).toBeUndefined()
    expect(audit.resultContexts[0]?.confirmedIcloudAssetRefs).toBeUndefined()
  })

  it("[PARITY-04] completes restore only when the confirmed identity set is exact", () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const undo = {
      provider: "google",
      dedupKeys: ["dedup-a", "dedup-b"],
      count: 2,
      snapshot: { mediaItems: {}, groups: [], totalItems: 2 }
    } satisfies TrashUndoData
    lifecycle.beginRestore(undo, "restore-complete")

    expect(
      lifecycle.reconcileRestore({
        requestId: "restore-complete",
        success: true,
        restoredDedupKeys: ["dedup-b", "dedup-a"]
      })
    ).toMatchObject({
      kind: "complete",
      restoredDedupKeys: ["dedup-a", "dedup-b"]
    })
  })

  it("keeps confirmed and failed restore progress, but classifies an absent remainder as unknown on timeout", () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const undo = {
      provider: "google",
      dedupKeys: ["restore-a", "restore-b", "restore-c"],
      count: 3,
      snapshot: { mediaItems: {}, groups: [], totalItems: 3 }
    } satisfies TrashUndoData
    lifecycle.beginRestore(undo, "restore-progress-timeout")

    expect(
      lifecycle.recordRestoreProgress({
        requestId: "restore-progress-timeout",
        outcomes: [
          { operation: "restore", targetKey: "restore-a", status: "confirmed" },
          { operation: "restore", targetKey: "restore-b", status: "failed" }
        ]
      })
    ).toBe(true)
    const timeout = lifecycle.timeoutRestore({
      requestId: "restore-progress-timeout"
    })

    expect(timeout).toMatchObject({
      kind: "partial",
      restoredDedupKeys: ["restore-a"],
      undo: { dedupKeys: ["restore-b"], count: 1 },
      failedDedupKeys: ["restore-b"],
      unknownDedupKeys: ["restore-c"],
      notDispatchedDedupKeys: [],
      outcomes: [
        { targetKey: "restore-a", status: "confirmed" },
        { targetKey: "restore-b", status: "failed" },
        { targetKey: "restore-c", status: "unknown" }
      ]
    })
    expect(lifecycle.isPending("restore-progress-timeout")).toBe(true)
  })

  it("records the default restore timeout and per-target no-progress reason", () => {
    const lifecycle = new TrashLifecycle(inMemoryAudit().adapter)
    const requestId = "restore-default-timeout-reason"
    lifecycle.beginRestore(
      {
        provider: "google",
        dedupKeys: ["d-a"],
        count: 1,
        snapshot: { mediaItems: {}, groups: [], totalItems: 1 }
      },
      requestId
    )

    expect(lifecycle.timeoutRestore({ requestId })).toMatchObject({
      kind: "unknown",
      error: "The provider restore request timed out.",
      unknownDedupKeys: ["d-a"],
      outcomes: [
        {
          operation: "restore",
          targetKey: "d-a",
          status: "unknown",
          reason: "timeout-without-target-outcome"
        }
      ]
    })
  })

  it("does not treat an opaque restore target equal to fixture text as not dispatched on timeout", () => {
    const sentinel = "Stryker was here"
    const lifecycle = new TrashLifecycle(inMemoryAudit().adapter)
    const requestId = "opaque-restore-timeout"
    lifecycle.beginRestore({
      provider: "google",
      dedupKeys: [sentinel],
      count: 1,
      snapshot: { mediaItems: {}, groups: [], totalItems: 1 }
    }, requestId)

    expect(lifecycle.timeoutRestore({ requestId })).toMatchObject({
      kind: "unknown",
      unknownDedupKeys: [sentinel],
      notDispatchedDedupKeys: [],
      outcomes: [
        {
          operation: "restore",
          targetKey: sentinel,
          status: "unknown",
          reason: "timeout-without-target-outcome"
        }
      ]
    })
  })

  it("matches restore pending status to the active request ID", () => {
    const lifecycle = new TrashLifecycle(inMemoryAudit().adapter)
    const requestId = "restore-pending-scope"
    lifecycle.beginRestore(
      {
        provider: "google",
        dedupKeys: ["restore-a"],
        count: 1,
        snapshot: { mediaItems: {}, groups: [], totalItems: 1 }
      },
      requestId
    )

    expect(lifecycle.isPending()).toBe(true)
    expect(lifecycle.isPending(requestId)).toBe(true)
    expect(lifecycle.isPending("another-restore-request")).toBe(false)
    expect(lifecycle.isPending(requestId)).toBe(true)
  })

  it("lets an exact same-request terminal resolve provisional unknown restore progress", () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const undo = {
      provider: "google",
      dedupKeys: ["restore-a", "restore-b", "restore-c"],
      count: 3,
      snapshot: { mediaItems: {}, groups: [], totalItems: 3 }
    } satisfies TrashUndoData
    const requestId = "restore-late-terminal"
    lifecycle.beginRestore(undo, requestId)
    lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [
        { operation: "restore", targetKey: "restore-a", status: "confirmed" },
        {
          operation: "restore",
          targetKey: "restore-b",
          status: "unknown",
          reason: "provider still processing"
        }
      ]
    })

    expect(lifecycle.timeoutRestore({ requestId })).toMatchObject({
      kind: "partial",
      restoredDedupKeys: ["restore-a"],
      unknownDedupKeys: ["restore-b", "restore-c"]
    })
    expect(lifecycle.isPending(requestId)).toBe(true)

    const lateTerminal = lifecycle.reconcileRestore({
      requestId,
      success: true,
      outcomes: undo.dedupKeys.map((targetKey) => ({
        operation: "restore" as const,
        targetKey,
        status: "confirmed" as const
      }))
    })

    expect(lateTerminal).toMatchObject({
      kind: "complete",
      restoredDedupKeys: undo.dedupKeys,
      outcomes: undo.dedupKeys.map((targetKey) => ({
        operation: "restore",
        targetKey,
        status: "confirmed"
      }))
    })
    expect(lateTerminal?.outcomes).toEqual(
      undo.dedupKeys.map((targetKey) => ({
        operation: "restore",
        targetKey,
        status: "confirmed"
      }))
    )
    expect(lifecycle.isPending()).toBe(false)
  })

  it("resolves legacy progress unknowns only when the same terminal lists every requested target", () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const undo = {
      provider: "google",
      dedupKeys: ["restore-a", "restore-b"],
      count: 2,
      snapshot: { mediaItems: {}, groups: [], totalItems: 2 }
    } satisfies TrashUndoData
    const requestId = "restore-legacy-complete-result"
    lifecycle.beginRestore(undo, requestId)
    lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [
        {
          operation: "restore",
          targetKey: "restore-a",
          status: "unknown",
          reason: "provider still processing"
        }
      ]
    })

    const result = lifecycle.reconcileRestore({
      requestId,
      success: true,
      restoredDedupKeys: undo.dedupKeys
    })
    expect(result).toMatchObject({
      kind: "complete",
      restoredDedupKeys: undo.dedupKeys,
      outcomes: undo.dedupKeys.map((targetKey) => ({
        operation: "restore",
        targetKey,
        status: "confirmed"
      }))
    })
    expect(result?.outcomes).toEqual(
      undo.dedupKeys.map((targetKey) => ({
        operation: "restore",
        targetKey,
        status: "confirmed"
      }))
    )
  })

  it("keeps provisional unknown restore progress when a legacy terminal confirms only a subset", () => {
    const lifecycle = new TrashLifecycle(inMemoryAudit().adapter)
    const undo = {
      provider: "google",
      dedupKeys: ["restore-a", "restore-b"],
      count: 2,
      snapshot: { mediaItems: {}, groups: [], totalItems: 2 }
    } satisfies TrashUndoData
    const requestId = "restore-legacy-partial-result"
    lifecycle.beginRestore(undo, requestId)
    lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [
        {
          operation: "restore",
          targetKey: "restore-a",
          status: "unknown",
          reason: "provider still processing"
        }
      ]
    })

    const result = lifecycle.reconcileRestore({
      requestId,
      success: true,
      restoredDedupKeys: ["restore-a"]
    })

    expect(result).toMatchObject({
      kind: "unknown",
      restoredDedupKeys: [],
      unknownDedupKeys: ["restore-a", "restore-b"],
      outcomes: [
        { targetKey: "restore-a", status: "unknown" },
        { targetKey: "restore-b", status: "unknown" }
      ]
    })
    expect(result?.outcomes).toEqual([
      {
        operation: "restore",
        targetKey: "restore-a",
        status: "unknown",
        reason: "provider still processing"
      },
      {
        operation: "restore",
        targetKey: "restore-b",
        status: "unknown"
      }
    ])
    expect(Object.hasOwn(result?.outcomes?.[1] ?? {}, "reason")).toBe(false)
  })

  it("preserves confirmed restore progress against a contradictory same-request terminal", () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const undo = {
      provider: "google",
      dedupKeys: ["restore-a", "restore-b"],
      count: 2,
      snapshot: { mediaItems: {}, groups: [], totalItems: 2 }
    } satisfies TrashUndoData
    const requestId = "restore-confirmed-progress"
    lifecycle.beginRestore(undo, requestId)
    lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [
        { operation: "restore", targetKey: "restore-a", status: "confirmed" }
      ]
    })

    const terminal = lifecycle.reconcileRestore({
      requestId,
      success: true,
      outcomes: [
        { operation: "restore", targetKey: "restore-a", status: "failed" },
        { operation: "restore", targetKey: "restore-b", status: "confirmed" }
      ]
    })

    expect(terminal).toMatchObject({
      kind: "complete",
      restoredDedupKeys: ["restore-a", "restore-b"],
      outcomes: [
        { targetKey: "restore-a", status: "confirmed" },
        { targetKey: "restore-b", status: "confirmed" }
      ]
    })
  })

  it("does not acknowledge terminal confirmations when the not-dispatched subset is malformed", () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const undo = {
      provider: "icloud",
      dedupKeys: ["restore-a", "restore-b", "restore-c"],
      count: 3,
      snapshot: { mediaItems: {}, groups: [], totalItems: 3 }
    } satisfies TrashUndoData
    lifecycle.beginRestore(undo, "restore-malformed-subset")

    const outcome = lifecycle.reconcileRestore({
      requestId: "restore-malformed-subset",
      success: false,
      outcomes: [
        { operation: "restore", targetKey: "restore-a", status: "confirmed" },
        { operation: "restore", targetKey: "restore-b", status: "failed" },
        { operation: "restore", targetKey: "restore-c", status: "failed" }
      ],
      notDispatchedDedupKeys: ["restore-c", "foreign"]
    })

    expect(outcome).toMatchObject({
      kind: "unknown",
      restoredDedupKeys: [],
      undo: { dedupKeys: [], count: 0 },
      notDispatchedDedupKeys: [],
      unknownDedupKeys: ["restore-a", "restore-b", "restore-c"],
      outcomes: [
        { targetKey: "restore-a", status: "unknown" },
        { targetKey: "restore-b", status: "unknown" },
        { targetKey: "restore-c", status: "unknown" }
      ]
    })
  })

  it("does not infer that every requested item moved when a success omits identities", async () => {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    await begin(lifecycle)

    const outcome = await lifecycle.reconcile({ success: true, data: {} })

    expect(outcome).toMatchObject({
      kind: "unknown",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      undo: null
    })
    if (outcome.kind !== "unknown") throw new Error("expected unknown outcome")
    expect(outcome.error).toContain("did not confirm")
    expect(audit.resultReports[0]).toMatchObject({
      status: "unknown",
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

    expect(outcome.kind).toBe("unknown")
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
      kind: "unknown",
      error: "provider timeout"
    })
    expect(lifecycle.isPending(command.requestId)).toBe(true)
    expect(audit.resultReports[0]).toMatchObject({
      status: "unknown",
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

    await expect(lifecycle.timeout({ requestId: command.requestId })).resolves.toMatchObject({
      kind: "unknown",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      error:
        "Trash provider did not respond before the safety timeout. Do not retry until the result is reconciled.",
      undo: null,
      unknownDedupKeys: ["dedup-trash"]
    })
    expect(lifecycle.isPending(command.requestId)).toBe(true)
    expect(audit.resultReports[0]).toMatchObject({
      status: "unknown",
      movedMediaKeys: [],
      movedDedupKeys: [],
      error:
        "Trash provider did not respond before the safety timeout. Do not retry until the result is reconciled."
    })
    expect(audit.resultReports[0]?.outcomes).toEqual([
      {
        operation: "trash",
        targetKey: "dedup-trash",
        status: "unknown",
        reason: "provider-timeout-before-target-outcome"
      }
    ])

    await expect(
      lifecycle.timeout({ requestId: command.requestId })
    ).resolves.toMatchObject({
      kind: "unknown",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      error: "Trash request is already awaiting provider reconciliation.",
      undo: null,
      unknownDedupKeys: ["dedup-trash"]
    })
    expect(audit.resultReports).toHaveLength(1)
  })

  it("does not treat timeout fixture text as moved media identities", async () => {
    const sentinel = "Stryker was here"
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const { groups, mediaItems } = fixture()
    const trashItem = mediaItems.trash!
    delete mediaItems.trash
    mediaItems[sentinel] = {
      ...trashItem,
      mediaKey: sentinel,
      dedupKey: sentinel
    }
    groups[0]!.mediaKeys[1] = sentinel
    const reviewSession = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set([groups[0]!.id]),
        reviewedGroupIds: new Set([groups[0]!.id]),
        keptOverrides: { [groups[0]!.id]: new Set(["keep"]) }
      }
    })
    const command = await lifecycle.begin({
      plan: reviewSession.trashPlan(groups),
      reviewSession,
      groups,
      snapshot: { mediaItems, groups, totalItems: 2 },
      batchPolicy: {
        batchSize: 25,
        batchPauseMs: 0,
        retryCount: 0,
        retryBackoffMs: 0
      }
    })

    await lifecycle.timeout({ requestId: command.requestId })

    expect(audit.resultReports[0]?.movedMediaKeys).toEqual([])
    expect(audit.resultReports[0]?.movedDedupKeys).toEqual([])
    expect(audit.resultReports[0]?.movedCount).toBe(0)
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

// Recovery tests exercise provider messages at the public lifecycle boundary.
// Missing and contradictory target facts must never turn into retry permission.
describe("TrashLifecycle — target outcomes and durable recovery", () => {
  async function setupTrash(keys = ["a", "b", "c", "d"]) {
    const audit = inMemoryAudit()
    const lifecycle = new TrashLifecycle(audit.adapter)
    const mediaItems = { keep: fixture().mediaItems.keep! } as Record<string, GpdMediaItem>
    for (const key of keys) {
      mediaItems[key] = { ...fixture().mediaItems.trash!, mediaKey: key, dedupKey: `d-${key}` }
    }
    const groups: DuplicateGroup[] = [{
      id: "recovery", mediaKeys: ["keep", ...keys], originalMediaKey: "keep", similarity: 1
    }]
    const reviewSession = new DuplicateReviewSession({
      mediaItems, groups, selections: {
        selectedGroupIds: new Set(["recovery"]), reviewedGroupIds: new Set(["recovery"]),
        keptOverrides: { recovery: new Set(["keep"]) }
      }
    })
    const command = await lifecycle.begin({
      plan: reviewSession.trashPlan(groups), reviewSession, groups,
      snapshot: { mediaItems, groups, totalItems: keys.length + 1 },
      batchPolicy: { batchSize: 25, batchPauseMs: 1000, retryCount: 2, retryBackoffMs: 1000 }
    })
    return { lifecycle, audit, requestId: command.requestId }
  }

  function setupRestore(keys = ["d-a", "d-b", "d-c"]) {
    const lifecycle = new TrashLifecycle(inMemoryAudit().adapter)
    const undo: TrashUndoData = {
      provider: "google", dedupKeys: keys, count: keys.length,
      snapshot: { mediaItems: {}, groups: [], totalItems: keys.length }
    }
    lifecycle.beginRestore(undo, "restore-boundary")
    return { lifecycle, undo, requestId: "restore-boundary" }
  }

  const fact = (operation: "trash" | "restore", targetKey: string, status: "confirmed" | "failed" | "unknown") =>
    ({ operation, targetKey, status })

  it("partitions an out-of-order terminal into moved, failed, unknown and never-dispatched identities", async () => {
    const { lifecycle, audit, requestId } = await setupTrash()
    const result = await lifecycle.reconcile({ requestId, success: false, error: "interrupted", data: {
      outcomes: [fact("trash", "d-d", "failed"), fact("trash", "d-c", "unknown"),
        fact("trash", "d-b", "failed"), fact("trash", "d-a", "confirmed")],
      notDispatchedDedupKeys: ["d-d"], retryAttempts: 2
    } })
    expect(result).toMatchObject({ kind: "partial", movedMediaKeys: ["a"], movedDedupKeys: ["d-a"],
      failedMediaKeys: ["b"], failedDedupKeys: ["d-b"], unknownMediaKeys: ["c"], unknownDedupKeys: ["d-c"],
      notDispatchedMediaKeys: ["d"], notDispatchedDedupKeys: ["d-d"], undo: { dedupKeys: ["d-a"], count: 1 } })
    expect(audit.resultReports[0]).toMatchObject({ movedCount: 1, failedCount: 1, unknownCount: 1,
      notDispatchedCount: 1, retryAttempts: 2, attemptedDedupKeys: ["d-a", "d-b", "d-c", "d-d"] })
  })

  it("drops provider reasons when duplicate terminal identities make a Trash target ambiguous", async () => {
    const { lifecycle, audit, requestId } = await setupTrash(["a"])

    await lifecycle.reconcile({
      requestId,
      success: false,
      data: {
        outcomes: [
          { ...fact("trash", "d-a", "confirmed"), reason: "first result" },
          { ...fact("trash", "d-a", "failed"), reason: "conflicting result" }
        ]
      }
    })

    expect(audit.resultReports[0]?.outcomes).toEqual([
      fact("trash", "d-a", "unknown")
    ])
  })

  it("explains an unconfirmed legacy Trash target in its normalized outcome", async () => {
    const { lifecycle, audit, requestId } = await setupTrash(["a"])

    await lifecycle.reconcile({ requestId, success: false, data: {} })

    expect(audit.resultReports[0]?.outcomes).toEqual([
      {
        ...fact("trash", "d-a", "unknown"),
        reason: "legacy-response-did-not-confirm-target"
      }
    ])
  })

  it("keeps dry-run terminal identities out of moved result and audit payloads", async () => {
    const { lifecycle, audit, requestId } = await setupTrash(["a"])

    const result = await lifecycle.reconcile({
      requestId,
      success: true,
      data: {
        dryRun: true,
        requestedCount: 1,
        trashedKeys: ["a"],
        trashedDedupKeys: ["d-a"],
        outcomes: [fact("trash", "d-a", "confirmed")]
      }
    })

    expect(result).toMatchObject({
      kind: "dry_run",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      undo: null
    })
    expect(audit.resultReports[0]).toMatchObject({
      status: "not_dispatched",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      notDispatchedDedupKeys: ["d-a"],
      error: null,
      outcomes: [
        {
          ...fact("trash", "d-a", "failed"),
          reason: "dry-run-no-mutation"
        }
      ]
    })
  })

  it("records duplicate response identities as an audit error for dry runs", async () => {
    const { lifecycle, audit, requestId } = await setupTrash(["a"])

    const result = await lifecycle.reconcile({
      requestId,
      success: true,
      data: {
        dryRun: true,
        outcomes: [
          fact("trash", "d-a", "confirmed"),
          fact("trash", "d-a", "failed")
        ]
      }
    })

    expect(result.kind).toBe("dry_run")
    expect(audit.resultReports[0]).toMatchObject({
      status: "not_dispatched",
      error: "Trash provider response included identities outside the confirmed request.",
      movedDedupKeys: [],
      outcomes: [
        { ...fact("trash", "d-a", "failed"), reason: "dry-run-no-mutation" }
      ]
    })
  })

  it("keeps failed dry-run confirmations out of moved results and retains malformed audit errors", async () => {
    const { lifecycle, audit, requestId } = await setupTrash(["a"])

    const result = await lifecycle.reconcile({
      requestId,
      success: false,
      error: "provider reported failure",
      data: {
        dryRun: true,
        outcomes: [
          fact("trash", "d-a", "confirmed"),
          fact("trash", "foreign-dedup-key", "confirmed")
        ]
      }
    })

    expect(result).toEqual({
      kind: "failed",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      error: "provider reported failure",
      undo: null
    })
    expect(audit.resultReports[0]).toMatchObject({
      status: "not_dispatched",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      notDispatchedDedupKeys: ["d-a"],
      error: "Trash provider response included identities outside the confirmed request.",
      outcomes: [
        {
          ...fact("trash", "d-a", "failed"),
          reason: "dry-run-no-mutation"
        }
      ]
    })
  })

  it("preserves provider failure error precedence for malformed non-dry-run responses", async () => {
    const { lifecycle, audit, requestId } = await setupTrash(["a"])

    const result = await lifecycle.reconcile({
      requestId,
      success: false,
      error: "provider reported failure",
      data: {
        outcomes: [
          fact("trash", "d-a", "confirmed"),
          fact("trash", "foreign-dedup-key", "confirmed")
        ]
      }
    })

    expect(result.kind).toBe("partial")
    if (result.kind !== "partial") {
      throw new Error(`Expected a partial result, received ${result.kind}`)
    }
    expect(result.message).toContain("provider reported failure")
    expect(audit.resultReports[0]?.error).toBe("provider reported failure")
  })

  it("does not attach refreshed iCloud tags from a dry-run terminal", async () => {
    const fixture = icloudFixture()
    fixture.mediaItems.trash!.dedupKey = "Stryker was here"
    const plan = fixture.reviewSession.trashPlan(fixture.groups)
    const command = await fixture.lifecycle.begin({
      plan,
      reviewSession: fixture.reviewSession,
      groups: fixture.groups,
      snapshot: {
        mediaItems: fixture.mediaItems,
        groups: fixture.groups,
        totalItems: 2
      },
      batchPolicy: {
        batchSize: 25,
        batchPauseMs: 1000,
        retryCount: 2,
        retryBackoffMs: 1000
      }
    })

    await fixture.lifecycle.reconcile({
      requestId: command.requestId,
      success: true,
      data: {
        dryRun: true,
        requestedCount: 1,
        trashedKeys: ["trash"],
        trashedDedupKeys: ["Stryker was here"],
        outcomes: [fact("trash", "Stryker was here", "confirmed")],
        icloudAssetRefs: [fixture.assetRef("asset-trash", "dry-run-tag")]
      }
    })

    expect(fixture.audit.resultContexts[0]?.confirmedIcloudAssetRefs).toBeUndefined()
  })

  it.each(["confirmed", "failed", "unknown"] as const)("records a single explicit %s target without inventing any other disposition", async (status) => {
    const { lifecycle, audit, requestId } = await setupTrash(["a"])
    const result = await lifecycle.reconcile({ requestId, success: status === "confirmed", data: {
      outcomes: [{ ...fact("trash", "d-a", status), reason: "provider detail" }]
    } })
    expect(result.kind).toBe(status === "confirmed" ? "complete" : status)
    expect(result.movedDedupKeys).toEqual(status === "confirmed" ? ["d-a"] : [])
    expect(audit.resultReports[0]?.outcomes).toEqual([{ ...fact("trash", "d-a", status), reason: "provider detail" }])
    expect(result.undo?.dedupKeys ?? []).toEqual(status === "confirmed" ? ["d-a"] : [])
  })

  it.each([null, "bad", {}, { operation: "restore", targetKey: "d-a", status: "confirmed" },
    { operation: "trash", targetKey: 1, status: "confirmed" },
    { operation: "trash", targetKey: "foreign", status: "confirmed" },
    { operation: "trash", targetKey: "d-a", status: "done" }])("never confirms a malformed terminal target %#", async (candidate) => {
    const { lifecycle, requestId } = await setupTrash(["a"])
    const result = await lifecycle.reconcile({ requestId, success: true, data: { outcomes: [candidate] } })
    expect(result).toMatchObject({ kind: "unknown", movedDedupKeys: [], unknownDedupKeys: ["d-a"],
      notDispatchedDedupKeys: [], undo: null })
  })

  it.each([
    null,
    fact("restore", "d-a", "confirmed"),
    fact("trash", "foreign", "confirmed")
  ])("does not fully confirm a valid trash fact alongside malformed or foreign data: %#", async (extraFact) => {
    const { lifecycle, requestId } = await setupTrash(["a"])
    const result = await lifecycle.reconcile({
      requestId,
      success: true,
      data: { outcomes: [fact("trash", "d-a", "confirmed"), extraFact] }
    })

    expect(result).toMatchObject({
      kind: "partial",
      movedDedupKeys: ["d-a"],
      undo: { dedupKeys: ["d-a"] }
    })
  })

  it.each([undefined, null, "bad", {}])("does not fall back to legacy success when an outcomes field is malformed: %#", async (outcomes) => {
    const { lifecycle, requestId } = await setupTrash(["a"])
    const result = await lifecycle.reconcile({ requestId, success: true, data: {
      outcomes, trashedKeys: ["a"], trashedDedupKeys: ["d-a"]
    } })
    expect(result).toMatchObject({ kind: "unknown", movedDedupKeys: [], unknownDedupKeys: ["d-a"], undo: null })
  })

  it.each(["confirmed", "failed", "unknown"] as const)("quarantines duplicate terminal facts even when both say %s", async (status) => {
    const { lifecycle, requestId } = await setupTrash(["a"])
    const result = await lifecycle.reconcile({ requestId, success: true, data: {
      outcomes: [fact("trash", "d-a", status), fact("trash", "d-a", status)], notDispatchedDedupKeys: ["d-a"]
    } })
    expect(result).toMatchObject({ kind: "unknown", movedDedupKeys: [], unknownDedupKeys: ["d-a"],
      notDispatchedDedupKeys: [], undo: null })
  })

  it("quarantines one trash target reported as both confirmed and not dispatched", async () => {
    const { lifecycle, requestId } = await setupTrash(["a"])

    expect(await lifecycle.reconcile({
      requestId,
      success: true,
      data: {
        outcomes: [fact("trash", "d-a", "confirmed")],
        notDispatchedDedupKeys: ["d-a"]
      }
    })).toMatchObject({
      kind: "unknown",
      movedDedupKeys: [],
      unknownDedupKeys: ["d-a"],
      failedDedupKeys: [],
      notDispatchedDedupKeys: [],
      undo: null
    })
  })

  it("keeps a proven pre-dispatch rejection distinct from a dispatched failure", async () => {
    const { lifecycle, audit, requestId } = await setupTrash(["a", "b"])
    const result = await lifecycle.reconcile({ requestId, success: false, data: {
      outcomes: [fact("trash", "d-a", "failed"), fact("trash", "d-b", "failed")], notDispatchedDedupKeys: ["d-b"]
    } })
    expect(result).toMatchObject({ kind: "failed", failedMediaKeys: ["a"], failedDedupKeys: ["d-a"],
      notDispatchedMediaKeys: ["b"], notDispatchedDedupKeys: ["d-b"], undo: null })
    expect(audit.resultReports[0]).toMatchObject({ failedCount: 1, notDispatchedCount: 1, unknownCount: 0 })
  })

  it("recognizes legacy explicit not-dispatched targets without assuming the rest moved", async () => {
    const { lifecycle, audit, requestId } = await setupTrash(["a", "b"])
    const result = await lifecycle.reconcile({ requestId, success: false, data: { notDispatchedDedupKeys: ["d-b"] } })
    expect(result)
      .toMatchObject({ kind: "unknown", unknownMediaKeys: ["a"], unknownDedupKeys: ["d-a"],
        notDispatchedMediaKeys: ["b"], notDispatchedDedupKeys: ["d-b"], failedDedupKeys: [], undo: null })
    expect(audit.resultReports[0]?.outcomes).toEqual([
      {
        operation: "trash",
        targetKey: "d-a",
        status: "unknown",
        reason: "legacy-response-did-not-confirm-target"
      },
      {
        operation: "trash",
        targetKey: "d-b",
        status: "failed",
        reason: "not-dispatched"
      }
    ])
    expect(audit.resultReports[0]).toMatchObject({
      status: "unknown",
      failedCount: 0,
      failedDedupKeys: [],
      notDispatchedCount: 1,
      notDispatchedDedupKeys: ["d-b"]
    })
  })

  it.each(["bad", null, ["foreign"], ["d-a", "d-a"], ["d-a", 1]])("flags malformed not-dispatched metadata without silently accepting complete success: %#", async (notDispatchedDedupKeys) => {
    const { lifecycle, requestId } = await setupTrash(["a"])
    expect((await lifecycle.reconcile({ requestId, success: true, data: {
      outcomes: [fact("trash", "d-a", "confirmed")], notDispatchedDedupKeys
    } })).kind).not.toBe("complete")
  })

  it("accepts an empty not-dispatched list when every requested target is confirmed", async () => {
    const { lifecycle, requestId } = await setupTrash(["a", "b"])
    const result = await lifecycle.reconcile({
      requestId,
      success: true,
      data: {
        outcomes: [fact("trash", "d-a", "confirmed"), fact("trash", "d-b", "confirmed")],
        notDispatchedDedupKeys: []
      }
    })

    expect(result).toMatchObject({
      kind: "complete",
      movedMediaKeys: ["a", "b"],
      movedDedupKeys: ["d-a", "d-b"],
      movedCount: 2,
      notDispatchedMediaKeys: [],
      notDispatchedDedupKeys: []
    })
  })

  it("preserves confirmed progress but rejects a non-string not-dispatched entry", async () => {
    const { lifecycle, requestId } = await setupTrash(["a"])
    const result = await lifecycle.reconcile({
      requestId,
      success: true,
      data: {
        outcomes: [fact("trash", "d-a", "confirmed")],
        notDispatchedDedupKeys: [1]
      }
    })

    expect(result).toMatchObject({
      kind: "partial",
      movedMediaKeys: ["a"],
      movedDedupKeys: ["d-a"],
      movedCount: 1,
      notDispatchedMediaKeys: [],
      notDispatchedDedupKeys: []
    })
    if (result.kind !== "partial") throw new Error("Expected partial trash result")
    expect(result.message).toContain("identities outside the confirmed request")
  })

  it("retains confirmed and failed progress across a later unknown update and a lost terminal response", async () => {
    const { lifecycle, audit, requestId } = await setupTrash(["a", "b", "c"])
    expect(lifecycle.recordProgress({ requestId, data: { outcomes: [
      fact("trash", "d-a", "confirmed"), fact("trash", "d-b", "failed")
    ] } })).toBe(true)
    lifecycle.recordProgress({ requestId, data: { outcomes: [fact("trash", "d-a", "unknown"), fact("trash", "d-b", "unknown")] } })
    const result = await lifecycle.timeout({ requestId, error: "network lost" })
    expect(result).toMatchObject({ kind: "partial", movedDedupKeys: ["d-a"], failedDedupKeys: ["d-b"],
      unknownDedupKeys: ["d-c"], undo: { dedupKeys: ["d-a"], count: 1 }, message: "network lost" })
    expect(audit.resultReports).toHaveLength(1)
    expect(audit.resultReports[0]?.outcomes?.map(({ targetKey, status }) => ({ targetKey, status }))).toEqual([
      { targetKey: "d-a", status: "confirmed" }, { targetKey: "d-b", status: "failed" }, { targetKey: "d-c", status: "unknown" }
    ])
    expect(await lifecycle.timeout({ requestId })).toMatchObject({ kind: "unknown", unknownDedupKeys: ["d-c"], failedDedupKeys: ["d-b"] })
    expect(audit.resultReports).toHaveLength(1)
    expect(lifecycle.isPending(requestId)).toBe(true)
    await expect(begin(lifecycle)).rejects.toThrow(/pending/)
  })

  it.each(["timeout", "outcomes-omitted terminal"] as const)(
    "preserves confirmed Trash recovery after malformed progress before %s",
    async (resolution) => {
      const { lifecycle, audit, requestId } = await setupTrash(["a", "b"])
      expect(lifecycle.recordProgress({
        requestId,
        data: { outcomes: [fact("trash", "d-a", "confirmed")] }
      })).toBe(true)

      expect(lifecycle.recordProgress({
        requestId,
        data: {
          outcomes: [{ operation: "trash", targetKey: "d-a", status: "done" }]
        }
      })).toBe(true)

      const result = resolution === "timeout"
        ? await lifecycle.timeout({ requestId, error: "provider timed out" })
        : await lifecycle.reconcile({ requestId, success: false })

      expect(result).toMatchObject({
        kind: "partial",
        movedMediaKeys: ["a"],
        movedDedupKeys: ["d-a"],
        movedCount: 1,
        unknownDedupKeys: ["d-b"],
        undo: { dedupKeys: ["d-a"], count: 1 }
      })
      expect(audit.resultReports).toHaveLength(1)
      expect(audit.resultReports[0]?.outcomes).toEqual([
        fact("trash", "d-a", "confirmed"),
        {
          ...fact("trash", "d-b", "unknown"),
          reason: resolution === "timeout"
            ? "provider-timeout-before-target-outcome"
            : "no-terminal-provider-outcome"
        }
      ])
    }
  )

  it("uses retained progress when a same-request terminal omits outcomes", async () => {
    const { lifecycle, audit, requestId } = await setupTrash(["a", "b"])
    lifecycle.recordProgress({ requestId, data: { outcomes: [fact("trash", "d-a", "confirmed")] } })
    const result = await lifecycle.reconcile({ requestId, success: false })
    expect(result).toMatchObject({ kind: "partial", movedDedupKeys: ["d-a"],
      unknownDedupKeys: ["d-b"], undo: { dedupKeys: ["d-a"] } })
    expect(audit.resultReports[0]?.outcomes).toEqual([
      fact("trash", "d-a", "confirmed"),
      {
        ...fact("trash", "d-b", "unknown"),
        reason: "no-terminal-provider-outcome"
      }
    ])
    expect(lifecycle.isPending()).toBe(false)
  })

  it("uses an explicit complete terminal over retained provisional trash progress", async () => {
    const { lifecycle, requestId } = await setupTrash(["a", "b"])
    lifecycle.recordProgress({
      requestId,
      data: { outcomes: [fact("trash", "d-a", "unknown")] }
    })

    const terminal = await lifecycle.reconcile({
      requestId,
      success: true,
      data: {
        outcomes: [
          fact("trash", "d-a", "confirmed"),
          fact("trash", "d-b", "confirmed")
        ]
      }
    })

    expect(terminal).toMatchObject({
      kind: "complete",
      movedMediaKeys: ["a", "b"],
      movedDedupKeys: ["d-a", "d-b"],
      undo: { dedupKeys: ["d-a", "d-b"], count: 2 }
    })
  })

  it("accepts a later confirmed progress fact for a provisional unknown target", async () => {
    const { lifecycle, requestId } = await setupTrash(["a"])
    lifecycle.recordProgress({ requestId, data: { outcomes: [fact("trash", "d-a", "unknown")] } })
    lifecycle.recordProgress({ requestId, data: { outcomes: [fact("trash", "d-a", "confirmed")] } })
    expect(await lifecycle.reconcile({ requestId, success: true })).toMatchObject({ kind: "complete", movedDedupKeys: ["d-a"] })
  })

  it("preserves the provider reason on a first unknown progress fact", async () => {
    const { lifecycle, audit, requestId } = await setupTrash(["a"])
    lifecycle.recordProgress({
      requestId,
      data: {
        outcomes: [
          { ...fact("trash", "d-a", "unknown"), reason: "provider still processing" }
        ]
      }
    })

    await lifecycle.timeout({ requestId })

    expect(audit.resultReports[0]?.outcomes).toEqual([
      { ...fact("trash", "d-a", "unknown"), reason: "provider still processing" }
    ])
  })

  it("keeps the latest reason when unknown progress is refreshed", async () => {
    const { lifecycle, audit, requestId } = await setupTrash(["a"])
    lifecycle.recordProgress({
      requestId,
      data: {
        outcomes: [
          { ...fact("trash", "d-a", "unknown"), reason: "earlier provider detail" }
        ]
      }
    })
    lifecycle.recordProgress({
      requestId,
      data: {
        outcomes: [
          { ...fact("trash", "d-a", "unknown"), reason: "latest provider detail" }
        ]
      }
    })

    await lifecycle.timeout({ requestId })

    expect(audit.resultReports[0]?.outcomes).toEqual([
      { ...fact("trash", "d-a", "unknown"), reason: "latest provider detail" }
    ])
  })

  it("rejects stale/absent progress and ignores invalid target facts", async () => {
    const { lifecycle, requestId } = await setupTrash(["a"])
    expect(lifecycle.recordProgress({ requestId: "foreign", data: { outcomes: [fact("trash", "d-a", "confirmed")] } })).toBe(false)
    expect(lifecycle.recordProgress({ requestId })).toBe(false)
    expect(lifecycle.recordProgress({ requestId, data: { outcomes: "bad" } })).toBe(false)
    expect(lifecycle.recordProgress({ requestId, data: { outcomes: [null, 1, {}, fact("restore", "d-a", "confirmed"),
      fact("trash", "foreign", "confirmed"), { ...fact("trash", "d-a", "confirmed"), targetKey: 1 },
      { ...fact("trash", "d-a", "confirmed"), status: "done" }] } })).toBe(true)
    expect(await lifecycle.timeout({ requestId })).toMatchObject({ kind: "unknown", movedDedupKeys: [], unknownDedupKeys: ["d-a"] })
    lifecycle.reset()
    expect(lifecycle.recordProgress({ requestId, data: { outcomes: [] } })).toBe(false)
  })

  it("keeps an isolated wrong-operation confirmation unknown when trash times out", async () => {
    const { lifecycle, requestId } = await setupTrash(["a"])
    expect(lifecycle.recordProgress({
      requestId,
      data: { outcomes: [fact("restore", "d-a", "confirmed")] }
    })).toBe(true)

    expect(await lifecycle.timeout({ requestId })).toMatchObject({
      kind: "unknown",
      movedDedupKeys: [],
      unknownDedupKeys: ["d-a"],
      undo: null
    })
  })

  it("bounds persisted provider reason text and ignores non-text reasons", async () => {
    const { lifecycle, audit, requestId } = await setupTrash(["a", "b"])
    lifecycle.recordProgress({ requestId, data: { outcomes: [
      { ...fact("trash", "d-a", "failed"), reason: "x".repeat(400) },
      { ...fact("trash", "d-b", "failed"), reason: { private: "not text" } }
    ] } })
    const retainedProgressReason = (
      lifecycle as unknown as {
        pending: {
          progressOutcomes: Map<string, { reason?: string }>
        } | null
      }
    ).pending?.progressOutcomes.get("d-a")?.reason
    expect(retainedProgressReason).toHaveLength(300)

    await lifecycle.reconcile({ requestId, success: false })
    expect(audit.resultReports[0]?.outcomes).toEqual([
      { ...fact("trash", "d-a", "failed"), reason: "x".repeat(300) }, fact("trash", "d-b", "failed")
    ])
  })

  it("bounds provider reason text on direct terminal Trash outcomes", async () => {
    const { lifecycle, audit, requestId } = await setupTrash(["a"])

    await lifecycle.reconcile({
      requestId,
      success: false,
      data: {
        outcomes: [
          { ...fact("trash", "d-a", "failed"), reason: "x".repeat(400) }
        ]
      }
    })

    expect(audit.resultReports[0]?.outcomes).toEqual([
      { ...fact("trash", "d-a", "failed"), reason: "x".repeat(300) }
    ])
    expect(audit.resultReports[0]?.outcomes[0]?.reason).toHaveLength(300)
  })

  it("snapshots every restore intent before dispatch and changes only evaluated target facts", () => {
    const { lifecycle, requestId } = setupRestore()
    expect(lifecycle.restoreProgressSnapshot("foreign")).toBeUndefined()
    expect(lifecycle.restoreProgressSnapshot(requestId)).toEqual(["d-a", "d-b", "d-c"].map((key) => ({
      ...fact("restore", key, "unknown"), reason: "durable-pre-dispatch-intent"
    })))
    expect(lifecycle.recordRestoreProgress({ requestId, outcomes: [{ ...fact("restore", "d-a", "failed"), reason: "x".repeat(400) }] })).toBe(true)
    expect(lifecycle.restoreProgressSnapshot(requestId)?.[0]).toEqual({ ...fact("restore", "d-a", "failed"), reason: "x".repeat(300) })
    expect(lifecycle.restoreProgressSnapshot(requestId)).toHaveLength(3)
    expect(lifecycle.cancelRestore("foreign")).toBe(false)
    expect(lifecycle.isPending(requestId)).toBe(true)
    expect(lifecycle.cancelRestore(requestId)).toBe(true)
    expect(lifecycle.isPending()).toBe(false)
    expect(lifecycle.cancelRestore(requestId)).toBe(false)
    expect(lifecycle.restoreProgressSnapshot(requestId)).toBeUndefined()
    expect(lifecycle.timeoutRestore({ requestId })).toBeUndefined()
  })

  it("ignores a late restore terminal response after cancellation", () => {
    const { lifecycle, requestId } = setupRestore(["d-a"])
    expect(lifecycle.cancelRestore(requestId)).toBe(true)

    expect(lifecycle.reconcileRestore({
      requestId,
      success: true,
      restoredDedupKeys: ["d-a"]
    })).toBeUndefined()
    expect(lifecycle.isPending()).toBe(false)
  })

  it("classifies an all-failed restore as failed rather than unknown", () => {
    const { lifecycle, requestId } = setupRestore(["d-a", "d-b"])

    const outcome = lifecycle.reconcileRestore({
      requestId,
      success: false,
      outcomes: [fact("restore", "d-a", "failed"), fact("restore", "d-b", "failed")]
    })

    expect(outcome).toMatchObject({
      kind: "failed",
      restoredDedupKeys: [],
      failedDedupKeys: ["d-a", "d-b"],
      unknownDedupKeys: [],
      notDispatchedDedupKeys: [],
      undo: { dedupKeys: ["d-a", "d-b"], count: 2 },
      outcomes: [fact("restore", "d-a", "failed"), fact("restore", "d-b", "failed")]
    })
    expect(outcome?.outcomes).toEqual([
      fact("restore", "d-a", "failed"),
      fact("restore", "d-b", "failed")
    ])
  })

  it("combines prior confirmed restore progress with a legacy terminal remainder", () => {
    const { lifecycle, requestId } = setupRestore(["restore-a", "restore-b"])
    expect(lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [fact("restore", "restore-a", "confirmed")]
    })).toBe(true)

    expect(lifecycle.reconcileRestore({
      requestId,
      success: true,
      restoredDedupKeys: ["restore-b"]
    })).toMatchObject({
      kind: "complete",
      restoredDedupKeys: ["restore-a", "restore-b"],
      outcomes: [
        fact("restore", "restore-a", "confirmed"),
        fact("restore", "restore-b", "confirmed")
      ]
    })
  })

  it("keeps progressed unknown restore out of retry and leaves the omitted remainder unknown", () => {
    const { lifecycle, requestId } = setupRestore([
      "restore-a",
      "restore-b",
      "restore-c"
    ])
    expect(lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [fact("restore", "restore-b", "unknown")]
    })).toBe(true)

    const result = lifecycle.reconcileRestore({
      requestId,
      success: false,
      restoredDedupKeys: ["restore-a"],
      notDispatchedDedupKeys: ["restore-b"]
    })

    expect(result).toMatchObject({
      kind: "partial",
      restoredDedupKeys: ["restore-a"],
      unknownDedupKeys: ["restore-b", "restore-c"],
      failedDedupKeys: [],
      notDispatchedDedupKeys: [],
      outcomes: [
        fact("restore", "restore-a", "confirmed"),
        fact("restore", "restore-b", "unknown"),
        fact("restore", "restore-c", "unknown")
      ]
    })
  })

  it.each([false, true])(
    "accepts legacy terminal identities when outcomes is omitted or undefined (explicit undefined: %s)",
    (includeUndefinedOutcomes) => {
      const { lifecycle, requestId } = setupRestore(["d-a"])
      const result = lifecycle.reconcileRestore({
        requestId,
        success: true,
        restoredDedupKeys: ["d-a"],
        ...(includeUndefinedOutcomes ? { outcomes: undefined } : {})
      })

      expect(result).toMatchObject({
        kind: "complete",
        restoredDedupKeys: ["d-a"],
        outcomes: [fact("restore", "d-a", "confirmed")]
      })
    }
  )

  it.each([null, 1, {}, fact("trash", "d-b", "confirmed"), fact("restore", "foreign", "confirmed"),
    { ...fact("restore", "d-b", "confirmed"), targetKey: 1 },
    { ...fact("restore", "d-b", "confirmed"), status: "done" }])("rejects the entire malformed restore-progress chunk atomically: %#", (badFact) => {
    const { lifecycle, requestId } = setupRestore()
    const before = lifecycle.restoreProgressSnapshot(requestId)
    expect(lifecycle.recordRestoreProgress({ requestId, outcomes: [fact("restore", "d-a", "confirmed"), badFact] })).toBe(false)
    expect(lifecycle.restoreProgressSnapshot(requestId)).toEqual(before)
  })

  it("rejects duplicated, missing, or stale restore progress without granting retry permission", () => {
    const { lifecycle, requestId } = setupRestore()
    const before = lifecycle.restoreProgressSnapshot(requestId)
    expect(lifecycle.recordRestoreProgress({ requestId, outcomes: [fact("restore", "d-a", "confirmed"), fact("restore", "d-a", "confirmed")] })).toBe(false)
    expect(lifecycle.recordRestoreProgress({ requestId })).toBe(false)
    expect(lifecycle.recordRestoreProgress({ requestId: "foreign", outcomes: [] })).toBe(false)
    expect(lifecycle.restoreProgressSnapshot(requestId)).toEqual(before)
  })

  it.each([null, "bad", ["d-b", 1], ["d-b", "d-b"], ["foreign"]])("quarantines malformed restore not-dispatched metadata: %#", (notDispatchedDedupKeys) => {
    const { lifecycle, requestId } = setupRestore(["d-a", "d-b"])
    expect(lifecycle.reconcileRestore({ requestId, success: true,
      outcomes: [fact("restore", "d-a", "confirmed"), fact("restore", "d-b", "failed")], notDispatchedDedupKeys }))
      .toMatchObject({ kind: "unknown", restoredDedupKeys: [], unknownDedupKeys: ["d-a", "d-b"],
        notDispatchedDedupKeys: [], undo: { dedupKeys: [], count: 0 } })
  })

  it("quarantines a terminal target reported as both confirmed and not dispatched", () => {
    const { lifecycle, requestId } = setupRestore(["restore-a", "restore-b"])

    expect(lifecycle.reconcileRestore({
      requestId,
      success: false,
      outcomes: [
        fact("restore", "restore-a", "confirmed"),
        fact("restore", "restore-b", "failed")
      ],
      notDispatchedDedupKeys: ["restore-a"]
    })).toMatchObject({
      kind: "unknown",
      restoredDedupKeys: [],
      unknownDedupKeys: ["restore-a", "restore-b"],
      failedDedupKeys: [],
      notDispatchedDedupKeys: [],
      undo: { dedupKeys: [], count: 0 },
      outcomes: [
        fact("restore", "restore-a", "unknown"),
        fact("restore", "restore-b", "unknown")
      ]
    })
  })

  it("preserves a prior restore confirmation and quarantines siblings claimed as failed when it is marked not dispatched", () => {
    const { lifecycle, requestId } = setupRestore(["restore-a", "restore-b", "restore-c"])
    expect(lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [fact("restore", "restore-a", "confirmed")]
    })).toBe(true)

    const result = lifecycle.reconcileRestore({
      requestId,
      success: false,
      outcomes: [
        fact("restore", "restore-a", "confirmed"),
        fact("restore", "restore-b", "failed"),
        fact("restore", "restore-c", "failed")
      ],
      notDispatchedDedupKeys: ["restore-a"]
    })

    expect(result).toMatchObject({
      kind: "partial",
      restoredDedupKeys: ["restore-a"],
      unknownDedupKeys: ["restore-b", "restore-c"],
      failedDedupKeys: [],
      notDispatchedDedupKeys: [],
      undo: { dedupKeys: [], count: 0 },
      outcomes: [
        fact("restore", "restore-a", "confirmed"),
        fact("restore", "restore-b", "unknown"),
        fact("restore", "restore-c", "unknown")
      ]
    })
  })

  it("quarantines contradictory legacy restore identities and preserves prior confirmations", () => {
    const { lifecycle, requestId } = setupRestore(["restore-a", "restore-b"])

    expect(lifecycle.reconcileRestore({
      requestId,
      success: true,
      restoredDedupKeys: ["restore-a", "restore-b"],
      notDispatchedDedupKeys: ["restore-a"]
    })).toMatchObject({
      kind: "unknown",
      restoredDedupKeys: [],
      unknownDedupKeys: ["restore-a", "restore-b"],
      failedDedupKeys: [],
      notDispatchedDedupKeys: [],
      undo: { dedupKeys: [], count: 0 },
      outcomes: [
        fact("restore", "restore-a", "unknown"),
        fact("restore", "restore-b", "unknown")
      ]
    })

    const withProgress = setupRestore(["restore-a", "restore-b"])
    expect(withProgress.lifecycle.recordRestoreProgress({
      requestId: withProgress.requestId,
      outcomes: [fact("restore", "restore-a", "confirmed")]
    })).toBe(true)
    expect(withProgress.lifecycle.reconcileRestore({
      requestId: withProgress.requestId,
      success: true,
      restoredDedupKeys: ["restore-a", "restore-b"],
      notDispatchedDedupKeys: ["restore-a"]
    })).toMatchObject({
      kind: "partial",
      restoredDedupKeys: ["restore-a"],
      unknownDedupKeys: ["restore-b"],
      failedDedupKeys: [],
      notDispatchedDedupKeys: [],
      undo: { dedupKeys: [], count: 0 },
      outcomes: [
        fact("restore", "restore-a", "confirmed"),
        fact("restore", "restore-b", "unknown")
      ]
    })
  })

  it("does not keep a not-dispatched legacy restore beside a prior confirmation", () => {
    const { lifecycle, requestId } = setupRestore(["restore-a"])
    expect(lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [
        { ...fact("restore", "restore-a", "confirmed"), reason: "confirmed before terminal" }
      ]
    })).toBe(true)

    const result = lifecycle.reconcileRestore({
      requestId,
      success: false,
      restoredDedupKeys: [],
      notDispatchedDedupKeys: ["restore-a"]
    })

    expect(result).toMatchObject({
      kind: "complete",
      restoredDedupKeys: ["restore-a"],
      notDispatchedDedupKeys: [],
      outcomes: [
        { ...fact("restore", "restore-a", "confirmed"), reason: "confirmed before terminal" }
      ]
    })
  })

  it("keeps a prior legacy confirmation separate from a valid terminal not-dispatched remainder", () => {
    const { lifecycle, requestId } = setupRestore(["restore-a", "restore-b"])
    expect(lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [fact("restore", "restore-a", "confirmed")]
    })).toBe(true)

    const result = lifecycle.reconcileRestore({
      requestId,
      success: false,
      restoredDedupKeys: [],
      notDispatchedDedupKeys: ["restore-b"]
    })

    expect(result).toMatchObject({
      kind: "partial",
      restoredDedupKeys: ["restore-a"],
      failedDedupKeys: ["restore-b"],
      unknownDedupKeys: [],
      notDispatchedDedupKeys: ["restore-b"],
      undo: { dedupKeys: ["restore-b"], count: 1 },
      outcomes: [
        fact("restore", "restore-a", "confirmed"),
        { ...fact("restore", "restore-b", "failed"), reason: "not-dispatched" }
      ]
    })
    expect(result?.restoredDedupKeys).not.toEqual(
      expect.arrayContaining(result?.notDispatchedDedupKeys ?? [])
    )
  })

  it("does not mark an unconfirmed legacy restore failure as not-dispatched", () => {
    const { lifecycle, requestId } = setupRestore(["restore-a"])
    expect(lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [
        {
          ...fact("restore", "restore-a", "failed"),
          reason: "the dispatched provider restore failed"
        }
      ]
    })).toBe(true)

    const result = lifecycle.reconcileRestore({
      requestId,
      success: false,
      restoredDedupKeys: []
    })

    expect(result).toMatchObject({
      kind: "unknown",
      restoredDedupKeys: [],
      failedDedupKeys: [],
      unknownDedupKeys: ["restore-a"],
      notDispatchedDedupKeys: [],
      undo: { dedupKeys: [], count: 0 },
      outcomes: [fact("restore", "restore-a", "unknown")]
    })
  })

  it("does not retry a not-dispatched target when another terminal outcome is missing", () => {
    const { lifecycle, requestId } = setupRestore(["restore-a", "restore-b"])

    expect(lifecycle.reconcileRestore({
      requestId,
      success: false,
      outcomes: [fact("restore", "restore-a", "confirmed")],
      notDispatchedDedupKeys: ["restore-b"]
    })).toMatchObject({
      kind: "unknown",
      restoredDedupKeys: [],
      unknownDedupKeys: ["restore-a", "restore-b"],
      failedDedupKeys: [],
      notDispatchedDedupKeys: [],
      undo: { dedupKeys: [], count: 0 },
      outcomes: [
        fact("restore", "restore-a", "unknown"),
        fact("restore", "restore-b", "unknown")
      ]
    })
  })

  it("preserves prior confirmed restore progress when a later terminal response is malformed", () => {
    const { lifecycle, requestId } = setupRestore(["restore-a", "restore-b", "restore-c"])
    expect(lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [fact("restore", "restore-a", "confirmed")]
    })).toBe(true)

    expect(lifecycle.reconcileRestore({
      requestId,
      success: false,
      outcomes: [
        fact("restore", "restore-a", "failed"),
        fact("restore", "restore-b", "confirmed"),
        fact("restore", "restore-c", "failed")
      ],
      notDispatchedDedupKeys: ["restore-c", "foreign"]
    })).toMatchObject({
      kind: "partial",
      restoredDedupKeys: ["restore-a"],
      unknownDedupKeys: ["restore-b", "restore-c"],
      failedDedupKeys: [],
      notDispatchedDedupKeys: [],
      undo: { dedupKeys: [], count: 0 },
      outcomes: [
        fact("restore", "restore-a", "confirmed"),
        fact("restore", "restore-b", "unknown"),
        fact("restore", "restore-c", "unknown")
      ]
    })
  })

  it.each([
    ["null candidate", null],
    ["primitive candidate", 17],
    ["invalid status", { ...fact("restore", "restore-b", "confirmed"), status: "done" }],
    ["foreign target", fact("restore", "foreign", "confirmed")],
    ["duplicate target", fact("restore", "restore-b", "confirmed")]
  ])("quarantines a complete restore terminal with an appended %s", (_label, extraOutcome) => {
    const { lifecycle, requestId } = setupRestore(["restore-a", "restore-b", "restore-c"])
    expect(lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [fact("restore", "restore-a", "confirmed")]
    })).toBe(true)

    expect(lifecycle.reconcileRestore({
      requestId,
      success: true,
      outcomes: [
        fact("restore", "restore-a", "failed"),
        fact("restore", "restore-b", "confirmed"),
        fact("restore", "restore-c", "confirmed"),
        extraOutcome
      ]
    })).toMatchObject({
      kind: "partial",
      restoredDedupKeys: ["restore-a"],
      unknownDedupKeys: ["restore-b", "restore-c"],
      failedDedupKeys: [],
      notDispatchedDedupKeys: [],
      undo: { dedupKeys: [], count: 0 },
      outcomes: [
        fact("restore", "restore-a", "confirmed"),
        fact("restore", "restore-b", "unknown"),
        fact("restore", "restore-c", "unknown")
      ],
      error: expect.stringMatching(/valid identity/i)
    })
  })

  it("bounds reason text on terminal restore outcomes", () => {
    const { lifecycle, requestId } = setupRestore(["restore-a", "restore-b"])

    expect(lifecycle.reconcileRestore({
      requestId,
      success: false,
      outcomes: [
        { ...fact("restore", "restore-a", "failed"), reason: "x".repeat(400) },
        { ...fact("restore", "restore-b", "failed"), reason: { private: "not text" } }
      ]
    })).toMatchObject({
      kind: "failed",
      outcomes: [
        { ...fact("restore", "restore-a", "failed"), reason: "x".repeat(300) },
        fact("restore", "restore-b", "failed")
      ]
    })
  })

  it.each([null, "bad", {}, [fact("restore", "d-a", "confirmed")],
    [fact("restore", "d-a", "confirmed"), fact("restore", "d-a", "failed"), fact("restore", "d-b", "failed")],
    [fact("trash", "d-a", "confirmed"), fact("restore", "d-b", "failed")],
    [fact("restore", "foreign", "confirmed"), fact("restore", "d-b", "failed")],
    [null, fact("restore", "d-b", "failed")],
    [{ ...fact("restore", "d-a", "confirmed"), status: "done" }, fact("restore", "d-b", "failed")]
  ])("keeps malformed restore terminal targets out of the retry set: %#", (outcomes) => {
    const { lifecycle, requestId } = setupRestore(["d-a", "d-b"])
    expect(lifecycle.reconcileRestore({ requestId, success: true, outcomes })).toMatchObject({ kind: "unknown",
      restoredDedupKeys: [], unknownDedupKeys: ["d-a", "d-b"], undo: { dedupKeys: [], count: 0 },
      error: "The provider restore response did not contain a valid identity for every requested item; ambiguous targets will not be retried." })
  })

  it("uses the default error for a valid terminal that confirms no restore targets", () => {
    const { lifecycle, requestId } = setupRestore(["d-a"])

    expect(lifecycle.reconcileRestore({
      requestId,
      success: false,
      outcomes: [fact("restore", "d-a", "failed")]
    })).toMatchObject({
      kind: "failed",
      error: "The provider did not confirm that every requested item was restored.",
      failedDedupKeys: ["d-a"],
      outcomes: [fact("restore", "d-a", "failed")]
    })
  })

  it("accepts an explicit unknown restore outcome without classifying it as malformed", () => {
    const { lifecycle, requestId } = setupRestore(["d-a"])

    expect(lifecycle.reconcileRestore({
      requestId,
      success: true,
      outcomes: [fact("restore", "d-a", "unknown")]
    })).toMatchObject({
      kind: "unknown",
      error: "The provider did not confirm that every requested item was restored.",
      restoredDedupKeys: [],
      unknownDedupKeys: ["d-a"],
      failedDedupKeys: [],
      notDispatchedDedupKeys: [],
      outcomes: [fact("restore", "d-a", "unknown")]
    })
  })

  it.each(["per-target", "legacy"] as const)(
    "omits a not-dispatched reason from a confirmed terminal without metadata (%s)",
    (protocol) => {
      const { lifecycle, requestId } = setupRestore(["d-a"])
      const result = protocol === "per-target"
        ? lifecycle.reconcileRestore({
            requestId,
            success: true,
            outcomes: [fact("restore", "d-a", "confirmed")]
          })
        : lifecycle.reconcileRestore({
            requestId,
            success: true,
            restoredDedupKeys: ["d-a"]
          })

      expect(result?.outcomes).toEqual([fact("restore", "d-a", "confirmed")])
      expect(Object.hasOwn(result?.outcomes?.[0] ?? {}, "reason")).toBe(false)
    }
  )

  it.each(["per-target", "legacy"] as const)(
    "omits an absent prior reason from a same-status confirmed terminal (%s)",
    (protocol) => {
      const { lifecycle, requestId } = setupRestore(["d-a"])
      expect(lifecycle.recordRestoreProgress({
        requestId,
        outcomes: [fact("restore", "d-a", "confirmed")]
      })).toBe(true)

      const result = protocol === "per-target"
        ? lifecycle.reconcileRestore({
            requestId,
            success: true,
            outcomes: [fact("restore", "d-a", "confirmed")]
          })
        : lifecycle.reconcileRestore({
            requestId,
            success: true,
            restoredDedupKeys: ["d-a"]
          })

      expect(result?.outcomes).toEqual([fact("restore", "d-a", "confirmed")])
      expect(Object.hasOwn(result?.outcomes?.[0] ?? {}, "reason")).toBe(false)
    }
  )

  it("preserves a prior same-status restore reason when the terminal omits one", () => {
    const { lifecycle, requestId } = setupRestore(["d-a"])
    lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [
        { ...fact("restore", "d-a", "failed"), reason: "provider rejected the dispatched restore" }
      ]
    })

    const result = lifecycle.reconcileRestore({
      requestId,
      success: false,
      outcomes: [fact("restore", "d-a", "failed")]
    })

    expect(result).toMatchObject({
      kind: "failed",
      failedDedupKeys: ["d-a"],
      outcomes: [
        { ...fact("restore", "d-a", "failed"), reason: "provider rejected the dispatched restore" }
      ]
    })
  })

  it.each(["per-target", "legacy"] as const)(
    "omits an absent prior reason after a malformed same-status %s terminal",
    (protocol) => {
      const { lifecycle, requestId } = setupRestore(["d-a"])
      expect(lifecycle.recordRestoreProgress({
        requestId,
        outcomes: [fact("restore", "d-a", "unknown")]
      })).toBe(true)

      const result = protocol === "per-target"
        ? lifecycle.reconcileRestore({
            requestId,
            success: true,
            outcomes: [
              fact("restore", "d-a", "unknown"),
              fact("restore", "d-a", "unknown")
            ]
          })
        : lifecycle.reconcileRestore({
            requestId,
            success: true,
            restoredDedupKeys: ["d-a", "d-a"]
          })

      expect(result?.outcomes).toEqual([fact("restore", "d-a", "unknown")])
      expect(Object.hasOwn(result?.outcomes?.[0] ?? {}, "reason")).toBe(false)
    }
  )

  it("drops reasons from duplicate restore facts that make targets ambiguous", () => {
    const { lifecycle, requestId } = setupRestore(["d-a", "d-b"])

    const result = lifecycle.reconcileRestore({
      requestId,
      success: false,
      outcomes: [
        { ...fact("restore", "d-a", "failed"), reason: "first target fact" },
        { ...fact("restore", "d-a", "confirmed"), reason: "conflicting duplicate fact" },
        { ...fact("restore", "d-b", "failed"), reason: "sibling provider reason" }
      ]
    })

    expect(result).toMatchObject({
      kind: "unknown",
      unknownDedupKeys: ["d-a", "d-b"],
      outcomes: [fact("restore", "d-a", "unknown"), fact("restore", "d-b", "unknown")]
    })
    expect(result?.outcomes).toEqual([
      fact("restore", "d-a", "unknown"),
      fact("restore", "d-b", "unknown")
    ])
  })

  it("suppresses malformed terminal reasons while retaining prior unknown progress reason", () => {
    const { lifecycle, requestId } = setupRestore(["d-a", "d-b"])
    expect(lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [
        { ...fact("restore", "d-a", "unknown"), reason: "earlier progress remains uncertain" }
      ]
    })).toBe(true)

    const result = lifecycle.reconcileRestore({
      requestId,
      success: false,
      outcomes: [
        { ...fact("restore", "d-a", "unknown"), reason: "untrusted terminal reason" },
        { ...fact("restore", "d-b", "unknown"), reason: "untrusted sibling reason" },
        fact("restore", "foreign", "confirmed")
      ]
    })

    expect(result).toMatchObject({
      kind: "unknown",
      unknownDedupKeys: ["d-a", "d-b"],
      outcomes: [
        { ...fact("restore", "d-a", "unknown"), reason: "earlier progress remains uncertain" },
        fact("restore", "d-b", "unknown")
      ]
    })
    expect(result?.outcomes).toEqual([
      { ...fact("restore", "d-a", "unknown"), reason: "earlier progress remains uncertain" },
      fact("restore", "d-b", "unknown")
    ])
  })

  it("drops a prior failed reason when a malformed per-target terminal becomes unknown", () => {
    const { lifecycle, requestId } = setupRestore(["d-a", "d-b"])
    expect(lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [
        { ...fact("restore", "d-a", "failed"), reason: "prior dispatched failure" }
      ]
    })).toBe(true)

    const result = lifecycle.reconcileRestore({
      requestId,
      success: false,
      outcomes: [
        { ...fact("restore", "d-a", "unknown"), reason: "untrusted terminal reason" },
        { ...fact("restore", "d-b", "unknown"), reason: "untrusted sibling reason" },
        fact("restore", "foreign", "confirmed")
      ]
    })

    expect(result?.outcomes).toEqual([
      fact("restore", "d-a", "unknown"),
      fact("restore", "d-b", "unknown")
    ])
  })

  it("drops a prior failed reason when a malformed legacy terminal becomes unknown", () => {
    const { lifecycle, requestId } = setupRestore(["d-a", "d-b"])
    expect(lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [
        { ...fact("restore", "d-a", "failed"), reason: "prior dispatched failure" }
      ]
    })).toBe(true)

    const result = lifecycle.reconcileRestore({
      requestId,
      success: true,
      restoredDedupKeys: ["d-a", "foreign"]
    })

    expect(result?.outcomes).toEqual([
      fact("restore", "d-a", "unknown"),
      fact("restore", "d-b", "unknown")
    ])
  })

  it("keeps prior uncertainty reason after a malformed legacy restore terminal", () => {
    const { lifecycle, requestId } = setupRestore(["d-a", "d-b"])
    lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [
        { ...fact("restore", "d-a", "unknown"), reason: "earlier progress remains uncertain" }
      ]
    })

    const result = lifecycle.reconcileRestore({
      requestId,
      success: true,
      restoredDedupKeys: ["d-a", "foreign"]
    })

    expect(result).toMatchObject({
      kind: "unknown",
      unknownDedupKeys: ["d-a", "d-b"],
      outcomes: [
        { ...fact("restore", "d-a", "unknown"), reason: "earlier progress remains uncertain" },
        fact("restore", "d-b", "unknown")
      ]
    })
  })

  it("does not treat an opaque failed restore target as not dispatched when metadata is omitted", () => {
    const sentinel = "Stryker was here"
    const { lifecycle, requestId } = setupRestore([sentinel])

    const result = lifecycle.reconcileRestore({
      requestId,
      success: false,
      outcomes: [fact("restore", sentinel, "failed")]
    })

    expect(result).toMatchObject({
      kind: "failed",
      failedDedupKeys: [sentinel],
      notDispatchedDedupKeys: [],
      undo: { dedupKeys: [sentinel], count: 1 },
      outcomes: [fact("restore", sentinel, "failed")]
    })
    expect(Object.hasOwn(result?.outcomes?.[0] ?? {}, "reason")).toBe(false)
  })

  it.each([true, false])("retries only proven failed restores with an exact not-dispatched subset (legacy=%s)", (legacy) => {
    const { lifecycle, requestId } = setupRestore(["d-a", "d-b"])
    const result = lifecycle.reconcileRestore({ requestId, success: false, error: "stopped before second target",
      ...(legacy ? { restoredDedupKeys: ["d-a"] } : { outcomes: [fact("restore", "d-a", "confirmed"), fact("restore", "d-b", "failed")] }),
      notDispatchedDedupKeys: ["d-b"]
    })
    expect(result).toMatchObject({ kind: "partial", restoredDedupKeys: ["d-a"], failedDedupKeys: ["d-b"],
      unknownDedupKeys: [], notDispatchedDedupKeys: ["d-b"], undo: { dedupKeys: ["d-b"], count: 1 }, error: "stopped before second target" })
    expect(result?.outcomes).toEqual([
      fact("restore", "d-a", "confirmed"),
      {
        ...fact("restore", "d-b", "failed"),
        reason: "not-dispatched"
      }
    ])
    if (result?.kind !== "partial") throw new Error("Expected partial restore")
    expect(lifecycle.beginRestore(result.undo, "retry-only-failed").args.dedupKeys).toEqual(["d-b"])
    expect(lifecycle.reconcileRestore({ requestId: "retry-only-failed", success: true, restoredDedupKeys: ["d-b"] }))
      .toMatchObject({ kind: "complete", restoredDedupKeys: ["d-b"] })
  })

  it.each([null, [], [""], ["d-a", "d-a"], ["valid", 1]])(
    "rejects invalid restore target identity lists before pending state: %#",
    (dedupKeys) => {
      const lifecycle = new TrashLifecycle(inMemoryAudit().adapter)
      const requestId = "invalid-restore-targets"
      const undo = {
        provider: "google",
        dedupKeys,
        count: 1,
        snapshot: { mediaItems: {}, groups: [], totalItems: 1 }
      } as unknown as TrashUndoData

      expect(() => lifecycle.beginRestore(undo, requestId)).toThrow(
        /invalid or duplicated/i
      )
      expect(lifecycle.isPending(requestId)).toBe(false)
    }
  )

  it.each([
    ["unknown", "failed", "unknown", "unknown"],
    ["confirmed", "failed", "confirmed", "complete"],
    ["confirmed", "unknown", "unknown", "unknown"],
    ["failed", "failed", "failed", "failed"]
  ] as const)(
    "preserves the restore state contract for progress %s -> %s",
    (priorStatus, nextStatus, retainedStatus, expectedKind) => {
      const { lifecycle, requestId } = setupRestore(["d-a"])
      expect(lifecycle.recordRestoreProgress({
        requestId,
        outcomes: [fact("restore", "d-a", priorStatus)]
      })).toBe(true)
      expect(lifecycle.recordRestoreProgress({
        requestId,
        outcomes: [fact("restore", "d-a", nextStatus)]
      })).toBe(true)

      const result = lifecycle.timeoutRestore({ requestId })
      expect(result?.kind).toBe(expectedKind)
      expect(result?.outcomes).toEqual([fact("restore", "d-a", retainedStatus)])
      if (result?.kind === "unknown") {
        expect(result).toMatchObject({
          unknownDedupKeys: ["d-a"],
          failedDedupKeys: [],
          undo: { dedupKeys: [], count: 0 }
        })
      } else if (result?.kind === "failed") {
        expect(result).toMatchObject({
          restoredDedupKeys: [],
          failedDedupKeys: ["d-a"],
          undo: { dedupKeys: ["d-a"], count: 1 }
        })
      } else {
        expect(result?.restoredDedupKeys).toEqual(["d-a"])
      }
    }
  )

  it("retains a confirmed restore progress outcome after a later failed progress update", () => {
    const { lifecycle, requestId } = setupRestore(["d-a"])
    const confirmed = {
      ...fact("restore", "d-a", "confirmed"),
      reason: "provider confirmed the restore"
    }
    expect(lifecycle.recordRestoreProgress({ requestId, outcomes: [confirmed] })).toBe(true)
    expect(lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [{
        ...fact("restore", "d-a", "failed"),
        reason: "later contradictory failure"
      }]
    })).toBe(true)

    expect(lifecycle.restoreProgressSnapshot(requestId)).toEqual([confirmed])
    expect(lifecycle.timeoutRestore({ requestId })).toMatchObject({
      kind: "complete",
      restoredDedupKeys: ["d-a"],
      outcomes: [confirmed]
    })
  })

  it("quarantines contradictory same-request restore progress as unknown", () => {
    const { lifecycle, requestId } = setupRestore(["d-a"])
    expect(lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [fact("restore", "d-a", "failed")]
    })).toBe(true)
    expect(lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [fact("restore", "d-a", "confirmed")]
    })).toBe(true)
    expect(lifecycle.recordRestoreProgress({
      requestId,
      outcomes: [fact("restore", "d-a", "confirmed")]
    })).toBe(true)

    expect(lifecycle.timeoutRestore({ requestId })).toMatchObject({
      kind: "unknown",
      restoredDedupKeys: [],
      unknownDedupKeys: ["d-a"],
      failedDedupKeys: [],
      notDispatchedDedupKeys: [],
      undo: { dedupKeys: [], count: 0 },
      outcomes: [fact("restore", "d-a", "unknown")]
    })
  })

  it.each([
    ["confirmed", "failed"],
    ["failed", "confirmed"]
  ] as const)(
    "quarantines contradictory Trash progress %s -> %s instead of changing a terminal fact",
    async (priorStatus, nextStatus) => {
      const { lifecycle, audit, requestId } = await setupTrash(["a"])

      expect(lifecycle.recordProgress({
        requestId,
        data: { outcomes: [fact("trash", "d-a", priorStatus)] }
      })).toBe(true)
      expect(lifecycle.recordProgress({
        requestId,
        data: { outcomes: [fact("trash", "d-a", nextStatus)] }
      })).toBe(true)
      expect(lifecycle.recordProgress({
        requestId,
        data: { outcomes: [fact("trash", "d-a", priorStatus)] }
      })).toBe(true)

      const result = await lifecycle.timeout({ requestId })
      expect(result).toMatchObject({
        kind: "unknown",
        movedDedupKeys: [],
        unknownDedupKeys: ["d-a"],
        failedDedupKeys: [],
        notDispatchedDedupKeys: [],
        undo: null
      })
      expect(audit.resultReports[0]).toMatchObject({
        status: "unknown",
        movedDedupKeys: [],
        unknownDedupKeys: ["d-a"],
        failedDedupKeys: [],
        notDispatchedDedupKeys: [],
        outcomes: [fact("trash", "d-a", "unknown")]
      })
    }
  )

  it.each(["confirmed", "failed"] as const)(
    "keeps repeated %s Trash progress idempotent across messages",
    async (status) => {
      const { lifecycle, audit, requestId } = await setupTrash(["a", "b"])

      expect(lifecycle.recordProgress({
        requestId,
        data: { outcomes: [fact("trash", "d-a", status)] }
      })).toBe(true)
      expect(lifecycle.recordProgress({
        requestId,
        data: { outcomes: [fact("trash", "d-a", status)] }
      })).toBe(true)

      const result = await lifecycle.timeout({ requestId })
      if (status === "confirmed") {
        expect(result).toMatchObject({
          kind: "partial",
          movedDedupKeys: ["d-a"],
          unknownDedupKeys: ["d-b"],
          undo: { dedupKeys: ["d-a"], count: 1 }
        })
      } else {
        expect(result).toMatchObject({
          kind: "unknown",
          movedDedupKeys: [],
          failedDedupKeys: ["d-a"],
          unknownDedupKeys: ["d-b"],
          undo: null
        })
      }
      expect(audit.resultReports[0]?.outcomes).toEqual([
        fact("trash", "d-a", status),
        {
          ...fact("trash", "d-b", "unknown"),
          reason: "provider-timeout-before-target-outcome"
        }
      ])
    }
  )

  it.each([
    ["confirmed", "failed"],
    ["failed", "confirmed"],
    ["confirmed", "confirmed"],
    ["failed", "failed"]
  ] as const)(
    "quarantines duplicate same-payload Trash outcomes %s then %s as unknown",
    async (firstStatus, secondStatus) => {
      const { lifecycle, audit, requestId } = await setupTrash(["a"])
      expect(lifecycle.recordProgress({
        requestId,
        data: {
          outcomes: [
            fact("trash", "d-a", firstStatus),
            fact("trash", "d-a", secondStatus)
          ]
        }
      })).toBe(true)

      expect(await lifecycle.timeout({ requestId })).toMatchObject({
        kind: "unknown",
        movedDedupKeys: [],
        unknownDedupKeys: ["d-a"],
        failedDedupKeys: [],
        notDispatchedDedupKeys: [],
        undo: null
      })
      expect(audit.resultReports[0]).toMatchObject({
        status: "unknown",
        movedDedupKeys: [],
        unknownDedupKeys: ["d-a"],
        failedDedupKeys: [],
        notDispatchedDedupKeys: [],
        outcomes: [fact("trash", "d-a", "unknown")]
      })
    }
  )

  it("ignores restore progress after cancellation", () => {
    const { lifecycle, requestId } = setupRestore(["d-a"])

    expect(lifecycle.cancelRestore(requestId)).toBe(true)
    expect(
      lifecycle.recordRestoreProgress({
        requestId,
        outcomes: [fact("restore", "d-a", "confirmed")]
      })
    ).toBe(false)
    expect(lifecycle.isPending(requestId)).toBe(false)
  })
})
