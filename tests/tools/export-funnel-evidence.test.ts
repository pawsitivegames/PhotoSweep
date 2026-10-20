import { describe, expect, it, vi } from "vitest"

import { runFunnelEvidenceExport } from "../../tools/export-funnel-evidence.mjs"

describe("funnel evidence exporter", () => {
  it("uses the configured Firestore database and collection prefix", async () => {
    const get = vi.fn(async () => ({ docs: [] }))
    const collection = vi.fn(() => ({ get }))
    const firestoreFactory = vi.fn(() => ({ collection }))

    const result = await runFunnelEvidenceExport({
      argv: ["--current-version", "2.3.6.15"],
      env: {
        NODE_ENV: "development",
        PHOTOSWEEP_FIRESTORE_DATABASE_ID: "photosweep-test",
        PHOTOSWEEP_FIRESTORE_COLLECTION_PREFIX: "tenant_test"
      },
      firestoreFactory
    })

    expect(firestoreFactory).toHaveBeenCalledWith({
      databaseId: "photosweep-test"
    })
    expect(collection).toHaveBeenCalledWith("tenant_test_analytics_events")
    expect(JSON.parse(result.serialized)).toMatchObject({
      collection: "tenant_test_analytics_events",
      currentVersion: "2.3.6.15"
    })
  })

  it("keeps using the default Firestore database when no ID is configured", async () => {
    const collection = vi.fn(() => ({ get: vi.fn(async () => ({ docs: [] })) }))
    const firestoreFactory = vi.fn(() => ({ collection }))

    const result = await runFunnelEvidenceExport({
      argv: ["--current-version", "2.3.6.15"],
      env: { NODE_ENV: "development" },
      firestoreFactory
    })

    expect(firestoreFactory).toHaveBeenCalledWith()
    expect(collection).toHaveBeenCalledWith("photosweep_analytics_events")
    expect(JSON.parse(result.serialized).collection).toBe(
      "photosweep_analytics_events"
    )
  })
})
