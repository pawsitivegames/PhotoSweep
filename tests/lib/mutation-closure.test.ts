import { beforeAll, describe, expect, it, vi } from "vitest"

import {
  DuplicateReviewSession,
  type DuplicateReviewSelections
} from "../../lib/duplicate-review-session"
import {
  KEEP_STRATEGY_LABELS,
  chooseKeepItem,
  chooseKeepKeyForGroup,
  describeKeepRecommendation,
  isKeepStrategy,
  recommendKeepForGroup,
  selectDefaultKeep,
  type KeepStrategy
} from "../../lib/keep-strategy"
import {
  REVIEW_PREFLIGHT_MAX_AGE_MS,
  accountFingerprint,
  buildScanScopeFingerprint,
  evaluateRecoveryRestorePreflight,
  evaluateReviewPreflight
} from "../../lib/review-preflight"
import {
  captureTrashDispatchAuthorization,
  isTrashDispatchAuthorizationCurrent,
  trashPlanFingerprint
} from "../../lib/trash-dispatch-guard"
import {
  TrashLifecycle,
  type TrashAuditAdapter,
  type TrashAuditContext,
  type TrashUndoData
} from "../../lib/trash-lifecycle"
import type { DuplicateGroup, GpdMediaItem } from "../../lib/types"
import { DEFAULT_SETTINGS } from "../../lib/types"

function item(
  mediaKey: string,
  overrides: Partial<GpdMediaItem> = {}
): GpdMediaItem {
  return {
    mediaKey,
    dedupKey: `dedup-${mediaKey}`,
    thumb: `thumb-${mediaKey}`,
    timestamp: 1_000,
    creationTimestamp: 2_000,
    isOriginalQuality: null,
    resWidth: 1_000,
    resHeight: 1_000,
    ...overrides
  }
}

function group(id: string, ...mediaKeys: string[]): DuplicateGroup {
  return {
    id,
    mediaKeys,
    originalMediaKey: mediaKeys[0] ?? "",
    similarity: 0.99
  }
}

function strategyGroup(...mediaKeys: string[]): DuplicateGroup {
  return group("strategy-group", ...mediaKeys)
}

describe("mutation closure: keep strategy", () => {
  it("keeps the strategy labels and runtime guard exact", () => {
    const expected = {
      best_quality: "Best quality",
      largest_resolution: "Largest resolution",
      newest_taken: "Newest taken date",
      oldest_taken: "Oldest taken date",
      newest_upload: "Newest upload date",
      non_storage_counting: "Non-storage-counting"
    } satisfies Record<KeepStrategy, string>

    expect(KEEP_STRATEGY_LABELS).toEqual(expected)
    for (const strategy of Object.keys(expected)) {
      expect(isKeepStrategy(strategy)).toBe(true)
    }
    for (const value of [undefined, null, 0, false, "", "unknown", "BEST_QUALITY"]) {
      expect(isKeepStrategy(value)).toBe(false)
    }
  })

  it.each([
    ["best_quality", "isOriginalQuality", { a: { isOriginalQuality: true }, b: { isOriginalQuality: false } }, "a"],
    ["largest_resolution", "resolutionPixels", { a: { resWidth: 2_000, resHeight: 2_000 }, b: { resWidth: 1_000, resHeight: 1_000 } }, "a"],
    ["newest_taken", "timestamp", { a: { timestamp: 2 }, b: { timestamp: 1 } }, "a"],
    ["oldest_taken", "timestamp", { a: { timestamp: 1 }, b: { timestamp: 2 } }, "a"],
    ["newest_upload", "creationTimestamp", { a: { creationTimestamp: 2 }, b: { creationTimestamp: 1 } }, "a"],
    ["non_storage_counting", "takesUpSpace", { a: { takesUpSpace: false }, b: { takesUpSpace: true } }, "a"]
  ] as const)("reports the independent evidence field for %s", (strategy, field, overrides, winner) => {
    const recommendation = recommendKeepForGroup(
      strategyGroup("a", "b"),
      { a: item("a", overrides.a), b: item("b", overrides.b) },
      strategy
    )

    expect(recommendation).toMatchObject({
      status: "recommended",
      strategy,
      keptMediaKeys: [winner],
      reasonCode: "unique_best_value",
      evidence: {
        field,
        comparedMediaKeys: ["a", "b"],
        missingMediaKeys: [],
        winnerMediaKey: winner
      }
    })
    if (strategy === "best_quality") {
      expect(recommendation.evidence.field).toBe("isOriginalQuality")
    }
  })

  it("keeps all items when original-quality confidence is unknown", () => {
    const recommendation = recommendKeepForGroup(
      strategyGroup("a", "b"),
      {
        a: item("a", { isOriginalQuality: null }),
        b: item("b", { isOriginalQuality: true })
      },
      "best_quality"
    )

    expect(recommendation).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "invalid_value",
      keptMediaKeys: ["a", "b"],
      evidence: { values: { a: null, b: true } }
    })
  })

  it.each([
    ["string width", { resWidth: "1000" as unknown as number, resHeight: 1_000 }],
    ["string height", { resWidth: 1_000, resHeight: "1000" as unknown as number }],
    ["infinite width", { resWidth: Number.POSITIVE_INFINITY, resHeight: 1_000 }],
    ["infinite height", { resWidth: 1_000, resHeight: Number.POSITIVE_INFINITY }],
    ["zero width", { resWidth: 0, resHeight: 1_000 }],
    ["zero height", { resWidth: 1_000, resHeight: 0 }],
    ["negative width", { resWidth: -1, resHeight: 1_000 }],
    ["negative height", { resWidth: 1_000, resHeight: -1 }],
    ["overflowing area", { resWidth: Number.MAX_VALUE, resHeight: 2 }]
  ] as const)("keeps all items when resolution has an invalid %s", (_label, invalid) => {
    const recommendation = recommendKeepForGroup(
      strategyGroup("a", "b"),
      {
        a: item("a", invalid),
        b: item("b", { resWidth: 1_000, resHeight: 1_000 })
      },
      "largest_resolution"
    )

    expect(recommendation).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "invalid_value",
      keptMediaKeys: ["a", "b"],
      evidence: { values: { a: null, b: 1_000_000 } }
    })
  })

  it("rejects a finite positive resolution whose area underflows to zero", () => {
    const recommendation = recommendKeepForGroup(
      strategyGroup("tiny", "normal"),
      {
        tiny: item("tiny", { resWidth: 1e-200, resHeight: 1e-200 }),
        normal: item("normal", { resWidth: 1, resHeight: 1 })
      },
      "largest_resolution"
    )

    expect(recommendation).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "invalid_value",
      keptMediaKeys: ["tiny", "normal"],
      evidence: { values: { tiny: null, normal: 1 } }
    })
  })

  it.each([
    ["non-number", "x" as unknown as number],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY]
  ] as const)("rejects an invalid taken timestamp (%s)", (_label, timestamp) => {
    const recommendation = recommendKeepForGroup(
      strategyGroup("a", "b"),
      { a: item("a", { timestamp }), b: item("b", { timestamp: 2 }) },
      "newest_taken"
    )
    expect(recommendation).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "invalid_value",
      keptMediaKeys: ["a", "b"],
      evidence: { values: { a: null, b: 2 } }
    })
  })

  it.each([
    ["non-number", "x" as unknown as number],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY]
  ] as const)("rejects an invalid upload timestamp (%s)", (_label, creationTimestamp) => {
    const recommendation = recommendKeepForGroup(
      strategyGroup("a", "b"),
      {
        a: item("a", { creationTimestamp }),
        b: item("b", { creationTimestamp: 2 })
      },
      "newest_upload"
    )
    expect(recommendation).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "invalid_value",
      keptMediaKeys: ["a", "b"],
      evidence: { values: { a: null, b: 2 } }
    })
  })

  it("rejects unknown storage accounting and empty groups", () => {
    const unknown = recommendKeepForGroup(
      strategyGroup("a", "b"),
      { a: item("a", { takesUpSpace: null }), b: item("b", { takesUpSpace: false }) },
      "non_storage_counting"
    )
    const empty = recommendKeepForGroup(
      strategyGroup(),
      {},
      "best_quality"
    )

    expect(unknown).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "invalid_value",
      keptMediaKeys: ["a", "b"],
      evidence: { values: { a: null, b: false } }
    })
    expect(empty).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "empty_group",
      keptMediaKeys: [],
      evidence: { comparedMediaKeys: [], missingMediaKeys: [], values: {} }
    })
  })

  it("describes both recommendation states with user-visible text", () => {
    const recommended = recommendKeepForGroup(
      strategyGroup("a", "b"),
      { a: item("a", { timestamp: 2 }), b: item("b", { timestamp: 1 }) },
      "newest_taken"
    )
    const uncertain = recommendKeepForGroup(
      strategyGroup("a", "b"),
      { a: item("a"), b: item("b") },
      "best_quality"
    )

    expect(describeKeepRecommendation(recommended)).toBe(
      "Suggested keep: Newest taken date"
    )
    expect(describeKeepRecommendation(uncertain)).toBe(
      "No confident recommendation — keeping all copies"
    )
  })

  it("returns an item only for a confident recommendation and preserves the item identity", () => {
    const a = item("a", { isOriginalQuality: true })
    const b = item("b", { isOriginalQuality: false })
    expect(chooseKeepItem([a, b], "best_quality")).toBe(a)
    expect(chooseKeepItem([a, { ...b, isOriginalQuality: true }], "best_quality")).toBeNull()
    expect(chooseKeepItem([], "best_quality")).toBeNull()
    expect(
      chooseKeepKeyForGroup(strategyGroup("a", "b"), { a, b }, "best_quality")
    ).toBe("a")
    expect(
      chooseKeepKeyForGroup(
        strategyGroup("a", "b"),
        { a: { ...a, isOriginalQuality: true }, b: { ...b, isOriginalQuality: true } },
        "best_quality"
      )
    ).toBeNull()
  })

  it("uses the legacy default only as the explicit selectDefaultKeep fallback", () => {
    const older = item("older", {
      isOriginalQuality: true,
      timestamp: 1,
      resWidth: 1_000,
      resHeight: 1_000
    })
    const newer = item("newer", {
      isOriginalQuality: true,
      timestamp: 2,
      resWidth: 2_000,
      resHeight: 2_000
    })
    expect(selectDefaultKeep([older, newer])).toBe("older")
    const missingTimestamp = item("missing", {
      isOriginalQuality: true,
      timestamp: undefined
    })
    const finiteTimestamp = item("finite", {
      isOriginalQuality: true,
      timestamp: 10
    })
    expect(selectDefaultKeep([missingTimestamp, finiteTimestamp])).toBe("finite")
    expect(selectDefaultKeep([finiteTimestamp, missingTimestamp])).toBe("finite")
    expect(() => selectDefaultKeep([])).toThrow(
      "Cannot select a keep item from an empty group"
    )
  })
})

function reviewSessionFixture() {
  const groups = [group("g1", "a", "b", "c"), group("g2", "d", "e")]
  const mediaItems: Record<string, GpdMediaItem> = {
    a: item("a", { isOriginalQuality: false, resWidth: 100 }),
    b: item("b", { isOriginalQuality: true, resWidth: 200 }),
    c: item("c", { isOriginalQuality: false, resWidth: 300 }),
    d: item("d", { isOriginalQuality: false, resWidth: 100 }),
    e: item("e", { isOriginalQuality: true, resWidth: 200 })
  }
  const session = (selections?: DuplicateReviewSelections) =>
    new DuplicateReviewSession({ groups, mediaItems, selections })
  return { groups, mediaItems, session }
}

describe("mutation closure: duplicate review session", () => {
  it("handles unknown actions and replace/clear through the public update seam", () => {
    const { groups, session } = reviewSessionFixture()
    const initial = session()
    expect(initial.keptByGroupId.get("g1")).toEqual(new Set(["b"]))
    expect(initial.keepDecisionByGroupId.get("g1")?.keptMediaKeys).toEqual(
      new Set(["b"])
    )
    expect(
      initial.update({ type: "select_groups", groupIds: ["missing", "g1"] })
    ).toMatchObject({
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1"])
    })

    const deselected = initial.update({
      type: "deselect_groups",
      groupIds: ["missing", "g1"]
    })
    expect(deselected).toMatchObject({
      selectedGroupIds: new Set(),
      reviewedGroupIds: new Set(["g1"])
    })
    const skipped = session(deselected)
    expect(skipped.selectedGroupIds).toEqual(new Set())
    expect(skipped.reviewedGroupIds).toEqual(new Set(["g1"]))

    const replaced = initial.update({
      type: "replace",
      selections: {
        selectedGroupIds: new Set(["g2", "missing"]),
        reviewedGroupIds: new Set(["g2"]),
        keptOverrides: { g2: new Set(["d"]) }
      }
    })
    expect(replaced.selectedGroupIds).toEqual(new Set(["g2"]))
    expect(replaced.reviewedGroupIds).toEqual(new Set(["g2"]))

    const cleared = new DuplicateReviewSession({
      groups,
      mediaItems: reviewSessionFixture().mediaItems,
      selections: replaced
    }).update({ type: "clear" })
    expect(cleared).toEqual({
      selectedGroupIds: new Set(),
      reviewedGroupIds: new Set(),
      keptOverrides: {},
      keepDecisionProvenance: {}
    })
  })

  it("ignores invalid toggle and trash-all targets while handling the last-keeper guard", () => {
    const { groups, mediaItems, session } = reviewSessionFixture()
    const initial = session()
    expect(
      initial.update({ type: "toggle_kept", groupId: "missing", mediaKey: "a" })
    ).toEqual(initial.selections)
    expect(
      initial.update({ type: "toggle_kept", groupId: "g1", mediaKey: "missing" })
    ).toEqual(initial.selections)

    const oneKept = session({
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1"]),
      keptOverrides: { g1: new Set(["a"]) }
    })
    const last = oneKept.update({
      type: "toggle_kept",
      groupId: "g1",
      mediaKey: "a"
    })
    expect(last.keptOverrides.g1).toEqual(new Set(["a"]))
    expect(last.keepDecisionProvenance?.g1).toEqual({ source: "manual" })

    expect(
      initial.update({ type: "trash_all_copies", groupId: "missing" })
    ).toEqual(initial.selections)

    const trashAll = initial.update({
      type: "trash_all_copies",
      groupId: "g1"
    })
    expect(trashAll).toMatchObject({
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1"]),
      keptOverrides: { g1: new Set() },
      keepDecisionProvenance: { g1: { source: "manual" } }
    })

    const emptyOverride = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set(),
        keptOverrides: { g1: new Set() }
      }
    })
    expect(emptyOverride.serialize().keepDecisionProvenance).toEqual({
      g1: { source: "manual" }
    })
  })

  it("skips manual and legacy decisions during bulk strategy application", () => {
    const { groups, mediaItems, session } = reviewSessionFixture()
    const initial = session({
      selectedGroupIds: new Set(["g1", "g2"]),
      reviewedGroupIds: new Set(["g1", "g2"]),
      keptOverrides: {
        g1: new Set(["a"]),
        g2: new Set(["d"])
      },
      keepDecisionProvenance: {
        g1: { source: "manual" },
        g2: { source: "legacy_preserved" }
      }
    })
    const next = initial.update({
      type: "apply_keep_strategy",
      groupIds: ["g1", "g2", "missing"],
      strategy: "largest_resolution"
    })
    expect(next.keptOverrides).toEqual({ g1: new Set(["a"]), g2: new Set(["d"]) })

    const automatic = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set(),
        keptOverrides: {}
      }
    }).update({
      type: "apply_keep_strategy",
      groupIds: ["g1"],
      strategy: "largest_resolution"
    })
    expect(automatic.keptOverrides.g1).toEqual(new Set(["c"]))
    expect(automatic.keepDecisionProvenance?.g1).toEqual({
      source: "automatic",
      strategy: "largest_resolution"
    })
  })

  it("resolves unknown groups through the public fallback methods", () => {
    const { mediaItems, session } = reviewSessionFixture()
    const review = session()
    const external = group("external", "a", "b")
    expect(review.keptFor(external)).toEqual(new Set(["b"]))
    expect(review.decisionFor(external)).toMatchObject({
      source: "automatic",
      strategy: "best_quality",
      recommendation: { keptMediaKeys: ["b"] }
    })
    expect(
      new DuplicateReviewSession({ groups: [external], mediaItems }).keptFor(external)
    ).toEqual(new Set(["b"]))
  })

  it("plans iCloud trash with exact asset references and filters missing identities", () => {
    const g = group("icloud", "keep", "trash", "noAsset", "missing")
    const mediaItems: Record<string, GpdMediaItem> = {
      keep: item("keep", { provider: "icloud", isOriginalQuality: true }),
      trash: item("trash", {
        provider: "icloud",
        isOriginalQuality: false,
        icloudAsset: {
          recordName: "record-trash",
          changeTag: "tag-1",
          zoneName: "PrimarySync",
          ownerRecordName: "owner-1"
        }
      }),
      noAsset: item("noAsset", {
        provider: "icloud",
        isOriginalQuality: false
      })
    }
    const review = new DuplicateReviewSession({
      groups: [g],
      mediaItems,
      selections: {
        selectedGroupIds: new Set([g.id]),
        reviewedGroupIds: new Set([g.id]),
        keptOverrides: { [g.id]: new Set(["keep"]) }
      }
    })
    expect(review.trashPlan()).toEqual({
      dedupKeys: ["dedup-trash", "dedup-noAsset"],
      mediaKeysToTrash: ["trash", "noAsset"],
      blockedMediaKeys: [],
      blockedGroupIds: [],
      provider: "icloud",
      icloudAssetRefs: [
        {
          recordName: "record-trash",
          changeTag: "tag-1",
          zoneName: "PrimarySync",
          ownerRecordName: "owner-1"
        }
      ]
    })
  })

  it("does not attach iCloud references to a Google trash plan", () => {
    const { session } = reviewSessionFixture()
    const review = session({
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1"]),
      keptOverrides: {}
    })
    expect(review.trashPlan()).toEqual({
      dedupKeys: ["dedup-a", "dedup-c"],
      mediaKeysToTrash: ["a", "c"],
      blockedMediaKeys: [],
      blockedGroupIds: [],
      provider: "google"
    })
  })

  it("never emits a trash identity for a non-keeper without a dedup key", () => {
    const g = group("missing-dedup", "keep", "unknown", "trash")
    const mediaItems = {
      keep: item("keep", { isOriginalQuality: true }),
      unknown: item("unknown", {
        isOriginalQuality: false,
        dedupKey: undefined as unknown as string
      }),
      trash: item("trash", { isOriginalQuality: false })
    }
    const review = new DuplicateReviewSession({
      groups: [g],
      mediaItems,
      selections: {
        selectedGroupIds: new Set([g.id]),
        reviewedGroupIds: new Set([g.id]),
        keptOverrides: { [g.id]: new Set(["keep"]) }
      }
    })

    expect(review.trashPlan()).toEqual({
      dedupKeys: ["dedup-trash"],
      mediaKeysToTrash: ["trash"],
      blockedMediaKeys: [],
      blockedGroupIds: [],
      provider: "google"
    })
  })

  it("normalizes every supported saved provenance strategy and invalid provenance", () => {
    const { groups, mediaItems } = reviewSessionFixture()
    const strategies: KeepStrategy[] = [
      "best_quality",
      "largest_resolution",
      "newest_taken",
      "oldest_taken",
      "newest_upload",
      "non_storage_counting"
    ]
    for (const strategy of strategies) {
      const review = new DuplicateReviewSession({
        groups,
        mediaItems,
        selections: {
          selectedGroupIds: new Set(["g1"]),
          reviewedGroupIds: new Set(["g1"]),
          keptOverrides: { g1: new Set(["a"]) },
          keepDecisionProvenance: { g1: { source: "automatic", strategy } }
        }
      })
      expect(review.decisionFor(groups[0])).toMatchObject({
        source: "automatic",
        strategy
      })
    }

    const automaticOverride = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set(),
        keptOverrides: { g1: new Set(["a"]) },
        keepDecisionProvenance: {
          g1: { source: "automatic", strategy: "best_quality" }
        }
      }
    })
    expect(automaticOverride.decisionFor(groups[0])).toMatchObject({
      source: "automatic",
      strategy: "best_quality"
    })
    expect(automaticOverride.decisionFor(groups[0]).keptMediaKeys).toEqual(
      new Set(["b"])
    )

    const missingProvenance = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set(),
        keptOverrides: { g1: new Set(["a"]) }
      }
    })
    expect(missingProvenance.decisionFor(groups[0])).toMatchObject({
      source: "legacy_preserved",
    })
    expect(missingProvenance.decisionFor(groups[0]).keptMediaKeys).toEqual(
      new Set(["a"])
    )

    const noStrategyAutomatic = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set(),
        keptOverrides: { g1: new Set(["a"]) },
        keepDecisionProvenance: { g1: { source: "automatic" } }
      }
    })
    expect(noStrategyAutomatic.decisionFor(groups[0]).source).toBe(
      "legacy_preserved"
    )
    expect(noStrategyAutomatic.serialize().keepDecisionProvenance).toEqual({
      g1: { source: "legacy_preserved" }
    })

    const invalid = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set(),
        keptOverrides: { g1: new Set(["a"]) },
        keepDecisionProvenance: {
          g1: { source: "invalid" as never, strategy: "invalid" as never }
        }
      }
    })
    expect(invalid.decisionFor(groups[0]).source).toBe("legacy_preserved")

    const invalidSource = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set(),
        keptOverrides: { g1: new Set(["a"]) },
        keepDecisionProvenance: {
          g1: { source: "invalid" as never, strategy: "best_quality" }
        }
      }
    })
    expect(invalidSource.decisionFor(groups[0])).toMatchObject({
      source: "legacy_preserved",
      strategy: "best_quality"
    })
    expect(invalidSource.decisionFor(groups[0]).keptMediaKeys).toEqual(
      new Set(["a"])
    )

    const invalidStrategy = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set(),
        keptOverrides: { g1: new Set(["a"]) },
        keepDecisionProvenance: {
          g1: { source: "manual", strategy: "invalid" as never }
        }
      }
    })
    expect(invalidStrategy.decisionFor(groups[0])).toMatchObject({
      source: "legacy_preserved",
      strategy: "best_quality"
    })
    expect(invalidStrategy.decisionFor(groups[0]).keptMediaKeys).toEqual(
      new Set(["a"])
    )
    expect(invalidStrategy.serialize().keepDecisionProvenance).toEqual({
      g1: { source: "legacy_preserved" }
    })

    const legacyWithStrategy = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set(),
        keptOverrides: { g1: new Set(["a"]) },
        keepDecisionProvenance: {
          g1: { source: "legacy_preserved", strategy: "largest_resolution" }
        }
      }
    })
    expect(legacyWithStrategy.decisionFor(groups[0])).toMatchObject({
      source: "legacy_preserved",
      strategy: "largest_resolution"
    })
    expect(legacyWithStrategy.serialize().keepDecisionProvenance).toEqual({
      g1: { source: "legacy_preserved", strategy: "largest_resolution" }
    })
  })

  it("resolves decisions after exposed caches and provenance are cleared", () => {
    const { groups, mediaItems, session } = reviewSessionFixture()
    const review = session({
      selectedGroupIds: new Set(),
      reviewedGroupIds: new Set(),
      keptOverrides: { g1: new Set(["a"]) }
    })

    review.keepDecisionByGroupId.delete("g1")
    review.selections.keepDecisionProvenance = undefined

    expect(review.decisionFor(groups[0])).toMatchObject({
      source: "legacy_preserved",
      keptMediaKeys: new Set(["a"]),
      recommendation: { reasonCode: "unique_best_value" }
    })
    review.keptByGroupId.delete("g1")
    expect(review.keptFor(groups[0])).toEqual(new Set(["a"]))

    // A caller can also ask for a group that is not in the original cache.
    expect(review.decisionFor(group("external", "a", "b"))).toMatchObject({
      source: "automatic",
      keptMediaKeys: new Set(["b"])
    })
    expect(mediaItems.a.mediaKey).toBe("a")
  })
})

describe("mutation closure: review preflight", () => {
  it("keeps the destructive freshness window at exactly 24 hours", () => {
    expect(REVIEW_PREFLIGHT_MAX_AGE_MS).toBe(86_400_000)
  })

  it("normalizes mixed-case identities and reports an exact allowed summary", () => {
    const result = evaluateReviewPreflight({
      scanProvider: undefined,
      currentProvider: undefined,
      scanAccountEmail: " Buyer@Example.com ",
      currentAccountEmail: "buyer@example.com",
      scanDate: 10,
      now: 10,
      scanScopeFingerprint: "same",
      currentScopeFingerprint: "same",
      selectedCount: 1,
      connectionValidated: true,
      requireFreshScan: true,
      requireKnownScope: true
    })
    expect(result).toEqual({
      allowed: true,
      accountStatus: "verified",
      freshness: "fresh",
      scopeStatus: "matched",
      summary: "google · 1 selected · account verified · scope matched",
      reasons: []
    })
  })

  it("distinguishes unknown scope sides and scan freshness boundaries", () => {
    expect(
      evaluateReviewPreflight({
        selectedCount: 1,
        connectionValidated: true,
        requireFreshScan: false,
        requireKnownScope: false
      })
    ).toMatchObject({
      allowed: false,
      accountStatus: "unknown",
      reasons: [
        {
          code: "account_unknown"
        }
      ]
    })
    expect(
      evaluateReviewPreflight({
        selectedCount: 1,
        connectionValidated: true,
        requireFreshScan: false,
        requireKnownScope: false,
        scanScopeFingerprint: "one-sided"
      }).scopeStatus
    ).toBe("unknown")
    expect(
      evaluateReviewPreflight({
        selectedCount: 1,
        connectionValidated: true,
        scanDate: 100,
        now: 100 + REVIEW_PREFLIGHT_MAX_AGE_MS,
        maxAgeMs: REVIEW_PREFLIGHT_MAX_AGE_MS
      }).freshness
    ).toBe("fresh")
    expect(
      evaluateReviewPreflight({
        selectedCount: 1,
        connectionValidated: true,
        scanDate: 100,
        now: 101 + REVIEW_PREFLIGHT_MAX_AGE_MS,
        maxAgeMs: REVIEW_PREFLIGHT_MAX_AGE_MS
      }).freshness
    ).toBe("stale")
    expect(
      evaluateReviewPreflight({
        selectedCount: 1,
        connectionValidated: true,
        scanDate: -10,
        now: 0,
        maxAgeMs: 100
      }).freshness
    ).toBe("fresh")
    for (const scanDate of [
      "not-a-date" as unknown as number,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY
    ]) {
      expect(
        evaluateReviewPreflight({
          selectedCount: 1,
          connectionValidated: true,
          scanDate,
          now: 100,
          requireFreshScan: true
        }).freshness
      ).toBe("unknown")
    }
    expect(
      evaluateReviewPreflight({
        selectedCount: 1,
        connectionValidated: true,
        scanDate: "not-a-date" as unknown as number,
        now: 100,
        requireFreshScan: true
      }).freshness
    ).toBe("unknown")

    expect(
      evaluateReviewPreflight({
        selectedCount: 1,
        connectionValidated: true,
        scanAccountEmail: "buyer@example.com",
        currentAccountEmail: "buyer@example.com",
        scanDate: 201,
        now: 200,
        requireFreshScan: true
      }).reasons
    ).toEqual([
      {
        code: "scan_date_unknown",
        message:
          "The scan age is unknown. Run a fresh scoped scan before changing provider state."
      }
    ])
  })

  it("blocks freshness and scope uncertainty when every other gate passes", () => {
    const validReview = {
      scanProvider: "google" as const,
      currentProvider: "google" as const,
      scanAccountEmail: "buyer@example.com",
      currentAccountEmail: "buyer@example.com",
      scanScopeFingerprint: "scope-a",
      currentScopeFingerprint: "scope-a",
      selectedCount: 1,
      connectionValidated: true,
      requireFreshScan: true,
      requireKnownScope: true
    }

    const stale = evaluateReviewPreflight({
      ...validReview,
      scanDate: 100,
      now: 100 + REVIEW_PREFLIGHT_MAX_AGE_MS + 1
    })
    expect(stale).toMatchObject({
      allowed: false,
      freshness: "stale",
      scopeStatus: "matched",
      reasons: [
        {
          code: "scan_stale",
          message:
            "These results are more than a day old. Run a fresh scoped scan before changing provider state."
        }
      ]
    })

    const unknownDate = evaluateReviewPreflight({
      ...validReview,
      scanDate: Number.NaN,
      now: 100
    })
    expect(unknownDate).toMatchObject({
      allowed: false,
      freshness: "unknown",
      scopeStatus: "matched",
      reasons: [
        {
          code: "scan_date_unknown",
          message:
            "The scan age is unknown. Run a fresh scoped scan before changing provider state."
        }
      ]
    })

    const unknownScope = evaluateReviewPreflight({
      ...validReview,
      scanDate: 100,
      now: 100,
      scanScopeFingerprint: undefined,
      currentScopeFingerprint: undefined
    })
    expect(unknownScope).toMatchObject({
      allowed: false,
      freshness: "fresh",
      scopeStatus: "unknown",
      reasons: [
        {
          code: "scope_unknown",
          message:
            "The reviewed scope cannot be proven to match the current scan settings. Run the scan again."
        }
      ]
    })
  })

  it("serializes all scope defaults explicitly and changes each scoped setting", () => {
    expect(buildScanScopeFingerprint(DEFAULT_SETTINGS)).toBe(
      '{"provider":"google","scanMode":"smart","similarityThreshold":0.95,"smartWindowSec":1,"dateRange":null,"album":null,"amazonBatchLimit":null,"icloudBatchLimit":null,"exactOnly":false}'
    )
    const variants = [
      { sourceProvider: "icloud" as const },
      { scanMode: "full" as const },
      { similarityThreshold: 0.8 },
      { smartWindowSec: 5 },
      { dateRange: { from: "2026-01-01", to: "2026-01-31" } },
      { albumScope: { mediaKey: "album-1", title: "Album" } },
      { amazonBatchLimit: 25 },
      { icloudBatchLimit: 25 },
      { exactOnly: true }
    ]
    const fingerprints = variants.map((change) =>
      buildScanScopeFingerprint({ ...DEFAULT_SETTINGS, ...change })
    )
    expect(new Set(fingerprints).size).toBe(variants.length)
    expect(fingerprints[0]).toContain('"provider":"icloud"')
    expect(fingerprints[3]).toContain('"smartWindowSec":5')
    expect(fingerprints[4]).toContain('"to":"2026-01-31"')
    expect(fingerprints[4]).toContain('"from":"2026-01-01"')
    expect(fingerprints[5]).toContain('"title":"Album"')
    expect(fingerprints[8]).toContain('"exactOnly":true')
  })

  it("keeps the weaker unavailable-identity policy limited to both identities absent", () => {
    const base = {
      scanProvider: "icloud" as const,
      currentProvider: "icloud" as const,
      selectedCount: 1,
      connectionValidated: true,
      allowUnavailableAccountIdentity: true,
      requireFreshScan: false,
      requireKnownScope: false
    }
    expect(evaluateReviewPreflight(base)).toMatchObject({
      allowed: true,
      accountStatus: "unavailable",
      reasons: [
        {
          code: "account_unknown",
          message:
            "The scan and current provider session do not expose enough account identity to prove they match."
        }
      ],
      summary: "icloud · 1 selected · account identity unavailable · scope unverified"
    })
    expect(
      evaluateReviewPreflight({ ...base, scanAccountEmail: "known@example.com" })
    ).toMatchObject({
      allowed: false,
      accountStatus: "unknown",
      summary: "icloud · 1 selected · account identity unverified · scope unverified"
    })
    expect(
      evaluateReviewPreflight({ ...base, currentAccountEmail: "known@example.com" })
    ).toMatchObject({ allowed: false, accountStatus: "unknown" })

    expect(
      evaluateReviewPreflight({
        ...base,
        selectedCount: 0
      })
    ).toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining([
        { code: "no_selection", message: "No reviewed items are selected." }
      ])
    })
  })

  it("reports every blocking reason and summary branch with exact messages", () => {
    const result = evaluateReviewPreflight({
      scanProvider: "google",
      currentProvider: "icloud",
      scanAccountEmail: "old@example.com",
      currentAccountEmail: "new@example.com",
      scanDate: 1,
      currentScopeFingerprint: "new",
      selectedCount: 0,
      connectionValidated: false,
      requireFreshScan: true,
      requireKnownScope: true,
      now: 200,
      maxAgeMs: 100
    })
    expect(result.allowed).toBe(false)
    expect(result.summary).toBe(
      "google · 0 selected · account mismatch · scope unverified"
    )
    expect(result.reasons).toEqual([
      {
        code: "connection_unverified",
        message: "The current photo-provider connection has not passed a fresh health check."
      },
      { code: "no_selection", message: "No reviewed items are selected." },
      {
        code: "provider_mismatch",
        message: "These results belong to google, but the active provider is icloud."
      },
      {
        code: "account_mismatch",
        message: "The signed-in photo-provider account changed since this scan."
      },
      {
        code: "scan_stale",
        message: "These results are more than a day old. Run a fresh scoped scan before changing provider state."
      },
      {
        code: "scope_unknown",
        message: "The reviewed scope cannot be proven to match the current scan settings. Run the scan again."
      }
    ])

    const changedScope = evaluateReviewPreflight({
      scanProvider: "google",
      currentProvider: "google",
      scanAccountEmail: "buyer@example.com",
      currentAccountEmail: "buyer@example.com",
      scanDate: 100,
      scanScopeFingerprint: "old",
      currentScopeFingerprint: "new",
      selectedCount: 1,
      connectionValidated: true,
      requireFreshScan: true,
      requireKnownScope: true,
      now: 200
    })
    expect(changedScope.summary).toBe(
      "google · 1 selected · account verified · scope changed"
    )
    expect(changedScope.reasons).toEqual([
      {
        code: "scope_changed",
        message:
          "The scan settings or library scope changed after these results were created."
      }
    ])
  })

  it("uses a stable exact account fingerprint and covers recovery outcomes", () => {
    expect(accountFingerprint(" Buyer@Example.com ")).toBe("account-5a2762d5")
    expect(accountFingerprint("   ")).toBeUndefined()
    expect(accountFingerprint("x😀@example.com")).toBe("account-c0414f93")

    const known = accountFingerprint("buyer@example.com")
    expect(
      evaluateRecoveryRestorePreflight({
        recordProvider: "icloud",
        currentProvider: "icloud",
        recordAccountFingerprint: known,
        currentAccountEmail: "buyer@example.com",
        connectionValidated: true
      })
    ).toEqual({
      allowed: true,
      accountStatus: "verified",
      freshness: "unknown",
      scopeStatus: "unknown",
      summary: "icloud recovery · account verified",
      reasons: []
    })
    expect(
      evaluateRecoveryRestorePreflight({
        recordProvider: "icloud",
        currentProvider: "icloud",
        connectionValidated: true
      })
    ).toMatchObject({
      allowed: true,
      accountStatus: "unavailable",
      summary: "icloud recovery · account identity unavailable",
      reasons: []
    })
    expect(
      evaluateRecoveryRestorePreflight({
        recordProvider: "icloud",
        currentProvider: "icloud",
        recordAccountFingerprint: known,
        connectionValidated: true
      })
    ).toMatchObject({
      allowed: true,
      accountStatus: "unknown",
      reasons: [
        {
          code: "account_unknown",
          message:
            "The provider has not exposed the account needed to verify this recovery record."
        }
      ]
    })

    expect(
      evaluateRecoveryRestorePreflight({
        recordProvider: "google",
        currentProvider: "google",
        connectionValidated: false
      })
    ).toEqual({
      allowed: false,
      accountStatus: "unavailable",
      freshness: "unknown",
      scopeStatus: "unknown",
      summary: "google recovery · account identity unavailable",
      reasons: [
        {
          code: "connection_unverified",
          message:
            "The current photo-provider connection has not passed a fresh health check."
        }
      ]
    })

    expect(
      evaluateRecoveryRestorePreflight({
        recordProvider: "google",
        currentProvider: "icloud",
        recordAccountFingerprint: known,
        currentAccountEmail: "other@example.com",
        connectionValidated: true
      })
    ).toMatchObject({
      reasons: [
        {
          code: "provider_mismatch",
          message: "The recovery record belongs to a different photo provider."
        },
        {
          code: "account_mismatch",
          message: "This recovery record belongs to a different provider account."
        }
      ]
    })

    expect(
      evaluateRecoveryRestorePreflight({
        recordProvider: "icloud",
        connectionValidated: true
      })
    ).toMatchObject({
      allowed: false,
      accountStatus: "unavailable",
      reasons: [
        {
          code: "provider_mismatch",
          message: "The recovery record belongs to a different photo provider."
        }
      ]
    })
    expect(
      evaluateRecoveryRestorePreflight({
        recordProvider: "google",
        connectionValidated: true
      })
    ).toMatchObject({
      allowed: true,
      reasons: []
    })
  })
})

describe("mutation closure: dispatch guard", () => {
  const plan = {
    provider: "google" as const,
    dedupKeys: ["d1"],
    mediaKeysToTrash: ["m1"],
    blockedMediaKeys: ["blocked"],
    blockedGroupIds: ["g1"]
  }

  it("normalizes omitted and whitespace account identities and binds blocked arrays", () => {
    const expected = captureTrashDispatchAuthorization({
      generation: 1,
      plan,
      provider: "google",
      accountEmail: "  Buyer@Example.com  "
    })
    expect(expected.accountEmail).toBe("buyer@example.com")
    expect(
      captureTrashDispatchAuthorization({ generation: 1, plan, provider: "google" })
    ).not.toHaveProperty("accountEmail")
    expect(trashPlanFingerprint(plan)).toBe(
      '{"provider":"google","dedupKeys":["d1"],"mediaKeysToTrash":["m1"],"icloudAssetRefs":null,"blockedMediaKeys":["blocked"],"blockedGroupIds":["g1"]}'
    )
  })

  it("rejects each authorization dimension and accepts an exact copy", () => {
    const expected = captureTrashDispatchAuthorization({
      generation: 1,
      plan,
      provider: "google",
      accountEmail: "buyer@example.com",
      scopeFingerprint: "scope"
    })
    expect(isTrashDispatchAuthorizationCurrent(expected, { ...expected })).toBe(true)
    for (const current of [
      { ...expected, generation: 2 },
      { ...expected, provider: "icloud" as const },
      { ...expected, accountEmail: "other@example.com" },
      { ...expected, scopeFingerprint: "other" },
      { ...expected, planFingerprint: `${expected.planFingerprint}!` }
    ]) {
      expect(isTrashDispatchAuthorizationCurrent(expected, current)).toBe(false)
    }
  })
})

function auditFixture() {
  const deleteReports: unknown[] = []
  const resultReports: unknown[] = []
  const deleteContexts: Array<TrashAuditContext | undefined> = []
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
  const mediaItems: Record<string, GpdMediaItem> = {
    keep: item("keep", { provider: "google", isOriginalQuality: true }),
    trash: item("trash", { provider: "google", isOriginalQuality: false })
  }
  const groups = [group("g1", "keep", "trash")]
  const reviewSession = new DuplicateReviewSession({
    groups,
    mediaItems,
    selections: {
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1"]),
      keptOverrides: { g1: new Set(["keep"]) }
    }
  })
  const plan = reviewSession.trashPlan()
  return {
    adapter,
    deleteReports,
    resultReports,
    deleteContexts,
    resultContexts,
    mediaItems,
    groups,
    reviewSession,
    plan
  }
}

async function beginTrash(
  lifecycle: TrashLifecycle,
  fixture = auditFixture(),
  overrides: Partial<Parameters<TrashLifecycle["begin"]>[0]> = {}
) {
  const command = await lifecycle.begin({
    plan: fixture.plan,
    reviewSession: fixture.reviewSession,
    groups: fixture.groups,
    snapshot: { mediaItems: fixture.mediaItems, groups: fixture.groups, totalItems: 2 },
    batchPolicy: { batchSize: 25, batchPauseMs: 0, retryCount: 1, retryBackoffMs: 10 },
    ...overrides
  })
  return { command, fixture }
}

describe("mutation closure: trash lifecycle", () => {
  it("filters non-string provider identities and accepts either identity list", async () => {
    const fixture = auditFixture()
    const lifecycle = new TrashLifecycle(fixture.adapter)
    await beginTrash(lifecycle, fixture)
    const outcome = await lifecycle.reconcile({
      success: true,
      data: {
        trashedKeys: [null, 42, "trash"] as unknown as string[],
        trashedDedupKeys: ["dedup-trash"]
      }
    })
    expect(outcome).toMatchObject({ kind: "complete", movedMediaKeys: ["trash"], movedCount: 1 })

    const mediaOnly = auditFixture()
    const mediaOnlyLifecycle = new TrashLifecycle(mediaOnly.adapter)
    await beginTrash(mediaOnlyLifecycle, mediaOnly)
    expect(
      await mediaOnlyLifecycle.reconcile({
        success: true,
        data: { trashedKeys: ["trash"] }
      })
    ).toMatchObject({ kind: "complete", movedDedupKeys: ["dedup-trash"] })

    const dedupOnly = auditFixture()
    const dedupOnlyLifecycle = new TrashLifecycle(dedupOnly.adapter)
    await beginTrash(dedupOnlyLifecycle, dedupOnly)
    expect(
      await dedupOnlyLifecycle.reconcile({
        success: true,
        data: { trashedDedupKeys: ["dedup-trash"] }
      })
    ).toMatchObject({ kind: "complete", movedMediaKeys: ["trash"] })

    const singularPartial = auditFixture()
    const singularPartialLifecycle = new TrashLifecycle(singularPartial.adapter)
    await beginTrash(singularPartialLifecycle, singularPartial)
    await expect(
      singularPartialLifecycle.reconcile({
        success: true,
        data: {
          trashedKeys: ["trash", "foreign"],
          trashedDedupKeys: ["dedup-trash"]
        }
      })
    ).resolves.toMatchObject({
      kind: "partial",
      movedCount: 1,
      message:
        "Moved 1 item before trash failed. The provider response was incomplete or invalid: Trash provider response included identities outside the confirmed request."
    })
  })

  it("rejects a provider response with no identities even when no items were requested", async () => {
    const fixture = auditFixture()
    const lifecycle = new TrashLifecycle(fixture.adapter)
    const emptyPlan = {
      ...fixture.plan,
      dedupKeys: [],
      mediaKeysToTrash: []
    }
    await beginTrash(lifecycle, fixture, { plan: emptyPlan })

    await expect(
      lifecycle.reconcile({ success: true, data: {} })
    ).resolves.toEqual({
      kind: "failed",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      error: "Trash provider response did not confirm every requested item.",
      undo: null
    })
  })

  it("treats opaque provider identities literally, including the mutation sentinel", async () => {
    const fixture = auditFixture()
    const sentinel = "Stryker was here"
    fixture.plan.dedupKeys = [sentinel]
    fixture.plan.mediaKeysToTrash = [sentinel]
    const lifecycle = new TrashLifecycle(fixture.adapter)

    await beginTrash(lifecycle, fixture)
    await expect(
      lifecycle.reconcile({ success: true, data: undefined })
    ).resolves.toEqual({
      kind: "failed",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      error: "Trash provider response did not confirm every requested item.",
      undo: null
    })

    await beginTrash(lifecycle, fixture)
    const dryRun = await lifecycle.reconcile({
      success: true,
      data: { dryRun: true, requestedCount: 1 }
    })
    expect(dryRun).toMatchObject({
      kind: "dry_run",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0
    })
    expect(fixture.resultReports.at(-1)).toMatchObject({
      movedMediaKeys: [],
      movedDedupKeys: []
    })
  })

  it("rejects inconsistent parallel identity plans before writing an audit", async () => {
    const fixture = auditFixture()
    const lifecycle = new TrashLifecycle(fixture.adapter)
    const malformedPlan = {
      ...fixture.plan,
      mediaKeysToTrash: []
    }

    await expect(beginTrash(lifecycle, fixture, { plan: malformedPlan })).rejects.toThrow(
      "Trash plan identities are inconsistent."
    )
    expect(fixture.deleteReports).toHaveLength(0)
  })

  it("returns dry-run messages for singular, plural, and explicit provider text", async () => {
    const singular = auditFixture()
    const singularLifecycle = new TrashLifecycle(singular.adapter)
    await beginTrash(singularLifecycle, singular)
    const singularOutcome = await singularLifecycle.reconcile({
      success: true,
      data: { dryRun: true, requestedCount: 1 }
    })
    expect(singularOutcome).toMatchObject({
      kind: "dry_run",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      message: "iCloud delete dry-run completed for 1 item. Nothing was deleted."
    })
    expect(singular.resultReports[0]).toMatchObject({
      movedMediaKeys: [],
      movedDedupKeys: []
    })

    const plural = auditFixture()
    const pluralLifecycle = new TrashLifecycle(plural.adapter)
    await beginTrash(pluralLifecycle, plural)
    const pluralOutcome = await pluralLifecycle.reconcile({
      success: true,
      data: { dryRun: true, requestedCount: 2 }
    })
    expect(pluralOutcome).toMatchObject({
      kind: "dry_run",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      message: "iCloud delete dry-run completed for 2 items. Nothing was deleted."
    })
    expect(plural.resultReports[0]).toMatchObject({
      movedMediaKeys: [],
      movedDedupKeys: []
    })

    const custom = auditFixture()
    const customLifecycle = new TrashLifecycle(custom.adapter)
    await beginTrash(customLifecycle, custom)
    expect(
      await customLifecycle.reconcile({
        success: true,
        data: { dryRun: true, requestedCount: 2, message: "provider preview" }
      })
    ).toMatchObject({ kind: "dry_run", message: "provider preview" })
  })

  it("captures operation, account, scope, retry, and iCloud undo context", async () => {
    const fixture = auditFixture()
    fixture.plan.provider = "icloud"
    fixture.plan.icloudAssetRefs = [
      {
        recordName: "record-trash",
        changeTag: "tag-1",
        zoneName: "PrimarySync",
        ownerRecordName: "owner-1"
      }
    ]
    const lifecycle = new TrashLifecycle(fixture.adapter)
    const { command } = await beginTrash(lifecycle, fixture, {
      operationId: "operation-1",
      accountEmail: "buyer@example.com",
      scopeFingerprint: "scope-1",
      scopeLabel: "All photos"
    })
    expect(command).toMatchObject({
      operationId: "operation-1",
      provider: "icloud",
      args: { icloudAssetRefs: fixture.plan.icloudAssetRefs }
    })
    const context = fixture.deleteContexts[0]
    expect(context).toMatchObject({
      operationId: "operation-1",
      provider: "icloud",
      attemptedDedupKeys: ["dedup-trash"],
      attemptedMediaKeys: ["trash"],
      icloudAssetRefs: fixture.plan.icloudAssetRefs
    })
    const contextRef = fixture.plan.icloudAssetRefs![0]
    fixture.plan.dedupKeys[0] = "mutated-dedup"
    fixture.plan.mediaKeysToTrash[0] = "mutated-media"
    fixture.plan.icloudAssetRefs![0] = { ...contextRef, recordName: "mutated-record" }
    expect(context?.attemptedDedupKeys).toEqual(["dedup-trash"])
    expect(context?.attemptedMediaKeys).toEqual(["trash"])
    expect(context?.icloudAssetRefs).toEqual([contextRef])
    expect(context?.operationId).toBe("operation-1")
    const outcome = await lifecycle.reconcile({
      success: true,
      data: {
        trashedKeys: ["trash"],
        trashedDedupKeys: ["dedup-trash"],
        icloudAssetRefs: fixture.plan.icloudAssetRefs,
        retryAttempts: 1
      }
    })
    expect(outcome.undo).toMatchObject({
      operationId: "operation-1",
      provider: "icloud",
      dedupKeys: ["dedup-trash"],
      icloudAssetRefs: fixture.plan.icloudAssetRefs,
      accountEmail: "buyer@example.com",
      scopeFingerprint: "scope-1",
      scopeLabel: "All photos"
    })
    expect(fixture.resultReports[0]).toMatchObject({ retryAttempts: 1 })
  })

  it("formats generated operation IDs as stable audit-safe tokens", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.123456789)
    try {
      const fixture = auditFixture()
      const lifecycle = new TrashLifecycle(fixture.adapter)
      const { command } = await beginTrash(lifecycle, fixture)
      expect(command.operationId).toMatch(
        /^gpd-cleanup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9]{6}$/
      )
    } finally {
      randomSpy.mockRestore()
    }
  })

  it("uses plural partial wording when two requested items moved", async () => {
    const base = auditFixture()
    const mediaItems: Record<string, GpdMediaItem> = {
      keepA: { ...base.mediaItems.keep, mediaKey: "keepA", dedupKey: "dedup-keep-a" },
      trashA: { ...base.mediaItems.trash, mediaKey: "trashA", dedupKey: "dedup-trash-a" },
      keepB: { ...base.mediaItems.keep, mediaKey: "keepB", dedupKey: "dedup-keep-b" },
      trashB: { ...base.mediaItems.trash, mediaKey: "trashB", dedupKey: "dedup-trash-b" }
    }
    const groups = [
      group("group-a", "keepA", "trashA"),
      group("group-b", "keepB", "trashB")
    ]
    const reviewSession = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(groups.map((entry) => entry.id)),
        reviewedGroupIds: new Set(groups.map((entry) => entry.id)),
        keptOverrides: {
          "group-a": new Set(["keepA"]),
          "group-b": new Set(["keepB"])
        }
      }
    })
    const lifecycle = new TrashLifecycle(base.adapter)
    await lifecycle.begin({
      plan: reviewSession.trashPlan(groups),
      reviewSession,
      groups,
      snapshot: { mediaItems, groups, totalItems: 4 },
      batchPolicy: { batchSize: 25, batchPauseMs: 0, retryCount: 0, retryBackoffMs: 0 }
    })

    const outcome = await lifecycle.reconcile({
      success: true,
      data: {
        trashedKeys: ["trashA", "trashB", "foreign"],
        trashedDedupKeys: ["dedup-trash-a", "dedup-trash-b"]
      }
    })
    expect(outcome).toMatchObject({
      kind: "partial",
      movedMediaKeys: ["trashA", "trashB"],
      movedCount: 2,
      message:
        "Moved 2 items before trash failed. The provider response was incomplete or invalid: Trash provider response included identities outside the confirmed request."
    })
  })

  it("supports generated operation IDs, default errors, reset, and restore success", async () => {
    const fixture = auditFixture()
    const lifecycle = new TrashLifecycle(fixture.adapter)
    const { command } = await beginTrash(lifecycle, fixture)
    expect(command.operationId).toMatch(/^gpd-cleanup-/)
    expect(
      await lifecycle.reconcile({ success: false, error: "" })
    ).toMatchObject({ kind: "failed", error: "Trash failed", undo: null })

    // The pre-trash guard is cleared after a successful begin, so a retry can
    // start once the first response has consumed its pending operation.
    await beginTrash(lifecycle, fixture)
    expect(
      await lifecycle.reconcile({ success: true, data: undefined })
    ).toEqual({
      kind: "failed",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      error: "Trash provider response did not confirm every requested item.",
      undo: null
    })
    await expect(lifecycle.reconcile({ success: true })).resolves.toEqual({
      kind: "failed",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      error: "Trash response did not match a pending operation.",
      undo: null
    })

    const undo: TrashUndoData = {
      operationId: "operation-restore",
      provider: "google",
      dedupKeys: ["dedup-trash"],
      count: 1,
      snapshot: { mediaItems: fixture.mediaItems, groups: fixture.groups, totalItems: 2 }
    }
    const restoreCommand = lifecycle.beginRestore(undo, "restore-1")
    expect(restoreCommand).toEqual({
      provider: "google",
      args: { dedupKeys: ["dedup-trash"] }
    })
    expect(lifecycle.reconcileRestore({ requestId: "restore-1", success: true })).toBeNull()
    expect(lifecycle.reconcileRestore({ requestId: "restore-1", success: false })).toBeUndefined()
    const icloudUndo: TrashUndoData = {
      ...undo,
      provider: "icloud",
      icloudAssetRefs: [
        {
          recordName: "record-trash",
          changeTag: "tag-1",
          zoneName: "PrimarySync",
          ownerRecordName: "owner-1"
        }
      ]
    }
    expect(lifecycle.beginRestore(icloudUndo, "restore-icloud")).toEqual({
      provider: "icloud",
      args: {
        dedupKeys: ["dedup-trash"],
        icloudAssetRefs: icloudUndo.icloudAssetRefs
      }
    })
    expect(lifecycle.reconcileRestore({ requestId: "restore-icloud", success: true })).toBeNull()
    lifecycle.reset()
    expect(
      await lifecycle.reconcile({
        success: true,
        data: { trashedKeys: ["trash"], trashedDedupKeys: ["dedup-trash"] }
      })
    ).toMatchObject({ kind: "failed", movedCount: 0 })
  })
})

type FakeWindow = {
  __GPD_COMMAND_HOST__?: unknown
  addEventListener: (
    type: string,
    listener: (event: { source: unknown; data: unknown }) => unknown
  ) => void
  postMessage: (message: unknown, targetOrigin?: string) => void
}

type CommandHost = {
  postResult: (command: string, requestId: string, data: unknown) => void
  postError: (command: string, requestId: string, error: unknown, data?: unknown) => void
  postProgress: (
    requestId: string,
    itemsProcessed: number,
    message: string,
    command?: string,
    data?: unknown
  ) => void
  register: (params: {
    handlers?: Record<string, (requestId: string, args: unknown) => Promise<void>> | null
    unsupportedMessage?: (command: string) => string
  }) => void
}

let createCommandHost: ((targetWindow: FakeWindow) => CommandHost) | undefined

beforeAll(async () => {
  const testGlobals = globalThis as typeof globalThis & {
    __GPD_COMMAND_HOST_TEST_MODE__?: boolean
    __GPD_COMMAND_HOST_TEST_FACTORY__?: (
      targetWindow: FakeWindow
    ) => CommandHost
  }
  testGlobals.__GPD_COMMAND_HOST_TEST_MODE__ = true
  delete testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
  // @ts-expect-error Vite resolves the test-only module query.
  await import("../../scripts/photo-provider-command-host.js?mutation-closure")
  globalThis.dispatchEvent(new Event("gpd-command-host-test"))
  createCommandHost = testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
  expect(createCommandHost).toBeTypeOf("function")
})

function commandHostFixture() {
  const listeners: Array<(event: { source: unknown; data: unknown }) => unknown> = []
  const posted: unknown[] = []
  const targetOrigins: Array<string | undefined> = []
  const source: FakeWindow = {
    __GPD_COMMAND_HOST__: undefined,
    addEventListener(type, listener) {
      if (type === "message") listeners.push(listener)
    },
    postMessage(message, targetOrigin) {
      posted.push(message)
      targetOrigins.push(targetOrigin)
    }
  }
  if (!createCommandHost) throw new Error("command host factory unavailable")
  const host = createCommandHost(source)
  return {
    host,
    source,
    posted,
    targetOrigins,
    dispatch: async (event: { source: unknown; data: unknown }) => {
      for (const listener of listeners) await listener(event)
    }
  }
}

describe("mutation closure: command host", () => {
  it("posts result, error, and progress envelopes with optional payloads", () => {
    const fixture = commandHostFixture()
    fixture.host.postResult("scan", "request-1", { count: 2 })
    fixture.host.postError("scan", "request-2", new Error("failed"), { retryable: true })
    fixture.host.postError("scan", "request-3", "plain failure")
    fixture.host.postProgress("request-4", 2, "Working", "scan", { phase: "scan" })
    fixture.host.postProgress("request-5", 3, "Done")
    expect(fixture.posted).toEqual([
      {
        app: "GPD",
        action: "gptkResult",
        command: "scan",
        requestId: "request-1",
        success: true,
        data: { count: 2 }
      },
      {
        app: "GPD",
        action: "gptkResult",
        command: "scan",
        requestId: "request-2",
        success: false,
        error: "failed",
        data: { retryable: true }
      },
      {
        app: "GPD",
        action: "gptkResult",
        command: "scan",
        requestId: "request-3",
        success: false,
        error: "plain failure"
      },
      {
        app: "GPD",
        action: "gptkProgress",
        requestId: "request-4",
        itemsProcessed: 2,
        message: "Working",
        command: "scan",
        data: { phase: "scan" }
      },
      {
        app: "GPD",
        action: "gptkProgress",
        requestId: "request-5",
        itemsProcessed: 3,
        message: "Done"
      }
    ])
    expect(fixture.posted[2]).not.toHaveProperty("data")
    expect(fixture.posted[4]).not.toHaveProperty("command")
    expect(fixture.posted[4]).not.toHaveProperty("data")
    expect(fixture.targetOrigins).toEqual(["*", "*", "*", "*", "*"])
  })

  it("uses the default unsupported response and converts handler errors", async () => {
    const fixture = commandHostFixture()
    fixture.host.register({
      handlers: {
        explode: async () => {
          throw new Error("handler exploded")
        }
      }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "missing",
        requestId: "missing-1",
        args: {}
      }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "explode",
        requestId: "explode-1",
        args: {}
      }
    })
    await Promise.resolve()
    expect(fixture.posted).toEqual([
      {
        app: "GPD",
        action: "gptkResult",
        command: "missing",
        requestId: "missing-1",
        success: false,
        error: "Unsupported command: missing"
      },
      {
        app: "GPD",
        action: "gptkResult",
        command: "explode",
        requestId: "explode-1",
        success: false,
        error: "handler exploded"
      }
    ])
  })

  it("requires own callable handlers and keeps the singleton host", async () => {
    const fixture = commandHostFixture()
    expect(createCommandHost?.(fixture.source)).toBe(fixture.host)
    let calls = 0
    const inherited = { inherited: async () => { calls += 1 } }
    const handlers = Object.create(inherited) as Record<string, (requestId: string, args: unknown) => Promise<void>>
    handlers.own = async () => { calls += 1 }
    fixture.host.register({ handlers })
    await fixture.dispatch({
      source: {},
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "own",
        requestId: "foreign-1"
      }
    })
    expect(calls).toBe(0)
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "inherited",
        requestId: "inherited-1"
      }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "own",
        requestId: "own-1"
      }
    })
    expect(calls).toBe(1)
    expect(fixture.posted).not.toContainEqual(
      expect.objectContaining({ command: "own", requestId: "own-1" })
    )
    expect(fixture.posted).toContainEqual({
      app: "GPD",
      action: "gptkResult",
      command: "inherited",
      requestId: "inherited-1",
      success: false,
      error: "Unsupported command: inherited"
    })

    const nonCallableFixture = commandHostFixture()
    nonCallableFixture.host.register({
      handlers: { notCallable: "value" } as unknown as Record<
        string,
        (requestId: string, args: unknown) => Promise<void>
      >
    })
    await nonCallableFixture.dispatch({
      source: nonCallableFixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "notCallable",
        requestId: "not-callable"
      }
    })
    expect(nonCallableFixture.posted).toContainEqual({
      app: "GPD",
      action: "gptkResult",
      command: "notCallable",
      requestId: "not-callable",
      success: false,
      error: "Unsupported command: notCallable"
    })

    const functionHandlersFixture = commandHostFixture()
    let functionHandlerCalls = 0
    const functionHandlers = Object.assign(async () => {}, {
      callable: async () => {
        functionHandlerCalls += 1
      }
    })
    functionHandlersFixture.host.register({
      handlers: functionHandlers as unknown as Record<
        string,
        (requestId: string, args: unknown) => Promise<void>
      >
    })
    await functionHandlersFixture.dispatch({
      source: functionHandlersFixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "callable",
        requestId: "function-handlers"
      }
    })
    expect(functionHandlerCalls).toBe(0)
  })

  it("uses a null-prototype handler map for null and array registrations", async () => {
    const nullFixture = commandHostFixture()
    nullFixture.host.register({ handlers: null })
    await nullFixture.dispatch({
      source: nullFixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "toString",
        requestId: "null-handlers"
      }
    })
    expect(nullFixture.posted).toEqual([
      {
        app: "GPD",
        action: "gptkResult",
        command: "toString",
        requestId: "null-handlers",
        success: false,
        error: "Unsupported command: toString"
      }
    ])

    const arrayFixture = commandHostFixture()
    arrayFixture.host.register({
      handlers: [] as unknown as Record<
        string,
        (requestId: string, args: unknown) => Promise<void>
      >
    })
    await arrayFixture.dispatch({
      source: arrayFixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "length",
        requestId: "array-handlers"
      }
    })
    expect(arrayFixture.posted).toContainEqual(
      expect.objectContaining({
        command: "length",
        requestId: "array-handlers",
        error: "Unsupported command: length"
      })
    )
  })

  it("keeps the command-host test hook opt-in and installs the browser singleton", async () => {
    const testGlobals = globalThis as typeof globalThis & {
      __GPD_COMMAND_HOST_TEST_MODE__?: boolean
      __GPD_COMMAND_HOST_TEST_FACTORY__?: (
        targetWindow: FakeWindow
      ) => CommandHost
    }
    const previousFactory = testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
    const previousMode = testGlobals.__GPD_COMMAND_HOST_TEST_MODE__
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window")
    if (!windowDescriptor?.configurable) {
      throw new Error("The test environment must expose a configurable window global.")
    }
    const browserWindow = globalThis.window as unknown as FakeWindow
    const previousHost = browserWindow.__GPD_COMMAND_HOST__

    try {
      testGlobals.__GPD_COMMAND_HOST_TEST_MODE__ = false
      delete testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
      Reflect.deleteProperty(globalThis, "window")
      await expect(
        // @ts-expect-error Vite resolves the test-only module query.
        import("../../scripts/photo-provider-command-host.js?mutation-closure-no-window")
      ).resolves.toBeDefined()
      expect(testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__).toBeUndefined()

      Object.defineProperty(globalThis, "window", windowDescriptor)
      delete browserWindow.__GPD_COMMAND_HOST__
      delete testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
      await expect(
        // @ts-expect-error Vite resolves the test-only module query.
        import("../../scripts/photo-provider-command-host.js?mutation-closure-browser")
      ).resolves.toBeDefined()
      expect(browserWindow.__GPD_COMMAND_HOST__).toMatchObject({
        postResult: expect.any(Function),
        postError: expect.any(Function),
        postProgress: expect.any(Function),
        register: expect.any(Function)
      })
      expect(testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__).toBeUndefined()

      testGlobals.__GPD_COMMAND_HOST_TEST_MODE__ = true
      await expect(
        // @ts-expect-error Vite resolves the test-only module query.
        import("../../scripts/photo-provider-command-host.js?mutation-closure-restore")
      ).resolves.toBeDefined()
      globalThis.dispatchEvent(new Event("gpd-command-host-test"))
      expect(testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__).toBeTypeOf("function")
      createCommandHost = testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
    } finally {
      Object.defineProperty(globalThis, "window", windowDescriptor)
      if (previousHost === undefined) delete browserWindow.__GPD_COMMAND_HOST__
      else browserWindow.__GPD_COMMAND_HOST__ = previousHost
      testGlobals.__GPD_COMMAND_HOST_TEST_MODE__ = previousMode
      if (previousFactory) {
        testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__ = previousFactory
        createCommandHost = previousFactory
      } else {
        delete testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
        createCommandHost = undefined
      }
    }
  })

  it("ignores malformed message payloads without throwing", async () => {
    const fixture = commandHostFixture()
    let calls = 0
    fixture.host.register({ handlers: { own: async () => { calls += 1 } } })
    await expect(
      fixture.dispatch({ source: fixture.source, data: null })
    ).resolves.toBeUndefined()
    await expect(
      fixture.dispatch({ source: fixture.source, data: [] })
    ).resolves.toBeUndefined()
    const callableMessage = Object.assign(() => {}, {
      app: "GPD",
      action: "gptkCommand",
      command: "own",
      requestId: "callable-message"
    })
    await fixture.dispatch({ source: fixture.source, data: callableMessage })
    expect(calls).toBe(0)

    const boxedCommand = new String("own")
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: boxedCommand,
        requestId: "boxed-command"
      }
    })
    expect(calls).toBe(0)
    expect(fixture.posted).toEqual([])
  })
})
