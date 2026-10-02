import { describe, expect, it } from "vitest"

import { scopedEmbeddingCacheKey } from "../../lib/embedding-cache"
import { canResumeScanCheckpoint, createScanCheckpoint } from "../../lib/scan-checkpoint"
import { areScanResultsValid } from "../../lib/scan-results"
import {
  evaluateRecoveryRestorePreflight,
  evaluateReviewPreflight
} from "../../lib/review-preflight"
import {
  captureTrashDispatchAuthorization,
  isTrashDispatchAuthorizationCurrent
} from "../../lib/trash-dispatch-guard"

const providerSessionId = "provider-page-session-a"

describe("PARITY-02 provider session binding", () => {
  it.each(["icloud", "amazon"] as const)(
    "binds %s stored scans and resumable checkpoints to the producing page session",
    (provider) => {
      expect(
        areScanResultsValid(
          { sourceProvider: provider, providerSessionId },
          { sourceProvider: provider, providerSessionId }
        )
      ).toBe(true)
      expect(
        areScanResultsValid(
          { sourceProvider: provider, providerSessionId },
          { sourceProvider: provider, providerSessionId: "provider-page-session-b" }
        )
      ).toBe(false)
      expect(
        areScanResultsValid(
          { sourceProvider: provider },
          { sourceProvider: provider }
        )
      ).toBe(false)

      const checkpoint = createScanCheckpoint({
        id: "scan-1",
        settings: {
          sourceProvider: provider,
          scanMode: "full",
          similarityThreshold: 0.95
        },
        providerSessionId
      })
      expect(
        canResumeScanCheckpoint(checkpoint, {
          sourceProvider: provider,
          providerSessionId
        })
      ).toBe(true)
      expect(
        canResumeScanCheckpoint(checkpoint, {
          sourceProvider: provider,
          providerSessionId: "provider-page-session-b"
        })
      ).toBe(false)
    }
  )

  it("allows Google cache reuse across page sessions only when the account email matches", () => {
    expect(
      areScanResultsValid(
        {
          sourceProvider: "google",
          accountEmail: "buyer@example.com",
          providerSessionId: "old-page"
        },
        {
          sourceProvider: "google",
          accountEmail: "buyer@example.com",
          providerSessionId: "new-page"
        }
      )
    ).toBe(true)
    expect(
      areScanResultsValid(
        { sourceProvider: "google", accountEmail: "buyer@example.com" },
        { sourceProvider: "google", accountEmail: "other@example.com" }
      )
    ).toBe(false)
  })

  it("requires a current matching provider session before Trash and recovery restore", () => {
    const review = {
      scanProvider: "amazon" as const,
      currentProvider: "amazon" as const,
      scanProviderSessionId: providerSessionId,
      currentProviderSessionId: providerSessionId,
      selectedCount: 1,
      connectionValidated: true
    }
    expect(evaluateReviewPreflight(review)).toMatchObject({
      allowed: true,
      accountStatus: "session_bound"
    })
    expect(
      evaluateReviewPreflight({
        ...review,
        currentProviderSessionId: "provider-page-session-b"
      })
    ).toMatchObject({ allowed: false, accountStatus: "mismatch" })
    expect(
      evaluateReviewPreflight({
        ...review,
        scanProviderSessionId: undefined
      })
    ).toMatchObject({ allowed: false, accountStatus: "unknown" })

    expect(
      evaluateRecoveryRestorePreflight({
        recordProvider: "amazon",
        currentProvider: "amazon",
        recordProviderSessionId: providerSessionId,
        currentProviderSessionId: providerSessionId,
        connectionValidated: true
      })
    ).toMatchObject({ allowed: true, accountStatus: "session_bound" })
    expect(
      evaluateRecoveryRestorePreflight({
        recordProvider: "amazon",
        currentProvider: "amazon",
        recordProviderSessionId: providerSessionId,
        currentProviderSessionId: "provider-page-session-b",
        connectionValidated: true
      })
    ).toMatchObject({ allowed: false, accountStatus: "mismatch" })
  })

  it("binds the pre-dispatch authorization and embedding cache key to the provider session", () => {
    const plan = {
      provider: "icloud" as const,
      dedupKeys: ["asset-1"],
      mediaKeysToTrash: ["icloud-asset-1"],
      blockedMediaKeys: [],
      blockedGroupIds: []
    }
    const expected = captureTrashDispatchAuthorization({
      generation: 1,
      plan,
      provider: "icloud",
      providerSessionId
    })
    expect(
      isTrashDispatchAuthorizationCurrent(expected, {
        ...expected,
        providerSessionId: "provider-page-session-b"
      })
    ).toBe(false)
    expect(
      scopedEmbeddingCacheKey("icloud-asset-1", `icloud:${providerSessionId}`)
    ).not.toBe(
      scopedEmbeddingCacheKey("icloud-asset-1", "icloud:provider-page-session-b")
    )
  })
})
