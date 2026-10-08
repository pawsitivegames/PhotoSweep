/**
 * Pure embedding kernels shared by the production worker and focused tests.
 * Keep browser/extension APIs out of this module so its behavior is directly
 * testable without booting the worker runtime.
 */

export function matMul(
  A: Float32Array[],
  startA: number,
  endA: number,
  B: Float32Array[],
  startB: number,
  endB: number,
  dim: number
): Float32Array {
  const rowsA = endA - startA
  const rowsB = endB - startB
  const result = new Float32Array(rowsA * rowsB)

  for (let i = 0; i < rowsA; i++) {
    const aRow = A[startA + i]
    for (let j = 0; j < rowsB; j++) {
      const bRow = B[startB + j]
      let dot = 0
      for (let k = 0; k < dim; k++) dot += aRow[k] * bRow[k]
      result[i * rowsB + j] = dot
    }
  }

  return result
}

export function topK(
  arr: Float32Array,
  k: number
): { values: number[]; indices: number[] } {
  const limit = Math.min(k, arr.length)
  const indexed: Array<{ val: number; idx: number }> = []
  for (let i = 0; i < arr.length; i++) indexed.push({ val: arr[i], idx: i })

  // Match production's descending score order and make its stable tie order explicit.
  indexed.sort((a, b) => {
    const scoreOrder = b.val - a.val
    return scoreOrder === 0 ? a.idx - b.idx : scoreOrder
  })

  const values: number[] = []
  const indices: number[] = []
  for (let i = 0; i < limit; i++) {
    values.push(indexed[i].val)
    indices.push(indexed[i].idx)
  }

  return { values, indices }
}

/**
 * The full-scan community algorithm used by embedder.worker.ts. Embeddings are
 * L2-normalized, so their dot products are cosine similarities. Each item
 * votes for its above-threshold neighborhood; the largest neighborhoods claim
 * their members first, yielding non-overlapping groups.
 */
export async function detectEmbeddingCommunities(
  embeddings: Float32Array[],
  threshold: number,
  _timestamps?: number[],
  onProgress?: (current: number, total: number) => void
): Promise<number[][]> {
  const n = embeddings.length
  if (n < 2) return []

  const dim = embeddings[0].length
  const batchSize = 128
  const minCommunitySize = 2
  const extractedCommunities: number[][] = []
  let sortMaxSize = Math.min(Math.max(2 * minCommunitySize, 50), n)

  for (let startIdx = 0; startIdx < n; startIdx += batchSize) {
    const endIdx = Math.min(startIdx + batchSize, n)
    const batchLen = endIdx - startIdx
    const cosScores = matMul(embeddings, startIdx, endIdx, embeddings, 0, n, dim)

    for (let i = 0; i < batchLen; i++) {
      const row = cosScores.subarray(i * n, (i + 1) * n)
      const topKMin = topK(row, minCommunitySize)
      if (topKMin.values[topKMin.values.length - 1] < threshold) continue

      let topKResult = topK(row, sortMaxSize)
      while (
        topKResult.values[topKResult.values.length - 1] > threshold &&
        sortMaxSize < n
      ) {
        sortMaxSize = Math.min(2 * sortMaxSize, n)
        topKResult = topK(row, sortMaxSize)
      }

      const cluster: number[] = []
      for (let j = 0; j < topKResult.values.length; j++) {
        if (topKResult.values[j] < threshold) break
        cluster.push(topKResult.indices[j])
      }

      if (cluster.length >= minCommunitySize) extractedCommunities.push(cluster)
    }

    onProgress?.(endIdx, n)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  extractedCommunities.sort((a, b) => b.length - a.length)

  const uniqueCommunities: number[][] = []
  const assignedIds = new Set<number>()
  for (const community of extractedCommunities) {
    const nonOverlapping = community
      .slice()
      .sort((a, b) => a - b)
      .filter((idx) => !assignedIds.has(idx))

    if (nonOverlapping.length >= minCommunitySize) {
      uniqueCommunities.push(nonOverlapping)
      for (const idx of nonOverlapping) assignedIds.add(idx)
    }
  }

  uniqueCommunities.sort((a, b) => b.length - a.length)
  return uniqueCommunities
}
