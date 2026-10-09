# Chrome Web Store Screenshot Set

Chrome Web Store screenshot size: 1280 x 800 PNG.

## Ready upload set

Five screenshots are ready for a listing review. Each shows the exact PhotoSweep
extension package built from source commit
`7c3e9fa720684377747de770a3547d5bd381458b` (app `2.3.5`, Chrome `2.3.5.2`).
The ZIP SHA-256 is
`1a8b24beaa40e53e8f0ea0bb0e43b1db1dc423311dbf5b255966da9deb8599cb`.
Package audit passed with a clean source tree. Captures used an isolated
Playwright Chromium context and synthetic account/results; the cleanup request
was intercepted by the local Google Photos test stub. No personal provider
library was read or changed.

The product UI was captured at 1280 x 720. An 80 px caption band was appended
below it to produce the 1280 x 800 assets. The band uses the current PhotoSweep
mark, `#F3F6FB` background, `#255BD4` accent, and dark-blue type. Captured UI
pixels were not retouched or recolored.

Upload in this order:

1. `02-focused-scan.png` — **Demo · First scan.** Choose a photo library and scope.
2. `04-review-groups.png` — **Example review.** Choose keepers, then use the
   scan-wide shortcut or include only sets shown by the active filter.
3. `08-include-all-sets.png` — **Example review.** Shows all available sets
   included and newly included sets marked “Needs review.”
4. `05-export-safety.png` — **Example confirmation.** Shows the typed count,
   safety acknowledgment, and cleanup preflight before the provider action.
5. `06-cleanup-outcome.png` — **Example result.** Shows the intercepted sample
   response and Undo option; the caption states that no personal library changed.

These screenshots and local listing copy are prepared, not published. Recheck
the Chrome Web Store Developer Dashboard, current policy requirements, and
listing fields before upload or submission. The public listing was still on
version `2.3.0.2` at the 8 October 2026 audit.

## Retained reference screenshots

These captures use the older teal theme and must not be uploaded with the new set:

- `01-provider-selector.png` — older provider-selector capture.
- `03-scan-progress.png` — older scan-progress capture.
- `07-compact-exact-similar.png` — older compact review capture.

## Upload rules

- Do not imply official Google, Apple, or Amazon affiliation.
- Do not imply identical feature parity across providers.
- Keep caption bands outside the product UI.
- Keep provider availability and cleanup caveats near the first provider-support mention.
- Keep “Example” labels on seeded review, confirmation, and result states.
