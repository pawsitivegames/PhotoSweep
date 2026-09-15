import type { DuplicateTrashPlan } from "./duplicate-review-session"
import type { PhotoProvider } from "./types"

/**
 * Immutable authorization captured before the pre-trash audit is persisted.
 * The dispatch boundary must compare it with the latest app state after every
 * awaited operation; a paid-access generation alone does not cover review or
 * provider scope changes.
 */
export interface TrashDispatchAuthorization {
  generation: number
  provider: PhotoProvider
  accountEmail?: string
  scopeFingerprint?: string
  planFingerprint: string
}

function normalizedEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized || undefined
}

export function trashPlanFingerprint(plan: DuplicateTrashPlan): string {
  return JSON.stringify({
    provider: plan.provider,
    dedupKeys: [...plan.dedupKeys],
    mediaKeysToTrash: [...plan.mediaKeysToTrash],
    // iCloud dispatch is authorized by record identity and change tag as
    // well as by the provider/media keys. Keep these refs in the authorization
    // fingerprint so a stale or reordered CloudKit target cannot cross the
    // awaited audit boundary unnoticed.
    icloudAssetRefs: plan.icloudAssetRefs
      ? plan.icloudAssetRefs.map((ref) => ({ ...ref }))
      : null,
    blockedMediaKeys: [...plan.blockedMediaKeys],
    blockedGroupIds: [...plan.blockedGroupIds]
  })
}

export function captureTrashDispatchAuthorization(params: {
  generation: number
  plan: DuplicateTrashPlan
  provider: PhotoProvider
  accountEmail?: string
  scopeFingerprint?: string
}): TrashDispatchAuthorization {
  return {
    generation: params.generation,
    provider: params.provider,
    ...(normalizedEmail(params.accountEmail)
      ? { accountEmail: normalizedEmail(params.accountEmail) }
      : {}),
    ...(params.scopeFingerprint
      ? { scopeFingerprint: params.scopeFingerprint }
      : {}),
    planFingerprint: trashPlanFingerprint(params.plan)
  }
}

export function isTrashDispatchAuthorizationCurrent(
  expected: TrashDispatchAuthorization,
  current: TrashDispatchAuthorization
): boolean {
  return (
    expected.generation === current.generation &&
    expected.provider === current.provider &&
    expected.accountEmail === current.accountEmail &&
    expected.scopeFingerprint === current.scopeFingerprint &&
    expected.planFingerprint === current.planFingerprint
  )
}
