import LockRoundedIcon from "@mui/icons-material/LockRounded"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Dialog from "@mui/material/Dialog"
import DialogActions from "@mui/material/DialogActions"
import DialogContent from "@mui/material/DialogContent"
import DialogTitle from "@mui/material/DialogTitle"
import Stack from "@mui/material/Stack"
import TextField from "@mui/material/TextField"
import Typography from "@mui/material/Typography"
import { useState } from "react"

import { PLAN_LABELS, PLAN_PRICES, type PlanId } from "../lib/entitlement"
import {
  formatUpgradeScope,
  type CheckoutReturnState,
  type UpgradeReason,
  type UpgradeValueFacts
} from "../lib/paid-conversion"
import { photoSweepColors } from "../lib/theme"

export type { UpgradeReason } from "../lib/paid-conversion"

interface UpgradeDialogProps {
  open: boolean
  reason: UpgradeReason
  detail?: string
  onClose: () => void
  onChoosePlan?: (planId: Exclude<PlanId, "free">) => void
  onRefreshLicense?: () => void
  onRecoverLicense?: (email: string) => Promise<void> | void
  valueFacts?: UpgradeValueFacts
  checkoutState?: CheckoutReturnState
}

const PLANS: Exclude<PlanId, "free">[] = [
  "lifetime",
  "cleanup_pass",
  "mini_cleanup"
]

function reasonTitle(reason: UpgradeReason): string {
  if (reason === "trash") return "Unlock larger cleanup"
  if (reason === "export") return "Unlock the full report"
  if (reason === "resume") return "Unlock large-library resume"
  if (reason === "provider") return "Unlock provider cleanup"
  return "Unlock the full cleanup"
}

function reasonBody(reason: UpgradeReason): string {
  if (reason === "export") {
    return "Your free results stay available. Upgrade to export the complete report while photo analysis remains local in your browser."
  }
  if (reason === "resume") {
    return "Resume this large-library cleanup without starting over. Your saved scan data remains on this device."
  }
  if (reason === "trash") {
    return "You reached the free Trash-move limit. Upgrade to finish the reviewed cleanup; safety confirmation and reports remain available on every plan."
  }
  if (reason === "provider") {
    return "Upgrade for paid-scale cleanup on supported photo providers. Availability still depends on the provider, region, account, and loaded library area."
  }
  return "PhotoSweep found more items than your current cleanup limit. Upgrade after reviewing the free results; photo analysis still runs locally in your browser."
}

export function UpgradeDialog({
  open,
  reason,
  detail,
  onClose,
  onChoosePlan,
  onRefreshLicense,
  onRecoverLicense,
  valueFacts,
  checkoutState
}: UpgradeDialogProps) {
  const [recoveryEmail, setRecoveryEmail] = useState("")
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null)
  const canRecover = recoveryEmail.trim().includes("@") && !recoveryBusy

  function choosePlan(planId: Exclude<PlanId, "free">) {
    onChoosePlan?.(planId)
  }

  function refreshLicense() {
    onRefreshLicense?.()
  }

  const scope = valueFacts ? formatUpgradeScope(valueFacts) : undefined
  const valueLines = valueFacts
    ? [
        scope ? `Scope: ${scope}` : undefined,
        valueFacts.itemsChecked !== undefined
          ? `${valueFacts.itemsChecked.toLocaleString()} items checked`
          : undefined,
        valueFacts.additionalItemsUnavailable !== undefined &&
        valueFacts.additionalItemsUnavailable > 0
          ? `${valueFacts.additionalItemsUnavailable.toLocaleString()} additional items are outside this scan`
          : undefined,
        valueFacts.duplicateGroupCount !== undefined
          ? `${valueFacts.duplicateGroupCount.toLocaleString()} duplicate sets found in the checked scope`
          : undefined,
        valueFacts.visibleGroupCount !== undefined &&
        valueFacts.lockedGroupCount !== undefined &&
        valueFacts.lockedGroupCount > 0
          ? `${valueFacts.visibleGroupCount.toLocaleString()} sets visible on the current plan; ${valueFacts.lockedGroupCount.toLocaleString()} more are unavailable`
          : undefined,
        valueFacts.selectedCleanupCount !== undefined
          ? `${valueFacts.selectedCleanupCount.toLocaleString()} items selected for cleanup`
          : undefined,
        valueFacts.remainingTrashMoves !== undefined
          ? `${valueFacts.remainingTrashMoves === "unlimited" ? "Unlimited" : valueFacts.remainingTrashMoves.toLocaleString()} Trash moves remaining this session`
          : undefined
      ].filter((line): line is string => Boolean(line))
    : []

  async function handleRecoverLicense() {
    if (!canRecover || !onRecoverLicense) return
    setRecoveryBusy(true)
    setRecoveryMessage(null)
    try {
      await onRecoverLicense(recoveryEmail.trim())
      setRecoveryMessage(
        "If a paid license exists for that email, recovery instructions have been requested. Return here and refresh your license after completing recovery."
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setRecoveryMessage(`Could not request recovery: ${message}`)
    } finally {
      setRecoveryBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <LockRoundedIcon color="primary" />
        {reasonTitle(reason)}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {reasonBody(reason)}
        </Typography>
        {valueLines.length > 0 && (
          <Box
            component="ul"
            aria-label="Current cleanup value"
            sx={{
              mt: 0,
              mb: 2,
              pl: 2.5,
              color: "text.secondary",
              "& li": { mb: 0.5 }
            }}>
            {valueLines.map((line) => (
              <Typography component="li" variant="body2" key={line}>
                {line}
              </Typography>
            ))}
          </Box>
        )}
        {detail && (
          <Typography variant="body2" sx={{ mb: 2, fontWeight: 700 }}>
            {detail}
          </Typography>
        )}
        {checkoutState && checkoutState.status !== "idle" && (
          <Typography
            role="status"
            variant="body2"
            color={
              checkoutState.status === "active"
                ? "success.main"
                : "text.secondary"
            }
            sx={{ mb: 2, fontWeight: 700 }}>
            {checkoutState.message ??
              (checkoutState.status === "pending"
                ? "Checkout opened. Return here after payment and PhotoSweep will verify the license."
                : checkoutState.status === "refreshing"
                  ? "Checking the payment provider for a verified license..."
                  : checkoutState.status === "active"
                    ? "Paid access is active. Your review stays open."
                    : "Payment is not verified yet. Refresh the license or retry.")}
          </Typography>
        )}
        <Stack spacing={1}>
          {PLANS.map((planId) => (
            <Box
              key={planId}
              sx={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: 1,
                alignItems: "center",
                border: "1px solid",
                borderColor:
                  planId === "lifetime"
                    ? photoSweepColors.primaryBorder
                    : photoSweepColors.border,
                borderRadius: 2,
                bgcolor:
                  planId === "lifetime"
                    ? photoSweepColors.primarySoft
                    : photoSweepColors.surface,
                p: 1.25
              }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" fontWeight={800}>
                  {PLAN_LABELS[planId]}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {planId === "mini_cleanup"
                    ? "Permanent limited unlock: 2,500 photos, 75 groups, and 100 Trash moves per session."
                    : planId === "cleanup_pass"
                      ? "Seven days: 10,000 photos, full reports, full scan, and large-library resume."
                      : "One-time unlimited cleanup limits for the supported lifetime of this product."}
                </Typography>
              </Box>
              <Box
                component="button"
                type="button"
                aria-label={`Choose ${PLAN_LABELS[planId]} for ${PLAN_PRICES[planId]} USD`}
                onClick={() => choosePlan(planId)}
                disabled={
                  checkoutState?.status === "pending" ||
                  checkoutState?.status === "refreshing"
                }
                sx={{
                  appearance: "none",
                  border: "1px solid",
                  borderColor:
                    planId === "lifetime"
                      ? photoSweepColors.primary
                      : photoSweepColors.border,
                  borderRadius: 999,
                  bgcolor:
                    planId === "lifetime"
                      ? photoSweepColors.primary
                      : "transparent",
                  color:
                    planId === "lifetime" ? "#fff" : photoSweepColors.primary,
                  cursor: "pointer",
                  font: "inherit",
                  fontWeight: 800,
                  px: 2,
                  py: 0.75,
                  minWidth: 86,
                  "&:hover": {
                    bgcolor:
                      planId === "lifetime"
                        ? photoSweepColors.primary
                        : photoSweepColors.primarySoft
                  },
                  "&:focus-visible": {
                    outline: `2px solid ${photoSweepColors.primary}`,
                    outlineOffset: 2
                  }
                }}>
                {PLAN_PRICES[planId]} USD
              </Box>
            </Box>
          ))}
        </Stack>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 1.5 }}>
          One-time payments through Stripe. Prices are in USD; taxes may apply.
          Purchases follow PhotoSweep&apos;s 7-day refund policy.
        </Typography>
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
            Restore purchase
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              value={recoveryEmail}
              onChange={(event) => setRecoveryEmail(event.target.value)}
              label="Purchase email"
              type="email"
              size="small"
              fullWidth
            />
            <Button
              variant="outlined"
              disabled={!canRecover || !onRecoverLicense}
              onClick={handleRecoverLicense}>
              Recover
            </Button>
          </Stack>
          {recoveryMessage && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.75 }}>
              {recoveryMessage}
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Box
          component="button"
          type="button"
          onClick={refreshLicense}
          sx={{
            appearance: "none",
            border: 0,
            borderRadius: 1,
            bgcolor: "transparent",
            color: photoSweepColors.primary,
            cursor: "pointer",
            font: "inherit",
            fontWeight: 700,
            px: 1,
            py: 0.75,
            "&:hover": { bgcolor: photoSweepColors.primarySoft },
            "&:focus-visible": {
              outline: `2px solid ${photoSweepColors.primary}`,
              outlineOffset: 2
            }
          }}>
          Refresh license
        </Box>
        <Button onClick={onClose}>Keep reviewing free results</Button>
      </DialogActions>
    </Dialog>
  )
}
