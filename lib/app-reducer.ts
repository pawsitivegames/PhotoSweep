// App state machine for PhotoSweep.
// Extracted from tabs/app.tsx so it can be unit-tested independently.

import { areScanResultsValid } from "./scan-results"
import { providerHealthUnavailableMessage } from "./provider-operations"
import { classifyDuplicateGroup, isTrustedContentHash } from "./duplicate-classifier"
import type {
  ContentHashEvidence,
  DuplicateGroup,
  GpdMediaItem,
  GptkProgressMessage,
  HealthCheckResultMessage,
  PhotoProvider,
  ScanCoverage,
  ScanPhase
} from "./types"

// ============================================================
// Types
// ============================================================

export type AppState =
  | { status: "connecting" }
  | {
      status: "connected"
      hasGptk: boolean
      accountEmail?: string
      providerSessionId?: string
    }
  | {
      status: "disconnected"
      error: string
      scanCoverage?: ScanCoverage
    }
  | {
      status: "scanning"
      phase: ScanPhase
      itemsProcessed: number
      totalEstimate: number
      message: string
      requestId: string
      hasGptk: boolean
      accountEmail?: string
      providerSessionId?: string
      partialMediaItems?: Record<string, GpdMediaItem>
      partialGroups?: DuplicateGroup[]
      partialTotalItems?: number
    }
  | {
      status: "results"
      mediaItems: Record<string, GpdMediaItem>
      groups: DuplicateGroup[]
      totalItems: number
      accountEmail?: string
      providerSessionId?: string
      providerSyncToken?: string
      scanCoverage?: ScanCoverage
      sourceProvider?: PhotoProvider
      scanDate?: number
      scopeFingerprint?: string
    }
  | {
      status: "trashing"
      mediaItems: Record<string, GpdMediaItem>
      groups: DuplicateGroup[]
      totalItems: number
      totalToTrash: number
      trashedSoFar: number
      accountEmail?: string
      providerSessionId?: string
      providerSyncToken?: string
      scanCoverage?: ScanCoverage
      sourceProvider?: PhotoProvider
      scanDate?: number
      scopeFingerprint?: string
    }

export type AppAction =
  | { type: "HEALTH_CHECK_RESULT"; payload: HealthCheckResultMessage }
  | {
      type: "SCAN_STARTED"
      requestId: string
      hasGptk: boolean
      accountEmail?: string
      providerSessionId?: string
    }
  | {
      type: "SCAN_PROGRESS"
      payload: GptkProgressMessage
      phase?: ScanPhase
      totalItems?: number
    }
  | { type: "SCAN_MEDIA_FETCHED"; mediaItems: GpdMediaItem[] }
  | {
      type: "SCAN_PARTIAL_RESULTS"
      mediaItems: Record<string, GpdMediaItem>
      groups: DuplicateGroup[]
      totalItems: number
      scanCoverage?: ScanCoverage
      sourceProvider?: PhotoProvider
      scanDate?: number
      scopeFingerprint?: string
    }
  | {
      type: "SCAN_COMPLETE"
      mediaItems: Record<string, GpdMediaItem>
      groups: DuplicateGroup[]
      totalItems: number
      scanCoverage?: ScanCoverage
      sourceProvider?: PhotoProvider
      scanDate?: number
      scopeFingerprint?: string
      providerSyncToken?: string
    }
  | {
      type: "SCAN_ERROR"
      error: string
      scanCoverage?: ScanCoverage
    }
  | { type: "SCAN_CANCELLED" }
  | {
      type: "TRASH_STARTED"
      totalToTrash: number
      mediaItems: Record<string, GpdMediaItem>
      groups: DuplicateGroup[]
      totalItems: number
      sourceProvider?: PhotoProvider
      providerSessionId?: string
      scanDate?: number
      scopeFingerprint?: string
    }
  | { type: "TRASH_PROGRESS"; trashedSoFar: number; trashedKeys?: string[] }
  | { type: "TRASH_COMPLETE"; trashedKeys: string[] }
  | { type: "TRASH_ERROR"; error: string }
  | {
      type: "ORIGINAL_HASH_VERIFIED"
      provider: PhotoProvider
      providerSessionId: string
      accountEmail?: string
      scopeFingerprint: string
      mediaKey: string
      dedupKey: string
      contentHash: ContentHashEvidence
      byteLength: number
      mimeType?: string
    }
  | {
      type: "LOAD_SAVED_RESULTS"
      mediaItems: Record<string, GpdMediaItem>
      groups: DuplicateGroup[]
      totalItems: number
      scanCoverage?: ScanCoverage
      accountEmail?: string
      providerSessionId?: string
      providerSyncToken?: string
      sourceProvider?: PhotoProvider
      scanDate?: number
      scopeFingerprint?: string
    }
  | {
      type: "RESTORE_SNAPSHOT"
      mediaItems: Record<string, GpdMediaItem>
      groups: DuplicateGroup[]
      totalItems: number
      sourceProvider?: PhotoProvider
      scanDate?: number
      scopeFingerprint?: string
    }
  | { type: "GP_TAB_CLOSED"; provider?: PhotoProvider }
  | { type: "RESET" }

// ============================================================
// Reducer
// ============================================================

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "ORIGINAL_HASH_VERIFIED": {
      if (
        state.status !== "results" ||
        state.sourceProvider !== action.provider ||
        state.providerSessionId !== action.providerSessionId ||
        !state.scopeFingerprint ||
        state.scopeFingerprint !== action.scopeFingerprint ||
        (action.provider === "google" &&
          (!state.accountEmail ||
            !action.accountEmail ||
            state.accountEmail.trim().toLowerCase() !==
              action.accountEmail.trim().toLowerCase())) ||
        !isTrustedContentHash(action.contentHash) ||
        action.contentHash.algorithm !== "sha256" ||
        action.contentHash.verificationSource !== "local-original-bytes" ||
        action.contentHash.provenance !== "original-content" ||
        (action.contentHash.contentRole !== undefined &&
          action.contentHash.contentRole !== "single-file" &&
          action.contentHash.contentRole !== "live-photo-still") ||
        !Number.isSafeInteger(action.byteLength) ||
        action.byteLength < 1 ||
        action.byteLength > 25 * 1024 * 1024 ||
        (action.mimeType !== undefined &&
          !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(
            action.mimeType
          ))
      ) {
        return state
      }
      const existing = state.mediaItems[action.mediaKey]
      if (
        !existing ||
        existing.dedupKey !== action.dedupKey ||
        existing.provider !== action.provider
      ) {
        return state
      }
      const mediaItems = {
        ...state.mediaItems,
        [action.mediaKey]: {
          ...existing,
          contentHash: action.contentHash,
          originalByteLength: action.byteLength,
          ...(action.mimeType ? { originalMimeType: action.mimeType } : {})
        }
      }
      const groups = state.groups.map((group) => {
        if (!group.mediaKeys.includes(action.mediaKey)) return group
        return {
          ...group,
          ...classifyDuplicateGroup(group, mediaItems)
        }
      })
      return { ...state, mediaItems, groups }
    }

    case "HEALTH_CHECK_RESULT":
      if (action.payload.success) {
        // Don't downgrade from results — just confirm GP is still available
        if (state.status === "results") {
          // Clear stale results when a different account is detected
          if (
            !areScanResultsValid(
              {
                accountEmail: state.accountEmail,
                sourceProvider: state.sourceProvider,
                providerSessionId: state.providerSessionId
              },
              {
                accountEmail: action.payload.accountEmail,
                sourceProvider:
                  action.payload.provider ?? state.sourceProvider,
                providerSessionId: action.payload.providerSessionId
              }
            )
          ) {
            return {
              status: "connected",
              hasGptk: action.payload.hasGptk,
              accountEmail: action.payload.accountEmail,
              providerSessionId: action.payload.providerSessionId
            }
          }
          const email = action.payload.accountEmail ?? state.accountEmail
          if (
            email === state.accountEmail &&
            action.payload.providerSessionId === state.providerSessionId
          ) {
            return state
          }
          return {
            ...state,
            accountEmail: email,
            providerSessionId: action.payload.providerSessionId
          }
        }
        return {
          status: "connected",
          hasGptk: action.payload.hasGptk,
          accountEmail: action.payload.accountEmail,
          providerSessionId: action.payload.providerSessionId
        }
      }
      // Don't disconnect if already showing results — user can still view them
      // and GP tab will be required again only when they start a new scan/trash
      if (state.status === "results") return state
      {
        return {
          status: "disconnected",
          error: action.payload.error ??
            providerHealthUnavailableMessage(action.payload.provider)
        }
      }

    case "SCAN_STARTED":
      return {
        status: "scanning",
        phase: "fetching",
        itemsProcessed: 0,
        totalEstimate: 0,
        message: "Starting scan...",
        requestId: action.requestId,
        hasGptk: action.hasGptk,
        accountEmail: action.accountEmail,
        providerSessionId: action.providerSessionId
      }

    case "SCAN_PROGRESS":
      if (state.status !== "scanning") return state
      // action.phase === undefined means this came from a GPTK gptkProgress message.
      // GPTK sends batched fetch counts asynchronously and can arrive after gptkResult
      // has already triggered the downloading/computing phases. Drop those stale counts
      // to prevent the bar from jumping backwards.
      if (action.phase === undefined && state.phase !== "fetching") return state
      return {
        ...state,
        ...(action.phase !== undefined ? { phase: action.phase } : {}),
        itemsProcessed: action.payload.itemsProcessed,
        ...(action.totalItems !== undefined
          ? { totalEstimate: action.totalItems }
          : {}),
        message: action.payload.message || state.message
      }

    case "SCAN_MEDIA_FETCHED":
      if (state.status !== "scanning") return state
      return {
        ...state,
        phase: "downloading_thumbnails",
        itemsProcessed: 0,
        totalEstimate: action.mediaItems.length,
        message: `Fetched ${action.mediaItems.length} items. Downloading thumbnails...`
      }

    case "SCAN_PARTIAL_RESULTS":
      if (state.status !== "scanning") return state
      return {
        ...state,
        partialMediaItems: action.mediaItems,
        partialGroups: action.groups,
        partialTotalItems: action.totalItems
      }

    case "SCAN_COMPLETE":
      return {
        status: "results",
        mediaItems: action.mediaItems,
        groups: action.groups,
        totalItems: action.totalItems,
        accountEmail: "accountEmail" in state ? state.accountEmail : undefined,
        providerSessionId:
          "providerSessionId" in state ? state.providerSessionId : undefined,
        ...(action.providerSyncToken
          ? { providerSyncToken: action.providerSyncToken }
          : {}),
        ...(action.scanCoverage ? { scanCoverage: action.scanCoverage } : {}),
        ...(action.sourceProvider ? { sourceProvider: action.sourceProvider } : {}),
        ...(action.scanDate ? { scanDate: action.scanDate } : {}),
        ...(action.scopeFingerprint
          ? { scopeFingerprint: action.scopeFingerprint }
          : {})
      }

    case "SCAN_ERROR":
      return {
        status: "disconnected",
        error: action.error,
        ...(action.scanCoverage ? { scanCoverage: action.scanCoverage } : {})
      }

    case "SCAN_CANCELLED":
      if (state.status !== "scanning") return state
      return {
        status: "connected",
        hasGptk: state.hasGptk,
        accountEmail: state.accountEmail,
        providerSessionId: state.providerSessionId
      }

    case "TRASH_STARTED":
      return {
        status: "trashing",
        mediaItems: action.mediaItems,
        groups: action.groups,
        totalItems: action.totalItems,
        totalToTrash: action.totalToTrash,
        trashedSoFar: 0,
        accountEmail: "accountEmail" in state ? state.accountEmail : undefined,
        providerSessionId:
          action.providerSessionId ??
          ("providerSessionId" in state ? state.providerSessionId : undefined),
        ...("scanCoverage" in state && state.scanCoverage
          ? { scanCoverage: state.scanCoverage }
          : {}),
        ...(action.sourceProvider
          ? { sourceProvider: action.sourceProvider }
          : {}),
        ...(action.scanDate ? { scanDate: action.scanDate } : {}),
        ...(action.scopeFingerprint
          ? { scopeFingerprint: action.scopeFingerprint }
          : {})
      }

    case "TRASH_PROGRESS":
      if (state.status !== "trashing") return state
      if (!action.trashedKeys?.length) {
        return { ...state, trashedSoFar: action.trashedSoFar }
      }
      {
        const trashedSet = new Set(action.trashedKeys)
        const groups = state.groups
          .map((group) => ({
            ...group,
            mediaKeys: group.mediaKeys.filter((key) => !trashedSet.has(key))
          }))
          .filter((group) => group.mediaKeys.length >= 2)
        const mediaItems = { ...state.mediaItems }
        for (const key of action.trashedKeys) delete mediaItems[key]
        return {
          ...state,
          mediaItems,
          groups,
          trashedSoFar: action.trashedSoFar
        }
      }

    case "TRASH_COMPLETE": {
      if (state.status !== "trashing") return state
      const trashedSet = new Set(action.trashedKeys)
      const newGroups = state.groups
        .map((g) => ({
          ...g,
          mediaKeys: g.mediaKeys.filter((k) => !trashedSet.has(k))
        }))
        .filter((g) => g.mediaKeys.length >= 2)

      const newMediaItems = { ...state.mediaItems }
      for (const key of action.trashedKeys) {
        delete newMediaItems[key]
      }

      return {
        status: "results",
        mediaItems: newMediaItems,
        groups: newGroups,
        totalItems: state.totalItems,
        accountEmail: state.accountEmail,
        providerSessionId: state.providerSessionId,
        ...(state.providerSyncToken
          ? { providerSyncToken: state.providerSyncToken }
          : {}),
        ...(state.scanCoverage ? { scanCoverage: state.scanCoverage } : {}),
        ...(state.sourceProvider ? { sourceProvider: state.sourceProvider } : {}),
        ...(state.scanDate ? { scanDate: state.scanDate } : {}),
        ...(state.scopeFingerprint
          ? { scopeFingerprint: state.scopeFingerprint }
          : {})
      }
    }

    case "TRASH_ERROR":
      return { status: "disconnected", error: action.error }

    case "LOAD_SAVED_RESULTS":
      return {
        status: "results",
        mediaItems: action.mediaItems,
        groups: action.groups,
        totalItems: action.totalItems,
        accountEmail: action.accountEmail,
        providerSessionId: action.providerSessionId,
        ...(action.providerSyncToken
          ? { providerSyncToken: action.providerSyncToken }
          : {}),
        ...(action.scanCoverage ? { scanCoverage: action.scanCoverage } : {}),
        ...(action.sourceProvider ? { sourceProvider: action.sourceProvider } : {}),
        ...(action.scanDate ? { scanDate: action.scanDate } : {}),
        ...(action.scopeFingerprint
          ? { scopeFingerprint: action.scopeFingerprint }
          : {})
      }

    case "RESTORE_SNAPSHOT":
      return {
        status: "results",
        mediaItems: action.mediaItems,
        groups: action.groups,
        totalItems: action.totalItems,
        accountEmail: "accountEmail" in state ? state.accountEmail : undefined,
        providerSessionId:
          "providerSessionId" in state ? state.providerSessionId : undefined,
        ...("providerSyncToken" in state && state.providerSyncToken
          ? { providerSyncToken: state.providerSyncToken }
          : {}),
        ...("scanCoverage" in state && state.scanCoverage
          ? { scanCoverage: state.scanCoverage }
          : {}),
        ...("sourceProvider" in state && state.sourceProvider
          ? { sourceProvider: state.sourceProvider }
          : {}),
        ...("scanDate" in state && state.scanDate
          ? { scanDate: state.scanDate }
          : {}),
        ...("scopeFingerprint" in state && state.scopeFingerprint
          ? { scopeFingerprint: state.scopeFingerprint }
          : {})
      }

    case "GP_TAB_CLOSED": {
      const provider = action.provider
      const providerName =
        provider === "icloud"
          ? "iCloud Photos"
          : provider === "amazon"
            ? "Amazon Photos"
            : "Google Photos"
      const providerUrl =
        provider === "icloud"
          ? "icloud.com/photos"
          : provider === "amazon"
            ? "Amazon Photos on your Amazon country site"
            : "photos.google.com"
      return {
        status: "disconnected",
        error: `The ${providerName} tab was closed. Please reopen ${providerUrl} and retry.`
      }
    }

    case "RESET":
      return { status: "connecting" }

    default:
      return state
  }
}
