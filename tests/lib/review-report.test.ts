import { describe, expect, it } from "vitest"

import { buildReviewReport, reviewReportToCsv } from "../../lib/review-report"
import type { DuplicateGroup, GpdMediaItem } from "../../lib/types"

function makeItem(
  mediaKey: string,
  fileName = `${mediaKey}.jpg`
): GpdMediaItem {
  return {
    mediaKey,
    dedupKey: `dk-${mediaKey}`,
    thumb: `https://example.com/${mediaKey}`,
    productUrl: `https://photos.google.com/photo/${mediaKey}`,
    timestamp: Date.parse("2024-06-01T12:00:00.000Z"),
    creationTimestamp: Date.parse("2024-06-02T12:00:00.000Z"),
    resWidth: 1920,
    resHeight: 1080,
    fileName,
    isOriginalQuality: true,
    takesUpSpace: true,
    spaceTaken: 123456
  }
}

const group: DuplicateGroup = {
  id: "group-1",
  mediaKeys: ["keep", "trash"],
  originalMediaKey: "keep",
  similarity: 0.9
}

describe("review report", () => {
  it("marks non-kept items in selected groups as selected for trash", () => {
    const report = buildReviewReport({
      groups: [group],
      mediaItems: {
        keep: makeItem("keep"),
        trash: makeItem("trash")
      },
      selectedGroupIds: new Set(["group-1"]),
      getKept: () => new Set(["keep"])
    })

    expect(report.totalGroups).toBe(1)
    expect(report.totalItems).toBe(2)
    expect(report.totalGroupsSelected).toBe(1)
    expect(report.totalItemsSelectedForTrash).toBe(1)
    expect(report.items.find((item) => item.mediaKey === "keep")).toMatchObject(
      {
        kept: true,
        selectedForTrash: false
      }
    )
    expect(
      report.items.find((item) => item.mediaKey === "trash")
    ).toMatchObject({
      kept: false,
      selectedForTrash: true,
      duplicateKind: "similar"
    })
  })

  it("includes duplicate classification in JSON and CSV review exports", () => {
    const report = buildReviewReport({
      groups: [
        {
          ...group,
          duplicateKind: "exact",
          matchReasons: ["same filename", "same dimensions"]
        }
      ],
      mediaItems: {
        keep: makeItem("keep", "IMG.jpg"),
        trash: makeItem("trash", "IMG.jpg")
      },
      selectedGroupIds: new Set(["group-1"]),
      getKept: () => new Set(["keep"])
    })

    expect(report.items[0]).toMatchObject({
      duplicateKind: "similar",
      evidenceLevel: "strong_duplicate_candidate",
      matchReasons: [
        "same filename",
        "same filename stem",
        "same dimensions",
        "same taken date"
      ]
    })

    const csv = reviewReportToCsv(report)
    expect(csv).toContain("duplicateKind,matchReasons")
    expect(csv).toContain(
      '"same filename,same filename stem,same dimensions,same taken date"'
    )
  })

  it("includes storage accounting metadata in review exports", () => {
    const report = buildReviewReport({
      groups: [group],
      mediaItems: {
        keep: makeItem("keep"),
        trash: {
          ...makeItem("trash"),
          isOriginalQuality: false,
          takesUpSpace: false,
          spaceTaken: 0
        }
      },
      selectedGroupIds: new Set(["group-1"]),
      getKept: () => new Set(["trash"])
    })

    expect(
      report.items.find((item) => item.mediaKey === "trash")
    ).toMatchObject({
      isOriginalQuality: false,
      takesUpSpace: false,
      spaceTaken: 0
    })

    const csv = reviewReportToCsv(report)
    expect(csv).toContain("isOriginalQuality,takesUpSpace,spaceTaken")
    expect(csv).toContain("false,false,0")
  })

  it("counts selected groups only within the exported report scope", () => {
    const report = buildReviewReport({
      groups: [group],
      mediaItems: {
        keep: makeItem("keep"),
        trash: makeItem("trash")
      },
      selectedGroupIds: new Set(["group-1", "hidden-group"]),
      getKept: () => new Set(["keep"])
    })

    expect(report.totalGroupsSelected).toBe(1)
  })

  it("falls back to the group original when kept overrides are stale", () => {
    const report = buildReviewReport({
      groups: [group],
      mediaItems: {
        keep: makeItem("keep"),
        trash: makeItem("trash")
      },
      selectedGroupIds: new Set(["group-1"]),
      getKept: () => new Set(["missing-key"])
    })

    expect(report.totalItemsSelectedForTrash).toBe(1)
    expect(report.items.find((item) => item.mediaKey === "keep")).toMatchObject(
      {
        kept: true,
        selectedForTrash: false
      }
    )
    expect(
      report.items.find((item) => item.mediaKey === "trash")
    ).toMatchObject({
      kept: false,
      selectedForTrash: true
    })
  })

  it("preserves zero-valued timestamps in exports", () => {
    const report = buildReviewReport({
      groups: [group],
      mediaItems: {
        keep: makeItem("keep", "keep.jpg"),
        trash: {
          ...makeItem("trash"),
          timestamp: 0,
          creationTimestamp: 0
        }
      },
      selectedGroupIds: new Set(["group-1"]),
      getKept: () => new Set(["keep"])
    })

    expect(
      report.items.find((item) => item.mediaKey === "trash")
    ).toMatchObject({
      takenAt: "1970-01-01T00:00:00.000Z",
      uploadedAt: "1970-01-01T00:00:00.000Z"
    })
  })

  it("escapes CSV fields for spreadsheet review", () => {
    const report = buildReviewReport({
      groups: [group],
      mediaItems: {
        keep: makeItem("keep", 'family, "best".jpg'),
        trash: makeItem("trash")
      },
      selectedGroupIds: new Set(["group-1"]),
      getKept: () => new Set(["keep"])
    })

    const csv = reviewReportToCsv(report)
    expect(csv).toContain("duplicateGroupId,groupSelected,selectedForTrash")
    expect(csv).toContain('"family, ""best"".jpg"')
  })
})
