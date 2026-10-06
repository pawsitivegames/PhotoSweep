# Release readiness evidence — 2026-10-05

This note supports the current status blocks in the parity and remaining-gates documents. Raw run logs remain preserved locally under `tmp/verification/` and are intentionally not committed. The paths below identify local hash inputs; hashes were computed from those files on 2026-10-05.

## Official registered-source run

- Run: `20261005T-root-release-547c`; source commit `b90bd56d893d2ccf701abc69a496b98f13842258`.
- Registered source fingerprint: `43d2c2321e702126a80041282662ffb3e34d4ee8996fd53a0adc02f8927f47ab` (296 files); before and after matched, with no source drift.
- Aggregate: **FAIL**, 53 evidence entries / 17 commands: 48 **PASS**, 1 **FAIL**, 4 **BLOCKED**.
- Registered-source property, model, boundary, corpus, performance, browser, and mock gates: **PASS**. `MUTATION-01`: **PASS**; triage policy **VALID**, 196 reviewed/resolved, 94.84% closure, zero critical survivors. Raw mutation report SHA-256: `00d9504c4ce9507706c28688f80b3d33ef652145778e8036b177b8dba57ccb00`.
- `SAFE-09-package`: **FAIL**. Strict package audit requires `PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL`, `PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION`, and `PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY`; it also requires `PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=0`. Those production values were absent/unset; audit also reported expected backend host permission as `undefined`. No valid release candidate package/audit resulted.
- Live Google/iCloud/Amazon disposable round trips: **BLOCKED** because there is no current candidate ZIP hash, runtime identity, or fixture inventory binding the sessions. Exact-candidate video playback across providers: **BLOCKED** for lack of exact-package playback evidence.
- Separate current Chrome observation showed the CWS page only, with no installed PhotoSweep extension or provider tabs. This does not establish universal provider-session unavailability.

## Supplemental local results

- Clean installs: root `npm ci` **PASS** (899 packages); GPTK `npm --prefix Google-Photos-Toolkit ci` **PASS** (195 packages). `npm run typecheck` **PASS**. `npm test` **PASS** (102 files, 1,936 tests).
- The test entitlement flag temporarily changed the registered 296-file fingerprint to `1d54ab1bdaaf21f9dd2d3f4fb68c0b0f9f9d39dfe26220b488492ee0011c8e03`. The production build flag was restored to `0`; the registered candidate fingerprint returned to `43d2c2321e702126a80041282662ffb3e34d4ee8996fd53a0adc02f8927f47ab` (296 files). The full-test result is not an exact-candidate package/runtime result.
- Root and GPTK `npm audit --omit=dev --audit-level=high`: **PASS**, zero production vulnerabilities. `npm audit signatures`: **PASS** (root 899 packages / 143 attestations; GPTK 195 / 32).
- Scoped `npx vitest bench --run --dir tests/perf --outputJson bench-output.json`: **PASS**. `node tools/check-bench.mjs`: **BLOCKED / SKIPPED**, because no benchmark history was found; baseline regression is not a **PASS**.
- Best Quality focused UI integration: **PASS** (1 test), independently selects the best keeper in each of two completed duplicate sets, proposes other items for Trash, persists selection, and issues no provider-Trash command. The all-six-strategies toolbar UI integration: **PASS** (1 test), checks keeper/cleanup proposals for all strategies, persists selection through reload, and issues no Trash/delete/remove provider command. Both ran in the dev integration harness at fingerprint `547c037ab1b3aeb4b26fc88fc84c2253320c9b1ebeccb5baf8a96dfa60774842`; neither proves behavior of the official `43d2c232…` package/runtime.
- Fresh `pnpm package:cws` restoration attempt: **FAIL** strict package audit for the missing/unset variables above and the unset dev-entitlement flag (which must be `0`). The manifest was restored to version `2.3.0.3` and the registered fingerprint returned to `43d2c232…` / 296 files.
- These local results do not change the official aggregate **FAIL** or release verdict **NOT READY**. The current Chrome Web Store listing is `2.3.0.2`; the live privacy page is Google-only and lacks the affirmative Chrome Web Store Limited Use statement and licensing-recovery/original-byte disclosures. A local privacy publication draft is prepared but unpublished. Approximate common-flow parity remains source/property proof only; exceptions include iCloud-only conditional delta scan, provider metadata and Undo differences, region-dependent Amazon original-byte/video limits, unsupported shared albums, and unsupported paired Live Photos.

## SHA-256 of key local evidence files

| Local file under `tmp/verification/runs/20261005T-root-release-547c/` | SHA-256 |
| --- | --- |
| `verification-summary.json` | `3f20a24069a14b456f38b539f20ff52056cbe3d0675d267c2b301a3861f0c161` |
| `aggregate-result.json` | `173b5d230bf94319b322c2eab6042f10c355d82a3a4dac83b2677dd638d865a7` |
| `evidence.json` | `adbc330285a2a2b57c3728507d7aa8307415bf2cf89b0ca094171c110fbba5ba` |
| `mutation.json` | `c64795e7410757ce7ab1cf02e0fd4f7d7e25fcf755d8b0b35167dcb67e298a8e` |
| `mutation-run/mutation-triage.json` | `8ae9feb9373c22c410484d9aa98dbc0b8d365d35201aa5eff0c64df4406245fd` |
| `restore-production-package-state.log` | `c2e7f3fbc2e9d75c29f7f1cb786e3ac4811c71029e9de9890bcab175133db76b` |
| `command-package-audit.log` | `06a65fdbd0ef8af3f39ad731d9671e3621f34818a67d3d6315c9076c2074c00b` |
| `npm-ci-root.log` | `9059b58056fb870f0f43e0b2431a866971eb952ca3ac49f2595b9638e93e18c2` |
| `npm-ci-gptk.log` | `b6f74e8f6cd7af0620301033ef9fa2dd977c2b48b92be048a91414687878a6db` |
| `npm-typecheck-clean-install.log` | `f5740c05a80df8c90157d537bc4ea0ca289f06bc62b51f235f56be4d9d3c79fd` |
| `npm-test-clean-install.log` | `a9f301ce89d625e4fd2f29cd2794488f6d3c092f94f9d916063cb5543ec70aea` |
| `root-prod-post-ci.log` | `6d8c5c8f3d7684adb070417bd608d01ae90aa3dc26a65af03ffda4955f38d9a3` |
| `gptk-prod-post-ci.log` | `6d8c5c8f3d7684adb070417bd608d01ae90aa3dc26a65af03ffda4955f38d9a3` |
| `root-signatures-post-ci.log` | `c0d7634f9b6017020d43a52600b1daea519a9b328ff1f10fe6cf4850b6e2c30e` |
| `gptk-signatures-post-ci.log` | `91deee07076e94839f8617e32d183a7eb1da3dfa4538f6845d52051fb30f21c3` |
| `bench-clean-scope.log` | `ef425658b2e19e0669982c371a572bcbb1724ec07b8c6e7367a8adfbd1161b8c` |
| `bench-clean-compare.log` | `8d9997c804bc400e42f87a1090a735e492958a9cd5354a67043ace94de6dcdc1` |
| `all-six-strategies-integration.log` | `b999c05de44e58760d21064a5feb056d55be53d8b01bbeb6d4c40cc01bbe44e3` |

The focused Best Quality command output was not persisted as a separate log in this run directory; its one-test PASS is recorded above with its harness fingerprint boundary.
