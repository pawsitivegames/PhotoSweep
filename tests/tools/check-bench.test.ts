import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

const toolDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../tools")
const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "photosweep-bench-"))
  tempDirs.push(dir)
  return dir
}

function benchmarkOutput(means: Record<string, number> | number) {
  const entries =
    typeof means === "number" ? { render: means } : means
  return {
    files: [
      {
        groups: [
          {
            benchmarks: Object.entries(entries).map(([name, mean]) => ({
              name,
              mean
            }))
          }
        ]
      }
    ]
  }
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value), "utf8")
}

function runTool(
  script: string,
  cwd: string,
  env: Record<string, string> = {}
) {
  return spawnSync(process.execPath, [join(toolDir, script)], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env }
  })
}

function rollingHistory(
  samples: Array<Record<string, number>>
): Array<{ means: Record<string, number> }> {
  return samples.map((means) => ({ means }))
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("benchmark regression tools", () => {
  it("skips a benchmark until three history samples exist", () => {
    const dir = makeTempDir()
    writeJson(join(dir, "bench-output.json"), benchmarkOutput(120))
    writeJson(
      join(dir, "tests/perf/bench-history.json"),
      rollingHistory([{ render: 100 }, { render: 110 }])
    )

    const result = runTool("check-bench.mjs", dir)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("only 2 historical sample(s)")
  })

  it("compares against the rolling median and catches a real regression", () => {
    const dir = makeTempDir()
    writeJson(join(dir, "bench-output.json"), benchmarkOutput(140))
    writeJson(
      join(dir, "tests/perf/bench-history.json"),
      rollingHistory([{ render: 100 }, { render: 110 }, { render: 120 }])
    )

    const result = runTool("check-bench.mjs", dir)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("REGRESSION")
    expect(result.stderr).toContain("rolling median 110ms")
  })

  it("treats a uniform slowdown across sibling benches as runner noise", () => {
    const dir = makeTempDir()
    // Mirrors CI run 34285539735: all three 10k-group benches moved ~+28–38%
    // on a no-product-change commit versus a tight cluster of fast history.
    writeJson(
      join(dir, "bench-output.json"),
      benchmarkOutput({
        load: 245,
        "toggle-group": 373,
        "toggle-kept": 370
      })
    )
    writeJson(
      join(dir, "tests/perf/bench-history.json"),
      rollingHistory([
        { load: 184, "toggle-group": 267, "toggle-kept": 268 },
        { load: 192, "toggle-group": 270, "toggle-kept": 270 },
        { load: 200, "toggle-group": 272, "toggle-kept": 271 },
        { load: 192, "toggle-group": 270, "toggle-kept": 270 }
      ])
    )

    const result = runTool("check-bench.mjs", dir)

    expect(result.status).toBe(0)
    expect(result.stderr).not.toContain("REGRESSION")
    expect(result.stdout).toContain("RUNNER NOISE")
    expect(result.stdout).toContain("uniform slowdown")
  })

  it("still fails when one bench regresses and siblings do not", () => {
    const dir = makeTempDir()
    writeJson(
      join(dir, "bench-output.json"),
      benchmarkOutput({
        load: 200,
        "toggle-group": 400,
        "toggle-kept": 275
      })
    )
    writeJson(
      join(dir, "tests/perf/bench-history.json"),
      rollingHistory([
        { load: 190, "toggle-group": 270, "toggle-kept": 270 },
        { load: 192, "toggle-group": 270, "toggle-kept": 268 },
        { load: 194, "toggle-group": 272, "toggle-kept": 271 }
      ])
    )

    const result = runTool("check-bench.mjs", dir)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("toggle-group")
    expect(result.stderr).toContain("REGRESSION")
    expect(result.stdout).not.toContain("RUNNER NOISE")
  })

  it("always fails a 2x regression even if every bench moved together", () => {
    const dir = makeTempDir()
    writeJson(
      join(dir, "bench-output.json"),
      benchmarkOutput({
        load: 400,
        "toggle-group": 560,
        "toggle-kept": 550
      })
    )
    writeJson(
      join(dir, "tests/perf/bench-history.json"),
      rollingHistory([
        { load: 190, "toggle-group": 270, "toggle-kept": 270 },
        { load: 192, "toggle-group": 270, "toggle-kept": 268 },
        { load: 194, "toggle-group": 272, "toggle-kept": 271 }
      ])
    )

    const result = runTool("check-bench.mjs", dir)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("REGRESSION")
    expect(result.stdout).not.toContain("RUNNER NOISE")
  })

  it("retains only the ten newest history samples", () => {
    const dir = makeTempDir()
    writeJson(join(dir, "bench-output.json"), benchmarkOutput(160))
    writeJson(
      join(dir, "tests/perf/bench-history.json"),
      Array.from({ length: 10 }, (_, index) => ({
        sha: `old-${index}`,
        means: { render: 100 + index }
      }))
    )

    const result = runTool("update-bench-history.mjs", dir, {
      GITHUB_SHA: "new-sha"
    })
    const history = JSON.parse(
      readFileSync(join(dir, "tests/perf/bench-history.json"), "utf8")
    ) as Array<{ sha: string }>

    expect(result.status).toBe(0)
    expect(history).toHaveLength(10)
    expect(history[0].sha).toBe("old-1")
    expect(history[9].sha).toBe("new-sha")
  })
})
