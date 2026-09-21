import type { PlasmoCSConfig } from "plasmo"

import {
  injectProviderScript,
  requestProviderCommandPublicKey
} from "../lib/provider-script-injection"

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

async function injectIcloudPhotosScripts(): Promise<void> {
  const publicKey = await requestProviderCommandPublicKey()
  await injectProviderScript("scripts/photo-provider-command-host.js", publicKey)
  await injectProviderScript("scripts/icloud-photos-commands.js")
}

void injectIcloudPhotosScripts()
  .then(() => {
    console.log("GPD: Injected MAIN world scripts into iCloud Photos page")
  })
  .catch((error) => {
    console.warn("GPD: Failed to inject iCloud Photos scripts", error)
  })
