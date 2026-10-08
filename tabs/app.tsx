import "@fontsource/dm-sans/400.css"
import "@fontsource/dm-sans/500.css"
import "@fontsource/dm-sans/700.css"

import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded"
import CloseIcon from "@mui/icons-material/Close"
import CollectionsRoundedIcon from "@mui/icons-material/CollectionsRounded"
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded"
import DoneAllRoundedIcon from "@mui/icons-material/DoneAllRounded"
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded"
import LockOutlinedIcon from "@mui/icons-material/LockOutlined"
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded"
import PhotoLibraryRoundedIcon from "@mui/icons-material/PhotoLibraryRounded"
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded"
import SearchRoundedIcon from "@mui/icons-material/SearchRounded"
import Alert from "@mui/material/Alert"
import AppBar from "@mui/material/AppBar"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Checkbox from "@mui/material/Checkbox"
import CircularProgress from "@mui/material/CircularProgress"
import CssBaseline from "@mui/material/CssBaseline"
import Dialog from "@mui/material/Dialog"
import DialogActions from "@mui/material/DialogActions"
import DialogContent from "@mui/material/DialogContent"
import DialogContentText from "@mui/material/DialogContentText"
import DialogTitle from "@mui/material/DialogTitle"
import FormControlLabel from "@mui/material/FormControlLabel"
import GlobalStyles from "@mui/material/GlobalStyles"
import IconButton from "@mui/material/IconButton"
import LinearProgress from "@mui/material/LinearProgress"
import MenuItem from "@mui/material/MenuItem"
import Snackbar from "@mui/material/Snackbar"
import { ThemeProvider } from "@mui/material/styles"
import TextField from "@mui/material/TextField"
import Toolbar from "@mui/material/Toolbar"
import Typography from "@mui/material/Typography"
import confetti from "canvas-confetti"
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from "react"

import { ActionBar, CleanupBar } from "../components/ActionBar"
import type { ReviewFilter } from "../components/ActionBar"
import { DuplicateGroups } from "../components/DuplicateGroups"
import { KeepStrategyFeedbackSnackbar } from "../components/KeepStrategyFeedbackSnackbar"
import { RatingPromptDialog } from "../components/RatingPromptDialog"
import { RecoveryHistoryDialog } from "../components/RecoveryHistoryDialog"
import { ScanConfig } from "../components/ScanConfig"
import { ScanCoverageNotice } from "../components/ScanCoverageNotice"
import { ScanEmptyState } from "../components/ScanEmptyState"
import { ScanProgress } from "../components/ScanProgress"
import { UpgradeDialog, type UpgradeReason } from "../components/UpgradeDialog"
import { appReducer } from "../lib/app-reducer"
import type { AppAction, AppState } from "../lib/app-reducer"
import { debug } from "../lib/debug"
import {
  applyRememberedDecisions,
  captureManualDecisionRecords,
  DECISION_MEMORY_STORAGE_KEY,
  DecisionMemoryStore
} from "../lib/decision-memory"
import type { DeleteReport } from "../lib/delete-report"
import { classifyDuplicateGroup } from "../lib/duplicate-classifier"
import { DuplicateDetectionEngine } from "../lib/duplicate-detector"
import type { DetectionProgress } from "../lib/duplicate-detector"
import {
  applyDefaultKeepStrategyToSession,
  DuplicateReviewSession,
  type DuplicateReviewAction,
  type DuplicateReviewSelections,
  type DuplicateTrashPlan
} from "../lib/duplicate-review-session"
import { EmbeddingCache } from "../lib/embedding-cache"
import {
  canExportFullReport,
  canTrashCount,
  getEffectivePlanId,
  getEstimatedScanCount,
  getLockedGroupCount,
  getPlanLimits,
  getScanGate,
  getVisibleGroups,
  limitScanItems,
  PLAN_LABELS,
  scanSettingsForEntitlement,
  type Entitlement,
  type PlanId
} from "../lib/entitlement"
import {
  CHROME_WEB_STORE_REVIEWS_URL,
  FEEDBACK_MAILTO_URL,
  PHOTOSWEEP_SITE_URL
} from "../lib/feedback"
import { planHealthCheckRetry } from "../lib/health-check-retry"
import {
  KEEP_STRATEGY_LABELS,
  type KeepStrategy
} from "../lib/keep-strategy"
import { handleKeepStrategySelection } from "../lib/keep-strategy-feedback"
import {
  getEffectiveLicenseApiBaseUrl,
  LICENSE_API_BASE_STORAGE_KEY,
  LicenseClient,
  loadStoredEntitlement,
  saveVerifiedEntitlementToken
} from "../lib/license-client"
import {
  PaidAccessLifecycle,
  PaidAccessNotConfiguredError
} from "../lib/paid-access-lifecycle"
import {
  describePaidReturnOutcome,
  shouldShowDeferredUpgrade,
  type CheckoutReturnState,
  type DeferredUpgradePrompt,
  type UpgradeValueFacts
} from "../lib/paid-conversion"
import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  countBucket,
  trashOutcomeAnalytics,
  restoreOutcomeAnalytics,
  ProviderConnectionTracker,
  sendPrivacySafeAnalyticsEvent,
  type PrivacySafeAnalyticsEvent,
  utcDayKey
} from "../lib/privacy-analytics"
import { getOrCreateInstallId } from "../lib/install-identity"
import { PHOTO_DATA_CONSENT_STORAGE_KEY } from "../lib/privacy-disclosure"
import {
  providerBatchLimit as configuredProviderBatchLimit,
  getProviderOperations,
  providerAlbumTrashNotice,
  providerFromUrl,
  providerLabel,
  providerRecoveryWindowNotice,
  providerTrashDestination
} from "../lib/provider-operations"
import { providerScanCancellationTarget } from "../lib/provider-scan-cancellation"
import {
  MAX_ORIGINAL_BYTES_PER_ITEM,
  MAX_ORIGINAL_BYTES_PER_REVIEW,
  getOriginalContentVerificationUnavailableMessage,
  isProviderRetrievalResponseBound,
  isProviderRetrievalBindingCurrent,
  isVideoForPlayback,
  safeProviderRetrievalError,
  validateOriginalContentHashResult,
  validateVideoPlaybackResult
} from "../lib/provider-retrieval"
import type {
  OriginalContentHashResult,
  VideoPlaybackResult
} from "../lib/provider-retrieval"
import {
  completeRatingPrompt,
  deferRatingPrompt,
  recordSuccessfulCleanup
} from "../lib/rating-prompt"
import {
  isRecoveryRestorable,
  sanitizeRecoveryHistory,
  type RecoveryHistoryRecord,
  type RecoveryRestoreStatusUpdate
} from "../lib/recovery-history"
import {
  accountFingerprint,
  buildScanScopeFingerprint,
  evaluateRecoveryRestorePreflight,
  type ReviewPreflightResult
} from "../lib/review-preflight"
import { reviewReportToCsv } from "../lib/review-report"
import { readRuntimeBuildIdentity } from "../lib/runtime-build-identity"
import {
  MAX_CHECKPOINT_MEDIA_ITEMS,
  summarizeScanCheckpoint,
  type ScanCheckpoint
} from "../lib/scan-checkpoint"
import { favoriteStatusForItem } from "../lib/favorite-status"
import { ProviderScopedReviewStorage } from "../lib/provider-review-storage"
import { ScanLifecycle } from "../lib/scan-lifecycle"
import { ScanLogger } from "../lib/scan-log"
import {
  areScanResultsValid,
  isValidICloudSyncToken
} from "../lib/scan-results"
import { StoredReviewScope } from "../lib/stored-review-scope"
import { buildSupportDiagnosticsReport } from "../lib/support-diagnostics"
import theme, { photoSweepColors } from "../lib/theme"
import {
  captureTrashDispatchAuthorization,
  isTrashDispatchAuthorizationCurrent
} from "../lib/trash-dispatch-guard"
import {
  TrashLifecycle,
  type TrashAuditContext,
  type TrashProviderResultData,
  type TrashUndoData
} from "../lib/trash-lifecycle"
import type { TrashResultReport } from "../lib/trash-result-report"
import { APP_ID, DEFAULT_SETTINGS } from "../lib/types"
import type {
  AppMessage,
  DuplicateGroup,
  GpdAlbum,
  GpdMediaItem,
  GptkProgressMessage,
  GptkResultMessage,
  HealthCheckResultMessage,
  LaunchProviderResult,
  MutationOutcome,
  PhotoProvider,
  RecoveryHistoryTransaction,
  RecoveryHistoryTransactionResponse,
  ScanCoverage,
  ScanSettings
} from "../lib/types"
import { usePrefersReducedMotion } from "../lib/use-prefers-reduced-motion"

// ============================================================
// Helpers
// ============================================================

const TRASH_BATCH_SIZE = 25
const TRASH_BATCH_PAUSE_MS = 1000
const TRASH_RETRY_COUNT = 2
const TRASH_RETRY_BACKOFF_MS = 1000
// A Trash request can span multiple provider batches. After this boundary the
// result is ambiguous, not failed: the provider may still finish the action,
// so late responses must remain routable by their request ID and users must
// not be invited to retry blindly.
const TRASH_REQUEST_TIMEOUT_MS = 120_000
const DELETE_REPORTS_KEY = "deleteReports"
const TRASH_RESULT_REPORTS_KEY = "trashResultReports"
const duplicateDetectionEngine = new DuplicateDetectionEngine()
const APP_CLIENT_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
const PROVIDER_RETRIEVAL_TIMEOUT_MS = 60_000

function googleAlbumIdentityKey(
  accountEmail?: string,
  providerSessionId?: string
): string {
  return JSON.stringify([
    typeof accountEmail === "string"
      ? accountEmail.trim().toLowerCase() || "__unknown__"
      : "__unknown__",
    typeof providerSessionId === "string" && providerSessionId.length > 0
      ? providerSessionId
      : "__unknown__"
  ])
}

type ProviderRetrievalCommand =
  | "getOriginalContentHash"
  | "getVideoPlaybackUrl"

interface PendingProviderRetrieval {
  command: ProviderRetrievalCommand
  provider: PhotoProvider
  providerSessionId: string
  accountEmail?: string
  scanScopeFingerprint: string
  mediaKey: string
  dedupKey: string
  signal: AbortSignal
  abortListener: () => void
  timeoutId: number
  resolve: (value: OriginalContentHashResult | VideoPlaybackResult) => void
  reject: (error: Error) => void
}

function extensionVersionForAnalytics(): string | undefined {
  try {
    return chrome.runtime.getManifest().version
  } catch {
    return undefined
  }
}

function WorkflowRail({
  stage,
  totalItems,
  totalGroupCount,
  exactGroupCount,
  similarGroupCount,
  duplicateCount,
  scanDetail,
  onRescan,
  compact = false
}: {
  stage: "setup" | "scan" | "review" | "trash" | "done"
  totalItems: number
  totalGroupCount: number
  exactGroupCount: number
  similarGroupCount: number
  duplicateCount: number
  scanDetail?: string
  onRescan: () => void
  compact?: boolean
}) {
  const stageIndex = {
    setup: 0,
    scan: 1,
    review: 2,
    trash: 3,
    done: 3
  }[stage]
  const headline =
    stage === "setup"
      ? "Your workflow"
      : stage === "scan"
        ? "Finding duplicates"
        : stage === "trash"
          ? "Moving to trash"
          : stage === "done"
            ? "Nothing to clean up"
            : "Choose what stays"
  const helper =
    stage === "scan"
      ? "The extension is checking photos and videos and building review sets."
      : stage === "trash"
        ? "Included duplicates are moved in batches. Undo remains available after completion."
        : stage === "done"
          ? "No duplicate sets are waiting. Try different settings if needed."
          : "Pick the copy to keep in each set, then trash the rest safely."
  const steps = [
    {
      icon: <PhotoLibraryRoundedIcon fontSize="small" />,
      label: "Choose",
      value: stageIndex === 0 ? "Current" : "Done"
    },
    {
      icon: <RefreshRoundedIcon fontSize="small" />,
      label: "Find",
      value:
        stage === "scan"
          ? scanDetail || "Working"
          : stageIndex > 1
            ? "Done"
            : "Next"
    },
    {
      icon: <CollectionsRoundedIcon fontSize="small" />,
      label: "Review",
      value:
        stage === "review"
          ? `${totalGroupCount.toLocaleString()} sets`
          : stageIndex > 2
            ? "Done"
            : "Next"
    },
    {
      icon: <DeleteOutlineRoundedIcon fontSize="small" />,
      label: compact ? "Trash" : "Trash safely",
      value:
        stage === "trash"
          ? `${duplicateCount.toLocaleString()} moving`
          : stage === "review"
            ? `${duplicateCount.toLocaleString()} media item${
                duplicateCount === 1 ? "" : "s"
              } proposed for Trash`
            : stage === "done"
              ? "Done"
              : "Final"
    }
  ]

  return (
    <Box
      component="aside"
      sx={{
        position: compact ? "static" : { md: "sticky" },
        top: compact ? "auto" : { md: 88 },
        alignSelf: "flex-start",
        width: compact ? "100%" : { xs: "100%", md: 272 },
        flexShrink: 0,
        borderRight: { md: `1px solid ${photoSweepColors.border}` },
        borderBottom: { xs: `1px solid ${photoSweepColors.border}`, md: 0 },
        borderRadius: 0,
        bgcolor: "transparent",
        overflow: "visible",
        pr: { xs: 0, md: 2.25 },
        pb: { xs: 1, md: 0 }
      }}>
      <Box
        sx={{
          p: compact ? 1.25 : 0,
          pb: compact ? 1.25 : 2,
          borderBottom: "1px solid",
          borderColor: "divider"
        }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            mb: stage === "setup" ? 0 : 1.25
          }}>
          {stage === "scan" ? (
            <CircularProgress size={16} thickness={5} />
          ) : stage === "setup" ? (
            <PhotoLibraryRoundedIcon color="primary" fontSize="small" />
          ) : (
            <DoneAllRoundedIcon color="success" fontSize="small" />
          )}
          <Typography variant="subtitle2" fontWeight={700}>
            {headline}
          </Typography>
        </Box>
        {stage !== "setup" && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 1.5 }}>
            {helper}
          </Typography>
        )}
        {stage !== "setup" && (
          <Box
          sx={{
            display: "grid",
            gridTemplateColumns: compact
              ? "repeat(4, minmax(0, 1fr))"
              : "1fr 1fr",
            gap: compact ? 0.75 : 1.5
          }}>
          <Box>
            <Typography variant={compact ? "subtitle1" : "h6"} fontWeight={800}>
              {totalGroupCount.toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              sets
            </Typography>
          </Box>
          <Box>
            <Typography variant={compact ? "subtitle1" : "h6"} fontWeight={800}>
              {totalItems.toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              checked
            </Typography>
          </Box>
          <Box>
            <Typography variant={compact ? "subtitle1" : "h6"} fontWeight={800}>
              {exactGroupCount.toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              identical
            </Typography>
          </Box>
          <Box>
            <Typography variant={compact ? "subtitle1" : "h6"} fontWeight={800}>
              {similarGroupCount.toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              similar
            </Typography>
          </Box>
          </Box>
        )}
        {!compact && stage !== "setup" && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshRoundedIcon />}
            onClick={onRescan}
            sx={{ mt: 1.5 }}>
            New scan
          </Button>
        )}
      </Box>

      <Box
        sx={{
          p: compact ? 0.75 : 1,
          display: compact ? "grid" : { xs: "grid", md: "block" },
          gridTemplateColumns: compact
            ? "repeat(4, minmax(0, 1fr))"
            : { xs: "repeat(4, minmax(0, 1fr))", md: "none" },
          gap: compact ? 0.5 : undefined
        }}>
        {steps.map((item, index) => (
          <Box
            key={item.label}
            sx={{
              display: "flex",
              flexDirection: compact ? "column" : { xs: "column", md: "row" },
              alignItems: "center",
              justifyContent: compact ? "center" : undefined,
              textAlign: compact ? "center" : "left",
              gap: compact ? 0.35 : { xs: 0.4, md: 1.25 },
              px: compact ? 0.5 : 1.25,
              py: compact ? 0.75 : 1.1,
              borderRadius: 2,
              color: index === stageIndex ? "primary.main" : "text.secondary",
              bgcolor: index === stageIndex ? "primary.light" : "transparent"
            }}>
            {item.icon}
            <Typography
              variant="body2"
              fontWeight={700}
              sx={{
                flex: compact ? "initial" : 1,
                fontSize: compact ? 11 : undefined,
                lineHeight: compact ? 1.1 : undefined
              }}>
              {item.label}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: compact ? "none" : { xs: "none", md: "block" } }}>
              {item.value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function sendToServiceWorker<T = unknown>(
  message: AppMessage
): Promise<T | undefined> {
  return Promise.resolve(
    chrome.runtime.sendMessage({ ...message, clientId: APP_CLIENT_ID })
  ) as Promise<T | undefined>
}

async function requestRecoveryHistoryTransaction(
  transaction: RecoveryHistoryTransaction
): Promise<RecoveryHistoryRecord[]> {
  const transactionId = generateRequestId()
  const response = await sendToServiceWorker<RecoveryHistoryTransactionResponse>({
    app: APP_ID,
    action: "recoveryHistory.transaction",
    transactionId,
    transaction
  })
  if (
    !response ||
    response.action !== "recoveryHistory.transaction.result" ||
    response.transactionId !== transactionId ||
    response.success !== true ||
    !Array.isArray(response.records)
  ) {
    throw new Error(
      response?.error ||
        "The background worker did not confirm the recovery history transaction."
    )
  }
  if (
    (transaction.kind === "beginRestore" ||
      transaction.kind === "updateRestore") &&
    (response.operationId !== transaction.operationId ||
      response.requestId !== transaction.requestId)
  ) {
    throw new Error("Recovery history response did not match this restore request.")
  }
  if (
    transaction.kind === "beginRestore" &&
    JSON.stringify(response.targetDedupKeys) !==
      JSON.stringify(transaction.targetDedupKeys)
  ) {
    throw new Error("Recovery history response did not match the exact restore targets.")
  }
  return sanitizeRecoveryHistory(response.records)
}

function cancelProviderScanRequest(
  targetRequestId: string,
  provider: PhotoProvider
): void {
  void sendToServiceWorker({
    app: APP_ID,
    action: "gptkCommand",
    command: "cancelScan",
    requestId: generateRequestId(),
    provider,
    args: { targetRequestId }
  }).catch(() => {})
}

function activeDateRange(
  dateRange: ScanSettings["dateRange"]
): ScanSettings["dateRange"] | undefined {
  if (!dateRange?.from && !dateRange?.to) return undefined
  return dateRange
}

function activeAlbumScope(
  albumScope: ScanSettings["albumScope"]
): ScanSettings["albumScope"] | undefined {
  return albumScope?.mediaKey ? albumScope : undefined
}

function albumScopeForProvider(
  provider: PhotoProvider,
  albumScope: ScanSettings["albumScope"]
): ScanSettings["albumScope"] | undefined {
  return getProviderOperations(provider).capabilities.albumScope === "supported"
    ? activeAlbumScope(albumScope)
    : undefined
}

function fullScanSettingsPatch(
  scanSettings: ScanSettings
): Partial<ScanSettings> {
  return {
    sourceProvider: scanSettings.sourceProvider ?? "google",
    defaultKeepStrategy:
      scanSettings.defaultKeepStrategy ?? DEFAULT_SETTINGS.defaultKeepStrategy,
    similarityThreshold: scanSettings.similarityThreshold,
    scanMode: scanSettings.scanMode,
    smartWindowSec: scanSettings.smartWindowSec,
    dateRange: scanSettings.dateRange,
    albumScope: scanSettings.albumScope,
    amazonBatchLimit: scanSettings.amazonBatchLimit,
    icloudBatchLimit: scanSettings.icloudBatchLimit
  }
}

function scanScopeLabel(settings: ScanSettings): {
  label: string
  fullLibrary: boolean
} {
  const provider = providerLabel(settings.sourceProvider ?? "google")
  if (settings.albumScope?.title) {
    return { label: settings.albumScope.title, fullLibrary: false }
  }
  if (settings.albumScope?.mediaKey) {
    return { label: `selected ${provider} album`, fullLibrary: false }
  }
  if (settings.dateRange?.from || settings.dateRange?.to) {
    return { label: `selected ${provider} date range`, fullLibrary: false }
  }
  if (providerBatchLimitForEntitlement(settings) !== undefined) {
    return { label: `selected ${provider} test batch`, fullLibrary: false }
  }
  return { label: `${provider} library currently loaded`, fullLibrary: true }
}

function DeferredUpgradeBanner({
  prompt,
  onOpen,
  onDismiss
}: {
  prompt: DeferredUpgradePrompt
  onOpen: () => void
  onDismiss: () => void
}) {
  const { facts } = prompt
  const scope =
    facts.scopeLabel ??
    (facts.scopeIsFullLibrary ? "your loaded library" : "the checked scope")
  const detail =
    facts.additionalItemsUnavailable !== undefined &&
    facts.additionalItemsUnavailable > 0
      ? `${facts.itemsChecked?.toLocaleString() ?? "The checked"} items were analyzed in ${scope}. ${facts.additionalItemsUnavailable.toLocaleString()} additional items were outside this scan.`
      : facts.duplicateGroupCount !== undefined
        ? `${facts.duplicateGroupCount.toLocaleString()} duplicate sets were found in ${scope}.`
        : `Review the duplicate sets found in ${scope}.`

  return (
    <Alert
      severity="info"
      sx={{ mb: 1.5, alignItems: "center" }}
      action={
        <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
          <Button size="small" color="inherit" onClick={onOpen}>
            Compare plans
          </Button>
          <IconButton
            size="small"
            color="inherit"
            aria-label="Dismiss upgrade suggestion"
            onClick={onDismiss}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      }>
      <Typography variant="body2" fontWeight={800}>
        Keep reviewing or unlock more of this cleanup
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {detail} Paid access is optional and does not change provider
        availability.
      </Typography>
    </Alert>
  )
}

function providerBatchLimitForEntitlement(
  settings: ScanSettings,
  entitlement?: Entitlement | null
): number | undefined {
  const effectiveSettings = scanSettingsForEntitlement(settings, entitlement)
  return configuredProviderBatchLimit(effectiveSettings)
}

function SidePanelConnectionSetup({
  selectedProvider,
  onOpenProvider,
  onRetry,
  error,
  connectionStatus = "Checking the open photo library tab..."
}: {
  selectedProvider: PhotoProvider
  onOpenProvider: (provider: PhotoProvider) => void
  onRetry: () => void
  error?: string
  connectionStatus?: string
}) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        maxWidth: "100%",
        mx: "auto",
        gap: 1.25
      }}>
      <Box
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          bgcolor: photoSweepColors.surface,
          p: 1.25
        }}>
        <Typography variant="overline" color="text.secondary">
          Step 1
        </Typography>
        <Typography variant="subtitle1" fontWeight={800} gutterBottom>
          Choose photo source
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Pick one library. The main tab will open that provider.
        </Typography>
        <TextField
          select
          label="Photo source"
          size="small"
          fullWidth
          value={selectedProvider}
          sx={{ mb: 1 }}
          onChange={(event) =>
            onOpenProvider(event.target.value as PhotoProvider)
          }>
          <MenuItem value="google">Google Photos</MenuItem>
          <MenuItem value="icloud">iCloud Photos</MenuItem>
          <MenuItem value="amazon">Amazon Photos</MenuItem>
        </TextField>
        <Box
          sx={{
            border: "1px solid",
            borderColor: photoSweepColors.border,
            borderRadius: 2,
            p: 0.5,
            bgcolor: photoSweepColors.surfaceSoft
          }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshRoundedIcon />}
            onClick={onRetry}
            fullWidth
            sx={{ fontWeight: 800 }}>
            Retry connection
          </Button>
        </Box>
      </Box>
      {error ? (
        <Alert severity="warning">{error}</Alert>
      ) : (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            border: "1px solid",
            borderColor: photoSweepColors.primaryBorder,
            borderRadius: 2,
            bgcolor: photoSweepColors.primarySoft,
            px: 1.25,
            py: 1
          }}>
          <CircularProgress size={16} thickness={5} />
          <Typography variant="body2" color="text.secondary">
            {connectionStatus}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

type TimelineStepStatus = "complete" | "active" | "locked"

type SidePanelStepItem = {
  index: number
  title: string
  status: TimelineStepStatus
}

function SidePanelTimelineProgress({ steps }: { steps: SidePanelStepItem[] }) {
  return (
    <Box
      component="ol"
      aria-label="Setup progress"
      sx={{
        listStyle: "none",
        m: 0,
        p: 0.25,
        display: "grid",
        gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
        gap: 0.25
      }}>
      {steps.map((step, position) => {
        const isActive = step.status === "active"
        const isComplete = step.status === "complete"
        const markerColor = isComplete
          ? photoSweepColors.success
          : isActive
            ? photoSweepColors.primary
            : photoSweepColors.muted
        const statusLabel = isComplete
          ? "Complete"
          : isActive
            ? "Current step"
            : "Upcoming"

        return (
          <Box
            key={step.title}
            component="li"
            aria-current={isActive ? "step" : undefined}
            aria-label={`${step.title}: ${statusLabel}`}
            sx={{
              minWidth: 0,
              position: "relative",
              display: "grid",
              justifyItems: "center",
              gap: 0.35,
              color: markerColor,
              opacity: step.status === "locked" ? 0.72 : 1,
              "&::before":
                position === 0
                  ? undefined
                  : {
                      content: '""',
                      position: "absolute",
                      top: 9,
                      right: "50%",
                      width: "100%",
                      height: 2,
                      bgcolor:
                        steps[position - 1]?.status === "complete"
                          ? photoSweepColors.success
                          : photoSweepColors.border,
                      zIndex: 0
                    }
            }}>
            <Box
              sx={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                border: "1.5px solid",
                borderColor: markerColor,
                bgcolor: isComplete
                  ? photoSweepColors.successSoft
                  : isActive
                    ? photoSweepColors.primarySoft
                    : photoSweepColors.surfaceSoft,
                color: markerColor,
                fontSize: 10,
                lineHeight: 1,
                fontWeight: 800,
                zIndex: 1,
                "& svg": { fontSize: 12 }
              }}>
              {isComplete ? (
                <CheckCircleRoundedIcon />
              ) : (
                step.index
              )}
            </Box>
            <Typography
              variant="caption"
              noWrap
              sx={{
                maxWidth: "100%",
                fontSize: 10.5,
                lineHeight: 1.1,
                fontWeight: isActive ? 800 : 650,
                color: isActive ? photoSweepColors.ink : markerColor,
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}>
              {step.title}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}

function SidePanelTimelineStep({
  status,
  children
}: Pick<SidePanelStepItem, "status"> & {
  children?: ReactNode
}) {
  if (status !== "active" || !children) return null

  return (
    <Box
      sx={{
        minWidth: 0,
        width: "100%",
        display: "grid",
        gap: 0.75,
        p: 1,
        border: "1px solid",
        borderColor: photoSweepColors.border,
        borderRadius: 1.5,
        bgcolor: photoSweepColors.surface,
        boxShadow: "none",
        "& > *": {
          minWidth: 0,
          maxWidth: "100%",
          boxSizing: "border-box"
        }
      }}>
      {children}
    </Box>
  )
}

function SidePanelSourceBar({
  provider,
  connected,
  onProviderChange
}: {
  provider: PhotoProvider
  connected: boolean
  onProviderChange: (provider: PhotoProvider) => void
}) {
  return (
    <Box
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 3,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) max-content",
        alignItems: "center",
        gap: 0.75,
        border: "1px solid",
        borderColor: photoSweepColors.border,
        borderRadius: 2,
        bgcolor: photoSweepColors.surface,
        boxShadow: "none",
        p: 0.5
      }}>
      <TextField
        select
        size="small"
        fullWidth
        value={provider}
        SelectProps={{
          SelectDisplayProps: {
            "aria-label": "Photo source",
            "aria-labelledby": undefined
          }
        }}
        sx={{
          minWidth: 0,
          "& .MuiInputBase-root": {
            height: 44,
            borderRadius: 1,
            bgcolor: photoSweepColors.surface
          },
          "& .MuiSelect-select": {
            py: 1,
            pr: "32px !important",
            fontSize: 15,
            fontWeight: 650,
            lineHeight: 1.2
          },
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: photoSweepColors.borderStrong
          }
        }}
        onChange={(event) =>
          onProviderChange(event.target.value as PhotoProvider)
        }>
        <MenuItem value="google">Google Photos</MenuItem>
        <MenuItem value="icloud">iCloud Photos</MenuItem>
        <MenuItem value="amazon">Amazon Photos</MenuItem>
      </TextField>
      <Typography
        variant="caption"
        noWrap
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.45,
          px: 0.9,
          py: 0.65,
          borderRadius: 999,
          bgcolor: connected
            ? photoSweepColors.successSoft
            : photoSweepColors.surfaceSoft,
          border: "1px solid",
          borderColor: connected
            ? photoSweepColors.successSoft
            : photoSweepColors.border,
          color: connected ? photoSweepColors.success : photoSweepColors.muted,
          fontWeight: 850,
          fontSize: 11,
          lineHeight: 1
        }}>
        <Box
          component="span"
          sx={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            bgcolor: connected
              ? photoSweepColors.success
              : photoSweepColors.muted,
            flexShrink: 0
          }}
        />
        {connected ? "Connected" : "Not connected"}
      </Typography>
    </Box>
  )
}

function SidePanelBrandHeader() {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.85,
        px: 0.35,
        py: 0.2
      }}>
      <Box
        sx={{
        width: 34,
        height: 34,
        borderRadius: 1,
          display: "grid",
          placeItems: "center",
          color: photoSweepColors.surface,
          bgcolor: photoSweepColors.primary,
        boxShadow: "none"
      }}>
        <PhotoLibraryRoundedIcon sx={{ fontSize: 19 }} />
      </Box>
      <Typography
        variant="subtitle1"
        fontWeight={850}
        sx={{ letterSpacing: 0, color: photoSweepColors.ink, lineHeight: 1 }}>
        PhotoSweep
      </Typography>
    </Box>
  )
}

function SidePanelSafetyFooter() {
  return (
    <Box
      sx={{
        mt: 0.25,
        px: 0.5,
        py: 0.75,
        borderTop: "1px solid",
        borderColor: photoSweepColors.border,
        bgcolor: "transparent",
        display: "grid",
        gridTemplateColumns: "20px minmax(0, 1fr)",
        gap: 0.75,
        alignItems: "center"
      }}>
      <Box
        sx={{
          width: 20,
          height: 20,
          borderRadius: 0.75,
          bgcolor: "transparent",
          color: photoSweepColors.muted,
          display: "grid",
          placeItems: "center"
        }}>
        <LockOutlinedIcon sx={{ fontSize: 15 }} />
      </Box>
      <Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", lineHeight: 1.4, fontSize: 12 }}>
          Nothing moves to Trash before you review and confirm.
        </Typography>
      </Box>
    </Box>
  )
}

function dateToLocalMs(value: string, endOfDay = false): number {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  ).getTime()
}

function filterMediaItemsByDateRange(
  items: GpdMediaItem[],
  dateRange: ScanSettings["dateRange"]
): GpdMediaItem[] {
  const range = activeDateRange(dateRange)
  if (!range) return items

  const fromMs = range.from
    ? dateToLocalMs(range.from)
    : Number.NEGATIVE_INFINITY
  const toMs = range.to
    ? dateToLocalMs(range.to, true)
    : Number.POSITIVE_INFINITY

  return items.filter((item) => {
    if (!Number.isFinite(item.timestamp)) return false
    return item.timestamp >= fromMs && item.timestamp <= toMs
  })
}

async function persistDeleteReport(report: DeleteReport): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(DELETE_REPORTS_KEY)
    const reports =
      (stored[DELETE_REPORTS_KEY] as DeleteReport[] | undefined) ?? []
    reports.push(report)
    if (reports.length > 20) reports.splice(0, reports.length - 20)
    await chrome.storage.local.set({ [DELETE_REPORTS_KEY]: reports })
  } catch (error) {
    console.warn("[GPD] failed to persist delete report", error)
    throw error
  }
}

function downloadDeleteReport(report: DeleteReport): void {
  downloadTextFile({
    filename: `${report.reportId}.json`,
    contents: JSON.stringify(report, null, 2),
    type: "application/json"
  })
}

async function persistTrashResultReport(
  report: TrashResultReport
): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(TRASH_RESULT_REPORTS_KEY)
    const reports =
      (stored[TRASH_RESULT_REPORTS_KEY] as TrashResultReport[] | undefined) ??
      []
    reports.push(report)
    if (reports.length > 20) reports.splice(0, reports.length - 20)
    await chrome.storage.local.set({ [TRASH_RESULT_REPORTS_KEY]: reports })
  } catch (error) {
    console.warn("[GPD] failed to persist trash result report", error)
    throw error
  }
}

function hasDurableRestoreIntent(
  records: RecoveryHistoryRecord[],
  operationId: string,
  requestId: string,
  requestedDedupKeys: string[]
): boolean {
  const record = records.find((entry) => entry.operationId === operationId)
  const matches =
    record?.restoreOutcomeHistory?.filter(
      (attempt) => attempt.requestId === requestId
    ) ?? []
  if (matches.length !== 1) return false
  const attempt = matches[0]!
  const requested = new Set(requestedDedupKeys)
  return (
    attempt.terminal === false &&
    attempt.outcomes.length === requestedDedupKeys.length &&
    attempt.outcomes.every(
      (outcome) => requested.has(outcome.targetKey) && outcome.status === "unknown"
    ) &&
    new Set(attempt.outcomes.map((outcome) => outcome.targetKey)).size ===
      requested.size &&
    requestedDedupKeys.every(
      (key) => !record?.restorableDedupKeys.includes(key)
    ) &&
    requestedDedupKeys.every(
      (key) =>
        record?.restoreOutcomes?.find((outcome) => outcome.targetKey === key)
          ?.status === "unknown"
    )
  )
}

function notDispatchedRestoreStatus(
  requestId: string,
  dedupKeys: string[],
  reason: string
): RecoveryRestoreStatusUpdate {
  return {
    outcome: "failed",
    requestId,
    terminal: true,
    restoredDedupKeys: [],
    unknownDedupKeys: [],
    outcomes: dedupKeys.map((targetKey) => ({
      operation: "restore",
      targetKey,
      status: "failed",
      reason
    })),
    notDispatchedDedupKeys: [...dedupKeys],
    error: reason
  }
}

function chromeDecisionMemoryStorage() {
  return new DecisionMemoryStore({
    async get() {
      const stored = await chrome.storage.local.get(DECISION_MEMORY_STORAGE_KEY)
      return stored[DECISION_MEMORY_STORAGE_KEY]
    },
    async set(records) {
      await chrome.storage.local.set({
        [DECISION_MEMORY_STORAGE_KEY]: records
      })
    },
    async remove() {
      await chrome.storage.local.remove(DECISION_MEMORY_STORAGE_KEY)
    }
  })
}

function downloadTrashResultReport(report: TrashResultReport): void {
  downloadTextFile({
    filename: `${report.reportId}.json`,
    contents: JSON.stringify(report, null, 2),
    type: "application/json"
  })
}

function downloadTextFile(params: {
  filename: string
  contents: string
  type: string
}): void {
  const blob = new Blob([params.contents], { type: params.type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = params.filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function isFavoriteProtected(
  item: GpdMediaItem | undefined,
  _settings: ScanSettings
): boolean {
  return favoriteStatusForItem(item) === "favorite"
}

function protectedKeepKeysForGroup(
  group: DuplicateGroup,
  mediaItems: Record<string, GpdMediaItem>,
  settings: ScanSettings
): Set<string> {
  const protectedKeys = group.mediaKeys.filter((key) =>
    isFavoriteProtected(mediaItems[key], settings)
  )
  return new Set(protectedKeys)
}

function filterGroupsForSafety(
  groups: DuplicateGroup[],
  mediaItems: Record<string, GpdMediaItem>,
  settings: ScanSettings
): DuplicateGroup[] {
  if (!settings.exactOnly) return groups
  return groups.filter((group) => {
    const kind = classifyDuplicateGroup(group, mediaItems).duplicateKind
    return kind === "exact"
  })
}

function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit <= 1 || value >= 10 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

type PendingSelections = DuplicateReviewSelections

// ============================================================
// App component
// ============================================================

type UpgradePromptState = {
  reason: UpgradeReason
  detail?: string
  valueFacts?: UpgradeValueFacts
}

export default function App() {
  useEffect(() => {
    document.documentElement.lang = "en"
  }, [])

  const isSidePanel =
    typeof window !== "undefined" &&
    (window.location.pathname.includes("sidepanel") ||
      window.location.pathname.includes("scanner-panel"))
  const [state, dispatch] = useReducer(appReducer, { status: "connecting" })
  const [sidePanelSourceConfirmed, setSidePanelSourceConfirmed] =
    useState(false)
  const [storageChecked, setStorageChecked] = useState(false)
  const [settings, setSettings] = useReducer(
    (prev: ScanSettings, next: Partial<ScanSettings>) => ({ ...prev, ...next }),
    DEFAULT_SETTINGS
  )

  const [reviewSelections, setReviewSelections] =
    useState<DuplicateReviewSelections>({
      selectedGroupIds: new Set(),
      reviewedGroupIds: new Set(),
      keptOverrides: {}
    })
  const selectedGroupIds = reviewSelections.selectedGroupIds
  const reviewedGroupIds = reviewSelections.reviewedGroupIds
  const keptOverrides = reviewSelections.keptOverrides
  const setSelectedGroupIds = useCallback<
    Dispatch<SetStateAction<Set<string>>>
  >((value) => {
    setReviewSelections((previous) => ({
      ...previous,
      selectedGroupIds:
        typeof value === "function" ? value(previous.selectedGroupIds) : value
    }))
  }, [])
  const setKeptOverrides = useCallback<
    Dispatch<SetStateAction<Record<string, Set<string>>>>
  >((value) => {
    setReviewSelections((previous) => ({
      ...previous,
      keptOverrides:
        typeof value === "function" ? value(previous.keptOverrides) : value
    }))
  }, [])
  const setReviewedGroupIds = useCallback<
    Dispatch<SetStateAction<Set<string>>>
  >((value) => {
    setReviewSelections((previous) => ({
      ...previous,
      reviewedGroupIds:
        typeof value === "function" ? value(previous.reviewedGroupIds) : value
    }))
  }, [])

  // Confirm dialog state
  const [trashConfirm, setTrashConfirmState] =
    useState<DuplicateTrashPlan | null>(null)
  const trashConfirmRef = useRef<DuplicateTrashPlan | null>(null)
  const [trashConfirmCount, setTrashConfirmCount] = useState("")
  const [unknownFavoriteTrashAcknowledged, setUnknownFavoriteTrashAcknowledged] =
    useState(false)
  const [trashPreflight, setTrashPreflight] =
    useState<ReviewPreflightResult | null>(null)
  const [trashWarning, setTrashWarningState] = useState<string | null>(null)
  const trashWarningRef = useRef<string | null>(null)
  const [keepStrategyFeedback, setKeepStrategyFeedback] = useState<string | null>(
    null
  )
  const [trashMovesThisSession, setTrashMovesThisSession] = useState(0)
  const [reportError, setReportError] = useState<string | null>(null)
  const [recoveryHistory, setRecoveryHistoryState] = useState<
    RecoveryHistoryRecord[]
  >([])
  const recoveryHistoryRef = useRef<RecoveryHistoryRecord[]>([])
  const [recoveryHistoryReadError, setRecoveryHistoryReadError] = useState(false)
  const [recoveryHistoryOpen, setRecoveryHistoryOpen] = useState(false)
  const [recoveryHistoryBusyId, setRecoveryHistoryBusyId] = useState<
    string | null
  >(null)
  const decisionMemoryStoreRef = useRef<DecisionMemoryStore | null>(null)
  if (!decisionMemoryStoreRef.current) {
    decisionMemoryStoreRef.current = chromeDecisionMemoryStorage()
  }
  const decisionMemoryStore = decisionMemoryStoreRef.current
  const restoreRequestByIdRef = useRef(
    new Map<
      string,
      {
        operationId?: string
        generation: number
        history: boolean
        provider: PhotoProvider
        accountEmail?: string
        providerSessionId: string
      }
    >()
  )
  const restoreCommitInFlightRef = useRef(false)
  const providerConnectionTrackerRef = useRef(new ProviderConnectionTracker())
  const installIdPromiseRef = useRef<Promise<string> | null>(null)
  const resetReviewRef = useRef<() => void>(() => {})
  const [cacheEntryCount, setCacheEntryCount] = useState<number | null>(null)
  const [cacheStatus, setCacheStatus] = useState<string | undefined>()
  const [cacheBusy, setCacheBusy] = useState(false)
  const [resumeCheckpoint, setResumeCheckpoint] =
    useState<ScanCheckpoint | null>(null)
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all")
  const [albums, setAlbums] = useState<GpdAlbum[]>([])
  const [albumsLoading, setAlbumsLoading] = useState(false)
  const [albumsError, setAlbumsError] = useState<string | null>(null)
  const [accountValidationComplete, setAccountValidationComplete] =
    useState(false)
  const [amazonProfile, setAmazonProfile] = useState<{
    displayName: string
    providerSessionId: string
  } | null>(null)
  const [entitlement, setEntitlement] = useState<Entitlement>({
    planId: "free",
    active: true,
    source: "none"
  })
  const [entitlementLoaded, setEntitlementLoaded] = useState(false)
  const [upgradePrompt, setUpgradePrompt] = useState<UpgradePromptState | null>(
    null
  )
  const [deferredUpgrade, setDeferredUpgrade] =
    useState<DeferredUpgradePrompt | null>(null)
  const deferredUpgradeRef = useRef<DeferredUpgradePrompt | null>(null)
  const [ratingPromptOpen, setRatingPromptOpen] = useState(false)
  const ratingPromptOpenRef = useRef(false)
  const ratingPromptDeferredRef = useRef(false)
  const [checkoutState, setCheckoutState] = useState<CheckoutReturnState>({
    status: "idle"
  })
  const checkoutStateRef = useRef<CheckoutReturnState>({ status: "idle" })
  const upgradePromptRef = useRef<UpgradePromptState | null>(null)
  const checkoutPlanRef = useRef<Exclude<PlanId, "free"> | null>(null)
  const checkoutStartInFlightRef = useRef(false)
  const checkoutReconcileInFlightRef = useRef(false)
  const checkoutReconcilePlanRef = useRef<Exclude<PlanId, "free"> | null>(null)
  const checkoutReconcileAttemptsRef = useRef(0)
  const paidConversionGenerationRef = useRef(0)
  const restoreInFlightRef = useRef(false)
  const restoreGenerationRef = useRef<number | null>(null)
  const trashGenerationByRequestRef = useRef(new Map<string, number>())
  const trashTimeoutByRequestRef = useRef(new Map<string, number>())
  const restoreTimeoutByRequestRef = useRef(new Map<string, number>())
  const pendingProviderRetrievalsRef = useRef(
    new Map<string, PendingProviderRetrieval>()
  )
  const [undoData, setUndoDataState] = useState<TrashUndoData | null>(null)
  const undoDataRef = useRef<TrashUndoData | null>(null)

  const setTrashConfirmSafely = useCallback(
    (next: SetStateAction<DuplicateTrashPlan | null>) => {
      const resolved =
        typeof next === "function" ? next(trashConfirmRef.current) : next
      trashConfirmRef.current = resolved
      setTrashConfirmState(resolved)
    },
    []
  )

  const setTrashWarningSafely = useCallback(
    (next: SetStateAction<string | null>) => {
      const resolved =
        typeof next === "function" ? next(trashWarningRef.current) : next
      trashWarningRef.current = resolved
      setTrashWarningState(resolved)
    },
    []
  )

  const setUndoDataSafely = useCallback(
    (next: SetStateAction<TrashUndoData | null>) => {
      const resolved =
        typeof next === "function" ? next(undoDataRef.current) : next
      undoDataRef.current = resolved
      setUndoDataState(resolved)
    },
    []
  )

  const setRecoveryHistorySafely = useCallback(
    (next: RecoveryHistoryRecord[]) => {
      recoveryHistoryRef.current = next
      setRecoveryHistoryState(next)
    },
    []
  )

  const isRestoreRequestCurrent = useCallback(
    (request: {
      generation: number
      provider: PhotoProvider
      accountEmail?: string
      providerSessionId: string
    }) => {
      const currentProvider = settingsRef.current.sourceProvider ?? "google"
      const sameIdentityProvider =
        currentIdentityProviderRef.current === request.provider
      const currentSessionId = sameIdentityProvider
        ? currentProviderSessionIdRef.current
        : undefined
      const currentEmail = sameIdentityProvider
        ? currentAccountEmailRef.current
        : undefined
      const expectedEmail = request.accountEmail?.trim().toLowerCase()
      return (
        request.generation === paidConversionGenerationRef.current &&
        restoreGenerationRef.current === request.generation &&
        request.provider === currentProvider &&
        sameIdentityProvider &&
        accountValidationCompleteRef.current &&
        currentHasGptkRef.current &&
        Boolean(request.providerSessionId) &&
        currentSessionId === request.providerSessionId &&
        (request.provider !== "google" ||
          (Boolean(expectedEmail) &&
            currentEmail?.trim().toLowerCase() === expectedEmail))
      )
    },
    []
  )

  const persistRestoreStatusSafely = useCallback(
    async (
      operationId: string,
      params: RecoveryRestoreStatusUpdate
    ) => {
      const requestId = params.requestId
      const restoreRequest = requestId
        ? restoreRequestByIdRef.current.get(requestId)
        : undefined
      if (
        !requestId ||
        !restoreRequest ||
        restoreRequest.operationId !== operationId ||
        !restoreRequest.providerSessionId
      ) {
        throw new Error("Restore update has no matching live request binding.")
      }
      const records = await requestRecoveryHistoryTransaction({
        kind: "updateRestore",
        operationId,
        requestId,
        provider: restoreRequest.provider,
        providerSessionId: restoreRequest.providerSessionId,
        ...(restoreRequest.accountEmail
          ? { accountEmail: restoreRequest.accountEmail }
          : {}),
        params
      })
      setRecoveryHistorySafely(records)
      return records
    },
    [setRecoveryHistorySafely]
  )

  const persistRestoreDispatchIntentSafely = useCallback(
    async (operationId: string, requestId: string, dedupKeys: string[]) => {
      const restoreRequest = restoreRequestByIdRef.current.get(requestId)
      if (
        !restoreRequest ||
        restoreRequest.operationId !== operationId ||
        !restoreRequest.providerSessionId
      ) {
        throw new Error("Restore intent has no matching provider request binding.")
      }
      const records = await requestRecoveryHistoryTransaction({
        kind: "beginRestore",
        requestId,
        operationId,
        provider: restoreRequest.provider,
        providerSessionId: restoreRequest.providerSessionId,
        ...(restoreRequest.accountEmail
          ? { accountEmail: restoreRequest.accountEmail }
          : {}),
        targetDedupKeys: dedupKeys
      })
      setRecoveryHistorySafely(records)
      if (
        !hasDurableRestoreIntent(records, operationId, requestId, dedupKeys)
      ) {
        throw new Error(
          "The exact per-target restore guard could not be verified in recovery storage."
        )
      }
      return records
    },
    [setRecoveryHistorySafely]
  )

  const setUpgradePromptSafely = useCallback(
    (next: UpgradePromptState | null) => {
      upgradePromptRef.current = next
      setUpgradePrompt(next)
    },
    []
  )

  const setRatingPromptSafely = useCallback((open: boolean) => {
    ratingPromptOpenRef.current = open
    setRatingPromptOpen(open)
  }, [])

  const maybeShowDeferredRatingPrompt = useCallback(() => {
    if (!ratingPromptDeferredRef.current || ratingPromptOpenRef.current) {
      return
    }
    if (
      upgradePromptRef.current ||
      checkoutStateRef.current.status === "pending" ||
      checkoutStateRef.current.status === "refreshing" ||
      trashConfirmRef.current ||
      trashWarningRef.current ||
      undoDataRef.current ||
      restoreInFlightRef.current || restoreCommitInFlightRef.current
    ) {
      return
    }
    ratingPromptDeferredRef.current = false
    setRatingPromptSafely(true)
  }, [setRatingPromptSafely])

  useEffect(() => {
    maybeShowDeferredRatingPrompt()
  }, [
    checkoutState,
    maybeShowDeferredRatingPrompt,
    trashConfirm,
    trashWarning,
    undoData,
    upgradePrompt
  ])

  const setCheckoutStateSafely = useCallback(
    (
      next:
        | CheckoutReturnState
        | ((current: CheckoutReturnState) => CheckoutReturnState)
    ) => {
      const resolved =
        typeof next === "function" ? next(checkoutStateRef.current) : next
      checkoutStateRef.current = resolved
      setCheckoutState(resolved)
    },
    []
  )

  const invalidatePaidConversionContext = useCallback(() => {
    paidConversionGenerationRef.current += 1
    paidAccessLifecycleRef.current?.invalidateCheckoutContext()
    trashLifecycleRef.current?.reset()
    checkoutPlanRef.current = null
    checkoutReconcilePlanRef.current = null
    checkoutReconcileAttemptsRef.current = 0
    checkoutStartInFlightRef.current = false
    checkoutReconcileInFlightRef.current = false
    restoreInFlightRef.current = restoreCommitInFlightRef.current
    restoreGenerationRef.current = null
    for (const timeoutId of trashTimeoutByRequestRef.current.values()) {
      window.clearTimeout(timeoutId)
    }
    trashTimeoutByRequestRef.current.clear()
    for (const timeoutId of restoreTimeoutByRequestRef.current.values()) {
      window.clearTimeout(timeoutId)
    }
    restoreTimeoutByRequestRef.current.clear()
    restoreRequestByIdRef.current.clear()
    trashGenerationByRequestRef.current.clear()
    deferredUpgradeRef.current = null
    upgradePromptRef.current = null
    ratingPromptOpenRef.current = false
    ratingPromptDeferredRef.current = false
    checkoutStateRef.current = { status: "idle" }
    setDeferredUpgrade(null)
    setTrashConfirmSafely(null)
    setTrashWarningSafely(null)
    setUndoDataSafely(null)
    setUpgradePrompt(null)
    setRatingPromptOpen(false)
    setCheckoutState({ status: "idle" })
  }, [])
  const [licenseApiBaseUrl, setLicenseApiBaseUrl] = useState<
    string | undefined
  >()
  const [photoDataConsent, setPhotoDataConsent] = useState<boolean | null>(null)
  const [analyticsConsent, setAnalyticsConsent] = useState<boolean | null>(null)
  const analyticsConsentRef = useRef<boolean | null>(null)
  const analyticsConsentGenerationRef = useRef(0)
  analyticsConsentRef.current = analyticsConsent
  const appOpenedTrackedRef = useRef(false)
  const paidAccessLifecycleRef = useRef<PaidAccessLifecycle | null>(null)
  if (!paidAccessLifecycleRef.current) {
    paidAccessLifecycleRef.current = new PaidAccessLifecycle({
      async load() {
        const [stored, licenseConfig] = await Promise.all([
          loadStoredEntitlement(),
          chrome.storage.local.get(LICENSE_API_BASE_STORAGE_KEY)
        ])
        return {
          stored,
          apiBaseUrl: getEffectiveLicenseApiBaseUrl(
            licenseConfig[LICENSE_API_BASE_STORAGE_KEY] as string | undefined
          )
        }
      },
      saveVerifiedToken: saveVerifiedEntitlementToken,
      createClient: (apiBaseUrl) => new LicenseClient({ apiBaseUrl })
    })
  }
  const paidAccessLifecycle = paidAccessLifecycleRef.current
  const providerReviewStorageRef = useRef<ProviderScopedReviewStorage | null>(
    null
  )
  if (!providerReviewStorageRef.current) {
    providerReviewStorageRef.current = new ProviderScopedReviewStorage(
      {
        async get(keys) {
          return chrome.storage.local.get(keys)
        },
        async set(values) {
          await chrome.storage.local.set(values)
        },
        async remove(keys) {
          await chrome.storage.local.remove(keys)
        }
      },
      {
        getHostProvider: () => sidePanelHostProviderRef.current,
        getActiveProvider: () =>
          settingsRef.current.sourceProvider ?? "google"
      }
    )
  }
  const providerReviewStorage = providerReviewStorageRef.current
  const storedReviewScopeRef = useRef<StoredReviewScope | null>(null)
  if (!storedReviewScopeRef.current) {
    storedReviewScopeRef.current = new StoredReviewScope(
      providerReviewStorage
    )
  }
  const storedReviewScope = storedReviewScopeRef.current

  const prefersReducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    let cancelled = false
    Promise.all([
      paidAccessLifecycle.initialize(),
      chrome.storage.local.get([
        ANALYTICS_CONSENT_STORAGE_KEY,
        PHOTO_DATA_CONSENT_STORAGE_KEY
      ])
    ])
      .then(([access, privacyConfig]) => {
        if (cancelled) return
        setEntitlement(access.entitlement)
        setLicenseApiBaseUrl(access.apiBaseUrl)
        const storedConsent = privacyConfig[ANALYTICS_CONSENT_STORAGE_KEY]
        setPhotoDataConsent(
          privacyConfig[PHOTO_DATA_CONSENT_STORAGE_KEY] === true
        )
        setAnalyticsConsent(
          typeof storedConsent === "boolean" ? storedConsent : null
        )
        setEntitlementLoaded(true)
      })
      .catch(() => {
        if (!cancelled) {
          setEntitlement({ planId: "free", active: true, source: "none" })
          setLicenseApiBaseUrl(getEffectiveLicenseApiBaseUrl())
          setPhotoDataConsent(false)
          setEntitlementLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [paidAccessLifecycle])

  const openUpgradePrompt = useCallback(
    (
      reason: UpgradeReason,
      detail?: string,
      valueFacts?: UpgradeValueFacts
    ) => {
      if (ratingPromptOpenRef.current) {
        ratingPromptDeferredRef.current = true
        setRatingPromptSafely(false)
      }
      if (checkoutStateRef.current.status === "active") {
        setCheckoutStateSafely({ status: "idle" })
      }
      setUpgradePromptSafely({ reason, detail, valueFacts })
    },
    [setCheckoutStateSafely, setRatingPromptSafely, setUpgradePromptSafely]
  )

  const trackEvent = useCallback(
    (event: PrivacySafeAnalyticsEvent) => {
      if (analyticsConsentRef.current !== true || !licenseApiBaseUrl) return
      const consentGeneration = analyticsConsentGenerationRef.current
      const dayKey = utcDayKey()
      const safeEvent = {
        ...event,
        provider:
          event.provider ?? settingsRef.current.sourceProvider ?? "google",
        scanMode: event.scanMode ?? settingsRef.current.scanMode,
        planId: event.planId ?? getEffectivePlanId(entitlement)
      }
      if (!installIdPromiseRef.current) {
        installIdPromiseRef.current = getOrCreateInstallId()
      }
      void installIdPromiseRef.current
        .then((installId) =>
          analyticsConsentRef.current !== true || consentGeneration !== analyticsConsentGenerationRef.current ? false : sendPrivacySafeAnalyticsEvent(licenseApiBaseUrl, {
            ...safeEvent,
            installId,
            extensionVersion: extensionVersionForAnalytics(),
            dayKey
          })
        )
        .catch(() => {
          // Analytics is optional; never interrupt scan, report, or Trash flows.
        })
    },
    [analyticsConsent, entitlement, licenseApiBaseUrl]
  )

  useEffect(() => {
    const provider = providerConnectionTrackerRef.current.connectionForConsent(
      analyticsConsent === true && Boolean(licenseApiBaseUrl)
    )
    if (provider) trackEvent({ name: "provider_connected", provider })
  }, [analyticsConsent, licenseApiBaseUrl, trackEvent])

  const saveAnalyticsConsent = useCallback((allowed: boolean) => {
    if (!allowed) analyticsConsentGenerationRef.current += 1
    analyticsConsentRef.current = allowed
    setAnalyticsConsent(allowed)
    void chrome.storage.local.set({
      [ANALYTICS_CONSENT_STORAGE_KEY]: allowed
    })
  }, [])

  const resetAnalyticsConsent = useCallback(() => {
    analyticsConsentGenerationRef.current += 1
    analyticsConsentRef.current = null
    setAnalyticsConsent(null)
    void chrome.storage.local.remove(ANALYTICS_CONSENT_STORAGE_KEY)
  }, [])

  const acceptPhotoDataConsent = useCallback(() => {
    setPhotoDataConsent(true)
    void chrome.storage.local.set({ [PHOTO_DATA_CONSENT_STORAGE_KEY]: true })
  }, [])

  useEffect(() => {
    if (!entitlementLoaded || analyticsConsent !== true) return
    if (appOpenedTrackedRef.current) return
    appOpenedTrackedRef.current = true
    trackEvent({ name: "app_opened" })
  }, [analyticsConsent, entitlementLoaded, trackEvent])

  useEffect(() => {
    if (!entitlementLoaded || !licenseApiBaseUrl) return
    let cancelled = false
    void paidAccessLifecycle
      .refreshStoredTokenOnce()
      .then((refreshed) => {
        if (cancelled || !refreshed) return
        setEntitlement(refreshed.stored.entitlement)
        trackEvent({
          name: "entitlement_refreshed",
          planId: getEffectivePlanId(refreshed.stored.entitlement)
        })
      })
      .catch(() => {
        trackEvent({ name: "error", errorCategory: "license_refresh" })
      })
    return () => {
      cancelled = true
    }
  }, [entitlementLoaded, licenseApiBaseUrl, paidAccessLifecycle, trackEvent])

  const openTrackedUpgradePrompt = useCallback(
    (
      reason: UpgradeReason,
      detail?: string,
      valueFacts?: UpgradeValueFacts
    ) => {
      trackEvent({ name: "upgrade_prompt_shown", upgradeReason: reason })
      openUpgradePrompt(reason, detail, valueFacts)
    },
    [openUpgradePrompt, trackEvent]
  )

  const reconcileCheckoutOnReturn = useCallback(async () => {
    const pendingPlan = checkoutPlanRef.current
    const generation = paidConversionGenerationRef.current
    if (!pendingPlan || checkoutReconcileInFlightRef.current) return
    if (checkoutReconcilePlanRef.current !== pendingPlan) {
      checkoutReconcilePlanRef.current = pendingPlan
      checkoutReconcileAttemptsRef.current = 0
    }
    const remainingAttempts = 6 - checkoutReconcileAttemptsRef.current
    if (remainingAttempts <= 0) return
    checkoutReconcileInFlightRef.current = true
    setCheckoutStateSafely((current) => ({
      ...current,
      status: "refreshing",
      planId: pendingPlan,
      message: "Checking the payment provider for a verified license..."
    }))
    try {
      const result = await paidAccessLifecycle.reconcileCheckoutReturn({
        planId: pendingPlan,
        maxAttempts: Math.min(3, remainingAttempts),
        initialDelayMs: 0,
        backoffMs: 500
      })
      if (
        generation !== paidConversionGenerationRef.current ||
        checkoutPlanRef.current !== pendingPlan
      ) {
        return
      }
      checkoutReconcileAttemptsRef.current += result.attempts
      const refreshedPlanId = result.stored
        ? getEffectivePlanId(result.stored.entitlement)
        : getEffectivePlanId(entitlement)
      if (result.stored) {
        setEntitlement(result.stored.entitlement)
        setEntitlementLoaded(true)
      }
      if (result.outcome === "activated" && result.stored) {
        checkoutPlanRef.current = null
        checkoutReconcilePlanRef.current = null
        checkoutReconcileAttemptsRef.current = 0
        setCheckoutStateSafely({
          status: "active",
          planId: pendingPlan,
          outcome: result.outcome,
          activation: result.activation,
          message: describePaidReturnOutcome(
            result.outcome,
            PLAN_LABELS[refreshedPlanId]
          )
        })
        setUpgradePromptSafely(null)
        setTrashWarningSafely(`${PLAN_LABELS[refreshedPlanId]} is active.`)
      } else {
        const mismatchMessage =
          refreshedPlanId !== "free" && refreshedPlanId !== pendingPlan
            ? `${PLAN_LABELS[refreshedPlanId]} is already active, but ${PLAN_LABELS[pendingPlan]} is not verified. Your review results remain available.`
            : undefined
        setCheckoutStateSafely({
          status: "retryable",
          planId: pendingPlan,
          outcome: result.outcome,
          activation: result.activation,
          message:
            mismatchMessage ??
            describePaidReturnOutcome(result.outcome, PLAN_LABELS[pendingPlan])
        })
      }
      trackEvent({
        name: "paid_return",
        planId: refreshedPlanId === "free" ? pendingPlan : refreshedPlanId,
        paidReturnOutcome: result.outcome,
        activationOutcome: result.activation
      })
    } catch (error) {
      if (
        generation !== paidConversionGenerationRef.current ||
        checkoutPlanRef.current !== pendingPlan
      ) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      checkoutReconcileAttemptsRef.current += 1
      setCheckoutStateSafely({
        status: "retryable",
        planId: pendingPlan,
        outcome: "failed",
        activation: "not_activated",
        message: `Could not verify payment yet: ${message}`
      })
      trackEvent({
        name: "paid_return",
        planId: pendingPlan,
        paidReturnOutcome: "failed",
        activationOutcome: "not_activated"
      })
    } finally {
      if (generation === paidConversionGenerationRef.current) {
        checkoutReconcileInFlightRef.current = false
      }
    }
  }, [
    entitlement,
    paidAccessLifecycle,
    setCheckoutStateSafely,
    setUpgradePromptSafely,
    trackEvent
  ])

  const handleRefreshEntitlement = useCallback(async () => {
    const pendingPlan = checkoutPlanRef.current
    if (pendingPlan) {
      await reconcileCheckoutOnReturn()
      return
    }
    const generation = paidConversionGenerationRef.current
    try {
      const refreshed = await paidAccessLifecycle.refresh()
      if (generation !== paidConversionGenerationRef.current) return
      const { stored } = refreshed
      setEntitlement(stored.entitlement)
      setEntitlementLoaded(true)
      const refreshedPlanId = getEffectivePlanId(stored.entitlement)
      trackEvent({
        name: "entitlement_refreshed",
        planId: refreshedPlanId
      })
      if (refreshed.recovery) {
        trackEvent({
          name:
            refreshed.recovery === "not_found"
              ? "restore_not_found"
              : "restore_completed",
          planId: refreshedPlanId
        })
      }
      setTrashWarningSafely(
        refreshedPlanId === "free"
          ? "No active paid license was found for this browser session."
          : `${PLAN_LABELS[refreshedPlanId]} is active.`
      )
      if (refreshedPlanId !== "free") setUpgradePromptSafely(null)
    } catch (error) {
      if (generation !== paidConversionGenerationRef.current) return
      if (error instanceof PaidAccessNotConfiguredError) {
        setTrashWarningSafely(
          "License refresh is not configured yet. Paid access will unlock once the Stripe license API is connected."
        )
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      setTrashWarningSafely(`Could not refresh license: ${message}`)
    }
  }, [
    paidAccessLifecycle,
    reconcileCheckoutOnReturn,
    setUpgradePromptSafely,
    trackEvent
  ])

  useEffect(() => {
    const handleReturnSignal = () => {
      if (document.visibilityState === "hidden") return
      void reconcileCheckoutOnReturn()
    }
    window.addEventListener("focus", handleReturnSignal)
    document.addEventListener("visibilitychange", handleReturnSignal)
    return () => {
      window.removeEventListener("focus", handleReturnSignal)
      document.removeEventListener("visibilitychange", handleReturnSignal)
    }
  }, [reconcileCheckoutOnReturn])

  const refreshTimeLimitedEntitlementForAction = useCallback(async () => {
    try {
      const authorized = await paidAccessLifecycle.authorizeAction()
      setEntitlement(authorized)
      setEntitlementLoaded(true)
      return authorized
    } catch (error) {
      if (error instanceof PaidAccessNotConfiguredError) {
        setTrashWarningSafely(
          "Cleanup Pass needs an online license refresh before paid actions. Connect to the internet and refresh your license."
        )
        return null
      }
      const message = error instanceof Error ? error.message : String(error)
      setTrashWarningSafely(`Could not refresh Cleanup Pass: ${message}`)
      return null
    }
  }, [paidAccessLifecycle])

  const handleChooseUpgradePlan = useCallback(
    async (planId: Exclude<PlanId, "free">) => {
      if (checkoutStartInFlightRef.current) return
      if (
        checkoutStateRef.current.status === "pending" ||
        checkoutStateRef.current.status === "refreshing"
      ) {
        return
      }
      const generation = paidConversionGenerationRef.current
      checkoutStartInFlightRef.current = true
      checkoutPlanRef.current = planId
      checkoutReconcilePlanRef.current = planId
      checkoutReconcileAttemptsRef.current = 0
      setCheckoutStateSafely({
        status: "pending",
        planId,
        message:
          "Opening secure checkout. Return here after payment so PhotoSweep can verify the license."
      })
      try {
        const checkout = await paidAccessLifecycle.createCheckout(planId)
        if (
          generation !== paidConversionGenerationRef.current ||
          checkoutPlanRef.current !== planId
        ) {
          return
        }
        trackEvent({
          name: "checkout_started",
          planId,
          upgradeReason: upgradePrompt?.reason
        })
        await chrome.tabs.create({ url: checkout.url })
        if (
          generation !== paidConversionGenerationRef.current ||
          checkoutPlanRef.current !== planId
        ) {
          return
        }
        setTrashWarningSafely(
          "Checkout opened in a new tab. Return here after payment; PhotoSweep will verify the license without changing your review."
        )
      } catch (error) {
        if (
          generation !== paidConversionGenerationRef.current ||
          checkoutPlanRef.current !== planId
        ) {
          return
        }
        checkoutPlanRef.current = null
        checkoutReconcilePlanRef.current = null
        checkoutReconcileAttemptsRef.current = 0
        if (error instanceof PaidAccessNotConfiguredError) {
          setCheckoutStateSafely({
            status: "failed",
            planId,
            outcome: "failed",
            activation: "not_activated",
            message: `${PLAN_LABELS[planId]} checkout is not configured yet.`
          })
          setTrashWarningSafely(
            `${PLAN_LABELS[planId]} checkout is not configured yet. The extension is enforcing free limits until the Stripe license API is connected.`
          )
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        setCheckoutStateSafely({
          status: "failed",
          planId,
          outcome: "failed",
          activation: "not_activated",
          message: `Could not start checkout: ${message}`
        })
        setTrashWarningSafely(`Could not start checkout: ${message}`)
      } finally {
        if (generation === paidConversionGenerationRef.current) {
          checkoutStartInFlightRef.current = false
        }
      }
    },
    [
      paidAccessLifecycle,
      setCheckoutStateSafely,
      trackEvent,
      upgradePrompt?.reason
    ]
  )

  const handleRecoverLicense = useCallback(
    async (email: string) => {
      try {
        await paidAccessLifecycle.recover(email)
      } catch (error) {
        if (error instanceof PaidAccessNotConfiguredError) {
          throw new Error(
            "License recovery is not configured until the Stripe license API is connected."
          )
        }
        throw error
      }
      trackEvent({ name: "restore_requested" })
    },
    [paidAccessLifecycle, trackEvent]
  )

  const handleOpenDeferredUpgrade = useCallback(() => {
    if (!deferredUpgrade) return
    const prompt = deferredUpgrade
    setDeferredUpgrade(null)
    openTrackedUpgradePrompt(prompt.reason, undefined, prompt.facts)
  }, [deferredUpgrade, openTrackedUpgradePrompt])

  const handleDismissDeferredUpgrade = useCallback(() => {
    if (!deferredUpgrade) return
    trackEvent({
      name: "upgrade_prompt_dismissed",
      upgradeReason: deferredUpgrade.reason,
      dismissalReason: "continue_free"
    })
    deferredUpgradeRef.current = null
    setDeferredUpgrade(null)
  }, [deferredUpgrade, trackEvent])

  const scanLifecycleRef = useRef(
    new ScanLifecycle({
      persist: (checkpoint) =>
        providerReviewStorage
          .set(
            { scanCheckpoint: checkpoint },
            checkpoint.settings.sourceProvider ?? "google"
          )
          .catch(() => {}),
      clear: (provider) =>
        providerReviewStorage
          .remove(
            ["scanCheckpoint"],
            provider ?? settingsRef.current.sourceProvider ?? "google"
          )
          .catch(() => {})
    })
  )
  const scanLifecycle = scanLifecycleRef.current
  const trashLifecycleRef = useRef<TrashLifecycle | null>(null)
  if (!trashLifecycleRef.current) {
    trashLifecycleRef.current = new TrashLifecycle({
      async savePreTrashReport(report, context) {
        await persistDeleteReport(report)
        downloadDeleteReport(report)
        if (!context) return
        const records = await requestRecoveryHistoryTransaction({
          kind: "createPendingTrash",
          report,
          context
        })
        setRecoveryHistorySafely(records)
      },
      async saveTrashResultReport(report, context) {
        try {
          downloadTrashResultReport(report)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          setReportError(
            `Could not download the trash result report: ${message}`
          )
        }
        try {
          await persistTrashResultReport(report)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          setReportError(`Could not save the trash result report: ${message}`)
        }
        if (context) {
          try {
            const records = await requestRecoveryHistoryTransaction({
              kind: "recordTrashResult",
              report,
              context
            })
            setRecoveryHistorySafely(records)
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error)
            setReportError(`Could not update recovery history: ${message}`)
          }
        }
      }
    })
  }
  const trashLifecycle = trashLifecycleRef.current

  // Persisted scan performance logger — survives page reloads via chrome.storage.local
  const scanLoggerRef = useRef(new ScanLogger())

  // Cached media items from previous scan, used to merge with incremental fetch
  const cachedMediaItemsRef = useRef<Record<string, GpdMediaItem> | null>(null)

  // Counts failed healthCheck attempts during initial connect so we can retry
  // silently before showing a disconnected error.
  const healthCheckAttemptsRef = useRef(0)
  const healthCheckRetryTimeoutRef = useRef<number | null>(null)
  const healthCheckRequestIdRef = useRef<string | null>(null)
  const healthCheckGenerationRef = useRef(0)
  const albumsRequestedForAccountRef = useRef<string | null>(null)
  const albumsRequestRef = useRef<{
    requestId: string
    provider: PhotoProvider
    identity: string
    accountEmail?: string
    providerSessionId?: string
  } | null>(null)
  const currentAccountEmailRef = useRef<string | undefined>(undefined)
  const currentProviderSessionIdRef = useRef<string | undefined>(undefined)
  const currentIdentityProviderRef = useRef<PhotoProvider | undefined>(
    undefined
  )
  const currentHasGptkRef = useRef(false)
  const sidePanelHostProviderRef = useRef<PhotoProvider | null>(null)
  const sidePanelHostTabIdRef = useRef<number | null>(null)

  const cancelHealthCheckRetry = useCallback(() => {
    const timeoutId = healthCheckRetryTimeoutRef.current
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
      healthCheckRetryTimeoutRef.current = null
    }
    healthCheckRequestIdRef.current = null
    healthCheckAttemptsRef.current = 0
  }, [])

  const sendHealthCheckAttempt = useCallback(
    (provider: PhotoProvider, attempt: number) => {
      const requestId = generateRequestId()
      healthCheckGenerationRef.current += 1
      healthCheckRequestIdRef.current = requestId
      healthCheckAttemptsRef.current = attempt
      sendToServiceWorker({
        app: APP_ID,
        action: "healthCheck",
        provider,
        requestId
      })
    },
    []
  )

  const requestHealthCheck = useCallback(
    (provider: PhotoProvider) => {
      cancelHealthCheckRetry()
      sendHealthCheckAttempt(provider, 1)
    },
    [cancelHealthCheckRetry, sendHealthCheckAttempt]
  )

  const scheduleHealthCheckRetry = useCallback(
    (plan: ReturnType<typeof planHealthCheckRetry>) => {
      if (!plan) return
      cancelHealthCheckRetry()
      healthCheckRetryTimeoutRef.current = window.setTimeout(() => {
        healthCheckRetryTimeoutRef.current = null
        sendHealthCheckAttempt(plan.provider, plan.attempt)
      }, plan.delayMs)
    },
    [cancelHealthCheckRetry, sendHealthCheckAttempt]
  )

  // Holds selections loaded from storage; applied once when groups first load.
  const pendingSelectionsRef = useRef<PendingSelections | null>(null)
  // Fresh scans start with neutral review decisions. Mutations like trash/undo
  // also keep newly remaining groups neutral so no real-photo cleanup choice is
  // made without an explicit review action.
  const autoSelectNextResultsRef = useRef(false)

  const refreshEmbeddingCacheCount = useCallback(async () => {
    let cache: EmbeddingCache | null = null
    try {
      cache = await EmbeddingCache.open()
      setCacheEntryCount(await cache.count())
    } catch {
      setCacheEntryCount(null)
    } finally {
      cache?.close()
    }
  }, [])

  const requestAlbums = useCallback(
    (accountEmail?: string) => {
      if (photoDataConsent !== true) return
      const provider = settingsRef.current.sourceProvider ?? "google"
      if (
        getProviderOperations(provider).capabilities.albumScope !== "supported"
      ) {
        setAlbums([])
        setAlbumsLoading(false)
        setAlbumsError(null)
        albumsRequestedForAccountRef.current = null
        albumsRequestRef.current = null
        return
      }
      const providerSessionId = currentProviderSessionIdRef.current
      const googleAccountEmail =
        provider === "google"
          ? (accountEmail || currentAccountEmailRef.current || "").trim()
          : undefined
      if (
        provider === "google" &&
        (!googleAccountEmail ||
          !currentAccountEmailRef.current ||
          googleAccountEmail.toLowerCase() !==
            currentAccountEmailRef.current.trim().toLowerCase() ||
          !providerSessionId)
      ) {
        albumsRequestRef.current = null
        albumsRequestedForAccountRef.current = null
        setAlbums([])
        setAlbumsLoading(false)
        setAlbumsError(
          "The Google Photos account and page session could not be verified. Reconnect and refresh the album list."
        )
        return
      }
      const identity =
        provider === "google"
          ? googleAlbumIdentityKey(googleAccountEmail, providerSessionId)
          : providerSessionId || "__unknown__"
      const key = `${provider}:${identity}`
      albumsRequestedForAccountRef.current = key
      setAlbumsLoading(true)
      setAlbumsError(null)
      const requestId = generateRequestId()
      albumsRequestRef.current = {
        requestId,
        provider,
        identity,
        ...(googleAccountEmail ? { accountEmail: googleAccountEmail } : {}),
        ...(providerSessionId ? { providerSessionId } : {})
      }
      sendToServiceWorker({
        app: APP_ID,
        action: "gptkCommand",
        command: "listAlbums",
        requestId,
        provider,
        ...(provider === "google"
          ? { args: { accountEmail: googleAccountEmail, providerSessionId } }
          : providerSessionId
            ? { args: { providerSessionId } }
            : {})
      })
    },
    [photoDataConsent]
  )

  const handleTrashProviderResult = useCallback(
    (result: GptkResultMessage) => {
      const timeoutId = trashTimeoutByRequestRef.current.get(result.requestId)
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
        trashTimeoutByRequestRef.current.delete(result.requestId)
      }
      const generation = trashGenerationByRequestRef.current.get(
        result.requestId
      )
      trashGenerationByRequestRef.current.delete(result.requestId)
      if (
        generation === undefined ||
        generation !== paidConversionGenerationRef.current
      ) {
        return
      }
      void trashLifecycle
        .reconcile({
          requestId: result.requestId,
          success: result.success,
          data: result.data as TrashProviderResultData | undefined,
          error: result.error
        })
        .then((outcome) => {
          if (generation !== paidConversionGenerationRef.current) return
          for (const event of trashOutcomeAnalytics(outcome)) {
            trackEvent({ ...event, provider: result.provider })
          }
          if (outcome.kind === "dry_run") {
            dispatch({ type: "TRASH_COMPLETE", trashedKeys: [] })
            setTrashWarningSafely(outcome.message)
            return
          }
          if (outcome.kind === "failed") {
            dispatch({ type: "TRASH_ERROR", error: outcome.error })
            return
          }
          if (outcome.kind === "unknown") {
            const message = `${outcome.error} Confirmed failures: ${outcome.failedDedupKeys.length.toLocaleString()}; not dispatched: ${outcome.notDispatchedDedupKeys.length.toLocaleString()}.`
            dispatch({ type: "TRASH_ERROR", error: message })
            setTrashWarningSafely(message)
            return
          }

          dispatch({
            type: "TRASH_COMPLETE",
            trashedKeys: outcome.movedMediaKeys
          })
          setTrashMovesThisSession((count) => count + outcome.movedCount)
          setUndoDataSafely(outcome.undo)
          if (outcome.message) setTrashWarningSafely(outcome.message)
          void recordSuccessfulCleanup(
            outcome.kind === "complete" ? outcome.movedCount : 0
          )
            .then((shouldPrompt) => {
              if (!shouldPrompt) return
              if (generation !== paidConversionGenerationRef.current) return
              if (restoreInFlightRef.current) return
              ratingPromptDeferredRef.current = true
              maybeShowDeferredRatingPrompt()
            })
            .catch(() => {
              // A storage failure must never interrupt the cleanup result.
            })
        })
        .catch((error) => {
          if (generation !== paidConversionGenerationRef.current) return
          const message = error instanceof Error ? error.message : String(error)
          trackEvent({ name: "error", provider: result.provider, errorCategory: "trash" })
          setReportError(`Could not reconcile the trash result: ${message}`)
          dispatch({ type: "TRASH_ERROR", error: message })
        })
    },
    [
      maybeShowDeferredRatingPrompt,
      setUndoDataSafely,
      setTrashWarningSafely,
      trackEvent,
      trashLifecycle
    ]
  )

  const handleRestoreProviderResult = useCallback(
    async (result: GptkResultMessage) => {
      const restoreRequest = restoreRequestByIdRef.current.get(result.requestId)
      if (
        !restoreRequest ||
        result.command !== "restoreItems" ||
        result.provider !== restoreRequest.provider ||
        result.providerSessionId !== restoreRequest.providerSessionId ||
        !isRestoreRequestCurrent(restoreRequest)
      ) {
        return
      }
      const timeoutId = restoreTimeoutByRequestRef.current.get(result.requestId)
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
        restoreTimeoutByRequestRef.current.delete(result.requestId)
      }
      const restoreData = (result.data ?? {}) as {
        restoredDedupKeys?: unknown
        outcomes?: unknown
        notDispatchedDedupKeys?: unknown
      }
      const restoreOutcome = trashLifecycle.reconcileRestore({
        requestId: result.requestId,
        success: result.success,
        restoredDedupKeys: restoreData.restoredDedupKeys,
        outcomes: restoreData.outcomes,
        notDispatchedDedupKeys: restoreData.notDispatchedDedupKeys,
        error: result.error
      })
      if (restoreOutcome === undefined) return
      for (const event of restoreOutcomeAnalytics(restoreOutcome)) {
        trackEvent({ ...event, provider: restoreRequest.provider })
      }
      if (!restoreRequest.operationId) {
        restoreCommitInFlightRef.current = true
        setReportError(
          "The provider returned a restore result without a durable recovery record. Keep this tab open and verify the provider Trash state before another restore."
        )
        return
      }
      restoreCommitInFlightRef.current = true
      try {
        const records = await persistRestoreStatusSafely(
          restoreRequest.operationId,
          {
          outcome: restoreOutcome.kind,
          requestId: result.requestId,
          terminal: true,
          restoredDedupKeys: restoreOutcome.restoredDedupKeys,
          outcomes: restoreOutcome.outcomes,
          notDispatchedDedupKeys: restoreOutcome.notDispatchedDedupKeys,
          ...(restoreOutcome.kind !== "complete"
            ? { unknownDedupKeys: restoreOutcome.unknownDedupKeys }
            : {}),
          ...(restoreOutcome.kind !== "complete"
            ? { error: restoreOutcome.error }
            : {})
          }
        )
        const savedRecord = records.find(
          (record) => record.operationId === restoreRequest.operationId
        )
        restoreRequestByIdRef.current.delete(result.requestId)
        setRecoveryHistoryBusyId(null)
        restoreGenerationRef.current = null
        restoreInFlightRef.current = false
        restoreCommitInFlightRef.current = false
        if (
          restoreOutcome.kind === "complete" &&
          savedRecord?.status === "restored"
        ) {
          if (restoreRequest.history) resetReviewRef.current()
          setTrashWarningSafely(
            "Provider restore completed. Run a new scoped scan to verify the library state."
          )
        } else if (
          restoreOutcome.kind === "complete" &&
          savedRecord?.status === "restore_unknown"
        ) {
          setTrashWarningSafely(
            `This restore response confirmed its requested targets, but ${savedRecord.restoreUnknownCount ?? 0} earlier ambiguous target(s) remain unresolved in recovery history.`
          )
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        restoreRequestByIdRef.current.delete(result.requestId)
        setReportError(`Could not update recovery history: ${message}`)
        setTrashWarningSafely(
          "The provider returned a terminal restore result, but its final outcome could not be saved. The durable pre-dispatch guard remains in recovery history, so these targets will stay protected as ambiguous after reload. This tab is keeping restore actions locked until you reload and review that guard."
        )
        // The previously saved provisional intent is the durable no-replay
        // marker. Keep the current app locked because the terminal write failed.
        restoreInFlightRef.current = true
        restoreCommitInFlightRef.current = true
        return
      }
      if (restoreOutcome.kind !== "complete") {
        console.error("GPD: Restore incomplete:", restoreOutcome.error)
        setUndoDataSafely(
          restoreOutcome.undo.count > 0 ? restoreOutcome.undo : null
        )
        setTrashWarningSafely(
          restoreOutcome.kind === "partial"
            ? `Restore partially completed: ${restoreOutcome.error}${restoreOutcome.unknownDedupKeys.length > 0 ? ` ${restoreOutcome.unknownDedupKeys.length.toLocaleString()} ambiguous target${restoreOutcome.unknownDedupKeys.length === 1 ? " was" : "s were"} removed from retry.` : ""}`
            : restoreOutcome.kind === "unknown"
              ? `Restore outcome is unknown for ${restoreOutcome.unknownDedupKeys.length.toLocaleString()} target${restoreOutcome.unknownDedupKeys.length === 1 ? "" : "s"}; those targets will not be retried. Verify their state with the provider. ${restoreOutcome.error}`
              : `Restore failed: ${restoreOutcome.error}`
        )
      }
    },
    [
      isRestoreRequestCurrent,
      persistRestoreStatusSafely,
      setTrashWarningSafely,
      setUndoDataSafely,
      trackEvent,
      trashLifecycle
    ]
  )

  const handleRestoreTimeout = useCallback(
    (requestId: string, generation: number) => {
      if (generation !== paidConversionGenerationRef.current) return
      const outcome = trashLifecycle.timeoutRestore({ requestId })
      if (!outcome) return
      trackEvent({ name: "error", errorCategory: "undo" })
      const restoreRequest = restoreRequestByIdRef.current.get(requestId)
      if (
        restoreRequest?.operationId &&
        isRestoreRequestCurrent(restoreRequest)
      ) {
        void persistRestoreStatusSafely(restoreRequest.operationId, {
          outcome: outcome.kind,
          requestId,
          terminal: false,
          restoredDedupKeys: outcome.restoredDedupKeys,
          outcomes: outcome.outcomes,
          notDispatchedDedupKeys: outcome.notDispatchedDedupKeys,
          ...(outcome.kind !== "complete"
            ? { unknownDedupKeys: outcome.unknownDedupKeys }
            : {}),
          ...(outcome.kind !== "complete" ? { error: outcome.error } : {})
        })
          .then(() => {
            const unknownCount =
              outcome.kind === "complete" ? 0 : outcome.unknownDedupKeys.length
            setTrashWarningSafely(
              `The provider has not returned a terminal restore result. ${outcome.restoredDedupKeys.length.toLocaleString()} target(s) are confirmed restored; ${unknownCount.toLocaleString()} remain ambiguous and will not be retried. Keep this PhotoSweep tab open for a late result. If none arrives, reconnect and verify the provider Trash state before taking another action; reloading preserves the unknown targets without replaying them.`
            )
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            setReportError(`Could not save the restore timeout: ${message}`)
            setTrashWarningSafely(
              "The provider has not returned a terminal restore result, and the latest progress could not be saved. The durable pre-dispatch guard remains in recovery history, so every requested target will still be protected as ambiguous after reload. Keep this tab open for a late result; do not retry these targets."
            )
          })
      } else {
        setTrashWarningSafely(
          "The provider has not returned a terminal restore result. The durable pre-dispatch guard protects its requested targets from automatic retry; reconnect and verify their provider state before taking another action."
        )
      }
    },
    [
      isRestoreRequestCurrent,
      persistRestoreStatusSafely,
      setTrashWarningSafely,
      trackEvent,
    trashLifecycle
    ]
  )

  const scheduleRestoreTimeout = useCallback(
    (requestId: string, generation: number) => {
      const timeoutId = window.setTimeout(() => {
        restoreTimeoutByRequestRef.current.delete(requestId)
        handleRestoreTimeout(requestId, generation)
      }, TRASH_REQUEST_TIMEOUT_MS)
      restoreTimeoutByRequestRef.current.set(requestId, timeoutId)
    },
    [handleRestoreTimeout]
  )

  const clearProviderRetrieval = useCallback(
    (requestId: string, pending: PendingProviderRetrieval) => {
      window.clearTimeout(pending.timeoutId)
      pending.signal.removeEventListener("abort", pending.abortListener)
      if (pendingProviderRetrievalsRef.current.get(requestId) === pending) {
        pendingProviderRetrievalsRef.current.delete(requestId)
      }
    },
    []
  )

  const cancelProviderRetrieval = useCallback(
    (
      requestId: string,
      pending: PendingProviderRetrieval,
      error: Error
    ) => {
      clearProviderRetrieval(requestId, pending)
      void sendToServiceWorker({
        app: APP_ID,
        action: "gptkCommand",
        command: "cancelProviderRequest",
        requestId: generateRequestId(),
        provider: pending.provider,
        args: {
          targetRequestId: requestId,
          providerSessionId: pending.providerSessionId,
          scanScopeFingerprint: pending.scanScopeFingerprint
        }
      }).catch(() => {})
      pending.reject(error)
    },
    [clearProviderRetrieval, dispatch]
  )

  const handleProviderRetrievalResult = useCallback(
    (result: GptkResultMessage) => {
      const pending = pendingProviderRetrievalsRef.current.get(result.requestId)
      if (!pending) return
      clearProviderRetrieval(result.requestId, pending)

      if (
        !isProviderRetrievalResponseBound(result, {
          command: pending.command,
          provider: pending.provider
        })
      ) {
        pending.reject(
          new Error(
            "The provider response did not match the requested item operation. The item remains unverified."
          )
        )
        return
      }

      const current = stateRef.current
      const currentResults = current.status === "results" ? current : null
      const currentProvider = settingsRef.current.sourceProvider ?? "google"
      const currentProviderSessionId =
        currentIdentityProviderRef.current === currentProvider
          ? currentProviderSessionIdRef.current
          : undefined
      const currentAccountEmail =
        currentIdentityProviderRef.current === currentProvider
          ? currentAccountEmailRef.current
          : undefined
      const contextIsCurrent =
        currentResults !== null &&
        !pending.signal.aborted &&
        currentResults.sourceProvider === pending.provider &&
        (pending.provider !== "google" ||
          pending.accountEmail === currentResults.accountEmail) &&
        isProviderRetrievalBindingCurrent({
          status: current.status,
          provider: pending.provider,
          currentProvider,
          scannedProviderSessionId: currentResults?.providerSessionId,
          currentProviderSessionId,
          scannedAccountEmail: currentResults?.accountEmail,
          currentAccountEmail,
          scannedScopeFingerprint: pending.scanScopeFingerprint,
          currentScopeFingerprint: currentResults?.scopeFingerprint,
          item: {
            mediaKey: pending.mediaKey,
            dedupKey: pending.dedupKey,
            provider: pending.provider
          },
          scannedMediaItems:
            currentResults ? Object.values(currentResults.mediaItems) : []
        })

      if (!contextIsCurrent) {
        pending.reject(
          new Error(
            "The provider account, page session, or review scope changed during retrieval. The item remains unverified."
          )
        )
        return
      }
      if (result.providerSessionId !== pending.providerSessionId) {
        pending.reject(
          new Error(
            "The provider returned a result from a different page session. The item remains unverified."
          )
        )
        return
      }
      if (!result.success) {
        pending.reject(new Error(safeProviderRetrievalError(result.error)))
        return
      }

      try {
        const expected = {
          mediaKey: pending.mediaKey,
          scopeFingerprint: pending.scanScopeFingerprint,
          ...(current.status === "results" &&
          (current.mediaItems[pending.mediaKey]?.mediaKind === "photo" ||
            current.mediaItems[pending.mediaKey]?.mediaKind === "video" ||
            current.mediaItems[pending.mediaKey]?.mediaKind === "live-photo")
            ? { mediaKind: current.mediaItems[pending.mediaKey]!.mediaKind }
            : {})
        }
        if (pending.command === "getOriginalContentHash") {
          const verified = validateOriginalContentHashResult(
            result.data,
            expected
          )
          dispatch({
            type: "ORIGINAL_HASH_VERIFIED",
            provider: pending.provider,
            providerSessionId: pending.providerSessionId,
            ...(pending.accountEmail
              ? { accountEmail: pending.accountEmail }
              : currentResults?.accountEmail
                ? { accountEmail: currentResults.accountEmail }
                : {}),
            scopeFingerprint: pending.scanScopeFingerprint,
            mediaKey: pending.mediaKey,
            dedupKey: pending.dedupKey,
            contentHash: verified.contentHash,
            byteLength: verified.byteLength,
            ...(verified.mimeType ? { mimeType: verified.mimeType } : {})
          })
          pending.resolve(verified)
        } else {
          pending.resolve(
            validateVideoPlaybackResult(pending.provider, result.data, expected)
          )
        }
      } catch (error) {
        pending.reject(new Error(safeProviderRetrievalError(error)))
      }
    },
    [clearProviderRetrieval, dispatch]
  )

  const patchScanCheckpoint = useCallback(
    (patch: Parameters<ScanLifecycle["patch"]>[0]) => {
      scanLifecycle.patch(patch)
    },
    [scanLifecycle]
  )

  const resultIdentityData =
    state.status === "results" || state.status === "trashing"
      ? {
          accountEmail: state.accountEmail,
          sourceProvider: state.sourceProvider,
          providerSessionId: state.providerSessionId
        }
      : null
  const resultProvider =
    resultIdentityData?.sourceProvider ??
    settings.sourceProvider ??
    "google"
  const resultIdentityProviderMatches =
    currentIdentityProviderRef.current === resultProvider
  const resultIdentityAccountEmail = resultIdentityProviderMatches
    ? currentAccountEmailRef.current
    : undefined
  const resultIdentitySessionId = resultIdentityProviderMatches
    ? currentProviderSessionIdRef.current
    : undefined
  const hasCurrentResultIdentity =
    resultIdentityProviderMatches &&
    (resultProvider === "google"
      ? Boolean(resultIdentityAccountEmail?.trim())
      : Boolean(resultIdentitySessionId?.trim()))
  const stateIdentityValidated = Boolean(
    accountValidationComplete &&
      resultIdentityData &&
      hasCurrentResultIdentity &&
      areScanResultsValid(resultIdentityData, {
        accountEmail: resultIdentityAccountEmail,
        sourceProvider: resultProvider,
        providerSessionId: resultIdentitySessionId
      })
  )

  // Sync selectedGroupIds when groups change (e.g. after scan or trash)
  const stateGroups =
    (state.status === "results" || state.status === "trashing") &&
    stateIdentityValidated
      ? state.groups
      : state.status === "scanning"
        ? state.partialGroups ?? null
        : null
  const groups = useMemo(() => stateGroups ?? [], [stateGroups])
  const displayMediaItems =
    (state.status === "results" || state.status === "trashing") &&
    stateIdentityValidated
      ? state.mediaItems
      : state.status === "scanning"
        ? state.partialMediaItems ?? {}
        : {}

  useEffect(() => {
    if (!isSidePanel || !chrome.runtime.connect) return

    const port = chrome.runtime.connect({ name: "gpd-side-panel" })
    let disposed = false
    const postReady = async () => {
      let activeTabId: number | undefined
      try {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true
        })
        if (
          activeTab?.id !== undefined &&
          !activeTab.url?.startsWith("chrome-extension://")
        ) {
          activeTabId = activeTab.id
          sidePanelHostTabIdRef.current = activeTab.id
        }
        const hostProvider = providerFromUrl(activeTab?.url)
        if (hostProvider) {
          sidePanelHostProviderRef.current = hostProvider
          setSidePanelSourceConfirmed(true)
          if (
            (settingsRef.current.sourceProvider ?? "google") !== hostProvider
          ) {
            reviewHydrationClosedRef.current = true
            scanReviewGenerationRef.current += 1
            providerConnectionTrackerRef.current.reset()
            invalidatePaidConversionContext()
            scanLifecycle.reset()
            cachedMediaItemsRef.current = null
            deferredUpgradeRef.current = null
            setDeferredUpgrade(null)
            pendingSelectionsRef.current = null
            setResumeCheckpoint(null)
            setSelectedGroupIds(new Set())
            setReviewedGroupIds(new Set())
            setKeptOverrides({})
            dispatch({ type: "RESET" })
            healthCheckAttemptsRef.current = 0
            const nextSettings = {
              ...settingsRef.current,
              sourceProvider: hostProvider,
              albumScope:
                settingsRef.current.sourceProvider === hostProvider
                  ? settingsRef.current.albumScope
                  : undefined
            }
            settingsRef.current = nextSettings
            setSettings({
              sourceProvider: hostProvider,
              albumScope: nextSettings.albumScope
            })
            void storedReviewScope.write({
              settings: nextSettings,
              checkpoint: null
            }, undefined, hostProvider)
          }
          if (photoDataConsent === true) {
            requestHealthCheck(hostProvider)
          }
        }
      } catch {
        // Best effort: older browsers can still use the action-click tab id.
      }
      if (disposed) return
      port.postMessage({
        app: APP_ID,
        action: "sidePanel.ready",
        clientId: APP_CLIENT_ID,
        activeTabId
      })
    }
    void postReady()

    return () => {
      disposed = true
      port.disconnect()
    }
  }, [
    invalidatePaidConversionContext,
    isSidePanel,
    photoDataConsent,
    requestHealthCheck,
    storedReviewScope
  ])

  useEffect(() => {
    if (state.status !== "results" || !stateIdentityValidated) return

    let selections = reviewSelectionsRef.current
    if (pendingSelectionsRef.current) {
      selections = pendingSelectionsRef.current
      pendingSelectionsRef.current = null
    } else if (autoSelectNextResultsRef.current) {
      autoSelectNextResultsRef.current = false
      selections = {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set(),
        keptOverrides: {}
      }
    }

    const strategy = settings.defaultKeepStrategy ?? "best_quality"
    const appliedSession = applyDefaultKeepStrategyToSession({
      groups,
      mediaItems: displayMediaItems,
      selections,
      strategy
    })
    const applied = appliedSession.selections
    reviewSessionRef.current = appliedSession
    reviewSelectionsRef.current = applied
    setReviewSelections(applied)

    void storedReviewScope.write(
      {
        selections: appliedSession.serialize()
      },
      undefined,
      resultProvider
    )
  }, [
    displayMediaItems,
    groups,
    settings.defaultKeepStrategy,
    resultProvider,
    settings.sourceProvider,
    state.status,
    stateIdentityValidated,
    storedReviewScope
  ])

  useEffect(() => {
    if (!accountValidationComplete || state.status !== "results") return
    const currentAccountEmail = currentAccountEmailRef.current
    const currentProvider = settingsRef.current.sourceProvider ?? "google"
    const identityMatchesProvider =
      currentIdentityProviderRef.current === currentProvider
    const providerAccountEmail = identityMatchesProvider
      ? currentAccountEmail
      : undefined
    const currentProviderSessionId = identityMatchesProvider
      ? currentProviderSessionIdRef.current
      : undefined
    const hasCurrentIdentity =
      currentProvider === "google"
        ? Boolean(providerAccountEmail)
        : Boolean(currentProviderSessionId)
    if (
      !hasCurrentIdentity ||
      areScanResultsValid(
        {
          accountEmail: state.accountEmail,
          sourceProvider: state.sourceProvider ?? currentProvider,
          providerSessionId: state.providerSessionId
        },
        {
          accountEmail: providerAccountEmail,
          sourceProvider: currentProvider,
          providerSessionId: currentProviderSessionId
        }
      )
    ) {
      return
    }
    invalidatePaidConversionContext()
    pendingSelectionsRef.current = null
    deferredUpgradeRef.current = null
    setDeferredUpgrade(null)
    setSelectedGroupIds(new Set())
    setReviewedGroupIds(new Set())
    setKeptOverrides({})
    void storedReviewScope.invalidateReview(
      () => true,
      undefined,
      currentProvider
    )
    dispatch({
      type: "HEALTH_CHECK_RESULT",
      payload: {
        app: APP_ID,
        action: "healthCheck.result",
        success: true,
        hasGptk: currentHasGptkRef.current,
        accountEmail: providerAccountEmail,
        provider: currentProvider,
        providerSessionId: currentProviderSessionId
      }
    })
  }, [
    accountValidationComplete,
    invalidatePaidConversionContext,
    state,
    storedReviewScope
  ])

  // Listen for messages from service worker
  useEffect(() => {
    const listener = (
      message: AppMessage,
      sender: chrome.runtime.MessageSender
    ) => {
      if (message?.app !== APP_ID) return
      if (message.clientId && message.clientId !== APP_CLIENT_ID) return
      // The bridge content script sends GPTK results via chrome.runtime.sendMessage,
      // which broadcasts to ALL extension contexts — so this listener fires twice:
      // once directly from the bridge (sender.tab set) and once via the service
      // worker relay (no sender.tab). Ignore direct bridge deliveries to avoid
      // processing each result twice.
      if (sender.tab) return

      switch (message.action) {
        case "healthCheck.result": {
          let msg = message as HealthCheckResultMessage
          if (
            msg.requestId !== undefined &&
            msg.requestId !== healthCheckRequestIdRef.current
          ) {
            // A provider tab can navigate or be replaced while an older
            // health check is still in flight. Never let that late response
            // reconnect the app or schedule a retry for the new tab.
            break
          }
          const acceptedHealthGeneration = healthCheckGenerationRef.current
          const acceptedHealthRequestId =
            msg.requestId ?? healthCheckRequestIdRef.current
          const healthCheckProvider =
            msg.provider ?? settingsRef.current.sourceProvider ?? "google"
          if (
            msg.success &&
            healthCheckProvider !== "google" &&
            !msg.providerSessionId
          ) {
            msg = {
              ...msg,
              success: false,
              hasGptk: false,
              error:
                "The provider page did not establish a session identity. Reload its tab and reconnect before scanning or changing items."
            }
          }
          const currentState = stateRef.current
          const previousAccountEmail =
            currentAccountEmailRef.current ??
            ("accountEmail" in currentState
              ? currentState.accountEmail
              : undefined)
          const previousProviderSessionId =
            currentProviderSessionIdRef.current ??
            ("providerSessionId" in currentState
              ? currentState.providerSessionId
              : undefined)
          const accountIdentityChanged = Boolean(
            msg.success &&
              ((previousAccountEmail &&
                msg.accountEmail &&
                previousAccountEmail !== msg.accountEmail) ||
                (healthCheckProvider !== "google" &&
                  previousProviderSessionId &&
                  msg.providerSessionId &&
                  previousProviderSessionId !== msg.providerSessionId))
          )
          const retryPlan = !msg.success
            ? planHealthCheckRetry(
                healthCheckProvider,
                healthCheckAttemptsRef.current
              )
            : null
          if (retryPlan) {
            // Keep the connection step in its loading state while the bounded
            // retries run. Do not dispatch RESET here: storage restoration can
            // finish between attempts, and a transient retry must not erase a
            // saved review before the final health-check result is known.
            // A restored review remains useful for read-only inspection even
            // when its provider tab is currently unavailable, but that must
            // not suppress the bounded handshake retries. Destructive actions
            // still require the eventual success result through the review
            // preflight below; a final failure leaves the app fail-closed.
            scheduleHealthCheckRetry(retryPlan)
            return
          }
          if (msg.success) {
            cancelHealthCheckRetry()
            if (
              providerConnectionTrackerRef.current.markConnected(
                healthCheckProvider,
                analyticsConsentRef.current === true && Boolean(licenseApiBaseUrl)
              )
            ) {
              trackEvent({
                name: "provider_connected",
                provider: healthCheckProvider
              })
            }
            if (accountIdentityChanged) {
              invalidatePaidConversionContext()
            }
            currentAccountEmailRef.current = msg.accountEmail
            currentProviderSessionIdRef.current = msg.providerSessionId
            currentIdentityProviderRef.current = healthCheckProvider
            currentHasGptkRef.current = msg.hasGptk
            const healthResultLeaseIsCurrent = () =>
              acceptedHealthGeneration === healthCheckGenerationRef.current &&
              (healthCheckRequestIdRef.current === null ||
                healthCheckRequestIdRef.current === acceptedHealthRequestId) &&
              currentIdentityProviderRef.current === healthCheckProvider &&
              currentAccountEmailRef.current === msg.accountEmail &&
              currentProviderSessionIdRef.current === msg.providerSessionId
            const amazonDisplayName =
              healthCheckProvider === "amazon" &&
              typeof msg.accountDisplayName === "string"
                ? msg.accountDisplayName.replace(/\s+/g, " ").trim()
                : ""
            setAmazonProfile(
              amazonDisplayName &&
                amazonDisplayName.length <= 100 &&
                msg.providerSessionId
                ? {
                    displayName: amazonDisplayName,
                    providerSessionId: msg.providerSessionId
                  }
                : null
            )
            const hasIdentity =
              healthCheckProvider === "google"
                ? Boolean(msg.accountEmail)
                : Boolean(msg.providerSessionId)
            // Health and restore may resolve in either order. Check the
            // persisted review directly so legacy account-less results cannot
            // remain available once Google identifies the signed-in account.
            if (hasIdentity) {
              void storedReviewScope
                .invalidateReview(healthResultLeaseIsCurrent, (stored) => {
                  const scanResults = stored.scanResults
                  return Boolean(
                    scanResults &&
                      !areScanResultsValid(scanResults, {
                        accountEmail: msg.accountEmail,
                        sourceProvider: healthCheckProvider,
                        providerSessionId: msg.providerSessionId
                      })
                  )
                }, healthCheckProvider)
                .catch((error) => {
                  const detail =
                    error instanceof Error ? error.message : String(error)
                  setReportError(
                    `Could not validate saved review for the provider session: ${detail}`
                  )
                })
            }
          } else {
            cancelHealthCheckRetry()
            setAmazonProfile(null)
          }
          const checkpoint = scanLifecycle.checkpoint
          if (
            msg.success &&
            checkpoint &&
            !areScanResultsValid(
              {
                accountEmail: checkpoint.accountEmail,
                sourceProvider: checkpoint.settings.sourceProvider,
                providerSessionId: checkpoint.providerSessionId
              },
              {
                accountEmail: msg.accountEmail,
                sourceProvider: healthCheckProvider,
                providerSessionId: msg.providerSessionId
              }
            )
          ) {
            scanLifecycle.reset()
            setResumeCheckpoint(null)
          }
          if (
            msg.success &&
            currentState.status === "results" &&
            !areScanResultsValid(
              {
                accountEmail: currentState.accountEmail,
                sourceProvider: currentState.sourceProvider,
                providerSessionId: currentState.providerSessionId
              },
              {
                accountEmail: msg.accountEmail,
                sourceProvider: healthCheckProvider,
                providerSessionId: msg.providerSessionId
              }
            )
          ) {
            pendingSelectionsRef.current = null
            setSelectedGroupIds(new Set())
            setReviewedGroupIds(new Set())
            setKeptOverrides({})
            void storedReviewScope.invalidateReview(
              () => true,
              undefined,
              currentState.sourceProvider ?? healthCheckProvider
            )
          }
          setAccountValidationComplete(true)
          dispatch({
            type: "HEALTH_CHECK_RESULT",
            payload: msg
          })
          if (
            msg.success &&
            msg.hasGptk &&
            healthCheckProvider ===
              (settingsRef.current.sourceProvider ?? "google") &&
            getProviderOperations(healthCheckProvider).capabilities
              .albumScope === "supported"
          ) {
            const identity =
              healthCheckProvider === "google"
                ? googleAlbumIdentityKey(
                    msg.accountEmail,
                    msg.providerSessionId
                  )
                : msg.providerSessionId || "__unknown__"
            const key = `${healthCheckProvider}:${identity}`
            if (albumsRequestedForAccountRef.current !== key) {
              requestAlbums(msg.accountEmail)
            }
          }
          break
        }
        case "gptkResult": {
          const result = message as GptkResultMessage
          if (
            result.command === "getOriginalContentHash" ||
            result.command === "getVideoPlaybackUrl"
          ) {
            handleProviderRetrievalResult(result)
            break
          } else if (result.command === "listAlbums") {
            const pendingAlbumRequest = albumsRequestRef.current
            const currentProvider =
              settingsRef.current.sourceProvider ?? "google"
            const currentIdentity =
              currentProvider === "google"
                ? googleAlbumIdentityKey(
                    currentAccountEmailRef.current,
                    currentProviderSessionIdRef.current
                  )
                : currentProviderSessionIdRef.current || "__unknown__"
            if (
              !pendingAlbumRequest ||
              pendingAlbumRequest.requestId !== result.requestId ||
              pendingAlbumRequest.provider !== currentProvider ||
              pendingAlbumRequest.identity !== currentIdentity
            ) {
              break
            }
            albumsRequestRef.current = null
            setAlbumsLoading(false)
            if (
              result.providerSessionId !==
              (pendingAlbumRequest.provider === "google"
                ? pendingAlbumRequest.providerSessionId
                : pendingAlbumRequest.identity)
            ) {
              setAlbumsError(
                "The provider page session changed while albums were loading. Reconnect and refresh the album list."
              )
              break
            }
            const hasValidAlbumList =
              Array.isArray(result.data) &&
              result.data.every((album) => {
                if (!album || typeof album !== "object") return false
                const candidate = album as Partial<GpdAlbum>
                return (
                  typeof candidate.mediaKey === "string" &&
                  candidate.mediaKey.length > 0 &&
                  typeof candidate.title === "string"
                )
              })
            if (result.success && hasValidAlbumList) {
              const nextAlbums = result.data as GpdAlbum[]
              setAlbums(nextAlbums)
              setAlbumsError(null)
              const activeAlbum = activeAlbumScope(
                settingsRef.current.albumScope
              )
              if (
                activeAlbum &&
                !nextAlbums.some(
                  (album) => album.mediaKey === activeAlbum.mediaKey
                )
              ) {
                setSettings({ albumScope: undefined })
              }
            } else {
              setAlbumsError(
                result.error || "Could not load a complete album list."
              )
            }
          } else if (result.command === "getAllMediaItems") {
            // Drop stale results from scans that were killed/cancelled — their
            // GPTK request may have still been in-flight and arrives late
            if (!scanLifecycle.isCurrent(result.requestId)) {
              console.debug(
                `[GPD] Dropping stale getAllMediaItems result for requestId ${result.requestId} (active: ${scanLifecycle.requestId})`
              )
              break
            }
            const scanProvider =
              scanLifecycle.checkpoint?.settings.sourceProvider ??
              settingsRef.current.sourceProvider ??
              "google"
            if (
              !result.providerSessionId ||
              result.providerSessionId !==
                scanLifecycle.checkpoint?.providerSessionId ||
              result.providerSessionId !== currentProviderSessionIdRef.current
            ) {
              const error =
                "The provider page session changed during the scan. Its results were discarded; reconnect and run a fresh scan."
              scanLifecycle.reset()
              setResumeCheckpoint(null)
              deferredUpgradeRef.current = null
              setDeferredUpgrade(null)
              dispatch({ type: "SCAN_ERROR", error })
              trackEvent({ name: "error", errorCategory: "scan" })
              break
            }
            if (result.success) {
              const cached = cachedMediaItemsRef.current
              const preparedResult = scanLifecycle.prepareProviderResult(
                result.data,
                result.scanCoverage,
                cached ?? undefined
              )
              if (!preparedResult) {
                const error =
                  "The provider did not return a valid scan coverage report. Reload its tab and scan again."
                patchScanCheckpoint({ status: "error", error, message: error })
                deferredUpgradeRef.current = null
                setDeferredUpgrade(null)
                setResumeCheckpoint(scanLifecycle.checkpoint)
                dispatch({ type: "SCAN_ERROR", error })
                trackEvent({ name: "error", errorCategory: "scan" })
                break
              }
              const scanCoverage = preparedResult.scanCoverage
              let items = preparedResult.mediaItems
              if (cached && Object.keys(cached).length > 0) {
                const fetchedCount = (result.data as unknown[]).length
                console.log(
                  `[GPD] media items: ${fetchedCount} fetched + ${items.length - fetchedCount} cached = ${items.length} total (${scanCoverage.stopReason})`
                )
              }
              // A result has consumed the cache for this scan attempt even
              // when the provider returned a complete full refresh. Keeping
              // it around would allow a later asynchronous result to merge
              // stale records into a different scan.
              cachedMediaItemsRef.current = null
              if (activeDateRange(settingsRef.current.dateRange)) {
                items = filterMediaItemsByDateRange(
                  items,
                  settingsRef.current.dateRange
                )
              }
              const limited = limitScanItems(items, entitlement)
              if (limited.lockedItemCount > 0) {
                const scope = scanScopeLabel(settingsRef.current)
                deferredUpgradeRef.current = {
                  reason: "scan",
                  facts: {
                    provider: settingsRef.current.sourceProvider ?? "google",
                    scopeLabel: scope.label,
                    scopeIsFullLibrary: scope.fullLibrary,
                    itemsChecked: limited.items.length,
                    additionalItemsUnavailable: limited.lockedItemCount
                  }
                }
                items = limited.items
              }
              dispatch({
                type: "SCAN_MEDIA_FETCHED",
                mediaItems: items
              })
              patchScanCheckpoint({
                phase: "downloading_thumbnails",
                itemsProcessed: 0,
                totalEstimate: items.length,
                message: `Found ${items.length} photos and videos. Loading previews...`,
                scanCoverage,
                mediaItems:
                  items.length <= MAX_CHECKPOINT_MEDIA_ITEMS ? items : undefined
              })
              runDuplicateDetection(
                items,
                scanLifecycle.signal ?? new AbortController().signal,
                result.requestId,
                scanCoverage,
                scanProvider === "icloud" &&
                  isValidICloudSyncToken(result.providerSyncToken) &&
                  scanCoverage.status === "complete" &&
                  (scanCoverage.stopReason === "exhausted" ||
                    scanCoverage.stopReason === "watermark_reached" ||
                    scanCoverage.stopReason === "changes_caught_up") &&
                  !activeDateRange(settingsRef.current.dateRange) &&
                  !albumScopeForProvider(
                    scanProvider,
                    settingsRef.current.albumScope
                  ) &&
                  limited.lockedItemCount === 0
                  ? result.providerSyncToken
                  : undefined
              )
            } else {
              deferredUpgradeRef.current = null
              setDeferredUpgrade(null)
              patchScanCheckpoint({
                status: "error",
                error: result.error || "Scan failed",
                message: result.error || "Scan failed"
              })
              trackEvent({ name: "error", errorCategory: "scan" })
              setResumeCheckpoint(scanLifecycle.checkpoint)
              dispatch({
                type: "SCAN_ERROR",
                error: result.error || "Scan failed",
                ...(scanLifecycle.isCoverage(result.scanCoverage)
                  ? { scanCoverage: result.scanCoverage }
                  : {})
              })
            }
          } else if (result.command === "trashItems") {
            handleTrashProviderResult(result)
          } else if (result.command === "restoreItems") {
            void handleRestoreProviderResult(result)
          }
          break
        }
        case "gptkLog":
          if ((message as { level?: string }).level === "error") {
            providerConnectionTrackerRef.current.markDisconnected(
              settingsRef.current.sourceProvider ?? "google"
            )
            dispatch({
              type: "GP_TAB_CLOSED",
              provider: settingsRef.current.sourceProvider ?? "google"
            })
          }
          break
        case "gptkProgress": {
          const progress = message as GptkProgressMessage
          if (progress.command === "trashItems") {
            const data = progress.data as
              | {
                  trashedKeys?: string[]
                  trashedDedupKeys?: string[]
                  outcomes?: unknown
                  icloudAssetRefs?: TrashProviderResultData["icloudAssetRefs"]
                }
              | undefined
            console.log(`[GPD] trash progress: ${progress.itemsProcessed}`)
            trashLifecycle.recordProgress({
              requestId: progress.requestId,
              data
            })
            dispatch({
              type: "TRASH_PROGRESS",
              trashedSoFar: progress.itemsProcessed,
              trashedKeys: data?.trashedKeys
            })
          } else if (progress.command === "restoreItems") {
            const restoreRequest = restoreRequestByIdRef.current.get(
              progress.requestId
            )
            if (
              !restoreRequest ||
              !isRestoreRequestCurrent(restoreRequest)
            ) {
              break
            }
            console.log(`[GPD] restore progress: ${progress.itemsProcessed}`)
            const data = progress.data as
              | { outcomes?: unknown }
              | undefined
            const acceptedProgress = trashLifecycle.recordRestoreProgress({
              requestId: progress.requestId,
              outcomes: data?.outcomes
            })
            if (!acceptedProgress) break
            const outcomes = trashLifecycle.restoreProgressSnapshot(
              progress.requestId
            )
            if (restoreRequest.operationId && outcomes) {
              void persistRestoreStatusSafely(restoreRequest.operationId, {
                outcome: "unknown",
                requestId: progress.requestId,
                terminal: false,
                restoredDedupKeys: outcomes
                  .filter((outcome) => outcome.status === "confirmed")
                  .map((outcome) => outcome.targetKey),
                unknownDedupKeys: outcomes
                  .filter((outcome) => outcome.status === "unknown")
                  .map((outcome) => outcome.targetKey),
                outcomes
              }).catch((error) => {
                const message =
                  error instanceof Error ? error.message : String(error)
                setReportError(`Could not save restore progress: ${message}`)
                setTrashWarningSafely(
                  "Restore progress could not be saved. The durable pre-dispatch guard still protects every requested target; keep this tab open for a terminal provider result."
                )
              })
            }
          } else {
            patchScanCheckpoint({
              phase: "fetching",
              itemsProcessed: progress.itemsProcessed,
              message: progress.message ?? "Reading your library..."
            })
            dispatch({ type: "SCAN_PROGRESS", payload: progress })
          }
          break
        }
      }
    }

    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [
    entitlement,
    handleProviderRetrievalResult,
    handleRestoreProviderResult,
    isRestoreRequestCurrent,
    handleTrashProviderResult,
    persistRestoreStatusSafely,
    invalidatePaidConversionContext,
    openUpgradePrompt,
    patchScanCheckpoint,
    cancelHealthCheckRetry,
    scheduleHealthCheckRetry,
    storedReviewScope,
    setReportError,
    setTrashWarningSafely,
    trackEvent,
    trashLifecycle
  ])

  // Keep refs so async callbacks always see latest values
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const stateRef = useRef(state)
  stateRef.current = state
  const scanReviewGenerationRef = useRef(0)
  const reviewHydrationClosedRef = useRef(false)
  const reviewSelectionsRef = useRef(reviewSelections)
  reviewSelectionsRef.current = reviewSelections
  const reviewSessionRef = useRef<DuplicateReviewSession | null>(null)
  const reviewFilterRef = useRef(reviewFilter)
  reviewFilterRef.current = reviewFilter
  const entitlementRef = useRef(entitlement)
  entitlementRef.current = entitlement
  const accountValidationCompleteRef = useRef(accountValidationComplete)
  accountValidationCompleteRef.current = accountValidationComplete

  const requestProviderRetrieval = useCallback(
    (
      command: ProviderRetrievalCommand,
      item: GpdMediaItem,
      signal: AbortSignal
    ): Promise<OriginalContentHashResult | VideoPlaybackResult> => {
      const current = stateRef.current
      const provider = settingsRef.current.sourceProvider ?? "google"
      if (command === "getOriginalContentHash") {
        const unavailableMessage =
          getOriginalContentVerificationUnavailableMessage(item)
        if (unavailableMessage) {
          return Promise.reject(new Error(unavailableMessage))
        }
      }
      const providerSessionId =
        currentIdentityProviderRef.current === provider
          ? currentProviderSessionIdRef.current
          : undefined
      const accountEmail =
        currentIdentityProviderRef.current === provider
          ? currentAccountEmailRef.current
          : undefined
      if (
        signal.aborted ||
        !providerSessionId ||
        current.status !== "results" ||
        current.sourceProvider !== provider ||
        !isProviderRetrievalBindingCurrent({
          status: current.status,
          provider,
          currentProvider: provider,
          scannedProviderSessionId: current.providerSessionId,
          currentProviderSessionId: providerSessionId,
          scannedAccountEmail: current.status === "results" ? current.accountEmail : undefined,
          currentAccountEmail: accountEmail,
          scannedScopeFingerprint: current.scopeFingerprint,
          currentScopeFingerprint: current.scopeFingerprint,
          item,
          scannedMediaItems:
            current.status === "results" ? Object.values(current.mediaItems) : []
        })
      ) {
        return Promise.reject(
          new Error(
            "Original media is available only for an item in the current, session-bound review. Scan the current account again."
          )
        )
      }
      if (
        command === "getVideoPlaybackUrl" &&
        !isVideoForPlayback(item)
      ) {
        return Promise.reject(
          new Error("The selected item is not a verified video.")
        )
      }

      const requestId = generateRequestId()
      return new Promise((resolve, reject) => {
        const pending = {
          command,
          provider,
          providerSessionId,
          ...(provider === "google" && accountEmail ? { accountEmail } : {}),
          scanScopeFingerprint: current.scopeFingerprint!,
          mediaKey: item.mediaKey,
          dedupKey: item.dedupKey,
          signal,
          abortListener: () => {},
          timeoutId: 0,
          resolve,
          reject
        } satisfies PendingProviderRetrieval
        pending.abortListener = () =>
          cancelProviderRetrieval(
            requestId,
            pending,
            new DOMException("Original media retrieval was cancelled.", "AbortError")
          )
        pending.timeoutId = window.setTimeout(() => {
          cancelProviderRetrieval(
            requestId,
            pending,
            new Error(
              "The provider media request timed out. The item remains unverified."
            )
          )
        }, PROVIDER_RETRIEVAL_TIMEOUT_MS)
        pendingProviderRetrievalsRef.current.set(requestId, pending)
        signal.addEventListener("abort", pending.abortListener, { once: true })
        if (signal.aborted) {
          pending.abortListener()
          return
        }

        const args = {
          requestId,
          mediaKey: item.mediaKey,
          providerSessionId,
          scanScopeFingerprint: current.scopeFingerprint,
          userOptIn: true,
          ...(provider === "google" && accountEmail ? { accountEmail } : {}),
          ...(item.mediaKind ? { mediaKind: item.mediaKind } : {}),
          ...(command === "getOriginalContentHash"
            ? {
                maxBytes: MAX_ORIGINAL_BYTES_PER_ITEM,
                aggregateBudgetBytes: MAX_ORIGINAL_BYTES_PER_REVIEW
              }
            : {})
        }
        void sendToServiceWorker({
          app: APP_ID,
          action: "gptkCommand",
          command,
          requestId,
          provider,
          args
        }).catch((error) => {
          if (pendingProviderRetrievalsRef.current.get(requestId) !== pending) {
            return
          }
          cancelProviderRetrieval(
            requestId,
            pending,
            new Error(safeProviderRetrievalError(error))
          )
        })
      })
    },
    [cancelProviderRetrieval]
  )

  const handleVerifyOriginal = useCallback(
    (item: GpdMediaItem, signal: AbortSignal) =>
      requestProviderRetrieval("getOriginalContentHash", item, signal) as Promise<OriginalContentHashResult>,
    [requestProviderRetrieval]
  )

  const handleLoadVideo = useCallback(
    (item: GpdMediaItem, signal: AbortSignal) =>
      requestProviderRetrieval("getVideoPlaybackUrl", item, signal) as Promise<VideoPlaybackResult>,
    [requestProviderRetrieval]
  )

  useEffect(() => {
    for (const [requestId, pending] of pendingProviderRetrievalsRef.current) {
      const currentProvider = settings.sourceProvider ?? "google"
      const currentProviderSessionId =
        currentIdentityProviderRef.current === currentProvider
          ? currentProviderSessionIdRef.current
          : undefined
      const currentAccountEmail =
        currentIdentityProviderRef.current === currentProvider
          ? currentAccountEmailRef.current
          : undefined
      const currentResults = state.status === "results" ? state : null
      const isCurrent =
        currentResults !== null &&
        currentResults.sourceProvider === pending.provider &&
        (pending.provider !== "google" ||
          pending.accountEmail === currentResults.accountEmail) &&
        isProviderRetrievalBindingCurrent({
          status: state.status,
          provider: pending.provider,
          currentProvider,
          scannedProviderSessionId: currentResults?.providerSessionId,
          currentProviderSessionId,
          scannedAccountEmail: currentResults?.accountEmail,
          currentAccountEmail,
          scannedScopeFingerprint: pending.scanScopeFingerprint,
          currentScopeFingerprint: currentResults?.scopeFingerprint,
          item: {
            mediaKey: pending.mediaKey,
            dedupKey: pending.dedupKey,
            provider: pending.provider
          },
          scannedMediaItems:
            currentResults ? Object.values(currentResults.mediaItems) : []
        })
      if (!isCurrent) {
        cancelProviderRetrieval(
          requestId,
          pending,
          new Error(
            "The provider account, page session, or review scope changed. The item remains unverified."
          )
        )
      }
    }
  }, [
    cancelProviderRetrieval,
    settings.sourceProvider,
    state
  ])

  useEffect(
    () => () => {
      for (const [requestId, pending] of pendingProviderRetrievalsRef.current) {
        cancelProviderRetrieval(
          requestId,
          pending,
          new DOMException("The PhotoSweep review was closed.", "AbortError")
        )
      }
    },
    [cancelProviderRetrieval]
  )

  useEffect(() => {
    if (
      state.status === "connected" ||
      state.status === "scanning" ||
      state.status === "results" ||
      state.status === "trashing"
    ) {
      setSidePanelSourceConfirmed(true)
    }
  }, [state.status])

  useEffect(() => {
    if (!entitlementLoaded) return
    const limits = getPlanLimits(entitlement)
    if (!limits.fullScanMode && settings.scanMode === "full") {
      setSettings({ scanMode: "smart" })
    }
  }, [entitlement, entitlementLoaded, settings.scanMode])

  // Run MediaPipe duplicate detection on fetched media items
  const runDuplicateDetection = useCallback(
    async (
      items: GpdMediaItem[],
      signal: AbortSignal,
      requestId: string,
      scanCoverage?: ScanCoverage,
      providerSyncToken?: string
    ) => {
      const logger = scanLoggerRef.current
      await logger.start(items.length)
      const patchCheckpointForRequest = (
        patch: Parameters<ScanLifecycle["patch"]>[0]
      ) => {
        scanLifecycle.patch(patch, requestId)
      }
      try {
        const onProgressCallback = (progress: DetectionProgress) => {
          if (!scanLifecycle.isCurrent(requestId)) return
          patchCheckpointForRequest({
            phase: progress.phase,
            itemsProcessed: progress.current,
            totalEstimate: progress.total,
            message: `${progress.phase}: ${progress.current}/${progress.total}`
          })
          dispatch({
            type: "SCAN_PROGRESS",
            phase: progress.phase,
            totalItems: progress.total,
            payload: {
              app: APP_ID,
              action: "gptkProgress",
              requestId: "",
              itemsProcessed: progress.current,
              message: `${progress.phase}: ${progress.current}/${progress.total}`
            }
          })
        }
        const onPartialGroupsCallback = (partialGroups: DuplicateGroup[]) => {
          if (!scanLifecycle.isCurrent(requestId)) return
          const partialKeys = new Set(
            partialGroups.flatMap((group) => group.mediaKeys)
          )
          const partialMediaItems: Record<string, GpdMediaItem> = {}
          for (const item of items) {
            if (partialKeys.has(item.mediaKey)) {
              partialMediaItems[item.mediaKey] = item
            }
          }
          dispatch({
            type: "SCAN_PARTIAL_RESULTS",
            mediaItems: partialMediaItems,
            groups: partialGroups,
            totalItems: items.length
          })
        }

        const groups = await duplicateDetectionEngine.detect({
          mode: settingsRef.current.scanMode,
          mediaItems: items,
          threshold: settingsRef.current.similarityThreshold,
          smartWindowMs: (settingsRef.current.smartWindowSec ?? 1) * 1000,
          onProgress: onProgressCallback,
          signal,
          logger,
          onPartialGroups: onPartialGroupsCallback,
          cacheNamespace: (() => {
            const checkpoint = scanLifecycle.checkpoint
            const provider =
              checkpoint?.settings.sourceProvider ??
              settingsRef.current.sourceProvider ??
              "google"
            const account = accountFingerprint(
              checkpoint?.accountEmail ?? currentAccountEmailRef.current
            )
            const providerSessionId =
              checkpoint?.providerSessionId ??
              currentProviderSessionIdRef.current
            return `${provider}:${account ?? providerSessionId ?? requestId}`
          })()
        })

        await logger.finalize("complete", { groupsFound: groups.length })
        if (!scanLifecycle.isCurrent(requestId)) return
        // Invalidate any saved-review read before complete() clears the active
        // request ID and yields while the checkpoint is removed.
        scanReviewGenerationRef.current += 1
        if (!(await scanLifecycle.complete(requestId))) return
        setResumeCheckpoint(null)

        const groupMediaKeys = new Set(groups.flatMap((g) => g.mediaKeys))
        const mediaItemMap: Record<string, GpdMediaItem> = {}
        for (const item of items) {
          if (groupMediaKeys.has(item.mediaKey)) {
            mediaItemMap[item.mediaKey] = item
          }
        }

        const deferredScanPrompt = deferredUpgradeRef.current
        deferredUpgradeRef.current = null
        if (deferredScanPrompt && groups.length > 0) {
          const visibleGroupCount = getVisibleGroups(groups, entitlement).length
          setDeferredUpgrade({
            ...deferredScanPrompt,
            facts: {
              ...deferredScanPrompt.facts,
              duplicateGroupCount: groups.length,
              visibleGroupCount,
              lockedGroupCount: getLockedGroupCount(groups, entitlement)
            }
          })
        } else {
          setDeferredUpgrade(null)
        }

        const scanDate = Date.now()
        const scanScopeFingerprint = buildScanScopeFingerprint(
          settingsRef.current
        )
        const rememberedSelections = applyRememberedDecisions({
          records: await decisionMemoryStore.load(),
          groups,
          mediaItems: mediaItemMap,
          provider: settingsRef.current.sourceProvider ?? "google",
          accountEmail: currentAccountEmailRef.current,
          now: scanDate
        })
        const hasRememberedSelections =
          rememberedSelections.reviewedGroupIds.size > 0
        autoSelectNextResultsRef.current = !hasRememberedSelections
        pendingSelectionsRef.current = hasRememberedSelections
          ? rememberedSelections
          : null
        dispatch({
          type: "SCAN_COMPLETE",
          mediaItems: mediaItemMap,
          groups,
          totalItems:
            (settingsRef.current.sourceProvider ?? "google") === "icloud" &&
            (scanCoverage?.stopReason === "watermark_reached" ||
              scanCoverage?.stopReason === "changes_caught_up") &&
            Number.isSafeInteger(scanCoverage.totalItems)
              ? scanCoverage.totalItems!
              : items.length,
          scanCoverage,
          sourceProvider: settingsRef.current.sourceProvider ?? "google",
          scanDate,
          scopeFingerprint: scanScopeFingerprint,
          providerSyncToken
        })
        trackEvent({
          name: "scan_completed",
          photoCountBucket: countBucket(items.length),
          duplicateGroupCountBucket: countBucket(groups.length)
        })
        refreshEmbeddingCacheCount()
        // Refresh account email after scan — the email in state may be stale
        // if the user switched accounts since the last health check.
        requestHealthCheck(settingsRef.current.sourceProvider ?? "google")
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          await logger.finalize("paused")
          deferredUpgradeRef.current = null
          setDeferredUpgrade(null)
          const paused = scanLifecycle.pause(requestId)
          if (paused) {
            scanReviewGenerationRef.current += 1
            setResumeCheckpoint(paused)
            dispatch({ type: "SCAN_CANCELLED" })
          }
        } else {
          await logger.finalize("error", { error: String(error) })
          deferredUpgradeRef.current = null
          setDeferredUpgrade(null)
          const failed = scanLifecycle.fail(requestId, error)
          if (!failed) return
          scanReviewGenerationRef.current += 1
          setResumeCheckpoint(failed)
          trackEvent({ name: "error", errorCategory: "scan" })
          dispatch({
            type: "SCAN_ERROR",
            error: `Duplicate detection failed: ${error}`
          })
        }
      }
    },
    [
      patchScanCheckpoint,
      refreshEmbeddingCacheCount,
      requestHealthCheck,
      requestAlbums,
      scanLifecycle,
      trackEvent,
      entitlement
    ]
  )

  // Health check on mount + recover any scan log entry orphaned by a page reload
  useEffect(() => {
    requestHealthCheck(settingsRef.current.sourceProvider ?? "google")
    scanLoggerRef.current.recoverStale()
    refreshEmbeddingCacheCount()
    return () => cancelHealthCheckRetry()
  }, [cancelHealthCheckRetry, refreshEmbeddingCacheCount, requestHealthCheck])

  useEffect(() => {
    let cancelled = false
    void requestRecoveryHistoryTransaction({ kind: "read" })
      .then((records) => {
        if (!cancelled) {
          setRecoveryHistorySafely(records)
          setRecoveryHistoryReadError(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecoveryHistoryReadError(true)
        }
      })
    void decisionMemoryStore.load().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [decisionMemoryStore, setRecoveryHistorySafely, setTrashWarningSafely])

  // Load saved settings and results on mount
  useEffect(() => {
    if (reviewHydrationClosedRef.current) {
      setStorageChecked(true)
      return
    }
    let cancelled = false
    const restoreIdentity = {
      provider: currentIdentityProviderRef.current,
      accountEmail: currentAccountEmailRef.current,
      providerSessionId: currentProviderSessionIdRef.current,
      scanReviewGeneration: scanReviewGenerationRef.current
    }
    const restoreLeaseIsCurrent = () =>
      !cancelled &&
      !reviewHydrationClosedRef.current &&
      restoreIdentity.scanReviewGeneration ===
        scanReviewGenerationRef.current &&
      restoreIdentity.provider === currentIdentityProviderRef.current &&
      restoreIdentity.accountEmail === currentAccountEmailRef.current &&
      restoreIdentity.providerSessionId ===
        currentProviderSessionIdRef.current
    void storedReviewScope
      .restore({
        fallbackSettings: settingsRef.current,
        hostProvider: isSidePanel ? sidePanelHostProviderRef.current : null,
        accountEmail: restoreIdentity.accountEmail,
        providerSessionId: restoreIdentity.providerSessionId,
        identityProvider: restoreIdentity.provider,
        isCurrent: restoreLeaseIsCurrent
      })
      .then(async (restored) => {
        if (cancelled || restored.cancelled || !restoreLeaseIsCurrent()) return
        // The health check and storage read run concurrently. Re-check against
        // the account learned while storage was loading before showing or
        // retaining a legacy account-less review.
        const currentAccountEmail = currentAccountEmailRef.current
        const identityMatchesProvider =
          currentIdentityProviderRef.current ===
          (restored.settings.sourceProvider ?? "google")
        const providerAccountEmail = identityMatchesProvider
          ? currentAccountEmail
          : undefined
        const providerSessionId = identityMatchesProvider
          ? currentProviderSessionIdRef.current
          : undefined
        if (
          restored.scanResults &&
          (providerAccountEmail || providerSessionId) &&
          !areScanResultsValid(restored.scanResults, {
            accountEmail: providerAccountEmail,
            sourceProvider: restored.settings.sourceProvider ?? "google",
            providerSessionId
          })
        ) {
          await storedReviewScope.invalidateReview(
            restoreLeaseIsCurrent,
            (stored) =>
              Boolean(
                stored.scanResults &&
                  !areScanResultsValid(stored.scanResults, {
                    accountEmail: providerAccountEmail,
                    sourceProvider: restored.settings.sourceProvider ?? "google",
                    providerSessionId
                  })
              ),
            restored.settings.sourceProvider ?? "google"
          )
          if (cancelled || !restoreLeaseIsCurrent()) return
          restored = {
            ...restored,
            scanResults: null,
            selections: null,
            staleReviewRemoved: true,
            identityPending: false
          }
        }
        if (cancelled || !restoreLeaseIsCurrent()) return
        if (!restored.identityPending && !restored.staleReviewRemoved) {
          await providerReviewStorage.commitLegacyReviewMigration(
            restored.settings.sourceProvider ?? "google",
            {
              scanResults: Boolean(restored.scanResults),
              checkpoint: Boolean(restored.checkpoint)
            },
            restoreLeaseIsCurrent
          )
        }
        if (cancelled || !restoreLeaseIsCurrent()) return
        // A health-triggered storage restore can finish after the user has
        // already started a scan. Do not restore an old checkpoint over the
        // live ScanLifecycle request or replace its pending/results state.
        if (scanLifecycle.requestId) return
        settingsRef.current = restored.settings
        setSettings(restored.settings)
        const restoredCheckpoint = scanLifecycle.restore(restored.checkpoint)
        if (
          !restored.identityPending &&
          scanLifecycle.canOfferResume(restoredCheckpoint, {
            sourceProvider: restored.settings.sourceProvider,
            accountEmail: providerAccountEmail,
            providerSessionId
          })
        ) {
          setResumeCheckpoint(restoredCheckpoint)
        } else {
          setResumeCheckpoint(null)
        }
        pendingSelectionsRef.current = restored.identityPending
          ? null
          : restored.selections
        if (
          !restored.identityPending &&
          restored.scanResults?.totalItems &&
          Array.isArray(restored.scanResults.groups)
        ) {
          dispatch({
            type: "LOAD_SAVED_RESULTS",
            mediaItems: restored.scanResults.mediaItems,
            groups: restored.scanResults.groups,
            totalItems: restored.scanResults.totalItems,
            scanCoverage: scanLifecycle.isCoverage(
              restored.scanResults.scanCoverage
            )
              ? restored.scanResults.scanCoverage
              : undefined,
            accountEmail: restored.scanResults.accountEmail,
            providerSessionId: restored.scanResults.providerSessionId,
            providerSyncToken: restored.scanResults.providerSyncToken,
            sourceProvider: restored.scanResults.sourceProvider,
            scanDate: restored.scanResults.scanDate,
            scopeFingerprint: restored.scanResults.scopeFingerprint
          })
        }
        setStorageChecked(true)
      })
      .catch(() => {
        if (!cancelled) setStorageChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [
    accountValidationComplete,
    isSidePanel,
    scanLifecycle,
    storedReviewScope
  ])

  // Persist scan results when they change (after scan or trash)
  const mediaItems =
    (state.status === "results" || state.status === "trashing") &&
    stateIdentityValidated
      ? state.mediaItems
      : null
  const unknownFavoriteTrashCount =
    trashConfirm && mediaItems
      ? trashConfirm.mediaKeysToTrash.filter(
          (key) => favoriteStatusForItem(mediaItems[key]) === "unknown"
        ).length
      : 0

  const groupClassificationById = useMemo(() => {
    const m = new Map<string, "exact" | "similar">()
    if (Object.keys(displayMediaItems).length === 0) return m
    for (const group of groups) {
      m.set(
        group.id,
        classifyDuplicateGroup(group, displayMediaItems).duplicateKind
      )
    }
    return m
  }, [groups, displayMediaItems])

  const exactGroupCount = useMemo(
    () =>
      groups.reduce(
        (count, group) =>
          count + (groupClassificationById.get(group.id) === "exact" ? 1 : 0),
        0
      ),
    [groups, groupClassificationById]
  )
  const similarGroupCount = groups.length - exactGroupCount
  const filteredGroups = useMemo(() => {
    if (reviewFilter === "all") return groups
    return groups.filter(
      (group) => groupClassificationById.get(group.id) === reviewFilter
    )
  }, [groups, groupClassificationById, reviewFilter])
  const visibleGroups = useMemo(
    () => getVisibleGroups(filteredGroups, entitlement),
    [filteredGroups, entitlement]
  )
  const cleanupScopeGroups = useMemo(
    () => getVisibleGroups(groups, entitlement),
    [groups, entitlement]
  )
  const lockedGroupCount = useMemo(
    () => getLockedGroupCount(filteredGroups, entitlement),
    [filteredGroups, entitlement]
  )
  const provisionalGroups = state.status === "scanning" ? groups : visibleGroups
  const reviewSession = useMemo(
    () =>
      new DuplicateReviewSession({
        groups,
        mediaItems: displayMediaItems,
        selections: reviewSelections,
        defaultStrategy: settings.defaultKeepStrategy
      }),
    [displayMediaItems, groups, reviewSelections, settings.defaultKeepStrategy]
  )
  reviewSessionRef.current = reviewSession
  const cleanupTrashPlan = useMemo(
    () => reviewSession.trashPlan(cleanupScopeGroups),
    [cleanupScopeGroups, reviewSession]
  )
  const trashPlanMediaKeys = useMemo(
    () => new Set(cleanupTrashPlan.mediaKeysToTrash),
    [cleanupTrashPlan]
  )
  const updateReviewSelections = useCallback(
    (action: DuplicateReviewAction): DuplicateReviewSelections | null => {
      if (
        stateRef.current.status === "results" &&
        !stateIdentityValidated
      ) {
        return null
      }
      const currentSession = reviewSessionRef.current
      if (!currentSession) return null
      const nextSession = currentSession.transition(action)
      const next = nextSession.selections
      reviewSessionRef.current = nextSession
      reviewSelectionsRef.current = next
      setReviewSelections(next)
      if (
        stateRef.current.status === "results" &&
        stateIdentityValidated
      ) {
        reviewHydrationClosedRef.current = true
        scanReviewGenerationRef.current += 1
        // Persist the user action immediately so a fast reload cannot race the
        // later reconciliation effect and lose a keep/skip decision.
        void storedReviewScope.write(
          { selections: nextSession.serialize() },
          undefined,
          stateRef.current.sourceProvider ??
            settingsRef.current.sourceProvider ??
            "google"
        )
      }
      return next
    },
    [stateIdentityValidated, storedReviewScope]
  )
  const handleToggleGroup = useCallback((groupId: string) => {
    const currentSession = reviewSessionRef.current
    if (!currentSession) return
    reviewHydrationClosedRef.current = true
    scanReviewGenerationRef.current += 1
    const nextSession = currentSession.transition({
      type: currentSession.selectedGroupIds.has(groupId)
        ? "deselect_groups"
        : "select_groups",
      groupIds: [groupId]
    })
    reviewSessionRef.current = nextSession
    const next = nextSession.selections
    reviewSelectionsRef.current = next
    setReviewSelections(next)
  }, [])
  const reviewedVisibleGroupCount = visibleGroups.filter((group) =>
    reviewSession.reviewedGroupIds.has(group.id)
  ).length
  const reviewedCleanupScopeGroupCount = cleanupScopeGroups.filter((group) =>
    reviewSession.reviewedGroupIds.has(group.id)
  ).length
  const allCleanupScopeGroupsReviewed =
    cleanupScopeGroups.length > 0 &&
    reviewedCleanupScopeGroupCount === cleanupScopeGroups.length

  const handleSelectAll = useCallback(() => {
    updateReviewSelections({
      type: "select_groups",
      groupIds: visibleGroups.map((group) => group.id)
    })
  }, [updateReviewSelections, visibleGroups])

  const handleDeselectAll = useCallback(() => {
    updateReviewSelections({
      type: "deselect_groups",
      groupIds: visibleGroups.map((group) => group.id)
    })
  }, [updateReviewSelections, visibleGroups])

  const handleSkipGroup = useCallback(
    (groupId: string) => {
      updateReviewSelections({
        type: "deselect_groups",
        groupIds: [groupId]
      })
    },
    [updateReviewSelections]
  )

  const getKept = useCallback(
    (group: DuplicateGroup): Set<string> => reviewSession.keptFor(group),
    [reviewSession]
  )
  const getKeepDecision = useCallback(
    (group: DuplicateGroup) => reviewSession.decisionFor(group),
    [reviewSession]
  )

  const buildCurrentReviewReport = useCallback(() => {
    const currentState = stateRef.current
    if (
      currentState.status !== "results" ||
      !stateIdentityValidated
    ) {
      return null
    }
    return reviewSession.reviewReport(visibleGroups)
  }, [reviewSession, stateIdentityValidated, visibleGroups])

  const handleExportJson = useCallback(async () => {
    const report = buildCurrentReviewReport()
    if (!report) return
    const actionEntitlement = await refreshTimeLimitedEntitlementForAction()
    if (!actionEntitlement) return
    if (!canExportFullReport(actionEntitlement) && lockedGroupCount > 0) {
      openTrackedUpgradePrompt(
        "export",
        `This free report includes ${visibleGroups.length.toLocaleString()} visible duplicate set${visibleGroups.length === 1 ? "" : "s"}. Upgrade for the full report.`,
        {
          provider: settings.sourceProvider ?? "google",
          scopeLabel: scanScopeLabel(settings).label,
          scopeIsFullLibrary: scanScopeLabel(settings).fullLibrary,
          itemsChecked: totalItems,
          duplicateGroupCount: groups.length,
          visibleGroupCount: visibleGroups.length,
          lockedGroupCount: lockedGroupCount
        }
      )
    }
    trackEvent({
      name: "export_clicked",
      duplicateGroupCountBucket: countBucket(visibleGroups.length)
    })
    downloadTextFile({
      filename: `${report.reportId}.json`,
      contents: JSON.stringify(report, null, 2),
      type: "application/json"
    })
  }, [
    buildCurrentReviewReport,
    lockedGroupCount,
    openTrackedUpgradePrompt,
    refreshTimeLimitedEntitlementForAction,
    trackEvent,
    visibleGroups.length
  ])

  const handleExportCsv = useCallback(async () => {
    const report = buildCurrentReviewReport()
    if (!report) return
    const actionEntitlement = await refreshTimeLimitedEntitlementForAction()
    if (!actionEntitlement) return
    if (!canExportFullReport(actionEntitlement) && lockedGroupCount > 0) {
      openTrackedUpgradePrompt(
        "export",
        `This free spreadsheet includes ${visibleGroups.length.toLocaleString()} visible duplicate set${visibleGroups.length === 1 ? "" : "s"}. Upgrade for the full report.`,
        {
          provider: settings.sourceProvider ?? "google",
          scopeLabel: scanScopeLabel(settings).label,
          scopeIsFullLibrary: scanScopeLabel(settings).fullLibrary,
          itemsChecked: totalItems,
          duplicateGroupCount: groups.length,
          visibleGroupCount: visibleGroups.length,
          lockedGroupCount: lockedGroupCount
        }
      )
    }
    trackEvent({
      name: "export_clicked",
      duplicateGroupCountBucket: countBucket(visibleGroups.length)
    })
    downloadTextFile({
      filename: `${report.reportId}.csv`,
      contents: reviewReportToCsv(report),
      type: "text/csv"
    })
  }, [
    buildCurrentReviewReport,
    lockedGroupCount,
    openTrackedUpgradePrompt,
    refreshTimeLimitedEntitlementForAction,
    trackEvent,
    visibleGroups.length
  ])

  const handleToggleKept = useCallback(
    (group: DuplicateGroup, mediaKey: string) => {
      updateReviewSelections({
        type: "toggle_kept",
        groupId: group.id,
        mediaKey
      })
    },
    [updateReviewSelections]
  )

  const handleTrashAllCopies = useCallback(
    (group: DuplicateGroup) => {
      updateReviewSelections({
        type: "trash_all_copies",
        groupId: group.id
      })
    },
    [updateReviewSelections]
  )

  const handleApplyKeepStrategy = useCallback(
    (strategy: KeepStrategy) => {
      handleKeepStrategySelection({
        groups,
        cleanupEligibleGroupIds: cleanupScopeGroups.map((group) => group.id),
        mediaItems: mediaItems ? displayMediaItems : undefined,
        selections: reviewSelectionsRef.current,
        strategy,
        persistDefaultStrategy: (defaultKeepStrategy) =>
          setSettings({ defaultKeepStrategy }),
        updateReviewSelections,
        setFeedback: setKeepStrategyFeedback
      })
    },
    [
      displayMediaItems,
      cleanupScopeGroups,
      groups,
      mediaItems,
      setSettings,
      updateReviewSelections,
    ]
  )
  const totalItems =
    (state.status === "results" || state.status === "trashing") &&
    stateIdentityValidated
      ? state.totalItems
      : 0
  const accountEmailForStorage =
    (state.status === "results" || state.status === "trashing") &&
    stateIdentityValidated
      ? state.accountEmail
      : undefined
  const providerSessionIdForStorage =
    (state.status === "results" || state.status === "trashing") &&
    stateIdentityValidated
      ? state.providerSessionId
      : undefined
  const resultScanMetadata =
    (state.status === "results" || state.status === "trashing") &&
    stateIdentityValidated
      ? state
      : null
  useEffect(() => {
    if (!stateIdentityValidated) return
    if (!mediaItems) return
    const resultProvider =
      resultScanMetadata?.sourceProvider ?? settings.sourceProvider ?? "google"
    const resultDateRange = activeDateRange(settings.dateRange)
    const resultAlbumScope = albumScopeForProvider(
      resultProvider,
      settings.albumScope
    )
    const resultHasCompleteCoverage =
      resultScanMetadata?.scanCoverage?.status === "complete" &&
      (resultScanMetadata.scanCoverage.stopReason === "exhausted" ||
        resultScanMetadata.scanCoverage.stopReason === "watermark_reached" ||
        resultScanMetadata.scanCoverage.stopReason === "changes_caught_up")
    const resultHasReusableICloudToken =
      resultProvider === "icloud" &&
      isValidICloudSyncToken(resultScanMetadata?.providerSyncToken) &&
      resultHasCompleteCoverage &&
      !resultDateRange &&
      !resultAlbumScope &&
      !providerBatchLimitForEntitlement(settings, entitlement)
    if (
      groups.length > 0 ||
      (resultHasReusableICloudToken && resultHasCompleteCoverage)
    ) {
      const storedMediaItemCount = Object.keys(mediaItems).length
      const mediaItemsAreComplete =
        !providerBatchLimitForEntitlement(settings, entitlement) &&
        (storedMediaItemCount === totalItems ||
          (resultProvider === "icloud" &&
            resultHasCompleteCoverage &&
            !resultDateRange &&
            !resultAlbumScope))
      const newestCreationTimestamp = mediaItemsAreComplete
        ? Object.values(mediaItems).reduce(
            (max, item) =>
              Number.isFinite(item.creationTimestamp)
                ? Math.max(max, item.creationTimestamp)
                : max,
            0
          )
        : undefined
      const scanWatermarkTimestamp = mediaItemsAreComplete
        ? Object.values(mediaItems).reduce(
            (max, item) =>
              Math.max(
                max,
                (resultScanMetadata?.sourceProvider ??
                  settings.sourceProvider ??
                  "google") === "icloud"
                  ? Number.isFinite(item.timestamp)
                    ? item.timestamp
                    : 0
                  : Number.isFinite(item.creationTimestamp)
                    ? item.creationTimestamp
                    : 0
              ),
            0
          )
        : undefined
      void storedReviewScope.write({
        scanResults: {
          mediaItems,
          groups,
          scanDate: resultScanMetadata?.scanDate ?? Date.now(),
          totalItems,
          newestCreationTimestamp,
          scanWatermarkTimestamp,
          mediaItemsAreComplete,
          scanCoverage: resultScanMetadata?.scanCoverage,
          accountEmail: accountEmailForStorage,
          providerSessionId: providerSessionIdForStorage,
          ...(resultHasReusableICloudToken
            ? { providerSyncToken: resultScanMetadata?.providerSyncToken }
            : {}),
          sourceProvider: resultProvider,
          dateRange: resultDateRange,
          albumScope: resultAlbumScope,
          scanMode: settings.scanMode,
          similarityThreshold: settings.similarityThreshold,
          smartWindowSec: settings.smartWindowSec,
          scopeFingerprint:
            resultScanMetadata?.scopeFingerprint ??
            buildScanScopeFingerprint(settings)
        }
      }, undefined, resultProvider)
    } else {
      // All duplicates removed — clear saved results so next open starts fresh
      void storedReviewScope.write(
        { scanResults: null },
        undefined,
        resultScanMetadata?.sourceProvider ?? settings.sourceProvider ?? "google"
      )
    }
  }, [
    groups,
    mediaItems,
    resultScanMetadata,
    totalItems,
    accountEmailForStorage,
    providerSessionIdForStorage,
    stateIdentityValidated,
    settings.scanMode,
    settings.similarityThreshold,
    settings.smartWindowSec,
    settings.dateRange,
    settings.albumScope,
    settings.sourceProvider,
    entitlement,
    storedReviewScope
  ])

  // Persist selections when they change (only while results are showing)
  useEffect(() => {
    if (!stateIdentityValidated) return
    if (state.status !== "results") return
    if (groups.length === 0) {
      void storedReviewScope.write(
        { selections: null },
        undefined,
        state.sourceProvider ?? settings.sourceProvider ?? "google"
      )
      return
    }
    void storedReviewScope.write(
      { selections: reviewSession.serialize() },
      undefined,
      state.sourceProvider ?? settings.sourceProvider ?? "google"
    )
    const records = captureManualDecisionRecords({
      groups,
      mediaItems: displayMediaItems,
      selections: reviewSession.selections,
      provider: settings.sourceProvider ?? "google",
      accountEmail: accountEmailForStorage
    })
    if (records.length > 0) {
      void decisionMemoryStore.remember(records).catch(() => {})
    }
  }, [
    decisionMemoryStore,
    displayMediaItems,
    reviewSession,
    state.status,
    groups,
    accountEmailForStorage,
    stateIdentityValidated,
    settings.sourceProvider,
    storedReviewScope
  ])

  // Save settings on change
  useEffect(() => {
    if (!storageChecked) return
    void storedReviewScope.write({ settings })
  }, [settings, storageChecked, storedReviewScope])

  useEffect(() => {
    cancelHealthCheckRetry()
    healthCheckAttemptsRef.current = 0
    currentAccountEmailRef.current = undefined
    currentProviderSessionIdRef.current = undefined
    currentIdentityProviderRef.current = undefined
    currentHasGptkRef.current = false
    setAmazonProfile(null)
    setAccountValidationComplete(false)
    if (photoDataConsent !== true) return
    setAlbums([])
    setAlbumsError(null)
    setAlbumsLoading(false)
    albumsRequestedForAccountRef.current = null
    albumsRequestRef.current = null
    requestHealthCheck(settings.sourceProvider ?? "google")
  }, [
    cancelHealthCheckRetry,
    photoDataConsent,
    requestHealthCheck,
    settings.sourceProvider
  ])

  const handleStartScan = useCallback(
    async (settingsOverride?: ScanSettings) => {
      if (photoDataConsent !== true) return
      const requestedSettings = settingsOverride ?? settings
      const actionEntitlement = await refreshTimeLimitedEntitlementForAction()
      if (!actionEntitlement) return
      const scanSettings = {
        ...scanSettingsForEntitlement(requestedSettings, actionEntitlement),
        defaultKeepStrategy:
          requestedSettings.defaultKeepStrategy ??
          settingsRef.current.defaultKeepStrategy ??
          "best_quality"
      }
      const sourceProvider = scanSettings.sourceProvider ?? "google"
      const providerSessionId =
        currentIdentityProviderRef.current === sourceProvider
          ? currentProviderSessionIdRef.current
          : undefined
      if (
        sourceProvider !== "google" &&
        (!accountValidationCompleteRef.current ||
          !currentHasGptkRef.current ||
          !providerSessionId)
      ) {
        setTrashWarningSafely(
          `Reconnect ${providerLabel(sourceProvider)} and wait for its page session to validate before scanning.`
        )
        requestHealthCheck(sourceProvider)
        return
      }
      const estimatedCount = getEstimatedScanCount(scanSettings)
      const scanGate = getScanGate(
        scanSettings,
        estimatedCount,
        actionEntitlement
      )
      if (!scanGate.allowed) {
        openTrackedUpgradePrompt(
          "scan",
          scanGate.reason === "full_scan_locked"
            ? "Full scan unlocks with Cleanup Pass or Lifetime Early Access."
            : scanGate.reason === "unscoped_scan_locked"
              ? `Your ${PLAN_LABELS[getEffectivePlanId(actionEntitlement)]} plan needs an album, date range, or smaller test batch before scanning.`
              : `This scan is above the ${scanGate.limit?.toLocaleString()} photo limit for ${PLAN_LABELS[getEffectivePlanId(actionEntitlement)]}.`
        )
        return
      }
      // A scan request is newer than any saved-review hydration that began
      // before the user committed this scan.
      reviewHydrationClosedRef.current = true
      scanReviewGenerationRef.current += 1
      invalidatePaidConversionContext()
      deferredUpgradeRef.current = null
      setDeferredUpgrade(null)
      settingsRef.current = scanSettings
      storedReviewScope.startReview()
      setTrashMovesThisSession(0)
      if (settingsOverride) {
        setSettings(fullScanSettingsPatch(scanSettings))
        await storedReviewScope.write({ settings: scanSettings })
      }

      const requestId = generateRequestId()
      const currentState = stateRef.current
      const hasGptk =
        currentState.status === "connected" ? currentState.hasGptk : true
      const accountEmail =
        currentState.status === "connected" || currentState.status === "results"
          ? currentState.accountEmail
          : undefined
      scanLifecycle.begin({
        requestId,
        settings: scanSettings,
        accountEmail,
        providerSessionId
      })
      setResumeCheckpoint(null)

      dispatch({
        type: "SCAN_STARTED",
        requestId,
        hasGptk,
        accountEmail,
        providerSessionId
      })

      console.log(
        `[GPD] starting scan: mode=${scanSettings.scanMode}, threshold=${scanSettings.similarityThreshold}`
      )

      // Load cached media items for incremental fetch. Scoped scans avoid the
      // incremental cache so a year/month result cannot poison a later full scan.
      cachedMediaItemsRef.current = null
      let sinceTimestamp: number | undefined
      let providerSyncToken: string | undefined
      let cachedTotalItems: number | undefined
      const dateRange = activeDateRange(scanSettings.dateRange)
      const scanScopeFingerprint = buildScanScopeFingerprint(scanSettings)
      const batchLimit = providerBatchLimitForEntitlement(scanSettings)
      const albumScope = albumScopeForProvider(
        sourceProvider,
        scanSettings.albumScope
      )
      try {
        const stored = await providerReviewStorage.get(
          ["scanResults"],
          sourceProvider
        )
        const prev = stored.scanResults
        const reusableSyncToken = prev
          ? scanLifecycle.reusableICloudSyncToken(prev, {
              accountEmail,
              sourceProvider,
              providerSessionId
            })
          : undefined
        const cachedSnapshotIsUsable =
          sourceProvider === "icloud"
            ? reusableSyncToken !== undefined
            : Boolean(
                prev?.mediaItems &&
                  Object.keys(prev.mediaItems).length > 0 &&
                  prev.mediaItemsAreComplete !== false &&
                  Object.keys(prev.mediaItems).length === prev.totalItems
              )
        if (
          !dateRange &&
          !albumScope &&
          !batchLimit &&
          (prev?.sourceProvider ?? "google") === sourceProvider &&
          !prev?.dateRange &&
          !prev?.albumScope &&
          prev?.mediaItems &&
          cachedSnapshotIsUsable &&
          areScanResultsValid(prev, {
            accountEmail,
            sourceProvider,
            providerSessionId
          })
        ) {
          cachedMediaItemsRef.current = prev.mediaItems
          providerSyncToken = reusableSyncToken
          cachedTotalItems = Number.isSafeInteger(prev.totalItems)
            ? prev.totalItems
            : undefined
          // Compute watermark if not stored (migration: first run after this deploy)
          sinceTimestamp =
            sourceProvider === "icloud"
              ? undefined
              : prev.scanWatermarkTimestamp ??
                prev.newestCreationTimestamp ??
                Object.values(prev.mediaItems).reduce(
                  (max, item) =>
                    Number.isFinite(item.creationTimestamp)
                      ? Math.max(max, item.creationTimestamp)
                      : max,
                  0
                )
          console.log(
            sourceProvider === "icloud"
              ? `[GPD] media items cache: ${Object.keys(prev.mediaItems).length} duplicate candidates, checking iCloud zone changes`
              : sourceProvider === "amazon"
                ? `[GPD] media items cache: ${Object.keys(prev.mediaItems).length} cached items, validating the full Amazon Photos inventory and reconciling the cache`
                : `[GPD] media items cache: ${Object.keys(prev.mediaItems).length} items, fetching since ${new Date(sinceTimestamp).toISOString()}`
          )
        }
      } catch {
        // Cache unavailable — do full fetch
      }
      if (!scanLifecycle.isCurrent(requestId)) return
      trackEvent({
        name: "scan_started",
        provider: scanSettings.sourceProvider ?? "google",
        scanMode: scanSettings.scanMode,
        photoCountBucket:
          estimatedCount !== undefined ? countBucket(estimatedCount) : undefined
      })

      sendToServiceWorker({
        app: APP_ID,
        action: "gptkCommand",
        command: "getAllMediaItems",
        requestId,
        provider: sourceProvider,
        args: {
          dateRange,
          albumScope,
          sinceTimestamp,
          ...(providerSyncToken ? { providerSyncToken, cachedTotalItems } : {}),
          limit: batchLimit,
          scanScopeFingerprint,
          ...(accountEmail ? { accountEmail } : {}),
          ...(providerSessionId ? { providerSessionId } : {})
        }
      })
    },
    [
      settings,
      invalidatePaidConversionContext,
      photoDataConsent,
      refreshTimeLimitedEntitlementForAction,
      openTrackedUpgradePrompt,
      storedReviewScope,
      trackEvent,
      requestHealthCheck,
      setTrashWarningSafely
    ]
  )

  const clearEmbeddingCache = useCallback(async (): Promise<number | null> => {
    let cache: EmbeddingCache | null = null
    try {
      cache = await EmbeddingCache.open()
      const before = await cache.count()
      await cache.clear()
      setCacheEntryCount(0)
      return before
    } finally {
      cache?.close()
    }
  }, [])

  const handleClearCache = useCallback(async () => {
    setCacheBusy(true)
    setCacheStatus(undefined)
    try {
      const removed = await clearEmbeddingCache()
      setCacheStatus(
        `Cleared ${(removed ?? 0).toLocaleString()} cached embedding${
          removed !== 1 ? "s" : ""
        }.`
      )
    } catch (error) {
      setCacheStatus(
        `Could not clear cache: ${error instanceof Error ? error.message : String(error)}`
      )
      await refreshEmbeddingCacheCount()
    } finally {
      setCacheBusy(false)
    }
  }, [clearEmbeddingCache, refreshEmbeddingCacheCount])

  const handleRebuildCache = useCallback(async () => {
    setCacheBusy(true)
    setCacheStatus(undefined)
    try {
      const removed = await clearEmbeddingCache()
      setCacheStatus(
        `Cleared ${(removed ?? 0).toLocaleString()} cached embedding${
          removed !== 1 ? "s" : ""
        }. Rebuilding on the next scan.`
      )
    } catch (error) {
      setCacheStatus(
        `Could not rebuild cache: ${error instanceof Error ? error.message : String(error)}`
      )
      setCacheBusy(false)
      await refreshEmbeddingCacheCount()
      return
    }
    setCacheBusy(false)
    handleStartScan()
  }, [clearEmbeddingCache, handleStartScan, refreshEmbeddingCacheCount])

  const handleExportCacheDiagnostics = useCallback(async () => {
    setCacheStatus(undefined)
    const currentState = stateRef.current
    const provider =
      scanLifecycle.checkpoint?.settings.sourceProvider ??
      settingsRef.current.sourceProvider ??
      "google"
    const photoCount =
      currentState.status === "results" || currentState.status === "trashing"
        ? currentState.totalItems
        : currentState.status === "scanning"
          ? currentState.totalEstimate
          : undefined
    const duplicateGroupCount =
      currentState.status === "results" || currentState.status === "trashing"
        ? currentState.groups.length
        : currentState.status === "scanning"
          ? currentState.partialGroups?.length
          : undefined
    const report = buildSupportDiagnosticsReport({
      version: chrome.runtime.getManifest().version,
      runtimeBuildIdentity: readRuntimeBuildIdentity(chrome.runtime),
      provider,
      scanMode: settingsRef.current.scanMode,
      entitlement,
      photoCountBucket:
        photoCount !== undefined ? countBucket(photoCount) : undefined,
      duplicateGroupCountBucket:
        duplicateGroupCount !== undefined
          ? countBucket(duplicateGroupCount)
          : undefined,
      errorCategory:
        currentState.status === "disconnected"
          ? "connection"
          : reportError
            ? "report"
            : trashWarning
              ? "trash"
              : undefined,
      recentLogs: [cacheStatus, reportError, trashWarning].filter(
        (value): value is string => Boolean(value)
      )
    })
    downloadTextFile({
      filename: `${report.reportId}.json`,
      contents: JSON.stringify(report, null, 2),
      type: "application/json"
    })
    setCacheStatus("Exported redacted support diagnostics.")
  }, [cacheStatus, entitlement, reportError, trashWarning])

  const handleResumeScan = useCallback(() => {
    if (!resumeCheckpoint) return
    const currentState = stateRef.current
    const accountEmail =
      currentState.status === "connected" || currentState.status === "results"
        ? currentState.accountEmail
        : resumeCheckpoint.accountEmail

    if (
      !scanLifecycle.canOfferResume(resumeCheckpoint, {
        accountEmail,
        sourceProvider: settingsRef.current.sourceProvider,
        providerSessionId:
          currentIdentityProviderRef.current ===
          (settingsRef.current.sourceProvider ?? "google")
            ? currentProviderSessionIdRef.current
            : undefined
      })
    ) {
      scanLifecycle.reset()
      setResumeCheckpoint(null)
      return
    }
    if (!scanLifecycle.canResumeWithinEntitlement(resumeCheckpoint, entitlement)) {
      openTrackedUpgradePrompt(
        "resume",
        "This saved scan is above your current resume limit. Upgrade to resume large-library scans."
      )
      return
    }

    reviewHydrationClosedRef.current = true
    scanReviewGenerationRef.current += 1
    invalidatePaidConversionContext()
    const checkpointItems = resumeCheckpoint.mediaItems
    if (checkpointItems && checkpointItems.length > 0) {
      const scanSettings = {
        ...resumeCheckpoint.settings,
        defaultKeepStrategy:
          resumeCheckpoint.settings.defaultKeepStrategy ??
          settingsRef.current.defaultKeepStrategy ??
          "best_quality"
      }
      settingsRef.current = scanSettings
      setSettings(fullScanSettingsPatch(scanSettings))
      void storedReviewScope.write({ settings: scanSettings })

      const requestId = generateRequestId()
      const hasGptk =
        currentState.status === "connected" ? currentState.hasGptk : true

      const resumed = scanLifecycle.resume({
        requestId,
        checkpoint: resumeCheckpoint,
        patch: {
          phase: "downloading_thumbnails",
          itemsProcessed: 0,
          totalEstimate: checkpointItems.length,
          message: `Resuming duplicate detection for ${checkpointItems.length.toLocaleString()} fetched items...`
        }
      })
      setResumeCheckpoint(null)

      dispatch({
        type: "SCAN_STARTED",
        requestId,
        hasGptk,
        accountEmail,
        providerSessionId: resumeCheckpoint.providerSessionId
      })
      dispatch({ type: "SCAN_MEDIA_FETCHED", mediaItems: checkpointItems })
      runDuplicateDetection(
        checkpointItems,
        resumed.signal,
        requestId,
        resumeCheckpoint.scanCoverage
      )
      return
    }
    handleStartScan(resumeCheckpoint.settings)
  }, [
    entitlement,
    handleStartScan,
    invalidatePaidConversionContext,
    openTrackedUpgradePrompt,
    resumeCheckpoint,
    runDuplicateDetection,
    storedReviewScope
  ])

  const handleDismissResume = useCallback(() => {
    reviewHydrationClosedRef.current = true
    scanReviewGenerationRef.current += 1
    setResumeCheckpoint(null)
    scanLifecycle.reset()
  }, [scanLifecycle])

  const handleTrash = useCallback(async () => {
    if (state.status !== "results") return
    if (!allCleanupScopeGroupsReviewed) {
      setTrashWarningSafely(
        `Review all ${cleanupScopeGroups.length.toLocaleString()} eligible duplicate sets across the current results before moving anything to Trash.`
      )
      return
    }
    const actionEntitlement = await refreshTimeLimitedEntitlementForAction()
    if (!actionEntitlement) return
    const unsupportedProvider = Object.values(state.mediaItems).find(
      (item) =>
        item.provider &&
        item.provider !== "google" &&
        item.provider !== "icloud" &&
        item.provider !== "amazon"
    )
    if (unsupportedProvider) {
      setTrashWarningSafely(
        `Trash is not available for ${providerLabel(unsupportedProvider.provider)} yet. Review and export the duplicate report instead.`
      )
      return
    }

    const plan = reviewSession.trashPlan(cleanupScopeGroups)
    const { dedupKeys, blockedMediaKeys } = plan

    if (blockedMediaKeys.length > 0) {
      const protectedFavorites = blockedMediaKeys.filter(
        (key) => favoriteStatusForItem(state.mediaItems[key]) === "favorite"
      ).length
      const otherBlocked = blockedMediaKeys.length - protectedFavorites
      setTrashWarningSafely(
        `${protectedFavorites.toLocaleString()} confirmed favorite${
          protectedFavorites === 1 ? "" : "s"
        } stayed protected. ${otherBlocked.toLocaleString()} other selected item${
          otherBlocked === 1 ? "" : "s"
        } stayed out because the provider identity is repeated or the relationship is review-only. Confirm only the remaining safe items after reviewing those sets.`
      )
    }

    if (dedupKeys.length === 0) return
    const currentProvider = settings.sourceProvider ?? "google"
    const preflight = scanLifecycle.reviewPreflight({
      scanProvider: state.sourceProvider ?? currentProvider,
      currentProvider,
      scanAccountEmail: state.accountEmail,
      currentAccountEmail:
        currentIdentityProviderRef.current === currentProvider
          ? currentAccountEmailRef.current
          : undefined,
      scanProviderSessionId: state.providerSessionId,
      currentProviderSessionId:
        currentIdentityProviderRef.current === currentProvider
          ? currentProviderSessionIdRef.current
          : undefined,
      scanDate: state.scanDate,
      scanScopeFingerprint: state.scopeFingerprint,
      currentScopeFingerprint: buildScanScopeFingerprint(settings),
      selectedCount: dedupKeys.length,
      connectionValidated:
        accountValidationComplete && currentHasGptkRef.current,
      requireFreshScan: true,
      requireKnownScope: true
    })
    if (!preflight.allowed) {
      setTrashWarningSafely(
        `Cleanup preflight blocked: ${preflight.reasons
          .map((item) => item.message)
          .join(" ")}`
      )
      return
    }
    setTrashPreflight(preflight)
    if (
      !canTrashCount(dedupKeys.length, actionEntitlement, trashMovesThisSession)
    ) {
      const limit = getPlanLimits(actionEntitlement).maxTrashMovesPerSession
      const remaining =
        limit === "unlimited"
          ? "unlimited"
          : Math.max(0, limit - trashMovesThisSession).toLocaleString()
      const remainingCount =
        limit === "unlimited"
          ? "unlimited"
          : Math.max(0, limit - trashMovesThisSession)
      openTrackedUpgradePrompt(
        "trash",
        `Your ${PLAN_LABELS[getEffectivePlanId(actionEntitlement)]} plan can move ${
          limit === "unlimited" ? "unlimited" : limit.toLocaleString()
        } item${limit === 1 ? "" : "s"} to Trash per session. You have ${remaining} remaining and selected ${dedupKeys.length.toLocaleString()}.`,
        {
          provider: settings.sourceProvider ?? "google",
          scopeLabel: scanScopeLabel(settings).label,
          scopeIsFullLibrary: scanScopeLabel(settings).fullLibrary,
          itemsChecked: state.totalItems,
          duplicateGroupCount: groups.length,
          visibleGroupCount: cleanupScopeGroups.length,
          selectedCleanupCount: dedupKeys.length,
          remainingTrashMoves: remainingCount
        }
      )
      return
    }
    setTrashConfirmCount("")
    setUnknownFavoriteTrashAcknowledged(false)
    setTrashConfirmSafely(plan)
  }, [
    allCleanupScopeGroupsReviewed,
    state,
    settings,
    groups,
    visibleGroups.length,
    cleanupScopeGroups,
    reviewSession,
    visibleGroups,
    mediaItems,
    refreshTimeLimitedEntitlementForAction,
    trashMovesThisSession,
    openTrackedUpgradePrompt,
    accountValidationComplete,
    trackEvent
  ])

  const handleCloseTrashConfirm = useCallback(() => {
    setTrashConfirmSafely(null)
    setTrashConfirmCount("")
    setUnknownFavoriteTrashAcknowledged(false)
    setTrashPreflight(null)
  }, [])

  const handleTrashConfirmed = useCallback(async () => {
    if (!trashConfirm || state.status !== "results") return
    const unknownFavoriteCount = trashConfirm.mediaKeysToTrash.filter(
      (key) => favoriteStatusForItem(state.mediaItems[key]) === "unknown"
    ).length
    if (unknownFavoriteCount > 0 && !unknownFavoriteTrashAcknowledged) {
      setTrashWarningSafely(
        `Favorite status is unknown for ${unknownFavoriteCount.toLocaleString()} selected item${unknownFavoriteCount === 1 ? "" : "s"}. Acknowledge the unknown status in the confirmation dialog before continuing.`
      )
      return
    }
    setReportError(null)
    const confirmedPlan = trashConfirm
    const generation = paidConversionGenerationRef.current
    const requestId = generateRequestId()

    const currentProvider = settings.sourceProvider ?? "google"
    const confirmationPreflight = scanLifecycle.reviewPreflight({
      scanProvider: state.sourceProvider ?? currentProvider,
      currentProvider,
      scanAccountEmail: state.accountEmail,
      currentAccountEmail:
        currentIdentityProviderRef.current === currentProvider
          ? currentAccountEmailRef.current
          : undefined,
      scanProviderSessionId: state.providerSessionId,
      currentProviderSessionId:
        currentIdentityProviderRef.current === currentProvider
          ? currentProviderSessionIdRef.current
          : undefined,
      scanDate: state.scanDate,
      scanScopeFingerprint: state.scopeFingerprint,
      currentScopeFingerprint: buildScanScopeFingerprint(settings),
      selectedCount: trashConfirm.dedupKeys.length,
      connectionValidated:
        accountValidationComplete && currentHasGptkRef.current,
      requireFreshScan: true,
      requireKnownScope: true
    })
    if (!confirmationPreflight.allowed) {
      setTrashWarningSafely(
        `Cleanup preflight blocked: ${confirmationPreflight.reasons
          .map((item) => item.message)
          .join(" ")}`
      )
      handleCloseTrashConfirm()
      return
    }

    const dispatchAuthorization = captureTrashDispatchAuthorization({
      generation,
      plan: confirmedPlan,
      provider: currentProvider,
      accountEmail:
        (currentIdentityProviderRef.current === currentProvider
          ? currentAccountEmailRef.current
          : undefined) ?? state.accountEmail,
      providerSessionId:
        currentIdentityProviderRef.current === currentProvider
          ? currentProviderSessionIdRef.current
          : undefined,
      scopeFingerprint:
        state.scopeFingerprint ?? buildScanScopeFingerprint(settings)
    })

    let command
    try {
      command = await trashLifecycle.begin({
        plan: confirmedPlan,
        requestId,
        reviewSession,
        groups: cleanupScopeGroups,
        snapshot: {
          mediaItems: state.mediaItems,
          groups: state.groups,
          totalItems: state.totalItems
        },
        batchPolicy: {
          batchSize: TRASH_BATCH_SIZE,
          batchPauseMs: TRASH_BATCH_PAUSE_MS,
          retryCount: TRASH_RETRY_COUNT,
          retryBackoffMs: TRASH_RETRY_BACKOFF_MS
        },
        accountEmail:
          (currentIdentityProviderRef.current === currentProvider
            ? currentAccountEmailRef.current
            : undefined) ?? state.accountEmail,
        providerSessionId:
          currentIdentityProviderRef.current === currentProvider
            ? currentProviderSessionIdRef.current
            : undefined,
        scopeFingerprint:
          state.scopeFingerprint ?? buildScanScopeFingerprint(settings),
        scopeLabel: scanScopeLabel(settings).label,
        unknownFavoriteAcknowledged: unknownFavoriteTrashAcknowledged
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setReportError(`Could not save the pre-trash report: ${message}`)
      return
    }
    if (generation !== paidConversionGenerationRef.current) {
      trashLifecycle.reset()
      return
    }

    // Saving the pre-trash report is an await boundary. Rebuild the plan and
    // authorization from refs after it completes so a selection, provider,
    // account, scope, or entitlement transition cannot dispatch the old
    // command. The paid-access generation covers entitlement changes; the
    // exact plan fingerprint covers every destructive provider identifier.
    const latestState = stateRef.current
    if (latestState.status !== "results") {
      trashLifecycle.reset()
      setTrashWarningSafely(
        "Cleanup review changed while preparing the provider request. Review the current results again before moving anything to Trash."
      )
      handleCloseTrashConfirm()
      return
    }
    const latestSettings = settingsRef.current
    const latestProvider = latestSettings.sourceProvider ?? "google"
    const latestScopeFingerprint =
      latestState.scopeFingerprint ?? buildScanScopeFingerprint(latestSettings)
    const latestGroups = latestState.groups
    const latestMediaItems = latestState.mediaItems
    const latestCleanupScopeGroups = getVisibleGroups(
      latestGroups,
      entitlementRef.current
    )
    const latestReviewSession = new DuplicateReviewSession({
      groups: latestGroups,
      mediaItems: latestMediaItems,
      selections: reviewSelectionsRef.current,
      defaultStrategy: settingsRef.current.defaultKeepStrategy
    })
    const latestAllCleanupGroupsReviewed =
      latestCleanupScopeGroups.length > 0 &&
      latestCleanupScopeGroups.every((group) =>
        latestReviewSession.reviewedGroupIds.has(group.id)
      )
    const latestPlan = latestReviewSession.trashPlan(latestCleanupScopeGroups)
    const latestScanProvider = latestState.sourceProvider ?? latestProvider
    const latestAccountEmail =
      (currentIdentityProviderRef.current === latestProvider
        ? currentAccountEmailRef.current
        : undefined) ?? latestState.accountEmail
    const latestPreflight = scanLifecycle.reviewPreflight({
      scanProvider: latestScanProvider,
      currentProvider: latestProvider,
      scanAccountEmail: latestState.accountEmail,
      currentAccountEmail: latestAccountEmail,
      scanProviderSessionId: latestState.providerSessionId,
      currentProviderSessionId:
        currentIdentityProviderRef.current === latestProvider
          ? currentProviderSessionIdRef.current
          : undefined,
      scanDate: latestState.scanDate,
      scanScopeFingerprint: latestState.scopeFingerprint,
      currentScopeFingerprint: buildScanScopeFingerprint(latestSettings),
      selectedCount: latestPlan.dedupKeys.length,
      connectionValidated:
        accountValidationCompleteRef.current && currentHasGptkRef.current,
      requireFreshScan: true,
      requireKnownScope: true
    })
    const latestAuthorization = captureTrashDispatchAuthorization({
      generation: paidConversionGenerationRef.current,
      plan: latestPlan,
      provider: latestProvider,
      accountEmail: latestAccountEmail,
      providerSessionId:
        currentIdentityProviderRef.current === latestProvider
          ? currentProviderSessionIdRef.current
          : undefined,
      scopeFingerprint: latestScopeFingerprint
    })
    const dispatchStillAuthorized =
      trashConfirmRef.current === confirmedPlan &&
      latestScanProvider === latestProvider &&
      confirmedPlan.provider === currentProvider &&
      latestPlan.provider === latestProvider &&
      latestAllCleanupGroupsReviewed &&
      latestPreflight.allowed &&
      isTrashDispatchAuthorizationCurrent(
        dispatchAuthorization,
        latestAuthorization
      )
    if (!dispatchStillAuthorized) {
      trashLifecycle.reset()
      setTrashWarningSafely(
        "Cleanup review changed while preparing the provider request. Review the current results again before moving anything to Trash."
      )
      handleCloseTrashConfirm()
      return
    }

    handleCloseTrashConfirm()
    setTrashWarningSafely(null)

    trashGenerationByRequestRef.current.set(requestId, generation)

    dispatch({
      type: "TRASH_STARTED",
      totalToTrash: command.totalToTrash,
      mediaItems: latestState.mediaItems,
      groups: latestState.groups,
      totalItems: latestState.totalItems,
      sourceProvider: latestState.sourceProvider ?? latestProvider,
      providerSessionId: latestState.providerSessionId,
      scanDate: latestState.scanDate,
      scopeFingerprint: latestState.scopeFingerprint ?? latestScopeFingerprint
    })

    trackEvent({ name: "trash_attempted", provider: command.provider,
      photoCountBucket: countBucket(command.totalToTrash) })
    sendToServiceWorker({
      app: APP_ID,
      action: "gptkCommand",
      command: "trashItems",
      requestId,
      provider: command.provider,
      args: command.args
    })
    const timeoutId = window.setTimeout(() => {
      trashTimeoutByRequestRef.current.delete(requestId)
      if (trashGenerationByRequestRef.current.get(requestId) !== generation) {
        return
      }
      void trashLifecycle
        .timeout({ requestId })
        .then((outcome) => {
          if (
            trashGenerationByRequestRef.current.get(requestId) !== generation
          ) {
            return
          }
          trackEvent({ name: "error", provider: command.provider, errorCategory: "trash" })
          if (outcome.kind === "partial") {
            dispatch({
              type: "TRASH_COMPLETE",
              trashedKeys: outcome.movedMediaKeys
            })
            setTrashMovesThisSession((count) => count + outcome.movedCount)
            setUndoDataSafely(outcome.undo)
          } else if (outcome.kind === "unknown") {
            dispatch({
              type: "TRASH_ERROR",
              error: outcome.error
            })
          }
          setTrashWarningSafely(
            outcome.kind === "partial"
              ? `${outcome.message ?? "Trash request timed out."} ${outcome.movedCount.toLocaleString()} confirmed move${outcome.movedCount === 1 ? "" : "s"} can be restored. Unresolved targets will not be retried. PhotoSweep will reconcile a late result if it arrives.`
              : "The provider has not confirmed this Trash request yet. Do not retry; PhotoSweep will reconcile a late result if it arrives."
          )
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          setReportError(`Could not record the Trash timeout: ${message}`)
        })
    }, TRASH_REQUEST_TIMEOUT_MS)
    trashTimeoutByRequestRef.current.set(requestId, timeoutId)
  }, [
    trashConfirm,
    unknownFavoriteTrashAcknowledged,
    state,
    settings,
    accountValidationComplete,
    reviewSession,
    cleanupScopeGroups,
    handleCloseTrashConfirm,
    trackEvent,
    trashLifecycle,
    setUndoDataSafely,
    setTrashWarningSafely
  ])

  const handlePauseScan = useCallback(() => {
    invalidatePaidConversionContext()
    const cancelTarget = providerScanCancellationTarget(
      scanLifecycle.checkpoint,
      scanLifecycle.requestId
    )
    const paused = scanLifecycle.pause()
    if (paused && cancelTarget) {
      cancelProviderScanRequest(cancelTarget.requestId, cancelTarget.provider)
    }
    deferredUpgradeRef.current = null
    setDeferredUpgrade(null)
    if (paused) setResumeCheckpoint(paused)
    dispatch({ type: "SCAN_CANCELLED" })
  }, [invalidatePaidConversionContext, scanLifecycle])

  const handleReset = useCallback(() => {
    reviewHydrationClosedRef.current = true
    scanReviewGenerationRef.current += 1
    invalidatePaidConversionContext()
    cancelHealthCheckRetry()
    const cancelTarget = providerScanCancellationTarget(
      scanLifecycle.checkpoint,
      scanLifecycle.requestId
    )
    if (cancelTarget) {
      cancelProviderScanRequest(cancelTarget.requestId, cancelTarget.provider)
    }
    scanLifecycle.reset()
    trashLifecycle.reset()
    cachedMediaItemsRef.current = null
    deferredUpgradeRef.current = null
    setDeferredUpgrade(null)
    pendingSelectionsRef.current = null
    autoSelectNextResultsRef.current = false
    setResumeCheckpoint(null)
    setSelectedGroupIds(new Set())
    setReviewedGroupIds(new Set())
    setKeptOverrides({})
    setTrashConfirmSafely(null)
    setTrashConfirmCount("")
    setTrashPreflight(null)
    setTrashWarningSafely(null)
    setTrashMovesThisSession(0)
    setReportError(null)
    setUndoDataSafely(null)
    currentAccountEmailRef.current = undefined
    currentProviderSessionIdRef.current = undefined
    currentIdentityProviderRef.current = undefined
    currentHasGptkRef.current = false
    setAccountValidationComplete(false)
    const resetProvider = settingsRef.current.sourceProvider ?? "google"
    void storedReviewScope.invalidateReview(
      () => true,
      undefined,
      resetProvider
    )
    void storedReviewScope.write({ checkpoint: null }, undefined, resetProvider)
    dispatch({ type: "RESET" })
    if (photoDataConsent === true) {
      requestHealthCheck(settingsRef.current.sourceProvider ?? "google")
    } else {
      healthCheckAttemptsRef.current = 0
    }
  }, [
    cancelHealthCheckRetry,
    invalidatePaidConversionContext,
    photoDataConsent,
    requestHealthCheck,
    scanLifecycle,
    storedReviewScope,
    trashLifecycle
  ])
  resetReviewRef.current = handleReset

  const openProviderFromSidePanel = useCallback(
    async (provider: PhotoProvider): Promise<LaunchProviderResult> => {
      if (photoDataConsent !== true) {
        return {
          success: false,
          provider,
          error:
            "Accept the PhotoSweep data-use notice before opening a provider."
        }
      }
      let hostTabId = sidePanelHostTabIdRef.current
      try {
        if (hostTabId === null && isSidePanel && chrome.tabs?.query) {
          const [activeTab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
          })
          if (
            activeTab?.id !== undefined &&
            !activeTab.url?.startsWith("chrome-extension://")
          ) {
            hostTabId = activeTab.id
            sidePanelHostTabIdRef.current = activeTab.id
          }
        }

        const result = await sendToServiceWorker<LaunchProviderResult>({
          app: APP_ID,
          action: "launchProvider",
          provider,
          hostTabId: hostTabId ?? undefined
        })
        if (result?.success && typeof result.tabId === "number") {
          sidePanelHostTabIdRef.current = result.tabId
        }
        return (
          result ?? {
            success: false,
            provider,
            error: `Chrome did not respond while opening ${providerLabel(provider)}. Try clicking the extension on the photo tab again.`
          }
        )
      } catch (error) {
        return {
          success: false,
          provider,
          error:
            error instanceof Error
              ? error.message
              : `Unable to open ${providerLabel(provider)}.`
        }
      }
    },
    [isSidePanel, photoDataConsent]
  )

  const handleOpenProvider = useCallback(
    (provider: PhotoProvider) => {
      if (photoDataConsent !== true) return
      reviewHydrationClosedRef.current = true
      scanReviewGenerationRef.current += 1
      providerConnectionTrackerRef.current.reset()
      invalidatePaidConversionContext()
      cancelHealthCheckRetry()
      setSidePanelSourceConfirmed(true)
      scanLifecycle.reset()
      cachedMediaItemsRef.current = null
      deferredUpgradeRef.current = null
      setDeferredUpgrade(null)
      pendingSelectionsRef.current = null
      setResumeCheckpoint(null)
      setSelectedGroupIds(new Set())
      setReviewedGroupIds(new Set())
      setKeptOverrides({})
      setSettings({
        sourceProvider: provider,
        albumScope:
          settingsRef.current.sourceProvider === provider
            ? settingsRef.current.albumScope
            : undefined
      })
      void storedReviewScope.write({ checkpoint: null }, undefined, provider)
      dispatch({ type: "RESET" })
      healthCheckAttemptsRef.current = 0
      currentAccountEmailRef.current = undefined
      currentProviderSessionIdRef.current = undefined
      currentIdentityProviderRef.current = undefined
      currentHasGptkRef.current = false
      setAmazonProfile(null)
      setAccountValidationComplete(false)
      void openProviderFromSidePanel(provider).then((result) => {
        if (!result.success) {
          dispatch({
            type: "HEALTH_CHECK_RESULT",
            payload: {
              app: APP_ID,
              action: "healthCheck.result",
              success: false,
              hasGptk: false,
              provider,
              error: result.error
            }
          })
          return
        }
        window.setTimeout(
          () => {
            requestHealthCheck(provider)
          },
          result.alreadyOpen ? 250 : 900
        )
      })
    },
    [
      cancelHealthCheckRetry,
      invalidatePaidConversionContext,
      openProviderFromSidePanel,
      photoDataConsent,
      requestHealthCheck,
      scanLifecycle,
      storedReviewScope
    ]
  )

  const handleUndo = useCallback(async () => {
    if (
      !undoData ||
      restoreInFlightRef.current ||
      restoreCommitInFlightRef.current
    ) {
      return
    }
    const currentProvider = settingsRef.current.sourceProvider ?? "google"
    const identityIsCurrent =
      currentIdentityProviderRef.current === currentProvider
    const currentSessionId = identityIsCurrent
      ? currentProviderSessionIdRef.current
      : undefined
    const currentEmail = identityIsCurrent
      ? currentAccountEmailRef.current
      : undefined
    const preflight = scanLifecycle.reviewPreflight({
      scanProvider: undoData.provider,
      currentProvider,
      scanAccountEmail: undoData.accountEmail,
      currentAccountEmail: currentEmail,
      scanProviderSessionId: undoData.providerSessionId,
      currentProviderSessionId: currentSessionId,
      selectedCount: undoData.dedupKeys.length,
      connectionValidated:
        accountValidationCompleteRef.current && currentHasGptkRef.current
    })
    if (!preflight.allowed) {
      setTrashWarningSafely(
        `Restore preflight blocked: ${preflight.reasons
          .map((item) => item.message)
          .join(" ")}`
      )
      return
    }
    if (!currentSessionId || (currentProvider === "google" && !currentEmail)) {
      setTrashWarningSafely(
        "Restore preflight blocked: reconnect and complete a fresh provider health check before restoring."
      )
      return
    }
    const sessionBoundUndo: TrashUndoData = {
      ...undoData,
      providerSessionId: currentSessionId,
      ...(currentEmail ? { accountEmail: currentEmail } : {})
    }
    if (!sessionBoundUndo.operationId) {
      setTrashWarningSafely(
        "Restore was not sent because its durable recovery record is missing. Run a fresh scoped scan and verify the provider Trash state before trying again."
      )
      return
    }
    const requestId = generateRequestId()
    const restore = trashLifecycle.beginRestore(sessionBoundUndo, requestId)
    restoreInFlightRef.current = true
    restoreCommitInFlightRef.current = true
    restoreGenerationRef.current = paidConversionGenerationRef.current
    const restoreRequest = {
      operationId: sessionBoundUndo.operationId,
      generation: paidConversionGenerationRef.current,
      history: false,
      provider: restore.provider,
      ...(restore.args.accountEmail
        ? { accountEmail: restore.args.accountEmail }
        : {}),
      providerSessionId: restore.args.providerSessionId!
    }
    restoreRequestByIdRef.current.set(requestId, restoreRequest)
    setRecoveryHistoryBusyId(sessionBoundUndo.operationId)
    try {
      await persistRestoreDispatchIntentSafely(
        sessionBoundUndo.operationId,
        requestId,
        restore.args.dedupKeys
      )
    } catch (error) {
      trashLifecycle.cancelRestore(requestId)
      restoreRequestByIdRef.current.delete(requestId)
      restoreGenerationRef.current = null
      restoreInFlightRef.current = false
      restoreCommitInFlightRef.current = false
      setRecoveryHistoryBusyId(null)
      const message = error instanceof Error ? error.message : String(error)
      setReportError(`Could not save the restore safety record: ${message}`)
      setTrashWarningSafely(
        "Restore was not sent because its per-target recovery guard could not be saved. No provider targets were dispatched."
      )
      return
    }
    if (!isRestoreRequestCurrent(restoreRequest)) {
      trashLifecycle.cancelRestore(requestId)
      try {
        await persistRestoreStatusSafely(
          sessionBoundUndo.operationId,
          notDispatchedRestoreStatus(
            requestId,
            restore.args.dedupKeys,
            "provider-session-changed-before-dispatch"
          )
        )
        restoreRequestByIdRef.current.delete(requestId)
        restoreGenerationRef.current = null
        restoreInFlightRef.current = false
        restoreCommitInFlightRef.current = false
        setRecoveryHistoryBusyId(null)
        setTrashWarningSafely(
          "Restore was not sent because the provider session changed while its safety record was being saved. Reconnect and verify the provider before starting a new restore."
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setReportError(`Could not finalize the unsent restore guard: ${message}`)
        setTrashWarningSafely(
          "Restore was not sent. Its durable pre-dispatch guard remains ambiguous, so targets are locked from automatic retry until you reload and review recovery history."
        )
      }
      return
    }
    restoreCommitInFlightRef.current = false
    ratingPromptDeferredRef.current = false
    autoSelectNextResultsRef.current = false
    pendingSelectionsRef.current = {
      selectedGroupIds: new Set(),
      reviewedGroupIds: new Set(),
      keptOverrides: {}
    }
    // Optimistically restore the UI to the pre-trash state
    dispatch({
      type: "RESTORE_SNAPSHOT",
      mediaItems: sessionBoundUndo.snapshot.mediaItems,
      groups: sessionBoundUndo.snapshot.groups,
      totalItems: sessionBoundUndo.snapshot.totalItems
    })
    // Call GPTK to restore from trash
    trackEvent({ name: "undo_attempted", provider: restore.provider,
      photoCountBucket: countBucket(restore.args.dedupKeys.length) })
    sendToServiceWorker({
      app: APP_ID,
      action: "gptkCommand",
      command: "restoreItems",
      requestId,
      provider: restore.provider,
      args: restore.args
    })
    scheduleRestoreTimeout(requestId, paidConversionGenerationRef.current)
    setUndoDataSafely(null)
    setTrashWarningSafely(null)
  }, [
    isRestoreRequestCurrent,
    persistRestoreDispatchIntentSafely,
    persistRestoreStatusSafely,
    scheduleRestoreTimeout,
    setRecoveryHistoryBusyId,
    setReportError,
    setTrashWarningSafely,
    setUndoDataSafely,
    trackEvent,
    trashLifecycle,
    undoData
  ])

  const handleUndoClose = useCallback(() => {
    setUndoDataSafely(null)
  }, [])

  const handleRestoreHistory = useCallback(
    async (record: RecoveryHistoryRecord) => {
      if (
        !isRecoveryRestorable(record) ||
        recoveryHistoryBusyId ||
        restoreInFlightRef.current ||
        restoreCommitInFlightRef.current
      ) {
        return
      }
      const currentProvider = settingsRef.current.sourceProvider ?? "google"
      const identityIsCurrent =
        currentIdentityProviderRef.current === currentProvider
      const currentSessionId = identityIsCurrent
        ? currentProviderSessionIdRef.current
        : undefined
      const currentEmail = identityIsCurrent
        ? currentAccountEmailRef.current
        : undefined
      const preflight = evaluateRecoveryRestorePreflight({
        recordProvider: record.provider,
        currentProvider,
        recordAccountFingerprint: record.accountFingerprint,
        currentAccountEmail: currentEmail,
        recordProviderSessionId: record.providerSessionId,
        currentProviderSessionId: currentSessionId,
        connectionValidated:
          accountValidationComplete && currentHasGptkRef.current
      })
      if (!preflight.allowed) {
        setTrashWarningSafely(
          `Recovery preflight blocked: ${preflight.reasons
            .map((item) => item.message)
            .join(" ")}`
        )
        return
      }
      if (!currentSessionId || (record.provider === "google" && !currentEmail)) {
        setTrashWarningSafely(
          "Recovery preflight blocked: reconnect and complete a fresh provider health check before restoring."
        )
        return
      }
      const requestId = generateRequestId()
      const undo: TrashUndoData = {
        operationId: record.operationId,
        provider: record.provider,
        dedupKeys: record.restorableDedupKeys,
        count: record.restorableDedupKeys.length,
        snapshot: { mediaItems: {}, groups: [], totalItems: 0 },
        providerSessionId: currentSessionId,
        ...(currentEmail ? { accountEmail: currentEmail } : {}),
        ...(record.icloudAssetRefs
          ? { icloudAssetRefs: record.icloudAssetRefs }
          : {})
      }
      const restore = trashLifecycle.beginRestore(undo, requestId)
      const restoreRequest = {
        operationId: record.operationId,
        generation: paidConversionGenerationRef.current,
        history: true,
        provider: restore.provider,
        ...(restore.args.accountEmail
          ? { accountEmail: restore.args.accountEmail }
          : {}),
        providerSessionId: restore.args.providerSessionId!
      }
      restoreRequestByIdRef.current.set(requestId, restoreRequest)
      restoreGenerationRef.current = paidConversionGenerationRef.current
      restoreInFlightRef.current = true
      restoreCommitInFlightRef.current = true
      setRecoveryHistoryBusyId(record.operationId)
      setTrashWarningSafely(null)
      try {
        await persistRestoreDispatchIntentSafely(
          record.operationId,
          requestId,
          restore.args.dedupKeys
        )
      } catch (error) {
        trashLifecycle.cancelRestore(requestId)
        restoreRequestByIdRef.current.delete(requestId)
        restoreGenerationRef.current = null
        restoreInFlightRef.current = false
        restoreCommitInFlightRef.current = false
        setRecoveryHistoryBusyId(null)
        const message = error instanceof Error ? error.message : String(error)
        setReportError(`Could not save the restore safety record: ${message}`)
        setTrashWarningSafely(
          "Restore was not sent because its per-target recovery guard could not be saved. No provider targets were dispatched."
        )
        return
      }
      if (!isRestoreRequestCurrent(restoreRequest)) {
        trashLifecycle.cancelRestore(requestId)
        try {
          await persistRestoreStatusSafely(
            record.operationId,
            notDispatchedRestoreStatus(
              requestId,
              restore.args.dedupKeys,
              "provider-session-changed-before-dispatch"
            )
          )
          restoreRequestByIdRef.current.delete(requestId)
          restoreGenerationRef.current = null
          restoreInFlightRef.current = false
          restoreCommitInFlightRef.current = false
          setRecoveryHistoryBusyId(null)
          setTrashWarningSafely(
            "Restore was not sent because the provider session changed while its safety record was being saved. Reconnect and verify the provider before starting a new restore."
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          setReportError(`Could not finalize the unsent restore guard: ${message}`)
          setTrashWarningSafely(
            "Restore was not sent. Its durable pre-dispatch guard remains ambiguous, so targets are locked from automatic retry until you reload and review recovery history."
          )
        }
        return
      }
      restoreCommitInFlightRef.current = false
      setRecoveryHistoryOpen(false)
      trackEvent({ name: "undo_attempted", provider: restore.provider,
        photoCountBucket: countBucket(restore.args.dedupKeys.length) })
      sendToServiceWorker({
        app: APP_ID,
        action: "gptkCommand",
        command: "restoreItems",
        requestId,
        provider: restore.provider,
        args: restore.args
      })
      scheduleRestoreTimeout(requestId, paidConversionGenerationRef.current)
    },
    [
      accountValidationComplete,
      isRestoreRequestCurrent,
      persistRestoreDispatchIntentSafely,
      persistRestoreStatusSafely,
      recoveryHistoryBusyId,
      scheduleRestoreTimeout,
      setRecoveryHistoryBusyId,
      setReportError,
      setTrashWarningSafely,
      trackEvent,
    trashLifecycle
    ]
  )

  const handleClearRecoveryHistory = useCallback(async () => {
    try {
      const retained = await requestRecoveryHistoryTransaction({ kind: "clear" })
      setRecoveryHistorySafely(retained)
      if (retained.length > 0) {
        setTrashWarningSafely(
          "Completed recovery history was cleared. Pending or ambiguous provider operations remain protected until their exact outcome is verified."
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setReportError(`Could not clear recovery history: ${message}`)
    }
  }, [setRecoveryHistorySafely, setReportError, setTrashWarningSafely])

  const handleClearDecisionMemory = useCallback(() => {
    void decisionMemoryStore
      .clear()
      .then(() => {
        setTrashWarningSafely(
          "Remembered review decisions cleared. Future scans will start neutral."
        )
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setReportError(`Could not clear remembered decisions: ${message}`)
      })
  }, [decisionMemoryStore, setTrashWarningSafely])

  // Fire confetti when trash completes
  useEffect(() => {
    if (!undoData) return
    if (prefersReducedMotion) return
    confetti({
      particleCount: 200,
      spread: 100,
      origin: { y: 0.7 }
    })
  }, [undoData, prefersReducedMotion])

  // Compute duplicate count for ActionBar
  const duplicateCount =
    state.status === "results"
      ? cleanupTrashPlan.mediaKeysToTrash.length
      : 0
  const includedGroupCount = cleanupScopeGroups.filter((group) =>
    reviewSession.selectedGroupIds.has(group.id)
  ).length
  const workflowStage =
    state.status === "scanning"
      ? "scan"
      : state.status === "results"
        ? groups.length > 0
          ? "review"
          : "done"
        : state.status === "trashing"
          ? "trash"
          : "setup"
  const workflowTotalItems =
    state.status === "results" || state.status === "trashing"
      ? state.totalItems
      : state.status === "scanning"
        ? state.partialTotalItems ?? state.totalEstimate
        : 0
  const workflowGroups =
    state.status === "results" || state.status === "trashing"
      ? groups
      : state.status === "scanning"
        ? state.partialGroups ?? []
        : []
  const workflowExactGroupCount = workflowGroups.filter((group) => {
    return (
      Object.keys(displayMediaItems).length > 0 &&
      classifyDuplicateGroup(group, displayMediaItems).duplicateKind === "exact"
    )
  }).length
  const workflowSimilarGroupCount =
    workflowGroups.length - workflowExactGroupCount
  const workflowDuplicateCount =
    state.status === "trashing"
      ? Math.max(0, state.totalToTrash - state.trashedSoFar)
      : duplicateCount
  const workflowScanDetail =
    state.status === "scanning"
      ? state.totalEstimate > 0
        ? `${state.itemsProcessed.toLocaleString()} of ${state.totalEstimate.toLocaleString()}`
        : `${state.itemsProcessed.toLocaleString()} checked`
      : undefined
  const showWorkflowRail =
    !isSidePanel ||
    state.status === "scanning" ||
    state.status === "results" ||
    state.status === "trashing"
  const sourceProvider = settings.sourceProvider ?? "google"
  const amazonProfileName =
    sourceProvider === "amazon" &&
    "providerSessionId" in state &&
    amazonProfile?.providerSessionId === state.providerSessionId
      ? amazonProfile.displayName
      : undefined
  const sidePanelHasConnection =
    state.status === "connected" ||
    state.status === "scanning" ||
    state.status === "results" ||
    state.status === "trashing"
  const sourceStepComplete = sidePanelSourceConfirmed || sidePanelHasConnection
  const scopeStepComplete =
    state.status === "scanning" ||
    state.status === "results" ||
    state.status === "trashing"
  const scanStepComplete =
    state.status === "results" || state.status === "trashing"
  const sidePanelSteps: SidePanelStepItem[] = [
    {
      index: 1,
      title: "Source",
      status: sourceStepComplete ? "complete" : "active"
    },
    {
      index: 2,
      title: "Sign in",
      status: sidePanelHasConnection
        ? "complete"
        : sourceStepComplete
          ? "active"
          : "locked"
    },
    {
      index: 3,
      title: "Scope",
      status: scopeStepComplete
        ? "complete"
        : state.status === "connected"
          ? "active"
          : "locked"
    },
    {
      index: 4,
      title: "Scan",
      status: scanStepComplete
        ? "complete"
        : state.status === "scanning"
          ? "active"
          : "locked"
    },
    {
      index: 5,
      title: "Review",
      status:
        state.status === "results" || state.status === "trashing"
          ? "active"
          : "locked"
    }
  ]

  const analyticsConsentNotice = licenseApiBaseUrl ? (
    analyticsConsent === null ? (
      <Alert
        severity="info"
        sx={{ mb: isSidePanel ? 0 : 1.25, alignItems: "center" }}
        action={
          <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
            <Button
              color="inherit"
              size="small"
              onClick={() => saveAnalyticsConsent(false)}>
              No thanks
            </Button>
            <Button
              color="inherit"
              size="small"
              variant="outlined"
              onClick={() => saveAnalyticsConsent(true)}>
              Allow
            </Button>
          </Box>
        }>
        <Typography variant="body2" fontWeight={700}>
          Optional private usage metrics
        </Typography>
        <Typography variant="caption">
          PhotoSweep shares event names, provider, plan, scan mode, count
          ranges, error categories, event reasons and outcomes, a random install
          identifier, extension version, and UTC day. Photo content, filenames, albums, URLs,
          and reports are never included.
        </Typography>
      </Alert>
    ) : (
      <Box
        sx={{
          mb: isSidePanel ? 0 : 1.25,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          px: 1.25,
          py: 0.5,
          borderBottom: "1px solid",
          borderColor: "divider"
        }}>
        <Typography variant="caption" color="text.secondary">
          Usage metrics {analyticsConsent ? "on" : "off"} · no photo content
        </Typography>
        <Button size="small" onClick={resetAnalyticsConsent}>
          Change
        </Button>
      </Box>
    )
  ) : null

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          body: {
            background: photoSweepColors.canvasTop,
            overflowX: "hidden",
            scrollbarGutter: "stable"
          },
          "#__plasmo": {
            minWidth: 0,
            minHeight: "100vh"
          },
          "*:focus-visible": {
            outline: `3px solid ${photoSweepColors.primary}`,
            outlineOffset: 2
          }
        }}
      />

      {!isSidePanel && (
        <AppBar position="sticky" elevation={0}>
          <Toolbar
            sx={{
              gap: 1.25,
              maxWidth: 1520,
              width: "100%",
              mx: "auto",
              px: { xs: 2, md: 3 }
            }}>
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: 1,
                display: "grid",
                placeItems: "center",
                bgcolor: "primary.main",
                color: "primary.contrastText"
              }}>
              <PhotoLibraryRoundedIcon fontSize="small" />
            </Box>
            <Typography
              variant="h6"
              fontWeight={700}
              noWrap
              sx={{
                flexGrow: 1,
                letterSpacing: 0
              }}>
              PhotoSweep
            </Typography>
            {"accountEmail" in state && state.accountEmail ? (
              <Typography
                variant="body2"
                color="text.secondary"
                noWrap
                title={`Signed in as ${state.accountEmail}`}
                sx={{ maxWidth: "32vw", fontSize: 12 }}>
                Signed in · {state.accountEmail}
              </Typography>
            ) : sourceProvider === "amazon" && amazonProfileName ? (
              <Typography
                variant="body2"
                color="text.secondary"
                noWrap
                title="The Amazon profile name is for display only; PhotoSweep binds this session using the current Photos page.">
                Amazon Photos profile: {amazonProfileName} · session only
              </Typography>
            ) : null}
            {recoveryHistory.length > 0 && (
              <Button
                size="small"
                startIcon={<HistoryRoundedIcon />}
                onClick={() => setRecoveryHistoryOpen(true)}>
                Recovery · {recoveryHistory.length}
              </Button>
            )}
            {recoveryHistoryReadError && (
              <Button
                size="small"
                color="warning"
                onClick={() => setRecoveryHistoryOpen(true)}>
                Recovery unavailable
              </Button>
            )}
          </Toolbar>
        </AppBar>
      )}

      {/* Main content */}
      <Box
        component="main"
        className={isSidePanel ? "photosweep-panel" : "photosweep-page"}
        sx={{
          maxWidth: isSidePanel
            ? "100%"
            : state.status === "results" && groups.length > 0
              ? 1520
              : 1360,
          mx: "auto",
          px: isSidePanel ? { xs: 1.5, sm: 2 } : { xs: 2, md: 3 },
        py: isSidePanel ? 1 : { xs: 2, md: 3 },
          minHeight: isSidePanel ? "100vh" : "calc(100vh - 64px)",
          background: "transparent",
          "&.photosweep-panel": { width: "100%" },
          "&.photosweep-page": { width: "100%" }
        }}>
        {!isSidePanel && analyticsConsentNotice}
        {isSidePanel ? (
          <Box
            sx={{
              display: "grid",
              gap: 0.75,
              pb: 1
            }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1
              }}>
              <SidePanelBrandHeader />
              <Button
                size="small"
                startIcon={<HistoryRoundedIcon />}
                onClick={() => setRecoveryHistoryOpen(true)}
                sx={{ minHeight: 36, fontWeight: 600 }}>
                {recoveryHistoryReadError
                  ? "Recovery"
                  : recoveryHistory.length > 0
                    ? `Recovery · ${recoveryHistory.length}`
                    : "Recovery"}
              </Button>
            </Box>
            {analyticsConsentNotice}
            {recoveryHistoryReadError && (
              <Alert severity="warning" sx={{ py: 0.5 }}>
                Recovery history is unavailable. Restore actions are paused.
              </Alert>
            )}

            <SidePanelSourceBar
              provider={sourceProvider}
              connected={sidePanelHasConnection}
              onProviderChange={handleOpenProvider}
            />

            <SidePanelTimelineProgress steps={sidePanelSteps} />

            <SidePanelTimelineStep
              status={sourceStepComplete ? "complete" : "active"}>
              <Button
                variant="contained"
                fullWidth
                endIcon={<OpenInNewRoundedIcon />}
                onClick={() => handleOpenProvider(sourceProvider)}
                sx={{ minHeight: 42, borderRadius: 2, fontWeight: 850 }}>
                Continue
              </Button>
            </SidePanelTimelineStep>

            <SidePanelTimelineStep
              status={
                sidePanelHasConnection
                  ? "complete"
                  : sourceStepComplete
                    ? "active"
                    : "locked"
              }>
              {state.status === "disconnected" && (
                <Alert severity="warning" sx={{ py: 0.6 }}>
                  {state.error}
                </Alert>
              )}
              {state.status === "disconnected" && state.scanCoverage && (
                <ScanCoverageNotice coverage={state.scanCoverage} compact />
              )}
              {state.status === "connecting" && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    color: "text.secondary"
                  }}>
                  <CircularProgress size={16} thickness={5} />
                  <Typography variant="body2">
                    Checking the open {providerLabel(sourceProvider)} tab...
                  </Typography>
                </Box>
              )}
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns:
                    state.status === "disconnected" ? "1fr 1fr" : "1fr",
                  gap: 1
                }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<OpenInNewRoundedIcon />}
                  onClick={() => handleOpenProvider(sourceProvider)}
                  sx={{ fontWeight: 800 }}>
                  Open
                </Button>
                {state.status === "disconnected" && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<RefreshRoundedIcon />}
                    onClick={handleReset}
                    sx={{ fontWeight: 800 }}>
                    Retry
                  </Button>
                )}
              </Box>
            </SidePanelTimelineStep>

            <SidePanelTimelineStep
              status={
                scopeStepComplete
                  ? "complete"
                  : state.status === "connected"
                    ? "active"
                    : "locked"
              }
            >
              {state.status === "connected" && (
                <ScanConfig
                  settings={settings}
                  onSettingsChange={setSettings}
                  onStartScan={handleStartScan}
                  onOpenProvider={handleOpenProvider}
                  onResumeScan={handleResumeScan}
                  onDismissResume={handleDismissResume}
                  onClearCache={handleClearCache}
                  onRebuildCache={handleRebuildCache}
                  onExportCacheDiagnostics={handleExportCacheDiagnostics}
                  hasGptk={state.hasGptk}
                  cacheEntryCount={cacheEntryCount}
                  cacheStatus={cacheStatus}
                  cacheBusy={cacheBusy}
                  resumeCheckpoint={resumeCheckpoint}
                  albums={albums}
                  albumsLoading={albumsLoading}
                  albumsError={albumsError}
                  onRefreshAlbums={() => requestAlbums(state.accountEmail)}
                  entitlement={entitlement}
                  onUpgrade={(detail) =>
                    openTrackedUpgradePrompt("scan", detail)
                  }
                  amazonProfileName={amazonProfileName}
                  compact
                />
              )}
            </SidePanelTimelineStep>

            <SidePanelTimelineStep
              status={
                scanStepComplete
                  ? "complete"
                  : state.status === "scanning"
                    ? "active"
                    : "locked"
              }
              >
              {state.status === "scanning" && (
                <>
                  <ScanProgress
                    phase={state.phase}
                    itemsProcessed={state.itemsProcessed}
                    totalEstimate={state.totalEstimate}
                    message={state.message}
                    onPause={handlePauseScan}
                    compact
                  />
                  {provisionalGroups.length > 0 && (
                    <Alert severity="info" sx={{ py: 0.65 }}>
                      Showing possible sets while the scan continues. Cleanup
                      unlocks after the scan completes.
                    </Alert>
                  )}
                </>
              )}
            </SidePanelTimelineStep>

            <SidePanelTimelineStep
              status={
                state.status === "results" || state.status === "trashing"
                  ? "active"
                  : "locked"
              }>
              {state.status === "results" && (
                <ScanCoverageNotice coverage={state.scanCoverage} compact />
              )}
              {state.status === "results" &&
                groups.length === 0 &&
                storageChecked && (
                  <ScanEmptyState
                    compact
                    identityPending={!stateIdentityValidated}
                    onChangeSettings={handleReset}
                  />
                )}
              {state.status === "results" && groups.length > 0 && (
                <>
                  {shouldShowDeferredUpgrade(
                    deferredUpgrade,
                    groups.length,
                    state.status === "results"
                  ) && (
                    <DeferredUpgradeBanner
                      prompt={deferredUpgrade}
                      onOpen={handleOpenDeferredUpgrade}
                      onDismiss={handleDismissDeferredUpgrade}
                    />
                  )}
                  <ActionBar
                    totalItems={state.totalItems}
                    groupCount={visibleGroups.length}
                    totalGroupCount={groups.length}
                    reviewedGroupCount={reviewedVisibleGroupCount}
                    exactGroupCount={exactGroupCount}
                    similarGroupCount={similarGroupCount}
                    reviewFilter={reviewFilter}
                    onReviewFilterChange={setReviewFilter}
                    onSelectAll={handleSelectAll}
                    onDeselectAll={handleDeselectAll}
                    onRescan={handleReset}
                    onExportJson={handleExportJson}
                    onExportCsv={handleExportCsv}
                    onApplyKeepStrategy={handleApplyKeepStrategy}
                    recoveryHistoryCount={recoveryHistory.length}
                    onOpenRecoveryHistory={() => setRecoveryHistoryOpen(true)}
                    onClearDecisionMemory={handleClearDecisionMemory}
                    compact
                  />
                  {lockedGroupCount > 0 && (
                    <Alert severity="info" sx={{ mb: 1, py: 0.65 }}>
                      {lockedGroupCount.toLocaleString()} more duplicate set
                      {lockedGroupCount === 1 ? "" : "s"} found. Upgrade to
                      review and clean the full scan.
                    </Alert>
                  )}
                  <DuplicateGroups
                    groups={visibleGroups}
                    mediaItems={displayMediaItems}
                    trashPlanMediaKeys={trashPlanMediaKeys}
                    selectedGroupIds={selectedGroupIds}
                    reviewedGroupIds={reviewedGroupIds}
                    onToggleGroup={handleToggleGroup}
                    onSkipGroup={handleSkipGroup}
                    getKeptForGroup={getKept}
                    getKeepDecisionForGroup={getKeepDecision}
                    onToggleKept={handleToggleKept}
                    onTrashAll={handleTrashAllCopies}
                    onVerifyOriginal={handleVerifyOriginal}
                    onLoadVideo={handleLoadVideo}
                    compact
                  />
                  <CleanupBar
                    includedGroupCount={includedGroupCount}
                    duplicateCount={duplicateCount}
                    reviewedGroupCount={reviewedCleanupScopeGroupCount}
                    totalGroupCount={cleanupScopeGroups.length}
                    onTrash={handleTrash}
                    compact
                  />
                </>
              )}
              {state.status === "trashing" && (
                <Box sx={{ display: "grid", gap: 1 }}>
                  <Typography variant="body2" fontWeight={800}>
                    Moving to trash
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {state.trashedSoFar > 0
                      ? `${state.trashedSoFar.toLocaleString()} of ${state.totalToTrash.toLocaleString()} moved`
                      : "Starting..."}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={
                      state.totalToTrash > 0
                        ? (state.trashedSoFar / state.totalToTrash) * 100
                        : 0
                    }
                  />
                </Box>
              )}
            </SidePanelTimelineStep>

            <SidePanelSafetyFooter />
          </Box>
        ) : (
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", md: "row" },
              gap: 2.5,
              alignItems: "flex-start"
            }}>
            {showWorkflowRail && (
              <WorkflowRail
                stage={workflowStage}
                totalItems={workflowTotalItems}
                totalGroupCount={workflowGroups.length}
                exactGroupCount={workflowExactGroupCount}
                similarGroupCount={workflowSimilarGroupCount}
                duplicateCount={workflowDuplicateCount}
                scanDetail={workflowScanDetail}
                onRescan={handleReset}
              />
            )}

            <Box sx={{ minWidth: 0, flex: 1, width: "100%" }}>
              {state.status === "connecting" && (
                <Box sx={{ display: "flex", justifyContent: "center", pt: 10 }}>
                  <CircularProgress disableShrink />
                </Box>
              )}

              {state.status === "disconnected" && (
                <>
                  <SidePanelConnectionSetup
                    selectedProvider={settings.sourceProvider ?? "google"}
                    onOpenProvider={handleOpenProvider}
                    onRetry={handleReset}
                    error={state.error}
                  />
                  {state.scanCoverage && (
                    <ScanCoverageNotice coverage={state.scanCoverage} />
                  )}
                </>
              )}

              {state.status === "connected" && (
                <ScanConfig
                  settings={settings}
                  onSettingsChange={setSettings}
                  onStartScan={handleStartScan}
                  onOpenProvider={handleOpenProvider}
                  onResumeScan={handleResumeScan}
                  onDismissResume={handleDismissResume}
                  onClearCache={handleClearCache}
                  onRebuildCache={handleRebuildCache}
                  onExportCacheDiagnostics={handleExportCacheDiagnostics}
                  hasGptk={state.hasGptk}
                  cacheEntryCount={cacheEntryCount}
                  cacheStatus={cacheStatus}
                  cacheBusy={cacheBusy}
                  resumeCheckpoint={resumeCheckpoint}
                  albums={albums}
                  albumsLoading={albumsLoading}
                  albumsError={albumsError}
                  onRefreshAlbums={() => requestAlbums(state.accountEmail)}
                  entitlement={entitlement}
                  onUpgrade={(detail) =>
                    openTrackedUpgradePrompt("scan", detail)
                  }
                  amazonProfileName={amazonProfileName}
                  compact={isSidePanel}
                />
              )}

              {state.status === "scanning" && (
                <>
                  <ScanProgress
                    phase={state.phase}
                    itemsProcessed={state.itemsProcessed}
                    totalEstimate={state.totalEstimate}
                    message={state.message}
                    onPause={handlePauseScan}
                  />
                  {provisionalGroups.length > 0 && (
                    <Box sx={{ mt: 3 }}>
                      <Alert severity="info" sx={{ mb: 2 }}>
                        Showing possible duplicate sets while the scan
                        continues. Trash actions unlock after the scan
                        completes.
                      </Alert>
                      <DuplicateGroups
                        groups={provisionalGroups}
                        mediaItems={displayMediaItems}
                        selectedGroupIds={new Set()}
                        reviewedGroupIds={new Set()}
                        onToggleGroup={() => {}}
                        onSkipGroup={() => {}}
                        getKeptForGroup={getKept}
                        getKeepDecisionForGroup={getKeepDecision}
                        onToggleKept={() => {}}
                        onTrashAll={() => {}}
                        readOnly
                        heading={`${provisionalGroups.length} Possible Duplicate Set${provisionalGroups.length !== 1 ? "s" : ""}`}
                      />
                    </Box>
                  )}
                </>
              )}

              {state.status === "results" && (
                <ScanCoverageNotice coverage={state.scanCoverage} />
              )}

              {state.status === "results" &&
                groups.length === 0 &&
                storageChecked && (
                  <ScanEmptyState onChangeSettings={handleReset} />
                )}

              {state.status === "results" && groups.length > 0 && (
                <>
                  {shouldShowDeferredUpgrade(
                    deferredUpgrade,
                    groups.length,
                    state.status === "results"
                  ) && (
                    <DeferredUpgradeBanner
                      prompt={deferredUpgrade}
                      onOpen={handleOpenDeferredUpgrade}
                      onDismiss={handleDismissDeferredUpgrade}
                    />
                  )}
                  <ActionBar
                    totalItems={state.totalItems}
                    groupCount={visibleGroups.length}
                    totalGroupCount={groups.length}
                    reviewedGroupCount={reviewedVisibleGroupCount}
                    exactGroupCount={exactGroupCount}
                    similarGroupCount={similarGroupCount}
                    reviewFilter={reviewFilter}
                    onReviewFilterChange={setReviewFilter}
                    onSelectAll={handleSelectAll}
                    onDeselectAll={handleDeselectAll}
                    onRescan={handleReset}
                    onExportJson={handleExportJson}
                    onExportCsv={handleExportCsv}
                    onApplyKeepStrategy={handleApplyKeepStrategy}
                    recoveryHistoryCount={recoveryHistory.length}
                    onOpenRecoveryHistory={() => setRecoveryHistoryOpen(true)}
                    onClearDecisionMemory={handleClearDecisionMemory}
                    compact={isSidePanel}
                  />
                  {lockedGroupCount > 0 && (
                    <Alert severity="info" sx={{ mb: 2 }}>
                      {lockedGroupCount.toLocaleString()} more duplicate set
                      {lockedGroupCount === 1 ? "" : "s"} found. Upgrade to
                      review and clean the full scan.
                    </Alert>
                  )}
                  <DuplicateGroups
                    groups={visibleGroups}
                    mediaItems={displayMediaItems}
                    trashPlanMediaKeys={trashPlanMediaKeys}
                    selectedGroupIds={selectedGroupIds}
                    reviewedGroupIds={reviewedGroupIds}
                    onToggleGroup={handleToggleGroup}
                    onSkipGroup={handleSkipGroup}
                    getKeptForGroup={getKept}
                    getKeepDecisionForGroup={getKeepDecision}
                    onToggleKept={handleToggleKept}
                    onTrashAll={handleTrashAllCopies}
                    onVerifyOriginal={handleVerifyOriginal}
                    onLoadVideo={handleLoadVideo}
                    compact={isSidePanel}
                  />
                  <CleanupBar
                    includedGroupCount={includedGroupCount}
                    duplicateCount={duplicateCount}
                    reviewedGroupCount={reviewedCleanupScopeGroupCount}
                    totalGroupCount={cleanupScopeGroups.length}
                    onTrash={handleTrash}
                    compact={isSidePanel}
                  />
                </>
              )}

              {state.status === "trashing" && (
                <Box sx={{ maxWidth: 480, mx: "auto", p: 4 }}>
                  <Typography variant="h5" fontWeight={600} gutterBottom>
                    Moving to Trash
                  </Typography>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      mb: 2
                    }}>
                    <CircularProgress size={14} thickness={5} />
                    <Typography variant="body2" color="text.secondary">
                      {state.trashedSoFar > 0
                        ? `${state.trashedSoFar.toLocaleString()} of ${state.totalToTrash.toLocaleString()} moved`
                        : "Starting..."}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={
                      state.totalToTrash > 0
                        ? (state.trashedSoFar / state.totalToTrash) * 100
                        : 0
                    }
                  />
                </Box>
              )}
              {isSidePanel && state.status !== "trashing" && (
                <Box
                  sx={{
                    mt: 1,
                    px: 1,
                    py: 1.25,
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 2,
                    bgcolor: photoSweepColors.surface,
                    display: "grid",
                    gap: 0.35
                  }}>
                  <Typography
                    variant="caption"
                    fontWeight={800}
                    color="success.dark">
                    Safe cleanup
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Matching runs locally. Confirmed items move to provider
                    Trash and a report is saved before cleanup.
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        )}
      </Box>

      <Dialog
        open={entitlementLoaded && photoDataConsent === false}
        onClose={() => {}}
        fullWidth
        maxWidth="sm"
        aria-labelledby="photo-data-disclosure-title">
        <DialogTitle id="photo-data-disclosure-title">
          Before you scan
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            PhotoSweep reads thumbnails, media metadata, and provider item
            identifiers from the signed-in photo tab to find duplicate photos
            and videos. Matching, embeddings, and reports stay in this browser.
            PhotoSweep only sends license information needed for paid access,
            and optional usage metrics are separately opt-in. Nothing moves to
            provider Trash until you review and confirm it.
          </DialogContentText>
          <Button
            component="a"
            href={`${PHOTOSWEEP_SITE_URL}privacy`}
            target="_blank"
            rel="noreferrer"
            endIcon={<OpenInNewRoundedIcon />}
            sx={{ mt: 1 }}>
            Read the privacy policy
          </Button>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={acceptPhotoDataConsent}>
            I understand, continue
          </Button>
        </DialogActions>
      </Dialog>

      <UpgradeDialog
        open={!!upgradePrompt}
        reason={upgradePrompt?.reason ?? "groups"}
        detail={upgradePrompt?.detail}
        valueFacts={upgradePrompt?.valueFacts}
        checkoutState={checkoutState}
        onClose={() => {
          if (upgradePrompt) {
            trackEvent({
              name: "upgrade_prompt_dismissed",
              upgradeReason: upgradePrompt.reason,
              dismissalReason: "continue_free"
            })
          }
          setUpgradePromptSafely(null)
        }}
        onChoosePlan={handleChooseUpgradePlan}
        onRefreshLicense={handleRefreshEntitlement}
        onRecoverLicense={handleRecoverLicense}
      />

      <RecoveryHistoryDialog
        open={recoveryHistoryOpen}
        records={recoveryHistory}
        loadError={
          recoveryHistoryReadError
            ? "Recovery history could not be read. Restore actions are paused until it loads."
            : undefined
        }
        onClose={() => setRecoveryHistoryOpen(false)}
        onRestore={handleRestoreHistory}
        onClear={handleClearRecoveryHistory}
      />

      <RatingPromptDialog
        open={ratingPromptOpen}
        onReview={() => {
          ratingPromptDeferredRef.current = false
          setRatingPromptSafely(false)
          void completeRatingPrompt()
          void chrome.tabs.create({
            url: PHOTOSWEEP_SITE_URL
          })
        }}
        onFeedback={() => {
          ratingPromptDeferredRef.current = false
          setRatingPromptSafely(false)
          void completeRatingPrompt()
          void chrome.tabs.create({
            url: FEEDBACK_MAILTO_URL
          })
        }}
        onLater={() => {
          ratingPromptDeferredRef.current = false
          setRatingPromptSafely(false)
          void deferRatingPrompt()
        }}
        onNever={() => {
          ratingPromptDeferredRef.current = false
          setRatingPromptSafely(false)
          void completeRatingPrompt()
        }}
      />

      {/* Trash confirm dialog */}
      <Dialog
        open={!!trashConfirm}
        onClose={handleCloseTrashConfirm}
        fullWidth
        maxWidth="xs"
        slotProps={{
          backdrop: {
            sx: {
              bgcolor: photoSweepColors.overlay,
              backdropFilter: "blur(3px)"
            }
          },
          paper: {
            sx: {
              m: isSidePanel ? 1.5 : 3,
              borderRadius: 2.5,
              border: "1px solid",
              borderColor: photoSweepColors.border,
              bgcolor: photoSweepColors.surface,
              backgroundColor: photoSweepColors.surface,
              boxShadow: `0 24px 70px ${photoSweepColors.shadowDeep}`
            }
          }
        }}>
        <DialogTitle>Move to Trash</DialogTitle>
        <DialogContent>
          {reportError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {reportError}
            </Alert>
          )}
          {trashPreflight && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2" fontWeight={800}>
                Cleanup preflight passed
              </Typography>
              <Typography variant="caption">
                {trashPreflight.summary}
                {trashPreflight.reasons.length > 0
                  ? " · " +
                    trashPreflight.reasons.map((item) => item.message).join(" ")
                  : ""}
              </Typography>
            </Alert>
          )}
          <DialogContentText>
            Move {trashConfirm?.dedupKeys.length} duplicate
            {trashConfirm?.dedupKeys.length !== 1 ? "s" : ""} to trash? You can
            restore them from{" "}
            {providerTrashDestination(settings.sourceProvider)}. A JSON audit
            report will be saved before anything is moved. Items are moved in
            batches of {TRASH_BATCH_SIZE}.
          </DialogContentText>
          <Alert severity="info" sx={{ mt: 1.5 }}>
            {providerRecoveryWindowNotice(settings.sourceProvider)} Restore
            items before they are permanently deleted.
          </Alert>
          {settings.albumScope && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              {providerAlbumTrashNotice()}
            </Alert>
          )}
          {unknownFavoriteTrashCount > 0 && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              Favorite status is unknown for {unknownFavoriteTrashCount.toLocaleString()} selected item
              {unknownFavoriteTrashCount === 1 ? "" : "s"}. These items could
              be favorites. They will move only after you acknowledge that
              PhotoSweep could not verify their status.
              <FormControlLabel
                control={
                  <Checkbox
                    checked={unknownFavoriteTrashAcknowledged}
                    onChange={(event) =>
                      setUnknownFavoriteTrashAcknowledged(
                        event.target.checked
                      )
                    }
                  />
                }
                label="I understand these items may be favorites"
              />
            </Alert>
          )}
          <TextField
            autoFocus
            fullWidth
            margin="normal"
            label={`Type ${trashConfirm?.dedupKeys.length ?? 0} to confirm`}
            value={trashConfirmCount}
            onChange={(event) => setTrashConfirmCount(event.target.value)}
            inputProps={{
              inputMode: "numeric",
              pattern: "[0-9]*"
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseTrashConfirm}>Cancel</Button>
          <Button
            onClick={handleTrashConfirmed}
            variant="contained"
            color="error"
            disabled={
              trashConfirmCount !== String(trashConfirm?.dedupKeys.length ?? "") ||
              (unknownFavoriteTrashCount > 0 &&
                !unknownFavoriteTrashAcknowledged)
            }>
            Move to Trash
          </Button>
        </DialogActions>
      </Dialog>

      {/* Undo trash snackbar */}
      <Snackbar
        open={!!undoData && !trashWarning && !upgradePrompt}
        autoHideDuration={null}
        onClose={handleUndoClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message={
          undoData
            ? `${undoData.count} item${undoData.count !== 1 ? "s" : ""} moved to trash`
            : ""
        }
        action={
          <>
            <Button color="secondary" size="small" onClick={handleUndo}>
              Undo
            </Button>
            <IconButton
              aria-label="Dismiss undo notification"
              size="small"
              color="inherit"
              onClick={handleUndoClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </>
        }
      />

      <Snackbar
        open={!!trashWarning && !upgradePrompt}
        autoHideDuration={null}
        onClose={() => setTrashWarningSafely(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message={trashWarning ?? ""}
        action={
          <>
            {undoData && (
              <Button color="secondary" size="small" onClick={handleUndo}>
                Undo moved items
              </Button>
            )}
            <IconButton
              aria-label="Dismiss warning"
              size="small"
              color="inherit"
              onClick={() => setTrashWarningSafely(null)}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </>
        }
      />

      {!upgradePrompt && (
        <KeepStrategyFeedbackSnackbar
          message={keepStrategyFeedback}
          onClose={() => setKeepStrategyFeedback(null)}
        />
      )}
    </ThemeProvider>
  )
}
