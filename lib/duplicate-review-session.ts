import { buildDeleteReport, type DeleteReport } from "./delete-report"
import { classifyDuplicateGroup } from "./duplicate-classifier"
import {
  isUsableMediaItemForKey,
  recommendDefaultKeepForGroup,
  type KeepRecommendation,
  type KeepStrategy
} from "./keep-strategy"
import { buildReviewReport, type ReviewReport } from "./review-report"
import {
  favoriteStatusForItem,
  isConfirmedFavorite
} from "./favorite-status"
import type { DuplicateGroup, GpdMediaItem, PhotoProvider } from "./types"

export const DUPLICATE_REVIEW_SELECTIONS_VERSION = 2 as const

export type KeepDecisionSource =
  | "manual"
  | "legacy_preserved"
  | "stale_fallback"
  | "automatic"

export interface KeepDecisionProvenance {
  source: KeepDecisionSource
  strategy?: KeepStrategy
}

export interface KeepDecision {
  keptMediaKeys: Set<string>
  source: KeepDecisionSource
  strategy: KeepStrategy
  recommendation: KeepRecommendation
}

export interface DuplicateReviewSelections {
  selectedGroupIds: Set<string>
  reviewedGroupIds: Set<string>
  keptOverrides: Record<string, Set<string>>
  keepDecisionProvenance?: Record<string, KeepDecisionProvenance>
}

export interface StoredDuplicateReviewSelections {
  /** Optional on input so pre-v2 saved selections remain readable. */
  version?: number
  selectedGroupIds: string[]
  reviewedGroupIds: string[]
  keptOverrides: Record<string, string[]>
  keepDecisionProvenance?: Record<string, KeepDecisionProvenance>
}

export interface DuplicateTrashPlan {
  dedupKeys: string[]
  mediaKeysToTrash: string[]
  blockedMediaKeys: string[]
  blockedGroupIds: string[]
  /** Targets whose unknown favorite state needs explicit user acknowledgement. */
  unknownFavoriteMediaKeys?: string[]
  provider: PhotoProvider
  icloudAssetRefs?: NonNullable<GpdMediaItem["icloudAsset"]>[]
}

export type DuplicateReviewAction =
  | { type: "select_groups"; groupIds: Iterable<string> }
  | { type: "deselect_groups"; groupIds: Iterable<string> }
  | { type: "toggle_kept"; groupId: string; mediaKey: string }
  | { type: "trash_all_copies"; groupId: string }
  | {
      type: "apply_keep_strategy"
      groupIds: Iterable<string>
      strategy: KeepStrategy
      /** Re-include these eligible sets in the Trash proposal review. */
      includeGroupIds?: Iterable<string>
      /** An explicit strategy-menu action replaces per-set manual keep choices. */
      overrideManualChoices?: boolean
    }
  | { type: "replace"; selections: DuplicateReviewSelections }
  | { type: "clear" }

interface DuplicateReviewSessionParams {
  groups: DuplicateGroup[]
  mediaItems: Record<string, GpdMediaItem>
  selections?: DuplicateReviewSelections
  defaultStrategy?: KeepStrategy
}

function cloneSelections(
  selections: DuplicateReviewSelections
): DuplicateReviewSelections {
  return {
    selectedGroupIds: new Set(selections.selectedGroupIds),
    reviewedGroupIds: new Set(selections.reviewedGroupIds),
    keptOverrides: Object.fromEntries(
      Object.entries(selections.keptOverrides).map(([groupId, keys]) => [
        groupId,
        new Set(keys)
      ])
    ),
    keepDecisionProvenance: Object.fromEntries(
      Object.entries(selections.keepDecisionProvenance ?? {}).map(
        ([groupId, provenance]) => [groupId, { ...provenance }]
      )
    )
  }
}

function sameMediaKeySet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key))
}

function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function validatedUniqueGroups(value: unknown): DuplicateGroup[] {
  if (!Array.isArray(value)) return []

  const idCounts = new Map<string, number>()
  for (const candidate of value) {
    if (!isRecord(candidate) || !isNonblankString(candidate.id)) continue
    idCounts.set(candidate.id, (idCounts.get(candidate.id) ?? 0) + 1)
  }

  return value.filter((candidate): candidate is DuplicateGroup => {
    if (!isRecord(candidate) || !isNonblankString(candidate.id)) return false
    if (
      typeof candidate.similarity !== "number" ||
      !Number.isFinite(candidate.similarity) ||
      candidate.similarity < 0 ||
      candidate.similarity > 1
    ) {
      return false
    }
    if (idCounts.get(candidate.id) !== 1 || !Array.isArray(candidate.mediaKeys)) {
      return false
    }
    const memberKeys = candidate.mediaKeys
    if (memberKeys.length < 2) return false
    for (let index = 0; index < memberKeys.length; index += 1) {
      if (
        !Object.prototype.hasOwnProperty.call(memberKeys, index) ||
        !isNonblankString(memberKeys[index])
      ) {
        return false
      }
    }
    return new Set(memberKeys).size === memberKeys.length
  })
}

function defaultSelections(): DuplicateReviewSelections {
  return {
    selectedGroupIds: new Set(),
    reviewedGroupIds: new Set(),
    keptOverrides: {},
    keepDecisionProvenance: {}
  }
}

export class DuplicateReviewSession {
  private readonly selectionState: DuplicateReviewSelections
  readonly keptByGroupId: Map<string, Set<string>>
  readonly keepDecisionByGroupId: Map<string, KeepDecision>

  private readonly groups: DuplicateGroup[]
  private readonly mediaItems: Record<string, GpdMediaItem>
  private readonly groupsById: Map<string, DuplicateGroup>
  private readonly defaultStrategy: KeepStrategy

  constructor(params: DuplicateReviewSessionParams) {
    this.groups = validatedUniqueGroups(params.groups)
    this.mediaItems = params.mediaItems
    this.defaultStrategy = params.defaultStrategy ?? "best_quality"
    this.groupsById = new Map(this.groups.map((group) => [group.id, group]))
    this.selectionState = this.sanitize(
      params.selections ?? defaultSelections()
    )
    this.keepDecisionByGroupId = new Map(
      this.groups.map((group) => [group.id, this.resolveDecision(group)])
    )
    this.keptByGroupId = new Map(
      this.groups.map((group) => [
        group.id,
        // The decision map is built from these same groups immediately above,
        // so every group id has a decision when this cache is initialized.
        new Set(this.keepDecisionByGroupId.get(group.id)!.keptMediaKeys)
      ])
    )
  }

  get selections(): DuplicateReviewSelections {
    return cloneSelections(this.selectionState)
  }

  get selectedGroupIds(): Set<string> {
    return new Set(this.selectionState.selectedGroupIds)
  }

  get reviewedGroupIds(): Set<string> {
    return new Set(this.selectionState.reviewedGroupIds)
  }

  update(action: DuplicateReviewAction): DuplicateReviewSelections {
    const current = cloneSelections(this.selectionState)

    switch (action.type) {
      case "select_groups":
        for (const groupId of action.groupIds) {
          if (this.groupsById.has(groupId)) {
            current.selectedGroupIds.add(groupId)
            current.reviewedGroupIds.add(groupId)
          }
        }
        break
      case "deselect_groups":
        for (const groupId of action.groupIds) {
          current.selectedGroupIds.delete(groupId)
          if (this.groupsById.has(groupId))
            current.reviewedGroupIds.add(groupId)
        }
        break
      case "toggle_kept": {
        const group = this.groupsById.get(action.groupId)
        if (
          !group ||
          !group.mediaKeys.includes(action.mediaKey) ||
          !isUsableMediaItemForKey(
            this.mediaItems[action.mediaKey],
            action.mediaKey
          )
        ) {
          break
        }
        const kept = new Set(this.resolveKept(group))
        if (kept.has(action.mediaKey) && kept.size === 1) {
          current.selectedGroupIds.add(group.id)
          current.reviewedGroupIds.add(group.id)
          current.keptOverrides[group.id] = kept
          current.keepDecisionProvenance![group.id] = { source: "manual" }
          break
        }
        if (kept.has(action.mediaKey)) kept.delete(action.mediaKey)
        else kept.add(action.mediaKey)
        current.selectedGroupIds.add(group.id)
        current.reviewedGroupIds.add(group.id)
        current.keptOverrides[group.id] = kept
        current.keepDecisionProvenance![group.id] = { source: "manual" }
        break
      }
      case "trash_all_copies":
        if (this.groupsById.has(action.groupId)) {
          current.selectedGroupIds.add(action.groupId)
          current.reviewedGroupIds.add(action.groupId)
          current.keptOverrides[action.groupId] = new Set()
          current.keepDecisionProvenance![action.groupId] = { source: "manual" }
        }
        break
      case "apply_keep_strategy": {
        const previouslyIncludedGroupIds = new Set(current.selectedGroupIds)
        for (const groupId of action.includeGroupIds ?? []) {
          if (this.groupsById.has(groupId)) {
            if (!previouslyIncludedGroupIds.has(groupId)) {
              // Newly proposed groups need another per-set review even if a
              // prior Skip action had marked them reviewed.
              current.reviewedGroupIds.delete(groupId)
            }
            current.selectedGroupIds.add(groupId)
          }
        }
        for (const groupId of action.groupIds) {
          const group = this.groupsById.get(groupId)
          if (!group) continue
          const existingProvenance =
            current.keepDecisionProvenance[groupId]
          const existingOverride = current.keptOverrides[groupId]
          const preservesEmptyLegacyGroup =
            group.mediaKeys.length === 0 &&
            existingOverride?.size === 0 &&
            existingProvenance?.source === "legacy_preserved"
          if (
            !action.overrideManualChoices &&
            (existingProvenance?.source === "manual" ||
              existingProvenance?.source === "stale_fallback" ||
              preservesEmptyLegacyGroup)
          ) {
            continue
          }
          const recommendation = recommendDefaultKeepForGroup(
            group,
            this.mediaItems,
            action.strategy
          )
          if (
            previouslyIncludedGroupIds.has(groupId) &&
            !sameMediaKeySet(
              this.resolveKept(group),
              new Set(recommendation.keptMediaKeys)
            )
          ) {
            // Changing the keeper changes the proposed Trash targets, so the
            // set must pass through per-set review again before confirmation.
            current.reviewedGroupIds.delete(groupId)
          }
          current.keptOverrides[groupId] = new Set(
            recommendation.keptMediaKeys
          )
          current.keepDecisionProvenance![groupId] = {
            source: "automatic",
            strategy: action.strategy
          }
        }
        break
      }
      case "replace":
        return this.sanitize(action.selections)
      case "clear":
        return defaultSelections()
    }

    return current
  }

  keptFor(group: DuplicateGroup): Set<string> {
    return this.keptByGroupId.get(group.id) ?? this.resolveKept(group)
  }

  decisionFor(group: DuplicateGroup): KeepDecision {
    return this.keepDecisionByGroupId.get(group.id) ?? this.resolveDecision(group)
  }

  duplicateCount(groups: DuplicateGroup[] = this.groups): number {
    return this.trashPlan(groups).mediaKeysToTrash.length
  }

  reviewReport(groups: DuplicateGroup[] = this.groups): ReviewReport {
    const plan = this.trashPlan(groups)
    return buildReviewReport({
      groups,
      mediaItems: this.mediaItems,
      selectedGroupIds: this.selectionState.selectedGroupIds,
      getKept: (group) => this.keptFor(group),
      mediaKeysToTrash: plan.mediaKeysToTrash
    })
  }

  trashPlan(groups: DuplicateGroup[] = this.groups): DuplicateTrashPlan {
    const dedupKeys: string[] = []
    const mediaKeysToTrash: string[] = []
    const blockedMediaKeys: string[] = []
    const unknownFavoriteMediaKeys: string[] = []
    const blockedGroupIds = new Set<string>()
    const dedupKeyCounts = new Map<string, number>()

    // Count identities across the complete scan, not only the visible filter.
    // A provider asset referenced by more than one row must never be sent to
    // Trash through one row while another row acts as its apparent keeper.
    for (const candidateGroup of this.groups) {
      const candidateItems = candidateGroup.mediaKeys
        .flatMap((mediaKey) => {
          const item = this.mediaItems[mediaKey]
          return isUsableMediaItemForKey(item, mediaKey) ? [item] : []
        })
      for (const item of candidateItems) {
        dedupKeyCounts.set(
          item.dedupKey,
          (dedupKeyCounts.get(item.dedupKey) ?? 0) + 1
        )
      }
    }

    for (const candidate of validatedUniqueGroups(groups)) {
      const group = this.groupsById.get(candidate.id)
      if (!group) continue
      if (!this.selectionState.selectedGroupIds.has(group.id)) continue
      const kept = this.keptFor(group)
      const classification = classifyDuplicateGroup(group, this.mediaItems)
      const hasMissingMediaItem = group.mediaKeys.some(
        (mediaKey) =>
          !isUsableMediaItemForKey(this.mediaItems[mediaKey], mediaKey)
      )
      for (const mediaKey of group.mediaKeys) {
        if (kept.has(mediaKey)) continue
        const item = this.mediaItems[mediaKey]
        if (!item?.dedupKey) continue

        const blocked =
          hasMissingMediaItem ||
          isConfirmedFavorite(item) ||
          !classification.canProposeTrash ||
          (dedupKeyCounts.get(item.dedupKey) ?? 0) > 1
        if (blocked) {
          blockedMediaKeys.push(mediaKey)
          blockedGroupIds.add(group.id)
          continue
        }

        if (favoriteStatusForItem(item) === "unknown") {
          unknownFavoriteMediaKeys.push(mediaKey)
        }
        dedupKeys.push(item.dedupKey)
        mediaKeysToTrash.push(mediaKey)
      }
    }

    const provider =
      mediaKeysToTrash
        .map((key) => this.mediaItems[key].provider)
        .find((value): value is PhotoProvider => Boolean(value)) ?? "google"
    const icloudAssetRefs =
      provider === "icloud"
        ? mediaKeysToTrash
            .map((key) => this.mediaItems[key].icloudAsset)
            .filter(
              (asset): asset is NonNullable<GpdMediaItem["icloudAsset"]> =>
                Boolean(asset)
            )
        : undefined

    return {
      dedupKeys,
      mediaKeysToTrash,
      blockedMediaKeys,
      blockedGroupIds: [...blockedGroupIds],
      ...(unknownFavoriteMediaKeys.length > 0
        ? { unknownFavoriteMediaKeys }
        : {}),
      provider,
      ...(icloudAssetRefs ? { icloudAssetRefs } : {})
    }
  }

  deleteReport(params: {
    plan: DuplicateTrashPlan
    trashBatchSize: number
    groups?: DuplicateGroup[]
    operationId?: string
  }): DeleteReport {
    return buildDeleteReport({
      groups: params.groups ?? this.groups,
      mediaItems: this.mediaItems,
      selectedGroupIds: this.selectionState.selectedGroupIds,
      getKept: (group) => this.keptFor(group),
      mediaKeysToTrash: params.plan.mediaKeysToTrash,
      trashBatchSize: params.trashBatchSize,
      operationId: params.operationId
    })
  }

  serialize(): StoredDuplicateReviewSelections {
    return {
      version: DUPLICATE_REVIEW_SELECTIONS_VERSION,
      selectedGroupIds: [...this.selectionState.selectedGroupIds],
      reviewedGroupIds: [...this.selectionState.reviewedGroupIds],
      keptOverrides: Object.fromEntries(
        Object.entries(this.selectionState.keptOverrides).map(([groupId, keys]) => [
          groupId,
          [...keys]
        ])
      ),
      keepDecisionProvenance: Object.fromEntries(
        Object.entries(this.selectionState.keepDecisionProvenance ?? {}).map(
          ([groupId, provenance]) => [groupId, { ...provenance }]
        )
      )
    }
  }

  private sanitize(
    selections: DuplicateReviewSelections
  ): DuplicateReviewSelections {
    const selectedGroupIds = new Set(
      [...selections.selectedGroupIds].filter((groupId) =>
        this.groupsById.has(groupId)
      )
    )
    const reviewedGroupIds = new Set(
      [...selections.reviewedGroupIds].filter((groupId) =>
        this.groupsById.has(groupId)
      )
    )
    const keptOverrides: Record<string, Set<string>> = {}
    const keepDecisionProvenance: Record<string, KeepDecisionProvenance> = {}
    const suppliedProvenance = selections.keepDecisionProvenance ?? {}
    const suppliedOverrides =
      selections.keptOverrides &&
      typeof selections.keptOverrides === "object" &&
      !Array.isArray(selections.keptOverrides)
        ? selections.keptOverrides
        : {}

    for (const [groupId, keys] of Object.entries(suppliedOverrides)) {
      const group = this.groupsById.get(groupId)
      if (!group) continue
      const validMediaKeys = new Set(
        group.mediaKeys.filter((key) =>
          isUsableMediaItemForKey(this.mediaItems[key], key)
        )
      )
      const filtered = [...keys].filter((key) => validMediaKeys.has(key))
      const provenance = this.normalizeProvenance(suppliedProvenance[groupId])
      if (provenance?.source === "stale_fallback") {
        keptOverrides[groupId] = validMediaKeys
        keepDecisionProvenance[groupId] = provenance
      } else if (keys.size === 0) {
        keptOverrides[groupId] = new Set()
        keepDecisionProvenance[groupId] =
          provenance ?? { source: "legacy_preserved" }
      } else if (filtered.length > 0) {
        keptOverrides[groupId] = new Set(filtered)
        keepDecisionProvenance[groupId] =
          provenance ?? { source: "legacy_preserved" }
      } else {
        // A saved choice whose keys are unavailable must fail safe. Keeping
        // every current usable member preserves review intent without
        // authorizing a new single-copy Trash proposal.
        keptOverrides[groupId] = validMediaKeys
        keepDecisionProvenance[groupId] = { source: "stale_fallback" }
      }
      // Review completion is explicit persisted state. A manual or legacy
      // choice shows that the user made a decision, but a later bulk action
      // can invalidate review while preserving that choice. Older stored
      // records without reviewedGroupIds are migrated in deserializeSelections.
    }

    for (const group of this.groups) {
      if (Object.prototype.hasOwnProperty.call(suppliedOverrides, group.id)) {
        continue
      }
      const provenance = this.normalizeProvenance(
        suppliedProvenance[group.id]
      )
      if (
        provenance?.source !== "manual" &&
        provenance?.source !== "stale_fallback" &&
        provenance?.source !== "legacy_preserved"
      ) {
        continue
      }
      // Provenance without a validated keeper list cannot authorize a new
      // Trash proposal. Keep all current usable members until the user makes
      // a new choice, while leaving ordinary legacy no-override snapshots intact.
      keptOverrides[group.id] = new Set(
        group.mediaKeys.filter((key) =>
          isUsableMediaItemForKey(this.mediaItems[key], key)
        )
      )
      keepDecisionProvenance[group.id] = { source: "stale_fallback" }
    }

    return {
      selectedGroupIds,
      reviewedGroupIds,
      keptOverrides,
      keepDecisionProvenance
    }
  }

  private resolveKept(group: DuplicateGroup): Set<string> {
    return new Set(this.resolveDecision(group).keptMediaKeys)
  }

  private resolveDecision(group: DuplicateGroup): KeepDecision {
    const override = this.selectionState.keptOverrides[group.id]
    const provenance = this.selectionState.keepDecisionProvenance?.[group.id]
    const strategy = provenance?.strategy ?? this.defaultStrategy
    const recommendation = recommendDefaultKeepForGroup(
      group,
      this.mediaItems,
      strategy
    )

    if (override && provenance?.source === "automatic") {
      return {
        keptMediaKeys: new Set(recommendation.keptMediaKeys),
        source: "automatic",
        strategy,
        recommendation
      }
    }

    if (override) {
      return {
        keptMediaKeys: new Set(override),
        source: provenance?.source ?? "legacy_preserved",
        strategy,
        recommendation
      }
    }

    return {
      keptMediaKeys: new Set(recommendation.keptMediaKeys),
      source: "automatic",
      strategy: recommendation.strategy,
      recommendation
    }
  }

  private normalizeProvenance(
    provenance: KeepDecisionProvenance | undefined
  ): KeepDecisionProvenance | null {
    if (!provenance) return null
    if (
      provenance.source !== "manual" &&
      provenance.source !== "legacy_preserved" &&
      provenance.source !== "stale_fallback" &&
      provenance.source !== "automatic"
    ) {
      return null
    }
    if (provenance.strategy === undefined) {
      return provenance.source === "automatic"
        ? { source: "legacy_preserved" }
        : { source: provenance.source }
    }
    if (!isKeepStrategyValue(provenance.strategy)) {
      return provenance.source === "automatic"
        ? { source: "legacy_preserved" }
        : { source: provenance.source }
    }
    return { source: provenance.source, strategy: provenance.strategy }
  }
}

/**
 * Applies the persistent default to every current group while retaining
 * explicit manual choices and conservative stale-keeper fallbacks. Other
 * legacy and automatic choices are recomputed from current metadata.
 */
export function applyDefaultKeepStrategyToSelections(params: {
  groups: DuplicateGroup[]
  mediaItems: Record<string, GpdMediaItem>
  selections?: DuplicateReviewSelections
  strategy: KeepStrategy
}): DuplicateReviewSelections {
  const current = new DuplicateReviewSession({
    groups: params.groups,
    mediaItems: params.mediaItems,
    selections: params.selections,
    defaultStrategy: params.strategy
  })
  const updated = current.update({
    type: "apply_keep_strategy",
    groupIds: params.groups.map((group) => group.id),
    strategy: params.strategy
  })
  return new DuplicateReviewSession({
    groups: params.groups,
    mediaItems: params.mediaItems,
    selections: updated,
    defaultStrategy: params.strategy
  }).selections
}

function isKeepStrategyValue(value: unknown): value is KeepStrategy {
  return (
    value === "best_quality" ||
    value === "largest_resolution" ||
    value === "newest_taken" ||
    value === "oldest_taken" ||
    value === "newest_upload" ||
    value === "non_storage_counting"
  )
}
