import type { ProviderOperationRequest } from "./provider-operation-contract"
import type {
  RecoveryHistoryRecord,
  RecoveryRestoreStatusUpdate
} from "./recovery-history"
import type {
  AuthorizedTrashLifecycleBeginParams,
  RestoreOutcome,
  TrashCommand,
  TrashLifecycle,
  TrashOutcome,
  TrashProviderResultData,
  TrashUndoData
} from "./trash-lifecycle"
import {
  APP_ID,
  type GptkProgressMessage,
  type GptkResultMessage,
  type PhotoProvider,
  type RecoveryHistoryTransaction
} from "./types"

export interface MutationExecutionContext {
  generation: number
  provider: PhotoProvider
  identityProvider?: PhotoProvider
  accountEmail?: string
  providerSessionId?: string
  validated: boolean
}

export type TrashExecutionErrorStage =
  | "trash-result"
  | "trash-timeout"
  | "restore-intent"
  | "restore-unsent"
  | "restore-terminal"
  | "restore-timeout"
  | "restore-progress"

export type TrashExecutionEvent =
  | {
      kind: "trash-result"
      outcome: TrashOutcome
      provider: PhotoProvider
      generation: number
      timedOut: boolean
    }
  | { kind: "restore-started"; undo: TrashUndoData; history: boolean }
  | {
      kind: "restore-result"
      outcome: RestoreOutcome
      records: RecoveryHistoryRecord[]
      history: boolean
      provider: PhotoProvider
      operationId: string
    }
  | { kind: "restore-timeout"; outcome: RestoreOutcome }
  | { kind: "restore-busy"; operationId: string | null }
  | { kind: "restore-not-sent" }
  | { kind: "recovery"; records: RecoveryHistoryRecord[] }
  | { kind: "error"; stage: TrashExecutionErrorStage; message: string }

export interface TrashExecutionAdapter {
  context(): MutationExecutionContext
  sendCommand(
    message: ProviderOperationRequest<"trashItems" | "restoreItems">
  ): Promise<unknown> | void
  recovery(
    transaction: RecoveryHistoryTransaction
  ): Promise<RecoveryHistoryRecord[]>
  onEvent(event: TrashExecutionEvent): void
  timeoutMs?: number
}

interface TrashRun {
  requestId: string
  provider: PhotoProvider
  generation: number
  providerSessionId?: string
  timer?: ReturnType<typeof setTimeout>
  pendingTimeout?: Promise<TrashOutcome>
}

interface RestoreRun {
  requestId: string
  operationId: string
  generation: number
  undo: TrashUndoData
  provider: PhotoProvider
  providerSessionId: string
  accountEmail?: string
  history: boolean
  phase: "intent" | "dispatched" | "terminal" | "locked"
  writes: Promise<unknown>
  timer?: ReturnType<typeof setTimeout>
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function restoreStatus(
  outcome: RestoreOutcome,
  requestId: string,
  terminal: boolean
): RecoveryRestoreStatusUpdate {
  return {
    outcome: outcome.kind,
    requestId,
    terminal,
    restoredDedupKeys: outcome.restoredDedupKeys,
    outcomes: outcome.outcomes,
    notDispatchedDedupKeys: outcome.notDispatchedDedupKeys,
    ...(outcome.kind !== "complete"
      ? { unknownDedupKeys: outcome.unknownDedupKeys, error: outcome.error }
      : {})
  }
}

/** Internal execution owner; durable shared updates remain background transactions. */
export class TrashExecution {
  private readonly trash = new Map<string, TrashRun>()
  private restoring: RestoreRun | null = null

  constructor(
    private readonly lifecycle: TrashLifecycle,
    private readonly adapter: TrashExecutionAdapter
  ) {}

  get restoreBusy(): boolean {
    return this.restoring !== null
  }

  async dispatch(
    params: AuthorizedTrashLifecycleBeginParams,
    onDispatch: (command: TrashCommand) => void
  ): Promise<TrashCommand | null> {
    const generation = this.adapter.context().generation
    const command = await this.lifecycle.begin(params)
    if (!command) return null
    if (generation !== this.adapter.context().generation) {
      this.lifecycle.cancel(command.requestId)
      return null
    }
    const run: TrashRun = {
      requestId: command.requestId,
      provider: command.provider,
      providerSessionId: params.providerSessionId,
      generation
    }
    this.trash.set(command.requestId, run)
    onDispatch(command)
    run.timer = setTimeout(() => {
      void this.trashTimeout(run)
    }, this.adapter.timeoutMs ?? 120_000)
    try {
      await this.adapter.sendCommand({
        app: APP_ID,
        action: "gptkCommand",
        command: "trashItems",
        requestId: command.requestId,
        provider: command.provider,
        args: command.args
      })
    } catch {
      // A lost delivery acknowledgement does not prove that nothing was sent.
      clearTimeout(run.timer)
      await this.trashTimeout(run)
    }
    return command
  }

  private async trashTimeout(run: TrashRun): Promise<void> {
    if (this.trash.get(run.requestId) !== run || run.pendingTimeout) return
    try {
      run.pendingTimeout = this.lifecycle.timeout({ requestId: run.requestId })
      const outcome = await run.pendingTimeout
      if (
        this.trash.get(run.requestId) === run &&
        this.adapter.context().generation === run.generation
      )
        this.adapter.onEvent({
          kind: "trash-result",
          outcome,
          provider: run.provider,
          generation: run.generation,
          timedOut: true
        })
    } catch (error) {
      if (
        this.trash.get(run.requestId) === run &&
        this.adapter.context().generation === run.generation
      )
        this.error("trash-timeout", error)
    }
  }

  async restore(
    undo: TrashUndoData,
    requestId: string,
    history = false
  ): Promise<boolean> {
    if (this.restoreBusy) return false
    if (!undo.operationId || !undo.providerSessionId)
      throw new Error("Restore has no durable provider request binding.")
    const run: RestoreRun = {
      requestId,
      operationId: undo.operationId,
      undo,
      generation: this.adapter.context().generation,
      provider: undo.provider,
      providerSessionId: undo.providerSessionId,
      accountEmail: undo.accountEmail,
      history,
      phase: "intent",
      writes: Promise.resolve()
    }
    if (!this.current(run)) return false
    const command = this.lifecycle.beginRestore(undo, requestId)
    this.restoring = run
    this.adapter.onEvent({ kind: "restore-busy", operationId: run.operationId })
    try {
      const records = await this.adapter.recovery({
        kind: "beginRestore",
        operationId: run.operationId,
        requestId,
        provider: run.provider,
        providerSessionId: run.providerSessionId,
        ...(run.accountEmail ? { accountEmail: run.accountEmail } : {}),
        targetDedupKeys: command.args.dedupKeys
      })
      this.adapter.onEvent({ kind: "recovery", records })
      if (
        !hasDurableRestoreIntent(
          records,
          run.operationId,
          requestId,
          command.args.dedupKeys
        )
      ) {
        throw new Error(
          "The exact per-target restore guard could not be verified in recovery storage."
        )
      }
    } catch (error) {
      this.lifecycle.cancelRestore(requestId)
      this.release(run)
      this.error("restore-intent", error)
      return false
    }
    if (!this.current(run)) {
      this.lifecycle.cancelRestore(requestId)
      try {
        await this.write(
          run,
          notDispatchedRestoreStatus(
            requestId,
            command.args.dedupKeys,
            "provider-session-changed-before-dispatch"
          )
        )
        this.release(run)
        this.adapter.onEvent({ kind: "restore-not-sent" })
      } catch (error) {
        run.phase = "locked"
        this.error("restore-unsent", error)
      }
      return false
    }
    run.phase = "dispatched"
    this.adapter.onEvent({ kind: "restore-started", undo, history })
    run.timer = setTimeout(() => {
      void this.restoreTimeout(run)
    }, this.adapter.timeoutMs ?? 120_000)
    try {
      await this.adapter.sendCommand({
        app: APP_ID,
        action: "gptkCommand",
        command: "restoreItems",
        requestId,
        provider: command.provider,
        args: command.args
      })
    } catch {
      clearTimeout(run.timer)
      await this.restoreTimeout(run)
    }
    return true
  }

  async receiveResult(result: GptkResultMessage): Promise<void> {
    if (result.command === "trashItems") {
      const run = this.trash.get(result.requestId)
      if (
        !run ||
        (result.provider !== undefined && result.provider !== run.provider) ||
        (result.providerSessionId !== undefined &&
          run.providerSessionId !== undefined &&
          result.providerSessionId !== run.providerSessionId)
      )
        return
      clearTimeout(run.timer)
      this.trash.delete(result.requestId)
      try {
        // Finish an older provisional write before saving the terminal result.
        await run.pendingTimeout?.catch(() => undefined)
        const outcome = await this.lifecycle.reconcile({
          requestId: result.requestId,
          success: result.success,
          data: result.data as TrashProviderResultData | undefined,
          error: result.error
        })
        if (this.adapter.context().generation === run.generation)
          this.adapter.onEvent({
            kind: "trash-result",
            outcome,
            provider: run.provider,
            generation: run.generation,
            timedOut: false
          })
      } catch (error) {
        if (this.adapter.context().generation === run.generation)
          this.error("trash-result", error)
      }
      return
    }
    const run = this.restoring
    if (
      !run ||
      run.phase !== "dispatched" ||
      result.command !== "restoreItems" ||
      result.requestId !== run.requestId ||
      result.provider !== run.provider ||
      result.providerSessionId !== run.providerSessionId ||
      !this.current(run)
    )
      return
    clearTimeout(run.timer)
    const data = (result.data ?? {}) as Record<string, unknown>
    const outcome = this.lifecycle.reconcileRestore({
      requestId: result.requestId,
      success: result.success,
      restoredDedupKeys: data.restoredDedupKeys,
      outcomes: data.outcomes,
      notDispatchedDedupKeys: data.notDispatchedDedupKeys,
      error: result.error
    })
    if (!outcome) return
    run.phase = "terminal"
    try {
      const records = await this.write(
        run,
        restoreStatus(outcome, result.requestId, true)
      )
      const current = this.current(run)
      this.release(run)
      if (current)
        this.adapter.onEvent({
          kind: "restore-result",
          outcome,
          records,
          history: run.history,
          provider: run.provider,
          operationId: run.operationId
        })
    } catch (error) {
      // Keep the durable provisional intent and the local no-replay lock.
      run.phase = "locked"
      this.error("restore-terminal", error)
    }
  }

  receiveRestoreProgress(progress: GptkProgressMessage): void {
    const run = this.restoring
    if (
      !run ||
      run.phase !== "dispatched" ||
      progress.requestId !== run.requestId ||
      !this.current(run)
    )
      return
    const data = progress.data as { outcomes?: unknown } | undefined
    if (
      !this.lifecycle.recordRestoreProgress({
        requestId: progress.requestId,
        outcomes: data?.outcomes
      })
    )
      return
    const outcomes = this.lifecycle.restoreProgressSnapshot(progress.requestId)
    if (!outcomes) return
    void this.write(run, {
      outcome: "unknown",
      requestId: progress.requestId,
      terminal: false,
      restoredDedupKeys: outcomes
        .filter((outcome) => outcome.status === "confirmed")
        .map((outcome) => outcome.targetKey),
      unknownDedupKeys: outcomes
        .filter((outcome) => outcome.status === "unknown")
        .map((outcome) => outcome.targetKey),
      outcomes
    }).catch((error) => this.error("restore-progress", error))
  }

  private async restoreTimeout(run: RestoreRun): Promise<void> {
    if (
      this.restoring !== run ||
      run.phase !== "dispatched" ||
      !this.current(run)
    )
      return
    const outcome = this.lifecycle.timeoutRestore({ requestId: run.requestId })
    if (!outcome) return
    try {
      await this.write(run, restoreStatus(outcome, run.requestId, false))
      if (
        this.restoring === run &&
        run.phase === "dispatched" &&
        this.current(run)
      )
        this.adapter.onEvent({ kind: "restore-timeout", outcome })
    } catch (error) {
      this.error("restore-timeout", error)
    }
  }

  private write(
    run: RestoreRun,
    params: RecoveryRestoreStatusUpdate
  ): Promise<RecoveryHistoryRecord[]> {
    const write = async () => {
      const records = await this.adapter.recovery({
        kind: "updateRestore",
        operationId: run.operationId,
        requestId: run.requestId,
        provider: run.provider,
        providerSessionId: run.providerSessionId,
        ...(run.accountEmail ? { accountEmail: run.accountEmail } : {}),
        params
      })
      this.adapter.onEvent({ kind: "recovery", records })
      return records
    }
    const pending = run.writes.then(write, write)
    run.writes = pending.then(
      () => undefined,
      () => undefined
    )
    return pending
  }

  private current(run: RestoreRun): boolean {
    const context = this.adapter.context()
    return (
      context.generation === run.generation &&
      context.validated &&
      context.provider === run.provider &&
      context.identityProvider === run.provider &&
      context.providerSessionId === run.providerSessionId &&
      (run.provider !== "google" ||
        (Boolean(run.accountEmail?.trim()) &&
          context.accountEmail?.trim().toLowerCase() ===
            run.accountEmail?.trim().toLowerCase()))
    )
  }

  private release(run: RestoreRun): void {
    clearTimeout(run.timer)
    if (this.restoring !== run) return
    this.restoring = null
    this.adapter.onEvent({ kind: "restore-busy", operationId: null })
  }

  private error(stage: TrashExecutionErrorStage, error: unknown): void {
    this.adapter.onEvent({ kind: "error", stage, message: message(error) })
  }

  invalidateContext(preserveTrash: boolean): void {
    if (!preserveTrash) {
      for (const run of this.trash.values()) clearTimeout(run.timer)
      this.trash.clear()
    }
    const run = this.restoring
    if (run?.phase === "dispatched") this.release(run)
  }
}

function hasDurableRestoreIntent(
  records: RecoveryHistoryRecord[],
  operationId: string,
  requestId: string,
  requestedDedupKeys: string[]
): boolean {
  const record = records.find((entry) => entry.operationId === operationId)
  const matches =
    record?.restoreOutcomeHistory?.filter(
      (attempt) => attempt.requestId === requestId
    ) ?? []
  if (matches.length !== 1) return false
  const attempt = matches[0]!
  const requested = new Set(requestedDedupKeys)
  return (
    attempt.terminal === false &&
    attempt.outcomes.length === requestedDedupKeys.length &&
    attempt.outcomes.every(
      (outcome) =>
        requested.has(outcome.targetKey) && outcome.status === "unknown"
    ) &&
    new Set(attempt.outcomes.map((outcome) => outcome.targetKey)).size ===
      requested.size &&
    requestedDedupKeys.every(
      (key) => !record?.restorableDedupKeys.includes(key)
    ) &&
    requestedDedupKeys.every(
      (key) =>
        record?.restoreOutcomes?.find((outcome) => outcome.targetKey === key)
          ?.status === "unknown"
    )
  )
}

function notDispatchedRestoreStatus(
  requestId: string,
  dedupKeys: string[],
  reason: string
): RecoveryRestoreStatusUpdate {
  return {
    outcome: "failed",
    requestId,
    terminal: true,
    restoredDedupKeys: [],
    unknownDedupKeys: [],
    outcomes: dedupKeys.map((targetKey) => ({
      operation: "restore",
      targetKey,
      status: "failed",
      reason
    })),
    notDispatchedDedupKeys: [...dedupKeys],
    error: reason
  }
}
