import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"

import { cwsArtifactFileName, cwsArtifactMetadataFileName, validateCwsArtifactMetadata } from "../tools/cws-artifact.mjs"
import { computeSourceFingerprint } from "./source-fingerprint.mjs"

const sha256 = (value) => createHash("sha256").update(value).digest("hex")
const PARCEL_ESMODULE_HELPERS = "@parcel/transformer-js/src/esmodule-helpers.js"

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text
  return null
}

function visitAst(node, callback) {
  callback(node)
  ts.forEachChild(node, (child) => visitAst(child, callback))
}

function assignmentTargetContainsName(target, name) {
  while (ts.isParenthesizedExpression(target)) target = target.expression
  if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return assignmentTargetContainsName(target.left, name)
  }
  if (ts.isIdentifier(target)) return target.text === name
  if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
    return assignmentTargetContainsName(target.expression, name)
  }
  if (ts.isArrayLiteralExpression(target)) {
    return target.elements.some((element) =>
      ts.isOmittedExpression(element)
        ? false
        : assignmentTargetContainsName(ts.isSpreadElement(element) ? element.expression : element, name)
    )
  }
  if (ts.isObjectLiteralExpression(target)) {
    return target.properties.some((property) => {
      if (ts.isShorthandPropertyAssignment(property)) return property.name.text === name
      if (ts.isPropertyAssignment(property)) return assignmentTargetContainsName(property.initializer, name)
      if (ts.isSpreadAssignment(property)) return assignmentTargetContainsName(property.expression, name)
      return false
    })
  }
  if (ts.isVariableDeclarationList(target)) {
    return target.declarations.some((declaration) => bindingPatternContainsName(declaration.name, name))
  }
  return false
}

function containsExecutionBlockerOutsideNestedFunctions(node) {
  let found = false
  const visit = (current) => {
    if (found) return
    if (current !== node && isFunctionLike(current)) return
    if (
      ts.isReturnStatement(current) ||
      ts.isThrowStatement(current) ||
      (ts.isWhileStatement(current) && staticTruthiness(current.expression) === true) ||
      (ts.isDoStatement(current) && staticTruthiness(current.expression) === true) ||
      (ts.isForStatement(current) && (!current.condition || staticTruthiness(current.condition) === true))
    ) {
      found = true
      return
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

function bindingWrittenInAst(node, name) {
  let written = false
  visitAst(node, (current) => {
    if (
      ts.isBinaryExpression(current) &&
      ts.isAssignmentOperator(current.operatorToken.kind) &&
      assignmentTargetContainsName(current.left, name)
    ) written = true
    if (
      (ts.isForOfStatement(current) || ts.isForInStatement(current)) &&
      assignmentTargetContainsName(current.initializer, name)
    ) written = true
    if (
      ts.isPrefixUnaryExpression(current) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(current.operator) &&
      assignmentTargetContainsName(current.operand, name)
    ) written = true
    if (
      ts.isPostfixUnaryExpression(current) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(current.operator) &&
      assignmentTargetContainsName(current.operand, name)
    ) written = true
  })
  return written
}

function isZeroLiteral(node) {
  return ts.isNumericLiteral(node) && Number(node.text.replaceAll("_", "")) === 0
}

function parcelEntryLoopCall(loop, entriesName) {
  if (!ts.isForStatement(loop) || !ts.isVariableDeclarationList(loop.initializer)) return null
  const indexDeclaration = loop.initializer.declarations[0]
  if (
    loop.initializer.declarations.length !== 1 ||
    !ts.isIdentifier(indexDeclaration.name) ||
    !isZeroLiteral(indexDeclaration.initializer) ||
    !ts.isBinaryExpression(loop.condition) ||
    loop.condition.operatorToken.kind !== ts.SyntaxKind.LessThanToken ||
    !ts.isIdentifier(loop.condition.left) ||
    loop.condition.left.text !== indexDeclaration.name.text ||
    !ts.isPropertyAccessExpression(loop.condition.right) ||
    !ts.isIdentifier(loop.condition.right.expression) ||
    loop.condition.right.expression.text !== entriesName ||
    loop.condition.right.name.text !== "length" ||
    !ts.isPostfixUnaryExpression(loop.incrementor) ||
    loop.incrementor.operator !== ts.SyntaxKind.PlusPlusToken ||
    !ts.isIdentifier(loop.incrementor.operand) ||
    loop.incrementor.operand.text !== indexDeclaration.name.text
  ) return null
  const statement = ts.isBlock(loop.statement) && loop.statement.statements.length === 1
    ? loop.statement.statements[0]
    : loop.statement
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return null
  const call = statement.expression
  const argument = call.arguments[0]
  if (
    !ts.isIdentifier(call.expression) ||
    call.arguments.length !== 1 ||
    !ts.isElementAccessExpression(argument) ||
    !ts.isIdentifier(argument.expression) ||
    argument.expression.text !== entriesName ||
    !ts.isIdentifier(argument.argumentExpression) ||
    argument.argumentExpression.text !== indexDeclaration.name.text
  ) return null
  return call.expression.text
}

function parcelLoaderCallsModuleFactory(loader, modulesName) {
  const loaderParameter = loader.parameters[0]?.name
  if (!ts.isIdentifier(loaderParameter)) return false
  let passedRequireName = null
  visitExecutableFunctionScope(loader, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== "call" ||
      node.arguments.length < 2
    ) return
    const tuple = node.expression.expression
    if (
      !ts.isElementAccessExpression(tuple) ||
      !isZeroLiteral(tuple.argumentExpression) ||
      !ts.isElementAccessExpression(tuple.expression) ||
      !ts.isIdentifier(tuple.expression.expression) ||
      tuple.expression.expression.text !== modulesName ||
      !ts.isIdentifier(tuple.expression.argumentExpression) ||
      tuple.expression.argumentExpression.text !== loaderParameter.text ||
      !ts.isIdentifier(node.arguments[1])
    ) return
    passedRequireName = node.arguments[1].text
  })
  if (!passedRequireName) return false
  if (bindingWrittenInAst(loader.body, passedRequireName)) return false
  let requireFunction = null
  visitAst(loader.body, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === passedRequireName) {
      requireFunction = node
    }
  })
  return Boolean(requireFunction && directFunctionCalls(requireFunction).has(loader.name?.text))
}

function parcelWrapperExecutesEntry(wrapper, wrapperCall) {
  const modulesName = wrapper.parameters[0]?.name
  const entriesName = wrapper.parameters[1]?.name
  const entryIds = wrapperCall.arguments[1]
  if (
    !ts.isIdentifier(modulesName) ||
    !ts.isIdentifier(entriesName) ||
    !ts.isArrayLiteralExpression(entryIds) ||
    entryIds.elements.length === 0 ||
    !entryIds.elements.every(ts.isStringLiteralLike)
  ) return false
  const loaders = wrapper.body.statements
    .filter(ts.isForStatement)
    .map((loop) => parcelEntryLoopCall(loop, entriesName.text))
    .filter(Boolean)
  if (loaders.length !== 1) return false
  const entryLoop = wrapper.body.statements.find((statement) =>
    ts.isForStatement(statement) && parcelEntryLoopCall(statement, entriesName.text) === loaders[0]
  )
  if (!entryLoop) return false
  const loopIndex = wrapper.body.statements.indexOf(entryLoop)
  const prefixStatements = wrapper.body.statements.slice(0, loopIndex)
  if (prefixStatements.some((statement) =>
    !(ts.isFunctionDeclaration(statement) && statement.name?.text === loaders[0]) &&
    !(ts.isExpressionStatement(statement) && ts.isStringLiteralLike(statement.expression))
  )) return false
  const loaderFunctions = wrapper.body.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === loaders[0]
  )
  if (
    writesBindingInScope(wrapper, modulesName.text) ||
    writesBindingInScope(wrapper, entriesName.text) ||
    writesBindingInScope(wrapper, loaders[0])
  ) return false
  return loaderFunctions.length === 1 &&
    parcelLoaderCallsModuleFactory(loaderFunctions[0], modulesName.text)
}

function parseParcelWorker(source) {
  const sourceFile = ts.createSourceFile(
    "service-worker.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )
  if (sourceFile.parseDiagnostics.length > 0) return null
  const executableStatements = sourceFile.statements.filter((statement) =>
    !(ts.isExpressionStatement(statement) && ts.isStringLiteralLike(statement.expression))
  )
  // This proof is intentionally limited to one invoked Parcel wrapper.
  // Unknown top-level statements can throw, block, or change bindings.
  if (executableStatements.length !== 1) return null
  const parcelBundles = []
  for (const statement of executableStatements) {
    if (containsExecutionBlockerOutsideNestedFunctions(statement)) return null
    if (!ts.isExpressionStatement(statement)) continue
    const node = statement.expression
    let invokedFunction = ts.isCallExpression(node) ? node.expression : null
    while (invokedFunction && ts.isParenthesizedExpression(invokedFunction)) {
      invokedFunction = invokedFunction.expression
    }
    if (
      !ts.isCallExpression(node) ||
      !invokedFunction ||
      !ts.isFunctionExpression(invokedFunction) ||
      node.arguments.length < 2 ||
      !ts.isObjectLiteralExpression(node.arguments[0]) ||
      !ts.isArrayLiteralExpression(node.arguments[1]) ||
      node.arguments[1].elements.length === 0 ||
      !node.arguments[1].elements.every(ts.isStringLiteralLike) ||
      !parcelWrapperExecutesEntry(invokedFunction, node)
    ) continue

    const modules = new Map()
    for (const entry of node.arguments[0].properties) {
      if (
        !ts.isPropertyAssignment(entry) ||
        !ts.isArrayLiteralExpression(entry.initializer) ||
        entry.initializer.elements.length !== 2 ||
        !ts.isFunctionExpression(entry.initializer.elements[0]) ||
        !ts.isObjectLiteralExpression(entry.initializer.elements[1])
      ) {
        modules.clear()
        break
      }
      const id = propertyName(entry.name)
      if (!id || modules.has(id)) {
        modules.clear()
        break
      }
      const dependencies = new Map()
      for (const dependency of entry.initializer.elements[1].properties) {
        if (!ts.isPropertyAssignment(dependency)) continue
        const request = propertyName(dependency.name)
        const dependencyId = ts.isStringLiteralLike(dependency.initializer)
          ? dependency.initializer.text
          : null
        if (request && dependencyId) dependencies.set(request, dependencyId)
      }
      modules.set(id, {
        id,
        function: entry.initializer.elements[0],
        dependencies
      })
    }
    if (modules.size === 0) continue
    parcelBundles.push({
      modules,
      entryIds: node.arguments[1].elements.map((entry) => entry.text)
    })
  }
  return parcelBundles.length === 1 ? parcelBundles[0] : null
}

function reachableParcelModules(bundle) {
  const reachable = new Set()
  const queue = [...bundle.entryIds]
  while (queue.length > 0) {
    const id = queue.shift()
    if (reachable.has(id) || !bundle.modules.has(id)) continue
    reachable.add(id)
    for (const dependencyId of executedParcelDependencyIds(bundle.modules.get(id))) {
      if (bundle.modules.has(dependencyId)) queue.push(dependencyId)
    }
  }
  return reachable
}

function executedParcelDependencyIds(module) {
  const requireParameter = module.function.parameters[0]?.name
  if (!ts.isIdentifier(requireParameter) ||
      bindingWrittenInAst(module.function.body, requireParameter.text)) return []
  const dependencyIds = new Set()
  const collect = (expression) => {
    if (
      !ts.isCallExpression(expression) ||
      !ts.isIdentifier(expression.expression) ||
      expression.expression.text !== requireParameter.text ||
      expression.arguments.length !== 1 ||
      !ts.isStringLiteralLike(expression.arguments[0])
    ) return
    const dependencyId = module.dependencies.get(expression.arguments[0].text)
    if (dependencyId) dependencyIds.add(dependencyId)
  }
  // ESM imports emitted by Parcel are direct module-factory initializers.
  // Requiring this executed form prevents a dependency-table-only edge from
  // making an otherwise dormant module look reachable.
  for (const statement of module.function.body.statements) {
    if (containsExecutionBlockerOutsideNestedFunctions(statement)) break
    if (ts.isExpressionStatement(statement)) {
      collect(statement.expression)
      continue
    }
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.initializer) collect(declaration.initializer)
    }
  }
  return [...dependencyIds]
}

function importedModuleLocal(module, request) {
  const moduleId = module.dependencies.get(request)
  const requireParameter = module.function.parameters[0]?.name
  if (!moduleId || !ts.isIdentifier(requireParameter)) return null
  let local = null
  for (const statement of module.function.body.statements) {
    if (containsExecutionBlockerOutsideNestedFunctions(statement)) break
    if (!ts.isVariableStatement(statement)) continue
    for (const node of statement.declarationList.declarations) {
      if (
        local ||
        !ts.isIdentifier(node.name) ||
        !node.initializer ||
        !ts.isCallExpression(node.initializer) ||
        !ts.isIdentifier(node.initializer.expression) ||
        node.initializer.expression.text !== requireParameter.text ||
        !ts.isStringLiteralLike(node.initializer.arguments[0]) ||
        node.initializer.arguments[0].text !== request
      ) continue
      local = node.name.text
    }
  }
  return local && !bindingWrittenInAst(module.function.body, local)
    ? { moduleId, local }
    : null
}

function importedExportLocal(module, exportName) {
  const helper = importedModuleLocal(module, PARCEL_ESMODULE_HELPERS)?.local
  if (!helper) return null
  let local = null
  for (const statement of module.function.body.statements) {
    if (containsExecutionBlockerOutsideNestedFunctions(statement)) break
    if (
      local ||
      !ts.isExpressionStatement(statement) ||
      !ts.isCallExpression(statement.expression)
    ) continue
    const node = statement.expression
    if (
      !ts.isPropertyAccessExpression(node.expression) ||
      !ts.isIdentifier(node.expression.expression) ||
      node.expression.expression.text !== helper ||
      node.expression.name.text !== "export" ||
      !ts.isStringLiteralLike(node.arguments[1]) ||
      node.arguments[1].text !== exportName ||
      !ts.isArrowFunction(node.arguments[2]) ||
      !ts.isIdentifier(node.arguments[2].body)
    ) continue
    local = node.arguments[2].body.text
  }
  return local
}

function functionBoundToLocal(module, local) {
  if (!local) return null
  return module.function.body.statements.find((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === local
  ) ?? null
}

function defaultBuildIdParameter(fn, importedBuildFlagsLocal) {
  return fn?.parameters.find((parameter) => {
    const value = parameter.initializer
    return ts.isIdentifier(parameter.name) &&
      value &&
      ts.isPropertyAccessExpression(value) &&
      ts.isIdentifier(value.expression) &&
      value.expression.text === importedBuildFlagsLocal &&
      value.name.text === "BUILD_ID"
  })?.name.text ?? null
}

function hasProperty(object, name, valueMatches = () => true) {
  if (!ts.isObjectLiteralExpression(object)) return false
  return object.properties.some((property) =>
    ts.isPropertyAssignment(property) &&
    propertyName(property.name) === name &&
    valueMatches(property.initializer)
  )
}

function objectProperty(object, name) {
  if (!ts.isObjectLiteralExpression(object)) return null
  return object.properties.find((property) =>
    ts.isPropertyAssignment(property) && propertyName(property.name) === name
  ) ?? null
}

function expressionHasManifestVersion(value, sourceName, manifestLocals) {
  let found = false
  visitAst(value, (node) => {
    if (!ts.isPropertyAccessExpression(node) || node.name.text !== "version") return
    if (ts.isIdentifier(node.expression) && manifestLocals.has(node.expression.text)) {
      found = true
      return
    }
    if (
      ts.isCallExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression) &&
      node.expression.expression.expression.text === sourceName &&
      node.expression.expression.name.text === "getManifest"
    ) found = true
  })
  return found
}

function conditionalReturnFor(node, functionBody) {
  for (let current = node.parent; current && current !== functionBody; current = current.parent) {
    if (ts.isReturnStatement(current)) return null
    if (ts.isConditionalExpression(current)) {
      return isWithinReturnStatement(current, functionBody) ? current : null
    }
  }
  return null
}

function returnedIdentityGuard(condition, guardLocal, identityLocal) {
  if (
    !guardLocal ||
    !ts.isCallExpression(condition) ||
    !ts.isIdentifier(condition.expression) ||
    condition.expression.text !== guardLocal ||
    condition.arguments.length !== 1 ||
    !ts.isIdentifier(condition.arguments[0])
  ) return false
  return condition.arguments[0].text === identityLocal
}

function isWithinReturnStatement(node, functionBody) {
  for (let current = node; current && current !== functionBody; current = current.parent) {
    if (ts.isReturnStatement(current)) return true
  }
  return false
}

function runtimeIdentityProviderIsBound(module, buildFlagsModuleId) {
  const buildFlags = importedModuleLocal(module, "./generated/build-flags")
  if (!buildFlags || buildFlags.moduleId !== buildFlagsModuleId) return false
  const readLocal = importedExportLocal(module, "readRuntimeBuildIdentity")
  const attachLocal = importedExportLocal(module, "attachRuntimeBuildIdentity")
  const read = functionBoundToLocal(module, readLocal)
  const attach = functionBoundToLocal(module, attachLocal)
  const readBuildId = defaultBuildIdParameter(read, buildFlags.local)
  const attachBuildId = defaultBuildIdParameter(attach, buildFlags.local)
  if (
    !read || !attach || !readBuildId || !attachBuildId ||
    functionShadowsName(read, buildFlags.local) ||
    functionShadowsName(attach, buildFlags.local) ||
    bindingWrittenInAst(read.body, buildFlags.local) ||
    bindingWrittenInAst(attach.body, buildFlags.local) ||
    hasUnsupportedSensitiveControlFlow(read) ||
    hasUnsupportedSensitiveControlFlow(attach)
  ) return false

  const sourceParameter = read.parameters[0]?.name
  if (!ts.isIdentifier(sourceParameter)) return false
  const manifestLocals = new Map()
  visitExecutableFunctionScope(read, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === sourceParameter.text &&
      node.expression.name.text === "getManifest" &&
      ts.isVariableDeclaration(node.parent) &&
      node.parent.initializer === node &&
      ts.isIdentifier(node.parent.name)
    ) manifestLocals.set(node.parent.name.text, node.getEnd())
  })

  const messageParameter = attach.parameters[0]?.name
  if (!ts.isIdentifier(messageParameter)) return false
  let sanitizedMessageBinding = null
  visitExecutableFunctionScope(attach, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isObjectBindingPattern(node.name) ||
      !ts.isIdentifier(node.initializer) ||
      node.initializer.text !== messageParameter.text
    ) return
    const removesRuntimeIdentity = node.name.elements.some((element) =>
      !element.dotDotDotToken &&
      propertyName(element.propertyName ?? element.name) === "runtimeBuildIdentity"
    )
    const rest = node.name.elements.find((element) =>
      Boolean(element.dotDotDotToken) && ts.isIdentifier(element.name)
    )
    if (removesRuntimeIdentity && rest) {
      sanitizedMessageBinding = { name: rest.name.text, position: node.getEnd() }
    }
  })
  if (!sanitizedMessageBinding) return false

  const buildIdentityLocals = new Map()
  let readReturnsBuildIdentityDirectly = false
  visitExecutableFunctionScope(read, (node) => {
    if (
      ts.isObjectLiteralExpression(node) &&
      hasProperty(node, "extensionId", (value) =>
        ts.isPropertyAccessExpression(value) &&
        ts.isIdentifier(value.expression) &&
        value.expression.text === sourceParameter.text &&
        value.name.text === "id"
      ) &&
      hasProperty(node, "packageVersion", (value) =>
        expressionHasManifestVersion(value, sourceParameter.text, manifestLocals)
      ) &&
      hasProperty(node, "buildId", (value) =>
        ts.isIdentifier(value) && value.text === readBuildId
      )
    ) {
      if (
        ts.isVariableDeclaration(node.parent) &&
        node.parent.initializer === node &&
        ts.isIdentifier(node.parent.name)
      ) buildIdentityLocals.set(node.parent.name.text, node.getEnd())
      else if (isWithinReturnStatement(node, read.body)) {
        readReturnsBuildIdentityDirectly = true
      }
    }
  })
  let readReturnsBuildIdentityLocal = false
  const identityGuardLocal = importedExportLocal(module, "isRuntimeBuildIdentity")
  visitExecutableFunctionScope(read, (node) => {
    if (!ts.isIdentifier(node) || !buildIdentityLocals.has(node.text)) return
    const conditional = conditionalReturnFor(node, read.body)
    if (
      conditional &&
      ts.isIdentifier(conditional.whenTrue) &&
      conditional.whenTrue.text === node.text &&
      returnedIdentityGuard(conditional.condition, identityGuardLocal, node.text) &&
      !hasIntermediateResultUse(read, node.text, buildIdentityLocals.get(node.text), conditional.getStart())
    ) readReturnsBuildIdentityLocal = true
  })

  if (functionShadowsName(attach, readLocal)) return false
  let readIdentityBinding = null
  visitExecutableFunctionScope(attach, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === readLocal &&
      node.arguments.length === 2 &&
      ts.isIdentifier(node.arguments[1]) &&
      node.arguments[1].text === attachBuildId &&
      ts.isVariableDeclaration(node.parent) &&
      node.parent.initializer === node &&
      ts.isIdentifier(node.parent.name)
    ) {
      readIdentityBinding = { name: node.parent.name.text, position: node.getEnd() }
    }
  })
  let attachReturnsReadIdentity = false
  visitExecutableFunctionScope(attach, (node) => {
    if (!readIdentityBinding || !ts.isObjectLiteralExpression(node)) return
    const property = objectProperty(node, "runtimeBuildIdentity")
    const conditional = conditionalReturnFor(node, attach.body)
    const lastProperty = node.properties[node.properties.length - 1]
    if (
      property &&
      property === lastProperty &&
      ts.isIdentifier(property.initializer) &&
      property.initializer.text === readIdentityBinding.name &&
      ts.isSpreadAssignment(node.properties[0]) &&
      ts.isIdentifier(node.properties[0].expression) &&
      node.properties[0].expression.text === sanitizedMessageBinding.name &&
      conditional?.whenTrue === node &&
      ts.isIdentifier(conditional.condition) &&
      conditional.condition.text === readIdentityBinding.name &&
      ts.isIdentifier(conditional.whenFalse) &&
      conditional.whenFalse.text === sanitizedMessageBinding.name &&
      !hasIntermediateResultUse(
        attach,
        readIdentityBinding.name,
        readIdentityBinding.position,
        conditional.getStart()
      ) &&
      !hasIntermediateResultUse(
        attach,
        sanitizedMessageBinding.name,
        sanitizedMessageBinding.position,
        conditional.getStart()
      )
    ) attachReturnsReadIdentity = true
  })
  return (
    (readReturnsBuildIdentityDirectly || readReturnsBuildIdentityLocal) &&
    Boolean(readIdentityBinding) &&
    attachReturnsReadIdentity
  )
}

function qualifiedName(node) {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) {
    const prefix = qualifiedName(node.expression)
    return prefix ? `${prefix}.${node.name.text}` : null
  }
  return null
}

function workerExportsSidecarBuildIdFromRuntimeIdentity(source, expectedBuildId) {
  const bundle = parseParcelWorker(source)
  if (!bundle) return false
  const reachable = reachableParcelModules(bundle)
  const backgroundIds = bundle.entryIds
    .map((entryId) => bundle.modules.get(entryId)?.dependencies.get("../../../background/index"))
    .filter(Boolean)
  for (const backgroundId of backgroundIds) {
    const background = bundle.modules.get(backgroundId)
    if (!reachable.has(backgroundId)) continue
    const runtimeIdentity = importedModuleLocal(
      background,
      "../lib/runtime-build-identity"
    )
    if (
      !runtimeIdentity ||
      !reachable.has(runtimeIdentity.moduleId) ||
      !calledImportedExportResultIsSent(
        background,
        "../lib/runtime-build-identity",
        "attachRuntimeBuildIdentity"
      )
    ) continue
    const provider = bundle.modules.get(runtimeIdentity.moduleId)
    if (!provider) continue
    const buildFlags = importedModuleLocal(provider, "./generated/build-flags")
    if (!buildFlags || !reachable.has(buildFlags.moduleId)) continue
    const flags = bundle.modules.get(buildFlags.moduleId)
    const exportedBuildId = flags && importedExportLocal(flags, "BUILD_ID")
    if (!flags || !exportedBuildId) continue
    let exactLiteralFound = false
    let mutated = bindingWrittenInAst(flags.function.body, exportedBuildId)
    visitExecutableFunctionScope(flags.function, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === exportedBuildId &&
        ts.isStringLiteralLike(node.initializer) &&
        node.initializer.text === expectedBuildId
      ) exactLiteralFound = true
      if (
        ts.isBinaryExpression(node) &&
        ts.isIdentifier(node.left) &&
        node.left.text === exportedBuildId &&
        ts.isAssignmentOperator(node.operatorToken.kind)
      ) mutated = true
      if (
        ts.isPrefixUnaryExpression(node) &&
        [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) &&
        ts.isIdentifier(node.operand) &&
        node.operand.text === exportedBuildId
      ) mutated = true
      if (
        ts.isPostfixUnaryExpression(node) &&
        [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) &&
        ts.isIdentifier(node.operand) &&
        node.operand.text === exportedBuildId
      ) mutated = true
    })
    if (
      exactLiteralFound &&
      !mutated &&
      runtimeIdentityProviderIsBound(provider, buildFlags.moduleId)
    ) return true
  }
  return false
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
}

function staticTruthiness(expression) {
  let node = expression
  while (ts.isParenthesizedExpression(node)) node = node.expression
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) return false
  if (ts.isNumericLiteral(node)) return Number(node.text.replaceAll("_", "")) !== 0
  if (ts.isStringLiteralLike(node)) return node.text.length > 0
  if (node.kind === ts.SyntaxKind.VoidExpression) return false
  if (ts.isBinaryExpression(node) && isComparisonOperator(node.operatorToken.kind)) {
    const left = staticPrimitiveValue(node.left)
    const right = staticPrimitiveValue(node.right)
    if (left !== UNKNOWN_STATIC_VALUE && right !== UNKNOWN_STATIC_VALUE) {
      const operator = node.operatorToken.kind
      const equal = left === right
      if (operator === ts.SyntaxKind.EqualsEqualsEqualsToken) return equal
      if (operator === ts.SyntaxKind.ExclamationEqualsEqualsToken) return !equal
      if (typeof left === typeof right) {
        if (operator === ts.SyntaxKind.EqualsEqualsToken) return equal
        if (operator === ts.SyntaxKind.ExclamationEqualsToken) return !equal
        if (typeof left === "number" || typeof left === "string") {
          if (operator === ts.SyntaxKind.LessThanToken) return left < right
          if (operator === ts.SyntaxKind.LessThanEqualsToken) return left <= right
          if (operator === ts.SyntaxKind.GreaterThanToken) return left > right
          if (operator === ts.SyntaxKind.GreaterThanEqualsToken) return left >= right
        }
      }
    }
    return null
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const operand = staticTruthiness(node.operand)
    return operand === null ? null : !operand
  }
  if (ts.isBinaryExpression(node)) {
    const left = staticTruthiness(node.left)
    const right = staticTruthiness(node.right)
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      if (left === false || right === false) return false
      if (left === true) return right
      if (right === true) return left
    }
    if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      if (left === true || right === true) return true
      if (left === false) return right
      if (right === false) return left
    }
  }
  const primitive = staticPrimitiveValue(node)
  if (primitive !== UNKNOWN_STATIC_VALUE) return Boolean(primitive)
  return null
}

const UNKNOWN_STATIC_VALUE = Symbol("unknown-static-value")

function isComparisonOperator(operator) {
  return [
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.LessThanToken,
    ts.SyntaxKind.LessThanEqualsToken,
    ts.SyntaxKind.GreaterThanToken,
    ts.SyntaxKind.GreaterThanEqualsToken
  ].includes(operator)
}

function staticPrimitiveValue(expression) {
  let node = expression
  while (ts.isParenthesizedExpression(node)) node = node.expression
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text.replaceAll("_", ""))
  if (
    ts.isPrefixUnaryExpression(node) &&
    [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operator)
  ) {
    const operand = staticPrimitiveValue(node.operand)
    if (typeof operand !== "number") return UNKNOWN_STATIC_VALUE
    return node.operator === ts.SyntaxKind.PlusToken ? operand : -operand
  }
  if (ts.isBinaryExpression(node)) {
    const left = staticPrimitiveValue(node.left)
    const right = staticPrimitiveValue(node.right)
    if (typeof left !== "number" || typeof right !== "number") return UNKNOWN_STATIC_VALUE
    let result
    switch (node.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken: result = left + right; break
      case ts.SyntaxKind.MinusToken: result = left - right; break
      case ts.SyntaxKind.AsteriskToken: result = left * right; break
      case ts.SyntaxKind.SlashToken: result = right === 0 ? NaN : left / right; break
      case ts.SyntaxKind.PercentToken: result = right === 0 ? NaN : left % right; break
      case ts.SyntaxKind.AsteriskAsteriskToken: result = left ** right; break
      default: return UNKNOWN_STATIC_VALUE
    }
    return Number.isFinite(result) ? result : UNKNOWN_STATIC_VALUE
  }
  return UNKNOWN_STATIC_VALUE
}

function hasUnsupportedSensitiveControlFlow(functionNode) {
  let unsupported = false
  const localConstBindings = new Set()
  visitExecutableFunctionScope(functionNode, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) localConstBindings.add(node.name.text)
  })
  const referencesLocalConst = (node) => {
    let found = false
    visitAst(node, (child) => {
      if (ts.isIdentifier(child) && localConstBindings.has(child.text)) found = true
    })
    return found
  }
  visitExecutableFunctionScope(functionNode, (node) => {
    if (ts.isSwitchStatement(node)) {
      const caseValues = []
      if (
        staticPrimitiveValue(node.expression) === UNKNOWN_STATIC_VALUE &&
        referencesLocalConst(node.expression)
      ) unsupported = true
      for (const clause of node.caseBlock.clauses) {
        if (!ts.isCaseClause(clause)) continue
        const value = staticPrimitiveValue(clause.expression)
        if (value === UNKNOWN_STATIC_VALUE || caseValues.some((previous) => previous === value)) {
          unsupported = true
        } else {
          caseValues.push(value)
        }
      }
    }
    const condition = ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)
      ? node.expression
      : ts.isForStatement(node) || ts.isConditionalExpression(node)
        ? node.condition
        : null
    if (!condition || staticTruthiness(condition) !== null) return
    if (referencesLocalConst(condition)) unsupported = true
    let hasComparison = false
    visitAst(condition, (child) => {
      if (ts.isBinaryExpression(child) && isComparisonOperator(child.operatorToken.kind)) {
        hasComparison = true
      }
    })
    if (hasComparison) unsupported = true
  })
  return unsupported
}

function visitExecutableFunctionScope(functionNode, callback) {
  if (!functionNode?.body) return
  const body = functionNode.body
  const visit = (node) => {
    if (node !== body && isFunctionLike(node)) {
      if (ts.isFunctionDeclaration(node)) callback(node)
      return false
    }
    callback(node)
    if (ts.isBlock(node)) {
      for (const statement of node.statements) {
        if (visit(statement)) return true
      }
      return false
    }
    if (ts.isIfStatement(node)) {
      visit(node.expression)
      const truthiness = staticTruthiness(node.expression)
      if (truthiness === true) return visit(node.thenStatement)
      if (truthiness === false) return node.elseStatement ? visit(node.elseStatement) : false
      const thenTerminates = visit(node.thenStatement)
      const elseTerminates = node.elseStatement ? visit(node.elseStatement) : false
      return Boolean(node.elseStatement) && thenTerminates && elseTerminates
    }
    if (ts.isConditionalExpression(node)) {
      visit(node.condition)
      const truthiness = staticTruthiness(node.condition)
      if (truthiness === true) visit(node.whenTrue)
      else if (truthiness === false) visit(node.whenFalse)
      else {
        visit(node.whenTrue)
        visit(node.whenFalse)
      }
      return false
    }
    if (
      ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)
    ) {
      visit(node.left)
      const left = staticTruthiness(node.left)
      if (
        (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && left === false) ||
        (node.operatorToken.kind === ts.SyntaxKind.BarBarToken && left === true)
      ) return false
      visit(node.right)
      return false
    }
    if (ts.isWhileStatement(node) || ts.isForStatement(node)) {
      const initializer = ts.isForStatement(node) ? node.initializer : null
      const condition = node.expression
      if (initializer) visit(initializer)
      if (condition) visit(condition)
      const truthiness = condition ? staticTruthiness(condition) : true
      if (truthiness === false) return false
      visit(node.statement)
      if (ts.isForStatement(node) && node.incrementor) visit(node.incrementor)
      return false
    }
    if (ts.isDoStatement(node)) {
      const bodyTerminates = visit(node.statement)
      visit(node.expression)
      return bodyTerminates
    }
    if (ts.isSwitchStatement(node)) {
      visit(node.expression)
      const switchValue = staticPrimitiveValue(node.expression)
      if (switchValue !== UNKNOWN_STATIC_VALUE) {
        let startIndex = -1
        let defaultIndex = -1
        node.caseBlock.clauses.forEach((clause, index) => {
          if (ts.isDefaultClause(clause)) defaultIndex = index
          else if (startIndex < 0 && staticPrimitiveValue(clause.expression) === switchValue) startIndex = index
        })
        if (startIndex < 0) startIndex = defaultIndex
        if (startIndex < 0) return false
        for (const clause of node.caseBlock.clauses.slice(startIndex)) {
          let clauseTerminates = false
          for (const statement of clause.statements) {
            if (ts.isBreakStatement(statement)) {
              clauseTerminates = true
              break
            }
            if (visit(statement)) return true
          }
          if (clauseTerminates) break
        }
        return false
      }
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause)) visit(clause.expression)
        for (const statement of clause.statements) {
          if (ts.isBreakStatement(statement)) break
          visit(statement)
        }
      }
      return false
    }
    if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) {
      if (node.expression) visit(node.expression)
      return true
    }
    let terminates = false
    ts.forEachChild(node, (child) => {
      if (!terminates && visit(child)) terminates = true
    })
    return terminates
  }
  visit(body)
}

function moduleLevelFunctionMap(module) {
  const functions = new Map()
  const add = (name, functionNode) => {
    if (!name) return
    const entries = functions.get(name) ?? []
    entries.push(functionNode)
    functions.set(name, entries)
  }
  for (const statement of module.function.body.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      add(statement.name.text, statement)
      continue
    }
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        (ts.isFunctionExpression(declaration.initializer) ||
          ts.isArrowFunction(declaration.initializer))
      ) add(declaration.name.text, declaration.initializer)
    }
  }
  return functions
}

function bindingPatternContainsName(pattern, name) {
  if (ts.isIdentifier(pattern)) return pattern.text === name
  if (ts.isObjectBindingPattern(pattern) || ts.isArrayBindingPattern(pattern)) {
    return pattern.elements.some((element) => bindingPatternContainsName(element.name, name))
  }
  return false
}

function functionShadowsName(functionNode, name) {
  if (functionNode.parameters.some((parameter) => bindingPatternContainsName(parameter.name, name))) {
    return true
  }
  if (ts.isFunctionExpression(functionNode) && functionNode.name?.text === name) return true
  let shadowed = false
  visitExecutableFunctionScope(functionNode, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      bindingPatternContainsName(node.name, name)
    ) shadowed = true
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node !== functionNode &&
      node.name?.text === name
    ) shadowed = true
  })
  return shadowed
}

function directFunctionCalls(functionNode) {
  const names = new Set()
  visitExecutableFunctionScope(functionNode, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      !functionShadowsName(functionNode, node.expression.text)
    ) names.add(node.expression.text)
  })
  return names
}

function runtimeMessageListenerRoots(module, functions) {
  const roots = []
  if (functionShadowsName(module.function, "chrome")) return roots
  const requireParameter = module.function.parameters[0]?.name
  for (const statement of module.function.body.statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isCallExpression(statement.expression) &&
      qualifiedName(statement.expression.expression) ===
        "chrome.runtime.onMessage.addListener"
    ) {
      const callback = statement.expression.arguments[0]
      if (callback && isFunctionLike(callback) && !functionShadowsName(callback, "chrome")) {
        roots.push(callback)
      } else if (callback && ts.isIdentifier(callback)) {
        if (bindingWrittenInAst(module.function.body, callback.text)) return []
        const candidates = functions.get(callback.text) ?? []
        if (candidates.length === 1 && !functionShadowsName(candidates[0], "chrome")) roots.push(candidates[0])
      }
      return roots
    }
    if (
      ts.isFunctionDeclaration(statement) ||
      (ts.isExpressionStatement(statement) && ts.isStringLiteralLike(statement.expression))
    ) continue
    if (ts.isVariableStatement(statement)) {
      const safe = statement.declarationList.declarations.every((declaration) => {
        if (!declaration.initializer || isFunctionLike(declaration.initializer)) return true
        const initializer = declaration.initializer
        return ts.isIdentifier(requireParameter) &&
          ts.isCallExpression(initializer) &&
          ts.isIdentifier(initializer.expression) &&
          initializer.expression.text === requireParameter.text &&
          initializer.arguments.length === 1 &&
          ts.isStringLiteralLike(initializer.arguments[0]) &&
          module.dependencies.has(initializer.arguments[0].text)
      })
      if (safe) continue
    }
    // Only function declarations and direct Parcel imports may execute before
    // the required listener registration. Calls, IIFEs, loops, and returns
    // have unproved effects and invalidate the static route.
    return []
  }
  return roots
}

function isHealthCheckRouteCall(call, listener) {
  const messageParameter = listener.parameters[0]?.name
  if (!ts.isIdentifier(messageParameter)) return false
  let current = call.parent
  let caseClause = null
  let switchStatement = null
  while (current && current !== listener.body) {
    if (isFunctionLike(current)) return false
    if (ts.isCaseClause(current)) caseClause = current
    if (ts.isSwitchStatement(current)) {
      switchStatement = current
      break
    }
    current = current.parent
  }
  if (
    !caseClause ||
    !ts.isStringLiteralLike(caseClause.expression) ||
    caseClause.expression.text !== "healthCheck" ||
    !switchStatement ||
    !ts.isPropertyAccessExpression(switchStatement.expression) ||
    !ts.isIdentifier(switchStatement.expression.expression) ||
    switchStatement.expression.expression.text !== messageParameter.text ||
    switchStatement.expression.name.text !== "action"
  ) return false
  return true
}

function healthCheckRouteTargets(module, functions) {
  const targets = new Set()
  for (const listener of runtimeMessageListenerRoots(module, functions)) {
    visitExecutableFunctionScope(listener, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        !functionShadowsName(listener, node.expression.text) &&
        isHealthCheckRouteCall(node, listener)
      ) targets.add(node.expression.text)
    })
  }
  return targets
}

function reachableRuntimeMessageFunctions(module) {
  const functions = moduleLevelFunctionMap(module)
  const depths = new Map()
  const queue = [...healthCheckRouteTargets(module, functions)].map((name) => ({ name, depth: 1 }))
  while (queue.length > 0) {
    const { name, depth } = queue.shift()
    const candidates = functions.get(name) ?? []
    if (candidates.length !== 1) continue
    const functionNode = candidates[0]
    if (depths.has(functionNode) && depths.get(functionNode) <= depth) continue
    depths.set(functionNode, depth)
    for (const calledName of directFunctionCalls(functionNode)) {
      const called = functions.get(calledName) ?? []
      if (called.length === 1) queue.push({ name: calledName, depth: depth + 1 })
    }
  }
  return depths
}

function writesBindingInScope(functionNode, name) {
  return bindingWrittenInAst(functionNode.body, name)
}

function routeBindingsAreStable(module, functions, reachableFunctions) {
  const routeNames = healthCheckRouteTargets(module, functions)
  for (const functionNode of reachableFunctions.keys()) {
    for (const calledName of directFunctionCalls(functionNode)) {
      if (functions.get(calledName)?.length === 1) routeNames.add(calledName)
    }
  }
  const listenerRoots = runtimeMessageListenerRoots(module, functions)
  for (const name of routeNames) {
    if (writesBindingInScope(module.function, name)) return false
    if (listenerRoots.some((listener) => writesBindingInScope(listener, name))) return false
    for (const functionNode of reachableFunctions.keys()) {
      if (writesBindingInScope(functionNode, name)) return false
    }
  }
  return true
}

function importedExportCalleeMatches(call, local, exportName) {
  if (!ts.isCallExpression(call)) return false
  let callee = call.expression
  while (ts.isParenthesizedExpression(callee)) callee = callee.expression
  if (
    ts.isBinaryExpression(callee) &&
    callee.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) callee = callee.right
  return ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === local &&
    callee.name.text === exportName
}

function resultBindingScope(declaration, functionNode) {
  const declarationList = declaration.parent
  if (!ts.isVariableDeclarationList(declarationList)) return null
  if ((declarationList.flags & ts.NodeFlags.BlockScoped) === 0) return functionNode.body
  for (let current = declaration; current && current !== functionNode; current = current.parent) {
    if (
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current)
    ) return current
    if (ts.isBlock(current)) return current
  }
  return null
}

function isWithinNode(node, ancestor) {
  for (let current = node; current; current = current.parent) {
    if (current === ancestor) return true
  }
  return false
}

function hasIntermediateResultUse(functionNode, name, start, end, rejectIntermediateCalls = false) {
  let unsafeUse = false
  visitExecutableFunctionScope(functionNode, (node) => {
    if (node.getStart() <= start || node.getStart() >= end) return
    if (
      ts.isIdentifier(node) &&
      node.text === name
    ) unsafeUse = true
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name
    ) unsafeUse = true
    if (
      rejectIntermediateCalls &&
      ts.isCallExpression(node) &&
      node.getStart() > start &&
      node.getStart() < end
    ) unsafeUse = true
  })
  return unsafeUse
}

function sendsImportedRuntimeIdentity(functionNode, importedLocal, exportName) {
  if (functionShadowsName(functionNode, importedLocal)) return false
  const resultBindings = []
  visitExecutableFunctionScope(functionNode, (node) => {
    if (
      !importedExportCalleeMatches(node, importedLocal, exportName) ||
      node.arguments.length !== 2
    ) return
    const declaration = node.parent
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer === node &&
      ts.isIdentifier(declaration.name)
    ) resultBindings.push({
      name: declaration.name.text,
      declaration,
      position: node.getEnd()
    })
  })
  for (const binding of resultBindings) {
    let payloadIsSent = false
    visitExecutableFunctionScope(functionNode, (node) => {
      if (
        !ts.isCallExpression(node) ||
        !ts.isPropertyAccessExpression(node.expression)
      ) return
      const api = qualifiedName(node.expression)
      const payloadIndex = api === "chrome.tabs.sendMessage"
        ? 1
        : api === "chrome.runtime.sendMessage"
          ? 0
          : -1
      if (
        payloadIndex < 0 ||
        node.getStart() <= binding.position ||
        !ts.isIdentifier(node.arguments[payloadIndex]) ||
        node.arguments[payloadIndex].text !== binding.name ||
        !isWithinNode(node, resultBindingScope(binding.declaration, functionNode)) ||
        hasIntermediateResultUse(
          functionNode,
          binding.name,
          binding.position,
          node.getStart(),
          true
        )
      ) return
      payloadIsSent = true
    })
    if (payloadIsSent) return true
  }
  return false
}

function calledImportedExportResultIsSent(module, request, exportName) {
  const imported = importedModuleLocal(module, request)
  if (!imported) return false
  const functions = moduleLevelFunctionMap(module)
  const reachable = reachableRuntimeMessageFunctions(module)
  if (!routeBindingsAreStable(module, functions, reachable)) return false
  const listenerRoots = runtimeMessageListenerRoots(module, functions)
  if (
    [...reachable.keys()].some((functionNode) => functionShadowsName(functionNode, "chrome")) ||
    listenerRoots.some((listener) => bindingWrittenInAst(listener.body, imported.local)) ||
    listenerRoots.some(hasUnsupportedSensitiveControlFlow) ||
    [...reachable.keys()].some((functionNode) =>
      bindingWrittenInAst(functionNode.body, imported.local) ||
      hasUnsupportedSensitiveControlFlow(functionNode)
    )
  ) return false
  for (const [functionNode, depth] of reachable) {
    if (depth >= 2 && sendsImportedRuntimeIdentity(functionNode, imported.local, exportName)) {
      return true
    }
  }
  return false
}

// Phase two verifies an already-installed candidate. It never creates a new
// build UUID or changes the candidate's source, ZIP, sidecar, or compiled files.
export function verifyFrozenReleaseCandidate({ root, artifactPath, sourceRoots }) {
  const problems = []
  let metadata = null
  let sourceFingerprint = null
  let fileCount = 0
  let artifactSha256 = null
  try {
    const artifact = resolve(root, artifactPath)
    const buildDirectory = resolve(root, "build/chrome-mv3-prod")
    if (dirname(artifact) !== resolve(root, "build")) throw new Error("Frozen candidate must be a hash-named ZIP in build/")
    artifactSha256 = sha256(readFileSync(artifact))
    metadata = JSON.parse(readFileSync(join(root, "build", cwsArtifactMetadataFileName(basename(artifact))), "utf8"))
    sourceFingerprint = computeSourceFingerprint(root, sourceRoots)
    const compiledManifest = readFileSync(join(buildDirectory, "manifest.json"))
    const chromeVersion = JSON.parse(compiledManifest.toString("utf8")).version
    problems.push(...validateCwsArtifactMetadata(metadata, {
      chromeVersion, artifactSha256, sourceFingerprint: sourceFingerprint.digest
    }))
    if (metadata.sourceFileCount !== sourceFingerprint.fileCount) {
      problems.push("Package source file count does not match the current source fingerprint")
    }
    if (basename(artifact) !== cwsArtifactFileName(chromeVersion, artifactSha256) || metadata.artifactFile !== relative(root, artifact)) {
      problems.push("Frozen candidate filename/path does not match its sidecar")
    }
    if (sha256(compiledManifest) !== metadata.manifestSha256) problems.push("Frozen candidate manifest differs from its sidecar")
    const currentZip = resolve(root, "build/chrome-mv3-prod.zip")
    if (!existsSync(currentZip) || sha256(readFileSync(currentZip)) !== artifactSha256) problems.push("Frozen candidate differs from the current production package ZIP")

    const listing = spawnSync("unzip", ["-Z1", artifact], { encoding: "utf8", maxBuffer: 1024 * 1024 })
    if (listing.status !== 0) throw new Error("Frozen candidate ZIP cannot be enumerated")
    const entries = listing.stdout.split(/\r?\n/).filter(Boolean)
    if (new Set(entries).size !== entries.length || entries.some((entry) => !/^[a-zA-Z0-9._/-]+$/.test(entry) || entry.startsWith("/") || entry.split("/").includes(".."))) {
      throw new Error("Frozen candidate ZIP has duplicate or unsafe paths")
    }
    const packagedFiles = entries.filter((entry) => !entry.endsWith("/"))
    if (!packagedFiles.includes("manifest.json")) throw new Error("Frozen candidate ZIP does not contain manifest.json")
    const packagedManifestResult = spawnSync("unzip", ["-p", artifact, "manifest.json"], { maxBuffer: 8 * 1024 * 1024 })
    if (packagedManifestResult.status !== 0 || packagedManifestResult.error) throw new Error("Frozen candidate ZIP manifest cannot be read")
    const packagedManifestBytes = packagedManifestResult.stdout
    if (!packagedManifestBytes.equals(compiledManifest)) problems.push("Frozen candidate ZIP manifest differs from the compiled manifest")
    if (sha256(packagedManifestBytes) !== metadata.manifestSha256) problems.push("Frozen candidate ZIP manifest differs from its sidecar")
    const packagedManifest = JSON.parse(packagedManifestBytes.toString("utf8"))
    const serviceWorkerEntry = packagedManifest?.background?.service_worker
    if (typeof serviceWorkerEntry !== "string" || !serviceWorkerEntry || !serviceWorkerEntry.endsWith(".js") || !packagedFiles.includes(serviceWorkerEntry)) {
      problems.push("Frozen candidate manifest does not name a packaged background service worker JavaScript file")
    }
    const compiledFiles = []
    function walk(directory) {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name)
        const stat = lstatSync(path)
        if (stat.isSymbolicLink()) throw new Error("Frozen compiled candidate contains a symbolic link")
        if (stat.isDirectory()) walk(path)
        else if (stat.isFile()) compiledFiles.push(relative(buildDirectory, path))
        else throw new Error("Frozen compiled candidate contains an unsupported file")
      }
    }
    walk(buildDirectory)
    if (JSON.stringify([...packagedFiles].sort()) !== JSON.stringify(compiledFiles.sort())) problems.push("Frozen candidate ZIP and compiled directory have different file inventories")
    for (const entry of packagedFiles) {
      const bytes = spawnSync("unzip", ["-p", artifact, entry], { maxBuffer: 128 * 1024 * 1024 })
      if (bytes.status !== 0 || bytes.error) throw new Error("Frozen candidate ZIP file cannot be read within the verification limit")
      const compiledPath = join(buildDirectory, entry)
      if (!existsSync(compiledPath) || sha256(readFileSync(compiledPath)) !== sha256(bytes.stdout)) {
        problems.push(`Frozen candidate ZIP bytes differ from compiled file: ${entry}`)
      }
    }
    fileCount = packagedFiles.length
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error))
  }
  const staticIdentityProof = {
    status: "BLOCKED",
    reason: "Static Parcel tracing cannot establish that transitive module initializers complete normally or that captured route bindings are initialized on the executed path.",
    requiredEvidence: "Direct Chrome DevTools extension inventory identity and a live runtime health check bound to this exact ZIP SHA-256 and source fingerprint; the observed extension ID and runtime build ID must match the loaded candidate and sidecar.",
    artifactPath,
    artifactSha256,
    sourceFingerprint: sourceFingerprint?.digest ?? null,
    sidecarBuildId: metadata?.buildId ?? null
  }
  return {
    schemaVersion: 1,
    status: problems.length ? "FAIL" : "BLOCKED",
    problems,
    staticIdentityProof,
    metadata,
    sourceFingerprint,
    fileCount
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.env.VERIFICATION_ROOT ?? process.cwd())
  const registry = JSON.parse(readFileSync(join(root, "verification/requirements.json"), "utf8"))
  const result = verifyFrozenReleaseCandidate({ root, artifactPath: process.argv[2] ?? "", sourceRoots: registry.sourceRoots })
  console.log(JSON.stringify(result, null, 2))
  process.exitCode = result.status === "PASS" ? 0 : result.status === "BLOCKED" ? 2 : 1
}
