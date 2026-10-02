/**
 * Component tests for ScanConfig — smart-mode time window (PR #121).
 *
 * Covers the `formatWindow` label formatter (s / m / h / d / w boundaries) and
 * the time-window ToggleButtonGroup, which is only shown in smart mode and
 * drives `onSettingsChange({ smartWindowSec })`.
 */
import { ThemeProvider } from "@mui/material/styles"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  recommendedFirstScanDateRange,
  ScanConfig
} from "../../components/ScanConfig"
import type { Entitlement } from "../../lib/entitlement"
import { providerLivePhotoPairNotice } from "../../lib/provider-operations"
import { createScanCheckpoint } from "../../lib/scan-checkpoint"
import theme from "../../lib/theme"
import type { ScanSettings } from "../../lib/types"

// ============================================================
// Helpers
// ============================================================

function renderConfig(
  settings: Partial<ScanSettings> = {},
  options: {
    amazonProfileName?: string
    compact?: boolean
    hasGptk?: boolean
    entitlement?: Entitlement | null
  } = {}
) {
  const onSettingsChange = vi.fn()
  const onStartScan = vi.fn()
  const onUpgrade = vi.fn()
  const full: ScanSettings = {
    similarityThreshold: 0.99,
    scanMode: "smart",
    smartWindowSec: 1,
    ...settings
  }
  render(
    <ThemeProvider theme={theme}>
      <ScanConfig
        settings={full}
        onSettingsChange={onSettingsChange}
        onStartScan={onStartScan}
        onUpgrade={onUpgrade}
        onClearCache={vi.fn()}
        onRebuildCache={vi.fn()}
        onExportCacheDiagnostics={vi.fn()}
        hasGptk={options.hasGptk ?? true}
        cacheEntryCount={12}
        albums={[
          {
            mediaKey: "album-1",
            title: "Tiny test album",
            itemCount: 3,
            isShared: false
          },
          {
            mediaKey: "album-2",
            title: "Shared album",
            itemCount: 12,
            isShared: true
          }
        ]}
        entitlement={options.entitlement}
        amazonProfileName={options.amazonProfileName}
        compact={options.compact}
      />
    </ThemeProvider>
  )
  return { onSettingsChange, onStartScan, onUpgrade }
}

describe("ScanConfig — Amazon session label", () => {
  it("shows the Photos profile label as session-only in compact scan setup", () => {
    renderConfig(
      { sourceProvider: "amazon" },
      { compact: true, amazonProfileName: "Pawsitive Games" }
    )

    expect(
      screen.getByText("Amazon Photos profile: Pawsitive Games")
    ).toBeVisible()
    expect(
      screen.getByText(
        /Display label only\. This scan is bound to the open Amazon Photos session\./
      )
    ).toBeVisible()
  })

  it("does not show an Amazon label for a different provider", () => {
    renderConfig(
      { sourceProvider: "icloud" },
      { compact: true, amazonProfileName: "Pawsitive Games" }
    )

    expect(screen.queryByText(/Amazon Photos profile:/)).not.toBeInTheDocument()
  })
})

// ============================================================
// formatWindow — label formatting via the rendered "Time window:" line
// ============================================================

describe("ScanConfig — time window label (formatWindow)", () => {
  // [smartWindowSec, expected label suffix]
  const cases: [number, string][] = [
    [1, "1s"],
    [59, "59s"],
    [60, "1m"],
    [120, "2m"],
    [3600, "1h"],
    [7200, "2h"],
    [86400, "1d"],
    [172800, "2d"],
    [604800, "1w"],
    [1209600, "2w"]
  ]

  for (const [sec, label] of cases) {
    it(`formats ${sec}s as "${label}"`, () => {
      renderConfig({ smartWindowSec: sec })
      expect(screen.getByText(/Time window:/)).toHaveTextContent(
        `Time window: ${label}`
      )
    })
  }

  it("falls back to 1s when smartWindowSec is undefined", () => {
    renderConfig({ smartWindowSec: undefined })
    expect(screen.getByText(/Time window:/)).toHaveTextContent(
      "Time window: 1s"
    )
  })
})

// ============================================================
// Time window toggle — only shown in smart mode, fires onSettingsChange
// ============================================================

describe("ScanConfig — time window toggle", () => {
  it("emits the selected window in seconds when a button is clicked", () => {
    // smartWindowSec=1 → the "Time window:" label reads "1s", so the "1m"
    // text uniquely identifies the toggle button (not the label).
    const { onSettingsChange } = renderConfig({ smartWindowSec: 1 })
    fireEvent.click(screen.getByText("1m"))
    expect(onSettingsChange).toHaveBeenCalledWith({ smartWindowSec: 60 })
  })

  it("maps the 1w button to 604800 seconds", () => {
    const { onSettingsChange } = renderConfig({ smartWindowSec: 1 })
    fireEvent.click(screen.getByText("1w"))
    expect(onSettingsChange).toHaveBeenCalledWith({ smartWindowSec: 604800 })
  })

  it("does not render the time window control in full-scan mode", () => {
    renderConfig({ scanMode: "full" })
    expect(screen.queryByText(/Time window:/)).not.toBeInTheDocument()
  })
})

describe("ScanConfig — taken date range", () => {
  it("keeps date scope in the primary path and summarizes the recommended scan", () => {
    renderConfig()

    expect(screen.getByLabelText("From")).toBeVisible()
    expect(screen.getByLabelText("To")).toBeVisible()
    expect(screen.getByText("Recent 30 days · Recommended")).toBeVisible()
    expect(
      screen.getByRole("button", { name: /Scan recent 30 days/i })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: /Check entire library instead/i })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: /Advanced matching/i })
    ).toHaveAttribute("aria-expanded", "false")
  })

  it("launches a bounded recommended scan without manual date entry", () => {
    const { onSettingsChange, onStartScan } = renderConfig()
    fireEvent.click(
      screen.getByRole("button", { name: /Scan recent 30 days/i })
    )

    const dateRange = recommendedFirstScanDateRange()
    expect(onSettingsChange).toHaveBeenCalledWith({ dateRange })
    expect(onStartScan).toHaveBeenCalledWith(
      expect.objectContaining({ dateRange })
    )
  })

  it("emits date range updates from the date inputs", () => {
    const { onSettingsChange } = renderConfig()

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2024-01-01" }
    })
    expect(onSettingsChange).toHaveBeenCalledWith({
      dateRange: { from: "2024-01-01" }
    })

    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2024-12-31" }
    })
    expect(onSettingsChange).toHaveBeenCalledWith({
      dateRange: { to: "2024-12-31" }
    })
  })

  it("does not describe ambiguous iCloud asset dates as capture dates", () => {
    renderConfig({ sourceProvider: "icloud" })

    expect(
      screen.getByText(
        "iCloud date filters use provider asset dates. Capture provenance can be unknown, and dates may fall back to upload time."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/check every taken date/i)).not.toBeInTheDocument()
  })

  it("labels the primary button as a date range scan when scoped", () => {
    renderConfig({ dateRange: { from: "2024-01-01", to: "2024-12-31" } })
    expect(
      screen.getByRole("button", { name: /Check this date range/i })
    ).toBeInTheDocument()
  })

  it("blocks scanning when the date range is inverted", () => {
    const { onStartScan } = renderConfig({
      dateRange: { from: "2025-01-01", to: "2024-01-01" }
    })

    const button = screen.getByRole("button", {
      name: /Check this date range/i
    })
    expect(button).toBeDisabled()
    expect(screen.getByText(/start date must be before/i)).toBeInTheDocument()

    fireEvent.click(button)
    expect(onStartScan).not.toHaveBeenCalled()
  })
})

describe("ScanConfig — large-library scan warning", () => {
  it("warns before an unscoped full-library comparison", () => {
    renderConfig({ scanMode: "full" })

    expect(
      screen.getByText(/Full-library comparison can be slow and memory-heavy/i)
    ).toBeInTheDocument()
  })

  it("does not warn when full scan is scoped to a date range", () => {
    renderConfig({
      scanMode: "full",
      dateRange: { from: "2024-01-01", to: "2024-12-31" }
    })

    expect(
      screen.queryByText(
        /Full-library comparison can be slow and memory-heavy/i
      )
    ).not.toBeInTheDocument()
  })

  it("does not warn when full scan is scoped to an album", () => {
    renderConfig({
      scanMode: "full",
      albumScope: {
        mediaKey: "album-1",
        title: "Tiny test album",
        itemCount: 3
      }
    })

    expect(
      screen.queryByText(
        /Full-library comparison can be slow and memory-heavy/i
      )
    ).not.toBeInTheDocument()
  })
})

describe("ScanConfig — similarity threshold guidance", () => {
  it("explains that lower thresholds catch more reuploads", () => {
    renderConfig({ scanMode: "full", similarityThreshold: 0.95 })
    fireEvent.click(screen.getByRole("button", { name: /Advanced matching/i }))

    expect(
      screen.getByText(
        /Lower values catch more reuploads, screenshots, and edited copies/i
      )
    ).toBeInTheDocument()
    expect(screen.getByText(/Loose/i)).toBeInTheDocument()
    expect(screen.getByText(/Balanced/i)).toBeInTheDocument()
    expect(screen.getByText(/Near exact/i)).toBeInTheDocument()
    expect(screen.getByText("Verified identity")).toBeInTheDocument()
  })
})

describe("ScanConfig — album scope", () => {
  it("[PARITY-03] shows Google album count and emits the selected album scope", () => {
    const { onSettingsChange } = renderConfig()

    fireEvent.click(screen.getByRole("button", { name: /Advanced matching/i }))
    expect(screen.getByText(/1 album available/i)).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /Library area/i }))
    fireEvent.click(screen.getByRole("option", { name: /Tiny test album/i }))
    expect(
      screen.queryByRole("option", { name: /Shared album/i })
    ).not.toBeInTheDocument()

    expect(onSettingsChange).toHaveBeenCalledWith({
      albumScope: {
        mediaKey: "album-1",
        title: "Tiny test album",
        itemCount: 3,
        isShared: false
      }
    })
  })

  it("labels the primary button as an album scan when album-scoped", () => {
    renderConfig({
      albumScope: {
        mediaKey: "album-1",
        title: "Tiny test album",
        itemCount: 3
      }
    })

    expect(
      screen.getByRole("button", { name: /Check this album/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Only checking Tiny test album/i)
    ).toBeInTheDocument()
  })
})

describe("ScanConfig — photo source", () => {
  it("[PARITY-06] states that Live Photo pairs are not grouped in both layouts", () => {
    for (const provider of ["google", "icloud", "amazon"] as const) {
      for (const compact of [false, true]) {
        renderConfig({ sourceProvider: provider }, { compact })
        expect(
          screen.getByText(providerLivePhotoPairNotice())
        ).toBeInTheDocument()
        cleanup()
      }
    }
  })

  it("[PARITY-05] explains each provider's scope and mutation differences in both layouts", () => {
    const statusByProvider = {
      google:
        "Scan the Google Photos library, an album, or a date range. Photos and videos are included, and results report examined and skipped records. Trash moves selected library items to Google Photos Trash.",
      icloud:
        "Scan the iCloud Photos library, a personal album, or a date range. Album scans use the personal PrimarySync library; shared libraries are not queried. CloudKit scans cover photos and videos and fail closed when a complete provider session is unavailable. Trash moves selected library items to Recently Deleted.",
      amazon:
        "Scan the Amazon Photos library, a personal album, or a date range. Shared albums and items owned by another account are excluded. Photos and videos are included, and results report examined and skipped records. Trash moves selected library items to Amazon Photos Trash."
    } as const

    for (const provider of ["google", "icloud", "amazon"] as const) {
      for (const compact of [false, true]) {
        renderConfig({ sourceProvider: provider }, { compact })
        expect(screen.getByText(statusByProvider[provider])).toBeInTheDocument()
        cleanup()
      }
    }
  })

  it("[PARITY-05] gives iCloud and Amazon test batches the same visited-record meaning", () => {
    const paidEntitlement = {
      planId: "cleanup_pass",
      active: true,
      source: "signed_token"
    } as const

    for (const provider of ["icloud", "amazon"] as const) {
      renderConfig(
        {
          sourceProvider: provider,
          ...(provider === "icloud"
            ? { icloudBatchLimit: 50 }
            : { amazonBatchLimit: 50 })
        },
        { entitlement: paidEntitlement }
      )

      expect(
        screen.getByRole("button", { name: /Check up to 50 records/i })
      ).toBeInTheDocument()
      expect(
        screen.getByText(/Test batch is on/).closest('[role="alert"]')
      ).toHaveTextContent(
        "visit up to 50 provider records. Records outside the selected date range also count toward this limit."
      )
      cleanup()
    }
  })

  it("[PARITY-03] exposes iCloud personal albums in both scan layouts", () => {
    for (const compact of [false, true]) {
      renderConfig({ sourceProvider: "icloud" }, { compact })
      if (!compact) {
        fireEvent.click(
          screen.getByRole("button", { name: /Advanced matching/i })
        )
      }
      expect(
        screen.getByRole("combobox", { name: /Library area/i })
      ).toBeInTheDocument()
      expect(
        screen.queryByText(/Album scans are not available/i)
      ).not.toBeInTheDocument()
      if (compact) {
        expect(
          screen.getByText(/Choose a personal album or scan the full library/i)
        ).toBeInTheDocument()
      } else {
        expect(screen.getByText(/1 album available/i)).toBeInTheDocument()
      }
      cleanup()
    }
  })

  it("[PARITY-03] exposes Amazon personal albums in both scan layouts", () => {
    for (const compact of [false, true]) {
      renderConfig({ sourceProvider: "amazon" }, { compact })
      if (!compact) {
        fireEvent.click(
          screen.getByRole("button", { name: /Advanced matching/i })
        )
      }
      expect(
        screen.getByRole("combobox", { name: /Library area/i })
      ).toBeInTheDocument()
      expect(
        screen.queryByText(/Album scans are not available/i)
      ).not.toBeInTheDocument()
      if (compact) {
        expect(
          screen.getByText(/Choose a personal album or scan the full library/i)
        ).toBeInTheDocument()
      } else {
        expect(
          screen.getByText(/narrow this to one personal album/i)
        ).toBeInTheDocument()
      }
      cleanup()
    }
  })

  it("switches to iCloud and explains scan-only support", () => {
    const { onSettingsChange } = renderConfig()

    fireEvent.click(screen.getByRole("button", { name: /Advanced matching/i }))
    fireEvent.click(screen.getByRole("button", { name: /iCloud Photos/i }))

    expect(onSettingsChange).toHaveBeenCalledWith({
      sourceProvider: "icloud",
      albumScope: undefined
    })
  })

  it("describes iCloud provider fetch behavior and exposes album controls", () => {
    renderConfig({ sourceProvider: "icloud" })

    expect(
      screen.getByRole("button", { name: /Check entire library/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/Recently Deleted/i)).toBeInTheDocument()
    expect(
      screen.getByText(/CloudKit scans cover photos and videos/i)
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Full-library checks can use saved iCloud change data; date-range and album scans read their full scope\./i
      )
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Advanced matching/i }))
    expect(
      screen.getByRole("combobox", { name: /Library area/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/iCloud test batch size/i)).toBeInTheDocument()
  })

  it("uses the same compact scope visual pattern for non-Google providers", () => {
    renderConfig(
      { sourceProvider: "icloud" },
      { compact: true, hasGptk: false }
    )

    expect(
      screen.getByRole("combobox", { name: /Library area/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Check entire library/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Choose a personal album or scan the full library/i)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Choose photo source/i)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Leave iCloud Photos open/i)
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Retry connection/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/iCloud Photos is not connected/i)
    ).not.toBeInTheDocument()

    cleanup()
    renderConfig(
      { sourceProvider: "amazon" },
      { compact: true, hasGptk: false }
    )

    expect(
      screen.getByRole("combobox", { name: /Library area/i })
    ).toHaveTextContent("Amazon Photos library")
    expect(
      screen.getByText(/Choose a personal album or scan the full library/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Check entire library/i })
    ).toBeInTheDocument()
  })

  it("exposes a free iCloud test batch while keeping the common plan gates", () => {
    const { onStartScan, onUpgrade } = renderConfig({
      sourceProvider: "icloud",
      icloudBatchLimit: 50
    })

    const startButton = screen.getByRole("button", {
      name: /Check up to 50 records/i
    })
    expect(startButton).toBeInTheDocument()
    expect(screen.getByText(/Test batch is on/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Advanced matching/i }))
    expect(screen.getByText(/iCloud test batch size/i)).toBeInTheDocument()

    fireEvent.click(startButton)
    expect(onStartScan).toHaveBeenCalledWith()
    expect(onUpgrade).not.toHaveBeenCalled()
  })

  it("blocks a free iCloud batch above the common 1000-item cap", () => {
    const { onStartScan, onUpgrade } = renderConfig({
      sourceProvider: "icloud",
      icloudBatchLimit: 1001
    })

    expect(
      screen.getByText(/above the 1,000 photo scan limit for Free/i)
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: /Check up to 1,001 records/i })
    )
    expect(onStartScan).not.toHaveBeenCalled()
    expect(onUpgrade).toHaveBeenCalled()
  })

  it("[PARITY-05] labels iCloud capped scans as visited-record test batches", () => {
    renderConfig(
      { sourceProvider: "icloud", icloudBatchLimit: 50 },
      {
        entitlement: {
          planId: "cleanup_pass",
          active: true,
          source: "signed_token"
        }
      }
    )

    expect(
      screen.getByRole("button", { name: /Check up to 50 records/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Test batch is on/).closest('[role="alert"]')
    ).toHaveTextContent(/outside the selected date range also count/i)
  })

  it("switches to Amazon Photos and uses shared scan controls", () => {
    const { onSettingsChange } = renderConfig()

    fireEvent.click(screen.getByRole("button", { name: /Amazon Photos/i }))

    expect(onSettingsChange).toHaveBeenCalledWith({
      sourceProvider: "amazon",
      albumScope: undefined
    })

    cleanup()
    renderConfig({ sourceProvider: "amazon" })
    expect(
      screen.getByRole("link", { name: /Open Amazon Photos/i })
    ).toHaveAttribute("href", "https://www.amazon.com/photos?sf=1")
    expect(
      screen.getByRole("button", { name: /Check entire library/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Photos and videos are included, and results report examined and skipped records/i
      )
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Advanced matching/i }))
    expect(
      screen.getByRole("combobox", { name: /Library area/i })
    ).toBeInTheDocument()
  })
})

describe("ScanConfig — embedding cache controls", () => {
  it("shows cache size and emits cache actions", () => {
    const onClearCache = vi.fn()
    const onRebuildCache = vi.fn()
    const onExportCacheDiagnostics = vi.fn()
    const full: ScanSettings = {
      similarityThreshold: 0.99,
      scanMode: "smart",
      smartWindowSec: 1
    }

    render(
      <ThemeProvider theme={theme}>
        <ScanConfig
          settings={full}
          onSettingsChange={vi.fn()}
          onStartScan={vi.fn()}
          onClearCache={onClearCache}
          onRebuildCache={onRebuildCache}
          onExportCacheDiagnostics={onExportCacheDiagnostics}
          hasGptk={true}
          cacheEntryCount={1234}
        />
      </ThemeProvider>
    )

    expect(screen.getByText(/1,234 cached embeddings/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Advanced matching/i }))
    fireEvent.click(screen.getByRole("button", { name: /Clear Cache/i }))
    fireEvent.click(screen.getByRole("button", { name: /Rebuild Cache/i }))
    fireEvent.click(screen.getByRole("button", { name: /Export Diagnostics/i }))
    expect(onClearCache).toHaveBeenCalledOnce()
    expect(onRebuildCache).toHaveBeenCalledOnce()
    expect(onExportCacheDiagnostics).toHaveBeenCalledOnce()
  })
})

describe("ScanConfig — feedback settings", () => {
  for (const compact of [false, true]) {
    it(`exposes a feedback entry with the support inbox (${compact ? "compact" : "full"} layout)`, () => {
      renderConfig({}, { compact })

      fireEvent.click(screen.getByRole("button", { name: /Help & feedback/i }))

      expect(
        screen.getByText(
          /Opens a new email addressed to pawsitivegames@gmail.com/i
        )
      ).toBeInTheDocument()
      expect(
        screen.getByRole("link", { name: /Send feedback/i })
      ).toHaveAttribute(
        "href",
        "mailto:pawsitivegames@gmail.com?subject=PhotoSweep%20feedback"
      )
      cleanup()
    })
  }
})

describe("ScanConfig — interrupted scan resume", () => {
  it("shows the resumable checkpoint and emits resume/dismiss actions", () => {
    const onResumeScan = vi.fn()
    const onDismissResume = vi.fn()
    const full: ScanSettings = {
      similarityThreshold: 0.99,
      scanMode: "smart",
      smartWindowSec: 1
    }
    const checkpoint = createScanCheckpoint({
      id: "req-1",
      settings: {
        ...full,
        dateRange: { from: "2024-01-01", to: "2024-12-31" }
      }
    })

    render(
      <ThemeProvider theme={theme}>
        <ScanConfig
          settings={full}
          onSettingsChange={vi.fn()}
          onStartScan={vi.fn()}
          onResumeScan={onResumeScan}
          onDismissResume={onDismissResume}
          onClearCache={vi.fn()}
          onRebuildCache={vi.fn()}
          onExportCacheDiagnostics={vi.fn()}
          hasGptk={true}
          cacheEntryCount={12}
          resumeCheckpoint={{
            ...checkpoint,
            status: "interrupted",
            phase: "computing_embeddings"
          }}
        />
      </ThemeProvider>
    )

    expect(screen.getByText(/Previous smart scan/i)).toHaveTextContent(
      "2024-01-01 to 2024-12-31"
    )
    expect(
      screen.getByText(/completed work will be reused/i)
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole("button", { name: /Continue previous scan/i })
    )
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }))
    expect(onResumeScan).toHaveBeenCalledOnce()
    expect(onDismissResume).toHaveBeenCalledOnce()
  })
})
