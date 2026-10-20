import { describe, expect, it } from "vitest"

import {
  detectTlcStorageExhaustion,
  resolveTlcWorkerCount
} from "../../verification/run-recovery-authority-tlc.mjs"

describe("[SAFE-12 authority TLC runner] worker selection", () => {
  it.each([
    [1, 1],
    [2, 2],
    [4, 4],
    [8, 4],
    [0, 1],
    [-1, 1],
    [Number.NaN, 1]
  ])("uses %i worker(s) when %i CPU(s) are available", (available, expected) => {
    expect(resolveTlcWorkerCount(available)).toBe(expected)
  })
})

describe("[SAFE-12 authority TLC runner] environment failures", () => {
  it("recognizes TLC state-storage exhaustion as an environment blocker", () => {
    expect(
      detectTlcStorageExhaustion(
        "Error: when writing the disk (StatePoolWriter.run): No space left on device"
      )
    ).toBe(true)
    expect(detectTlcStorageExhaustion("Invariant TypeOK is violated")).toBe(
      false
    )
  })
})
