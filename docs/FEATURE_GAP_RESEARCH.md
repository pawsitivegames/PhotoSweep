# PhotoSweep feature-gap research and product plan

Research date: 2026-09-12

## Executive conclusion

PhotoSweep does not primarily need another generic “find duplicate photos” feature. It already has a meaningful detection and review foundation: local analysis, exact/similar grouping, Google Photos/iCloud/Amazon Photos bridges, scoped scans, checkpoints, review-first selection, provider Trash actions, undo/reporting, and a privacy-first position.

The strongest gap is a trusted, repeatable cleanup system:

> **Show me exactly why these items are grouped, help me choose predictably, prevent me from reviewing the same intentional differences again, and make every cloud action recoverable.**

This is also the most defensible whitespace. Apple Photos has an integrated Duplicates collection and merge flow, Google Photos has stacks and generic storage-management surfaces, and desktop utilities are strong at local-file scanning and selection rules. A cloud extension can win by combining provider-native cleanup with evidence quality, account safety, persistent decisions, coverage tracking, and recovery history.

Recommended order:

1. Make match certainty and keeper recommendations honest and explainable.
2. Make account/scope/action preflight and recovery impossible to miss.
3. Persist cleanup history and intentional decisions across scans.
4. Add storage-impact and large-library planning.
5. Expand video, provider parity, local Takeout/folder workflows, and review-only quality assistance only after the trust core is proven.

Do not lead with automatic deletion, face compositing, a broad AI photo organizer, or cross-provider destructive actions. Those are attractive requests, but they increase false-positive, privacy, and support risk before PhotoSweep has solved the core job reliably.

### Implementation status — 2026-09-12

Astra Medium approved implementation **with conditions**. The first two bounded slices are complete locally: conservative evidence levels, validated original-content hash provenance, legacy-result reclassification, review-only protection for repeated provider identities and RAW/JPEG relationships, strategy-bound keeper recommendations, visible decision provenance, legacy/stale-keeper migration, functional queued review updates, compatible review/report/export fields, and regression coverage. Local browser evidence covers app-tab persistence, compact-panel uncertainty, Trash/Undo, account context, and paid-cap gates; no live provider, payment, store, device, public, or production claim is implied by this implementation.

## 1. Research method and evidence boundaries

The research combined four streams:

- **Product audit:** repository, README, current roadmap, privacy policy, entitlement model, provider operations, classifier, keeper strategy, review state, reports, and Trash lifecycle.
- **Astra Medium pass:** a separate read-only gap-analysis pass using GPT-6 Astra at medium reasoning effort. It independently converged on trust, recovery, repeat cleanup, and account isolation as the highest-value gaps.
- **Live user evidence:** public Reddit, X, Google Photos Community, Apple Community, Ask Different, MacRumors, and DataHoarder discussions.
- **Competitive/platform evidence:** Apple and Google help pages plus PhotoSweeper, Gemini 2, Duplicate Photos Fixer Pro, Czkawka, and Chrome Web Store competitors.

Evidence quality is intentionally separated:

- **High confidence:** official platform documentation and verified repository behavior.
- **Medium confidence:** repeated themes across independent forum discussions and competitor feature pages.
- **Directional:** individual Reddit/X posts, third-party review aggregations, and vendor claims. These identify hypotheses, not market-size estimates or accuracy proof.

The forum and social sample is not a representative survey. It is useful for discovering failure modes and language users use when the job is painful. Before committing to later-stage work, validate the themes with opt-in product events, support conversations, and short user interviews.

## 2. Current PhotoSweep baseline

| Area | Verified current capability | Gap exposed by research |
|---|---|---|
| Providers | Google Photos, iCloud Photos, and Amazon Photos bridges; provider-aware URLs and batch limits | Album scope is currently Google-only; iCloud and Amazon need parity work and live validation before being marketed as equivalent. [`lib/provider-operations.ts`](../lib/provider-operations.ts) |
| Scan scope | Smart/full modes, Google album scope, date range, similarity threshold, checkpoint/resume and embedding cache | Users with large or migrated libraries need a saved coverage plan and “new since last cleanup,” not repeated manual year/month scans. |
| Detection | Local MediaPipe embeddings, verified/candidate groups, photo/video metadata, match reasons | Metadata combinations no longer claim verified identity when a content hash is unavailable; older persisted `exact` results are safely reclassified. The remaining gap is broader evidence coverage across providers and real content-hash provenance. [`lib/duplicate-classifier.ts`](../lib/duplicate-classifier.ts) |
| Keeper selection | Strategy-bound best quality, largest resolution, newest/oldest taken, newest upload, non-storage-counting; visible manual overrides and provenance | A unique comparison with valid evidence can receive a suggestion; ties, missing members, and invalid values keep all copies. Durable cross-scan intentional decisions and additional protection policies remain future work. [`lib/keep-strategy.ts`](../lib/keep-strategy.ts) |
| Review | Grouped cards, virtualized results, exact/similar filters, keep/trash selection, multi-keep, preview, provider links | No durable “keep both,” “ignore this pair,” “protect this item/album,” or review memory that survives a fresh scan. |
| Action safety | Typed-count confirmation, batching/retry, provider Trash, in-app undo/result handling, JSON/CSV reports | Reports are persisted as a bounded recent set, but there is no prominent history/recovery center or guided recovery rehearsal. [`tabs/app.tsx`](../tabs/app.tsx) |
| Privacy | Local analysis, cache controls, redacted diagnostics, optional consented analytics, no photo-analysis backend | A privacy-first claim needs a user-facing data/permission dashboard: what is cached, what is retained, how to clear it, and which host permissions are active. |
| Monetization | Free/paid limits and a Stripe/license path exist in source; plans are scoped by scan size, groups, Trash moves, reports, and resume | The upgrade moment should be tied to verified cleanup value and capacity, not just an arbitrary limit. The live provider/payment/store lifecycle remains a separate proof gate. |

The existing product direction is therefore sound. The roadmap should deepen the trust loop before adding a second product category.

## 3. What users are asking for

### 3.1 Reddit: the repeated pain is scale plus uncertainty

Across Google Photos discussions, users repeatedly describe the absence of a native duplicate workflow, thousands of old duplicates from migrations or backups, and a desire to review similar shots rather than only byte-identical files. Examples include users comparing Google Photos unfavorably with Apple’s duplicate merge flow, users with the same photos saved under different dates, and users looking for a solution after a phone restore duplicated a gallery.

- [Finding/removing duplicate photos](https://www.reddit.com/r/googlephotos/comments/1go8y4n/finding_removing_duplicate_photos/) shows the “thousands of photos plus manual review” problem and the demand for similar-photo review.
- [Duplicate photo](https://www.reddit.com/r/googlephotos/comments/1psspfn/duplicate_photo/) reflects the storage-saving motive and the need to scan large libraries in manageable scopes. It also contains a recent report of a large scan stalling during similar-image grouping.
- [How to remove photos from multiple devices/services](https://www.reddit.com/r/googlephotos/comments/1vsgqrc/how-to-remove-duplicate-photos-from-multiple/) adds migration, cross-device, and cross-service complexity; stacks are not perceived as a complete historical cleanup.
- [Duplicate/similar photo detection](https://www.reddit.com/r/googlephotos/comments/14a87vb/duplicatesimilar_photo_detection/) captures the long-running gap between device-only cleaners and cloud libraries.
- [GoogleTakeoutFixer](https://www.reddit.com/r/googlephotos/comments/1qypota/googletakeoutfixer_opensource_tool_to_clean_up/) surfaces metadata dates, album preservation, and migration artifacts as part of the cleanup job, not optional polish.
- [Czkawka similar-video discussion](https://www.reddit.com/r/DataHoarder/comments/1jchu85/czkawkakrokiet_90_find_duplicates_faster_than/) shows that users distinguish exact duplicates from similar videos and are sensitive to false positives, cache cost, and performance.

Implications for PhotoSweep:

1. **Scope and continuation are product features.** A scan that cannot be paused, resumed, audited, and continued by period feels broken even if its algorithm is accurate.
2. **“Duplicate” needs a confidence vocabulary.** Users mix exact copies, re-encodes, edited versions, burst shots, and migration duplicates; the product must not collapse those into one destructive bucket.
3. **Metadata preservation matters.** Dates, albums, Live Photo/video companions, RAW/JPEG relationships, and ownership affect whether “delete the copy” is actually safe.
4. **Cross-device deletion needs a plain-language warning.** Users are unsure whether removing a cloud item also removes a local copy or a copy on another device.

### 3.2 X: demand is expanding from dedupe to curation, but the signal is noisier

The public X sample is directional rather than survey-grade. It nevertheless reveals useful jobs around the core cleanup task:

- [A user with 6,000+ Google Photos items](https://x.com/Sushant_J_777/status/2098344843726766225) describes the inability to find duplicates and the impossibility of checking manually.
- [A cleanup-order post](https://x.com/Ambrose0_X/status/2097529000113639473) groups duplicates with screenshots, downloads, app leftovers, and local Google Photos copies, suggesting that “free space” is the broader outcome users understand.
- [A Google Photos cleanup post](https://x.com/SirAlexanderrr/status/2096210818689855504) lists screenshots, unnecessary videos, blurry images, and duplicates together.
- [A high-engagement AI/photo-library request](https://x.com/pitdesi/status/2098753845556056472) asks for best-shot selection across group photos, blur/closed-eye detection, duplicate cleanup, and junk screenshot removal.
- [An AI-agent/photo-search request](https://x.com/ChristiexAI/status/2097408827998326925) points toward natural-language discovery and grouping by people, places, and objects.
- [A cross-provider organization request](https://x.com/travis__dewayne/status/2081788528678109481) mentions OneDrive, Google Photos, and iCloud together, which is evidence for a future inventory problem but not yet authorization for cross-service deletion.
- [A SHA-based iCloud dedupe tool](https://x.com/tankbottoms_eth/status/2096358899863486537) shows price sensitivity and demand for an offline/identical-file mode.

Implications:

- Add review-only quality signals such as blur or closed eyes only after the duplicate truth model is solid.
- Treat “screenshots, large videos, and blurry items” as adjacent storage triage, not as evidence that PhotoSweep should become a complete AI organizer immediately.
- Preserve a local-only promise. Sending photos to a remote AI service would directly weaken the product’s most credible trust advantage.

### 3.3 Forums: the dangerous cases are the valuable cases

Official Google help and community answers establish that Google Photos has no general native duplicate finder. The community also points out that apparent duplicates can differ in format or metadata, including RAW/JPEG and bracketing cases.

- [Google Photos duplicate thread](https://support.google.com/photos/thread/228673471/is-there-a-way-do-check-for-duplicate-photos?hl=en) documents the lack of a general native workflow and the fact that format/metadata differences can explain apparent duplicates.
- [Google Photos current duplicate thread](https://support.google.com/photos/thread/325947602/how-to-get-rid-of-duplicate-photos?hl=en) distinguishes Photo Stacks from an actual duplicate-removal workflow.
- [Apple Photos unrecognized duplicate question](https://apple.stackexchange.com/questions/474022/can-i-tell-apple-photos-to-merge-two-duplicate-photos-that-it-hasnt-identified) shows that even Apple’s integrated system misses obvious cases and does not give users a reliable “please merge these” control.
- [RAW/JPEG and small-alteration question](https://apple.stackexchange.com/questions/245913/photos-app-is-not-combining-jpeg-and-raw-photos-after-small-alteration) reinforces the need to treat related formats and edits as a distinct relationship.
- [Edited-image import question](https://apple.stackexchange.com/questions/415120/how-can-i-only-import-the-edited-img-e-photos-to-windows) illustrates how edited originals and sidecar files can create confusing duplicate-looking imports.
- [MacRumors iCloud/Google Photos discussion](https://forums.macrumors.com/threads/two-devices-with-icloud-and-google-photos.2230556/) reflects cross-backup, resolution, and deletion-sync uncertainty.
- [MacRumors large-library discussion](https://forums.macrumors.com/threads/photos-app-managing-1-5tb-libary.2206154/) shows the operational cost of very large libraries: time, sync work, CPU, and manual culling.

These discussions make safety and evidence part of the feature itself. A faster unsafe bulk action is not a competitive advantage.

## 4. Platform and competitor baseline

### 4.1 Native platform behavior

| Platform surface | What it already does | Opportunity for PhotoSweep |
|---|---|---|
| Apple Photos | Automatically identifies a Duplicates collection, offers merge, and places deleted items in Recently Deleted for a recovery window. [Mac guide](https://support.apple.com/en-ie/guide/photos/pht5a3157c1d/mac) · [iPhone guide](https://support.apple.com/en-ae/guide/iphone/iph1978d9c23/ios) | Match Apple’s clarity and recovery affordance while handling cloud-provider bridges and near-duplicates Apple misses. |
| Google Photos stacks | Groups nearly identical photos around a top pick, but stacking is an organization surface and does not itself reduce storage. [Stacks](https://support.google.com/photos/answer/14169846?hl=en-uk) | Explain the difference between organization, detection, and actual provider Trash actions. |
| Google storage manager | Surfaces large photos/videos and other storage categories; it is useful for generic capacity management, not duplicate reasoning. [Storage manager](https://support.google.com/photos/answer/9284827?co=GENIE.Platform%3DAndroid&hl=en) | Build a duplicate-specific, storage-aware triage view with “estimated” versus “confirmed” reclaimed space. |
| Google deletion model | Deleting backed-up items can remove them from devices; Google documents a different cloud-only workflow involving backup settings. [Deletion help](https://support.google.com/photos/answer/6128858?co=GENIE.Platform%3DAndroid&hl=en) | Put provider/account/device consequences in the preflight and result report, not buried in a generic warning. |

### 4.2 Competitor matrix

| Competitor | Strong features observed | Lesson / remaining whitespace |
|---|---|---|
| Apple Photos | Integrated duplicate collection, merge, batch selection, recovery | Sets the baseline for confidence and recovery. Missed cases and relationship complexity remain open. |
| Gemini 2 | Exact and similar files, Photos/Music/external drives, Duplicate Monitor, Smart Cleanup, custom selection rules, exclusions, recovery, move-to-folder options | Excellent local-file workflow and repeat monitoring. It does not provide PhotoSweep’s direct cloud-provider bridge. User reviews also request stronger global filters and complain about repetitive large-library work. [App Store](https://apps.apple.com/us/app/gemini-2-the-duplicate-finder/id1090488118?mt=12) |
| PhotoSweeper | Similar photos, series of shots, edited photos, movies, adjustable thresholds, Auto Mark, Auto Lock, Face-to-Face and All-in-One review, metadata/browser tools | Strong review ergonomics and intentional-difference handling. It is primarily a local library tool. [Official site](https://overmacs.com/) |
| Duplicate Photos Fixer Pro | Exact/similar modes, rotated/flipped matching, scan scopes, Auto Mark, customizable selection priority, metadata/group detail, lock/exclude controls | Selection rules are a competitive baseline. PhotoSweep should expose equivalent rationale and protection controls in a cloud-safe flow. [UI guide](https://www.duplicatephotosfixer.com/user-guide/user-interface/) · [Scan settings](https://www.duplicatephotosfixer.com/user-guide/scan-settings/) |
| Czkawka/Krokiet | Open-source local exact/similar images and videos, exclusions, cache, safe multi-tool workflow, similarity thresholds, metadata tools | Users value privacy, transparency, video support, cache, and large-library performance. It is not a provider-native Google/iCloud/Amazon cleanup experience. [GitHub](https://github.com/qarmin/czkawka) |
| Google Photos Duplicate Remover (Chrome Web Store) | Direct Google Photos workflow, album/date scans, local processing claim, AI/manual keeper choice, size/resolution/date/name signals, Trash recovery claim | Confirms direct-cloud competition exists. Its listing claims are not independent accuracy or live-provider proof. [Listing](https://chromewebstore.google.com/detail/google-photos-duplicate-r/baafhiocpgpaahonnkhkhbkggbhmefld) |
| Duplicate Photo Cleaner for Google Photos (Chrome Web Store) | Whole-library/album/date claims, perceptual hashing, best-version selection, review, Trash recovery, video separation, one-time Pro claim | Confirms that album/date/video separation and price simplicity are expected in the category. Small usage signals mean the listing is not demand validation. [Listing](https://chromewebstore.google.com/detail/duplicate-photo-cleaner-f/oimjbfmbmainjknmdfbaifikbdnhoeom) |

Competitive conclusion: “local processing” and “find exact/similar” are no longer enough by themselves. PhotoSweep’s moat should be a combination of direct cloud action, conservative evidence, provider/account safeguards, durable intent, and a recovery record.

## 5. Prioritized feature candidates

Priority definitions:

- **P0:** trust/safety foundation; do before major acquisition or paid-capacity expansion.
- **P1:** high-value workflow improvement after P0; likely to improve completion and retention.
- **P2:** differentiating adjacency; validate with evidence before committing.
- **Hold:** attractive but strategically premature or too risky for the current product.

### P0 — Trust core

#### P0.1 Evidence-based match certainty

**Problem.** The current classifier can label a group `exact` from same filename, dimensions, taken date, and sometimes size/duration even without a same-content hash. That can overstate certainty.

**Plan.** Replace the binary mental model with explicit relationship levels:

1. **Verified identical:** same provider dedup identity or same content hash.
2. **Strong duplicate candidate:** high perceptual similarity plus supporting metadata; not necessarily byte-identical.
3. **Similar moment/series:** visually related but potentially intentional alternatives.
4. **Related format/edit:** RAW/JPEG, edited/original, Live Photo/video companion, or re-encode relationship.

Show the evidence chips in every group: hash/identity, perceptual score, dimensions, file size, dates, filename, format, storage impact, and missing fields. Rename “Exact” to “Verified identical” unless the strongest evidence is present.

**Acceptance criteria.** A fixture suite proves that re-encodes, edited copies, RAW/JPEG pairs, different metadata, bursts, and true byte-identical items land in the intended tier. A Trash action cannot be initiated from the most uncertain tier without an explicit review state.

**Why first.** It lowers false-positive risk across every later feature and makes marketing claims defensible.

#### P0.2 Predictable keeper recommendations

**Problem.** A user-selected strategy can be surprised by hidden overrides, missing metadata, or a heuristic that calls one file “best quality.”

**Plan.** For every proposed keeper, show a concise decision trace: “kept because original quality,” “larger dimensions,” “newer upload,” or “storage impact.” Make explicit user selection authoritative. If evidence is tied, missing, or invalid, say “No confident recommendation — keeping all copies” rather than silently choosing.

**Acceptance criteria.** The chosen keeper always satisfies the selected strategy when a unique valid comparison exists. Every automatic selection has a reason and an uncertainty state; no-confidence groups keep all copies and propose zero Trash items. A user can apply a strategy, inspect a sample, make a manual single/multi/keep-all/trash-all choice, reload, and reapply another strategy without losing group membership or manual precedence.

#### P0.3 Account-bound cleanup preflight

**Problem.** Provider pages can change account, scope, or freshness between scan and Trash. Current persisted account mismatch validation is explicitly Google-specific.

**Plan.** Bind results and actions to provider, account identity when available, scan scope, scan timestamp, item count, and a content/session fingerprint for all providers. Before Trash, show:

- provider and account,
- exact scope and scan age,
- groups/items selected,
- estimated and provider-confirmed storage impact,
- protected/skipped items,
- what provider Trash does and its recovery window,
- whether any account or scope changed since scanning.

If the account is unknown or changed, block destructive actions and require a fresh account-bound scan.

**Acceptance criteria.** Google, iCloud, and Amazon each have account-change, stale-result, unknown-account, and wrong-provider tests. The UI names the account or clearly says it is unverified. No provider can reuse another provider’s results.

#### P0.4 Guided first cleanup and recovery rehearsal

**Problem.** Users fear cloud deletion more than they value a fast scan. A typed count is useful but not enough for first-use confidence.

**Plan.** Add a first-run “safe start”: scan a small scope, review one or two groups, export a preview, Trash one test item, open the provider’s Trash/Recently Deleted, and offer restore. Keep the rehearsal optional but prominently recommended. Record that the user completed it; do not make recovery itself paid.

**Acceptance criteria.** A fresh profile can complete a one-item round trip on each provider where live support is verified. The result clearly separates “PhotoSweep requested Trash,” “provider confirmed moved,” “restore requested,” and “restore confirmed/unknown.”

#### P0.5 Durable cleanup history and recovery center

**Problem.** A recent in-app result is not a durable mental model. Users need to know what happened last week and what can still be recovered.

**Plan.** Add a local history view with one row per scan/action session: provider/account, scope, scan time, groups found, items reviewed, items trashed, confirmed/failed/unknown counts, report export, and recovery deadline if known. Let users reopen the report and navigate to provider Trash. Keep raw thumbnails out of history by default; retain redacted metadata sufficient for audit and restore guidance. Make retention and clear controls explicit.

**Acceptance criteria.** Closing and reopening the extension preserves history. History is account/provider-bound, capped with a user-visible retention policy, exportable, and clearable. A partial provider operation remains visible as partial; it is never represented as a successful complete cleanup.

#### P0.6 Synchronized side-by-side comparison

**Problem.** Similarity decisions are difficult when thumbnails hide compression, blur, faces, or small edits.

**Plan.** Add Face-to-Face comparison with synchronized zoom/pan, fit-to-screen, metadata panel, file/format/size/resolution, and visual overlays for the reason the pair is grouped. Keep the existing single-item viewer as the fast path.

**Acceptance criteria.** Keyboard and pointer navigation work, focus is accessible, reduced-motion mode is respected, and the user can choose keep both without leaving the comparison. This aligns with the existing roadmap’s viewer/side-by-side direction.

### P1 — Repeatable, storage-aware cleanup

#### P1.1 Remember intentional differences

Persist decisions using stable provider media identity plus a relationship fingerprint:

- **Keep both:** suppress this relationship in future scans.
- **Ignore this group:** do not surface it again unless the user resets it.
- **Protect item:** never auto-select for Trash.
- **Protect album/scope:** retain items in selected albums or scope contexts where provider semantics support it.
- **Review later:** keep it in a queue without treating it as unresolved failure.

The system must distinguish “user intentionally kept both” from “user did not review.” Provide a reset/manage screen and include the state in reports.

#### P1.2 Saved scopes and coverage planner

Create saved scans such as “Google Photos — 2024 Screenshots,” “iCloud — Camera Roll 2020,” or “Amazon — last 90 days.” Track covered date range, albums, item count, last completed scan, unresolved groups, and “new since last scan.”

The planner should recommend the next missing period, preserve checkpoints, and explain when a provider cannot provide album scope. This directly addresses repeated year-by-year scans and the large-library stall reports.

#### P1.3 Storage-impact prioritization

Add a queue sorted by likely useful space recovery, using provider `spaceTaken`/`takesUpSpace`, file size, count, and confidence. Label every amount as:

- **Provider-confirmed:** the provider exposed the storage value.
- **Estimated:** derived from file metadata or a heuristic.
- **Unknown:** not enough evidence.

Show “review minutes per GB saved” after a session. Prioritize high-confidence large exact duplicates before similar bursts.

#### P1.4 Protection rules beyond favorites

Extend protection to originals, shared items, edited versions, RAW/JPEG or Live Photo relationships, albums, non-owned items, and user-defined labels where provider data supports them. Explain which rule blocked an item. Never assume that a favorite is the only proxy for value.

#### P1.5 Provider parity and live-operation hardening

Close the known album-scope asymmetry only where the provider offers a stable route. Add provider-specific account identity, album/listing, action result, Trash destination, and restore evidence. Keep unsupported scope types visible rather than presenting a generic disabled control.

This is an engineering/release gate, not just a UI feature: tiny live scan → review → Trash → restore evidence is required per provider before the capability is advertised as production-ready.

#### P1.6 Large-library performance and coverage telemetry

Make progress meaningful: fetched, decoded, embedded, grouped, reviewed, persisted, and remaining. Support pause/resume, backoff, checkpoint integrity, memory bounds, and retry without starting over. Add a benchmark fixture for 40k–80k media items and a failure state that identifies the last completed stage.

Measure only privacy-safe aggregates with consent. Do not send filenames, thumbnails, album names, provider URLs, or raw reports.

#### P1.7 Privacy and permissions dashboard

Add a plain-language panel showing:

- analysis location,
- cached embeddings and metadata retained locally,
- saved reports/history,
- license/session data,
- optional analytics state,
- provider host permissions,
- exact clear/export actions.

This turns “local-first” from a static policy claim into an operational user control.

#### P1.8 Video and companion-media relationships

Improve video comparison with duration, frame sampling, poster frames, codec/container, resolution, and re-encode signals. Treat Live Photo/Motion Photo components and RAW/JPEG pairs as related assets before proposing any Trash action. Start review-only; do not automatically delete a companion asset unless the provider relationship is proven.

### P2 — Differentiating adjacencies

#### P2.1 Local folder and Google Takeout import mode

Offer a read-only local mode for folders and Takeout exports. Preserve or report EXIF, sidecar, album, and path relationships. Allow export of a cleanup manifest before any filesystem mutation. This addresses migration users without forcing a provider bridge to solve every historical artifact.

#### P2.2 Cross-provider duplicate inventory

Build a read-only inventory across Google Photos, iCloud Photos, and Amazon Photos first. Show “same likely asset exists in multiple providers” with confidence and estimated redundant storage. Do not offer cross-service destructive actions until identity, ownership, backup, and recovery semantics are independently verified.

#### P2.3 Review-only quality assistance

Add optional local signals for blur, closed eyes, exposure, duplicate screenshots, and burst best-shot suggestions. These should create review queues, not auto-delete. Show the model signal and confidence; allow “not useful” feedback locally or through consented aggregate telemetry.

#### P2.4 Curated cleanup categories

After duplicate workflow metrics justify it, add explicit categories such as screenshots, downloads, memes, large videos, and blurry items. Keep the category scope narrow and explainable. Do not silently become a people/place/event organizer.

### Hold — avoid for now

- Automatic permanent deletion.
- AI-generated face compositing or “best face” replacement.
- Remote photo upload for AI classification.
- Cross-provider delete/restore from one button.
- Subscription pressure around recovery or basic safety.
- General-purpose natural-language photo search and album generation.
- Claims of preventing future duplicates when the extension cannot control upstream backup/import behavior.

These can be revisited if user research, provider capabilities, and privacy design support them. They should not distract from the core promise.

## 6. Recommended implementation sequence

### Phase 0 — Contract and fixtures

Deliver:

- relationship taxonomy and user-facing wording,
- identity/freshness/account-binding contract,
- curated photo/video fixture corpus,
- keeper decision-trace contract,
- privacy-safe event names and outcome definitions.

Exit evidence:

- classifier fixture report,
- keeper strategy truth table,
- provider/account state matrix,
- threat/failure-mode review,
- copy review for cloud/local deletion consequences.

### Phase 1 — Trust core

Deliver P0.1–P0.3 and P0.6:

- confidence tiers and evidence chips,
- predictable keeper strategy and explicit overrides,
- account-bound preflight for all providers,
- side-by-side comparison,
- stale-result and wrong-account blocks.

Exit evidence:

- unit/property tests for classification and selection invariants,
- UI tests for account switching and stale scans,
- accessible keyboard/focus checks,
- screenshots only for visual comparison/review evidence.

### Phase 2 — Recovery and history

Deliver P0.4–P0.5:

- guided first cleanup,
- one-item Trash/restore rehearsal,
- durable local session history,
- partial/unknown operation states,
- report and retention controls.

Exit evidence:

- fresh-profile round trip,
- reopen-after-action persistence check,
- interrupted/partial operation test,
- provider-specific live evidence where available.

### Phase 3 — Repeat cleanup

Deliver P1.1–P1.4:

- intentional decisions,
- saved scopes and coverage planner,
- new-since-last-scan,
- storage-impact queue,
- protection rules.

Exit evidence:

- second scan does not resurface intentionally ignored relationships,
- reset controls restore visibility,
- coverage planner finds missing periods without duplicate work,
- estimates are visually distinguished from provider-confirmed values.

### Phase 4 — Scale and provider depth

Deliver P1.5–P1.8:

- provider parity where technically supportable,
- large-library progress/checkpoint hardening,
- video/companion relationships,
- privacy/permissions dashboard.

Exit evidence:

- benchmark run at target scale,
- bounded-memory and resume evidence,
- tiny live scan/Trash/restore per provider,
- new-account and permission-denied flows,
- package and policy review.

### Phase 5 — Adjacent growth

Run discovery experiments for P2.1–P2.4:

- Takeout/local mode,
- read-only cross-provider inventory,
- review-only quality assistance,
- narrow storage categories.

Promote a candidate only when it improves a measured user outcome without reducing match precision, recovery clarity, or privacy trust.

## 7. Metrics and experiment design

Use outcome metrics rather than checkout clicks alone. Existing privacy constraints mean metrics should be bucketed, consented, and free of photo content.

### Trust and correctness

- Verified-identical precision on a labeled fixture corpus.
- False-positive rate for edited, re-encoded, RAW/JPEG, burst, and companion-media cases.
- Percentage of automatic selections with a displayed reason.
- Percentage of Trash sessions blocked by account/scope mismatch before action.
- Restore success, restore unknown, and partial-operation rates.

### Workflow value

- Time from scan completion to first confident action.
- Groups reviewed per minute.
- Percentage of sessions reaching a confirmed cleanup result.
- Repeat-review rate for groups previously marked keep-both/ignore.
- New items found by saved scopes without reprocessing covered items.
- Estimated versus provider-confirmed storage recovery error.

### Commercial validation

- Free users reaching a meaningful first cleanup.
- Upgrade rate after seeing verified locked capacity or scan coverage, not after a generic prompt.
- Paid activation, completed cleanup, refunds, support contacts, and repeat use.
- Recovery/history use among paid and free users; safety should not be monetized as a fear lever.

### Suggested initial hypotheses

1. Evidence tiers plus keeper reasons reduce review time and accidental keep/trash reversals.
2. A first-run one-item rehearsal increases completed first cleanups more than an earlier paywall does.
3. Persistent “keep both/ignore” decisions materially reduce repeat review on the second scan.
4. A storage-impact queue increases confirmed useful cleanup per minute without increasing false positives.
5. Users with large libraries prefer a coverage planner and resume certainty over a nominal full-library button.

## 8. Release and claim gates

Research findings are not release proof. Before shipping or advertising each capability, keep the evidence layers separate:

- **Local code:** typecheck, unit/property tests, integration tests, package build.
- **Browser/provider:** real Google Photos, iCloud, and Amazon account flows; account switch; scoped scan; review; Trash; restore.
- **Payment/provider:** real sandbox or production checkout/license evidence; source plan config is not live payment proof.
- **Store/public:** packaged extension, listing, permissions, screenshots, privacy/support/refund pages.
- **Human review:** accessibility, wording, destructive-action review, and support-readiness.

The highest-risk claims are “exact,” “safe,” “recoverable,” “works across providers,” “saves X GB,” and “local/private.” Each needs a corresponding evidence artifact. A passing local build cannot substitute for live provider or store evidence.

## 9. Final recommendation

Build the product around the sentence: **“Clean up cloud-photo duplicates with clear evidence, remembered decisions, and a recovery record.”**

The first release of this strategy should make five visible improvements: confidence tiers, keeper explanations, account-bound preflight, recovery/history, and persistent intentional decisions. Those features reinforce everything PhotoSweep already does, answer the most repeated user fears, and create a stronger paid-capacity story without forcing a broad organizer pivot.

Only after that loop is working should PhotoSweep spend major effort on blurry/closed-eye AI, cross-provider inventory, Takeout import, or general photo organization.

## Sources

### User discussions

- [Reddit — finding/removing duplicate photos](https://www.reddit.com/r/googlephotos/comments/1go8y4n/finding_removing_duplicate_photos/)
- [Reddit — duplicate photo and large-library scanning](https://www.reddit.com/r/googlephotos/comments/1psspfn/duplicate_photo/)
- [Reddit — duplicates across devices/services](https://www.reddit.com/r/googlephotos/comments/1vsgqrc/how-to-remove-duplicate-photos-from-multiple/)
- [Reddit — duplicate/similar detection](https://www.reddit.com/r/googlephotos/comments/14a87vb/duplicatesimilar_photo_detection/)
- [Reddit — GoogleTakeoutFixer](https://www.reddit.com/r/googlephotos/comments/1qypota/googletakeoutfixer_opensource_tool_to_clean_up/)
- [Reddit — Czkawka similar videos](https://www.reddit.com/r/DataHoarder/comments/1jchu85/czkawkakrokiet_90_find_duplicates_faster_than/)
- [Reddit — bulk image/video analysis at large scale](https://www.reddit.com/r/DataHoarder/comments/1sbta52/anyone_know_of_a_bulk_imagevideo_analyzerorganizer_for_about_80k_media_files/)
- [X — 6,000+ Google Photos duplicate burden](https://x.com/Sushant_J_777/status/2098344843726766225)
- [X — storage cleanup categories](https://x.com/Ambrose0_X/status/2097529000113639473)
- [X — Google Photos cleanup categories](https://x.com/SirAlexanderrr/status/2096210818689855504)
- [X — AI best-shot and cleanup request](https://x.com/pitdesi/status/2098753845556056472)
- [X — AI agent inside Google Photos](https://x.com/ChristiexAI/status/2097408827998326925)
- [X — cross-provider organization](https://x.com/travis__dewayne/status/2081788528678109481)
- [X — SHA-based iCloud dedupe tool](https://x.com/tankbottoms_eth/status/2096358899863486537)
- [Google Photos Community — duplicate checking](https://support.google.com/photos/thread/228673471/is-there-a-way-do-check-for-duplicate-photos?hl=en)
- [Google Photos Community — removing duplicates](https://support.google.com/photos/thread/325947602/how-to-get-rid-of-duplicate-photos?hl=en)
- [Apple Community — duplicate removal](https://discussions.apple.com/thread/255905360)
- [Apple Community — Photos analysis and optimized storage](https://discussions.apple.com/thread/255828647)
- [Ask Different — unrecognized duplicates](https://apple.stackexchange.com/questions/474022/can-i-tell-apple-photos-to-merge-two-duplicate-photos-that-it-hasnt-identified)
- [Ask Different — RAW/JPEG and small alterations](https://apple.stackexchange.com/questions/245913/photos-app-is-not-combining-jpeg-and-raw-photos-after-small-alteration)
- [Ask Different — edited image imports](https://apple.stackexchange.com/questions/415120/how-can-i-only-import-the-edited-img-e-photos-to-windows)
- [MacRumors — iCloud and Google Photos](https://forums.macrumors.com/threads/two-devices-with-icloud-and-google-photos.2230556/)
- [MacRumors — large Photos library management](https://forums.macrumors.com/threads/photos-app-managing-1-5tb-libary.2206154/)

### Official platform documentation

- [Apple Photos on Mac — find and remove duplicate photos and videos](https://support.apple.com/en-ie/guide/photos/pht5a3157c1d/mac)
- [Apple Photos on iPhone — merge duplicate photos and videos](https://support.apple.com/en-ae/guide/iphone/iph1978d9c23/ios)
- [Google Photos — Photo stacks](https://support.google.com/photos/answer/14169846?hl=en-uk)
- [Google Photos — manage storage](https://support.google.com/photos/answer/9284827?co=GENIE.Platform%3DAndroid&hl=en)
- [Google Photos — delete photos and videos](https://support.google.com/photos/answer/6128858?co=GENIE.Platform%3DAndroid&hl=en)
- [Google Photos — free up space on a device](https://support.google.com/photos/answer/6128843?co=GENIE.Platform%3DAndroid&hl=en)

### Competitors and adjacent tools

- [PhotoSweeper](https://overmacs.com/)
- [Gemini 2 on the Mac App Store](https://apps.apple.com/us/app/gemini-2-the-duplicate-finder/id1090488118?mt=12)
- [Duplicate Photos Fixer Pro — user interface](https://www.duplicatephotosfixer.com/user-guide/user-interface/)
- [Duplicate Photos Fixer Pro — scan settings](https://www.duplicatephotosfixer.com/user-guide/scan-settings/)
- [Czkawka GitHub](https://github.com/qarmin/czkawka)
- [Google Photos Duplicate Remover — Chrome Web Store](https://chromewebstore.google.com/detail/google-photos-duplicate-r/baafhiocpgpaahonnkhkhbkggbhmefld)
- [Duplicate Photo Cleaner for Google Photos — Chrome Web Store](https://chromewebstore.google.com/detail/duplicate-photo-cleaner-f/oimjbfmbmainjknmdfbaifikbdnhoeom)
