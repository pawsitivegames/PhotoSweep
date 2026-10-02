export const INSTALL_ID_STORAGE_KEY = "photoSweepInstallId"

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface InstallIdentityStorage {
  get(
    keys?: string | string[] | Record<string, unknown>
  ): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

const pendingInstallIds = new WeakMap<
  InstallIdentityStorage,
  Promise<string>
>()

export function isValidInstallId(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value)
}

export function createInstallId(
  randomUUID: (() => string) | undefined = globalThis.crypto?.randomUUID?.bind(
    globalThis.crypto
  )
): string {
  if (randomUUID) {
    const candidate = randomUUID()
    if (isValidInstallId(candidate)) return candidate
  }

  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure random values are unavailable.")
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"))
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join("")
  ].join("-")
}

async function loadOrCreateInstallId(
  storage: InstallIdentityStorage
): Promise<string> {
  const stored = await storage.get(INSTALL_ID_STORAGE_KEY)
  const existing = stored[INSTALL_ID_STORAGE_KEY]
  if (isValidInstallId(existing)) return existing

  const installId = createInstallId()
  await storage.set({ [INSTALL_ID_STORAGE_KEY]: installId })
  return installId
}

export function getOrCreateInstallId(
  storage: InstallIdentityStorage = chrome.storage.local
): Promise<string> {
  const pending = pendingInstallIds.get(storage)
  if (pending) return pending

  const next = loadOrCreateInstallId(storage).catch((error) => {
    pendingInstallIds.delete(storage)
    throw error
  })
  pendingInstallIds.set(storage, next)
  return next
}
