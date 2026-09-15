import type {
  ContentHashEvidence,
  DuplicateEvidenceLevel,
  DuplicateGroup,
  DuplicateRelationship,
  GpdMediaItem
} from "./types"

export const DUPLICATE_CLASSIFICATION_VERSION = 2 as const
export const STRONG_DUPLICATE_SIMILARITY = 0.97

export interface DuplicateClassification {
  /** Legacy coarse kind; only verified identity maps to `exact`. */
  duplicateKind: "exact" | "similar"
  evidenceLevel: DuplicateEvidenceLevel
  relationship?: DuplicateRelationship
  matchReasons: string[]
  canProposeTrash: boolean
  classificationVersion: typeof DUPLICATE_CLASSIFICATION_VERSION
}

function allSame<T>(values: T[]): boolean {
  return values.length > 1 && values.every((value) => value === values[0])
}

function presentValues<T>(
  items: GpdMediaItem[],
  read: (item: GpdMediaItem) => T | undefined
): T[] {
  return items
    .map(read)
    .filter((value): value is T => value !== undefined && value !== null)
}

function fileStem(fileName: string | undefined): string | undefined {
  const normalized = fileName?.trim().toLowerCase()
  if (!normalized) return undefined
  return normalized.replace(/\.[a-z0-9]{1,8}$/i, "")
}

function fileExtension(fileName: string | undefined): string | undefined {
  const normalized = fileName?.trim().toLowerCase()
  if (!normalized) return undefined
  const match = normalized.match(/\.([a-z0-9]{1,8})$/i)
  return match?.[1]
}

const RAW_EXTENSIONS = new Set([
  "arw",
  "cr2",
  "cr3",
  "dng",
  "nef",
  "nrw",
  "orf",
  "pef",
  "raf",
  "raw",
  "rw2",
  "srw"
])
const JPEG_EXTENSIONS = new Set(["jpg", "jpeg", "jfif"])

/**
 * Runtime validation is required because media items can come from provider
 * scripts or old chrome.storage records rather than TypeScript callers.
 */
export function isTrustedContentHash(
  value: unknown
): value is ContentHashEvidence {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ContentHashEvidence>
  const hash = typeof candidate.value === "string" ? candidate.value.trim() : ""
  if (!hash || candidate.provenance !== "original-content") return false

  if (candidate.algorithm === "md5") return /^[a-f0-9]{32}$/i.test(hash)
  if (candidate.algorithm === "sha256") return /^[a-f0-9]{64}$/i.test(hash)
  if (candidate.algorithm === "provider-fingerprint") {
    return /^\S{8,}$/i.test(hash)
  }
  return false
}

export function getTrustedContentHash(
  item: GpdMediaItem
): ContentHashEvidence | null {
  return isTrustedContentHash(item.contentHash) ? item.contentHash : null
}

function hashIdentity(hash: ContentHashEvidence): string {
  return `${hash.algorithm}:${hash.provenance}:${hash.value.trim().toLowerCase()}`
}

function hasSameTrustedContentHash(items: GpdMediaItem[]): boolean {
  const hashes = items.map(getTrustedContentHash)
  return (
    hashes.length > 1 &&
    hashes.every((hash): hash is ContentHashEvidence => Boolean(hash)) &&
    allSame(hashes.map(hashIdentity))
  )
}

function isRelatedRawJpegPair(items: GpdMediaItem[]): boolean {
  if (items.length !== 2) return false
  const stems = items.map((item) => fileStem(item.fileName))
  const extensions = items.map((item) => fileExtension(item.fileName))
  if (!stems[0] || stems[0] !== stems[1]) return false
  const [first, second] = extensions
  if (!first || !second || first === second) return false
  return (
    (RAW_EXTENSIONS.has(first) && JPEG_EXTENSIONS.has(second)) ||
    (RAW_EXTENSIONS.has(second) && JPEG_EXTENSIONS.has(first))
  )
}

export function classifyDuplicateItems(
  items: GpdMediaItem[],
  visualSimilarity?: number
): DuplicateClassification {
  const reasons: string[] = []

  const dedupKeys = presentValues(items, (item) => item.dedupKey)
  const uniqueDedupKeys = new Set(dedupKeys)
  const hasRepeatedProviderIdentity =
    dedupKeys.length > 1 && uniqueDedupKeys.size < dedupKeys.length
  if (hasRepeatedProviderIdentity) {
    reasons.push(
      uniqueDedupKeys.size === 1
        ? "same provider asset identity (not content equality)"
        : "repeated provider asset reference (not content equality)"
    )
  }

  const hasVerifiedHash = hasSameTrustedContentHash(items)
  if (hasVerifiedHash) {
    const hash = getTrustedContentHash(items[0])
    reasons.push(`same original-content hash (${hash?.algorithm ?? "unknown"})`)
  }

  const legacyContentHashes = presentValues(
    items,
    (item) => item.exactContentHash?.trim() || undefined
  )
  const hasSameLegacyHash =
    legacyContentHashes.length === items.length && allSame(legacyContentHashes)
  if (hasSameLegacyHash && !hasVerifiedHash) {
    reasons.push("same legacy content hash (unverified)")
  }

  const fileNames = presentValues(items, (item) => item.fileName)
  if (fileNames.length === items.length && allSame(fileNames)) {
    reasons.push("same filename")
  }
  const fileStems = presentValues(items, (item) => fileStem(item.fileName))
  if (fileStems.length === items.length && allSame(fileStems)) {
    reasons.push("same filename stem")
  }

  const dimensions = items
    .map((item) =>
      item.resWidth && item.resHeight
        ? `${item.resWidth}x${item.resHeight}`
        : undefined
    )
    .filter((value): value is string => !!value)
  if (dimensions.length === items.length && allSame(dimensions)) {
    reasons.push("same dimensions")
  }

  const takenDates = presentValues(items, (item) => item.timestamp)
  if (takenDates.length === items.length && allSame(takenDates)) {
    reasons.push("same taken date")
  }

  const sizes = presentValues(items, (item) => item.size)
  if (sizes.length === items.length && allSame(sizes)) {
    reasons.push("same file size")
  }

  const durations = presentValues(items, (item) => item.duration)
  if (durations.length === items.length && allSame(durations)) {
    reasons.push("same duration")
  }

  const metadataDuplicateCandidate =
    items.length > 1 &&
    fileNames.length === items.length &&
    dimensions.length === items.length &&
    takenDates.length === items.length &&
    allSame(fileNames) &&
    allSame(dimensions) &&
    allSame(takenDates) &&
    (sizes.length === 0 ||
      (sizes.length === items.length && allSame(sizes)))

  const videoMetadataDuplicateCandidate =
    items.length > 1 &&
    durations.length === items.length &&
    allSame(durations) &&
    ((fileNames.length === items.length && allSame(fileNames)) ||
      (fileStems.length === items.length && allSame(fileStems)) ||
      (sizes.length === items.length && allSame(sizes))) &&
    ((dimensions.length === items.length && allSame(dimensions)) ||
      (fileStems.length === items.length && allSame(fileStems)) ||
      (sizes.length === items.length && allSame(sizes)))

  const strongVisualCandidate =
    Number.isFinite(visualSimilarity) &&
    (visualSimilarity ?? 0) >= STRONG_DUPLICATE_SIMILARITY
  if (strongVisualCandidate) {
    reasons.push(
      `visual similarity ${Math.round((visualSimilarity ?? 0) * 100)}%`
    )
  }

  const relatedFormatEdit = isRelatedRawJpegPair(items)
  if (relatedFormatEdit) reasons.push("RAW/JPEG format relationship")

  const evidenceLevel: DuplicateEvidenceLevel = hasVerifiedHash
    ? "verified_identical"
    : metadataDuplicateCandidate ||
        videoMetadataDuplicateCandidate ||
        strongVisualCandidate
      ? "strong_duplicate_candidate"
      : "similar"

  const relationship: DuplicateRelationship | undefined =
    hasRepeatedProviderIdentity
      ? "same_provider_asset"
      : relatedFormatEdit
        ? "related_format_edit"
        : undefined

  return {
    duplicateKind:
      evidenceLevel === "verified_identical" && !relationship
        ? "exact"
        : "similar",
    evidenceLevel,
    ...(relationship ? { relationship } : {}),
    matchReasons: reasons,
    canProposeTrash:
      items.length > 1 && !hasRepeatedProviderIdentity && !relatedFormatEdit,
    classificationVersion: DUPLICATE_CLASSIFICATION_VERSION
  }
}

export function classifyDuplicateGroup(
  group: DuplicateGroup,
  mediaItems: Record<string, GpdMediaItem>
): DuplicateClassification {
  const items = group.mediaKeys
    .map((key) => mediaItems[key])
    .filter((item): item is GpdMediaItem => !!item)
  return classifyDuplicateItems(items, group.similarity)
}
