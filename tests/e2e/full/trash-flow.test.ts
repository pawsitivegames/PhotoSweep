/** Live Trash is intentionally unavailable in this legacy automated harness.
 * The release gate uses separately approved one-item provider round trips with
 * exact target reports and independent Trash inventories. Never treat a tiny
 * album, an environment flag, or the first visible group as target approval.
 */
import { test } from "@playwright/test"

test("live Trash requires the release-gated target-bound procedure", () => {
  test.skip(process.env.GPD_E2E_ALLOW_TRASH !== "1", "Live Trash is not part of the scan-only harness.")
  throw new Error("Legacy live Trash automation is disabled: use the reviewed one-item release-gate procedure with explicit target approval and same-run restore. No browser or provider operation was started.")
})
