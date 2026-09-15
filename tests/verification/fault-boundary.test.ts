import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"

import { DuplicateReviewSession } from "../../lib/duplicate-review-session"
import {
  TrashLifecycle,
  type TrashAuditAdapter
} from "../../lib/trash-lifecycle"
import type { DuplicateGroup, GpdMediaItem } from "../../lib/types"

const commandHostSource = readFileSync(
  resolve(process.cwd(), "scripts/photo-provider-command-host.js"),
  "utf8"
)

function commandHostFixture() {
  const listeners: Array<
    (event: { source: unknown; data: unknown }) => unknown
  > = []
  const posted: unknown[] = []
  const fakeWindow = {
    __GPD_COMMAND_HOST__: undefined as unknown,
    addEventListener(
      type: string,
      listener: (event: { source: unknown; data: unknown }) => unknown
    ) {
      if (type === "message") listeners.push(listener)
    },
    postMessage(message: unknown) {
      posted.push(message)
    }
  }
  runInNewContext(commandHostSource, { window: fakeWindow, Error })
  return {
    host: fakeWindow.__GPD_COMMAND_HOST__ as {
      postResult: (command: string, requestId: string, data: unknown) => void
      register: (params: {
        handlers: Record<
          string,
          (requestId: string, args: unknown) => Promise<void>
        >
        unsupportedMessage: (command: string) => string
      }) => void
    },
    source: fakeWindow,
    dispatch: async (event: { source: unknown; data: unknown }) => {
      for (const listener of listeners) await listener(event)
    },
    posted
  }
}

function lifecycleFixture(failingAudit = false) {
  const mediaItems: Record<string, GpdMediaItem> = {
    keep: {
      mediaKey: "keep",
      dedupKey: "keep-dedup",
      thumb: "keep",
      timestamp: 1,
      creationTimestamp: 1,
      provider: "google"
    },
    trash: {
      mediaKey: "trash",
      dedupKey: "trash-dedup",
      thumb: "trash",
      timestamp: 1,
      creationTimestamp: 1,
      provider: "google"
    }
  }
  const groups: DuplicateGroup[] = [
    {
      id: "fault-group",
      mediaKeys: ["keep", "trash"],
      originalMediaKey: "keep",
      similarity: 1
    }
  ]
  const reviewSession = new DuplicateReviewSession({
    groups,
    mediaItems,
    selections: {
      selectedGroupIds: new Set(["fault-group"]),
      reviewedGroupIds: new Set(["fault-group"]),
      keptOverrides: { "fault-group": new Set(["keep"]) }
    }
  })
  const audit: TrashAuditAdapter = {
    async savePreTrashReport() {
      if (failingAudit) throw new Error("pre-trash audit unavailable")
    },
    async saveTrashResultReport() {}
  }
  return {
    lifecycle: new TrashLifecycle(audit),
    plan: {
      provider: "google" as const,
      dedupKeys: ["trash-dedup"],
      mediaKeysToTrash: ["trash"],
      blockedMediaKeys: [],
      blockedGroupIds: []
    },
    groups,
    mediaItems,
    reviewSession
  }
}

async function begin(fixture: ReturnType<typeof lifecycleFixture>) {
  return fixture.lifecycle.begin({
    plan: fixture.plan,
    reviewSession: fixture.reviewSession,
    groups: fixture.groups,
    snapshot: {
      mediaItems: fixture.mediaItems,
      groups: fixture.groups,
      totalItems: 2
    },
    batchPolicy: {
      batchSize: 25,
      batchPauseMs: 0,
      retryCount: 0,
      retryBackoffMs: 0
    }
  })
}

describe("provider fault and message boundaries", () => {
  it("SAFE-10 ignores foreign, malformed, and wrong-app page messages", async () => {
    const fixture = commandHostFixture()
    let dispatches = 0
    fixture.host.register({
      handlers: {
        trashItems: async (requestId, args) => {
          dispatches += 1
          fixture.host.postResult("trashItems", requestId, { args })
        }
      },
      unsupportedMessage: (command) => `unsupported ${command}`
    })

    await fixture.dispatch({
      source: {},
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "trashItems",
        requestId: "foreign",
        args: {}
      }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "OTHER",
        action: "gptkCommand",
        command: "trashItems",
        requestId: "wrong-app",
        args: {}
      }
    })
    await fixture.dispatch({ source: fixture.source, data: null })
    await Promise.resolve()

    expect(dispatches).toBe(0)
    expect(fixture.posted).toEqual([])
  })

  it("SAFE-10 rejects unsupported commands while preserving the request envelope", async () => {
    const fixture = commandHostFixture()
    fixture.host.register({
      handlers: {},
      unsupportedMessage: (command) => `unsupported ${command}`
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "eraseEverything",
        requestId: "request-1",
        args: { secret: "must-not-dispatch" }
      }
    })
    await Promise.resolve()

    expect(fixture.posted).toEqual([
      {
        app: "GPD",
        action: "gptkResult",
        command: "eraseEverything",
        requestId: "request-1",
        success: false,
        error: "unsupported eraseEverything"
      }
    ])
  })

  it("SAFE-03 treats a successful provider envelope without confirmed identities as unknown", async () => {
    const fixture = lifecycleFixture()
    await begin(fixture)
    const outcome = await fixture.lifecycle.reconcile({
      success: true,
      data: {}
    })
    expect(outcome.kind).toBe("failed")
    expect(outcome.movedCount).toBe(0)
    expect(outcome.undo).toBeNull()
  })

  it("SAFE-07 keeps failed audit and reset replies from reaching a provider command", async () => {
    const auditFailure = lifecycleFixture(true)
    await expect(begin(auditFailure)).rejects.toThrow(
      "pre-trash audit unavailable"
    )
    const afterFailure = await auditFailure.lifecycle.reconcile({
      success: true,
      data: { trashedKeys: ["trash"], trashedDedupKeys: ["trash-dedup"] }
    })
    expect(afterFailure.movedCount).toBe(0)

    const resetFixture = lifecycleFixture()
    await begin(resetFixture)
    resetFixture.lifecycle.reset()
    const afterReset = await resetFixture.lifecycle.reconcile({
      success: true,
      data: { trashedKeys: ["trash"], trashedDedupKeys: ["trash-dedup"] }
    })
    expect(afterReset.movedCount).toBe(0)
    expect(afterReset.undo).toBeNull()
  })
})
