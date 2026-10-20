import { createHash } from "node:crypto"
import { isAbsolute, resolve } from "node:path"

function kebabCase(value) {
  return value
    .replace(/([a-z\d])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[^a-zA-Z\d]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
}

function cliOption(args, name) {
  let value
  for (const argument of args) {
    if (argument.startsWith(`${name}=`)) {
      value = argument.slice(name.length + 1)
    }
  }
  return value
}

export function getPlasmoDevExtensionPath(projectRoot, args, env) {
  const buildPath =
    cliOption(args, "--build-path") || env.PLASMO_BUILD_PATH || "build"
  const target = kebabCase(
    cliOption(args, "--target") || env.PLASMO_TARGET || "chrome-mv3"
  )
  const tag =
    cliOption(args, "--tag") ||
    env.PLASMO_TAG ||
    "dev"

  return resolve(projectRoot, buildPath, `${target}-${tag}`)
}

export function chromeExtensionIdForPath(extensionPath) {
  if (typeof extensionPath !== "string" || !isAbsolute(extensionPath)) {
    throw new TypeError("Chrome derives unpacked extension IDs from an absolute path")
  }

  const digest = createHash("sha256")
    .update(extensionPath, "utf8")
    .digest()
    .subarray(0, 16)

  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .replace(/[0-9a-f]/g, (nibble) =>
      String.fromCharCode("a".charCodeAt(0) + Number.parseInt(nibble, 16))
    )
}
