import { inboxType, rowKey, type InboxRow } from "@novadeck/core/inbox"
import { HandleChip } from "@novadeck/toolkit/HandleChip"
import { isElement } from "@novadeck/toolkit/realm"
import { Sheet } from "@novadeck/toolkit/Sheet"
import { Tooltip } from "@novadeck/toolkit/Tooltip"
import { ArrowLeft, Bell, BellOff, Check, Terminal, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { ConsoleSheet, type SheetContentProps } from "./ConsoleSheet"
import { nextRowButton, rowOf, sheetControls } from "./inbox-dom"
import { iconKey, icons, tintOf } from "./inbox-icons"
import { asks } from "./inbox-state"
import { tagOf } from "./inbox-tag"
import { useInboxContext, type Receipt } from "./InboxProvider"
import { Text } from "./sheet-parts"

// What the sheet sits within, in `page`, the document the Inbox is in: the whole workspace, the
// sidebar with it, so the sheet starts over the sidebar's gutter, clear of a window's border
// beside it; in the Inbox's window of its own, that window.
const within = (page: Document): HTMLElement =>
  page.querySelector<HTMLElement>(".workspace-panels") ?? page.body

// What the workspace behind the sheet is, which steps back while it is read.
const behind = (): HTMLElement | null => document.querySelector<HTMLElement>(".workspace-main-pane")

// The kind of message, before any of it is read: the row's icon and tint, and one word.
const KindTag = ({ row }: { readonly row: InboxRow }): React.JSX.Element => {
  const tag = tagOf(row)
  const Icon = icons[iconKey(row)]
  return (
    <span className="console-tag" data-tint={tag.tint}>
      <Icon size={12} strokeWidth={2} aria-hidden />
      {tag.word}
    </span>
  )
}

// What the last answer did, on the sheet it moved on to: fading back after a moment. Where
// that answer turns out not to have arrived, it says so, and the way back to it.
const ReceiptLine = ({ receipt }: { readonly receipt: Receipt }): React.JSX.Element => {
  const { state, open } = useInboxContext()
  const failed = state.failed[receipt.from]
  if (failed)
    return (
      <div className="console-receipt" data-failed="true" role="alert">
        <span>{failed}</span>
        <button
          type="button"
          className="button link inbox-link text-control"
          onClick={() => open(receipt.from)}
        >
          Back to it
        </button>
      </div>
    )
  return (
    <div className="console-receipt" role="status">
      <Check size={12} aria-hidden />
      <Text text={receipt.note} />
    </div>
  )
}

// One row's sheet: its head, then its page.
const SheetBody = ({ row }: { readonly row: InboxRow }): React.JSX.Element => {
  const { state, sent, phone, receipt, close, submit, change, reveal, snooze, page } =
    useInboxContext()
  const answered = sent[row.id]
  const failed = state.failed[row.id]
  const present = state.items.some((each) => each.id === row.id)
  const unavailable = row.kind === "ask" && failed !== undefined && !present
  // An answer that didn't take is no answer.
  const confirmed =
    failed === undefined && !state.answering[row.id] && !present ? answered : undefined
  const content: SheetContentProps = {
    row,
    sent: confirmed,
    answering: Boolean(state.answering[row.id]) || unavailable,
    failed,
    submit: (answer, note) => submit(row, answer, note),
    change: (answer) => change(row, answer),
    reveal: () => reveal(row),
  }
  const { source } = row
  const leave = phone ? "Back to the Inbox" : "Close"
  return (
    <div
      className="inbox-sheet console"
      data-type={inboxType(row)}
      data-tint={tintOf(row)}
      data-state={row.settled ? "settled" : confirmed ? "answered" : "asking"}
      // Tab leaves the sheet the way it came: back to its row from the first control, and on
      // to the row after it from the last, so keyboard focus never falls out to the workspace.
      onKeyDown={(event) => {
        if (event.key !== "Tab" || phone) return
        const controls = sheetControls(event.currentTarget)
        const head = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(".inbox-sheet-head button"),
        )
        // Tab order inside the sheet is the head, then its page.
        const order = [...head, ...controls]
        const active = event.currentTarget.ownerDocument.activeElement
        if (
          event.shiftKey &&
          (active === order[0] || active?.classList.contains("inbox-sheet-title"))
        ) {
          event.preventDefault()
          rowOf(row.id, page)?.querySelector<HTMLElement>(".inbox-row-select")?.focus()
        } else if (!event.shiftKey && active === order.at(-1)) {
          const following = nextRowButton(row.id, page)
          // With no row after it, Tab goes on past the list and the sheet closes.
          if (following) {
            event.preventDefault()
            following.focus()
          } else close()
        }
      }}
    >
      <header className="inbox-sheet-head console-head">
        <KindTag row={row} />
        <span className="console-crumb">
          <span className="console-project">{source.projectName}</span>
          <span className="console-sep" aria-hidden="true">
            /
          </span>
          <h2 className="inbox-sheet-title" tabIndex={-1}>
            {source.title}
          </h2>
        </span>
        <HandleChip handle={source.handle} />
        <span className="console-grow" />
        {snooze && asks(row) && present && !state.answering[row.id] && !answered ? (
          <Tooltip content={row.snoozed ? "Unsnooze · S" : "Snooze · S"}>
            <button
              type="button"
              className="icon-button dim size-7"
              aria-label={row.snoozed ? "Unsnooze" : "Snooze"}
              onClick={() => snooze(row, !row.snoozed)}
            >
              {row.snoozed ? (
                <Bell size={14} strokeWidth={1.6} />
              ) : (
                <BellOff size={14} strokeWidth={1.6} />
              )}
            </button>
          </Tooltip>
        ) : null}
        <Tooltip content="Show terminal">
          <button
            type="button"
            className="icon-button dim size-7"
            aria-label="Show terminal"
            onClick={content.reveal}
          >
            <Terminal size={14} strokeWidth={1.6} />
          </button>
        </Tooltip>
        <Tooltip content={leave}>
          <button
            type="button"
            className="icon-button dim size-7"
            aria-label={leave}
            onClick={close}
          >
            {phone ? <ArrowLeft size={14} strokeWidth={1.6} /> : <X size={14} strokeWidth={1.6} />}
          </button>
        </Tooltip>
      </header>
      {receipt && receipt.from !== row.id && <ReceiptLine receipt={receipt} />}
      <ConsoleSheet {...content} />
    </div>
  )
}

// The open row's sheet: beside its row, in the window the Inbox is in, or on a screen of its own.
// `active` is whether the Inbox's panel is in sight; `over` whether the sheet opens over the
// workspace, from the Inbox in the sidebar, which steps back behind it: from a window on the
// stage it would step back with the Inbox's own window, and from one of its own it is elsewhere.
export const InboxSheet = ({
  active,
  over,
}: {
  readonly active: boolean
  readonly over: boolean
}): React.JSX.Element | null => {
  const { view, current, phone, close, shown, page } = useInboxContext()
  // What it last showed, which it keeps while it closes.
  const [last, setLast] = useState(current)
  if (current && current !== last) setLast(current)
  const row = current ?? last
  const open = view.open !== null && current !== undefined && (phone || active)
  // With the list out of sight there is no row for a sheet to sit beside.
  useEffect(() => {
    if (!active && !phone) close()
  }, [active, phone, close])
  // The workspace steps back while a sheet is read over it, and is still live: a click in
  // it closes the sheet.
  useEffect(() => {
    behind()?.setAttribute("data-inbox-reading", String(open && !phone && over))
  }, [open, phone, over])
  useEffect(() => () => behind()?.removeAttribute("data-inbox-reading"), [])
  // On a screen of its own, focus goes into it as it opens.
  const screen = useRef<HTMLDivElement>(null)
  const opened = phone && open
  useEffect(() => {
    if (!opened) return
    // The page behind goes inert, so focus stays in the sheet; it comes back on closing.
    const workspace = document.querySelector<HTMLElement>("main.workspace")
    if (workspace) workspace.inert = true
    screen.current?.focus()
    return () => {
      if (workspace) workspace.inert = false
    }
  }, [opened])
  if (!row) return null
  if (phone)
    return open ? (
      <div
        ref={screen}
        className="inbox-fullscreen"
        role="dialog"
        aria-modal="true"
        aria-label={row.source.title}
        tabIndex={-1}
      >
        <SheetBody key={rowKey(row)} row={row} />
      </div>
    ) : null
  return (
    <Sheet
      label={row.source.title}
      open={open}
      page={page}
      anchor={() => rowOf(row.id, page)}
      boundary={() => within(page)}
      // Out of the sidebar its rows may span the window, with no room beside them.
      overlap={!over}
      anchorKey={row.id}
      placeKey={String(shown.findIndex(({ id }) => id === row.id))}
      onDismiss={close}
      // A press on one of the list's buttons is the list's own: a row opens its row, or closes
      // the sheet when it is the open one. So is one on the held pill, which a window on the
      // stage draws in its header (`.panel-window-extra`), and one on a list that scrolls, which
      // is its scrollbar being dragged. Anywhere else in the sidebar closes it, as outside does.
      // The demo's debug drawer is where rows arrive from, and is not the workspace.
      onInteractOutside={(event) => {
        const { target } = event
        if (!isElement(target)) return
        const scrolling =
          target.matches("#inbox-panel .inbox-list") && target.scrollHeight > target.clientHeight
        const ours = "#inbox-panel button, .panel-window-extra button, .debug-drawer"
        if (scrolling || target.closest(ours)) event.preventDefault()
      }}
    >
      <SheetBody key={rowKey(row)} row={row} />
    </Sheet>
  )
}
