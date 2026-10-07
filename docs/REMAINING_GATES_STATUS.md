# Remaining gate status

## Current exact-candidate status — 2026-10-07 00:37 UTC

Current `HEAD` and `origin/main` are `798e9d8700fb70c364f0666d3821b730d0c9248f`; the app candidate is `2161b9d445467a11bebec2cc2736ba186222de0f`. The only path changed between those commits is this status document, so runs on `798e9d8` below are app-source-equivalent to the candidate while remaining bound to the main SHA. Candidate-bound package and Nightly evidence remains bound to `2161b9d`. The workflow fix installs pinned TLC before release tests. Earlier package run [37547013730](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37547013730) on `f8c8c18` failed one release test: `model-trace-replay` expected `PASS` but got `BLOCKED` (1,976 passed / 1 failed). Its job did not include a TLC installation step. Same-SHA [CI run 37546264981](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37546264981) included pinned TLC setup and passed; commit `2161b9d` adds that setup to the package workflow, and the fresh candidate package run below passes.

Fresh live reads of the privacy page, CWS listing, and homepage are linked below; Amazon capability findings are based on source audit. CI, package, and pending Nightly runs do not re-check live providers, analytics controls, billing, or installed runtime.

| Gate | Status | Evidence and boundary |
| --- | --- | --- |
| Exact-source CI | **PASS (CURRENT MAIN; APP-SOURCE-EQUIVALENT TO CANDIDATE)** | [Run 37551736839](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37551736839) passed on exact SHA `798e9d8700fb70c364f0666d3821b730d0c9248f`. The only diff from app candidate `2161b9d445467a11bebec2cc2736ba186222de0f` is this ledger; run identity remains the main SHA. |
| Fast verification | **PASS (CURRENT MAIN; APP-SOURCE-EQUIVALENT TO CANDIDATE)** | [Run 37551736802](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37551736802) passed on exact SHA `798e9d8700fb70c364f0666d3821b730d0c9248f`. Its Nightly job is separate and remains pending on the app candidate. |
| Completed-results selection | **PASS (SYNTHETIC CI FLOW) / UNVERIFIED (LIVE INSTALL)** | Exact CI [run 37547831990](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37547831990) passed all six keeper-strategy application/persistence cases and the Best quality E2E across two completed duplicate sets. This proves the synthetic CI flow; installed CWS behavior remains unverified. |
| Production package workflow | **PASS (BUILD / STRICT AUDIT / UPLOAD)** | Candidate-bound [run 37547853700](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37547853700) passed on exact SHA `2161b9d445467a11bebec2cc2736ba186222de0f`: release configuration presence check, Node 24, pinned TLC setup, typecheck, 103 test files / 1,977 tests, package build, strict package audit, and artifact upload. Manifest is MV3 version `2.3.0.3` (app `2.3.0`). ZIP SHA-256: `644b4bb2b63b362dda1955433677c3f910105c8501aea949e2b536ce9ce40ff5`; manifest SHA-256: `06ad30c04be75f52ebf6d4e2905a87c4170b43a646b48585b1a61fbb17571d62`; uploaded Actions archive digest: `sha256:92059097a878c28b7efe89424a0a83b1eca81e8c615f8a5ec13ee5061b00c426`. Public verifier fingerprint: `8d9f301737889e8c32fe7b8b44fc2d62458b87d1fa45cea29558b832364ab2b2`; no key bytes were read. |
| Package source provenance | **CAVEAT / PATH INVENTORY UNKNOWN** | Artifact metadata records `sourceDirty=true`, `sourceStatusSha256=c25ef00754d554864d182e613e416c27cf543579938d34eb88b6bbad692b8574`, `trackedDiffSha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty tracked diff), and a 298-file source fingerprint `f7bdae94ab2b57fef9415247df3d94e475585408c0ed7dd12e54d75450202c6f`. The workflow downloads pinned TLC under unignored `tmp/verification/`; release tests also create generated verification outputs there. Those outputs plausibly explain the dirty signal, but the stored status hash does not reveal the complete path list. Do not treat the package worktree as proven clean. |
| A5 / Pipeline Nightly | **UNVERIFIED / PENDING** | Exact-candidate [run 37548425058](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37548425058) remains in `Run nightly verification scope`; no artifact is available yet. |
| Amazon video playback — E5 | **FAIL (SOURCE) / IMPLEMENTATION BLOCKED** | Playback is currently Canada-only in [the route](../scripts/amazon-photos-commands.js#L705), while [22 marketplace hosts are configured](../lib/provider-sites.ts#L9). Keep all-region playback blocked pending an official regional route contract or sanitized per-region traces. |
| Amazon original-byte hashing | **LIMITED (CANADA ONLY) / UNVERIFIED ELSEWHERE** | [Original-content verification is gated to Canada](../scripts/amazon-photos-commands.js#L500); this separate hash capability is not assigned the all-region playback requirement. |
| Privacy disclosures and analytics retention — G3 | **PASS (PROVIDER / LIMITED USE DISCLOSURE) / BLOCKED (OWNER CHOICE AND RETENTION CONTROL)** | Fresh review of the [live privacy page](https://photosweep.pawsitivegames.chatgpt.site/privacy) passed provider and Chrome Web Store Limited Use disclosures and states Amazon original-byte checks are Canada-only. The production Firestore TTL listing was empty; analytics retention remains blocked pending the owner policy choice. Disclosure is not a retention/deletion control. |
| GitHub entitlement public-key secret / live signer | **SECRET PRESENT / SIGNER EQUIVALENCE UNVERIFIED** | A name-only GitHub Actions secret listing shows `PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY` exists, last updated `2026-10-06T23:31:08Z`. The value was not accessed or recorded. No production signed-entitlement round trip establishes equivalence with the deployed signer. |
| CWS listing and public homepage — G7 | **FAIL (STALE VERSION / HOMEPAGE COPY) / UNVERIFIED (PAYMENT DISCLOSURE)** | The [live listing](https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo) remains `2.3.0.2` while this package is `2.3.0.3`. Its copy mentions iCloud and Amazon; its Google-only album-scope statement matches the current product limit. The [live homepage](https://photosweep.pawsitivegames.chatgpt.site/) remains Google-only. Payment disclosure/dashboard consistency remains unverified. |
| Live providers, billing, and runtime | **UNVERIFIED** | No exact-package live provider round trips, mutation/Undo, production billing/refund lifecycle, candidate Chrome install/update, saved Dashboard state, submission, or review outcome is established. |
| Other unverified parity-matrix rows | **UNVERIFIED** | B8, B10; C1–C3 and C5; D5–D6; E1–E4 and E6–E9; F1–F8; G2, G4, G6, and G8–G11 remain unverified for this exact candidate. |

**Overall release status: NOT READY.** CI and Fast passed on current `main` `798e9d8`, whose application source matches candidate `2161b9d`; completed-results selection and the production package workflow have candidate-bound passes. Candidate Nightly remains pending. Amazon all-region playback is source-failed and implementation-blocked; analytics retention is blocked pending owner choice; the stale public listing, live provider, billing, and runtime gates remain open. The Actions secret name is present, but live signer equivalence remains unverified. The package `sourceDirty=true` caveat also limits worktree cleanliness claims. No deployment, store submission, or publication is evidenced by these runs.

## Superseded exact-source refresh — 2026-10-06 23:22 UTC

This snapshot is superseded by the 2026-10-07 00:37 UTC status above. It was audited against remote `main` at `bcf1a36c5e92838fd4e9b98e8487b3d41b3a588d` before later ledger-only changes; the application source was equivalent to `08e48880384becd33944de93cf5a080c6210785b`. The name-only secret inventory below reflects that earlier observation; a later listing at `2026-10-06T23:31:08Z` showed the secret exists. This section also supersedes the 22:41 UTC snapshot immediately below, which remains historical evidence.

| Gate | Status | Current evidence and boundary |
| --- | --- | --- |
| Exact-source identity | **PASS (APP-SOURCE-EQUIVALENT)** | Audited main SHA was `bcf1a36c5e92838fd4e9b98e8487b3d41b3a588d`; `git diff --name-only 08e48880384becd33944de93cf5a080c6210785b bcf1a36c5e92838fd4e9b98e8487b3d41b3a588d` lists only `docs/PLATFORM_PARITY_HARDENING_PLAN.md`, `docs/PRIVACY_POLICY.md`, and `docs/REMAINING_GATES_STATUS.md`. This refresh changes only this status document. |
| GitHub CI | **PASS (EXACT AUDITED SHA)** | [Run 37544350389](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37544350389) passed on `bcf1a36c5e92838fd4e9b98e8487b3d41b3a588d`: 103 unit-test files / 1,977 tests, 64 integration tests, and performance benchmarks. The log includes the Best-quality two-set E2E at `tests/e2e/integration/app-tab.test.ts:2296`. |
| Fast formal verification | **PASS (EXACT AUDITED SHA)** | [Run 37544350415](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37544350415) passed Fast verification with pinned TLC tooling; its Nightly job was skipped. The latest source-equivalent Nightly [run 37524353441](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37524353441) passed on `08e48880384becd33944de93cf5a080c6210785b`; the source diff to the audited SHA contains only documentation paths. Older failures recorded for source `582c0d4` are superseded historical evidence. |
| Completed-results selection | **PASS (SYNTHETIC CI FLOW) / UNVERIFIED (LIVE INSTALL)** | The exact CI E2E for two completed groups passed: each group keeps its unique original-quality item, proposes the remaining eligible copies for Trash, persists after reload, and dispatches no provider Trash command. Focused component/core tests also passed 152 tests across five files. A separate local focused E2E attempt timed out before assertions because the temporary extension service worker did not start. The connected Chrome profile has no PhotoSweep extension; the live CWS package remains `2.3.0.2` while candidate source is `2.3.0.3`. |
| Best-quality ranking across providers | **PASS (SELECTION MECHANICS) / UNVERIFIED (PROVIDER-TRUE QUALITY)** | Google maps a provider quality Boolean when available (`scripts/google-photos-commands.js:663`); iCloud and Amazon adapters set `isOriginalQuality` to `null` (`scripts/icloud-photos-commands.js:1588-1590`, `scripts/amazon-photos-commands.js:1513-1515`). The shared fallback compares resolution area, bytes, trusted dates, and stable keys (`lib/keep-strategy.ts:347-500`), and the UI labels deterministic fallback cases. Those proxies do not establish original-quality ranking for iCloud or Amazon. |
| Amazon regional playback and original-byte verification — E5 | **FAIL** | 22 Amazon marketplace hosts are configured (`lib/provider-sites.ts:9-37`), but both video playback and original-byte hashing are gated to Amazon Photos Canada (`scripts/amazon-photos-commands.js:493-510,705-757,1515-1521`). No supported route contract for the other claimed regions is evidenced; live regional playback remains unverified. |
| Analytics retention — G3 | **FAIL (OWNER POLICY AND CONTROL MISSING)** | The production Firestore TTL listing returned `[]`. Product usage and purchase/refund lifecycle events share `prod_analytics_events`, so one TTL would affect both classes. The live privacy page accurately states there is no fixed retention/deletion period, but disclosure is not a retention control. No TTL or data deletion was changed; the retention policy decision is pending. |
| CWS listing and public homepage — G7 | **FAIL (STALE LISTING / HOMEPAGE COPY) / UNVERIFIED (PAYMENT DISCLOSURE)** | The [CWS listing](https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo) is `2.3.0.2`, uses Google-focused title/overview, and says album scope is Google-only although source declares personal album scope for all three providers. The live homepage remains Google-only. The live privacy page now covers Google, iCloud, Amazon, and Chrome Web Store Limited Use; it explicitly says Amazon original-byte checks are Canada-only and telemetry retention is undefined. The CWS “Offers in-app purchases” badge vs Stripe Checkout copy still needs Dashboard verification. No public page or listing was changed. |
| Package signer and production package | **HISTORICAL / SUPERSEDED** | At this snapshot, the name-only repository Actions secret listing was empty. The later `2026-10-06T23:31:08Z` listing showed `PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY` exists. No payload was read; live signer equivalence remains unverified. The local package audit recorded here used Node 26/npm 11 and the public key from the live `2.3.0.2` CRX, so it does not prove signer equivalence or the Node 24 workflow package. |
| Live providers, mutations, billing, install/update, Dashboard, submission and review | **UNVERIFIED** | No exact-candidate live provider round trips, Trash/Undo, production billing lifecycle, saved Dashboard state, candidate install/update, or store submission/review outcome is established. |

**Overall release status: NOT READY.** The all-region Amazon playback/original-verification gap, retention control, and stale public listing/homepage remain open; signer equivalence and production/store operation evidence are also missing.

## Superseded exact-source release-gate snapshot — 2026-10-06 22:41 UTC

This addendum supersedes the stale 2026-10-06 20:55 UTC / `c65244a3f2da2252f654b57c32825d0c035af52f` snapshot in the [parity hardening plan](PLATFORM_PARITY_HARDENING_PLAN.md), the earlier `582c0d4` parity/package snapshots, and the `3728569` snapshot immediately below. Those records are preserved as historical evidence. At capture, the clean worktree HEAD and `origin/main` were both `07aa24004a8d95f44d828aa3b2a80901a810276a` (app `2.3.0`, Chrome `2.3.0.3`). A source diff from app-source commit `08e48880384becd33944de93cf5a080c6210785b` to `07aa24004a8d95f44d828aa3b2a80901a810276a` contains only documentation paths, so the application source is equivalent. This addendum is documentation-only.

| Gate | Status | Current evidence and boundary |
| --- | --- | --- |
| Exact-source identity | **PASS** | `HEAD` and `origin/main` resolve to `07aa24004a8d95f44d828aa3b2a80901a810276a`; the app-source-equivalent commit is `08e48880384becd33944de93cf5a080c6210785b`. |
| GitHub CI | **PASS** | [Run 37536603619](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37536603619) completed successfully on exact SHA `07aa24004a8d95f44d828aa3b2a80901a810276a`. |
| Fast verification | **PASS (SCOPED)** | [Run 37536603691](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37536603691) completed successfully on exact SHA `07aa24004a8d95f44d828aa3b2a80901a810276a`. Artifact `verification-fast-37536603691` digest: `sha256:ddc32848996262d39c49a114f8a976c20d69440f2e9dc9f41708403e8e3556ac`. |
| Nightly verification | **PASS (APP-SOURCE-EQUIVALENT)** | [Run 37524353441](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37524353441) completed successfully on `08e48880384becd33944de93cf5a080c6210785b`. The docs-only difference to exact main tip `07aa24004a8d95f44d828aa3b2a80901a810276a` preserves application-source equivalence. Artifact digest: `sha256:5f38d87bd4a20b3c961bcaab4545d146cd02d0d017e67380bd142cb35a3a1f59`. |
| Completed-results selection fix | **PASS (FOCUSED SOURCE TESTS) / UNVERIFIED (LIVE RUNTIME)** | The focused selection regression report records 8 integration and 101 unit tests passing. Source references include [the toolbar selection integration](../tests/e2e/integration/app-tab.test.ts#L2296) and [keep-strategy feedback tests](../tests/lib/keep-strategy-feedback.test.ts#L48). Chrome DevTools currently reports no PhotoSweep extension installed, so the reported user-session cause and live runtime outcome remain unknown. |
| Amazon regional video parity — E5 | **FAIL** | The user requires video playback in every claimed region. [22 Amazon marketplace hosts are configured](../lib/provider-sites.ts#L9), while [the video route rejects non-Canada hosts](../scripts/amazon-photos-commands.js#L705) and the item capability is unavailable outside Canada (same file, lines 1517–1520). Live regional playback remains unverified. |
| CWS listing and public homepage — G7 | **FAIL (STALE VERSION / ALBUM-SCOPE / HOMEPAGE COPY) / UNVERIFIED (PAYMENT-DISCLOSURE CONSISTENCY)** | The [CWS listing](https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo) is version `2.3.0.2` while the candidate is `2.3.0.3`; its title and overview are Google-focused. Its long description acknowledges iCloud/Amazon browser use but says album scope is Google Photos only; the candidate declares album scope supported for Google, iCloud, and Amazon. The linked [homepage](https://photosweep.pawsitivegames.chatgpt.site/) remains Google-only in its title, introduction, feature claims, and visual, which does not reflect the multi-provider candidate. The listing's “Offers in-app purchases” badge alongside Stripe Checkout copy raises a Dashboard/listing consistency question; the actual Dashboard declaration is unverified, so this is not recorded as a policy failure. |
| Live privacy page and retention | **CONTENT UPDATED / RETENTION UNVERIFIED** | The [live privacy page](https://photosweep.pawsitivegames.chatgpt.site/privacy), updated October 6, now describes Google Photos, iCloud Photos, and Amazon Photos data flows. It states that server-side usage-metrics events have no fixed retention or deletion period. The retention-owner decision and operational claims on the page still require review; this page does not establish saved CWS Dashboard declarations. |
| GitHub package secret and live signer | **HISTORICAL / SUPERSEDED** | At this snapshot, a name-only repository Actions secret listing was empty. The later `2026-10-06T23:31:08Z` listing showed `PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY` exists. Secret Manager metadata reported version 1 of `photosweep-entitlement-private-key-live` as **ENABLED**; no secret value was read, and current live signer equivalence remains unverified. |
| Local production-configured package and strict audit | **PASS (LOCAL ONLY) / UNVERIFIED (WORKFLOW AND SIGNER)** | The isolated clone at source commit `07aa24004a8d95f44d828aa3b2a80901a810276a` built ZIP SHA-256 `3ec4ce7ada7b1071c9eb4710dd63c0a1bdc8402575d337f39906a3ba6c20ca98` (14,759,360 bytes), build ID `c979cb76-af93-47c4-a4b2-ec6104a79ebf`, source fingerprint `5b76d265b94dea189fc7e2841fa896fabc4cc3ca403c5b822493c840f94b1d78` (298 files), `sourceDirty=false`. `npm run package` and `npm run audit:extension-package` both exited 0. The audit embedded public verifier fingerprint `8d9f301737889e8c32fe7b8b44fc2d62458b87d1fa45cea29558b832364ab2b2`, extracted from the published CWS 2.3.0.2 CRX with SHA-256 `5e1426298f6eb60657aa2397b3ba9433746120d2a2e4ef2329c9e8f5f297c83a`. This is not evidence of GitHub secret/live signer equivalence. The local run used Node 26.10.0/npm 11.19.1; the package workflow uses Node 24, so its exact-runtime build remains open. Local ZIP: [package](../build/photosweep-local-package-audit.4Qqlzh/repo/build/photosweep-cws-v2.3.0.3-sha256-3ec4ce7ada7b.zip); [metadata](../build/photosweep-local-package-audit.4Qqlzh/repo/build/photosweep-cws-v2.3.0.3-sha256-3ec4ce7ada7b.json); [build log](../build/photosweep-local-package-audit.4Qqlzh/logs/package.log); [strict-audit log](../build/photosweep-local-package-audit.4Qqlzh/logs/strict-audit.log). These are local ignored artifacts, not uploaded or submitted. |
| Provider runtime, install/update, billing, CWS Dashboard, submission and review | **UNVERIFIED** | No exact-package live Google/iCloud/Amazon round trips, Trash/Undo, install/update behavior, production billing lifecycle, saved Dashboard state, or submission/review outcome is established. |

**Overall release status: NOT READY.** E5 Amazon regional video parity and G7 listing/public-copy mismatch are current failures; signer, retention, live provider/runtime, billing, Dashboard, install/update, and store review evidence remain open.

#### Reproducible evidence reference

- Candidate binding: `git rev-parse HEAD` and `git rev-parse origin/main` both returned `07aa24004a8d95f44d828aa3b2a80901a810276a`. `git diff --name-only 08e48880384becd33944de93cf5a080c6210785b 07aa24004a8d95f44d828aa3b2a80901a810276a` listed only `docs/PLATFORM_PARITY_HARDENING_PLAN.md`, `docs/PRIVACY_POLICY.md`, and `docs/REMAINING_GATES_STATUS.md`.
- Workflow evidence: the three linked GitHub Actions runs above are read-only run records. The Nightly result is tied to app-source SHA `08e4888`, not a separate run on the docs-only `07aa` commit.
- Package reproduction: in the isolated clone, `npm run package` then `npm run audit:extension-package`, with the production API base/host permission, `PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=0`, strict dev-key absence enabled, and the public CWS verifier selected by its fingerprint. The public key value was not taken from or compared to a secret.
- Current public copy: [CWS listing](https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo), [homepage](https://photosweep.pawsitivegames.chatgpt.site/), and [privacy page](https://photosweep.pawsitivegames.chatgpt.site/privacy), all checked on 2026-10-06.

## Superseded source and release-gate snapshot — 2026-10-06 (main commit 3728569769)

The latest `main` commit with CI and Fast evidence in this snapshot is `3728569769add25f654c9858b10a0d38b43f44ef` (application-source SHA `08e48880384becd33944de93cf5a080c6210785b`; target Chrome version `2.3.0.3`). Nightly passed on the same application-source SHA. These automation results do not establish live-provider, installed-package, payment, or store behavior.

| Gate | Status | Current evidence and boundary |
| --- | --- | --- |
| GitHub CI | **PASS** | [CI run 37535574130](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37535574130) passed on main commit `3728569769add25f654c9858b10a0d38b43f44ef`. |
| Fast Verification | **PASS - scoped** | [Verification Scopes run 37535574123](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37535574123) passed its Fast verification job on main commit `3728569769add25f654c9858b10a0d38b43f44ef`. Artifact `verification-fast-37535574123`: 40/40 evidence entries across 7 commands, `sourceDrift=false`, fingerprint `a88332ae810fe22e4b08a1b7413452d347e0149ac8a356d7341919d334d144a1` across 297 files. This is scoped verification, not live-provider or exact-package behavior. |
| Nightly verification | **PASS - scoped** | [Nightly run 37524353441](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37524353441) passed on application-source SHA `08e48880384becd33944de93cf5a080c6210785b`: 1,150 tests passed; TLC, SAFE-01, and SAFE-12 passed; mutation score 94.66% with mutation policy **VALID**. |
| Amazon video playback across claimed/configured regions | **BLOCKER** | The user requires support in every claimed region. No supported playback routes have been proven across the configured regions outside Canada; do not claim all-region parity without exact-package evidence. |
| GitHub release-key configuration | **HISTORICAL / SUPERSEDED** | This snapshot recorded the GitHub secret `PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY` as absent. A later name-only listing at `2026-10-06T23:31:08Z` showed it exists. No secret value was accessed or recorded; production signer equivalence remains unverified. |
| Exact-package provider, video, and mutation evidence | **UNVERIFIED** | Live provider round trips, Trash/Undo mutations, video playback, and mutation evidence have not been demonstrated against the exact release package. |
| Completed-results runtime selection | **UNREPRODUCED / BLOCKED** | The Chrome profile has no PhotoSweep extension installed, and the user's installed-version response is pending. Runtime selection behavior therefore remains unverified. |
| Public Site Privacy page | **PASS - deployment/content checked** | Privacy page v10 is deployed at [photosweep.pawsitivegames.chatgpt.site](https://photosweep.pawsitivegames.chatgpt.site) from Site source commit `536819407ccc5bb4cb839bb249927e6dfdb5c157`. A Chrome hard reload confirmed the page says server-side analytics events are stored in Firestore and no fixed retention/deletion period is defined. The repository policy and public Site page are separate artifacts; a change to one does not update the other. |
| Analytics retention and deletion | **OPEN / OWNER DECISION** | The current Firestore TTL list is empty and application source defines no analytics deletion policy. The user has been asked to choose 90 days, 180 days, or to leave the policy open. No TTL or deletion behavior is implemented by this status update. |
| Chrome Web Store listing, dashboard, and review | **BLOCKER / UNVERIFIED** | The public listing remains at version `2.3.0.2` while the target is `2.3.0.3`. Dashboard declarations, submission of the target package, and review/approval remain unverified. A deployed Site page does not establish those CWS gates. |
| Paid checkout, refund, and store transactions | **UNVERIFIED** | No exact-candidate production checkout/refund lifecycle or store transaction evidence has been established. |

Overall status: **NOT READY**. CI, Fast, and Nightly passes do not close the exact-package, provider/video, runtime-selection, signing-key, analytics-retention, billing, CWS dashboard, submission, or review blockers above.

### Historical/intermediate run sets — earlier source snapshots

- Commit `6437c6f3`: CI [37424103365](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37424103365) and Fast [37424103300](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37424103300) passed. Fast artifact `20261006T063056Z-2774` reported 7 commands, 40/40 evidence entries, `sourceDrift=false`, and fingerprint `6ea7b5ef59f1c6c2784b059cc78d14d8f1480c0c3ae289aae79cf5539fbd5805` over 297 files. This fingerprint predates the 45 test insertions in d563. Nightly [37424116887](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37424116887) was `in_progress` at the last recorded check.
- Commit `d563d836492db6cf9541d7934d27b50b727ebdd9`: CI [37426937172](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37426937172) and Fast [37426937237](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37426937237) passed. These runs predate d7's committed parity-plan change. Nightly [37426945724](https://github.com/pawsitivegames/PhotoSweep/actions/runs/37426945724) was `in_progress` at the last recorded check.

Overall status: **NOT READY**. Owner, package, provider, billing, privacy/CWS, and store gates remain open.

## Preserved candidate status — 2026-10-05 (official registered-source run)

The official candidate is source commit `b90bd56d893d2ccf701abc69a496b98f13842258`,
registered fingerprint `43d2c2321e702126a80041282662ffb3e34d4ee8996fd53a0adc02f8927f47ab`
(296 files). The [tracked evidence note](../verification/evidence/release-readiness-2026-10-05.md) records matching before/after fingerprints with no source drift. The official
release result is **FAIL**: 53 evidence entries across 17 commands, with 48
**PASS**, one **FAIL**, and four **BLOCKED**. Details and local log hashes are in [tracked evidence note](../verification/evidence/release-readiness-2026-10-05.md).

| Gate | Status | Current evidence |
| --- | --- | --- |
| Registered-source properties, model, boundary, corpus, performance, browser, and mock gates | **PASS** | Current official run bound to fingerprint `43d2c232…`. Common main-flow support is source/property proof, not provider-runtime proof. |
| `MUTATION-01` | **PASS** | Policy **VALID**; 196 reviewed/resolved, 94.84% closure, 0 critical survivors; official mutation raw report SHA-256 `00d9504c4ce9507706c28688f80b3d33ef652145778e8036b177b8dba57ccb00`. The mutation result and policy triage status are summarized in the [tracked evidence note](../verification/evidence/release-readiness-2026-10-05.md). |
| `SAFE-09-package` | **FAIL** | The package restore attempt failed strict audit: the three production license variables are missing and `PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT` must be `0`. No valid candidate package/audit resulted. |
| Google, iCloud, and Amazon disposable round trips | **BLOCKED** | No current candidate ZIP hash, runtime identity, or fixture inventory binds the sessions. |
| Exact-candidate video playback across providers | **BLOCKED** | No exact-package playback evidence. |
| Connected Chrome UI (external observation) | **BLOCKED** | The current view shows only the CWS page; no installed PhotoSweep extension or provider tabs were present. This observation is outside the official 53 evidence entries. |
| Public disclosure compliance (external status) | **FAIL** | Outside the official 53 entries, the live listing is `2.3.0.2` and says albums are Google-only; source declares Chrome version `2.3.0.3` and album scope for all three providers. The live privacy page is Google-only, lacks the affirmative [Limited Use statement](https://developer.chrome.com/docs/webstore/program-policies/limited-use/), and omits licensing recovery and original-byte disclosures. |
| Production billing lifecycle and exact-candidate store submission | **UNVERIFIED** | No production billing lifecycle or current candidate submission/review evidence is established. |

### Supplemental clean-install results (outside the official release aggregate)

- `npm ci`: **PASS**, 899 packages; `npm --prefix Google-Photos-Toolkit ci`:
  **PASS**, 195 packages. `npm run typecheck`: **PASS**. `npm test`: **PASS**,
  102 files and 1,936 tests.
- The test entitlement flag temporarily changed the registered 296-file source
  fingerprint to `1d54ab1bdaaf21f9dd2d3f4fb68c0b0f9f9d39dfe26220b488492ee0011c8e03`.
  The production build flag `0` was restored immediately afterward, and the
  official candidate fingerprint returned to `43d2c2321e702126a80041282662ffb3e34d4ee8996fd53a0adc02f8927f47ab`.
  The clean-install unit result is not an exact-fingerprint candidate package
  or runtime result.
- Root and GPTK `npm audit --omit=dev --audit-level=high`: **PASS**, zero
  production vulnerabilities. `npm audit signatures`: **PASS** (root 899
  packages / 143 attestations; GPTK 195 / 32).
- `npx vitest bench --run --dir tests/perf --outputJson bench-output.json`:
  **PASS**. `node tools/check-bench.mjs`: **BLOCKED / SKIPPED** because no
  benchmark history was found; the baseline regression gate is not **PASS**.
  CI's main-branch cache may provide the baseline after push.

Supplemental command logs and their hashes are listed in [tracked evidence note](../verification/evidence/release-readiness-2026-10-05.md). These results do not change the official release result: **FAIL**.

The focused integration command
`pnpm test:integration -- --grep "applies Best quality independently across two completed duplicate sets"`
passed (1 test): it checks independent best keepers in two completed sets,
proposes other items for Trash, persists the selection, and issues no
provider-Trash command. The harness fingerprint was
`547c037ab1b3aeb4b26fc88fc84c2253320c9b1ebeccb5baf8a96dfa60774842`; this is
scoped local behavior evidence, not the official `43d2c232…` candidate package
or runtime. After packaging, the manifest was restored to `2.3.0.3` and the
registered fingerprint remained `43d2c232…`.

The all-six-strategies toolbar UI test also passed (1 test): it checks each
keeper and cleanup proposal, persists the resulting selection through reload,
and records no Trash/delete/remove provider command. It used the dev integration
harness fingerprint `547c037ab1b3aeb4b26fc88fc84c2253320c9b1ebeccb5baf8a96dfa60774842`,
so it is not evidence for the official candidate package/runtime. The local integration-log hash is listed in the [tracked evidence note](../verification/evidence/release-readiness-2026-10-05.md).

Approximate parity is accepted for the common main flow. Current source and
property evidence retain these differences: iCloud-only conditional delta
scan; provider metadata and Undo differences; Amazon original-byte/video limits
by region; shared albums unsupported across all providers; and paired Live
Photos unsupported across all providers.

The process environment had these names **absent**; no values are recorded:
`PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL`,
`PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION`,
`PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY`,
`PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT`, `STRIPE_SECRET_KEY`, and
`STRIPE_WEBHOOK_SECRET`. The package restore attempt
failed strict audit because the three production license variables were
missing and the dev entitlement flag was not `0`; after restoration, the
registered fingerprint returned to `43d2c232…` across 296 files. The local
[privacy publication draft](PRIVACY_POLICY_PUBLICATION_DRAFT_2026-10-05.md) is
prepared but unpublished. Overall release status: **NOT READY**.

## Historical prior-candidate evidence — not bound to current `main`

The sections below are preserved for traceability. They describe older source,
package, release-run, and loaded-browser candidates from September 2026; none
is evidence for pushed HEAD `a0880059318edbf4155fa67d75464b43aa150cc9`, and
none overrides the current status above.

### Historical snapshot last verified — 2026-09-20T08:06:37Z

This snapshot recorded release run `release-formal-20260919T0135Z`, the then
current-candidate live evidence under
`tmp/verification-live-current-candidate-20260920T080000Z/`, and separately
scoped payment/store evidence.

The ledger below originally described an uncommitted PhotoSweep candidate
loaded at that time. A local test, package, or browser stub does not close a
provider, device, payment, account, store, or production gate for the current
candidate.

### Implemented and locally verified (historical prior candidate)

| Slice                            | Local result   | Evidence                                                                                                                                                                                                                                     |
| -------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account/provider/scope preflight | PASS           | `lib/review-preflight.ts`; blocks unknown or changed Google account, provider, stale scan, unknown/changed scope, and unvalidated connection before Trash; the confirmation path rechecks the same conditions after its async save boundary. |
| Regional provider routing        | PASS           | `lib/provider-sites.ts`, `lib/provider-operations.ts`, `tests/lib/provider-operations.test.ts`, and `tests/manifest.test.ts` cover 22 explicit Amazon marketplaces on bare/www `/photos` hosts, iCloud bare/www `.com` and `.com.cn` hosts, and Google Photos account/locale paths on canonical `photos.google.com`; unsupported lookalike domains fail closed. |
| Recovery history                 | PASS           | `lib/recovery-history.ts` and `components/RecoveryHistoryDialog.tsx`; bounded 20-record local history, 180-day expiry, hashed account identity, and only provider-confirmed moved identifiers become restorable.                             |
| Cross-scan decision memory       | PASS           | `lib/decision-memory.ts`; manual decisions only, stable member-set identities, provider/account partitioning, 100-record bound, and 180-day expiry. Changed members fail closed.                                                             |
| Approved user-facing destinations | PASS           | In-app site/support destinations use `https://photosweep.pawsitivegames.chatgpt.site/` or `pawsitivegames@gmail.com`; the public Site now serves verified `/privacy` and `/refunds` policy routes. Stale CWS review, `photosweep.app`, and GitHub-only support targets are absent from the app bundle. |
| Amazon full-scan purchase path   | PASS           | A persisted Amazon test batch now has explicit `Clear test batch` and `Purchase full scan` actions; the purchase action opens the existing upgrade flow without changing provider mutation behavior. |
| Trash/Undo integration           | PASS           | 48/48 Chromium extension integration tests, including account drift, stale restore rejection, partial provider results, multi-batch Trash, Undo, cancellation, deferred full-scan upgrade, and reload persistence.                |
| Request-bound timeout/recovery  | PASS           | Bounded source-bound replay: 256 traces, 5,926 passes, 0 failures, 0 unsupported steps; request IDs, timeout ambiguity, late/stale replies, drift/crash cancellation, duplicate replies, and Undo are covered. |
| Unit/component/server coverage   | PASS           | 765/765 Vitest tests across 64 files. License API, Stripe webhook/idempotency, recovery, JSON/Firestore adapters, privacy-safe analytics, and the Smart metadata-only video path are included.                                                     |
| Type and package checks          | PASS (prior candidate) | `npm run typecheck`; the prior production package audit reports Manifest V3, app version 2.3.0, Chrome version 2.3.0.1, and the configured license host permission. The next package target is Chrome version 2.3.0.3 and must be audited after packaging. |
| Production artifact hygiene      | PASS           | Fresh CWS ZIP audit: 40 files; ZIP SHA-256 and manifest SHA-256 are recorded in the matching sidecar; development entitlement markers are absent.                                                                                           |
| Dependency install/security      | PASS with note | npm lockfile is synchronized and `npm ci --dry-run` passes; npm production audit reports zero vulnerabilities; pnpm production audit has no high-severity findings but still reports two moderate transitive advisories.                     |

#### Release-scope aggregate — PASS (2026-09-19; historical)

The current full release run completed 29 evidence entries across 13 commands
with `sourceDrift=false`; all 29 entries passed, including Google, iCloud, and
Amazon live-provider fixture evidence. Source fingerprint:
`f946eefa73f559eb36be90f0a1787ece1016ca2f95fdd4a06fd82feabab2f95f`.
Payment/license production lifecycle remains open. Public Chrome Web Store
listing existence is separately verified; exact candidate-artifact binding and
publisher-side maintenance remain open.
See the [release result](../tmp/verification/runs/release-formal-20260919T0135Z/aggregate-result.json),
[verification summary](../tmp/verification/runs/release-formal-20260919T0135Z/verification-summary.json),
[evidence ledger](../tmp/verification/runs/release-formal-20260919T0135Z/evidence.json),
and [provider fixture ledger](../verification/provider-fixtures.json).

The latest external read-only refresh is recorded in
[`CLOUD_TEST_PREPAYMENT.md`](../tmp/verification-live-payment-20260918T074901/CLOUD_TEST_PREPAYMENT.md)
and [`store-readonly-check-20260918T080804Z.md`](../tmp/verification-live-payment-20260918T074901/store-readonly-check-20260918T080804Z.md).

#### Provider round trips — PASS (2026-09-20 loaded candidate; historical)

On 2026-09-20, the current loaded PhotoSweep candidate was exercised in Aside
against the user's disposable `pawsitivegames@gmail.com` test account/session:

- Amazon Photos: Amazon.ca library, 6-item scan, one provider Trash move,
  provider Trash observation, PhotoSweep Undo, provider-empty verification, and
  fresh 6-item/2-set rescan. [`AMAZON_CURRENT_CANDIDATE_ROUNDTRIP.md`](../tmp/verification-live-current-candidate-20260920T080000Z/AMAZON_CURRENT_CANDIDATE_ROUNDTRIP.md)
- Google Photos: account selector switched to `pawsitivegames@gmail.com`,
  11-item/2-set scan, one provider Trash move, provider-backed Recovery history
  Restore, provider-empty verification, and fresh 11-item/2-set rescan. The
  notification-only Undo interaction remains a separate regression boundary.
  [`GOOGLE_CURRENT_CANDIDATE_ROUNDTRIP.md`](../tmp/verification-live-current-candidate-20260920T080000Z/GOOGLE_CURRENT_CANDIDATE_ROUNDTRIP.md)
- iCloud Photos: 9-photo library, 6-item/2-set scan, one Recently Deleted move,
  provider observation, Recovery history Restore, provider-empty verification,
  return to 9 photos, and fresh bounded 6-item/2-set rescan. The iCloud page did
  not expose account identity, so this is session-scoped evidence.
  [`ICLOUD_CURRENT_CANDIDATE_ROUNDTRIP.md`](../tmp/verification-live-current-candidate-20260920T080000Z/ICLOUD_CURRENT_CANDIDATE_ROUNDTRIP.md)

These are current-candidate, account/session-scoped passes. They do not prove
permanent deletion, every provider account or region, device coverage, payment
activation, or Chrome Web Store publication.

### Separately gated and not closed (historical prior-candidate evidence)

#### Google Photos live Trash/restore — PASS (historical scoped run)

Aside was used with the disposable `pawsitivegames@gmail.com` account and the
dedicated six-fixture album. The current PhotoSweep runtime completed an
album-scoped scan, manually selected exactly one confirmed similar-copy target,
moved it to Google Photos Trash, verified the exact provider Trash URL, invoked
PhotoSweep Undo, and completed a fresh six-item scan after restoration. No
permanent deletion was performed.

Evidence: [`LIVE_ROUNDTRIP_20260916.md`](../tmp/verification/20260916-live-google/LIVE_ROUNDTRIP_20260916.md),
the pre-action inventory
[`provider-inventory-before.json`](../tmp/verification/20260916-live-google/provider-inventory-before.json),
and the downloaded review/delete reports linked from the round-trip ledger.

This is a provider/account/album-specific PASS. It does not establish iCloud,
device, payment, store, or production behavior.

#### iCloud live Trash/restore — PASS (historical scoped runs)

The disposable six-item synthetic fixture was exercised in iCloud through
Aside. PhotoSweep completed the review, moved exactly one Pair A target to
Recently Deleted, restored it through PhotoSweep Undo, confirmed the provider
trash was empty, and completed a fresh six-item scan. Personal-library items
remain out of scope. No permanent deletion was performed.

- iCloud: `Sep 15, 2026 · 6 Items` before the action.
- Recently Deleted: exactly `1 Item`, synthetic `TEST ONLY // PAIR A`, `29 days`
  remaining.
- After PhotoSweep Undo: `No Photos or Videos` in Recently Deleted and
  `Sep 15, 2026 · 6 Items` in the album.
- Fresh PhotoSweep result: `Done, 6 items checked`, `2 duplicate sets`.
- Evidence: [`LIVE_ROUNDTRIP_20260917.md`](../tmp/verification/20260917-live-icloud/LIVE_ROUNDTRIP_20260917.md),
  [`live-roundtrip.json`](../tmp/verification/20260917-live-icloud/live-roundtrip.json),
  and [`provider-inventory-before.json`](../tmp/verification/20260917-live-icloud/provider-inventory-before.json).

The artifact records this one disposable account, album, build, and target.
It does not generalize to other iCloud accounts or production data.

The live harness now accepts the recorded round trip; it continues to require
the same exact-count and provider-state checks for future fixtures.

A fresh read-only Aside check loaded both `www.icloud.com/photos` and
`www.icloud.com.cn/photos`; both regional routes passed navigation coverage.
After the user signed in, the current iCloud Photos application loaded with
Library and Recently Deleted visible and 9 photos reported. PhotoSweep 2.2.9
also logged successful iCloud bridge, command-handler, and MAIN-world injection
startup. This closes the current read-only account/bridge smoke check; it does
not replace the disposable-fixture scan and Trash/restore evidence. See
[`provider-route-smoke-20260918T213342Z.md`](../tmp/verification/20260918T212131Z/provider-route-smoke-20260918T213342Z.md).

The same signed-in test account then passed a fresh bounded live round trip:
the `2026-06-28` through `2026-09-15` scan checked 3 items and found the
identified `gpd-live-duplicate-copy-1.jpg` / `gpd-live-duplicate-copy-2.jpg`
duplicate set; exactly one copy moved to Recently Deleted; iCloud showed
1 item with 29 days remaining; PhotoSweep Undo restored it; Recently Deleted
returned to `No Photos or Videos`; the library returned to 9 photos; and a
fresh post-recovery scan again checked 3 items and found 1 duplicate set.
Evidence: [`current-library-roundtrip.md`](../tmp/verification-live-icloud-20260918T214953Z/current-library-roundtrip.md).
This closes the signed-in test-account/provider round trip for that bounded
range. An unbounded paid full-library scan remains license-gated and is not
claimed by this scoped PASS.

#### Amazon live Trash/restore — PASS (historical scoped run)

The disposable six-item Amazon Photos batch completed one-item Trash,
provider-side observation of the synthetic Pair A target, PhotoSweep Undo,
provider-side Trash-empty verification, and a fresh six-item scan. Evidence:
[`LIVE_ROUNDTRIP_20260916.md`](../tmp/verification/20260916-live-amazon/LIVE_ROUNDTRIP_20260916.md),
[`live-roundtrip.json`](../tmp/verification/20260916-live-amazon/live-roundtrip.json),
and [`provider-inventory-before.json`](../tmp/verification/20260916-live-amazon/provider-inventory-before.json).

The round trip used the already-running `2.2.8` instance on the supported
library route. The source now also permits Undo while `/photos/trash` is open,
with a local regression test; that new route branch was not exercised live in
this round. A fresh read-only Aside smoke check requested `amazon.in/photos`
and `amazon.com/photos`; both redirected to the signed-in test account's
`amazon.ca/photos` library, which rendered the six-item fixture. This confirms
the observed account-region routing but is not independent India or US library
evidence. No permanent delete was performed. The route record is
[`amazon-regional-route-smoke-20260918T211902Z.md`](../tmp/verification/20260918T210708Z/amazon-regional-route-smoke-20260918T211902Z.md).

#### Device testing — NOT APPLICABLE TO THIS REPOSITORY

PhotoSweep in this checkout is a Chrome Manifest V3 extension with a side panel;
there is no Android/iOS project, APK, AAB, or mobile runtime to install. The
Chromium Playwright suite is browser integration evidence, not physical-device
evidence. Android Play Console metrics must be handled in the Android product
repository/release gate, not this checkout.

#### Payment/license lifecycle — PARTIALLY VERIFIED (historical test deployment; paid action remains externally gated)

The isolated test deployment `photosweep-license-api-test` uses Firestore and
test-only Secret Manager bindings; the production `photosweep-license-api`
service was not changed. Read-only route checks passed, and a separate
`cleanup_pass` Checkout was expired through Stripe test mode. Stripe exposed a
real `checkout.session.expired` event, and the isolated Firestore store recorded
that event as processed without creating a license or unlocking access. The
expired session returned the `free` entitlement. Unknown and known-email
recovery requests returned the same generic response, and analytics persistence
contained only allow-listed fields.

The paid success path remains open: the fresh `mini_cleanup` Checkout is still
`open`/`unpaid`, with no card data entered. The remaining lifecycle evidence
needed is successful test-card checkout, signed entitlement activation, delayed
payment, refund, dispute, and active-license recovery. The action-time test-card
submission is awaiting direct confirmation; no production service or live
Stripe resource was exercised.

Evidence: [`CLOUD_TEST_PREPAYMENT.md`](../tmp/verification-live-payment-20260918T074901/CLOUD_TEST_PREPAYMENT.md)
The latest production-shaped read-only route recheck returned `200`, `200`,
and unauthenticated `401` for `/checkout/success`, `/checkout/cancel`, and
`/entitlement`, respectively: [`api-readonly-recheck-20260918T220342Z.md`](../tmp/verification-live-payment-20260918T074901/api-readonly-recheck-20260918T220342Z.md).

#### Chrome Web Store checks (historical; publication remained unverified)

The prior locally verified candidate is distinct from the earlier saved Chrome
draft: app version `2.3.0`, Chrome Web Store version `2.3.0.1`. Its ZIP is
referenced in both the historical archive
[`photosweep-cws-v2.3.0.1-sha256-9e42d6ba5981.zip`](../tmp/verification/historical-package-archive/photosweep-cws-v2.3.0.1-sha256-9e42d6ba5981.zip)
and the local build output
[`photosweep-cws-v2.3.0.1-sha256-9e42d6ba5981.zip`](../build/photosweep-cws-v2.3.0.1-sha256-9e42d6ba5981.zip).
SHA-256 `9e42d6ba598195864806421ad741c82adee62fc416c7ace81960008406e2f861`,
and matching metadata sidecar
[`photosweep-cws-v2.3.0.1-sha256-9e42d6ba5981.json`](../tmp/verification/historical-package-archive/photosweep-cws-v2.3.0.1-sha256-9e42d6ba5981.json).
This is historical local package/check evidence only; it does not establish the
current merged build, publication, or current-provider behavior.
The ZIP manifest, sidecar hash, package audit, formal release run, typecheck, and 765-test suite
were freshly checked. This dirty-worktree artifact has not been uploaded; the
draft evidence below refers to the older `2.2.9` candidate and must not be
interpreted as proof that `2.3.0.1` is in Chrome.

The next reupload target configured on tip is app version `2.3.0` / Chrome
version `2.3.0.3`. A fresh ZIP, sidecar, and package audit must be generated
from the merged `main` tip; the historical `2.3.0.1` artifact above is not the
next upload.

Historical draft evidence:

The public listing is reachable at
`https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo`.
The public listing still serves version `2.2.8`, with 29 users and no ratings.
The reviewed local candidate version `2.2.9` is built and audited, and it is
now uploaded into the authenticated Chrome Web Store developer draft under
`pawsitivegames@gmail.com`; the Package page reports draft `2.2.9` and
published `2.2.8`. The candidate ZIP is
`tmp/verification/historical-package-archive/photosweep-cws-v2.2.9.zip` with SHA-256
`a466cef257dbb4a82f129e72e132dd7bfbb35183240690eb4a71ae0bb331cb46`.
The public listing therefore remains unchanged until the saved draft is
submitted for review and accepted. The production ZIP is also built and
audited, and all seven proposed 1280x800 screenshots are present. The fresh preflight is
recorded in
[`STORE_PREFLIGHT.md`](../tmp/verification/20260917-store-preflight/STORE_PREFLIGHT.md).
The linked privacy page loaded and contains the intended PhotoSweep disclosure.
The public PhotoSweep Site now also serves the verified refund policy at
`https://photosweep.pawsitivegames.chatgpt.site/refunds`; the live route check
is [`public-site-route-check-20260918T084500Z.md`](../tmp/verification-live-payment-20260918T074901/public-site-route-check-20260918T084500Z.md).
The authenticated Store Listing editor has both Homepage URL and Support URL
saved as `https://photosweep.pawsitivegames.chatgpt.site/`. The prior public
support URL was the legacy `pawsitivegames/Google-Photos-Deduper` issues page
with no open issues.

This is a scoped public-listing PASS, not proof of exact ZIP-to-listing byte
identity. A read-only CRX3 payload comparison found 19 SHA-256 mismatches among
27 common paths and 13 hashed asset paths present only on each side; the public
version is therefore not the current local production build. The publisher
session is available, the candidate upload is saved in the draft, and the
listing editor reports Save draft disabled. Submit for review has not been
performed; the fresh Status page explicitly reports `This draft is
unpublished`, so no new public version has been published.
See the [public listing preflight](../tmp/verification/20260917-store-preflight/PUBLIC_LISTING_PREFLIGHT.md).
The fresh pre-upload check is [`store-readonly-check-20260918T080804Z.md`](../tmp/verification-live-payment-20260918T074901/store-readonly-check-20260918T080804Z.md); the current authenticated draft state was observed directly in Aside on 2026-09-18.

A fresh read-only attempt to reopen the developer dashboard in Aside at
2026-09-18T21:31:58Z redirected to the public Web Store because that session
was signed into a different Google account. No upload, edit, submission, or
publication was attempted. See
[`cws-dashboard-readonly-20260918T213158Z.md`](../tmp/verification/20260918T212131Z/cws-dashboard-readonly-20260918T213158Z.md).

A second read-only attempt at 2026-09-18T22:04:43Z produced the same safe
result: the developer-dashboard URL redirected to the public Web Store and
the visible publisher session was not the authorized PhotoSweep publisher
account. No account login, upload, edit, submission, or publication was
attempted. See
[`cws-dashboard-readonly-20260918T220443Z.md`](../tmp/verification/20260918T215309Z/cws-dashboard-readonly-20260918T220443Z.md).

### Commands used for the historical status

```bash
npm run typecheck
npm test -- --run
npm run test:integration
npx vitest run tests/server tests/lib/license-client.test.ts \
  tests/lib/entitlement.test.ts tests/lib/license-session.test.ts
env -u PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT pnpm run package
PHOTOSWEEP_AUDIT_STRICT_DEV_KEY_ABSENCE=1 npm run audit:extension-package
npm ci --dry-run --ignore-scripts --no-audit --no-fund
npm audit --omit=dev --audit-level=high
pnpm audit --prod --audit-level high
npm run test:e2e -- --list
```

All source and documentation changes remain uncommitted for review.

Note: the full release runner was also executed after a clean `npm ci`. Its
first integration attempt failed before test execution because the host lacked
the Playwright Chromium executable; a subsequent browser download was
incomplete and was stopped. This is an environment failure, not a failing test
assertion. The direct 43/43 run above completed before that clean-install
environment change.
