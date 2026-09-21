import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { classifyDuplicateItems } from "../../lib/duplicate-classifier"
import type { GpdMediaItem } from "../../lib/types"

interface CorpusFixture {
  id: string
  label: string
  items: GpdMediaItem[]
  visualSimilarity?: number
  expected: {
    duplicateKind: "exact" | "similar"
    evidenceLevel: string
    relationship?: string
    canProposeTrash: boolean
  }
}

const corpus = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "verification/corpus/safety-fixtures.json"),
    "utf8"
  )
) as CorpusFixture[]

describe("labeled safety corpus", () => {
  it("contains distinct provenance labels and matches independent expected outcomes", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(7)
    expect(new Set(corpus.map((fixture) => fixture.id)).size).toBe(corpus.length)
    expect(new Set(corpus.map((fixture) => fixture.expected.evidenceLevel)).size).toBeGreaterThan(1)

    for (const fixture of corpus) {
      const result = classifyDuplicateItems(
        fixture.items,
        fixture.visualSimilarity
      )
      expect({
        duplicateKind: result.duplicateKind,
        evidenceLevel: result.evidenceLevel,
        relationship: result.relationship,
        canProposeTrash: result.canProposeTrash
      }, fixture.label).toEqual(fixture.expected)
    }
  })

  it("never treats metadata, thumbnail, or legacy-only fixtures as verified identity", () => {
    for (const fixture of corpus.filter((item) =>
      ["metadata-only", "thumbnail-only", "legacy-label-only"].includes(item.id)
    )) {
      const result = classifyDuplicateItems(fixture.items, fixture.visualSimilarity)
      expect(result.evidenceLevel).not.toBe("verified_identical")
      expect(result.duplicateKind).not.toBe("exact")
    }
  })
})
