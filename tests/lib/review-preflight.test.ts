import { describe, expect, it } from "vitest"

import {
  accountFingerprint,
  buildScanScopeFingerprint,
  evaluateRecoveryRestorePreflight,
  evaluateReviewPreflight
} from "../../lib/review-preflight"
import { DEFAULT_SETTINGS } from "../../lib/types"

describe("review preflight", () => {
  it("passes a fresh, same-account, same-scope cleanup", () => {
    const now = 1_000_000
    const fingerprint = buildScanScopeFingerprint(DEFAULT_SETTINGS)
    const result = evaluateReviewPreflight({
      scanProvider: "google",
      currentProvider: "google",
      scanAccountEmail: "Buyer@example.com",
      currentAccountEmail: "buyer@example.com",
      scanDate: now - 5_000,
      scanScopeFingerprint: fingerprint,
      currentScopeFingerprint: fingerprint,
      selectedCount: 2,
      connectionValidated: true,
      requireFreshScan: true,
      requireKnownScope: true,
      now
    })

    expect(result.allowed).toBe(true)
    expect(result.accountStatus).toBe("verified")
    expect(result.freshness).toBe("fresh")
    expect(result.scopeStatus).toBe("matched")
  })

  it("blocks an otherwise valid cleanup when the connection was not validated", () => {
    const now = 1_000_000
    const fingerprint = buildScanScopeFingerprint(DEFAULT_SETTINGS)
    const result = evaluateReviewPreflight({
      scanProvider: "google",
      currentProvider: "google",
      scanAccountEmail: "buyer@example.com",
      currentAccountEmail: "buyer@example.com",
      scanDate: now - 5_000,
      scanScopeFingerprint: fingerprint,
      currentScopeFingerprint: fingerprint,
      selectedCount: 2,
      connectionValidated: false,
      requireFreshScan: true,
      requireKnownScope: true,
      now
    })

    expect(result.allowed).toBe(false)
    expect(result.reasons.map((item) => item.code)).toContain(
      "connection_unverified"
    )
  })

  it("blocks zero selected items even when every other preflight condition passes", () => {
    const now = 1_000_000
    const fingerprint = buildScanScopeFingerprint(DEFAULT_SETTINGS)
    const result = evaluateReviewPreflight({
      scanProvider: "google",
      currentProvider: "google",
      scanAccountEmail: "buyer@example.com",
      currentAccountEmail: "buyer@example.com",
      scanDate: now - 5_000,
      scanScopeFingerprint: fingerprint,
      currentScopeFingerprint: fingerprint,
      selectedCount: 0,
      connectionValidated: true,
      requireFreshScan: true,
      requireKnownScope: true,
      now
    })

    expect(result.allowed).toBe(false)
    expect(result.reasons.map((item) => item.code)).toContain("no_selection")
  })

  it("blocks provider, account, scope, and stale-result drift", () => {
    const result = evaluateReviewPreflight({
      scanProvider: "google",
      currentProvider: "icloud",
      scanAccountEmail: "old@example.com",
      currentAccountEmail: "new@example.com",
      scanDate: 1,
      scanScopeFingerprint: "old",
      currentScopeFingerprint: "new",
      selectedCount: 1,
      connectionValidated: true,
      requireFreshScan: true,
      requireKnownScope: true,
      now: 200_000_000
    })

    expect(result.allowed).toBe(false)
    expect(result.reasons.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "provider_mismatch",
        "account_mismatch",
        "scan_stale",
        "scope_changed"
      ])
    )
  })

  it("allows provider-session-only checks when the active page session matches", () => {
    const result = evaluateReviewPreflight({
      scanProvider: "icloud",
      currentProvider: "icloud",
      scanProviderSessionId: "session-a",
      currentProviderSessionId: "session-a",
      selectedCount: 1,
      connectionValidated: true,
      requireFreshScan: true,
      requireKnownScope: true,
      scanDate: 100,
      scanScopeFingerprint: "same",
      currentScopeFingerprint: "same",
      now: 200
    })

    expect(result.allowed).toBe(true)
    expect(result.accountStatus).toBe("session_bound")
    expect(result.reasons).toEqual([])
  })

  it("blocks a changed iCloud page session as an account mismatch", () => {
    const result = evaluateReviewPreflight({
      scanProvider: "icloud",
      currentProvider: "icloud",
      scanProviderSessionId: "old-page-session",
      currentProviderSessionId: "new-page-session",
      selectedCount: 1,
      connectionValidated: true,
      requireFreshScan: false,
      requireKnownScope: false
    })

    expect(result.allowed).toBe(false)
    expect(result.accountStatus).toBe("mismatch")
    expect(result.reasons).toContainEqual({
      code: "account_mismatch",
      message: "The signed-in photo-provider account changed since this scan."
    })
  })

  it.each([
    ["scan session is missing", { currentProviderSessionId: "current-session" }],
    ["current session is missing", { scanProviderSessionId: "scan-session" }]
  ])("keeps a one-sided iCloud session identity unknown when %s", (_label, sessions) => {
    const result = evaluateReviewPreflight({
      scanProvider: "icloud",
      currentProvider: "icloud",
      ...sessions,
      selectedCount: 1,
      connectionValidated: true,
      requireFreshScan: false,
      requireKnownScope: false
    })

    expect(result.allowed).toBe(false)
    expect(result.accountStatus).toBe("unknown")
    expect(result.reasons).toContainEqual({
      code: "account_unknown",
      message:
        "The scan and current provider session do not expose enough account identity to prove they match."
    })
  })

  it("does not use provider-page sessions as a Google account identity", () => {
    const result = evaluateReviewPreflight({
      scanProvider: "google",
      currentProvider: "google",
      scanProviderSessionId: "old-page-session",
      currentProviderSessionId: "new-page-session",
      selectedCount: 1,
      connectionValidated: true,
      requireFreshScan: false,
      requireKnownScope: false
    })

    expect(result.allowed).toBe(false)
    expect(result.accountStatus).toBe("unknown")
    expect(result.reasons.map((item) => item.code)).toContain("account_unknown")
  })

  it("uses the scan provider when the current provider value is absent", () => {
    const result = evaluateReviewPreflight({
      scanProvider: "icloud",
      scanProviderSessionId: "scan-session",
      currentProviderSessionId: "different-session",
      selectedCount: 1,
      connectionValidated: true,
      requireFreshScan: false,
      requireKnownScope: false
    })

    expect(result.accountStatus).toBe("mismatch")
    expect(result.reasons.map((item) => item.code)).toContain("account_mismatch")
  })

  it.each([
    ["scan identity only", { scanAccountEmail: "buyer@example.com" }],
    ["current identity only", { currentAccountEmail: "buyer@example.com" }]
  ])("does not treat %s as a matched provider session", (_label, identity) => {
    const result = evaluateReviewPreflight({
      scanProvider: "icloud",
      currentProvider: "icloud",
      ...identity,
      selectedCount: 1,
      connectionValidated: true,
      requireFreshScan: false,
      requireKnownScope: false
    })

    expect(result.allowed).toBe(false)
    expect(result.accountStatus).toBe("unknown")
    expect(result.reasons.map((item) => item.code)).toContain("account_unknown")
  })

  it("requires a known scope for destructive actions", () => {
    const result = evaluateReviewPreflight({
      scanProvider: "google",
      currentProvider: "google",
      scanAccountEmail: "buyer@example.com",
      currentAccountEmail: "buyer@example.com",
      scanDate: 100,
      selectedCount: 1,
      connectionValidated: true,
      requireFreshScan: true,
      requireKnownScope: true,
      now: 200
    })

    expect(result.allowed).toBe(false)
    expect(result.reasons.map((item) => item.code)).toContain("scope_unknown")
  })

  it("changes scope fingerprints when any destructive scan setting changes", () => {
    const variants = [
      { sourceProvider: "icloud" as const },
      { scanMode: "full" as const },
      { similarityThreshold: 0.8 },
      { dateRange: { from: "2026-01-01" } },
      { albumScope: { mediaKey: "album-1", title: "Album" } },
      { amazonBatchLimit: 25 },
      { icloudBatchLimit: 25 },
      { exactOnly: true }
    ]
    const fingerprints = [
      buildScanScopeFingerprint(DEFAULT_SETTINGS),
      ...variants.map((change) =>
        buildScanScopeFingerprint({ ...DEFAULT_SETTINGS, ...change })
      )
    ]
    expect(new Set(fingerprints).size).toBe(fingerprints.length)

    const drifted = evaluateReviewPreflight({
      scanProvider: "google",
      currentProvider: "google",
      scanAccountEmail: "buyer@example.com",
      currentAccountEmail: "buyer@example.com",
      scanDate: 100,
      scanScopeFingerprint: fingerprints[0],
      currentScopeFingerprint: fingerprints[1],
      selectedCount: 1,
      connectionValidated: true,
      requireFreshScan: true,
      requireKnownScope: true,
      now: 200
    })
    expect(drifted.allowed).toBe(false)
    expect(drifted.reasons.map((item) => item.code)).toContain("scope_changed")
  })

  it("treats a future scan timestamp as unknown and blocks fresh-scan cleanup", () => {
    const fingerprint = buildScanScopeFingerprint(DEFAULT_SETTINGS)
    const result = evaluateReviewPreflight({
      scanProvider: "google",
      currentProvider: "google",
      scanAccountEmail: "buyer@example.com",
      currentAccountEmail: "buyer@example.com",
      scanDate: 201,
      scanScopeFingerprint: fingerprint,
      currentScopeFingerprint: fingerprint,
      selectedCount: 1,
      connectionValidated: true,
      requireFreshScan: true,
      requireKnownScope: true,
      now: 200
    })

    expect(result.allowed).toBe(false)
    expect(result.freshness).toBe("unknown")
    expect(result.reasons.map((item) => item.code)).toContain(
      "scan_date_unknown"
    )
  })

  it("partitions account recovery by a non-reversible fingerprint", () => {
    expect(accountFingerprint("Buyer@example.com")).toBe(
      accountFingerprint("buyer@example.com")
    )
    expect(accountFingerprint("other@example.com")).not.toBe(
      accountFingerprint("buyer@example.com")
    )
  })

  it("blocks a Google recovery record until the current account is known", () => {
    const result = evaluateRecoveryRestorePreflight({
      recordProvider: "google",
      currentProvider: "google",
      recordAccountFingerprint: accountFingerprint("buyer@example.com"),
      connectionValidated: true
    })

    expect(result.allowed).toBe(false)
    expect(result.accountStatus).toBe("unknown")
    expect(result.freshness).toBe("unknown")
    expect(result.scopeStatus).toBe("unknown")
    expect(result.summary).toBe(
      "google recovery · account or session identity unverified"
    )
    expect(result.reasons).toContainEqual(
      expect.objectContaining({
        code: "account_unknown",
        message:
          "The provider has not exposed the account needed to verify this recovery record."
      })
    )
  })

  it("blocks recovery when the record provider differs from the current provider", () => {
    const result = evaluateRecoveryRestorePreflight({
      recordProvider: "google",
      currentProvider: "icloud",
      recordAccountFingerprint: accountFingerprint("buyer@example.com"),
      currentAccountEmail: "buyer@example.com",
      connectionValidated: true
    })

    expect(result.allowed).toBe(false)
    expect(result.reasons).toContainEqual(
      expect.objectContaining({
        code: "provider_mismatch",
        message: "The recovery record belongs to a different photo provider."
      })
    )
  })

  it("blocks an account mismatch even when an iCloud provider has no stable identity", () => {
    const result = evaluateRecoveryRestorePreflight({
      recordProvider: "icloud",
      currentProvider: "icloud",
      recordAccountFingerprint: accountFingerprint("buyer@example.com"),
      currentAccountEmail: "other@example.com",
      connectionValidated: true
    })

    expect(result.allowed).toBe(false)
    expect(result.accountStatus).toBe("mismatch")
    expect(result.reasons).toContainEqual(
      expect.objectContaining({
        code: "account_mismatch",
        message: "This recovery record belongs to a different provider account."
      })
    )
  })

  it.each([
    ["no recorded session", undefined, "current-session"],
    ["no current session", "recorded-session", undefined],
    ["empty recorded session", "", "current-session"],
    ["empty current session", "recorded-session", ""]
  ])(
    "blocks iCloud recovery when %s is missing",
    (_label, recordProviderSessionId, currentProviderSessionId) => {
      const result = evaluateRecoveryRestorePreflight({
        recordProvider: "icloud",
        currentProvider: "icloud",
        recordProviderSessionId,
        currentProviderSessionId,
        connectionValidated: true
      })

      expect(result.allowed).toBe(false)
      expect(result.accountStatus).toBe("unknown")
      expect(result.summary).toBe(
        "icloud recovery · account or session identity unverified"
      )
      expect(result.reasons).toContainEqual(
        expect.objectContaining({
          code: "account_unknown",
          message:
            "The provider session needed to verify this recovery record is unavailable. Reconnect and create a fresh cleanup record in this session."
        })
      )
    }
  )

  it.each(["icloud", "amazon"] as const)(
    "allows a %s recovery only within the matching provider page session",
    (provider) => {
      const matching = evaluateRecoveryRestorePreflight({
        recordProvider: provider,
        currentProvider: provider,
        recordProviderSessionId: "provider-session-a",
        currentProviderSessionId: "provider-session-a",
        connectionValidated: true
      })
      const mismatched = evaluateRecoveryRestorePreflight({
        recordProvider: provider,
        currentProvider: provider,
        recordProviderSessionId: "provider-session-a",
        currentProviderSessionId: "provider-session-b",
        connectionValidated: true
      })

      expect(matching).toMatchObject({
        allowed: true,
        accountStatus: "session_bound",
        summary: `${provider} recovery · provider page session matched`,
        reasons: []
      })
      expect(mismatched.allowed).toBe(false)
      expect(mismatched.accountStatus).toBe("mismatch")
      expect(mismatched.summary).toBe(
        `${provider} recovery · provider session mismatch`
      )
      expect(mismatched.reasons).toContainEqual(
        expect.objectContaining({
          code: "account_mismatch",
          message:
            "This recovery record belongs to a different provider page session."
        })
      )
    }
  )

  it("verifies Google recovery with the matching account fingerprint", () => {
    const fingerprint = accountFingerprint("buyer@example.com")
    const result = evaluateRecoveryRestorePreflight({
      recordProvider: "google",
      currentProvider: "google",
      recordAccountFingerprint: fingerprint,
      currentAccountEmail: "Buyer@example.com",
      connectionValidated: true
    })

    expect(result).toMatchObject({
      allowed: true,
      accountStatus: "verified",
      summary: "google recovery · account verified",
      reasons: []
    })
  })

  it("keeps Google recovery unknown when neither identity is available", () => {
    const result = evaluateRecoveryRestorePreflight({
      recordProvider: "google",
      currentProvider: "google",
      connectionValidated: true
    })

    expect(result.allowed).toBe(false)
    expect(result.accountStatus).toBe("unknown")
    expect(result.freshness).toBe("unknown")
    expect(result.scopeStatus).toBe("unknown")
    expect(result.summary).toBe(
      "google recovery · account or session identity unverified"
    )
    expect(result.reasons).toContainEqual(
      expect.objectContaining({
        code: "account_unknown",
        message:
          "The provider account needed to verify this recovery record is unavailable."
      })
    )
  })

  it("requires a verified connection even when the provider session matches", () => {
    const result = evaluateRecoveryRestorePreflight({
      recordProvider: "amazon",
      currentProvider: "amazon",
      recordProviderSessionId: "provider-session-a",
      currentProviderSessionId: "provider-session-a",
      connectionValidated: false
    })

    expect(result.allowed).toBe(false)
    expect(result.accountStatus).toBe("session_bound")
    expect(result.reasons).toContainEqual(
      expect.objectContaining({
        code: "connection_unverified",
        message:
          "The current photo-provider connection has not passed a fresh health check."
      })
    )
  })

  it("uses Google as the default current provider for matching-account recovery", () => {
    const fingerprint = accountFingerprint("buyer@example.com")
    const result = evaluateRecoveryRestorePreflight({
      recordProvider: "google",
      recordAccountFingerprint: fingerprint,
      currentAccountEmail: "buyer@example.com",
      connectionValidated: true
    })

    expect(result).toMatchObject({
      allowed: true,
      accountStatus: "verified",
      summary: "google recovery · account verified",
      reasons: []
    })
  })
})
