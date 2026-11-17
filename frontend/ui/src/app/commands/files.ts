import { absolutePath } from "@novadeck/core/files"
import { activeProject } from "@novadeck/core/state"
import type { Workspace, WorkspaceState, WorkspaceTarget } from "@novadeck/core/types"

import { currentContext, currentTarget } from "../selectors"
import type { CommandContext } from "./context"

export type FileCommands = {
  // Opens a file of the active project, by its path from the project's root, in the
  // session's project window: re-pointed to it when it is open, made when it is not, and
  // selected, with or without a terminal. Nothing happens where the backend can't open
  // files there. Rejects when the backend can't open the file. With `preview` the window shows
  // the file as it would be once the agents' work merges onto main, which starts over (everyone
  // merged) each time; without, as it is in main.
  // A file main lacks (an agent added it) opens at `copy` instead, an absolute path of an agent's
  // own copy, which `openInProject` takes wherever it is.
  readonly openProjectFile: (
    path: string,
    options?: { readonly preview?: boolean; readonly copy?: string | undefined },
  ) => Promise<void>
  // The person renamed or moved a file or folder of the project, by its paths from the project's
  // root: each of its sessions' project window that shows that file, or a file inside that
  // folder, is pointed at it where it is now, without being selected, and shows main's copy of
  // it, not a preview of the agents' work at the old path. Where it can't be, as when the file
  // has moved on again, the window says the file is gone, as for a file deleted. Nothing happens
  // where the backend can't open files there, nor for a project removed meanwhile.
  readonly followMovedFile: (projectId: string, from: string, to: string) => Promise<void>
}

type SourceDependencies = {
  readonly markCreated: (created: { readonly context: string; readonly id: string }) => void
  readonly pulse: () => void
}

const sessionState = (workspace: Workspace, target: WorkspaceTarget): WorkspaceState | undefined =>
  workspace.projects
    .find((project) => project.id === target.projectId)
    ?.history.find((session) => session.id === target.workspaceSessionId)?.state

// Where a path at or below `from` is once `from` moved to `to`, each absolute on the backend's
// machine in the separator `directory` is written in; undefined for a path elsewhere.
const movedPath = (
  directory: string,
  path: string,
  from: string,
  to: string,
): string | undefined => {
  if (path === absolutePath(directory, from)) return absolutePath(directory, to)
  const inside = absolutePath(directory, `${from}/`)
  return path.startsWith(inside)
    ? `${absolutePath(directory, `${to}/`)}${path.slice(inside.length)}`
    : undefined
}

export const createFileCommands = (
  { workspace, navigation, effects, companions, ui }: CommandContext,
  { markCreated, pulse }: SourceDependencies,
): FileCommands => ({
  openProjectFile: async (path, options) => {
    const open = companions?.openInProject
    if (!open) return
    const before = workspace.getSnapshot()
    const target = currentTarget(before)
    const known = sessionState(before, target)?.roster.windows
    const had = known?.find((each) => each.home === "project")
    const asked = effects.newId()
    let backed = false
    const { item, window } = await open(
      target,
      absolutePath(activeProject(before)!.directory, path),
      asked,
    ).catch((error: unknown) => {
      // Main has no such file: an agent's copy of it stands behind the window.
      if (options?.copy === undefined) throw error
      backed = true
      return open(target, options.copy, asked)
    })
    const snapshot = workspace.getSnapshot()
    const state = sessionState(snapshot, target)
    // The person closed the window meanwhile, and the backend's close, queued behind this
    // open, removes it again: it isn't brought back to be selected and removed. A window the
    // backend made anew, as when another client closed that one, is a different window.
    if (had && window.id === had.id && !state?.roster.windows.some((each) => each.id === had.id))
      return
    // Whether the window previews the file or shows main's copy, kept by the session.
    const context = `${target.projectId}/${target.workspaceSessionId}`
    ui.update((now) => {
      const { [context]: _was, ...rest } = now.filePreviews
      return {
        ...now,
        filePreviews: options?.preview
          ? {
              ...rest,
              [context]: {
                itemId: item.id,
                projectId: target.projectId,
                path,
                backed,
                opened: effects.newId(),
              },
            }
          : rest,
      }
    })
    // Made by this open, not by what the watch reported first: whichever came first, it is
    // placed the same. It is the window this open asked for the id of; where two opens began
    // with no window, the second is answered with the first's.
    const made = window.id === asked
    // The person may have moved on while the backend read the file. The window belongs to the
    // session it was opened for: it goes there, and only if they are still in it is it
    // selected, placed beside what they have selected, and pulsed.
    const now = currentTarget(snapshot)
    if (
      now.projectId !== target.projectId ||
      now.workspaceSessionId !== target.workspaceSessionId
    ) {
      workspace.dispatch({
        type: "project/open",
        target,
        item,
        window,
        made,
      })
      return
    }
    // A new window goes where an undocked one would: beside the selected tile, compactly.
    if (made) markCreated({ context: currentContext(snapshot), id: window.id })
    // The person stays in the panel they opened it from.
    navigation.navigateWorkspace([
      {
        type: "project/open",
        target,
        item,
        window,
        made,
      },
    ])
    pulse()
  },
  followMovedFile: async (projectId, from, to) => {
    const open = companions?.openInProject
    const project = workspace.getSnapshot().projects.find((each) => each.id === projectId)
    if (!open || !project) return
    await Promise.all(
      project.history.map(async (session) => {
        const target = { projectId: project.id, workspaceSessionId: session.id }
        const { roster, items } = session.state
        const window = roster.windows.find((each) => each.home === "project")
        const shown = items.find((each) => each.id === window?.itemId)?.path
        const path = shown && movedPath(project.directory, shown, from, to)
        if (!window || !path) return
        // A file that can't be opened there stays as it was, gone. One the person closed meanwhile
        // is made anew under the id asked for, which the backend's watch places, unselected.
        const answer = await open(target, path, effects.newId()).catch(() => undefined)
        if (answer?.window.id !== window.id) return
        workspace.dispatch({ type: "item/upsert", target, item: answer.item })
        workspace.dispatch({ type: "window/upsert", target, window: answer.window })
        const context = `${target.projectId}/${target.workspaceSessionId}`
        ui.update((now) => {
          if (now.filePreviews[context]?.itemId !== answer.item.id) return now
          const { [context]: _was, ...rest } = now.filePreviews
          return { ...now, filePreviews: rest }
        })
      }),
    )
  },
})
