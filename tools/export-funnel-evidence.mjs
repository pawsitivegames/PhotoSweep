import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { Firestore } from "@google-cloud/firestore"

import { buildFunnelEvidenceSummary } from "../server/funnel-evidence.mjs"

const DEFAULT_COLLECTION_PREFIX = "photosweep"

function usage() {
  return `Usage:
  node tools/export-funnel-evidence.mjs --current-version <version> [options]

Options:
  --current-version <version>  Published Chrome version used for old-version share
  --from <YYYY-MM-DD>           Inclusive UTC day-key lower bound
  --to <YYYY-MM-DD>             Inclusive UTC day-key upper bound
  --output <path>               Write JSON to a file instead of stdout
  --help                        Show this help

Credentials are read by @google-cloud/firestore from the normal Google Cloud
environment. The export contains counts, version distributions, and derived
metrics; it never writes event rows or install IDs.
`
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--help") {
      options.help = true
      continue
    }
    const match = argument.match(/^--([^=]+)=(.*)$/)
    const key = match?.[1] ?? argument.replace(/^--/, "")
    const inlineValue = match?.[2]
    if (!["current-version", "from", "to", "output"].includes(key)) {
      throw new Error(`Unknown option: ${argument}`)
    }
    const value = inlineValue ?? argv[++index]
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}.`)
    }
    options[key] = value
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }
  const currentVersion =
    options["current-version"] ?? process.env.PHOTOSWEEP_CURRENT_CHROME_VERSION
  if (!currentVersion) {
    throw new Error(
      "Set PHOTOSWEEP_CURRENT_CHROME_VERSION or pass --current-version."
    )
  }

  const collectionPrefix =
    process.env.PHOTOSWEEP_FIRESTORE_COLLECTION_PREFIX ??
    DEFAULT_COLLECTION_PREFIX
  const collectionName = `${collectionPrefix}_analytics_events`
  const firestore = new Firestore()
  const snapshot = await firestore.collection(collectionName).get()
  const rows = snapshot.docs.map((doc) => doc.data())
  const summary = buildFunnelEvidenceSummary(rows, {
    currentVersion,
    ...(options.from ? { from: options.from } : {}),
    ...(options.to ? { to: options.to } : {})
  })
  const output = `${JSON.stringify(
    {
      collection: collectionName,
      ...summary
    },
    null,
    2
  )}\n`

  if (options.output) {
    await mkdir(path.dirname(options.output), { recursive: true })
    await writeFile(options.output, output, "utf8")
    return
  }
  process.stdout.write(output)
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exitCode = 1
})
