import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { performance } from "node:perf_hooks"

import { describe, expect, it } from "vitest"

import { DuplicateReviewSession } from "../../lib/duplicate-review-session"
import type { DuplicateGroup, GpdMediaItem } from "../../lib/types"

const budgetsMs: Record<number, number> = {
  1_000: 2_000,
  10_000: 8_000,
  50_000: 25_000
}

function syntheticReview(n: number) {
  const mediaItems: Record<string, GpdMediaItem> = {}
  const mediaKeys: string[] = []
  for (let index = 0; index < n; index += 1) {
    const mediaKey = `bench-${n}-${index}`
    mediaKeys.push(mediaKey)
    mediaItems[mediaKey] = {
      mediaKey,
      dedupKey: `provider-${n}-${index}`,
      fileName: `${mediaKey}.jpg`,
      thumb: "",
      timestamp: 1_700_000_000_000 + index,
      creationTimestamp: 1_700_000_000_000 + index,
      resWidth: 1_000 + (index % 200),
      resHeight: 800 + (index % 200),
      size: 10_000 + index,
      provider: "google"
    }
  }
  const group: DuplicateGroup = {
    id: `bench-group-${n}`,
    mediaKeys,
    originalMediaKey: mediaKeys[0],
    similarity: 0.98
  }
  const session = new DuplicateReviewSession({
    groups: [group],
    mediaItems,
    selections: {
      selectedGroupIds: new Set([group.id]),
      reviewedGroupIds: new Set([group.id]),
      keptOverrides: { [group.id]: new Set([mediaKeys[0]]) },
      keepDecisionProvenance: { [group.id]: { source: "manual" } }
    }
  })
  return { session, group }
}

describe("verification performance budgets", () => {
  it("measures 1k, 10k, and 50k synthetic review planning", () => {
    const measurements: Array<Record<string, number>> = []
    for (const n of [1_000, 10_000, 50_000]) {
      const before = process.memoryUsage().heapUsed
      const constructionStart = performance.now()
      const fixture = syntheticReview(n)
      const constructionMs = performance.now() - constructionStart
      const planStart = performance.now()
      const plan = fixture.session.trashPlan([fixture.group])
      const planMs = performance.now() - planStart
      const totalMs = constructionMs + planMs
      const after = process.memoryUsage().heapUsed
      const heapDeltaMb = Math.max(0, after - before) / (1024 * 1024)

      expect(plan.mediaKeysToTrash.length).toBe(n - 1)
      expect(plan.dedupKeys.length).toBe(n - 1)
      expect(totalMs).toBeLessThan(budgetsMs[n])
      expect(heapDeltaMb).toBeLessThan(512)
      measurements.push({ n, constructionMs, planMs, totalMs, heapDeltaMb })
    }

    const output = process.env.VERIFICATION_PERF_OUTPUT
    if (output) {
      const outputPath = resolve(process.cwd(), output)
      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(
        outputPath,
        `${JSON.stringify(
          {
            status: "PASS",
            budgetsMs,
            measurements,
            node: process.version,
            platform: process.platform,
            arch: process.arch
          },
          null,
          2
        )}\n`
      )
    }
  })
})
