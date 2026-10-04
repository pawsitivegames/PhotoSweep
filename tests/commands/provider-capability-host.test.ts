/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { atob as nodeAtob } from "node:buffer"

type Capability = { payload: string; signature: string }
type Message = {
  app: string
  action: string
  command: string
  requestId: string
  provider: string
  args: Record<string, unknown>
  capability?: Capability
}
type CommandEvent = { source: unknown; data: unknown }
type CommandListener = (event: CommandEvent) => Promise<void> | void
type TestCommandHost = {
  dateRangeBounds: (
    dateRange: { from?: string; to?: string } | null | undefined
  ) => { fromMs: number; toMs: number; valid: boolean } | null
  postResult: (
    command: string,
    requestId: string,
    data: unknown,
    scanCoverage?: unknown,
    providerSyncToken?: unknown
  ) => void
  register: (params: {
    handlers: Record<
      string,
      (requestId: string, args: Record<string, unknown>) => void
    >
  }) => void
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null"
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`
  }
  return "null"
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = ""
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

async function createCapabilityFixture() {
  const testWindow = window as unknown as {
    __GPD_COMMAND_HOST_TEST_MODE__?: boolean
    __GPD_COMMAND_HOST_TEST_FACTORY__?: (
      targetWindow: Record<string, unknown>,
      publicKey?: unknown
    ) => TestCommandHost
  }
  testWindow.__GPD_COMMAND_HOST_TEST_MODE__ = true
  window.dispatchEvent(new Event("gpd-command-host-test"))
  const createHost = testWindow.__GPD_COMMAND_HOST_TEST_FACTORY__
  if (!createHost) throw new Error("test command-host factory missing")

  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  )
  const exportedPublicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey)
  if (!exportedPublicKey.x || !exportedPublicKey.y) {
    throw new Error("generated public key is incomplete")
  }
  const publicKey = {
    kty: "EC",
    crv: "P-256",
    x: exportedPublicKey.x,
    y: exportedPublicKey.y
  }

  const messages: unknown[] = []
  const listeners: CommandListener[] = []
  const storage = new Map<string, string>()
  const targetWindow: Record<string, unknown> = {
    location: { protocol: "about:", hostname: "", origin: "about:blank" },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    },
    postMessage: vi.fn((message: unknown) => messages.push(message)),
    addEventListener: vi.fn((type: string, listener: CommandListener) => {
      if (type === "message") listeners.push(listener)
    }),
    __GPD_COMMAND_HOST_TEST_AUTH__: true
  }
  targetWindow.top = targetWindow

  const host = createHost(targetWindow, publicKey)
  const handler = vi.fn(
    (_requestId: string, _args: Record<string, unknown>) => undefined
  )
  host.register({ handlers: { probe: handler } })
  const listener = listeners.at(-1)
  if (!listener) throw new Error("provider command listener was not registered")

  const sign = async (
    message: Message,
    overrides: Partial<Pick<Message, "app" | "action" | "command" | "requestId" | "provider">> = {},
    nonce = "capability-nonce-0001"
  ): Promise<Capability> => {
    const issuedAt = Date.now()
    const payload = canonicalJson({
      app: overrides.app ?? message.app,
      action: overrides.action ?? message.action,
      command: overrides.command ?? message.command,
      requestId: overrides.requestId ?? message.requestId,
      provider: overrides.provider ?? message.provider,
      args: message.args,
      issuedAt,
      nonce
    })
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      new TextEncoder().encode(payload)
    )
    return { payload, signature: base64Url(signature) }
  }

  return {
    handler,
    host,
    messages,
    sign,
    send: async (message: Message) =>
      await listener({ source: targetWindow, data: message })
  }
}

function commandMessage(requestId = "capability-request-1"): Message {
  return {
    app: "GPD",
    action: "gptkCommand",
    command: "probe",
    requestId,
    provider: "google",
    args: {}
  }
}

describe("provider command capability and result boundaries", () => {
  beforeEach(async () => {
    vi.resetModules()
    // @ts-expect-error Vite resolves this JavaScript module in the test bundle.
    await import("../../scripts/photo-provider-command-host.js")
  })

  it("rejects missing and malformed capabilities without dispatching", async () => {
    const fixture = await createCapabilityFixture()
    const message = commandMessage()

    await expect(fixture.send(message)).resolves.toBeUndefined()
    await expect(
      fixture.send({
        ...message,
        requestId: "capability-request-malformed",
        capability: { payload: "{", signature: "AA" }
      })
    ).resolves.toBeUndefined()

    expect(fixture.handler).not.toHaveBeenCalled()
  })

  it("rejects JSON null capability payloads without rejecting the message listener", async () => {
    const fixture = await createCapabilityFixture()
    const message = commandMessage("capability-request-null-payload")

    await expect(
      fixture.send({
        ...message,
        capability: { payload: "null", signature: "AA" }
      })
    ).resolves.toBeUndefined()

    expect(fixture.handler).not.toHaveBeenCalled()
  })

  it("accepts a signed command once and rejects payload binding mismatches and replay", async () => {
    // happy-dom accepts arbitrarily excessive trailing padding; Node's atob
    // matches Chrome's rejection of that malformed form for this signature path.
    vi.stubGlobal("atob", nodeAtob)
    try {
      const fixture = await createCapabilityFixture()
      const message = commandMessage()
      const capability = await fixture.sign(message)

      await fixture.send({ ...message, capability })
      expect(fixture.handler).toHaveBeenCalledTimes(1)

      await fixture.send({ ...message, capability })
      expect(fixture.handler).toHaveBeenCalledTimes(1)

      const changedRequest = commandMessage("capability-request-changed")
      const mismatchedCapability = await fixture.sign(changedRequest, {
        requestId: "capability-request-original"
      })
      await fixture.send({ ...changedRequest, capability: mismatchedCapability })
      expect(fixture.handler).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("rejects duck-typed non-string signatures on same-window message events", async () => {
    const fixture = await createCapabilityFixture()
    const message = commandMessage("capability-request-duck-signature")
    const capability = await fixture.sign(message)
    const verifySpy = vi.spyOn(crypto.subtle, "verify")
    const duckTypedSignature = {
      replace(search: string | RegExp, replacement: string) {
        return capability.signature.replace(search, replacement)
      }
    }

    try {
      await fixture.send({
        ...message,
        capability: {
          ...capability,
          signature: duckTypedSignature as unknown as string
        }
      })

      expect(verifySpy).not.toHaveBeenCalled()
      expect(fixture.handler).not.toHaveBeenCalled()
    } finally {
      verifySpy.mockRestore()
    }
  })

  it("rejects coercible non-string payloads before parsing same-window messages", async () => {
    const fixture = await createCapabilityFixture()
    const message = commandMessage("capability-request-duck-payload")
    const capability = await fixture.sign(message)
    const coerciblePayload = [capability.payload]
    expect(JSON.parse(coerciblePayload as unknown as string)).toMatchObject({
      command: message.command,
      requestId: message.requestId
    })
    const parseSpy = vi.spyOn(JSON, "parse")

    try {
      await fixture.send({
        ...message,
        capability: {
          ...capability,
          payload: structuredClone(coerciblePayload) as unknown as string
        }
      })

      expect(parseSpy).not.toHaveBeenCalled()
      expect(fixture.handler).not.toHaveBeenCalled()
    } finally {
      parseSpy.mockRestore()
    }
  })

  it("rejects calendar dates that JavaScript would normalize into another day", async () => {
    const fixture = await createCapabilityFixture()

    expect(fixture.host.dateRangeBounds({ from: "2025-02-29" })).toMatchObject({
      valid: false
    })
  })

  it("omits the optional sync token when a provider result has none", async () => {
    const fixture = await createCapabilityFixture()

    fixture.host.postResult("getAllMediaItems", "result-without-token", [])
    const result = fixture.messages[0] as Record<string, unknown>

    expect(Object.hasOwn(result, "providerSyncToken")).toBe(false)
  })
})
