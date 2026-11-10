import type {
  OriginalContentHashResult,
  VideoPlaybackResult
} from "./provider-retrieval"
import type { TrashCommand, TrashLifecycle } from "./trash-lifecycle"
import {
  APP_ID,
  type AppMessage,
  type GpdAlbum,
  type GptkCommandMessage,
  type GptkResultMessage,
  type PhotoProvider,
  type ScanSettings
} from "./types"

interface SessionArgs {
  accountEmail?: string
  providerSessionId?: string
}

interface RetrievalArgs extends SessionArgs {
  requestId?: string
  userOptIn?: boolean
  mediaKey: string
  dedupKey?: string
  scanScopeFingerprint: string
  mediaKind?: string
  maxBytes?: number
  aggregateBudgetBytes?: number
}

export interface ProviderCommandArgs {
  healthCheck: undefined
  listAlbums: SessionArgs | undefined
  getAllMediaItems: SessionArgs & {
    dateRange?: ScanSettings["dateRange"]
    albumScope?: ScanSettings["albumScope"]
    sinceTimestamp?: number
    providerSyncToken?: string
    cachedTotalItems?: number
    limit?: number
    scanScopeFingerprint: string
  }
  trashItems: TrashCommand["args"]
  restoreItems: ReturnType<TrashLifecycle["beginRestore"]>["args"]
  getOriginalContentHash: RetrievalArgs
  getVideoPlaybackUrl: RetrievalArgs
  cancelScan: { targetRequestId: string }
  cancelProviderRequest: SessionArgs & {
    targetRequestId: string
    scanScopeFingerprint: string
  }
}

export interface ProviderCommandData {
  healthCheck: {
    hasGptk: boolean
    accountEmail?: string
    accountDisplayName?: unknown
    health?: unknown
  }
  listAlbums: GpdAlbum[]
  // Provider metadata remains untrusted until Scan Lifecycle prepares it.
  getAllMediaItems: unknown[]
  // Per-target confirmations are interpreted only by Trash Lifecycle.
  trashItems: Record<string, unknown> | undefined
  restoreItems: Record<string, unknown> | undefined
  getOriginalContentHash: OriginalContentHashResult
  getVideoPlaybackUrl: VideoPlaybackResult
  cancelScan: { targetRequestId: string; cancelled: boolean }
  cancelProviderRequest: { targetRequestId: string; cancelled: boolean }
}

export type ProviderCommand = keyof ProviderCommandArgs

export type ProviderOperationRequest<
  C extends ProviderCommand = ProviderCommand
> = {
  [K in C]: Omit<GptkCommandMessage, "command" | "args"> & {
    command: K
  } & (undefined extends ProviderCommandArgs[K]
      ? { args?: ProviderCommandArgs[K] }
      : { args: ProviderCommandArgs[K] })
}[C]

export type ProviderOperationResult<
  C extends ProviderCommand = ProviderCommand
> = {
  [K in C]: Omit<GptkResultMessage, "command" | "data" | "success"> &
    (
      | { command: K; success: true; data: ProviderCommandData[K] }
      | { command: K; success: false; data?: unknown }
    )
}[C]

export type ExtensionRequest =
  Exclude<AppMessage, GptkCommandMessage> | ProviderOperationRequest

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function optionalText(value: unknown): boolean {
  return value === undefined || typeof value === "string"
}

function provider(value: unknown): value is PhotoProvider {
  return value === "google" || value === "icloud" || value === "amazon"
}

export function isProviderCommand(command: string): command is ProviderCommand {
  return [
    "healthCheck",
    "listAlbums",
    "getAllMediaItems",
    "trashItems",
    "restoreItems",
    "getOriginalContentHash",
    "getVideoPlaybackUrl",
    "cancelScan",
    "cancelProviderRequest"
  ].includes(command)
}

/** Parse the transport envelope without treating page assertions as authority. */
export function readProviderResult(value: unknown): GptkResultMessage | null {
  if (
    !record(value) ||
    value.app !== APP_ID ||
    value.action !== "gptkResult" ||
    !text(value.command) ||
    !text(value.requestId) ||
    typeof value.success !== "boolean" ||
    (value.provider !== undefined && !provider(value.provider)) ||
    !optionalText(value.clientId) ||
    !optionalText(value.providerSessionId) ||
    !optionalText(value.providerSyncToken) ||
    !optionalText(value.error) ||
    (value.errorCode !== undefined &&
      value.errorCode !== "unsupported_capability")
  )
    return null
  return value as unknown as GptkResultMessage
}

/** Validate wire syntax; provider/session authorization stays with the worker and host. */
export function readProviderCommand(value: unknown): GptkCommandMessage | null {
  if (
    !record(value) ||
    value.app !== APP_ID ||
    value.action !== "gptkCommand" ||
    !text(value.command) ||
    !text(value.requestId) ||
    (value.provider !== undefined && !provider(value.provider)) ||
    !optionalText(value.clientId) ||
    (value.args !== undefined && !record(value.args))
  )
    return null
  const args = value.args
  if (record(args)) {
    for (const key of [
      "accountEmail",
      "providerSessionId",
      "scanScopeFingerprint",
      "mediaKey",
      "targetRequestId",
      "providerSyncToken"
    ]) {
      if (!optionalText(args[key])) return null
    }
    for (const key of [
      "limit",
      "cachedTotalItems",
      "batchSize",
      "batchPauseMs",
      "retryCount",
      "retryBackoffMs",
      "maxBytes",
      "aggregateBudgetBytes"
    ]) {
      if (
        args[key] !== undefined &&
        (typeof args[key] !== "number" ||
          !Number.isSafeInteger(args[key]) ||
          (args[key] as number) < 0)
      )
        return null
    }
    for (const key of [
      "dedupKeys",
      "mediaKeysToTrash",
      "acknowledgedUnknownFavoriteDedupKeys"
    ]) {
      if (
        args[key] !== undefined &&
        (!Array.isArray(args[key]) || !(args[key] as unknown[]).every(text))
      )
        return null
    }
  }
  return value as unknown as GptkCommandMessage
}

/** Narrow a known command only after its success payload has been checked. */
export function parseProviderResult<C extends ProviderCommand>(
  value: unknown,
  command: C
): ProviderOperationResult<C> | null {
  const result = readProviderResult(value)
  if (!result || result.command !== command) return null
  if (!result.success) return result as ProviderOperationResult<C>
  const data = result.data
  let valid = false
  switch (command) {
    case "healthCheck":
      valid =
        record(data) &&
        typeof data.hasGptk === "boolean" &&
        optionalText(data.accountEmail)
      break
    case "listAlbums":
      valid =
        Array.isArray(data) &&
        data.every(
          (album) =>
            record(album) &&
            text(album.mediaKey) &&
            typeof album.title === "string"
        )
      break
    case "getAllMediaItems":
      valid = Array.isArray(data)
      break
    case "trashItems":
    case "restoreItems":
      valid = data === undefined || record(data)
      break
    case "getOriginalContentHash":
      valid =
        record(data) &&
        text(data.mediaKey) &&
        text(data.scopeFingerprint) &&
        record(data.contentHash) &&
        data.contentHash.algorithm === "sha256" &&
        data.contentHash.provenance === "original-content" &&
        data.contentHash.verificationSource === "local-original-bytes" &&
        typeof data.contentHash.value === "string" &&
        /^[a-f0-9]{64}$/.test(data.contentHash.value) &&
        typeof data.byteLength === "number" &&
        Number.isSafeInteger(data.byteLength) &&
        data.byteLength >= 0 &&
        optionalText(data.mimeType)
      break
    case "getVideoPlaybackUrl":
      valid =
        record(data) &&
        text(data.mediaKey) &&
        text(data.scopeFingerprint) &&
        text(data.playbackUrl) &&
        optionalText(data.mimeType) &&
        (data.expiresAt === undefined ||
          (typeof data.expiresAt === "number" &&
            Number.isFinite(data.expiresAt)))
      break
    case "cancelScan":
    case "cancelProviderRequest":
      valid =
        record(data) &&
        text(data.targetRequestId) &&
        typeof data.cancelled === "boolean"
      break
  }
  return valid ? (result as ProviderOperationResult<C>) : null
}

export function isProviderPageMessage(value: unknown): value is AppMessage {
  if (!record(value) || value.app !== APP_ID) return false
  if (value.action === "gptkResult") return readProviderResult(value) !== null
  if (value.action === "gptkProgress")
    return (
      text(value.requestId) &&
      typeof value.itemsProcessed === "number" &&
      Number.isSafeInteger(value.itemsProcessed) &&
      value.itemsProcessed >= 0 &&
      optionalText(value.command) &&
      optionalText(value.message)
    )
  if (value.action === "gptkLog")
    return (
      typeof value.level === "string" &&
      ["info", "error", "success"].includes(value.level) &&
      typeof value.message === "string"
    )
  return false
}
