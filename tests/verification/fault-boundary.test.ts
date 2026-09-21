import { beforeAll, describe, expect, it, vi } from "vitest"

import { DuplicateReviewSession } from "../../lib/duplicate-review-session"
import {
  TrashLifecycle,
  type TrashAuditAdapter
} from "../../lib/trash-lifecycle"
import {
  getProviderCommandPublicKey,
  providerCommandCapabilityPayload,
  withProviderCommandCapability
} from "../../lib/provider-command-capability"
import type { DuplicateGroup, GpdMediaItem } from "../../lib/types"

type FakeWindow = {
  __GPD_COMMAND_HOST__?: unknown
  __GPD_COMMAND_HOST_TEST_AUTH__?: boolean
  location?: {
    protocol?: string
    hostname?: string
  }
  addEventListener: (
    type: string,
    listener: (event: { source: unknown; data: unknown }) => unknown
  ) => void
  postMessage: (message: unknown) => void
}

type CommandHost = {
  postResult: (command: string, requestId: string, data: unknown) => void
  register: (params: {
    handlers: Record<
      string,
      (requestId: string, args: unknown) => Promise<void>
    >
    unsupportedMessage: (command: string) => string
  }) => void
}

let createCommandHost:
  | ((targetWindow: FakeWindow, publicKey?: JsonWebKey) => CommandHost)
  | undefined
let readPublicKeyFromCurrentScript:
  | ((targetWindow: FakeWindow) => JsonWebKey | undefined)
  | undefined

beforeAll(async () => {
  const testGlobals = globalThis as typeof globalThis & {
    __GPD_COMMAND_HOST_TEST_MODE__?: boolean
    __GPD_COMMAND_HOST_TEST_FACTORY__?: (
      targetWindow: FakeWindow,
      publicKey?: JsonWebKey
    ) => CommandHost
    __GPD_COMMAND_HOST_TEST_READ_PUBLIC_KEY__?: (
      targetWindow: FakeWindow
    ) => JsonWebKey | undefined
  }
  testGlobals.__GPD_COMMAND_HOST_TEST_MODE__ = true
  delete testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
  const publicKey = await getProviderCommandPublicKey()
  const targetWindow = window as Window & {
    __GPD_COMMAND_HOST__?: unknown
    __GPD_COMMAND_TEST_MODE__?: boolean
  }
  const previousHost = targetWindow.__GPD_COMMAND_HOST__
  const previousTestMode = targetWindow.__GPD_COMMAND_TEST_MODE__
  const previousNodeEnvironment = process.env.NODE_ENV
  delete targetWindow.__GPD_COMMAND_HOST__
  delete targetWindow.__GPD_COMMAND_TEST_MODE__
  process.env.NODE_ENV = "production"
  const script = document.createElement("script")
  script.src =
    `chrome-extension://test/scripts/photo-provider-command-host.js?publicKey=` +
    encodeURIComponent(JSON.stringify(publicKey))
  const currentScriptDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "currentScript"
  )
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script
  })
  // Import the production script through Vitest so mutation instrumentation
  // observes the same message gate that the browser receives. The query keeps
  // this factory-bearing module independent from side-effect imports in the
  // provider command tests.
    try {
      // @ts-expect-error Vite's test-only module query is resolved at runtime.
      await import("../../scripts/photo-provider-command-host.js?direct-test")
  } finally {
    if (previousNodeEnvironment === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = previousNodeEnvironment
    }
    if (previousTestMode === undefined) {
      delete targetWindow.__GPD_COMMAND_TEST_MODE__
    } else {
      targetWindow.__GPD_COMMAND_TEST_MODE__ = previousTestMode
    }
    if (currentScriptDescriptor) {
      Object.defineProperty(document, "currentScript", currentScriptDescriptor)
    } else {
      delete (document as Document & { currentScript?: Element }).currentScript
    }
  }
  expect(targetWindow.__GPD_COMMAND_HOST__).toBeTypeOf("object")
  if (previousHost !== undefined) {
    targetWindow.__GPD_COMMAND_HOST__ = previousHost
  }
  globalThis.dispatchEvent(new Event("gpd-command-host-test"))
  createCommandHost = testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
  readPublicKeyFromCurrentScript =
    testGlobals.__GPD_COMMAND_HOST_TEST_READ_PUBLIC_KEY__
  expect(createCommandHost).toBeTypeOf("function")
  expect(readPublicKeyFromCurrentScript).toBeTypeOf("function")

  const parserDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "currentScript"
  )
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script
  })
  expect(
    readPublicKeyFromCurrentScript?.(window as unknown as FakeWindow)
  ).toEqual(publicKey)
  if (parserDescriptor) {
    Object.defineProperty(document, "currentScript", parserDescriptor)
  } else {
    delete (document as Document & { currentScript?: Element }).currentScript
  }
})

function commandHostFixture(options: {
  authenticate?: boolean
  publicKey?: JsonWebKey
  location?: FakeWindow["location"]
} = {}) {
  const listeners: Array<
    (event: { source: unknown; data: unknown }) => unknown
  > = []
  const posted: unknown[] = []
  const fakeWindow = {
    __GPD_COMMAND_HOST__: undefined as unknown,
    __GPD_COMMAND_HOST_TEST_AUTH__: options.authenticate,
    location: options.location,
    addEventListener(
      type: string,
      listener: (event: { source: unknown; data: unknown }) => unknown
    ) {
      if (type === "message") listeners.push(listener)
    },
    postMessage(message: unknown) {
      posted.push(message)
    }
  }
  if (!createCommandHost) {
    throw new Error("Command-host factory was not initialized")
  }
  const host = createCommandHost(fakeWindow, options.publicKey)
  return {
    host,
    source: fakeWindow,
    dispatch: async (event: { source: unknown; data: unknown }) => {
      for (const listener of listeners) await listener(event)
    },
    posted
  }
}

function lifecycleFixture(failingAudit = false) {
  const mediaItems: Record<string, GpdMediaItem> = {
    keep: {
      mediaKey: "keep",
      dedupKey: "keep-dedup",
      thumb: "keep",
      timestamp: 1,
      creationTimestamp: 1,
      provider: "google"
    },
    trash: {
      mediaKey: "trash",
      dedupKey: "trash-dedup",
      thumb: "trash",
      timestamp: 1,
      creationTimestamp: 1,
      provider: "google"
    }
  }
  const groups: DuplicateGroup[] = [
    {
      id: "fault-group",
      mediaKeys: ["keep", "trash"],
      originalMediaKey: "keep",
      similarity: 1
    }
  ]
  const reviewSession = new DuplicateReviewSession({
    groups,
    mediaItems,
    selections: {
      selectedGroupIds: new Set(["fault-group"]),
      reviewedGroupIds: new Set(["fault-group"]),
      keptOverrides: { "fault-group": new Set(["keep"]) }
    }
  })
  const audit: TrashAuditAdapter = {
    async savePreTrashReport() {
      if (failingAudit) throw new Error("pre-trash audit unavailable")
    },
    async saveTrashResultReport() {}
  }
  return {
    lifecycle: new TrashLifecycle(audit),
    plan: {
      provider: "google" as const,
      dedupKeys: ["trash-dedup"],
      mediaKeysToTrash: ["trash"],
      blockedMediaKeys: [],
      blockedGroupIds: []
    },
    groups,
    mediaItems,
    reviewSession
  }
}

async function begin(fixture: ReturnType<typeof lifecycleFixture>) {
  return fixture.lifecycle.begin({
    plan: fixture.plan,
    reviewSession: fixture.reviewSession,
    groups: fixture.groups,
    snapshot: {
      mediaItems: fixture.mediaItems,
      groups: fixture.groups,
      totalItems: 2
    },
    batchPolicy: {
      batchSize: 25,
      batchPauseMs: 0,
      retryCount: 0,
      retryBackoffMs: 0
    }
  })
}

describe("provider fault and message boundaries", () => {
  it("SAFE-10 never enables unsigned commands for a provider origin", async () => {
    const previousNodeEnvironment = process.env.NODE_ENV
    process.env.NODE_ENV = "test" as typeof process.env.NODE_ENV
    const fixture = commandHostFixture({
      location: { protocol: "https:", hostname: "photos.google.com" }
    })
    let dispatches = 0
    fixture.host.register({
      handlers: {
        healthCheck: async () => {
          dispatches += 1
        }
      },
      unsupportedMessage: (command) => `unsupported ${command}`
    })

    try {
      await fixture.dispatch({
        source: fixture.source,
        data: {
          app: "GPD",
          action: "gptkCommand",
          command: "healthCheck",
          requestId: "provider-origin-unsigned",
          args: {}
        }
      })
      expect(dispatches).toBe(0)
    } finally {
      if (previousNodeEnvironment === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnvironment
      }
    }
  })

  it("exposes the test factory only when the explicit opt-in event is handled", async () => {
    const testGlobals = globalThis as typeof globalThis & {
      __GPD_COMMAND_HOST_TEST_MODE__?: boolean
      __GPD_COMMAND_HOST_TEST_FACTORY__?: (
        targetWindow: FakeWindow,
        publicKey?: JsonWebKey
      ) => CommandHost
    }
    const previousMode = testGlobals.__GPD_COMMAND_HOST_TEST_MODE__
    const previousFactory = testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
    const addEventListenerSpy = vi.spyOn(globalThis, "addEventListener")

    try {
      testGlobals.__GPD_COMMAND_HOST_TEST_MODE__ = true
      delete testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
      // @ts-expect-error Vite resolves this test-only module query.
      await import("../../scripts/photo-provider-command-host.js?isolated-hook")
      const hook = addEventListenerSpy.mock.calls
        .filter(([type]) => type === "gpd-command-host-test")
        .at(-1)?.[1]
      expect(hook).toBeTypeOf("function")
      if (typeof hook !== "function") throw new Error("test hook was not registered")

      hook(new Event("gpd-command-host-test"))
      expect(testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__).toBeTypeOf("function")
    } finally {
      addEventListenerSpy.mockRestore()
      testGlobals.__GPD_COMMAND_HOST_TEST_MODE__ = previousMode
      if (previousFactory) {
        testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__ = previousFactory
      } else {
        delete testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
      }
    }
  })

  it("SAFE-10 fails closed for malformed injected public-key configuration", async () => {
    const invalidValues = [
      "%",
      "null",
      JSON.stringify({ kty: "RSA", crv: "P-256", x: "x", y: "y" }),
      JSON.stringify({ kty: "EC", crv: "P-384", x: "x", y: "y" }),
      JSON.stringify({ kty: "EC", crv: "P-256", x: 1, y: "y" }),
      JSON.stringify({ kty: "EC", crv: "P-256", x: "x", y: 1 })
    ]
    const descriptor = Object.getOwnPropertyDescriptor(
      document,
      "currentScript"
    )
    const targetWindow = window as Window & {
      __GPD_COMMAND_HOST__?: unknown
    }
    const previousHost = targetWindow.__GPD_COMMAND_HOST__
    const previousNodeEnvironment = process.env.NODE_ENV
    try {
      delete targetWindow.__GPD_COMMAND_HOST__
      process.env.NODE_ENV = "production"
      for (const [index, value] of invalidValues.entries()) {
        const script = document.createElement("script")
        script.src =
          `chrome-extension://test/scripts/photo-provider-command-host.js?publicKey=` +
          (value === "%" ? "%25" : encodeURIComponent(value)) +
          `&invalid=${index}`
        Object.defineProperty(document, "currentScript", {
          configurable: true,
          get: () => script
        })
        const invalidModuleImports = [
          // @ts-expect-error Vite resolves this test-only module query.
          () => import("../../scripts/photo-provider-command-host.js?invalid-key-0"),
          // @ts-expect-error Vite resolves this test-only module query.
          () => import("../../scripts/photo-provider-command-host.js?invalid-key-1"),
          // @ts-expect-error Vite resolves this test-only module query.
          () => import("../../scripts/photo-provider-command-host.js?invalid-key-2"),
          // @ts-expect-error Vite resolves this test-only module query.
          () => import("../../scripts/photo-provider-command-host.js?invalid-key-3"),
          // @ts-expect-error Vite resolves this test-only module query.
          () => import("../../scripts/photo-provider-command-host.js?invalid-key-4"),
          // @ts-expect-error Vite resolves this test-only module query.
          () => import("../../scripts/photo-provider-command-host.js?invalid-key-5")
        ]
        await invalidModuleImports[index]()
        expect(targetWindow.__GPD_COMMAND_HOST__).toBeUndefined()
      }
    } finally {
      if (previousNodeEnvironment === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnvironment
      }
      if (previousHost === undefined) {
        delete targetWindow.__GPD_COMMAND_HOST__
      } else {
        targetWindow.__GPD_COMMAND_HOST__ = previousHost
      }
      if (descriptor) {
        Object.defineProperty(document, "currentScript", descriptor)
      } else {
        delete (document as Document & { currentScript?: Element }).currentScript
      }
    }
  })

  it("SAFE-10 ignores foreign, malformed, and wrong-app page messages", async () => {
    const fixture = commandHostFixture()
    let dispatches = 0
    fixture.host.register({
      handlers: {
        trashItems: async (requestId, args) => {
          dispatches += 1
          fixture.host.postResult("trashItems", requestId, { args })
        },
        healthCheck: async (requestId) => {
          dispatches += 1
          fixture.host.postResult("healthCheck", requestId, { ok: true })
        }
      },
      unsupportedMessage: (command) => `unsupported ${command}`
    })

    await fixture.dispatch({
      source: {},
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "trashItems",
        requestId: "foreign",
        args: {}
      }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "OTHER",
        action: "gptkCommand",
        command: "trashItems",
        requestId: "wrong-app",
        args: {}
      }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "wrongAction",
        command: "trashItems",
        requestId: "wrong-action",
        args: {}
      }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "trashItems",
        args: {}
      }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "",
        requestId: "empty-command",
        args: {}
      }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "trashItems",
        requestId: "",
        args: {}
      }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: ["GPD", "gptkCommand", "trashItems"]
    })
    await fixture.dispatch({ source: fixture.source, data: null })
    await Promise.resolve()

    expect(dispatches).toBe(0)
    expect(fixture.posted).toEqual([])

    // A valid request proves that the fixture observes the registered handler
    // and is not passing solely because every message was ignored.
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "healthCheck",
        requestId: "control-request",
        args: {}
      }
    })
    await Promise.resolve()
    expect(dispatches).toBe(1)
    expect(fixture.posted).toEqual([
      {
        app: "GPD",
        action: "gptkResult",
        command: "healthCheck",
        requestId: "control-request",
        success: true,
        data: { ok: true }
      }
    ])
  })

  it("SAFE-10 keeps duplicate host loads singleton and rejects prototype commands", async () => {
    const fixture = commandHostFixture()
    expect(createCommandHost?.(fixture.source as FakeWindow)).toBe(fixture.host)
    fixture.host.register({
      handlers: {},
      unsupportedMessage: (command) => `unsupported ${command}`
    })

    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "constructor",
        requestId: "prototype-command",
        args: {}
      }
    })
    await Promise.resolve()

    expect(fixture.posted).toEqual([
      {
        app: "GPD",
        action: "gptkResult",
        command: "constructor",
        requestId: "prototype-command",
        success: false,
        error: "unsupported constructor"
      }
    ])
  })

  it("SAFE-10 verifies runtime capabilities before dispatching page commands", async () => {
    const publicKey = await getProviderCommandPublicKey()
    const fixture = commandHostFixture({
      authenticate: true,
      publicKey
    })
    let dispatches = 0
    fixture.host.register({
      handlers: {
        healthCheck: async (requestId) => {
          dispatches += 1
          fixture.host.postResult("healthCheck", requestId, { ok: true })
        }
      },
      unsupportedMessage: (command) => `unsupported ${command}`
    })

    const signed = await withProviderCommandCapability({
      app: "GPD",
      action: "gptkCommand",
      command: "healthCheck",
      requestId: "runtime-capability",
      args: {
        values: [null, false, true, 2, Number.NaN, undefined],
        nested: { value: "ok" },
        undefinedField: undefined
      },
      provider: "google"
    })
    const signedProviderFallback = await withProviderCommandCapability({
      app: "GPD",
      action: "gptkCommand",
      command: "healthCheck",
      requestId: "runtime-provider-fallback",
      args: {},
      provider: "google"
    })
    const exactTtlMessage = await withProviderCommandCapability({
      app: "GPD",
      action: "gptkCommand",
      command: "healthCheck",
      requestId: "runtime-exact-ttl",
      args: {},
      provider: "google"
    })
    const payloadBindingMessage = await withProviderCommandCapability({
      app: "GPD",
      action: "gptkCommand",
      command: "healthCheck",
      requestId: "runtime-args-binding",
      args: { original: true },
      provider: "google"
    })
    const providerFallback = {
      ...signedProviderFallback,
      provider: undefined
    }
    const expiredNow = Date.now()
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(expiredNow - 120_000)
    const expired = await withProviderCommandCapability({
      app: "GPD",
      action: "gptkCommand",
      command: "healthCheck",
      requestId: "runtime-expired",
      args: {},
      provider: "google"
    })
    dateNowSpy.mockRestore()

    const signedPayload = JSON.parse(signed.capability!.payload) as Record<
      string,
      unknown
    >
    const invalidPayloads = [
      null,
      { ...signedPayload, app: "OTHER" },
      { ...signedPayload, action: "wrongAction" },
      { ...signedPayload, command: "otherCommand" },
      { ...signedPayload, requestId: "otherRequest" },
      { ...signedPayload, provider: "amazon" },
      { ...signedPayload, issuedAt: null },
      { ...signedPayload, nonce: 123 },
      { ...signedPayload, nonce: "short" },
      { ...signedPayload, nonce: `${signedPayload.nonce}-changed` }
    ]
    await fixture.dispatch({
      source: fixture.source,
      data: { ...signed, capability: undefined }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: { ...signed, capability: {} }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        ...signed,
        capability: { payload: 1, signature: "AA" }
      }
    })
    await fixture.dispatch({ source: fixture.source, data: signed })
    await fixture.dispatch({ source: fixture.source, data: signed })
    await fixture.dispatch({ source: fixture.source, data: providerFallback })
    const exactTtlIssuedAt = JSON.parse(
      exactTtlMessage.capability!.payload
    ).issuedAt as number
    const exactTtlNowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue(exactTtlIssuedAt + 60_000)
    await fixture.dispatch({
      source: fixture.source,
      data: exactTtlMessage
    })
    exactTtlNowSpy.mockRestore()
    await fixture.dispatch({ source: fixture.source, data: expired })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        ...signed,
        capability: { payload: "not-json", signature: "AA" }
      }
    })
    for (const payload of invalidPayloads) {
      await fixture.dispatch({
        source: fixture.source,
        data: {
          ...signed,
          capability: {
            payload: JSON.stringify(payload),
            signature: "AA"
          }
        }
      })
    }
    await fixture.dispatch({
      source: fixture.source,
      data: { ...payloadBindingMessage, args: { altered: true } }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        ...signed,
        capability: {
          ...signed.capability!,
          signature: `${signed.capability!.signature.slice(0, -1)}A`
        }
      }
    })
    await Promise.resolve()

    expect(dispatches).toBe(3)
    expect(fixture.posted).toEqual([
      {
        app: "GPD",
        action: "gptkResult",
        command: "healthCheck",
        requestId: "runtime-capability",
        success: true,
        data: { ok: true }
      },
      {
        app: "GPD",
        action: "gptkResult",
        command: "healthCheck",
        requestId: "runtime-provider-fallback",
        success: true,
        data: { ok: true }
      },
      {
        app: "GPD",
        action: "gptkResult",
        command: "healthCheck",
        requestId: "runtime-exact-ttl",
        success: true,
        data: { ok: true }
      }
    ])
  })

  it("SAFE-10 bounds accepted capability nonces while preserving recent replay protection", async () => {
    const publicKey = await getProviderCommandPublicKey()
    const fixture = commandHostFixture({
      authenticate: true,
      publicKey
    })
    let dispatches = 0
    fixture.host.register({
      handlers: {
        healthCheck: async () => {
          dispatches += 1
        }
      },
      unsupportedMessage: (command) => `unsupported ${command}`
    })

    const verifySpy = vi
      .spyOn(crypto.subtle, "verify")
      .mockResolvedValue(true)
    const issuedAt = Date.now()
    const messages = Array.from({ length: 513 }, (_, index) => {
      const requestId = `nonce-boundary-${index}`
      const nonce = `nonce-${String(index).padStart(14, "0")}`
      const message = {
        app: "GPD" as const,
        action: "gptkCommand" as const,
        command: "healthCheck",
        requestId,
        args: {},
        provider: "google" as const
      }
      return {
        ...message,
        capability: {
          payload: providerCommandCapabilityPayload({
            message,
            issuedAt,
            nonce
          }),
          signature: "AA"
        }
      }
    })

    try {
      for (const message of messages.slice(0, 512)) {
        await fixture.dispatch({ source: fixture.source, data: message })
      }
      expect(dispatches).toBe(512)

      await fixture.dispatch({
        source: fixture.source,
        data: messages[0]
      })
      expect(dispatches).toBe(512)

      await fixture.dispatch({
        source: fixture.source,
        data: messages[512]
      })
      expect(dispatches).toBe(513)

      await fixture.dispatch({
        source: fixture.source,
        data: messages[0]
      })
      expect(dispatches).toBe(514)
    } finally {
      verifySpy.mockRestore()
    }
  })

  it("SAFE-10 fails closed on verifier errors and accepts URL-safe signature bytes", async () => {
    const publicKey = await getProviderCommandPublicKey()
    const fixture = commandHostFixture({
      authenticate: true,
      publicKey
    })
    let dispatches = 0
    fixture.host.register({
      handlers: {
        healthCheck: async () => {
          dispatches += 1
        }
      },
      unsupportedMessage: (command) => `unsupported ${command}`
    })

    const urlSafeBase64Message = await withProviderCommandCapability({
      app: "GPD",
      action: "gptkCommand",
      command: "healthCheck",
      requestId: "url-safe-signature",
      args: {},
      provider: "google"
    })
    const verifierErrorMessage = await withProviderCommandCapability({
      app: "GPD",
      action: "gptkCommand",
      command: "healthCheck",
      requestId: "verifier-error",
      args: {},
      provider: "google"
    })
    const verifySpy = vi
      .spyOn(crypto.subtle, "verify")
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("verification unavailable"))

    try {
      await fixture.dispatch({
        source: fixture.source,
        data: {
          ...urlSafeBase64Message,
          capability: {
            ...urlSafeBase64Message.capability!,
            signature: "__8"
          }
        }
      })
      expect(
        Array.from(verifySpy.mock.calls[0]?.[2] as Uint8Array)
      ).toEqual([255, 255])
      await fixture.dispatch({
        source: fixture.source,
        data: verifierErrorMessage
      })
      expect(dispatches).toBe(1)
    } finally {
      verifySpy.mockRestore()
    }
  })

  it("SAFE-10 rejects unsupported commands while preserving the request envelope", async () => {
    const fixture = commandHostFixture()
    fixture.host.register({
      handlers: {},
      unsupportedMessage: (command) => `unsupported ${command}`
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "eraseEverything",
        requestId: "request-1",
        args: { secret: "must-not-dispatch" }
      }
    })
    await Promise.resolve()

    expect(fixture.posted).toEqual([
      {
        app: "GPD",
        action: "gptkResult",
        command: "eraseEverything",
        requestId: "request-1",
        success: false,
        error: "unsupported eraseEverything"
      }
    ])
  })

  it("SAFE-03 treats a successful provider envelope without confirmed identities as unknown", async () => {
    const fixture = lifecycleFixture()
    await begin(fixture)
    const outcome = await fixture.lifecycle.reconcile({
      success: true,
      data: {}
    })
    expect(outcome.kind).toBe("failed")
    expect(outcome.movedCount).toBe(0)
    expect(outcome.undo).toBeNull()
  })

  it("SAFE-07 keeps failed audit and reset replies from reaching a provider command", async () => {
    const auditFailure = lifecycleFixture(true)
    await expect(begin(auditFailure)).rejects.toThrow(
      "pre-trash audit unavailable"
    )
    const afterFailure = await auditFailure.lifecycle.reconcile({
      success: true,
      data: { trashedKeys: ["trash"], trashedDedupKeys: ["trash-dedup"] }
    })
    expect(afterFailure.movedCount).toBe(0)

    const resetFixture = lifecycleFixture()
    await begin(resetFixture)
    resetFixture.lifecycle.reset()
    const afterReset = await resetFixture.lifecycle.reconcile({
      success: true,
      data: { trashedKeys: ["trash"], trashedDedupKeys: ["trash-dedup"] }
    })
    expect(afterReset.movedCount).toBe(0)
    expect(afterReset.undo).toBeNull()
  })
})
