export interface LiveScanFixture {
  schemaVersion: 1
  provider: "google"
  albumTitle: string
  albumId: string
  expectedMediaKeys: string[]
  expectedGroups: string[][]
}

export function requireLiveExtensionId(value: string | undefined): string {
  if (!value || !/^[a-p]{32}$/.test(value)) {
    throw new Error("Set PHOTOSWEEP_E2E_EXTENSION_ID to the exact installed test extension ID.")
  }
  return value
}

export function parseLiveScanFixture(input: unknown): LiveScanFixture {
  const value = input as Partial<LiveScanFixture> | null
  if (!value || value.schemaVersion !== 1 || value.provider !== "google" ||
      typeof value.albumTitle !== "string" || !value.albumTitle.trim() ||
      typeof value.albumId !== "string" || !value.albumId ||
      !Array.isArray(value.expectedMediaKeys) || !value.expectedMediaKeys.length ||
      value.expectedMediaKeys.length > 100 ||
      value.expectedMediaKeys.some((key) => typeof key !== "string" || !key) ||
      new Set(value.expectedMediaKeys).size !== value.expectedMediaKeys.length ||
      !Array.isArray(value.expectedGroups)) {
    throw new Error("Live scans require a schema-1 Google synthetic-album oracle with 1–100 unique media keys.")
  }
  const members = new Set<string>()
  for (const group of value.expectedGroups) {
    if (!Array.isArray(group) || group.length < 2 || group.some((key) =>
      typeof key !== "string" || !value.expectedMediaKeys!.includes(key) || members.has(key)
    ) || new Set(group).size !== group.length) {
      throw new Error("Synthetic fixture groups must contain distinct known media keys without overlap.")
    }
    group.forEach((key) => members.add(key))
  }
  return value as LiveScanFixture
}

function canonicalGroups(groups: string[][]): string {
  return JSON.stringify(groups.map((group) => [...group].sort()).sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  ))
}

export function liveScanMatchesFixture(scan: unknown, fixture: LiveScanFixture): boolean {
  if (!scan || typeof scan !== "object") return false
  const result = scan as {
    sourceProvider?: unknown
    mediaItems?: Record<string, unknown>
    mediaItemsAreComplete?: unknown
    groups?: { mediaKeys?: unknown }[]
    totalItems?: unknown
    scanCoverage?: { itemsReturned?: unknown }
  }
  if (result.sourceProvider !== "google" || typeof result.mediaItemsAreComplete !== "boolean" ||
      !result.mediaItems || typeof result.mediaItems !== "object" || Array.isArray(result.mediaItems) ||
      !Array.isArray(result.groups) ||
      result.totalItems !== fixture.expectedMediaKeys.length ||
      result.scanCoverage?.itemsReturned !== fixture.expectedMediaKeys.length) return false
  const retainedKeys = Object.keys(result.mediaItems)
  if (retainedKeys.some((key) => !fixture.expectedMediaKeys.includes(key))) return false
  // Compact results intentionally retain grouped items only. Never mistake
  // that representation for a complete provider inventory.
  if (result.mediaItemsAreComplete && retainedKeys.length !== fixture.expectedMediaKeys.length) return false
  if (result.groups.some((group) => !group || typeof group !== "object" || !Array.isArray(group.mediaKeys) ||
      group.mediaKeys.some((key) => typeof key !== "string" || !retainedKeys.includes(key)))) return false
  return canonicalGroups(result.groups.map((group) => group.mediaKeys as string[])) ===
    canonicalGroups(fixture.expectedGroups)
}
