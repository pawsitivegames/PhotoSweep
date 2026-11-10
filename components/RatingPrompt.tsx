import RateReviewRoundedIcon from "@mui/icons-material/RateReviewRounded"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Typography from "@mui/material/Typography"

import { photoSweepColors } from "../lib/theme"
import { ReviewLink } from "./ReviewLink"

export type RatingPromptProps = {
  open: boolean
  onReview: () => void
  onFeedback: () => void
  onLater: () => void
  onNever: () => void
}

/** An inline invitation keeps cleanup and Undo controls available. */
export function RatingPrompt({
  open,
  onReview,
  onFeedback,
  onLater,
  onNever
}: RatingPromptProps) {
  if (!open) return null
  return (
    <Box
      component="section"
      aria-label="PhotoSweep review invitation"
      sx={{
        my: 1.5,
        p: 2,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: photoSweepColors.surface
      }}>
      <Typography
        component="h2"
        variant="subtitle1"
        sx={{ display: "flex", alignItems: "center", gap: 1, fontWeight: 700 }}>
        <RateReviewRoundedIcon color="primary" fontSize="small" />
        How was your PhotoSweep cleanup?
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mt: 0.5, mb: 1.5 }}>
        Whether everything worked well or something could be better, you can
        leave an honest review on the Chrome Web Store or send feedback to the
        team.
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        <ReviewLink onOpen={onReview} />
        <Button size="small" onClick={onFeedback}>
          Send feedback
        </Button>
        <Button size="small" onClick={onLater}>
          Maybe later
        </Button>
        <Button size="small" color="inherit" onClick={onNever}>
          Don&apos;t ask again
        </Button>
      </Box>
    </Box>
  )
}
