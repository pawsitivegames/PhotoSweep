import { describe, expect, it } from "vitest"

import { findExactContentDuplicateGroups } from "../../lib/duplicate-detection-engine"
import { classifyDuplicateItems } from "../../lib/duplicate-classifier"
import { providerParityMixedMediaDatesV3 } from "../fixtures/provider-parity-mixed-media-dates-v3"
import type { GpdMediaItem, PhotoProvider } from "../../lib/types"

const pairDigest: Record<string, string> = {
  "pair-landscape-canoe": "a".repeat(64),
  "pair-portrait-bicycle": "b".repeat(64),
  "pair-square-teapot": "c".repeat(64),
  "pair-wide-bridge": "d".repeat(64),
  "pair-video": "e".repeat(64)
}

function fixtureIdentity(name: string): string {
  const pair = Object.keys(pairDigest).find((key) => name.startsWith(key))
  return pair ?? `unique:${name}`
}

function digestFor(name: string): string {
  const pairKey = fixtureIdentity(name)
  const digest = pairDigest[pairKey]
  if (digest) return digest
  // Each non-pair fixture item gets its own deterministic control digest.
  let hash = 2166136261
  for (const character of pairKey) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0").repeat(8)
}

function mapFixture(provider: PhotoProvider): GpdMediaItem[] {
  return providerParityMixedMediaDatesV3.items.map((fixtureItem, index) => {
    const captured = fixtureItem.captureTimeLocal
      ? new Date(fixtureItem.captureTimeLocal).getTime()
      : Number.NaN
    return {
      mediaKey: `${provider}:${fixtureItem.name}`,
      dedupKey: `${provider}:asset:${index}`,
      provider,
      thumb: `fixture://${provider}/${index}`,
      fileName: fixtureItem.name,
      timestamp: captured,
      timestampProvenance: fixtureItem.captureTimeLocal
        ? ("capture" as const)
        : ("unknown" as const),
      creationTimestamp: Number.NaN,
      creationTimestampProvenance: "unknown" as const,
      mediaKind: fixtureItem.mediaType,
      duration: fixtureItem.mediaType === "video" ? 1000 : undefined,
      contentHash: {
        value: digestFor(fixtureItem.name),
        algorithm: "sha256",
        provenance: "original-content",
        verificationSource: "local-original-bytes"
      }
    }
  })
}

function memberships(provider: PhotoProvider): string[][] {
  return findExactContentDuplicateGroups(mapFixture(provider))
    .map((group) =>
      group
        .map((item) => item.fileName ?? "")
        .sort((a, b) => a.localeCompare(b))
    )
    .sort((a, b) => a[0].localeCompare(b[0]))
}

describe("cross-provider exact matching oracle", () => {
  it("keeps exact duplicate membership stable on the same normalized mixed-media fixture", () => {
    const expected = [
      ["pair-landscape-canoe-a.png", "pair-landscape-canoe-b.png"],
      ["pair-portrait-bicycle-a.png", "pair-portrait-bicycle-b.png"],
      ["pair-square-teapot-a.png", "pair-square-teapot-b.png"],
      ["pair-video-a.mp4", "pair-video-b.mp4"],
      ["pair-wide-bridge-a.png", "pair-wide-bridge-b.png"]
    ].sort((a, b) => a[0].localeCompare(b[0]))

    expect(memberships("google")).toEqual(expected)
    expect(memberships("amazon")).toEqual(expected)
    expect(memberships("icloud")).toEqual(expected)
  })

  it("keeps photo, video, and Live Photo hashes in separate identity classes", () => {
    const collision = "f".repeat(64)
    const items = [
      ["photo-a", "photo"],
      ["photo-b", "photo"],
      ["video-a", "video"],
      ["video-b", "video"],
      ["live-a", "live-photo"],
      ["live-b", "live-photo"]
    ].map(([mediaKey, mediaKind], index) => ({
      mediaKey,
      dedupKey: `google:${index}`,
      provider: "google" as const,
      thumb: "fixture://collision",
      timestamp: 1,
      timestampProvenance: "capture" as const,
      creationTimestamp: 1,
      creationTimestampProvenance: "creation" as const,
      mediaKind: mediaKind as GpdMediaItem["mediaKind"],
      duration: mediaKind === "video" ? 1000 : undefined,
      contentHash: {
        value: collision,
        algorithm: "sha256" as const,
        provenance: "original-content" as const,
        verificationSource: "local-original-bytes" as const,
        ...(mediaKind === "live-photo"
          ? { contentRole: "live-photo-still" as const }
          : { contentRole: "single-file" as const })
      }
    }))

    const groups = findExactContentDuplicateGroups(items)
    expect(
      groups
        .filter((group) => group[0].mediaKind !== "live-photo")
        .map((group) => group.map((item) => item.mediaKey).sort())
    ).toEqual([
      ["photo-a", "photo-b"],
      ["video-a", "video-b"]
    ])
    const unpairedLivePhotoGroup = groups.find(
      (group) => group[0].mediaKind === "live-photo"
    )
    expect(unpairedLivePhotoGroup).toBeDefined()
    expect(
      classifyDuplicateItems(unpairedLivePhotoGroup ?? []).evidenceLevel
    ).not.toBe("verified_identical")
  })

  it("namespaces provider fingerprints to their source provider", () => {
    const rows = ["google-a", "google-b", "amazon-a", "amazon-b"].map(
      (mediaKey) => ({
        mediaKey,
        dedupKey: mediaKey,
        provider: mediaKey.startsWith("google")
          ? ("google" as const)
          : ("amazon" as const),
        thumb: "fixture://fingerprint",
        timestamp: 1,
        timestampProvenance: "capture" as const,
        creationTimestamp: 1,
        creationTimestampProvenance: "creation" as const,
        mediaKind: "photo" as const,
        contentHash: {
          value: "provider-original-fingerprint",
          algorithm: "provider-fingerprint" as const,
          provenance: "original-content" as const,
          verificationSource: "provider-fingerprint" as const
        }
      })
    )

    const groups = findExactContentDuplicateGroups(rows)
      .map((group) => group.map((item) => item.mediaKey).sort())
      .sort((a, b) => a[0].localeCompare(b[0]))
    expect(groups).toEqual([
      ["amazon-a", "amazon-b"],
      ["google-a", "google-b"]
    ])
  })
})
