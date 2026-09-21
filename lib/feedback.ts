export const FEEDBACK_EMAIL = "pawsitivegames@gmail.com"
export const FEEDBACK_SUBJECT = "PhotoSweep feedback"
export const PHOTOSWEEP_SITE_URL = "https://photosweep.pawsitivegames.chatgpt.site/"

/** The mailto target used by every in-app feedback entry point. */
export const FEEDBACK_MAILTO_URL = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(FEEDBACK_SUBJECT)}`
