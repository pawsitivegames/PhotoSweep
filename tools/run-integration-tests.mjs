import { spawn } from "node:child_process"

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: "inherit" })
    child.once("error", (error) => {
      console.error(`${command} failed to start: ${error.message}`)
      resolve(1)
    })
    child.once("close", (code) => resolve(code ?? 1))
  })
}

const playwrightArgs = process.argv.slice(2)
while (playwrightArgs[0] === "--") playwrightArgs.shift()

const testBuildEnvironment = {
  ...process.env,
  PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT: "1"
}
const productionBuildEnvironment = {
  ...process.env,
  PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT: "0"
}

let testExitCode = 1
try {
  const testBuildExitCode = await run("pnpm", ["build"], testBuildEnvironment)
  if (testBuildExitCode !== 0) {
    testExitCode = testBuildExitCode
  } else {
    testExitCode = await run(
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "--config",
        "playwright.config.ts",
        ...playwrightArgs
      ],
      process.env
    )
  }
} finally {
  const restoreExitCode = await run(
    "pnpm",
    ["build"],
    productionBuildEnvironment
  )
  if (restoreExitCode !== 0) {
    console.error(
      "Could not restore the production extension build after integration tests."
    )
    process.exitCode = restoreExitCode
  } else {
    process.exitCode = testExitCode
  }
}
