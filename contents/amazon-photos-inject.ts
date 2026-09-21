import type { PlasmoCSConfig } from "plasmo"

import {
  injectProviderScript,
  requestProviderCommandPublicKey
} from "../lib/provider-script-injection"

export const config: PlasmoCSConfig = {
  matches: [
    "https://www.amazon.com/photos*",
    "https://amazon.com/photos*",
    "https://www.amazon.ca/photos*",
    "https://amazon.ca/photos*",
    "https://www.amazon.co.uk/photos*",
    "https://amazon.co.uk/photos*",
    "https://www.amazon.de/photos*",
    "https://amazon.de/photos*",
    "https://www.amazon.fr/photos*",
    "https://amazon.fr/photos*",
    "https://www.amazon.it/photos*",
    "https://amazon.it/photos*",
    "https://www.amazon.es/photos*",
    "https://amazon.es/photos*",
    "https://www.amazon.co.jp/photos*",
    "https://amazon.co.jp/photos*",
    "https://www.amazon.com.au/photos*",
    "https://amazon.com.au/photos*",
    "https://www.amazon.in/photos*",
    "https://amazon.in/photos*",
    "https://www.amazon.com.br/photos*",
    "https://amazon.com.br/photos*",
    "https://www.amazon.com.mx/photos*",
    "https://amazon.com.mx/photos*",
    "https://www.amazon.nl/photos*",
    "https://amazon.nl/photos*",
    "https://www.amazon.sg/photos*",
    "https://amazon.sg/photos*",
    "https://www.amazon.ae/photos*",
    "https://amazon.ae/photos*",
    "https://www.amazon.sa/photos*",
    "https://amazon.sa/photos*",
    "https://www.amazon.se/photos*",
    "https://amazon.se/photos*",
    "https://www.amazon.pl/photos*",
    "https://amazon.pl/photos*",
    "https://www.amazon.com.tr/photos*",
    "https://amazon.com.tr/photos*",
    "https://www.amazon.com.be/photos*",
    "https://amazon.com.be/photos*",
    "https://www.amazon.eg/photos*",
    "https://amazon.eg/photos*",
    "https://www.amazon.ie/photos*",
    "https://amazon.ie/photos*"
  ],
  run_at: "document_idle"
}

async function injectAmazonPhotosScripts(): Promise<void> {
  const publicKey = await requestProviderCommandPublicKey()
  await injectProviderScript("scripts/photo-provider-command-host.js", publicKey)
  await injectProviderScript("scripts/amazon-photos-commands.js")
}

void injectAmazonPhotosScripts()
  .then(() => {
    console.log("GPD: Injected MAIN world scripts into Amazon Photos page")
  })
  .catch((error) => {
    console.warn("GPD: Failed to inject Amazon Photos scripts", error)
  })
