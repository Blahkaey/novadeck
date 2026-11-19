import { todosLeft } from "@novadeck/core/notes"
import { useCallback, useSyncExternalStore, type ComponentProps } from "react"

import { panelLabels } from "./panel-labels"
import { SidebarPanel } from "./SidebarPanel"
import { TodoBoard } from "./TodoBoard"

// How often the board's done cards are told the time while it shows, so a card checked off
// today reads as a date once the day turns.
const nowEveryMs = 60_000

// The time, to the minute, which stays the same between two reads in one.
const minute = (): number => Math.floor(Date.now() / nowEveryMs) * nowEveryMs

// The Todo panel: the open project's Todo board in the sidebar, under a heading that counts
// what is still to do, those in progress among it. Done cards say when they were checked off
// against the time it is as the panel shows, and every minute while it does.
export const TodoPanel = ({
  active,
  onClose,
  ...board
}: Omit<ComponentProps<typeof TodoBoard>, "now"> & {
  active: boolean
  onClose: () => void
}): React.JSX.Element => {
  const left = todosLeft(board.notes, board.projectId)
  // Read as it draws, as it does once shown again; while shown, every minute too.
  const ticks = useCallback(
    (notify: () => void) => {
      if (!active) return () => {}
      const timer = setInterval(notify, nowEveryMs)
      return () => clearInterval(timer)
    },
    [active],
  )
  const now = useSyncExternalStore(ticks, minute)
  return (
    <SidebarPanel
      id="todo-panel"
      title={panelLabels.todo}
      count={left === 0 ? "" : left}
      active={active}
      onClose={onClose}
    >
      <TodoBoard {...board} now={now} />
    </SidebarPanel>
  )
}
