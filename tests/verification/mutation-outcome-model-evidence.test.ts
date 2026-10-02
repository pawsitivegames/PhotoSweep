import { describe, expect, it } from "vitest"

import {
  MUTATION_OUTCOME_REQUIRED_ACTIONS,
  validateMutationOutcomeModelEvidence
} from "../../verification/mutation-outcome-model-evidence.mjs"

const expectedBinding = {
  modulePath: "verification/model/MutationOutcomeRecovery.tla",
  positiveConfigPath: "verification/model/MutationOutcomeRecovery.cfg",
  negativeConfigPath:
    "verification/model/MutationOutcomeRecovery.negative.cfg",
  runnerPath: "verification/run-mutation-outcomes-tlc.mjs",
  jarVersion: "1.8.0",
  jarSha256: "a".repeat(64),
  moduleSha256: "b".repeat(64),
  positiveConfigSha256: "c".repeat(64),
  negativeConfigSha256: "d".repeat(64),
  runnerSha256: "e".repeat(64)
}

const sourceHashes = {
  moduleSha256: expectedBinding.moduleSha256,
  runnerSha256: expectedBinding.runnerSha256,
  positiveConfigSha256: expectedBinding.positiveConfigSha256,
  negativeConfigSha256: expectedBinding.negativeConfigSha256,
  jarSha256: expectedBinding.jarSha256
}

type ModelEvidenceFixture = {
  [key: string]: unknown
  requiredActions?: string[]
  tlcExitCode?: number
  sourceHashesAfter: typeof sourceHashes
}

function resultFixture(negativeControl = false): ModelEvidenceFixture {
  const configPath = negativeControl
    ? expectedBinding.negativeConfigPath
    : expectedBinding.positiveConfigPath
  const configSha256 = negativeControl
    ? expectedBinding.negativeConfigSha256
    : expectedBinding.positiveConfigSha256
  const output = negativeControl
    ? "Invariant InvRetryOnlyFailed is violated.\nState 13: <RetryFailedRestore line 1>"
    : "Model checking completed. No error has been found."

  return {
    id: negativeControl ? "SAFE-12-negative-control" : "SAFE-12-model",
    requirementId: "SAFE-12",
    runId: "fresh-run",
    modulePath: expectedBinding.modulePath,
    moduleSha256: expectedBinding.moduleSha256,
    configPath,
    configSha256,
    runnerPath: expectedBinding.runnerPath,
    runnerSha256: expectedBinding.runnerSha256,
    jarVersion: expectedBinding.jarVersion,
    jarSha256: expectedBinding.jarSha256,
    sourceStable: true,
    sourceHashesBefore: { ...sourceHashes },
    sourceHashesAfter: { ...sourceHashes },
    status: "PASS",
    exitCode: 0,
    modelComplete: true,
    statesGenerated: 100,
    statesExplored: 80,
    depth: 12,
    output,
    ...(negativeControl
      ? {
          expectedCounterexampleDetected: true,
          violatedInvariant: "InvRetryOnlyFailed",
          tlcExitCode: 12
        }
      : {
          requiredActions: [...MUTATION_OUTCOME_REQUIRED_ACTIONS],
          coverageCounts: Object.fromEntries(
            MUTATION_OUTCOME_REQUIRED_ACTIONS.map((action) => [action, 1])
          ),
          coverageComplete: true
        })
  }
}

function validate(raw, obligationId = "SAFE-12-model") {
  return validateMutationOutcomeModelEvidence({
    obligationId,
    requirementId: "SAFE-12",
    runId: "fresh-run",
    raw,
    expectedBinding
  })
}

describe("[SAFE-12 evidence verifier] source-bound outcome model artifacts", () => {
  it("accepts only the bound positive model and expected unsafe-retry counterexample", () => {
    expect(validate(resultFixture()).valid).toBe(true)
    expect(
      validate(resultFixture(true), "SAFE-12-negative-control").valid
    ).toBe(true)
  })

  it("rejects a different model module or config", () => {
    const wrongModule = resultFixture()
    wrongModule.modulePath = "verification/model/TrashLifecycle.tla"
    expect(validate(wrongModule).reasons).toContain("source-binding-mismatch")

    const wrongConfig = resultFixture()
    wrongConfig.configPath = expectedBinding.negativeConfigPath
    expect(validate(wrongConfig).reasons).toContain("source-binding-mismatch")
  })

  it("rejects source hash drift and a substituted TLC jar binding", () => {
    const changedModelHash = resultFixture()
    changedModelHash.sourceHashesAfter.moduleSha256 = "f".repeat(64)
    expect(validate(changedModelHash).reasons).toContain(
      "source-hashes-not-bound-or-stable"
    )

    const substitutedJar = resultFixture()
    substitutedJar.jarSha256 = "f".repeat(64)
    expect(validate(substitutedJar).reasons).toContain("source-binding-mismatch")
  })

  it("rejects an incomplete or unknown action coverage set", () => {
    const unknownAction = resultFixture()
    unknownAction.requiredActions![0] = "GuessedAction"
    expect(validate(unknownAction).reasons).toContain(
      "positive-model-coverage-incomplete"
    )

    const omittedAction = resultFixture()
    omittedAction.requiredActions!.pop()
    expect(validate(omittedAction).valid).toBe(false)
  })

  it("rejects stale runs and negative controls without the required exit-12 trace", () => {
    const stale = resultFixture()
    stale.runId = "old-run"
    expect(validate(stale).reasons).toContain(
      "stale-or-mismatched-run-identity"
    )

    const badCounterexample = resultFixture(true)
    badCounterexample.tlcExitCode = 13
    expect(
      validate(badCounterexample, "SAFE-12-negative-control").reasons
    ).toContain("unsafe-retry-counterexample-not-proven")
  })
})
