import {
  AMAZON_ORIGINS,
  GOOGLE_PHOTOS_ORIGINS,
  ICLOUD_ORIGINS
} from "./provider-sites"
import type { PhotoProvider, ScanSettings } from "./types"

export interface ProviderOperations {
  readonly id: PhotoProvider
  readonly label: string
  readonly origins: readonly string[]
  readonly supportsAlbumScope: boolean
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
  supportsAlbumScope: true,
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
  supportsAlbumScope: false,
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
  supportsAlbumScope: false,
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
