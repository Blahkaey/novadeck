import type { Item } from "@novadeck/core/items"
import type { WorkspaceTarget } from "@novadeck/core/types"
import { Diff } from "lucide-react"
import { useLayoutEffect, useRef, type ReactNode } from "react"

import { ProjectFile } from "../../kinds/file/ProjectFile"
import { PaneTools } from "../../pane-row"
import type { ItemStore } from "../../store/item-store"
import { WindowItem } from "../WindowItem"

// The session's project window: the item the person opened from Files. A text file's editor
// and worktree diff share its title row. Its file stays followed while the diff shows.
// Focus leaving the window saves its file's edits at once.
export const ProjectWindow = ({
  itemStore,
  target,
  item,
  diff,
  worktreeCopy = false,
  notice,
}: {
  itemStore: ItemStore
  target: WorkspaceTarget
  // Undefined while the backend hasn't reported it: the window shows nothing meanwhile.
  item: Item | undefined
  diff?:
    | {
        readonly body?: ReactNode
        readonly saving: boolean
        readonly toggle: () => void
      }
    | undefined
  worktreeCopy?: boolean | undefined
  notice?: string | undefined
}): React.JSX.Element => {
  const window = useRef<HTMLDivElement>(null)
  const focused = useRef<EventTarget | null>(null)
  const hasTool = diff !== undefined
  const showingDiff = diff?.body !== undefined
  useLayoutEffect(() => {
    // When changes disappear, the focused tool or diff control may go with them.
    if (hasTool && showingDiff) return
    const last = focused.current
    if (
      last instanceof HTMLElement &&
      !last.isConnected &&
      document.activeElement === document.body
    )
      window.current?.focus({ preventScroll: true })
  }, [hasTool, showingDiff])

  const body = item?.kind === "file" && (
    <>
      {diff && (
        <PaneTools
          tools={[
            {
              key: "worktree-diff",
              icon: Diff,
              label: "Worktree diff",
              tip: diff.saving
                ? "Saving your edits…"
                : showingDiff
                  ? "Show file"
                  : "Show worktree diff",
              pressed: showingDiff,
              pending: diff.saving,
              onClick: diff.toggle,
            },
          ]}
        />
      )}
      <ProjectFile
        item={item}
        itemStore={itemStore}
        target={target}
        diff={diff?.body}
        worktreeCopy={worktreeCopy}
        notice={notice}
      />
    </>
  )
  return (
    <div
      ref={window}
      className="artifact-window"
      tabIndex={-1}
      onFocus={(event) => {
        focused.current = event.target
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        if (event.relatedTarget !== null) focused.current = null
        if (item?.kind !== "file" || item.path === null) return
        itemStore.file(target, item.id, item.path).flush()
      }}
    >
      {item && (
        <WindowItem item={item} itemStore={itemStore} target={target} body={body || undefined} />
      )}
    </div>
  )
}
