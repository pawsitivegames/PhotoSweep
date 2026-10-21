# Validation Checklist

Use this checklist before trusting PhotoSweep on a main library or shipping paid
multi-provider support.

## Automated Gates

Run these from the repository root:

```bash
npm run build
npm test
npx playwright test --config playwright.config.ts tests/e2e/integration/app-tab.test.ts tests/e2e/integration/trash-undo.test.ts
```

Required result:

- The extension builds without errors.
- Unit tests pass.
- Stubbed extension integration tests pass.
- Trash tests pass typed confirmation, conservative batching, result reporting, failure display, and undo.

These checks prove the local product flow and safety logic. They do not prove that the current Google Photos web app still accepts every GPTK operation.

## Live Tiny-Album Gate

The automated live gate is scan-only and requires a reviewed synthetic album of
1–100 items, its expected groups, and an explicitly selected installation.
Use the configured existing signed-in Chrome CDP connection. No profile is
launched unless `GPD_E2E_USER_DATA_DIR` is explicitly supplied; local operator
browser instructions still take precedence. Never transfer cookies into tests.
If HTTP discovery is unavailable, set `CDP_URL` to the existing Chrome instance's
local debugging WebSocket endpoint; keep the endpoint out of logs and commits.
Start the run while the owner is at Chrome. If Chrome displays **Allow remote
debugging?**, the owner must approve the fresh connection within the harness's
two-minute connection window. Approval of an expired request does not prove a
new connection is authorized.

Temporarily disable other PhotoSweep installations during this gate, preserving
their storage. Multiple enabled copies can replace the shared provider-page
command host and make the selected candidate time out. Verify the switches in
Chrome's own extension manager, then reload the provider tab before retrying.
Restore the prior installation state after the run.

The target installation must have no saved review/checkpoint state and no open
app panel. Use a dedicated test installation, not an owner's active cleanup.
The harness verifies its runtime ID, name and version against the local manifest;
no storage is cleared, and existing license/consent settings are not injected.
A failed scan can retain a synthetic checkpoint for diagnosis. Review that state
before explicitly preparing another run; automatic live retries are disabled.

```bash
PHOTOSWEEP_E2E_EXTENSION_ID="<exact 32-character installed test ID>" \
PHOTOSWEEP_E2E_EXTENSION_PATH="/absolute/path/to/accepted/unpacked-extension" \
PHOTOSWEEP_E2E_FIXTURE_MANIFEST="/absolute/path/to/private-synthetic-oracle.json" \
GPD_E2E_SYNTHETIC_FIXTURE=1 \
GPD_E2E_ALBUM_TITLE="Tiny synthetic duplicate test" \
npm run test:e2e
```

The private oracle file has this shape; replace the synthetic example values
with independently verified fixture IDs. Keep real provider IDs uncommitted.

```json
{
  "schemaVersion": 1,
  "provider": "google",
  "albumTitle": "Tiny synthetic duplicate test",
  "albumId": "synthetic-album-id",
  "expectedMediaKeys": ["original", "copy", "control"],
  "expectedGroups": [["original", "copy"]]
}
```

The album title and underlying selected album ID must both match. There is no
implicit today/date-range/all-library fallback. A successful terminal scan must
match the expected count, retained-item whitelist and exact group membership;
compact results retain grouped items only and are not a full provider inventory.
Independent provider inventory/report proof remains a separate release gate.
The transient progress label is not required because tiny scans can finish
before it is observed.

This command does not authorize Trash. Legacy `GPD_E2E_ALLOW_TRASH=1` automation
now fails before connecting to a browser: it cannot safely bind its first visible
group to an approved target. Use the release-gate procedure instead. Each actual
Trash test requires separate explicit approval of an identified disposable item,
a current pre-Trash report, independent provider inventory, and same-run Undo.
Never permanently delete provider Trash. Preserve every failed or interrupted
attempt and report missing prerequisites as blocked, not passing.

Before making paid multi-provider claims, record independent live scan/report
and approved Trash/restore evidence for Google Photos, iCloud Photos and Amazon
Photos. Providers must use the same free and paid feature limits. The scan-only
harness and mocked integration tests do not establish that provider acceptance.

## Paid Launch Validation

Run this after Stripe test-mode checkout and license refresh are working.

1. Build the extension with production-style license API variables and the test
   public key.
2. Load the extension into a logged-in Chrome profile.
3. Start as a free user and verify:
   - Full scan is locked.
   - Free visible groups are capped.
   - Trash moves are capped cumulatively per cleanup session.
   - Export still downloads a limited report.
4. Buy each test-mode Stripe plan:
   - Mini Cleanup
   - Cleanup Pass
   - Lifetime Early Access
5. Refresh the license in PhotoSweep after each checkout.
6. Verify each plan's scan, visible group, Trash, report, full scan, and resume
   limits match `lib/entitlement.ts`.
7. Restart the extension with a valid paid token and verify automatic
   reconciliation preserves access.
8. Refund the test payment from Stripe and verify PhotoSweep downgrades to free
   after restart or manual entitlement refresh.
9. Recover each eligible purchase in a fresh browser profile and verify an
   ineligible email receives only the generic non-enumerating response.
10. Confirm analytics/license payloads contain only provider, scan mode, plan id,
   count buckets, event name, and error category.

## Live Account Smoke Test - 2026-06-28

Environment:

- Chrome normal profile, signed in to Google Photos as `[redacted test account]`.
- Unpacked dev extension loaded from `build/chrome-mv3-dev`.
- Runtime extension id: `efdneecimbdbeafpllggkmahiehhimhn`.
- No Trash/delete operation was performed.

Evidence:

- Extension manager showed `Google Photos Deduper 2.2.1` enabled.
- Google Photos page injected the extension scripts:
  - `scripts/unsafewindow-shim.js`
  - `scripts/google-photos-toolkit.user.js`
  - `scripts/google-photos-commands.js`
- Bridge health check returned `hasGptk=true`, `hasWizData=true`, and account email `[redacted test account]`.
- Direct scoped fetch for taken date `2026-06-21` returned 7 media items with thumbnails.
- App scoped Smart scan for `2026-06-21` reached 7 processed items and completed with `No duplicates found in your library.`
- App scoped Full scan for `2026-06-21` reached 7 processed items and completed with `No duplicates found in your library.`

Current caveat:

- Date-range scans still paginate from the newest Google Photos feed before filtering the requested taken-date range. The app now reports scanned-versus-matched progress, so older ranges should show movement even while no matching taken-date items have been reached yet.

## Live Duplicate-Positive Test - 2026-06-28

Environment:

- Chrome normal profile, signed in to Google Photos as `[redacted test account]`.
- Unpacked dev extension loaded from `build/chrome-mv3-dev`.
- Runtime extension id: `efdneecimbdbeafpllggkmahiehhimhn`.
- No Trash/delete operation was performed.

Setup:

- Generated two synthetic PNG images in `tmp-live-duplicate-test/`:
  - `gpd-live-duplicate-copy-1.png`
  - `gpd-live-duplicate-copy-2.png`
- Uploaded both synthetic images to Google Photos.
- Both appeared under `Today` in Google Photos.

Evidence:

- App scoped Full scan for taken date `2026-06-28` fetched 2 media items.
- The scan completed with `1 duplicate group`.
- Result summary showed:
  - `2 items scanned`
  - `ALL (1)`
  - `EXACT (0)`
  - `SIMILAR (1)`
  - `2 photos`
  - `99% similar`
  - one item marked `Keep`
  - one item marked `Trash`

Required cleanup:

- The two uploaded synthetic test images remain in Google Photos until explicitly moved to Trash or deleted by the account owner.

## Live Tiny-Album Trash/Undo Gate - 2026-06-30

Environment:

- Chrome normal profile, signed in to Google Photos as `[redacted test account]`.
- Unpacked dev extension loaded from `build/chrome-mv3-dev`.
- Runtime extension id: `efdneecimbdbeafpllggkmahiehhimhn`.
- Automated `.chrome-live-validation` profile was not signed in; it redirected to
  `https://www.google.com/photos/about/`, so this run used the already signed-in
  Chrome profile and manual app/DOM validation.

Setup:

- Created Google Photos album `Tiny duplicate test`.
- Album contained three synthetic PNG images:
  - two matching duplicate candidates
  - one distinct control image

Evidence:

- Before the fix in `scripts/google-photos-commands.js`, PhotoSweep showed
  `0 albums available` even though `window.gptkApi.getAlbums(null, 100, false)`
  returned live album rows including `Tiny duplicate test`.
- After rebuilding and reloading the extension, PhotoSweep showed
  `6 albums available`, including `Tiny duplicate test (3)`.
- Album-scoped Smart scan for `Tiny duplicate test` completed with:
  - `3 photos and videos checked`
  - `1 Duplicate Set Ready`
  - `0 identical`
  - `1 similar`
  - `95% match`
  - `Move 1 to Trash`
- Trash confirmation required typing the exact count `1`; the final
  **Move to Trash** button stayed disabled until the value was entered.
- Trash operation completed with `1 item moved to trash`.
- Clicking **Undo** restored the test item; the app returned to the previous
  duplicate-review state with `1 Duplicate Set Ready` and `3 photos and videos
  checked`.

Current caveat:

- The live Playwright command still requires a signed-in CDP Chrome or signed-in
  `.chrome-live-validation` profile before `GPD_E2E_ALBUM_TITLE="Tiny duplicate
  test" npm run test:e2e` can run automatically on this machine.

## Live Amazon Photos Read-Only Smoke - 2026-06-30

Environment:

- Chrome normal profile, signed in to Amazon Photos Canada as `[redacted test account]`.
- Unpacked dev extension loaded from `build/chrome-mv3-dev`.
- Page URL: `https://www.amazon.ca/photos?sf=1`.
- No Trash/delete operation was performed.

Evidence:

- Amazon Photos page loaded with the signed-in library visible.
- PhotoSweep Amazon command `healthCheck` returned `success=true` and
  `hasGptk=true`.
- Read-only Amazon command `getAllMediaItems` with `{ "limit": 20 }` returned:
  - 20 live media items
  - Amazon media keys using the `amazon-...` format
  - thumbnail URLs on `thumbnails-photos.amazon.ca`
  - MD5-based exact-content hashes
  - product URLs on `https://www.amazon.ca/photos/all/gallery/...`
  - filenames, dimensions, timestamps, and file sizes
- Progress reported:
  - `Fetching first Amazon Photos API page...`
  - `Fetched 20 Amazon Photos items`
- `npm test -- --run tests/commands/amazon-photos-commands.test.ts` passed with
  8 tests, including Amazon trash and restore request coverage.

Live synthetic Trash/Restore evidence:

- Uploaded three synthetic PNGs to Amazon Photos:
  - `gpd-live-duplicate-copy-2.png`
  - `gpd-live-duplicate-copy-1.png`
  - `gpd-live-control.png`
- Live Amazon command `getAllMediaItems` with `{ "limit": 10 }` returned all
  three synthetic items as the newest library rows.
- Moved only `gpd-live-duplicate-copy-2.png` to Trash via live Amazon command:
  - `dedupKey`: `[redacted synthetic item id]`
  - `mediaKey`: `[redacted synthetic item id]`
  - result: `trashedCount=1`
- A follow-up live library fetch returned only the remaining two synthetic
  items, proving the trashed synthetic duplicate dropped out of the normal
  library view.
- Restored the same Amazon node id via live Amazon command:
  - result: `restoredCount=1`
- Final live library fetch returned all three synthetic items again.

## Live iCloud Photos CloudKit Trash/Restore - 2026-06-30

Environment:

- Chrome normal profile, signed in to iCloud Photos.
- Unpacked dev extension loaded from `build/chrome-mv3-dev`.
- Page URL: `https://www.icloud.com/photos/`.

Setup:

- Uploaded three synthetic JPGs to iCloud Photos:
  - `gpd-live-control.jpg`
  - `gpd-live-duplicate-copy-2.jpg`
  - `gpd-live-duplicate-copy-1.jpg`

Evidence:

- iCloud Photos page showed `3 Photos`.
- PhotoSweep iCloud command `healthCheck` returned `success=true` and
  `hasGptk=true`.
- Live CloudKit `records/query` returned 6 records mapped to the three
  synthetic JPGs, each with a fresh `CPLAsset` record name, change tag, zone,
  owner record, dimensions, size, timestamp, and fingerprint.
- Moved only `gpd-live-duplicate-copy-2.jpg` to Recently Deleted via live
  CloudKit `records/modify`:
  - asset record: `[redacted synthetic record id]`
  - pre-trash change tag: `[redacted change tag]`
  - result: HTTP 200, `isDeleted=1`, post-trash change tag `[redacted change tag]`
- A follow-up live normal-library query returned only:
  - `gpd-live-control.jpg`
  - `gpd-live-duplicate-copy-1.jpg`
- Restored the same synthetic asset via live CloudKit `records/modify`:
  - post-trash change tag used: `[redacted change tag]`
  - result: HTTP 200, post-restore change tag `[redacted change tag]`
- Final live normal-library query returned all three synthetic JPGs again.

App-driven validation:

- Switched the app provider to iCloud Photos and scanned the uploaded JPGs.
- Result summary: `1 sets`, `3 checked`, `0 identical`, `1 similar`.
- Review kept `gpd-live-duplicate-copy-1.jpg` and selected
  `gpd-live-duplicate-copy-2.jpg` for trash.
- The confirmation dialog required typing `1` before `Move to Trash` enabled.
- After `Move 1 to Trash`, a live CloudKit normal-library query returned only:
  - `gpd-live-control.jpg`
  - `gpd-live-duplicate-copy-1.jpg`
- The first app-driven Undo attempt exposed a restore metadata bug when
  CloudKit returned a fresh change tag without `zoneID`; the app showed:
  `Restore failed: iCloud restore metadata ... is missing`.
- Fixed by preserving the original iCloud zone metadata while merging the fresh
  post-trash change tag.
- After rebuilding `build/chrome-mv3-dev`, repeated the same app-driven scan ->
  Trash -> Undo path.
- Post-Undo app state returned to the same duplicate-review result, and a live
  CloudKit normal-library query returned all three synthetic JPGs again:
  - `gpd-live-control.jpg`
  - `gpd-live-duplicate-copy-2.jpg`
  - `gpd-live-duplicate-copy-1.jpg`

## Live Month/Year Gate

Run this only after the tiny-album gate passes.

This is a separate manual acceptance procedure using a dedicated non-sensitive
fixture scope. The automated tiny-album command does not accept month/year or
date-range fallback, and `GPD_E2E_ALLOW_TRASH=1` fails closed. Each identified
live Trash target still needs explicit approval and same-run restoration.

1. Choose a low-risk month or year with known duplicates.
2. Run Smart mode first.
3. Review all groups and skip anything uncertain.
4. Export JSON and CSV reports.
5. Move a small batch to Trash.
6. Compare the result report with Google Photos Trash.
7. Restore at least one item from the batch.

Required result:

- Browser remains responsive while reviewing results.
- Checkpoint/resume works if the tab is reloaded mid-scan.
- Cached embeddings make a repeated scan of the same scope faster.
- Trash result reporting remains accurate on multi-batch operations.

## Main-Library Operating Rules

- Do not start with an unscoped Full scan on a large library.
- Prefer Smart mode and one album, month, or year at a time.
- Export reports before every Trash operation.
- Keep batch sizes small until the live gates have passed repeatedly.
- Treat similar-photo groups as review-only; Trash only obvious duplicates.
- Keep Google Photos Trash recovery available until the full session is audited.
