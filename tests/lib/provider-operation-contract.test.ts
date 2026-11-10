import { describe, expect, it } from "vitest"

import {
  isProviderPageMessage,
  parseProviderResult,
  readProviderCommand,
  readProviderResult,
  type ProviderOperationRequest
} from "../../lib/provider-operation-contract"
import { APP_ID } from "../../lib/types"

const envelope = {
  app: APP_ID,
  action: "gptkResult",
  command: "listAlbums",
  requestId: "request",
  providerSessionId: "session",
  success: true
}

describe("Photo Provider Operation contract", () => {
  it("preserves absent provider metadata and expanded album relationships", () => {
    const albums = [
      { mediaKey: "album", title: "Trip", expanded: { members: ["one"] } }
    ]
    const parsed = parseProviderResult(
      { ...envelope, data: albums },
      "listAlbums"
    )
    expect(parsed?.success && parsed.data).toBe(albums)
    expect(parsed?.provider).toBeUndefined()
    expect(
      parseProviderResult(
        { ...envelope, data: [{ title: "Missing identity" }] },
        "listAlbums"
      )
    ).toBeNull()
  })

  it("rejects malformed envelopes before routing and preserves explicit unsupported results", () => {
    for (const change of [
      { app: "other" },
      { requestId: 1 },
      { success: "yes" },
      { provider: "other" }
    ]) {
      expect(readProviderResult({ ...envelope, ...change })).toBeNull()
    }
    const unsupported = {
      ...envelope,
      command: "unknown-command",
      success: false,
      errorCode: "unsupported_capability",
      error: "Unsupported"
    }
    expect(readProviderResult(unsupported)).toEqual(unsupported)
  })

  it("keeps tombstones and opaque mutation outcomes for domain interpretation", () => {
    const data = [
      { mediaKey: "deleted", deleted: true, expanded: { relationship: "pair" } }
    ]
    const scan = parseProviderResult(
      { ...envelope, command: "getAllMediaItems", data },
      "getAllMediaItems"
    )
    expect(scan?.success && scan.data).toBe(data)
    const mutation = {
      trashedDedupKeys: ["confirmed"],
      outcomes: [{ status: "unknown" }],
      notDispatchedDedupKeys: "malformed"
    }
    expect(
      parseProviderResult(
        { ...envelope, command: "trashItems", data: mutation },
        "trashItems"
      )?.data
    ).toBe(mutation)
    expect(
      parseProviderResult(
        { ...envelope, command: "restoreItems", data: undefined },
        "restoreItems"
      )?.success
    ).toBe(true)
  })

  it("validates command syntax without claiming provider authorization", () => {
    const request: ProviderOperationRequest<"cancelScan"> = {
      app: APP_ID,
      action: "gptkCommand",
      command: "cancelScan",
      requestId: "request",
      args: { targetRequestId: "scan" }
    }
    expect(readProviderCommand(request)).toEqual(request)
    expect(
      readProviderCommand({ ...request, args: { targetRequestId: 42 } })
    ).toBeNull()
    expect(
      readProviderCommand({ ...request, args: { retryCount: -1 } })
    ).toBeNull()
    expect(readProviderCommand({ ...request, args: [] })).toBeNull()
    expect(
      readProviderCommand({ ...request, args: { dedupKeys: [null] } })
    ).toBeNull()
  })

  it("validates progress and log variants at the page ingress", () => {
    expect(
      isProviderPageMessage({
        app: APP_ID,
        action: "gptkProgress",
        requestId: "request",
        itemsProcessed: 2
      })
    ).toBe(true)
    expect(
      isProviderPageMessage({
        app: APP_ID,
        action: "gptkProgress",
        requestId: "request",
        itemsProcessed: -1
      })
    ).toBe(false)
    expect(
      isProviderPageMessage({
        app: APP_ID,
        action: "gptkLog",
        level: "error",
        message: "Disconnected"
      })
    ).toBe(true)
    expect(
      isProviderPageMessage({
        app: APP_ID,
        action: "gptkLog",
        level: "arbitrary",
        message: "Disconnected"
      })
    ).toBe(false)
  })
})
