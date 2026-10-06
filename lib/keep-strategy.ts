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

export function isUsableMediaItemForKey(
  value: unknown,
  mediaKey: string
): value is GpdMediaItem {
  if (typeof mediaKey !== "string" || mediaKey.trim().length === 0) {
    return false
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }
  const item = value as Partial<GpdMediaItem>
  return (
    item.mediaKey === mediaKey &&
    typeof item.dedupKey === "string" &&
    item.dedupKey.trim().length > 0
  )
}

export type KeepRecommendationField =
  | "isOriginalQuality"
  | "resolutionPixels"
  | "timestamp"
  | "creationTimestamp"
  | "takesUpSpace"

export type KeepRecommendationReasonCode =
  | "unique_best_value"
  | "deterministic_tiebreak"
  | "tie"
  | "missing_member"
  | "invalid_value"
  | "unknown_provenance"
  | "empty_group"

export interface KeepRecommendationEvidence {
  field: KeepRecommendationField
  comparedMediaKeys: string[]
  missingMediaKeys: string[]
  values: Record<string, number | boolean | null>
  provenanceByMediaKey: Record<string, string | null>
  winnerMediaKey?: string
  winnerValue?: number | boolean
}

export type KeepRecommendation =
  | {
      status: "recommended"
      strategy: KeepStrategy
      keptMediaKeys: string[]
      reasonCode: "unique_best_value" | "deterministic_tiebreak"
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
      if (item.timestampProvenance !== "capture") return null
      return { score: item.timestamp, value: item.timestamp }
    case "newest_upload":
      if (!Number.isFinite(item.creationTimestamp)) return null
      if (item.creationTimestampProvenance !== "creation") return null
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
  const missingMediaKeys = mediaKeys.filter(
    (key) => !isUsableMediaItemForKey(mediaItems[key], key)
  )
  const comparedMediaKeys = mediaKeys.filter((key) =>
    isUsableMediaItemForKey(mediaItems[key], key)
  )
  const comparisons = new Map<string, ComparisonValue>()
  const values: Record<string, number | boolean | null> = {}
  const provenanceByMediaKey: Record<string, string | null> = {}

  for (const mediaKey of comparedMediaKeys) {
    const item = mediaItems[mediaKey]
    const comparison = comparisonValue(item, strategy)
    if (strategy === "newest_taken" || strategy === "oldest_taken") {
      provenanceByMediaKey[mediaKey] = item.timestampProvenance ?? null
    } else if (strategy === "newest_upload") {
      provenanceByMediaKey[mediaKey] =
        item.creationTimestampProvenance ?? null
    }
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
      values,
      provenanceByMediaKey
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

  const requiresCaptureProvenance =
    strategy === "newest_taken" || strategy === "oldest_taken"
  const requiresCreationProvenance = strategy === "newest_upload"
  const provenanceIsUnknown = Object.values(
    evidence.provenanceByMediaKey
  ).some((provenance) =>
    requiresCaptureProvenance
      ? provenance !== "capture"
      : requiresCreationProvenance
        ? provenance !== "creation"
        : false
  )
  if (provenanceIsUnknown) {
    return {
      status: "no_confident_recommendation",
      strategy,
      keptMediaKeys: [...group.mediaKeys],
      reasonCode: "unknown_provenance",
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

function positiveFileSize(item: GpdMediaItem | undefined): number | undefined {
  if (!item) return undefined
  const candidates = [item.originalByteLength, item.size, item.spaceTaken]
  return candidates.find(
    (value): value is number =>
      Number.isFinite(value) && (value as number) >= 0
  )
}

function resolutionArea(item: GpdMediaItem | undefined): number | undefined {
  if (!item) return undefined
  const { resWidth, resHeight } = item
  if (
    !Number.isFinite(resWidth) ||
    !Number.isFinite(resHeight) ||
    resWidth! <= 0 ||
    resHeight! <= 0
  ) {
    return undefined
  }
  const area = resWidth! * resHeight!
  return Number.isFinite(area) && area > 0 ? area : undefined
}

function trustedCaptureTimestamp(
  item: GpdMediaItem | undefined
): number | undefined {
  return item && item.timestampProvenance === "capture" &&
    Number.isFinite(item.timestamp)
    ? item.timestamp
    : undefined
}

function trustedCreationTimestamp(
  item: GpdMediaItem | undefined
): number | undefined {
  return item && item.creationTimestampProvenance === "creation" &&
    Number.isFinite(item.creationTimestamp)
    ? item.creationTimestamp
    : undefined
}

function strategyScore(
  item: GpdMediaItem | undefined,
  strategy: KeepStrategy
): { value?: number; direction: 1 | -1 } {
  if (!item) return { direction: 1 }
  switch (strategy) {
    case "best_quality":
      return {
        value:
          item.isOriginalQuality === true
            ? 2
            : item.isOriginalQuality === false
              ? 1
              : undefined,
        direction: 1
      }
    case "largest_resolution":
      return { value: resolutionArea(item), direction: 1 }
    case "newest_taken":
      return { value: trustedCaptureTimestamp(item), direction: 1 }
    case "oldest_taken":
      return { value: trustedCaptureTimestamp(item), direction: -1 }
    case "newest_upload":
      return { value: trustedCreationTimestamp(item), direction: 1 }
    case "non_storage_counting":
      return {
        value:
          typeof item.takesUpSpace === "boolean"
            ? item.takesUpSpace
              ? 0
              : 1
            : undefined,
        direction: 1
      }
  }
}

function compareSignal(
  left: number | undefined,
  right: number | undefined,
  direction: 1 | -1 = 1
): number {
  const leftKnown = Number.isFinite(left)
  const rightKnown = Number.isFinite(right)
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1
  if (!leftKnown || !rightKnown || left === right) return 0
  return direction * (right! - left!)
}

function compareDefaultCandidate(
  leftKey: string,
  rightKey: string,
  mediaItems: Record<string, GpdMediaItem>,
  strategy: KeepStrategy
): number {
  const left = mediaItems[leftKey]
  const right = mediaItems[rightKey]
  const primary = strategyScore(left, strategy)
  const primaryDiff = compareSignal(
    primary.value,
    strategyScore(right, strategy).value,
    primary.direction
  )
  if (primaryDiff !== 0) return primaryDiff

  const fallbacks: Array<[
    number | undefined,
    number | undefined,
    1 | -1
  ]> = [
    [
      left?.isOriginalQuality === true
        ? 2
        : left?.isOriginalQuality === false
          ? 1
          : undefined,
      right?.isOriginalQuality === true
        ? 2
        : right?.isOriginalQuality === false
          ? 1
          : undefined,
      1
    ],
    [resolutionArea(left), resolutionArea(right), 1],
    [positiveFileSize(left), positiveFileSize(right), 1],
    [trustedCaptureTimestamp(left), trustedCaptureTimestamp(right), -1],
    [trustedCreationTimestamp(left), trustedCreationTimestamp(right), -1]
  ]

  for (const [leftValue, rightValue, direction] of fallbacks) {
    const difference = compareSignal(leftValue, rightValue, direction)
    if (difference !== 0) return difference
  }

  // Compare code units directly so tie-breaking does not depend on locale.
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

/**
 * Selects exactly one default keeper for every nonempty group. A confident,
 * unique strategy result wins; otherwise the selected strategy is followed by
 * quality, resolution, byte size, trusted timestamps, and a stable key order.
 */
export function recommendDefaultKeepForGroup(
  group: Pick<DuplicateGroup, "mediaKeys">,
  mediaItems: Record<string, GpdMediaItem>,
  strategy: KeepStrategy
): KeepRecommendation {
  const strictRecommendation = recommendKeepForGroup(
    group,
    mediaItems,
    strategy
  )
  if (group.mediaKeys.length === 0) {
    return strictRecommendation
  }

  if (strictRecommendation.evidence.missingMediaKeys.length > 0) {
    return {
      ...strictRecommendation,
      keptMediaKeys: [...strictRecommendation.evidence.comparedMediaKeys]
    }
  }

  if (strictRecommendation.status === "recommended") {
    return strictRecommendation
  }

  const candidateKeys = [...new Set(group.mediaKeys)]
  let keptMediaKey = candidateKeys[0]!
  for (const candidateKey of candidateKeys.slice(1)) {
    if (
      compareDefaultCandidate(
        candidateKey,
        keptMediaKey,
        mediaItems,
        strategy
      ) < 0
    ) {
      keptMediaKey = candidateKey
    }
  }

  return {
    status: "recommended",
    strategy,
    keptMediaKeys: [keptMediaKey],
    reasonCode: "deterministic_tiebreak",
    evidence: {
      ...strictRecommendation.evidence,
      winnerMediaKey: keptMediaKey
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
    if (recommendation.reasonCode === "unknown_provenance") {
      const dateKind =
        recommendation.strategy === "newest_upload"
          ? "creation-date"
          : "capture-date"
      return `No confident recommendation — ${dateKind} provenance is unavailable; keeping all copies`
    }
    return "No confident recommendation — keeping all copies"
  }
  if (recommendation.reasonCode === "deterministic_tiebreak") {
    return `Suggested keep: ${KEEP_STRATEGY_LABELS[recommendation.strategy]} (deterministic tie-break)`
  }
  if (
    recommendation.strategy === "newest_taken" ||
    recommendation.strategy === "oldest_taken"
  ) {
    return `Suggested keep: ${KEEP_STRATEGY_LABELS[recommendation.strategy]} (capture-date evidence)`
  }
  if (recommendation.strategy === "newest_upload") {
    return `Suggested keep: ${KEEP_STRATEGY_LABELS[recommendation.strategy]} (creation-date evidence)`
  }
  return `Suggested keep: ${KEEP_STRATEGY_LABELS[recommendation.strategy]}`
}

/**
 * Conservative strategy helper for callers that can tolerate no recommendation.
 * Review defaults use recommendDefaultKeepForGroup to resolve ties deterministically.
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
  left: number | undefined,
  right: number | undefined
): number {
  const hasLeft = Number.isFinite(left)
  const hasRight = Number.isFinite(right)
  const availability = Number(hasRight) - Number(hasLeft)
  if (availability !== 0) return availability
  return hasLeft ? left! - right! : 0
}

function legacyCompareFallback(
  left: GpdMediaItem,
  right: GpdMediaItem
): number {
  const qualityDiff = legacyQualityScore(right) - legacyQualityScore(left)
  if (qualityDiff !== 0) return qualityDiff
  const takenDiff = legacyCompareOldestTime(left.timestamp, right.timestamp)
  if (takenDiff !== 0) return takenDiff
  const pixelDiff = legacyPixels(right) - legacyPixels(left)
  if (pixelDiff !== 0) return pixelDiff
  return legacyCompareOldestTime(
    left.creationTimestamp,
    right.creationTimestamp
  )
}

function legacyChooseKeepItem(items: GpdMediaItem[]): GpdMediaItem | null {
  const sorted = [...items].sort(legacyCompareFallback)
  return sorted[0] ?? null
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
