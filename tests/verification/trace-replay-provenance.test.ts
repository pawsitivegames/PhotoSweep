import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  computeSourceMetadata,
  TRACE_CONFIG_PATH,
  TRACE_MODEL_PATH,
  TRACE_REPLAY_SOURCE_PATHS
} from "../../verification/model/export-trace.mjs"

const projectRoot = resolve(process.cwd())
const sharedParserPath = "verification/parse-args.mjs"

describe("trace replay source provenance", () => {
  it("fingerprints the shared argument parser used by the replay runner", () => {
    expect(TRACE_REPLAY_SOURCE_PATHS).toContain(sharedParserPath)

    const fixtureRoot = mkdtempSync(join(tmpdir(), "photosweep-trace-source-"))
    const sourcePaths = new Set([
      TRACE_MODEL_PATH,
      TRACE_CONFIG_PATH,
      sharedParserPath,
      ...TRACE_REPLAY_SOURCE_PATHS
    ])

    try {
      for (const sourcePath of sourcePaths) {
        const fixturePath = join(fixtureRoot, sourcePath)
        mkdirSync(dirname(fixturePath), { recursive: true })
        copyFileSync(join(projectRoot, sourcePath), fixturePath)
      }

      const before = computeSourceMetadata(
        fixtureRoot,
        TRACE_MODEL_PATH,
        TRACE_CONFIG_PATH
      )
      const parserFixture = join(fixtureRoot, sharedParserPath)
      writeFileSync(
        parserFixture,
        `${readFileSync(parserFixture, "utf8")}\n// changed fixture\n`
      )
      const after = computeSourceMetadata(
        fixtureRoot,
        TRACE_MODEL_PATH,
        TRACE_CONFIG_PATH
      )

      expect(before.files.map((file) => file.path)).toContain(sharedParserPath)
      expect(after.digest).not.toBe(before.digest)
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})
