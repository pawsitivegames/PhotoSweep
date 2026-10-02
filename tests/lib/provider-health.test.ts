import { describe, expect, it } from "vitest"

import {
  isProviderHealthSnapshot,
  PROVIDER_HEALTH_CONTRACT_VERSION,
  PROVIDER_HEALTH_SCHEMA_VERSION,
  type ProviderHealthSnapshot
} from "../../lib/types"

function health(
  provider: ProviderHealthSnapshot["provider"],
  status: ProviderHealthSnapshot["status"],
  checks: ProviderHealthSnapshot["checks"]
): ProviderHealthSnapshot {
  return {
    schemaVersion: PROVIDER_HEALTH_SCHEMA_VERSION,
    contractVersion: PROVIDER_HEALTH_CONTRACT_VERSION,
    provider,
    status,
    checks
  }
}

describe("provider health contract", () => {
  it("accepts a ready snapshot only when every bounded check is true", () => {
    const snapshot = health("icloud", "ready", {
      page: true,
      session: true,
      readPath: true
    })

    expect(isProviderHealthSnapshot(snapshot, "icloud")).toBe(true)
  })

  it("accepts an unavailable snapshot without exposing provider details", () => {
    const snapshot = health("amazon", "unavailable", {
      page: true,
      session: false,
      readPath: false
    })

    expect(isProviderHealthSnapshot(snapshot, "amazon")).toBe(true)
  })

  it("rejects a ready snapshot with a failed check", () => {
    const snapshot = health("google", "ready", {
      page: true,
      session: true,
      readPath: false
    })

    expect(isProviderHealthSnapshot(snapshot, "google")).toBe(false)
  })

  it("rejects schema, contract, and provider mismatches", () => {
    const snapshot = health("google", "ready", {
      page: true,
      session: true,
      readPath: true
    }) as unknown as Record<string, unknown>

    expect(
      isProviderHealthSnapshot(
        { ...snapshot, schemaVersion: 2 },
        "google"
      )
    ).toBe(false)
    expect(
      isProviderHealthSnapshot(
        { ...snapshot, contractVersion: "provider-parity-v2" },
        "google"
      )
    ).toBe(false)
    expect(isProviderHealthSnapshot(snapshot, "amazon")).toBe(false)
  })
})
