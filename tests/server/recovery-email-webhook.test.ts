import { describe, expect, it } from "vitest"

import {
  createRecoveryEmailWebhook,
  RESEND_EMAILS_URL
} from "../../server/recovery-email-webhook/server.mjs"

describe("recovery email webhook", () => {
  it("sends a license recovery message through Resend", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const handler = createRecoveryEmailWebhook({
      env: {
        NODE_ENV: "test",
        RESEND_API_KEY: "re_placeholder",
        RESEND_FROM: "PhotoSweep <recovery@example.test>",
        PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_SECRET: "webhook_placeholder"
      },
      fetchImpl: async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response(JSON.stringify({ id: "email_placeholder" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      }
    })

    const response = await handler(
      new Request("https://recovery.example.test/", {
        method: "POST",
        headers: {
          authorization: "Bearer webhook_placeholder",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          type: "license_recovery",
          email: "buyer@example.com",
          recoveryUrl:
            "https://photosweep.example/license/recover/complete?token=token_placeholder"
        })
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(RESEND_EMAILS_URL)
    expect(calls[0].init.method).toBe("POST")
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(
      "Bearer re_placeholder"
    )
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: "PhotoSweep <recovery@example.test>",
      to: ["buyer@example.com"],
      subject: "PhotoSweep license recovery",
      text: "https://photosweep.example/license/recover/complete?token=token_placeholder"
    })
  })

  it("allows requests without a bearer secret when none is configured", async () => {
    let calls = 0
    const handler = createRecoveryEmailWebhook({
      env: {
        NODE_ENV: "test",
        RESEND_API_KEY: "re_placeholder",
        RESEND_FROM: "recovery@example.test"
      },
      fetchImpl: async () => {
        calls += 1
        return new Response(null, { status: 200 })
      }
    })

    const response = await handler(
      new Request("https://recovery.example.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "license_recovery",
          email: "buyer@example.com",
          recoveryUrl:
            "https://photosweep.example/recover?token=token_placeholder"
        })
      })
    )

    expect(response.status).toBe(200)
    expect(calls).toBe(1)
  })

  it("rejects a bad bearer secret without calling Resend", async () => {
    let calls = 0
    const handler = createRecoveryEmailWebhook({
      env: {
        NODE_ENV: "test",
        RESEND_API_KEY: "re_placeholder",
        RESEND_FROM: "recovery@example.test",
        PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_SECRET: "webhook_placeholder"
      },
      fetchImpl: async () => {
        calls += 1
        return new Response(null, { status: 200 })
      }
    })

    const response = await handler(
      new Request("https://recovery.example.test/", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong_placeholder",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          type: "license_recovery",
          email: "buyer@example.com",
          recoveryUrl:
            "https://photosweep.example/recover?token=token_placeholder"
        })
      })
    )

    expect(response.status).toBe(401)
    expect(calls).toBe(0)
  })
})
