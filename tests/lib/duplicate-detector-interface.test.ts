import { afterEach, describe, expect, it, vi } from "vitest"

import type {
  DetectionEmbeddingStore,
  DetectionRuntime,
  DetectionWorker
} from "../../lib/detection-runtime"
import { DuplicateDetectionEngine } from "../../lib/duplicate-detector"
import { scopedEmbeddingCacheKey } from "../../lib/embedding-cache"
import type { GpdMediaItem } from "../../lib/types"
import { detectEmbeddingBlockPairs } from "../../workers/embedder-kernels"

const MODEL = "scripts/mobilenet_v3_large.tflite"
const mediaItems: GpdMediaItem[] = ["one", "two", "other"].map(
  (mediaKey, index) => ({
    mediaKey,
    dedupKey: `dedup-${mediaKey}`,
    provider: "google",
    thumb: `https://example.test/${mediaKey}`,
    timestamp: index * 86_400_000 + 1,
    creationTimestamp: index * 86_400_000 + 1
  })
)

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function runtimeHarness(
  options: { cached?: boolean; stallInit?: boolean; crashEmbed?: boolean } = {}
) {
  const values = new Map<string, { embedding: Float32Array; model: string }>()
  if (options.cached)
    for (const item of mediaItems)
      values.set(scopedEmbeddingCacheKey(item.mediaKey, "account-a"), {
        embedding: new Float32Array(
          item.mediaKey === "other" ? [0, 1] : [1, 0]
        ),
        model: MODEL
      })
  const store: DetectionEmbeddingStore = {
    compatibleKeys: vi.fn(
      async (model) =>
        new Set(
          [...values]
            .filter(([, value]) => value.model === model)
            .map(([key]) => key)
        )
    ),
    getCompatibleMany: vi.fn(async (keys, model) =>
      keys.map((key) =>
        values.get(key)?.model === model ? values.get(key)!.embedding : null
      )
    ),
    setMany: vi.fn(async (records) => {
      for (const record of records)
        values.set(record.mediaKey, {
          embedding: record.embedding,
          model: record.model
        })
    }),
    close: vi.fn()
  }
  const workers: FakeWorker[] = []
  class FakeWorker implements DetectionWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    terminated = false
    terminate() {
      this.terminated = true
    }
    postMessage(raw: unknown) {
      const message = raw as { type: string; data: Record<string, unknown> }
      queueMicrotask(async () => {
        if (this.terminated) return
        if (message.type === "init") {
          if (!options.stallInit)
            this.onmessage?.(
              new MessageEvent("message", { data: { type: "ready" } })
            )
        } else if (message.type === "embed") {
          if (options.crashEmbed) {
            this.onerror?.(
              new ErrorEvent("error", { message: "Embedding worker crashed" })
            )
            return
          }
          const batch = message.data.items as { localIdx: number; blob: Blob }[]
          const results = await Promise.all(
            batch.map(async (item) => ({
              localIdx: item.localIdx,
              embedding: new Float32Array(
                (await item.blob.text()).includes("other") ? [0, 1] : [1, 0]
              ).buffer
            }))
          )
          if (!this.terminated)
            this.onmessage?.(
              new MessageEvent("message", {
                data: { type: "results", results }
              })
            )
        } else if (message.type === "detectBlock") {
          const pairs = detectEmbeddingBlockPairs(
            message.data as unknown as Parameters<
              typeof detectEmbeddingBlockPairs
            >[0]
          )
          this.onmessage?.(
            new MessageEvent("message", {
              data: { type: "blockResults", pairs }
            })
          )
        } else
          throw new Error(`Unexpected test worker operation: ${message.type}`)
      })
    }
  }
  const fetchResource = vi.fn(async (url: string, init?: RequestInit) => {
    init?.signal?.throwIfAborted()
    return new Response(
      url.endsWith(".tflite") ? new Uint8Array([1, 2, 3]) : url
    )
  })
  const runtime: DetectionRuntime = {
    openCache: async () => store,
    fetch: fetchResource,
    resourceUrl: (path) => `test-resource:${path}`,
    createWorker: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    hardwareConcurrency: () => 2,
    now: () => performance.now()
  }
  return {
    runtime,
    store,
    workers,
    fetchResource,
    values,
    engine: new DuplicateDetectionEngine(runtime)
  }
}

describe("Duplicate Detection Engine behavior through detect", () => {
  it("closes the cache if thumbnail retrieval is cancelled before workers start", async () => {
    const h = runtimeHarness()
    const controller = new AbortController()
    const fetching = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          )
        })
    )
    h.runtime.fetch = fetching
    const detecting = h.engine.detect({
      mode: "full",
      mediaItems,
      threshold: 0.95,
      signal: controller.signal
    })
    const rejected = expect(detecting).rejects.toMatchObject({
      name: "AbortError"
    })
    await vi.waitFor(() => expect(fetching).toHaveBeenCalled())
    controller.abort()
    await rejected
    expect(h.store.close).toHaveBeenCalledOnce()
    expect(h.workers).toEqual([])
  })

  it("can detect with the cache unavailable", async () => {
    const h = runtimeHarness()
    h.runtime.openCache = async () => {
      throw new Error("IndexedDB unavailable")
    }
    const groups = await h.engine.detect({
      mode: "full",
      mediaItems,
      threshold: 0.95
    })
    expect(groups).toHaveLength(1)
    expect(new Set(groups[0].mediaKeys)).toEqual(new Set(["one", "two"]))
  })

  it("groups real cached vectors without browser globals or fetching thumbnails", async () => {
    const h = runtimeHarness({ cached: true })
    vi.stubGlobal("chrome", undefined)
    vi.stubGlobal("Worker", undefined)
    const partial: string[][] = []
    const groups = await h.engine.detect({
      mode: "full",
      mediaItems,
      threshold: 0.95,
      cacheNamespace: "account-a",
      onPartialGroups: (groups) =>
        partial.push(groups.flatMap((group) => group.mediaKeys))
    })
    expect(groups).toHaveLength(1)
    expect(new Set(groups[0].mediaKeys)).toEqual(new Set(["one", "two"]))
    expect(partial).toHaveLength(1)
    expect(h.fetchResource).not.toHaveBeenCalled()
    expect(h.store.close).toHaveBeenCalledOnce()
    expect(h.workers.every((worker) => worker.terminated)).toBe(true)
  })

  it("runs cache misses through fetch, embedding, matching, and reuse", async () => {
    const h = runtimeHarness()
    const phases: string[] = []
    const request = {
      mode: "full" as const,
      mediaItems,
      threshold: 0.95,
      cacheNamespace: "account-a"
    }
    const first = await h.engine.detect({
      ...request,
      onProgress: (progress) => phases.push(progress.phase)
    })
    expect(first).toHaveLength(1)
    expect(new Set(first[0].mediaKeys)).toEqual(new Set(["one", "two"]))
    expect(new Set(phases)).toEqual(
      new Set([
        "downloading_thumbnails",
        "computing_embeddings",
        "detecting_duplicates"
      ])
    )
    expect(h.values.size).toBe(3)
    h.fetchResource.mockClear()
    const second = await h.engine.detect(request)
    expect(second).toEqual(first)
    expect(h.fetchResource).not.toHaveBeenCalled()
  })

  it("keeps Smart candidate policy while Full can compare across dates", async () => {
    const h = runtimeHarness({ cached: true })
    const largeLibrary = Array.from({ length: 1001 }, (_, index) => ({
      ...mediaItems[0],
      mediaKey: `item-${index}`,
      dedupKey: `dedup-${index}`,
      timestamp: index * 86_400_000 + 1,
      creationTimestamp: index * 86_400_000 + 1
    }))
    expect(
      await h.engine.detect({
        mode: "smart",
        mediaItems: largeLibrary,
        threshold: 0.95,
        cacheNamespace: "account-a"
      })
    ).toEqual([])
    expect(
      await h.engine.detect({
        mode: "full",
        mediaItems,
        threshold: 0.95,
        cacheNamespace: "account-a"
      })
    ).toHaveLength(1)
  })

  it("does not reuse embeddings from another account namespace", async () => {
    const h = runtimeHarness({ cached: true })
    await h.engine.detect({
      mode: "full",
      mediaItems,
      threshold: 0.95,
      cacheNamespace: "account-b"
    })
    expect(h.fetchResource).toHaveBeenCalled()
    expect(h.values.size).toBe(6)
  })

  it("terminates workers and closes the cache after an embedding crash", async () => {
    const h = runtimeHarness({ crashEmbed: true })
    await expect(
      h.engine.detect({ mode: "full", mediaItems, threshold: 0.95 })
    ).rejects.toThrow("Embedding worker crashed")
    expect(h.store.close).toHaveBeenCalledOnce()
    expect(h.workers.every((worker) => worker.terminated)).toBe(true)
  })

  it("cancels a worker pool even while model initialization is stalled", async () => {
    const h = runtimeHarness({ stallInit: true })
    const controller = new AbortController()
    const detecting = h.engine.detect({
      mode: "full",
      mediaItems,
      threshold: 0.95,
      signal: controller.signal
    })
    const rejected = expect(detecting).rejects.toMatchObject({
      name: "AbortError"
    })
    await vi.waitFor(() => expect(h.workers.length).toBeGreaterThan(0))
    controller.abort()
    await rejected
    expect(h.workers.every((worker) => worker.terminated)).toBe(true)
    expect(h.store.close).toHaveBeenCalledOnce()
  })
})
