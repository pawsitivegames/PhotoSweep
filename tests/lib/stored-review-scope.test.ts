import { describe, expect, it } from "vitest"

import { DuplicateReviewSession } from "../../lib/duplicate-review-session"
import { StoredReviewScope } from "../../lib/stored-review-scope"
import { DEFAULT_SETTINGS, type StoredState } from "../../lib/types"

function adapter(seed: Partial<StoredState> = {}) {
  const values: Record<string, unknown> = { ...seed }
  let mutationCount = 0
  return {
    values,
    get mutationCount() {
      return mutationCount
    },
    scope: new StoredReviewScope({
      async get() {
        return values as Partial<StoredState>
      },
      async set(next) {
        mutationCount += 1
        Object.assign(values, next)
      },
      async remove(keys) {
        mutationCount += 1
        for (const key of keys) delete values[key]
      }
    })
  }
}

const mediaItems = {
  keep: {
    mediaKey: "keep",
    dedupKey: "dedup-keep",
    thumb: "keep",
    timestamp: 1,
    creationTimestamp: 1
  },
  trash: {
    mediaKey: "trash",
    dedupKey: "dedup-trash",
    thumb: "trash",
    timestamp: 1,
    creationTimestamp: 2
  }
}
const groups = [
  {
    id: "group",
    mediaKeys: ["keep", "trash"],
    originalMediaKey: "keep",
    similarity: 1
  }
]

describe("StoredReviewScope", () => {
  it("persists a selected keep default and hydrates missing legacy values to Best quality", async () => {
    const preferred = adapter({
      settings: {
        ...DEFAULT_SETTINGS,
        defaultKeepStrategy: "newest_upload"
      }
    })
    const restoredPreference = await preferred.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "google"
    })
    expect(restoredPreference.settings.defaultKeepStrategy).toBe("newest_upload")

    const legacy = adapter({
      settings: {
        sourceProvider: "google",
        similarityThreshold: 0.95,
        scanMode: "smart"
      }
    })
    const restoredLegacy = await legacy.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "google"
    })
    expect(restoredLegacy.settings.defaultKeepStrategy).toBe("best_quality")
  })

  it("keeps same-provider saved review hidden and unchanged while identity is pending", async () => {
    const checkpoint = {
      id: "amazon-checkpoint",
      status: "interrupted" as const,
      startedAt: 1,
      updatedAt: 2,
      settings: { ...DEFAULT_SETTINGS, sourceProvider: "amazon" as const },
      providerSessionId: "amazon-session-a",
      phase: "fetching" as const,
      itemsProcessed: 1,
      totalEstimate: 2,
      message: "Scanning"
    }
    const subject = adapter({
      settings: { ...DEFAULT_SETTINGS, sourceProvider: "amazon" },
      scanResults: {
        mediaItems,
        groups,
        scanDate: 1,
        totalItems: 2,
        sourceProvider: "amazon",
        providerSessionId: "amazon-session-a"
      },
      selections: {
        selectedGroupIds: ["group"],
        reviewedGroupIds: ["group"],
        keptOverrides: {}
      },
      scanCheckpoint: checkpoint
    })
    const originalStorage = structuredClone(subject.values)

    const pending = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "amazon"
    })

    expect(pending.identityPending).toBe(true)
    expect(pending.cancelled).toBe(false)
    expect(pending.scanResults).toBeNull()
    expect(pending.selections).toBeNull()
    expect(pending.checkpoint).toBeNull()
    expect(subject.values).toEqual(originalStorage)
    expect(subject.mutationCount).toBe(0)

    const validated = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "amazon",
      identityProvider: "amazon",
      providerSessionId: "amazon-session-a"
    })
    expect(validated.identityPending).toBe(false)
    expect(validated.scanResults?.providerSessionId).toBe("amazon-session-a")
    expect(validated.checkpoint?.providerSessionId).toBe("amazon-session-a")
    expect(validated.selections?.selectedGroupIds.has("group")).toBe(true)
  })

  it("defers a valid saved review when a foreign-provider checkpoint is also present", async () => {
    const subject = adapter({
      settings: { ...DEFAULT_SETTINGS, sourceProvider: "amazon" },
      scanResults: {
        mediaItems,
        groups,
        scanDate: 1,
        totalItems: 2,
        sourceProvider: "amazon",
        providerSessionId: "amazon-session-a"
      },
      selections: {
        selectedGroupIds: ["group"],
        reviewedGroupIds: ["group"],
        keptOverrides: {}
      },
      scanCheckpoint: {
        id: "foreign-google-checkpoint",
        status: "interrupted",
        startedAt: 1,
        updatedAt: 2,
        settings: { ...DEFAULT_SETTINGS, sourceProvider: "google" },
        accountEmail: "buyer@example.com",
        phase: "fetching",
        itemsProcessed: 1,
        totalEstimate: 2,
        message: "Scanning"
      }
    })
    const originalStorage = structuredClone(subject.values)

    const pending = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "amazon"
    })

    expect(pending.identityPending).toBe(true)
    expect(pending.scanResults).toBeNull()
    expect(pending.selections).toBeNull()
    expect(pending.checkpoint).toBeNull()
    expect(subject.values).toEqual(originalStorage)
    expect(subject.mutationCount).toBe(0)
  })

  it("preserves valid review decisions while removing only a foreign checkpoint", async () => {
    const subject = adapter({
      settings: { ...DEFAULT_SETTINGS, sourceProvider: "amazon" },
      scanResults: {
        mediaItems,
        groups,
        scanDate: 1,
        totalItems: 2,
        sourceProvider: "amazon",
        providerSessionId: "amazon-session-a"
      },
      selections: {
        selectedGroupIds: ["group"],
        reviewedGroupIds: ["group"],
        keptOverrides: {}
      },
      scanCheckpoint: {
        id: "foreign-google-checkpoint",
        status: "interrupted",
        startedAt: 1,
        updatedAt: 2,
        settings: { ...DEFAULT_SETTINGS, sourceProvider: "google" },
        accountEmail: "buyer@example.com",
        phase: "fetching",
        itemsProcessed: 1,
        totalEstimate: 2,
        message: "Scanning"
      }
    })

    const restored = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "amazon",
      identityProvider: "amazon",
      providerSessionId: "amazon-session-a"
    })

    expect(restored.staleReviewRemoved).toBe(true)
    expect(restored.identityPending).toBe(false)
    expect(restored.scanResults?.providerSessionId).toBe("amazon-session-a")
    expect(restored.selections?.selectedGroupIds.has("group")).toBe(true)
    expect(restored.checkpoint).toBeNull()
    expect(subject.values.scanResults).toMatchObject({
      providerSessionId: "amazon-session-a"
    })
    expect(subject.values.selections).toMatchObject({
      selectedGroupIds: ["group"]
    })
    expect(subject.values).not.toHaveProperty("scanCheckpoint")
  })

  it.each([
    ["selection-only", undefined],
    [
      "checkpoint-only",
      {
        id: "amazon-checkpoint-only",
        status: "interrupted" as const,
        startedAt: 1,
        updatedAt: 2,
        settings: { ...DEFAULT_SETTINGS, sourceProvider: "amazon" as const },
        providerSessionId: "amazon-session-a",
        phase: "fetching" as const,
        itemsProcessed: 1,
        totalEstimate: 2,
        message: "Scanning"
      }
    ]
  ])("does not hydrate orphaned %s choices without bound scan results", async (_, checkpoint) => {
    const subject = adapter({
      settings: { ...DEFAULT_SETTINGS, sourceProvider: "amazon" },
      selections: {
        selectedGroupIds: ["group"],
        reviewedGroupIds: ["group"],
        keptOverrides: { group: ["keep"] }
      },
      ...(checkpoint ? { scanCheckpoint: checkpoint } : {})
    })
    const originalStorage = structuredClone(subject.values)

    const pending = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "amazon"
    })

    expect(pending.identityPending).toBe(true)
    expect(pending.selections).toBeNull()
    expect(subject.values).toEqual(originalStorage)
    expect(subject.mutationCount).toBe(0)

    const validated = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "amazon",
      identityProvider: "amazon",
      providerSessionId: "amazon-session-a"
    })

    expect(validated.identityPending).toBe(false)
    expect(validated.scanResults).toBeNull()
    expect(validated.selections).toBeNull()
    expect(validated.staleReviewRemoved).toBe(true)
    expect(subject.values).not.toHaveProperty("selections")
    if (checkpoint) {
      expect(validated.checkpoint?.id).toBe(checkpoint.id)
      expect(subject.values.scanCheckpoint).toEqual(checkpoint)
    }
  })

  it("defers account-less Google review until a fresh account identity is known", async () => {
    const subject = adapter({
      settings: DEFAULT_SETTINGS,
      scanResults: {
        mediaItems,
        groups,
        scanDate: 1,
        totalItems: 2,
        sourceProvider: "google"
      },
      selections: {
        selectedGroupIds: ["group"],
        reviewedGroupIds: ["group"],
        keptOverrides: {}
      }
    })
    const originalStorage = structuredClone(subject.values)

    const pending = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS
    })

    expect(pending.identityPending).toBe(true)
    expect(pending.scanResults).toBeNull()
    expect(subject.values).toEqual(originalStorage)
    expect(subject.mutationCount).toBe(0)

    const validated = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      identityProvider: "google",
      accountEmail: "buyer@example.com"
    })
    expect(validated.identityPending).toBe(false)
    expect(validated.staleReviewRemoved).toBe(true)
    expect(validated.scanResults).toBeNull()
    expect(subject.values).not.toHaveProperty("scanResults")
    expect(subject.values).not.toHaveProperty("selections")
  })

  it("cancels an old identity read before it can mutate a newer stored review", async () => {
    let resolveFirstRead!: (value: Partial<StoredState>) => void
    let markFirstReadStarted!: () => void
    const firstReadStarted = new Promise<void>((resolve) => {
      markFirstReadStarted = resolve
    })
    const oldA: Partial<StoredState> = {
      settings: { ...DEFAULT_SETTINGS, sourceProvider: "amazon" },
      scanResults: {
        mediaItems,
        groups,
        scanDate: 1,
        totalItems: 2,
        sourceProvider: "amazon",
        providerSessionId: "session-a"
      },
      selections: {
        selectedGroupIds: ["group"],
        reviewedGroupIds: ["group"],
        keptOverrides: {}
      }
    }
    const values: Record<string, unknown> = { ...oldA }
    let readCount = 0
    let mutationCount = 0
    let removeCount = 0
    const scope = new StoredReviewScope({
      get: () => {
        readCount += 1
        if (readCount === 1) {
          markFirstReadStarted()
          return new Promise((resolve) => {
            resolveFirstRead = resolve
          })
        }
        return Promise.resolve(values as Partial<StoredState>)
      },
      async set(next) {
        mutationCount += 1
        Object.assign(values, next)
      },
      async remove(keys) {
        mutationCount += 1
        removeCount += 1
        for (const key of keys) delete values[key]
      }
    })

    const staleRestore = scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "amazon",
      identityProvider: "amazon",
      providerSessionId: "session-b"
    })
    await firstReadStarted
    const newB: Partial<StoredState> = {
      settings: { ...DEFAULT_SETTINGS, sourceProvider: "amazon" },
      scanResults: {
        mediaItems,
        groups,
        scanDate: 2,
        totalItems: 2,
        sourceProvider: "amazon",
        providerSessionId: "session-b"
      },
      selections: {
        selectedGroupIds: ["group"],
        reviewedGroupIds: ["group"],
        keptOverrides: {}
      }
    }
    Object.assign(values, newB)
    const currentRestore = scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "amazon",
      identityProvider: "amazon",
      providerSessionId: "session-b"
    })
    resolveFirstRead(oldA)

    const [stale, current] = await Promise.all([staleRestore, currentRestore])
    expect(stale.cancelled).toBe(true)
    expect(current.scanResults?.scanDate).toBe(2)
    expect(current.scanResults?.providerSessionId).toBe("session-b")
    expect(values.scanResults).toMatchObject({
      scanDate: 2,
      providerSessionId: "session-b"
    })
    expect(mutationCount).toBe(1)
    expect(removeCount).toBe(0)
  })

  it("does not write or clear storage after its restore lease is cancelled", async () => {
    let resolveRead!: (value: Partial<StoredState>) => void
    let markReadStarted!: () => void
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve
    })
    const values: Record<string, unknown> = {
      settings: { ...DEFAULT_SETTINGS, sourceProvider: "amazon" },
      scanResults: {
        mediaItems,
        groups,
        scanDate: 1,
        totalItems: 2,
        sourceProvider: "amazon",
        providerSessionId: "session-a"
      },
      selections: {
        selectedGroupIds: ["group"],
        reviewedGroupIds: ["group"],
        keptOverrides: {}
      }
    }
    const before = structuredClone(values)
    let mutationCount = 0
    let removeCount = 0
    const scope = new StoredReviewScope({
      get: () =>
        new Promise((resolve) => {
          markReadStarted()
          resolveRead = resolve
        }),
      async set(next) {
        mutationCount += 1
        Object.assign(values, next)
      },
      async remove(keys) {
        mutationCount += 1
        removeCount += 1
        for (const key of keys) delete values[key]
      }
    })
    let current = true
    const restore = scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "amazon",
      identityProvider: "amazon",
      providerSessionId: "session-b",
      isCurrent: () => current
    })
    await readStarted
    current = false
    resolveRead(values as Partial<StoredState>)

    const result = await restore
    expect(result.cancelled).toBe(true)
    expect(values).toEqual(before)
    // A cancelled restore must not mutate or clear the saved review.
    expect(mutationCount).toBe(0)
    expect(removeCount).toBe(0)
  })

  it("serializes a started stale-review invalidation before a newer identity write", async () => {
    let releaseRemove!: () => void
    let markRemoveStarted!: () => void
    const removeStarted = new Promise<void>((resolve) => {
      markRemoveStarted = resolve
    })
    const removeGate = new Promise<void>((resolve) => {
      releaseRemove = resolve
    })
    const values: Record<string, unknown> = {
      scanResults: {
        mediaItems,
        groups,
        scanDate: 1,
        totalItems: 2,
        sourceProvider: "amazon",
        providerSessionId: "session-a"
      },
      selections: { selectedGroupIds: ["group"], keptOverrides: {} }
    }
    const scope = new StoredReviewScope({
      async get() {
        return values as Partial<StoredState>
      },
      async set(next) {
        Object.assign(values, next)
      },
      async remove(keys) {
        markRemoveStarted()
        await removeGate
        for (const key of keys) delete values[key]
      }
    })
    let oldIdentityCurrent = true
    const staleInvalidation = scope.invalidateReview(
      () => oldIdentityCurrent,
      (stored) => stored.scanResults?.providerSessionId !== "session-b"
    )
    await removeStarted

    oldIdentityCurrent = false
    const newerReview = {
      mediaItems,
      groups,
      scanDate: 2,
      totalItems: 2,
      sourceProvider: "amazon" as const,
      providerSessionId: "session-b"
    }
    const newerWrite = scope.write({
      scanResults: newerReview,
      selections: {
        selectedGroupIds: ["group"],
        reviewedGroupIds: ["group"],
        keptOverrides: {}
      }
    })

    releaseRemove()
    await Promise.all([staleInvalidation, newerWrite])

    expect(values.scanResults).toMatchObject({
      sourceProvider: "amazon",
      providerSessionId: "session-b",
      scanDate: 2
    })
    expect(values.selections).toMatchObject({ selectedGroupIds: ["group"] })
  })

  it("preserves explicit non-Google providers and their configured scan controls during legacy migration", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      sourceProvider: "amazon" as const,
      similarityThreshold: 0.99,
      amazonBatchLimit: 240,
      exactOnly: true,
      protectFavorites: false
    }
    const subject = adapter({ settings })

    const restored = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS
    })

    expect(restored.settings).toEqual(settings)
  })

  it("restores and sanitizes review decisions through Duplicate Review Session", async () => {
    const subject = adapter({
      settings: { ...DEFAULT_SETTINGS, similarityThreshold: 0.98 },
      scanResults: {
        mediaItems,
        groups,
        scanDate: 1,
        totalItems: 2,
        accountEmail: "buyer@example.com",
        sourceProvider: "google"
      },
      selections: {
        selectedGroupIds: ["group", "stale"],
        reviewedGroupIds: ["group", "stale"],
        keptOverrides: { group: ["keep"], stale: ["missing"] }
      }
    })

    const restored = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      identityProvider: "google",
      accountEmail: "buyer@example.com"
    })

    expect([...restored.selections!.selectedGroupIds]).toEqual(["group"])
    expect([...restored.selections!.reviewedGroupIds]).toEqual(["group"])
    expect(subject.values.selections).toEqual({
      version: 2,
      selectedGroupIds: ["group"],
      reviewedGroupIds: ["group"],
      keptOverrides: { group: ["keep"] },
      keepDecisionProvenance: {
        group: { source: "legacy_preserved" }
      }
    })
  })

  it.each([[null], ["keep", null]] as const)(
    "fails closed when saved keeper identities contain non-strings: %j",
    async (savedKeys) => {
      const subject = adapter({
        settings: { ...DEFAULT_SETTINGS, sourceProvider: "google" },
        scanResults: {
          mediaItems,
          groups,
          scanDate: 1,
          totalItems: 2,
          accountEmail: "buyer@example.com",
          sourceProvider: "google"
        },
        selections: {
          selectedGroupIds: ["group"],
          reviewedGroupIds: ["group"],
          keptOverrides: { group: savedKeys as unknown as string[] },
          keepDecisionProvenance: { group: { source: "manual" } }
        }
      })

      const restored = await subject.scope.restore({
        fallbackSettings: DEFAULT_SETTINGS,
        identityProvider: "google",
        accountEmail: "buyer@example.com"
      })
      const review = new DuplicateReviewSession({
        groups,
        mediaItems,
        selections: restored.selections ?? undefined
      })

      expect(review.decisionFor(groups[0]!).source).toBe("stale_fallback")
      expect(review.keptFor(groups[0]!)).toEqual(new Set(["keep", "trash"]))
      expect(review.trashPlan(groups).mediaKeysToTrash).toEqual([])
      expect(subject.values.selections).toMatchObject({
        keptOverrides: { group: ["keep", "trash"] },
        keepDecisionProvenance: { group: { source: "stale_fallback" } }
      })
    }
  )

  it("preserves an intentional empty manual keeper list", async () => {
    const subject = adapter({
      settings: { ...DEFAULT_SETTINGS, sourceProvider: "google" },
      scanResults: {
        mediaItems,
        groups,
        scanDate: 1,
        totalItems: 2,
        accountEmail: "buyer@example.com",
        sourceProvider: "google"
      },
      selections: {
        selectedGroupIds: ["group"],
        reviewedGroupIds: ["group"],
        keptOverrides: { group: [] },
        keepDecisionProvenance: { group: { source: "manual" } }
      }
    })

    const restored = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      identityProvider: "google",
      accountEmail: "buyer@example.com"
    })
    const review = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: restored.selections ?? undefined
    })

    expect(review.decisionFor(groups[0]!).source).toBe("manual")
    expect(review.keptFor(groups[0]!)).toEqual(new Set())
    expect(review.trashPlan(groups).mediaKeysToTrash).toEqual(["keep", "trash"])
  })

  it.each([
    ["absent", undefined, false],
    ["null", null, true],
    ["string", "malformed", true],
    ["array", [], true]
  ] as const)(
    "fails closed for %s keeper roots when manual provenance remains",
    async (_label, root, hasRoot) => {
      const subject = adapter({
        settings: { ...DEFAULT_SETTINGS, sourceProvider: "google" },
        scanResults: {
          mediaItems,
          groups,
          scanDate: 1,
          totalItems: 2,
          accountEmail: "buyer@example.com",
          sourceProvider: "google"
        },
        selections: ({
          selectedGroupIds: ["group"],
          reviewedGroupIds: ["group"],
          ...(hasRoot
            ? { keptOverrides: root as unknown as Record<string, string[]> }
            : {}),
          keepDecisionProvenance: { group: { source: "manual" } }
        } as unknown) as StoredState["selections"]
      })

      const restored = await subject.scope.restore({
        fallbackSettings: DEFAULT_SETTINGS,
        identityProvider: "google",
        accountEmail: "buyer@example.com"
      })
      const review = new DuplicateReviewSession({
        groups,
        mediaItems,
        selections: restored.selections ?? undefined
      })

      expect(review.decisionFor(groups[0]!).source).toBe("stale_fallback")
      expect(review.trashPlan(groups).mediaKeysToTrash).toEqual([])
      expect(subject.values.selections).toMatchObject({
        keptOverrides: { group: ["keep", "trash"] },
        keepDecisionProvenance: { group: { source: "stale_fallback" } }
      })
    }
  )

  it.each([
    ["null", null],
    ["string", "malformed"],
    ["array", []]
  ] as const)(
    "fails closed for a present malformed %s keeper root without provenance",
    async (_label, root) => {
      const subject = adapter({
        settings: { ...DEFAULT_SETTINGS, sourceProvider: "google" },
        scanResults: {
          mediaItems,
          groups,
          scanDate: 1,
          totalItems: 2,
          accountEmail: "buyer@example.com",
          sourceProvider: "google"
        },
        selections: ({
          selectedGroupIds: ["group"],
          reviewedGroupIds: ["group"],
          keptOverrides: root
        } as unknown) as StoredState["selections"]
      })

      const restored = await subject.scope.restore({
        fallbackSettings: DEFAULT_SETTINGS,
        identityProvider: "google",
        accountEmail: "buyer@example.com"
      })
      const review = new DuplicateReviewSession({
        groups,
        mediaItems,
        selections: restored.selections ?? undefined
      })

      expect(review.decisionFor(groups[0]!).source).toBe("stale_fallback")
      expect(review.keptFor(groups[0]!)).toEqual(new Set(["keep", "trash"]))
      expect(review.trashPlan(groups).mediaKeysToTrash).toEqual([])
      expect(subject.values.selections).toMatchObject({
        keptOverrides: { group: ["keep", "trash"] },
        keepDecisionProvenance: { group: { source: "stale_fallback" } }
      })
    }
  )

  it.each([
    ["absent", undefined, false],
    ["null", null, true],
    ["string", "malformed", true],
    ["array", [], true]
  ] as const)(
    "fails closed for %s keeper roots when orphan legacy provenance remains",
    async (_label, root, hasRoot) => {
      const subject = adapter({
        settings: { ...DEFAULT_SETTINGS, sourceProvider: "google" },
        scanResults: {
          mediaItems,
          groups,
          scanDate: 1,
          totalItems: 2,
          accountEmail: "buyer@example.com",
          sourceProvider: "google"
        },
        selections: ({
          selectedGroupIds: ["group"],
          reviewedGroupIds: ["group"],
          ...(hasRoot
            ? { keptOverrides: root as unknown as Record<string, string[]> }
            : {}),
          keepDecisionProvenance: {
            group: { source: "legacy_preserved" }
          }
        } as unknown) as StoredState["selections"]
      })

      const restored = await subject.scope.restore({
        fallbackSettings: DEFAULT_SETTINGS,
        identityProvider: "google",
        accountEmail: "buyer@example.com"
      })
      const review = new DuplicateReviewSession({
        groups,
        mediaItems,
        selections: restored.selections ?? undefined
      })

      expect(review.decisionFor(groups[0]!).source).toBe("stale_fallback")
      expect(review.keptFor(groups[0]!)).toEqual(new Set(["keep", "trash"]))
      expect(review.trashPlan(groups).mediaKeysToTrash).toEqual([])
      expect(subject.values.selections).toMatchObject({
        keptOverrides: { group: ["keep", "trash"] },
        keepDecisionProvenance: { group: { source: "stale_fallback" } }
      })
    }
  )

  it.each(["manual", "stale_fallback", "legacy_preserved"] as const)(
    "fails closed when %s provenance has no per-group keeper override",
    async (source) => {
      const subject = adapter({
        settings: { ...DEFAULT_SETTINGS, sourceProvider: "google" },
        scanResults: {
          mediaItems,
          groups,
          scanDate: 1,
          totalItems: 2,
          accountEmail: "buyer@example.com",
          sourceProvider: "google"
        },
        selections: {
          selectedGroupIds: ["group"],
          reviewedGroupIds: ["group"],
          keptOverrides: {},
          keepDecisionProvenance: { group: { source } }
        }
      })

      const restored = await subject.scope.restore({
        fallbackSettings: DEFAULT_SETTINGS,
        identityProvider: "google",
        accountEmail: "buyer@example.com"
      })
      const review = new DuplicateReviewSession({
        groups,
        mediaItems,
        selections: restored.selections ?? undefined
      })

      expect(review.decisionFor(groups[0]!).source).toBe("stale_fallback")
      expect(review.keptFor(groups[0]!)).toEqual(new Set(["keep", "trash"]))
      expect(review.trashPlan(groups).mediaKeysToTrash).toEqual([])
    }
  )

  it("keeps legacy no-provenance hydration on the automatic default path", async () => {
    const subject = adapter({
      settings: { ...DEFAULT_SETTINGS, sourceProvider: "google" },
      scanResults: {
        mediaItems,
        groups,
        scanDate: 1,
        totalItems: 2,
        accountEmail: "buyer@example.com",
        sourceProvider: "google"
      },
      selections: {
        selectedGroupIds: ["group"],
        reviewedGroupIds: ["group"]
      } as unknown as StoredState["selections"]
    })

    const restored = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      identityProvider: "google",
      accountEmail: "buyer@example.com"
    })
    const review = new DuplicateReviewSession({
      groups,
      mediaItems,
      selections: restored.selections ?? undefined
    })

    expect(review.decisionFor(groups[0]!).source).toBe("automatic")
    expect(review.keptFor(groups[0]!).size).toBe(1)
    expect(review.trashPlan(groups).mediaKeysToTrash).toHaveLength(1)
  })

  it("removes review material from a different account", async () => {
    const subject = adapter({
      settings: DEFAULT_SETTINGS,
      scanResults: {
        mediaItems,
        groups,
        scanDate: 1,
        totalItems: 2,
        accountEmail: "old@example.com",
        sourceProvider: "google"
      },
      selections: {
        selectedGroupIds: ["group"],
        reviewedGroupIds: ["group"],
        keptOverrides: {}
      }
    })

    const restored = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      identityProvider: "google",
      accountEmail: "new@example.com"
    })

    expect(restored.staleReviewRemoved).toBe(true)
    expect(restored.scanResults).toBeNull()
    expect(subject.values).not.toHaveProperty("scanResults")
    expect(subject.values).not.toHaveProperty("selections")
  })

  it.each(["icloud", "amazon"] as const)(
    "[PARITY-02] removes Google review material when %s is selected without a provider session",
    async (provider) => {
      const subject = adapter({
        settings: { ...DEFAULT_SETTINGS, sourceProvider: provider },
        scanResults: {
          mediaItems,
          groups,
          scanDate: 1,
          totalItems: 2,
          accountEmail: "alice@example.com",
          sourceProvider: "google"
        },
        selections: {
          selectedGroupIds: ["group"],
          reviewedGroupIds: ["group"],
          keptOverrides: {}
        }
      })

      const restored = await subject.scope.restore({
        fallbackSettings: DEFAULT_SETTINGS
      })

      expect(restored.settings.sourceProvider).toBe(provider)
      expect(restored.staleReviewRemoved).toBe(true)
      expect(restored.scanResults).toBeNull()
      expect(restored.selections).toBeNull()
      expect(subject.values).not.toHaveProperty("scanResults")
      expect(subject.values).not.toHaveProperty("selections")
    }
  )

  it("[PARITY-02] removes iCloud review material from a different provider page session", async () => {
    const subject = adapter({
      settings: { ...DEFAULT_SETTINGS, sourceProvider: "icloud" },
      scanResults: {
        mediaItems,
        groups,
        scanDate: 1,
        totalItems: 2,
        sourceProvider: "icloud",
        providerSessionId: "icloud-session-old"
      },
      selections: {
        selectedGroupIds: ["group"],
        reviewedGroupIds: ["group"],
        keptOverrides: {}
      }
    })

    const restored = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      identityProvider: "icloud",
      providerSessionId: "icloud-session-new"
    })

    expect(restored.staleReviewRemoved).toBe(true)
    expect(restored.scanResults).toBeNull()
    expect(subject.values).not.toHaveProperty("scanResults")
    expect(subject.values).not.toHaveProperty("selections")
  })

  it("applies the side-panel Photo Provider to restored settings", async () => {
    const subject = adapter({
      settings: {
        ...DEFAULT_SETTINGS,
        sourceProvider: "google",
        albumScope: { mediaKey: "album", title: "Album" }
      }
    })

    const restored = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "icloud"
    })

    expect(restored.settings.sourceProvider).toBe("icloud")
    expect(restored.settings.albumScope).toBeUndefined()
  })

  it("[PARITY-03] restores Amazon album scope only for the matching provider", async () => {
    const subject = adapter({
      settings: {
        ...DEFAULT_SETTINGS,
        sourceProvider: "amazon",
        albumScope: {
          mediaKey: "amazon-album-personal-1",
          title: "Personal album"
        }
      }
    })

    const matching = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "amazon"
    })
    expect(matching.settings.albumScope).toEqual({
      mediaKey: "amazon-album-personal-1",
      title: "Personal album"
    })

    const mismatched = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "google"
    })
    expect(mismatched.settings.albumScope).toBeUndefined()
  })

  it("[PARITY-03] restores iCloud album scope only for the matching provider", async () => {
    const subject = adapter({
      settings: {
        ...DEFAULT_SETTINGS,
        sourceProvider: "icloud",
        albumScope: {
          mediaKey: "icloud-album-test-id",
          title: "Personal album"
        }
      }
    })

    const matching = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "icloud"
    })
    expect(matching.settings.albumScope).toEqual({
      mediaKey: "icloud-album-test-id",
      title: "Personal album"
    })

    const mismatched = await subject.scope.restore({
      fallbackSettings: DEFAULT_SETTINGS,
      hostProvider: "google"
    })
    expect(mismatched.settings.albumScope).toBeUndefined()
  })

  it("writes and removes stored artifacts through one interface", async () => {
    const subject = adapter()

    await subject.scope.write({
      settings: DEFAULT_SETTINGS,
      selections: {
        selectedGroupIds: [],
        reviewedGroupIds: [],
        keptOverrides: {}
      }
    })
    await subject.scope.write({ selections: null })

    expect(subject.values.settings).toEqual(DEFAULT_SETTINGS)
    expect(subject.values).not.toHaveProperty("selections")
  })

  it("prevents stale effects from recreating an invalidated review", async () => {
    const subject = adapter({
      scanResults: {
        mediaItems,
        groups,
        scanDate: 1,
        totalItems: 2,
        accountEmail: "old@example.com",
        sourceProvider: "google"
      }
    })

    await subject.scope.invalidateReview()
    await subject.scope.write({
      scanResults: {
        mediaItems,
        groups,
        scanDate: 2,
        totalItems: 2,
        accountEmail: "old@example.com",
        sourceProvider: "google"
      },
      selections: {
        selectedGroupIds: ["group"],
        reviewedGroupIds: ["group"],
        keptOverrides: {}
      }
    })

    expect(subject.values).not.toHaveProperty("scanResults")
    expect(subject.values).not.toHaveProperty("selections")

    subject.scope.startReview()
    await subject.scope.write({
      scanResults: {
        mediaItems,
        groups,
        scanDate: 3,
        totalItems: 2,
        accountEmail: "new@example.com",
        sourceProvider: "google"
      }
    })

    expect(subject.values.scanResults).toMatchObject({
      scanDate: 3,
      accountEmail: "new@example.com"
    })
  })
})
