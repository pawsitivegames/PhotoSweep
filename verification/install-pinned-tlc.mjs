import { createHash } from "node:crypto"
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const PINNED_TLC_VERSION = "1.8.0"
export const PINNED_TLC_SHA256 =
  "7beec0f04818732a62fa193731711a99aa4f11279499b2360a7d156c519ea78d"
export const PINNED_TLC_SOURCE_PATH = join(
  "verification",
  "tooling",
  `tla2tools-${PINNED_TLC_VERSION}.jar`
)
export const DEFAULT_TLC_OUTPUT_PATH = join(
  "tmp",
  "verification",
  "ci-tlc",
  "tooling",
  `tla2tools-${PINNED_TLC_VERSION}.jar`
)

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

export function installPinnedTlcJar(
  root = process.cwd(),
  outputPath = DEFAULT_TLC_OUTPUT_PATH
) {
  const absoluteRoot = resolve(root)
  const sourcePath = resolve(absoluteRoot, PINNED_TLC_SOURCE_PATH)
  const destinationPath = isAbsolute(outputPath)
    ? resolve(outputPath)
    : resolve(absoluteRoot, outputPath)

  let sourceStat
  try {
    sourceStat = lstatSync(sourcePath)
  } catch {
    throw new Error(`Vendored TLC ${PINNED_TLC_VERSION} is unavailable: ${sourcePath}`)
  }
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`Vendored TLC input is not a regular file: ${sourcePath}`)
  }

  const sourceBytes = readFileSync(sourcePath)
  const sourceSha256 = sha256(sourceBytes)
  if (sourceSha256 !== PINNED_TLC_SHA256) {
    throw new Error(
      `Vendored TLC integrity mismatch: expected ${PINNED_TLC_SHA256}, got ${sourceSha256}`
    )
  }

  mkdirSync(dirname(destinationPath), { recursive: true })
  writeFileSync(destinationPath, sourceBytes, { mode: 0o644 })

  const destinationStat = lstatSync(destinationPath)
  if (!destinationStat.isFile() || destinationStat.isSymbolicLink()) {
    throw new Error(`Installed TLC output is not a regular file: ${destinationPath}`)
  }
  const destinationSha256 = sha256(readFileSync(destinationPath))
  if (destinationSha256 !== PINNED_TLC_SHA256) {
    throw new Error(
      `Installed TLC integrity mismatch: expected ${PINNED_TLC_SHA256}, got ${destinationSha256}`
    )
  }

  return {
    path: relative(absoluteRoot, destinationPath),
    sha256: destinationSha256,
    bytes: destinationStat.size
  }
}

function parseOutputPath(args) {
  if (args.length === 0) return DEFAULT_TLC_OUTPUT_PATH
  if (args.length !== 2 || args[0] !== "--output" || !args[1]?.trim()) {
    throw new Error(
      "Usage: node verification/install-pinned-tlc.mjs [--output <path>]"
    )
  }
  return args[1].trim()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = installPinnedTlcJar(process.cwd(), parseOutputPath(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
