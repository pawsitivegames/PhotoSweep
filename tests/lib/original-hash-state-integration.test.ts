import { describe, expect, it } from "vitest"

import { appReducer, type AppState } from "../../lib/app-reducer"
import { buildReviewReport } from "../../lib/review-report"
import { validateOriginalContentHashResult } from "../../lib/provider-retrieval"
import type { DuplicateGroup, GpdMediaItem, PhotoProvider } from "../../lib/types"

const sha256 = "a".repeat(64)

function fixture(provider: PhotoProvider = "google", mediaKind: GpdMediaItem["mediaKind"] = "photo") {
  const mediaItems: Record<string, GpdMediaItem> = Object.fromEntries(
    ["item-a", "item-b"].map((mediaKey) => [
      mediaKey,
      {
        mediaKey,
        dedupKey: `${provider}-${mediaKey}`,
        provider,
        mediaKind,
        thumb: `https://example.test/${mediaKey}`,
        timestamp: 1,
        creationTimestamp: 1,
        resWidth: 100,
        resHeight: 100,
        favoriteStatus: "not-favorite",
        favoriteSource: "provider-metadata"
      } satisfies GpdMediaItem
    ])
  )
  const groups: DuplicateGroup[] = [
    {
      id: "candidate-pair",
      mediaKeys: ["item-a", "item-b"],
      originalMediaKey: "item-a",
      similarity: 0.99
    }
  ]
  return {
    mediaItems,
    groups,
    state: {
      status: "results",
      mediaItems,
      groups,
      totalItems: 2,
      accountEmail: "owner@example.com",
      providerSessionId: "page-session-1",
      sourceProvider: provider,
      scopeFingerprint: "scan-scope-1"
    } satisfies AppState
  }
}

function verifiedResult(mediaKey: string, contentRole: "single-file" | "live-photo-still") {
  return validateOriginalContentHashResult(
    {
      mediaKey,
      scopeFingerprint: "scan-scope-1",
      contentHash: {
        value: sha256,
        algorithm: "sha256",
        provenance: "original-content",
        verificationSource: "local-original-bytes",
        contentRole
      },
      byteLength: 2048,
      mimeType: "image/jpeg"
    },
    {
      mediaKey,
      scopeFingerprint: "scan-scope-1",
      mediaKind: contentRole === "live-photo-still" ? "live-photo" : "photo"
    }
  )
}

function recordHash(state: AppState, mediaKey: string, contentRole: "single-file" | "live-photo-still") {
  if (state.status !== "results") throw new Error("Expected review results.")
  const result = verifiedResult(mediaKey, contentRole)
  const item = state.mediaItems[mediaKey]!
  return appReducer(state, {
    type: "ORIGINAL_HASH_VERIFIED",
    provider: "google",
    providerSessionId: "page-session-1",
    accountEmail: "OWNER@example.com",
    scopeFingerprint: "scan-scope-1",
    mediaKey,
    dedupKey: item.dedupKey,
    contentHash: result.contentHash,
    byteLength: result.byteLength,
    mimeType: result.mimeType
  })
}

describe("original hash review integration", () => {
  it("uses validated hashes in matching and reports, then reloads them under the same scope binding", () => {
    const initial = fixture()
    const afterFirst = recordHash(initial.state, "item-a", "single-file")
    const afterBoth = recordHash(afterFirst, "item-b", "single-file")

    expect(afterBoth.status).toBe("results")
    if (afterBoth.status !== "results") return
    expect(afterBoth.groups[0]).toMatchObject({
      duplicateKind: "exact",
      evidenceLevel: "verified_identical"
    })
    const report = buildReviewReport({
      groups: afterBoth.groups,
      mediaItems: afterBoth.mediaItems,
      selectedGroupIds: new Set(["candidate-pair"]),
      getKept: () => new Set(["item-a"])
    })
    expect(report.items.map((item) => item.duplicateKind)).toEqual([
      "exact",
      "exact"
    ])
    expect(report.items[1]).toMatchObject({
      contentHashAlgorithm: "sha256",
      contentHashVerificationSource: "local-original-bytes"
    })

    const persisted = JSON.parse(JSON.stringify(afterBoth)) as Extract<
      AppState,
      { status: "results" }
    >
    const reloaded = appReducer({ status: "connecting" }, {
      type: "LOAD_SAVED_RESULTS",
      mediaItems: persisted.mediaItems,
      groups: persisted.groups,
      totalItems: persisted.totalItems,
      accountEmail: persisted.accountEmail,
      providerSessionId: persisted.providerSessionId,
      sourceProvider: persisted.sourceProvider,
      scopeFingerprint: persisted.scopeFingerprint
    })
    expect(reloaded.status).toBe("results")
    if (reloaded.status !== "results") return
    expect(reloaded.mediaItems["item-a"]?.contentHash?.value).toBe(sha256)
    expect(
      buildReviewReport({
        groups: reloaded.groups,
        mediaItems: reloaded.mediaItems,
        selectedGroupIds: new Set(["candidate-pair"]),
        getKept: () => new Set(["item-a"])
      }).items.every((item) => item.duplicateKind === "exact")
    ).toBe(true)
  })

  it("preserves still-only Live Photo evidence without declaring a paired duplicate", () => {
    const initial = fixture("google", "live-photo")
    const afterFirst = recordHash(initial.state, "item-a", "live-photo-still")
    const afterBoth = recordHash(afterFirst, "item-b", "live-photo-still")

    expect(afterBoth.status).toBe("results")
    if (afterBoth.status !== "results") return
    expect(afterBoth.mediaItems["item-a"]?.contentHash?.contentRole).toBe(
      "live-photo-still"
    )
    expect(afterBoth.groups[0]?.duplicateKind).not.toBe("exact")
  })

  it("rejects late evidence from another account session or scan scope", () => {
    const initial = fixture()
    if (initial.state.status !== "results") throw new Error("Expected results.")
    const item = initial.state.mediaItems["item-a"]!
    const result = verifiedResult("item-a", "single-file")
    for (const patch of [
      { providerSessionId: "new-session" },
      { scopeFingerprint: "new-scope" },
      { accountEmail: "other@example.com" }
    ]) {
      const next = appReducer(initial.state, {
        type: "ORIGINAL_HASH_VERIFIED",
        provider: "google",
        providerSessionId: patch.providerSessionId ?? "page-session-1",
        accountEmail: patch.accountEmail ?? "owner@example.com",
        scopeFingerprint: patch.scopeFingerprint ?? "scan-scope-1",
        mediaKey: "item-a",
        dedupKey: item.dedupKey,
        contentHash: result.contentHash,
        byteLength: result.byteLength,
        mimeType: result.mimeType
      })
      expect(next).toBe(initial.state)
    }
  })
})
