import { describe, expect, it } from "vitest"

import {
  CHROME_WEB_STORE_REVIEWS_URL,
  FEEDBACK_EMAIL,
  FEEDBACK_MAILTO_URL,
  FEEDBACK_SUBJECT,
  PHOTOSWEEP_SITE_URL
} from "../../lib/feedback"

describe("feedback mail target", () => {
  it("uses the support inbox and stable subject", () => {
    expect(FEEDBACK_EMAIL).toBe("pawsitivegames@gmail.com")
    expect(FEEDBACK_SUBJECT).toBe("PhotoSweep feedback")
    expect(FEEDBACK_MAILTO_URL).toBe(
      "mailto:pawsitivegames@gmail.com?subject=PhotoSweep%20feedback"
    )
    expect(PHOTOSWEEP_SITE_URL).toBe(
      "https://photosweep.pawsitivegames.chatgpt.site/"
    )
    expect(CHROME_WEB_STORE_REVIEWS_URL).toBe(
      "https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo/reviews"
    )
  })
})
