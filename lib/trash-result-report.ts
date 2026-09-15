export type TrashResultStatus = "complete" | "partial" | "failed"

export interface TrashResultReport {
  reportId: string
  operationId?: string
  createdAt: string
  status: TrashResultStatus
  attemptedCount: number
  movedCount: number
  failedCount: number
  attemptedMediaKeys: string[]
  attemptedDedupKeys: string[]
  movedMediaKeys: string[]
  movedDedupKeys: string[]
  failedMediaKeys: string[]
  failedDedupKeys: string[]
  retryAttempts: number
  error: string | null
}

function remainingInOrder(attempted: string[], moved: string[]): string[] {
  const movedSet = new Set(moved)
  return attempted.filter((key) => !movedSet.has(key))
}

function intersectionInAttemptedOrder(attempted: string[], moved: string[]): string[] {
  const movedSet = new Set(moved)
  return attempted.filter((key) => movedSet.has(key))
}

export function buildTrashResultReport(params: {
  operationId?: string
  attemptedMediaKeys: string[]
  attemptedDedupKeys: string[]
  movedMediaKeys: string[]
  movedDedupKeys: string[]
  retryAttempts?: number
  error?: string | null
}): TrashResultReport {
  const movedMediaKeys = intersectionInAttemptedOrder(
    params.attemptedMediaKeys,
    params.movedMediaKeys
  )
  const movedDedupKeys = intersectionInAttemptedOrder(
    params.attemptedDedupKeys,
    params.movedDedupKeys
  )
  const failedMediaKeys = remainingInOrder(
    params.attemptedMediaKeys,
    movedMediaKeys
  )
  const failedDedupKeys = remainingInOrder(
    params.attemptedDedupKeys,
    movedDedupKeys
  )
  const movedCount = movedMediaKeys.length
  const attemptedCount = params.attemptedMediaKeys.length
  const status: TrashResultStatus =
    movedCount === attemptedCount && !params.error
      ? "complete"
      : movedCount > 0
        ? "partial"
        : "failed"

  return {
    reportId: `gpd-trash-result-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    ...(params.operationId ? { operationId: params.operationId } : {}),
    createdAt: new Date().toISOString(),
    status,
    attemptedCount,
    movedCount,
    failedCount: failedMediaKeys.length,
    attemptedMediaKeys: params.attemptedMediaKeys,
    attemptedDedupKeys: params.attemptedDedupKeys,
    movedMediaKeys,
    movedDedupKeys,
    failedMediaKeys,
    failedDedupKeys,
    retryAttempts: Math.max(0, Math.floor(params.retryAttempts ?? 0)),
    error: params.error ?? null
  }
}
