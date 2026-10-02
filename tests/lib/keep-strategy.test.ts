import { describe, expect, it } from "vitest"

import {
  chooseKeepKeyForGroup,
  describeKeepRecommendation,
  recommendDefaultKeepForGroup,
  recommendKeepForGroup
} from "../../lib/keep-strategy"
import type { KeepStrategy } from "../../lib/keep-strategy"
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
    timestampProvenance: "capture",
    creationTimestamp: Date.parse("2024-01-01T00:00:00.000Z"),
    creationTimestampProvenance: "creation",
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

  it("compares pixel area rather than the width-to-height ratio", () => {
    const recommendation = recommendKeepForGroup(
      group,
      {
        a: item("a", { resWidth: 4000, resHeight: 1000 }),
        b: item("b", { resWidth: 2500, resHeight: 2000 }),
        c: item("c", { resWidth: 1000, resHeight: 1000 })
      },
      "largest_resolution"
    )

    expect(recommendation).toMatchObject({
      status: "recommended",
      keptMediaKeys: ["b"],
      evidence: { winnerValue: 5_000_000 }
    })
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

  it("rejects negative dimensions even when their product looks like high resolution", () => {
    const recommendation = recommendKeepForGroup(
      group,
      {
        a: item("a", { resWidth: -4000, resHeight: -3000 }),
        b: item("b", { resWidth: 3000, resHeight: 2000 }),
        c: item("c", { resWidth: 2000, resHeight: 1000 })
      },
      "largest_resolution"
    )

    expect(recommendation).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "invalid_value",
      keptMediaKeys: ["a", "b", "c"]
    })
  })

  it("rejects resolution areas that overflow or underflow", () => {
    for (const dimensions of [
      { resWidth: Number.MAX_VALUE, resHeight: 2 },
      { resWidth: Number.MIN_VALUE, resHeight: Number.MIN_VALUE }
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

  it("chooses one deterministic default keeper from ties and incomplete metadata", () => {
    const tiedGroup: DuplicateGroup = {
      ...pairGroup,
      mediaKeys: ["z", "missing", "a"]
    }
    const recommendation = recommendDefaultKeepForGroup(
      tiedGroup,
      {
        z: item("z", {
          isOriginalQuality: true,
          resWidth: 1000,
          resHeight: 1000,
          size: 100
        }),
        a: item("a", {
          isOriginalQuality: true,
          resWidth: 1000,
          resHeight: 1000,
          size: 100
        })
      },
      "best_quality"
    )

    expect(recommendation).toMatchObject({
      status: "recommended",
      reasonCode: "deterministic_tiebreak",
      keptMediaKeys: ["a"]
    })
  })

  it("uses resolution and file size before stable media-key order", () => {
    const sameQuality: Record<string, GpdMediaItem> = {
      a: item("a", {
        isOriginalQuality: true,
        resWidth: 100,
        resHeight: 100,
        size: 200
      }),
      b: item("b", {
        isOriginalQuality: true,
        resWidth: 200,
        resHeight: 200,
        size: 100
      }),
      c: item("c", {
        isOriginalQuality: true,
        resWidth: 200,
        resHeight: 200,
        size: 300
      })
    }

    expect(
      recommendDefaultKeepForGroup(
        { ...group, mediaKeys: ["a", "b", "c"] },
        sameQuality,
        "best_quality"
      ).keptMediaKeys
    ).toEqual(["c"])
    expect(
      recommendDefaultKeepForGroup(
        { ...group, mediaKeys: ["c", "b", "a"] },
        sameQuality,
        "best_quality"
      ).keptMediaKeys
    ).toEqual(["c"])
  })

  it("uses a deterministic review default for tied detection group metadata", () => {
    const candidates = [
      item("z", { isOriginalQuality: true, resWidth: 500, resHeight: 500 }),
      item("a", { isOriginalQuality: true, resWidth: 500, resHeight: 500 })
    ]
    const recommend = (ordered: GpdMediaItem[]) =>
      recommendDefaultKeepForGroup(
        { mediaKeys: ordered.map(({ mediaKey }) => mediaKey) },
        Object.fromEntries(ordered.map((candidate) => [candidate.mediaKey, candidate])),
        "best_quality"
      ).keptMediaKeys

    expect(recommend(candidates)).toEqual(["a"])
    expect(recommend([...candidates].reverse())).toEqual(["a"])
  })

  it("keeps every item when capture-time values came from a fallback source", () => {
    const recommendation = recommendKeepForGroup(
      pairGroup,
      {
        a: item("a", {
          timestamp: 10,
          timestampProvenance: "creation"
        }),
        b: item("b", {
          timestamp: 20,
          timestampProvenance: "modified"
        })
      },
      "newest_taken"
    )

    expect(recommendation).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "unknown_provenance",
      keptMediaKeys: ["a", "b"],
      evidence: {
        provenanceByMediaKey: { a: "creation", b: "modified" }
      }
    })
    expect(recommendation.evidence.values).toEqual({ a: null, b: null })
    expect(describeKeepRecommendation(recommendation)).toContain(
      "capture-date provenance is unavailable"
    )
  })

  it("reports unknown provenance for fallback values in the oldest-taken strategy", () => {
    const recommendation = recommendKeepForGroup(
      pairGroup,
      {
        a: item("a", {
          timestamp: 10,
          timestampProvenance: "creation"
        }),
        b: item("b", {
          timestamp: 20,
          timestampProvenance: "modified"
        })
      },
      "oldest_taken"
    )

    expect(recommendation).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "unknown_provenance",
      keptMediaKeys: ["a", "b"]
    })
    expect(recommendation.evidence.provenanceByMediaKey).toEqual({
      a: "creation",
      b: "modified"
    })
    expect(recommendation.evidence.values).toEqual({ a: null, b: null })
  })

  it("does not treat a capture-date fallback as upload time", () => {
    const recommendation = recommendKeepForGroup(
      pairGroup,
      {
        a: item("a", {
          creationTimestamp: 10,
          creationTimestampProvenance: "capture"
        }),
        b: item("b", {
          creationTimestamp: 20,
          creationTimestampProvenance: "modified"
        })
      },
      "newest_upload"
    )

    expect(recommendation).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "unknown_provenance",
      keptMediaKeys: ["a", "b"]
    })
    expect(recommendation.evidence.values).toEqual({ a: null, b: null })
  })

  it("keeps an empty group empty in the deterministic default", () => {
    expect(
      recommendDefaultKeepForGroup({ mediaKeys: [] }, {}, "best_quality")
    ).toMatchObject({
      status: "no_confident_recommendation",
      reasonCode: "empty_group",
      keptMediaKeys: [],
      evidence: {
        field: "isOriginalQuality",
        comparedMediaKeys: [],
        missingMediaKeys: [],
        values: {},
        provenanceByMediaKey: {}
      }
    })
  })

  it.each([
    {
      strategy: "best_quality" as const,
      mediaItems: {
        selected: item("selected", { isOriginalQuality: true }),
        quality: item("quality", { isOriginalQuality: false }),
        unknown: item("unknown", { isOriginalQuality: null })
      }
    },
    {
      strategy: "largest_resolution" as const,
      mediaItems: {
        selected: item("selected", {
          isOriginalQuality: false,
          resWidth: 4000,
          resHeight: 3000
        }),
        quality: item("quality", {
          isOriginalQuality: true,
          resWidth: 1000,
          resHeight: 1000
        }),
        unknown: item("unknown", {
          isOriginalQuality: true,
          resWidth: Number.NaN
        })
      }
    },
    {
      strategy: "newest_taken" as const,
      mediaItems: {
        selected: item("selected", {
          isOriginalQuality: false,
          timestamp: 20
        }),
        quality: item("quality", {
          isOriginalQuality: true,
          timestamp: 10
        }),
        unknown: item("unknown", {
          isOriginalQuality: true,
          timestamp: 30,
          timestampProvenance: "modified"
        })
      }
    },
    {
      strategy: "oldest_taken" as const,
      mediaItems: {
        selected: item("selected", {
          isOriginalQuality: false,
          timestamp: 10
        }),
        quality: item("quality", {
          isOriginalQuality: true,
          timestamp: 20
        }),
        unknown: item("unknown", {
          isOriginalQuality: true,
          timestamp: 5,
          timestampProvenance: "modified"
        })
      }
    },
    {
      strategy: "newest_upload" as const,
      mediaItems: {
        selected: item("selected", {
          isOriginalQuality: false,
          creationTimestamp: 20
        }),
        quality: item("quality", {
          isOriginalQuality: true,
          creationTimestamp: 10
        }),
        unknown: item("unknown", {
          isOriginalQuality: true,
          creationTimestamp: 30,
          creationTimestampProvenance: "modified"
        })
      }
    },
    {
      strategy: "non_storage_counting" as const,
      mediaItems: {
        selected: item("selected", {
          isOriginalQuality: false,
          takesUpSpace: false
        }),
        quality: item("quality", {
          isOriginalQuality: true,
          takesUpSpace: true
        }),
        unknown: item("unknown", {
          isOriginalQuality: true,
          takesUpSpace: null
        })
      }
    }
  ] satisfies Array<{
    strategy: KeepStrategy
    mediaItems: Record<string, GpdMediaItem>
  }>)("uses the selected $strategy signal when metadata is incomplete", ({
    strategy,
    mediaItems
  }) => {
    const candidates: DuplicateGroup = {
      ...group,
      mediaKeys: ["selected", "quality", "unknown"]
    }
    expect(
      recommendKeepForGroup(candidates, mediaItems, strategy).status
    ).toBe("no_confident_recommendation")

    expect(
      recommendDefaultKeepForGroup(candidates, mediaItems, strategy)
    ).toMatchObject({
      status: "recommended",
      reasonCode: "deterministic_tiebreak",
      keptMediaKeys: ["selected"]
    })
  })

  it.each([
    {
      label: "negative dimensions",
      mediaKeys: ["z-negative", "a-valid"],
      mediaItems: {
        "z-negative": item("z-negative", {
          resWidth: -4000,
          resHeight: -3000
        }),
        "a-valid": item("a-valid", { resWidth: 3000, resHeight: 2000 })
      },
      expected: "a-valid"
    },
    {
      label: "an underflowing area",
      mediaKeys: ["z-underflow", "a-invalid"],
      mediaItems: {
        "z-underflow": item("z-underflow", {
          resWidth: 1e-200,
          resHeight: 1e-200
        }),
        "a-invalid": item("a-invalid", { resWidth: Number.NaN })
      },
      expected: "a-invalid"
    }
  ])("does not rank $label as a valid default resolution", ({
    mediaKeys,
    mediaItems,
    expected
  }) => {
    expect(
      recommendKeepForGroup({ mediaKeys }, mediaItems, "largest_resolution")
    ).toMatchObject({ status: "no_confident_recommendation" })
    expect(
      recommendDefaultKeepForGroup(
        { mediaKeys },
        mediaItems,
        "largest_resolution"
      ).keptMediaKeys
    ).toEqual([expected])
  })

  it.each([
    {
      label: "capture dates",
      mediaItems: {
        "a-newer": item("a-newer", {
          isOriginalQuality: true,
          timestamp: 20
        }),
        "m-untrusted": item("m-untrusted", {
          isOriginalQuality: true,
          timestamp: 1,
          timestampProvenance: "modified"
        }),
        "z-older": item("z-older", {
          isOriginalQuality: true,
          timestamp: 10
        })
      }
    },
    {
      label: "upload dates",
      mediaItems: {
        "a-newer": item("a-newer", {
          isOriginalQuality: true,
          creationTimestamp: 20
        }),
        "m-untrusted": item("m-untrusted", {
          isOriginalQuality: true,
          creationTimestamp: 1,
          creationTimestampProvenance: "modified"
        }),
        "z-older": item("z-older", {
          isOriginalQuality: true,
          creationTimestamp: 10
        })
      }
    }
  ])("uses trusted $label and excludes untrusted fallback values", ({
    mediaItems
  }) => {
    expect(
      recommendDefaultKeepForGroup(
        { mediaKeys: ["a-newer", "m-untrusted", "z-older"] },
        mediaItems,
        "best_quality"
      ).keptMediaKeys
    ).toEqual(["z-older"])
  })

  it("uses stable key order for fully tied candidates across permutations", () => {
    const keys = ["delta", "alpha", "charlie", "bravo"]
    const candidates = Object.fromEntries(
      keys.map((key) => [
        key,
        item(key, {
          isOriginalQuality: true,
          resWidth: 1000,
          resHeight: 1000,
          originalByteLength: 100,
          size: 100,
          spaceTaken: 100,
          timestamp: 10,
          creationTimestamp: 10
        })
      ])
    )
    const permutations = (remaining: string[]): string[][] =>
      remaining.length <= 1
        ? [remaining]
        : remaining.flatMap((key, index) =>
            permutations([
              ...remaining.slice(0, index),
              ...remaining.slice(index + 1)
            ]).map((tail) => [key, ...tail])
          )

    expect(
      permutations(keys).map(
        (mediaKeys) =>
          recommendDefaultKeepForGroup(
            { mediaKeys },
            candidates,
            "best_quality"
          ).keptMediaKeys[0]
      )
    ).toEqual(Array(24).fill("alpha"))
  })

  it("preserves evidence and the reason for a deterministic fallback", () => {
    const recommendation = recommendDefaultKeepForGroup(
      { mediaKeys: ["b", "a"] },
      {
        a: item("a", { isOriginalQuality: true }),
        b: item("b", { isOriginalQuality: true })
      },
      "best_quality"
    )

    expect(recommendation).toMatchObject({
      status: "recommended",
      reasonCode: "deterministic_tiebreak",
      keptMediaKeys: ["a"]
    })
    expect(recommendation.evidence).toEqual({
      field: "isOriginalQuality",
      comparedMediaKeys: ["b", "a"],
      missingMediaKeys: [],
      values: { b: true, a: true },
      provenanceByMediaKey: {},
      winnerMediaKey: "a"
    })
    expect(describeKeepRecommendation(recommendation)).toBe(
      "Suggested keep: Best quality (deterministic tie-break)"
    )
  })

  it("uses quality before later fallbacks when the selected strategy ties", () => {
    const candidates = {
      "a-lower-quality": item("a-lower-quality", {
        isOriginalQuality: false,
        resWidth: 2000,
        resHeight: 1000
      }),
      "z-best-quality": item("z-best-quality", {
        isOriginalQuality: true,
        resWidth: 2000,
        resHeight: 1000
      })
    }
    const tiedResolutionGroup = {
      mediaKeys: ["a-lower-quality", "z-best-quality"]
    }

    expect(
      recommendKeepForGroup(
        tiedResolutionGroup,
        candidates,
        "largest_resolution"
      )
    ).toMatchObject({ status: "no_confident_recommendation", reasonCode: "tie" })
    expect(
      recommendDefaultKeepForGroup(
        tiedResolutionGroup,
        candidates,
        "largest_resolution"
      ).keptMediaKeys
    ).toEqual(["z-best-quality"])
  })

  it("keeps best quality ahead of resolution when quality metadata is incomplete", () => {
    const candidates = {
      "a-known-best-quality": item("a-known-best-quality", {
        isOriginalQuality: true,
        resWidth: 1000,
        resHeight: 1000
      }),
      "z-unknown-higher-resolution": item("z-unknown-higher-resolution", {
        isOriginalQuality: null,
        resWidth: 4000,
        resHeight: 3000
      })
    }
    const incompleteQualityGroup = {
      mediaKeys: ["a-known-best-quality", "z-unknown-higher-resolution"]
    }

    expect(
      recommendKeepForGroup(
        incompleteQualityGroup,
        candidates,
        "best_quality"
      )
    ).toMatchObject({ status: "no_confident_recommendation" })
    expect(
      recommendDefaultKeepForGroup(
        incompleteQualityGroup,
        candidates,
        "best_quality"
      ).keptMediaKeys
    ).toEqual(["a-known-best-quality"])
  })

  it("uses resolution before file size when best-quality evidence ties", () => {
    const tiedQualityGroup = {
      mediaKeys: ["a-larger-file", "z-higher-resolution"]
    }
    const candidates = {
      "a-larger-file": item("a-larger-file", {
        isOriginalQuality: true,
        resWidth: 1000,
        resHeight: 1000,
        size: 1000
      }),
      "z-higher-resolution": item("z-higher-resolution", {
        isOriginalQuality: true,
        resWidth: 4000,
        resHeight: 3000,
        size: 100
      })
    }

    expect(
      recommendDefaultKeepForGroup(
        tiedQualityGroup,
        candidates,
        "best_quality"
      ).keptMediaKeys
    ).toEqual(["z-higher-resolution"])
  })

  it("treats a finite zero-byte size as known evidence", () => {
    const tiedQualityGroup = {
      mediaKeys: ["a-unknown-size", "z-zero-size"]
    }
    const candidates = {
      "a-unknown-size": item("a-unknown-size", {
        isOriginalQuality: true
      }),
      "z-zero-size": item("z-zero-size", {
        isOriginalQuality: true,
        size: 0
      })
    }

    expect(
      recommendDefaultKeepForGroup(
        tiedQualityGroup,
        candidates,
        "best_quality"
      ).keptMediaKeys
    ).toEqual(["z-zero-size"])
  })

  it("selects the smallest key from a descending fully tied group", () => {
    const mediaKeys = ["z", "m", "a"]
    const candidates = Object.fromEntries(
      mediaKeys.map((key) => [
        key,
        item(key, {
          isOriginalQuality: true,
          resWidth: 1000,
          resHeight: 1000,
          size: 100,
          timestamp: 10,
          creationTimestamp: 10
        })
      ])
    )

    expect(
      recommendDefaultKeepForGroup(
        { mediaKeys },
        candidates,
        "best_quality"
      ).keptMediaKeys
    ).toEqual(["a"])
  })

  it.each([
    { originalByteLength: -1, size: 1000 },
    { originalByteLength: Number.POSITIVE_INFINITY, size: 1000 }
  ])("skips an invalid original byte length before using file size", (invalid) => {
    const recommendation = recommendDefaultKeepForGroup(
      { mediaKeys: ["a-smaller", "z-larger"] },
      {
        "a-smaller": item("a-smaller", {
          isOriginalQuality: true,
          size: 500
        }),
        "z-larger": item("z-larger", {
          isOriginalQuality: true,
          ...invalid
        })
      },
      "best_quality"
    )

    expect(recommendation.keptMediaKeys).toEqual(["z-larger"])
  })
})
