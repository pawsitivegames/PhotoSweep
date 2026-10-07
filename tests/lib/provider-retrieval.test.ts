import { describe, expect, it } from "vitest"

import {
  MAX_ORIGINAL_BYTES_PER_ITEM,
  getOriginalContentVerificationUnavailableMessage,
  isProviderRetrievalResponseBound,
  isProviderRetrievalBindingCurrent,
  isVideoForPlayback,
  isAllowedProviderPlaybackUrl,
  safeProviderRetrievalError,
  validateOriginalContentHashResult,
  validateVideoPlaybackResult
} from "../../lib/provider-retrieval"

const expected = { mediaKey: "item-a", scopeFingerprint: "scope-a" }
const sha256 = "a".repeat(64)

describe("original content verification capability", () => {
  it("returns a fail-closed message before requests for unsupported items or regions", () => {
    expect(
      getOriginalContentVerificationUnavailableMessage({
        provider: "amazon",
        originalContentVerificationCapability: "unsupported-region"
      })
    ).toBe("Original-byte verification is unavailable on this Amazon Photos region.")
    expect(
      getOriginalContentVerificationUnavailableMessage({
        provider: "icloud",
        originalContentVerificationCapability: "unavailable"
      })
    ).toBe("Original-byte verification is unavailable for this item.")
    expect(
      getOriginalContentVerificationUnavailableMessage({
        provider: "amazon",
        originalContentVerificationCapability: "available"
      })
    ).toBeNull()
  })
})

describe("provider retrieval result boundary", () => {
  it("[VIDEO-PLAYBACK] binds each result to the pending provider and command", () => {
    const expected = {
      command: "getOriginalContentHash",
      provider: "google" as const
    }
    expect(isProviderRetrievalResponseBound(expected, expected)).toBe(true)
    expect(
      isProviderRetrievalResponseBound(
        { ...expected, command: "getVideoPlaybackUrl" },
        expected
      )
    ).toBe(false)
    expect(
      isProviderRetrievalResponseBound(
        { ...expected, provider: "amazon" },
        expected
      )
    ).toBe(false)
    expect(
      isProviderRetrievalResponseBound(
        { command: expected.command },
        expected
      )
    ).toBe(false)
  })

  it("[VIDEO-PLAYBACK] preserves explicit media kind over legacy duration hints", () => {
    expect(isVideoForPlayback({ mediaKind: "video", duration: undefined })).toBe(true)
    expect(isVideoForPlayback({ mediaKind: "video", duration: null })).toBe(true)
    expect(isVideoForPlayback({ mediaKind: "unknown", duration: 1200 })).toBe(true)
    expect(isVideoForPlayback({ mediaKind: "photo", duration: 1200 })).toBe(false)
    expect(isVideoForPlayback({ mediaKind: "live-photo", duration: 2000 })).toBe(false)
  })

  it("[VIDEO-PLAYBACK] binds retrieval to the exact current provider session, account, scope, and scanned item", () => {
    const item = {
      mediaKey: "item-a",
      dedupKey: "dedup-a",
      provider: "google" as const
    }
    const binding = {
      status: "results",
      provider: "google" as const,
      currentProvider: "google" as const,
      scannedProviderSessionId: "page-a",
      currentProviderSessionId: "page-a",
      scannedAccountEmail: "owner@example.com",
      currentAccountEmail: "owner@example.com",
      scannedScopeFingerprint: "scope-a",
      currentScopeFingerprint: "scope-a",
      item,
      scannedMediaItems: [item]
    }
    expect(isProviderRetrievalBindingCurrent(binding)).toBe(true)
    expect(
      isProviderRetrievalBindingCurrent({
        ...binding,
        currentProviderSessionId: "page-b"
      })
    ).toBe(false)
    expect(
      isProviderRetrievalBindingCurrent({
        ...binding,
        currentAccountEmail: "other@example.com"
      })
    ).toBe(false)
    expect(
      isProviderRetrievalBindingCurrent({
        ...binding,
        currentScopeFingerprint: "scope-b"
      })
    ).toBe(false)
    expect(
      isProviderRetrievalBindingCurrent({
        ...binding,
        scannedMediaItems: [{ ...item, dedupKey: "other-dedup" }]
      })
    ).toBe(false)
    expect(
      isProviderRetrievalBindingCurrent({ ...binding, status: "scanning" })
    ).toBe(false)
  })

  it("accepts only exact-scope local original-byte SHA-256 evidence", () => {
    expect(
      validateOriginalContentHashResult(
        {
          ...expected,
          contentHash: {
            value: sha256,
            algorithm: "sha256",
            provenance: "original-content",
            verificationSource: "local-original-bytes"
          },
          byteLength: 1024,
          mimeType: "image/jpeg"
        },
        expected
      )
    ).toMatchObject({
      mediaKey: "item-a",
      scopeFingerprint: "scope-a",
      contentHash: { value: sha256, algorithm: "sha256" },
      byteLength: 1024
    })
  })

  it("preserves truthful still-only evidence and rejects unproven paired or mismatched roles", () => {
    const result = validateOriginalContentHashResult(
      {
        ...expected,
        contentHash: {
          value: sha256,
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes",
          contentRole: "live-photo-still"
        },
        byteLength: 1024
      },
      { ...expected, mediaKind: "live-photo" }
    )
    expect(result.contentHash.contentRole).toBe("live-photo-still")
    expect(() =>
      validateOriginalContentHashResult(
        {
          ...expected,
          contentHash: {
            value: sha256,
            algorithm: "sha256",
            provenance: "original-content",
            verificationSource: "local-original-bytes",
            contentRole: "paired-live-photo"
          },
          byteLength: 1024
        },
        { ...expected, mediaKind: "live-photo" }
      )
    ).toThrow()
    expect(() =>
      validateOriginalContentHashResult(
        {
          ...expected,
          contentHash: {
            value: sha256,
            algorithm: "sha256",
            provenance: "original-content",
            verificationSource: "local-original-bytes",
            contentRole: "live-photo-still"
          },
          byteLength: 1024
        },
        { ...expected, mediaKind: "photo" }
      )
    ).toThrow()
  })

  it.each([
    ["wrong item", { mediaKey: "item-b" }],
    ["wrong scope", { scopeFingerprint: "scope-b" }],
    ["provider fingerprint", { contentHash: { algorithm: "provider-fingerprint" } }],
    ["noncanonical digest", { contentHash: { value: "A".repeat(64) } }],
    ["oversized result", { byteLength: MAX_ORIGINAL_BYTES_PER_ITEM + 1 }],
    ["signed URL in result", { playbackUrl: "https://secret.example/signed" }]
  ])("rejects %s hash results", (_label, patch) => {
    const patchContentHash = (
      patch as { contentHash?: Record<string, unknown> }
    ).contentHash
    const value = {
      ...expected,
      contentHash: {
        value: sha256,
        algorithm: "sha256",
        provenance: "original-content",
        verificationSource: "local-original-bytes"
      },
      byteLength: 1024,
      ...patch,
      ...(patchContentHash
        ? {
            contentHash: {
              value: sha256,
              algorithm: "sha256",
              provenance: "original-content",
              verificationSource: "local-original-bytes",
              ...patchContentHash
            }
          }
        : {})
    }
    expect(() => validateOriginalContentHashResult(value, expected)).toThrow()
  })

  it("[VIDEO-PLAYBACK] allows only HTTPS video URLs from the provider's known download host", () => {
    expect(
      isAllowedProviderPlaybackUrl(
        "amazon",
        "https://download-photos.amazon.ca/v2/download/signed/item?ownerId=owner"
      )
    ).toBe(true)
    expect(
      isAllowedProviderPlaybackUrl(
        "google",
        "https://video-downloads.googleusercontent.com/play/item?signature=one"
      )
    ).toBe(true)
    expect(
      isAllowedProviderPlaybackUrl(
        "icloud",
        "https://cvws-h2.icloud-content.com/B/video/item"
      )
    ).toBe(true)
    expect(
      isAllowedProviderPlaybackUrl(
        "amazon",
        "http://download-photos.amazon.ca/video"
      )
    ).toBe(false)
    expect(
      isAllowedProviderPlaybackUrl("amazon", "https://evil.example/video")
    ).toBe(false)
    expect(
      isAllowedProviderPlaybackUrl(
        "amazon",
        "https://user:pass@download-photos.amazon.ca/video"
      )
    ).toBe(false)
    expect(
      isAllowedProviderPlaybackUrl(
        "amazon",
        "https://download-photos.amazon.ca/video#fragment"
      )
    ).toBe(false)
    expect(
      isAllowedProviderPlaybackUrl(
        "amazon",
        "https://download-photos.amazon.ca:8443/video"
      )
    ).toBe(false)
  })

  it("[VIDEO-PLAYBACK] rejects stale-item and still-image playback results", () => {
    const result = {
      ...expected,
      playbackUrl:
        "https://download-photos.amazon.ca/v2/download/signed/item?ownerId=owner",
      mimeType: "video/mp4"
    }
    expect(
      validateVideoPlaybackResult("amazon", result, expected)
    ).toMatchObject({ mediaKey: "item-a", mimeType: "video/mp4" })
    expect(() =>
      validateVideoPlaybackResult("amazon", { ...result, mediaKey: "item-b" }, expected)
    ).toThrow()
    expect(() =>
      validateVideoPlaybackResult("amazon", { ...result, scopeFingerprint: "scope-b" }, expected)
    ).toThrow()
    expect(() =>
      validateVideoPlaybackResult("amazon", { ...result, mimeType: "image/jpeg" }, expected)
    ).toThrow()
  })

  it.each([0, -1, 1, NaN, Infinity, "2099-01-01", null])(
    "[VIDEO-PLAYBACK] rejects an expired or invalid explicit video expiry: %s",
    (expiresAt) => {
      expect(() => validateVideoPlaybackResult("amazon", {
        ...expected,
        playbackUrl: "https://download-photos.amazon.ca/video",
        mimeType: "video/mp4",
        expiresAt
      }, expected)).toThrow(/expired|expiry/i)
    }
  )

  it("[VIDEO-PLAYBACK] retains a future video expiry for transient playback", () => {
    const expiresAt = Date.now() + 60_000
    expect(validateVideoPlaybackResult("amazon", {
      ...expected,
      playbackUrl: "https://download-photos.amazon.ca/video",
      mimeType: "video/mp4",
      expiresAt
    }, expected)).toMatchObject({ expiresAt })
  })

  it("[VIDEO-PLAYBACK] does not surface signed URLs from provider errors", () => {
    expect(
      safeProviderRetrievalError(
        "Fetch failed for https://download-photos.amazon.ca/video?ownerId=secret"
      )
    ).toContain("item remains unverified")
    expect(safeProviderRetrievalError("Review has reached its 100 MiB budget")).toContain(
      "100 MiB budget"
    )
  })
})
