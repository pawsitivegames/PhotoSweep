import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { computeSourceFingerprint } from "../verification/source-fingerprint.mjs"
import {
  createCwsArtifactMetadata,
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
  if (result.error) {
    throw new Error(`git ${args.join(" ")} failed: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} exited with ${
        result.status ?? result.signal ?? "unknown"
      }`
    )
  }
  return result.stdout.trim()
}

async function gitSha256(args) {
  const hash = createHash("sha256")
  await new Promise((resolve, reject) => {
    const gitProcess = spawn("git", args, {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "ignore"]
    })
    gitProcess.stdout.on("data", (chunk) => hash.update(chunk))
    gitProcess.stdout.on("error", reject)
    gitProcess.once("error", reject)
    gitProcess.once("close", (code, signal) => {
      if (code !== 0) {
        reject(
          new Error(
            `git ${args.join(" ")} exited with ${
              code ?? signal ?? "unknown"
            }`
          )
        )
        return
      }
      resolve()
    })
  })
  return hash.digest("hex")
}

async function containsBuildId(directory, buildId) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (await containsBuildId(entryPath, buildId)) return true
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      if ((await readFile(entryPath, "utf8")).includes(buildId)) return true
    }
  }
  return false
}

const packageJson = JSON.parse(
  await readFile(path.join(rootDir, "package.json"), "utf8")
)
const { appVersion, chromeVersion } = getCwsReleaseIdentity(packageJson)
const buildId = process.env.PHOTOSWEEP_PACKAGE_BUILD_ID
if (!buildId)
  throw new Error(
    "PHOTOSWEEP_PACKAGE_BUILD_ID is required to record a CWS artifact"
  )
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
if (!(await containsBuildId(buildDir, buildId))) {
  throw new Error(
    "The built extension JavaScript does not contain the package build ID"
  )
}

const requirements = JSON.parse(
  await readFile(
    path.join(rootDir, "verification", "requirements.json"),
    "utf8"
  )
)
if (
  !Array.isArray(requirements.sourceRoots) ||
  requirements.sourceRoots.length === 0
) {
  throw new Error(
    "verification/requirements.json must define non-empty sourceRoots"
  )
}
const sourceFingerprint = computeSourceFingerprint(
  rootDir,
  requirements.sourceRoots
)

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
const status = gitOutput([
  "status",
  "--porcelain=v1",
  "--untracked-files=normal"
])
const trackedDiffSha256 = await gitSha256(["diff", "--binary", "HEAD"])

await copyFile(packagedZip, artifactPath)

const metadata = createCwsArtifactMetadata({
  appVersion,
  chromeVersion,
  artifactFile: path.relative(rootDir, artifactPath),
  artifactSha256: zipSha256,
  manifestSha256,
  sourceCommit: gitOutput(["rev-parse", "HEAD"]),
  sourceDirty: status.length > 0,
  sourceStatusSha256: sha256(status),
  trackedDiffSha256,
  sourceFingerprint: sourceFingerprint.digest,
  sourceFileCount: sourceFingerprint.fileCount,
  buildId,
  builtAt: new Date().toISOString()
})

await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8")
console.log(JSON.stringify(metadata, null, 2))
