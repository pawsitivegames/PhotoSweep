import {
  AMAZON_ORIGINS,
  GOOGLE_PHOTOS_ORIGINS,
  ICLOUD_ORIGINS
} from "./provider-sites"
import type { PhotoProvider, ScanSettings } from "./types"

export type ProviderCapabilityLevel = "supported" | "partial" | "unsupported"
export type IncrementalScanStrategy =
  | "provider_delta"
  | "full_refresh"
  | "unsupported"

export interface ProviderCapabilities {
  readonly libraryScan: ProviderCapabilityLevel
  readonly albumScope: ProviderCapabilityLevel
  readonly dateRange: ProviderCapabilityLevel
  readonly incrementalScan: IncrementalScanStrategy
  readonly photos: ProviderCapabilityLevel
  readonly videos: ProviderCapabilityLevel
  readonly livePhotoPairing: ProviderCapabilityLevel
  readonly accountIdentity: "email_when_available" | "session_only"
  readonly trash: ProviderCapabilityLevel
  readonly restore: ProviderCapabilityLevel
}

export interface ProviderOperations {
  readonly id: PhotoProvider
  readonly label: string
  readonly origins: readonly string[]
  readonly capabilities: ProviderCapabilities
  readonly injectBridgeIntoAllFrames: boolean
  openUrl(preferredOrigin?: string): string
  matchesUrl(url: string | undefined, requirePhotosPage?: boolean): boolean
  batchLimit(settings: ScanSettings): number | undefined
  tabPatterns(): string[]
}

function parsedUrl(value: string | undefined): URL | null {
  if (!value) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function normalizedLimit(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
}

const googleOperations: ProviderOperations = {
  id: "google",
  label: "Google Photos",
  origins: GOOGLE_PHOTOS_ORIGINS,
  capabilities: {
    libraryScan: "supported",
    albumScope: "supported",
    dateRange: "supported",
    incrementalScan: "full_refresh",
    photos: "supported",
    videos: "supported",
    livePhotoPairing: "unsupported",
    accountIdentity: "email_when_available",
    trash: "supported",
    restore: "supported"
  },
  injectBridgeIntoAllFrames: false,
  openUrl: () => "https://photos.google.com/",
  matchesUrl: (value) => parsedUrl(value)?.hostname === "photos.google.com",
  batchLimit: () => undefined,
  tabPatterns() {
    return this.origins.map((origin) => `${origin}/*`)
  }
}

const icloudOperations: ProviderOperations = {
  id: "icloud",
  label: "iCloud Photos",
  origins: ICLOUD_ORIGINS,
  capabilities: {
    libraryScan: "supported",
    albumScope: "supported",
    dateRange: "supported",
    incrementalScan: "provider_delta",
    photos: "supported",
    videos: "supported",
    livePhotoPairing: "unsupported",
    accountIdentity: "email_when_available",
    trash: "supported",
    restore: "supported"
  },
  injectBridgeIntoAllFrames: true,
  openUrl: () => "https://www.icloud.com/photos",
  matchesUrl(value, requirePhotosPage = false) {
    const url = parsedUrl(value)
    return Boolean(
      url &&
        this.origins.includes(url.origin) &&
        (!requirePhotosPage || url.pathname.includes("/photos"))
    )
  },
  batchLimit: (settings) => normalizedLimit(settings.icloudBatchLimit),
  tabPatterns() {
    return this.origins.map((origin) => `${origin}/*`)
  }
}

const amazonOperations: ProviderOperations = {
  id: "amazon",
  label: "Amazon Photos",
  origins: AMAZON_ORIGINS,
  capabilities: {
    libraryScan: "supported",
    albumScope: "supported",
    dateRange: "supported",
    incrementalScan: "full_refresh",
    photos: "supported",
    videos: "supported",
    livePhotoPairing: "unsupported",
    accountIdentity: "session_only",
    trash: "supported",
    restore: "supported"
  },
  injectBridgeIntoAllFrames: false,
  openUrl(preferredOrigin) {
    const origin =
      preferredOrigin && this.origins.includes(preferredOrigin)
        ? preferredOrigin
        : this.origins[0]
    return `${origin}/photos?sf=1`
  },
  matchesUrl(value, requirePhotosPage = false) {
    const url = parsedUrl(value)
    return Boolean(
      url &&
        this.origins.includes(url.origin) &&
        (!requirePhotosPage || url.pathname.startsWith("/photos"))
    )
  },
  batchLimit: (settings) => normalizedLimit(settings.amazonBatchLimit),
  tabPatterns() {
    return this.origins.map((origin) => `${origin}/*`)
  }
}

const PROVIDER_OPERATIONS: Record<PhotoProvider, ProviderOperations> = {
  google: googleOperations,
  icloud: icloudOperations,
  amazon: amazonOperations
}

export function getProviderOperations(
  provider: PhotoProvider | undefined = "google"
): ProviderOperations {
  return PROVIDER_OPERATIONS[provider]
}

export function providerLabel(provider: PhotoProvider | undefined): string {
  return getProviderOperations(provider).label
}

export function providerTrashDestination(
  provider: PhotoProvider | undefined
): string {
  if (provider === "icloud") return "iCloud Photos Recently Deleted"
  return `${providerLabel(provider)} Trash`
}

export function providerRecoveryWindowNotice(
  provider: PhotoProvider | undefined
): string {
  if (provider === "icloud") {
    return "iCloud Photos keeps deleted items in Recently Deleted for up to 30 days."
  }
  if (provider === "amazon") {
    return "Amazon Photos keeps deleted items in Trash. Check your account's Amazon Photos Help for the retention period."
  }
  return "Google Photos keeps deleted items in Trash for up to 30 days."
}

export function providerHealthUnavailableMessage(
  provider: PhotoProvider | undefined
): string {
  if (provider === "icloud") {
    return "iCloud Photos is not ready. Open icloud.com/photos, sign in, wait for your library to load, then click Retry."
  }
  if (provider === "amazon") {
    return "Amazon Photos is not ready. Open Amazon Photos on your country site, sign in again if needed, wait for your library to load, then click Retry."
  }
  return "Google Photos is not ready. Open photos.google.com, sign in, wait for your library to load, then click Retry."
}

export function providerAlbumTrashNotice(): string {
  return "Album scope only limits what the scan checks. Moving an item to Trash removes it from the provider library and can remove it from every album that contains it; this does not just remove it from the selected album."
}

export function providerLivePhotoPairNotice(): string {
  return "PhotoSweep does not group a Live Photo's still and motion components as one item; components exposed separately may be scanned separately."
}

export function providerOpenUrl(
  provider: PhotoProvider | undefined,
  preferredOrigin?: string
): string {
  return getProviderOperations(provider).openUrl(preferredOrigin)
}

export function providerTabPatterns(
  provider: PhotoProvider | undefined
): string[] {
  return getProviderOperations(provider).tabPatterns()
}

export function providerMatchesUrl(
  url: string | undefined,
  provider: PhotoProvider,
  requirePhotosPage = false
): boolean {
  return getProviderOperations(provider).matchesUrl(url, requirePhotosPage)
}

export function providerFromUrl(url: string | undefined): PhotoProvider | null {
  for (const provider of ["google", "icloud", "amazon"] as const) {
    if (PROVIDER_OPERATIONS[provider].matchesUrl(url)) return provider
  }
  return null
}

export function providerBatchLimit(settings: ScanSettings): number | undefined {
  return getProviderOperations(settings.sourceProvider).batchLimit(settings)
}
