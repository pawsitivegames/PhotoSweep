import { describe, expect, it } from "vitest"

import {
  chooseKeepKeyForGroup,
  recommendKeepForGroup
} from "../../lib/keep-strategy"
import type { DuplicateGroup, GpdMediaItem } from "../../lib/types"

function item(
  mediaKey: string,
  overrides: Partial<GpdMediaItem> = {}
): GpdMediaItem {
  return {
    mediaKey,
    dedupKey: `dk-${mediaKey}`,
    thumb: `https://example.com/${mediaKey}`,
    timestamp: Date.parse("2024-01-01T00:00:00.000Z"),
    creationTimestamp: Date.parse("2024-01-01T00:00:00.000Z"),
    resWidth: 1000,
    resHeight: 1000,
    isOriginalQuality: null,
    ...overrides
  }
}

const group: DuplicateGroup = {
  id: "group-1",
  mediaKeys: ["a", "b", "c"],
  originalMediaKey: "a",
  similarity: 0.99
}

const pairGroup: DuplicateGroup = {
  id: "pair-1",
  mediaKeys: ["a", "b"],
  originalMediaKey: "a",
  similarity: 0.99
}

describe("keep strategy", () => {
  it("does not let metadata completeness override the selected strategy", () => {
    expect(
      chooseKeepKeyForGroup(
        pairGroup,
        {
          a: item("a", {
            dedupKey: "same-dedup-key",
            contentHash: {
              value: "a".repeat(32),
              algorithm: "md5",
              provenance: "original-content"
            },
            isOriginalQuality: true,
            resWidth: 4000,
            resHeight: 3000,
            fileName: undefined,
            size: undefined,
            takesUpSpace: null,
            spaceTaken: undefined,
            productUrl: undefined
          }),
          b: item("b", {
            dedupKey: "different-dedup-key",
            contentHash: {
              value: "a".repeat(32),
              algorithm: "md5",
              provenance: "original-content"
            },
            isOriginalQuality: false,
            resWidth: 1000,
            resHeight: 1000,
            fileName: "metadata-rich.jpg",
            size: 123456,
            takesUpSpace: true,
            spaceTaken: 123456,
            productUrl: "https://photos.google.com/photo/b"
          })
        },
        "best_quality"
      )
    ).toBe("a")
  })

  it("does not prefer metadata over quality for similar-only pairs", () => {
    expect(
      chooseKeepKeyForGroup(
        pairGroup,
        {
          a: item("a", {
            dedupKey: "dedup-a",
            isOriginalQuality: true,
            resWidth: 4000,
            resHeight: 3000
          }),
          b: item("b", {
            dedupKey: "dedup-b",
            isOriginalQuality: false,
            resWidth: 1000,
            resHeight: 1000,
            fileName: "metadata-rich.jpg",
            size: 123456,
            takesUpSpace: true,
            spaceTaken: 123456,
            productUrl: "https://photos.google.com/photo/b"
          })
        },
        "best_quality"
      )
    ).toBe("a")
  })

  it("keeps the original-quality item for best quality", () => {
    expect(
      chooseKeepKeyForGroup(
        group,
        {
          a: item("a", { isOriginalQuality: false, resWidth: 4000 }),
          b: item("b", { isOriginalQuality: true, resWidth: 1000 }),
          c: item("c", { isOriginalQuality: false, resWidth: 3000 })
        },
        "best_quality"
      )
    ).toBe("b")
  })

  it("keeps all items when the selected quality strategy ties", () => {
    expect(
      chooseKeepKeyForGroup(
        group,
        {
          a: item("a", {
            timestamp: Date.parse("2024-01-01T00:00:00.000Z"),
            isOriginalQuality: true,
            resWidth: 4000,
            resHeight: 3000
          }),
          b: item("b", {
            timestamp: Date.parse("2021-01-01T00:00:00.000Z"),
            isOriginalQuality: true,
            resWidth: 1000,
            resHeight: 1000
          }),
          c: item("c", {
            timestamp: Date.parse("2023-01-01T00:00:00.000Z"),
            isOriginalQuality: true,
            resWidth: 3000,
            resHeight: 2000
          })
        },
        "best_quality"
      )
    ).toBeNull()
  })

  it("keeps all items when the selected quality strategy has missing values", () => {
    expect(
      chooseKeepKeyForGroup(
        group,
        {
          a: item("a", {
            timestamp: undefined,
            isOriginalQuality: true,
            resWidth: 4000,
            resHeight: 3000
          }),
          b: item("b", {
            timestamp: Date.parse("2024-01-01T00:00:00.000Z"),
            isOriginalQuality: true,
            resWidth: 1000,
            resHeight: 1000
          }),
          c: item("c", {
            timestamp: undefined,
            isOriginalQuality: true,
            resWidth: 3000,
            resHeight: 2000
          })
        },
        "best_quality"
      )
    ).toBeNull()
  })

  it("does not fall back to another field when best quality is tied", () => {
    expect(
      chooseKeepKeyForGroup(
        group,
        {
          a: item("a", {
            timestamp: undefined,
            isOriginalQuality: true,
            resWidth: 1000,
            resHeight: 1000
          }),
          b: item("b", {
            timestamp: undefined,
            isOriginalQuality: true,
            resWidth: 4000,
            resHeight: 3000
          }),
          c: item("c", {
            timestamp: undefined,
            isOriginalQuality: true,
            resWidth: 3000,
            resHeight: 2000
          })
        },
        "best_quality"
      )
    ).toBeNull()
  })

  it("keeps a newer taken item for best quality when it is better quality", () => {
    expect(
      chooseKeepKeyForGroup(
        group,
        {
          a: item("a", {
            timestamp: Date.parse("2021-01-01T00:00:00.000Z"),
            isOriginalQuality: false,
            resWidth: 4000,
            resHeight: 3000
          }),
          b: item("b", {
            timestamp: Date.parse("2024-01-01T00:00:00.000Z"),
            isOriginalQuality: true,
            resWidth: 1000,
            resHeight: 1000
          }),
          c: item("c", {
            timestamp: Date.parse("2023-01-01T00:00:00.000Z"),
            isOriginalQuality: false,
            resWidth: 3000,
            resHeight: 2000
          })
        },
        "best_quality"
      )
    ).toBe("b")
  })

  it("keeps the item with the largest resolution", () => {
    expect(
      chooseKeepKeyForGroup(
        group,
        {
          a: item("a", { resWidth: 1000, resHeight: 1000 }),
          b: item("b", { resWidth: 3000, resHeight: 2000 }),
          c: item("c", { resWidth: 2000, resHeight: 2000 })
        },
        "largest_resolution"
      )
    ).toBe("b")
  })

  it("keeps newest and oldest taken dates", () => {
    const mediaItems = {
      a: item("a", { timestamp: Date.parse("2022-01-01T00:00:00.000Z") }),
      b: item("b", { timestamp: Date.parse("2024-01-01T00:00:00.000Z") }),
      c: item("c", { timestamp: Date.parse("2023-01-01T00:00:00.000Z") })
    }

    expect(chooseKeepKeyForGroup(group, mediaItems, "newest_taken")).toBe("b")
    expect(chooseKeepKeyForGroup(group, mediaItems, "oldest_taken")).toBe("a")
  })

  it("keeps the newest upload date", () => {
    expect(
      chooseKeepKeyForGroup(
        group,
        {
          a: item("a", {
            creationTimestamp: Date.parse("2022-01-01T00:00:00.000Z")
          }),
          b: item("b", {
            creationTimestamp: Date.parse("2024-01-01T00:00:00.000Z")
          }),
          c: item("c", {
            creationTimestamp: Date.parse("2023-01-01T00:00:00.000Z")
          })
        },
        "newest_upload"
      )
    ).toBe("b")
  })

  it("keeps the item confirmed not to count against storage", () => {
    expect(
      chooseKeepKeyForGroup(
        group,
        {
          a: item("a", { takesUpSpace: true, isOriginalQuality: true }),
          b: item("b", { takesUpSpace: false, isOriginalQuality: false }),
          c: item("c", { takesUpSpace: true, isOriginalQuality: true })
        },
        "non_storage_counting"
      )
    ).toBe("b")
  })

  it("returns structured evidence for a unique recommendation", () => {
    const recommendation = recommendKeepForGroup(
      group,
      {
        a: item("a", { timestamp: 1 }),
        b: item("b", { timestamp: 3 }),
        c: item("c", { timestamp: 2 })
      },
      "newest_taken"
    )

    expect(recommendation).toMatchObject({
      status: "recommended",
      keptMediaKeys: ["b"],
      reasonCode: "unique_best_value",
      evidence: {
        field: "timestamp",
        comparedMediaKeys: ["a", "b", "c"],
        missingMediaKeys: [],
        winnerMediaKey: "b",
        winnerValue: 3
      }
    })
  })

  it("keeps every group member for ties, invalid values, or missing members", () => {
    const tied = recommendKeepForGroup(
      group,
      {
        a: item("a", { resWidth: 1000, resHeight: 1000 }),
        b: item("b", { resWidth: 1000, resHeight: 1000 }),
        c: item("c", { resWidth: 1000, resHeight: 1000 })
      },
      "largest_resolution"
    )
    const invalid = recommendKeepForGroup(
      group,
      {
        a: item("a", { resWidth: undefined }),
        b: item("b"),
        c: item("c")
      },
      "largest_resolution"
    )
    const missing = recommendKeepForGroup(
      group,
      { a: item("a"), b: item("b") },
      "best_quality"
    )

    expect(tied).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "tie",
      keptMediaKeys: ["a", "b", "c"]
    })
    expect(invalid).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "invalid_value",
      keptMediaKeys: ["a", "b", "c"]
    })
    expect(missing).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "missing_member",
      keptMediaKeys: ["a", "b", "c"],
      evidence: { missingMediaKeys: ["c"] }
    })
  })

  it("treats zero resolution dimensions as invalid evidence", () => {
    for (const dimensions of [
      { resWidth: 0, resHeight: 1000 },
      { resWidth: 1000, resHeight: 0 }
    ]) {
      const recommendation = recommendKeepForGroup(
        group,
        {
          a: item("a", dimensions),
          b: item("b"),
          c: item("c")
        },
        "largest_resolution"
      )
      expect(recommendation).toMatchObject({
        status: "no_confident_recommendation",
        reasonCode: "invalid_value",
        keptMediaKeys: ["a", "b", "c"]
      })
    }
  })

  it("does not make a different winner when group order is permuted", () => {
    const mediaItems = {
      a: item("a", { creationTimestamp: 1 }),
      b: item("b", { creationTimestamp: 3 }),
      c: item("c", { creationTimestamp: 2 })
    }
    const first = recommendKeepForGroup(group, mediaItems, "newest_upload")
    const permuted = recommendKeepForGroup(
      { ...group, mediaKeys: ["c", "a", "b"] },
      mediaItems,
      "newest_upload"
    )

    expect(first.keptMediaKeys).toEqual(["b"])
    expect(permuted.keptMediaKeys).toEqual(["b"])
  })
})
