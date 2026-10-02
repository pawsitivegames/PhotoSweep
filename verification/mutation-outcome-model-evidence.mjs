export const MUTATION_OUTCOME_REQUIRED_ACTIONS = Object.freeze([
  "BeginTrash",
  "DispatchTrashChunk",
  "RecordTrashBatch",
  "TimeoutTrashBatch",
  "FinalizeTrash",
  "BeginRestore",
  "BeginLegacyRestore",
  "PersistRestoreIntent",
  "FailRestoreIntentWrite",
  "DispatchRestoreChunk",
  "RecordRestoreBatch",
  "TimeoutRestoreBatch",
  "FinalizeRestore",
  "PersistProvisionalRecovery",
  "FailRecoveryWrite",
  "PersistRecovery",
  "LateTerminalRestore",
  "RejectLateTerminal",
  "Crash",
  "ReloadRecovery",
  "RetryFailedRestore",
  "CompleteWithoutRestore",
  "FinishAfterReload"
])

function matchesHashSet(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    return false
  }
  const expectedKeys = Object.keys(expected)
  const actualKeys = Object.keys(actual)
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => actual[key] === expected[key])
  )
}

export function validateMutationOutcomeModelEvidence({
  obligationId,
  requirementId,
  runId,
  raw,
  expectedBinding
}) {
  const reasons = []
  const negativeControl = obligationId === "SAFE-12-negative-control"
  const expectedConfigPath = negativeControl
    ? expectedBinding.negativeConfigPath
    : expectedBinding.positiveConfigPath
  const expectedConfigHash = negativeControl
    ? expectedBinding.negativeConfigSha256
    : expectedBinding.positiveConfigSha256

  if (!raw || typeof raw !== "object") {
    return { valid: false, reasons: ["missing-result"] }
  }
  if (
    raw.id !== obligationId ||
    raw.requirementId !== requirementId ||
    raw.runId !== runId
  ) {
    reasons.push("stale-or-mismatched-run-identity")
  }
  if (
    raw.modulePath !== expectedBinding.modulePath ||
    raw.configPath !== expectedConfigPath ||
    raw.runnerPath !== expectedBinding.runnerPath ||
    raw.jarVersion !== expectedBinding.jarVersion ||
    raw.jarSha256 !== expectedBinding.jarSha256 ||
    raw.moduleSha256 !== expectedBinding.moduleSha256 ||
    raw.configSha256 !== expectedConfigHash ||
    raw.runnerSha256 !== expectedBinding.runnerSha256
  ) {
    reasons.push("source-binding-mismatch")
  }

  const expectedSourceHashes = {
    moduleSha256: expectedBinding.moduleSha256,
    runnerSha256: expectedBinding.runnerSha256,
    positiveConfigSha256: expectedBinding.positiveConfigSha256,
    negativeConfigSha256: expectedBinding.negativeConfigSha256,
    jarSha256: expectedBinding.jarSha256
  }
  if (
    raw.sourceStable !== true ||
    !matchesHashSet(raw.sourceHashesBefore, expectedSourceHashes) ||
    !matchesHashSet(raw.sourceHashesAfter, expectedSourceHashes)
  ) {
    reasons.push("source-hashes-not-bound-or-stable")
  }
  if (raw.status !== "PASS" || raw.exitCode !== 0 || raw.modelComplete !== true) {
    reasons.push("model-result-not-passing")
  }

  if (negativeControl) {
    if (
      raw.expectedCounterexampleDetected !== true ||
      raw.violatedInvariant !== "InvRetryOnlyFailed" ||
      raw.tlcExitCode !== 12 ||
      !(raw.statesGenerated > 0) ||
      !(raw.depth > 0) ||
      !/Invariant InvRetryOnlyFailed is violated/.test(raw.output ?? "") ||
      !/State \d+: <RetryFailedRestore line/.test(raw.output ?? "")
    ) {
      reasons.push("unsafe-retry-counterexample-not-proven")
    }
  } else {
    const actualActions = raw.requiredActions
    const expectedActions = MUTATION_OUTCOME_REQUIRED_ACTIONS
    if (
      !Array.isArray(actualActions) ||
      actualActions.length !== expectedActions.length ||
      actualActions.some((action, index) => action !== expectedActions[index]) ||
      raw.coverageComplete !== true ||
      expectedActions.some((action) => !(raw.coverageCounts?.[action] > 0)) ||
      !(raw.statesGenerated > 0) ||
      !(raw.depth > 0) ||
      !/Model checking completed\. No error has been found\./.test(
        raw.output ?? ""
      )
    ) {
      reasons.push("positive-model-coverage-incomplete")
    }
  }

  return { valid: reasons.length === 0, reasons }
}
