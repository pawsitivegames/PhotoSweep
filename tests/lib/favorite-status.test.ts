import { describe, expect, it } from "vitest"

import {
  favoriteSourceForItem,
  favoriteStatusForItem
} from "../../lib/favorite-status"
import type { GpdMediaItem } from "../../lib/types"

function item(overrides: Partial<GpdMediaItem> = {}): GpdMediaItem {
  return {
    mediaKey: "photo",
    dedupKey: "asset:photo",
    thumb: "https://example.test/thumb",
    timestamp: 1,
    creationTimestamp: 1,
    ...overrides
  }
}

describe("favorite status normalization", () => {
  it("fails malformed favorite enums to unknown instead of not-favorite", () => {
    const malformed = item({
      favoriteStatus: "notfavorite" as GpdMediaItem["favoriteStatus"],
      isFavorite: false
    })

    expect(favoriteStatusForItem(malformed)).toBe("unknown")
    expect(favoriteSourceForItem(malformed)).toBe("unavailable")
  })

  it("lets a confirmed positive legacy flag override contradictory negative status", () => {
    const contradictory = item({
      favoriteStatus: "not-favorite",
      favoriteSource: "provider-metadata",
      isFavorite: true
    })

    expect(favoriteStatusForItem(contradictory)).toBe("favorite")
    expect(favoriteSourceForItem(contradictory)).toBe("unavailable")
  })

  it("preserves explicit not-favorite and unknown without coercion", () => {
    expect(
      favoriteStatusForItem(
        item({
          favoriteStatus: "not-favorite",
          favoriteSource: "provider-lookup"
        })
      )
    ).toBe("not-favorite")
    expect(
      favoriteStatusForItem(
        item({
          favoriteStatus: "unknown",
          favoriteSource: "unavailable",
          // Old persisted rows may have a cached false while the current
          // provider lookup explicitly reports unknown.
          isFavorite: false
        })
      )
    ).toBe("unknown")
  })
})
