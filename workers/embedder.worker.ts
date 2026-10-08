/// <reference lib="webworker" />

// Standalone Web Worker for MediaPipe image embedding AND community detection.
// Built separately with esbuild so it can be loaded as a classic worker
// from the extension (CSP: script-src 'self').
//
// Message protocol (main → worker):
//   { type: "init", data: { wasmLoaderUrl, wasmBinaryUrl, modelBuffer: ArrayBuffer } }
//   { type: "embed", data: { items: Array<{ localIdx: number, blob: Blob }> } }
//   { type: "detect", data: { flatEmbeddings: Float32Array, n: number, dim: number, threshold: number } }
//   { type: "detectBlock", data: { flatA: Float32Array, rowsA: number, offsetA: number, flatB: Float32Array, rowsB: number, offsetB: number, dim: number, threshold: number, sameBlock: boolean } }
//   { type: "detectSmart", data: { flatEmbeddings: Float32Array, n: number, dim: number, threshold: number, buckets: number[][], bucketWindowMs?: Array<number | null> } }
//
// Message protocol (worker → main):
//   { type: "ready" }
//   { type: "results", results: Array<{ localIdx: number, embedding: ArrayBuffer }> }
//   { type: "initError", message: string }
//   { type: "detectionProgress", current: number, total: number }
//   { type: "partialDetectionResults", groups: number[][] }
//   { type: "detectionResults", groups: number[][] }
//   { type: "blockResults", pairs: Array<[number, number]> }

import { ImageEmbedder } from "@mediapipe/tasks-vision";
import { detectEmbeddingCommunities } from "./embedder-kernels";

let embedder: ImageEmbedder | null = null;
let mediaPipeConsoleFilterInstalled = false;
let canEmbedImageBitmap: boolean | null = null;

function installMediaPipeConsoleFilter(): void {
  if (mediaPipeConsoleFilterInstalled) return;
  mediaPipeConsoleFilterInstalled = true;

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const message = args.map((arg) => String(arg)).join(" ");
    if (
      message.includes("gl_context.cc:1118") &&
      message.includes("OpenGL error checking is disabled")
    ) {
      return;
    }
    originalError(...args);
  };
}

function embedBitmap(bitmap: ImageBitmap) {
  if (canEmbedImageBitmap !== false) {
    try {
      const result = embedder!.embed(bitmap);
      canEmbedImageBitmap = true;
      return result;
    } catch (error) {
      if (canEmbedImageBitmap === true) throw error;
      canEmbedImageBitmap = false;
    }
  }

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  return embedder!.embed(ctx.getImageData(0, 0, bitmap.width, bitmap.height));
}

self.addEventListener("message", async (event: MessageEvent) => {
  const { type, data } = event.data;

  if (type === "init") {
    try {
      const { wasmLoaderUrl, wasmBinaryUrl, modelBuffer } = data as {
        wasmLoaderUrl: string;
        wasmBinaryUrl: string;
        modelBuffer: ArrayBuffer;
      };

      // Pre-load the WASM loader JS via importScripts (CSP-safe from extension origin).
      // This is the same workaround as the main thread: load the global manually so
      // MediaPipe can find it, then pass wasmLoaderPath: "" to skip its own injection.
      installMediaPipeConsoleFilter();
      importScripts(wasmLoaderUrl);

      const vision = {
        wasmLoaderPath: "",
        wasmBinaryPath: wasmBinaryUrl,
      };

      embedder = await ImageEmbedder.createFromOptions(vision, {
        baseOptions: { modelAssetBuffer: new Uint8Array(modelBuffer) },
        quantize: false,
        l2Normalize: true,
        runningMode: "IMAGE",
      });

      self.postMessage({ type: "ready" });
    } catch (e) {
      self.postMessage({ type: "initError", message: String(e) });
    }
  }

  if (type === "embed") {
    const { items } = data as {
      items: Array<{ localIdx: number; blob: Blob }>;
    };

    const results: Array<{ localIdx: number; embedding: ArrayBuffer }> = [];

    for (const { localIdx, blob } of items) {
      let bitmap: ImageBitmap | null = null;
      try {
        bitmap = await createImageBitmap(blob);
        const result = embedBitmap(bitmap);
        if (result?.embeddings?.[0]?.floatEmbedding) {
          // .slice(0) to detach the buffer from any shared backing store before transfer
          const buf = new Float32Array(
            result.embeddings[0].floatEmbedding,
          ).buffer.slice(0);
          results.push({ localIdx, embedding: buf });
        }
      } catch {
        // Skip unprocessable images
      } finally {
        bitmap?.close();
      }
    }

    const transferables = results.map((r) => r.embedding);
    self.postMessage({ type: "results", results }, transferables);
  }

  if (type === "detect") {
    const { flatEmbeddings, n, dim, threshold, timestamps } = data as {
      flatEmbeddings: Float32Array;
      n: number;
      dim: number;
      threshold: number;
      timestamps?: number[];
    };

    // Unpack flat buffer back into array of row views (zero-copy)
    const embeddings: Float32Array[] = [];
    for (let i = 0; i < n; i++) {
      embeddings.push(flatEmbeddings.subarray(i * dim, (i + 1) * dim));
    }

    const groups = await detectEmbeddingCommunities(
      embeddings,
      threshold,
      timestamps,
      (current, total) => {
        self.postMessage({ type: "detectionProgress", current, total });
      },
    );
    self.postMessage({ type: "detectionResults", groups });
  }

  if (type === "detectBlock") {
    const {
      flatA,
      rowsA,
      offsetA,
      flatB,
      rowsB,
      offsetB,
      dim,
      threshold,
      sameBlock,
    } = data as {
      flatA: Float32Array;
      rowsA: number;
      offsetA: number;
      flatB: Float32Array;
      rowsB: number;
      offsetB: number;
      dim: number;
      threshold: number;
      sameBlock: boolean;
    };

    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < rowsA; i++) {
      const startJ = sameBlock ? i + 1 : 0;
      for (let j = startJ; j < rowsB; j++) {
        let dot = 0;
        const aBase = i * dim;
        const bBase = j * dim;
        for (let k = 0; k < dim; k++) dot += flatA[aBase + k] * flatB[bBase + k];
        if (dot >= threshold) pairs.push([offsetA + i, offsetB + j]);
      }
    }

    self.postMessage({ type: "blockResults", pairs });
  }

  if (type === "detectSmart") {
    const {
      flatEmbeddings,
      n,
      dim,
      threshold,
      buckets,
      bucketWindowMs,
      comparePairs,
      timestamps,
      windowMs
    } = data as {
      flatEmbeddings: Float32Array;
      n: number;
      dim: number;
      threshold: number;
      buckets: number[][];
      bucketWindowMs?: Array<number | null>;
      comparePairs?: number[][];
      timestamps?: number[];
      windowMs?: number;
    };

    // Unpack flat buffer into row views (zero-copy)
    const embeddings: Float32Array[] = [];
    for (let i = 0; i < n; i++)
      embeddings.push(flatEmbeddings.subarray(i * dim, (i + 1) * dim));

    const allGroups: number[][] = [];
    let lastPartialGroupCount = 0;
    for (let bi = 0; bi < buckets.length; bi++) {
      const bucket = buckets[bi];
      // Union-Find over bucket indices
      const parent = bucket.map((_, j) => j);
      const find = (x: number): number =>
        parent[x] === x ? x : (parent[x] = find(parent[x]));
      const union = (a: number, b: number) => {
        parent[find(a)] = find(b);
      };

      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const configuredWindow = bucketWindowMs?.[bi];
          const bucketWindow =
            configuredWindow === undefined ? windowMs : configuredWindow;
          if (
            timestamps &&
            bucketWindow !== null &&
            Number.isFinite(bucketWindow) &&
            bucketWindow > 0 &&
            Math.abs(timestamps[bucket[i]] - timestamps[bucket[j]]) > bucketWindow
          ) {
            continue;
          }
          const a = embeddings[bucket[i]];
          const b = embeddings[bucket[j]];
          let dot = 0;
          for (let k = 0; k < dim; k++) dot += a[k] * b[k];
          if (dot >= threshold) union(i, j);
        }
      }

      const components = new Map<number, number[]>();
      for (let i = 0; i < bucket.length; i++) {
        const root = find(i);
        if (!components.has(root)) components.set(root, []);
        components.get(root)!.push(bucket[i]); // original embedding indices
      }
      for (const [, members] of components)
        if (members.length >= 2) allGroups.push(members);

      const shouldReportProgress = bi % 100 === 0 || bi === buckets.length - 1;
      if (shouldReportProgress && allGroups.length !== lastPartialGroupCount) {
        lastPartialGroupCount = allGroups.length;
        self.postMessage({ type: "partialDetectionResults", groups: allGroups });
      }

      if (shouldReportProgress)
        self.postMessage({ type: "detectionProgress", current: bi + 1, total: buckets.length });
    }

    for (const pair of comparePairs || []) {
      const a = embeddings[pair[0]];
      const b = embeddings[pair[1]];
      if (!a || !b) continue;
      let dot = 0;
      for (let k = 0; k < dim; k++) dot += a[k] * b[k];
      if (dot >= threshold) allGroups.push(pair);
    }

    self.postMessage({ type: "detectionResults", groups: allGroups });
  }
});
