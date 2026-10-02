import { describe, expect, it } from "vitest"

import { GoogleCompletedScanRegistry } from "../../lib/google-original-relay"

const owner = {
  appTabId: 4,
  clientId: "side-panel-client",
  providerTabId: 9,
  provider: "google" as const,
  accountEmail: " Test@Example.com ",
  providerSessionId: "session-1",
  scopeFingerprint: "scope-1"
}

describe("GoogleCompletedScanRegistry", () => {
  it("registers exact returned items from terminal partial scans", () => {
    const registry = new GoogleCompletedScanRegistry()
    expect(
      registry.register({
        ...owner,
        coverageStatus: "partial",
        mediaItems: [
          { mediaKey: "returned-1", mediaKind: "photo", size: 123 },
          { mediaKey: "returned-2", mediaKind: "video", mimeType: "video/mp4" }
        ]
      })
    ).toBe(true)

    expect(
      registry.hasItem({
        ...owner,
        accountEmail: "test@example.com",
        mediaKey: "returned-1",
        expectedMediaKind: "photo"
      })
    ).toMatchObject({ mediaKey: "returned-1", size: 123 })
    expect(
      registry.hasItem({
        ...owner,
        accountEmail: "test@example.com",
        mediaKey: "returned-2",
        expectedMediaKind: "video"
      })
    ).toMatchObject({ mimeType: "video/mp4" })
  })

  it("rejects an unreturned item, another account, scope, session, tab, or provider", () => {
    const registry = new GoogleCompletedScanRegistry()
    registry.register({
      ...owner,
      coverageStatus: "complete",
      mediaItems: [{ mediaKey: "returned", mediaKind: "photo" }]
    })
    const current = {
      ...owner,
      accountEmail: "test@example.com",
      mediaKey: "returned",
      expectedMediaKind: "photo" as const
    }

    expect(registry.hasItem({ ...current, mediaKey: "not-returned" })).toBeNull()
    expect(registry.hasItem({ ...current, accountEmail: "other@example.com" })).toBeNull()
    expect(registry.hasItem({ ...current, scopeFingerprint: "other-scope" })).toBeNull()
    expect(registry.hasItem({ ...current, providerSessionId: "other-session" })).toBeNull()
    expect(registry.hasItem({ ...current, providerTabId: 10 })).toBeNull()
    expect(registry.hasItem({ ...current, provider: "amazon" })).toBeNull()
    expect(
      registry.hasItem({
        ...current,
        provider: "icloud",
        mediaKey: "returned"
      })
    ).toBeNull()
    expect(registry.hasItem({ ...current, expectedMediaKind: "video" })).toBeNull()
  })

  it("replaces prior exact scope membership for the same app and provider tab", () => {
    const registry = new GoogleCompletedScanRegistry()
    registry.register({
      ...owner,
      coverageStatus: "partial",
      mediaItems: [{ mediaKey: "old", mediaKind: "photo" }]
    })
    registry.register({
      ...owner,
      scopeFingerprint: "scope-2",
      coverageStatus: "partial",
      mediaItems: [{ mediaKey: "new", mediaKind: "photo" }]
    })

    expect(
      registry.hasItem({
        ...owner,
        accountEmail: "test@example.com",
        mediaKey: "old",
        expectedMediaKind: "photo"
      })
    ).toBeNull()
    expect(
      registry.hasItem({
        ...owner,
        scopeFingerprint: "scope-2",
        accountEmail: "test@example.com",
        mediaKey: "new",
        expectedMediaKind: "photo"
      })
    ).toMatchObject({ mediaKey: "new" })
  })

  it("does not register malformed or nonterminal scan results", () => {
    const registry = new GoogleCompletedScanRegistry()
    expect(
      registry.register({
        ...owner,
        coverageStatus: "failed" as "complete",
        mediaItems: [{ mediaKey: "candidate", mediaKind: "photo" }]
      })
    ).toBe(false)
    expect(
      registry.register({
        ...owner,
        coverageStatus: "complete",
        mediaItems: [{ mediaKey: "negative-size", mediaKind: "photo", size: -4 }]
      })
    ).toBe(false)
    expect(
      registry.register({
        ...owner,
        coverageStatus: "complete",
        mediaItems: [{ mediaKey: "duplicate", mediaKind: "photo" }, { mediaKey: "duplicate" }]
      })
    ).toBe(false)
    expect(
      registry.hasItem({
        ...owner,
        accountEmail: "test@example.com",
        mediaKey: "candidate",
        expectedMediaKind: "photo"
      })
    ).toBeNull()
  })
})
