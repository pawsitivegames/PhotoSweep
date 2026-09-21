import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"

import {
  computeSourceFingerprint,
  isSafeRelativePath
} from "./source-fingerprint.mjs"

export const EVIDENCE_SCHEMA_VERSION = 1
const SCOPE_ORDER = ["fast", "nightly", "release"]
const CHECK_KINDS = new Set(["test", "model", "mutation", "benchmark", "browser", "package-audit", "provider-fixture"])
const PROOF_CLASSES = new Set([
  "implementation",
  "finite-model",
  "browser-boundary",
  "provider-contract",
  "labeled-corpus",
  "fault-injection",
  "production-package",
  "mutation",
  "performance",
  "evidence-integrity",
  "message-boundary",
  "baseline",
  "live-provider"
])
const OBLIGATION_KINDS = new Set([
  ...CHECK_KINDS,
  "inventory"
])

export function validateRegistry(registry) {
  const errors = []
  if (!registry || registry.schemaVersion !== 1) {
    return [{ code: "REGISTRY_INVALID", message: "Unsupported requirements registry." }]
  }
  if (!Array.isArray(registry.properties) || registry.properties.length === 0) {
    errors.push({ code: "REGISTRY_EMPTY", message: "Requirements registry has no properties." })
  }
  if (!registry.scopes || typeof registry.scopes !== "object") {
    errors.push({ code: "SCOPES_MISSING", message: "Requirements registry has no scopes." })
  }
  const propertyIds = new Set()
  const obligationIds = new Set()
  for (const property of registry.properties ?? []) {
    if (!property || typeof property !== "object" || typeof property.id !== "string" || property.id.length === 0) {
      errors.push({ code: "PROPERTY_ID_INVALID", message: "Every registry property needs a string id." })
      continue
    }
    if (propertyIds.has(property.id)) {
      errors.push({ code: "PROPERTY_ID_DUPLICATE", message: `Duplicate registry property id: ${property.id}` })
    }
    propertyIds.add(property.id)
    if (!Array.isArray(property.obligations) || property.obligations.length === 0) {
      errors.push({ code: "PROPERTY_OBLIGATIONS_MISSING", message: `Property ${property.id} has no obligations.` })
      continue
    }
    for (const obligation of property.obligations) {
      if (!obligation || typeof obligation !== "object" || typeof obligation.id !== "string" || obligation.id.length === 0) {
        errors.push({ code: "OBLIGATION_ID_INVALID", message: `Property ${property.id} has an invalid obligation id.` })
        continue
      }
      if (obligationIds.has(obligation.id)) {
        errors.push({ code: "OBLIGATION_ID_DUPLICATE", message: `Duplicate registry obligation id: ${obligation.id}` })
      }
      obligationIds.add(obligation.id)
      if (!SCOPE_ORDER.includes(obligation.scope)) {
        errors.push({ code: "OBLIGATION_SCOPE_INVALID", message: `${obligation.id} uses unknown scope ${String(obligation.scope)}.` })
      }
      if (!PROOF_CLASSES.has(obligation.proofClass)) {
        errors.push({ code: "PROOF_CLASS_INVALID", message: `${obligation.id} uses unknown proof class ${String(obligation.proofClass)}.` })
      }
      if (!OBLIGATION_KINDS.has(obligation.kind)) {
        errors.push({ code: "OBLIGATION_KIND_INVALID", message: `${obligation.id} uses unknown kind ${String(obligation.kind)}.` })
      }
      if (typeof obligation.command !== "string" || typeof obligation.artifact !== "string" || typeof obligation.mandatory !== "boolean") {
        errors.push({ code: "OBLIGATION_METADATA_INVALID", message: `${obligation.id} has incomplete command, artifact, or mandatory metadata.` })
      }
    }
  }
  for (const scope of Object.keys(registry.scopes ?? {})) {
    const inherited = registry.scopes[scope]?.inherits
    if (!Array.isArray(inherited)) {
      errors.push({ code: "SCOPE_INHERITS_INVALID", message: `${scope} must define an inherits array.` })
    }
    for (const parent of inherited ?? []) {
      if (!registry.scopes[parent]) {
        errors.push({ code: "SCOPE_PARENT_UNKNOWN", message: `${scope} inherits unknown scope ${parent}.` })
      }
    }
  }
  if (obligationIds.size === 0) {
    errors.push({ code: "REGISTRY_NO_OBLIGATIONS", message: "Requirements registry has no obligations." })
  }
  return errors
}

function scopeAncestors(registry, scope, seen = new Set()) {
  if (seen.has(scope)) throw new Error(`Scope inheritance cycle at ${scope}`)
  seen.add(scope)
  const definition = registry.scopes?.[scope]
  if (!definition) throw new Error(`Unknown verification scope: ${scope}`)
  const parents = Array.isArray(definition.inherits)
    ? definition.inherits
    : []
  const result = new Set([scope])
  for (const parent of parents) {
    for (const ancestor of scopeAncestors(registry, parent, new Set(seen))) {
      result.add(ancestor)
    }
  }
  return result
}

export function expectedObligations(registry, scope) {
  const activeScopes = scopeAncestors(registry, scope)
  const obligations = []
  for (const property of registry.properties ?? []) {
    for (const obligation of property.obligations ?? []) {
      if (!activeScopes.has(obligation.scope)) continue
      obligations.push({
        ...obligation,
        requirementId: property.id
      })
    }
  }
  return obligations
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function error(errors, code, obligationId, message, blocked = false) {
  errors.push({ code, obligationId, message, blocked })
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function validateEntry(entry, obligation, root, expectedSourceFingerprint, errors) {
  const id = obligation.id
  if (!entry || typeof entry !== "object") {
    error(errors, "MISSING_ENTRY", id, "Evidence entry is missing or not an object.")
    return
  }
  if (entry.requirementId !== obligation.requirementId) {
    error(
      errors,
      "REQUIREMENT_MISMATCH",
      id,
      `Evidence belongs to ${String(entry.requirementId)}; registry requires ${obligation.requirementId}.`
    )
  }
  if (entry.proofClass !== obligation.proofClass || entry.kind !== obligation.kind) {
    error(errors, "KIND_MISMATCH", id, "Evidence proof class or kind does not match the registry.")
  }
  if (!Object.prototype.hasOwnProperty.call(entry, "sourceFingerprint")) {
    error(errors, "SOURCE_FINGERPRINT_MISSING", id, "Evidence is not bound to a source fingerprint.")
  } else if (entry.sourceFingerprint !== expectedSourceFingerprint) {
    error(errors, "STALE_SOURCE", id, "Evidence source fingerprint does not match the current source.")
  }
  if (entry.mandatorySkip === true) {
    error(errors, "MANDATORY_SKIP", id, "Mandatory evidence is marked skipped.")
  }
  if (entry.status === "FAIL") {
    error(errors, "CHECK_FAILED", id, entry.message ?? "Evidence reports FAIL.")
  } else if (entry.status === "BLOCKED") {
    error(errors, "CHECK_BLOCKED", id, entry.message ?? "Mandatory evidence is BLOCKED.", true)
  } else if (entry.status !== "PASS") {
    error(errors, "STATUS_INVALID", id, `Evidence status ${String(entry.status)} is invalid.`)
  }
  if (entry.status === "PASS" && entry.exitCode !== 0) {
    error(errors, "EXIT_NONZERO", id, `Passing evidence has exit code ${String(entry.exitCode)}.`)
  }
  if (entry.status === "BLOCKED" && entry.exitCode !== null && entry.exitCode !== 2) {
    error(errors, "BLOCKED_EXIT_INVALID", id, "Blocked evidence must use exit code 2 or null.")
  }

  const isBlocked = entry.status === "BLOCKED"
  if (!isBlocked && CHECK_KINDS.has(obligation.kind) && !isPositiveInteger(entry.checksRun)) {
    error(errors, "ZERO_CHECKS", id, "Process completed without a positive checksRun count.")
  }
  if (obligation.kind === "model") {
    if (!isBlocked && entry.modelComplete !== true) {
      error(errors, "MODEL_INCOMPLETE", id, "Model evidence is not marked modelComplete=true.")
    }
    if (!isBlocked && !isPositiveInteger(entry.statesExplored)) {
      error(errors, "MODEL_NO_STATES", id, "Model evidence has no positive statesExplored count.")
    }
  }
  if (obligation.kind === "mutation") {
    if (!isBlocked && !isPositiveInteger(entry.mutantsTotal)) {
      error(errors, "MUTATION_NO_MUTANTS", id, "Mutation evidence has no positive mutantsTotal count.")
    }
    if (!isBlocked && (!Number.isInteger(entry.mutantsKilled) || entry.mutantsKilled < 0)) {
      error(errors, "MUTATION_KILLED_INVALID", id, "Mutation evidence has no valid mutantsKilled count.")
    }
    if (!isBlocked && obligation.threshold && isPositiveInteger(entry.mutantsTotal)) {
      const killedPercent = (entry.mutantsKilled / entry.mutantsTotal) * 100
      if (
        Number.isFinite(obligation.threshold.minimumKilledPercent) &&
        killedPercent < obligation.threshold.minimumKilledPercent
      ) {
        error(
          errors,
          "MUTATION_THRESHOLD",
          id,
          `Mutation score ${killedPercent.toFixed(2)}% is below the required ${obligation.threshold.minimumKilledPercent}%.`
        )
      }
      if (
        Number.isInteger(entry.criticalSurvivors) &&
        Number.isInteger(obligation.threshold.maximumCriticalSurvivors) &&
        entry.criticalSurvivors > obligation.threshold.maximumCriticalSurvivors
      ) {
        error(
          errors,
          "CRITICAL_MUTATION_SURVIVOR",
          id,
          `Mutation evidence has ${entry.criticalSurvivors} critical survivors; maximum is ${obligation.threshold.maximumCriticalSurvivors}.`
        )
      }
    }
  }

  if (!isSafeRelativePath(entry.artifact)) {
    error(errors, "ARTIFACT_PATH_INVALID", id, "Artifact path must be a safe relative path.")
    return
  }
  if (entry.artifact !== obligation.artifact) {
    error(
      errors,
      "ARTIFACT_PATH_MISMATCH",
      id,
      `Evidence points to ${entry.artifact}; registry requires ${obligation.artifact}.`
    )
  }
  const artifactPath = resolve(root, entry.artifact)
  if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
    error(errors, "ARTIFACT_MISSING", id, `Evidence artifact does not exist: ${entry.artifact}`)
    return
  }
  if (typeof entry.artifactSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(entry.artifactSha256)) {
    error(errors, "ARTIFACT_HASH_MISSING", id, "Evidence artifactSha256 is missing or malformed.")
  } else if (sha256File(artifactPath) !== entry.artifactSha256.toLowerCase()) {
    error(errors, "ARTIFACT_HASH_MISMATCH", id, "Evidence artifact hash does not match the recorded artifact.")
  }
}

export function validateEvidence({
  registry,
  evidence,
  scope,
  root = process.cwd(),
  expectedSourceFingerprint
}) {
  const errors = []
  const registryErrors = validateRegistry(registry)
  if (registryErrors.length > 0) {
    return {
      ok: false,
      status: "FAIL",
      errors: registryErrors
    }
  }
  let obligations
  try {
    obligations = expectedObligations(registry, scope)
  } catch (caught) {
    return {
      ok: false,
      status: "FAIL",
      errors: [{ code: "SCOPE_INVALID", message: caught instanceof Error ? caught.message : String(caught) }]
    }
  }
  const currentFingerprint =
    expectedSourceFingerprint ??
    computeSourceFingerprint(root, registry.sourceRoots).digest
  if (!evidence || evidence.schemaVersion !== EVIDENCE_SCHEMA_VERSION || !Array.isArray(evidence.entries)) {
    return {
      ok: false,
      status: "FAIL",
      errors: [{ code: "EVIDENCE_INVALID", message: "Evidence document has an invalid schema or entries list." }]
    }
  }
  const byId = new Map()
  for (const entry of evidence.entries) {
    const id = entry?.id
    if (typeof id !== "string") {
      error(errors, "EVIDENCE_ID_INVALID", "<unknown>", "Every evidence entry needs a string id.")
      continue
    }
    if (byId.has(id)) {
      error(errors, "DUPLICATE_ID", id, "Evidence contains a duplicate obligation id.")
      continue
    }
    byId.set(id, entry)
  }
  const expectedIds = new Set(obligations.map((obligation) => obligation.id))
  for (const id of byId.keys()) {
    if (!expectedIds.has(id)) error(errors, "UNKNOWN_ID", id, "Evidence id is not present in the active registry scope.")
  }
  for (const obligation of obligations) {
    const entry = byId.get(obligation.id)
    if (!entry) {
      error(errors, "MISSING_ENTRY", obligation.id, "Registry obligation has no evidence entry.")
      continue
    }
    validateEntry(entry, obligation, root, currentFingerprint, errors)
  }
  const hasFailure = errors.some((item) => !item.blocked)
  const hasBlocked = errors.some((item) => item.blocked)
  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? "PASS" : hasFailure ? "FAIL" : hasBlocked ? "BLOCKED" : "FAIL",
    sourceFingerprint: currentFingerprint,
    expectedObligationCount: obligations.length,
    evidenceCount: evidence.entries.length,
    errors
  }
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (!value.startsWith("--")) continue
    const key = value.slice(2)
    args[key] = argv[index + 1]?.startsWith("--") ? true : argv[++index]
  }
  return args
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const root = resolve(args.root ?? process.cwd())
  const registryPath = resolve(root, args.registry ?? "verification/requirements.json")
  const evidencePath = resolve(root, args.evidence ?? "tmp/verification/current/evidence.json")
  const registry = JSON.parse(readFileSync(registryPath, "utf8"))
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"))
  const result = validateEvidence({
    registry,
    evidence,
    scope: args.scope ?? "fast",
    root,
    expectedSourceFingerprint: args["source-fingerprint"]
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  return result
}

if (process.argv[1]?.endsWith("/verification/evidence-engine.mjs")) {
  try {
    const result = runCli()
    process.exitCode = result.status === "PASS" ? 0 : result.status === "BLOCKED" ? 2 : 1
  } catch (caught) {
    process.stderr.write(`${caught instanceof Error ? caught.stack : String(caught)}\n`)
    process.exitCode = 1
  }
}
