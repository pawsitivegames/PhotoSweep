/**
 * Classify the child trace-replay result for verification-runner obligations.
 *
 * The child runner exits 2 when it found real, explicitly reported unsupported
 * model seams. That exit is acceptable only when the result is otherwise
 * healthy. Any export, test, replay, or supported-projection failure wins over
 * the unsupported inventory so a mixed failure cannot be reported as merely a
 * boundedness gap. The envelope is validated before status classification so
 * missing or forged replay fields fail closed.
 */

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isSafeNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function isStatus(value) {
  return (
    value === "PASS" || value === "PASS_WITH_UNSUPPORTED" || value === "FAIL"
  )
}

function stringArray(value) {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0)
  )
}

function replayCountsAreValid(counts) {
  return (
    isRecord(counts) &&
    ["traces", "pass", "fail", "unsupported"].every((field) =>
      isSafeNonnegativeInteger(counts[field])
    )
  )
}

function unsupportedReasonsAreValid(reasons) {
  return (
    Array.isArray(reasons) &&
    reasons.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.reason === "string" &&
        entry.reason.length > 0 &&
        isSafeNonnegativeInteger(entry.count)
    )
  )
}

export function classifyTraceReplayResult({ raw, result, supported }) {
  const failureReasons = []
  const rawRecord = isRecord(raw)
  const resultRecord = isRecord(result)
  const replay = rawRecord && isRecord(raw.replay) ? raw.replay : null

  if (!rawRecord || !replay) {
    failureReasons.push("missing child result or replay report")
  }
  if (typeof supported !== "boolean") {
    failureReasons.push("supported obligation flag is missing or malformed")
  }
  if (rawRecord && !["PASS", "BLOCKED", "FAIL"].includes(raw.status)) {
    failureReasons.push("child status is missing or malformed")
  }
  if (!resultRecord || !isSafeNonnegativeInteger(result?.exitCode)) {
    failureReasons.push("child runner exitCode is missing or malformed")
  }
  if (rawRecord && raw.export?.status !== "PASS") {
    failureReasons.push("trace export did not PASS")
  }
  if (rawRecord && !isSafeNonnegativeInteger(raw.test?.exitCode)) {
    failureReasons.push("replay test exitCode is missing or malformed")
  } else if (rawRecord && raw.test.exitCode !== 0) {
    failureReasons.push("replay test command did not exit 0")
  }

  let replayStatusValid = false
  let replayCountsValid = false
  let replayCoverageValid = false
  let replayUnsupportedActionsValid = false
  if (replay) {
    replayStatusValid = isStatus(replay.status)
    if (!replayStatusValid) {
      failureReasons.push("replay status is missing or malformed")
    }
    if (replay.supportedProjectionStatus !== "PASS") {
      failureReasons.push("supported projection did not PASS")
    }

    replayCountsValid = replayCountsAreValid(replay.counts)
    if (!replayCountsValid) {
      failureReasons.push("replay counts are missing or malformed")
    }
    replayCoverageValid =
      isRecord(replay.coverage) && typeof replay.coverage.complete === "boolean"
    if (!replayCoverageValid) {
      failureReasons.push("replay coverage status is missing or malformed")
    }
    replayUnsupportedActionsValid = stringArray(replay.unsupportedActions)
    if (!replayUnsupportedActionsValid) {
      failureReasons.push(
        "replay unsupported action inventory is missing or malformed"
      )
    }
    if (!unsupportedReasonsAreValid(replay.unsupportedReasons)) {
      failureReasons.push(
        "replay unsupported reason inventory is missing or malformed"
      )
    }

    if (
      replayStatusValid &&
      replayCountsValid &&
      replayUnsupportedActionsValid
    ) {
      const hasUnsupportedEvidence =
        replay.counts.unsupported > 0 || replay.unsupportedActions.length > 0
      if (replay.status === "PASS" && hasUnsupportedEvidence) {
        failureReasons.push(
          "replay status PASS contradicts its unsupported action inventory"
        )
      }
      if (
        replay.status === "PASS_WITH_UNSUPPORTED" &&
        !hasUnsupportedEvidence
      ) {
        failureReasons.push(
          "replay status PASS_WITH_UNSUPPORTED has no unsupported evidence"
        )
      }
    }
    if (
      replay.status === "FAIL" ||
      (replayCountsValid && replay.counts.fail > 0)
    ) {
      failureReasons.push("replay reported failed supported steps")
    }
  }

  const unsupportedCount = replayCountsValid ? replay.counts.unsupported : null
  const unsupportedActions = replayUnsupportedActionsValid
    ? replay.unsupportedActions
    : []
  const hasUnsupported = Boolean(
    replay &&
      ((unsupportedCount !== null && unsupportedCount > 0) ||
        unsupportedActions.length > 0 ||
        replay.status === "PASS_WITH_UNSUPPORTED")
  )
  if (replay && replayCoverageValid && replay.coverage.complete !== true) {
    failureReasons.push("supported coverage is incomplete")
  }

  const rawStatus = rawRecord ? raw.status : null
  const exitCode = resultRecord ? result.exitCode : null
  const expectedBlockedExit =
    replayStatusValid &&
    replayCountsValid &&
    replayCoverageValid &&
    replayUnsupportedActionsValid &&
    hasUnsupported &&
    rawStatus === "BLOCKED" &&
    exitCode === 2
  const expectedPassExit =
    replayStatusValid &&
    replayCountsValid &&
    replayCoverageValid &&
    replayUnsupportedActionsValid &&
    !hasUnsupported &&
    rawStatus === "PASS" &&
    exitCode === 0
  if (!(expectedPassExit || expectedBlockedExit)) {
    failureReasons.push(
      hasUnsupported
        ? "child runner did not return the expected unsupported-seam exit 2"
        : "child runner did not return the expected PASS exit 0"
    )
  }
  if (hasUnsupported && rawStatus !== "BLOCKED") {
    failureReasons.push("child status is inconsistent with unsupported seams")
  }
  if (!hasUnsupported && rawStatus !== "PASS") {
    failureReasons.push("child status is inconsistent with a complete replay")
  }

  const failed = failureReasons.length > 0
  const supportedProjectionPassed = !failed && replay != null
  const status = failed
    ? "FAIL"
    : supported
      ? "PASS"
      : hasUnsupported
        ? "BLOCKED"
        : "PASS"

  return {
    status,
    failed,
    failureReasons,
    hasUnsupported,
    unsupportedActions,
    expectedBlockedExit,
    supportedProjectionPassed
  }
}
