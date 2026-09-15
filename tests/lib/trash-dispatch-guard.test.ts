import { describe, expect, it } from "vitest"

import {
  captureTrashDispatchAuthorization,
  isTrashDispatchAuthorizationCurrent,
  trashPlanFingerprint
} from "../../lib/trash-dispatch-guard"
import type { DuplicateTrashPlan } from "../../lib/duplicate-review-session"

const plan: DuplicateTrashPlan = {
  provider: "google",
  dedupKeys: ["d1"],
  mediaKeysToTrash: ["m1"],
  blockedMediaKeys: [],
  blockedGroupIds: []
}

function authorization(overrides: Partial<Parameters<typeof captureTrashDispatchAuthorization>[0]> = {}) {
  return captureTrashDispatchAuthorization({
    generation: 4,
    plan,
    provider: "google",
    accountEmail: "Buyer@example.com",
    scopeFingerprint: "scope-a",
    ...overrides
  })
}

describe("trash dispatch authorization", () => {
  it("normalizes identity while preserving the exact plan", () => {
    expect(authorization().accountEmail).toBe("buyer@example.com")
    expect(trashPlanFingerprint(plan)).toContain('"dedupKeys":["d1"]')
  })

  it("binds iCloud record refs to the dispatch authorization", () => {
    const icloudPlan: DuplicateTrashPlan = {
      ...plan,
      provider: "icloud",
      icloudAssetRefs: [
        {
          recordName: "asset-1",
          changeTag: "tag-1",
          ownerRecordName: "owner-1",
          zoneName: "PrimarySync"
        }
      ]
    }
    const expected = authorization({ plan: icloudPlan, provider: "icloud" })
    expect(
      isTrashDispatchAuthorizationCurrent(
        expected,
        authorization({ plan: icloudPlan, provider: "icloud" })
      )
    ).toBe(true)
    expect(
      isTrashDispatchAuthorizationCurrent(
        expected,
        authorization({
          plan: {
            ...icloudPlan,
            icloudAssetRefs: [
              { ...icloudPlan.icloudAssetRefs![0], changeTag: "tag-2" }
            ]
          },
          provider: "icloud"
        })
      )
    ).toBe(false)
  })

  it("rejects paid generation, provider, account, scope, and selection drift", () => {
    const expected = authorization()
    expect(isTrashDispatchAuthorizationCurrent(expected, authorization())).toBe(true)
    for (const changed of [
      authorization({ generation: 5 }),
      authorization({ provider: "icloud" }),
      authorization({ accountEmail: "other@example.com" }),
      authorization({ scopeFingerprint: "scope-b" }),
      authorization({
        plan: { ...plan, dedupKeys: ["d2"], mediaKeysToTrash: ["m2"] }
      })
    ]) {
      expect(isTrashDispatchAuthorizationCurrent(expected, changed)).toBe(false)
    }
  })
})
