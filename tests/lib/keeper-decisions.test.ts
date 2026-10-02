import { describe, expect, it } from "vitest"

import {
  applyDefaultKeepStrategyToSelections,
  DuplicateReviewSession,
  type DuplicateReviewSelections,
  type StoredDuplicateReviewSelections
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

function hydrateSelections(
  stored: StoredDuplicateReviewSelections
): DuplicateReviewSelections {
  return {
    selectedGroupIds: new Set(stored.selectedGroupIds),
    reviewedGroupIds: new Set(stored.reviewedGroupIds),
    keptOverrides: Object.fromEntries(
      Object.entries(stored.keptOverrides).map(([id, keys]) => [id, new Set(keys)])
    ),
    keepDecisionProvenance: stored.keepDecisionProvenance
  }
}

describe("keeper decision contract", () => {
  it("uses deterministic fallback metadata when automatic quality evidence is insufficient", () => {
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
    expect(decision.recommendation).toMatchObject({
      status: "recommended",
      reasonCode: "deterministic_tiebreak"
    })
    expect(decision.keptMediaKeys).toEqual(new Set(["a"]))
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

  it("preserves manual multi-keep, keep-all, and Trash-all decisions during passive strategy application", () => {
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

  it("replaces manual keeper and Trash-all choices when a strategy is explicitly selected", () => {
    const manualSelections: DuplicateReviewSelections = {
      selectedGroupIds: new Set(["g1", "g2"]),
      reviewedGroupIds: new Set(["g1", "g2"]),
      keptOverrides: {
        g1: new Set(["a", "c"]),
        g2: new Set<string>()
      },
      keepDecisionProvenance: {
        g1: { source: "manual" },
        g2: { source: "manual" }
      }
    }
    const manuallyReviewed = session(manualSelections)
    const applied = session(
      manuallyReviewed.update({
        type: "apply_keep_strategy",
        groupIds: ["g1", "g2"],
        strategy: "best_quality",
        includeGroupIds: ["g1", "g2"],
        overrideManualChoices: true
      })
    )

    expect(applied.selectedGroupIds).toEqual(new Set(["g1", "g2"]))
    expect(applied.keptFor(g1)).toEqual(new Set(["b"]))
    expect(applied.keptFor(g2)).toEqual(new Set(["e"]))
    expect(applied.decisionFor(g1).source).toBe("automatic")
    expect(applied.decisionFor(g2).source).toBe("automatic")
    expect(applied.reviewedGroupIds).toEqual(new Set())
    expect(applied.trashPlan([g1, g2]).mediaKeysToTrash).toEqual([
      "a",
      "c",
      "d"
    ])
  })

  it("preserves only explicit manual-empty overrides across hydration and default reapplication", () => {
    const manualSelections = session().update({
      type: "trash_all_copies",
      groupId: "g1"
    })
    const manualStored = new DuplicateReviewSession({
      groups: [g1, g2],
      mediaItems,
      selections: manualSelections
    }).serialize()
    const manualHydrated = session(hydrateSelections(manualStored))
    const manualReapplied = new DuplicateReviewSession({
      groups: [g1, g2],
      mediaItems,
      selections: applyDefaultKeepStrategyToSelections({
        groups: [g1, g2],
        mediaItems,
        selections: manualHydrated.selections,
        strategy: "largest_resolution"
      }),
      defaultStrategy: "largest_resolution"
    })
    expect(manualHydrated.decisionFor(g1).source).toBe("manual")
    expect(manualReapplied.keptFor(g1)).toEqual(new Set())
    expect(manualReapplied.decisionFor(g1).source).toBe("manual")

    const legacySnapshots: StoredDuplicateReviewSelections[] = [
      {
        selectedGroupIds: ["g1"],
        reviewedGroupIds: ["g1"],
        keptOverrides: { g1: [] }
      },
      {
        selectedGroupIds: ["g1"],
        reviewedGroupIds: ["g1"],
        keptOverrides: { g1: [] },
        keepDecisionProvenance: { g1: { source: "legacy_preserved" } }
      }
    ]

    for (const legacySnapshot of legacySnapshots) {
      const legacyHydrated = session(hydrateSelections(legacySnapshot))
      expect(legacyHydrated.decisionFor(g1).source).toBe("legacy_preserved")

      const legacyReapplied = new DuplicateReviewSession({
        groups: [g1, g2],
        mediaItems,
        selections: applyDefaultKeepStrategyToSelections({
          groups: [g1, g2],
          mediaItems,
          selections: legacyHydrated.selections,
          strategy: "largest_resolution"
        }),
        defaultStrategy: "largest_resolution"
      })
      expect(legacyReapplied.keptFor(g1)).toEqual(new Set(["c"]))
      expect(legacyReapplied.decisionFor(g1)).toMatchObject({
        source: "automatic",
        strategy: "largest_resolution"
      })
    }
  })

  it("recomputes a legacy override when a new automatic strategy is applied", () => {
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
    expect(afterStrategy.keptFor(g1)).toEqual(new Set(["c"]))
    expect(afterStrategy.decisionFor(g1)).toMatchObject({
      source: "automatic",
      strategy: "largest_resolution",
      recommendation: {
        status: "recommended",
        keptMediaKeys: ["c"]
      }
    })
  })

  it("reapplies defaults across every group, preserving manual and replacing automatic or legacy choices", () => {
    const g3 = group("g3", "f", "g")
    const allGroups = [g1, g2, g3]
    const allItems = {
      ...mediaItems,
      f: item("f", { isOriginalQuality: true, resWidth: 100 }),
      g: item("g", { isOriginalQuality: false, resWidth: 900 })
    }
    const previous = {
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1", "g2", "g3"]),
      keptOverrides: {
        g1: new Set(["a"]),
        g2: new Set(["d"]),
        g3: new Set(["f"])
      },
      keepDecisionProvenance: {
        g1: { source: "manual" as const },
        g3: { source: "automatic" as const, strategy: "best_quality" as const }
      }
    }

    const largestResolution = applyDefaultKeepStrategyToSelections({
      groups: allGroups,
      mediaItems: allItems,
      selections: previous,
      strategy: "largest_resolution"
    })
    const largestSession = new DuplicateReviewSession({
      groups: allGroups,
      mediaItems: allItems,
      selections: largestResolution,
      defaultStrategy: "largest_resolution"
    })

    expect(largestSession.keptFor(g1)).toEqual(new Set(["a"]))
    expect(largestSession.decisionFor(g1).source).toBe("manual")
    expect(largestSession.keptFor(g2)).toEqual(new Set(["e"]))
    expect(largestSession.decisionFor(g2).source).toBe("automatic")
    expect(largestSession.keptFor(g3)).toEqual(new Set(["g"]))
    expect(largestSession.decisionFor(g3).strategy).toBe("largest_resolution")

    const stored = largestSession.serialize()
    const hydrated = {
      selectedGroupIds: new Set(stored.selectedGroupIds),
      reviewedGroupIds: new Set(stored.reviewedGroupIds),
      keptOverrides: Object.fromEntries(
        Object.entries(stored.keptOverrides).map(([id, keys]) => [id, new Set(keys)])
      ),
      keepDecisionProvenance: stored.keepDecisionProvenance
    }
    const bestQuality = applyDefaultKeepStrategyToSelections({
      groups: allGroups,
      mediaItems: allItems,
      selections: hydrated,
      strategy: "best_quality"
    })
    const bestQualitySession = new DuplicateReviewSession({
      groups: allGroups,
      mediaItems: allItems,
      selections: bestQuality,
      defaultStrategy: "best_quality"
    })

    expect(bestQualitySession.keptFor(g1)).toEqual(new Set(["a"]))
    expect(bestQualitySession.decisionFor(g1).source).toBe("manual")
    expect(bestQualitySession.keptFor(g2)).toEqual(new Set(["e"]))
    expect(bestQualitySession.keptFor(g3)).toEqual(new Set(["f"]))
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
    expect(next.reviewedGroupIds).toEqual(new Set())
    expect(next.keptFor(g1)).toEqual(new Set(["c"]))
    expect(next.keptFor(g2)).toEqual(new Set(["e"]))
    expect(next.selections.keepDecisionProvenance?.g2).toBeUndefined()
  })

  it("does not mark automatically selected keeper sets as reviewed after hydration", () => {
    const restored = session({
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(),
      keptOverrides: { g1: new Set(["c"]) },
      keepDecisionProvenance: {
        g1: { source: "automatic", strategy: "largest_resolution" }
      }
    })

    expect(restored.selectedGroupIds).toEqual(new Set(["g1"]))
    expect(restored.reviewedGroupIds).toEqual(new Set())
    expect(restored.keptFor(g1)).toEqual(new Set(["c"]))
    expect(restored.trashPlan([g1]).mediaKeysToTrash).toEqual(["a", "b"])
  })
})
