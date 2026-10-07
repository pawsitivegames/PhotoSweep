// MAIN world command handler for iCloud Photos pages.

(() => {
  if (window.__GPD_ICLOUD_COMMAND_HANDLER_LOADED__) {
    console.log("GPD: iCloud command handler already loaded")
    return
  }
  window.__GPD_ICLOUD_COMMAND_HANDLER_LOADED__ = true

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const ICLOUD_PAGE_SIZE = 100
const ICLOUD_API_TIMEOUT_MS = 30000
const ICLOUD_CHANGE_PAGE_SIZE = 200
const ICLOUD_MAX_INCREMENTAL_CHANGE_PAGES = 10
const ICLOUD_MAX_INCREMENTAL_CHANGE_RECORDS = 2000
const ICLOUD_ALBUM_PAGE_LIMIT = 200
const ICLOUD_ALBUM_MAX_PAGES = 100
const ICLOUD_ALBUM_MAX_RECORDS = 10000
const ICLOUD_ALBUM_MAX_FOLDER_DEPTH = 16
const ICLOUD_REVIEW_BUDGET_SCOPE_MAX = 10000
const ICLOUD_LIST_RECORD_TYPE =
  "CPLAssetAndMasterByAssetDateWithoutHiddenOrDeleted"
const ICLOUD_ALBUM_RECORD_TYPE = "CPLAlbumByPositionLive"
const ICLOUD_ALBUM_MEDIA_RECORD_TYPE = "CPLContainerRelationLiveByAssetDate"
const ICLOUD_ALBUM_ROOT_IDS = new Set([
  "----Root-Folder----",
  "----Project-Root-Folder----"
])
const ICLOUD_ALBUM_MEDIA_KEY_PREFIX = "icloud-album-"
const scannedResourceByItem = new WeakMap()
const ICLOUD_DESIRED_KEYS = [
  "recordName",
  "recordType",
  "recordChangeTag",
  "masterRef",
  "assetDate",
  "addedDate",
  "originalCreationDate",
  "itemType",
  "isFavorite",
  "assetSubtypeV2",
  "filenameEnc",
  "resJPEGThumbWidth",
  "resJPEGThumbHeight",
  "resJPEGThumbFingerprint",
  "resJPEGThumbRes",
  "resJPEGMedWidth",
  "resJPEGMedHeight",
  "resJPEGMedFingerprint",
  "resJPEGMedRes",
  "resOriginalWidth",
  "resOriginalHeight",
  "resOriginalFileSize",
  "resOriginalFileType",
  "resOriginalFingerprint",
  "resOriginalRes",
  "resVidSmallWidth",
  "resVidSmallHeight",
  "resVidSmallFingerprint",
  "resVidSmallRes",
  "resVidMedWidth",
  "resVidMedHeight",
  "resVidMedFingerprint",
  "resVidMedRes",
  "duration",
  "vidComplDurValue",
  "vidComplDurScale"
]

const ICLOUD_PHOTOS_HOSTS = new Set([
  "www.icloud.com",
  "icloud.com",
  "www.icloud.com.cn",
  "icloud.com.cn"
])

function isIcloudPhotosHost(hostname = location.hostname) {
  return ICLOUD_PHOTOS_HOSTS.has(hostname)
}

function isIcloudPhotosLocation(locationLike = location) {
  return (
    isIcloudPhotosHost(locationLike.hostname) &&
    (locationLike.pathname.startsWith("/photos") ||
      locationLike.pathname.includes("/applications/photos"))
  )
}

if (window.__GPD_COMMAND_TEST_MODE__ === true) {
  window.__GPD_ICLOUD_COMMAND_TEST_API__ = Object.freeze({
    isIcloudPhotosHost,
    isIcloudPhotosLocation,
    discoverIcloudAccountEmail,
    evaluateModifyResponse
  })
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i

function sameOriginDocuments(rootWindow = window) {
  const documents = []
  const visited = new Set()
  const visit = (candidateWindow) => {
    if (!candidateWindow || visited.has(candidateWindow)) return
    visited.add(candidateWindow)
    let candidateDocument
    try {
      candidateDocument = candidateWindow.document
    } catch {
      return
    }
    if (!candidateDocument) return
    documents.push(candidateDocument)
    for (const frame of candidateDocument.querySelectorAll("iframe, frame")) {
      try {
        visit(frame.contentWindow)
      } catch {
        // Cross-origin application frames are not inspectable.
      }
    }
  }
  try {
    visit(rootWindow.top || rootWindow)
  } catch {
    visit(rootWindow)
  }
  return documents
}

function accountEmailFromDocuments(documents) {
  const emails = new Set()
  for (const candidateDocument of documents) {
    // Only the account popover's explicit signed-in menu label is identity
    // evidence. Captions, filenames, image labels and generic .email content
    // may belong to other people in the library.
    for (const element of candidateDocument.querySelectorAll("ui-menu-item[aria-label]")) {
      const label = element.getAttribute("aria-label") || ""
      if (!/^(?:you are )?signed in as\s/i.test(label)) continue
      const matches = label.match(new RegExp(EMAIL_PATTERN.source, "gi")) || []
      if (matches.length !== 1) return ""
      emails.add(matches[0].toLowerCase())
    }
  }
  return emails.size === 1 ? emails.values().next().value : ""
}

async function discoverIcloudAccountEmail() {
  const documents = sameOriginDocuments()
  const existingEmail = accountEmailFromDocuments(documents)
  if (existingEmail) return existingEmail

  // iCloud exposes the signed-in email in the account popover rather than in
  // the library document. Open it briefly so healthCheck can bind results to
  // the same account when the provider exposes that signal.
  const accountButton = documents
    .flatMap((candidateDocument) =>
      Array.from(
        candidateDocument.querySelectorAll(
          'button, [role="button"], ui-button'
        )
      )
    )
    .find((element) =>
      /^(account|account menu)$/i.test(
        element.getAttribute("aria-label") || ""
      )
    )
  if (!accountButton || typeof accountButton.click !== "function") return ""
  try {
    accountButton.click()
    await sleep(0)
    const email = accountEmailFromDocuments(sameOriginDocuments())
    const closeButton = sameOriginDocuments()
      .flatMap((candidateDocument) =>
        Array.from(
          candidateDocument.querySelectorAll(
            '[aria-label="Close menu"], [aria-label="Close pane"]'
          )
        )
      )
      .find((element) => typeof element.click === "function")
    closeButton?.click()
    return email
  } catch {
    return ""
  }
}

async function assertIcloudProviderSession(args) {
  if (!args?.providerSessionId) return
  const accountEmail = await discoverIcloudAccountEmail()
  if (!accountEmail) {
    // A restored tab ID cannot prove that a page reload kept the same iCloud
    // account when the account email is unavailable. Rotate that ID once for
    // the current document and reject any request bound to the old one.
    const currentSessionId = commandHost.requireCurrentDocumentSession()
    if (args.providerSessionId !== currentSessionId) {
      throw new Error(
        "The iCloud Photos account changed after review. Reconnect and scan the current account before continuing."
      )
    }
    return
  }
  const currentSessionId = await commandHost.setProviderIdentity(accountEmail)
  if (currentSessionId !== args.providerSessionId) {
    throw new Error(
      "The iCloud Photos account changed after review. Reconnect and scan the current account before continuing."
    )
  }
}

async function assertIcloudMutationSession(args) {
  const expectedSessionId = args?.providerSessionId
  if (
    typeof expectedSessionId !== "string" ||
    !expectedSessionId ||
    expectedSessionId !== commandHost.providerSessionId
  ) {
    throw new Error(
      "The iCloud Photos account changed after review. Reconnect and scan the current account before continuing."
    )
  }
  await assertIcloudProviderSession(args)
  if (
    expectedSessionId !== commandHost.providerSessionId ||
    expectedSessionId !== args?.providerSessionId
  ) {
    throw new Error(
      "The iCloud Photos account changed after review. Reconnect and scan the current account before continuing."
    )
  }
}

function cloudKitQueryUrl() {
  const entries = performance.getEntriesByType("resource")
  for (let index = entries.length - 1; index >= 0; index--) {
    const url = entries[index]?.name || ""
    if (/ckdatabasews\.icloud\.com\/database\/.+\/records\/query\?/.test(url)) {
      return url
    }
  }
  return ""
}

const ICLOUD_QUERY_DISCOVERY_TIMEOUT_MS = 2000
const ICLOUD_QUERY_DISCOVERY_INTERVAL_MS = 100
const ICLOUD_QUERY_DISCOVERY_MAX_ATTEMPTS = Math.ceil(
  ICLOUD_QUERY_DISCOVERY_TIMEOUT_MS / ICLOUD_QUERY_DISCOVERY_INTERVAL_MS
)

async function waitForCloudKitQueryUrl(signal) {
  const deadline = Date.now() + ICLOUD_QUERY_DISCOVERY_TIMEOUT_MS
  for (
    let attempt = 0;
    attempt < ICLOUD_QUERY_DISCOVERY_MAX_ATTEMPTS && Date.now() < deadline;
    attempt += 1
  ) {
    commandHost.throwIfAborted(signal)
    const queryUrl = cloudKitQueryUrl()
    if (queryUrl) return queryUrl
    await commandHost.delay(ICLOUD_QUERY_DISCOVERY_INTERVAL_MS, signal)
  }
  return cloudKitQueryUrl()
}

function cloudKitBatchUrl(queryUrl) {
  return queryUrl.replace("/records/query?", "/internal/records/query/batch?")
}

function cloudKitModifyUrl(queryUrl) {
  return queryUrl.replace("/records/query?", "/records/modify?")
}

function cloudKitLookupUrl(queryUrl) {
  return queryUrl.replace("/records/query?", "/records/lookup?")
}

const ICLOUD_MODIFY_BATCH_SIZE = 50

function chunkArray(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function cloudKitErrorMessage(entity) {
  return (
    entity?.errorMessage ||
    entity?.reason ||
    entity?.serverErrorCode ||
    entity?.error?.errorMessage ||
    "iCloud rejected the request. The photo may have changed since scan — rescan and retry."
  )
}

function createMutationError(message, status = "unknown") {
  const error = new Error(message)
  error.mutationOutcomeStatus = status
  return error
}

function mutationOutcomes(operation, targets, status, reason) {
  return targets.map((target) => ({
    operation,
    targetKey: target.dedupKey,
    status,
    ...(reason ? { reason } : {})
  }))
}

function preflightMutationOutcomeData(operation, dedupKeys, reason) {
  const uniqueKeys = Array.from(
    new Set(
      (Array.isArray(dedupKeys) ? dedupKeys : []).filter(
        (key) => typeof key === "string" && key.length > 0
      )
    )
  )
  return {
    outcomes: mutationOutcomes(
      operation,
      uniqueKeys.map((dedupKey) => ({ dedupKey })),
      "failed",
      reason
    ),
    notDispatchedDedupKeys: uniqueKeys
  }
}

function validateAcknowledgedUnknownFavoriteKeys(value, dedupKeys) {
  if (value === undefined) return new Set()
  if (!Array.isArray(value)) {
    throw new Error("Unknown iCloud favorite acknowledgements are malformed.")
  }
  const selectedKeys = new Set(dedupKeys)
  const acknowledged = new Set()
  for (const key of value) {
    if (
      typeof key !== "string" ||
      !key ||
      key.trim() !== key ||
      !selectedKeys.has(key) ||
      acknowledged.has(key)
    ) {
      throw new Error(
        "Unknown iCloud favorite acknowledgement does not match the selected review."
      )
    }
    acknowledged.add(key)
  }
  return acknowledged
}

function completeMutationOutcomeCoverage(
  operation,
  targets,
  outcomes,
  dispatchedDedupKeys,
  notDispatchedReason
) {
  const coveredKeys = new Set(outcomes.map((outcome) => outcome.targetKey))
  const notDispatchedDedupKeys = []
  for (const target of targets) {
    if (coveredKeys.has(target.dedupKey)) {
      if (!dispatchedDedupKeys.has(target.dedupKey)) {
        notDispatchedDedupKeys.push(target.dedupKey)
      }
      continue
    }
    const wasDispatched = dispatchedDedupKeys.has(target.dedupKey)
    outcomes.push({
      operation,
      targetKey: target.dedupKey,
      status: wasDispatched ? "unknown" : "failed",
      reason: wasDispatched
        ? "iCloud did not return a definitive outcome for this dispatched item."
        : notDispatchedReason
    })
    coveredKeys.add(target.dedupKey)
    if (!wasDispatched) notDispatchedDedupKeys.push(target.dedupKey)
  }
  return notDispatchedDedupKeys
}

function isDefinitiveCloudKitRejection(entity) {
  const code =
    entity?.serverErrorCode ||
    entity?.error?.serverErrorCode ||
    entity?.error?.code ||
    ""
  // Keep this allowlist to documented CloudKit failures that reject a write
  // before applying that record. Transient/internal errors are ambiguous after
  // dispatch and must stay unknown rather than becoming safe-to-retry failures.
  return /^(ACCESS_DENIED|AUTHENTICATION_FAILED|AUTHENTICATION_REQUIRED|BAD_REQUEST|CONFLICT|NOT_FOUND|VALIDATING_REFERENCE_ERROR|ZONE_NOT_FOUND)$/i.test(
    String(code)
  )
}

function normalizedDeletedState(value) {
  if (value === true || value === 1 || value === "1") return 1
  if (value === false || value === 0 || value === "0") return 0
  return undefined
}

// The modify response is the only local confirmation that an iCloud mutation
// completed. A transport or response-shape failure after dispatch is ambiguous;
// it must never be converted into success by reusing the submitted changeTag.
function evaluateModifyResponse(
  data,
  requestedTargets,
  expectedDeletedState,
  atomic = true
) {
  const outcomesByDedupKey = Object.create(null)
  const refsByRecordName = Object.create(null)
  const markAll = (status, error) => {
    for (const target of requestedTargets || []) {
      if (typeof target?.dedupKey !== "string") continue
      outcomesByDedupKey[target.dedupKey] = { status, reason: error }
    }
    return { success: false, status, error, outcomesByDedupKey, refsByRecordName }
  }
  if (!Array.isArray(requestedTargets) || requestedTargets.length === 0) {
    return markAll("unknown", "iCloud mutation has no valid target records.")
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return markAll("unknown", "iCloud returned a malformed mutation response.")
  }
  if (
    data.partial === true ||
    data.moreComing === true ||
    (data.operationType !== undefined && data.operationType !== "update")
  ) {
    return markAll("unknown", "iCloud returned an incomplete mutation response.")
  }

  const expectedByName = new Map()
  for (const target of requestedTargets) {
    const recordName = target?.ref?.recordName
    if (
      typeof target?.dedupKey !== "string" ||
      !target.dedupKey ||
      typeof recordName !== "string" ||
      !recordName ||
      recordName.trim() !== recordName ||
      expectedByName.has(recordName)
    ) {
      return markAll("unknown", "iCloud mutation targets are missing or duplicated.")
    }
    expectedByName.set(recordName, target)
  }

  const hasRootError = Boolean(
    data.serverErrorCode || data.error || data.success === false
  )
  if (!Array.isArray(data.records)) {
    return markAll(
      hasRootError && isDefinitiveCloudKitRejection(data) ? "failed" : "unknown",
      hasRootError
        ? cloudKitErrorMessage(data)
        : "iCloud omitted the updated mutation records."
    )
  }
  if (data.records.length !== expectedByName.size) {
    if (
      data.records.length === 0 &&
      hasRootError &&
      isDefinitiveCloudKitRejection(data)
    ) {
      return markAll("failed", cloudKitErrorMessage(data))
    }
    // Only an explicit root rejection with no returned records is a
    // definitive no-effect failure. Any non-empty partial response is
    // contradictory/ambiguous, even when it also contains an error code.
    return markAll(
      "unknown",
      hasRootError
        ? cloudKitErrorMessage(data)
        : "iCloud did not return one updated record for every requested item."
    )
  }

  const recordsByName = new Map()
  for (const record of data.records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return markAll("unknown", "iCloud returned a malformed updated record.")
    }
    const recordName = record.recordName
    if (
      typeof recordName !== "string" ||
      !recordName ||
      recordName.trim() !== recordName ||
      !expectedByName.has(recordName) ||
      recordsByName.has(recordName)
    ) {
      return markAll(
        "unknown",
        "iCloud returned a missing, duplicate, or unrequested mutation record."
      )
    }
    recordsByName.set(recordName, record)
  }
  if (recordsByName.size !== expectedByName.size) {
    return markAll("unknown", "iCloud omitted one or more updated mutation records.")
  }

  const expectedState = normalizedDeletedState(expectedDeletedState)
  if (expectedState === undefined) {
    return markAll("unknown", "iCloud mutation has an invalid requested state.")
  }
  for (const [recordName, target] of expectedByName) {
    const record = recordsByName.get(recordName)
    const previousRef = target.ref
    if (hasRootError) {
      outcomesByDedupKey[target.dedupKey] = {
        status: "unknown",
        reason: cloudKitErrorMessage(data)
      }
      continue
    }
    if (record.serverErrorCode || record.error || record.reason) {
      const error = cloudKitErrorMessage(record)
      outcomesByDedupKey[target.dedupKey] = {
        status: isDefinitiveCloudKitRejection(record) ? "failed" : "unknown",
        reason: error
      }
      continue
    }

    const changeTag = record.recordChangeTag
    if (
      record.recordType !== "CPLAsset" ||
      (record.operationType !== undefined && record.operationType !== "update") ||
      typeof changeTag !== "string" ||
      !changeTag.trim() ||
      changeTag === previousRef.changeTag ||
      normalizedDeletedState(fieldValue(record, "isDeleted")) !== expectedState
    ) {
      outcomesByDedupKey[target.dedupKey] = {
        status: "unknown",
        reason:
          "iCloud did not return a fresh CPLAsset record with the requested deletion state."
      }
      continue
    }

    const expectedZoneName = previousRef.zoneName || "PrimarySync"
    const expectedOwnerRecordName = previousRef.ownerRecordName
    const hasZone = record.zoneID !== undefined
    const zone = hasZone ? record.zoneID : {}
    if (!zone || typeof zone !== "object" || Array.isArray(zone)) {
      outcomesByDedupKey[target.dedupKey] = {
        status: "unknown",
        reason: "iCloud returned an unusable asset zone reference."
      }
      continue
    }
    if (
      (zone.zoneName !== undefined &&
        (typeof zone.zoneName !== "string" ||
          !zone.zoneName.trim() ||
          zone.zoneName !== expectedZoneName)) ||
      (zone.ownerRecordName !== undefined &&
        (typeof zone.ownerRecordName !== "string" ||
          !zone.ownerRecordName.trim() ||
          zone.ownerRecordName !== expectedOwnerRecordName))
    ) {
      outcomesByDedupKey[target.dedupKey] = {
        status: "unknown",
        reason: "iCloud returned a mismatched asset zone reference."
      }
      continue
    }
    const zoneName = zone.zoneName || expectedZoneName
    const ownerRecordName =
      zone.ownerRecordName || expectedOwnerRecordName
    if (
      typeof zoneName !== "string" ||
      !zoneName.trim() ||
      typeof ownerRecordName !== "string" ||
      !ownerRecordName.trim()
    ) {
      outcomesByDedupKey[target.dedupKey] = {
        status: "unknown",
        reason: "iCloud omitted a usable updated asset reference."
      }
      continue
    }
    refsByRecordName[recordName] = {
      recordName,
      changeTag,
      zoneName,
      ownerRecordName
    }
    outcomesByDedupKey[target.dedupKey] = { status: "confirmed" }
  }

  const statuses = requestedTargets.map(
    (target) => outcomesByDedupKey[target.dedupKey]?.status
  )
  const success = statuses.every((status) => status === "confirmed")
  const failedCount = statuses.filter((status) => status === "failed").length
  if (atomic && !success) {
    const allTargetsDefinitivelyRejected = requestedTargets.every((target) => {
      const record = recordsByName.get(target.ref.recordName)
      return (
        (record?.serverErrorCode || record?.error || record?.reason) &&
        isDefinitiveCloudKitRejection(record)
      )
    })
    if (allTargetsDefinitivelyRejected) {
      return markAll(
        "failed",
        "iCloud rejected every record in the atomic mutation batch."
      )
    }
    return markAll(
      "unknown",
      "iCloud returned a contradictory or incomplete result for an atomic mutation batch."
    )
  }
  return {
    success,
    status: success
      ? "confirmed"
      : failedCount === statuses.length
        ? "failed"
        : "unknown",
    error: success
      ? undefined
      : hasRootError
        ? cloudKitErrorMessage(data)
        : "iCloud did not confirm every requested mutation target.",
    outcomesByDedupKey,
    refsByRecordName
  }
}

function mergeUpdatedAssetRef(originalRef, updatedRef) {
  if (!updatedRef) return originalRef
  return {
    recordName: updatedRef.recordName || originalRef.recordName,
    changeTag: updatedRef.changeTag || originalRef.changeTag,
    zoneName: updatedRef.zoneName || originalRef.zoneName || "PrimarySync",
    ownerRecordName: updatedRef.ownerRecordName || originalRef.ownerRecordName
  }
}

async function postCloudKitModify(queryUrl, operations, zoneId, label) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ICLOUD_API_TIMEOUT_MS)
  try {
    const response = await fetch(cloudKitModifyUrl(queryUrl), {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({
        atomic: true,
        operations,
        zoneID: zoneId
      }),
      signal: controller.signal
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      const status = response.status
      const definitelyRejected =
        status >= 400 && status < 500 && ![408, 425, 429].includes(status)
      throw createMutationError(
        `${label} failed with HTTP ${status}${
          text ? `: ${text.slice(0, 240)}` : ""
        }`,
        definitelyRejected ? "failed" : "unknown"
      )
    }
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchCloudKitTrashPreflightRecords(queryUrl, targets, zoneId) {
  const lookupUrl = cloudKitLookupUrl(queryUrl)
  if (!lookupUrl || lookupUrl === queryUrl) {
    throw new Error("iCloud Photos could not verify the current asset records.")
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ICLOUD_API_TIMEOUT_MS)
  try {
    const response = await fetch(lookupUrl, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({
        records: targets.map((target) => ({
          recordName: target.ref.recordName
        })),
        zoneID: zoneId,
        desiredKeys: ["isFavorite", "isDeleted"]
      }),
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(
        `iCloud Photos could not verify the current asset records (HTTP ${response.status}).`
      )
    }
    const data = await response.json()
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      data.success === false ||
      data.partial === true ||
      data.moreComing === true ||
      data.serverErrorCode ||
      data.error ||
      !Array.isArray(data.records)
    ) {
      throw new Error("iCloud Photos returned an incomplete asset lookup.")
    }
    return data.records
  } catch (error) {
    if (error instanceof Error && /could not verify|incomplete asset lookup/.test(error.message)) {
      throw error
    }
    throw new Error("iCloud Photos could not verify the current asset records.")
  } finally {
    clearTimeout(timeout)
  }
}

function fieldValue(record, name) {
  return record?.fields?.[name]?.value
}

function usableCloudKitResponse(data) {
  return Boolean(data && typeof data === "object" && !Array.isArray(data) &&
    data.serverErrorCode == null && data.error == null &&
    (data.success === undefined || data.success === true) &&
    (data.partial === undefined || data.partial === false))
}

function decodeBase64Text(value) {
  if (typeof value !== "string" || !value) return ""
  try {
    const binary = atob(value)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return ""
  }
}

function resourceUrl(resource, fallbackFileName = "public.jpeg") {
  const template = resource?.downloadURL
  if (typeof template !== "string" || !template) return ""
  return template.replace("${f}", encodeURIComponent(fallbackFileName))
}

function resourceSize(resource) {
  return firstPositiveFiniteNumber(resource?.size)
}

function firstPositiveFiniteNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
      return value
    }
  }
  return undefined
}

function normalizeDurationMs(value) {
  // CPLAsset.fields.duration.value is milliseconds (the native v3 fixtures
  // report 2,000 for the two-second MP4s). Keep short durations as-is; do not
  // infer units from magnitude or use unverified master/complement fields.
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function normalizeCloudKitMimeType(itemType) {
  if (typeof itemType !== "string") return undefined
  const normalized = itemType.trim().toLowerCase()
  const knownTypes = {
    "public.jpeg": "image/jpeg",
    "public.png": "image/png",
    "public.heic": "image/heic",
    "public.heif": "image/heif",
    "public.tiff": "image/tiff",
    "public.gif": "image/gif",
    "public.mpeg-4": "video/mp4",
    "public.quicktime-movie": "video/quicktime",
    "com.apple.quicktime-movie": "video/quicktime"
  }
  if (knownTypes[normalized]) return knownTypes[normalized]
  return /^(?:image|video)\/[a-z0-9.+-]+$/i.test(normalized)
    ? normalized
    : undefined
}

function normalizeFavoriteValue(value) {
  if (value === true || value === 1 || value === "1") return true
  if (value === false || value === 0 || value === "0") return false
  return undefined
}

function iCloudQueryBody(offset, albumId, direction = "ASCENDING") {
  const filterBy = [
    {
      fieldName: "startRank",
      fieldValue: { type: "INT64", value: offset },
      comparator: "EQUALS"
    },
    {
      fieldName: "direction",
      fieldValue: { type: "STRING", value: direction },
      comparator: "EQUALS"
    }
  ]
  if (albumId) {
    filterBy.push({
      fieldName: "parentId",
      fieldValue: { type: "STRING", value: albumId },
      comparator: "EQUALS"
    })
  }
  return {
    query: {
      filterBy,
      recordType: albumId
        ? ICLOUD_ALBUM_MEDIA_RECORD_TYPE
        : ICLOUD_LIST_RECORD_TYPE
    },
    // A normal-library row is represented by a master and asset record. An
    // album relation query adds the CPLContainerRelation record, so its
    // record window must cover three records per media item. CloudKit's
    // startRank is an item rank, while resultsLimit is a record limit; using
    // the normal two-record window silently skipped the middle 34-item block
    // of each 100-item album page in the live 216-item fixture.
    resultsLimit: albumId ? ICLOUD_PAGE_SIZE * 3 : ICLOUD_PAGE_SIZE * 2,
    desiredKeys: ICLOUD_DESIRED_KEYS,
    zoneID: { zoneName: "PrimarySync" }
  }
}

async function fetchCloudKitPage(
  requestId,
  queryUrl,
  offset,
  externalSignal,
  albumId,
  direction = "ASCENDING"
) {
  commandHost.throwIfAborted(externalSignal)
  const controller = new AbortController()
  const abortExternal = () => controller.abort()
  externalSignal?.addEventListener("abort", abortExternal, { once: true })
  const timeout = setTimeout(() => controller.abort(), ICLOUD_API_TIMEOUT_MS)
  postProgress(
    requestId,
    offset,
    offset === 0
      ? "Fetching first iCloud Photos API page..."
      : `Fetching iCloud Photos API page at offset ${offset.toLocaleString()}...`
  )
  try {
    const response = await fetch(queryUrl, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(iCloudQueryBody(offset, albumId, direction)),
      signal: controller.signal
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(
        `iCloud Photos API page at offset ${offset.toLocaleString()} failed with HTTP ${response.status}${text ? `: ${text.slice(0, 240)}` : ""}`
      )
    }
    return await response.json()
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener("abort", abortExternal)
  }
}

function isValidCloudKitSyncToken(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function withCurrentCloudKitSyncToken(queryUrl) {
  try {
    const url = new URL(queryUrl)
    url.searchParams.set("getCurrentSyncToken", "true")
    return url.toString()
  } catch {
    return queryUrl
  }
}

function cloudKitZoneChangesUrl(queryUrl) {
  return queryUrl.replace("/records/query?", "/changes/zone?")
}

async function fetchCloudKitZoneChanges(queryUrl, syncToken, signal, args) {
  commandHost.throwIfAborted(signal)
  if (!isValidCloudKitSyncToken(syncToken)) return null
  const changesUrl = cloudKitZoneChangesUrl(queryUrl)
  if (changesUrl === queryUrl) return null
  let currentSyncToken = syncToken
  const seenSyncTokens = new Set([syncToken])
  const changedRecords = []
  let pagesRead = 0

  while (pagesRead < ICLOUD_MAX_INCREMENTAL_CHANGE_PAGES) {
    commandHost.throwIfAborted(signal)
    await assertIcloudProviderSession(args)
    const controller = new AbortController()
    const abortExternal = () => controller.abort()
    signal?.addEventListener("abort", abortExternal, { once: true })
    const timeout = setTimeout(() => controller.abort(), ICLOUD_API_TIMEOUT_MS)
    let zone
    try {
      const response = await fetch(changesUrl, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({
          zones: [
            {
              zoneID: { zoneName: "PrimarySync" },
              syncToken: currentSyncToken,
              resultsLimit: ICLOUD_CHANGE_PAGE_SIZE
            }
          ]
        }),
        signal: controller.signal
      })
      if (!response.ok) return null
      const json = await response.json()
      commandHost.throwIfAborted(signal)
      const zones = json?.zones
      if (!usableCloudKitResponse(json) || !Array.isArray(zones) || zones.length !== 1) return null
      zone = zones[0]
    } catch (error) {
      if (signal?.aborted) throw error
      return null
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abortExternal)
    }
    await assertIcloudProviderSession(args)

    const records = zone?.records
    if (
      !usableCloudKitResponse(zone) ||
      zone.zoneID?.zoneName !== "PrimarySync" ||
      (zone.serverErrorCode !== undefined && zone.serverErrorCode !== null) ||
      !Array.isArray(records) ||
      records.length > ICLOUD_CHANGE_PAGE_SIZE ||
      typeof zone.moreComing !== "boolean" ||
      !isValidCloudKitSyncToken(zone.syncToken) ||
      ["deletes", "deletedRecords", "deletedRecordIDs"].some(
        (key) =>
          zone[key] !== undefined &&
          (!Array.isArray(zone[key]) || zone[key].length > 0)
      ) ||
      (zone.moreComing && records.length === 0) ||
      (records.length > 0 && zone.syncToken === currentSyncToken)
    ) {
      return null
    }

    pagesRead += 1
    changedRecords.push(...records)
    if (changedRecords.length > ICLOUD_MAX_INCREMENTAL_CHANGE_RECORDS) {
      return null
    }
    if (!zone.moreComing) {
      return {
        records: changedRecords,
        syncToken: zone.syncToken,
        pagesRead
      }
    }
    if (seenSyncTokens.has(zone.syncToken)) return null
    seenSyncTokens.add(zone.syncToken)
    currentSyncToken = zone.syncToken
    await commandHost.delay(250, signal)
  }
  return null
}

async function fetchCloudKitItemCount(
  queryUrl,
  externalSignal,
  indexCountId = "CPLAssetByAssetDateWithoutHiddenOrDeleted"
) {
  const batchUrl = cloudKitBatchUrl(queryUrl)
  if (batchUrl === queryUrl) return null
  commandHost.throwIfAborted(externalSignal)
  const controller = new AbortController()
  const abortExternal = () => controller.abort()
  externalSignal?.addEventListener("abort", abortExternal, { once: true })
  const timeout = setTimeout(() => controller.abort(), ICLOUD_API_TIMEOUT_MS)
  try {
    const response = await fetch(batchUrl, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({
        batch: [
          {
            resultsLimit: 1,
            query: {
              filterBy: {
                fieldName: "indexCountID",
                fieldValue: {
                  type: "STRING_LIST",
                  value: [indexCountId]
                },
                comparator: "IN"
              },
              recordType: "HyperionIndexCountLookup"
            },
            zoneWide: true,
            zoneID: { zoneName: "PrimarySync" }
          }
        ]
      }),
      signal: controller.signal
    })
    if (!response.ok) return null
    const json = await response.json()
    if (!usableCloudKitResponse(json) || !Array.isArray(json.batch) ||
      json.batch.length !== 1) return null
    const batch = json.batch[0]
    if (!usableCloudKitResponse(batch) || !Array.isArray(batch.records) ||
      batch.records.length !== 1 ||
      (batch.moreComing !== undefined && batch.moreComing !== false) ||
      (batch.continuationMarker !== undefined && batch.continuationMarker !== null &&
        batch.continuationMarker !== "")) return null
    const record = batch.records[0]
    if (!usableCloudKitResponse(record)) return null
    const count = fieldValue(record, "itemCount")
    // CloudKit's public JSON format represents Int64 fields as JavaScript
    // numbers. Do not coerce null, booleans, or strings: Number(null) and
    // Number("") both become zero and can falsely complete an empty scan.
    if (typeof count !== "number") return null
    return Number.isSafeInteger(count) && count >= 0 ? count : null
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener("abort", abortExternal)
  }
}

function icloudAlbumQueryBody(parentId, continuationMarker) {
  const query = { recordType: ICLOUD_ALBUM_RECORD_TYPE }
  if (parentId) {
    query.filterBy = [
      {
        fieldName: "parentId",
        comparator: "EQUALS",
        fieldValue: { type: "STRING", value: parentId }
      }
    ]
  }
  return {
    query,
    resultsLimit: ICLOUD_ALBUM_PAGE_LIMIT,
    desiredKeys: ["albumNameEnc", "albumType", "parentId", "isDeleted"],
    zoneID: { zoneName: "PrimarySync" },
    ...(continuationMarker ? { continuationMarker } : {})
  }
}

async function fetchCloudKitAlbumPage(
  requestId,
  queryUrl,
  parentId,
  continuationMarker,
  signal
) {
  commandHost.throwIfAborted(signal)
  const controller = new AbortController()
  const abortExternal = () => controller.abort()
  signal?.addEventListener("abort", abortExternal, { once: true })
  const timeout = setTimeout(() => controller.abort(), ICLOUD_API_TIMEOUT_MS)
  const label = parentId ? "nested iCloud album list" : "iCloud album list"
  try {
    const response = await fetch(queryUrl, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(
        icloudAlbumQueryBody(parentId, continuationMarker)
      ),
      signal: controller.signal
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(
        `${label} failed with HTTP ${response.status}${text ? `: ${text.slice(0, 240)}` : ""}`
      )
    }
    const data = await response.json()
    if (data?.serverErrorCode || data?.error) {
      throw new Error(`${label} failed: ${cloudKitErrorMessage(data)}`)
    }
    return data
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", abortExternal)
  }
}

async function fetchCloudKitAlbumRecordsForParent(
  requestId,
  queryUrl,
  parentId,
  signal,
  args
) {
  const records = []
  const seenRecordIds = new Set()
  const seenPageSignatures = new Set()
  const seenContinuationMarkers = new Set()
  let continuationMarker = null
  let pagesRead = 0

  while (true) {
    commandHost.throwIfAborted(signal)
    await assertIcloudProviderSession(args)
    if (pagesRead >= ICLOUD_ALBUM_MAX_PAGES) {
      throw new Error("iCloud returned too many album pages to verify safely.")
    }
    const page = await fetchCloudKitAlbumPage(
      requestId,
      queryUrl,
      parentId,
      continuationMarker,
      signal
    )
    await assertIcloudProviderSession(args)
    if (!usableCloudKitResponse(page) || !Array.isArray(page.records)) {
      throw new Error("iCloud Photos returned an invalid album-list page.")
    }
    if (page.moreComing !== undefined && typeof page.moreComing !== "boolean") {
      throw new Error("iCloud Photos returned an invalid album-list page.")
    }
    if (page.records.length > ICLOUD_ALBUM_PAGE_LIMIT) {
      throw new Error("iCloud Photos returned an oversized album-list page.")
    }
    const signature = JSON.stringify(
      page.records.map((record) => record?.recordName || null)
    )
    if (seenPageSignatures.has(signature)) {
      throw new Error("iCloud Photos repeated an album-list page.")
    }
    seenPageSignatures.add(signature)
    for (const record of page.records) {
      const recordName = record?.recordName
      if (
        typeof recordName !== "string" ||
        !recordName ||
        /[\u0000-\u001f\u007f]/.test(recordName) ||
        record?.recordType !== "CPLAlbum" ||
        seenRecordIds.has(recordName)
      ) {
        throw new Error("iCloud Photos returned an album with an invalid schema.")
      }
      seenRecordIds.add(recordName)
      records.push(record)
      if (records.length > ICLOUD_ALBUM_MAX_RECORDS) {
        throw new Error("iCloud Photos returned too many albums to verify safely.")
      }
    }

    const nextMarker = page.continuationMarker
    if (
      page.moreComing === false &&
      nextMarker !== undefined &&
      nextMarker !== null &&
      nextMarker !== ""
    ) {
      throw new Error("iCloud Photos returned an invalid album-list page.")
    }
    if (nextMarker === undefined || nextMarker === null || nextMarker === "") {
      if (page.moreComing === true) {
        throw new Error(
          "iCloud Photos indicated more albums without a continuation cursor."
        )
      }
      break
    }
    if (
      typeof nextMarker !== "string" ||
      seenContinuationMarkers.has(nextMarker) ||
      page.records.length === 0
    ) {
      throw new Error("iCloud Photos returned an invalid album continuation cursor.")
    }
    seenContinuationMarkers.add(nextMarker)
    continuationMarker = nextMarker
    pagesRead += 1
    postProgress(
      requestId,
      records.length,
      `Loading iCloud Photos albums${parentId ? " in folder" : ""}...`
    )
    await commandHost.delay(100, signal)
  }
  return records
}

function albumRecordFingerprint(record) {
  return JSON.stringify({
    recordType: record?.recordType,
    recordName: record?.recordName,
    deleted: record?.deleted,
    albumNameEnc: fieldValue(record, "albumNameEnc"),
    albumType: fieldValue(record, "albumType"),
    parentId: fieldValue(record, "parentId"),
    isDeleted: fieldValue(record, "isDeleted")
  })
}

function decodeCloudKitAlbumName(record) {
  const encodedName = fieldValue(record, "albumNameEnc")
  if (typeof encodedName !== "string" || !encodedName) {
    throw new Error("iCloud Photos returned an album without a usable name.")
  }
  try {
    const bytes = Uint8Array.from(atob(encodedName), (char) =>
      char.charCodeAt(0)
    )
    const name = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .normalize("NFC")
      .trim()
    if (!name) throw new Error("empty album name")
    return name
  } catch {
    throw new Error("iCloud Photos returned an album with an invalid name.")
  }
}

function cloudKitAlbumType(record) {
  const value = fieldValue(record, "albumType")
  const isNumericString = typeof value === "string" && /^\d+$/.test(value)
  const albumType =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : isNumericString
        ? Number(value)
        : Number.NaN
  if (!Number.isSafeInteger(albumType) || albumType < 0) {
    throw new Error("iCloud Photos returned an album with an invalid type.")
  }
  return albumType
}

function isCloudKitAlbumDeleted(record) {
  if (record?.deleted !== undefined && typeof record.deleted !== "boolean") {
    throw new Error("iCloud Photos returned an album with an invalid deletion status.")
  }
  const value = fieldValue(record, "isDeleted")
  if (value === undefined) return record?.deleted === true
  if (value === true || value === 1 || value === "1") return true
  if (value === false || value === 0 || value === "0") {
    return record?.deleted === true
  }
  throw new Error("iCloud Photos returned an album with an invalid deletion status.")
}

function cloudKitAlbumTitle(record, recordsById) {
  const segments = []
  const seen = new Set()
  let current = record
  while (current) {
    const recordName = current.recordName
    if (ICLOUD_ALBUM_ROOT_IDS.has(recordName)) break
    if (seen.has(recordName) || seen.size >= ICLOUD_ALBUM_MAX_FOLDER_DEPTH) {
      throw new Error("iCloud Photos returned an invalid album folder hierarchy.")
    }
    seen.add(recordName)
    segments.push(decodeCloudKitAlbumName(current))
    const parentId = fieldValue(current, "parentId")
    if (parentId === undefined || parentId === null || parentId === "") break
    if (typeof parentId !== "string") {
      throw new Error("iCloud Photos returned an album with an invalid parent.")
    }
    if (ICLOUD_ALBUM_ROOT_IDS.has(parentId)) break
    const parent = recordsById.get(parentId)
    if (!parent || cloudKitAlbumType(parent) !== 3) {
      throw new Error("iCloud Photos returned an incomplete album folder hierarchy.")
    }
    current = parent
  }
  return segments.reverse().join(" / ")
}

async function fetchCloudKitPersonalAlbums(requestId, queryUrl, signal, args) {
  const recordsById = new Map()
  const pendingFolders = [{ id: null, depth: 0 }]
  const queriedFolders = new Set()

  while (pendingFolders.length > 0) {
    commandHost.throwIfAborted(signal)
    const folder = pendingFolders.shift()
    const folderKey = folder.id || "<root>"
    if (queriedFolders.has(folderKey)) continue
    queriedFolders.add(folderKey)
    const records = await fetchCloudKitAlbumRecordsForParent(
      requestId,
      queryUrl,
      folder.id,
      signal,
      args
    )
    for (const record of records) {
      const existing = recordsById.get(record.recordName)
      if (existing) {
        if (albumRecordFingerprint(existing) !== albumRecordFingerprint(record)) {
          throw new Error("iCloud Photos album data changed during enumeration.")
        }
        continue
      }
      recordsById.set(record.recordName, record)
      if (
        ICLOUD_ALBUM_ROOT_IDS.has(record.recordName) ||
        isCloudKitAlbumDeleted(record)
      ) {
        continue
      }
      const albumType = cloudKitAlbumType(record)
      if (albumType === 3) {
        if (folder.depth >= ICLOUD_ALBUM_MAX_FOLDER_DEPTH) {
          throw new Error("iCloud Photos album folders are nested too deeply.")
        }
        pendingFolders.push({ id: record.recordName, depth: folder.depth + 1 })
      } else {
        decodeCloudKitAlbumName(record)
      }
    }
  }

  return [...recordsById.values()]
    .filter((record) => {
      if (
        ICLOUD_ALBUM_ROOT_IDS.has(record.recordName) ||
        isCloudKitAlbumDeleted(record)
      ) {
        return false
      }
      return cloudKitAlbumType(record) !== 3
    })
    .map((record) => ({
      mediaKey: `${ICLOUD_ALBUM_MEDIA_KEY_PREFIX}${record.recordName}`,
      title: cloudKitAlbumTitle(record, recordsById),
      isShared: false
    }))
    .sort((left, right) => left.title.localeCompare(right.title))
}

function icloudAlbumIdFromScope(albumScope) {
  const mediaKey = albumScope?.mediaKey
  if (
    typeof mediaKey !== "string" ||
    !mediaKey.startsWith(ICLOUD_ALBUM_MEDIA_KEY_PREFIX)
  ) {
    throw new Error("The selected iCloud Photos album scope is invalid.")
  }
  const albumId = mediaKey.slice(ICLOUD_ALBUM_MEDIA_KEY_PREFIX.length)
  if (!albumId || /[\u0000-\u001f\u007f]/.test(albumId)) {
    throw new Error("The selected iCloud Photos album scope is invalid.")
  }
  return albumId
}

async function listAlbums(requestId, args, signal) {
  try {
    commandHost.throwIfAborted(signal)
    assertSupportedRoute()
    if (isTopIcloudShellWithAppFrame()) return
    await assertIcloudProviderSession(args)
    const queryUrl = await waitForCloudKitQueryUrl(signal)
    if (!queryUrl) {
      throw new Error(
        "iCloud Photos album discovery needs a signed-in CloudKit session. Open the library, reload, and try again."
      )
    }
    const albums = await fetchCloudKitPersonalAlbums(requestId, queryUrl, signal, args)
    await assertIcloudProviderSession(args)
    postResult("listAlbums", requestId, albums)
  } catch (error) {
    postError("listAlbums", requestId, error)
  }
}

function mapCloudKitItem(master, asset, index) {
  const itemType =
    fieldValue(master, "itemType") || fieldValue(asset, "itemType") || ""
  const originalFileType =
    fieldValue(master, "resOriginalFileType") ||
    fieldValue(asset, "resOriginalFileType")
  const mimeType =
    normalizeCloudKitMimeType(originalFileType) ||
    normalizeCloudKitMimeType(itemType)
  const isVideo =
    /(?:^|\.)(?:mpeg-4|movie|video|quicktime)(?:$|\.)/i.test(itemType) ||
    /^video\//i.test(mimeType || "") ||
    Boolean(
      fieldValue(master, "resVidMedRes") || fieldValue(asset, "resVidMedRes")
    )
  const isPhoto =
    /^image\//i.test(mimeType || "") ||
    /^public\.(jpeg|png|heic|heif|tiff|gif|bmp|webp|avif|raw-image)(?:$|\.)/i.test(
      itemType
    )
  const mediaKind = isVideo ? "video" : isPhoto ? "photo" : "unknown"
  const thumbnailResource =
    fieldValue(master, "resJPEGThumbRes") ||
    fieldValue(asset, "resJPEGThumbRes") ||
    fieldValue(master, "resVidSmallRes") ||
    fieldValue(asset, "resVidSmallRes") ||
    fieldValue(master, "resJPEGMedRes") ||
    fieldValue(asset, "resJPEGMedRes") ||
    fieldValue(master, "resVidMedRes") ||
    fieldValue(asset, "resVidMedRes") ||
    fieldValue(master, "resOriginalRes") ||
    fieldValue(asset, "resOriginalRes")
  const originalResource =
    fieldValue(master, "resOriginalRes") ||
    fieldValue(asset, "resOriginalRes")
  const width = firstPositiveFiniteNumber(
    fieldValue(master, "resOriginalWidth"),
    fieldValue(asset, "resOriginalWidth"),
    fieldValue(master, "resVidMedWidth"),
    fieldValue(master, "resJPEGMedWidth"),
    fieldValue(asset, "resVidMedWidth"),
    fieldValue(asset, "resJPEGMedWidth")
  )
  const height = firstPositiveFiniteNumber(
    fieldValue(master, "resOriginalHeight"),
    fieldValue(asset, "resOriginalHeight"),
    fieldValue(master, "resVidMedHeight"),
    fieldValue(master, "resJPEGMedHeight"),
    fieldValue(asset, "resVidMedHeight"),
    fieldValue(asset, "resJPEGMedHeight")
  )
  const captureTimestamp = firstFiniteNumber(fieldValue(asset, "assetDate"))
  const originalCreationTimestamp = firstFiniteNumber(
    fieldValue(asset, "originalCreationDate"),
    fieldValue(master, "originalCreationDate")
  )
  const addedTimestamp = firstFiniteNumber(
    fieldValue(asset, "addedDate"),
    fieldValue(master, "addedDate")
  )
  const recordCreatedTimestamp = firstFiniteNumber(
    asset.created?.timestamp,
    master.created?.timestamp
  )
  const timestamp = firstFiniteNumber(
    captureTimestamp,
    originalCreationTimestamp,
    addedTimestamp,
    recordCreatedTimestamp
  )
  const timestampProvenance =
    Number.isFinite(captureTimestamp) ||
    Number.isFinite(originalCreationTimestamp)
      ? "unknown"
      : Number.isFinite(addedTimestamp) || Number.isFinite(recordCreatedTimestamp)
        ? "creation"
        : "unknown"
  const creationTimestamp = firstFiniteNumber(
    addedTimestamp,
    recordCreatedTimestamp,
    originalCreationTimestamp,
    timestamp
  )
  const creationTimestampProvenance = Number.isFinite(addedTimestamp) ||
    Number.isFinite(recordCreatedTimestamp)
    ? "creation"
    : "unknown"
  const thumb = resourceUrl(thumbnailResource, "public.jpeg")
  if (!thumb) return null
  const originalFingerprint =
    fieldValue(master, "resOriginalFingerprint") ||
    fieldValue(asset, "resOriginalFingerprint")
  const originalChecksum = originalResource?.fileChecksum
  const exactContentHash = originalFingerprint
    ? `icloud-fingerprint-${originalFingerprint}`
    : originalChecksum
      ? `icloud-checksum-${originalChecksum}`
      : undefined
  const duration = normalizeDurationMs(fieldValue(asset, "duration"))
  const assetFavorite = normalizeFavoriteValue(fieldValue(asset, "isFavorite"))
  const masterFavorite = normalizeFavoriteValue(fieldValue(master, "isFavorite"))
  // Positive evidence must survive contradictory metadata from the paired
  // records, so stale negative metadata cannot make a favorite selectable.
  const favoriteValue = assetFavorite === true || masterFavorite === true
    ? true
    : assetFavorite ?? masterFavorite
  const originalFileName =
    decodeBase64Text(fieldValue(master, "filenameEnc")) ||
    decodeBase64Text(fieldValue(asset, "filenameEnc"))
  const originalHashResourceUrl = originalResource && originalFileName
    ? allowlistedIcloudResourceUrl(
        resourceUrl(originalResource, originalFileName)
      )
    : ""
  const assetRecordName = asset.recordName || master.recordName
  const recordName = master.recordName || assetRecordName
  const mediaKey = `icloud-${recordName}`
  const productUrl = assetRecordName
    ? `${location.origin}/photos/#/i,pz,${encodeURIComponent(assetRecordName)}/`
    : window.location.href
  // CPLAsset ref captured at scan time so trash/recover can issue a CloudKit
  // records/modify (operationType "update", isDeleted 1/0). Requires the asset
  // recordName + a changeTag + the record's zoneID.
  const assetZone = asset.zoneID || master.zoneID || {}
  const assetChangeTag = asset.recordChangeTag || master.recordChangeTag || ""
  const icloudAsset =
    assetRecordName && assetChangeTag
      ? {
          recordName: assetRecordName,
          changeTag: assetChangeTag,
          zoneName: assetZone.zoneName || "PrimarySync",
          ownerRecordName: assetZone.ownerRecordName || ""
        }
      : undefined
  const mappedItem = {
    mediaKey,
    dedupKey: recordName,
    exactContentHash,
    contentHash: originalFingerprint
      ? {
          value: originalFingerprint,
          algorithm: "provider-fingerprint",
          provenance: "original-content",
          verificationSource: "provider-fingerprint"
        }
      : undefined,
    thumb,
    provider: "icloud",
    productUrl,
    sequenceIndex: index,
    timestamp,
    timestampProvenance,
    creationTimestamp,
    creationTimestampProvenance,
    resWidth: width,
    resHeight: height,
    fileName:
      originalFileName ||
      `iCloud Photo ${index + 1}`,
    size:
      firstPositiveFiniteNumber(
        fieldValue(master, "resOriginalFileSize"),
        fieldValue(asset, "resOriginalFileSize")
      ) || resourceSize(originalResource),
    takesUpSpace: null,
    isOriginalQuality: null,
    mediaKind,
    originalContentVerificationCapability:
      originalHashResourceUrl &&
      (mediaKind === "photo" || mediaKind === "video")
        ? "available"
        : "unavailable",
    ...(mimeType ? { mimeType } : {}),
    ...(favoriteValue === undefined
      ? { favoriteStatus: "unknown", favoriteSource: "unavailable" }
      : {
          isFavorite: favoriteValue,
          favoriteStatus: favoriteValue ? "favorite" : "not-favorite",
          favoriteSource: "provider-metadata"
        }),
    duration: isVideo ? duration : undefined,
    ...(icloudAsset ? { icloudAsset } : {})
  }
  if (originalResource && originalFileName) {
    scannedResourceByItem.set(mappedItem, {
      downloadURL: originalResource.downloadURL,
      fileName: originalFileName,
      mediaKind,
      mimeType,
      size: firstPositiveFiniteNumber(
        fieldValue(master, "resOriginalFileSize"),
        fieldValue(asset, "resOriginalFileSize")
      ) || resourceSize(originalResource)
    })
  }
  return mappedItem
}

function validScanScopeFingerprint(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function allowlistedIcloudResourceUrl(value) {
  if (typeof value !== "string" || value.length === 0) return ""
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !(
        hostname === "icloud-content.com" ||
        hostname.endsWith(".icloud-content.com") ||
        hostname === "icloud-content.com.cn" ||
        hostname.endsWith(".icloud-content.com.cn")
      )
    ) {
      return ""
    }
    return url.href
  } catch {
    return ""
  }
}

function rememberScannedOriginalResources(mediaItems, args) {
  const providerSessionId = args?.providerSessionId
  const scopeFingerprint = args?.scanScopeFingerprint
  if (
    !Array.isArray(mediaItems) ||
    !providerSessionId ||
    providerSessionId !== commandHost.providerSessionId ||
    !validScanScopeFingerprint(scopeFingerprint)
  ) {
    return
  }
  for (const item of mediaItems) {
    const source = scannedResourceByItem.get(item)
    if (!source || typeof item?.mediaKey !== "string") continue
    const templateResource = { downloadURL: source.downloadURL }
    const url = allowlistedIcloudResourceUrl(
      resourceUrl(templateResource, source.fileName)
    )
    if (!url) continue
    commandHost.originalMediaRetrieval.rememberResource(
      "icloud",
      providerSessionId,
      scopeFingerprint,
      item.mediaKey,
      {
        url,
        mediaKind: source.mediaKind,
        mimeType: source.mimeType,
        size: source.size
      }
    )
  }
}

function requireScannedOriginalResource(requestId, args) {
  if (args?.userOptIn !== true) {
    throw new Error("Original media retrieval requires explicit user opt-in.")
  }
  if (
    args?.requestId !== undefined &&
    args.requestId !== requestId
  ) {
    throw new Error("The iCloud retrieval request identity did not match.")
  }
  if (
    typeof args?.providerSessionId !== "string" ||
    !args.providerSessionId ||
    args.providerSessionId !== commandHost.providerSessionId
  ) {
    throw new Error("The iCloud provider session changed. Scan the current account again.")
  }
  if (!validScanScopeFingerprint(args?.scanScopeFingerprint)) {
    throw new Error("The iCloud review scope is missing or invalid. Scan again.")
  }
  if (typeof args?.mediaKey !== "string" || !args.mediaKey) {
    throw new Error("The iCloud media target is missing.")
  }
  const resource = commandHost.originalMediaRetrieval.getResource(
    "icloud",
    args.providerSessionId,
    args.scanScopeFingerprint,
    args.mediaKey,
    false
  )
  if (!resource) {
    throw new Error("The iCloud original is not present in this recent review. Scan again.")
  }
  return { resource }
}

function reserveOriginalReviewBudget(args, resource) {
  return commandHost.originalMediaRetrieval.reserveBudget({
    provider: "icloud",
    sessionId: args?.providerSessionId,
    scopeFingerprint: args?.scanScopeFingerprint,
    maxBytes: args?.maxBytes,
    aggregateBudgetBytes: args?.aggregateBudgetBytes,
    resourceSize: resource.size,
    maxBudgetScopes: ICLOUD_REVIEW_BUDGET_SCOPE_MAX
  })
}

function releaseOriginalReviewBudget(reservation) {
  commandHost.originalMediaRetrieval.releaseBudget(reservation)
}

function hexDigest(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function readIcloudOriginalWithinLimits(response, reservation, signal) {
  const contentLength = Number(response.headers?.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > reservation.maxBytes) {
    await response.body?.cancel?.().catch(() => {})
    throw new Error("The iCloud original exceeds the approved byte limit.")
  }
  const reader = response.body?.getReader?.()
  if (!reader) {
    throw new Error("iCloud original retrieval requires a streaming response to enforce byte limits.")
  }
  const chunks = []
  let byteLength = 0
  try {
    while (true) {
      commandHost.throwIfAborted(signal)
      const result = await reader.read()
      if (result.done) break
      if (!(result.value instanceof Uint8Array)) {
        throw new Error("iCloud returned an invalid original-media stream.")
      }
      const nextLength = byteLength + result.value.byteLength
      const withinBudget =
        commandHost.originalMediaRetrieval.consumeChunk(
          reservation,
          result.value.byteLength
        )
      if (!withinBudget || nextLength > reservation.maxBytes) {
        await reader.cancel().catch(() => {})
        throw new Error("The iCloud original exceeded the approved review byte budget.")
      }
      byteLength = nextLength
      chunks.push(result.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  }
  if (byteLength === 0) throw new Error("iCloud returned an empty original media file.")
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, byteLength }
}

async function getOriginalContentHash(requestId, args, signal) {
  let timeout
  let controller
  let abortExternal
  let reservation
  try {
    commandHost.throwIfAborted(signal)
    const { resource } = requireScannedOriginalResource(requestId, args)
    await assertIcloudProviderSession(args)
    reservation = reserveOriginalReviewBudget(args, resource)
    controller = new AbortController()
    abortExternal = () => controller.abort()
    signal?.addEventListener("abort", abortExternal, { once: true })
    timeout = setTimeout(() => controller.abort(), ICLOUD_API_TIMEOUT_MS)
    const response = await fetch(resource.url, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal
    })
    if (response.status !== 200) {
      throw new Error(`iCloud original fetch failed with HTTP ${response.status}.`)
    }
    const responseUrl = response.url || resource.url
    if (!allowlistedIcloudResourceUrl(responseUrl)) {
      throw new Error("iCloud redirected the original to an unapproved resource host.")
    }
    const { bytes, byteLength } = await readIcloudOriginalWithinLimits(response, reservation, signal)
    commandHost.throwIfAborted(signal)
    if (
      typeof resource.size === "number" &&
      Number.isFinite(resource.size) &&
      resource.size > 0 &&
      byteLength !== resource.size
    ) {
      throw new Error("iCloud returned an incomplete original media file.")
    }
    if (!globalThis.crypto?.subtle?.digest) {
      throw new Error("This page cannot compute a local SHA-256 digest safely.")
    }
    const digest = new Uint8Array(
      await globalThis.crypto.subtle.digest("SHA-256", bytes.buffer)
    )
    await assertIcloudProviderSession(args)
    commandHost.throwIfAborted(signal)
    if (
      !commandHost.originalMediaRetrieval.isCurrentResource(
        "icloud",
        args.providerSessionId,
        args.scanScopeFingerprint,
        args.mediaKey,
        resource
      )
    ) {
      throw new Error("The iCloud review scope changed during original retrieval.")
    }
    postResult("getOriginalContentHash", requestId, {
      mediaKey: args.mediaKey,
      scopeFingerprint: args.scanScopeFingerprint,
      contentHash: {
        value: hexDigest(digest),
        algorithm: "sha256",
        provenance: "original-content",
        verificationSource: "local-original-bytes"
      },
      byteLength,
      ...(resource.mimeType ? { mimeType: resource.mimeType } : {})
    })
  } catch (error) {
    const message =
      error?.name === "AbortError" || signal?.aborted
        ? "iCloud original retrieval was cancelled or timed out."
        : error instanceof Error && !/https?:\/\//i.test(error.message)
          ? error.message
          : "iCloud original retrieval failed without exposing the resource URL."
    postError("getOriginalContentHash", requestId, message)
  } finally {
    clearTimeout(timeout)
    if (abortExternal) signal?.removeEventListener("abort", abortExternal)
    releaseOriginalReviewBudget(reservation)
    controller = undefined
  }
}

async function getVideoPlaybackUrl(requestId, args, signal) {
  try {
    commandHost.throwIfAborted(signal)
    const { resource } = requireScannedOriginalResource(requestId, args)
    await assertIcloudProviderSession(args)
    if (resource.mediaKind !== "video" || !/^video\//i.test(resource.mimeType || "")) {
      throw new Error("The selected iCloud item has no verified video original.")
    }
    if (!allowlistedIcloudResourceUrl(resource.url)) {
      throw new Error("iCloud did not provide an approved video playback resource.")
    }
    commandHost.throwIfAborted(signal)
    if (
      !commandHost.originalMediaRetrieval.isCurrentResource(
        "icloud",
        args.providerSessionId,
        args.scanScopeFingerprint,
        args.mediaKey,
        resource
      )
    ) {
      throw new Error("The iCloud review scope changed before video playback.")
    }
    // The result is a transient viewer handoff. Keep the in-memory scan proof
    // so the user can reopen playback in the same reviewed scope.
    postResult("getVideoPlaybackUrl", requestId, {
      mediaKey: args.mediaKey,
      scopeFingerprint: args.scanScopeFingerprint,
      playbackUrl: resource.url,
      ...(resource.mimeType ? { mimeType: resource.mimeType } : {})
    })
  } catch (error) {
    const message =
      error?.name === "AbortError" || signal?.aborted
        ? "iCloud video playback retrieval was cancelled."
        : error instanceof Error && !/https?:\/\//i.test(error.message)
          ? error.message
          : "iCloud video playback could not be prepared safely."
    postError("getVideoPlaybackUrl", requestId, message)
  }
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      Math.abs(value) <= 8640000000000000
    ) return value
  }
  return Number.NaN
}

function validCloudKitRecordName(value) {
  return typeof value === "string" && value.length > 0 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
}

function mapCloudKitRecords(records, offset = 0, albumId = null) {
  const assetsByMaster = new Map()
  const assetsWithoutMaster = []
  const masters = []
  const seenRecordNames = new Set()
  for (const record of records) {
    // Counts cannot repair ambiguous identities. In particular, overwriting
    // two assets that reference one master can make a lossy page appear to
    // match the index. Keep this page out of review until its shape is known.
    if (
      !record || typeof record !== "object" || Array.isArray(record) ||
      !validCloudKitRecordName(record.recordName) ||
      seenRecordNames.has(record.recordName) ||
      record.serverErrorCode != null || record.error != null ||
      (record.deleted !== undefined && typeof record.deleted !== "boolean") ||
      record.deleted === true ||
      (record.zoneID !== undefined &&
        (!record.zoneID || typeof record.zoneID !== "object" ||
          Array.isArray(record.zoneID) ||
          (record.zoneID.zoneName !== undefined &&
            record.zoneID.zoneName !== "PrimarySync")))
    ) return null
    seenRecordNames.add(record.recordName)
    if (record.recordType === "CPLAsset") {
      const masterName = fieldValue(record, "masterRef")?.recordName
      if (fieldValue(record, "masterRef") !== undefined &&
        (!validCloudKitRecordName(masterName) || assetsByMaster.has(masterName))) {
        return null
      }
      if (masterName) assetsByMaster.set(masterName, record)
      else assetsWithoutMaster.push(record)
    } else if (record.recordType === "CPLMaster") {
      masters.push(record)
    } else if (
      !albumId ||
      !["CPLContainerRelation", ICLOUD_ALBUM_MEDIA_RECORD_TYPE].includes(record.recordType) ||
      (fieldValue(record, "parentId") !== undefined &&
        fieldValue(record, "parentId") !== albumId)
    ) {
      return null
    }
  }

  const mapped = []
  const mappedMasterNames = new Set()
  for (const master of masters) {
    const asset = assetsByMaster.get(master.recordName)
    if (!asset) return null
    mappedMasterNames.add(master.recordName)
    const item = mapCloudKitItem(master, asset, offset + mapped.length)
    if (item) mapped.push(item)
  }
  for (const masterName of assetsByMaster.keys()) {
    if (mappedMasterNames.has(masterName)) continue
    return null
  }
  for (const asset of assetsWithoutMaster) {
    const item = mapCloudKitItem(asset, asset, offset + mapped.length)
    if (item) mapped.push(item)
  }
  return mapped
}

function cloudKitChangeFlagIsInactive(record, fieldName) {
  const value = fieldValue(record, fieldName)
  return (
    value === undefined ||
    value === null ||
    value === false ||
    value === 0 ||
    value === "0"
  )
}

/**
 * Changed records are usable incrementally only when every photo change has
 * both its CPLMaster and CPLAsset record and remains visible in the library.
 * Deletions, soft deletes, hidden items, unknown schemas, and incomplete pairs
 * force a full library scan so stale cached duplicate candidates cannot return.
 */
function mapCloudKitChangeRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return null
  const seenRecordNames = new Set()
  const mastersByName = new Map()
  const assetsByMasterName = new Map()

  for (const record of records) {
    const recordName = record?.recordName
    const zoneId = record?.zoneID
    if (
      !usableCloudKitResponse(record) ||
      !validCloudKitRecordName(recordName) ||
      (zoneId !== undefined &&
        (!zoneId || typeof zoneId !== "object" || Array.isArray(zoneId) ||
          zoneId.zoneName !== "PrimarySync")) ||
      seenRecordNames.has(recordName) ||
      (record.deleted !== undefined && typeof record.deleted !== "boolean") ||
      record.deleted === true ||
      !cloudKitChangeFlagIsInactive(record, "isDeleted") ||
      !cloudKitChangeFlagIsInactive(record, "isHidden") ||
      !cloudKitChangeFlagIsInactive(record, "isExpunged")
    ) {
      return null
    }
    seenRecordNames.add(recordName)

    if (record.recordType === "CPLMaster") {
      mastersByName.set(recordName, record)
      continue
    }
    if (record.recordType !== "CPLAsset") return null
    const masterName = fieldValue(record, "masterRef")?.recordName
    if (
      typeof masterName !== "string" ||
      !masterName ||
      /[\u0000-\u001f\u007f]/.test(masterName) ||
      assetsByMasterName.has(masterName)
    ) {
      return null
    }
    assetsByMasterName.set(masterName, record)
  }

  if (
    mastersByName.size === 0 ||
    mastersByName.size !== assetsByMasterName.size
  ) {
    return null
  }

  const mediaItems = []
  for (const [masterName, master] of mastersByName) {
    const asset = assetsByMasterName.get(masterName)
    if (!asset) return null
    const item = mapCloudKitItem(master, asset, mediaItems.length)
    if (!item || item.mediaKind === "unknown") return null
    mediaItems.push(item)
  }
  return mediaItems
}

/**
 * Resolve one incremental library read into either a complete result or null.
 * Null means the caller must use the normal full scan. This module owns delta
 * pagination, schema validation, count reconciliation, and the final caught-up
 * check so no caller can accidentally persist a token for partial changes.
 */
async function fetchCloudKitIncrementalMediaItems(
  queryUrl,
  syncToken,
  cachedTotalItems,
  signal,
  args
) {
  const zoneChanges = await fetchCloudKitZoneChanges(
    queryUrl,
    syncToken,
    signal,
    args
  )
  if (!zoneChanges) return null

  if (zoneChanges.records.length === 0) {
    const cachedTotal = Number(cachedTotalItems)
    return {
      mediaItems: [],
      providerSyncToken: zoneChanges.syncToken,
      scanCoverage: {
        status: "complete",
        stopReason: "watermark_reached",
        itemsVisited: 0,
        itemsReturned: 0,
        itemsSkipped: 0,
        unknownDateItemsSkipped: 0,
        ...(Number.isSafeInteger(cachedTotal) && cachedTotal >= 0
          ? { totalItems: cachedTotal }
          : {}),
        pagesRead: zoneChanges.pagesRead,
        mediaTypesCovered: { photos: true, videos: true },
        canResume: false
      }
    }
  }

  const changedItems = mapCloudKitChangeRecords(zoneChanges.records)
  if (!changedItems?.length) return null
  const currentTotalItems = await fetchCloudKitItemCount(
    queryUrl,
    signal
  ).catch(() => null)
  if (
    !Number.isSafeInteger(currentTotalItems) ||
    currentTotalItems < 0
  ) {
    return null
  }

  // Count and token must describe the same caught-up zone state. If another
  // page of changes landed while counting, prefer a full scan.
  const confirmation = await fetchCloudKitZoneChanges(
    queryUrl,
    zoneChanges.syncToken,
    signal,
    args
  )
  if (!confirmation || confirmation.records.length !== 0) return null

  return {
    mediaItems: changedItems,
    providerSyncToken: confirmation.syncToken,
    scanCoverage: {
      status: "complete",
      stopReason: "changes_caught_up",
      itemsVisited: changedItems.length,
      itemsReturned: changedItems.length,
      itemsSkipped: 0,
      unknownDateItemsSkipped: 0,
      totalItems: currentTotalItems,
      pagesRead: zoneChanges.pagesRead + confirmation.pagesRead,
      mediaTypesCovered: { photos: true, videos: true },
      canResume: false
    }
  }
}

async function getCloudKitMediaItems(requestId, args, coverageContext, signal) {
  commandHost.throwIfAborted(signal)
  await assertIcloudProviderSession(args)
  const requestedAlbumScope = args?.albumScope
  const albumId = requestedAlbumScope
    ? icloudAlbumIdFromScope(requestedAlbumScope)
    : null
  const discoveredQueryUrl = await waitForCloudKitQueryUrl(signal)
  if (!discoveredQueryUrl) {
    throw new Error(
      albumId
        ? "The selected iCloud Photos album cannot be verified in this page session. Reload the library and retry."
        : "iCloud Photos could not establish a complete CloudKit library session. Reload the library and retry."
    )
  }
  const queryUrl = withCurrentCloudKitSyncToken(discoveredQueryUrl)
  if (albumId) {
    const albums = await fetchCloudKitPersonalAlbums(requestId, queryUrl, signal, args)
    if (!albums.some((album) => album.mediaKey === requestedAlbumScope.mediaKey)) {
      throw new Error(
        "The selected iCloud Photos album is unavailable in this personal library. Refresh albums and try again."
      )
    }
  }

  const scanLimit =
    typeof args?.limit === "number" && Number.isFinite(args.limit)
      ? Math.max(1, Math.floor(args.limit))
      : Number.POSITIVE_INFINITY
  const dateRange = dateRangeBounds(args?.dateRange)
  const fullLibraryScan =
    !albumId && !dateRange && scanLimit === Number.POSITIVE_INFINITY
  if (fullLibraryScan && isValidCloudKitSyncToken(args?.providerSyncToken)) {
    const incrementalResult = await fetchCloudKitIncrementalMediaItems(
      queryUrl,
      args.providerSyncToken,
      args?.cachedTotalItems,
      signal,
      args
    )
    if (incrementalResult) return incrementalResult
  }
  const mediaItems = coverageContext.mediaItems
  const seen = new Set()
  let offset = 0
  const countIndexId = albumId
    ? `CPLContainerRelationNotDeletedByAssetDate:${albumId}`
    : "CPLAssetByAssetDateWithoutHiddenOrDeleted"
  const totalCount = await fetchCloudKitItemCount(
    queryUrl,
    signal,
    countIndexId
  ).catch(() => null)
  const targetCount = totalCount === null ? scanLimit : Math.min(totalCount, scanLimit)
  let emptyPages = 0
  const seenPageSignatures = new Set()
  const pageSizes = []
  coverageContext.mediaTypesCovered = { photos: true, videos: true }
  let stopReason = "exhausted"
  let duplicateRecord = false
  let querySyncToken
  let querySyncTokenStable = true
  // The count index can lag a newly populated library or album. Confirm an
  // apparent empty scope with a terminal page before reporting complete coverage.
  let emptyScopeProbePending = totalCount === 0

  while (
    (coverageContext.itemsVisited < targetCount || emptyScopeProbePending) &&
    (totalCount === null ||
      offset < totalCount ||
      emptyScopeProbePending)
  ) {
    commandHost.throwIfAborted(signal)
    await assertIcloudProviderSession(args)
    const page = await fetchCloudKitPage(
      requestId,
      queryUrl,
      offset,
      signal,
      albumId
    )
    await assertIcloudProviderSession(args)
    if (!usableCloudKitResponse(page) || !Array.isArray(page.records)) {
      stopReason = "coverage_unknown"
      break
    }
    if (pageSizes.length === 0) {
      querySyncToken = page.syncToken
    } else if (page.syncToken !== querySyncToken) {
      querySyncTokenStable = false
    }
    if (!isValidCloudKitSyncToken(page.syncToken)) {
      querySyncTokenStable = false
    }
    const records = page.records
    const mapped = mapCloudKitRecords(records, offset, albumId)
    if (!mapped) {
      stopReason = "coverage_unknown"
      break
    }
    pageSizes.push(mapped.length)
    const hasContinuationMarker =
      page.continuationMarker !== undefined &&
      page.continuationMarker !== null &&
      page.continuationMarker !== ""
    // This adapter traverses the rank index. A cursor response is a different,
    // unconsumed pagination contract and cannot prove rank-index exhaustion.
    if (
      (page.moreComing !== undefined && typeof page.moreComing !== "boolean") ||
      hasContinuationMarker ||
      (totalCount !== null && offset + mapped.length > totalCount) ||
      (page.moreComing === true &&
        totalCount !== null &&
        offset + mapped.length >= totalCount)
    ) {
      stopReason = "pagination_error"
      break
    }
    if (emptyScopeProbePending) {
      emptyScopeProbePending = false
      if (records.length > 0 || page.moreComing === true) {
        stopReason = "pagination_error"
      }
      break
    }
    if (mapped.length === 0) {
      emptyPages++
      if (totalCount === null) {
        stopReason = "coverage_unknown"
        break
      }
      if (emptyPages >= 3) {
        stopReason = "pagination_error"
        break
      }
      offset += ICLOUD_PAGE_SIZE
      continue
    }
    emptyPages = 0
    const pageSignature = JSON.stringify(
      mapped.map((item) => item.mediaKey).sort()
    )
    const repeatedPage = seenPageSignatures.has(pageSignature)
    seenPageSignatures.add(pageSignature)
    for (const item of mapped) {
      if (coverageContext.itemsVisited >= targetCount) break
      if (seen.has(item.mediaKey)) {
        duplicateRecord = true
        break
      }
      seen.add(item.mediaKey)
      coverageContext.itemsVisited += 1
      if (item.mediaKind === "unknown") continue
      if (dateRange && !Number.isFinite(item.timestamp)) {
        coverageContext.unknownDateItemsSkipped += 1
        continue
      }
      if (isTimestampInDateRange(item.timestamp, dateRange)) mediaItems.push(item)
    }
    // CloudKit's album query result limit is a record limit, while
    // startRank is an item rank. The provider may cap a requested 300-record
    // window at 200, yielding 66 mapped album items. Advance by the number
    // of items actually mapped so a capped response cannot skip ranks.
    offset += albumId ? Math.max(mapped.length, 1) : ICLOUD_PAGE_SIZE
    postProgress(
      requestId,
      coverageContext.itemsVisited,
      totalCount !== null && !dateRange
        ? `Fetched ${mediaItems.length.toLocaleString()} of ${targetCount.toLocaleString()} iCloud Photos items`
        : `Examined ${coverageContext.itemsVisited.toLocaleString()} iCloud Photos items; ${mediaItems.length.toLocaleString()} matched`
    )
    if (repeatedPage) {
      stopReason = "pagination_error"
      break
    }
    if (duplicateRecord) {
      stopReason = "pagination_error"
      break
    }
    if (
      totalCount === null &&
      records.length < ICLOUD_PAGE_SIZE * 2
    ) {
      stopReason = "coverage_unknown"
      break
    }
    if (
      coverageContext.itemsVisited < targetCount &&
      (totalCount === null || offset < totalCount)
    ) {
      await commandHost.delay(250, signal)
    }
  }

  if (
    stopReason === "exhausted" &&
    totalCount !== null &&
    coverageContext.itemsVisited < totalCount
  ) {
    stopReason = "coverage_unknown"
  }
  const stoppedAtLimit =
    coverageContext.itemsVisited >= scanLimit &&
    (totalCount === null || coverageContext.itemsVisited < totalCount)
  if (stoppedAtLimit) stopReason = "user_limit"
  const complete =
    stopReason === "exhausted" || stopReason === "watermark_reached"
  return {
    mediaItems,
    scanCoverage: {
      status: complete ? "complete" : "partial",
      stopReason,
      itemsVisited: coverageContext.itemsVisited,
      itemsReturned: mediaItems.length,
      itemsSkipped: coverageContext.itemsVisited - mediaItems.length,
      unknownDateItemsSkipped: coverageContext.unknownDateItemsSkipped,
      ...(totalCount !== null && !dateRange
        ? { totalItems: totalCount }
        : {}),
      ...(pageSizes.length > 0
        ? { pagesRead: pageSizes.length, pageSizes: pageSizes.slice() }
        : {}),
      mediaTypesCovered: { photos: true, videos: true },
      canResume: false
    },
    ...(fullLibraryScan &&
    complete &&
    stopReason === "exhausted" &&
    querySyncTokenStable &&
    isValidCloudKitSyncToken(querySyncToken)
      ? { providerSyncToken: querySyncToken }
      : {})
  }
}

function assertSupportedRoute() {
  const route = location.href.toLowerCase()
  if (route.includes("recentlydeleted")) {
    throw new Error(
      "iCloud scan is disabled while Recently Deleted is open. Open iCloud Photos Library or Recents, then scan again."
    )
  }
  if (route.includes("/hidden") || route.includes("#/hidden")) {
    throw new Error(
      "iCloud scan is disabled while Hidden is open. Open iCloud Photos Library or Recents, then scan again."
    )
  }
}

function isTopIcloudShellWithAppFrame() {
  return (
    window.top === window &&
    Array.from(document.querySelectorAll("iframe")).some((frame) =>
      frame.src.includes("/applications/photos")
    )
  )
}

async function getAllMediaItems(requestId, args, signal) {
  const coverageContext = {
    itemsVisited: 0,
    unknownDateItemsSkipped: 0,
    mediaTypesCovered: { photos: false, videos: false },
    mediaItems: []
  }
  try {
    commandHost.throwIfAborted(signal)
    assertSupportedRoute()
    if (isTopIcloudShellWithAppFrame()) return
    if (args?.albumScope?.isShared === true) {
      postError(
        "getAllMediaItems",
        requestId,
        new Error("Shared iCloud Photos albums are not supported for scans."),
        undefined,
        {
          status: "failed",
          stopReason: "unsupported_scope",
          itemsVisited: 0,
          itemsReturned: 0,
          itemsSkipped: 0,
          unknownDateItemsSkipped: 0,
          mediaTypesCovered: { photos: false, videos: false },
          canResume: false
        }
      )
      return
    }
    const cloudKitResult = await getCloudKitMediaItems(
      requestId,
      args,
      coverageContext,
      signal
    )
    await assertIcloudProviderSession(args)
    if (cloudKitResult.scanCoverage?.status === "complete") {
      rememberScannedOriginalResources(cloudKitResult.mediaItems, args)
    }
    postProgress(
      requestId,
      cloudKitResult.scanCoverage.itemsVisited,
      `Examined ${cloudKitResult.scanCoverage.itemsVisited.toLocaleString()} iCloud Photos items; ${cloudKitResult.mediaItems.length.toLocaleString()} matched`
    )
    postResult(
      "getAllMediaItems",
      requestId,
      cloudKitResult.mediaItems,
      cloudKitResult.scanCoverage,
      cloudKitResult.providerSyncToken
    )
    return
  } catch (error) {
    if (signal?.aborted) {
      const mediaItems = coverageContext.mediaItems
      postResult("getAllMediaItems", requestId, mediaItems, {
        status: "partial",
        stopReason: "cancelled",
        itemsVisited: coverageContext.itemsVisited,
        itemsReturned: mediaItems.length,
        itemsSkipped: coverageContext.itemsVisited - mediaItems.length,
        unknownDateItemsSkipped: coverageContext.unknownDateItemsSkipped,
        mediaTypesCovered: coverageContext.mediaTypesCovered,
        canResume: false
      })
      return
    }
    const stopReason = classifyProviderFailure(error)
    postError("getAllMediaItems", requestId, error, undefined, {
      status: "failed",
      stopReason,
      itemsVisited: coverageContext.itemsVisited,
      itemsReturned: 0,
      itemsSkipped: coverageContext.itemsVisited,
      unknownDateItemsSkipped: coverageContext.unknownDateItemsSkipped,
      mediaTypesCovered: coverageContext.mediaTypesCovered,
      canResume: false
    })
  }
}

async function trashItems(requestId, args) {
  const dedupKeys = Array.isArray(args?.dedupKeys) ? args.dedupKeys : []
  const mediaKeysToTrash = Array.isArray(args?.mediaKeysToTrash)
    ? args.mediaKeysToTrash
    : []
  if (
    dedupKeys.length === 0 ||
    mediaKeysToTrash.length !== dedupKeys.length ||
    new Set(dedupKeys).size !== dedupKeys.length ||
    new Set(mediaKeysToTrash).size !== mediaKeysToTrash.length
  ) {
    const message = "iCloud trash requires selected duplicate media keys."
    postError(
      "trashItems",
      requestId,
      message,
      preflightMutationOutcomeData("trash", dedupKeys, message)
    )
    return
  }

  // Explicit dry-run (test mode): report without deleting anything.
  if (args?.dryRun) {
    postProgress(
      requestId,
      mediaKeysToTrash.length,
      `Dry-run checked ${mediaKeysToTrash.length} iCloud item${
        mediaKeysToTrash.length === 1 ? "" : "s"
      }. Nothing was deleted.`
    )
    postResult("trashItems", requestId, {
      dryRun: true,
      trashedCount: 0,
      requestedCount: mediaKeysToTrash.length,
      trashedKeys: [],
      trashedDedupKeys: [],
      message: "iCloud delete dry-run completed. Nothing was deleted."
    })
    return
  }

  try {
    await assertIcloudMutationSession(args)
  } catch (error) {
    postError(
      "trashItems",
      requestId,
      error,
      preflightMutationOutcomeData("trash", dedupKeys, String(error))
    )
    return
  }

  // Real path: CloudKit records/modify on each CPLAsset (isDeleted: 1).
  // Scan refs bind each selected item to its asset and personal zone; the
  // current favorite and changeTag are fetched again immediately before write.
  // Native Photos accepted a stale changeTag in a race probe, so this narrows
  // the concurrent-change window but is not a server-enforced CAS guarantee.
  const refs = Array.isArray(args?.icloudAssetRefs) ? args.icloudAssetRefs : []
  if (refs.length !== dedupKeys.length) {
    const message =
      "iCloud trash metadata is missing or stale. Rescan to refresh item metadata, then retry."
    postError(
      "trashItems",
      requestId,
      message,
      preflightMutationOutcomeData("trash", dedupKeys, message)
    )
    return
  }
  const targets = dedupKeys.map((dedupKey, index) => ({
    dedupKey,
    mediaKey: mediaKeysToTrash[index],
    ref: refs[index]
  }))
  for (const target of targets) {
    const ref = target.ref
    if (
      !ref ||
      typeof ref.recordName !== "string" ||
      !ref.recordName ||
      typeof ref.changeTag !== "string" ||
      !ref.changeTag.trim() ||
      ref.zoneName !== "PrimarySync" ||
      typeof ref.ownerRecordName !== "string" ||
      !ref.ownerRecordName.trim()
    ) {
      const message = `iCloud item ${target.dedupKey} is missing trash metadata (record name, change tag, or zone). Rescan to refresh, then retry.`
      postError(
        "trashItems",
        requestId,
        message,
        preflightMutationOutcomeData("trash", dedupKeys, message)
      )
      return
    }
  }
  const primaryOwner = targets[0].ref.ownerRecordName
  if (
    targets.some(
      (target) =>
        target.ref.zoneName !== "PrimarySync" ||
        target.ref.ownerRecordName !== primaryOwner
    )
  ) {
    const message =
      "iCloud Trash only supports selected items from the current personal PrimarySync library. Rescan and retry."
    postError(
      "trashItems",
      requestId,
      message,
      preflightMutationOutcomeData("trash", dedupKeys, message)
    )
    return
  }
  if (new Set(targets.map((target) => target.ref.recordName)).size !== targets.length) {
    const message =
      "iCloud trash metadata contains duplicate asset records. Rescan to refresh item metadata, then retry."
    postError(
      "trashItems",
      requestId,
      message,
      preflightMutationOutcomeData("trash", dedupKeys, message)
    )
    return
  }

  let acknowledgedUnknownFavoriteDedupKeys
  try {
    acknowledgedUnknownFavoriteDedupKeys =
      validateAcknowledgedUnknownFavoriteKeys(
        args?.acknowledgedUnknownFavoriteDedupKeys,
        dedupKeys
      )
  } catch (error) {
    postError(
      "trashItems",
      requestId,
      error,
      preflightMutationOutcomeData("trash", dedupKeys, String(error))
    )
    return
  }

  const queryUrl = cloudKitQueryUrl()
  if (!queryUrl) {
    const message =
      "Cannot reach the iCloud Photos metadata service. Open iCloud Photos, wait for the library to load, and retry."
    postError(
      "trashItems",
      requestId,
      message,
      preflightMutationOutcomeData("trash", dedupKeys, message)
    )
    return
  }

  const zoneId = {
    zoneName: "PrimarySync",
    ownerRecordName: primaryOwner
  }
  const trashedDedupKeys = []
  const trashedKeys = []
  const outcomes = []
  // Post-trash refs (with fresh changeTags from the modify response) so a
  // subsequent recover can reuse them instead of needing a re-scan.
  const postTrashRefs = []
  let dispatchedChunk = null
  const dispatchedDedupKeys = new Set()
  const orderedOutcomes = () => {
    const byTarget = new Map(
      outcomes.map((outcome) => [outcome.targetKey, outcome])
    )
    return targets.flatMap((target) => {
      const outcome = byTarget.get(target.dedupKey)
      return outcome ? [outcome] : []
    })
  }

  try {
    const chunks = chunkArray(targets, ICLOUD_MODIFY_BATCH_SIZE)
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index]
      let recordsByName
      try {
        await assertIcloudMutationSession(args)
        const records = await fetchCloudKitTrashPreflightRecords(
          queryUrl,
          chunk,
          zoneId
        )
        const expectedNames = new Set(chunk.map((target) => target.ref.recordName))
        recordsByName = new Map()
        for (const record of records) {
          if (
            !record ||
            typeof record !== "object" ||
            Array.isArray(record) ||
            typeof record.recordName !== "string" ||
            !expectedNames.has(record.recordName) ||
            recordsByName.has(record.recordName)
          ) {
            throw new Error(
              "iCloud Photos returned an ambiguous personal asset lookup."
            )
          }
          recordsByName.set(record.recordName, record)
        }
      } catch (error) {
        outcomes.push(
          ...mutationOutcomes(
            "trash",
            chunk,
            "failed",
            String(error)
          )
        )
        postProgress(
          requestId,
          trashedDedupKeys.length,
          `Could not verify iCloud favorite state for batch ${index + 1}.`,
          "trashItems",
          {
            trashedKeys: trashedKeys.slice(),
            trashedDedupKeys: trashedDedupKeys.slice(),
            icloudAssetRefs: postTrashRefs.slice(),
            outcomes: orderedOutcomes()
          }
        )
        break
      }

      const candidates = []
      for (const target of chunk) {
        const record = recordsByName.get(target.ref.recordName)
        let reason = ""
        if (!record) {
          reason = "iCloud did not return the exact current asset record."
        } else if (
          record.recordType !== "CPLAsset" ||
          record.serverErrorCode ||
          record.error ||
          record.reason
        ) {
          reason = "iCloud did not verify the exact personal asset record."
        } else if (
          // The lookup request is scoped to zoneId above. Native Photos may
          // omit zoneID from the exact result; validate any zone it does echo.
          record.zoneID !== undefined &&
          (!record.zoneID ||
            typeof record.zoneID !== "object" ||
            Array.isArray(record.zoneID) ||
            record.zoneID.zoneName !== "PrimarySync" ||
            record.zoneID.ownerRecordName !== primaryOwner)
        ) {
          reason = "iCloud returned an asset from a different library zone."
        } else if (
          typeof record.recordChangeTag !== "string" ||
          !record.recordChangeTag.trim()
        ) {
          reason = "iCloud omitted the current asset change tag."
        } else {
          const deletedFieldPresent = Object.prototype.hasOwnProperty.call(
            record.fields || {},
            "isDeleted"
          )
          const deletedValue = fieldValue(record, "isDeleted")
          const deletedState = normalizedDeletedState(deletedValue)
          if (
            (deletedFieldPresent && deletedState === undefined) ||
            deletedState === 1
          ) {
            reason = "The iCloud item is deleted or its active state is unknown."
          } else {
            const favorite = normalizeFavoriteValue(
              fieldValue(record, "isFavorite")
            )
            if (favorite === true) {
              reason = "The current iCloud item is a favorite and was protected."
            } else if (
              favorite === undefined &&
              !acknowledgedUnknownFavoriteDedupKeys.has(target.dedupKey)
            ) {
              reason =
                "The current iCloud favorite state is unknown; acknowledge it and retry."
            } else {
              candidates.push({
                ...target,
                ref: {
                  recordName: target.ref.recordName,
                  changeTag: record.recordChangeTag,
                  zoneName: "PrimarySync",
                  ownerRecordName: primaryOwner
                }
              })
            }
          }
        }
        if (reason) {
          outcomes.push({
            operation: "trash",
            targetKey: target.dedupKey,
            status: "failed",
            reason
          })
        }
      }

      if (candidates.length === 0) {
        postProgress(
          requestId,
          trashedDedupKeys.length,
          `No iCloud items in batch ${index + 1} were safe to trash.`,
          "trashItems",
          {
            trashedKeys: trashedKeys.slice(),
            trashedDedupKeys: trashedDedupKeys.slice(),
            icloudAssetRefs: postTrashRefs.slice(),
            outcomes: orderedOutcomes()
          }
        )
        continue
      }

      try {
        await assertIcloudMutationSession(args)
      } catch (error) {
        outcomes.push(
          ...mutationOutcomes("trash", candidates, "failed", String(error))
        )
        postProgress(
          requestId,
          trashedDedupKeys.length,
          `The iCloud account changed before batch ${index + 1} could be trashed.`,
          "trashItems",
          {
            trashedKeys: trashedKeys.slice(),
            trashedDedupKeys: trashedDedupKeys.slice(),
            icloudAssetRefs: postTrashRefs.slice(),
            outcomes: orderedOutcomes()
          }
        )
        break
      }

      const operations = candidates.map((target) => ({
        operationType: "update",
        record: {
          recordName: target.ref.recordName,
          recordChangeTag: target.ref.changeTag,
          recordType: "CPLAsset",
          fields: { isDeleted: { value: 1 } }
        }
      }))
      dispatchedChunk = candidates
      for (const target of candidates) dispatchedDedupKeys.add(target.dedupKey)
      const modifyRequest = postCloudKitModify(
        queryUrl,
        operations,
        zoneId,
        `Moving iCloud batch ${index + 1}`
      )
      postProgress(
        requestId,
        trashedDedupKeys.length,
        `Moving iCloud batch ${index + 1} of ${chunks.length}...`,
        "trashItems",
        {
          trashedKeys: trashedKeys.slice(),
          trashedDedupKeys: trashedDedupKeys.slice(),
          icloudAssetRefs: postTrashRefs.slice(),
          outcomes: orderedOutcomes()
        }
      )
      const data = await modifyRequest
      const responseOutcome = evaluateModifyResponse(data, candidates, 1, true)
      let chunkConfirmed = true
      for (const target of candidates) {
        const targetOutcome =
          responseOutcome.outcomesByDedupKey[target.dedupKey] || {
            status: "unknown",
            reason: responseOutcome.error
          }
        if (targetOutcome.status !== "confirmed") {
          chunkConfirmed = false
          outcomes.push({
            operation: "trash",
            targetKey: target.dedupKey,
            status: targetOutcome.status,
            ...(targetOutcome.reason ? { reason: targetOutcome.reason } : {})
          })
          continue
        }
        const updatedRef = responseOutcome.refsByRecordName[target.ref.recordName]
        if (!updatedRef) {
          chunkConfirmed = false
          outcomes.push({
            operation: "trash",
            targetKey: target.dedupKey,
            status: "unknown",
            reason: "iCloud omitted the refreshed asset reference."
          })
          continue
        }
        const updated = mergeUpdatedAssetRef(
          target.ref,
          updatedRef
        )
        trashedDedupKeys.push(target.dedupKey)
        trashedKeys.push(target.mediaKey)
        postTrashRefs.push(updated)
        outcomes.push({
          operation: "trash",
          targetKey: target.dedupKey,
          status: "confirmed"
        })
      }
      dispatchedChunk = null
      if (!chunkConfirmed) {
        throw new Error(responseOutcome.error)
      }
      postProgress(
        requestId,
        trashedDedupKeys.length,
        `Moved ${trashedDedupKeys.length} of ${dedupKeys.length} iCloud items to trash`,
        "trashItems",
        {
          trashedKeys: trashedKeys.slice(),
          trashedDedupKeys: trashedDedupKeys.slice(),
          icloudAssetRefs: postTrashRefs.slice(),
          outcomes: orderedOutcomes()
        }
      )
    }

    const notDispatchedDedupKeys = completeMutationOutcomeCoverage(
      "trash",
      targets,
      outcomes,
      dispatchedDedupKeys,
      "iCloud item was not dispatched because an earlier batch did not complete."
    )
    const resultData = {
      trashedCount: trashedDedupKeys.length,
      trashedKeys,
      trashedDedupKeys,
      icloudAssetRefs: postTrashRefs,
      outcomes: orderedOutcomes(),
      notDispatchedDedupKeys
    }
    if (outcomes.some((outcome) => outcome.status !== "confirmed")) {
      postError(
        "trashItems",
        requestId,
        "iCloud could not safely trash every selected item after rechecking its current state.",
        resultData
      )
    } else {
      postResult("trashItems", requestId, resultData)
    }
  } catch (error) {
    if (dispatchedChunk) {
      const status =
        error?.mutationOutcomeStatus === "failed" ? "failed" : "unknown"
      const existing = new Set(outcomes.map((outcome) => outcome.targetKey))
      outcomes.push(
        ...mutationOutcomes(
          "trash",
          dispatchedChunk.filter((target) => !existing.has(target.dedupKey)),
          status,
          String(error)
        )
      )
    }
    const notDispatchedDedupKeys = completeMutationOutcomeCoverage(
      "trash",
      targets,
      outcomes,
      dispatchedDedupKeys,
      "iCloud item was not dispatched because an earlier batch did not complete."
    )
    postError("trashItems", requestId, error, {
      partial: trashedDedupKeys.length > 0,
      trashedCount: trashedDedupKeys.length,
      trashedKeys: trashedKeys.slice(),
      trashedDedupKeys: trashedDedupKeys.slice(),
      icloudAssetRefs: postTrashRefs.slice(),
      outcomes,
      notDispatchedDedupKeys
    })
  }
}

// Recover = same records/modify with isDeleted: 0, reusing the post-trash asset
// refs returned by trashItems (changeTags are fresh as of the trash operation).
async function restoreItems(requestId, args) {
  const dedupKeys = Array.isArray(args?.dedupKeys) ? args.dedupKeys : []
  if (dedupKeys.length === 0 || new Set(dedupKeys).size !== dedupKeys.length) {
    const message = "iCloud restore requires dedupKeys."
    postError(
      "restoreItems",
      requestId,
      message,
      preflightMutationOutcomeData("restore", dedupKeys, message)
    )
    return
  }
  try {
    await assertIcloudMutationSession(args)
  } catch (error) {
    postError(
      "restoreItems",
      requestId,
      error,
      preflightMutationOutcomeData("restore", dedupKeys, String(error))
    )
    return
  }
  const refs = Array.isArray(args?.icloudAssetRefs) ? args.icloudAssetRefs : []
  if (refs.length !== dedupKeys.length) {
    const message =
      "iCloud restore metadata is missing. Recover the items manually from Recently Deleted in iCloud Photos."
    postError(
      "restoreItems",
      requestId,
      message,
      preflightMutationOutcomeData("restore", dedupKeys, message)
    )
    return
  }
  for (let index = 0; index < refs.length; index++) {
    const ref = refs[index]
    if (!ref || !ref.recordName || !ref.changeTag || !ref.ownerRecordName) {
      const message = `iCloud restore metadata for ${dedupKeys[index]} is missing. Recover the item manually from Recently Deleted in iCloud Photos.`
      postError(
        "restoreItems",
        requestId,
        message,
        preflightMutationOutcomeData("restore", dedupKeys, message)
      )
      return
    }
    if (
      typeof ref.recordName !== "string" ||
      !ref.recordName.trim() ||
      typeof ref.changeTag !== "string" ||
      !ref.changeTag.trim() ||
      ref.zoneName !== "PrimarySync" ||
      typeof ref.ownerRecordName !== "string" ||
      !ref.ownerRecordName.trim()
    ) {
      const message = `iCloud restore metadata for ${dedupKeys[index]} is not from the current personal PrimarySync library. Recover the item manually from Recently Deleted in iCloud Photos.`
      postError(
        "restoreItems",
        requestId,
        message,
        preflightMutationOutcomeData("restore", dedupKeys, message)
      )
      return
    }
  }
  if (new Set(refs.map((ref) => ref.recordName)).size !== refs.length) {
    const message =
      "iCloud restore metadata contains duplicate asset records. Recover the items manually from Recently Deleted in iCloud Photos."
    postError(
      "restoreItems",
      requestId,
      message,
      preflightMutationOutcomeData("restore", dedupKeys, message)
    )
    return
  }
  const primaryZoneName = refs[0].zoneName
  const primaryOwner = refs[0].ownerRecordName
  if (
    refs.some(
      (ref) =>
        ref.zoneName !== primaryZoneName ||
        ref.ownerRecordName !== primaryOwner
    )
  ) {
    const message =
      "iCloud restore only supports items from the same current personal PrimarySync library. Recover the items manually from Recently Deleted in iCloud Photos."
    postError(
      "restoreItems",
      requestId,
      message,
      preflightMutationOutcomeData("restore", dedupKeys, message)
    )
    return
  }

  const queryUrl = cloudKitQueryUrl()
  if (!queryUrl) {
    const message =
      "Cannot reach the iCloud Photos metadata service. Open iCloud Photos, wait for the library to load, and retry. Items can also be recovered from Recently Deleted."
    postError(
      "restoreItems",
      requestId,
      message,
      preflightMutationOutcomeData("restore", dedupKeys, message)
    )
    return
  }

  const zoneId = {
    zoneName: primaryZoneName,
    ownerRecordName: primaryOwner
  }
  const targets = dedupKeys.map((dedupKey, index) => ({
    dedupKey,
    ref: refs[index]
  }))
  const restoredDedupKeys = []
  const restoredAssetRefs = []
  const outcomes = []
  let dispatchedChunk = null
  const dispatchedDedupKeys = new Set()
  try {
    const chunks = chunkArray(targets, ICLOUD_MODIFY_BATCH_SIZE)
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index]
      await assertIcloudMutationSession(args)
      const operations = chunk.map((target) => ({
        operationType: "update",
        record: {
          recordName: target.ref.recordName,
          recordChangeTag: target.ref.changeTag,
          recordType: "CPLAsset",
          fields: { isDeleted: { value: 0 } }
        }
      }))
      dispatchedChunk = chunk
      for (const target of chunk) dispatchedDedupKeys.add(target.dedupKey)
      const modifyRequest = postCloudKitModify(
        queryUrl,
        operations,
        zoneId,
        `Restoring iCloud batch ${index + 1}`
      )
      postProgress(
        requestId,
        restoredDedupKeys.length,
        `Restoring iCloud batch ${index + 1} of ${chunks.length}...`,
        "restoreItems",
        {
          restoredDedupKeys: restoredDedupKeys.slice(),
          icloudAssetRefs: restoredAssetRefs.slice(),
          outcomes: outcomes.slice()
        }
      )
      const data = await modifyRequest
      await assertIcloudMutationSession(args)
      const responseOutcome = evaluateModifyResponse(data, chunk, 0, true)
      let chunkConfirmed = true
      for (const target of chunk) {
        const targetOutcome =
          responseOutcome.outcomesByDedupKey[target.dedupKey] || {
            status: "unknown",
            reason: responseOutcome.error
          }
        if (targetOutcome.status !== "confirmed") {
          chunkConfirmed = false
          outcomes.push({
            operation: "restore",
            targetKey: target.dedupKey,
            status: targetOutcome.status,
            ...(targetOutcome.reason ? { reason: targetOutcome.reason } : {})
          })
          continue
        }
        const updatedRef = responseOutcome.refsByRecordName[target.ref.recordName]
        if (!updatedRef) {
          chunkConfirmed = false
          outcomes.push({
            operation: "restore",
            targetKey: target.dedupKey,
            status: "unknown",
            reason: "iCloud omitted the refreshed asset reference."
          })
          continue
        }
        restoredDedupKeys.push(target.dedupKey)
        restoredAssetRefs.push(
          mergeUpdatedAssetRef(target.ref, updatedRef)
        )
        outcomes.push({
          operation: "restore",
          targetKey: target.dedupKey,
          status: "confirmed"
        })
      }
      dispatchedChunk = null
      if (!chunkConfirmed) {
        throw new Error(responseOutcome.error)
      }
      postProgress(
        requestId,
        restoredDedupKeys.length,
        `Restored ${restoredDedupKeys.length} of ${dedupKeys.length} iCloud items from trash`,
        "restoreItems",
        {
          restoredDedupKeys: restoredDedupKeys.slice(),
          icloudAssetRefs: restoredAssetRefs.slice(),
          outcomes: outcomes.slice()
        }
      )
    }

    const notDispatchedDedupKeys = completeMutationOutcomeCoverage(
      "restore",
      targets,
      outcomes,
      dispatchedDedupKeys,
      "iCloud item was not dispatched because an earlier batch did not complete."
    )
    postResult("restoreItems", requestId, {
      restoredCount: restoredDedupKeys.length,
      restoredDedupKeys,
      icloudAssetRefs: restoredAssetRefs,
      outcomes,
      notDispatchedDedupKeys
    })
  } catch (error) {
    if (dispatchedChunk) {
      const status =
        error?.mutationOutcomeStatus === "failed" ? "failed" : "unknown"
      const existing = new Set(outcomes.map((outcome) => outcome.targetKey))
      outcomes.push(
        ...mutationOutcomes(
          "restore",
          dispatchedChunk.filter((target) => !existing.has(target.dedupKey)),
          status,
          String(error)
        )
      )
    }
    const notDispatchedDedupKeys = completeMutationOutcomeCoverage(
      "restore",
      targets,
      outcomes,
      dispatchedDedupKeys,
      "iCloud item was not dispatched because an earlier batch did not complete."
    )
    postError("restoreItems", requestId, error, {
      partial: restoredDedupKeys.length > 0,
      restoredCount: restoredDedupKeys.length,
      restoredDedupKeys: restoredDedupKeys.slice(),
      icloudAssetRefs: restoredAssetRefs.slice(),
      outcomes,
      notDispatchedDedupKeys
    })
  }
}

async function healthCheck(requestId) {
  // iCloud Photos serves the library in a separate application frame. The
  // wrapper and application frame have different document sessions, so only
  // the application frame may bind health to later album and scan results.
  if (isTopIcloudShellWithAppFrame()) return

  const onIcloudPhotos = isIcloudPhotosLocation()
  const pageText = document.body?.innerText || ""
  const hasPublicSignInPrompt = Array.from(
    document.querySelectorAll("button, a")
  ).some((element) => /sign in/i.test(element.textContent || ""))
  const isPublicLandingPage =
    /Easily view and share your photos and videos stored in iCloud/i.test(
      pageText
    )
  const accountEmail = onIcloudPhotos
    ? await discoverIcloudAccountEmail()
    : ""
  if (accountEmail) {
    await commandHost.setProviderIdentity(accountEmail)
  } else {
    commandHost.requireCurrentDocumentSession()
  }
  const pageIsUsable =
    onIcloudPhotos && !hasPublicSignInPrompt && !isPublicLandingPage
  postResult("healthCheck", requestId, {
    hasGptk: pageIsUsable,
    accountEmail,
    health: createProviderHealth("icloud", {
      page: pageIsUsable,
      session: Boolean(commandHost.providerSessionId),
      readPath: pageIsUsable
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
  unsupportedMessage: (command) => `Unsupported iCloud command: ${command}`
})

console.log("GPD: iCloud command handler loaded")

})();
