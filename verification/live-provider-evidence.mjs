import { createHash } from "node:crypto"

const LIVE_PROVIDERS = new Set(["google", "icloud", "amazon"])
const LEGACY_READ_ONLY_SCENARIO_SCHEMA_VERSION = 2
export const READ_ONLY_SCENARIO_SCHEMA_VERSION = 3
const DESTRUCTIVE_ROUND_TRIP_SCHEMA_VERSION = 2
const TRUSTED_DEVTOOLS_INVENTORY_SOURCE = "chrome-devtools.list_extensions"
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/
const BUILD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0
}

function hasExpectedExactPackageIdentity(expectedBuildId, expectedArtifactSha256) {
  return (
    typeof expectedBuildId === "string" &&
    BUILD_ID_PATTERN.test(expectedBuildId) &&
    typeof expectedArtifactSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(expectedArtifactSha256)
  )
}

function uniqueStringArray(value) {
  return (
    Array.isArray(value) &&
    value.every(nonEmptyString) &&
    new Set(value).size === value.length
  )
}

function sha256String(value) {
  return createHash("sha256").update(value).digest("hex")
}

function sha256Array(value) {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && /^[a-f0-9]{64}$/.test(item)) &&
    new Set(value).size === value.length
  )
}

function sameStringSet(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value) => right.includes(value))
  )
}

function secureProviderTrashUrl(provider, value, supportedAmazonHosts) {
  if (typeof value !== "string") return null
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.username || url.password) return null

  if (provider === "google") {
    return url.hostname === "photos.google.com" &&
      /^\/trash(?:\/|$)/.test(url.pathname)
      ? url
      : null
  }
  if (provider === "amazon") {
    const allowedHosts = new Set(
      (Array.isArray(supportedAmazonHosts) ? supportedAmazonHosts : []).flatMap(
        (host) => [host, `www.${host}`]
      )
    )
    return (
      allowedHosts.has(url.hostname) &&
      /^\/photos\/trash(?:\/|$)/.test(url.pathname)
    )
      ? url
      : null
  }
  if (provider === "icloud") {
    const allowedHosts = new Set([
      "icloud.com",
      "www.icloud.com",
      "icloud.com.cn",
      "www.icloud.com.cn"
    ])
    return (
      allowedHosts.has(url.hostname) &&
      /^\/photos(?:\/|$)/.test(url.pathname) &&
      /^#\/recentlydeleted(?:\/|$)/.test(url.hash)
    )
      ? url
      : null
  }
  return null
}

function validateProviderTrashRoundTrip({
  roundTrip,
  deleteReport,
  supportedAmazonHosts = []
}) {
  const problems = []
  const require = (condition, message) => {
    if (!condition) problems.push(message)
  }
  const provider = roundTrip?.provider
  const trash = roundTrip?.trash
  const delta = trash?.providerTrashDelta
  const targetPhotoId = trash?.targetPhotoId
  const targetDedupKey = trash?.targetDedupKey
  const keeperPhotoId = trash?.keeperPhotoId
  const keeperDedupKey = trash?.keeperDedupKey
  const trashItems = Array.isArray(deleteReport?.items)
    ? deleteReport.items.filter((item) => item?.action === "trash")
    : []
  const selected = trashItems.length === 1 ? trashItems[0] : null
  const trashUrl = secureProviderTrashUrl(
    provider,
    trash?.providerTrashUrl,
    supportedAmazonHosts
  )

  require(
    trash?.providerTrashObserved === true && trashUrl !== null,
    "provider Trash URL does not match the selected provider's secure Trash route"
  )
  require(
    Number.isSafeInteger(trash?.selectedCount) && trash.selectedCount === 1,
    "provider Trash round trip must select exactly one synthetic item"
  )
  require(
    typeof targetPhotoId === "string" &&
      targetPhotoId.length > 0 &&
      typeof targetDedupKey === "string" &&
      targetDedupKey.length > 0 &&
      typeof keeperPhotoId === "string" &&
      keeperPhotoId.length > 0 &&
      typeof keeperDedupKey === "string" &&
      keeperDedupKey.length > 0 &&
      targetPhotoId !== keeperPhotoId &&
      targetDedupKey !== keeperDedupKey,
    "Trash target and keeper media and deduplication keys must be distinct"
  )
  require(
    deleteReport?.totalGroupsAffected === 1 &&
      deleteReport?.totalItemsKept === 1 &&
      deleteReport?.totalItemsSelectedForTrash === 1 &&
      trashItems.length === 1 &&
      selected?.mediaKey === targetPhotoId &&
      selected?.dedupKey === targetDedupKey,
    "Trash report does not bind the selected media and deduplication keys"
  )
  require(
    typeof selected?.mediaKind === "string" &&
      selected.mediaKind.length > 0 &&
      delta?.itemMediaKind === selected.mediaKind,
    "provider Trash delta media kind does not match the selected report row"
  )
  require(
    delta?.provider === provider &&
      typeof delta?.undoRestoredToBaseline === "boolean" &&
      delta.undoRestoredToBaseline === true,
    "provider Trash delta is not bound to this provider and a successful Undo"
  )

  if (provider === "google" || provider === "icloud") {
    const method =
      provider === "google"
        ? "google-photos-trash-item-id-delta"
        : "icloud-photos-recently-deleted-item-id-delta"
    const before = delta?.beforeItemIdSha256
    const after = delta?.afterItemIdSha256
    const afterUndo = delta?.afterUndoItemIdSha256
    const alias = trash?.providerTrashItemId
    const added =
      sha256Array(before) && sha256Array(after)
        ? after.filter((id) => !before.includes(id))
        : []
    const removed =
      sha256Array(before) && sha256Array(after)
        ? before.filter((id) => !after.includes(id))
        : []
    let trashRouteMatchesObservation = false
    if (trashUrl && typeof alias === "string" && alias.length > 0) {
      if (provider === "icloud") {
        // iCloud Photos uses a hash route for Recently Deleted; the item ID
        // is proven by the CloudKit before/after/Undo inventory delta above.
        trashRouteMatchesObservation = /^#\/recentlydeleted(?:\/|$)/.test(
          trashUrl.hash
        )
      } else {
        try {
          trashRouteMatchesObservation = trashUrl.pathname
            .split("/")
            .some((part) => decodeURIComponent(part) === alias)
        } catch {
          trashRouteMatchesObservation = false
        }
      }
    }

    require(
      delta?.method === method &&
        sha256Array(before) &&
        sha256Array(after) &&
        sha256Array(afterUndo) &&
        delta.beforeCount === before.length &&
        delta.afterCount === after.length &&
        delta.afterUndoCount === afterUndo.length,
      `${provider} Trash item-ID inventory is missing or inconsistent`
    )
    require(
      added.length === 1 &&
        removed.length === 0 &&
        delta.addedCount === 1 &&
        delta.removedCount === 0 &&
        sameStringSet(afterUndo, before),
      `${provider} Trash inventory must show one addition, no removals, and Undo to baseline`
    )
    require(
      typeof alias === "string" &&
        alias.length > 0 &&
        added.length === 1 &&
        sha256String(alias) === added[0] &&
        trashRouteMatchesObservation,
      `${provider === "google" ? "Google Photos" : "iCloud Photos"} Trash alias does not match the single added Trash item`
    )
  } else if (provider === "amazon") {
    const beforeCount = delta?.beforeCount
    const afterCount = delta?.afterCount
    const afterUndoCount = delta?.afterUndoCount
    require(
      delta?.method === "amazon-photos-trash-count-delta" &&
        Number.isSafeInteger(beforeCount) &&
        beforeCount >= 0 &&
        Number.isSafeInteger(afterCount) &&
        Number.isSafeInteger(afterUndoCount),
      "Amazon Photos Trash count evidence is missing or invalid"
    )
    require(
      afterCount === beforeCount + 1 &&
        afterUndoCount === beforeCount &&
        delta.selectedCount === 1,
      "Amazon Photos Trash must increase by one item and Undo must restore the baseline count"
    )
  } else {
    require(false, "destructive provider round trip uses an unsupported provider")
  }

  return { valid: problems.length === 0, problems }
}

function requireTrustedDevToolsInventory(require, runtime, trustedDevToolsInventory) {
  const extensionId = trustedDevToolsInventory?.extensionId
  const inventoryIsValid =
    trustedDevToolsInventory?.source === TRUSTED_DEVTOOLS_INVENTORY_SOURCE &&
    typeof extensionId === "string" &&
    EXTENSION_ID_PATTERN.test(extensionId)
  require(
    inventoryIsValid,
    "trusted DevTools extension inventory identity is missing or invalid"
  )
  require(
    !inventoryIsValid || runtime?.extensionId === extensionId,
    "runtime extension ID does not match the trusted DevTools inventory"
  )
}

function validateReadOnlyAlbumScenario({
  evidence,
  roundTrip,
  expectedExtensionVersion,
  expectedSourceFingerprint,
  expectedBuildId = undefined,
  expectedArtifactSha256 = undefined,
  trustedDevToolsInventory = undefined
}) {
  const problems = []
  const require = (condition, message) => {
    if (!condition) problems.push(message)
  }
  const scenario = roundTrip?.scenario
  const scope = roundTrip?.scope
  const album = roundTrip?.album
  const listing = album?.listing
  const membership = album?.membership
  const coverage = roundTrip?.coverage
  const runtime = roundTrip?.runtime
  const visitedIds = coverage?.visitedItemIds
  const returnedIds = coverage?.returnedItemIds
  const skippedIds = coverage?.skippedItemIds
  const visitedSet = new Set(Array.isArray(visitedIds) ? visitedIds : [])
  const returnedSet = new Set(Array.isArray(returnedIds) ? returnedIds : [])
  const skippedSet = new Set(Array.isArray(skippedIds) ? skippedIds : [])
  const countsAreIntegers = [
    coverage?.itemsVisited,
    coverage?.itemsReturned,
    coverage?.itemsSkipped,
    listing?.pagesVisited,
    membership?.pagesVisited,
    membership?.reportedItemCount
  ].every((value) => Number.isSafeInteger(value) && value >= 0)

  const packageIdentityRequired =
    roundTrip?.schemaVersion === READ_ONLY_SCENARIO_SCHEMA_VERSION ||
    expectedBuildId !== undefined ||
    expectedArtifactSha256 !== undefined
  require(
    roundTrip?.schemaVersion === READ_ONLY_SCENARIO_SCHEMA_VERSION ||
      (!packageIdentityRequired &&
        roundTrip?.schemaVersion === LEGACY_READ_ONLY_SCENARIO_SCHEMA_VERSION),
    packageIdentityRequired
      ? `read-only scenario schema version ${READ_ONLY_SCENARIO_SCHEMA_VERSION} is required for exact package identity binding`
      : `read-only scenario schema version must be ${READ_ONLY_SCENARIO_SCHEMA_VERSION}`
  )
  require(scenario?.kind === "read-only-album-scan" &&
    scenario?.destructive === false &&
    nonEmptyString(
      scenario?.id
    ), "scenario must be a named non-destructive album scan")
  require(LIVE_PROVIDERS.has(
    roundTrip?.provider
  ), "scenario provider is missing or unsupported")
  require(evidence?.syntheticOnly ===
    true, "fixture is not marked synthetic-only")
  require(evidence?.scenarioId ===
    scenario?.id, "scenario ID does not match the fixture record")
  require(evidence?.provider ===
    roundTrip?.provider, "scenario provider does not match the fixture record")
  require(nonEmptyString(evidence?.account) &&
    roundTrip?.account ===
      evidence.account, "scenario account does not match the disposable fixture account")
  require(nonEmptyString(roundTrip?.sessionId) &&
    roundTrip.sessionId === evidence?.sessionId &&
    scope?.sessionId ===
      roundTrip.sessionId, "scope is not bound to the recorded provider session")
  require(scope?.kind === "album" &&
    scope?.provider === roundTrip?.provider &&
    nonEmptyString(scope?.albumId) &&
    scope.albumId === evidence?.albumId &&
    album?.id ===
      scope.albumId, "album scope is not bound to the provider, session, and fixture album")
  const fixtureRequestsTrustedRuntimeIdentity =
    evidence?.extensionId === null &&
    evidence?.extensionBinding === "trusted-devtools"
  const fixtureUsesTrustedRuntimeIdentity =
    packageIdentityRequired &&
    fixtureRequestsTrustedRuntimeIdentity &&
    hasExpectedExactPackageIdentity(expectedBuildId, expectedArtifactSha256)
  require(
    !fixtureRequestsTrustedRuntimeIdentity ||
      fixtureUsesTrustedRuntimeIdentity,
    "dynamic fixture identity requires expected package build ID and artifact SHA-256"
  )
  require(nonEmptyString(runtime?.extensionId) &&
    (runtime.extensionId === evidence?.extensionId ||
      fixtureUsesTrustedRuntimeIdentity),
  "runtime extension ID does not match the fixture record")
  require(runtime?.packageVersion ===
    expectedExtensionVersion, "runtime extension version does not match the current manifest")
  require(runtime?.sourceFingerprint ===
    expectedSourceFingerprint, "runtime source fingerprint does not match the current source")
  if (packageIdentityRequired) {
    // The verifier receives this from a trusted Chrome DevTools inventory as
    // a separate input; never derive it from the copied round-trip JSON.
    requireTrustedDevToolsInventory(require, runtime, trustedDevToolsInventory)
    require(
      typeof runtime?.buildId === "string" &&
        BUILD_ID_PATTERN.test(runtime.buildId),
      "runtime package build ID is missing or invalid"
    )
    require(
      typeof roundTrip?.artifactSha256 === "string" &&
        /^[a-f0-9]{64}$/.test(roundTrip.artifactSha256),
      "live evidence package artifact SHA-256 is missing or invalid"
    )
    require(
      expectedBuildId === undefined || runtime?.buildId === expectedBuildId,
      "runtime build ID does not match the current package metadata"
    )
    require(
      expectedArtifactSha256 === undefined ||
        (/^[a-f0-9]{64}$/.test(expectedArtifactSha256) &&
          roundTrip?.artifactSha256 === expectedArtifactSha256),
      "live evidence artifact SHA-256 does not match the current package metadata"
    )
  }
  require(album?.classification === "personal" &&
    album?.shared === false &&
    listing?.albumFound ===
      true, "scenario does not prove discovery of the selected personal album")
  require(countsAreIntegers &&
    listing.pagesVisited > 0 &&
    membership.pagesVisited >
      0, "album listing, membership, or coverage counts are missing")
  require(uniqueStringArray(
    membership?.itemIds
  ), "album membership IDs are missing, invalid, or duplicated")
  require(uniqueStringArray(visitedIds) &&
    uniqueStringArray(returnedIds) &&
    uniqueStringArray(
      skippedIds
    ), "coverage item ID sets are missing, invalid, or duplicated")
  require(countsAreIntegers &&
    coverage.itemsVisited === coverage.itemsReturned + coverage.itemsSkipped &&
    coverage.itemsVisited === visitedIds?.length &&
    coverage.itemsReturned === returnedIds?.length &&
    coverage.itemsSkipped ===
      skippedIds?.length, "visited items must equal returned plus skipped items")
  require([...returnedSet, ...skippedSet].length === visitedSet.size &&
    [...visitedSet].every((id) => returnedSet.has(id) || skippedSet.has(id)) &&
    [...returnedSet].every(
      (id) => !skippedSet.has(id)
    ), "returned and skipped IDs must partition the visited IDs")
  require(uniqueStringArray(coverage?.unknownDateItemIds ?? []) &&
    Array.isArray(coverage?.unknownDateItemIds ?? []) &&
    Number.isSafeInteger(coverage?.unknownDateItemsSkipped ?? 0) &&
    (coverage?.unknownDateItemsSkipped ?? 0) >= 0 &&
    (coverage?.unknownDateItemIds ?? []).every((id) => skippedSet.has(id)) &&
    (coverage?.unknownDateItemIds ?? []).length ===
      (coverage?.unknownDateItemsSkipped ??
        0), "unknown-date skips must be a subset of skipped IDs")

  const listingExhausted = listing?.cursorExhausted === true
  const membershipExhausted = membership?.cursorExhausted === true
  const exhausted = listingExhausted && membershipExhausted
  const complete = coverage?.complete === true
  require(typeof listing?.cursorExhausted === "boolean" &&
    typeof membership?.cursorExhausted === "boolean" &&
    typeof coverage?.complete === "boolean" &&
    nonEmptyString(
      coverage?.stopReason
    ), "listing, membership, and coverage completion states are required")
  require(!complete ||
    (exhausted &&
      coverage?.stopReason ===
        "exhausted"), "complete scenario evidence must prove listing and membership exhaustion")
  require(!membershipExhausted ||
    membership?.reportedItemCount ===
      membership?.itemIds
        ?.length, "exhausted membership count does not match the enumerated item IDs")
  require(!complete ||
    (coverage?.itemsVisited === membership?.reportedItemCount &&
      coverage.itemsVisited === membership?.itemIds?.length &&
      membership.itemIds.every((id) =>
        visitedSet.has(id)
      )), "complete album scan does not cover the exact enumerated membership")
  require(roundTrip?.status === "PASS" ||
    roundTrip?.status === "PARTIAL", "scenario status must be PASS or PARTIAL")
  require(roundTrip?.status !== "PASS" ||
    complete, "PASS scenario evidence must be complete and exhausted")
  require(roundTrip?.status !== "PARTIAL" ||
    !complete, "PARTIAL scenario evidence cannot claim complete coverage")
  require(roundTrip?.mutation?.attempted === false &&
    !Object.hasOwn(roundTrip ?? {}, "trash") &&
    !Object.hasOwn(
      roundTrip ?? {},
      "restore"
    ), "read-only album evidence must not include a mutation or restore")

  const valid = problems.length === 0
  return {
    valid,
    status: valid ? roundTrip.status : "BLOCKED",
    problems
  }
}

export function validateLiveProviderBinding({
  evidence,
  roundTrip,
  deleteReport = undefined,
  supportedAmazonHosts = [],
  expectedExtensionVersion,
  expectedSourceFingerprint,
  expectedBuildId = undefined,
  expectedArtifactSha256 = undefined,
  trustedDevToolsInventory = undefined
}) {
  if (
    (roundTrip?.schemaVersion === LEGACY_READ_ONLY_SCENARIO_SCHEMA_VERSION ||
      roundTrip?.schemaVersion === READ_ONLY_SCENARIO_SCHEMA_VERSION) &&
    roundTrip?.scenario?.kind === "read-only-album-scan"
  ) {
    return validateReadOnlyAlbumScenario({
      evidence,
      roundTrip,
      expectedExtensionVersion,
      expectedSourceFingerprint,
      expectedBuildId,
      expectedArtifactSha256,
      trustedDevToolsInventory
    })
  }

  const problems = []
  const require = (condition, message) => {
    if (!condition) problems.push(message)
  }

  const runtime = roundTrip?.runtime
  const targetId = roundTrip?.trash?.targetPhotoId
  const targetDedupKey = roundTrip?.trash?.targetDedupKey
  const keeperId = roundTrip?.trash?.keeperPhotoId
  const keeperDedupKey = roundTrip?.trash?.keeperDedupKey
  const assetIds = roundTrip?.disposableAssetIds
  const uniqueAssetIds = Array.isArray(assetIds)
    ? assetIds.filter((value) => typeof value === "string" && value.length > 0)
    : []
  const uniqueAssetIdSet = new Set(uniqueAssetIds)

  const packageIdentityRequired =
    expectedBuildId !== undefined || expectedArtifactSha256 !== undefined
  require(
    roundTrip?.schemaVersion ===
      (packageIdentityRequired ? DESTRUCTIVE_ROUND_TRIP_SCHEMA_VERSION : 1),
    packageIdentityRequired
      ? `destructive round-trip schema version must be ${DESTRUCTIVE_ROUND_TRIP_SCHEMA_VERSION} for exact package identity binding`
      : "destructive round-trip schema version must be 1"
  )
  require(evidence?.syntheticOnly ===
    true, "fixture is not marked synthetic-only")
  require(typeof evidence?.account === "string" &&
    evidence.account.length >
      0, "disposable provider account identity is missing")
  require(typeof evidence?.albumUrl === "string" &&
    evidence.albumUrl.length >
      0, "disposable provider scope identity is missing")
  require(typeof runtime?.extensionId === "string" &&
    runtime.extensionId.length > 0, "runtime extension ID is missing")
  const fixtureRequestsTrustedRuntimeIdentity =
    evidence?.extensionId === null &&
    evidence?.extensionBinding === "trusted-devtools"
  const fixtureUsesTrustedRuntimeIdentity =
    packageIdentityRequired &&
    fixtureRequestsTrustedRuntimeIdentity &&
    hasExpectedExactPackageIdentity(expectedBuildId, expectedArtifactSha256)
  require(
    !fixtureRequestsTrustedRuntimeIdentity ||
      fixtureUsesTrustedRuntimeIdentity,
    "dynamic fixture identity requires expected package build ID and artifact SHA-256"
  )
  require(
    runtime?.extensionId === evidence?.extensionId ||
      fixtureUsesTrustedRuntimeIdentity,
    "runtime extension ID does not match the fixture record"
  )
  require(runtime?.packageVersion ===
    expectedExtensionVersion, "runtime extension version does not match the current manifest")
  require(runtime?.sourceFingerprint ===
    expectedSourceFingerprint, "runtime source fingerprint does not match the current source")
  if (packageIdentityRequired) {
    // Current exact-package evidence requires an identity acquired outside
    // both evidence JSON records. The package manifest in this project has no
    // public key from which its Chrome extension ID can be derived.
    requireTrustedDevToolsInventory(require, runtime, trustedDevToolsInventory)
    require(
      typeof runtime?.buildId === "string" &&
        BUILD_ID_PATTERN.test(runtime.buildId),
      "runtime package build ID is missing or invalid"
    )
    require(
      typeof roundTrip?.artifactSha256 === "string" &&
        /^[a-f0-9]{64}$/.test(roundTrip.artifactSha256),
      "live evidence package artifact SHA-256 is missing or invalid"
    )
    require(
      expectedBuildId === undefined || runtime?.buildId === expectedBuildId,
      "runtime build ID does not match the current package metadata"
    )
    require(
      expectedArtifactSha256 === undefined ||
        (/^[a-f0-9]{64}$/.test(expectedArtifactSha256) &&
          roundTrip?.artifactSha256 === expectedArtifactSha256),
      "live evidence artifact SHA-256 does not match the current package metadata"
    )
  }
  require(roundTrip?.account ===
    evidence?.account, "round-trip account does not match the disposable fixture account")
  require(roundTrip?.albumUrl ===
    evidence?.albumUrl, "round-trip scope does not match the disposable fixture scope")
  require(Number.isSafeInteger(evidence?.itemCount) &&
    evidence.itemCount > 0 &&
    uniqueAssetIds.length === evidence.itemCount &&
    uniqueAssetIdSet.size ===
      evidence.itemCount, "round-trip must enumerate each disposable asset ID exactly once")
  const targetIsInAssetInventory =
    uniqueAssetIdSet.has(targetId) ||
    (packageIdentityRequired && uniqueAssetIdSet.has(targetDedupKey))
  const keeperIsInAssetInventory =
    uniqueAssetIdSet.has(keeperId) ||
    (packageIdentityRequired && uniqueAssetIdSet.has(keeperDedupKey))
  require(typeof targetId === "string" &&
    targetId.length > 0 &&
    targetIsInAssetInventory, "Trash target is not in the disposable asset inventory")
  require(typeof keeperId === "string" &&
    keeperId.length > 0 &&
    keeperIsInAssetInventory &&
    keeperId !== targetId &&
    (!packageIdentityRequired ||
      (typeof targetDedupKey === "string" &&
        typeof keeperDedupKey === "string" &&
        targetDedupKey !== keeperDedupKey)), "keeper is not a distinct item in the disposable asset inventory")

  if (packageIdentityRequired) {
    const providerTrashBinding = validateProviderTrashRoundTrip({
      roundTrip,
      deleteReport,
      supportedAmazonHosts
    })
    problems.push(...providerTrashBinding.problems)
  }

  return {
    valid: problems.length === 0,
    problems
  }
}
