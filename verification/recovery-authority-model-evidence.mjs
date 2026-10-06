import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export const RECOVERY_AUTHORITY_REQUIRED_ACTIONS = Object.freeze([
  "Submit",
  "SubmitAfterReload",
  "BeginPrewriteFails",
  "BeginPersistGuardAck",
  "BeginPersistGuardLostAck",
  "BeginLegacyIntent",
  "RejectBeginOverlap",
  "RejectBeginOverlapAfterReload",
  "DispatchAuthorized",
  "RecordProgressConfirmed",
  "TimeoutProvisional",
  "StageTerminalResponse",
  "PersistTerminal",
  "FailTerminalWrite",
  "RejectLateResponse",
  "ReloadWorker",
  "AddCompletedHistory",
  "PruneCompletedHistory",
  "ClearRecovery"
])

export const RECOVERY_AUTHORITY_CORRESPONDENCE_PATHS = Object.freeze([
  "background/index.ts",
  "background/recovery-history-transactions.ts",
  "lib/recovery-history.ts",
  "lib/async-serial-queue.ts",
  "lib/types.ts",
  "tabs/app.tsx",
  "tests/background/service-worker.test.ts",
  "tests/lib/recovery-history-capacity.test.ts",
  "tests/lib/recovery-history.test.ts",
  "tests/lib/trash-lifecycle.test.ts",
  "tests/e2e/integration/trash-undo.test.ts",
  "verification/verification-runner.mjs",
  "verification/requirements.json",
  "verification/run-properties.mjs",
  "tests/verification/recovery-authority-model-evidence.test.ts",
  "tests/verification/recovery-authority-correspondence-map.test.ts",
  "verification/recovery-authority-model-evidence.mjs",
  "verification/model/RecoveryAuthority.md",
  "verification/model/MutationOutcomeRecovery.md"
])

export const RECOVERY_AUTHORITY_BINDING = Object.freeze({
  modulePath: "verification/model/RecoveryAuthority.tla",
  positiveConfigPath: "verification/model/RecoveryAuthority.cfg",
  negativeConfigPath: "verification/model/RecoveryAuthority.negative.cfg",
  clearNegativeConfigPath: "verification/model/RecoveryAuthority.clear-negative.cfg",
  runnerPath: "verification/run-recovery-authority-tlc.mjs",
  jarVersion: "1.8.0",
  jarSha256:
    "7beec0f04818732a62fa193731711a99aa4f11279499b2360a7d156c519ea78d"
})

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function sourceHash(root, path) {
  return sha256(readFileSync(resolve(root, path)))
}

export function expectedRecoveryAuthorityBinding(root) {
  const runnerSource = readFileSync(
    resolve(root, RECOVERY_AUTHORITY_BINDING.runnerPath),
    "utf8"
  )
  const jarVersion = runnerSource.match(/const TLC_VERSION = "([^"]+)"/)?.[1]
  const jarSha256 = runnerSource.match(
    /const TLC_SHA256 = "([a-f0-9]{64})"/
  )?.[1]
  const positiveConfig = readFileSync(
    resolve(root, RECOVERY_AUTHORITY_BINDING.positiveConfigPath),
    "utf8"
  )
  const negativeConfig = readFileSync(
    resolve(root, RECOVERY_AUTHORITY_BINDING.negativeConfigPath),
    "utf8"
  )
  const clearNegativeConfig = readFileSync(
    resolve(root, RECOVERY_AUTHORITY_BINDING.clearNegativeConfigPath),
    "utf8"
  )

  return {
    ...RECOVERY_AUTHORITY_BINDING,
    jarVersion,
    jarSha256,
    moduleSha256: sourceHash(root, RECOVERY_AUTHORITY_BINDING.modulePath),
    positiveConfigSha256: sourceHash(
      root,
      RECOVERY_AUTHORITY_BINDING.positiveConfigPath
    ),
    negativeConfigSha256: sourceHash(
      root,
      RECOVERY_AUTHORITY_BINDING.negativeConfigPath
    ),
    clearNegativeConfigSha256: sourceHash(
      root,
      RECOVERY_AUTHORITY_BINDING.clearNegativeConfigPath
    ),
    runnerSha256: sourceHash(root, RECOVERY_AUTHORITY_BINDING.runnerPath),
    correspondenceSourceHashes: Object.fromEntries(
      RECOVERY_AUTHORITY_CORRESPONDENCE_PATHS.map((path) => [
        path,
        sourceHash(root, path)
      ])
    ),
    positiveConfigGuardOff:
      /UnsafePruneActiveGuard = FALSE/.test(positiveConfig) &&
      /UnsafeClearSafetyRows = FALSE/.test(positiveConfig) &&
      /INVARIANT InvActiveIntentGuardRetained/.test(positiveConfig) &&
      /INVARIANT InvSafetyRowsRetained/.test(positiveConfig) &&
      /INVARIANT InvClearSelectivelyRemovesOrdinaryRows/.test(positiveConfig),
    negativeConfigGuardOn:
      /UnsafePruneActiveGuard = TRUE/.test(negativeConfig) &&
      /UnsafeClearSafetyRows = FALSE/.test(negativeConfig) &&
      /INVARIANT InvActiveIntentGuardRetained/.test(negativeConfig),
    clearNegativeConfigGuardOn:
      /UnsafePruneActiveGuard = FALSE/.test(clearNegativeConfig) &&
      /UnsafeClearSafetyRows = TRUE/.test(clearNegativeConfig) &&
      /INVARIANT InvSafetyRowsRetained/.test(clearNegativeConfig) &&
      /INVARIANT InvClearSelectivelyRemovesOrdinaryRows/.test(clearNegativeConfig)
  }
}

function sameRecord(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    return false
  }
  const keys = Object.keys(expected)
  return (
    Object.keys(actual).length === keys.length &&
    keys.every((key) => actual[key] === expected[key])
  )
}

function exactActionList(actions) {
  return (
    Array.isArray(actions) &&
    actions.length === RECOVERY_AUTHORITY_REQUIRED_ACTIONS.length &&
    actions.every((action, index) => action === RECOVERY_AUTHORITY_REQUIRED_ACTIONS[index])
  )
}

function validCommonBinding(raw, expectedBinding) {
  const expectedHashes = {
    moduleSha256: expectedBinding.moduleSha256,
    runnerSha256: expectedBinding.runnerSha256,
    positiveConfigSha256: expectedBinding.positiveConfigSha256,
    negativeConfigSha256: expectedBinding.negativeConfigSha256,
    clearNegativeConfigSha256: expectedBinding.clearNegativeConfigSha256,
    jarSha256: expectedBinding.jarSha256
  }
  Object.assign(
    expectedHashes,
    Object.fromEntries(
      Object.entries(expectedBinding.correspondenceSourceHashes).map(
        ([path, hash]) => [`correspondence:${path}`, hash]
      )
    )
  )
  const clearNegative = raw.id === "SAFE-12-authority-clear-negative-control"
  const negative =
    typeof raw.id === "string" && raw.id.endsWith("negative-control")
  const positive = !negative && !clearNegative
  const configPath = clearNegative
    ? expectedBinding.clearNegativeConfigPath
    : positive
      ? expectedBinding.positiveConfigPath
      : expectedBinding.negativeConfigPath
  const configSha256 = clearNegative
    ? expectedBinding.clearNegativeConfigSha256
    : positive
      ? expectedBinding.positiveConfigSha256
      : expectedBinding.negativeConfigSha256

  return (
    raw.modulePath === expectedBinding.modulePath &&
    raw.moduleSha256 === expectedBinding.moduleSha256 &&
    raw.configPath === configPath &&
    raw.configSha256 === configSha256 &&
    raw.runnerPath === expectedBinding.runnerPath &&
    raw.runnerSha256 === expectedBinding.runnerSha256 &&
    raw.jarVersion === expectedBinding.jarVersion &&
    raw.jarSha256 === expectedBinding.jarSha256 &&
    raw.sourceStable === true &&
    sameRecord(raw.sourceHashesBefore, expectedHashes) &&
    sameRecord(raw.sourceHashesAfter, expectedHashes)
  )
}

export function validateRecoveryAuthorityModelEvidence({
  obligationId,
  requirementId,
  runId,
  raw,
  expectedBinding
}) {
  const reasons = []
  const clearNegative =
    obligationId === "SAFE-12-authority-clear-negative-control"
  const negative =
    obligationId === "SAFE-12-authority-negative-control" || clearNegative
  const expectedId = clearNegative
    ? "SAFE-12-authority-clear-negative-control"
    : negative
      ? "SAFE-12-authority-negative-control"
      : "SAFE-12-authority-model"

  if (!raw || typeof raw !== "object") {
    return { valid: false, reasons: ["missing-result"] }
  }
  if (
    obligationId !== expectedId ||
    raw.id !== expectedId ||
    requirementId !== "SAFE-12" ||
    raw.requirementId !== "SAFE-12" ||
    raw.runId !== runId
  ) {
    reasons.push("stale-or-mismatched-run-identity")
  }
  if (!validCommonBinding(raw, expectedBinding)) {
    reasons.push("source-binding-mismatch")
  }
  if (
    raw.status !== "PASS" ||
    raw.exitCode !== 0 ||
    raw.modelComplete !== true ||
    !exactActionList(raw.requiredActions)
  ) {
    reasons.push("model-result-or-required-actions-invalid")
  }

  if (clearNegative) {
    if (
      raw.expectedCounterexampleDetected !== true ||
      raw.violatedInvariant !== "InvSafetyRowsRetained" ||
      raw.counterexampleAction !== "ClearRecovery" ||
      raw.tlcExitCode !== 12 ||
      !(raw.statesGenerated > 0) ||
      !(raw.depth > 0) ||
      !/Invariant InvSafetyRowsRetained is violated/.test(raw.output ?? "") ||
      !/State \d+: <ClearRecovery line/.test(raw.output ?? "") ||
      expectedBinding.clearNegativeConfigGuardOn !== true
    ) {
      reasons.push("unsafe-terminal-unknown-clear-counterexample-not-proven")
    }
  } else if (negative) {
    if (
      raw.expectedCounterexampleDetected !== true ||
      raw.violatedInvariant !== "InvActiveIntentGuardRetained" ||
      raw.counterexampleAction !== "PruneCompletedHistory" ||
      raw.tlcExitCode !== 12 ||
      !(raw.statesGenerated > 0) ||
      !(raw.depth > 0) ||
      !/Invariant InvActiveIntentGuardRetained is violated/.test(raw.output ?? "") ||
      !/State \d+: <PruneCompletedHistory line/.test(raw.output ?? "") ||
      expectedBinding.negativeConfigGuardOn !== true
    ) {
      reasons.push("unsafe-guard-pruning-counterexample-not-proven")
    }
  } else if (
    raw.coverageComplete !== true ||
    RECOVERY_AUTHORITY_REQUIRED_ACTIONS.some(
      (action) => !(raw.coverageCounts?.[action] > 0)
    ) ||
    !(raw.statesGenerated > 0) ||
    !(raw.statesExplored > 0) ||
    !(raw.depth > 0) ||
    !/Model checking completed\. No error has been found\./.test(raw.output ?? "") ||
    expectedBinding.positiveConfigGuardOff !== true
  ) {
    reasons.push("positive-model-coverage-incomplete")
  }

  return { valid: reasons.length === 0, reasons }
}
