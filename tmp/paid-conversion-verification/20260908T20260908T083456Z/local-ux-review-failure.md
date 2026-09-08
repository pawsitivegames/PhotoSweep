# Local responsive UX review — superseded false alarm

The independent browser/visual review ran against the dev fixture after
building with `PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=1`.

Command:

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools \
  npx playwright test \
  --config tmp/paid-conversion-verification/20260908T20260908T083456Z/local-ux-review.config.ts \
  -g 'upgrade scope copy'
```

The first inspection tested the wrong scrolling element. The dialog paper is
static, but Material UI's `.MuiDialogContent-root` is the actual user-scroll
container. The initial paper metrics therefore looked like a reachability
failure:

```text
viewportHeight: 800
paperClientHeight: 736
paperScrollHeight: 736
paperScrollTop: 0
paperOverflowY: auto
Choose Lifetime Early Access: top 578.23 bottom 616.23
Choose Cleanup Pass: top 785.19 bottom 823.19
Choose Mini Cleanup: top 969.16 bottom 1007.16
Recover: top 1247.88 bottom 1284.38
Refresh license: top 699.50 bottom 759.50
Keep reviewing free results: top 699.00 bottom 760.00
```

The screenshot is `upgrade-dialog-narrow-viewport.png`; the complete initial
console output is `local-ux-upgrade-metrics.log`. The affected implementation
surface is `components/UpgradeDialog.tsx` lines 136–329 (the dialog content and
actions).

The follow-up real-scroll probe in `local-ux-upgrade-reachability.log` showed
the actual content container has `clientHeight=595`, `scrollHeight=1208`, and
`overflowY=auto`. A real `page.mouse.wheel(0, 1200)` moved
`contentScrollTop` from `0` to `613.5` and brought the Cleanup Pass, Mini, and
Recover controls into the 800px viewport. The keyboard probe in
`local-ux-upgrade-keyboard-scroll.log` then reached Cleanup Pass and Mini via
Tab and automatically moved the content scroll position. This is not a
current product failure; it is retained as an audit trail for the initial
wrong-element observation.

The independent review passed the wide 1024x900 upgrade layout, narrow and
wide rating layout/copy checks, real wheel reachability, Tab reachability,
Escape dismissal, and focus return. P4.3 is therefore a bounded local PASS.
