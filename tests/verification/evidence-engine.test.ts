import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

// The evidence engine is intentionally runtime JavaScript so CI can validate
// evidence before the TypeScript application toolchain is available.
import {
  validateEvidence,
  validateRegistry
} from "../../verification/evidence-engine.mjs"

const sourceFingerprint = "a".repeat(64)

function registryFor(kind = "test") {
  return {
    schemaVersion: 1,
    sourceRoots: [],
    scopes: { fast: { inherits: [] } },
    properties: [
      {
        id: "TEST-REQ",
        requirement: "runtime evidence",
        obligations: [
          {
            id: "TEST-OBLIGATION",
            scope: "fast",
            proofClass: kind === "model" ? "finite-model" : "implementation",
            kind,
            command: "test",
            artifact: "artifact.log",
            mandatory: true,
            ...(kind === "mutation"
              ? {
                  threshold: {
                    minimumKilledPercent: 90,
                    maximumCriticalSurvivors: 0
                  }
                }
              : {})
          }
        ]
      }
    ]
  }
}

function makeFixture(kind = "test") {
  const root = mkdtempSync(join(tmpdir(), "photosweep-evidence-"))
  const artifact = "artifact.log"
  const contents = "fresh evidence\n"
  writeFileSync(join(root, artifact), contents)
  const artifactSha256 = createHash("sha256").update(contents).digest("hex")
  const entry = {
    id: "TEST-OBLIGATION",
    requirementId: "TEST-REQ",
    proofClass: kind === "model" ? "finite-model" : "implementation",
    kind,
    status: "PASS",
    exitCode: 0,
    checksRun: 1,
    sourceFingerprint,
    artifact,
    artifactSha256,
    ...(kind === "model"
      ? { modelComplete: true, statesExplored: 8 }
      : {}),
    ...(kind === "mutation"
      ? {
          mutantsTotal: 10,
          mutantsKilled: 10,
          criticalSurvivors: 0
        }
      : {})
  }
  return {
    root,
    registry: registryFor(kind),
    evidence: { schemaVersion: 1, entries: [entry] },
    entry
  }
}

describe("evidence engine integrity", () => {
  it("accepts a complete, source-bound artifact", () => {
    const fixture = makeFixture()
    try {
      const result = validateEvidence({
        ...fixture,
        scope: "fast",
        expectedSourceFingerprint: sourceFingerprint
      })
      expect(result).toMatchObject({ ok: true, status: "PASS" })
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it("rejects duplicate and unknown evidence IDs", () => {
    const fixture = makeFixture()
    try {
      const result = validateEvidence({
        ...fixture,
        scope: "fast",
        expectedSourceFingerprint: sourceFingerprint,
        evidence: {
          schemaVersion: 1,
          entries: [fixture.entry, { ...fixture.entry }, { ...fixture.entry, id: "UNKNOWN" }]
        }
      })
      expect(result.ok).toBe(false)
      expect(result.errors.map((item: { code: string }) => item.code)).toEqual(
        expect.arrayContaining(["DUPLICATE_ID", "UNKNOWN_ID"])
      )
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it("rejects stale source fingerprints and corrupted artifacts", () => {
    const fixture = makeFixture()
    try {
      const result = validateEvidence({
        ...fixture,
        scope: "fast",
        expectedSourceFingerprint: sourceFingerprint,
        evidence: {
          schemaVersion: 1,
          entries: [
            {
              ...fixture.entry,
              sourceFingerprint: "b".repeat(64),
              artifactSha256: "c".repeat(64)
            }
          ]
        }
      })
      expect(result.ok).toBe(false)
      expect(result.errors.map((item: { code: string }) => item.code)).toEqual(
        expect.arrayContaining(["STALE_SOURCE", "ARTIFACT_HASH_MISMATCH"])
      )
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it("rejects process-completed evidence with zero checks", () => {
    const fixture = makeFixture()
    try {
      const result = validateEvidence({
        ...fixture,
        scope: "fast",
        expectedSourceFingerprint: sourceFingerprint,
        evidence: {
          schemaVersion: 1,
          entries: [{ ...fixture.entry, checksRun: 0 }]
        }
      })
      expect(result.ok).toBe(false)
      expect(result.errors.map((item: { code: string }) => item.code)).toContain(
        "ZERO_CHECKS"
      )
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it("rejects incomplete finite-model evidence", () => {
    const fixture = makeFixture("model")
    try {
      const result = validateEvidence({
        ...fixture,
        scope: "fast",
        expectedSourceFingerprint: sourceFingerprint,
        evidence: {
          schemaVersion: 1,
          entries: [
            {
              ...fixture.entry,
              modelComplete: false,
              statesExplored: 0
            }
          ]
        }
      })
      expect(result.ok).toBe(false)
      expect(result.errors.map((item: { code: string }) => item.code)).toEqual(
        expect.arrayContaining(["MODEL_INCOMPLETE", "MODEL_NO_STATES"])
      )
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it("returns BLOCKED for an unavailable mandatory provider gate without mislabeling it as zero-test failure", () => {
    const fixture = makeFixture()
    try {
      const result = validateEvidence({
        ...fixture,
        scope: "fast",
        expectedSourceFingerprint: sourceFingerprint,
        evidence: {
          schemaVersion: 1,
          entries: [
            {
              ...fixture.entry,
              status: "BLOCKED",
              exitCode: 2,
              checksRun: 0,
              message: "No disposable provider fixture is configured."
            }
          ]
        }
      })
      expect(result.status).toBe("BLOCKED")
      expect(result.errors.map((item: { code: string }) => item.code)).not.toContain(
        "ZERO_CHECKS"
      )
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it("validates mutation thresholds and critical survivors", () => {
    const fixture = makeFixture("mutation")
    try {
      const result = validateEvidence({
        ...fixture,
        scope: "fast",
        expectedSourceFingerprint: sourceFingerprint,
        evidence: {
          schemaVersion: 1,
          entries: [
            {
              ...fixture.entry,
              mutantsKilled: 8,
              criticalSurvivors: 1
            }
          ]
        }
      })
      expect(result.errors.map((item: { code: string }) => item.code)).toEqual(
        expect.arrayContaining(["MUTATION_THRESHOLD", "CRITICAL_MUTATION_SURVIVOR"])
      )
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it("rejects an empty registry instead of certifying an empty scope", () => {
    const registry = registryFor()
    registry.properties = []
    expect(validateRegistry(registry).map((item: { code: string }) => item.code)).toEqual(
      expect.arrayContaining(["REGISTRY_EMPTY", "REGISTRY_NO_OBLIGATIONS"])
    )
  })
})
