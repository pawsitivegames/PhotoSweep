import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { computeSourceFingerprint } from "../../verification/source-fingerprint.mjs"

const root = resolve(process.cwd())

describe("verification runner integrity", () => {
  it("rejects a stale PASS artifact when a fresh model command fails", () => {
    const stalePath = join(root, "tmp/verification/current/model-SAFE-01.json")
    const hadStaleFile = existsSync(stalePath)
    const previous = hadStaleFile ? readFileSync(stalePath) : null
    const runDirectory = join(
      root,
      "tmp/verification",
      `runner-corruption-${Date.now()}-${process.pid}`
    )
    const archiveDirectory = `${runDirectory}-archive`
    const stalePass = JSON.stringify(
      {
        schemaVersion: 1,
        id: "SAFE-01-model",
        status: "PASS",
        runId: "stale-run-that-must-not-be-used",
        modelComplete: true,
        statesExplored: 999999
      },
      null,
      2
    )

    mkdirSync(join(root, "tmp/verification/current"), { recursive: true })
    writeFileSync(stalePath, `${stalePass}\n`)
    try {
      const result = spawnSync(
        process.execPath,
        [
          "verification/verification-runner.mjs",
          "--scope",
          "fast",
          "--out-dir",
          runDirectory,
          "--archive-dir",
          archiveDirectory
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            // The child writes a fresh FAIL result with its own runId. The
            // runner must surface that failure instead of reading current/.
            VERIFICATION_TLC_JAR: join(runDirectory, "missing-tla-tools.jar")
          },
          encoding: "utf8"
        }
      )
      expect(result.status).toBe(1)

      const summary = JSON.parse(
        readFileSync(join(runDirectory, "aggregate-result.json"), "utf8")
      )
      expect(summary.status).toBe("FAIL")
      const modelCommand = summary.commands.find(
        (command: { label: string }) => command.label === "model"
      )
      expect(modelCommand?.exitCode).not.toBe(0)

      const freshModel = JSON.parse(
        readFileSync(join(runDirectory, "model-SAFE-01.json"), "utf8")
      )
      expect(freshModel.status).toBe("FAIL")
      expect(freshModel.runId).not.toBe("stale-run-that-must-not-be-used")
      expect(readFileSync(stalePath, "utf8")).toBe(`${stalePass}\n`)
    } finally {
      if (hadStaleFile && previous) writeFileSync(stalePath, previous)
      else if (existsSync(stalePath)) {
        // This test created the file only to model a stale artifact.
        unlinkSync(stalePath)
      }
    }
  }, 15_000)

  it("refuses to reuse a nonempty explicitly selected output directory", () => {
    const runDirectory = join(
      root,
      "tmp/verification",
      `runner-reuse-${Date.now()}-${process.pid}`
    )
    mkdirSync(runDirectory, { recursive: true })
    const marker = join(runDirectory, "stale-marker.json")
    writeFileSync(marker, '{"status":"PASS"}\n')
    const result = spawnSync(
      process.execPath,
      [
        "verification/verification-runner.mjs",
        "--scope",
        "fast",
        "--out-dir",
        runDirectory
      ],
      { cwd: root, encoding: "utf8" }
    )
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain("not empty")
    expect(readFileSync(marker, "utf8")).toBe('{"status":"PASS"}\n')
  })

  it("keeps the source fingerprint stable across generated manifest entry order", () => {
    const temporaryRoot = mkdtempSync("/tmp/photosweep-source-fingerprint-")
    const manifestPath = join(
      temporaryRoot,
      "build/chrome-mv3-prod/manifest.json"
    )
    const googleScript = {
      matches: ["https://photos.google.com/*"],
      js: ["google-photos-bridge.js"],
      run_at: "document_idle",
      css: []
    }
    const amazonScript = {
      matches: ["https://www.amazon.com/photos*"],
      js: ["amazon-photos-bridge.js"],
      run_at: "document_idle",
      css: []
    }

    try {
      expect(
        spawnSync("git", ["init", "--quiet"], {
          cwd: temporaryRoot,
          encoding: "utf8"
        }).status
      ).toBe(0)
      mkdirSync(join(temporaryRoot, "build/chrome-mv3-prod"), {
        recursive: true
      })
      writeFileSync(
        manifestPath,
        JSON.stringify({ manifest_version: 3, content_scripts: [googleScript, amazonScript] })
      )
      const first = computeSourceFingerprint(temporaryRoot, [
        "build/chrome-mv3-prod/manifest.json"
      ])

      writeFileSync(
        manifestPath,
        JSON.stringify({ manifest_version: 3, content_scripts: [amazonScript, googleScript] })
      )
      const second = computeSourceFingerprint(temporaryRoot, [
        "build/chrome-mv3-prod/manifest.json"
      ])

      expect(first.digest).toBe(second.digest)
      expect(first.fileCount).toBe(1)
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
})
