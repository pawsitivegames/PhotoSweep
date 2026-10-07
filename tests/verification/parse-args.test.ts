import { describe, expect, it } from "vitest"

import { parseArgs } from "../../verification/parse-args.mjs"

describe("verification CLI argument parsing", () => {
  it.each([
    [["position", "--scope", "release"], { scope: "release" }],
    [["--verbose", "--root", "repo"], { verbose: true, root: "repo" }],
    [["--scope", "nightly", "--scope", "release"], { scope: "release" }],
    [["--jar"], { jar: undefined }],
    [["--root=repo"], { "root=repo": undefined }]
  ])("parses %j with existing CLI semantics", (argv, expected) => {
    expect(parseArgs(argv)).toStrictEqual(expected)
  })
})
