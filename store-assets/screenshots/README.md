# Screenshot Set

Chrome Web Store screenshot size: 1280 x 800.

These assets are composed from the installed PhotoSweep extension UI captured in Chrome. The caption band is outside the product UI and should not obscure the extension layout.

## Files

1. `01-provider-selector.png`
   - Real installed extension provider selector.
   - Shows Google Photos, iCloud Photos, and Amazon Photos.

2. `02-focused-scan.png`
   - Real installed extension scan/scope screen with date range.

3. `03-scan-progress.png`
   - Real installed extension scan progress screen from a narrow Google Photos date-range scan.

4. `04-review-groups.png`
   - Real installed extension review UI using local seeded demo duplicate state for screenshot composition only.
   - Caption labels this as an example review state.
   - No real photos were moved or modified.

5. `05-export-safety.png`
   - Real installed extension Trash confirmation dialog using local seeded demo duplicate state.
   - Caption labels this as an example confirmation state.
   - Shows typed confirmation and the audit-report warning before any move action.
   - No Trash confirmation was completed and no provider library was modified.

6. `06-cleanup-outcome.png`
   - Real shipped extension post-cleanup UI with the completed Trash step.
   - Shows the exact `2 items moved to trash` Undo snackbar.
   - Caption labels this as an example post-cleanup state: Undo remains available while you verify the result.
   - Uses a locally seeded demo state; no provider library was modified.

7. `07-compact-exact-similar.png`
   - Real shipped compact side-panel review UI.
   - Shows `All`, `Exact`, and `Similar` filters plus `Exact duplicate` and `Similar` group labels.
   - Caption labels this as an example compact review state.
   - Uses a locally seeded demo state; no provider library was modified.

## Recommended upload order

Upload the assets in this order so the first frames lead with user value and
trust. The filename prefixes describe the captured screen, not the upload
priority.

1. `04-review-groups.png` — Example review state: compare matches and choose what to keep.
2. `05-export-safety.png` — Example confirmation state: typed confirmation and an audit report come first.
3. `06-cleanup-outcome.png` — Example post-cleanup state: Undo remains available while you verify the result.
4. `02-focused-scan.png` — Start with a focused scan before a large cleanup.
5. `07-compact-exact-similar.png` — Example compact review: filter exact duplicates separately from visually similar sets.
6. `01-provider-selector.png` — Find duplicates across supported cloud photo libraries.
7. `03-scan-progress.png` — Scan before any cleanup action.

## Upload Rules

- Do not upload if copy or screenshots imply official Google, Apple, or Amazon affiliation.
- Do not upload if screenshots imply identical feature parity across providers.
- Do not upload if the caption covers the product UI.
- Keep the listing caveat near the first provider-support mention: availability and cleanup behavior can vary by provider, region, account state, loaded library area, and media type.
- Do not remove the in-screenshot "Example" labels from seeded review, confirmation, compact comparison, or post-cleanup states unless those screenshots are replaced with non-seeded real-account captures.
