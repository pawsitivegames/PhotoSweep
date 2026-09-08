export const LICENSE_SESSION_STORAGE_KEY = "photoSweepLicenseSessionId"
export const LICENSE_SESSION_MESSAGE_TYPE = "photosweep-license-session"

const LICENSE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/

export interface LicenseSessionExternalMessage {
  type: typeof LICENSE_SESSION_MESSAGE_TYPE
  licenseSessionId: string
}

export function isValidLicenseSessionId(value: unknown): value is string {
  return typeof value === "string" && LICENSE_SESSION_ID_PATTERN.test(value)
}

export function isLicenseSessionExternalMessage(
  value: unknown
): value is LicenseSessionExternalMessage {
  if (!value || typeof value !== "object") return false
  const message = value as Record<string, unknown>
  return (
    message.type === LICENSE_SESSION_MESSAGE_TYPE &&
    isValidLicenseSessionId(message.licenseSessionId)
  )
}

export const isLicenseSessionMessage = isLicenseSessionExternalMessage

interface ChromeMatchPattern {
  host: string
  hostWildcard: boolean
  path: string
  port?: string
}

function parseChromeMatchPattern(value: string): ChromeMatchPattern | undefined {
  const match = /^https:\/\/([^/]+)(\/.*)$/.exec(value)
  if (!match) return undefined

  const [, authority, path] = match
  if (authority.includes("@")) return undefined

  const authorityMatch = /^(\*\.)?([^:]+)(?::(\d+|\*))?$/.exec(
    authority.toLowerCase()
  )
  if (!authorityMatch) return undefined

  const [, wildcardPrefix, host, port] = authorityMatch
  if (
    host !== "*" &&
    !/^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/.test(host)
  ) {
    return undefined
  }
  if (host === "*" && wildcardPrefix) return undefined

  return {
    host,
    hostWildcard: Boolean(wildcardPrefix),
    path,
    port
  }
}

function chromeMatchPathMatches(pattern: string, pathname: string): boolean {
  const escaped = pattern
    .replace(/[\\^$+?.()|[\]{}]/g, "\\$&")
    .replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`).test(pathname)
}

function externalMatchCoversOrigin(
  matchPattern: string,
  sender: URL
): boolean {
  const pattern = parseChromeMatchPattern(matchPattern)
  if (!pattern) return false

  const senderHost = sender.hostname.toLowerCase()
  const hostMatches =
    pattern.host === "*"
      ? true
      : pattern.hostWildcard
        ? senderHost === pattern.host || senderHost.endsWith(`.${pattern.host}`)
        : senderHost === pattern.host
  if (!hostMatches) return false

  if (pattern.port && pattern.port !== "*") {
    const senderPort = sender.port || "443"
    if (senderPort !== pattern.port) return false
  }

  return chromeMatchPathMatches(pattern.path, sender.pathname || "/")
}

export function isAllowedLicenseSessionSender(
  senderUrl: unknown,
  matchPatterns: readonly string[]
): boolean {
  if (typeof senderUrl !== "string") return false
  try {
    const sender = new URL(senderUrl)
    if (sender.protocol !== "https:") return false
    if (sender.username || sender.password) return false
    return matchPatterns.some((pattern) =>
      externalMatchCoversOrigin(pattern, sender)
    )
  } catch {
    return false
  }
}
