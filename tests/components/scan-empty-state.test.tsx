import { ThemeProvider } from "@mui/material/styles"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ScanEmptyState } from "../../components/ScanEmptyState"
import theme from "../../lib/theme"

describe("ScanEmptyState", () => {
  it("shows identity validation status instead of a no-duplicates result", () => {
    render(
      <ThemeProvider theme={theme}>
        <ScanEmptyState
          identityPending
          onChangeSettings={vi.fn()}
        />
      </ThemeProvider>
    )

    expect(
      screen.getByText("Confirming the connected photo library")
    ).toBeVisible()
    expect(
      screen.getByText(/selection, export, and cleanup are unavailable/i)
    ).toBeVisible()
    expect(
      screen.queryByText("No duplicate sets found in this scan.")
    ).not.toBeInTheDocument()
  })

  it("[PARITY-05] scopes the no-match result to the items this scan examined", () => {
    const onChangeSettings = vi.fn()
    render(
      <ThemeProvider theme={theme}>
        <ScanEmptyState onChangeSettings={onChangeSettings} />
      </ThemeProvider>
    )

    expect(
      screen.getByText("No duplicate sets found in this scan.")
    ).toBeVisible()
    expect(
      screen.getByText(/among the items this scan examined/i)
    ).toBeVisible()
    expect(screen.queryByText(/in your library/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Change scan settings" }))
    expect(onChangeSettings).toHaveBeenCalledOnce()
  })
})
