import { afterEach, describe, expect, it, vi } from "vitest"

import { handleRecoveryHistoryTransaction } from "../../background/recovery-history-transactions"
import { DuplicateReviewSession } from "../../lib/duplicate-review-session"
import type { ProviderOperationRequest } from "../../lib/provider-operation-contract"
import {
  RECOVERY_HISTORY_STORAGE_KEY,
  type RecoveryHistoryRecord
} from "../../lib/recovery-history"
import { captureTrashDispatchAuthorization } from "../../lib/trash-dispatch-guard"
import type {
  MutationExecutionContext,
  TrashExecutionEvent
} from "../../lib/trash-execution"
import { TrashLifecycle, type TrashUndoData } from "../../lib/trash-lifecycle"
import {
  APP_ID,
  type DuplicateGroup,
  type GpdMediaItem,
  type GptkResultMessage,
  type PhotoProvider,
  type RecoveryHistoryTransaction
} from "../../lib/types"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

let active: TrashLifecycle | undefined
afterEach(() => {
  active?.reset()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function harness({
  provider = "google",
  targetKeys = ["trash"]
}: {
  provider?: PhotoProvider
  targetKeys?: string[]
} = {}) {
  const storage: Record<string, unknown> = {}
  vi.stubGlobal("chrome", {
    runtime: { id: "extension" },
    storage: {
      local: {
        get: async () => structuredClone(storage),
        set: async (values: Record<string, unknown>) => {
          Object.assign(storage, structuredClone(values))
        },
        remove: async (key: string) => {
          delete storage[key]
        }
      }
    }
  })
  let transaction = 0
  const recovery = vi.fn(
    async (
      value: RecoveryHistoryTransaction
    ): Promise<RecoveryHistoryRecord[]> => {
      const response = await handleRecoveryHistoryTransaction(
        {
          app: APP_ID,
          action: "recoveryHistory.transaction",
          transactionId: `transaction-${++transaction}`,
          transaction: value
        },
        { id: "extension", url: "chrome-extension://extension/tabs/app.html" }
      )
      if (!response.success) throw new Error(response.error)
      return response.records as RecoveryHistoryRecord[]
    }
  )
  const context: MutationExecutionContext = {
    generation: 1,
    provider,
    identityProvider: provider,
    accountEmail: provider === "google" ? "person@example.com" : undefined,
    providerSessionId: "session",
    validated: true
  }
  const events: TrashExecutionEvent[] = []
  const sendCommand = vi.fn(
    async (
      _message: ProviderOperationRequest<"trashItems" | "restoreItems">
    ) => {}
  )
  const onDispatch = vi.fn()
  const lifecycle = new TrashLifecycle(
    {
      async savePreTrashReport(report, audit) {
        if (audit)
          await recovery({ kind: "createPendingTrash", report, context: audit })
      },
      async saveTrashResultReport(report, audit) {
        if (audit)
          await recovery({ kind: "recordTrashResult", report, context: audit })
      }
    },
    {
      context: () => context,
      recovery,
      sendCommand,
      onEvent: (event) => events.push(event),
      timeoutMs: 100
    }
  )
  active = lifecycle
  const mediaItems = Object.fromEntries(
    ["keep", ...targetKeys].map((mediaKey, index) => [
      mediaKey,
      {
        mediaKey,
        dedupKey: `dedup-${mediaKey}`,
        thumb: mediaKey,
        timestamp: 1,
        creationTimestamp: index + 1,
        provider,
        favoriteStatus: "not-favorite",
        favoriteSource: "provider-metadata"
      }
    ])
  ) as Record<string, GpdMediaItem>
  const groups: DuplicateGroup[] = [
    {
      id: "group",
      mediaKeys: ["keep", ...targetKeys],
      originalMediaKey: "keep",
      similarity: 1
    }
  ]
  const reviewSession = new DuplicateReviewSession({
    groups,
    mediaItems,
    selections: {
      selectedGroupIds: new Set(["group"]),
      reviewedGroupIds: new Set(["group"]),
      keptOverrides: { group: new Set(["keep"]) }
    }
  })
  const plan = reviewSession.trashPlan(groups)
  const authorization = captureTrashDispatchAuthorization({
    generation: 1,
    plan,
    provider,
    accountEmail: context.accountEmail,
    providerSessionId: "session",
    scopeFingerprint: "scope"
  })!
  let currentAuthorization: typeof authorization | null = authorization
  const dispatch = (operationId = "operation") =>
    lifecycle.dispatch(
      {
        plan,
        reviewSession,
        groups,
        snapshot: { mediaItems, groups, totalItems: targetKeys.length + 1 },
        batchPolicy: {
          batchSize: 25,
          batchPauseMs: 1000,
          retryCount: 2,
          retryBackoffMs: 1000
        },
        requestId: "trash-request",
        operationId,
        accountEmail: context.accountEmail,
        providerSessionId: "session",
        scopeFingerprint: "scope",
        dispatchAuthorization: {
          expected: authorization,
          current: () => currentAuthorization
        }
      },
      onDispatch
    )
  const records = () =>
    storage[RECOVERY_HISTORY_STORAGE_KEY] as RecoveryHistoryRecord[]
  const trashed = (change: Partial<GptkResultMessage> = {}) =>
    lifecycle.receiveResult({
      app: APP_ID,
      action: "gptkResult",
      command: "trashItems",
      requestId: "trash-request",
      provider,
      providerSessionId: "session",
      success: true,
      data: {
        trashedKeys: targetKeys,
        trashedDedupKeys: targetKeys.map((key) => `dedup-${key}`)
      },
      ...change
    })
  const prepareUndo = async () => {
    await dispatch()
    await trashed()
    const event = events.find(
      (event) =>
        event.kind === "trash-result" && event.outcome.kind === "complete"
    )
    if (
      !event ||
      event.kind !== "trash-result" ||
      event.outcome.kind !== "complete" ||
      !event.outcome.undo
    )
      throw new Error("Missing confirmed Undo")
    return event.outcome.undo
  }
  const restored = (change: Partial<GptkResultMessage> = {}) =>
    lifecycle.receiveResult({
      app: APP_ID,
      action: "gptkResult",
      command: "restoreItems",
      requestId: "restore-request",
      provider,
      providerSessionId: "session",
      success: true,
      data: { restoredDedupKeys: targetKeys.map((key) => `dedup-${key}`) },
      ...change
    })
  return {
    lifecycle,
    context,
    events,
    sendCommand,
    onDispatch,
    recovery,
    dispatch,
    records,
    prepareUndo,
    trashed,
    restored,
    revokeAuthorization: () => {
      currentAuthorization = null
    }
  }
}

describe("Trash Lifecycle execution", () => {
  it("cancels a prepared Trash when the UI generation changes before dispatch", async () => {
    const h = harness()
    const gate = deferred()
    const actualRecovery = h.recovery.getMockImplementation()!
    h.recovery.mockImplementationOnce(async (transaction) => {
      await gate.promise
      return actualRecovery(transaction)
    })
    const dispatch = h.dispatch()
    h.context.generation += 1
    gate.resolve()
    await expect(dispatch).resolves.toBeNull()
    expect(h.sendCommand).not.toHaveBeenCalled()
    expect(h.lifecycle.cancel("trash-request")).toBe(false)
  })

  it("returns no command when dispatch authorization is revoked during preparation", async () => {
    const h = harness()
    const gate = deferred()
    const actualRecovery = h.recovery.getMockImplementation()!
    h.recovery.mockImplementationOnce(async (transaction) => {
      await gate.promise
      return actualRecovery(transaction)
    })
    const first = h.dispatch()
    h.revokeAuthorization()
    gate.resolve()
    await expect(first).resolves.toBeNull()
    expect(h.sendCommand).not.toHaveBeenCalled()
  })

  it("sends the authorized provider command and reports a Trash timeout", async () => {
    vi.useFakeTimers()
    const h = harness()
    await h.dispatch()
    expect(h.sendCommand).toHaveBeenCalledWith({
      app: APP_ID,
      action: "gptkCommand",
      command: "trashItems",
      requestId: "trash-request",
      provider: "google",
      args: expect.objectContaining({ dedupKeys: ["dedup-trash"] })
    })
    expect(h.onDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "trash-request",
        provider: "google",
        totalToTrash: 1
      })
    )
    await vi.advanceTimersByTimeAsync(100)
    expect(h.events.at(-1)).toMatchObject({
      kind: "trash-result",
      timedOut: true,
      outcome: { kind: "unknown" }
    })
    expect(h.records()[0].status).toBe("unknown")
  })

  it.each([
    ["operation", { operationId: undefined }],
    ["provider session", { providerSessionId: undefined }]
  ] as const)(
    "rejects Undo without a durable %s binding",
    async (_, change) => {
      const h = harness()
      const undo = await h.prepareUndo()
      h.sendCommand.mockClear()
      await expect(
        h.lifecycle.restoreItems({ ...undo, ...change }, "restore-request")
      ).rejects.toThrow("Restore has no durable provider request binding.")
      expect(h.sendCommand).not.toHaveBeenCalled()
      expect(h.lifecycle.restoreBusy).toBe(false)
    }
  )

  it.each([
    ["unvalidated session", { validated: false }],
    ["different provider", { provider: "icloud" }],
    ["different identity provider", { identityProvider: "icloud" }],
    ["missing identity provider", { identityProvider: undefined }],
    ["different page session", { providerSessionId: "other" }],
    ["missing page session", { providerSessionId: undefined }],
    ["different account", { accountEmail: "other@example.com" }],
    ["missing account", { accountEmail: undefined }]
  ] satisfies [string, Partial<MutationExecutionContext>][])(
    "does not start restore with a %s",
    async (_, change) => {
      const h = harness()
      const undo = await h.prepareUndo()
      const before = structuredClone(h.records())
      h.sendCommand.mockClear()
      Object.assign(h.context, change)
      await expect(
        h.lifecycle.restoreItems(undo, "restore-request")
      ).resolves.toBe(false)
      expect(h.sendCommand).not.toHaveBeenCalled()
      expect(h.lifecycle.restoreBusy).toBe(false)
      expect(h.records()).toEqual(before)
    }
  )

  it.each([undefined, "", "   "])(
    "rejects Google restore when its captured account is %j",
    async (accountEmail) => {
      const h = harness()
      const undo = await h.prepareUndo()
      h.context.accountEmail = accountEmail
      h.sendCommand.mockClear()
      const events = h.events.slice()
      await expect(
        h.lifecycle.restoreItems({ ...undo, accountEmail }, "restore-request")
      ).resolves.toBe(false)
      expect(h.sendCommand).not.toHaveBeenCalled()
      expect(h.events).toEqual(events)
    }
  )

  it.each(["google", "icloud", "amazon"] as const)(
    "restores through the bound %s session and reports history completion",
    async (provider) => {
      const h = harness({ provider })
      const undo = await h.prepareUndo()
      if (provider === "google") {
        undo.accountEmail = "PERSON@EXAMPLE.COM"
        h.context.accountEmail = " person@example.com "
      } else {
        delete undo.accountEmail
        h.context.accountEmail = undefined
      }
      h.sendCommand.mockClear()
      await expect(
        h.lifecycle.restoreItems(undo, "restore-request", true)
      ).resolves.toBe(true)
      expect(h.sendCommand).toHaveBeenCalledWith({
        app: APP_ID,
        action: "gptkCommand",
        command: "restoreItems",
        requestId: "restore-request",
        provider,
        args: {
          dedupKeys: ["dedup-trash"],
          providerSessionId: "session",
          ...(provider === "google" ? { accountEmail: undo.accountEmail } : {})
        }
      })
      expect(h.events).toContainEqual({
        kind: "restore-started",
        undo,
        history: true
      })
      await h.restored()
      expect(h.events.at(-1)).toMatchObject({
        kind: "restore-result",
        history: true,
        provider,
        operationId: "operation",
        outcome: { kind: "complete", restoredDedupKeys: ["dedup-trash"] }
      })
      expect(h.records()[0].status).toBe("restored")
    }
  )

  it("verifies and restores every target in a multi-item durable intent", async () => {
    const h = harness({ targetKeys: ["trash", "trash-2"] })
    const undo = await h.prepareUndo()
    await expect(
      h.lifecycle.restoreItems(undo, "restore-request")
    ).resolves.toBe(true)
    await h.restored()
    expect(h.records()[0].status).toBe("restored")
    expect(h.records()[0].restoreOutcomes).toMatchObject([
      { targetKey: "dedup-trash", status: "confirmed" },
      { targetKey: "dedup-trash-2", status: "confirmed" }
    ])
  })

  it.each([
    ["no operation", (records: RecoveryHistoryRecord[]) => records.splice(0)],
    [
      "another operation",
      (records: RecoveryHistoryRecord[]) => {
        records[0].operationId = "foreign"
      }
    ],
    [
      "no attempt history",
      (records: RecoveryHistoryRecord[]) => {
        delete records[0].restoreOutcomeHistory
      }
    ],
    [
      "empty attempt history",
      (records: RecoveryHistoryRecord[]) => {
        records[0].restoreOutcomeHistory = []
      }
    ],
    [
      "another request",
      (records: RecoveryHistoryRecord[]) => {
        records[0].restoreOutcomeHistory![0].requestId = "foreign"
      }
    ],
    [
      "duplicate attempt",
      (records: RecoveryHistoryRecord[]) => {
        records[0].restoreOutcomeHistory!.push(
          structuredClone(records[0].restoreOutcomeHistory![0])
        )
      }
    ],
    [
      "terminal attempt",
      (records: RecoveryHistoryRecord[]) => {
        records[0].restoreOutcomeHistory![0].terminal = true
      }
    ],
    [
      "missing target",
      (records: RecoveryHistoryRecord[]) => {
        records[0].restoreOutcomeHistory![0].outcomes.pop()
      }
    ],
    [
      "foreign target",
      (records: RecoveryHistoryRecord[]) => {
        records[0].restoreOutcomeHistory![0].outcomes[0].targetKey = "foreign"
      }
    ],
    [
      "confirmed target",
      (records: RecoveryHistoryRecord[]) => {
        records[0].restoreOutcomeHistory![0].outcomes[0].status = "confirmed"
      }
    ],
    [
      "duplicate target",
      (records: RecoveryHistoryRecord[]) => {
        records[0].restoreOutcomeHistory![0].outcomes[1] = structuredClone(
          records[0].restoreOutcomeHistory![0].outcomes[0]
        )
      }
    ],
    [
      "extra duplicate target",
      (records: RecoveryHistoryRecord[]) => {
        records[0].restoreOutcomeHistory![0].outcomes.push(
          structuredClone(records[0].restoreOutcomeHistory![0].outcomes[0])
        )
      }
    ],
    [
      "replayable target",
      (records: RecoveryHistoryRecord[]) => {
        records[0].restorableDedupKeys = ["dedup-trash"]
      }
    ],
    [
      "missing aggregate outcomes",
      (records: RecoveryHistoryRecord[]) => {
        delete records[0].restoreOutcomes
      }
    ],
    [
      "missing aggregate target",
      (records: RecoveryHistoryRecord[]) => {
        records[0].restoreOutcomes!.pop()
      }
    ],
    [
      "confirmed aggregate target",
      (records: RecoveryHistoryRecord[]) => {
        records[0].restoreOutcomes![0].status = "confirmed"
      }
    ]
  ] as const)(
    "does not dispatch restore with a durable guard containing %s",
    async (_, corrupt) => {
      const h = harness({ targetKeys: ["trash", "trash-2"] })
      const undo = await h.prepareUndo()
      const actualRecovery = h.recovery.getMockImplementation()!
      h.recovery.mockImplementationOnce(async (transaction) => {
        const records = structuredClone(await actualRecovery(transaction))
        corrupt(records)
        return records
      })
      h.sendCommand.mockClear()
      await expect(
        h.lifecycle.restoreItems(undo, "restore-request")
      ).resolves.toBe(false)
      expect(h.sendCommand).not.toHaveBeenCalled()
      expect(h.lifecycle.restoreBusy).toBe(false)
      expect(h.lifecycle.isPending("restore-request")).toBe(false)
      expect(h.events.at(-1)).toEqual({
        kind: "error",
        stage: "restore-intent",
        message:
          "The exact per-target restore guard could not be verified in recovery storage."
      })
    }
  )

  it("orders a delayed Trash timeout write before the late terminal reconciliation", async () => {
    vi.useFakeTimers()
    const h = harness()
    await h.dispatch()
    const gate = deferred()
    const actualRecovery = h.recovery.getMockImplementation()!
    h.recovery.mockImplementationOnce(async (transaction) => {
      await gate.promise
      return actualRecovery(transaction)
    })
    await vi.advanceTimersByTimeAsync(100)
    const terminal = h.lifecycle.receiveResult({
      app: APP_ID,
      action: "gptkResult",
      command: "trashItems",
      requestId: "trash-request",
      provider: "google",
      providerSessionId: "session",
      success: true,
      data: { trashedKeys: ["trash"], trashedDedupKeys: ["dedup-trash"] }
    })
    gate.resolve()
    await terminal
    expect(
      h.events.filter((event) => event.kind === "trash-result")
    ).toMatchObject([{ timedOut: false, outcome: { kind: "complete" } }])
    expect(h.records()[0].restorableDedupKeys).toEqual(["dedup-trash"])
  })

  it("saves a pending recovery record before provider Trash dispatch", async () => {
    const h = harness()
    h.sendCommand.mockImplementationOnce(async () => {
      expect(h.records()[0]).toMatchObject({
        status: "pending",
        operationId: "operation"
      })
    })
    await h.dispatch()
    expect(h.sendCommand).toHaveBeenCalledOnce()
  })

  it("saves and verifies restore intent before dispatch and rejects duplicate starts", async () => {
    const h = harness()
    const undo = await h.prepareUndo()
    const gate = deferred()
    const actualRecovery = h.recovery.getMockImplementation()!
    h.recovery.mockImplementationOnce(async (transaction) => {
      await gate.promise
      return actualRecovery(transaction)
    })
    h.sendCommand.mockClear()
    const restoring = h.lifecycle.restoreItems(undo, "restore-request")
    expect(h.lifecycle.restoreBusy).toBe(true)
    expect(h.events.at(-1)).toEqual({
      kind: "restore-busy",
      operationId: "operation"
    })
    await expect(h.lifecycle.restoreItems(undo, "duplicate")).resolves.toBe(
      false
    )
    expect(h.sendCommand).not.toHaveBeenCalled()
    gate.resolve()
    await restoring
    expect(h.records()[0].restoreOutcomes).toMatchObject([
      { targetKey: "dedup-trash", status: "unknown" }
    ])
    expect(h.records()[0].restorableDedupKeys).toEqual([])
    expect(h.sendCommand).toHaveBeenCalledOnce()
    expect(
      h.events.filter((event) => event.kind === "recovery").at(-1)
    ).toMatchObject({
      kind: "recovery",
      records: [
        {
          operationId: "operation",
          status: "restore_unknown",
          restorableDedupKeys: []
        }
      ]
    })
  })

  it("does not dispatch after context invalidation during the guard write", async () => {
    const h = harness()
    const undo = await h.prepareUndo()
    const gate = deferred()
    const actualRecovery = h.recovery.getMockImplementation()!
    h.recovery.mockImplementationOnce(async (transaction) => {
      await gate.promise
      return actualRecovery(transaction)
    })
    h.sendCommand.mockClear()
    const restoring = h.lifecycle.restoreItems(undo, "restore-request")
    h.context.generation += 1
    h.lifecycle.invalidateContext()
    gate.resolve()
    await expect(restoring).resolves.toBe(false)
    expect(h.sendCommand).not.toHaveBeenCalled()
    expect(h.lifecycle.restoreBusy).toBe(false)
    expect(h.records()[0].restoreOutcomeHistory?.at(-1)).toMatchObject({
      terminal: true,
      notDispatchedDedupKeys: ["dedup-trash"],
      outcomes: [
        {
          operation: "restore",
          targetKey: "dedup-trash",
          status: "failed",
          reason: "not-dispatched"
        }
      ]
    })
    expect(h.records()[0].lastError).toBe(
      "provider-session-changed-before-dispatch"
    )
    expect(h.events.at(-1)).toEqual({ kind: "restore-not-sent" })
  })

  it("keeps timeout targets ambiguous and reconciles the same late terminal result", async () => {
    vi.useFakeTimers()
    const h = harness()
    const undo = await h.prepareUndo()
    await h.lifecycle.restoreItems(undo, "restore-request")
    await vi.advanceTimersByTimeAsync(100)
    expect(h.lifecycle.restoreBusy).toBe(true)
    expect(h.records()[0].status).toBe("restore_unknown")
    expect(h.events.some((event) => event.kind === "restore-timeout")).toBe(
      true
    )
    await h.restored()
    expect(h.lifecycle.restoreBusy).toBe(false)
    expect(h.records()[0].status).toBe("restored")
    expect(
      h.events.some(
        (event) =>
          event.kind === "restore-result" && event.outcome.kind === "complete"
      )
    ).toBe(true)
  })

  it("keeps restore locked when its terminal recovery write fails", async () => {
    vi.useFakeTimers()
    const h = harness()
    const undo = await h.prepareUndo()
    await h.lifecycle.restoreItems(undo, "restore-request")
    h.recovery.mockRejectedValueOnce(new Error("Terminal write failed"))
    await h.restored()
    expect(vi.getTimerCount()).toBe(0)
    expect(h.lifecycle.restoreBusy).toBe(true)
    expect(h.records()[0].restoreOutcomeHistory?.at(-1)?.terminal).toBe(false)
    await expect(h.lifecycle.restoreItems(undo, "retry")).resolves.toBe(false)
    expect(h.events.at(-1)).toMatchObject({
      kind: "error",
      stage: "restore-terminal"
    })
  })

  it("reconciles a dispatched Trash into recovery history after UI context changes", async () => {
    const h = harness()
    await h.dispatch()
    h.context.generation += 1
    h.lifecycle.invalidateContext()
    await h.lifecycle.receiveResult({
      app: APP_ID,
      action: "gptkResult",
      command: "trashItems",
      requestId: "trash-request",
      provider: "google",
      providerSessionId: "session",
      success: true,
      data: { trashedKeys: ["trash"], trashedDedupKeys: ["dedup-trash"] }
    })
    expect(h.records()[0].status).toBe("complete")
    expect(h.events.some((event) => event.kind === "trash-result")).toBe(false)
  })
})

describe("Trash execution delivery and persistence failures", () => {
  it("keeps a lost Trash acknowledgement ambiguous and clears its delivery timer", async () => {
    vi.useFakeTimers()
    const h = harness()
    h.sendCommand.mockRejectedValueOnce(new Error("Acknowledgement lost"))
    await h.dispatch()
    expect(vi.getTimerCount()).toBe(0)
    expect(h.records()[0].status).toBe("unknown")
    expect(h.events.at(-1)).toMatchObject({
      kind: "trash-result",
      timedOut: true
    })
    await h.trashed()
    expect(h.records()[0].status).toBe("complete")
  })

  it("keeps a lost restore acknowledgement locked until its terminal result", async () => {
    vi.useFakeTimers()
    const h = harness()
    const undo = await h.prepareUndo()
    h.sendCommand.mockRejectedValueOnce(new Error("Acknowledgement lost"))
    await expect(
      h.lifecycle.restoreItems(undo, "restore-request")
    ).resolves.toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(h.lifecycle.restoreBusy).toBe(true)
    expect(h.records()[0]).toMatchObject({
      status: "restore_unknown",
      lastError: "The provider restore request timed out."
    })
    expect(h.events.at(-1)).toMatchObject({ kind: "restore-timeout" })
    await h.restored()
    expect(h.records()[0].status).toBe("restored")
    expect(h.lifecycle.restoreBusy).toBe(false)
  })

  it.each([false, true])(
    "reports a Trash timeout persistence error only in its original generation (changed=%s)",
    async (changed) => {
      vi.useFakeTimers()
      const h = harness()
      await h.dispatch()
      h.recovery.mockRejectedValueOnce("Timeout storage unavailable")
      if (changed) h.context.generation += 1
      await vi.advanceTimersByTimeAsync(100)
      expect(h.events.filter((event) => event.kind === "error")).toEqual(
        changed
          ? []
          : [
              {
                kind: "error",
                stage: "trash-timeout",
                message: "Timeout storage unavailable"
              }
            ]
      )
      await h.trashed()
      expect(h.records()[0].status).toBe("complete")
    }
  )

  it("suppresses a failed timeout write after its terminal Trash reply is already being reconciled", async () => {
    vi.useFakeTimers()
    const h = harness()
    await h.dispatch()
    const gate = deferred()
    h.recovery.mockImplementationOnce(async () => {
      await gate.promise
      throw new Error("Older timeout write failed")
    })
    await vi.advanceTimersByTimeAsync(100)
    const terminal = h.trashed()
    gate.resolve()
    await terminal
    expect(h.events.filter((event) => event.kind === "error")).toEqual([])
    expect(h.records()[0].status).toBe("complete")
  })

  it.each([false, true])(
    "reports a terminal Trash storage error only in its original generation (changed=%s)",
    async (changed) => {
      const h = harness()
      await h.dispatch()
      h.recovery.mockRejectedValueOnce(new Error("Result storage unavailable"))
      if (changed) h.context.generation += 1
      await h.trashed()
      expect(h.events.filter((event) => event.kind === "error")).toEqual(
        changed
          ? []
          : [
              {
                kind: "error",
                stage: "trash-result",
                message: "Result storage unavailable"
              }
            ]
      )
    }
  )

  it("releases a failed restore intent and allows a freshly guarded retry", async () => {
    const h = harness()
    const undo = await h.prepareUndo()
    h.sendCommand.mockClear()
    h.recovery.mockRejectedValueOnce(new Error("Intent storage unavailable"))
    await expect(
      h.lifecycle.restoreItems(undo, "restore-request")
    ).resolves.toBe(false)
    expect(h.sendCommand).not.toHaveBeenCalled()
    expect(h.lifecycle.isPending("restore-request")).toBe(false)
    expect(h.events.slice(-2)).toEqual([
      { kind: "restore-busy", operationId: null },
      {
        kind: "error",
        stage: "restore-intent",
        message: "Intent storage unavailable"
      }
    ])
    await expect(
      h.lifecycle.restoreItems(undo, "restore-request")
    ).resolves.toBe(true)
  })

  it("keeps restore locked if its never-sent recovery update cannot be persisted", async () => {
    const h = harness()
    const undo = await h.prepareUndo()
    const gate = deferred()
    const actualRecovery = h.recovery.getMockImplementation()!
    h.recovery
      .mockImplementationOnce(async (transaction) => {
        await gate.promise
        return actualRecovery(transaction)
      })
      .mockRejectedValueOnce(new Error("Unsent storage unavailable"))
    h.sendCommand.mockClear()
    const restoring = h.lifecycle.restoreItems(undo, "restore-request")
    h.context.generation += 1
    gate.resolve()
    await expect(restoring).resolves.toBe(false)
    expect(h.sendCommand).not.toHaveBeenCalled()
    expect(h.lifecycle.isPending("restore-request")).toBe(false)
    expect(h.lifecycle.restoreBusy).toBe(true)
    expect(h.events.at(-1)).toEqual({
      kind: "error",
      stage: "restore-unsent",
      message: "Unsent storage unavailable"
    })
    await expect(h.lifecycle.restoreItems(undo, "retry")).resolves.toBe(false)
  })

  it("persists a terminal restore without notifying a changed UI generation", async () => {
    const h = harness()
    const undo = await h.prepareUndo()
    await h.lifecycle.restoreItems(undo, "restore-request")
    const gate = deferred()
    const actualRecovery = h.recovery.getMockImplementation()!
    h.recovery.mockImplementationOnce(async (transaction) => {
      await gate.promise
      return actualRecovery(transaction)
    })
    const terminal = h.restored()
    h.context.generation += 1
    gate.resolve()
    await terminal
    expect(h.records()[0].status).toBe("restored")
    expect(h.lifecycle.restoreBusy).toBe(false)
    expect(h.events.some((event) => event.kind === "restore-result")).toBe(
      false
    )
    expect(h.events.at(-1)).toEqual({ kind: "restore-busy", operationId: null })
  })

  it("continues queued restore writes after a provisional timeout write fails", async () => {
    vi.useFakeTimers()
    const h = harness()
    const undo = await h.prepareUndo()
    await h.lifecycle.restoreItems(undo, "restore-request")
    h.recovery.mockRejectedValueOnce(new Error("Timeout storage unavailable"))
    await vi.advanceTimersByTimeAsync(100)
    expect(h.events.at(-1)).toEqual({
      kind: "error",
      stage: "restore-timeout",
      message: "Timeout storage unavailable"
    })
    expect(h.lifecycle.restoreBusy).toBe(true)
    await h.restored()
    expect(h.records()[0].status).toBe("restored")
    expect(h.lifecycle.restoreBusy).toBe(false)
  })

  it("does not publish a timeout after a terminal restore arrives during its write", async () => {
    vi.useFakeTimers()
    const h = harness()
    const undo = await h.prepareUndo()
    await h.lifecycle.restoreItems(undo, "restore-request")
    const gate = deferred()
    const actualRecovery = h.recovery.getMockImplementation()!
    h.recovery.mockImplementationOnce(async (transaction) => {
      await gate.promise
      return actualRecovery(transaction)
    })
    await vi.advanceTimersByTimeAsync(100)
    const terminal = h.restored()
    gate.resolve()
    await terminal
    expect(h.events.some((event) => event.kind === "restore-timeout")).toBe(
      false
    )
    expect(h.records()[0].status).toBe("restored")
  })

  it.each(["before timeout", "during timeout write"])(
    "suppresses timeout notification when context changes %s",
    async (when) => {
      vi.useFakeTimers()
      const h = harness()
      const undo = await h.prepareUndo()
      await h.lifecycle.restoreItems(undo, "restore-request")
      const before = structuredClone(h.records())
      const gate = deferred()
      const actualRecovery = h.recovery.getMockImplementation()!
      if (when === "before timeout") h.context.generation += 1
      else
        h.recovery.mockImplementationOnce(async (transaction) => {
          await gate.promise
          return actualRecovery(transaction)
        })
      await vi.advanceTimersByTimeAsync(100)
      if (when === "during timeout write") h.context.generation += 1
      gate.resolve()
      await vi.advanceTimersByTimeAsync(0)
      expect(h.events.some((event) => event.kind === "restore-timeout")).toBe(
        false
      )
      if (when === "before timeout") expect(h.records()).toEqual(before)
    }
  )
})

describe("Trash execution progress and request correlation", () => {
  it("persists mixed per-target progress before the partial terminal result", async () => {
    vi.useFakeTimers()
    const h = harness({ targetKeys: ["trash", "trash-2", "trash-3"] })
    const undo = await h.prepareUndo()
    await h.lifecycle.restoreItems(undo, "restore-request")
    const outcomes = [
      { operation: "restore", targetKey: "dedup-trash", status: "confirmed" },
      { operation: "restore", targetKey: "dedup-trash-2", status: "unknown" },
      { operation: "restore", targetKey: "dedup-trash-3", status: "failed" }
    ]
    h.lifecycle.receiveRestoreProgress({
      app: APP_ID,
      action: "gptkProgress",
      command: "restoreItems",
      requestId: "restore-request",
      itemsProcessed: 1,
      data: { outcomes }
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.records()[0].restoreOutcomes).toMatchObject(outcomes)
    expect(h.events.at(-1)).toMatchObject({
      kind: "recovery",
      records: [{ operationId: "operation", restoreOutcomes: outcomes }]
    })
    expect(h.records()[0].restoreOutcomeHistory?.at(-1)?.terminal).toBe(false)
    await h.restored({
      success: false,
      error: "Provider stopped",
      data: {
        restoredDedupKeys: ["dedup-trash"],
        outcomes,
        notDispatchedDedupKeys: ["dedup-trash-3"]
      }
    })
    expect(h.records()[0].restoreOutcomes).toMatchObject(outcomes)
    expect(h.records()[0].lastError).toBe("Provider stopped")
    expect(h.records()[0].restorableDedupKeys).toEqual(["dedup-trash-3"])
    expect(h.records()[0].restoreOutcomeHistory?.at(-1)).toMatchObject({
      terminal: true,
      notDispatchedDedupKeys: ["dedup-trash-3"]
    })
    expect(h.events.at(-1)).toMatchObject({
      kind: "restore-result",
      outcome: { kind: "partial" }
    })
  })

  it.each([
    { name: "absent", outcomes: undefined },
    {
      name: "foreign target",
      outcomes: [
        { operation: "restore", targetKey: "foreign", status: "confirmed" }
      ]
    }
  ])(
    "ignores $name progress without a recovery update",
    async ({ outcomes }) => {
      vi.useFakeTimers()
      const h = harness()
      const undo = await h.prepareUndo()
      await h.lifecycle.restoreItems(undo, "restore-request")
      const before = structuredClone(h.records())
      const events = h.events.slice()
      h.lifecycle.receiveRestoreProgress({
        app: APP_ID,
        action: "gptkProgress",
        requestId: "restore-request",
        itemsProcessed: 0,
        ...(outcomes === undefined ? {} : { data: { outcomes } })
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(h.records()).toEqual(before)
      expect(h.events).toEqual(events)
    }
  )

  it("reports failed progress persistence and allows the queued terminal write to recover", async () => {
    vi.useFakeTimers()
    const h = harness()
    const undo = await h.prepareUndo()
    await h.lifecycle.restoreItems(undo, "restore-request")
    h.recovery.mockRejectedValueOnce(new Error("Progress storage unavailable"))
    h.lifecycle.receiveRestoreProgress({
      app: APP_ID,
      action: "gptkProgress",
      requestId: "restore-request",
      itemsProcessed: 1,
      data: {
        outcomes: [
          {
            operation: "restore",
            targetKey: "dedup-trash",
            status: "confirmed"
          }
        ]
      }
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.events.at(-1)).toEqual({
      kind: "error",
      stage: "restore-progress",
      message: "Progress storage unavailable"
    })
    await h.restored()
    expect(h.records()[0].status).toBe("restored")
  })

  it.each([
    "inactive",
    "intent",
    "foreign request",
    "changed context",
    "terminal",
    "locked"
  ])("ignores progress for an %s restore", async (state) => {
    vi.useFakeTimers()
    const h = harness()
    const undo = await h.prepareUndo()
    const gate = deferred()
    const actualRecovery = h.recovery.getMockImplementation()!
    if (state === "intent")
      h.recovery.mockImplementationOnce(async (transaction) => {
        await gate.promise
        return actualRecovery(transaction)
      })
    const restoring =
      state === "inactive"
        ? undefined
        : h.lifecycle.restoreItems(undo, "restore-request")
    if (state !== "intent") await restoring
    if (state === "terminal" || state === "locked") {
      if (state === "locked")
        h.recovery.mockRejectedValueOnce(
          new Error("Terminal storage unavailable")
        )
      await h.restored()
    }
    if (state === "changed context") h.context.generation += 1
    const before = structuredClone(h.records())
    const events = h.events.slice()
    try {
      h.lifecycle.receiveRestoreProgress({
        app: APP_ID,
        action: "gptkProgress",
        itemsProcessed: 1,
        requestId: state === "foreign request" ? "foreign" : "restore-request",
        data: {
          outcomes: [
            {
              operation: "restore",
              targetKey: "dedup-trash",
              status: "confirmed"
            }
          ]
        }
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(h.records()).toEqual(before)
      expect(h.events).toEqual(events)
    } finally {
      gate.resolve()
      await restoring
    }
  })

  it.each([
    ["command", { command: "fetchPhotos" }],
    ["request", { requestId: "foreign" }],
    ["provider", { provider: "icloud" }],
    ["session", { providerSessionId: "foreign" }]
  ] satisfies [string, Partial<GptkResultMessage>][])(
    "ignores a foreign restore %s without cancelling its real timeout",
    async (_, change) => {
      vi.useFakeTimers()
      const h = harness()
      const undo = await h.prepareUndo()
      await h.lifecycle.restoreItems(undo, "restore-request")
      const before = structuredClone(h.records())
      const events = h.events.slice()
      await h.restored(change)
      expect(h.records()).toEqual(before)
      expect(h.events).toEqual(events)
      await vi.advanceTimersByTimeAsync(100)
      expect(h.events.at(-1)).toMatchObject({ kind: "restore-timeout" })
      expect(h.lifecycle.restoreBusy).toBe(true)
    }
  )

  it.each([
    ["request", { requestId: "foreign" }],
    ["provider", { provider: "icloud" }],
    ["session", { providerSessionId: "foreign" }]
  ] satisfies [string, Partial<GptkResultMessage>][])(
    "ignores a foreign Trash %s and accepts the subsequent bound reply",
    async (_, change) => {
      vi.useFakeTimers()
      const h = harness()
      await h.dispatch()
      await h.trashed(change)
      expect(h.events).toEqual([])
      expect(h.records()[0].status).toBe("pending")
      await h.trashed()
      expect(h.records()[0].status).toBe("complete")
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it.each([
    { provider: undefined },
    { providerSessionId: undefined },
    { provider: undefined, providerSessionId: undefined }
  ])(
    "accepts a correlated legacy Trash reply with omitted optional stamps (%j)",
    async (change) => {
      const h = harness()
      await h.dispatch()
      await h.trashed(change)
      expect(h.records()[0].status).toBe("complete")
    }
  )

  it("ignores terminal replies when no execution request exists", async () => {
    const h = harness()
    await h.trashed()
    await h.restored()
    expect(h.events).toEqual([])
  })

  it("ignores restore results and progress after its lifecycle request was cancelled", async () => {
    vi.useFakeTimers()
    const h = harness()
    const undo = await h.prepareUndo()
    await h.lifecycle.restoreItems(undo, "restore-request")
    h.lifecycle.cancelRestore("restore-request")
    const before = structuredClone(h.records())
    const events = h.events.slice()
    h.lifecycle.receiveRestoreProgress({
      app: APP_ID,
      action: "gptkProgress",
      itemsProcessed: 1,
      requestId: "restore-request",
      data: {
        outcomes: [
          {
            operation: "restore",
            targetKey: "dedup-trash",
            status: "confirmed"
          }
        ]
      }
    })
    await vi.advanceTimersByTimeAsync(100)
    await h.restored()
    expect(h.records()).toEqual(before)
    expect(h.events).toEqual(events)
  })

  it("keeps an absent terminal payload unknown and explains the ambiguous targets", async () => {
    const h = harness()
    const undo = await h.prepareUndo()
    await h.lifecycle.restoreItems(undo, "restore-request")
    await h.restored({
      success: false,
      data: undefined,
      error: "Provider unavailable"
    })
    expect(h.records()[0].status).toBe("restore_unknown")
    expect(h.records()[0].lastError).toContain(
      "ambiguous targets will not be retried"
    )
    expect(h.records()[0].restorableDedupKeys).toEqual([])
  })

  it("clears timers and suppresses late Trash results after an ordinary reset", async () => {
    vi.useFakeTimers()
    const h = harness()
    await h.dispatch()
    h.lifecycle.reset()
    expect(vi.getTimerCount()).toBe(0)
    await h.trashed()
    await vi.advanceTimersByTimeAsync(100)
    expect(h.events).toEqual([])
    expect(h.records()[0].status).toBe("pending")
  })

  it("releases the current restore and its timer when the UI context is invalidated", async () => {
    vi.useFakeTimers()
    const h = harness()
    const undo = await h.prepareUndo()
    await h.lifecycle.restoreItems(undo, "restore-request")
    h.lifecycle.invalidateContext()
    expect(h.lifecycle.restoreBusy).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    const events = h.events.slice()
    await h.restored()
    expect(h.events).toEqual(events)
  })

  it("supports a lifecycle without execution and rejects execution methods clearly", () => {
    const lifecycle = new TrashLifecycle({
      async savePreTrashReport() {},
      async saveTrashResultReport() {}
    })
    expect(lifecycle.restoreBusy).toBe(false)
    expect(() =>
      lifecycle.receiveRestoreProgress({
        app: APP_ID,
        action: "gptkProgress",
        requestId: "restore-request",
        itemsProcessed: 0
      })
    ).toThrow("Trash execution adapter is required")
  })
})

describe("Trash execution overlapping delivery", () => {
  it.each(["timeout", "terminal"])(
    "ignores a late lost acknowledgement after its %s was handled",
    async (handled) => {
      vi.useFakeTimers()
      const h = harness()
      const gate = deferred()
      h.sendCommand.mockImplementationOnce(async () => {
        await gate.promise
        throw new Error("Late lost acknowledgement")
      })
      const dispatch = h.dispatch()
      await vi.advanceTimersByTimeAsync(0)
      if (handled === "timeout") await vi.advanceTimersByTimeAsync(100)
      else await h.trashed()
      gate.resolve()
      await dispatch
      expect(
        h.events.filter((event) => event.kind === "trash-result")
      ).toMatchObject([
        {
          timedOut: handled === "timeout",
          outcome: { kind: handled === "timeout" ? "unknown" : "complete" }
        }
      ])
      expect(h.records()[0].status).toBe(
        handled === "timeout" ? "unknown" : "complete"
      )
    }
  )

  it("persists an old-generation Trash timeout without notifying the new UI", async () => {
    vi.useFakeTimers()
    const h = harness()
    await h.dispatch()
    h.context.generation += 1
    await vi.advanceTimersByTimeAsync(100)
    expect(h.records()[0].status).toBe("unknown")
    expect(h.events).toEqual([])
  })

  it("defaults live Undo to non-history presentation", async () => {
    const h = harness()
    const undo = await h.prepareUndo()
    await h.lifecycle.restoreItems(undo, "restore-request")
    expect(h.events.at(-1)).toEqual({
      kind: "restore-started",
      undo,
      history: false
    })
    await h.restored()
    expect(h.events.at(-1)).toMatchObject({
      kind: "restore-result",
      history: false
    })
  })

  it("ignores a restore terminal result while its durable intent is still being written", async () => {
    const h = harness()
    const undo = await h.prepareUndo()
    const gate = deferred()
    const actualRecovery = h.recovery.getMockImplementation()!
    h.recovery.mockImplementationOnce(async (transaction) => {
      await gate.promise
      return actualRecovery(transaction)
    })
    const restoring = h.lifecycle.restoreItems(undo, "restore-request")
    const before = structuredClone(h.records())
    const events = h.events.slice()
    try {
      await h.restored()
      expect(h.records()).toEqual(before)
      expect(h.events).toEqual(events)
    } finally {
      gate.resolve()
      await restoring
    }
  })

  it("ignores a restore result from an invalidated generation", async () => {
    const h = harness()
    const undo = await h.prepareUndo()
    await h.lifecycle.restoreItems(undo, "restore-request")
    const before = structuredClone(h.records())
    const events = h.events.slice()
    h.context.generation += 1
    await h.restored()
    expect(h.records()).toEqual(before)
    expect(h.events).toEqual(events)
  })
})

describe("Restore timeout cancellation", () => {
  it("suppresses an in-flight timeout notification after the lifecycle is invalidated", async () => {
    vi.useFakeTimers()
    const h = harness()
    const undo = await h.prepareUndo()
    await h.lifecycle.restoreItems(undo, "restore-request")
    const gate = deferred()
    const actualRecovery = h.recovery.getMockImplementation()!
    h.recovery.mockImplementationOnce(async (transaction) => {
      await gate.promise
      return actualRecovery(transaction)
    })
    await vi.advanceTimersByTimeAsync(100)
    h.lifecycle.invalidateContext()
    gate.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.events.some((event) => event.kind === "restore-timeout")).toBe(
      false
    )
    expect(h.lifecycle.restoreBusy).toBe(false)
  })
})

describe("Legacy restore and Trash bindings", () => {
  it("reports a rejected padded legacy account binding without dispatching restore", async () => {
    const h = harness()
    const undo = await h.prepareUndo()
    h.sendCommand.mockClear()
    await expect(
      h.lifecycle.restoreItems(
        {
          ...undo,
          accountEmail: " person@example.com "
        },
        "restore-request"
      )
    ).resolves.toBe(false)
    expect(h.sendCommand).not.toHaveBeenCalled()
    expect(h.events.at(-1)).toMatchObject({
      kind: "error",
      stage: "restore-intent"
    })
    expect(h.records()[0].restorableDedupKeys).toEqual(["dedup-trash"])
  })
})

describe("Trash request ownership", () => {
  it("does not let an old lost acknowledgement time out a newer operation using the same request ID", async () => {
    vi.useFakeTimers()
    const h = harness()
    const gate = deferred()
    h.sendCommand.mockImplementationOnce(async () => {
      await gate.promise
      throw new Error("Old acknowledgement lost")
    })
    const first = h.dispatch()
    await vi.advanceTimersByTimeAsync(0)
    await h.trashed()
    await h.dispatch("operation-2")
    gate.resolve()
    await first
    expect(
      h.records().find((record) => record.operationId === "operation-2")?.status
    ).toBe("pending")
    await h.trashed()
    expect(
      h.records().find((record) => record.operationId === "operation-2")?.status
    ).toBe("complete")
  })
})
