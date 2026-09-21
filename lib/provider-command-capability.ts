import type {
  GptkCommandMessage,
  ProviderCommandPublicKey
} from "./types"

/**
 * The signing key is generated on first use and kept in extension storage.
 * Only the public half leaves the extension context. A static private key
 * would be recoverable from a published extension bundle and would not be an
 * authorization boundary for hostile page scripts.
 */
const PROVIDER_COMMAND_KEY_STORAGE =
  "photosweepProviderCommandKeyPairV1" as const

export const PROVIDER_COMMAND_CAPABILITY_TTL_MS = 60_000

export interface ProviderCommandCapability {
  payload: string
  signature: string
}

interface StoredProviderCommandKeyPair {
  publicKey: JsonWebKey
  privateKey: JsonWebKey
}

interface ProviderCommandKeyPair {
  publicKey: JsonWebKey
  privateKey: CryptoKey
}

function base64UrlEncode(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ""
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : "null"
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
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

function randomNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

export function providerCommandCapabilityPayload(params: {
  message: Pick<
    GptkCommandMessage,
    "app" | "action" | "command" | "requestId" | "args" | "provider"
  >
  issuedAt: number
  nonce: string
}): string {
  return canonicalJson({
    app: params.message.app,
    action: params.message.action,
    command: params.message.command,
    requestId: params.message.requestId,
    provider: params.message.provider ?? "google",
    args: params.message.args ?? null,
    issuedAt: params.issuedAt,
    nonce: params.nonce
  })
}

function hasChromeStorage(): boolean {
  return (
    typeof chrome !== "undefined" &&
    Boolean(chrome.storage?.local) &&
    typeof chrome.storage.local.get === "function" &&
    typeof chrome.storage.local.set === "function"
  )
}

function isJsonWebKey(value: unknown): value is JsonWebKey {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as JsonWebKey).kty === "EC" &&
      (value as JsonWebKey).crv === "P-256"
  )
}

function toPublicKey(value: JsonWebKey): ProviderCommandPublicKey {
  if (
    value.kty !== "EC" ||
    value.crv !== "P-256" ||
    typeof value.x !== "string" ||
    typeof value.y !== "string"
  ) {
    throw new Error("Invalid provider command public key")
  }
  return { kty: "EC", x: value.x, y: value.y, crv: "P-256" }
}

async function generateProviderCommandKeyPair(): Promise<ProviderCommandKeyPair> {
  const generated = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair
  return {
    publicKey: await crypto.subtle.exportKey("jwk", generated.publicKey),
    privateKey: generated.privateKey
  }
}

async function importStoredProviderCommandKeyPair(
  stored: StoredProviderCommandKeyPair
): Promise<ProviderCommandKeyPair | undefined> {
  if (!isJsonWebKey(stored.publicKey) || !isJsonWebKey(stored.privateKey)) {
    return undefined
  }
  try {
    return {
      publicKey: toPublicKey(stored.publicKey),
      privateKey: await crypto.subtle.importKey(
        "jwk",
        stored.privateKey,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"]
      )
    }
  } catch {
    return undefined
  }
}

let providerCommandKeyPairPromise: Promise<ProviderCommandKeyPair> | undefined

async function loadProviderCommandKeyPair(): Promise<ProviderCommandKeyPair> {
  if (hasChromeStorage()) {
    try {
      const stored = (
        await chrome.storage.local.get(PROVIDER_COMMAND_KEY_STORAGE)
      )[PROVIDER_COMMAND_KEY_STORAGE] as
        | StoredProviderCommandKeyPair
        | undefined
      if (stored) {
        const imported = await importStoredProviderCommandKeyPair(stored)
        if (imported) return imported
      }
    } catch {
      // Generate a fresh in-memory key if extension storage is unavailable.
    }
  }

  const generated = await generateProviderCommandKeyPair()
  if (hasChromeStorage()) {
    try {
      await chrome.storage.local.set({
        [PROVIDER_COMMAND_KEY_STORAGE]: {
          publicKey: generated.publicKey,
          privateKey: await crypto.subtle.exportKey("jwk", generated.privateKey)
        } satisfies StoredProviderCommandKeyPair
      })
    } catch {
      // The in-memory key remains usable for this service-worker lifetime.
    }
  }
  return generated
}

function getProviderCommandKeyPair(): Promise<ProviderCommandKeyPair> {
  providerCommandKeyPairPromise ??= loadProviderCommandKeyPair()
  return providerCommandKeyPairPromise
}

export async function getProviderCommandPublicKey(): Promise<ProviderCommandPublicKey> {
  const { publicKey } = await getProviderCommandKeyPair()
  return toPublicKey(publicKey)
}

export async function withProviderCommandCapability(
  message: GptkCommandMessage
): Promise<GptkCommandMessage> {
  const normalizedMessage = {
    ...message,
    provider: message.provider ?? "google"
  } satisfies GptkCommandMessage
  const issuedAt = Date.now()
  const nonce = randomNonce()
  const payload = providerCommandCapabilityPayload({
    message: normalizedMessage,
    issuedAt,
    nonce
  })
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    (await getProviderCommandKeyPair()).privateKey,
    new TextEncoder().encode(payload)
  )
  return {
    ...normalizedMessage,
    capability: { payload, signature: base64UrlEncode(signature) }
  }
}
