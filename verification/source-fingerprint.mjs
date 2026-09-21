import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve, sep } from "node:path"

export const DEFAULT_SOURCE_ROOTS = [
  "lib",
  "components",
  "tabs",
  "scripts",
  "workers",
  "background",
  "contents",
  "server",
  ".github",
  "Google-Photos-Toolkit",
  "tests",
  "verification",
  "tools",
  "package.json",
  "stryker.config.mjs",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".env.example",
  "lib/generated/build-flags.ts",
  "tsconfig.json",
  "tsconfig.test.json",
  "vitest.config.ts",
  "playwright.config.ts",
  "playwright.e2e.config.ts",
  "build/chrome-mv3-prod/manifest.json"
]

function normalizePath(value) {
  return value.split(sep).join("/")
}

function shouldInclude(path) {
  const normalized = normalizePath(path)
  return (
    !normalized.startsWith("tmp/") &&
    !normalized.includes("/tmp/") &&
    normalized !== "states" &&
    !normalized.startsWith("states/") &&
    !normalized.startsWith("verification/model/states/") &&
    !normalized.startsWith("verification/evidence/") &&
    !normalized.endsWith("/verification/evidence")
  )
}

function sourceContent(root, file) {
  const content = readFileSync(resolve(root, file))
  if (file !== "build/chrome-mv3-prod/manifest.json") return content

  // Plasmo can emit content_scripts in different filesystem traversal orders
  // between otherwise identical production builds. The order of entries for
  // different provider match sets is not an application decision, so bind the
  // source fingerprint to a stable semantic ordering while package evidence
  // continues to retain the raw manifest bytes.
  try {
    const manifest = JSON.parse(content.toString("utf8"))
    if (Array.isArray(manifest.content_scripts)) {
      manifest.content_scripts = [...manifest.content_scripts].sort((left, right) =>
        JSON.stringify([
          left?.matches ?? [],
          left?.js ?? [],
          left?.css ?? [],
          left?.run_at ?? null,
          left?.all_frames ?? false
        ]).localeCompare(
          JSON.stringify([
            right?.matches ?? [],
            right?.js ?? [],
            right?.css ?? [],
            right?.run_at ?? null,
            right?.all_frames ?? false
          ])
        )
      )
    }
    return Buffer.from(JSON.stringify(manifest))
  } catch {
    return content
  }
}

export function listSourceFiles(root, sourceRoots = DEFAULT_SOURCE_ROOTS) {
  const output = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...sourceRoots
    ],
    { cwd: root }
  )
  const trackedOrUntracked = output.toString("utf8").split("\0")
  // Generated build flags are intentionally ignored by Git but materially
  // change production entitlement behavior. Include explicit existing file
  // roots even when Git's exclude-standard omits them.
  const explicitFiles = sourceRoots.filter((sourceRoot) => {
    const absolute = resolve(root, sourceRoot)
    return existsSync(absolute) && statSync(absolute).isFile()
  })
  return [...new Set([...trackedOrUntracked, ...explicitFiles])]
    .filter(Boolean)
    .filter(shouldInclude)
    .sort()
}

export function computeSourceFingerprint(
  root = process.cwd(),
  sourceRoots = DEFAULT_SOURCE_ROOTS
) {
  const hash = createHash("sha256")
  const files = listSourceFiles(root, sourceRoots)
  for (const file of files) {
    const absolute = resolve(root, file)
    hash.update(file)
    hash.update("\0")
    if (statSync(absolute).isDirectory()) {
      // A Git submodule is represented by a directory at the parent level.
      // Bind the verification to its checked-out commit without reading its
      // potentially large generated dependency tree.
      let revision = "unavailable"
      try {
        revision = execFileSync("git", ["-C", absolute, "rev-parse", "HEAD"], {
          encoding: "utf8"
        }).trim()
      } catch {
        // The unavailable revision is still part of the digest and therefore
        // cannot silently validate as a known checkout.
      }
      hash.update(`submodule:${revision}`)
    } else {
      hash.update(sourceContent(root, file))
    }
    hash.update("\0")
  }
  return {
    algorithm: "sha256",
    digest: hash.digest("hex"),
    fileCount: files.length,
    files
  }
}

export function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) return false
  const normalized = value.split("\\").join("/")
  return (
    !normalized.startsWith("/") &&
    !normalized.split("/").includes("..") &&
    normalized !== "." &&
    normalized !== ""
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd()
  process.stdout.write(`${JSON.stringify(computeSourceFingerprint(root), null, 2)}\n`)
}
