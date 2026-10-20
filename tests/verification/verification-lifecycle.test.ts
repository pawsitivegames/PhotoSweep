import { spawnSync } from "node:child_process"
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { availableParallelism } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  installPinnedTlcJar,
  PINNED_TLC_SHA256,
  PINNED_TLC_SOURCE_PATH
} from "../../verification/install-pinned-tlc.mjs"
import { describe, expect, it } from "vitest"
import { summarizeMutationTestInventory } from "../../verification/mutation-result-summary.mjs"
import { createReleasePackageEnvironment } from "../../verification/package-environment.mjs"

const root = resolve(process.cwd())
const packageScripts = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8")
).scripts
const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8")

describe("formal verification npm lifecycle", () => {
  it("loads the native ESM Vitest config and binds its path into release and mutation fingerprints", async () => {
    const configUrl = pathToFileURL(resolve(root, "vitest.config.mts"))
    const { default: config } = await import(configUrl.href)
    const releaseRequirements = JSON.parse(
      readFileSync(resolve(root, "verification/requirements.json"), "utf8")
    ) as { sourceRoots: string[] }
    const strykerConfig = readFileSync(resolve(root, "stryker.config.mjs"), "utf8")
    const { MUTATION_CACHE_SOURCE_ROOTS } = await import(
      "../../verification/mutation-incremental-cache.mjs"
    )

    expect(config.resolve.alias["~"]).toBe(root)
    expect(strykerConfig).toContain('configFile: "vitest.config.mts"')
    expect(releaseRequirements.sourceRoots).toContain("vitest.config.mts")
    expect(releaseRequirements.sourceRoots).not.toContain("vitest.config.ts")
    expect(MUTATION_CACHE_SOURCE_ROOTS).toContain("vitest.config.mts")
    expect(MUTATION_CACHE_SOURCE_ROOTS).not.toContain("vitest.config.ts")
  })

  it("passes production package configuration from the environment and example without using its public-key placeholder", () => {
    const environment = createReleasePackageEnvironment({
      environment: {
        PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY: "runtime-public-key"
      },
      exampleSource: [
        "PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL=https://api.example.test",
        "PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION=https://api.example.test/*",
        "PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY=BASE64URL_SPKI_PUBLIC_KEY"
      ].join("\n")
    })

    expect(environment).toMatchObject({
      PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL:
        "https://api.example.test",
      PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION:
        "https://api.example.test/*",
      PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY: "runtime-public-key",
      PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT: "0"
    })
  })

  it("omits the example public-key placeholder when no release key is configured", () => {
    const environment = createReleasePackageEnvironment({
      environment: {},
      exampleSource:
        "PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY=BASE64URL_SPKI_PUBLIC_KEY"
    })

    expect(environment).not.toHaveProperty(
      "PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY"
    )
    expect(environment.PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT).toBe(
      "0"
    )
  })

  it.each(["all", "nightly", "release"])(
    "generates production build flags before verify:%s",
    (scope) => {
      expect(packageScripts[`preverify:${scope}`]).toBe(
        scope === "all"
          ? "PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=0 node tools/write-build-flags.mjs"
          : "npm run preverify:all"
      )
    }
  )

  it("documents the stable local command contract using existing npm scripts", () => {
    const commands = {
      build: [
        "npm run build",
        "plasmo build && cp -r build/chrome-mv3-prod/. build/chrome-mv3-dev/"
      ],
      typecheck: [
        "npm run typecheck",
        "node ./node_modules/typescript/bin/tsc --noEmit --project tsconfig.json"
      ],
      test: ["npm test", "vitest run"],
      "test:integration": [
        "npm run test:integration",
        "node tools/run-integration-tests.mjs"
      ],
      "test:e2e": [
        "npm run test:e2e",
        "playwright test --config playwright.e2e.config.ts"
      ],
      "verify:all": [
        "npm run verify:all",
        "node verification/verification-runner.mjs --scope fast"
      ],
      "verify:nightly": [
        "npm run verify:nightly",
        "node verification/verification-runner.mjs --scope nightly"
      ],
      "verify:release": [
        "npm run verify:release",
        "node verification/verification-runner.mjs --scope release"
      ],
      package: ["npm run package", "node tools/package-cws.mjs"],
      "audit:extension-package": [
        "npm run audit:extension-package",
        "node tools/audit-extension-package.mjs"
      ]
    } as const

    for (const [script, [command, implementation]] of Object.entries(
      commands
    )) {
      expect(packageScripts[script]).toBe(implementation)
      expect(agents).toContain(`\`${command}\``)
    }

    expect(agents).toContain("`npm ci`")
    expect(packageScripts.lint).toBeUndefined()
    expect(agents).toContain("No `lint` script is defined")
    expect(packageScripts.pretest).toContain("npm run build:gptk")
    expect(packageScripts.pretest).toContain("tools/write-build-flags.mjs")
  })

  it("runs the local dev server through its Origin guard wrapper and binds the trusted extension ID to Plasmo's output path", () => {
    expect(packageScripts.dev).toBe("node tools/run-secure-dev.mjs")
    const wrapper = readFileSync(resolve(root, "tools/run-secure-dev.mjs"), "utf8")
    expect(wrapper).toContain("dev-server-origin-guard.cjs")
    expect(wrapper).toContain("getPlasmoDevExtensionPath")
    expect(wrapper).toContain("PHOTOSWEEP_DEV_EXTENSION_ID: devExtensionId")
  })

  it("scopes benchmark discovery to the tracked performance test directory", () => {
    expect(packageScripts["test:bench"]).toBe(
      "vitest bench --run --dir tests/perf --reporter=json --outputFile=bench-output.json"
    )
  })

  it("keeps the fast developer regression command focused and build-free", () => {
    const fastPaths = [
      "tests/lib/duplicate-detector.test.ts",
      "tests/lib/duplicate-classifier.test.ts",
      "tests/lib/keeper-decisions.test.ts",
      "tests/lib/review-preflight.test.ts",
      "tests/components/keep-strategy-application.test.tsx",
      "tests/components/action-bar.test.tsx",
      "tests/lib/trash-dispatch-guard.test.ts",
      "tests/lib/trash-lifecycle.test.ts"
    ]

    expect(packageScripts["test:fast"]).toBe(
      `vitest run ${fastPaths.join(" ")}`
    )
    expect(packageScripts["pretest:fast"]).toBeUndefined()
  })

  it("lets the integration wrapper own its test and restore builds in CI", () => {
    const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8")
    expect(ci).toContain("npm run test:integration")
    const integrationPosition = ci.indexOf("npm run test:integration")
    expect(ci.slice(0, integrationPosition)).not.toContain("npm run build")
  })

  it("honors the documented headless mode for isolated integration Chromium", () => {
    const playwrightConfig = readFileSync(
      resolve(root, "playwright.config.ts"),
      "utf8"
    )
    expect(agents).toContain("PHOTOSWEEP_INTEGRATION_HEADLESS=1")
    expect(playwrightConfig).toContain(
      'process.env.PHOTOSWEEP_INTEGRATION_HEADLESS === "1"'
    )
    expect(playwrightConfig).toContain("use: { headless }")
  })

  it("keeps mutation concurrency bounded and adapts the default to available CPUs", () => {
    const loadConcurrency = (value?: string) => {
      const env = { ...process.env }
      if (value === undefined) {
        delete env.VERIFICATION_MUTATION_CONCURRENCY
      } else {
        env.VERIFICATION_MUTATION_CONCURRENCY = value
      }
      return spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          'import config from "./stryker.config.mjs"; process.stdout.write(String(config.concurrency))'
        ],
        { cwd: root, env, encoding: "utf8" }
      )
    }

    const defaultRun = loadConcurrency()
    expect(defaultRun.status).toBe(0)
    expect(defaultRun.stdout).toBe(String(Math.min(4, availableParallelism())))

    const singleWorkerRun = loadConcurrency("1")
    expect(singleWorkerRun.status).toBe(0)
    expect(singleWorkerRun.stdout).toBe("1")

    const parallelRun = loadConcurrency("2")
    expect(parallelRun.status).toBe(0)
    expect(parallelRun.stdout).toBe("2")

    const maximumRun = loadConcurrency("4")
    expect(maximumRun.status).toBe(0)
    expect(maximumRun.stdout).toBe("4")

    const invalidRun = loadConcurrency("5")
    expect(invalidRun.status).not.toBe(0)
    expect(invalidRun.stderr).toContain(
      "VERIFICATION_MUTATION_CONCURRENCY must be an integer between 1 and 4"
    )
  })

  it("summarizes mutation test inventory without embedding test source", () => {
    const summary = summarizeMutationTestInventory({
      "tests/one.test.ts": {
        source: "export const testSource = 'large source text'",
        tests: [{ name: "first" }, { name: "second" }]
      },
      "tests/two.test.ts": {
        source: "another complete test module",
        tests: [{ name: "third" }]
      }
    })

    expect(summary).toEqual({ testFileCount: 2, testCaseCount: 3 })
    expect(JSON.stringify(summary)).not.toContain("large source text")
  })

  it("enables Stryker incremental mode only when the runner supplies a cache path", () => {
    const load = (incrementalFile?: string) => {
      const env = { ...process.env }
      if (incrementalFile === undefined) {
        delete env.VERIFICATION_MUTATION_INCREMENTAL_FILE
      } else {
        env.VERIFICATION_MUTATION_INCREMENTAL_FILE = incrementalFile
      }
      return spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          'import config from "./stryker.config.mjs"; process.stdout.write(JSON.stringify({ incremental: config.incremental ?? false, incrementalFile: config.incrementalFile ?? null }))'
        ],
        { cwd: root, env, encoding: "utf8" }
      )
    }

    const withoutCache = load()
    expect(withoutCache.status).toBe(0)
    expect(JSON.parse(withoutCache.stdout)).toEqual({
      incremental: false,
      incrementalFile: null
    })

    const incrementalFile =
      "tmp/verification/mutation-incremental/source-node-24.20.0.json"
    const withCache = load(incrementalFile)
    expect(withCache.status).toBe(0)
    expect(JSON.parse(withCache.stdout)).toEqual({
      incremental: true,
      incrementalFile
    })
  })

  it("requires frozen release candidates for external video playback evidence", () => {
    const env = { ...process.env }
    delete env.PHOTOSWEEP_VIDEO_PLAYBACK_EVIDENCE
    const run = (scope: string) =>
      spawnSync(
        process.execPath,
        [
          "verification/verification-runner.mjs",
          "--scope",
          scope,
          "--video-playback-evidence",
          "tmp/video-playback-manifest.json"
        ],
        { cwd: root, env, encoding: "utf8" }
      )

    const nonReleaseRun = run("fast")
    expect(nonReleaseRun.status).not.toBe(0)
    expect(nonReleaseRun.stderr).toContain(
      "--video-playback-evidence and PHOTOSWEEP_VIDEO_PLAYBACK_EVIDENCE require release scope"
    )

    const releaseRun = run("release")
    expect(releaseRun.status).not.toBe(0)
    expect(releaseRun.stderr).toContain(
      "Video playback evidence requires --candidate-package"
    )
  })

  it("allows package validation to continue when only static runtime identity is blocked", () => {
    const runner = readFileSync(
      resolve(root, "verification/verification-runner.mjs"),
      "utf8"
    )
    const candidate = readFileSync(
      resolve(root, "verification/release-candidate.mjs"),
      "utf8"
    )
    expect(runner.match(/"--allow-static-identity-blocked"/g)).toHaveLength(2)
    expect(candidate).toContain('process.argv.includes(\n      "--allow-static-identity-blocked"\n    )')
  })

  it("documents the canonical pinned TLC location and strict checksum override", () => {
    const tooling = readFileSync(
      resolve(root, "verification/tlc-tooling.mjs"),
      "utf8"
    )
    expect(tooling).toContain('"ci-tlc"')
    expect(agents).toContain(
      "`tmp/verification/ci-tlc/tooling/tla2tools-1.8.0.jar`"
    )
    expect(agents).toContain("`TLA_TOOLS_JAR` is an explicit path override")
    expect(agents).toContain(
      "`7beec0f04818732a62fa193731711a99aa4f11279499b2360a7d156c519ea78d`"
    )
  })

  it("installs only the verified vendored TLC pin for every CI workflow", () => {
    expect(PINNED_TLC_SHA256).toBe(
      "7beec0f04818732a62fa193731711a99aa4f11279499b2360a7d156c519ea78d"
    )
    expect(PINNED_TLC_SOURCE_PATH).toBe(
      "verification/tooling/tla2tools-1.8.0.jar"
    )

    const workflowPaths = [
      ".github/workflows/ci.yml",
      ".github/workflows/verification.yml",
      ".github/workflows/build-extension-package.yml"
    ]
    for (const workflowPath of workflowPaths) {
      const workflow = readFileSync(resolve(root, workflowPath), "utf8")
      expect(workflow).toContain("node verification/install-pinned-tlc.mjs")
      expect(workflow).not.toContain(
        "https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar"
      )
    }

    const scratchRoot = mkdtempSync(join(root, "tmp", "pinned-tlc-test-"))
    try {
      const sourcePath = join(scratchRoot, PINNED_TLC_SOURCE_PATH)
      mkdirSync(join(scratchRoot, "verification", "tooling"), {
        recursive: true
      })
      writeFileSync(
        sourcePath,
        readFileSync(resolve(root, PINNED_TLC_SOURCE_PATH))
      )

      const installed = installPinnedTlcJar(scratchRoot, "out/tla2tools.jar")
      expect(installed).toMatchObject({
        path: "out/tla2tools.jar",
        sha256: PINNED_TLC_SHA256
      })
      expect(lstatSync(join(scratchRoot, "out/tla2tools.jar")).isFile()).toBe(
        true
      )

      writeFileSync(sourcePath, "corrupt source")
      expect(() => installPinnedTlcJar(scratchRoot, "out/corrupt.jar")).toThrow(
        "Vendored TLC integrity mismatch"
      )
    } finally {
      rmSync(scratchRoot, { recursive: true, force: true })
    }
  })

  it("keeps internal package and recorded-artifact audits as separate release gates", () => {
    const workflows = [
      ".github/workflows/build-extension-package.yml",
      ".github/workflows/release.yml",
      ".github/workflows/submit.yml"
    ]

    for (const workflowPath of workflows) {
      const workflow = readFileSync(resolve(root, workflowPath), "utf8")
      const runCommands = [...workflow.matchAll(/^\s*run:\s*(.+?)\s*$/gm)].map(
        (match) => match[1]
      )
      const required = [
        "npm run typecheck",
        "npm test",
        "npm run package",
        "npm run audit:extension-package"
      ]
      const positions = required.map((command) => runCommands.indexOf(command))

      expect(positions.every((position) => position >= 0)).toBe(true)
      expect(positions).toEqual(
        [...positions].sort((left, right) => left - right)
      )
    }

    const packageRunner = readFileSync(
      resolve(root, "tools/package-cws.mjs"),
      "utf8"
    )
    const internalAudit = packageRunner.indexOf(
      '["run", "audit:extension-package"]'
    )
    const recordArtifact = packageRunner.indexOf("record-cws-artifact.mjs")
    expect(internalAudit).toBeGreaterThanOrEqual(0)
    expect(recordArtifact).toBeGreaterThan(internalAudit)
    expect(packageRunner).toContain(
      'PHOTOSWEEP_AUDIT_STRICT_DEV_KEY_ABSENCE: "1"'
    )
  })
})


it("preserves exporter options and requires explicit D7 history coverage", () => {
  const exporter = readFileSync(resolve(root, "tools/export-funnel-evidence.mjs"), "utf8")
  for (const option of ["current-version", "from", "to", "cohort-from", "cohort-to", "output", "history-from", "history-through"]) {
    expect(exporter).toContain(`"${option}"`)
  }
  expect(exporter).toContain('historyFrom: options["history-from"]')
  expect(exporter).toContain('historyThrough: options["history-through"]')
})
