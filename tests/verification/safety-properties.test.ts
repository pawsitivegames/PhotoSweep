import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  classifyDuplicateItems,
  classifyDuplicateGroup
} from "../../lib/duplicate-classifier"
import {
  applyDefaultKeepStrategyToSelections,
  DuplicateReviewSession,
  type DuplicateReviewSelections,
  type DuplicateTrashPlan
} from "../../lib/duplicate-review-session"
import { evaluateReviewPreflight } from "../../lib/review-preflight"
import {
  recommendDefaultKeepForGroup,
  recommendKeepForGroup,
  type KeepStrategy
} from "../../lib/keep-strategy"
import {
  captureTrashDispatchAuthorization,
  isTrashDispatchAuthorizationCurrent
} from "../../lib/trash-dispatch-guard"
import {
  TrashLifecycle,
  type TrashAuditAdapter,
  type TrashProviderResultData
} from "../../lib/trash-lifecycle"
import {
  createPendingRecoveryRecord,
  markRecoveryRestore,
  updateRecoveryRecordFromTrash,
  type RecoveryHistoryContext
} from "../../lib/recovery-history"
import { buildTrashResultReport } from "../../lib/trash-result-report"
import {
  ProviderScopedReviewStorage,
  providerReviewStorageKey,
  type ReviewStorageAdapter
} from "../../lib/provider-review-storage"
import { StoredReviewScope } from "../../lib/stored-review-scope"
import type { DeleteReport } from "../../lib/delete-report"
import type {
  DuplicateGroup,
  GpdMediaItem,
  MutationOutcome,
  PhotoProvider,
  StoredState
} from "../../lib/types"
import { DEFAULT_SETTINGS } from "../../lib/types"

const propertyRuns = Math.max(
  1,
  Number.parseInt(process.env.FAST_CHECK_NUM_RUNS ?? "250", 10) || 250
)
const propertySeed = Number.parseInt(
  process.env.FAST_CHECK_SEED ?? "20260915",
  10
)
const nonCaptureTimestampProvenance = ["creation", "modified", "unknown"] as const

console.info(
  `[verification] fast-check seed=${propertySeed} numRuns=${propertyRuns}`
)

const keyNumbersArb = fc.uniqueArray(fc.integer({ min: 1, max: 1_000_000 }), {
  minLength: 2,
  maxLength: 6
})

const baseItem = (
  mediaKey: string,
  overrides: Partial<GpdMediaItem> = {}
): GpdMediaItem => ({
  mediaKey,
  dedupKey: `dedup-${mediaKey}`,
  thumb: `thumb-${mediaKey}`,
  timestamp: 1_700_000_000_000,
  creationTimestamp: 1_700_000_000_000,
  provider: "google",
  ...overrides
})

function lifecycleFixture(count: number) {
  const kept = baseItem("keep", { dedupKey: "dedup-keep" })
  const trashItems = Array.from({ length: count }, (_, index) =>
    baseItem(`trash-${index}`, { dedupKey: `dedup-trash-${index}` })
  )
  const mediaItems = Object.fromEntries(
    [kept, ...trashItems].map((item) => [item.mediaKey, item])
  )
  const groups: DuplicateGroup[] = [
    {
      id: "generated-group",
      mediaKeys: [kept.mediaKey, ...trashItems.map((item) => item.mediaKey)],
      originalMediaKey: kept.mediaKey,
      similarity: 1
    }
  ]
  const reviewSession = new DuplicateReviewSession({
    groups,
    mediaItems,
    selections: {
      selectedGroupIds: new Set([groups[0].id]),
      reviewedGroupIds: new Set([groups[0].id]),
      keptOverrides: { [groups[0].id]: new Set([kept.mediaKey]) }
    }
  })
  const plan: DuplicateTrashPlan = {
    provider: "google",
    dedupKeys: trashItems.map((item) => item.dedupKey),
    mediaKeysToTrash: trashItems.map((item) => item.mediaKey),
    blockedMediaKeys: [],
    blockedGroupIds: [],
    unknownFavoriteMediaKeys: trashItems.map((item) => item.mediaKey)
  }
  const audit: TrashAuditAdapter = {
    async savePreTrashReport() {},
    async saveTrashResultReport() {}
  }
  return {
    lifecycle: new TrashLifecycle(audit),
    groups,
    mediaItems,
    reviewSession,
    plan
  }
}

async function startLifecycle(count: number) {
  const fixture = lifecycleFixture(count)
  const command = await fixture.lifecycle.begin({
    plan: fixture.plan,
    reviewSession: fixture.reviewSession,
    groups: fixture.groups,
    snapshot: {
      mediaItems: fixture.mediaItems,
      groups: fixture.groups,
      totalItems: Object.keys(fixture.mediaItems).length
    },
    batchPolicy: {
      batchSize: 25,
      batchPauseMs: 0,
      retryCount: 0,
      retryBackoffMs: 0
    },
    unknownFavoriteAcknowledged: true
  })
  return { ...fixture, requestId: command.requestId }
}

describe("generated safety properties", () => {
  it("PARITY-09 provider-scoped review storage preserves buckets across generated interleavings", async () => {
    const providers = ["google", "icloud", "amazon"] as const
    type Operation = "write" | "invalidate"
    const waveArbitrary = fc.record({
      google: fc.constantFrom<Operation>("write", "invalidate"),
      icloud: fc.constantFrom<Operation>("write", "invalidate"),
      amazon: fc.constantFrom<Operation>("write", "invalidate")
    })
    const interleavingArbitrary = fc.array(waveArbitrary, {
      minLength: 1,
      maxLength: 12
    })

    await fc.assert(
      fc.asyncProperty(interleavingArbitrary, async (waves) => {
        const values: Record<string, unknown> = {}
        const raw: ReviewStorageAdapter = {
          async get(keys) {
            await Promise.resolve()
            return Object.fromEntries(
              keys
                .filter((key) => Object.hasOwn(values, key))
                .map((key) => [key, structuredClone(values[key])])
            )
          },
          async set(next) {
            await Promise.resolve()
            Object.assign(values, structuredClone(next))
          },
          async remove(keys) {
            await Promise.resolve()
            for (const key of keys) delete values[key]
          }
        }
        const storageByProvider = new Map(
          providers.map((provider) => [
            provider,
            new ProviderScopedReviewStorage(raw, {
              getHostProvider: () => provider,
              getActiveProvider: () => provider
            })
          ])
        )
        type ReviewModel = {
          scanResults: Record<string, unknown>
          selections: Record<string, unknown>
        }
        const expected = new Map<PhotoProvider, ReviewModel | null>(
          providers.map((provider) => [provider, null])
        )
        const revisions = new Map<PhotoProvider, number>(
          providers.map((provider) => [provider, 0])
        )

        const makeState = (provider: PhotoProvider, revision: number) => {
          const keepKey = `${provider}-keep-${revision}`
          const trashKey = `${provider}-trash-${revision}`
          return {
            settings: { ...DEFAULT_SETTINGS, sourceProvider: provider },
            scanResults: {
              mediaItems: {
                [keepKey]: {
                  mediaKey: keepKey,
                  dedupKey: `${keepKey}-dedup`,
                  thumb: keepKey,
                  timestamp: revision,
                  creationTimestamp: revision,
                  provider
                },
                [trashKey]: {
                  mediaKey: trashKey,
                  dedupKey: `${trashKey}-dedup`,
                  thumb: trashKey,
                  timestamp: revision,
                  creationTimestamp: revision,
                  provider
                }
              },
              groups: [
                {
                  id: "provider-colliding-group-id",
                  mediaKeys: [keepKey, trashKey],
                  originalMediaKey: keepKey,
                  similarity: 1
                }
              ],
              scanDate: revision,
              totalItems: 2,
              sourceProvider: provider,
              ...(provider === "google"
                ? { accountEmail: "google@example.com" }
                : { providerSessionId: `${provider}-session-${revision}` })
            },
            selections: {
              selectedGroupIds: ["provider-colliding-group-id"],
              reviewedGroupIds: ["provider-colliding-group-id"],
              keptOverrides: {
                "provider-colliding-group-id": [keepKey]
              },
              keepDecisionProvenance: {
                "provider-colliding-group-id": { source: "manual" as const }
              }
            }
          }
        }

        for (const wave of waves) {
          const operations = providers.flatMap((provider) => {
            const operation = wave[provider]
            return operation ? [{ provider, operation }] : []
          })
          await Promise.all(
            operations.map(async ({ provider, operation }) => {
              const revision = revisions.get(provider)! + 1
              revisions.set(provider, revision)
              const state = makeState(provider, revision)
              const storage = storageByProvider.get(provider)!
              await storage.set(
                {
                  settings: state.settings,
                  scanResults: state.scanResults,
                  selections: state.selections
                },
                provider
              )
              expected.set(provider, {
                scanResults: state.scanResults,
                selections: state.selections
              })

              if (operation !== "invalidate") return
              const restored = await new StoredReviewScope(storage).restore({
                fallbackSettings: {
                  ...DEFAULT_SETTINGS,
                  sourceProvider: provider
                },
                hostProvider: provider,
                identityProvider: provider,
                ...(provider === "google"
                  ? { accountEmail: "different-google@example.com" }
                  : {
                      providerSessionId: `different-${provider}-session-${revision}`
                    })
              })
              expect(restored.staleReviewRemoved).toBe(true)
              expect(restored.scanResults).toBeNull()
              expect(restored.selections).toBeNull()
              expected.set(provider, null)
            })
          )

          for (const provider of providers) {
            const resultsKey = providerReviewStorageKey(provider, "scanResults")
            const selectionsKey = providerReviewStorageKey(provider, "selections")
            const modelState = expected.get(provider)
            if (modelState) {
              expect(values[resultsKey]).toEqual(modelState.scanResults)
              expect(values[selectionsKey]).toEqual(modelState.selections)
            } else {
              expect(Object.hasOwn(values, resultsKey)).toBe(false)
              expect(Object.hasOwn(values, selectionsKey)).toBe(false)
            }
          }
        }
      }),
      { numRuns: propertyRuns, seed: propertySeed + 90009 }
    )
  }, 60_000)

  it("PARITY-09 negative unscoped-key witness shows invalidation erases its peer", () => {
    const sharedKeys: Record<string, unknown> = {}
    const googleReview = {
      provider: "google",
      groupId: "provider-colliding-group-id"
    }
    const amazonReview = {
      provider: "amazon",
      groupId: "provider-colliding-group-id"
    }

    sharedKeys.scanResults = googleReview
    sharedKeys.selections = { selectedGroupIds: [googleReview.groupId] }
    sharedKeys.scanResults = amazonReview
    sharedKeys.selections = { selectedGroupIds: [amazonReview.groupId] }
    const peerStateBeforeGoogleInvalidation = structuredClone(sharedKeys)
    delete sharedKeys.scanResults
    delete sharedKeys.selections

    expect(peerStateBeforeGoogleInvalidation.scanResults).toEqual(amazonReview)
    expect(sharedKeys).toEqual({})
  })

  it("SAFE-13 explicitly replaces manual choices, re-includes groups, and reopens changed plans", () => {
    const strategies = [
      "best_quality",
      "largest_resolution",
      "newest_taken",
      "oldest_taken",
      "newest_upload",
      "non_storage_counting"
    ] as const

    fc.assert(
      fc.property(
        keyNumbersArb,
        fc.constantFrom("automatic", "manual_keeper", "manual_trash_all"),
        (numbers, manualChoice) => {
          const mediaKeys = numbers.map((number) => `media-${number}`)
          const mediaItems = Object.fromEntries(
            mediaKeys.map((mediaKey, index) => [
              mediaKey,
              baseItem(mediaKey, {
                isOriginalQuality: index === 0,
                resWidth: index + 1,
                resHeight: 1,
                timestamp: 1_700_000_000_000 + index,
                timestampProvenance: "capture",
                creationTimestamp: 1_600_000_000_000 + index,
                creationTimestampProvenance: "creation",
                takesUpSpace: index !== 0
              })
            ])
          )
          const group: DuplicateGroup = {
            id: "automatic-keep-group",
            mediaKeys,
            originalMediaKey: mediaKeys[0],
            similarity: 1
          }
          const groups = [group]

          for (const includedBefore of [false, true]) {
            const manualOverrides: Record<string, Set<string>> =
              manualChoice === "manual_keeper"
                ? { [group.id]: new Set([mediaKeys[0]]) }
                : manualChoice === "manual_trash_all"
                  ? { [group.id]: new Set<string>() }
                  : {}
            const manualProvenance: Record<string, { source: "manual" }> =
              manualChoice === "automatic"
                ? {}
                : { [group.id]: { source: "manual" } }
            const initiallySelected = new DuplicateReviewSession({
              groups,
              mediaItems,
              selections: {
                selectedGroupIds: new Set([group.id]),
                reviewedGroupIds: new Set([group.id]),
                keptOverrides: manualOverrides,
                keepDecisionProvenance: manualProvenance
              }
            })
            const initial = includedBefore
              ? initiallySelected
              : new DuplicateReviewSession({
                  groups,
                  mediaItems,
                  selections: initiallySelected.update({
                    type: "deselect_groups",
                    groupIds: [group.id]
                  })
                })
            const originalSelection = new Set(initial.selectedGroupIds)
            const originalKeeper = initial.keptFor(group)

            for (const strategy of strategies) {
              const selections = initial.update({
                type: "apply_keep_strategy",
                groupIds: [group.id],
                strategy
              })
              const updated = new DuplicateReviewSession({
                groups,
                mediaItems,
                selections
              })

              expect(selections.selectedGroupIds).toEqual(originalSelection)
              expect(updated.selectedGroupIds).toEqual(originalSelection)
              const recomputationReview = new Set(initial.reviewedGroupIds)
              if (
                includedBefore &&
                manualChoice === "automatic" &&
                (originalKeeper.size !== updated.keptFor(group).size ||
                  [...originalKeeper].some(
                    (mediaKey) => !updated.keptFor(group).has(mediaKey)
                  ))
              ) {
                recomputationReview.delete(group.id)
              }
              expect(updated.reviewedGroupIds).toEqual(recomputationReview)
              if (manualChoice === "manual_trash_all") {
                expect(updated.keptFor(group).size).toBe(0)
              } else {
                expect(updated.keptFor(group).size).toBeGreaterThan(0)
              }
              if (!includedBefore) {
                expect(updated.trashPlan(groups).mediaKeysToTrash).toEqual([])
              }

              const bulkSelections = initial.update({
                type: "apply_keep_strategy",
                groupIds: [group.id],
                strategy,
                overrideManualChoices: true
              })
              const bulkReview = new DuplicateReviewSession({
                groups,
                mediaItems,
                selections: bulkSelections
              })

              expect(bulkReview.selectedGroupIds).toEqual(originalSelection)
              const bulkReviewExpected = new Set(initial.reviewedGroupIds)
              const bulkKeeperChanged =
                originalKeeper.size !== bulkReview.keptFor(group).size ||
                [...originalKeeper].some(
                  (mediaKey) => !bulkReview.keptFor(group).has(mediaKey)
                )
              if (includedBefore && bulkKeeperChanged) {
                bulkReviewExpected.delete(group.id)
              }
              expect(bulkReview.reviewedGroupIds).toEqual(bulkReviewExpected)
              expect(bulkReview.keptFor(group)).toEqual(
                new Set(
                  recommendDefaultKeepForGroup(
                    group,
                    mediaItems,
                    strategy
                  ).keptMediaKeys
                )
              )
              expect(bulkReview.decisionFor(group).source).toBe("automatic")
              expect(bulkReview.trashPlan(groups).mediaKeysToTrash.length).toBe(
                includedBefore
                  ? mediaKeys.length - bulkReview.keptFor(group).size
                  : 0
              )
            }
          }
        }
      ),
      { numRuns: propertyRuns, seed: propertySeed + 13 }
    )
  }, 60_000)

  it("SAFE-01 keeps every member when a keep recommendation is not unique and valid", () => {
    fc.assert(
      fc.property(
        keyNumbersArb,
        fc.array(
          fc.oneof(
            fc.integer({ min: -10_000, max: 10_000 }),
            fc.constant(null)
          ),
          { minLength: 2, maxLength: 6 }
        ),
        (numbers, generatedValues) => {
          const values = generatedValues.slice(0, numbers.length)
          while (values.length < numbers.length) values.push(null)
          const mediaKeys = numbers.map((number) => `media-${number}`)
          const group: DuplicateGroup = {
            id: "keep-property",
            mediaKeys,
            originalMediaKey: mediaKeys[0],
            similarity: 1
          }
          const mediaItems = Object.fromEntries(
            mediaKeys.map((mediaKey, index) => [
              mediaKey,
              baseItem(mediaKey, {
              timestamp:
                values[index] === null
                  ? (undefined as unknown as number)
                  : values[index],
              timestampProvenance:
                values[index] === null ? "unknown" : "capture"
            })
            ])
          )
          const recommendation = recommendKeepForGroup(
            group,
            mediaItems,
            "newest_taken"
          )
          const allKeys = new Set(mediaKeys)
          const allValuesKnown = values.every(
            (value): value is number => value !== null
          )
          const winningValue = allValuesKnown
            ? Math.max(...(values as number[]))
            : undefined
          const winningCount =
            winningValue === undefined
              ? 0
              : values.filter((value) => value === winningValue).length

          if (allValuesKnown && winningCount === 1) {
            const winner = mediaKeys[
              values.indexOf(winningValue as number)
            ]
            expect(recommendation.status).toBe("recommended")
            expect(recommendation.keptMediaKeys).toEqual([winner])
          } else {
            expect(recommendation.status).toBe("no_confident_recommendation")
            expect(new Set(recommendation.keptMediaKeys)).toEqual(allKeys)
          }
        }
      ),
      { numRuns: propertyRuns, seed: propertySeed }
    )
  })

  it("SAFE-01 deterministic defaults survive hydration and preserve manual decisions on reapplication", async () => {
    const strategies = [
      "best_quality",
      "largest_resolution",
      "newest_taken",
      "oldest_taken",
      "newest_upload",
      "non_storage_counting"
    ] as const satisfies readonly KeepStrategy[]
    const signalArbitrary = fc.record({
      present: fc.boolean(),
      quality: fc.option(fc.boolean(), { nil: null }),
      width: fc.integer({ min: 0, max: 6_000 }),
      height: fc.integer({ min: 0, max: 6_000 }),
      bytes: fc.option(fc.integer({ min: 0, max: 10_000_000 }), {
        nil: undefined
      }),
      timestamp: fc.integer({ min: 0, max: 2_000_000_000_000 }),
      timestampProvenance: fc.constantFrom(
        "capture" as const,
        "creation" as const,
        "modified" as const,
        "unknown" as const
      ),
      creationTimestamp: fc.integer({ min: 0, max: 2_000_000_000_000 }),
      creationTimestampProvenance: fc.constantFrom(
        "creation" as const,
        "capture" as const,
        "modified" as const,
        "unknown" as const
      ),
      takesUpSpace: fc.option(fc.boolean(), { nil: null })
    })

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...strategies),
        fc.array(signalArbitrary, { minLength: 6, maxLength: 6 }),
        fc.constantFrom<"one" | "both" | "none">("one", "both", "none"),
        async (strategy, signals, manualShape) => {
          const mediaItems: Record<string, GpdMediaItem> = {}
          for (const [index, signal] of signals.entries()) {
            if (!signal.present) continue
            const mediaKey = `member-${index}`
            mediaItems[mediaKey] = baseItem(mediaKey, {
              isOriginalQuality: signal.quality,
              resWidth: signal.width,
              resHeight: signal.height,
              size: signal.bytes,
              timestamp: signal.timestamp,
              timestampProvenance: signal.timestampProvenance,
              creationTimestamp: signal.creationTimestamp,
              creationTimestampProvenance:
                signal.creationTimestampProvenance,
              takesUpSpace: signal.takesUpSpace
            })
          }
          const groups: DuplicateGroup[] = [0, 1, 2].map((index) => ({
            id: `default-group-${index}`,
            mediaKeys: [`member-${index * 2}`, `member-${index * 2 + 1}`],
            originalMediaKey: `member-${index * 2}`,
            similarity: 1
          }))

          // This is the shared result-ready selector used by both fresh scan
          // completion and restored completed results.
          const defaults = new DuplicateReviewSession({
            groups,
            mediaItems,
            defaultStrategy: strategy
          })
          const selectedByGroup = new Map<string, Set<string>>()
          for (const group of groups) {
            const decision = defaults.decisionFor(group)
            expect(decision.source).toBe("automatic")
            expect(decision.strategy).toBe(strategy)
            const presentMediaKeys = group.mediaKeys.filter((key) =>
              Boolean(mediaItems[key])
            )
            const recommendation = recommendDefaultKeepForGroup(
              group,
              mediaItems,
              strategy
            )
            expect(decision.keptMediaKeys).toEqual(
              new Set(recommendation.keptMediaKeys)
            )
            if (presentMediaKeys.length === group.mediaKeys.length) {
              expect(decision.keptMediaKeys.size).toBe(1)
              expect(recommendation.status).toBe("recommended")
            } else {
              expect(recommendation).toMatchObject({
                status: "no_confident_recommendation",
                reasonCode: "missing_member"
              })
              expect(recommendation.keptMediaKeys).toEqual(presentMediaKeys)
            }
            selectedByGroup.set(group.id, new Set(decision.keptMediaKeys))
          }

          const reorderedGroups = groups.map((group) => ({
            ...group,
            mediaKeys: [...group.mediaKeys].reverse()
          }))
          const reorderedItems = Object.fromEntries(
            Object.entries(mediaItems).reverse()
          )
          const reorderedDefaults = new DuplicateReviewSession({
            groups: reorderedGroups,
            mediaItems: reorderedItems,
            defaultStrategy: strategy
          })
          for (const group of reorderedGroups) {
            expect(reorderedDefaults.keptFor(group)).toEqual(
              selectedByGroup.get(group.id)
            )
          }

          const persisted: Record<string, unknown> = {}
          const scope = new StoredReviewScope({
            async get(keys) {
              return Object.fromEntries(
                keys
                  .filter((key) => Object.hasOwn(persisted, key))
                  .map((key) => [key, structuredClone(persisted[key])])
              ) as Partial<StoredState>
            },
            async set(values) {
              Object.assign(persisted, structuredClone(values))
            },
            async remove(keys) {
              for (const key of keys) delete persisted[key]
            }
          })
          await scope.write({
            settings: { ...DEFAULT_SETTINGS, defaultKeepStrategy: strategy }
          })
          const restored = await scope.restore({
            fallbackSettings: DEFAULT_SETTINGS,
            hostProvider: "google"
          })
          expect(restored.settings.defaultKeepStrategy).toBe(strategy)

          const manualKeys =
            manualShape === "none"
              ? []
              : manualShape === "one"
                ? [groups[0].mediaKeys[0]]
                : [...groups[0].mediaKeys]
          const priorSelections: DuplicateReviewSelections = {
            selectedGroupIds: new Set([groups[0].id]),
            reviewedGroupIds: new Set(groups.map((group) => group.id)),
            keptOverrides: {
              [groups[0].id]: new Set(manualKeys),
              [groups[1].id]: new Set([groups[1].mediaKeys[0]]),
              [groups[2].id]: new Set([groups[2].mediaKeys[0]])
            },
            keepDecisionProvenance: {
              [groups[0].id]: { source: "manual" },
              [groups[2].id]: {
                source: "automatic",
                strategy: "best_quality"
              }
            }
          }
          const applied = applyDefaultKeepStrategyToSelections({
            groups,
            mediaItems,
            selections: priorSelections,
            strategy
          })
          const appliedSession = new DuplicateReviewSession({
            groups,
            mediaItems,
            selections: applied,
            defaultStrategy: strategy
          })
          const presentManualKeys = manualKeys.filter((key) =>
            Boolean(mediaItems[key])
          )
          const presentGroupKeys = groups[0].mediaKeys.filter((key) =>
            Boolean(mediaItems[key])
          )
          const expectedManualKeys =
            manualKeys.length === 0
              ? []
              : presentManualKeys.length > 0
                ? presentManualKeys
                : presentGroupKeys
          const expectedManualSource =
            manualKeys.length > 0 && presentManualKeys.length === 0
              ? "stale_fallback"
              : "manual"
          expect(appliedSession.keptFor(groups[0])).toEqual(
            new Set(expectedManualKeys)
          )
          expect(appliedSession.decisionFor(groups[0]).source).toBe(
            expectedManualSource
          )
          if (presentGroupKeys.length < groups[0].mediaKeys.length) {
            expect(
              appliedSession.trashPlan([groups[0]]).mediaKeysToTrash
            ).toEqual([])
          }
          for (const group of groups.slice(1)) {
            expect(appliedSession.decisionFor(group)).toMatchObject({
              source: mediaItems[group.mediaKeys[0]]
                ? "automatic"
                : "stale_fallback",
              strategy
            })
            expect([...appliedSession.keptFor(group)]).toEqual(
              recommendDefaultKeepForGroup(group, mediaItems, strategy)
                .keptMediaKeys
            )
          }

          const storedSelections = appliedSession.serialize()
          const hydratedSelections: DuplicateReviewSelections = {
            selectedGroupIds: new Set(storedSelections.selectedGroupIds),
            reviewedGroupIds: new Set(storedSelections.reviewedGroupIds),
            keptOverrides: Object.fromEntries(
              Object.entries(storedSelections.keptOverrides).map(
                ([groupId, keys]) => [groupId, new Set(keys)]
              )
            ),
            keepDecisionProvenance: storedSelections.keepDecisionProvenance
          }
          const nextStrategy: KeepStrategy =
            strategy === "best_quality" ? "newest_upload" : "best_quality"
          const reapplied = applyDefaultKeepStrategyToSelections({
            groups,
            mediaItems,
            selections: hydratedSelections,
            strategy: nextStrategy
          })
          const reappliedSession = new DuplicateReviewSession({
            groups,
            mediaItems,
            selections: reapplied,
            defaultStrategy: nextStrategy
          })
          expect(reappliedSession.keptFor(groups[0])).toEqual(
            new Set(expectedManualKeys)
          )
          expect(reappliedSession.decisionFor(groups[0]).source).toBe(
            expectedManualSource
          )
          if (presentGroupKeys.length < groups[0].mediaKeys.length) {
            expect(
              reappliedSession.trashPlan([groups[0]]).mediaKeysToTrash
            ).toEqual([])
          }
          for (const group of groups.slice(1)) {
            expect(reappliedSession.decisionFor(group)).toMatchObject({
              source: mediaItems[group.mediaKeys[0]]
                ? "automatic"
                : "stale_fallback",
              strategy: nextStrategy
            })
            expect([...reappliedSession.keptFor(group)]).toEqual(
              recommendDefaultKeepForGroup(group, mediaItems, nextStrategy)
                .keptMediaKeys
            )
          }
        }
      ),
      { numRuns: propertyRuns, seed: propertySeed + 14 }
    )
  }, 60_000)

  it("SAFE-01 treats a unique top value as sufficient even when lower values tie", () => {
    const group: DuplicateGroup = {
      id: "explicit-keeper",
      mediaKeys: ["a", "b", "c"],
      originalMediaKey: "a",
      similarity: 1
    }
    const mediaItems = {
      a: baseItem("a", { timestamp: 3, timestampProvenance: "capture" }),
      b: baseItem("b", { timestamp: 1, timestampProvenance: "capture" }),
      c: baseItem("c", { timestamp: 1, timestampProvenance: "capture" })
    }
    expect(
      recommendKeepForGroup(group, mediaItems, "newest_taken").keptMediaKeys
    ).toEqual(["a"])

    const tied = {
      ...mediaItems,
      b: baseItem("b", { timestamp: 3, timestampProvenance: "capture" })
    }
    expect(
      recommendKeepForGroup(group, tied, "newest_taken").keptMediaKeys
    ).toEqual(["a", "b", "c"])
  })

  it("SAFE-01 refuses a taken-date recommendation without capture provenance", () => {
    fc.assert(
      fc.property(
        keyNumbersArb,
        fc.constantFrom(...nonCaptureTimestampProvenance),
        (numbers, timestampProvenance) => {
          const [first, second] = numbers
          const group: DuplicateGroup = {
            id: "unknown-capture-provenance",
            mediaKeys: ["newer", "older"],
            originalMediaKey: "newer",
            similarity: 1
          }
          const mediaItems = {
            newer: baseItem("newer", {
              timestamp: Math.max(first, second) + 1,
              timestampProvenance
            }),
            older: baseItem("older", {
              timestamp: Math.min(first, second),
              timestampProvenance
            })
          }
          const recommendation = recommendKeepForGroup(
            group,
            mediaItems,
            "newest_taken"
          )

          expect(recommendation.status).toBe("no_confident_recommendation")
          expect(recommendation.reasonCode).toBe("unknown_provenance")
          expect(recommendation.keptMediaKeys).toEqual(["newer", "older"])
        }
      ),
      { numRuns: propertyRuns, seed: propertySeed + 8 }
    )
  })

  it("SAFE-04 never promotes metadata, thumbnail, or legacy labels to verified identity", () => {
    fc.assert(
      fc.property(
        fc.record({
          stem: fc.integer({ min: 1, max: 100_000 }),
          width: fc.integer({ min: 1, max: 8_000 }),
          height: fc.integer({ min: 1, max: 8_000 }),
          timestamp: fc.integer({ min: 1, max: 2_000_000_000_000 }),
          size: fc.integer({ min: 1, max: 10_000_000 })
        }),
        (metadata) => {
          const items = ["a", "b", "c"].map((key) =>
            baseItem(key, {
              dedupKey: `provider-${key}`,
              thumb: "same-thumbnail",
              exactContentHash: "legacy-label-only",
              fileName: `IMG_${metadata.stem}.jpg`,
              resWidth: metadata.width,
              resHeight: metadata.height,
              timestamp: metadata.timestamp,
              timestampProvenance: "capture",
              size: metadata.size
            })
          )
          const classification = classifyDuplicateItems(items, 1)

          expect(classification.duplicateKind).not.toBe("exact")
          expect(classification.evidenceLevel).not.toBe("verified_identical")
          expect(classification.matchReasons).toEqual(
            expect.arrayContaining([
              "same filename",
              "same dimensions",
              "same taken date",
              "same legacy content hash (unverified)"
            ])
          )
        }
      ),
      { numRuns: propertyRuns, seed: propertySeed + 1 }
    )
  })

  it("SAFE-04 does not report equal metadata dates as taken dates without capture provenance", () => {
    fc.assert(
      fc.property(
        fc.record({
          stem: fc.integer({ min: 1, max: 100_000 }),
          timestamp: fc.integer({ min: 1, max: 2_000_000_000_000 }),
          size: fc.integer({ min: 1, max: 10_000_000 })
        }),
        fc.constantFrom(...nonCaptureTimestampProvenance),
        (metadata, timestampProvenance) => {
          const items = ["a", "b", "c"].map((key) =>
            baseItem(key, {
              dedupKey: `provider-${key}`,
              fileName: `IMG_${metadata.stem}.jpg`,
              timestamp: metadata.timestamp,
              timestampProvenance,
              size: metadata.size
            })
          )
          const classification = classifyDuplicateItems(items, 1)

          expect(classification.matchReasons).not.toContain("same taken date")
          expect(classification.evidenceLevel).not.toBe("verified_identical")
        }
      ),
      { numRuns: propertyRuns, seed: propertySeed + 9 }
    )
  })

  it("SAFE-02 rejects every generated dispatch authorization drift", () => {
    const driftArb = fc.constantFrom(
      "generation",
      "provider",
      "account",
      "scope",
      "plan"
    )
    fc.assert(
      fc.property(keyNumbersArb, driftArb, (numbers, drift) => {
        const plan: DuplicateTrashPlan = {
          provider: "google",
          dedupKeys: [`dedup-${numbers[0]}`],
          mediaKeysToTrash: [`media-${numbers[0]}`],
          blockedMediaKeys: [],
          blockedGroupIds: []
        }
        const expected = captureTrashDispatchAuthorization({
          generation: 4,
          plan,
          provider: "google",
          accountEmail: "owner@example.com",
          scopeFingerprint: "scope-a"
        })
        const current = captureTrashDispatchAuthorization({
          generation: drift === "generation" ? 5 : 4,
          plan:
            drift === "plan"
              ? { ...plan, mediaKeysToTrash: [`media-${numbers[1]}`] }
              : plan,
          provider: drift === "provider" ? "icloud" : "google",
          accountEmail:
            drift === "account" ? "other@example.com" : "owner@example.com",
          scopeFingerprint: drift === "scope" ? "scope-b" : "scope-a"
        })
        expect(isTrashDispatchAuthorizationCurrent(expected, current)).toBe(
          false
        )
      }),
      { numRuns: propertyRuns, seed: propertySeed + 7 }
    )
  })

  it("SAFE-06 requires an exact unknown-favorite declaration and acknowledgement", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.record({
          declaresUnknown: fc.boolean(),
          acknowledged: fc.boolean()
        }),
        async (count, options) => {
          const fixture = lifecycleFixture(count)
          const plan: DuplicateTrashPlan = options.declaresUnknown
            ? fixture.plan
            : { ...fixture.plan, unknownFavoriteMediaKeys: [] }
          const begin = fixture.lifecycle.begin({
            plan,
            reviewSession: fixture.reviewSession,
            groups: fixture.groups,
            snapshot: {
              mediaItems: fixture.mediaItems,
              groups: fixture.groups,
              totalItems: Object.keys(fixture.mediaItems).length
            },
            batchPolicy: {
              batchSize: 25,
              batchPauseMs: 0,
              retryCount: 0,
              retryBackoffMs: 0
            },
            unknownFavoriteAcknowledged: options.acknowledged
          })

          if (options.declaresUnknown && options.acknowledged) {
            const command = await begin
            expect(command.totalToTrash).toBe(count)
            expect(command.args.acknowledgedUnknownFavoriteDedupKeys).toEqual(
              fixture.plan.dedupKeys
            )
          } else {
            await expect(begin).rejects.toThrow(/favorite/i)
          }
        }
      ),
      { numRuns: propertyRuns, seed: propertySeed + 10 }
    )
  })

  it("SAFE-06 rejects duplicate and foreign unknown-favorite declarations before dispatch", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.constantFrom("duplicate", "foreign" as const),
        async (count, invalidKind) => {
          const fixture = lifecycleFixture(count)
          const declaredUnknownFavoriteMediaKeys =
            invalidKind === "duplicate"
              ? [
                  ...fixture.plan.unknownFavoriteMediaKeys!,
                  fixture.plan.unknownFavoriteMediaKeys![0]!
                ]
              : [...fixture.plan.unknownFavoriteMediaKeys!, "foreign-media"]
          const plan = {
            ...fixture.plan,
            unknownFavoriteMediaKeys: declaredUnknownFavoriteMediaKeys
          }

          await expect(
            fixture.lifecycle.begin({
              plan,
              reviewSession: fixture.reviewSession,
              groups: fixture.groups,
              snapshot: {
                mediaItems: fixture.mediaItems,
                groups: fixture.groups,
                totalItems: Object.keys(fixture.mediaItems).length
              },
              batchPolicy: {
                batchSize: 25,
                batchPauseMs: 0,
                retryCount: 0,
                retryBackoffMs: 0
              },
              unknownFavoriteAcknowledged: true
            })
          ).rejects.toThrow(/favorite-status identities/)
          expect(fixture.lifecycle.isPending()).toBe(false)
        }
      ),
      { numRuns: propertyRuns, seed: propertySeed + 11 }
    )
  })

  it("SAFE-06 compares unknown-favorite declarations without depending on their order", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 6 }), async (count) => {
        const fixture = lifecycleFixture(count)
        const plan = {
          ...fixture.plan,
          unknownFavoriteMediaKeys: [
            ...fixture.plan.unknownFavoriteMediaKeys!
          ].reverse()
        }
        const command = await fixture.lifecycle.begin({
          plan,
          reviewSession: fixture.reviewSession,
          groups: fixture.groups,
          snapshot: {
            mediaItems: fixture.mediaItems,
            groups: fixture.groups,
            totalItems: Object.keys(fixture.mediaItems).length
          },
          batchPolicy: {
            batchSize: 25,
            batchPauseMs: 0,
            retryCount: 0,
            retryBackoffMs: 0
          },
          unknownFavoriteAcknowledged: true
        })

        expect(command.args.acknowledgedUnknownFavoriteDedupKeys).toEqual(
          fixture.plan.dedupKeys
        )
      }),
      { numRuns: Math.min(propertyRuns, 100), seed: propertySeed + 13 }
    )
  })

  it("SAFE-06 normalizes current unknown-favorite keys when plan target order changes", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 6 }), async (count) => {
        const fixture = lifecycleFixture(count)
        const plan = {
          ...fixture.plan,
          dedupKeys: [...fixture.plan.dedupKeys].reverse(),
          mediaKeysToTrash: [...fixture.plan.mediaKeysToTrash].reverse()
        }
        const command = await fixture.lifecycle.begin({
          plan,
          reviewSession: fixture.reviewSession,
          groups: fixture.groups,
          snapshot: {
            mediaItems: fixture.mediaItems,
            groups: fixture.groups,
            totalItems: Object.keys(fixture.mediaItems).length
          },
          batchPolicy: {
            batchSize: 25,
            batchPauseMs: 0,
            retryCount: 0,
            retryBackoffMs: 0
          },
          unknownFavoriteAcknowledged: true
        })

        expect(command.args.acknowledgedUnknownFavoriteDedupKeys).toEqual(
          [...fixture.plan.dedupKeys].reverse()
        )
      }),
      { numRuns: Math.min(propertyRuns, 100), seed: propertySeed + 15 }
    )
  })

  it("SAFE-06 omits unknown-favorite acknowledgements when every favorite status is known", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 6 }), async (count) => {
        const fixture = lifecycleFixture(count)
        const mediaItems = { ...fixture.mediaItems }
        for (const mediaKey of fixture.plan.mediaKeysToTrash) {
          mediaItems[mediaKey] = {
            ...mediaItems[mediaKey]!,
            favoriteStatus: "not-favorite",
            favoriteSource: "provider-metadata"
          }
        }
        const plan = {
          ...fixture.plan,
          unknownFavoriteMediaKeys: []
        }
        const command = await fixture.lifecycle.begin({
          plan,
          reviewSession: fixture.reviewSession,
          groups: fixture.groups,
          snapshot: {
            mediaItems,
            groups: fixture.groups,
            totalItems: Object.keys(mediaItems).length
          },
          batchPolicy: {
            batchSize: 25,
            batchPauseMs: 0,
            retryCount: 0,
            retryBackoffMs: 0
          },
          unknownFavoriteAcknowledged: false
        })

        expect(command.args).not.toHaveProperty(
          "acknowledgedUnknownFavoriteDedupKeys"
        )
      }),
      { numRuns: Math.min(propertyRuns, 100), seed: propertySeed + 14 }
    )
  })

  it("SAFE-05/SAFE-06 only reports provider identities paired with the pending request", async () => {
    const responseArb = fc.record({
      selected: fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
      mediaList: fc.boolean(),
      dedupList: fc.boolean(),
      unknownMedia: fc.boolean(),
      unknownDedup: fc.boolean(),
      success: fc.boolean()
    })
    await fc.assert(
      fc.asyncProperty(keyNumbersArb, responseArb, async (numbers, response) => {
        const count = Math.max(1, Math.min(numbers.length - 1, 6))
        const fixture = await startLifecycle(count)
        const selected = response.selected
          .slice(0, count)
          .map((value, index) => (value ? index : -1))
          .filter((index) => index >= 0)
        const data: TrashProviderResultData = {
          ...(response.mediaList
            ? {
                trashedKeys: [
                  ...selected.map((index) => `trash-${index}`),
                  ...(response.unknownMedia ? ["foreign-media"] : [])
                ]
              }
            : {}),
          ...(response.dedupList
            ? {
                trashedDedupKeys: [
                  ...selected.map((index) => `dedup-trash-${index}`),
                  ...(response.unknownDedup ? ["foreign-dedup"] : [])
                ]
              }
            : {})
        }
        const outcome = await fixture.lifecycle.reconcile({
          success: response.success,
          data
        })
        const expectedIndexes =
          response.mediaList || response.dedupList ? selected : []
        const expectedMedia = expectedIndexes.map((index) => `trash-${index}`)
        const expectedDedup = expectedIndexes.map(
          (index) => `dedup-trash-${index}`
        )

        expect(outcome.movedMediaKeys).toEqual(expectedMedia)
        expect(outcome.movedDedupKeys).toEqual(expectedDedup)
        const movedMediaKeys: string[] = outcome.movedMediaKeys
        expect(movedMediaKeys.every((key) => key.startsWith("trash-"))).toBe(
          true
        )
        if (expectedMedia.length > 0) {
          expect(outcome.undo?.dedupKeys).toEqual(expectedDedup)
        } else {
          expect(outcome.undo).toBeNull()
        }
      }),
      { numRuns: Math.min(propertyRuns, 150), seed: propertySeed + 2 }
    )
  })

  it("SAFE-05/SAFE-06 grants Trash and Undo only to exact per-target confirmations", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom<MutationOutcome["status"]>(
            "confirmed",
            "failed",
            "unknown"
          ),
          { minLength: 1, maxLength: 6 }
        ),
        async (statuses) => {
          const fixture = await startLifecycle(statuses.length)
          const outcomes: MutationOutcome[] = statuses.map((status, index) => ({
            operation: "trash",
            targetKey: `dedup-trash-${index}`,
            status
          }))
          const result = await fixture.lifecycle.reconcile({
            success: true,
            data: { outcomes }
          })
          if (result.kind === "dry_run") {
            throw new Error("Expected per-target Trash reconciliation")
          }
          const confirmedIndexes = statuses.flatMap((status, index) =>
            status === "confirmed" ? [index] : []
          )
          const failedIndexes = statuses.flatMap((status, index) =>
            status === "failed" ? [index] : []
          )
          const unknownIndexes = statuses.flatMap((status, index) =>
            status === "unknown" ? [index] : []
          )

          expect(result.movedMediaKeys).toEqual(
            confirmedIndexes.map((index) => `trash-${index}`)
          )
          expect(result.movedDedupKeys).toEqual(
            confirmedIndexes.map((index) => `dedup-trash-${index}`)
          )
          expect(result.undo?.dedupKeys ?? []).toEqual(
            confirmedIndexes.map((index) => `dedup-trash-${index}`)
          )
          expect(result.failedDedupKeys ?? []).toEqual(
            failedIndexes.map((index) => `dedup-trash-${index}`)
          )
          expect(result.unknownDedupKeys ?? []).toEqual(
            unknownIndexes.map((index) => `dedup-trash-${index}`)
          )
        }
      ),
      { numRuns: Math.min(propertyRuns, 150), seed: propertySeed + 12 }
    )
  })

  it("SAFE-05/SAFE-12 keeps per-target progress unknown, confirmed, or retryable by terminal facts", async () => {
    const statuses = fc.constantFrom<MutationOutcome["status"]>(
      "confirmed",
      "failed",
      "unknown"
    )
    await fc.assert(
      fc.asyncProperty(statuses, statuses, async (previousStatus, nextStatus) => {
        const fixture = await startLifecycle(1)
        const requestId = fixture.requestId
        const targetKey = fixture.plan.dedupKeys[0]!
        const fact = (status: MutationOutcome["status"]): MutationOutcome => ({
          operation: "trash",
          targetKey,
          status
        })
        expect(
          fixture.lifecycle.recordProgress({
            requestId,
            data: { outcomes: [fact(previousStatus)] }
          })
        ).toBe(true)
        expect(
          fixture.lifecycle.recordProgress({
            requestId,
            data: { outcomes: [fact(nextStatus)] }
          })
        ).toBe(true)

        const expectedStatus =
          previousStatus === "unknown" || previousStatus === nextStatus
            ? nextStatus
            : nextStatus === "unknown"
              ? previousStatus
              : "unknown"
        const outcome = await fixture.lifecycle.timeout({ requestId })
        if (outcome.kind === "dry_run") {
          throw new Error("Expected per-target Trash timeout outcome")
        }

        expect(outcome.movedDedupKeys).toEqual(
          expectedStatus === "confirmed" ? [targetKey] : []
        )
        expect(outcome.undo?.dedupKeys ?? []).toEqual(
          expectedStatus === "confirmed" ? [targetKey] : []
        )
        expect(outcome.failedDedupKeys ?? []).toEqual(
          expectedStatus === "failed" ? [targetKey] : []
        )
        expect(outcome.unknownDedupKeys ?? []).toEqual(
          expectedStatus === "unknown" ? [targetKey] : []
        )
      }),
      { numRuns: Math.min(propertyRuns, 150), seed: propertySeed + 16 }
    )
  })

  it("SAFE-08 sanitizes stale saved selections before a cleanup plan is built", () => {
    fc.assert(
      fc.property(keyNumbersArb, (numbers) => {
        const mediaKeys = numbers.map((number) => `media-${number}`)
        const mediaItems = Object.fromEntries(
          mediaKeys.map((mediaKey) => [mediaKey, baseItem(mediaKey)])
        )
        const groups: DuplicateGroup[] = [
          {
            id: "migration-group",
            mediaKeys,
            originalMediaKey: mediaKeys[0],
            similarity: 1
          }
        ]
        const session = new DuplicateReviewSession({
          groups,
          mediaItems,
          selections: {
            selectedGroupIds: new Set([groups[0].id]),
            reviewedGroupIds: new Set([groups[0].id]),
            keptOverrides: {
              [groups[0].id]: new Set(["stale-key-that-is-not-in-the-scan"])
            }
          }
        })
        const plan = session.trashPlan(groups)

        expect(session.keptFor(groups[0])).toEqual(new Set(mediaKeys))
        expect(plan.mediaKeysToTrash).toEqual([])
        expect(plan.dedupKeys).toEqual([])
      }),
      { numRuns: propertyRuns, seed: propertySeed + 3 }
    )
  })

  it("SAFE-01 blocks repeated provider identities across groups", () => {
    fc.assert(
      fc.property(keyNumbersArb, (numbers) => {
        const [first, second] = numbers
        const mediaItems: Record<string, GpdMediaItem> = {
          keepA: baseItem("keepA", { dedupKey: `keeper-${first}` }),
          trashA: baseItem("trashA", { dedupKey: `repeated-${first}` }),
          keepB: baseItem("keepB", { dedupKey: `keeper-${second}` }),
          trashB: baseItem("trashB", { dedupKey: `repeated-${first}` })
        }
        const groups: DuplicateGroup[] = [
          {
            id: "group-a",
            mediaKeys: ["keepA", "trashA"],
            originalMediaKey: "keepA",
            similarity: 1
          },
          {
            id: "group-b",
            mediaKeys: ["keepB", "trashB"],
            originalMediaKey: "keepB",
            similarity: 1
          }
        ]
        const session = new DuplicateReviewSession({
          groups,
          mediaItems,
          selections: {
            selectedGroupIds: new Set(groups.map((group) => group.id)),
            reviewedGroupIds: new Set(groups.map((group) => group.id)),
            keptOverrides: {
              "group-a": new Set(["keepA"]),
              "group-b": new Set(["keepB"])
            }
          }
        })
        const plan = session.trashPlan(groups)
        expect(plan.dedupKeys).not.toContain(`repeated-${first}`)
        expect(plan.mediaKeysToTrash).not.toContain("trashA")
        expect(plan.mediaKeysToTrash).not.toContain("trashB")
      }),
      { numRuns: propertyRuns, seed: propertySeed + 6 }
    )
  })

  it("SAFE-03 never calls an unknown provider account verified", () => {
    const result = evaluateReviewPreflight({
      scanProvider: "google",
      currentProvider: "google",
      scanDate: 1_700_000_000_000,
      now: 1_700_000_001_000,
      scanScopeFingerprint: "scope",
      currentScopeFingerprint: "scope",
      selectedCount: 1,
      connectionValidated: true,
      requireFreshScan: true,
      requireKnownScope: true
    })
    expect(result.accountStatus).toBe("unknown")
    expect(result.allowed).toBe(false)
  })

  it("SAFE-09 blocks provider, account, and scope drift in the destructive preflight", () => {
    fc.assert(
      fc.property(
        fc.record({
          provider: fc.constantFrom("google", "icloud", "amazon"),
          account: fc.emailAddress(),
          scope: fc.integer({ min: 1, max: 1_000_000 }).map(String),
          drift: fc.constantFrom("provider", "account", "scope")
        }),
        ({ provider, account, scope, drift }) => {
          const currentProvider =
            drift === "provider"
              ? provider === "google"
                ? "icloud"
                : "google"
              : provider
          const currentAccount =
            drift === "account" ? `other-${account}` : account
          const currentScope = drift === "scope" ? `${scope}-changed` : scope
          const result = evaluateReviewPreflight({
            scanProvider: provider,
            currentProvider,
            scanAccountEmail: account,
            currentAccountEmail: currentAccount,
            scanDate: 1_700_000_000_000,
            currentScopeFingerprint: currentScope,
            scanScopeFingerprint: scope,
            selectedCount: 1,
            connectionValidated: true,
            requireFreshScan: true,
            requireKnownScope: true,
            now: 1_700_000_001_000
          })

          expect(result.allowed).toBe(false)
          expect(result.reasons.length).toBeGreaterThan(0)
        }
      ),
      { numRuns: propertyRuns, seed: propertySeed + 4 }
    )
  })

  it("recomputes group classification from current item evidence", () => {
    fc.assert(
      fc.property(keyNumbersArb, (numbers) => {
        const mediaKeys = numbers.map((number) => `media-${number}`)
        const group: DuplicateGroup = {
          id: "classification-group",
          mediaKeys,
          originalMediaKey: mediaKeys[0],
          similarity: 1,
          duplicateKind: "exact"
        }
        const mediaItems = Object.fromEntries(
          mediaKeys.map((mediaKey) => [
            mediaKey,
            baseItem(mediaKey, { exactContentHash: "legacy-only" })
          ])
        )
        const classification = classifyDuplicateGroup(group, mediaItems)
        expect(classification.duplicateKind).toBe("similar")
        expect(classification.evidenceLevel).not.toBe("verified_identical")
      }),
      { numRuns: propertyRuns, seed: propertySeed + 5 }
    )
  })

  it("SAFE-12 refines generated per-target restore states through lifecycle and durable history", () => {
    const generatedRestoreStates = fc
      .integer({ min: 2, max: 6 })
      .chain((count) =>
        fc.record({
          statuses: fc.array(
            fc.constantFrom<MutationOutcome["status"]>(
              "confirmed",
              "failed",
              "unknown"
            ),
            { minLength: count, maxLength: count }
          ),
          neverIssued: fc.array(fc.boolean(), {
            minLength: count,
            maxLength: count
          })
        })
      )

    fc.assert(
      fc.property(generatedRestoreStates, ({ statuses, neverIssued }) => {
        const dedupKeys = statuses.map((_, index) => `restore-${index}`)
        const mediaKeys = statuses.map((_, index) => `media-${index}`)
        const outcomes: MutationOutcome[] = dedupKeys.map((targetKey, index) => ({
          operation: "restore",
          targetKey,
          status: statuses[index]!
        }))
        const notDispatchedDedupKeys = dedupKeys.filter(
          (_, index) => statuses[index] === "failed" && neverIssued[index]
        )
        const undo = {
          provider: "google" as const,
          dedupKeys,
          count: dedupKeys.length,
          snapshot: { mediaItems: {}, groups: [], totalItems: dedupKeys.length }
        }
        const lifecycle = new TrashLifecycle({
          async savePreTrashReport() {},
          async saveTrashResultReport() {}
        })
        lifecycle.beginRestore(undo, "generated-restore")
        const result = lifecycle.reconcileRestore({
          requestId: "generated-restore",
          success: true,
          outcomes,
          notDispatchedDedupKeys
        })!
        const confirmed = dedupKeys.filter(
          (_, index) => statuses[index] === "confirmed"
        )
        const failed = dedupKeys.filter(
          (_, index) => statuses[index] === "failed"
        )
        const unknown = dedupKeys.filter(
          (_, index) => statuses[index] === "unknown"
        )
        const retryKeys = result.kind === "complete" ? [] : result.undo.dedupKeys

        expect(result.outcomes.map((entry) => entry.targetKey)).toEqual(dedupKeys)
        expect(result.outcomes.map((entry) => entry.status)).toEqual(statuses)
        expect(result.restoredDedupKeys).toEqual(confirmed)
        expect(retryKeys).toEqual(failed)
        expect(retryKeys.some((key) => unknown.includes(key))).toBe(false)
        expect(result.notDispatchedDedupKeys).toEqual(notDispatchedDedupKeys)

        const historyContext: RecoveryHistoryContext = {
          operationId: "generated-recovery",
          provider: "google",
          attemptedDedupKeys: dedupKeys,
          attemptedMediaKeys: mediaKeys
        }
        const preTrashReport: DeleteReport = {
          reportId: "generated-delete-report",
          operationId: historyContext.operationId,
          createdAt: new Date(0).toISOString(),
          totalGroupsAffected: 0,
          totalItemsKept: 0,
          totalItemsSelectedForTrash: dedupKeys.length,
          trashBatchSize: dedupKeys.length,
          items: []
        }
        const pending = createPendingRecoveryRecord(
          preTrashReport,
          historyContext,
          new Date(0)
        )
        const trashed = updateRecoveryRecordFromTrash(
          [pending],
          buildTrashResultReport({
            operationId: historyContext.operationId,
            attemptedDedupKeys: dedupKeys,
            attemptedMediaKeys: mediaKeys,
            movedDedupKeys: dedupKeys,
            movedMediaKeys: mediaKeys
          }),
          historyContext,
          new Date(1)
        )
        const restored = markRecoveryRestore(
          trashed,
          historyContext.operationId,
          {
            outcome: result.kind,
            restoredDedupKeys: result.restoredDedupKeys,
            outcomes: result.outcomes,
            notDispatchedDedupKeys: result.notDispatchedDedupKeys
          },
          new Date(2)
        )[0]!

        expect(restored.restoreOutcomes?.map((entry) => entry.targetKey)).toEqual(
          dedupKeys
        )
        expect(restored.restoreOutcomes?.map((entry) => entry.status)).toEqual(
          statuses
        )
        expect(restored.restorableDedupKeys).toEqual(failed)
        expect(restored.restoreUnknownCount).toBe(unknown.length)
        expect(restored.restoreEverNotDispatchedDedupKeys).toEqual(
          notDispatchedDedupKeys.length ? notDispatchedDedupKeys : undefined
        )
      }),
      { numRuns: propertyRuns, seed: propertySeed + 12 }
    )
  })
})
