import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { describe, expect, it } from "vitest"

import { createOwnedScratch } from "./owned-scratch"

function makeFixtureRoot(): string {
  return mkdtempSync(join(tmpdir(), "photosweep-owned-scratch-test-"))
}

describe("owned scratch cleanup", () => {
  it("removes only its new child after success", () => {
    const root = makeFixtureRoot()
    const scratch = createOwnedScratch(root, "tmp/verification", "trace-")
    const diagnosticPath = join(scratch.path, "evidence.json")
    const siblingPath = join(root, "tmp/verification", "keep.json")
    writeFileSync(diagnosticPath, '{"result":"pass"}\n')
    writeFileSync(siblingPath, '{"keep":true}\n')

    expect(scratch.complete(true)).toBe("cleaned")
    expect(existsSync(scratch.path)).toBe(false)
    expect(readFileSync(siblingPath, "utf8")).toBe('{"keep":true}\n')
    expect(
      readdirSync(join(root, "tmp/verification")).some((name) =>
        name.includes(basename(scratch.path))
      )
    ).toBe(false)

    rmSync(root, { recursive: true, force: false })
  })

  it("preserves run output when the test failed or was interrupted", () => {
    const root = makeFixtureRoot()
    const scratch = createOwnedScratch(root, "tmp/verification", "trace-")
    const diagnosticPath = join(scratch.path, "failure.log")
    writeFileSync(diagnosticPath, "keep this failure detail\n")

    expect(scratch.complete(false)).toBe("preserved")
    expect(existsSync(scratch.path)).toBe(true)
    expect(readFileSync(diagnosticPath, "utf8")).toBe(
      "keep this failure detail\n"
    )
    expect(() => scratch.complete(true)).toThrow("already been finalized")

    rmSync(root, { recursive: true, force: false })
  })

  it("rejects traversal and a symlinked parent directory", () => {
    const root = makeFixtureRoot()
    const outside = join(root, "outside")
    const alias = join(root, "linked-parent")
    mkdirSync(outside)
    symlinkSync(outside, alias, "dir")

    expect(() => createOwnedScratch(root, "../outside", "trace-")).toThrow(
      "must stay inside the trusted root"
    )
    expect(() => createOwnedScratch(root, "linked-parent", "trace-")).toThrow(
      "must be a real directory"
    )

    expect(readdirSync(outside)).toEqual([])
    rmSync(root, { recursive: true, force: false })
  })

  it("refuses symlink entries and a replaced scratch path without following them", () => {
    const root = makeFixtureRoot()
    const outside = makeFixtureRoot()
    const outsideFile = join(outside, "keep.txt")
    writeFileSync(outsideFile, "outside data\n")

    const scratch = createOwnedScratch(root, "tmp/verification", "trace-")
    symlinkSync(outsideFile, join(scratch.path, "escape"), "file")
    expect(() => scratch.complete(true)).toThrow("contains a symbolic link")
    expect(readFileSync(outsideFile, "utf8")).toBe("outside data\n")
    expect(existsSync(scratch.path)).toBe(true)

    const replaced = createOwnedScratch(root, "tmp/verification", "trace-")
    const movedPath = replaced.path + "-moved"
    renameSync(replaced.path, movedPath)
    symlinkSync(outside, replaced.path, "dir")
    expect(() => replaced.complete(true)).toThrow("must be a real directory")
    expect(readFileSync(outsideFile, "utf8")).toBe("outside data\n")
    expect(existsSync(movedPath)).toBe(true)

    rmSync(root, { recursive: true, force: false })
    rmSync(outside, { recursive: true, force: false })
  })

  it("rejects an ownership marker whose contents changed", () => {
    const root = makeFixtureRoot()
    const scratch = createOwnedScratch(root, "tmp/verification", "trace-")
    const parent = join(root, "tmp/verification")
    const markerName = readdirSync(parent).find(
      (name) => name === "." + basename(scratch.path) + ".owner.json"
    )
    expect(markerName).toBeDefined()
    const markerPath = join(parent, markerName!)
    writeFileSync(markerPath, '{"owner":"different"}\n')

    expect(() => scratch.complete(true)).toThrow(
      "ownership marker does not match"
    )
    expect(existsSync(scratch.path)).toBe(true)

    rmSync(root, { recursive: true, force: false })
  })
})
