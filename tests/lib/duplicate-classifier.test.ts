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
    timestampProvenance: "capture",
    creationTimestamp: Date.parse("2024-01-02T00:00:00.000Z"),
    creationTimestampProvenance: "creation",
    provider: "google",
    mediaKind: "photo",
    resWidth: 1920,
    resHeight: 1080,
    fileName: `${mediaKey}.jpg`,
    ...overrides
  }
}

const md5 = (digit: string) => digit.repeat(32)
const sha256 = (digit: string) => digit.repeat(64)

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

  it("treats local original-byte SHA-256 as cross-provider identity", () => {
    const result = classifyDuplicateItems([
      item("a", {
        dedupKey: "node-a",
        provider: "google",
        contentHash: {
          value: sha256("a"),
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes"
        }
      }),
      item("b", {
        dedupKey: "node-b",
        provider: "icloud",
        contentHash: {
          value: sha256("a"),
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes"
        }
      })
    ])

    expect(result).toMatchObject({
      duplicateKind: "exact",
      evidenceLevel: "verified_identical",
      canProposeTrash: true
    })
    expect(result.matchReasons).toContain(
      "same original-byte SHA-256 (sha256)"
    )
  })

  it("does not equate equal raw strings across algorithms or evidence sources", () => {
    const result = classifyDuplicateItems([
      item("sha", {
        contentHash: {
          value: sha256("b"),
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes"
        }
      }),
      item("fingerprint", {
        contentHash: {
          value: sha256("b"),
          algorithm: "provider-fingerprint",
          provenance: "original-content",
          verificationSource: "provider-fingerprint"
        }
      })
    ])

    expect(result.evidenceLevel).not.toBe("verified_identical")
    expect(result.duplicateKind).toBe("similar")
  })

  it.each(["video", "live-photo"] as const)(
    "does not equate a photo hash with a %s hash",
    (mediaKind) => {
      const result = classifyDuplicateItems([
        item("photo", {
          contentHash: {
            value: sha256("c"),
            algorithm: "sha256",
            provenance: "original-content",
            verificationSource: "local-original-bytes"
          }
        }),
        item("other-kind", {
          mediaKind,
          duration: mediaKind === "video" ? 1000 : undefined,
          contentHash: {
            value: sha256("c"),
            algorithm: "sha256",
            provenance: "original-content",
            verificationSource: "local-original-bytes"
          }
        })
      ])

      expect(result.evidenceLevel).not.toBe("verified_identical")
    }
  )

  it("keeps a still-only Live Photo hash as a candidate, not paired identity", () => {
    const stillOnly = classifyDuplicateItems([
      item("live-a", {
        mediaKind: "live-photo",
        contentHash: {
          value: sha256("e"),
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes",
          contentRole: "live-photo-still"
        }
      }),
      item("live-b", {
        mediaKind: "live-photo",
        contentHash: {
          value: sha256("e"),
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes",
          contentRole: "live-photo-still"
        }
      })
    ])
    expect(stillOnly.evidenceLevel).not.toBe("verified_identical")

    const paired = classifyDuplicateItems([
      item("paired-a", {
        mediaKind: "live-photo",
        contentHash: {
          value: sha256("f"),
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes",
          contentRole: "paired-live-photo"
        }
      }),
      item("paired-b", {
        mediaKind: "live-photo",
        contentHash: {
          value: sha256("f"),
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes",
          contentRole: "paired-live-photo"
        }
      })
    ])
    expect(paired.evidenceLevel).toBe("verified_identical")
  })

  it("normalizes hexadecimal digest casing", () => {
    const result = classifyDuplicateItems([
      item("lower", {
        contentHash: {
          value: sha256("d"),
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes"
        }
      }),
      item("upper", {
        contentHash: {
          value: sha256("d").toUpperCase(),
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes"
        }
      })
    ])

    expect(result.evidenceLevel).toBe("verified_identical")
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
