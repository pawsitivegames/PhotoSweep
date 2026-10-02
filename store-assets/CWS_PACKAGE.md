# Chrome Web Store package

The upload package is generated from the root `package.json` metadata:

- Title: `PhotoSweep for Google Photos™`
- Short description: `Find duplicate photos and videos in Google Photos. Matching stays in your browser. Review, then Trash only what you confirm.`
- App version: `2.3.0`
- Chrome Web Store version: `2.3.0.3`

Use full SemVer for the app version in `package.json`:

- Patch/maintenance release: `2.2.10`
- Feature release: `2.3.0`
- Major or breaking release: `3.0.0`

When the app version changes, set `chromeVersion` to `<new-app-version>.1`.
For another ZIP from the same app version, increment only the final component
(`<new-app-version>.2`, `<new-app-version>.3`, and so on) before packaging.

The title and short description are 29 and 124 characters respectively, within
the Chrome Web Store limits. Chrome uses four numeric dot-separated components
for release identity. The fourth component in `package.json.chromeVersion` is
incremented for every new ZIP from the same app version; do not use `2.2.9+1`,
because `+` metadata is not a valid Chrome manifest version.

`npm run package:cws` audits the generated manifest and creates a
hash-addressed upload ZIP plus a matching JSON sidecar:

```text
build/photosweep-cws-v2.3.0.3-sha256-<first-12-sha256>.zip
build/photosweep-cws-v2.3.0.3-sha256-<first-12-sha256>.json
```

The sidecar records the app version, Chrome version, full ZIP SHA-256, manifest
SHA-256, source commit, dirty-worktree state, and build timestamp. Upload the
hash-addressed ZIP and retain its sidecar; never upload the generic
`build/chrome-mv3-prod.zip` when exact artifact identity matters.

## Build locally

Use the release API values and the release entitlement public key; do not use a
development entitlement override:

```bash
git submodule update --init --recursive
npm ci
npm --prefix Google-Photos-Toolkit ci

export PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL="https://photosweep-license-api-206538169327.us-west1.run.app"
export PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION="https://photosweep-license-api-206538169327.us-west1.run.app/*"
export PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT="0"
export PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY="<release public key>"

npm run package:cws
```

The resulting hash-addressed ZIP is the Chrome Web Store upload package. The
command only builds and audits the ZIP; it does not submit or publish it.

To inspect the locked listing metadata in the generated package:

```bash
unzip -p build/photosweep-cws-v2.3.0.3-sha256-<first-12-sha256>.zip manifest.json
```
