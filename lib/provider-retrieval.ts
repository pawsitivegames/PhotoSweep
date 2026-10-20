import type {
  ContentHashEvidence,
  GpdMediaItem,
  PhotoProvider
} from "./types"
import { AMAZON_VIDEO_DOWNLOAD_HOST } from "./provider-sites"

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
    item.provider === "google" &&
    item.originalContentVerificationCapability === "unknown"
  ) {
    return null
  }
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

export function getProviderRetrievalSessionError(
  response: { success: boolean; providerSessionId?: string },
  expectedProviderSessionId: string
): string | null {
  if (response.providerSessionId === expectedProviderSessionId) return null
  if (!response.success && response.providerSessionId === undefined) return null
  return "The provider returned a result from a different page session. The item remains unverified."
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
  return (typeof value === "string" &&
  value.length <= 128 && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value));
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
    const amazonRouteIsApproved =
      provider !== "amazon" ||
      (host === AMAZON_VIDEO_DOWNLOAD_HOST &&
        /^\/v2\/download\/signed\/[^/]+\/alt\/video_transcode$/.test(
          url.pathname
        ) &&
        url.searchParams.getAll("ownerId").length === 1 &&
        Boolean(url.searchParams.get("ownerId")) &&
        url.searchParams.getAll("y").length === 1 &&
        url.searchParams.get("y") === "720" &&
        [...url.searchParams.keys()].length === 2)
    const allowedHost =
      provider === "google"
        ? host === "video-downloads.googleusercontent.com"
        : provider === "amazon"
          ? host === AMAZON_VIDEO_DOWNLOAD_HOST
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
      allowedHost &&
      amazonRouteIsApproved
    )
  } catch {
    return false
  }
}

export const MAX_AMAZON_VIDEO_PLAYBACK_BYTES = 128 * 1024 * 1024
const AMAZON_VIDEO_PLAYBACK_TIMEOUT_MS = 180_000

function amazonVideoPlaybackAbortError(
  callerSignal: AbortSignal,
  timeoutSignal: AbortSignal
): Error | null {
  if (callerSignal.aborted) {
    return new DOMException("Amazon Photos video playback was cancelled.", "AbortError")
  }
  if (timeoutSignal.aborted) {
    return new Error("Amazon Photos video playback timed out. Open this video in Amazon Photos.")
  }
  return null
}

export async function fetchAmazonVideoPlaybackBlob(
  playbackUrl: string,
  signal: AbortSignal,
  options: { maxBytes?: number } = {}
): Promise<Blob> {
  const maxBytes = Math.min(
    options.maxBytes ?? MAX_AMAZON_VIDEO_PLAYBACK_BYTES,
    MAX_AMAZON_VIDEO_PLAYBACK_BYTES
  )
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    !isAllowedProviderPlaybackUrl("amazon", playbackUrl)
  ) {
    throw new Error("Amazon Photos did not return an approved video stream.")
  }
  if (signal.aborted) {
    throw new DOMException("Amazon Photos video playback was cancelled.", "AbortError")
  }

  const timeoutSignal = AbortSignal.timeout(AMAZON_VIDEO_PLAYBACK_TIMEOUT_MS)
  const requestSignal = AbortSignal.any([signal, timeoutSignal])
  let response: Response
  try {
    response = await fetch(playbackUrl, {
      credentials: "include",
      redirect: "error",
      signal: requestSignal
    })
  } catch (error) {
    throw amazonVideoPlaybackAbortError(signal, timeoutSignal) ?? error
  }
  let contentType = ""
  let contentLength: number | null = null
  let expectedPartialLength: number | null = null
  try {
    if (!response.ok || (response.status !== 200 && response.status !== 206)) {
      throw new Error("Amazon Photos could not provide the selected video.")
    }
    if (response.url) {
      let responseUrl: URL
      try {
        responseUrl = new URL(response.url)
      } catch {
        throw new Error("Amazon Photos returned an invalid video response.")
      }
      if (
        responseUrl.origin !== `https://${AMAZON_VIDEO_DOWNLOAD_HOST}` ||
        !isAllowedProviderPlaybackUrl("amazon", responseUrl.href)
      ) {
        throw new Error("Amazon Photos redirected the video outside its approved media route.")
      }
    }

    const responseContentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      ?.toLowerCase()
    if (!responseContentType?.startsWith("video/")) {
      throw new Error("Amazon Photos returned a non-video response.")
    }
    contentType = responseContentType

    const contentLengthHeader = response.headers.get("content-length")
    contentLength =
      contentLengthHeader && /^\d+$/.test(contentLengthHeader)
        ? Number(contentLengthHeader)
        : null
    if (
      (contentLengthHeader !== null && contentLength === null) ||
      (contentLength !== null && contentLength > maxBytes)
    ) {
      throw new Error("This Amazon video is too large for in-app playback. Open it in Amazon Photos.")
    }

    if (response.status === 206) {
      const range = response.headers.get("content-range")
      const match = range?.match(/^bytes 0-(\d+)\/(\d+)$/i)
      if (!match || Number(match[2]) > maxBytes) {
        throw new Error("Amazon Photos returned only part of the selected video.")
      }
      expectedPartialLength = Number(match[2])
      if (Number(match[1]) + 1 !== expectedPartialLength) {
        throw new Error("Amazon Photos returned only part of the selected video.")
      }
    }
  } catch (error) {
    try {
      await response.body?.cancel()
    } catch {
      // Header validation remains the primary error even if stream cancellation fails.
    }
    throw error
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error("Amazon Photos returned an unreadable video response.")
  }
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const abortError = amazonVideoPlaybackAbortError(signal, timeoutSignal)
      if (abortError) {
        throw abortError
      }
      const result = await reader.read()
      if (result.done) break
      if (!result.value) continue
      byteLength += result.value.byteLength
      if (byteLength > maxBytes) {
        throw new Error("This Amazon video is too large for in-app playback. Open it in Amazon Photos.")
      }
      chunks.push(result.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    for (const chunk of chunks) chunk.fill(0)
    throw amazonVideoPlaybackAbortError(signal, timeoutSignal) ?? error
  } finally {
    reader.releaseLock()
  }

  try {
    const abortError = amazonVideoPlaybackAbortError(signal, timeoutSignal)
    if (abortError) throw abortError
    if (
      byteLength === 0 ||
      (contentLength !== null && byteLength !== contentLength) ||
      (expectedPartialLength !== null && byteLength !== expectedPartialLength)
    ) {
      throw new Error("Amazon Photos returned an incomplete video response.")
    }
    const parts: BlobPart[] = chunks.map((chunk) => {
      const buffer = chunk.buffer
      if (!(buffer instanceof ArrayBuffer)) {
        throw new Error("Amazon Photos returned an unsupported video buffer.")
      }
      return new Uint8Array(buffer, chunk.byteOffset, chunk.byteLength)
    })
    return new Blob(parts, { type: contentType })
  } finally {
    for (const chunk of chunks) chunk.fill(0)
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
