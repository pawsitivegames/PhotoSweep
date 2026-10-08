import { describe, expect, it, vi } from "vitest"

import {
  PhotoProviderOperationSession,
  type PendingPhotoProviderOperation
} from "../../lib/photo-provider-operation"
import { APP_ID } from "../../lib/types"
import type { GptkProgressMessage, GptkResultMessage } from "../../lib/types"

function operation(
  overrides: Partial<PendingPhotoProviderOperation> = {}
): PendingPhotoProviderOperation {
  return {
    resolve: vi.fn(),
    reject: vi.fn(),
    appTabId: 10,
    providerTabId: 20,
    provider: "google",
    command: "getAllMediaItems",
    ...overrides
  }
}

function result(overrides: Partial<GptkResultMessage> = {}): GptkResultMessage {
  return {
    app: APP_ID,
    action: "gptkResult",
    command: "getAllMediaItems",
    requestId: "request",
    provider: "google",
    success: true,
    ...overrides
  }
}

describe("PhotoProviderOperationSession", () => {
  it("accepts a terminal result only from the owning provider tab", () => {
    const session = new PhotoProviderOperationSession()
    const pending = operation()
    session.start("request", pending)

    expect(session.completeFromProvider(result(), 21)).toBeUndefined()
    expect(session.get("request")).toBe(pending)

    const completion = session.completeFromProvider(result(), 20)
    expect(completion).toMatchObject({
      operation: pending,
      responseMatchesOperation: true,
      result: { command: "getAllMediaItems", provider: "google", success: true }
    })
    expect(session.completeFromProvider(result(), 20)).toBeUndefined()
  })

  it("turns a mismatched command or provider into a failed terminal result", () => {
    const session = new PhotoProviderOperationSession()
    session.start("request", operation())

    const completion = session.completeFromProvider(
      result({ command: "trashItems", provider: "icloud" }),
      20
    )

    expect(completion?.responseMatchesOperation).toBe(false)
    expect(completion?.result).toMatchObject({
      command: "getAllMediaItems",
      provider: "google",
      success: false,
      error: "The provider response did not match the routed command."
    })
    expect(session.get("request")).toBeUndefined()
  })

  it("routes progress only from the owning provider tab", () => {
    const session = new PhotoProviderOperationSession()
    const pending = operation()
    const progress: GptkProgressMessage = {
      app: APP_ID,
      action: "gptkProgress",
      requestId: "request",
      itemsProcessed: 4
    }
    session.start("request", pending)

    expect(session.progressFromProvider(progress.requestId, 21)).toBeUndefined()
    expect(session.progressFromProvider(progress.requestId, 20)).toBe(pending)
  })

  it("rejects only operations owned by a disconnected side-panel client", () => {
    const session = new PhotoProviderOperationSession()
    const firstReject = vi.fn()
    const secondReject = vi.fn()
    session.start(
      "first",
      operation({
        appTabId: null,
        appClientId: "first-client",
        reject: firstReject
      })
    )
    session.start(
      "second",
      operation({
        appTabId: null,
        appClientId: "second-client",
        providerTabId: 21,
        reject: secondReject
      })
    )

    session.stopClient("first-client")

    expect(firstReject).toHaveBeenCalledWith("Side panel closed.")
    expect(secondReject).not.toHaveBeenCalled()
    expect(session.get("first")).toBeUndefined()
    expect(session.get("second")).toBeDefined()
  })

  it("cancels once and removes operations owned by a closed app tab", () => {
    const session = new PhotoProviderOperationSession()
    const reject = vi.fn()
    session.start("cancelled", operation({ reject }))
    session.start("closed-tab", operation({ appTabId: 11 }))

    session.cancel("cancelled", "Timed out.")
    session.cancel("cancelled", "Timed out.")
    session.removeAppTab(11)

    expect(reject).toHaveBeenCalledTimes(1)
    expect(reject).toHaveBeenCalledWith("Timed out.")
    expect(session.get("cancelled")).toBeUndefined()
    expect(session.get("closed-tab")).toBeUndefined()
  })
})
