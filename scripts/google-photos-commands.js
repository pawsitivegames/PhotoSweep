// MAIN world command handler for Google Photos pages.
// This script runs in the page's JS context (injected via <script> tag)
// and has access to GPTK globals: window.gptkApi, window.gptkCore, window.gptkApiUtils.
//
// Communication with the extension happens via window.postMessage.
// The bridge content script (google-photos-bridge.ts) relays these to chrome.runtime.

(() => {
  if (window.__GPD_GOOGLE_COMMAND_HANDLER_LOADED__) {
    console.log("GPD: Command handler already loaded")
    return
  }
  window.__GPD_GOOGLE_COMMAND_HANDLER_LOADED__ = true

const commandHost = window.__GPD_COMMAND_HOST__
if (!commandHost) {
  console.error("GPD: Shared command host is not loaded")
  return
}
const {
  postResult,
  postError,
  postProgress,
  dateRangeBounds,
  isTimestampInDateRange,
  classifyProviderFailure,
  createProviderHealth
} = commandHost

// Number of items per API request for restore operations.
// Matches GPTK's default operationSize. Large single requests cause HTTP 504.
const RESTORE_BATCH_SIZE = 250

// Conservative default for destructive trash operations. The app can pass a
// smaller value, but never a larger one.
const TRASH_BATCH_SIZE = 25
const TRASH_RETRY_COUNT = 2
const TRASH_RETRY_BACKOFF_MS = 0
const TRASH_CHUNK_TIMEOUT_MS = 30_000
const MEDIA_PAGE_TIMEOUT_MS = 20_000
const GOOGLE_FAVORITE_PREFLIGHT_TIMEOUT_MS = 15_000
const MEDIA_PAGE_RETRY_COUNT = 2
const MEDIA_PAGE_RETRY_BACKOFF_MS = 1000
const GOOGLE_ORIGINAL_TIMEOUT_MS = 30_000
const GOOGLE_REVIEW_BUDGET_SCOPE_MAX = 128
const GOOGLE_ORIGINAL_HOSTS = new Set(["lh3.google.com"])
const GOOGLE_VIDEO_HOSTS = new Set([
  "video-downloads.googleusercontent.com"
])

function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

function normalizeTrashBatchSize(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return TRASH_BATCH_SIZE
  return Math.min(Math.floor(parsed), TRASH_BATCH_SIZE)
}

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.floor(parsed)
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout(promise, ms, label, signal) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `${label} timed out after ${Math.round(ms / 1000)}s. Google's API likely stalled — please retry.`
          )
        ),
      ms
    )
  })
  const pending = [promise, timeout]
  let onAbort
  if (signal) {
    pending.push(
      new Promise((_, reject) => {
        onAbort = () => reject(commandHost.createAbortError())
        if (signal.aborted) onAbort()
        else signal.addEventListener("abort", onAbort, { once: true })
      })
    )
  }
  return Promise.race(pending).finally(() => {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener("abort", onAbort)
  })
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function normalizeGoogleContinuationCursor(value) {
  // GPTK uses an empty string for a terminal page in the live Photos API.
  // Treat that sentinel the same as null/undefined so the final nonempty page
  // is still counted and returned to the scanner.
  if (value === undefined || value === null || value === "") {
    return { valid: true, cursor: null }
  }
  if (
    typeof value !== "string" ||
    value.length > 8192 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return { valid: false, cursor: null }
  }
  return { valid: true, cursor: value }
}

function normalizeGoogleMediaPage(page) {
  if (
    !isPlainObject(page) ||
    !Array.isArray(page.items) ||
    page.items.length > 1000
  ) {
    return null
  }
  const continuation = normalizeGoogleContinuationCursor(page.nextPageId)
  if (!continuation.valid || (page.items.length === 0 && continuation.cursor)) {
    return null
  }
  return { items: page.items, nextPageId: continuation.cursor }
}

function googleProviderMediaKey(item) {
  return (
    isPlainObject(item) &&
    typeof item.mediaKey === "string" &&
    item.mediaKey.length > 0
  )
    ? item.mediaKey
    : null
}

function hasGoogleMediaIdentity(item) {
  return (
    googleProviderMediaKey(item) !== null &&
    typeof item.dedupKey === "string" &&
    item.dedupKey.length > 0 &&
    typeof item.thumb === "string" &&
    item.thumb.length > 0
  )
}

async function fetchGooglePageWithRetry(fetchPage, label, signal) {
  let lastError
  for (let attempt = 0; attempt <= MEDIA_PAGE_RETRY_COUNT; attempt += 1) {
    commandHost.throwIfAborted(signal)
    try {
      return await withTimeout(
        Promise.resolve().then(fetchPage),
        MEDIA_PAGE_TIMEOUT_MS,
        label,
        signal
      )
    } catch (error) {
      lastError = error
      if (signal?.aborted) throw error
      if (attempt >= MEDIA_PAGE_RETRY_COUNT) break
      await commandHost.delay(
        MEDIA_PAGE_RETRY_BACKOFF_MS * (attempt + 1),
        signal
      )
    }
  }
  throw lastError
}

function hasSuccessMarker(values) {
  return values.some((value) => {
    if (value === true || value === 1) return true
    if (typeof value !== "string") return false
    return /^(ok|success|successful|done|moved|trashed)$/i.test(value)
  })
}

function hasFailureMarker(values) {
  return values.some((value) => {
    if (value === false || value === 0) return true
    if (typeof value !== "string") return false
    return /^(error|failed|failure|denied|not_found|not-found)$/i.test(value)
  })
}

function collectTrashStatuses(node, keySet, statuses) {
  if (Array.isArray(node)) {
    const values = node.flatMap((value) =>
      isPlainObject(value) || Array.isArray(value) ? [] : [value]
    )
    const keys = values.filter((value) => keySet.has(value))
    if (keys.length > 0) {
      const success = hasSuccessMarker(values)
      const failure = hasFailureMarker(values)
      if (success || failure) {
        for (const key of keys) statuses.set(key, success && !failure)
      }
    }
    for (const child of node) collectTrashStatuses(child, keySet, statuses)
    return
  }

  if (!isPlainObject(node)) return

  const values = Object.values(node)
  const keys = values.filter((value) => keySet.has(value))
  if (keys.length > 0) {
    const success = hasSuccessMarker(values)
    const failure = hasFailureMarker(values)
    if (success || failure) {
      for (const key of keys) statuses.set(key, success && !failure)
    }
  }

  for (const field of [
    "movedDedupKeys",
    "trashedDedupKeys",
    "successfulDedupKeys",
    "succeededDedupKeys"
  ]) {
    if (Array.isArray(node[field])) {
      for (const key of node[field]) {
        if (keySet.has(key)) statuses.set(key, true)
      }
    }
  }
  for (const field of [
    "failedDedupKeys",
    "errorDedupKeys",
    "rejectedDedupKeys"
  ]) {
    if (Array.isArray(node[field])) {
      for (const key of node[field]) {
        if (keySet.has(key)) statuses.set(key, false)
      }
    }
  }

  for (const child of values) collectTrashStatuses(child, keySet, statuses)
}

function createPartialTrashError(message, movedDedupKeys) {
  const error = new Error(message)
  error.gpdMovedDedupKeys = movedDedupKeys
  return error
}

function analyzeTrashResponse(response, chunk) {
  if (chunk.length === 0) return []

  // GPTK historically returned undefined/empty status on success. Preserve that
  // compatibility path, but use structured status data whenever Google returns it.
  if (
    response === undefined ||
    response === null ||
    response === true ||
    (Array.isArray(response) && response.length === 0)
  ) {
    return chunk
  }
  if (response === false) {
    throw createPartialTrashError(
      "Google Photos reported trash batch failure",
      []
    )
  }

  const keySet = new Set(chunk)
  const statuses = new Map()
  collectTrashStatuses(response, keySet, statuses)

  // Some APIs return a bare list of successful keys. Treat that as explicit
  // evidence and fail closed if it does not cover the full requested chunk.
  if (
    statuses.size === 0 &&
    Array.isArray(response) &&
    response.every((value) => keySet.has(value))
  ) {
    for (const key of response) statuses.set(key, true)
  }

  if (statuses.size === 0) return chunk

  const movedDedupKeys = chunk.filter((key) => statuses.get(key) === true)
  if (movedDedupKeys.length !== chunk.length) {
    throw createPartialTrashError(
      `Google Photos reported ${movedDedupKeys.length} of ${chunk.length} items moved in a trash batch`,
      movedDedupKeys
    )
  }
  return movedDedupKeys
}

async function moveTrashChunkWithRetry(api, chunk, options) {
  let attempt = 0
  let lastError
  while (attempt <= options.retryCount) {
    try {
      const response = await withTimeout(
        api.moveItemsToTrash(chunk),
        options.chunkTimeoutMs,
        `Moving trash chunk of ${chunk.length} item${chunk.length !== 1 ? "s" : ""}`
      )
      return {
        attempts: attempt + 1,
        movedDedupKeys: analyzeTrashResponse(response, chunk)
      }
    } catch (error) {
      lastError = error
      if (error?.gpdMovedDedupKeys?.length > 0) break
      if (attempt >= options.retryCount) break
      const delay = options.retryBackoffMs * Math.pow(2, attempt)
      console.warn(
        `[GPD] trash chunk failed, retrying (${attempt + 1}/${options.retryCount}) after ${delay}ms:`,
        error
      )
      await sleep(delay)
      attempt++
    }
  }
  if (lastError && typeof lastError === "object") {
    lastError.gpdRetryAttempts = attempt
  }
  throw lastError
}

function mediaKeysForDedupKeys(movedDedupKeys, dedupKeys, mediaKeys) {
  const moved = new Set(movedDedupKeys)
  return dedupKeys
    .map((key, index) => (moved.has(key) ? mediaKeys[index] : null))
    .filter(Boolean)
}

async function readGoogleMutationKeys(api, source, signal) {
  const getter =
    source === "trash"
      ? api?.getTrashItems?.bind(api)
      : window.gptkApi?.getItemsByUploadedDate?.bind(window.gptkApi)
  if (typeof getter !== "function") {
    return {
      keys: new Set(),
      complete: false,
      error: new Error(
        source === "trash"
          ? "Google Photos does not expose paginated Trash state."
          : "Google Photos does not expose paginated library state."
      )
    }
  }

  const keys = new Set()
  const seenPageIds = new Set()
  const seenPageSignatures = new Set()
  let pageId = null
  for (let pageNumber = 0; pageNumber < 10_000; pageNumber++) {
    let page
    try {
      page = await withTimeout(
        Promise.resolve().then(() => getter(pageId)),
        MEDIA_PAGE_TIMEOUT_MS,
        `Reading Google Photos ${source} state`,
        signal
      )
    } catch (error) {
      return { keys, complete: false, error }
    }

    if (!page || !Array.isArray(page.items) || page.items.length > 1000) {
      return {
        keys,
        complete: false,
        error: new Error(`Google Photos returned an invalid ${source} state page.`)
      }
    }
    const pageKeys = []
    for (const item of page.items) {
      const key = item?.dedupKey
      if (typeof key !== "string" || key.length === 0 || keys.has(key)) {
        return {
          keys,
          complete: false,
          error: new Error(`Google Photos returned an invalid ${source} item identity.`)
        }
      }
      pageKeys.push(key)
      keys.add(key)
    }
    const signature = JSON.stringify(pageKeys)
    if (seenPageSignatures.has(signature)) {
      return {
        keys,
        complete: false,
        error: new Error(`Google Photos repeated a ${source} state page.`)
      }
    }
    seenPageSignatures.add(signature)

    const nextPageId = page.nextPageId
    if (nextPageId === undefined || nextPageId === null || nextPageId === "") {
      return { keys, complete: true }
    }
    if (
      typeof nextPageId !== "string" ||
      page.items.length === 0 ||
      seenPageIds.has(nextPageId)
    ) {
      return {
        keys,
        complete: false,
        error: new Error(`Google Photos returned an invalid ${source} continuation cursor.`)
      }
    }
    seenPageIds.add(nextPageId)
    pageId = nextPageId
  }
  return {
    keys,
    complete: false,
    error: new Error(`Google Photos ${source} state exceeded the verification page limit.`)
  }
}

function setMutationOutcome(statuses, operation, targetKey, status, reason) {
  statuses.set(targetKey, {
    operation,
    targetKey,
    status,
    ...(reason ? { reason } : {})
  })
}

function googleExplicitNoEffect(errorOrResponse) {
  if (errorOrResponse === false) return true
  if (errorOrResponse && typeof errorOrResponse === "object") {
    if (
      errorOrResponse.success === false ||
      errorOrResponse.ok === false ||
      errorOrResponse.status === "failed" ||
      errorOrResponse.status === "error" ||
      typeof errorOrResponse.error === "string"
    ) {
      return true
    }
  }
  const status = Number(errorOrResponse?.status)
  if ([400, 401, 403, 404, 409, 422, 429].includes(status)) return true
  const message = String(errorOrResponse?.message || errorOrResponse || "")
  return /\bHTTP\s+(?:400|401|403|404|409|422|429)\b/i.test(message)
}

function publishGoogleMutation(
  command,
  requestId,
  operation,
  dedupKeys,
  statuses,
  mediaKeysToTrash,
  dispatchedKeys
) {
  for (const key of dedupKeys) {
    if (!statuses.has(key)) {
      setMutationOutcome(
        statuses,
        operation,
        key,
        "failed",
        "not-dispatched"
      )
    }
  }
  const outcomes = dedupKeys.map((key) => statuses.get(key))
  const confirmed = outcomes
    .filter((outcome) => outcome.status === "confirmed")
    .map((outcome) => outcome.targetKey)
  const unknown = outcomes
    .filter((outcome) => outcome.status === "unknown")
    .map((outcome) => outcome.targetKey)
  const noOp = outcomes
    .filter((outcome) => /-noop$/.test(outcome.reason || ""))
    .map((outcome) => outcome.targetKey)
  const data =
    operation === "trash"
      ? {
          partial: confirmed.length > 0 && confirmed.length < dedupKeys.length,
          trashedCount: confirmed.length,
          trashedKeys: mediaKeysForDedupKeys(
            confirmed,
            dedupKeys,
            mediaKeysToTrash
          ),
          trashedDedupKeys: confirmed,
          notDispatchedDedupKeys: dedupKeys.filter((key) => !dispatchedKeys.has(key)),
          noOpDedupKeys: noOp,
          unknownDedupKeys: unknown,
          outcomes,
          retryAttempts: 0
        }
      : {
          partial: confirmed.length > 0 && confirmed.length < dedupKeys.length,
          restoredCount: confirmed.length,
          restoredDedupKeys: confirmed,
          notDispatchedDedupKeys: dedupKeys.filter((key) => !dispatchedKeys.has(key)),
          noOpDedupKeys: noOp,
          unknownDedupKeys: unknown,
          outcomes
        }
  if (outcomes.every((outcome) => outcome.status === "confirmed")) {
    postResult(command, requestId, data)
    return
  }
  const summary = confirmed.length
    ? `Google Photos confirmed ${confirmed.length} of ${dedupKeys.length} ${operation} operations; unresolved targets are not safe to retry automatically.`
    : `Google Photos could not confirm any ${operation} operation. Review the provider state before trying again.`
  postError(command, requestId, new Error(summary), data)
}

function explicitGoogleFailureKeys(response, dedupKeys) {
  const statuses = new Map()
  collectTrashStatuses(response, new Set(dedupKeys), statuses)
  return new Set(
    [...statuses.entries()]
      .filter(([, success]) => success === false)
      .map(([key]) => key)
  )
}

function validateDedupKeys(command, requestId, args) {
  const dedupKeys = args?.dedupKeys
  if (!Array.isArray(dedupKeys) || dedupKeys.length === 0) {
    postError(command, requestId, "dedupKeys must be a non-empty array")
    return null
  }
  if (dedupKeys.some((key) => typeof key !== "string" || key.length === 0)) {
    postError(command, requestId, "dedupKeys must contain non-empty strings")
    return null
  }
  if (new Set(dedupKeys).size !== dedupKeys.length) {
    postError(command, requestId, "dedupKeys must not contain duplicates")
    return null
  }
  return dedupKeys
}

function validateMediaKeysToTrash(requestId, args, dedupKeys) {
  if (args?.mediaKeysToTrash === undefined) return dedupKeys

  const mediaKeysToTrash = args.mediaKeysToTrash
  if (
    !Array.isArray(mediaKeysToTrash) ||
    mediaKeysToTrash.length !== dedupKeys.length
  ) {
    postError(
      "trashItems",
      requestId,
      "mediaKeysToTrash must match dedupKeys length"
    )
    return null
  }
  if (
    mediaKeysToTrash.some(
      (key) => typeof key !== "string" || key.length === 0
    )
  ) {
    postError(
      "trashItems",
      requestId,
      "mediaKeysToTrash must contain non-empty strings"
    )
    return null
  }
  return mediaKeysToTrash
}

function validateAcknowledgedUnknownFavoriteDedupKeys(args, dedupKeys) {
  const supplied = args?.acknowledgedUnknownFavoriteDedupKeys
  if (supplied === undefined) return []
  if (
    !Array.isArray(supplied) ||
    supplied.some((key) => typeof key !== "string" || key.length === 0) ||
    new Set(supplied).size !== supplied.length
  ) {
    return null
  }
  const requested = new Set(dedupKeys)
  if (supplied.some((key) => !requested.has(key))) return null
  return supplied.slice()
}

function googleMimeType(value) {
  if (typeof value !== "string") return undefined
  const mimeType = value.split(";")[0].trim().toLowerCase()
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mimeType) ? mimeType : undefined
}

function unsupportedGoogleMediaType(item) {
  const mimeType = googleMimeType(item?.mimeType)
  return mimeType !== undefined && !/^(?:image|video)\//.test(mimeType)
}

function googleMediaMeasurement(value, allowZero = false) {
  return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0)
    ? value
    : undefined
}

function googleMediaTimestamp(value) {
  return Number.isFinite(value) && Math.abs(value) <= 8.64e15
    ? value
    : undefined
}

function mapMediaItem(item, accountUrlPrefix = "/") {
  if (unsupportedGoogleMediaType(item)) return null
  const favoriteValue = normalizeGoogleFavoriteValue(item?.isFavorite)
  const favoriteKnown = favoriteValue !== undefined
  const mimeType = googleMimeType(item?.mimeType)
  // Google Photos Toolkit's media parser exposes this provider value directly.
  // The shared media model is milliseconds; preserve the value and do not guess
  // units from its magnitude.
  const duration =
    Number.isFinite(item?.duration) && item.duration > 0
      ? item.duration
      : undefined
  const mediaKind =
    item?.isLivePhoto === true
      ? "live-photo"
      : /^video\//i.test(mimeType || "") ||
          item?.isVideo === true ||
          duration !== undefined
        ? "video"
        : /^image\//i.test(mimeType || "") || item?.isVideo === false
          ? "photo"
          : "unknown"
  return {
    mediaKey: item.mediaKey,
    dedupKey: item.dedupKey,
    thumb: item.thumb,
    timestamp: googleMediaTimestamp(item.timestamp),
    creationTimestamp: googleMediaTimestamp(item.creationTimestamp),
    resWidth: googleMediaMeasurement(item.resWidth),
    resHeight: googleMediaMeasurement(item.resHeight),
    ...(duration !== undefined ? { duration } : {}),
    isOwned: typeof item.isOwned === "boolean" ? item.isOwned : undefined,
    isOriginalQuality: typeof item.isOriginalQuality === "boolean" ? item.isOriginalQuality : null,
    ...(favoriteKnown ? { isFavorite: favoriteValue } : {}),
    favoriteStatus: favoriteKnown
      ? favoriteValue
        ? "favorite"
        : "not-favorite"
      : "unknown",
    favoriteSource: favoriteKnown ? "provider-metadata" : "unavailable",
    mediaKind,
    // Google scan rows do not include a verified original resource URL. The
    // on-demand retrieval path validates one before fetching, so scan-time
    // eligibility is unknown for supported media kinds.
    originalContentVerificationCapability:
      mediaKind === "photo" || mediaKind === "video" || mediaKind === "live-photo"
        ? "unknown"
        : "unavailable",
    ...(mimeType ? { mimeType } : {}),
    // Google Photos Toolkit maps these from opaque provider tuple positions.
    // Finite values alone do not distinguish embedded capture/creation dates
    // from Google's upload-time fallback, so preserve the dates but report
    // unknown provenance until the provider supplies a verifiable source bit.
    timestampProvenance: "unknown",
    creationTimestampProvenance: "unknown",
    ...(item?.isLivePhoto === true ? { isLivePhoto: true } : {}),
    fileName: item.fileName || item.descriptionShort || null,
    size: googleMediaMeasurement(item.size),
    takesUpSpace: typeof item.takesUpSpace === "boolean" ? item.takesUpSpace : null,
    spaceTaken: googleMediaMeasurement(item.spaceTaken, true),
    productUrl:
      "https://photos.google.com" + accountUrlPrefix + "photo/" + item.mediaKey
  }
}

function normalizeGoogleFavoriteValue(value) {
  if (typeof value === "boolean") return value
  if (value === 1 || value === "1") return true
  if (value === 0 || value === "0") return false
  return undefined
}


function validGoogleScanScopeFingerprint(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function beginGoogleScannedScope(providerSessionId, scopeFingerprint) {
  // A new scan replaces the previous review's exact membership. The byte
  // budget remains separate and survives cache eviction or a same-scope rescan.
  if (
    providerSessionId === commandHost.providerSessionId &&
    validGoogleScanScopeFingerprint(scopeFingerprint)
  ) {
    commandHost.originalMediaRetrieval.clearResources("google")
  }
}

function rememberGoogleScannedResources(
  mediaItems,
  providerSessionId,
  scopeFingerprint
) {
  if (
    !Array.isArray(mediaItems) ||
    typeof providerSessionId !== "string" ||
    !providerSessionId ||
    providerSessionId !== commandHost.providerSessionId ||
    !validGoogleScanScopeFingerprint(scopeFingerprint)
  ) {
    return
  }
  for (const item of mediaItems) {
    if (typeof item?.mediaKey !== "string" || !item.mediaKey) continue
    const declaredMediaKind = item.mediaKind
    const inferredMediaKind =
      typeof item.mimeType === "string" && item.mimeType.toLowerCase().startsWith("video/")
        ? "video"
        : typeof item.mimeType === "string" && item.mimeType.toLowerCase().startsWith("image/")
          ? "photo"
          : "unknown"
    const mediaKind =
      declaredMediaKind === "photo" ||
      declaredMediaKind === "video" ||
      declaredMediaKind === "live-photo" ||
      declaredMediaKind === "unknown"
        ? declaredMediaKind
        : inferredMediaKind
    commandHost.originalMediaRetrieval.rememberResource(
      "google",
      providerSessionId,
      scopeFingerprint,
      item.mediaKey,
      {
        mediaKey: item.mediaKey,
        mediaKind,
        mimeType: item.mimeType,
        size: Number.isSafeInteger(item.size) && item.size >= 0 ? item.size : undefined,
        duration: Number.isFinite(item.duration) ? item.duration : undefined,
        isLivePhoto: item.isLivePhoto === true
      }
    )
  }
}

async function enrichGoogleSelectionMetadata(
  mediaItems,
  apiUtils,
  signal,
  verifySession
) {
  const api = apiUtils?.api
  if (!Array.isArray(mediaItems) || mediaItems.length === 0 ||
      typeof api?.getBatchMediaInfo !== "function") {
    return
  }

  // GPTK exposes infoSize as the Bulk Info API Batch Size (1–10,000). Honor
  // that provider setting and fall back to GPTK's 5,000 default if malformed.
  const configuredBatchSize = Number(apiUtils.infoSize)
  const batchSize =
    Number.isSafeInteger(configuredBatchSize) && configuredBatchSize > 0
      ? Math.min(configuredBatchSize, 10_000)
      : 5_000
  const itemsByMediaKey = new Map(
    mediaItems.map((item) => [item.mediaKey, item])
  )
  const mediaKeys = [...itemsByMediaKey.keys()]

  for (let offset = 0; offset < mediaKeys.length; offset += batchSize) {
    commandHost.throwIfAborted(signal)
    await verifySession()
    const requestedKeys = mediaKeys.slice(offset, offset + batchSize)
    let metadataItems
    try {
      metadataItems = await withTimeout(
        Promise.resolve().then(() =>
          api.getBatchMediaInfo(requestedKeys, false)
        ),
        MEDIA_PAGE_TIMEOUT_MS,
        "Reading Google Photos quality and file size metadata",
        signal
      )
    } catch (error) {
      if (signal?.aborted) throw error
      // Recheck identity before treating supplemental data as unavailable, so
      // an account switch during a failed call cannot publish stale results.
      await verifySession()
      // This metadata is supplemental; a complete library scan remains usable
      // with its existing deterministic resolution and media-key fallbacks.
      return
    }
    await verifySession()
    if (!Array.isArray(metadataItems)) continue

    const requestedKeySet = new Set(requestedKeys)
    const matchedItems = new Map()
    const ambiguousMediaKeys = new Set()
    for (const metadata of metadataItems) {
      const mediaKey = metadata?.[0]
      if (typeof mediaKey !== "string" || !requestedKeySet.has(mediaKey)) {
        continue
      }
      if (!Array.isArray(metadata?.[1])) continue
      if (matchedItems.has(mediaKey)) {
        matchedItems.delete(mediaKey)
        ambiguousMediaKeys.add(mediaKey)
        continue
      }
      if (!ambiguousMediaKeys.has(mediaKey)) {
        matchedItems.set(mediaKey, metadata)
      }
    }

    for (const [mediaKey, metadata] of matchedItems) {
      if (ambiguousMediaKeys.has(mediaKey)) continue
      const item = itemsByMediaKey.get(mediaKey)
      if (!item) continue
      const providerFields = metadata[1]
      const qualityCode = providerFields.at(-1)?.[2]
      if (
        typeof item.isOriginalQuality !== "boolean" &&
        qualityCode === 2
      ) {
        // GPTK's parser recognizes code 2 as Original Quality. Keep every
        // other code unknown until a storage-saver code is confirmed.
        item.isOriginalQuality = true
      }
      const size = googleMediaMeasurement(providerFields[9])
      if (item.size === undefined && size !== undefined) item.size = size
    }
  }
}

function requireGoogleScannedResource(requestId, args) {
  if (args?.userOptIn !== true) {
    throw new Error("Original media retrieval requires explicit user opt-in.")
  }
  if (args?.requestId !== requestId) {
    throw new Error("The Google Photos retrieval request identity did not match.")
  }
  if (
    typeof args?.providerSessionId !== "string" ||
    !args.providerSessionId ||
    args.providerSessionId !== commandHost.providerSessionId
  ) {
    throw new Error("The Google Photos provider session changed. Scan the current account again.")
  }
  if (!validGoogleScanScopeFingerprint(args?.scanScopeFingerprint)) {
    throw new Error("The Google Photos review scope is missing or invalid. Scan again.")
  }
  if (typeof args?.mediaKey !== "string" || !args.mediaKey) {
    throw new Error("The Google Photos media target is missing.")
  }
  const resource = commandHost.originalMediaRetrieval.getResource(
    "google",
    args.providerSessionId,
    args.scanScopeFingerprint,
    args.mediaKey
  )
  if (!resource) {
    throw new Error("The Google Photos item is not present in this recent review. Scan again.")
  }
  return { resource }
}

function allowlistedGoogleResourceUrl(value, kind) {
  if (typeof value !== "string" || value.length === 0) return null
  try {
    const url = new URL(value)
    const allowedHosts = kind === "video" ? GOOGLE_VIDEO_HOSTS : GOOGLE_ORIGINAL_HOSTS
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !allowedHosts.has(url.hostname.toLowerCase())
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}

async function assertGoogleRetrievalContext(args, resource) {
  const identity = await updateGoogleProviderIdentity()
  if (
    !identity.accountEmail ||
    !identity.providerSessionId ||
    identity.providerSessionId !== args.providerSessionId
  ) {
    throw new Error("The signed-in Google Photos account changed. Scan the current account again.")
  }
  if (
    !commandHost.originalMediaRetrieval.isCurrentResource(
      "google",
      args.providerSessionId,
      args.scanScopeFingerprint,
      args.mediaKey,
      resource
    )
  ) {
    throw new Error("The Google Photos review scope changed during media retrieval. Scan again.")
  }
  return identity
}

async function fetchGoogleItemInfo(requestId, args, resource, signal) {
  const api = window.gptkApiUtils?.api
  if (typeof api?.getItemInfo !== "function") {
    throw new Error("Google Photos original metadata is unavailable. Reload the page and scan again.")
  }
  const info = await withTimeout(
    Promise.resolve().then(() => api.getItemInfo(resource.mediaKey)),
    MEDIA_PAGE_TIMEOUT_MS,
    "Reading Google Photos item metadata",
    signal
  )
  commandHost.throwIfAborted(signal)
  if (!info || typeof info !== "object" || info.mediaKey !== resource.mediaKey) {
    throw new Error("Google Photos did not confirm the exact scanned item.")
  }
  await assertGoogleRetrievalContext(args, resource)
  return info
}

function reserveGoogleOriginalReviewBudget(args, resource) {
  return commandHost.originalMediaRetrieval.reserveBudget({
    provider: "google",
    sessionId: args?.providerSessionId,
    scopeFingerprint: args?.scanScopeFingerprint,
    maxBytes: args?.maxBytes,
    aggregateBudgetBytes: args?.aggregateBudgetBytes,
    resourceSize: resource.size,
    maxBudgetScopes: GOOGLE_REVIEW_BUDGET_SCOPE_MAX,
    reserveKnownResourceSize: true
  })
}

function releaseGoogleOriginalReviewBudget(reservation) {
  commandHost.originalMediaRetrieval.releaseBudget(reservation)
}

function accountGoogleOriginalReviewBudget(reservation, byteLength) {
  commandHost.originalMediaRetrieval.accountResult(reservation, byteLength)
}

function isGoogleOriginalHashData(data, args, resource, maxBytes) {
  const hash = data?.contentHash
  const expectedMimePrefix = resource.mediaKind === "video" ? "video/" : "image/"
  return Boolean(
    data &&
      data.mediaKey === args.mediaKey &&
      data.scopeFingerprint === args.scanScopeFingerprint &&
      Number.isSafeInteger(data.byteLength) &&
      data.byteLength > 0 &&
      data.byteLength <= maxBytes &&
      typeof data.mimeType === "string" &&
      data.mimeType.toLowerCase().startsWith(expectedMimePrefix) &&
      /^image\/[a-z0-9.+-]+$|^video\/[a-z0-9.+-]+$/i.test(data.mimeType) &&
      hash?.algorithm === "sha256" &&
      hash?.provenance === "original-content" &&
      hash?.verificationSource === "local-original-bytes" &&
      hash?.contentRole ===
        (resource.mediaKind === "live-photo" ? "live-photo-still" : "single-file") &&
      typeof hash?.value === "string" &&
      /^[a-f0-9]{64}$/i.test(hash.value)
  )
}

function cancelGoogleOriginalHashRequest(requestId, args) {
  try {
    window.postMessage(
      {
        app: "GPD",
        action: "providerOriginalHash.cancel",
        requestId,
        providerSessionId: args.providerSessionId,
        scanScopeFingerprint: args.scanScopeFingerprint,
        mediaKey: args.mediaKey
      },
      "*"
    )
  } catch {
    // The page or extension may be unloading; cancellation is best-effort.
  }
}

function fetchGoogleOriginalHashViaExtension(requestId, args, resource, resourceUrl, maxBytes, signal) {
  commandHost.throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    let settled = false
    let cancelSent = false
    const cleanup = () => {
      clearTimeout(timeout)
      window.removeEventListener("message", onMessage)
      signal?.removeEventListener("abort", onAbort)
    }
    const finish = (error, data) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(data)
    }
    const sendCancelOnce = () => {
      if (cancelSent) return
      cancelSent = true
      cancelGoogleOriginalHashRequest(requestId, args)
    }
    const onAbort = () => {
      sendCancelOnce()
      finish(commandHost.createAbortError())
    }
    const onMessage = (event) => {
      if (event.source !== window) return
      if (event.origin && event.origin !== window.location.origin) return
      const message = event.data
      if (
        message?.app !== "GPD" ||
        message.action !== "providerOriginalHash.result" ||
        message.requestId !== requestId ||
        message.providerSessionId !== args.providerSessionId ||
        message.scanScopeFingerprint !== args.scanScopeFingerprint ||
        message.mediaKey !== args.mediaKey
      ) {
        return
      }
      if (message.success !== true) {
        finish(new Error("The extension could not verify the Google Photos original."))
        return
      }
      finish(undefined, message.data)
    }
    const timeout = setTimeout(() => {
      sendCancelOnce()
      finish(new Error("Google Photos original retrieval timed out."))
    }, GOOGLE_ORIGINAL_TIMEOUT_MS)

    if (signal?.aborted) {
      clearTimeout(timeout)
      reject(commandHost.createAbortError())
      return
    }
    window.addEventListener("message", onMessage)
    signal?.addEventListener("abort", onAbort, { once: true })
    try {
      window.postMessage(
        {
          app: "GPD",
          action: "providerOriginalHash.fetch",
          requestId,
          providerSessionId: args.providerSessionId,
          scanScopeFingerprint: args.scanScopeFingerprint,
          mediaKey: args.mediaKey,
          resourceUrl: resourceUrl.href,
          mediaKind: resource.mediaKind,
          maxBytes,
          aggregateBudgetBytes: args.aggregateBudgetBytes
        },
        "*"
      )
    } catch {
      finish(new Error("The extension could not start bounded Google Photos retrieval."))
    }
  })
}

async function getOriginalContentHash(requestId, args, signal) {
  let reservation
  let transportDispatched = false
  let budgetAccounted = false
  try {
    commandHost.throwIfAborted(signal)
    const { resource } = requireGoogleScannedResource(requestId, args)
    await assertGoogleRetrievalContext(args, resource)
    reservation = reserveGoogleOriginalReviewBudget(args, resource)
    const info = await fetchGoogleItemInfo(requestId, args, resource, signal)
    const originalResourceUrl = info.downloadOriginalUrl
    const resourceUrl = allowlistedGoogleResourceUrl(
      originalResourceUrl,
      resource.mediaKind === "video" ? "video" : "original"
    )
    if (!resourceUrl) {
      throw new Error("Google Photos did not provide a verified original resource for this item.")
    }
    commandHost.throwIfAborted(signal)
    transportDispatched = true
    const data = await fetchGoogleOriginalHashViaExtension(
      requestId,
      args,
      resource,
      resourceUrl,
      reservation.maxBytes,
      signal
    )
    commandHost.throwIfAborted(signal)
    await assertGoogleRetrievalContext(args, resource)
    if (!isGoogleOriginalHashData(data, args, resource, reservation.maxBytes)) {
      throw new Error("The extension returned incomplete or mismatched Google Photos original evidence.")
    }
    accountGoogleOriginalReviewBudget(reservation, data.byteLength)
    budgetAccounted = true
    postResult("getOriginalContentHash", requestId, {
      mediaKey: args.mediaKey,
      scopeFingerprint: args.scanScopeFingerprint,
      contentHash: {
        value: data.contentHash.value.toLowerCase(),
        algorithm: "sha256",
        provenance: "original-content",
        verificationSource: "local-original-bytes",
        contentRole: data.contentHash.contentRole
      },
      byteLength: data.byteLength,
      mimeType: data.mimeType
    })
  } catch (error) {
    const message =
      error?.name === "AbortError" || signal?.aborted
        ? "Google Photos original retrieval was cancelled or timed out."
        : error instanceof Error && !/https?:\/\//i.test(error.message)
          ? error.message
          : "Google Photos original retrieval failed without exposing its resource URL."
    postError("getOriginalContentHash", requestId, message)
  } finally {
    if (transportDispatched && !budgetAccounted) {
      // A rejected or cancelled bridge request may have read an unknown byte
      // count. Charge the full reservation so retries cannot exceed the cap.
      accountGoogleOriginalReviewBudget(reservation)
    }
    releaseGoogleOriginalReviewBudget(reservation)
  }
}

async function getVideoPlaybackUrl(requestId, args, signal) {
  try {
    commandHost.throwIfAborted(signal)
    const { resource } = requireGoogleScannedResource(requestId, args)
    if (resource.mediaKind !== "video") {
      throw new Error("The selected Google Photos item is not a verified video.")
    }
    await assertGoogleRetrievalContext(args, resource)
    const info = await fetchGoogleItemInfo(requestId, args, resource, signal)
    const playbackUrl = allowlistedGoogleResourceUrl(info.downloadUrl, "video")
    if (!playbackUrl) {
      throw new Error("Google Photos did not provide a verified video playback resource.")
    }
    commandHost.throwIfAborted(signal)
    await assertGoogleRetrievalContext(args, resource)
    postResult("getVideoPlaybackUrl", requestId, {
      mediaKey: args.mediaKey,
      scopeFingerprint: args.scanScopeFingerprint,
      playbackUrl: playbackUrl.href,
      ...(typeof info.mimeType === "string" ? { mimeType: info.mimeType } : {})
    })
  } catch (error) {
    const message =
      error?.name === "AbortError" || signal?.aborted
        ? "Google Photos video playback retrieval was cancelled."
        : error instanceof Error && !/https?:\/\//i.test(error.message)
          ? error.message
          : "Google Photos video playback could not be prepared safely."
    postError("getVideoPlaybackUrl", requestId, message)
  }
}

function googleAccountEmail() {
  const value = window.WIZ_global_data?.oPEP7c
  return typeof value === "string" ? value.trim() : ""
}

function normalizeGoogleAccountEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

async function updateGoogleProviderIdentity() {
  const accountEmail = googleAccountEmail()
  if (!accountEmail) {
    commandHost.originalMediaRetrieval.reset()
    return { accountEmail: "", providerSessionId: null }
  }
  const providerSessionId = await commandHost.setProviderIdentity(accountEmail)
  return { accountEmail, providerSessionId }
}

async function verifyGoogleScanSession(providerSessionId) {
  const identity = await updateGoogleProviderIdentity()
  if (
    !identity.accountEmail ||
    !identity.providerSessionId ||
    identity.providerSessionId !== providerSessionId
  ) {
    throw new Error(
      "The signed-in Google Photos account changed during the scan. Discard these results and scan again."
    )
  }
  return identity
}

async function revalidateGoogleMutationContext(args) {
  let identity
  try {
    identity = await updateGoogleProviderIdentity()
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) }
  }
  const requestedEmail = normalizeGoogleAccountEmail(args?.accountEmail)
  const currentEmail = normalizeGoogleAccountEmail(identity.accountEmail)
  const requestedSessionId = args?.providerSessionId
  const sessionMatches =
    typeof requestedSessionId === "string" &&
    requestedSessionId.length > 0 &&
    requestedSessionId === identity.providerSessionId
  if (
    !currentEmail ||
    !requestedEmail ||
    requestedEmail !== currentEmail ||
    !sessionMatches
  ) {
    return {
      ok: false,
      reason:
        "The signed-in Google Photos account changed or could not be verified. Reconnect, scan again, and review the current items before continuing."
    }
  }
  return { ok: true, ...identity }
}

function mapAlbum(album) {
  return {
    mediaKey: album.mediaKey,
    title: album.title || "(Untitled album)",
    ...(Number.isSafeInteger(album.itemCount) && album.itemCount >= 0
      ? { itemCount: album.itemCount }
      : {}),
    ...(typeof album.isShared === "boolean"
      ? { isShared: album.isShared }
      : {}),
    thumb: album.thumb
  }
}

function parseGoogleRawAlbum(itemData) {
  const properties = itemData?.at?.(-1)?.[72930366]
  const rawSharedValue = properties?.[4]
  const rawItemCount = properties?.[3]
  if (
    rawItemCount !== undefined &&
    rawItemCount !== null &&
    (!Number.isSafeInteger(rawItemCount) || rawItemCount < 0)
  ) {
    throw new Error("Google Photos returned an invalid album item count.")
  }
  return {
    mediaKey: itemData?.[0],
    title: properties?.[1],
    thumb: itemData?.[1]?.[0],
    ...(Number.isSafeInteger(rawItemCount) && rawItemCount >= 0
      ? { itemCount: rawItemCount }
      : {}),
    isShared:
      typeof rawSharedValue === "boolean"
        ? rawSharedValue
        : rawSharedValue === null
          ? false
          : undefined
  }
}

function normalizeGoogleAlbumsPage(response) {
  if (Array.isArray(response)) {
    if (!Array.isArray(response[0])) return null
    const continuation = normalizeGoogleContinuationCursor(response[1])
    if (
      !continuation.valid ||
      (response[0].length === 0 && continuation.cursor)
    ) {
      return null
    }
    return {
      items: response[0].map(parseGoogleRawAlbum),
      nextPageId: continuation.cursor
    }
  }
  return null
}

async function fetchAllAlbums(apiUtils, signal, verifySession) {
  const api = apiUtils?.api
  if (api?.getAlbums) {
    const albums = []
    let nextPageId = null
    const seenPageIds = new Set()
    const seenPageSignatures = new Set()
    const seenAlbumKeys = new Set()
    let pagesRead = 0
    do {
      commandHost.throwIfAborted(signal)
      if (verifySession) await verifySession()
      const response = await fetchGooglePageWithRetry(
        () => api.getAlbums(nextPageId, 100, false),
        `Fetching Google Photos album-list page ${pagesRead + 1}`,
        signal
      )
      if (verifySession) await verifySession()
      const page = normalizeGoogleAlbumsPage(response)
      if (!page || !Array.isArray(page.items)) {
        throw new Error("Google Photos returned an invalid album-list page.")
      }
      if (pagesRead >= 1000 || page.items.length > 1000) {
        throw new Error("Google Photos returned too many album pages to verify safely.")
      }
      const pageSignature = JSON.stringify(
        page.items.map((album) => album?.mediaKey || album?.id || null)
      )
      if (seenPageSignatures.has(pageSignature)) {
        throw new Error("Google Photos repeated an album-list page.")
      }
      seenPageSignatures.add(pageSignature)
      for (const album of page.items) {
        const albumKey = album?.mediaKey || album?.id
        if (!album || typeof album !== "object" || typeof albumKey !== "string" || !albumKey) {
          throw new Error("Google Photos returned an album with an invalid schema.")
        }
        if (seenAlbumKeys.has(albumKey)) {
          throw new Error("Google Photos repeated an album across pages.")
        }
        seenAlbumKeys.add(albumKey)
        albums.push(album)
      }
      const candidatePageId = page.nextPageId
      if (candidatePageId === null) {
        nextPageId = null
        break
      }
      if (seenPageIds.has(candidatePageId)) {
        throw new Error("Google Photos returned an invalid album continuation cursor.")
      }
      seenPageIds.add(candidatePageId)
      nextPageId = candidatePageId
      pagesRead += 1
    } while (nextPageId)
    return albums
  }
  throw new Error(
    "Google Photos could not verify album privacy metadata. Reload the page and try again."
  )
}

async function fetchAllMediaInAlbum(
  apiUtils,
  albumMediaKey,
  maxItems = Number.POSITIVE_INFINITY,
  signal,
  verifySession
) {
  const api = apiUtils?.api
  if (api?.getAlbumPage) {
    const mediaItems = []
    const pageSizes = []
    let nextPageId = null
    const seenPageIds = new Set()
    const seenMediaKeys = new Set()
    let pagesRead = 0
    do {
      commandHost.throwIfAborted(signal)
      if (verifySession) await verifySession()
      const rawPage = await fetchGooglePageWithRetry(
        () => api.getAlbumPage(albumMediaKey, nextPageId),
        `Fetching Google Photos album-media page ${pagesRead + 1}`,
        signal
      )
      if (verifySession) await verifySession()
      const page = normalizeGoogleMediaPage(rawPage)
      if (!page) {
        throw new Error("Google Photos returned an invalid album-media page.")
      }
      pageSizes.push(page.items.length)
      if (pagesRead >= 1000 || page.items.length > 1000) {
        throw new Error("Google Photos returned too many album-media pages to verify safely.")
      }
      let limitStopped = false
      let repeatedMediaKey = false
      for (const item of page.items) {
        const mediaKey = item?.mediaKey || item?.id
        if (!item || typeof item !== "object" || typeof mediaKey !== "string" || !mediaKey) {
          throw new Error("Google Photos returned album media with an invalid schema.")
        }
        if (seenMediaKeys.has(mediaKey)) {
          // Return the repeated row to the scope scanner so its identity ledger
          // can account for it once and report incomplete coverage precisely.
          mediaItems.push(item)
          repeatedMediaKey = true
          break
        }
        if (seenMediaKeys.size >= maxItems) {
          limitStopped = true
          break
        }
        seenMediaKeys.add(mediaKey)
        mediaItems.push(item)
      }
      if (limitStopped) {
        return {
          items: mediaItems,
          pageSizes,
          exhausted: false,
          limitStopped: true
        }
      }
      if (repeatedMediaKey) {
        return {
          items: mediaItems,
          pageSizes,
          exhausted: false,
          limitStopped: false
        }
      }
      const candidatePageId = page.nextPageId
      if (candidatePageId === null) {
        nextPageId = null
        break
      }
      if (seenPageIds.has(candidatePageId)) {
        throw new Error("Google Photos returned an invalid album-media continuation cursor.")
      }
      seenPageIds.add(candidatePageId)
      nextPageId = candidatePageId
      pagesRead += 1
      if (seenMediaKeys.size >= maxItems) {
        return {
          items: mediaItems,
          pageSizes,
          exhausted: false,
          limitStopped: true
        }
      }
    } while (nextPageId)
    return { items: mediaItems, pageSizes, exhausted: true, limitStopped: false }
  }
  if (typeof apiUtils?.getAllMediaInAlbum !== "function") {
    throw new Error("Google Photos album membership paging is unavailable.")
  }
  if (verifySession) await verifySession()
  const items = await fetchGooglePageWithRetry(
    () => apiUtils.getAllMediaInAlbum(albumMediaKey),
    "Fetching Google Photos album membership",
    signal
  )
  if (verifySession) await verifySession()
  if (!Array.isArray(items)) {
    throw new Error("Google Photos returned an invalid album-media result.")
  }
  const limitStopped = items.length > maxItems
  return {
    items: limitStopped ? items.slice(0, maxItems) : items,
    pageSizes: [],
    // This aggregate helper does not expose the page/cursor evidence needed
    // to distinguish complete membership from a silent partial response.
    exhausted: false,
    limitStopped
  }
}

async function listAlbums(requestId, args, signal) {
  const apiUtils = window.gptkApiUtils
  if (!apiUtils?.api?.getAlbums) {
    postError(
      "listAlbums",
      requestId,
      "GPTK raw album privacy metadata is unavailable. Reload the Google Photos page."
    )
    return
  }

  try {
    const requestedEmail = normalizeGoogleAccountEmail(args?.accountEmail)
    const requestedSessionId = args?.providerSessionId
    if (
      !requestedEmail ||
      typeof requestedSessionId !== "string" ||
      requestedSessionId.length === 0
    ) {
      throw new Error(
        "The requested Google Photos account and page session could not be verified. Reconnect and refresh the album list."
      )
    }
    const identity = await updateGoogleProviderIdentity()
    if (
      normalizeGoogleAccountEmail(identity.accountEmail) !== requestedEmail ||
      identity.providerSessionId !== requestedSessionId
    ) {
      throw new Error(
        "The Google Photos account or page session changed before the album list could be loaded. Reconnect and refresh the album list."
      )
    }
    const verifySession = async () => {
      const current = await verifyGoogleScanSession(requestedSessionId)
      if (normalizeGoogleAccountEmail(current.accountEmail) !== requestedEmail) {
        throw new Error(
          "The Google Photos account changed while albums were loading. Reconnect and refresh the album list."
        )
      }
      return current
    }
    const albums = await fetchAllAlbums(apiUtils, signal, verifySession)
    await verifySession()
    postResult(
      "listAlbums",
      requestId,
      (albums || []).filter((album) => album?.isShared === false).map(mapAlbum)
    )
  } catch (error) {
    postError("listAlbums", requestId, error)
  }
}

// ============================================================
// Command: getAllMediaItems
// Fetches all media items from the library via GPTK pagination.
// ============================================================

async function getAllMediaItems(requestId, args, signal) {
  const gptkApi = window.gptkApi
  const apiUtils = window.gptkApiUtils

  // Google exposes an ordering timestamp, not a change token. A timestamp
  // watermark cannot detect edits, deletions, archive/visibility changes, or
  // concurrent movement of older assets, so every requested library refresh
  // must enumerate to the terminal page instead of merging a delta.
  const receivedIncrementalHint =
    Number.isFinite(args?.sinceTimestamp) && args.sinceTimestamp > 0
  const dateRange = dateRangeBounds(args && args.dateRange)
  const scanLimit = normalizePositiveInteger(
    args && args.limit,
    Number.POSITIVE_INFINITY
  )
  const albumScope = args && args.albumScope
  const mediaItems = []
  let scanProviderSessionId = ""
  // Google uses /u/{index}/ for secondary signed-in accounts. Keep the
  // account context in links emitted by both album and timeline scans.
  const accountUrlPrefix =
    window.location.pathname.match(/^\/u\/\d+\//)?.[0] || "/"

  let itemsVisited = 0
  let unknownDateItemsSkipped = 0
  let unmappedItemsSkipped = 0
  let failureReason = "provider_error"
  let schemaIncomplete = false
  let pageSizes = []

  function coverage(status, stopReason, itemsReturned, totalItems) {
    return {
      status,
      stopReason,
      itemsVisited,
      itemsReturned,
      itemsSkipped: itemsVisited - itemsReturned,
      unknownDateItemsSkipped,
      ...(unmappedItemsSkipped > 0 ? { unmappedItemsSkipped } : {}),
      ...(Number.isSafeInteger(totalItems) ? { totalItems } : {}),
      ...(pageSizes.length > 0
        ? { pagesRead: pageSizes.length, pageSizes: pageSizes.slice() }
        : {}),
      mediaTypesCovered: { photos: true, videos: true },
      canResume: false
    }
  }

  if (typeof gptkApi?.getItemsByUploadedDate !== "function") {
    const error = new Error(
      "GPTK API not available. Reload the Google Photos page."
    )
    postError(
      "getAllMediaItems",
      requestId,
      error,
      undefined,
      coverage("failed", classifyProviderFailure(error), 0)
    )
    return
  }

  try {
    commandHost.throwIfAborted(signal)
    if (albumScope?.isShared === true) {
      const error = new Error(
        "Shared Google Photos albums are not supported. Choose a personal album and try again."
      )
      postError(
        "getAllMediaItems",
        requestId,
        error,
        undefined,
        coverage("failed", "unsupported_scope", 0)
      )
      return
    }
    const scanIdentity = await updateGoogleProviderIdentity()
    if (!scanIdentity.accountEmail || !scanIdentity.providerSessionId) {
      throw new Error("The signed-in Google Photos account could not be verified.")
    }
    if (!validGoogleScanScopeFingerprint(args?.scanScopeFingerprint)) {
      throw new Error("The Google Photos scan scope is missing or invalid. Restart the scan.")
    }
    scanProviderSessionId = scanIdentity.providerSessionId
    const verifyScanSession = () =>
      verifyGoogleScanSession(scanProviderSessionId)
    beginGoogleScannedScope(
      scanProviderSessionId,
      args.scanScopeFingerprint
    )
    if (receivedIncrementalHint && !albumScope?.mediaKey) {
      postProgress(
        requestId,
        0,
        "Rechecking the full Google Photos library because its timestamp watermark cannot report edits or deletions."
      )
    }
    if (albumScope?.mediaKey) {
      const currentAlbums = await fetchAllAlbums(
        apiUtils,
        signal,
        verifyScanSession
      )
      const selectedAlbum = currentAlbums.find(
        (album) => (album?.mediaKey || album?.id) === albumScope.mediaKey
      )
      if (selectedAlbum?.isShared === true) {
        const error = new Error(
          "Shared Google Photos albums are not supported. Choose a personal album and try again."
        )
        postError(
          "getAllMediaItems",
          requestId,
          error,
          undefined,
          coverage("failed", "unsupported_scope", 0)
        )
        return
      }
      if (!selectedAlbum || selectedAlbum.isShared !== false) {
        const error = new Error(
          "The selected Google Photos album is unavailable or is not a verified personal album. Refresh the album list and try again."
        )
        postError(
          "getAllMediaItems",
          requestId,
          error,
          undefined,
          coverage("failed", "unsupported_scope", 0)
        )
        return
      }
      if (!apiUtils?.getAllMediaInAlbum && !apiUtils?.api?.getAlbumPage) {
        const error = new Error(
          "GPTK album media API not available. Reload the Google Photos page."
        )
        postError(
          "getAllMediaItems",
          requestId,
          error,
          undefined,
          coverage("failed", classifyProviderFailure(error), 0)
        )
        return
      }

      const albumResult = await fetchAllMediaInAlbum(
        apiUtils,
        albumScope.mediaKey,
        scanLimit,
        signal,
        verifyScanSession
      )
      const sourceItems = Array.isArray(albumResult?.items)
        ? albumResult.items
        : []
      pageSizes = Array.isArray(albumResult?.pageSizes)
        ? albumResult.pageSizes.slice()
        : []
      const seenMediaKeys = new Set()
      const seenDedupKeys = new Set()
      let duplicateMedia = false
      for (const item of sourceItems) {
        commandHost.throwIfAborted(signal)
        const providerMediaKey = googleProviderMediaKey(item)
        if (providerMediaKey && seenMediaKeys.has(providerMediaKey)) {
          duplicateMedia = true
          break
        }
        if (itemsVisited >= scanLimit) break
        if (providerMediaKey) seenMediaKeys.add(providerMediaKey)
        itemsVisited += 1
        const hasIdentity = hasGoogleMediaIdentity(item)
        const mapped = hasIdentity
          ? mapMediaItem(item, accountUrlPrefix)
          : null
        if (!mapped) {
          unmappedItemsSkipped += 1
          if (!hasIdentity || !unsupportedGoogleMediaType(item)) schemaIncomplete = true
          continue
        }
        if (seenDedupKeys.has(mapped.dedupKey)) {
          unmappedItemsSkipped += 1
          schemaIncomplete = true
          continue
        }
        seenDedupKeys.add(mapped.dedupKey)
        if (dateRange && !Number.isFinite(mapped.timestamp)) {
          unknownDateItemsSkipped += 1
          continue
        }
        if (!isTimestampInDateRange(mapped.timestamp, dateRange)) continue
        mediaItems.push(mapped)
      }
      const limitStopped =
        albumResult.limitStopped || itemsVisited < sourceItems.length
      const expectedAlbumItemCount = Number.isSafeInteger(selectedAlbum.itemCount)
        ? selectedAlbum.itemCount
        : undefined
      const albumCountMismatch =
        albumResult.exhausted &&
        expectedAlbumItemCount !== undefined &&
        sourceItems.length !== expectedAlbumItemCount
      const albumScanComplete =
        !limitStopped &&
        !schemaIncomplete &&
        !albumCountMismatch &&
        albumResult.exhausted
      postProgress(
        requestId,
        itemsVisited,
        dateRange
          ? `Scanned ${itemsVisited} album items, matched ${mediaItems.length}`
          : `Fetched ${mediaItems.length} album items`
      )
      if (duplicateMedia) {
        const error = new Error(
          "Google Photos returned repeated album media; scan coverage is incomplete."
        )
        postError(
          "getAllMediaItems",
          requestId,
          error,
          undefined,
          coverage("failed", "pagination_error", mediaItems.length)
        )
        return
      }
      await verifyScanSession()
      if (albumScanComplete) {
        await enrichGoogleSelectionMetadata(
          mediaItems,
          apiUtils,
          signal,
          verifyScanSession
        )
      }
      rememberGoogleScannedResources(
        mediaItems,
        scanProviderSessionId,
        args.scanScopeFingerprint
      )
      postResult(
        "getAllMediaItems",
        requestId,
        mediaItems,
        coverage(
          limitStopped || schemaIncomplete || albumCountMismatch || !albumResult.exhausted
            ? "partial"
            : "complete",
          limitStopped
            ? "user_limit"
            : schemaIncomplete || albumCountMismatch || !albumResult.exhausted
              ? "coverage_unknown"
              : "exhausted",
          mediaItems.length,
          dateRange ? undefined : expectedAlbumItemCount
        )
      )
      return
    }

    let nextPageId = null
    const seenMediaKeys = new Set()
    const seenDedupKeys = new Set()
    const seenPageIds = new Set()
    let limitStopped = false
    let paginationIncomplete = false

    do {
      commandHost.throwIfAborted(signal)
      if (pageSizes.length >= 10_000) {
        failureReason = "pagination_error"
        paginationIncomplete = true
        break
      }
      await verifyScanSession()
      const scannedBeforePage = itemsVisited
      const pageLabel =
        scannedBeforePage === 0
          ? "the first Google Photos page"
          : `the next Google Photos page after ${scannedBeforePage} scanned item${scannedBeforePage !== 1 ? "s" : ""}`
      postProgress(
        requestId,
        scannedBeforePage,
        `Fetching ${pageLabel}...`
      )
      const rawPage = await fetchGooglePageWithRetry(
        () => gptkApi.getItemsByUploadedDate(nextPageId),
        `Fetching ${pageLabel}`,
        signal
      )
      await verifyScanSession()
      const page = normalizeGoogleMediaPage(rawPage)
      if (!page) {
        const continuation = normalizeGoogleContinuationCursor(
          rawPage?.nextPageId
        )
        if (
          Array.isArray(rawPage?.items) &&
          rawPage.items.length === 0 &&
          continuation.valid &&
          continuation.cursor
        ) {
          failureReason = "pagination_error"
          paginationIncomplete = true
        } else {
          schemaIncomplete = true
        }
        break
      }
      const pageItems = page.items
      pageSizes.push(pageItems.length)
      nextPageId = page.nextPageId
      let pageIndex = 0
      for (; pageIndex < pageItems.length; pageIndex += 1) {
        commandHost.throwIfAborted(signal)
        const item = pageItems[pageIndex]
        const providerMediaKey = googleProviderMediaKey(item)
        if (providerMediaKey && seenMediaKeys.has(providerMediaKey)) {
          // Count each provider media identity once, even if its earlier or
          // repeated row lacked fields needed by mapMediaItem.
          failureReason = "pagination_error"
          paginationIncomplete = true
          break
        }
        if (itemsVisited >= scanLimit) {
          limitStopped = true
          break
        }
        if (providerMediaKey) seenMediaKeys.add(providerMediaKey)
        itemsVisited += 1
        const hasIdentity = hasGoogleMediaIdentity(item)
        const mapped = hasIdentity
          ? mapMediaItem(item, accountUrlPrefix)
          : null
        if (!mapped) {
          unmappedItemsSkipped += 1
          if (!hasIdentity || !unsupportedGoogleMediaType(item)) schemaIncomplete = true
          continue
        }
        if (seenDedupKeys.has(mapped.dedupKey)) {
          unmappedItemsSkipped += 1
          schemaIncomplete = true
          continue
        }
        seenDedupKeys.add(mapped.dedupKey)
        if (dateRange && !Number.isFinite(mapped.timestamp)) {
          unknownDateItemsSkipped += 1
          continue
        }
        if (!isTimestampInDateRange(mapped.timestamp, dateRange)) continue
        mediaItems.push(mapped)
      }

      if (pageIndex < pageItems.length && !limitStopped) {
        failureReason = "pagination_error"
        paginationIncomplete = true
      }
      if (nextPageId && seenPageIds.has(nextPageId)) {
        failureReason = "pagination_error"
        paginationIncomplete = true
        nextPageId = null
      } else if (nextPageId) {
        seenPageIds.add(nextPageId)
      }
      if (itemsVisited >= scanLimit && nextPageId && !paginationIncomplete) {
        limitStopped = true
      }

      postProgress(
        requestId,
        itemsVisited,
        dateRange
          ? `Scanned ${itemsVisited} items, matched ${mediaItems.length}`
          : `Fetched ${mediaItems.length} items`
      )

      if (limitStopped || paginationIncomplete) break
    } while (nextPageId)

    const stopReason = paginationIncomplete
      ? failureReason === "pagination_error"
        ? "pagination_error"
        : "coverage_unknown"
      : schemaIncomplete
        ? "coverage_unknown"
        : limitStopped
          ? "user_limit"
          : "exhausted"
    await verifyScanSession()
    if (stopReason === "exhausted") {
      await enrichGoogleSelectionMetadata(
        mediaItems,
        apiUtils,
        signal,
        verifyScanSession
      )
    }
    rememberGoogleScannedResources(
      mediaItems,
      scanProviderSessionId,
      args.scanScopeFingerprint
    )
    postResult(
      "getAllMediaItems",
      requestId,
      mediaItems,
      coverage(
        stopReason === "exhausted" ? "complete" : "partial",
        stopReason,
        mediaItems.length
      )
    )
  } catch (error) {
    if (signal?.aborted) {
      postResult(
        "getAllMediaItems",
        requestId,
        mediaItems,
        coverage("partial", "cancelled", mediaItems.length)
      )
      return
    }
    failureReason = classifyProviderFailure(error)
    const failedCoverage = coverage("failed", failureReason, 0)
    failedCoverage.itemsSkipped = failedCoverage.itemsVisited
    postError("getAllMediaItems", requestId, error, undefined, failedCoverage)
  }
}

// ============================================================
// Command: trashItems
// Moves items to trash via GPTK's batch API (no DOM clicking).
// ============================================================

async function trashItems(requestId, args) {
  const api = window.gptkApiUtils?.api
  const dedupKeys = validateDedupKeys("trashItems", requestId, args)
  if (!dedupKeys) return
  const mediaKeysToTrash = validateMediaKeysToTrash(
    requestId,
    args,
    dedupKeys
  )
  if (!mediaKeysToTrash) return
  const outcomes = new Map()
  const dispatchedKeys = new Set()
  const acknowledgedUnknownFavoriteDedupKeys =
    validateAcknowledgedUnknownFavoriteDedupKeys(args, dedupKeys)
  if (!acknowledgedUnknownFavoriteDedupKeys) {
    for (const key of dedupKeys) {
      setMutationOutcome(
        outcomes,
        "trash",
        key,
        "failed",
        "invalid-favorite-acknowledgement"
      )
    }
    publishGoogleMutation(
      "trashItems",
      requestId,
      "trash",
      dedupKeys,
      outcomes,
      mediaKeysToTrash,
      dispatchedKeys
    )
    return
  }
  const acknowledgedUnknownFavoriteSet = new Set(
    acknowledgedUnknownFavoriteDedupKeys
  )
  if (!api?.moveItemsToTrash) {
    for (const key of dedupKeys) {
      setMutationOutcome(outcomes, "trash", key, "failed", "provider-api-unavailable")
    }
    publishGoogleMutation("trashItems", requestId, "trash", dedupKeys, outcomes, mediaKeysToTrash, dispatchedKeys)
    return
  }

  const batchSize = normalizeTrashBatchSize(args.batchSize)
  const chunkTimeoutMs = normalizePositiveInteger(
    args.chunkTimeoutMs,
    TRASH_CHUNK_TIMEOUT_MS
  )
  const chunks = chunkArray(dedupKeys, batchSize)
  let sessionChanged = false
  const publishProgress = () => {
    const confirmed = [...outcomes.values()]
      .filter(
        (outcome) =>
          outcome.operation === "trash" && outcome.status === "confirmed"
      )
      .map((outcome) => outcome.targetKey)
    postProgress(
      requestId,
      confirmed.length,
      `Confirmed ${confirmed.length} of ${dedupKeys.length} Google Photos trash operations`,
      "trashItems",
      {
        trashedKeys: mediaKeysForDedupKeys(
          confirmed,
          dedupKeys,
          mediaKeysToTrash
        ),
        trashedDedupKeys: confirmed,
        outcomes: dedupKeys
          .filter((key) => outcomes.has(key))
          .map((key) => outcomes.get(key))
      }
    )
  }
  for (const chunk of chunks) {
    const beforeContext = await revalidateGoogleMutationContext(args)
    if (!beforeContext.ok) {
      for (const key of chunk) {
        setMutationOutcome(outcomes, "trash", key, "failed", "session-unverified-before-dispatch")
      }
      sessionChanged = true
      break
    }

    const before = await readGoogleMutationKeys(api, "trash")
    if (!before.complete) {
      for (const key of chunk) {
        setMutationOutcome(outcomes, "trash", key, "failed", "preflight-trash-state-unavailable")
      }
      publishProgress()
      continue
    }
    const afterPreflightContext = await revalidateGoogleMutationContext(args)
    if (!afterPreflightContext.ok) {
      for (const key of chunk) {
        setMutationOutcome(outcomes, "trash", key, "failed", "session-changed-before-dispatch")
      }
      sessionChanged = true
      break
    }

    const candidates = []
    for (const key of chunk) {
      if (before.keys.has(key)) {
        setMutationOutcome(outcomes, "trash", key, "failed", "already-trashed-noop")
      } else {
        candidates.push(key)
      }
    }
    if (candidates.length === 0) {
      publishProgress()
      continue
    }

    const favoriteEligibleCandidates = []
    const favoriteDeadline = Date.now() + GOOGLE_FAVORITE_PREFLIGHT_TIMEOUT_MS
    if (typeof api.getItemInfo !== "function") {
      for (const key of candidates) {
        setMutationOutcome(
          outcomes,
          "trash",
          key,
          "failed",
          "favorite-state-unavailable"
        )
      }
    } else {
      for (let index = 0; index < candidates.length; index += 1) {
        const key = candidates[index]
        const mediaKey = mediaKeysToTrash[dedupKeys.indexOf(key)]
        const remainingMs = favoriteDeadline - Date.now()
        if (remainingMs <= 0) {
          for (const pendingKey of candidates.slice(index)) {
            setMutationOutcome(
              outcomes,
              "trash",
              pendingKey,
              "failed",
              "favorite-lookup-timeout"
            )
          }
          break
        }

        let info
        try {
          info = await withTimeout(
            Promise.resolve().then(() => api.getItemInfo(mediaKey)),
            remainingMs,
            "Reading Google Photos favorite state"
          )
        } catch (error) {
          const lookupTimedOut = /timed out after/i.test(
            String(error?.message || error || "")
          )
          setMutationOutcome(
            outcomes,
            "trash",
            key,
            "failed",
            lookupTimedOut
              ? "favorite-lookup-timeout"
              : "favorite-lookup-failed"
          )
        }

        const lookupContext = await revalidateGoogleMutationContext(args)
        if (!lookupContext.ok) {
          for (const pendingKey of candidates.slice(index)) {
            if (!outcomes.has(pendingKey)) {
              setMutationOutcome(
                outcomes,
                "trash",
                pendingKey,
                "failed",
                "session-changed-before-dispatch"
              )
            }
          }
          sessionChanged = true
          break
        }
        if (!info) {
          if (!outcomes.has(key)) {
            setMutationOutcome(
              outcomes,
              "trash",
              key,
              "failed",
              "favorite-state-unavailable"
            )
          }
          continue
        }
        if (
          typeof info !== "object" ||
          Array.isArray(info) ||
          info.mediaKey !== mediaKey
        ) {
          setMutationOutcome(
            outcomes,
            "trash",
            key,
            "failed",
            "favorite-item-identity-mismatch"
          )
        } else if (normalizeGoogleFavoriteValue(info.isFavorite) === true) {
          setMutationOutcome(
            outcomes,
            "trash",
            key,
            "failed",
            "favorite-protected-current-state"
          )
        } else if (normalizeGoogleFavoriteValue(info.isFavorite) === false) {
          favoriteEligibleCandidates.push(key)
        } else if (acknowledgedUnknownFavoriteSet.has(key)) {
          favoriteEligibleCandidates.push(key)
        } else {
          setMutationOutcome(
            outcomes,
            "trash",
            key,
            "failed",
            "favorite-state-unknown-not-acknowledged"
          )
        }
      }
    }

    if (sessionChanged) break
    if (favoriteEligibleCandidates.length === 0) {
      publishProgress()
      continue
    }

    const beforeDispatchContext = await revalidateGoogleMutationContext(args)
    if (!beforeDispatchContext.ok) {
      for (const key of favoriteEligibleCandidates) {
        setMutationOutcome(
          outcomes,
          "trash",
          key,
          "failed",
          "session-changed-before-dispatch"
        )
      }
      sessionChanged = true
      publishProgress()
      break
    }

    let response
    let dispatchError
    try {
      favoriteEligibleCandidates.forEach((key) => dispatchedKeys.add(key))
      // GPTK accepts target keys only; the favorite lookup above is a fresh
      // safety check, not an atomic favorite-and-trash condition.
      response = await withTimeout(
        api.moveItemsToTrash(favoriteEligibleCandidates),
        chunkTimeoutMs,
        `Moving trash chunk of ${favoriteEligibleCandidates.length} item${favoriteEligibleCandidates.length !== 1 ? "s" : ""}`
      )
    } catch (error) {
      dispatchError = error
    }

    const after = await readGoogleMutationKeys(api, "trash")
    const afterContext = await revalidateGoogleMutationContext(args)
    if (!afterContext.ok) {
      for (const key of favoriteEligibleCandidates) {
        setMutationOutcome(outcomes, "trash", key, "unknown", "session-changed-after-dispatch")
      }
      sessionChanged = true
      break
    }

    const explicitFailures = explicitGoogleFailureKeys(
      dispatchError || response,
      favoriteEligibleCandidates
    )
    for (const key of favoriteEligibleCandidates) {
      if (!before.keys.has(key) && after.keys.has(key)) {
        setMutationOutcome(outcomes, "trash", key, "confirmed")
      } else if (
        after.complete &&
        (explicitFailures.has(key) || googleExplicitNoEffect(dispatchError || response))
      ) {
        setMutationOutcome(
          outcomes,
          "trash",
          key,
          "failed",
          "provider-rejected-without-observed-state-change"
        )
      } else {
        setMutationOutcome(outcomes, "trash", key, "unknown", "post-dispatch-trash-transition-unverified")
      }
    }

    publishProgress()
  }

  if (sessionChanged) {
    for (const key of dedupKeys) {
      if (!outcomes.has(key)) {
        setMutationOutcome(outcomes, "trash", key, "failed", "not-dispatched-after-session-change")
      }
    }
  }
  publishGoogleMutation("trashItems", requestId, "trash", dedupKeys, outcomes, mediaKeysToTrash, dispatchedKeys)
}

// ============================================================
// Command: restoreItems
// Restores items from trash via GPTK's batch API.
// ============================================================

async function restoreItems(requestId, args) {
  const api = window.gptkApiUtils?.api
  const dedupKeys = validateDedupKeys("restoreItems", requestId, args)
  if (!dedupKeys) return
  const outcomes = new Map()
  const dispatchedKeys = new Set()
  if (!api?.restoreFromTrash) {
    for (const key of dedupKeys) {
      setMutationOutcome(outcomes, "restore", key, "failed", "provider-api-unavailable")
    }
    publishGoogleMutation("restoreItems", requestId, "restore", dedupKeys, outcomes, undefined, dispatchedKeys)
    return
  }

  const chunks = chunkArray(dedupKeys, RESTORE_BATCH_SIZE)
  let sessionChanged = false
  for (const chunk of chunks) {
    const beforeContext = await revalidateGoogleMutationContext(args)
    if (!beforeContext.ok) {
      for (const key of chunk) {
        setMutationOutcome(outcomes, "restore", key, "failed", "session-unverified-before-dispatch")
      }
      sessionChanged = true
      break
    }

    const beforeTrash = await readGoogleMutationKeys(api, "trash")
    if (!beforeTrash.complete) {
      for (const key of chunk) {
        setMutationOutcome(outcomes, "restore", key, "failed", "preflight-trash-state-unavailable")
      }
      continue
    }
    const beforeReadContext = await revalidateGoogleMutationContext(args)
    if (!beforeReadContext.ok) {
      for (const key of chunk) {
        setMutationOutcome(outcomes, "restore", key, "failed", "session-changed-before-dispatch")
      }
      sessionChanged = true
      break
    }

    const candidates = chunk.filter((key) => beforeTrash.keys.has(key))
    const absentFromTrash = chunk.filter((key) => !beforeTrash.keys.has(key))
    if (absentFromTrash.length > 0) {
      const library = await readGoogleMutationKeys(api, "library")
      const afterLibraryContext = await revalidateGoogleMutationContext(args)
      if (!afterLibraryContext.ok) {
        for (const key of absentFromTrash) {
          setMutationOutcome(outcomes, "restore", key, "failed", "session-changed-before-dispatch")
        }
        sessionChanged = true
      } else {
        for (const key of absentFromTrash) {
          if (library.keys.has(key)) {
            setMutationOutcome(outcomes, "restore", key, "failed", "already-restored-noop")
          } else if (library.complete) {
            setMutationOutcome(outcomes, "restore", key, "failed", "not-in-trash-or-library")
          } else {
            setMutationOutcome(outcomes, "restore", key, "failed", "preflight-library-state-unavailable")
          }
        }
      }
      if (sessionChanged) break
    }
    if (candidates.length === 0) continue

    let response
    let dispatchError
    try {
      candidates.forEach((key) => dispatchedKeys.add(key))
      response = await withTimeout(
        api.restoreFromTrash(candidates),
        TRASH_CHUNK_TIMEOUT_MS,
        `Restoring ${candidates.length} Google Photos item${candidates.length !== 1 ? "s" : ""}`
      )
    } catch (error) {
      dispatchError = error
    }

    const [afterTrash, afterLibrary] = await Promise.all([
      readGoogleMutationKeys(api, "trash"),
      readGoogleMutationKeys(api, "library")
    ])
    const afterContext = await revalidateGoogleMutationContext(args)
    if (!afterContext.ok) {
      for (const key of candidates) {
        setMutationOutcome(outcomes, "restore", key, "unknown", "session-changed-after-dispatch")
      }
      sessionChanged = true
      break
    }

    const explicitFailures = explicitGoogleFailureKeys(
      dispatchError || response,
      candidates
    )
    for (const key of candidates) {
      if (
        afterTrash.complete &&
        !afterTrash.keys.has(key) &&
        afterLibrary.keys.has(key)
      ) {
        setMutationOutcome(outcomes, "restore", key, "confirmed")
      } else if (
        afterTrash.complete &&
        afterTrash.keys.has(key) &&
        !afterLibrary.keys.has(key) &&
        (explicitFailures.has(key) || googleExplicitNoEffect(dispatchError || response))
      ) {
        setMutationOutcome(
          outcomes,
          "restore",
          key,
          "failed",
          "provider-rejected-without-observed-state-change"
        )
      } else {
        setMutationOutcome(outcomes, "restore", key, "unknown", "post-dispatch-library-and-trash-state-unverified")
      }
    }

    const confirmed = [...outcomes.values()]
      .filter((outcome) => outcome.operation === "restore" && outcome.status === "confirmed")
      .map((outcome) => outcome.targetKey)
    postProgress(
      requestId,
      confirmed.length,
      `Confirmed ${confirmed.length} of ${dedupKeys.length} Google Photos restore operations`,
      "restoreItems",
      {
        restoredDedupKeys: confirmed,
        outcomes: dedupKeys.filter((key) => outcomes.has(key)).map((key) => outcomes.get(key))
      }
    )
  }

  if (sessionChanged) {
    for (const key of dedupKeys) {
      if (!outcomes.has(key)) {
        setMutationOutcome(outcomes, "restore", key, "failed", "not-dispatched-after-session-change")
      }
    }
  }
  publishGoogleMutation("restoreItems", requestId, "restore", dedupKeys, outcomes, undefined, dispatchedKeys)
}

// ============================================================
// Command: healthCheck
// Verifies GPTK is loaded and WIZ_global_data is available.
// ============================================================

async function healthCheck(requestId) {
  const hasGptk = typeof window.gptkApi !== "undefined"
  const hasWizData = typeof window.WIZ_global_data !== "undefined"
  // oPEP7c is the signed-in account email in WIZ_global_data
  const identity = await updateGoogleProviderIdentity()
  const page = window.location?.hostname?.toLowerCase() === "photos.google.com"
  const hasReadPath =
    typeof window.gptkApi?.getItemsByUploadedDate === "function"
  postResult("healthCheck", requestId, {
    hasGptk,
    hasWizData,
    accountEmail: identity.accountEmail,
    health: createProviderHealth("google", {
      page,
      session: Boolean(identity.accountEmail && identity.providerSessionId),
      readPath: hasReadPath
    })
  })
}

// ============================================================
// Message listener
// ============================================================

commandHost.register({
  handlers: {
    getAllMediaItems,
    getOriginalContentHash,
    getVideoPlaybackUrl,
    listAlbums,
    trashItems,
    restoreItems,
    healthCheck
  },
  unsupportedMessage: (command) => `Unknown command: ${command}`
})

console.log("GPD: Command handler loaded")
})();
