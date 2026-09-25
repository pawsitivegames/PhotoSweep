# Main build prep checklist

Use this checklist before the owner prepares the next Chrome Web Store
reupload. This PR prepares source and evidence only; it does not deploy Cloud
Run or publish CWS.

- [ ] Confirm the merged `main` tip keeps app version `2.3.0` and has
      `chromeVersion` `2.3.0.3` (public listing: `2.3.0.2`).
- [ ] Confirm Phase A client wiring is present: after analytics consent,
      `tabs/app.tsx` sends a stable `chrome.storage.local` `installId`,
      manifest `extensionVersion`, and UTC `dayKey` for
      `provider_connected`, `scan_*`, `trash_*`, `undo_*`, and `error` events.
- [ ] Record the exact post-merge `main` SHA as the API tip SHA to redeploy:
      `<fill after this PR merges>`. Redeploy `server/license-api.mjs` from
      that SHA only after owner approval.
- [ ] Close the remaining non-code gates:
      - [ ] API redeploy is owner-approved and completed.
      - [ ] Consent-based Phase A rows are present in the observation window.
      - [ ] A privacy-safe funnel export is re-generated with the published
            Chrome version and reviewed.
      - [ ] Store Growth imports the reviewed export.
      - [ ] CWS upload/publication is owner-approved after the remaining
            product features land.
- [ ] Do not claim a standing-board PASS from this checklist alone.

