import {
  Accessibility,
  Cursor,
  Feedback,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import {
  doneNotes,
  noteLimits,
  openNotes,
  todosLeft,
  type Note,
  type NoteChange,
} from "@novadeck/core/notes"
import { Checkbox } from "@novadeck/toolkit/Checkbox"
import { ConfirmDialog } from "@novadeck/toolkit/ConfirmDialog"
import { Markdown } from "@novadeck/toolkit/Markdown"
import { sidebarListClasses, sidebarRowClasses } from "@novadeck/toolkit/SidebarItem"
import { SubjectBar, SubjectDetail, SubjectName, SubjectSide } from "@novadeck/toolkit/SubjectBar"
import { Tooltip } from "@novadeck/toolkit/Tooltip"
import { ChevronRight, ListTodo, ListX, SquareCheck, StickyNote, Trash2 } from "lucide-react"
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react"

import {
  addWords,
  clearDoneWords,
  doneCount,
  fullWords,
  kindWords,
  movedWords,
  notesFull,
  unsavedWords,
  type NoteKind,
} from "./notes-rows"
import { panelLabels } from "./panel-labels"
import { SidebarPanel } from "./SidebarPanel"

// A row follows the pointer once it has moved a few pixels, so a click still edits it; the
// keyboard moves rows with Alt and the arrows instead, as Space is the checkbox's, so dnd-kit
// adds no keyboard sensor and none of its screen reader markup.
const sensors = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === "touch"
        ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
        : [new PointerActivationConstraints.Distance({ value: 6 })],
  }),
]
const transition = { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
const feedback = Feedback.configure({ dropAnimation: transition })
const cursor = Cursor.configure({ cursor: "grabbing" })

const panel = "#notes-panel"

// The controls of a row the keyboard stops at, which a move or a leaving row hands the focus
// between: its checkbox, its line, its details button and a done row's Delete.
type Part = "check" | "line" | "details" | "delete"

const rowOf = (id: string): HTMLElement | undefined =>
  Array.from(document.querySelectorAll<HTMLElement>(`${panel} [data-note]`)).find(
    (row) => row.dataset.note === id,
  )
const partOf = (row: HTMLElement | undefined, part: Part): HTMLElement | null =>
  row?.querySelector<HTMLElement>(`[data-part="${part}"]`) ??
  row?.querySelector<HTMLElement>("[data-part]") ??
  null
const addField = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(`${panel} .notes-add-input`)

// Whether the control that has the focus got it from the keyboard: a press of the pointer
// leaves the focus where the app puts it, and nothing here moves it on.
const keyboardHeld = (): boolean => {
  try {
    return document.activeElement?.matches(":focus-visible") ?? false
  } catch {
    // An engine that doesn't know the selector: the focus is followed, as the keyboard's.
    return true
  }
}

// Where the keyboard goes as a row leaves its list, where the row holds its focus: the same
// control of the row after it, else of the one before, else the add field.
const focusBeside = (id: string, part: Part): void => {
  const row = rowOf(id)
  if (!row?.contains(document.activeElement) || !keyboardHeld()) return
  const rows = Array.from(row.parentElement?.querySelectorAll<HTMLElement>("[data-note]") ?? [])
  const at = rows.indexOf(row)
  ;(partOf(rows[at + 1] ?? rows[at - 1], part) ?? addField())?.focus()
}

type Clearing = { readonly ids: readonly string[] }

const clearBar = ({ ids }: Clearing): React.JSX.Element => (
  <SubjectBar>
    <SubjectSide>
      <ListTodo size={14} strokeWidth={1.5} aria-hidden="true" />
      <SubjectName>{panelLabels.notes}</SubjectName>
    </SubjectSide>
    <SubjectDetail end>{doneCount(ids.length)}</SubjectDetail>
  </SubjectBar>
)

// The field a note's line is changed in: Enter saves, Escape cancels, and leaving it saves.
// An empty line keeps the old one.
const NoteLineInput = ({
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

// What is being changed of a note: its line, or its details.
type Editing = { readonly id: string; readonly part: "line" | "body" }

// A note still open: a todo's checkbox or a plain note's mark, its line, which a click
// edits and a drag moves, and a button that shows what is under it: its details as Markdown,
// and what else can be done with it.
const OpenRow = ({
  note,
  index,
  count,
  expanded,
  editing,
  onCheck,
  onEdit,
  onSaveLine,
  onSaveBody,
  onCancel,
  onToggle,
  onKind,
  onDelete,
  onStep,
}: {
  note: Note
  index: number
  count: number
  expanded: boolean
  editing: Editing["part"] | null
  onCheck: () => void
  onEdit: (part: Editing["part"]) => void
  onSaveLine: (text: string, keyboard: boolean) => void
  onSaveBody: (body: string, keyboard: boolean) => void
  onCancel: () => void
  onToggle: () => void
  onKind: () => void
  onDelete: () => void
  onStep: (by: -1 | 1, part: Part) => void
}): React.JSX.Element => {
  const { ref, handleRef, isDragSource } = useSortable({
    id: note.id,
    index,
    disabled: editing !== null,
    transition,
  })
  const bodyId = useId()
  return (
    <div
      ref={ref}
      role="listitem"
      className={`${sidebarRowClasses} notes-row flex-col${isDragSource ? " dragging" : ""}`}
      data-note={note.id}
      data-kind={note.todo ? "todo" : "note"}
      // Alt and the arrows move the row one place among the open ones, from any of its
      // controls but a field being typed in.
      onKeyDown={(event) => {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
        const part = (event.target as HTMLElement).dataset.part
        if (part !== "check" && part !== "line" && part !== "details") return
        event.preventDefault()
        const by = event.key === "ArrowUp" ? -1 : 1
        if (index + by < 0 || index + by >= count) return
        onStep(by, part)
      }}
    >
      <div className="notes-row-line flex min-w-0 items-start gap-2 py-2 pr-1.5 pl-2.5">
        {note.todo ? (
          <Checkbox
            className="mt-px"
            checked={false}
            onChange={onCheck}
            aria-label={note.text}
            data-part="check"
          />
        ) : (
          <span
            className="notes-row-mark mt-px flex size-4 shrink-0 items-center justify-center"
            aria-hidden="true"
          >
            <StickyNote size={14} strokeWidth={1.5} />
          </span>
        )}
        {editing === "line" ? (
          <NoteLineInput text={note.text} onSave={onSaveLine} onCancel={onCancel} />
        ) : (
          <button
            ref={handleRef}
            type="button"
            className="notes-row-text min-w-0 flex-1 text-left text-body leading-[18px]"
            data-part="line"
            aria-label={`Edit ${note.text}`}
            aria-keyshortcuts={
              [
                ...(index > 0 ? ["Alt+ArrowUp"] : []),
                ...(index < count - 1 ? ["Alt+ArrowDown"] : []),
              ].join(" ") || undefined
            }
            onClick={() => onEdit("line")}
          >
            {note.text}
          </button>
        )}
        <Tooltip content={expanded ? "Hide details" : note.body ? "Show details" : "Add details"}>
          <button
            type="button"
            className="notes-row-details icon-button small dim quiet"
            data-part="details"
            data-filled={note.body !== "" || undefined}
            aria-expanded={expanded}
            aria-controls={expanded ? bodyId : undefined}
            aria-label={`Details of ${note.text}`}
            onClick={onToggle}
          >
            <ChevronRight size={14} strokeWidth={1.6} />
          </button>
        </Tooltip>
      </div>
      {expanded && (
        <div
          id={bodyId}
          className="notes-row-body flex min-w-0 flex-col gap-2 pr-2.5 pb-2.5 pl-[34px]"
        >
          {editing === "body" ? (
            <NoteBodyInput body={note.body} onSave={onSaveBody} onCancel={onCancel} />
          ) : (
            <>
              {note.body !== "" && <Markdown text={note.body} />}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  type="button"
                  className="button link notes-row-edit px-0 text-caption"
                  onClick={() => onEdit("body")}
                >
                  {note.body ? "Edit details" : "Add details"}
                </button>
                <button
                  type="button"
                  className="button link notes-row-kind px-0 text-caption"
                  onClick={onKind}
                >
                  {note.todo ? "Make it a note" : "Make it a todo"}
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
      )}
    </div>
  )
}

// A todo that is checked off: unchecking it opens it again, and Delete removes it without
// asking.
const DoneRow = ({
  note,
  onReopen,
  onDelete,
}: {
  note: Note
  onReopen: () => void
  onDelete: () => void
}): React.JSX.Element => (
  <div
    role="listitem"
    className={`${sidebarRowClasses} notes-row flex-col`}
    data-note={note.id}
    data-done="true"
  >
    <div className="notes-row-line flex min-w-0 items-start gap-2 py-2 pr-1.5 pl-2.5">
      <Checkbox
        className="mt-px"
        checked
        onChange={onReopen}
        aria-label={note.text}
        data-part="check"
      />
      <span className="notes-row-text min-w-0 flex-1 text-body leading-[18px]">{note.text}</span>
      <Tooltip content="Delete · can’t be undone">
        <button
          type="button"
          className="notes-row-remove icon-button small dim quiet"
          data-part="delete"
          aria-label={`Delete ${note.text}`}
          onClick={onDelete}
        >
          <Trash2 size={14} strokeWidth={1.6} />
        </button>
      </Tooltip>
    </div>
  </div>
)

// The Notes panel: the open project's todos and plain notes, the person's own. A field at
// the top adds one, first in the list; the open ones follow in the person's order, each
// checked off, edited, moved or opened for its details; the todos checked off wait under
// Done, folded until asked for, until they are cleared.
export const NotesPanel = ({
  projectId,
  notes,
  failed,
  active,
  onClose,
  onAdd,
  onChange,
  onMove,
  onRemove,
}: {
  projectId: string
  // The project's notes, in the person's order.
  notes: readonly Note[]
  // The person's last change didn't take, and the notes are as they were.
  failed: boolean
  active: boolean
  onClose: () => void
  onAdd: (note: { text: string; todo: boolean }) => void
  onChange: (id: string, change: NoteChange) => void
  // To this place among the open notes.
  onMove: (id: string, index: number) => void
  onRemove: (ids: readonly string[]) => void
}): React.JSX.Element => {
  const open = useMemo(() => openNotes(notes, projectId), [notes, projectId])
  const done = useMemo(() => doneNotes(notes, projectId), [notes, projectId])
  const left = todosLeft(notes, projectId)
  const full = notesFull(open.length + done.length)
  const [kind, setKind] = useState<NoteKind>("todo")
  const [draft, setDraft] = useState("")
  const [editing, setEditing] = useState<Editing | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [doneOpen, setDoneOpen] = useState(false)
  const [clearing, setClearing] = useState<Clearing | null>(null)
  // The element that holds the open rows, which a drag stays within.
  const [list, setList] = useState<HTMLDivElement | null>(null)
  const modifiers = useMemo(() => [RestrictToElement.configure({ element: list })], [list])
  // dnd-kit moves the dragged row's element among its neighbours as it goes, and puts it back
  // only in some drags: every drag's end remounts the rows, so they are rebuilt from the
  // order.
  const [drags, setDrags] = useState(0)
  // Where a row went, for assistive technology, which dnd-kit's own markup would have said.
  const [moved, setMoved] = useState("")
  // The control that takes the focus once the rows have settled: a moved row's, as moving
  // its element among the others loses the focus it had, or the one a field gave way to.
  const [focusRequest, setFocusRequest] = useState<{ id: string; part: Part } | null>(null)
  useLayoutEffect(() => {
    if (!focusRequest) return undefined
    const take = (): void =>
      partOf(rowOf(focusRequest.id), focusRequest.part)?.focus({ preventScroll: true })
    take()
    const frame = requestAnimationFrame(() => {
      take()
      setFocusRequest(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest])
  const doneId = useId()

  const add = (): void => {
    if (draft.trim() === "" || full) return
    onAdd({ text: draft, todo: kind === "todo" })
    setDraft("")
  }
  const move = (note: Note, index: number, part: Part): void => {
    const to = Math.max(0, Math.min(open.length - 1, index))
    onMove(note.id, to)
    setMoved(movedWords(note.text, to, open.length))
    setFocusRequest({ id: note.id, part })
  }
  const toggle = (note: Note): void => {
    const opening = !expanded.has(note.id)
    setExpanded((current) => {
      const next = new Set(current)
      if (opening) next.add(note.id)
      else next.delete(note.id)
      return next
    })
    // With nothing under its line yet, opening it is asking to write some.
    if (opening && note.body === "") setEditing({ id: note.id, part: "body" })
    else if (editing?.id === note.id && editing.part === "body") setEditing(null)
  }
  return (
    <SidebarPanel
      id="notes-panel"
      title={panelLabels.notes}
      count={left === 0 ? "" : left}
      active={active}
      onClose={onClose}
    >
      <form
        className="field quiet notes-add flex h-9 shrink-0 items-center gap-1.5 pr-2 pl-1"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <Tooltip content={kindWords(kind)}>
          <button
            type="button"
            className="notes-add-kind icon-button small dim quiet"
            aria-label="Add as todos"
            aria-pressed={kind === "todo"}
            onClick={() => setKind(kind === "todo" ? "note" : "todo")}
          >
            {kind === "todo" ? (
              <SquareCheck size={14} strokeWidth={1.6} />
            ) : (
              <StickyNote size={14} strokeWidth={1.6} />
            )}
          </button>
        </Tooltip>
        <input
          className="field-input notes-add-input min-w-0 flex-1 text-control"
          aria-label={addWords(kind)}
          placeholder={addWords(kind)}
          autoComplete="off"
          enterKeyHint="done"
          maxLength={noteLimits.text}
          disabled={full}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </form>
      {full && (
        <p className="notes-empty" role="status">
          {fullWords}
        </p>
      )}
      {failed && (
        <p className="notes-empty" role="status">
          {unsavedWords}
        </p>
      )}
      <div className={`notes-scroll ${sidebarListClasses}`}>
        <div ref={setList} className="flex min-w-0 flex-col gap-1" role="list" aria-label="Notes">
          <DragDropProvider
            key={drags}
            sensors={sensors}
            modifiers={modifiers}
            plugins={(defaults) => [
              ...defaults.filter((plugin) => plugin !== Accessibility),
              feedback,
              cursor,
            ]}
            onDragEnd={(event) => {
              setDrags((count) => count + 1)
              const { source } = event.operation
              if (!isSortable(source)) return
              const note = open.find((each) => each.id === source.id)
              if (!note) return
              const held = source.element?.contains(document.activeElement) ?? false
              if (event.canceled || source.initialIndex === source.index) {
                if (held) setFocusRequest({ id: note.id, part: "line" })
                return
              }
              move(note, source.index, "line")
              if (!held) setFocusRequest(null)
            }}
          >
            {open.map((note, index) => (
              <OpenRow
                key={note.id}
                note={note}
                index={index}
                count={open.length}
                expanded={expanded.has(note.id)}
                editing={editing?.id === note.id ? editing.part : null}
                onCheck={() => {
                  focusBeside(note.id, "check")
                  onChange(note.id, { done: true })
                }}
                onEdit={(part) => setEditing({ id: note.id, part })}
                onSaveLine={(text, keyboard) => {
                  setEditing(null)
                  onChange(note.id, { text })
                  if (keyboard) setFocusRequest({ id: note.id, part: "line" })
                }}
                onSaveBody={(body, keyboard) => {
                  setEditing(null)
                  onChange(note.id, { body })
                  if (keyboard) setFocusRequest({ id: note.id, part: "details" })
                }}
                onCancel={() => {
                  setFocusRequest({
                    id: note.id,
                    part: editing?.part === "body" ? "details" : "line",
                  })
                  setEditing(null)
                }}
                onToggle={() => toggle(note)}
                onKind={() => {
                  // Its button goes, or changes its words: the keyboard stays on the row.
                  if (keyboardHeld()) setFocusRequest({ id: note.id, part: "details" })
                  onChange(note.id, { todo: !note.todo })
                }}
                onDelete={() => {
                  focusBeside(note.id, "line")
                  onRemove([note.id])
                }}
                onStep={(by, part) => move(note, index + by, part)}
              />
            ))}
          </DragDropProvider>
        </div>
        {open.length === 0 && (
          <p className="notes-empty" role="status">
            {done.length === 0
              ? "Todos and notes you write here stay with this project."
              : "Nothing left to do."}
          </p>
        )}
        {done.length > 0 && (
          <div className="notes-done flex min-w-0 shrink-0 flex-col gap-1">
            <div className="flex h-8 items-center justify-between gap-2 px-0.5">
              <button
                type="button"
                className="notes-done-toggle section-label flex min-w-0 items-center gap-1.5 text-label font-medium"
                aria-expanded={doneOpen}
                aria-controls={doneOpen ? doneId : undefined}
                onClick={() => setDoneOpen(!doneOpen)}
              >
                <ChevronRight size={14} strokeWidth={1.6} aria-hidden="true" />
                Done
                <span className="sidebar-panel-count">{done.length}</span>
              </button>
              <Tooltip content="Clear done">
                <button
                  type="button"
                  className="notes-clear icon-button small dim quiet"
                  aria-label="Clear done todos"
                  onClick={() => setClearing({ ids: done.map(({ id }) => id) })}
                >
                  <ListX size={14} strokeWidth={1.6} />
                </button>
              </Tooltip>
            </div>
            {doneOpen && (
              <div
                id={doneId}
                className="flex min-w-0 flex-col gap-1"
                role="list"
                aria-label="Done"
              >
                {done.map((note) => (
                  <DoneRow
                    key={note.id}
                    note={note}
                    onReopen={() => {
                      focusBeside(note.id, "check")
                      onChange(note.id, { done: false })
                    }}
                    onDelete={() => {
                      focusBeside(note.id, "delete")
                      onRemove([note.id])
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {moved}
      </span>
      <ConfirmDialog
        subject={clearing}
        bar={clearBar}
        title={() => "Clear done todos?"}
        description={(asked) => clearDoneWords(asked.ids.length)}
        confirmLabel="Clear done"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (clearing) onRemove(clearing.ids)
          setClearing(null)
        }}
        onCancel={() => setClearing(null)}
        returnFocus={() => document.querySelector<HTMLElement>(`${panel} .notes-clear`)}
        widthClassName="w-[min(360px,calc(100vw-32px))]"
      />
    </SidebarPanel>
  )
}
