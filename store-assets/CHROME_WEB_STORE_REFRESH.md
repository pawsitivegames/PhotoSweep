# Chrome Web Store Refresh

## Approved Listing Direction

### Title

PhotoSweep for Google Photos™

### Short Description

Find duplicate photos and videos in Google Photos. Matching stays in your browser. Review, then Trash only what you confirm.

### First Paragraph

PhotoSweep helps you find duplicate and similar photos in Google Photos™, with iCloud Photos and Amazon Photos support where available. Before your first provider scan, review a short data-use notice explaining what PhotoSweep reads from the signed-in tab, what stays in your browser, and when the provider receives selected item IDs for Trash. An unscoped Smart scan recommends starting with the most recent 30 days where available. Before scanning, you can choose a supported date range, an album, or all dates instead. Availability and cleanup behavior can vary by provider, region, account state, loaded library area, and media type. Choose keeper photos, then include all available sets across the scan or only the sets shown by the current filter. Newly included sets return to “Needs review.” Review every eligible set and the exact items proposed for Trash before confirming what moves to each service's Trash or recovery flow.

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
License checks go to the PhotoSweep service; checkout is handled by Stripe.

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

## Current reupload candidate — Dashboard draft saved, not submitted

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
