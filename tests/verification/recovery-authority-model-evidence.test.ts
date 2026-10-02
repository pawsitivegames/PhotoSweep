import { describe, expect, it } from "vitest"

import {
  RECOVERY_AUTHORITY_REQUIRED_ACTIONS,
  expectedRecoveryAuthorityBinding,
  validateRecoveryAuthorityModelEvidence
} from "../../verification/recovery-authority-model-evidence.mjs"

const root = process.cwd()
const runId = "authority-verifier-test-run"
const binding = expectedRecoveryAuthorityBinding(root)
const expectedHashes = {
  moduleSha256: binding.moduleSha256,
  runnerSha256: binding.runnerSha256,
  positiveConfigSha256: binding.positiveConfigSha256,
  negativeConfigSha256: binding.negativeConfigSha256,
  clearNegativeConfigSha256: binding.clearNegativeConfigSha256,
  jarSha256: binding.jarSha256,
  ...Object.fromEntries(
    Object.entries(binding.correspondenceSourceHashes).map(([path, hash]) => [
      `correspondence:${path}`,
      hash
    ])
  )
}

type EvidenceKind = "positive" | "prune-negative" | "clear-negative"
type EvidenceFixture = {
  [key: string]: unknown
  runId: unknown
  modulePath: unknown
  configPath: unknown
  sourceHashesAfter: Record<string, unknown>
  requiredActions: unknown[]
  output: unknown
  counterexampleAction: unknown
}

function artifact(kind: EvidenceKind = "positive"): EvidenceFixture {
  const negative = kind !== "positive"
  const clearNegative = kind === "clear-negative"
  const configPath = clearNegative
    ? binding.clearNegativeConfigPath
    : negative
      ? binding.negativeConfigPath
      : binding.positiveConfigPath
  const configSha256 = clearNegative
    ? binding.clearNegativeConfigSha256
    : negative
      ? binding.negativeConfigSha256
      : binding.positiveConfigSha256
  const invariant = clearNegative
    ? "InvSafetyRowsRetained"
    : "InvActiveIntentGuardRetained"
  const action = clearNegative ? "ClearRecovery" : "PruneCompletedHistory"
  const output = negative
    ? [
        `Invariant ${invariant} is violated.`,
        `State 12: <${action} line 287, col 3 to line 289, col 62>`
      ].join("\n")
    : "Model checking completed. No error has been found."
  const id = clearNegative
    ? "SAFE-12-authority-clear-negative-control"
    : negative
      ? "SAFE-12-authority-negative-control"
      : "SAFE-12-authority-model"
  return {
    ...binding,
    id,
    requirementId: "SAFE-12",
    proofClass: negative
      ? "finite-model-negative-control"
      : "finite-service-worker-authority-model",
    kind: "model",
    status: "PASS",
    exitCode: 0,
    modelComplete: true,
    runId,
    configPath,
    configSha256,
    sourceStable: true,
    sourceHashesBefore: expectedHashes,
    sourceHashesAfter: expectedHashes,
    requiredActions: [...RECOVERY_AUTHORITY_REQUIRED_ACTIONS],
    coverageCounts: Object.fromEntries(
      RECOVERY_AUTHORITY_REQUIRED_ACTIONS.map((actionName) => [actionName, 1])
    ),
    coverageComplete: !negative,
    expectedCounterexampleDetected: negative,
    violatedInvariant: negative ? invariant : null,
    counterexampleAction: negative ? action : null,
    tlcExitCode: negative ? 12 : 0,
    statesGenerated: 25,
    statesExplored: 8,
    depth: 9,
    output
  }
}

function validate(
  raw: EvidenceFixture,
  obligationId = "SAFE-12-authority-model",
  currentRunId = runId
) {
  return validateRecoveryAuthorityModelEvidence({
    obligationId,
    requirementId: "SAFE-12",
    runId: currentRunId,
    raw,
    expectedBinding: binding
  })
}

describe("[SAFE-12 authority evidence verifier] source-bound service-worker model artifacts", () => {
  it("accepts a complete source-bound positive model", () => {
    expect(validate(artifact()).valid).toBe(true)
  })

  it("accepts only the configured unsafe active-guard-pruning counterexample", () => {
    expect(
      validate(
        artifact("prune-negative"),
        "SAFE-12-authority-negative-control"
      ).valid
    ).toBe(true)
  })

  it("accepts only the configured terminal-unknown-clear counterexample", () => {
    expect(
      validate(
        artifact("clear-negative"),
        "SAFE-12-authority-clear-negative-control"
      ).valid
    ).toBe(true)
  })

  it("rejects stale run IDs, wrong modules/configs, and altered source fingerprints", () => {
    const stale = artifact()
    stale.runId = "older-run"
    expect(validate(stale).reasons).toContain("stale-or-mismatched-run-identity")

    const wrongModule = artifact()
    wrongModule.modulePath = "verification/model/TrashLifecycle.tla"
    expect(validate(wrongModule).reasons).toContain("source-binding-mismatch")

    const wrongConfig = artifact()
    wrongConfig.configPath = binding.negativeConfigPath
    expect(validate(wrongConfig).reasons).toContain("source-binding-mismatch")

    const changedHashes = artifact()
    changedHashes.sourceHashesAfter = {
      ...expectedHashes,
      "correspondence:background/index.ts": "f".repeat(64)
    }
    expect(validate(changedHashes).reasons).toContain("source-binding-mismatch")
  })

  it("rejects an incomplete or invented required-action list", () => {
    const missingAction = artifact()
    missingAction.requiredActions.pop()
    expect(validate(missingAction).reasons).toContain(
      "model-result-or-required-actions-invalid"
    )

    const inventedAction = artifact()
    inventedAction.requiredActions[0] = "ArbitraryUnregisteredAction"
    expect(validate(inventedAction).reasons).toContain(
      "model-result-or-required-actions-invalid"
    )
  })

  it("rejects generic exit-12 results or counterexamples from the wrong action", () => {
    const arbitraryFailure = artifact("prune-negative")
    arbitraryFailure.output = "TLC failed with exit 12"
    expect(
      validate(arbitraryFailure, "SAFE-12-authority-negative-control").reasons
    ).toContain("unsafe-guard-pruning-counterexample-not-proven")

    const wrongAction = artifact("prune-negative")
    wrongAction.counterexampleAction = "ClearRecovery"
    expect(
      validate(wrongAction, "SAFE-12-authority-negative-control").reasons
    ).toContain("unsafe-guard-pruning-counterexample-not-proven")

    const wrongClear = artifact("clear-negative")
    wrongClear.counterexampleAction = "PruneCompletedHistory"
    expect(
      validate(
        wrongClear,
        "SAFE-12-authority-clear-negative-control"
      ).reasons
    ).toContain("unsafe-terminal-unknown-clear-counterexample-not-proven")
  })
})
