# Chrome Web Store Refresh

## Approved Listing Direction

### Title

PhotoSweep for Google Photos™

### Short Description

Find duplicate photos and videos in Google Photos. Matching stays in your browser. Review, then Trash only what you confirm.

### First Paragraph

PhotoSweep helps you find duplicate and similar photos in Google Photos™, with iCloud Photos and Amazon Photos support where available. Availability and cleanup behavior can vary by provider, region, account state, loaded library area, and media type. Choose keeper photos, then include all available sets across the scan or only the sets shown by the current filter. Newly included sets return to “Needs review.” Review every eligible set and the exact items proposed for Trash before confirming what moves to each service's Trash or recovery flow.

PhotoSweep is not affiliated with, created by, or endorsed by Google, Apple, Amazon, or their photo services. Google Photos is a trademark of Google LLC. Use of this trademark is subject to Google Permissions. Apple, iCloud, and iCloud Photos are trademarks of Apple Inc. Amazon and Amazon Photos are trademarks of Amazon.com, Inc. or its affiliates.

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

The public listing is [PhotoSweep for Google Photos™](https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo) (`niggncodoibinbianpkdpepmhfljifbo`). Its public page was rechecked on 8 October 2026: version `2.3.0.2`, updated 29 September 2026, with five screenshot slides.

At the read-only Developer Dashboard check on 8 October 2026, the item was
**Published · public** at version `2.3.0.2`. No separate draft state was visible
in the listing row. The public icon still uses the older sparkle mark, and the
five screenshot slides show the older teal/coral product UI; neither matches
the website's photo-and-golden-sweep mark or the current blue/gold extension
palette. Recheck dashboard state before replacing listing media or submitting
changes.

The live Site is version `15`, sourced from commit
`187cb69ace77bd06d6a0fd232221172c79437aa4`, and its production deployment
succeeded. Chrome computes the page background as `#F3F6FB`, primary CTA as
`#255BD4`, and body font as DM Sans, matching the extension's current visual
tokens. The home and guide pages now explain scan-wide and current-filter set
inclusion, keeper selection, and review before Trash.

Chrome Stable currently has a separate enabled PhotoSweep extension
(`aipenpjlbgggghncblkjbfibgcfbojpo`) at version `2.3.0`; it is not the public
Store package `niggncodoibinbianpkdpepmhfljifbo` at `2.3.0.2`. Its runtime uses
`#F3F6FB`, `#255BD4`, and DM Sans, but its active bundle still places generic
“Include all sets” and “Skip all sets” actions in the keeper-rule menu. It lacks
the separate scan-wide shortcut and current-filter include/remove actions from
the current source, so it cannot provide captures of the revised review flow.

The live Site and current extension source use the same PhotoSweep mark, DM Sans,
cool light surfaces, and royal-blue `#255BD4` controls. The public Store listing
still has older copy and teal screenshots; it is not visually aligned yet. A
clean app `2.3.5` / Chrome `2.3.5.2` package was built from source commit
`204b0f2f83d2107f0f4b654851366c0abf3a6731` and passed the package audit. The
five new listing screenshots below were captured from that exact package. The
local listing copy and screenshot set are ready for review, but have not been
uploaded or submitted. Do not describe the public Store listing as aligned until
the live listing is updated and rechecked.

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

Five screenshot files now show the current extension UI and workflow. Three
older captures remain in the directory for reference only and must not be
uploaded with the new set. See `screenshots/README.md` for exact package
provenance, the five-frame upload order, synthetic-state labels, and retained
reference files.

Screenshots must be product-dominant:

- Real shipped extension UI should take most of the frame.
- Caption text must be outside the UI, not covering the extension layout.
- If iCloud/Amazon are mentioned or shown, the provider selector must be visible and functional in the captured UI.
- Screenshots must not claim identical feature parity across Google Photos, iCloud Photos, and Amazon Photos.
- Screenshots must show review-before-cleanup behavior, not one-click deletion.
- Screenshots based on local seeded duplicate state must be labeled as example review, confirmation, or post-cleanup/result states in the caption band.

## Proposed Screenshot Set

1. Start with a focused scan
   - File: `screenshots/02-focused-scan.png`
   - Shows the provider selector and the start of the scan scope controls.
   - Caption: "Choose a photo library and scope."

2. Review duplicate groups
   - File: `screenshots/04-review-groups.png`
   - Shows the scan-wide “Include all available sets” shortcut and current-filter “Include all 3 shown sets” action using seeded example state.
   - Caption: "Example review: choose keepers, then include sets."

3. Show the include-all result
   - File: `screenshots/08-include-all-sets.png`
   - Shows all available sets included and the “Selected · needs review” state.
   - Caption: "Example review: newly included sets return to Needs review before cleanup."

4. Confirm before cleanup
   - File: `screenshots/05-export-safety.png`
   - Shows typed confirmation and the audit-report warning using local seeded example state.
   - Caption: "Example confirmation state: typed confirmation and an audit report come first."

5. Verify the cleanup outcome
   - File: `screenshots/06-cleanup-outcome.png`
   - Shows the completed Trash step and the `3 items moved to trash` Undo snackbar from the intercepted local test stub.
   - Caption: "Example result: check the outcome while Undo is available. No personal photo library was changed."

6. Choose your cloud photo library (old reference capture; do not upload)
   - File: `screenshots/01-provider-selector.png`
   - Shows provider selector with Google Photos, iCloud Photos, and Amazon Photos.
   - Caption: "Find duplicates across supported cloud photo libraries."

7. Scan before any cleanup action (old reference capture; do not upload)
   - File: `screenshots/03-scan-progress.png`
   - Shows scan progress and the review-before-cleanup safety message.
   - Caption: "Scan before any cleanup action."

The public listing currently displays five screenshots. Keep the recommended
five-frame order below; confirm the current Dashboard limit before a future
upload. The provider-selector and scan-progress files are old reference captures;
recapture them before using either in a future listing update.

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

## Next reupload target — source candidate, listing assets pending

The source candidate is app version `2.3.5` / Chrome version `2.3.5.2`. The
clean ZIP and package audit passed, and the five replacement screenshots were
captured from that package. The local listing copy now describes set inclusion
and its Needs review behavior. The live listing remains at `2.3.0.2`; its copy,
privacy fields, icon, screenshots, and current Dashboard state still require
review before any upload or submission.

The screenshot refresh, package upload, and publication remain separate review
steps. This document does not authorize publication.
