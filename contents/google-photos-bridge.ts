import type { PlasmoCSConfig } from "plasmo"
import { APP_ID } from "../lib/types"
import type { AppMessage } from "../lib/types"
import type {
  ProviderOriginalHashCancelMessage,
  ProviderOriginalHashFetchMessage,
  ProviderOriginalHashRelayResponse
} from "../lib/types"

// Bridge content script (ISOLATED world) for Google Photos pages.
// Relays messages between:
//   - MAIN world scripts (via window.postMessage) and
//   - The extension service worker (via chrome.runtime messaging)

export const config: PlasmoCSConfig = {
  matches: ["https://photos.google.com/*"],
  run_at: "document_idle",
}

function safeSendRuntimeMessage(message: AppMessage) {
  try {
    chrome.runtime?.sendMessage?.(message)
  } catch {
    // The extension was likely reloaded while this content script remained on
    // the page. Ignore stale bridge messages instead of surfacing noisy errors.
  }
}

// MAIN world -> service worker
// Forward gptkResult, gptkProgress, gptkLog messages from the page to the extension.
window.addEventListener("message", (event) => {
  if (event.source !== window) return
  const msg = event.data as AppMessage
  if (msg?.app !== APP_ID) return

  // Only forward GPTK result/progress/log messages to the service worker
  if (
    msg.action === "gptkResult" ||
    msg.action === "gptkProgress" ||
    msg.action === "gptkLog"
  ) {
    safeSendRuntimeMessage(msg)
    return
  }

  if (msg.action === "providerOriginalHash.fetch") {
    const request = msg as ProviderOriginalHashFetchMessage
    try {
      chrome.runtime.sendMessage(
        request,
        (response: ProviderOriginalHashRelayResponse | undefined) => {
          const error = chrome.runtime.lastError
          const relayResult: ProviderOriginalHashRelayResponse =
            response &&
            response.requestId === request.requestId &&
            response.providerSessionId === request.providerSessionId &&
            response.scanScopeFingerprint === request.scanScopeFingerprint &&
            response.mediaKey === request.mediaKey
              ? response
              : {
                  requestId: request.requestId,
                  providerSessionId: request.providerSessionId,
                  scanScopeFingerprint: request.scanScopeFingerprint,
                  mediaKey: request.mediaKey,
                  success: false,
                  error: error
                    ? "The extension could not complete the scoped original request."
                    : "The extension returned a mismatched original request result."
                }
          window.postMessage(
            {
              app: APP_ID,
              action: "providerOriginalHash.result",
              ...relayResult
            },
            "*"
          )
        }
      )
    } catch {
      window.postMessage(
        {
          app: APP_ID,
          action: "providerOriginalHash.result",
          requestId: request.requestId,
          providerSessionId: request.providerSessionId,
          scanScopeFingerprint: request.scanScopeFingerprint,
          mediaKey: request.mediaKey,
          success: false,
          error: "The extension could not start the scoped original request."
        },
        "*"
      )
    }
    return
  }

  if (msg.action === "providerOriginalHash.cancel") {
    safeSendRuntimeMessage(msg as ProviderOriginalHashCancelMessage)
  }
})

// Service worker -> MAIN world
// Forward gptkCommand messages from the extension to the page.
chrome.runtime.onMessage.addListener((message: AppMessage) => {
  if (message?.app !== APP_ID) return
  if (message.action === "gptkCommand") {
    window.postMessage(message)
  }
})

console.log("GPD: Bridge content script loaded")
