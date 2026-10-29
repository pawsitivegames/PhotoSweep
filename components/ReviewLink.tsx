import Button from "@mui/material/Button"

import { CHROME_WEB_STORE_REVIEWS_URL } from "../lib/feedback"

export function ReviewLink({
  onOpen,
  variant = "outlined"
}: {
  onOpen?: () => void
  variant?: "outlined" | "text"
}) {
  return (
    <Button
      component="a"
      href={CHROME_WEB_STORE_REVIEWS_URL}
      target="_blank"
      rel="noopener noreferrer"
      size="small"
      variant={variant}
      onClick={onOpen}>
      Leave an honest review
    </Button>
  )
}
