import type { MediaKind } from "./types"

export const GOOGLE_ORIGINAL_ITEM_MAX_BYTES = 25 * 1024 * 1024
export const GOOGLE_ORIGINAL_REVIEW_MAX_BYTES = 100 * 1024 * 1024

export type GoogleOriginalMediaKind = Extract<MediaKind, "photo" | "video" | "live-photo">

export interface GoogleOriginalHashEvidence {
  value: string
  algorithm: "sha256"
  provenance: "original-content"
  verificationSource: "local-original-bytes"
  contentRole?: "single-file" | "live-photo-still"
}

export interface GoogleOriginalHashData {
  mediaKey: string
  scopeFingerprint: string
  contentHash: GoogleOriginalHashEvidence
  byteLength: number
  mimeType: string
}

export interface GoogleOriginalBudgetReservation {
  readonly maxBytes: number
  start(): void
  consume(byteLength: number): void
  complete(byteLength: number): void
  release(): void
}

interface ReviewBudget {
  limitBytes: number
  bytesRead: number
  bytesReserved: number
}

/**
 * Session-worker memory budget. The first retrieval freezes the caller's
 * review cap for that session/scope. Concurrent calls reserve bytes before
 * they start consuming response bodies.
 */
export class GoogleOriginalReviewBudget {
  private readonly reviews = new Map<string, ReviewBudget>()

  reserve(
    reviewKey: string,
    requestedMaxBytes: unknown,
    requestedReviewBudgetBytes: unknown,
    expectedByteLength?: unknown
  ): GoogleOriginalBudgetReservation {
    if (!reviewKey || reviewKey.length > 2048) {
      throw new Error("The Google Photos review identity is invalid.")
    }
    if (
      !Number.isSafeInteger(requestedMaxBytes) ||
      (requestedMaxBytes as number) < 1 ||
      (requestedMaxBytes as number) > GOOGLE_ORIGINAL_ITEM_MAX_BYTES
    ) {
      throw new Error("The Google Photos original limit must be between 1 byte and 25 MiB.")
    }
    if (
      !Number.isSafeInteger(requestedReviewBudgetBytes) ||
      (requestedReviewBudgetBytes as number) < 1 ||
      (requestedReviewBudgetBytes as number) > GOOGLE_ORIGINAL_REVIEW_MAX_BYTES
    ) {
      throw new Error("The Google Photos review limit must be between 1 byte and 100 MiB.")
    }

    const knownLength = Number.isSafeInteger(expectedByteLength)
      ? (expectedByteLength as number)
      : undefined
    if (
      expectedByteLength !== undefined &&
      (!Number.isSafeInteger(expectedByteLength) ||
        (expectedByteLength as number) < 1)
    ) {
      throw new Error("Google Photos returned an invalid original file size.")
    }

    const existingReview = this.reviews.get(reviewKey)
    if (existingReview && existingReview.limitBytes !== requestedReviewBudgetBytes) {
      throw new Error("The Google Photos review byte budget changed. Start a new review before retrieving originals.")
    }
    if (!existingReview && this.reviews.size >= 32) {
      throw new Error("Too many Google Photos review scopes are active.")
    }
    const review = existingReview ?? {
      limitBytes: requestedReviewBudgetBytes as number,
      bytesRead: 0,
      bytesReserved: 0
    }

    const remaining = review.limitBytes - review.bytesRead - review.bytesReserved
    const maxBytes = Math.min(requestedMaxBytes as number, remaining)
    if (maxBytes < 1) {
      throw new Error("The Google Photos review has reached its approved original-fetch budget.")
    }
    if (knownLength === 0) {
      throw new Error("Google Photos did not report a nonempty original file size.")
    }
    if (knownLength !== undefined && knownLength > maxBytes) {
      throw new Error("The Google Photos original exceeds the remaining approved byte budget.")
    }
    if (!existingReview) this.reviews.set(reviewKey, review)
    const reservedBytes = knownLength ?? maxBytes
    review.bytesReserved += reservedBytes

    let settled = false
    let started = false
    let bytesConsumed = 0
    return {
      maxBytes: reservedBytes,
      start: () => {
        if (!settled) started = true
      },
      consume: (byteLength: number) => {
        if (!settled && Number.isSafeInteger(byteLength) && byteLength > 0) {
          bytesConsumed += byteLength
        }
      },
      complete: (byteLength: number) => {
        if (settled) return
        settled = true
        review!.bytesReserved = Math.max(0, review!.bytesReserved - reservedBytes)
        const validLength = Number.isSafeInteger(byteLength) && byteLength > 0
        review!.bytesRead += validLength
          ? Math.max(bytesConsumed, byteLength)
          : started
            ? Math.max(reservedBytes, bytesConsumed)
            : bytesConsumed
      },
      release: () => {
        if (settled) return
        settled = true
        review!.bytesReserved = Math.max(0, review!.bytesReserved - reservedBytes)
        if (started) {
          review!.bytesRead += Math.max(reservedBytes, bytesConsumed)
        }
      }
    }
  }

  clear(): void {
    this.reviews.clear()
  }
}

function isSafeResourcePath(pathname: string): boolean {
  if (
    pathname.length === 0 ||
    pathname.length > 2048 ||
    !pathname.startsWith("/") ||
    pathname.includes("\\") ||
    /[\u0000-\u0020\u007f]/.test(pathname) ||
    /%(?:2f|2F|5c|5C)/.test(pathname)
  ) {
    return false
  }
  try {
    let current = pathname
    for (let depth = 0; depth < 4; depth += 1) {
      const segments = current.split("/")
      if (segments.some((segment) => segment === "." || segment === "..")) {
        return false
      }
      const decoded = decodeURIComponent(current)
      if (decoded === current) return true
      current = decoded
    }
    return false
  } catch {
    return false
  }
}

function rawPathFromUrl(value: string): string | null {
  const match = value.match(/^https:\/\/[^/?#]+([^?#]*)/i)
  return match ? match[1] || "/" : null
}

function parseGoogleOriginalUrl(value: unknown, mediaKind: GoogleOriginalMediaKind): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) {
    throw new Error("Google Photos did not provide an approved original resource.")
  }
  const rawPath = rawPathFromUrl(value)
  if (!rawPath || !isSafeResourcePath(rawPath)) {
    throw new Error("Google Photos returned an original resource with an unsafe path.")
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Google Photos returned an invalid original resource.")
  }
  const expectedHost =
    mediaKind === "video"
      ? "video-downloads.googleusercontent.com"
      : "lh3.google.com"
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== expectedHost ||
    (url.port !== "" && url.port !== "443") ||
    url.username ||
    url.password ||
    url.hash ||
    !isSafeResourcePath(url.pathname)
  ) {
    throw new Error("Google Photos returned an original resource outside the approved route.")
  }
  return url
}

function validateFinalResourceUrl(
  value: string,
  initialUrl: URL,
  mediaKind: GoogleOriginalMediaKind
): void {
  const rawPath = rawPathFromUrl(value)
  if (!rawPath || !isSafeResourcePath(rawPath)) {
    throw new Error("Google Photos returned an unsafe final original resource path.")
  }
  let finalUrl: URL
  try {
    finalUrl = new URL(value)
  } catch {
    throw new Error("Google Photos returned an invalid final original resource.")
  }
  const allowedHost =
    mediaKind === "video"
      ? "video-downloads.googleusercontent.com"
      : "lh3.googleusercontent.com"
  if (
    finalUrl.protocol !== "https:" ||
    finalUrl.hostname.toLowerCase() !== allowedHost ||
    (finalUrl.port !== "" && finalUrl.port !== "443") ||
    finalUrl.username ||
    finalUrl.password ||
    finalUrl.hash ||
    !isSafeResourcePath(finalUrl.pathname) ||
    (mediaKind === "video" && finalUrl.origin !== initialUrl.origin)
  ) {
    throw new Error("Google Photos redirected the original outside the approved final resource host.")
  }
}

function parseContentLength(value: string | null, maxBytes: number): number | undefined {
  if (value === null) return undefined
  if (!/^\d{1,12}$/.test(value)) {
    throw new Error("Google Photos returned an invalid original content length.")
  }
  const length = Number(value)
  if (!Number.isSafeInteger(length) || length < 1 || length > maxBytes) {
    throw new Error("The Google Photos original exceeds the approved byte limit.")
  }
  return length
}

function expectedMimePrefix(mediaKind: GoogleOriginalMediaKind): "image/" | "video/" {
  return mediaKind === "video" ? "video/" : "image/"
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Original media retrieval was cancelled.", "AbortError")
  }
}

/** Fetch and hash only the exact Google provider resource for one scanned item. */
export async function fetchGoogleOriginalHash(params: {
  resourceUrl: unknown
  mediaKey: string
  scopeFingerprint: string
  mediaKind: GoogleOriginalMediaKind
  maxBytes: number
  expectedByteLength?: number
  expectedMimeType?: string
  signal?: AbortSignal
  fetcher?: typeof fetch
  subtle?: Pick<SubtleCrypto, "digest">
  onFetchStart?: () => void
  onBytesReceived?: (byteLength: number) => void
}): Promise<GoogleOriginalHashData> {
  const initialUrl = parseGoogleOriginalUrl(params.resourceUrl, params.mediaKind)
  if (
    !params.mediaKey ||
    params.mediaKey.length > 512 ||
    !params.scopeFingerprint ||
    params.scopeFingerprint.length > 512 ||
    !Number.isSafeInteger(params.maxBytes) ||
    params.maxBytes < 1 ||
    params.maxBytes > GOOGLE_ORIGINAL_ITEM_MAX_BYTES
  ) {
    throw new Error("The Google Photos original request did not match its approved scope and byte limit.")
  }
  if (
    params.expectedByteLength !== undefined &&
    (!Number.isSafeInteger(params.expectedByteLength) ||
      params.expectedByteLength < 1 ||
      params.expectedByteLength > params.maxBytes)
  ) {
    throw new Error("Google Photos returned an invalid or oversized original file size.")
  }
  throwIfAborted(params.signal)
  const fetcher = params.fetcher ?? fetch
  params.onFetchStart?.()
  const response = await fetcher(initialUrl.toString(), {
    method: "GET",
    credentials: params.mediaKind === "video" ? "omit" : "include",
    cache: "no-store",
    redirect: "follow",
    signal: params.signal
  })
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const chunks: Uint8Array[] = []
  let bytes: Uint8Array | undefined
  let bodyConsumed = false
  let byteLength = 0
  try {
    throwIfAborted(params.signal)
    if (!response.ok || response.status !== 200) {
      throw new Error("Google Photos did not return the original media file.")
    }
    validateFinalResourceUrl(response.url, initialUrl, params.mediaKind)

    const maxBytes = params.maxBytes
    const declaredLength = parseContentLength(
      response.headers.get("content-length"),
      maxBytes
    )
    const mimeType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase()
    if (
      !mimeType ||
      !/^image\/[a-z0-9.+-]+$|^video\/[a-z0-9.+-]+$/i.test(mimeType) ||
      !mimeType.startsWith(expectedMimePrefix(params.mediaKind))
    ) {
      throw new Error("Google Photos did not identify the original as the scanned media type.")
    }
    if (
      params.expectedMimeType &&
      params.expectedMimeType.toLowerCase() !== mimeType
    ) {
      throw new Error("Google Photos returned a media type that differs from the scanned original.")
    }
    if (!response.body) {
      throw new Error("Google Photos returned no readable original media stream.")
    }
    reader = response.body.getReader()
    while (true) {
      throwIfAborted(params.signal)
      const { done, value } = await reader.read()
      if (done) {
        bodyConsumed = true
        break
      }
      if (!value?.byteLength) continue
      params.onBytesReceived?.(value.byteLength)
      if (byteLength + value.byteLength > maxBytes) {
        throw new Error("The Google Photos original exceeded the approved streamed byte limit.")
      }
      byteLength += value.byteLength
      chunks.push(value)
    }
    throwIfAborted(params.signal)
    if (byteLength < 1 || (declaredLength !== undefined && declaredLength !== byteLength)) {
      throw new Error("Google Photos returned an incomplete or inconsistent original file.")
    }
    if (
      Number.isSafeInteger(params.expectedByteLength) &&
      params.expectedByteLength !== byteLength
    ) {
      throw new Error("Google Photos returned bytes that differ from the scanned original size.")
    }

    bytes = new Uint8Array(byteLength)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const subtle = params.subtle ?? globalThis.crypto?.subtle
    if (!subtle?.digest) {
      throw new Error("SHA-256 is unavailable in the current extension context.")
    }
    const digest = new Uint8Array(await subtle.digest("SHA-256", bytes))
    throwIfAborted(params.signal)
    let value = ""
    for (const byte of digest) value += byte.toString(16).padStart(2, "0")
    return {
      mediaKey: params.mediaKey,
      scopeFingerprint: params.scopeFingerprint,
      contentHash: {
        value,
        algorithm: "sha256",
        provenance: "original-content",
        verificationSource: "local-original-bytes",
        ...(params.mediaKind === "live-photo"
          ? { contentRole: "live-photo-still" as const }
          : { contentRole: "single-file" as const })
      },
      byteLength,
      mimeType
    }
  } catch (error) {
    if (!bodyConsumed) {
      if (reader) await reader.cancel().catch(() => {})
      else await response.body?.cancel().catch(() => {})
    }
    throw error
  } finally {
    bytes?.fill(0)
    for (const chunk of chunks) chunk.fill(0)
    try {
      reader?.releaseLock()
    } catch {
      // A pending read or cancellation can keep the reader locked briefly.
    }
  }
}
