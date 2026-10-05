import { expect, it } from "vitest"

import { runIntegrationTests } from "../../tools/run-integration-tests.mjs"

it("runs build and Playwright against a test-only license API origin", async () => {
  const calls: Array<{
    command: string
    args: string[]
    allowDevEntitlement: string | undefined
    licenseApiBaseUrl: string | undefined
    licenseApiHostPermission: string | undefined
  }> = []

  const result = await runIntegrationTests({
    env: {
      npm_execpath: "/ci/npm/bin/npm-cli.js",
      NODE_ENV: "development",
      PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT: "0",
      PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL:
        "https://configured-license.example",
      PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION:
        "https://configured-license.example/*"
    },
    playwrightArgs: ["--grep", "integration smoke"],
    runCommand: async (command, args, env) => {
      calls.push({
        command,
        args,
        allowDevEntitlement:
          env.PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT,
        licenseApiBaseUrl:
          env.PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL,
        licenseApiHostPermission:
          env.PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION
      })
      return 0
    }
  })

  expect(result).toBe(0)
  expect(calls).toEqual([
    {
      command: process.execPath,
      args: ["/ci/npm/bin/npm-cli.js", "run", "build"],
      allowDevEntitlement: "1",
      licenseApiBaseUrl: "https://photosweep-license-api.test",
      licenseApiHostPermission: "https://photosweep-license-api.test/*"
    },
    {
      command: process.execPath,
      args: [
        "/ci/npm/bin/npm-cli.js",
        "exec",
        "--",
        "playwright",
        "test",
        "--config",
        "playwright.config.ts",
        "--grep",
        "integration smoke"
      ],
      allowDevEntitlement: "0",
      licenseApiBaseUrl: "https://photosweep-license-api.test",
      licenseApiHostPermission: "https://photosweep-license-api.test/*"
    },
    {
      command: process.execPath,
      args: ["/ci/npm/bin/npm-cli.js", "run", "build"],
      allowDevEntitlement: "0",
      licenseApiBaseUrl: "https://configured-license.example",
      licenseApiHostPermission: "https://configured-license.example/*"
    }
  ])
})

it("uses the npm command when invoked under pnpm", async () => {
  const calls: Array<{ command: string; args: string[] }> = []

  const result = await runIntegrationTests({
    env: { npm_execpath: "/ci/pnpm/pnpm.cjs", NODE_ENV: "development" },
    playwrightArgs: [],
    runCommand: async (command, args) => {
      calls.push({ command, args })
      return 0
    }
  })

  expect(result).toBe(0)
  expect(calls).toEqual([
    { command: "npm", args: ["run", "build"] },
    {
      command: "npm",
      args: [
        "exec",
        "--",
        "playwright",
        "test",
        "--config",
        "playwright.config.ts"
      ]
    },
    { command: "npm", args: ["run", "build"] }
  ])
})

it("restores the production build after Playwright fails without changing process exitCode", async () => {
  const calls: Array<{
    command: string
    args: string[]
    allowDevEntitlement: string | undefined
  }> = []
  const previousExitCode = process.exitCode
  const exitCodes = [0, 7, 0]

  const result = await runIntegrationTests({
    env: {
      npm_execpath: "/ci/npm/bin/npm-cli.js",
      NODE_ENV: "development",
      PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT: "0"
    },
    playwrightArgs: [],
    runCommand: async (command, args, env) => {
      calls.push({
        command,
        args,
        allowDevEntitlement:
          env.PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT
      })
      return exitCodes.shift() ?? 1
    }
  })

  expect(result).toBe(7)
  expect(calls).toHaveLength(3)
  expect(calls[1]?.args).toContain("playwright")
  expect(calls[2]).toMatchObject({
    args: ["/ci/npm/bin/npm-cli.js", "run", "build"],
    allowDevEntitlement: "0"
  })
  expect(process.exitCode).toBe(previousExitCode)
})

it("restores the production build after the test build fails", async () => {
  const calls: Array<{
    args: string[]
    allowDevEntitlement: string | undefined
  }> = []
  const exitCodes = [5, 0]

  const result = await runIntegrationTests({
    env: { npm_execpath: "/ci/npm/bin/npm-cli.js", NODE_ENV: "development" },
    playwrightArgs: [],
    runCommand: async (_command, args, env) => {
      calls.push({
        args,
        allowDevEntitlement:
          env.PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT
      })
      return exitCodes.shift() ?? 1
    }
  })

  expect(result).toBe(5)
  expect(calls).toEqual([
    {
      args: ["/ci/npm/bin/npm-cli.js", "run", "build"],
      allowDevEntitlement: "1"
    },
    {
      args: ["/ci/npm/bin/npm-cli.js", "run", "build"],
      allowDevEntitlement: "0"
    }
  ])
})

it("returns the production restore build failure over the test result", async () => {
  const calls: Array<{
    args: string[]
    allowDevEntitlement: string | undefined
  }> = []
  const exitCodes = [0, 7, 9]

  const result = await runIntegrationTests({
    env: { npm_execpath: "/ci/npm/bin/npm-cli.js", NODE_ENV: "development" },
    playwrightArgs: [],
    runCommand: async (_command, args, env) => {
      calls.push({
        args,
        allowDevEntitlement:
          env.PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT
      })
      return exitCodes.shift() ?? 1
    }
  })

  expect(result).toBe(9)
  expect(calls).toHaveLength(3)
  expect(calls[2]).toMatchObject({
    args: ["/ci/npm/bin/npm-cli.js", "run", "build"],
    allowDevEntitlement: "0"
  })
})
