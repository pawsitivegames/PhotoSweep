import type { FavoriteSource, FavoriteStatus, GpdMediaItem } from "./types"

const FAVORITE_STATUSES = new Set<FavoriteStatus>([
  "favorite",
  "not-favorite",
  "unknown"
])
const FAVORITE_SOURCES = new Set<FavoriteSource>([
  "provider-metadata",
  "provider-lookup",
  "unavailable"
])

/** Preserve unknown as unknown; the legacy boolean is only a fallback. */
export function favoriteStatusForItem(
  item: GpdMediaItem | undefined
): FavoriteStatus {
  if (!item) return "unknown"
  // A positive signal always wins over contradictory/stale negative metadata.
  if (item.isFavorite === true) return "favorite"
  if (item.favoriteStatus !== undefined) {
    if (
      typeof item.favoriteStatus !== "string" ||
      !FAVORITE_STATUSES.has(item.favoriteStatus)
    ) {
      return "unknown"
    }
    if (item.favoriteStatus === "favorite") return "favorite"
    if (item.favoriteStatus === "not-favorite") return "not-favorite"
    // An explicit unknown is a fresh, authoritative lack of evidence. A
    // cached legacy `false` must not turn that into a destructive negative.
    return "unknown"
  }
  if (item.isFavorite === false) return "not-favorite"
  return "unknown"
}

export function favoriteSourceForItem(
  item: GpdMediaItem | undefined
): FavoriteSource {
  if (!item) return "unavailable"
  if (
    item.isFavorite === true &&
    item.favoriteStatus === "not-favorite"
  ) {
    return "unavailable"
  }
  if (
    item.isFavorite === false &&
    item.favoriteStatus === "favorite"
  ) {
    return "unavailable"
  }
  if (
    item.favoriteStatus !== undefined &&
    (typeof item.favoriteStatus !== "string" ||
      !FAVORITE_STATUSES.has(item.favoriteStatus))
  ) {
    return "unavailable"
  }
  if (
    typeof item.favoriteSource === "string" &&
    FAVORITE_SOURCES.has(item.favoriteSource)
  ) {
    return item.favoriteSource
  }
  if (
    typeof item.favoriteStatus === "string" &&
    FAVORITE_STATUSES.has(item.favoriteStatus)
  ) {
    return item.favoriteStatus === "unknown"
      ? "unavailable"
      : "provider-metadata"
  }
  return typeof item?.isFavorite === "boolean"
    ? "provider-metadata"
    : "unavailable"
}

export function isConfirmedFavorite(item: GpdMediaItem | undefined): boolean {
  return favoriteStatusForItem(item) === "favorite"
}
