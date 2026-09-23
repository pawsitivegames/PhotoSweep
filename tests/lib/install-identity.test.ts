import { describe, expect, it, vi } from "vitest"

import {
  createInstallId,
  getOrCreateInstallId,
  INSTALL_ID_STORAGE_KEY,
  isValidInstallId
} from "../../lib/install-identity"

function createStorage(initial?: unknown) {
  let value = initial
  return {
    get: vi.fn(async () =>
      value === undefined ? {} : { [INSTALL_ID_STORAGE_KEY]: value }
    ),
    set: vi.fn(async (items: Record<string, unknown>) => {
      value = items[INSTALL_ID_STORAGE_KEY]
    })
  }
}

describe("install identity", () => {
  it("creates and persists one opaque UUID v4", async () => {
    const storage = createStorage()

    const first = await getOrCreateInstallId(storage)
    const second = await getOrCreateInstallId(storage)

    expect(isValidInstallId(first)).toBe(true)
    expect(second).toBe(first)
    expect(storage.set).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(storage)).not.toContain("photos")
  })

  it("reuses a valid stored id and rejects malformed stored values", async () => {
    const existing = "123e4567-e89b-42d3-a456-426614174000"
    const existingStorage = createStorage(existing)
    await expect(getOrCreateInstallId(existingStorage)).resolves.toBe(existing)
    expect(existingStorage.set).not.toHaveBeenCalled()

    const malformedStorage = createStorage("https://photos.example/private")
    const replacement = await getOrCreateInstallId(malformedStorage)
    expect(isValidInstallId(replacement)).toBe(true)
    expect(replacement).not.toContain("photos.example")
    expect(malformedStorage.set).toHaveBeenCalledTimes(1)
  })

  it("sets UUID v4 version and variant bits for the fallback generator", () => {
    const id = createInstallId(() => "")

    expect(isValidInstallId(id)).toBe(true)
    expect(id[14]).toBe("4")
    expect(["8", "9", "a", "b"]).toContain(id[19]?.toLowerCase())
  })
})
