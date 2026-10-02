import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"

import { createCwsArtifactMetadata, cwsArtifactFileName, cwsArtifactMetadataFileName } from "../../tools/cws-artifact.mjs"
import { verifyFrozenReleaseCandidate } from "../../verification/release-candidate.mjs"
import { computeSourceFingerprint } from "../../verification/source-fingerprint.mjs"

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")
const buildId = "123e4567-e89b-42d3-a456-426614174000"
const otherBuildId = "123e4567-e89b-42d3-a456-426614174001"

function parcelWorker(
  buildId: string,
  decoyBuildId?: string,
  runtimeBuildIdOverride = "",
  options: {
    conditionalListenerRegistration?: boolean
    factoryEarlyReturnBeforeListener?: boolean
    listenerBindingReassignedBeforeRegistration?: boolean
    shadowChromeBinding?: boolean
    deadIdentityProviderBranch?: boolean
    deadIdentityProviderComparison?: boolean
    deadIdentityLessComparison?: boolean
    deadIdentityArithmeticBranch?: boolean
    deadIdentitySwitchBranch?: boolean
    deadIdentitySwitchUnknownCase?: boolean
    deadIdentitySwitchDuplicateCase?: boolean
    deadIdentitySwitchNegativeZero?: boolean
    deadIdentitySwitchCaseAfterDefault?: boolean
    deadIdentityConstFalseBranch?: boolean
    deadIdentityConstSwitchSelector?: boolean
    deadIdentityModuleConstFalseBranch?: boolean
    deadIdentityModuleConstSwitchSelector?: boolean
    deadPublisherBranch?: boolean
    deadPublisherComparison?: boolean
    deadPublisherLooseComparison?: boolean
    deadPublisherConstFalseBranch?: boolean
    deadPublisherModuleConstFalseBranch?: boolean
    deadWorkerFunction?: boolean
    entryDoesNotRequireBackground?: boolean
    entryReturnBeforeBackgroundRequire?: boolean
    metadataOnlyBackgroundButIdentityReachable?: boolean
    entryRequireReassigned?: boolean
    entryRequireReassignedInNestedHelper?: boolean
    reassignIdentityImportInNestedHelper?: boolean
    reassignFlagsImportInNestedHelper?: boolean
    identityBindingWrittenWithForOf?: boolean
    identityBindingWrittenWithDestructuring?: boolean
    generatedBuildIdWrittenWithForOf?: boolean
    generatedBuildIdWrittenWithDestructuring?: boolean
    mutateParcelModulesTable?: boolean
    mutateParcelEntriesList?: boolean
    mutateParcelRequireInNestedHelper?: boolean
    wrapperEarlyReturnBeforeLoop?: boolean
    wrapperInfiniteLoopBeforeLoop?: boolean
    wrapperIifeThrowBeforeLoop?: boolean
    wrapperIifeLoopBeforeLoop?: boolean
    wrapperNamedStopBeforeLoop?: boolean
    wrapperConstLoopBeforeLoop?: boolean
    factoryIifeThrowBeforeListener?: boolean
    factoryIifeLoopBeforeListener?: boolean
    factoryNamedStopBeforeListener?: boolean
    factoryConstLoopBeforeListener?: boolean
    entryRequiresThrowingModuleBeforeBackground?: boolean
    backgroundRequiresThrowingModuleBeforeListener?: boolean
    factoryThrowsAfterListenerRegistration?: boolean
    factoryLoopsAfterListenerRegistration?: boolean
    handlerInitializerAfterFactoryReturn?: boolean
    factoryInfiniteLoopBeforeListener?: boolean
    providerReturnBeforeFlagsRequire?: boolean
    topLevelThrowBeforeParcelWrapper?: boolean
    topLevelInfiniteLoopBeforeParcelWrapper?: boolean
    uninvokedParcelWrapper?: boolean
    reassignIdentityImport?: boolean
    reassignFlagsImport?: boolean
    mutateGeneratedBuildIdInNestedFunction?: boolean
    wrapperDoesNotExecuteEntry?: boolean
    listenerDoesNotCallPublisher?: boolean
    listenerShadowsPublisher?: boolean
    publisherReassignedBeforeListener?: boolean
    mutateBuildIdBeforeSend?: boolean
    mutateBuildIdInIife?: boolean
    mutateBuildIdInNestedFunction?: boolean
    wrongSendArgument?: boolean
  } = {}
) {
  const decoy = decoyBuildId ? `const dormantBuildId = "${decoyBuildId}";` : ""
  const attachResult = `let bound = (0, identity.attachRuntimeBuildIdentity)(message, chrome.runtime${runtimeBuildIdOverride});`
  const sendMessage = options.wrongSendArgument
    ? "return chrome.tabs.sendMessage(bound, {});"
    : "return chrome.runtime.sendMessage(bound);"
  const mutation = options.mutateBuildIdInIife
    ? "(() => { bound.runtimeBuildIdentity.buildId = 'spoof'; })();"
    : options.mutateBuildIdInNestedFunction
      ? "function mutateBound() { bound.runtimeBuildIdentity.buildId = 'spoof'; } mutateBound();"
      : options.mutateBuildIdBeforeSend
        ? "bound.runtimeBuildIdentity.buildId = 'spoof';"
        : ""
  const publishBody = options.deadPublisherBranch
    ? `if (false) { ${attachResult} ${sendMessage} } return chrome.runtime.sendMessage(message);`
    : options.deadPublisherComparison
      ? `if (1 === 2) { ${attachResult} ${sendMessage} } return chrome.runtime.sendMessage(message);`
      : options.deadPublisherLooseComparison
        ? `if (1 == 2) { ${attachResult} ${sendMessage} } return chrome.runtime.sendMessage(message);`
      : options.deadPublisherConstFalseBranch
        ? `const disabled = false; if (disabled) { ${attachResult} ${sendMessage} } return chrome.runtime.sendMessage(message);`
      : options.deadPublisherModuleConstFalseBranch
        ? `if (disabled) { ${attachResult} ${sendMessage} } return chrome.runtime.sendMessage(message);`
      : `${attachResult} ${mutation} ${sendMessage}`
  const readIdentity = options.deadIdentityProviderBranch
    ? "if (false) return { extensionId: source.id, packageVersion: source.getManifest().version, buildId: buildId }; return null;"
    : options.deadIdentityProviderComparison
      ? "if (1 === 2) return { extensionId: source.id, packageVersion: source.getManifest().version, buildId: buildId }; return null;"
      : options.deadIdentityLessComparison
        ? "if (1 < 0) return { extensionId: source.id, packageVersion: source.getManifest().version, buildId: buildId }; return null;"
        : options.deadIdentityArithmeticBranch
          ? "if (1 - 1) return { extensionId: source.id, packageVersion: source.getManifest().version, buildId: buildId }; return null;"
      : options.deadIdentitySwitchBranch
            ? "switch (1) { case 1 + 0: return null; default: return { extensionId: source.id, packageVersion: source.getManifest().version, buildId: buildId }; }"
          : options.deadIdentitySwitchUnknownCase
            ? "function chooseCase() { return 1; } switch (1) { case chooseCase(): return null; default: return { extensionId: source.id, packageVersion: source.getManifest().version, buildId: buildId }; }"
            : options.deadIdentitySwitchDuplicateCase
              ? "switch (1) { case 1: return null; case 1: return { extensionId: source.id, packageVersion: source.getManifest().version, buildId: buildId }; default: return null; }"
              : options.deadIdentitySwitchNegativeZero
                ? "switch (-0) { case 0: return null; default: return { extensionId: source.id, packageVersion: source.getManifest().version, buildId: buildId }; }"
                : options.deadIdentitySwitchCaseAfterDefault
                  ? "switch (1) { default: return { extensionId: source.id, packageVersion: source.getManifest().version, buildId: buildId }; case 1: return null; }"
                  : options.deadIdentityConstFalseBranch
                    ? "const disabled = false; if (disabled) return { extensionId: source.id, packageVersion: source.getManifest().version, buildId: buildId }; return null;"
                    : options.deadIdentityConstSwitchSelector
                      ? "const action = 'other'; switch (action) { case 'healthCheck': return { extensionId: source.id, packageVersion: source.getManifest().version, buildId: buildId }; default: return null; }"
                      : options.deadIdentityModuleConstFalseBranch
                        ? "if (disabled) return { extensionId: source.id, packageVersion: source.getManifest().version, buildId: buildId }; return null;"
                        : options.deadIdentityModuleConstSwitchSelector
                          ? "switch (action) { case 'healthCheck': return { extensionId: source.id, packageVersion: source.getManifest().version, buildId: buildId }; default: return null; }"
      : "return { extensionId: source.id, packageVersion: source.getManifest().version, buildId: buildId };"
  const attachIdentity = options.deadIdentityProviderBranch
    ? "if (false) return { ...messageWithoutIdentity, runtimeBuildIdentity: identity }; return messageWithoutIdentity;"
    : "return identity ? { ...messageWithoutIdentity, runtimeBuildIdentity: identity } : messageWithoutIdentity;"
  const listenerRegistration = options.listenerBindingReassignedBeforeRegistration
    ? "function onMessage(message) { switch (message.action) { case 'healthCheck': handleHealthCheck({}); break; } } onMessage = () => {}; chrome.runtime.onMessage.addListener(onMessage);"
    : "chrome.runtime.onMessage.addListener(function onMessage(message) { switch (message.action) { case 'healthCheck': handleHealthCheck({}); break; } });"
  const listener = options.listenerDoesNotCallPublisher
    ? "chrome.runtime.onMessage.addListener(function onMessage(message) { switch (message.action) { case 'healthCheck': void 0; break; } });"
    : options.listenerShadowsPublisher
      ? "chrome.runtime.onMessage.addListener(function onMessage(publish) { switch (publish.action) { case 'healthCheck': publish({}); break; } });"
      : listenerRegistration
  const publisherReassignment = options.publisherReassignedBeforeListener
    ? "publish = () => {};"
    : ""
  const identityReassignment = options.reassignIdentityImport
    ? "identity = { attachRuntimeBuildIdentity: (message) => message };"
    : ""
  const nestedIdentityReassignment = options.reassignIdentityImportInNestedHelper
    ? "function mutateIdentityImport() { identity = {}; } mutateIdentityImport();"
    : options.identityBindingWrittenWithForOf
      ? "for (identity of [{}]) {}"
      : options.identityBindingWrittenWithDestructuring
        ? "([identity = {}] = [undefined]);"
        : ""
  const flagsReassignment = options.reassignFlagsImport
    ? `flags = { BUILD_ID: "${buildId}" };`
    : ""
  const nestedFlagsReassignment = options.reassignFlagsImportInNestedHelper
    ? "function mutateFlagsImport() { flags = {}; } mutateFlagsImport();"
    : ""
  const generatedBuildIdMutation = options.mutateGeneratedBuildIdInNestedFunction
    ? "function mutateGeneratedBuildId() { generatedBuildId = 'spoof'; } mutateGeneratedBuildId();"
    : options.generatedBuildIdWrittenWithForOf
      ? "for (generatedBuildId of ['spoof']) {}"
      : options.generatedBuildIdWrittenWithDestructuring
        ? "({ buildId: generatedBuildId = 'spoof' } = { buildId: undefined });"
    : ""
  const registeredListener = options.deadWorkerFunction
    ? ""
    : options.conditionalListenerRegistration
      ? `if (false) { ${listener} }`
      : listener
  const entryLoad = options.entryReturnBeforeBackgroundRequire
    ? 'return; e("../../../background/index");'
    : options.metadataOnlyBackgroundButIdentityReachable
      ? 'e("../lib/runtime-build-identity");'
    : options.entryDoesNotRequireBackground
      ? ""
    : options.entryRequireReassigned
      ? 'e = () => {}; e("../../../background/index");'
      : options.entryRequireReassignedInNestedHelper
        ? 'function replaceEntryRequire() { e = () => {}; } replaceEntryRequire(); e("../../../background/index");'
      : 'e("../../../background/index");'
  const entryLoadWithThrowingDependency = [
    options.entryRequiresThrowingModuleBeforeBackground ? 'e("./throwing");' : "",
    entryLoad
  ].filter(Boolean).join(" ")
  const backgroundDependencyBeforeListener = options.backgroundRequiresThrowingModuleBeforeListener
    ? 'var unrelated = e("./throwing");'
    : ""
  const handlerDeclaration = options.handlerInitializerAfterFactoryReturn
    ? ""
    : "function handleHealthCheck(message) { publish(message); }"
  const factoryPostListener = options.handlerInitializerAfterFactoryReturn
    ? "return; const handleHealthCheck = (message) => publish(message);"
    : options.factoryThrowsAfterListenerRegistration
      ? "throw new Error('blocked after listener registration');"
      : options.factoryLoopsAfterListenerRegistration
        ? "while (true) {}"
        : ""
  const loaderRequireMutation = options.mutateParcelRequireInNestedHelper
    ? "function replaceLocalRequire() { localRequire = () => {}; } replaceLocalRequire();"
    : ""
  const parcelWrapperPrefix = [
    options.wrapperEarlyReturnBeforeLoop ? "return;" : "",
    options.wrapperInfiniteLoopBeforeLoop ? "while (true) {}" : "",
    options.wrapperIifeThrowBeforeLoop ? "(() => { throw new Error('blocked'); })();" : "",
    options.wrapperIifeLoopBeforeLoop ? "(() => { while (true) {} })();" : "",
    options.wrapperNamedStopBeforeLoop ? "function stop() { throw new Error('blocked'); } stop();" : "",
    options.wrapperConstLoopBeforeLoop ? "const blocked = true; while (blocked) {}" : ""
  ].filter(Boolean).join(" ")
  const factoryExecutionBarrier = [
    options.factoryEarlyReturnBeforeListener ? "return;" : "",
    options.factoryInfiniteLoopBeforeListener ? "while (true) {}" : "",
    options.factoryIifeThrowBeforeListener ? "(() => { throw new Error('blocked'); })();" : "",
    options.factoryIifeLoopBeforeListener ? "(() => { while (true) {} })();" : "",
    options.factoryNamedStopBeforeListener ? "function stop() { throw new Error('blocked'); } stop();" : "",
    options.factoryConstLoopBeforeListener ? "const blocked = true; while (blocked) {}" : ""
  ].filter(Boolean).join(" ")
  const providerExecutionBarrier = options.providerReturnBeforeFlagsRequire ? "return;" : ""
  const parcelWrapperMutations = [
    options.mutateParcelModulesTable ? "modules.entry[0] = function() {};" : "",
    options.mutateParcelEntriesList ? "entries.length = 0;" : ""
  ].filter(Boolean).join(" ")
  const parcelWrapperBody = options.wrapperDoesNotExecuteEntry
    ? ""
    : `${parcelWrapperPrefix} function loadModule(id) {
        function localRequire(request) { return loadModule(modules[id][1][request]); }
        ${loaderRequireMutation}
        modules[id][0].call({}, localRequire, {}, {});
      }
      ${parcelWrapperMutations}
      for (let index = 0; index < entries.length; index++) loadModule(entries[index]);
      if (entry) loadModule(entry);`
  const entryDependencies = JSON.stringify({
    ...(options.entryRequiresThrowingModuleBeforeBackground ? { "./throwing": "throwing" } : {}),
    "../../../background/index": "background",
    ...(options.metadataOnlyBackgroundButIdentityReachable ? { "../lib/runtime-build-identity": "identity" } : {})
  })
  const parcelWrapper = `(function(modules, entries, entry) { ${parcelWrapperBody} })({
    entry: [function(e, t, r) { ${entryLoadWithThrowingDependency} ${decoy} }, ${entryDependencies}],
    background: [function(e, t, r) {
      var identity = e("../lib/runtime-build-identity");
      ${backgroundDependencyBeforeListener}
      ${identityReassignment}
      ${nestedIdentityReassignment}
      ${options.shadowChromeBinding ? "const chrome = { runtime: { onMessage: { addListener() {} }, sendMessage() {} }, tabs: { sendMessage() {} } };" : ""}
      ${options.deadPublisherModuleConstFalseBranch ? "const disabled = false;" : ""}
      function publish(message) {
        ${publishBody}
      }
      ${publisherReassignment}
      ${handlerDeclaration}
      ${factoryExecutionBarrier}
      ${registeredListener}
      ${factoryPostListener}
    }, ${JSON.stringify(options.backgroundRequiresThrowingModuleBeforeListener ? { "../lib/runtime-build-identity": "identity", "./throwing": "throwing" } : { "../lib/runtime-build-identity": "identity" })}],
    throwing: [function() { throw new Error("synthetic transitive module failure"); }, {}],
    identity: [function(e, t, r) {
      var helper = e("@parcel/transformer-js/src/esmodule-helpers.js");
      helper.export(r, "readRuntimeBuildIdentity", () => read);
      helper.export(r, "attachRuntimeBuildIdentity", () => attach);
      ${options.deadIdentityModuleConstFalseBranch ? "const disabled = false;" : ""}
      ${options.deadIdentityModuleConstSwitchSelector ? "const action = 'other';" : ""}
      ${providerExecutionBarrier}
      var flags = e("./generated/build-flags");
      ${flagsReassignment}
      ${nestedFlagsReassignment}
      function read(source, buildId = flags.BUILD_ID) {
        ${readIdentity}
      }
      function attach(message, source, buildId = flags.BUILD_ID) {
        const { runtimeBuildIdentity: _untrustedIdentity, ...messageWithoutIdentity } = message;
        let identity = read(source, buildId);
        ${attachIdentity}
      }
    }, {
      "./generated/build-flags": "flags",
      "@parcel/transformer-js/src/esmodule-helpers.js": "helpers"
    }],
    flags: [function(e, t, r) {
      var helper = e("@parcel/transformer-js/src/esmodule-helpers.js");
      helper.export(r, "BUILD_ID", () => generatedBuildId);
      let generatedBuildId = "${buildId}";
      ${generatedBuildIdMutation}
    }, { "@parcel/transformer-js/src/esmodule-helpers.js": "helpers" }],
    helpers: [function(e, t, r) {
      r.export = (exports, name, getter) => Object.defineProperty(exports, name, { get: getter });
    }, {}]
  }, ["entry"], "entry", "parcelRequireSynthetic");`
  const parcelSource = options.uninvokedParcelWrapper
    ? `function dormantParcelFactory() { ${parcelWrapper} }`
    : parcelWrapper
  const topLevelPrefix = options.topLevelThrowBeforeParcelWrapper
    ? "throw new Error('blocked before Parcel');"
    : options.topLevelInfiniteLoopBeforeParcelWrapper
      ? "while (true) {}"
      : ""
  return `${topLevelPrefix}${parcelSource}`
}

function fixture(root: string, options: {
  workerBuildId?: string
  workerDecoyBuildId?: string
  runtimeBuildIdOverride?: string
  unrelatedJavaScriptBuildId?: string
  deadWorkerFunction?: boolean
  entryDoesNotRequireBackground?: boolean
  entryReturnBeforeBackgroundRequire?: boolean
  metadataOnlyBackgroundButIdentityReachable?: boolean
  entryRequireReassigned?: boolean
  entryRequireReassignedInNestedHelper?: boolean
  reassignIdentityImportInNestedHelper?: boolean
  reassignFlagsImportInNestedHelper?: boolean
  identityBindingWrittenWithForOf?: boolean
  identityBindingWrittenWithDestructuring?: boolean
  generatedBuildIdWrittenWithForOf?: boolean
  generatedBuildIdWrittenWithDestructuring?: boolean
  mutateParcelModulesTable?: boolean
  mutateParcelEntriesList?: boolean
  mutateParcelRequireInNestedHelper?: boolean
  wrapperEarlyReturnBeforeLoop?: boolean
  wrapperInfiniteLoopBeforeLoop?: boolean
  wrapperIifeThrowBeforeLoop?: boolean
  wrapperIifeLoopBeforeLoop?: boolean
  wrapperNamedStopBeforeLoop?: boolean
  wrapperConstLoopBeforeLoop?: boolean
  uninvokedParcelWrapper?: boolean
  factoryInfiniteLoopBeforeListener?: boolean
  factoryIifeThrowBeforeListener?: boolean
  factoryIifeLoopBeforeListener?: boolean
  factoryNamedStopBeforeListener?: boolean
  factoryConstLoopBeforeListener?: boolean
  entryRequiresThrowingModuleBeforeBackground?: boolean
  backgroundRequiresThrowingModuleBeforeListener?: boolean
  factoryThrowsAfterListenerRegistration?: boolean
  factoryLoopsAfterListenerRegistration?: boolean
  handlerInitializerAfterFactoryReturn?: boolean
  providerReturnBeforeFlagsRequire?: boolean
  topLevelThrowBeforeParcelWrapper?: boolean
  topLevelInfiniteLoopBeforeParcelWrapper?: boolean
  reassignIdentityImport?: boolean
  reassignFlagsImport?: boolean
  mutateGeneratedBuildIdInNestedFunction?: boolean
  wrapperDoesNotExecuteEntry?: boolean
  conditionalListenerRegistration?: boolean
  factoryEarlyReturnBeforeListener?: boolean
  listenerBindingReassignedBeforeRegistration?: boolean
  shadowChromeBinding?: boolean
  deadIdentityProviderBranch?: boolean
  deadIdentityProviderComparison?: boolean
  deadIdentityLessComparison?: boolean
  deadIdentityArithmeticBranch?: boolean
  deadIdentitySwitchBranch?: boolean
  deadIdentitySwitchUnknownCase?: boolean
  deadIdentitySwitchDuplicateCase?: boolean
  deadIdentitySwitchNegativeZero?: boolean
  deadIdentitySwitchCaseAfterDefault?: boolean
  deadIdentityConstFalseBranch?: boolean
  deadIdentityConstSwitchSelector?: boolean
  deadIdentityModuleConstFalseBranch?: boolean
  deadIdentityModuleConstSwitchSelector?: boolean
  deadPublisherBranch?: boolean
  deadPublisherComparison?: boolean
  deadPublisherLooseComparison?: boolean
  deadPublisherConstFalseBranch?: boolean
  deadPublisherModuleConstFalseBranch?: boolean
  listenerDoesNotCallPublisher?: boolean
  listenerShadowsPublisher?: boolean
  publisherReassignedBeforeListener?: boolean
  mutateBuildIdBeforeSend?: boolean
  mutateBuildIdInIife?: boolean
  mutateBuildIdInNestedFunction?: boolean
  wrongSendArgument?: boolean
} = {}) {
  expect(spawnSync("git", ["init", "--quiet"], { cwd: root }).status).toBe(0)
  const buildDirectory = join(root, "build/chrome-mv3-prod")
  const workerEntry = "static/background/index.js"
  mkdirSync(join(buildDirectory, "static/background"), { recursive: true })
  mkdirSync(join(root, "lib/generated"), { recursive: true })
  writeFileSync(join(root, "lib/generated/build-flags.ts"), "export const ALLOW_DEV_ENTITLEMENT = false\n")
  writeFileSync(join(root, "source.js"), "synthetic source")
  const manifest = JSON.stringify({ manifest_version: 3, version: "2.3.0.3", background: { service_worker: workerEntry } })
  writeFileSync(join(buildDirectory, "manifest.json"), manifest)
  const runtimeBuildIdOverride = options.runtimeBuildIdOverride
    ? `, ${JSON.stringify(options.runtimeBuildIdOverride)}`
    : ""
  writeFileSync(join(buildDirectory, workerEntry), parcelWorker(
    options.workerBuildId ?? buildId,
    options.workerDecoyBuildId,
    runtimeBuildIdOverride,
    options
  ))
  const zipEntries = ["manifest.json", workerEntry]
  if (options.unrelatedJavaScriptBuildId) {
    writeFileSync(join(buildDirectory, "unrelated.js"), "const unrelated = " + JSON.stringify(options.unrelatedJavaScriptBuildId))
    zipEntries.push("unrelated.js")
  }
  const currentZip = join(root, "build/chrome-mv3-prod.zip")
  expect(spawnSync("zip", ["-q", currentZip, ...zipEntries], { cwd: buildDirectory }).status).toBe(0)
  const artifactSha256 = sha256(readFileSync(currentZip))
  const artifactName = cwsArtifactFileName("2.3.0.3", artifactSha256)
  const artifactPath = join("build", artifactName)
  cpSync(currentZip, join(root, artifactPath))
  const sourceRoots = ["source.js", "lib/generated/build-flags.ts", "verification/provider-fixtures.json"]
  mkdirSync(join(root, "verification"), { recursive: true })
  writeFileSync(join(root, "verification/provider-fixtures.json"), JSON.stringify({ providers: [] }))
  const sourceFingerprint = computeSourceFingerprint(root, sourceRoots)
  const metadata = createCwsArtifactMetadata({
    appVersion: "2.3.0", chromeVersion: "2.3.0.3", artifactFile: artifactPath,
    artifactSha256, manifestSha256: sha256(manifest), sourceCommit: "b".repeat(40),
    sourceDirty: true, sourceStatusSha256: "c".repeat(64), trackedDiffSha256: "d".repeat(64),
    sourceFingerprint: sourceFingerprint.digest, sourceFileCount: sourceFingerprint.fileCount,
    buildId, builtAt: "2026-09-30T12:00:00.000Z"
  })
  const metadataPath = join(root, "build", cwsArtifactMetadataFileName(artifactName))
  writeFileSync(metadataPath, JSON.stringify(metadata))
  return { artifactPath, sourceRoots, metadataPath, metadata }
}

describe("frozen release candidate phase two", () => {
  function withFixture(
    check: (root: string, input: ReturnType<typeof fixture>) => void,
    options?: Parameters<typeof fixture>[1]
  ) {
    const root = mkdtempSync(join(tmpdir(), "photosweep-frozen-candidate-"))
    try { check(root, fixture(root, options)) }
    finally { rmSync(root, { recursive: true, force: true }) }
  }

  it("[PARITY-08] verifies the ZIP, sidecar, source and exact compiled bytes without changing the candidate", () => {
    withFixture((root, input) => {
      const before = readFileSync(join(root, input.artifactPath))
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result).toMatchObject({
        status: "BLOCKED",
        problems: [],
        fileCount: 2,
        staticIdentityProof: {
          status: "BLOCKED",
          artifactPath: input.artifactPath,
          artifactSha256: input.metadata.artifactSha256,
          sourceFingerprint: input.metadata.sourceFingerprint,
          sidecarBuildId: buildId
        }
      })
      expect(result.staticIdentityProof.requiredEvidence).toContain("Chrome DevTools")
      expect(readFileSync(join(root, input.artifactPath))).toEqual(before)
      expect(JSON.parse(readFileSync(input.metadataPath, "utf8")).buildId).toBe(buildId)
    })
  })

  it.each([
    ["source.js", "changed source"],
    ["verification/provider-fixtures.json", '{"providers":[{"new":"evidence path after freeze"}]}'],
    ["build/chrome-mv3-prod/static/background/index.js", "compiled bytes changed"],
    ["build/chrome-mv3-prod/extra.js", "extra compiled file"],
    ["build/chrome-mv3-prod.zip", "new current ZIP"]
  ])("[PARITY-08] rejects frozen candidate drift at %s", (path, value) => {
    withFixture((root, input) => {
      writeFileSync(join(root, path), value)
      expect(verifyFrozenReleaseCandidate({ root, ...input })).toMatchObject({ status: "FAIL" })
    })
  })

  it("[PARITY-08] rejects a spoofed sidecar build ID absent from the compiled ZIP", () => {
    withFixture((root, input) => {
      input.metadata.buildId = "123e4567-e89b-42d3-a456-426614174001"
      writeFileSync(input.metadataPath, JSON.stringify(input.metadata))
      expect(verifyFrozenReleaseCandidate({ root, ...input }).staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    })
  })

  it("[PARITY-08] rejects a sidecar source file count that differs from the fresh source fingerprint", () => {
    withFixture((root, input) => {
      input.metadata.sourceFileCount += 1
      writeFileSync(input.metadataPath, JSON.stringify(input.metadata))

      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("FAIL")
      expect(result.problems).toContain("Package source file count does not match the current source fingerprint")
    })
  })

  it("[PARITY-08] binds the sidecar build ID to the manifest-declared service worker", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { workerBuildId: otherBuildId, workerDecoyBuildId: buildId, unrelatedJavaScriptBuildId: buildId })

    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { workerBuildId: otherBuildId, runtimeBuildIdOverride: buildId })

    withFixture((root, input) => {
      expect(verifyFrozenReleaseCandidate({ root, ...input })).toMatchObject({ status: "BLOCKED", problems: [], staticIdentityProof: { status: "BLOCKED" } })
    }, { workerBuildId: buildId, workerDecoyBuildId: otherBuildId, unrelatedJavaScriptBuildId: otherBuildId })
  })

  it("[PARITY-08] rejects a correct build ID hidden in an uninvoked worker function", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { deadWorkerFunction: true })
  })

  it("[PARITY-08] requires the Parcel entry factory to execute its declared background dependency", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { entryDoesNotRequireBackground: true })
  })

  it("[PARITY-08] stops Parcel dependency proof at an entry-factory return", () => {
    for (const options of [
      { entryReturnBeforeBackgroundRequire: true },
      { metadataOnlyBackgroundButIdentityReachable: true }
    ]) {
      withFixture((root, input) => {
        const result = verifyFrozenReleaseCandidate({ root, ...input })
        expect(result.status).toBe("BLOCKED")
        expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
      }, options)
    }
  })

  it("[PARITY-08] rejects Parcel-looking worker code inside an uninvoked function", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { uninvokedParcelWrapper: true })
  })

  it("[PARITY-08] rejects a top-level Parcel-shaped wrapper that never loads its entries", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { wrapperDoesNotExecuteEntry: true })
  })

  it("[PARITY-08] rejects a Parcel wrapper that returns before its entry loop", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { wrapperEarlyReturnBeforeLoop: true })
  })

  it("[PARITY-08] rejects unproved wrapper calls and loops before the Parcel entry loop", () => {
    for (const options of [
      { wrapperIifeThrowBeforeLoop: true },
      { wrapperIifeLoopBeforeLoop: true },
      { wrapperNamedStopBeforeLoop: true },
      { wrapperConstLoopBeforeLoop: true }
    ]) {
      withFixture((root, input) => {
        const result = verifyFrozenReleaseCandidate({ root, ...input })
        expect(result.status).toBe("BLOCKED")
        expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
      }, options)
    }
  })

  it("[PARITY-08] rejects a nonterminating loop before the Parcel entry loop", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { wrapperInfiniteLoopBeforeLoop: true })
  })

  it("[PARITY-08] rejects a top-level throw or nonterminating loop before the Parcel wrapper", () => {
    for (const options of [
      { topLevelThrowBeforeParcelWrapper: true },
      { topLevelInfiniteLoopBeforeParcelWrapper: true }
    ]) {
      withFixture((root, input) => {
        const result = verifyFrozenReleaseCandidate({ root, ...input })
        expect(result.status).toBe("BLOCKED")
        expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
      }, options)
    }
  })

  it("[PARITY-08] rejects mutations to Parcel's module table and entry list", () => {
    for (const option of ["mutateParcelModulesTable", "mutateParcelEntriesList"] as const) {
      withFixture((root, input) => {
        const result = verifyFrozenReleaseCandidate({ root, ...input })
        expect(result.status).toBe("BLOCKED")
        expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
      }, { [option]: true })
    }
  })

  it("[PARITY-08] rejects a Parcel entry that reassigns its require parameter", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { entryRequireReassigned: true })
  })

  it("[PARITY-08] rejects require bindings reassigned by nested helpers", () => {
    for (const options of [
      { mutateParcelRequireInNestedHelper: true },
      { entryRequireReassignedInNestedHelper: true }
    ]) {
      withFixture((root, input) => {
        const result = verifyFrozenReleaseCandidate({ root, ...input })
        expect(result.status).toBe("BLOCKED")
        expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
      }, options)
    }
  })

  it("[PARITY-08] rejects reassignment of the runtime identity module import", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { reassignIdentityImport: true })
  })

  it("[PARITY-08] rejects nested-helper, for-of, and destructuring writes to the runtime identity import", () => {
    for (const options of [
      { reassignIdentityImportInNestedHelper: true },
      { identityBindingWrittenWithForOf: true },
      { identityBindingWrittenWithDestructuring: true }
    ]) {
      withFixture((root, input) => {
        const result = verifyFrozenReleaseCandidate({ root, ...input })
        expect(result.status).toBe("BLOCKED")
        expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
      }, options)
    }
  })

  it("[PARITY-08] rejects reassignment of the build flags import", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { reassignFlagsImport: true })
  })

  it("[PARITY-08] rejects nested-helper reassignment of the build flags import", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { reassignFlagsImportInNestedHelper: true })
  })

  it("[PARITY-08] rejects a build flags require that occurs after provider-factory return", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { providerReturnBeforeFlagsRequire: true })
  })

  it("[PARITY-08] rejects generated build ID mutation in a called nested helper", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { mutateGeneratedBuildIdInNestedFunction: true })
  })

  it("[PARITY-08] rejects generated build ID writes through loops and destructuring", () => {
    for (const options of [
      { generatedBuildIdWrittenWithForOf: true },
      { generatedBuildIdWrittenWithDestructuring: true }
    ]) {
      withFixture((root, input) => {
        const result = verifyFrozenReleaseCandidate({ root, ...input })
        expect(result.status).toBe("BLOCKED")
        expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
      }, options)
    }
  })

  it("[PARITY-08] rejects a registered listener that never calls the publisher", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { listenerDoesNotCallPublisher: true })
  })

  it("[PARITY-08] rejects a listener parameter that shadows the module publisher", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { listenerShadowsPublisher: true })
  })

  it("[PARITY-08] rejects a module publisher reassigned before listener use", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { publisherReassignedBeforeListener: true })
  })

  it("[PARITY-08] requires the runtime message listener to be registered on the module execution path", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { conditionalListenerRegistration: true })
  })

  it("[PARITY-08] rejects listener registration and helper roots after a factory return", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { factoryEarlyReturnBeforeListener: true })
  })

  it("[PARITY-08] rejects listener roots after a nonterminating factory loop", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { factoryInfiniteLoopBeforeListener: true })
  })

  it("[PARITY-08] blocks static identity when module initialization has unproved effects or incomplete bindings", () => {
    for (const options of [
      { entryRequiresThrowingModuleBeforeBackground: true },
      { backgroundRequiresThrowingModuleBeforeListener: true },
      { factoryThrowsAfterListenerRegistration: true },
      { factoryLoopsAfterListenerRegistration: true },
      { handlerInitializerAfterFactoryReturn: true }
    ]) {
      withFixture((root, input) => {
        const result = verifyFrozenReleaseCandidate({ root, ...input })
        expect(result.status).toBe("BLOCKED")
        expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
        expect(result.staticIdentityProof.reason).toContain("transitive module initializers")
        expect(result.staticIdentityProof.requiredEvidence).toContain("exact ZIP SHA-256 and source fingerprint")
      }, options)
    }
  })

  it("[PARITY-08] rejects unproved factory calls and loops before listener registration", () => {
    for (const options of [
      { factoryIifeThrowBeforeListener: true },
      { factoryIifeLoopBeforeListener: true },
      { factoryNamedStopBeforeListener: true },
      { factoryConstLoopBeforeListener: true }
    ]) {
      withFixture((root, input) => {
        const result = verifyFrozenReleaseCandidate({ root, ...input })
        expect(result.status).toBe("BLOCKED")
        expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
      }, options)
    }
  })

  it("[PARITY-08] rejects a listener callback binding reassigned before registration", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { listenerBindingReassignedBeforeRegistration: true })
  })

  it("[PARITY-08] rejects a module-local chrome object as a substitute for the browser API", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { shadowChromeBinding: true })
  })

  it("[PARITY-08] rejects an attach-and-send sequence confined to an inactive publisher branch", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { deadPublisherBranch: true })
  })

  it("[PARITY-08] rejects attach-and-send sequences under a statically false comparison", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { deadPublisherComparison: true })
  })

  it("[PARITY-08] rejects identity returns under a statically false comparison", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { deadIdentityProviderComparison: true })
  })

  it("[PARITY-08] rejects identity returns under known-false arithmetic and switch dispatch", () => {
    for (const options of [
      { deadIdentityArithmeticBranch: true },
      { deadIdentitySwitchBranch: true },
      { deadIdentitySwitchUnknownCase: true },
      { deadIdentitySwitchDuplicateCase: true },
      { deadIdentitySwitchNegativeZero: true },
      { deadIdentitySwitchCaseAfterDefault: true }
    ]) {
      withFixture((root, input) => {
        const result = verifyFrozenReleaseCandidate({ root, ...input })
        expect(result.status).toBe("BLOCKED")
        expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
      }, options)
    }
  })

  it("[PARITY-08] rejects identity and publisher proofs gated by local const selectors", () => {
    for (const options of [
      { deadIdentityConstFalseBranch: true },
      { deadIdentityConstSwitchSelector: true },
      { deadIdentityModuleConstFalseBranch: true },
      { deadIdentityModuleConstSwitchSelector: true },
      { deadPublisherConstFalseBranch: true },
      { deadPublisherModuleConstFalseBranch: true }
    ]) {
      withFixture((root, input) => {
        const result = verifyFrozenReleaseCandidate({ root, ...input })
        expect(result.status).toBe("BLOCKED")
        expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
      }, options)
    }
  })

  it("[PARITY-08] rejects publisher results under a known-false loose equality", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { deadPublisherLooseComparison: true })
  })

  it("[PARITY-08] rejects provider identity under a known-false relational comparison", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { deadIdentityLessComparison: true })
  })

  it("[PARITY-08] rejects a runtime build ID mutated through the attached payload before send", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { mutateBuildIdBeforeSend: true })
  })

  it("[PARITY-08] rejects mutation of the attached payload inside an immediately invoked closure", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { mutateBuildIdInIife: true })
  })

  it("[PARITY-08] rejects mutation through a called named nested helper", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { mutateBuildIdInNestedFunction: true })
  })

  it("[PARITY-08] rejects runtime identity objects returned only from inactive provider branches", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { deadIdentityProviderBranch: true })
  })

  it("[PARITY-08] requires the attached runtime identity in the sendMessage payload position", () => {
    withFixture((root, input) => {
      const result = verifyFrozenReleaseCandidate({ root, ...input })
      expect(result.status).toBe("BLOCKED")
      expect(result.staticIdentityProof).toMatchObject({ status: "BLOCKED" })
    }, { wrongSendArgument: true })
  })

  it.each([0, 1])("[PARITY-08] the actual release block restores one frozen candidate after browser fixture exit %s without repackaging", (integrationExitCode) => {
    withFixture((root, input) => {
      const source = readFileSync(resolve("verification/verification-runner.mjs"), "utf8")
      const browserMarker = source.indexOf("// Browser boundary tests use the isolated extension harness")
      const start = source.lastIndexOf('if (scope === "release") {', browserMarker)
      const end = source.indexOf("// Rebind all entries", browserMarker)
      expect(start).toBeGreaterThan(0)
      expect(end).toBeGreaterThan(start)
      const commands: string[] = []
      const outputDirectory = join(root, "run-output")
      mkdirSync(outputDirectory)
      const frozenFlags = readFileSync(join(root, "lib/generated/build-flags.ts"))
      runInNewContext(source.slice(start, end), {
        scope: "release", frozenCandidatePath: input.artifactPath, root, outputDirectory,
        cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync, join, resolve,
        process, buildResult: null, buildDigest: null, integrationBuildResult: null,
        activeObligations: () => [],
        discoverBuildDigest: () => ({ digest: "synthetic-directory-proof-is-checked-separately" }),
        runCommand: (label: string) => {
          commands.push(label)
          if (label === "integration-build") {
            writeFileSync(join(root, "build/chrome-mv3-prod/static/background/index.js"), "dev fixture build")
            writeFileSync(join(root, "lib/generated/build-flags.ts"), "export const ALLOW_DEV_ENTITLEMENT = true\n")
            return { exitCode: integrationExitCode }
          }
          expect(label).toBe("frozen-candidate-final")
          const result = verifyFrozenReleaseCandidate({ root, ...input })
          expect(result.status).toBe("BLOCKED")
          return { exitCode: 0 }
        }
      })
      expect(commands).toEqual(["integration-build", "frozen-candidate-final"])
      expect(readFileSync(join(root, "lib/generated/build-flags.ts"))).toEqual(frozenFlags)
      expect(readFileSync(join(outputDirectory, "browser-fixture-build/static/background/index.js"), "utf8")).toBe("dev fixture build")
      expect(verifyFrozenReleaseCandidate({ root, ...input }).status).toBe("BLOCKED")
    })
  })

  it("[PARITY-08] restores the frozen candidate and flags when the integration build throws", () => {
    withFixture((root, input) => {
      const source = readFileSync(resolve("verification/verification-runner.mjs"), "utf8")
      const browserMarker = source.indexOf("// Browser boundary tests use the isolated extension harness")
      const start = source.lastIndexOf('if (scope === "release") {', browserMarker)
      const end = source.indexOf("// Rebind all entries", browserMarker)
      const outputDirectory = join(root, "run-output")
      mkdirSync(outputDirectory)
      const flagsPath = join(root, "lib/generated/build-flags.ts")
      const manifestPath = join(root, "build/chrome-mv3-prod/manifest.json")
      const workerPath = join(root, "build/chrome-mv3-prod/static/background/index.js")
      const frozenFlags = readFileSync(flagsPath)
      const frozenManifest = readFileSync(manifestPath)
      const frozenWorker = readFileSync(workerPath)

      let thrown: unknown
      try {
        runInNewContext(source.slice(start, end), {
          scope: "release", frozenCandidatePath: input.artifactPath, root, outputDirectory,
          cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync, join, resolve,
          process, buildResult: null, buildDigest: null, integrationBuildResult: null,
          activeObligations: () => [],
          discoverBuildDigest: () => ({ digest: "synthetic-directory-proof-is-checked-separately" }),
          runCommand: (label: string) => {
            expect(label).toBe("integration-build")
            writeFileSync(workerPath, "partial dev fixture build")
            writeFileSync(flagsPath, "export const ALLOW_DEV_ENTITLEMENT = true\n")
            throw new Error("synthetic spawn failure")
          }
        })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).toBe("synthetic spawn failure")
      expect(readFileSync(manifestPath)).toEqual(frozenManifest)
      expect(readFileSync(workerPath)).toEqual(frozenWorker)
      expect(readFileSync(flagsPath)).toEqual(frozenFlags)
    })
  })
})
