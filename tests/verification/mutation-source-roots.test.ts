import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { resolveMutationSourceRoots } from "../../verification/mutation-source-roots.mjs"

const releaseRegistry = JSON.parse(
  readFileSync("verification/requirements.json", "utf8")
) as { sourceRoots: string[] }

describe("mutation source fingerprint roots", () => {
  it("uses the release registry roots when no override is provided", () => {
    expect(resolveMutationSourceRoots(process.cwd(), {})).toEqual(
      releaseRegistry.sourceRoots
    )
  })

  it("keeps an explicit valid override", () => {
    const override = ["lib", "tests/lib/example.test.ts"]
    expect(
      resolveMutationSourceRoots(process.cwd(), {
        VERIFICATION_SOURCE_ROOTS: JSON.stringify(override)
      })
    ).toEqual(override)
  })

  it("does not silently accept an invalid override", () => {
    expect(
      resolveMutationSourceRoots(process.cwd(), {
        VERIFICATION_SOURCE_ROOTS: "not-json"
      })
    ).toBeUndefined()
  })
})
