import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Typography from "@mui/material/Typography"

export function ScanEmptyState({
  compact = false,
  identityPending = false,
  onChangeSettings
}: {
  compact?: boolean
  identityPending?: boolean
  onChangeSettings: () => void
}) {
  return (
    <Box
      sx={
        compact
          ? { display: "grid", gap: 1 }
          : {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              pt: 8,
              gap: 2
            }
      }>
      <Typography
        variant={compact ? "body2" : "h6"}
        color={compact ? "text.primary" : "text.secondary"}
        fontWeight={compact ? 800 : undefined}>
        {identityPending
          ? "Confirming the connected photo library"
          : "No duplicate sets found in this scan."}
      </Typography>
      <Typography
        variant={compact ? "caption" : "body2"}
        color="text.secondary">
        {identityPending ? (
          <>
            PhotoSweep is verifying that these results belong to the connected
            account. Selection, export, and cleanup are unavailable until the
            account is confirmed. Reconnect the account used for this scan if
            verification does not finish.
          </>
        ) : (
          <>
            No duplicate sets were found among the items this scan examined.
            Widen the date range or try Full scan to look for copies saved
            farther apart.
          </>
        )}
      </Typography>
      {!identityPending && (
        <Button
          variant={compact ? "outlined" : "contained"}
          onClick={onChangeSettings}>
          Change scan settings
        </Button>
      )}
    </Box>
  )
}
