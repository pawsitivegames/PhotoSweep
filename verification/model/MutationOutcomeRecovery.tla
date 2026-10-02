--------------------- MODULE MutationOutcomeRecovery ---------------------
EXTENDS Naturals

CONSTANTS Items, UnsafeRetryUnknown

Statuses == {"pending", "confirmed", "failed", "unknown"}
TerminalStatuses == {"confirmed", "failed", "unknown"}
RequestIds == {0, 1, 2}
LateTerminalRejectionKinds == {
  "different-request", "legacy-no-id", "closed-after-reload",
  "lost-begin-ack"
}
Phases == {
  "review", "trashing", "trash-ready", "restore-intent", "restoring", "restore-final",
  "restore-provisional-ready", "late-terminal-ready", "restore-write-failed",
  "persisted", "crashed", "reloaded", "done"
}

VARIABLES
  phase,
  trashStatus,
  trashDispatched,
  trashBatch,
  trashNotDispatched,
  undoTargets,
  restoreStatus,
  restoreUnknownEver,
  currentRestoreAttempt,
  currentRestoreRequestId,
  currentRestorePriorStatus,
  currentRestoreTargets,
  currentRestoreStatus,
  currentRestoreTimedOutTargets,
  currentRestoreDispatched,
  currentRestoreBatch,
  currentRestoreNotDispatched,
  everNotDispatched,
  restoreAttempts,
  retryUsed,
  retryTargets,
  retrySourceStatus,
  durableValid,
  durableUndoTargets,
  durableRestoreStatus,
  durableUnknownEver,
  durableIntentPending,
  durableEverNotDispatched,
  durableRestoreAttempts,
  durableRetryUsed,
  durableRetryTargets,
  durableRetrySourceStatus,
  durableLastAttempt,
  durableLastAttemptRequestId,
  durableLastAttemptStatus,
  durableLastAttemptProvisionalUnknown,
  durableLastAttemptDispatched,
  durableLastAttemptNotDispatched,
  rejectedLateTerminalKinds

vars == <<
  phase,
  trashStatus,
  trashDispatched,
  trashBatch,
  trashNotDispatched,
  undoTargets,
  restoreStatus,
  restoreUnknownEver,
  currentRestoreAttempt,
  currentRestoreRequestId,
  currentRestorePriorStatus,
  currentRestoreTargets,
  currentRestoreStatus,
  currentRestoreTimedOutTargets,
  currentRestoreDispatched,
  currentRestoreBatch,
  currentRestoreNotDispatched,
  everNotDispatched,
  restoreAttempts,
  retryUsed,
  retryTargets,
  retrySourceStatus,
  durableValid,
  durableUndoTargets,
  durableRestoreStatus,
  durableUnknownEver,
  durableIntentPending,
  durableEverNotDispatched,
  durableRestoreAttempts,
  durableRetryUsed,
  durableRetryTargets,
  durableRetrySourceStatus,
  durableLastAttempt,
  durableLastAttemptRequestId,
  durableLastAttemptStatus,
  durableLastAttemptProvisionalUnknown,
  durableLastAttemptDispatched,
  durableLastAttemptNotDispatched,
  rejectedLateTerminalKinds
>>

MergeStatus(prior, next) ==
  IF prior = "unknown" \/ next = "unknown" THEN "unknown"
  ELSE IF prior = "confirmed" \/ next = "confirmed" THEN "confirmed"
  ELSE IF prior = "failed" \/ next = "failed" THEN "failed"
  ELSE "pending"

PendingStatus == [item \in Items |-> "pending"]

Init ==
  /\ phase = "review"
  /\ trashStatus = PendingStatus
  /\ trashDispatched = {}
  /\ trashBatch = {}
  /\ trashNotDispatched = {}
  /\ undoTargets = {}
  /\ restoreStatus = PendingStatus
  /\ restoreUnknownEver = {}
  /\ currentRestoreAttempt = 0
  /\ currentRestoreRequestId = 0
  /\ currentRestorePriorStatus = PendingStatus
  /\ currentRestoreTargets = {}
  /\ currentRestoreStatus = PendingStatus
  /\ currentRestoreTimedOutTargets = {}
  /\ currentRestoreDispatched = {}
  /\ currentRestoreBatch = {}
  /\ currentRestoreNotDispatched = {}
  /\ everNotDispatched = {}
  /\ restoreAttempts = 0
  /\ retryUsed = FALSE
  /\ retryTargets = {}
  /\ retrySourceStatus = PendingStatus
  /\ durableValid = FALSE
  /\ durableUndoTargets = {}
  /\ durableRestoreStatus = PendingStatus
  /\ durableUnknownEver = {}
  /\ durableIntentPending = FALSE
  /\ durableEverNotDispatched = {}
  /\ durableRestoreAttempts = 0
  /\ durableRetryUsed = FALSE
  /\ durableRetryTargets = {}
  /\ durableRetrySourceStatus = PendingStatus
  /\ durableLastAttempt = {}
  /\ durableLastAttemptRequestId = 0
  /\ durableLastAttemptStatus = PendingStatus
  /\ durableLastAttemptProvisionalUnknown = {}
  /\ durableLastAttemptDispatched = {}
  /\ durableLastAttemptNotDispatched = {}
  /\ rejectedLateTerminalKinds = {}

BeginTrash ==
  /\ phase = "review"
  /\ phase' = "trashing"
  /\ UNCHANGED <<
    trashStatus, trashDispatched, trashBatch,
    trashNotDispatched, undoTargets, restoreStatus,
    restoreUnknownEver, currentRestoreAttempt, currentRestoreTargets,
    currentRestoreStatus, currentRestoreDispatched, currentRestoreBatch,
    currentRestoreNotDispatched, everNotDispatched, restoreAttempts,
    retryUsed, retryTargets, retrySourceStatus,
    durableValid, durableUndoTargets, durableRestoreStatus,
    durableUnknownEver, durableEverNotDispatched, durableRestoreAttempts,
    durableRetryUsed, durableRetryTargets, durableRetrySourceStatus,
    durableLastAttempt, durableLastAttemptStatus, durableLastAttemptDispatched,
    durableLastAttemptNotDispatched, currentRestoreRequestId, currentRestorePriorStatus,
    currentRestoreTimedOutTargets, durableLastAttemptRequestId, durableLastAttemptProvisionalUnknown,
    rejectedLateTerminalKinds, durableIntentPending
    >>

DispatchTrashChunk ==
  /\ phase = "trashing"
  /\ trashBatch = {}
  /\ \E chunk \in SUBSET (Items \ trashDispatched):
       /\ chunk # {}
       /\ trashBatch' = chunk
       /\ trashDispatched' = trashDispatched \cup chunk
  /\ UNCHANGED <<
    phase, trashStatus, trashNotDispatched,
    undoTargets, restoreStatus, restoreUnknownEver,
    currentRestoreAttempt, currentRestoreTargets, currentRestoreStatus,
    currentRestoreDispatched, currentRestoreBatch, currentRestoreNotDispatched,
    everNotDispatched, restoreAttempts, retryUsed,
    retryTargets, retrySourceStatus, durableValid,
    durableUndoTargets, durableRestoreStatus, durableUnknownEver,
    durableEverNotDispatched, durableRestoreAttempts, durableRetryUsed,
    durableRetryTargets, durableRetrySourceStatus, durableLastAttempt,
    durableLastAttemptStatus, durableLastAttemptDispatched, durableLastAttemptNotDispatched,
    currentRestoreRequestId, currentRestorePriorStatus, currentRestoreTimedOutTargets,
    durableLastAttemptRequestId, durableLastAttemptProvisionalUnknown, rejectedLateTerminalKinds,
    durableIntentPending
    >>

RecordTrashBatch ==
  /\ phase = "trashing"
  /\ trashBatch # {}
  /\ \E result \in [trashBatch -> TerminalStatuses]:
       /\ trashStatus' = [item \in Items |->
            IF item \in trashBatch THEN result[item] ELSE trashStatus[item]]
       /\ trashBatch' = {}
  /\ UNCHANGED <<
    phase, trashDispatched, trashNotDispatched,
    undoTargets, restoreStatus, restoreUnknownEver,
    currentRestoreAttempt, currentRestoreTargets, currentRestoreStatus,
    currentRestoreDispatched, currentRestoreBatch, currentRestoreNotDispatched,
    everNotDispatched, restoreAttempts, retryUsed,
    retryTargets, retrySourceStatus, durableValid,
    durableUndoTargets, durableRestoreStatus, durableUnknownEver,
    durableEverNotDispatched, durableRestoreAttempts, durableRetryUsed,
    durableRetryTargets, durableRetrySourceStatus, durableLastAttempt,
    durableLastAttemptStatus, durableLastAttemptDispatched, durableLastAttemptNotDispatched,
    currentRestoreRequestId, currentRestorePriorStatus, currentRestoreTimedOutTargets,
    durableLastAttemptRequestId, durableLastAttemptProvisionalUnknown, rejectedLateTerminalKinds,
    durableIntentPending
    >>

TimeoutTrashBatch ==
  /\ phase = "trashing"
  /\ trashBatch # {}
  /\ trashStatus' = [item \in Items |->
       IF item \in trashBatch THEN "unknown" ELSE trashStatus[item]]
  /\ trashBatch' = {}
  /\ UNCHANGED <<
    phase, trashDispatched, trashNotDispatched,
    undoTargets, restoreStatus, restoreUnknownEver,
    currentRestoreAttempt, currentRestoreTargets, currentRestoreStatus,
    currentRestoreDispatched, currentRestoreBatch, currentRestoreNotDispatched,
    everNotDispatched, restoreAttempts, retryUsed,
    retryTargets, retrySourceStatus, durableValid,
    durableUndoTargets, durableRestoreStatus, durableUnknownEver,
    durableEverNotDispatched, durableRestoreAttempts, durableRetryUsed,
    durableRetryTargets, durableRetrySourceStatus, durableLastAttempt,
    durableLastAttemptStatus, durableLastAttemptDispatched, durableLastAttemptNotDispatched,
    currentRestoreRequestId, currentRestorePriorStatus, currentRestoreTimedOutTargets,
    durableLastAttemptRequestId, durableLastAttemptProvisionalUnknown, rejectedLateTerminalKinds,
    durableIntentPending
    >>

FinalizeTrash ==
  /\ phase = "trashing"
  /\ trashBatch = {}
  /\ LET neverIssued == Items \ trashDispatched
         finalStatus == [item \in Items |->
           IF item \in neverIssued THEN "failed" ELSE trashStatus[item]]
     IN /\ trashStatus' = finalStatus
        /\ trashNotDispatched' = neverIssued
        /\ undoTargets' = {item \in Items : finalStatus[item] = "confirmed"}
  /\ phase' = "trash-ready"
  /\ durableValid' = TRUE
  /\ durableUndoTargets' = undoTargets'
  /\ durableRestoreStatus' = restoreStatus
  /\ durableUnknownEver' = restoreUnknownEver
  /\ durableIntentPending' = FALSE
  /\ durableEverNotDispatched' = everNotDispatched
  /\ durableRestoreAttempts' = restoreAttempts
  /\ durableRetryUsed' = retryUsed
  /\ durableRetryTargets' = retryTargets
  /\ durableRetrySourceStatus' = retrySourceStatus
  /\ durableLastAttempt' = {}
  /\ durableLastAttemptRequestId' = 0
  /\ durableLastAttemptStatus' = PendingStatus
  /\ durableLastAttemptProvisionalUnknown' = {}
  /\ durableLastAttemptDispatched' = {}
  /\ durableLastAttemptNotDispatched' = {}
  /\ UNCHANGED <<
    trashDispatched, trashBatch, restoreStatus,
    restoreUnknownEver, currentRestoreAttempt, currentRestoreTargets,
    currentRestoreStatus, currentRestoreDispatched, currentRestoreBatch,
    currentRestoreNotDispatched, everNotDispatched, restoreAttempts,
    retryUsed, retryTargets, retrySourceStatus,
    currentRestoreRequestId, currentRestorePriorStatus,
    currentRestoreTimedOutTargets,
    rejectedLateTerminalKinds
    >>

BeginRestore ==
  /\ phase = "trash-ready"
  /\ undoTargets # {}
  /\ currentRestoreRequestId' = 1
  /\ currentRestorePriorStatus' = restoreStatus
  /\ currentRestoreTimedOutTargets' = {}
  /\ phase' = "restore-intent"
  /\ currentRestoreAttempt' = 1
  /\ currentRestoreTargets' = undoTargets
  /\ currentRestoreStatus' = PendingStatus
  /\ currentRestoreDispatched' = {}
  /\ currentRestoreBatch' = {}
  /\ currentRestoreNotDispatched' = {}
  /\ UNCHANGED <<
    trashStatus, trashDispatched, trashBatch,
    trashNotDispatched, undoTargets, restoreStatus,
    restoreUnknownEver, everNotDispatched, restoreAttempts,
    retryUsed, retryTargets, retrySourceStatus,
    durableValid, durableUndoTargets, durableRestoreStatus,
    durableUnknownEver, durableEverNotDispatched, durableRestoreAttempts,
    durableRetryUsed, durableRetryTargets, durableRetrySourceStatus,
    durableLastAttempt, durableLastAttemptStatus, durableLastAttemptDispatched,
    durableLastAttemptNotDispatched, durableLastAttemptRequestId, durableLastAttemptProvisionalUnknown,
    rejectedLateTerminalKinds, durableIntentPending
    >>

PersistRestoreIntent ==
  /\ phase = "restore-intent"
  /\ currentRestoreRequestId # 0
  /\ currentRestoreTargets # {}
  /\ \E acknowledged \in BOOLEAN:
       /\ LET intentStatus == [item \in Items |->
            IF item \in currentRestoreTargets THEN "unknown"
            ELSE durableRestoreStatus[item]]
              intentAttemptStatus == [item \in Items |->
            IF item \in currentRestoreTargets THEN "unknown"
            ELSE durableLastAttemptStatus[item]]
          IN /\ durableValid' = TRUE
             /\ durableIntentPending' = TRUE
             /\ durableUndoTargets' = undoTargets
             /\ durableRestoreStatus' = intentStatus
             /\ durableUnknownEver' = restoreUnknownEver
             /\ durableEverNotDispatched' = everNotDispatched
             /\ durableRestoreAttempts' = restoreAttempts
             /\ durableRetryUsed' = retryUsed
             /\ durableRetryTargets' = retryTargets
             /\ durableRetrySourceStatus' = retrySourceStatus
             /\ durableLastAttempt' = currentRestoreTargets
             /\ durableLastAttemptRequestId' = currentRestoreRequestId
             /\ durableLastAttemptStatus' = intentAttemptStatus
             /\ durableLastAttemptProvisionalUnknown' = currentRestoreTargets
             /\ durableLastAttemptDispatched' = {}
             /\ durableLastAttemptNotDispatched' = {}
       /\ phase' = IF acknowledged THEN "restoring" ELSE "persisted"
       /\ currentRestoreRequestId' =
            IF acknowledged THEN currentRestoreRequestId ELSE 0
  /\ UNCHANGED <<
    trashStatus, trashDispatched, trashBatch,
    trashNotDispatched, undoTargets, restoreStatus,
    restoreUnknownEver, currentRestoreAttempt,
    currentRestorePriorStatus, currentRestoreTargets, currentRestoreStatus,
    currentRestoreTimedOutTargets, currentRestoreDispatched, currentRestoreBatch,
    currentRestoreNotDispatched, everNotDispatched, restoreAttempts,
    retryUsed, retryTargets, retrySourceStatus,
    rejectedLateTerminalKinds
    >>

FailRestoreIntentWrite ==
  /\ phase = "restore-intent"
  /\ currentRestoreDispatched = {}
  /\ currentRestoreBatch = {}
  /\ phase' = IF restoreAttempts = 0 THEN "trash-ready" ELSE "reloaded"
  /\ currentRestoreAttempt' = durableRestoreAttempts
  /\ currentRestoreRequestId' = 0
  /\ currentRestorePriorStatus' =
       IF restoreAttempts = 0 THEN restoreStatus ELSE durableRestoreStatus
  /\ currentRestoreTargets' = IF restoreAttempts = 0 THEN {} ELSE durableLastAttempt
  /\ currentRestoreStatus' =
       IF restoreAttempts = 0 THEN PendingStatus ELSE durableLastAttemptStatus
  /\ currentRestoreTimedOutTargets' = {}
  /\ currentRestoreDispatched' =
       IF restoreAttempts = 0 THEN {} ELSE durableLastAttemptDispatched
  /\ currentRestoreBatch' = {}
  /\ currentRestoreNotDispatched' =
       IF restoreAttempts = 0 THEN {} ELSE durableLastAttemptNotDispatched
  /\ retryUsed' = durableRetryUsed
  /\ retryTargets' = durableRetryTargets
  /\ retrySourceStatus' = durableRetrySourceStatus
  /\ UNCHANGED <<
    trashStatus, trashDispatched, trashBatch,
    trashNotDispatched, undoTargets, restoreStatus,
    restoreUnknownEver, everNotDispatched, restoreAttempts,
    durableValid, durableUndoTargets, durableRestoreStatus,
    durableUnknownEver, durableIntentPending, durableEverNotDispatched,
    durableRestoreAttempts, durableRetryUsed, durableRetryTargets,
    durableRetrySourceStatus, durableLastAttempt, durableLastAttemptRequestId,
    durableLastAttemptStatus,
    durableLastAttemptStatus, durableLastAttemptProvisionalUnknown, durableLastAttemptDispatched,
    durableLastAttemptNotDispatched, rejectedLateTerminalKinds
    >>

BeginLegacyRestore ==
  /\ phase = "trash-ready"
  /\ undoTargets # {}
  /\ durableIntentPending' = TRUE
  /\ durableValid' = TRUE
  /\ durableUndoTargets' = undoTargets
  /\ durableRestoreStatus' = [item \in Items |->
       IF item \in undoTargets THEN "unknown" ELSE durableRestoreStatus[item]]
  /\ durableUnknownEver' = durableUnknownEver \cup undoTargets
  /\ durableRestoreAttempts' = 1
  /\ durableLastAttempt' = undoTargets
  /\ durableLastAttemptRequestId' = 0
  /\ durableLastAttemptStatus' = [item \in Items |->
       IF item \in undoTargets THEN "unknown" ELSE durableLastAttemptStatus[item]]
  /\ durableLastAttemptProvisionalUnknown' = {}
  /\ durableLastAttemptDispatched' = {}
  /\ durableLastAttemptNotDispatched' = {}
  /\ restoreStatus' = [item \in Items |->
       IF item \in undoTargets THEN "unknown" ELSE restoreStatus[item]]
  /\ restoreUnknownEver' = restoreUnknownEver \cup undoTargets
  /\ currentRestoreTargets' = undoTargets
  /\ currentRestoreRequestId' = 0
  /\ currentRestoreStatus' = [item \in Items |->
       IF item \in undoTargets THEN "unknown" ELSE currentRestoreStatus[item]]
  /\ currentRestoreAttempt' = 1
  /\ currentRestoreTimedOutTargets' = {}
  /\ currentRestoreDispatched' = {}
  /\ currentRestoreBatch' = {}
  /\ currentRestoreNotDispatched' = {}
  /\ restoreAttempts' = 1
  /\ phase' = "persisted"
  /\ UNCHANGED <<
    trashStatus, trashDispatched, trashBatch, trashNotDispatched,
    undoTargets, currentRestorePriorStatus, everNotDispatched,
    retryUsed, retryTargets, retrySourceStatus, durableEverNotDispatched,
    durableRetryUsed, durableRetryTargets, durableRetrySourceStatus,
    rejectedLateTerminalKinds
    >>

DispatchRestoreChunk ==
  /\ phase = "restoring"
  /\ currentRestoreTimedOutTargets = {}
  /\ currentRestoreBatch = {}
  /\ \E chunk \in SUBSET (currentRestoreTargets \ currentRestoreDispatched):
       /\ chunk # {}
       /\ currentRestoreBatch' = chunk
       /\ currentRestoreDispatched' = currentRestoreDispatched \cup chunk
  /\ UNCHANGED <<
    phase, trashStatus, trashDispatched,
    trashBatch, trashNotDispatched, undoTargets,
    restoreStatus, restoreUnknownEver, currentRestoreAttempt,
    currentRestoreTargets, currentRestoreStatus, currentRestoreNotDispatched,
    everNotDispatched, restoreAttempts, retryUsed,
    retryTargets, retrySourceStatus, durableValid,
    durableUndoTargets, durableRestoreStatus, durableUnknownEver,
    durableEverNotDispatched, durableRestoreAttempts, durableRetryUsed,
    durableRetryTargets, durableRetrySourceStatus, durableLastAttempt,
    durableLastAttemptStatus, durableLastAttemptDispatched, durableLastAttemptNotDispatched,
    currentRestoreRequestId, currentRestorePriorStatus, currentRestoreTimedOutTargets,
    durableLastAttemptRequestId, durableLastAttemptProvisionalUnknown, rejectedLateTerminalKinds,
    durableIntentPending
    >>

RecordRestoreBatch ==
  /\ phase = "restoring"
  /\ currentRestoreBatch # {}
  /\ \E result \in [currentRestoreBatch -> TerminalStatuses]:
       /\ currentRestoreStatus' = [item \in Items |->
            IF item \in currentRestoreBatch THEN result[item]
            ELSE currentRestoreStatus[item]]
       /\ currentRestoreBatch' = {}
  /\ UNCHANGED <<
    phase, trashStatus, trashDispatched,
    trashBatch, trashNotDispatched, undoTargets,
    restoreStatus, restoreUnknownEver, currentRestoreAttempt,
    currentRestoreTargets, currentRestoreDispatched, currentRestoreNotDispatched,
    everNotDispatched, restoreAttempts, retryUsed,
    retryTargets, retrySourceStatus, durableValid,
    durableUndoTargets, durableRestoreStatus, durableUnknownEver,
    durableEverNotDispatched, durableRestoreAttempts, durableRetryUsed,
    durableRetryTargets, durableRetrySourceStatus, durableLastAttempt,
    durableLastAttemptStatus, durableLastAttemptDispatched, durableLastAttemptNotDispatched,
    currentRestoreRequestId, currentRestorePriorStatus, currentRestoreTimedOutTargets,
    durableLastAttemptRequestId, durableLastAttemptProvisionalUnknown, rejectedLateTerminalKinds,
    durableIntentPending
    >>

TimeoutRestoreBatch ==
  /\ phase = "restoring"
  /\ currentRestoreBatch # {}
  /\ currentRestoreStatus' = [item \in Items |->
       IF item \in currentRestoreBatch THEN "unknown"
       ELSE currentRestoreStatus[item]]
  /\ currentRestoreBatch' = {}
  /\ currentRestoreTimedOutTargets' =
       currentRestoreTimedOutTargets \cup currentRestoreBatch
  /\ UNCHANGED <<
    phase, trashStatus, trashDispatched,
    trashBatch, trashNotDispatched, undoTargets,
    restoreStatus, restoreUnknownEver, currentRestoreAttempt,
    currentRestoreTargets, currentRestoreDispatched, currentRestoreNotDispatched,
    everNotDispatched, restoreAttempts, retryUsed,
    retryTargets, retrySourceStatus, durableValid,
    durableUndoTargets, durableRestoreStatus, durableUnknownEver,
    durableEverNotDispatched, durableRestoreAttempts, durableRetryUsed,
    durableRetryTargets, durableRetrySourceStatus, durableLastAttempt,
    durableLastAttemptStatus, durableLastAttemptDispatched, durableLastAttemptNotDispatched,
    currentRestoreRequestId, currentRestorePriorStatus, durableLastAttemptRequestId,
    durableLastAttemptProvisionalUnknown, rejectedLateTerminalKinds, durableIntentPending
    >>

FinalizeRestore ==
  /\ phase = "restoring"
  /\ currentRestoreBatch = {}
  /\ LET neverIssued == currentRestoreTargets \ currentRestoreDispatched
         attemptStatus == [item \in Items |->
           IF item \in neverIssued THEN "failed" ELSE currentRestoreStatus[item]]
         mergedStatus == [item \in Items |->
           IF item \in currentRestoreTargets
           THEN MergeStatus(restoreStatus[item], attemptStatus[item])
           ELSE restoreStatus[item]]
     IN /\ currentRestoreStatus' = attemptStatus
        /\ currentRestoreNotDispatched' = neverIssued
        /\ restoreStatus' = mergedStatus
        /\ restoreUnknownEver' = restoreUnknownEver \cup
             {item \in currentRestoreTargets :
               attemptStatus[item] = "unknown" /\
               (currentRestoreRequestId = 0 \/
                 item \notin currentRestoreTimedOutTargets)}
        /\ everNotDispatched' = everNotDispatched \cup neverIssued
  /\ restoreAttempts' = restoreAttempts + 1
  /\ phase' =
       IF currentRestoreTimedOutTargets # {}
       THEN "restore-provisional-ready"
       ELSE "restore-final"
  /\ UNCHANGED <<
    trashStatus, trashDispatched, trashBatch,
    trashNotDispatched, undoTargets, currentRestoreAttempt,
    currentRestoreTargets, currentRestoreDispatched, currentRestoreBatch,
    retryUsed, retryTargets, retrySourceStatus,
    durableValid, durableUndoTargets, durableRestoreStatus,
    durableUnknownEver, durableEverNotDispatched, durableRestoreAttempts,
    durableRetryUsed, durableRetryTargets, durableRetrySourceStatus,
    durableLastAttempt, durableLastAttemptStatus, durableLastAttemptDispatched,
    durableLastAttemptNotDispatched, currentRestoreRequestId, currentRestorePriorStatus,
    currentRestoreTimedOutTargets, durableLastAttemptRequestId, durableLastAttemptProvisionalUnknown,
    rejectedLateTerminalKinds, durableIntentPending
    >>

PersistRecovery ==
  /\ phase \in {"restore-final", "late-terminal-ready", "restore-write-failed"}
  /\ currentRestoreTimedOutTargets = {}
  /\ durableValid' = TRUE
  /\ durableIntentPending' = FALSE
  /\ durableUndoTargets' = undoTargets
  /\ durableRestoreStatus' = restoreStatus
  /\ durableUnknownEver' = restoreUnknownEver
  /\ durableEverNotDispatched' = everNotDispatched
  /\ durableRestoreAttempts' = restoreAttempts
  /\ durableRetryUsed' = retryUsed
  /\ durableRetryTargets' = retryTargets
  /\ durableRetrySourceStatus' = retrySourceStatus
  /\ durableLastAttempt' = currentRestoreTargets
  /\ durableLastAttemptRequestId' = currentRestoreRequestId
  /\ durableLastAttemptStatus' = currentRestoreStatus
  /\ durableLastAttemptProvisionalUnknown' = {}
  /\ durableLastAttemptDispatched' = currentRestoreDispatched
  /\ durableLastAttemptNotDispatched' = currentRestoreNotDispatched
  /\ phase' = "persisted"
  /\ UNCHANGED <<
    trashStatus, trashDispatched, trashBatch,
    trashNotDispatched, undoTargets, restoreStatus,
    restoreUnknownEver, currentRestoreAttempt, currentRestoreTargets,
    currentRestoreStatus, currentRestoreDispatched, currentRestoreBatch,
    currentRestoreNotDispatched, everNotDispatched, restoreAttempts,
    retryUsed, retryTargets, retrySourceStatus,
    currentRestoreRequestId, currentRestorePriorStatus, currentRestoreTimedOutTargets,
    rejectedLateTerminalKinds
    >>

PersistProvisionalRecovery ==
  /\ phase = "restore-provisional-ready"
  /\ currentRestoreRequestId # 0
  /\ currentRestoreTimedOutTargets # {}
  /\ durableValid' = TRUE
  /\ durableIntentPending' = TRUE
  /\ durableUndoTargets' = undoTargets
  /\ durableRestoreStatus' = restoreStatus
  /\ durableUnknownEver' = restoreUnknownEver
  /\ durableEverNotDispatched' = everNotDispatched
  /\ durableRestoreAttempts' = restoreAttempts
  /\ durableRetryUsed' = retryUsed
  /\ durableRetryTargets' = retryTargets
  /\ durableRetrySourceStatus' = retrySourceStatus
  /\ durableLastAttempt' = currentRestoreTargets
  /\ durableLastAttemptRequestId' = currentRestoreRequestId
  /\ durableLastAttemptStatus' = currentRestoreStatus
  /\ durableLastAttemptProvisionalUnknown' = currentRestoreTimedOutTargets
  /\ durableLastAttemptDispatched' = currentRestoreDispatched
  /\ durableLastAttemptNotDispatched' = currentRestoreNotDispatched
  /\ phase' = "persisted"
  /\ UNCHANGED <<
    trashStatus, trashDispatched, trashBatch, trashNotDispatched,
    undoTargets, restoreStatus, restoreUnknownEver, currentRestoreAttempt,
    currentRestoreRequestId, currentRestorePriorStatus, currentRestoreTargets,
    currentRestoreStatus, currentRestoreTimedOutTargets, currentRestoreDispatched,
    currentRestoreBatch, currentRestoreNotDispatched, everNotDispatched,
    restoreAttempts, retryUsed, retryTargets, retrySourceStatus,
    rejectedLateTerminalKinds
    >>

FailRecoveryWrite ==
  /\ phase \in {"restore-final", "late-terminal-ready"}
  /\ phase' = "restore-write-failed"
  /\ UNCHANGED <<
    trashStatus, trashDispatched, trashBatch, trashNotDispatched,
    undoTargets, restoreStatus, restoreUnknownEver, currentRestoreAttempt,
    currentRestoreRequestId, currentRestorePriorStatus, currentRestoreTargets,
    currentRestoreStatus, currentRestoreTimedOutTargets, currentRestoreDispatched,
    currentRestoreBatch, currentRestoreNotDispatched, everNotDispatched,
    restoreAttempts, retryUsed, retryTargets, retrySourceStatus,
    durableValid, durableUndoTargets, durableRestoreStatus, durableUnknownEver,
    durableIntentPending, durableEverNotDispatched, durableRestoreAttempts,
    durableRetryUsed, durableRetryTargets, durableRetrySourceStatus,
    durableLastAttempt, durableLastAttemptRequestId, durableLastAttemptStatus,
    durableLastAttemptProvisionalUnknown, durableLastAttemptDispatched,
    durableLastAttemptNotDispatched, rejectedLateTerminalKinds
    >>

LateTerminalRestore ==
  /\ phase = "persisted"
  /\ durableValid
  /\ durableIntentPending
  /\ durableLastAttemptRequestId # 0
  /\ currentRestoreRequestId = durableLastAttemptRequestId
  /\ durableLastAttemptProvisionalUnknown # {}
  /\ currentRestoreTimedOutTargets = durableLastAttemptProvisionalUnknown
  /\ \E result \in [durableLastAttempt -> TerminalStatuses]:
       /\ \E item \in durableLastAttemptProvisionalUnknown:
            result[item] # "unknown"
       /\ \A item \in durableLastAttemptNotDispatched:
            result[item] = "failed"
       /\ LET terminalAttemptStatus == [item \in Items |->
            IF item \notin durableLastAttempt
            THEN durableLastAttemptStatus[item]
            ELSE IF item \in durableLastAttemptNotDispatched
              THEN "failed"
              ELSE IF durableLastAttemptStatus[item] = "confirmed"
                THEN "confirmed"
                ELSE IF durableLastAttemptStatus[item] = "unknown"
                  /\ item \notin durableLastAttemptProvisionalUnknown
                  THEN "unknown"
                ELSE result[item]]
          mergedStatus == [item \in Items |->
            IF item \in durableLastAttempt
            THEN IF item \in durableLastAttemptProvisionalUnknown
              THEN terminalAttemptStatus[item]
              ELSE MergeStatus(currentRestorePriorStatus[item],
                terminalAttemptStatus[item])
            ELSE restoreStatus[item]]
          IN /\ currentRestoreStatus' = terminalAttemptStatus
             /\ restoreStatus' = mergedStatus
             /\ restoreUnknownEver' = restoreUnknownEver \cup
                  {item \in durableLastAttempt :
                    terminalAttemptStatus[item] = "unknown"}
  /\ currentRestoreTimedOutTargets' = {}
  /\ phase' = "late-terminal-ready"
  /\ UNCHANGED <<
    trashStatus, trashDispatched,
    trashBatch, trashNotDispatched, undoTargets,
    currentRestoreAttempt, currentRestoreRequestId, currentRestorePriorStatus,
    currentRestoreTargets, currentRestoreDispatched, currentRestoreBatch,
    currentRestoreNotDispatched, everNotDispatched, restoreAttempts,
    retryUsed, retryTargets, retrySourceStatus,
    durableValid, durableUndoTargets, durableRestoreStatus, durableUnknownEver,
    durableEverNotDispatched,
    durableRestoreAttempts, durableRetryUsed, durableRetryTargets,
    durableRetrySourceStatus, durableLastAttempt, durableLastAttemptRequestId,
    durableLastAttemptStatus, durableLastAttemptDispatched, durableLastAttemptNotDispatched,
    durableLastAttemptProvisionalUnknown, rejectedLateTerminalKinds,
    durableIntentPending
    >>

RejectLateTerminal(kind) ==
  /\ kind \in LateTerminalRejectionKinds
  /\ CASE
       kind = "different-request" ->
         /\ phase = "persisted"
         /\ durableLastAttemptRequestId # 0
         /\ durableLastAttemptProvisionalUnknown # {}
       [] kind = "legacy-no-id" ->
         /\ phase = "persisted"
         /\ durableLastAttemptRequestId = 0
         /\ durableIntentPending
         /\ {item \in durableLastAttempt :
             durableLastAttemptStatus[item] = "unknown"} # {}
       [] kind = "lost-begin-ack" ->
         /\ phase = "persisted"
         /\ durableLastAttemptRequestId # 0
         /\ currentRestoreRequestId = 0
         /\ durableIntentPending
         /\ currentRestoreDispatched = {}
       [] kind = "closed-after-reload" ->
         /\ phase = "reloaded"
         /\ durableLastAttemptRequestId # 0
         /\ durableIntentPending
         /\ durableLastAttemptProvisionalUnknown # {}
  /\ rejectedLateTerminalKinds' = rejectedLateTerminalKinds \cup {kind}
  /\ UNCHANGED <<
    phase, trashStatus, trashDispatched,
    trashBatch, trashNotDispatched, undoTargets,
    restoreStatus, restoreUnknownEver, currentRestoreAttempt,
    currentRestoreRequestId, currentRestorePriorStatus, currentRestoreTargets,
    currentRestoreStatus, currentRestoreTimedOutTargets, currentRestoreDispatched,
    currentRestoreBatch, currentRestoreNotDispatched, everNotDispatched,
    restoreAttempts, retryUsed, retryTargets,
    retrySourceStatus, durableValid, durableUndoTargets,
    durableRestoreStatus, durableUnknownEver, durableEverNotDispatched,
    durableRestoreAttempts, durableRetryUsed, durableRetryTargets,
    durableRetrySourceStatus, durableLastAttempt, durableLastAttemptRequestId,
    durableLastAttemptStatus, durableLastAttemptProvisionalUnknown, durableLastAttemptDispatched,
    durableLastAttemptNotDispatched, durableIntentPending
    >>

Crash ==
  /\ phase \in {
       "restore-intent", "restoring", "restore-final",
       "restore-provisional-ready", "late-terminal-ready",
       "restore-write-failed", "persisted"
     }
  /\ durableValid
  /\ phase' = "crashed"
  /\ undoTargets' = {}
  /\ restoreStatus' = PendingStatus
  /\ restoreUnknownEver' = {}
  /\ currentRestoreAttempt' = 0
  /\ currentRestoreRequestId' = 0
  /\ currentRestorePriorStatus' = PendingStatus
  /\ currentRestoreTargets' = {}
  /\ currentRestoreStatus' = PendingStatus
  /\ currentRestoreDispatched' = {}
  /\ currentRestoreBatch' = {}
  /\ currentRestoreNotDispatched' = {}
  /\ currentRestoreTimedOutTargets' = {}
  /\ everNotDispatched' = {}
  /\ restoreAttempts' = 0
  /\ retryUsed' = FALSE
  /\ retryTargets' = {}
  /\ retrySourceStatus' = PendingStatus
  /\ UNCHANGED <<
    trashStatus, trashDispatched, trashBatch,
    trashNotDispatched, durableValid, durableUndoTargets,
    durableRestoreStatus, durableUnknownEver, durableEverNotDispatched,
    durableRestoreAttempts, durableRetryUsed, durableRetryTargets,
    durableRetrySourceStatus, durableLastAttempt, durableLastAttemptStatus,
    durableLastAttemptDispatched, durableLastAttemptNotDispatched, durableLastAttemptRequestId,
    durableLastAttemptProvisionalUnknown, rejectedLateTerminalKinds, durableIntentPending
    >>

ReloadRecovery ==
  /\ phase = "crashed"
  /\ durableValid
  /\ phase' = "reloaded"
  /\ undoTargets' = durableUndoTargets
  /\ restoreStatus' = durableRestoreStatus
  /\ restoreUnknownEver' = durableUnknownEver
       \cup durableLastAttemptProvisionalUnknown
  /\ currentRestoreAttempt' = durableRestoreAttempts
  /\ currentRestoreRequestId' = 0
  /\ currentRestorePriorStatus' = durableRestoreStatus
  /\ currentRestoreTargets' = durableLastAttempt
  /\ currentRestoreStatus' = durableLastAttemptStatus
  /\ currentRestoreDispatched' = durableLastAttemptDispatched
  /\ currentRestoreBatch' = {}
  /\ currentRestoreNotDispatched' = durableLastAttemptNotDispatched
  /\ currentRestoreTimedOutTargets' = {}
  /\ everNotDispatched' = durableEverNotDispatched
  /\ restoreAttempts' = durableRestoreAttempts
  /\ retryUsed' = durableRetryUsed
  /\ retryTargets' = durableRetryTargets
  /\ retrySourceStatus' = durableRetrySourceStatus
  /\ UNCHANGED <<
    trashStatus, trashDispatched, trashBatch,
    trashNotDispatched, durableValid, durableUndoTargets,
    durableRestoreStatus, durableUnknownEver, durableEverNotDispatched,
    durableRestoreAttempts, durableRetryUsed, durableRetryTargets,
    durableRetrySourceStatus, durableLastAttempt, durableLastAttemptStatus,
    durableLastAttemptDispatched, durableLastAttemptNotDispatched, durableLastAttemptRequestId,
    durableLastAttemptProvisionalUnknown, rejectedLateTerminalKinds, durableIntentPending
    >>

RetryFailedRestore ==
  /\ phase = "reloaded"
  /\ restoreAttempts = 1
  /\ ~retryUsed
  /\ ~durableIntentPending
  /\ \E targets \in SUBSET durableUndoTargets:
       /\ targets # {}
       /\ targets = {item \in durableUndoTargets :
            restoreStatus[item] = "failed" \/
            (UnsafeRetryUnknown /\ restoreStatus[item] = "unknown")}
       /\ phase' = "restore-intent"
       /\ currentRestoreAttempt' = 2
       /\ currentRestoreRequestId' = 2
       /\ currentRestorePriorStatus' = restoreStatus
       /\ currentRestoreTimedOutTargets' = {}
       /\ currentRestoreTargets' = targets
       /\ currentRestoreStatus' = PendingStatus
       /\ currentRestoreDispatched' = {}
       /\ currentRestoreBatch' = {}
       /\ currentRestoreNotDispatched' = {}
       /\ retryUsed' = TRUE
       /\ retryTargets' = targets
       /\ retrySourceStatus' = restoreStatus
  /\ UNCHANGED <<
    trashStatus, trashDispatched, trashBatch,
    trashNotDispatched, undoTargets, restoreStatus,
    restoreUnknownEver, everNotDispatched, restoreAttempts,
    durableValid, durableUndoTargets, durableRestoreStatus,
    durableUnknownEver, durableEverNotDispatched, durableRestoreAttempts,
    durableRetryUsed, durableRetryTargets, durableRetrySourceStatus,
    durableLastAttempt, durableLastAttemptStatus, durableLastAttemptDispatched,
    durableLastAttemptNotDispatched, durableLastAttemptRequestId, durableLastAttemptProvisionalUnknown,
    rejectedLateTerminalKinds, durableIntentPending
    >>

CompleteWithoutRestore ==
  /\ phase = "trash-ready"
  /\ undoTargets = {}
  /\ phase' = "done"
  /\ UNCHANGED <<
    trashStatus, trashDispatched, trashBatch,
    trashNotDispatched, undoTargets, restoreStatus,
    restoreUnknownEver, currentRestoreAttempt, currentRestoreTargets,
    currentRestoreStatus, currentRestoreDispatched, currentRestoreBatch,
    currentRestoreNotDispatched, everNotDispatched, restoreAttempts,
    retryUsed, retryTargets, retrySourceStatus,
    durableValid, durableUndoTargets, durableRestoreStatus,
    durableUnknownEver, durableEverNotDispatched, durableRestoreAttempts,
    durableRetryUsed, durableRetryTargets, durableRetrySourceStatus,
    durableLastAttempt, durableLastAttemptStatus, durableLastAttemptDispatched,
    durableLastAttemptNotDispatched, currentRestoreRequestId, currentRestorePriorStatus,
    currentRestoreTimedOutTargets, durableLastAttemptRequestId, durableLastAttemptProvisionalUnknown,
    rejectedLateTerminalKinds, durableIntentPending
    >>

FinishAfterReload ==
  /\ phase = "reloaded"
  /\ (durableIntentPending \/ restoreAttempts = 2 \/
      {item \in durableUndoTargets : restoreStatus[item] = "failed"} = {})
  /\ phase' = "done"
  /\ UNCHANGED <<
    trashStatus, trashDispatched, trashBatch,
    trashNotDispatched, undoTargets, restoreStatus,
    restoreUnknownEver, currentRestoreAttempt, currentRestoreTargets,
    currentRestoreStatus, currentRestoreDispatched, currentRestoreBatch,
    currentRestoreNotDispatched, everNotDispatched, restoreAttempts,
    retryUsed, retryTargets, retrySourceStatus,
    durableValid, durableUndoTargets, durableRestoreStatus,
    durableUnknownEver, durableEverNotDispatched, durableRestoreAttempts,
    durableRetryUsed, durableRetryTargets, durableRetrySourceStatus,
    durableLastAttempt, durableLastAttemptStatus, durableLastAttemptDispatched,
    durableLastAttemptNotDispatched, currentRestoreRequestId, currentRestorePriorStatus,
    currentRestoreTimedOutTargets, durableLastAttemptRequestId, durableLastAttemptProvisionalUnknown,
    rejectedLateTerminalKinds, durableIntentPending
    >>

Done ==
  /\ phase = "done"
  /\ UNCHANGED vars

Next ==
  \/ BeginTrash
  \/ DispatchTrashChunk
  \/ RecordTrashBatch
  \/ TimeoutTrashBatch
  \/ FinalizeTrash
  \/ BeginRestore
  \/ BeginLegacyRestore
  \/ PersistRestoreIntent
  \/ FailRestoreIntentWrite
  \/ DispatchRestoreChunk
  \/ RecordRestoreBatch
  \/ TimeoutRestoreBatch
  \/ FinalizeRestore
  \/ PersistProvisionalRecovery
  \/ FailRecoveryWrite
  \/ PersistRecovery
  \/ LateTerminalRestore
  \/ \E kind \in LateTerminalRejectionKinds: RejectLateTerminal(kind)
  \/ Crash
  \/ ReloadRecovery
  \/ RetryFailedRestore
  \/ CompleteWithoutRestore
  \/ FinishAfterReload
  \/ Done

TypeOK ==
  /\ phase \in Phases
  /\ trashStatus \in [Items -> Statuses]
  /\ trashDispatched \subseteq Items
  /\ trashBatch \subseteq Items
  /\ trashNotDispatched \subseteq Items
  /\ undoTargets \subseteq Items
  /\ restoreStatus \in [Items -> Statuses]
  /\ restoreUnknownEver \subseteq Items
  /\ currentRestoreAttempt \in {0, 1, 2}
  /\ currentRestoreRequestId \in RequestIds
  /\ currentRestorePriorStatus \in [Items -> Statuses]
  /\ currentRestoreTargets \subseteq Items
  /\ currentRestoreStatus \in [Items -> Statuses]
  /\ currentRestoreTimedOutTargets \subseteq Items
  /\ currentRestoreDispatched \subseteq Items
  /\ currentRestoreBatch \subseteq Items
  /\ currentRestoreNotDispatched \subseteq Items
  /\ everNotDispatched \subseteq Items
  /\ restoreAttempts \in {0, 1, 2}
  /\ retryUsed \in BOOLEAN
  /\ retryTargets \subseteq Items
  /\ retrySourceStatus \in [Items -> Statuses]
  /\ durableValid \in BOOLEAN
  /\ durableIntentPending \in BOOLEAN
  /\ durableUndoTargets \subseteq Items
  /\ durableRestoreStatus \in [Items -> Statuses]
  /\ durableUnknownEver \subseteq Items
  /\ durableEverNotDispatched \subseteq Items
  /\ durableRestoreAttempts \in {0, 1, 2}
  /\ durableRetryUsed \in BOOLEAN
  /\ durableRetryTargets \subseteq Items
  /\ durableRetrySourceStatus \in [Items -> Statuses]
  /\ durableLastAttempt \subseteq Items
  /\ durableLastAttemptRequestId \in RequestIds
  /\ durableLastAttemptStatus \in [Items -> Statuses]
  /\ durableLastAttemptProvisionalUnknown \subseteq Items
  /\ durableLastAttemptDispatched \subseteq Items
  /\ durableLastAttemptNotDispatched \subseteq Items
  /\ rejectedLateTerminalKinds \subseteq LateTerminalRejectionKinds

InvTrashConfirmedOnly ==
  phase \in {"trash-ready", "restore-intent", "restoring", "restore-final",
    "restore-provisional-ready", "late-terminal-ready", "restore-write-failed",
    "persisted", "reloaded", "done"}
  => undoTargets = {item \in Items : trashStatus[item] = "confirmed"}

InvTrashTerminalPartition ==
  phase \in {"trash-ready", "restore-intent", "restoring", "restore-final",
    "restore-provisional-ready", "late-terminal-ready", "restore-write-failed",
    "persisted", "reloaded", "done"}
  => /\ trashNotDispatched = Items \ trashDispatched
     /\ trashNotDispatched \subseteq {item \in Items : trashStatus[item] = "failed"}
     /\ \A item \in Items : trashStatus[item] \in TerminalStatuses

InvRestoreDispatchAuthorized ==
  /\ currentRestoreDispatched \subseteq currentRestoreTargets
  /\ currentRestoreBatch \subseteq currentRestoreDispatched
  /\ currentRestoreTargets \subseteq undoTargets \cup durableUndoTargets

InvRestoreTerminalPartition ==
  phase \in {"restore-final", "restore-provisional-ready", "late-terminal-ready", "persisted", "reloaded"}
  /\ ~durableIntentPending
  => /\ currentRestoreTargets =
       currentRestoreDispatched \cup currentRestoreNotDispatched
     /\ currentRestoreDispatched \cap currentRestoreNotDispatched = {}
     /\ currentRestoreNotDispatched =
       currentRestoreTargets \ currentRestoreDispatched
     /\ currentRestoreNotDispatched \subseteq
       {item \in Items : currentRestoreStatus[item] = "failed"}
     /\ \A item \in currentRestoreTargets :
       currentRestoreStatus[item] \in TerminalStatuses

InvUnknownSticky ==
  restoreUnknownEver \subseteq
    {item \in Items : restoreStatus[item] = "unknown"}

InvTimeoutUnknownIsProvisionalOrSealed ==
  /\ currentRestoreTimedOutTargets \subseteq currentRestoreDispatched
  /\ currentRestoreTimedOutTargets \subseteq
       {item \in Items : currentRestoreStatus[item] = "unknown"}
  /\ (phase = "reloaded" => currentRestoreRequestId = 0)
  /\ (phase = "restoring" =>
       /\ durableValid
       /\ durableIntentPending
       /\ currentRestoreRequestId # 0
       /\ durableLastAttemptRequestId = currentRestoreRequestId
       /\ durableLastAttempt = currentRestoreTargets)
  /\ (phase = "persisted" /\ durableLastAttemptProvisionalUnknown # {}
       /\ currentRestoreRequestId # 0 =>
       /\ durableLastAttemptRequestId # 0
       /\ currentRestoreRequestId = durableLastAttemptRequestId
       /\ currentRestoreTimedOutTargets =
            durableLastAttemptProvisionalUnknown)
  /\ (phase = "late-terminal-ready" =>
       /\ durableIntentPending
       /\ durableLastAttemptProvisionalUnknown # {}
       /\ currentRestoreRequestId = durableLastAttemptRequestId
       /\ currentRestoreTimedOutTargets = {})
  /\ (phase = "restore-write-failed" /\ durableIntentPending =>
       currentRestoreRequestId = durableLastAttemptRequestId)

InvRestoreOnlyTrashedTargets ==
  phase \in {"restore-final", "restore-provisional-ready", "late-terminal-ready",
    "restore-write-failed", "persisted", "reloaded", "done"}
  => {item \in Items : restoreStatus[item] # "pending"} \subseteq
       undoTargets

InvRetryOnlyFailed ==
  retryUsed
  => retryTargets =
       {item \in durableUndoTargets : retrySourceStatus[item] = "failed"}

InvUnknownNotRetryable ==
  retryUsed =>
    retryTargets \cap
      {item \in Items : retrySourceStatus[item] = "unknown"} = {}

InvDurableUnknownSticky ==
  durableValid
  => /\ durableUnknownEver \cup durableLastAttemptProvisionalUnknown =
       {item \in Items : durableRestoreStatus[item] = "unknown"}
     /\ durableUnknownEver \cap durableLastAttemptProvisionalUnknown = {}
     /\ durableLastAttemptProvisionalUnknown \subseteq durableLastAttempt
     /\ (durableLastAttemptRequestId = 0 =>
          durableLastAttemptProvisionalUnknown = {})

InvDurableAttemptPartition ==
  durableValid /\ ~durableIntentPending
  => /\ durableLastAttempt =
       durableLastAttemptDispatched \cup durableLastAttemptNotDispatched
     /\ durableLastAttemptDispatched \cap durableLastAttemptNotDispatched = {}
     /\ durableLastAttemptNotDispatched =
       durableLastAttempt \ durableLastAttemptDispatched
     /\ durableLastAttemptNotDispatched \subseteq
       {item \in Items : durableLastAttemptStatus[item] = "failed"}

InvDurableReloadExact ==
  phase = "reloaded"
  => /\ undoTargets = durableUndoTargets
     /\ restoreStatus = durableRestoreStatus
     /\ restoreUnknownEver =
          durableUnknownEver \cup durableLastAttemptProvisionalUnknown
     /\ everNotDispatched = durableEverNotDispatched
     /\ restoreAttempts = durableRestoreAttempts
     /\ retryUsed = durableRetryUsed
     /\ retryTargets = durableRetryTargets
     /\ retrySourceStatus = durableRetrySourceStatus
     /\ currentRestoreTargets = durableLastAttempt
     /\ currentRestoreStatus = durableLastAttemptStatus
     /\ currentRestoreDispatched = durableLastAttemptDispatched
     /\ currentRestoreNotDispatched = durableLastAttemptNotDispatched
     /\ currentRestoreRequestId = 0
     /\ currentRestoreTimedOutTargets = {}
     /\ (durableIntentPending => currentRestoreRequestId = 0)

InvLateTerminalKeepsConfirmedProgress ==
  phase \in {"persisted", "late-terminal-ready", "restore-write-failed"}
  => \A item \in durableLastAttempt :
       durableLastAttemptStatus[item] = "confirmed"
       => currentRestoreStatus[item] = "confirmed"

InvPendingIntentProtectsTargets ==
  durableIntentPending
  => /\ durableValid
     /\ durableLastAttempt # {}
     /\ (durableLastAttemptRequestId = 0 =>
          \A item \in durableLastAttempt :
            durableRestoreStatus[item] = "unknown")
     /\ (phase = "restoring" =>
          /\ currentRestoreRequestId # 0
          /\ currentRestoreRequestId = durableLastAttemptRequestId
          /\ currentRestoreTargets = durableLastAttempt)
     /\ (phase = "reloaded" => currentRestoreRequestId = 0)

InvEverNotDispatchedRetained ==
  phase \in {"persisted", "reloaded"}
  => durableEverNotDispatched = everNotDispatched

=============================================================================
