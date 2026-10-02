import { BUILD_ID } from "./generated/build-flags"
import type { RuntimeBuildIdentity } from "./types"

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/
const PACKAGE_VERSION_PATTERN = /^\d+(?:\.\d+){1,3}$/
const BUILD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface RuntimeIdentitySource {
  id?: unknown
  getManifest?: () => unknown
}

export function isRuntimeBuildIdentity(
  value: unknown
): value is RuntimeBuildIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.extensionId === "string" &&
    EXTENSION_ID_PATTERN.test(candidate.extensionId) &&
    typeof candidate.packageVersion === "string" &&
    PACKAGE_VERSION_PATTERN.test(candidate.packageVersion) &&
    typeof candidate.buildId === "string" &&
    BUILD_ID_PATTERN.test(candidate.buildId)
  )
}

export function readRuntimeBuildIdentity(
  source: RuntimeIdentitySource,
  buildId: string | undefined = BUILD_ID
): RuntimeBuildIdentity | undefined {
  try {
    const manifest = source.getManifest?.()
    const identity = {
      extensionId: source.id,
      packageVersion:
        manifest && typeof manifest === "object"
          ? (manifest as Record<string, unknown>).version
          : undefined,
      buildId
    }
    return isRuntimeBuildIdentity(identity) ? identity : undefined
  } catch {
    return undefined
  }
}

/** Replace any provider-supplied identity with metadata read by the extension. */
export function attachRuntimeBuildIdentity<
  T extends { runtimeBuildIdentity?: RuntimeBuildIdentity }
>(
  message: T,
  source: RuntimeIdentitySource,
  buildId: string | undefined = BUILD_ID
): T {
  const {
    runtimeBuildIdentity: _untrustedIdentity,
    ...messageWithoutIdentity
  } = message
  const trustedIdentity = readRuntimeBuildIdentity(source, buildId)
  return (
    trustedIdentity
      ? { ...messageWithoutIdentity, runtimeBuildIdentity: trustedIdentity }
      : messageWithoutIdentity
  ) as T
}
