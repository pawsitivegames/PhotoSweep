import { classifyDuplicateGroup } from "./duplicate-classifier"
import type {
  DuplicateEvidenceLevel,
  DuplicateGroup,
  DuplicateRelationship,
  GpdMediaItem
} from "./types"

export interface DeleteReportItem {
  duplicateGroupId: string
  action: "keep" | "trash"
  mediaKey: string
  dedupKey: string
  fileName: string | null
  takenAt: string | null
  uploadedAt: string | null
  resolution: string | null
  isOriginalQuality: boolean | null
  takesUpSpace: boolean | null
  spaceTaken: number | null
  similarity: number
  duplicateKind: "exact" | "similar"
  evidenceLevel: DuplicateEvidenceLevel
  relationship: DuplicateRelationship | null
  canProposeTrash: boolean
  matchReasons: string[]
  reason: string
  googlePhotosUrl: string | null
}

export interface DeleteReport {
  reportId: string
  operationId?: string
  createdAt: string
  totalGroupsAffected: number
  totalItemsKept: number
  totalItemsSelectedForTrash: number
  trashBatchSize: number
  items: DeleteReportItem[]
}

export function formatDeleteReportTimestamp(
  value: number | undefined
): string | null {
  if (value === undefined || value === null) return null
  return new Date(value).toISOString()
}

export function formatDeleteReportResolution(
  item: GpdMediaItem
): string | null {
  if (!item.resWidth || !item.resHeight) return null
  return `${item.resWidth}x${item.resHeight}`
}

export function buildDeleteReport(params: {
  groups: DuplicateGroup[]
  mediaItems: Record<string, GpdMediaItem>
  selectedGroupIds: Set<string>
  getKept: (group: DuplicateGroup) => Set<string>
  mediaKeysToTrash: string[]
  trashBatchSize: number
  operationId?: string
}): DeleteReport {
  const trashSet = new Set(params.mediaKeysToTrash)
  const reportId = `gpd-delete-report-${new Date().toISOString().replace(/[:.]/g, "-")}`
  const items: DeleteReportItem[] = []

  for (const group of params.groups) {
    if (!params.selectedGroupIds.has(group.id)) continue
    if (!group.mediaKeys.some((mediaKey) => trashSet.has(mediaKey))) continue
    const groupKeySet = new Set(group.mediaKeys)
    const validKeptKeys = [...params.getKept(group)].filter((key) =>
      groupKeySet.has(key)
    )
    const keptSet = new Set(
      validKeptKeys.length > 0
        ? validKeptKeys
        : [group.originalMediaKey].filter((key) => groupKeySet.has(key))
    )
    // Recompute from current item evidence so legacy stored `exact` values
    // cannot make a delete report claim verified identity.
    const classification = classifyDuplicateGroup(group, params.mediaItems)
    for (const mediaKey of group.mediaKeys) {
      if (!keptSet.has(mediaKey) && !trashSet.has(mediaKey)) continue
      const item = params.mediaItems[mediaKey]
      if (!item) continue
      const action = trashSet.has(mediaKey) ? "trash" : "keep"
      items.push({
        duplicateGroupId: group.id,
        action,
        mediaKey: item.mediaKey,
        dedupKey: item.dedupKey,
        fileName: item.fileName ?? null,
        takenAt: formatDeleteReportTimestamp(item.timestamp),
        uploadedAt: formatDeleteReportTimestamp(item.creationTimestamp),
        resolution: formatDeleteReportResolution(item),
        isOriginalQuality: item.isOriginalQuality ?? null,
        takesUpSpace: item.takesUpSpace ?? null,
        spaceTaken: item.spaceTaken ?? null,
        similarity: group.similarity,
        duplicateKind: classification.duplicateKind,
        evidenceLevel: classification.evidenceLevel,
        relationship: classification.relationship ?? null,
        canProposeTrash: classification.canProposeTrash,
        matchReasons: classification.matchReasons,
        reason:
          action === "keep"
            ? "Selected keep item for duplicate group"
            : "Selected non-keep item for trash",
        googlePhotosUrl: item.productUrl ?? null
      })
    }
  }

  return {
    reportId,
    ...(params.operationId ? { operationId: params.operationId } : {}),
    createdAt: new Date().toISOString(),
    totalGroupsAffected: new Set(items.map((item) => item.duplicateGroupId))
      .size,
    totalItemsKept: items.filter((item) => item.action === "keep").length,
    totalItemsSelectedForTrash: items.filter((item) => item.action === "trash")
      .length,
    trashBatchSize: params.trashBatchSize,
    items
  }
}
