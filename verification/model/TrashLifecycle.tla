------------------------------ MODULE TrashLifecycle ------------------------------

EXTENDS Naturals

CONSTANTS Contexts, Operations, Items, Foreign, Revisions, UnsafeProvider

VARIABLES
  phase,
  operation,
  context,
  selectionRevision,
  confirmed,
  requested,
  confirmedContext,
  confirmedRevision,
  keepers,
  manualTrashAll,
  auditSaved,
  dispatchedTargets,
  dispatchedOperation,
  dispatchedContext,
  dispatchedRevision,
  reported,
  replyOperation,
  moved,
  undoTargets,
  replyKind,
  crashed

vars == <<
  phase,
  operation,
  context,
  selectionRevision,
  confirmed,
  requested,
  confirmedContext,
  confirmedRevision,
  keepers,
  manualTrashAll,
  auditSaved,
  dispatchedTargets,
  dispatchedOperation,
  dispatchedContext,
  dispatchedRevision,
  reported,
  replyOperation,
  moved,
  undoTargets,
  replyKind,
  crashed
>>

Phases == {"review", "confirmed", "audited", "dispatched", "ambiguous", "reconciled", "restarted"}
ReplyKinds == {"none", "success-empty", "success-subset", "success-mixed", "error-partial", "timeout", "duplicate-ignored"}

Init ==
  /\ phase = "review"
  /\ operation = ""
  /\ context = CHOOSE c \in Contexts : TRUE
  /\ selectionRevision = CHOOSE r \in Revisions : r = 0
  /\ confirmed = {}
  /\ requested = {}
  /\ confirmedContext = ""
  /\ confirmedRevision = 0
  /\ keepers = {}
  /\ manualTrashAll = FALSE
  /\ auditSaved = FALSE
  /\ dispatchedTargets = {}
  /\ dispatchedOperation = ""
  /\ dispatchedContext = ""
  /\ dispatchedRevision = 0
  /\ reported = {}
  /\ replyOperation = ""
  /\ moved = {}
  /\ undoTargets = {}
  /\ replyKind = "none"
  /\ crashed = FALSE

Confirm ==
  /\ phase = "review"
  /\ crashed = FALSE
  /\ operation' \in Operations
  /\ requested' \in SUBSET Items
  /\ requested' # {}
  /\ phase' = "confirmed"
  /\ confirmed' = requested'
  /\ confirmedContext' = context
  /\ confirmedRevision' = selectionRevision
  /\ keepers' \in SUBSET Items
  /\ keepers' # {}
  /\ requested' \subseteq (Items \ keepers')
  /\ manualTrashAll' = FALSE
  /\ auditSaved' = FALSE
  /\ dispatchedTargets' = {}
  /\ dispatchedContext' = ""
  /\ dispatchedRevision' = 0
  /\ reported' = {}
  /\ replyOperation' = ""
  /\ moved' = {}
  /\ undoTargets' = {}
  /\ replyKind' = "none"
  /\ crashed' = FALSE
  /\ UNCHANGED <<context, selectionRevision, dispatchedOperation>>

ManualTrashAllConfirm ==
  /\ phase = "review"
  /\ crashed = FALSE
  /\ operation' \in Operations
  /\ requested' = Items
  /\ phase' = "confirmed"
  /\ confirmed' = Items
  /\ confirmedContext' = context
  /\ confirmedRevision' = selectionRevision
  /\ keepers' = {}
  /\ manualTrashAll' = TRUE
  /\ auditSaved' = FALSE
  /\ dispatchedTargets' = {}
  /\ dispatchedContext' = ""
  /\ dispatchedRevision' = 0
  /\ reported' = {}
  /\ replyOperation' = ""
  /\ moved' = {}
  /\ undoTargets' = {}
  /\ replyKind' = "none"
  /\ crashed' = FALSE
  /\ UNCHANGED <<context, selectionRevision, dispatchedOperation>>

PersistAudit ==
  /\ phase = "confirmed"
  /\ crashed = FALSE
  /\ auditSaved' = TRUE
  /\ phase' = "audited"
  /\ UNCHANGED <<operation, context, selectionRevision, confirmed, requested,
      confirmedContext, confirmedRevision, keepers, manualTrashAll, dispatchedTargets, dispatchedOperation,
      dispatchedContext, dispatchedRevision, reported, replyOperation, moved,
      undoTargets, replyKind, crashed>>

PersistAuditFailure ==
  /\ phase = "confirmed"
  /\ crashed = FALSE
  /\ phase' = "review"
  /\ operation' = ""
  /\ confirmed' = {}
  /\ requested' = {}
  /\ confirmedContext' = ""
  /\ confirmedRevision' = 0
  /\ keepers' = {}
  /\ manualTrashAll' = FALSE
  /\ auditSaved' = FALSE
  /\ dispatchedTargets' = {}
  /\ dispatchedContext' = ""
  /\ dispatchedRevision' = 0
  /\ reported' = {}
  /\ replyOperation' = ""
  /\ moved' = {}
  /\ undoTargets' = {}
  /\ replyKind' = "none"
  /\ UNCHANGED <<context, selectionRevision, dispatchedOperation, crashed>>

Dispatch ==
  /\ phase = "audited"
  /\ crashed = FALSE
  /\ auditSaved
  /\ requested # {}
  /\ requested = confirmed
  /\ confirmedContext = context
  /\ confirmedRevision = selectionRevision
  /\ phase' = "dispatched"
  /\ dispatchedTargets' = requested
  /\ dispatchedOperation' = operation
  /\ dispatchedContext' = context
  /\ dispatchedRevision' = selectionRevision
  /\ reported' = {}
  /\ replyOperation' = ""
  /\ moved' = {}
  /\ undoTargets' = {}
  /\ replyKind' = "none"
  /\ UNCHANGED <<operation, context, selectionRevision, confirmed, requested,
      confirmedContext, confirmedRevision, keepers, manualTrashAll, auditSaved, crashed>>

DriftSelection ==
  /\ phase \in {"confirmed", "audited", "dispatched", "ambiguous"}
  /\ crashed = FALSE
  /\ selectionRevision' = IF selectionRevision = 0 THEN 1 ELSE 0
  /\ phase' = "review"
  /\ operation' = ""
  /\ confirmed' = {}
  /\ requested' = {}
  /\ confirmedContext' = ""
  /\ confirmedRevision' = 0
  /\ keepers' = {}
  /\ manualTrashAll' = FALSE
  /\ auditSaved' = FALSE
  /\ dispatchedTargets' = {}
  /\ dispatchedContext' = ""
  /\ dispatchedRevision' = 0
  /\ reported' = {}
  /\ replyOperation' = ""
  /\ moved' = {}
  /\ undoTargets' = {}
  /\ replyKind' = "none"
  /\ UNCHANGED <<context, dispatchedOperation, crashed>>

DriftContext ==
  /\ phase \in {"confirmed", "audited", "dispatched", "ambiguous"}
  /\ crashed = FALSE
  /\ context' \in Contexts
  /\ context' # context
  /\ phase' = "review"
  /\ operation' = ""
  /\ selectionRevision' = IF selectionRevision = 0 THEN 1 ELSE 0
  /\ confirmed' = {}
  /\ requested' = {}
  /\ confirmedContext' = ""
  /\ confirmedRevision' = 0
  /\ keepers' = {}
  /\ manualTrashAll' = FALSE
  /\ auditSaved' = FALSE
  /\ dispatchedTargets' = {}
  /\ dispatchedContext' = ""
  /\ dispatchedRevision' = 0
  /\ reported' = {}
  /\ replyOperation' = ""
  /\ moved' = {}
  /\ undoTargets' = {}
  /\ replyKind' = "none"
  /\ UNCHANGED <<dispatchedOperation, crashed>>

ProviderSuccessEmpty ==
  /\ phase = "dispatched"
  /\ crashed = FALSE
  /\ phase' = "reconciled"
  /\ reported' = {}
  /\ moved' = {}
  /\ undoTargets' = {}
  /\ replyKind' = "success-empty"
  /\ replyOperation' = dispatchedOperation
  /\ UNCHANGED <<operation, context, selectionRevision, confirmed, requested,
      confirmedContext, confirmedRevision, keepers, manualTrashAll, auditSaved, dispatchedTargets, dispatchedOperation,
      dispatchedContext, dispatchedRevision, crashed>>

ProviderSuccessSubset ==
  /\ phase = "dispatched"
  /\ crashed = FALSE
  /\ \E providerConfirmed \in SUBSET requested:
      /\ phase' = "reconciled"
      /\ reported' = providerConfirmed
      /\ moved' = providerConfirmed
      /\ undoTargets' = {}
      /\ replyKind' = "success-subset"
      /\ replyOperation' = dispatchedOperation
  /\ UNCHANGED <<operation, context, selectionRevision, confirmed, requested,
      confirmedContext, confirmedRevision, keepers, manualTrashAll, auditSaved, dispatchedTargets, dispatchedOperation,
      dispatchedContext, dispatchedRevision, crashed>>

ProviderSuccessWithUnknown ==
  /\ phase = "dispatched"
  /\ crashed = FALSE
  /\ \E providerConfirmed \in SUBSET requested:
      /\ phase' = "reconciled"
      /\ reported' = providerConfirmed \cup Foreign
      /\ moved' = IF UnsafeProvider
                    THEN providerConfirmed \cup Foreign
                    ELSE providerConfirmed
      /\ undoTargets' = {}
      /\ replyKind' = "success-mixed"
      /\ replyOperation' = dispatchedOperation
  /\ UNCHANGED <<operation, context, selectionRevision, confirmed, requested,
      confirmedContext, confirmedRevision, keepers, manualTrashAll, auditSaved, dispatchedTargets, dispatchedOperation,
      dispatchedContext, dispatchedRevision, crashed>>

ProviderErrorPartial ==
  /\ phase = "dispatched"
  /\ crashed = FALSE
  /\ \E providerConfirmed \in SUBSET requested:
      /\ phase' = "reconciled"
      /\ reported' = providerConfirmed
      /\ moved' = providerConfirmed
      /\ undoTargets' = {}
      /\ replyKind' = "error-partial"
      /\ replyOperation' = dispatchedOperation
  /\ UNCHANGED <<operation, context, selectionRevision, confirmed, requested,
      confirmedContext, confirmedRevision, keepers, manualTrashAll, auditSaved, dispatchedTargets, dispatchedOperation,
      dispatchedContext, dispatchedRevision, crashed>>

Timeout ==
  /\ phase = "dispatched"
  /\ crashed = FALSE
  /\ phase' = "ambiguous"
  /\ reported' = {}
  /\ moved' = {}
  /\ undoTargets' = {}
  /\ replyKind' = "timeout"
  /\ replyOperation' = dispatchedOperation
  /\ UNCHANGED <<operation, context, selectionRevision, confirmed, requested,
      confirmedContext, confirmedRevision, keepers, manualTrashAll, auditSaved, dispatchedTargets, dispatchedOperation,
      dispatchedContext, dispatchedRevision, crashed>>

LateProviderReply ==
  /\ phase = "ambiguous"
  /\ crashed = FALSE
  /\ \E providerConfirmed \in SUBSET dispatchedTargets:
      /\ phase' = "reconciled"
      /\ reported' = providerConfirmed
      /\ moved' = providerConfirmed
      /\ undoTargets' = {}
      /\ replyKind' = "success-subset"
      /\ replyOperation' = dispatchedOperation
  /\ UNCHANGED <<operation, context, selectionRevision, confirmed, requested,
      confirmedContext, confirmedRevision, keepers, manualTrashAll, auditSaved, dispatchedTargets, dispatchedOperation,
      dispatchedContext, dispatchedRevision, crashed>>

DuplicateReply ==
  /\ phase = "reconciled"
  /\ crashed = FALSE
  /\ phase' = "reconciled"
  /\ reported' = reported \cup Foreign
  /\ moved' = moved
  /\ undoTargets' = undoTargets
  /\ replyKind' = "duplicate-ignored"
  /\ UNCHANGED <<operation, context, selectionRevision, confirmed, requested,
      confirmedContext, confirmedRevision, keepers, manualTrashAll, auditSaved, dispatchedTargets,
      dispatchedOperation, dispatchedContext, dispatchedRevision, replyOperation, crashed>>

StaleProviderReply ==
  /\ phase \in {"review", "confirmed", "audited"}
  /\ crashed = FALSE
  /\ dispatchedOperation \in Operations
  /\ replyOperation' = dispatchedOperation
  /\ reported' = Foreign
  /\ moved' = moved
  /\ undoTargets' = undoTargets
  /\ replyKind' = "duplicate-ignored"
  /\ UNCHANGED <<phase, operation, context, selectionRevision, confirmed,
      requested, confirmedContext, confirmedRevision, keepers, manualTrashAll, auditSaved,
      dispatchedTargets, dispatchedOperation, dispatchedContext,
      dispatchedRevision, crashed>>

Undo ==
  /\ phase = "reconciled"
  /\ crashed = FALSE
  /\ moved # {}
  /\ undoTargets' = moved
  /\ replyKind' = replyKind
  /\ UNCHANGED <<phase, operation, context, selectionRevision, confirmed,
      requested, confirmedContext, confirmedRevision, keepers, manualTrashAll, auditSaved,
      dispatchedTargets, dispatchedOperation, dispatchedContext, dispatchedRevision,
      reported, replyOperation, moved, crashed>>

Crash ==
  /\ phase \in {"confirmed", "audited", "dispatched", "ambiguous"}
  /\ crashed = FALSE
  /\ phase' = "restarted"
  /\ crashed' = TRUE
  /\ UNCHANGED <<operation, context, selectionRevision, confirmed, requested,
      confirmedContext, confirmedRevision, keepers, manualTrashAll, auditSaved, dispatchedTargets,
      dispatchedOperation, dispatchedContext, dispatchedRevision, reported,
      replyOperation, moved, undoTargets, replyKind>>

Recover ==
  /\ phase = "restarted"
  /\ crashed = TRUE
  /\ phase' = "review"
  /\ crashed' = FALSE
  /\ operation' = ""
  /\ confirmed' = {}
  /\ requested' = {}
  /\ confirmedContext' = ""
  /\ confirmedRevision' = 0
  /\ keepers' = {}
  /\ manualTrashAll' = FALSE
  /\ auditSaved' = FALSE
  /\ dispatchedTargets' = {}
  /\ dispatchedContext' = ""
  /\ dispatchedRevision' = 0
  /\ reported' = {}
  /\ moved' = {}
  /\ undoTargets' = {}
  /\ replyKind' = "none"
  /\ replyOperation' = ""
  /\ UNCHANGED <<context, selectionRevision, dispatchedOperation>>

Next ==
  \/ Confirm
  \/ ManualTrashAllConfirm
  \/ PersistAudit
  \/ PersistAuditFailure
  \/ Dispatch
  \/ DriftSelection
  \/ DriftContext
  \/ StaleProviderReply
  \/ ProviderSuccessEmpty
  \/ ProviderSuccessSubset
  \/ ProviderSuccessWithUnknown
  \/ ProviderErrorPartial
  \/ Timeout
  \/ LateProviderReply
  \/ DuplicateReply
  \/ Undo
  \/ Crash
  \/ Recover

TypeOK ==
  /\ phase \in Phases
  /\ operation = "" \/ operation \in Operations
  /\ context \in Contexts
  /\ selectionRevision \in Revisions
  /\ confirmed \subseteq Items
  /\ requested \subseteq Items
  /\ confirmedContext = "" \/ confirmedContext \in Contexts
  /\ confirmedRevision \in Revisions
  /\ keepers \subseteq Items
  /\ manualTrashAll \in BOOLEAN
  /\ auditSaved \in BOOLEAN
  /\ dispatchedTargets \subseteq Items
  /\ dispatchedOperation = "" \/ dispatchedOperation \in Operations
  /\ dispatchedContext = "" \/ dispatchedContext \in Contexts
  /\ dispatchedRevision \in Revisions
  /\ reported \subseteq (Items \cup Foreign)
  /\ replyOperation = "" \/ replyOperation \in Operations
  /\ moved \subseteq Items
  /\ undoTargets \subseteq Items
  /\ replyKind \in ReplyKinds
  /\ crashed \in BOOLEAN

InvDispatchedSubset == moved \subseteq dispatchedTargets
InvUndoSubset == undoTargets \subseteq moved
InvNoTrashBeforeDispatch == moved # {} => dispatchedTargets # {}
InvDispatchBound == phase = "dispatched" =>
  /\ auditSaved
  /\ dispatchedTargets = requested
  /\ dispatchedContext = context
  /\ dispatchedRevision = selectionRevision
InvKeeperSafety == phase \in {"confirmed", "audited", "dispatched", "ambiguous", "reconciled"} =>
  manualTrashAll \/ (keepers # {} /\ requested \cap keepers = {})
InvEmptySuccessSafe == replyKind = "success-empty" => moved = {}
InvReportedDoesNotAuthorize == moved \subseteq (reported \cap dispatchedTargets)
InvReplyOperationBound == moved # {} =>
  /\ replyOperation = dispatchedOperation
  /\ dispatchedOperation \in Operations

=============================================================================
