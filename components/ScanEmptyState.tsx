import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Typography from "@mui/material/Typography"
import SearchRoundedIcon from "@mui/icons-material/SearchRounded"
import { photoSweepColors } from "../lib/photo-sweep-colors"

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
              mx: "auto",
              maxWidth: 600,
              p: { xs: 2.5, sm: 4 },
              gap: 1.5,
              textAlign: "center",
              bgcolor: photoSweepColors.surface,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1.5
            }
      }>
      {!compact && !identityPending && (
        <Box
          sx={{
            display: "grid",
            placeItems: "center",
            width: 44,
            height: 44,
            borderRadius: 1,
            bgcolor: "primary.light",
            color: "primary.main"
          }}>
          <SearchRoundedIcon />
        </Box>
      )}
      <Typography component="h2" variant={compact ? "subtitle2" : "h5"}>
        {identityPending
          ? "Confirming the connected photo library"
          : "No duplicate sets found in this scan."}
      </Typography>
      <Typography
        variant={compact ? "caption" : "body2"}
        sx={{
          color: "text.secondary"
        }}>
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
  );
}
