import type { ForgeConnection } from "@novadeck/core/forges"
import { itemIdOf } from "@novadeck/core/items"
import { createStore } from "@novadeck/core/store"
import { handleText } from "@novadeck/core/terminals/handle"
import type { Work, Works, WorksState } from "@novadeck/core/works"
import { useCallback, useMemo } from "react"

import { projectPath } from "../sidebar/files-works"
import { WorktreesPanel } from "../sidebar/WorktreesPanel"
import { useWorkspaceServices, useWorkspaceState } from "./controller/context"
import { useStoreSelector } from "./controller/useStoreSelector"
import { copyOf, sameWorks } from "./files-feed"
import { usePanelOpen, usePanelShowing } from "./panels-shown"
import { currentState } from "./selectors"

// What a backend without forges reads in their place.
const noForges = createStore<readonly ForgeConnection[]>([])

const sameNames = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean =>
  a.size === b.size && [...a].every(([id, name]) => b.get(id) === name)

// The Worktrees panel, wired to where the backend reports the terminals' work: the open
// project's works, each shown on its owner's bar.
export const WorktreesSection = ({ works }: { readonly works: Works }): React.JSX.Element => {
  const { commands, backend } = useWorkspaceServices()
  const projectId = useWorkspaceState((workspace) => workspace.activeProjectId)
  // Every project's works, for a file of a work to open from the project's own copy.
  const allWorks = useStoreSelector(works.state, (state) => state.works, sameWorks)
  // The open project's works: the panel lists only these.
  const ofProject = useCallback(
    (state: WorksState) => state.works.filter((work) => work.projectId === projectId),
    [projectId],
  )
  const projectWorks = useStoreSelector(works.state, ofProject, sameWorks)
  const reported = useStoreSelector(works.state, (state) => state.reported)
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
    sameNames,
  )
  // Handles of every project's terminals, as people see them, for the rows to say whose they are.
  const handles = useWorkspaceState(
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
    sameNames,
  )
  // Whether pull requests are looked for: a forge is on and its tool installed. A backend without
  // forges (a demo's) has its works say so themselves.
  const forges = useStoreSelector(backend.forges?.state ?? noForges, (each) =>
    backend.forges ? each.some((forge) => forge.enabled && forge.available) : true,
  )
  const { fetch } = works
  const onFetch = useMemo(() => (fetch ? () => fetch(projectId) : undefined), [fetch, projectId])
  const selectedId = useWorkspaceState((workspace) => currentState(workspace).selected)
  const { revealTerminal, openBarTab } = commands
  // A work is shown on the bar of the terminal the panel names (its owner's, or the selected
  // terminal's where it has none or its owner is closed). A failure reaches the panel.
  const onSelect = useCallback(
    async (work: Work, terminalId: string | undefined): Promise<void> => {
      if (terminalId === undefined) return
      revealTerminal(terminalId, projectId)
      const itemId = await works.show(work.root, terminalId)
      if (itemId !== null) openBarTab(terminalId, itemIdOf(itemId))
    },
    [works, revealTerminal, openBarTab, projectId],
  )
  // A file of a work, opened in the project window as a preview: only a file that main has (the
  // window shows main's checkout, which it can only point at).
  const inOpenProject = useCallback(
    (work: Work, path: string): string | undefined =>
      work.folder === undefined ? undefined : projectPath(work.folder, path),
    [],
  )
  const canOpenFile = useCallback(
    (work: Work, path: string): boolean => inOpenProject(work, path) !== undefined,
    [inOpenProject],
  )
  const onOpenFile = useCallback(
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
  const active = usePanelOpen("worktrees")
  const showing = usePanelShowing("worktrees")
  return (
    <WorktreesPanel
      works={projectWorks}
      reported={reported}
      watch={works.watch}
      titles={titles}
      selectedId={selectedId}
      onSelect={onSelect}
      canOpenFile={canOpenFile}
      onOpenFile={onOpenFile}
      onCloseWork={works.close}
      handles={handles}
      forges={forges}
      {...(onFetch ? { onFetch } : {})}
      active={active}
      showing={showing}
      onClose={commands.hideSidebar}
    />
  )
}
