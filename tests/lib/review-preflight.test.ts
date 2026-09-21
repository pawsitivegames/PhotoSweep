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

  it.each([
    ["scan identity only", { scanAccountEmail: "buyer@example.com" }],
    ["current identity only", { currentAccountEmail: "buyer@example.com" }]
  ])("does not treat %s as an unavailable identity", (_label, identity) => {
    const result = evaluateReviewPreflight({
      scanProvider: "icloud",
      currentProvider: "icloud",
      ...identity,
      selectedCount: 1,
      connectionValidated: true,
      allowUnavailableAccountIdentity: true,
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
    expect(result.reasons.map((item) => item.code)).toContain("scan_date_unknown")
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

  it("blocks recovery when the record provider differs from the current provider", () => {
    const result = evaluateRecoveryRestorePreflight({
      recordProvider: "google",
      currentProvider: "icloud",
      recordAccountFingerprint: accountFingerprint("buyer@example.com"),
      currentAccountEmail: "buyer@example.com",
      connectionValidated: true
    })

    expect(result.allowed).toBe(false)
    expect(result.reasons.map((item) => item.code)).toContain("provider_mismatch")
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
    expect(result.reasons.map((item) => item.code)).toContain("account_mismatch")
  })
})
