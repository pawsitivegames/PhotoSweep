# PhotoSweep release operations

Verified checkpoint: 2026-10-21. This runbook supports the
[current release gate](REMAINING_GATES_STATUS.md); it does not authorize a
deployment, traffic shift, key rotation, restore, log deletion or customer email.

## Owner and current baseline

The release owner operating `pawsitivegames@gmail.com` approves production
changes and customer communication. Secret creation and entry remain an owner
handoff; use Secret Manager references without printing secret values.

| Resource | Current verified state |
| --- | --- |
| Project / region | `photosweep-prod` / `us-west1` |
| Production service | `photosweep-license-api`, revision `photosweep-license-api-00026-roq`, 100% traffic |
| Test service | `photosweep-license-api-test`, revision `photosweep-license-api-test-00019-zah`, 100% traffic |
| Production database | Firestore `(default)` |
| Test database | Firestore `photosweep-test`, separate collection prefix and signing key |
| Runtime identities | Separate `photosweep-api-prod` and `photosweep-api-test` service accounts; database access is scoped |
| Recovery | Production and test completion links target their own API origins; owner-only test delivery and restoration passed |
| Backups | Daily production schedule, 14-day retention; first completed backup and isolated restore/cleanup verified on 2026-10-21 |
| Availability | One-minute HTTPS health check; owner alert after failures from at least two locations for five minutes; test alert delivered |
| Logging | Project `_Default` exclusion for automatic recovery-completion request entries on the two license services; health request logging retained |
| Organization routing | Two standard organization sinks, neither collecting child-project logs; temporary audit access removed |

The exact current extension artifact and source binding are in the release gate
ledger. Keep the previous artifact and every interrupted or failed verification
run. Never infer that a healthy API proves provider, billing or Store acceptance.

## Availability or entitlement incident

1. Identify the affected environment. Check `/health` over HTTPS, active traffic
   revisions and the start time. Do not request customer recovery or Checkout
   links as a diagnostic. Do not dump full request URLs, cookies, email bodies,
   license records or environment variables.
2. Compare the active revision with the last accepted checkpoint. Read only
   metadata and the required status fields, for example:

   ```sh
   gcloud run services describe photosweep-license-api \
     --project=photosweep-prod --region=us-west1 \
     --format='json(status.traffic,status.latestReadyRevisionName)'
   ```

3. Examine bounded error counts/statuses and Stripe endpoint delivery state.
   Avoid full request-log output: historical recovery URLs can contain bearer
   credentials and remain under the existing log-bucket retention. The approved
   exclusion affects future matching project request entries, not history.
4. Separate API availability, signature/key mismatch, paid-access refresh,
   delayed Stripe delivery and provider-page connection failures. Preserve the
   evidence before changing traffic or retrying a transaction.
5. Present the exact proposed change, affected revision/configuration, validation
   and restoration target to the owner. Escalate immediately if authorization,
   database isolation, signing identity or selected Trash targets are uncertain.
6. After an approved change, verify HTTPS health, expected signer, cookie/origin
   boundaries and the affected paid-access lifecycle. Record both successful and
   failed attempts. The owner approves any customer notice; do not send one as
   part of a diagnostic check.

## Rollback safety

An older revision is not automatically safe. The eight inspected production
revisions did not contain an exact image/runtime/environment match to the current
revision. Do not shift to one merely because it previously served traffic.

Before a production rollback, freeze the current complete template spec, identify
the proposed target and compare image, environment/secret references, runtime
identity, database, network, resource and origin settings. Stage without default
traffic and verify the target. The owner-approved identical-image/full-config clone rehearsal passed on
2026-10-21: nine tagged checks, nine canary checks and nine restored checks;
5% traffic for at most 10.093 seconds, then revision `00026-roq` restored
to 100%. The temporary tag was removed and the clone retained at zero traffic.

Record the original routing and detect concurrent changes. Restore only routing
owned by the approved operation. Verify health and signer after restoration and
retain zero-traffic revisions; do not delete historical artifacts as cleanup.
The production rehearsal proves current-code/configuration traffic rollback.
It does not prove different-code or database migration rollback.

## Recovery and webhook failures

Recovery is bearer-link authentication, not an email-only session rebind. Links
are documented as valid for 24 hours and are reusable during that period; no
one-use guarantee is implemented or certified. Invalid, unknown, inactive and
refunded recovery cases must not set a session cookie or reveal eligibility.

The same normalized email has a durable 15-minute recovery-send cooldown. A
sender failure can have ambiguous delivery status, so do not repeatedly resend
or clear a customer's cooldown as a diagnostic. Never borrow production SMTP
credentials for a test. Owner-only sandbox recovery used the dedicated test
secret; the temporary fixture index was restored exactly afterward.

For a webhook incident, check the intended environment and endpoint, signature
verification and processed-event marker before proposing a resend. Record only
necessary status/count metadata. Real sandbox refund/dispute/redelivery evidence
is separate from live-mode payment proof. Do not fabricate events or replay a
live customer event without explicit approval for that event and environment.

## Backup and isolated restore

Check backup readiness before scheduling a restore:

```sh
gcloud firestore backups list --project=photosweep-prod --location=nam5 \
  --format='json(name,state,snapshotTime,expireTime)'
```

A schedule is not a backup or restore proof. Once an actual backup is ready,
prepare a review naming that backup, a new isolated destination database, access
scope, verification and retention/disposal plan. Obtain owner approval before
creating the restore resources. Do not restore production in place, connect the
application to the restored data or grant the test runtime access to production
customer data. Compare bounded counts/hashes in the cloud; do not export customer
records or credentials into local evidence. Migration rollback remains a separate
acceptance case.

Firestore backups contain data and indexes, but do not contain TTL policies or
Firebase Security Rules. Reapply the reviewed retention and access configuration
before routing any application to a restored database. The disposable rehearsal
copy stays disconnected from applications and is deleted after verification;
its TTL policy is not enabled during the test. See the
[Firestore backup contract](https://docs.cloud.google.com/firestore/native/docs/backups).

Accepted 2026-10-21 rehearsal: the approved backup restored successfully into a
new disconnected database in `nam5`. Metadata and aggregate-only queries read
14 root collections and 659 documents; no record bodies were downloaded. The
owned copy was deleted, its delete operation completed, and its endpoint returned
404. Production/test database configurations, IAM, service configuration/traffic
and the source backup matched the preflight baseline. Private evidence is in
`tmp/verification/release-ready-followup-20261020/isolated-restore-20261021-approved/`.
This proves bounded restore/cleanup acceptance; migration rollback remains
unverified.

## Key custody and rotation planning

Keep production and test signing/SMTP secrets separate. Read version, enabled
state, IAM and public-key fingerprint metadata for verification; never print the
private key or password. Do not place secrets in command arguments, source,
screenshots, logs or evidence files.

The current extension trusts one bundled signing key. A normal signer rotation
therefore requires a separately reviewed client/server compatibility rollout;
changing only the server key can make installed clients reject paid-access
tokens. Do not claim seamless key rollover is already supported. Plan the new
client trust set, backend activation, Store timing, old-client behavior, rollback
and retirement before creating or activating a replacement signing key.

For a suspected compromise, the owner decides containment and the availability
tradeoff. Stage and validate a separate candidate with the intended new public
key, secure Secret Manager custody and test/production separation. Do not copy a
test key into production or rotate the existing key during a release rehearsal.

## Close the operation

Record the exact candidate/revisions, affected resources, checks, time and
limitations. Verify temporary roles, tags, extensions, clock/network overrides
and fixture changes are cleaned up. Preserve rollback material and history.
Report `UNVERIFIED` for a missing external acceptance case; do not substitute a
unit test, successful schedule or healthy endpoint for the required live proof.
