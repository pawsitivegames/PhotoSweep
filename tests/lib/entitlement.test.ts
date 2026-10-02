import { describe, expect, it } from "vitest"

import {
  canExportFullReport,
  canResumeCheckpoint,
  canStartScan,
  canTrashCount,
  canUsePaidProvider,
  getEffectivePlanId,
  getLockedGroupCount,
  getPlanLimits,
  getVisibleGroups,
  isEntitlementActive,
  isFreeIcloudPlan,
  limitScanItems,
  OFFLINE_GRACE_MS,
  PLAN_LIMITS,
  scanSettingsForEntitlement,
  type Entitlement
} from "../../lib/entitlement"
import type { DuplicateGroup, GpdMediaItem, ScanSettings } from "../../lib/types"

function entitlement(planId: Entitlement["planId"]): Entitlement {
  return { planId, active: true, source: "local_dev" }
}

function group(id: number): DuplicateGroup {
  return {
    id: `g${id}`,
    mediaKeys: [`a${id}`, `b${id}`],
    originalMediaKey: `a${id}`,
    similarity: 0.99
  }
}

function item(id: number): GpdMediaItem {
  return {
    mediaKey: `m${id}`,
    dedupKey: `d${id}`,
    thumb: "",
    timestamp: 0,
    creationTimestamp: 0
  }
}

const smartAlbumSettings: ScanSettings = {
  sourceProvider: "google",
  scanMode: "smart",
  similarityThreshold: 0.95,
  albumScope: { mediaKey: "album", itemCount: 1000 }
}

describe("PLAN_LIMITS", () => {
  it("matches launch pricing gates", () => {
    expect(PLAN_LIMITS.free.maxPhotosPerScan).toBe(1000)
    expect(PLAN_LIMITS.mini_cleanup.maxPhotosPerScan).toBe(2500)
    expect(PLAN_LIMITS.cleanup_pass.maxPhotosPerScan).toBe(10000)
    expect(PLAN_LIMITS.lifetime.maxPhotosPerScan).toBe("unlimited")
    expect(PLAN_LIMITS.free.maxVisibleGroups).toBe(25)
    expect(PLAN_LIMITS.mini_cleanup.maxVisibleGroups).toBe(75)
    expect(PLAN_LIMITS.cleanup_pass.maxVisibleGroups).toBe("unlimited")
    expect(PLAN_LIMITS.mini_cleanup.maxTrashMovesPerSession).toBe(100)
    expect(PLAN_LIMITS.cleanup_pass.maxTrashMovesPerSession).toBe("unlimited")
    expect(PLAN_LIMITS.free.fullReports).toBe(false)
    expect(PLAN_LIMITS.mini_cleanup.fullReports).toBe(true)
    expect(PLAN_LIMITS.free.fullScanMode).toBe(false)
    expect(PLAN_LIMITS.mini_cleanup.fullScanMode).toBe(false)
    expect(PLAN_LIMITS.cleanup_pass.fullScanMode).toBe(true)
    expect(PLAN_LIMITS.free.largeLibraryResume).toBe(false)
    expect(PLAN_LIMITS.mini_cleanup.largeLibraryResume).toBe(false)
    expect(PLAN_LIMITS.cleanup_pass.largeLibraryResume).toBe(true)
    expect(PLAN_LIMITS.lifetime.paidProviders).toEqual([
      "google",
      "icloud",
      "amazon"
    ])
  })

  it("falls back to free limits for inactive entitlements", () => {
    expect(
      getPlanLimits({ planId: "lifetime", active: false, source: "signed_token" })
    ).toEqual(PLAN_LIMITS.free)
  })

  it("falls back to free limits for invalid runtime plan ids", () => {
    expect(
      getPlanLimits({
        planId: "enterprise",
        active: true,
        source: "signed_token"
      } as unknown as Entitlement)
    ).toEqual(PLAN_LIMITS.free)
  })
})

describe("entitlement gates", () => {
  it("locks full scan until Cleanup Pass or Lifetime", () => {
    const settings: ScanSettings = {
      ...smartAlbumSettings,
      scanMode: "full"
    }
    expect(canStartScan(settings, 100, entitlement("free"))).toBe(false)
    expect(canStartScan(settings, 100, entitlement("mini_cleanup"))).toBe(false)
    expect(canStartScan(settings, 100, entitlement("cleanup_pass"))).toBe(true)
  })

  it("enforces visible group limits", () => {
    const groups = Array.from({ length: 80 }, (_, i) => group(i))
    expect(getVisibleGroups(groups, entitlement("free"))).toHaveLength(25)
    expect(getLockedGroupCount(groups, entitlement("free"))).toBe(55)
    expect(getVisibleGroups(groups, entitlement("mini_cleanup"))).toHaveLength(75)
    expect(getLockedGroupCount(groups, entitlement("mini_cleanup"))).toBe(5)
    expect(getVisibleGroups(groups, entitlement("cleanup_pass"))).toHaveLength(80)
  })

  it("enforces trash and report gates", () => {
    expect(canTrashCount(10, entitlement("free"))).toBe(true)
    expect(canTrashCount(11, entitlement("free"))).toBe(false)
    expect(canTrashCount(100, entitlement("mini_cleanup"))).toBe(true)
    expect(canTrashCount(101, entitlement("mini_cleanup"))).toBe(false)
    expect(canTrashCount(5000, entitlement("cleanup_pass"))).toBe(true)
    expect(canTrashCount(1, entitlement("free"), 9)).toBe(true)
    expect(canTrashCount(1, entitlement("free"), 10)).toBe(false)
    expect(canTrashCount(25, entitlement("mini_cleanup"), 75)).toBe(true)
    expect(canTrashCount(26, entitlement("mini_cleanup"), 75)).toBe(false)
    expect(canExportFullReport(entitlement("free"))).toBe(false)
    expect(canExportFullReport(entitlement("mini_cleanup"))).toBe(true)
  })

  it("limits fetched media before duplicate detection", () => {
    const items = Array.from({ length: 1002 }, (_, i) => item(i))
    const limited = limitScanItems(items, entitlement("free"))
    expect(limited.items).toHaveLength(1000)
    expect(limited.lockedItemCount).toBe(2)
  })

  it("requires paid resume for large checkpoints", () => {
    const checkpoint = {
      id: "scan",
      status: "interrupted" as const,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      settings: smartAlbumSettings,
      phase: "computing_embeddings" as const,
      itemsProcessed: 100,
      totalEstimate: 1200,
      message: "paused"
    }
    expect(canResumeCheckpoint(checkpoint, entitlement("free"))).toBe(false)
    expect(canResumeCheckpoint(checkpoint, entitlement("cleanup_pass"))).toBe(true)
  })

  it("preserves a free iCloud batch as scan scope under the common free cap", () => {
    const savedFreeIcloudSettings: ScanSettings = {
      sourceProvider: "icloud",
      scanMode: "smart",
      similarityThreshold: 0.95,
      icloudBatchLimit: 50
    }
    const sanitized = scanSettingsForEntitlement(
      savedFreeIcloudSettings,
      entitlement("free")
    )

    expect(isFreeIcloudPlan(savedFreeIcloudSettings, entitlement("free"))).toBe(
      true
    )
    expect(sanitized).toBe(savedFreeIcloudSettings)
    expect(sanitized.icloudBatchLimit).toBe(50)
    expect(canStartScan(sanitized, 50, entitlement("free"))).toBe(true)
    expect(
      canStartScan(
        { ...sanitized, icloudBatchLimit: 1001 },
        1001,
        entitlement("free")
      )
    ).toBe(false)
  })

  it("allows free iCloud batch checkpoints to resume within the common cap", () => {
    const checkpoint = {
      id: "scan",
      status: "interrupted" as const,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        sourceProvider: "icloud" as const,
        scanMode: "smart" as const,
        similarityThreshold: 0.95,
        icloudBatchLimit: 50
      },
      phase: "fetching" as const,
      itemsProcessed: 0,
      totalEstimate: 0,
      message: "paused",
      mediaItems: Array.from({ length: 50 }, (_, i) => item(i))
    }

    expect(canResumeCheckpoint(checkpoint, entitlement("free"))).toBe(true)
    expect(canResumeCheckpoint(checkpoint, entitlement("cleanup_pass"))).toBe(true)
  })

  it("keeps the common free scan-size and full-mode gates on iCloud batch resumes", () => {
    const checkpoint = {
      id: "free-icloud-large-batch",
      status: "interrupted" as const,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        sourceProvider: "icloud" as const,
        scanMode: "smart" as const,
        similarityThreshold: 0.95,
        icloudBatchLimit: 50
      },
      phase: "fetching" as const,
      itemsProcessed: 0,
      totalEstimate: 1001,
      message: "paused",
      mediaItems: Array.from({ length: 1001 }, (_, i) => item(i))
    }

    expect(canResumeCheckpoint(checkpoint, entitlement("free"))).toBe(false)
    expect(
      canResumeCheckpoint(
        {
          ...checkpoint,
          settings: { ...checkpoint.settings, scanMode: "full" },
          totalEstimate: 50,
          mediaItems: checkpoint.mediaItems.slice(0, 50)
        },
        entitlement("free")
      )
    ).toBe(false)
  })

  it("keeps provider support consistent across Google, iCloud, and Amazon", () => {
    expect(canUsePaidProvider("google", entitlement("lifetime"))).toBe(true)
    expect(canUsePaidProvider("icloud", entitlement("lifetime"))).toBe(true)
    expect(canUsePaidProvider("amazon", entitlement("lifetime"))).toBe(true)
  })
})

describe("provider support matrix", () => {
  const PAID_PLAN_IDS = [
    "mini_cleanup",
    "cleanup_pass",
    "lifetime"
  ] as const
  const ALL_PROVIDERS = ["google", "icloud", "amazon"] as const

  it("scopes every plan to the same supported providers", () => {
    expect(PLAN_LIMITS.free.paidProviders).toEqual(ALL_PROVIDERS)
    for (const planId of PAID_PLAN_IDS) {
      expect(PLAN_LIMITS[planId].paidProviders).toEqual(ALL_PROVIDERS)
    }
  })

  it("allows Google, iCloud, and Amazon across free and paid tiers", () => {
    for (const planId of ["free", ...PAID_PLAN_IDS] as const) {
      for (const provider of ALL_PROVIDERS) {
        expect(canUsePaidProvider(provider, entitlement(planId))).toBe(true)
      }
    }
  })

  it("applies the same plan caps to each provider", () => {
    const expectedLimits = {
      free: { scan: 1000, visible: 25, trash: 10, full: false },
      mini_cleanup: { scan: 2500, visible: 75, trash: 100, full: false },
      cleanup_pass: {
        scan: 10000,
        visible: "unlimited",
        trash: "unlimited",
        full: true
      },
      lifetime: {
        scan: "unlimited",
        visible: "unlimited",
        trash: "unlimited",
        full: true
      }
    } as const

    for (const provider of ALL_PROVIDERS) {
      for (const planId of [
        "free",
        ...PAID_PLAN_IDS
      ] as const) {
        const limits = getPlanLimits(entitlement(planId))
        expect({
          scan: limits.maxPhotosPerScan,
          visible: limits.maxVisibleGroups,
          trash: limits.maxTrashMovesPerSession,
          full: limits.fullScanMode
        }).toEqual(expectedLimits[planId])

        const groups = Array.from({ length: 100 }, (_, index) => group(index))
        const visibleCap = expectedLimits[planId].visible
        expect(getVisibleGroups(groups, entitlement(planId))).toHaveLength(
          visibleCap === "unlimited" ? groups.length : visibleCap
        )
        const trashCap = expectedLimits[planId].trash
        if (trashCap === "unlimited") {
          expect(canTrashCount(100000, entitlement(planId))).toBe(true)
        } else {
          expect(canTrashCount(trashCap, entitlement(planId))).toBe(true)
          expect(canTrashCount(trashCap + 1, entitlement(planId))).toBe(false)
        }

        const settings: ScanSettings = {
          sourceProvider: provider,
          scanMode: "smart",
          similarityThreshold: 0.95,
          albumScope: { mediaKey: `${provider}-album`, itemCount: 100 }
        }
        const scanCap = expectedLimits[planId].scan
        expect(
          canStartScan(
            { ...settings, albumScope: { ...settings.albumScope!, itemCount: scanCap === "unlimited" ? 1000 : scanCap } },
            scanCap === "unlimited" ? 1000 : scanCap,
            entitlement(planId)
          )
        ).toBe(true)
        if (scanCap !== "unlimited") {
          expect(
            canStartScan(
              {
                ...settings,
                albumScope: { ...settings.albumScope!, itemCount: scanCap + 1 }
              },
              scanCap + 1,
              entitlement(planId)
            )
          ).toBe(false)
        }
        expect(
          canStartScan({ ...settings, scanMode: "full" }, 100, entitlement(planId))
        ).toBe(
          expectedLimits[planId].full
        )
      }
    }
  })
})

// Time-limited signed entitlements fail closed at their signed expiry. Paid
// actions refresh Cleanup Pass from the license API before proceeding, so server
// time, not local clock rollback, decides whether it remains active.
describe("isEntitlementActive — expiring signed tokens", () => {
  const NOW = 10_000_000

  it("treats an unexpired token as active regardless of source", () => {
    expect(
      isEntitlementActive(
        { planId: "cleanup_pass", active: true, expiresAt: NOW + 1, source: "signed_token" },
        NOW
      )
    ).toBe(true)
  })

  it("fails closed immediately after signed-token expiry", () => {
    expect(OFFLINE_GRACE_MS).toBe(0)
    const justExpired = NOW - 1
    expect(
      isEntitlementActive(
        { planId: "cleanup_pass", active: true, expiresAt: justExpired, source: "signed_token" },
        NOW
      )
    ).toBe(false)
    expect(
      getEffectivePlanId(
        { planId: "cleanup_pass", active: true, expiresAt: justExpired, source: "signed_token" },
        NOW
      )
    ).toBe("free")
  })

  it("fails closed to free for expired signed tokens", () => {
    const expired = NOW - 1
    expect(
      getEffectivePlanId(
        { planId: "cleanup_pass", active: true, expiresAt: expired, source: "signed_token" },
        NOW
      )
    ).toBe("free")
  })

  it("does not grant grace to non-signed-token sources", () => {
    const justExpired = NOW - 1
    expect(
      isEntitlementActive(
        { planId: "cleanup_pass", active: true, expiresAt: justExpired, source: "local_dev" },
        NOW
      )
    ).toBe(false)
    expect(
      isEntitlementActive(
        { planId: "cleanup_pass", active: true, expiresAt: justExpired, source: "none" },
        NOW
      )
    ).toBe(false)
  })
})
