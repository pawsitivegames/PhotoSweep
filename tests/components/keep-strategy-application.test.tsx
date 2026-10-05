import { ThemeProvider } from "@mui/material/styles"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { ActionBar } from "../../components/ActionBar"
import { DuplicateGroups } from "../../components/DuplicateGroups"
import { KeepStrategyFeedbackSnackbar } from "../../components/KeepStrategyFeedbackSnackbar"
import {
  DuplicateReviewSession,
  type DuplicateReviewAction,
  type DuplicateReviewSelections
} from "../../lib/duplicate-review-session"
import {
  KEEP_STRATEGY_LABELS,
  type KeepStrategy
} from "../../lib/keep-strategy"
import { handleKeepStrategySelection } from "../../lib/keep-strategy-feedback"
import theme from "../../lib/theme"
import type { DuplicateGroup, GpdMediaItem } from "../../lib/types"

vi.mock("../../components/useBlobUrl", () => ({
  useBlobUrl: (url: string | undefined) => ({
    blobUrl: url ? `blob:${url}` : undefined,
    loading: false
  })
}))

vi.mock("../../components/PhotoViewerModal", () => ({
  PhotoViewerModal: () => null
}))

const GROUPS: DuplicateGroup[] = [
  {
    id: "g1",
    mediaKeys: ["key1", "key2", "key3"],
    originalMediaKey: "key1",
    similarity: 0.99
  }
]

const MEDIA_ITEMS: Record<string, GpdMediaItem> = {
  key1: makeItem("key1", {
    fileName: "photo1.jpg",
    isOriginalQuality: true,
    resWidth: 100,
    resHeight: 100,
    timestamp: Date.parse("2020-01-01T00:00:00.000Z"),
    timestampProvenance: "capture",
    creationTimestamp: Date.parse("2022-01-01T00:00:00.000Z"),
    creationTimestampProvenance: "creation",
    takesUpSpace: true
  }),
  key2: makeItem("key2", {
    fileName: "photo2.jpg",
    isOriginalQuality: false,
    resWidth: 400,
    resHeight: 400,
    timestamp: Date.parse("2024-01-01T00:00:00.000Z"),
    timestampProvenance: "capture",
    creationTimestamp: Date.parse("2021-01-01T00:00:00.000Z"),
    creationTimestampProvenance: "creation",
    takesUpSpace: false
  }),
  key3: makeItem("key3", {
    fileName: "photo3.jpg",
    isOriginalQuality: false,
    resWidth: 300,
    resHeight: 300,
    timestamp: Date.parse("2022-01-01T00:00:00.000Z"),
    timestampProvenance: "capture",
    creationTimestamp: Date.parse("2024-01-01T00:00:00.000Z"),
    creationTimestampProvenance: "creation",
    takesUpSpace: true
  })
}

function makeItem(
  mediaKey: string,
  overrides: Partial<GpdMediaItem> = {}
): GpdMediaItem {
  return {
    mediaKey,
    dedupKey: `dedup-${mediaKey}`,
    thumb: `https://example.com/${mediaKey}.jpg`,
    timestamp: 1,
    creationTimestamp: 1,
    isOriginalQuality: false,
    resWidth: 100,
    resHeight: 100,
    ...overrides
  }
}

function ReviewHarness({
  mediaItems = MEDIA_ITEMS,
  initialSelections = {
    selectedGroupIds: new Set<string>(),
    reviewedGroupIds: new Set<string>(),
    keptOverrides: {}
  }
}: {
  mediaItems?: Record<string, GpdMediaItem>
  initialSelections?: DuplicateReviewSelections
}) {
  const [selections, setSelections] = useState(initialSelections)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [defaultStrategy, setDefaultStrategy] = useState<KeepStrategy>("best_quality")
  const session = new DuplicateReviewSession({
    groups: GROUPS,
    mediaItems,
    selections,
    defaultStrategy
  })

  const updateReviewSelections = (
    action: DuplicateReviewAction,
    nextSelectionsOverride?: DuplicateReviewSelections
  ) => {
    const next =
      nextSelectionsOverride ??
      new DuplicateReviewSession({
        groups: GROUPS,
        mediaItems,
        selections
      }).update(action)
    setSelections(next)
    return next
  }

  const applyStrategy = (strategy: KeepStrategy) =>
    handleKeepStrategySelection({
      groups: GROUPS,
      mediaItems,
      selections,
      strategy,
      persistDefaultStrategy: setDefaultStrategy,
      updateReviewSelections,
      setFeedback
    })

  return (
    <ThemeProvider theme={theme}>
      <ActionBar
        totalItems={3}
        groupCount={1}
        totalGroupCount={1}
        reviewedGroupCount={session.reviewedGroupIds.size}
        exactGroupCount={1}
        similarGroupCount={0}
        reviewFilter="all"
        onReviewFilterChange={() => undefined}
        onSelectAll={() =>
          updateReviewSelections({
            type: "select_groups",
            groupIds: GROUPS.map((group) => group.id)
          })
        }
        onDeselectAll={() =>
          updateReviewSelections({
            type: "deselect_groups",
            groupIds: GROUPS.map((group) => group.id)
          })
        }
        onRescan={() => undefined}
        onExportJson={() => undefined}
        onExportCsv={() => undefined}
        onApplyKeepStrategy={applyStrategy}
        compact
      />
      <span data-testid="default-keep-strategy">{defaultStrategy}</span>
      <DuplicateGroups
        groups={GROUPS}
        mediaItems={MEDIA_ITEMS}
        trashPlanMediaKeys={new Set(session.trashPlan().mediaKeysToTrash)}
        selectedGroupIds={session.selectedGroupIds}
        reviewedGroupIds={session.reviewedGroupIds}
        onToggleGroup={(groupId) =>
          updateReviewSelections({
            type: "select_groups",
            groupIds: [groupId]
          })
        }
        onSkipGroup={(groupId) =>
          updateReviewSelections({
            type: "deselect_groups",
            groupIds: [groupId]
          })
        }
        keptByGroupId={session.keptByGroupId}
        keepDecisionByGroupId={session.keepDecisionByGroupId}
        onToggleKept={(group, mediaKey) =>
          updateReviewSelections({
            type: "toggle_kept",
            groupId: group.id,
            mediaKey
          })
        }
        onTrashAll={(group) =>
          updateReviewSelections({
            type: "trash_all_copies",
            groupId: group.id
          })
        }
        compact
      />
      <KeepStrategyFeedbackSnackbar
        message={feedback}
        onClose={() => setFeedback(null)}
      />
    </ThemeProvider>
  )
}

function chooseStrategy(label: string) {
  fireEvent.click(screen.getByRole("button", { name: /Selection/i }))
  fireEvent.click(screen.getByRole("menuitem", { name: label }))
}

const KEEP_STRATEGY_MENU_CASES: Array<{
  strategy: KeepStrategy
  keptMediaKey: string
  changed: boolean
}> = [
  { strategy: "best_quality", keptMediaKey: "key1", changed: false },
  {
    strategy: "largest_resolution",
    keptMediaKey: "key2",
    changed: true
  },
  { strategy: "newest_taken", keptMediaKey: "key2", changed: true },
  { strategy: "oldest_taken", keptMediaKey: "key1", changed: false },
  { strategy: "newest_upload", keptMediaKey: "key3", changed: true },
  {
    strategy: "non_storage_counting",
    keptMediaKey: "key2",
    changed: true
  }
]

describe("Selection strategy application in the review UI", () => {
  it("restarts feedback lifetime when a new strategy result replaces it", () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const view = render(
      <KeepStrategyFeedbackSnackbar
        message="Largest resolution: 1 set changed"
        onClose={onClose}
      />
    )

    try {
      act(() => vi.advanceTimersByTime(8_000))
      view.rerender(
        <KeepStrategyFeedbackSnackbar
          message="Newest taken date: 1 set changed"
          onClose={onClose}
        />
      )

      // The replacement should remain visible past the first message's
      // deadline, then close after its own full auto-hide duration.
      act(() => vi.advanceTimersByTime(1_001))
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByRole("status")).toHaveTextContent(
        "Newest taken date: 1 set changed"
      )

      act(() => vi.advanceTimersByTime(7_998))
      expect(onClose).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(1))
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it.each(KEEP_STRATEGY_MENU_CASES)(
    "persists $strategy and announces its state and scope",
    async (outcome) => {
      const view = render(<ReviewHarness />)
      try {
        const checkbox = screen.getByRole("checkbox", {
          name: "Include duplicate set of 3 photos"
        })
        expect(checkbox).toHaveAttribute("aria-checked", "false")

        const label = KEEP_STRATEGY_LABELS[outcome.strategy]
        chooseStrategy(label)

        await screen.findByRole("status")
        const status = screen.getByRole("status")
        expect(status).toHaveTextContent(
          outcome.changed
            ? "1 set changed"
            : "1 set already had the selected keeper"
        )
        expect(status).toHaveTextContent(
          "was applied and saved as the default"
        )
        expect(status).toHaveTextContent(
          "1 set included for cleanup review; 2 media items proposed for Trash."
        )
        expect(screen.getByTestId("default-keep-strategy")).toHaveTextContent(
          outcome.strategy
        )
        for (const key of ["key1", "key2", "key3"]) {
          expect(
            screen.getByRole("button", {
              name: new RegExp(`^Keep photo${key.slice(-1)}\\.jpg`)
            })
          ).toHaveAttribute(
            "aria-pressed",
            key === outcome.keptMediaKey ? "true" : "false"
          )
        }
        expect(checkbox).toHaveAttribute("aria-checked", "true")
      } finally {
        view.unmount()
      }
    }
  )

  it("includes or skips all sets without changing the saved strategy", () => {
    const view = render(<ReviewHarness />)
    try {
      const checkbox = screen.getByRole("checkbox", {
        name: "Include duplicate set of 3 photos"
      })
      fireEvent.click(screen.getByRole("button", { name: /Selection/i }))
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Include all sets" })
      )
      expect(checkbox).toHaveAttribute("aria-checked", "true")
      fireEvent.click(screen.getByRole("button", { name: /Selection/i }))
      fireEvent.click(screen.getByRole("menuitem", { name: "Skip all sets" }))
      expect(checkbox).toHaveAttribute("aria-checked", "false")
      expect(screen.getByTestId("default-keep-strategy")).toHaveTextContent(
        "best_quality"
      )
    } finally {
      view.unmount()
    }
  })

  it("applies a saved strategy to all groups regardless of the current filter", () => {
    const allGroups: DuplicateGroup[] = [
      ...GROUPS,
      {
        id: "hidden-group",
        mediaKeys: ["other1", "other2"],
        originalMediaKey: "other1",
        similarity: 0.99
      }
    ]
    const allItems = {
      ...MEDIA_ITEMS,
      other1: makeItem("other1", { resWidth: 100, resHeight: 100 }),
      other2: makeItem("other2", { resWidth: 300, resHeight: 300 })
    }
    let persistedDefault: KeepStrategy | undefined
    const updateReviewSelections = vi.fn(
      (_action: DuplicateReviewAction, next?: DuplicateReviewSelections) =>
        next ?? null
    )
    const result = handleKeepStrategySelection({
      groups: allGroups,
      mediaItems: allItems,
      selections: {
        selectedGroupIds: new Set(),
        reviewedGroupIds: new Set(),
        keptOverrides: {}
      },
      strategy: "largest_resolution",
      persistDefaultStrategy: (strategy) => {
        persistedDefault = strategy
      },
      updateReviewSelections,
      setFeedback: vi.fn()
    })

    expect(persistedDefault).toBe("largest_resolution")
    expect(updateReviewSelections.mock.calls[0]?.[0]).toMatchObject({
      type: "apply_keep_strategy",
      groupIds: ["g1", "hidden-group"],
      strategy: "largest_resolution"
    })
    expect(result?.keptOverrides.g1).toEqual(new Set(["key2"]))
    expect(result?.keptOverrides["hidden-group"]).toEqual(new Set(["other2"]))
  })

  it("announces deterministic tie-breaking and chooses exactly one default keeper", async () => {
    const tiedSelections: DuplicateReviewSelections = {
      selectedGroupIds: new Set(),
      reviewedGroupIds: new Set(),
      keptOverrides: {}
    }
    const tiedItems = {
      key1: makeItem("key1", { isOriginalQuality: true }),
      key2: makeItem("key2", { isOriginalQuality: true }),
      key3: makeItem("key3", { isOriginalQuality: true })
    }
    render(
      <ReviewHarness
        mediaItems={tiedItems}
        initialSelections={{
          ...tiedSelections,
          keptOverrides: {}
        }}
      />
    )

    chooseStrategy(KEEP_STRATEGY_LABELS.best_quality)
    expect(await screen.findByRole("status")).toHaveTextContent(
      "1 set resolved by deterministic tie-break"
    )
    expect(screen.getByTestId("keep-decision-g1")).toHaveTextContent(
      "deterministic tie-break"
    )
    for (const [photoNumber, key] of [
      [1, "key1"],
      [2, "key2"],
      [3, "key3"]
    ] as const) {
      expect(
        screen.getByRole("button", {
          name: new RegExp(`^Keep photo${photoNumber}\\.jpg`)
        })
      ).toHaveAttribute("aria-pressed", key === "key1" ? "true" : "false")
    }
  })

  it("replaces a legacy keeper choice with the selected default", async () => {
    render(
      <ReviewHarness
        initialSelections={{
          selectedGroupIds: new Set(),
          reviewedGroupIds: new Set(),
          keptOverrides: { g1: new Set(["key2"]) }
        }}
      />
    )

    chooseStrategy(KEEP_STRATEGY_LABELS.best_quality)
    const status = await screen.findByRole("status")
    expect(status).toHaveTextContent("1 set changed")
    expect(screen.getByTestId("keep-decision-g1")).toHaveTextContent(
      "Suggested keep: Best quality"
    )
    expect(
      screen.getByRole("button", {
        name: /Keep photo1\.jpg \(currently kept/
      })
    ).toHaveAttribute("aria-pressed", "true")
  })

  it("replaces a manual keeper with Best quality and announces the override", async () => {
    render(
      <ReviewHarness
        initialSelections={{
          selectedGroupIds: new Set(["g1"]),
          reviewedGroupIds: new Set(["g1"]),
          keptOverrides: { g1: new Set(["key2"]) },
          keepDecisionProvenance: { g1: { source: "manual" } }
        }}
      />
    )

    chooseStrategy(KEEP_STRATEGY_LABELS.best_quality)

    expect(await screen.findByRole("status")).toHaveTextContent(
      "1 manual choice replaced"
    )
    expect(
      screen.getByRole("button", { name: /Keep photo1\.jpg \(currently kept/i })
    ).toHaveAttribute("aria-pressed", "true")
    expect(
      screen.getByRole("button", { name: /Keep photo2\.jpg \(currently moves to Trash/i })
    ).toHaveAttribute("aria-pressed", "false")
    expect(
      screen.getByRole("checkbox", { name: "Include duplicate set of 3 photos" })
    ).toHaveAttribute("aria-checked", "true")
  })

  it("explains why the last kept photo cannot move alone and offers the all-copies action", () => {
    render(
      <ReviewHarness
        initialSelections={{
          selectedGroupIds: new Set(["g1"]),
          reviewedGroupIds: new Set(["g1"]),
          keptOverrides: { g1: new Set(["key1"]) }
        }}
      />
    )

    const lastKeeper = screen.getByRole("button", {
      name: /currently kept; this is the last kept copy.*at least one copy must remain kept/i
    })
    expect(lastKeeper).toHaveAttribute("aria-pressed", "true")
    expect(lastKeeper).toHaveAccessibleDescription(
      "At least one copy stays kept. Use “Mark all copies for Trash” to move every copy to Trash."
    )
    expect(
      screen.getByText(
        "At least one copy stays kept. Use “Mark all copies for Trash” to move every copy to Trash."
      )
    ).toBeInTheDocument()

    fireEvent.click(lastKeeper)
    expect(
      screen.getByRole("button", {
        name: /currently kept; this is the last kept copy/i
      })
    ).toHaveAttribute("aria-pressed", "true")

    fireEvent.click(
      screen.getByRole("button", { name: "Mark all copies for Trash" })
    )
    for (const photoNumber of [1, 2, 3]) {
      expect(
        screen.getByRole("button", {
          name: new RegExp(`^Keep photo${photoNumber}\\.jpg`)
        })
      ).toHaveAttribute("aria-pressed", "false")
    }
  })
})
