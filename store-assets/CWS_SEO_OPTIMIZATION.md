# Chrome Web Store Search Optimization (Reviewed Proposal)

Status: **Package metadata is set for the requested listing strings. This change builds an upload package only; it does not submit or publish to the Chrome Web Store.**

## What we know

The current live listing uses:

> PhotoSweep - Duplicate Photo Finder

"Google Photos duplicate finder" is a highly relevant search query for this product. However, Chrome Web Store does not publish a ranking formula. Any metadata change should be judged by policy safety, clarity, and observed search performance instead of assumed title weighting.

## Package metadata for the next listing submission

### Title (limit 75)

The package title is:

> **PhotoSweep for Google Photos™** (29/75)


### Short Description (limit 132)


> **Find duplicate photos and videos in Google Photos. Matching stays in your browser. Review, then Trash only what you confirm.** (124/132)

These values are sourced from `package.json` and are checked in both the
manifest tests and the release-package audit. The title uses Google Photos as
the supported provider name; review trademark and affiliation requirements
before submitting the package.

### Detailed Description

Keep the current detailed description's provider-specific limitations, review-before-cleanup model, and scoped privacy language. The existing affiliation disclaimer should remain unchanged.

## Critic gate re-review

Per `CHROME_WEB_STORE_REFRESH.md`, both critics must approve before any live listing change.

- **Good cop:** confirm the short description is clear, useful, and trust-building.
- **Bad cop:** confirm the scoped local-matching and provider-availability language is truthful; review the title for policy and trademark compliance before submission.

## Submission notes

- Confirm current Chrome Web Store review requirements for listing edits in the Developer Dashboard before submitting.
- Do not assume a listing edit avoids review or affects no listing state.
- After a change, monitor search visibility for relevant queries and compare conversion and support feedback, not only install count.
