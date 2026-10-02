/**
 * Unit tests for lib/scan-results.ts — areScanResultsValid().
 *
 * This function is exercised indirectly by app-reducer.test.ts but
 * a direct test makes the invalidation contract explicit and catches
 * future condition additions without relying on reducer state boilerplate.
 */
import { describe, it, expect } from "vitest"
import {
  areScanResultsValid,
  isValidICloudSyncToken,
  mergeCachedScanResults,
  reusableICloudSyncToken,
  shouldMergeCachedScanResults
} from "../../lib/scan-results"
import type { GpdMediaItem, ScanCoverage } from "../../lib/types"

const item = (mediaKey: string): GpdMediaItem => ({
  mediaKey,
  dedupKey: mediaKey,
  thumb: `data:image/png;base64,${mediaKey}`,
  provider: "icloud",
  productUrl: "https://www.icloud.com/photos",
  timestamp: 1,
  creationTimestamp: 1,
  fileName: mediaKey,
  takesUpSpace: null,
  isOriginalQuality: null
})

const coverage = (
  stopReason: ScanCoverage["stopReason"],
  status: ScanCoverage["status"] = "complete"
): ScanCoverage => ({
  status: status as never,
  stopReason: stopReason as never,
  itemsVisited: 1,
  itemsReturned: 1,
  itemsSkipped: 0,
  unknownDateItemsSkipped: 0,
  mediaTypesCovered: { photos: true, videos: true },
  canResume: false
})

describe("areScanResultsValid", () => {
  it("returns true when both account emails match", () => {
    expect(
      areScanResultsValid(
        { accountEmail: "user@example.com" },
        { accountEmail: "user@example.com" }
      )
    ).toBe(true)
  })

  it("returns false when account emails differ", () => {
    expect(
      areScanResultsValid(
        { accountEmail: "alice@example.com" },
        { accountEmail: "bob@example.com" }
      )
    ).toBe(false)
  })

  it("returns false when stored email is undefined but the current account is known", () => {
    expect(
      areScanResultsValid(
        { accountEmail: undefined },
        { accountEmail: "user@example.com" }
      )
    ).toBe(false)
  })

  it("returns true when context email is undefined (health check did not return email)", () => {
    expect(
      areScanResultsValid(
        { accountEmail: "user@example.com" },
        { accountEmail: undefined }
      )
    ).toBe(true)
  })

  it("returns true when both emails are undefined", () => {
    expect(
      areScanResultsValid(
        { accountEmail: undefined },
        { accountEmail: undefined }
      )
    ).toBe(true)
  })

  it.each(["icloud", "amazon"] as const)(
    "requires a matching provider page session for %s cached results",
    (sourceProvider) => {
      const stored = { sourceProvider, providerSessionId: "session-a" }
      expect(
        areScanResultsValid(stored, {
          sourceProvider,
          providerSessionId: "session-a"
        })
      ).toBe(true)
      expect(
        areScanResultsValid(stored, {
          sourceProvider,
          providerSessionId: "session-b"
        })
      ).toBe(false)
      expect(
        areScanResultsValid(stored, {
          sourceProvider,
          providerSessionId: undefined
        })
      ).toBe(false)
    }
  )

  it("keeps Google account-bound caches reusable across provider page sessions", () => {
    expect(
      areScanResultsValid(
        {
          sourceProvider: "google",
          accountEmail: "user@example.com",
          providerSessionId: "session-old"
        },
        {
          sourceProvider: "google",
          accountEmail: "user@example.com",
          providerSessionId: "session-new"
        }
      )
    ).toBe(true)
  })
})

describe("iCloud sync token reuse", () => {
  const stored = {
    sourceProvider: "icloud",
    providerSessionId: "session-a",
    mediaItems: {},
    totalItems: 12,
    mediaItemsAreComplete: true,
    scanCoverage: coverage("exhausted"),
    providerSyncToken: "zone-token-a"
  }

  it("[PARITY-07] reuses only a valid token from a complete same-session full-library result", () => {
    expect(
      reusableICloudSyncToken(stored, {
        sourceProvider: "icloud",
        providerSessionId: "session-a"
      })
    ).toBe("zone-token-a")
    expect(
      reusableICloudSyncToken(
        { ...stored, scanCoverage: coverage("changes_caught_up") },
        { sourceProvider: "icloud", providerSessionId: "session-a" }
      )
    ).toBe("zone-token-a")
  })

  it("[PARITY-07] rejects malformed coverage before reusing an iCloud token", () => {
    expect(
      reusableICloudSyncToken(
        {
          ...stored,
          scanCoverage: {
            ...coverage("exhausted"),
            itemsVisited: 2
          }
        },
        { sourceProvider: "icloud", providerSessionId: "session-a" }
      )
    ).toBeUndefined()
  })

  it.each([
    ["other provider", { ...stored, sourceProvider: "amazon" }, { sourceProvider: "icloud", providerSessionId: "session-a" }],
    ["different provider page session", stored, { sourceProvider: "icloud", providerSessionId: "session-b" }],
    ["partial result", { ...stored, mediaItemsAreComplete: false }, { sourceProvider: "icloud", providerSessionId: "session-a" }],
    ["scoped result", { ...stored, dateRange: { from: "2024-01-01", to: "2024-01-31" } }, { sourceProvider: "icloud", providerSessionId: "session-a" }],
    ["album result", { ...stored, albumScope: { mediaKey: "album-a" } }, { sourceProvider: "icloud", providerSessionId: "session-a" }],
    ["non-exhaustive coverage", { ...stored, scanCoverage: coverage("provider_error", "failed") }, { sourceProvider: "icloud", providerSessionId: "session-a" }],
    ["missing provider session", stored, { sourceProvider: "icloud" }]
  ] as const)("rejects a token from %s", (_label, candidate, context) => {
    expect(reusableICloudSyncToken(candidate, context)).toBeUndefined()
  })

  it.each(["", " has-space ", "bad\u0000token", "x".repeat(4097), 42, null])(
    "rejects malformed opaque token %s",
    (token) => {
      expect(isValidICloudSyncToken(token)).toBe(false)
    }
  )
})

describe("cached scan merge", () => {
  it("merges cached-only items after a watermark or fully applied changes", () => {
    expect(shouldMergeCachedScanResults(coverage("watermark_reached"))).toBe(
      true
    )
    expect(
      mergeCachedScanResults([item("fresh")], { old: item("old") }, coverage("watermark_reached"))
    ).toEqual([item("fresh"), item("old")])
    expect(
      shouldMergeCachedScanResults(coverage("changes_caught_up"))
    ).toBe(true)
    expect(
      mergeCachedScanResults([item("changed")], { old: item("old") }, coverage("changes_caught_up"))
    ).toEqual([item("changed"), item("old")])
  })

  it("treats a complete exhausted scan as authoritative", () => {
    expect(shouldMergeCachedScanResults(coverage("exhausted"))).toBe(false)
    expect(
      mergeCachedScanResults([item("fresh")], { old: item("old") }, coverage("exhausted"))
    ).toEqual([item("fresh")])
  })

  it("does not merge after a partial or failed provider result", () => {
    expect(
      mergeCachedScanResults(
        [item("fresh")],
        { old: item("old") },
        coverage("provider_error", "failed")
      )
    ).toEqual([item("fresh")])
  })
})
