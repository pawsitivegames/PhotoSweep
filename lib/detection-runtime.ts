import { EmbeddingCache } from "./embedding-cache"

export type DetectionEmbeddingStore = Pick<
  EmbeddingCache,
  "compatibleKeys" | "getCompatibleMany" | "setMany" | "close"
>

export interface DetectionWorker {
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
  terminate(): void
}

/** Internal infrastructure seam shared by browser and controlled test adapters. */
export interface DetectionRuntime {
  openCache(): Promise<DetectionEmbeddingStore | null>
  fetch(input: string, init?: RequestInit): Promise<Response>
  resourceUrl(path: string): string
  createWorker(url: string): DetectionWorker
  hardwareConcurrency(): number
  now(): number
}

export const browserDetectionRuntime: DetectionRuntime = {
  openCache: () => EmbeddingCache.open(),
  fetch: (input, init) => fetch(input, init),
  resourceUrl: (path) => chrome.runtime.getURL(path),
  createWorker: (url) => new Worker(url),
  hardwareConcurrency: () => navigator.hardwareConcurrency ?? 4,
  now: () => performance.now()
}
