# Final candidate browser failure: checkout free exit

Candidate base under test: `dd28bca987f107210304a85e13a4f3844525d459`.

The evidence-only probe is
`final-runtime-probes.spec.ts`, test
`checkout return with an unverifiable token stays retryable and preserves review`.
Run it after a fixture build with:

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools \
PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL=https://photosweep-license-api-206538169327.us-west1.run.app \
npx playwright test --config tmp/paid-conversion-verification/20260908T20260908T083456Z/final-runtime-probes.config.ts
```

The probe independently observed one checkout start, an HTTPS mocked checkout
response, a focus-triggered `/entitlement` refresh returning an unverifiable
token, retryable/unverified payment state, preserved review results, and no
Trash command. It then failed on a normal pointer click of `Keep reviewing free
results`: the click was intercepted by the persistent warning Snackbar.

The failure is reproducible at the checkout-start path in
`tabs/app.tsx:1750-1752`, which sets `trashWarning` while the upgrade dialog is
still open, and the warning Snackbar at `tabs/app.tsx:4665-4687`, which uses
`autoHideDuration={null}`. Playwright reported the role=alert Snackbar
intercepting the dialog button. This is a real free-exit/no-stacking failure;
do not use a forced click as proof. The consent test in the same probe passed.

Evidence logs:

- `final-runtime-probes-final.log` / `final-runtime-probes-final-exit.txt`
- `final-runtime-probes-rerun2.log` / `final-runtime-probes-rerun2-exit.txt`

Status: **FAIL — repair and re-freeze required** for the affected candidate.
