# PhotoSweep Chrome Web Store Listing Draft

Status: **Superseded draft; do not submit.** This copy was prepared against the
v2.3.6.10 ZIP `build/photosweep-cws-v2.3.6.10-sha256-1f88c143cbfd.zip` (SHA-256
`1f88c143cbfd00b50f5f106687243b9cdc32c49f22ba681fa07410cf2166e79d`). The
current local candidate is v2.3.6.20, a different artifact whose Google, iCloud,
and Amazon Trash/Undo release gates remain blocked. The public listing is still
v2.3.0.2. No current-candidate listing copy has been approved. Recheck every
claim against the final immutable candidate, provider evidence, public policy,
and saved Dashboard fields before preparing replacement copy. See the
[current gate ledger](REMAINING_GATES_STATUS.md), [current public listing
observation](../tmp/verification/public-store-listing-20261020/listing.json),
and [v2.3.6.20 package record](../tmp/verification/runs/release-v2.3.6.20-20261020-02/verification-summary.json).

## Proposed listing text

### Title

PhotoSweep for Google Photos™

### Summary

Find photo and video duplicates in Google Photos and Amazon Photos Canada. Match in your browser; confirm each Trash move.

Character count: 122 (Chrome Web Store summary limit: 132).

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

- The historical [public listing capture from October 17](../tmp/verification/cws-listing-20261017/public-listing.json)
  reports version `2.3.0.2`, last updated September 29, 2026, and the label
  “Offers in-app purchases.” The current October 20 listing check also reports
  version `2.3.0.2`; see the linked observation above.
- The candidate-bound evidence covers Google Photos and Amazon Photos Canada
  synthetic album scans, Trash/Undo, and video playback. iCloud needs
  reauthentication, and other Amazon marketplaces have not been runtime
  verified. This draft therefore does not advertise those unverified flows.
- Exact-package evidence is summarized in
  [REMAINING_GATES_STATUS.md](REMAINING_GATES_STATUS.md) and
  `tmp/verification/runtime-exact-1f88c143cbfd/provider-runtime-summary-20261017.json`.
- The public listing's payment label and the actual Developer Dashboard
  declaration have not been reconciled. Confirm the saved Dashboard fields,
  privacy categories, and payment disclosure before changing or submitting
  listing text.
- Recheck the title, 132-character summary, description, screenshots, privacy
  URL, support URL, payment disclosures, and provider scope against the final
  source fingerprint and ZIP. Chrome Web Store guidance requires accurate,
  current metadata and limits the summary to 132 characters.
