# PhotoSweep Remediation Plan

Living document. Phases are ordered by risk and dependency; each phase is
independently shippable and must leave the proven Google path untouched.

## Guarding principle — "functionality is not affected"

Three rules applied to every item:

1. **Google path is frozen** unless an item is a pure, isolated bug fix. No
   refactors of the proven trash / restore / list flows.
2. **Test-first.** Add a failing test that pins current behavior, then the
   change, then assert the test flips green. Run
   `npm run typecheck && npm test` after every phase.
3. **Fallback, don't replace.** Real iCloud trash keeps the dry-run path as an
   explicit `args.dryRun` and as an automatic fallback if the live API call
   fails or the endpoint cannot be discovered. Same for Amazon restore. No
   silent no-ops.

---

## Phase 0 — Safety net (complete)

Add guardrail tests so regressions are caught the moment a later phase changes
behavior:

- `tests/lib/entitlement.test.ts` asserts provider parity for Google, iCloud,
  and Amazon across free and paid plans.
- `tests/commands/*-photos-commands.test.ts` asserts provider restore support for
  Google, iCloud, and Amazon command handlers.
- `tests/commands/icloud-photos-commands.test.ts` asserts real CloudKit
  `records/modify` trash and restore payloads, plus dry-run behavior.
- Baseline to keep current before live validation:
  `npm run typecheck && npm test && npm run test:integration`.

## Phase 1 — iCloud real trash + restore (code complete, live gate pending)

The only true "doesn't function" item; highest risk.

1. **Implemented real `trashItems`.** iCloud trash now uses the sniffed CloudKit
   `records/modify` URL, requires fresh CPLAsset refs, keeps explicit dry-run,
   fails closed on missing metadata, and returns post-trash refs for restore.
2. **Implemented `restoreItems`.** iCloud restore uses the post-trash asset refs
   and `isDeleted: 0`.
3. **Removed the hard dry-run lock.** `tabs/app.tsx` now sends real iCloud trash
   requests with captured asset refs.
4. **Undo is provider-aware.** Undo now sends the original provider and includes
   iCloud post-trash asset refs when available.
5. **Service-worker foregrounding includes restore.** iCloud restore now receives
   the same foregrounding treatment as list/trash.
6. **Remaining gate:** run a gated live test on a 2-item iCloud album
   scan → trash → restore, then record evidence in `VALIDATION.md`.

Risk: High. Mitigated by discovery-first + fallback + tiny-album live
validation + Undo.

## Phase 2 — Amazon restore complete; personal albums locally implemented

Amazon scan/trash already work; completes parity.

1. **Amazon restore is implemented.** `restoreItems` uses the same
   `/drive/v1/trash` route as trash with `op: "remove"` and keeps the chunking /
   retry behavior covered by command tests.
2. **Amazon personal-album scope is implemented locally.** The adapter uses
   Amazon Photos page-context node routes, validates album/member pagination,
   and excludes shared albums or foreign-owned members. This remains a private,
   change-prone web interface, not a supported public API. The current package
   has not been loaded into Chrome for live PhotoSweep verification. iCloud
   personal-album scope is also implemented locally through private CloudKit
   routes, but needs disposable-account validation against the current build.

Remaining gate: gated live Amazon scan → trash → restore evidence before paid
claims or provider parity claims.

## Phase 3 — Monetization: provider parity

Implemented after Google, Amazon, and iCloud live Trash/Restore validation.

- `free` / `mini_cleanup` / `cleanup_pass` / `lifetime` all use the same
  provider set: `["google", "icloud", "amazon"]`.
- Plan differences are only limits: scan size, visible groups, Trash moves,
  full reports, full scan, and resume.
- Updated beta copy: `components/UpgradeDialog.tsx:48`,
  `components/ScanConfig.tsx:66`, `docs/REFUND_POLICY.md:30`,
  `docs/MARKETING.md:227`. `tests/docs-policy.test.ts` guards drift.
- Updated the entitlement matrix test intentionally in the same change.

Additive only — `canUsePaidProvider` (`entitlement.ts:132`) now returns true
for Google, iCloud, and Amazon under every plan; the existing feature limits
still enforce free vs paid behavior.

## Phase 4 — Correctness / data-integrity (mostly complete)

- **Done — `DEFAULT_SETTINGS.scanMode`:** set to `"smart"`. Free
  users are silently downgraded anyway (`app.tsx:2017`); making the default
  honest removes the surprise.
- **Done — `GP_TAB_CLOSED` provider-aware:** use the
  action's `provider` to pick the label instead of hardcoding Google.
- **Done — Offline grace period:** add a small window in `isEntitlementActive`
  (`entitlement.ts:102`) — if `expiresAt` is past but within 72h and
  `source === "signed_token"`, treat as active. Documented at
  `docs/MONETIZATION_RESEARCH.md` but not implemented. Add test.
- **README line 32** ("No data leaves your browser"): tighten to match
  `docs/PRIVACY_POLICY.md:7` before CWS submission.

## Phase 5 — UX / accessibility

- **Keyboard-accessible group header** (`components/DuplicateGroups.tsx:357`):
  the clickable `<div>` needs `role="button"`, `tabIndex={0}`, `onKeyDown`
  (Enter / Space). Highest a11y priority; helps CWS review. Add a
  `@testing-library/react` keyboard test.
- **Confetti timing** (`app.tsx:3250`): move from "trash completed" to a less
  jarring moment (dismiss undo / finish session).
- **`prefers-reduced-motion`** guard on modal slide
  (`components/PhotoViewerModal.tsx:220`) and confetti.
- **Date range single-side** (`components/ScanConfig.tsx:48`): decide whether a
  lone `from` is intended (open-ended); document or hint.

## Phase 6 — Photo viewer (trust-building)

- **Zoom / pan** (`components/PhotoViewerModal.tsx`): the `OpenInFullIcon`
  promises magnification that does not exist.
- **Side-by-side compare** within a duplicate set.
- **Richer metadata in viewer footer** (`:496`): add file size, similarity
  score, and match reasons (already computed in `lib/duplicate-classifier.ts`).

## Phase 7 — Performance

- **Detection math** (`workers/embedder-kernels.ts`): `topK` still sorts each
  similarity row. A bounded heap / partial selection may improve it, but first
  benchmark the production worker path with `npm run test:bench`.
- **Side-panel virtualization** (`components/DuplicateGroups.tsx:851`): reuse
  the non-compact `react-window` `VariableSizeList`.

## Phase 8 — Code health (pure cleanup)

- Consolidate the two parallel iCloud DOM scrapers
  (`scripts/icloud-photos-commands.js:465` + `background/index.ts:623`).
- **Done — active full-scan detection test seam:** `fullDetectDuplicates`
  dispatches `detectBlock`; its shared pair-comparison kernel and the main-thread
  union-find route are covered with a transitive chain across a block boundary.
- **Retained — legacy worker `detect` handler:** its greedy neighborhood helper
  remains separately tested, but is not the route used by `fullDetectDuplicates`.
- **Done — single source for `matMul` / `topK`:** the production worker and
  focused tests import the same kernels, with equal scores ordered by input
  index.

---

## Sequencing

| Order | Phase | Why first |
|---|---|---|
| 1 | Phase 0 | guardrails before any change |
| 2 | Phase 1 | only true broken item; unblocks iCloud launch |
| 3 | Phase 2 + 3 | provider parity + enables monetization |
| 4 | Phase 4 + 5 | low-risk polish; a11y helps store review |
| 5 | Phase 6 | trust / retention, post-launch |
| 6 | Phase 7, 8 | scale + cleanup, as needed |

**Live-validation gate (non-negotiable for Phase 1 & 2):** no destructive
change ships until a 2-item test album passes scan → trash → **restore** on the
real provider, recorded in `VALIDATION.md` like the Google entries.
