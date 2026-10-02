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
  if (
    candidate.verificationSource !== undefined &&
    candidate.verificationSource !== "local-original-bytes" &&
    candidate.verificationSource !== "provider-fingerprint" &&
    candidate.verificationSource !== "provider-checksum"
  ) {
    return false
  }

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

export function normalizedMediaKind(item: GpdMediaItem):
  | "photo"
  | "video"
  | "live-photo"
  | "unknown" {
  if (item.mediaKind) return item.mediaKind
  if (Number.isFinite(item.duration) && (item.duration ?? 0) > 0) return "video"
  return "photo"
}

function normalizedHashValue(value: string): string {
  const trimmed = value.trim()
  return /^[a-f0-9]+$/i.test(trimmed) ? trimmed.toLowerCase() : trimmed
}

/**
 * Candidate buckets are source- and media-kind-scoped. Only locally computed
 * SHA-256 over original bytes deliberately shares a namespace across providers.
 */
export function contentHashBucketIdentity(item: GpdMediaItem): string | null {
  const hash = getTrustedContentHash(item)
  const mediaKind = normalizedMediaKind(item)
  if (!hash || mediaKind === "unknown") return null

  const isLocalOriginalSha256 =
    hash.algorithm === "sha256" &&
    hash.verificationSource === "local-original-bytes"
  const unpairedLivePhoto =
    mediaKind === "live-photo" && hash.contentRole !== "paired-live-photo"
  if ((!isLocalOriginalSha256 || unpairedLivePhoto) && !item.provider) {
    return null
  }

  const namespace =
    isLocalOriginalSha256 && !unpairedLivePhoto
      ? "cross-provider:local-original-bytes"
      : `provider:${item.provider}:${unpairedLivePhoto ? "unpaired-live-photo" : hash.verificationSource ?? "legacy-source-unknown"}`
  return [
    namespace,
    mediaKind,
    hash.algorithm,
    hash.provenance,
    normalizedHashValue(hash.value)
  ].join(":")
}

export function verifiedContentHashIdentity(item: GpdMediaItem): string | null {
  const hash = getTrustedContentHash(item)
  if (
    !hash ||
    hash.algorithm !== "sha256" ||
    hash.verificationSource !== "local-original-bytes"
  ) {
    return null
  }
  const mediaKind = normalizedMediaKind(item)
  if (mediaKind === "unknown") return null
  if (
    mediaKind === "live-photo" &&
    hash.contentRole !== "paired-live-photo"
  ) {
    return null
  }
  return [
    "cross-provider:local-original-bytes",
    mediaKind,
    hash.algorithm,
    hash.provenance,
    normalizedHashValue(hash.value)
  ].join(":")
}

export function legacyContentHashBucketIdentity(
  item: GpdMediaItem
): string | null {
  const hash = item.exactContentHash?.trim()
  const mediaKind = normalizedMediaKind(item)
  if (!hash || !item.provider || mediaKind === "unknown") return null
  return `provider:${item.provider}:legacy:${mediaKind}:${normalizedHashValue(hash)}`
}

function hasSameVerifiedContentHash(items: GpdMediaItem[]): boolean {
  const identities = items.map(verifiedContentHashIdentity)
  return (
    identities.length > 1 &&
    identities.every((identity): identity is string => Boolean(identity)) &&
    allSame(identities)
  )
}

function hasSameScopedContentHash(items: GpdMediaItem[]): boolean {
  const identities = items.map(contentHashBucketIdentity)
  return (
    identities.length > 1 &&
    identities.every((identity): identity is string => Boolean(identity)) &&
    allSame(identities)
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

  const hasVerifiedHash = hasSameVerifiedContentHash(items)
  if (hasVerifiedHash) {
    const hash = getTrustedContentHash(items[0])
    reasons.push(`same original-byte SHA-256 (${hash?.algorithm ?? "unknown"})`)
  } else if (hasSameScopedContentHash(items)) {
    reasons.push("same provider-scoped content hash (not locally verified)")
  }

  const legacyContentHashes = presentValues(
    items,
    (item) => legacyContentHashBucketIdentity(item) || undefined
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

  const takenDates = presentValues(items, (item) =>
    item.timestampProvenance === "capture" ? item.timestamp : undefined
  )
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

  const sameReliableCaptureDate =
    takenDates.length === items.length && allSame(takenDates)
  const sameReliableSize = sizes.length === items.length && allSame(sizes)
  const metadataDuplicateCandidate =
    items.length > 1 &&
    fileNames.length === items.length &&
    dimensions.length === items.length &&
    allSame(fileNames) &&
    allSame(dimensions) &&
    (sameReliableCaptureDate || sameReliableSize)

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
