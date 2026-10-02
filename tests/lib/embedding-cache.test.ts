/**
 * Unit tests for lib/embedding-cache.ts — EmbeddingCache (IndexedDB wrapper).
 *
 * Uses fake-indexeddb (in-memory IDB) for isolation.
 * Each test gets a fresh IDBFactory instance so state never leaks.
 *
 * @vitest-environment happy-dom
 */
import { IDBFactory } from "fake-indexeddb"
import { beforeEach, describe, expect, it } from "vitest"

import {
  createCachedMediaMetadata,
  EmbeddingCache
} from "../../lib/embedding-cache"
import type { GpdMediaItem } from "../../lib/types"

// ============================================================
// Test isolation: fresh IDB store per test
// ============================================================

beforeEach(() => {
  // Replace the global indexedDB with a fresh in-memory factory.
  // EmbeddingCache.open() uses indexedDB as a global, so this
  // ensures each test starts with an empty database.
  globalThis.indexedDB = new IDBFactory()
})

// ============================================================
// Helpers
// ============================================================

function makeEmbedding(seed: number, length = 8): Float32Array {
  return new Float32Array(Array.from({ length }, (_, i) => seed + i * 0.1))
}

function makeItem(mediaKey: string): GpdMediaItem {
  return {
    mediaKey,
    dedupKey: `dk-${mediaKey}`,
    thumb: `https://thumb/${mediaKey}`,
    productUrl: `https://photos.google.com/photo/${mediaKey}`,
    timestamp: 1000,
    timestampProvenance: "capture",
    creationTimestamp: 2000,
    creationTimestampProvenance: "creation",
    mediaKind: "video",
    mimeType: "video/mp4",
    resWidth: 1920,
    resHeight: 1080,
    fileName: `${mediaKey}.jpg`,
    size: 123456,
    takesUpSpace: false,
    spaceTaken: 0,
    isOwned: true,
    isFavorite: false,
    favoriteStatus: "not-favorite",
    favoriteSource: "provider-metadata",
    isOriginalQuality: false,
    duration: 12
  }
}

// ============================================================
// Tests
// ============================================================

describe("EmbeddingCache", () => {
  describe("getMany + setMany round-trip", () => {
    it("returns stored embeddings by mediaKey", async () => {
      const cache = await EmbeddingCache.open()
      await cache.setMany([
        { mediaKey: "key1", embedding: makeEmbedding(1) },
        { mediaKey: "key2", embedding: makeEmbedding(2) }
      ])

      const results = await cache.getMany(["key1", "key2"])
      expect(results).toHaveLength(2)
      expect(results[0]).toBeInstanceOf(Float32Array)
      expect(Array.from(results[0]!)).toEqual(Array.from(makeEmbedding(1)))
      expect(Array.from(results[1]!)).toEqual(Array.from(makeEmbedding(2)))
      cache.close()
    })

    it("returns null for cache misses", async () => {
      const cache = await EmbeddingCache.open()
      const results = await cache.getMany(["missing-key"])
      expect(results[0]).toBeNull()
      cache.close()
    })

    it("returns mixed hits and misses in correct order", async () => {
      const cache = await EmbeddingCache.open()
      await cache.setMany([
        { mediaKey: "present", embedding: makeEmbedding(5) }
      ])

      const results = await cache.getMany(["present", "absent", "present"])
      expect(results[0]).not.toBeNull()
      expect(results[1]).toBeNull()
      expect(results[2]).not.toBeNull()
      cache.close()
    })

    it("returns only embeddings compatible with the requested model", async () => {
      const cache = await EmbeddingCache.open()
      await cache.setMany([
        {
          mediaKey: "current",
          embedding: makeEmbedding(1),
          model: "scripts/current.tflite"
        },
        {
          mediaKey: "old",
          embedding: makeEmbedding(2),
          model: "scripts/old.tflite"
        },
        {
          mediaKey: "legacy",
          embedding: makeEmbedding(3)
        }
      ])

      const results = await cache.getCompatibleMany(
        ["current", "old", "legacy", "missing"],
        "scripts/current.tflite"
      )
      expect(Array.from(results[0]!)).toEqual(Array.from(makeEmbedding(1)))
      expect(results.slice(1)).toEqual([null, null, null])
      cache.close()
    })

    it("returns empty array for empty input", async () => {
      const cache = await EmbeddingCache.open()
      const results = await cache.getMany([])
      expect(results).toEqual([])
      cache.close()
    })

    it("overwrites an existing entry on setMany", async () => {
      const cache = await EmbeddingCache.open()
      await cache.setMany([{ mediaKey: "key1", embedding: makeEmbedding(1) }])
      await cache.setMany([{ mediaKey: "key1", embedding: makeEmbedding(99) }])

      const results = await cache.getMany(["key1"])
      expect(Array.from(results[0]!)).toEqual(Array.from(makeEmbedding(99)))
      cache.close()
    })
  })

  describe("metadata snapshots", () => {
    it("stores metadata, scan timestamp, and model beside embeddings", async () => {
      const cache = await EmbeddingCache.open()
      const metadata = createCachedMediaMetadata(makeItem("key1"))
      await cache.setMany([
        {
          mediaKey: "key1",
          embedding: makeEmbedding(1),
          metadata,
          scannedAt: 12345,
          model: "scripts/model.tflite"
        }
      ])

      const stored = await cache.getMetadata(["key1"])
      expect(stored[0]).toEqual(metadata)

      const records = await cache.getRecords(["key1"])
      expect(records[0]).toMatchObject({
        mediaKey: "key1",
        metadata,
        scannedAt: 12345,
        model: "scripts/model.tflite"
      })
      expect(await cache.allRecords()).toHaveLength(1)

      const embeddings = await cache.getMany(["key1"])
      expect(Array.from(embeddings[0]!)).toEqual(Array.from(makeEmbedding(1)))
      cache.close()
    })

    it("returns null metadata for misses and legacy embedding-only entries", async () => {
      const cache = await EmbeddingCache.open()
      await cache.setMany([{ mediaKey: "legacy", embedding: makeEmbedding(1) }])

      expect(await cache.getMetadata(["legacy", "missing"])).toEqual([
        null,
        null
      ])
      cache.close()
    })

    it("preserves normalized provenance but excludes transient retrieval URLs", () => {
      const itemWithTransport = {
        ...makeItem("key1"),
        contentHash: {
          value: "a".repeat(64),
          algorithm: "sha256",
          provenance: "original-content",
          verificationSource: "local-original-bytes"
        },
        originalResourceUrl: "https://photos.googleusercontent.com/signed",
        playbackUrl: "https://photos.googleusercontent.com/stream"
      } as GpdMediaItem

      const metadata = createCachedMediaMetadata(itemWithTransport)

      expect(metadata).toMatchObject({
        timestampProvenance: "capture",
        creationTimestampProvenance: "creation",
        mediaKind: "video",
        mimeType: "video/mp4",
        favoriteStatus: "not-favorite",
        favoriteSource: "provider-metadata",
        contentHash: {
          algorithm: "sha256",
          verificationSource: "local-original-bytes"
        }
      })
      expect(metadata).not.toHaveProperty("originalResourceUrl")
      expect(metadata).not.toHaveProperty("playbackUrl")
    })
  })

  describe("count", () => {
    it("returns 0 for an empty cache", async () => {
      const cache = await EmbeddingCache.open()
      expect(await cache.count()).toBe(0)
      cache.close()
    })

    it("returns the number of stored entries", async () => {
      const cache = await EmbeddingCache.open()
      await cache.setMany([
        { mediaKey: "k1", embedding: makeEmbedding(1) },
        { mediaKey: "k2", embedding: makeEmbedding(2) },
        { mediaKey: "k3", embedding: makeEmbedding(3) }
      ])
      expect(await cache.count()).toBe(3)
      cache.close()
    })
  })

  describe("keys", () => {
    it("returns all cached media keys", async () => {
      const cache = await EmbeddingCache.open()
      await cache.setMany([
        { mediaKey: "k1", embedding: makeEmbedding(1) },
        { mediaKey: "k2", embedding: makeEmbedding(2) }
      ])

      expect(await cache.keys()).toEqual(new Set(["k1", "k2"]))
      cache.close()
    })

    it("returns only keys compatible with the requested embedding model", async () => {
      const cache = await EmbeddingCache.open()
      await cache.setMany([
        {
          mediaKey: "current-model",
          embedding: makeEmbedding(1),
          model: "scripts/current.tflite"
        },
        {
          mediaKey: "old-model",
          embedding: makeEmbedding(2),
          model: "scripts/old.tflite"
        },
        {
          mediaKey: "legacy-no-model",
          embedding: makeEmbedding(3)
        }
      ])

      expect(await cache.compatibleKeys("scripts/current.tflite")).toEqual(
        new Set(["current-model"])
      )
      cache.close()
    })
  })

  describe("clear", () => {
    it("removes all cached embeddings", async () => {
      const cache = await EmbeddingCache.open()
      await cache.setMany([
        { mediaKey: "k1", embedding: makeEmbedding(1) },
        { mediaKey: "k2", embedding: makeEmbedding(2) }
      ])

      await cache.clear()

      expect(await cache.count()).toBe(0)
      expect(await cache.getMany(["k1", "k2"])).toEqual([null, null])
      cache.close()
    })
  })

  describe("evictExcept", () => {
    it("deletes keys not in the keep set and returns eviction count", async () => {
      const cache = await EmbeddingCache.open()
      await cache.setMany([
        { mediaKey: "keep-me", embedding: makeEmbedding(1) },
        { mediaKey: "evict-me", embedding: makeEmbedding(2) },
        { mediaKey: "also-evict", embedding: makeEmbedding(3) }
      ])

      const evicted = await cache.evictExcept(new Set(["keep-me"]))
      expect(evicted).toBe(2)

      const remaining = await cache.getMany([
        "keep-me",
        "evict-me",
        "also-evict"
      ])
      expect(remaining[0]).not.toBeNull()
      expect(remaining[1]).toBeNull()
      expect(remaining[2]).toBeNull()
      cache.close()
    })

    it("evicts nothing when all keys are in keep set", async () => {
      const cache = await EmbeddingCache.open()
      await cache.setMany([
        { mediaKey: "a", embedding: makeEmbedding(1) },
        { mediaKey: "b", embedding: makeEmbedding(2) }
      ])

      const evicted = await cache.evictExcept(new Set(["a", "b"]))
      expect(evicted).toBe(0)
      expect(await cache.count()).toBe(2)
      cache.close()
    })

    it("evicts all keys when keep set is empty", async () => {
      const cache = await EmbeddingCache.open()
      await cache.setMany([
        { mediaKey: "x", embedding: makeEmbedding(1) },
        { mediaKey: "y", embedding: makeEmbedding(2) }
      ])

      const evicted = await cache.evictExcept(new Set())
      expect(evicted).toBe(2)
      expect(await cache.count()).toBe(0)
      cache.close()
    })
  })
})
