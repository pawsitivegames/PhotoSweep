import {
  createScanCheckpoint,
  canResumeScanCheckpoint,
  shouldOfferResume,
  updateScanCheckpoint,
  type ScanCheckpoint
} from "./scan-checkpoint"
import { canResumeCheckpoint, type Entitlement } from "./entitlement"
import {
  evaluateReviewPreflight,
  type ReviewPreflightInput,
  type ReviewPreflightResult
} from "./review-preflight"
import { isScanCoverage } from "./scan-coverage"
import {
  mergeCachedScanResults,
  reusableICloudSyncToken
} from "./scan-results"
import type { GpdMediaItem, ScanCoverage, ScanSettings } from "./types"

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

export class ScanLifecycle {
  private activeRequestId: string | null = null
  private activeCheckpoint: ScanCheckpoint | null = null
  private abortController: AbortController | null = null

  constructor(private readonly adapter: ScanLifecycleAdapter) {}

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
    this.abortController?.abort()
    this.abortController = this.createAbortController()
    this.activeRequestId = params.requestId
    this.activeCheckpoint = createScanCheckpoint({
      id: params.requestId,
      settings: params.settings,
      accountEmail: params.accountEmail,
      providerSessionId: params.providerSessionId,
      now: this.now()
    })
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
    this.abortController?.abort()
    this.abortController = this.createAbortController()
    this.activeRequestId = params.requestId
    this.activeCheckpoint = updateScanCheckpoint(
      {
        ...params.checkpoint,
        id: params.requestId,
        status: "active"
      },
      params.patch,
      this.now()
    )
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
    this.abortController = null
    this.activeRequestId = null
    return failed
  }

  async complete(requestId: string): Promise<boolean> {
    if (!this.isCurrent(requestId)) return false
    const provider = this.activeCheckpoint?.settings.sourceProvider
    this.abortController = null
    this.activeRequestId = null
    this.activeCheckpoint = null
    await this.adapter.clear(provider)
    return true
  }

  reset(): void {
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
