import { describe, expect, it } from "vitest"

import {
  createScanCheckpoint,
  updateScanCheckpoint
} from "../../lib/scan-checkpoint"
import { providerScanCancellationTarget } from "../../lib/provider-scan-cancellation"

describe("provider scan cancellation", () => {
  it.each(["google", "icloud", "amazon"] as const)(
    "targets the active %s provider fetch",
    (provider) => {
      const checkpoint = createScanCheckpoint({
        id: "scan-1",
        settings: {
          sourceProvider: provider,
          scanMode: "full",
          similarityThreshold: 0.98
        }
      })

      expect(providerScanCancellationTarget(checkpoint, "scan-1")).toEqual({
        requestId: "scan-1",
        provider
      })
    }
  )

  it("does not send provider cancellation after fetched items enter local processing", () => {
    const checkpoint = updateScanCheckpoint(
      createScanCheckpoint({
        id: "scan-2",
        settings: { sourceProvider: "amazon", scanMode: "full", similarityThreshold: 0.98 }
      }),
      { phase: "downloading_thumbnails" }
    )

    expect(providerScanCancellationTarget(checkpoint, "scan-2")).toBeNull()
  })

  it("does not target missing or inactive requests", () => {
    const checkpoint = updateScanCheckpoint(
      createScanCheckpoint({
        id: "scan-3",
        settings: { sourceProvider: "icloud", scanMode: "full", similarityThreshold: 0.98 }
      }),
      { status: "interrupted" }
    )

    expect(providerScanCancellationTarget(checkpoint, null)).toBeNull()
    expect(providerScanCancellationTarget(checkpoint, "scan-3")).toBeNull()
    expect(providerScanCancellationTarget(null, "scan-3")).toBeNull()
  })
})
