/**
 * Browser-level message-boundary regression for the shared provider command
 * host. The page loads the exact production script in an isolated browser
 * document and registers both a harmless control handler and a destructive
 * handler. Foreign, malformed, wrong-app/action, prototype, and unsupported
 * messages must never reach the destructive handler.
 */
import { expect, test, type BrowserContext } from "@playwright/test"

import {
  getProviderCommandPublicKey,
  withProviderCommandCapability
} from "../../../lib/provider-command-capability"
import { launchExtension } from "../fixtures/extension"

function base64UrlEncode(bytes: ArrayBuffer): string {
  let binary = ""
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

let context: BrowserContext
let extensionId: string

test.beforeAll(async () => {
  ;({ context, extensionId } = await launchExtension())
})

test.afterAll(async () => {
  await context.close()
})

test("SAFE-10 security-boundary blocks unauthorized browser dispatch", async () => {
  const page = await context.newPage()
  try {
    await page.goto(`chrome-extension://${extensionId}/manifest.json`)
    const extensionKeyResponse = await page.evaluate(
      () =>
        new Promise<{
          publicKey?: { kty?: string; crv?: string; x?: string; y?: string }
          error?: string
        }>((resolve) => {
          chrome.runtime.sendMessage(
            { app: "GPD", action: "providerCommandKey" },
            resolve
          )
        })
    )
    expect(extensionKeyResponse).toMatchObject({
      publicKey: {
        kty: "EC",
        crv: "P-256",
        x: expect.any(String),
        y: expect.any(String)
      }
    })
    expect(extensionKeyResponse).not.toHaveProperty("publicKey.d")
    const publicKey = await getProviderCommandPublicKey()
    await page.addScriptTag({
      url:
        `chrome-extension://${extensionId}/scripts/photo-provider-command-host.js` +
        `?publicKey=${encodeURIComponent(JSON.stringify(publicKey))}`
    })

    const signedPrototype = await withProviderCommandCapability({
      app: "GPD",
      action: "gptkCommand",
      command: "constructor",
      requestId: "prototype-command",
      args: {},
      provider: "google"
    })
    const signedUnsupported = await withProviderCommandCapability({
      app: "GPD",
      action: "gptkCommand",
      command: "eraseEverything",
      requestId: "unsupported-command",
      args: { secret: "must-not-dispatch" },
      provider: "google"
    })
    const signedControl = await withProviderCommandCapability({
      app: "GPD",
      action: "gptkCommand",
      command: "healthCheck",
      requestId: "control-request",
      args: {},
      provider: "google"
    })
    const otherKeyPair = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    )) as CryptoKeyPair
    const signedWithOtherKey = await withProviderCommandCapability({
      app: "GPD",
      action: "gptkCommand",
      command: "healthCheck",
      requestId: "forged-key-request",
      args: {},
      provider: "google"
    })
    const forgedSignature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      otherKeyPair.privateKey,
      new TextEncoder().encode(signedWithOtherKey.capability!.payload)
    )
    const forgedKeyMessage = {
      ...signedWithOtherKey,
      capability: {
        ...signedWithOtherKey.capability!,
        signature: base64UrlEncode(forgedSignature)
      }
    }

    const observation = await page.evaluate(
      async ({
        signedPrototype,
        signedUnsupported,
        signedControl,
        forgedKeyMessage
      }) => {
        const browserWindow = window as typeof window & {
          __GPD_COMMAND_HOST__?: {
            postResult: (
              command: string,
              requestId: string,
              data: unknown
            ) => void
            register: (params: {
              handlers: Record<
                string,
                (requestId: string, args: unknown) => Promise<void>
              >
              unsupportedMessage: (command: string) => string
            }) => void
          }
        }
        const host = browserWindow.__GPD_COMMAND_HOST__
        if (!host) throw new Error("Production command host did not load")

        const posted: unknown[] = []
        const originalPostMessage = browserWindow.postMessage.bind(browserWindow)
        browserWindow.postMessage = ((message: unknown) => {
          posted.push(message)
        }) as typeof browserWindow.postMessage

        let controlDispatches = 0
        let destructiveDispatches = 0
        host.register({
          handlers: {
            healthCheck: async (requestId) => {
              controlDispatches += 1
              host.postResult("healthCheck", requestId, { ok: true })
            },
            trashItems: async () => {
              destructiveDispatches += 1
            }
          },
          unsupportedMessage: (command) => `unsupported ${command}`
        })

        const dispatch = (
          data: unknown,
          source: Window | null = browserWindow
        ) => {
          browserWindow.dispatchEvent(
            new MessageEvent("message", { source, data })
          )
        }

        dispatch({
          app: "OTHER",
          action: "gptkCommand",
          command: "trashItems",
          requestId: "wrong-app",
          args: {}
        })
        dispatch({
          app: "GPD",
          action: "wrongAction",
          command: "trashItems",
          requestId: "wrong-action",
          args: {}
        })
        dispatch(
          {
            app: "GPD",
            action: "gptkCommand",
            command: "trashItems",
            requestId: "foreign-source",
            args: {}
          },
          null
        )
        dispatch(null)
        dispatch(["GPD", "gptkCommand", "trashItems"])
        dispatch({
          app: "GPD",
          action: "gptkCommand",
          command: "trashItems",
          args: {}
        })
        dispatch(signedPrototype)
        dispatch(signedUnsupported)
        dispatch(forgedKeyMessage)

        // A real control request proves the fixture is observing the dispatch
        // boundary rather than succeeding only because no listener was present.
        dispatch(signedControl)
        // Replaying a valid capability is rejected after its one-time nonce is
        // consumed. Altering its arguments is rejected by the signed payload
        // binding before the handler is reached. These are intentionally
        // dispatched together to exercise the concurrent-delivery race.
        dispatch(signedControl)
        dispatch({ ...signedControl, args: { altered: true } })

        await new Promise((resolve) => setTimeout(resolve, 0))
        browserWindow.postMessage = originalPostMessage

        return {
          controlDispatches,
          destructiveDispatches,
          posted: posted.map((message) => {
            const value = message as Record<string, unknown>
            return {
              action: value.action,
              command: value.command,
              requestId: value.requestId,
              success: value.success,
              error: value.error
            }
          })
        }
      },
      { signedPrototype, signedUnsupported, signedControl, forgedKeyMessage }
    )

    expect(observation.controlDispatches).toBe(1)
    expect(observation.destructiveDispatches).toBe(0)
    expect(observation.posted).toEqual(
      expect.arrayContaining([
        {
          action: "gptkResult",
          command: "constructor",
          requestId: "prototype-command",
          success: false,
          error: "unsupported constructor"
        },
        {
          action: "gptkResult",
          command: "eraseEverything",
          requestId: "unsupported-command",
          success: false,
          error: "unsupported eraseEverything"
        },
        {
          action: "gptkResult",
          command: "healthCheck",
          requestId: "control-request",
          success: true,
          error: undefined
        }
      ])
    )
    expect(observation.posted).toHaveLength(3)
  } finally {
    await page.close()
  }
})
