import type { DeleteReport } from "./delete-report"
import type {
  DuplicateReviewSession,
  DuplicateTrashPlan
} from "./duplicate-review-session"
import {
  buildTrashResultReport,
  type TrashResultReport
} from "./trash-result-report"
import type { DuplicateGroup, GpdMediaItem, PhotoProvider } from "./types"

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
  scopeFingerprint?: string
  scopeLabel?: string
}

export interface TrashAuditContext {
  operationId: string
  provider: PhotoProvider
  accountEmail?: string
  scopeFingerprint?: string
  scopeLabel?: string
  attemptedDedupKeys: string[]
  attemptedMediaKeys: string[]
  icloudAssetRefs?: IcloudAssetRef[]
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
    icloudAssetRefs?: IcloudAssetRef[]
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
      message?: string
      undo: TrashUndoData | null
    }
  | {
      kind: "failed"
      movedMediaKeys: []
      movedDedupKeys: []
      movedCount: 0
      error: string
      undo: null
    }

interface PendingTrash {
  operationId: string
  plan: DuplicateTrashPlan
  snapshot: TrashSnapshot
  context: TrashAuditContext
}

interface PendingRestore {
  requestId: string
  undo: TrashUndoData
}

interface RequestedTrashPair {
  mediaKey: string
  dedupKey: string
}

interface ConfirmedTrashKeys {
  movedMediaKeys: string[]
  movedDedupKeys: string[]
  responseHadIdentity: boolean
  responseHadUnrequestedIdentity: boolean
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string")
}

function confirmedTrashKeys(
  pending: PendingTrash,
  data: TrashProviderResultData | undefined
): ConfirmedTrashKeys {
  const pairs: RequestedTrashPair[] = pending.plan.dedupKeys.map(
    (dedupKey, index) => ({
      dedupKey,
      mediaKey: pending.plan.mediaKeysToTrash[index] ?? ""
    })
  )
  const requestedMedia = new Set(pairs.map((pair) => pair.mediaKey))
  const requestedDedup = new Set(pairs.map((pair) => pair.dedupKey))
  const reportedMedia = stringArray(data?.trashedKeys)
  const reportedDedup = stringArray(data?.trashedDedupKeys)
  const responseHadIdentity = Boolean(reportedMedia || reportedDedup)
  const responseHadUnrequestedIdentity = Boolean(
    reportedMedia?.some((key) => !requestedMedia.has(key)) ||
      reportedDedup?.some((key) => !requestedDedup.has(key))
  )
  const confirmedMedia = new Set(
    (reportedMedia ?? []).filter((key) => requestedMedia.has(key))
  )
  const confirmedDedup = new Set(
    (reportedDedup ?? []).filter((key) => requestedDedup.has(key))
  )

  // Provider adapters currently report both parallel identity lists. Accept a
  // partial error payload containing either list, but derive the paired
  // identity only from the exact pending request. This keeps a malformed or
  // reordered response from authorizing an unrelated item.
  const movedMediaKeys: string[] = []
  const movedDedupKeys: string[] = []
  for (const pair of pairs) {
    const mediaConfirmed =
      confirmedMedia.has(pair.mediaKey) ||
      (reportedMedia === undefined && confirmedDedup.has(pair.dedupKey))
    const dedupConfirmed =
      confirmedDedup.has(pair.dedupKey) ||
      (reportedDedup === undefined && confirmedMedia.has(pair.mediaKey))
    if (!mediaConfirmed || !dedupConfirmed) continue
    movedMediaKeys.push(pair.mediaKey)
    movedDedupKeys.push(pair.dedupKey)
  }

  return {
    movedMediaKeys,
    movedDedupKeys,
    responseHadIdentity,
    responseHadUnrequestedIdentity
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
    accountEmail?: string
    scopeFingerprint?: string
    scopeLabel?: string
  }): Promise<TrashCommand> {
    if (this.pending || this.beginInFlight) {
      throw new Error("Another trash operation is already pending.")
    }
    this.beginInFlight = true
    const operationId =
      params.operationId ??
      `gpd-cleanup-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`
    const context: TrashAuditContext = {
      operationId,
      provider: params.plan.provider,
      ...(params.accountEmail ? { accountEmail: params.accountEmail } : {}),
      ...(params.scopeFingerprint
        ? { scopeFingerprint: params.scopeFingerprint }
        : {}),
      ...(params.scopeLabel ? { scopeLabel: params.scopeLabel } : {}),
      attemptedDedupKeys: [...params.plan.dedupKeys],
      attemptedMediaKeys: [...params.plan.mediaKeysToTrash],
      ...(params.plan.icloudAssetRefs
        ? { icloudAssetRefs: params.plan.icloudAssetRefs }
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
        operationId,
        plan: {
          ...params.plan,
          dedupKeys: [...params.plan.dedupKeys],
          mediaKeysToTrash: [...params.plan.mediaKeysToTrash],
          blockedMediaKeys: [...params.plan.blockedMediaKeys],
          blockedGroupIds: [...params.plan.blockedGroupIds],
          ...(params.plan.icloudAssetRefs
            ? { icloudAssetRefs: [...params.plan.icloudAssetRefs] }
            : {})
        },
        snapshot: params.snapshot,
        context
      }

      return {
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
          ...(params.plan.icloudAssetRefs
            ? { icloudAssetRefs: [...params.plan.icloudAssetRefs] }
            : {})
        }
      }
    } finally {
      this.beginInFlight = false
    }
  }

  async reconcile(params: {
    success: boolean
    data?: TrashProviderResultData
    error?: string
  }): Promise<TrashOutcome> {
    const pending = this.pending
    if (!pending) {
      return {
        kind: "failed",
        movedMediaKeys: [],
        movedDedupKeys: [],
        movedCount: 0,
        error: "Trash response did not match a pending operation.",
        undo: null
      }
    }

    // Consume the authorization before awaiting persistence. A duplicated or
    // delayed provider reply must not replay a completed operation while the
    // first result report is still being saved.
    this.pending = null
    const attemptedMediaKeys = pending.plan.mediaKeysToTrash
    const attemptedDedupKeys = pending.plan.dedupKeys
    const confirmed = confirmedTrashKeys(pending, params.data)
    const movedMediaKeys = params.data?.dryRun
      ? []
      : confirmed.movedMediaKeys
    const movedDedupKeys = params.data?.dryRun
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

    await this.audit.saveTrashResultReport(
      buildTrashResultReport({
        operationId: pending?.operationId,
        attemptedMediaKeys,
        attemptedDedupKeys,
        movedMediaKeys,
        movedDedupKeys,
        retryAttempts: params.data?.retryAttempts,
        ...(responseError ? { error: responseError } : {})
      }),
      pending?.context
    )

    if (params.success && params.data?.dryRun) {
      const requestedCount =
        params.data.requestedCount ?? attemptedMediaKeys.length
      return {
        kind: "dry_run",
        movedMediaKeys: [],
        movedDedupKeys: [],
        movedCount: 0,
        message:
          params.data.message ??
          `iCloud delete dry-run completed for ${requestedCount.toLocaleString()} item${requestedCount === 1 ? "" : "s"}. Nothing was deleted.`,
        undo: null
      }
    }

    const movedCount = movedMediaKeys.length
    if (movedCount > 0) {
      const undo =
        pending && attemptedDedupKeys.length > 0
          ? {
              operationId: pending.operationId,
              provider: pending.plan.provider,
              dedupKeys: movedDedupKeys,
              count: movedCount,
              snapshot: pending.snapshot,
              ...(params.data?.icloudAssetRefs
                ? { icloudAssetRefs: params.data.icloudAssetRefs }
                : {}),
              ...(pending.context.accountEmail
                ? { accountEmail: pending.context.accountEmail }
                : {}),
              ...(pending.context.scopeFingerprint
                ? { scopeFingerprint: pending.context.scopeFingerprint }
                : {}),
              ...(pending.context.scopeLabel
                ? { scopeLabel: pending.context.scopeLabel }
                : {})
            }
          : null
      return {
        kind: params.success && !responseError ? "complete" : "partial",
        movedMediaKeys,
        movedDedupKeys,
        movedCount,
        ...(responseError
          ? {
              message: `Moved ${movedMediaKeys.length.toLocaleString()} item${movedMediaKeys.length === 1 ? "" : "s"} before trash failed. The provider response was incomplete or invalid: ${responseError}`
            }
          : {}),
        undo
      }
    }

    return {
      kind: "failed",
      movedMediaKeys: [],
      movedDedupKeys: [],
      movedCount: 0,
      error: responseError ?? error,
      undo: null
    }
  }

  beginRestore(
    undo: TrashUndoData,
    requestId: string
  ): {
    provider: PhotoProvider
    args: {
      dedupKeys: string[]
      icloudAssetRefs?: IcloudAssetRef[]
    }
  } {
    this.pendingRestore = { undo, requestId }
    return {
      provider: undo.provider,
      args: {
        dedupKeys: undo.dedupKeys,
        ...(undo.icloudAssetRefs
          ? { icloudAssetRefs: undo.icloudAssetRefs }
          : {})
      }
    }
  }

  reconcileRestore(params: {
    requestId: string
    success: boolean
  }): TrashUndoData | null | undefined {
    if (params.requestId !== this.pendingRestore?.requestId) return undefined
    const undo = this.pendingRestore.undo
    this.pendingRestore = null
    return params.success ? null : undo
  }

  reset(): void {
    this.pending = null
    this.pendingRestore = null
  }
}
