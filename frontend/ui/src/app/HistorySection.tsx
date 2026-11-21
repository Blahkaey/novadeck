import type { ClosedTerminal, History } from "@novadeck/core/history"
import { useCallback, useSyncExternalStore } from "react"

import { HistoryPanel } from "../sidebar/HistoryPanel"
import { programIcon } from "../terminals/processes/profiles"
import { useWorkspaceServices, useWorkspaceState } from "./controller/context"
import { useStoreSelector } from "./controller/useStoreSelector"
import { usePanelOpen, usePanelShowing } from "./panels-shown"

const noAgents: readonly never[] = []
const always = (): (() => void) => () => {}

const sameRows = (a: readonly ClosedTerminal[], b: readonly ClosedTerminal[]): boolean =>
  a.length === b.length && a.every((row, index) => Object.is(row, b[index]))

// A closed terminal's icon: its agent's, or its last program's, or a plain terminal's.
const historyIcon = (row: ClosedTerminal): React.JSX.Element => {
  const Icon = programIcon(row.agent ?? row.program ?? "")
  return <Icon size={14} strokeWidth={1.5} />
}

// The History panel, wired to where the backend keeps closed terminals: this project's rows,
// which a row's click restores or goes to.
export const HistorySection = ({ history }: { readonly history: History }): React.JSX.Element => {
  const { commands, backend } = useWorkspaceServices()
  const projectId = useWorkspaceState((workspace) => workspace.activeProjectId)
  const rows = useStoreSelector(
    history.state,
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
  const list = useCallback(() => {
    refreshAgents?.()
    return history.list(projectId)
  }, [history, projectId, refreshAgents])
  const onReveal = useCallback(
    (terminalId: string) => commands.revealTerminal(terminalId, projectId),
    [commands, projectId],
  )
  const active = usePanelOpen("history")
  const showing = usePanelShowing("history")
  return (
    <HistoryPanel
      key={projectId}
      rows={rows}
      list={list}
      connections={backend.agents ? connections : undefined}
      iconOf={historyIcon}
      onRestore={commands.restoreClosed}
      onReveal={onReveal}
      onConnect={commands.openAgentSettings}
      onRemove={history.remove}
      active={active}
      showing={showing}
      onClose={commands.hideSidebar}
    />
  )
}
