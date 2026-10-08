/**
 * Component tests for ActionBar.
 *
 * Covers:
 * - Stats display (items scanned, group count)
 * - Button visibility based on groupCount
 * - cleanup action disabled when duplicateCount === 0
 * - All callback props fire on the correct user action
 */
import { ThemeProvider } from "@mui/material/styles"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ActionBar, CleanupBar } from "../../components/ActionBar"
import { KEEP_STRATEGY_LABELS } from "../../lib/keep-strategy"
import theme from "../../lib/theme"

interface Props {
  totalItems?: number
  groupCount?: number
  totalGroupCount?: number
  availableGroupCount?: number
  reviewedGroupCount?: number
  selectedShownGroupCount?: number
  includedGroupCount?: number
  exactGroupCount?: number
  similarGroupCount?: number
  duplicateCount?: number
  reviewFilter?: "all" | "exact" | "similar"
  onReviewFilterChange?: (filter: "all" | "exact" | "similar") => void
  onIncludeAllEligible?: () => void
  onSelectAll?: () => void
  onDeselectAll?: () => void
  onTrash?: () => void
  onRescan?: () => void
  onExportJson?: () => void
  onExportCsv?: () => void
  onApplyKeepStrategy?: (strategy: string) => void
  compact?: boolean
}

function renderActionBar(props: Props = {}) {
  const defaults = {
    totalItems: 500,
    groupCount: 3,
    totalGroupCount: 3,
    reviewedGroupCount: 3,
    exactGroupCount: 2,
    similarGroupCount: 1,
    duplicateCount: 6,
    reviewFilter: "all" as const,
    onReviewFilterChange: vi.fn(),
    onSelectAll: vi.fn(),
    onDeselectAll: vi.fn(),
    onTrash: vi.fn(),
    onRescan: vi.fn(),
    onExportJson: vi.fn(),
    onExportCsv: vi.fn(),
    onApplyKeepStrategy: vi.fn()
  }
  const merged = { ...defaults, ...props }
  const selectedShownGroupCount =
    props.selectedShownGroupCount ?? Math.min(1, merged.groupCount)
  return {
    ...render(
      <ThemeProvider theme={theme}>
        <ActionBar
          totalItems={merged.totalItems}
          groupCount={merged.groupCount}
          totalGroupCount={merged.totalGroupCount}
          availableGroupCount={merged.availableGroupCount}
          reviewedGroupCount={merged.reviewedGroupCount}
          selectedShownGroupCount={selectedShownGroupCount}
          includedGroupCount={merged.includedGroupCount}
          exactGroupCount={merged.exactGroupCount}
          similarGroupCount={merged.similarGroupCount}
          reviewFilter={merged.reviewFilter}
          onReviewFilterChange={merged.onReviewFilterChange}
          onIncludeAllEligible={merged.onIncludeAllEligible}
          onSelectAll={merged.onSelectAll}
          onDeselectAll={merged.onDeselectAll}
          onRescan={merged.onRescan}
          onExportJson={merged.onExportJson}
          onExportCsv={merged.onExportCsv}
          onApplyKeepStrategy={merged.onApplyKeepStrategy}
          compact={merged.compact}
        />
      </ThemeProvider>
    ),
    callbacks: merged
  }
}

// ============================================================
// Tests
// ============================================================

describe("ActionBar", () => {
  it("makes keeper choice and cleanup selection separate ordered steps", () => {
    renderActionBar({ compact: true })

    expect(screen.getByText("1. Choose keeper photos")).toBeInTheDocument()
    expect(screen.getByText("2. Include sets in cleanup")).toBeInTheDocument()
    expect(
      screen.getByText(/This does not include sets in cleanup\./)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: "Include all 3 shown sets in cleanup"
      })
    ).toHaveAttribute(
      "title",
      "Includes only sets shown by the current filter and marks them reviewed."
    )
  })

  describe("stats display", () => {
    it("shows the total items scanned count", () => {
      renderActionBar({ totalItems: 12345 })
      expect(
        screen.getByText("12,345 photos and videos checked")
      ).toBeInTheDocument()
    })

    it("shows the duplicate group count (plural)", () => {
      renderActionBar({ groupCount: 5 })
      expect(screen.getByText("5 duplicate sets to review")).toBeInTheDocument()
    })

    it("shows singular 'duplicate group' when groupCount is 1", () => {
      renderActionBar({ groupCount: 1 })
      expect(screen.getByText("1 duplicate set to review")).toBeInTheDocument()
    })

    it("shows filtered and total group counts when a filter is active", () => {
      renderActionBar({
        groupCount: 2,
        totalGroupCount: 5,
        reviewFilter: "exact"
      })
      expect(screen.getByText("2 duplicate sets to review")).toBeInTheDocument()
      expect(screen.getByText("5 sets in scan")).toBeInTheDocument()
    })
  })

  describe("button visibility", () => {
    it("does not render action buttons when groupCount is 0", () => {
      renderActionBar({ groupCount: 0, totalGroupCount: 0 })
      expect(
        screen.queryByRole("button", { name: /Scan again/i })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /Select all/i })
      ).not.toBeInTheDocument()
    })

    it("renders action buttons when groupCount > 0", () => {
      renderActionBar({ groupCount: 2 })
      expect(
        screen.getByRole("button", { name: /Scan again/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /^Export report$/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /^Spreadsheet$/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /Include all 2 shown sets in cleanup/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", {
          name: /Remove 2 shown sets from cleanup/i
        })
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /Choose keepers automatically/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /All sets \(3\)/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /Verified identical \(2\)/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /Candidates & similar \(1\)/i })
      ).toBeInTheDocument()
    })

    it("keeps filter buttons visible when the active filter has no groups", () => {
      renderActionBar({ groupCount: 0, totalGroupCount: 3 })
      expect(
        screen.getByRole("button", { name: /All sets \(3\)/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: /Choose keepers automatically/i })
      ).toBeEnabled()
      expect(
        screen.getByRole("button", { name: /Include all 0 shown sets in cleanup/i })
      ).toBeDisabled()
    })
  })

  describe("CleanupBar", () => {
    it("is enabled when duplicateCount > 0", () => {
      render(
        <ThemeProvider theme={theme}>
          <CleanupBar
            includedGroupCount={1}
            duplicateCount={4}
            reviewedGroupCount={3}
            totalGroupCount={3}
            onTrash={vi.fn()}
          />
        </ThemeProvider>
      )
      const btn = screen.getByRole("button", {
        name: /Review & move 4 to Trash/i
      })
      expect(btn).toBeEnabled()
    })

    it("is disabled when duplicateCount is 0", () => {
      render(
        <ThemeProvider theme={theme}>
          <CleanupBar
            includedGroupCount={0}
            duplicateCount={0}
            reviewedGroupCount={3}
            totalGroupCount={3}
            onTrash={vi.fn()}
          />
        </ThemeProvider>
      )
      const btn = screen.getByRole("button", {
        name: /No media items proposed for Trash/i
      })
      expect(btn).toBeDisabled()
    })

    it("announces selected sets separately from proposed Trash items", () => {
      render(
        <ThemeProvider theme={theme}>
          <CleanupBar
            includedGroupCount={1}
            duplicateCount={0}
            reviewedGroupCount={1}
            totalGroupCount={1}
            onTrash={vi.fn()}
          />
        </ThemeProvider>
      )

      expect(screen.getByRole("status")).toHaveTextContent(
        "1 set selected for cleanup · 0 media items proposed for Trash"
      )
      expect(
        screen.getByRole("button", {
          name: "No media items proposed for Trash"
        })
      ).toBeDisabled()
    })

    it("shows singular item summary when duplicateCount is 1", () => {
      render(
        <ThemeProvider theme={theme}>
          <CleanupBar
            includedGroupCount={1}
            duplicateCount={1}
            reviewedGroupCount={3}
            totalGroupCount={3}
            onTrash={vi.fn()}
          />
        </ThemeProvider>
      )
      expect(screen.getByRole("status")).toHaveTextContent(
        "1 set selected for cleanup · 1 media item proposed for Trash"
      )
    })

    it("keeps cleanup locked until every visible set is reviewed", () => {
      render(
        <ThemeProvider theme={theme}>
          <CleanupBar
            includedGroupCount={2}
            duplicateCount={4}
            reviewedGroupCount={1}
            totalGroupCount={3}
            onTrash={vi.fn()}
          />
        </ThemeProvider>
      )
      expect(screen.getByRole("status")).toHaveTextContent(
        "2 sets selected for cleanup · 4 media items proposed for Trash · 2 sets left to review"
      )
      expect(
        screen.getByRole("button", { name: /Review 2 more to continue/i })
      ).toBeDisabled()
    })
  })

  describe("callbacks", () => {
    it.each([true, false])(
      "includes all available sets across filters in compact=%s layout",
      (compact) => {
        const onIncludeAllEligible = vi.fn()
        renderActionBar({
          compact,
          groupCount: 1,
          totalGroupCount: 5,
          availableGroupCount: 4,
          selectedShownGroupCount: 0,
          includedGroupCount: 1,
          reviewFilter: "exact",
          onIncludeAllEligible
        })

        fireEvent.click(
          screen.getByRole("button", {
            name: "Include all 4 available sets in cleanup"
          })
        )
        expect(onIncludeAllEligible).toHaveBeenCalledOnce()
      }
    )

    it("shows a disabled all-included state for scan-wide selection", () => {
      renderActionBar({
        compact: true,
        groupCount: 1,
        totalGroupCount: 5,
        availableGroupCount: 4,
        selectedShownGroupCount: 0,
        includedGroupCount: 4,
        onIncludeAllEligible: vi.fn()
      })

      expect(
        screen.getByRole("button", {
          name: "All 4 available sets already included in cleanup"
        })
      ).toBeDisabled()
    })

    it("calls onRescan when Scan again is clicked", () => {
      const { callbacks } = renderActionBar()
      fireEvent.click(screen.getByRole("button", { name: /Scan again/i }))
      expect(callbacks.onRescan).toHaveBeenCalledOnce()
    })

    it("selects all sets currently shown by the filter", () => {
      const { callbacks } = renderActionBar({
        groupCount: 2,
        reviewFilter: "exact",
        selectedShownGroupCount: 0
      })
      fireEvent.click(
        screen.getByRole("button", { name: /Include all 2 shown sets in cleanup/i })
      )
      expect(callbacks.onSelectAll).toHaveBeenCalledOnce()
    })

    it("clears cleanup selection for the shown sets", () => {
      const { callbacks } = renderActionBar({ groupCount: 2 })
      fireEvent.click(
        screen.getByRole("button", {
          name: /Remove 2 shown sets from cleanup/i
        })
      )
      expect(callbacks.onDeselectAll).toHaveBeenCalledOnce()
    })

    it("shows when every set in the current filter is already included", () => {
      renderActionBar({ selectedShownGroupCount: 3 })

      expect(
        screen.getByRole("button", {
          name: /All 3 shown sets already included in cleanup/i
        })
      ).toBeDisabled()
      expect(
        screen.getByRole("button", {
          name: /Remove 3 shown sets from cleanup/i
        })
      ).toBeEnabled()
    })

    it("calls onReviewFilterChange when a filter is clicked", () => {
      const { callbacks } = renderActionBar()
      fireEvent.click(screen.getByRole("button", { name: /Identical \(2\)/i }))
      expect(callbacks.onReviewFilterChange).toHaveBeenCalledWith("exact")
    })

    it("calls export callbacks when report buttons are clicked", () => {
      const { callbacks } = renderActionBar()
      fireEvent.click(screen.getByRole("button", { name: /^Export report$/i }))
      fireEvent.click(screen.getByRole("button", { name: /^Spreadsheet$/i }))
      expect(callbacks.onExportJson).toHaveBeenCalledOnce()
      expect(callbacks.onExportCsv).toHaveBeenCalledOnce()
    })

    it("calls keep strategy callback from the keeper choice menu", () => {
      const { callbacks } = renderActionBar()
      fireEvent.click(screen.getByRole("button", { name: /Choose keepers automatically/i }))
      fireEvent.click(
        screen.getByRole("menuitem", { name: /Largest resolution/i })
      )
      expect(callbacks.onApplyKeepStrategy).toHaveBeenCalledWith(
        "largest_resolution"
      )
    })

    it("routes every keep-choice strategy to the keep handler", () => {
      const { callbacks } = renderActionBar({ compact: true })

      for (const label of Object.values(KEEP_STRATEGY_LABELS)) {
        fireEvent.click(
          screen.getByRole("button", { name: /Choose keepers automatically/i })
        )
        fireEvent.click(screen.getByRole("menuitem", { name: label }))
      }

      expect(callbacks.onApplyKeepStrategy).toHaveBeenCalledTimes(6)
      expect(callbacks.onApplyKeepStrategy).toHaveBeenNthCalledWith(
        1,
        "best_quality"
      )
      expect(callbacks.onApplyKeepStrategy).toHaveBeenNthCalledWith(
        2,
        "largest_resolution"
      )
      expect(callbacks.onApplyKeepStrategy).toHaveBeenNthCalledWith(
        3,
        "newest_taken"
      )
      expect(callbacks.onApplyKeepStrategy).toHaveBeenNthCalledWith(
        4,
        "oldest_taken"
      )
      expect(callbacks.onApplyKeepStrategy).toHaveBeenNthCalledWith(
        5,
        "newest_upload"
      )
      expect(callbacks.onApplyKeepStrategy).toHaveBeenNthCalledWith(
        6,
        "non_storage_counting"
      )
    })

    it("shows the non-storage-counting keep strategy", () => {
      const { callbacks } = renderActionBar()
      fireEvent.click(screen.getByRole("button", { name: /Choose keepers automatically/i }))
      fireEvent.click(
        screen.getByRole("menuitem", { name: /Non-storage-counting/i })
      )
      expect(callbacks.onApplyKeepStrategy).toHaveBeenCalledWith(
        "non_storage_counting"
      )
    })

    it("keeps compact toolbar actions accessible by name", () => {
      const { callbacks } = renderActionBar({ compact: true })

      fireEvent.click(screen.getByRole("button", { name: /More actions/i }))
      fireEvent.click(screen.getByRole("menuitem", { name: /Scan again/i }))
      fireEvent.click(screen.getByRole("button", { name: /More actions/i }))
      fireEvent.click(
        screen.getByRole("menuitem", { name: /Export audit report/i })
      )
      fireEvent.click(screen.getByRole("button", { name: /More actions/i }))
      fireEvent.click(
        screen.getByRole("menuitem", { name: /Export spreadsheet/i })
      )
      fireEvent.click(
        screen.getByRole("button", { name: /Include all 3 shown sets in cleanup/i })
      )
      fireEvent.click(
        screen.getByRole("button", { name: /Remove 3 shown sets from cleanup/i })
      )

      expect(callbacks.onRescan).toHaveBeenCalledOnce()
      expect(callbacks.onExportJson).toHaveBeenCalledOnce()
      expect(callbacks.onExportCsv).toHaveBeenCalledOnce()
      expect(callbacks.onSelectAll).toHaveBeenCalledOnce()
      expect(callbacks.onDeselectAll).toHaveBeenCalledOnce()
    })

    it("does not call onTrash when cleanup is disabled", () => {
      const onTrash = vi.fn()
      render(
        <ThemeProvider theme={theme}>
          <CleanupBar
            includedGroupCount={0}
            duplicateCount={0}
            reviewedGroupCount={3}
            totalGroupCount={3}
            onTrash={onTrash}
          />
        </ThemeProvider>
      )
      const btn = screen.getByRole("button", {
        name: /No media items proposed for Trash/i
      })
      fireEvent.click(btn)
      expect(onTrash).not.toHaveBeenCalled()
    })
  })
})
