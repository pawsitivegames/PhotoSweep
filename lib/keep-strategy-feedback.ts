import {
  DuplicateReviewSession,
  type DuplicateReviewAction,
  type DuplicateReviewSelections
} from "./duplicate-review-session"
import type { KeepStrategy } from "./keep-strategy"
import { KEEP_STRATEGY_LABELS } from "./keep-strategy-labels"
import type { DuplicateGroup, GpdMediaItem } from "./types"

export interface KeepStrategyFeedbackCounts {
  changedGroupCount: number
  alreadyMatchedGroupCount: number
  preservedGroupCount: number
  replacedManualGroupCount: number
  noConfidenceGroupCount: number
  deterministicFallbackGroupCount: number
  cleanupIncludedGroupCount: number
  proposedTrashMediaItemCount: number
}

export interface KeepStrategyApplication {
  selections: DuplicateReviewSelections
  session: DuplicateReviewSession
  feedback: string
}

export interface KeepStrategySelectionHandlerParams {
  groups: DuplicateGroup[]
  cleanupEligibleGroupIds?: Iterable<string>
  mediaItems?: Record<string, GpdMediaItem>
  selections: DuplicateReviewSelections
  strategy: KeepStrategy
  persistDefaultStrategy: (strategy: KeepStrategy) => void
  updateReviewSelections: (
    action: DuplicateReviewAction,
    nextSelectionsOverride?: DuplicateReviewSelections
  ) => DuplicateReviewSelections | null
  setFeedback: (message: string) => void
}

/** Shared app handler for a Selection-menu strategy choice. */
export function handleKeepStrategySelection(
  params: KeepStrategySelectionHandlerParams
): DuplicateReviewSelections | null {
  const { strategy } = params
  const cleanupEligibleGroupIds = [
    ...new Set(
      params.cleanupEligibleGroupIds ?? params.groups.map((group) => group.id)
    )
  ]
  params.persistDefaultStrategy(strategy)
  if (!params.mediaItems) {
    params.setFeedback(
      `${KEEP_STRATEGY_LABELS[strategy]} is saved as the default, but could not be applied because media details are unavailable. This action does not include sets for cleanup.`
    )
    return null
  }

  const action: DuplicateReviewAction = {
    type: "apply_keep_strategy",
    groupIds: params.groups.map((group) => group.id),
    strategy,
    includeGroupIds: cleanupEligibleGroupIds,
    overrideManualChoices: true
  }
  const application = applyKeepStrategyToReview({
    groups: params.groups,
    mediaItems: params.mediaItems,
    selections: params.selections,
    strategy,
    includeGroupIds: cleanupEligibleGroupIds
  })
  const nextSelections = params.updateReviewSelections(
    action,
    application.selections
  )
  if (!nextSelections) {
    params.setFeedback(
      `${KEEP_STRATEGY_LABELS[strategy]} is saved as the default. Results are being confirmed, so the new default will be applied when they are ready. This action does not include sets for cleanup.`
    )
    return null
  }

  params.setFeedback(application.feedback)
  return nextSelections
}

export function applyKeepStrategyToReview(params: {
  groups: DuplicateGroup[]
  includeGroupIds?: Iterable<string>
  mediaItems: Record<string, GpdMediaItem>
  selections: DuplicateReviewSelections
  strategy: KeepStrategy
}): KeepStrategyApplication {
  const cleanupEligibleGroupIds = new Set(
    params.includeGroupIds ?? params.groups.map((group) => group.id)
  )
  const previousSession = new DuplicateReviewSession({
    groups: params.groups,
    mediaItems: params.mediaItems,
    selections: params.selections
  })
  const selections = previousSession.update({
    type: "apply_keep_strategy",
    groupIds: params.groups.map((group) => group.id),
    strategy: params.strategy,
    includeGroupIds: cleanupEligibleGroupIds,
    overrideManualChoices: true
  })
  const session = new DuplicateReviewSession({
    groups: params.groups,
    mediaItems: params.mediaItems,
    selections
  })

  return {
    selections,
    session,
    feedback: buildKeepStrategyFeedback(
      params.strategy,
      summarizeKeepStrategyApplication(
        params.groups,
        previousSession,
        session,
        params.groups.filter((group) => cleanupEligibleGroupIds.has(group.id))
      )
    )
  }
}

export function summarizeKeepStrategyApplication(
  groups: DuplicateGroup[],
  previousSession: DuplicateReviewSession,
  nextSession: DuplicateReviewSession,
  cleanupScopeGroups: DuplicateGroup[] = groups
): KeepStrategyFeedbackCounts {
  const counts: KeepStrategyFeedbackCounts = {
    changedGroupCount: 0,
    alreadyMatchedGroupCount: 0,
    preservedGroupCount: 0,
    replacedManualGroupCount: 0,
    noConfidenceGroupCount: 0,
    deterministicFallbackGroupCount: 0,
    cleanupIncludedGroupCount: cleanupScopeGroups.filter((group) =>
      nextSession.selectedGroupIds.has(group.id)
    ).length,
    proposedTrashMediaItemCount: nextSession.trashPlan(cleanupScopeGroups)
      .mediaKeysToTrash.length
  }

  for (const group of groups) {
    const previousDecision = previousSession.decisionFor(group)
    if (previousDecision.source === "manual") {
      const nextDecision = nextSession.decisionFor(group)
      if (nextDecision.source === "manual") {
        counts.preservedGroupCount += 1
        continue
      }
      counts.replacedManualGroupCount += 1
    }

    const nextDecision = nextSession.decisionFor(group)
    if (nextDecision.recommendation.status === "no_confident_recommendation") {
      counts.noConfidenceGroupCount += 1
      continue
    }
    if (
      nextDecision.recommendation.reasonCode === "deterministic_tiebreak"
    ) {
      counts.deterministicFallbackGroupCount += 1
    }

    const previousKept = previousSession.keptFor(group)
    const nextKept = nextSession.keptFor(group)
    const matchesPrevious =
      previousKept.size === nextKept.size &&
      [...previousKept].every((mediaKey) => nextKept.has(mediaKey))

    if (matchesPrevious) counts.alreadyMatchedGroupCount += 1
    else counts.changedGroupCount += 1
  }

  return counts
}

function setCount(count: number): string {
  return `${count} set${count === 1 ? "" : "s"}`
}

export function buildKeepStrategyFeedback(
  strategy: KeepStrategy,
  counts: KeepStrategyFeedbackCounts
): string {
  const preservedLabel = counts.preservedGroupCount === 1 ? "choice" : "choices"
  const replacedManualLabel =
    counts.replacedManualGroupCount === 1 ? "choice replaced" : "choices replaced"
  const unresolvedLabel =
    counts.noConfidenceGroupCount === 1
      ? "set had no keeper data"
      : "sets had no keeper data"
  const includedSetLabel =
    counts.cleanupIncludedGroupCount === 1 ? "set" : "sets"
  const proposedItemLabel =
    counts.proposedTrashMediaItemCount === 1 ? "media item" : "media items"

  return `${KEEP_STRATEGY_LABELS[strategy]} was applied and saved as the default: ${setCount(counts.changedGroupCount)} changed; ${setCount(counts.alreadyMatchedGroupCount)} already had the selected keeper; ${counts.preservedGroupCount} manual ${preservedLabel} preserved; ${counts.replacedManualGroupCount} manual ${replacedManualLabel}; ${setCount(counts.deterministicFallbackGroupCount)} resolved by deterministic tie-break; ${counts.noConfidenceGroupCount} ${unresolvedLabel}. ${counts.cleanupIncludedGroupCount} ${includedSetLabel} included for cleanup review; ${counts.proposedTrashMediaItemCount} ${proposedItemLabel} proposed for Trash. Review each set before moving anything to Trash.`
}
