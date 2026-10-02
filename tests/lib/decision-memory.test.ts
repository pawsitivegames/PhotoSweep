import { describe, expect, it } from "vitest"

import {
  applyRememberedDecisions,
  captureManualDecisionRecords,
  mergeDecisionMemory,
  stableGroupIdentity
} from "../../lib/decision-memory"
import { applyDefaultKeepStrategyToSelections } from "../../lib/duplicate-review-session"
import type { DuplicateGroup, GpdMediaItem } from "../../lib/types"

const items: Record<string, GpdMediaItem> = {
  keep: {
    mediaKey: "keep",
    dedupKey: "asset-keep",
    provider: "google",
    thumb: "keep",
    timestamp: 1,
    creationTimestamp: 1
  },
  duplicate: {
    mediaKey: "duplicate",
    dedupKey: "asset-duplicate",
    provider: "google",
    thumb: "duplicate",
    timestamp: 1,
    creationTimestamp: 2
  }
}
const group: DuplicateGroup = {
  id: "ephemeral-group-id",
  mediaKeys: ["keep", "duplicate"],
  originalMediaKey: "keep",
  similarity: 1
}

describe("decision memory", () => {
  it("captures manual decisions without persisting automatic recommendations", () => {
    const records = captureManualDecisionRecords({
      groups: [group],
      mediaItems: items,
      provider: "google",
      accountEmail: "buyer@example.com",
      selections: {
        selectedGroupIds: new Set([group.id]),
        reviewedGroupIds: new Set([group.id]),
        keptOverrides: { [group.id]: new Set(["keep"]) },
        keepDecisionProvenance: { [group.id]: { source: "manual" } }
      },
      now: 100
    })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      provider: "google",
      selection: "selected",
      keptIdentities: ["google:provider:google:asset-keep"]
    })
  })

  it("reapplies a decision when the transient group id and media order change", () => {
    const records = captureManualDecisionRecords({
      groups: [group],
      mediaItems: items,
      provider: "google",
      accountEmail: "buyer@example.com",
      selections: {
        selectedGroupIds: new Set([group.id]),
        reviewedGroupIds: new Set([group.id]),
        keptOverrides: { [group.id]: new Set(["keep"]) },
        keepDecisionProvenance: { [group.id]: { source: "manual" } }
      },
      now: 100
    })
    const nextGroup = { ...group, id: "new-group-id", mediaKeys: ["duplicate", "keep"] }
    const applied = applyRememberedDecisions({
      records,
      groups: [nextGroup],
      mediaItems: items,
      provider: "google",
      accountEmail: "buyer@example.com",
      now: 100
    })

    expect(applied.selectedGroupIds).toEqual(new Set(["new-group-id"]))
    expect(applied.reviewedGroupIds).toEqual(new Set(["new-group-id"]))
    expect(applied.keptOverrides["new-group-id"]).toEqual(new Set(["keep"]))
    expect(applied.keepDecisionProvenance?.["new-group-id"]).toEqual({
      source: "manual"
    })
  })

  it("preserves identity-validated remembered manual keepers and replaces unproven legacy keepers", () => {
    const records = captureManualDecisionRecords({
      groups: [group],
      mediaItems: items,
      provider: "google",
      accountEmail: "buyer@example.com",
      selections: {
        selectedGroupIds: new Set([group.id]),
        reviewedGroupIds: new Set([group.id]),
        keptOverrides: { [group.id]: new Set(["keep"]) },
        keepDecisionProvenance: { [group.id]: { source: "manual" } }
      },
      now: 100
    })
    const restoredManualGroup = {
      ...group,
      id: "restored-manual-group",
      mediaKeys: ["duplicate", "keep"]
    }
    const legacyGroup: DuplicateGroup = {
      id: "unproven-legacy-group",
      mediaKeys: ["legacy-worse", "legacy-best"],
      originalMediaKey: "legacy-worse",
      similarity: 1
    }
    const allGroups = [restoredManualGroup, legacyGroup]
    const allItems = {
      ...items,
      "legacy-worse": {
        mediaKey: "legacy-worse",
        dedupKey: "asset-legacy-worse",
        provider: "google" as const,
        thumb: "legacy-worse",
        timestamp: 1,
        creationTimestamp: 1,
        isOriginalQuality: false
      },
      "legacy-best": {
        mediaKey: "legacy-best",
        dedupKey: "asset-legacy-best",
        provider: "google" as const,
        thumb: "legacy-best",
        timestamp: 1,
        creationTimestamp: 1,
        isOriginalQuality: true
      }
    }
    const remembered = applyRememberedDecisions({
      records,
      groups: allGroups,
      mediaItems: allItems,
      provider: "google",
      accountEmail: "buyer@example.com",
      now: 100
    })
    expect(remembered.keptOverrides[restoredManualGroup.id]).toEqual(
      new Set(["keep"])
    )
    expect(remembered.keepDecisionProvenance?.[restoredManualGroup.id]).toEqual({
      source: "manual"
    })

    const previousSelections = {
      selectedGroupIds: new Set([legacyGroup.id]),
      reviewedGroupIds: new Set([legacyGroup.id]),
      keptOverrides: { [legacyGroup.id]: new Set(["legacy-worse"]) }
    }
    const combined = {
      selectedGroupIds: new Set([
        ...previousSelections.selectedGroupIds,
        ...remembered.selectedGroupIds
      ]),
      reviewedGroupIds: new Set([
        ...previousSelections.reviewedGroupIds,
        ...remembered.reviewedGroupIds
      ]),
      keptOverrides: {
        ...previousSelections.keptOverrides,
        ...remembered.keptOverrides
      },
      keepDecisionProvenance: remembered.keepDecisionProvenance
    }
    const applied = applyDefaultKeepStrategyToSelections({
      groups: allGroups,
      mediaItems: allItems,
      selections: combined,
      strategy: "best_quality"
    })

    expect(applied.keptOverrides[restoredManualGroup.id]).toEqual(
      new Set(["keep"])
    )
    expect(applied.keepDecisionProvenance?.[restoredManualGroup.id]).toEqual({
      source: "manual"
    })
    expect(applied.keptOverrides[legacyGroup.id]).toEqual(new Set(["legacy-best"]))
    expect(applied.keepDecisionProvenance?.[legacyGroup.id]).toMatchObject({
      source: "automatic",
      strategy: "best_quality"
    })
    expect(applied.selectedGroupIds).toEqual(new Set([legacyGroup.id, restoredManualGroup.id]))
  })

  it("does not cross accounts or providers and fails closed for changed members", () => {
    const records = captureManualDecisionRecords({
      groups: [group],
      mediaItems: items,
      provider: "google",
      accountEmail: "buyer@example.com",
      selections: {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set([group.id]),
        keptOverrides: {},
        keepDecisionProvenance: {}
      },
      now: 100
    })
    expect(
      applyRememberedDecisions({
        records,
        groups: [group],
        mediaItems: items,
        provider: "google",
        accountEmail: "other@example.com",
        now: 100
      }).reviewedGroupIds.size
    ).toBe(0)
    expect(
      applyRememberedDecisions({
        records,
        groups: [group],
        mediaItems: items,
        provider: "icloud",
        accountEmail: "buyer@example.com",
        now: 100
      }).reviewedGroupIds.size
    ).toBe(0)
    const changedItems = { ...items, duplicate: { ...items.duplicate, dedupKey: "new-asset" } }
    expect(
      applyRememberedDecisions({
        records,
        groups: [group],
        mediaItems: changedItems,
        provider: "google",
        accountEmail: "buyer@example.com",
        now: 100
      }).reviewedGroupIds.size
    ).toBe(0)
  })

  it("bounds and replaces memory by stable key", () => {
    const base = captureManualDecisionRecords({
      groups: [group],
      mediaItems: items,
      provider: "google",
      accountEmail: "buyer@example.com",
      selections: {
        selectedGroupIds: new Set([group.id]),
        reviewedGroupIds: new Set([group.id]),
        keptOverrides: {},
        keepDecisionProvenance: {}
      },
      now: 100
    })
    const updated = base.map((record) => ({ ...record, selection: "skipped" as const, savedAt: 200 }))
    const merged = mergeDecisionMemory(base, updated, 200)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.selection).toBe("skipped")
    expect(stableGroupIdentity(group, items, "google")).toContain("group:")
  })
})
