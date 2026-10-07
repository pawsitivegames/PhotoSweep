# Amazon regional video playback evidence

`AMAZON-VIDEO-PLAYBACK-live` is a separate release gate for successful
playback on every host listed in `AMAZON_MARKETPLACE_HOSTS` in
`lib/provider-sites.ts`. The runner derives that list from source at run time;
the current declaration contains 22 marketplaces. The existing
`VIDEO-PLAYBACK-live` obligation remains in place for exact-package playback
across Google Photos, iCloud Photos, and Amazon Photos.

The release runner builds the production package first and calculates its
`buildDigest` from the complete packaged file tree. Playback evidence must name
that exact digest. The runner does not discover Amazon routes, contact Amazon,
create capture records, or turn mock tests into live evidence. This manifest
feeds only `AMAZON-VIDEO-PLAYBACK-live`; it does not satisfy the separate
all-provider `VIDEO-PLAYBACK-live` obligation. Without a manifest, the Amazon
obligation stays `BLOCKED`, and the current runner also keeps the all-provider
obligation `BLOCKED` pending its own exact-package evidence.

## Supplying evidence

Pass an externally prepared manifest to a release run:

```sh
node verification/verification-runner.mjs --scope release \
  --amazon-video-playback-evidence /absolute/path/to/amazon-video-playback.json
```

The same path can be supplied through
`PHOTOSWEEP_AMAZON_VIDEO_PLAYBACK_EVIDENCE`.

Use two release runs so the captures and final gate refer to the same package:

1. Freeze the source tree, then run once without a candidate or playback
   manifest:

   ```sh
   node verification/verification-runner.mjs --scope release
   ```

   The Amazon obligation is expected to be `BLOCKED`. The runner packages more
   than once during this run, and `package:cws` assigns a fresh random build ID
   to each package operation. Use only the final candidate reported in this
   run's `command-production-package-final.log`: its JSON output has an
   `artifactFile` field naming the hash-named ZIP under `build/`. The matching
   Chrome Web Store metadata sidecar is next to that ZIP with the same basename
   and a `.json` extension. Use that `artifactFile` path for the next run.

   Read `buildDigest` from this run's `verification-summary.json`. This digest
   identifies the final compiled package file tree and is the value required
   for the manifest's `packageDigest`. It is distinct from the ZIP SHA-256 in
   the package metadata sidecar.

2. Install that exact ZIP in Chrome Stable and capture all source-declared
   markets. Bind the manifest and every capture sidecar to the `buildDigest`
   from step 1.

3. Run release verification again with the unchanged candidate ZIP and the
   external playback manifest:

   ```sh
   node verification/verification-runner.mjs --scope release \
     --candidate-package build/photosweep-cws-v<version>-sha256-<zip-sha-prefix>.zip \
     --amazon-video-playback-evidence /absolute/path/to/amazon-video-playback.json
   ```

   `--candidate-package` is release-only and must name a hash-named ZIP in
   `build/`. The runner passes it to `verification/release-candidate.mjs`, which
   checks its matching metadata sidecar, ZIP hash, compiled package contents,
   and current source fingerprint. The frozen-candidate path preserves this
   package instead of creating another random build ID. The second run's
   `buildDigest` must match step 1, and its source fingerprint must still match
   the candidate sidecar.

Any source-root or package change after step 1 invalidates the frozen
candidate's source/package binding. Repackage and capture all markets again
before running the gate. The runner records `VIDEO-PLAYBACK-live` and
`AMAZON-VIDEO-PLAYBACK-live` in separate `video-playback.json` and
`amazon-video-playback.json` artifacts.

The manifest is JSON with exactly these top-level fields:

| Field | Required value |
| --- | --- |
| `schemaVersion` | `1` |
| `evidenceType` | `photosweep.amazon-video-playback` |
| `captureMethod` | `chrome-devtools-mcp` |
| `packageDigest` | The release run's 64-character `buildDigest` |
| `captures` | One record per source-declared marketplace, with no duplicates or extras |

Each `captures` record contains exactly `marketplaceHost`, `captureId`,
`captureArtifact`, and `captureSha256`. `captureArtifact` is a relative path
from the manifest to one sanitized JSON sidecar. Paths must stay under the
manifest directory, point to regular files, and be unique. Symbolic links are
rejected in any sidecar path component, and the manifest itself must be a
regular, non-symlink file. `captureSha256` is the SHA-256 of the sidecar's
exact bytes.

Each sidecar contains exactly:

| Field | Required value |
| --- | --- |
| `schemaVersion` | `1` |
| `evidenceType` | `photosweep.amazon-video-playback-capture` |
| `captureMethod` | `chrome-devtools-mcp` |
| `captureId` | The same unique ID as its manifest record |
| `marketplaceHost` | The exact source-declared host for this capture |
| `packageDigest` | The same digest as the freshly built release package |
| `capturedAt` | A full ISO-8601 timestamp with `Z` or a numeric timezone offset; within the last 7 days and at most 5 minutes in the future |
| `browser` | `Chrome Stable` |
| `playback` | The successful observation described below |

`playback` contains exactly `videoElementFound`, `playbackStarted`,
`currentTimeBeforeSeconds`, `currentTimeAfterSeconds`, and `playbackError`.
The first two must be `true`, the after time must be finite and greater than
the nonnegative before time, and `playbackError` must be `null`. Each market
needs its own capture ID and sidecar. Keep the sidecars sanitized: do not
include account identifiers, media identifiers, page URLs, signed URLs, or
credentials. The strict field allowlists reject additional fields.

The validator checks the source list, package digest, capture hashes, per-market
uniqueness and completeness, strict timezone-bearing timestamp freshness, and
the playback observations reported in the sidecars. Browser, capture method,
and playback fields are self-reported; the validator does not authenticate that
Chrome DevTools recorded them or prove that playback occurred. Sidecar hashes
detect changes after the manifest was prepared, but do not authenticate the
capture tool or the sidecars' original contents. A passing gate therefore means
the submitted evidence passes schema and consistency checks. Before relying on
it for release, establish trusted evidence custody or authenticated provenance
that ties the sidecars to independent captures from the installed exact
package.

Missing manifest or package binding stays `BLOCKED`. A supplied manifest with
stale, mismatched, duplicate, missing, malformed, or failed market evidence is
`FAIL`; no partial set can pass.

Complete synthetic manifests are used only by
`tests/verification/amazon-video-playback-evidence.test.ts` to exercise the
validator. They are not release evidence and must not be passed to the runner.
