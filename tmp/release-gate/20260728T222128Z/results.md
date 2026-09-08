# PhotoSweep local release gates

- repo: `/Users/mustafadungarpurwala/Dev/GitHub/PhotoDuplicateFinder`
- utc: `20260728T222128Z`
- mode: `full`
- head: `e7a073e43cefe64d7f147a9c0d90e79858e34218`
- branch: `main`
- version: `2.2.5`
- node: `v22.23.1`
- npm: `10.9.8`

| Gate | Status | Seconds | Note | Log |
| --- | --- | ---: | --- | --- |
| install-root | FAIL | 42.24 | exit 1 | `/Users/mustafadungarpurwala/Dev/GitHub/PhotoDuplicateFinder/tmp/release-gate/20260728T222128Z/install-root.log` |
| install-gptk | FAIL | 3.80 | exit 1 | `/Users/mustafadungarpurwala/Dev/GitHub/PhotoDuplicateFinder/tmp/release-gate/20260728T222128Z/install-gptk.log` |
| diff-check | PASS | 0.03 | exit 0 | `/Users/mustafadungarpurwala/Dev/GitHub/PhotoDuplicateFinder/tmp/release-gate/20260728T222128Z/diff-check.log` |
| typecheck | FAIL | 0.10 | exit 127 | `/Users/mustafadungarpurwala/Dev/GitHub/PhotoDuplicateFinder/tmp/release-gate/20260728T222128Z/typecheck.log` |
| tests | FAIL | 0.10 | exit 127 | `/Users/mustafadungarpurwala/Dev/GitHub/PhotoDuplicateFinder/tmp/release-gate/20260728T222128Z/tests.log` |
| production-audit | FAIL | 0.43 | exit 1 | `/Users/mustafadungarpurwala/Dev/GitHub/PhotoDuplicateFinder/tmp/release-gate/20260728T222128Z/production-audit.log` |
| signature-audit | FAIL | 0.81 | exit 1 | `/Users/mustafadungarpurwala/Dev/GitHub/PhotoDuplicateFinder/tmp/release-gate/20260728T222128Z/signature-audit.log` |
| benchmarks | FAIL | 8.36 | exit 1 | `/Users/mustafadungarpurwala/Dev/GitHub/PhotoDuplicateFinder/tmp/release-gate/20260728T222128Z/benchmarks.log` |
| integration-build | FAIL | 0.63 | exit 127 | `/Users/mustafadungarpurwala/Dev/GitHub/PhotoDuplicateFinder/tmp/release-gate/20260728T222128Z/integration-build.log` |
| integration-tests | FAIL | 2.06 | exit 1 | `/Users/mustafadungarpurwala/Dev/GitHub/PhotoDuplicateFinder/tmp/release-gate/20260728T222128Z/integration-tests.log` |
| production-package | UNVERIFIED | 0.00 | missing required variable names: PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL, PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION, PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY | — |
| package-audit | UNVERIFIED | 0.00 | production package was not built | — |
| live-google | UNVERIFIED | 0.00 | not requested; live provider evidence is separate | — |

This report covers local gates only. It is not an overall release verdict.
