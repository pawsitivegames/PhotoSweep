const LIVE_PROVIDERS = new Set(["google", "icloud", "amazon"])
const LEGACY_READ_ONLY_SCENARIO_SCHEMA_VERSION = 2
export const READ_ONLY_SCENARIO_SCHEMA_VERSION = 3
const DESTRUCTIVE_ROUND_TRIP_SCHEMA_VERSION = 2
const TRUSTED_DEVTOOLS_INVENTORY_SOURCE = "chrome-devtools.list_extensions"
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0
}

function uniqueStringArray(value) {
  return (
    Array.isArray(value) &&
    value.every(nonEmptyString) &&
    new Set(value).size === value.length
  )
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
  require(runtime?.extensionId === evidence?.extensionId &&
    nonEmptyString(
      runtime?.extensionId
    ), "runtime extension ID does not match the fixture record")
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
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          runtime.buildId
        ),
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
  const keeperId = roundTrip?.trash?.keeperPhotoId
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
  require(runtime?.extensionId ===
    evidence?.extensionId, "runtime extension ID does not match the fixture record")
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
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          runtime.buildId
        ),
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
  require(typeof targetId === "string" &&
    uniqueAssetIdSet.has(
      targetId
    ), "Trash target is not in the disposable asset inventory")
  require(typeof keeperId === "string" &&
    uniqueAssetIdSet.has(keeperId) &&
    keeperId !==
      targetId, "keeper is not a distinct item in the disposable asset inventory")

  return {
    valid: problems.length === 0,
    problems
  }
}
