import { describe, expect, it } from "vitest"

import {
  boundedRetryDelays,
  clearDeferredUpgrade,
  describePaidReturnOutcome,
  formatUpgradeScope,
  shouldShowDeferredUpgrade,
  type DeferredUpgradePrompt
} from "../../lib/paid-conversion"

const deferred: DeferredUpgradePrompt = {
  reason: "scan",
  facts: {
    provider: "google",
    scopeLabel: "Google Photos library currently loaded",
    itemsChecked: 1000,
    additionalItemsUnavailable: 1800
  }
}

describe("paid conversion contracts", () => {
  it("only shows deferred scan value after useful completed results", () => {
    expect(shouldShowDeferredUpgrade(deferred, 3, true)).toBe(true)
    expect(shouldShowDeferredUpgrade(deferred, 0, true)).toBe(false)
    expect(shouldShowDeferredUpgrade(deferred, 3, false)).toBe(false)
    expect(clearDeferredUpgrade()).toBeNull()
  })

  it("keeps scope and retry schedule bounded and deterministic", () => {
    expect(formatUpgradeScope(deferred.facts)).toBe(
      "Google Photos library currently loaded"
    )
    expect(formatUpgradeScope({})).toBeUndefined()
    expect(boundedRetryDelays(4, 0, 500)).toEqual([0, 500, 1000, 2000])
    expect(boundedRetryDelays(0, -1, -5)).toEqual([0])
  })

  it("uses neutral payment-return copy for each bounded outcome", () => {
    expect(
      describePaidReturnOutcome("activated", "Lifetime Early Access")
    ).toMatch(/active/)
    expect(describePaidReturnOutcome("pending", "Cleanup Pass")).toMatch(
      /confirmed/
    )
    expect(describePaidReturnOutcome("offline", "Cleanup Pass")).toMatch(
      /license service/
    )
  })
})
