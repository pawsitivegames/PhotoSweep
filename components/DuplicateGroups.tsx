import CheckBoxOutlineBlankRoundedIcon from "@mui/icons-material/CheckBoxOutlineBlankRounded"
import CheckBoxRoundedIcon from "@mui/icons-material/CheckBoxRounded"
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded"
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded"
import OpenInFullIcon from "@mui/icons-material/OpenInFull"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Card from "@mui/material/Card"
import CardActionArea from "@mui/material/CardActionArea"
import CardContent from "@mui/material/CardContent"
import CardMedia from "@mui/material/CardMedia"
import Chip from "@mui/material/Chip"
import IconButton from "@mui/material/IconButton"
import Paper from "@mui/material/Paper"
import Skeleton from "@mui/material/Skeleton"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react"
import { List, useListRef } from "react-window"
import type { RowComponentProps } from "react-window"

import { classifyDuplicateGroup } from "../lib/duplicate-classifier"
import {
  describeKeepRecommendation,
  recommendKeepForGroup
} from "../lib/keep-strategy"
import { favoriteStatusForItem } from "../lib/favorite-status"
import { buildThumbUrl } from "../lib/photo-url"
import { photoSweepColors } from "../lib/theme"
import type { KeepDecision } from "../lib/duplicate-review-session"
import type { DuplicateGroup, GpdMediaItem } from "../lib/types"
import type {
  OriginalContentHashResult,
  VideoPlaybackResult
} from "../lib/provider-retrieval"
import { PhotoViewerModal } from "./PhotoViewerModal"
import { useBlobUrl } from "./useBlobUrl"

const REVIEW_LIST_MAX_HEIGHT = 900
const REVIEW_LIST_VIEWPORT_OFFSET = 300
const REVIEW_LIST_FALLBACK_WIDTH = 900
const REVIEW_CARD_WIDTH = 190
const EMPTY_TRASH_PLAN_MEDIA_KEYS: ReadonlySet<string> = new Set()
const REVIEW_CARD_GAP = 12
const REVIEW_LIST_SCROLLBAR_GUTTER = 20
const REVIEW_ROW_HEADER_HEIGHT = 100
const REVIEW_ROW_VERTICAL_PADDING = 24
// Allow room for wrapped keeper guidance; underestimated rows overlap the next set.
const REVIEW_CARD_ESTIMATED_HEIGHT = 365
const REVIEW_ROW_ACTION_HEIGHT = 95
const REVIEW_ROW_MARGIN_BOTTOM = 16

/**
 * Label a group as "videos", "photos", or "items" depending on the kinds of
 * media inside. Groups with both kinds (rare, only possible if a video's
 * poster happens to match a still) fall back to the neutral "items".
 */
function groupItemKind(
  group: DuplicateGroup,
  mediaItems: Record<string, GpdMediaItem>
): string {
  let videos = 0
  let total = 0
  for (const key of group.mediaKeys) {
    const item = mediaItems[key]
    if (!item) continue
    total++
    if (item.duration) videos++
  }
  if (total === 0) return "items"
  if (videos === total) return total === 1 ? "video" : "videos"
  if (videos === 0) return total === 1 ? "photo" : "photos"
  return "items"
}

function storageStatusLabel(item: GpdMediaItem): string {
  if (item.takesUpSpace === false) return "No storage"
  if (item.takesUpSpace === true) return "Counts storage"
  return "Storage unknown"
}

// ── Hoisted static sx objects ──────────────────────────────────────────
const sxPaperBase = {
  mb: 2,
  overflow: "hidden",
  borderRadius: 2,
  border: "1px solid",
  borderColor: "divider",
  background: photoSweepColors.surface,
  transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  "@media (prefers-reduced-motion: reduce)": { transition: "none" }
}
const sxGroupHeader = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 1,
  px: 2,
  py: 1.25,
  backgroundColor: photoSweepColors.surface
}
const sxThumbnailsWrapper = {
  display: "flex",
  flexWrap: "wrap",
  gap: 1.5,
  p: 1.5,
  backgroundColor: photoSweepColors.surface
}
const sxItemWrapper = {
  position: "relative",
  width: REVIEW_CARD_WIDTH,
  flexShrink: 0,
  "& .viewer-btn": { opacity: 0 },
  "&:hover .viewer-btn, &:focus-within .viewer-btn": { opacity: 1 }
}
const sxCardBase = {
  width: "100%",
  overflow: "hidden",
  transition: "border-color 0.15s ease, background-color 0.15s ease",
  "@media (prefers-reduced-motion: reduce)": { transition: "none" }
}
const sxCardContent = {
  p: 1,
  "&:last-child": { pb: 1 },
  display: "flex",
  flexDirection: "column",
  gap: 0.5
}
const sxViewerBtn = {
  position: "absolute",
  top: 0,
  right: 0,
  color: "white",
  transition: "opacity 0.15s ease",
  "@media (prefers-reduced-motion: reduce)": { transition: "none" },
  minWidth: 44,
  minHeight: 44,
  "&::before": {
    content: '""',
    position: "absolute",
    inset: 8,
    borderRadius: "50%",
    bgcolor: "rgba(27, 45, 66, 0.82)"
  },
  "&:hover::before": { bgcolor: photoSweepColors.ink },
  "& svg": { position: "relative" }
}
const sxOpenInFullIcon = { fontSize: 14 }
const sxStatusChip = {
  width: "fit-content",
  height: "auto",
  minHeight: 20,
  fontSize: 11,
  border: 0,
  "& .MuiChip-label": { whiteSpace: "normal", px: 0, py: 0.25, lineHeight: 1.25 },
  "& .MuiChip-icon": { ml: 0, mr: 0.5 }
}
const sxVirtualList: CSSProperties = {
  overflowX: "hidden"
}
// ──────────────────────────────────────────────────────────────────────

function estimateGroupRowHeight(group: DuplicateGroup, width: number): number {
  const usableWidth = Math.max(
    width - 2 * REVIEW_CARD_GAP - REVIEW_LIST_SCROLLBAR_GUTTER,
    REVIEW_CARD_WIDTH
  )
  const columns = Math.max(
    1,
    Math.floor(
      (usableWidth + REVIEW_CARD_GAP) / (REVIEW_CARD_WIDTH + REVIEW_CARD_GAP)
    )
  )
  const thumbnailRows = Math.max(1, Math.ceil(group.mediaKeys.length / columns))
  return (
    REVIEW_ROW_HEADER_HEIGHT +
    REVIEW_ROW_VERTICAL_PADDING +
    thumbnailRows * REVIEW_CARD_ESTIMATED_HEIGHT +
    Math.max(0, thumbnailRows - 1) * REVIEW_CARD_GAP +
    REVIEW_ROW_ACTION_HEIGHT +
    REVIEW_ROW_MARGIN_BOTTOM
  )
}

function useMeasuredWidth<T extends HTMLElement>(
  fallbackWidth = REVIEW_LIST_FALLBACK_WIDTH
) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallbackWidth)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = () => {
      const nextWidth = el.getBoundingClientRect().width
      if (nextWidth > 0) setWidth(Math.round(nextWidth))
    }

    measure()

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure)
      return () => window.removeEventListener("resize", measure)
    }

    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, width }
}

const FALLBACK_THUMBNAIL_BACKDROPS = [
  "linear-gradient(135deg, #DCE6F5 0%, #F7F4EF 52%, #BCCBE0 100%)",
  "linear-gradient(135deg, #E7ECF5 0%, #CDD8E8 52%, #F1E6D8 100%)",
  "linear-gradient(135deg, #D2DDF0 0%, #F1E7DB 50%, #C1CEE1 100%)",
  "linear-gradient(135deg, #E3EBF3 0%, #D8CFC2 45%, #F3F6FB 100%)",
  "linear-gradient(135deg, #D6E0EC 0%, #F2E7DB 55%, #BDCCE0 100%)"
]

function fallbackThumbnailBackground(seed: string): string {
  const index = Math.abs(
    seed.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)
  )
  return FALLBACK_THUMBNAIL_BACKDROPS[
    index % FALLBACK_THUMBNAIL_BACKDROPS.length
  ]
}

function ThumbnailImage({
  src,
  alt,
  height = 132,
  fit = "cover"
}: {
  src: string
  alt: string
  height?: number
  fit?: "cover" | "contain"
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: "300px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const hasUsableSource = src.startsWith("http")
  const { blobUrl } = useBlobUrl(hasUsableSource && visible ? src : undefined)

  if (!hasUsableSource) {
    return (
      <Box
        ref={ref}
        sx={{
          height,
          minHeight: height,
          maxHeight: height,
          background: fallbackThumbnailBackground(alt),
          position: "relative",
          overflow: "hidden",
          "&:after": {
            content: '""',
            position: "absolute",
            inset: "50% -10% -20%",
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.66), rgba(255,255,255,0.08))",
            transform: "skewY(-9deg)"
          },
          "&:before": {
            content: '""',
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(27,45,66,0.1))"
          }
        }}
      />
    )
  }

  return (
    <div ref={ref}>
      {blobUrl ? (
        <CardMedia
          component="img"
          image={blobUrl}
          alt={alt}
          sx={{
            height,
            width: "100%",
            objectFit: fit,
            bgcolor: photoSweepColors.surfaceSubtle
          }}
        />
      ) : (
        <Skeleton variant="rectangular" height={height} animation="wave" />
      )}
    </div>
  )
}

interface DuplicateGroupRowProps {
  group: DuplicateGroup
  mediaItems: Record<string, GpdMediaItem>
  trashPlanMediaKeys: ReadonlySet<string>
  isSelected: boolean
  isReviewed: boolean
  keptSet: Set<string>
  keepDecision?: KeepDecision
  onToggleGroup: (groupId: string) => void
  onSkipGroup: (groupId: string) => void
  onToggleKept: (group: DuplicateGroup, mediaKey: string) => void
  onTrashAll: (group: DuplicateGroup) => void
  onOpenViewer: (group: DuplicateGroup, index: number) => void
  onMouseEnterPhoto: (group: DuplicateGroup, index: number) => void
  onMouseLeavePhoto: () => void
  readOnly?: boolean
  compact?: boolean
}

const DuplicateGroupRow = memo(function DuplicateGroupRow({
  group,
  mediaItems,
  trashPlanMediaKeys,
  isSelected,
  isReviewed,
  keptSet,
  keepDecision,
  onToggleGroup,
  onSkipGroup,
  onToggleKept,
  onTrashAll,
  onOpenViewer,
  onMouseEnterPhoto,
  onMouseLeavePhoto,
  readOnly = false,
  compact = false
}: DuplicateGroupRowProps) {
  // Recompute from current media evidence. Persisted legacy `exact` values
  // must not keep an unsupported certainty label alive in the UI.
  const classification = classifyDuplicateGroup(group, mediaItems)
  const classificationLabel =
    classification.relationship === "same_provider_asset"
      ? "Same asset reference"
      : classification.relationship === "related_format_edit"
        ? "Related format"
        : classification.evidenceLevel === "verified_identical"
          ? "Verified identical"
          : classification.evidenceLevel === "strong_duplicate_candidate"
            ? "Strong duplicate candidate"
            : "Similar"
  const classificationColor =
    classification.relationship === "same_provider_asset"
      ? "error"
      : classification.relationship === "related_format_edit"
        ? "info"
        : classification.evidenceLevel === "verified_identical"
          ? "success"
          : classification.evidenceLevel === "strong_duplicate_candidate"
            ? "warning"
            : "default"
  const classificationTitle =
    [
      classification.matchReasons.length > 0
        ? classification.matchReasons.join(", ")
        : "visual similarity",
      ...(classification.canProposeTrash
        ? []
        : ["Trash proposal disabled for this relationship"])
    ].join(" · ")
  const recommendation =
    keepDecision?.recommendation ??
    recommendKeepForGroup(group, mediaItems, "best_quality")
  const decisionSource = keepDecision?.source ?? "automatic"
  const decisionSummary =
    decisionSource === "manual"
      ? "Manual keep selection"
      : decisionSource === "legacy_preserved"
        ? "Kept from previous review"
        : decisionSource === "stale_fallback"
          ? "Keeping all copies until saved keeper data is reviewed"
          : describeKeepRecommendation(recommendation)
  const lastKeeperHintId = `last-kept-copy-${encodeURIComponent(group.id)}`

  return (
    <Paper
      variant="outlined"
      data-review-group-id={group.id}
      sx={[
        sxPaperBase,
        {
          mb: compact ? 0 : sxPaperBase.mb,
          borderRadius: compact ? 1.5 : sxPaperBase.borderRadius,
          borderWidth: isSelected ? 2 : 1,
          borderColor: isSelected ? "primary.main" : "divider"
        }
      ]}>
      <Box
        sx={[
          sxGroupHeader,
          compact ? { px: 1.25, py: 1, gap: 0.75 } : undefined
        ]}>
        <Box sx={{ flex: 1, minWidth: compact ? 0 : 180 }}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, alignItems: "center" }}>
            <Typography variant="subtitle1" fontWeight={700}>
              {group.mediaKeys.length} {groupItemKind(group, mediaItems)}
            </Typography>
            {!readOnly && (
              <Typography
                variant="caption"
                color={!isReviewed ? "warning.main" : isSelected ? "primary.main" : "text.secondary"}>
                {!isReviewed
                  ? isSelected
                    ? "Selected · needs review"
                    : "Review this set"
                  : isSelected
                    ? "Selected for cleanup"
                    : "Not selected"}
              </Typography>
            )}
          </Box>
          <Typography
            display="block"
            variant="caption"
            color={
              recommendation.status === "no_confident_recommendation"
                ? "warning.main"
                : "text.secondary"
            }
            data-testid={`keep-decision-${group.id}`}
            sx={compact ? { lineHeight: 1.35 } : undefined}>
            {decisionSummary}
          </Typography>
        </Box>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{
            flexWrap: "wrap",
            width: compact ? "100%" : { xs: "100%", sm: "auto" }
          }}>
          <Typography variant="caption" color="text.secondary">
            {Math.round(group.similarity * 100)}% match
          </Typography>
          <Typography
            variant="caption"
            fontWeight={700}
            color={classificationColor === "default" ? "text.secondary" : `${classificationColor}.main`}
            title={classificationTitle}>
            {classificationLabel}
          </Typography>
          {!classification.canProposeTrash && (
            <Typography
              variant="caption"
              color="text.secondary"
              title="This relationship is not eligible for an automatic Trash proposal.">
              Review only
            </Typography>
          )}

        </Stack>
      </Box>

      {!readOnly && (
        <Typography
          variant="caption"
          component="div"
          sx={{
            px: compact ? 1 : 1.5,
            pt: 0.5,
            color: "text.secondary",
            fontWeight: 700
          }}>
          Choose the copies to keep
        </Typography>
      )}
      <Box
        sx={[
          sxThumbnailsWrapper,
          compact
            ? {
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 1,
                p: 1,
                "@media (max-width: 280px)": { gridTemplateColumns: "1fr" }
              }
            : undefined
        ]}>
        {group.mediaKeys.map((key, itemIndex) => {
          const item = mediaItems[key]
          if (!item) return null
          const isKept = keptSet.has(key)
          const favoriteStatus = favoriteStatusForItem(item)
          const favoriteProtected = favoriteStatus === "favorite"
          const isLastKeptCopy =
            !readOnly && !favoriteProtected && isKept && keptSet.size === 1
          const movesToTrash =
            isSelected &&
            !isKept &&
            !favoriteProtected &&
            trashPlanMediaKeys.has(key)
          const isUserDecision =
            decisionSource === "manual" ||
            decisionSource === "legacy_preserved" ||
            decisionSource === "stale_fallback"
          const isExplicitlyKept = isUserDecision && isKept
          const isSuggestedKeep = !isUserDecision && isKept
          const itemLabel = item.fileName || item.mediaKey

          return (
            <Box
              key={key}
              onMouseEnter={() => onMouseEnterPhoto(group, itemIndex)}
              onMouseLeave={onMouseLeavePhoto}
              sx={[
                sxItemWrapper,
                compact
                  ? {
                      width: "100%",
                      minWidth: 0,
                      "& .viewer-btn": { opacity: 1 }
                    }
                  : undefined
              ]}>
              <Card
                variant="outlined"
                sx={[
                  sxCardBase,
                  {
                    bgcolor: isExplicitlyKept
                      ? photoSweepColors.primarySoft
                      : movesToTrash
                        ? photoSweepColors.errorSoft
                        : "background.paper",
                    borderColor: isExplicitlyKept
                      ? "primary.main"
                      : movesToTrash
                        ? "error.main"
                        : "divider",
                    borderWidth: isExplicitlyKept || movesToTrash ? 2 : 1
                  }
                ]}>
                <CardActionArea
                  aria-label={
                    readOnly
                      ? `View ${itemLabel} full size`
                      : favoriteProtected
                        ? `${itemLabel} is a favorite and is protected from Trash`
                        : isLastKeptCopy
                          ? `Keep ${itemLabel} (currently kept; this is the last kept copy, so at least one copy must remain kept.)`
                        : isKept
                          ? `Keep ${itemLabel} (currently kept; click to change the keeper choice)`
                        : movesToTrash && favoriteStatus === "unknown"
                            ? `Keep ${itemLabel} (currently proposed for Trash; favorite status unknown; click to keep)`
                            : movesToTrash
                              ? `Keep ${itemLabel} (currently proposed for Trash; click to keep)`
                              : `Keep ${itemLabel} (not in the current Trash proposal; click to change the decision)`
                  }
                  aria-describedby={
                    isLastKeptCopy ? lastKeeperHintId : undefined
                  }
                  aria-pressed={
                    readOnly ? undefined : isKept || favoriteProtected
                  }
                  sx={
                    compact
                      ? {
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr)",
                          alignItems: "stretch"
                        }
                      : undefined
                  }
                  onClick={() => {
                    if (readOnly) onOpenViewer(group, itemIndex)
                    else if (!favoriteProtected) onToggleKept(group, key)
                  }}>
                  <ThumbnailImage
                    src={
                      item.thumb.startsWith("data:")
                        ? item.thumb
                        : item.provider && item.provider !== "google"
                          ? item.thumb
                          : buildThumbUrl(item.thumb, { height: 200 })
                    }
                    alt={item.fileName || item.mediaKey}
                    height={compact ? 116 : 152}
                    fit={compact ? "contain" : "cover"}
                  />
                  <CardContent
                    sx={[
                      sxCardContent,
                      compact
                        ? {
                            minWidth: 0,
                            p: 0.9,
                            "&:last-child": { pb: 0.9 },
                            gap: 0.25,
                            justifyContent: "center"
                          }
                        : undefined
                    ]}>
                    {item.fileName && (
                      <Typography
                        variant="caption"
                        noWrap
                        title={item.fileName}
                        sx={{ display: "block", fontWeight: 700 }}>
                        {item.fileName}
                      </Typography>
                    )}
                    {item.resWidth && item.resHeight && (
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                          fontFamily: "monospace"
                        }}>
                        {item.resWidth}×{item.resHeight}
                      </Typography>
                    )}
                    {item.timestamp ? (
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                          display: "block"
                        }}>
                        <span>
                          {item.timestampProvenance === "capture"
                            ? "Taken "
                            : item.timestampProvenance === "creation"
                              ? "Created "
                              : item.timestampProvenance === "modified"
                                ? "Modified "
                                : "Date (source unknown) "}
                        </span>
                        {new Date(item.timestamp).toLocaleDateString(
                          undefined,
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric"
                          }
                        )}
                      </Typography>
                    ) : null}
                    {item.creationTimestamp &&
                    (item.creationTimestamp !== item.timestamp ||
                      item.creationTimestampProvenance !==
                        item.timestampProvenance) ? (
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                          display: "block"
                        }}>
                        <span>
                          {item.creationTimestampProvenance === "creation"
                            ? "Uploaded "
                            : item.creationTimestampProvenance === "modified"
                              ? "Modified "
                              : item.creationTimestampProvenance === "capture"
                                ? "Capture date "
                                : "Date (source unknown) "}
                        </span>
                        {new Date(item.creationTimestamp).toLocaleDateString(
                          undefined,
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric"
                          }
                        )}
                      </Typography>
                    ) : null}
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        display: "block"
                      }}>
                      {storageStatusLabel(item)}
                    </Typography>
                    {favoriteProtected ? (
                      <Chip
                        label="Favorite protected"
                        size="small"
                        color="warning"
                        variant="outlined"
                        sx={sxStatusChip}
                      />
                    ) : favoriteStatus === "unknown" ? (
                      <Chip
                        label="Favorite status unknown"
                        size="small"
                        color="warning"
                        variant="outlined"
                        sx={sxStatusChip}
                      />
                    ) : null}
                    {isExplicitlyKept ? (
                      <Chip
                        icon={<CheckCircleRoundedIcon />}
                        label="Keep this copy"
                        size="small"
                        color="primary"
                        variant="outlined"
                        sx={sxStatusChip}
                      />
                    ) : isSuggestedKeep ? (
                      <Chip
                        label="Suggested keep"
                        size="small"
                        variant="outlined"
                        sx={sxStatusChip}
                      />
                    ) : movesToTrash ? (
                      <Chip
                        icon={<DeleteOutlineRoundedIcon />}
                        label={
                          favoriteStatus === "unknown"
                            ? "Proposed for Trash · favorite unknown"
                            : "Proposed for Trash"
                        }
                        size="small"
                        color="error"
                        variant="outlined"
                        sx={sxStatusChip}
                      />
                    ) : !readOnly && !favoriteProtected ? (
                      <Chip
                        label="Select to keep"
                        size="small"
                        variant="outlined"
                        sx={sxStatusChip}
                      />
                    ) : null}
                  </CardContent>
                </CardActionArea>
              </Card>

              {/* Zoom overlay — secondary action, does not trigger Keep toggle */}
              <IconButton
                className="viewer-btn"
                size="small"
                aria-label="View full size"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenViewer(group, itemIndex)
                }}
                sx={sxViewerBtn}>
                <OpenInFullIcon sx={sxOpenInFullIcon} />
              </IconButton>
            </Box>
          );
        })}
      </Box>
      {!readOnly && (
        <Box
          sx={{
            p: compact ? 1 : 1.5,
            borderTop: "1px solid",
            borderColor: isSelected ? photoSweepColors.primaryBorder : "divider",
            bgcolor: isSelected ? photoSweepColors.primarySoft : "background.paper"
          }}>
          <Box
            role="checkbox"
            tabIndex={0}
            aria-checked={isSelected}
            aria-label={`Include this set of ${group.mediaKeys.length} ${groupItemKind(group, mediaItems)} for cleanup`}
            onClick={() => onToggleGroup(group.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onToggleGroup(group.id)
              }
            }}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              minHeight: 44,
              width: "fit-content",
              cursor: "pointer",
              borderRadius: 1,
              pr: 1,
              "&:hover": { bgcolor: photoSweepColors.primarySoft }
            }}>
            <Box sx={{ display: "grid", placeItems: "center", width: 30, flexShrink: 0 }}>
              {isSelected ? <CheckBoxRoundedIcon color="primary" /> : <CheckBoxOutlineBlankRoundedIcon color="action" />}
            </Box>
            <Box sx={{ py: 0.5 }}>
              <Typography variant="body2" fontWeight={700}>
                Include this set in cleanup
              </Typography>
              <Typography component="div" variant="caption" color="text.secondary">
                Add eligible copies you haven’t kept to the Trash proposal.
              </Typography>
            </Box>
          </Box>
          {keptSet.size === 1 && (
            <Typography
              id={lastKeeperHintId}
              component="div"
              variant="caption"
              color="text.secondary"
              sx={{ mt: 0.5 }}>
              Keep at least one copy, or choose “Mark all copies for Trash” to propose every eligible copy.
            </Typography>
          )}
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mt: 0.5 }}>
            <Button
              size="small"
              title="Keep this set out of the Trash proposal and mark it reviewed."
              onClick={() => onSkipGroup(group.id)}>
              Skip cleanup for this set
            </Button>
            <Button
              size="small"
              color="error"
              variant={keptSet.size === 0 ? "outlined" : "text"}
              startIcon={<DeleteOutlineRoundedIcon />}
              onClick={() => onTrashAll(group)}>
              Mark all copies for Trash
            </Button>
          </Stack>
        </Box>
      )}
    </Paper>
  );
})

interface DuplicateGroupsProps {
  groups: DuplicateGroup[]
  mediaItems: Record<string, GpdMediaItem>
  trashPlanMediaKeys?: ReadonlySet<string>
  selectedGroupIds: Set<string>
  reviewedGroupIds: Set<string>
  onToggleGroup: (groupId: string) => void
  onSkipGroup: (groupId: string) => void
  getKeptForGroup: (group: DuplicateGroup) => Set<string>
  getKeepDecisionForGroup?: (group: DuplicateGroup) => KeepDecision | undefined
  onToggleKept: (group: DuplicateGroup, mediaKey: string) => void
  onTrashAll: (group: DuplicateGroup) => void
  onVerifyOriginal?: (
    item: GpdMediaItem,
    signal: AbortSignal
  ) => Promise<OriginalContentHashResult>
  onLoadVideo?: (
    item: GpdMediaItem,
    signal: AbortSignal
  ) => Promise<VideoPlaybackResult>
  readOnly?: boolean
  heading?: string
  compact?: boolean
  onClearFilter?: () => void
  focusGroupId?: string | null
  onFocusGroupHandled?: () => void
}

interface VirtualGroupListData {
  groups: DuplicateGroup[]
  mediaItems: Record<string, GpdMediaItem>
  trashPlanMediaKeys: ReadonlySet<string>
  selectedGroupIds: Set<string>
  reviewedGroupIds: Set<string>
  getKeptForGroup: (group: DuplicateGroup) => Set<string>
  getKeepDecisionForGroup?: (group: DuplicateGroup) => KeepDecision | undefined
  onToggleGroup: (groupId: string) => void
  onSkipGroup: (groupId: string) => void
  onToggleKept: (group: DuplicateGroup, mediaKey: string) => void
  onTrashAll: (group: DuplicateGroup) => void
  onOpenViewer: (group: DuplicateGroup, index: number) => void
  onMouseEnterPhoto: (group: DuplicateGroup, index: number) => void
  onMouseLeavePhoto: () => void
  readOnly: boolean
}

interface VirtualGroupListRowProps {
  data: VirtualGroupListData
}

function VirtualGroupRow({
  ariaAttributes,
  index,
  style,
  data
}: RowComponentProps<VirtualGroupListRowProps>) {
  const group = data.groups[index]
  if (!group) return null

  return (
    <Box {...ariaAttributes} style={style} sx={{ pr: 0.5 }}>
      <DuplicateGroupRow
        group={group}
        mediaItems={data.mediaItems}
        trashPlanMediaKeys={data.trashPlanMediaKeys}
        isSelected={data.selectedGroupIds.has(group.id)}
        isReviewed={data.reviewedGroupIds.has(group.id)}
        keptSet={data.getKeptForGroup(group)}
        keepDecision={data.getKeepDecisionForGroup?.(group)}
        onToggleGroup={data.onToggleGroup}
        onSkipGroup={data.onSkipGroup}
        onToggleKept={data.onToggleKept}
        onTrashAll={data.onTrashAll}
        onOpenViewer={data.onOpenViewer}
        onMouseEnterPhoto={data.onMouseEnterPhoto}
        onMouseLeavePhoto={data.onMouseLeavePhoto}
        readOnly={data.readOnly}
      />
    </Box>
  )
}

export function DuplicateGroups({
  groups,
  mediaItems,
  trashPlanMediaKeys: suppliedTrashPlanMediaKeys,
  selectedGroupIds,
  reviewedGroupIds,
  onToggleGroup,
  onSkipGroup,
  getKeptForGroup,
  getKeepDecisionForGroup,
  onToggleKept,
  onTrashAll,
  onVerifyOriginal,
  onLoadVideo,
  readOnly = false,
  heading,
  compact = false,
  onClearFilter,
  focusGroupId,
  onFocusGroupHandled
}: DuplicateGroupsProps) {
  const trashPlanMediaKeys =
    suppliedTrashPlanMediaKeys ?? EMPTY_TRASH_PLAN_MEDIA_KEYS

  // Measure time from first non-empty groups render to commit
  const renderLoggedRef = useRef(false)
  const renderStartRef = useRef<number | null>(null)
  if (
    groups.length > 0 &&
    !renderLoggedRef.current &&
    renderStartRef.current === null
  ) {
    renderStartRef.current = performance.now()
  }
  useEffect(() => {
    if (
      renderLoggedRef.current ||
      renderStartRef.current === null ||
      groups.length === 0
    )
      return
    renderLoggedRef.current = true
    const elapsed = performance.now() - renderStartRef.current
    const totalThumbnails = groups.reduce((s, g) => s + g.mediaKeys.length, 0)
    console.log(
      `[GPD perf] Results render: ${elapsed.toFixed(0)}ms for ${groups.length} groups, ${totalThumbnails} thumbnails`
    )
  })

  const [viewerState, setViewerState] = useState<{
    group: DuplicateGroup
    index: number
  } | null>(null)
  const hoveredPhotoRef = useRef<{
    group: DuplicateGroup
    index: number
  } | null>(null)
  const { ref: listContainerRef, width: listWidth } =
    useMeasuredWidth<HTMLDivElement>()
  const listRef = useListRef(null)

  const onOpenViewer = useCallback((group: DuplicateGroup, index: number) => {
    setViewerState({ group, index })
  }, [])

  const onMouseEnterPhoto = useCallback(
    (group: DuplicateGroup, index: number) => {
      hoveredPhotoRef.current = { group, index }
    },
    []
  )

  const onMouseLeavePhoto = useCallback(() => {
    hoveredPhotoRef.current = null
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== " " || viewerState || !hoveredPhotoRef.current) return
      const target = event.target as HTMLElement | null
      if (
        typeof target?.closest === "function" &&
        target.closest("button, a, input, textarea, [role=checkbox]")
      ) {
        return
      }
      event.preventDefault()
      const hovered = hoveredPhotoRef.current
      onOpenViewer(hovered.group, hovered.index)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [viewerState, onOpenViewer])

  const currentGroupIndex = useMemo(() => {
    return viewerState
      ? groups.findIndex((g) => g.id === viewerState.group.id)
      : -1
  }, [viewerState, groups])

  const handleNextGroup = useCallback(() => {
    if (currentGroupIndex !== -1 && currentGroupIndex < groups.length - 1) {
      setViewerState({ group: groups[currentGroupIndex + 1], index: 0 })
    }
  }, [currentGroupIndex, groups])

  const handlePrevGroup = useCallback(() => {
    if (currentGroupIndex > 0) {
      setViewerState({ group: groups[currentGroupIndex - 1], index: 0 })
    }
  }, [currentGroupIndex, groups])

  const viewerItems = useMemo(() => {
    if (!viewerState) return []
    return viewerState.group.mediaKeys
      .map((k) => mediaItems[k])
      .filter((item): item is GpdMediaItem => !!item)
  }, [viewerState, mediaItems])

  const nextGroupItems = useMemo(() => {
    if (
      !viewerState ||
      currentGroupIndex === -1 ||
      currentGroupIndex >= groups.length - 1
    ) {
      return []
    }
    return groups[currentGroupIndex + 1].mediaKeys
      .map((key) => mediaItems[key])
      .filter((item): item is GpdMediaItem => !!item)
  }, [viewerState, currentGroupIndex, groups, mediaItems])

  const listGroups = groups

  const getItemSize = useCallback(
    (index: number) => estimateGroupRowHeight(listGroups[index], listWidth),
    [listGroups, listWidth]
  )

  const totalEstimatedHeight = useMemo(
    () =>
      listGroups.reduce((sum, _group, index) => sum + getItemSize(index), 0),
    [listGroups, getItemSize]
  )

  const listHeight =
    listGroups.length === 0
      ? 0
      : Math.max(
          320,
          Math.min(
            REVIEW_LIST_MAX_HEIGHT,
            Math.max(0, window.innerHeight - REVIEW_LIST_VIEWPORT_OFFSET),
            totalEstimatedHeight
          )
        )

  const virtualListData = useMemo<VirtualGroupListData>(
    () => ({
      groups: listGroups,
      mediaItems,
      trashPlanMediaKeys,
      selectedGroupIds,
      reviewedGroupIds,
      getKeptForGroup,
      getKeepDecisionForGroup,
      onToggleGroup,
      onSkipGroup,
      onToggleKept,
      onTrashAll,
      onOpenViewer,
      onMouseEnterPhoto,
      onMouseLeavePhoto,
      readOnly
    }),
    [
      listGroups,
      mediaItems,
      trashPlanMediaKeys,
      selectedGroupIds,
      reviewedGroupIds,
      getKeptForGroup,
      getKeepDecisionForGroup,
      onToggleGroup,
      onSkipGroup,
      onToggleKept,
      onTrashAll,
      onOpenViewer,
      onMouseEnterPhoto,
      onMouseLeavePhoto,
      readOnly
    ]
  )

  useEffect(() => {
    if (!focusGroupId) return
    const groupIndex = listGroups.findIndex(
      (group) => group.id === focusGroupId
    )
    if (groupIndex < 0) {
      onFocusGroupHandled?.()
      return
    }

    const focusGroup = () => {
      const card = Array.from(
        document.querySelectorAll<HTMLElement>("[data-review-group-id]")
      ).find((element) => element.dataset.reviewGroupId === focusGroupId)
      if (!card) return

      const focusTarget =
        card.querySelector<HTMLElement>("button:not(:disabled)") ??
        card.querySelector<HTMLElement>('[role="checkbox"]') ??
        card
      focusTarget.focus({ preventScroll: true })
      focusTarget.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center"
      })
    }

    if (compact) {
      focusGroup()
      onFocusGroupHandled?.()
      return
    }

    listRef.current?.scrollToRow({ index: groupIndex, align: "start" })
    let secondFrame: number | null = null
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        focusGroup()
        onFocusGroupHandled?.()
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame)
    }
  }, [compact, focusGroupId, listGroups, onFocusGroupHandled])

  if (groups.length === 0) {
    if (onClearFilter) {
      return (
        <Paper variant="outlined" sx={{ p: 2, mb: 1.5 }}>
          <Typography variant="subtitle1" fontWeight={700}>No sets in this filter</Typography>
          <Typography variant="body2" color="text.secondary">
            Your scan found matches in another category.
          </Typography>
          <Button size="small" onClick={onClearFilter} sx={{ mt: 0.5 }}>
            Show all sets
          </Button>
        </Paper>
      )
    }
    const totalItems = Object.keys(mediaItems).length
    return (
      <Box sx={{ textAlign: "center", py: 8 }}>
        <Typography variant="h6" gutterBottom sx={{
          color: "text.secondary"
        }}>
          No duplicates found
        </Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          Checked {totalItems.toLocaleString()} photos and videos. No duplicate
          sets were found with the current match sensitivity.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ pb: compact ? 2 : 6 }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 2,
          mb: compact ? 1 : 1.5
        }}>
        <Box>
          {!compact && (
            <Typography variant="h6" sx={{
              fontWeight: 700
            }}>
              {heading ??
                `${groups.length} Duplicate Set${groups.length !== 1 ? "s" : ""} to Review`}
            </Typography>
          )}
          {!compact && (
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              First choose the photos to keep. Then include sets in cleanup.
              Only included sets add eligible unkept copies to the Trash
              proposal; nothing moves until you confirm.
            </Typography>
          )}
        </Box>
      </Box>

      {compact && listGroups.length > 0 && (
        <Box sx={{ display: "grid", gap: 1.25 }}>
          {listGroups.map((group) => (
            <DuplicateGroupRow
              key={group.id}
              group={group}
              mediaItems={mediaItems}
              trashPlanMediaKeys={trashPlanMediaKeys}
              isSelected={selectedGroupIds.has(group.id)}
              isReviewed={reviewedGroupIds.has(group.id)}
              keptSet={getKeptForGroup(group)}
              keepDecision={getKeepDecisionForGroup?.(group)}
              onToggleGroup={onToggleGroup}
              onSkipGroup={onSkipGroup}
              onToggleKept={onToggleKept}
              onTrashAll={onTrashAll}
              onOpenViewer={onOpenViewer}
              onMouseEnterPhoto={onMouseEnterPhoto}
              onMouseLeavePhoto={onMouseLeavePhoto}
              readOnly={readOnly}
              compact
            />
          ))}
        </Box>
      )}

      {!compact && listGroups.length > 0 && (
        <Box ref={listContainerRef} data-testid="duplicate-groups-virtual-list">
          <List
            listRef={listRef}
            rowComponent={VirtualGroupRow}
            rowCount={listGroups.length}
            rowHeight={getItemSize}
            rowProps={{ data: virtualListData }}
            overscanCount={3}
            style={{ ...sxVirtualList, height: listHeight, width: "100%" }}
          />
        </Box>
      )}

      {/* Photo viewer modal — rendered once outside the map, state drives which photo */}
      {viewerState && (
        <PhotoViewerModal
          open={true}
          items={viewerItems}
          nextGroupItems={nextGroupItems}
          initialIndex={viewerState.index}
          keptSet={getKeptForGroup(viewerState.group)}
          isGroupSelected={selectedGroupIds.has(viewerState.group.id)}
          trashPlanMediaKeys={trashPlanMediaKeys}
          onClose={() => setViewerState(null)}
          onToggleKept={
            readOnly
              ? undefined
              : (mediaKey) => onToggleKept(viewerState.group, mediaKey)
          }
          onToggleGroup={
            readOnly ? undefined : () => onToggleGroup(viewerState.group.id)
          }
          onNextGroup={handleNextGroup}
          onPrevGroup={handlePrevGroup}
          onVerifyOriginal={readOnly ? undefined : onVerifyOriginal}
          onLoadVideo={readOnly ? undefined : onLoadVideo}
        />
      )}
    </Box>
  );
}
