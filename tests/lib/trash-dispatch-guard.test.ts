import { describe, expect, it } from "vitest"

import type { DuplicateTrashPlan } from "../../lib/duplicate-review-session"
import {
  captureTrashDispatchAuthorization,
  isTrashDispatchAuthorizationCurrent,
  trashPlanFingerprint
} from "../../lib/trash-dispatch-guard"

const plan: DuplicateTrashPlan = {
  provider: "google",
  dedupKeys: ["d1"],
  mediaKeysToTrash: ["m1"],
  blockedMediaKeys: [],
  blockedGroupIds: []
}

function authorization(
  overrides: Partial<
    Parameters<typeof captureTrashDispatchAuthorization>[0]
  > = {}
) {
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
    expect(isTrashDispatchAuthorizationCurrent(expected, authorization())).toBe(
      true
    )
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

  it("rejects a provider page-session change for iCloud dispatch", () => {
    const icloudPlan: DuplicateTrashPlan = {
      ...plan,
      provider: "icloud"
    }
    const expected = authorization({
      plan: icloudPlan,
      provider: "icloud",
      providerSessionId: "session-a"
    })
    const current = authorization({
      plan: icloudPlan,
      provider: "icloud",
      providerSessionId: "session-b"
    })

    expect(isTrashDispatchAuthorizationCurrent(expected, current)).toBe(false)
  })

  it("[SESSION-TRANSITION] rejects a same-account Google session change across audit persistence", () => {
    const expected = authorization({ providerSessionId: "google-session-a" })
    const current = authorization({ providerSessionId: "google-session-b" })
    expect(expected.accountEmail).toBe(current.accountEmail)
    expect(isTrashDispatchAuthorizationCurrent(expected, current)).toBe(false)
  })

  it("[FAVORITE-PROTECTION] binds the exact unknown-favorite selection across audit persistence", () => {
    const unknownFavoritePlan = { ...plan, unknownFavoriteMediaKeys: ["m1"] }
    const expected = authorization({ plan: unknownFavoritePlan })
    expect(isTrashDispatchAuthorizationCurrent(expected, authorization({ plan: { ...unknownFavoritePlan } }))).toBe(true)
    expect(isTrashDispatchAuthorizationCurrent(expected, authorization())).toBe(false)
    expect(isTrashDispatchAuthorizationCurrent(expected, authorization({ plan: { ...plan, unknownFavoriteMediaKeys: ["m2"] } }))).toBe(false)
  })

  it("binds page-session IDs for every provider when present", () => {
    const google = authorization({
      provider: "google",
      providerSessionId: "google-page-session"
    })
    const icloud = authorization({
      provider: "icloud",
      providerSessionId: "icloud-page-session"
    })
    const amazonWithoutSession = authorization({
      provider: "amazon",
      providerSessionId: undefined
    })
    const icloudWithEmptySession = authorization({
      provider: "icloud",
      providerSessionId: ""
    })

    expect(google.providerSessionId).toBe("google-page-session")
    expect(icloud.providerSessionId).toBe("icloud-page-session")
    expect(amazonWithoutSession).not.toHaveProperty("providerSessionId")
    expect(icloudWithEmptySession).not.toHaveProperty("providerSessionId")
  })
})
