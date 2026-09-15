// Embedding cache using IndexedDB.
// Stores Float32Array embeddings plus local metadata keyed by mediaKey.
// Typical size: ~5KB/item × 48k items = ~238MB for a large library.

import type { ContentHashEvidence, GpdMediaItem } from "./types"

const DB_NAME = "gpd-cache"
const DB_VERSION = 1
const STORE_NAME = "embeddings"

export interface CachedMediaMetadata {
  dedupKey: string
  exactContentHash?: string
  contentHash?: ContentHashEvidence
  thumb: string
  timestamp: number
  creationTimestamp: number
  resWidth?: number
  resHeight?: number
  fileName?: string
  size?: number
  takesUpSpace?: boolean | null
  spaceTaken?: number
  isOwned?: boolean
  isOriginalQuality?: boolean | null
  duration?: number
  productUrl?: string
}

export interface EmbeddingRecord {
  mediaKey: string
  embedding: Float32Array
  metadata?: CachedMediaMetadata
  scannedAt?: number
  model?: string
}

export function createCachedMediaMetadata(
  item: GpdMediaItem
): CachedMediaMetadata {
  return {
    dedupKey: item.dedupKey,
    exactContentHash: item.exactContentHash,
    ...(item.contentHash ? { contentHash: item.contentHash } : {}),
    thumb: item.thumb,
    timestamp: item.timestamp,
    creationTimestamp: item.creationTimestamp,
    resWidth: item.resWidth,
    resHeight: item.resHeight,
    fileName: item.fileName,
    size: item.size,
    takesUpSpace: item.takesUpSpace,
    spaceTaken: item.spaceTaken,
    isOwned: item.isOwned,
    isOriginalQuality: item.isOriginalQuality,
    duration: item.duration,
    productUrl: item.productUrl
  }
}

export class EmbeddingCache {
  private db: IDBDatabase

  private constructor(db: IDBDatabase) {
    this.db = db
  }

  static async open(): Promise<EmbeddingCache> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "mediaKey" })
        }
      }
      req.onsuccess = () => resolve(new EmbeddingCache(req.result))
      req.onerror = () => reject(req.error)
    })
  }

  /** Retrieve embeddings for a batch of mediaKeys. Returns null for cache misses. */
  async getMany(mediaKeys: string[]): Promise<(Float32Array | null)[]> {
    if (mediaKeys.length === 0) return []
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readonly")
      const store = tx.objectStore(STORE_NAME)
      const results: (Float32Array | null)[] = new Array(mediaKeys.length).fill(
        null
      )
      let pending = mediaKeys.length

      mediaKeys.forEach((key, i) => {
        const req = store.get(key)
        req.onsuccess = () => {
          results[i] =
            (req.result as EmbeddingRecord | undefined)?.embedding ?? null
          if (--pending === 0) resolve(results)
        }
        req.onerror = () => {
          if (--pending === 0) resolve(results)
        }
      })
    })
  }

  /** Retrieve embeddings only when their stored model matches the expected model. */
  async getCompatibleMany(
    mediaKeys: string[],
    expectedModel: string
  ): Promise<(Float32Array | null)[]> {
    if (mediaKeys.length === 0) return []
    return new Promise((resolve) => {
      const tx = this.db.transaction(STORE_NAME, "readonly")
      const store = tx.objectStore(STORE_NAME)
      const results: (Float32Array | null)[] = new Array(mediaKeys.length).fill(
        null
      )
      let pending = mediaKeys.length

      mediaKeys.forEach((key, i) => {
        const req = store.get(key)
        req.onsuccess = () => {
          const record = req.result as EmbeddingRecord | undefined
          results[i] =
            record?.model === expectedModel ? record.embedding ?? null : null
          if (--pending === 0) resolve(results)
        }
        req.onerror = () => {
          if (--pending === 0) resolve(results)
        }
      })
    })
  }

  /** Retrieve full cache records for diagnostics and audit tooling. */
  async getRecords(mediaKeys: string[]): Promise<(EmbeddingRecord | null)[]> {
    if (mediaKeys.length === 0) return []
    return new Promise((resolve) => {
      const tx = this.db.transaction(STORE_NAME, "readonly")
      const store = tx.objectStore(STORE_NAME)
      const results: (EmbeddingRecord | null)[] = new Array(
        mediaKeys.length
      ).fill(null)
      let pending = mediaKeys.length

      mediaKeys.forEach((key, i) => {
        const req = store.get(key)
        req.onsuccess = () => {
          results[i] = (req.result as EmbeddingRecord | undefined) ?? null
          if (--pending === 0) resolve(results)
        }
        req.onerror = () => {
          if (--pending === 0) resolve(results)
        }
      })
    })
  }

  /** Retrieve metadata snapshots for a batch of mediaKeys. Returns null for cache misses or legacy entries. */
  async getMetadata(
    mediaKeys: string[]
  ): Promise<(CachedMediaMetadata | null)[]> {
    if (mediaKeys.length === 0) return []
    return new Promise((resolve) => {
      const tx = this.db.transaction(STORE_NAME, "readonly")
      const store = tx.objectStore(STORE_NAME)
      const results: (CachedMediaMetadata | null)[] = new Array(
        mediaKeys.length
      ).fill(null)
      let pending = mediaKeys.length

      mediaKeys.forEach((key, i) => {
        const req = store.get(key)
        req.onsuccess = () => {
          results[i] =
            (req.result as EmbeddingRecord | undefined)?.metadata ?? null
          if (--pending === 0) resolve(results)
        }
        req.onerror = () => {
          if (--pending === 0) resolve(results)
        }
      })
    })
  }

  /** Return all mediaKeys currently present in the cache. */
  async keys(): Promise<Set<string>> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readonly")
      const req = tx.objectStore(STORE_NAME).getAllKeys()
      req.onsuccess = () => resolve(new Set(req.result as string[]))
      req.onerror = () => reject(req.error)
    })
  }

  /** Return mediaKeys whose embeddings were produced by the expected model. */
  async compatibleKeys(expectedModel: string): Promise<Set<string>> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readonly")
      const req = tx.objectStore(STORE_NAME).openCursor()
      const keys = new Set<string>()

      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve(keys)
          return
        }
        const record = cursor.value as EmbeddingRecord
        if (record.model === expectedModel && record.embedding) {
          keys.add(record.mediaKey)
        }
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
    })
  }

  /** Return all cached records for local diagnostics/export. */
  async allRecords(): Promise<EmbeddingRecord[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readonly")
      const req = tx.objectStore(STORE_NAME).getAll()
      req.onsuccess = () => resolve(req.result as EmbeddingRecord[])
      req.onerror = () => reject(req.error)
    })
  }

  /** Persist a batch of embeddings. Overwrites existing entries. */
  async setMany(records: EmbeddingRecord[]): Promise<void> {
    if (records.length === 0) return
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readwrite")
      const store = tx.objectStore(STORE_NAME)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      for (const record of records) {
        store.put(record)
      }
    })
  }

  /** Delete stale entries no longer in the current library. */
  async evictExcept(keepKeys: Set<string>): Promise<number> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readwrite")
      const store = tx.objectStore(STORE_NAME)
      const req = store.openKeyCursor()
      const toDelete: string[] = []

      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          if (!keepKeys.has(cursor.key as string)) {
            toDelete.push(cursor.key as string)
          }
          cursor.continue()
        } else {
          for (const key of toDelete) store.delete(key)
        }
      }
      tx.oncomplete = () => resolve(toDelete.length)
      tx.onerror = () => reject(tx.error)
    })
  }

  /** Return the total number of entries in the cache. */
  async count(): Promise<number> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readonly")
      const req = tx.objectStore(STORE_NAME).count()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  /** Remove all cached embeddings. */
  async clear(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readwrite")
      const req = tx.objectStore(STORE_NAME).clear()
      req.onerror = () => reject(req.error)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  close(): void {
    this.db.close()
  }
}
