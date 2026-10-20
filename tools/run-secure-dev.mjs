import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  chromeExtensionIdForPath,
  getPlasmoDevExtensionPath
} from "./chrome-extension-id.mjs"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const plasmoCli = resolve(projectRoot, "node_modules/plasmo/bin/index.mjs")
const originGuard = resolve(projectRoot, "tools/dev-server-origin-guard.cjs")
const devExtensionPath = getPlasmoDevExtensionPath(
  projectRoot,
  process.argv.slice(2),
  process.env
)
const devExtensionId = chromeExtensionIdForPath(devExtensionPath)
const nodeOptions = [
  process.env.NODE_OPTIONS,
  `--require=${JSON.stringify(originGuard)}`
]
  .filter(Boolean)
  .join(" ")

const child = spawn(
  process.execPath,
  [plasmoCli, "dev", ...process.argv.slice(2)],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      PHOTOSWEEP_DEV_EXTENSION_ID: devExtensionId
    },
    stdio: "inherit"
  }
)

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal))
}

child.once("error", (error) => {
  console.error(`Could not start the protected Plasmo dev server: ${error.message}`)
  process.exitCode = 1
})

child.once("exit", (code, signal) => {
  if (signal) {
    process.exitCode = signal === "SIGINT" ? 130 : 143
  } else {
    process.exitCode = code ?? 1
  }
})
