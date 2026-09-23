# Standing-board funnel evidence

PhotoSweep Phase A records a consented, privacy-safe event row that Store
Growth can aggregate without importing photo or account data. This document is
the import and verification contract for the standing board.

## Observed standing-board passConditions

The following conditions are quoted from the observed standing board. They are
acceptance conditions for Store Growth evidence, not claims that this PR has
made any board metric PASS:

1. `first_connect` — “A privacy-safe activation event is counted once per
   install identity in the reporting window.”
2. `first_scan_started` — “A first-scan-start event is counted after a
   successful connect for the same install identity.”
3. `first_scan_completed` — “A first-scan-complete event is counted only after
   a valid scan start.”
4. `first_trash_or_undo` — “The first Trash or Undo event is counted after a
   completed scan and retains its event type.”
5. `median_time_to_value` — “Each duration uses matched install and first-value
   timestamps, excludes negative intervals, and reports the documented median.”
6. `d7_retention` — “The D7 cohort and return event use the same privacy-safe
   install identity and fixed cohort window.”
7. `error_rate` — “Failures and attempts are from the same event contract and
   the denominator is non-zero and documented.”
8. `old_version_share` — “Version observations are present for the stated
   population and compare semver values correctly.”

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
  --from <OBSERVATION_START_DAY> \
  --to <OBSERVATION_END_DAY> \
  --cohort-from <D7_COHORT_START_DAY> \
  --cohort-to <D7_COHORT_END_DAY> \
  --output <PRIVACY_SAFE_OUTPUT_FILE>
```

`--from` and `--to` are optional inclusive observation-window `dayKey` bounds.
`--cohort-from` and `--cohort-to` define the fixed inclusive D7 cohort window;
when omitted, the observation bounds are used. The observation window must
include the later return events needed for D7 measurement. Without `--output`,
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

All derivations operate on distinct `installId` values in the selected
observation window. “Earliest” means the lowest server `recordedAt`; input
order breaks exact timestamp ties deterministically. A funnel transition must
occur after the preceding transition for the same install identity.

- `first_connect`: count of installs with an earliest `provider_connected`.
- `first_scan_started`: count of installs with a `scan_started` after that
  install's earliest successful `provider_connected`.
- `first_scan_completed`: count of installs with a `scan_completed` after that
  install's valid scan start.
- `first_trash_or_undo`: count of installs with a `trash_completed` or
  `undo_completed` after that install's valid scan completion. The aggregate
  export also includes `firstValueEventTypeCounts` with separate
  `trash_completed` and `undo_completed` counts.
- `median_time_to_value`: median milliseconds between each matched install's
  earliest successful `provider_connected` and its first valid
  `trash_completed` or `undo_completed`, using only non-negative intervals.
- `d7_retention`: installs whose first observation `dayKey` falls inside the
  fixed cohort window and that have any same-identity event at least seven
  calendar days later, divided by the fixed cohort count.
- `error_rate`: `error` event count divided by the count of
  `scan_started + scan_completed + trash_attempted + trash_completed +
  undo_completed` in the selected observation window. It is `null` when the
  denominator is zero; the exporter does not invent a PASS for a zero
  denominator.
- `old_version_share`: installs whose latest version observation in the stated
  observation population differs numerically from the run's
  `--current-version`, divided by that population. Numeric comparison pads
  missing trailing components with zero, so semver-equivalent forms compare
  equal.

The first-four values are distinct-install counts, not raw event totals. The
summary includes `d7CohortInstallCount`, `d7RetainedInstallCount`, and
`firstValueEventTypeCounts` so Store Growth can verify the passConditions
without receiving raw identities. Empty denominators produce `null` for the
rate/distribution metrics rather than an invented pass value.

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
