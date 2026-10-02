import { describe, expect, it } from "vitest"

import {
  attachRuntimeBuildIdentity,
  isRuntimeBuildIdentity,
  readRuntimeBuildIdentity
} from "../../lib/runtime-build-identity"

const validIdentity = {
  extensionId: "abcdefghijklmnopabcdefghijklmnop",
  packageVersion: "2.3.0.3",
  buildId: "123e4567-e89b-42d3-a456-426614174000"
}

describe("runtime build identity", () => {
  it("[PARITY-08] captures the service worker extension ID, manifest version, and package ID", () => {
    expect(
      readRuntimeBuildIdentity(
        {
          id: validIdentity.extensionId,
          getManifest: () => ({ version: validIdentity.packageVersion })
        },
        validIdentity.buildId
      )
    ).toEqual(validIdentity)
  })

  it("[PARITY-08] fails closed when runtime fields or package identity are malformed", () => {
    expect(isRuntimeBuildIdentity(validIdentity)).toBe(true)
    expect(
      readRuntimeBuildIdentity(
        {
          id: "provider-page-id",
          getManifest: () => ({ version: validIdentity.packageVersion })
        },
        validIdentity.buildId
      )
    ).toBeUndefined()
    expect(
      readRuntimeBuildIdentity(
        {
          id: validIdentity.extensionId,
          getManifest: () => ({ version: validIdentity.packageVersion })
        },
        "provider-supplied-build-id"
      )
    ).toBeUndefined()
    expect(
      readRuntimeBuildIdentity(
        {
          id: validIdentity.extensionId,
          getManifest: () => {
            throw new Error("runtime unavailable")
          }
        },
        validIdentity.buildId
      )
    ).toBeUndefined()
  })

  it("[PARITY-08] replaces provider-supplied identity with service-worker metadata", () => {
    const message = attachRuntimeBuildIdentity(
      {
        app: "GPD" as const,
        action: "gptkResult" as const,
        command: "getAllMediaItems",
        requestId: "request-1",
        success: true,
        runtimeBuildIdentity: {
          ...validIdentity,
          extensionId: "ponmlkjihgfedcbaponmlkjihgfedcba"
        }
      },
      {
        id: validIdentity.extensionId,
        getManifest: () => ({ version: validIdentity.packageVersion })
      },
      validIdentity.buildId
    )

    expect(message.runtimeBuildIdentity).toEqual(validIdentity)
    expect(
      attachRuntimeBuildIdentity(
        {
          app: "GPD" as const,
          action: "gptkResult" as const,
          command: "getAllMediaItems",
          requestId: "request-2",
          success: true,
          runtimeBuildIdentity: validIdentity
        },
        {},
        undefined
      )
    ).not.toHaveProperty("runtimeBuildIdentity")
  })
})
