import { describe, expect, it } from "vitest"

import { resolveProviderAlbumResponse } from "../../lib/provider-album-response"

describe("resolveProviderAlbumResponse", () => {
  it("preserves the provider error when a failed result has no session ID", () => {
    expect(
      resolveProviderAlbumResponse(
        {
          success: false,
          error: "The provider bridge could not reach the Photos frame."
        },
        "icloud-session"
      )
    ).toEqual({
      kind: "error",
      error: "The provider bridge could not reach the Photos frame."
    })
  })

  it.each([undefined, "another-session"])(
    "rejects a successful result whose session ID is %s",
    (providerSessionId) => {
      expect(
        resolveProviderAlbumResponse(
          {
            success: true,
            data: [],
            providerSessionId
          },
          "icloud-session"
        )
      ).toEqual({
        kind: "session-mismatch",
        error:
          "The provider page session changed while albums were loading. Reconnect and refresh the album list."
      })
    }
  )

  it("accepts a complete album list from the expected provider session", () => {
    const albums = [{ mediaKey: "icloud-album:test", title: "Test album" }]

    expect(
      resolveProviderAlbumResponse(
        {
          success: true,
          data: albums,
          providerSessionId: "icloud-session"
        },
        "icloud-session"
      )
    ).toEqual({ kind: "success", albums })
  })
})
