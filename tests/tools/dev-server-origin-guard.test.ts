import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams
} from "node:child_process"
import { readFileSync } from "node:fs"
import { request } from "node:http"
import { connect } from "node:net"
import { resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
const unrelatedExtensionOrigin = "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba"
const trustedExtensionId = new URL(extensionOrigin).hostname
const probeServer = `
const http = require("node:http")
const server = http.createServer((_request, response) => response.end("served"))
server.on("upgrade", (_request, socket) => {
  socket.end("HTTP/1.1 101 Switching Protocols\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\n\\r\\n")
})
server.listen(0, "127.0.0.1", () => console.log("READY:" + server.address().port))
`

let child: ChildProcessWithoutNullStreams
let port: number

function startProbeServer(extensionId = trustedExtensionId) {
  return new Promise<number>((resolveReady, reject) => {
    const env = { ...process.env }
    delete env.PHOTOSWEEP_DEV_EXTENSION_ID
    env.PHOTOSWEEP_DEV_EXTENSION_ID = extensionId
    child = spawn(
      process.execPath,
      [
        "--require",
        resolve(process.cwd(), "tools/dev-server-origin-guard.cjs"),
        "-e",
        probeServer
      ],
      { stdio: ["pipe", "pipe", "pipe"], env }
    )

    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
      const match = stdout.match(/READY:(\d+)/)
      if (match) resolveReady(Number(match[1]))
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.once("error", reject)
    child.once("exit", (code) => {
      if (!/READY:\d+/.test(stdout)) {
        reject(new Error(`Probe server exited (${code}): ${stderr || stdout}`))
      }
    })
  })
}

function httpStatus(origin?: string, fetchMetadata: Record<string, string> = {}) {
  return new Promise<number>((resolveStatus, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: "/source.js",
        headers: { ...(origin ? { Origin: origin } : {}), ...fetchMetadata }
      },
      (response) => {
        response.resume()
        response.once("end", () => resolveStatus(response.statusCode ?? 0))
      }
    )
    req.once("error", reject)
    req.end()
  })
}

function websocketStatus(
  origin?: string,
  fetchMetadata: Record<string, string> = {}
) {
  return new Promise<string>((resolveStatus, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(
        [
          "GET /__parcel_hmr HTTP/1.1",
          `Host: 127.0.0.1:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          ...(origin ? [`Origin: ${origin}`] : []),
          ...Object.entries(fetchMetadata).map(
            ([name, value]) => `${name}: ${value}`
          ),
          "",
          ""
        ].join("\r\n")
      )
    })
    socket.setTimeout(2_000, () => socket.destroy(new Error("WebSocket timed out")))
    socket.once("data", (data) => {
      const status = data.toString().split("\r\n", 1)[0]
      socket.destroy()
      resolveStatus(status)
    })
    socket.once("error", reject)
  })
}

function simulatedPeerStatus(
  remoteAddress: string,
  origin?: string,
  trustedId: string | null = trustedExtensionId
) {
  const guardPath = resolve(
    process.cwd(),
    "tools/dev-server-origin-guard.cjs"
  )
  const script = `
const http = require("node:http")
const server = http.createServer((_request, response) => response.end("served"))
const response = {
  writeHead(statusCode) { this.statusCode = statusCode },
  end() { console.log("RESULT:" + (this.statusCode ?? 200)) }
}
server.emit("request", {
  headers: ${JSON.stringify(origin ? { origin } : {})},
  socket: { remoteAddress: ${JSON.stringify(remoteAddress)} }
}, response)
`
  const env = { ...process.env }
  delete env.PHOTOSWEEP_DEV_EXTENSION_ID
  if (trustedId !== null) env.PHOTOSWEEP_DEV_EXTENSION_ID = trustedId
  const result = spawnSync(
    process.execPath,
    ["--require", guardPath, "-e", script],
    { encoding: "utf8", env }
  )
  const status = result.stdout.match(/RESULT:(\d+)/)?.[1]
  if (result.status !== 0 || !status) {
    throw new Error(result.stderr || result.stdout || "Peer probe failed")
  }
  return Number(status)
}

describe("Parcel dev-server origin guard", () => {
  beforeAll(async () => {
    port = await startProbeServer()
  })

  afterAll(() => {
    child?.kill()
  })

  it("denies HTTPS page Origins before the HTTP handler can expose files", async () => {
    await expect(httpStatus("https://attacker.example")).resolves.toBe(403)
  })

  it("denies browser subresource requests that omit Origin", async () => {
    for (const metadata of [
      { "Sec-Fetch-Site": "cross-site" },
      { "Sec-Fetch-Mode": "no-cors" },
      { "Sec-Fetch-Dest": "script" },
      { "Sec-Fetch-User": "?1" }
    ]) {
      await expect(httpStatus(undefined, metadata)).resolves.toBe(403)
    }
    await expect(websocketStatus(undefined, {
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "websocket"
    })).resolves.toMatch(/^HTTP\/1\.1 403/)
  })

  it("keeps direct browser navigation usable without an Origin", async () => {
    await expect(
      httpStatus(undefined, {
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document"
      })
    ).resolves.toBe(200)
  })

  it("allows only the configured extension Origin and local no-Origin HTTP requests", async () => {
    await expect(httpStatus(extensionOrigin)).resolves.toBe(200)
    await expect(httpStatus(unrelatedExtensionOrigin)).resolves.toBe(403)
    await expect(httpStatus()).resolves.toBe(200)
  })

  it("fails closed for extension Origins when the trusted ID is missing or invalid", () => {
    expect(simulatedPeerStatus("127.0.0.1", extensionOrigin, null)).toBe(403)
    expect(simulatedPeerStatus("127.0.0.1", extensionOrigin, "not-an-extension-id")).toBe(403)
  })

  it("allows local CLI Origins without browser fetch metadata", async () => {
    for (const origin of [
      "http://localhost:1815",
      "http://127.0.0.1:1815",
      "http://[::1]:1815"
    ]) {
      await expect(httpStatus(origin)).resolves.toBe(200)
    }
    await expect(httpStatus("http://localhost.attacker.example:1815")).resolves.toBe(403)
    await expect(
      httpStatus("http://localhost:1815", {
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-Mode": "no-cors"
      })
    ).resolves.toBe(403)
  })

  it("denies HTTPS page Origins before the HMR WebSocket handler runs", async () => {
    await expect(websocketStatus("https://attacker.example")).resolves.toMatch(
      /^HTTP\/1\.1 403/
    )
  })

  it("denies localhost page Origins on HMR WebSocket upgrades", async () => {
    await expect(websocketStatus("http://localhost:19000")).resolves.toMatch(
      /^HTTP\/1\.1 403/
    )
  })

  it("allows only the configured extension Origin and local no-Origin HMR connections", async () => {
    await expect(websocketStatus(extensionOrigin)).resolves.toMatch(
      /^HTTP\/1\.1 101/
    )
    await expect(websocketStatus(unrelatedExtensionOrigin)).resolves.toMatch(
      /^HTTP\/1\.1 403/
    )
    await expect(websocketStatus()).resolves.toMatch(/^HTTP\/1\.1 101/)
  })

  it("rejects non-loopback peers even when they claim a trusted extension Origin", () => {
    expect(simulatedPeerStatus("203.0.113.8", extensionOrigin)).toBe(403)
    expect(simulatedPeerStatus("203.0.113.8")).toBe(403)
  })
})
