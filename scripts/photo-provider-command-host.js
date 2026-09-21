// Shared MAIN-world command protocol for PhotoSweep provider adapters.
// Provider scripts keep their media behavior; this host owns the envelope and
// dispatch contract they all satisfy.

function isLocalTestEnvironment(targetWindow) {
  const protocol =
    typeof targetWindow.location === "object" && targetWindow.location
      ? targetWindow.location.protocol
      : undefined
  const hostname =
    typeof targetWindow.location === "object" && targetWindow.location
      ? targetWindow.location.hostname
      : undefined
  return (
    typeof process !== "undefined" &&
    process.env &&
    process.env.NODE_ENV === "test" &&
    (protocol === undefined || protocol === "about:" || hostname === "localhost")
  )
}

function createCommandHost(targetWindow, publicKey) {
  if (targetWindow.__GPD_COMMAND_HOST__) {
    return targetWindow.__GPD_COMMAND_HOST__
  }

  const APP_ID = "GPD"
  const CAPABILITY_TTL_MS = 60 * 1000
  // Capture the local test allowance when the host is created. Production
  // provider pages are never local test origins, so later page navigation
  // cannot turn an authenticated host into an unsigned one.
  const allowUnsignedTestCommands =
    isLocalTestEnvironment(targetWindow) &&
    targetWindow.__GPD_COMMAND_HOST_TEST_AUTH__ !== true
  const usedNonces = new Set()
  const pendingNonces = new Set()
  let verificationKeyPromise

  function canonicalJson(value) {
    if (value === null) return "null"
    if (typeof value === "string") return JSON.stringify(value)
    if (typeof value === "boolean") return value ? "true" : "false"
    if (typeof value === "number") {
      return Number.isFinite(value) ? JSON.stringify(value) : "null"
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
    if (typeof value === "object") {
      const record = value
      return `{${Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(",")}}`
    }
    return "null"
  }

  function base64UrlDecode(value) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  }

  function capabilityPayload(message, issuedAt, nonce) {
    return canonicalJson({
      app: message.app,
      action: message.action,
      command: message.command,
      requestId: message.requestId,
      provider: message.provider || "google",
      args: message.args === undefined ? null : message.args,
      issuedAt,
      nonce
    })
  }

  function loadVerificationKey() {
    verificationKeyPromise ||= crypto.subtle.importKey(
      "jwk",
      publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    )
    return verificationKeyPromise
  }

  async function hasValidCapability(message) {
    // Vitest's side-effect command tests exercise provider adapters without a
    // browser service worker. Restrict the test-only bypass to the happy-dom
    // fixture context; a provider page must never be able to spoof a Node
    // process object and disable capability checks.
    if (allowUnsignedTestCommands) return true
    const capability = message.capability
    if (
      !capability ||
      typeof capability.payload !== "string" ||
      typeof capability.signature !== "string"
    ) {
      return false
    }
    let parsed
    try {
      parsed = JSON.parse(capability.payload)
    } catch {
      return false
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.app !== APP_ID ||
      parsed.action !== "gptkCommand" ||
      parsed.command !== message.command ||
      parsed.requestId !== message.requestId ||
      parsed.provider !== (message.provider || "google") ||
      !Number.isFinite(parsed.issuedAt) ||
      typeof parsed.nonce !== "string" ||
      parsed.nonce.length < 16 ||
      capability.payload !==
        capabilityPayload(message, parsed.issuedAt, parsed.nonce) ||
      Math.abs(Date.now() - parsed.issuedAt) > CAPABILITY_TTL_MS ||
      usedNonces.has(parsed.nonce) ||
      pendingNonces.has(parsed.nonce)
    ) {
      return false
    }
    pendingNonces.add(parsed.nonce)
    try {
      const valid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        await loadVerificationKey(),
        base64UrlDecode(capability.signature),
        new TextEncoder().encode(capability.payload)
      )
      if (!valid) return false
      usedNonces.add(parsed.nonce)
      if (usedNonces.size > 512) {
        const first = usedNonces.values().next().value
        if (first) usedNonces.delete(first)
      }
      return true
    } catch {
      return false
    } finally {
      pendingNonces.delete(parsed.nonce)
    }
  }

  function postResult(command, requestId, data) {
    targetWindow.postMessage(
      {
        app: APP_ID,
        action: "gptkResult",
        command,
        requestId,
        success: true,
        data
      },
      "*"
    )
  }

  function postError(command, requestId, error, data) {
    targetWindow.postMessage(
      {
        app: APP_ID,
        action: "gptkResult",
        command,
        requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        ...(data !== undefined ? { data } : {})
      },
      "*"
    )
  }

  function postProgress(requestId, itemsProcessed, message, command, data) {
    targetWindow.postMessage(
      {
        app: APP_ID,
        action: "gptkProgress",
        requestId,
        itemsProcessed,
        message,
        ...(command !== undefined ? { command } : {}),
        ...(data !== undefined ? { data } : {})
      },
      "*"
    )
  }

  function register({ handlers, unsupportedMessage }) {
    const handlerMap =
      handlers && typeof handlers === "object" ? handlers : Object.create(null)
    const unsupported =
      typeof unsupportedMessage === "function"
        ? unsupportedMessage
        : (command) => `Unsupported command: ${command}`

    targetWindow.addEventListener("message", async (event) => {
      if (event.source !== targetWindow) return
      const message = event.data
      if (
        !message ||
        typeof message !== "object" ||
        Array.isArray(message) ||
        message.app !== APP_ID ||
        message.action !== "gptkCommand"
      ) {
        return
      }

      const { command, requestId, args } = message
      if (
        typeof command !== "string" ||
        command.length === 0 ||
        typeof requestId !== "string" ||
        requestId.length === 0
      ) {
        return
      }

      if (!(await hasValidCapability(message))) return

      const handler =
        Object.prototype.hasOwnProperty.call(handlerMap, command) &&
        typeof handlerMap[command] === "function"
          ? handlerMap[command]
          : null
      if (!handler) {
        postError(command, requestId, unsupported(command))
        return
      }
      try {
        await handler(requestId, args)
      } catch (error) {
        postError(command, requestId, error)
      }
    })
  }

  const host = Object.freeze({
    postResult,
    postError,
    postProgress,
    register
  })

  targetWindow.__GPD_COMMAND_HOST__ = host
  return host
}

// The production bundle loads this file as a classic MAIN-world script. The
// test mode hook is opt-in and lets Vitest import the same source so Stryker
// can instrument the message gate instead of testing a copied string.
function exposeTestFactory(targetGlobal) {
  if (targetGlobal.__GPD_COMMAND_HOST_TEST_MODE__ !== true) return
  targetGlobal.__GPD_COMMAND_HOST_TEST_FACTORY__ = createCommandHost
  targetGlobal.__GPD_COMMAND_HOST_TEST_READ_PUBLIC_KEY__ =
    readPublicKeyFromCurrentScript
}

function readPublicKeyFromCurrentScript(targetWindow) {
  try {
    const script = document.currentScript
    const encoded =
      script instanceof HTMLScriptElement
        ? new URL(script.src).searchParams.get("publicKey")
        : null
    const parsed = encoded
      ? JSON.parse(encoded)
      : targetWindow.__GPD_PROVIDER_COMMAND_PUBLIC_KEY__
    if (
      !parsed ||
      parsed.kty !== "EC" ||
      parsed.crv !== "P-256" ||
      typeof parsed.x !== "string" ||
      typeof parsed.y !== "string"
    ) {
      return undefined
    }
    return { kty: "EC", x: parsed.x, y: parsed.y, crv: "P-256" }
  } catch {
    return undefined
  }
}

globalThis.addEventListener("gpd-command-host-test", () =>
  exposeTestFactory(globalThis)
)

if (typeof window !== "undefined") {
  const publicKey = readPublicKeyFromCurrentScript(window)
  const isTestEnvironment = isLocalTestEnvironment(window)
  if (publicKey || isTestEnvironment) {
    createCommandHost(window, publicKey)
    try {
      delete window.__GPD_PROVIDER_COMMAND_PUBLIC_KEY__
    } catch {
      // Ignore a page-defined non-configurable property and fail closed later.
    }
  }
}
