---
version: 1
name: "PhotoSweep"
description: "A calm, review-first photo cleanup utility with a blue-and-gold sweep identity."
colors:
  canvas: "#F3F6FB"
  surface: "#FFFFFF"
  surface-soft: "#EDF3FF"
  surface-subtle: "#F7F9FC"
  border: "#E1E7EF"
  border-strong: "#C8D2E0"
  ink: "#1B2D42"
  muted: "#5E7087"
  primary: "#255BD4"
  primary-dark: "#1948AD"
  primary-border: "#A7BCE8"
  primary-shadow: "rgba(37, 91, 212, 0.14)"
  success: "#176535"
  success-soft: "#E5F4EA"
  warning: "#81530F"
  warning-soft: "#FFF3D8"
  error: "#B9362F"
  error-dark: "#8F2924"
  error-soft: "#FDEBE8"
typography:
  sans:
    fontFamily: '"DM Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Arial, sans-serif'
  mono:
    fontFamily: '"SF Mono", ui-monospace, SFMono-Regular, Menlo, monospace'
rounded:
  DEFAULT: "8px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "24px"
spacing:
  review-card-gap: "12px"
  toolbar-gap: "6px"
  page-max: "900px"
components:
  button: { min-height: "40px", contained-min-height: "44px", focus-ring: "3px" }
  review-card: { selected-border: "2px", default-border: "1px" }
  dialog: { border-radius: "12px" }
---

# PhotoSweep Design System

## Overview

### Creative North Star

PhotoSweep should feel like a careful photo librarian: it lays out evidence
clearly, marks one deliberate keeper choice in blue, and leaves the cleanup
decision with the person who owns the library. The photo-and-golden-sweep mark
is the memorable brand gesture. Product screens stay quiet so the photos and
review state carry the attention.

### Product context and register

- **Audience and primary job:** People reviewing duplicate or similar photos
  and videos in a supported cloud library.
- **Target markets and evidence:** The product supports Google Photos,
  iCloud Photos, and Amazon Photos flows. The interface names these providers;
  this does not imply equal feature coverage or official affiliation.
- **Locale and language policy:** Current extension copy is English. Keep
  provider names and the review vocabulary consistent across the extension,
  website, and store listing.
- **Usage scene:** Chrome side panel for focused review and a wider extension
  page for longer scans and denser result lists.
- **Register:** Trustworthy utility. State what an action changes before using
  cleanup language, and use “proposed for Trash” until the user confirms.
- **Memorable signature:** Blue selection and progress accents paired with the
  golden sweep in the brand mark.
- **Restraint:** Keep result cards and scan controls readable in the narrow
  side panel. Avoid decorative gradients and low-contrast inactive states.
- **Anti-references:** Teal listing artwork, one-click-cleaner language, and
  visual states that make an unselected set look disabled.
- **Token ownership/runtime mapping:** Runtime colors are owned by
  `lib/photo-sweep-colors.ts`. `lib/theme.ts` maps them into Material UI; this
  document mirrors those values and does not generate runtime tokens. Product
  surfaces should import from the theme instead of defining duplicate colors.

## Colors

The canvas is cool and light, with white cards, quiet slate text, and a single
royal-blue action color. Blue also marks selected cleanup sets; the heading and
photo chips explain exactly what that selection means. Success, warning, and
error colors describe state and never substitute for text. The gold belongs to
the official mark, not to routine controls. The current extension theme is
light-only.

The Chrome Web Store uses the same mark, palette, and typography. Product
screenshots must be captured from the approved extension package; captured UI
is not recolored to imitate this palette. The website should use the same brand
mark and primary identity.

## Typography

Use the locally bundled DM Sans as the first family, followed by the operating
system UI stacks and Arial. `lib/theme.ts` loads the DM Sans weights used by the
extension. Use sentence case for controls, action verbs for set inclusion, and
tabular/monospaced treatment only for technical values such as dimensions or
identifiers. Keep photo names readable and expose their full value as a title
when the card truncates them.

## Layout

The side panel stacks scope, review controls, one result set, and the cleanup
summary. Controls stay full-width or use a two-column action row only when
their labels remain clear. The full page shares the same components and tokens
while using a wider, virtualized review list. Keep photo choices within their
set and the cleanup inclusion control in the set header. Do not dim excluded
sets as if they were disabled.

Use the existing MUI spacing and component overrides. The values in the
frontmatter document the current review-card, toolbar, and content-width
geometry; component-specific exceptions remain in their owner components.

## Elevation and depth

Separate sections with borders and small, soft shadows. A selected set gets a
stronger blue border and a pale blue header. Unselected sets remain fully
opaque. Reserve deep shadow and dark overlays for the photo viewer. Avoid
blurred glass effects in review controls and cleanup summaries.

## Shapes

Controls use the theme's 8px base radius. Dialogs use 12px; large review cards
use a larger rounded container with a tighter radius in the side panel. Chips
and pills remain compact. Focus outlines are visible and must not be clipped by
sticky containers.

## Components

### Foundational visual states

- **Default:** White surface, quiet border, full-opacity text and media.
- **Hover/active:** Small border or surface change; do not move content or
  resize a control.
- **Focus-visible:** Three-pixel primary-blue outline with an offset.
- **Selected keeper:** A visible “Keep this copy” or “Suggested keeper” chip
  and blue card treatment.
- **Selected cleanup set:** Checked set control, pale-blue header, and an
  explicit “Selected for cleanup” state.
- **Needs review:** Warning-colored state label; never signal this only by
  color.
- **Disabled:** Keep full explanatory text and provide a reason in nearby copy
  when the disabled state prevents the next step.
- **Busy:** Preserve button and card geometry while displaying progress.
- **Error/success:** Pair semantic color with a text message and recovery path.
- **Loading:** Use the existing app-owned progress and skeleton components;
  reserve skeletons for content that will occupy the same final geometry.

### Buttons and actions

Use one primary action per scan or confirmation surface. “Choose keepers
automatically” changes keeper choices; selecting sets changes which eligible
unkept copies contribute to the Trash proposal. “Include all available sets”
spans result filters, excludes plan-locked sets, and returns newly included
sets to “Needs review.” “Include all shown sets in cleanup” and “Remove shown
sets from cleanup” stay within the current filter. Keep irreversible or
provider-level actions behind the existing confirmation flow.

### Navigation and data display

Keep provider, scan scope, matching method, and review filter in a stable order.
Show exact and similar-result counts in the filter control. Summaries
distinguish sets selected for cleanup, proposed media items, and sets still requiring
review.

### Forms and overlays

Use MUI fields and alerts through the shared theme. Confirm cleanup with the
existing dialog, audit-report notice, typed count, and final action. Use the
photo viewer for full-size inspection; opening it must not change keeper or
cleanup selection.

### Iconography

Use the existing Material Icons Rounded family for UI actions. Keep text labels
beside consequential icons, including Trash and set inclusion. Use the
photo-and-golden-sweep mark from `assets/icon.png` for product identity.

### Motion

Use the existing short state transitions for border, background, and shadow.
Avoid decorative motion in scanning and review. Honor reduced-motion
preferences where an animated progress or viewer transition is introduced.

### Content and data visualization

Use direct verbs and distinguish “keeper,” “set selected for cleanup,”
“proposed for Trash,” and “moved to Trash.” Do not say that an item “moves”
before provider confirmation. Screenshots and listing copy must preserve the
same distinctions and provider caveats as the product.

## Do's and Don'ts

- **Do:** Use `lib/theme.ts` and the canonical photo-sweep color map.
- **Do:** Show keeper choice and cleanup inclusion as separate states.
- **Don't:** Use the previous teal listing treatment or recolor captured UI.
- **Don't:** Use “Moves to Trash” for a proposal or make an excluded set look disabled.
