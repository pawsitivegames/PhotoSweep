import { readFileSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import tls, {
  type ConnectionOptions,
  type PeerCertificate
} from "node:tls"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createMemoryLicenseStore } from "../../server/license-api.mjs"
import {
  createNodeRequestHandler,
  createSmtpRecoveryEmailSender,
  createWebhookRecoveryEmailSender,
  startNodeLicenseServer
} from "../../server/node-server.mjs"
import { MAX_REQUEST_BODY_BYTES } from "../../server/http-request-body.mjs"
import {
  createNodeRequestHandler as createRecoveryWebhookNodeRequestHandler
} from "../../server/recovery-email-webhook/server.mjs"

const servers: Array<http.Server | net.Server> = []
const smtpTestCertificate = readFileSync("tests/fixtures/smtp-test-cert.pem")
const smtpTestPrivateKey = readFileSync("tests/fixtures/smtp-test-key.pem")

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
    )
  )
  servers.length = 0
})

function listen(
  server: http.Server | net.Server,
  host = "127.0.0.1"
): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, host, () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Server did not expose a TCP address."))
        return
      }
      resolve(address.port)
    })
  })
}

function createMockSmtpServer({ advertiseStartTls = false } = {}): {
  server: net.Server
  commands: Promise<string[]>
} {
  let resolveCommands: (commands: string[]) => void = () => {}
  let rejectCommands: (error: Error) => void = () => {}
  const commandsPromise = new Promise<string[]>((resolve, reject) => {
    resolveCommands = resolve
    rejectCommands = reject
  })

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8")
    socket.write("220 smtp.test ESMTP\r\n")

    let buffer = ""
    const commands: string[] = []
    socket.once("close", () => resolveCommands(commands))

    socket.on("data", (chunk: string) => {
      buffer += chunk
      let lineEnd = buffer.indexOf("\r\n")
      while (lineEnd >= 0) {
        const line = buffer.slice(0, lineEnd)
        buffer = buffer.slice(lineEnd + 2)

        commands.push(line)
        const command = line.split(" ", 1)[0].toUpperCase()
        if (command === "EHLO") {
          socket.write(
            `250-smtp.test\r\n${advertiseStartTls ? "250-STARTTLS\r\n" : ""}250-AUTH PLAIN LOGIN\r\n250 OK\r\n`
          )
        } else if (command === "STARTTLS") {
          socket.write("454 4.7.0 TLS temporarily unavailable\r\n")
        } else if (command === "QUIT") {
          socket.write("221 2.0.0 closing\r\n")
          socket.end()
        } else {
          socket.write("250 2.0.0 accepted\r\n")
        }

        lineEnd = buffer.indexOf("\r\n")
      }
    })
    socket.on("error", rejectCommands)
  })

  return { server, commands: commandsPromise }
}

type StartTlsSmtpResult = {
  plaintextCommands: string[]
  tlsCommands: string[]
  deliveredMessage: string
}

function createStartTlsSmtpServer(): {
  server: net.Server
  result: Promise<StartTlsSmtpResult>
} {
  const secureContext = tls.createSecureContext({
    cert: smtpTestCertificate,
    key: smtpTestPrivateKey
  })
  const plaintextCommands: string[] = []
  const tlsCommands: string[] = []
  let deliveredMessage = ""
  let resolveResult: (result: StartTlsSmtpResult) => void = () => {}
  let rejectResult: (error: Error) => void = () => {}
  const result = new Promise<StartTlsSmtpResult>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })

  const server = net.createServer((socket) => {
    socket.write("220 smtp.test ESMTP\r\n")
    socket.once("close", () =>
      resolveResult({ plaintextCommands, tlsCommands, deliveredMessage })
    )
    socket.once("error", rejectResult)

    let plaintextBuffer = Buffer.alloc(0)
    const onPlaintextData = (chunk: Buffer) => {
      plaintextBuffer = Buffer.concat([plaintextBuffer, chunk])
      let lineEnd = plaintextBuffer.indexOf("\r\n")
      while (lineEnd >= 0) {
        const line = plaintextBuffer.subarray(0, lineEnd).toString("utf8")
        plaintextBuffer = plaintextBuffer.subarray(lineEnd + 2)
        plaintextCommands.push(line)

        if (line.toUpperCase() === "EHLO LOCALHOST") {
          socket.write(
            "250-smtp.test\r\n250-STARTTLS\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n"
          )
        } else if (line.toUpperCase() === "STARTTLS") {
          socket.pause()
          socket.removeListener("data", onPlaintextData)
          socket.write("220 2.0.0 ready to start TLS\r\n", () => {
            const secureSocket = new tls.TLSSocket(socket, {
              isServer: true,
              secureContext
            })
            let tlsBuffer = ""
            let receivingMessage = false
            const messageLines: string[] = []

            secureSocket.on("error", rejectResult)
            secureSocket.on("data", (chunk: Buffer | string) => {
              tlsBuffer += chunk.toString()
              let tlsLineEnd = tlsBuffer.indexOf("\r\n")
              while (tlsLineEnd >= 0) {
                const tlsLine = tlsBuffer.slice(0, tlsLineEnd)
                tlsBuffer = tlsBuffer.slice(tlsLineEnd + 2)

                if (receivingMessage) {
                  if (tlsLine === ".") {
                    receivingMessage = false
                    deliveredMessage = messageLines.join("\r\n")
                    secureSocket.write("250 2.0.0 recovery message queued\r\n")
                  } else {
                    messageLines.push(tlsLine)
                  }
                } else {
                  tlsCommands.push(tlsLine)
                  if (tlsLine.toUpperCase() === "EHLO LOCALHOST") {
                    secureSocket.write(
                      "250-smtp.test\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n"
                    )
                  } else if (tlsLine.toUpperCase().startsWith("AUTH ")) {
                    secureSocket.write("235 2.7.0 authenticated\r\n")
                  } else if (tlsLine.toUpperCase().startsWith("MAIL FROM:")) {
                    secureSocket.write("250 2.1.0 sender accepted\r\n")
                  } else if (tlsLine.toUpperCase().startsWith("RCPT TO:")) {
                    secureSocket.write("250 2.1.5 recipient accepted\r\n")
                  } else if (tlsLine.toUpperCase() === "DATA") {
                    receivingMessage = true
                    secureSocket.write("354 end with <CRLF>.<CRLF>\r\n")
                  } else if (tlsLine.toUpperCase() === "QUIT") {
                    secureSocket.write("221 2.0.0 closing\r\n", () =>
                      secureSocket.end()
                    )
                  } else {
                    secureSocket.write("500 5.5.1 unsupported command\r\n")
                  }
                }

                tlsLineEnd = tlsBuffer.indexOf("\r\n")
              }
            })
            secureSocket.resume()
          })
          return
        } else {
          socket.write("500 5.5.1 unsupported command\r\n")
        }

        lineEnd = plaintextBuffer.indexOf("\r\n")
      }
    }
    socket.on("data", onPlaintextData)
  })

  return { server, result }
}

async function sendRecoveryEmailOverStartTls(host: string) {
  const smtp = createStartTlsSmtpServer()
  servers.push(smtp.server)
  const port = await listen(smtp.server, host)
  const recoveryUrl =
    "https://license.test/license/recover/complete?token=abc"
  const sender = createSmtpRecoveryEmailSender({
    env: {
      NODE_ENV: "development",
      PHOTOSWEEP_SMTP_HOST: host,
      PHOTOSWEEP_SMTP_PORT: String(port),
      PHOTOSWEEP_SMTP_USER: "smtp_user",
      PHOTOSWEEP_SMTP_PASS: "smtp_pass",
      PHOTOSWEEP_SMTP_FROM: "recovery@photosweep.test",
      PHOTOSWEEP_SMTP_SECURE: "0"
    }
  })

  expect(sender).toBeTypeOf("function")
  const originalTlsConnect = tls.connect.bind(tls)
  const originalIdentityChecker = tls.checkServerIdentity.bind(tls)
  const tlsConnectSpy = vi.spyOn(tls, "connect")
  const identitySpy = vi.spyOn(tls, "checkServerIdentity")
  let tlsOptions: ConnectionOptions | undefined
  let identityCheckedHosts: string[] = []
  identitySpy.mockImplementation(originalIdentityChecker)
  tlsConnectSpy.mockImplementation(
    ((options: ConnectionOptions) => {
      tlsOptions = options
      return originalTlsConnect({
        ...options,
        ca: smtpTestCertificate
      })
    }) as typeof tls.connect
  )

  try {
    await sender?.({ email: "buyer@example.com", recoveryUrl })
    expect(tlsConnectSpy).toHaveBeenCalledTimes(1)
    identityCheckedHosts = identitySpy.mock.calls.map(([checkedHost]) => checkedHost)
  } finally {
    tlsConnectSpy.mockRestore()
    identitySpy.mockRestore()
  }

  return {
    result: await smtp.result,
    recoveryUrl,
    tlsOptions,
    identityCheckedHosts
  }
}

function expectStartTlsDelivery(
  result: StartTlsSmtpResult,
  recoveryUrl: string
) {
  expect(result.plaintextCommands).toEqual(["EHLO localhost", "STARTTLS"])
  expect(result.tlsCommands).toEqual([
    "EHLO localhost",
    `AUTH PLAIN ${Buffer.from("\u0000smtp_user\u0000smtp_pass").toString("base64")}`,
    "MAIL FROM:<recovery@photosweep.test>",
    "RCPT TO:<buyer@example.com>",
    "DATA",
    "QUIT"
  ])
  expect(result.deliveredMessage).toContain("To: buyer@example.com")
  expect(result.deliveredMessage).toContain(recoveryUrl)
}

function request(
  port: number,
  body: string,
  path = "/checkout",
  chunked = false,
  declaredContentLength?: number
): Promise<{
  status: number
  headers: http.IncomingHttpHeaders
  body: string
}> {
  return new Promise((resolve, reject) => {
    const headers: http.OutgoingHttpHeaders = {
      "content-type": "application/json"
    }
    if (chunked) {
      headers["transfer-encoding"] = "chunked"
    } else {
      headers["content-length"] = declaredContentLength ?? Buffer.byteLength(body)
    }
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8")
          })
        })
      }
    )
    req.once("error", reject)
    if (declaredContentLength !== undefined) {
      req.flushHeaders()
    } else {
      req.end(body)
    }
  })
}

describe("node license server adapter", () => {
  it("forwards node HTTP requests to the Web Request API handler", async () => {
    const observed: Array<{
      method: string
      url: string
      body: string | null
    }> = []
    const server = http.createServer(
      createNodeRequestHandler({
        env: {
          NODE_ENV: "development",
          PHOTOSWEEP_COOKIE_SECURE: "0"
        },
        api: async (request: Request) => {
          observed.push({
            method: request.method,
            url: request.url,
            body: await request.text()
          })
          return new Response(JSON.stringify({ ok: true }), {
            status: 201,
            headers: {
              "content-type": "application/json",
              "x-license-test": "ok"
            }
          })
        }
      })
    )
    servers.push(server)
    const port = await listen(server)
    const requestBody = JSON.stringify({ planId: "mini_cleanup" })

    const response = await request(port, requestBody)

    expect(response.status).toBe(201)
    expect(response.headers["x-license-test"]).toBe("ok")
    expect(JSON.parse(response.body)).toEqual({ ok: true })
    expect(observed).toEqual([
      {
        method: "POST",
        url: `http://127.0.0.1:${port}/checkout`,
        body: requestBody
      }
    ])
  })

  it("sends recovery email webhook payloads with optional bearer auth", async () => {
    const calls: Array<{
      url: string
      method: string
      authorization: string | null
      body: unknown
    }> = []
    const sender = createWebhookRecoveryEmailSender({
      env: {
        NODE_ENV: "development",
        PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_URL: "https://mail.test/recovery",
        PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_SECRET: "mail_secret"
      },
      fetchImpl: async (url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method ?? "GET",
          authorization: new Headers(init.headers).get("authorization"),
          body: JSON.parse(String(init.body))
        })
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" }
        })
      }
    })

    await sender?.({
      email: "buyer@example.com",
      recoveryUrl: "https://license.test/license/recover/complete?token=abc"
    })

    expect(calls).toEqual([
      {
        url: "https://mail.test/recovery",
        method: "POST",
        authorization: "Bearer mail_secret",
        body: {
          type: "license_recovery",
          email: "buyer@example.com",
          recoveryUrl: "https://license.test/license/recover/complete?token=abc"
        }
      }
    ])
  })

  it("requires STARTTLS before authenticating on non-implicit-TLS SMTP", async () => {
    const smtp = createMockSmtpServer()
    servers.push(smtp.server)
    const port = await listen(smtp.server)
    const recoveryUrl =
      "https://license.test/license/recover/complete?token=abc"
    const sender = createSmtpRecoveryEmailSender({
      env: {
        NODE_ENV: "development",
        PHOTOSWEEP_SMTP_HOST: "127.0.0.1",
        PHOTOSWEEP_SMTP_PORT: String(port),
        PHOTOSWEEP_SMTP_USER: "smtp_user",
        PHOTOSWEEP_SMTP_PASS: "smtp_pass",
        PHOTOSWEEP_SMTP_FROM: "recovery@photosweep.test",
        PHOTOSWEEP_SMTP_SECURE: "0"
      }
    })

    expect(sender).toBeTypeOf("function")
    await expect(
      sender?.({ email: "buyer@example.com", recoveryUrl })
    ).rejects.toThrow("SMTP server does not advertise STARTTLS.")
    expect(await smtp.commands).toEqual(["EHLO localhost", "QUIT"])
  })

  it("stops when the SMTP server rejects STARTTLS", async () => {
    const smtp = createMockSmtpServer({ advertiseStartTls: true })
    servers.push(smtp.server)
    const port = await listen(smtp.server)
    const sender = createSmtpRecoveryEmailSender({
      env: {
        NODE_ENV: "development",
        PHOTOSWEEP_SMTP_HOST: "127.0.0.1",
        PHOTOSWEEP_SMTP_PORT: String(port),
        PHOTOSWEEP_SMTP_USER: "smtp_user",
        PHOTOSWEEP_SMTP_PASS: "smtp_pass",
        PHOTOSWEEP_SMTP_FROM: "recovery@photosweep.test",
        PHOTOSWEEP_SMTP_SECURE: "0"
      }
    })

    await expect(
      sender?.({
        email: "buyer@example.com",
        recoveryUrl: "https://license.test/license/recover/complete?token=abc"
      })
    ).rejects.toThrow("SMTP STARTTLS failed with response 454.")
    expect(await smtp.commands).toEqual([
      "EHLO localhost",
      "STARTTLS",
      "QUIT"
    ])
  })

  it("upgrades SMTP to TLS before authenticating and delivering recovery email", async () => {
    const delivery = await sendRecoveryEmailOverStartTls("localhost")

    expect(delivery.tlsOptions?.servername).toBe("localhost")
    expectStartTlsDelivery(delivery.result, delivery.recoveryUrl)
  })

  it("verifies an IP SMTP host against its IP subject alternative name", async () => {
    const delivery = await sendRecoveryEmailOverStartTls("127.0.0.1")
    const identityError = delivery.tlsOptions?.checkServerIdentity?.("ignored", {
      subjectaltname: "IP Address:127.0.0.2"
    } as PeerCertificate)

    expect(delivery.tlsOptions?.servername).toBeUndefined()
    expect(delivery.tlsOptions?.checkServerIdentity).toBeTypeOf("function")
    expect(delivery.identityCheckedHosts).toContain("127.0.0.1")
    expect(identityError).toBeInstanceOf(Error)
    expectStartTlsDelivery(delivery.result, delivery.recoveryUrl)
  })

  it("wires the recovery email webhook into the default license API", async () => {
    const store = createMemoryLicenseStore()
    await store.upsertLicense({
      sessionId: "pls_recover_webhook",
      planId: "cleanup_pass",
      status: "active",
      email: "buyer@example.com",
      purchasedAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    })
    const webhookCalls: unknown[] = []
    const server = http.createServer(
      createNodeRequestHandler({
        env: {
          NODE_ENV: "development",
          PHOTOSWEEP_COOKIE_SECURE: "0",
          PHOTOSWEEP_RECOVERY_SECRET: "recovery_secret",
          PHOTOSWEEP_RECOVERY_BASE_URL: "https://license.test",
          PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_URL: "https://mail.test/recovery"
        },
        store,
        fetchImpl: async (_url: string, init: RequestInit) => {
          webhookCalls.push(JSON.parse(String(init.body)))
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" }
          })
        }
      })
    )
    servers.push(server)
    const port = await listen(server)

    const response = await request(
      port,
      JSON.stringify({ email: "buyer@example.com" }),
      "/license/recover"
    )

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true })
    expect(webhookCalls).toHaveLength(1)
    expect(webhookCalls[0]).toMatchObject({
      type: "license_recovery",
      email: "buyer@example.com"
    })
    expect(JSON.stringify(webhookCalls[0])).toContain(
      "https://license.test/license/recover/complete?token="
    )
  })

  it("does not send SMTP credentials when STARTTLS is missing", async () => {
    const smtp = createMockSmtpServer()
    servers.push(smtp.server)
    const smtpPort = await listen(smtp.server)
    const store = createMemoryLicenseStore()
    await store.upsertLicense({
      sessionId: "pls_recover_smtp",
      planId: "cleanup_pass",
      status: "active",
      email: "buyer@example.com",
      purchasedAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    })
    const server = http.createServer(
      createNodeRequestHandler({
        env: {
          NODE_ENV: "development",
          PHOTOSWEEP_COOKIE_SECURE: "0",
          PHOTOSWEEP_RECOVERY_SECRET: "recovery_secret",
          PHOTOSWEEP_RECOVERY_BASE_URL: "https://license.test",
          PHOTOSWEEP_SMTP_HOST: "127.0.0.1",
          PHOTOSWEEP_SMTP_PORT: String(smtpPort),
          PHOTOSWEEP_SMTP_USER: "smtp_user",
          PHOTOSWEEP_SMTP_PASS: "smtp_pass",
          PHOTOSWEEP_SMTP_FROM: "recovery@photosweep.test",
          PHOTOSWEEP_SMTP_SECURE: "0"
        },
        store
      })
    )
    servers.push(server)
    const port = await listen(server)

    const response = await request(
      port,
      JSON.stringify({ email: "buyer@example.com" }),
      "/license/recover"
    )

    expect(response.status).toBe(500)
    expect(await smtp.commands).toEqual(["EHLO localhost", "QUIT"])
  })

  it.each([
    {
      adapter: "license API adapter",
      mode: "Content-Length preflight",
      chunked: false
    },
    {
      adapter: "license API adapter",
      mode: "chunked stream",
      chunked: true
    },
    {
      adapter: "recovery webhook adapter",
      mode: "Content-Length preflight",
      chunked: false
    },
    {
      adapter: "recovery webhook adapter",
      mode: "chunked stream",
      chunked: true
    }
  ])(
    "rejects oversized bodies in the $adapter ($mode)",
    async ({ adapter, chunked, mode }) => {
      let handlerCalls = 0
      const handler = async () => {
        handlerCalls += 1
        return new Response(JSON.stringify({ ok: true }))
      }
      const nodeHandler =
        adapter === "license API adapter"
          ? createNodeRequestHandler({
              env: { NODE_ENV: "development" },
              api: handler
            })
          : createRecoveryWebhookNodeRequestHandler({ handler })
      const server = http.createServer(nodeHandler)
      servers.push(server)
      const port = await listen(server)
      const contentLengthPreflight = mode === "Content-Length preflight"
      const response = await request(
        port,
        contentLengthPreflight ? "" : "x".repeat(MAX_REQUEST_BODY_BYTES + 1),
        "/oversized",
        chunked,
        contentLengthPreflight ? MAX_REQUEST_BODY_BYTES + 1 : undefined
      )

      expect(response.status).toBe(413)
      expect(response.headers.connection).toBe("close")
      expect(JSON.parse(response.body)).toEqual({
        error: "Request body is too large."
      })
      expect(handlerCalls).toBe(0)
    }
  )

  it.each([
    {
      name: "defaults to loopback",
      host: undefined,
      expectedAddress: "127.0.0.1"
    },
    {
      name: "preserves an explicit remote bind",
      host: "0.0.0.0",
      expectedAddress: "0.0.0.0"
    }
  ])("license server $name", async ({ host, expectedAddress }) => {
    const server = startNodeLicenseServer({
      env: {
        NODE_ENV: "development",
        ...(host ? { HOST: host } : {})
      },
      port: 0,
      handler: (_request, response) => response.end("ok")
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve)
      server.once("error", reject)
    })
    const address = server.address()

    expect(address).not.toBeNull()
    expect(typeof address).not.toBe("string")
    expect((address as net.AddressInfo).address).toBe(expectedAddress)
  })
})
