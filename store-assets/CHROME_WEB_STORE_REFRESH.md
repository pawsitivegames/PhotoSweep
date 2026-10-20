# Chrome Web Store Refresh

## Current release-gate candidate — 20 October 2026 (v2.3.6.20, 495da9d7ece1)

Candidate ZIP `build/photosweep-cws-v2.3.6.20-sha256-495da9d7ece1.zip`, SHA-256
`495da9d7ece1d80ae1671728c0e68e521b928d9881e9c4566c636dd56162e61b`, build ID
`3a2e99f7-7a6d-4af0-b149-4d5a91fe5d2b`, and source fingerprint
`906b8c027f6065c9ed6bea40427b338172f809aa555e985e04810454c9bbf286` across 345
registered files. The [provenance sidecar](../build/photosweep-cws-v2.3.6.20-sha256-495da9d7ece1.json)
records dirty source commit `024d56ccd3ab1e7130bc4234a0552a074855cf34`. On 20
October, the source fingerprint matched the sidecar and the strict
`npm run audit:extension-package` passed under Node 24.20.0.

The saved full release run
[release-v2.3.6.20-20261020-02](../tmp/verification/runs/release-v2.3.6.20-20261020-02/verification-summary.json)
is **BLOCKED**, but its package audit binds the different
`9af889a21a8b` ZIP and source fingerprint `b6b7713c…`. Its production build
digest also differs from the current build tree. That run is not full-release
evidence for this `495da9d7…` candidate. The full suite and mutation gate have
not been rerun on this candidate; keep them for the final pass after the
remaining issues are addressed.

Chrome DevTools lists the Google Photos, iCloud Photos, and Amazon Photos tabs,
and service-worker targets under PhotoSweep ID
`dnbgiaipnphkiiadpbpgimpogfkhfnck`. Its extension inventory lists only ADA
Recovery Review. Read-only manifest inspection and the extension action both
stalled, so no installed-version identity or candidate-bound provider/video
scan is verified. No provider data was changed.

The same-day Chrome Stable observation shows public listing version `2.3.0.2`
(updated September 29, 2026), with 23 users, no ratings, and an in-app-purchases
badge. The Developer Dashboard shows published `2.3.0.2`, draft `2.3.6.1`, and
no candidate `2.3.6.20`; the saved privacy declarations have not been reconciled
against this candidate. See the [listing observation](../tmp/verification/public-store-listing-20261020/listing.json)
and [dashboard observation](../tmp/verification/cws-dashboard-read-only-20261020/dashboard.json).
No listing change, upload, or submission was made.

A read-only production `GET /health` probe at `2026-10-20T20:04:36Z` returned
HTTP 404; the local `/health` route exists, but no Cloud Run deployment was
made. The latest read-only Cloud Run inventory found production and test sharing
the default Compute service account, no configured
`PHOTOSWEEP_FIRESTORE_DATABASE_ID`, and shared project-level grants for
Firestore, Secret Manager, Artifact Registry, Storage, and Logging. The local
database-selection support is implemented but not deployed. See the [Cloud Run
inventory](../tmp/verification/cloudrun-runtime-isolation-recheck-20261020T142048Z.json).

Fresh root and GPTK production-only audits report zero vulnerabilities. The
full root development-tree audit reports four moderate Parcel/Plasmo findings.
Plasmo 0.90.5 pins Parcel 2.9.3; the advisory's patched reporter requires
Parcel 2.16.4. The supported `npm run dev` wrapper has an HTTP/WebSocket Origin
guard, and its focused regression passed 10/10. The isolated reporter override
trial was rejected because Parcel logged a core/plugin incompatibility.

Hosted CI still fails on the committed TLC download/checksum workflow; the local
vendored-pin fix is uncommitted and has no hosted result. Production billing,
signer equivalence, support delivery, monitoring, alerting, and rollback
evidence also remain open. The source is dirty. No commit, push, deployment,
Store upload, or submission was made.

**Overall status: NOT READY.** The exact candidate still needs full release and
mutation evidence, live Chrome extension identity plus scan-only provider/video
checks, production `/health`, Cloud Run IAM/database isolation, current Store
declarations and candidate upload/review, hosted CI, and the remaining external
operations gates. The three provider Trash/Undo obligations remain open under
the scan-only rule.

## Superseded release-gate checkpoint — 19 October 2026 (c88a70d483f4)

> Historical evidence below predates the current d4a84d28d617 candidate and is superseded by the current status above.

Candidate ZIP `build/photosweep-cws-v2.3.6.15-sha256-c88a70d483f4.zip`, SHA-256
`c88a70d483f4f6077195b5d3677acdd96ac7f1c17948e055940f00e8be19a5ae`, build ID
`606ca620-2081-420b-bee1-da617abe319c`, and source fingerprint
`465aafb616c87bd1b5ff7a6cee4169f706491d0ce4c24dd409e9e26337b5a46f` across
342 registered files. It was built with Node 24.20.0 from dirty `main` at
`024d56ccd3ab1e7130bc4234a0552a074855cf34`; the sidecar records
`sourceDirty=true`. The [provenance sidecar](../build/photosweep-cws-v2.3.6.15-sha256-c88a70d483f4.json)
matches the current registered source fingerprint.

The package build and separate strict ZIP audit pass. Focused current-source
checks pass for typecheck, recovery readback, trusted provider binding, the
development-server Origin guard, the 438-test fast suite, provider/TTL/video
seams, local `/health`, and GPTK API/FormData behavior. The GPTK Vitest config
warning was removed by moving its ESM config to `.mts`. See the [current focused
evidence](../tmp/verification/current-source-recovery-binding-20261019-01/verification-summary.json).
The full suite and mutation gate are reserved for the final pass, as requested.

No provider runtime evidence is bound to c88a. The prior Chrome inventory was
for an earlier build, and browser security policy blocked automated extension-
page access while disallowing alternate-surface workarounds. No provider media
was changed during this verification.

The [public Chrome Web Store listing](https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo)
was reread on 19 October: it remains v2.3.0.2 (updated September 29), describes
Google-only album scope, and shows “Offers in-app purchases” while describing
Stripe Checkout. The Dashboard state and declarations are unverified; no listing
change, upload, or submission was made. A fresh production `GET /health` at
22:18 UTC returned HTTP 404; the local route test passes, but no deployment was
made. Production audit reports zero vulnerabilities, and npm verified 930
package signatures and 243 attestations; four moderate development-tree Parcel
findings remain, with the supported `npm run dev` Origin guard tested.

The published privacy wording and 90-day Firestore TTL were last verified in
the October 19 evidence linked below. Hosted CI, production billing, signer
equivalence, support delivery, monitoring, alerting, and rollback evidence
remain open. The source is dirty. No commit, push, deployment, Store upload, or
submission was made.

**Overall status: NOT READY.** Exact-package runtime evidence, final full and
mutation suites, production health, Store declarations, hosted CI, and external
billing, signer, and operations gates remain unresolved.

## Superseded release-gate snapshot — 19 October 2026 (c6f6/e109)

The candidate in this superseded snapshot was PhotoSweep v2.3.6.15 ZIP
`build/photosweep-cws-v2.3.6.15-sha256-c6f6f03923e8.zip`, SHA-256
`c6f6f03923e8e2f002d95c4ac918ba23d9fd5ff69d59c3f30bd4e247ec600f7b`, build ID
`0e5f8ff8-85d5-4614-b9cb-d6738e77c906`, and source fingerprint
`ce9977cd888c28217d9cedfe9f5906d3fe118897b3d48ad0924879d503d2b7d2` across
342 registered files. It was built with Node 24.20.0 from dirty `main` at
`024d56ccd3ab1e7130bc4234a0552a074855cf34`; the sidecar records
`sourceDirty=true`. At that snapshot, the [provenance sidecar](../build/photosweep-cws-v2.3.6.15-sha256-c6f6f03923e8.json)
matched the then-current registered source fingerprint.

> **Superseded:** the current candidate is c88a, documented above. The
> evidence below refers only to the earlier c6f6/e109 candidates and must not
> be treated as current exact-package verification.

The exact-candidate release run completed 17 commands with `sourceDrift=false`:
49/54 evidence entries passed, none failed, and five remain blocked. Fresh local
checks passed: 119 test files / 2,280 tests, typecheck, headless integration
72/72, and strict package audit. Mutation testing reported 4,171 mutants,
3,956 killed, 215 reviewed and resolved non-killed mutants, zero critical
survivors, and 94.85%. See the [release summary](../tmp/verification/release-current-20261019T0620Z/verification-summary.json),
[evidence ledger](../tmp/verification/release-current-20261019T0620Z/evidence.json),
[mutation result](../tmp/verification/release-current-20261019T0620Z/mutation.json),
[unit log](../tmp/verification/current-source-tests-20261019T0628Z/unit-tests.log),
[integration log](../tmp/verification/current-source-tests-20261019T0628Z/headless-integration.log),
and [package audit](../tmp/verification/current-source-tests-20261019T0628Z/package-audit-after-integration.log).

Google, iCloud, and Amazon live round trips plus all-provider and Amazon video
playback remain blocked because exact-package runtime evidence is missing. A
read-only Chrome DevTools attach attempt timed out before listing pages or
extensions; see the [attach result](../tmp/verification/release-followup-20261019T064659Z/chrome-devtools-attach.json).
Earlier provider evidence is not reused across package hashes.

The [public Chrome Web Store listing](https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo)
was reread on 19 October. It remains v2.3.0.2 (updated 29 September), says album
scope is Google Photos only, and displays “Offers in-app purchases” while its
description says checkout uses Stripe. The [captured listing facts](../tmp/verification/release-followup-20261019T1125Z/cws-listing.json)
need reconciliation with the saved Developer Dashboard declaration before a
submission. No Dashboard edit, package upload, submission, or public listing
change was made.

Both production `/health` URLs returned 404 at 11:25 UTC on 19 October; the
local route and its 35-test license API suite pass, but no deployment was made.
The [latest health probes](../tmp/verification/release-followup-20261019T1125Z/production-health.json)
record the result. The public privacy and refunds pages both returned HTTP 200;
the privacy page states 90-day analytics retention, the refund contact sentence
has the corrected spacing, and production Firestore TTL is active on
`prod_analytics_events.expiresAt`. See the [page and TTL evidence](../tmp/verification/release-followup-20261019T1125Z/public-policy-and-ttl.json).
A fresh Node 24
audit reports zero production vulnerabilities and four moderate full-tree
Parcel dev-server findings. The current Plasmo release remains 0.90.5 and pins
Parcel 2.9.3; the paired Parcel 2.16.4 override crashes the Plasmo adapter and
was reverted. The supported `npm run dev` path has a tested HTTP/WebSocket
Origin guard. See the [health probes](../tmp/verification/release-followup-20261019T064659Z/production-health.json),
[full dependency audit](../tmp/verification/dependency-refresh-20261019T-current-54dOeq/full.json),
[production audit](../tmp/verification/dependency-refresh-20261019T-current-54dOeq/production.json),
and [Parcel compatibility trial](../tmp/verification/dependency-patch-20261017/experiment-summary.md).

The public privacy page states 90-day analytics retention and Firestore TTL
deletion; the approved refund contact spacing is live. Hosted CI cannot verify
this dirty source, and production billing, signer equivalence, saved Dashboard
state, support delivery, monitoring, alerting, and rollback evidence remain
open. No production deployment, Store upload or submission, commit, or push was
made.

**Overall status: NOT READY.** The production `/health` failure is a current
release failure. Exact-package provider and video evidence, production health,
Store declarations, hosted CI, and external billing, signer, and operations
gates also remain open. The [current release status](../docs/REMAINING_GATES_STATUS.md)
owns the full gate matrix.

## Approved Listing Direction

### Title

PhotoSweep for Google Photos™

### Short Description

Find duplicates in Google Photos, iCloud Photos, and Amazon Photos where available. Review each Trash move. Matching stays local.

### First Paragraph

PhotoSweep helps you find duplicate and similar photos in Google Photos™, with iCloud Photos and Amazon Photos support where available. Personal album scans are available across all three providers where supported. Before your first provider scan, review a short data-use notice explaining what PhotoSweep reads from the signed-in tab, what stays in your browser, and when the provider receives selected item IDs for Trash. An unscoped Smart scan recommends starting with the most recent 30 days where available. Before scanning, you can choose a supported date range, a personal album, or all dates instead. Amazon full-video playback is currently supported on Amazon Photos Canada (`amazon.ca`); other Amazon marketplace hosts fail closed for playback. Availability and cleanup behavior can vary by provider, region, account state, loaded library area, and media type. Choose keeper photos, then include all available sets across the scan or only the sets shown by the current filter. Newly included sets return to “Needs review.” Review every eligible set and the exact items proposed for Trash before confirming what moves to each service's Trash or recovery flow.

PhotoSweep is not affiliated with, created by, or endorsed by Google, Apple, Amazon, or their photo services. Google Photos is a trademark of Google LLC. Use of this trademark is subject to Google Permissions. Apple, iCloud, and iCloud Photos are trademarks of Apple Inc. Amazon and Amazon Photos are trademarks of Amazon.com, Inc. or its affiliates.

### Store description for the Dashboard draft

PhotoSweep finds duplicate and similar photos and videos in Google Photos™.
Matching runs in your browser; PhotoSweep does not upload your photo library for
analysis. PhotoSweep also supports iCloud Photos and Amazon Photos where
available.

WHAT YOU CAN DO

• Review Exact and Similar groups separately and choose which copy to keep.
• Choose a keeper rule across the scan, or make choices one set at a time.
• Include all sets available to review across the scan, or only sets shown by
  the current filter. Newly included sets return to “Needs review.”
• Export a JSON audit report or CSV spreadsheet from the review menu. Some
  locked results may require an optional license.
• Review every eligible set and the exact items proposed for Trash.

HOW SCANNING AND CLEANUP WORK

Before a first scan, review the data-use notice. An unscoped Smart scan
recommends a recent-30-day starting range where available. Before scanning,
choose a supported date range, personal album, or all dates. Video matching can
use provider thumbnails or poster stills and media metadata; PhotoSweep does
not decode the full video. Separately, Verify original bytes reads an eligible
original in your browser and calculates a SHA-256 locally, up to 25 MiB per item
and 100 MiB per review. Availability varies by provider; Amazon Photos
original-byte verification is currently limited to Amazon Photos Canada.

Provider support and scope vary.

• Personal album scans are available on Google Photos, iCloud Photos, and Amazon Photos where supported.
• Amazon full-video playback is currently supported only on Amazon Photos Canada (`amazon.ca`).
• Google Photos shared albums are not supported.
• iCloud album scans use the personal library; shared libraries are not
  included.
• Amazon shared albums are not supported. A personal-album scan stops if it
  encounters an item owned by another account.

PhotoSweep asks you to type the item count before sending a Trash request. A move
affects the provider library, not only the album used to narrow the scan.
Provider Trash, recovery, and Undo options vary. Availability and cleanup
behavior can vary by provider, region, account state, loaded library area, and
media type. Some steps use the provider's own web interface.

PRIVACY AND BILLING

Matching runs in your browser. PhotoSweep's services do not receive your photo
content for analysis. Optional usage analytics stay off unless you choose Allow;
they do not include photo content. Optional licensing unlocks larger scans.
Pawsitive Games sells optional PhotoSweep licenses; Google is not the seller. License checks go to the PhotoSweep service; checkout opens in Stripe.

PhotoSweep is not affiliated with, created by, or endorsed by Google, Apple, or
Amazon. Google Photos is a trademark of Google LLC. Use of this trademark is
subject to Google Permissions. Apple, iCloud, and iCloud Photos are trademarks
of Apple Inc. Amazon and Amazon Photos are trademarks of Amazon.com, Inc. or its
affiliates.

## Messaging Rules

- Google Photos should be the clearest primary use case; iCloud Photos and Amazon Photos should remain visible as supported surfaces where available.
- Do not imply official Google, Apple, or Amazon integration.
- Do not imply identical feature parity across all providers.
- Use "signed-in browser session" rather than account/API language.
- Use "where available" and provider-flow caveats for compatibility near the first provider mention.
- Say "Photo matching runs locally in your browser" rather than absolute privacy claims.
- Say "does not upload your photo library for analysis" rather than vague "100% private" language.
- Emphasize review-before-cleanup and provider Trash/Recently Deleted flows.

## Superseded 05bb exact-package revalidation — 15 October 2026

The previously approved candidate was Chrome `2.3.6.6` / app `2.3.6.6`: ZIP
`build/photosweep-cws-v2.3.6.6-sha256-05bbfd91a96a.zip`, SHA-256
`05bbfd91a96ae24f1fa2adcdcf8f352464d8dc04b5f37eb096354c2a6917d5bc`, build ID
`95201459-d44c-4cb4-ac35-d8b2d4397e23`, and source fingerprint
`55980fc68a6f7a0647ed09364b80bd88264ac705af17ba8bbfd57e67adb67a1f`.
The source is `main` at `024d56ccd3ab1e7130bc4234a0552a074855cf34` and remains
dirty. The fresh Node 24.20.0 release run completed 17 commands and 54 PASS
evidence entries with no source drift. Mutation, registry-signature, and strict
package audits passed. The signature check verified 947 package signatures
and 244 attestations. The separate full dependency audit still has 8
development-tree findings.

The approved ZIP was installed in Chrome Stable. Its loaded directory matched
all 44 ZIP entries byte-for-byte; Chrome reported extension
`ggdofkabojmabhfeiejncllciiepcckj` as v2.3.6.6 Enabled, and the toolbar action
opened the scanner panel. Exact-SHA Google, iCloud, and Amazon Canada round trips
passed, as did video captures for Google, iCloud, and Amazon Canada. Amazon
playback coverage is one of one declared playback marketplaces (`amazon.ca`);
broader Amazon scan coverage does not imply video playback in other regions.
After install, the Amazon connection state remained “Not connected” following a
tab reload; no additional scan was started. The post-reload worker/ping probe
timed out. See the [exact-package runtime evidence](../tmp/verification/exact-candidate-20261015-05bb-final/runtime-evidence.md).

The public listing was rechecked on 15 October and remains version `2.3.0.2`
(updated 29 September). It still says album scope is Google Photos only. The
public page also shows “Offers in-app purchases,” while the product copy says
checkout is handled by Stripe. The Dashboard was not rechecked during this 05bb
runtime snapshot; the previous 9 October observation showed a Google identity
verification redirect and a `2.3.6.1` draft. See the latest status update above
for the read-only Dashboard recheck and current draft state.

The live privacy page now states 90-day analytics retention and Firestore TTL
deletion; the previously approved refund spacing correction is live. This local
listing draft has not been uploaded or submitted. No package upload, CWS
submission, or public listing change was made during this revalidation.

## Superseded candidate snapshot — 14 October 2026 (b4ac)

The current local candidate is Chrome `2.3.6.5` / app `2.3.6`: ZIP
`build/photosweep-cws-v2.3.6.5-sha256-b4ac44eb4a7b.zip`, SHA-256
`b4ac44eb4a7b158c10a15e6d272516c991776645ad6408bee63403ccef7f9d78`, build ID
`71ec3b48-1cba-4787-8eb2-719e69900c3c`, and source fingerprint
`baf29bbc6741e741addd37ff7238b5552a9c485926d50a683304e6aa2703e8b5`.
Chrome Stable still runs `2.3.6.4`; approval to install this exact ZIP is
pending, so exact-candidate provider and video checks have not run. The final
local release run has 49 PASS, 0 FAIL, and 5 BLOCKED; unit tests passed 2,207,
headless browser integration passed 71, typecheck passed, and the mutation gate
scored 94.85%. Strict ZIP/provenance audit passed. No package upload or
submission was made during this revalidation.

The provenance sidecar marks the source `sourceDirty: true`, from commit
`024d56ccd3ab1e7130bc4234a0552a074855cf34`. The checkout has 102 modified
paths, 36 untracked paths, and one modified submodule outside generated output
and dependency directories. Review and commit the intended source snapshot
before public submission; the current package is bound to the recorded dirty
source fingerprint above.

The public listing was checked on 14 October and remains version `2.3.0.2`
(updated 29 September). Its description is Google-first and acknowledges
iCloud/Amazon signed-in sessions, but still says album scope is Google Photos
only and omits release-specific provider and regional limits. The public homepage
is also Google-first, although its supporting copy acknowledges iCloud Photos
and Amazon Photos where available. The linked privacy page describes all three
provider families but says no fixed analytics retention period is defined;
production now has an active 90-day Firestore TTL and the authorized missing-
expiry backfill is complete. These public statements need alignment before a
release.

The Chrome Web Store Developer Dashboard currently redirects to Google identity
verification. Its saved-draft package and privacy declarations could not be
rechecked; the last read-only dashboard evidence on 9 October showed draft
`2.3.6.1`, which is stale for this candidate. Do not submit the old draft or
describe its current state as verified. Recheck it after identity verification,
then bind any package upload to the exact final ZIP and provenance sidecar.

## Publisher state snapshot — 8 October 2026

The public listing is [PhotoSweep for Google Photos™](https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo) (`niggncodoibinbianpkdpepmhfljifbo`). Its public page was rechecked on 8 October 2026: version `2.3.0.2`, updated 29 September 2026, with five screenshot slides. The Dashboard row separately reports a 7 October last-updated date, while the published package remains `2.3.0.2`.

At the read-only Developer Dashboard check on 8 October 2026, the item was
**Published · public** at version `2.3.0.2`. The Package tab also showed
both **Draft** and **Published** packages at `2.3.0.2`; the Draft section links
to `main.crx` under a `__DRAFT` revision. An “Upload new package” action is
available. The Store listing editor still contains the old copy, including the
Google-only album-scope claim, and does not mention scan-wide or current-filter
set inclusion or Needs review. The public icon still uses the older sparkle
mark, and its five screenshot slides show the older teal/coral product UI;
neither matches the website's current photo-and-golden-sweep mark or extension
blue/gold palette. Reconcile the existing draft before any new upload or
submission.

The dashboard Privacy tab currently checks personally identifiable
information, financial and payment information, user activity, and website
content; it marks remote code “No” and links to the live privacy page. That
page, updated 6 October 2026, describes all three provider families, local
matching, consented optional analytics, and licensing/payment flows. This was
a read-only review; no dashboard field was changed. Recheck dashboard and
existing draft state before any upload or submission.

The live Site and current extension source use the same PhotoSweep mark, DM Sans,
cool light surfaces, and royal-blue `#255BD4` controls. The public Store listing
still has older copy, icon, and teal screenshots; it is not visually aligned
yet. The refreshed package and screenshot provenance are recorded in the
9 October update below. Do not describe the public Store listing as aligned
until the live listing is updated and rechecked.

## State update — 9 October 2026

The live Site is version `16`, sourced from commit
`ab860a6cbe1394fc7dc21fb9151abadb576ed69d`; its production deployment
succeeded. The latest extension candidate is app `2.3.6` / Chrome `2.3.6.1`,
built from source commit `66f5c8ed322411d10eb4124a3e65a5c74b4dc43a`. Package
and recorded-ZIP audit both passed. ZIP SHA-256 is
`f765a9262a6c082f2b54ff2039baa808f97cd3d6f3c8ef18cea8aef3e4bee786`.

The package sidecar marks the checkout dirty because untracked scratch artifacts
were present, while its tracked-diff SHA-256 is empty. Five replacement
screenshots were captured from that exact package in an isolated Chrome Stable
profile with synthetic provider and photo data. Their image dimensions and the
five-frame order are recorded in `screenshots/README.md`.

On 9 October, the candidate package was uploaded to the Chrome Web Store
Developer Dashboard as draft version `2.3.6.1`. The refreshed description,
128 px icon, five screenshots, and small promo tile were saved in the listing
draft. The item remains **Published · public** at `2.3.0.2`; the draft has not
been submitted for review, so the public page still shows the previous assets.

The public Chrome Web Store page was rechecked on 9 October and remains at
version `2.3.0.2`; its old icon, screenshots, and Google-only album-scope copy
are still public. The refreshed local listing assets are not yet reflected in
the public page.

## Screenshot Replacement Requirements

Chrome Web Store screenshot target: 1280 x 800 PNG.

## Visual identity

The listing artwork must use the same identity as the current extension and
website:

- Use the active photo-and-golden-sweep mark from `assets/icon.png`. The
  website favicon currently uses the same file; `manifest.json` remains the
  source of truth for the shipped extension icon.
- Use the extension's royal blue `#255BD4`, dark blue `#1948AD`, cool light
  surfaces, and DM Sans typography. The gold belongs to the official mark.
- Do not use the former teal screenshot theme or the older dark-blue photo
  glyph. Do not recolor or retouch captured product UI to simulate the current
  theme.
- Recapture product screens from the exact approved release package. Caption
  bands may be composed around the capture; they must not cover or alter the
  extension UI.

Five screenshot files now show the current extension UI and workflow. Previous
captures are retained under `screenshots/archive/20261009/` for reference and
must not be uploaded with the new set. See `screenshots/README.md` for exact
package provenance, the five-frame upload order, synthetic-state labels, and
retained reference files.

Screenshots must be product-dominant:

- Real shipped extension UI should take most of the frame.
- Caption text must be outside the UI, not covering the extension layout.
- If iCloud/Amazon are mentioned or shown, the provider selector must be visible and functional in the captured UI.
- Screenshots must not claim identical feature parity across Google Photos, iCloud Photos, and Amazon Photos.
- Screenshots must show review-before-cleanup behavior, not one-click deletion.
- Screenshots based on local seeded duplicate state must be labeled as example review, confirmation, or post-cleanup/result states in the caption band.

## Current Screenshot Set

1. Review data use before the first scan
   - File: `screenshots/01-first-scan-notice.png`
   - Shows the required first-scan notice before scanning a provider library.
   - Caption: "Review data use before you scan."

2. Choose a scan scope
   - File: `screenshots/02-choose-scan-scope.png`
   - Shows provider selection and available scan-scope controls in the
     synthetic provider fixture.
   - Caption: "Choose a scan scope."

3. Choose which sets to include
   - File: `screenshots/03-review-groups.png`
   - Shows the scan-wide “Include all available sets” shortcut and the
     current-filter action in a seeded example review.
   - Caption: "Example review: choose the sets to include. Include all 3 sets, or only the 2 shown by this filter."

4. Review included sets next
   - File: `screenshots/04-include-all-sets.png`
   - Shows all available sets included, their “Needs review” state, and the
     next-review shortcut.
   - Caption: "Example review: newly included sets return to Needs review."

5. Review before moving to Trash
   - File: `screenshots/05-confirm-before-trash.png`
   - Shows the exact-count field and favorite-status acknowledgment in a
     synthetic, unconfirmed cleanup dialog.
   - Caption: "Example confirmation: no provider action was confirmed."

The public listing currently displays five screenshots. These assets now
replace the old screenshots in the saved Dashboard draft; they are not public
until that draft is submitted and approved.

## Critic Gate

Before live Web Store changes:

- Good cop must approve clarity, conversion, trust, and product fit.
- Bad cop must approve policy safety, truthfulness, privacy wording, and screenshot accuracy.

## Historical publisher update packet — PhotoSweep 2.3.0 / 2.3.0.1

Use these destinations when correcting the live listing. They are the
canonical public destinations for this candidate:

- Support site: `https://photosweep.pawsitivegames.chatgpt.site/`
- Privacy policy: `https://photosweep.pawsitivegames.chatgpt.site/privacy`
- Refund policy: `https://photosweep.pawsitivegames.chatgpt.site/refunds`
- Support email: `pawsitivegames@gmail.com`
- Candidate app version: `2.3.0`
- Candidate Chrome version: `2.3.0.1`
- Candidate ZIP: `tmp/verification/historical-package-archive/photosweep-cws-v2.3.0.1-sha256-9e42d6ba5981.zip`
- Candidate ZIP SHA-256: `9e42d6ba598195864806421ad741c82adee62fc416c7ace81960008406e2f861`
- Candidate metadata: `tmp/verification/historical-package-archive/photosweep-cws-v2.3.0.1-sha256-9e42d6ba5981.json`

The ZIP and sidecar were generated by the fresh release verification package
step on 2026-09-19.
The candidate is locally verified but has not been uploaded or submitted; the
sidecar records that this was a dirty-worktree build.
This packet is historical evidence for the `2.3.0.1` candidate, not the next
upload target.

Publisher action remains separately gated: sign in to the Chrome Web Store
Developer Dashboard in Aside, verify the listing fields, upload the candidate,
and confirm submission/review state. This document does not authorize or
perform publication.

## Historical Dashboard draft — v2.3.6.1 (not current)

The source candidate is app version `2.3.6` / Chrome version `2.3.6.1`, built
from commit `66f5c8ed322411d10eb4124a3e65a5c74b4dc43a`. Its ZIP is
`build/photosweep-cws-v2.3.6.1-sha256-f765a9262a6c.zip` (SHA-256
`f765a9262a6c082f2b54ff2039baa808f97cd3d6f3c8ef18cea8aef3e4bee786`); package
and recorded-ZIP audits passed. The five replacement screenshots in
`screenshots/` were captured from this exact package. Local listing copy now
covers the first-scan data-use notice, recommended recent-30-day starting
range, provider-specific scopes, set inclusion, and Needs review behavior.

The live listing remains at `2.3.0.2`, with its older icon, screenshots, and
Google-only album-scope copy. The package and refreshed listing assets are saved
in the Developer Dashboard draft. The public page has not been changed; the
draft remains unsubmitted and requires a separate publisher review and
submission.

## Superseded pre-install snapshot — 15 October 2026 (2ee)

This snapshot predates the approved 2ee installation and runtime verification. The current result is recorded in “Latest release-gate update” above; retain this section only as the earlier state.

The current local candidate is PhotoSweep v2.3.6.6, Chrome version 2.3.6.6:
`build/photosweep-cws-v2.3.6.6-sha256-2ee12a01df51.zip`, SHA-256
`2ee12a01df518b8732a583a69cc9ef3b64b20182814c027a569566cbd98bceb0`, build ID
`d76c53be-c536-480e-b8ed-01f8e7cc8cfe`, source fingerprint
`c6f4278611bb113bbbd22c2d9a3b56d8c05cdb35cd046896799962e3e96f2085`. It passed
the strict package audit and local release gates. At the time, the source-bound release run
was **BLOCKED** on exact-package Chrome/provider/video evidence; its summary is
`tmp/verification/runs/20261015T100000Z-release-source-refresh-frozen/verification-summary.json`.

At the time of this snapshot, Chrome Stable still had the previously approved
05bb package installed. The 2ee ZIP was installed and verified later the same
day; see the exact-package runtime record linked above.

The Dashboard was not rechecked in this snapshot. The later read-only check
confirmed its draft remains v2.3.6.1, which is stale for v2.3.6.6. No
current-candidate listing update or submission has been made.

The public [Chrome Web Store listing](https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo)
was rechecked on 2026-10-15. It still shows version `2.3.0.2`, says album scope
is Google Photos only, and displays “Offers in-app purchases.” The current
candidate supports personal album scans on Google Photos, iCloud Photos, and
Amazon Photos where supported, and its optional license checkout uses Stripe.
These listing/declaration differences must be corrected and rechecked before
submission. See the [read-only public listing observation](../tmp/verification/exact-candidate-20261015-05bb-final/chrome-web-store-public-listing-20261015.md).
