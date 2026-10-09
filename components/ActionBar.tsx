import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined"
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded"
import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank"
import CheckBoxOutlinedIcon from "@mui/icons-material/CheckBoxOutlined"
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded"
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded"
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded"
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded"
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded"
import TableChartRoundedIcon from "@mui/icons-material/TableChartRounded"
import TuneRoundedIcon from "@mui/icons-material/TuneRounded"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Divider from "@mui/material/Divider"
import IconButton from "@mui/material/IconButton"
import LinearProgress from "@mui/material/LinearProgress"
import Menu from "@mui/material/Menu"
import MenuItem from "@mui/material/MenuItem"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import ToggleButton from "@mui/material/ToggleButton"
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup"
import Typography from "@mui/material/Typography"
import { useState } from "react"

import { KEEP_STRATEGY_LABELS, type KeepStrategy } from "../lib/keep-strategy"
import { photoSweepColors } from "../lib/theme"

export type ReviewFilter = "all" | "exact" | "similar"

interface ActionBarProps {
  totalItems: number
  groupCount: number
  totalGroupCount: number
  availableGroupCount?: number
  hiddenAvailableGroupCount?: number
  reviewedGroupCount: number
  selectedShownGroupCount: number
  includedGroupCount?: number
  exactGroupCount: number
  similarGroupCount: number
  reviewFilter: ReviewFilter
  onReviewFilterChange: (filter: ReviewFilter) => void
  onIncludeAllEligible?: () => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onRescan: () => void
  onExportJson: () => void
  onExportCsv: () => void
  onApplyKeepStrategy: (strategy: KeepStrategy) => void
  recoveryHistoryCount?: number
  onOpenRecoveryHistory?: () => void
  onClearDecisionMemory?: () => void
  compact?: boolean
}

export function ActionBar({
  totalItems,
  groupCount,
  totalGroupCount,
  availableGroupCount = totalGroupCount,
  hiddenAvailableGroupCount = 0,
  reviewedGroupCount,
  selectedShownGroupCount,
  includedGroupCount = selectedShownGroupCount,
  exactGroupCount,
  similarGroupCount,
  reviewFilter,
  onReviewFilterChange,
  onIncludeAllEligible,
  onSelectAll,
  onDeselectAll,
  onRescan,
  onExportJson,
  onExportCsv,
  onApplyKeepStrategy,
  recoveryHistoryCount = 0,
  onOpenRecoveryHistory,
  onClearDecisionMemory,
  compact = false
}: ActionBarProps) {
  const [keepMenuAnchor, setKeepMenuAnchor] = useState<HTMLElement | null>(null)
  const keepMenuOpen = Boolean(keepMenuAnchor)
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<HTMLElement | null>(null)
  const moreMenuOpen = Boolean(moreMenuAnchor)
  const allShownGroupsSelected =
    groupCount > 0 && selectedShownGroupCount >= groupCount
  const allAvailableGroupsIncluded =
    availableGroupCount > 0 && includedGroupCount >= availableGroupCount
  const reviewedPercent =
    groupCount > 0
      ? Math.min(100, Math.max(0, (reviewedGroupCount / groupCount) * 100))
      : 0
  const availableSetCountLabel = `${availableGroupCount.toLocaleString()} available set${availableGroupCount === 1 ? "" : "s"}`
  const shownSetCountLabel = `${groupCount.toLocaleString()} shown set${groupCount === 1 ? "" : "s"}`
  const includeAllLabel = allAvailableGroupsIncluded
    ? "All available sets included"
    : availableGroupCount === 0
      ? "No available sets"
      : "Include all available sets"
  const includeAllAriaLabel = allAvailableGroupsIncluded
    ? `All ${availableSetCountLabel} already included in cleanup`
    : availableGroupCount === 0
      ? "No sets are available to include in cleanup"
      : `Include all ${availableSetCountLabel} in cleanup`
  const includeAllTitle = allAvailableGroupsIncluded
    ? "All sets available to review across the scan are already included."
    : availableGroupCount === 0
      ? "There are no sets available to review in this scan."
      : "Includes every set available to review across the scan, even outside this filter. Plan-locked sets stay out. Newly included sets return to Needs review."

  return (
    <Paper
      elevation={0}
      sx={{
        position: compact ? "static" : "sticky",
        top: compact ? undefined : 80,
        zIndex: 9,
        px: compact ? 0.75 : { xs: 1.5, md: 2 },
        py: compact ? 0.75 : 1.25,
        mb: compact ? 0.75 : 2,
        borderRadius: compact ? 1.5 : 1.5,
        border: "1px solid",
        borderColor: compact
          ? photoSweepColors.border
          : photoSweepColors.border,
        bgcolor: photoSweepColors.surface,
        backdropFilter: "none",
        boxShadow: "0 2px 8px rgba(27, 45, 66, 0.05)",
        display: "flex",
        justifyContent: compact ? "space-between" : "flex-start",
        alignItems: compact ? "center" : "stretch",
        flexWrap: "wrap",
        gap: compact ? 1 : 1.5
      }}>
      <Box
        sx={{
          minWidth: compact ? "100%" : "100%",
          display: compact ? "grid" : "block",
          gridTemplateColumns: compact
            ? "20px minmax(0, 1fr) auto 32px"
            : undefined,
          gap: compact ? 0.75 : undefined,
          alignItems: compact ? "center" : undefined
        }}>
        {compact && (
          <Box
            sx={{
              display: "grid",
              placeItems: "center",
              color: photoSweepColors.primary
            }}>
            <ArticleOutlinedIcon sx={{ fontSize: 19 }} />
          </Box>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="subtitle2"
            fontWeight={800}
            sx={{ lineHeight: 1.2 }}>
            {compact
              ? `${groupCount.toLocaleString()} set${groupCount === 1 ? "" : "s"} to review`
              : `${groupCount.toLocaleString()} duplicate set${groupCount === 1 ? "" : "s"} to review`}
          </Typography>
          {!compact && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.2, lineHeight: 1.25 }}>
              {reviewedGroupCount.toLocaleString()} of{" "}
              {groupCount.toLocaleString()} shown sets reviewed
            </Typography>
          )}
          {!compact && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", lineHeight: 1.25 }}>
              {includedGroupCount.toLocaleString()} of{" "}
              {availableGroupCount.toLocaleString()} available sets included
              across the scan; {selectedShownGroupCount.toLocaleString()} of{" "}
              {groupCount.toLocaleString()} shown sets included here. Newly
              included sets return to Needs review.
            </Typography>
          )}
          {!compact && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", lineHeight: 1.25 }}>
              {totalItems.toLocaleString()} photos and videos checked
              {groupCount !== totalGroupCount ? " · " : ""}
              {groupCount !== totalGroupCount && (
                <Box component="span">
                  {totalGroupCount.toLocaleString()} sets in scan
                </Box>
              )}
            </Typography>
          )}
        </Box>
        {compact && (
          <Typography
            variant="caption"
            color="text.secondary"
            aria-label={`${reviewedGroupCount.toLocaleString()} of ${groupCount.toLocaleString()} shown sets reviewed`}
            sx={{
              whiteSpace: "nowrap",
              fontWeight: 750,
              fontVariantNumeric: "tabular-nums"
            }}>
            {reviewedGroupCount.toLocaleString()}/{groupCount.toLocaleString()}
          </Typography>
        )}
        {compact && (
          <IconButton
            size="small"
            aria-label="More review actions"
            title="More actions"
            aria-controls={moreMenuOpen ? "review-more-menu" : undefined}
            aria-haspopup="menu"
            aria-expanded={moreMenuOpen ? "true" : undefined}
            onClick={(event) => setMoreMenuAnchor(event.currentTarget)}
            sx={{
              width: 32,
              height: 32,
              color: photoSweepColors.muted,
              borderRadius: 1,
              "&:hover": { bgcolor: photoSweepColors.surfaceSoft }
            }}>
            <MoreHorizRoundedIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      {totalGroupCount > 0 && compact && (
        <Box
          sx={{
            width: "100%",
            display: "grid",
            gap: 0.75
          }}>
          <LinearProgress
            variant="determinate"
            value={reviewedPercent}
            aria-label="Review progress"
            sx={{
              height: 3,
              borderRadius: 2,
              bgcolor: photoSweepColors.surfaceSoft,
              "& .MuiLinearProgress-bar": {
                borderRadius: 2,
                bgcolor: photoSweepColors.primary
              }
            }}
          />
          <ToggleButtonGroup
            value={reviewFilter}
            exclusive
            size="small"
            fullWidth
            aria-label="Review filter"
            sx={{
              bgcolor: photoSweepColors.surfaceSoft,
              borderRadius: 1.75,
              p: 0.2,
              "& .MuiToggleButton-root": {
                borderColor: "transparent",
                minWidth: 0,
                minHeight: 32,
                px: 0.5,
                py: 0.25,
                fontSize: 11.5,
                lineHeight: 1.1,
                fontWeight: 750,
                whiteSpace: "nowrap"
              }
            }}
            onChange={(_, value) => {
              if (value !== null) onReviewFilterChange(value)
            }}>
            <ToggleButton value="all">
              All {totalGroupCount.toLocaleString()}
            </ToggleButton>
            <ToggleButton value="exact" aria-label="Exact identical sets">
              Exact {exactGroupCount.toLocaleString()}
            </ToggleButton>
            <ToggleButton value="similar" aria-label="Similar candidate sets">
              Similar {similarGroupCount.toLocaleString()}
            </ToggleButton>
          </ToggleButtonGroup>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 0.85fr) auto minmax(0, 1.15fr)",
              alignItems: "center",
              gap: 0.75,
              p: 0.75,
              border: "1px solid",
              borderColor: photoSweepColors.border,
              borderRadius: 1.5,
              bgcolor: photoSweepColors.surfaceSubtle
            }}>
            <Box sx={{ display: "grid", gap: 0.4, minWidth: 0 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontSize: 10, lineHeight: 1.1, fontWeight: 850 }}>
                KEEPERS
              </Typography>
              <Button
                variant="outlined"
                size="small"
                fullWidth
                startIcon={<TuneRoundedIcon sx={{ fontSize: 16 }} />}
                disabled={totalGroupCount === 0}
                onClick={(event) => setKeepMenuAnchor(event.currentTarget)}
                aria-controls={keepMenuOpen ? "keep-strategy-menu" : undefined}
                aria-haspopup="menu"
                aria-expanded={keepMenuOpen ? "true" : undefined}
                aria-label="Choose keepers automatically"
                title="Choose a keeper rule across the scan. This does not change which sets are included in cleanup."
                sx={{
                  minHeight: 34,
                  minWidth: 0,
                  px: 0.5,
                  fontSize: 11.5,
                  fontWeight: 800,
                  bgcolor: photoSweepColors.surface,
                  whiteSpace: "nowrap",
                  "& .MuiButton-startIcon": { mr: 0.4 }
                }}>
                Auto choose
              </Button>
            </Box>
            <Divider orientation="vertical" flexItem sx={{ my: 0.25 }} />
            <Box sx={{ display: "grid", gap: 0.4, minWidth: 0 }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 0.5
                }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontSize: 10, lineHeight: 1.1, fontWeight: 850 }}>
                  CLEANUP
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ whiteSpace: "nowrap", fontWeight: 700 }}>
                  {includedGroupCount.toLocaleString()}/
                  {availableGroupCount.toLocaleString()} included
                </Typography>
              </Box>
              {onIncludeAllEligible && !allAvailableGroupsIncluded ? (
                <Button
                  variant="contained"
                  size="small"
                  fullWidth
                  disabled={availableGroupCount === 0}
                  onClick={onIncludeAllEligible}
                  aria-label={includeAllAriaLabel}
                  title={includeAllTitle}
                  sx={{
                    minHeight: 34,
                    minWidth: 0,
                    px: 0.5,
                    fontSize: 11.5,
                    fontWeight: 800,
                    whiteSpace: "nowrap"
                  }}>
                  {availableGroupCount === 0 ? "No sets to include" : "Include all"}
                </Button>
              ) : (
                <Typography
                  variant="caption"
                  color="success.dark"
                  sx={{ minHeight: 34, display: "flex", alignItems: "center", fontWeight: 750 }}>
                  {availableGroupCount === 0 ? "No eligible sets" : "All available included"}
                </Typography>
              )}
            </Box>
          </Box>

          <Menu
            id="keep-strategy-menu"
            anchorEl={keepMenuAnchor}
            open={keepMenuOpen}
            onClose={() => setKeepMenuAnchor(null)}>
            <Box sx={{ px: 2, py: 1, maxWidth: 300 }}>
              <Typography variant="caption" color="text.secondary">
                Choose a rule to pick keeper photos across all{" "}
                {totalGroupCount.toLocaleString()} scan sets, including sets
                outside this filter. Manual keeper choices may be replaced;
                which sets are included in cleanup stays the same.
              </Typography>
            </Box>
            <Divider />
            {(Object.keys(KEEP_STRATEGY_LABELS) as KeepStrategy[]).map(
              (strategy) => (
                <MenuItem
                  key={strategy}
                  onClick={() => {
                    onApplyKeepStrategy(strategy)
                    setKeepMenuAnchor(null)
                  }}>
                  {KEEP_STRATEGY_LABELS[strategy]}
                </MenuItem>
              )
            )}
          </Menu>
          <Menu
            id="review-more-menu"
            anchorEl={moreMenuAnchor}
            open={moreMenuOpen}
            onClose={() => setMoreMenuAnchor(null)}>
            <MenuItem
              onClick={() => {
                onRescan()
                setMoreMenuAnchor(null)
              }}>
              Scan again
            </MenuItem>
            <MenuItem
              onClick={() => {
                onExportJson()
                setMoreMenuAnchor(null)
              }}>
              Export audit report
            </MenuItem>
            <MenuItem
              onClick={() => {
                onExportCsv()
                setMoreMenuAnchor(null)
              }}>
              Export spreadsheet
            </MenuItem>
            {hiddenAvailableGroupCount > 0 && !allShownGroupsSelected && (
              <MenuItem
                onClick={() => {
                  onSelectAll()
                  setMoreMenuAnchor(null)
                }}>
                Include shown sets in cleanup
              </MenuItem>
            )}
            {selectedShownGroupCount > 0 && (
              <MenuItem
                onClick={() => {
                  onDeselectAll()
                  setMoreMenuAnchor(null)
                }}>
                Remove shown sets from cleanup
              </MenuItem>
            )}
            {onOpenRecoveryHistory && (
              <MenuItem
                onClick={() => {
                  onOpenRecoveryHistory()
                  setMoreMenuAnchor(null)
                }}>
                <HistoryRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                Recovery history{recoveryHistoryCount > 0 ? ` (${recoveryHistoryCount})` : ""}
              </MenuItem>
            )}
            {onClearDecisionMemory && (
              <MenuItem
                onClick={() => {
                  onClearDecisionMemory()
                  setMoreMenuAnchor(null)
                }}>
                Clear remembered decisions
              </MenuItem>
            )}
          </Menu>
        </Box>
      )}

      {totalGroupCount > 0 && !compact && (
        <Stack
          direction="row"
          spacing={0.6}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{
            width: "100%",
            "& .MuiButton-root": {
              minHeight: 36,
              px: 1,
              fontWeight: 750,
              whiteSpace: "nowrap"
            }
          }}>
          <ToggleButtonGroup
            value={reviewFilter}
            exclusive
            size="small"
            fullWidth={compact}
            aria-label="Review filter"
            sx={{
              bgcolor: photoSweepColors.surfaceSoft,
              borderRadius: 2,
              p: 0.25,
              "& .MuiToggleButton-root": {
                borderColor: "transparent",
                px: compact ? 1 : 1.25
              }
            }}
            onChange={(_, value) => {
              if (value !== null) onReviewFilterChange(value)
            }}>
            <ToggleButton value="all">
              All sets ({totalGroupCount.toLocaleString()})
            </ToggleButton>
            <ToggleButton value="exact">
              Verified identical ({exactGroupCount.toLocaleString()})
            </ToggleButton>
            <ToggleButton value="similar">
              Candidates &amp; similar ({similarGroupCount.toLocaleString()})
            </ToggleButton>
          </ToggleButtonGroup>
          {!compact && (
            <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
          )}
          <Button
            size="small"
            startIcon={<RefreshRoundedIcon />}
            onClick={onRescan}>
            Scan again
          </Button>
          <Button
            size="small"
            startIcon={<DownloadRoundedIcon />}
            onClick={onExportJson}>
            Export report
          </Button>
          <Button
            size="small"
            startIcon={<DownloadRoundedIcon />}
            onClick={onExportCsv}>
            Spreadsheet
          </Button>
          {onOpenRecoveryHistory && (
            <Button
              size="small"
              startIcon={<HistoryRoundedIcon />}
              onClick={onOpenRecoveryHistory}>
              Recovery{recoveryHistoryCount > 0 ? ` (${recoveryHistoryCount})` : ""}
            </Button>
          )}
          {!compact && (
            <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
          )}
          <Button
            size="small"
            startIcon={<TuneRoundedIcon />}
            onClick={(event) => setKeepMenuAnchor(event.currentTarget)}
            disabled={totalGroupCount === 0}
            aria-controls={keepMenuOpen ? "keep-strategy-menu" : undefined}
            aria-haspopup="menu"
            aria-expanded={keepMenuOpen ? "true" : undefined}>
            Choose keepers automatically
          </Button>
          <Menu
            id="keep-strategy-menu"
            anchorEl={keepMenuAnchor}
            open={keepMenuOpen}
            onClose={() => setKeepMenuAnchor(null)}>
            <Box sx={{ px: 2, py: 1, maxWidth: 300 }}>
              <Typography variant="caption" color="text.secondary">
                Choose a rule to pick keeper photos across all{" "}
                {totalGroupCount.toLocaleString()} scan sets, including sets
                outside this filter. Manual keeper choices may be replaced;
                which sets are included in cleanup stays the same.
              </Typography>
            </Box>
            <Divider />
            {(Object.keys(KEEP_STRATEGY_LABELS) as KeepStrategy[]).map(
              (strategy) => (
                <MenuItem
                  key={strategy}
                  onClick={() => {
                    onApplyKeepStrategy(strategy)
                    setKeepMenuAnchor(null)
                  }}>
                  {KEEP_STRATEGY_LABELS[strategy]}
                </MenuItem>
              )
            )}
          </Menu>
          {!compact && (
            <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
          )}
          {onIncludeAllEligible && (
            <Button
              variant="contained"
              size="small"
              startIcon={
                allAvailableGroupsIncluded ? (
                  <CheckBoxOutlinedIcon />
                ) : (
                  <CheckBoxOutlineBlankIcon />
                )
              }
              disabled={availableGroupCount === 0 || allAvailableGroupsIncluded}
              onClick={onIncludeAllEligible}
              aria-label={includeAllAriaLabel}
              title={includeAllTitle}>
              {includeAllLabel}
            </Button>
          )}
          <Button
            size="small"
            startIcon={
              allShownGroupsSelected ? (
                <CheckBoxOutlinedIcon />
              ) : (
                <CheckBoxOutlineBlankIcon />
              )
            }
            disabled={groupCount === 0 || allShownGroupsSelected}
            onClick={onSelectAll}
            aria-label={
              allShownGroupsSelected
                ? `All ${shownSetCountLabel} already included in cleanup`
                : `Include all ${shownSetCountLabel} in cleanup`
            }
            title={
              allShownGroupsSelected
                ? "All sets in the current filter are already included in cleanup."
                : "Adds every set in the current filter to cleanup. Newly included sets return to Needs review."
            }>
            {allShownGroupsSelected
              ? `All ${shownSetCountLabel} included`
              : `Include all ${shownSetCountLabel}`}
          </Button>
          <Button
            size="small"
            startIcon={<CheckBoxOutlineBlankIcon />}
            disabled={selectedShownGroupCount === 0}
            onClick={onDeselectAll}
            aria-label={`Remove ${shownSetCountLabel} from cleanup`}
            title="Removes only sets shown by the current filter from cleanup and marks them reviewed.">
            Remove shown sets from cleanup
          </Button>
        </Stack>
      )}
    </Paper>
  )
}

interface CleanupBarProps {
  includedGroupCount: number
  duplicateCount: number
  reviewedGroupCount: number
  totalGroupCount: number
  onReviewNext?: () => void
  onReviewAll?: () => void
  onTrash: () => void
  compact?: boolean
}

export function CleanupBar({
  includedGroupCount,
  duplicateCount,
  reviewedGroupCount,
  totalGroupCount,
  onReviewNext,
  onReviewAll,
  onTrash,
  compact = false
}: CleanupBarProps) {
  const reviewComplete =
    totalGroupCount > 0 && reviewedGroupCount === totalGroupCount
  const hasSelection = reviewComplete && duplicateCount > 0
  const remainingCount = Math.max(0, totalGroupCount - reviewedGroupCount)
  const canReviewNext =
    !reviewComplete && remainingCount > 0 && Boolean(onReviewNext)
  const showReviewAll = canReviewNext && Boolean(onReviewAll)
  const actionLabel = hasSelection
    ? "Review & move " + duplicateCount.toLocaleString() + " to Trash"
    : reviewComplete
      ? "No media items proposed for Trash"
      : canReviewNext
        ? "Review next set (" + remainingCount.toLocaleString() + " left)"
        : `Review ${remainingCount.toLocaleString()} set${
            remainingCount === 1 ? "" : "s"
          } before Trash`

  return (
    <Paper
      component="section"
      aria-label="Cleanup summary"
      elevation={0}
      sx={{
        position: "sticky",
        bottom: compact ? 8 : 16,
        zIndex: 10,
        mt: compact ? 1 : 1.5,
        p: compact ? 1 : 1.5,
        border: "1px solid",
        borderColor: hasSelection
          ? photoSweepColors.primaryBorder
          : photoSweepColors.border,
        borderRadius: 1.5,
        bgcolor: photoSweepColors.surface,
        backdropFilter: "none",
        boxShadow: "0 4px 14px rgba(27, 45, 66, 0.09)",
        display: "grid",
        gridTemplateColumns: compact
          ? "1fr"
          : { xs: "1fr", sm: "minmax(0, 1fr) auto" },
        alignItems: "center",
        gap: 1
      }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="subtitle2"
          fontWeight={850}
          role="status"
          aria-live="polite">
          {includedGroupCount.toLocaleString()} set
          {includedGroupCount === 1 ? "" : "s"} included
          {!reviewComplete &&
            ` · ${remainingCount.toLocaleString()} need review`}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", lineHeight: 1.35 }}>
          {duplicateCount.toLocaleString()} item
          {duplicateCount === 1 ? "" : "s"} proposed for Trash. Review each
          included set, then confirm before anything moves.
        </Typography>
      </Box>
      <Box
        sx={{
          display: showReviewAll ? "grid" : undefined,
          gridTemplateColumns: showReviewAll
            ? "repeat(2, minmax(0, 1fr))"
            : undefined,
          gap: 0.75,
          minWidth: 0
        }}>
        <Button
          variant="contained"
          color={reviewComplete ? "error" : "primary"}
          startIcon={
            reviewComplete ? (
              <DeleteOutlineRoundedIcon />
            ) : (
              <ArrowForwardRoundedIcon />
            )
          }
          disabled={!hasSelection && !canReviewNext}
          onClick={reviewComplete ? onTrash : onReviewNext}
          title={
            canReviewNext
              ? "Jump to the next unreviewed set. Review every set before moving anything to Trash."
              : reviewComplete && !hasSelection
                ? "All sets are reviewed, but no media items are proposed for Trash."
                : undefined
          }
          sx={{
            minHeight: 44,
            minWidth: 0,
            width: "100%",
            px: compact ? 0.75 : 1.5,
            fontWeight: 850
          }}>
          {showReviewAll ? "Review next" : actionLabel}
        </Button>
        {showReviewAll && (
          <Button
            variant="outlined"
            color="primary"
            onClick={onReviewAll}
            aria-label={`Mark all ${remainingCount.toLocaleString()} eligible sets as reviewed`}
            title={`Mark all ${remainingCount.toLocaleString()} eligible sets as reviewed. Cleanup inclusion and keeper choices stay unchanged. Moving items to Trash still requires separate confirmation.`}
            sx={{
              minHeight: 44,
              minWidth: 0,
              width: "100%",
              px: compact ? 0.75 : 1.5,
              fontWeight: 850
            }}>
            Review all
          </Button>
        )}
      </Box>
    </Paper>
  )
}
