# Chrome Web Store Refresh

## Approved Listing Direction

### Title

PhotoSweep for Google Photos™

### Short Description

Find duplicate photos and videos in Google Photos. Matching stays in your browser. Review, then Trash only what you confirm.

### First Paragraph

PhotoSweep helps you find duplicate and similar photos in Google Photos™, with iCloud Photos and Amazon Photos support where the provider flow, region, account state, loaded library area, and media type allow it. Choose keeper photos, then include all available sets across the scan or only the sets shown by the current filter. Newly included sets return to “Needs review.” Review every eligible set and the exact items proposed for Trash before confirming what moves to each service's Trash or recovery flow.

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

The Developer Dashboard was rechecked read-only: the item is **Published ·
public** at version `2.3.0.2`. No separate draft state was visible in the
listing row. The public icon still uses the older sparkle mark, and the five
screenshot slides show the older teal/coral product UI; neither matches the
website's photo-and-golden-sweep mark or the current blue/gold extension
palette. The dirty local worktree declares `2.3.5` / `2.3.5.1`, which is not an
approved target. Recheck dashboard state and reconcile an exact approved
candidate before replacing listing media or submitting changes.

The live Site is version `13`, sourced from commit
`74e6f49c49b3a669eafb061b1c6134bd3ca2d11d`. Chrome computed its page background
as `#F4F6FB`, primary CTA as `#145BE0`, and body font as Avenir Next. The local
Site candidate uses `#F3F6FB`, `#255BD4`, and DM Sans, matching the extension
source tokens, but its edits are uncommitted and unpublished.

Chrome Stable currently has a separate enabled PhotoSweep extension
(`aipenpjlbgggghncblkjbfibgcfbojpo`) at version `2.3.0`; it is not the public
Store package `niggncodoibinbianpkdpepmhfljifbo` at `2.3.0.2`. Its runtime uses
`#F3F6FB`, `#255BD4`, and DM Sans, but its active bundle still places generic
“Include all sets” and “Skip all sets” actions in the keeper-rule menu. It lacks
the separate scan-wide shortcut and current-filter include/remove actions from
the current source, so it cannot provide captures of the revised review flow.

The live Site and Store listing are still on older copy and assets. The Store
description does not explain set inclusion, and its screenshots use the former
teal UI and icon. Do not treat local Site or extension source as shipped until
the exact candidate is built, reviewed, and published.

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

The existing screenshot set uses the previous teal treatment and is not ready
for a new listing submission. See `screenshots/README.md` for the five-frame
upload set and the two retained alternates.

Screenshots must be product-dominant:

- Real shipped extension UI should take most of the frame.
- Caption text must be outside the UI, not covering the extension layout.
- If iCloud/Amazon are mentioned or shown, the provider selector must be visible and functional in the captured UI.
- Screenshots must not claim identical feature parity across Google Photos, iCloud Photos, and Amazon Photos.
- Screenshots must show review-before-cleanup behavior, not one-click deletion.
- Screenshots based on local seeded duplicate state must be labeled as example review, confirmation, compact comparison, or post-cleanup states in the caption band.

## Proposed Screenshot Set

1. Start with a focused scan
   - File: `screenshots/02-focused-scan.png`
   - Shows scan settings and date/batch/scope controls.
   - Caption: "Start with a focused scan before a large cleanup."

2. Review duplicate groups
   - File: `screenshots/04-review-groups.png`
   - Shows the review screen with exact/similar grouping, keeper choices, the scan-wide “Include all available sets” shortcut, and current-filter include/remove actions using local seeded example state.
   - Caption: "Example review state: choose keepers, then include sets for cleanup. Newly included sets still need review."

3. Confirm before cleanup
   - File: `screenshots/05-export-safety.png`
   - Shows typed confirmation and the audit-report warning using local seeded example state.
   - Caption: "Example confirmation state: typed confirmation and an audit report come first."

4. Verify the cleanup outcome
   - File: `screenshots/06-cleanup-outcome.png`
   - Shows the completed Trash step and the exact `2 items moved to trash` Undo snackbar using local seeded example state.
   - Caption: "Example post-cleanup state: Undo remains available while you verify the result."

5. Compare exact and similar results
   - File: `screenshots/07-compact-exact-similar.png`
   - Shows the compact side-panel review UI with All, Exact, and Similar filters plus Exact duplicate and Similar group labels using local seeded example state.
   - Caption: "Example compact review: filter exact duplicates separately from visually similar sets."

6. Choose your cloud photo library
   - File: `screenshots/01-provider-selector.png`
   - Shows provider selector with Google Photos, iCloud Photos, and Amazon Photos.
   - Caption: "Find duplicates across supported cloud photo libraries."

7. Scan before any cleanup action
   - File: `screenshots/03-scan-progress.png`
   - Shows scan progress and the review-before-cleanup safety message.
   - Caption: "Scan before any cleanup action."

The public listing currently displays five screenshots. Keep the recommended
five-frame order below; confirm the current Dashboard limit before a future
upload. Provider selection and scan progress remain alternate captures.

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

## Next reupload target — unresolved

The former `2.3.0` / `2.3.0.3` target is stale relative to the current dirty
worktree's `package.json` (`2.3.5` / `2.3.5.1`). Those local values are not an
approved release candidate. Do not package or submit either version from this
note. After the intended changes merge, select the exact owner-approved `main`
SHA, reconcile this packet to its package metadata, and generate fresh ZIP and
sidecar evidence from that immutable source. Redeploy the API only for that
exact merged SHA and after owner approval.

The screenshot refresh, package upload, and publication remain separate review
steps. This document does not authorize publication.
