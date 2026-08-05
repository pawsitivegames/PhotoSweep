import { keyframes } from "@emotion/react"
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft"
import ChevronRightIcon from "@mui/icons-material/ChevronRight"
import CloseIcon from "@mui/icons-material/Close"
import HelpOutlineIcon from "@mui/icons-material/HelpOutline"
import OpenInNewIcon from "@mui/icons-material/OpenInNew"
import PlayCircleFilledWhiteIcon from "@mui/icons-material/PlayCircleFilledWhite"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import CardMedia from "@mui/material/CardMedia"
import Chip from "@mui/material/Chip"
import CircularProgress from "@mui/material/CircularProgress"
import Dialog from "@mui/material/Dialog"
import DialogContent from "@mui/material/DialogContent"
import IconButton from "@mui/material/IconButton"
import Link from "@mui/material/Link"
import Typography from "@mui/material/Typography"
import { useCallback, useEffect, useState } from "react"

import { buildThumbUrl } from "../lib/photo-url"
import type { GpdMediaItem } from "../lib/types"
import { usePrefersReducedMotion } from "../lib/use-prefers-reduced-motion"

/**
 * Preloads full-res blob URLs for all items in the group as soon as the modal
 * opens. Returns a stable map of mediaKey → blobUrl so navigating between
 * images is instant (no per-image fetch on demand).
 *
 * Deps are the joined thumb URLs so the effect only re-runs when the group
 * actually changes, not on every render.
 */
interface MediaBlob {
  url: string
  type: string
}

const EMPTY_MEDIA_ITEMS: GpdMediaItem[] = []

function isVideoItem(item: GpdMediaItem): boolean {
  return Number.isFinite(item.duration) && (item.duration ?? 0) > 0
}

function getViewportSizedThumbUrl(thumb: string): string {
  const width = Math.round(window.innerWidth * (window.devicePixelRatio || 1))
  const height = Math.round(window.innerHeight * (window.devicePixelRatio || 1))
  return buildThumbUrl(thumb, { width, height })
}

function mediaFetchUrl(item: GpdMediaItem): string {
  if (item.provider && item.provider !== "google") return item.thumb
  return isVideoItem(item)
    ? `${item.thumb}=dv`
    : getViewportSizedThumbUrl(item.thumb)
}

function providerLabel(item: GpdMediaItem): string {
  if (item.provider === "icloud") return "iCloud Photos"
  if (item.provider === "amazon") return "Amazon Photos"
  return "Google Photos"
}

function useGroupBlobUrls(
  items: GpdMediaItem[]
): Record<string, MediaBlob | undefined> {
  const [blobUrls, setBlobUrls] = useState<Record<string, MediaBlob>>({})

  const thumbKey = items.map((i) => mediaFetchUrl(i)).join("|")

  useEffect(() => {
    const controllers: AbortController[] = []
    const createdUrls: string[] = []
    let cancelled = false

    setBlobUrls({})

    items.forEach((item) => {
      const controller = new AbortController()
      controllers.push(controller)

      fetch(mediaFetchUrl(item), {
        credentials: "include",
        signal: controller.signal
      })
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => {
          if (blob && !cancelled) {
            const url = URL.createObjectURL(blob)
            createdUrls.push(url)
            setBlobUrls((prev) => ({
              ...prev,
              [item.mediaKey]: { url, type: blob.type }
            }))
          }
        })
        .catch(() => {})
    })

    return () => {
      cancelled = true
      controllers.forEach((c) => c.abort())
      createdUrls.forEach((url) => URL.revokeObjectURL(url))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbKey])

  return blobUrls
}

function usePrefetchNextGroup(nextItems: GpdMediaItem[]) {
  useEffect(() => {
    if (nextItems.length === 0) return

    const controllers: AbortController[] = []
    nextItems.forEach((item) => {
      const controller = new AbortController()
      controllers.push(controller)
      fetch(mediaFetchUrl(item), {
        credentials: "include",
        signal: controller.signal
      }).catch(() => {})
    })

    return () => controllers.forEach((controller) => controller.abort())
  }, [nextItems])
}

interface FullResMediaProps {
  item: GpdMediaItem
  blob: MediaBlob | undefined
}

function FullResMedia({ item, blob }: FullResMediaProps) {
  const isVideo = isVideoItem(item)
  const isPlayableVideo = isVideo && blob && !blob.type.startsWith("image/")

  if (!blob) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%"
        }}>
        <CircularProgress sx={{ color: "white" }} />
      </Box>
    )
  }

  if (isPlayableVideo) {
    return (
      <Box
        component="video"
        src={blob.url}
        controls
        playsInline
        preload="metadata"
        aria-label={item.fileName ? `Play ${item.fileName}` : "Play video"}
        sx={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          display: "block",
          mx: "auto",
          bgcolor: "black"
        }}
      />
    )
  }

  if (isVideo) {
    return (
      <Box
        sx={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%"
        }}>
        <CardMedia
          component="img"
          image={blob.url}
          alt={item.fileName || item.mediaKey}
          sx={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            display: "block",
            mx: "auto",
            opacity: item.productUrl ? 0.72 : 1
          }}
        />
        {item.productUrl && (
          <Button
            component="a"
            href={item.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="contained"
            startIcon={<PlayCircleFilledWhiteIcon />}
            sx={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              bgcolor: "rgba(255,255,255,0.94)",
              color: "#111111",
              boxShadow: "0 18px 44px rgba(0,0,0,0.35)",
              "&:hover": { bgcolor: "white" }
            }}>
            Play in {providerLabel(item)}
          </Button>
        )}
      </Box>
    )
  }

  return (
    <CardMedia
      component="img"
      image={blob.url}
      alt={item.fileName || item.mediaKey}
      sx={{
        maxWidth: "100%",
        maxHeight: "100%",
        objectFit: "contain",
        display: "block",
        mx: "auto"
      }}
    />
  )
}

export interface PhotoViewerModalProps {
  open: boolean
  items: GpdMediaItem[]
  nextGroupItems?: GpdMediaItem[]
  initialIndex: number
  keptSet: Set<string>
  isGroupSelected: boolean
  onClose: () => void
  onToggleKept?: (mediaKey: string) => void
  onToggleGroup?: () => void
  onNextGroup?: () => void
  onPrevGroup?: () => void
}

const slideInFromRight = keyframes`
  from { transform: translateX(10px); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
`
const slideInFromLeft = keyframes`
  from { transform: translateX(-10px); opacity: 0; }
  to   { transform: translateX(0);     opacity: 1; }
`

export function PhotoViewerModal({
  open,
  items,
  nextGroupItems = EMPTY_MEDIA_ITEMS,
  initialIndex,
  keptSet,
  isGroupSelected,
  onClose,
  onToggleKept,
  onToggleGroup,
  onNextGroup,
  onPrevGroup
}: PhotoViewerModalProps) {
  const [index, setIndex] = useState(initialIndex)
  const [slideDir, setSlideDir] = useState<"forward" | "backward">("forward")
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const prefersReducedMotion = usePrefersReducedMotion()

  // Preload all images in the group up front
  const blobUrls = useGroupBlobUrls(items)
  usePrefetchNextGroup(nextGroupItems)

  // Reset index when the modal opens, the initial photo changes, or the items change
  useEffect(() => {
    setIndex(initialIndex)
  }, [open, initialIndex, items])

  const navigate = useCallback((newIndex: number) => {
    setIndex((prev) => {
      if (newIndex === prev) return prev
      setSlideDir(newIndex > prev ? "forward" : "backward")
      return newIndex
    })
  }, [])

  // Keyboard navigation (arrow keys only; MUI Dialog handles Escape → onClose)
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey) {
        if (e.key === "ArrowUp") {
          e.preventDefault()
          if (!isGroupSelected) {
            onToggleGroup?.()
          }
          onNextGroup?.()
        } else if (e.key === "ArrowDown") {
          e.preventDefault()
          if (isGroupSelected) {
            onToggleGroup?.()
          }
        } else if (e.key === "ArrowLeft") {
          e.preventDefault()
          onPrevGroup?.()
        } else if (e.key === "ArrowRight") {
          e.preventDefault()
          onNextGroup?.()
        }
      } else {
        if (e.key === "ArrowLeft") {
          navigate(Math.max(0, index - 1))
        } else if (e.key === "ArrowRight") {
          navigate(Math.min(items.length - 1, index + 1))
        } else if (e.key === "ArrowUp") {
          e.preventDefault()
          const item = items[Math.min(index, items.length - 1)]
          if (item && !keptSet.has(item.mediaKey)) {
            onToggleKept?.(item.mediaKey)
          }
        } else if (e.key === "ArrowDown") {
          e.preventDefault()
          const item = items[Math.min(index, items.length - 1)]
          if (item && keptSet.has(item.mediaKey)) {
            onToggleKept?.(item.mediaKey)
          }
        }
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [
    open,
    index,
    items,
    keptSet,
    isGroupSelected,
    onToggleKept,
    onToggleGroup,
    onNextGroup,
    onPrevGroup
  ])

  if (items.length === 0) return null

  const safeIndex = Math.min(index, items.length - 1)
  const item = items[safeIndex]
  const isKept = keptSet.has(item.mediaKey)
  const isFirst = safeIndex === 0
  const isLast = safeIndex === items.length - 1

  const takenDate = item.timestamp
    ? new Date(item.timestamp).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      })
    : null

  const uploadedDate = item.creationTimestamp
    ? new Date(item.creationTimestamp).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      })
    : null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      aria-label="Photo viewer"
      slotProps={{
        backdrop: {
          sx: {
            bgcolor: "rgba(0,0,0,0.48)",
            backdropFilter: "blur(4px)"
          }
        },
        paper: {
          sx: {
            width: { xs: "calc(100vw - 16px)", sm: "auto" },
            maxHeight: { xs: "calc(100vh - 16px)", sm: "calc(100% - 64px)" },
            m: { xs: 1, sm: 4 },
            bgcolor: "#111111",
            backgroundColor: "#111111",
            color: "white",
            position: "relative",
            overflow: "hidden",
            borderRadius: { xs: 2, sm: 3 },
            backdropFilter: "saturate(180%) blur(24px)",
            boxShadow: "0 28px 90px rgba(0,0,0,0.42)"
          }
        }
      }}>
      {/* Header bar: filename left, counter center, close right */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          px: 1,
          py: 0.75,
          borderBottom: "1px solid rgba(255,255,255,0.12)",
          bgcolor: "rgba(255,255,255,0.06)"
        }}>
        <Typography
          variant="caption"
          noWrap
          sx={{ color: "rgba(255,255,255,0.45)", pl: 1 }}>
          {item.fileName || ""}
        </Typography>

        {/* Counter — centered, prominent, slides on navigation */}
        {items.length > 1 && (
          <Typography
            key={safeIndex}
            variant="body2"
            fontWeight={600}
            sx={{
              color: "white",
              textAlign: "center",
              letterSpacing: "0.05em",
              animation: prefersReducedMotion
                ? "none"
                : `${slideDir === "forward" ? slideInFromRight : slideInFromLeft} 150ms ease-out`
            }}>
            {safeIndex + 1} / {items.length}
          </Typography>
        )}

        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <IconButton
            onClick={onClose}
            aria-label="Close photo viewer"
            size="small"
            sx={{ color: "white", minWidth: 44, minHeight: 44 }}>
            <CloseIcon />
          </IconButton>
        </Box>
      </Box>

      {/* Image area with prev/next buttons */}
      <DialogContent
        sx={{
          p: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          bgcolor: "#111111",
          height: { xs: "58vh", sm: "70vh" },
          minHeight: { xs: 320, sm: 420 },
          overflow: "hidden"
        }}>
        {/* Previous */}
        <IconButton
          onClick={() => navigate(Math.max(0, safeIndex - 1))}
          disabled={isFirst}
          aria-label="Previous photo"
          sx={{
            position: "absolute",
            left: 8,
            color: "white",
            bgcolor: "rgba(255,255,255,0.14)",
            minWidth: 44,
            minHeight: 44,
            zIndex: 1,
            backdropFilter: "blur(14px)",
            "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
            "&.Mui-disabled": { color: "rgba(255,255,255,0.2)" }
          }}>
          <ChevronLeftIcon />
        </IconButton>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%"
          }}>
          <FullResMedia item={item} blob={blobUrls[item.mediaKey]} />
        </Box>

        {/* Next */}
        <IconButton
          onClick={() => navigate(Math.min(items.length - 1, safeIndex + 1))}
          disabled={isLast}
          aria-label="Next photo"
          sx={{
            position: "absolute",
            right: 8,
            color: "white",
            bgcolor: "rgba(255,255,255,0.14)",
            minWidth: 44,
            minHeight: 44,
            zIndex: 1,
            backdropFilter: "blur(14px)",
            "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
            "&.Mui-disabled": { color: "rgba(255,255,255,0.2)" }
          }}>
          <ChevronRightIcon />
        </IconButton>
      </DialogContent>

      {/* Footer bar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 1.5,
          px: 2,
          py: 1.5,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          bgcolor: "rgba(255,255,255,0.06)",
          backdropFilter: "blur(18px)"
        }}>
        {/* Metadata */}
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", flex: 1 }}>
          {item.resWidth && item.resHeight && (
            <Typography
              variant="caption"
              sx={{ color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}>
              {item.resWidth}×{item.resHeight}
            </Typography>
          )}
          {takenDate && (
            <Typography
              variant="caption"
              sx={{ color: "rgba(255,255,255,0.6)" }}>
              <span style={{ opacity: 0.6 }}>Taken </span>
              {takenDate}
            </Typography>
          )}
          {uploadedDate && (
            <Typography
              variant="caption"
              sx={{ color: "rgba(255,255,255,0.6)" }}>
              <span style={{ opacity: 0.6 }}>Uploaded </span>
              {uploadedDate}
            </Typography>
          )}
        </Box>

        {/* Keep/Trash chip */}
        {isKept ? (
          <Chip
            label="Keep"
            size="small"
            color="primary"
            variant="outlined"
            sx={{
              height: 20,
              fontSize: 11,
              borderColor: "rgba(10,132,255,0.85)",
              color: "rgba(100,210,255,1)"
            }}
          />
        ) : isGroupSelected ? (
          <Chip
            label="Trash"
            size="small"
            color="error"
            variant="outlined"
            sx={{
              height: 20,
              fontSize: 11,
              borderColor: "rgba(255,69,58,0.85)",
              color: "rgba(255,105,97,1)"
            }}
          />
        ) : null}

        {/* View in provider link */}
        {item.productUrl && (
          <Link
            href={item.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="caption"
            sx={{
              color: "rgba(255,255,255,0.7)",
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              textDecoration: "none",
              "&:hover": { color: "white" }
            }}>
            {isVideoItem(item) ? "Play in" : "View in"} {providerLabel(item)}
            <OpenInNewIcon sx={{ fontSize: 12 }} />
          </Link>
        )}

        {/* Shortcuts Help Button */}
        <IconButton
          onClick={() => setShortcutsOpen(true)}
          size="small"
          aria-label="Keyboard shortcuts"
          sx={{
            color: "rgba(255,255,255,0.7)",
            "&:hover": { color: "white" }
          }}>
          <HelpOutlineIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>

      {/* Shortcuts Modal */}
      <Dialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        maxWidth="xs"
        fullWidth
        aria-label="Keyboard shortcuts"
        PaperProps={{
          sx: {
            bgcolor: "rgba(28,28,30,0.96)",
            color: "white",
            borderRadius: 3,
            backdropFilter: "saturate(180%) blur(24px)"
          }
        }}>
        <Box
          sx={{
            p: 2,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid rgba(255,255,255,0.1)"
          }}>
          <Typography variant="h6" sx={{ fontSize: "1.1rem" }}>
            Keyboard Shortcuts
          </Typography>
          <IconButton
            onClick={() => setShortcutsOpen(false)}
            size="small"
            sx={{ color: "white" }}>
            <CloseIcon />
          </IconButton>
        </Box>
        <DialogContent sx={{ p: 0 }}>
          <Box
            sx={{ display: "flex", flexDirection: "column", gap: 1.5, p: 2 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
              <Typography
                variant="body2"
                sx={{ color: "rgba(255,255,255,0.7)" }}>
                Previous / Next photo
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                ← / →
              </Typography>
            </Box>
            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
              <Typography
                variant="body2"
                sx={{ color: "rgba(255,255,255,0.7)" }}>
                Keep photo
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                ↑
              </Typography>
            </Box>
            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
              <Typography
                variant="body2"
                sx={{ color: "rgba(255,255,255,0.7)" }}>
                Trash photo
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                ↓
              </Typography>
            </Box>
            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
              <Typography
                variant="body2"
                sx={{ color: "rgba(255,255,255,0.7)" }}>
                Previous / Next group
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                Shift + ← / →
              </Typography>
            </Box>
            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
              <Typography
                variant="body2"
                sx={{ color: "rgba(255,255,255,0.7)" }}>
                Confirm group's choices & Next
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                Shift + ↑
              </Typography>
            </Box>
            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
              <Typography
                variant="body2"
                sx={{ color: "rgba(255,255,255,0.7)" }}>
                Unconfirm group
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                Shift + ↓
              </Typography>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
