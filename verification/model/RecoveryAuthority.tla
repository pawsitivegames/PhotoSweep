-------------------- MODULE RecoveryAuthority --------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Callers, Targets, Namespaces, UnsafePruneActiveGuard,
  UnsafeClearSafetyRows

Statuses == {"pending", "confirmed", "failed", "unknown"}
TerminalStatuses == {"confirmed", "failed", "unknown"}
CallStates == {
  "idle", "queued", "failed-before-write", "accepted", "ack-lost",
  "legacy-guarded", "rejected-overlap", "terminal", "terminal-staged", "timed-out",
  "write-failed", "reloaded-pending", "reloaded-no-effect"
}
OperationIds == {"none", "op-a", "op-b"}
RequestIds == {"none", "request-a", "request-b"}
LateRequestIds == {"legacy", "request-a", "request-b"}
LateRejectionKinds == {"different-request", "legacy-no-id", "after-reload"}

OperationFor(c) == IF c = "caller-a" THEN "op-a" ELSE "op-b"
RequestFor(c) == IF c = "caller-a" THEN "request-a" ELSE "request-b"
EmptyTargetStatus == [target \in Targets |-> "pending"]

VARIABLES calls, durable, completedHistoryCount, workerGeneration,
  clearSucceededInState, rejectedLateResults

vars == <<calls, durable, completedHistoryCount, workerGeneration,
  clearSucceededInState, rejectedLateResults>>

ActiveIntents == durable.committed \ durable.terminal

UnknownRows ==
  {c \in durable.terminal :
    \E target \in durable.targets[c]: durable.status[c][target] = "unknown"}

OrdinaryRows == durable.terminal \ UnknownRows

SafetyRows == durable.guards \cup UnknownRows

OverlapsStoredGuard(c) ==
  \E other \in durable.guards:
    other # c
    /\ durable.namespace[other] = calls.namespace[c]
    /\ durable.targets[other] \cap calls.targets[c] # {}

Init ==
  /\ calls = [
       phase |-> [caller \in Callers |-> "idle"],
       operationId |-> [caller \in Callers |-> "none"],
       requestId |-> [caller \in Callers |-> "none"],
       namespace |-> [caller \in Callers |-> "none"],
       targets |-> [caller \in Callers |-> {}],
       dispatched |-> [caller \in Callers |-> {}],
       dispatchedAtReload |-> [caller \in Callers |-> {}],
       guardsAtReload |-> {},
       confirmedProgress |-> [caller \in Callers |-> {}],
       provisionalUnknown |-> [caller \in Callers |-> {}],
       staged |-> {},
       stagedStatus |-> [caller \in Callers |-> EmptyTargetStatus],
       liveAuthorized |-> {},
       beginAcked |-> {},
       dispatchAuthorized |-> {},
       rejectedAfterReload |-> {},
       rejectedGuardWitness |-> [caller \in Callers |-> {}],
       clearVictims |-> {},
       prewriteFailed |-> {},
       writeFailed |-> {}
     ]
  /\ durable = [
       committed |-> {},
       records |-> {},
       guards |-> {},
       terminal |-> {},
       operationId |-> [caller \in Callers |-> "none"],
       requestId |-> [caller \in Callers |-> "none"],
       namespace |-> [caller \in Callers |-> "none"],
       targets |-> [caller \in Callers |-> {}],
       restorable |-> [caller \in Callers |-> {}],
       status |-> [caller \in Callers |-> EmptyTargetStatus]
     ]
  /\ completedHistoryCount = 0
  /\ workerGeneration = 0
  /\ clearSucceededInState = FALSE
  /\ rejectedLateResults = {}

Submit(c, namespace, targets) ==
  /\ c \in Callers
  /\ namespace \in Namespaces
  /\ targets \in SUBSET Targets
  /\ targets # {}
  /\ IF c = "caller-a"
       THEN targets \in {{"asset-a"}, {"asset-a", "asset-b"}}
       ELSE targets \in {{"asset-a"}, {"asset-b"}}
  /\ calls.phase[c] = "idle"
  /\ workerGeneration = 0
  /\ calls' = [calls EXCEPT
       !.phase[c] = "queued",
       !.operationId[c] = OperationFor(c),
       !.requestId[c] = RequestFor(c),
       !.namespace[c] = namespace,
       !.targets[c] = targets]
  /\ UNCHANGED <<durable, completedHistoryCount, workerGeneration,
       clearSucceededInState, rejectedLateResults>>

SubmitAfterReload(c, namespace, targets) ==
  /\ c \in Callers
  /\ namespace \in Namespaces
  /\ targets \in SUBSET Targets
  /\ targets # {}
  /\ IF c = "caller-a"
       THEN targets \in {{"asset-a"}, {"asset-a", "asset-b"}}
       ELSE targets \in {{"asset-a"}, {"asset-b"}}
  /\ calls.phase[c] = "idle"
  /\ workerGeneration = 1
  /\ calls' = [calls EXCEPT
       !.phase[c] = "queued",
       !.operationId[c] = OperationFor(c),
       !.requestId[c] = RequestFor(c),
       !.namespace[c] = namespace,
       !.targets[c] = targets]
  /\ UNCHANGED <<durable, completedHistoryCount, workerGeneration,
       clearSucceededInState, rejectedLateResults>>

BeginPrewriteFails(c) ==
  /\ c \in Callers
  /\ calls.phase[c] = "queued"
  /\ ~OverlapsStoredGuard(c)
  /\ calls' = [calls EXCEPT
       !.phase[c] = "failed-before-write",
       !.prewriteFailed = @ \cup {c}]
  /\ UNCHANGED <<durable, completedHistoryCount, workerGeneration,
       clearSucceededInState, rejectedLateResults>>

BeginPersistGuardAck(c) ==
  /\ c \in Callers
  /\ calls.phase[c] = "queued"
  /\ ~OverlapsStoredGuard(c)
  /\ calls' = [calls EXCEPT
       !.phase[c] = "accepted",
       !.provisionalUnknown[c] = calls.targets[c],
       !.liveAuthorized = @ \cup {c},
       !.beginAcked = @ \cup {c}]
  /\ durable' = [durable EXCEPT
       !.committed = @ \cup {c},
       !.records = @ \cup {c},
       !.guards = @ \cup {c},
       !.terminal = @ \ {c},
       !.operationId[c] = calls.operationId[c],
       !.requestId[c] = calls.requestId[c],
       !.namespace[c] = calls.namespace[c],
       !.targets[c] = calls.targets[c],
       !.restorable[c] = {},
       !.status[c] = [target \in Targets |->
         IF target \in calls.targets[c] THEN "unknown" ELSE "pending"]]
  /\ clearSucceededInState' = FALSE
  /\ UNCHANGED <<completedHistoryCount, workerGeneration,
       rejectedLateResults>>

BeginPersistGuardLostAck(c) ==
  /\ c \in Callers
  /\ calls.phase[c] = "queued"
  /\ ~OverlapsStoredGuard(c)
  /\ calls' = [calls EXCEPT
       !.phase[c] = "ack-lost",
       !.provisionalUnknown[c] = calls.targets[c]]
  /\ durable' = [durable EXCEPT
       !.committed = @ \cup {c},
       !.records = @ \cup {c},
       !.guards = @ \cup {c},
       !.terminal = @ \ {c},
       !.operationId[c] = calls.operationId[c],
       !.requestId[c] = calls.requestId[c],
       !.namespace[c] = calls.namespace[c],
       !.targets[c] = calls.targets[c],
       !.restorable[c] = {},
       !.status[c] = [target \in Targets |->
         IF target \in calls.targets[c] THEN "unknown" ELSE "pending"]]
  /\ clearSucceededInState' = FALSE
  /\ UNCHANGED <<completedHistoryCount, workerGeneration,
       rejectedLateResults>>

BeginLegacyIntent(c) ==
  /\ c \in Callers
  /\ calls.phase[c] = "queued"
  /\ ~OverlapsStoredGuard(c)
  /\ calls' = [calls EXCEPT
       !.phase[c] = "legacy-guarded",
       !.provisionalUnknown[c] = calls.targets[c]]
  /\ durable' = [durable EXCEPT
       !.committed = @ \cup {c},
       !.records = @ \cup {c},
       !.guards = @ \cup {c},
       !.terminal = @ \ {c},
       !.operationId[c] = calls.operationId[c],
       !.requestId[c] = "none",
       !.namespace[c] = calls.namespace[c],
       !.targets[c] = calls.targets[c],
       !.restorable[c] = {},
       !.status[c] = [target \in Targets |->
         IF target \in calls.targets[c] THEN "unknown" ELSE "pending"]]
  /\ clearSucceededInState' = FALSE
  /\ UNCHANGED <<completedHistoryCount, workerGeneration,
       rejectedLateResults>>

RejectBeginOverlap(c) ==
  /\ c \in Callers
  /\ calls.phase[c] = "queued"
  /\ OverlapsStoredGuard(c)
  /\ calls' = [calls EXCEPT !.phase[c] = "rejected-overlap"]
  /\ UNCHANGED <<durable, completedHistoryCount, workerGeneration,
       clearSucceededInState, rejectedLateResults>>

RejectBeginOverlapAfterReload(c) ==
  /\ c \in Callers
  /\ workerGeneration = 1
  /\ calls.phase[c] = "queued"
  /\ \E other \in calls.guardsAtReload:
       other \in durable.guards
       /\ other # c
       /\ durable.namespace[other] = calls.namespace[c]
       /\ durable.targets[other] \cap calls.targets[c] # {}
  /\ calls' = [calls EXCEPT
       !.phase[c] = "rejected-overlap",
       !.rejectedAfterReload = @ \cup {c},
       !.rejectedGuardWitness[c] = {other \in calls.guardsAtReload \cap durable.guards:
         other # c
         /\ durable.namespace[other] = calls.namespace[c]
         /\ durable.targets[other] \cap calls.targets[c] # {}}]
  /\ UNCHANGED <<durable, completedHistoryCount, workerGeneration,
       clearSucceededInState, rejectedLateResults>>

DispatchAuthorized(c) ==
  /\ c \in Callers
  /\ calls.phase[c] = "accepted"
  /\ c \in calls.liveAuthorized
  /\ c \in durable.guards
  /\ calls.requestId[c] = durable.requestId[c]
  /\ calls.operationId[c] = durable.operationId[c]
  /\ calls.namespace[c] = durable.namespace[c]
  /\ calls.targets[c] = durable.targets[c]
  /\ calls.dispatched[c] = {}
  /\ calls' = [calls EXCEPT
       !.dispatched[c] = calls.targets[c],
       !.dispatchAuthorized = @ \cup {c}]
  /\ UNCHANGED <<durable, completedHistoryCount, workerGeneration,
       clearSucceededInState, rejectedLateResults>>

RecordProgressConfirmed(c) ==
  /\ c \in Callers
  /\ calls.phase[c] \in {"accepted", "timed-out"}
  /\ c \in calls.liveAuthorized
  /\ calls.dispatched[c] # {}
  /\ \E target \in calls.dispatched[c]:
       /\ durable' = [durable EXCEPT
            !.status[c][target] = "confirmed"]
       /\ calls' = [calls EXCEPT
            !.confirmedProgress[c] = @ \cup {target},
            !.provisionalUnknown[c] = @ \ {target}]
  /\ UNCHANGED <<completedHistoryCount, workerGeneration,
       clearSucceededInState, rejectedLateResults>>

TimeoutProvisional(c) ==
  /\ c \in Callers
  /\ calls.phase[c] = "accepted"
  /\ c \in calls.liveAuthorized
  /\ calls.dispatched[c] # {}
  /\ calls.provisionalUnknown[c] # {}
  /\ calls' = [calls EXCEPT !.phase[c] = "timed-out"]
  /\ UNCHANGED <<durable, completedHistoryCount, workerGeneration,
       clearSucceededInState, rejectedLateResults>>

StageTerminalResponse(c) ==
  /\ c \in Callers
  /\ calls.phase[c] \in {"accepted", "timed-out", "write-failed"}
  /\ c \in calls.liveAuthorized
  /\ c \in durable.guards
  /\ c \notin calls.staged
  /\ \E result \in [calls.targets[c] -> TerminalStatuses]:
       /\ calls' = [calls EXCEPT
            !.phase[c] = "terminal-staged",
            !.staged = @ \cup {c},
            !.stagedStatus[c] = [target \in Targets |->
              IF target \notin calls.targets[c]
              THEN durable.status[c][target]
              ELSE IF durable.status[c][target] = "confirmed"
                THEN "confirmed"
                ELSE result[target]]]
  /\ UNCHANGED <<durable, completedHistoryCount, workerGeneration,
       clearSucceededInState, rejectedLateResults>>

PersistTerminal(c) ==
  /\ c \in Callers
  /\ c \in calls.staged
  /\ c \in calls.liveAuthorized
  /\ c \in durable.guards
  /\ calls.requestId[c] = durable.requestId[c]
  /\ calls.operationId[c] = durable.operationId[c]
  /\ durable' = [durable EXCEPT
       !.status[c] = calls.stagedStatus[c],
       !.restorable[c] = {target \in calls.targets[c]:
         calls.stagedStatus[c][target] = "failed"},
       !.terminal = @ \cup {c},
       !.guards = @ \ {c}]
  /\ calls' = [calls EXCEPT
       !.phase[c] = "terminal",
       !.staged = @ \ {c},
       !.liveAuthorized = @ \ {c},
       !.provisionalUnknown[c] = {}]
  /\ completedHistoryCount' =
       IF \E target \in calls.targets[c]:
            calls.stagedStatus[c][target] = "unknown"
       THEN completedHistoryCount
       ELSE IF completedHistoryCount < 2
         THEN completedHistoryCount + 1
         ELSE 2
  /\ UNCHANGED <<workerGeneration, clearSucceededInState,
       rejectedLateResults>>

FailTerminalWrite(c) ==
  /\ c \in Callers
  /\ c \in calls.staged
  /\ c \in calls.liveAuthorized
  /\ c \in durable.guards
  /\ calls' = [calls EXCEPT
       !.phase[c] = "write-failed",
       !.writeFailed = @ \cup {c}]
  /\ UNCHANGED <<durable, completedHistoryCount, workerGeneration,
       clearSucceededInState, rejectedLateResults>>

RejectLateResponse(c, presentedRequestId) ==
  /\ c \in Callers
  /\ presentedRequestId \in LateRequestIds
  /\ c \in ActiveIntents
  /\ (c \notin calls.liveAuthorized \/
      presentedRequestId # calls.requestId[c] \/
      durable.requestId[c] = "none")
  /\ LET rejectionKind ==
       IF c \notin calls.liveAuthorized \/
          calls.phase[c] = "reloaded-pending"
       THEN "after-reload"
       ELSE IF presentedRequestId = "legacy" \/
          durable.requestId[c] = "none"
       THEN "legacy-no-id"
       ELSE "different-request"
     IN rejectedLateResults' = rejectedLateResults \cup {rejectionKind}
  /\ UNCHANGED <<calls, durable, completedHistoryCount, workerGeneration,
       clearSucceededInState>>

ReloadWorker ==
  /\ workerGeneration = 0
  /\ workerGeneration' = 1
  /\ calls' = [calls EXCEPT
       !.phase = [caller \in Callers |->
         IF caller \in ActiveIntents
         THEN "reloaded-pending"
         ELSE IF calls.phase[caller] = "queued"
           THEN "reloaded-no-effect"
           ELSE calls.phase[caller]],
       !.staged = {},
       !.liveAuthorized = {},
       !.dispatchedAtReload = calls.dispatched,
       !.guardsAtReload = durable.guards]
  /\ UNCHANGED <<durable, completedHistoryCount, clearSucceededInState,
       rejectedLateResults>>

AddCompletedHistory ==
  /\ completedHistoryCount < 2
  /\ completedHistoryCount' = completedHistoryCount + 1
  /\ UNCHANGED <<calls, durable, workerGeneration, clearSucceededInState,
       rejectedLateResults>>

PruneCompletedHistory ==
  /\ completedHistoryCount = 2
  /\ completedHistoryCount' = 1
  /\ LET victims ==
       IF UnsafePruneActiveGuard THEN SafetyRows ELSE OrdinaryRows
     IN durable' = [durable EXCEPT
          !.records = @ \ victims,
          !.guards = @ \ (IF UnsafePruneActiveGuard THEN victims ELSE {}),
          !.restorable = [caller \in Callers |->
            IF caller \in victims THEN {} ELSE durable.restorable[caller]]]
  /\ UNCHANGED <<calls, workerGeneration, clearSucceededInState,
       rejectedLateResults>>

ClearRecovery ==
  /\ clearSucceededInState = FALSE
  /\ (completedHistoryCount > 0 \/ durable.records # {})
  /\ completedHistoryCount' = 0
  /\ clearSucceededInState' = TRUE
  /\ LET victims == OrdinaryRows \cup (IF UnsafeClearSafetyRows THEN UnknownRows ELSE {})
     IN durable' = [durable EXCEPT
          !.records = @ \ victims,
          !.restorable = [caller \in Callers |->
            IF caller \in victims THEN {} ELSE durable.restorable[caller]]]
  /\ calls' = [calls EXCEPT !.clearVictims = @ \cup OrdinaryRows]
  /\ UNCHANGED <<workerGeneration, rejectedLateResults>>

Next ==
  \/ \E c \in Callers, namespace \in Namespaces,
       targets \in SUBSET Targets: Submit(c, namespace, targets)
  \/ \E c \in Callers, namespace \in Namespaces,
       targets \in SUBSET Targets: SubmitAfterReload(c, namespace, targets)
  \/ \E c \in Callers: BeginPrewriteFails(c)
  \/ \E c \in Callers: BeginPersistGuardAck(c)
  \/ \E c \in Callers: BeginPersistGuardLostAck(c)
  \/ \E c \in Callers: BeginLegacyIntent(c)
  \/ \E c \in Callers: RejectBeginOverlap(c)
  \/ \E c \in Callers: RejectBeginOverlapAfterReload(c)
  \/ \E c \in Callers: DispatchAuthorized(c)
  \/ \E c \in Callers: RecordProgressConfirmed(c)
  \/ \E c \in Callers: TimeoutProvisional(c)
  \/ \E c \in Callers: StageTerminalResponse(c)
  \/ \E c \in Callers: PersistTerminal(c)
  \/ \E c \in Callers: FailTerminalWrite(c)
  \/ \E c \in Callers, id \in LateRequestIds: RejectLateResponse(c, id)
  \/ ReloadWorker
  \/ AddCompletedHistory
  \/ PruneCompletedHistory
  \/ ClearRecovery

TypeOK ==
  /\ calls.phase \in [Callers -> CallStates]
  /\ calls.operationId \in [Callers -> OperationIds]
  /\ calls.requestId \in [Callers -> RequestIds]
  /\ calls.namespace \in [Callers -> (Namespaces \cup {"none"})]
  /\ calls.targets \in [Callers -> SUBSET Targets]
  /\ calls.dispatched \in [Callers -> SUBSET Targets]
  /\ calls.dispatchedAtReload \in [Callers -> SUBSET Targets]
  /\ calls.guardsAtReload \subseteq Callers
  /\ calls.confirmedProgress \in [Callers -> SUBSET Targets]
  /\ calls.provisionalUnknown \in [Callers -> SUBSET Targets]
  /\ calls.staged \subseteq Callers
  /\ calls.stagedStatus \in [Callers -> [Targets -> Statuses]]
  /\ calls.liveAuthorized \subseteq Callers
  /\ calls.beginAcked \subseteq Callers
  /\ calls.dispatchAuthorized \subseteq Callers
  /\ calls.rejectedAfterReload \subseteq Callers
  /\ calls.rejectedGuardWitness \in [Callers -> SUBSET Callers]
  /\ calls.clearVictims \subseteq Callers
  /\ calls.prewriteFailed \subseteq Callers
  /\ calls.writeFailed \subseteq Callers
  /\ durable.committed \subseteq Callers
  /\ durable.records \subseteq Callers
  /\ durable.guards \subseteq Callers
  /\ durable.terminal \subseteq Callers
  /\ durable.operationId \in [Callers -> OperationIds]
  /\ durable.requestId \in [Callers -> RequestIds]
  /\ durable.namespace \in [Callers -> (Namespaces \cup {"none"})]
  /\ durable.targets \in [Callers -> SUBSET Targets]
  /\ durable.restorable \in [Callers -> SUBSET Targets]
  /\ durable.status \in [Callers -> [Targets -> Statuses]]
  /\ completedHistoryCount \in {0, 1, 2}
  /\ workerGeneration \in {0, 1}
  /\ clearSucceededInState \in BOOLEAN
  /\ rejectedLateResults \subseteq LateRejectionKinds

InvFailedPrewriteNoEffect ==
  \A c \in calls.prewriteFailed:
    /\ c \notin durable.committed
    /\ calls.dispatched[c] = {}

InvDispatchRequiresExactReadbackAck ==
  \A c \in Callers:
    calls.dispatched[c] # {} =>
      /\ c \in calls.beginAcked
      /\ c \in calls.dispatchAuthorized
      /\ c \in durable.committed
      /\ calls.requestId[c] = durable.requestId[c]
      /\ calls.operationId[c] = durable.operationId[c]
      /\ calls.namespace[c] = durable.namespace[c]
      /\ calls.targets[c] = durable.targets[c]

InvLostAckNeverDispatches ==
  \A c \in Callers:
    calls.phase[c] = "ack-lost" =>
      /\ c \notin calls.liveAuthorized
      /\ calls.dispatched[c] = {}
      /\ c \in durable.guards

InvActiveIntentGuardRetained ==
  /\ ActiveIntents \subseteq durable.guards
  /\ \A c \in ActiveIntents:
       /\ c \in durable.committed
       /\ durable.operationId[c] = OperationFor(c)
       /\ durable.namespace[c] \in Namespaces
       /\ durable.targets[c] # {}
       /\ durable.targets[c] \subseteq Targets
       /\ (durable.requestId[c] = "none" \/
            durable.requestId[c] = RequestFor(c))

InvSafetyRowsRetained == SafetyRows \subseteq durable.records

InvRestorableTargetsHaveStoredRecord ==
  \A c \in Callers:
    durable.restorable[c] # {} =>
      /\ c \in durable.records
      /\ c \in durable.terminal

InvConfirmedAndUnknownTargetsNotRestorable ==
  \A c \in durable.terminal:
    \A target \in durable.targets[c]:
      durable.status[c][target] \in {"confirmed", "unknown"} =>
        target \notin durable.restorable[c]

InvTerminalRequestIdentity ==
  \A c \in durable.terminal:
    /\ c \in durable.committed
    /\ durable.operationId[c] = OperationFor(c)
    /\ durable.namespace[c] \in Namespaces
    /\ durable.targets[c] # {}
    /\ durable.targets[c] \subseteq Targets
    /\ (durable.requestId[c] = "none" \/
         durable.requestId[c] = RequestFor(c))

InvNoOverlappingActiveTarget ==
  \A c1, c2 \in durable.guards:
    c1 # c2 /\ durable.namespace[c1] = durable.namespace[c2]
    => durable.targets[c1] \cap durable.targets[c2] = {}

InvReloadRevokesAttemptAuthorization ==
  \A c \in Callers:
    calls.phase[c] = "reloaded-pending" =>
      /\ c \notin calls.liveAuthorized
      /\ c \notin calls.staged
      /\ c \notin durable.terminal
      /\ c \in durable.guards
      /\ calls.dispatched[c] = calls.dispatchedAtReload[c]

InvReloadedSubmissionRejectedByPersistedGuard ==
  /\ \A c \in calls.rejectedAfterReload:
       /\ workerGeneration = 1
       /\ calls.phase[c] = "rejected-overlap"
       /\ calls.rejectedGuardWitness[c] # {}
       /\ \A other \in calls.rejectedGuardWitness[c]:
            /\ other \in calls.guardsAtReload
            /\ other \in durable.committed
            /\ other # c
            /\ durable.namespace[other] = calls.namespace[c]
            /\ durable.targets[other] \cap calls.targets[c] # {}
       /\ calls.dispatched[c] = {}

InvTerminalPreservesConfirmedProgress ==
  /\ \A c \in calls.staged:
       \A target \in calls.targets[c]:
         durable.status[c][target] = "confirmed" =>
           calls.stagedStatus[c][target] = "confirmed"
  /\ \A c \in durable.terminal:
       \A target \in calls.confirmedProgress[c]:
         durable.status[c][target] = "confirmed"

InvClearPreservesSafetyRows ==
  clearSucceededInState => SafetyRows \subseteq durable.records

InvClearSelectivelyRemovesOrdinaryRows ==
  clearSucceededInState => calls.clearVictims \cap durable.records = {}

InvLegacyAndLostAckStayGuarded ==
  \A c \in Callers:
    calls.phase[c] \in {"legacy-guarded", "ack-lost"}
    =>
      /\ c \in durable.guards
      /\ c \notin calls.liveAuthorized
      /\ calls.dispatched[c] = {}

Spec == Init /\ [][Next]_vars

=============================================================================
