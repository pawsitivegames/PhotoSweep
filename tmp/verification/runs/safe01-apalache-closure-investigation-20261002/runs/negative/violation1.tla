---------------------------- MODULE counterexample ----------------------------

EXTENDS KeeperSelection

(* Constant initialization state *)
ConstInit ==
  AssetA = "asset-a"
    /\ AssetB = "asset-b"
    /\ AssetC = "asset-c"
    /\ AssetD = "asset-d"
    /\ AssetE = "asset-e"
    /\ AssetF = "asset-f"
    /\ BestQuality = "best_quality"
    /\ EligibleGroups = { "group-1", "group-2" }
    /\ Group1 = "group-1"
    /\ Group2 = "group-2"
    /\ Group3 = "group-3"
    /\ Groups = { "group-1", "group-2", "group-3" }
    /\ LargestResolution = "largest_resolution"
    /\ Members
      = { "asset-a", "asset-b", "asset-c", "asset-d", "asset-e", "asset-f" }
    /\ NewestTaken = "newest_taken"
    /\ NewestUpload = "newest_upload"
    /\ NonStorageCounting = "non_storage_counting"
    /\ OldestTaken = "oldest_taken"
    /\ Strategies
      = { "best_quality",
        "largest_resolution",
        "newest_taken",
        "newest_upload",
        "non_storage_counting",
        "oldest_taken" }
    /\ UnsafeAutoTrash = TRUE

(* Initial state [_transition(0)] *)
State0 ==
  AssetA = "asset-a"
    /\ AssetB = "asset-b"
    /\ AssetC = "asset-c"
    /\ AssetD = "asset-d"
    /\ AssetE = "asset-e"
    /\ AssetF = "asset-f"
    /\ BestQuality = "best_quality"
    /\ EligibleGroups = { "group-1", "group-2" }
    /\ Group1 = "group-1"
    /\ Group2 = "group-2"
    /\ Group3 = "group-3"
    /\ Groups = { "group-1", "group-2", "group-3" }
    /\ LargestResolution = "largest_resolution"
    /\ Members
      = { "asset-a", "asset-b", "asset-c", "asset-d", "asset-e", "asset-f" }
    /\ NewestTaken = "newest_taken"
    /\ NewestUpload = "newest_upload"
    /\ NonStorageCounting = "non_storage_counting"
    /\ OldestTaken = "oldest_taken"
    /\ Strategies
      = { "best_quality",
        "largest_resolution",
        "newest_taken",
        "newest_upload",
        "non_storage_counting",
        "oldest_taken" }
    /\ UnsafeAutoTrash = TRUE
    /\ bulkDispatchOccurred = FALSE
    /\ confirmedDispatchCount = 0
    /\ decisionSource
      = SetAsFun({ <<"group-1", "manual-trash-all">>,
        <<"group-2", "manual-trash-all">>,
        <<"group-3", "automatic">> })
    /\ dispatchCount = 0
    /\ includedGroups = {}
    /\ keepers
      = SetAsFun({ <<"group-1", {}>>,
        <<"group-2", {}>>,
        <<"group-3", {"asset-f"}>> })
    /\ manualKeepers
      = SetAsFun({ <<"group-1", {}>>, <<"group-2", {}>>, <<"group-3", {}>> })
    /\ reviewedGroups = {}
    /\ reviewedGroupsAtDispatch = {}
    /\ selectedStrategy = "newest_taken"
    /\ trashTargets
      = SetAsFun({ <<"group-1", {}>>, <<"group-2", {}>>, <<"group-3", {}>> })

(* State1 [_transition(0)] *)
State1 ==
  AssetA = "asset-a"
    /\ AssetB = "asset-b"
    /\ AssetC = "asset-c"
    /\ AssetD = "asset-d"
    /\ AssetE = "asset-e"
    /\ AssetF = "asset-f"
    /\ BestQuality = "best_quality"
    /\ EligibleGroups = { "group-1", "group-2" }
    /\ Group1 = "group-1"
    /\ Group2 = "group-2"
    /\ Group3 = "group-3"
    /\ Groups = { "group-1", "group-2", "group-3" }
    /\ LargestResolution = "largest_resolution"
    /\ Members
      = { "asset-a", "asset-b", "asset-c", "asset-d", "asset-e", "asset-f" }
    /\ NewestTaken = "newest_taken"
    /\ NewestUpload = "newest_upload"
    /\ NonStorageCounting = "non_storage_counting"
    /\ OldestTaken = "oldest_taken"
    /\ Strategies
      = { "best_quality",
        "largest_resolution",
        "newest_taken",
        "newest_upload",
        "non_storage_counting",
        "oldest_taken" }
    /\ UnsafeAutoTrash = TRUE
    /\ bulkDispatchOccurred = TRUE
    /\ confirmedDispatchCount = 0
    /\ decisionSource
      = SetAsFun({ <<"group-1", "automatic">>,
        <<"group-2", "automatic">>,
        <<"group-3", "automatic">> })
    /\ dispatchCount = 1
    /\ includedGroups = { "group-1", "group-2" }
    /\ keepers
      = SetAsFun({ <<"group-1", {"asset-c"}>>,
        <<"group-2", {"asset-d"}>>,
        <<"group-3", {"asset-f"}>> })
    /\ manualKeepers
      = SetAsFun({ <<"group-1", {}>>, <<"group-2", {}>>, <<"group-3", {}>> })
    /\ reviewedGroups = {}
    /\ reviewedGroupsAtDispatch = {}
    /\ selectedStrategy = "non_storage_counting"
    /\ trashTargets
      = SetAsFun({ <<"group-1", { "asset-a", "asset-b" }>>,
        <<"group-2", {"asset-e"}>>,
        <<"group-3", {}>> })

(* The following formula holds true in the last state and violates the invariant *)
InvariantViolation == bulkDispatchOccurred

================================================================================
(* Created by Apalache on Fri Oct 02 14:26:49 PDT 2026 *)
(* https://github.com/apalache-mc/apalache *)
