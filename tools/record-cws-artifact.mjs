import { createHash } from "node:crypto"
import { copyFile, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"

import {
  cwsArtifactFileName,
  cwsArtifactMetadataFileName,
  getCwsReleaseIdentity
} from "./cws-artifact.mjs"

const rootDir = process.cwd()
const buildDir = path.join(rootDir, "build", "chrome-mv3-prod")
const packagedZip = path.join(rootDir, "build", "chrome-mv3-prod.zip")
const manifestPath = path.join(buildDir, "manifest.json")

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function gitOutput(args) {
  const result = spawnSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  })
  if (result.status !== 0) return ""
  return result.stdout.trim()
}

function gitBuffer(args) {
  const result = spawnSync("git", args, {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "ignore"]
  })
  if (result.status !== 0 || !result.stdout) return Buffer.alloc(0)
  return result.stdout
}

const packageJson = JSON.parse(
  await readFile(path.join(rootDir, "package.json"), "utf8")
)
const { appVersion, chromeVersion } = getCwsReleaseIdentity(packageJson)
const [manifest, zip] = await Promise.all([
  readFile(manifestPath),
  readFile(packagedZip)
])
const manifestJson = JSON.parse(manifest.toString("utf8"))

if (manifestJson.version !== chromeVersion) {
  throw new Error(
    `Built manifest version ${manifestJson.version} does not match configured Chrome version ${chromeVersion}`
  )
}

const zipSha256 = sha256(zip)
const manifestSha256 = sha256(manifest)
const artifactFileName = cwsArtifactFileName(chromeVersion, zipSha256)
const artifactPath = path.join(rootDir, "build", artifactFileName)
const metadataPath = path.join(
  rootDir,
  "build",
  cwsArtifactMetadataFileName(artifactFileName)
)
// Keep the status probe bounded. This workspace retains many generated
// verification files, and asking Git to enumerate every untracked descendant
// can exceed spawnSync's output buffer. Normal mode still reports untracked
// directories while preserving the dirty-worktree signal.
const status = gitOutput(["status", "--porcelain=v1", "--untracked-files=normal"])
const trackedDiff = gitBuffer(["diff", "--binary", "HEAD"])

await copyFile(packagedZip, artifactPath)

const metadata = {
  schemaVersion: 1,
  artifactType: "chrome-web-store-zip",
  appVersion,
  chromeVersion,
  artifactFile: path.relative(rootDir, artifactPath),
  artifactSha256: zipSha256,
  manifestSha256,
  sourceCommit: gitOutput(["rev-parse", "HEAD"]),
  sourceDirty: status.length > 0,
  sourceStatusSha256: sha256(status),
  trackedDiffSha256: sha256(trackedDiff),
  builtAt: new Date().toISOString()
}

await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8")
console.log(JSON.stringify(metadata, null, 2))
