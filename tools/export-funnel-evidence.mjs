import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { Firestore } from "@google-cloud/firestore"

import { buildFunnelEvidenceSummary } from "../server/funnel-evidence.mjs"

const DEFAULT_COLLECTION_PREFIX = "photosweep"

function usage() {
  return `Usage:
  node tools/export-funnel-evidence.mjs --current-version <version> [options]

Options:
  --current-version <version>  Published Chrome version used for old-version share
  --from <YYYY-MM-DD>           Inclusive observation-window lower bound
  --to <YYYY-MM-DD>             Inclusive observation-window upper bound
  --cohort-from <YYYY-MM-DD>    Inclusive fixed D7 cohort lower bound
  --cohort-to <YYYY-MM-DD>      Inclusive fixed D7 cohort upper bound
  --history-from <YYYY-MM-DD>  Operator-attested complete available history start
  --history-through <YYYY-MM-DD>  Operator-attested last fully observed UTC day
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
    if (
      ![
        "current-version",
        "from",
        "to",
        "cohort-from",
        "cohort-to",
        "history-from",
        "history-through",
        "output"
      ].includes(key)
    ) {
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

export async function runFunnelEvidenceExport({
  argv = process.argv.slice(2),
  env = process.env,
  firestoreFactory = undefined
} = {}) {
  const options = parseArgs(argv)
  if (options.help) return { help: usage() }
  const currentVersion =
    options["current-version"] ?? env.PHOTOSWEEP_CURRENT_CHROME_VERSION
  if (!currentVersion) {
    throw new Error(
      "Set PHOTOSWEEP_CURRENT_CHROME_VERSION or pass --current-version."
    )
  }

  const collectionPrefix =
    env.PHOTOSWEEP_FIRESTORE_COLLECTION_PREFIX ??
    DEFAULT_COLLECTION_PREFIX
  const collectionName = `${collectionPrefix}_analytics_events`
  const databaseId = env.PHOTOSWEEP_FIRESTORE_DATABASE_ID
  const createFirestore = firestoreFactory ?? ((clientOptions) =>
    clientOptions ? new Firestore(clientOptions) : new Firestore()
  )
  const firestore = databaseId
    ? createFirestore({ databaseId })
    : createFirestore()
  const snapshot = await firestore.collection(collectionName).get()
  const rows = snapshot.docs.map((doc) => doc.data())
  const summary = buildFunnelEvidenceSummary(rows, {
    currentVersion,
    historyFrom: options["history-from"],
    historyThrough: options["history-through"],
    ...(options.from ? { from: options.from } : {}),
    ...(options.to ? { to: options.to } : {}),
    ...(options["cohort-from"]
      ? { cohortFrom: options["cohort-from"] }
      : {}),
    ...(options["cohort-to"] ? { cohortTo: options["cohort-to"] } : {})
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
    return { outputPath: options.output, summary }
  }
  return { serialized: output, summary }
}

const currentFile = fileURLToPath(import.meta.url)
const invokedFile = process.argv[1]
  ? fileURLToPath(pathToFileURL(process.argv[1]))
  : ""

if (currentFile === invokedFile) {
  runFunnelEvidenceExport()
    .then((result) => {
      if (result.help) {
        process.stdout.write(result.help)
      } else if (result.serialized) {
        process.stdout.write(result.serialized)
      } else {
        process.stdout.write(`Wrote ${result.outputPath}\n`)
      }
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      )
      process.exitCode = 1
    })
}
