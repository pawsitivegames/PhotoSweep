// Shared helpers for the benchmark check and history updater.

import { readFileSync } from "fs"

export function extractMeans(jsonPath) {
  const data = JSON.parse(readFileSync(jsonPath, "utf8"))
  const means = {}
  for (const file of data.files) {
    for (const group of file.groups) {
      for (const bench of group.benchmarks) {
        means[bench.name] = bench.mean
      }
    }
  }
  return means
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

// Shared GitHub-hosted runners swing ~30–45% on these 10k-row React benches
// (seen on no-product-change commits such as the Dockerfile-only #6 run).
// Soft threshold still flags a single-path regression; a 2× move always fails.
export const CHECK_BENCH = {
  THRESHOLD: 1.2,
  HARD_THRESHOLD: 2.0,
  MIN_HISTORY_SAMPLES: 3,
  UNIFORM_RATIO_SPREAD: 0.2,
  UNIFORM_MAX_RATIO: 1.55
}

/**
 * Compare current bench means to a rolling history.
 * A uniform slowdown across every comparable bench is treated as runner
 * noise unless any bench exceeds HARD_THRESHOLD or UNIFORM_MAX_RATIO.
 */
export function evaluateBenchmarks(current, history) {
  const comparisons = []

  for (const [name, currentMean] of Object.entries(current)) {
    const historicalMeans = history
      .map((run) => run.means?.[name])
      .filter((mean) => typeof mean === "number")

    if (historicalMeans.length < CHECK_BENCH.MIN_HISTORY_SAMPLES) {
      comparisons.push({
        name,
        status: "skip",
        currentMean,
        samples: historicalMeans.length
      })
      continue
    }

    const baselineMean = median(historicalMeans)
    const ratio = currentMean / baselineMean
    comparisons.push({
      name,
      status: "compare",
      currentMean,
      baselineMean,
      ratio,
      samples: historicalMeans.length
    })
  }

  const comparable = comparisons.filter((row) => row.status === "compare")
  const ratios = comparable.map((row) => row.ratio)
  const spread =
    ratios.length >= 2 ? Math.max(...ratios) - Math.min(...ratios) : Infinity
  const maxRatio = ratios.length > 0 ? Math.max(...ratios) : 0
  const uniformRunnerNoise =
    comparable.length >= 2 &&
    maxRatio > CHECK_BENCH.THRESHOLD &&
    maxRatio <= CHECK_BENCH.UNIFORM_MAX_RATIO &&
    spread <= CHECK_BENCH.UNIFORM_RATIO_SPREAD &&
    comparable.every((row) => row.ratio <= CHECK_BENCH.HARD_THRESHOLD)

  const reports = []
  let failed = false

  for (const row of comparisons) {
    if (row.status === "skip") {
      reports.push({
        ok: true,
        stream: "stdout",
        text: `…  "${row.name}": only ${row.samples} historical sample(s) — skipping (need ${CHECK_BENCH.MIN_HISTORY_SAMPLES})`
      })
      continue
    }

    const pct = ((row.ratio - 1) * 100).toFixed(1)
    const sign = row.ratio >= 1 ? "+" : ""
    const limitPct = ((CHECK_BENCH.THRESHOLD - 1) * 100).toFixed(0)
    const summary = `"${row.name}": ${row.currentMean.toFixed(0)}ms vs rolling median ${row.baselineMean.toFixed(0)}ms over ${row.samples} runs (${sign}${pct}%, limit +${limitPct}%)`

    if (row.ratio > CHECK_BENCH.HARD_THRESHOLD) {
      failed = true
      reports.push({
        ok: false,
        stream: "stderr",
        text: `✗  REGRESSION ${summary}`
      })
      continue
    }

    if (row.ratio > CHECK_BENCH.THRESHOLD && uniformRunnerNoise) {
      reports.push({
        ok: true,
        stream: "stdout",
        text: `~  RUNNER NOISE ${summary} — uniform slowdown across ${comparable.length} benches (spread ${((spread) * 100).toFixed(1)}pp, max +${((maxRatio - 1) * 100).toFixed(1)}%)`
      })
      continue
    }

    if (row.ratio > CHECK_BENCH.THRESHOLD) {
      failed = true
      reports.push({
        ok: false,
        stream: "stderr",
        text: `✗  REGRESSION ${summary}`
      })
      continue
    }

    reports.push({
      ok: true,
      stream: "stdout",
      text: `✓  ${summary}`
    })
  }

  return { failed, reports, uniformRunnerNoise }
}
