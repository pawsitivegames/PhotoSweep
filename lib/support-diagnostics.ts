import type { Entitlement } from "./entitlement"
import { getEffectivePlanId } from "./entitlement"
import { isRuntimeBuildIdentity } from "./runtime-build-identity"
import {
  APP_ID,
  type PhotoProvider,
  type RuntimeBuildIdentity,
  type ScanMode
} from "./types"

export interface SupportDiagnosticsInput {
  version: string
  provider: PhotoProvider
  scanMode: ScanMode
  entitlement: Entitlement
  photoCountBucket?: string
  duplicateGroupCountBucket?: string
  errorCategory?: string
  recentLogs?: string[]
  runtimeBuildIdentity?: RuntimeBuildIdentity
}

export interface SupportDiagnosticsReport {
  app: typeof APP_ID
  reportId: string
  createdAt: string
  version: string
  provider: PhotoProvider
  scanMode: ScanMode
  planId: Entitlement["planId"]
  entitlementSource: Entitlement["source"]
  photoCountBucket?: string
  duplicateGroupCountBucket?: string
  errorCategory?: string
  recentLogs: string[]
  runtimeBuildIdentity?: RuntimeBuildIdentity
}

function redactLog(line: string): string {
  return line
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(
      /\b[\w.-]+\.(?:jpe?g|png|gif|heic|heif|webp|tiff?|bmp|mov|mp4|m4v|avi)\b/gi,
      "[filename]"
    )
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.+-Z]+)?\b/g, "[date]")
    .replace(/\bAF1Qip[A-Za-z0-9_-]+\b/g, "[provider-id]")
}

export function buildSupportDiagnosticsReport(
  input: SupportDiagnosticsInput
): SupportDiagnosticsReport {
  const createdAt = new Date().toISOString()
  const runtimeBuildIdentity = isRuntimeBuildIdentity(
    input.runtimeBuildIdentity
  )
    ? input.runtimeBuildIdentity
    : undefined
  return {
    app: APP_ID,
    reportId: `photosweep-diagnostics-${createdAt.replace(/[:.]/g, "-")}`,
    createdAt,
    version: input.version,
    provider: input.provider,
    scanMode: input.scanMode,
    planId: getEffectivePlanId(input.entitlement),
    entitlementSource: input.entitlement.source,
    photoCountBucket: input.photoCountBucket,
    duplicateGroupCountBucket: input.duplicateGroupCountBucket,
    errorCategory: input.errorCategory,
    recentLogs: (input.recentLogs ?? []).map(redactLog),
    ...(runtimeBuildIdentity?.packageVersion === input.version
      ? { runtimeBuildIdentity }
      : {})
  }
}
