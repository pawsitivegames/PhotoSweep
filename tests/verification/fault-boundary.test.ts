import { beforeEach, describe, expect, it, vi } from "vitest"

import { DuplicateReviewSession } from "../../lib/duplicate-review-session"
import {
  getProviderCommandPublicKey,
  providerCommandCapabilityPayload,
  withProviderCommandCapability
} from "../../lib/provider-command-capability"
import {
  TrashLifecycle,
  type TrashAuditAdapter,
  type TrashOutcome
} from "../../lib/trash-lifecycle"
import type { DuplicateGroup, GpdMediaItem } from "../../lib/types"

function expectUnknownOutcome(
  outcome: TrashOutcome
): asserts outcome is Extract<TrashOutcome, { kind: "unknown" }> {
  expect(outcome.kind).toBe("unknown")
  if (outcome.kind !== "unknown") {
    throw new Error(`Expected unknown TrashOutcome, received "${outcome.kind}"`)
  }
}

type FakeWindow = {
  __GPD_COMMAND_HOST__?: unknown
  __GPD_COMMAND_HOST_TEST_AUTH__?: boolean
  __GPD_PROVIDER_SESSION_ID__?: string
  location?: {
    protocol?: string
    hostname?: string
    origin?: string
  }
  top?: Pick<FakeWindow, "location" | "__GPD_PROVIDER_SESSION_ID__">
  addEventListener: (
    type: string,
    listener: (event: { source: unknown; data: unknown }) => unknown
  ) => void
  postMessage: (message: unknown) => void
}

type CommandHost = {
  providerSessionId: string
  postResult: (command: string, requestId: string, data: unknown) => void
  register: (params: {
    handlers?: Record<
      string,
      (requestId: string, args: unknown, signal?: AbortSignal) => Promise<void>
    > | null
    unsupportedMessage?: (command: string) => string
  }) => void
}

let createCommandHost:
  | ((targetWindow: FakeWindow, publicKey?: JsonWebKey) => CommandHost)
  | undefined
let readPublicKeyFromCurrentScript:
  | ((targetWindow: FakeWindow) => JsonWebKey | undefined)
  | undefined
let isLocalTestEnvironmentForTest:
  | ((targetWindow: FakeWindow) => boolean)
  | undefined
let commandHostTestHook: EventListener | undefined

beforeEach(async () => {
  vi.resetModules()
  const testGlobals = globalThis as typeof globalThis & {
    __GPD_COMMAND_HOST_TEST_MODE__?: boolean
    __GPD_COMMAND_HOST_TEST_FACTORY__?: (
      targetWindow: FakeWindow,
      publicKey?: JsonWebKey
    ) => CommandHost
    __GPD_COMMAND_HOST_TEST_READ_PUBLIC_KEY__?: (
      targetWindow: FakeWindow
    ) => JsonWebKey | undefined
    __GPD_COMMAND_HOST_TEST_IS_LOCAL_ENVIRONMENT__?: (
      targetWindow: FakeWindow
    ) => boolean
  }
  testGlobals.__GPD_COMMAND_HOST_TEST_MODE__ = true
  delete testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
  delete testGlobals.__GPD_COMMAND_HOST_TEST_READ_PUBLIC_KEY__
  delete testGlobals.__GPD_COMMAND_HOST_TEST_IS_LOCAL_ENVIRONMENT__
  const addEventListenerSpy = vi.spyOn(globalThis, "addEventListener")
  const publicKey = await getProviderCommandPublicKey()
  const targetWindow = window as Window & {
    __GPD_COMMAND_HOST__?: unknown
    __GPD_COMMAND_TEST_MODE__?: boolean
  }
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
  // Import the production script through Vitest on every test setup so each
  // mutation run executes a fresh copy of the main-world command host.
  try {
    // @ts-expect-error Vite resolves this JavaScript module in the test bundle.
    await import("../../scripts/photo-provider-command-host.js")
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
  const hook = addEventListenerSpy.mock.calls
    .filter(([type]) => type === "gpd-command-host-test")
    .at(-1)?.[1]
  addEventListenerSpy.mockRestore()
  expect(hook).toBeTypeOf("function")
  if (typeof hook !== "function") {
    throw new Error("command-host test hook was not registered")
  }
  commandHostTestHook = hook as EventListener
  globalThis.removeEventListener("gpd-command-host-test", commandHostTestHook)
  commandHostTestHook(new Event("gpd-command-host-test"))
  createCommandHost = testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
  readPublicKeyFromCurrentScript =
    testGlobals.__GPD_COMMAND_HOST_TEST_READ_PUBLIC_KEY__
  isLocalTestEnvironmentForTest =
    testGlobals.__GPD_COMMAND_HOST_TEST_IS_LOCAL_ENVIRONMENT__
  expect(createCommandHost).toBeTypeOf("function")
  expect(readPublicKeyFromCurrentScript).toBeTypeOf("function")
  expect(isLocalTestEnvironmentForTest).toBeTypeOf("function")

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

function commandHostFixture(
  options: {
    authenticate?: boolean
    publicKey?: JsonWebKey
    location?: FakeWindow["location"]
    top?: Pick<FakeWindow, "location" | "__GPD_PROVIDER_SESSION_ID__">
  } = {}
) {
  const listeners: Array<
    (event: { source: unknown; data: unknown }) => unknown
  > = []
  const posted: unknown[] = []
  const fakeWindow = {
    __GPD_COMMAND_HOST__: undefined as unknown,
    __GPD_COMMAND_HOST_TEST_AUTH__: options.authenticate,
    __GPD_PROVIDER_SESSION_ID__: undefined as string | undefined,
    location: options.location,
    top: options.top,
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

function validScanArgs(fixture: ReturnType<typeof commandHostFixture>) {
  return {
    scanScopeFingerprint: "fault-boundary-scan",
    providerSessionId: fixture.host.providerSessionId
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
      provider: "google",
      favoriteStatus: "not-favorite",
      favoriteSource: "provider-metadata"
    },
    trash: {
      mediaKey: "trash",
      dedupKey: "trash-dedup",
      thumb: "trash",
      timestamp: 1,
      creationTimestamp: 1,
      provider: "google",
      favoriteStatus: "not-favorite",
      favoriteSource: "provider-metadata"
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

  it("SAFE-10 handles missing process and null location globals fail-closed", async () => {
    const previousProcess = process
    vi.stubGlobal("process", undefined)
    try {
      const fixture = commandHostFixture({
        location: null as unknown as FakeWindow["location"]
      })
      let dispatches = 0
      fixture.host.register({
        handlers: {
          healthCheck: async () => {
            dispatches += 1
          }
        }
      })

      await fixture.dispatch({
        source: fixture.source,
        data: {
          app: "GPD",
          action: "gptkCommand",
          command: "healthCheck",
          requestId: "missing-runtime-globals",
          args: {}
        }
      })

      expect(dispatches).toBe(0)
      expect(fixture.posted).toEqual([])
    } finally {
      vi.stubGlobal("process", previousProcess)
    }
  })

  it("SAFE-10 shares immutable provider-session identity across same-origin frames", () => {
    const origin = "https://photos.example"
    const topWindow: Pick<
      FakeWindow,
      "location" | "__GPD_PROVIDER_SESSION_ID__"
    > = { location: { origin } }
    let randomCallCount = 0
    const randomValues = vi
      .spyOn(crypto, "getRandomValues")
      .mockImplementation((array) => {
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(
          ++randomCallCount
        )
        return array
      })

    try {
      const firstFrame = commandHostFixture({
        location: { protocol: "https:", hostname: "photos.example", origin },
        top: topWindow
      })
      const secondFrame = commandHostFixture({
        location: { protocol: "https:", hostname: "photos.example", origin },
        top: topWindow
      })
      const descriptor = Object.getOwnPropertyDescriptor(
        topWindow,
        "__GPD_PROVIDER_SESSION_ID__"
      )

      expect(firstFrame.host.providerSessionId).toBe("01".repeat(16))
      expect(secondFrame.host.providerSessionId).toBe(
        firstFrame.host.providerSessionId
      )
      expect(randomValues).toHaveBeenCalledOnce()
      expect(descriptor).toMatchObject({
        get: expect.any(Function),
        set: undefined,
        configurable: false,
        enumerable: false
      })
    } finally {
      randomValues.mockRestore()
    }
  })

  it("SAFE-10 keeps a frame-local provider session when its top frame is cross-origin", () => {
    const crossOriginTop = Object.defineProperties(
      {},
      {
        location: {
          get() {
            throw new Error("cross-origin access denied")
          }
        }
      }
    ) as FakeWindow
    const fixture = commandHostFixture({
      location: {
        protocol: "https:",
        hostname: "photos.example",
        origin: "https://photos.example"
      },
      top: crossOriginTop
    })

    expect(fixture.source.__GPD_PROVIDER_SESSION_ID__).toBe(
      fixture.host.providerSessionId
    )
    expect(crossOriginTop.__GPD_PROVIDER_SESSION_ID__).toBeUndefined()
  })

  it("exposes the test factory only when the explicit opt-in event is handled", () => {
    const testGlobals = globalThis as typeof globalThis & {
      __GPD_COMMAND_HOST_TEST_MODE__?: boolean
      __GPD_COMMAND_HOST_TEST_FACTORY__?: (
        targetWindow: FakeWindow,
        publicKey?: JsonWebKey
      ) => CommandHost
    }
    const previousMode = testGlobals.__GPD_COMMAND_HOST_TEST_MODE__
    const previousFactory = testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
    try {
      testGlobals.__GPD_COMMAND_HOST_TEST_MODE__ = false
      delete testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
      expect(commandHostTestHook).toBeTypeOf("function")
      if (!commandHostTestHook) {
        throw new Error("test hook was not registered")
      }
      commandHostTestHook(new Event("gpd-command-host-test"))
      expect(testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__).toBeUndefined()

      testGlobals.__GPD_COMMAND_HOST_TEST_MODE__ = true
      delete testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
      commandHostTestHook(new Event("gpd-command-host-test"))
      expect(testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__).toBeTypeOf(
        "function"
      )
    } finally {
      testGlobals.__GPD_COMMAND_HOST_TEST_MODE__ = previousMode
      if (previousFactory) {
        testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__ = previousFactory
      } else {
        delete testGlobals.__GPD_COMMAND_HOST_TEST_FACTORY__
      }
    }
  })

  it("classifies missing and unusual locations without reading absent properties", () => {
    if (!isLocalTestEnvironmentForTest) {
      throw new Error("Local-environment test helper was not initialized")
    }
    const previousNodeEnvironment = process.env.NODE_ENV
    process.env.NODE_ENV = "test" as typeof process.env.NODE_ENV
    try {
      const targetWindow = {
        addEventListener() {},
        postMessage() {}
      } as FakeWindow
      expect(isLocalTestEnvironmentForTest(targetWindow)).toBe(true)
      expect(
        isLocalTestEnvironmentForTest({
          ...targetWindow,
          location: null
        } as unknown as FakeWindow)
      ).toBe(true)
      expect(
        isLocalTestEnvironmentForTest({
          ...targetWindow,
          location: { protocol: "https:", hostname: "photos.google.com" }
        })
      ).toBe(false)
      expect(
        isLocalTestEnvironmentForTest({
          ...targetWindow,
          location: { protocol: "about:", hostname: "" }
        })
      ).toBe(true)
    } finally {
      if (previousNodeEnvironment === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnvironment
      }
    }
  })

  it("returns only a validated P-256 public key and fails closed on script access errors", async () => {
    const publicKey = await getProviderCommandPublicKey()
    const descriptor = Object.getOwnPropertyDescriptor(
      document,
      "currentScript"
    )
    const targetWindow = window as unknown as FakeWindow
    const readKey = (key: unknown) => {
      const script = document.createElement("script")
      script.src =
        `chrome-extension://test/scripts/photo-provider-command-host.js?publicKey=` +
        encodeURIComponent(JSON.stringify(key))
      Object.defineProperty(document, "currentScript", {
        configurable: true,
        get: () => script
      })
      return readPublicKeyFromCurrentScript?.(targetWindow)
    }

    try {
      expect(readKey(publicKey)).toEqual({
        kty: "EC",
        x: publicKey.x,
        y: publicKey.y,
        crv: "P-256"
      })
      for (const invalid of [
        { ...publicKey, kty: "RSA" },
        { ...publicKey, crv: "P-384" },
        { ...publicKey, x: 1 },
        { ...publicKey, y: 1 }
      ]) {
        expect(readKey(invalid)).toBeUndefined()
      }

      Object.defineProperty(document, "currentScript", {
        configurable: true,
        get: () => {
          throw new Error("currentScript access failed")
        }
      })
      expect(readPublicKeyFromCurrentScript?.(targetWindow)).toBeUndefined()
    } finally {
      if (descriptor) {
        Object.defineProperty(document, "currentScript", descriptor)
      } else {
        delete (document as Document & { currentScript?: Element }).currentScript
      }
    }
  })

  it("keeps command-host initialization alive when a page key cannot be deleted", async () => {
    vi.resetModules()
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window")
    if (!windowDescriptor?.configurable) {
      throw new Error("The test environment must expose a configurable window global.")
    }
    const previousNodeEnvironment = process.env.NODE_ENV
    const targetWindow = {
      location: {
        protocol: "https:",
        hostname: "localhost",
        origin: "https://localhost"
      },
      addEventListener() {},
      postMessage() {}
    } as FakeWindow & { __GPD_PROVIDER_COMMAND_PUBLIC_KEY__?: JsonWebKey }
    targetWindow.top = targetWindow
    Object.defineProperty(targetWindow, "__GPD_PROVIDER_COMMAND_PUBLIC_KEY__", {
      value: {},
      configurable: false,
      enumerable: true,
      writable: false
    })

    try {
      Reflect.set(process.env, "NODE_ENV", "test")
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: targetWindow
      })
      const importResult = import(
        // @ts-expect-error Vite resolves this JavaScript module in the test bundle.
        "../../scripts/photo-provider-command-host.js"
      )
      await expect(importResult).resolves.toBeDefined()
      expect(targetWindow.__GPD_COMMAND_HOST__).toBeTypeOf("object")
    } finally {
      Object.defineProperty(globalThis, "window", windowDescriptor)
      if (previousNodeEnvironment === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnvironment
      }
    }
  })

  it("removes a configurable injected public key after host initialization", async () => {
    const publicKey = await getProviderCommandPublicKey()
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window")
    const currentScriptDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "currentScript"
    )
    if (!windowDescriptor?.configurable) {
      throw new Error("The test environment must expose a configurable window global.")
    }
    const previousNodeEnvironment = process.env.NODE_ENV
    const targetWindow = {
      location: {
        protocol: "https:",
        hostname: "photos.google.com",
        origin: "https://photos.google.com"
      },
      addEventListener() {},
      postMessage() {}
    } as FakeWindow & { __GPD_PROVIDER_COMMAND_PUBLIC_KEY__?: JsonWebKey }
    targetWindow.top = targetWindow
    Object.defineProperty(targetWindow, "__GPD_PROVIDER_COMMAND_PUBLIC_KEY__", {
      value: publicKey,
      configurable: true,
      enumerable: true,
      writable: true
    })
    const addEventListenerSpy = vi.spyOn(globalThis, "addEventListener")

    try {
      process.env.NODE_ENV = "production" as typeof process.env.NODE_ENV
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: targetWindow
      })
      Object.defineProperty(document, "currentScript", {
        configurable: true,
        get: () => null
      })
      vi.resetModules()
      // @ts-expect-error Vite resolves this JavaScript module in the test bundle.
      await import("../../scripts/photo-provider-command-host.js")

      expect(targetWindow.__GPD_COMMAND_HOST__).toBeTypeOf("object")
      expect(
        Object.hasOwn(targetWindow, "__GPD_PROVIDER_COMMAND_PUBLIC_KEY__")
      ).toBe(false)
    } finally {
      const hook = addEventListenerSpy.mock.calls
        .filter(([type]) => type === "gpd-command-host-test")
        .at(-1)?.[1]
      if (typeof hook === "function") {
        globalThis.removeEventListener("gpd-command-host-test", hook)
      }
      addEventListenerSpy.mockRestore()
      Object.defineProperty(globalThis, "window", windowDescriptor)
      if (currentScriptDescriptor) {
        Object.defineProperty(document, "currentScript", currentScriptDescriptor)
      } else {
        delete (document as Document & { currentScript?: Element }).currentScript
      }
      if (previousNodeEnvironment === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnvironment
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
        expect(
          readPublicKeyFromCurrentScript?.(targetWindow as unknown as FakeWindow)
        ).toBeUndefined()
        const invalidModuleImports = [
          () =>
            import(
              // @ts-expect-error Vite resolves this test-only module query.
              "../../scripts/photo-provider-command-host.js?invalid-key-0"
            ),
          () =>
            import(
              // @ts-expect-error Vite resolves this test-only module query.
              "../../scripts/photo-provider-command-host.js?invalid-key-1"
            ),
          () =>
            import(
              // @ts-expect-error Vite resolves this test-only module query.
              "../../scripts/photo-provider-command-host.js?invalid-key-2"
            ),
          () =>
            import(
              // @ts-expect-error Vite resolves this test-only module query.
              "../../scripts/photo-provider-command-host.js?invalid-key-3"
            ),
          () =>
            import(
              // @ts-expect-error Vite resolves this test-only module query.
              "../../scripts/photo-provider-command-host.js?invalid-key-4"
            ),
          () =>
            import(
              // @ts-expect-error Vite resolves this test-only module query.
              "../../scripts/photo-provider-command-host.js?invalid-key-5"
            )
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
        delete (document as Document & { currentScript?: Element })
          .currentScript
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
        data: { ok: true },
        providerSessionId: fixture.host.providerSessionId
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
        error: "unsupported constructor",
        providerSessionId: fixture.host.providerSessionId
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
    const dateNowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue(expiredNow - 120_000)
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
    const exactTtlIssuedAt = JSON.parse(exactTtlMessage.capability!.payload)
      .issuedAt as number
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
        data: { ok: true },
        providerSessionId: fixture.host.providerSessionId
      },
      {
        app: "GPD",
        action: "gptkResult",
        command: "healthCheck",
        requestId: "runtime-provider-fallback",
        success: true,
        data: { ok: true },
        providerSessionId: fixture.host.providerSessionId
      },
      {
        app: "GPD",
        action: "gptkResult",
        command: "healthCheck",
        requestId: "runtime-exact-ttl",
        success: true,
        data: { ok: true },
        providerSessionId: fixture.host.providerSessionId
      }
    ])
  })

  it("SAFE-10 rejects malformed nonce and timestamp fields before signature verification", async () => {
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
      }
    })
    const verifySpy = vi
      .spyOn(crypto.subtle, "verify")
      .mockResolvedValue(true)
    const issuedAt = Date.now()
    const invalidFields: Array<{
      requestId: string
      nonce: unknown
      issuedAt: unknown
    }> = [
      { requestId: "short-nonce", nonce: "n".repeat(15), issuedAt },
      { requestId: "non-string-nonce", nonce: 123, issuedAt },
      { requestId: "non-numeric-issue-time", nonce: "n".repeat(16), issuedAt: "now" }
    ]

    try {
      for (const fields of invalidFields) {
        const message = {
          app: "GPD" as const,
          action: "gptkCommand" as const,
          command: "healthCheck",
          requestId: fields.requestId,
          args: {},
          provider: "google" as const
        }
        const payload = providerCommandCapabilityPayload({
          message,
          issuedAt: fields.issuedAt as number,
          nonce: fields.nonce as string
        })
        await fixture.dispatch({
          source: fixture.source,
          data: {
            ...message,
            capability: { payload, signature: "AA" }
          }
        })
      }

      expect(verifySpy).not.toHaveBeenCalled()
      expect(dispatches).toBe(0)
      expect(fixture.posted).toEqual([])
    } finally {
      verifySpy.mockRestore()
    }
  })

  it("SAFE-10 binds the full request payload before accepting a valid signature", async () => {
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
      }
    })
    const signed = await withProviderCommandCapability({
      app: "GPD",
      action: "gptkCommand",
      command: "healthCheck",
      requestId: "tampered-request-payload",
      args: { original: true },
      provider: "google"
    })
    const verifySpy = vi
      .spyOn(crypto.subtle, "verify")
      .mockResolvedValue(true)

    try {
      await fixture.dispatch({
        source: fixture.source,
        data: { ...signed, args: { altered: true } }
      })

      expect(verifySpy).not.toHaveBeenCalled()
      expect(dispatches).toBe(0)
      expect(fixture.posted).toEqual([])
    } finally {
      verifySpy.mockRestore()
    }
  })

  it("SAFE-10 blocks a concurrent replay while the original nonce is pending", async () => {
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
      }
    })
    const signed = await withProviderCommandCapability({
      app: "GPD",
      action: "gptkCommand",
      command: "healthCheck",
      requestId: "pending-nonce-replay",
      args: {},
      provider: "google"
    })
    let resolveVerification: ((valid: boolean) => void) | undefined
    let verificationStarted: (() => void) | undefined
    const verification = new Promise<boolean>((resolve) => {
      resolveVerification = resolve
    })
    const started = new Promise<void>((resolve) => {
      verificationStarted = resolve
    })
    const verifySpy = vi
      .spyOn(crypto.subtle, "verify")
      .mockImplementation(async () => {
        verificationStarted?.()
        return verification
      })

    try {
      const first = fixture.dispatch({ source: fixture.source, data: signed })
      await started
      await fixture.dispatch({ source: fixture.source, data: signed })
      expect(verifySpy).toHaveBeenCalledTimes(1)
      expect(dispatches).toBe(0)

      resolveVerification?.(true)
      await first

      expect(dispatches).toBe(1)
    } finally {
      resolveVerification?.(false)
      verifySpy.mockRestore()
    }
  })

  it("SAFE-10 accepts a capability nonce at the exact minimum length", async () => {
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
      }
    })
    const message = {
      app: "GPD" as const,
      action: "gptkCommand" as const,
      command: "healthCheck",
      requestId: "minimum-nonce",
      args: {},
      provider: "google" as const
    }
    const verifySpy = vi.spyOn(crypto.subtle, "verify").mockResolvedValue(true)

    try {
      await fixture.dispatch({
        source: fixture.source,
        data: {
          ...message,
          capability: {
            payload: providerCommandCapabilityPayload({
              message,
              issuedAt: Date.now(),
              nonce: "n".repeat(16)
            }),
            signature: "AA"
          }
        }
      })

      expect(dispatches).toBe(1)
      expect(verifySpy).toHaveBeenCalledOnce()
    } finally {
      verifySpy.mockRestore()
    }
  })

  it("SAFE-10 signs an omitted command args value as canonical null", async () => {
    const publicKey = await getProviderCommandPublicKey()
    const fixture = commandHostFixture({ authenticate: true, publicKey })
    let dispatches = 0
    fixture.host.register({
      handlers: {
        healthCheck: async () => {
          dispatches += 1
        }
      }
    })
    const message = {
      app: "GPD" as const,
      action: "gptkCommand" as const,
      command: "healthCheck",
      requestId: "undefined-args-capability",
      args: undefined,
      provider: "google" as const
    }
    const payload = providerCommandCapabilityPayload({
      message,
      issuedAt: Date.now(),
      nonce: "n".repeat(16)
    })
    const verifySpy = vi.spyOn(crypto.subtle, "verify").mockResolvedValue(true)

    try {
      await fixture.dispatch({
        source: fixture.source,
        data: {
          ...message,
          capability: { payload, signature: "AA" }
        }
      })

      expect(verifySpy).toHaveBeenCalledOnce()
      expect(dispatches).toBe(1)
    } finally {
      verifySpy.mockRestore()
    }
  })

  it("SAFE-10 imports provider verification keys as non-extractable", async () => {
    const publicKey = await getProviderCommandPublicKey()
    const fixture = commandHostFixture({
      authenticate: true,
      publicKey
    })
    fixture.host.register({
      handlers: {
        healthCheck: async () => undefined
      }
    })
    const message = await withProviderCommandCapability({
      app: "GPD",
      action: "gptkCommand",
      command: "healthCheck",
      requestId: "non-extractable-key",
      args: {},
      provider: "google"
    })
    const importSpy = vi.spyOn(crypto.subtle, "importKey")

    try {
      await fixture.dispatch({ source: fixture.source, data: message })
      expect(importSpy).toHaveBeenCalled()
      expect(importSpy.mock.calls[0]?.[3]).toBe(false)
    } finally {
      importSpy.mockRestore()
    }
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

    const verifySpy = vi.spyOn(crypto.subtle, "verify").mockResolvedValue(true)
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
            signature: "-_8"
          }
        }
      })
      expect(Array.from(verifySpy.mock.calls[0]?.[2] as Uint8Array)).toEqual([
        251, 255
      ])
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
        error: "unsupported eraseEverything",
        providerSessionId: fixture.host.providerSessionId
      }
    ])
  })

  it("SAFE-10 defaults malformed handler maps and unsupported-message callbacks safely", async () => {
    const fixture = commandHostFixture()
    fixture.host.register({
      handlers: null,
      unsupportedMessage: "not-a-callback" as unknown as (
        command: string
      ) => string
    })

    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "unknownCommand",
        requestId: "default-unsupported",
        args: {}
      }
    })

    expect(fixture.posted).toEqual([
      {
        app: "GPD",
        action: "gptkResult",
        command: "unknownCommand",
        requestId: "default-unsupported",
        success: false,
        error: "Unsupported command: unknownCommand",
        providerSessionId: fixture.host.providerSessionId
      }
    ])
  })

  it("SAFE-10 treats a non-function command entry as unsupported", async () => {
    const fixture = commandHostFixture()
    fixture.host.register({
      handlers: {
        healthCheck: "not-a-handler" as unknown as (
          requestId: string,
          args: unknown,
          signal?: AbortSignal
        ) => Promise<void>
      },
      unsupportedMessage: (command) => `unsupported ${command}`
    })

    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "healthCheck",
        requestId: "non-function-handler",
        args: {}
      }
    })

    expect(fixture.posted).toContainEqual(
      expect.objectContaining({
        command: "healthCheck",
        requestId: "non-function-handler",
        success: false,
        error: "unsupported healthCheck"
      })
    )
  })

  it("SAFE-10 reports false for cancellation without a string target ID", async () => {
    const fixture = commandHostFixture()
    fixture.host.register({ handlers: {} })

    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "cancelScan",
        requestId: "cancel-no-target"
      }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "cancelScan",
        requestId: "cancel-numeric-target",
        args: { targetRequestId: 42 }
      }
    })

    expect(fixture.posted).toEqual([
      expect.objectContaining({
        command: "cancelScan",
        requestId: "cancel-no-target",
        success: true,
        data: { targetRequestId: undefined, cancelled: false }
      }),
      expect.objectContaining({
        command: "cancelScan",
        requestId: "cancel-numeric-target",
        success: true,
        data: { targetRequestId: 42, cancelled: false }
      })
    ])
  })

  it("SAFE-10 cancels an active scan and reports cancellation to its caller", async () => {
    const fixture = commandHostFixture()
    let scanSignal: AbortSignal | undefined
    fixture.host.register({
      handlers: {
        getAllMediaItems: async (_requestId, _args, signal) => {
          scanSignal = signal as AbortSignal | undefined
          await new Promise<void>((_resolve, reject) => {
            scanSignal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true }
            )
          })
        }
      }
    })

    const scanDispatch = fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "getAllMediaItems",
        requestId: "active-scan",
        args: validScanArgs(fixture)
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(scanSignal?.aborted).toBe(false)

    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "cancelScan",
        requestId: "cancel-active-scan",
        args: { targetRequestId: "active-scan" }
      }
    })
    await scanDispatch

    expect(scanSignal?.aborted).toBe(true)
    expect(fixture.posted).toContainEqual(
      expect.objectContaining({
        command: "cancelScan",
        requestId: "cancel-active-scan",
        success: true,
        data: { targetRequestId: "active-scan", cancelled: true }
      })
    )
    expect(fixture.posted).toContainEqual(
      expect.objectContaining({
        command: "getAllMediaItems",
        requestId: "active-scan",
        success: false,
        error: "aborted"
      })
    )
  })

  it("SAFE-10 remembers cancellation that arrives before a scan starts", async () => {
    const fixture = commandHostFixture()
    let scanWasAlreadyAborted: boolean | undefined
    fixture.host.register({
      handlers: {
        getAllMediaItems: async (_requestId, _args, signal) => {
          scanWasAlreadyAborted = signal?.aborted
        }
      }
    })

    vi.useFakeTimers()
    try {
      await fixture.dispatch({
        source: fixture.source,
        data: {
          app: "GPD",
          action: "gptkCommand",
          command: "cancelScan",
          requestId: "cancel-before-scan",
          args: { targetRequestId: "future-scan" }
        }
      })
      await fixture.dispatch({
        source: fixture.source,
        data: {
          app: "GPD",
          action: "gptkCommand",
          command: "getAllMediaItems",
          requestId: "future-scan",
          args: validScanArgs(fixture)
        }
      })

      expect(scanWasAlreadyAborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
      expect(fixture.posted).toContainEqual(
        expect.objectContaining({
          command: "cancelScan",
          requestId: "cancel-before-scan",
          success: true,
          data: { targetRequestId: "future-scan", cancelled: true }
        })
      )
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it("SAFE-10 expires a pending cancellation that never matches a scan", async () => {
    const fixture = commandHostFixture()
    let scanWasAlreadyAborted: boolean | undefined
    fixture.host.register({
      handlers: {
        getAllMediaItems: async (_requestId, _args, signal) => {
          scanWasAlreadyAborted = signal?.aborted
        }
      }
    })

    vi.useFakeTimers()
    try {
      await fixture.dispatch({
        source: fixture.source,
        data: {
          app: "GPD",
          action: "gptkCommand",
          command: "cancelScan",
          requestId: "cancel-that-expires",
          args: { targetRequestId: "never-started" }
        }
      })
      await vi.advanceTimersByTimeAsync(60_000)
      await fixture.dispatch({
        source: fixture.source,
        data: {
          app: "GPD",
          action: "gptkCommand",
          command: "getAllMediaItems",
          requestId: "never-started",
          args: validScanArgs(fixture)
        }
      })

      expect(scanWasAlreadyAborted).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it("SAFE-10 refreshes a pending cancellation when the same scan ID is cancelled again", async () => {
    const fixture = commandHostFixture()
    let scanWasAborted: boolean | undefined
    fixture.host.register({
      handlers: {
        getAllMediaItems: async (_requestId, _args, signal) => {
          scanWasAborted = signal?.aborted
        }
      }
    })

    vi.useFakeTimers()
    try {
      const cancel = (requestId: string) =>
        fixture.dispatch({
          source: fixture.source,
          data: {
            app: "GPD",
            action: "gptkCommand",
            command: "cancelScan",
            requestId,
            args: { targetRequestId: "refreshable-scan" }
          }
        })

      await cancel("first-cancel")
      await vi.advanceTimersByTimeAsync(30_000)
      await cancel("second-cancel")
      await vi.advanceTimersByTimeAsync(30_001)
      await fixture.dispatch({
        source: fixture.source,
        data: {
          app: "GPD",
          action: "gptkCommand",
          command: "getAllMediaItems",
          requestId: "refreshable-scan",
          args: validScanArgs(fixture)
        }
      })

      expect(scanWasAborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it("SAFE-10 keeps completed scans out of the active cancellation map", async () => {
    const fixture = commandHostFixture()
    const scanSignals: AbortSignal[] = []
    let nonScanSignal: AbortSignal | undefined
    fixture.host.register({
      handlers: {
        getAllMediaItems: async (_requestId, _args, signal) => {
          if (signal) scanSignals.push(signal)
        },
        healthCheck: async (_requestId, _args, signal) => {
          nonScanSignal = signal as AbortSignal | undefined
        }
      }
    })

    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "healthCheck",
        requestId: "non-scan-command",
        args: {}
      }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "getAllMediaItems",
        requestId: "completed-scan",
        args: validScanArgs(fixture)
      }
    })
    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "cancelScan",
        requestId: "cancel-after-completion",
        args: { targetRequestId: "completed-scan" }
      }
    })

    expect(nonScanSignal).toBeUndefined()
    expect(scanSignals).toHaveLength(1)
    expect(scanSignals[0]?.aborted).toBe(false)

    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "getAllMediaItems",
        requestId: "completed-scan",
        args: validScanArgs(fixture)
      }
    })
    expect(scanSignals[1]?.aborted).toBe(true)
  })

  it("SAFE-10 preserves an active scan when another command reuses its request ID", async () => {
    const fixture = commandHostFixture()
    let scanSignal: AbortSignal | undefined
    let finishScan: (() => void) | undefined
    let markScanStarted: (() => void) | undefined
    const scanStarted = new Promise<void>((resolve) => {
      markScanStarted = resolve
    })
    fixture.host.register({
      handlers: {
        getAllMediaItems: async (_requestId, _args, signal) => {
          scanSignal = signal as AbortSignal | undefined
          markScanStarted?.()
          await new Promise<void>((resolve) => {
            finishScan = resolve
            scanSignal?.addEventListener("abort", () => resolve(), {
              once: true
            })
          })
        },
        healthCheck: async () => undefined
      }
    })

    vi.useFakeTimers()
    let scanRun: Promise<void> | undefined
    try {
      scanRun = fixture.dispatch({
        source: fixture.source,
        data: {
          app: "GPD",
          action: "gptkCommand",
          command: "getAllMediaItems",
          requestId: "shared-request-id",
          args: validScanArgs(fixture)
        }
      })
      await scanStarted
      await fixture.dispatch({
        source: fixture.source,
        data: {
          app: "GPD",
          action: "gptkCommand",
          command: "healthCheck",
          requestId: "shared-request-id",
          args: {}
        }
      })
      await fixture.dispatch({
        source: fixture.source,
        data: {
          app: "GPD",
          action: "gptkCommand",
          command: "cancelScan",
          requestId: "cancel-shared-request-id",
          args: { targetRequestId: "shared-request-id" }
        }
      })

      expect(scanSignal?.aborted).toBe(true)
    } finally {
      finishScan?.()
      await scanRun
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it("SAFE-10 does not let an older scan remove a newer scan with the same request ID", async () => {
    const fixture = commandHostFixture()
    let starts = 0
    let finishFirstScan: (() => void) | undefined
    let firstSignal: AbortSignal | undefined
    let secondSignal: AbortSignal | undefined
    fixture.host.register({
      handlers: {
        getAllMediaItems: (_requestId, _args, signal) => {
          starts += 1
          if (starts === 1) {
            firstSignal = signal
            return new Promise<void>((resolve) => {
              finishFirstScan = resolve
            })
          }
          secondSignal = signal
          return new Promise<void>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true }
            )
          })
        }
      }
    })

    const firstScan = fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "getAllMediaItems",
        requestId: "reused-request-id",
        args: validScanArgs(fixture)
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (!finishFirstScan) throw new Error("first scan did not start")
    const secondScan = fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "getAllMediaItems",
        requestId: "reused-request-id",
        args: validScanArgs(fixture)
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    finishFirstScan()
    await firstScan

    await fixture.dispatch({
      source: fixture.source,
      data: {
        app: "GPD",
        action: "gptkCommand",
        command: "cancelScan",
        requestId: "cancel-newer-scan",
        args: { targetRequestId: "reused-request-id" }
      }
    })
    await secondScan

    expect(firstSignal?.aborted).toBe(false)
    expect(secondSignal?.aborted).toBe(true)
  })

  it("SAFE-03 treats a successful provider envelope without confirmed identities as unknown", async () => {
    const fixture = lifecycleFixture()
    await begin(fixture)
    const outcome = await fixture.lifecycle.reconcile({
      success: true,
      data: {}
    })
    expectUnknownOutcome(outcome)
    expect(outcome.movedCount).toBe(0)
    expect(outcome.unknownMediaKeys).toEqual(["trash"])
    expect(outcome.unknownDedupKeys).toEqual(["trash-dedup"])
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
