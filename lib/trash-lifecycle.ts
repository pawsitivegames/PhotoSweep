import type { DeleteReport } from "./delete-report"
import type {
  DuplicateReviewSession,
  DuplicateTrashPlan
} from "./duplicate-review-session"
import {
  buildTrashResultReport,
  type TrashResultReport
} from "./trash-result-report"
import { favoriteStatusForItem } from "./favorite-status"
import type {
  DuplicateGroup,
  GpdMediaItem,
  MutationOutcome,
  PhotoProvider
} from "./types"

export type IcloudAssetRef = NonNullable<GpdMediaItem["icloudAsset"]>

export interface TrashSnapshot {
  mediaItems: Record<string, GpdMediaItem>
  groups: DuplicateGroup[]
  totalItems: number
}

export interface TrashUndoData {
  operationId?: string
  provider: PhotoProvider
  dedupKeys: string[]
  count: number
  snapshot: TrashSnapshot
  icloudAssetRefs?: IcloudAssetRef[]
  accountEmail?: string
  providerSessionId?: string
  scopeFingerprint?: string
  scopeLabel?: string
}

export interface TrashAuditContext {
  operationId: string
  provider: PhotoProvider
  accountEmail?: string
  providerSessionId?: string
  scopeFingerprint?: string
  scopeLabel?: string
  attemptedDedupKeys: string[]
  attemptedMediaKeys: string[]
  icloudAssetRefs?: IcloudAssetRef[]
  /** Fresh iCloud change-tag references aligned to confirmed moved keys. */
  confirmedIcloudAssetRefs?: IcloudAssetRef[]
}

export interface TrashAuditAdapter {
  savePreTrashReport(
    report: DeleteReport,
    context?: TrashAuditContext
  ): Promise<void>
  saveTrashResultReport(
    report: TrashResultReport,
    context?: TrashAuditContext
  ): Promise<void>
}

export interface TrashBatchPolicy {
  batchSize: number
  batchPauseMs: number
  retryCount: number
  retryBackoffMs: number
}

export interface TrashCommand {
  requestId: string
  operationId: string
  provider: PhotoProvider
  totalToTrash: number
  args: {
    dedupKeys: string[]
    mediaKeysToTrash: string[]
    batchSize: number
    batchPauseMs: number
    retryCount: number
    retryBackoffMs: number
    accountEmail?: string
    providerSessionId?: string
    icloudAssetRefs?: IcloudAssetRef[]
    /** Exact selected targets whose snapshot favorite state was explicitly acknowledged as unknown. */
    acknowledgedUnknownFavoriteDedupKeys?: string[]
  }
}

export interface TrashProviderResultData {
  trashedKeys?: string[]
  trashedDedupKeys?: string[]
  requestedCount?: number
  icloudAssetRefs?: IcloudAssetRef[]
  dryRun?: boolean
  message?: string
  partial?: boolean
  retryAttempts?: number
  outcomes?: unknown
  notDispatchedDedupKeys?: unknown
}

export type TrashOutcome =
  | {
      kind: "dry_run"
      movedMediaKeys: []
      movedDedupKeys: []
      movedCount: 0
      message: string
      undo: null
    }
  | {
      kind: "complete" | "partial"
      movedMediaKeys: string[]
      movedDedupKeys: string[]
      movedCount: number
      unknownMediaKeys: string[]
      unknownDedupKeys: string[]
      failedMediaKeys: string[]
      failedDedupKeys: string[]
      notDispatchedMediaKeys: string[]
      notDispatchedDedupKeys: string[]
      message?: string
      undo: TrashUndoData | null
    }
  | {
      kind: "unknown"
      movedMediaKeys: []
      movedDedupKeys: []
      movedCount: 0
      unknownMediaKeys: string[]
      unknownDedupKeys: string[]
      failedMediaKeys: string[]
      failedDedupKeys: string[]
      notDispatchedMediaKeys: string[]
      notDispatchedDedupKeys: string[]
      error: string
      undo: null
    }
  | {
      kind: "failed"
      movedMediaKeys: []
      movedDedupKeys: []
      movedCount: 0
      unknownMediaKeys?: []
      unknownDedupKeys?: []
      failedMediaKeys?: string[]
      failedDedupKeys?: string[]
      notDispatchedMediaKeys?: string[]
      notDispatchedDedupKeys?: string[]
      error: string
      undo: null
    }

interface PendingTrash {
  requestId: string
  operationId: string
  status: "dispatched" | "ambiguous"
  plan: Pick<DuplicateTrashPlan, "provider" | "dedupKeys" | "mediaKeysToTrash">
  snapshot: TrashSnapshot
  context: TrashAuditContext
  progressOutcomes: Map<string, MutationOutcome>
  conflictingTerminalKeys: Set<string>
  progressResult?: TrashProviderResultData
}

interface PendingRestore {
  requestId: string
  undo: TrashUndoData
  progressOutcomes: Map<string, MutationOutcome>
}

interface RequestedTrashPair {
  mediaKey: string
  dedupKey: string
}

interface ConfirmedTrashKeys {
  movedMediaKeys: string[]
  movedDedupKeys: string[]
  failedMediaKeys: string[]
  failedDedupKeys: string[]
  unknownMediaKeys: string[]
  unknownDedupKeys: string[]
  notDispatchedMediaKeys: string[]
  notDispatchedDedupKeys: string[]
  outcomes: MutationOutcome[]
  responseHadIdentity: boolean
  responseHadUnrequestedIdentity: boolean
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string")
}

function failedOutcome(error: string): TrashOutcome {
  return {
    kind: "failed",
    movedMediaKeys: [],
    movedDedupKeys: [],
    movedCount: 0,
    error,
    undo: null
  }
}

function unknownOutcome(
  error: string,
  unknownMediaKeys: string[] = [],
  unknownDedupKeys: string[] = [],
  failedMediaKeys: string[] = [],
  failedDedupKeys: string[] = [],
  notDispatchedMediaKeys: string[] = [],
  notDispatchedDedupKeys: string[] = []
): TrashOutcome {
  return {
    kind: "unknown",
    movedMediaKeys: [],
    movedDedupKeys: [],
    movedCount: 0,
    unknownMediaKeys,
    unknownDedupKeys,
    failedMediaKeys,
    failedDedupKeys,
    notDispatchedMediaKeys,
    notDispatchedDedupKeys,
    error,
    undo: null
  }
}

export type RestoreOutcome =
  | {
      kind: "complete"
      restoredDedupKeys: string[]
      outcomes: MutationOutcome[]
      notDispatchedDedupKeys: string[]
    }
  | {
      kind: "partial"
      restoredDedupKeys: string[]
      undo: TrashUndoData
      error: string
      unknownDedupKeys: string[]
      failedDedupKeys: string[]
      notDispatchedDedupKeys: string[]
      outcomes: MutationOutcome[]
    }
  | {
      kind: "unknown"
      restoredDedupKeys: []
      undo: TrashUndoData
      error: string
      unknownDedupKeys: string[]
      failedDedupKeys: string[]
      notDispatchedDedupKeys: string[]
      outcomes: MutationOutcome[]
    }
  | {
      kind: "failed"
      restoredDedupKeys: []
      undo: TrashUndoData
      error: string
      unknownDedupKeys: []
      failedDedupKeys: string[]
      notDispatchedDedupKeys: string[]
      outcomes: MutationOutcome[]
    }

function confirmedTrashKeys(
  pending: PendingTrash,
  data: TrashProviderResultData | undefined
): ConfirmedTrashKeys {
  const pairs: RequestedTrashPair[] = pending.plan.dedupKeys.map(
    (dedupKey, index) => ({
      dedupKey,
      mediaKey: pending.plan.mediaKeysToTrash[index]!
    })
  )
  const requestedMedia = new Set(pairs.map((pair) => pair.mediaKey))
  const requestedDedup = new Set(pairs.map((pair) => pair.dedupKey))
  const movedDedup = new Set<string>()
  const failedDedup = new Set<string>()
  const unknownDedup = new Set<string>()
  const notDispatchedDedup = new Set<string>()
  const normalized: MutationOutcome[] = []
  let responseHadIdentity = false
  let responseHadUnrequestedIdentity = false

  const hasOutcomes = Boolean(
    data && Object.prototype.hasOwnProperty.call(data, "outcomes")
  )
  const rawNotDispatched = stringArray(data?.notDispatchedDedupKeys)
  if (rawNotDispatched) {
    const seenNotDispatched = new Set<string>()
    for (const key of rawNotDispatched) {
      if (!requestedDedup.has(key) || seenNotDispatched.has(key)) {
        responseHadUnrequestedIdentity = true
      } else {
        seenNotDispatched.add(key)
        notDispatchedDedup.add(key)
      }
    }
    if (
      !Array.isArray(data?.notDispatchedDedupKeys) ||
      rawNotDispatched.length !== data.notDispatchedDedupKeys.length
    ) {
      responseHadUnrequestedIdentity = true
    }
  } else if (data?.notDispatchedDedupKeys !== undefined) {
    responseHadUnrequestedIdentity = true
  }

  if (hasOutcomes) {
    responseHadIdentity = Array.isArray(data?.outcomes)
    const byKey = new Map<string, MutationOutcome[]>()
    if (Array.isArray(data?.outcomes)) {
      for (const candidate of data.outcomes) {
        if (!candidate || typeof candidate !== "object") {
          responseHadUnrequestedIdentity = true
          continue
        }
        const raw = candidate as Partial<MutationOutcome>
        if (
          typeof raw.targetKey !== "string" ||
          !requestedDedup.has(raw.targetKey) ||
          raw.operation !== "trash" ||
          (raw.status !== "confirmed" &&
            raw.status !== "failed" &&
            raw.status !== "unknown")
        ) {
          responseHadUnrequestedIdentity = true
          continue
        }
        const values = byKey.get(raw.targetKey) ?? []
        values.push({
          operation: "trash",
          targetKey: raw.targetKey,
          status: raw.status,
          ...(typeof raw.reason === "string"
            ? { reason: raw.reason.slice(0, 300) }
            : {})
        })
        byKey.set(raw.targetKey, values)
      }
    }
    for (const pair of pairs) {
      const values = byKey.get(pair.dedupKey) ?? []
      const candidate = values.length === 1 ? values[0] : undefined
      let status = candidate?.status ?? "unknown"
      if (
        values.length > 1 ||
        (notDispatchedDedup.has(pair.dedupKey) && status !== "failed")
      ) {
        status = "unknown"
        notDispatchedDedup.delete(pair.dedupKey)
        responseHadUnrequestedIdentity = true
      }
      const outcome: MutationOutcome = {
        operation: "trash",
        targetKey: pair.dedupKey,
        status,
        ...(candidate?.reason ? { reason: candidate.reason } : {})
      }
      normalized.push(outcome)
      if (status === "confirmed") movedDedup.add(pair.dedupKey)
      else if (status === "unknown") unknownDedup.add(pair.dedupKey)
      else if (notDispatchedDedup.has(pair.dedupKey)) {
        notDispatchedDedup.add(pair.dedupKey)
      } else failedDedup.add(pair.dedupKey)
    }
  } else {
    const reportedMedia = stringArray(data?.trashedKeys)
    const reportedDedup = stringArray(data?.trashedDedupKeys)
    responseHadIdentity = Boolean(reportedMedia || reportedDedup)
    responseHadUnrequestedIdentity = Boolean(
      responseHadUnrequestedIdentity ||
        reportedMedia?.some((key) => !requestedMedia.has(key)) ||
        reportedDedup?.some((key) => !requestedDedup.has(key))
    )
    const confirmedMedia = new Set(reportedMedia ?? [])
    const confirmedDedup = new Set(reportedDedup ?? [])
    for (const pair of pairs) {
      const mediaConfirmed =
        confirmedMedia.has(pair.mediaKey) ||
        (reportedMedia === undefined && confirmedDedup.has(pair.dedupKey))
      const dedupConfirmed =
        confirmedDedup.has(pair.dedupKey) ||
        (reportedDedup === undefined && confirmedMedia.has(pair.mediaKey))
      if (mediaConfirmed && dedupConfirmed) {
        movedDedup.add(pair.dedupKey)
        normalized.push({
          operation: "trash",
          targetKey: pair.dedupKey,
          status: "confirmed"
        })
      } else if (notDispatchedDedup.has(pair.dedupKey)) {
        normalized.push({
          operation: "trash",
          targetKey: pair.dedupKey,
          status: "failed",
          reason: "not-dispatched"
        })
      } else {
        unknownDedup.add(pair.dedupKey)
        normalized.push({
          operation: "trash",
          targetKey: pair.dedupKey,
          status: "unknown",
          reason: "legacy-response-did-not-confirm-target"
        })
      }
    }
  }

  const movedDedupKeys = pairs
    .filter((pair) => movedDedup.has(pair.dedupKey))
    .map((pair) => pair.dedupKey)
  const toMedia = (keys: Set<string>) =>
    pairs.flatMap((pair) => (keys.has(pair.dedupKey) ? [pair.mediaKey] : []))
  return {
    movedMediaKeys: toMedia(movedDedup),
    movedDedupKeys,
    failedMediaKeys: toMedia(failedDedup),
    failedDedupKeys: pairs
      .filter((pair) => failedDedup.has(pair.dedupKey))
      .map((pair) => pair.dedupKey),
    unknownMediaKeys: toMedia(unknownDedup),
    unknownDedupKeys: pairs
      .filter((pair) => unknownDedup.has(pair.dedupKey))
      .map((pair) => pair.dedupKey),
    notDispatchedMediaKeys: toMedia(notDispatchedDedup),
    notDispatchedDedupKeys: pairs
      .filter((pair) => notDispatchedDedup.has(pair.dedupKey))
      .map((pair) => pair.dedupKey),
    outcomes: normalized,
    responseHadIdentity,
    responseHadUnrequestedIdentity
  }
}

function confirmedIcloudAssetRefs(
  data: TrashProviderResultData | undefined,
  movedDedupKeys: string[]
): IcloudAssetRef[] | undefined {
  const refs = data?.icloudAssetRefs
  const resultKeys = stringArray(data?.trashedDedupKeys)
  if (!Array.isArray(refs) || !resultKeys || refs.length !== resultKeys.length) {
    return undefined
  }

  const refsByDedupKey = new Map<string, IcloudAssetRef>()
  for (let index = 0; index < resultKeys.length; index++) {
    const dedupKey = resultKeys[index]!
    const ref = refs[index]
    if (
      refsByDedupKey.has(dedupKey) ||
      !ref ||
      typeof ref.recordName !== "string" ||
      typeof ref.changeTag !== "string" ||
      typeof ref.zoneName !== "string" ||
      typeof ref.ownerRecordName !== "string"
    ) {
      return undefined
    }
    refsByDedupKey.set(dedupKey, ref)
  }

  const aligned = movedDedupKeys.map((dedupKey) =>
    refsByDedupKey.get(dedupKey)
  )
  return aligned.length > 0 && aligned.every(Boolean)
    ? (aligned as IcloudAssetRef[])
    : undefined
}

function remainingUndo(
  undo: TrashUndoData,
  restoredDedupKeys: string[]
): TrashUndoData {
  const restored = new Set(restoredDedupKeys)
  const remainingIndexes = undo.dedupKeys.flatMap((key, index) =>
    restored.has(key) ? [] : [index]
  )
  const remainingDedupKeys = remainingIndexes.map(
    (index) => undo.dedupKeys[index]!
  )
  const { icloudAssetRefs: _icloudAssetRefs, ...baseUndo } = undo
  const refs = undo.icloudAssetRefs
  const remainingAssetRefs =
    refs?.length === undo.dedupKeys.length
      ? remainingIndexes.map((index) => refs[index]!)
      : undefined
  return {
    ...baseUndo,
    dedupKeys: remainingDedupKeys,
    count: remainingDedupKeys.length,
    ...(remainingAssetRefs ? { icloudAssetRefs: remainingAssetRefs } : {})
  }
}

function restoreOutcomeFromStates(params: {
  undo: TrashUndoData
  outcomes: MutationOutcome[]
  notDispatchedDedupKeys: string[]
  error?: string
  malformed?: boolean
}): RestoreOutcome {
  const outcomeByKey = new Map(
    params.outcomes.map((outcome) => [outcome.targetKey, outcome])
  )
  const confirmed = params.undo.dedupKeys.filter(
    (key) => outcomeByKey.get(key)?.status === "confirmed"
  )
  const unknown = params.undo.dedupKeys.filter(
    (key) => outcomeByKey.get(key)?.status === "unknown"
  )
  const failed = params.undo.dedupKeys.filter(
    (key) => outcomeByKey.get(key)?.status === "failed"
  )
  const notDispatched = params.undo.dedupKeys.filter((key) =>
    params.notDispatchedDedupKeys.includes(key)
  )
  const error = params.malformed
    ? "The provider restore response did not contain a valid identity for every requested item; ambiguous targets will not be retried."
    : params.error ||
      "The provider did not confirm that every requested item was restored."
  const resolved = params.undo.dedupKeys.map(
    (targetKey) => outcomeByKey.get(targetKey)!
  )
  const undo = remainingUndo(params.undo, [...confirmed, ...unknown])

  if (confirmed.length === params.undo.dedupKeys.length) {
    return {
      kind: "complete",
      restoredDedupKeys: confirmed,
      outcomes: resolved,
      notDispatchedDedupKeys: notDispatched
    }
  }
  if (confirmed.length > 0) {
    return {
      kind: "partial",
      restoredDedupKeys: confirmed,
      undo,
      error,
      unknownDedupKeys: unknown,
      failedDedupKeys: failed,
      notDispatchedDedupKeys: notDispatched,
      outcomes: resolved
    }
  }
  if (unknown.length > 0) {
    return {
      kind: "unknown",
      restoredDedupKeys: [],
      undo,
      error,
      unknownDedupKeys: unknown,
      failedDedupKeys: failed,
      notDispatchedDedupKeys: notDispatched,
      outcomes: resolved
    }
  }
  return {
    kind: "failed",
    restoredDedupKeys: [],
    undo,
    error: params.error || error,
    unknownDedupKeys: [],
    failedDedupKeys: failed,
    notDispatchedDedupKeys: notDispatched,
    outcomes: resolved
  }
}

function undoForPending(
  pending: PendingTrash,
  movedDedupKeys: string[],
  movedMediaKeys: string[],
  refreshedIcloudAssetRefs?: IcloudAssetRef[]
): TrashUndoData | null {
  if (movedDedupKeys.length === 0) return null
  return {
    operationId: pending.operationId,
    provider: pending.plan.provider,
    dedupKeys: movedDedupKeys,
    count: movedDedupKeys.length,
    snapshot: pending.snapshot,
    ...(refreshedIcloudAssetRefs
      ? { icloudAssetRefs: refreshedIcloudAssetRefs }
      : {}),
    ...(pending.context.accountEmail
      ? { accountEmail: pending.context.accountEmail }
      : {}),
    ...(pending.context.providerSessionId
      ? { providerSessionId: pending.context.providerSessionId }
      : {}),
    ...(pending.context.scopeFingerprint
      ? { scopeFingerprint: pending.context.scopeFingerprint }
      : {}),
    ...(pending.context.scopeLabel
      ? { scopeLabel: pending.context.scopeLabel }
      : {})
  }
}

export class TrashLifecycle {
  private pending: PendingTrash | null = null
  private pendingRestore: PendingRestore | null = null
  private beginInFlight = false

  constructor(private readonly audit: TrashAuditAdapter) {}

  async begin(params: {
    plan: DuplicateTrashPlan
    reviewSession: DuplicateReviewSession
    groups: DuplicateGroup[]
    snapshot: TrashSnapshot
    batchPolicy: TrashBatchPolicy
    operationId?: string
    requestId?: string
    accountEmail?: string
    providerSessionId?: string
    scopeFingerprint?: string
    scopeLabel?: string
    unknownFavoriteAcknowledged?: boolean
  }): Promise<TrashCommand> {
    if (this.pending || this.beginInFlight) {
      throw new Error("Another trash operation is already pending.")
    }
    if (params.plan.dedupKeys.length !== params.plan.mediaKeysToTrash.length) {
      throw new Error("Trash plan identities are inconsistent.")
    }
    if (
      params.plan.dedupKeys.some(
        (key) => typeof key !== "string" || key.length === 0
      ) ||
      params.plan.mediaKeysToTrash.some(
        (key) => typeof key !== "string" || key.length === 0
      ) ||
      new Set(params.plan.dedupKeys).size !== params.plan.dedupKeys.length ||
      new Set(params.plan.mediaKeysToTrash).size !==
        params.plan.mediaKeysToTrash.length
    ) {
      throw new Error("Trash plan identities are inconsistent.")
    }
    const declaredUnknownFavoriteKeys =
      params.plan.unknownFavoriteMediaKeys ?? []
    const plannedTargetKeys = new Set(params.plan.mediaKeysToTrash)
    if (
      declaredUnknownFavoriteKeys.some((key) => !plannedTargetKeys.has(key)) ||
      new Set(declaredUnknownFavoriteKeys).size !==
        declaredUnknownFavoriteKeys.length
    ) {
      throw new Error("Trash plan favorite-status identities are inconsistent.")
    }
    const currentUnknownFavoriteKeys = params.plan.mediaKeysToTrash.filter(
      (key) => favoriteStatusForItem(params.snapshot.mediaItems[key]) === "unknown"
    )
    const sortedDeclaredUnknownFavoriteKeys = [...declaredUnknownFavoriteKeys].sort()
    const sortedCurrentUnknownFavoriteKeys = [...currentUnknownFavoriteKeys].sort()
    if (
      JSON.stringify(sortedDeclaredUnknownFavoriteKeys) !==
      JSON.stringify(sortedCurrentUnknownFavoriteKeys)
    ) {
      throw new Error(
        "Favorite status changed after the Trash plan was prepared; rebuild the plan."
      )
    }
    if (
      currentUnknownFavoriteKeys.length > 0 &&
      params.unknownFavoriteAcknowledged !== true
    ) {
      throw new Error(
        "Favorite status is unknown for selected items; explicit acknowledgement is required before Trash."
      )
    }
    const mediaKeyToDedupKey = new Map(
      params.plan.mediaKeysToTrash.map((mediaKey, index) => [
        mediaKey,
        params.plan.dedupKeys[index]!
      ])
    )
    const acknowledgedUnknownFavoriteDedupKeys =
      params.unknownFavoriteAcknowledged === true
        ? currentUnknownFavoriteKeys.flatMap((mediaKey) => {
            const dedupKey = mediaKeyToDedupKey.get(mediaKey)
            return dedupKey ? [dedupKey] : []
          })
        : []
    this.beginInFlight = true
    const operationId =
      params.operationId ??
      `gpd-cleanup-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`
    const requestId =
      params.requestId?.trim() ||
      `gpd-trash-request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const providerSessionId = params.providerSessionId
    const context: TrashAuditContext = {
      operationId,
      provider: params.plan.provider,
      ...(params.accountEmail ? { accountEmail: params.accountEmail } : {}),
      ...(providerSessionId
        ? { providerSessionId }
        : {}),
      ...(params.scopeFingerprint
        ? { scopeFingerprint: params.scopeFingerprint }
        : {}),
      ...(params.scopeLabel ? { scopeLabel: params.scopeLabel } : {}),
      attemptedDedupKeys: [...params.plan.dedupKeys],
      attemptedMediaKeys: [...params.plan.mediaKeysToTrash],
      ...(params.plan.icloudAssetRefs
        ? {
            icloudAssetRefs: params.plan.icloudAssetRefs.map((asset) => ({
              ...asset
            }))
          }
        : {})
    }
    const report = params.reviewSession.deleteReport({
      groups: params.groups,
      plan: params.plan,
      trashBatchSize: params.batchPolicy.batchSize,
      operationId
    })
    try {
      await this.audit.savePreTrashReport(report, context)

      this.pending = {
        requestId,
        operationId,
        status: "dispatched",
        plan: {
          provider: params.plan.provider,
          dedupKeys: [...params.plan.dedupKeys],
          mediaKeysToTrash: [...params.plan.mediaKeysToTrash]
        },
        snapshot: params.snapshot,
        context,
        progressOutcomes: new Map(),
        conflictingTerminalKeys: new Set()
      }

      return {
        requestId,
        operationId,
        provider: params.plan.provider,
        totalToTrash: params.plan.dedupKeys.length,
        args: {
          dedupKeys: [...params.plan.dedupKeys],
          mediaKeysToTrash: [...params.plan.mediaKeysToTrash],
          batchSize: params.batchPolicy.batchSize,
          batchPauseMs: params.batchPolicy.batchPauseMs,
          retryCount: params.batchPolicy.retryCount,
          retryBackoffMs: params.batchPolicy.retryBackoffMs,
          ...(params.accountEmail ? { accountEmail: params.accountEmail } : {}),
          ...(providerSessionId
            ? { providerSessionId }
            : {}),
          ...(params.plan.icloudAssetRefs
            ? { icloudAssetRefs: [...params.plan.icloudAssetRefs] }
            : {}),
          ...(acknowledgedUnknownFavoriteDedupKeys.length > 0
            ? { acknowledgedUnknownFavoriteDedupKeys }
            : {})
        }
      }
    } finally {
      this.beginInFlight = false
    }
  }

  async reconcile(params: {
    requestId?: string
    success: boolean
    data?: TrashProviderResultData
    error?: string
  }): Promise<TrashOutcome> {
    const pending = this.pending
    if (!pending) {
      return failedOutcome("Trash response did not match a pending operation.")
    }
    if (params.requestId !== undefined && params.requestId !== pending.requestId) {
      return failedOutcome("Trash response did not match the pending request.")
    }

    // Consume the authorization before awaiting persistence. A duplicated or
    // delayed provider reply must not replay a completed operation while the
    // first result report is still being saved.
    this.pending = null
    const attemptedMediaKeys = pending.plan.mediaKeysToTrash
    const attemptedDedupKeys = pending.plan.dedupKeys
    let effectiveData = params.data
    if (
      !effectiveData ||
      !Object.prototype.hasOwnProperty.call(effectiveData, "outcomes")
    ) {
      if (pending.progressOutcomes.size > 0) {
        effectiveData = {
          ...effectiveData,
          outcomes: attemptedDedupKeys.map(
            (targetKey) =>
              pending.progressOutcomes.get(targetKey) ?? {
                operation: "trash" as const,
                targetKey,
                status: "unknown" as const,
                reason: "no-terminal-provider-outcome"
              }
          )
        }
      }
    }
    const confirmed = confirmedTrashKeys(pending, effectiveData)
    const movedMediaKeys = effectiveData?.dryRun
      ? []
      : confirmed.movedMediaKeys
    const movedDedupKeys = effectiveData?.dryRun
      ? []
      : confirmed.movedDedupKeys
    const error = params.error || "Trash failed"
    const incompleteSuccess =
      params.success &&
      (movedMediaKeys.length !== attemptedMediaKeys.length ||
        !confirmed.responseHadIdentity)
    const responseError =
      !params.success
        ? error
        : incompleteSuccess
          ? "Trash provider response did not confirm every requested item."
          : confirmed.responseHadUnrequestedIdentity
            ? "Trash provider response included identities outside the confirmed request."
            : undefined

    const refreshedIcloudAssetRefs = confirmedIcloudAssetRefs(
      effectiveData,
      movedDedupKeys
    )
    const auditContext = refreshedIcloudAssetRefs
      ? {
          ...pending.context,
          confirmedIcloudAssetRefs: refreshedIcloudAssetRefs
        }
      : pending.context

    await this.audit.saveTrashResultReport(
      buildTrashResultReport({
        operationId: pending.operationId,
        attemptedMediaKeys,
        attemptedDedupKeys,
        movedMediaKeys,
        movedDedupKeys,
        outcomes: confirmed.outcomes,
        notDispatchedDedupKeys: confirmed.notDispatchedDedupKeys,
        retryAttempts: effectiveData?.retryAttempts,
        ...(responseError ? { error: responseError } : {})
      }),
      auditContext
    )

    if (params.success && effectiveData?.dryRun) {
      const requestedCount =
        effectiveData.requestedCount ?? attemptedMediaKeys.length
      return {
        kind: "dry_run",
        movedMediaKeys: [],
        movedDedupKeys: [],
        movedCount: 0,
        message:
          effectiveData.message ??
          `iCloud delete dry-run completed for ${requestedCount.toLocaleString()} item${requestedCount === 1 ? "" : "s"}. Nothing was deleted.`,
        undo: null
      }
    }

    const movedCount = movedMediaKeys.length
    if (movedCount > 0) {
      const undo = undoForPending(
        pending,
        movedDedupKeys,
        movedMediaKeys,
        refreshedIcloudAssetRefs
      )!
      return {
        kind: params.success && !responseError ? "complete" : "partial",
        movedMediaKeys,
        movedDedupKeys,
        movedCount,
        unknownMediaKeys: confirmed.unknownMediaKeys,
        unknownDedupKeys: confirmed.unknownDedupKeys,
        failedMediaKeys: confirmed.failedMediaKeys,
        failedDedupKeys: confirmed.failedDedupKeys,
        notDispatchedMediaKeys: confirmed.notDispatchedMediaKeys,
        notDispatchedDedupKeys: confirmed.notDispatchedDedupKeys,
        ...(responseError
          ? {
              message: `Moved ${movedMediaKeys.length.toLocaleString()} item${movedMediaKeys.length === 1 ? "" : "s"} before trash failed. The provider response was incomplete or invalid: ${responseError}`
            }
          : {}),
        undo
      }
    }

    if (confirmed.unknownDedupKeys.length > 0) {
      return unknownOutcome(
        responseError ??
          "The provider outcome is unknown. Do not retry or restore these targets until their state is reconciled.",
        confirmed.unknownMediaKeys,
        confirmed.unknownDedupKeys,
        confirmed.failedMediaKeys,
        confirmed.failedDedupKeys,
        confirmed.notDispatchedMediaKeys,
        confirmed.notDispatchedDedupKeys
      )
    }

    return {
      kind: "failed",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      ...(confirmed.failedMediaKeys.length > 0
        ? { failedMediaKeys: confirmed.failedMediaKeys }
        : {}),
      ...(confirmed.failedDedupKeys.length > 0
        ? { failedDedupKeys: confirmed.failedDedupKeys }
        : {}),
      ...(confirmed.notDispatchedMediaKeys.length > 0
        ? { notDispatchedMediaKeys: confirmed.notDispatchedMediaKeys }
        : {}),
      ...(confirmed.notDispatchedDedupKeys.length > 0
        ? { notDispatchedDedupKeys: confirmed.notDispatchedDedupKeys }
        : {}),
      error: responseError ?? error,
      undo: null
    }
  }

  async timeout(params: {
    requestId: string
    error?: string
  }): Promise<TrashOutcome> {
    const pending = this.pending
    if (!pending || pending.requestId !== params.requestId) {
      return failedOutcome("Trash timeout did not match the pending request.")
    }
    if (pending.status === "ambiguous") {
      const latest = confirmedTrashKeys(pending, {
        ...pending.progressResult,
        outcomes: pending.plan.dedupKeys.map(
          (targetKey) =>
            pending.progressOutcomes.get(targetKey) ?? {
              operation: "trash" as const,
              targetKey,
              status: "unknown" as const,
              reason: "no-provider-progress-outcome"
            }
        )
      })
      return unknownOutcome(
        "Trash request is already awaiting provider reconciliation.",
        latest.unknownMediaKeys,
        latest.unknownDedupKeys,
        latest.failedMediaKeys,
        latest.failedDedupKeys,
        latest.notDispatchedMediaKeys,
        latest.notDispatchedDedupKeys
      )
    }

    pending.status = "ambiguous"
    const error =
      params.error ??
      "Trash provider did not respond before the safety timeout. Do not retry until the result is reconciled."
    const timeoutData: TrashProviderResultData = {
      ...pending.progressResult,
      outcomes: pending.plan.dedupKeys.map(
        (targetKey) =>
          pending.progressOutcomes.get(targetKey) ?? {
            operation: "trash" as const,
            targetKey,
            status: "unknown" as const,
            reason: "provider-timeout-before-target-outcome"
          }
      )
    }
    const resolved = confirmedTrashKeys(pending, timeoutData)
    const refreshedIcloudAssetRefs = confirmedIcloudAssetRefs(
      timeoutData,
      resolved.movedDedupKeys
    )
    const auditContext = refreshedIcloudAssetRefs
      ? {
          ...pending.context,
          confirmedIcloudAssetRefs: refreshedIcloudAssetRefs
        }
      : pending.context
    await this.audit.saveTrashResultReport(
      buildTrashResultReport({
        operationId: pending.operationId,
        attemptedMediaKeys: pending.plan.mediaKeysToTrash,
        attemptedDedupKeys: pending.plan.dedupKeys,
        movedMediaKeys: resolved.movedMediaKeys,
        movedDedupKeys: resolved.movedDedupKeys,
        outcomes: resolved.outcomes,
        notDispatchedDedupKeys: resolved.notDispatchedDedupKeys,
        error
      }),
      auditContext
    )
    if (resolved.movedDedupKeys.length > 0) {
      return {
        kind: "partial",
        movedMediaKeys: resolved.movedMediaKeys,
        movedDedupKeys: resolved.movedDedupKeys,
        movedCount: resolved.movedDedupKeys.length,
        unknownMediaKeys: resolved.unknownMediaKeys,
        unknownDedupKeys: resolved.unknownDedupKeys,
        failedMediaKeys: resolved.failedMediaKeys,
        failedDedupKeys: resolved.failedDedupKeys,
        notDispatchedMediaKeys: resolved.notDispatchedMediaKeys,
        notDispatchedDedupKeys: resolved.notDispatchedDedupKeys,
        message: error,
        undo: undoForPending(
          pending,
          resolved.movedDedupKeys,
          resolved.movedMediaKeys,
          refreshedIcloudAssetRefs
        )
      }
    }
    return unknownOutcome(
      error,
      resolved.unknownMediaKeys,
      resolved.unknownDedupKeys,
      resolved.failedMediaKeys,
      resolved.failedDedupKeys,
      resolved.notDispatchedMediaKeys,
      resolved.notDispatchedDedupKeys
    )
  }

  /** Keep exact evaluated provider outcomes so a timeout can retain confirmed chunks. */
  recordProgress(params: {
    requestId: string
    data?: TrashProviderResultData
  }): boolean {
    const pending = this.pending
    if (!pending || pending.requestId !== params.requestId) return false
    if (!Array.isArray(params.data?.outcomes)) return false
    const requested = new Set(pending.plan.dedupKeys)
    const seen = new Set<string>()
    for (const candidate of params.data.outcomes) {
      if (!candidate || typeof candidate !== "object") continue
      const raw = candidate as Partial<MutationOutcome>
      if (
        raw.operation !== "trash" ||
        typeof raw.targetKey !== "string" ||
        !requested.has(raw.targetKey) ||
        (raw.status !== "confirmed" &&
          raw.status !== "failed" &&
          raw.status !== "unknown")
      ) {
        continue
      }
      if (seen.has(raw.targetKey)) {
        // The terminal parser quarantines any target with more than one
        // outcome identity. Progress must keep that same unique-identity
        // rule, even when duplicate entries happen to agree.
        pending.conflictingTerminalKeys.add(raw.targetKey)
        pending.progressOutcomes.set(raw.targetKey, {
          operation: "trash",
          targetKey: raw.targetKey,
          status: "unknown"
        })
        continue
      }
      seen.add(raw.targetKey)
      if (pending.conflictingTerminalKeys.has(raw.targetKey)) continue
      const previous = pending.progressOutcomes.get(raw.targetKey)
      const next: MutationOutcome = {
        operation: "trash",
        targetKey: raw.targetKey,
        status: raw.status,
        ...(typeof raw.reason === "string"
          ? { reason: raw.reason.slice(0, 300) }
          : {})
      }
      // Exact confirmations and definitive no-effect failures are terminal
      // facts. Contradictory terminal facts quarantine the target; later
      // progress cannot restore retry or Undo authority.
      if (
        previous &&
        (previous.status === "confirmed" || previous.status === "failed") &&
        next.status === "unknown"
      ) {
        continue
      }
      if (
        previous &&
        (previous.status === "confirmed" || previous.status === "failed") &&
        (next.status === "confirmed" || next.status === "failed") &&
        next.status !== previous.status
      ) {
        pending.conflictingTerminalKeys.add(raw.targetKey)
        pending.progressOutcomes.set(raw.targetKey, {
          operation: "trash",
          targetKey: raw.targetKey,
          status: "unknown"
        })
        continue
      }
      pending.progressOutcomes.set(raw.targetKey, next)
    }
    pending.progressResult = {
      ...(params.data.trashedKeys
        ? { trashedKeys: stringArray(params.data.trashedKeys) ?? [] }
        : {}),
      ...(params.data.trashedDedupKeys
        ? { trashedDedupKeys: stringArray(params.data.trashedDedupKeys) ?? [] }
        : {}),
      ...(Array.isArray(params.data.icloudAssetRefs)
        ? { icloudAssetRefs: params.data.icloudAssetRefs }
        : {}),
      outcomes: pending.plan.dedupKeys.flatMap((targetKey) => {
        const outcome = pending.progressOutcomes.get(targetKey)
        return outcome ? [outcome] : []
      })
    }
    return true
  }

  isPending(requestId?: string): boolean {
    return Boolean(
      (this.pending &&
        (requestId === undefined || this.pending.requestId === requestId)) ||
        (this.pendingRestore &&
          (requestId === undefined || this.pendingRestore.requestId === requestId))
    )
  }

  cancel(requestId: string): boolean {
    if (!this.pending || this.pending.requestId !== requestId) return false
    this.pending = null
    return true
  }

  beginRestore(
    undo: TrashUndoData,
    requestId: string
  ): {
    provider: PhotoProvider
    args: {
      dedupKeys: string[]
      accountEmail?: string
      providerSessionId?: string
      icloudAssetRefs?: IcloudAssetRef[]
    }
  } {
    if (
      !Array.isArray(undo.dedupKeys) ||
      undo.dedupKeys.length === 0 ||
      undo.dedupKeys.some(
        (key) => typeof key !== "string" || key.length === 0
      ) ||
      new Set(undo.dedupKeys).size !== undo.dedupKeys.length
    ) {
      throw new Error("Restore target identities are invalid or duplicated.")
    }
    this.pendingRestore = { undo, requestId, progressOutcomes: new Map() }
    return {
      provider: undo.provider,
      args: {
        dedupKeys: undo.dedupKeys,
        ...(undo.accountEmail ? { accountEmail: undo.accountEmail } : {}),
        ...(undo.providerSessionId
          ? { providerSessionId: undo.providerSessionId }
          : {}),
        ...(undo.icloudAssetRefs
          ? { icloudAssetRefs: undo.icloudAssetRefs }
          : {})
      }
    }
  }

  cancelRestore(requestId: string): boolean {
    if (this.pendingRestore?.requestId !== requestId) return false
    this.pendingRestore = null
    return true
  }

  recordRestoreProgress(params: {
    requestId: string
    outcomes?: unknown
  }): boolean {
    const pending = this.pendingRestore
    if (params.requestId !== pending?.requestId || !Array.isArray(params.outcomes)) {
      return false
    }
    const requested = new Set(pending.undo.dedupKeys)
    const seen = new Set<string>()
    const parsed: MutationOutcome[] = []
    for (const candidate of params.outcomes) {
      if (!candidate || typeof candidate !== "object") return false
      const raw = candidate as Partial<MutationOutcome>
      if (
        raw.operation !== "restore" ||
        typeof raw.targetKey !== "string" ||
        !requested.has(raw.targetKey) ||
        seen.has(raw.targetKey) ||
        (raw.status !== "confirmed" &&
          raw.status !== "failed" &&
          raw.status !== "unknown")
      ) {
        return false
      }
      seen.add(raw.targetKey)
      parsed.push({
        operation: "restore",
        targetKey: raw.targetKey,
        status: raw.status,
        ...(typeof raw.reason === "string"
          ? { reason: raw.reason.slice(0, 300) }
          : {})
      })
    }
    for (const incoming of parsed) {
      const prior = pending.progressOutcomes.get(incoming.targetKey)
      let status = incoming.status
      if (
        prior?.status === "unknown" ||
        incoming.status === "unknown" ||
        (prior?.status === "failed" && incoming.status === "confirmed")
      ) {
        status = "unknown"
      } else if (
        prior?.status === "confirmed" ||
        incoming.status === "confirmed"
      ) {
        status = "confirmed"
      }
      pending.progressOutcomes.set(incoming.targetKey, {
        ...incoming,
        status
      })
    }
    return true
  }

  restoreProgressSnapshot(requestId: string): MutationOutcome[] | undefined {
    const pending = this.pendingRestore
    if (pending?.requestId !== requestId) return undefined
    return pending.undo.dedupKeys.map(
      (targetKey) =>
        pending.progressOutcomes.get(targetKey) ?? {
          operation: "restore" as const,
          targetKey,
          status: "unknown" as const,
          reason: "durable-pre-dispatch-intent"
        }
    )
  }

  timeoutRestore(params: {
    requestId: string
    error?: string
  }): RestoreOutcome | undefined {
    const pending = this.pendingRestore
    if (params.requestId !== pending?.requestId) return undefined
    const outcomes = pending.undo.dedupKeys.map((targetKey) =>
      pending.progressOutcomes.get(targetKey) ?? {
        operation: "restore" as const,
        targetKey,
        status: "unknown" as const,
        reason: "timeout-without-target-outcome"
      }
    )
    return restoreOutcomeFromStates({
      undo: pending.undo,
      outcomes,
      notDispatchedDedupKeys: [],
      error: params.error || "The provider restore request timed out.",
      malformed: false
    })
  }

  reconcileRestore(params: {
    requestId: string
    success: boolean
    restoredDedupKeys?: unknown
    outcomes?: unknown
    notDispatchedDedupKeys?: unknown
    error?: string
  }): RestoreOutcome | undefined {
    if (params.requestId !== this.pendingRestore?.requestId) return undefined
    const pending = this.pendingRestore
    const undo = pending.undo
    this.pendingRestore = null
    const requested = new Set(undo.dedupKeys)
    // Optional bridge fields may be copied as `undefined`; only a defined
    // outcomes value selects the per-target protocol. Explicit null remains
    // present and is rejected as malformed below.
    const hasOutcomes = params.outcomes !== undefined
    const notDispatchedRaw = Array.isArray(params.notDispatchedDedupKeys)
      ? params.notDispatchedDedupKeys.filter(
          (key): key is string => typeof key === "string"
        )
      : []
    const notDispatched = new Set(
      notDispatchedRaw.filter((key) => requested.has(key))
    )
    let malformed =
      params.notDispatchedDedupKeys !== undefined &&
      (!Array.isArray(params.notDispatchedDedupKeys) ||
        notDispatchedRaw.length !== params.notDispatchedDedupKeys.length ||
        new Set(notDispatchedRaw).size !== notDispatchedRaw.length ||
        notDispatchedRaw.some((key) => !requested.has(key)))

    if (hasOutcomes) {
      const byKey = new Map<string, MutationOutcome[]>()
      if (Array.isArray(params.outcomes)) {
        for (const candidate of params.outcomes) {
          if (!candidate || typeof candidate !== "object") {
            malformed = true
            continue
          }
          const raw = candidate as Partial<MutationOutcome>
          if (
            raw.operation !== "restore" ||
            typeof raw.targetKey !== "string" ||
            !requested.has(raw.targetKey) ||
            (raw.status !== "confirmed" &&
              raw.status !== "failed" &&
              raw.status !== "unknown")
          ) {
            malformed = true
            continue
          }
          const values = byKey.get(raw.targetKey) ?? []
          values.push({
            operation: "restore",
            targetKey: raw.targetKey,
            status: raw.status,
            ...(typeof raw.reason === "string"
              ? { reason: raw.reason.slice(0, 300) }
              : {})
          })
          byKey.set(raw.targetKey, values)
        }
      } else {
        malformed = true
      }
      malformed =
        malformed ||
        byKey.size !== undo.dedupKeys.length ||
        [...byKey.values()].some((values) => values.length !== 1)
      if ([...notDispatched].some((key) => byKey.get(key)?.length !== 1 || byKey.get(key)?.[0]?.status !== "failed")) {
        malformed = true
      }
      const resolvedOutcomes = undo.dedupKeys.map((key) => {
        const values = byKey.get(key) ?? []
        const candidate = values.length === 1 ? values[0] : undefined
        const prior = pending.progressOutcomes.get(key)
        let status: MutationOutcome["status"] =
          candidate?.status ?? "unknown"
        if (malformed || values.length > 1) {
          status = prior?.status === "confirmed" ? "confirmed" : "unknown"
          notDispatched.delete(key)
        } else if (prior?.status === "confirmed") {
          status = "confirmed"
          notDispatched.delete(key)
        } else if (notDispatched.has(key) && status !== "failed") {
          malformed = true
          status = "unknown"
          notDispatched.delete(key)
        }
        const reason =
          status === "failed" && notDispatched.has(key)
            ? "not-dispatched"
            : status === candidate?.status && typeof candidate.reason === "string"
              ? candidate.reason
              : status === prior?.status && typeof prior.reason === "string"
                ? prior.reason
                : undefined
        return {
          operation: "restore" as const,
          targetKey: key,
          status,
          ...(typeof reason === "string" ? { reason } : {})
        }
      })
      if (malformed) {
        for (const outcome of resolvedOutcomes) {
          const prior = pending.progressOutcomes.get(outcome.targetKey)
          if (prior?.status !== "confirmed") outcome.status = "unknown"
        }
        notDispatched.clear()
      }
      return restoreOutcomeFromStates({
        undo,
        outcomes: resolvedOutcomes,
        notDispatchedDedupKeys: undo.dedupKeys.filter((key) => notDispatched.has(key)),
        error: params.error,
        malformed
      })
    } else {
      const reported = Array.isArray(params.restoredDedupKeys)
        ? params.restoredDedupKeys
        : []
      const reportedStrings = reported.filter(
        (key): key is string => typeof key === "string"
      )
      const duplicateIdentity =
        new Set(reportedStrings).size !== reportedStrings.length
      malformed =
        malformed ||
        !Array.isArray(params.restoredDedupKeys) ||
        reportedStrings.length !== reported.length ||
        duplicateIdentity ||
        reportedStrings.some((key) => !requested.has(key)) ||
        reportedStrings.some((key) => notDispatched.has(key))
      const exactCompleteTerminal =
        !malformed &&
        reportedStrings.length === undo.dedupKeys.length &&
        undo.dedupKeys.every((key) => reportedStrings.includes(key))
      const resolvedOutcomes = undo.dedupKeys.map((key) => {
        const prior = pending.progressOutcomes.get(key)
        let status: MutationOutcome["status"] =
          !malformed && reportedStrings.includes(key)
            ? "confirmed"
            : !malformed && notDispatched.has(key)
              ? "failed"
              : "unknown"
        if (prior?.status === "unknown" && !exactCompleteTerminal) {
          status = "unknown"
        }
        else if (prior?.status === "confirmed") status = "confirmed"
        if (status !== "failed") notDispatched.delete(key)
        return {
          operation: "restore" as const,
          targetKey: key,
          status,
          ...(status === "failed" ? { reason: "not-dispatched" } : {})
        }
      })
      if (malformed) {
        for (const outcome of resolvedOutcomes) {
          const prior = pending.progressOutcomes.get(outcome.targetKey)
          if (prior?.status !== "confirmed") outcome.status = "unknown"
        }
        notDispatched.clear()
      }
      return restoreOutcomeFromStates({
        undo,
        outcomes: resolvedOutcomes,
        notDispatchedDedupKeys: undo.dedupKeys.filter((key) => notDispatched.has(key)),
        error: params.error,
        malformed
      })
    }
  }

  reset(): void {
    this.pending = null
    this.pendingRestore = null
  }
}
