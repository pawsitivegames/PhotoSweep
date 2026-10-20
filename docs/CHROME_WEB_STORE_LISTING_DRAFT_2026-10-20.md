# PhotoSweep Chrome Web Store Listing Draft

Status: **Current candidate-bound draft; not approved to submit.** This copy
is tied to PhotoSweep v2.3.6.20, ZIP
`build/photosweep-cws-v2.3.6.20-sha256-59afe66e5948.zip` (SHA-256
`59afe66e5948471f37918f1b2af2b77400a9aac548a55f537c0c1df021726055`), build ID
`5bd0999a-fc42-4de7-a751-76ebe859abe1`, and source fingerprint
`ee9f59bd18a9f16ac2e382e0764e8216da38f53b06c94c66441aa3e95084c69a`. The
package comes from a dirty working tree. Node 24.20.0 full unit, typecheck,
headless integration, and mutation checks pass for that source. The exact ZIP
was audited and installed as an unpacked Chrome Stable extension. Scan-only
runs of the configured synthetic Google Photos, iCloud Photos, and Amazon
Photos Canada fixtures each returned 6/6 items, skipped zero, and proposed
zero items for Trash. The public listing remains v2.3.0.2. This draft limits
provider claims to Google Photos and Amazon Photos Canada; video playback and
provider Trash/Undo were not run under the current scans-only scope. Store ID
installation/update, payment declarations, and the saved Dashboard state remain
unverified. Recheck every claim against the final immutable candidate, current
provider evidence, public policy, and saved Dashboard fields before
submission. See the [current gate
ledger](REMAINING_GATES_STATUS.md), [current public listing
observation](../tmp/verification/public-store-listing-20261020/listing.json),
[current package sidecar](../build/photosweep-cws-v2.3.6.20-sha256-59afe66e5948.json),
and [read-only provider scan](../tmp/verification/runtime-readonly-59afe-20261020T2239Z/provider-read-only-scan.json).
## Proposed listing text

### Title

PhotoSweep for Google Photos™

### Summary

Find photo and video duplicates in Google Photos and Amazon Photos Canada. Match in your browser; confirm each Trash move.

Character count: 122; check the current limit before submission.

### Description

PhotoSweep helps you find and review duplicate or similar photos and videos in
Google Photos and Amazon Photos Canada. Matching runs in your browser;
PhotoSweep does not upload your photo library for matching.

- Review Exact and Similar groups separately and choose which item to keep.
- Use Google Photos album/date filters and Amazon Photos Canada albums where
  supported.
- Confirm the item count before moving selected items to the provider's Trash.
- Export review results as JSON or CSV.
- Recover eligible items through the provider's Trash or Recently Deleted flow
  where supported.

Scan scope, preview quality, cleanup, and recovery can vary by provider, account,
region, loaded library area, and media type. Video matching uses provider poster
and thumbnail stills; it does not decode the full video file. An optional
license unlocks larger and full-library scans. License checks and usage
analytics use PhotoSweep's online service; analytics remain off until the user
allows them. Checkout is through Stripe. Photo content is not sent for
matching.

PhotoSweep is not affiliated with Google, Apple, or Amazon. Provider services
have independent policies and availability.

## Evidence and release limits

- The October 20 [public listing observation](../tmp/verification/public-store-listing-20261020/listing.json)
  reports version `2.3.0.2`, last updated September 29, 2026, and the label
  “Offers in-app purchases.” The candidate is not uploaded.
- The current 59afe ZIP's read-only scans of the configured synthetic fixtures
  returned six items for Google Photos, iCloud Photos, and Amazon Photos
  Canada. Each scan reached the end of one provider page, skipped zero items,
  and proposed zero items for Trash. No provider data was changed. These scans
  do not establish full provider parity, exact-package video playback, or
  Trash/Undo behavior. The previous 9af ZIP's Amazon video playback result is
  historical and does not bind to 59afe. The listing therefore does not claim
  iCloud support or video playback verification.
- Exact-package evidence is summarized in
  [REMAINING_GATES_STATUS.md](REMAINING_GATES_STATUS.md), the
  [read-only scan record](../tmp/verification/runtime-readonly-59afe-20261020T2239Z/provider-read-only-scan.json),
  the [previous Amazon playback refresh](../tmp/verification/runs/release-v2.3.6.20-20261020-02-amazon-playback-refresh/amazon-video-playback.json),
  and the [current candidate sidecar](../build/photosweep-cws-v2.3.6.20-sha256-59afe66e5948.json).
- The public listing's payment label and the actual Developer Dashboard
  declaration have not been reconciled. Confirm the saved Dashboard fields,
  privacy categories, and payment disclosure before changing or submitting
  listing text.
- Recheck the title, 132-character summary, description, screenshots, privacy
  URL, support URL, payment disclosures, and provider scope against the final
  source fingerprint and ZIP. The summary is 122 characters; verify current
  Chrome Web Store metadata limits before submission.
