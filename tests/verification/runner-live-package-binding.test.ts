import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"

import {
  createCwsArtifactMetadata,
  cwsArtifactFileName,
  cwsArtifactMetadataFileName,
  validateCwsArtifactMetadata
} from "../../tools/cws-artifact.mjs"
import { validateLiveProviderBinding } from "../../verification/live-provider-evidence.mjs"

const runnerPath = resolve("verification/verification-runner.mjs")
const fingerprint = "a".repeat(64)
const buildId = "123e4567-e89b-42d3-a456-426614174000"
const trustedExtensionId = "abcdefghijklmnopabcdefghijklmnop"
const chromeVersion = "2.3.0.3"
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")

// Exercise the actual CLI's private gate without running the entire release
// pipeline or creating/installing an extension. No validation is reimplemented.
function runnerGates(root: string, trustedDevToolsExtensionId?: string) {
  const source = readFileSync(runnerPath, "utf8")
  const start = source.indexOf("function makeBlockedArtifact(")
  const end = source.indexOf("function writeEvidenceArtifact(", start)
  if (start < 0 || end < 0) throw new Error("Runner gate source boundaries are missing")
  return runInNewContext(
    `${source.slice(start, end)}\n({ currentPackageBinding, liveProviderArtifact })`,
    {
      root,
      process: {
        env: trustedDevToolsExtensionId
          ? { PHOTOSWEEP_TRUSTED_DEVTOOLS_EXTENSION_ID: trustedDevToolsExtensionId }
          : {}
      },
      sourceFingerprint: { digest: fingerprint, fileCount: 1 },
      existsSync,
      readFileSync,
      resolve,
      relative,
      join,
      sha256File: (path: string) => sha256(readFileSync(path)),
      cwsArtifactFileName,
      cwsArtifactMetadataFileName,
      validateCwsArtifactMetadata,
      validateLiveProviderBinding
    }
  )
}

function syntheticPackageFixture(root: string) {
  const manifest = JSON.stringify({ manifest_version: 3, version: chromeVersion })
  const zipBytes = Buffer.from("synthetic package bytes; this test proves gate binding only")
  const artifactSha256 = sha256(zipBytes)
  const artifactName = cwsArtifactFileName(chromeVersion, artifactSha256)
  mkdirSync(join(root, "build/chrome-mv3-prod"), { recursive: true })
  writeFileSync(join(root, "build/chrome-mv3-prod/manifest.json"), manifest)
  writeFileSync(join(root, "build/chrome-mv3-prod.zip"), zipBytes)
  writeFileSync(join(root, "build", artifactName), zipBytes)
  const metadata = createCwsArtifactMetadata({
    appVersion: "2.3.0",
    chromeVersion,
    artifactFile: join("build", artifactName),
    artifactSha256,
    manifestSha256: sha256(manifest),
    sourceCommit: "b".repeat(40),
    sourceDirty: true,
    sourceStatusSha256: "c".repeat(64),
    trackedDiffSha256: "d".repeat(64),
    sourceFingerprint: fingerprint,
    sourceFileCount: 1,
    buildId,
    builtAt: "2026-09-30T12:00:00.000Z"
  })
  writeFileSync(join(root, "build", cwsArtifactMetadataFileName(artifactName)), JSON.stringify(metadata))

  const disposableAssetIds = ["target", "keeper", "control-a", "control-b", "pair-b-a", "pair-b-b"]
  const roundTrip = {
    schemaVersion: 2,
    status: "PASS",
    provider: "google",
    account: "synthetic-account",
    albumUrl: "https://provider.example/synthetic-album",
    runtime: { extensionId: trustedExtensionId, packageVersion: chromeVersion, sourceFingerprint: fingerprint, buildId },
    artifactSha256,
    disposableAssetIds,
    preAction: { itemCount: 6, allItemsSynthetic: true, scanStatus: "Done", checkedCount: 6, controlsSelected: false, pairBSelected: false },
    trash: { selectedCount: 1, targetPhotoId: "target", keeperPhotoId: "keeper", providerTrashObserved: true, providerTrashItemId: "target", deleteReport: join(root, "delete-report.json") },
    restore: { method: "PhotoSweep Undo", albumItemCountAfterUndo: 6, targetReappearedInAlbum: true, keeperPreserved: true, controlsPreserved: true, freshScanStatus: "Done", freshCheckedCount: 6 },
    noPermanentDelete: true
  }
  writeFileSync(join(root, "inventory.json"), JSON.stringify(disposableAssetIds))
  writeFileSync(join(root, "ledger.json"), "{}")
  writeFileSync(join(root, "round-trip.json"), JSON.stringify(roundTrip))
  writeFileSync(join(root, "delete-report.json"), JSON.stringify({
    totalGroupsAffected: 1, totalItemsKept: 1, totalItemsSelectedForTrash: 1,
    items: [{ action: "trash", mediaKey: "target" }]
  }))
  return {
    metadata,
    roundTrip,
    fixture: {
      configured: true,
      status: "PASS",
      evidence: {
        syntheticOnly: true, itemCount: 6, trashPerformed: true,
        appBuildVerified: true, appScanVerified: true, appTrashUndoVerified: true,
        account: roundTrip.account, albumUrl: roundTrip.albumUrl,
        extensionId: roundTrip.runtime.extensionId,
        inventory: "inventory.json", roundTrip: "round-trip.json", roundTripLedger: "ledger.json"
      }
    },
    obligation: { id: "LIVE-GOOGLE-01", requirementId: "LIVE-PARITY", proofClass: "provider", kind: "live-provider", command: "synthetic-google-roundtrip" }
  }
}

describe("verification runner exact live package gate", () => {
  function withFixture(check: (root: string, input: ReturnType<typeof syntheticPackageFixture>) => void) {
    const root = mkdtempSync(join(tmpdir(), "photosweep-runner-live-binding-"))
    try { check(root, syntheticPackageFixture(root)) }
    finally { rmSync(root, { recursive: true, force: true }) }
  }

  it("[PARITY-08] accepts destructive schema v2 only when bound to the final package", () => {
    withFixture((root, input) => {
      expect(runnerGates(root, trustedExtensionId).liveProviderArtifact(input.obligation, input.fixture)).toMatchObject({ status: "PASS", checksRun: 1 })
    })
  })

  it("[PARITY-08] blocks matching copied IDs without an independently supplied DevTools identity", () => {
    withFixture((root, input) => {
      expect(input.roundTrip.runtime.extensionId).toBe(input.fixture.evidence.extensionId)
      const result = runnerGates(root).liveProviderArtifact(input.obligation, input.fixture)
      expect(result).toMatchObject({ status: "BLOCKED", checksRun: 0 })
      expect(result.message).toContain("trusted DevTools extension inventory identity is missing or invalid")
    })
  })

  it("[PARITY-08] blocks legacy schema v1 despite correct package hashes", () => {
    withFixture((root, input) => {
      input.roundTrip.schemaVersion = 1
      writeFileSync(join(root, "round-trip.json"), JSON.stringify(input.roundTrip))
      const result = runnerGates(root).liveProviderArtifact(input.obligation, input.fixture)
      expect(result).toMatchObject({ status: "BLOCKED", checksRun: 0 })
      expect(result.message).toContain("schema version must be 2")
    })
  })

  it("[PARITY-08] rejects retained same-source evidence after the final package is rebuilt", () => {
    withFixture((root, input) => {
      writeFileSync(join(root, "build/chrome-mv3-prod.zip"), "newly rebuilt package with a fresh UUID")
      const gates = runnerGates(root)
      expect(gates.currentPackageBinding(input.roundTrip, chromeVersion).problems).toContain(
        "live evidence does not match the current production package ZIP"
      )
      const result = gates.liveProviderArtifact(input.obligation, input.fixture)
      expect(result).toMatchObject({ status: "BLOCKED", checksRun: 0 })
      expect(result.message).toContain("current production package ZIP")
    })
  })

  it.each(["build/chrome-mv3-prod.zip", "build/chrome-mv3-prod/manifest.json"])("[PARITY-08] blocks missing current candidate input %s", (missingPath) => {
    withFixture((root, input) => {
      rmSync(join(root, missingPath))
      expect(runnerGates(root).liveProviderArtifact(input.obligation, input.fixture)).toMatchObject({ status: "BLOCKED", checksRun: 0 })
    })
  })

  it("[PARITY-08] blocks runtime build-ID spoofing", () => {
    withFixture((root, input) => {
      input.roundTrip.runtime.buildId = "123e4567-e89b-42d3-a456-426614174001"
      writeFileSync(join(root, "round-trip.json"), JSON.stringify(input.roundTrip))
      expect(runnerGates(root).liveProviderArtifact(input.obligation, input.fixture)).toMatchObject({ status: "BLOCKED", checksRun: 0 })
    })
  })

  it("[PARITY-08] blocks a sidecar source file count mismatch in the live package binding path", () => {
    withFixture((root, input) => {
      input.metadata.sourceFileCount += 1
      const artifactName = cwsArtifactFileName(chromeVersion, input.roundTrip.artifactSha256)
      writeFileSync(
        join(root, "build", cwsArtifactMetadataFileName(artifactName)),
        JSON.stringify(input.metadata)
      )

      const result = runnerGates(root, trustedExtensionId).liveProviderArtifact(input.obligation, input.fixture)
      expect(result).toMatchObject({ status: "BLOCKED", checksRun: 0 })
      expect(result.message).toContain("Package source file count does not match the current source fingerprint")
    })
  })
})
