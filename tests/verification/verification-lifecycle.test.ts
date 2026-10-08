import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(process.cwd())
const packageScripts = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8")
).scripts
const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8")

describe("formal verification npm lifecycle", () => {
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
      typecheck: ["npm run typecheck", "tsc --noEmit --project tsconfig.json"],
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
