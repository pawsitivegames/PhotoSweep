// Shared message types for communication between extension components.
// All messages include `app: "GPD"` to filter out unrelated messages.

import type { KeepStrategy } from "./keep-strategy"

export const APP_ID = "GPD" as const

/** Public, non-secret identity for the exact packaged extension build. */
export interface RuntimeBuildIdentity {
  extensionId: string
  packageVersion: string
  buildId: string
}

// ============================================================
// Base message type
// ============================================================

interface BaseMessage {
  app: typeof APP_ID
  clientId?: string
  runtimeBuildIdentity?: RuntimeBuildIdentity
}

// ============================================================
// Service worker <-> App tab messages
// ============================================================

export interface LaunchAppMessage extends BaseMessage {
  action: "launchApp"
}

export interface LaunchProviderMessage extends BaseMessage {
  action: "launchProvider"
  provider?: PhotoProvider
  hostTabId?: number
}

export interface LaunchProviderResult {
  success: boolean
  provider: PhotoProvider
  tabId?: number
  alreadyOpen?: boolean
  error?: string
}

export interface HealthCheckMessage extends BaseMessage {
  action: "healthCheck"
  provider?: PhotoProvider
  requestId?: string
}

export const PROVIDER_HEALTH_SCHEMA_VERSION = 1 as const
export const PROVIDER_HEALTH_CONTRACT_VERSION = "provider-parity-v1" as const

export type ProviderHealthStatus = "ready" | "unavailable"

/**
 * Bounded, non-sensitive adapter health evidence. Providers must never put
 * cookies, account identifiers, media IDs, or response bodies in this value.
 */
export interface ProviderHealthSnapshot {
  schemaVersion: typeof PROVIDER_HEALTH_SCHEMA_VERSION
  contractVersion: typeof PROVIDER_HEALTH_CONTRACT_VERSION
  provider: PhotoProvider
  status: ProviderHealthStatus
  checks: {
    page: boolean
    session: boolean
    readPath: boolean
  }
}

export function isProviderHealthSnapshot(
  value: unknown,
  provider?: PhotoProvider
): value is ProviderHealthSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }
  const candidate = value as Record<string, unknown>
  const checks = candidate.checks
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) {
    return false
  }
  const checkRecord = checks as Record<string, unknown>
  const validProvider =
    candidate.provider === "google" ||
    candidate.provider === "icloud" ||
    candidate.provider === "amazon"
  const validStatus =
    candidate.status === "ready" || candidate.status === "unavailable"
  const checksAreBoolean =
    typeof checkRecord.page === "boolean" &&
    typeof checkRecord.session === "boolean" &&
    typeof checkRecord.readPath === "boolean"
  if (
    candidate.schemaVersion !== PROVIDER_HEALTH_SCHEMA_VERSION ||
    candidate.contractVersion !== PROVIDER_HEALTH_CONTRACT_VERSION ||
    !validProvider ||
    (provider !== undefined && candidate.provider !== provider) ||
    !validStatus ||
    !checksAreBoolean
  ) {
    return false
  }
  return (
    candidate.status !== "ready" ||
    (checkRecord.page === true &&
      checkRecord.session === true &&
      checkRecord.readPath === true)
  )
}

export interface HealthCheckResultMessage extends BaseMessage {
  action: "healthCheck.result"
  success: boolean
  hasGptk: boolean
  provider?: PhotoProvider
  requestId?: string
  accountEmail?: string
  /** User-visible label only; never used as a provider account identifier. */
  accountDisplayName?: string
  /** Opaque document-session marker for providers without a stable account ID. */
  providerSessionId?: string
  health?: ProviderHealthSnapshot
  error?: string
}

export interface ProviderCommandPublicKey {
  kty: "EC"
  x: string
  y: string
  crv: "P-256"
}

export interface ProviderCommandKeyMessage extends BaseMessage {
  action: "providerCommandKey"
}

export interface ProviderCommandKeyResultMessage extends BaseMessage {
  action: "providerCommandKey.result"
  publicKey?: ProviderCommandPublicKey
  error?: string
}

// ============================================================
// Scan workflow messages
// ============================================================

export interface ScanLibraryMessage extends BaseMessage {
  action: "scanLibrary"
  options: ScanOptions
}

export type ScanMode = "smart" | "full"
export type PhotoProvider = "google" | "icloud" | "amazon"

/**
 * Evidence used to establish byte/content identity. Provider asset IDs and
 * legacy exactContentHash values are intentionally not part of this contract.
 */
export type ContentHashAlgorithm = "md5" | "sha256" | "provider-fingerprint"

export type ContentHashVerificationSource =
  | "local-original-bytes"
  | "provider-fingerprint"
  | "provider-checksum"

export interface ContentHashEvidence {
  value: string
  algorithm: ContentHashAlgorithm
  provenance: "original-content"
  /** How the evidence was established; absent only on legacy stored records. */
  verificationSource?: ContentHashVerificationSource
  /** `paired-live-photo` is valid only for a digest covering the associated still and motion originals. */
  contentRole?: "single-file" | "live-photo-still" | "live-photo-motion" | "paired-live-photo"
}

export type MediaKind = "photo" | "video" | "live-photo" | "unknown"
export type TimestampProvenance =
  | "capture"
  | "creation"
  | "modified"
  | "unknown"
export type CreationTimestampProvenance =
  | "creation"
  | "modified"
  | "capture"
  | "unknown"
export type FavoriteStatus = "favorite" | "not-favorite" | "unknown"
export type FavoriteSource =
  | "provider-metadata"
  | "provider-lookup"
  | "unavailable"
export type VideoPlaybackCapability = "available" | "unavailable" | "unknown"

/** Exact per-target effect state returned by Trash/restore adapters. */
export interface MutationOutcome {
  operation: "trash" | "restore"
  /** Stable request identity, normally the target's dedupKey. */
  targetKey: string
  status: "confirmed" | "failed" | "unknown"
  reason?: string
}

/** Confidence is separate from a relationship such as RAW/JPEG or same asset. */
export type DuplicateEvidenceLevel =
  | "verified_identical"
  | "strong_duplicate_candidate"
  | "similar"

export type DuplicateRelationship =
  | "same_provider_asset"
  | "related_format_edit"

export interface ScanOptions {
  similarityThreshold: number // 0.80 - 1.00
  scanMode: ScanMode
  dateRange?: {
    /** Inclusive ISO calendar date in the browser's local timezone. */
    from?: string
    /** Inclusive ISO calendar date in the browser's local timezone. */
    to?: string
  }
  albumScope?: ScanAlbumScope
}

export type ScanCoverageStopReason =
  | "exhausted"
  | "user_limit"
  | "cancelled"
  | "loaded_items_only"
  | "auth_expired"
  | "provider_error"
  | "pagination_error"
  | "watermark_reached"
  | "changes_caught_up"
  | "coverage_unknown"

interface ScanCoverageCounts {
  /** Provider records or loaded candidates examined by this attempt. */
  itemsVisited: number
  /** Normalized media items returned to the shared review flow. */
  itemsReturned: number
  /** Examined records omitted from the returned media items. */
  itemsSkipped: number
  /** Records skipped because their timestamp was absent or invalid in a date-scoped scan. */
  unknownDateItemsSkipped: number
  /** Provider records that could not be normalized into review items. */
  unmappedItemsSkipped?: number
  /** Exact provider total for this scope, when the provider supplies one. */
  totalItems?: number
  /** Media types the adapter actually covered in this scan attempt. */
  mediaTypesCovered: { photos: boolean; videos: boolean }
  /** True only when a durable extension checkpoint can resume this scan. */
  canResume: boolean
  /** Number of provider pages successfully read for this scan attempt. */
  pagesRead?: number
  /** Logical item counts returned by each provider page, in read order. */
  pageSizes?: number[]
}

export type ScanCoverage =
  | (ScanCoverageCounts & {
      status: "complete"
      stopReason: "exhausted" | "watermark_reached" | "changes_caught_up"
    })
  | (ScanCoverageCounts & {
      status: "partial"
      stopReason: Exclude<
        ScanCoverageStopReason,
        "exhausted" | "watermark_reached" | "changes_caught_up"
      >
    })
  | (ScanCoverageCounts & {
      status: "failed"
      stopReason: "auth_expired" | "provider_error" | "pagination_error"
    })

export interface ScanProgressMessage extends BaseMessage {
  action: "scanLibrary.progress"
  phase: ScanPhase
  itemsProcessed: number
  totalEstimate: number
  message?: string
}

export type ScanPhase =
  | "fetching"
  | "downloading_thumbnails"
  | "computing_embeddings"
  | "detecting_duplicates"
  | "complete"

export interface ScanResultMessage extends BaseMessage {
  action: "scanLibrary.result"
  success: boolean
  error?: string
  mediaItems?: GpdMediaItem[]
  groups?: DuplicateGroup[]
  scanCoverage?: ScanCoverage
}

export interface CancelScanMessage extends BaseMessage {
  action: "cancelScan"
}

// ============================================================
// Trash workflow messages
// ============================================================

export interface TrashItemsMessage extends BaseMessage {
  action: "trashItems"
  dedupKeys: string[]
}

export interface TrashItemsResultMessage extends BaseMessage {
  action: "trashItems.result"
  success: boolean
  trashedCount: number
  error?: string
}

// ============================================================
// GPTK command messages (service worker <-> GP tab via bridge)
// ============================================================

export interface GptkCommandMessage extends BaseMessage {
  action: "gptkCommand"
  command: string
  args?: unknown
  requestId: string
  provider?: PhotoProvider
  capability?: {
    payload: string
    signature: string
  }
}

export type GptkResultErrorCode = "unsupported_capability"

export interface GptkResultMessage extends BaseMessage {
  action: "gptkResult"
  command: string
  requestId: string
  /** Stamped by the trusted extension worker from the routed provider tab. */
  provider?: PhotoProvider
  success: boolean
  data?: unknown
  /** Opaque provider page-session marker; never an account credential. */
  providerSessionId?: string
  /** Opaque iCloud zone cursor; only persisted with a complete session-bound scan. */
  providerSyncToken?: string
  error?: string
  errorCode?: GptkResultErrorCode
  scanCoverage?: ScanCoverage
}

export interface GptkProgressMessage extends BaseMessage {
  action: "gptkProgress"
  requestId: string
  itemsProcessed: number
  message?: string
  /** Set by batch operations (e.g. "trashItems") so the app can route progress correctly. */
  command?: string
  data?: unknown
}

export interface GptkLogMessage extends BaseMessage {
  action: "gptkLog"
  level: "info" | "error" | "success"
  message: string
}

/** One-use, exact-item Google original-byte fetch request from the provider page.
 * The signed resource URL stays in flight only and must never be logged/stored. */
export interface ProviderOriginalHashFetchMessage extends BaseMessage {
  action: "providerOriginalHash.fetch"
  requestId: string
  provider: "google"
  providerSessionId: string
  scanScopeFingerprint: string
  mediaKey: string
  resourceUrl: string
  mediaKind: Extract<MediaKind, "photo" | "video" | "live-photo">
  maxBytes: number
  aggregateBudgetBytes: number
}

/** Cancel only the exact in-flight provider original fetch. */
export interface ProviderOriginalHashCancelMessage extends BaseMessage {
  action: "providerOriginalHash.cancel"
  requestId: string
  provider: "google"
  providerSessionId: string
  scanScopeFingerprint: string
  mediaKey: string
}

export interface ProviderOriginalHashRelayResponse {
  requestId: string
  providerSessionId: string
  scanScopeFingerprint: string
  mediaKey: string
  success: boolean
  data?: {
    mediaKey: string
    scopeFingerprint: string
    contentHash: ContentHashEvidence
    byteLength: number
    mimeType: string
  }
  error?: string
}

/**
 * Full recovery-history transactions run in the background worker so app tabs
 * cannot race read/modify/write updates to the same extension storage value.
 */
export type RecoveryHistoryTransaction =
  | { kind: "read" }
  | { kind: "clear" }
  | { kind: "createPendingTrash"; report: unknown; context: unknown }
  | { kind: "recordTrashResult"; report: unknown; context: unknown }
  | {
      kind: "beginRestore"
      operationId: string
      requestId: string
      provider: PhotoProvider
      providerSessionId: string
      accountEmail?: string
      targetDedupKeys: string[]
    }
  | {
      kind: "updateRestore"
      operationId: string
      requestId: string
      provider: PhotoProvider
      providerSessionId: string
      accountEmail?: string
      params: unknown
    }

export interface RecoveryHistoryTransactionMessage extends BaseMessage {
  action: "recoveryHistory.transaction"
  transactionId: string
  transaction: RecoveryHistoryTransaction
}

export interface RecoveryHistoryTransactionResponse {
  action: "recoveryHistory.transaction.result"
  transactionId: string
  success: boolean
  operationId?: string
  requestId?: string
  targetDedupKeys?: string[]
  records?: unknown
  error?: string
}

// ============================================================
// Union types
// ============================================================

export type AppMessage =
  | LaunchAppMessage
  | LaunchProviderMessage
  | HealthCheckMessage
  | HealthCheckResultMessage
  | ProviderCommandKeyMessage
  | ProviderCommandKeyResultMessage
  | ScanLibraryMessage
  | ScanProgressMessage
  | ScanResultMessage
  | CancelScanMessage
  | TrashItemsMessage
  | TrashItemsResultMessage
  | GptkCommandMessage
  | GptkResultMessage
  | GptkProgressMessage
  | GptkLogMessage
  | ProviderOriginalHashFetchMessage
  | ProviderOriginalHashCancelMessage
  | RecoveryHistoryTransactionMessage

// ============================================================
// Data types
// ============================================================

/** Simplified media item for our UI (derived from GPTK's MediaItem) */
export interface GpdMediaItem {
  mediaKey: string
  dedupKey: string
  /** @deprecated Legacy provider metadata; never establishes verified identity by itself. */
  exactContentHash?: string
  contentHash?: ContentHashEvidence
  /** Safe metadata retained with a verified original-byte digest. */
  originalByteLength?: number
  originalMimeType?: string
  thumb: string // bare thumbnail URL; use buildThumbUrl() for sized renditions
  productUrl?: string // link to item in the provider's web app
  provider?: PhotoProvider
  sequenceIndex?: number // provider list order, used as a smart-scan neighbor hint
  timestamp: number // taken date
  timestampProvenance?: TimestampProvenance
  creationTimestamp: number // upload date
  creationTimestampProvenance?: CreationTimestampProvenance
  mediaKind?: MediaKind
  mimeType?: string
  resWidth?: number
  resHeight?: number
  fileName?: string
  size?: number
  takesUpSpace?: boolean | null
  spaceTaken?: number
  isOwned?: boolean
  /** Legacy projection; omitted when the provider has not supplied a boolean. */
  isFavorite?: boolean
  favoriteStatus?: FavoriteStatus
  favoriteSource?: FavoriteSource
  isOriginalQuality?: boolean | null
  /** Canonical video duration in milliseconds; absent for photos or unknown units. */
  duration?: number
  videoPlaybackCapability?: VideoPlaybackCapability
  /** Provider-stable link only; never derive from adjacency or isLivePhoto alone. */
  livePhotoAssociationId?: string
  // iCloud only: the CPLAsset record ref needed to trash/recover via CloudKit
  // records/modify. changeTag is captured at scan time; if it goes stale before
  // trash (rare: the asset was edited elsewhere), the modify fails closed and
  // nothing is deleted.
  icloudAsset?: {
    recordName: string
    changeTag: string
    zoneName: string
    ownerRecordName: string
  }
}

export interface GpdAlbum {
  mediaKey: string
  title: string
  itemCount?: number
  isShared?: boolean
  thumb?: string
}

export interface DuplicateGroup {
  id: string
  mediaKeys: string[] // media keys of items in this group
  originalMediaKey: string // user-selected "keep" item
  similarity: number // average pairwise similarity in the group
  /** Legacy coarse kind retained for stored-result compatibility. */
  duplicateKind?: "exact" | "similar"
  evidenceLevel?: DuplicateEvidenceLevel
  relationship?: DuplicateRelationship
  canProposeTrash?: boolean
  classificationVersion?: number
  matchReasons?: string[]
}

// ============================================================
// Stored state (chrome.storage.local)
// ============================================================

export interface StoredState {
  scanResults?: {
    mediaItems: Record<string, GpdMediaItem>
    groups: DuplicateGroup[]
    scanDate: number
    totalItems: number
    newestCreationTimestamp?: number // for incremental fetch on next scan
    /** Provider ordering watermark used for incremental library scans. */
    scanWatermarkTimestamp?: number
    /** Opaque iCloud zone cursor, scoped by the stored provider page session. */
    providerSyncToken?: string
    mediaItemsAreComplete?: boolean
    accountEmail?: string
    providerSessionId?: string
    sourceProvider?: PhotoProvider
    dateRange?: ScanSettings["dateRange"]
    albumScope?: ScanSettings["albumScope"]
    scanMode?: ScanSettings["scanMode"]
    similarityThreshold?: number
    smartWindowSec?: number
    scopeFingerprint?: string
    scanCoverage?: ScanCoverage
  }
  selections?: {
    version?: number
    selectedGroupIds: string[]
    reviewedGroupIds: string[]
    keptOverrides: Record<string, string[]>
    keepDecisionProvenance?: Record<
      string,
      {
        source: "manual" | "legacy_preserved" | "stale_fallback" | "automatic"
        strategy?: string
      }
    >
  }
  settings: ScanSettings
  scanCheckpoint?: import("./scan-checkpoint").ScanCheckpoint
}

export interface ScanSettings {
  sourceProvider?: PhotoProvider
  /** Persistent automatic keeper preference, applied when review results are ready. */
  defaultKeepStrategy?: KeepStrategy
  similarityThreshold: number
  scanMode: ScanMode
  /**
   * Smart-mode timestamp bucket window in seconds. Items with `taken` dates
   * within this window are compared against each other. Default is 1 second
   * (matches the legacy hardcoded value). Widen to catch re-saved videos /
   * photos whose EXIF timestamp was rewritten — at the cost of more pairs to
   * compare.
   */
  smartWindowSec?: number
  dateRange?: {
    /** Inclusive ISO calendar date in the browser's local timezone. */
    from?: string
    /** Inclusive ISO calendar date in the browser's local timezone. */
    to?: string
  }
  albumScope?: ScanAlbumScope
  amazonBatchLimit?: number
  icloudBatchLimit?: number
  exactOnly?: boolean
  protectFavorites?: boolean
}

export interface ScanAlbumScope {
  mediaKey: string
  title?: string
  itemCount?: number
  isShared?: boolean
}

export const DEFAULT_SETTINGS: ScanSettings = {
  sourceProvider: "google",
  defaultKeepStrategy: "best_quality",
  similarityThreshold: 0.95,
  scanMode: "smart",
  smartWindowSec: 1
}
