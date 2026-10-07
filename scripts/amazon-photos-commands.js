// MAIN world command handler for Amazon Photos pages.

;(() => {
  if (window.__GPD_AMAZON_COMMAND_HANDLER_LOADED__) {
    console.log("GPD: Amazon Photos command handler already loaded")
    return
  }
  window.__GPD_AMAZON_COMMAND_HANDLER_LOADED__ = true
  // Uses Amazon Photos' private web API from the signed-in page context.

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
  const AMAZON_PAGE_LIMIT = 200
  const AMAZON_FAVORITE_LOOKUP_LIMIT = 100
  const AMAZON_REVIEW_BUDGET_SCOPE_MAX = 10000
  const scannedResourceByItem = new WeakMap()
  const AMAZON_APP_ID =
    "YW16bjEuYXBwbGljYXRpb24uMjllMmU2YjgxZDE3NDhjYWIxZjM4MDQwZGZmMjJkYmY"
  const AMAZON_TRASH_BATCH_SIZE = 50
  const AMAZON_TRASH_VERIFY_ATTEMPTS = 3
  const AMAZON_TRASH_VERIFY_DELAYS_MS = [0, 250, 1000]
  const AMAZON_API_TIMEOUT_MS = 45000
  const AMAZON_API_RETRY_COUNT = 2
  const AMAZON_SEARCH_RETRY_COUNT = 6
  const AMAZON_SEARCH_PAGE_PAUSE_MS = 1000
  const AMAZON_RATE_LIMIT_BACKOFF_MS = [
    15000, 30000, 60000, 90000, 120000, 180000
  ]

  function chunkArray(items, size) {
    const chunks = []
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size))
    }
    return chunks
  }

  function normalizeTrashBatchSize(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return AMAZON_TRASH_BATCH_SIZE
    return Math.min(Math.floor(parsed), AMAZON_TRASH_BATCH_SIZE)
  }

  function mediaKeysForDedupKeys(movedDedupKeys, dedupKeys, mediaKeysToTrash) {
    const byDedupKey = new Map()
    dedupKeys.forEach((dedupKey, index) => {
      if (!byDedupKey.has(dedupKey)) byDedupKey.set(dedupKey, [])
      byDedupKey.get(dedupKey).push(mediaKeysToTrash[index])
    })
    return movedDedupKeys.flatMap((dedupKey) => byDedupKey.get(dedupKey) || [])
  }

  function validateStringArray(command, requestId, field, value) {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      !value.every((item) => typeof item === "string" && item.trim())
    ) {
      postError(
        command,
        requestId,
        `Amazon Photos ${field} must be a non-empty string array.`
      )
      return null
    }
    return value
  }

  function hashString(value) {
    let hash = 2166136261
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36)
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  class AmazonApiError extends Error {
    constructor(message, status, retryAfterMs) {
      super(message)
      this.name = "AmazonApiError"
      this.status = status
      this.retryAfterMs = retryAfterMs
    }
  }

  function parseRetryAfterMs(value) {
    if (!value) return undefined
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000
    const timestamp = Date.parse(value)
    if (!Number.isFinite(timestamp)) return undefined
    return Math.max(0, timestamp - Date.now())
  }

  function retryDelayMs(error, attempt) {
    if (error?.status === 429) {
      return (
        error.retryAfterMs ||
        AMAZON_RATE_LIMIT_BACKOFF_MS[
          Math.min(attempt, AMAZON_RATE_LIMIT_BACKOFF_MS.length - 1)
        ]
      )
    }
    return 1000 * (attempt + 1)
  }

  function retryLimitFor(error) {
    return error?.status === 429
      ? AMAZON_SEARCH_RETRY_COUNT
      : AMAZON_API_RETRY_COUNT
  }

  const AMAZON_PHOTOS_MARKETPLACE_HOSTS = [
    "amazon.com",
    "amazon.ca",
    "amazon.co.uk",
    "amazon.de",
    "amazon.fr",
    "amazon.it",
    "amazon.es",
    "amazon.co.jp",
    "amazon.com.au",
    "amazon.in",
    "amazon.com.br",
    "amazon.com.mx",
    "amazon.nl",
    "amazon.sg",
    "amazon.ae",
    "amazon.sa",
    "amazon.se",
    "amazon.pl",
    "amazon.com.tr",
    "amazon.com.be",
    "amazon.eg",
    "amazon.ie"
  ]

  const AMAZON_PHOTOS_HOSTS = new Set(
    AMAZON_PHOTOS_MARKETPLACE_HOSTS.flatMap((host) => [host, `www.${host}`])
  )

  function isAmazonPhotosHost(hostname = location.hostname) {
    return AMAZON_PHOTOS_HOSTS.has(hostname)
  }

  function isAmazonPhotosLocation(locationLike = location) {
    return (
      isAmazonPhotosHost(locationLike.hostname) &&
      locationLike.pathname.toLowerCase().includes("/photos")
    )
  }

  function amazonOrigin() {
    return `${location.protocol}//${location.host}`
  }

  function amazonPhotosUrl(path) {
    return new URL(path, amazonOrigin()).toString()
  }

  function amazonThumbnailOrigin(locationLike = location) {
    const marketplaceHost = locationLike.hostname.replace(/^www\./, "")
    const port = locationLike.port ? `:${locationLike.port}` : ""
    return `${locationLike.protocol}//thumbnails-photos.${marketplaceHost}${port}`
  }

  if (window.__GPD_COMMAND_TEST_MODE__ === true) {
    window.__GPD_AMAZON_COMMAND_TEST_API__ = Object.freeze({
      isAmazonPhotosHost,
      isAmazonPhotosLocation,
      amazonThumbnailOrigin,
      mapAmazonNode
    })
  }

  function assertLibraryRoute() {
    const route = location.href.toLowerCase()
    if (
      !isAmazonPhotosHost() ||
      !route.includes("/photos") ||
      route.includes("/trash") ||
      route.includes("deleted")
    ) {
      throw new Error(
        "Open Amazon Photos on your Amazon country site, wait for the library to load, then scan again."
      )
    }
  }

  function assertRestoreRoute() {
    const route = location.href.toLowerCase()
    if (!isAmazonPhotosHost() || !route.includes("/photos")) {
      throw new Error(
        "Open Amazon Photos on your Amazon country site, wait for the library to load, then try Undo again."
      )
    }
  }

  function parseCookie(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const match = new RegExp(`(?:^|; )${escaped}=([^;]*)`).exec(document.cookie)
    return match ? decodeURIComponent(match[1]) : ""
  }

  function amazonCookieIdentity() {
    // The private node API normally supplies ownerId. Empty libraries may not
    // have a node to carry it, so bind the page to a hash of the non-secret
    // session markers that Amazon exposes as cookies. Never return or persist
    // the cookie values themselves; the command host keeps only this opaque
    // marker and rotates its provider session when the marker changes.
    const cookiePairs = document.cookie
      .split(";")
      .map((entry) => entry.trim().split("=", 2))
      .filter(([name, value]) =>
        Boolean(
          name &&
            value &&
            /^(?:session-id|ubid(?:[-_][a-z0-9]+)?)/i.test(name)
        )
      )
      .sort(([left], [right]) => left.localeCompare(right))
    if (cookiePairs.length === 0) return ""
    return `cookie:${hashString(cookiePairs.map(([name, value]) => `${name}=${value}`).join("|"))}`
  }

  function amazonApiHeaders() {
    const sessionId = parseCookie("session-id")
    return {
      accept: "application/json, text/plain, */*",
      ...(sessionId ? { "x-amzn-sessionid": sessionId } : {})
    }
  }

  function amazonSearchUrl({ offset, limit, filters, startToken }) {
    const url = new URL("/drive/v1/search", amazonOrigin())
    url.searchParams.set("asset", "ALL")
    url.searchParams.set("tempLink", "false")
    url.searchParams.set("resourceVersion", "V2")
    url.searchParams.set("ContentType", "JSON")
    url.searchParams.set("limit", String(limit))
    if (startToken) url.searchParams.set("startToken", startToken)
    else url.searchParams.set("offset", String(offset))
    url.searchParams.set("filters", filters)
    url.searchParams.set("lowResThumbnail", "true")
    url.searchParams.set("searchContext", "customer")
    url.searchParams.set("sort", "['createdDate DESC']")
    return url
  }

  function amazonTrashUrl({ offset, startToken }) {
    const url = new URL("/drive/v1/trash", amazonOrigin())
    url.searchParams.set("asset", "ALL")
    url.searchParams.set("tempLink", "false")
    url.searchParams.set("resourceVersion", "V2")
    url.searchParams.set("ContentType", "JSON")
    url.searchParams.set("limit", String(AMAZON_PAGE_LIMIT))
    if (startToken) url.searchParams.set("startToken", startToken)
    else url.searchParams.set("offset", String(offset))
    url.searchParams.set(
      "filters",
      "kind:(FILE* OR FOLDER*) AND status:(TRASH*)"
    )
    url.searchParams.set("sort", "['modifiedDate DESC']")
    return url
  }

  function amazonExactNodeUrl(nodeId) {
    const url = new URL(
      `/drive/v1/nodes/${encodeURIComponent(nodeId)}`,
      amazonOrigin()
    )
    url.searchParams.set("asset", "ALL")
    url.searchParams.set("tempLink", "true")
    url.searchParams.set("resourceVersion", "V2")
    url.searchParams.set("ContentType", "JSON")
    url.searchParams.set("_", String(Date.now()))
    return url
  }

  async function fetchJsonWithTimeout(url, label, externalSignal, extraHeaders = {}) {
    commandHost.throwIfAborted(externalSignal)
    const controller = new AbortController()
    const abortExternal = () => controller.abort()
    externalSignal?.addEventListener("abort", abortExternal, { once: true })
    const timeout = setTimeout(() => controller.abort(), AMAZON_API_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: { ...amazonApiHeaders(), ...extraHeaders },
        signal: controller.signal
      })
      if (!response.ok) {
        throw new AmazonApiError(
          `${label} failed with HTTP ${response.status}`,
          response.status,
          parseRetryAfterMs(response.headers?.get?.("retry-after"))
        )
      }
      return await response.json()
    } finally {
      clearTimeout(timeout)
      externalSignal?.removeEventListener("abort", abortExternal)
    }
  }

  async function fetchAmazonExactNode(requestId, nodeId, signal) {
    const body = await fetchJsonWithTimeout(
      amazonExactNodeUrl(nodeId),
      "Reading exact Amazon Photos item metadata",
      signal,
      {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        "x-amz-clouddrive-appid": AMAZON_APP_ID
      }
    )
    const node =
      (Array.isArray(body?.nodes) && body.nodes[0]) ||
      (Array.isArray(body?.data) && body.data[0]) ||
      (body?.node && typeof body.node === "object" ? body.node : body)
    const exactId = firstString(node?.id, node?.nodeId, node?.objectId)
    if (!node || typeof node !== "object" || exactId !== nodeId) {
      throw new Error("Amazon Photos exact item lookup did not match the requested item.")
    }
    return { ...node, id: exactId }
  }

  function validAmazonScanScopeFingerprint(value) {
    return (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 512 &&
      value.trim() === value &&
      !/[\u0000-\u001f\u007f]/.test(value)
    )
  }

  function rememberScannedAmazonOriginalResources(mediaItems, args) {
    const providerSessionId = args?.providerSessionId
    const scopeFingerprint = args?.scanScopeFingerprint
    if (
      !Array.isArray(mediaItems) ||
      !providerSessionId ||
      providerSessionId !== commandHost.providerSessionId ||
      !validAmazonScanScopeFingerprint(scopeFingerprint)
    ) {
      return
    }
    for (const item of mediaItems) {
      const source = scannedResourceByItem.get(item)
      if (!source || typeof item?.mediaKey !== "string") continue
      commandHost.originalMediaRetrieval.rememberResource(
        "amazon",
        providerSessionId,
        scopeFingerprint,
        item.mediaKey,
        source
      )
    }
  }

  function requireScannedAmazonOriginalResource(requestId, args) {
    if (args?.userOptIn !== true) {
      throw new Error("Original media retrieval requires explicit user opt-in.")
    }
    if (args?.requestId !== requestId) {
      throw new Error("The Amazon Photos retrieval request identity did not match.")
    }
    if (
      typeof args?.providerSessionId !== "string" ||
      !args.providerSessionId ||
      args.providerSessionId !== commandHost.providerSessionId
    ) {
      throw new Error("The Amazon Photos provider session changed. Scan the current account again.")
    }
    if (!validAmazonScanScopeFingerprint(args?.scanScopeFingerprint)) {
      throw new Error("The Amazon Photos review scope is missing or invalid. Scan again.")
    }
    if (typeof args?.mediaKey !== "string" || !args.mediaKey) {
      throw new Error("The Amazon Photos media target is missing.")
    }
    const resource = commandHost.originalMediaRetrieval.getResource(
      "amazon",
      args.providerSessionId,
      args.scanScopeFingerprint,
      args.mediaKey,
      true
    )
    if (!resource) {
      throw new Error("The Amazon Photos original is not present in this recent review. Scan again.")
    }
    return { resource }
  }

  function reserveAmazonOriginalReviewBudget(args, resource) {
    return commandHost.originalMediaRetrieval.reserveBudget({
      provider: "amazon",
      sessionId: args?.providerSessionId,
      scopeFingerprint: args?.scanScopeFingerprint,
      maxBytes: args?.maxBytes,
      aggregateBudgetBytes: args?.aggregateBudgetBytes,
      resourceSize: resource.size,
      maxBudgetScopes: AMAZON_REVIEW_BUDGET_SCOPE_MAX
    })
  }

  function releaseAmazonOriginalReviewBudget(reservation) {
    commandHost.originalMediaRetrieval.releaseBudget(reservation)
  }

  async function readAmazonOriginalWithinLimits(response, reservation, signal) {
    const contentLength = Number(response.headers?.get?.("content-length"))
    if (Number.isFinite(contentLength) && contentLength > reservation.maxBytes) {
      await response.body?.cancel?.().catch(() => {})
      throw new Error("The Amazon Photos original exceeds the approved byte limit.")
    }
    const reader = response.body?.getReader?.()
    if (!reader) {
      throw new Error("Amazon Photos original retrieval requires a streaming response to enforce byte limits.")
    }
    const chunks = []
    let byteLength = 0
    try {
      while (true) {
        commandHost.throwIfAborted(signal)
        const result = await reader.read()
        if (result.done) break
        if (!(result.value instanceof Uint8Array)) {
          throw new Error("Amazon Photos returned an invalid original-media stream.")
        }
        const nextLength = byteLength + result.value.byteLength
        if (
          !commandHost.originalMediaRetrieval.consumeChunk(
            reservation,
            result.value.byteLength
          )
        ) {
          await reader.cancel().catch(() => {})
          throw new Error("The Amazon Photos original exceeded the approved review byte budget.")
        }
        byteLength = nextLength
        chunks.push(result.value)
      }
    } catch (error) {
      for (const chunk of chunks) chunk.fill(0)
      await reader.cancel().catch(() => {})
      throw error
    }
    if (byteLength === 0) {
      for (const chunk of chunks) chunk.fill(0)
      throw new Error("Amazon Photos returned an empty original media file.")
    }
    const bytes = new Uint8Array(byteLength)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
      chunk.fill(0)
    }
    return { bytes, byteLength, reader }
  }

  function hexDigest(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  }

  function amazonDownloadUrl(nodeId, ownerId) {
    const url = new URL(
      `/v2/download/signed/${encodeURIComponent(nodeId)}`,
      "https://download-photos.amazon.ca"
    )
    url.searchParams.set("ownerId", ownerId)
    return url
  }

  function isAmazonCanadaMediaRoute(locationLike = location) {
    return (
      locationLike.protocol === "https:" &&
      locationLike.hostname.replace(/^www\./, "") === "amazon.ca"
    )
  }

  async function getOriginalContentHash(requestId, args, signal) {
    let reservation
    let controller
    let abortExternal
    let timeout
    let reader
    let bytes
    try {
      commandHost.throwIfAborted(signal)
      if (!isAmazonCanadaMediaRoute()) {
        throw new Error("Original-content verification is currently verified only on Amazon Photos Canada.")
      }
      assertLibraryRoute()
      if (typeof globalThis.crypto?.subtle?.digest !== "function") {
        throw new Error("This page cannot compute a local SHA-256 digest for original media.")
      }
      const { resource } = requireScannedAmazonOriginalResource(requestId, args)
      if (
        !["photo", "video"].includes(resource.mediaKind) ||
        !/^(?:image|video)\//i.test(resource.mimeType || "")
      ) {
        throw new Error("Amazon Photos original-byte verification is unavailable for this media kind.")
      }
      reservation = reserveAmazonOriginalReviewBudget(args, resource)
      const ownerId = await getVerifiedAmazonMutationOwner(args, signal)
      if (ownerId !== resource.ownerId) {
        throw new Error("Amazon Photos account changed after this item was scanned.")
      }
      const node = await readAmazonPersonalNode(
        requestId,
        resource.nodeId,
        ownerId,
        signal
      )
      if (!node) {
        throw new Error("Amazon Photos could not verify this exact item in the current personal library.")
      }
      const contentProperties = node.contentProperties || {}
      const expectedSize = firstNumber(contentProperties.size)
      const contentMd5 = amazonContentMd5(contentProperties)
      const mimeType = firstString(
        contentProperties.contentType,
        node.contentType
      )?.split(";")[0]?.trim()?.toLowerCase()
      if (
        node.id !== resource.nodeId ||
        firstString(node.ownerId) !== resource.ownerId ||
        node.isShared !== false ||
        expectedSize !== resource.size ||
        (resource.contentMd5 && contentMd5 !== resource.contentMd5) ||
        mimeType !== resource.mimeType ||
        expectedSize > reservation.maxBytes ||
        !/^(?:image|video)\/[a-z0-9.+-]+$/i.test(mimeType || "")
      ) {
        throw new Error("Amazon Photos exact-item ownership or original metadata changed since the scan.")
      }

      const downloadUrl = amazonDownloadUrl(resource.nodeId, ownerId)
      const observedUrl = downloadUrl.toString()
      controller = new AbortController()
      abortExternal = () => controller.abort()
      signal?.addEventListener("abort", abortExternal, { once: true })
      timeout = setTimeout(() => controller.abort(), AMAZON_API_TIMEOUT_MS)
      commandHost.throwIfAborted(signal)
      const response = await fetch(downloadUrl, {
        credentials: "include",
        redirect: "manual",
        signal: controller.signal
      })
      if (
        !response.ok ||
        response.status !== 200 ||
        response.redirected ||
        (response.url && response.url !== observedUrl)
      ) {
        throw new Error("Amazon Photos did not return the exact original item without redirecting.")
      }
      const responseUrl = response.url ? new URL(response.url) : downloadUrl
      if (
        responseUrl.protocol !== "https:" ||
        responseUrl.hostname !== "download-photos.amazon.ca" ||
        responseUrl.pathname !== downloadUrl.pathname ||
        responseUrl.searchParams.get("ownerId") !== ownerId ||
        [...responseUrl.searchParams.keys()].some((key) => key !== "ownerId")
      ) {
        throw new Error("Amazon Photos returned a download outside the verified item and owner route.")
      }
      const responseMimeType = response.headers?.get?.("content-type")
        ?.split(";")[0]
        ?.trim()
        ?.toLowerCase()
      if (responseMimeType && responseMimeType !== mimeType) {
        throw new Error("Amazon Photos original media type did not match its exact-item metadata.")
      }
      const original = await readAmazonOriginalWithinLimits(
        response,
        reservation,
        signal
      )
      bytes = original.bytes
      reader = original.reader
      if (original.byteLength !== expectedSize) {
        throw new Error("Amazon Photos original byte count did not match the exact-item metadata.")
      }
      commandHost.throwIfAborted(signal)
      if ((await getVerifiedAmazonMutationOwner(args, signal)) !== ownerId) {
        throw new Error("Amazon Photos account changed while verifying original media.")
      }
      const verifiedNode = await readAmazonPersonalNode(
        requestId,
        resource.nodeId,
        ownerId,
        signal
      )
      if (
        !verifiedNode ||
        verifiedNode.id !== resource.nodeId ||
        verifiedNode.isShared !== false ||
        firstNumber(verifiedNode.contentProperties?.size) !== expectedSize ||
        (contentMd5 && amazonContentMd5(verifiedNode.contentProperties) !== contentMd5) ||
        firstString(verifiedNode.contentProperties?.contentType, verifiedNode.contentType)
          ?.split(";")[0]?.trim()?.toLowerCase() !== mimeType
      ) {
        throw new Error("Amazon Photos item ownership or original metadata changed during verification.")
      }
      if (
        !commandHost.originalMediaRetrieval.isCurrentResource(
          "amazon",
          args.providerSessionId,
          args.scanScopeFingerprint,
          args.mediaKey,
          resource
        )
      ) {
        throw new Error("The Amazon Photos review scope changed during original retrieval.")
      }
      const digest = new Uint8Array(
        await globalThis.crypto.subtle.digest("SHA-256", bytes.buffer)
      )
      commandHost.throwIfAborted(signal)
      assertLibraryRoute()
      if ((await getVerifiedAmazonMutationOwner(args, signal)) !== ownerId) {
        throw new Error("Amazon Photos account changed while finalizing original verification.")
      }
      const finalNode = await readAmazonPersonalNode(
        requestId,
        resource.nodeId,
        ownerId,
        signal
      )
      if (
        !finalNode ||
        firstNumber(finalNode.contentProperties?.size) !== expectedSize ||
        firstString(finalNode.contentProperties?.contentType, finalNode.contentType)
          ?.split(";")[0]?.trim()?.toLowerCase() !== mimeType ||
        (contentMd5 && amazonContentMd5(finalNode.contentProperties) !== contentMd5)
      ) {
        throw new Error("Amazon Photos original metadata changed before hash delivery.")
      }
      if (
        !commandHost.originalMediaRetrieval.isCurrentResource(
          "amazon",
          args.providerSessionId,
          args.scanScopeFingerprint,
          args.mediaKey,
          resource
        )
      ) {
        throw new Error("The Amazon Photos review scope changed before hash delivery.")
      }
      postResult("getOriginalContentHash", requestId, {
        mediaKey: args.mediaKey,
        scopeFingerprint: args.scanScopeFingerprint,
        contentHash: {
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes",
          value: hexDigest(digest)
        },
        byteLength: original.byteLength,
        mimeType
      })
    } catch (error) {
      const message =
        error?.name === "AbortError" || signal?.aborted
          ? "Amazon Photos original retrieval was cancelled or timed out."
          : error instanceof Error && !/https?:\/\//i.test(error.message)
            ? error.message
            : "Amazon Photos original retrieval failed without exposing its resource URL."
      postError("getOriginalContentHash", requestId, message)
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abortExternal)
      releaseAmazonOriginalReviewBudget(reservation)
      bytes?.fill(0)
      if (reader) {
        try {
          await reader.cancel()
        } catch {
          // The stream may already be complete or aborted.
        }
      }
    }
  }

  async function getVideoPlaybackUrl(requestId, args, signal) {
    try {
      commandHost.throwIfAborted(signal)
      if (!isAmazonCanadaMediaRoute()) {
        throw new Error("Amazon Photos video playback is currently verified only on Amazon Photos Canada.")
      }
      assertLibraryRoute()
      const { resource } = requireScannedAmazonOriginalResource(requestId, args)
      if (
        resource.mediaKind !== "video" ||
        !/^video\/[a-z0-9.+-]+$/i.test(resource.mimeType || "") ||
        !Number.isSafeInteger(resource.size) ||
        resource.size < 1
      ) {
        throw new Error("The selected Amazon Photos item has no verified video original.")
      }

      const ownerId = await getVerifiedAmazonMutationOwner(args, signal)
      if (ownerId !== resource.ownerId) {
        throw new Error("Amazon Photos account changed after this video was scanned.")
      }
      const node = await readAmazonPersonalNode(
        requestId,
        resource.nodeId,
        ownerId,
        signal
      )
      const contentType = firstString(
        node?.contentProperties?.contentType,
        node?.contentType
      )?.split(";")[0]?.trim()?.toLowerCase()
      const contentMd5 = amazonContentMd5(node?.contentProperties)
      if (
        !node ||
        node.id !== resource.nodeId ||
        firstString(node.ownerId) !== ownerId ||
        node.isShared !== false ||
        firstNumber(node.contentProperties?.size) !== resource.size ||
        (resource.contentMd5 && contentMd5 !== resource.contentMd5) ||
        contentType !== resource.mimeType
      ) {
        throw new Error("Amazon Photos could not verify this exact video in the current personal library.")
      }

      const playbackUrl = amazonDownloadUrl(resource.nodeId, ownerId)
      if (
        playbackUrl.protocol !== "https:" ||
        playbackUrl.hostname !== "download-photos.amazon.ca" ||
        playbackUrl.pathname !== `/v2/download/signed/${encodeURIComponent(resource.nodeId)}` ||
        playbackUrl.searchParams.get("ownerId") !== ownerId ||
        [...playbackUrl.searchParams.keys()].some((name) => name !== "ownerId")
      ) {
        throw new Error("Amazon Photos did not provide an approved exact-video route.")
      }

      commandHost.throwIfAborted(signal)
      if ((await getVerifiedAmazonMutationOwner(args, signal)) !== ownerId) {
        throw new Error("Amazon Photos account changed while preparing video playback.")
      }
      const finalNode = await readAmazonPersonalNode(
        requestId,
        resource.nodeId,
        ownerId,
        signal
      )
      const finalContentType = firstString(
        finalNode?.contentProperties?.contentType,
        finalNode?.contentType
      )?.split(";")[0]?.trim()?.toLowerCase()
      if (
        !finalNode ||
        finalNode.id !== resource.nodeId ||
        firstString(finalNode.ownerId) !== ownerId ||
        finalNode.isShared !== false ||
        firstNumber(finalNode.contentProperties?.size) !== resource.size ||
        (contentMd5 && amazonContentMd5(finalNode.contentProperties) !== contentMd5) ||
        finalContentType !== resource.mimeType ||
        !commandHost.originalMediaRetrieval.isCurrentResource(
          "amazon",
          args.providerSessionId,
          args.scanScopeFingerprint,
          args.mediaKey,
          resource
        )
      ) {
        throw new Error("Amazon Photos video ownership or review scope changed before playback.")
      }
      commandHost.throwIfAborted(signal)
      assertLibraryRoute()
      postResult("getVideoPlaybackUrl", requestId, {
        mediaKey: args.mediaKey,
        scopeFingerprint: args.scanScopeFingerprint,
        playbackUrl: playbackUrl.href,
        mimeType: resource.mimeType
      })
    } catch (error) {
      const message =
        error?.name === "AbortError" || signal?.aborted
          ? "Amazon Photos video playback retrieval was cancelled."
          : error instanceof Error && !/https?:\/\//i.test(error.message)
            ? error.message
            : "Amazon Photos video playback could not be prepared safely."
      postError("getVideoPlaybackUrl", requestId, message)
    }
  }

  async function patchJsonWithTimeout(url, body, label, externalSignal) {
    commandHost.throwIfAborted(externalSignal)
    const controller = new AbortController()
    const abortExternal = () => controller.abort()
    externalSignal?.addEventListener("abort", abortExternal, { once: true })
    const timeout = setTimeout(() => controller.abort(), AMAZON_API_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        method: "PATCH",
        credentials: "include",
        headers: {
          ...amazonApiHeaders(),
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      if (!response.ok) {
        throw new AmazonApiError(
          `${label} failed with HTTP ${response.status}`,
          response.status,
          parseRetryAfterMs(response.headers?.get?.("retry-after"))
        )
      }
      const text = await response.text().catch(() => "")
      return text ? JSON.parse(text) : {}
    } finally {
      clearTimeout(timeout)
      externalSignal?.removeEventListener("abort", abortExternal)
    }
  }

  async function fetchAmazonSearchPage(
    requestId,
    offset,
    filters,
    signal,
    startToken,
    limit = AMAZON_PAGE_LIMIT
  ) {
    let lastError
    let maxAttempts = AMAZON_API_RETRY_COUNT
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      const pageLabel =
        offset === 0
          ? "first Amazon Photos API page"
          : `Amazon Photos API page at offset ${offset.toLocaleString()}`
      postProgress(
        requestId,
        offset,
        attempt === 0
          ? `Fetching ${pageLabel}...`
          : `Retrying ${pageLabel} (${attempt}/${maxAttempts})...`
      )
      try {
        return await fetchJsonWithTimeout(
          amazonSearchUrl({
            offset,
            limit,
            filters,
            startToken
          }),
          `Fetching ${pageLabel}`,
          signal
        )
      } catch (error) {
        if (signal?.aborted) throw error
        lastError = error
        maxAttempts = Math.max(maxAttempts, retryLimitFor(error))
        if (attempt >= maxAttempts) break
        const delayMs = retryDelayMs(error, attempt)
        if (error?.status === 429) {
          postProgress(
            requestId,
            offset,
            `Amazon rate limit hit at offset ${offset.toLocaleString()}; waiting ${Math.ceil(delayMs / 1000)}s before retry ${attempt + 1} of ${maxAttempts}.`
          )
        }
        await commandHost.delay(delayMs, signal)
      }
    }
    throw lastError
  }

  function amazonNodesUrl({
    albumId,
    offset,
    startToken,
    limit = AMAZON_PAGE_LIMIT
  }) {
    const path = albumId
      ? `/drive/v1/nodes/${encodeURIComponent(albumId)}/children`
      : "/drive/v1/nodes"
    const url = new URL(path, amazonOrigin())
    url.searchParams.set("limit", String(limit))
    if (startToken) url.searchParams.set("startToken", startToken)
    else url.searchParams.set("offset", String(offset))
    url.searchParams.set("resourceVersion", "V2")
    url.searchParams.set("ContentType", "JSON")
    // Amazon's web album route only emits its continuation token when the
    // request uses the same asset/temp-link flags as the Photos UI. Keep the
    // flags on both the initial and token requests; the adapter still fails
    // closed if the provider omits or repeats a token.
    url.searchParams.set("asset", "ALL")
    url.searchParams.set("tempLink", "true")
    if (albumId) url.searchParams.set("sort", "['createdDate DESC']")
    if (!albumId) url.searchParams.set("filters", "kind:VISUAL_COLLECTION")
    return url
  }

  async function fetchAmazonNodesPage(
    requestId,
    albumId,
    offset,
    signal,
    startToken,
    limit = AMAZON_PAGE_LIMIT
  ) {
    let lastError
    let maxAttempts = AMAZON_API_RETRY_COUNT
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      const label = albumId
        ? `Amazon Photos album page at offset ${offset.toLocaleString()}`
        : `Amazon Photos album list page at offset ${offset.toLocaleString()}`
      postProgress(
        requestId,
        offset,
        attempt === 0
          ? `Fetching ${label}...`
          : `Retrying ${label} (${attempt}/${maxAttempts})...`
      )
      try {
        return await fetchJsonWithTimeout(
          amazonNodesUrl({ albumId, offset, startToken, limit }),
          `Fetching ${label}`,
          signal
        )
      } catch (error) {
        if (signal?.aborted) throw error
        lastError = error
        maxAttempts = Math.max(maxAttempts, retryLimitFor(error))
        if (attempt >= maxAttempts) break
        const delayMs = retryDelayMs(error, attempt)
        if (error?.status === 429) {
          postProgress(
            requestId,
            offset,
            `Amazon rate limit hit at offset ${offset.toLocaleString()}; waiting ${Math.ceil(delayMs / 1000)}s before retry ${attempt + 1} of ${maxAttempts}.`
          )
        }
        await commandHost.delay(delayMs, signal)
      }
    }
    throw lastError
  }

  function amazonOwnerIdentityFromNode(node) {
    if (!node || typeof node !== "object") return ""
    return firstString(
      node.ownerId,
      node.createdBy,
      node.modifiedBy,
      node.owner?.id,
      node.owner?.recordName,
      node.owner?.ownerId,
      node.createdBy?.id,
      node.modifiedBy?.id
    )
  }

  function amazonOwnerIdentityFromPage(page) {
    const nodes = Array.isArray(page?.data) ? page.data : []
    for (const node of nodes) {
      const ownerIdentity = amazonOwnerIdentityFromNode(node)
      if (ownerIdentity) return ownerIdentity
    }
    return ""
  }

  // Amazon does not expose a documented account endpoint. The signed-in page's
  // private node responses carry an owner marker, so use that opaque value only
  // to bind this tab to the account that produced the scan. Community clients
  // observe the same owner fields on the private search/nodes routes; treat the
  // marker as a session signal, never as a user-facing identity.
  async function discoverAmazonProviderIdentity(requestId, signal) {
    const searchPage = await fetchAmazonSearchPage(
      requestId,
      0,
      buildFilters(),
      signal,
      undefined,
      1
    )
    const searchOwner = amazonOwnerIdentityFromPage(searchPage)
    if (searchOwner) return searchOwner

    const albumPage = await fetchAmazonNodesPage(
      requestId,
      null,
      0,
      signal,
      undefined,
      1
    )
    return amazonOwnerIdentityFromPage(albumPage) || amazonCookieIdentity()
  }

  function discoverAmazonProfileDisplayName() {
    // This user-visible label is for orientation only. It is not an account
    // identifier; the private owner marker remains the provider-session key.
    const profileButtons = Array.from(
      document.querySelectorAll(
        "header#primary-header button.user-settings-menu"
      )
    )
    if (profileButtons.length !== 1 || profileButtons[0].hidden) return ""
    const displayName = (profileButtons[0].innerText || "")
      .replace(/\s+/g, " ")
      .trim()
    if (
      !displayName ||
      displayName.length > 100 ||
      /^(?:account|profile|sign in)$/i.test(displayName) ||
      /[\u0000-\u001f\u007f]/.test(displayName)
    ) {
      return ""
    }
    return displayName
  }

  async function revalidateAmazonProviderSession(
    command,
    requestId,
    args,
    signal
  ) {
    if (!args?.providerSessionId) return { ownerId: null }
    try {
      commandHost.throwIfAborted(signal)
      const ownerIdentity = await discoverAmazonProviderIdentity(
        requestId,
        signal
      )
      if (!ownerIdentity) {
        postError(
          command,
          requestId,
          "Amazon Photos could not revalidate the signed-in account. Reload the page and reconnect before continuing."
        )
        return false
      }
      const currentSessionId = await commandHost.setProviderIdentity(ownerIdentity)
      if (currentSessionId !== args.providerSessionId) {
        postError(
          command,
          requestId,
          "The Amazon Photos account changed after review. Reconnect and scan the current account before continuing."
        )
        return false
      }
      return { ownerId: ownerIdentity }
    } catch (error) {
      if (signal?.aborted) throw error
      postError(command, requestId, error)
      return false
    }
  }

  function amazonAlbumIdFromScope(albumScope) {
    const mediaKey = albumScope?.mediaKey
    const prefix = "amazon-album-"
    if (typeof mediaKey !== "string" || !mediaKey.startsWith(prefix)) {
      throw new Error("The selected Amazon Photos album scope is invalid.")
    }
    const albumId = mediaKey.slice(prefix.length)
    if (!albumId || /[\u0000-\u001f\u007f]/.test(albumId)) {
      throw new Error("The selected Amazon Photos album scope is invalid.")
    }
    return albumId
  }

  async function fetchAllPersonalAmazonAlbums(requestId, signal, expectedOwnerId) {
    let totalCount = null
    const offset = 0
    let startToken = ""
    const allNodes = []
    const seenIds = new Set()
    const seenPageSignatures = new Set()
    const seenPageTokens = new Set()

    while (totalCount === null || allNodes.length < totalCount) {
      commandHost.throwIfAborted(signal)
      const page = await fetchAmazonNodesPage(
        requestId,
        null,
        offset,
        signal,
        startToken
      )
      if (!page || !Array.isArray(page.data)) {
        throw new Error("Amazon Photos returned an invalid album-list page.")
      }
      const pageCount = amazonPageCount(page)
      if (pageCount === null) {
        throw new Error("Amazon Photos did not provide a reliable album count.")
      }
      if (totalCount === null) totalCount = pageCount
      else if (pageCount !== totalCount) {
        throw new Error("Amazon Photos album count changed during pagination.")
      }

      const nodes = page.data
      const nextToken = amazonPageContinuation(page)
      if (
        nodes.length > AMAZON_PAGE_LIMIT ||
        allNodes.length + nodes.length > totalCount
      ) {
        throw new Error(
          "Amazon Photos returned an inconsistent album page size."
        )
      }
      if (nodes.length === 0) {
        if (totalCount === 0 && offset === 0 && !nextToken) return []
        throw new Error(
          "Amazon Photos album pagination ended before its reported count."
        )
      }
      const signature = amazonPageSignature(nodes)
      if (!signature || seenPageSignatures.has(signature)) {
        throw new Error("Amazon Photos repeated or malformed an album page.")
      }
      seenPageSignatures.add(signature)

      for (const node of nodes) {
        const id = firstString(node?.id, node?.nodeId, node?.objectId)
        if (
          !id ||
          seenIds.has(id) ||
          node.kind !== "VISUAL_COLLECTION" ||
          typeof node.isShared !== "boolean" ||
          !firstString(node.name) ||
          !firstString(node.ownerId)
        ) {
          throw new Error(
            "Amazon Photos returned an album with an invalid schema."
          )
        }
        if (
          expectedOwnerId &&
          node.isShared === false &&
          node.ownerId !== expectedOwnerId
        ) {
          throw new Error("Amazon Photos returned an album outside the current owner's personal library.")
        }
        seenIds.add(id)
        allNodes.push({ ...node, id })
      }

      if (allNodes.length === totalCount) {
        if (nextToken) {
          throw new Error("Amazon Photos album continuation token contradicts its terminal count.")
        }
        break
      }
      if (!nextToken) {
        throw new Error(
          "Amazon Photos album pagination ended before its reported count."
        )
      }
      if (seenPageTokens.has(nextToken)) {
        throw new Error("Amazon Photos repeated an album pagination token.")
      }
      seenPageTokens.add(nextToken)
      startToken = nextToken
      await commandHost.delay(AMAZON_SEARCH_PAGE_PAUSE_MS, signal)
    }

    return allNodes.filter((node) => node.isShared === false)
  }

  async function listAlbums(requestId, args, signal) {
    try {
      commandHost.throwIfAborted(signal)
      assertLibraryRoute()
      const session = await revalidateAmazonProviderSession("listAlbums", requestId, args, signal)
      if (!session) {
        return
      }
      const albums = await fetchAllPersonalAmazonAlbums(requestId, signal, session.ownerId)
      if (args?.providerSessionId && !(await revalidateAmazonProviderSession("listAlbums", requestId, args, signal))) {
        return
      }
      postResult(
        "listAlbums",
        requestId,
        albums.map((node) => ({
          mediaKey: `amazon-album-${node.id}`,
          title: node.name,
          isShared: false
        }))
      )
    } catch (error) {
      postError("listAlbums", requestId, error)
    }
  }

  function parseAmazonDate(value) {
    if (!value) return Number.NaN
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }

  function amazonNodeCreationTimestamp(node) {
    const content = node?.contentProperties || {}
    return parseAmazonDate(firstString(node?.createdDate, content.createdDate))
  }

  function amazonTimestampWithProvenance(node) {
    const content = node?.contentProperties || {}
    const image = node?.image || node?.img || content.image || {}
    const video = node?.video || content.video || {}
    const captureDate = firstString(
      image.dateTimeOriginal,
      image.dateTimeDigitized,
      video.dateTimeOriginal,
      video.dateTimeDigitized
    )
    if (captureDate) {
      return { timestamp: parseAmazonDate(captureDate), provenance: "capture" }
    }

    // Amazon's private `contentDate`, generic DateTime, and video DateTime
    // fields have no public provenance contract. Preserve their value without
    // claiming that they are camera capture time.
    const providerDate = firstString(
      content.contentDate,
      image.dateTime,
      video.dateTime
    )
    if (providerDate) {
      return { timestamp: parseAmazonDate(providerDate), provenance: "unknown" }
    }

    const createdDate = firstString(node?.createdDate, content.createdDate)
    if (createdDate) {
      return { timestamp: parseAmazonDate(createdDate), provenance: "creation" }
    }
    const modifiedDate = firstString(node?.modifiedDate, content.modifiedDate)
    if (modifiedDate) {
      return { timestamp: parseAmazonDate(modifiedDate), provenance: "modified" }
    }
    return { timestamp: Number.NaN, provenance: "unknown" }
  }

  function firstString(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value
    }
    return ""
  }

  function amazonPageContinuation(page) {
    const candidates = [
      page?.nextToken,
      page?.next_token,
      page?.nextPageToken,
      page?.next_page_token,
      page?.continuationToken,
      page?.continuation_token,
      page?.pagination?.nextToken,
      page?.pagination?.next_token,
      page?.paging?.nextToken,
      page?.paging?.next_token,
      page?.page?.nextToken,
      page?.page?.next_token
    ]
    let token = ""
    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null || candidate === "") continue
      if (
        typeof candidate !== "string" ||
        !candidate.trim() ||
        candidate.length > 4096 ||
        /[\u0000-\u001f\u007f]/.test(candidate) ||
        (token && token !== candidate)
      ) {
        throw new Error("Amazon Photos returned a malformed or contradictory pagination token.")
      }
      token = candidate
    }
    return token
  }

  function firstNumber(...values) {
    for (const value of values) {
      if (
        (typeof value !== "number" && typeof value !== "string") ||
        (typeof value === "string" && !value.trim())
      ) continue
      const number = Number(value)
      if (Number.isFinite(number) && number > 0 && number <= Number.MAX_SAFE_INTEGER) return number
    }
    return undefined
  }

  function amazonContentMd5(content) {
    return typeof content?.md5 === "string" && /^[a-f0-9]{32}$/i.test(content.md5)
      ? content.md5.toLowerCase()
      : undefined
  }

  function durationFromExplicitUnit(value, multiplier) {
    const duration = firstNumber(value)
    if (duration === undefined) return undefined
    const milliseconds = Math.round(duration * multiplier)
    return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : undefined
  }

  function amazonVideoDurationMs(video, content) {
    const nestedVideo = content?.video || {}
    const milliseconds = [
      video?.durationMillis,
      video?.durationMs,
      content?.durationMillis,
      content?.durationMs,
      nestedVideo.durationMillis,
      nestedVideo.durationMs
    ]
      .map((value) => durationFromExplicitUnit(value, 1))
      .find((value) => value !== undefined)
    if (milliseconds !== undefined) return milliseconds

    const seconds = [
      video?.durationSeconds,
      content?.durationSeconds,
      nestedVideo.durationSeconds
    ]
      .map((value) => durationFromExplicitUnit(value, 1000))
      .find((value) => value !== undefined)
    if (seconds !== undefined) return seconds

    // The exact-node response's contentProperties.video.duration field was
    // matched to the native Photos viewer's 0:02 duration on a disposable
    // fixture. Other unqualified duration fields remain unknown.
    return durationFromExplicitUnit(nestedVideo.duration, 1000)
  }

  function nestedValue(object, path) {
    let current = object
    for (const key of path) {
      if (!current || typeof current !== "object") return undefined
      current = current[key]
    }
    return current
  }

  function nodeThumbnailUrl(node) {
    const nodeId = firstString(node?.id, node?.nodeId, node?.objectId)
    const ownerId = firstString(
      node?.ownerId,
      node?.createdBy,
      node?.modifiedBy
    )
    if (nodeId && ownerId) {
      const url = new URL(
        `/v1/thumbnail/${encodeURIComponent(nodeId)}`,
        amazonThumbnailOrigin()
      )
      url.searchParams.set("ownerId", ownerId)
      url.searchParams.set("viewBox", "600")
      return url.toString()
    }

    const assets = Array.isArray(node.assets) ? node.assets : []
    for (const asset of assets) {
      const candidate =
        asset?.url ||
        asset?.href ||
        asset?.link ||
        asset?.downloadUrl ||
        asset?.contentUrl
      if (typeof candidate === "string" && candidate) return candidate
    }
    return ""
  }

  function amazonPageSignature(nodes) {
    const ids = nodes.map((node) =>
      firstString(node?.id, node?.nodeId, node?.objectId)
    )
    return ids.length > 0 && ids.every(Boolean) ? JSON.stringify(ids) : null
  }

  function amazonFavoriteValue(node) {
    const values = [
      node?.settings?.favorite,
      node?.isFavorite,
      node?.contentProperties?.favorite,
      node?.contentProperties?.isFavorite
    ]
    // A confirmed favorite must survive contradictory negative metadata.
    if (values.some((value) => value === true)) return true
    return values.some((value) => value === false) ? false : undefined
  }

  function mapAmazonNode(node, index, favoriteSource = "provider-metadata") {
    const id = firstString(node.id, node.nodeId, node.objectId)
    if (!id) return null

    const content = node.contentProperties || {}
    const image = node.image || node.img || {}
    const video = node.video || {}
    const contentType = firstString(content.contentType, node.contentType)
    const mimeType = /^\w+\/[-+\w.]+$/.test(contentType)
      ? contentType.toLowerCase()
      : undefined
    const isLivePhoto = node.isLivePhoto === true || content.isLivePhoto === true
    if (mimeType && !/^(?:image|video)\//i.test(mimeType)) return null
    const isVideo =
      /^video\//i.test(mimeType || "") ||
      (!mimeType && firstNumber(video.width, video.height, content.video?.width, content.video?.height) !== undefined)
    const isPhoto =
      /^image\//i.test(mimeType || "") ||
      (!mimeType && firstNumber(image.width, image.height, content.image?.width, content.image?.height) !== undefined)
    if (!isLivePhoto && !isVideo && !isPhoto) return null
    const width = firstNumber(
      image.width,
      video.width,
      nestedValue(node, ["contentProperties", "image", "width"]),
      nestedValue(node, ["contentProperties", "video", "width"])
    )
    const height = firstNumber(
      image.height,
      video.height,
      nestedValue(node, ["contentProperties", "image", "height"]),
      nestedValue(node, ["contentProperties", "video", "height"])
    )
    const duration = amazonVideoDurationMs(video, content)
    const { timestamp, provenance: timestampProvenance } =
      amazonTimestampWithProvenance(node)
    const creationTimestamp = amazonNodeCreationTimestamp(node)
    const mediaKey = `amazon-${id}`
    const thumb = nodeThumbnailUrl(node)
    if (!thumb) return null
    const contentMd5 = amazonContentMd5(content)
    const favoriteValue = amazonFavoriteValue(node)
    const nodeOwnerId = amazonOwnerIdentityFromNode(node)
    const originalSize = firstNumber(content.size)
    const hasOriginalResource = Boolean(
      nodeOwnerId &&
        Number.isSafeInteger(originalSize) &&
        originalSize > 0 &&
        mimeType &&
        (isPhoto || isVideo)
    )

    const mappedItem = {
      mediaKey,
      dedupKey: id,
      exactContentHash: contentMd5 ? `amazon-md5-${contentMd5}` : undefined,
      contentHash: contentMd5
        ? {
            value: contentMd5,
            algorithm: "md5",
            verificationSource: "provider-checksum"
          }
        : undefined,
      thumb,
      provider: "amazon",
      productUrl: amazonPhotosUrl(
        `/photos/all/gallery/${encodeURIComponent(id)}?sf=1`
      ),
      timestamp,
      timestampProvenance,
      creationTimestamp,
      creationTimestampProvenance: Number.isFinite(creationTimestamp)
        ? "creation"
        : "unknown",
      mediaKind: isLivePhoto
        ? "live-photo"
        : isVideo
          ? "video"
          : isPhoto
            ? "photo"
            : "unknown",
      originalContentVerificationCapability: !isAmazonCanadaMediaRoute()
        ? "unsupported-region"
        : hasOriginalResource && node.isShared === false && !isLivePhoto
          ? "available"
          : "unavailable",
      ...(mimeType ? { mimeType } : {}),
      ...(favoriteValue !== undefined
        ? {
            isFavorite: favoriteValue,
            favoriteStatus: favoriteValue ? "favorite" : "not-favorite",
            favoriteSource
          }
        : {
            favoriteStatus: "unknown",
            favoriteSource: "unavailable"
          }),
      ...(isLivePhoto ? { isLivePhoto: true } : {}),
      resWidth: width,
      resHeight: height,
      fileName:
        firstString(node.name, content.name) || `Amazon Photo ${index + 1}`,
      size: firstNumber(content.size),
      takesUpSpace: null,
      isOriginalQuality: null,
      ...(isVideo
        ? {
            videoPlaybackCapability:
              isAmazonCanadaMediaRoute() && hasOriginalResource
                ? "available"
                : "unavailable"
          }
        : {}),
      duration: isVideo ? duration : undefined
    }
    if (hasOriginalResource) {
      scannedResourceByItem.set(mappedItem, {
        nodeId: id,
        ownerId: nodeOwnerId,
        mediaKind: isLivePhoto ? "live-photo" : isVideo ? "video" : "photo",
        mimeType,
        size: originalSize,
        ...(contentMd5 ? { contentMd5 } : {})
      })
    }
    return mappedItem
  }

  async function lookupAmazonFavorite(requestId, nodeId, ownerId, signal) {
    if (!nodeId || !ownerId) return undefined
    const exactNode = await fetchAmazonExactNode(requestId, nodeId, signal)
    if (
      firstString(exactNode?.ownerId) !== ownerId ||
      exactNode?.isShared !== false
    ) {
      return undefined
    }
    return amazonFavoriteValue(exactNode)
  }

  function buildFilters() {
    return "type:(PHOTOS OR VIDEOS)"
  }

  async function getAllMediaItems(requestId, args, signal) {
    const dateRange = dateRangeBounds(args?.dateRange)
    const requestedAlbumScope = args?.albumScope
    const hasAlbumScope =
      requestedAlbumScope !== undefined && requestedAlbumScope !== null
    const receivedIncrementalHint =
      Number.isFinite(args?.sinceTimestamp) && args.sinceTimestamp > 0
    // The private createdDate order cannot reveal edits, hidden-state changes,
    // or deletions behind a watermark. Refresh validates the entire active
    // inventory; an exhausted result replaces rather than merges cached rows.
    const hasScanLimit = args?.limit !== undefined && args.limit !== null
    const validScanLimit = Number.isSafeInteger(args?.limit) && args.limit > 0
    const scanLimit = validScanLimit ? args.limit : Number.POSITIVE_INFINITY
    let itemsVisited = 0
    let unknownDateItemsSkipped = 0
    let unmappedItemsSkipped = 0
    let failureReason = "provider_error"
    let totalCount = null
    let albumOwnerId = null
    const seen = new Set()
    const mediaItems = []
    const pageSizes = []
    let favoriteLookups = 0

    function coverage(status, stopReason, itemsReturned, totalItems) {
      return {
        status,
        stopReason,
        itemsVisited,
        itemsReturned,
        itemsSkipped: itemsVisited - itemsReturned,
        unknownDateItemsSkipped,
        unmappedItemsSkipped,
        ...(Number.isSafeInteger(totalItems) ? { totalItems } : {}),
        ...(pageSizes.length > 0
          ? { pagesRead: pageSizes.length, pageSizes: pageSizes.slice() }
          : {}),
        mediaTypesCovered: { photos: true, videos: true },
        canResume: false
      }
    }

    try {
      commandHost.throwIfAborted(signal)
      assertLibraryRoute()
      if (hasScanLimit && !validScanLimit) {
        throw new Error("Amazon Photos visit limit must be a positive safe integer.")
      }
      if (hasAlbumScope && requestedAlbumScope?.isShared === true) {
        postError(
          "getAllMediaItems",
          requestId,
          "Amazon Photos shared albums are not supported for personal-library scans.",
          undefined,
          coverage("failed", "unsupported_scope", 0)
        )
        return
      }
      const session = await revalidateAmazonProviderSession("getAllMediaItems", requestId, args, signal)
      if (!session) {
        return
      }
      const albumId = hasAlbumScope
        ? amazonAlbumIdFromScope(requestedAlbumScope)
        : null
      if (albumId) {
        const personalAlbums = await fetchAllPersonalAmazonAlbums(
          requestId,
          signal,
          session.ownerId
        )
        const selectedAlbum = personalAlbums.find(
          (album) => album.id === albumId
        )
        if (!selectedAlbum) {
          throw new Error(
            "The selected Amazon Photos album is unavailable or is not a personal album. Refresh the album list and try again."
          )
        }
        albumOwnerId = selectedAlbum.ownerId
      }
      if (receivedIncrementalHint && !hasAlbumScope) {
        postProgress(
          requestId,
          0,
          "Amazon Photos cannot detect edits or deletions from createdDate alone; this scan follows the library refresh path."
        )
      }
      const filters = buildFilters(args)
      const fetchPage = (offset, startToken) =>
        albumId
          ? fetchAmazonNodesPage(
              requestId,
              albumId,
              offset,
              signal,
              startToken
            )
          : fetchAmazonSearchPage(
              requestId,
              offset,
              filters,
              signal,
              startToken
            )
      const firstPage = await fetchPage(0, "")
      totalCount = amazonPageCount(firstPage)
      if (
        !Array.isArray(firstPage?.data) ||
        firstPage.data.length > AMAZON_PAGE_LIMIT ||
        (totalCount !== null && firstPage.data.length > totalCount) ||
        (albumId && totalCount === null)
      ) {
        throw new Error(
          albumId
            ? "Amazon Photos did not provide a reliable album media page. Refresh the album list and try again."
            : "Amazon Photos returned an inconsistent media page. Refresh the library and try again."
        )
      }
      const maxVisits =
        totalCount === null ? scanLimit : Math.min(totalCount, scanLimit)
      const dateScoped = Boolean(dateRange)
      let offset = 0
      let page = firstPage
      let stoppedAtLimit = false
      let stopReason = "exhausted"
      let schemaUncertain = false
      let duplicateRecord = false
      let cursorMode = Boolean(amazonPageContinuation(firstPage))
      const seenPageSignatures = new Set()
      const seenPageTokens = new Set()
      if (totalCount === 0) {
        if (cursorMode) stopReason = "pagination_error"
        pageSizes.push(firstPage.data.length)
      }

      while (itemsVisited < maxVisits) {
        commandHost.throwIfAborted(signal)
        if (
          totalCount !== null &&
          (amazonPageCount(page) !== totalCount || !Array.isArray(page?.data))
        ) {
          stopReason = "pagination_error"
          break
        }
        const nodes = Array.isArray(page?.data) ? page.data : []
        if (
          nodes.length > AMAZON_PAGE_LIMIT ||
          (totalCount !== null && itemsVisited + nodes.length > totalCount)
        ) {
          stopReason = "pagination_error"
          break
        }
        pageSizes.push(nodes.length)
        if (nodes.length === 0) {
          stopReason = "pagination_error"
          break
        }
        const pageSignature = amazonPageSignature(nodes)
        const repeatedPage =
          pageSignature !== null && seenPageSignatures.has(pageSignature)
        if (pageSignature !== null) seenPageSignatures.add(pageSignature)
        for (const node of nodes) {
          commandHost.throwIfAborted(signal)
          if (itemsVisited >= maxVisits) {
            stoppedAtLimit = true
            break
          }
          if (!node || typeof node !== "object" || Array.isArray(node)) {
            itemsVisited += 1
            schemaUncertain = true
            unmappedItemsSkipped += 1
            continue
          }
          const nodeId = firstString(node.id, node.nodeId, node.objectId)
          if (!nodeId) {
            itemsVisited += 1
            schemaUncertain = true
            unmappedItemsSkipped += 1
            continue
          }
          const mediaKey = nodeId ? `amazon-${nodeId}` : ""
          if (mediaKey && seen.has(mediaKey)) {
            duplicateRecord = true
            break
          }
          itemsVisited += 1
          if (mediaKey) seen.add(mediaKey)
          if (
            session.ownerId &&
            (node.ownerId !== session.ownerId ||
              (node.isShared !== undefined && node.isShared !== false))
          ) {
            throw new Error("Amazon Photos returned media outside the current owner's personal library.")
          }
          if (
            albumId &&
            (node.kind !== "FILE" || node.ownerId !== albumOwnerId)
          ) {
            throw new Error(
              "Amazon Photos album contains an item outside the album owner's personal library. This album cannot be scanned safely."
            )
          }
          const item = mapAmazonNode(node, mediaItems.length)
          if (!item) {
            unmappedItemsSkipped += 1
            continue
          }
          if (dateScoped && !Number.isFinite(item.timestamp)) {
            unknownDateItemsSkipped += 1
            continue
          }
          if (!isTimestampInDateRange(item.timestamp, dateRange)) continue
          const ownerId = amazonOwnerIdentityFromNode(node)
          if (
            item.favoriteStatus === "unknown" &&
            ownerId &&
            favoriteLookups < AMAZON_FAVORITE_LOOKUP_LIMIT
          ) {
            favoriteLookups += 1
            try {
              const favoriteValue = await lookupAmazonFavorite(
                requestId,
                nodeId,
                ownerId,
                signal
              )
              if (typeof favoriteValue === "boolean") {
                item.isFavorite = favoriteValue
                item.favoriteStatus = favoriteValue ? "favorite" : "not-favorite"
                item.favoriteSource = "provider-lookup"
              }
            } catch (error) {
              if (signal?.aborted) throw error
              // Lookup failures leave favorite state explicitly unknown.
            }
          }
          mediaItems.push(item)
        }

        postProgress(
          requestId,
          itemsVisited,
          `Examined ${itemsVisited.toLocaleString()} Amazon Photos items; ${mediaItems.length.toLocaleString()} matched`
        )

        if (duplicateRecord) {
          stopReason = "pagination_error"
          break
        }
        if (
          itemsVisited >= scanLimit &&
          (totalCount === null || itemsVisited < totalCount)
        ) {
          stoppedAtLimit = true
          stopReason = "user_limit"
          break
        }
        if (repeatedPage) {
          stopReason = "pagination_error"
          break
        }

        const nextToken = amazonPageContinuation(page)
        if (nextToken) {
          if (totalCount !== null && itemsVisited === totalCount) {
            stopReason = "pagination_error"
            break
          }
          if (seenPageTokens.has(nextToken)) {
            stopReason = "pagination_error"
            break
          }
          seenPageTokens.add(nextToken)
          cursorMode = true
          await commandHost.delay(AMAZON_SEARCH_PAGE_PAUSE_MS, signal)
          page = await fetchPage(offset, nextToken)
          continue
        }
        if (
          cursorMode &&
          totalCount !== null &&
          itemsVisited < totalCount
        ) {
          stopReason = "pagination_error"
          break
        }
        if (totalCount !== null && itemsVisited === totalCount) {
          stopReason = "exhausted"
          break
        }

        // Offset addresses delivered records, not the requested page cap.
        // A smaller provider page must not skip the following records.
        const nextOffset = offset + nodes.length
        if (totalCount !== null && nextOffset >= totalCount) {
          if (itemsVisited < totalCount) stopReason = "coverage_unknown"
          else stopReason = "exhausted"
          break
        }
        if (totalCount === null && nodes.length < AMAZON_PAGE_LIMIT) {
          stopReason = "coverage_unknown"
          break
        }
        offset = nextOffset
        await commandHost.delay(AMAZON_SEARCH_PAGE_PAUSE_MS, signal)
        page = await fetchPage(offset, "")
      }

      if (stoppedAtLimit) stopReason = "user_limit"
      if (schemaUncertain && stopReason === "exhausted") stopReason = "coverage_unknown"
      const complete = stopReason === "exhausted"
      const knownScopeTotal =
        totalCount !== null && !dateScoped

      if (args?.providerSessionId) {
        if (
          !(await revalidateAmazonProviderSession(
            "getAllMediaItems",
            requestId,
            args,
            signal
          ))
        ) {
          return
        }
        if (complete) rememberScannedAmazonOriginalResources(mediaItems, args)
      }

      postProgress(
        requestId,
        itemsVisited,
        `Examined ${itemsVisited.toLocaleString()} Amazon Photos items; ${mediaItems.length.toLocaleString()} matched`
      )
      postResult(
        "getAllMediaItems",
        requestId,
        mediaItems,
        coverage(
          complete ? "complete" : "partial",
          stopReason,
          mediaItems.length,
          knownScopeTotal ? totalCount : undefined
        )
      )
    } catch (error) {
      if (signal?.aborted) {
        const knownScopeTotal =
          totalCount !== null && !dateRange
        postResult(
          "getAllMediaItems",
          requestId,
          mediaItems,
          coverage(
            "partial",
            "cancelled",
            mediaItems.length,
            knownScopeTotal ? totalCount : undefined
          )
        )
        return
      }
      failureReason = classifyProviderFailure(error)
      const failedCoverage = coverage("failed", failureReason, 0)
      failedCoverage.itemsSkipped = failedCoverage.itemsVisited
      postError("getAllMediaItems", requestId, error, undefined, failedCoverage)
    }
  }

  function amazonTrashNodeId(node) {
    return firstString(
      node?.id,
      node?.nodeId,
      node?.objectId,
      node?.assetId,
      node?.entityId
    )
  }

  function amazonPageCount(page) {
    const value = page?.count
    const count =
      typeof value === "number" ||
      (typeof value === "string" && value.trim().length > 0)
        ? Number(value)
        : Number.NaN
    return Number.isSafeInteger(count) && count >= 0 ? count : null
  }

  async function fetchAmazonTrashPage(requestId, offset, startToken, signal) {
    return fetchJsonWithTimeout(
      amazonTrashUrl({ offset, startToken }),
      `Reading Amazon Photos trash at offset ${offset.toLocaleString()}`,
      signal
    )
  }

  async function readAmazonTrashIds(requestId, signal) {
    let totalCount = null
    let offset = 0
    let startToken = ""
    const ids = new Set()
    const seenPageSignatures = new Set()
    const seenPageTokens = new Set()

    while (true) {
      commandHost.throwIfAborted(signal)
      const page = await fetchAmazonTrashPage(requestId, offset, startToken, signal)
      if (!page || !Array.isArray(page.data)) {
        throw new Error("Amazon Photos returned an invalid trash page.")
      }
      const pageCount = amazonPageCount(page)
      if (pageCount === null) {
        throw new Error("Amazon Photos did not provide a reliable trash count.")
      }
      if (totalCount === null) totalCount = pageCount
      else if (pageCount !== totalCount) {
        throw new Error("Amazon Photos trash count changed during verification.")
      }

      const nodes = page.data
      const nextToken = amazonPageContinuation(page)
      if (
        nodes.length > AMAZON_PAGE_LIMIT ||
        ids.size + nodes.length > totalCount
      ) {
        throw new Error("Amazon Photos returned an inconsistent trash page.")
      }
      if (nodes.length === 0) {
        if (totalCount === 0 && ids.size === 0 && !nextToken) return ids
        throw new Error(
          "Amazon Photos trash pagination ended before its reported count."
        )
      }

      const signature = JSON.stringify(nodes.map(amazonTrashNodeId))
      if (!signature || seenPageSignatures.has(signature)) {
        throw new Error("Amazon Photos repeated or malformed a trash page.")
      }
      seenPageSignatures.add(signature)

      for (const node of nodes) {
        const id = amazonTrashNodeId(node)
        if (!id || ids.has(id)) {
          throw new Error("Amazon Photos returned an invalid trash item list.")
        }
        ids.add(id)
      }

      if (ids.size === totalCount) {
        if (nextToken) {
          throw new Error("Amazon Photos trash continuation token contradicts its terminal count.")
        }
        return ids
      }

      if (nextToken) {
        if (seenPageTokens.has(nextToken)) {
          throw new Error("Amazon Photos repeated a trash pagination token.")
        }
        seenPageTokens.add(nextToken)
        startToken = nextToken
      } else {
        if (nodes.length !== AMAZON_PAGE_LIMIT) {
          throw new Error(
            "Amazon Photos trash pagination ended before its reported count."
          )
        }
        offset += AMAZON_PAGE_LIMIT
        startToken = ""
      }
    }
  }

  function setAmazonMutationOutcome(outcomes, operation, targetKey, status, reason) {
    outcomes.set(targetKey, {
      operation,
      targetKey,
      status,
      ...(reason ? { reason } : {})
    })
  }

  function publishAmazonMutationProgress(
    requestId,
    command,
    operation,
    dedupKeys,
    outcomes,
    confirmedCount,
    totalCount,
    data = {}
  ) {
    postProgress(
      requestId,
      confirmedCount,
      `Confirmed ${confirmedCount} of ${totalCount} Amazon Photos ${operation} operations`,
      command,
      {
        ...data,
        outcomes: dedupKeys
          .filter((key) => outcomes.has(key))
          .map((key) => outcomes.get(key))
      }
    )
  }

  function publishAmazonMutation(
    command,
    requestId,
    operation,
    dedupKeys,
    outcomes,
    mediaKeysToTrash,
    dispatchedKeys
  ) {
    for (const key of dedupKeys) {
      if (!outcomes.has(key)) {
        setAmazonMutationOutcome(
          outcomes,
          operation,
          key,
          "failed",
          "not-dispatched"
        )
      }
    }
    const orderedOutcomes = dedupKeys.map((key) => outcomes.get(key))
    const confirmed = orderedOutcomes
      .filter((outcome) => outcome.status === "confirmed")
      .map((outcome) => outcome.targetKey)
    const unknown = orderedOutcomes
      .filter((outcome) => outcome.status === "unknown")
      .map((outcome) => outcome.targetKey)
    const noOp = orderedOutcomes
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
            outcomes: orderedOutcomes,
            retryAttempts: 0
          }
        : {
            partial: confirmed.length > 0 && confirmed.length < dedupKeys.length,
            restoredCount: confirmed.length,
            restoredDedupKeys: confirmed,
            notDispatchedDedupKeys: dedupKeys.filter((key) => !dispatchedKeys.has(key)),
            noOpDedupKeys: noOp,
            unknownDedupKeys: unknown,
            outcomes: orderedOutcomes,
            retryAttempts: 0
          }
    if (orderedOutcomes.every((outcome) => outcome.status === "confirmed")) {
      postResult(command, requestId, data)
    } else {
      postError(
        command,
        requestId,
        new Error(
          confirmed.length
            ? `Amazon Photos confirmed ${confirmed.length} of ${dedupKeys.length} ${operation} operations; unresolved targets are not safe to retry automatically.`
            : `Amazon Photos could not confirm any ${operation} operation. Review provider state before continuing.`
        ),
        data
      )
    }
  }

  async function getVerifiedAmazonMutationOwner(args, signal) {
    if (typeof args?.providerSessionId !== "string" || !args.providerSessionId) {
      throw new Error("The Amazon Photos session is not bound to this review.")
    }
    commandHost.throwIfAborted(signal)
    const ownerId = await discoverAmazonProviderIdentity("mutation-session", signal)
    if (!ownerId) {
      throw new Error("Amazon Photos could not verify the current account owner.")
    }
    const currentSessionId = await commandHost.setProviderIdentity(ownerId)
    if (currentSessionId !== args.providerSessionId) {
      throw new Error("The Amazon Photos account changed after review.")
    }
    return ownerId
  }

  function amazonMutationErrorIsExplicitNoEffect(error) {
    const status = Number(error?.status)
    return (
      Number.isInteger(status) &&
      status >= 400 &&
      status < 500 &&
      ![408, 409, 425, 429].includes(status)
    )
  }

  async function readAmazonPersonalNode(requestId, nodeId, ownerId, signal) {
    const node = await fetchAmazonExactNode(requestId, nodeId, signal)
    if (
      firstString(node?.id, node?.nodeId, node?.objectId) !== nodeId ||
      firstString(node?.ownerId) !== ownerId ||
      node?.isShared !== false
    ) {
      return null
    }
    return node
  }

  async function trashItems(requestId, args) {
    const dedupKeys = validateStringArray(
      "trashItems",
      requestId,
      "dedupKeys",
      args?.dedupKeys
    )
    if (!dedupKeys) return
    const mediaKeysToTrash = validateStringArray(
      "trashItems",
      requestId,
      "mediaKeysToTrash",
      args?.mediaKeysToTrash
    )
    if (!mediaKeysToTrash) return
    if (mediaKeysToTrash.length !== dedupKeys.length) {
      postError(
        "trashItems",
        requestId,
        "Amazon Photos mediaKeysToTrash length must match dedupKeys length."
      )
      return
    }

    const outcomes = new Map()
    const dispatchedKeys = new Set()
    if (dedupKeys.length !== new Set(dedupKeys).size) {
      postError("trashItems", requestId, "Amazon Photos dedupKeys must not contain duplicates.")
      return
    }
    const suppliedFavoriteAcknowledgements = args?.acknowledgedUnknownFavoriteDedupKeys
    if (
      suppliedFavoriteAcknowledgements !== undefined &&
      (!Array.isArray(suppliedFavoriteAcknowledgements) ||
        suppliedFavoriteAcknowledgements.some(
          (key) => typeof key !== "string" || key.length === 0
        ) ||
        new Set(suppliedFavoriteAcknowledgements).size !==
          suppliedFavoriteAcknowledgements.length ||
        suppliedFavoriteAcknowledgements.some((key) => !dedupKeys.includes(key)))
    ) {
      for (const key of dedupKeys) {
        setAmazonMutationOutcome(
          outcomes,
          "trash",
          key,
          "failed",
          "invalid-favorite-acknowledgement"
        )
      }
      publishAmazonMutation(
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
      suppliedFavoriteAcknowledgements || []
    )
    try {
      assertLibraryRoute()
    } catch (error) {
      for (const key of dedupKeys) setAmazonMutationOutcome(outcomes, "trash", key, "failed", "wrong-provider-route")
      publishAmazonMutation("trashItems", requestId, "trash", dedupKeys, outcomes, mediaKeysToTrash, dispatchedKeys)
      return
    }
    let ownerId
    try {
      ownerId = await getVerifiedAmazonMutationOwner(args)
    } catch {
      for (const key of dedupKeys) setAmazonMutationOutcome(outcomes, "trash", key, "failed", "session-unverified-before-dispatch")
      publishAmazonMutation("trashItems", requestId, "trash", dedupKeys, outcomes, mediaKeysToTrash, dispatchedKeys)
      return
    }

    const chunks = chunkArray(dedupKeys, normalizeTrashBatchSize(args?.batchSize))
    let stopAfterChunk = false
    let confirmedCount = 0
    for (let index = 0; index < chunks.length; index += 1) {
      if (stopAfterChunk) break
      const chunk = chunks[index]
      let beforeTrash
      try {
        beforeTrash = await readAmazonTrashIds(requestId)
      } catch {
        for (const key of chunk) setAmazonMutationOutcome(outcomes, "trash", key, "failed", "preflight-trash-state-unavailable")
        publishAmazonMutationProgress(requestId, "trashItems", "trash", dedupKeys, outcomes, confirmedCount, dedupKeys.length)
        continue
      }
      try {
        if ((await getVerifiedAmazonMutationOwner(args)) !== ownerId) {
          throw new Error("Amazon owner changed before dispatch.")
        }
      } catch {
        for (const key of chunk) setAmazonMutationOutcome(outcomes, "trash", key, "failed", "session-changed-before-dispatch")
        publishAmazonMutationProgress(requestId, "trashItems", "trash", dedupKeys, outcomes, confirmedCount, dedupKeys.length)
        stopAfterChunk = true
        continue
      }

      const candidates = []
      for (const key of chunk) {
        if (beforeTrash.has(key)) {
          setAmazonMutationOutcome(outcomes, "trash", key, "failed", "already-trashed-noop")
          continue
        }
        try {
          const node = await readAmazonPersonalNode(requestId, key, ownerId)
          const favorite = amazonFavoriteValue(node)
          if (!node) {
            setAmazonMutationOutcome(outcomes, "trash", key, "failed", "favorite-or-personal-scope-unavailable")
          } else if (favorite) {
            setAmazonMutationOutcome(outcomes, "trash", key, "failed", "favorite-protected-noop")
          } else if (favorite === false || acknowledgedUnknownFavoriteSet.has(key)) {
            candidates.push(key)
          } else {
            setAmazonMutationOutcome(outcomes, "trash", key, "failed", "favorite-state-unknown-not-acknowledged")
          }
        } catch {
          setAmazonMutationOutcome(outcomes, "trash", key, "failed", "favorite-or-personal-scope-unavailable")
        }
      }
      if (candidates.length === 0) {
        publishAmazonMutationProgress(requestId, "trashItems", "trash", dedupKeys, outcomes, confirmedCount, dedupKeys.length)
        continue
      }
      try {
        if ((await getVerifiedAmazonMutationOwner(args)) !== ownerId) {
          throw new Error("Amazon owner changed before dispatch.")
        }
      } catch {
        for (const key of candidates) setAmazonMutationOutcome(outcomes, "trash", key, "failed", "session-changed-before-dispatch")
        publishAmazonMutationProgress(requestId, "trashItems", "trash", dedupKeys, outcomes, confirmedCount, dedupKeys.length)
        stopAfterChunk = true
        continue
      }

      let dispatchError
      candidates.forEach((key) => dispatchedKeys.add(key))
      try {
        // The exact-node favorite read above is a fresh safety check, not a
        // conditional mutation. This private route sends target IDs only and
        // exposes no verified favorite revision precondition.
        await patchJsonWithTimeout(
          amazonPhotosUrl("/drive/v1/trash"),
          {
            recurse: "true",
            op: "add",
            filters: "",
            conflictResolution: "RENAME",
            value: candidates,
            resourceVersion: "V2",
            ContentType: "JSON"
          },
          `Moving Amazon trash batch ${index + 1}`
        )
      } catch (error) {
        dispatchError = error
      }

      let afterTrash
      try {
        afterTrash = await readAmazonTrashIds(requestId)
      } catch {
        for (const key of candidates) setAmazonMutationOutcome(outcomes, "trash", key, "unknown", "post-dispatch-trash-state-unavailable")
        stopAfterChunk = true
        continue
      }
      try {
        if ((await getVerifiedAmazonMutationOwner(args)) !== ownerId) {
          throw new Error("Amazon owner changed after dispatch.")
        }
      } catch {
        for (const key of candidates) setAmazonMutationOutcome(outcomes, "trash", key, "unknown", "session-changed-after-dispatch")
        stopAfterChunk = true
        continue
      }

      for (const key of candidates) {
        if (!beforeTrash.has(key) && afterTrash.has(key)) {
          setAmazonMutationOutcome(outcomes, "trash", key, "confirmed")
          confirmedCount += 1
        } else if (amazonMutationErrorIsExplicitNoEffect(dispatchError)) {
          setAmazonMutationOutcome(outcomes, "trash", key, "failed", "provider-rejected-without-observed-state-change")
        } else {
          setAmazonMutationOutcome(outcomes, "trash", key, "unknown", "post-dispatch-trash-transition-unverified")
        }
      }
      const confirmedKeys = [...outcomes.values()]
        .filter((outcome) => outcome.operation === "trash" && outcome.status === "confirmed")
        .map((outcome) => outcome.targetKey)
      publishAmazonMutationProgress(
        requestId,
        "trashItems",
        "trash",
        dedupKeys,
        outcomes,
        confirmedCount,
        dedupKeys.length,
        {
          trashedKeys: mediaKeysForDedupKeys(confirmedKeys, dedupKeys, mediaKeysToTrash),
          trashedDedupKeys: confirmedKeys
        }
      )
      if (candidates.some((key) => outcomes.get(key)?.status === "unknown")) stopAfterChunk = true
    }
    publishAmazonMutation("trashItems", requestId, "trash", dedupKeys, outcomes, mediaKeysToTrash, dispatchedKeys)
  }

  async function restoreItems(requestId, args) {
    const dedupKeys = validateStringArray(
      "restoreItems",
      requestId,
      "dedupKeys",
      args?.dedupKeys
    )
    if (!dedupKeys) return

    const outcomes = new Map()
    const dispatchedKeys = new Set()
    if (dedupKeys.length !== new Set(dedupKeys).size) {
      postError("restoreItems", requestId, "Amazon Photos dedupKeys must not contain duplicates.")
      return
    }
    try {
      assertRestoreRoute()
    } catch {
      for (const key of dedupKeys) setAmazonMutationOutcome(outcomes, "restore", key, "failed", "wrong-provider-route")
      publishAmazonMutation("restoreItems", requestId, "restore", dedupKeys, outcomes, undefined, dispatchedKeys)
      return
    }
    let ownerId
    try {
      ownerId = await getVerifiedAmazonMutationOwner(args)
    } catch {
      for (const key of dedupKeys) setAmazonMutationOutcome(outcomes, "restore", key, "failed", "session-unverified-before-dispatch")
      publishAmazonMutation("restoreItems", requestId, "restore", dedupKeys, outcomes, undefined, dispatchedKeys)
      return
    }

    const chunks = chunkArray(dedupKeys, normalizeTrashBatchSize(args?.batchSize))
    let stopAfterChunk = false
    let confirmedCount = 0
    for (let index = 0; index < chunks.length; index += 1) {
      if (stopAfterChunk) break
      const chunk = chunks[index]
      let beforeTrash
      try {
        beforeTrash = await readAmazonTrashIds(requestId)
      } catch {
        for (const key of chunk) setAmazonMutationOutcome(outcomes, "restore", key, "failed", "preflight-trash-state-unavailable")
        publishAmazonMutationProgress(requestId, "restoreItems", "restore", dedupKeys, outcomes, confirmedCount, dedupKeys.length)
        continue
      }
      try {
        if ((await getVerifiedAmazonMutationOwner(args)) !== ownerId) throw new Error("Amazon owner changed before dispatch.")
      } catch {
        for (const key of chunk) setAmazonMutationOutcome(outcomes, "restore", key, "failed", "session-changed-before-dispatch")
        publishAmazonMutationProgress(requestId, "restoreItems", "restore", dedupKeys, outcomes, confirmedCount, dedupKeys.length)
        stopAfterChunk = true
        continue
      }
      const candidates = []
      for (const key of chunk) {
        if (beforeTrash.has(key)) {
          candidates.push(key)
          continue
        }
        try {
          const node = await readAmazonPersonalNode(requestId, key, ownerId)
          setAmazonMutationOutcome(
            outcomes,
            "restore",
            key,
            "failed",
            node ? "already-restored-noop" : "not-in-trash-noop"
          )
        } catch {
          setAmazonMutationOutcome(outcomes, "restore", key, "failed", "preflight-item-state-unavailable")
        }
      }
      if (candidates.length === 0) {
        publishAmazonMutationProgress(requestId, "restoreItems", "restore", dedupKeys, outcomes, confirmedCount, dedupKeys.length)
        continue
      }
      try {
        if ((await getVerifiedAmazonMutationOwner(args)) !== ownerId) throw new Error("Amazon owner changed before dispatch.")
      } catch {
        for (const key of candidates) setAmazonMutationOutcome(outcomes, "restore", key, "failed", "session-changed-before-dispatch")
        publishAmazonMutationProgress(requestId, "restoreItems", "restore", dedupKeys, outcomes, confirmedCount, dedupKeys.length)
        stopAfterChunk = true
        continue
      }

      let dispatchError
      candidates.forEach((key) => dispatchedKeys.add(key))
      try {
        await patchJsonWithTimeout(
          amazonPhotosUrl("/drive/v1/trash"),
          {
            op: "remove",
            conflictResolution: "RENAME",
            value: candidates
          },
          `Restoring Amazon batch ${index + 1}`
        )
      } catch (error) {
        dispatchError = error
      }
      let afterTrash
      try {
        afterTrash = await readAmazonTrashIds(requestId)
      } catch {
        for (const key of candidates) setAmazonMutationOutcome(outcomes, "restore", key, "unknown", "post-dispatch-trash-state-unavailable")
        stopAfterChunk = true
        continue
      }
      try {
        if ((await getVerifiedAmazonMutationOwner(args)) !== ownerId) throw new Error("Amazon owner changed after dispatch.")
      } catch {
        for (const key of candidates) setAmazonMutationOutcome(outcomes, "restore", key, "unknown", "session-changed-after-dispatch")
        stopAfterChunk = true
        continue
      }

      const libraryState = new Map()
      for (const key of candidates) {
        if (afterTrash.has(key)) continue
        try {
          libraryState.set(
            key,
            Boolean(await readAmazonPersonalNode(requestId, key, ownerId))
          )
        } catch {
          libraryState.set(key, null)
        }
      }
      try {
        if ((await getVerifiedAmazonMutationOwner(args)) !== ownerId) {
          throw new Error("Amazon owner changed after readback.")
        }
      } catch {
        for (const key of candidates) {
          setAmazonMutationOutcome(outcomes, "restore", key, "unknown", "session-changed-after-dispatch")
        }
        stopAfterChunk = true
        continue
      }
      for (const key of candidates) {
        if (afterTrash.has(key)) {
          if (amazonMutationErrorIsExplicitNoEffect(dispatchError)) {
            setAmazonMutationOutcome(outcomes, "restore", key, "failed", "provider-rejected-without-observed-state-change")
          } else {
            setAmazonMutationOutcome(outcomes, "restore", key, "unknown", "post-dispatch-trash-transition-unverified")
          }
        } else if (libraryState.get(key) === true) {
          setAmazonMutationOutcome(outcomes, "restore", key, "confirmed")
          confirmedCount += 1
        } else if (libraryState.get(key) === false) {
          setAmazonMutationOutcome(outcomes, "restore", key, "unknown", "post-dispatch-library-state-unverified")
        } else {
          setAmazonMutationOutcome(outcomes, "restore", key, "unknown", "post-dispatch-library-state-unavailable")
        }
      }
      const restoredDedupKeys = [...outcomes.values()]
        .filter((outcome) => outcome.operation === "restore" && outcome.status === "confirmed")
        .map((outcome) => outcome.targetKey)
      publishAmazonMutationProgress(
        requestId,
        "restoreItems",
        "restore",
        dedupKeys,
        outcomes,
        confirmedCount,
        dedupKeys.length,
        { restoredDedupKeys }
      )
      if (candidates.some((key) => outcomes.get(key)?.status === "unknown")) stopAfterChunk = true
    }
    publishAmazonMutation("restoreItems", requestId, "restore", dedupKeys, outcomes, undefined, dispatchedKeys)
  }

  async function healthCheck(requestId) {
    const onAmazonPhotos = isAmazonPhotosLocation()
    const pageText = document.body?.innerText || ""
    const hasSignInPrompt =
      /sign in/i.test(pageText) ||
      /email or mobile phone number/i.test(pageText)
    const isNotFoundPage =
      /page not found|not a functioning page|looking for something/i.test(
        `${document.title} ${pageText}`
      )
    const pageIsUsable = onAmazonPhotos && !hasSignInPrompt && !isNotFoundPage
    let ownerIdentity = ""
    if (pageIsUsable) {
      try {
        ownerIdentity = await discoverAmazonProviderIdentity(requestId)
      } catch {
        ownerIdentity = ""
      }
      if (ownerIdentity) await commandHost.setProviderIdentity(ownerIdentity)
    }
    const accountDisplayName =
      pageIsUsable && ownerIdentity ? discoverAmazonProfileDisplayName() : ""
    postResult("healthCheck", requestId, {
      hasGptk: pageIsUsable && Boolean(ownerIdentity),
      accountEmail: "",
      ...(accountDisplayName ? { accountDisplayName } : {}),
      health: createProviderHealth("amazon", {
        page: pageIsUsable,
        session: Boolean(ownerIdentity || commandHost.providerSessionId),
        readPath: Boolean(ownerIdentity)
      })
    })
  }

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
    unsupportedMessage: (command) =>
      `Unsupported Amazon Photos command: ${command}`
  })

  console.log("GPD: Amazon Photos command handler loaded")
})()
