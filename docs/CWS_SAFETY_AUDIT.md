# Chrome Web Store safety audit

Date: 2026-09-19  
Candidate: PhotoSweep app 2.3.0 / Chrome Web Store 2.3.0.1  
Status: **BLOCKED for release submission pending external and runtime gates**

This audit records repository and local artifact evidence. A local pass does not
prove Chrome Web Store approval, account eligibility, provider behavior, device
coverage, payment settlement, or production publication.

## Local evidence

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript | PASS | `npm run typecheck` |
| Full unit/integration suite | PASS | 64 files, 764 tests in the fresh rerun |
| Focused regression suite | PASS | 34 tests covering keep-strategy and trash-lifecycle; `npm test -- tests/lib/keep-strategy.test.ts tests/lib/trash-lifecycle.test.ts` |
| Fast formal verification | PASS | Latest `npm run verify:all -- --scope fast`; archive `tmp/verification/20260918T193619Z`; source drift false |
| Mutation-only formal check | PASS | Source-bound policy review in `tmp/verification/runs/release-formal-20260918T2220Z/mutation.json`; 1,400 total, 1,339 killed (95.64%), 61 reviewed equivalent/unreachable survivors resolved, 0 unresolved/unreviewed/no-coverage/timeout/error results, source drift false |
| Release formal verification | PASS locally | `tmp/verification/runs/release-formal-20260918T2220Z/aggregate-result.json`; all 29 evidence entries passed across 13 commands, source drift false; mocked browser boundaries used Playwright's bundled Chromium (not Brave), while live provider evidence remains explicitly Aside-scoped |
| Production build | PASS | `npm run package:cws`; MV3 app version 2.3.0, Chrome candidate version 2.3.0.1 |
| Package audit | PASS | `PHOTOSWEEP_AUDIT_STRICT_DEV_KEY_ABSENCE=1 npm run audit:extension-package`; 79 explicit host permissions |
| Candidate ZIP | PASS locally | `build/photosweep-cws-v2.3.0.1-sha256-d11ba6e99b11.zip`; SHA-256 `d11ba6e99b113ee8cf7ec9bf0e484d33ff1610d764228af3ac51aec920ff61fb`; 40 files; sidecar `build/photosweep-cws-v2.3.0.1-sha256-d11ba6e99b11.json` |
| Codex Security scan | UNVERIFIED | Standard scan is still running against the pre-change HEAD snapshot; its result must not be treated as a current-candidate pass |

## Policy controls checked

The relevant official policies are [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies), the [User Data FAQ](https://developer.chrome.com/docs/webstore/user_data), [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use), [Use of Permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions), [MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements), [Disclosure Requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements), [Payment](https://developer.chrome.com/docs/webstore/program-policies/accepting-payment), [CWS privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [Code Readability](https://developer.chrome.com/docs/webstore/program-policies/code-readability), and [2-Step Verification](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification).

| Area | Current evidence | Verdict |
| --- | --- | --- |
| Single purpose and least privilege | Removed `activeTab`; removed four unused broad host permissions; the audit rejects their reintroduction. | PASS locally; CWS draft must be refreshed and rechecked |
| Amazon page scope | Content scripts, web-accessible resource matches, and runtime routing require `/photos*` across the explicit 22-locale bare/`www` matrix; an ordinary-shopping-page and regional 404 fail-closed regression test passes. | PASS locally |
| Regional provider scope | Amazon uses the 22 official marketplace hosts, iCloud uses bare/`www` `.com` and `.com.cn`, and Google uses the canonical `photos.google.com` host with account/locale paths. The package audit rejects missing or broad provider matches. | PASS locally; provider availability remains region-specific |
| Main-world command boundary | Provider commands require an extension-generated ECDSA P-256 capability bound to the exact canonical payload, with TTL and nonce replay protection; malformed, altered, unsigned, and foreign-origin messages fail closed in the provider-origin browser-security test. | PASS locally; live provider behavior and CWS review remain external |
| MV3 and remote executable code | Manifest is MV3; extension CSP is self/WASM-only; the package audit rejects literal remote script/imports, `eval`, and `new Function`; model/worker URLs are extension-local. | PASS locally; reviewer interpretation remains external |
| Data disclosure and consent | Added a blocking first-use notice before opening a provider or scanning; added persistent optional-metrics controls; expanded the local Limited Use statement. | PASS in source/build; live privacy page and final installed behavior UNVERIFIED |
| Limited Use and human access | Local policy explicitly states the permitted purpose, prohibits advertising/data brokerage/credit use, and states that raw photo-library data is not available to people except documented legal/security/support exceptions. | PASS in source; CWS privacy answers UNVERIFIED after rebuild |
| Checkout safety | Checkout responses now require HTTPS and the exact `checkout.stripe.com` host. | PASS in source/tests; live checkout, entitlement, refund, and dispute flow UNVERIFIED |
| Privacy/security transport | Release configuration uses the HTTPS license API host and the package has no localhost API URL. | PASS locally; server headers, retention/deletion, and operational controls UNVERIFIED |
| Code readability | No new obfuscation mechanism was added; bundled/minified production output is expected under Google’s policy. | PASS locally; CWS review remains external |
| Listing accuracy | Current package metadata and local policy were checked. | CWS draft metadata/privacy fields must be refreshed against this exact ZIP |
| Account gate | Developer 2-Step Verification, ownership/contact, and reviewer access were not independently verified in this run. | UNVERIFIED |
| Submission gate | Draft is saved but the rebuilt ZIP has not been uploaded and no review submission was made. | BLOCKED until explicitly approved at action time |

## Required before release

1. Upload this exact ZIP to the `pawsitivegames@gmail.com` draft and re-check the generated manifest, permission justifications, data-use answers, privacy URL, payment disclosures, and listing text.
2. Verify the live privacy/support/refund pages match the packaged disclosure wording and are reachable over HTTPS.
3. Run a disposable provider/device test for Google Photos, iCloud Photos, and Amazon Photos covering connect, scoped scan, review, confirmed Trash, provider-side Trash observation, Undo/restore, and a fresh rescan. Do not use a personal library for destructive evidence.
4. Retain the current provider-origin capability, canonical-payload, TTL, and nonce protections; repeat the browser-boundary check after any candidate rebuild and treat CWS reviewer interpretation as external.
5. Verify the real paid path: checkout, return/session handoff, signed entitlement, extension restart, refresh/recovery, refund/dispute handling, and license revocation.
6. Verify the developer account’s 2-Step Verification and reviewer/test-account instructions.
7. Re-run the package audit, full tests, fast/release formal verification, and current-candidate security scan after the exact ZIP is frozen; live provider journeys must run through Aside, while mocked browser-boundary checks use the isolated non-Brave Chromium harness.
8. Submit only after an explicit action-time confirmation; Google approval and publication remain separate from local PASS results.

`Opt in to verified CRX uploads` is an optional upload-integrity feature in the
dashboard. It is not a substitute for the policy, privacy, permission, runtime,
or reviewer gates above.
