import { AsyncSerialQueue } from "../lib/async-serial-queue"
import { accountFingerprint } from "../lib/review-preflight"
import {
  RECOVERY_HISTORY_STORAGE_KEY,
  createPendingRecoveryRecord,
  hasUnresolvedRecoverySafetyState,
  isRecoveryRestorable,
  markRecoveryRestore,
  sanitizeRecoveryHistory,
  updateRecoveryRecordFromTrash,
  type RecoveryHistoryContext,
  type RecoveryHistoryRecord,
  type RecoveryRestoreAttempt
} from "../lib/recovery-history"
import type { DeleteReport } from "../lib/delete-report"
import type { TrashResultReport } from "../lib/trash-result-report"
import type {
  PhotoProvider,
  RecoveryHistoryTransaction,
  RecoveryHistoryTransactionMessage,
  RecoveryHistoryTransactionResponse
} from "../lib/types"

const recoveryHistoryQueue = new AsyncSerialQueue()

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function validString(value: unknown, maxLength = 512): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function validProvider(value: unknown): value is PhotoProvider {
  return value === "google" || value === "icloud" || value === "amazon"
}

export function isTrustedRecoveryHistorySender(
  sender: chrome.runtime.MessageSender
): boolean {
  if (
    sender.id !== chrome.runtime.id ||
    (sender.frameId !== undefined && sender.frameId !== 0) ||
    typeof sender.url !== "string"
  ) {
    return false
  }
  try {
    const parsed = new URL(sender.url)
    return (
      parsed.protocol === "chrome-extension:" &&
      parsed.host === chrome.runtime.id &&
      (parsed.pathname === "/tabs/app.html" ||
        parsed.pathname === "/tabs/scanner-panel.html")
    )
  } catch {
    return false
  }
}

async function readRecoveryHistory(): Promise<RecoveryHistoryRecord[]> {
  const stored = await chrome.storage.local.get(RECOVERY_HISTORY_STORAGE_KEY)
  return sanitizeRecoveryHistory(stored[RECOVERY_HISTORY_STORAGE_KEY])
}

async function writeAndVerifyRecoveryHistory(
  records: RecoveryHistoryRecord[]
): Promise<RecoveryHistoryRecord[]> {
  const expected = sanitizeRecoveryHistory(records)
  await chrome.storage.local.set({
    [RECOVERY_HISTORY_STORAGE_KEY]: expected
  })
  const readback = await readRecoveryHistory()
  if (JSON.stringify(readback) !== JSON.stringify(expected)) {
    throw new Error("Recovery history readback did not match the saved transaction.")
  }
  return readback
}

function validRecoveryContext(value: unknown): value is RecoveryHistoryContext {
  if (!isRecord(value)) return false
  const dedupKeys = value.attemptedDedupKeys
  const mediaKeys = value.attemptedMediaKeys
  return (
    validString(value.operationId, 200) &&
    validProvider(value.provider) &&
    validString(value.providerSessionId, 200) &&
    Array.isArray(dedupKeys) &&
    dedupKeys.length > 0 &&
    dedupKeys.every((key) => validString(key, 1024)) &&
    new Set(dedupKeys).size === dedupKeys.length &&
    Array.isArray(mediaKeys) &&
    mediaKeys.length === dedupKeys.length &&
    mediaKeys.every((key) => validString(key, 1024)) &&
    (value.provider !== "google" ||
      (validString(value.accountEmail, 320) &&
        Boolean(accountFingerprint(value.accountEmail))))
  )
}

function identityMatches(
  record: RecoveryHistoryRecord,
  binding: {
    provider: PhotoProvider
    providerSessionId?: string
    accountEmail?: string
  }
): boolean {
  if (
    record.provider !== binding.provider ||
    !validString(binding.providerSessionId, 200)
  ) {
    return false
  }
  if (record.accountFingerprint) {
    const fingerprint = accountFingerprint(binding.accountEmail)
    return Boolean(fingerprint && record.accountFingerprint === fingerprint)
  }
  // Google recovery records without a verified account identity are not
  // eligible for recovery. Other providers retain the strict page-session
  // binding when no stable account fingerprint was available at cleanup time.
  return (
    binding.provider !== "google" &&
    Boolean(record.providerSessionId) &&
    record.providerSessionId === binding.providerSessionId
  )
}

function sameIdentityScope(
  left: RecoveryHistoryRecord,
  right: RecoveryHistoryRecord
): boolean {
  if (left.provider !== right.provider) return false
  if (
    left.accountFingerprint &&
    right.accountFingerprint
  ) {
    return left.accountFingerprint === right.accountFingerprint
  }
  return Boolean(
    left.providerSessionId &&
      right.providerSessionId &&
      left.providerSessionId === right.providerSessionId
  )
}

function hasActiveIntent(record: RecoveryHistoryRecord): boolean {
  return Boolean(
    record.restoreOutcomeHistory?.some((attempt) => attempt.terminal === false)
  )
}

function hasActiveTargetOverlap(
  records: RecoveryHistoryRecord[],
  selected: RecoveryHistoryRecord,
  targets: string[]
): boolean {
  const targetSet = new Set(targets)
  return records.some(
    (record) =>
      sameIdentityScope(record, selected) &&
      record.restoreOutcomeHistory?.some(
        (attempt) =>
          attempt.terminal === false &&
          attempt.outcomes.some((outcome) => targetSet.has(outcome.targetKey))
      ) === true
  )
}

function attemptForRequest(
  records: RecoveryHistoryRecord[],
  operationId: string,
  requestId: string
): { record: RecoveryHistoryRecord; attempt: RecoveryRestoreAttempt } | null {
  const record = records.find((entry) => entry.operationId === operationId)
  const matches =
    record?.restoreOutcomeHistory?.filter(
      (attempt) => attempt.requestId === requestId
    ) ?? []
  return matches.length === 1 ? { record: record!, attempt: matches[0]! } : null
}

function sameOutcomeVector(
  stored: RecoveryRestoreAttempt["outcomes"],
  incoming: unknown
): boolean {
  if (!Array.isArray(incoming) || incoming.length !== stored.length) return false
  const priorByKey = new Map(stored.map((outcome) => [outcome.targetKey, outcome]))
  const seen = new Set<string>()
  return incoming.every((candidate) => {
    if (!isRecord(candidate)) return false
    if (
      candidate.operation !== "restore" ||
      !validString(candidate.targetKey, 1024) ||
      seen.has(candidate.targetKey)
    ) {
      return false
    }
    const prior = priorByKey.get(candidate.targetKey)
    if (!prior || candidate.status !== prior.status) return false
    seen.add(candidate.targetKey)
    return true
  }) && seen.size === priorByKey.size
}

function validateRestoreUpdate(
  params: unknown,
  requestId: string,
  targetKeys: string[]
): params is Parameters<typeof markRecoveryRestore>[2] {
  if (
    !isRecord(params) ||
    params.requestId !== requestId ||
    typeof params.terminal !== "boolean" ||
    (params.outcome !== "complete" &&
      params.outcome !== "partial" &&
      params.outcome !== "failed" &&
      params.outcome !== "unknown") ||
    !Array.isArray(params.outcomes) ||
    params.outcomes.length !== targetKeys.length ||
    !Array.isArray(params.restoredDedupKeys) ||
    (params.unknownDedupKeys !== undefined &&
      !Array.isArray(params.unknownDedupKeys)) ||
    (params.notDispatchedDedupKeys !== undefined &&
      !Array.isArray(params.notDispatchedDedupKeys))
  ) {
    return false
  }
  const restoredKeys = params.restoredDedupKeys as unknown[]
  const unknownKeys = (params.unknownDedupKeys ?? []) as unknown[]
  const notDispatchedKeys =
    (params.notDispatchedDedupKeys ?? []) as unknown[]
  const requested = new Set(targetKeys)
  const seen = new Set<string>()
  const statuses = new Map<string, string>()
  for (const candidate of params.outcomes) {
    if (
      !isRecord(candidate) ||
      candidate.operation !== "restore" ||
      !validString(candidate.targetKey, 1024) ||
      !requested.has(candidate.targetKey) ||
      seen.has(candidate.targetKey) ||
      (candidate.status !== "confirmed" &&
        candidate.status !== "failed" &&
        candidate.status !== "unknown")
    ) {
      return false
    }
    seen.add(candidate.targetKey)
    statuses.set(candidate.targetKey, candidate.status)
  }
  if (
    seen.size !== requested.size ||
    restoredKeys.length !==
      restoredKeys.filter(
        (key) => typeof key === "string" && requested.has(key)
      ).length ||
    new Set(restoredKeys).size !== restoredKeys.length ||
    restoredKeys.some(
      (key) => statuses.get(typeof key === "string" ? key : "") !== "confirmed"
    )
  ) {
    return false
  }
  if (
    unknownKeys.length !==
      unknownKeys.filter(
        (key) => typeof key === "string" && requested.has(key)
      ).length ||
    new Set(unknownKeys).size !== unknownKeys.length ||
    unknownKeys.some(
      (key) => statuses.get(typeof key === "string" ? key : "") !== "unknown"
    )
  ) {
    return false
  }
  return (
    notDispatchedKeys.length ===
      notDispatchedKeys.filter(
        (key) => typeof key === "string" && requested.has(key)
      ).length &&
    new Set(notDispatchedKeys).size === notDispatchedKeys.length &&
    notDispatchedKeys.every(
      (key) => statuses.get(typeof key === "string" ? key : "") === "failed"
    )
  )
}

function echoTransaction(
  transaction: RecoveryHistoryTransaction
): Pick<
  RecoveryHistoryTransactionResponse,
  "operationId" | "requestId" | "targetDedupKeys"
> {
  if (transaction.kind === "beginRestore") {
    return {
      operationId: transaction.operationId,
      requestId: transaction.requestId,
      targetDedupKeys: Array.isArray(transaction.targetDedupKeys)
        ? [...transaction.targetDedupKeys]
        : []
    }
  }
  if (transaction.kind === "updateRestore") {
    return {
      operationId: transaction.operationId,
      requestId: transaction.requestId
    }
  }
  return {}
}

async function executeTransaction(
  transaction: RecoveryHistoryTransaction
): Promise<RecoveryHistoryRecord[]> {
  return recoveryHistoryQueue.run(async () => {
    const records = await readRecoveryHistory()
    switch (transaction.kind) {
      case "read":
        return records
      case "clear": {
        const retained = records.filter(hasUnresolvedRecoverySafetyState)
        if (retained.length > 0) {
          return writeAndVerifyRecoveryHistory(retained)
        }
        await chrome.storage.local.remove(RECOVERY_HISTORY_STORAGE_KEY)
        const readback = await readRecoveryHistory()
        if (readback.length > 0) {
          throw new Error("Recovery history clear could not be verified.")
        }
        return readback
      }
      case "createPendingTrash": {
        const context = transaction.context
        if (
          !isRecord(transaction.report) ||
          !validString(transaction.report.reportId, 200) ||
          !validString(transaction.report.createdAt, 100) ||
          !Array.isArray(transaction.report.items) ||
          !validRecoveryContext(context)
        ) {
          throw new Error("Pending trash transaction is malformed.")
        }
        if (
          records.some(
            (record) => record.operationId === context.operationId
          )
        ) {
          throw new Error("This trash operation already has a recovery record.")
        }
        return writeAndVerifyRecoveryHistory([
          createPendingRecoveryRecord(
            transaction.report as unknown as DeleteReport,
            context,
            new Date()
          ),
          ...records
        ])
      }
      case "recordTrashResult": {
        const context = transaction.context
        if (
          !isRecord(transaction.report) ||
          !validString(transaction.report.reportId, 200) ||
          !validRecoveryContext(context)
        ) {
          throw new Error("Trash result transaction is malformed.")
        }
        const prior = records.find(
          (record) => record.operationId === context.operationId
        )
        if (
          !prior ||
          !identityMatches(prior, context) ||
          hasActiveIntent(prior)
        ) {
          throw new Error("Trash result does not match a writable recovery record.")
        }
        return writeAndVerifyRecoveryHistory(
          updateRecoveryRecordFromTrash(
            records,
            transaction.report as unknown as TrashResultReport,
            context,
            new Date()
          )
        )
      }
      case "beginRestore": {
        const targets = transaction.targetDedupKeys
        if (
          !validString(transaction.operationId, 200) ||
          !validString(transaction.requestId, 200) ||
          !validProvider(transaction.provider) ||
          !validString(transaction.providerSessionId, 200) ||
          !Array.isArray(targets) ||
          targets.length === 0 ||
          targets.some((key) => !validString(key, 1024)) ||
          new Set(targets).size !== targets.length ||
          (transaction.provider === "google" &&
            !validString(transaction.accountEmail, 320))
        ) {
          throw new Error("Restore intent transaction is malformed.")
        }
        const prior = records.find(
          (record) => record.operationId === transaction.operationId
        )
        if (
          !prior ||
          !identityMatches(prior, transaction) ||
          !isRecoveryRestorable(prior) ||
          hasActiveIntent(prior) ||
          targets.some((key) => !prior.restorableDedupKeys.includes(key)) ||
          hasActiveTargetOverlap(records, prior, targets) ||
          records.some((record) =>
            record.restoreOutcomeHistory?.some(
              (attempt) => attempt.requestId === transaction.requestId
            )
          )
        ) {
          throw new Error(
            "Restore targets are stale, reserved, or bound to another provider session."
          )
        }
        const next = markRecoveryRestore(records, transaction.operationId, {
          outcome: "unknown",
          requestId: transaction.requestId,
          terminal: false,
          targetDedupKeys: targets,
          restoredDedupKeys: [],
          unknownDedupKeys: targets,
          outcomes: targets.map((targetKey) => ({
            operation: "restore" as const,
            targetKey,
            status: "unknown" as const,
            reason: "durable-pre-dispatch-intent"
          })),
          error: "A restore intent was durably recorded before provider dispatch."
        })
        const readback = await writeAndVerifyRecoveryHistory(next)
        const accepted = attemptForRequest(
          readback,
          transaction.operationId,
          transaction.requestId
        )
        const targetSet = new Set(targets)
        if (
          !accepted ||
          accepted.attempt.terminal !== false ||
          accepted.attempt.outcomes.length !== targetSet.size ||
          accepted.attempt.outcomes.some(
            (outcome) =>
              !targetSet.has(outcome.targetKey) || outcome.status !== "unknown"
          ) ||
          targets.some(
            (key) =>
              accepted.record.restorableDedupKeys.includes(key) ||
              accepted.record.restoreOutcomes?.find(
                (outcome) => outcome.targetKey === key
              )?.status !== "unknown"
          )
        ) {
          throw new Error(
            "Restore intent readback did not verify the exact target guard."
          )
        }
        return readback
      }
      case "updateRestore": {
        if (
          !validString(transaction.operationId, 200) ||
          !validString(transaction.requestId, 200) ||
          !validProvider(transaction.provider) ||
          !validString(transaction.providerSessionId, 200) ||
          (transaction.provider === "google" &&
            !validString(transaction.accountEmail, 320))
        ) {
          throw new Error("Restore update transaction is malformed.")
        }
        const prior = attemptForRequest(
          records,
          transaction.operationId,
          transaction.requestId
        )
        if (!prior || !identityMatches(prior.record, transaction)) {
          throw new Error(
            "Restore update is stale or does not match its persisted intent."
          )
        }
        if (prior.attempt.terminal === true) {
          if (
            isRecord(transaction.params) &&
            transaction.params.terminal === true &&
            sameOutcomeVector(
              prior.attempt.outcomes,
              transaction.params.outcomes
            )
          ) {
            return records
          }
          throw new Error("A terminal restore attempt cannot be replaced.")
        }
        const targetKeys = prior.attempt.outcomes.map(
          (outcome) => outcome.targetKey
        )
        if (
          !validateRestoreUpdate(
            transaction.params,
            transaction.requestId,
            targetKeys
          )
        ) {
          throw new Error(
            "Restore update must cover its exact persisted target set."
          )
        }
        const readback = await writeAndVerifyRecoveryHistory(
          markRecoveryRestore(
            records,
            transaction.operationId,
            transaction.params
          )
        )
        const updated = attemptForRequest(
          readback,
          transaction.operationId,
          transaction.requestId
        )
        if (
          !updated ||
          updated.attempt.terminal !== transaction.params.terminal ||
          updated.attempt.outcomes.length !== targetKeys.length ||
          updated.attempt.outcomes.some(
            (outcome) => !targetKeys.includes(outcome.targetKey)
          )
        ) {
          throw new Error("Restore update readback did not verify the exact attempt.")
        }
        return readback
      }
      default:
        throw new Error("Recovery history transaction kind is unsupported.")
    }
  })
}

export async function handleRecoveryHistoryTransaction(
  message: RecoveryHistoryTransactionMessage,
  sender: chrome.runtime.MessageSender
): Promise<RecoveryHistoryTransactionResponse> {
  const transactionId = message?.transactionId
  const transaction = message?.transaction
  const echo = transaction ? echoTransaction(transaction) : {}
  if (
    !isTrustedRecoveryHistorySender(sender) ||
    !validString(transactionId, 200) ||
    !transaction ||
    ![
      "read",
      "clear",
      "createPendingTrash",
      "recordTrashResult",
      "beginRestore",
      "updateRestore"
    ].includes(transaction.kind)
  ) {
    return {
      action: "recoveryHistory.transaction.result",
      transactionId: typeof transactionId === "string" ? transactionId : "",
      success: false,
      ...echo,
      error: "Recovery history transaction sender or request is invalid."
    }
  }
  try {
    return {
      action: "recoveryHistory.transaction.result",
      transactionId,
      success: true,
      ...echo,
      records: await executeTransaction(transaction)
    }
  } catch (error) {
    return {
      action: "recoveryHistory.transaction.result",
      transactionId,
      success: false,
      ...echo,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
