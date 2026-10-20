import type { EmbeddingRecord } from "./embedding-cache"

export interface CacheDiagnosticsItem {
  mediaKey: string
  hasEmbedding: boolean
  embeddingDimensions: number | null
  scannedAt: string | null
  model: string | null
  metadata: EmbeddingRecord["metadata"] | null
}

export interface CacheDiagnosticsReport {
  reportId: string
  createdAt: string
  totalRecords: number
  recordsWithMetadata: number
  items: CacheDiagnosticsItem[]
}

function formatTimestamp(value: number | undefined): string | null {
  if (value === undefined || value === null) return null
  return new Date(value).toISOString()
}

export function buildCacheDiagnosticsReport(
  records: EmbeddingRecord[]
): CacheDiagnosticsReport {
  const items = records
    .map((record) => ({
      mediaKey: record.mediaKey,
      hasEmbedding: record.embedding instanceof Float32Array,
      embeddingDimensions:
        record.embedding instanceof Float32Array
          ? record.embedding.length
          : null,
      scannedAt: formatTimestamp(record.scannedAt),
      model: record.model ?? null,
      metadata: record.metadata ?? null
    }))
    .sort((a, b) => a.mediaKey.localeCompare(b.mediaKey))

  return {
    reportId: `gpd-cache-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    createdAt: new Date().toISOString(),
    totalRecords: items.length,
    recordsWithMetadata: items.filter((item) => item.metadata !== null).length,
    items
  };
}
