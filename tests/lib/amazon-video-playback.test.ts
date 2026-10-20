import { afterEach, describe, expect, it, vi } from "vitest"

import {
  MAX_AMAZON_VIDEO_PLAYBACK_BYTES,
  fetchAmazonVideoPlaybackBlob
} from "../../lib/provider-retrieval"

const playbackUrl =
  "https://download-photos.amazon.ca/v2/download/signed/video-1/alt/video_transcode?ownerId=owner-1&y=720"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Amazon full-video retrieval", () => {
  it("fetches the verified route with provider credentials and returns a video blob", async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-type": "video/mp4",
          "content-length": "3"
        }
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    const blob = await fetchAmazonVideoPlaybackBlob(
      playbackUrl,
      controller.signal
    )

    expect(fetchMock).toHaveBeenCalledWith(playbackUrl, {
      credentials: "include",
      redirect: "error",
      signal: expect.any(AbortSignal)
    })
    expect(fetchMock.mock.calls[0][1].signal).not.toBe(controller.signal)
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false)
    expect(blob.type).toBe("video/mp4")
    expect(blob.size).toBe(3)
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([
      1, 2, 3
    ])
  })

  it("rejects arbitrary Amazon URLs before fetching", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      fetchAmazonVideoPlaybackBlob(
        "https://download-photos.amazon.ca/private/export?ownerId=owner-1",
        new AbortController().signal
      )
    ).rejects.toThrow(/approved video stream/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects an aborted request before network access", async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      fetchAmazonVideoPlaybackBlob(playbackUrl, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("propagates viewer cancellation to the in-flight network request", async () => {
    const controller = new AbortController()
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        )
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const request = fetchAmazonVideoPlaybackBlob(playbackUrl, controller.signal)
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: "AbortError" })
    expect(requestSignal?.aborted).toBe(true)
  })

  it("rejects non-video and oversized responses before creating a blob", async () => {
    const controller = new AbortController()
    const nonVideoFetch = vi.fn().mockResolvedValue(
      new Response("not a video", {
        status: 200,
        headers: { "content-type": "text/html" }
      })
    )
    vi.stubGlobal("fetch", nonVideoFetch)
    await expect(
      fetchAmazonVideoPlaybackBlob(playbackUrl, controller.signal)
    ).rejects.toThrow(/non-video/i)

    const largeFetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: {
          "content-type": "video/mp4",
          "content-length": String(MAX_AMAZON_VIDEO_PLAYBACK_BYTES + 1)
        }
      })
    )
    vi.stubGlobal("fetch", largeFetch)
    await expect(
      fetchAmazonVideoPlaybackBlob(playbackUrl, controller.signal)
    ).rejects.toThrow(/too large/i)
  })

  it("cancels an oversized response body rejected by its content-length", async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(new Uint8Array([1]))
      },
      cancel
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: {
            "content-type": "video/mp4",
            "content-length": String(MAX_AMAZON_VIDEO_PLAYBACK_BYTES + 1)
          }
        })
      )
    )

    await expect(
      fetchAmazonVideoPlaybackBlob(playbackUrl, controller.signal)
    ).rejects.toThrow(/too large/i)
    expect(cancel).toHaveBeenCalled()
  })

  it("cancels a streamed response when it exceeds the playback byte cap", async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(new Uint8Array([1, 2, 3, 4]))
      },
      cancel
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: { "content-type": "video/mp4" }
        })
      )
    )

    await expect(
      fetchAmazonVideoPlaybackBlob(playbackUrl, controller.signal, {
        maxBytes: 3
      })
    ).rejects.toThrow(/too large/i)
    expect(cancel).toHaveBeenCalled()
  })

  it("rejects a partial response unless it contains the full video from byte zero", async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2]), {
          status: 206,
          headers: {
            "content-type": "video/mp4",
            "content-length": "2",
            "content-range": "bytes 0-1/5"
          }
        })
      )
    )

    await expect(
      fetchAmazonVideoPlaybackBlob(playbackUrl, controller.signal)
    ).rejects.toThrow(/only part/i)
  })
})
