import { todosLeft } from "@novadeck/core/notes"
import type { ComponentProps } from "react"

import { panelLabels } from "./panel-labels"
import { SidebarPanel } from "./SidebarPanel"
import { TodoBoard } from "./TodoBoard"

// The Todo panel: the open project's Todo board in the sidebar, under a heading that counts
// what is still to do, those in progress among it.
export const TodoPanel = ({
  active,
  onClose,
  ...board
}: ComponentProps<typeof TodoBoard> & {
  active: boolean
  onClose: () => void
}): React.JSX.Element => {
  const left = todosLeft(board.notes, board.projectId)
  return (
    <SidebarPanel
      id="todo-panel"
      title={panelLabels.todo}
      count={left === 0 ? "" : left}
      active={active}
      onClose={onClose}
    >
      <TodoBoard {...board} />
    </SidebarPanel>
  )
}
