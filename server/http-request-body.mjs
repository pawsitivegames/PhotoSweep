export const MAX_REQUEST_BODY_BYTES = 1024 * 1024

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.")
    this.name = "RequestBodyTooLargeError"
    this.code = "REQUEST_BODY_TOO_LARGE"
  }
}

export function isRequestBodyTooLargeError(error) {
  return error?.code === "REQUEST_BODY_TOO_LARGE"
}

export function readBoundedRequestBody(nodeRequest) {
  const contentLength = nodeRequest.headers["content-length"]
  if (
    typeof contentLength === "string" &&
    /^\d+$/.test(contentLength) &&
    BigInt(contentLength) > BigInt(MAX_REQUEST_BODY_BYTES)
  ) {
    nodeRequest.pause()
    return Promise.reject(new RequestBodyTooLargeError())
  }

  return new Promise((resolve, reject) => {
    const chunks = []
    let byteLength = 0

    const cleanup = () => {
      nodeRequest.removeListener("data", onData)
      nodeRequest.removeListener("end", onEnd)
      nodeRequest.removeListener("error", onError)
      nodeRequest.removeListener("aborted", onAborted)
    }
    const fail = (error) => {
      cleanup()
      reject(error)
    }
    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (buffer.byteLength > MAX_REQUEST_BODY_BYTES - byteLength) {
        chunks.length = 0
        nodeRequest.pause()
        fail(new RequestBodyTooLargeError())
        return
      }
      byteLength += buffer.byteLength
      chunks.push(buffer)
    }
    const onEnd = () => {
      cleanup()
      resolve(Buffer.concat(chunks, byteLength))
    }
    const onError = (error) => fail(error)
    const onAborted = () => fail(new Error("Request body was aborted."))

    nodeRequest.on("data", onData)
    nodeRequest.once("end", onEnd)
    nodeRequest.once("error", onError)
    nodeRequest.once("aborted", onAborted)
  })
}
