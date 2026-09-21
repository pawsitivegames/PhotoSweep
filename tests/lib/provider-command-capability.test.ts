import { describe, expect, it } from "vitest"

import {
  getProviderCommandPublicKey,
  withProviderCommandCapability
} from "../../lib/provider-command-capability"

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

describe("provider command capability", () => {
  it("signs commands with a runtime-generated key whose public half verifies", async () => {
    const publicKey = await getProviderCommandPublicKey()
    const message = await withProviderCommandCapability({
      app: "GPD",
      action: "gptkCommand",
      command: "healthCheck",
      requestId: "capability-test",
      args: { provider: "google" },
      provider: "google"
    })

    const verificationKey = await crypto.subtle.importKey(
      "jwk",
      publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    )
    expect(message.capability).toBeDefined()
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        verificationKey,
        decodeBase64Url(message.capability!.signature),
        new TextEncoder().encode(message.capability!.payload)
      )
    ).toBe(true)
  })

  it("does not expose private key material to the page-facing public key", async () => {
    const publicKey = await getProviderCommandPublicKey()
    expect(publicKey).toEqual(
      expect.objectContaining({ kty: "EC", crv: "P-256" })
    )
    expect(publicKey).not.toHaveProperty("d")
  })
})
