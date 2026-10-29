import {
  applyRememberedDecisions,
  type DecisionMemoryRecord
} from "./decision-memory"
import type {
  DetectionProgress,
  DuplicateDetectionRequest
} from "./duplicate-detector"
import {
  canResumeCheckpoint,
  limitScanItems,
  type Entitlement
} from "./entitlement"
import type { ProviderOperationRequest } from "./provider-operation-contract"
import { getProviderOperations } from "./provider-operations"
import { providerScanCancellationTarget } from "./provider-scan-cancellation"
import {
  accountFingerprint,
  buildScanScopeFingerprint,
  evaluateReviewPreflight,
  type ReviewPreflightInput,
  type ReviewPreflightResult
} from "./review-preflight"
import {
  canResumeScanCheckpoint,
  createScanCheckpoint,
  MAX_CHECKPOINT_MEDIA_ITEMS,
  shouldOfferResume,
  updateScanCheckpoint,
  type ScanCheckpoint
} from "./scan-checkpoint"
import { isScanCoverage } from "./scan-coverage"
import type { ScanLogger } from "./scan-log"
import {
  isValidICloudSyncToken,
  mergeCachedScanResults,
  reusableICloudSyncToken
} from "./scan-results"
import {
  APP_ID,
  type DuplicateGroup,
  type GpdMediaItem,
  type GptkResultMessage,
  type PhotoProvider,
  type ScanCoverage,
  type ScanSettings,
  type StoredState
} from "./types"

type ScanCheckpointPatch = Parameters<typeof updateScanCheckpoint>[1]

export interface ScanLifecycleAdapter {
  persist(checkpoint: ScanCheckpoint): Promise<void> | void
  clear(provider?: ScanSettings["sourceProvider"]): Promise<void> | void
  now?(): number
  createAbortController?(): AbortController
}

export interface BeginScanParams {
  requestId: string
  settings: ScanSettings
  accountEmail?: string
  providerSessionId?: string
}

export interface ResumeScanParams {
  requestId: string
  checkpoint: ScanCheckpoint
  patch: ScanCheckpointPatch
}

export interface ScanResumeIdentity {
  accountEmail?: string
  sourceProvider?: ScanSettings["sourceProvider"]
  providerSessionId?: string
}

export interface PreparedProviderScanResult {
  mediaItems: GpdMediaItem[]
  scanCoverage: ScanCoverage
}

type ICloudSyncCache = Parameters<typeof reusableICloudSyncToken>[0]
type ICloudSyncContext = Parameters<typeof reusableICloudSyncToken>[1]

export interface ScanCompletion {
  settings: ScanSettings
  accountEmail?: string
  providerSessionId?: string
  mediaItems: Record<string, GpdMediaItem>
  groups: DuplicateGroup[]
  totalItems: number
  itemsChecked: number
  scanDate: number
  scopeFingerprint: string
  scanCoverage?: ScanCoverage
  providerSyncToken?: string
  selections: ReturnType<typeof applyRememberedDecisions>
}

export type ScanLifecycleEvent =
  | { kind: "started"; checkpoint: ScanCheckpoint }
  | { kind: "requested"; settings: ScanSettings; requestId: string }
  | {
      kind: "media"
      items: GpdMediaItem[]
      lockedItemCount: number
      settings: ScanSettings
    }
  | { kind: "progress"; progress: DetectionProgress }
  | {
      kind: "partial"
      groups: DuplicateGroup[]
      mediaItems: Record<string, GpdMediaItem>
      totalItems: number
    }
  | { kind: "completing" }
  | { kind: "complete"; result: ScanCompletion }
  | {
      kind: "failed"
      error: string
      checkpoint: ScanCheckpoint | null
      scanCoverage?: ScanCoverage
    }

export interface ScanExecutionAdapter {
  loadCachedScanResults(params: {
    sourceProvider: PhotoProvider
    accountEmail?: string
    providerSessionId?: string
    isCurrent: () => boolean
  }): Promise<StoredState["scanResults"] | null>
  sendCommand(
    message: ProviderOperationRequest<"getAllMediaItems">
  ): Promise<unknown> | void
  cancelProvider(requestId: string, provider: PhotoProvider): void
  detect(request: DuplicateDetectionRequest): Promise<DuplicateGroup[]>
  currentIdentity(): ScanResumeIdentity
  entitlement(): Entitlement
  loadDecisions(): Promise<DecisionMemoryRecord[]>
  createLogger?(): ScanLogger
  onEvent(event: ScanLifecycleEvent): void
}

interface ScanAttempt extends BeginScanParams {
  signal: AbortSignal
  cachedItems?: Record<string, GpdMediaItem>
  providerResultAccepted: boolean
}

export function activeDateRange(
  dateRange: ScanSettings["dateRange"]
): ScanSettings["dateRange"] | undefined {
  return dateRange?.from || dateRange?.to ? dateRange : undefined
}

export function albumScopeForProvider(
  provider: PhotoProvider,
  albumScope: ScanSettings["albumScope"]
): ScanSettings["albumScope"] | undefined {
  return getProviderOperations(provider).capabilities.albumScope ===
    "supported" && albumScope?.mediaKey
    ? albumScope
    : undefined
}

function filterMediaItemsByDateRange(
  items: GpdMediaItem[],
  dateRange: ScanSettings["dateRange"]
): GpdMediaItem[] {
  if (!activeDateRange(dateRange)) return items
  const localDate = (value: string, end = false) => {
    const [year, month, day] = value.split("-").map(Number)
    return new Date(
      year,
      month - 1,
      day,
      end ? 23 : 0,
      end ? 59 : 0,
      end ? 59 : 0,
      end ? 999 : 0
    ).getTime()
  }
  const from = dateRange?.from
    ? localDate(dateRange.from)
    : Number.NEGATIVE_INFINITY
  const to = dateRange?.to
    ? localDate(dateRange.to, true)
    : Number.POSITIVE_INFINITY
  return items.filter(
    (item) =>
      Number.isFinite(item.timestamp) &&
      item.timestamp >= from &&
      item.timestamp <= to
  )
}

function mediaForGroups(
  items: GpdMediaItem[],
  groups: DuplicateGroup[]
): Record<string, GpdMediaItem> {
  const keys = new Set(groups.flatMap((group) => group.mediaKeys))
  return Object.fromEntries(
    items
      .filter((item) => keys.has(item.mediaKey))
      .map((item) => [item.mediaKey, item])
  )
}

export class ScanLifecycle {
  private activeRequestId: string | null = null
  private activeCheckpoint: ScanCheckpoint | null = null
  private abortController: AbortController | null = null
  private attempt: ScanAttempt | null = null

  constructor(
    private readonly adapter: ScanLifecycleAdapter,
    private readonly execution?: ScanExecutionAdapter
  ) {}

  async start(
    params: BeginScanParams & { batchLimit?: number }
  ): Promise<void> {
    const execution = this.requireExecution()
    const started = this.begin(params)
    const attempt = this.attempt!
    const settings = attempt.settings
    const sourceProvider = settings.sourceProvider ?? "google"
    const dateRange = activeDateRange(settings.dateRange)
    const albumScope = albumScopeForProvider(
      sourceProvider,
      settings.albumScope
    )
    execution.onEvent({ kind: "started", checkpoint: started.checkpoint })
    let sinceTimestamp: number | undefined
    let providerSyncToken: string | undefined
    let cachedTotalItems: number | undefined
    try {
      const previous = await execution.loadCachedScanResults({
        sourceProvider,
        accountEmail: attempt.accountEmail,
        providerSessionId: attempt.providerSessionId,
        isCurrent: () => this.isAttemptCurrent(attempt)
      })
      if (!this.isAttemptCurrent(attempt)) return
      const syncToken = previous
        ? reusableICloudSyncToken(previous, {
            sourceProvider,
            accountEmail: attempt.accountEmail,
            providerSessionId: attempt.providerSessionId
          })
        : undefined
      const usable =
        sourceProvider === "icloud"
          ? syncToken !== undefined
          : Boolean(
              previous?.mediaItems &&
              Object.keys(previous.mediaItems).length > 0 &&
              previous.mediaItemsAreComplete !== false &&
              Object.keys(previous.mediaItems).length === previous.totalItems
            )
      if (
        !dateRange &&
        !albumScope &&
        !params.batchLimit &&
        !previous?.dateRange &&
        !previous?.albumScope &&
        previous?.mediaItems &&
        usable
      ) {
        attempt.cachedItems = previous.mediaItems
        providerSyncToken = syncToken
        cachedTotalItems = Number.isSafeInteger(previous.totalItems)
          ? previous.totalItems
          : undefined
        sinceTimestamp =
          sourceProvider === "icloud"
            ? undefined
            : (previous.scanWatermarkTimestamp ??
              previous.newestCreationTimestamp ??
              Object.values(previous.mediaItems).reduce(
                (max, item) =>
                  Number.isFinite(item.creationTimestamp)
                    ? Math.max(max, item.creationTimestamp)
                    : max,
                0
              ))
      }
    } catch {
      // An unavailable cache falls back to a full provider traversal.
    }
    if (!this.isAttemptCurrent(attempt)) return
    execution.onEvent({
      kind: "requested",
      settings,
      requestId: attempt.requestId
    })
    try {
      await execution.sendCommand({
        app: APP_ID,
        action: "gptkCommand",
        command: "getAllMediaItems",
        requestId: attempt.requestId,
        provider: sourceProvider,
        args: {
          dateRange,
          albumScope,
          sinceTimestamp,
          ...(providerSyncToken ? { providerSyncToken, cachedTotalItems } : {}),
          limit: params.batchLimit,
          scanScopeFingerprint: buildScanScopeFingerprint(settings),
          ...(attempt.accountEmail
            ? { accountEmail: attempt.accountEmail }
            : {}),
          ...(attempt.providerSessionId
            ? { providerSessionId: attempt.providerSessionId }
            : {})
        }
      })
    } catch (error) {
      this.failExecution(attempt, String(error))
    }
  }

  async acceptProviderResult(result: GptkResultMessage): Promise<void> {
    const attempt = this.attempt
    if (
      !attempt ||
      !this.isCurrent(result.requestId) ||
      attempt.providerResultAccepted
    )
      return
    const execution = this.requireExecution()
    const provider = attempt.settings.sourceProvider ?? "google"
    const identity = execution.currentIdentity()
    if (
      !result.providerSessionId ||
      result.providerSessionId !== attempt.providerSessionId ||
      result.providerSessionId !== identity.providerSessionId ||
      (identity.sourceProvider !== undefined &&
        identity.sourceProvider !== provider) ||
      (attempt.accountEmail !== undefined &&
        identity.accountEmail !== attempt.accountEmail)
    ) {
      this.reset()
      execution.onEvent({
        kind: "failed",
        checkpoint: null,
        error:
          "The provider page session changed during the scan. Its results were discarded; reconnect and run a fresh scan."
      })
      return
    }
    attempt.providerResultAccepted = true
    if (!result.success) {
      this.failExecution(
        attempt,
        result.error || "Scan failed",
        this.isCoverage(result.scanCoverage) ? result.scanCoverage : undefined
      )
      return
    }
    const prepared = this.prepareProviderResult(
      result.data,
      result.scanCoverage,
      attempt.cachedItems
    )
    attempt.cachedItems = undefined
    if (!prepared) {
      this.failExecution(
        attempt,
        "The provider did not return a valid scan coverage report. Reload its tab and scan again."
      )
      return
    }
    const limited = limitScanItems(
      filterMediaItemsByDateRange(
        prepared.mediaItems,
        attempt.settings.dateRange
      ),
      execution.entitlement()
    )
    execution.onEvent({ kind: "media", ...limited, settings: attempt.settings })
    this.patch(
      {
        phase: "downloading_thumbnails",
        itemsProcessed: 0,
        totalEstimate: limited.items.length,
        message: `Found ${limited.items.length} photos and videos. Loading previews...`,
        scanCoverage: prepared.scanCoverage,
        mediaItems:
          limited.items.length <= MAX_CHECKPOINT_MEDIA_ITEMS
            ? limited.items
            : undefined
      },
      result.requestId
    )
    const coverage = prepared.scanCoverage
    const syncToken =
      provider === "icloud" &&
      isValidICloudSyncToken(result.providerSyncToken) &&
      coverage.status === "complete" &&
      ["exhausted", "watermark_reached", "changes_caught_up"].includes(
        coverage.stopReason
      ) &&
      !activeDateRange(attempt.settings.dateRange) &&
      !albumScopeForProvider(provider, attempt.settings.albumScope) &&
      limited.lockedItemCount === 0
        ? result.providerSyncToken
        : undefined
    await this.detect(attempt, limited.items, coverage, syncToken)
  }

  async resumeDetection(params: ResumeScanParams): Promise<void> {
    const execution = this.requireExecution()
    const resumed = this.resume(params)
    const attempt = this.attempt!
    attempt.providerResultAccepted = true
    execution.onEvent({ kind: "started", checkpoint: resumed.checkpoint })
    const items = params.checkpoint.mediaItems ?? []
    execution.onEvent({
      kind: "media",
      items,
      lockedItemCount: 0,
      settings: attempt.settings
    })
    await this.detect(attempt, items, params.checkpoint.scanCoverage)
  }

  private async detect(
    attempt: ScanAttempt,
    items: GpdMediaItem[],
    scanCoverage?: ScanCoverage,
    providerSyncToken?: string
  ): Promise<void> {
    const execution = this.requireExecution()
    const logger = execution.createLogger?.()
    try {
      await logger?.start(items.length)
      if (!this.isAttemptCurrent(attempt)) return
      const settings = attempt.settings
      const provider = settings.sourceProvider ?? "google"
      const groups = await execution.detect({
        mode: settings.scanMode,
        mediaItems: items,
        threshold: settings.similarityThreshold,
        smartWindowMs: (settings.smartWindowSec ?? 1) * 1000,
        signal: attempt.signal,
        logger,
        cacheNamespace: `${provider}:${accountFingerprint(attempt.accountEmail) ?? attempt.providerSessionId ?? attempt.requestId}`,
        onProgress: (progress) => {
          if (!this.isAttemptCurrent(attempt)) return
          this.patch(
            {
              phase: progress.phase,
              itemsProcessed: progress.current,
              totalEstimate: progress.total,
              message: `${progress.phase}: ${progress.current}/${progress.total}`
            },
            attempt.requestId
          )
          execution.onEvent({ kind: "progress", progress })
        },
        onPartialGroups: (partialGroups) => {
          if (this.isAttemptCurrent(attempt))
            execution.onEvent({
              kind: "partial",
              groups: partialGroups,
              mediaItems: mediaForGroups(items, partialGroups),
              totalItems: items.length
            })
        }
      })
      if (!this.isAttemptCurrent(attempt)) return
      await logger?.finalize("complete", { groupsFound: groups.length })
      if (!this.isAttemptCurrent(attempt)) return
      const mediaItems = mediaForGroups(items, groups)
      const records = await execution.loadDecisions()
      if (!this.isAttemptCurrent(attempt)) return
      const scanDate = this.now()
      const selections = applyRememberedDecisions({
        records,
        groups,
        mediaItems,
        provider,
        accountEmail: attempt.accountEmail,
        now: scanDate
      })
      execution.onEvent({ kind: "completing" })
      if (
        !(await this.complete(attempt.requestId)) ||
        !this.isAttemptCurrent(attempt)
      )
        return
      execution.onEvent({
        kind: "complete",
        result: {
          settings,
          accountEmail: attempt.accountEmail,
          providerSessionId: attempt.providerSessionId,
          groups,
          mediaItems,
          itemsChecked: items.length,
          totalItems:
            provider === "icloud" &&
            (scanCoverage?.stopReason === "watermark_reached" ||
              scanCoverage?.stopReason === "changes_caught_up") &&
            Number.isSafeInteger(scanCoverage.totalItems)
              ? scanCoverage.totalItems!
              : items.length,
          scanDate,
          scanCoverage,
          providerSyncToken,
          scopeFingerprint: buildScanScopeFingerprint(settings),
          selections
        }
      })
    } catch (error) {
      if (!this.isAttemptCurrent(attempt)) return
      if (error instanceof DOMException && error.name === "AbortError") {
        await logger?.finalize("paused")
        if (this.isAttemptCurrent(attempt)) this.pause(attempt.requestId)
      } else {
        await logger?.finalize("error", { error: String(error) })
        this.failExecution(attempt, `Duplicate detection failed: ${error}`)
      }
    }
  }

  private failExecution(
    attempt: ScanAttempt,
    error: string,
    scanCoverage?: ScanCoverage
  ): void {
    if (!this.isAttemptCurrent(attempt)) return
    const checkpoint = this.patch(
      { status: "error", error, message: error },
      attempt.requestId
    )
    this.abortController?.abort()
    this.abortController = null
    this.activeRequestId = null
    this.execution?.onEvent({ kind: "failed", checkpoint, error, scanCoverage })
  }

  private isAttemptCurrent(attempt: ScanAttempt): boolean {
    if (this.attempt !== attempt || attempt.signal.aborted) return false
    const identity = this.execution?.currentIdentity()
    return (
      !identity ||
      ((identity.sourceProvider === undefined ||
        identity.sourceProvider ===
          (attempt.settings.sourceProvider ?? "google")) &&
        (attempt.providerSessionId === undefined ||
          identity.providerSessionId === attempt.providerSessionId) &&
        (attempt.accountEmail === undefined ||
          identity.accountEmail === attempt.accountEmail))
    )
  }

  private requireExecution(): ScanExecutionAdapter {
    if (!this.execution) throw new Error("Scan execution adapter is required")
    return this.execution
  }

  private cancelProvider(): void {
    const target = providerScanCancellationTarget(
      this.activeCheckpoint,
      this.activeRequestId
    )
    if (target)
      this.execution?.cancelProvider(target.requestId, target.provider)
  }

  get requestId(): string | null {
    return this.activeRequestId
  }

  get checkpoint(): ScanCheckpoint | null {
    return this.activeCheckpoint
  }

  get signal(): AbortSignal | null {
    return this.abortController?.signal ?? null
  }

  canOfferResume(
    checkpoint: ScanCheckpoint | null | undefined,
    identity: ScanResumeIdentity
  ): checkpoint is ScanCheckpoint {
    return (
      shouldOfferResume(checkpoint) &&
      canResumeScanCheckpoint(checkpoint, identity)
    )
  }

  canResumeWithinEntitlement(
    checkpoint: ScanCheckpoint,
    entitlement: Entitlement | null | undefined
  ): boolean {
    return canResumeCheckpoint(checkpoint, entitlement)
  }

  isCoverage(value: unknown): value is ScanCoverage {
    return isScanCoverage(value)
  }

  prepareProviderResult(
    mediaItems: unknown,
    scanCoverage: unknown,
    cachedMediaItems?: Record<string, GpdMediaItem>
  ): PreparedProviderScanResult | null {
    if (
      !Array.isArray(mediaItems) ||
      !isScanCoverage(scanCoverage) ||
      scanCoverage.itemsReturned !== mediaItems.length
    ) {
      return null
    }
    const reusableCache =
      cachedMediaItems && Object.keys(cachedMediaItems).length > 0
        ? cachedMediaItems
        : undefined
    return {
      mediaItems: mergeCachedScanResults(
        mediaItems as GpdMediaItem[],
        reusableCache,
        scanCoverage
      ),
      scanCoverage
    }
  }

  reusableICloudSyncToken(
    stored: ICloudSyncCache,
    context: ICloudSyncContext
  ): string | undefined {
    return reusableICloudSyncToken(stored, context)
  }

  reviewPreflight(input: ReviewPreflightInput): ReviewPreflightResult {
    return evaluateReviewPreflight(input)
  }

  begin(params: BeginScanParams): {
    checkpoint: ScanCheckpoint
    signal: AbortSignal
  } {
    this.cancelProvider()
    this.abortController?.abort()
    this.abortController = this.createAbortController()
    this.activeRequestId = params.requestId
    this.activeCheckpoint = createScanCheckpoint({
      id: params.requestId,
      settings: structuredClone(params.settings),
      accountEmail: params.accountEmail,
      providerSessionId: params.providerSessionId,
      now: this.now()
    })
    this.attempt = {
      ...params,
      settings: this.activeCheckpoint.settings,
      signal: this.abortController.signal,
      providerResultAccepted: false
    }
    void this.adapter.persist(this.activeCheckpoint)
    return {
      checkpoint: this.activeCheckpoint,
      signal: this.abortController.signal
    }
  }

  resume(params: ResumeScanParams): {
    checkpoint: ScanCheckpoint
    signal: AbortSignal
  } {
    this.cancelProvider()
    this.abortController?.abort()
    this.abortController = this.createAbortController()
    this.activeRequestId = params.requestId
    this.activeCheckpoint = updateScanCheckpoint(
      {
        ...params.checkpoint,
        settings: structuredClone(params.checkpoint.settings),
        id: params.requestId,
        status: "active"
      },
      params.patch,
      this.now()
    )
    this.attempt = {
      requestId: params.requestId,
      settings: this.activeCheckpoint.settings,
      accountEmail: this.activeCheckpoint.accountEmail,
      providerSessionId: this.activeCheckpoint.providerSessionId,
      signal: this.abortController.signal,
      providerResultAccepted: false
    }
    void this.adapter.persist(this.activeCheckpoint)
    return {
      checkpoint: this.activeCheckpoint,
      signal: this.abortController.signal
    }
  }

  restore(
    checkpoint: ScanCheckpoint | null,
    interruptedMessage = "Previous scan was interrupted. Resume to reuse completed cached embeddings."
  ): ScanCheckpoint | null {
    this.cancelProvider()
    this.attempt = null
    this.abortController?.abort()
    this.abortController = null
    this.activeRequestId = null
    this.activeCheckpoint =
      checkpoint?.status === "active"
        ? updateScanCheckpoint(
            checkpoint,
            { status: "interrupted", message: interruptedMessage },
            this.now()
          )
        : checkpoint
    if (checkpoint?.status === "active" && this.activeCheckpoint) {
      void this.adapter.persist(this.activeCheckpoint)
    }
    return this.activeCheckpoint
  }

  isCurrent(requestId: string): boolean {
    return this.activeRequestId === requestId
  }

  patch(patch: ScanCheckpointPatch, requestId?: string): ScanCheckpoint | null {
    if (!this.activeCheckpoint) return null
    if (requestId && this.activeCheckpoint.id !== requestId) return null
    this.activeCheckpoint = updateScanCheckpoint(
      this.activeCheckpoint,
      patch,
      this.now()
    )
    void this.adapter.persist(this.activeCheckpoint)
    return this.activeCheckpoint
  }

  pause(requestId?: string): ScanCheckpoint | null {
    if (requestId && !this.isCurrent(requestId)) return null
    this.cancelProvider()
    const paused =
      this.activeCheckpoint?.status === "active"
        ? this.patch(
            {
              status: "interrupted",
              message:
                "Scan paused. Resume to reuse completed cached embeddings."
            },
            requestId
          )
        : this.activeCheckpoint
    this.abortController?.abort()
    this.abortController = null
    this.activeRequestId = null
    return paused
  }

  fail(requestId: string, error: unknown): ScanCheckpoint | null {
    if (!this.isCurrent(requestId)) return null
    const message = String(error)
    const failed = this.patch(
      {
        status: "error",
        error: message,
        message: `Duplicate detection failed: ${message}`
      },
      requestId
    )
    this.abortController?.abort()
    this.abortController = null
    this.activeRequestId = null
    return failed
  }

  async complete(requestId: string): Promise<boolean> {
    if (!this.isCurrent(requestId)) return false
    const attempt = this.attempt
    const provider = this.activeCheckpoint?.settings.sourceProvider
    this.abortController = null
    this.activeRequestId = null
    this.activeCheckpoint = null
    await this.adapter.clear(provider)
    return this.attempt === attempt
  }

  reset(): void {
    this.cancelProvider()
    this.attempt = null
    const provider = this.activeCheckpoint?.settings.sourceProvider
    this.abortController?.abort()
    this.abortController = null
    this.activeRequestId = null
    this.activeCheckpoint = null
    void this.adapter.clear(provider)
  }

  private now(): number {
    return this.adapter.now?.() ?? Date.now()
  }

  private createAbortController(): AbortController {
    return this.adapter.createAbortController?.() ?? new AbortController()
  }
}
