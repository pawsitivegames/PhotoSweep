# Feature verification ledger

## Feature: automatic provider connection retry after Open

Status: blocked  
Risk: high  
Last reviewed: 2026-09-18T20:18:14Z

### Contract

- User outcome: after opening Google Photos, Amazon Photos, or iCloud Photos,
  PhotoSweep establishes the bridge connection without requiring an immediate
  manual Retry click when the provider page is still loading.
- Acceptance criteria: issue one health check, automatically retry twice with
  bounded backoff (400 ms, then 800 ms), keep the connection step loading while
  retries are pending, hide manual Retry while those attempts are pending, and
  show manual Retry only after all three attempts fail.
- Failure behavior: no destructive provider command is retried by this policy;
  a final health-check failure remains recoverable through Open and Retry.
- Non-goals: automatic sign-in, overcoming a closed tab, bypassing provider
  consent, or proving live provider availability from local fixtures.
- Data/privacy/security rules: health checks carry only the provider and client
  routing context plus an ephemeral request ID; late responses from an older
  provider/tab request are ignored. Timers are canceled on reset, provider
  switch, success, and unmount.
- Supported providers: Google Photos, Amazon Photos, and iCloud Photos.

### Verification plan

- Unit: retry budget, delays, invalid attempt handling, and provider coverage.
- Integration: app state, service-worker routing, transient readiness, delayed
  responses, provider-tab navigation, and provider command suites.
- Formal: fast verification runner with source-drift check.
- Runtime/provider: Aside-controlled connection journeys for each provider,
  without Trash or restore actions.

### Evidence

- `PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=0 npm run typecheck` — PASS
- `npm test -- tests/lib/health-check-retry.test.ts tests/lib/app-reducer.test.ts tests/background/service-worker.test.ts tests/commands/google-photos-commands.test.ts tests/commands/amazon-photos-commands.test.ts tests/commands/icloud-photos-commands.test.ts` — PASS — 6 files, 110 tests
- `npm test -- tests/commands/amazon-photos-commands.test.ts tests/commands/icloud-photos-commands.test.ts tests/lib/provider-operations.test.ts tests/manifest.test.ts` — PASS — 4 files, 40 tests; regional host and manifest matrix
- `npm test -- tests/commands/amazon-photos-commands.test.ts tests/commands/icloud-photos-commands.test.ts tests/background/service-worker.test.ts` — PASS — 3 files, 50 tests
- `npm run test:integration -- tests/e2e/integration/cross-tab-messaging.test.ts` — PASS — 9/9 cross-tab health-check, automatic retry, tab-navigation, command-routing, and progress-streaming tests passed in 14.6 seconds
- Release browser boundary checks — PASS — 3/3 dispatch-authorization and security-boundary tests passed in Playwright's bundled Chromium; this is isolated mocked-provider evidence, not live provider proof
- `npm test` — PASS — 62 files, 737 tests
- `PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=0 npm run verify:all -- --scope fast` — PASS — source drift false; archive `tmp/verification/20260918T193619Z`
- `PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=0 npm run build` — PASS — exact production MV3 build
- `PHOTOSWEEP_AUDIT_STRICT_DEV_KEY_ABSENCE=1 npm run audit:extension-package` — PASS — MV3, version 2.2.9, 79 host permissions; all 22 Amazon locales are explicit on bare/`www` hosts, thumbnail hosts are present, and Amazon web-accessible-resource patterns are origin-scoped
- Built manifest regional shape — PASS — 44 Amazon content matches, 4 iCloud content matches, 44 Amazon web-accessible matches, and no `<all_urls>` provider content script
- `git diff --check` — PASS
- Aside load — PASS — exact production candidate from `build/chrome-mv3-prod`, PhotoSweep 2.2.9, extension ID `dnbgiaipnphkiiadpbpgimpogfkhfnck`; stale 2.2.8 was disabled in the Aside test profile for isolation
- Aside / Amazon Photos / normal network — PASS — `https://www.amazon.ca/photos`, Pawsitive Games test account, 6 disposable items; panel reported `Connected`, `Source: Done`, `Sign in: Done`, and no Retry control
- Aside / Google Photos / normal network — PASS — `https://photos.google.com/u/2/albums`, Google account `pawsitivegames@gmail.com`; panel reported `Connected`, `Sign in: Done`, and unlocked scope without a manual Retry
- Aside / Google Photos / slow network — PASS — CDP emulation at 1,200 ms latency, 12.8 KB/s down, 6.4 KB/s up; opening PhotoSweep while the provider page was still settling reached `Connected` without a manual Retry
- Aside / Amazon Photos / slow network — PASS — same controlled network profile; the panel shell appeared while Amazon was loading and then reached `Connected` without a manual Retry
- Aside / provider navigation away — PASS — navigating the live Google Photos tab to `https://example.com/` closed the provider panel; reopening PhotoSweep on the unsupported page did not expose scan controls or a connected state
- Aside / iCloud Photos — BLOCKED — `https://www.icloud.com/photos` had no existing session in Aside; Apple requested the password/passkey after the authorized email was entered, so no provider connection was exercised
- Aside / Google Photos localized account path — PASS — `https://photos.google.com/u/2/albums?hl=fr` loaded the signed-in `pawsitivegames@gmail.com` library on the canonical Photos host
- Aside / iCloud bare and China hosts — PASS (landing only) — `https://icloud.com/photos` resolved to the supported `www.icloud.com` landing page, and `https://www.icloud.com.cn/photos` rendered the iCloud Photos landing page; no Apple password/passkey was entered
- Aside / Amazon India routing — PASS (routing only) — `https://www.amazon.in/photos` redirected this account/session to `https://www.amazon.ca/photos`; no independent India-library connection was claimed
- Aside / Amazon Belgium route — PASS (fail-closed behavior) — `https://www.amazon.com.be/photos` returned Amazon’s Page Not Found response; the command health contract now reports this as disconnected rather than falsely connected

### Remaining risks and next action

- iCloud still needs a pre-authenticated Apple test session in Aside (or a
  user-driven passkey/password completion); no iCloud data was changed.
- The release aggregate is PASS, but its live-provider entries are source-bound
  pre-recorded Aside evidence; they do not replace a fresh connection journey
  for every regional host.
- iCloud still needs a pre-authenticated Apple test session in Aside (or a
  user-driven passkey/password completion) for a fresh connection exercise.
