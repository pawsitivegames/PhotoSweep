import { describe, expect, it } from "vitest"

import { AsyncSerialQueue } from "../../lib/async-serial-queue"

describe("AsyncSerialQueue", () => {
  it("keeps delayed whole-record read/modify/write transactions from losing updates", async () => {
    const queue = new AsyncSerialQueue()
    let records = ["existing"]
    let releaseFirstWrite!: () => void
    let signalFirstWrite!: () => void
    const firstWriteStarted = new Promise<void>((resolve) => {
      signalFirstWrite = resolve
    })
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    let writeCount = 0

    const update = (record: string) =>
      queue.run(async () => {
        const snapshot = [...records]
        snapshot.push(record)
        writeCount += 1
        if (writeCount === 1) {
          signalFirstWrite()
          await firstWriteGate
        }
        records = snapshot
      })

    const first = update("operation-a-terminal")
    await firstWriteStarted
    const second = update("operation-b-terminal")
    releaseFirstWrite()
    await Promise.all([first, second])

    expect(records).toEqual([
      "existing",
      "operation-a-terminal",
      "operation-b-terminal"
    ])
  })

  it("continues after a rejected transaction without overlapping its successor", async () => {
    const queue = new AsyncSerialQueue()
    const order: string[] = []
    let rejectFirst!: (error: Error) => void
    const firstGate = new Promise<void>((_, reject) => {
      rejectFirst = reject
    })

    const first = queue.run(async () => {
      order.push("first-start")
      await firstGate
      order.push("first-end")
    })
    const second = queue.run(async () => {
      order.push("second-start")
      return "complete"
    })
    rejectFirst(new Error("injected storage failure"))

    await expect(first).rejects.toThrow("injected storage failure")
    await expect(second).resolves.toBe("complete")
    expect(order).toEqual(["first-start", "second-start"])
  })
})
