import type { DuplicateGroup, GpdMediaItem } from "./types"

const KEEP_STRATEGIES = [
  "best_quality",
  "largest_resolution",
  "newest_taken",
  "oldest_taken",
  "newest_upload",
  "non_storage_counting"
] as const

export type KeepStrategy = (typeof KEEP_STRATEGIES)[number]

import { KEEP_STRATEGY_LABELS } from "./keep-strategy-labels"

export { KEEP_STRATEGY_LABELS }
const DEFAULT_KEEP_STRATEGY = KEEP_STRATEGIES[0]

export function isKeepStrategy(value: unknown): value is KeepStrategy {
  return KEEP_STRATEGIES.includes(value as KeepStrategy)
}

export type KeepRecommendationField =
  | "isOriginalQuality"
  | "resolutionPixels"
  | "timestamp"
  | "creationTimestamp"
  | "takesUpSpace"

export type KeepRecommendationReasonCode =
  | "unique_best_value"
  | "tie"
  | "missing_member"
  | "invalid_value"
  | "empty_group"

export interface KeepRecommendationEvidence {
  field: KeepRecommendationField
  comparedMediaKeys: string[]
  missingMediaKeys: string[]
  values: Record<string, number | boolean | null>
  winnerMediaKey?: string
  winnerValue?: number | boolean
}

export type KeepRecommendation =
  | {
      status: "recommended"
      strategy: KeepStrategy
      keptMediaKeys: string[]
      reasonCode: "unique_best_value"
      evidence: KeepRecommendationEvidence
    }
  | {
      status: "no_confident_recommendation"
      strategy: KeepStrategy
      keptMediaKeys: string[]
      reasonCode: Exclude<KeepRecommendationReasonCode, "unique_best_value">
      evidence: KeepRecommendationEvidence
    }

interface ComparisonValue {
  score: number
  value: number | boolean
}

function fieldForStrategy(strategy: KeepStrategy): KeepRecommendationField {
  switch (strategy) {
    case "best_quality":
      return "isOriginalQuality"
    case "largest_resolution":
      return "resolutionPixels"
    case "newest_taken":
    case "oldest_taken":
      return "timestamp"
    case "newest_upload":
      return "creationTimestamp"
    case "non_storage_counting":
      return "takesUpSpace"
  }
}

function comparisonValue(
  item: GpdMediaItem,
  strategy: KeepStrategy
): ComparisonValue | null {
  switch (strategy) {
    case "best_quality":
      return typeof item.isOriginalQuality === "boolean"
        ? {
            score: item.isOriginalQuality ? 1 : 0,
            value: item.isOriginalQuality
          }
        : null
    case "largest_resolution": {
      const width = item.resWidth
      const height = item.resHeight
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        return null
      }
      const area = width * height
      if (!Number.isFinite(area) || area <= 0) return null
      return { score: area, value: area }
    }
    case "newest_taken":
    case "oldest_taken":
      if (!Number.isFinite(item.timestamp)) return null
      return { score: item.timestamp, value: item.timestamp }
    case "newest_upload":
      if (!Number.isFinite(item.creationTimestamp)) return null
      return {
        score: item.creationTimestamp,
        value: item.creationTimestamp
      }
    case "non_storage_counting":
      return typeof item.takesUpSpace === "boolean"
        ? {
            score: item.takesUpSpace ? 0 : 1,
            value: item.takesUpSpace
          }
        : null
  }
}

function recommendationEvidence(
  group: Pick<DuplicateGroup, "mediaKeys">,
  mediaItems: Record<string, GpdMediaItem>,
  strategy: KeepStrategy
): {
  evidence: KeepRecommendationEvidence
  comparisons: Map<string, ComparisonValue>
} {
  const mediaKeys = [...new Set(group.mediaKeys)]
  const missingMediaKeys = mediaKeys.filter((key) => !mediaItems[key])
  const comparedMediaKeys = mediaKeys.filter((key) => Boolean(mediaItems[key]))
  const comparisons = new Map<string, ComparisonValue>()
  const values: Record<string, number | boolean | null> = {}

  for (const mediaKey of comparedMediaKeys) {
    const comparison = comparisonValue(mediaItems[mediaKey], strategy)
    if (comparison) {
      comparisons.set(mediaKey, comparison)
      values[mediaKey] = comparison.value
    } else {
      values[mediaKey] = null
    }
  }

  return {
    evidence: {
      field: fieldForStrategy(strategy),
      comparedMediaKeys,
      missingMediaKeys,
      values
    },
    comparisons
  }
}

/**
 * Return a conservative, pure recommendation for one duplicate group.
 * Missing members, unknown values, and ties deliberately keep every copy.
 */
export function recommendKeepForGroup(
  group: Pick<DuplicateGroup, "mediaKeys">,
  mediaItems: Record<string, GpdMediaItem>,
  strategy: KeepStrategy
): KeepRecommendation {
  const { evidence, comparisons } = recommendationEvidence(
    group,
    mediaItems,
    strategy
  )

  if (group.mediaKeys.length === 0) {
    return {
      status: "no_confident_recommendation",
      strategy,
      keptMediaKeys: [],
      reasonCode: "empty_group",
      evidence
    }
  }

  if (evidence.missingMediaKeys.length > 0) {
    return {
      status: "no_confident_recommendation",
      strategy,
      keptMediaKeys: [...group.mediaKeys],
      reasonCode: "missing_member",
      evidence
    }
  }

  if (comparisons.size !== new Set(group.mediaKeys).size) {
    return {
      status: "no_confident_recommendation",
      strategy,
      keptMediaKeys: [...group.mediaKeys],
      reasonCode: "invalid_value",
      evidence
    }
  }

  const comparisonValues = [...comparisons.entries()]
  const maximize = strategy !== "oldest_taken"
  const winningScore = comparisonValues.reduce(
    (best, [, comparison]) =>
      maximize
        ? Math.max(best, comparison.score)
        : Math.min(best, comparison.score),
    maximize ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  )
  const winners = comparisonValues.filter(
    ([, comparison]) => comparison.score === winningScore
  )

  if (winners.length !== 1) {
    return {
      status: "no_confident_recommendation",
      strategy,
      keptMediaKeys: [...group.mediaKeys],
      reasonCode: "tie",
      evidence
    }
  }

  const [winnerMediaKey, winner] = winners[0]
  return {
    status: "recommended",
    strategy,
    keptMediaKeys: [winnerMediaKey],
    reasonCode: "unique_best_value",
    evidence: {
      ...evidence,
      winnerMediaKey,
      winnerValue: winner.value
    }
  }
}

function recommendationForItems(
  items: GpdMediaItem[],
  strategy: KeepStrategy
): KeepRecommendation {
  const group: Pick<DuplicateGroup, "mediaKeys"> = {
    mediaKeys: items.map((item) => item.mediaKey)
  }
  return recommendKeepForGroup(
    group,
    Object.fromEntries(items.map((item) => [item.mediaKey, item])),
    strategy
  )
}

export function describeKeepRecommendation(
  recommendation: KeepRecommendation
): string {
  if (recommendation.status === "no_confident_recommendation") {
    return "No confident recommendation — keeping all copies"
  }
  return `Suggested keep: ${KEEP_STRATEGY_LABELS[recommendation.strategy]}`
}

function legacyQualityScore(item: GpdMediaItem): number {
  return item.isOriginalQuality === true
    ? 2
    : item.isOriginalQuality === false
      ? 0
      : 1
}

function legacyPixels(item: GpdMediaItem): number {
  return (item.resWidth ?? 0) * (item.resHeight ?? 0)
}

function legacyCompareOldestTime(
  a: number | undefined,
  b: number | undefined
): number {
  const hasA = Number.isFinite(a)
  const hasB = Number.isFinite(b)
  const availability = Number(hasB) - Number(hasA)
  if (availability !== 0) return availability
  return hasA ? a! - b! : 0
}

function legacyCompareFallback(a: GpdMediaItem, b: GpdMediaItem): number {
  const qualityDiff = legacyQualityScore(b) - legacyQualityScore(a)
  if (qualityDiff !== 0) return qualityDiff
  const takenDiff = legacyCompareOldestTime(a.timestamp, b.timestamp)
  if (takenDiff !== 0) return takenDiff
  const pixelDiff = legacyPixels(b) - legacyPixels(a)
  if (pixelDiff !== 0) return pixelDiff
  return legacyCompareOldestTime(a.creationTimestamp, b.creationTimestamp)
}

/**
 * Preserve the pre-confidence default only for selectDefaultKeep's explicit
 * best-quality fallback. The safe recommendation path above owns every
 * strategy; keeping strategy branches here would create private dead paths
 * that no caller can reach.
 */
function legacyChooseKeepItem(items: GpdMediaItem[]): GpdMediaItem | null {
  const sorted = [...items].sort((a, b) => {
    return legacyCompareFallback(a, b)
  })

  return sorted[0] ?? null
}

/**
 * Safe strategy helper for callers that can tolerate no recommendation.
 * Destructive review uses recommendKeepForGroup directly and never falls back
 * to an array-order winner.
 */
export function chooseKeepItem(
  items: GpdMediaItem[],
  strategy: KeepStrategy
): GpdMediaItem | null {
  const recommendation = recommendationForItems(items, strategy)
  if (recommendation.status !== "recommended") return null
  return (
    items.find((item) => item.mediaKey === recommendation.keptMediaKeys[0]) ??
    null
  )
}

export function selectDefaultKeep(items: GpdMediaItem[]): string {
  const selected = chooseKeepItem(items, DEFAULT_KEEP_STRATEGY)
  const fallback = selected ?? legacyChooseKeepItem(items)
  if (!fallback) throw new Error("Cannot select a keep item from an empty group")
  return fallback.mediaKey
}

export function chooseKeepKeyForGroup(
  group: DuplicateGroup,
  mediaItems: Record<string, GpdMediaItem>,
  strategy: KeepStrategy
): string | null {
  const recommendation = recommendKeepForGroup(group, mediaItems, strategy)
  return recommendation.status === "recommended"
    ? recommendation.keptMediaKeys[0] ?? null
    : null
}
