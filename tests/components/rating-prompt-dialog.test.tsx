import { ThemeProvider } from "@mui/material/styles"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { RatingPrompt } from "../../components/RatingPrompt"
import theme from "../../lib/theme"

function renderPrompt() {
  const props = {
    open: true,
    onReview: vi.fn(),
    onFeedback: vi.fn(),
    onLater: vi.fn(),
    onNever: vi.fn()
  }
  render(
    <ThemeProvider theme={theme}>
      <RatingPrompt {...props} />
    </ThemeProvider>
  )
  return props
}

describe("RatingPrompt", () => {
  it("offers a direct, optional store review without a modal or sentiment gate", () => {
    renderPrompt()

    expect(
      screen.getByText("How was your PhotoSweep cleanup?")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Leave an honest review" })
    ).toHaveAttribute(
      "href",
      "https://chromewebstore.google.com/detail/photosweep-for-google-pho/niggncodoibinbianpkdpepmhfljifbo/reviews"
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Send feedback" })
    ).toBeInTheDocument()
    expect(screen.queryByText(/love|five star/i)).not.toBeInTheDocument()
  })

  it("offers review, feedback, defer, and permanent dismissal actions", () => {
    const props = renderPrompt()

    fireEvent.click(
      screen.getByRole("link", { name: "Leave an honest review" })
    )
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }))
    fireEvent.click(screen.getByRole("button", { name: "Maybe later" }))
    fireEvent.click(screen.getByRole("button", { name: "Don't ask again" }))

    expect(props.onReview).toHaveBeenCalledOnce()
    expect(props.onFeedback).toHaveBeenCalledOnce()
    expect(props.onLater).toHaveBeenCalledOnce()
    expect(props.onNever).toHaveBeenCalledOnce()
  })
})
