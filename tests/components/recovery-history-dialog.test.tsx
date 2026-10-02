import { ThemeProvider } from "@mui/material/styles"
import { cleanup, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { RecoveryHistoryDialog } from "../../components/RecoveryHistoryDialog"
import theme from "../../lib/theme"
import {
  providerRecoveryWindowNotice,
  providerTrashDestination
} from "../../lib/provider-operations"
import type { RecoveryHistoryRecord } from "../../lib/recovery-history"

function recordFor(provider: RecoveryHistoryRecord["provider"]): RecoveryHistoryRecord {
  return {
    version: 1,
    operationId: `cleanup-${provider}`,
    preTrashReportId: `pre-${provider}`,
    provider,
    createdAt: "2026-09-21T12:00:00.000Z",
    updatedAt: "2026-09-21T12:00:00.000Z",
    attemptedCount: 2,
    movedCount: 2,
    failedCount: 0,
    status: "restore_partial",
    restorableDedupKeys: [`remaining-${provider}`],
    restorableMediaKeys: [`media-${provider}`],
    restoreAttempts: 1,
    lastError: "One item remains in provider Trash."
  }
}

describe("RecoveryHistoryDialog", () => {
  it("[PARITY-04] shows the correct restore destination and retention for each provider", () => {
    for (const provider of ["google", "icloud", "amazon"] as const) {
      const record = recordFor(provider)
      render(
        <ThemeProvider theme={theme}>
          <RecoveryHistoryDialog
            open
            records={[record]}
            onClose={vi.fn()}
            onRestore={vi.fn()}
            onClear={vi.fn()}
          />
        </ThemeProvider>
      )

      expect(screen.getByText("Partially restored")).toBeVisible()
      expect(screen.getByRole("button", { name: "Restore" })).toBeVisible()
      expect(
        screen.getByText(providerRecoveryWindowNotice(provider))
      ).toBeVisible()
      expect(
        screen.getByText(`Restore from ${providerTrashDestination(provider)}.`)
      ).toBeVisible()
      cleanup()
    }
  })
})
