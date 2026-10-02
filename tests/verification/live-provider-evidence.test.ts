import { describe, expect, it } from "vitest"

import {
  READ_ONLY_SCENARIO_SCHEMA_VERSION,
  validateLiveProviderBinding
} from "../../verification/live-provider-evidence.mjs"

const trustedExtensionId = "abcdefghijklmnopabcdefghijklmnop"
const mismatchedTrustedExtensionId = "pppppppppppppppppppppppppppppppp"
const trustedDevToolsInventory = {
  source: "chrome-devtools.list_extensions",
  extensionId: trustedExtensionId
}

function validEvidence() {
  const disposableAssetIds = [
    "asset-a",
    "asset-b",
    "asset-c",
    "asset-d",
    "asset-e",
    "asset-f"
  ]
  return {
    evidence: {
      syntheticOnly: true,
      itemCount: disposableAssetIds.length,
      account: "synthetic-test-account",
      albumUrl: "https://provider.example/disposable-album",
      extensionId: trustedExtensionId
    },
    roundTrip: {
      account: "synthetic-test-account",
      albumUrl: "https://provider.example/disposable-album",
      runtime: {
        extensionId: trustedExtensionId,
        packageVersion: "2.3.0.2",
        sourceFingerprint: "current-source-sha256"
      },
      schemaVersion: 1,
      disposableAssetIds,
      trash: {
        targetPhotoId: "asset-a",
        keeperPhotoId: "asset-b"
      }
    },
    expectedExtensionVersion: "2.3.0.2",
    expectedSourceFingerprint: "current-source-sha256"
  }
}

function validEmptyAlbumScenario() {
  const sessionId = "opaque-provider-session-7b2f"
  const albumId = "synthetic-empty-album"
  const buildId = "123e4567-e89b-42d3-a456-426614174000"
  const artifactSha256 = "a".repeat(64)
  return {
    evidence: {
      syntheticOnly: true,
      scenarioId: "icloud-empty-personal-album",
      provider: "icloud",
      account: "synthetic-test-account",
      sessionId,
      albumId,
      extensionId: trustedExtensionId
    },
    roundTrip: {
      schemaVersion: READ_ONLY_SCENARIO_SCHEMA_VERSION,
      status: "PASS",
      scenario: {
        id: "icloud-empty-personal-album",
        kind: "read-only-album-scan",
        destructive: false
      },
      provider: "icloud",
      account: "synthetic-test-account",
      sessionId,
      scope: { kind: "album", provider: "icloud", sessionId, albumId },
      runtime: {
        extensionId: trustedExtensionId,
        packageVersion: "2.3.0.2",
        sourceFingerprint: "current-source-sha256",
        buildId
      },
      artifactSha256,
      album: {
        id: albumId,
        classification: "personal",
        shared: false,
        listing: { pagesVisited: 1, cursorExhausted: true, albumFound: true },
        membership: {
          pagesVisited: 1,
          cursorExhausted: true,
          reportedItemCount: 0,
          itemIds: []
        }
      },
      coverage: {
        complete: true,
        stopReason: "exhausted",
        itemsVisited: 0,
        itemsReturned: 0,
        itemsSkipped: 0,
        visitedItemIds: [],
        returnedItemIds: [],
        skippedItemIds: [],
        unknownDateItemsSkipped: 0,
        unknownDateItemIds: []
      },
      mutation: { attempted: false }
    },
    expectedExtensionVersion: "2.3.0.2",
    expectedSourceFingerprint: "current-source-sha256",
    expectedBuildId: buildId,
    expectedArtifactSha256: artifactSha256,
    trustedDevToolsInventory: { ...trustedDevToolsInventory }
  }
}

describe("live provider evidence binding", () => {
  it("[PARITY-06] accepts a disposable round trip bound to this source and build", () => {
    expect(validateLiveProviderBinding(validEvidence())).toEqual({
      valid: true,
      problems: []
    })
  })

  it("[PARITY-06] rejects a previous extension version or source fingerprint", () => {
    const input = validEvidence()
    input.roundTrip.runtime.packageVersion = "2.2.8"
    input.roundTrip.runtime.sourceFingerprint = "old-source-sha256"

    const result = validateLiveProviderBinding(input)

    expect(result.valid).toBe(false)
    expect(result.problems).toContain(
      "runtime extension version does not match the current manifest"
    )
    expect(result.problems).toContain(
      "runtime source fingerprint does not match the current source"
    )
  })

  it("[PARITY-06] rejects mismatched fixture identities and asset inventories", () => {
    const input = validEvidence()
    input.roundTrip.account = "another-account"
    input.roundTrip.albumUrl = "https://provider.example/another-album"
    input.roundTrip.disposableAssetIds[0] = "asset-b"
    input.roundTrip.trash.targetPhotoId = "outside-fixture"
    input.roundTrip.trash.keeperPhotoId = "asset-a"

    const result = validateLiveProviderBinding(input)

    expect(result.valid).toBe(false)
    expect(result.problems).toContain(
      "round-trip account does not match the disposable fixture account"
    )
    expect(result.problems).toContain(
      "round-trip scope does not match the disposable fixture scope"
    )
    expect(result.problems).toContain(
      "round-trip must enumerate each disposable asset ID exactly once"
    )
    expect(result.problems).toContain(
      "Trash target is not in the disposable asset inventory"
    )
  })

  it("[PARITY-06] accepts an exhausted empty personal album as read-only evidence", () => {
    const input = validEmptyAlbumScenario()

    expect(validateLiveProviderBinding(input)).toEqual({
      valid: true,
      status: "PASS",
      problems: []
    })
  })

  it("[PARITY-08] blocks matching copied runtime and fixture IDs without an independent DevTools inventory", () => {
    const input = validEmptyAlbumScenario()
    const result = validateLiveProviderBinding({ ...input, trustedDevToolsInventory: undefined })

    expect(input.roundTrip.runtime.extensionId).toBe(input.evidence.extensionId)
    expect(result.valid).toBe(false)
    expect(result.problems).toContain(
      "trusted DevTools extension inventory identity is missing or invalid"
    )
  })

  it("[PARITY-08] rejects a runtime identity that conflicts with the independent DevTools inventory", () => {
    const input = validEmptyAlbumScenario()
    input.trustedDevToolsInventory.extensionId = mismatchedTrustedExtensionId

    const result = validateLiveProviderBinding(input)

    expect(result.valid).toBe(false)
    expect(result.problems).toContain(
      "runtime extension ID does not match the trusted DevTools inventory"
    )
  })

  it("[PARITY-06] binds complete multi-page listing and membership to the scanned IDs", () => {
    const input = validEmptyAlbumScenario()
    input.roundTrip.album.listing.pagesVisited = 3
    input.roundTrip.album.membership.pagesVisited = 2
    input.roundTrip.album.membership.reportedItemCount = 2
    input.roundTrip.album.membership.itemIds = ["asset-a", "asset-b"]
    input.roundTrip.coverage = {
      complete: true,
      stopReason: "exhausted",
      itemsVisited: 2,
      itemsReturned: 1,
      itemsSkipped: 1,
      visitedItemIds: ["asset-a", "asset-b"],
      returnedItemIds: ["asset-a"],
      skippedItemIds: ["asset-b"],
      unknownDateItemsSkipped: 1,
      unknownDateItemIds: ["asset-b"]
    }

    expect(validateLiveProviderBinding(input)).toEqual({
      valid: true,
      status: "PASS",
      problems: []
    })
  })

  it("[PARITY-06] does not accept a PASS when album membership pagination is incomplete", () => {
    const input = validEmptyAlbumScenario()
    input.roundTrip.album.membership.cursorExhausted = false

    const result = validateLiveProviderBinding(input)

    expect(result.valid).toBe(false)
    expect(result.status).toBe("BLOCKED")
    expect(result.problems).toContain(
      "complete scenario evidence must prove listing and membership exhaustion"
    )
  })

  it("[PARITY-06] preserves a well-bound incomplete scan as PARTIAL", () => {
    const input = validEmptyAlbumScenario()
    input.roundTrip.status = "PARTIAL"
    input.roundTrip.album.membership.cursorExhausted = false
    input.roundTrip.album.membership.reportedItemCount = 1
    input.roundTrip.album.membership.itemIds = ["asset-a"]
    input.roundTrip.coverage = {
      complete: false,
      stopReason: "visit_limit",
      itemsVisited: 1,
      itemsReturned: 1,
      itemsSkipped: 0,
      visitedItemIds: ["asset-a"],
      returnedItemIds: ["asset-a"],
      skippedItemIds: [],
      unknownDateItemsSkipped: 0,
      unknownDateItemIds: []
    }

    expect(validateLiveProviderBinding(input)).toEqual({
      valid: true,
      status: "PARTIAL",
      problems: []
    })
  })

  it("[PARITY-06] rejects changed session scope, unpartitioned counts, and mutations", () => {
    const input = validEmptyAlbumScenario()
    input.roundTrip.scope.sessionId = "another-session"
    input.roundTrip.coverage.itemsReturned = 1
    ;(input.roundTrip as typeof input.roundTrip & {
      trash: { targetPhotoId: string }
    }).trash = { targetPhotoId: "asset-a" }

    const result = validateLiveProviderBinding(input)

    expect(result.valid).toBe(false)
    expect(result.status).toBe("BLOCKED")
    expect(result.problems).toContain(
      "scope is not bound to the recorded provider session"
    )
    expect(result.problems).toContain(
      "visited items must equal returned plus skipped items"
    )
    expect(result.problems).toContain(
      "read-only album evidence must not include a mutation or restore"
    )
  })

  it("[PARITY-08] rejects a runtime build ID or ZIP digest from another package", () => {
    const input = validEmptyAlbumScenario()
    input.roundTrip.runtime.buildId = "123e4567-e89b-42d3-a456-426614174001"
    input.roundTrip.artifactSha256 = "b".repeat(64)

    const result = validateLiveProviderBinding(input)

    expect(result.valid).toBe(false)
    expect(result.problems).toContain(
      "runtime build ID does not match the current package metadata"
    )
    expect(result.problems).toContain(
      "live evidence artifact SHA-256 does not match the current package metadata"
    )
  })

  it("[PARITY-08] requires package provenance for current schema-v3 evidence", () => {
    const input = validEmptyAlbumScenario()
    delete (input.roundTrip.runtime as Record<string, unknown>).buildId
    delete (input.roundTrip as Record<string, unknown>).artifactSha256

    const result = validateLiveProviderBinding({
      ...input,
      expectedBuildId: "123e4567-e89b-42d3-a456-426614174000",
      expectedArtifactSha256: "a".repeat(64)
    })

    expect(result.valid).toBe(false)
    expect(result.problems).toContain(
      "runtime build ID does not match the current package metadata"
    )
    expect(result.problems).toContain(
      "live evidence artifact SHA-256 does not match the current package metadata"
    )
  })

  it("[PARITY-08] requires DevTools inventory identity for current destructive package evidence", () => {
    const input = validEvidence()
    const artifactSha256 = "a".repeat(64)
    input.roundTrip.schemaVersion = 2
    const runtime = input.roundTrip.runtime as Record<string, unknown>
    const roundTrip = input.roundTrip as Record<string, unknown>
    runtime.buildId = "123e4567-e89b-42d3-a456-426614174000"
    roundTrip.artifactSha256 = artifactSha256

    const result = validateLiveProviderBinding({
      ...input,
      expectedBuildId: "123e4567-e89b-42d3-a456-426614174000",
      expectedArtifactSha256: artifactSha256
    })

    expect(result.valid).toBe(false)
    expect(result.problems).toContain(
      "trusted DevTools extension inventory identity is missing or invalid"
    )
  })

  it("[PARITY-08] keeps schema-v2 observations historical when no package metadata is expected", () => {
    const legacyInput = { ...validEmptyAlbumScenario() }
    delete (legacyInput as unknown as Record<string, unknown>).expectedBuildId
    delete (legacyInput as unknown as Record<string, unknown>).expectedArtifactSha256
    legacyInput.roundTrip.schemaVersion = 2
    delete (legacyInput.roundTrip as Record<string, unknown>).artifactSha256
    delete (legacyInput.roundTrip.runtime as Record<string, unknown>).buildId

    expect(validateLiveProviderBinding(legacyInput)).toEqual({
      valid: true,
      status: "PASS",
      problems: []
    })
  })

  it("[PARITY-06] rejects a complete scan whose IDs do not match album membership", () => {
    const input = validEmptyAlbumScenario()
    input.roundTrip.album.membership.itemIds = ["provider-member"]
    input.roundTrip.album.membership.reportedItemCount = 1
    input.roundTrip.coverage.itemsVisited = 1
    input.roundTrip.coverage.itemsReturned = 1
    input.roundTrip.coverage.visitedItemIds = ["scan-result"]
    input.roundTrip.coverage.returnedItemIds = ["scan-result"]

    const result = validateLiveProviderBinding(input)

    expect(result.valid).toBe(false)
    expect(result.problems).toContain(
      "complete album scan does not cover the exact enumerated membership"
    )
  })

  it("[PARITY-06] keeps destructive evidence strict when an empty fixture has no target or keeper", () => {
    const input = validEvidence()
    input.evidence.itemCount = 0
    input.roundTrip.disposableAssetIds = []
    input.roundTrip.trash.targetPhotoId = undefined
    input.roundTrip.trash.keeperPhotoId = undefined

    const result = validateLiveProviderBinding(input)

    expect(result.valid).toBe(false)
    expect(result.problems).toContain(
      "round-trip must enumerate each disposable asset ID exactly once"
    )
    expect(result.problems).toContain(
      "Trash target is not in the disposable asset inventory"
    )
    expect(result.problems).toContain(
      "keeper is not a distinct item in the disposable asset inventory"
    )
  })
})
