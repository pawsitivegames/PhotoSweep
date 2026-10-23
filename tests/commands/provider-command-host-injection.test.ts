import { readFileSync } from "node:fs"
import { webcrypto } from "node:crypto"
import { resolve } from "node:path"
import { createContext, runInContext } from "node:vm"
import { TextEncoder } from "node:util"
import { describe, expect, it, vi } from "vitest"

describe("provider command-host classic-script injection", () => {
  it.each(["local", "absent", "function"])("keeps repeated page injection idempotent with location shape: %s", (locationShape) => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/photo-provider-command-host.js"),
      "utf8"
    )
    const storage = new Map<string, string>()
    const pageListeners: string[] = []
    const testListeners = vi.fn()
    // Non-object location values must not be interpreted as browser origins.
    const location = locationShape === "function"
      ? Object.assign(() => {}, {
          protocol: "https:",
          hostname: "photos.google.com",
          origin: "https://photos.google.com"
        })
      : { protocol: "http:", hostname: "localhost", origin: "http://localhost" }
    const page: Record<string, unknown> = {
      ...(locationShape === "absent" ? {} : { location }),
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key)
      },
      addEventListener: (type: string) => pageListeners.push(type)
    }
    page.top = page

    const context = createContext({
      // Share mutation activation and coverage with the runner across the VM boundary.
      __stryker__: (globalThis as typeof globalThis & { __stryker__?: unknown }).__stryker__,
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
