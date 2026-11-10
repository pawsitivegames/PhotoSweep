import { describe, expect, it, vi } from "vitest"

import type { DecisionMemoryRecord } from "../../lib/decision-memory"
import type { DuplicateDetectionRequest } from "../../lib/duplicate-detector"
import { FREE_ENTITLEMENT } from "../../lib/entitlement"
import {
  ScanLifecycle,
  type ScanLifecycleEvent
} from "../../lib/scan-lifecycle"
import type {
  DuplicateGroup,
  GpdMediaItem,
  GptkCommandMessage,
  GptkResultMessage,
  StoredState
} from "../../lib/types"
import { APP_ID, DEFAULT_SETTINGS } from "../../lib/types"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const items: GpdMediaItem[] = ["one", "two"].map((mediaKey) => ({
  mediaKey,
  dedupKey: mediaKey,
  thumb: mediaKey,
  timestamp: 1,
  creationTimestamp: 1
}))
const groups: DuplicateGroup[] = [
  {
    id: "group",
    mediaKeys: ["one", "two"],
    originalMediaKey: "one",
    similarity: 1
  }
]

function result(requestId = "first"): GptkResultMessage {
  return {
    app: APP_ID,
    action: "gptkResult",
    command: "getAllMediaItems",
    requestId,
    provider: "google",
    providerSessionId: "session",
    success: true,
    data: items,
    scanCoverage: {
      status: "complete",
      stopReason: "exhausted",
      itemsVisited: 2,
      itemsReturned: 2,
      itemsSkipped: 0,
      unknownDateItemsSkipped: 0,
      mediaTypesCovered: { photos: true, videos: true },
      canResume: false
    }
  }
}

function harness() {
  const events: ScanLifecycleEvent[] = []
  const identity = {
    sourceProvider: "google" as const,
    accountEmail: "person@example.com",
    providerSessionId: "session"
  }
  const sendCommand = vi.fn(async (_message: GptkCommandMessage) => {})
  const cancelProvider = vi.fn()
  const detect = vi.fn(async (_request: DuplicateDetectionRequest) => groups)
  const loadCachedScanResults = vi.fn(
    async (): Promise<StoredState["scanResults"] | null> => null
  )
  const loadDecisions = vi.fn(async (): Promise<DecisionMemoryRecord[]> => [])
  const clear = vi.fn(async () => {})
  const lifecycle = new ScanLifecycle(
    { persist: () => {}, clear, now: () => 100 },
    {
      sendCommand,
      cancelProvider,
      detect,
      loadCachedScanResults,
      loadDecisions,
      currentIdentity: () => identity,
      entitlement: () => FREE_ENTITLEMENT,
      onEvent: (event) => events.push(event)
    }
  )
  const start = (requestId = "first") =>
    lifecycle.start({
      requestId,
      settings: DEFAULT_SETTINGS,
      accountEmail: identity.accountEmail,
      providerSessionId: identity.providerSessionId
    })
  return {
    lifecycle,
    events,
    identity,
    sendCommand,
    cancelProvider,
    detect,
    loadCachedScanResults,
    loadDecisions,
    clear,
    start
  }
}

describe("Scan Lifecycle execution", () => {
  it("does not announce or dispatch a provider request paused during cache lookup", async () => {
    const h = harness()
    const cache = deferred<null>()
    h.loadCachedScanResults.mockImplementationOnce(() => cache.promise)
    const starting = h.start()
    h.lifecycle.pause()
    cache.resolve(null)
    await starting
    expect(h.events.map((event) => event.kind)).toEqual(["started"])
    expect(h.sendCommand).not.toHaveBeenCalled()
  })

  it("keeps one failure message across detection errors and resumable checkpoints", async () => {
    const h = harness()
    h.detect.mockRejectedValueOnce(new Error("Detector unavailable"))
    await h.start()
    await h.lifecycle.acceptProviderResult(result())
    const error = "Duplicate detection failed: Error: Detector unavailable"
    expect(h.events.at(-1)).toMatchObject({
      kind: "failed",
      error,
      checkpoint: { error, message: error }
    })
  })

  it("runs retrieval through detection and emits one coherent completion from captured settings", async () => {
    const h = harness()
    const settings = { ...DEFAULT_SETTINGS, similarityThreshold: 0.92 }
    await h.lifecycle.start({
      requestId: "first",
      settings,
      accountEmail: h.identity.accountEmail,
      providerSessionId: "session"
    })
    settings.similarityThreshold = 0.5
    await h.lifecycle.acceptProviderResult(result())
    expect(h.detect.mock.calls[0][0].threshold).toBe(0.92)
    expect(h.events.map((event) => event.kind)).toEqual([
      "started",
      "requested",
      "media",
      "completing",
      "complete"
    ])
    const completion = h.events.find((event) => event.kind === "complete")!
    expect(completion.result).toMatchObject({
      totalItems: 2,
      mediaItems: { one: items[0], two: items[1] },
      settings: { similarityThreshold: 0.92 }
    })
    await h.lifecycle.acceptProviderResult(result())
    expect(h.detect).toHaveBeenCalledOnce()
  })

  it("does not dispatch a superseded attempt when its cache read finishes late", async () => {
    const h = harness()
    const cache = deferred<null>()
    h.loadCachedScanResults.mockImplementationOnce(() => cache.promise)
    const first = h.start()
    await h.start("second")
    cache.resolve(null)
    await first
    expect(
      h.sendCommand.mock.calls.map(([message]) => message.requestId)
    ).toEqual(["second"])
    expect(h.cancelProvider).toHaveBeenCalledWith("first", "google")
  })

  it("drops progress, partial groups, and results from a superseded detector", async () => {
    const h = harness()
    const detection = deferred<DuplicateGroup[]>()
    h.detect.mockImplementationOnce(() => detection.promise)
    await h.start()
    const first = h.lifecycle.acceptProviderResult(result())
    await vi.waitFor(() => expect(h.detect).toHaveBeenCalledOnce())
    const request = h.detect.mock.calls[0][0]
    await h.start("second")
    h.events.length = 0
    request.onProgress?.({
      phase: "computing_embeddings",
      current: 1,
      total: 2
    })
    request.onPartialGroups?.(groups)
    detection.resolve(groups)
    await first
    expect(request.signal?.aborted).toBe(true)
    expect(h.events).toEqual([])
    expect(h.lifecycle.requestId).toBe("second")
  })

  it("keeps a new scan current while an older completion waits for checkpoint clearing", async () => {
    const h = harness()
    const clearing = deferred<void>()
    h.clear.mockImplementationOnce(() => clearing.promise)
    await h.start()
    const first = h.lifecycle.acceptProviderResult(result())
    await vi.waitFor(() => expect(h.clear).toHaveBeenCalledOnce())
    await h.start("second")
    clearing.resolve()
    await first
    expect(h.events.filter((event) => event.kind === "complete")).toEqual([])
    expect(h.lifecycle.requestId).toBe("second")
  })

  it("ignores old completion while saved review decisions are being read", async () => {
    const h = harness()
    const decisions = deferred<DecisionMemoryRecord[]>()
    h.loadDecisions.mockImplementationOnce(() => decisions.promise)
    await h.start()
    const first = h.lifecycle.acceptProviderResult(result())
    await vi.waitFor(() => expect(h.loadDecisions).toHaveBeenCalledOnce())
    await h.start("second")
    decisions.resolve([])
    await first
    expect(h.events.some((event) => event.kind === "complete")).toBe(false)
    expect(h.clear).not.toHaveBeenCalled()
  })

  it("rejects results from another page session and malformed coverage", async () => {
    const h = harness()
    await h.start()
    await h.lifecycle.acceptProviderResult({
      ...result(),
      providerSessionId: "other"
    })
    expect(h.detect).not.toHaveBeenCalled()
    expect(h.events.at(-1)).toMatchObject({ kind: "failed", checkpoint: null })
    await h.start("second")
    await h.lifecycle.acceptProviderResult({
      ...result("second"),
      scanCoverage: undefined
    })
    expect(h.detect).not.toHaveBeenCalled()
    expect(h.events.at(-1)).toMatchObject({
      kind: "failed",
      checkpoint: { status: "error" }
    })
  })

  it("does not publish completed detection after the provider identity changes", async () => {
    const h = harness()
    const detection = deferred<DuplicateGroup[]>()
    h.detect.mockImplementationOnce(() => detection.promise)
    await h.start()
    const first = h.lifecycle.acceptProviderResult(result())
    await vi.waitFor(() => expect(h.detect).toHaveBeenCalledOnce())
    h.identity.providerSessionId = "new-session"
    detection.resolve(groups)
    await first
    expect(h.events.some((event) => event.kind === "complete")).toBe(false)
  })

  it("resumes checkpoint media through the same detection workflow", async () => {
    const h = harness()
    await h.start()
    h.lifecycle.patch({
      mediaItems: items,
      scanCoverage: result().scanCoverage
    })
    const checkpoint = h.lifecycle.pause()!
    h.events.length = 0
    await h.lifecycle.resumeDetection({
      requestId: "resumed",
      checkpoint,
      patch: { phase: "computing_embeddings" }
    })
    expect(h.sendCommand).toHaveBeenCalledOnce()
    expect(h.detect).toHaveBeenCalledOnce()
    expect(h.events.at(-1)).toMatchObject({
      kind: "complete",
      result: { totalItems: 2 }
    })
  })

  it("reports a provider transport failure as a terminal, resumable error", async () => {
    const h = harness()
    h.sendCommand.mockRejectedValueOnce(new Error("Disconnected"))
    await h.start()
    expect(h.events.at(-1)).toMatchObject({
      kind: "failed",
      error: "Error: Disconnected",
      checkpoint: { status: "error" }
    })
    expect(h.lifecycle.requestId).toBeNull()
  })
})
