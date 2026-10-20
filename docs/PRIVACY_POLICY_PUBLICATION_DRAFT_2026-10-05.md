# PhotoSweep public privacy-copy draft

**Status:** Review draft only; not published.
**Target scope:** The local Chrome 2.3.6.5 candidate (app version 2.3.6), ZIP `build/photosweep-cws-v2.3.6.5-sha256-fb29344362a8.zip`, SHA-256 `fb29344362a8dea4906522d2f2f207ba3a97ad54c58c0055583ad995868f78a3`, build ID `9dbcc9f0-274e-40ac-a30e-c886228a8b54`, and registered source fingerprint `4815cb323dce10c0007b8f2fa55690cafa17edf205283349aa8915c752a16ea4`. Approval to install this exact ZIP is pending. The configured Chrome DevTools bridge timed out, so the currently installed extension version is unconfirmed and exact-package provider/video checks have not run. The live Chrome Web Store listing observed on October 14, 2026 is still 2.3.0.2: its title and short description are Google-focused, while its long description says album scope is Google Photos only. The linked live privacy page describes Google, iCloud, and Amazon provider processing but still says no fixed analytics retention period is defined. The candidate source supports personal-album scans for all three providers, but exact-package provider behavior is not yet verified in Chrome. Do not publish this candidate-scoped copy until exact-package checks and public disclosures are reconciled.

## Homepage privacy callout — exact replacement

**CLEAR BOUNDARY**

PhotoSweep works with signed-in Google Photos, iCloud Photos, and Amazon Photos sessions in Chrome. Personal-album scans are supported for all three providers; shared albums are not supported. Duplicate analysis runs in your browser, and PhotoSweep does not send photo content to its services for analysis. If you choose **Verify original bytes**, an eligible provider original is read in your browser and PhotoSweep calculates a SHA-256 digest locally, up to 25 MiB per item and 100 MiB per review. Amazon Photos original-byte verification is currently verified only on Amazon Photos Canada. Optional usage metrics stay off unless you choose **Allow**. Stripe handles external checkout.

### Homepage consistency note

The live homepage is Google-first: its title, eyebrow, and hero describe Google Photos, while supporting copy acknowledges iCloud Photos and Amazon Photos with feature variation. Replacing only the privacy callout would leave those prominent claims incomplete. For the 2.3.6.5 candidate, align the title, introduction, and callout with all verified providers, and keep album and regional limitations visible. The live 2.3.0.2 Chrome Web Store listing also needs an owner-reviewed update before this copy describes that listing's release.

## Proposed complete replacement for `/privacy`

# PhotoSweep Privacy Policy

Last updated: [Set to the actual publication date]

## Summary

PhotoSweep is a Chrome extension for finding, reviewing, and managing duplicate photos and videos in Google Photos, iCloud Photos, and Amazon Photos. It works through your signed-in provider pages. Duplicate analysis runs in your browser; PhotoSweep does not send photo content to its services for duplicate analysis.

The current candidate supports personal-album scans on all three providers. Shared albums are not supported. Provider capabilities and regional availability can differ. Amazon Photos original-byte verification is currently verified only on Amazon Photos Canada.

Before the first provider scan, PhotoSweep displays an in-product data-use notice and requires you to choose **I understand, continue** before connecting to a provider tab. The notice links to this policy. Optional usage metrics require a separate **Allow** choice.

## Information processed and stored on your device

To provide scanning, review, reports, Trash, undo, and diagnostics, PhotoSweep may process the following in your browser:

- Provider thumbnails, item identifiers, and media details shown by the provider, such as dimensions, dates, and provider URLs.
- Duplicate groups, review decisions, keep/skip choices, scan checkpoints, reports, and local embedding/cache data.
- A provider account email or identifier exposed by a signed-in provider page when needed to associate saved scan state with that account.
- A license session identifier and signed entitlement state used to refresh paid access and support offline entitlement checks.

PhotoSweep stores local scan and review data in Chrome extension storage on your device. You can clear saved results and cache data from the extension UI. Local data also goes away if you remove the extension or Chrome clears its extension storage.

## Optional original-byte verification

For an eligible item in the current review, you can choose **Verify original bytes**. PhotoSweep then reads that provider original in your browser and calculates a SHA-256 digest locally. This optional check provides byte-level evidence for comparing candidate items; it is separate from the thumbnail-based duplicate analysis.

The check is limited to 25 MiB per item and 100 MiB total per review. It is available for eligible Google Photos and iCloud Photos items. Amazon Photos original-byte verification is currently verified only on Amazon Photos Canada. An unsupported item, unavailable original, cancelled request, or failed check remains unverified.

The local review may retain the SHA-256 digest, byte count, and media type. The original file contents are not included in saved review results. For a Live Photo, the check covers the still-image bytes; it does not establish whether the motion component also matches.

## Information sent to PhotoSweep services

PhotoSweep's license service processes information needed for checkout, license recovery, entitlement checks, abuse prevention, and paid-user support. Depending on the action, this may include:

- Selected plan and license session identifiers.
- Stripe customer, checkout-session, and payment identifiers.
- A buyer email when you provide one through Stripe Checkout or a license-recovery request.
- Signed entitlement state.
- If you allow optional usage metrics: event name, provider, plan, scan mode, coarse count buckets, error category, and applicable event reason/outcome fields, along with extension version, a random install identifier, and a UTC day key.

Optional usage metrics are sent only after you choose **Allow**. You can change your choice in the extension UI. Declining metrics does not affect scans, review, reports, Trash, licensing, or recovery. The install identifier is a random UUID stored in Chrome extension storage; it is not derived from or linked to your provider account, email address, photo URL, or photo data.

Usage metrics do not include photo content, filenames, album names, raw reports, or provider URLs. PhotoSweep's license service is not sent thumbnails, photo-library page content, photo URLs, filenames, or album names for duplicate analysis. Payment lifecycle events, such as a completed purchase or full refund, are recorded without photo-library context.

## License recovery and payments

You can request license recovery by entering the email address used for purchase. PhotoSweep gives the same confirmation whether or not an active license is found. If the email matches an active license and recovery email delivery is configured, the service requests a signed recovery link for that address. A recovery link, when sent, expires after 24 hours. After completing recovery, return to PhotoSweep and refresh your license.

PhotoSweep uses Stripe for external checkout and payment processing. Stripe may process payment details, receipts, fraud checks, and related transaction records under Stripe's own terms and privacy policy. If you provide an email during checkout, it is sent to Stripe for the checkout and payment receipt.

## Use, sharing, and Chrome Web Store Limited Use

PhotoSweep does not sell user data and does not use photo-derived data for advertising.

PhotoSweep complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. PhotoSweep uses data accessed through extension permissions and provider pages only to provide or improve its single purpose—finding, reviewing, reporting, and managing duplicate photos in supported libraries—and for related operational needs. PhotoSweep transfers user data to others only when the transfer is necessary to provide or improve that single purpose, to comply with applicable law, to protect against malware, spam, phishing, or other fraud or abuse, or as part of a merger, acquisition, or sale of the developer’s assets after obtaining your explicit prior consent. PhotoSweep does not use or transfer user data for advertising, unrelated profiling, creditworthiness decisions, or data brokerage.

PhotoSweep does not allow people to read raw photo-library data. Human access is limited to specific support data you explicitly provide, security or abuse investigations, legal compliance, or aggregate and anonymized internal operations.

## Retention and deletion

Local scan and review data remains in Chrome extension storage until you clear it, remove the extension, or Chrome clears that storage.

License records are retained while needed to provide paid access, receipts, refund handling, support, fraud prevention, accounting, tax, and legal compliance. Some payment, tax, accounting, fraud-prevention, or legal records may need to remain after a deletion request.

If you allow optional usage metrics, analytics events expire 90 days after server receipt and are deleted by Firestore TTL, typically within 24 hours after expiry. This period does not apply to license, payment, recovery, accounting, tax, or legal records.

You can request support, a refund, or deletion of license records by contacting **pawsitivegames@gmail.com**.

## Security

PhotoSweep signs license entitlements on the license service and verifies them in the extension with a bundled public key. The private signing key remains on the license service. PhotoSweep extension pages do not load remote executable JavaScript. Checkout opens externally through Stripe.

## Contact

For privacy, license, or deletion questions, contact **pawsitivegames@gmail.com**.

## Pre-publication confirmation checklist

The following are draft commitments present in the proposed live copy and require owner confirmation before publication:

- **Release parity:** The target is Chrome version 2.3.6.5, app version 2.3.6, ZIP SHA-256 `fb29344362a8dea4906522d2f2f207ba3a97ad54c58c0055583ad995868f78a3`, build ID `9dbcc9f0-274e-40ac-a30e-c886228a8b54`, and source fingerprint `4815cb323dce10c0007b8f2fa55690cafa17edf205283349aa8915c752a16ea4`. Approval to install this exact ZIP is pending. The configured Chrome DevTools bridge timed out, so the installed Chrome Stable version is unconfirmed and exact-package provider/video behavior remains unverified. The public listing observed October 14, 2026 is version 2.3.0.2, updated September 29, 2026, and says album scope is Google Photos only. The live privacy page describes all three providers but omits 90-day retention. Confirm exact-package behavior, then align the listing, homepage title/intro, privacy callout, and policy to the released package; keep provider and regional limits explicit.
- **Production data recipients:** Verify the currently configured license-service hosting and storage providers and whether they or other processors receive license, recovery, or consented analytics data. The draft intentionally names no hosting or database vendor.
- **Recovery email delivery:** Verify the active production sender, sending domain, and delivery path, and complete a production recovery check. The source supports an optional injected/webhook/SMTP sender; the Resend receiver is documented as an unapproved scaffold, so it must not be named as a configured provider without separate confirmation. If email delivery is not active, revise the recovery copy or make the feature work before publication.
- **Analytics retention:** The owner selected 90 days. Production Firestore TTL is active on `expiresAt`, and the authorized backfill set `expiresAt = recordedAt + 90 days` on all 1,147 documents in the approved snapshot. The 2026-10-14 08:40 UTC post-check found all 1,147 still present, including 82 past-due records awaiting asynchronous TTL processing; it did not observe deletion. Before publication, confirm TTL processing and replace the live page's no-fixed-retention statement.
- **Existing policy promises:** Have the owner confirm the operational statements that are policy commitments rather than source-enforced behavior, especially no sale/ads, human-access limits, license-record retention, and deletion handling.
- **Date and contact:** Replace the publication-date placeholder with the actual date, and confirm that the listed support inbox is monitored for privacy and deletion requests.
- **Chrome Web Store disclosures:** Reconcile the Developer Dashboard data-use selections and listing with the final privacy policy and in-product analytics consent. Keep the affirmative Limited Use statement on the extension-owned homepage or a page one click away.

## Source review anchors

- **Current policy baseline:** `docs/PRIVACY_POLICY.md:5-14,16-34,36-73,75-97,99-124` covers local processing/storage, service data, optional analytics, Stripe, Limited Use, retention, deletion, and security.
- **Providers and album scope:** `README.md:5-7`; `lib/types.ts:157`; `docs/PLATFORM_PARITY_PLAN.md:43,100-110`; `scripts/google-photos-commands.js:1264-1363,1606-1675`; `scripts/icloud-photos-commands.js:1409-1423`; `scripts/amazon-photos-commands.js:1079-1204,1556-1630`. The source candidate includes personal albums for all three; shared albums are excluded in the provider adapters. `package.json:3-6` identifies local Chrome version 2.3.6.5. Exact-package provider verification remains open.
- **Live page/version comparison (observed October 14, 2026):** [Chrome Web Store listing](https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo), [live homepage](https://photosweep.pawsitivegames.chatgpt.site/), and [live privacy page](https://photosweep.pawsitivegames.chatgpt.site/privacy). The listing is 2.3.0.2 and says album scope is Google-only; the privacy page describes processing across Google, iCloud, and Amazon but says no fixed analytics retention period is defined. These are current public-state observations, not proof of current-candidate provider behavior.
- **Original-byte check:** `components/PhotoViewerModal.tsx:478-496,801-887`; `lib/provider-retrieval.ts:7-8`; `scripts/google-photos-commands.js:1090-1137`; `scripts/icloud-photos-commands.js:1788-1855`; `scripts/amazon-photos-commands.js:500-521,636-681`; `lib/app-reducer.ts:178-231`; `tabs/app.tsx:4716-4741`. These show user initiation, 25 MiB / 100 MiB caps, locally calculated SHA-256 evidence, local review persistence, Live Photo still-only evidence, and Amazon Canada-only verification.
- **License recovery:** `components/UpgradeDialog.tsx:118-129`; `lib/license-client.ts:305-317`; `server/license-api.mjs:24,1561-1617`; `docs/LICENSING_BACKEND.md:46-70,214-253`. The sender is optional in source and production configuration is not established by this repository.
- **Analytics:** `tabs/app.tsx:1839-1878,6319-6368`; `lib/privacy-analytics.ts:12-35,97-112,246-265`. These define the consent gate, event schema, random install ID, fields, and opt-out behavior. The owner-selected 90-day retention is enforced by the active production Firestore TTL; the authorized 1,147-document backfill is complete. At the 2026-10-14 08:40 UTC post-check, 82 past-due records remained present for asynchronous TTL processing.
- **Stripe:** `docs/LICENSING_BACKEND.md:21-28`; `server/license-api.mjs:874-919`.
- **Chrome Web Store rule:** [Chrome Web Store User Data Policy and Limited Use disclosure requirements](https://developer.chrome.com/docs/webstore/user_data) and [program policies](https://developer.chrome.com/docs/webstore/program-policies/policies?hl=en). The policy requires an accurate privacy policy and an affirmative Limited Use statement on the extension's website.
