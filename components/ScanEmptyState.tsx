import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Typography from "@mui/material/Typography"

export function ScanEmptyState({
  compact = false,
  onChangeSettings
}: {
  compact?: boolean
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
        No duplicate sets found in this scan.
      </Typography>
      <Typography
        variant={compact ? "caption" : "body2"}
        color="text.secondary">
        No duplicate sets were found among the items this scan examined. Widen
        the date range or try Full scan to look for copies saved farther apart.
      </Typography>
      <Button
        variant={compact ? "outlined" : "contained"}
        onClick={onChangeSettings}>
        Change scan settings
      </Button>
    </Box>
  )
}
