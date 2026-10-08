# PhotoSweep UX Contract

## Product context

- **Audience:** People cleaning up duplicate and similar items in a supported
  cloud photo library.
- **Primary jobs:** Choose one or more keepers per set, include sets for
  cleanup, review the resulting proposal, and confirm provider Trash
  actions deliberately.
- **Active provider surfaces:** Google Photos, iCloud Photos, and Amazon
  Photos, with provider-specific limitations explained in the UI and listing.
- **Active locale:** English extension UI.
- **Accessibility:** Use named controls, keyboard access, persistent visible
  focus, and text labels for consequential state. This contract does not claim
  formal WCAG conformance.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Provider behavior and capability caveats | `docs/FEATURE_GAP_RESEARCH.md` and provider operation modules | Product evidence / implementation | 2026-10-08 |
| Review and cleanup state | `lib/duplicate-review-session.ts` | Domain model | 2026-10-08 |
| Trash execution and recovery | `lib/trash-lifecycle.ts` and `docs/VALIDATION.md` | Lifecycle / validation contract | 2026-10-08 |
| Public listing claims and release identity | `store-assets/CHROME_WEB_STORE_REFRESH.md` and `store-assets/CWS_PACKAGE.md` | Listing / release contract | 2026-10-08 |

## Visual contract

- **Project design system:** `DESIGN.md`.
- **Token ownership:** Existing runtime source is canonical; `DESIGN.md`
  mirrors its values.
- **Runtime token source:** `lib/photo-sweep-colors.ts`.
- **Theme adapter:** `lib/theme.ts` maps the colors into Material UI and owns
  the shared typography and focus styles.
- **Supported theme:** Light theme.
- **Design-context owner:** Runtime source and shared components own behavior;
  update this contract when those decisions change.

## Canonical UI map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Photo keeper choice | `components/DuplicateGroups.tsx` | `toggle_kept` in `lib/duplicate-review-session.ts` | Photo cards in side panel and full page | Keeper/session component and integration flows |
| Cleanup set selection | Set header in `components/DuplicateGroups.tsx` | `selectedGroupIds` and `select_groups` / `deselect_groups` | Per-set / all sets available to review / all sets shown by current filter | Selection component and integration flows |
| Bulk cleanup selection | `components/ActionBar.tsx` | `handleIncludeAllEligible` / `handleSelectAll` / `handleDeselectAll` in `tabs/app.tsx` | All sets available to review or current visible filter, as labeled | ActionBar component and app integration flows |
| Choose keepers automatically | `components/ActionBar.tsx` | `handleKeepStrategySelection` in `lib/keep-strategy-feedback.ts` | All scan groups, including groups hidden by the current result filter | Keep-strategy application flow |
| Trash proposal | `lib/duplicate-review-session.ts` | `trashPlan()` | Included, eligible, unkept items only | Safety properties and Trash lifecycle flows |
| Trash confirmation | `tabs/app.tsx` and the existing confirmation dialog | Current review gate, audit export, typed-count confirmation, and provider result | Provider-specific confirmation | Trash integration flows and live provider checklist |

## Selection and review contract

Photo keeper choices and cleanup inclusion are independent decisions.

- Selecting a photo changes which copy or copies are kept. It does not add the
  set to cleanup. A user choice marks that set reviewed but leaves its current
  inclusion state unchanged.
- A set header checkbox selects the set for cleanup. Its eligible unkept
  copies may then appear in the Trash proposal. Selection does not move
  anything.
- “Skip cleanup for this set” keeps that set out of the Trash proposal and marks it
  reviewed. Use its checkbox to select it later.
- “Choose keepers automatically” applies the chosen rule to all scan groups and
  saves the default. It can replace manual keeper choices. It does not change
  which sets are selected for cleanup.
  When a keeper change changes targets in a set already selected for cleanup, that set
  returns to “Needs review.”
- “Include all N shown sets in cleanup” and “Remove shown sets from cleanup”
  act only on the current result filter. When all shown sets are already
  included, the include button changes to a disabled “All N shown sets
  included” state. Hidden sets retain their state.
- “Include all available sets” adds every set available to review to the cleanup
  selection, including sets hidden by the current filter. Newly included sets
  return to “Needs review”; already included sets keep their review state.
  Plan-locked sets remain outside the available scope.
- “Mark all copies for Trash” is the explicit per-set exception that clears
  all keeper choices and includes that set in cleanup. Existing favorite, identity,
  eligibility, and provider guards still apply.
- Every eligible cleanup-scope set must be reviewed before the confirmation
  step. The audit report, typed item-count confirmation, provider-specific
  safety checks, and supported Undo path remain required.
- Existing saved cleanup selections are preserved during upgrade. Automatic
  keeper choices do not select new sets; previously saved selection is not
  inferred to be automatic or silently removed.

## Flow ledger

| Operation | Trigger | Pending | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|
| Start a scan | Main scan button | Scan progress and cancel/resume state | Coverage and result count | Keep scope/settings available and report provider failure | Existing scan screen | `components/ScanConfig.tsx`, `tabs/app.tsx` |
| Choose a keeper | Select a photo card | Immediate local review update | Keep/suggested/proposed state updates on the set | Last keeper cannot be removed; explain all-copies exception | Stay on the same set | `components/DuplicateGroups.tsx`, `lib/duplicate-review-session.ts` |
| Include a set | Set checkbox or “Include all shown sets in cleanup” | Immediate local selection update | Included set and Trash proposal counts update | Remove shown sets from cleanup or use “Skip cleanup for this set” | Stay on the same set/filter | `components/ActionBar.tsx`, `components/DuplicateGroups.tsx` |
| Include all available sets | “Include all available sets” | Add all sets available to review and return newly included sets to review | Scan-wide included-set and remaining-review counts update | Use individual checkboxes or the shown-set removal action | Stay on the same filter | `components/ActionBar.tsx`, `lib/duplicate-review-session.ts` |
| Choose keepers automatically | Choose a keeper rule | Local recommendation update | Explain changes, manual choices replaced, and unchanged cleanup selection | Existing per-set keeper choices remain editable | Stay in review | `lib/keep-strategy-feedback.ts` |
| Move to Trash | Final review button | Audit export and typed-count confirmation | Provider result and supported Undo | Keep result/error report and provider recovery guidance | Existing result surface | `tabs/app.tsx`, `lib/trash-lifecycle.ts` |

## Navigation and responsive behavior

- The side panel and full page share scan and review components.
- The compact review toolbar shows two ordered, visually distinct steps:
  choose keeper photos, then include sets in cleanup. Its rule action explains
  scan-wide scope. The prominent include-all action spans the scan sets
  available to review; the filter-scoped include and remove actions explain
  their current-filter scope.
- “Include all shown” and “Remove shown” stay within the current result filter.
  “Include all available” crosses filters and returns newly included sets to
  review. Choosing keepers automatically applies to the entire scan and names
  that wider scope.
- Cleanup summary counts use the full eligible cleanup scope across filters,
  so changing a filter does not make the Trash gate appear complete early.
- Keep photo sets, selected keeper chips, cleanup selection state, and action
  labels readable in both compact and full-page layouts.

## Overlays and feedback

- Keeper-rule feedback reports keeper changes and explicitly says cleanup
  selection is unchanged.
- Cleanup summaries distinguish sets selected for cleanup from proposed media
  items.
- The Trash dialog remains the final boundary before provider action and must
  retain the typed-count and audit-report requirements.
- A photo viewer is read-only with respect to keeper and cleanup state.

## Async and resilience

- Scan and provider Trash state are owned by existing lifecycle modules.
- Do not dispatch provider Trash from selection or keeper-rule actions.
- Preserve stored selections and keeper provenance across reloads.
- Keep unrelated scan, provider, and storage lifecycle contracts in their
  maintained source modules.

## Validation

- Unit/component coverage: review session, keeper strategy feedback,
  ActionBar, scan config, and DuplicateGroups.
- Integration coverage: first scan, keeper changes, set inclusion, filter
  scope, typed Trash confirmation, provider result, and Undo.
- Browser runtime visual validation uses the exact candidate in Chrome Stable
  only when a deliberate browser/build handoff is available.
- Store artwork is captured from an exact approved release package. The live
  listing or unpublished draft is not updated by source changes alone.
