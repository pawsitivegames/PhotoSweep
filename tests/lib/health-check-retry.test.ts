import { describe, expect, it } from "vitest"

import {
  HEALTH_CHECK_MAX_ATTEMPTS,
  HEALTH_CHECK_RETRY_DELAYS_MS,
  planHealthCheckRetry
} from "../../lib/health-check-retry"
import type { PhotoProvider } from "../../lib/types"

const providers: PhotoProvider[] = ["google", "amazon", "icloud"]

describe("provider connection health-check retry policy", () => {
  it("allows two bounded automatic retries for every supported provider", () => {
    for (const provider of providers) {
      expect(planHealthCheckRetry(provider, 1)).toEqual({
        provider,
        attempt: 2,
        delayMs: HEALTH_CHECK_RETRY_DELAYS_MS[0]
      })
      expect(planHealthCheckRetry(provider, 2)).toEqual({
        provider,
        attempt: 3,
        delayMs: HEALTH_CHECK_RETRY_DELAYS_MS[1]
      })
    }
  })

  it("stops after the initial attempt plus two retries", () => {
    expect(HEALTH_CHECK_MAX_ATTEMPTS).toBe(3)
    expect(planHealthCheckRetry("google", 3)).toBeNull()
    expect(planHealthCheckRetry("amazon", 4)).toBeNull()
    expect(planHealthCheckRetry("icloud", 0)).toBeNull()
    expect(planHealthCheckRetry("google", 1.5)).toBeNull()
  })
})
