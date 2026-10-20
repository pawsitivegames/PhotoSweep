import { readFileSync } from "node:fs"
import { resolve } from "node:path"

function validSourceRoots(value) {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.length > 0)
}

/**
 * @param {string} root
 * @param {{ VERIFICATION_SOURCE_ROOTS?: string }} environment
 */
export function resolveMutationSourceRoots(
  root = process.cwd(),
  environment = process.env
) {
  const configured = environment.VERIFICATION_SOURCE_ROOTS
  if (configured) {
    try {
      const parsed = JSON.parse(configured)
      return validSourceRoots(parsed) ? parsed : undefined
    } catch {
      return undefined
    }
  }

  try {
    const registry = JSON.parse(
      readFileSync(resolve(root, "verification/requirements.json"), "utf8")
    )
    return validSourceRoots(registry.sourceRoots)
      ? registry.sourceRoots
      : undefined
  } catch {
    return undefined
  }
}
