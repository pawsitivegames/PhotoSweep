import type { ScanCheckpoint } from "./scan-checkpoint"
import type { PhotoProvider } from "./types"

export interface ProviderScanCancellationTarget {
  requestId: string
  provider: PhotoProvider
}

/**
 * A provider command is still active only during the fetching phase. Later
 * pauses cancel local duplicate processing and must not leave a stale provider
 * cancellation tombstone behind.
 */
export function providerScanCancellationTarget(
  checkpoint: ScanCheckpoint | null,
  requestId: string | null
): ProviderScanCancellationTarget | null {
  if (
    !requestId ||
    checkpoint?.status !== "active" ||
    checkpoint.phase !== "fetching"
  ) {
    return null
  }

  return {
    requestId,
    provider: checkpoint.settings.sourceProvider ?? "google"
  }
}
