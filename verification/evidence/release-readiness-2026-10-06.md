# Release readiness evidence — 2026-10-06

> **Superseded snapshot:** This note is bound to older source commit `1b6ba99761890326d57169fb000e2668caf03013` and the verification runs recorded below. It does not describe current `main`; see the [current remaining-gates ledger](../../docs/REMAINING_GATES_STATUS.md). Historical evidence below is preserved.

## Pushed commit and verification scope

- Tested source candidate: commit `1b6ba99761890326d57169fb000e2668caf03013` (on `origin/main` for these verification runs).
- Commit-bound source fingerprint from Verification Scopes run `37402818422`, artifact `verification-fast-37402818422` / run `20261006T021043Z-2547`: `917fe1828d17d485172ec6a8808bcbe710a6f7b44b559d6aff4d7e1f51c59bfe` (295 registered files). Before and after match; source drift is false.
- Exact-commit fast scope: **PASS**, 7 commands and 40/40 evidence entries **PASS**. Bounded supported TypeScript trace replay: **PASS**, 256 traces, 5,926 passes, 0 failures, 0 unsupported; this does not establish unsupported model actions or whole-application refinement.
- CI run [37402818488](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37402818488): completed **success** on the pushed commit; unit/integration tests and performance-benchmark jobs succeeded. Verification Scopes run [37402818422](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37402818422): completed **success**; Fast verification succeeded and Nightly verification was skipped.
- Separate focused selection integration: **PASS**, 2/2 tests. This is UI integration evidence only; it does not establish a production package, live-provider round trip, or billing lifecycle.
- The local folder `tmp/verification/runs/fast-tlc-pin-refresh-20261006b` began at `2026-10-06T02:04:34Z`, before the pushed commit timestamp `2026-10-06T02:10:00Z`; its fingerprint `482b524967b4ea5f31505eac3cdb3c42ef8237c7b112e6dea23d106b2dd1ca43` (296 files) is pre-commit evidence and is not the fingerprint for the pushed commit. Its raw files remain preserved locally; none are included here.

## Current blockers

- Candidate metadata in the pushed commit is npm version `2.3.0`, Chrome version `2.3.0.3`. The live [Chrome Web Store listing](https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo) remains version `2.3.0.2` (updated September 29, 2026) and states album scope is Google Photos only; the pushed source declares personal-album scope for all three providers, so listing and candidate do not match.
- Privacy-page observation: at `2026-10-06 02:19:38 UTC`, the web tool followed the Privacy Policy hyperlink from the live CWS listing (the page returned “Crawled: today,” 43 lines). Direct URL opening had reported the URL inaccessible; following the listing's link returned [the current privacy page](https://photosweep.pawsitivegames.chatgpt.site/privacy). It is headed “PhotoSweep and your Google Photos library,” describes Google Photos only (lines 3–7), says matching uses ~200px thumbnails rather than full originals and video poster/thumbnail stills (lines 12–14), and discusses Stripe Checkout/license identifiers (lines 24–26). It does not provide original-byte verification or licensing-recovery disclosures, nor an affirmative Chrome Web Store Limited Use statement. Public disclosure is a release blocker.
- Repository-scoped `gh secret list --json name` and `gh variable list --json name` each returned `[]`; no values were queried. The package workflow requires repository secret `PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY`; strict audit also requires `PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL`, `PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION`, `PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY`, and `PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=0`. No exact-commit production package/audit was produced in this check. Package readiness is **BLOCKED / NOT REVALIDATED**.
- Current exact-candidate Google, iCloud, and Amazon disposable round trips and cross-provider video playback remain **BLOCKED**: no current candidate ZIP/runtime/fixture binding establishes them. Production billing lifecycle and exact-candidate store submission/review remain **UNVERIFIED**.
- Overall release verdict: **NOT READY**. The fast scope, focused integration, and green CI workflows do not establish an overall formal-verification **PASS** or release readiness.

## Hashes of downloaded Verification Scopes artifact files

The artifact was downloaded for inspection and is available from the linked GitHub run; it was not added to the repository.

| Artifact file | SHA-256 |
| --- | --- |
| `verification-summary.json` | `34cabdd5b44a0359005951ebfbdecf423c686dd5f1c1e766ecd3e5ce5903b856` |
| `aggregate-result.json` | `fc641b0e45f5cb263436c0d75fa743de07c3c8a31b8ed106e3f7588391f50695` |
| `evidence.json` | `3f202033eae3049519839eebc7c5e802ba06ce7c8c118777e674757341a53216` |
| `model-trace-replay-supported.json` | `5a0edad333882b1804b442b95a6df36835bdc3134eb556cf6709f2e318c32475` |
