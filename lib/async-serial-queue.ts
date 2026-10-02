/** Serializes async read/modify/write transactions within one app context. */
export class AsyncSerialQueue {
  private tail: Promise<void> = Promise.resolve()

  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => undefined).then(work)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
