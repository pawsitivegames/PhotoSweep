# PhotoSweep Support

Last updated: 2026-10-21

## Support Channels

For paid license, refund, privacy, or deletion requests, email:

[pawsitivegames@gmail.com](mailto:pawsitivegames@gmail.com)

For product information, help, and updates, visit the PhotoSweep site:

https://photosweep.pawsitivegames.chatgpt.site/

For bug reports, feature requests, or troubleshooting, email:

[pawsitivegames@gmail.com](mailto:pawsitivegames@gmail.com)

## What To Include

For paid support, include:

- purchase email
- plan purchased
- approximate purchase date
- extension version
- provider
- short description of the issue
- optional paid-user diagnostics export

Do not send photo URLs, thumbnails, filenames, album names, raw reports, exact
timestamps, people/location labels, page content, or screenshots that reveal
private photo content unless support explicitly asks for a redacted example.

## Expected Response

Support should acknowledge paid license, refund, privacy, and deletion requests
within 3 business days.

Refund requests follow the published refund policy in `docs/REFUND_POLICY.md`.
Privacy and deletion requests follow the published privacy policy in
`docs/PRIVACY_POLICY.md`.

## Operator Procedure

The release owner handles this mailbox. Read the
[release operations runbook](RELEASE_OPERATIONS.md) before investigating a
backend or payment issue. A support request does not authorize an automated
refund, production record change, provider Trash action, or customer reply.

1. Acknowledge the request within the response window above. Collect only the
   information listed under **What To Include**. Ask the purchaser to contact
   support from the purchase address if identity is uncertain; do not request
   a password, recovery link, session cookie, entitlement token or photo report.
2. For paid-access issues, check the extension version and normal **Refresh
   license** path first. Use the documented purchase-recovery flow when needed.
   Recovery links are reusable for 24 hours; never forward or paste them into
   diagnostic records. Respect the durable 15-minute send cooldown. Use a
   neutral acknowledgement that does not reveal whether an email is eligible.
3. For refunds, compare the request with the published policy and inspect only
   the matching payment. Check for an existing refund or dispute before proposing
   another action. Present the exact payment, amount and environment privately
   for owner approval before issuing a refund. After an approved full refund,
   verify webhook processing and paid-access removal; a partial refund preserves
   the purchase. Do not promise a settlement date or manually grant access to
   work around an unresolved payment state.
4. For access or deletion requests, verify identity and prepare a bounded data
   inventory. The backend has license records, email/payment indexes, processed
   Stripe-event markers, pending revocations and consent-based analytics. A
   license row alone is not a complete inventory. Avoid querying or exporting
   unrelated customers. Check the privacy policy's retention exceptions and
   distinguish PhotoSweep records, Stripe records and support-mail records.
5. Before deleting or exporting production records, prepare a request-specific
   review naming the records, necessary retained fields, authorization, expected
   effect on paid access and verification. Preserve replay/revocation safeguards;
   never delete security markers blindly. This procedure does not authorize a
   production deletion or data export. If the safe operation is unclear, escalate
   to the owner before making a claim or changing data.
6. Explain the result accurately. Active analytics have a 90-day expiry with
   Firestore TTL normally running within 24 hours afterward. Deleted active
   records can remain in daily backup snapshots for up to the published 14-day
   retention. Do not promise immediate deletion from backups, payment/legal
   records, the user's local browser or their photo provider.
7. Record the request, decision, scoped actions, verification and response time
   without copying credentials or private media. Obtain approval for the exact
   customer reply before sending it through an agent.

## Response Templates

These are drafts for owner review, not messages sent automatically.

**Acknowledgement:** Thanks for contacting PhotoSweep support. We received your
request and will review it. Please include the plan,
approximate purchase date, extension version, provider and a short description
if you have not already. Do not send passwords, recovery links, photo content or
raw scan reports.

**Paid access:** Please try Refresh license in PhotoSweep. If access is still
missing, use Restore purchase with the email used at checkout. Recovery requests
receive the same response whether or not an eligible purchase is found. If a
message arrives, open its link yourself; do not forward it to support.

**Refund:** We will review the matching payment under the published seven-day
refund policy and confirm the decision before taking action. Please send only
the purchase email, approximate date, plan and a short description of the issue.

**Privacy or deletion:** We received your request. We will first verify that you
control the purchase address, then explain the records covered and any retention
exceptions. We will confirm what was changed or retained after verification;
active-record deletion does not immediately remove existing backup snapshots.
