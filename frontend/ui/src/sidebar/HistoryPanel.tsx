import type { AgentName } from "@novadeck/core/harnesses"
import type { ClosedTerminal } from "@novadeck/core/history"
import type { AgentConnection } from "@novadeck/core/port"
import { panelLabels } from "@novadeck/core/types"
import { ConfirmDialog } from "@novadeck/toolkit/ConfirmDialog"
import {
  sidebarListClasses,
  sidebarRowClasses,
  sidebarRowIconClasses,
  sidebarRowNameClasses,
  sidebarRowSelectClasses,
} from "@novadeck/toolkit/SidebarItem"
import { SubjectBar, SubjectDetail, SubjectName, SubjectSide } from "@novadeck/toolkit/SubjectBar"
import { Tooltip } from "@novadeck/toolkit/Tooltip"
import { History as HistoryIcon, ListX, Plug, RotateCcw, Search, Trash2 } from "lucide-react"
import { Fragment, useEffect, useId, useState, type ReactNode, memo } from "react"

import {
  agentName,
  clearWords,
  closedCount,
  closedFull,
  litPieces,
  removable,
  rowMatches,
  rowFolder,
  rowTooltip,
  rowView,
  summaryExcerpt,
  unremovedWords,
  type RowView,
  type Unremoved,
} from "./history-rows"
import { SidebarPanel } from "./SidebarPanel"

// A row's accessible name: what its click does, and for a row that does nothing, what it is.
const labelOf = (row: ClosedTerminal, view: RowView): string => {
  switch (view.state) {
    case "ready":
      return `Restore ${row.title}`
    case "open":
      return `Show ${row.title}, open as ${view.end.kind === "handle" ? view.end.text : ""}`
    case "restoring":
      return `${row.title}, restoring`
    case "gone":
      return `${row.title}, unavailable`
    case "disconnected":
      return `${row.title}, not connected`
  }
}

const Lit = ({ text, typed }: { text: string; typed: string }): React.JSX.Element => (
  <>
    {litPieces(text, typed).map((piece) =>
      piece.lit ? (
        <mark key={piece.at}>{piece.text}</mark>
      ) : (
        <Fragment key={piece.at}>{piece.text}</Fragment>
      ),
    )}
  </>
)

// What Clear asks about: the rows it takes, as they were when it was pressed, and how many
// stay because they are being restored.
type Clearing = { readonly rows: readonly ClosedTerminal[]; readonly staying: number }

const clearBar = ({ rows }: Clearing): React.JSX.Element => (
  <SubjectBar>
    <SubjectSide>
      <HistoryIcon size={14} strokeWidth={1.5} aria-hidden="true" />
      <SubjectName>{panelLabels.history}</SubjectName>
    </SubjectSide>
    <SubjectDetail end>{closedCount(rows.length)}</SubjectDetail>
  </SubjectBar>
)

const panel = "#history-panel"

// Where the keyboard goes from a row's Remove button, as its row leaves: the row after it,
// else the one before, else the panel's Hide button.
const focusBeside = (id: string): void => {
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`${panel} [data-history-row]`))
  const at = rows.findIndex((row) => row.dataset.historyRow === id)
  const beside = (rows[at + 1] ?? rows[at - 1])?.querySelector<HTMLElement>(".history-row-select")
  ;(beside ?? document.querySelector<HTMLElement>(`${panel} .sidebar-close`))?.focus()
}

// A row drawn as a terminal's tab: its icon and title, with when it closed at the end of the
// title's line, and under them the start of its summary, cut to where a search found it (a
// plain terminal's folder before it). Its handle isn't shown: a restore keeps it only where
// it is still free in the session. Under the pointer or focus, a row that can be
// restored shows the restore icon in its date's place, and every row but one being restored
// shows Remove after it, which deletes the row without asking.
const HistoryRow = ({
  row,
  view,
  typed,
  now,
  icon,
  onRestore,
  onReveal,
  onConnect,
  onRemove,
}: {
  row: ClosedTerminal
  view: RowView
  typed: string
  now: number
  icon: ReactNode
  onRestore: (row: ClosedTerminal) => void
  onReveal: (terminalId: string) => void
  onConnect: (agent: AgentName) => void
  // `keyboard` when the button was pressed with a key, so the focus it held moves on.
  onRemove: (row: ClosedTerminal, keyboard: boolean) => void
}): React.JSX.Element => {
  const descriptionId = useId()
  const folder = rowFolder(row)
  const { availability } = row
  const description = [
    view.reason,
    `Closed ${closedFull(row.closedAt, now)}${row.closedBy ? ` by @${row.closedBy}` : ""}`,
  ]
    .filter(Boolean)
    .join(". ")
  return (
    <div
      role="listitem"
      className={`${sidebarRowClasses} history-row`}
      data-state={view.state}
      data-history-row={row.id}
    >
      <Tooltip content={rowTooltip(row, view, now)} placement="right-start">
        <button
          type="button"
          className={`${sidebarRowSelectClasses} history-row-select`}
          aria-label={labelOf(row, view)}
          aria-describedby={descriptionId}
          aria-disabled={view.inert || undefined}
          onClick={() => {
            if (view.inert) return
            if (availability.state === "open") onReveal(availability.terminalId)
            else onRestore(row)
          }}
        >
          <span className={sidebarRowIconClasses}>{icon}</span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="history-row-line">
              <strong className={`${sidebarRowNameClasses()} min-w-0 flex-1`}>{row.title}</strong>
              <span className="history-row-end" data-end={view.end.kind}>
                {view.end.kind === "restoring" ? (
                  <span className="history-spinner" aria-hidden="true" />
                ) : (
                  <>
                    <span className="history-row-end-text">{view.end.text}</span>
                    {view.state === "ready" && (
                      <RotateCcw className="history-row-restore" size={14} strokeWidth={1.6} />
                    )}
                  </>
                )}
              </span>
            </span>
            {(folder || row.summary) && (
              <span className="history-row-detail">
                {folder && <span className="history-row-folder">{folder}</span>}
                {folder && row.summary && " "}
                {row.summary && <Lit text={summaryExcerpt(row.summary, typed)} typed={typed} />}
              </span>
            )}
          </span>
        </button>
      </Tooltip>
      <span id={descriptionId} hidden>
        {description}
      </span>
      {removable(row) && (
        <div className="history-row-actions">
          {view.connect && (
            <Tooltip content={`Connect ${agentName(view.connect)} in Preferences`}>
              <button
                type="button"
                className="history-row-connect icon-button small dim quiet"
                aria-label={`Connect ${agentName(view.connect)} in Preferences`}
                onClick={() => onConnect(view.connect!)}
              >
                <Plug size={14} strokeWidth={1.6} />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Remove · can’t be restored after">
            <button
              type="button"
              className="history-row-remove icon-button small dim quiet"
              aria-label={`Remove ${row.title} from History`}
              onClick={(event) => onRemove(row, event.detail === 0)}
            >
              <Trash2 size={14} strokeWidth={1.6} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

// The sidebar's History panel: the terminals closed in this project, newest first, with a
// search while there are any. The count beside the title is the matches over the total
// while searching. Clear, beside Hide while any row can be removed, deletes them all once
// its question is confirmed, whatever the search shows; a row's own Remove deletes just it.
const HistoryPanelView = ({
  rows,
  list,
  connections,
  iconOf,
  active,
  onClose,
  onRestore,
  onReveal,
  onConnect,
  onRemove,
}: {
  rows: readonly ClosedTerminal[]
  // Reads the project's rows afresh, with their availability checked; the rows follow.
  list: () => Promise<unknown>
  // The agents the backend can connect, where it has them.
  connections: readonly AgentConnection[] | undefined
  iconOf: (row: ClosedTerminal) => ReactNode
  active: boolean
  onClose: () => void
  onRestore: (row: ClosedTerminal) => void
  // Goes to the terminal that holds a conversation, by its handle.
  onReveal: (terminalId: string) => void
  onConnect: (agent: AgentName) => void
  // Deletes the rows of these ids for good; they leave `rows` as the backend reports them
  // gone. Rejects when it couldn't.
  onRemove: (ids: readonly string[]) => Promise<void>
}): React.JSX.Element => {
  const [typed, setTyped] = useState("")
  const [failed, setFailed] = useState(false)
  // What Clear's dialog asks about, and the removal that failed last.
  const [clearing, setClearing] = useState<Clearing | null>(null)
  const [unremoved, setUnremoved] = useState<Unremoved | null>(null)
  // Each goes with the rows it names, and a search with the last row: settled as the rows
  // change, during render.
  const [seen, setSeen] = useState(rows)
  if (seen !== rows) {
    setSeen(rows)
    const listed = (id: string): boolean => rows.some((row) => row.id === id)
    if (clearing && !clearing.rows.some((row) => listed(row.id))) setClearing(null)
    if (unremoved && (unremoved.kind === "row" ? !listed(unremoved.id) : rows.length === 0))
      setUnremoved(null)
    if (rows.length === 0) setTyped("")
  }
  // A panel shown again says nothing of a removal that failed before it was hidden.
  const [wasActive, setWasActive] = useState(active)
  if (wasActive !== active) {
    setWasActive(active)
    if (!active) setUnremoved(null)
  }
  // Asks the backend to delete rows. When it couldn't, they stay, and a line says so.
  const remove = (taken: readonly ClosedTerminal[], failure: Unremoved): void => {
    setUnremoved(null)
    onRemove(taken.map((row) => row.id)).catch(() => setUnremoved(failure))
  }
  // Rows say when they closed against the day it is, which is read when the panel opens.
  const [now, setNow] = useState(() => Date.now())
  // The rows are read when the panel opens, so what the runner checked is what shows.
  // And again when the window is looked at, as another window may have changed what a row needs.
  useEffect(() => {
    if (!active) return
    let current = true
    const read = (): void => {
      list().then(
        () => {
          if (!current) return
          setNow(Date.now())
          setFailed(false)
        },
        () => current && setFailed(true),
      )
    }
    read()
    window.addEventListener("focus", read)
    return () => {
      current = false
      window.removeEventListener("focus", read)
    }
  }, [active, list])
  const matches = rows.filter((row) => rowMatches(row, typed))
  const searching = typed.trim() !== ""
  const clearable = rows.filter(removable)
  return (
    <SidebarPanel
      id="history-panel"
      title={panelLabels.history}
      count={rows.length === 0 ? "" : searching ? `${matches.length}/${rows.length}` : rows.length}
      active={active}
      onClose={onClose}
      actions={
        clearable.length > 0 ? (
          <Tooltip content="Clear History">
            <button
              type="button"
              className="history-clear icon-button dim quiet size-7"
              aria-label="Clear History"
              onClick={() =>
                setClearing({ rows: clearable, staying: rows.length - clearable.length })
              }
            >
              <ListX size={14} strokeWidth={1.6} />
            </button>
          </Tooltip>
        ) : undefined
      }
    >
      {rows.length > 0 && (
        <label className="field quiet history-search flex h-9 shrink-0 items-center gap-2 px-2">
          <Search size={14} className="field-indicator shrink-0" aria-hidden="true" />
          <input
            type="search"
            className="field-input min-w-0 flex-1 text-control"
            aria-label="Find a closed terminal"
            placeholder="Find a closed terminal…"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
      )}
      {failed && (
        <p className="history-empty" role="status">
          Couldn’t read the closed terminals. This is what was last heard.
        </p>
      )}
      {unremoved && (
        <p className="history-empty" role="status">
          {unremovedWords(unremoved)}
        </p>
      )}
      <div
        className={`history-list ${sidebarListClasses}`}
        role="list"
        aria-label="Closed terminals"
      >
        {matches.map((row) => (
          <HistoryRow
            key={row.id}
            row={row}
            view={rowView(row, now, connections)}
            typed={typed}
            now={now}
            icon={iconOf(row)}
            onRestore={onRestore}
            onReveal={onReveal}
            onConnect={onConnect}
            onRemove={(taken, keyboard) => {
              if (keyboard) focusBeside(taken.id)
              remove([taken], { kind: "row", id: taken.id, title: taken.title })
            }}
          />
        ))}
        {matches.length === 0 && (
          <p className="history-empty" role="status">
            {rows.length === 0
              ? "Terminals you close show up here, so you can bring them back."
              : `No closed terminal matches “${typed.trim()}”.`}
          </p>
        )}
      </div>
      <ConfirmDialog
        subject={clearing}
        bar={clearBar}
        title={() => "Clear History?"}
        description={(asked) => clearWords(asked.rows.length, asked.staying)}
        confirmLabel="Clear History"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (clearing) remove(clearing.rows, { kind: "clear" })
          setClearing(null)
        }}
        onCancel={() => setClearing(null)}
        returnFocus={() => document.querySelector<HTMLElement>(`${panel} .history-clear`)}
        widthClassName="w-[min(360px,calc(100vw-32px))]"
      />
    </SidebarPanel>
  )
}

// Drawn again only as its own props change: the sidebar keeps every panel mounted.
export const HistoryPanel = memo(HistoryPanelView)
