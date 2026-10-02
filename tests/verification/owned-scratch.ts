import { randomUUID } from "node:crypto"
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"

type FileIdentity = NonNullable<ReturnType<typeof lstatSync>>

type OwnershipRecord = {
  schemaVersion: 1
  token: string
  rootPath: string
  parentPath: string
  scratchName: string
}

export type OwnedScratch = Readonly<{
  path: string
  complete(success: boolean): "cleaned" | "preserved"
}>

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function errorHasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  )
}

function assertRealDirectory(path: string, description: string): FileIdentity {
  const stats = lstatSync(path)
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    realpathSync(path) !== path
  ) {
    throw new Error(description + " must be a real directory: " + path)
  }
  return stats
}

function relativeSegments(relativeParentPath: string): string[] {
  if (isAbsolute(relativeParentPath) || relativeParentPath.includes("\0")) {
    throw new Error("Scratch parent must stay inside the trusted root")
  }

  const segments = relativeParentPath.split(/[\\/]/)
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9._-]+$/.test(segment)
    )
  ) {
    throw new Error("Scratch parent must stay inside the trusted root")
  }
  return segments
}

function ensureRealDirectory(path: string): FileIdentity {
  try {
    return assertRealDirectory(path, "Scratch parent")
  } catch (error) {
    if (!errorHasCode(error, "ENOENT")) throw error
  }

  try {
    mkdirSync(path, { mode: 0o700 })
  } catch (error) {
    if (!errorHasCode(error, "EEXIST")) throw error
  }
  return assertRealDirectory(path, "Scratch parent")
}

function ensureParentDirectory(
  rootPath: string,
  relativeParentPath: string
): { path: string; identity: FileIdentity } {
  const segments = relativeSegments(relativeParentPath)
  let path = rootPath
  let identity = assertRealDirectory(path, "Trusted root")

  for (const segment of segments) {
    path = join(path, segment)
    identity = ensureRealDirectory(path)
  }

  return { path, identity }
}

function assertOrdinaryTree(path: string): void {
  for (const name of readdirSync(path)) {
    const childPath = join(path, name)
    const stats = lstatSync(childPath)
    if (stats.isSymbolicLink()) {
      throw new Error("Owned scratch contains a symbolic link: " + childPath)
    }
    if (stats.isDirectory()) {
      assertOrdinaryTree(childPath)
      continue
    }
    if (!stats.isFile()) {
      throw new Error("Owned scratch contains a special file: " + childPath)
    }
  }
}

function ownerMatches(
  markerPath: string,
  markerIdentity: FileIdentity,
  expected: OwnershipRecord
): boolean {
  const markerStats = lstatSync(markerPath)
  if (
    markerStats.isSymbolicLink() ||
    !markerStats.isFile() ||
    !sameIdentity(markerStats, markerIdentity) ||
    realpathSync(markerPath) !== markerPath
  ) {
    return false
  }

  try {
    const actual = JSON.parse(readFileSync(markerPath, "utf8"))
    return JSON.stringify(actual) === JSON.stringify(expected)
  } catch {
    return false
  }
}

/**
 * Creates an empty, uniquely named scratch directory under a trusted project
 * root. Its ownership record is a sibling file so consumers that require an
 * empty output directory can still use the scratch path directly.
 *
 * Call complete(true) only after every assertion in the owning run succeeds.
 * Failed or interrupted runs leave the scratch and ownership record in place.
 */
export function createOwnedScratch(
  trustedRootPath: string,
  relativeParentPath: string,
  prefix: string
): OwnedScratch {
  const requestedRootPath = resolve(trustedRootPath)
  const rootPath = realpathSync(requestedRootPath)
  const rootStats = assertRealDirectory(rootPath, "Trusted root")

  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}-$/.test(prefix) ||
    prefix.includes("..")
  ) {
    throw new Error("Scratch prefix is invalid")
  }

  const parent = ensureParentDirectory(rootPath, relativeParentPath)
  const parentStats = assertRealDirectory(parent.path, "Scratch parent")
  if (!sameIdentity(parentStats, parent.identity)) {
    throw new Error("Scratch parent identity changed during creation")
  }

  const scratchPath = mkdtempSync(join(parent.path, prefix))
  const scratchIdentity = assertRealDirectory(scratchPath, "Owned scratch")
  if (
    dirname(scratchPath) !== parent.path ||
    !basename(scratchPath).startsWith(prefix)
  ) {
    throw new Error("Created scratch escaped its expected parent")
  }

  const ownership: OwnershipRecord = {
    schemaVersion: 1,
    token: randomUUID(),
    rootPath,
    parentPath: parent.path,
    scratchName: basename(scratchPath)
  }
  const markerPath = join(
    parent.path,
    "." + basename(scratchPath) + ".owner.json"
  )
  writeFileSync(markerPath, JSON.stringify(ownership) + "\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  })
  const markerIdentity = lstatSync(markerPath)

  let finalized = false
  return Object.freeze({
    path: scratchPath,
    complete(success: boolean): "cleaned" | "preserved" {
      if (finalized) {
        throw new Error("Owned scratch has already been finalized")
      }
      finalized = true
      if (!success) return "preserved"

      const currentRoot = assertRealDirectory(rootPath, "Trusted root")
      const currentParent = assertRealDirectory(parent.path, "Scratch parent")
      const currentScratch = assertRealDirectory(scratchPath, "Owned scratch")
      if (
        !sameIdentity(currentRoot, rootStats) ||
        !sameIdentity(currentParent, parentStats) ||
        !sameIdentity(currentScratch, scratchIdentity) ||
        dirname(scratchPath) !== parent.path ||
        !basename(scratchPath).startsWith(prefix)
      ) {
        throw new Error("Owned scratch path identity changed")
      }
      if (!ownerMatches(markerPath, markerIdentity, ownership)) {
        throw new Error("Owned scratch ownership marker does not match")
      }

      assertOrdinaryTree(scratchPath)

      // Recheck identities after walking the tree; changed or linked paths
      // remain untouched for inspection.
      const parentAfterWalk = assertRealDirectory(parent.path, "Scratch parent")
      const scratchAfterWalk = assertRealDirectory(scratchPath, "Owned scratch")
      if (
        !sameIdentity(parentAfterWalk, parentStats) ||
        !sameIdentity(scratchAfterWalk, scratchIdentity) ||
        !ownerMatches(markerPath, markerIdentity, ownership)
      ) {
        throw new Error("Owned scratch path identity changed during cleanup")
      }

      rmSync(scratchPath, { recursive: true, force: false })
      unlinkSync(markerPath)
      return "cleaned"
    }
  })
}
