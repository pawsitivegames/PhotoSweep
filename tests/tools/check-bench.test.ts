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

function benchmarkOutput(mean: number) {
  return {
    files: [{ groups: [{ benchmarks: [{ name: "render", mean }] }] }]
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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("benchmark regression tools", () => {
  it("skips a benchmark until three history samples exist", () => {
    const dir = makeTempDir()
    writeJson(join(dir, "bench-output.json"), benchmarkOutput(120))
    writeJson(join(dir, "tests/perf/bench-history.json"), [
      { means: { render: 100 } },
      { means: { render: 110 } }
    ])

    const result = runTool("check-bench.mjs", dir)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("only 2 historical sample(s)")
  })

  it("compares against the rolling median and catches a real regression", () => {
    const dir = makeTempDir()
    writeJson(join(dir, "bench-output.json"), benchmarkOutput(140))
    writeJson(join(dir, "tests/perf/bench-history.json"), [
      { means: { render: 100 } },
      { means: { render: 110 } },
      { means: { render: 120 } }
    ])

    const result = runTool("check-bench.mjs", dir)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("REGRESSION")
    expect(result.stderr).toContain("rolling median 110ms")
  })

  it("retains only the five newest history samples", () => {
    const dir = makeTempDir()
    writeJson(join(dir, "bench-output.json"), benchmarkOutput(160))
    writeJson(
      join(dir, "tests/perf/bench-history.json"),
      Array.from({ length: 5 }, (_, index) => ({
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
    expect(history).toHaveLength(5)
    expect(history[0].sha).toBe("old-1")
    expect(history[4].sha).toBe("new-sha")
  })
})
