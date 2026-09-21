import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { DuplicateReviewSession } from "../lib/duplicate-review-session"
import type { DuplicateTrashPlan } from "../lib/duplicate-review-session"
import {
  evaluateReviewPreflight,
  type ReviewPreflightResult
} from "../lib/review-preflight"
import {
  captureTrashDispatchAuthorization,
  isTrashDispatchAuthorizationCurrent,
  type TrashDispatchAuthorization
} from "../lib/trash-dispatch-guard"
import {
  TrashLifecycle,
  type TrashAuditAdapter,
  type TrashCommand,
  type TrashOutcome,
  type TrashProviderResultData,
  type TrashUndoData
} from "../lib/trash-lifecycle"
import type { DuplicateGroup, GpdMediaItem } from "../lib/types"
import {
  computeTraceSourceMetadata,
  TRACE_CONFIG_PATH,
  TRACE_MODEL_PATH
} from "./model/export-trace.mjs"

export interface ModelState {
  phase: string
  operation: string
  context: string
  selectionRevision: number
  confirmed: string[]
  requested: string[]
  confirmedContext: string
  confirmedRevision: number
  keepers: string[]
  manualTrashAll: boolean
  auditSaved: boolean
  dispatchedTargets: string[]
  dispatchedOperation: string
  dispatchedContext: string
  dispatchedRevision: number
  reported: string[]
  replyOperation: string
  moved: string[]
  undoTargets: string[]
  replyKind: string
  crashed: boolean
}

export interface ModelTraceState {
  index: number
  action: string
  actionLocation: string | null
  state: ModelState
}

export interface ModelTrace {
  traceId: string
  rawPath: string
  rawSha256: string
  rawBytes: number
  stateCount: number
  actions: string[]
  states: ModelTraceState[]
}

export interface ObservableProjection {
  [key: string]: unknown
}

export interface ReplayStep {
  index: number
  action: string
  modelState: ModelState
  status: "PASS" | "FAIL" | "UNSUPPORTED"
  expected?: ObservableProjection
  actual?: ObservableProjection
  mismatches: string[]
  unsupportedReason?: string
}

export interface NegativeDivergenceEvidence {
  status: "DETECTED" | "NOT_DETECTED"
  traceId: string | null
  stepIndex: number | null
  mutation: string
  mismatches: string[]
  expected?: ObservableProjection
  actual?: ObservableProjection
}

export interface ReplayReport {
  schemaVersion: 1
  artifactType: "photosweep.model-trace-replay"
  traceId: string
  rawSha256: string
  status: "PASS" | "PASS_WITH_UNSUPPORTED" | "FAIL"
  steps: ReplayStep[]
  counts: {
    total: number
    pass: number
    fail: number
    unsupported: number
  }
  actionsSeen: string[]
  unsupportedActions: string[]
  unsupportedAbstractions: Array<{ id: string; reason: string }>
  coverage: ReplayCoverage
  negativeControl: NegativeDivergenceEvidence
  provenance?: TraceReplayProvenance
  proofBoundary: string
}

export interface ReplayBundleReport {
  schemaVersion: 1
  artifactType: "photosweep.model-trace-replay-bundle"
  status: "PASS" | "PASS_WITH_UNSUPPORTED" | "FAIL"
  counts: {
    traces: number
    pass: number
    fail: number
    unsupported: number
  }
  unsupportedActions: string[]
  unsupportedReasons: Array<{ reason: string; count: number }>
  coverage: ReplayCoverage
  provenance?: TraceReplayProvenance
  reports: ReplayReport[]
  proofBoundary: string
}

export interface ReplayCoverage {
  actionCounts: Record<string, number>
  supportedActionCounts: Record<string, number>
  unsupportedActionCounts: Record<string, number>
  nonEmptyMovedReply: boolean
  undoWitness: boolean
  uncovered: string[]
  complete: boolean
}

export interface TraceReplaySourceFile {
  path: string
  sha256: string
  bytes: number
}

export interface TraceReplayProvenance {
  runId: string
  buildId: string
  source: {
    digest: string
    files: TraceReplaySourceFile[]
    buildId: string
    modulePath: string
    configPath: string
    moduleSha256: string
    configSha256: string
    git: {
      commit: string | null
      dirty: boolean
    }
  }
}

type ReplayFault = "drop-provider-confirmed-pair"

const MODEL_ITEMS = ["m1", "m2", "m3"]
const MODEL_FOREIGN = "foreign"
const REPLAY_NOW = 1_700_000_000_000
const REQUIRED_TRACE_ACTIONS = [
  "Confirm",
  "ManualTrashAllConfirm",
  "PersistAudit",
  "PersistAuditFailure",
  "Dispatch",
  "DriftSelection",
  "DriftContext",
  "StaleProviderReply",
  "ProviderSuccessEmpty",
  "ProviderSuccessSubset",
  "ProviderSuccessWithUnknown",
  "ProviderErrorPartial",
  "Timeout",
  "LateProviderReply",
  "DuplicateReply",
  "Undo",
  "Crash",
  "Recover"
]
const SUPPORTED_TRACE_ACTIONS = REQUIRED_TRACE_ACTIONS
const UNSUPPORTED_TRACE_ACTIONS: string[] = []

const UNSUPPORTED_ABSTRACTIONS = [
  {
    id: "crossed-identity-pair",
    reason:
      "TrashLifecycle can observe parallel media and dedup identity lists, but the TLA+ model stores one item set and cannot express a crossed media/dedup pair. The existing crossed-pair test remains outside this imported trace proof."
  }
]

function canonicalSourceJson(value: unknown): string {
  const canonicalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(canonicalize)
    if (current && typeof current === "object") {
      return Object.fromEntries(
        Object.entries(current)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, canonicalize(value)])
      )
    }
    return current
  }
  return JSON.stringify(canonicalize(value))
}

function sourceDigest(files: TraceReplaySourceFile[]): string {
  return createHash("sha256").update(canonicalSourceJson(files)).digest("hex")
}

export function verifyReplaySource(
  provenance: TraceReplayProvenance | null | undefined,
  { root = process.cwd() }: { root?: string } = {}
): { ok: boolean; errors: string[]; digest: string | null } {
  const errors: string[] = []
  if (!provenance || typeof provenance !== "object") {
    return {
      ok: false,
      errors: ["Replay provenance is missing or malformed."],
      digest: null
    }
  }
  if (typeof provenance.runId !== "string" || provenance.runId.length === 0) {
    errors.push("Replay provenance runId is missing or malformed.")
  }
  if (
    typeof provenance.buildId !== "string" ||
    provenance.buildId.length === 0
  ) {
    errors.push("Replay provenance buildId is missing or malformed.")
  }
  const source = provenance.source
  if (!source || typeof source !== "object") {
    return {
      ok: false,
      errors: [...errors, "Replay provenance source metadata is missing."],
      digest: null
    }
  }
  if (!Array.isArray(source.files) || source.files.length === 0) {
    return {
      ok: false,
      errors: [
        ...errors,
        "Replay provenance source file list is missing or empty."
      ],
      digest: null
    }
  }
  const seenPaths = new Set<string>()
  for (const file of source.files) {
    if (!file || typeof file !== "object") {
      errors.push("Replay provenance contains a malformed source file record.")
      continue
    }
    if (typeof file.path !== "string" || file.path.length === 0) {
      errors.push("Replay provenance contains a source file without a path.")
    } else if (seenPaths.has(file.path)) {
      errors.push(
        `Replay provenance contains a duplicate source path: ${file.path}`
      )
    } else {
      seenPaths.add(file.path)
    }
    if (
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      errors.push(
        `Replay provenance source hash is missing or malformed: ${String(file.path)}`
      )
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      errors.push(
        `Replay provenance source byte count is missing or malformed: ${String(file.path)}`
      )
    }
  }
  if (typeof source.digest !== "string" || source.digest.length === 0) {
    errors.push("Replay provenance source digest is missing or malformed.")
  }
  if (typeof source.modulePath !== "string") {
    errors.push("Replay provenance model module path is missing or malformed.")
  }
  if (typeof source.configPath !== "string") {
    errors.push("Replay provenance model config path is missing or malformed.")
  }
  if (
    typeof source.moduleSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(source.moduleSha256)
  ) {
    errors.push("Replay provenance moduleSha256 is missing or malformed.")
  }
  if (
    typeof source.configSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(source.configSha256)
  ) {
    errors.push("Replay provenance configSha256 is missing or malformed.")
  }
  if (!source.git || typeof source.git !== "object") {
    errors.push("Replay provenance git metadata is missing or malformed.")
  } else {
    if (
      source.git.commit !== null &&
      (typeof source.git.commit !== "string" || source.git.commit.length === 0)
    ) {
      errors.push("Replay provenance git commit is missing or malformed.")
    }
    if (typeof source.git.dirty !== "boolean") {
      errors.push("Replay provenance git dirty flag is missing or malformed.")
    }
  }

  let expected: ReturnType<typeof computeTraceSourceMetadata>
  try {
    expected = computeTraceSourceMetadata(
      root,
      TRACE_MODEL_PATH,
      TRACE_CONFIG_PATH
    )
  } catch (error) {
    errors.push(
      `Required replay source metadata is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return { ok: false, errors, digest: null }
  }

  if (source.modulePath !== expected.modulePath) {
    errors.push("Replay provenance module path is not the required model path.")
  }
  if (source.configPath !== expected.configPath) {
    errors.push(
      "Replay provenance config path is not the required model config path."
    )
  }
  if (source.moduleSha256 !== expected.moduleSha256) {
    errors.push(
      "Replay provenance model module hash does not match current source."
    )
  }
  if (source.configSha256 !== expected.configSha256) {
    errors.push(
      "Replay provenance model config hash does not match current source."
    )
  }
  if (source.digest !== expected.digest) {
    errors.push(
      "Replay provenance source digest does not match current required sources."
    )
  }
  if (source.buildId !== expected.buildId) {
    errors.push(
      "Replay provenance source buildId does not match current source."
    )
  }
  if (provenance.buildId !== expected.buildId) {
    errors.push(
      "Replay provenance buildId is not bound to current source metadata."
    )
  }
  if (source.git?.commit !== expected.git.commit) {
    errors.push(
      "Replay provenance git commit does not match current source metadata."
    )
  }

  const expectedFiles = expected.files
  if (source.files.length !== expectedFiles.length) {
    errors.push(
      `Replay provenance source file count ${source.files.length} does not match required count ${expectedFiles.length}.`
    )
  }
  const observed: TraceReplaySourceFile[] = []
  const maxFiles = Math.max(source.files.length, expectedFiles.length)
  for (let index = 0; index < maxFiles; index += 1) {
    const file = source.files[index]
    const required = expectedFiles[index]
    if (!file || !required) continue
    if (file.path !== required.path) {
      errors.push(
        `Replay provenance source path ${String(file.path)} is unexpected; required ${required.path}.`
      )
      continue
    }
    if (file.sha256 !== required.sha256 || file.bytes !== required.bytes) {
      errors.push(`Replay provenance source digest changed: ${required.path}`)
    }
    try {
      const bytes = readFileSync(resolve(root, required.path))
      const observedFile = {
        path: required.path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength
      }
      observed.push(observedFile)
      if (
        observedFile.sha256 !== required.sha256 ||
        observedFile.bytes !== required.bytes
      ) {
        errors.push(`Source file changed during replay: ${required.path}`)
      }
    } catch (error) {
      errors.push(
        `Source file unavailable during replay: ${required.path}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
  const digest =
    observed.length === expectedFiles.length ? sourceDigest(observed) : null
  if (digest !== expected.digest) {
    errors.push("Replay source digest does not match the exported build.")
  }
  return { ok: errors.length === 0, errors, digest }
}

function requireReplaySource(
  provenance: TraceReplayProvenance | undefined,
  root: string
): void {
  if (!provenance) {
    throw new Error(
      "TLC replay requires a verified runId/buildId/source provenance record; fabricated or scenario-only JSON is not replay input."
    )
  }
  const result = verifyReplaySource(provenance, { root })
  if (!result.ok) throw new Error(result.errors.join(" "))
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string")
    throw new Error(`Model state ${field} is not a string.`)
  return value
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Model state ${field} is not a safe integer.`)
  }
  return value
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean")
    throw new Error(`Model state ${field} is not boolean.`)
  return value
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Model state ${field} is not a string set.`)
  }
  return [...value].sort()
}

export function normalizeModelState(
  value: Record<string, unknown>
): ModelState {
  return {
    phase: stringValue(value.phase, "phase"),
    operation: stringValue(value.operation, "operation"),
    context: stringValue(value.context, "context"),
    selectionRevision: numberValue(
      value.selectionRevision,
      "selectionRevision"
    ),
    confirmed: stringArray(value.confirmed, "confirmed"),
    requested: stringArray(value.requested, "requested"),
    confirmedContext: stringValue(value.confirmedContext, "confirmedContext"),
    confirmedRevision: numberValue(
      value.confirmedRevision,
      "confirmedRevision"
    ),
    keepers: stringArray(value.keepers, "keepers"),
    manualTrashAll: booleanValue(value.manualTrashAll, "manualTrashAll"),
    auditSaved: booleanValue(value.auditSaved, "auditSaved"),
    dispatchedTargets: stringArray(
      value.dispatchedTargets,
      "dispatchedTargets"
    ),
    dispatchedOperation: stringValue(
      value.dispatchedOperation,
      "dispatchedOperation"
    ),
    dispatchedContext: stringValue(
      value.dispatchedContext,
      "dispatchedContext"
    ),
    dispatchedRevision: numberValue(
      value.dispatchedRevision,
      "dispatchedRevision"
    ),
    reported: stringArray(value.reported, "reported"),
    replyOperation: stringValue(value.replyOperation, "replyOperation"),
    moved: stringArray(value.moved, "moved"),
    undoTargets: stringArray(value.undoTargets, "undoTargets"),
    replyKind: stringValue(value.replyKind, "replyKind"),
    crashed: booleanValue(value.crashed, "crashed")
  }
}

function equalArrays(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function exactProjectionEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => exactProjectionEqual(value, right[index]))
    )
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const leftKeys = Object.keys(leftRecord).sort()
    const rightKeys = Object.keys(rightRecord).sort()
    return (
      equalArrays(leftKeys, rightKeys) &&
      leftKeys.every((key) =>
        exactProjectionEqual(leftRecord[key], rightRecord[key])
      )
    )
  }
  return Object.is(left, right)
}

export function compareObservable(
  expected: ObservableProjection,
  actual: ObservableProjection
): string[] {
  return exactProjectionEqual(expected, actual)
    ? []
    : [
        `expected ${JSON.stringify(expected)} but observed ${JSON.stringify(actual)}`
      ]
}

function sorted(values: string[]): string[] {
  return [...values].sort()
}

function accountFor(context: string): string {
  return `${context.toLowerCase()}@model-trace.invalid`
}

function scopeFor(revision: number): string {
  return `model-scope-${revision}`
}

function mediaFor(item: string): string {
  return item === MODEL_FOREIGN ? "foreign-media" : item
}

function dedupFor(item: string): string {
  return item === MODEL_FOREIGN ? "foreign-dedup" : `d-${item}`
}

function mediaKeysFor(items: string[]): string[] {
  return sorted(items.map(mediaFor))
}

function dedupKeysFor(items: string[]): string[] {
  return sorted(items.map(dedupFor))
}

function mediaItem(
  mediaKey: string,
  provider: "google" = "google"
): GpdMediaItem {
  return {
    mediaKey,
    dedupKey: `d-${mediaKey}`,
    thumb: `https://example.invalid/${mediaKey}.jpg`,
    timestamp: 1,
    creationTimestamp: 1,
    provider,
    fileName: `${mediaKey}.jpg`
  }
}

function buildFixture(state: ModelState, manualTrashAll: boolean) {
  const mediaItems: Record<string, GpdMediaItem> = {}
  const groups: DuplicateGroup[] = []
  const keptOverrides: Record<string, Set<string>> = {}

  if (manualTrashAll) {
    for (const item of MODEL_ITEMS) mediaItems[item] = mediaItem(item)
    const group: DuplicateGroup = {
      id: "model-manual-trash-all",
      mediaKeys: [...MODEL_ITEMS],
      originalMediaKey: MODEL_ITEMS[0],
      similarity: 1
    }
    groups.push(group)
    keptOverrides[group.id] = new Set()
  } else {
    // One bounded item per selected group lets the adapter represent every
    // legal TLA requested subset, including a model state where an item is
    // neither requested nor named as a keeper. The model's keeper safety
    // invariant is checked separately below.
    for (const item of state.requested) {
      const keeper = `keeper-${item}`
      mediaItems[keeper] = mediaItem(keeper)
      mediaItems[item] = mediaItem(item)
      const group: DuplicateGroup = {
        id: `model-${item}`,
        mediaKeys: [keeper, item],
        originalMediaKey: keeper,
        similarity: 1
      }
      groups.push(group)
      keptOverrides[group.id] = new Set([keeper])
    }
  }

  const reviewSession = new DuplicateReviewSession({
    groups,
    mediaItems,
    selections: {
      selectedGroupIds: new Set(groups.map((group) => group.id)),
      reviewedGroupIds: new Set(groups.map((group) => group.id)),
      keptOverrides
    }
  })
  return {
    mediaItems,
    groups,
    reviewSession,
    plan: reviewSession.trashPlan(groups)
  }
}

interface AuditBuffer {
  adapter: TrashAuditAdapter
  preReports: unknown[]
  resultReports: unknown[]
}

function auditBuffer(failPre: boolean): AuditBuffer {
  const preReports: unknown[] = []
  const resultReports: unknown[] = []
  return {
    preReports,
    resultReports,
    adapter: {
      async savePreTrashReport(report) {
        if (failPre) throw new Error("model replay audit failure")
        preReports.push(report)
      },
      async saveTrashResultReport(report) {
        resultReports.push(report)
      }
    }
  }
}

function commandProjection(
  command: TrashCommand | null
): ObservableProjection | null {
  if (!command) return null
  return {
    operationId: command.operationId,
    provider: command.provider,
    totalToTrash: command.totalToTrash,
    dedupKeys: sorted(command.args.dedupKeys),
    mediaKeysToTrash: sorted(command.args.mediaKeysToTrash),
    batchSize: command.args.batchSize,
    batchPauseMs: command.args.batchPauseMs,
    retryCount: command.args.retryCount,
    retryBackoffMs: command.args.retryBackoffMs
  }
}

function modelCommandProjection(state: ModelState): ObservableProjection {
  return {
    operationId: state.dispatchedOperation,
    provider: "google",
    totalToTrash: state.dispatchedTargets.length,
    dedupKeys: dedupKeysFor(state.dispatchedTargets),
    mediaKeysToTrash: mediaKeysFor(state.dispatchedTargets),
    batchSize: 25,
    batchPauseMs: 0,
    retryCount: 0,
    retryBackoffMs: 0
  }
}

function expectedOutcomeKind(
  action: string,
  requested: string[],
  moved: string[]
): TrashOutcome["kind"] {
  if (moved.length === 0) return "failed"
  if (
    action === "ProviderErrorPartial" ||
    action === "ProviderSuccessWithUnknown" ||
    moved.length !== requested.length
  ) {
    return "partial"
  }
  return "complete"
}

function dropProviderConfirmedPair(
  data: TrashProviderResultData
): TrashProviderResultData {
  if (!data.trashedKeys?.length || !data.trashedDedupKeys?.length) {
    return data
  }
  return {
    ...data,
    trashedKeys: data.trashedKeys.slice(1),
    trashedDedupKeys: data.trashedDedupKeys.slice(1)
  }
}

function changedPlan(
  plan: DuplicateTrashPlan,
  action: string
): DuplicateTrashPlan {
  if (action === "DriftSelection") {
    return {
      ...plan,
      blockedGroupIds: [...plan.blockedGroupIds, "selection-drift"],
      blockedMediaKeys: [...plan.blockedMediaKeys, "selection-drift"]
    }
  }
  return plan
}

class ReplayAdapter {
  constructor(private readonly fault: ReplayFault | null = null) {}

  private audit: AuditBuffer = auditBuffer(false)
  private lifecycle = new TrashLifecycle(this.audit.adapter)
  private command: TrashCommand | null = null
  private plan: DuplicateTrashPlan | null = null
  private preflight: ReviewPreflightResult | null = null
  private dispatchAuthorization: TrashDispatchAuthorization | null = null
  private providerDispatched = false
  private lastMovedMediaKeys: string[] = []
  private lastMovedDedupKeys: string[] = []
  private lastOutcomeKind: TrashOutcome["kind"] | null = null
  private lastUndo: TrashUndoData | null = null
  private lastReplyOperation = ""
  private lastRequestId: string | null = null
  private auditFailure = false
  private crashed = false

  private freshLifecycle(failPre: boolean) {
    this.audit = auditBuffer(failPre)
    this.lifecycle = new TrashLifecycle(this.audit.adapter)
    this.command = null
    this.plan = null
    this.preflight = null
    this.dispatchAuthorization = null
    this.providerDispatched = false
    this.lastMovedMediaKeys = []
    this.lastMovedDedupKeys = []
    this.lastOutcomeKind = null
    this.lastUndo = null
    this.lastReplyOperation = ""
    this.lastRequestId = null
    this.auditFailure = failPre
    this.crashed = false
  }

  /**
   * TrashLifecycle keeps pending state private. Probe the public reconcile
   * seam after reset/completion so replay reports do not copy adapter state
   * into a claimed implementation observation.
   */
  private async noPendingProbe(): Promise<{
    pending: boolean
    outcomeKind: TrashOutcome["kind"]
  }> {
    const outcome = await this.lifecycle.reconcile({
      requestId: "__replay_probe__",
      success: true,
      data: {}
    })
    return {
      // The request-bound probe cannot consume a different pending operation.
      // isPending is a public lifecycle observation, not a private-field read.
      pending: this.lifecycle.isPending(),
      outcomeKind: outcome.kind
    }
  }

  private healthyPreflight(state: ModelState): ReviewPreflightResult {
    const email = accountFor(state.context)
    const scope = scopeFor(state.selectionRevision)
    return evaluateReviewPreflight({
      scanProvider: "google",
      currentProvider: "google",
      scanAccountEmail: email,
      currentAccountEmail: email,
      scanDate: REPLAY_NOW - 1_000,
      scanScopeFingerprint: scope,
      currentScopeFingerprint: scope,
      selectedCount: state.requested.length,
      connectionValidated: true,
      requireFreshScan: true,
      requireKnownScope: true,
      now: REPLAY_NOW
    })
  }

  private stepResult(
    index: number,
    action: string,
    state: ModelState,
    expected: ObservableProjection,
    actual: ObservableProjection
  ): ReplayStep {
    const mismatches = compareObservable(expected, actual)
    return {
      index,
      action,
      modelState: state,
      status: mismatches.length === 0 ? "PASS" : "FAIL",
      expected,
      actual,
      mismatches
    }
  }

  private unsupported(
    index: number,
    action: string,
    state: ModelState,
    reason: string
  ): ReplayStep {
    return {
      index,
      action,
      modelState: state,
      status: "UNSUPPORTED",
      mismatches: [],
      unsupportedReason: reason
    }
  }

  async apply(
    index: number,
    action: string,
    previous: ModelState | null,
    current: ModelState,
    auditFailureAhead: boolean
  ): Promise<ReplayStep> {
    if (action === "Init") {
      const noPending = await this.noPendingProbe()
      return this.stepResult(
        index,
        action,
        current,
        { pending: false, providerDispatched: false, movedMediaKeys: [] },
        {
          pending: noPending.pending,
          providerDispatched: false,
          movedMediaKeys: []
        }
      )
    }

    if (action === "Confirm" || action === "ManualTrashAllConfirm") {
      const modelKeeperSafety = current.requested.every(
        (item) => !current.keepers.includes(item)
      )
      if (!modelKeeperSafety) {
        return this.stepResult(
          index,
          action,
          current,
          { modelKeeperSafety: true },
          { modelKeeperSafety: false }
        )
      }
      // begin() combines the model's Confirm -> PersistAudit pair into one
      // atomic implementation call. StaleProviderReply is a model-only
      // observation that can occur between those actions, so look through
      // those no-op observations when selecting the audit failure branch.
      const shouldFailAudit = auditFailureAhead
      this.freshLifecycle(shouldFailAudit)
      const fixture = buildFixture(current, action === "ManualTrashAllConfirm")
      this.plan = fixture.plan
      this.preflight = this.healthyPreflight(current)
      let beginError = false
      try {
        this.command = await this.lifecycle.begin({
          plan: fixture.plan,
          reviewSession: fixture.reviewSession,
          groups: fixture.groups,
          snapshot: {
            mediaItems: fixture.mediaItems,
            groups: fixture.groups,
            totalItems: MODEL_ITEMS.length
          },
          batchPolicy: {
            batchSize: 25,
            batchPauseMs: 0,
            retryCount: 0,
            retryBackoffMs: 0
          },
          operationId: current.operation,
          requestId: `model-trash-${current.operation}`,
          accountEmail: accountFor(current.context),
          scopeFingerprint: scopeFor(current.selectionRevision),
          scopeLabel: `model context ${current.context}`
        })
      } catch {
        beginError = true
        this.command = null
      }
      this.auditFailure = shouldFailAudit
      this.lastRequestId = this.command?.requestId ?? null
      const actualKeepers = new Set(
        fixture.groups.flatMap((group) => [
          ...fixture.reviewSession.keptFor(group)
        ])
      )
      const actualTargets = new Set(this.command?.args.mediaKeysToTrash ?? [])
      const actualKeeperSafety = [...actualTargets].every(
        (mediaKey) => !actualKeepers.has(mediaKey)
      )
      const expected = {
        keeperSafety: modelKeeperSafety,
        preflightAllowed: true,
        preAuditReports: shouldFailAudit ? 0 : 1,
        commandAvailable: !shouldFailAudit,
        command: shouldFailAudit
          ? null
          : {
              operationId: current.operation,
              provider: "google",
              totalToTrash: current.requested.length,
              dedupKeys: dedupKeysFor(current.requested),
              mediaKeysToTrash: mediaKeysFor(current.requested),
              batchSize: 25,
              batchPauseMs: 0,
              retryCount: 0,
              retryBackoffMs: 0
            },
        beginError: shouldFailAudit
      }
      const actual = {
        keeperSafety: actualKeeperSafety,
        preflightAllowed: this.preflight.allowed,
        preAuditReports: this.audit.preReports.length,
        commandAvailable: Boolean(this.command),
        command: commandProjection(this.command),
        beginError
      }
      return this.stepResult(index, action, current, expected, actual)
    }

    if (action === "PersistAudit" || action === "PersistAuditFailure") {
      const expectedFailure = action === "PersistAuditFailure"
      const expected = expectedFailure
        ? { preAuditReports: 0, commandAvailable: false, beginError: true }
        : {
            preAuditReports: 1,
            commandAvailable: true,
            beginError: false,
            providerDispatched: false
          }
      const actual = expectedFailure
        ? {
            preAuditReports: this.audit.preReports.length,
            commandAvailable: Boolean(this.command),
            beginError: this.auditFailure
          }
        : {
            preAuditReports: this.audit.preReports.length,
            commandAvailable: Boolean(this.command),
            beginError: this.auditFailure,
            providerDispatched: this.providerDispatched
          }
      return this.stepResult(index, action, current, expected, actual)
    }

    if (action === "Dispatch") {
      if (!previous || previous.phase !== "audited") {
        return this.unsupported(
          index,
          action,
          current,
          "The imported model trace reaches Dispatch without the required audited model phase; this adapter has no model-aligned dispatch transition to compare."
        )
      }
      const expectedCommand = modelCommandProjection(current)
      if (!this.command || !this.plan) {
        return this.stepResult(
          index,
          action,
          current,
          {
            guardAllowed: true,
            providerDispatched: true,
            command: expectedCommand
          },
          {
            guardAllowed: false,
            providerDispatched: false,
            command: commandProjection(this.command)
          }
        )
      }
      const email = accountFor(previous.context)
      const scope = scopeFor(previous.selectionRevision)
      const expectedAuthorization = captureTrashDispatchAuthorization({
        generation: 1,
        plan: this.plan,
        provider: "google",
        accountEmail: email,
        scopeFingerprint: scope
      })
      const currentAuthorization = captureTrashDispatchAuthorization({
        generation: 1,
        plan: this.plan,
        provider: "google",
        accountEmail: email,
        scopeFingerprint: scope
      })
      const allowed = isTrashDispatchAuthorizationCurrent(
        expectedAuthorization,
        currentAuthorization
      )
      this.dispatchAuthorization = expectedAuthorization
      this.providerDispatched = allowed
      const actualCommand = commandProjection(this.command)
      return this.stepResult(
        index,
        action,
        current,
        {
          guardAllowed: true,
          providerDispatched: true,
          command: expectedCommand
        },
        {
          guardAllowed: allowed,
          providerDispatched: this.providerDispatched,
          command: actualCommand
        }
      )
    }

    if (
      action === "ProviderSuccessEmpty" ||
      action === "ProviderSuccessSubset" ||
      action === "ProviderSuccessWithUnknown" ||
      action === "ProviderErrorPartial"
    ) {
      if (!previous || previous.phase !== "dispatched") {
        return this.unsupported(
          index,
          action,
          current,
          "The provider reply is only replayable after this adapter has observed the actual Dispatch guard and command."
        )
      }
      if (!this.command || !this.providerDispatched) {
        const noPending = await this.noPendingProbe()
        const expectedMovedMedia = mediaKeysFor(current.moved)
        const expectedMovedDedup = dedupKeysFor(current.moved)
        const expectedKind = expectedOutcomeKind(
          action,
          previous.requested,
          current.moved
        )
        return this.stepResult(
          index,
          action,
          current,
          {
            replyOperation: current.replyOperation,
            movedMediaKeys: expectedMovedMedia,
            movedDedupKeys: expectedMovedDedup,
            outcomeKind: expectedKind,
            undoDedupKeys: current.moved.length > 0 ? expectedMovedDedup : null,
            pending: false,
            providerDispatched: true
          },
          {
            replyOperation: this.lastReplyOperation,
            movedMediaKeys: this.lastMovedMediaKeys,
            movedDedupKeys: this.lastMovedDedupKeys,
            outcomeKind: this.lastOutcomeKind,
            undoDedupKeys: this.lastUndo?.dedupKeys ?? null,
            pending: noPending.pending,
            providerDispatched: this.providerDispatched
          }
        )
      }
      const reported = action === "ProviderSuccessEmpty" ? [] : current.reported
      const data: TrashProviderResultData =
        action === "ProviderSuccessEmpty"
          ? {}
          : {
              trashedKeys: mediaKeysFor(reported),
              trashedDedupKeys: dedupKeysFor(reported),
              ...(action === "ProviderErrorPartial"
                ? { partial: true, retryAttempts: 1 }
                : {})
            }
      const reconcileData =
        this.fault === "drop-provider-confirmed-pair"
          ? dropProviderConfirmedPair(data)
          : data
      const operationId = this.command.operationId
      const outcome = await this.lifecycle.reconcile({
        requestId: this.command.requestId,
        success: action !== "ProviderErrorPartial",
        data: reconcileData,
        ...(action === "ProviderErrorPartial"
          ? { error: "model provider stopped" }
          : {})
      })
      this.lastReplyOperation = operationId
      const lifecycleMovedMediaKeys = sorted(outcome.movedMediaKeys)
      this.lastMovedMediaKeys = lifecycleMovedMediaKeys
      this.lastMovedDedupKeys = sorted(outcome.movedDedupKeys)
      this.lastOutcomeKind = outcome.kind
      this.lastUndo = outcome.undo
      this.command = null
      const noPending = await this.noPendingProbe()
      const expectedMovedMedia = mediaKeysFor(current.moved)
      const expectedMovedDedup = dedupKeysFor(current.moved)
      const expectedKind = expectedOutcomeKind(
        action,
        previous.requested,
        current.moved
      )
      const expected = {
        replyOperation: current.replyOperation,
        movedMediaKeys: expectedMovedMedia,
        movedDedupKeys: expectedMovedDedup,
        outcomeKind: expectedKind,
        undoDedupKeys: current.moved.length > 0 ? expectedMovedDedup : null,
        pending: false,
        providerDispatched: true
      }
      const actual = {
        replyOperation: this.lastReplyOperation,
        movedMediaKeys: this.lastMovedMediaKeys,
        movedDedupKeys: this.lastMovedDedupKeys,
        outcomeKind: outcome.kind,
        undoDedupKeys: outcome.undo?.dedupKeys ?? null,
        pending: noPending.pending,
        providerDispatched: this.providerDispatched
      }
      return this.stepResult(index, action, current, expected, actual)
    }

    if (action === "DuplicateReply") {
      if (
        !previous ||
        previous.phase !== "reconciled" ||
        !this.lastReplyOperation
      ) {
        return this.unsupported(
          index,
          action,
          current,
          "A duplicate reply has no actual completed TrashLifecycle operation to compare."
        )
      }
      const resultReportCount = this.audit.resultReports.length
      const duplicate = await this.lifecycle.reconcile({
        requestId: this.lastRequestId ?? "__replay_duplicate__",
        success: true,
        data: {
          trashedKeys: ["foreign-media"],
          trashedDedupKeys: ["foreign-dedup"]
        }
      })
      const expected = {
        movedMediaKeys: mediaKeysFor(current.moved),
        movedDedupKeys: dedupKeysFor(current.moved),
        duplicateOutcomeKind: "failed",
        duplicateMovedCount: 0,
        pending: false
      }
      const actual = {
        movedMediaKeys: this.lastMovedMediaKeys,
        movedDedupKeys: this.lastMovedDedupKeys,
        duplicateOutcomeKind: duplicate.kind,
        duplicateMovedCount: duplicate.movedCount,
        pending: this.audit.resultReports.length !== resultReportCount
      }
      return this.stepResult(index, action, current, expected, actual)
    }

    if (action === "Undo") {
      if (!previous || previous.phase !== "reconciled" || !this.lastUndo) {
        return this.unsupported(
          index,
          action,
          current,
          "Undo is only replayable after an actual provider-confirmed moved set produced Undo data."
        )
      }
      const command = this.lifecycle.beginRestore(
        this.lastUndo,
        `model-restore-${this.lastReplyOperation}`
      )
      const expected = {
        undoTargets: dedupKeysFor(current.undoTargets),
        undoCommandDedupKeys: dedupKeysFor(current.undoTargets),
        provider: "google"
      }
      const actual = {
        undoTargets: sorted(command.args.dedupKeys),
        undoCommandDedupKeys: sorted(command.args.dedupKeys),
        provider: command.provider
      }
      return this.stepResult(index, action, current, expected, actual)
    }

    if (action === "DriftSelection" || action === "DriftContext") {
      if (
        !previous ||
        !["confirmed", "audited", "dispatched", "ambiguous"].includes(
          previous.phase
        ) ||
        !this.plan
      ) {
        return this.unsupported(
          index,
          action,
          current,
          previous?.phase === "dispatched"
            ? "Selection/context drift occurs after the provider command was dispatched. The current app has no cancellation proof for an already-sent provider request."
            : "The model drift action is not aligned with an actual pending lifecycle operation in this trace."
        )
      }
      const previousEmail = accountFor(previous.context)
      const currentEmail = accountFor(current.context)
      const previousScope = scopeFor(previous.selectionRevision)
      const currentScope = scopeFor(current.selectionRevision)
      const driftPreflight = evaluateReviewPreflight({
        scanProvider: "google",
        currentProvider: "google",
        scanAccountEmail: previousEmail,
        currentAccountEmail:
          action === "DriftContext" ? currentEmail : previousEmail,
        scanDate: REPLAY_NOW - 1_000,
        scanScopeFingerprint: previousScope,
        currentScopeFingerprint: currentScope,
        selectedCount: previous.requested.length,
        connectionValidated: true,
        requireFreshScan: true,
        requireKnownScope: true,
        now: REPLAY_NOW
      })
      const expectedAuthorization = captureTrashDispatchAuthorization({
        generation: 1,
        plan: this.plan,
        provider: "google",
        accountEmail: previousEmail,
        scopeFingerprint: previousScope
      })
      const currentAuthorization = captureTrashDispatchAuthorization({
        generation: 1,
        plan: changedPlan(this.plan, action),
        provider: "google",
        accountEmail: action === "DriftContext" ? currentEmail : previousEmail,
        scopeFingerprint: currentScope
      })
      const guardAllowed = isTrashDispatchAuthorizationCurrent(
        expectedAuthorization,
        currentAuthorization
      )
      if (this.command) {
        this.lifecycle.cancel(this.command.requestId)
      } else {
        this.lifecycle.reset()
      }
      this.command = null
      this.plan = null
      this.preflight = driftPreflight
      this.dispatchAuthorization = expectedAuthorization
      this.providerDispatched = false
      this.lastMovedMediaKeys = []
      this.lastMovedDedupKeys = []
      this.lastOutcomeKind = null
      this.lastUndo = null
      const noPending = await this.noPendingProbe()
      const expected = {
        guardAllowed: false,
        preflightAllowed: false,
        pending: false,
        providerDispatched: false,
        movedMediaKeys: mediaKeysFor(current.moved)
      }
      const actual = {
        guardAllowed,
        preflightAllowed: driftPreflight.allowed,
        pending: noPending.pending,
        providerDispatched: this.providerDispatched,
        movedMediaKeys: this.lastMovedMediaKeys
      }
      return this.stepResult(index, action, current, expected, actual)
    }

    if (action === "Crash") {
      if (
        !previous ||
        !["confirmed", "audited", "dispatched", "ambiguous"].includes(
          previous.phase
        )
      ) {
        return this.unsupported(
          index,
          action,
          current,
          "Crash is only replayable while a review, audit, dispatched, or ambiguous lifecycle operation is active."
        )
      }
      if (this.command) {
        this.lifecycle.cancel(this.command.requestId)
      } else {
        this.lifecycle.reset()
      }
      this.command = null
      this.plan = null
      this.providerDispatched = false
      this.dispatchAuthorization = null
      this.crashed = true
      const noPending = await this.noPendingProbe()
      const expected = {
        pending: false,
        providerDispatched: false,
        crashed: true,
        movedMediaKeys: mediaKeysFor(current.moved)
      }
      const actual = {
        pending: noPending.pending,
        providerDispatched: this.providerDispatched,
        crashed: this.crashed,
        movedMediaKeys: this.lastMovedMediaKeys
      }
      return this.stepResult(index, action, current, expected, actual)
    }

    if (action === "Recover") {
      if (!previous || previous.phase !== "restarted" || !this.crashed) {
        return this.unsupported(
          index,
          action,
          current,
          "Recover is only replayable after a supported pre-dispatch Crash/reset seam."
        )
      }
      this.lifecycle.reset()
      this.command = null
      this.plan = null
      this.providerDispatched = false
      this.crashed = false
      this.lastMovedMediaKeys = []
      this.lastMovedDedupKeys = []
      const noPending = await this.noPendingProbe()
      const expected = {
        pending: false,
        providerDispatched: false,
        crashed: false,
        movedMediaKeys: []
      }
      const actual = {
        pending: noPending.pending,
        providerDispatched: this.providerDispatched,
        crashed: this.crashed,
        movedMediaKeys: this.lastMovedMediaKeys
      }
      return this.stepResult(index, action, current, expected, actual)
    }

    if (action === "Timeout") {
      if (
        !previous ||
        previous.phase !== "dispatched" ||
        !this.command ||
        !this.providerDispatched
      ) {
        return this.unsupported(
          index,
          action,
          current,
          "Timeout is only replayable after this adapter has observed the actual dispatched request."
        )
      }
      const requestId = this.command.requestId
      const outcome = await this.lifecycle.timeout({
        requestId,
        error: "model provider timeout"
      })
      const actual = {
        pending: this.lifecycle.isPending(requestId),
        providerDispatched: this.providerDispatched,
        timeoutRecorded: outcome.kind === "failed"
      }
      return this.stepResult(
        index,
        action,
        current,
        { pending: true, providerDispatched: true, timeoutRecorded: true },
        actual
      )
    }

    if (action === "LateProviderReply") {
      if (
        !previous ||
        previous.phase !== "ambiguous" ||
        !this.command ||
        !this.providerDispatched
      ) {
        return this.unsupported(
          index,
          action,
          current,
          "A late provider reply is only replayable after this adapter has recorded the matching request timeout."
        )
      }
      const command = this.command
      const outcome = await this.lifecycle.reconcile({
        requestId: command.requestId,
        success: true,
        data: {
          trashedKeys: mediaKeysFor(current.reported),
          trashedDedupKeys: dedupKeysFor(current.reported)
        }
      })
      this.lastReplyOperation = command.operationId
      this.lastMovedMediaKeys = sorted(outcome.movedMediaKeys)
      this.lastMovedDedupKeys = sorted(outcome.movedDedupKeys)
      this.lastOutcomeKind = outcome.kind
      this.lastUndo = outcome.undo
      this.command = null
      const noPending = await this.noPendingProbe()
      const expected = {
        replyOperation: current.replyOperation,
        movedMediaKeys: mediaKeysFor(current.moved),
        movedDedupKeys: dedupKeysFor(current.moved),
        outcomeKind: expectedOutcomeKind(
          "ProviderSuccessSubset",
          previous.requested,
          current.moved
        ),
        undoDedupKeys:
          current.moved.length > 0 ? dedupKeysFor(current.moved) : null,
        pending: false,
        providerDispatched: true
      }
      const actual = {
        replyOperation: this.lastReplyOperation,
        movedMediaKeys: this.lastMovedMediaKeys,
        movedDedupKeys: this.lastMovedDedupKeys,
        outcomeKind: this.lastOutcomeKind,
        undoDedupKeys: this.lastUndo?.dedupKeys ?? null,
        pending: noPending.pending,
        providerDispatched: this.providerDispatched
      }
      return this.stepResult(index, action, current, expected, actual)
    }

    if (action === "StaleProviderReply") {
      const currentRequestId = this.command?.requestId
      const staleRequestId =
        this.lastRequestId && this.lastRequestId !== currentRequestId
          ? this.lastRequestId
          : `model-stale-${current.operation || "unknown"}`
      const stale = await this.lifecycle.reconcile({
        requestId: staleRequestId,
        success: true,
        data: {
          trashedKeys: [MODEL_FOREIGN],
          trashedDedupKeys: [MODEL_FOREIGN]
        }
      })
      const expected = {
        staleIgnored: true,
        pending: Boolean(this.command),
        providerDispatched: this.providerDispatched,
        movedMediaKeys: mediaKeysFor(current.moved)
      }
      const actual = {
        staleIgnored: stale.kind === "failed",
        pending: this.lifecycle.isPending(),
        providerDispatched: this.providerDispatched,
        movedMediaKeys: this.lastMovedMediaKeys
      }
      return this.stepResult(index, action, current, expected, actual)
    }

    return this.unsupported(index, action, current, "Unknown TLC action.")
  }
}

async function replayTraceSteps(
  trace: ModelTrace,
  adapter: ReplayAdapter
): Promise<ReplayStep[]> {
  const steps: ReplayStep[] = []
  for (let index = 0; index < trace.states.length; index++) {
    const currentRecord = trace.states[index]
    const previousRecord = trace.states[index - 1]
    const current = normalizeModelState(
      currentRecord.state as unknown as Record<string, unknown>
    )
    const previous = previousRecord
      ? normalizeModelState(
          previousRecord.state as unknown as Record<string, unknown>
        )
      : null
    const auditFailureAhead =
      current.phase === "confirmed"
        ? auditFailureBeforePhaseChange(trace.states, index)
        : false
    steps.push(
      await adapter.apply(
        currentRecord.index,
        currentRecord.action,
        previous,
        current,
        auditFailureAhead
      )
    )
  }
  return steps
}

async function negativeControl(
  trace: ModelTrace
): Promise<NegativeDivergenceEvidence> {
  const faultedSteps = await replayTraceSteps(
    trace,
    new ReplayAdapter("drop-provider-confirmed-pair")
  )
  const candidate = faultedSteps.find(
    (step) =>
      step.status === "FAIL" &&
      step.actual &&
      step.expected &&
      Array.isArray(step.actual.movedMediaKeys) &&
      step.modelState.moved.length > 0 &&
      step.action.startsWith("Provider") &&
      step.action !== "ProviderSuccessEmpty"
  )
  if (!candidate || !candidate.actual || !candidate.expected) {
    return {
      status: "NOT_DETECTED",
      traceId: trace.traceId,
      stepIndex: null,
      mutation:
        "test-only provider fault: removed one confirmed media/dedup pair before TrashLifecycle.reconcile",
      mismatches: [
        "No supported nonempty moved-set step was available for the negative demonstration."
      ]
    }
  }
  return {
    status: "DETECTED",
    traceId: trace.traceId,
    stepIndex: candidate.index,
    mutation:
      "test-only provider fault: removed one confirmed media/dedup pair before TrashLifecycle.reconcile",
    mismatches: candidate.mismatches,
    expected: candidate.expected,
    actual: candidate.actual
  }
}

function buildCoverage(steps: ReplayStep[], actions: string[]): ReplayCoverage {
  const actionCounts: Record<string, number> = {}
  for (const action of REQUIRED_TRACE_ACTIONS) actionCounts[action] = 0
  for (const action of actions)
    actionCounts[action] = (actionCounts[action] ?? 0) + 1
  const supportedActionCounts: Record<string, number> = {}
  for (const action of SUPPORTED_TRACE_ACTIONS)
    supportedActionCounts[action] = 0
  const unsupportedActionCounts: Record<string, number> = {}
  for (const action of REQUIRED_TRACE_ACTIONS) {
    unsupportedActionCounts[action] = 0
  }
  for (const step of steps) {
    if (
      step.status === "PASS" &&
      SUPPORTED_TRACE_ACTIONS.includes(step.action)
    ) {
      supportedActionCounts[step.action] += 1
    }
    if (step.status === "UNSUPPORTED") {
      unsupportedActionCounts[step.action] += 1
    }
  }
  const nonEmptyMovedReply = steps.some(
    (step) =>
      step.status === "PASS" &&
      step.action.startsWith("Provider") &&
      step.modelState.moved.length > 0
  )
  const undoWitness = steps.some(
    (step) =>
      step.status === "PASS" &&
      step.action === "Undo" &&
      step.modelState.undoTargets.length > 0
  )
  const uncovered = SUPPORTED_TRACE_ACTIONS.filter(
    (action) => (supportedActionCounts[action] ?? 0) === 0
  )
  if (!nonEmptyMovedReply)
    uncovered.push("non-empty provider moved-set witness")
  if (!undoWitness) uncovered.push("non-empty Undo witness")
  return {
    actionCounts,
    supportedActionCounts,
    unsupportedActionCounts,
    nonEmptyMovedReply,
    undoWitness,
    uncovered,
    complete: uncovered.length === 0
  }
}

function auditFailureBeforePhaseChange(
  states: ModelTraceState[],
  index: number
): boolean {
  for (let cursor = index + 1; cursor < states.length; cursor++) {
    const action = states[cursor].action
    const state = normalizeModelState(
      states[cursor].state as unknown as Record<string, unknown>
    )
    if (action === "StaleProviderReply" && state.phase === "confirmed") {
      continue
    }
    return action === "PersistAuditFailure"
  }
  return false
}

export async function replayTrace(
  trace: ModelTrace,
  options: { provenance?: TraceReplayProvenance; root?: string } = {}
): Promise<ReplayReport> {
  requireReplaySource(options.provenance, options.root ?? process.cwd())
  if (!Array.isArray(trace.states) || trace.states.length === 0) {
    throw new Error(`Trace ${trace.traceId} has no states.`)
  }
  const steps = await replayTraceSteps(trace, new ReplayAdapter())
  const counts = {
    total: steps.length,
    pass: steps.filter((step) => step.status === "PASS").length,
    fail: steps.filter((step) => step.status === "FAIL").length,
    unsupported: steps.filter((step) => step.status === "UNSUPPORTED").length
  }
  const unsupportedActions = sorted([
    ...new Set(
      steps
        .filter((step) => step.status === "UNSUPPORTED")
        .map((step) => step.action)
    )
  ])
  const coverage = buildCoverage(steps, trace.actions)
  const negative = await negativeControl(trace)
  const report: ReplayReport = {
    schemaVersion: 1,
    artifactType: "photosweep.model-trace-replay",
    traceId: trace.traceId,
    rawSha256: trace.rawSha256,
    status:
      counts.fail > 0
        ? "FAIL"
        : counts.unsupported > 0 || !coverage.complete
          ? "PASS_WITH_UNSUPPORTED"
          : "PASS",
    steps,
    counts,
    actionsSeen: sorted([...new Set(trace.actions)]),
    unsupportedActions,
    unsupportedAbstractions: UNSUPPORTED_ABSTRACTIONS,
    coverage,
    negativeControl: negative,
    proofBoundary:
      "Each PASS step compares a finite TLC state transition with an actual TypeScript seam result. The request-bound timeout, late/stale reply, and local cancellation seams are covered; the crossed-pair model limit and external provider behavior remain outside this bounded proof."
  }
  if (options.provenance) {
    report.provenance = {
      runId: options.provenance.runId,
      buildId: options.provenance.buildId,
      source: options.provenance.source
    }
  }
  requireReplaySource(options.provenance, options.root ?? process.cwd())
  return report
}

export async function replayTraceBundle(
  traces: ModelTrace[],
  options: {
    requireNoFailures?: boolean
    requireCoverage?: boolean
    provenance?: TraceReplayProvenance
    root?: string
    reportPath?: string
  } = {}
): Promise<ReplayBundleReport> {
  requireReplaySource(options.provenance, options.root ?? process.cwd())
  const reports = []
  for (const trace of traces) {
    reports.push(
      await replayTrace(trace, {
        provenance: options.provenance,
        root: options.root
      })
    )
  }
  const counts = reports.reduce(
    (sum, report) => ({
      traces: sum.traces + 1,
      pass: sum.pass + report.counts.pass,
      fail: sum.fail + report.counts.fail,
      unsupported: sum.unsupported + report.counts.unsupported
    }),
    { traces: 0, pass: 0, fail: 0, unsupported: 0 }
  )
  const actionCounts: Record<string, number> = {}
  for (const action of REQUIRED_TRACE_ACTIONS) actionCounts[action] = 0
  const supportedActionCounts: Record<string, number> = {}
  for (const action of SUPPORTED_TRACE_ACTIONS)
    supportedActionCounts[action] = 0
  const unsupportedActionCounts: Record<string, number> = {}
  for (const action of UNSUPPORTED_TRACE_ACTIONS) {
    unsupportedActionCounts[action] = 0
  }
  for (const report of reports) {
    for (const [action, count] of Object.entries(
      report.coverage.actionCounts
    )) {
      actionCounts[action] = (actionCounts[action] ?? 0) + Number(count)
    }
    for (const [action, count] of Object.entries(
      report.coverage.supportedActionCounts
    )) {
      supportedActionCounts[action] =
        (supportedActionCounts[action] ?? 0) + Number(count)
    }
    for (const [action, count] of Object.entries(
      report.coverage.unsupportedActionCounts
    )) {
      unsupportedActionCounts[action] =
        (unsupportedActionCounts[action] ?? 0) + Number(count)
    }
  }
  const nonEmptyMovedReply = reports.some(
    (report) => report.coverage.nonEmptyMovedReply
  )
  const undoWitness = reports.some((report) => report.coverage.undoWitness)
  const uncovered = SUPPORTED_TRACE_ACTIONS.filter(
    (action) => supportedActionCounts[action] === 0
  )
  if (!nonEmptyMovedReply)
    uncovered.push("non-empty provider moved-set witness")
  if (!undoWitness) uncovered.push("non-empty Undo witness")
  const coverage: ReplayCoverage = {
    actionCounts,
    supportedActionCounts,
    unsupportedActionCounts,
    nonEmptyMovedReply,
    undoWitness,
    uncovered,
    complete: uncovered.length === 0
  }
  const unsupportedActions = sorted([
    ...new Set(reports.flatMap((report) => report.unsupportedActions))
  ])
  const unsupportedReasonCounts = new Map<string, number>()
  for (const report of reports) {
    for (const step of report.steps) {
      if (step.status !== "UNSUPPORTED") continue
      const reason = step.unsupportedReason ?? "unspecified"
      unsupportedReasonCounts.set(
        reason,
        (unsupportedReasonCounts.get(reason) ?? 0) + 1
      )
    }
  }
  const status =
    counts.fail > 0
      ? "FAIL"
      : counts.unsupported > 0 || !coverage.complete
        ? "PASS_WITH_UNSUPPORTED"
        : "PASS"
  const result: ReplayBundleReport = {
    schemaVersion: 1,
    artifactType: "photosweep.model-trace-replay-bundle",
    status,
    counts,
    unsupportedActions,
    unsupportedReasons: [...unsupportedReasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort(
        (left, right) =>
          right.count - left.count || left.reason.localeCompare(right.reason)
      ),
    coverage,
    provenance: options.provenance
      ? {
          runId: options.provenance.runId,
          buildId: options.provenance.buildId,
          source: options.provenance.source
        }
      : undefined,
    reports,
    proofBoundary:
      "This artifact records bounded replay of imported TLC simulation modules against selected TypeScript seams. It is not an unbounded refinement proof or a whole-application theorem."
  }
  if (options.reportPath) {
    writeFileSync(options.reportPath, `${JSON.stringify(result, null, 2)}\n`)
  }
  if (options.requireNoFailures && counts.fail > 0) {
    throw new Error(`Model trace replay found ${counts.fail} failing steps.`)
  }
  if (options.requireCoverage && !coverage.complete) {
    throw new Error(
      `Model trace replay coverage is incomplete: ${coverage.uncovered.join(", ")}`
    )
  }
  requireReplaySource(options.provenance, options.root ?? process.cwd())
  return result
}

export function writeReplayBundleReport(
  path: string,
  report: ReplayBundleReport
): void {
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
}
