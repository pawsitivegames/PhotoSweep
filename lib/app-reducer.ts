// App state machine for PhotoSweep.
// Extracted from tabs/app.tsx so it can be unit-tested independently.

import { areScanResultsValid } from "./scan-results"
import type {
  DuplicateGroup,
  GpdMediaItem,
  GptkProgressMessage,
  HealthCheckResultMessage,
  PhotoProvider,
  ScanPhase
} from "./types"

// ============================================================
// Types
// ============================================================

export type AppState =
  | { status: "connecting" }
  | { status: "connected"; hasGptk: boolean; accountEmail?: string }
  | { status: "disconnected"; error: string }
  | {
      status: "scanning"
      phase: ScanPhase
      itemsProcessed: number
      totalEstimate: number
      message: string
      requestId: string
      hasGptk: boolean
      accountEmail?: string
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
      sourceProvider?: PhotoProvider
      scanDate?: number
      scopeFingerprint?: string
    }
  | {
      type: "SCAN_COMPLETE"
      mediaItems: Record<string, GpdMediaItem>
      groups: DuplicateGroup[]
      totalItems: number
      sourceProvider?: PhotoProvider
      scanDate?: number
      scopeFingerprint?: string
    }
  | { type: "SCAN_ERROR"; error: string }
  | { type: "SCAN_CANCELLED" }
  | {
      type: "TRASH_STARTED"
      totalToTrash: number
      mediaItems: Record<string, GpdMediaItem>
      groups: DuplicateGroup[]
      totalItems: number
      sourceProvider?: PhotoProvider
      scanDate?: number
      scopeFingerprint?: string
    }
  | { type: "TRASH_PROGRESS"; trashedSoFar: number; trashedKeys?: string[] }
  | { type: "TRASH_COMPLETE"; trashedKeys: string[] }
  | { type: "TRASH_ERROR"; error: string }
  | {
      type: "LOAD_SAVED_RESULTS"
      mediaItems: Record<string, GpdMediaItem>
      groups: DuplicateGroup[]
      totalItems: number
      accountEmail?: string
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
    case "HEALTH_CHECK_RESULT":
      if (action.payload.success) {
        // Don't downgrade from results — just confirm GP is still available
        if (state.status === "results") {
          // Clear stale results when a different account is detected
          if (
            !areScanResultsValid(
              { accountEmail: state.accountEmail },
              { accountEmail: action.payload.accountEmail }
            )
          ) {
            return {
              status: "connected",
              hasGptk: action.payload.hasGptk,
              accountEmail: action.payload.accountEmail
            }
          }
          const email = action.payload.accountEmail ?? state.accountEmail
          if (email === state.accountEmail) return state
          return { ...state, accountEmail: email }
        }
        return {
          status: "connected",
          hasGptk: action.payload.hasGptk,
          accountEmail: action.payload.accountEmail
        }
      }
      // Don't disconnect if already showing results — user can still view them
      // and GP tab will be required again only when they start a new scan/trash
      if (state.status === "results") return state
      {
        const providerName =
          action.payload.provider === "icloud"
            ? "iCloud Photos"
            : action.payload.provider === "amazon"
              ? "Amazon Photos"
              : "Google Photos"
        const providerUrl =
          action.payload.provider === "icloud"
            ? "icloud.com/photos"
            : action.payload.provider === "amazon"
              ? "Amazon Photos on your Amazon country site"
              : "photos.google.com"
        return {
          status: "disconnected",
          error:
            action.payload.error ??
            `Cannot connect to ${providerName}. Open ${providerUrl}, sign in, wait for your library to load, then click Retry.`
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
        accountEmail: action.accountEmail
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
        ...(action.sourceProvider ? { sourceProvider: action.sourceProvider } : {}),
        ...(action.scanDate ? { scanDate: action.scanDate } : {}),
        ...(action.scopeFingerprint
          ? { scopeFingerprint: action.scopeFingerprint }
          : {})
      }

    case "SCAN_ERROR":
      return { status: "disconnected", error: action.error }

    case "SCAN_CANCELLED":
      if (state.status !== "scanning") return state
      return {
        status: "connected",
        hasGptk: state.hasGptk,
        accountEmail: state.accountEmail
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
