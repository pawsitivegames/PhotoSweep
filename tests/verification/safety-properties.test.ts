import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  classifyDuplicateItems,
  classifyDuplicateGroup
} from "../../lib/duplicate-classifier"
import {
  DuplicateReviewSession,
  type DuplicateTrashPlan
} from "../../lib/duplicate-review-session"
import { evaluateReviewPreflight } from "../../lib/review-preflight"
import { recommendKeepForGroup } from "../../lib/keep-strategy"
import {
  captureTrashDispatchAuthorization,
  isTrashDispatchAuthorizationCurrent
} from "../../lib/trash-dispatch-guard"
import {
  TrashLifecycle,
  type TrashAuditAdapter,
  type TrashProviderResultData
} from "../../lib/trash-lifecycle"
import type {
  DuplicateGroup,
  GpdMediaItem
} from "../../lib/types"

const propertyRuns = Math.max(
  1,
  Number.parseInt(process.env.FAST_CHECK_NUM_RUNS ?? "250", 10) || 250
)
const propertySeed = Number.parseInt(
  process.env.FAST_CHECK_SEED ?? "20260915",
  10
)

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
    blockedGroupIds: []
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
  await fixture.lifecycle.begin({
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
    }
  })
  return fixture
}

describe("generated safety properties", () => {
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
                    : values[index]
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

  it("SAFE-01 treats a unique top value as sufficient even when lower values tie", () => {
    const group: DuplicateGroup = {
      id: "explicit-keeper",
      mediaKeys: ["a", "b", "c"],
      originalMediaKey: "a",
      similarity: 1
    }
    const mediaItems = {
      a: baseItem("a", { timestamp: 3 }),
      b: baseItem("b", { timestamp: 1 }),
      c: baseItem("c", { timestamp: 1 })
    }
    expect(
      recommendKeepForGroup(group, mediaItems, "newest_taken").keptMediaKeys
    ).toEqual(["a"])

    const tied = {
      ...mediaItems,
      b: baseItem("b", { timestamp: 3 })
    }
    expect(
      recommendKeepForGroup(group, tied, "newest_taken").keptMediaKeys
    ).toEqual(["a", "b", "c"])
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
        expect(outcome.movedMediaKeys.every((key) => key.startsWith("trash-"))).toBe(
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
})
