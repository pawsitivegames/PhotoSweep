import { describe, expect, it } from "vitest"

import {
  providerReviewStorageKey,
  ProviderScopedReviewStorage,
  type ReviewStorageAdapter
} from "../../lib/provider-review-storage"
import {
  DuplicateReviewSession,
  type DuplicateReviewSelections,
  type StoredDuplicateReviewSelections
} from "../../lib/duplicate-review-session"
import { applyKeepStrategyToReview } from "../../lib/keep-strategy-feedback"
import { SCAN_CHECKPOINT_KEY } from "../../lib/scan-checkpoint"
import { StoredReviewScope } from "../../lib/stored-review-scope"
import { DEFAULT_SETTINGS, type PhotoProvider } from "../../lib/types"

function memoryStorage(seed: Record<string, unknown> = {}) {
  const values = structuredClone(seed)
  let mutationCount = 0
  const adapter: ReviewStorageAdapter = {
    async get(keys) {
      await Promise.resolve()
      const selected = typeof keys === "string" ? [keys] : keys
      return Object.fromEntries(
        selected
          .filter((key) => Object.prototype.hasOwnProperty.call(values, key))
          .map((key) => [key, structuredClone(values[key])])
      )
    },
    async set(next) {
      await Promise.resolve()
      Object.assign(values, structuredClone(next))
      mutationCount += 1
    },
    async remove(keys) {
      await Promise.resolve()
      for (const key of keys) delete values[key]
      mutationCount += 1
    }
  }
  return {
    adapter,
    values,
    get mutationCount() {
      return mutationCount
    }
  }
}

function settings(provider: PhotoProvider) {
  return { ...DEFAULT_SETTINGS, sourceProvider: provider }
}

function review(provider: PhotoProvider, version: number) {
  const first = `${provider}-keep-${version}`
  const second = `${provider}-trash-${version}`
  const accountEmail = provider === "google" ? "google@example.com" : undefined
  const providerSessionId =
    provider === "google" ? undefined : `${provider}-session-${version}`
  return {
    scanResults: {
      mediaItems: {
        [first]: {
          mediaKey: first,
          dedupKey: `${first}-dedup`,
          thumb: first,
          timestamp: version,
          creationTimestamp: version,
          provider
        },
        [second]: {
          mediaKey: second,
          dedupKey: `${second}-dedup`,
          thumb: second,
          timestamp: version,
          creationTimestamp: version,
          provider
        }
      },
      groups: [
        {
          id: "colliding-group-id",
          mediaKeys: [first, second],
          originalMediaKey: first,
          similarity: 1
        }
      ],
      scanDate: version,
      totalItems: 2,
      sourceProvider: provider,
      ...(accountEmail ? { accountEmail } : {}),
      ...(providerSessionId ? { providerSessionId } : {})
    },
    selections: {
      selectedGroupIds: ["colliding-group-id"],
      reviewedGroupIds: ["colliding-group-id"],
      keptOverrides: { "colliding-group-id": [first] },
      keepDecisionProvenance: {
        "colliding-group-id": { source: "manual" as const }
      }
    }
  }
}

function providerStorage(
  raw: ReviewStorageAdapter,
  provider: PhotoProvider
): ProviderScopedReviewStorage {
  return new ProviderScopedReviewStorage(raw, {
    getHostProvider: () => provider,
    getActiveProvider: () => provider
  })
}

describe("ProviderScopedReviewStorage", () => {
  it("persists and restores strategy proposals in isolated provider review buckets", async () => {
    const raw = memoryStorage()
    const providers: PhotoProvider[] = ["google", "amazon", "icloud"]
    const fixtures = new Map<
      PhotoProvider,
      {
        group: { id: string; mediaKeys: string[]; originalMediaKey: string; similarity: number }
        mediaItems: Record<string, {
          mediaKey: string
          dedupKey: string
          thumb: string
          timestamp: number
          creationTimestamp: number
          isOriginalQuality: boolean
          resWidth: number
          resHeight: number
          provider: PhotoProvider
        }>
      }
    >()

    for (const provider of providers) {
      const keeperKey = `${provider}-keeper`
      const copyKey = `${provider}-copy`
      const group = {
        id: `${provider}-group`,
        mediaKeys: [keeperKey, copyKey],
        originalMediaKey: keeperKey,
        similarity: 0.99
      }
      const mediaItems = {
        [keeperKey]: {
          mediaKey: keeperKey,
          dedupKey: `${keeperKey}-dedup`,
          thumb: keeperKey,
          timestamp: 1,
          creationTimestamp: 1,
          isOriginalQuality: true,
          resWidth: 200,
          resHeight: 200,
          provider
        },
        [copyKey]: {
          mediaKey: copyKey,
          dedupKey: `${copyKey}-dedup`,
          thumb: copyKey,
          timestamp: 1,
          creationTimestamp: 1,
          isOriginalQuality: false,
          resWidth: 100,
          resHeight: 100,
          provider
        }
      }
      const application = applyKeepStrategyToReview({
        groups: [group],
        mediaItems,
        selections: {
          selectedGroupIds: new Set(),
          reviewedGroupIds: new Set(),
          keptOverrides: {}
        },
        strategy: "best_quality"
      })
      const storage = providerStorage(raw.adapter, provider)
      await storage.set(
        { selections: application.session.serialize() },
        provider
      )
      fixtures.set(provider, { group, mediaItems })
    }

    for (const provider of providers) {
      const storage = providerStorage(raw.adapter, provider)
      const stored = (await storage.get(["selections"], provider))
        .selections as StoredDuplicateReviewSelections
      const fixture = fixtures.get(provider)!
      const selections: DuplicateReviewSelections = {
        selectedGroupIds: new Set(stored.selectedGroupIds),
        reviewedGroupIds: new Set(stored.reviewedGroupIds),
        keptOverrides: Object.fromEntries(
          Object.entries(stored.keptOverrides).map(([groupId, keys]) => [
            groupId,
            new Set(keys)
          ])
        ),
        keepDecisionProvenance: stored.keepDecisionProvenance
      }
      const restored = new DuplicateReviewSession({
        groups: [fixture.group],
        mediaItems: fixture.mediaItems,
        selections
      })

      expect(stored.selectedGroupIds).toEqual([fixture.group.id])
      expect(stored.reviewedGroupIds).toEqual([])
      expect(restored.trashPlan([fixture.group])).toMatchObject({
        provider,
        mediaKeysToTrash: [`${provider}-copy`]
      })
    }

    expect(raw.values).toHaveProperty(
      providerReviewStorageKey("google", "selections")
    )
    expect(raw.values).toHaveProperty(
      providerReviewStorageKey("amazon", "selections")
    )
    expect(raw.values).toHaveProperty(
      providerReviewStorageKey("icloud", "selections")
    )
    expect(raw.values).not.toHaveProperty("selections")
  })

  it("isolates interleaved writes and session invalidation when group IDs collide", async () => {
    const raw = memoryStorage()
    const providers: PhotoProvider[] = ["google", "icloud", "amazon"]
    const adapters = new Map(
      providers.map((provider) => [
        provider,
        providerStorage(raw.adapter, provider)
      ])
    )
    await Promise.all(
      providers.map((provider, index) => {
        const adapter = adapters.get(provider)!
        const payload = review(provider, index + 1)
        return adapter.set(
          {
            settings: settings(provider),
            scanResults: payload.scanResults,
            selections: payload.selections
          },
          provider
        )
      })
    )

    const beforeInvalidation = new Map<PhotoProvider, unknown>()
    for (const provider of providers) {
      beforeInvalidation.set(
        provider,
        await adapters
          .get(provider)!
          .get(["scanResults", "selections"], provider)
      )
    }

    const googleScope = new StoredReviewScope(adapters.get("google")!)
    const invalidated = await googleScope.restore({
      fallbackSettings: settings("google"),
      hostProvider: "google",
      identityProvider: "google",
      accountEmail: "another-google-account@example.com"
    })

    expect(invalidated.staleReviewRemoved).toBe(true)
    expect(invalidated.scanResults).toBeNull()
    expect(invalidated.selections).toBeNull()
    expect(
      await adapters.get("google")!.get(["scanResults", "selections"], "google")
    ).toEqual({})
    for (const provider of ["icloud", "amazon"] as const) {
      expect(
        await adapters
          .get(provider)!
          .get(["scanResults", "selections"], provider)
      ).toEqual(beforeInvalidation.get(provider))
    }
    expect(raw.values).toHaveProperty(
      providerReviewStorageKey("icloud", "scanResults")
    )
    expect(raw.values).toHaveProperty(
      providerReviewStorageKey("amazon", "selections")
    )
  })

  it("stages legacy state read-only until identity validation, then migrates it once", async () => {
    const legacyReview = review("google", 7)
    const legacy = {
      settings: settings("google"),
      scanResults: legacyReview.scanResults,
      selections: legacyReview.selections
    }
    const raw = memoryStorage(legacy)
    const scoped = providerStorage(raw.adapter, "google")
    const scope = new StoredReviewScope(scoped)
    const before = structuredClone(raw.values)

    const identityPending = await scope.restore({
      fallbackSettings: DEFAULT_SETTINGS
    })

    expect(identityPending.identityPending).toBe(true)
    expect(identityPending.scanResults).toBeNull()
    expect(raw.values).toEqual(before)
    expect(raw.mutationCount).toBe(0)

    const validated = await scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      identityProvider: "google",
      accountEmail: "google@example.com"
    })
    expect(validated.identityPending).toBe(false)
    expect(validated.scanResults?.scanDate).toBe(7)
    expect(
      validated.selections?.selectedGroupIds.has("colliding-group-id")
    ).toBe(true)

    await scoped.commitLegacyReviewMigration("google", {
      scanResults: Boolean(validated.scanResults),
      checkpoint: Boolean(validated.checkpoint)
    })

    const restored = await scoped.get(["scanResults", "selections"], "google")
    expect(restored.scanResults?.scanDate).toBe(7)
    expect(restored.selections?.selectedGroupIds).toEqual([
      "colliding-group-id"
    ])
    expect(
      raw.values[providerReviewStorageKey("google", "legacyMigrationComplete")]
    ).toBe(true)
    expect(raw.values.scanResults).toEqual(legacy.scanResults)
    expect(raw.values.selections).toEqual(legacy.selections)

    const nextScope = new StoredReviewScope(
      providerStorage(raw.adapter, "google")
    )
    const reloaded = await nextScope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "google",
      identityProvider: "google",
      accountEmail: "google@example.com"
    })
    expect(reloaded.scanResults?.scanDate).toBe(7)
    expect(
      reloaded.selections?.selectedGroupIds.has("colliding-group-id")
    ).toBe(true)
  })

  it("PARITY-09 serializes a newer provider review write behind an in-flight legacy migration", async () => {
    const legacyReview = review("google", 7)
    const legacy = {
      settings: settings("google"),
      scanResults: legacyReview.scanResults,
      selections: legacyReview.selections
    }
    const values = structuredClone(legacy) as Record<string, unknown>
    let releaseMigrationWrite!: () => void
    let markMigrationWriteStarted!: () => void
    const migrationWriteStarted = new Promise<void>((resolve) => {
      markMigrationWriteStarted = resolve
    })
    const migrationWriteGate = new Promise<void>((resolve) => {
      releaseMigrationWrite = resolve
    })
    const writeOrder: string[] = []
    const scanResultsKey = providerReviewStorageKey("google", "scanResults")
    const migrationMarkerKey = providerReviewStorageKey(
      "google",
      "legacyMigrationComplete"
    )
    const raw: ReviewStorageAdapter = {
      async get(keys) {
        await Promise.resolve()
        return Object.fromEntries(
          keys
            .filter((key) => Object.prototype.hasOwnProperty.call(values, key))
            .map((key) => [key, structuredClone(values[key])])
        )
      },
      async set(next) {
        if (Object.prototype.hasOwnProperty.call(next, migrationMarkerKey)) {
          writeOrder.push("migration")
          markMigrationWriteStarted()
          await migrationWriteGate
        } else if (Object.prototype.hasOwnProperty.call(next, scanResultsKey)) {
          writeOrder.push("newer-review")
        }
        Object.assign(values, structuredClone(next))
      },
      async remove(keys) {
        for (const key of keys) delete values[key]
      }
    }
    const scoped = providerStorage(raw, "google")
    const scope = new StoredReviewScope(scoped)
    const restored = await scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      identityProvider: "google",
      accountEmail: "google@example.com"
    })
    expect(restored.scanResults?.scanDate).toBe(7)

    let leaseCurrent = true
    const migration = scoped.commitLegacyReviewMigration(
      "google",
      { scanResults: true, checkpoint: false },
      () => leaseCurrent
    )
    await migrationWriteStarted

    const nextReview = review("google", 8).scanResults
    leaseCurrent = false
    const newerWrite = scoped.set({ scanResults: nextReview }, "google")
    await Promise.resolve()
    expect(writeOrder).toEqual(["migration"])

    releaseMigrationWrite()
    await Promise.all([migration, newerWrite])

    expect(writeOrder).toEqual(["migration", "newer-review"])
    expect(values[scanResultsKey]).toEqual(nextReview)
    expect(values[migrationMarkerKey]).toBe(true)
    expect(values.scanResults).toEqual(legacy.scanResults)
    expect(values.selections).toEqual(legacy.selections)
  })

  it("preserves mismatched provider-bearing legacy records without hydrating or deleting them", async () => {
    const amazonReview = review("amazon", 9)
    const legacy = {
      settings: settings("google"),
      scanResults: amazonReview.scanResults,
      selections: amazonReview.selections
    }
    const raw = memoryStorage(legacy)
    const before = structuredClone(raw.values)
    const scope = new StoredReviewScope(providerStorage(raw.adapter, "google"))

    const restored = await scope.restore({
      fallbackSettings: settings("google"),
      hostProvider: "google",
      identityProvider: "google",
      accountEmail: "google@example.com"
    })

    expect(restored.scanResults).toBeNull()
    expect(restored.selections).toBeNull()
    expect(restored.staleReviewRemoved).toBe(false)
    expect(raw.values).toEqual(before)
    expect(raw.mutationCount).toBe(0)
  })

  it("keeps checkpoint migration provider-bound and does not adopt selection-only legacy data", async () => {
    const checkpoint = {
      id: "icloud-checkpoint",
      status: "interrupted" as const,
      startedAt: 1,
      updatedAt: 2,
      settings: settings("icloud"),
      providerSessionId: "icloud-session-4",
      phase: "fetching" as const,
      itemsProcessed: 1,
      totalEstimate: 2,
      message: "Scanning"
    }
    const checkpointRaw = memoryStorage({
      settings: settings("icloud"),
      [SCAN_CHECKPOINT_KEY]: checkpoint
    })
    const icloudStorage = providerStorage(checkpointRaw.adapter, "icloud")
    const checkpointScope = new StoredReviewScope(icloudStorage)
    const checkpointRestore = await checkpointScope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "icloud",
      identityProvider: "icloud",
      providerSessionId: "icloud-session-4"
    })
    expect(checkpointRestore.checkpoint?.id).toBe("icloud-checkpoint")
    await icloudStorage.commitLegacyReviewMigration("icloud", {
      scanResults: false,
      checkpoint: true
    })
    expect(
      checkpointRaw.values[
        providerReviewStorageKey("icloud", SCAN_CHECKPOINT_KEY)
      ]
    ).toEqual(checkpoint)

    const orphan = review("google", 1)
    const orphanRaw = memoryStorage({
      settings: settings("google"),
      selections: orphan.selections
    })
    const orphanScope = new StoredReviewScope(
      providerStorage(orphanRaw.adapter, "google")
    )
    const orphanRestore = await orphanScope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "google",
      identityProvider: "google",
      accountEmail: "google@example.com"
    })
    expect(orphanRestore.selections).toBeNull()
    expect(orphanRaw.values.selections).toEqual(orphan.selections)
    expect(orphanRaw.mutationCount).toBe(0)
  })
})
