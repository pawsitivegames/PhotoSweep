import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { APP_ID } from "../../lib/types"

const entries = [
  ["google", () => import("../../contents/google-photos-bridge")],
  ["icloud", () => import("../../contents/icloud-photos-bridge")],
  ["amazon", () => import("../../contents/amazon-photos-bridge")]
] as const

const request = {
  app: APP_ID,
  action: "providerOriginalHash.fetch",
  requestId: "request",
  providerSessionId: "session",
  scanScopeFingerprint: "scope",
  mediaKey: "photo",
  provider: "google",
  resourceUrl: "https://lh3.google.com/original",
  mediaKind: "photo",
  maxBytes: 100,
  aggregateBudgetBytes: 1000
}
const response = {
  requestId: request.requestId,
  providerSessionId: request.providerSessionId,
  scanScopeFingerprint: request.scanScopeFingerprint,
  mediaKey: request.mediaKey,
  success: false,
  error: "Original unavailable"
}

describe.each(entries)("%s production message bridge", (provider, load) => {
  let pageMessage: EventListener
  let runtimeMessage: (message: unknown) => void
  let runtime: { sendMessage: ReturnType<typeof vi.fn>; onMessage: { addListener: ReturnType<typeof vi.fn> }; lastError?: { message: string } }
  let postMessage: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.resetModules()
    runtime = {
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn((listener) => { runtimeMessage = listener }) }
    }
    vi.stubGlobal("chrome", { runtime })
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener) => {
      if (type === "message" && typeof listener === "function") pageMessage = listener
    })
    postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
    await load()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function receive(data: unknown, source: unknown = window) {
    pageMessage(new MessageEvent("message", { source: source as Window, data }))
  }

  it.each(["gptkResult", "gptkProgress", "gptkLog"])("forwards %s unchanged", (action) => {
    const message = { app: APP_ID, action, payload: "unchanged" }
    receive(message)
    expect(runtime.sendMessage).toHaveBeenCalledExactlyOnceWith(message)
  })

  it("rejects other windows, other apps, empty messages and unsupported actions", () => {
    receive({ app: APP_ID, action: "gptkResult" }, {})
    receive({ app: "other", action: "gptkResult" })
    receive(null)
    receive({ app: APP_ID, action: "gptkCommand" })
    expect(runtime.sendMessage).not.toHaveBeenCalled()
  })

  it("ignores stale-extension send failures and missing sendMessage", () => {
    runtime.sendMessage.mockImplementation(() => { throw new Error("Extension context invalidated") })
    expect(() => receive({ app: APP_ID, action: "gptkLog" })).not.toThrow()
    vi.stubGlobal("chrome", { runtime: { onMessage: runtime.onMessage } })
    expect(() => receive({ app: APP_ID, action: "gptkLog" })).not.toThrow()
  })

  it("forwards only this app's runtime commands without changing the target", () => {
    runtimeMessage(null)
    runtimeMessage({ app: "other", action: "gptkCommand" })
    runtimeMessage({ app: APP_ID, action: "gptkResult" })
    expect(postMessage).not.toHaveBeenCalled()
    const command = { app: APP_ID, action: "gptkCommand", command: "cancel" }
    runtimeMessage(command)
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(command)
  })

  it("keeps original-hash fetch and exact cancellation exclusive to Google", () => {
    receive(request)
    const cancel = { ...request, action: "providerOriginalHash.cancel" }
    receive(cancel)
    if (provider === "google") {
      expect(runtime.sendMessage).toHaveBeenNthCalledWith(1, request, expect.any(Function))
      expect(runtime.sendMessage).toHaveBeenNthCalledWith(2, cancel)
    } else {
      expect(runtime.sendMessage).not.toHaveBeenCalled()
    }
  })

  if (provider !== "google") return

  function complete(result: unknown) {
    receive(request)
    runtime.sendMessage.mock.calls[0][1](result)
  }

  it.each([false, true])("relays an exact scoped response (success=%s)", (success) => {
    const result = { ...response, success }
    complete(result)
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ app: APP_ID, action: "providerOriginalHash.result", ...result }, "*")
  })

  it.each(["requestId", "providerSessionId", "scanScopeFingerprint", "mediaKey"])("rejects a mismatched %s without exposing returned data", (field) => {
    complete({ ...response, [field]: "wrong", data: { secret: "must not relay" } })
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      app: APP_ID, action: "providerOriginalHash.result", ...response,
      error: "The extension returned a mismatched original request result."
    }, "*")
  })

  it("reports runtime failure with the request's exact scope", () => {
    runtime.lastError = { message: "Sensitive runtime detail" }
    complete(undefined)
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      app: APP_ID, action: "providerOriginalHash.result", ...response,
      error: "The extension could not complete the scoped original request."
    }, "*")
  })

  it("reports a synchronous fetch failure without leaking its error", () => {
    runtime.sendMessage.mockImplementation(() => { throw new Error("Sensitive runtime detail") })
    receive(request)
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      app: APP_ID, action: "providerOriginalHash.result", ...response,
      error: "The extension could not start the scoped original request."
    }, "*")
  })

  it("ignores cancellation send errors without producing a fetch result", () => {
    runtime.sendMessage.mockImplementation(() => { throw new Error("Extension context invalidated") })
    expect(() => receive({ ...request, action: "providerOriginalHash.cancel" })).not.toThrow()
    expect(postMessage).not.toHaveBeenCalled()
  })
})
