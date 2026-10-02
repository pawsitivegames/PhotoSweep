import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  RECOVERY_AUTHORITY_REQUIRED_ACTIONS
} from "../../verification/recovery-authority-model-evidence.mjs"

const root = process.cwd()

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8")
}

describe("[SAFE-12 authority correspondence map] bounded transition and source links", () => {
  it("registers every required model action in Next", () => {
    const module = read("verification/model/RecoveryAuthority.tla")
    const next = module.slice(module.indexOf("Next =="), module.indexOf("TypeOK =="))
    expect(next).not.toBe("")
    for (const action of RECOVERY_AUTHORITY_REQUIRED_ACTIONS) {
      expect(next, `missing registered action ${action}`).toMatch(
        new RegExp(`\\b${action}\\b`)
      )
    }
    expect(module).toContain("InvReloadedSubmissionRejectedByPersistedGuard")
    expect(module).toContain("InvTerminalPreservesConfirmedProgress")
    expect(module).toContain("InvClearSelectivelyRemovesOrdinaryRows")
  })

  it("binds the abstract transitions to named current worker and lifecycle tests", () => {
    const cases: Array<[string, string, string]> = [
      ["Submit", "tests/lib/trash-lifecycle.test.ts", "persists the pre-trash audit before exposing the provider command"],
      ["BeginPrewriteFails", "tests/background/service-worker.test.ts", "fails closed on write or readback failure and leaves any committed guard in storage"],
      ["BeginPersistGuardAck", "tests/background/service-worker.test.ts", "accepts only an exact target vector for an idempotent terminal update"],
      ["BeginPersistGuardLostAck", "tests/background/service-worker.test.ts", "fails closed on write or readback failure and leaves any committed guard in storage"],
      ["BeginLegacyIntent", "tests/lib/recovery-history.test.ts", "keeps unknowns from distinct or legacy requests sticky and ignores malformed same-request terminals"],
      ["RejectBeginOverlap", "tests/background/service-worker.test.ts", "rejects same-scope overlap across separate recovery operations"],
      ["SubmitAfterReload", "tests/background/service-worker.test.ts", "a fresh worker cannot replay a persisted guard"],
      ["RejectBeginOverlapAfterReload", "tests/background/service-worker.test.ts", "rejects same-scope overlap across separate recovery operations"],
      ["DispatchAuthorized", "tests/lib/trash-lifecycle.test.ts", "persists the pre-trash audit before exposing the provider command"],
      ["RecordProgressConfirmed", "tests/lib/trash-lifecycle.test.ts", "keeps confirmed and failed restore progress, but classifies an absent remainder as unknown on timeout"],
      ["TimeoutProvisional", "tests/lib/trash-lifecycle.test.ts", "keeps confirmed and failed restore progress, but classifies an absent remainder as unknown on timeout"],
      ["StageTerminalResponse", "tests/background/service-worker.test.ts", "accepts only an exact target vector for an idempotent terminal update"],
      ["PersistTerminal", "tests/background/service-worker.test.ts", "preserves a terminal vector committed before storage reports an error"],
      ["FailTerminalWrite", "tests/background/service-worker.test.ts", "keeps a provisional guard after terminal set failure and accepts only the exact late result"],
      ["RejectLateResponse", "tests/lib/trash-lifecycle.test.ts", "ignores a late reply after the operation has been reset"],
      ["ReloadWorker", "tests/background/service-worker.test.ts", "a fresh worker cannot replay a persisted guard"],
      ["AddCompletedHistory", "tests/lib/recovery-history-capacity.test.ts", "keeps the ordinary history limit when no unresolved safety record exists"],
      ["PruneCompletedHistory", "tests/background/service-worker.test.ts", "retains an unresolved restore guard beyond the ordinary history capacity"],
      ["ClearRecovery", "tests/background/service-worker.test.ts", "retains active guards on clear and prevents late trash-result overwrite"]
    ]

    for (const [action, path, title] of cases) {
      expect(RECOVERY_AUTHORITY_REQUIRED_ACTIONS, action).toContain(action)
      expect(read(path), `${action} source scenario missing: ${title}`).toContain(
        title
      )
    }

    const worker = read("background/recovery-history-transactions.ts")
    const router = read("background/index.ts")
    expect(worker).toContain("recoveryHistoryQueue.run")
    expect(worker).toContain("writeAndVerifyRecoveryHistory")
    expect(worker).toContain('case "beginRestore"')
    expect(worker).toContain('case "updateRestore"')
    expect(worker).toContain('case "clear"')
    expect(router).toContain('case "recoveryHistory.transaction"')
  })
})
