# Release readiness evidence — 2026-10-06

> **Current snapshot:** This section records d7, the current pushed-main candidate. The prior source snapshot remains preserved under its labeled historical section. The rolling gate ledger is [docs/REMAINING_GATES_STATUS.md](../../docs/REMAINING_GATES_STATUS.md). These two current-status documents are excluded from Fast's registered-source fingerprint.

## Current pushed-main snapshot — 2026-10-06

- Candidate: pushed docs-only HEAD `d7ba3a282dcba5d4ed0a329855117cbc82a46091`, parent `d563d836492db6cf9541d7934d27b50b727ebdd9`; application source `2930de8d43fb4656583111303fbf7512d7508fcb` (npm `2.3.0`, Chrome `2.3.0.3`).
- CI [run 37427459501](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37427459501) completed success on exact d7: 103/103 Vitest files, 1,942/1,942 unit tests, 64/64 integration tests, and performance benchmarks passed. These results do not establish live-provider behavior.
- Fast [run 37427459542](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37427459542) completed success on exact d7. Artifact run ID `20261006T070541Z-2783`; 7 commands and 40/40 evidence entries passed, before/after fingerprint `ff23f9b0776d8cef30e78feaa9ce20722393678f4b53b5e6da1efa1e6e4be525` over 297 files, `sourceDrift=false`. `PARITY-01..09` passed 299/299 assertions; `VIDEO-PLAYBACK` passed 37/37; `SAFE-13-properties` passed.
- SAFE-01 checked its declared finite model to depth 7: 9,456 states explored, 291,697 generated, 19 invariants, with the unsafe bulk-trash negative control detected. The proof boundary excludes arbitrary initial valuations, TypeScript refinement, and whole-application behavior.
- Supported trace replay passed 256 traces to depth 24: 5,926 passes, 0 failures, 0 unsupported actions. The trace manifest has `source.git.dirty=true` while the Fast aggregate reports `sourceDrift=false`; this is bounded projection evidence.
- Authoritative workflow-dispatch Nightly [run 37427472668](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37427472668) remained `in_progress` at the latest check. Final `MUTATION-01` and other Nightly outcomes are **PENDING**; no completion result is claimed.

### Completed-results selection finding

The `release/2.3.0.2` source snapshot at commit `bee39564c50a933c4da1a836721d5a3e6c42e047` contains a conditional manual-provenance no-op: its [handler snapshot](https://github.com/pawsitivegames/PhotoSweep/blob/bee39564c50a933c4da1a836721d5a3e6c42e047/tabs/app.tsx#L3311) dispatches `apply_keep_strategy` without `overrideManualChoices`, and its [reducer snapshot](https://github.com/pawsitivegames/PhotoSweep/blob/bee39564c50a933c4da1a836721d5a3e6c42e047/lib/duplicate-review-session.ts#L180) skips groups with manual provenance. The live CWS 2.3.0.2 ZIP is not source-bound to that commit. Candidate 2.3.0.3 sets `overrideManualChoices: true` in [the handler](../../lib/keep-strategy-feedback.ts#L64); the [reducer override guard](../../lib/duplicate-review-session.ts#L231) resumes keeper-change review. The [two-completed-set integration test](../../tests/e2e/integration/app-tab.test.ts#L2296) checks visible keeper/Trash proposals, persistence after reload, and no provider Trash command before explicit confirmation. The cause of the reported user session remains **UNKNOWN** because its installed version and decision provenance are unknown.

### Package and owner gates

No exact-d7 production ZIP or strict audit was produced. The prior package audit on `2f8a83e4d9ad4f1e7c0b5297915a0c906f5a1b1c` passed inclusion/format checks with `sourceDirty=false`, fingerprint `94bc3434ac46c091031ac1fbc165c832971fb7a7918a5d7fa72514202b530099` over 298 package-source files, ZIP SHA-256 `011f5d8abb68eac0e177d2335fff24c7317bf3ac4d11b07b6d84f872522dc637`. It is prior-commit evidence and its scope differs from Fast's 297-file registered-source fingerprint. Exact-candidate package readiness is **UNVERIFIED**.

Read-only Cloud Run configuration maps `PHOTOSWEEP_ENTITLEMENT_PRIVATE_KEY` to Secret Manager `photosweep-entitlement-private-key-live:latest` (version 1 enabled); the secret contents were not read. No evidence pairs it with the package verifier fingerprint `8d9f3017...`, so production signer pairing remains **BLOCKED** pending owner confirmation or safe lifecycle proof. The repository Actions secret-name and variable-name lists are empty; the production-package workflow requires `PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY`. Names only were queried, no values were read, and no exact-d7 production package was verified.

### Public CWS/privacy and external gates

The live [CWS listing](https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo) serves 2.3.0.2 (updated September 29, 2026) and advertises iCloud/Amazon signed-in sessions while saying album scope is Google Photos only; the candidate declares personal-album scope across Google Photos, iCloud Photos, and Amazon Photos. The linked [home page](https://photosweep.pawsitivegames.chatgpt.site/) was verified as Google Photos-only by a direct read-only GET; the separate web fetch timed out. The linked [guide](https://photosweep.pawsitivegames.chatgpt.site/how-to-find-duplicate-photos-in-google-photos) is also Google-only. The linked [privacy page](https://photosweep.pawsitivegames.chatgpt.site/privacy) omits current provider-specific iCloud/Amazon paths, original-byte verification and license recovery, and the affirmative statement required by the [Chrome Web Store Limited Use policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use/). The reachable [refund page](https://photosweep.pawsitivegames.chatgpt.site/refunds) mentions the three advertised provider workflows for Lifetime Early Access and the seven-day refund policy. The prepared [privacy publication draft](../../docs/PRIVACY_POLICY_PUBLICATION_DRAFT_2026-10-05.md) is explicitly review-only and unpublished; its checklist requires owner confirmation of release parity/package, production data recipients/processors, recovery email delivery, analytics retention, policy promises, publication date/contact and inbox monitoring, and CWS Dashboard disclosures. Public listing/privacy parity is **FAIL**; the listing's support link lands on the Google-only home page, and support inbox delivery is **UNVERIFIED**.

No exact-d7 Google, iCloud, or Amazon provider round trips, provider Trash/Undo, or cross-provider video playback are established (**UNVERIFIED**). Production billing lifecycle and exact-candidate CWS submission/review/approval remain **UNVERIFIED**. Overall release verdict: **NOT READY**.

### Historical/intermediate verification runs — not current d7 evidence

- At commit `6437c6f3`, CI [37424103365](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37424103365) and Fast [37424103300](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37424103300) passed. Fast artifact `20261006T063056Z-2774` used fingerprint `6ea7b5ef59f1c6c2784b059cc78d14d8f1480c0c3ae289aae79cf5539fbd5805` over 297 files; this predates d563's 45 added test lines. Nightly [37424116887](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37424116887) was in progress at the last recorded check.
- At commit `d563d836492db6cf9541d7934d27b50b727ebdd9`, CI [37426937172](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37426937172) and Fast [37426937237](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37426937237) passed. These runs predate d7's committed parity-plan change. Nightly [37426945724](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37426945724) was in progress at the last recorded check.

## Superseded snapshot — source 1b6ba99761890326d57169fb000e2668caf03013

### Pushed commit and verification scope

- Tested source candidate: commit `1b6ba99761890326d57169fb000e2668caf03013` (on `origin/main` for these verification runs).
- Commit-bound source fingerprint from Verification Scopes run `37402818422`, artifact `verification-fast-37402818422` / run `20261006T021043Z-2547`: `917fe1828d17d485172ec6a8808bcbe710a6f7b44b559d6aff4d7e1f51c59bfe` (295 registered files). Before and after match; source drift is false.
- Exact-commit fast scope: **PASS**, 7 commands and 40/40 evidence entries **PASS**. Bounded supported TypeScript trace replay: **PASS**, 256 traces, 5,926 passes, 0 failures, 0 unsupported; this does not establish unsupported model actions or whole-application refinement.
- CI run [37402818488](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37402818488): completed **success** on the pushed commit; unit/integration tests and performance-benchmark jobs succeeded. Verification Scopes run [37402818422](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37402818422): completed **success**; Fast verification succeeded and Nightly verification was skipped.
- Separate focused selection integration: **PASS**, 2/2 tests. This is UI integration evidence only; it does not establish a production package, live-provider round trip, or billing lifecycle.
- The local folder `tmp/verification/runs/fast-tlc-pin-refresh-20261006b` began at `2026-10-06T02:04:34Z`, before the pushed commit timestamp `2026-10-06T02:10:00Z`; its fingerprint `482b524967b4ea5f31505eac3cdb3c42ef8237c7b112e6dea23d106b2dd1ca43` (296 files) is pre-commit evidence and is not the fingerprint for the pushed commit. Its raw files remain preserved locally; none are included here.

### Blockers recorded for the superseded snapshot

- Candidate metadata in the pushed commit is npm version `2.3.0`, Chrome version `2.3.0.3`. The live [Chrome Web Store listing](https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo) remains version `2.3.0.2` (updated September 29, 2026) and states album scope is Google Photos only; the pushed source declares personal-album scope for all three providers, so listing and candidate do not match.
- Privacy-page observation: at `2026-10-06 02:19:38 UTC`, the web tool followed the Privacy Policy hyperlink from the live CWS listing (the page returned “Crawled: today,” 43 lines). Direct URL opening had reported the URL inaccessible; following the listing's link returned [the current privacy page](https://photosweep.pawsitivegames.chatgpt.site/privacy). It is headed “PhotoSweep and your Google Photos library,” describes Google Photos only (lines 3–7), says matching uses ~200px thumbnails rather than full originals and video poster/thumbnail stills (lines 12–14), and discusses Stripe Checkout/license identifiers (lines 24–26). It does not provide original-byte verification or licensing-recovery disclosures, nor an affirmative Chrome Web Store Limited Use statement. Public disclosure is a release blocker.
- Repository-scoped `gh secret list --json name` and `gh variable list --json name` each returned `[]`; no values were queried. The package workflow requires repository secret `PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY`; strict audit also requires `PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL`, `PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION`, `PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY`, and `PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=0`. No exact-commit production package/audit was produced in this check. Package readiness is **BLOCKED / NOT REVALIDATED**.
- Current exact-candidate Google, iCloud, and Amazon disposable round trips and cross-provider video playback remain **BLOCKED**: no current candidate ZIP/runtime/fixture binding establishes them. Production billing lifecycle and exact-candidate store submission/review remain **UNVERIFIED**.
- Overall release verdict: **NOT READY**. The fast scope, focused integration, and green CI workflows do not establish an overall formal-verification **PASS** or release readiness.

### Historical hashes of downloaded Verification Scopes artifact files

The artifact was downloaded for inspection and is available from the linked GitHub run; it was not added to the repository.

| Artifact file | SHA-256 |
| --- | --- |
| `verification-summary.json` | `34cabdd5b44a0359005951ebfbdecf423c686dd5f1c1e766ecd3e5ce5903b856` |
| `aggregate-result.json` | `fc641b0e45f5cb263436c0d75fa743de07c3c8a31b8ed106e3f7588391f50695` |
| `evidence.json` | `3f202033eae3049519839eebc7c5e802ba06ce7c8c118777e674757341a53216` |
| `model-trace-replay-supported.json` | `5a0edad333882b1804b442b95a6df36835bdc3134eb556cf6709f2e318c32475` |
