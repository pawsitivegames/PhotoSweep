import { APP_ID } from "./types"
import type { GptkResultMessage, PhotoProvider } from "./types"

export interface PendingPhotoProviderOperation {
  resolve: (data: unknown) => void
  reject: (error: string) => void
  appTabId: number | null
  providerTabId: number
  provider?: PhotoProvider
  command?: string
  appClientId?: string
}

export interface PhotoProviderOperationCompletion {
  operation: PendingPhotoProviderOperation
  result: GptkResultMessage
  responseMatchesOperation: boolean
}

/**
 * Owns request correlation and terminal-response policy for Photo Provider
 * Operations. Chrome tab discovery and message delivery stay in adapters.
 */
export class PhotoProviderOperationSession {
  private readonly pending = new Map<string, PendingPhotoProviderOperation>()

  start(requestId: string, operation: PendingPhotoProviderOperation): void {
    this.pending.set(requestId, operation)
  }

  get(requestId: string): PendingPhotoProviderOperation | undefined {
    return this.pending.get(requestId)
  }

  fromProvider(
    requestId: string,
    providerTabId: number | undefined
  ): PendingPhotoProviderOperation | undefined {
    const operation = this.pending.get(requestId)
    return operation?.providerTabId === providerTabId ? operation : undefined
  }

  completeFromProvider(
    message: GptkResultMessage,
    providerTabId: number | undefined
  ): PhotoProviderOperationCompletion | undefined {
    const operation = this.fromProvider(message.requestId, providerTabId)
    if (!operation) return undefined

    const finished = this.finish(message.requestId)
    if (!finished) return undefined

    const responseMatchesOperation =
      (!finished.command || message.command === finished.command) &&
      (!message.provider ||
        !finished.provider ||
        message.provider === finished.provider)
    const result: GptkResultMessage = responseMatchesOperation
      ? {
          ...message,
          ...(finished.provider ? { provider: finished.provider } : {})
        }
      : {
          app: APP_ID,
          action: "gptkResult",
          command: finished.command ?? message.command,
          requestId: message.requestId,
          provider: finished.provider,
          success: false,
          error: "The provider response did not match the routed command."
        }

    return {
      operation: finished,
      result,
      responseMatchesOperation
    }
  }

  finish(requestId: string): PendingPhotoProviderOperation | undefined {
    const operation = this.pending.get(requestId)
    this.pending.delete(requestId)
    return operation
  }

  cancel(requestId: string, error?: string): void {
    const operation = this.finish(requestId)
    if (operation && error) operation.reject(error)
  }

  progressFromProvider(
    requestId: string,
    providerTabId: number | undefined
  ): PendingPhotoProviderOperation | undefined {
    return this.fromProvider(requestId, providerTabId)
  }

  stopClient(clientId?: string): void {
    if (!clientId) return
    for (const [requestId, operation] of this.pending) {
      if (operation.appClientId !== clientId) continue
      this.pending.delete(requestId)
      operation.reject("Side panel closed.")
    }
  }

  removeAppTab(tabId: number): void {
    for (const [requestId, operation] of this.pending) {
      if (operation.appTabId === tabId) this.pending.delete(requestId)
    }
  }
}
