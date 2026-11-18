import { kindRules, type Item, type ItemId } from "@novadeck/core/items"
import type { Workspace, WorkspaceTarget } from "@novadeck/core/types"

// What the workspace says about items, apart from what they hold: which file one points at,
// where it is, and each session's items.

// Which file an item shows, for a file or an image, and what kind it is otherwise. The same
// item shown another file is something else to read, as the project window's is when the
// person opens another; any other change, as new lines or a new route, replaces content in place.
export const pointedAt = (item: Pick<Item, "kind" | "path">): string =>
  JSON.stringify([item.kind, kindRules[item.kind].pointer === "file" ? item.path : null])

export const itemIn = (workspace: Workspace, id: ItemId): Item | undefined => {
  for (const project of workspace.projects)
    for (const each of project.history) {
      const item = each.state.items.find((candidate) => candidate.id === id)
      if (item) return item
    }
  return undefined
}

// The session an item is in, while it's there.
export const targetOf = (workspace: Workspace, id: ItemId): WorkspaceTarget | undefined => {
  for (const project of workspace.projects)
    for (const each of project.history)
      if (each.state.items.some((candidate) => candidate.id === id))
        return { projectId: project.id, workspaceSessionId: each.id }
  return undefined
}

export const pointedIn = (workspace: Workspace, id: ItemId): string | undefined => {
  const item = itemIn(workspace, id)
  return item && pointedAt(item)
}

// Each session's items, which change far less often than the workspace.
export const itemsOf = (workspace: Workspace): readonly (readonly Item[])[] =>
  workspace.projects.flatMap((project) => project.history.map((each) => each.state.items))
