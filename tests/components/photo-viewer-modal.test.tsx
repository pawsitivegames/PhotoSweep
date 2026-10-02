/**
 * Component tests for PhotoViewerModal.
 *
 * We mock global fetch so useGroupBlobUrls resolves immediately with a
 * stable blob URL, letting us test navigation and UI state synchronously.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ThemeProvider, createTheme } from "@mui/material/styles"
import { PhotoViewerModal } from "../../components/PhotoViewerModal"
import type { OriginalContentHashResult } from "../../lib/provider-retrieval"
import type { GpdMediaItem } from "../../lib/types"

// ============================================================
// Mocks
// ============================================================

// Stub fetch → immediately resolves with a Blob so useGroupBlobUrls populates fast.
// URL.createObjectURL is not available in happy-dom; stub it too.
const mockObjectUrl = "blob:mock"
vi.stubGlobal("URL", {
  ...URL,
  createObjectURL: () => mockObjectUrl,
  revokeObjectURL: () => {},
})

const fetchMock = vi.fn((_url: string) =>
  Promise.resolve({
    ok: true,
    blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
  } as Response)
)

vi.stubGlobal("fetch", fetchMock)

// ============================================================
// Helpers
// ============================================================

const theme = createTheme()

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

function makeItem(mediaKey: string, overrides: Partial<GpdMediaItem> = {}): GpdMediaItem {
  return {
    mediaKey,
    dedupKey: `dk-${mediaKey}`,
    thumb: `https://example.com/${mediaKey}`,
    productUrl: `https://photos.google.com/photo/${mediaKey}`,
    timestamp: Date.parse("2023-09-24"),
    timestampProvenance: "capture",
    creationTimestamp: Date.parse("2023-09-24"),
    creationTimestampProvenance: "creation",
    resWidth: 3024,
    resHeight: 4032,
    fileName: `${mediaKey}.jpg`,
    isOwned: true,
    ...overrides,
  }
}

const items = [makeItem("img1"), makeItem("img2"), makeItem("img3")]

const defaultProps = {
  open: true,
  items,
  initialIndex: 0,
  keptSet: new Set(["img1"]),
  isGroupSelected: true,
  onClose: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockImplementation((_url: string) =>
    Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    } as Response)
  )
})

// ============================================================
// Rendering
// ============================================================

describe("PhotoViewerModal", () => {
  it("renders the modal when open=true", () => {
    wrap(<PhotoViewerModal {...defaultProps} />)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("does not render when items is empty", () => {
    wrap(<PhotoViewerModal {...defaultProps} items={[]} />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("shows the filename in the header", () => {
    wrap(<PhotoViewerModal {...defaultProps} />)
    expect(screen.getByText(/img1\.jpg/)).toBeInTheDocument()
  })

  it("shows the counter for multi-item groups", () => {
    wrap(<PhotoViewerModal {...defaultProps} />)
    expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument()
  })

  it("shows resolution and taken date in footer", () => {
    wrap(<PhotoViewerModal {...defaultProps} />)
    expect(screen.getByText(/3024×4032/)).toBeInTheDocument()
    expect(screen.getByText(/Taken/)).toBeInTheDocument()
  })
})

// ============================================================
// Video playback
// ============================================================

describe("[VIDEO-PLAYBACK] PhotoViewerModal — video playback", () => {
  it.each(["google", "icloud", "amazon"] as const)(
    "shows an explicit unavailable state for %s videos without attempting playback",
    async (provider) => {
      const onLoadVideo = vi.fn()
      wrap(<PhotoViewerModal {...defaultProps} items={[makeItem("unavailable", {
        provider, mediaKind: "video", videoPlaybackCapability: "unavailable"
      })]} onLoadVideo={onLoadVideo} />)
      expect(await screen.findByText(/full video playback is unavailable for this item/i)).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Load full video" })).not.toBeInTheDocument()
      expect(onLoadVideo).not.toHaveBeenCalled()
    }
  )

  it.each(["photo", "video"] as const)(
    "replaces a failed %s preview fetch with an explicit unavailable state",
    async (mediaKind) => {
      fetchMock.mockRejectedValue(new Error("offline"))
      wrap(<PhotoViewerModal {...defaultProps} items={[makeItem("failed-preview", {
        mediaKind
      })]} />)
      expect(await screen.findByText(/preview unavailable/i)).toBeInTheDocument()
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    }
  )

  it("replaces a non-success preview response with an explicit unavailable state", async () => {
    fetchMock.mockResolvedValue({ ok: false } as Response)
    wrap(<PhotoViewerModal {...defaultProps} items={[makeItem("missing-preview")]} />)
    expect(await screen.findByText(/preview unavailable/i)).toBeInTheDocument()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })

  it("loads a poster without requesting Google's playable video rendition", async () => {
    const video = makeItem("video-with-unknown-duration", {
      mediaKind: "video",
      duration: undefined,
      fileName: "clip.mp4"
    })
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        items={[video]}
        onLoadVideo={vi.fn()}
      />
    )
    expect(screen.getByRole("button", { name: "Load full video" })).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0]?.[0]).toContain("https://example.com/video-with-unknown-duration")
    expect(fetchMock.mock.calls[0]?.[0]).not.toMatch(/=dv$/)
  })

  it.each(["photo", "live-photo"] as const)(
    "does not infer a playable video from duration on an explicit %s",
    async (mediaKind) => {
      const item = makeItem(`explicit-${mediaKind}`, {
        mediaKind,
        duration: 2000,
        fileName: "still-with-video-extension.mp4"
      })
      wrap(
        <PhotoViewerModal
          {...defaultProps}
          items={[item]}
          onLoadVideo={vi.fn()}
        />
      )
      expect(screen.queryByRole("button", { name: "Load full video" })).not.toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalledWith(
        expect.stringMatching(/=dv$/),
        expect.anything()
      )
    }
  )

  it("does not fetch a playable video rendition until the user asks", async () => {
    const video = makeItem("vid1", {
      mediaKind: "video",
      duration: 12_000,
      fileName: "clip.mp4",
    })

    wrap(
      <PhotoViewerModal
        {...defaultProps}
        items={[video]}
        keptSet={new Set(["vid1"])}
        onLoadVideo={vi.fn()}
      />
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0]?.[0]).toContain("https://example.com/vid1")
    expect(fetchMock.mock.calls[0]?.[0]).not.toMatch(/=dv$/)
    expect(screen.getByRole("button", { name: "Load full video" })).toBeInTheDocument()
  })

  it("does not treat a fetched video blob as a poster or start playback automatically", async () => {
    fetchMock.mockImplementation((_url: string) =>
      Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(["video"], { type: "video/mp4" })),
      } as Response)
    )

    const video = makeItem("vid1", {
      mediaKind: "video",
      duration: 12_000,
      fileName: "clip.mp4",
    })

    wrap(
      <PhotoViewerModal
        {...defaultProps}
        items={[video]}
        keptSet={new Set(["vid1"])}
        onLoadVideo={vi.fn()}
      />
    )

    expect(await screen.findByText(/video preview unavailable/i)).toBeInTheDocument()
    expect(screen.queryByLabelText("Play clip.mp4")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Load full video" })).toBeInTheDocument()
    expect(
      screen.getAllByRole("link", { name: /play in google photos/i })[0]
    ).toHaveAttribute("href", "https://photos.google.com/photo/vid1")
  })

  it("loads a scoped provider video only after the user asks and clears it on stop", async () => {
    const video = makeItem("vid1", {
      provider: "amazon",
      mediaKind: "video",
      mimeType: "video/mp4",
      duration: 12_000,
      fileName: "clip.mp4",
      productUrl: "https://www.amazon.ca/photos/all/gallery/vid1?sf=1"
    })
    const onLoadVideo = vi.fn().mockResolvedValue({
      mediaKey: "vid1",
      scopeFingerprint: "scope-a",
      playbackUrl:
        "https://download-photos.amazon.ca/v2/download/signed/vid1?ownerId=owner",
      mimeType: "video/mp4"
    })

    wrap(
      <PhotoViewerModal
        {...defaultProps}
        items={[video]}
        keptSet={new Set(["vid1"])}
        onLoadVideo={onLoadVideo}
      />
    )

    expect(onLoadVideo).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Load full video" }))
    expect(onLoadVideo).toHaveBeenCalledWith(
      video,
      expect.objectContaining({ aborted: false })
    )

    const player = await screen.findByLabelText("Play clip.mp4")
    expect(player).toHaveAttribute(
      "src",
      "https://download-photos.amazon.ca/v2/download/signed/vid1?ownerId=owner"
    )
    fireEvent.click(screen.getByRole("button", { name: "Stop full video playback" }))
    await waitFor(() => expect(screen.queryByLabelText("Play clip.mp4")).not.toBeInTheDocument())
  })

  it("clears a failed video URL and offers retry and provider fallback", async () => {
    const video = makeItem("vid1", {
      provider: "amazon",
      mediaKind: "video",
      mimeType: "video/mp4",
      duration: 12_000,
      fileName: "clip.mp4",
      productUrl: "https://www.amazon.ca/photos/all/gallery/vid1?sf=1"
    })
    const onLoadVideo = vi.fn().mockResolvedValue({
      mediaKey: "vid1",
      scopeFingerprint: "scope-a",
      playbackUrl: "https://download-photos.amazon.ca/v2/download/signed/vid1",
      mimeType: "video/mp4"
    })
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        items={[video]}
        onLoadVideo={onLoadVideo}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Load full video" }))
    const player = await screen.findByLabelText("Play clip.mp4")
    fireEvent.error(player)

    expect(screen.queryByLabelText("Play clip.mp4")).not.toBeInTheDocument()
    expect(screen.getByText(/could not play this video/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Load full video" })).toBeInTheDocument()
    expect(
      screen.getAllByRole("link", { name: /play in amazon photos/i })[0]
    ).toHaveAttribute("href", "https://www.amazon.ca/photos/all/gallery/vid1?sf=1")
  })

  it("aborts an in-flight full-video URL request when the viewer closes", async () => {
    const video = makeItem("vid1", {
      mediaKind: "video",
      duration: 12_000
    })
    let requestSignal: AbortSignal | undefined
    const onLoadVideo = vi.fn(
      (_item: GpdMediaItem, signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          requestSignal = signal
          signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true })
        })
    )
    const onClose = vi.fn()
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        onClose={onClose}
        items={[video]}
        onLoadVideo={onLoadVideo}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Load full video" }))
    fireEvent.click(screen.getByRole("button", { name: "Close photo viewer" }))
    expect(requestSignal?.aborted).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("shows a clear Google Photos play action when only a poster is available", async () => {
    const video = makeItem("vid1", {
      duration: 12_000,
      fileName: "clip.mp4",
    })

    wrap(
      <PhotoViewerModal
        {...defaultProps}
        items={[video]}
        keptSet={new Set(["vid1"])}
      />
    )

    const playLinks = await screen.findAllByRole("link", {
      name: /play in google photos/i,
    })
    expect(playLinks[0]).toHaveAttribute(
      "href",
      "https://photos.google.com/photo/vid1"
    )
  })
})

describe("PhotoViewerModal — original-byte verification", () => {
  const hash = "a".repeat(64)

  it("restores verified SHA evidence from the session-bound review item", () => {
    const item = makeItem("persisted-hash", {
      provider: "amazon",
      contentHash: {
        value: hash,
        algorithm: "sha256",
        provenance: "original-content",
        verificationSource: "local-original-bytes",
        contentRole: "single-file"
      },
      originalByteLength: 1200,
      originalMimeType: "image/jpeg"
    })
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        items={[item]}
        keptSet={new Set([item.mediaKey])}
        onVerifyOriginal={vi.fn()}
      />
    )
    expect(screen.getByRole("button", { name: "Original bytes verified" })).toBeDisabled()
    expect(screen.getByText(new RegExp(`SHA-256 ${hash} · 1,200 bytes`))).toBeInTheDocument()
  })

  it("fetches a single original only after explicit opt-in and shows its verified hash", async () => {
    const item = makeItem("photo-a", { provider: "icloud" })
    const onVerifyOriginal = vi.fn().mockResolvedValue({
      mediaKey: item.mediaKey,
      scopeFingerprint: "scope-a",
      contentHash: {
        value: hash,
        algorithm: "sha256",
        provenance: "original-content",
        verificationSource: "local-original-bytes"
      },
      byteLength: 1200,
      mimeType: "image/jpeg"
    })
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        items={[item]}
        keptSet={new Set([item.mediaKey])}
        onVerifyOriginal={onVerifyOriginal}
      />
    )

    expect(onVerifyOriginal).not.toHaveBeenCalled()
    expect(screen.getByText(/up to 25 MiB per item/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Verify original bytes" }))
    await screen.findByText(new RegExp(`SHA-256 ${hash}`))
    expect(onVerifyOriginal).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Original bytes verified" })).toBeDisabled()
  })

  it("keeps matching Live Photo still hashes separate from unproven motion identity", async () => {
    const first = makeItem("live-a", { provider: "icloud", mediaKind: "live-photo" })
    const second = makeItem("live-b", { provider: "icloud", mediaKind: "live-photo" })
    const onVerifyOriginal = vi.fn(async (item: GpdMediaItem) => ({
      mediaKey: item.mediaKey,
      scopeFingerprint: "scope-a",
      contentHash: {
        value: hash,
        algorithm: "sha256" as const,
        provenance: "original-content" as const,
        verificationSource: "local-original-bytes" as const
      },
      byteLength: 800,
      mimeType: "image/heic"
    }))
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        items={[first, second]}
        keptSet={new Set([first.mediaKey])}
        onVerifyOriginal={onVerifyOriginal}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Verify original bytes" }))
    await screen.findByText(new RegExp(`SHA-256 ${hash}`))
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }))
    fireEvent.click(screen.getByRole("button", { name: "Verify original bytes" }))
    await screen.findByText(/still-image bytes match across 2 candidate items; Live Photo motion pairing remains unknown/i)
  })

  it("aborts original hashing on navigation and does not display a late digest", async () => {
    const first = makeItem("photo-a")
    const second = makeItem("photo-b")
    let requestSignal: AbortSignal | undefined
    const onVerifyOriginal = vi.fn(
      (_item: GpdMediaItem, signal: AbortSignal) =>
        new Promise<OriginalContentHashResult>((_resolve, reject) => {
          requestSignal = signal
          signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true })
        })
    )
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        items={[first, second]}
        onVerifyOriginal={onVerifyOriginal}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Verify original bytes" }))
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }))
    expect(requestSignal?.aborted).toBe(true)
    expect(screen.queryByText(new RegExp(`SHA-256 ${hash}`))).not.toBeInTheDocument()
    expect(screen.getByText(/2 \/ 2/)).toBeInTheDocument()
  })

  it("does not label fallback dates as taken or uploaded", () => {
    const item = makeItem("date-fallback", {
      timestampProvenance: "creation",
      creationTimestampProvenance: "capture"
    })
    wrap(<PhotoViewerModal {...defaultProps} items={[item]} />)
    expect(screen.queryByText(/Taken/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Uploaded/)).not.toBeInTheDocument()
  })
})

// ============================================================
// Keep / Trash chip
// ============================================================

describe("PhotoViewerModal — chip display", () => {
  it("shows Keep chip for a kept item", () => {
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        keptSet={new Set(["img1"])}
        isGroupSelected={true}
      />
    )
    expect(screen.getByText("Keep")).toBeInTheDocument()
    expect(screen.queryByText("Trash")).not.toBeInTheDocument()
  })

  it("shows Trash chip for a non-kept item in a selected group", () => {
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        initialIndex={1}
        keptSet={new Set(["img1"])} // img2 is not kept
        isGroupSelected={true}
      />
    )
    expect(screen.getByText("Trash")).toBeInTheDocument()
    expect(screen.queryByText("Keep")).not.toBeInTheDocument()
  })

  it("shows no chip for non-kept item in a deselected group", () => {
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        initialIndex={1}
        keptSet={new Set(["img1"])}
        isGroupSelected={false}
      />
    )
    expect(screen.queryByText("Trash")).not.toBeInTheDocument()
    expect(screen.queryByText("Keep")).not.toBeInTheDocument()
  })
})

// ============================================================
// Navigation
// ============================================================

describe("PhotoViewerModal — navigation", () => {
  it("disables the Previous button on the first item", () => {
    wrap(<PhotoViewerModal {...defaultProps} initialIndex={0} />)
    const prevBtn = screen.getByRole("button", { name: /previous photo/i })
    expect(prevBtn).toBeDisabled()
  })

  it("disables the Next button on the last item", () => {
    wrap(<PhotoViewerModal {...defaultProps} initialIndex={2} />)
    const nextBtn = screen.getByRole("button", { name: /next photo/i })
    expect(nextBtn).toBeDisabled()
  })

  it("advances to the next item on Next click", () => {
    wrap(<PhotoViewerModal {...defaultProps} initialIndex={0} />)
    expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /next photo/i }))
    expect(screen.getByText(/2 \/ 3/)).toBeInTheDocument()
    expect(screen.getByText(/img2\.jpg/)).toBeInTheDocument()
  })

  it("goes back to the previous item on Previous click", () => {
    wrap(<PhotoViewerModal {...defaultProps} initialIndex={2} />)
    expect(screen.getByText(/3 \/ 3/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /previous photo/i }))
    expect(screen.getByText(/2 \/ 3/)).toBeInTheDocument()
  })

  it("navigates forward with ArrowRight key", () => {
    wrap(<PhotoViewerModal {...defaultProps} initialIndex={0} />)
    fireEvent.keyDown(window, { key: "ArrowRight" })
    expect(screen.getByText(/2 \/ 3/)).toBeInTheDocument()
  })

  it("navigates backward with ArrowLeft key", () => {
    wrap(<PhotoViewerModal {...defaultProps} initialIndex={1} />)
    fireEvent.keyDown(window, { key: "ArrowLeft" })
    expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument()
  })

  it("does not go below index 0 with ArrowLeft at first item", () => {
    wrap(<PhotoViewerModal {...defaultProps} initialIndex={0} />)
    fireEvent.keyDown(window, { key: "ArrowLeft" })
    expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument()
  })

  it("does not go above last index with ArrowRight at last item", () => {
    wrap(<PhotoViewerModal {...defaultProps} initialIndex={2} />)
    fireEvent.keyDown(window, { key: "ArrowRight" })
    expect(screen.getByText(/3 \/ 3/)).toBeInTheDocument()
  })

  it("resets index to initialIndex when items change", () => {
    const { rerender } = wrap(<PhotoViewerModal {...defaultProps} initialIndex={0} />)
    
    // Navigate to next photo (index 1)
    fireEvent.click(screen.getByRole("button", { name: /next photo/i }))
    expect(screen.getByText(/2 \/ 3/)).toBeInTheDocument()
    
    // Now rerender with a new set of items
    const newItems = [makeItem("new1"), makeItem("new2")]
    rerender(
      <ThemeProvider theme={theme}>
        <PhotoViewerModal
          {...defaultProps}
          items={newItems}
          initialIndex={0}
        />
      </ThemeProvider>
    )
    
    // Verify it reset to photo 1 of the new items
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument()
  })
})

// ============================================================
// Google Photos link
// ============================================================

describe("PhotoViewerModal — Google Photos link", () => {
  it("shows the View in Google Photos link when productUrl is present", () => {
    wrap(<PhotoViewerModal {...defaultProps} />)
    const link = screen.getByRole("link", { name: /view in google photos/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute("href", "https://photos.google.com/photo/img1")
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("does not show the link when productUrl is absent", () => {
    const itemsNoUrl = items.map((item) => ({ ...item, productUrl: undefined }))
    wrap(<PhotoViewerModal {...defaultProps} items={itemsNoUrl} />)
    expect(screen.queryByRole("link", { name: /view in google photos/i })).not.toBeInTheDocument()
  })
})

// ============================================================
// Close button
// ============================================================

describe("PhotoViewerModal — close", () => {
  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn()
    wrap(<PhotoViewerModal {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByRole("button", { name: /close photo viewer/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

// ============================================================
// Keyboard Keep Toggling (ArrowUp / ArrowDown)
// ============================================================

describe("PhotoViewerModal — keyboard keep toggling", () => {
  it("calls onToggleKept when pressing ArrowUp on a non-kept image", () => {
    const onToggleKept = vi.fn()
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        initialIndex={1}
        onToggleKept={onToggleKept}
      />
    )
    fireEvent.keyDown(window, { key: "ArrowUp" })
    expect(onToggleKept).toHaveBeenCalledWith("img2")
  })

  it("does NOT call onToggleKept when pressing ArrowUp on an already kept image", () => {
    const onToggleKept = vi.fn()
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        initialIndex={0}
        onToggleKept={onToggleKept}
      />
    )
    fireEvent.keyDown(window, { key: "ArrowUp" })
    expect(onToggleKept).not.toHaveBeenCalled()
  })

  it("calls onToggleKept when pressing ArrowDown on a kept image", () => {
    const onToggleKept = vi.fn()
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        initialIndex={0}
        onToggleKept={onToggleKept}
      />
    )
    fireEvent.keyDown(window, { key: "ArrowDown" })
    expect(onToggleKept).toHaveBeenCalledWith("img1")
  })

  it("does NOT call onToggleKept when pressing ArrowDown on a non-kept image", () => {
    const onToggleKept = vi.fn()
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        initialIndex={1}
        onToggleKept={onToggleKept}
      />
    )
    fireEvent.keyDown(window, { key: "ArrowDown" })
    expect(onToggleKept).not.toHaveBeenCalled()
  })
})

// ============================================================
// Shift Keyboard Group Shortcuts
// ============================================================

describe("PhotoViewerModal — Shift keyboard group shortcuts", () => {
  it("calls onToggleGroup (if not selected) and onNextGroup on Shift + ArrowUp", () => {
    const onToggleGroup = vi.fn()
    const onNextGroup = vi.fn()
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        isGroupSelected={false}
        onToggleGroup={onToggleGroup}
        onNextGroup={onNextGroup}
      />
    )
    fireEvent.keyDown(window, { key: "ArrowUp", shiftKey: true })
    expect(onToggleGroup).toHaveBeenCalledOnce()
    expect(onNextGroup).toHaveBeenCalledOnce()
  })

  it("does NOT call onToggleGroup (if already selected) but still calls onNextGroup on Shift + ArrowUp", () => {
    const onToggleGroup = vi.fn()
    const onNextGroup = vi.fn()
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        isGroupSelected={true}
        onToggleGroup={onToggleGroup}
        onNextGroup={onNextGroup}
      />
    )
    fireEvent.keyDown(window, { key: "ArrowUp", shiftKey: true })
    expect(onToggleGroup).not.toHaveBeenCalled()
    expect(onNextGroup).toHaveBeenCalledOnce()
  })

  it("calls onToggleGroup on Shift + ArrowDown if group is selected", () => {
    const onToggleGroup = vi.fn()
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        isGroupSelected={true}
        onToggleGroup={onToggleGroup}
      />
    )
    fireEvent.keyDown(window, { key: "ArrowDown", shiftKey: true })
    expect(onToggleGroup).toHaveBeenCalledOnce()
  })

  it("does NOT call onToggleGroup on Shift + ArrowDown if group is not selected", () => {
    const onToggleGroup = vi.fn()
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        isGroupSelected={false}
        onToggleGroup={onToggleGroup}
      />
    )
    fireEvent.keyDown(window, { key: "ArrowDown", shiftKey: true })
    expect(onToggleGroup).not.toHaveBeenCalled()
  })

  it("calls onPrevGroup on Shift + ArrowLeft", () => {
    const onPrevGroup = vi.fn()
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        onPrevGroup={onPrevGroup}
      />
    )
    fireEvent.keyDown(window, { key: "ArrowLeft", shiftKey: true })
    expect(onPrevGroup).toHaveBeenCalledOnce()
  })

  it("calls onNextGroup on Shift + ArrowRight", () => {
    const onNextGroup = vi.fn()
    wrap(
      <PhotoViewerModal
        {...defaultProps}
        onNextGroup={onNextGroup}
      />
    )
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true })
    expect(onNextGroup).toHaveBeenCalledOnce()
  })
})

// ============================================================
// Viewport-sized fetching and next-group prefetching
// ============================================================

describe("PhotoViewerModal — viewport fetching", () => {
  it("requests Google thumbnails sized for the current viewport", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1000
    })
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800
    })
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 2
    })

    wrap(<PhotoViewerModal {...defaultProps} />)

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/img1=w2000-h1600",
      expect.objectContaining({ credentials: "include" })
    )
  })

  it("prefetches the next group without changing provider behavior", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1000
    })
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800
    })
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 2
    })

    wrap(
      <PhotoViewerModal {...defaultProps} nextGroupItems={[makeItem("img4")]} />
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/img4=w2000-h1600",
      expect.objectContaining({ credentials: "include" })
    )
  })
})
