# Standing-board funnel evidence

PhotoSweep Phase A records a consented, privacy-safe event row that Store
Growth can aggregate without importing photo or account data. This document is
the import and verification contract for the standing board.

## Source collection and event-row schema

The Firestore collection is:

```text
${PHOTOSWEEP_FIRESTORE_COLLECTION_PREFIX ?? "photosweep"}_analytics_events
```

Each accepted client row contains these fields:

| Field | Meaning |
| --- | --- |
| `name` | Allowlisted event name |
| `installId` | Random UUID v4 generated once in `chrome.storage.local`; opaque and not account-linked |
| `extensionVersion` | Chrome manifest version, including the fourth release component when present |
| `dayKey` | Client UTC calendar day in `YYYY-MM-DD` form |
| `recordedAt` | Server receipt time in milliseconds; added by the store |
| `provider` | Optional allowlisted provider (`google`, `icloud`, or `amazon`) |
| other optional fields | Existing allowlisted plan, scan mode, count bucket, outcome, and error fields |

The client event names used by the funnel are `provider_connected`,
`scan_started`, `scan_completed`, `trash_attempted`, `trash_completed`,
`undo_completed`, and `error`. Other allowlisted product events remain in the
same collection and count toward retention only. Payment lifecycle rows do not
have `installId` and are excluded from this funnel export.

Rows with an invalid or missing funnel identity field are excluded by the
evidence script. The HTTP analytics handler rejects such rows before storage and
copies no unknown fields, so photo URLs, filenames, emails, raw reports, and
other PII attempts do not enter the client telemetry document.

## Export artifact

Run the read-only exporter with the normal Google Cloud credentials available to
the operator. The published Chrome version is intentionally supplied at run
time:

```bash
npm run analytics:export -- \
  --current-version <PUBLISHED_CHROME_VERSION> \
  --from <UTC_START_DAY> \
  --to <UTC_END_DAY> \
  --output <PRIVACY_SAFE_OUTPUT_FILE>
```

`--from` and `--to` are optional inclusive `dayKey` bounds. Without `--output`,
the same JSON summary is written to stdout. The script is
`tools/export-funnel-evidence.mjs`, and its pure aggregation implementation is
`server/funnel-evidence.mjs`.

The JSON artifact contains the collection name, selected window, total event
and install counts, event-name counts, latest-version distribution, and the
derived metrics below. It never contains event rows or install ids. Store
Growth can verify the artifact by checking that event counts reconcile to the
selected collection/window and that the version distribution's install total
matches `installCount`.

## Metric derivations

All derivations operate on distinct `installId` values in the selected window.
“Earliest” means the lowest server `recordedAt`; input order breaks exact
timestamp ties deterministically.

- `first_connect`: count of installs with an earliest `provider_connected`.
- `first_scan_started`: count of installs with an earliest `scan_started`.
- `first_scan_completed`: count of installs with an earliest `scan_completed`.
- `first_trash_or_undo`: count of installs with an earliest `trash_completed`
  or `undo_completed`.
- `median_time_to_value`: median milliseconds between each install's earliest
  `provider_connected` and earliest `trash_completed` or `undo_completed`, using
  only installs with both events and non-negative elapsed time.
- `d7_retention`: installs with any event on their first included UTC `dayKey`
  and any event at least seven calendar days later, divided by included installs.
- `error_rate`: `error` event count divided by the count of
  `scan_started + scan_completed + trash_attempted + trash_completed +
  undo_completed` in the selected window. It is `null` when the denominator is
  zero.
- `old_version_share`: installs whose latest event in the selected window has
  an `extensionVersion` different from the run's `--current-version`, divided by
  included installs.

The first-four values are distinct-install counts, not raw event totals. Empty
denominators produce `null` for the rate/distribution metrics rather than an
invented pass value.

## Deterministic fixture

`tests/server/funnel-evidence.test.ts` supplies synthetic event rows and asserts
all eight metric values, retention, error denominator, version comparison, and
the no-raw-id export shape. Run it with:

```bash
npx vitest run tests/server/funnel-evidence.test.ts
```

This Phase A change does not run a production Firestore export. A live evidence
artifact still requires authorized production credentials and the published
Chrome version parameter.
