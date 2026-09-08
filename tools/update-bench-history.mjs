#!/usr/bin/env node
// Append a successful main-branch benchmark run, retaining only the most
// recent samples used by tools/check-bench.mjs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { dirname } from "path"

import { extractMeans } from "./bench-lib.mjs"

const MAX_HISTORY = 10
// Keep enough main-branch samples that a lucky-fast cluster cannot
// dominate the median after a few typical shared-runner runs.
const HISTORY_PATH = "tests/perf/bench-history.json"

const history = existsSync(HISTORY_PATH)
  ? JSON.parse(readFileSync(HISTORY_PATH, "utf8"))
  : []

history.push({
  sha: process.env.GITHUB_SHA ?? "unknown",
  timestamp: new Date().toISOString(),
  means: extractMeans("bench-output.json")
})

const retainedHistory = history.slice(-MAX_HISTORY)
mkdirSync(dirname(HISTORY_PATH), { recursive: true })
writeFileSync(HISTORY_PATH, JSON.stringify(retainedHistory, null, 2) + "\n")
console.log(
  `Appended run to ${HISTORY_PATH} (${retainedHistory.length}/${MAX_HISTORY} samples retained)`
)
