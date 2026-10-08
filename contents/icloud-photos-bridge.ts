import type { PlasmoCSConfig } from "plasmo"

import { installProviderMessageBridge } from "../lib/provider-message-bridge"

export const config: PlasmoCSConfig = {
  matches: [
    "https://www.icloud.com/*",
    "https://icloud.com/*",
    "https://www.icloud.com.cn/*",
    "https://icloud.com.cn/*"
  ],
  all_frames: true,
  run_at: "document_idle"
}


installProviderMessageBridge()

console.log("GPD: iCloud bridge content script loaded")
