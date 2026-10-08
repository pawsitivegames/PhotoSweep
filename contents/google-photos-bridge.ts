import type { PlasmoCSConfig } from "plasmo"

import { installProviderMessageBridge } from "../lib/provider-message-bridge"

export const config: PlasmoCSConfig = {
  matches: ["https://photos.google.com/*"],
  run_at: "document_idle",
}


installProviderMessageBridge(true)

console.log("GPD: Bridge content script loaded")
