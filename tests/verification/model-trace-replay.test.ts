import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  exportTraceBundle,
  sha256File,
  verifyTraceBundle
} from "../../verification/model/export-trace.mjs"
import {
  replayTraceBundle,
  verifyReplaySource,
  writeReplayBundleReport
} from "../../verification/trace-replay"
import { classifyTraceReplayResult } from "../../verification/trace-replay-status.mjs"

const root = resolve(process.cwd())
const traceCount = Number(process.env.MODEL_TRACE_REPLAY_TRACES ?? "256")
const traceSeed = Number(process.env.MODEL_TRACE_REPLAY_SEED ?? "20260915")
const traceDepth = Number(process.env.MODEL_TRACE_REPLAY_DEPTH ?? "24")
const traceRunId =
  process.env.MODEL_TRACE_REPLAY_RUN_ID ?? "model-trace-replay-20260915"

describe("bounded TLC to TypeScript trace replay", () => {
  it("replays real TLC modules with provenance, coverage, and a detected negative divergence", async () => {
    const outputDirectory = process.env.MODEL_TRACE_REPLAY_OUTPUT
      ? resolve(root, process.env.MODEL_TRACE_REPLAY_OUTPUT)
      : mkdtempSync(join(root, "tmp/verification/model-trace-replay-"))
    const exported = exportTraceBundle({
      root,
      outputDirectory,
      runId: traceRunId,
      seed: traceSeed,
      depth: traceDepth,
      traces: traceCount
    })

    expect(exported.status).toBe("PASS")
    expect(exported.exitCode).toBe(0)
    expect(
      "parsedTraces" in exported ? exported.parsedTraces : []
    ).toHaveLength(traceCount)

    const checked = verifyTraceBundle(exported.manifestPath, { root })
    expect(checked.ok).toBe(true)
    expect(checked.errors).toEqual([])
    await expect(replayTraceBundle(checked.traces)).rejects.toThrow(
      "verified runId/buildId/source provenance"
    )

    const provenance = {
      runId: checked.manifest.runId,
      buildId: checked.manifest.buildId,
      source: checked.manifest.source
    }
    expect(provenance.source.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "verification/model/export-trace.mjs",
        "verification/trace-replay.ts"
      ])
    )
    const replay = await replayTraceBundle(checked.traces, {
      root,
      provenance,
      requireNoFailures: true,
      requireCoverage: true,
      reportPath: join(outputDirectory, "replay-report.json")
    })
    writeReplayBundleReport(join(outputDirectory, "replay-report.json"), replay)
    expect(
      readFileSync(join(outputDirectory, "replay-report.json"), "utf8")
    ).toContain("photosweep.model-trace-replay-bundle")

    expect(replay.status).toBe("PASS")
    expect(replay.counts.fail).toBe(0)
    expect(replay.coverage.complete).toBe(true)
    expect(replay.coverage.nonEmptyMovedReply).toBe(true)
    expect(replay.coverage.undoWitness).toBe(true)
    for (const action of [
      "Confirm",
      "ManualTrashAllConfirm",
      "PersistAudit",
      "PersistAuditFailure",
      "Dispatch",
      "DriftSelection",
      "DriftContext",
      "StaleProviderReply",
      "ProviderSuccessEmpty",
      "ProviderSuccessSubset",
      "ProviderSuccessWithUnknown",
      "ProviderErrorPartial",
      "Timeout",
      "LateProviderReply",
      "DuplicateReply",
      "Undo",
      "Crash",
      "Recover"
    ]) {
      expect(replay.coverage.actionCounts[action]).toBeGreaterThan(0)
    }
    for (const action of [
      "Confirm",
      "ManualTrashAllConfirm",
      "PersistAudit",
      "PersistAuditFailure",
      "Dispatch",
      "DriftSelection",
      "DriftContext",
      "ProviderSuccessEmpty",
      "ProviderSuccessSubset",
      "ProviderSuccessWithUnknown",
      "ProviderErrorPartial",
      "StaleProviderReply",
      "Timeout",
      "LateProviderReply",
      "DuplicateReply",
      "Undo",
      "Crash",
      "Recover"
    ]) {
      expect(replay.coverage.supportedActionCounts[action]).toBeGreaterThan(0)
    }
    expect(replay.coverage.unsupportedActionCounts.Timeout).toBe(0)
    expect(replay.coverage.unsupportedActionCounts.StaleProviderReply).toBe(0)
    expect(replay.coverage.unsupportedActionCounts.LateProviderReply).toBe(0)

    const negativeWitness = replay.reports.find(
      (report) => report.negativeControl.status === "DETECTED"
    )?.negativeControl
    expect(negativeWitness).toBeDefined()
    expect(negativeWitness?.mutation).toContain("test-only provider fault")
    expect(negativeWitness?.mutation).toContain(
      "before TrashLifecycle.reconcile"
    )
    expect(negativeWitness?.expected).toBeDefined()
    expect(negativeWitness?.actual).toBeDefined()
    expect(replay.unsupportedActions).toEqual([])
    expect(
      replay.unsupportedReasons.reduce((sum, entry) => sum + entry.count, 0)
    ).toBe(replay.counts.unsupported)
    expect(
      Object.values(replay.coverage.unsupportedActionCounts).reduce(
        (sum, count) => sum + count,
        0
      )
    ).toBe(replay.counts.unsupported)
    expect(
      replay.reports.every((report) => report.unsupportedActions.length === 0)
    ).toBe(true)
    expect(
      replay.reports.every((report) =>
        report.unsupportedAbstractions.some(
          (abstraction) => abstraction.id === "crossed-identity-pair"
        )
      )
    ).toBe(true)

    const validChildEnvelope = {
      status: "PASS",
      export: { status: "PASS" },
      test: { exitCode: 0 },
      replay: {
        status: "PASS",
        supportedProjectionStatus: "PASS",
        counts: { traces: 1, pass: 1, fail: 0, unsupported: 0 },
        coverage: { complete: true },
        unsupportedActions: [],
        unsupportedReasons: []
      }
    }
    const validChild = classifyTraceReplayResult({
      supported: true,
      result: { exitCode: 0 },
      raw: validChildEnvelope
    })
    expect(validChild.status).toBe("PASS")
    const missingReplayStatus = classifyTraceReplayResult({
      supported: true,
      result: { exitCode: 0 },
      raw: {
        ...validChildEnvelope,
        replay: { ...validChildEnvelope.replay, status: undefined }
      }
    })
    expect(missingReplayStatus.status).toBe("FAIL")
    expect(missingReplayStatus.failureReasons).toContain(
      "replay status is missing or malformed"
    )
    const malformedReplayCounts = classifyTraceReplayResult({
      supported: true,
      result: { exitCode: 0 },
      raw: {
        ...validChildEnvelope,
        replay: { ...validChildEnvelope.replay, counts: { unsupported: 1 } }
      }
    })
    expect(malformedReplayCounts.status).toBe("FAIL")
    expect(malformedReplayCounts.failureReasons).toContain(
      "replay counts are missing or malformed"
    )

    // Negative integration control for verification-runner: an otherwise
    // unsupported run with one failed replay step must be FAIL. Unsupported
    // coverage cannot mask an observed export/test/replay failure, and an
    // unexpected child exit cannot validate a stale BLOCKED envelope.
    const mixedFailure = classifyTraceReplayResult({
      supported: true,
      result: { exitCode: 2 },
      raw: {
        status: "BLOCKED",
        export: { status: "PASS" },
        test: { exitCode: 0 },
        replay: {
          status: "PASS_WITH_UNSUPPORTED",
          supportedProjectionStatus: "PASS",
          counts: { traces: 1, pass: 0, fail: 1, unsupported: 1 },
          coverage: { complete: true },
          unsupportedActions: ["Timeout"]
        }
      }
    })
    expect(mixedFailure.status).toBe("FAIL")
    expect(mixedFailure.failureReasons).toContain(
      "replay reported failed supported steps"
    )
    const exportFailure = classifyTraceReplayResult({
      supported: true,
      result: { exitCode: 2 },
      raw: {
        status: "BLOCKED",
        export: { status: "BLOCKED" },
        test: { exitCode: 0 },
        replay: {
          status: "PASS_WITH_UNSUPPORTED",
          supportedProjectionStatus: "PASS",
          counts: { traces: 1, pass: 1, fail: 0, unsupported: 1 },
          coverage: { complete: true },
          unsupportedActions: ["Timeout"]
        }
      }
    })
    expect(exportFailure.status).toBe("FAIL")
    expect(exportFailure.failureReasons).toContain("trace export did not PASS")
    const staleBlocked = classifyTraceReplayResult({
      supported: true,
      result: { exitCode: 0 },
      raw: {
        status: "BLOCKED",
        export: { status: "PASS" },
        test: { exitCode: 0 },
        replay: {
          status: "PASS_WITH_UNSUPPORTED",
          supportedProjectionStatus: "PASS",
          counts: { traces: 1, pass: 1, fail: 0, unsupported: 1 },
          coverage: { complete: true },
          unsupportedActions: ["Timeout"]
        }
      }
    })
    expect(staleBlocked.status).toBe("FAIL")
    expect(staleBlocked.failureReasons).toContain(
      "child runner did not return the expected unsupported-seam exit 2"
    )

    const tamperedDirectory = mkdtempSync(
      join(root, "tmp/verification/model-trace-replay-tampered-")
    )
    cpSync(outputDirectory, tamperedDirectory, { recursive: true })
    const tamperedTracesPath = join(tamperedDirectory, "traces.json")
    const tamperedTraces = JSON.parse(readFileSync(tamperedTracesPath, "utf8"))
    tamperedTraces.traces[0].states[0].state.phase = "fabricated"
    writeFileSync(
      tamperedTracesPath,
      `${JSON.stringify(tamperedTraces, null, 2)}\n`
    )
    const tamperedManifestPath = join(tamperedDirectory, "trace-manifest.json")
    const tamperedManifest = JSON.parse(
      readFileSync(tamperedManifestPath, "utf8")
    )
    tamperedManifest.execution.tracesSha256 = sha256File(tamperedTracesPath)
    writeFileSync(
      tamperedManifestPath,
      `${JSON.stringify(tamperedManifest, null, 2)}\n`
    )
    const tamperedCheck = verifyTraceBundle(tamperedManifestPath, { root })
    expect(tamperedCheck.ok).toBe(false)
    expect(tamperedCheck.errors.join(" ")).toContain(
      "Parsed trace content does not match"
    )

    const changedSource = {
      ...provenance,
      source: {
        ...provenance.source,
        files: provenance.source.files.map((file, index) =>
          index === 0 ? { ...file, sha256: "0".repeat(64) } : file
        )
      }
    }
    const sourceCheck = verifyReplaySource(changedSource, { root })
    expect(sourceCheck.ok).toBe(false)
    expect(sourceCheck.errors.join(" ")).toContain(
      "Replay provenance source digest changed"
    )

    const emptySource = {
      ...provenance,
      source: { ...provenance.source, files: [] }
    }
    const emptySourceCheck = verifyReplaySource(emptySource, { root })
    expect(emptySourceCheck.ok).toBe(false)
    expect(emptySourceCheck.errors.join(" ")).toContain(
      "source file list is missing or empty"
    )

    const forgedBuild = {
      ...provenance,
      buildId: "forged-build-id",
      source: { ...provenance.source, buildId: "forged-build-id" }
    }
    const forgedBuildCheck = verifyReplaySource(forgedBuild, { root })
    expect(forgedBuildCheck.ok).toBe(false)
    expect(forgedBuildCheck.errors.join(" ")).toContain(
      "buildId does not match current source"
    )
    expect(verifyReplaySource(null, { root }).ok).toBe(false)
  }, 30_000)
})
