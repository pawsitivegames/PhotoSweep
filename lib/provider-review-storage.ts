import { AsyncSerialQueue } from "./async-serial-queue"
import { SCAN_CHECKPOINT_KEY } from "./scan-checkpoint"
import type { PhotoProvider, ScanSettings, StoredState } from "./types"

export const PROVIDER_REVIEW_STORAGE_PREFIX = "providerReview.v1"

const REVIEW_KEYS = ["scanResults", "selections", SCAN_CHECKPOINT_KEY] as const

type ReviewKey = (typeof REVIEW_KEYS)[number]
export type ProviderReviewStorageKey =
  | ReviewKey
  | "settings"
  | "legacyMigrationComplete"

export interface ReviewStorageAdapter {
  get(keys: string[]): Promise<Record<string, unknown>>
  set(values: Record<string, unknown>): Promise<void>
  remove(keys: string[]): Promise<void>
}

export interface ProviderScopedReviewStorageOptions {
  getHostProvider(): PhotoProvider | null
  getActiveProvider(): PhotoProvider
}

export interface LegacyReviewMigrationSelection {
  scanResults: boolean
  checkpoint: boolean
}

export function providerReviewStorageKey(
  provider: PhotoProvider,
  key: ProviderReviewStorageKey
): string {
  return `${PROVIDER_REVIEW_STORAGE_PREFIX}.${provider}.${key}`
}

interface LegacyReviewCandidate {
  provider: PhotoProvider
  snapshot: Record<string, unknown>
  scanResults?: StoredState["scanResults"]
  checkpoint?: StoredState["scanCheckpoint"]
}

const ALL_LEGACY_KEYS = [
  "settings",
  "scanResults",
  "selections",
  SCAN_CHECKPOINT_KEY
]

function isPhotoProvider(value: unknown): value is PhotoProvider {
  return value === "google" || value === "icloud" || value === "amazon"
}

function providerFromSettings(value: unknown): PhotoProvider | null {
  if (!value || typeof value !== "object") return null
  const sourceProvider = (value as ScanSettings).sourceProvider
  if (sourceProvider === undefined) return "google"
  return isPhotoProvider(sourceProvider) ? sourceProvider : null
}

function providerFromScanResults(value: unknown): PhotoProvider | null {
  if (!value || typeof value !== "object") return null
  const sourceProvider = (value as StoredState["scanResults"]).sourceProvider
  if (sourceProvider === undefined) return "google"
  return isPhotoProvider(sourceProvider) ? sourceProvider : null
}

function providerFromCheckpoint(value: unknown): PhotoProvider | null {
  if (!value || typeof value !== "object") return null
  return providerFromSettings(
    (value as NonNullable<StoredState["scanCheckpoint"]>).settings
  )
}

function hasValue(values: Record<string, unknown>, key: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(values, key) && values[key] != null
  )
}

function storageValuesEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  return keys.every((key) => {
    const leftHas = Object.prototype.hasOwnProperty.call(left, key)
    const rightHas = Object.prototype.hasOwnProperty.call(right, key)
    if (leftHas !== rightHas) return false
    if (!leftHas) return true
    try {
      return JSON.stringify(left[key]) === JSON.stringify(right[key])
    } catch {
      return false
    }
  })
}

function matchingLegacyCandidate(
  legacy: Record<string, unknown>,
  provider: PhotoProvider
): LegacyReviewCandidate | null {
  const legacySettingsProvider = hasValue(legacy, "settings")
    ? providerFromSettings(legacy.settings)
    : null
  const scanResultsProvider = hasValue(legacy, "scanResults")
    ? providerFromScanResults(legacy.scanResults)
    : null
  const checkpointProvider = hasValue(legacy, SCAN_CHECKPOINT_KEY)
    ? providerFromCheckpoint(legacy[SCAN_CHECKPOINT_KEY])
    : null
  const providerEvidence = [
    legacySettingsProvider,
    scanResultsProvider,
    checkpointProvider
  ].filter((value): value is PhotoProvider => value !== null)
  const hasInvalidProviderEvidence = [
    hasValue(legacy, "settings") && legacySettingsProvider === null,
    hasValue(legacy, "scanResults") && scanResultsProvider === null,
    hasValue(legacy, SCAN_CHECKPOINT_KEY) && checkpointProvider === null
  ].some(Boolean)
  const hasBoundReviewData =
    scanResultsProvider !== null || checkpointProvider !== null

  if (
    hasInvalidProviderEvidence ||
    !hasBoundReviewData ||
    providerEvidence.some((value) => value !== provider)
  ) {
    return null
  }

  return {
    provider,
    snapshot: legacy,
    ...(scanResultsProvider === provider
      ? { scanResults: legacy.scanResults as StoredState["scanResults"] }
      : {}),
    ...(checkpointProvider === provider
      ? {
          checkpoint: legacy[
            SCAN_CHECKPOINT_KEY
          ] as StoredState["scanCheckpoint"]
        }
      : {})
  }
}

/**
 * Keeps review data provider-local while preserving the old `settings` key as
 * the last-used provider preference. Legacy review data is read-only until the
 * normal StoredReviewScope identity/session checks approve a staged copy.
 */
export class ProviderScopedReviewStorage {
  private readonly legacyCandidates = new Map<
    PhotoProvider,
    LegacyReviewCandidate
  >()
  private readonly writeQueues = new Map<PhotoProvider, AsyncSerialQueue>()

  constructor(
    private readonly storage: ReviewStorageAdapter,
    private readonly options: ProviderScopedReviewStorageOptions
  ) {}

  static key(provider: PhotoProvider, key: ProviderReviewStorageKey): string {
    return providerReviewStorageKey(provider, key)
  }

  private writeQueue(provider: PhotoProvider): AsyncSerialQueue {
    let queue = this.writeQueues.get(provider)
    if (!queue) {
      queue = new AsyncSerialQueue()
      this.writeQueues.set(provider, queue)
    }
    return queue
  }

  async get(
    keys: string[],
    explicitProvider?: PhotoProvider
  ): Promise<Partial<StoredState>> {
    const requestsSettings = keys.includes("settings")
    const legacySettings = requestsSettings
      ? await this.storage.get(["settings"])
      : {}
    const selectedProvider =
      explicitProvider ??
      this.options.getHostProvider() ??
      (requestsSettings
        ? providerFromSettings(legacySettings.settings) ??
          this.options.getActiveProvider()
        : this.options.getActiveProvider())
    const requestedReviewKeys = keys.filter((key) =>
      REVIEW_KEYS.includes(key as ReviewKey)
    ) as ReviewKey[]
    const providerKeys = [
      ...(requestsSettings ? ["settings" as const] : []),
      ...requestedReviewKeys
    ]
    const physicalKeys = providerKeys.map((key) =>
      ProviderScopedReviewStorage.key(selectedProvider, key)
    )
    const scoped = await this.storage.get(physicalKeys)
    const restored: Partial<StoredState> = {}

    if (requestsSettings) {
      const scopedSettingsKey = ProviderScopedReviewStorage.key(
        selectedProvider,
        "settings"
      )
      if (hasValue(scoped, scopedSettingsKey)) {
        restored.settings = scoped[scopedSettingsKey] as ScanSettings
      } else if (
        hasValue(legacySettings, "settings") &&
        providerFromSettings(legacySettings.settings) === selectedProvider
      ) {
        restored.settings = legacySettings.settings as ScanSettings
      }
    }

    for (const key of requestedReviewKeys) {
      const physicalKey = ProviderScopedReviewStorage.key(selectedProvider, key)
      if (Object.prototype.hasOwnProperty.call(scoped, physicalKey)) {
        ;(restored as Record<string, unknown>)[key] = scoped[physicalKey]
      }
    }

    const hasScopedReviewData = REVIEW_KEYS.some((key) =>
      hasValue(scoped, ProviderScopedReviewStorage.key(selectedProvider, key))
    )
    if (
      requestsSettings &&
      requestedReviewKeys.length > 0 &&
      !hasScopedReviewData
    ) {
      const markerKey = ProviderScopedReviewStorage.key(
        selectedProvider,
        "legacyMigrationComplete"
      )
      const marker = await this.storage.get([markerKey])
      if (marker[markerKey] !== true) {
        const legacy = await this.storage.get(ALL_LEGACY_KEYS)
        const candidate = matchingLegacyCandidate(legacy, selectedProvider)
        if (candidate) {
          this.legacyCandidates.set(selectedProvider, candidate)
          for (const key of requestedReviewKeys) {
            if (key === "scanResults" && candidate.scanResults) {
              restored.scanResults = candidate.scanResults
            } else if (key === SCAN_CHECKPOINT_KEY && candidate.checkpoint) {
              restored.scanCheckpoint = candidate.checkpoint
            } else if (
              key === "selections" &&
              candidate.scanResults &&
              Array.isArray(candidate.scanResults.groups)
            ) {
              if (hasValue(legacy, "selections")) {
                restored.selections =
                  legacy.selections as StoredState["selections"]
              }
            }
          }
        } else {
          this.legacyCandidates.delete(selectedProvider)
        }
      } else {
        this.legacyCandidates.delete(selectedProvider)
      }
    }

    return restored
  }

  async set(
    values: Record<string, unknown>,
    explicitProvider?: PhotoProvider
  ): Promise<void> {
    const settingsProvider = providerFromSettings(values.settings)
    const scanResultsProvider = providerFromScanResults(values.scanResults)
    const checkpointProvider = providerFromCheckpoint(
      values[SCAN_CHECKPOINT_KEY]
    )
    const provider =
      explicitProvider ??
      settingsProvider ??
      scanResultsProvider ??
      checkpointProvider ??
      this.options.getHostProvider() ??
      this.options.getActiveProvider()
    const next: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
      if (key === "settings") {
        next.settings = value
        next[ProviderScopedReviewStorage.key(provider, "settings")] = value
      } else if (REVIEW_KEYS.includes(key as ReviewKey)) {
        next[ProviderScopedReviewStorage.key(provider, key as ReviewKey)] =
          value
      }
    }
    if (Object.keys(next).length > 0) {
      await this.writeQueue(provider).run(() => this.storage.set(next))
    }
  }

  async remove(
    keys: string[],
    explicitProvider?: PhotoProvider
  ): Promise<void> {
    const provider =
      explicitProvider ??
      this.options.getHostProvider() ??
      this.options.getActiveProvider()
    const physicalKeys = keys
      .filter((key) => REVIEW_KEYS.includes(key as ReviewKey))
      .map((key) => ProviderScopedReviewStorage.key(provider, key as ReviewKey))
    if (physicalKeys.length > 0) {
      await this.writeQueue(provider).run(() =>
        this.storage.remove(physicalKeys)
      )
    }
  }

  async commitLegacyReviewMigration(
    provider: PhotoProvider,
    selection: LegacyReviewMigrationSelection,
    isCurrent: () => boolean = () => true
  ): Promise<void> {
    await this.writeQueue(provider).run(async () => {
      const candidate = this.legacyCandidates.get(provider)
      this.legacyCandidates.delete(provider)
      if (!candidate || !isCurrent()) return

      const currentLegacy = await this.storage.get(ALL_LEGACY_KEYS)
      if (
        !isCurrent() ||
        !storageValuesEqual(candidate.snapshot, currentLegacy, ALL_LEGACY_KEYS)
      ) {
        return
      }

      const keysToCheck: ReviewKey[] = [
        ...(selection.scanResults ? ["scanResults" as const] : []),
        ...(selection.checkpoint ? [SCAN_CHECKPOINT_KEY as ReviewKey] : [])
      ]
      if (keysToCheck.length === 0) return
      const targetKeys = keysToCheck.map((key) =>
        ProviderScopedReviewStorage.key(provider, key)
      )
      const markerKey = ProviderScopedReviewStorage.key(
        provider,
        "legacyMigrationComplete"
      )
      const currentTargets = await this.storage.get([...targetKeys, markerKey])
      if (!isCurrent() || currentTargets[markerKey] === true) return

      const next: Record<string, unknown> = {}
      for (const key of keysToCheck) {
        const targetKey = ProviderScopedReviewStorage.key(provider, key)
        if (hasValue(currentTargets, targetKey)) continue
        if (key === "scanResults" && candidate.scanResults) {
          next[targetKey] = candidate.scanResults
        } else if (key === SCAN_CHECKPOINT_KEY && candidate.checkpoint) {
          next[targetKey] = candidate.checkpoint
        }
      }
      if (Object.keys(next).length === 0) return
      if (!isCurrent()) return
      next[markerKey] = true
      await this.storage.set(next)
    })
  }
}
