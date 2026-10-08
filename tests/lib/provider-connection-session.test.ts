import { describe, expect, it } from "vitest"

import { ProviderConnectionSession } from "../../lib/provider-connection-session"

describe("ProviderConnectionSession", () => {
  it("keeps app and provider identity paired", () => {
    const session = new ProviderConnectionSession()
    session.remember(10, 20, "icloud")

    expect(session.mappedProviderTabId(10, "icloud")).toBe(20)
    expect(session.mappedProviderTabId(10, "google")).toBeNull()
    expect(session.mappedProviderTabId(10, "icloud")).toBeNull()
  })

  it("keeps side-panel provider identity separate from tab apps", () => {
    const session = new ProviderConnectionSession()
    session.setHostTab(30)
    session.remember(null, 40, "amazon")

    expect(session.hostTabId).toBe(30)
    expect(session.mappedProviderTabId(null, "amazon")).toBe(40)
    expect(session.mappedProviderTabId(null, "google")).toBeNull()
  })

  it("removes both sides of a tab pair", () => {
    const session = new ProviderConnectionSession()
    session.remember(10, 20, "google")

    expect(session.removeTab(20)).toBe(10)
    expect(session.mappedProviderTabId(10, "google")).toBeNull()
    session.removeTab(10)
  })
})
