import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import fastGlob from "fast-glob"
import { describe, expect, it } from "vitest"

async function withFixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "photosweep-fast-glob-"))
  try {
    await mkdir(join(root, "src", "nested"), { recursive: true })
    await writeFile(join(root, "src", "entry.js"), "export {}")
    await writeFile(join(root, "src", "nested", "keep.js"), "export {}")
    await writeFile(join(root, "src", "nested", "skip.js"), "export {}")
    await writeFile(join(root, "src", "readme.txt"), "fixture")
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe("fast-glob compatibility adapter", () => {
  it("matches nested files using the Plasmo async search contract", async () => {
    await withFixture(async (root) => {
      const files = await fastGlob("**/*.js", {
        cwd: root,
        onlyFiles: true
      })

      expect(files.sort()).toEqual([
        "src/entry.js",
        "src/nested/keep.js",
        "src/nested/skip.js"
      ])
    })
  })

  it("supports negative patterns and the synchronous compatibility method", async () => {
    await withFixture(async (root) => {
      const files = fastGlob.sync(["**/*.js", "!**/skip.js"], {
        cwd: root,
        onlyFiles: true
      })

      expect(files.sort()).toEqual(["src/entry.js", "src/nested/keep.js"])
    })
  })

  it("exposes the helper aliases used by the replaced package surface", () => {
    expect(fastGlob.glob).toBe(fastGlob)
    expect(fastGlob.globSync).toBe(fastGlob.sync)
    expect(fastGlob.isDynamicPattern("src/**/*.js")).toBe(true)
  })
})
