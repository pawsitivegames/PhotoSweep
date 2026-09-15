import { describe, expect, it } from "vitest"

import { DuplicateReviewSession } from "../../lib/duplicate-review-session"
import {
  TrashLifecycle,
  type TrashAuditAdapter
} from "../../lib/trash-lifecycle"
import type { DuplicateGroup, GpdMediaItem } from "../../lib/types"

function traceFixture(options: { failingPreAudit?: boolean } = {}) {
  const mediaItems: Record<string, GpdMediaItem> = {
    keep: {
      mediaKey: "keep",
      dedupKey: "d-keep",
      thumb: "keep",
      timestamp: 1,
      creationTimestamp: 1,
      provider: "google"
    },
    trashA: {
      mediaKey: "trashA",
      dedupKey: "d-trash-a",
      thumb: "trash-a",
      timestamp: 1,
      creationTimestamp: 2,
      provider: "google"
    },
    trashB: {
      mediaKey: "trashB",
      dedupKey: "d-trash-b",
      thumb: "trash-b",
      timestamp: 1,
      creationTimestamp: 3,
      provider: "google"
    }
  }
  const groups: DuplicateGroup[] = [
    {
      id: "trace-group",
      mediaKeys: ["keep", "trashA", "trashB"],
      originalMediaKey: "keep",
      similarity: 1
    }
  ]
  const reviewSession = new DuplicateReviewSession({
    groups,
    mediaItems,
    selections: {
      selectedGroupIds: new Set(["trace-group"]),
      reviewedGroupIds: new Set(["trace-group"]),
      keptOverrides: { "trace-group": new Set(["keep"]) }
    }
  })
  const reports: unknown[] = []
  const audit: TrashAuditAdapter = {
    async savePreTrashReport(report) {
      if (options.failingPreAudit) throw new Error("audit unavailable")
      reports.push(report)
    },
    async saveTrashResultReport(report) {
      reports.push(report)
    }
  }
  const lifecycle = new TrashLifecycle(audit)
  const plan = {
    provider: "google" as const,
    dedupKeys: ["d-trash-a", "d-trash-b"],
    mediaKeysToTrash: ["trashA", "trashB"],
    blockedMediaKeys: [],
    blockedGroupIds: []
  }
  return { lifecycle, groups, mediaItems, reviewSession, plan, reports }
}

async function dispatchTrace(fixture: ReturnType<typeof traceFixture>) {
  await fixture.lifecycle.begin({
    plan: fixture.plan,
    reviewSession: fixture.reviewSession,
    groups: fixture.groups,
    snapshot: {
      mediaItems: fixture.mediaItems,
      groups: fixture.groups,
      totalItems: 3
    },
    batchPolicy: {
      batchSize: 2,
      batchPauseMs: 0,
      retryCount: 0,
      retryBackoffMs: 0
    }
  })
}

describe("scenario traces exercise the production TrashLifecycle seam", () => {
  it("keeps an empty success response from authorizing any moved or Undo target", async () => {
    const fixture = traceFixture()
    await dispatchTrace(fixture)
    const outcome = await fixture.lifecycle.reconcile({
      success: true,
      data: { trashedKeys: [], trashedDedupKeys: [] }
    })

    expect(outcome.kind).toBe("failed")
    expect(outcome.movedMediaKeys).toEqual([])
    expect(outcome.undo).toBeNull()
  })

  it("keeps provider-confirmed partial and mixed replies within the exact request", async () => {
    const fixture = traceFixture()
    await dispatchTrace(fixture)
    const outcome = await fixture.lifecycle.reconcile({
      success: true,
      data: {
        trashedKeys: ["foreign-media", "trashA"],
        trashedDedupKeys: ["foreign-dedup", "d-trash-a"]
      }
    })

    expect(outcome.kind).toBe("partial")
    expect(outcome.movedMediaKeys).toEqual(["trashA"])
    expect(outcome.movedDedupKeys).toEqual(["d-trash-a"])
    expect(outcome.undo?.dedupKeys).toEqual(["d-trash-a"])
  })

  it("requires a fresh reconciliation after a reset instead of replaying a late reply", async () => {
    const fixture = traceFixture()
    await dispatchTrace(fixture)
    fixture.lifecycle.reset()
    const outcome = await fixture.lifecycle.reconcile({
      success: true,
      data: {
        trashedKeys: ["trashA", "trashB"],
        trashedDedupKeys: ["d-trash-a", "d-trash-b"]
      }
    })

    expect(outcome.kind).toBe("failed")
    expect(outcome.movedCount).toBe(0)
    expect(outcome.undo).toBeNull()
  })

  it("SAFE-07 does not expose a provider command when pre-trash persistence fails", async () => {
    const fixture = traceFixture({ failingPreAudit: true })
    await expect(dispatchTrace(fixture)).rejects.toThrow("audit unavailable")
    const outcome = await fixture.lifecycle.reconcile({
      success: true,
      data: {
        trashedKeys: ["trashA"],
        trashedDedupKeys: ["d-trash-a"]
      }
    })

    expect(outcome.kind).toBe("failed")
    expect(outcome.movedCount).toBe(0)
  })
})
