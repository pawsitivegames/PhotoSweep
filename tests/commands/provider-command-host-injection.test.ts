import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createContext, runInContext } from "node:vm"
import { describe, expect, it } from "vitest"

const commandHostSource = readFileSync(
  resolve(process.cwd(), "scripts/photo-provider-command-host.js"),
  "utf8"
)

describe("provider command host classic-script injection", () => {
  it("can be injected repeatedly into the same page context", () => {
    const pageContext = createContext({
      addEventListener: () => undefined,
      document: { currentScript: null },
      HTMLScriptElement: class {},
      window: {
        location: {
          protocol: "https:",
          hostname: "photos.google.com",
          origin: "https://photos.google.com"
        },
        top: null
      }
    })

    expect(() => runInContext(commandHostSource, pageContext)).not.toThrow()
    expect(() => runInContext(commandHostSource, pageContext)).not.toThrow()
  })
})
