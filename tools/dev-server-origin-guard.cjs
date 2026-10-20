// Parcel's current dev-server dependency emits permissive CORS headers. Guard
// the HTTP and WebSocket entry points while PhotoSweep's development server is
// running, allowing its Chrome extension origin and local command-line clients.
const { Server } = require("node:http")

const guardInstalled = Symbol.for("photosweep.devServerOriginGuard")
const configuredExtensionId = process.env.PHOTOSWEEP_DEV_EXTENSION_ID
const trustedExtensionOrigin =
  typeof configuredExtensionId === "string" &&
  /^[a-p]{32}$/.test(configuredExtensionId)
    ? `chrome-extension://${configuredExtensionId}`
    : null

function isLoopbackHttpOrigin(origin) {
  if (typeof origin !== "string") return false

  try {
    const parsed = new URL(origin)
    return (
      parsed.protocol === "http:" &&
      parsed.origin === origin &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    )
  } catch {
    return false
  }
}

function isLoopbackAddress(address) {
  if (typeof address !== "string") return false
  if (address === "::1") return true

  const normalized = address.toLowerCase()
  if (normalized.startsWith("::ffff:")) {
    const mappedAddress = normalized.slice("::ffff:".length)
    if (mappedAddress.includes(".")) {
      address = mappedAddress
    } else {
      const words = mappedAddress.split(":")
      if (
        words.length !== 2 ||
        words.some((word) => !/^[\da-f]{1,4}$/.test(word))
      ) {
        return false
      }
      return (Number.parseInt(words[0], 16) >> 8) === 127
    }
  }

  const octets = address.split(".").map(Number)
  return (
    octets.length === 4 &&
    octets[0] === 127 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
  )
}

if (!Server.prototype[guardInstalled]) {
  const originalEmit = Server.prototype.emit

  Object.defineProperty(Server.prototype, guardInstalled, { value: true })
  Server.prototype.emit = function emit(event, ...args) {
    if (event === "request" || event === "upgrade") {
      const [request, responseOrSocket] = args
      const origin = request?.headers?.origin
      const fetchSite = request?.headers?.["sec-fetch-site"]
      const fetchMode = request?.headers?.["sec-fetch-mode"]
      const fetchDestination = request?.headers?.["sec-fetch-dest"]
      const fetchUser = request?.headers?.["sec-fetch-user"]
      const hasFetchMetadata =
        fetchSite !== undefined ||
        fetchMode !== undefined ||
        fetchDestination !== undefined ||
        fetchUser !== undefined
      const localNoOriginRequest =
        origin === undefined && !hasFetchMetadata
      const localCliOrigin =
        event === "request" &&
        !hasFetchMetadata &&
        isLoopbackHttpOrigin(origin)
      const directNavigationWithoutOrigin =
        origin === undefined &&
        fetchSite === "none" &&
        fetchMode === "navigate" &&
        fetchDestination === "document" &&
        (fetchUser === undefined || fetchUser === "?1")
      const loopbackPeer = isLoopbackAddress(request?.socket?.remoteAddress)
      const allowed =
        loopbackPeer &&
        ((trustedExtensionOrigin !== null &&
          origin === trustedExtensionOrigin) ||
          localNoOriginRequest ||
          localCliOrigin ||
          directNavigationWithoutOrigin)

      if (!allowed) {
        if (event === "request") {
          responseOrSocket.writeHead(403, {
            "Cache-Control": "no-store",
            "Content-Length": "0"
          })
          responseOrSocket.end()
        } else {
          responseOrSocket.end(
            "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n\r\n"
          )
        }
        return true
      }
    }

    return Reflect.apply(originalEmit, this, [event, ...args])
  }
}
