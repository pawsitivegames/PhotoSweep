------------------------------ MODULE KeeperSelection ------------------------------

EXTENDS Naturals, FiniteSets

CONSTANTS
  \* @type: Set(Str);
  Groups,
  \* @type: Set(Str);
  EligibleGroups,
  \* @type: Set(Str);
  Members,
  \* @type: Set(Str);
  Strategies,
  \* @type: Str;
  BestQuality,
  \* @type: Str;
  LargestResolution,
  \* @type: Str;
  NewestTaken,
  \* @type: Str;
  OldestTaken,
  \* @type: Str;
  NewestUpload,
  \* @type: Str;
  NonStorageCounting,
  \* @type: Str;
  Group1,
  \* @type: Str;
  Group2,
  \* @type: Str;
  Group3,
  \* @type: Str;
  AssetA,
  \* @type: Str;
  AssetB,
  \* @type: Str;
  AssetC,
  \* @type: Str;
  AssetD,
  \* @type: Str;
  AssetE,
  \* @type: Str;
  AssetF,
  \* @type: Bool;
  UnsafeAutoTrash

NoMember == "no-member"
SourceKinds == {"automatic", "manual", "manual-trash-all"}

VARIABLES
  \* @type: Str;
  selectedStrategy,
  \* @type: Str -> Set(Str);
  keepers,
  \* @type: Str -> Str;
  decisionSource,
  \* @type: Str -> Set(Str);
  manualKeepers,
  \* @type: Set(Str);
  includedGroups,
  \* @type: Set(Str);
  reviewedGroups,
  \* @type: Str -> Set(Str);
  trashTargets,
  \* @type: Int;
  dispatchCount,
  \* @type: Int;
  confirmedDispatchCount,
  \* @type: Set(Str);
  reviewedGroupsAtDispatch,
  \* @type: Bool;
  bulkDispatchOccurred

GroupMembers ==
  [group \in Groups |->
    IF group = Group1 THEN {AssetA, AssetB, AssetC}
    ELSE IF group = Group2 THEN {AssetD, AssetE}
    ELSE {AssetF}]

StableKeyOrder(member) ==
  IF member = AssetA THEN 1
  ELSE IF member = AssetB THEN 2
  ELSE IF member = AssetC THEN 3
  ELSE IF member = AssetD THEN 4
  ELSE IF member = AssetE THEN 5
  ELSE 6

(* Scores abstract each strategy's evidence and fallback chain. Equal scores
   are resolved with a stable media-key order. *)
StrategyScore(strategy, member) ==
  IF strategy = BestQuality
  THEN IF member = AssetA THEN 3
       ELSE IF member = AssetB THEN 2
       ELSE IF member = AssetD THEN 2
       ELSE 1
  ELSE IF strategy = LargestResolution
  THEN IF member = AssetB THEN 3
       ELSE IF member = AssetA THEN 2
       ELSE IF member = AssetE THEN 2
       ELSE 1
  ELSE IF strategy = NewestTaken
  THEN IF member = AssetC THEN 3
       ELSE IF member = AssetB THEN 2
       ELSE IF member = AssetD THEN 2
       ELSE 1
  ELSE IF strategy = OldestTaken
  THEN IF member = AssetA THEN 3
       ELSE IF member = AssetC THEN 2
       ELSE IF member = AssetE THEN 2
       ELSE 1
  ELSE IF strategy = NewestUpload
  THEN IF member = AssetA \/ member = AssetB \/ member = AssetD \/ member = AssetE
       THEN 2
       ELSE 1
  ELSE IF member = AssetC \/ member = AssetD THEN 3
       ELSE IF member = AssetB \/ member = AssetE THEN 2
       ELSE 1

Preferred(strategy, left, right) ==
  left # right /\
  (StrategyScore(strategy, left) > StrategyScore(strategy, right) \/
    (StrategyScore(strategy, left) = StrategyScore(strategy, right) /\
      StableKeyOrder(left) < StableKeyOrder(right)))

BestMember(strategy, group) ==
  CHOOSE member \in GroupMembers[group]:
    \A other \in GroupMembers[group]:
      other = member \/ Preferred(strategy, member, other)

StrategyKeepers(strategy) ==
  [group \in Groups |-> {BestMember(strategy, group)}]

ExpectedTrashTargets(included, currentKeepers) ==
  [group \in Groups |->
    IF group \in included
    THEN GroupMembers[group] \ currentKeepers[group]
    ELSE {}]

BulkChangedPlanGroups(strategy) ==
  {group \in EligibleGroups :
    group \notin includedGroups \/
      (GroupMembers[group] \ keepers[group] #
        (GroupMembers[group] \ StrategyKeepers(strategy)[group]))}

HasProposedTrash ==
  \E group \in EligibleGroups: trashTargets[group] # {}

vars == <<selectedStrategy, keepers, decisionSource, manualKeepers,
         includedGroups, reviewedGroups, trashTargets, dispatchCount,
         confirmedDispatchCount, reviewedGroupsAtDispatch,
         bulkDispatchOccurred>>

Init ==
  /\ selectedStrategy = BestQuality
  /\ keepers = [group \in Groups |-> {BestMember(BestQuality, group)}]
  /\ decisionSource = [group \in Groups |-> "automatic"]
  /\ manualKeepers = [group \in Groups |-> {}]
  /\ includedGroups = {Group1}
  /\ reviewedGroups = {Group1}
  /\ trashTargets = ExpectedTrashTargets(
       {Group1},
       [group \in Groups |-> {BestMember(BestQuality, group)}]
     )
  /\ dispatchCount = 0
  /\ confirmedDispatchCount = 0
  /\ reviewedGroupsAtDispatch = {}
  /\ bulkDispatchOccurred = FALSE

BulkApplyStrategy(strategy) ==
  /\ strategy \in Strategies
  /\ dispatchCount = 0
  /\ selectedStrategy' = strategy
  /\ keepers' = StrategyKeepers(strategy)
  /\ includedGroups' = EligibleGroups
  /\ reviewedGroups' = reviewedGroups \ BulkChangedPlanGroups(strategy)
  /\ trashTargets' = ExpectedTrashTargets(
       EligibleGroups,
       StrategyKeepers(strategy)
     )
  /\ decisionSource' = [group \in Groups |-> "automatic"]
  /\ manualKeepers' = [group \in Groups |-> {}]
  /\ dispatchCount' =
       IF UnsafeAutoTrash THEN dispatchCount + 1 ELSE dispatchCount
  /\ confirmedDispatchCount' = confirmedDispatchCount
  /\ bulkDispatchOccurred' = UnsafeAutoTrash
  /\ UNCHANGED <<reviewedGroupsAtDispatch>>

ManualChoose(group, keptSet) ==
  /\ group \in EligibleGroups
  /\ keptSet \subseteq GroupMembers[group]
  /\ keptSet # {}
  /\ dispatchCount = 0
  /\ keepers' = [keepers EXCEPT ![group] = keptSet]
  /\ decisionSource' = [decisionSource EXCEPT ![group] = "manual"]
  /\ manualKeepers' = [manualKeepers EXCEPT ![group] = keptSet]
  /\ includedGroups' = includedGroups \cup {group}
  /\ reviewedGroups' = reviewedGroups \cup {group}
  /\ trashTargets' = ExpectedTrashTargets(
       includedGroups \cup {group},
       [keepers EXCEPT ![group] = keptSet]
     )
  /\ bulkDispatchOccurred' = FALSE
  /\ UNCHANGED <<selectedStrategy, dispatchCount,
                 confirmedDispatchCount, reviewedGroupsAtDispatch>>

ManualTrashAll(group) ==
  /\ group \in EligibleGroups
  /\ dispatchCount = 0
  /\ keepers' = [keepers EXCEPT ![group] = {}]
  /\ decisionSource' = [decisionSource EXCEPT ![group] = "manual-trash-all"]
  /\ manualKeepers' = [manualKeepers EXCEPT ![group] = {}]
  /\ includedGroups' = includedGroups \cup {group}
  /\ reviewedGroups' = reviewedGroups \cup {group}
  /\ trashTargets' = ExpectedTrashTargets(
       includedGroups \cup {group},
       [keepers EXCEPT ![group] = {}]
     )
  /\ bulkDispatchOccurred' = FALSE
  /\ UNCHANGED <<selectedStrategy, dispatchCount,
                 confirmedDispatchCount, reviewedGroupsAtDispatch>>

SkipGroup(group) ==
  /\ group \in EligibleGroups
  /\ dispatchCount = 0
  /\ includedGroups' = includedGroups \ {group}
  /\ reviewedGroups' = reviewedGroups \cup {group}
  /\ trashTargets' = ExpectedTrashTargets(
       includedGroups \ {group}, keepers
     )
  /\ bulkDispatchOccurred' = FALSE
  /\ UNCHANGED <<selectedStrategy, keepers, decisionSource, manualKeepers,
                 dispatchCount, confirmedDispatchCount,
                 reviewedGroupsAtDispatch>>

SelectGroup(group) ==
  /\ group \in EligibleGroups
  /\ group \notin includedGroups
  /\ dispatchCount = 0
  /\ includedGroups' = includedGroups \cup {group}
  /\ reviewedGroups' = reviewedGroups \cup {group}
  /\ trashTargets' = ExpectedTrashTargets(
       includedGroups \cup {group}, keepers
     )
  /\ bulkDispatchOccurred' = FALSE
  /\ UNCHANGED <<selectedStrategy, keepers, decisionSource, manualKeepers,
                 dispatchCount, confirmedDispatchCount,
                 reviewedGroupsAtDispatch>>

ReviewGroup(group) ==
  /\ group \in EligibleGroups
  /\ group \in includedGroups
  /\ dispatchCount = 0
  /\ reviewedGroups' = reviewedGroups \cup {group}
  /\ bulkDispatchOccurred' = FALSE
  /\ UNCHANGED <<selectedStrategy, keepers, decisionSource, manualKeepers,
                 includedGroups, trashTargets, dispatchCount,
                 confirmedDispatchCount, reviewedGroupsAtDispatch>>

ConfirmTrash ==
  /\ HasProposedTrash
  /\ EligibleGroups \subseteq reviewedGroups
  /\ dispatchCount = 0
  /\ dispatchCount' = dispatchCount + 1
  /\ confirmedDispatchCount' = confirmedDispatchCount + 1
  /\ reviewedGroupsAtDispatch' = reviewedGroups
  /\ bulkDispatchOccurred' = FALSE
  /\ UNCHANGED <<selectedStrategy, keepers, decisionSource, manualKeepers,
                 includedGroups, reviewedGroups, trashTargets>>

Next ==
  \/ \E strategy \in Strategies: BulkApplyStrategy(strategy)
  \/ \E group \in EligibleGroups:
       \E keptSet \in SUBSET GroupMembers[group]: ManualChoose(group, keptSet)
  \/ \E group \in EligibleGroups: ManualTrashAll(group)
  \/ \E group \in EligibleGroups: SkipGroup(group)
  \/ \E group \in EligibleGroups: SelectGroup(group)
  \/ \E group \in EligibleGroups: ReviewGroup(group)
  \/ ConfirmTrash

TypeOK ==
  /\ selectedStrategy \in Strategies
  /\ keepers \in [Groups -> SUBSET Members]
  /\ decisionSource \in [Groups -> SourceKinds]
  /\ manualKeepers \in [Groups -> SUBSET Members]
  /\ includedGroups \subseteq EligibleGroups
  /\ EligibleGroups \subseteq Groups
  /\ reviewedGroups \subseteq EligibleGroups
  /\ trashTargets \in [Groups -> SUBSET Members]
  /\ dispatchCount \in 0..1
  /\ confirmedDispatchCount \in 0..1
  /\ reviewedGroupsAtDispatch \subseteq EligibleGroups
  /\ bulkDispatchOccurred \in {TRUE, FALSE}

InvExactlyOneKeeper ==
  \A group \in Groups:
    IF decisionSource[group] = "automatic"
    THEN Cardinality(keepers[group]) = 1
    ELSE IF decisionSource[group] = "manual"
      THEN keepers[group] # {}
      ELSE keepers[group] = {}

InvKeeperBelongsToGroup ==
  \A group \in Groups: keepers[group] \subseteq GroupMembers[group]

InvGroupsHaveDisjointMembers ==
  \A left \in Groups:
    \A right \in Groups:
      left # right => GroupMembers[left] \cap GroupMembers[right] = {}

InvTotalRanking ==
  \A strategy \in Strategies:
    \A group \in Groups:
      \A left \in GroupMembers[group]:
        \A right \in GroupMembers[group]:
          left = right \/ Preferred(strategy, left, right) \/
            Preferred(strategy, right, left)

InvStrictRanking ==
  \A strategy \in Strategies:
    \A group \in Groups:
      \A left \in GroupMembers[group]:
        \A right \in GroupMembers[group]:
          ~(Preferred(strategy, left, right) /\
            Preferred(strategy, right, left))

InvAutomaticKeeperIsBest ==
  \A group \in Groups:
    decisionSource[group] = "automatic" =>
      keepers[group] = {BestMember(selectedStrategy, group)}

InvDecisionProvenanceConsistent ==
  \A group \in Groups:
    IF decisionSource[group] = "manual"
    THEN /\ manualKeepers[group] # {}
         /\ keepers[group] = manualKeepers[group]
    ELSE IF decisionSource[group] = "manual-trash-all"
      THEN /\ manualKeepers[group] = {}
           /\ keepers[group] = {}
      ELSE /\ manualKeepers[group] = {}
           /\ keepers[group] = {BestMember(selectedStrategy, group)}

InvNoLockedGroupProposal ==
  /\ includedGroups \subseteq EligibleGroups
  /\ \A group \in Groups \ EligibleGroups:
       trashTargets[group] = {}

InvLockedGroupImmutable ==
  /\ decisionSource[Group3] = "automatic"
  /\ manualKeepers[Group3] = {}
  /\ keepers[Group3] = {BestMember(selectedStrategy, Group3)}

InvProposedTrashTargetsAreExact ==
  trashTargets = ExpectedTrashTargets(includedGroups, keepers)

InvEveryIncludedNonKeeperIsProposed ==
  \A group \in EligibleGroups:
    group \in includedGroups =>
      trashTargets[group] = GroupMembers[group] \ keepers[group]

InvNoKeeperIsProposedForTrash ==
  \A group \in Groups:
    keepers[group] \cap trashTargets[group] = {}

InvManualTrashAllTargetsAllMedia ==
  \A group \in Groups:
    decisionSource[group] = "manual-trash-all" =>
      trashTargets[group] =
        IF group \in includedGroups THEN GroupMembers[group] ELSE {}

InvBulkStrategyDoesNotDispatchTrash == ~bulkDispatchOccurred

InvDispatchMatchesConfirmation ==
  /\ dispatchCount = confirmedDispatchCount
  /\ (dispatchCount > 0 => EligibleGroups \subseteq reviewedGroupsAtDispatch)

InvSelectionSafety ==
  /\ TypeOK
  /\ InvExactlyOneKeeper
  /\ InvKeeperBelongsToGroup
  /\ InvGroupsHaveDisjointMembers
  /\ InvTotalRanking
  /\ InvStrictRanking
  /\ InvAutomaticKeeperIsBest
  /\ InvDecisionProvenanceConsistent
  /\ InvNoLockedGroupProposal
  /\ InvLockedGroupImmutable
  /\ InvProposedTrashTargetsAreExact
  /\ InvEveryIncludedNonKeeperIsProposed
  /\ InvNoKeeperIsProposedForTrash
  /\ InvManualTrashAllTargetsAllMedia
  /\ InvBulkStrategyDoesNotDispatchTrash
  /\ InvDispatchMatchesConfirmation

BulkStrategyTransition ==
  \E strategy \in Strategies: BulkApplyStrategy(strategy)

PropBulkIncludesEligibleGroups ==
  [][BulkStrategyTransition => includedGroups' = EligibleGroups]_vars

PropBulkDoesNotReviewGroups ==
  [][BulkStrategyTransition => reviewedGroups' \subseteq reviewedGroups]_vars

PropBulkReopensChangedPlans ==
  [][\A strategy \in Strategies:
        BulkApplyStrategy(strategy) =>
          \A group \in EligibleGroups:
            IF group \notin includedGroups \/
                trashTargets[group] #
                  ExpectedTrashTargets(
                    EligibleGroups,
                    StrategyKeepers(strategy)
                  )[group]
            THEN group \notin reviewedGroups'
            ELSE (group \in reviewedGroups => group \in reviewedGroups')]_vars

PropBulkOverridesManualChoices ==
  [][\A strategy \in Strategies:
        BulkApplyStrategy(strategy) =>
          /\ decisionSource' = [group \in Groups |-> "automatic"]
          /\ manualKeepers' = [group \in Groups |-> {}]
          /\ keepers' = StrategyKeepers(strategy)]_vars

PropBulkDoesNotDispatchTrash ==
  [][BulkStrategyTransition => dispatchCount' = dispatchCount]_vars

PropSelectGroupIsExplicitPerSetReview ==
  [][\A group \in EligibleGroups:
        SelectGroup(group) =>
          /\ group \in includedGroups'
          /\ group \in reviewedGroups']_vars

ClosureInit == InvSelectionSafety

Spec == Init /\ [][Next]_vars

=============================================================================
