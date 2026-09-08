#!/usr/bin/env node
// Compare the current benchmark run with a rolling history of main-branch
// runs. Shared CI runners have enough VM-to-VM variance that one-run baselines
// are too noisy for a reliable regression gate.
import { existsSync, readFileSync } from "fs"

import { evaluateBenchmarks, extractMeans } from "./bench-lib.mjs"

const HISTORY_PATH = "tests/perf/bench-history.json"

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
const { failed, reports } = evaluateBenchmarks(current, history)

for (const report of reports) {
  if (report.stream === "stderr") {
    console.error(report.text)
  } else {
    console.log(report.text)
  }
}

if (failed) process.exit(1)
