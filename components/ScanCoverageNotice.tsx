import Alert from "@mui/material/Alert"
import Box from "@mui/material/Box"
import Divider from "@mui/material/Divider"
import Typography from "@mui/material/Typography"

import type { ScanCoverage } from "../lib/types"

function stopReasonText(coverage: ScanCoverage): string {
  switch (coverage.stopReason) {
    case "exhausted":
      return "The provider reached the end of the requested scope."
    case "watermark_reached":
      return "The incremental scan reached previously checked records; cached results are included in this review."
    case "changes_caught_up":
      return "All provider changes since the last scan were applied; cached results are included in this review."
    case "user_limit":
      return "The configured record limit stopped the scan before the provider scope was exhausted."
    case "loaded_items_only":
      return "Only items already loaded on the iCloud page were available; full-library coverage is unknown."
    case "cancelled":
      return "The scan stopped before the provider scope was exhausted."
    case "auth_expired":
      return "The provider session expired before the scan completed."
    case "provider_error":
      return "The provider returned an error before the scan completed."
    case "pagination_error":
      return "Provider pagination did not complete successfully."
    case "coverage_unknown":
      return "The provider response did not establish whether more records were available."
  }
}

export function ScanCoverageNotice({
  coverage,
  compact = false
}: {
  coverage?: ScanCoverage
  compact?: boolean
}) {
  if (!coverage) {
    return (
      <Alert severity="warning" sx={{ mb: compact ? 1 : 2 }}>
        <Typography variant="body2" fontWeight={700}>
          Scan coverage was not recorded
        </Typography>
        <Typography variant="body2">
          Run a fresh scan to confirm whether the full library or requested
          scope was examined.
        </Typography>
      </Alert>
    )
  }

  const severity = coverage.status === "complete" ? "info" : "warning"
  const mediaTypes = [
    `photos ${coverage.mediaTypesCovered.photos ? "covered" : "not covered"}`,
    `videos ${coverage.mediaTypesCovered.videos ? "covered" : "not covered"}`
  ].join("; ")

  const coverageDetails = (
    <>
      <Typography variant="body2" fontWeight={700}>
        {stopReasonText(coverage)}
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: compact ? 0.65 : 1.5
        }}>
        {[
          ["Examined", coverage.itemsVisited],
          ["In scope", coverage.itemsReturned],
          ["Skipped", coverage.itemsSkipped]
        ].map(([label, value]) => (
          <Box key={label} sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" fontWeight={700}>
              {Number(value).toLocaleString()}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", lineHeight: 1.3 }}>
              {label}
            </Typography>
          </Box>
        ))}
      </Box>
      <Divider />
      <Typography variant="caption" color="text.secondary">
        Media coverage: {mediaTypes}.
        {coverage.unknownDateItemsSkipped > 0 &&
          ` ${coverage.unknownDateItemsSkipped.toLocaleString()} items had missing or invalid dates.`}
        {coverage.unmappedItemsSkipped !== undefined &&
          coverage.unmappedItemsSkipped > 0 &&
          ` ${coverage.unmappedItemsSkipped.toLocaleString()} items could not be prepared for review.`}
        {coverage.totalItems !== undefined &&
          ` Provider total: ${coverage.totalItems.toLocaleString()}.`}
        {coverage.pagesRead !== undefined &&
          ` Provider pages read: ${coverage.pagesRead.toLocaleString()}.`}
      </Typography>
    </>
  )

  if (compact && coverage.status === "complete") {
    return (
      <Alert
        aria-label="Scan coverage"
        severity="info"
        sx={{
          mb: 0.75,
          py: 0.15,
          "& .MuiAlert-message": { width: "100%" },
          "& .MuiAlert-icon": { py: 0.35, mr: 0.75 }
        }}>
        <Box sx={{ display: "grid", gap: 0.15 }}>
          <Typography variant="caption" fontWeight={800}>
            Scan complete · {coverage.itemsReturned.toLocaleString()} in scope
            {coverage.itemsSkipped > 0 &&
              ` · ${coverage.itemsSkipped.toLocaleString()} skipped`}
          </Typography>
          <Box
            component="details"
            sx={{
              "& > summary": {
                cursor: "pointer",
                color: "text.secondary",
                fontSize: "0.75rem",
                lineHeight: 1.4
              }
            }}>
            <Box component="summary">Scan details</Box>
            <Box sx={{ display: "grid", gap: 0.85, pt: 0.75 }}>
              {coverageDetails}
            </Box>
          </Box>
        </Box>
      </Alert>
    )
  }

  return (
    <Alert
      aria-label="Scan coverage"
      severity={severity}
      sx={{ mb: compact ? 1 : 2, "& .MuiAlert-message": { width: "100%" } }}>
      <Box sx={{ display: "grid", gap: compact ? 0.85 : 1 }}>
        {coverageDetails}
      </Box>
    </Alert>
  )
}
