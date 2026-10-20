type GlobPatterns = string | readonly string[]

type GlobOptions = Record<string, unknown> & {
  cwd?: string
  onlyFiles?: boolean
}

declare function fastGlob(
  patterns: GlobPatterns,
  options?: GlobOptions
): Promise<string[]>

declare namespace fastGlob {
  function sync(patterns: GlobPatterns, options?: GlobOptions): string[]
  const glob: typeof fastGlob
  const globSync: typeof sync
  function convertPathToPattern(path: string): string
  function escapePath(path: string): string
  function isDynamicPattern(
    pattern: string,
    options?: { caseSensitiveMatch?: boolean }
  ): boolean
}

export = fastGlob
