import { describe, expect, it } from "vitest"

import {
  DuplicateReviewSession,
  type DuplicateReviewSelections
} from "../../lib/duplicate-review-session"
import {
  applyKeepStrategyToReview,
  buildKeepStrategyFeedback,
  summarizeKeepStrategyApplication
} from "../../lib/keep-strategy-feedback"
import type { DuplicateGroup, GpdMediaItem, PhotoProvider } from "../../lib/types"

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

function session(
  groups: DuplicateGroup[],
  mediaItems: Record<string, GpdMediaItem>,
  selections?: DuplicateReviewSelections
) {
  return new DuplicateReviewSession({ groups, mediaItems, selections })
}

describe("keep strategy feedback", () => {
  it("reports changed and already-matching groups without implying cleanup selection", () => {
    const groups = [group("g1", "a", "b"), group("g2", "c", "d")]
    const mediaItems = {
      a: item("a", { resWidth: 300 }),
      b: item("b", { isOriginalQuality: true, resWidth: 100 }),
      c: item("c", { isOriginalQuality: true, resWidth: 300 }),
      d: item("d", { resWidth: 100 })
    }
    const previous = session(groups, mediaItems)
    const next = session(
      groups,
      mediaItems,
      previous.update({
        type: "apply_keep_strategy",
        groupIds: groups.map((item) => item.id),
        strategy: "largest_resolution"
      })
    )

    const counts = summarizeKeepStrategyApplication(groups, previous, next)
    expect(counts).toEqual({
      changedGroupCount: 1,
      alreadyMatchedGroupCount: 1,
      preservedGroupCount: 0,
      replacedManualGroupCount: 0,
      noConfidenceGroupCount: 0,
      deterministicFallbackGroupCount: 0,
      cleanupIncludedGroupCount: 0,
      proposedTrashMediaItemCount: 0
    })
    expect(buildKeepStrategyFeedback("largest_resolution", counts)).toBe(
      "Largest resolution updated keeper choices and was saved as the default: 1 set changed; 1 set already had the selected keeper; 0 manual choices preserved; 0 manual choices replaced; 0 sets resolved by deterministic tie-break; 0 sets had no keeper data. Set selection for cleanup is unchanged: 0 sets remain selected and 0 media items remain proposed for Trash. Review any set marked Needs review before moving items."
    )
  })

  it("preserves manual choices while recomputing legacy choices", () => {
    const groups = [group("g1", "a", "b"), group("g2", "c", "d")]
    const mediaItems = {
      a: item("a", { resWidth: 300 }),
      b: item("b", { isOriginalQuality: true, resWidth: 100 }),
      c: item("c", { resWidth: 300 }),
      d: item("d", { isOriginalQuality: true, resWidth: 100 })
    }
    const previous = session(groups, mediaItems, {
      selectedGroupIds: new Set(),
      reviewedGroupIds: new Set(),
      keptOverrides: {
        g1: new Set(["a"]),
        g2: new Set(["d"])
      },
      keepDecisionProvenance: { g1: { source: "manual" } }
    })
    const next = session(
      groups,
      mediaItems,
      previous.update({
        type: "apply_keep_strategy",
        groupIds: groups.map((item) => item.id),
        strategy: "largest_resolution"
      })
    )

    const counts = summarizeKeepStrategyApplication(groups, previous, next)
    expect(counts).toEqual({
      changedGroupCount: 1,
      alreadyMatchedGroupCount: 0,
      preservedGroupCount: 1,
      replacedManualGroupCount: 0,
      noConfidenceGroupCount: 0,
      deterministicFallbackGroupCount: 0,
      cleanupIncludedGroupCount: 0,
      proposedTrashMediaItemCount: 0
    })
    expect(buildKeepStrategyFeedback("largest_resolution", counts)).toContain(
      "1 manual choice preserved"
    )
    expect(next.keptFor(groups[1])).toEqual(new Set(["c"]))
  })

  it("reports when a deterministic tie-break selected the default keeper", () => {
    const groups = [group("g1", "a", "b")]
    const mediaItems = {
      a: item("a", { isOriginalQuality: true }),
      b: item("b", { isOriginalQuality: true })
    }
    const previous = session(groups, mediaItems)
    const next = session(
      groups,
      mediaItems,
      previous.update({
        type: "apply_keep_strategy",
        groupIds: ["g1"],
        strategy: "best_quality"
      })
    )

    const counts = summarizeKeepStrategyApplication(groups, previous, next)
    expect(counts).toEqual({
      changedGroupCount: 0,
      alreadyMatchedGroupCount: 1,
      preservedGroupCount: 0,
      replacedManualGroupCount: 0,
      noConfidenceGroupCount: 0,
      deterministicFallbackGroupCount: 1,
      cleanupIncludedGroupCount: 0,
      proposedTrashMediaItemCount: 0
    })
    expect(buildKeepStrategyFeedback("best_quality", counts)).toBe(
      "Best quality updated keeper choices and was saved as the default: 0 sets changed; 1 set already had the selected keeper; 0 manual choices preserved; 0 manual choices replaced; 1 set resolved by deterministic tie-break; 0 sets had no keeper data. Set selection for cleanup is unchanged: 0 sets remain selected and 0 media items remain proposed for Trash. Review any set marked Needs review before moving items."
    )
    expect(next.keptFor(groups[0])).toEqual(new Set(["a"]))
  })

  it.each([
    "best_quality",
    "largest_resolution",
    "newest_taken",
    "oldest_taken",
    "newest_upload",
    "non_storage_counting"
  ] as const)(
    "updates skipped groups' keepers without including them for %s",
    (strategy) => {
      const groups = [group("g1", "manual-keep", "manual-trash"), group("g2", "c", "d")]
      const mediaItems = {
        "manual-keep": item("manual-keep"),
        "manual-trash": item("manual-trash"),
        c: item("c", {
          isOriginalQuality: true,
          resWidth: 100,
          resHeight: 100,
          timestamp: 2,
          timestampProvenance: "capture",
          creationTimestamp: 1,
          creationTimestampProvenance: "creation",
          takesUpSpace: true
        }),
        d: item("d", {
          isOriginalQuality: false,
          resWidth: 200,
          resHeight: 200,
          timestamp: 1,
          timestampProvenance: "capture",
          creationTimestamp: 2,
          creationTimestampProvenance: "creation",
          takesUpSpace: false
        })
      }
      const selections: DuplicateReviewSelections = {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set(["g1"]),
        keptOverrides: { g1: new Set(["manual-keep"]) },
        keepDecisionProvenance: { g1: { source: "manual" } }
      }

      const application = applyKeepStrategyToReview({
        groups,
        mediaItems,
        selections,
        strategy
      })

      expect(application.selections.selectedGroupIds).toEqual(new Set())
      expect(application.selections.reviewedGroupIds).toEqual(new Set(["g1"]))
      expect(application.session.decisionFor(groups[0]).source).toBe(
        "automatic"
      )
      expect(application.session.keptFor(groups[0])).toEqual(
        new Set(
          application.session.decisionFor(groups[0]).recommendation.keptMediaKeys
        )
      )
      expect(application.feedback).toContain("1 manual choice replaced")
      expect(application.session.keptFor(groups[1]).size).toBe(1)
      expect(application.session.trashPlan(groups).mediaKeysToTrash).toEqual([])
      expect(application.feedback).toContain(
        "Set selection for cleanup is unchanged: 0 sets remain selected and 0 media items remain proposed for Trash"
      )
    }
  )

  it.each([
    {
      label: "manual keeper",
      keptOverride: new Set(["manual-keep"])
    },
    {
      label: "manual Trash-all choice",
      keptOverride: new Set<string>()
    }
  ])("replaces a skipped $label choice without re-including the set", (choice) => {
    const groups = [group("g1", "manual-keep", "manual-trash")]
    const mediaItems = {
      "manual-keep": item("manual-keep"),
      "manual-trash": item("manual-trash")
    }
    const manuallyReviewed = session(groups, mediaItems, {
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1"]),
      keptOverrides: { g1: choice.keptOverride },
      keepDecisionProvenance: { g1: { source: "manual" } }
    })
    const skippedSelections = manuallyReviewed.update({
      type: "deselect_groups",
      groupIds: ["g1"]
    })
    expect(
      session(groups, mediaItems, skippedSelections).reviewedGroupIds
    ).toEqual(new Set(["g1"]))

    const application = applyKeepStrategyToReview({
      groups,
      mediaItems,
      selections: skippedSelections,
      strategy: "best_quality"
    })

    expect(application.session.selectedGroupIds).toEqual(new Set())
    expect(application.selections.reviewedGroupIds).toEqual(new Set(["g1"]))
    expect(application.session.reviewedGroupIds).toEqual(new Set(["g1"]))
    expect(application.session.decisionFor(groups[0]).source).toBe("automatic")
    expect(application.session.keptFor(groups[0])).toEqual(
      new Set(["manual-keep"])
    )
    expect(application.session.trashPlan(groups).mediaKeysToTrash).toEqual([])
    expect(application.feedback).toContain("1 manual choice replaced")

    const stored = application.session.serialize()
    const restored = session(groups, mediaItems, {
      selectedGroupIds: new Set(stored.selectedGroupIds),
      reviewedGroupIds: new Set(stored.reviewedGroupIds),
      keptOverrides: Object.fromEntries(
        Object.entries(stored.keptOverrides).map(([groupId, keys]) => [
          groupId,
          new Set(keys)
        ])
      ),
      keepDecisionProvenance: stored.keepDecisionProvenance
    })
    expect(restored.reviewedGroupIds).toEqual(new Set(["g1"]))
    expect(restored.decisionFor(groups[0]).source).toBe("automatic")
    expect(restored.keptFor(groups[0])).toEqual(new Set(["manual-keep"]))
  })

  it("reopens an included set when a strategy changes its proposed Trash targets", () => {
    const groups = [group("g1", "a", "b")]
    const mediaItems = {
      a: item("a", { isOriginalQuality: true, resWidth: 100, resHeight: 100 }),
      b: item("b", { isOriginalQuality: false, resWidth: 400, resHeight: 400 })
    }
    const selections: DuplicateReviewSelections = {
      selectedGroupIds: new Set(["g1"]),
      reviewedGroupIds: new Set(["g1"]),
      keptOverrides: { g1: new Set(["a"]) },
      keepDecisionProvenance: {
        g1: { source: "automatic", strategy: "best_quality" }
      }
    }

    const changed = applyKeepStrategyToReview({
      groups,
      mediaItems,
      selections,
      strategy: "largest_resolution"
    })
    const unchanged = applyKeepStrategyToReview({
      groups,
      mediaItems,
      selections,
      strategy: "best_quality"
    })

    expect(changed.session.keptFor(groups[0])).toEqual(new Set(["b"]))
    expect(changed.selections.reviewedGroupIds).toEqual(new Set())
    expect(unchanged.session.keptFor(groups[0])).toEqual(new Set(["a"]))
    expect(unchanged.selections.reviewedGroupIds).toEqual(new Set(["g1"]))
  })

  it("updates all keepers without changing which groups are included", () => {
    const groups = [group("eligible", "keep", "copy"), group("locked", "locked-a", "locked-b")]
    const mediaItems = {
      keep: item("keep", { isOriginalQuality: true, provider: "google" }),
      copy: item("copy", { isOriginalQuality: false, provider: "google" }),
      "locked-a": item("locked-a", { provider: "google" }),
      "locked-b": item("locked-b", { provider: "google" })
    }

    const application = applyKeepStrategyToReview({
      groups,
      mediaItems,
      selections: {
        selectedGroupIds: new Set(["locked"]),
        reviewedGroupIds: new Set(),
        keptOverrides: {}
      },
      strategy: "best_quality"
    })

    expect(application.selections.selectedGroupIds).toEqual(new Set(["locked"]))
    expect(application.session.keptFor(groups[0])).toEqual(new Set(["keep"]))
    expect(application.session.keptFor(groups[1]).size).toBe(1)
    expect(application.session.trashPlan([groups[0]]).mediaKeysToTrash).toEqual([])
    expect(application.feedback).toContain(
      "Set selection for cleanup is unchanged: 1 set remains selected and 1 media item remains proposed for Trash"
    )
  })

  it.each(["google", "amazon", "icloud"] as const)(
    "builds the same strategy proposal for the %s provider",
    (provider: PhotoProvider) => {
      const currentGroup = group(`${provider}-set`, `${provider}-keeper`, `${provider}-copy`)
      const currentItems = {
        [`${provider}-keeper`]: item(`${provider}-keeper`, {
          provider,
          isOriginalQuality: true,
          resWidth: 100
        }),
        [`${provider}-copy`]: item(`${provider}-copy`, {
          provider,
          isOriginalQuality: false,
          resWidth: 50
        })
      }
      const application = applyKeepStrategyToReview({
        groups: [currentGroup],
        mediaItems: currentItems,
        selections: {
          selectedGroupIds: new Set([currentGroup.id]),
          reviewedGroupIds: new Set(),
          keptOverrides: {}
        },
        strategy: "best_quality"
      })

      expect(application.session.keptFor(currentGroup)).toEqual(
        new Set([`${provider}-keeper`])
      )
      expect(application.session.trashPlan([currentGroup])).toMatchObject({
        provider,
        mediaKeysToTrash: [`${provider}-copy`]
      })
    }
  )
})
