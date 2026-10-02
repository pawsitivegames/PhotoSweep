import {
  isProviderHealthSnapshot,
  type GptkResultMessage,
  type PhotoProvider,
  type ProviderHealthSnapshot
} from "./types"
import { providerHealthUnavailableMessage } from "./provider-operations"

export interface PendingProviderCommand {
  resolve: (data: unknown) => void
  reject: (error: string) => void
  appTabId: number | null
  providerTabId: number
  provider?: PhotoProvider
  command?: string
  appClientId?: string
}

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
  private readonly pendingCommands = new Map<string, PendingProviderCommand>()
  private sidePanelHost: number | null = null
  private sidePanelProviderTab: number | null = null
  private sidePanelProvider: PhotoProvider = "google"

  get hostTabId(): number | null {
    return this.sidePanelHost
  }

  setHostTab(tabId: number | null): void {
    this.sidePanelHost = tabId
  }

  linkTabs(firstTabId: number, secondTabId: number): void {
    this.tabMap.set(firstTabId, secondTabId)
    this.tabMap.set(secondTabId, firstTabId)
  }

  remember(
    appTabId: number | null,
    providerTabId: number,
    provider: PhotoProvider
  ): void {
    if (appTabId === null) {
      this.sidePanelProviderTab = providerTabId
      this.sidePanelProvider = provider
      return
    }
    this.linkTabs(appTabId, providerTabId)
    this.providerByTab.set(appTabId, provider)
    this.providerByTab.set(providerTabId, provider)
  }

  rememberSidePanelProvider(providerTabId: number, provider: PhotoProvider): void {
    this.sidePanelHost = providerTabId
    this.sidePanelProviderTab = providerTabId
    this.sidePanelProvider = provider
  }

  mappedProviderTabId(
    appTabId: number | null,
    provider: PhotoProvider
  ): number | null {
    if (appTabId === null) {
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
    adapter: ProviderConnectionAdapter
  ): Promise<number | null> {
    const mappedTabId = this.mappedProviderTabId(appTabId, provider)
    if (mappedTabId !== null) {
      try {
        if (await adapter.ensureReachable(mappedTabId, provider)) {
          return mappedTabId
        }
      } catch {
        // A stale or unavailable tab falls through to provider discovery.
      }
      this.forgetProviderTab(appTabId)
    }

    const providerTabId = await adapter.findProviderTab(
      provider,
      this.sidePanelHost
    )
    if (providerTabId === null) return null
    this.remember(appTabId, providerTabId, provider)
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

  forgetProviderTab(appTabId: number | null): void {
    if (appTabId === null) {
      this.sidePanelProviderTab = null
      return
    }
    this.forgetPair(appTabId)
  }

  startCommand(requestId: string, command: PendingProviderCommand): void {
    this.pendingCommands.set(requestId, command)
  }

  pendingCommand(requestId: string): PendingProviderCommand | undefined {
    return this.pendingCommands.get(requestId)
  }

  commandFromProvider(
    requestId: string,
    providerTabId: number | undefined
  ): PendingProviderCommand | undefined {
    const command = this.pendingCommands.get(requestId)
    return command?.providerTabId === providerTabId ? command : undefined
  }

  finishCommand(requestId: string): PendingProviderCommand | undefined {
    const command = this.pendingCommands.get(requestId)
    this.pendingCommands.delete(requestId)
    return command
  }

  cancelCommand(requestId: string, error?: string): void {
    const command = this.finishCommand(requestId)
    if (command && error) command.reject(error)
  }

  stopClient(clientId?: string): void {
    if (!clientId) return
    for (const [requestId, command] of this.pendingCommands) {
      if (command.appClientId !== clientId) continue
      this.pendingCommands.delete(requestId)
      command.reject("Side panel closed.")
    }
    this.sidePanelProviderTab = null
    this.sidePanelHost = null
  }

  removeTab(tabId: number): number | null {
    if (this.sidePanelHost === tabId) this.sidePanelHost = null
    if (this.sidePanelProviderTab === tabId) this.sidePanelProviderTab = null

    const mappedTabId = this.tabMap.get(tabId) ?? null
    this.forgetPair(tabId)

    for (const [requestId, command] of this.pendingCommands) {
      if (command.appTabId === tabId) this.pendingCommands.delete(requestId)
    }
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
