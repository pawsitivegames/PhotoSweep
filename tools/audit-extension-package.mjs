#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

import { assertChromeVersion } from "./cws-artifact.mjs"

const buildDir = process.env.PHOTOSWEEP_EXTENSION_BUILD_DIR ?? "build/chrome-mv3-prod"
const expectedApiBase = process.env.PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL
const expectedHostPermission = process.env.PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION
const expectedPublicKey = process.env.PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY
const packageJson = readJson(path.resolve("package.json"))
const expectedManifestVersion =
  packageJson.chromeVersion ?? packageJson.manifest?.version ?? packageJson.version
assertChromeVersion(expectedManifestVersion, packageJson.version)

const AMAZON_MARKETPLACE_HOSTS = [
  "amazon.com",
  "amazon.ca",
  "amazon.co.uk",
  "amazon.de",
  "amazon.fr",
  "amazon.it",
  "amazon.es",
  "amazon.co.jp",
  "amazon.com.au",
  "amazon.in",
  "amazon.com.br",
  "amazon.com.mx",
  "amazon.nl",
  "amazon.sg",
  "amazon.ae",
  "amazon.sa",
  "amazon.se",
  "amazon.pl",
  "amazon.com.tr",
  "amazon.com.be",
  "amazon.eg",
  "amazon.ie"
]

const AMAZON_ORIGINS = AMAZON_MARKETPLACE_HOSTS.flatMap((host) => [
  `https://www.${host}`,
  `https://${host}`
])
const AMAZON_CONTENT_MATCHES = AMAZON_ORIGINS.map(
  (origin) => `${origin}/photos*`
)
const AMAZON_WAR_MATCHES = AMAZON_ORIGINS.map((origin) => `${origin}/*`)
const ICLOUD_WAR_MATCHES = [
  "https://www.icloud.com/*",
  "https://icloud.com/*",
  "https://www.icloud.com.cn/*",
  "https://icloud.com.cn/*"
]

function fail(message) {
  console.error(`audit failed: ${message}`)
  process.exitCode = 1
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

if (!expectedApiBase) fail("PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL is required")
if (!expectedHostPermission) fail("PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION is required")
if (!expectedPublicKey) fail("PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY is required")
if (process.env.PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT !== "0") {
  fail("PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT must be 0 for release packages")
}

const manifestPath = path.join(buildDir, "manifest.json")
if (!fs.existsSync(manifestPath)) fail(`missing ${manifestPath}`)
const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : {}

if (manifest.manifest_version !== 3) fail("manifest_version must be 3")
if (manifest.name !== packageJson.displayName) {
  fail(`manifest.name must match package.json displayName: ${packageJson.displayName}`)
}
if (manifest.description !== packageJson.description) {
  fail("manifest.description must match package.json description")
}
if (manifest.version !== expectedManifestVersion) {
  fail(`manifest.version must match package.json manifest.version: ${expectedManifestVersion}`)
}
if (manifest.side_panel?.default_path !== "tabs/scanner-panel.html") {
  fail("side_panel.default_path must be tabs/scanner-panel.html")
}

const hostPermissions = manifest.host_permissions ?? []
if (!Array.isArray(hostPermissions)) fail("manifest.host_permissions must be an array")
if (!hostPermissions.includes(expectedHostPermission)) {
  fail(`missing expected backend host permission: ${expectedHostPermission}`)
}
for (const permission of ["activeTab"]) {
  if ((manifest.permissions ?? []).includes(permission)) {
    fail(`permission is not allowed in the release package: ${permission}`)
  }
}
for (const host of [
  "https://*.media-amazon.com/*",
  "https://*.ssl-images-amazon.com/*",
  "https://*.usercontent.google.com/*",
  "https://*.googleapis.com/*"
]) {
  if (hostPermissions.includes(host)) {
    fail(`host permission has no approved runtime use: ${host}`)
  }
}

for (const requiredHost of [
  "https://photos.google.com/*",
  ...ICLOUD_WAR_MATCHES,
  ...AMAZON_WAR_MATCHES,
  ...AMAZON_MARKETPLACE_HOSTS.map(
    (host) => `https://thumbnails-photos.${host}/*`
  )
]) {
  if (!hostPermissions.includes(requiredHost)) {
    fail(`missing required regional provider host permission: ${requiredHost}`)
  }
}
if (
  hostPermissions.includes("https://www.amazon.be/*") ||
  hostPermissions.includes("https://amazon.be/*")
) {
  fail("obsolete Belgium Amazon host permission must be replaced by amazon.com.be")
}
for (const host of hostPermissions) {
  if (host.includes("localhost") || host.includes("127.0.0.1")) {
    fail(`localhost host permission is not allowed in release package: ${host}`)
  }
  if (host.includes("$PLASMO_PUBLIC_")) {
    fail(`unresolved manifest environment variable: ${host}`)
  }
}

const files = fs.existsSync(buildDir) ? walk(buildDir) : []
const jsFiles = files.filter((file) => file.endsWith(".js"))
const jsText = jsFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n")

const amazonContentScriptMatches = (manifest.content_scripts ?? [])
  .flatMap((script) => script.matches ?? [])
  .filter((match) => match.includes("amazon."))
const amazonWebAccessibleMatches = (manifest.web_accessible_resources ?? [])
  .flatMap((entry) => entry.matches ?? [])
  .filter((match) => match.includes("amazon."))
if (amazonContentScriptMatches.some((match) => !/^https:\/\/(?:www\.)?amazon\.[^/]+\/photos\*$/.test(match))) {
  fail("Amazon content scripts must be limited to /photos routes")
}
if (amazonWebAccessibleMatches.some((match) => !/^https:\/\/(?:www\.)?amazon\.[^/]+\/\*$/.test(match))) {
  fail("Amazon web-accessible resources must use origin-scoped /* match patterns")
}
for (const requiredMatch of AMAZON_CONTENT_MATCHES) {
  if (!amazonContentScriptMatches.includes(requiredMatch)) {
    fail(`missing Amazon regional content-script match: ${requiredMatch}`)
  }
}
for (const actualMatch of amazonContentScriptMatches) {
  if (!AMAZON_CONTENT_MATCHES.includes(actualMatch)) {
    fail(`unexpected Amazon content-script match: ${actualMatch}`)
  }
}
for (const requiredMatch of AMAZON_WAR_MATCHES) {
  if (!amazonWebAccessibleMatches.includes(requiredMatch)) {
    fail(`missing Amazon regional web-accessible match: ${requiredMatch}`)
  }
}
for (const actualMatch of amazonWebAccessibleMatches) {
  if (!AMAZON_WAR_MATCHES.includes(actualMatch)) {
    fail(`unexpected Amazon web-accessible match: ${actualMatch}`)
  }
}

const icloudContentMatches = (manifest.content_scripts ?? [])
  .flatMap((script) => script.matches ?? [])
  .filter((match) => match.includes("icloud.com"))
const icloudWebAccessibleMatches = (manifest.web_accessible_resources ?? [])
  .flatMap((entry) => entry.matches ?? [])
  .filter((match) => match.includes("icloud.com"))
for (const requiredMatch of ICLOUD_WAR_MATCHES) {
  if (!icloudContentMatches.includes(requiredMatch)) {
    fail(`missing iCloud regional content-script match: ${requiredMatch}`)
  }
  if (!icloudWebAccessibleMatches.includes(requiredMatch)) {
    fail(`missing iCloud regional web-accessible match: ${requiredMatch}`)
  }
}

const googleContentMatches = (manifest.content_scripts ?? [])
  .flatMap((script) => script.matches ?? [])
if (!googleContentMatches.includes("https://photos.google.com/*")) {
  fail("missing canonical Google Photos content-script match")
}

if (expectedApiBase && !jsText.includes(expectedApiBase)) {
  fail(`built JavaScript does not contain expected API base URL: ${expectedApiBase}`)
}
if (jsText.includes("http://127.0.0.1") || jsText.includes("http://localhost")) {
  fail("built JavaScript contains localhost API URL")
}
if (jsText.includes("PLASMO_PUBLIC_PHOTOSWEEP")) {
  fail("built JavaScript contains unresolved PLASMO_PUBLIC env variable")
}
if (jsText.includes("photoSweepDevEntitlement") && process.env.PHOTOSWEEP_AUDIT_STRICT_DEV_KEY_ABSENCE === "1") {
  fail("built JavaScript contains photoSweepDevEntitlement while strict absence is required")
}
for (const [label, pattern] of [
  ["literal remote script", /<script[^>]+src\s*=\s*[\"']https?:/i],
  ["literal remote importScripts", /importScripts\(\s*[\"']https?:/i],
  ["literal remote dynamic import", /import\(\s*[\"']https?:/i],
  ["eval", /\beval\s*\(/],
  ["new Function", /\bnew\s+Function\s*\(/]
]) {
  if (pattern.test(jsText)) fail(`built JavaScript contains ${label}`)
}

if (process.exitCode) process.exit(process.exitCode)
console.log(JSON.stringify({
  ok: true,
  buildDir,
  manifestVersion: manifest.manifest_version,
  name: manifest.name,
  description: manifest.description,
  appVersion: packageJson.version,
  chromeVersion: manifest.version,
  sidePanel: manifest.side_panel?.default_path,
  backendHostPermission: expectedHostPermission,
  hostPermissionCount: hostPermissions.length,
  jsFileCount: jsFiles.length
}, null, 2))
