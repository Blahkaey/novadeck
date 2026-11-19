import { allTeams, sameTeams } from "@novadeck/core/derivations"
import type { FilesExclude } from "@novadeck/core/files"
import type { ForgeConnection } from "@novadeck/core/forges"
import type { ClosedTerminal, HistoryState } from "@novadeck/core/history"
import { itemIdOf } from "@novadeck/core/items"
import { noNotes, type Note, type NotesState } from "@novadeck/core/notes"
import { orderedIds } from "@novadeck/core/roster"
import { activeProject } from "@novadeck/core/state"
import { createStore } from "@novadeck/core/store"
import { handleText } from "@novadeck/core/terminals/handle"
import type { Work, WorksState } from "@novadeck/core/works"
import { memo, useCallback, useMemo, useSyncExternalStore } from "react"

import { useDesktop } from "../shell/desktop"
import { sidebarVisible } from "../shell/shell-state"
import { WorkspaceSidebar } from "../shell/WorkspaceSidebar"
import { projectPath, filesOfWorks } from "../sidebar/files-works"
import { useUiState, useWorkspaceServices, useWorkspaceState } from "./controller/context"
import { useStoreSelector } from "./controller/useStoreSelector"
import {
  copyOf,
  noFiles,
  noWorks,
  ownersOf,
  previewFiles,
  sameOwners,
  sameWorks,
  savingFirst,
} from "./files-feed"
import { FilesSection } from "./FilesSection"
import { useTabsAway } from "./move-to"
import { historyShown, filesShown, notesShown } from "./routing"
import { currentState, currentTarget, sameItems, sameTarget } from "./selectors"
import { SessionsSection } from "./SessionsSection"
import { useReorderTiles } from "./team-fold"
import { renderTerminalsView } from "./TerminalsViewSection"
import { useWorktreesShown } from "./use-worktrees-shown"
import { renderTab } from "./WorkspaceTab"

// What a backend without forges reads in their place.
const noForges = createStore<readonly ForgeConnection[]>([])

const sameHandles = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean =>
  a.size === b.size && [...a].every(([id, handle]) => b.get(id) === handle)

// What a backend without History reads in its place; its panel isn't drawn.
const noHistory = createStore<HistoryState>({ rows: [] })
// What a backend without notes reads in their place; its panel isn't drawn.
const noneNoted = createStore<NotesState>(noNotes)
const noAgents: readonly never[] = []
const always = (): (() => void) => () => {}

const sameRows = (a: readonly ClosedTerminal[], b: readonly ClosedTerminal[]): boolean =>
  a.length === b.length && a.every((row, index) => Object.is(row, b[index]))

const sameNotes = (a: readonly Note[], b: readonly Note[]): boolean =>
  a.length === b.length && a.every((note, index) => Object.is(note, b[index]))

// The sidebar wired to the workspace: terminal tabs and workspace sessions.
export const SidebarSection = memo((): React.JSX.Element => {
  const { commands, backend, ui } = useWorkspaceServices()
  const { hideSidebar, add } = commands
  const reorderTiles = useReorderTiles()
  const desktop = useDesktop()
  const projectId = useWorkspaceState((workspace) => workspace.activeProjectId)
  // Only what the sidebar shows of the sessions itself: how many, and the open one's name
  // once there are others. Their rows read the rest (SessionsSection), and the tabs their own
  // tiles, so an agent's news wakes neither the sidebar nor its other panels.
  const sessionCount = useWorkspaceState((workspace) => activeProject(workspace)!.history.length)
  const sessionName = useWorkspaceState((workspace) => {
    const { history, activeSessionId } = activeProject(workspace)!
    return history.length > 1
      ? history.find((session) => session.id === activeSessionId)?.name
      : undefined
  })
  const target = useWorkspaceState(currentTarget, sameTarget)
  const ids = useWorkspaceState(
    (workspace) => orderedIds(currentState(workspace).roster),
    sameItems,
  )
  // The Files panel shows where the backend reads the projects' files; see `filesShown`.
  const filesFeed = filesShown(backend) ? backend.files : undefined
  const filesProject = useStoreSelector(
    filesFeed?.state ?? noFiles,
    (state) => state.projects[projectId],
  )
  const list = useCallback(
    (folder: string) => filesFeed!.list(projectId, folder),
    [filesFeed, projectId],
  )
  const checkout = useMemo(
    () =>
      filesFeed?.checkout && filesFeed.update
        ? {
            read: () => filesFeed.checkout!(projectId),
            update: () => filesFeed.update!(projectId),
          }
        : undefined,
    [filesFeed, projectId],
  )
  // What hides files from it: the person's patterns for every project, and the project's own where
  // the backend keeps them.
  const exclude = useUiState((state) => state.preferences.filesExclude)
  const excludeFeed = filesFeed?.exclude
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
    if (!filesFeed) return undefined
    const { create, move, copy, remove } = filesFeed
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
  }, [filesFeed, projectId, commands])
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
  // The Worktrees panel shows where the backend reports the terminals' work, while agent
  // worktrees are on; see `useWorktreesShown`.
  const worksFeed = useWorktreesShown() ? backend.works : undefined
  // Every project's works, for the Files panel and previews to pick the open project's from.
  const allWorks = useStoreSelector(worksFeed?.state ?? noWorks, (state) => state.works, sameWorks)
  // The open project's works: the Worktrees panel lists only these.
  const ofProject = useCallback(
    (state: WorksState) => state.works.filter((work) => work.projectId === projectId),
    [projectId],
  )
  const projectWorks = useStoreSelector(worksFeed?.state ?? noWorks, ofProject, sameWorks)
  // The terminals of every session of the project that may own its worktrees, by id.
  const owners = useWorkspaceState(
    (workspace) => ownersOf(activeProject(workspace)!.history),
    sameOwners,
  )
  // Where the backend tells no changes of its own, the Files panel lays the project's works
  // over its files while the Worktrees panel shows, and follows them while it shows.
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
  // The History panel shows where the backend keeps closed terminals; see `historyShown`.
  const historyFeed = historyShown(backend) ? backend.history : undefined
  const historyRows = useStoreSelector(
    historyFeed?.state ?? noHistory,
    (state) => state.rows.filter((row) => row.projectId === projectId),
    sameRows,
  )
  const connections = useSyncExternalStore(
    backend.agents?.state.subscribe ?? always,
    () => backend.agents?.state.getSnapshot() ?? noAgents,
  )
  // Reading the rows also looks at which agents are connected again: another window may
  // have connected one since, and the runner says nothing of it.
  const refreshAgents = backend.agents?.refresh
  const readHistory = useCallback(() => {
    refreshAgents?.()
    return historyFeed!.list(projectId)
  }, [historyFeed, projectId, refreshAgents])
  const history = useMemo(
    () =>
      historyFeed
        ? {
            rows: historyRows,
            list: readHistory,
            connections: backend.agents ? connections : undefined,
            onRestore: commands.restoreClosed,
            onReveal: (terminalId: string) => commands.revealTerminal(terminalId, projectId),
            onConnect: commands.openAgentSettings,
            onRemove: historyFeed.remove,
          }
        : undefined,
    [historyFeed, historyRows, readHistory, backend.agents, connections, commands, projectId],
  )
  // The Notes panel and the Todo board show where the backend keeps the person's notes; see
  // `notesShown`.
  const notesFeed = notesShown(backend) ? backend.notes : undefined
  const projectNotes = useStoreSelector(
    notesFeed?.state ?? noneNoted,
    (state) => state.notes.filter((note) => note.projectId === projectId),
    sameNotes,
  )
  const notesFailed = useStoreSelector(notesFeed?.state ?? noneNoted, (state) => state.failed)
  const notes = useMemo(
    () =>
      notesFeed
        ? {
            notes: projectNotes,
            failed: notesFailed,
            onAdd: (text: string) => notesFeed.add(projectId, { text, todo: false }),
            onChange: notesFeed.change,
            onPlace: notesFeed.place,
            onRemove: notesFeed.remove,
          }
        : undefined,
    [notesFeed, projectNotes, notesFailed, projectId],
  )
  const todo = useMemo(
    () =>
      notesFeed
        ? {
            notes: projectNotes,
            failed: notesFailed,
            onAdd: (text: string) => notesFeed.add(projectId, { text, todo: true }),
            onChange: notesFeed.change,
            onPlace: notesFeed.place,
            onRemove: notesFeed.remove,
          }
        : undefined,
    [notesFeed, projectNotes, notesFailed, projectId],
  )
  const away = useTabsAway()
  const worksReported = useStoreSelector(worksFeed?.state ?? noWorks, (state) => state.reported)
  // Titles of every project's terminals, in every session of it, for the rows to name.
  const titles = useWorkspaceState(
    (workspace) =>
      new Map(
        workspace.projects.flatMap((project) =>
          project.history.flatMap((session) =>
            session.state.roster.terminals.map((terminal) => [terminal.id, terminal.name] as const),
          ),
        ),
      ),
    sameHandles,
  )
  // Handles of every project's terminals, as people see them, for the rows to say whose they are.
  const workHandles = useWorkspaceState(
    (workspace) =>
      new Map(
        workspace.projects.flatMap((project) =>
          project.history.flatMap((session) =>
            session.state.roster.terminals.flatMap((terminal) =>
              terminal.handle ? [[terminal.id, handleText(terminal.handle)] as const] : [],
            ),
          ),
        ),
      ),
    sameHandles,
  )
  // Whether pull requests are looked for: a forge is on and its tool installed. A backend without
  // forges (a demo's)
  // has its works say so themselves.
  const forgesOn = useStoreSelector(backend.forges?.state ?? noForges, (forges) =>
    backend.forges ? forges.some((forge) => forge.enabled && forge.available) : true,
  )
  const fetchOrigin = useMemo(
    () => (worksFeed?.fetch ? () => worksFeed.fetch!(projectId) : undefined),
    [worksFeed, projectId],
  )
  const selectedId = useWorkspaceState((workspace) => currentState(workspace).selected)
  const { revealTerminal, openBarTab } = commands
  // A work is shown on the bar of the terminal the panel names (its owner's, or the selected
  // terminal's where it has none or its owner is closed). A failure reaches the panel.
  const showWork = useCallback(
    async (work: Work, terminalId: string | undefined): Promise<void> => {
      if (!worksFeed) return
      if (terminalId === undefined) return
      revealTerminal(terminalId, projectId)
      const itemId = await worksFeed.show(work.root, terminalId)
      if (itemId !== null) openBarTab(terminalId, itemIdOf(itemId))
    },
    [worksFeed, revealTerminal, openBarTab, projectId],
  )
  // A file of a work, opened in the project window as a preview: only a file that main has (the
  // window shows main's checkout, which it can only point at).
  const inOpenProject = useCallback(
    (work: Work, path: string): string | undefined =>
      work.folder === undefined ? undefined : projectPath(work.folder, path),
    [],
  )
  const canOpenWorkFile = useCallback(
    (work: Work, path: string): boolean => inOpenProject(work, path) !== undefined,
    [inOpenProject],
  )
  const openWorkFile = useCallback(
    (work: Work, path: string): void => {
      const inProject = inOpenProject(work, path)
      if (inProject !== undefined)
        commands
          .openProjectFile(inProject, {
            preview: true,
            copy: copyOf(allWorks, projectId, inProject),
          })
          .catch(() => {})
    },
    [commands, inOpenProject, allWorks, projectId],
  )
  const worktrees = useMemo(
    () =>
      worksFeed
        ? {
            works: projectWorks,
            reported: worksReported,
            watch: worksFeed.watch,
            titles,
            selectedId,
            onSelect: showWork,
            canOpenFile: canOpenWorkFile,
            onOpenFile: openWorkFile,
            onCloseWork: worksFeed.close,
            handles: workHandles,
            forges: forgesOn,
            ...(fetchOrigin ? { onFetch: fetchOrigin } : {}),
          }
        : undefined,
    [
      worksFeed,
      projectWorks,
      worksReported,
      titles,
      workHandles,
      forgesOn,
      fetchOrigin,
      selectedId,
      showWork,
      canOpenWorkFile,
      openWorkFile,
    ],
  )
  const sidebarPanel = useUiState((state) => state.location.route.panel)
  const visible = useUiState((state) => sidebarVisible(state.shell, desktop))
  return (
    <WorkspaceSidebar
      projectId={projectId}
      workspaceSessionId={target.workspaceSessionId}
      sessions={
        <SessionsSection
          key={projectId}
          workspaceSessionId={target.workspaceSessionId}
          historyKept={Boolean(history)}
        />
      }
      sessionCount={sessionCount}
      sessionName={sessionName}
      terminalsView={renderTerminalsView}
      orderedIds={ids}
      sidebarPanel={sidebarPanel}
      sidebarVisible={visible}
      files={
        filesFeed && (
          <FilesSection
            key={projectId}
            project={filesProject ?? worksOverlay}
            directory={directory}
            list={list}
            exclude={exclude}
            projectExclude={projectExclude}
            onExcludeSettings={commands.openFilesExcludeSettings}
            entries={entries}
            onMoved={onMoved}
            checkout={checkout}
            watch={watchWorks}
            onOpenFile={onOpenFile}
            onLit={onLit}
            selectedHandle={selectedHandle}
            roster={roster}
            squads={squads}
            active={sidebarPanel === "files"}
            visible={visible}
            onHide={hideSidebar}
          />
        )
      }
      history={history}
      notes={notes}
      todo={todo}
      worktrees={worktrees}
      onHide={hideSidebar}
      onCreate={() => add()}
      renderTab={renderTab}
      onReorder={reorderTiles}
      away={away}
    />
  )
})
