import type { PlasmoCSConfig } from "plasmo"

import {
  injectProviderScript,
  requestProviderCommandPublicKey
} from "../lib/provider-script-injection"

// Content script that injects MAIN world scripts into Google Photos pages.
// These scripts need to run in the page's JS context to access GPTK globals
// (window.gptkApi, window.gptkCore, window.WIZ_global_data).

export const config: PlasmoCSConfig = {
  matches: ["https://photos.google.com/*"],
  run_at: "document_idle"
}

async function injectGooglePhotosScripts(): Promise<void> {
  const publicKey = await requestProviderCommandPublicKey()
  // Order matters: GPTK requires the unsafeWindow shim, and the command
  // handler expects GPTK globals to be available when health checks run.
  await injectProviderScript("scripts/unsafewindow-shim.js")
  await injectProviderScript("scripts/google-photos-toolkit.user.js")
  await injectProviderScript("scripts/photo-provider-command-host.js", publicKey)
  await injectProviderScript("scripts/google-photos-commands.js")
  console.log("GPD: Injected MAIN world scripts into Google Photos page")
}

void injectGooglePhotosScripts().catch((error) => {
  console.warn("GPD: Failed to inject Google Photos scripts", error)
})
