import type { GpdAlbum, GptkResultMessage } from "./types"

const DEFAULT_ALBUM_LIST_ERROR = "Could not load a complete album list."
const ALBUM_SESSION_MISMATCH_ERROR =
  "The provider page session changed while albums were loading. Reconnect and refresh the album list."

export type ProviderAlbumResponse =
  | { kind: "success"; albums: GpdAlbum[] }
  | { kind: "error"; error: string }
  | { kind: "session-mismatch"; error: string }

export function resolveProviderAlbumResponse(
  result: Pick<
    GptkResultMessage,
    "success" | "data" | "error" | "providerSessionId"
  >,
  expectedProviderSessionId: string
): ProviderAlbumResponse {
  if (!result.success) {
    return {
      kind: "error",
      error: result.error || DEFAULT_ALBUM_LIST_ERROR
    }
  }

  if (result.providerSessionId !== expectedProviderSessionId) {
    return {
      kind: "session-mismatch",
      error: ALBUM_SESSION_MISMATCH_ERROR
    }
  }

  const albums = result.data
  if (
    !Array.isArray(albums) ||
    !albums.every((album) => {
      if (!album || typeof album !== "object") return false
      const candidate = album as Partial<GpdAlbum>
      return (
        typeof candidate.mediaKey === "string" &&
        candidate.mediaKey.length > 0 &&
        typeof candidate.title === "string"
      )
    })
  ) {
    return {
      kind: "error",
      error: result.error || DEFAULT_ALBUM_LIST_ERROR
    }
  }

  return { kind: "success", albums: albums as GpdAlbum[] }
}
