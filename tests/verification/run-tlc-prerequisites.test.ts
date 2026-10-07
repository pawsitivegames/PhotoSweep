import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { runTlc } from "../../verification/run-tlc.mjs"

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "photosweep-tlc-prerequisite-"))
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("TLC jar prerequisites", () => {
  it("blocks when the configured jar path is empty instead of hashing the repository root", () => {
    const root = makeRoot()
    vi.stubEnv("TLA_TOOLS_JAR", "")

    try {
      const result = runTlc({
        root,
        outputDirectory: "tmp/verification/empty-jar-path"
      })

      expect(result.status).toBe("BLOCKED")
      expect(result.exitCode).toBe(2)
      expect(readFileSync(result.logPath, "utf8")).toMatch(
        /jar is unavailable|regular file/i
      )
      expect(existsSync(result.resultPath)).toBe(true)
      expect(JSON.parse(readFileSync(result.resultPath, "utf8")).status).toBe(
        "BLOCKED"
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("blocks a directory supplied as the pinned jar without throwing EISDIR", () => {
    const root = makeRoot()
    const jarDirectory = join(root, "directory.jar")
    mkdirSync(jarDirectory)

    try {
      const result = runTlc({
        root,
        jarPath: jarDirectory,
        outputDirectory: "tmp/verification/directory-jar"
      })

      expect(result.status).toBe("BLOCKED")
      expect(result.exitCode).toBe(2)
      expect(readFileSync(result.logPath, "utf8")).toMatch(/regular file/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("fails a regular jar file whose digest does not match the current pin", () => {
    const root = makeRoot()
    const jarPath = join(root, "wrong-digest.jar")
    writeFileSync(jarPath, "not the pinned TLC jar\n")

    try {
      const result = runTlc({
        root,
        jarPath,
        outputDirectory: "tmp/verification/wrong-digest"
      })

      expect(result.status).toBe("FAIL")
      expect(result.exitCode).toBe(1)
      expect(readFileSync(result.logPath, "utf8")).toContain(
        "integrity mismatch"
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
