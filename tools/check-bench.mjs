#!/usr/bin/env node
// Compare the current benchmark run with a rolling history of main-branch
// runs. Shared CI runners have enough VM-to-VM variance that one-run baselines
// are too noisy for a reliable regression gate.
import { existsSync, readFileSync } from "fs"

import { extractMeans } from "./bench-lib.mjs"

const THRESHOLD = 1.2
const MIN_HISTORY_SAMPLES = 3
const HISTORY_PATH = "tests/perf/bench-history.json"

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

if (!existsSync("bench-output.json")) {
  console.error("bench-output.json not found — run vitest bench first")
  process.exit(1)
}

const current = extractMeans("bench-output.json")

if (!existsSync(HISTORY_PATH)) {
  console.log("No benchmark history found — skipping regression check")
  process.exit(0)
}

const history = JSON.parse(readFileSync(HISTORY_PATH, "utf8"))
let failed = false

for (const [name, currentMean] of Object.entries(current)) {
  const historicalMeans = history
    .map((run) => run.means?.[name])
    .filter((mean) => typeof mean === "number")

  if (historicalMeans.length < MIN_HISTORY_SAMPLES) {
    console.log(
      `…  "${name}": only ${historicalMeans.length} historical sample(s) — skipping (need ${MIN_HISTORY_SAMPLES})`
    )
    continue
  }

  const baselineMean = median(historicalMeans)
  const ratio = currentMean / baselineMean
  const pct = ((ratio - 1) * 100).toFixed(1)
  const sign = ratio >= 1 ? "+" : ""

  if (ratio > THRESHOLD) {
    console.error(
      `✗  REGRESSION "${name}": ${currentMean.toFixed(0)}ms vs rolling median ${baselineMean.toFixed(0)}ms over ${historicalMeans.length} runs (${sign}${pct}%, limit +${((THRESHOLD - 1) * 100).toFixed(0)}%)`
    )
    failed = true
  } else {
    console.log(
      `✓  "${name}": ${currentMean.toFixed(0)}ms vs rolling median ${baselineMean.toFixed(0)}ms over ${historicalMeans.length} runs (${sign}${pct}%)`
    )
  }
}

if (failed) process.exit(1)
