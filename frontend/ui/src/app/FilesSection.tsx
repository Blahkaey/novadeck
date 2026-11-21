import { allTeams, sameTeams } from "@novadeck/core/derivations"
import type { FilesExclude, ProjectFiles } from "@novadeck/core/files"
import { activeProject } from "@novadeck/core/state"
import { useCallback, useMemo } from "react"

import { latestTurnEnd } from "../sidebar/files-turns"
import { filesOfWorks } from "../sidebar/files-works"
import { FilesPanel } from "../sidebar/FilesPanel"
import { useUiState, useWorkspaceServices, useWorkspaceState } from "./controller/context"
import { useStoreSelector } from "./controller/useStoreSelector"
import {
  copyOf,
  noWorks,
  ownersOf,
  previewFiles,
  sameOwners,
  sameWorks,
  savingFirst,
} from "./files-feed"
import { usePanelOpen, usePanelShowing } from "./panels-shown"
import { currentState, sameItems } from "./selectors"
import { useWorktreesShown } from "./use-worktrees-shown"

const sameHandles = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean =>
  a.size === b.size && [...a].every(([id, handle]) => b.get(id) === handle)

// The Files panel, wired to where the backend reads the projects' files. It reads when an agent's
// turn last ended itself, to read its folders again, so that wakes no other panel.
export const FilesSection = ({ files }: { readonly files: ProjectFiles }): React.JSX.Element => {
  const { commands, backend, ui } = useWorkspaceServices()
  const projectId = useWorkspaceState((workspace) => workspace.activeProjectId)
  const turn = useWorkspaceState((workspace) => latestTurnEnd(activeProject(workspace)!))
  const filesProject = useStoreSelector(files.state, (state) => state.projects[projectId])
  const list = useCallback((folder: string) => files.list(projectId, folder), [files, projectId])
  const { checkout: readCheckout, update } = files
  const checkout = useMemo(
    () =>
      readCheckout && update
        ? { read: () => readCheckout(projectId), update: () => update(projectId) }
        : undefined,
    [readCheckout, update, projectId],
  )
  // What hides files from it: the person's patterns for every project, and the project's own where
  // the backend keeps them.
  const exclude = useUiState((state) => state.preferences.filesExclude)
  const excludeFeed = files.exclude
  const projectExclude = useMemo(
    () =>
      excludeFeed && {
        read: () => excludeFeed.read(projectId),
        save: (patterns: FilesExclude) => excludeFeed.save(projectId, patterns),
      },
    [excludeFeed, projectId],
  )
  // How the backend makes, moves, copies and deletes the project's files, each where it can. A
  // move or a delete of the file a project window shows, or of a folder holding it, saves the
  // edits to it first (`savingFirst`).
  const entries = useMemo(() => {
    const { create, move, copy, remove } = files
    return {
      ...(create && {
        create: (path: string, folder: boolean) => create(projectId, path, folder),
      }),
      ...(copy && { copy: (from: string, into: string) => copy(projectId, from, into) }),
      ...savingFirst(
        {
          ...(move && { move: (from: string, to: string) => move(projectId, from, to) }),
          ...(remove && { remove: (path: string) => remove(projectId, path) }),
        },
        (path, action) => commands.saveBeforeChange(projectId, path, action),
      ),
    }
  }, [files, projectId, commands])
  // What the project's windows do once the person moved one of its files.
  const onMoved = useCallback(
    (from: string, to: string) => void commands.followMovedFile(projectId, from, to),
    [commands, projectId],
  )
  // Where the panel's paths are copied from.
  const directory = useWorkspaceState((workspace) => activeProject(workspace)!.directory)
  const selectedHandle = useWorkspaceState((workspace) => {
    const { roster, selected } = currentState(workspace)
    return roster.terminals.find((terminal) => terminal.id === selected)?.handle
  })
  // The agents strip's order and squads, by handle (a terminal with none has no agent here).
  const roster = useWorkspaceState(
    (workspace) =>
      currentState(workspace).roster.terminals.flatMap((terminal) =>
        terminal.handle ? [terminal.handle] : [],
      ),
    sameItems,
  )
  const teams = useWorkspaceState(allTeams, sameTeams)
  const handles = useWorkspaceState(
    (workspace) =>
      new Map(
        currentState(workspace).roster.terminals.flatMap((terminal) =>
          terminal.handle ? [[terminal.id, terminal.handle] as const] : [],
        ),
      ),
    sameHandles,
  )
  const squads = useMemo(
    () =>
      teams.map(({ lead, workers }) =>
        [lead, ...workers].flatMap((id) => (handles.has(id) ? [handles.get(id)!] : [])),
      ),
    [teams, handles],
  )
  // The works, where the Worktrees panel shows (see `useWorktreesShown`): every project's, for
  // the open project's to be picked from.
  const worksFeed = useWorktreesShown() ? backend.works : undefined
  const allWorks = useStoreSelector(worksFeed?.state ?? noWorks, (state) => state.works, sameWorks)
  // The terminals of every session of the project that may own its worktrees, by id.
  const owners = useWorkspaceState(
    (workspace) => ownersOf(activeProject(workspace)!.history),
    sameOwners,
  )
  // Where the backend tells no changes of its own, the panel lays the project's works over its
  // files while the Worktrees panel shows, and follows them while it shows.
  const worksOverlay = useMemo(
    () => (worksFeed && !filesProject ? filesOfWorks(allWorks, projectId, owners) : undefined),
    [worksFeed, filesProject, allWorks, projectId, owners],
  )
  const watchWorks = filesProject ? undefined : worksFeed?.watch
  // A file some work of the project changes opens as a preview of what the works merge to, while
  // the works are shown; any other as it is in main.
  const onOpenFile = useCallback(
    (path: string) =>
      commands.openProjectFile(path, {
        preview: worksFeed !== undefined && previewFiles(allWorks, projectId, path).length > 0,
        copy: copyOf(allWorks, projectId, path),
      }),
    [commands, worksFeed, allWorks, projectId],
  )
  const onLit = useCallback(
    (lit: ReadonlySet<string>) =>
      ui.update((state) => (state.filesLit === lit ? state : { ...state, filesLit: lit })),
    [ui],
  )
  const active = usePanelOpen("files")
  const showing = usePanelShowing("files")
  return (
    <FilesPanel
      key={projectId}
      project={filesProject ?? worksOverlay}
      directory={directory}
      list={list}
      exclude={exclude}
      projectExclude={projectExclude}
      onExcludeSettings={commands.openFilesExcludeSettings}
      entries={entries}
      onMoved={onMoved}
      turn={turn}
      checkout={checkout}
      watch={watchWorks}
      onOpenFile={onOpenFile}
      onLit={onLit}
      selectedHandle={selectedHandle}
      roster={roster}
      squads={squads}
      active={active}
      showing={showing}
      onHide={commands.hideSidebar}
    />
  )
}
