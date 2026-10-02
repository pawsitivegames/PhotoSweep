import { describe, expect, it, vi } from "vitest"

import {
  fetchGoogleOriginalHash,
  GoogleOriginalReviewBudget,
  GOOGLE_ORIGINAL_ITEM_MAX_BYTES,
  GOOGLE_ORIGINAL_REVIEW_MAX_BYTES
} from "../../lib/google-original-fetch"

function response(params: {
  chunks?: number[]
  contentLength?: string
  contentType?: string
  url?: string
  status?: number
  ok?: boolean
  blockedRead?: Promise<never>
  onCancel?: () => void
}): Response {
  const bytes = new Uint8Array(params.chunks ?? [1, 2, 3])
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (params.blockedRead) {
        try {
          await params.blockedRead
        } catch {
          controller.error(new DOMException("Aborted", "AbortError"))
        }
        return
      }
      controller.enqueue(bytes)
      controller.close()
    },
    cancel() {
      params.onCancel?.()
    }
  })
  const result = new Response(body, {
    status: params.status ?? 200,
    headers: {
      "content-type": params.contentType ?? "image/jpeg",
      ...(params.contentLength ? { "content-length": params.contentLength } : {})
    }
  })
  Object.defineProperty(result, "url", {
    value: params.url ?? "https://lh3.googleusercontent.com/file/token",
    configurable: true
  })
  if (params.ok !== undefined) {
    Object.defineProperty(result, "ok", { value: params.ok, configurable: true })
  }
  return result
}

const base = {
  mediaKey: "google-media-1",
  scopeFingerprint: "scope-1",
  mediaKind: "photo" as const,
  resourceUrl: "https://lh3.google.com/file/signed?token=private",
  maxBytes: 25
}

describe("fetchGoogleOriginalHash", () => {
  it("hashes bounded original bytes and returns metadata only", async () => {
    const digest = new Uint8Array(32).fill(15)
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(base.resourceUrl)
      expect(init).toMatchObject({
        method: "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "follow"
      })
      return response({ contentLength: "3" })
    })

    const result = await fetchGoogleOriginalHash({
      ...base,
      fetcher,
      subtle: { digest: vi.fn(async () => digest.buffer) }
    })

    expect(result).toEqual({
      mediaKey: base.mediaKey,
      scopeFingerprint: base.scopeFingerprint,
      contentHash: {
        value: "0f".repeat(32),
        algorithm: "sha256",
        provenance: "original-content",
        verificationSource: "local-original-bytes",
        contentRole: "single-file"
      },
      byteLength: 3,
      mimeType: "image/jpeg"
    })
    expect(JSON.stringify(result)).not.toContain("private")
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("omits credentials for the verified video original route and keeps its identity separate", async () => {
    const videoBase = {
      ...base,
      mediaKind: "video" as const,
      resourceUrl: "https://video-downloads.googleusercontent.com/video/resource",
      mimeType: undefined
    }
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe("omit")
      return response({
        contentLength: "3",
        contentType: "video/mp4",
        url: "https://video-downloads.googleusercontent.com/video/resource"
      })
    })

    const result = await fetchGoogleOriginalHash({
      ...videoBase,
      fetcher,
      subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) }
    })

    expect(result.mimeType).toBe("video/mp4")
    expect(result.contentHash.contentRole).toBe("single-file")
  })

  it("labels only Live Photo still bytes and never implies paired motion identity", async () => {
    const result = await fetchGoogleOriginalHash({
      ...base,
      mediaKind: "live-photo",
      fetcher: async () => response({ contentLength: "3" }),
      subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) }
    })
    expect(result.contentHash.contentRole).toBe("live-photo-still")
  })

  it.each([
    ["wrong initial host", "https://accounts.google.com/file/private"],
    ["non-default initial port", "https://lh3.google.com:8443/file/private"],
    ["userinfo", "https://user@lh3.google.com/file/private"],
    ["fragment", "https://lh3.google.com/file/private#secret"],
    ["encoded separator", "https://lh3.google.com/file%2Fprivate"],
    ["raw traversal path", "https://lh3.google.com/../auth"],
    ["double-encoded traversal path", "https://lh3.google.com/%252e%252e/auth"]
  ])("rejects %s before fetching", async (_label, resourceUrl) => {
    const fetcher = vi.fn()
    await expect(
      fetchGoogleOriginalHash({ ...base, resourceUrl, fetcher })
    ).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    ["wrong final host", "https://accounts.google.com/auth"],
    ["wrong scheme", "http://lh3.googleusercontent.com/file"],
    ["non-default final port", "https://lh3.googleusercontent.com:8443/file"],
    ["userinfo", "https://user@lh3.googleusercontent.com/file"],
    ["traversal path", "https://lh3.googleusercontent.com/../auth"],
    ["fragment", "https://lh3.googleusercontent.com/file#token"]
  ])("rejects %s before reading the response body", async (_label, url) => {
    const reader = vi.fn()
    const badResponse = response({ url })
    Object.defineProperty(badResponse.body, "getReader", { value: reader })
    await expect(
      fetchGoogleOriginalHash({ ...base, fetcher: async () => badResponse })
    ).rejects.toThrow()
    expect(reader).not.toHaveBeenCalled()
  })

  it("rejects a declared size above the cap before reading", async () => {
    const badResponse = response({ contentLength: "26" })
    const getReader = vi.spyOn(badResponse.body!, "getReader")
    await expect(
      fetchGoogleOriginalHash({ ...base, fetcher: async () => badResponse })
    ).rejects.toThrow(/byte limit/)
    expect(getReader).not.toHaveBeenCalled()
  })

  it("cancels the response body when final URL validation rejects before reading", async () => {
    const onCancel = vi.fn()
    await expect(
      fetchGoogleOriginalHash({
        ...base,
        fetcher: async () =>
          response({
            url: "https://accounts.google.com/auth",
            onCancel
          })
      })
    ).rejects.toThrow(/final resource host/)
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it("rejects malformed known sizes before provider fetch", async () => {
    const fetcher = vi.fn()
    await expect(
      fetchGoogleOriginalHash({
        ...base,
        expectedByteLength: -1,
        fetcher
      })
    ).rejects.toThrow(/invalid or oversized original file size/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("stops a lying oversized stream without digesting its bytes", async () => {
    const digest = vi.fn(async () => new Uint8Array(32).buffer)
    await expect(
      fetchGoogleOriginalHash({
        ...base,
        maxBytes: 2,
        fetcher: async () => response({ chunks: [1, 2, 3] }),
        subtle: { digest }
      })
    ).rejects.toThrow(/streamed byte limit/)
    expect(digest).not.toHaveBeenCalled()
  })

  it("rejects MIME mismatch and inconsistent declared length", async () => {
    await expect(
      fetchGoogleOriginalHash({
        ...base,
        mediaKind: "video",
        resourceUrl: "https://video-downloads.googleusercontent.com/file",
        fetcher: async () =>
          response({
            contentType: "image/jpeg",
            url: "https://video-downloads.googleusercontent.com/file"
          })
      })
    ).rejects.toThrow(/media type/)
    await expect(
      fetchGoogleOriginalHash({
        ...base,
        fetcher: async () => response({ contentLength: "2" })
      })
    ).rejects.toThrow(/incomplete or inconsistent/)
  })

  it("aborts a pending body read without returning a digest", async () => {
    let rejectRead!: (error: Error) => void
    const blocked = new Promise<never>((_resolve, reject) => {
      rejectRead = reject
    })
    const controller = new AbortController()
    const digest = vi.fn(async () => new Uint8Array(32).buffer)
    const pending = fetchGoogleOriginalHash({
      ...base,
      signal: controller.signal,
      fetcher: async () => response({ blockedRead: blocked }),
      subtle: { digest }
    })
    controller.abort()
    rejectRead(new DOMException("Aborted", "AbortError"))
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(digest).not.toHaveBeenCalled()
  })
})

describe("GoogleOriginalReviewBudget", () => {
  it("freezes a scope cap and reserves concurrent calls before body reads", () => {
    const budget = new GoogleOriginalReviewBudget()
    const first = budget.reserve("session:scope", 25, 100)
    const second = budget.reserve("session:scope", 25, 100)
    expect(first.maxBytes).toBe(25)
    expect(second.maxBytes).toBe(25)
    expect(() => budget.reserve("session:scope", 25, 101)).toThrow(/budget changed/)
    first.complete(20)
    second.release()
    const third = budget.reserve("session:scope", 25, 100)
    expect(third.maxBytes).toBe(25)
    expect(GOOGLE_ORIGINAL_ITEM_MAX_BYTES).toBe(25 * 1024 * 1024)
    expect(GOOGLE_ORIGINAL_REVIEW_MAX_BYTES).toBe(100 * 1024 * 1024)
  })

  it("rejects aggregate over-reservation and caller cap increases", () => {
    const budget = new GoogleOriginalReviewBudget()
    const first = budget.reserve("s", 25, 30)
    const second = budget.reserve("s", 25, 30)
    expect(second.maxBytes).toBe(5)
    expect(() => budget.reserve("s", 25, 30)).toThrow(/reached its approved/)
    expect(() =>
      budget.reserve("s", GOOGLE_ORIGINAL_ITEM_MAX_BYTES + 1, 30)
    ).toThrow(/25 MiB/)
    first.release()
    second.release()
  })

  it("rejects an invalid known original size before reserving review bytes", () => {
    const budget = new GoogleOriginalReviewBudget()
    expect(() => budget.reserve("bad-size", 25, 100, -1)).toThrow(/invalid original file size/)
    const valid = budget.reserve("bad-size", 25, 100, 10)
    expect(valid.maxBytes).toBe(10)
    valid.release()
  })

  it("does not let rejected provider sizes consume the review-scope limit", () => {
    const budget = new GoogleOriginalReviewBudget()
    const invalidSizes: unknown[] = [-1, 0, 1.5, "10", 26]

    for (let index = 0; index < 32; index += 1) {
      expect(() =>
        budget.reserve(
          `rejected-review-${index}`,
          25,
          100,
          invalidSizes[index % invalidSizes.length]
        )
      ).toThrow()
    }

    const valid = budget.reserve("valid-review-after-rejections", 25, 100, 10)
    expect(valid.maxBytes).toBe(10)
    valid.release()
  })

  it("keeps failed or cancelled post-fetch reservations charged across retries", () => {
    const budget = new GoogleOriginalReviewBudget()
    const firstAttempt = budget.reserve("cancelled-review", 50, 100)
    firstAttempt.start()
    firstAttempt.consume(7)
    firstAttempt.release()

    const secondAttempt = budget.reserve("cancelled-review", 50, 100)
    expect(secondAttempt.maxBytes).toBe(50)
    secondAttempt.start()
    secondAttempt.consume(4)
    secondAttempt.release()

    expect(() => budget.reserve("cancelled-review", 1, 100)).toThrow(
      /reached its approved/
    )
  })

  it("releases a reservation only when no fetch was started", () => {
    const budget = new GoogleOriginalReviewBudget()
    const preflightFailure = budget.reserve("preflight-review", 50, 50)
    preflightFailure.release()
    const retry = budget.reserve("preflight-review", 50, 50)
    expect(retry.maxBytes).toBe(50)
  })

  it("charges successful unknown-length reads by actual bytes instead of the cap", () => {
    const budget = new GoogleOriginalReviewBudget()
    for (let index = 0; index < 15; index += 1) {
      const reservation = budget.reserve("small-successes", 25 * 1024 * 1024, 100 * 1024 * 1024)
      expect(reservation.maxBytes).toBe(25 * 1024 * 1024)
      reservation.start()
      reservation.consume(13_417)
      reservation.complete(13_417)
    }
    const next = budget.reserve("small-successes", 25 * 1024 * 1024, 100 * 1024 * 1024)
    expect(next.maxBytes).toBe(25 * 1024 * 1024)
  })
})
