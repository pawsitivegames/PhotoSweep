import { describe, expect, it } from "vitest"

import {
  FEEDBACK_EMAIL,
  FEEDBACK_MAILTO_URL,
  FEEDBACK_SUBJECT
} from "../../lib/feedback"

describe("feedback mail target", () => {
  it("uses the support inbox and stable subject", () => {
    expect(FEEDBACK_EMAIL).toBe("pawsitivegames@gmail.com")
    expect(FEEDBACK_SUBJECT).toBe("PhotoSweep feedback")
    expect(FEEDBACK_MAILTO_URL).toBe(
      "mailto:pawsitivegames@gmail.com?subject=PhotoSweep%20feedback"
    )
  })
})
