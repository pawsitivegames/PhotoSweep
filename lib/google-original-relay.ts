import type { MediaKind, PhotoProvider } from "./types"

export type GoogleOriginalRelayMediaKind = Extract<MediaKind, "photo" | "video" | "live-photo">

export interface GoogleCompletedScanItem {
  mediaKey: string
  mediaKind: GoogleOriginalRelayMediaKind | "unknown"
  mimeType?: string
  size?: number
}

export interface GoogleCompletedScanRegistration {
  appTabId: number | null
  clientId?: string
  providerTabId: number
  provider: PhotoProvider
  accountEmail: string
  providerSessionId: string
  scopeFingerprint: string
  coverageStatus: "complete" | "partial"
  mediaItems: unknown
}

interface CompletedScanEntry {
  appTabId: number | null
  clientId?: string
  providerTabId: number
  provider: "google"
  accountEmail: string
  providerSessionId: string
  scopeFingerprint: string
  mediaItems: Map<string, GoogleCompletedScanItem>
  registeredAt: number
}

const MAX_REGISTERED_ITEMS = 250_000
const MAX_REGISTRY_AGE_MS = 60 * 60 * 1000

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function appOwnerKey(appTabId: number | null, clientId?: string): string {
  return appTabId === null ? `panel:${clientId ?? ""}` : `tab:${appTabId}`
}

function validScopeValue(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

/**
 * Session-worker-only registration of exact rows from terminal scan replies.
 * Coverage may be partial; returned rows from that terminal result remain
 * eligible for explicitly requested original verification.
 */
export class GoogleCompletedScanRegistry {
  private readonly entries = new Map<string, CompletedScanEntry>()

  register(input: GoogleCompletedScanRegistration): boolean {
    if (
      input.provider !== "google" ||
      !Number.isSafeInteger(input.providerTabId) ||
      (input.appTabId !== null && !Number.isSafeInteger(input.appTabId)) ||
      (input.coverageStatus !== "complete" && input.coverageStatus !== "partial") ||
      !normalizeEmail(input.accountEmail) ||
      !input.providerSessionId ||
      input.providerSessionId.length > 512 ||
      !validScopeValue(input.scopeFingerprint) ||
      !Array.isArray(input.mediaItems) ||
      input.mediaItems.length > MAX_REGISTERED_ITEMS
    ) {
      return false
    }

    const mediaItems = new Map<string, GoogleCompletedScanItem>()
    for (const item of input.mediaItems) {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        typeof (item as { mediaKey?: unknown }).mediaKey !== "string"
      ) {
        return false
      }
      const value = item as {
        mediaKey: string
        mediaKind?: unknown
        mimeType?: unknown
        size?: unknown
      }
      if (!value.mediaKey || value.mediaKey.length > 512) return false
      if (
        value.size !== undefined &&
        value.size !== null &&
        (!Number.isSafeInteger(value.size) || (value.size as number) < 1)
      ) {
        return false
      }
      const mediaKind =
        value.mediaKind === "photo" ||
        value.mediaKind === "video" ||
        value.mediaKind === "live-photo"
          ? value.mediaKind
          : "unknown"
      if (mediaItems.has(value.mediaKey)) return false
      mediaItems.set(value.mediaKey, {
        mediaKey: value.mediaKey,
        mediaKind,
        ...(typeof value.mimeType === "string" && value.mimeType.length <= 128
          ? { mimeType: value.mimeType }
          : {}),
        ...(Number.isSafeInteger(value.size) && (value.size as number) > 0
          ? { size: value.size as number }
          : {})
      })
    }

    const entry: CompletedScanEntry = {
      appTabId: input.appTabId,
      ...(input.clientId ? { clientId: input.clientId } : {}),
      providerTabId: input.providerTabId,
      provider: "google",
      accountEmail: normalizeEmail(input.accountEmail),
      providerSessionId: input.providerSessionId,
      scopeFingerprint: input.scopeFingerprint,
      mediaItems,
      registeredAt: Date.now()
    }
    this.invalidateOwner(input.appTabId, input.clientId, input.providerTabId)
    this.entries.set(this.key(entry), entry)
    return true
  }

  hasItem(input: {
    appTabId: number | null
    clientId?: string
    providerTabId: number
    provider: PhotoProvider
    accountEmail: string
    providerSessionId: string
    scopeFingerprint: string
    mediaKey: string
    expectedMediaKind: GoogleOriginalRelayMediaKind
  }): GoogleCompletedScanItem | null {
    if (input.provider !== "google") return null
    const key = this.key(input)
    const entry = this.entries.get(key)
    if (!entry || Date.now() - entry.registeredAt > MAX_REGISTRY_AGE_MS) {
      this.entries.delete(key)
      return null
    }
    if (entry.accountEmail !== normalizeEmail(input.accountEmail)) return null
    const item = entry.mediaItems.get(input.mediaKey)
    return item &&
      (item.mediaKind === input.expectedMediaKind ||
        (item.mediaKind === "unknown" && input.expectedMediaKind === "photo"))
      ? item
      : null
  }

  invalidateOwner(
    appTabId: number | null,
    clientId: string | undefined,
    providerTabId: number
  ): void {
    const owner = appOwnerKey(appTabId, clientId)
    for (const [key, entry] of this.entries) {
      if (
        appOwnerKey(entry.appTabId, entry.clientId) === owner &&
        entry.providerTabId === providerTabId
      ) {
        this.entries.delete(key)
      }
    }
  }

  invalidateProviderTab(providerTabId: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.providerTabId === providerTabId) this.entries.delete(key)
    }
  }

  invalidateAppTab(appTabId: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.appTabId === appTabId) this.entries.delete(key)
    }
  }

  clear(): void {
    this.entries.clear()
  }

  private key(input: {
    appTabId: number | null
    clientId?: string
    providerTabId: number
    provider: PhotoProvider
    providerSessionId: string
    scopeFingerprint: string
  }): string {
    return JSON.stringify([
      appOwnerKey(input.appTabId, input.clientId),
      input.providerTabId,
      input.provider,
      input.providerSessionId,
      input.scopeFingerprint
    ])
  }
}
