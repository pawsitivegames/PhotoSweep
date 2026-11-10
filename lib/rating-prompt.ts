export const RATING_PROMPT_STORAGE_KEY = "ratingPrompt"

const CLEANUPS_BEFORE_REPROMPT = 3

export type RatingPromptAction =
  "review_opened" | "feedback_opened" | "later" | "never"

export type RatingPromptState = {
  successfulScans: number
  successfulCleanups: number
  nextPromptAt: number
  completed: boolean
  lastAction?: RatingPromptAction
}

const DEFAULT_STATE: RatingPromptState = {
  successfulScans: 0,
  successfulCleanups: 0,
  nextPromptAt: 1,
  completed: false
}

function normalizeState(value: unknown): RatingPromptState {
  if (!value || typeof value !== "object") return { ...DEFAULT_STATE }

  const candidate = value as Partial<RatingPromptState>
  return {
    successfulScans:
      typeof candidate.successfulScans === "number" &&
      Number.isFinite(candidate.successfulScans) &&
      candidate.successfulScans >= 0
        ? Math.floor(candidate.successfulScans)
        : 0,
    successfulCleanups:
      typeof candidate.successfulCleanups === "number" &&
      Number.isFinite(candidate.successfulCleanups) &&
      candidate.successfulCleanups >= 0
        ? Math.floor(candidate.successfulCleanups)
        : 0,
    nextPromptAt:
      typeof candidate.nextPromptAt === "number" &&
      Number.isFinite(candidate.nextPromptAt) &&
      candidate.nextPromptAt >= 1
        ? Math.floor(candidate.nextPromptAt)
        : 1,
    // Legacy completion reasons cannot be recovered. Preserve every existing
    // completion as an opt-out rather than risking another unsolicited prompt.
    completed: candidate.completed === true,
    ...(["review_opened", "feedback_opened", "later", "never"].includes(
      candidate.lastAction ?? ""
    )
      ? { lastAction: candidate.lastAction }
      : {})
  }
}

async function loadState(): Promise<RatingPromptState> {
  const stored = await chrome.storage.local.get(RATING_PROMPT_STORAGE_KEY)
  return normalizeState(stored[RATING_PROMPT_STORAGE_KEY])
}

async function saveState(state: RatingPromptState): Promise<void> {
  await chrome.storage.local.set({ [RATING_PROMPT_STORAGE_KEY]: state })
}

export async function getRatingPromptEligibility(): Promise<boolean> {
  const current = await loadState()
  return (
    !current.completed && current.successfulCleanups >= current.nextPromptAt
  )
}

/**
 * Legacy migration hook. Scan completion no longer makes a review prompt
 * eligible; eligibility is tied to confirmed positive cleanup instead.
 */
export async function recordSuccessfulScan(): Promise<boolean> {
  const current = await loadState()
  if (current.completed) return false
  const next = {
    ...current,
    successfulScans: current.successfulScans + 1
  }
  await saveState(next)
  return false
}

/** Records a newly confirmed positive provider cleanup. */
export async function recordSuccessfulCleanup(
  movedCount: number
): Promise<boolean> {
  if (!Number.isFinite(movedCount) || movedCount <= 0) return false
  const current = await loadState()
  if (current.completed) return false
  const next = {
    ...current,
    successfulCleanups: current.successfulCleanups + 1
  }
  await saveState(next)
  return !next.completed && next.successfulCleanups >= next.nextPromptAt
}

export async function deferRatingPrompt(): Promise<void> {
  await recordRatingPromptAction("later")
}

export async function completeRatingPrompt(): Promise<void> {
  await recordRatingPromptAction("never")
}

/** A review-page visit is an attempt, never evidence of a submitted rating. */
export async function recordRatingPromptAction(
  action: RatingPromptAction
): Promise<void> {
  const current = await loadState()
  if (current.completed) return
  await saveState({
    ...current,
    lastAction: action,
    completed: action === "never",
    nextPromptAt: current.successfulCleanups + CLEANUPS_BEFORE_REPROMPT
  })
}
