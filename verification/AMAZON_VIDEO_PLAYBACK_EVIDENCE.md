# Amazon regional video playback evidence

`VIDEO-PLAYBACK-live` is a release gate for successful playback on every host
listed in `AMAZON_MARKETPLACE_HOSTS` in `lib/provider-sites.ts`. The runner
derives that list from source at run time; the current declaration contains 22
marketplaces.

The release runner builds the production package first and calculates its
`buildDigest` from the complete packaged file tree. Playback evidence must name
that exact digest. The runner does not discover Amazon routes, contact Amazon,
create capture records, or turn mock tests into live evidence. With no supplied
manifest, the live obligation remains `BLOCKED`.

## Supplying evidence

Pass an externally prepared manifest to a release run:

```sh
node verification/verification-runner.mjs --scope release \
  --amazon-video-playback-evidence /absolute/path/to/amazon-video-playback.json
```

The same path can be supplied through
`PHOTOSWEEP_AMAZON_VIDEO_PLAYBACK_EVIDENCE`. To learn the digest for the exact
package before capturing playback, run the release runner once without the
manifest and read `buildDigest` from that run's `verification-summary.json`.
That run is expected to leave the video obligation `BLOCKED`. Capture playback
against that package, then run the release gate again with the manifest. The
second build must produce the same digest.

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
manifest directory, point to regular files, and be unique. `captureSha256` is
the SHA-256 of the sidecar's exact bytes.

Each sidecar contains exactly:

| Field | Required value |
| --- | --- |
| `schemaVersion` | `1` |
| `evidenceType` | `photosweep.amazon-video-playback-capture` |
| `captureMethod` | `chrome-devtools-mcp` |
| `captureId` | The same unique ID as its manifest record |
| `marketplaceHost` | The exact source-declared host for this capture |
| `packageDigest` | The same digest as the freshly built release package |
| `capturedAt` | An ISO timestamp within the last 7 days; at most 5 minutes in the future |
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
uniqueness and completeness, timestamp freshness, and playback observations.
It only accepts sidecars produced by the declared independent capture source;
the runner itself never generates them. The file hashes detect changes after
the manifest was prepared. They do not cryptographically authenticate the
capture tool, so the person supplying the evidence remains responsible for
confirming that each sidecar was recorded from the installed exact package.

Missing manifest or package binding stays `BLOCKED`. A supplied manifest with
stale, mismatched, duplicate, missing, malformed, or failed market evidence is
`FAIL`; no partial set can pass.

Complete synthetic manifests are used only by
`tests/verification/amazon-video-playback-evidence.test.ts` to exercise the
validator. They are not release evidence and must not be passed to the runner.
