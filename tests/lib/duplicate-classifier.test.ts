import { describe, expect, it } from "vitest"

import {
  classifyDuplicateGroup,
  classifyDuplicateItems,
  isTrustedContentHash
} from "../../lib/duplicate-classifier"
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
    creationTimestamp: Date.parse("2024-01-02T00:00:00.000Z"),
    resWidth: 1920,
    resHeight: 1080,
    fileName: `${mediaKey}.jpg`,
    ...overrides
  }
}

const md5 = (digit: string) => digit.repeat(32)

describe("duplicate classifier", () => {
  it("does not treat provider asset IDs as content equality", () => {
    const result = classifyDuplicateItems([
      item("a", { dedupKey: "same" }),
      item("b", { dedupKey: "same" })
    ])

    expect(result).toMatchObject({
      duplicateKind: "similar",
      evidenceLevel: "similar",
      relationship: "same_provider_asset",
      canProposeTrash: false
    })
    expect(result.matchReasons).toContain(
      "same provider asset identity (not content equality)"
    )
  })

  it("treats a validated original-content hash as verified identity", () => {
    const result = classifyDuplicateItems([
      item("a", {
        dedupKey: "node-a",
        contentHash: {
          value: md5("a"),
          algorithm: "md5",
          provenance: "original-content"
        }
      }),
      item("b", {
        dedupKey: "node-b",
        contentHash: {
          value: md5("a"),
          algorithm: "md5",
          provenance: "original-content"
        }
      })
    ])

    expect(result).toMatchObject({
      duplicateKind: "exact",
      evidenceLevel: "verified_identical",
      canProposeTrash: true
    })
    expect(result.matchReasons).toContain("same original-content hash (md5)")
  })

  it("rejects malformed, derived, and legacy hashes as verified evidence", () => {
    expect(
      isTrustedContentHash({
        value: "not-a-hash",
        algorithm: "md5",
        provenance: "original-content"
      })
    ).toBe(false)
    expect(
      isTrustedContentHash({
        value: md5("a"),
        algorithm: "md5",
        provenance: "derived-preview"
      })
    ).toBe(false)

    const result = classifyDuplicateItems([
      item("a", { exactContentHash: "legacy-same" }),
      item("b", { exactContentHash: "legacy-same" })
    ])

    expect(result.evidenceLevel).not.toBe("verified_identical")
    expect(result.duplicateKind).toBe("similar")
    expect(result.matchReasons).toContain("same legacy content hash (unverified)")
  })

  it("classifies matching metadata as a strong candidate, never verified identity", () => {
    const result = classifyDuplicateItems([
      item("a", { fileName: "IMG.jpg" }),
      item("b", { fileName: "IMG.jpg" })
    ])

    expect(result).toMatchObject({
      duplicateKind: "similar",
      evidenceLevel: "strong_duplicate_candidate",
      canProposeTrash: true
    })
    expect(result.matchReasons).toEqual(
      expect.arrayContaining([
        "same filename",
        "same dimensions",
        "same taken date"
      ])
    )
  })

  it("keeps visual-only matches below the strong threshold unless evidence is high", () => {
    const items = [
      item("a", { thumb: "same-thumb" }),
      item("b", { thumb: "same-thumb", timestamp: Date.parse("2024-01-03") })
    ]

    expect(classifyDuplicateItems(items, 0.96).evidenceLevel).toBe("similar")
    expect(classifyDuplicateItems(items, 0.99)).toMatchObject({
      duplicateKind: "similar",
      evidenceLevel: "strong_duplicate_candidate"
    })
  })

  it("classifies strong video metadata matches as candidates", () => {
    const result = classifyDuplicateItems([
      item("a", {
        fileName: "clip.mov",
        timestamp: Date.parse("2021-01-01"),
        duration: 12_345
      }),
      item("b", {
        fileName: "clip.mov",
        timestamp: Date.parse("2024-01-01"),
        duration: 12_345
      })
    ])

    expect(result).toMatchObject({
      duplicateKind: "similar",
      evidenceLevel: "strong_duplicate_candidate"
    })
    expect(result.matchReasons).toEqual(
      expect.arrayContaining(["same filename", "same dimensions", "same duration"])
    )
  })

  it("marks RAW/JPEG pairs as a review-only related format relationship", () => {
    const result = classifyDuplicateItems([
      item("raw", { fileName: "IMG_1001.CR3" }),
      item("jpeg", { fileName: "IMG_1001.JPG" })
    ])

    expect(result).toMatchObject({
      evidenceLevel: "similar",
      relationship: "related_format_edit",
      canProposeTrash: false
    })
    expect(result.matchReasons).toContain("RAW/JPEG format relationship")
  })

  it("reclassifies legacy stored exact values from current item evidence", () => {
    const group: DuplicateGroup = {
      id: "g1",
      mediaKeys: ["a", "b"],
      originalMediaKey: "a",
      similarity: 0.99,
      duplicateKind: "exact",
      matchReasons: ["same filename"]
    }

    expect(
      classifyDuplicateGroup(group, {
        a: item("a", { fileName: "different-a.jpg" }),
        b: item("b", { fileName: "different-b.jpg" })
      })
    ).toMatchObject({
      duplicateKind: "similar",
      evidenceLevel: "strong_duplicate_candidate"
    })
  })
})
