# Standing-board funnel evidence

This is the **source contract**, not evidence that the live API, published
extension, or standing board uses it. Phase A merged on September 23, 2026;
older September 18 aggregates predate its identity fields and cannot be
reconstructed into installation cohorts or correlated attempts. Earlier
redeployment notes and version targets were historical plans. Current deployment
and publication must be verified separately by an authorized operator.

## Consent and collection

Optional client usage metrics remain off until the user chooses **Allow**.
The notice discloses event names, provider, plan, scan mode, count ranges, error
categories, limited reasons/outcomes, random install identifier, extension
version, and UTC day. Photo content, names, albums, URLs and reports are excluded.
The random identifier is stored locally, not derived from a provider account.
The existing license API request can carry its browser session cookie as
described in the privacy policy; the event handler does not enrich rows with it.

This repair adds **no persistent event fields**, operation/scan identifiers,
client occurrence timestamps, event IDs, retries, local event queue, or retention
policy. It only extends existing allowlists with `undo_attempted`, Undo failure
categories, and separate `0` / `1-99` count buckets. `0-99` remains accepted for
historical compatibility but cannot prove positive activity. No retention period
is established for production; collection/retention changes require a separate
explicit decision. The existing capped local stores can truncate history and
must not be treated as complete D7 evidence.

Each valid row in `${PHOTOSWEEP_FIRESTORE_COLLECTION_PREFIX ?? "photosweep"}_analytics_events`
has `name`, `installId`, `extensionVersion`, `dayKey`, server `recordedAt`, and
optional allowlisted provider/plan/mode/count/reason/outcome/error fields. Unknown
fields are stripped by the API. Invalid identity/version/day/receipt records are
excluded and flagged. Payment operational rows without this identity are not
client funnel observations.

Client delivery is optional and fire-and-forget: receipt counts are not unique
operations. Delivery can be missing, reordered or repeated. Consent revocation
drops events still waiting for identity resolution; it cannot recall a request
already sent. A current connected provider is observed once when consent is
granted, including if the connection was established while metrics were off.
No historical actions are replayed on opt-in.

## Operation semantics

- `trash_attempted`: emitted at actual dispatch after confirmation and all
  safety/persistence guards pass, not when the confirmation dialog opens.
- A successful dry run produces no `trash_completed` event.
- `trash_completed` includes a zero or positive moved-count bucket derived from
  reconciliation. A partial outcome also emits `error: trash_partial` and marks
  its completion partial; it is not a fully successful value milestone.
- `undo_attempted`: emitted at actual restore dispatch, for both immediate Undo
  and recovery-history restore. `undo_completed` and Undo failures use confirmed
  reconciled targets, not the raw provider success flag.
- Unknown/failing results and observed timeouts produce operation-specific error
  receipts. A timeout followed by a late result can produce multiple receipts;
  without attempt IDs these cannot safely become a per-operation failure rate.

## Export and coverage

The read-only operator command preserves existing options:

```bash
npm run analytics:export -- \
  --current-version <CONFIGURED_OLDER_VERSION_THRESHOLD> \
  --from <OBSERVATION_START_DAY> --to <OBSERVATION_END_DAY> \
  --cohort-from <FIRST_OBSERVED_COHORT_START> \
  --cohort-to <FIRST_OBSERVED_COHORT_END> \
  --history-from <ATTESTED_COMPLETE_AVAILABLE_HISTORY_START> \
  --history-through <ATTESTED_LAST_FULLY_OBSERVED_UTC_DAY> \
  --output <AGGREGATE_JSON_PATH>
```

`--current-version` supplies the threshold; the tool does not verify it is the
published version. Observation/cohort bounds are inclusive. Cohort bounds default
to observation bounds. The two new optional history bounds are an operator's
attestation of **complete available history**, not evidence supplied by the tool.
Do not provide them for a partial, capped, future, or still-open observation day.
Missing/inadequate history keeps the D7 proxy unavailable. Return events use full
attested history, not the filtered observation window. Only cohorts with a fully
observed day 7 enter its denominator; immature cohorts are counted separately.
The exporter performs no dashboard writes and exports no raw identities/rows.

## Schema version 2 and metric limits

The summary explicitly distinguishes `metrics` from `observedReceiptProxies`.
Consumers must not import a proxy under a stronger standing-board metric name.

| Field | Definition |
| --- | --- |
| `metrics.first_connect` | Distinct consented identities observed connecting in the window; not lifetime installs |
| `metrics.old_version_share` | Latest unambiguous receipt version numerically **older than** the configured threshold, divided by observed valid identities; newer versions are not old; missing trailing components equal zero |
| `metrics.first_scan_started`, `first_scan_completed`, `first_trash_or_undo` | `null`: attempt correlation/deduplication is unavailable |
| `metrics.median_time_to_value` | `null`: no installation timestamp exists |
| `metrics.d7_retention` | `null`: first observation is not installation, and delivery is incomplete |
| `metrics.error_rate` | `null`: no reliable unique-operation denominator exists |
| `observedReceiptProxies.first_*` | Distinct-install strict receipt-order chains for one provider within the window, not verified attempts |
| `observedReceiptProxies.median_connect_to_value_ms` | Median server-receipt duration from connect to a positive, nonpartial value receipt on the same provider; not install-to-value time |
| `observedReceiptProxies.d7_return_rate` | Same-identity activity on **exactly** client UTC day 7 after first observation within attested available history, mature cohorts only; not installation retention |
| `operationReceipts` | Separate scan/Trash/Undo attempted, completed and operation-error counts; excludes licensing errors; no mixed-start/completion ratio |

Exact receipt timestamp ties cannot establish causality. Conflicting versions at
the latest receipt time make version share unavailable rather than choosing
input order. Providerless rows cannot build a provider chain. Zero, ambiguous
legacy small buckets, and partial completions cannot become value milestones.

`qualityFlags` retain the identity/delivery/correlation limitations, identify
invalid rows, missing retention history and ambiguous latest versions. Do not
clear those flags, backfill unknowns, or turn `null` into zero/PASS. Summary event
counts remain receipt counts and version distributions omit ambiguous identities.
Schema version 1 exports must not be relabelled as version 2 evidence.

## Verification and rollout limits

Focused fixtures exercise numeric versions, exact D7/maturity/history, timestamp
ties, provider isolation, zero/partial outcomes, consent replay and pending-send
revocation. Integration tests exercise the built extension against provider/API
fixtures. These do not prove live provider behavior, historical completeness,
current production deployment or a standing-board PASS.

The API must accept the source allowlists before a compatible extension release;
older deployed APIs may reject new Undo events or small count buckets. Deployment,
extension publication, production queries and dashboard imports require separate
authorization. Existing metrics cannot be retrospectively strengthened without
new evidence and an explicitly approved collection contract.
