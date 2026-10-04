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
import { join, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { runKeeperSelectionTlc } from "../../verification/run-keeper-selection-tlc.mjs"
import { computeSourceFingerprint } from "../../verification/source-fingerprint.mjs"

const root = resolve(process.cwd())

describe("verification runner integrity", () => {
  it("keeps the SAFE-13 evidence selector matched to its registered assertion", () => {
    const runnerSource = readFileSync(
      join(root, "verification/verification-runner.mjs"),
      "utf8"
    )
    const selectorSource = runnerSource.match(
      /"SAFE-13-properties":\s*\/([^/]+)\//
    )
    const propertiesSource = readFileSync(
      join(root, "tests/verification/safety-properties.test.ts"),
      "utf8"
    )
    const assertionTitle = propertiesSource.match(
      /it\("([^"]*SAFE-13[^"]*)"/
    )?.[1]

    expect(selectorSource).not.toBeNull()
    expect(assertionTitle).toBeDefined()
    const selector = new RegExp(selectorSource?.[1] ?? "(?!)")
    expect(
      selector.test(`generated safety properties ${assertionTitle}`)
    ).toBe(true)
  })

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
    const invalidTlcJarPath = join(
      root,
      "tmp/verification",
      `invalid-tlc-tools-${Date.now()}-${process.pid}.jar`
    )
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
    writeFileSync(invalidTlcJarPath, "not the pinned TLC jar\n")
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
            // A present jar with the wrong digest makes the model command
            // produce a fresh FAIL. A missing jar is correctly BLOCKED.
            VERIFICATION_TLC_JAR: invalidTlcJarPath
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

      const runRegistry = JSON.parse(
        readFileSync(join(runDirectory, "requirements.json"), "utf8")
      )
      const canonicalRegistry = JSON.parse(
        readFileSync(join(root, "verification/requirements.json"), "utf8")
      )
      const evidence = JSON.parse(
        readFileSync(join(runDirectory, "evidence.json"), "utf8")
      )
      const authorityModelIds = [
        "SAFE-12-authority-model",
        "SAFE-12-authority-negative-control",
        "SAFE-12-authority-clear-negative-control"
      ]
      for (const id of authorityModelIds) {
        const runObligation = runRegistry.properties
          .flatMap((property: { obligations: Array<{ id: string; artifact: string }> }) => property.obligations)
          .find((obligation: { id: string }) => obligation.id === id)
        expect(runObligation).toBeDefined()
        const canonicalObligation = canonicalRegistry.properties
          .flatMap((property: { obligations: Array<{ id: string; artifact: string }> }) => property.obligations)
          .find((obligation: { id: string }) => obligation.id === id)
        expect(canonicalObligation).toBeDefined()
        const registryArtifactSuffix = canonicalObligation.artifact.replace(
          "tmp/verification/current/",
          ""
        )
        const expectedArtifact = join(
          relative(root, runDirectory),
          registryArtifactSuffix
        ).split("\\").join("/")
        expect(runObligation.artifact).toBe(expectedArtifact)

        const evidenceEntry = evidence.entries.find(
          (entry: { id: string }) => entry.id === id
        )
        expect(evidenceEntry?.artifact).toBe(runObligation.artifact)
        expect(existsSync(join(root, evidenceEntry.artifact))).toBe(true)
        const artifact = JSON.parse(
          readFileSync(join(root, evidenceEntry.artifact), "utf8")
        )
        expect(artifact.id).toBe(id)
      }

      const freshModel = JSON.parse(
        readFileSync(join(runDirectory, "model-SAFE-01.json"), "utf8")
      )
      const freshRawModel = JSON.parse(
        readFileSync(
          join(runDirectory, "model-run/safe01-selection.json"),
          "utf8"
        )
      )
      expect(freshModel.status).toBe("FAIL")
      expect(freshModel.runId).not.toBe("stale-run-that-must-not-be-used")
      expect(freshRawModel.status).toBe("FAIL")
      expect(freshRawModel.message).toContain("integrity mismatch")
      expect(readFileSync(stalePath, "utf8")).toBe(`${stalePass}\n`)
    } finally {
      if (existsSync(invalidTlcJarPath)) unlinkSync(invalidTlcJarPath)
      if (hadStaleFile && previous) writeFileSync(stalePath, previous)
      else if (existsSync(stalePath)) {
        // This test created the file only to model a stale artifact.
        unlinkSync(stalePath)
      }
    }
  }, 60_000)

  it("classifies an unavailable pinned TLC jar as BLOCKED", () => {
    const outputDirectory = join(
      root,
      "tmp/verification",
      `runner-missing-tlc-${Date.now()}-${process.pid}`
    )
    const result = runKeeperSelectionTlc({
      root,
      jarPath: join(outputDirectory, "missing-tla-tools.jar"),
      outputDirectory,
      runId: `missing-tlc-${process.pid}`
    })

    try {
      expect(result.status).toBe("BLOCKED")
      expect(result.exitCode).toBe(2)
      expect(result.sourceDrift).toBe(false)
      const artifact = JSON.parse(readFileSync(result.resultPath, "utf8"))
      expect(artifact.status).toBe("BLOCKED")
      expect(artifact.runId).toBe(`missing-tlc-${process.pid}`)
      expect(artifact.message).toContain("jar is unavailable")
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true })
    }
  })

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
