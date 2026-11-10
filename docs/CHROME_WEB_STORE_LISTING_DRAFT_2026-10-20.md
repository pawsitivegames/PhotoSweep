# PhotoSweep Chrome Web Store Listing Draft

> Storage note (2026-10-26): Raw artifacts under `tmp/verification/` were removed from this checkout to reclaim space. Historical summaries remain, but those files are unavailable for inspection and do not verify the current candidate.

Status: **Current candidate-bound draft; not approved to submit.** This copy
is tied to PhotoSweep v2.3.6.20, ZIP
`build/photosweep-cws-v2.3.6.20-sha256-44cfb7ed4684.zip` (SHA-256
`44cfb7ed4684e4178f0b377358557c91374a88682b33d6d1d230e611e6342230`), build ID
`7ca173e5-907e-4333-a06e-062ce1caf6ad`, and source fingerprint
`1fd1c715cca724349fe4b49603156793ac05e37a6ee859812522b9d6742f831c` across
423 registered files. The package comes from a dirty working tree at
`a198b4c43c56fe7067120aa96ae27162b80f4195` plus scoped release fixes.

Fresh Node 24.20.0 root unit tests (2,313), typecheck, headless integration
(75), vendored tests (304), and strict package audits pass. Normal mutation verification passes with 4,171 mutants, a 94.85% score, and
215/215 reviewed non-killed mutants resolved. Registered release verification
finished with 51 PASS / 3 BLOCKED / 0 FAIL and no source drift; the three
blocked obligations are provider Trash/Undo round trips. The exact ZIP is
installed in the existing unpacked Chrome Stable extension; all 44 files
match. Read-only synthetic scans examined 6 Google items, 2 iCloud items, and
4 Amazon Canada items, with zero items proposed for Trash. Synthetic video
playback passed for all three providers and for Amazon Canada, the only
declared in-app Amazon video marketplace. Provider Trash/Undo is unverified.

The public listing remains v2.3.0.2. This draft keeps its conservative
Google Photos/Amazon Photos Canada scope; it does not expand public claims
from a few bounded scans. Store ID installation/update, payment declarations,
and saved Dashboard fields remain unverified. Recheck every claim against
the final immutable candidate, current provider evidence, public policy, and
saved Dashboard fields before submission. See the [current gate
ledger](REMAINING_GATES_STATUS.md), [current package
sidecar](../build/photosweep-cws-v2.3.6.20-sha256-44cfb7ed4684.json), and
release evidence (former local path: `tmp/verification/release-readiness-20261020-current/release-readiness.md`).

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

- The [public listing](https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo)
  was freshly read as version `2.3.0.2`, last updated September 29, 2026, with
  the label “Offers in-app purchases.” The candidate is not uploaded.
- The current 44cf ZIP completed bounded synthetic Smart scans in Google
  Photos (6 items / 2 sets), iCloud Photos (2 items / 1 set), and Amazon Photos
  Canada (4 items / 1 set). No provider data was changed. These checks do not
  establish full provider parity, matching precision/recall, or Trash/Undo.
- Synthetic video playback advanced through to the end in the exact current
  package for Google, iCloud, and Amazon Canada. The
  all-provider capture manifest (former local path: `tmp/verification/release-readiness-20261020-current/video-evidence/manifest.json`)
  and Amazon Canada capture manifest (former local path: `tmp/verification/release-readiness-20261020-current/amazon-video-evidence/manifest.json`)
  pass the repository validators. Chrome's optional Amazon download-host
  permission was explicitly approved for this test and revoked afterward.
- Exact-package evidence is summarized in
  [REMAINING_GATES_STATUS.md](REMAINING_GATES_STATUS.md), the
  release report (former local path: `tmp/verification/release-readiness-20261020-current/release-readiness.md`),
  and the [current candidate sidecar](../build/photosweep-cws-v2.3.6.20-sha256-44cfb7ed4684.json).
- The public listing's payment label and actual Developer Dashboard
  declaration have not been reconciled. Confirm the saved Dashboard fields,
  privacy categories, and payment disclosure before changing or submitting
  listing text.
- Recheck the title, summary, description, screenshots, privacy URL, support
  URL, payment disclosures, and provider scope against the final source
  fingerprint and ZIP. The summary is 122 characters; verify current Chrome
  Web Store metadata limits before submission.
