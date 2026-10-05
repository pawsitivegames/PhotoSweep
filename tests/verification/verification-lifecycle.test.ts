import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const packageScripts = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8")
).scripts

describe("formal verification npm lifecycle", () => {
  it.each(["all", "nightly", "release"])(
    "generates production build flags before verify:%s",
    (scope) => {
      expect(packageScripts[`preverify:${scope}`]).toBe(
        scope === "all"
          ? "PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT=0 node tools/write-build-flags.mjs"
          : "npm run preverify:all"
      )
    }
  )
})
