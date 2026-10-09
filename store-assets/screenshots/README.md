# Chrome Web Store Screenshot Set

Chrome Web Store screenshot size: 1280 x 800 PNG.

## Current upload set — 9 October 2026

These five screenshots were captured from the exact PhotoSweep Chrome package
build in an isolated Chrome Stable 154 profile. The candidate is app `2.3.6`,
Chrome `2.3.6.1`, source commit
`66f5c8ed322411d10eb4124a3e65a5c74b4dc43a`, ZIP
`build/photosweep-cws-v2.3.6.1-sha256-f765a9262a6c.zip`, SHA-256
`f765a9262a6c082f2b54ff2039baa808f97cd3d6f3c8ef18cea8aef3e4bee786`.
Package build and the separate recorded-ZIP audit passed. The sidecar records
the source as dirty because the checkout contained untracked scratch files; its
tracked-diff hash is empty.

The product UI was captured at 1280 x 720, then an 80 px caption band was added
to reach 1280 x 800. The band uses `assets/icon.png`, DM Sans, `#F3F6FB`,
`#255BD4`, and dark-blue type. Product pixels were not retouched. Review and
confirmation states use generated landscape thumbnails, synthetic scan data,
and the offline Google Photos test fixture. The confirmation dialog was opened
but not confirmed; no provider Trash action ran and no personal library was
read or changed.

Upload in this order:

1. `01-first-scan-notice.png` — **First scan.** Shows the required data-use
   notice before a provider scan.
2. `02-choose-scan-scope.png` — **First scan.** Shows provider selection and
   supported scan-scope controls after connecting the synthetic provider tab.
3. `03-review-groups.png` — **Example review.** Shows keeper choice separately
   from set inclusion. The active filter shows 2 of 3 sets, so the scan-wide
   and current-filter shortcuts have visibly different scope.
4. `04-include-all-sets.png` — **Example review.** Shows included sets returning
   to Needs review and the next-review shortcut.
5. `05-confirm-before-trash.png` — **Example confirmation.** Shows the safety
   acknowledgment and exact-count requirement before the provider action.

These assets were uploaded to the Chrome Web Store Developer Dashboard and
saved in its listing draft on 9 October 2026. The public listing remains at
version `2.3.0.2`; its published icon, copy, and screenshots are unchanged
because the draft has not been submitted for review.

## Archived screenshots

Previous screenshots were moved to `archive/20261009/` to retain their Git
history and source files. They use older extension layouts and must not be
uploaded with the current set.

## Upload rules

- Do not imply official Google, Apple, or Amazon affiliation.
- Do not imply identical feature parity across providers.
- Keep caption bands outside the product UI.
- Keep provider availability and cleanup caveats near the first provider-support mention.
- Keep “Example” labels on seeded review and confirmation states.
