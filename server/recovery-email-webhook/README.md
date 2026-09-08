# PhotoSweep Resend recovery email webhook

This is a dependency-free Cloud Run receiver for the recovery webhook emitted
by `server/node-server.mjs`. It accepts a `license_recovery` JSON payload and
sends the recovery link through the Resend API.

The receiver is a scaffold only. The owner must verify a Resend sending domain,
create the production secrets, and approve any deployment. No production domain,
API key, or secret value belongs in this repository.

## Contract

Send a `POST` request to the Cloud Run service URL:

```json
{
  "type": "license_recovery",
  "email": "buyer@example.com",
  "recoveryUrl": "https://photosweep.example/license/recover/complete?token=..."
}
```

When `PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_SECRET` is set, the request must also
include:

```text
Authorization: Bearer <RECOVERY_WEBHOOK_SECRET_VALUE>
```

The receiver sends `RESEND_FROM` to the recipient using the
`RESEND_API_KEY` credential and returns `{ "ok": true }` after Resend accepts
the message. Invalid payloads return `400`; a bad bearer token returns `401`;
provider failures return `502`.

## Configuration

Set these on the receiver. Use Secret Manager for `RESEND_API_KEY` and the
shared webhook secret:

```text
RESEND_API_KEY=<RESEND_API_KEY_SECRET_VALUE>
RESEND_FROM=<RESEND_FROM_ADDRESS>
PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_SECRET=<RECOVERY_WEBHOOK_SECRET_VALUE>
```

`RESEND_FROM` must use a mailbox on a Resend sending domain that the owner has
verified. The receiver defaults to Cloud Run's `PORT` when provided, otherwise
it listens on `8080`.

## Cloud Run wiring (`photosweep-prod`)

The commands below are placeholders and are not deployment instructions that
have been executed. Replace only the angle-bracketed identifiers after the
owner has approved the domain, service account, and secret material.

From the repository root, deploy the receiver:

```bash
gcloud run deploy <RECOVERY_WEBHOOK_SERVICE_NAME> \
  --project=photosweep-prod \
  --region=<GCP_REGION> \
  --source=server/recovery-email-webhook \
  --allow-unauthenticated \
  --set-env-vars="RESEND_FROM=<RESEND_FROM_ADDRESS>" \
  --set-secrets="RESEND_API_KEY=<RESEND_API_KEY_SECRET_NAME>:<SECRET_VERSION>,PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_SECRET=<RECOVERY_WEBHOOK_SECRET_NAME>:<SECRET_VERSION>"
```

Grant the receiver's Cloud Run service account access only to the two mapped
Secret Manager entries. Then point the existing license API at the receiver:

```bash
gcloud run services update <LICENSE_API_SERVICE_NAME> \
  --project=photosweep-prod \
  --region=<GCP_REGION> \
  --set-env-vars="PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_URL=<RECOVERY_WEBHOOK_SERVICE_URL>" \
  --set-secrets="PHOTOSWEEP_RECOVERY_EMAIL_WEBHOOK_SECRET=<RECOVERY_WEBHOOK_SECRET_NAME>:<SECRET_VERSION>"
```

The license API sender selects the webhook before its in-process SMTP sender.
Keep the SMTP configuration available as the temporary migration fallback;
SMTP is used when the webhook URL is not configured. Do not set
`PHOTOSWEEP_UNSAFE_EMAIL_RECOVERY` as part of this wiring.

## Local tests

From the repository root:

```bash
npx vitest run tests/server/recovery-email-webhook.test.ts
```
