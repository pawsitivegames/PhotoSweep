import http from "node:http"
import { fileURLToPath, pathToFileURL } from "node:url"

const DEFAULT_HOST = "0.0.0.0"
const DEFAULT_PORT = 8080
export const RESEND_EMAILS_URL = "https://api.resend.com/emails"
export const RECOVERY_EMAIL_SUBJECT = "PhotoSweep license recovery"

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: new Headers({
      "content-type": "application/json; charset=utf-8",
      ...headers
    })
  })
}

function configurationError(name) {
  const error = new Error(`${name} is required.`)
  error.code = "CONFIGURATION"
  return error
}

function requiredEnv(env, name) {
  const value = env?.[name]
  if (typeof value !== "string" || !value.trim()) {
    throw configurationError(name)
  }
  return value.trim()
}

function validEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+$/.test(value.trim())
}

function validRecoveryUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false
  try {
    const url = new URL(value.trim())
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

function unauthorizedResponse() {
  return jsonResponse(
    { error: "Unauthorized." },
    {
      status: 401,
      headers: { "www-authenticate": "Bearer" }
    }
  )
}

export async function sendRecoveryEmailWithResend({
  env = process.env,
  fetchImpl = fetch,
  email,
  recoveryUrl
} = {}) {
  const apiKey = requiredEnv(env, "RESEND_API_KEY")
  const from = requiredEnv(env, "RESEND_FROM")
  const response = await fetchImpl(RESEND_EMAILS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: RECOVERY_EMAIL_SUBJECT,
      text: recoveryUrl
    })
  })

  if (!response.ok) {
    throw new Error(`Resend request failed with status ${response.status}.`)
  }
}

export function createRecoveryEmailWebhook({
  env = process.env,
  fetchImpl = fetch
} = {}) {
  return async function recoveryEmailWebhook(request) {
    if (request.method !== "POST") {
      return jsonResponse(
        { error: "Method not allowed." },
        { status: 405, headers: { allow: "POST" } }
      )
    }

    const sharedSecret = env?.PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_SECRET
    if (
      sharedSecret &&
      request.headers.get("authorization") !== `Bearer ${sharedSecret}`
    ) {
      return unauthorizedResponse()
    }

    const body = await request.json().catch(() => undefined)
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      body.type !== "license_recovery" ||
      !validEmail(body.email) ||
      !validRecoveryUrl(body.recoveryUrl)
    ) {
      return jsonResponse(
        { error: "Expected a license recovery email payload." },
        { status: 400 }
      )
    }

    try {
      await sendRecoveryEmailWithResend({
        env,
        fetchImpl,
        email: body.email.trim(),
        recoveryUrl: body.recoveryUrl.trim()
      })
    } catch (error) {
      if (error?.code === "CONFIGURATION") {
        return jsonResponse(
          { error: "Recovery email service is not configured." },
          { status: 500 }
        )
      }
      return jsonResponse(
        { error: "Recovery email delivery failed." },
        { status: 502 }
      )
    }

    return jsonResponse({ ok: true })
  }
}

export const createRecoveryEmailWebhookHandler = createRecoveryEmailWebhook

function requestUrl(nodeRequest, env) {
  const forwardedProto = nodeRequest.headers["x-forwarded-proto"]
  const proto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto || "http"
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

export function createNodeRequestHandler({
  env = process.env,
  fetchImpl = fetch,
  handler = undefined
} = {}) {
  const webhook = handler ?? createRecoveryEmailWebhook({ env, fetchImpl })

  return async function nodeRequestHandler(nodeRequest, nodeResponse) {
    try {
      const method = nodeRequest.method ?? "GET"
      const requestInit = {
        method,
        headers: requestHeaders(nodeRequest)
      }
      if (method !== "GET" && method !== "HEAD") {
        requestInit.body = await readBody(nodeRequest)
      }
      const response = await webhook(
        new Request(requestUrl(nodeRequest, env), requestInit)
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
    } catch {
      nodeResponse.statusCode = 500
      nodeResponse.setHeader("content-type", "application/json")
      nodeResponse.end(JSON.stringify({ error: "Webhook request failed." }))
    }
  }
}

export function startRecoveryEmailWebhookServer({
  env = process.env,
  port = Number(env.PORT ?? DEFAULT_PORT),
  host = env.HOST ?? DEFAULT_HOST,
  fetchImpl = fetch,
  handler = undefined
} = {}) {
  const server = http.createServer(
    createNodeRequestHandler({ env, fetchImpl, handler })
  )
  server.listen(port, host, () => {
    console.log(
      `PhotoSweep recovery email webhook listening on http://${host}:${port}`
    )
  })
  return server
}

const currentFile = fileURLToPath(import.meta.url)
const invokedFile = process.argv[1]
  ? fileURLToPath(pathToFileURL(process.argv[1]))
  : ""

if (currentFile === invokedFile) {
  startRecoveryEmailWebhookServer()
}
