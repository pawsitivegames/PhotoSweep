import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  completeRatingPrompt,
  deferRatingPrompt,
  getRatingPromptEligibility,
  RATING_PROMPT_STORAGE_KEY,
  recordRatingPromptAction,
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

  it("never prompts again after permanent dismissal", async () => {
    await recordSuccessfulCleanup(1)
    await completeRatingPrompt()

    await expect(recordSuccessfulCleanup(1)).resolves.toBe(false)
  })

  it.each(["review_opened", "feedback_opened"] as const)(
    "records %s without claiming a rating or permanently opting out",
    async (action) => {
      await recordSuccessfulCleanup(1)
      await recordRatingPromptAction(action)
      expect(store[RATING_PROMPT_STORAGE_KEY]).toMatchObject({
        completed: false,
        lastAction: action,
        nextPromptAt: 4
      })
      await expect(getRatingPromptEligibility()).resolves.toBe(false)
      await recordSuccessfulCleanup(1)
      await recordSuccessfulCleanup(1)
      await expect(recordSuccessfulCleanup(1)).resolves.toBe(true)
    }
  )

  it("keeps an unanswered cleanup invitation eligible after reopening", async () => {
    await expect(getRatingPromptEligibility()).resolves.toBe(false)
    await recordSuccessfulCleanup(1)
    await expect(getRatingPromptEligibility()).resolves.toBe(true)
  })

  it("preserves ambiguous legacy opt-outs even after voluntary review and feedback", async () => {
    store[RATING_PROMPT_STORAGE_KEY] = {
      successfulScans: 5,
      successfulCleanups: 2,
      nextPromptAt: 1,
      completed: true
    }
    await expect(getRatingPromptEligibility()).resolves.toBe(false)
    await recordRatingPromptAction("review_opened")
    await recordRatingPromptAction("feedback_opened")
    await expect(recordSuccessfulCleanup(1)).resolves.toBe(false)
    expect(store[RATING_PROMPT_STORAGE_KEY]).toMatchObject({ completed: true })
  })
})
