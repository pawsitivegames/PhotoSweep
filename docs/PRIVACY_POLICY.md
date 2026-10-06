# PhotoSweep Privacy Policy

Last updated: 2026-10-06

## Summary

PhotoSweep finds duplicate and near-duplicate photos in supported online photo
libraries. Duplicate analysis runs locally in the browser extension. PhotoSweep
does not upload photo content to its license service for duplicate analysis.

When you scan, PhotoSweep sends requests to the photo provider you selected using
your signed-in provider session. Those requests retrieve library data needed for
the scan. If you confirm moving items to Trash or choose Undo, PhotoSweep sends
the selected item identifiers and the requested change to that same provider.
These provider requests are separate from PhotoSweep's license and analytics
services.

Before the first provider scan, the extension displays an in-product data-use
notice and requires the user to choose “I understand, continue” before it
connects to a provider tab. The notice links to this policy. Users can later
revisit the optional usage-metrics choice from the extension UI.

## Data Processed Locally

PhotoSweep may read and process these items inside the browser to provide scan,
review, report, Trash, undo, original-byte verification, and diagnostics features:

- photo and video thumbnails loaded by the supported provider page
- provider item identifiers needed to show results and move selected items to Trash
- basic media metadata shown by the provider page, such as dimensions, dates, and
  provider URLs
- duplicate groups, review decisions, keep/skip choices, scan checkpoints, and
  locally generated reports
- local embedding/cache data used to avoid repeating expensive duplicate analysis
- license session id used to refresh paid access after checkout or recovery
- signed entitlement token state cached for offline/paid-access checks
- a provider account email or identifier exposed by a signed-in provider page,
  when needed to associate saved scan state with the provider account
- when you click “Verify original bytes,” the selected item's original bytes are
  fetched into the browser for a local SHA-256 check. The check is limited to
  25 MiB per item and 100 MiB per review. Amazon Photos original-byte checks are
  currently verified only for Amazon Photos Canada. The digest and byte count
  are retained with the review; the original bytes and temporary resource URLs
  are discarded after the check.

Saved review, result, and cache data is stored with Chrome extension storage on
the user's device. Users can clear saved results and cache data from the
extension UI.

## Data Shared With Photo Providers

A scan sends authenticated read requests to the provider you selected. These
requests may include paging information, the selected album or scan scope, and
provider item or record identifiers needed to retrieve the requested library
records. The provider returns the matching library data to the browser. PhotoSweep
sends these requests to the selected provider, not to the other supported photo
providers.

Moving items to Trash is a separate action. PhotoSweep shows a confirmation and
requires the user to type the number of selected items before enabling “Move to
Trash.” It then sends the selected item identifiers and Trash operation to the
selected provider. Choosing Undo sends the selected identifiers and a restore
operation to that provider. The provider applies its own account, Trash, and
permanent-deletion rules.

Original-byte verification is optional and starts only when the user clicks
“Verify original bytes.” The browser requests the selected item's original from
the selected provider or its media host, computes SHA-256 locally, and keeps the
result with the review. PhotoSweep does not send the fetched original bytes to
its license or analytics service.

Provider requests use the signed-in provider session. PhotoSweep does not send
your provider password to its services.

## Data Sent To PhotoSweep Services

PhotoSweep's license service receives information needed to start checkout,
recover a license, refresh entitlement state, prevent abuse, and support paid
users.

License and support data may include:

- selected plan id and license session id
- Stripe customer, checkout session, and payment identifiers
- buyer email when supplied through Stripe Checkout or a license recovery flow
- signed entitlement token state
- extension version, a locally generated opaque install id, a UTC day key,
  provider, plan, scan mode, count buckets, error category, and limited product
  telemetry events when the user accepts optional usage metrics

Optional client telemetry is sent only after the user accepts the in-product
disclosure. It helps measure reliability and feature use and can be declined
without affecting scans, review, reports, Trash, licensing, or recovery. The
validated event data does not include photo content, filenames, album names, raw
reports, or provider URLs. The install id is a random UUID kept in Chrome
extension storage. It is not derived from or linked to a Google, iCloud, or Amazon
account, email address, photo URL, or other photo data. It is sent only with
consent and is not reset when the user changes providers.

The analytics request uses browser credentials for the license API. If a
PhotoSweep license session cookie exists for that API host, the browser may send
it with the consenting analytics request. The cookie is named
`photosweep_license_session`; the server sets it as HttpOnly, SameSite=None, and
Secure by default, with a 30-day lifetime. The analytics handler validates and
stores the event body; the reviewed handler does not read the cookie to enrich the
event.

Payment lifecycle events created by the license service, such as a completed
purchase or full refund, are recorded as operational payment events without
photo-library context.

The license service must not receive photo URLs, thumbnails, filenames, album
names, exact timestamps from the client, people/location labels, page content, or
original photo bytes. It may stamp a server receipt time on accepted telemetry
for aggregate funnel calculations; that receipt time is not supplied by the
client.

Support diagnostics are created as a redacted JSON file and downloaded locally.
The file can include the app version, provider, scan mode, plan and entitlement
source, count buckets, error category, creation time, and recent redacted logs.
Exporting the file does not upload it to PhotoSweep. If the user chooses to send
the file to support, the user initiates that separate email. With analytics
consent, PhotoSweep may separately receive a limited `export_clicked` event; the
diagnostics file itself is not part of that event.

## Third Parties and Service Providers

### Photo-library providers

Google Photos, iCloud Photos, and Amazon Photos receive the authenticated scan
requests described above when selected. The selected provider also receives
Trash and Undo requests for the user-selected items. Original-byte verification
retrieves the chosen item from its provider; Amazon Photos original-byte checks
are currently verified only for Amazon Photos Canada.

### Checkout, hosting, storage, and recovery email

Configuration evidence reviewed on 2026-10-06 shows that the release build sends
extension license requests to the PhotoSweep license API at
`https://photosweep-license-api-206538169327.us-west1.run.app`, hosted on Google
Cloud Run. The current Cloud Run configuration uses Google Cloud Firestore for
license and analytics storage. The code stores license records, lookup indexes,
Stripe event records, pending revocations, and analytics events in Firestore.

The license server creates checkout sessions through Stripe's API at
`api.stripe.com`; checkout opens at `checkout.stripe.com`. Stripe may process
payment details, receipts, fraud checks, and related transaction records under
Stripe's own terms and privacy policy.

The Cloud Run configuration reviewed on 2026-10-06 sends recovery email through
Gmail SMTP at `smtp.gmail.com`, using `pawsitivegames@gmail.com` as the sender.
SMTP credentials are managed through Secret Manager references; their values are
not disclosed here. The recovery-email webhook is not configured. Gmail receives the
recovery email address and link needed to deliver the message. A Resend receiver
exists as a deployment scaffold but is not the configured recovery-email path.

If you email support at `pawsitivegames@gmail.com`, Google/Gmail processes that
message as the mailbox provider. This support mailbox is the same address used
as the configured recovery-email sender.

PhotoSweep does not sell user data and does not use photo-derived data for ads.

## Chrome Web Store Limited Use Statement

PhotoSweep complies with the Chrome Web Store User Data Policy and Limited Use
requirements. It uses Chrome extension permissions and provider page access only
to provide or improve its single purpose: finding, reviewing, reporting, and
safely cleaning duplicate photos in supported photo libraries. PhotoSweep does
not use this data for advertising, unrelated profiling, or unrelated data
brokerage.

PhotoSweep transfers user data only when needed to operate provider features
you request, provide licensing/support, comply with law, protect against
abuse/security issues, or with explicit user consent. PhotoSweep does not allow
people to read raw photo-library data. Any human access is limited to a user's
explicit request for specific support data, security/abuse investigation, legal
compliance, or aggregate and anonymized internal operations.

## Data Retention

Local scan data remains on the user's device until the user clears it, removes
the extension, or Chrome clears extension storage. Original-byte verification
retains the digest evidence with the review, not the original bytes or temporary
resource URLs.

License records are retained while needed to provide paid access, receipts,
refund handling, support, fraud prevention, accounting, tax, and legal
compliance. The current production configuration reviewed on 2026-10-06 uses
Firestore for analytics storage, but the reviewed source does not define a fixed
retention or deletion period for server-side analytics events.

## Refunds And Deletion Requests

Users can request support, refunds, or deletion of license records by contacting:

`pawsitivegames@gmail.com`

Some payment, tax, accounting, fraud-prevention, and legal records may need to be
retained even after a deletion request.

## Security

PhotoSweep signs license entitlements server-side and verifies them in the
extension with a bundled public key. The private signing key remains on the
license server.

PhotoSweep extension pages do not load remote executable JavaScript. Checkout
opens externally through Stripe.
