import { APP_ID } from "./types"
import { BUILD_ID } from "./generated/build-flags"
import type {
  ProviderCommandKeyResultMessage,
  ProviderCommandPublicKey
} from "./types"

const COMMAND_HOST_FILE = "scripts/photo-provider-command-host.js"

export function requestProviderCommandPublicKey(): Promise<ProviderCommandPublicKey> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { app: APP_ID, action: "providerCommandKey" },
      (response: ProviderCommandKeyResultMessage | undefined) => {
        const runtimeError = chrome.runtime.lastError
        if (runtimeError) {
          reject(new Error(runtimeError.message))
          return
        }
        if (!response?.publicKey) {
          reject(
            new Error(response?.error ?? "Provider command key unavailable")
          )
          return
        }
        resolve(response.publicKey)
      }
    )
  })
}

export function injectProviderScript(
  fileName: string,
  publicKey?: ProviderCommandPublicKey
): Promise<void> {
  const url = chrome.runtime.getURL(fileName)
  const buildId =
    typeof BUILD_ID === "string" && BUILD_ID.length > 0
      ? BUILD_ID
      : chrome.runtime.getManifest().version
  const ownerId = `${chrome.runtime.id}:${buildId}`
  const params = new URLSearchParams({
    owner: ownerId,
    v: `${buildId}-${Date.now()}`
  })
  if (fileName === COMMAND_HOST_FILE) {
    params.set("publicKey", JSON.stringify(publicKey))
  }
  const script = document.createElement("script")
  script.src = `${url}?${params.toString()}`
  script.type = "text/javascript"
  script.async = false
  const loaded = new Promise<void>((resolve, reject) => {
    script.addEventListener("load", () => resolve(), { once: true })
    script.addEventListener(
      "error",
      () => reject(new Error(`Unable to inject ${fileName}`)),
      { once: true }
    )
  })
  ;(document.head || document.documentElement).appendChild(script)
  return loaded
}
