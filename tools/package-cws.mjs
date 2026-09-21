import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { getCwsReleaseIdentity } from "./cws-artifact.mjs"

const rootDir = process.cwd()
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env,
    stdio: "inherit"
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`)
  }
}

async function patchFinalManifest(manifestPath, appVersion, chromeVersion) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  if (manifest.version !== appVersion) {
    throw new Error(
      `Expected Plasmo to build app version ${appVersion}; found ${manifest.version}`
    )
  }
  manifest.version = chromeVersion
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
}

const packageJson = JSON.parse(
  await readFile(path.join(rootDir, "package.json"), "utf8")
)
const { appVersion, chromeVersion } = getCwsReleaseIdentity(packageJson)

run(npmCommand, ["run", "build"])

for (const target of ["chrome-mv3-prod", "chrome-mv3-dev"]) {
  await patchFinalManifest(
    path.join(rootDir, "build", target, "manifest.json"),
    appVersion,
    chromeVersion
  )
}

run(path.join(rootDir, "node_modules", ".bin", "plasmo"), ["package"])
run(
  npmCommand,
  ["run", "audit:extension-package"],
  {
    ...process.env,
    PHOTOSWEEP_AUDIT_STRICT_DEV_KEY_ABSENCE: "1"
  }
)
run(process.execPath, [path.join(rootDir, "tools", "record-cws-artifact.mjs")])
