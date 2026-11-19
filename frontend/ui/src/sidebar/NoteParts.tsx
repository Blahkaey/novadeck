import type { AgentName } from "@novadeck/core/harnesses"
import { noteLimits, type Note, type NoteAuthor } from "@novadeck/core/notes"
import { AntigravityIcon } from "@novadeck/toolkit/icons/AntigravityIcon"
import { ClaudeIcon } from "@novadeck/toolkit/icons/ClaudeIcon"
import { CodexIcon } from "@novadeck/toolkit/icons/CodexIcon"
import { Markdown } from "@novadeck/toolkit/Markdown"
import { Tooltip } from "@novadeck/toolkit/Tooltip"
import { ChevronRight, type LucideIcon } from "lucide-react"
import { useLayoutEffect, useRef, useState, type RefObject } from "react"

import { addedByWords } from "./notes-rows"

// The pieces the Notes panel and the Todo board draw a note with: the fields its line and its
// details are changed in, the mark of the agent that added it, the button that opens what is
// under its line and what that shows, and where the keyboard goes as rows move and leave.

// The field a note's line is changed in: Enter saves, Escape cancels, and leaving it saves.
// An empty line keeps the old one.
export const NoteLineInput = ({
  text,
  onSave,
  onCancel,
}: {
  text: string
  // `keyboard` where a key ended it, so the row takes the focus back.
  onSave: (text: string, keyboard: boolean) => void
  onCancel: () => void
}): React.JSX.Element => {
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(text)
  // A key already answered for the field, so its blur as it goes says nothing more.
  const ended = useRef(false)
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true })
    input.current?.select()
  }, [])
  return (
    <input
      ref={input}
      aria-label="Note text"
      value={value}
      maxLength={noteLimits.text}
      autoComplete="off"
      className="notes-line-input min-w-0 flex-1 text-body leading-[18px]"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
        if (event.key !== "Enter" && event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        ended.current = true
        if (event.key === "Enter") onSave(value, true)
        else onCancel()
      }}
      onBlur={() => {
        if (!ended.current) onSave(value, false)
      }}
    />
  )
}

// The field a note's details are written in, as Markdown: Enter with ⌘ or Ctrl saves, Escape
// cancels, and leaving it saves.
const NoteBodyInput = ({
  body,
  onSave,
  onCancel,
}: {
  body: string
  onSave: (body: string, keyboard: boolean) => void
  onCancel: () => void
}): React.JSX.Element => {
  const input = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState(body)
  const ended = useRef(false)
  useLayoutEffect(() => {
    const field = input.current
    field?.focus({ preventScroll: true })
    field?.setSelectionRange(field.value.length, field.value.length)
  }, [])
  return (
    <textarea
      ref={input}
      aria-label="Details"
      placeholder="Details, in Markdown…"
      value={value}
      maxLength={noteLimits.body}
      // As tall as what it holds, between three lines and twelve.
      rows={Math.min(12, Math.max(3, value.split("\n").length + 1))}
      className="field notes-body-input w-full min-w-0 px-2 py-1.5 text-control"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
        const save = event.key === "Enter" && (event.metaKey || event.ctrlKey)
        if (!save && event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        ended.current = true
        if (save) onSave(value, true)
        else onCancel()
      }}
      onBlur={() => {
        if (!ended.current) onSave(value, false)
      }}
    />
  )
}

// Each agent's icon, as its terminal's tab shows it.
const agentIcons: Readonly<Record<AgentName, LucideIcon>> = {
  claude: ClaudeIcon,
  codex: CodexIcon,
  agy: AntigravityIcon,
}

// The mark at the end of a note an agent added: its agent's icon, which names the agent and
// its terminal's handle.
export const AddedBy = ({ by }: { by: NoteAuthor }): React.JSX.Element => {
  const Icon = agentIcons[by.agent]
  const words = addedByWords(by)
  return (
    <Tooltip content={words}>
      <span
        className="notes-row-by mt-px flex size-4 shrink-0 items-center justify-center"
        role="img"
        aria-label={words}
      >
        <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
      </span>
    </Tooltip>
  )
}

// The chevron at the end of a note's line, which opens what is under it: `body` names the
// element it opens.
export const NoteDetailsButton = ({
  note,
  expanded,
  body,
  onToggle,
}: {
  note: Note
  expanded: boolean
  body: string
  onToggle: () => void
}): React.JSX.Element => (
  <Tooltip content={expanded ? "Hide details" : note.body ? "Show details" : "Add details"}>
    <button
      type="button"
      className="notes-row-details icon-button small dim quiet"
      data-part="details"
      data-filled={note.body !== "" || undefined}
      aria-expanded={expanded}
      aria-controls={expanded ? body : undefined}
      aria-label={`Details of ${note.text}`}
      onClick={onToggle}
    >
      <ChevronRight size={14} strokeWidth={1.6} />
    </button>
  </Tooltip>
)

// What is under an open note's line: its details as Markdown, or the field they are written
// in, over what else can be done with it: change its details, make it the other kind (`kind`
// names that), and delete it.
export const NoteDetails = ({
  id,
  note,
  editing,
  kind,
  onEdit,
  onSave,
  onCancel,
  onKind,
  onDelete,
}: {
  id: string
  note: Note
  // Its details are being written.
  editing: boolean
  kind: string
  onEdit: () => void
  onSave: (body: string, keyboard: boolean) => void
  onCancel: () => void
  onKind: () => void
  onDelete: () => void
}): React.JSX.Element => (
  <div id={id} className="notes-row-body flex min-w-0 flex-col gap-2 pr-2.5 pb-2.5 pl-[34px]">
    {editing ? (
      <NoteBodyInput body={note.body} onSave={onSave} onCancel={onCancel} />
    ) : (
      <>
        {note.body !== "" && <Markdown text={note.body} />}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            className="button link notes-row-edit px-0 text-caption"
            onClick={onEdit}
          >
            {note.body ? "Edit details" : "Add details"}
          </button>
          <button
            type="button"
            className="button link notes-row-kind px-0 text-caption"
            onClick={onKind}
          >
            {kind}
          </button>
          <button
            type="button"
            className="button link notes-row-delete px-0 text-caption"
            aria-label={`Delete ${note.text}`}
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      </>
    )}
  </div>
)

// What is being changed of a note: its line, or its details.
export type Editing = { readonly id: string; readonly part: "line" | "body" }

// Which notes show what is under their line, and which one is being changed. Opening a note
// with nothing under its line yet is asking to write some.
export const useNoteEditing = (): {
  editing: Editing | null
  setEditing: (editing: Editing | null) => void
  expanded: ReadonlySet<string>
  toggle: (note: Note) => void
} => {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const toggle = (note: Note): void => {
    const opening = !expanded.has(note.id)
    setExpanded((current) => {
      const next = new Set(current)
      if (opening) next.add(note.id)
      else next.delete(note.id)
      return next
    })
    if (opening && note.body === "") setEditing({ id: note.id, part: "body" })
    else if (editing?.id === note.id && editing.part === "body") setEditing(null)
  }
  return { editing, setEditing, expanded, toggle }
}

// The controls of a row the keyboard stops at, which a move or a leaving row hands the focus
// between: its checkbox, its line, its details button, its Move menu and a Delete.
export type Part = "check" | "line" | "details" | "move" | "delete"

// A note's row under `root`, by its `data-note`.
export const rowOf = (root: HTMLElement | null, id: string): HTMLElement | undefined =>
  Array.from(root?.querySelectorAll<HTMLElement>("[data-note]") ?? []).find(
    (row) => row.dataset.note === id,
  )

// A row's `part`, or its first control the keyboard stops at where it has none such.
const partOf = (row: HTMLElement | undefined, part: Part): HTMLElement | null =>
  row?.querySelector<HTMLElement>(`[data-part="${part}"]`) ??
  row?.querySelector<HTMLElement>("[data-part]") ??
  null

// Whether the control that has the focus got it from the keyboard: a press of the pointer
// leaves the focus where the app puts it, and nothing here moves it on.
export const keyboardHeld = (): boolean => {
  try {
    return document.activeElement?.matches(":focus-visible") ?? false
  } catch {
    // An engine that doesn't know the selector: the focus is followed, as the keyboard's.
    return true
  }
}

// Where the keyboard goes as rows settle under `root`: `request` gives a row's control the
// focus once it has settled in its place, as moving its element among the others loses the
// focus it had; `beside` hands it, as a row leaves its list where it holds the focus, to the
// same control of the row after it, else of the one before, else to `fallback`.
export const useRowFocus = (
  root: RefObject<HTMLElement | null>,
): {
  request: (id: string, part: Part) => void
  beside: (id: string, part: Part, fallback: () => HTMLElement | null) => void
} => {
  const [asked, setAsked] = useState<{ id: string; part: Part } | null>(null)
  useLayoutEffect(() => {
    if (!asked) return undefined
    const take = (): void => partOf(rowOf(root.current, asked.id), asked.part)?.focus()
    take()
    const frame = requestAnimationFrame(() => {
      take()
      setAsked(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [asked, root])
  const beside = (id: string, part: Part, fallback: () => HTMLElement | null): void => {
    const row = rowOf(root.current, id)
    if (!row?.contains(document.activeElement) || !keyboardHeld()) return
    const rows = Array.from(row.parentElement?.querySelectorAll<HTMLElement>("[data-note]") ?? [])
    const at = rows.indexOf(row)
    ;(partOf(rows[at + 1] ?? rows[at - 1], part) ?? fallback())?.focus()
  }
  return { request: (id, part) => setAsked({ id, part }), beside }
}
