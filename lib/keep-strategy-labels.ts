import type { KeepStrategy } from "./keep-strategy"

/** Presentation labels are kept separate from the destructive recommendation logic. */
export const KEEP_STRATEGY_LABELS: Record<KeepStrategy, string> = {
  best_quality: "Best quality",
  largest_resolution: "Largest resolution",
  newest_taken: "Newest taken date",
  oldest_taken: "Oldest taken date",
  newest_upload: "Newest upload date",
  non_storage_counting: "Non-storage-counting"
}
