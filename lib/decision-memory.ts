import type {
  DuplicateReviewSelections,
  KeepDecisionSource
} from "./duplicate-review-session"
import { accountFingerprint } from "./review-preflight"
import type { DuplicateGroup, GpdMediaItem, PhotoProvider } from "./types"

export const DECISION_MEMORY_STORAGE_KEY = "decisionMemory"
export const DECISION_MEMORY_VERSION = 1 as const
export const MAX_DECISION_MEMORY_RECORDS = 100
export const DECISION_MEMORY_TTL_MS = 180 * 24 * 60 * 60 * 1000

export type RememberedSelection = "selected" | "skipped"

export interface DecisionMemoryRecord {
  version: typeof DECISION_MEMORY_VERSION
  key: string
  provider: PhotoProvider
  accountFingerprint: string
  groupIdentity: string
  selection: RememberedSelection
  keptIdentities?: string[]
  savedAt: number
}

export interface DecisionMemoryStorageAdapter {
  get(): Promise<unknown>
  set(records: DecisionMemoryRecord[]): Promise<void>
  remove(): Promise<void>
}

function hash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(16)
}

function identityForItem(item: GpdMediaItem): string {
  if (item.contentHash?.provenance === "original-content") {
    return `content:${item.contentHash.algorithm}:${item.contentHash.value}`
  }
  if (item.provider && item.dedupKey) {
    return `provider:${item.provider}:${item.dedupKey}`
  }
  const fallback = [
    item.fileName?.trim().toLowerCase() ?? "",
    Number.isFinite(item.timestamp) ? Math.round(item.timestamp) : "",
    Number.isFinite(item.creationTimestamp)
      ? Math.round(item.creationTimestamp)
      : "",
    item.resWidth ?? "",
    item.resHeight ?? "",
    item.duration ?? "",
    item.size ?? ""
  ].join("|")
  return `metadata:${hash(fallback)}`
}

export function stableMediaIdentity(
  item: GpdMediaItem | undefined,
  provider: PhotoProvider
): string | null {
  if (!item) return null
  const identity = identityForItem(item)
  return `${provider}:${identity}`
}

export function stableGroupIdentity(
  group: DuplicateGroup,
  mediaItems: Record<string, GpdMediaItem>,
  provider: PhotoProvider
): string | null {
  const identities = group.mediaKeys
    .map((key) => stableMediaIdentity(mediaItems[key], provider))
    .filter((identity): identity is string => Boolean(identity))
  if (identities.length !== group.mediaKeys.length || identities.length < 2) {
    return null
  }
  return `${provider}:group:${identities.sort().join(",")}`
}

function normalizedRecords(
  value: unknown,
  now = Date.now()
): DecisionMemoryRecord[] {
  if (!Array.isArray(value)) return []
  const records: DecisionMemoryRecord[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue
    const raw = candidate as Partial<DecisionMemoryRecord>
    if (
      raw.version !== DECISION_MEMORY_VERSION ||
      (raw.provider !== "google" &&
        raw.provider !== "icloud" &&
        raw.provider !== "amazon") ||
      typeof raw.accountFingerprint !== "string" ||
      typeof raw.groupIdentity !== "string" ||
      (raw.selection !== "selected" && raw.selection !== "skipped") ||
      typeof raw.savedAt !== "number" ||
      now - raw.savedAt > DECISION_MEMORY_TTL_MS
    ) {
      continue
    }
    const keptIdentities = Array.isArray(raw.keptIdentities)
      ? raw.keptIdentities.filter(
          (item): item is string => typeof item === "string"
        )
      : undefined
    records.push({
      version: DECISION_MEMORY_VERSION,
      key:
        typeof raw.key === "string"
          ? raw.key
          : `${raw.provider}:${raw.groupIdentity}`,
      provider: raw.provider,
      accountFingerprint: raw.accountFingerprint,
      groupIdentity: raw.groupIdentity,
      selection: raw.selection,
      ...(keptIdentities ? { keptIdentities } : {}),
      savedAt: raw.savedAt
    })
  }
  const deduped = new Map<string, DecisionMemoryRecord>()
  for (const record of records) {
    const previous = deduped.get(record.key)
    if (!previous || previous.savedAt <= record.savedAt)
      deduped.set(record.key, record)
  }
  return [...deduped.values()]
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(0, MAX_DECISION_MEMORY_RECORDS)
}

export function sanitizeDecisionMemory(
  value: unknown,
  now = Date.now()
): DecisionMemoryRecord[] {
  return normalizedRecords(value, now)
}

export function captureManualDecisionRecords(params: {
  groups: DuplicateGroup[]
  mediaItems: Record<string, GpdMediaItem>
  selections: DuplicateReviewSelections
  provider: PhotoProvider
  accountEmail?: string
  now?: number
}): DecisionMemoryRecord[] {
  const account = accountFingerprint(params.accountEmail)
  if (!account) return []
  const now = params.now ?? Date.now()
  const records: DecisionMemoryRecord[] = []
  for (const group of params.groups) {
    if (!params.selections.reviewedGroupIds.has(group.id)) continue
    const groupIdentity = stableGroupIdentity(
      group,
      params.mediaItems,
      params.provider
    )
    if (!groupIdentity) continue
    const provenance = params.selections.keepDecisionProvenance?.[group.id]
    const source: KeepDecisionSource | undefined = provenance?.source
    if (source === "automatic" || source === "legacy_preserved") continue
    const keptKeys = params.selections.keptOverrides[group.id]
    const keptIdentities = keptKeys
      ? [...keptKeys]
          .map((key) =>
            stableMediaIdentity(params.mediaItems[key], params.provider)
          )
          .filter((identity): identity is string => Boolean(identity))
          .sort()
      : undefined
    records.push({
      version: DECISION_MEMORY_VERSION,
      key: `${params.provider}:${account}:${groupIdentity}`,
      provider: params.provider,
      accountFingerprint: account,
      groupIdentity,
      selection: params.selections.selectedGroupIds.has(group.id)
        ? "selected"
        : "skipped",
      ...(keptIdentities ? { keptIdentities } : {}),
      savedAt: now
    })
  }
  return records
}

export function mergeDecisionMemory(
  existing: DecisionMemoryRecord[],
  incoming: DecisionMemoryRecord[],
  now = Date.now()
): DecisionMemoryRecord[] {
  const merged = new Map<string, DecisionMemoryRecord>()
  for (const record of normalizedRecords(existing, now))
    merged.set(record.key, record)
  for (const record of normalizedRecords(incoming, now))
    merged.set(record.key, record)
  return [...merged.values()]
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(0, MAX_DECISION_MEMORY_RECORDS)
}

export function applyRememberedDecisions(params: {
  records: DecisionMemoryRecord[]
  groups: DuplicateGroup[]
  mediaItems: Record<string, GpdMediaItem>
  provider: PhotoProvider
  accountEmail?: string
  now?: number
}): DuplicateReviewSelections {
  const account = accountFingerprint(params.accountEmail)
  const selections: DuplicateReviewSelections = {
    selectedGroupIds: new Set(),
    reviewedGroupIds: new Set(),
    keptOverrides: {},
    keepDecisionProvenance: {}
  }
  if (!account) return selections
  const byKey = new Map(
    sanitizeDecisionMemory(params.records, params.now ?? Date.now()).map(
      (record) => [record.key, record]
    )
  )
  for (const group of params.groups) {
    const groupIdentity = stableGroupIdentity(
      group,
      params.mediaItems,
      params.provider
    )
    if (!groupIdentity) continue
    const record = byKey.get(`${params.provider}:${account}:${groupIdentity}`)
    if (!record) continue
    if (record.keptIdentities) {
      const keyByIdentity = new Map(
        group.mediaKeys
          .map(
            (key) =>
              [
                stableMediaIdentity(params.mediaItems[key], params.provider),
                key
              ] as const
          )
          .filter((entry): entry is readonly [string, string] =>
            Boolean(entry[0] && entry[1])
          )
      )
      const keptKeys: string[] = []
      let allIdentitiesPresent = true
      for (const identity of record.keptIdentities) {
        const key = keyByIdentity.get(identity)
        if (!key) {
          allIdentitiesPresent = false
          break
        }
        keptKeys.push(key)
      }
      if (!allIdentitiesPresent) continue
      selections.keptOverrides[group.id] = new Set(keptKeys)
      selections.keepDecisionProvenance![group.id] = {
        source: "legacy_preserved"
      }
    }
    selections.reviewedGroupIds.add(group.id)
    if (record.selection === "selected")
      selections.selectedGroupIds.add(group.id)
  }
  return selections
}

export class DecisionMemoryStore {
  private records: DecisionMemoryRecord[] = []

  constructor(private readonly adapter: DecisionMemoryStorageAdapter) {}

  get current(): DecisionMemoryRecord[] {
    return this.records
  }

  async load(now = Date.now()): Promise<DecisionMemoryRecord[]> {
    this.records = sanitizeDecisionMemory(await this.adapter.get(), now)
    await this.adapter.set(this.records)
    return this.records
  }

  async remember(
    records: DecisionMemoryRecord[],
    now = Date.now()
  ): Promise<DecisionMemoryRecord[]> {
    this.records = mergeDecisionMemory(this.records, records, now)
    await this.adapter.set(this.records)
    return this.records
  }

  async clear(): Promise<void> {
    this.records = []
    await this.adapter.remove()
  }
}
