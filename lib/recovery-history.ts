import type { DeleteReport } from "./delete-report"
import { accountFingerprint } from "./review-preflight"
import type { TrashResultReport } from "./trash-result-report"
import type { GpdMediaItem, MutationOutcome, PhotoProvider } from "./types"

export const RECOVERY_HISTORY_STORAGE_KEY = "recoveryHistory"
export const RECOVERY_HISTORY_VERSION = 1 as const
export const MAX_RECOVERY_HISTORY_RECORDS = 20
export const RECOVERY_HISTORY_TTL_MS = 180 * 24 * 60 * 60 * 1000
const MAX_RESTORE_ATTEMPTS = 10

export interface RecoveryRestoreAttempt {
  at: string
  outcomes: MutationOutcome[]
  notDispatchedDedupKeys: string[]
  /** In-memory live request binding; a persisted timeout is never replayed. */
  requestId?: string
  /** False is provisional timeout evidence; only that exact live request may resolve it. */
  terminal?: boolean
  targetMediaKeys?: string[]
  icloudAssetRefs?: RecoveryAssetRef[]
}

export type RecoveryHistoryStatus =
  | "pending"
  | "complete"
  | "partial"
  | "failed"
  | "unknown"
  | "not_dispatched"
  | "restored"
  | "restore_partial"
  | "restore_failed"
  | "restore_unknown"

export type RecoveryAssetRef = NonNullable<GpdMediaItem["icloudAsset"]>

export interface RecoveryHistoryRecord {
  version: typeof RECOVERY_HISTORY_VERSION
  operationId: string
  preTrashReportId: string
  trashResultReportId?: string
  provider: PhotoProvider
  createdAt: string
  updatedAt: string
  accountFingerprint?: string
  providerSessionId?: string
  scopeLabel?: string
  scopeFingerprint?: string
  attemptedCount: number
  movedCount: number
  failedCount: number
  unknownCount?: number
  notDispatchedCount?: number
  restoreUnknownCount?: number
  /** Latest safety state for every restore target seen so far. Unknown is sticky. */
  restoreOutcomes?: MutationOutcome[]
  /** Bounded exact per-attempt evidence, including the never-issued subset. */
  restoreOutcomeHistory?: RecoveryRestoreAttempt[]
  /** Historical keys that were never issued in at least one terminal attempt. */
  restoreEverNotDispatchedDedupKeys?: string[]
  status: RecoveryHistoryStatus
  restorableDedupKeys: string[]
  restorableMediaKeys: string[]
  icloudAssetRefs?: RecoveryAssetRef[]
  restoreAttempts: number
  restoredAt?: string
  lastError?: string
}

export function hasUnresolvedRecoverySafetyState(
  record: Pick<
    RecoveryHistoryRecord,
    | "status"
    | "unknownCount"
    | "restoreUnknownCount"
    | "restoreOutcomes"
    | "restoreOutcomeHistory"
  >
): boolean {
  return (
    record.status === "pending" ||
    record.status === "unknown" ||
    record.status === "restore_unknown" ||
    (record.unknownCount ?? 0) > 0 ||
    (record.restoreUnknownCount ?? 0) > 0 ||
    record.restoreOutcomes?.some((outcome) => outcome.status === "unknown") ===
      true ||
    record.restoreOutcomeHistory?.some(
      (attempt) =>
        attempt.terminal === false ||
        attempt.outcomes.some((outcome) => outcome.status === "unknown")
    ) === true
  )
}

export interface RecoveryHistoryContext {
  operationId: string
  provider: PhotoProvider
  accountEmail?: string
  providerSessionId?: string
  scopeLabel?: string
  scopeFingerprint?: string
  attemptedDedupKeys: string[]
  attemptedMediaKeys: string[]
  icloudAssetRefs?: RecoveryAssetRef[]
  /** Fresh refs aligned to report.movedDedupKeys after a confirmed trash move. */
  confirmedIcloudAssetRefs?: RecoveryAssetRef[]
}

export interface RecoveryRestoreStatusUpdate {
  outcome: "complete" | "partial" | "failed" | "unknown"
  requestId?: string
  terminal?: boolean
  /** Exact target subset reserved by the initial restore transaction. */
  targetDedupKeys?: string[]
  restoredDedupKeys: string[]
  unknownDedupKeys?: string[]
  outcomes?: MutationOutcome[]
  notDispatchedDedupKeys?: string[]
  error?: string
}

function validProvider(value: unknown): value is PhotoProvider {
  return value === "google" || value === "icloud" || value === "amazon"
}

function uniqueStrings(
  value: unknown,
  max = Number.POSITIVE_INFINITY
): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(value.filter((item): item is string => typeof item === "string"))
  ].slice(0, max)
}

function validStatus(value: unknown): value is RecoveryHistoryStatus {
  return (
    value === "pending" ||
    value === "complete" ||
    value === "partial" ||
    value === "failed" ||
    value === "unknown" ||
    value === "not_dispatched" ||
    value === "restored" ||
    value === "restore_partial" ||
    value === "restore_failed" ||
    value === "restore_unknown"
  )
}

function sanitizeAssetRefs(value: unknown): RecoveryAssetRef[] | undefined {
  if (!Array.isArray(value)) return undefined
  const refs = value.filter((candidate): candidate is RecoveryAssetRef => {
    if (!candidate || typeof candidate !== "object") return false
    const ref = candidate as Partial<RecoveryAssetRef>
    return (
      typeof ref.recordName === "string" &&
      typeof ref.changeTag === "string" &&
      typeof ref.zoneName === "string" &&
      typeof ref.ownerRecordName === "string"
    )
  })
  return refs.length > 0 ? refs : undefined
}

function sanitizeRestoreOutcomes(value: unknown): MutationOutcome[] {
  if (!Array.isArray(value)) return []
  const byKey = new Map<string, MutationOutcome>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue
    const raw = candidate as Partial<MutationOutcome>
    if (
      raw.operation !== "restore" ||
      typeof raw.targetKey !== "string" ||
      raw.targetKey.length === 0 ||
      (raw.status !== "confirmed" &&
        raw.status !== "failed" &&
        raw.status !== "unknown")
    ) {
      continue
    }
    const prior = byKey.get(raw.targetKey)
    const status =
      prior || prior?.status === "unknown" || raw.status === "unknown"
        ? "unknown"
        : prior?.status === "confirmed" || raw.status === "confirmed"
          ? "confirmed"
          : "failed"
    byKey.set(raw.targetKey, {
      operation: "restore",
      targetKey: raw.targetKey,
      status,
      ...(typeof raw.reason === "string"
        ? { reason: raw.reason.slice(0, 300) }
        : {})
    })
  }
  return [...byKey.values()]
}

function validRestoreRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function sanitizeRestoreOutcomeHistory(value: unknown): RecoveryRestoreAttempt[] {
  if (!Array.isArray(value)) return []
  const attempts = value
    .flatMap((candidate): RecoveryRestoreAttempt[] => {
      if (!candidate || typeof candidate !== "object") return []
      const raw = candidate as Partial<RecoveryRestoreAttempt>
      if (typeof raw.at !== "string" || !Array.isArray(raw.outcomes)) return []
      const outcomes = sanitizeRestoreOutcomes(raw.outcomes)
      if (
        outcomes.length !== raw.outcomes.length ||
        new Set(outcomes.map((outcome) => outcome.targetKey)).size !==
          raw.outcomes.length
      ) {
        return []
      }
      const requested = new Set(outcomes.map((outcome) => outcome.targetKey))
      const statusByKey = new Map(
        outcomes.map((outcome) => [outcome.targetKey, outcome.status])
      )
      if (
        raw.notDispatchedDedupKeys !== undefined &&
        !Array.isArray(raw.notDispatchedDedupKeys)
      ) {
        return []
      }
      const rawNotDispatched = raw.notDispatchedDedupKeys ?? []
      if (
        rawNotDispatched.some(
          (key) =>
          typeof key !== "string" ||
          !requested.has(key) ||
            statusByKey.get(key) !== "failed"
        )
      ) {
        return []
      }
      const requestId = validRestoreRequestId(raw.requestId)
        ? raw.requestId
        : undefined
      const targetMediaKeys =
        Array.isArray(raw.targetMediaKeys) &&
        raw.targetMediaKeys.length === outcomes.length &&
        raw.targetMediaKeys.every(
          (key) => typeof key === "string" && key.length > 0
        )
          ? (raw.targetMediaKeys as string[])
          : undefined
      const rawAssetRefs = raw.icloudAssetRefs
      const sanitizedAssetRefs = sanitizeAssetRefs(rawAssetRefs)
      const icloudAssetRefs =
        Array.isArray(rawAssetRefs) &&
        rawAssetRefs.length === outcomes.length &&
        sanitizedAssetRefs?.length === outcomes.length
          ? sanitizedAssetRefs
          : undefined
      return [
        {
          at: raw.at.slice(0, 40),
          outcomes,
          notDispatchedDedupKeys: uniqueStrings(rawNotDispatched),
          ...(requestId ? { requestId } : {}),
          ...(requestId && typeof raw.terminal === "boolean"
            ? { terminal: raw.terminal }
            : {}),
          ...(targetMediaKeys ? { targetMediaKeys } : {}),
          ...(icloudAssetRefs ? { icloudAssetRefs } : {})
        }
      ]
    })
    .slice(-MAX_RESTORE_ATTEMPTS)

  // Duplicate request IDs cannot identify one immutable live attempt. Strip
  // the binding so no persisted duplicate can authorize late reconciliation.
  const requestIdCounts = new Map<string, number>()
  for (const attempt of attempts) {
    if (attempt.requestId) {
      requestIdCounts.set(
        attempt.requestId,
        (requestIdCounts.get(attempt.requestId) ?? 0) + 1
      )
    }
  }
  return attempts.map((attempt) => {
    if (!attempt.requestId || requestIdCounts.get(attempt.requestId) === 1) {
      return attempt
    }
    const { requestId: _requestId, terminal: _terminal, ...sealed } = attempt
    return sealed
  })
}

export function sanitizeRecoveryHistory(
  value: unknown,
  now = Date.now()
): RecoveryHistoryRecord[] {
  if (!Array.isArray(value)) return []
  const records: RecoveryHistoryRecord[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue
    const raw = candidate as Partial<RecoveryHistoryRecord>
    if (
      raw.version !== RECOVERY_HISTORY_VERSION ||
      typeof raw.operationId !== "string" ||
      typeof raw.preTrashReportId !== "string" ||
      !validProvider(raw.provider) ||
      typeof raw.createdAt !== "string" ||
      typeof raw.updatedAt !== "string" ||
      !validStatus(raw.status) ||
      typeof raw.attemptedCount !== "number" ||
      typeof raw.movedCount !== "number" ||
      typeof raw.failedCount !== "number" ||
      typeof raw.restoreAttempts !== "number"
    ) {
      continue
    }
    const updatedAt = Date.parse(raw.updatedAt)
    const expired =
      Number.isFinite(updatedAt) && now - updatedAt > RECOVERY_HISTORY_TTL_MS
    const restoreOutcomes = sanitizeRestoreOutcomes(raw.restoreOutcomes)
    const rawRestorableKeys = Array.isArray(raw.restorableDedupKeys)
      ? raw.restorableDedupKeys.filter(
          (key): key is string => typeof key === "string"
        )
      : []
    const restorableKeys = uniqueStrings(rawRestorableKeys)
    const protectedKeys = new Set(
      restoreOutcomes
        .filter(
          (outcome) =>
            outcome.status === "confirmed" || outcome.status === "unknown"
        )
        .map((outcome) => outcome.targetKey)
    )
    const safeRestorableKeys = restorableKeys.filter(
      (key) => !protectedKeys.has(key)
    )
    const mediaByKey = new Map<string, string>()
    const rawRestorableMediaKeys = Array.isArray(raw.restorableMediaKeys)
      ? raw.restorableMediaKeys
      : []
    if (rawRestorableMediaKeys.length === rawRestorableKeys.length) {
      rawRestorableKeys.forEach((key, index) => {
        const mediaKey = rawRestorableMediaKeys[index]
        if (
          typeof key === "string" &&
          typeof mediaKey === "string" &&
          key.length > 0 &&
          mediaKey.length > 0 &&
          !mediaByKey.has(key)
        ) {
          mediaByKey.set(key, mediaKey)
        }
      })
    }
    const safeRestorableMediaKeys = safeRestorableKeys.every((key) =>
      mediaByKey.has(key)
    )
      ? safeRestorableKeys.map((key) => mediaByKey.get(key)!)
      : []
    const refsByKey = new Map<string, RecoveryAssetRef>()
    const rawRestorableRefs = raw.icloudAssetRefs
    const sanitizedRestorableRefs = sanitizeAssetRefs(rawRestorableRefs)
    if (
      Array.isArray(rawRestorableRefs) &&
      rawRestorableRefs.length === rawRestorableKeys.length &&
      sanitizedRestorableRefs?.length === rawRestorableKeys.length
    ) {
      rawRestorableKeys.forEach((key, index) => {
        if (typeof key === "string" && !refsByKey.has(key)) {
          refsByKey.set(key, sanitizedRestorableRefs[index]!)
        }
      })
    }
    const safeRestorableRefs =
      safeRestorableKeys.length > 0 &&
      safeRestorableKeys.every((key) => refsByKey.has(key))
      ? safeRestorableKeys.map((key) => refsByKey.get(key)!)
      : undefined
    const hasUnknownRestoreOutcome = restoreOutcomes.some(
      (outcome) => outcome.status === "unknown"
    )

    const record: RecoveryHistoryRecord = {
      version: RECOVERY_HISTORY_VERSION,
      operationId: raw.operationId,
      preTrashReportId: raw.preTrashReportId,
      ...(typeof raw.trashResultReportId === "string"
        ? { trashResultReportId: raw.trashResultReportId }
        : {}),
      provider: raw.provider,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      ...(typeof raw.accountFingerprint === "string"
        ? { accountFingerprint: raw.accountFingerprint }
        : {}),
      ...(typeof raw.providerSessionId === "string"
        ? { providerSessionId: raw.providerSessionId }
        : {}),
      ...(typeof raw.scopeLabel === "string"
        ? { scopeLabel: raw.scopeLabel }
        : {}),
      ...(typeof raw.scopeFingerprint === "string"
        ? { scopeFingerprint: raw.scopeFingerprint }
        : {}),
      attemptedCount: Math.max(0, Math.floor(raw.attemptedCount)),
      movedCount: Math.max(0, Math.floor(raw.movedCount)),
      failedCount: Math.max(0, Math.floor(raw.failedCount)),
      unknownCount: Math.max(0, Math.floor(raw.unknownCount ?? 0)),
      notDispatchedCount: Math.max(
        0,
        Math.floor(raw.notDispatchedCount ?? 0)
      ),
      restoreUnknownCount: Math.max(
        0,
        Math.floor(raw.restoreUnknownCount ?? 0)
      ),
      ...(restoreOutcomes.length > 0
        ? { restoreOutcomes }
        : {}),
      ...(sanitizeRestoreOutcomeHistory(raw.restoreOutcomeHistory).length > 0
        ? {
            restoreOutcomeHistory: sanitizeRestoreOutcomeHistory(
              raw.restoreOutcomeHistory
            )
          }
        : {}),
      ...(uniqueStrings(raw.restoreEverNotDispatchedDedupKeys).length > 0
        ? {
            restoreEverNotDispatchedDedupKeys: uniqueStrings(
              raw.restoreEverNotDispatchedDedupKeys
            )
          }
        : {}),
      status: hasUnknownRestoreOutcome ? "restore_unknown" : raw.status,
      restorableDedupKeys: safeRestorableKeys,
      restorableMediaKeys: safeRestorableMediaKeys,
      ...(safeRestorableRefs
        ? { icloudAssetRefs: safeRestorableRefs }
        : {}),
      restoreAttempts: Math.max(0, Math.floor(raw.restoreAttempts)),
      ...(typeof raw.restoredAt === "string"
        ? { restoredAt: raw.restoredAt }
        : {}),
      ...(typeof raw.lastError === "string"
        ? { lastError: raw.lastError.slice(0, 500) }
        : {})
    }
    if (expired && !hasUnresolvedRecoverySafetyState(record)) continue
    records.push(record)
  }
  const byId = new Map<string, RecoveryHistoryRecord>()
  for (const record of records) byId.set(record.operationId, record)
  const ordered = [...byId.values()].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  )
  const safetyRecords = ordered.filter(hasUnresolvedRecoverySafetyState)
  const boundedOrdinaryRecords = ordered
    .filter((record) => !hasUnresolvedRecoverySafetyState(record))
    .slice(0, Math.max(0, MAX_RECOVERY_HISTORY_RECORDS - safetyRecords.length))
  // The cap applies to ordinary completed history. Unresolved operations stay
  // visible and durable until their exact state is reconciled or explicitly
  // retained by the user; dropping them would erase no-replay guards.
  return [...safetyRecords, ...boundedOrdinaryRecords].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  )
}

export function createPendingRecoveryRecord(
  report: DeleteReport,
  context: RecoveryHistoryContext,
  now = new Date()
): RecoveryHistoryRecord {
  const iso = now.toISOString()
  return {
    version: RECOVERY_HISTORY_VERSION,
    operationId: context.operationId,
    preTrashReportId: report.reportId,
    provider: context.provider,
    createdAt: report.createdAt,
    updatedAt: iso,
    ...(accountFingerprint(context.accountEmail)
      ? { accountFingerprint: accountFingerprint(context.accountEmail) }
      : {}),
    ...(context.providerSessionId
      ? { providerSessionId: context.providerSessionId }
      : {}),
    ...(context.scopeLabel ? { scopeLabel: context.scopeLabel } : {}),
    ...(context.scopeFingerprint
      ? { scopeFingerprint: context.scopeFingerprint }
      : {}),
    attemptedCount: context.attemptedDedupKeys.length,
    movedCount: 0,
    failedCount: 0,
    unknownCount: 0,
    notDispatchedCount: 0,
    restoreUnknownCount: 0,
    status: "pending",
    restorableDedupKeys: [],
    restorableMediaKeys: [],
    restoreAttempts: 0
  }
}

export function updateRecoveryRecordFromTrash(
  records: RecoveryHistoryRecord[],
  report: TrashResultReport,
  context: RecoveryHistoryContext,
  now = new Date()
): RecoveryHistoryRecord[] {
  const iso = now.toISOString()
  const existing = records.find(
    (record) => record.operationId === context.operationId
  )
  const next: RecoveryHistoryRecord = {
    ...(existing ??
      createPendingRecoveryRecord(
        {
          reportId: context.operationId,
          createdAt: iso,
          totalGroupsAffected: 0,
          totalItemsKept: 0,
          totalItemsSelectedForTrash: report.attemptedCount,
          trashBatchSize: 0,
          items: []
        },
        context,
        now
      )),
    trashResultReportId: report.reportId,
    updatedAt: iso,
    attemptedCount: report.attemptedCount,
    movedCount: report.movedCount,
    failedCount: report.failedCount,
    unknownCount: report.unknownCount ?? 0,
    notDispatchedCount: report.notDispatchedCount ?? 0,
    status: report.status,
    restorableDedupKeys: report.movedDedupKeys,
    restorableMediaKeys: report.movedMediaKeys,
    icloudAssetRefs:
      context.confirmedIcloudAssetRefs?.length ===
      report.movedDedupKeys.length
        ? context.confirmedIcloudAssetRefs
        : undefined,
    ...(report.error ? { lastError: report.error } : {})
  }
  return sanitizeRecoveryHistory(
    [
      next,
      ...records.filter((record) => record.operationId !== context.operationId)
    ],
    Date.parse(iso)
  )
}

export function markRecoveryRestore(
  records: RecoveryHistoryRecord[],
  operationId: string,
  params: RecoveryRestoreStatusUpdate,
  now = new Date()
): RecoveryHistoryRecord[] {
  const iso = now.toISOString()
  if (params.requestId !== undefined && !validRestoreRequestId(params.requestId)) {
    return sanitizeRecoveryHistory(records, Date.parse(iso))
  }
  return sanitizeRecoveryHistory(
    records.map((record) => {
      if (record.operationId !== operationId) return record
      const history = sanitizeRestoreOutcomeHistory(record.restoreOutcomeHistory)
      const matchingAttemptIndexes = params.requestId
        ? history.flatMap((attempt, index) =>
            attempt.requestId === params.requestId ? [index] : []
          )
        : []
      const sameAttemptIndex =
        matchingAttemptIndexes.length === 1
          ? matchingAttemptIndexes[0]!
          : -1
      const sameAttempt =
        sameAttemptIndex >= 0 ? history[sameAttemptIndex] : undefined
      const terminal = params.terminal !== false
      // Only an explicitly provisional same-request entry can be reconciled.
      // Terminal and legacy request-bound entries are sealed and idempotent.
      if (matchingAttemptIndexes.length > 1) return record
      if (sameAttempt && sameAttempt.terminal !== false) return record

      const suppliedTargetKeys = params.targetDedupKeys as unknown
      const requestKeys = sameAttempt
        ? sameAttempt.outcomes.map((entry) => entry.targetKey)
        : Array.isArray(suppliedTargetKeys)
          ? suppliedTargetKeys.filter(
              (key): key is string => typeof key === "string"
            )
          : [...record.restorableDedupKeys]
      if (
        !sameAttempt &&
        params.targetDedupKeys !== undefined &&
        (!Array.isArray(suppliedTargetKeys) ||
          requestKeys.length !== suppliedTargetKeys.length ||
          requestKeys.length === 0 ||
          new Set(requestKeys).size !== requestKeys.length ||
          requestKeys.some(
            (key) => !record.restorableDedupKeys.includes(key)
          ))
      ) {
        return record
      }
      if (requestKeys.length === 0) return record
      const requestKeySet = new Set(requestKeys)
      const requestHasDuplicateKeys = requestKeySet.size !== requestKeys.length
      const mediaKeyByDedupKey = new Map<string, string>()
      if (
        record.restorableMediaKeys.length === record.restorableDedupKeys.length
      ) {
        record.restorableDedupKeys.forEach((key, index) => {
          mediaKeyByDedupKey.set(key, record.restorableMediaKeys[index]!)
        })
      }
      const assetRefByDedupKey = new Map<string, RecoveryAssetRef>()
      if (
        record.icloudAssetRefs?.length === record.restorableDedupKeys.length
      ) {
        record.restorableDedupKeys.forEach((key, index) => {
          assetRefByDedupKey.set(key, record.icloudAssetRefs![index]!)
        })
      }
      if (sameAttempt) {
        sameAttempt.targetMediaKeys?.forEach((mediaKey, index) => {
          const key = sameAttempt.outcomes[index]?.targetKey
          if (key && !mediaKeyByDedupKey.has(key)) {
            mediaKeyByDedupKey.set(key, mediaKey)
          }
        })
        sameAttempt.icloudAssetRefs?.forEach((assetRef, index) => {
          const key = sameAttempt.outcomes[index]?.targetKey
          if (key && !assetRefByDedupKey.has(key)) {
            assetRefByDedupKey.set(key, assetRef)
          }
        })
      }
      const rawRestored = params.restoredDedupKeys as unknown
      const rawUnknown = params.unknownDedupKeys as unknown
      const rawNotDispatched = Array.isArray(params.notDispatchedDedupKeys)
        ? params.notDispatchedDedupKeys
        : []
      const suppliedOutcomes = Array.isArray(params.outcomes)
        ? params.outcomes
        : []
      const restoredValues = Array.isArray(rawRestored) ? rawRestored : []
      const unknownValues = Array.isArray(rawUnknown) ? rawUnknown : []
      const restoredDedupKeys = new Set(
        restoredValues.filter(
          (key): key is string =>
            typeof key === "string" && requestKeySet.has(key)
        )
      )
      const unknownDedupKeys = new Set(
        unknownValues.filter(
          (key): key is string =>
            typeof key === "string" && requestKeySet.has(key)
        )
      )
      const notDispatchedDedupKeys = new Set(
        rawNotDispatched.filter((key) => requestKeySet.has(key))
      )
      const outcomeByKey = new Map<string, MutationOutcome>()
      let malformed =
        matchingAttemptIndexes.length > 1 ||
        requestHasDuplicateKeys ||
        requestKeys.length === 0 ||
        !Array.isArray(rawRestored) ||
        restoredValues.length !== rawRestored.length ||
        new Set(restoredValues).size !== restoredValues.length ||
        restoredValues.some(
          (key) => typeof key !== "string" || !requestKeySet.has(key)
        ) ||
        (rawUnknown !== undefined && !Array.isArray(rawUnknown)) ||
        unknownValues.length !== unknownDedupKeys.size ||
        new Set(unknownValues).size !== unknownValues.length ||
        unknownValues.some(
          (key) => typeof key !== "string" || !requestKeySet.has(key)
        ) ||
        (params.notDispatchedDedupKeys !== undefined &&
          !Array.isArray(params.notDispatchedDedupKeys)) ||
        (params.outcomes !== undefined && !Array.isArray(params.outcomes)) ||
        (rawNotDispatched.length > 0 && params.outcomes === undefined) ||
        rawNotDispatched.length !== notDispatchedDedupKeys.size ||
        new Set(rawNotDispatched).size !== rawNotDispatched.length ||
        params.restoredDedupKeys.some((key) => !requestKeySet.has(key)) ||
        (params.unknownDedupKeys ?? []).some(
          (key) => !requestKeySet.has(key)
        )
      for (const candidate of suppliedOutcomes) {
        if (
          !candidate ||
          candidate.operation !== "restore" ||
          typeof candidate.targetKey !== "string" ||
          !requestKeySet.has(candidate.targetKey) ||
          (candidate.status !== "confirmed" &&
            candidate.status !== "failed" &&
            candidate.status !== "unknown") ||
          outcomeByKey.has(candidate.targetKey)
        ) {
          malformed = true
          continue
        }
        outcomeByKey.set(candidate.targetKey, candidate)
      }
      if (
        params.outcomes !== undefined &&
        (outcomeByKey.size !== requestKeys.length ||
          restoredValues.some(
            (key) =>
              typeof key !== "string" ||
              outcomeByKey.get(key)?.status !== "confirmed"
          ) ||
          [...outcomeByKey.values()].some(
            (outcome) =>
              (outcome.status === "confirmed") !==
              restoredDedupKeys.has(outcome.targetKey)
          ) ||
          (rawUnknown !== undefined &&
            (unknownValues.some(
              (key) =>
                typeof key !== "string" ||
                outcomeByKey.get(key)?.status !== "unknown"
            ) ||
              [...outcomeByKey.values()].some(
                (outcome) =>
                  (outcome.status === "unknown") !==
                  unknownDedupKeys.has(outcome.targetKey)
              ))) ||
          [...notDispatchedDedupKeys].some(
            (key) => outcomeByKey.get(key)?.status !== "failed"
          ))
      ) {
        malformed = true
      }
      if (
        params.outcome === "complete" &&
        (restoredDedupKeys.size !== requestKeys.length ||
          unknownDedupKeys.size > 0 ||
          notDispatchedDedupKeys.size > 0 ||
          [...outcomeByKey.values()].some(
            (outcome) => outcome.status !== "confirmed"
          ))
      ) {
        malformed = true
      }
      // Ignore malformed replies for a still-live provisional request. They
      // cannot seal it or replace its persisted timeout evidence.
      if (sameAttempt && malformed) return record
      const sameAttemptOutcomeByKey = new Map(
        sameAttempt?.outcomes.map((entry) => [entry.targetKey, entry]) ?? []
      )
      const attemptPriorByKey = new Map(
        sameAttempt?.outcomes.map((entry) => [entry.targetKey, entry]) ?? []
      )
      const currentOutcomes = requestKeys.map((key) => {
        const supplied = outcomeByKey.get(key)
        const priorAttemptOutcome = attemptPriorByKey.get(key)
        let status: MutationOutcome["status"] = malformed
          ? sameAttemptOutcomeByKey.get(key)?.status ?? "unknown"
          : supplied?.status ??
            (restoredDedupKeys.has(key)
              ? "confirmed"
              : unknownDedupKeys.has(key)
                ? "unknown"
                : "unknown")
        if (!malformed && sameAttempt && !terminal) {
          const priorAttemptStatus = priorAttemptOutcome?.status
          const priorWasDurableIntent =
            priorAttemptStatus === "unknown" &&
            priorAttemptOutcome?.reason === "durable-pre-dispatch-intent"
          if (priorWasDurableIntent) {
            // The pre-dispatch marker is deliberately conservative. Once the
            // same request produces live progress, exact target outcomes may
            // replace that marker without waiting for the terminal response.
          } else if (priorAttemptStatus === "unknown" || status === "unknown") {
            status = "unknown"
          } else if (
            priorAttemptStatus === "confirmed" ||
            status === "confirmed"
          ) {
            status = "confirmed"
          } else {
            status = "failed"
          }
        } else if (
          !malformed &&
          sameAttempt &&
          terminal &&
          attemptPriorByKey.get(key)?.status === "confirmed"
        ) {
          // Exact terminal evidence may resolve provisional unknowns, but it
          // cannot undo a confirmation already received for this request.
          status = "confirmed"
        }
        return {
          operation: "restore" as const,
          targetKey: key,
          status,
          ...(status === "failed" && notDispatchedDedupKeys.has(key)
            ? { reason: "not-dispatched" }
            : status === supplied?.status &&
                typeof supplied?.reason === "string"
              ? { reason: supplied.reason.slice(0, 300) }
              : {})
        }
      })
      const priorOutcomes = new Map(
        sanitizeRestoreOutcomes(record.restoreOutcomes).map((entry) => [
          entry.targetKey,
          entry
        ])
      )
      for (const current of currentOutcomes) {
        const prior = priorOutcomes.get(current.targetKey)
        const priorAttempt = attemptPriorByKey.get(current.targetKey)
        const sameLiveAttemptCanResolve =
          sameAttempt?.terminal === false &&
          (terminal ||
            priorAttempt?.reason === "durable-pre-dispatch-intent")
        const status = malformed
          ? prior?.status ?? current.status
          : prior?.status === "confirmed"
            ? "confirmed"
            : sameLiveAttemptCanResolve
            ? current.status
            : prior?.status === "unknown" || current.status === "unknown"
              ? "unknown"
              : current.status === "confirmed"
                ? "confirmed"
                : "failed"
        priorOutcomes.set(current.targetKey, { ...current, status })
      }
      const cumulativeOutcomes = [...priorOutcomes.values()]
      const cumulativeUnknown = cumulativeOutcomes
        .filter((entry) => entry.status === "unknown")
        .map((entry) => entry.targetKey)
      const cumulativeNotDispatched = uniqueStrings([
        ...(record.restoreEverNotDispatchedDedupKeys ?? []),
        ...notDispatchedDedupKeys
      ])
      const attemptNotDispatched = malformed
        ? []
        : [...notDispatchedDedupKeys]
      const targetMediaKeys = requestKeys.map((key) =>
        mediaKeyByDedupKey.get(key)
      )
      const attemptAssetRefs = requestKeys.map((key) =>
        assetRefByDedupKey.get(key)
      )
      const attempt: RecoveryRestoreAttempt = {
        at: iso,
        outcomes: currentOutcomes,
        notDispatchedDedupKeys: attemptNotDispatched,
        ...(params.requestId && !malformed
          ? { requestId: params.requestId }
          : {}),
        ...(params.requestId && !malformed ? { terminal } : {}),
        ...(targetMediaKeys.every(
          (mediaKey): mediaKey is string => typeof mediaKey === "string"
        )
          ? { targetMediaKeys }
          : {}),
        ...(attemptAssetRefs.every(
          (assetRef): assetRef is RecoveryAssetRef => assetRef !== undefined
        )
          ? { icloudAssetRefs: attemptAssetRefs }
          : {})
      }
      const restoreOutcomeHistory = [...history]
      if (sameAttemptIndex >= 0) {
        restoreOutcomeHistory[sameAttemptIndex] = attempt
      } else {
        restoreOutcomeHistory.push(attempt)
        restoreOutcomeHistory.splice(
          0,
          Math.max(0, restoreOutcomeHistory.length - MAX_RESTORE_ATTEMPTS)
        )
      }
      const currentOutcomeByKey = new Map(
        currentOutcomes.map((entry) => [entry.targetKey, entry])
      )
      const candidateKeys = sameAttempt
        ? uniqueStrings([...requestKeys, ...record.restorableDedupKeys])
        : [...record.restorableDedupKeys]
      const remainingDedupKeys = candidateKeys.filter((key) => {
        const current = currentOutcomeByKey.get(key)
        return current ? current.status === "failed" : true
      })
      const remainingMediaKeys = remainingDedupKeys.flatMap((key) => {
        const mediaKey = mediaKeyByDedupKey.get(key)
        return mediaKey ? [mediaKey] : []
      })
      const hasAlignedRemainingAssetRefs = remainingDedupKeys.every((key) =>
        assetRefByDedupKey.has(key)
      )
      const remainingAssetRefs = hasAlignedRemainingAssetRefs
        ? remainingDedupKeys.map((key) => assetRefByDedupKey.get(key)!)
        : undefined
      const hasUnknown = cumulativeUnknown.length > 0
      const complete =
        params.outcome === "complete" &&
        remainingDedupKeys.length === 0 &&
        !hasUnknown
      const status: RecoveryHistoryStatus = hasUnknown
        ? "restore_unknown"
        : complete
        ? "restored"
        : restoredDedupKeys.size > 0
          ? "restore_partial"
          : "restore_failed"
      return {
        ...record,
        updatedAt: iso,
        ...(complete ? { restoredAt: iso } : { restoredAt: undefined }),
        status,
        restoreUnknownCount: cumulativeUnknown.length,
        restoreOutcomes: cumulativeOutcomes,
        restoreOutcomeHistory,
        ...(cumulativeNotDispatched.length > 0
          ? { restoreEverNotDispatchedDedupKeys: cumulativeNotDispatched }
          : {}),
        restorableDedupKeys: remainingDedupKeys,
        restorableMediaKeys: remainingMediaKeys,
        icloudAssetRefs: remainingAssetRefs,
        restoreAttempts: record.restoreAttempts + (sameAttempt ? 0 : 1),
        ...(complete
          ? { lastError: undefined }
          : {
              lastError: (params.error || "Restore did not complete.").slice(
                0,
                500
              )
            })
      }
    }),
    Date.parse(iso)
  )
}

export function isRecoveryRestorable(record: RecoveryHistoryRecord): boolean {
  return (
    record.restorableDedupKeys.length > 0 &&
    record.status !== "restored" &&
    record.status !== "pending"
  )
}
