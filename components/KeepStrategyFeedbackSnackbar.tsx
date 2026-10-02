import Alert from "@mui/material/Alert"
import Snackbar from "@mui/material/Snackbar"

interface KeepStrategyFeedbackSnackbarProps {
  message: string | null
  onClose: () => void
}

export function KeepStrategyFeedbackSnackbar({
  message,
  onClose
}: KeepStrategyFeedbackSnackbarProps) {
  return (
    <Snackbar
      key={message ?? "keep-strategy-feedback"}
      open={!!message}
      autoHideDuration={9000}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
      <Alert
        onClose={onClose}
        severity="info"
        variant="filled"
        role="status"
        aria-live="polite"
        sx={{ maxWidth: 600 }}>
        {message}
      </Alert>
    </Snackbar>
  )
}
