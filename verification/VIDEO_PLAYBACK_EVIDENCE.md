# Exact-package provider video playback evidence

`VIDEO-PLAYBACK-live` requires one fresh Chrome Stable playback observation
each for Google Photos, iCloud Photos, and the supported Amazon video host
declared by `lib/provider-sites.ts` (currently Amazon.ca). Use synthetic video
fixtures only.

The evidence intake is for a frozen release candidate. The runner rejects a
playback manifest unless the same invocation uses `--candidate-package`; this
keeps the random package build ID stable while evidence is checked.

## Capture and verify

1. Freeze source and create a candidate with a release verification run. The
   playback obligation remains `BLOCKED` because no playback manifest is
   supplied. Use the final package named in that run's
   `command-production-package-final.log` and the `buildDigest` in
   `verification-summary.json`.
2. Install that exact ZIP in Chrome Stable. In the configured Chrome DevTools
   session, confirm the installed extension ID and version with
   `chrome-devtools.list_extensions`. For each provider target, open a
   disposable synthetic video and verify the packaged PhotoSweep viewer starts
   playback and that its media timeline advances without a playback error.
3. Prepare the manifest and one sanitized sidecar per provider using the
   schema below. Capture timestamps must be within seven days of verification.
   Keep account identifiers, media identifiers, page and signed URLs, and
   credentials out of the files.
4. Re-run release verification against the unchanged ZIP and manifest:

   ```sh
   PHOTOSWEEP_TRUSTED_DEVTOOLS_EXTENSION_ID=<id-from-list_extensions> \
     node verification/verification-runner.mjs --scope release \
       --candidate-package build/photosweep-cws-v<version>-sha256-<zip-sha-prefix>.zip \
       --video-playback-evidence /absolute/path/to/video-playback.json
   ```

   `PHOTOSWEEP_VIDEO_PLAYBACK_EVIDENCE` can supply the manifest path instead of
   the CLI flag. The supplied extension ID is independently compared with
   every sidecar. Missing package binding, trusted extension inventory, or
   manifest remains `BLOCKED`; malformed, stale, duplicate, mismatched, or
   failed observations are `FAIL`.

## Manifest schema

The manifest has exactly these fields:

| Field               | Required value                                       |
| ------------------- | ---------------------------------------------------- |
| `schemaVersion`     | `1`                                                  |
| `evidenceType`      | `photosweep.video-playback`                          |
| `captureMethod`     | `chrome-devtools-mcp`                                |
| `syntheticOnly`     | `true`                                               |
| `packageDigest`     | The release run's 64-character `buildDigest`         |
| `artifactSha256`    | SHA-256 of the exact candidate ZIP                   |
| `buildId`           | The UUID v4 from that ZIP's package metadata sidecar |
| `sourceFingerprint` | The fingerprint from the exact release candidate     |
| `captures`          | Exactly one entry for each provider target           |

Each capture entry contains exactly `provider`, `host`, `captureId`,
`captureArtifact`, and `captureSha256`. Use a unique UUID v4 for each
`captureId`. The sidecar path is relative to the
manifest, remains within its directory, is a regular file, and does not
traverse a symlink. Its hash is over the exact sidecar bytes.

Each sidecar contains exactly `schemaVersion`, `evidenceType`, `captureMethod`,
`captureId`, `provider`, `host`, `packageDigest`, `artifactSha256`, `buildId`,
`sourceFingerprint`, `capturedAt`, `browser`, `extensionId`,
`extensionVersion`, and `playback`. It repeats the manifest and package
identity, uses `Chrome Stable`, and binds to the independently supplied
extension ID and packaged extension version. `capturedAt` must be a full
ISO-8601 timestamp with a timezone.

`playback` contains exactly `videoElementFound`, `playbackStarted`,
`currentTimeBeforeSeconds`, `currentTimeAfterSeconds`, and `playbackError`.
The first two must be `true`, the finite nonnegative timeline must advance,
and `playbackError` must be `null`.

The validator rejects unknown fields to keep private data out of release
evidence. A passing result proves the submitted manifest, sidecar hashes,
package identities, and reported observations are internally consistent. The
JSON remains self-reported: the validator does not authenticate that the
capture came from DevTools or independently inspect the video. Keep the live
Chrome observation available for review; synthetic unit-test manifests are
never release evidence.
