import { join, resolve } from "node:path"

export const TLC_TOOLING_RELATIVE_DIRECTORY = join(
  "tmp",
  "verification",
  "ci-tlc",
  "tooling"
)

export function resolveTlcJarPath(root, version, configuredPath) {
  const explicitPath =
    typeof configuredPath === "string" && configuredPath.trim()
      ? configuredPath.trim()
      : null
  const selectedPath =
    explicitPath ??
    join(
      TLC_TOOLING_RELATIVE_DIRECTORY,
      `tla2tools-${version}.jar`
    )

  return resolve(root, selectedPath)
}
