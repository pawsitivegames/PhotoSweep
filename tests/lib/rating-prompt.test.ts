import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  chromeWebStoreReviewUrl,
  completeRatingPrompt,
  deferRatingPrompt,
  RATING_PROMPT_STORAGE_KEY,
  recordSuccessfulCleanup,
  recordSuccessfulScan
} from "../../lib/rating-prompt"

let store: Record<string, unknown> = {}

const mockStorage = {
  get: vi.fn(async (key: string) => ({ [key]: store[key] })),
  set: vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(store, items)
  })
}

vi.stubGlobal("chrome", { storage: { local: mockStorage } })

beforeEach(() => {
  store = {}
  vi.clearAllMocks()
})

describe("rating prompt state", () => {
  it("does not become eligible from a completed scan", async () => {
    await expect(recordSuccessfulScan()).resolves.toBe(false)
    expect(store[RATING_PROMPT_STORAGE_KEY]).toEqual({
      successfulScans: 1,
      successfulCleanups: 0,
      nextPromptAt: 1,
      completed: false
    })
  })

  it("becomes eligible after a positive confirmed cleanup", async () => {
    await expect(recordSuccessfulCleanup(2)).resolves.toBe(true)
    expect(store[RATING_PROMPT_STORAGE_KEY]).toMatchObject({
      successfulCleanups: 1,
      completed: false
    })
  })

  it("waits three additional successful cleanups after Maybe later", async () => {
    await recordSuccessfulCleanup(1)
    await deferRatingPrompt()

    await expect(recordSuccessfulCleanup(1)).resolves.toBe(false)
    await expect(recordSuccessfulCleanup(1)).resolves.toBe(false)
    await expect(recordSuccessfulCleanup(1)).resolves.toBe(true)
  })

  it("ignores zero or negative cleanup results", async () => {
    await expect(recordSuccessfulCleanup(0)).resolves.toBe(false)
    await expect(recordSuccessfulCleanup(-1)).resolves.toBe(false)
    expect(store[RATING_PROMPT_STORAGE_KEY]).toBeUndefined()
  })

  it("never prompts again after review or permanent dismissal", async () => {
    await recordSuccessfulCleanup(1)
    await completeRatingPrompt()

    await expect(recordSuccessfulCleanup(1)).resolves.toBe(false)
  })

  it("builds the official direct review-page URL", () => {
    expect(chromeWebStoreReviewUrl("abcdefghijklmnop")).toBe(
      "https://chrome.google.com/webstore/detail/abcdefghijklmnop/reviews"
    )
  })
})
