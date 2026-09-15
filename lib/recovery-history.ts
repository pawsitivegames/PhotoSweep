import type { DeleteReport } from "./delete-report"
import { accountFingerprint } from "./review-preflight"
import type { TrashResultReport } from "./trash-result-report"
import type { GpdMediaItem, PhotoProvider } from "./types"

export const RECOVERY_HISTORY_STORAGE_KEY = "recoveryHistory"
export const RECOVERY_HISTORY_VERSION = 1 as const
export const MAX_RECOVERY_HISTORY_RECORDS = 20
export const RECOVERY_HISTORY_TTL_MS = 180 * 24 * 60 * 60 * 1000

export type RecoveryHistoryStatus =
  | "pending"
  | "complete"
  | "partial"
  | "failed"
  | "restored"
  | "restore_failed"

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
  scopeLabel?: string
  scopeFingerprint?: string
  attemptedCount: number
  movedCount: number
  failedCount: number
  status: RecoveryHistoryStatus
  restorableDedupKeys: string[]
  restorableMediaKeys: string[]
  icloudAssetRefs?: RecoveryAssetRef[]
  restoreAttempts: number
  restoredAt?: string
  lastError?: string
}

export interface RecoveryHistoryContext {
  operationId: string
  provider: PhotoProvider
  accountEmail?: string
  scopeLabel?: string
  scopeFingerprint?: string
  attemptedDedupKeys: string[]
  attemptedMediaKeys: string[]
  icloudAssetRefs?: RecoveryAssetRef[]
}

function validProvider(value: unknown): value is PhotoProvider {
  return value === "google" || value === "icloud" || value === "amazon"
}

function uniqueStrings(value: unknown, max = 1000): string[] {
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
    value === "restored" ||
    value === "restore_failed"
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
  return refs.length > 0 ? refs.slice(0, 1000) : undefined
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
    if (Number.isFinite(updatedAt) && now - updatedAt > RECOVERY_HISTORY_TTL_MS)
      continue
    records.push({
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
      ...(typeof raw.scopeLabel === "string"
        ? { scopeLabel: raw.scopeLabel }
        : {}),
      ...(typeof raw.scopeFingerprint === "string"
        ? { scopeFingerprint: raw.scopeFingerprint }
        : {}),
      attemptedCount: Math.max(0, Math.floor(raw.attemptedCount)),
      movedCount: Math.max(0, Math.floor(raw.movedCount)),
      failedCount: Math.max(0, Math.floor(raw.failedCount)),
      status: raw.status,
      restorableDedupKeys: uniqueStrings(raw.restorableDedupKeys),
      restorableMediaKeys: uniqueStrings(raw.restorableMediaKeys),
      ...(sanitizeAssetRefs(raw.icloudAssetRefs)
        ? { icloudAssetRefs: sanitizeAssetRefs(raw.icloudAssetRefs) }
        : {}),
      restoreAttempts: Math.max(0, Math.floor(raw.restoreAttempts)),
      ...(typeof raw.restoredAt === "string"
        ? { restoredAt: raw.restoredAt }
        : {}),
      ...(typeof raw.lastError === "string"
        ? { lastError: raw.lastError.slice(0, 500) }
        : {})
    })
  }
  const byId = new Map<string, RecoveryHistoryRecord>()
  for (const record of records) byId.set(record.operationId, record)
  return [...byId.values()]
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    )
    .slice(0, MAX_RECOVERY_HISTORY_RECORDS)
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
    ...(context.scopeLabel ? { scopeLabel: context.scopeLabel } : {}),
    ...(context.scopeFingerprint
      ? { scopeFingerprint: context.scopeFingerprint }
      : {}),
    attemptedCount: context.attemptedDedupKeys.length,
    movedCount: 0,
    failedCount: context.attemptedDedupKeys.length,
    status: "pending",
    restorableDedupKeys: [],
    restorableMediaKeys: [],
    ...(context.icloudAssetRefs
      ? { icloudAssetRefs: context.icloudAssetRefs }
      : {}),
    restoreAttempts: 0
  }
}

function filterAssetRefs(
  refs: RecoveryAssetRef[] | undefined,
  dedupKeys: string[]
): RecoveryAssetRef[] | undefined {
  if (!refs) return undefined
  const allowed = new Set(dedupKeys)
  const filtered = refs.filter((ref) => allowed.has(ref.recordName))
  return filtered.length > 0 ? filtered : undefined
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
    status: report.status,
    restorableDedupKeys: report.movedDedupKeys,
    restorableMediaKeys: report.movedMediaKeys,
    ...(filterAssetRefs(context.icloudAssetRefs, report.movedDedupKeys)
      ? {
          icloudAssetRefs: filterAssetRefs(
            context.icloudAssetRefs,
            report.movedDedupKeys
          )
        }
      : {}),
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
  params: { success: boolean; error?: string; restoredDedupKeys?: string[] },
  now = new Date()
): RecoveryHistoryRecord[] {
  const iso = now.toISOString()
  return sanitizeRecoveryHistory(
    records.map((record) => {
      if (record.operationId !== operationId) return record
      if (params.success) {
        return {
          ...record,
          updatedAt: iso,
          restoredAt: iso,
          status: "restored",
          restorableDedupKeys: [],
          restorableMediaKeys: [],
          icloudAssetRefs: undefined,
          restoreAttempts: record.restoreAttempts + 1,
          lastError: undefined
        }
      }
      return {
        ...record,
        updatedAt: iso,
        status: "restore_failed",
        restoreAttempts: record.restoreAttempts + 1,
        ...(params.error ? { lastError: params.error.slice(0, 500) } : {})
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
