import { readFileSync } from "node:fs"
import { webcrypto } from "node:crypto"
import { resolve } from "node:path"
import { createContext, runInContext } from "node:vm"
import { TextEncoder } from "node:util"
import { describe, expect, it, vi } from "vitest"

describe("provider command-host classic-script injection", () => {
  it("keeps repeated page injection idempotent", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/photo-provider-command-host.js"),
      "utf8"
    )
    const storage = new Map<string, string>()
    const pageListeners: string[] = []
    const testListeners = vi.fn()
    const page: Record<string, unknown> = {
      location: {
        protocol: "http:",
        hostname: "localhost",
        origin: "http://localhost"
      },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key)
      },
      addEventListener: (type: string) => pageListeners.push(type)
    }
    page.top = page

    const context = createContext({
      window: page,
      process: { env: { NODE_ENV: "test" } },
      crypto: webcrypto,
      TextEncoder,
      addEventListener: testListeners
    })

    expect(() => runInContext(source, context)).not.toThrow()
    const firstHost = page.__GPD_COMMAND_HOST__
    expect(firstHost).toBeDefined()

    expect(() => runInContext(source, context)).not.toThrow()
    expect(page.__GPD_COMMAND_HOST__).toBe(firstHost)
    expect(testListeners).toHaveBeenCalledTimes(1)
    expect(pageListeners.filter((type) => type === "message")).toHaveLength(0)
  })
})
