---
version: 1
name: "PhotoSweep"
description: "A light workspace for reviewing duplicate photos, with a blue-and-gold sweep identity."
colors:
  canvas: "#F7F8FA"
  surface: "#FFFFFF"
  surface-soft: "#EDF3FF"
  surface-subtle: "#F6F8FB"
  border: "#D9E1EB"
  border-strong: "#A7B5C7"
  ink: "#1B2D42"
  muted: "#53657B"
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
  masthead: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}" }
  masthead-caption: { backgroundColor: "{colors.surface}", textColor: "{colors.muted}" }
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
- **Memorable signature:** A white header carries the blue-and-gold brand mark.
  Numbered step markers borrow their shape from a photo index and show where
  the user is in the scan and review sequence.
- **Restraint:** Keep result cards and scan controls readable in the narrow
  side panel. Avoid decorative gradients and low-contrast inactive states.
- **Anti-references:** Teal listing artwork, one-click-cleaner language, and
  visual states that make an unselected set look disabled.
- **Token ownership/runtime mapping:** Runtime colors are owned by
  `lib/photo-sweep-colors.ts`. `lib/theme.ts` maps them into Material UI; this
  document mirrors those values and does not generate runtime tokens. Product
  surfaces should import from the theme instead of defining duplicate colors.

## Colors

The header uses dark text and a white surface. The workspace uses a cool light
canvas, white photo sets, slate text, and a royal-blue action color. Blue also
marks selected cleanup sets. The heading and photo labels explain what that
selection means. Success, warning, and
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

Both surfaces use the same header and five-step index. The side panel stacks
each step number above its label. The full page pairs numbers with labels
when space allows. Once results arrive, the side panel leads with the review
tools and makes successful scan coverage expandable. Group the selected scope, matching summary, and primary
scan action in one scan plan. In review, show the filter and its next action
above a contact sheet of photo and video copies. Give verification feedback
the same placement as the verification action. The side panel puts two
copies side by side where they fit. The full page uses a virtualized list.
Each set places keeper choices before the explicit cleanup inclusion
control. Excluded sets remain fully legible.

Use the existing MUI spacing and component overrides. The values in the
frontmatter document the current review-card, toolbar, and content-width
geometry; component-specific exceptions remain in their owner components.

## Elevation and depth

Separate toolbars and optional settings with a single rule. Use small shadows
where controls float over content. A selected set gets a stronger blue border and a pale blue
cleanup area. The sticky cleanup summary leads with the number of media
items proposed for Trash.
Unselected sets remain fully opaque. Reserve deep shadow and dark overlays
for the photo viewer. The cleanup summary uses a solid surface.

## Shapes

Controls use the theme's 8px base radius. Dialogs use 12px. Review cards use a
16px radius on the full page and 12px in the side panel. Chips
and pills remain compact. Focus outlines are visible and must not be clipped by
sticky containers.

## Components

### Foundational visual states

- **Default:** White surface, quiet border, full-opacity text and media.
- **Hover/active:** Small border or surface change; do not move content or
  resize a control.
- **Focus-visible:** Use a three-pixel primary-blue outline with an offset.
- **Selected keeper:** A visible “Keep this copy” or “Suggested keep” label
  and blue card treatment.
- **Selected cleanup set:** Checked set control, pale-blue cleanup area, and an
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
