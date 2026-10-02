import type { MutationOutcome } from "./types"

export type TrashResultStatus =
  | "complete"
  | "partial"
  | "failed"
  | "unknown"
  | "not_dispatched"

export interface TrashResultReport {
  reportId: string
  operationId?: string
  createdAt: string
  status: TrashResultStatus
  attemptedCount: number
  movedCount: number
  failedCount: number
  unknownCount?: number
  notDispatchedCount?: number
  attemptedMediaKeys: string[]
  attemptedDedupKeys: string[]
  movedMediaKeys: string[]
  movedDedupKeys: string[]
  failedMediaKeys: string[]
  failedDedupKeys: string[]
  unknownMediaKeys?: string[]
  unknownDedupKeys?: string[]
  notDispatchedMediaKeys?: string[]
  notDispatchedDedupKeys?: string[]
  outcomes?: MutationOutcome[]
  retryAttempts: number
  error: string | null
}

export function buildTrashResultReport(params: {
  operationId?: string
  attemptedMediaKeys: string[]
  attemptedDedupKeys: string[]
  movedMediaKeys: string[]
  movedDedupKeys: string[]
  outcomes?: MutationOutcome[]
  notDispatchedDedupKeys?: string[]
  retryAttempts?: number
  error?: string | null
}): TrashResultReport {
  const notDispatchedSet = new Set(
    (params.notDispatchedDedupKeys ?? []).filter((key) =>
      params.attemptedDedupKeys.includes(key)
    )
  )
  const suppliedOutcomes = params.outcomes
  const outcomeByKey = new Map<string, MutationOutcome>()
  for (const outcome of suppliedOutcomes ?? []) {
    if (
      outcome?.operation === "trash" &&
      typeof outcome.targetKey === "string" &&
      params.attemptedDedupKeys.includes(outcome.targetKey) &&
      !outcomeByKey.has(outcome.targetKey) &&
      (outcome.status === "confirmed" ||
        outcome.status === "failed" ||
        outcome.status === "unknown")
    ) {
      outcomeByKey.set(outcome.targetKey, outcome)
    }
  }

  const alignedOutcomes = params.attemptedDedupKeys.map((targetKey, index) => {
    const supplied = outcomeByKey.get(targetKey)
    if (supplied) return supplied
    const status: MutationOutcome["status"] = notDispatchedSet.has(targetKey)
      ? "failed"
      : suppliedOutcomes
        ? "unknown"
        : params.movedDedupKeys.includes(targetKey) ||
            params.movedMediaKeys.includes(params.attemptedMediaKeys[index]!)
          ? "confirmed"
          : "failed"
    return {
      operation: "trash" as const,
      targetKey,
      status,
      ...(notDispatchedSet.has(targetKey)
        ? { reason: "not-dispatched" }
        : {})
    }
  })
  for (const key of [...notDispatchedSet]) {
    const outcome = outcomeByKey.get(key)
    if (suppliedOutcomes && outcome?.status !== "failed") {
      notDispatchedSet.delete(key)
    }
  }
  const confirmedKeys = new Set(
    alignedOutcomes
      .filter((outcome) => outcome.status === "confirmed")
      .map((outcome) => outcome.targetKey)
  )
  const unknownKeys = new Set(
    alignedOutcomes
      .filter((outcome) => outcome.status === "unknown")
      .map((outcome) => outcome.targetKey)
  )
  const failedKeys = new Set(
    alignedOutcomes
      .filter(
        (outcome) =>
          outcome.status === "failed" && !notDispatchedSet.has(outcome.targetKey)
      )
      .map((outcome) => outcome.targetKey)
  )
  const movedDedupKeys = params.attemptedDedupKeys.filter((key) =>
    confirmedKeys.has(key)
  )
  const movedMediaKeys = movedDedupKeys.flatMap((key) => {
    const index = params.attemptedDedupKeys.indexOf(key)
    const mediaKey = params.attemptedMediaKeys[index]
    return mediaKey ? [mediaKey] : []
  })
  const failedDedupKeys = params.attemptedDedupKeys.filter((key) =>
    failedKeys.has(key)
  )
  const failedMediaKeys = failedDedupKeys.flatMap((key) => {
    const index = params.attemptedDedupKeys.indexOf(key)
    const mediaKey = params.attemptedMediaKeys[index]
    return mediaKey ? [mediaKey] : []
  })
  const unknownDedupKeys = params.attemptedDedupKeys.filter((key) =>
    unknownKeys.has(key)
  )
  const unknownMediaKeys = unknownDedupKeys.flatMap((key) => {
    const index = params.attemptedDedupKeys.indexOf(key)
    const mediaKey = params.attemptedMediaKeys[index]
    return mediaKey ? [mediaKey] : []
  })
  const notDispatchedDedupKeys = params.attemptedDedupKeys.filter((key) =>
    notDispatchedSet.has(key)
  )
  const notDispatchedMediaKeys = notDispatchedDedupKeys.flatMap((key) => {
    const index = params.attemptedDedupKeys.indexOf(key)
    const mediaKey = params.attemptedMediaKeys[index]
    return mediaKey ? [mediaKey] : []
  })
  const movedCount = movedMediaKeys.length
  const attemptedCount = params.attemptedMediaKeys.length
  const unknownCount = unknownMediaKeys.length
  const notDispatchedCount = notDispatchedMediaKeys.length
  const status: TrashResultStatus =
    movedCount === attemptedCount && !params.error
      ? "complete"
      : movedCount > 0
        ? "partial"
        : unknownCount > 0
          ? "unknown"
          : notDispatchedCount === attemptedCount
            ? "not_dispatched"
            : "failed"

  return {
    reportId: `gpd-trash-result-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    ...(params.operationId ? { operationId: params.operationId } : {}),
    createdAt: new Date().toISOString(),
    status,
    attemptedCount,
    movedCount,
    failedCount: failedMediaKeys.length,
    unknownCount,
    notDispatchedCount,
    attemptedMediaKeys: params.attemptedMediaKeys,
    attemptedDedupKeys: params.attemptedDedupKeys,
    movedMediaKeys,
    movedDedupKeys,
    failedMediaKeys,
    failedDedupKeys,
    unknownMediaKeys,
    unknownDedupKeys,
    notDispatchedMediaKeys,
    notDispatchedDedupKeys,
    outcomes: alignedOutcomes,
    retryAttempts: Math.max(0, Math.floor(params.retryAttempts ?? 0)),
    error: params.error ?? null
  }
}
