import { isPanel } from "@novadeck/core/roster"
import type { RailPanel, Tile } from "@novadeck/core/types"
import {
  FolderGit2,
  GitCompare,
  History,
  Inbox,
  ListTodo,
  NotebookPen,
  Terminal,
  type LucideIcon,
} from "lucide-react"

// Each panel's icon: its rail toggle's, and its window's on the stage and in the lists that name
// that window.
export const panelIcons: Readonly<Record<RailPanel, LucideIcon>> = {
  terminals: Terminal,
  inbox: Inbox,
  worktrees: GitCompare,
  files: FolderGit2,
  notes: NotebookPen,
  todo: ListTodo,
  history: History,
}

// What search and the switcher draw a tile with: a panel's window by its panel's icon, any other
// as a terminal.
export const tileIcon = (tile: Tile): LucideIcon =>
  isPanel(tile) ? panelIcons[tile.panel] : Terminal
