import type { PhotoProvider } from "./types"

export const HEALTH_CHECK_MAX_ATTEMPTS = 3
export const HEALTH_CHECK_RETRY_DELAYS_MS = [400, 800] as const

export type HealthCheckRetryPlan = {
  provider: PhotoProvider
  attempt: number
  delayMs: number
}

/**
 * Plans bounded retries for the post-open provider handshake. A failed
 * handshake is safe to retry because it has no destructive side effect; the
 * destructive commands keep their own request-id and provider-result guards.
 */
export function planHealthCheckRetry(
  provider: PhotoProvider,
  attemptsCompleted: number
): HealthCheckRetryPlan | null {
  if (
    !Number.isInteger(attemptsCompleted) ||
    attemptsCompleted < 1 ||
    attemptsCompleted >= HEALTH_CHECK_MAX_ATTEMPTS
  ) {
    return null
  }

  return {
    provider,
    attempt: attemptsCompleted + 1,
    delayMs: HEALTH_CHECK_RETRY_DELAYS_MS[attemptsCompleted - 1]
  }
}
