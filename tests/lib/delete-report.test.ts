import { describe, expect, it } from "vitest"

import { buildDeleteReport } from "../../lib/delete-report"
import type { DuplicateGroup, GpdMediaItem } from "../../lib/types"

function makeItem(
  mediaKey: string,
  provider: GpdMediaItem["provider"] = "google",
  productUrl = `https://photos.google.com/photo/${mediaKey}`
): GpdMediaItem {
  return {
    mediaKey,
    dedupKey: `dk-${mediaKey}`,
    thumb: `https://example.com/${mediaKey}`,
    productUrl,
    provider,
    timestamp: 0,
    timestampProvenance: "capture",
    creationTimestamp: Date.parse("2024-06-02T12:00:00.000Z"),
    creationTimestampProvenance: "creation",
    mediaKind: "photo",
    resWidth: 1920,
    resHeight: 1080,
    fileName: `${mediaKey}.jpg`,
    isOriginalQuality: false,
    takesUpSpace: true,
    spaceTaken: 123456
  }
}

const group: DuplicateGroup = {
  id: "group-1",
  mediaKeys: ["keep", "trash"],
  originalMediaKey: "keep",
  similarity: 0.9,
  duplicateKind: "exact",
  matchReasons: ["same dedupKey"]
}

describe("delete report", () => {
  it("records exactly kept and trash items for selected groups", () => {
    const report = buildDeleteReport({
      groups: [group],
      mediaItems: {
        keep: makeItem("keep"),
        trash: {
          ...makeItem("trash"),
          favoriteStatus: "unknown",
          favoriteSource: "unavailable",
          // This stale legacy negative must not overwrite the explicit
          // unknown that the shared normalizer sends to reports.
          isFavorite: false
        }
      },
      selectedGroupIds: new Set(["group-1"]),
      getKept: () => new Set(["keep"]),
      mediaKeysToTrash: ["trash"],
      trashBatchSize: 25
    })

    expect(report.totalGroupsAffected).toBe(1)
    expect(report.totalItemsKept).toBe(1)
    expect(report.totalItemsSelectedForTrash).toBe(1)
    expect(report.trashBatchSize).toBe(25)
    expect(report.items).toHaveLength(2)
    expect(report.items.find((item) => item.mediaKey === "keep")).toMatchObject(
      {
        action: "keep",
        takenAt: "1970-01-01T00:00:00.000Z",
        resolution: "1920x1080",
        duplicateKind: "similar",
        evidenceLevel: "similar",
        matchReasons: ["same dimensions", "same taken date"]
      }
    )
    expect(
      report.items.find((item) => item.mediaKey === "trash")
    ).toMatchObject({
      action: "trash",
      reason: "Selected non-keep item for trash",
      favoriteStatus: "unknown",
      favoriteSource: "unavailable",
      providerUrl: "https://photos.google.com/photo/trash",
      googlePhotosUrl: "https://photos.google.com/photo/trash"
    })
  })

  it("keeps provider item links in delete reports for iCloud and Amazon", () => {
    const report = buildDeleteReport({
      groups: [group],
      mediaItems: {
        keep: makeItem(
          "keep",
          "icloud",
          "https://www.icloud.com/photos/#/photo/keep"
        ),
        trash: makeItem(
          "trash",
          "amazon",
          "https://www.amazon.ca/photos/all/gallery/trash"
        )
      },
      selectedGroupIds: new Set(["group-1"]),
      getKept: () => new Set(["keep"]),
      mediaKeysToTrash: ["trash"],
      trashBatchSize: 25
    })

    expect(report.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mediaKey: "keep",
          providerUrl: "https://www.icloud.com/photos/#/photo/keep"
        }),
        expect.objectContaining({
          mediaKey: "trash",
          providerUrl: "https://www.amazon.ca/photos/all/gallery/trash"
        })
      ])
    )
  })

  it("ignores unselected groups and selected groups with no trash candidates", () => {
    const unselectedGroup: DuplicateGroup = {
      id: "hidden-group",
      mediaKeys: ["hidden-keep", "hidden-trash"],
      originalMediaKey: "hidden-keep",
      similarity: 0.95
    }
    const allKeptGroup: DuplicateGroup = {
      id: "all-kept",
      mediaKeys: ["all-kept-1", "all-kept-2"],
      originalMediaKey: "all-kept-1",
      similarity: 0.95
    }

    const report = buildDeleteReport({
      groups: [group, unselectedGroup, allKeptGroup],
      mediaItems: {
        keep: makeItem("keep"),
        trash: makeItem("trash"),
        "hidden-keep": makeItem("hidden-keep"),
        "hidden-trash": makeItem("hidden-trash"),
        "all-kept-1": makeItem("all-kept-1"),
        "all-kept-2": makeItem("all-kept-2")
      },
      selectedGroupIds: new Set(["group-1", "all-kept"]),
      getKept: (candidate) =>
        candidate.id === "all-kept"
          ? new Set(["all-kept-1", "all-kept-2"])
          : new Set(["keep"]),
      mediaKeysToTrash: ["trash"],
      trashBatchSize: 25
    })

    expect(report.items.map((item) => item.mediaKey)).toEqual(["keep", "trash"])
    expect(report.totalGroupsAffected).toBe(1)
    expect(report.totalItemsSelectedForTrash).toBe(1)
  })

  it("records the group original as kept when kept overrides are stale", () => {
    const report = buildDeleteReport({
      groups: [group],
      mediaItems: {
        keep: makeItem("keep"),
        trash: makeItem("trash")
      },
      selectedGroupIds: new Set(["group-1"]),
      getKept: () => new Set(["missing-key"]),
      mediaKeysToTrash: ["trash"],
      trashBatchSize: 25
    })

    expect(report.totalItemsKept).toBe(1)
    expect(report.totalItemsSelectedForTrash).toBe(1)
    expect(report.items.find((item) => item.mediaKey === "keep")).toMatchObject(
      {
        action: "keep",
        reason: "Selected keep item for duplicate group"
      }
    )
  })
})
