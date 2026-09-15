import { describe, expect, it } from "vitest"

import {
  DuplicateReviewSession,
  type DuplicateReviewSelections
} from "../../lib/duplicate-review-session"
import type { DuplicateGroup, GpdMediaItem } from "../../lib/types"

function group(id: string, ...mediaKeys: string[]): DuplicateGroup {
  return {
    id,
    mediaKeys,
    originalMediaKey: mediaKeys[0],
    similarity: 0.99
  }
}

function item(
  mediaKey: string,
  overrides: Partial<GpdMediaItem> = {}
): GpdMediaItem {
  return {
    mediaKey,
    dedupKey: `dedup-${mediaKey}`,
    thumb: mediaKey,
    timestamp: 1,
    creationTimestamp: 1,
    isOriginalQuality: false,
    resWidth: 100,
    resHeight: 100,
    ...overrides
  }
}

const g1 = group("g1", "a", "b", "c")
const g2 = group("g2", "d", "e")
const mediaItems = {
  a: item("a", { isOriginalQuality: false, resWidth: 100 }),
  b: item("b", { isOriginalQuality: true, resWidth: 200 }),
  c: item("c", { isOriginalQuality: false, resWidth: 300 }),
  d: item("d", { isOriginalQuality: false, resWidth: 100 }),
  e: item("e", { isOriginalQuality: true, resWidth: 200 })
}

function session(selections?: DuplicateReviewSelections) {
  return new DuplicateReviewSession({
    groups: [g1, g2],
    mediaItems,
    selections
  })
}

describe("keeper decision contract", () => {
  it("keeps all copies and proposes zero Trash when evidence is insufficient", () => {
    const uncertainItems = {
      a: item("a", { isOriginalQuality: null }),
      b: item("b", { isOriginalQuality: null }),
      c: item("c", { isOriginalQuality: null })
    }
    const review = new DuplicateReviewSession({
      groups: [g1],
      mediaItems: uncertainItems,
      selections: {
        selectedGroupIds: new Set(["g1"]),
        reviewedGroupIds: new Set(["g1"]),
        keptOverrides: {}
      }
    })

    const decision = review.keepDecisionByGroupId.get("g1")!
    expect(decision.source).toBe("automatic")
    expect(decision.recommendation.status).toBe(
      "no_confident_recommendation"
    )
    expect(decision.keptMediaKeys).toEqual(new Set(["a", "b", "c"]))
    expect(review.duplicateCount()).toBe(0)
  })

  it("records an automatic strategy and preserves it through serialization", () => {
    const initial = session()
    const applied = initial.update({
      type: "apply_keep_strategy",
      groupIds: ["g1"],
      strategy: "largest_resolution"
    })

    expect(applied.keptOverrides.g1).toEqual(new Set(["c"]))
    expect(applied.keepDecisionProvenance?.g1).toEqual({
      source: "automatic",
      strategy: "largest_resolution"
    })

    const restored = session(applied)
    expect(restored.keptFor(g1)).toEqual(new Set(["c"]))
    expect(restored.decisionFor(g1)).toMatchObject({
      source: "automatic",
      strategy: "largest_resolution",
      recommendation: {
        status: "recommended",
        keptMediaKeys: ["c"]
      }
    })
    expect(restored.serialize()).toMatchObject({
      version: 2,
      keepDecisionProvenance: {
        g1: { source: "automatic", strategy: "largest_resolution" }
      }
    })
  })

  it("gives manual multi-keep, keep-all, and Trash-all decisions precedence", () => {
    const initial = session()
    const manualMulti = session(
      initial.update({
        type: "toggle_kept",
        groupId: "g1",
        mediaKey: "a"
      })
    )
    const manualMultiAfterStrategy = session(
      manualMulti.update({
        type: "apply_keep_strategy",
        groupIds: ["g1"],
        strategy: "newest_taken"
      })
    )
    expect(manualMultiAfterStrategy.keptFor(g1)).toEqual(new Set(["a", "b"]))
    expect(manualMultiAfterStrategy.decisionFor(g1).source).toBe("manual")

    const keepAll = session(
      manualMulti.update({
        type: "toggle_kept",
        groupId: "g1",
        mediaKey: "c"
      })
    )
    const keepAllAfterStrategy = session(
      keepAll.update({
        type: "apply_keep_strategy",
        groupIds: ["g1"],
        strategy: "non_storage_counting"
      })
    )
    expect(keepAllAfterStrategy.keptFor(g1)).toEqual(
      new Set(["a", "b", "c"])
    )
    expect(keepAllAfterStrategy.decisionFor(g1).source).toBe("manual")

    const trashAll = session(
      initial.update({ type: "trash_all_copies", groupId: "g1" })
    )
    const trashAllAfterStrategy = session(
      trashAll.update({
        type: "apply_keep_strategy",
        groupIds: ["g1"],
        strategy: "best_quality"
      })
    )
    expect(trashAllAfterStrategy.keptFor(g1)).toEqual(new Set())
    expect(trashAllAfterStrategy.decisionFor(g1).source).toBe("manual")
    expect(trashAllAfterStrategy.serialize().keptOverrides.g1).toEqual([])
  })

  it("migrates an old override as legacy-preserved and never lets strategy replace it", () => {
    const restored = session({
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1"]),
      keptOverrides: { g1: new Set(["a"]) }
    })

    expect(restored.decisionFor(g1).source).toBe("legacy_preserved")
    const afterStrategy = new DuplicateReviewSession({
      groups: [g1, g2],
      mediaItems,
      selections: restored.update({
        type: "apply_keep_strategy",
        groupIds: ["g1", "g2"],
        strategy: "largest_resolution"
      })
    })
    expect(afterStrategy.keptFor(g1)).toEqual(new Set(["a"]))
    expect(afterStrategy.decisionFor(g1).source).toBe("legacy_preserved")
  })

  it("keeps every current member when all saved keeper keys are stale", () => {
    const restored = session({
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1"]),
      keptOverrides: { g1: new Set(["removed-key"]) }
    })

    expect(restored.keptFor(g1)).toEqual(new Set(["a", "b", "c"]))
    expect(restored.trashPlan().mediaKeysToTrash).toEqual([])
    expect(restored.serialize()).toMatchObject({
      keptOverrides: { g1: ["a", "b", "c"] },
      keepDecisionProvenance: { g1: { source: "legacy_preserved" } }
    })
  })

  it("applies a bulk strategy only to the requested visible groups", () => {
    const initial = session({
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1"]),
      keptOverrides: {}
    })
    const next = session(
      initial.update({
        type: "apply_keep_strategy",
        groupIds: ["g1"],
        strategy: "largest_resolution"
      })
    )

    expect(next.selectedGroupIds).toEqual(new Set(["g1"]))
    expect(next.reviewedGroupIds).toEqual(new Set(["g1"]))
    expect(next.keptFor(g1)).toEqual(new Set(["c"]))
    expect(next.keptFor(g2)).toEqual(new Set(["e"]))
    expect(next.selections.keepDecisionProvenance?.g2).toBeUndefined()
  })
})
