# PhotoSweep Licensing Backend

This repo includes a minimal Stripe Checkout and signed-entitlement API in
`server/license-api.mjs`. It is framework-neutral: deploy it behind any runtime
or adapter that can pass a Web `Request` to `createLicenseApi()`.

For a small Node deployment, the included adapter can be started with:

```bash
npm run license:serve
```

By default it listens on `127.0.0.1:8787` and uses
`.photosweep/license-store.json`. Set `HOST`, `PORT`, and
`PHOTOSWEEP_LICENSE_STORE_PATH` as needed.

## Endpoints

- `POST /checkout`

  - Body: `{ "planId": "mini_cleanup" | "cleanup_pass" | "lifetime", "email"?: string }`
  - Creates a Stripe Checkout Session.
  - When `email` is provided, also sets Stripe `payment_intent_data[receipt_email]` so Stripe can send the payment receipt.
  - Sets an HttpOnly `photosweep_license_session` cookie and stores the same
    session id in Stripe session metadata.

- `GET /entitlement`

  - Reads `photosweep_license_session` from the cookie, or
    `x-photosweep-license-session` for non-browser/test clients.
  - Returns `{ "token": "payload.signature" }`.
  - The extension verifies the token with the bundled public key.

- `POST /license/recover`

  - Body: `{ "email": "buyer@example.com" }`
  - Default behavior is privacy-preserving acknowledgement only.
  - If the store provides `sendRecoveryEmail({ email, recoveryUrl })`, the API
    sends a short-lived signed recovery link without revealing whether the email
    exists.
  - Recovery links expire after 24 hours.
  - The included Node adapter can provide that method through a generic webhook
    by setting `PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_URL`.
  - The included Node adapter can also send email in-process over SMTP when
    `PHOTOSWEEP_SMTP_HOST` and `PHOTOSWEEP_SMTP_FROM` are both set.
  - The included email-only cookie rebind is disabled unless
    `PHOTOSWEEP_UNSAFE_EMAIL_RECOVERY=1` is set for local/manual testing.

- `GET /license/recover/complete?token=...`

  - Verifies the signed recovery token.
  - Sets the `photosweep_license_session` cookie.
  - Redirects to `PHOTOSWEEP_RECOVERY_REDIRECT_URL` or checkout success URL.

- `POST /analytics`

  - Body is one allowlisted product/reliability event.
  - Accepted fields are event name, provider, scan mode, plan id, count buckets,
    and error category.
  - The backend sanitizes the event again before bounded storage.
  - Photo URLs, thumbnails, filenames, album names, exact timestamps,
    people/location labels, page content, and raw reports are not accepted.

- `POST /stripe/webhook`
  - Verifies the `Stripe-Signature` header.
  - Activates entitlements only after a paid `checkout.session.completed` or
    `checkout.session.async_payment_succeeded` event.
  - Does not unlock an unpaid delayed-payment Checkout session.
  - Deactivates only the matching purchase on a full refund or dispute. The
    effective entitlement remains the highest valid purchase in that browser
    session, so refunding one purchase cannot revoke unrelated paid access. A
    partial refund does not revoke the whole purchase.
  - Deduplicates events by Stripe event id.

## Plans

| Plan                  | Stripe price env var                            | Behavior                                                                                    |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Mini Cleanup          | `PHOTOSWEEP_STRIPE_PRICE_MINI_CLEANUP`          | Permanent limited unlock: 2,500 photos per scan, 75 groups, and 100 Trash moves per session |
| Cleanup Pass          | `PHOTOSWEEP_STRIPE_PRICE_CLEANUP_PASS_7D`       | Expires 7 days after purchase                                                               |
| Lifetime Early Access | `PHOTOSWEEP_STRIPE_PRICE_LIFETIME_EARLY_ACCESS` | One-time unlimited cleanup limits for the supported lifetime of the product                 |

The extension-side limits remain the source of product behavior. The backend
only decides which signed plan is active. Each license session retains its
purchase ledger, keyed by Stripe Checkout Session and Payment Intent. The
highest valid purchase wins in this order: Lifetime Early Access, Cleanup Pass,
then Mini Cleanup. Refund and dispute events must identify the matching payment
or Checkout Session; customer-only events are not allowed to revoke access.

All signed entitlement tokens have a maximum 30-day validity window. The
extension refreshes an existing token at startup, so online refunds and
revocations reconcile promptly while a temporary license-service outage does not
immediately lock out a valid Mini Cleanup or Lifetime purchaser. Cleanup Pass
tokens still expire at the earlier seven-day plan boundary.

Create the Stripe products/prices with:

```bash
STRIPE_SECRET_KEY=sk_live_... npm run stripe:setup-products
```

The script uses idempotency keys and prints the three `PHOTOSWEEP_STRIPE_PRICE_*`
environment variables required by the license API. Run it first in Stripe test
mode, then repeat with live keys when checkout is ready to launch.

## Key Generation

Generate a P-256 key pair. Keep the private key only on the backend and bundle
the public key into the extension build.

```bash
node --input-type=module <<'NODE'
import crypto from "node:crypto"
const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "prime256v1"
})
console.log("PHOTOSWEEP_ENTITLEMENT_PRIVATE_KEY=")
console.log(Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64url"))
console.log("PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY=")
console.log(publicKey.export({ type: "spki", format: "der" }).toString("base64url"))
NODE
```

## Extension Build Vars

Set these when building the production extension:

```bash
PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL=https://photosweep-license-api-206538169327.us-west1.run.app
PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY=BASE64URL_SPKI_PUBLIC_KEY
```

Do not set `PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=1` for production
builds. That flag exists only for integration tests and local development.

The release and CI workflows currently inject the verified Cloud Run URL above,
and the extension manifest receives its matching host permission from that
build variable. If the license API is deployed somewhere else, update the build
variable, workflow configuration, and `package.json` host permission together
before building the production extension. Do not substitute an unverified custom
domain for the deployed URL.

## Store Adapter

`createMemoryLicenseStore()` is intentionally minimal and is suitable for tests
only.

`createJsonFileLicenseStore(path)` is durable enough for a single long-lived
Node process or a small private launch on one instance, including the
`npm run license:serve` adapter. It is not safe for multi-instance/serverless
production because concurrent writes can race.

Production at scale should provide a database-backed store with the same
methods. `upsertLicense` must preserve every purchase in the license record's
`purchases` ledger rather than replacing an earlier purchase for the same
browser session:

- `getLicenseBySessionId(sessionId)`
- `upsertLicense(license)`
- `deactivateLicense(sessionId, reason)`
- `getSessionIdByEmail(email)`
- `getSessionIdByStripeCustomerId(customerId)`
- `getSessionIdByStripeCheckoutSessionId(checkoutSessionId)`
- `getSessionIdByStripePaymentIntentId(paymentIntentId)`
- `hasProcessedStripeEvent(eventId)`
- `markStripeEventProcessed(eventId)`
- `recordAnalyticsEvent(event)` for privacy-safe funnel/reliability events.
  The included memory and JSON stores retain the latest 1,000 sanitized events.
- Optional: `sendRecoveryEmail({ email, recoveryUrl })` for production recovery
  email delivery.

Use a database table for licenses and a unique table/index for processed Stripe
event ids so webhook handling remains idempotent across deploys and instances.

## Recovery Email Delivery

For the included Node server, sender selection is, in order: an explicit
`recoveryEmailSender` passed to `createNodeRequestHandler()`, the webhook when
`PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_URL` is set, the in-process SMTP sender when
both SMTP activation variables are set, and then no sender. An existing
`store.sendRecoveryEmail` implementation remains in place.

The webhook sender accepts:

```bash
PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_URL=https://mail-automation.example/photosweep/recovery
PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_SECRET=replace-with-random-shared-secret
```

When a matching license email exists, the server posts:

```json
{
  "type": "license_recovery",
  "email": "buyer@example.com",
  "recoveryUrl": "https://photosweep-license-api-206538169327.us-west1.run.app/license/recover/complete?token=..."
}
```

If `PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_SECRET` is set, the request includes an
`Authorization: Bearer ...` header. The mailer should send only the recovery
link and should not echo whether a license exists back to the extension.

The in-process SMTP sender accepts these variables. `USER` and `PASS` are
optional, but must be supplied together when used:

```bash
PHOTOSWEEP_SMTP_HOST=<SMTP_HOST>
PHOTOSWEEP_SMTP_PORT=<SMTP_PORT>
PHOTOSWEEP_SMTP_USER=<SMTP_USERNAME>
PHOTOSWEEP_SMTP_PASS=<SMTP_PASSWORD>
PHOTOSWEEP_SMTP_FROM=<SMTP_FROM_ADDRESS>
PHOTOSWEEP_SMTP_SECURE=0
```

`PHOTOSWEEP_SMTP_SECURE=0` selects a non-implicit-TLS connection (the default
port is `587`); if the server advertises STARTTLS, the adapter upgrades the
connection before authentication. If `PHOTOSWEEP_SMTP_SECURE` is omitted, the
adapter uses implicit TLS with default port `465`. The SMTP message is plain
text with subject `PhotoSweep license recovery`, and its body is exactly the
`recoveryUrl` value with no additional text.

### CoS-owned production secrets

The Chief of Staff (CoS) owns the production SMTP credentials, Secret Manager
entries, access grants, and rotation record. Keep secret values out of the
repository and documentation. Use placeholders for the actual project, service,
secret, version, and file identifiers:

1. CoS creates or rotates separate Secret Manager entries for the SMTP username
   and password, using the approved secret material outside this repository.

   ```bash
   gcloud secrets create <SMTP_USER_SECRET_NAME> \
     --project=<GCP_PROJECT_ID> --replication-policy=automatic
   gcloud secrets versions add <SMTP_USER_SECRET_NAME> \
     --project=<GCP_PROJECT_ID> --data-file=<SMTP_USER_VALUE_FILE>
   gcloud secrets create <SMTP_PASS_SECRET_NAME> \
     --project=<GCP_PROJECT_ID> --replication-policy=automatic
   gcloud secrets versions add <SMTP_PASS_SECRET_NAME> \
     --project=<GCP_PROJECT_ID> --data-file=<SMTP_PASS_VALUE_FILE>
   ```

2. CoS grants the Cloud Run service account access to only those secret entries:

   ```bash
   gcloud secrets add-iam-policy-binding <SMTP_USER_SECRET_NAME> \
     --project=<GCP_PROJECT_ID> \
     --member=serviceAccount:<CLOUD_RUN_SERVICE_ACCOUNT> \
     --role=roles/secretmanager.secretAccessor
   gcloud secrets add-iam-policy-binding <SMTP_PASS_SECRET_NAME> \
     --project=<GCP_PROJECT_ID> \
     --member=serviceAccount:<CLOUD_RUN_SERVICE_ACCOUNT> \
     --role=roles/secretmanager.secretAccessor
   ```

3. CoS maps the secrets and non-secret SMTP settings onto the existing Cloud Run
   service. The values below are placeholders only:

   ```bash
   gcloud run services update <CLOUD_RUN_SERVICE_NAME> \
     --project=<GCP_PROJECT_ID> --region=<GCP_REGION> \
     --set-env-vars="PHOTOSWEEP_SMTP_HOST=<SMTP_HOST>,PHOTOSWEEP_SMTP_PORT=<SMTP_PORT>,PHOTOSWEEP_SMTP_FROM=<SMTP_FROM_ADDRESS>,PHOTOSWEEP_SMTP_SECURE=<SMTP_SECURE>" \
     --set-secrets="PHOTOSWEEP_SMTP_USER=<SMTP_USER_SECRET_NAME>:<SECRET_VERSION>,PHOTOSWEEP_SMTP_PASS=<SMTP_PASS_SECRET_NAME>:<SECRET_VERSION>"
   ```

4. CoS records the owner and rotation date, then verifies a recovery request in
   the deployed environment without exposing account-existence information.

## Chrome Extension Constraints

The extension must not load remote executable code. Stripe Checkout opens as an
external page, and the extension talks to this backend only through JSON API
requests for checkout and entitlement state.
