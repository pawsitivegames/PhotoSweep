import { classifyDuplicateGroup } from "./duplicate-classifier"
import {
  favoriteSourceForItem,
  favoriteStatusForItem
} from "./favorite-status"
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
  timestampValue: string | null
  timestampProvenance: string | null
  uploadedAt: string | null
  creationTimestampValue: string | null
  creationTimestampProvenance: string | null
  mediaKind: string
  mimeType: string | null
  favoriteStatus: string
  favoriteSource: string
  resolution: string | null
  isOriginalQuality: boolean | null
  contentHashAlgorithm: string | null
  contentHashVerificationSource: string | null
  videoPlaybackCapability: string
  hasLivePhotoAssociation: boolean
  takesUpSpace: boolean | null
  spaceTaken: number | null
  similarity: number
  duplicateKind: "exact" | "similar"
  evidenceLevel: DuplicateEvidenceLevel
  relationship: DuplicateRelationship | null
  canProposeTrash: boolean
  matchReasons: string[]
  reason: string
  /** Link to the item in the active provider's web app. */
  providerUrl: string | null
  /** @deprecated Kept for consumers of pre-parity JSON reports. */
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
        takenAt:
          item.timestampProvenance === "capture"
            ? formatDeleteReportTimestamp(item.timestamp)
            : null,
        timestampValue: formatDeleteReportTimestamp(item.timestamp),
        timestampProvenance: item.timestampProvenance ?? "unknown",
        uploadedAt:
          item.creationTimestampProvenance === "creation"
            ? formatDeleteReportTimestamp(item.creationTimestamp)
            : null,
        creationTimestampValue:
          formatDeleteReportTimestamp(item.creationTimestamp),
        creationTimestampProvenance:
          item.creationTimestampProvenance ?? "unknown",
        mediaKind:
          item.mediaKind ??
          (Number.isFinite(item.duration) && (item.duration ?? 0) > 0
            ? "video"
            : "unknown"),
        mimeType: item.mimeType ?? null,
        favoriteStatus: favoriteStatusForItem(item),
        favoriteSource: favoriteSourceForItem(item),
        resolution: formatDeleteReportResolution(item),
        isOriginalQuality: item.isOriginalQuality ?? null,
        contentHashAlgorithm: item.contentHash?.algorithm ?? null,
        contentHashVerificationSource:
          item.contentHash?.verificationSource ?? null,
        videoPlaybackCapability: item.videoPlaybackCapability ?? "unknown",
        hasLivePhotoAssociation: Boolean(item.livePhotoAssociationId),
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
        providerUrl: item.productUrl ?? null,
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
