import {
  isProviderHealthSnapshot,
  type GptkResultMessage,
  type PhotoProvider,
  type ProviderHealthSnapshot
} from "./types"
import { providerHealthUnavailableMessage } from "./provider-operations"

export interface ProviderConnectionAdapter {
  ensureReachable(tabId: number, provider: PhotoProvider): Promise<boolean>
  findProviderTab(
    provider: PhotoProvider,
    preferredTabId: number | null
  ): Promise<number | null>
}

export interface ProviderHealthAdapter {
  check(tabId: number, provider: PhotoProvider): Promise<GptkResultMessage>
  ensureGoogleMainWorldScripts(tabId: number): Promise<boolean>
  rememberGoogleSession(tabId: number, providerSessionId: string): void
  invalidateGoogleSession(tabId: number): void
}

export interface ProviderHealthOutcome {
  success: boolean
  hasGptk: boolean
  accountEmail?: string
  accountDisplayName?: string
  health?: ProviderHealthSnapshot
  providerSessionId?: string
  error?: string
}

export class ProviderConnectionSession {
  private readonly tabMap = new Map<number, number>()
  private readonly providerByTab = new Map<number, PhotoProvider>()
  private readonly sidePanelConnections = new Map<
    string,
    {
      hostTabId: number | null
      providerTabId: number | null
      provider: PhotoProvider
    }
  >()
  private sidePanelHost: number | null = null
  private sidePanelProviderTab: number | null = null
  private sidePanelProvider: PhotoProvider = "google"
  private sidePanelProviderClientId?: string

  get hostTabId(): number | null {
    return this.sidePanelHost
  }

  setHostTab(tabId: number | null): void {
    this.sidePanelHost = tabId
  }

  setSidePanelHost(clientId: string, tabId: number | null): void {
    const current = this.sidePanelConnections.get(clientId)
    this.sidePanelConnections.set(clientId, {
      hostTabId: tabId,
      providerTabId: current?.providerTabId ?? null,
      provider: current?.provider ?? "google"
    })
  }

  getSidePanelHostTabId(clientId: string): number | null {
    return this.sidePanelConnections.get(clientId)?.hostTabId ?? null
  }

  linkTabs(firstTabId: number, secondTabId: number): void {
    this.tabMap.set(firstTabId, secondTabId)
    this.tabMap.set(secondTabId, firstTabId)
  }

  remember(
    appTabId: number | null,
    providerTabId: number,
    provider: PhotoProvider,
    clientId?: string
  ): void {
    if (appTabId === null) {
      if (clientId) {
        const current = this.sidePanelConnections.get(clientId)
        this.sidePanelConnections.set(clientId, {
          hostTabId: current?.hostTabId ?? providerTabId,
          providerTabId,
          provider
        })
        return
      }
      this.sidePanelProviderTab = providerTabId
      this.sidePanelProvider = provider
      this.sidePanelProviderClientId = undefined
      return
    }
    this.linkTabs(appTabId, providerTabId)
    this.providerByTab.set(appTabId, provider)
    this.providerByTab.set(providerTabId, provider)
  }

  rememberSidePanelProvider(
    providerTabId: number,
    provider: PhotoProvider,
    clientId?: string
  ): void {
    this.sidePanelHost = providerTabId
    this.sidePanelProviderTab = providerTabId
    this.sidePanelProvider = provider
    this.sidePanelProviderClientId = clientId
    if (clientId) {
      this.sidePanelConnections.set(clientId, {
        hostTabId: providerTabId,
        providerTabId,
        provider
      })
    }
  }

  mappedProviderTabId(
    appTabId: number | null,
    provider: PhotoProvider,
    clientId?: string
  ): number | null {
    if (appTabId === null) {
      if (clientId) {
        const connection = this.sidePanelConnections.get(clientId)
        return connection?.provider === provider
          ? connection.providerTabId
          : null
      }
      return this.sidePanelProvider === provider
        ? this.sidePanelProviderTab
        : null
    }

    const providerTabId = this.tabMap.get(appTabId)
    if (
      providerTabId === undefined ||
      providerTabId === appTabId ||
      this.providerByTab.get(appTabId) !== provider
    ) {
      this.forgetPair(appTabId)
      return null
    }
    return providerTabId
  }

  async resolveProviderTab(
    appTabId: number | null,
    provider: PhotoProvider,
    adapter: ProviderConnectionAdapter,
    clientId?: string
  ): Promise<number | null> {
    const mappedTabId = this.mappedProviderTabId(appTabId, provider, clientId)
    if (mappedTabId !== null) {
      try {
        if (await adapter.ensureReachable(mappedTabId, provider)) {
          return mappedTabId
        }
      } catch {
        // A stale or unavailable tab falls through to provider discovery.
      }
      this.forgetProviderTab(appTabId, clientId)
    }

    const preferredTabId =
      appTabId === null && clientId
        ? (this.sidePanelConnections.get(clientId)?.hostTabId ?? null)
        : this.sidePanelHost
    const providerTabId = await adapter.findProviderTab(
      provider,
      preferredTabId
    )
    if (providerTabId === null) return null
    this.remember(appTabId, providerTabId, provider, clientId)
    return providerTabId
  }

  async checkProviderHealth(
    providerTabId: number,
    provider: PhotoProvider,
    adapter: ProviderHealthAdapter
  ): Promise<ProviderHealthOutcome> {
    let result = await adapter.check(providerTabId, provider)
    let data = result.data as {
      hasGptk: boolean
      accountEmail?: string
      accountDisplayName?: unknown
      health?: unknown
    }
    if (provider === "google" && !data.hasGptk) {
      const injected = await adapter.ensureGoogleMainWorldScripts(providerTabId)
      if (injected) {
        result = await adapter.check(providerTabId, provider)
        data = result.data as {
          hasGptk: boolean
          accountEmail?: string
          accountDisplayName?: unknown
          health?: unknown
        }
      }
    }
    if (provider === "google") {
      if (result.providerSessionId) {
        adapter.rememberGoogleSession(providerTabId, result.providerSessionId)
      } else {
        adapter.invalidateGoogleSession(providerTabId)
      }
    }

    if (
      data.health !== undefined &&
      !isProviderHealthSnapshot(data.health, provider)
    ) {
      return {
        success: false,
        hasGptk: false,
        error:
          "The provider returned an unsupported health schema. Reload the provider page and reconnect before scanning."
      }
    }
    const health = isProviderHealthSnapshot(data.health, provider)
      ? data.health
      : undefined
    const candidateDisplayName =
      provider === "amazon" && typeof data.accountDisplayName === "string"
        ? data.accountDisplayName.trim()
        : ""
    const accountDisplayName =
      candidateDisplayName.length > 0 &&
      candidateDisplayName.length <= 100 &&
      !/[\u0000-\u001f\u007f]/.test(candidateDisplayName)
        ? candidateDisplayName
        : undefined
    if (health?.status === "unavailable") {
      return {
        success: false,
        hasGptk: false,
        health,
        error: providerHealthUnavailableMessage(provider)
      }
    }
    return {
      success: Boolean(data.hasGptk),
      hasGptk: data.hasGptk,
      accountEmail: data.accountEmail,
      accountDisplayName,
      health,
      providerSessionId: result.providerSessionId
    }
  }

  forgetProviderTab(appTabId: number | null, clientId?: string): void {
    if (appTabId === null) {
      if (clientId) {
        const current = this.sidePanelConnections.get(clientId)
        if (current) {
          this.sidePanelConnections.set(clientId, {
            ...current,
            providerTabId: null
          })
        }
        return
      }
      this.sidePanelProviderTab = null
      this.sidePanelProviderClientId = undefined
      return
    }
    this.forgetPair(appTabId)
  }

  stopClient(clientId?: string): void {
    if (!clientId) return
    this.sidePanelConnections.delete(clientId)
    if (this.sidePanelProviderClientId === clientId) {
      const providerTabId = this.sidePanelProviderTab
      this.sidePanelProviderTab = null
      this.sidePanelProviderClientId = undefined
      if (this.sidePanelHost === providerTabId) this.sidePanelHost = null
    }
  }

  sidePanelClientsForProviderTab(tabId: number): string[] {
    return [...this.sidePanelConnections]
      .filter(([, connection]) => connection.providerTabId === tabId)
      .map(([clientId]) => clientId)
  }

  removeTab(tabId: number): number | null {
    if (this.sidePanelHost === tabId) this.sidePanelHost = null
    if (this.sidePanelProviderTab === tabId) {
      this.sidePanelProviderTab = null
      this.sidePanelProviderClientId = undefined
    }
    for (const [clientId, connection] of this.sidePanelConnections) {
      if (
        connection.hostTabId !== tabId &&
        connection.providerTabId !== tabId
      ) {
        continue
      }
      this.sidePanelConnections.set(clientId, {
        ...connection,
        hostTabId:
          connection.hostTabId === tabId ? null : connection.hostTabId,
        providerTabId:
          connection.providerTabId === tabId ? null : connection.providerTabId
      })
    }

    const mappedTabId = this.tabMap.get(tabId) ?? null
    this.forgetPair(tabId)

    return mappedTabId
  }

  private forgetPair(tabId: number): void {
    const mappedTabId = this.tabMap.get(tabId)
    this.tabMap.delete(tabId)
    this.providerByTab.delete(tabId)
    if (mappedTabId === undefined) return
    this.tabMap.delete(mappedTabId)
    this.providerByTab.delete(mappedTabId)
  }
}
