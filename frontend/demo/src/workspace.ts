import type { Item, ItemId } from "@novadeck/core/items"
import type { TerminalKey } from "@novadeck/core/port"
import type {
  TerminalMetadata,
  Workspace,
  WorkspaceSession,
  WorkspaceTarget,
} from "@novadeck/core/types"

// What the demo reads of the workspace it last saw.

// A session as the workspace last held it.
export const sessionOf = (
  workspace: Workspace | undefined,
  { projectId, workspaceSessionId }: WorkspaceTarget,
): WorkspaceSession | undefined =>
  workspace?.projects
    .find((project) => project.id === projectId)
    ?.history.find((session) => session.id === workspaceSessionId)

// The terminal as the workspace last held it.
export const terminalOf = (
  workspace: Workspace | undefined,
  key: TerminalKey,
): TerminalMetadata | undefined =>
  sessionOf(workspace, key)?.state.roster.terminals.find(
    (terminal) => terminal.id === key.terminalId,
  )

// Every terminal of the workspace, in every session of every project, with its key.
export const terminalsOf = (
  workspace: Workspace,
): { key: TerminalKey; terminal: TerminalMetadata }[] =>
  workspace.projects.flatMap((project) =>
    project.history.flatMap((session) =>
      session.state.roster.terminals.map((terminal) => ({
        key: { projectId: project.id, workspaceSessionId: session.id, terminalId: terminal.id },
        terminal,
      })),
    ),
  )

// The folder of a terminal's project.
export const directoryOf = (
  workspace: Workspace | undefined,
  key: { readonly projectId: string },
): string | undefined =>
  workspace?.projects.find((project) => project.id === key.projectId)?.directory

// A file of a project: by its path from the project's root, or, outside the project's folder
// (an agent's copy), by its own path.
export type FileAt = { readonly projectId: string; readonly path: string }

// The file a session's project window shows: where its project has it, the path its item points
// at, which a save names, and the item.
export type WindowFile = FileAt & { readonly at: string; readonly itemId: ItemId }

// The file the project window of the session `target` shows, while it shows one.
export const windowFileOf = (
  workspace: Workspace | undefined,
  target: WorkspaceTarget,
): WindowFile | undefined => {
  const state = sessionOf(workspace, target)?.state
  const window = state?.roster.windows.find((each) => each.home === "project")
  const at = window && state?.items.find((each) => each.id === window.itemId)?.path
  const directory = directoryOf(workspace, target)
  if (!window || !at || directory === undefined) return undefined
  const inside = at.startsWith(`${directory}/`)
  return {
    projectId: target.projectId,
    path: inside ? at.slice(directory.length + 1) : at,
    at,
    itemId: window.itemId,
  }
}

// Every item the workspace's sessions hold.
export const itemsOf = (workspace: Workspace): readonly Item[] =>
  workspace.projects.flatMap((project) => project.history.flatMap((each) => each.state.items))
