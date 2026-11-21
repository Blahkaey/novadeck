import { absolutePath } from "@novadeck/core/files"
import { activeProject } from "@novadeck/core/state"

import { currentContext, currentTarget, projectWindowFile, stateAt } from "../selectors"
import type { CommandContext } from "./context"
import type { Leave, LeaveAll } from "./file-edits"

export type FileCommands = {
  // Opens a folder of the active project, by its path from the project's root, in the pane of the
  // selected terminal (the session's first when a window is selected): listed there as a folder
  // item, read-only. Rejects when the backend can't open it, or the session has no terminal.
  readonly openFolderInPane: (path: string) => Promise<void>
  // Opens a file of the active project, by its path from the project's root, in the
  // session's project window: re-pointed to it when it is open, made when it is not, and
  // selected, with or without a terminal. Nothing happens where the backend can't open
  // files there. Rejects when the backend can't open the file. With `preview` the window shows
  // the file as it would be once the agents' work merges onto main, which starts over (everyone
  // merged) each time; without, as it is in main.
  // A file main lacks (an agent added it) opens at `copy` instead, an absolute path of an agent's
  // own copy, which `openInProject` takes wherever it is.
  // With `keep`, a preview of the file the window already previews goes on as it was rather than
  // starting over, as when the person clicks its row again.
  readonly openProjectFile: (
    path: string,
    options?: {
      readonly preview?: boolean
      readonly copy?: string | undefined
      readonly keep?: boolean
    },
  ) => Promise<void>
  // The person is about to rename, move or delete a file or folder of the project, by its path
  // from the project's root: the edits to each file a project window of the project's sessions
  // shows there, or inside that folder, are saved first (see `Leave`). Answers whether to go on:
  // once they're saved, or the person chose to copy those that can't be and go on; not where
  // they chose to stay.
  readonly saveBeforeChange: (
    projectId: string,
    path: string,
    action: "rename" | "move" | "delete",
  ) => Promise<boolean>
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
  readonly leave: Leave
  readonly leaveAll: LeaveAll
}

// Whether the file at `path`, absolute on the backend's machine in the separator `directory` is
// written in, is the entry at `entry`, from the project's root, or inside it.
const atOrBelow = (directory: string, path: string, entry: string): boolean =>
  path === absolutePath(directory, entry) || path.startsWith(absolutePath(directory, `${entry}/`))

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
  { markCreated, pulse, leave, leaveAll }: SourceDependencies,
): FileCommands => ({
  openFolderInPane: async (path) => {
    const attach = companions?.attach
    if (!attach) return
    const before = workspace.getSnapshot()
    const target = currentTarget(before)
    const state = stateAt(before, target)
    const terminal =
      state?.roster.terminals.find((each) => each.id === state.selected) ??
      state?.roster.terminals[0]
    if (!terminal) throw new Error("There is no terminal to show the folder beside")
    await attach(target, terminal.id, absolutePath(activeProject(before)!.directory, path))
    // The item opens on the terminal's bar as the backend reports it; the person sees it there.
    if (state?.selected !== terminal.id)
      navigation.navigateWorkspace([{ type: "terminal/select", target, terminalId: terminal.id }])
  },
  openProjectFile: async (path, options) => {
    const open = companions?.openInProject
    if (!open) return
    const asking = workspace.getSnapshot()
    const target = currentTarget(asking)
    const wanted = absolutePath(activeProject(asking)!.directory, path)
    // The edits to the file it shows reach that file before it shows another.
    const session = stateAt(asking, target)
    const shown = projectWindowFile(session)
    const context = `${target.projectId}/${target.workspaceSessionId}`
    const saved = ui.getSnapshot().filePreviews[context]
    // Re-pointing the same item gives it a new version and remounts its editor and diff.
    // A repeated Files click can select the window already showing this request.
    if (
      options?.keep &&
      shown &&
      saved?.itemId === shown.id &&
      saved.itemVersion === shown.version &&
      saved.path === path &&
      (!saved.backed || shown.path === options.copy)
    ) {
      const window = session?.roster.windows.find((each) => each.home === "project")
      if (window) {
        navigation.navigateWorkspace([
          { type: "project/open", target, window, item: shown, made: false },
        ])
        pulse()
        return
      }
    }
    const leaving = shown && shown.path !== wanted ? leave(target, shown, "switch") : undefined
    if (leaving && !(await leaving)) return
    const before = workspace.getSnapshot()
    const known = stateAt(before, target)?.roster.windows
    const had = known?.find((each) => each.home === "project")
    const asked = effects.newId()
    let backed = false
    const { item, window } = await open(target, wanted, asked).catch((error: unknown) => {
      // Main has no such file: an agent's copy of it stands behind the window.
      if (options?.copy === undefined) throw error
      backed = true
      return open(target, options.copy, asked)
    })
    const snapshot = workspace.getSnapshot()
    const state = stateAt(snapshot, target)
    // The person closed the window meanwhile, and the backend's close, queued behind this
    // open, removes it again: it isn't brought back to be selected and removed. A window the
    // backend made anew, as when another client closed that one, is a different window.
    if (had && window.id === had.id && !state?.roster.windows.some((each) => each.id === had.id))
      return
    // Whether the window previews the file or shows main's copy, kept by the session.
    ui.update((now) => {
      const { [context]: _was, ...rest } = now.filePreviews
      return {
        ...now,
        filePreviews:
          item.kind === "file"
            ? {
                ...rest,
                [context]: {
                  itemId: item.id,
                  itemVersion: item.version,
                  projectId: target.projectId,
                  path,
                  backed,
                  opened: asked,
                  showDiff: options?.preview === true,
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
  saveBeforeChange: async (projectId, path, action) => {
    // The Files panel asks it of the project it shows as the person makes the change.
    const project = workspace.getSnapshot().projects.find((each) => each.id === projectId)!
    const targets = project.history.map((session) => ({
      projectId,
      workspaceSessionId: session.id,
    }))
    return (
      (await leaveAll(targets, action, (shown) => atOrBelow(project.directory, shown, path))) ??
      true
    )
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
