// Shared MAIN-world command protocol for PhotoSweep provider adapters.
// Provider scripts keep their media behavior; this host owns the envelope and
// dispatch contract they all satisfy.

{
function isLocalTestEnvironment(targetWindow) {
  const protocol =
    typeof targetWindow.location === "object" && targetWindow.location
      ? targetWindow.location.protocol
      : undefined
  const hostname =
    typeof targetWindow.location === "object" && targetWindow.location
      ? targetWindow.location.hostname
      : undefined
  return (
    typeof process !== "undefined" &&
    process.env &&
    process.env.NODE_ENV === "test" &&
    (protocol === undefined ||
      protocol === "about:" ||
      hostname === "localhost")
  )
}

function providerSessionIdentityMap() {
  const key = Symbol.for("photosweep.providerSessionIds")
  const existing = globalThis[key]
  if (existing instanceof WeakMap) return existing

  const sessionIds = new WeakMap()
  try {
    Object.defineProperty(globalThis, key, { value: sessionIds })
  } catch {
    // Keep this host usable if the page has made the global non-extensible.
  }
  return sessionIds
}

function createCommandHost(targetWindow, publicKey) {
  if (targetWindow.__GPD_COMMAND_HOST__) {
    return targetWindow.__GPD_COMMAND_HOST__
  }

  const providerSessionIds = providerSessionIdentityMap()
  const APP_ID = "GPD"
  const CAPABILITY_TTL_MS = 60 * 1000
  const PROVIDER_HEALTH_SCHEMA_VERSION = 1
  const PROVIDER_HEALTH_CONTRACT_VERSION = "provider-parity-v1"
  const PROVIDER_SESSION_KEY = "__GPD_PROVIDER_SESSION_ID__"
  const PROVIDER_IDENTITY_FINGERPRINT_KEY =
    "__GPD_PROVIDER_IDENTITY_FINGERPRINT__"
  let providerSessionRestored = false
  function providerSessionWindow() {
    let sessionWindow = targetWindow
    try {
      if (
        targetWindow.top &&
        targetWindow.top.location.origin === targetWindow.location.origin
      ) {
        sessionWindow = targetWindow.top
      }
    } catch {
      // A cross-origin frame cannot read its top window; keep a frame-local
      // identity so a result from that frame cannot inherit another frame's
      // authorization accidentally.
    }
    return sessionWindow
  }

  function generateProviderSessionId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("")
  }

  function persistProviderSessionId(sessionWindow, providerSessionId) {
    try {
      sessionWindow.sessionStorage?.setItem(
        PROVIDER_SESSION_KEY,
        providerSessionId
      )
    } catch {
      // A storage-restricted page still uses the in-memory marker above.
    }
  }

  function readProviderIdentityFingerprint() {
    try {
      const value = providerSessionWindow().sessionStorage?.getItem(
        PROVIDER_IDENTITY_FINGERPRINT_KEY
      )
      return typeof value === "string" && value ? value : ""
    } catch {
      return ""
    }
  }

  function persistProviderIdentityFingerprint(fingerprint) {
    const sessionWindow = providerSessionWindow()
    try {
      if (fingerprint) {
        sessionWindow.sessionStorage?.setItem(
          PROVIDER_IDENTITY_FINGERPRINT_KEY,
          fingerprint
        )
      } else {
        sessionWindow.sessionStorage?.removeItem(
          PROVIDER_IDENTITY_FINGERPRINT_KEY
        )
      }
    } catch {
      // Keep the identity marker in memory when storage is unavailable.
    }
  }

  async function fingerprintProviderIdentity(identity) {
    try {
      const encoded = new TextEncoder().encode(identity)
      const digest = await crypto.subtle.digest("SHA-256", encoded)
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    } catch {
      return ""
    }
  }

  function getProviderSessionId() {
    const sessionWindow = providerSessionWindow()
    const inMemorySessionId = providerSessionIds.get(sessionWindow)
    if (typeof inMemorySessionId === "string") {
      providerSessionRestored = true
      return inMemorySessionId
    }
    // Amazon Photos can replace its document while a same-tab API request is
    // in flight. Keep the opaque identity in sessionStorage so a reload or
    // SPA route transition does not invalidate an already reviewed operation.
    // The private per-window map stays current when a session rotates; the
    // page marker below is only a read-only view of that value.
    let storedSessionId
    try {
      storedSessionId = sessionWindow.sessionStorage?.getItem(
        PROVIDER_SESSION_KEY
      )
    } catch {
      storedSessionId = undefined
    }
    if (typeof storedSessionId === "string" && storedSessionId.length > 0) {
      providerSessionRestored = true
      providerSessionIds.set(sessionWindow, storedSessionId)
      try {
        Object.defineProperty(sessionWindow, PROVIDER_SESSION_KEY, {
          get: () => providerSessionIds.get(sessionWindow),
          configurable: false,
          enumerable: false
        })
      } catch {
        // The persisted value remains the source of truth for this host.
      }
      return storedSessionId
    }
    const providerSessionId = generateProviderSessionId()
    providerSessionIds.set(sessionWindow, providerSessionId)
    try {
      Object.defineProperty(sessionWindow, PROVIDER_SESSION_KEY, {
        get: () => providerSessionIds.get(sessionWindow),
        configurable: false,
        enumerable: false
      })
    } catch {
      // The private map still binds this host instance if the page prevents
      // attaching a shared same-origin session marker.
    }
    persistProviderSessionId(sessionWindow, providerSessionId)
    return providerSessionId
  }
  let providerSessionId = getProviderSessionId()
  let providerIdentity
  let activeScanScopeFingerprint = null

  const ORIGINAL_MEDIA_RESOURCE_CACHE_MAX = 10_000
  const ORIGINAL_MEDIA_RESOURCE_MAX_AGE_MS = 15 * 60 * 1000
  const ORIGINAL_MEDIA_MAX_BYTES_PER_ITEM = 25 * 1024 * 1024
  const ORIGINAL_MEDIA_MAX_BYTES_PER_REVIEW = 100 * 1024 * 1024
  const originalMediaRetrieval = (() => {
    const resources = new Map()
    const budgets = new Map()
    const reservationStates = new WeakMap()
    const budgetViews = new WeakMap()

    function readOnlyBudgetView(budget) {
      let view = budgetViews.get(budget)
      if (!view) {
        view = Object.freeze(
          Object.defineProperties({}, {
            limitBytes: {
              enumerable: true,
              get: () => budget.limitBytes
            },
            bytesRead: {
              enumerable: true,
              get: () => budget.bytesRead
            },
            bytesReserved: {
              enumerable: true,
              get: () => budget.bytesReserved
            }
          })
        )
        budgetViews.set(budget, view)
      }
      return view
    }

    function createReservation(key, budget, reservedBytes) {
      const state = {
        key,
        budget,
        maxBytes: reservedBytes,
        reservedBytes,
        bytesConsumed: 0
      }
      const reservation = Object.freeze(
        Object.defineProperties({}, {
          key: {
            enumerable: true,
            get: () => state.key
          },
          budget: {
            enumerable: true,
            get: () => readOnlyBudgetView(state.budget)
          },
          maxBytes: {
            enumerable: true,
            get: () => state.maxBytes
          },
          reservedBytes: {
            enumerable: true,
            get: () => state.reservedBytes
          },
          bytesConsumed: {
            enumerable: true,
            get: () => state.bytesConsumed
          }
        })
      )
      reservationStates.set(reservation, state)
      return reservation
    }

    function resourceKey(provider, sessionId, scopeFingerprint, mediaKey) {
      return JSON.stringify([provider, sessionId, scopeFingerprint, mediaKey])
    }

    function budgetKey(provider, sessionId, scopeFingerprint) {
      return JSON.stringify([provider, sessionId, scopeFingerprint])
    }

    function policyError(provider, code) {
      const labels = {
        amazon: "Amazon Photos",
        google: "Google Photos",
        icloud: "iCloud"
      }
      const label = labels[provider] || "Photo Provider"
      const messages = {
        "invalid-item-limit": `The ${label} original byte limit must be between 1 byte and 25 MiB.`,
        "invalid-review-limit": `The ${label} review byte budget must be between 1 byte and 100 MiB.`,
        "scope-capacity": `Too many ${label} review scopes are active in this page session.`,
        "review-limit-changed":
          provider === "amazon"
            ? "The Amazon Photos review byte budget cannot change after hashing begins."
            : `The ${label} review byte budget changed. Start a new review before retrieving originals.`,
        "empty-original": "Google Photos did not report a nonempty original file size.",
        "review-budget-exhausted": `The ${label} review has reached its 100 MiB original-fetch budget.`,
        "original-exceeds-budget":
          provider === "google"
            ? "The Google Photos original exceeds the remaining approved byte budget."
            : `The ${label} original exceeds the remaining review byte budget.`,
        "stale-scope": "Original media retrieval must match the current provider session and scan scope."
      }
      const error = new Error(messages[code] || messages["stale-scope"])
      error.code = code
      return error
    }

    function hasCurrentScope(sessionId, scopeFingerprint) {
      return (
        sessionId === providerSessionId &&
        scopeFingerprint === activeScanScopeFingerprint
      )
    }

    function rememberResource(
      provider,
      sessionId,
      scopeFingerprint,
      mediaKey,
      resource
    ) {
      if (
        !hasCurrentScope(sessionId, scopeFingerprint) ||
        typeof mediaKey !== "string" ||
        !mediaKey ||
        !resource ||
        typeof resource !== "object"
      ) {
        return false
      }
      const key = resourceKey(provider, sessionId, scopeFingerprint, mediaKey)
      if (resources.has(key)) resources.delete(key)
      resources.set(key, { provider, resource, storedAt: Date.now() })
      // One call can increase the cache by at most one entry, so one eviction suffices.
      if (resources.size > ORIGINAL_MEDIA_RESOURCE_CACHE_MAX) {
        resources.delete(resources.keys().next().value)
      }
      return true
    }

    function getResource(
      provider,
      sessionId,
      scopeFingerprint,
      mediaKey,
      refresh = true
    ) {
      if (
        !hasCurrentScope(sessionId, scopeFingerprint) ||
        typeof mediaKey !== "string" ||
        !mediaKey
      ) {
        return undefined
      }
      const key = resourceKey(provider, sessionId, scopeFingerprint, mediaKey)
      const entry = resources.get(key)
      if (!entry) return undefined
      if (Date.now() - entry.storedAt > ORIGINAL_MEDIA_RESOURCE_MAX_AGE_MS) {
        resources.delete(key)
        return undefined
      }
      if (refresh) {
        resources.delete(key)
        resources.set(key, entry)
      }
      return entry.resource
    }

    function isCurrentResource(
      provider,
      sessionId,
      scopeFingerprint,
      mediaKey,
      resource
    ) {
      if (!hasCurrentScope(sessionId, scopeFingerprint)) return false
      const entry = resources.get(
        resourceKey(provider, sessionId, scopeFingerprint, mediaKey)
      )
      return entry?.resource === resource
    }

    function clearResources(provider) {
      if (!provider) {
        resources.clear()
        return
      }
      for (const [key, entry] of resources) {
        if (entry.provider === provider) resources.delete(key)
      }
    }

    function reserveBudget({
      provider,
      sessionId,
      scopeFingerprint,
      maxBytes,
      aggregateBudgetBytes,
      resourceSize,
      maxBudgetScopes,
      reserveKnownResourceSize = false
    }) {
      if (!hasCurrentScope(sessionId, scopeFingerprint)) {
        throw policyError(provider, "stale-scope")
      }
      if (
        !Number.isSafeInteger(maxBytes) ||
        maxBytes < 1 ||
        maxBytes > ORIGINAL_MEDIA_MAX_BYTES_PER_ITEM
      ) {
        throw policyError(provider, "invalid-item-limit")
      }
      if (
        !Number.isSafeInteger(aggregateBudgetBytes) ||
        aggregateBudgetBytes < 1 ||
        aggregateBudgetBytes > ORIGINAL_MEDIA_MAX_BYTES_PER_REVIEW
      ) {
        throw policyError(provider, "invalid-review-limit")
      }

      const key = budgetKey(provider, sessionId, scopeFingerprint)
      let budget = budgets.get(key)
      if (!budget) {
        if (budgets.size >= maxBudgetScopes) {
          throw policyError(provider, "scope-capacity")
        }
        budget = {
          limitBytes: aggregateBudgetBytes,
          bytesRead: 0,
          bytesReserved: 0
        }
        budgets.set(key, budget)
      } else if (budget.limitBytes !== aggregateBudgetBytes) {
        throw policyError(provider, "review-limit-changed")
      }

      if (provider === "google" && resourceSize === 0) {
        throw policyError(provider, "empty-original")
      }
      const availableBytes =
        budget.limitBytes - budget.bytesRead - budget.bytesReserved
      const reserveLimit = Math.min(maxBytes, availableBytes)
      if (reserveLimit < 1) {
        throw policyError(provider, "review-budget-exhausted")
      }
      if (Number.isFinite(resourceSize) && resourceSize > reserveLimit) {
        throw policyError(provider, "original-exceeds-budget")
      }
      const reservedBytes =
        reserveKnownResourceSize && Number.isSafeInteger(resourceSize)
          ? resourceSize
          : reserveLimit
      if (reservedBytes < 1) {
        throw policyError(provider, "review-budget-exhausted")
      }
      budget.bytesReserved += reservedBytes
      return createReservation(key, budget, reservedBytes)
    }

    function consumeChunk(reservation, byteLength) {
      const state =
        reservation && typeof reservation === "object"
          ? reservationStates.get(reservation)
          : undefined
      if (!state || !Number.isSafeInteger(byteLength) || byteLength < 0) {
        return false
      }
      const budget = budgets.get(state.key)
      if (budget !== state.budget) return false
      const withinReservation =
        byteLength <= state.reservedBytes &&
        state.bytesConsumed + byteLength <= state.maxBytes
      const reservedCharge = Math.min(byteLength, state.reservedBytes)
      budget.bytesRead += byteLength
      budget.bytesReserved = Math.max(
        0,
        budget.bytesReserved - reservedCharge
      )
      state.reservedBytes -= reservedCharge
      state.bytesConsumed += byteLength
      if (!withinReservation) {
        budget.bytesReserved = Math.max(
          0,
          budget.bytesReserved - state.reservedBytes
        )
        state.reservedBytes = 0
      }
      return withinReservation
    }

    function accountResult(reservation, byteLength) {
      const state =
        reservation && typeof reservation === "object"
          ? reservationStates.get(reservation)
          : undefined
      if (!state) return
      const budget = budgets.get(state.key)
      if (budget !== state.budget) return
      const chargedBytes =
        Number.isSafeInteger(byteLength) &&
        byteLength > 0 &&
        byteLength <= state.reservedBytes
          ? byteLength
          : state.reservedBytes
      budget.bytesRead += chargedBytes
      budget.bytesReserved = Math.max(
        0,
        budget.bytesReserved - state.reservedBytes
      )
      state.bytesConsumed += chargedBytes
      state.reservedBytes = 0
    }

    function releaseBudget(reservation) {
      const state =
        reservation && typeof reservation === "object"
          ? reservationStates.get(reservation)
          : undefined
      if (!state) return
      const budget = budgets.get(state.key)
      if (budget !== state.budget) return
      budget.bytesReserved = Math.max(
        0,
        budget.bytesReserved - state.reservedBytes
      )
      state.reservedBytes = 0
    }

    return Object.freeze({
      rememberResource,
      getResource,
      isCurrentResource,
      clearResources,
      reserveBudget,
      consumeChunk,
      accountResult,
      releaseBudget,
      reset() {
        resources.clear()
        budgets.clear()
      }
    })
  })()

  function rotateProviderSession() {
    for (const operation of activeProviderRequests.values()) {
      operation.controller.abort()
    }
    activeScanScopeFingerprint = null
    originalMediaRetrieval.reset()
    providerSessionId = generateProviderSessionId()
    const sessionWindow = providerSessionWindow()
    providerSessionIds.set(sessionWindow, providerSessionId)
    persistProviderSessionId(sessionWindow, providerSessionId)
    providerSessionRestored = false
    return providerSessionId
  }

  // Provider adapters can supply a stable account or owner marker when the
  // provider exposes one. Only a fingerprint is persisted beside the opaque
  // session ID, allowing the host to distinguish same-account reloads from
  // account switches without persisting the provider's raw marker.
  let providerIdentityUpdate = Promise.resolve()
  function setProviderIdentity(identity) {
    const normalized = typeof identity === "string" ? identity.trim() : ""
    if (!normalized) return Promise.resolve(providerSessionId)

    const update = providerIdentityUpdate.then(async () => {
      const fingerprint = await fingerprintProviderIdentity(normalized)
      if (providerIdentity === undefined) {
        const previousFingerprint = readProviderIdentityFingerprint()
        if (
          providerSessionRestored &&
          (!fingerprint || fingerprint !== previousFingerprint)
        ) {
          rotateProviderSession()
        }
        providerIdentity = normalized
        providerSessionRestored = false
        persistProviderIdentityFingerprint(fingerprint)
        return providerSessionId
      }

      if (providerIdentity === normalized) {
        providerSessionRestored = false
        persistProviderIdentityFingerprint(fingerprint)
        return providerSessionId
      }

      providerIdentity = normalized
      rotateProviderSession()
      persistProviderIdentityFingerprint(fingerprint)
      return providerSessionId
    })
    providerIdentityUpdate = update.then(
      () => undefined,
      () => undefined
    )
    return update
  }

  // When a provider cannot expose a stable account marker, a restored tab
  // session cannot prove that the provider account stayed the same. Give the
  // current document a new session so results from before a reload fail closed.
  function requireCurrentDocumentSession() {
    if (providerSessionRestored) {
      rotateProviderSession()
      providerIdentity = undefined
      persistProviderIdentityFingerprint("")
    }
    return providerSessionId
  }
  // Capture the local test allowance when the host is created. Production
  // provider pages are never local test origins, so later page navigation
  // cannot turn an authenticated host into an unsigned one.
  const allowUnsignedTestCommands =
    isLocalTestEnvironment(targetWindow) &&
    targetWindow.__GPD_COMMAND_HOST_TEST_AUTH__ !== true
  const usedNonces = new Set()
  const pendingNonces = new Set()
  const activeScans = new Map()
  const pendingScanCancellations = new Map()
  const activeProviderRequests = new Map()
  const pendingProviderCancellations = new Map()
  let verificationKeyPromise

  function canonicalJson(value) {
    if (value === null) return "null"
    if (typeof value === "string") return JSON.stringify(value)
    if (typeof value === "boolean") return value ? "true" : "false"
    if (typeof value === "number") {
      return Number.isFinite(value) ? JSON.stringify(value) : "null"
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
    if (typeof value === "object") {
      const record = value
      return `{${Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(",")}}`
    }
    return "null"
  }

  function base64UrlDecode(value) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  }

  function capabilityPayload(message, issuedAt, nonce) {
    return canonicalJson({
      app: message.app,
      action: message.action,
      command: message.command,
      requestId: message.requestId,
      provider: message.provider || "google",
      args: message.args === undefined ? null : message.args,
      issuedAt,
      nonce
    })
  }

  function loadVerificationKey() {
    verificationKeyPromise ||= crypto.subtle.importKey(
      "jwk",
      publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    )
    return verificationKeyPromise
  }

  async function hasValidCapability(message) {
    // Vitest's side-effect command tests exercise provider adapters without a
    // browser service worker. Restrict the test-only bypass to the happy-dom
    // fixture context; a provider page must never be able to spoof a Node
    // process object and disable capability checks.
    if (allowUnsignedTestCommands) return true
    const capability = message.capability
    if (
      !capability ||
      typeof capability.payload !== "string" ||
      typeof capability.signature !== "string"
    ) {
      return false
    }
    let parsed
    try {
      parsed = JSON.parse(capability.payload)
    } catch {
      return false
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.app !== APP_ID ||
      parsed.action !== "gptkCommand" ||
      parsed.command !== message.command ||
      parsed.requestId !== message.requestId ||
      parsed.provider !== (message.provider || "google") ||
      !Number.isFinite(parsed.issuedAt) ||
      typeof parsed.nonce !== "string" ||
      parsed.nonce.length < 16 ||
      capability.payload !==
        capabilityPayload(message, parsed.issuedAt, parsed.nonce) ||
      Math.abs(Date.now() - parsed.issuedAt) > CAPABILITY_TTL_MS ||
      usedNonces.has(parsed.nonce) ||
      pendingNonces.has(parsed.nonce)
    ) {
      return false
    }
    pendingNonces.add(parsed.nonce)
    try {
      const valid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        await loadVerificationKey(),
        base64UrlDecode(capability.signature),
        new TextEncoder().encode(capability.payload)
      )
      if (!valid) return false
      usedNonces.add(parsed.nonce)
      if (usedNonces.size > 512) {
        const first = usedNonces.values().next().value
        if (first) usedNonces.delete(first)
      }
      return true
    } catch {
      return false
    } finally {
      pendingNonces.delete(parsed.nonce)
    }
  }

  function postResult(command, requestId, data, scanCoverage, providerSyncToken) {
    targetWindow.postMessage(
      {
        app: APP_ID,
        action: "gptkResult",
        command,
        requestId,
        success: true,
        data,
        providerSessionId,
        ...(scanCoverage !== undefined ? { scanCoverage } : {}),
        ...(providerSyncToken !== undefined ? { providerSyncToken } : {})
      },
      "*"
    )
  }

  function postError(command, requestId, error, data, scanCoverage, errorCode) {
    targetWindow.postMessage(
      {
        app: APP_ID,
        action: "gptkResult",
        command,
        requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        providerSessionId,
        ...(errorCode !== undefined ? { errorCode } : {}),
        ...(data !== undefined ? { data } : {}),
        ...(scanCoverage !== undefined ? { scanCoverage } : {})
      },
      "*"
    )
  }

  function classifyProviderFailure(error) {
    const message = error instanceof Error ? error.message : String(error)
    return error?.status === 401 ||
      error?.status === 403 ||
      /unauthori[sz]ed|forbidden|sign.?in|session|\b401\b|\b403\b/i.test(
        message
      )
      ? "auth_expired"
      : "provider_error"
  }

  /**
   * Keep provider readiness evidence bounded and versioned. The adapter may
   * report only booleans here; account markers, cookies, media IDs, and raw
   * provider responses must never cross this boundary.
   */
  function createProviderHealth(provider, checks) {
    const normalizedProvider =
      provider === "icloud" || provider === "amazon" ? provider : "google"
    const normalizedChecks = {
      page: checks?.page === true,
      session: checks?.session === true,
      readPath: checks?.readPath === true
    }
    const ready =
      normalizedChecks.page &&
      normalizedChecks.session &&
      normalizedChecks.readPath
    return {
      schemaVersion: PROVIDER_HEALTH_SCHEMA_VERSION,
      contractVersion: PROVIDER_HEALTH_CONTRACT_VERSION,
      provider: normalizedProvider,
      status: ready ? "ready" : "unavailable",
      checks: normalizedChecks
    }
  }

  function createAbortError() {
    return new DOMException("The operation was aborted.", "AbortError")
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw createAbortError()
  }

  function withAbort(promise, signal) {
    if (!signal) return Promise.resolve(promise)
    if (signal.aborted) return Promise.reject(createAbortError())

    return new Promise((resolve, reject) => {
      const cleanup = () => signal.removeEventListener("abort", onAbort)
      const onAbort = () => {
        cleanup()
        reject(createAbortError())
      }
      signal.addEventListener("abort", onAbort, { once: true })
      Promise.resolve(promise).then(
        (value) => {
          cleanup()
          resolve(value)
        },
        (error) => {
          cleanup()
          reject(error)
        }
      )
    })
  }

  function delay(ms, signal) {
    throwIfAborted(signal)
    if (!ms || ms <= 0) return Promise.resolve()

    return new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener("abort", onAbort)
      const timer = setTimeout(() => {
        cleanup()
        resolve()
      }, ms)
      const onAbort = () => {
        clearTimeout(timer)
        cleanup()
        reject(createAbortError())
      }
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  function localDateBoundary(value, endOfDay) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return Number.NaN
    }
    const [year, month, day] = value.split("-").map(Number)
    const date = new Date(0)
    date.setFullYear(year, month - 1, day)
    date.setHours(
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0
    )
    if (
      date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return Number.NaN
    }
    return date.getTime()
  }

  function dateRangeBounds(dateRange) {
    if (!dateRange || (!dateRange.from && !dateRange.to)) return null
    const fromMs = dateRange.from
      ? localDateBoundary(dateRange.from, false)
      : Number.NEGATIVE_INFINITY
    const toMs = dateRange.to
      ? localDateBoundary(dateRange.to, true)
      : Number.POSITIVE_INFINITY
    return { fromMs, toMs, valid: fromMs <= toMs }
  }

  function isTimestampInDateRange(timestamp, bounds) {
    if (!bounds) return true
    return (
      bounds.valid === true &&
      Number.isFinite(timestamp) &&
      timestamp >= bounds.fromMs &&
      timestamp <= bounds.toMs
    )
  }

  function postProgress(requestId, itemsProcessed, message, command, data) {
    targetWindow.postMessage(
      {
        app: APP_ID,
        action: "gptkProgress",
        requestId,
        itemsProcessed,
        message,
        ...(command !== undefined ? { command } : {}),
        ...(data !== undefined ? { data } : {})
      },
      "*"
    )
  }

  function register({ handlers, unsupportedMessage }) {
    const handlerMap =
      handlers && typeof handlers === "object" ? handlers : Object.create(null)
    const unsupported =
      typeof unsupportedMessage === "function"
        ? unsupportedMessage
        : (command) => `Unsupported command: ${command}`

    targetWindow.addEventListener("message", async (event) => {
      if (event.source !== targetWindow) return
      const message = event.data
      if (
        !message ||
        typeof message !== "object" ||
        Array.isArray(message) ||
        message.app !== APP_ID ||
        message.action !== "gptkCommand"
      ) {
        return
      }

      const { command, requestId, args } = message
      if (
        typeof command !== "string" ||
        command.length === 0 ||
        typeof requestId !== "string" ||
        requestId.length === 0
      ) {
        return
      }

      if (!(await hasValidCapability(message))) return

      const messageProvider = message.provider || "google"
      const isProviderRetrieval =
        command === "getOriginalContentHash" ||
        command === "getVideoPlaybackUrl"
      if (
        isProviderRetrieval &&
        (args?.providerSessionId !== providerSessionId ||
          args?.requestId !== requestId ||
          typeof args?.scanScopeFingerprint !== "string" ||
          args.scanScopeFingerprint.length === 0 ||
          args?.userOptIn !== true)
      ) {
        postError(
          command,
          requestId,
          "Original media retrieval requires explicit opt-in and a current provider session, request, and scan scope."
        )
        return
      }

      if (
        isProviderRetrieval &&
        args.scanScopeFingerprint !== activeScanScopeFingerprint
      ) {
        postError(
          command,
          requestId,
          "Original media retrieval must match the most recent scan scope in this provider page session. Scan again and review the current items."
        )
        return
      }

      if (
        messageProvider !== "google" &&
        (command === "listAlbums" ||
          command === "getAllMediaItems" ||
          command === "trashItems" ||
          command === "restoreItems") &&
        args?.providerSessionId !== providerSessionId
      ) {
        postError(
          command,
          requestId,
          "The photo-provider page session changed. Reconnect, scan again, and review the current items before continuing."
        )
        return
      }

      if (command === "getAllMediaItems") {
        const scopeFingerprint = args?.scanScopeFingerprint
        if (
          typeof scopeFingerprint !== "string" ||
          scopeFingerprint.length === 0 ||
          scopeFingerprint.length > 512 ||
          scopeFingerprint.trim() !== scopeFingerprint ||
          /[\u0000-\u001f\u007f]/.test(scopeFingerprint)
        ) {
          postError(
            command,
            requestId,
            "The scan scope is missing or invalid. Restart the scan from PhotoSweep."
          )
          return
        }
        activeScanScopeFingerprint = scopeFingerprint
        for (const operation of activeProviderRequests.values()) {
          if (operation.scanScopeFingerprint !== scopeFingerprint) {
            operation.controller.abort()
          }
        }
      }

      if (command === "cancelScan") {
        const targetRequestId = args?.targetRequestId
        const controller =
          typeof targetRequestId === "string"
            ? activeScans.get(targetRequestId)
            : undefined
        let cancelled = false
        if (typeof targetRequestId === "string") {
          const pendingTimer = pendingScanCancellations.get(targetRequestId)
          if (pendingTimer !== undefined) clearTimeout(pendingTimer)
          if (controller) {
            cancelled = !controller.signal.aborted
            controller.abort()
          } else {
            const timer = setTimeout(
              () => pendingScanCancellations.delete(targetRequestId),
              CAPABILITY_TTL_MS
            )
            pendingScanCancellations.set(targetRequestId, timer)
            cancelled = true
          }
        }
        postResult("cancelScan", requestId, { targetRequestId, cancelled })
        return
      }

      if (command === "cancelProviderRequest") {
        const targetRequestId = args?.targetRequestId
        const requestSessionId = args?.providerSessionId
        const scopeFingerprint = args?.scanScopeFingerprint
        if (
          requestSessionId !== providerSessionId ||
          typeof targetRequestId !== "string" ||
          targetRequestId.length === 0 ||
          typeof scopeFingerprint !== "string" ||
          scopeFingerprint.length === 0
        ) {
          postError(
            command,
            requestId,
            "The media retrieval request session or scan scope changed before cancellation."
          )
          return
        }
        const active = activeProviderRequests.get(targetRequestId)
        let cancelled = false
        if (
          active &&
          active.provider === messageProvider &&
          active.providerSessionId === requestSessionId &&
          active.scanScopeFingerprint === scopeFingerprint
        ) {
          cancelled = !active.controller.signal.aborted
          active.controller.abort()
        } else if (!active) {
          const previous = pendingProviderCancellations.get(targetRequestId)
          if (previous?.timer !== undefined) clearTimeout(previous.timer)
          const cancellation = {
            provider: messageProvider,
            providerSessionId: requestSessionId,
            scanScopeFingerprint: scopeFingerprint,
            timer: undefined
          }
          cancellation.timer = setTimeout(
            () => pendingProviderCancellations.delete(targetRequestId),
            CAPABILITY_TTL_MS
          )
          pendingProviderCancellations.set(targetRequestId, cancellation)
          cancelled = true
        }
        postResult("cancelProviderRequest", requestId, {
          targetRequestId,
          cancelled
        })
        return
      }

      const handler =
        Object.prototype.hasOwnProperty.call(handlerMap, command) &&
        typeof handlerMap[command] === "function"
          ? handlerMap[command]
          : null
      if (!handler) {
        postError(command, requestId, unsupported(command))
        return
      }
      const scanController =
        command === "getAllMediaItems" ? new AbortController() : undefined
      if (scanController) {
        const pendingTimer = pendingScanCancellations.get(requestId)
        if (pendingTimer !== undefined) {
          clearTimeout(pendingTimer)
          pendingScanCancellations.delete(requestId)
          scanController.abort()
        }
        activeScans.set(requestId, scanController)
      }
      const providerRequestController = isProviderRetrieval
        ? new AbortController()
        : undefined
      if (providerRequestController) {
        const pending = pendingProviderCancellations.get(requestId)
        if (pending?.timer !== undefined) clearTimeout(pending.timer)
        if (pending) pendingProviderCancellations.delete(requestId)
        if (
          pending &&
          pending.provider === messageProvider &&
          pending.providerSessionId === args.providerSessionId &&
          pending.scanScopeFingerprint === args.scanScopeFingerprint
        ) {
          providerRequestController.abort()
        }
        activeProviderRequests.set(requestId, {
          controller: providerRequestController,
          provider: messageProvider,
          providerSessionId: args.providerSessionId,
          scanScopeFingerprint: args.scanScopeFingerprint
        })
      }
      try {
        await handler(
          requestId,
          args,
          scanController?.signal ?? providerRequestController?.signal
        )
      } catch (error) {
        postError(command, requestId, error)
      } finally {
        if (scanController && activeScans.get(requestId) === scanController) {
          activeScans.delete(requestId)
        }
        if (
          providerRequestController &&
          activeProviderRequests.get(requestId)?.controller ===
            providerRequestController
        ) {
          activeProviderRequests.delete(requestId)
        }
      }
    })
  }

  const internalHost = Object.freeze({
    get providerSessionId() {
      return providerSessionId
    },
    originalMediaRetrieval,
    setProviderIdentity,
    requireCurrentDocumentSession,
    postResult,
    postError,
    postProgress,
    dateRangeBounds,
    isTimestampInDateRange,
    classifyProviderFailure,
    createProviderHealth,
    createAbortError,
    throwIfAborted,
    withAbort,
    delay,
    register
  })

  // Provider adapters receive only the operations they use. The generic
  // withAbort wrapper stays private to the host; the test factory returns the
  // full internalHost for focused lifecycle tests.
  const providerAdapterHost = Object.freeze({
    get providerSessionId() {
      return providerSessionId
    },
    originalMediaRetrieval,
    setProviderIdentity,
    requireCurrentDocumentSession,
    postResult,
    postError,
    postProgress,
    dateRangeBounds,
    isTimestampInDateRange,
    classifyProviderFailure,
    createProviderHealth,
    createAbortError,
    throwIfAborted,
    delay,
    register
  })

  targetWindow.__GPD_COMMAND_HOST__ = providerAdapterHost
  return internalHost
}

// The production bundle loads this file as a classic MAIN-world script. The
// test mode hook is opt-in and lets Vitest import the same source so Stryker
// can instrument the message gate instead of testing a copied string.
function exposeTestFactory(targetGlobal) {
  if (targetGlobal.__GPD_COMMAND_HOST_TEST_MODE__ !== true) return
  targetGlobal.__GPD_COMMAND_HOST_TEST_FACTORY__ = createCommandHost
  targetGlobal.__GPD_COMMAND_HOST_TEST_READ_PUBLIC_KEY__ =
    readPublicKeyFromCurrentScript
  targetGlobal.__GPD_COMMAND_HOST_TEST_IS_LOCAL_ENVIRONMENT__ =
    isLocalTestEnvironment
}

function readPublicKeyFromCurrentScript(targetWindow) {
  try {
    const script = document.currentScript
    const encoded =
      script instanceof HTMLScriptElement
        ? new URL(script.src).searchParams.get("publicKey")
        : null
    const parsed = encoded
      ? JSON.parse(encoded)
      : targetWindow.__GPD_PROVIDER_COMMAND_PUBLIC_KEY__
    if (
      !parsed ||
      parsed.kty !== "EC" ||
      parsed.crv !== "P-256" ||
      typeof parsed.x !== "string" ||
      typeof parsed.y !== "string"
    ) {
      return undefined
    }
    return { kty: "EC", x: parsed.x, y: parsed.y, crv: "P-256" }
  } catch {
    return undefined
  }
}

if (
  typeof window === "undefined" ||
  !window.__GPD_COMMAND_HOST__ ||
  globalThis.__GPD_COMMAND_HOST_TEST_MODE__ === true
) {
  globalThis.addEventListener("gpd-command-host-test", () =>
    exposeTestFactory(globalThis)
  )
}

if (typeof window !== "undefined") {
  const publicKey = readPublicKeyFromCurrentScript(window)
  const isTestEnvironment = isLocalTestEnvironment(window)
  if (publicKey || isTestEnvironment) {
    createCommandHost(window, publicKey)
    try {
      delete window.__GPD_PROVIDER_COMMAND_PUBLIC_KEY__
    } catch {
      // Ignore a page-defined non-configurable property and fail closed later.
    }
  }
}
}
