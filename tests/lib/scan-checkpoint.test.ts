import { describe, expect, it } from "vitest"

import {
  canResumeScanCheckpoint,
  createScanCheckpoint,
  describeScanCheckpointResume,
  shouldOfferResume,
  summarizeScanCheckpoint,
  updateScanCheckpoint
} from "../../lib/scan-checkpoint"

describe("scan checkpoint", () => {
  it("creates an active checkpoint with scan settings", () => {
    const checkpoint = createScanCheckpoint({
      id: "req-1",
      now: 1000,
      accountEmail: "user@example.com",
      settings: {
        scanMode: "smart",
        similarityThreshold: 0.99,
        smartWindowSec: 60,
        dateRange: { from: "2024-01-01", to: "2024-12-31" }
      }
    })

    expect(checkpoint).toMatchObject({
      id: "req-1",
      status: "active",
      startedAt: 1000,
      updatedAt: 1000,
      accountEmail: "user@example.com",
      phase: "fetching",
      itemsProcessed: 0,
      totalEstimate: 0
    })
  })

  it("updates progress and marks interrupted checkpoints resumable", () => {
    const checkpoint = createScanCheckpoint({
      id: "req-1",
      now: 1000,
      settings: { scanMode: "full", similarityThreshold: 0.98 }
    })

    const updated = updateScanCheckpoint(
      checkpoint,
      {
        status: "interrupted",
        phase: "computing_embeddings",
        itemsProcessed: 200,
        totalEstimate: 500,
        message: "computing_embeddings: 200/500"
      },
      2000
    )

    expect(updated.updatedAt).toBe(2000)
    expect(updated.phase).toBe("computing_embeddings")
    expect(shouldOfferResume(updated)).toBe(true)
    expect(shouldOfferResume(checkpoint)).toBe(false)
  })

  it("does not offer provider test-batch checkpoints as resumable full scans", () => {
    const checkpoint = createScanCheckpoint({
      id: "req-1",
      settings: {
        sourceProvider: "icloud",
        scanMode: "full",
        similarityThreshold: 0.98,
        icloudBatchLimit: 50
      }
    })

    expect(
      shouldOfferResume({
        ...checkpoint,
        status: "error"
      })
    ).toBe(false)
  })

  it("summarizes scoped and full-library scans", () => {
    expect(
      summarizeScanCheckpoint(
        createScanCheckpoint({
          id: "req-1",
          settings: {
            scanMode: "smart",
            similarityThreshold: 0.99,
            dateRange: { from: "2024-01-01", to: "2024-12-31" }
          }
        })
      )
    ).toBe("smart scan, 2024-01-01 to 2024-12-31")

    expect(
      summarizeScanCheckpoint(
        createScanCheckpoint({
          id: "req-2",
          settings: { scanMode: "full", similarityThreshold: 0.95 }
        })
      )
    ).toBe("full scan, full library")
  })

  it("describes whether resume can reuse a fetched media list", () => {
    const checkpoint = createScanCheckpoint({
      id: "req-1",
      settings: { scanMode: "smart", similarityThreshold: 0.99 }
    })

    expect(describeScanCheckpointResume(checkpoint)).toBe(
      "Cached embeddings from completed work will be reused."
    )

    expect(
      describeScanCheckpointResume({
        ...checkpoint,
        mediaItems: [
          {
            mediaKey: "m1",
            dedupKey: "d1",
            thumb: "",
            timestamp: 1,
            creationTimestamp: 2
          }
        ]
      })
    ).toBe("Fetched media list (1 item) will be reused.")
  })

  it("only resumes checkpoints that are safe for the current account", () => {
    const checkpoint = createScanCheckpoint({
      id: "req-1",
      accountEmail: "alice@example.com",
      settings: { scanMode: "full", similarityThreshold: 0.95 }
    })

    expect(
      canResumeScanCheckpoint(checkpoint, {
        accountEmail: "alice@example.com"
      })
    ).toBe(true)
    expect(
      canResumeScanCheckpoint(checkpoint, {
        accountEmail: "bob@example.com"
      })
    ).toBe(false)
    expect(canResumeScanCheckpoint(checkpoint, {})).toBe(true)
  })

  it("does not resume unknown-account checkpoints once the current account is known", () => {
    const checkpoint = createScanCheckpoint({
      id: "req-1",
      settings: { scanMode: "full", similarityThreshold: 0.95 }
    })

    expect(canResumeScanCheckpoint(checkpoint, {})).toBe(true)
    expect(
      canResumeScanCheckpoint(checkpoint, {
        accountEmail: "alice@example.com"
      })
    ).toBe(false)
  })

  it("does not resume checkpoints from another photo provider", () => {
    const checkpoint = createScanCheckpoint({
      id: "req-1",
      settings: {
        sourceProvider: "icloud",
        scanMode: "full",
        similarityThreshold: 0.95
      },
      providerSessionId: "icloud-session-a"
    })

    expect(
      canResumeScanCheckpoint(checkpoint, {
        sourceProvider: "icloud",
        providerSessionId: "icloud-session-a"
      })
    ).toBe(true)
    expect(
      canResumeScanCheckpoint(checkpoint, {
        sourceProvider: "icloud",
        providerSessionId: "icloud-session-b"
      })
    ).toBe(false)
    expect(
      canResumeScanCheckpoint(checkpoint, { sourceProvider: "google" })
    ).toBe(false)
    expect(canResumeScanCheckpoint(checkpoint, {})).toBe(false)
  })
})
