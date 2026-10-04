import { spawn } from "node:child_process"
import { pathToFileURL } from "node:url"

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

export async function runIntegrationTests({
  runCommand = run,
  env = process.env,
  playwrightArgs = process.argv.slice(2)
} = {}) {
  const npmExecPath = env.npm_execpath
  const invokedThroughNpmCli =
    typeof npmExecPath === "string" && /(?:^|[\\/])npm-cli\.js$/i.test(npmExecPath)
  const npmCommand = invokedThroughNpmCli ? process.execPath : "npm"
  const npmPrefixArgs = invokedThroughNpmCli ? [npmExecPath] : []
  const runNpm = (args, childEnv) =>
    runCommand(npmCommand, [...npmPrefixArgs, ...args], childEnv)

  const testBuildEnvironment = {
    ...env,
    PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT: "1"
  }
  const productionBuildEnvironment = {
    ...env,
    PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT: "0"
  }

  while (playwrightArgs[0] === "--") playwrightArgs.shift()

  let testExitCode = 1
  let resultExitCode = 1
  try {
    const testBuildExitCode = await runNpm(["run", "build"], testBuildEnvironment)
    if (testBuildExitCode !== 0) {
      testExitCode = testBuildExitCode
    } else {
      testExitCode = await runNpm(
        [
          "exec",
          "--",
          "playwright",
          "test",
          "--config",
          "playwright.config.ts",
          ...playwrightArgs
        ],
        env
      )
    }
  } finally {
    const restoreExitCode = await runNpm(
      ["run", "build"],
      productionBuildEnvironment
    )
    if (restoreExitCode !== 0) {
      console.error(
        "Could not restore the production extension build after integration tests."
      )
      resultExitCode = restoreExitCode
    } else {
      resultExitCode = testExitCode
    }
  }

  return resultExitCode
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runIntegrationTests()
}
