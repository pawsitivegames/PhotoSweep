import { describe, expect, it } from "vitest"

import {
  ProviderConnectionSession,
  type ProviderConnectionAdapter
} from "../../lib/provider-connection-session"
import type { GptkResultMessage } from "../../lib/types"

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

  it("keeps provider connections separate for concurrent side-panel clients", async () => {
    const session = new ProviderConnectionSession()
    const searchedHostTabs: (number | null)[] = []
    const adapter: ProviderConnectionAdapter = {
      ensureReachable: async () => true,
      findProviderTab: async (_provider, preferredTabId) => {
        searchedHostTabs.push(preferredTabId)
        return preferredTabId
      }
    }

    session.setSidePanelHost("panel-a", 41)
    session.setSidePanelHost("panel-b", 42)

    await expect(
      session.resolveProviderTab(null, "icloud", adapter, "panel-a")
    ).resolves.toBe(41)
    await expect(
      session.resolveProviderTab(null, "icloud", adapter, "panel-b")
    ).resolves.toBe(42)
    expect(searchedHostTabs).toEqual([41, 42])
    expect(session.getSidePanelHostTabId("panel-a")).toBe(41)
    expect(session.getSidePanelHostTabId("panel-b")).toBe(42)
    expect(session.getSidePanelHostTabId("unknown-panel")).toBeNull()
    expect(session.mappedProviderTabId(null, "icloud", "panel-a")).toBe(41)
    expect(session.mappedProviderTabId(null, "icloud", "panel-b")).toBe(42)

    session.stopClient("panel-a")

    expect(session.mappedProviderTabId(null, "icloud", "panel-a")).toBeNull()
    expect(session.mappedProviderTabId(null, "icloud", "panel-b")).toBe(42)
  })

  it("updates the side-panel host without dropping its provider connection", () => {
    const session = new ProviderConnectionSession()
    session.rememberSidePanelProvider(41, "icloud", "panel-a")

    session.setSidePanelHost("panel-a", 7)

    expect(session.mappedProviderTabId(null, "icloud", "panel-a")).toBe(41)
    expect(session.mappedProviderTabId(null, "google", "panel-a")).toBeNull()
  })

  it("uses a discovered provider tab as the host when a client has no host yet", async () => {
    const session = new ProviderConnectionSession()
    const searchedHostTabs: (number | null)[] = []
    let nextProviderTabId = 41
    const adapter: ProviderConnectionAdapter = {
      ensureReachable: async () => false,
      findProviderTab: async (_provider, preferredTabId) => {
        searchedHostTabs.push(preferredTabId)
        const result = nextProviderTabId
        nextProviderTabId = 51
        return result
      }
    }

    await expect(
      session.resolveProviderTab(null, "icloud", adapter, "panel-a")
    ).resolves.toBe(41)
    await expect(
      session.resolveProviderTab(null, "icloud", adapter, "panel-a")
    ).resolves.toBe(51)

    expect(searchedHostTabs).toEqual([null, 41])
  })

  it("rediscovers only a stale side-panel connection", async () => {
    const session = new ProviderConnectionSession()
    const searchedHostTabs: (number | null)[] = []
    const adapter: ProviderConnectionAdapter = {
      ensureReachable: async (tabId) => tabId !== 41,
      findProviderTab: async (_provider, preferredTabId) => {
        searchedHostTabs.push(preferredTabId)
        return preferredTabId === 41 ? 51 : preferredTabId
      }
    }

    session.rememberSidePanelProvider(41, "icloud", "panel-a")
    session.rememberSidePanelProvider(42, "icloud", "panel-b")

    await expect(
      session.resolveProviderTab(null, "icloud", adapter, "panel-a")
    ).resolves.toBe(51)
    await expect(
      session.resolveProviderTab(null, "icloud", adapter, "panel-b")
    ).resolves.toBe(42)

    expect(searchedHostTabs).toEqual([41])
    expect(session.mappedProviderTabId(null, "icloud", "panel-a")).toBe(51)
    expect(session.mappedProviderTabId(null, "icloud", "panel-b")).toBe(42)
  })

  it("forgets a stale side-panel connection when rediscovery fails", async () => {
    const session = new ProviderConnectionSession()
    const searchedHostTabs: (number | null)[] = []
    const adapter: ProviderConnectionAdapter = {
      ensureReachable: async () => false,
      findProviderTab: async (_provider, preferredTabId) => {
        searchedHostTabs.push(preferredTabId)
        return null
      }
    }
    session.setSidePanelHost("panel-a", 7)
    session.rememberSidePanelProvider(41, "icloud", "panel-a")

    await expect(
      session.resolveProviderTab(null, "icloud", adapter, "panel-a")
    ).resolves.toBeNull()

    expect(searchedHostTabs).toEqual([41])
    expect(session.mappedProviderTabId(null, "icloud", "panel-a")).toBeNull()
  })

  it("uses the shared host and clears stale app-tab mappings", async () => {
    const session = new ProviderConnectionSession()
    const searchedHostTabs: (number | null)[] = []
    session.setHostTab(7)
    session.remember(10, 20, "icloud")
    const adapter: ProviderConnectionAdapter = {
      ensureReachable: async () => false,
      findProviderTab: async (_provider, preferredTabId) => {
        searchedHostTabs.push(preferredTabId)
        return null
      }
    }

    await expect(
      session.resolveProviderTab(10, "icloud", adapter, "app-client")
    ).resolves.toBeNull()

    expect(searchedHostTabs).toEqual([7])
    expect(session.mappedProviderTabId(10, "icloud")).toBeNull()
  })

  it("preserves a legacy provider connection when discovery for another provider fails", async () => {
    const session = new ProviderConnectionSession()
    session.rememberSidePanelProvider(41, "google")
    const adapter: ProviderConnectionAdapter = {
      ensureReachable: async () => false,
      findProviderTab: async () => null
    }

    await expect(
      session.resolveProviderTab(null, "amazon", adapter)
    ).resolves.toBeNull()

    expect(session.mappedProviderTabId(null, "google")).toBe(41)
    expect(session.mappedProviderTabId(null, "amazon")).toBeNull()
  })

  it("clears a stale legacy side-panel fallback after rediscovery fails", async () => {
    const session = new ProviderConnectionSession()
    const searchedHostTabs: (number | null)[] = []
    session.setHostTab(7)
    session.remember(null, 41, "icloud")
    const adapter: ProviderConnectionAdapter = {
      ensureReachable: async () => false,
      findProviderTab: async (_provider, preferredTabId) => {
        searchedHostTabs.push(preferredTabId)
        return null
      }
    }

    await expect(
      session.resolveProviderTab(null, "icloud", adapter)
    ).resolves.toBeNull()

    expect(searchedHostTabs).toEqual([7])
    expect(session.mappedProviderTabId(null, "icloud")).toBeNull()
  })

  it("clears only the owning side panel's fallback connection", () => {
    const legacySession = new ProviderConnectionSession()
    legacySession.rememberSidePanelProvider(30, "amazon")
    legacySession.stopClient()

    expect(legacySession.hostTabId).toBe(30)
    expect(legacySession.mappedProviderTabId(null, "amazon")).toBe(30)

    const session = new ProviderConnectionSession()
    session.rememberSidePanelProvider(41, "icloud", "panel-a")
    session.rememberSidePanelProvider(42, "icloud", "panel-b")

    session.stopClient("panel-a")
    expect(session.mappedProviderTabId(null, "icloud")).toBe(42)
    expect(session.mappedProviderTabId(null, "icloud", "panel-b")).toBe(42)

    session.stopClient("panel-b")
    expect(session.hostTabId).toBeNull()
    expect(session.mappedProviderTabId(null, "icloud")).toBeNull()

    const separateHost = new ProviderConnectionSession()
    separateHost.rememberSidePanelProvider(41, "icloud", "panel-a")
    separateHost.setHostTab(99)
    separateHost.stopClient("panel-a")
    expect(separateHost.hostTabId).toBe(99)
    expect(separateHost.mappedProviderTabId(null, "icloud")).toBeNull()
  })

  it("invalidates only the matching host or provider tabs", async () => {
    const session = new ProviderConnectionSession()
    session.setSidePanelHost("panel-a", 7)
    session.remember(null, 41, "icloud", "panel-a")
    session.setSidePanelHost("panel-b", 8)
    session.remember(null, 42, "icloud", "panel-b")
    session.setHostTab(99)

    session.removeTab(7)

    expect(session.hostTabId).toBe(99)
    expect(session.mappedProviderTabId(null, "icloud", "panel-a")).toBe(41)
    expect(session.mappedProviderTabId(null, "icloud", "panel-b")).toBe(42)

    const searchedHostTabs: (number | null)[] = []
    const adapter: ProviderConnectionAdapter = {
      ensureReachable: async () => false,
      findProviderTab: async (_provider, preferredTabId) => {
        searchedHostTabs.push(preferredTabId)
        return null
      }
    }
    session.removeTab(42)
    await session.resolveProviderTab(null, "icloud", adapter, "panel-b")
    expect(searchedHostTabs).toEqual([8])

    session.removeTab(8)
    await session.resolveProviderTab(null, "icloud", adapter, "panel-b")
    expect(searchedHostTabs).toEqual([8, null])

    session.removeTab(41)
    session.removeTab(99)

    expect(session.hostTabId).toBeNull()
    expect(session.mappedProviderTabId(null, "icloud", "panel-b")).toBeNull()
    expect(session.mappedProviderTabId(null, "icloud", "panel-a")).toBeNull()

    await session.resolveProviderTab(null, "icloud", adapter, "panel-a")
    expect(searchedHostTabs).toEqual([8, null, null])

    const legacySession = new ProviderConnectionSession()
    legacySession.setHostTab(7)
    legacySession.remember(null, 41, "icloud")
    legacySession.removeTab(42)
    expect(legacySession.mappedProviderTabId(null, "icloud")).toBe(41)
    legacySession.removeTab(41)
    expect(legacySession.mappedProviderTabId(null, "icloud")).toBeNull()
  })

  it("removes both sides of a tab pair", () => {
    const session = new ProviderConnectionSession()
    session.remember(10, 20, "google")

    expect(session.removeTab(20)).toBe(10)
    expect(session.mappedProviderTabId(10, "google")).toBeNull()
    session.removeTab(10)
  })

  it("reports a signed-in iCloud provider with the current health contract as connected", async () => {
    const health = {
      schemaVersion: 1,
      contractVersion: "provider-parity-v1",
      provider: "icloud",
      status: "ready",
      checks: { page: true, session: true, readPath: true }
    } as const
    const result: GptkResultMessage = {
      app: "GPD",
      action: "gptkResult",
      command: "healthCheck",
      requestId: "icloud-health",
      success: true,
      data: { hasGptk: true, health }
    }

    const outcome = await new ProviderConnectionSession().checkProviderHealth(
      34,
      "icloud",
      {
        check: async () => result,
        ensureGoogleMainWorldScripts: async () => false,
        rememberGoogleSession: () => undefined,
        invalidateGoogleSession: () => undefined
      }
    )

    expect(outcome).toMatchObject({
      success: true,
      hasGptk: true,
      health: {
        provider: "icloud",
        status: "ready",
        checks: { page: true, session: true, readPath: true }
      }
    })
  })

  it("fails closed when an iCloud health response uses an unsupported contract", async () => {
    const result: GptkResultMessage = {
      app: "GPD",
      action: "gptkResult",
      command: "healthCheck",
      requestId: "icloud-health-unsupported",
      success: true,
      data: {
        hasGptk: true,
        health: {
          schemaVersion: 1,
          contractVersion: "provider-parity-v0",
          provider: "icloud",
          status: "ready",
          checks: { page: true, session: true, readPath: true }
        }
      }
    }

    const outcome = await new ProviderConnectionSession().checkProviderHealth(
      34,
      "icloud",
      {
        check: async () => result,
        ensureGoogleMainWorldScripts: async () => false,
        rememberGoogleSession: () => undefined,
        invalidateGoogleSession: () => undefined
      }
    )

    expect(outcome).toEqual({
      success: false,
      hasGptk: false,
      error:
        "The provider returned an unsupported health schema. Reload the provider page and reconnect before scanning."
    })
  })
})
