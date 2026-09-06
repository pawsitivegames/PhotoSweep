import http from "node:http"
import net from "node:net"
import path from "node:path"
import tls from "node:tls"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createFirestoreLicenseStore } from "./firestore-license-store.mjs"
import { createJsonFileLicenseStore, createLicenseApi } from "./license-api.mjs"

const DEFAULT_PORT = 8787
const DEFAULT_STORE_PATH = ".photosweep/license-store.json"
const DEFAULT_SMTP_PORT = 587
const DEFAULT_SMTP_SECURE_PORT = 465
const SMTP_TIMEOUT_MS = 30_000

function requestUrl(nodeRequest, env) {
  const forwardedProto = nodeRequest.headers["x-forwarded-proto"]
  const proto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto ||
      (env.PHOTOSWEEP_COOKIE_SECURE === "0" ? "http" : "https")
  const host =
    nodeRequest.headers.host ?? `localhost:${env.PORT ?? DEFAULT_PORT}`
  return `${proto}://${host}${nodeRequest.url ?? "/"}`
}

async function readBody(nodeRequest) {
  const chunks = []
  for await (const chunk of nodeRequest) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function requestHeaders(nodeRequest) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(nodeRequest.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else if (value !== undefined) {
      headers.set(key, value)
    }
  }
  return headers
}

export function createWebhookRecoveryEmailSender({
  env = process.env,
  fetchImpl = fetch
} = {}) {
  const webhookUrl = env.PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_URL
  if (!webhookUrl) return undefined
  return async function sendRecoveryEmail(message) {
    const headers = {
      "content-type": "application/json"
    }
    if (env.PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_SECRET) {
      headers.authorization = `Bearer ${env.PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_SECRET}`
    }
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "license_recovery",
        email: message.email,
        recoveryUrl: message.recoveryUrl
      })
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(
        `Recovery email webhook failed: ${response.status}${text ? ` ${text}` : ""}`
      )
    }
  }
}

function smtpConfigFromEnv(env) {
  const host = env.PHOTOSWEEP_SMTP_HOST
  const from = env.PHOTOSWEEP_SMTP_FROM
  if (!host || !from) return undefined

  const secure = env.PHOTOSWEEP_SMTP_SECURE !== "0"
  const port = Number(
    env.PHOTOSWEEP_SMTP_PORT ??
      (secure ? DEFAULT_SMTP_SECURE_PORT : DEFAULT_SMTP_PORT)
  )
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PHOTOSWEEP_SMTP_PORT must be a valid TCP port.")
  }

  const user = env.PHOTOSWEEP_SMTP_USER
  const pass = env.PHOTOSWEEP_SMTP_PASS
  if ((user && !pass) || (!user && pass)) {
    throw new Error(
      "PHOTOSWEEP_SMTP_USER and PHOTOSWEEP_SMTP_PASS must be set together."
    )
  }

  return { host, port, secure, user, pass, from }
}

function smtpSafeValue(value, field) {
  const safeValue = String(value ?? "")
  if (!safeValue || /[\r\n]/.test(safeValue)) {
    throw new Error(`Invalid SMTP ${field}.`)
  }
  return safeValue
}

function smtpMailbox(value, field) {
  const safeValue = smtpSafeValue(value, field)
  const match = safeValue.match(/<([^<>]+)>/)
  const mailbox = match ? match[1] : safeValue
  if (!mailbox || /[\s<>]/.test(mailbox)) {
    throw new Error(`Invalid SMTP ${field}.`)
  }
  return mailbox
}

function createSmtpLineReader(socket) {
  let buffer = ""
  let ended = false
  let failure
  const queuedLines = []
  const pending = []

  function rejectPending(error) {
    while (pending.length) pending.shift().reject(error)
  }

  function onData(chunk) {
    buffer += chunk.toString()
    let lineEnd = buffer.indexOf("\n")
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd).replace(/\r$/, "")
      buffer = buffer.slice(lineEnd + 1)
      const waiter = pending.shift()
      if (waiter) waiter.resolve(line)
      else queuedLines.push(line)
      lineEnd = buffer.indexOf("\n")
    }
  }

  function onError(error) {
    failure = error instanceof Error ? error : new Error(String(error))
    rejectPending(failure)
  }

  function onEnd() {
    ended = true
    if (!failure) failure = new Error("SMTP connection closed unexpectedly.")
    rejectPending(failure)
  }

  socket.on("data", onData)
  socket.on("error", onError)
  socket.on("end", onEnd)
  socket.on("close", onEnd)

  return {
    nextLine() {
      if (queuedLines.length) return Promise.resolve(queuedLines.shift())
      if (failure) return Promise.reject(failure)
      if (ended) return Promise.reject(new Error("SMTP connection closed."))
      return new Promise((resolve, reject) => pending.push({ resolve, reject }))
    },
    close() {
      socket.removeListener("data", onData)
      socket.removeListener("error", onError)
      socket.removeListener("end", onEnd)
      socket.removeListener("close", onEnd)
    }
  }
}

async function readSmtpResponse(reader) {
  const lines = []
  let line = await reader.nextLine()
  let match = line.match(/^(\d{3})([- ])/)
  if (!match) throw new Error("Invalid SMTP response.")
  const code = Number(match[1])
  lines.push(line)
  while (match[2] === "-") {
    line = await reader.nextLine()
    match = line.match(/^(\d{3})([- ])/)
    if (!match || Number(match[1]) !== code) {
      throw new Error("Invalid multiline SMTP response.")
    }
    lines.push(line)
  }
  return { code, lines }
}

function writeSmtp(socket, value) {
  return new Promise((resolve, reject) => {
    try {
      socket.write(value, (error) => (error ? reject(error) : resolve()))
    } catch (error) {
      reject(error)
    }
  })
}

async function smtpCommand(socket, reader, command, expectedCodes) {
  await writeSmtp(socket, `${command}\r\n`)
  const response = await readSmtpResponse(reader)
  if (!expectedCodes.includes(response.code)) {
    const name = command.split(" ", 1)[0]
    throw new Error(`SMTP ${name} failed with response ${response.code}.`)
  }
  return response
}

function connectSmtpSocket({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port })
    let connected = false
    const onError = (error) => {
      if (!connected) reject(error)
    }
    const onTimeout = () => {
      const error = new Error("SMTP connection timed out.")
      if (!connected) reject(error)
      socket.destroy(error)
    }
    const connectedEvent = secure ? "secureConnect" : "connect"
    socket.once("error", onError)
    socket.once(connectedEvent, () => {
      connected = true
      socket.removeListener("error", onError)
      resolve(socket)
    })
    socket.setTimeout(SMTP_TIMEOUT_MS, onTimeout)
  })
}

function upgradeSmtpSocketToTls(socket, host) {
  socket.setTimeout(0)
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername: host })
    const onError = (error) => reject(error)
    secureSocket.once("error", onError)
    secureSocket.once("secureConnect", () => {
      secureSocket.removeListener("error", onError)
      secureSocket.setTimeout(SMTP_TIMEOUT_MS, () =>
        secureSocket.destroy(new Error("SMTP connection timed out."))
      )
      resolve(secureSocket)
    })
  })
}

function hasSmtpCapability(response, capability) {
  return response.lines.some((line) =>
    new RegExp(`^250[- ]${capability}(?:\\s|$)`, "i").test(line)
  )
}

function smtpAuthMechanisms(response) {
  const authLine = response.lines.find((line) =>
    /^250[- ]AUTH(?:\s|$)/i.test(line)
  )
  if (!authLine) return new Set()
  return new Set(authLine.slice(9).trim().toUpperCase().split(/\s+/))
}

async function authenticateSmtp(socket, reader, config, ehloResponse) {
  if (!config.user && !config.pass) return
  const mechanisms = smtpAuthMechanisms(ehloResponse)
  if (mechanisms.has("LOGIN") && !mechanisms.has("PLAIN")) {
    await smtpCommand(socket, reader, "AUTH LOGIN", [334])
    await smtpCommand(
      socket,
      reader,
      Buffer.from(config.user).toString("base64"),
      [334]
    )
    await smtpCommand(
      socket,
      reader,
      Buffer.from(config.pass).toString("base64"),
      [235]
    )
    return
  }
  const credentials = Buffer.from(
    `\u0000${config.user}\u0000${config.pass}`
  ).toString("base64")
  await smtpCommand(socket, reader, `AUTH PLAIN ${credentials}`, [235])
}

async function sendSmtpRecoveryEmail(config, message) {
  const from = smtpSafeValue(config.from, "from address")
  const envelopeFrom = smtpMailbox(from, "from address")
  const to = smtpSafeValue(message.email, "recipient address")
  const envelopeTo = smtpMailbox(to, "recipient address")
  const recoveryUrl = smtpSafeValue(message.recoveryUrl, "recovery URL")
  const data = [
    `From: ${from}`,
    `To: ${to}`,
    "Subject: PhotoSweep license recovery",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    recoveryUrl.replace(/^\./gm, "..")
  ].join("\r\n")

  let socket = await connectSmtpSocket(config)
  let reader = createSmtpLineReader(socket)
  try {
    await readSmtpResponse(reader).then((response) => {
      if (response.code !== 220) {
        throw new Error(`SMTP greeting failed with response ${response.code}.`)
      }
    })
    let ehloResponse = await smtpCommand(socket, reader, "EHLO localhost", [
      250
    ])
    if (!config.secure && hasSmtpCapability(ehloResponse, "STARTTLS")) {
      await smtpCommand(socket, reader, "STARTTLS", [220])
      reader.close()
      socket = await upgradeSmtpSocketToTls(socket, config.host)
      reader = createSmtpLineReader(socket)
      ehloResponse = await smtpCommand(socket, reader, "EHLO localhost", [250])
    }
    await authenticateSmtp(socket, reader, config, ehloResponse)
    await smtpCommand(socket, reader, `MAIL FROM:<${envelopeFrom}>`, [250])
    await smtpCommand(socket, reader, `RCPT TO:<${envelopeTo}>`, [250])
    await smtpCommand(socket, reader, "DATA", [354])
    await writeSmtp(socket, `${data}\r\n.\r\n`)
    const dataResponse = await readSmtpResponse(reader)
    if (dataResponse.code !== 250) {
      throw new Error(`SMTP DATA failed with response ${dataResponse.code}.`)
    }
  } finally {
    try {
      await smtpCommand(socket, reader, "QUIT", [221, 250])
    } catch {
      socket.destroy()
    }
    reader.close()
    if (!socket.destroyed) socket.end()
  }
}

export function createSmtpRecoveryEmailSender({ env = process.env } = {}) {
  const config = smtpConfigFromEnv(env)
  if (!config) return undefined
  return async function sendRecoveryEmail(message) {
    await sendSmtpRecoveryEmail(config, message)
  }
}

function withRecoveryEmailSender(store, recoveryEmailSender) {
  if (!recoveryEmailSender || typeof store.sendRecoveryEmail === "function") {
    return store
  }
  return {
    ...store,
    sendRecoveryEmail: recoveryEmailSender
  }
}

function createDefaultLicenseStore(env) {
  if (env.PHOTOSWEEP_LICENSE_STORE === "firestore") {
    return createFirestoreLicenseStore({
      collectionPrefix: env.PHOTOSWEEP_FIRESTORE_COLLECTION_PREFIX
    })
  }
  return createJsonFileLicenseStore(
    env.PHOTOSWEEP_LICENSE_STORE_PATH ??
      path.resolve(process.cwd(), DEFAULT_STORE_PATH)
  )
}

export function createNodeRequestHandler({
  env = process.env,
  store = undefined,
  fetchImpl = fetch,
  recoveryEmailSender = undefined,
  api = undefined
} = {}) {
  const baseStore = store ?? createDefaultLicenseStore(env)
  const licenseStore = withRecoveryEmailSender(
    baseStore,
    recoveryEmailSender ??
      createWebhookRecoveryEmailSender({ env, fetchImpl }) ??
      createSmtpRecoveryEmailSender({ env })
  )
  const licenseApi =
    api ?? createLicenseApi({ env, store: licenseStore, fetchImpl })
  return async function nodeRequestHandler(nodeRequest, nodeResponse) {
    try {
      const method = nodeRequest.method ?? "GET"
      const body =
        method === "GET" || method === "HEAD"
          ? undefined
          : await readBody(nodeRequest)
      const response = await licenseApi(
        new Request(requestUrl(nodeRequest, env), {
          method,
          headers: requestHeaders(nodeRequest),
          body
        })
      )

      nodeResponse.statusCode = response.status
      nodeResponse.statusMessage = response.statusText
      response.headers.forEach((value, key) => {
        nodeResponse.setHeader(key, value)
      })
      if (response.body) {
        nodeResponse.end(Buffer.from(await response.arrayBuffer()))
      } else {
        nodeResponse.end()
      }
    } catch (error) {
      nodeResponse.statusCode = 500
      nodeResponse.setHeader("content-type", "application/json")
      nodeResponse.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        })
      )
    }
  }
}

export function startNodeLicenseServer({
  env = process.env,
  port = Number(env.PORT ?? DEFAULT_PORT),
  host = env.HOST ?? "0.0.0.0",
  handler = createNodeRequestHandler({ env })
} = {}) {
  const server = http.createServer(handler)
  server.listen(port, host, () => {
    console.log(`PhotoSweep license API listening on http://${host}:${port}`)
  })
  return server
}

const currentFile = fileURLToPath(import.meta.url)
const invokedFile = process.argv[1]
  ? fileURLToPath(pathToFileURL(process.argv[1]))
  : ""

if (currentFile === invokedFile) {
  startNodeLicenseServer()
}
