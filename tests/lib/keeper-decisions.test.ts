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
  it("fails closed for missing members while keeping normal Best Quality behavior", () => {
    const incompleteGroup = group(
      "incomplete",
      "0-missing",
      "b-visible",
      "z-visible"
    )
    const completeGroup = group("complete", "a-best", "z-copy")
    const groups = [incompleteGroup, completeGroup]
    const items = {
      "b-visible": item("b-visible", {
        isOriginalQuality: null,
        resWidth: undefined,
        resHeight: undefined
      }),
      "z-visible": item("z-visible", {
        isOriginalQuality: null,
        resWidth: undefined,
        resHeight: undefined
      }),
      "a-best": item("a-best", { isOriginalQuality: true }),
      "z-copy": item("z-copy", { isOriginalQuality: false })
    }
    const initial = new DuplicateReviewSession({ groups, mediaItems: items })
    const selected = initial.update({
      type: "select_groups",
      groupIds: groups.map(({ id }) => id)
    })
    const restored = new DuplicateReviewSession({
      groups,
      mediaItems: items,
      selections: selected
    })

    expect(restored.decisionFor(incompleteGroup).recommendation).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "missing_member",
      keptMediaKeys: ["b-visible", "z-visible"]
    })
    expect(restored.keptFor(incompleteGroup)).toEqual(
      new Set(["b-visible", "z-visible"])
    )
    expect(restored.decisionFor(completeGroup).recommendation).toMatchObject({
      status: "recommended",
      reasonCode: "unique_best_value",
      keptMediaKeys: ["a-best"]
    })
    expect(restored.keptFor(completeGroup)).toEqual(new Set(["a-best"]))
    expect(restored.trashPlan().mediaKeysToTrash).toEqual(["z-copy"])

    const malformedSnapshot = new DuplicateReviewSession({
      groups: [incompleteGroup],
      mediaItems: items,
      selections: {
        selectedGroupIds: new Set([incompleteGroup.id]),
        reviewedGroupIds: new Set([incompleteGroup.id]),
        keptOverrides: {
          [incompleteGroup.id]: new Set(["0-missing"])
        },
        keepDecisionProvenance: {
          [incompleteGroup.id]: { source: "manual" }
        }
      }
    })
    expect(malformedSnapshot.keptFor(incompleteGroup)).toEqual(
      new Set(["b-visible", "z-visible"])
    )
    expect(malformedSnapshot.trashPlan().mediaKeysToTrash).toEqual([])

    const incompleteTrashAll = new DuplicateReviewSession({
      groups: [incompleteGroup],
      mediaItems: items,
      selections: {
        selectedGroupIds: new Set([incompleteGroup.id]),
        reviewedGroupIds: new Set([incompleteGroup.id]),
        keptOverrides: { [incompleteGroup.id]: new Set() },
        keepDecisionProvenance: {
          [incompleteGroup.id]: { source: "manual" }
        }
      }
    })
    expect(incompleteTrashAll.trashPlan()).toMatchObject({
      mediaKeysToTrash: [],
      blockedMediaKeys: ["b-visible", "z-visible"],
      blockedGroupIds: [incompleteGroup.id]
    })
  })

  it.each([
    {
      label: "a mis-keyed record",
      invalidRecord: item("different-key", { isOriginalQuality: true })
    },
    {
      label: "a record without a dedup key",
      invalidRecord: {
        ...item("unusable", { isOriginalQuality: true }),
        dedupKey: undefined
      } as unknown as GpdMediaItem
    },
    {
      label: "a record with a blank dedup key",
      invalidRecord: item("unusable", {
        dedupKey: " \t",
        isOriginalQuality: true
      })
    },
    {
      label: "a truthy non-object value",
      invalidRecord: "corrupt-record" as unknown as GpdMediaItem
    },
    {
      label: "an explicit null record",
      invalidRecord: null as unknown as GpdMediaItem
    }
  ])("fails closed for $label in review selection and Trash planning", ({ invalidRecord }) => {
    const incompleteGroup = group(
      "unusable-member",
      "unusable",
      "keep",
      "trash"
    )
    const items = {
      unusable: invalidRecord,
      keep: item("keep", { isOriginalQuality: false }),
      trash: item("trash", { isOriginalQuality: false })
    } as unknown as Record<string, GpdMediaItem>
    const automatic = new DuplicateReviewSession({
      groups: [incompleteGroup],
      mediaItems: items
    })

    expect(automatic.decisionFor(incompleteGroup).recommendation).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "missing_member",
      evidence: {
        comparedMediaKeys: ["keep", "trash"],
        missingMediaKeys: ["unusable"]
      }
    })
    expect(automatic.keptFor(incompleteGroup)).toEqual(
      new Set(["keep", "trash"])
    )
    expect(
      automatic.update({
        type: "toggle_kept",
        groupId: incompleteGroup.id,
        mediaKey: "unusable"
      }).keptOverrides[incompleteGroup.id]
    ).toBeUndefined()

    const malformedOverride = new DuplicateReviewSession({
      groups: [incompleteGroup],
      mediaItems: items,
      selections: {
        selectedGroupIds: new Set([incompleteGroup.id]),
        reviewedGroupIds: new Set([incompleteGroup.id]),
        keptOverrides: {
          [incompleteGroup.id]: new Set(["unusable"])
        },
        keepDecisionProvenance: {
          [incompleteGroup.id]: { source: "manual" }
        }
      }
    })
    expect(malformedOverride.keptFor(incompleteGroup)).toEqual(
      new Set(["keep", "trash"])
    )
    expect(
      malformedOverride.selections.keepDecisionProvenance?.[
        incompleteGroup.id
      ]?.source
    ).toBe("stale_fallback")

    const reviewedWithKeeper = new DuplicateReviewSession({
      groups: [incompleteGroup],
      mediaItems: items,
      selections: {
        selectedGroupIds: new Set([incompleteGroup.id]),
        reviewedGroupIds: new Set([incompleteGroup.id]),
        keptOverrides: {
          [incompleteGroup.id]: new Set(["keep"])
        },
        keepDecisionProvenance: {
          [incompleteGroup.id]: { source: "manual" }
        }
      }
    })
    expect(reviewedWithKeeper.trashPlan()).toMatchObject({
      mediaKeysToTrash: [],
      blockedMediaKeys: expect.arrayContaining(["trash"]),
      blockedGroupIds: [incompleteGroup.id]
    })

    const provenanceOnlyFallback = new DuplicateReviewSession({
      groups: [incompleteGroup],
      mediaItems: items,
      selections: {
        selectedGroupIds: new Set([incompleteGroup.id]),
        reviewedGroupIds: new Set([incompleteGroup.id]),
        keptOverrides: {},
        keepDecisionProvenance: {
          [incompleteGroup.id]: { source: "stale_fallback" }
        }
      }
    })
    expect(provenanceOnlyFallback.keptFor(incompleteGroup)).toEqual(
      new Set(["keep", "trash"])
    )
    expect(provenanceOnlyFallback.trashPlan().mediaKeysToTrash).toEqual([])
  })

  it.each([
    { label: "a missing id", id: undefined },
    { label: "a whitespace-only id", id: " \t" }
  ])("excludes a group with $label from selection and Trash planning", ({ id }) => {
    const invalidGroup = {
      ...group("placeholder", "orphan-keep", "orphan-trash"),
      id
    } as unknown as DuplicateGroup
    const selections = {
      selectedGroupIds: new Set([id as unknown as string]),
      reviewedGroupIds: new Set([id as unknown as string]),
      keptOverrides: {},
      keepDecisionProvenance: {}
    }
    const review = new DuplicateReviewSession({
      groups: [invalidGroup],
      mediaItems: {
        "orphan-keep": item("orphan-keep", { isOriginalQuality: true }),
        "orphan-trash": item("orphan-trash", { isOriginalQuality: false })
      },
      selections
    })

    expect(review.selectedGroupIds).toEqual(new Set())
    expect(review.trashPlan().mediaKeysToTrash).toEqual([])
  })

  it("excludes every group in a duplicate group-id collision", () => {
    const first = group("collision", "first-keep", "first-trash")
    const second = group("collision", "second-keep", "second-trash")
    const review = new DuplicateReviewSession({
      groups: [first, second],
      mediaItems: {
        "first-keep": item("first-keep", { isOriginalQuality: true }),
        "first-trash": item("first-trash", { isOriginalQuality: false }),
        "second-keep": item("second-keep", { isOriginalQuality: true }),
        "second-trash": item("second-trash", { isOriginalQuality: false })
      },
      selections: {
        selectedGroupIds: new Set(["collision"]),
        reviewedGroupIds: new Set(["collision"]),
        keptOverrides: { collision: new Set(["first-keep"]) },
        keepDecisionProvenance: { collision: { source: "manual" } }
      }
    })

    expect(review.selectedGroupIds).toEqual(new Set())
    expect(review.trashPlan().mediaKeysToTrash).toEqual([])
  })

  it.each([
    {
      label: "blank member keys",
      memberKeys: ["member-keep", " \t", "member-trash"]
    },
    {
      label: "non-string member keys",
      memberKeys: ["member-keep", 7, "member-trash"]
    },
    {
      label: "duplicate member keys",
      memberKeys: ["member-keep", "member-trash", "member-trash"]
    }
  ])("excludes groups with $label", ({ memberKeys }) => {
    const invalidGroup = {
      ...group("invalid-members", "member-keep", "member-trash"),
      mediaKeys: [...memberKeys]
    } as unknown as DuplicateGroup
    const validGroup = group("valid-members", "valid-keep", "valid-trash")
    const review = new DuplicateReviewSession({
      groups: [invalidGroup, validGroup],
      mediaItems: {
        "member-keep": item("member-keep", { isOriginalQuality: true }),
        "member-trash": item("member-trash", { isOriginalQuality: false }),
        "valid-keep": item("valid-keep", { isOriginalQuality: true }),
        "valid-trash": item("valid-trash", { isOriginalQuality: false })
      },
      selections: {
        selectedGroupIds: new Set(["invalid-members", "valid-members"]),
        reviewedGroupIds: new Set(["invalid-members", "valid-members"]),
        keptOverrides: {
          "invalid-members": new Set(["member-keep"]),
          "valid-members": new Set(["valid-keep"])
        },
        keepDecisionProvenance: {
          "invalid-members": { source: "manual" },
          "valid-members": { source: "manual" }
        }
      }
    })

    expect(review.selectedGroupIds).toEqual(new Set(["valid-members"]))
    expect(review.trashPlan().mediaKeysToTrash).toEqual(["valid-trash"])
    expect(review.trashPlan().blockedGroupIds).toEqual([])
  })

  it("does not propose a shared provider identity from one group while another group keeps it", () => {
    const firstGroup = group("shared-first", "keep-first", "trash-shared")
    const secondGroup = group("shared-second", "keep-shared", "trash-second")
    const items = {
      "keep-first": item("keep-first", { isOriginalQuality: true }),
      "trash-shared": item("trash-shared", {
        dedupKey: "provider-shared-identity",
        isOriginalQuality: false
      }),
      "keep-shared": item("keep-shared", {
        dedupKey: "provider-shared-identity",
        isOriginalQuality: true
      }),
      "trash-second": item("trash-second", { isOriginalQuality: false })
    }
    const review = new DuplicateReviewSession({
      groups: [firstGroup, secondGroup],
      mediaItems: items,
      selections: {
        selectedGroupIds: new Set([firstGroup.id, secondGroup.id]),
        reviewedGroupIds: new Set([firstGroup.id, secondGroup.id]),
        keptOverrides: {
          [firstGroup.id]: new Set(["keep-first"]),
          [secondGroup.id]: new Set(["keep-shared"])
        }
      }
    })

    expect(review.trashPlan()).toMatchObject({
      dedupKeys: ["dedup-trash-second"],
      mediaKeysToTrash: ["trash-second"],
      blockedMediaKeys: ["trash-shared"],
      blockedGroupIds: [firstGroup.id]
    })
  })

  it("excludes singleton groups with a persisted empty keeper override", () => {
    const singletonGroup = group("singleton", "only-member")
    const review = new DuplicateReviewSession({
      groups: [singletonGroup],
      mediaItems: {
        "only-member": item("only-member", { isOriginalQuality: true })
      },
      selections: {
        selectedGroupIds: new Set(["singleton"]),
        reviewedGroupIds: new Set(["singleton"]),
        keptOverrides: { singleton: new Set() },
        keepDecisionProvenance: { singleton: { source: "manual" } }
      }
    })

    expect(review.selectedGroupIds).toEqual(new Set())
    expect(review.trashPlan().mediaKeysToTrash).toEqual([])
    expect(review.trashPlan([singletonGroup]).mediaKeysToTrash).toEqual([])
  })

  it("excludes sparse member arrays before a persisted keeper can propose Trash", () => {
    const mediaKeys = new Array<string>(3)
    mediaKeys[1] = "sparse-keep"
    mediaKeys[2] = "sparse-trash"
    const sparseGroup = {
      ...group("sparse", "sparse-keep", "sparse-trash"),
      mediaKeys
    }
    const review = new DuplicateReviewSession({
      groups: [sparseGroup],
      mediaItems: {
        "sparse-keep": item("sparse-keep", { isOriginalQuality: true }),
        "sparse-trash": item("sparse-trash", { isOriginalQuality: false })
      },
      selections: {
        selectedGroupIds: new Set(["sparse"]),
        reviewedGroupIds: new Set(["sparse"]),
        keptOverrides: { sparse: new Set(["sparse-keep"]) },
        keepDecisionProvenance: { sparse: { source: "manual" } }
      }
    })

    expect(review.selectedGroupIds).toEqual(new Set())
    expect(review.trashPlan().mediaKeysToTrash).toEqual([])
  })

  it.each([
    { label: "missing", similarity: undefined, omitted: true },
    { label: "NaN", similarity: Number.NaN },
    { label: "positive Infinity", similarity: Number.POSITIVE_INFINITY },
    { label: "negative Infinity", similarity: Number.NEGATIVE_INFINITY },
    { label: "below zero", similarity: -0.01 },
    { label: "above one", similarity: 1.01 }
  ])("excludes groups with $label similarity before keep/Trash state", ({
    similarity,
    omitted
  }) => {
    const invalidGroup = group(
      "invalid-similarity",
      "similarity-keep",
      "similarity-trash"
    )
    if (omitted) delete (invalidGroup as Partial<DuplicateGroup>).similarity
    else invalidGroup.similarity = similarity as number

    const review = new DuplicateReviewSession({
      groups: [invalidGroup],
      mediaItems: {
        "similarity-keep": item("similarity-keep", {
          isOriginalQuality: true
        }),
        "similarity-trash": item("similarity-trash", {
          isOriginalQuality: false
        })
      },
      selections: {
        selectedGroupIds: new Set(["invalid-similarity"]),
        reviewedGroupIds: new Set(["invalid-similarity"]),
        keptOverrides: {
          "invalid-similarity": new Set(["similarity-keep"])
        },
        keepDecisionProvenance: {
          "invalid-similarity": { source: "manual" }
        }
      }
    })

    expect(review.selectedGroupIds).toEqual(new Set())
    expect(review.trashPlan().mediaKeysToTrash).toEqual([])
  })

  it("accepts similarity values at both inclusive bounds", () => {
    const zeroSimilarity = group("similarity-zero", "zero-keep", "zero-trash")
    const fullSimilarity = group("similarity-one", "one-keep", "one-trash")
    zeroSimilarity.similarity = 0
    fullSimilarity.similarity = 1
    const review = new DuplicateReviewSession({
      groups: [zeroSimilarity, fullSimilarity],
      mediaItems: {
        "zero-keep": item("zero-keep", { isOriginalQuality: true }),
        "zero-trash": item("zero-trash", { isOriginalQuality: false }),
        "one-keep": item("one-keep", { isOriginalQuality: true }),
        "one-trash": item("one-trash", { isOriginalQuality: false })
      },
      selections: {
        selectedGroupIds: new Set([zeroSimilarity.id, fullSimilarity.id]),
        reviewedGroupIds: new Set(),
        keptOverrides: {},
        keepDecisionProvenance: {}
      }
    })

    expect(review.selectedGroupIds).toEqual(
      new Set([zeroSimilarity.id, fullSimilarity.id])
    )
  })

  it("ignores non-object group entries without throwing", () => {
    const review = new DuplicateReviewSession({
      groups: [null, "truthy"] as unknown as DuplicateGroup[],
      mediaItems: {}
    })

    expect(review.selectedGroupIds).toEqual(new Set())
    expect(review.trashPlan().mediaKeysToTrash).toEqual([])
  })

  it("ignores valid groups that do not belong to this review session", () => {
    const review = new DuplicateReviewSession({
      groups: [g1],
      mediaItems,
      selections: {
        selectedGroupIds: new Set([g1.id]),
        reviewedGroupIds: new Set([g1.id]),
        keptOverrides: { [g1.id]: new Set(["b"]) },
        keepDecisionProvenance: { [g1.id]: { source: "manual" } }
      }
    })
    const foreignGroup = group("foreign", "a", "c")

    const plan = review.trashPlan([foreignGroup])

    expect(plan.mediaKeysToTrash).toEqual([])
    expect(plan.dedupKeys).toEqual([])
  })

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

  it("reopens review when an explicit strategy replaces a partially overlapping manual keeper", () => {
    const manualSelections: DuplicateReviewSelections = {
      selectedGroupIds: new Set(["g1", "g2"]),
      reviewedGroupIds: new Set(["g1", "g2"]),
      keptOverrides: {
        g1: new Set(["a", "b"]),
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

  it("retains review when an explicit strategy preserves an empty keeper set", () => {
    const unavailableGroup = group("unavailable-manual-trash", "missing-a", "missing-b")
    const manuallyReviewed = new DuplicateReviewSession({
      groups: [unavailableGroup],
      mediaItems: {},
      selections: {
        selectedGroupIds: new Set([unavailableGroup.id]),
        reviewedGroupIds: new Set([unavailableGroup.id]),
        keptOverrides: { [unavailableGroup.id]: new Set() },
        keepDecisionProvenance: {
          [unavailableGroup.id]: { source: "manual" }
        }
      }
    })

    const applied = new DuplicateReviewSession(
      {
        groups: [unavailableGroup],
        mediaItems: {},
        selections: manuallyReviewed.update({
          type: "apply_keep_strategy",
          groupIds: [unavailableGroup.id],
          strategy: "best_quality",
          overrideManualChoices: true
        })
      }
    )

    expect(applied.keptFor(unavailableGroup)).toEqual(new Set())
    expect(applied.reviewedGroupIds).toEqual(new Set([unavailableGroup.id]))
    expect(applied.trashPlan().mediaKeysToTrash).toEqual([])
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

  it("keeps every current member when all saved keeper keys are stale through default application", () => {
    const staleSnapshots: StoredDuplicateReviewSelections[] = [
      {
        version: 1,
        selectedGroupIds: ["g1"],
        reviewedGroupIds: ["g1"],
        keptOverrides: { g1: ["removed-key"] }
      },
      {
        version: 2,
        selectedGroupIds: ["g1"],
        reviewedGroupIds: ["g1"],
        keptOverrides: { g1: ["removed-key"] },
        keepDecisionProvenance: { g1: { source: "manual" } }
      }
    ]

    for (const snapshot of staleSnapshots) {
      const restored = session(hydrateSelections(snapshot))

      expect(restored.keptFor(g1)).toEqual(new Set(["a", "b", "c"]))
      expect(restored.trashPlan().mediaKeysToTrash).toEqual([])

      const afterDefault = session(
        applyDefaultKeepStrategyToSelections({
          groups: [g1, g2],
          mediaItems,
          selections: restored.selections,
          strategy: "best_quality"
        })
      )
      expect(afterDefault.keptFor(g1)).toEqual(new Set(["a", "b", "c"]))
      expect(afterDefault.trashPlan().mediaKeysToTrash).toEqual([])
      expect(afterDefault.serialize()).toMatchObject({
        keptOverrides: { g1: ["a", "b", "c"] },
        keepDecisionProvenance: { g1: { source: "stale_fallback" } }
      })

      const explicitStrategy = session(
        restored.update({
          type: "apply_keep_strategy",
          groupIds: ["g1"],
          strategy: "best_quality",
          overrideManualChoices: true
        })
      )
      expect(explicitStrategy.keptFor(g1)).toEqual(new Set(["b"]))
      expect(explicitStrategy.decisionFor(g1).source).toBe("automatic")
    }
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

  it("does not include a group named like the mutation sentinel when includeGroupIds is omitted", () => {
    const sentinelGroup = group("Stryker was here", "x", "y")
    const review = new DuplicateReviewSession({
      groups: [sentinelGroup],
      mediaItems: { x: item("x"), y: item("y") }
    })

    const updated = new DuplicateReviewSession({
      groups: [sentinelGroup],
      mediaItems: { x: item("x"), y: item("y") },
      selections: review.update({
        type: "apply_keep_strategy",
        groupIds: [],
        strategy: "best_quality"
      })
    })

    expect(updated.selectedGroupIds).toEqual(new Set())
    expect(updated.serialize().selectedGroupIds).toEqual([])
  })

  it("ignores unknown group IDs in an explicit bulk include list", () => {
    const updated = session().update({
      type: "apply_keep_strategy",
      groupIds: [],
      includeGroupIds: ["missing-group"],
      strategy: "best_quality"
    })

    expect(updated.selectedGroupIds.has("missing-group")).toBe(false)
    expect(updated.reviewedGroupIds.has("missing-group")).toBe(false)
    expect(updated.keptOverrides["missing-group"]).toBeUndefined()
  })

  it("recomputes an automatic keep-all override when a different strategy is applied", () => {
    const previous = session({
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1"]),
      keptOverrides: { g1: new Set(["a", "b", "c"]) },
      keepDecisionProvenance: {
        g1: { source: "automatic", strategy: "best_quality" }
      }
    })

    const updated = session(
      previous.update({
        type: "apply_keep_strategy",
        groupIds: ["g1"],
        strategy: "largest_resolution"
      })
    )

    expect(updated.keptFor(g1)).toEqual(new Set(["c"]))
    expect(updated.decisionFor(g1)).toMatchObject({
      source: "automatic",
      strategy: "largest_resolution"
    })
  })

  it("serializes a stale keeper-key fallback with distinct provenance immediately", () => {
    const restored = session({
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1"]),
      keptOverrides: { g1: new Set(["removed-key"]) },
      keepDecisionProvenance: { g1: { source: "manual" } }
    })

    expect(restored.serialize()).toMatchObject({
      version: 2,
      keptOverrides: { g1: ["a", "b", "c"] },
      keepDecisionProvenance: { g1: { source: "stale_fallback" } }
    })
  })

  it("isolates mutations to public selection snapshots from update and serialization", () => {
    const restored = session({
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1"]),
      keptOverrides: { g1: new Set(["removed-key"]) },
      keepDecisionProvenance: { g1: { source: "manual" } }
    })
    const exposed = restored.selections
    exposed.selectedGroupIds.clear()
    exposed.keptOverrides.g1?.clear()
    restored.selectedGroupIds.clear()
    restored.selectedGroupIds.add("g2")
    restored.reviewedGroupIds.clear()
    restored.reviewedGroupIds.add("g2")
    if (exposed.keepDecisionProvenance?.g1) {
      exposed.keepDecisionProvenance.g1.source = "automatic"
    }

    expect(restored.serialize()).toMatchObject({
      selectedGroupIds: ["g1"],
      reviewedGroupIds: ["g1"],
      keptOverrides: { g1: ["a", "b", "c"] },
      keepDecisionProvenance: { g1: { source: "stale_fallback" } }
    })
    const afterDefault = session(
      restored.update({
        type: "apply_keep_strategy",
        groupIds: ["g1"],
        strategy: "best_quality"
      })
    )
    expect(afterDefault.keptFor(g1)).toEqual(new Set(["a", "b", "c"]))
    expect(afterDefault.decisionFor(g1).source).toBe("stale_fallback")
  })

  it("recomputes a valid legacy keep-all choice under the selected default strategy", () => {
    const legacy = session({
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1"]),
      keptOverrides: { g1: new Set(["a", "b", "c"]) },
      keepDecisionProvenance: { g1: { source: "legacy_preserved" } }
    })

    const updated = session(
      legacy.update({
        type: "apply_keep_strategy",
        groupIds: ["g1"],
        strategy: "largest_resolution"
      })
    )

    expect(updated.keptFor(g1)).toEqual(new Set(["c"]))
    expect(updated.decisionFor(g1)).toMatchObject({
      source: "automatic",
      strategy: "largest_resolution"
    })
    expect(updated.trashPlan([g1]).mediaKeysToTrash).toEqual(["a", "b"])
  })

  it("recomputes a legacy empty override for a nonempty group under the default strategy", () => {
    const legacy = new DuplicateReviewSession({
      groups: [g1],
      mediaItems,
      selections: {
        selectedGroupIds: new Set(["g1"]),
        reviewedGroupIds: new Set(["g1"]),
        keptOverrides: { g1: new Set<string>() },
        keepDecisionProvenance: { g1: { source: "legacy_preserved" } }
      }
    })

    const updated = new DuplicateReviewSession({
      groups: [g1],
      mediaItems,
      selections: legacy.update({
        type: "apply_keep_strategy",
        groupIds: ["g1"],
        strategy: "best_quality"
      })
    })

    expect(updated.keptFor(g1)).toEqual(new Set(["b"]))
    expect(updated.reviewedGroupIds).toEqual(new Set())
    expect(updated.trashPlan([g1]).mediaKeysToTrash).toEqual(["a", "c"])
  })

  it("recomputes a still-valid legacy keeper when a strategy is applied", () => {
    const legacy = new DuplicateReviewSession({
      groups: [g1],
      mediaItems,
      selections: {
        selectedGroupIds: new Set(["g1"]),
        reviewedGroupIds: new Set(["g1"]),
        keptOverrides: { g1: new Set(["a"]) },
        keepDecisionProvenance: { g1: { source: "legacy_preserved" } }
      }
    })

    const updated = new DuplicateReviewSession({
      groups: [g1],
      mediaItems,
      selections: legacy.update({
        type: "apply_keep_strategy",
        groupIds: ["g1"],
        strategy: "best_quality"
      })
    })

    expect(updated.keptFor(g1)).toEqual(new Set(["b"]))
    expect(updated.decisionFor(g1).source).toBe("automatic")
  })

  it("excludes empty groups before restoring persisted review state", () => {
    const emptyGroup = group("empty")
    const initial = new DuplicateReviewSession({
      groups: [emptyGroup],
      mediaItems: {},
      selections: {
        selectedGroupIds: new Set(["empty"]),
        reviewedGroupIds: new Set(["empty"]),
        keptOverrides: { empty: new Set() },
        keepDecisionProvenance: { empty: { source: "legacy_preserved" } }
      }
    })

    const updated = new DuplicateReviewSession({
      groups: [emptyGroup],
      mediaItems: {},
      selections: initial.update({
        type: "apply_keep_strategy",
        groupIds: ["empty"],
        strategy: "best_quality"
      })
    })

    expect(updated.selectedGroupIds).toEqual(new Set())
    expect(updated.reviewedGroupIds).toEqual(new Set())
    expect(updated.keptByGroupId.has("empty")).toBe(false)
    expect(updated.trashPlan([emptyGroup]).mediaKeysToTrash).toEqual([])
  })

  it("excludes empty groups from keeper, review, and Trash state", () => {
    const emptyGroup = group("empty")
    const initial = new DuplicateReviewSession({
      groups: [emptyGroup],
      mediaItems: {},
      selections: {
        selectedGroupIds: new Set(["empty"]),
        reviewedGroupIds: new Set(["empty"]),
        keptOverrides: {}
      }
    })
    const updated = new DuplicateReviewSession({
      groups: [emptyGroup],
      mediaItems: {},
      selections: initial.update({
        type: "apply_keep_strategy",
        groupIds: ["empty"],
        strategy: "best_quality"
      })
    })

    expect(updated.selectedGroupIds).toEqual(new Set())
    expect(updated.reviewedGroupIds).toEqual(new Set())
    expect(updated.keptByGroupId.has("empty")).toBe(false)
    expect(updated.trashPlan([emptyGroup]).mediaKeysToTrash).toEqual([])

    const automatic = new DuplicateReviewSession({
      groups: [emptyGroup],
      mediaItems: {},
      selections: {
        selectedGroupIds: new Set(["empty"]),
        reviewedGroupIds: new Set(["empty"]),
        keptOverrides: { empty: new Set() },
        keepDecisionProvenance: {
          empty: { source: "automatic", strategy: "best_quality" }
        }
      }
    })
    const reapplied = new DuplicateReviewSession({
      groups: [emptyGroup],
      mediaItems: {},
      selections: automatic.update({
        type: "apply_keep_strategy",
        groupIds: ["empty"],
        strategy: "largest_resolution"
      })
    })

    expect(reapplied.selectedGroupIds).toEqual(new Set())
    expect(reapplied.reviewedGroupIds).toEqual(new Set())
    expect(reapplied.keepDecisionByGroupId.has("empty")).toBe(false)
  })

  it("recomputes nonempty groups with an empty legacy keeper override", () => {
    const initial = session({
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1"]),
      keptOverrides: { g1: new Set() }
    })

    expect(initial.decisionFor(g1).source).toBe("legacy_preserved")
    const updated = session(
      initial.update({
        type: "apply_keep_strategy",
        groupIds: ["g1"],
        strategy: "best_quality"
      })
    )

    expect(updated.keptFor(g1)).toEqual(new Set(["b"]))
    expect(updated.reviewedGroupIds).toEqual(new Set())
    expect(updated.decisionFor(g1).source).toBe("automatic")
    expect(updated.trashPlan([g1]).mediaKeysToTrash).toEqual(["a", "c"])
  })

  it("treats a malformed kept-override root as absent saved state", () => {
    const review = new DuplicateReviewSession({
      groups: [g1],
      mediaItems,
      selections: {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set(),
        keptOverrides: null
      } as unknown as DuplicateReviewSelections
    })

    expect(review.keptFor(g1)).toEqual(new Set(["b"]))
    expect(review.selections.keptOverrides).toEqual({})

    const numericGroup = group("0", "a", "b")
    const arrayRoot = new DuplicateReviewSession({
      groups: [numericGroup],
      mediaItems,
      selections: {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set(),
        keptOverrides: [[]]
      } as unknown as DuplicateReviewSelections
    })
    expect(arrayRoot.keptFor(numericGroup)).toEqual(new Set(["b"]))
    expect(arrayRoot.selections.keptOverrides).toEqual({})

    const stringGroup = group("0", "s", "t")
    const stringRoot = new DuplicateReviewSession({
      groups: [stringGroup],
      mediaItems: {
        s: item("s", { isOriginalQuality: false }),
        t: item("t", { isOriginalQuality: true })
      },
      selections: {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set(),
        keptOverrides: "s"
      } as unknown as DuplicateReviewSelections
    })
    expect(stringRoot.keptFor(stringGroup)).toEqual(new Set(["t"]))
    expect(stringRoot.selections.keptOverrides).toEqual({})
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
