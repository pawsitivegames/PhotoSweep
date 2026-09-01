# Chrome Web Store package

The upload package is generated from the root `package.json` metadata:

- Title: `PhotoSweep for Google Photos™`
- Short description: `Find duplicate photos and videos in Google Photos. Matching stays in your browser. Review, then Trash only what you confirm.`
- Version: `2.2.6`

The title and short description are 29 and 124 characters respectively, within
the Chrome Web Store limits. `npm run package:cws` audits the generated
manifest before copying the upload zip to
`build/photosweep-cws-v<version>.zip`.

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

The resulting `build/photosweep-cws-v2.2.6.zip` is the Chrome Web Store upload
package. The command only builds and audits the zip; it does not submit or
publish it.

To inspect the locked listing metadata in the generated package:

```bash
unzip -p build/photosweep-cws-v2.2.6.zip manifest.json
```
