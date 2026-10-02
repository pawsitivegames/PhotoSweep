import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded"
import RestoreRoundedIcon from "@mui/icons-material/RestoreRounded"
import Alert from "@mui/material/Alert"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Chip from "@mui/material/Chip"
import Dialog from "@mui/material/Dialog"
import DialogActions from "@mui/material/DialogActions"
import DialogContent from "@mui/material/DialogContent"
import DialogTitle from "@mui/material/DialogTitle"
import Divider from "@mui/material/Divider"
import List from "@mui/material/List"
import ListItem from "@mui/material/ListItem"
import ListItemText from "@mui/material/ListItemText"
import Typography from "@mui/material/Typography"

import {
  providerLabel,
  providerRecoveryWindowNotice,
  providerTrashDestination
} from "../lib/provider-operations"
import {
  isRecoveryRestorable,
  type RecoveryHistoryRecord
} from "../lib/recovery-history"
import { photoSweepColors } from "../lib/theme"

function statusLabel(status: RecoveryHistoryRecord["status"]): string {
  switch (status) {
    case "pending":
      return "Waiting for provider result"
    case "complete":
      return "Moved to Trash"
    case "partial":
      return "Partially moved"
    case "failed":
      return "Trash failed"
    case "unknown":
      return "Trash outcome unknown"
    case "not_dispatched":
      return "Not sent to provider"
    case "restored":
      return "Restored"
    case "restore_partial":
      return "Partially restored"
    case "restore_failed":
      return "Restore needs retry"
    case "restore_unknown":
      return "Restore outcome unknown"
  }
}

export function RecoveryHistoryDialog({
  open,
  records,
  loadError,
  onClose,
  onRestore,
  onClear
}: {
  open: boolean
  records: RecoveryHistoryRecord[]
  loadError?: string
  onClose: () => void
  onRestore: (record: RecoveryHistoryRecord) => void
  onClear: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <HistoryRoundedIcon color="primary" />
        Recovery history
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          PhotoSweep keeps a bounded, local record of provider-confirmed Trash
          moves. It stores identifiers needed for recovery, not photo content.
        </Typography>
        {loadError ? (
          <Alert severity="warning">{loadError}</Alert>
        ) : records.length === 0 ? (
          <Alert severity="info">
            No cleanup operations have been recorded.
          </Alert>
        ) : (
          <List disablePadding>
            {records.map((record, index) => {
              const restorable = isRecoveryRestorable(record)
              return (
                <Box key={record.operationId}>
                  <ListItem
                    disableGutters
                    sx={{
                      alignItems: "flex-start",
                      gap: 1,
                      py: 1.1
                    }}
                    secondaryAction={
                      restorable ? (
                        <Button
                          size="small"
                          startIcon={<RestoreRoundedIcon />}
                          onClick={() => onRestore(record)}>
                          Restore
                        </Button>
                      ) : undefined
                    }>
                    <ListItemText
                      primary={
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.75,
                            pr: restorable ? 10 : 0
                          }}>
                          <Typography variant="body2" fontWeight={800}>
                            {providerLabel(record.provider)}
                          </Typography>
                          <Chip
                            size="small"
                            label={statusLabel(record.status)}
                            color={
                              record.status === "restored"
                                ? "success"
                                : record.status === "restore_failed" ||
                                    record.status === "restore_partial" ||
                                    record.status === "failed" ||
                                    record.status === "unknown" ||
                                    record.status === "restore_unknown"
                                  ? "warning"
                                  : "default"
                            }
                          />
                        </Box>
                      }
                      secondary={
                        <Box
                          component="span"
                          sx={{ display: "grid", gap: 0.2 }}>
                          <Typography component="span" variant="caption">
                            {new Date(record.createdAt).toLocaleString()} ·{" "}
                            {record.scopeLabel ?? "Scoped library"}
                          </Typography>
                          <Typography component="span" variant="caption">
                            {record.movedCount.toLocaleString()} moved ·{" "}
                            {record.failedCount.toLocaleString()} failed
                            {(record.unknownCount ?? 0) > 0
                              ? ` · ${(record.unknownCount ?? 0).toLocaleString()} outcome unknown`
                              : ""}
                            {(record.notDispatchedCount ?? 0) > 0
                              ? ` · ${(record.notDispatchedCount ?? 0).toLocaleString()} not dispatched`
                              : ""}
                            {(record.restoreUnknownCount ?? 0) > 0
                              ? ` · ${(record.restoreUnknownCount ?? 0).toLocaleString()} restore outcome unknown`
                              : ""}
                            {record.lastError ? ` · ${record.lastError}` : ""}
                          </Typography>
                          {restorable && (
                            <>
                              <Typography component="span" variant="caption">
                                Restore from {providerTrashDestination(record.provider)}.
                              </Typography>
                              <Typography component="span" variant="caption">
                                {providerRecoveryWindowNotice(record.provider)}
                              </Typography>
                            </>
                          )}
                        </Box>
                      }
                    />
                  </ListItem>
                  {index < records.length - 1 && <Divider />}
                </Box>
              )
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 3, py: 1.5 }}>
        <Button
          color="inherit"
          disabled={records.length === 0}
          onClick={onClear}
          sx={{ color: photoSweepColors.muted }}>
          Clear history
        </Button>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
