import type {
  ContentHashEvidence,
  GpdMediaItem,
  PhotoProvider
} from "./types"

export const MAX_ORIGINAL_BYTES_PER_ITEM = 25 * 1024 * 1024
export const MAX_ORIGINAL_BYTES_PER_REVIEW = 100 * 1024 * 1024

export function getOriginalContentVerificationUnavailableMessage(
  item: Pick<
    GpdMediaItem,
    "provider" | "originalContentVerificationCapability"
  >
): string | null {
  if (item.originalContentVerificationCapability === "available") return null
  if (
    item.provider === "amazon" &&
    item.originalContentVerificationCapability === "unsupported-region"
  ) {
    return "Original-byte verification is unavailable on this Amazon Photos region."
  }
  return "Original-byte verification is unavailable for this item."
}

export function isVideoForPlayback(
  item: Pick<GpdMediaItem, "mediaKind" | "duration">
): boolean {
  if (item.mediaKind === "video") return true
  if (item.mediaKind === "photo" || item.mediaKind === "live-photo") {
    return false
  }
  return Number.isFinite(item.duration) && (item.duration ?? 0) > 0
}

export interface ProviderRetrievalBinding {
  status: string
  provider: PhotoProvider
  currentProvider: PhotoProvider
  scannedProviderSessionId?: string
  currentProviderSessionId?: string
  scannedAccountEmail?: string
  currentAccountEmail?: string
  scannedScopeFingerprint?: string
  currentScopeFingerprint?: string
  item: Pick<GpdMediaItem, "mediaKey" | "dedupKey" | "provider">
  scannedMediaItems: Iterable<Pick<GpdMediaItem, "mediaKey" | "dedupKey" | "provider">>
}

export function isProviderRetrievalResponseBound(
  response: { command: string; provider?: PhotoProvider },
  expected: { command: string; provider: PhotoProvider }
): boolean {
  return (
    response.command === expected.command &&
    response.provider === expected.provider
  )
}

export function isProviderRetrievalBindingCurrent(
  binding: ProviderRetrievalBinding
): boolean {
  if (
    binding.status !== "results" ||
    binding.provider !== binding.currentProvider ||
    !binding.scannedProviderSessionId ||
    binding.scannedProviderSessionId !== binding.currentProviderSessionId ||
    !binding.scannedScopeFingerprint ||
    binding.scannedScopeFingerprint !== binding.currentScopeFingerprint ||
    binding.item.provider !== binding.provider
  ) {
    return false
  }
  if (
    binding.provider === "google" &&
    (!binding.scannedAccountEmail ||
      binding.scannedAccountEmail !== binding.currentAccountEmail)
  ) {
    return false
  }
  for (const item of binding.scannedMediaItems) {
    if (
      item.mediaKey === binding.item.mediaKey &&
      item.dedupKey === binding.item.dedupKey &&
      item.provider === binding.provider
    ) {
      return true
    }
  }
  return false
}

export interface OriginalContentHashResult {
  mediaKey: string
  scopeFingerprint: string
  contentHash: ContentHashEvidence & {
    algorithm: "sha256"
    verificationSource: "local-original-bytes"
  }
  byteLength: number
  mimeType?: string
}

export interface VideoPlaybackResult {
  mediaKey: string
  scopeFingerprint: string
  playbackUrl: string
  mimeType?: string
  expiresAt?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isMimeType(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value)
  )
}

export function isAllowedProviderPlaybackUrl(
  provider: PhotoProvider,
  value: unknown
): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) {
    return false
  }
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const allowedHost =
      provider === "google"
        ? host === "video-downloads.googleusercontent.com"
        : provider === "amazon"
          ? host === "download-photos.amazon.ca"
          : host === "icloud-content.com" ||
            host.endsWith(".icloud-content.com") ||
            host === "icloud-content.com.cn" ||
            host.endsWith(".icloud-content.com.cn")
    return (
      url.protocol === "https:" &&
      (url.port === "" || url.port === "443") &&
      !url.username &&
      !url.password &&
      !url.hash &&
      allowedHost
    )
  } catch {
    return false
  }
}

export function validateOriginalContentHashResult(
  value: unknown,
  expected: {
    mediaKey: string
    scopeFingerprint: string
    mediaKind?: GpdMediaItem["mediaKind"]
  }
): OriginalContentHashResult {
  if (!isRecord(value) || value.mediaKey !== expected.mediaKey) {
    throw new Error("The provider hash result did not match the reviewed item.")
  }
  if (
    value.scopeFingerprint !== expected.scopeFingerprint ||
    !isRecord(value.contentHash) ||
    value.playbackUrl !== undefined ||
    value.resourceUrl !== undefined
  ) {
    throw new Error("The provider hash result did not match the current review scope.")
  }
  const hash = value.contentHash
  const contentRole = hash.contentRole
  if (
    hash.algorithm !== "sha256" ||
    hash.provenance !== "original-content" ||
    hash.verificationSource !== "local-original-bytes" ||
    typeof hash.value !== "string" ||
    !/^[a-f0-9]{64}$/.test(hash.value) ||
    (contentRole !== undefined &&
      contentRole !== "single-file" &&
      contentRole !== "live-photo-still") ||
    (expected.mediaKind === "live-photo" &&
      contentRole !== undefined &&
      contentRole !== "live-photo-still") ||
    ((expected.mediaKind === "photo" || expected.mediaKind === "video") &&
      contentRole === "live-photo-still")
  ) {
    throw new Error("The provider did not return a verified original-byte SHA-256.")
  }
  if (
    !Number.isSafeInteger(value.byteLength) ||
    (value.byteLength as number) < 1 ||
    (value.byteLength as number) > MAX_ORIGINAL_BYTES_PER_ITEM
  ) {
    throw new Error("The provider hash result had an invalid original byte length.")
  }
  if (value.mimeType !== undefined && !isMimeType(value.mimeType)) {
    throw new Error("The provider hash result had an invalid media type.")
  }
  return {
    mediaKey: expected.mediaKey,
    scopeFingerprint: expected.scopeFingerprint,
    contentHash: {
      value: hash.value,
      algorithm: "sha256",
      provenance: "original-content",
      verificationSource: "local-original-bytes",
      ...(contentRole === "single-file" || contentRole === "live-photo-still"
        ? { contentRole }
        : {})
    },
    byteLength: value.byteLength as number,
    ...(typeof value.mimeType === "string" ? { mimeType: value.mimeType } : {})
  }
}

export function validateVideoPlaybackResult(
  provider: PhotoProvider,
  value: unknown,
  expected: { mediaKey: string; scopeFingerprint: string }
): VideoPlaybackResult {
  if (
    !isRecord(value) ||
    value.mediaKey !== expected.mediaKey ||
    value.scopeFingerprint !== expected.scopeFingerprint ||
    !isAllowedProviderPlaybackUrl(provider, value.playbackUrl)
  ) {
    throw new Error("The provider did not return a scoped, approved video resource.")
  }
  if (value.mimeType !== undefined && !isMimeType(value.mimeType)) {
    throw new Error("The provider video result had an invalid media type.")
  }
  if (
    value.mimeType !== undefined &&
    (typeof value.mimeType !== "string" ||
      !value.mimeType.toLowerCase().startsWith("video/"))
  ) {
    throw new Error("The provider resource was not identified as video.")
  }
  if (
    value.expiresAt !== undefined &&
    (!Number.isSafeInteger(value.expiresAt) ||
      (value.expiresAt as number) <= Date.now())
  ) {
    throw new Error("The provider video resource is expired or has an invalid expiry. Retry to request a fresh video.")
  }
  return {
    mediaKey: expected.mediaKey,
    scopeFingerprint: expected.scopeFingerprint,
    playbackUrl: value.playbackUrl,
    ...(typeof value.mimeType === "string" ? { mimeType: value.mimeType } : {}),
    ...(Number.isFinite(value.expiresAt)
      ? { expiresAt: value.expiresAt as number }
      : {})
  }
}

export function safeProviderRetrievalError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? "")
  if (!message || /https?:\/\/|[?&](?:signature|token|ownerId)=/i.test(message)) {
    return "The provider could not complete this original-media request safely. The item remains unverified."
  }
  return message.slice(0, 300)
}
