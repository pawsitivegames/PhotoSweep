import {
  DuplicateReviewSession,
  type DuplicateReviewSelections,
  type KeepDecisionProvenance,
  type StoredDuplicateReviewSelections
} from "./duplicate-review-session"
import { isKeepStrategy } from "./keep-strategy"
import { getProviderOperations } from "./provider-operations"
import { SCAN_CHECKPOINT_KEY, type ScanCheckpoint } from "./scan-checkpoint"
import { areScanResultsValid } from "./scan-results"
import {
  DEFAULT_SETTINGS,
  type PhotoProvider,
  type ScanSettings,
  type StoredState
} from "./types"
import { AsyncSerialQueue } from "./async-serial-queue"

export interface StoredReviewScopeAdapter {
  get(
    keys: string[],
    provider?: PhotoProvider
  ): Promise<Partial<StoredState>>
  set(
    values: Record<string, unknown>,
    provider?: PhotoProvider
  ): Promise<void>
  remove(keys: string[], provider?: PhotoProvider): Promise<void>
}

export interface StoredReviewScopePatch {
  settings?: ScanSettings
  checkpoint?: ScanCheckpoint | null
  scanResults?: StoredState["scanResults"] | null
  selections?: StoredDuplicateReviewSelections | null
}

export interface RestoredReviewScope {
  settings: ScanSettings
  checkpoint: ScanCheckpoint | null
  scanResults: StoredState["scanResults"] | null
  selections: DuplicateReviewSelections | null
  staleReviewRemoved: boolean
  identityPending: boolean
  cancelled: boolean
}

function hasDateRange(settings: ScanSettings): boolean {
  return Boolean(settings.dateRange?.from || settings.dateRange?.to)
}

function hasAlbumScope(settings: ScanSettings): boolean {
  return Boolean(settings.albumScope?.mediaKey)
}

function normalizeStoredSettings(settings: ScanSettings): ScanSettings {
  const isOldUntouchedDefault =
    settings.scanMode === "smart" &&
    settings.similarityThreshold === 0.99 &&
    (settings.smartWindowSec ?? 1) === 1 &&
    !hasDateRange(settings) &&
    !hasAlbumScope(settings) &&
    (settings.sourceProvider === undefined ||
      settings.sourceProvider === "google") &&
    settings.amazonBatchLimit === undefined &&
    settings.icloudBatchLimit === undefined &&
    settings.exactOnly === undefined &&
    settings.protectFavorites === undefined &&
    (settings.defaultKeepStrategy === undefined ||
      settings.defaultKeepStrategy === DEFAULT_SETTINGS.defaultKeepStrategy)
  if (isOldUntouchedDefault) return DEFAULT_SETTINGS
  return {
    ...settings,
    sourceProvider: settings.sourceProvider ?? "google",
    defaultKeepStrategy: isKeepStrategy(settings.defaultKeepStrategy)
      ? settings.defaultKeepStrategy
      : DEFAULT_SETTINGS.defaultKeepStrategy,
    exactOnly: settings.exactOnly ?? false,
    protectFavorites: settings.protectFavorites ?? true
  }
}

function deserializeSelections(
  value: unknown
): DuplicateReviewSelections | null {
  if (!value || typeof value !== "object") return null
  const raw = value as {
    selectedGroupIds?: unknown
    reviewedGroupIds?: unknown
    keptOverrides?: unknown
    keepDecisionProvenance?: unknown
  }
  const selectedGroupIds = Array.isArray(raw.selectedGroupIds)
    ? raw.selectedGroupIds.filter((id): id is string => typeof id === "string")
    : []
  const keptOverrides: Record<string, Set<string>> = {}
  if (raw.keptOverrides && typeof raw.keptOverrides === "object") {
    for (const [groupId, mediaKeys] of Object.entries(
      raw.keptOverrides as Record<string, unknown>
    )) {
      if (!Array.isArray(mediaKeys)) continue
      keptOverrides[groupId] = new Set(
        mediaKeys.filter((key): key is string => typeof key === "string")
      )
    }
  }
  const keepDecisionProvenance: Record<string, KeepDecisionProvenance> = {}
  if (
    raw.keepDecisionProvenance &&
    typeof raw.keepDecisionProvenance === "object"
  ) {
    for (const [groupId, value] of Object.entries(
      raw.keepDecisionProvenance as Record<string, unknown>
    )) {
      if (!value || typeof value !== "object") continue
      const provenance = value as {
        source?: unknown
        strategy?: unknown
      }
      if (
        provenance.source !== "manual" &&
        provenance.source !== "legacy_preserved" &&
        provenance.source !== "automatic"
      ) {
        continue
      }
      keepDecisionProvenance[groupId] = {
        source: provenance.source,
        ...(isKeepStrategy(provenance.strategy)
          ? { strategy: provenance.strategy }
          : {})
      }
    }
  }
  const reviewedGroupIds = Array.isArray(raw.reviewedGroupIds)
    ? raw.reviewedGroupIds.filter((id): id is string => typeof id === "string")
    : [...new Set([...selectedGroupIds, ...Object.keys(keptOverrides)])]
  return {
    selectedGroupIds: new Set(selectedGroupIds),
    reviewedGroupIds: new Set(reviewedGroupIds),
    keptOverrides,
    keepDecisionProvenance
  }
}

export class StoredReviewScope {
  private reviewWritesSuppressed = false
  private restoreSequence = 0
  private restoreTail: Promise<void> = Promise.resolve()
  private readonly storageQueue = new AsyncSerialQueue()

  constructor(private readonly adapter: StoredReviewScopeAdapter) {}

  restore(params: {
    fallbackSettings: ScanSettings
    hostProvider?: PhotoProvider | null
    accountEmail?: string
    providerSessionId?: string
    identityProvider?: PhotoProvider
    isCurrent?: () => boolean
  }): Promise<RestoredReviewScope> {
    const sequence = ++this.restoreSequence
    const pending = this.restoreTail.then(() =>
      this.storageQueue.run(() => this.restoreForSequence(params, sequence))
    )
    this.restoreTail = pending.then(
      () => undefined,
      () => undefined
    )
    return pending
  }

  private async restoreForSequence(
    params: {
      fallbackSettings: ScanSettings
      hostProvider?: PhotoProvider | null
      accountEmail?: string
      providerSessionId?: string
      identityProvider?: PhotoProvider
      isCurrent?: () => boolean
    },
    sequence: number
  ): Promise<RestoredReviewScope> {
    const stored = await this.adapter.get([
      "settings",
      "scanResults",
      "selections",
      SCAN_CHECKPOINT_KEY
    ])
    const restoredSettings = stored.settings
      ? normalizeStoredSettings(stored.settings)
      : params.fallbackSettings
    const settings = params.hostProvider
      ? {
          ...restoredSettings,
          sourceProvider: params.hostProvider,
          albumScope:
            (restoredSettings.sourceProvider ?? "google") ===
              params.hostProvider &&
            getProviderOperations(params.hostProvider).capabilities
              .albumScope === "supported"
              ? restoredSettings.albumScope
              : undefined
        }
      : restoredSettings
    const sourceProvider = settings.sourceProvider ?? "google"
    const isCurrent = () =>
      sequence === this.restoreSequence && params.isCurrent?.() !== false
    const cancelledResult = (): RestoredReviewScope => ({
      settings,
      checkpoint: null,
      scanResults: null,
      selections: null,
      staleReviewRemoved: false,
      identityPending: true,
      cancelled: true
    })
    if (!isCurrent()) return cancelledResult()
    const checkpoint = stored.scanCheckpoint ?? null
    const scanResultsProviderMatches =
      !stored.scanResults ||
      (stored.scanResults.sourceProvider ?? "google") === sourceProvider
    const checkpointProviderMatches =
      !checkpoint ||
      (checkpoint.settings.sourceProvider ?? "google") === sourceProvider
    const hasStoredReviewState = Boolean(
      stored.scanResults || stored.selections || checkpoint
    )
    const hasCurrentProviderStoredState = Boolean(
      (stored.scanResults && scanResultsProviderMatches) ||
        (checkpoint && checkpointProviderMatches) ||
        (stored.selections && !stored.scanResults && !checkpoint)
    )
    const identityMatchesProvider =
      params.identityProvider === sourceProvider ||
      (params.identityProvider === undefined &&
        (sourceProvider === "google"
          ? Boolean(params.accountEmail?.trim())
          : Boolean(params.providerSessionId?.trim())))
    const identityAvailable =
      identityMatchesProvider &&
      (sourceProvider === "google"
        ? Boolean(params.accountEmail?.trim())
        : Boolean(params.providerSessionId?.trim()))

    // Review data and checkpoints can contain private media metadata and
    // account-scoped decisions. Keep them in storage while the selected
    // provider identity is still loading, but do not hydrate them into app
    // state or sanitize/write their selections until that identity is known.
    if (
      hasStoredReviewState &&
      hasCurrentProviderStoredState &&
      !identityAvailable
    ) {
      return {
        settings,
        checkpoint: null,
        scanResults: null,
        selections: null,
        staleReviewRemoved: false,
        identityPending: true,
        cancelled: false
      }
    }

    const scanResultsValid =
      !stored.scanResults ||
      (scanResultsProviderMatches &&
        areScanResultsValid(stored.scanResults, {
          accountEmail: params.accountEmail,
          sourceProvider,
          providerSessionId: params.providerSessionId
        }))
    const checkpointValid =
      !checkpoint ||
      (checkpointProviderMatches &&
        areScanResultsValid(
          {
            accountEmail: checkpoint.accountEmail,
            sourceProvider,
            providerSessionId: checkpoint.providerSessionId
          },
          {
            accountEmail: params.accountEmail,
            sourceProvider,
            providerSessionId: params.providerSessionId
          }
        ))

    if (!scanResultsValid) {
      if (!isCurrent()) return cancelledResult()
      await this.invalidateReviewUnqueued(isCurrent, sourceProvider)
    }
    if (!checkpointValid) {
      if (!isCurrent()) return cancelledResult()
      await this.writeUnqueued(
        { checkpoint: null },
        isCurrent,
        sourceProvider
      )
    }
    if (!scanResultsValid) {
      return {
        settings,
        checkpoint: checkpointValid ? checkpoint : null,
        scanResults: null,
        selections: null,
        staleReviewRemoved: true,
        identityPending: false,
        cancelled: false
      }
    }

    const hasBoundReviewGroups = Boolean(
      stored.scanResults && Array.isArray(stored.scanResults.groups)
    )
    const orphanedSelections = Boolean(
      stored.selections && !hasBoundReviewGroups
    )
    if (orphanedSelections) {
      if (!isCurrent()) return cancelledResult()
      await this.writeUnqueued(
        { selections: null },
        isCurrent,
        sourceProvider
      )
    }

    const deserialized = hasBoundReviewGroups
      ? deserializeSelections(stored.selections)
      : null
    let selections = deserialized
    if (deserialized && hasBoundReviewGroups && stored.scanResults?.groups) {
      const session = new DuplicateReviewSession({
        groups: stored.scanResults.groups,
        mediaItems: stored.scanResults.mediaItems ?? {},
        selections: deserialized
      })
      selections = session.selections
      if (!isCurrent()) return cancelledResult()
      await this.writeUnqueued(
        { selections: session.serialize() },
        isCurrent,
        sourceProvider
      )
    }

    return {
      settings,
      checkpoint: checkpointValid ? checkpoint : null,
      scanResults: stored.scanResults ?? null,
      selections,
      staleReviewRemoved: !checkpointValid || orphanedSelections,
      identityPending: false,
      cancelled: false
    }
  }

  write(
    patch: StoredReviewScopePatch,
    isCurrent: () => boolean = () => true,
    provider?: PhotoProvider
  ): Promise<void> {
    return this.storageQueue.run(() =>
      this.writeUnqueued(patch, isCurrent, provider)
    )
  }

  private async writeUnqueued(
    patch: StoredReviewScopePatch,
    isCurrent: () => boolean,
    provider?: PhotoProvider
  ): Promise<void> {
    if (!isCurrent()) return
    const values: Record<string, unknown> = {}
    const remove: string[] = []

    const assign = (key: string, value: unknown): void => {
      if (value === undefined) return
      if (value === null) remove.push(key)
      else values[key] = value
    }
    assign("settings", patch.settings)
    assign(SCAN_CHECKPOINT_KEY, patch.checkpoint)
    if (!this.reviewWritesSuppressed || patch.scanResults === null) {
      assign("scanResults", patch.scanResults)
    }
    if (!this.reviewWritesSuppressed || patch.selections === null) {
      assign("selections", patch.selections)
    }

    if (Object.keys(values).length > 0) {
      if (!isCurrent()) return
      await this.adapter.set(values, provider)
    }
    if (remove.length > 0) {
      if (!isCurrent()) return
      await this.adapter.remove(remove, provider)
    }
  }

  invalidateReview(
    isCurrent: () => boolean = () => true,
    shouldInvalidate?: (stored: Partial<StoredState>) => boolean,
    provider?: PhotoProvider
  ): Promise<void> {
    return this.storageQueue.run(async () => {
      if (!isCurrent()) return
      if (shouldInvalidate) {
        const stored = await this.adapter.get(
          ["scanResults", "selections"],
          provider
        )
        if (!isCurrent() || !shouldInvalidate(stored)) return
      }
      await this.invalidateReviewUnqueued(isCurrent, provider)
    })
  }

  private async invalidateReviewUnqueued(
    isCurrent: () => boolean,
    provider?: PhotoProvider
  ): Promise<void> {
    if (!isCurrent()) return
    const previousSuppression = this.reviewWritesSuppressed
    this.reviewWritesSuppressed = true
    try {
      await this.writeUnqueued(
        { scanResults: null, selections: null },
        isCurrent,
        provider
      )
    } finally {
      if (!isCurrent()) {
        this.reviewWritesSuppressed = previousSuppression
      }
    }
  }

  startReview(): void {
    this.reviewWritesSuppressed = false
  }
}
