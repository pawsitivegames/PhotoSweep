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

  it("allows provider-session-only checks when a provider cannot expose account identity", () => {
    const result = evaluateReviewPreflight({
      scanProvider: "icloud",
      currentProvider: "icloud",
      selectedCount: 1,
      connectionValidated: true,
      allowUnavailableAccountIdentity: true,
      requireFreshScan: true,
      requireKnownScope: true,
      scanDate: 100,
      scanScopeFingerprint: "same",
      currentScopeFingerprint: "same",
      now: 200
    })

    expect(result.allowed).toBe(true)
    expect(result.accountStatus).toBe("unavailable")
    expect(result.reasons[0]?.code).toBe("account_unknown")
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
    expect(result.reasons.map((item) => item.code)).toContain("account_unknown")
  })
})
