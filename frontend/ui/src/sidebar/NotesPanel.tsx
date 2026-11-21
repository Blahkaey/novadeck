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
import { plainNotes, noteLimits, type Note, type NoteChange } from "@novadeck/core/notes"
import { panelLabels } from "@novadeck/core/types"
import { sidebarListClasses, sidebarRowClasses } from "@novadeck/toolkit/SidebarItem"
import { StickyNote } from "lucide-react"
import { useId, useMemo, useRef, useState } from "react"

import { indexSpot, stepSpot, type Spot } from "./note-order"
import {
  AddedBy,
  NoteDetails,
  NoteDetailsButton,
  NoteLineInput,
  useNoteEditing,
  useRowFocus,
  type Editing,
  type Part,
} from "./NoteParts"
import { fullWords, movedWords, notesFull, unsavedWords } from "./notes-rows"
import { SidebarPanel } from "./SidebarPanel"

// A row follows the pointer once it has moved a few pixels, so a click still edits it; the
// keyboard moves rows with Alt and the arrows instead, so dnd-kit adds no keyboard sensor and
// none of its screen reader markup.
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

// A plain note: its mark, its line, which a click edits and a drag moves, the agent's mark
// where an agent added it, and a button that shows what is under it: its details as Markdown,
// and what else can be done with it.
const NoteRow = ({
  note,
  index,
  count,
  expanded,
  editing,
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
      // Alt and the arrows move the row one place, from its line or its details button.
      onKeyDown={(event) => {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
        const part = (event.target as HTMLElement).dataset.part
        if (part !== "line" && part !== "details") return
        event.preventDefault()
        onStep(event.key === "ArrowUp" ? -1 : 1, part)
      }}
    >
      <div className="notes-row-line flex min-w-0 items-start gap-2 py-2 pr-1.5 pl-2.5">
        <span
          className="notes-row-mark mt-px flex size-4 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          <StickyNote size={14} strokeWidth={1.5} />
        </span>
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
        {note.by && <AddedBy by={note.by} />}
        <NoteDetailsButton note={note} expanded={expanded} body={bodyId} onToggle={onToggle} />
      </div>
      {expanded && (
        <NoteDetails
          id={bodyId}
          note={note}
          editing={editing === "body"}
          kind="Make it a todo"
          onEdit={() => onEdit("body")}
          onSave={onSaveBody}
          onCancel={onCancel}
          onKind={onKind}
          onDelete={onDelete}
        />
      )}
    </div>
  )
}

// The Notes panel: the open project's plain notes, the person's own and those an agent added
// as they asked it to, in the person's order. A field at the top adds one, first in the list;
// each is edited, moved, opened for its details, made a todo (which goes to the Todo board) or
// deleted.
export const NotesPanel = ({
  projectId,
  notes,
  failed,
  active,
  onClose,
  onAdd,
  onChange,
  onPlace,
  onRemove,
}: {
  projectId: string
  // The project's notes, todos among them, in the person's order.
  notes: readonly Note[]
  // The person's last change didn't take, and the notes are as they were.
  failed: boolean
  active: boolean
  onClose: () => void
  // Adds a plain note with these words.
  onAdd: (text: string) => void
  onChange: (id: string, change: NoteChange) => void
  // Puts a plain note before another (null: last).
  onPlace: (id: string, before: string | null) => void
  onRemove: (ids: readonly string[]) => void
}): React.JSX.Element => {
  const plain = useMemo(() => plainNotes(notes, projectId), [notes, projectId])
  const ids = useMemo(() => plain.map(({ id }) => id), [plain])
  const full = notesFull(notes.filter((note) => note.projectId === projectId).length)
  const [draft, setDraft] = useState("")
  const { editing, setEditing, expanded, toggle } = useNoteEditing()
  const root = useRef<HTMLDivElement>(null)
  const focus = useRowFocus(root)
  const addField = (): HTMLElement | null =>
    root.current?.querySelector<HTMLElement>(".notes-add-input") ?? null
  // The element that holds the rows, which a drag stays within.
  const [list, setList] = useState<HTMLDivElement | null>(null)
  const modifiers = useMemo(() => [RestrictToElement.configure({ element: list })], [list])
  // dnd-kit moves the dragged row's element among its neighbours as it goes, and puts it back
  // only in some drags: every drag's end remounts the rows, so they are rebuilt from the
  // order.
  const [drags, setDrags] = useState(0)
  // Where a row went, for assistive technology, which dnd-kit's own markup would have said.
  const [moved, setMoved] = useState("")

  const add = (): void => {
    if (draft.trim() === "" || full) return
    onAdd(draft)
    setDraft("")
  }
  // Moves a note to its spot, and gives its `part` the focus back where one held it.
  const move = (note: Note, spot: Spot, part: Part | null): void => {
    onPlace(note.id, spot.before)
    setMoved(movedWords(note.text, spot.index, plain.length))
    if (part) focus.request(note.id, part)
  }
  return (
    <SidebarPanel
      id="notes-panel"
      title={panelLabels.notes}
      count={plain.length === 0 ? "" : plain.length}
      active={active}
      onClose={onClose}
    >
      <div ref={root} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <form
          className="field quiet notes-add flex h-9 shrink-0 items-center gap-1.5 pr-2 pl-2.5"
          onSubmit={(event) => {
            event.preventDefault()
            add()
          }}
        >
          <input
            className="field-input notes-add-input min-w-0 flex-1 text-control"
            aria-label="Add a note…"
            placeholder="Add a note…"
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
          <div
            ref={setList}
            className="flex min-w-0 flex-col gap-1"
            role="list"
            aria-label={panelLabels.notes}
          >
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
                const note = plain.find((each) => each.id === source.id)
                if (!note) return
                const held = source.element?.contains(document.activeElement) ?? false
                const spot = event.canceled ? undefined : indexSpot(ids, note.id, source.index)
                if (!spot) {
                  if (held) focus.request(note.id, "line")
                  return
                }
                move(note, spot, held ? "line" : null)
              }}
            >
              {plain.map((note, index) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  index={index}
                  count={plain.length}
                  expanded={expanded.has(note.id)}
                  editing={editing?.id === note.id ? editing.part : null}
                  onEdit={(part) => setEditing({ id: note.id, part })}
                  onSaveLine={(text, keyboard) => {
                    setEditing(null)
                    onChange(note.id, { text })
                    if (keyboard) focus.request(note.id, "line")
                  }}
                  onSaveBody={(body, keyboard) => {
                    setEditing(null)
                    onChange(note.id, { body })
                    if (keyboard) focus.request(note.id, "details")
                  }}
                  onCancel={() => {
                    focus.request(note.id, editing?.part === "body" ? "details" : "line")
                    setEditing(null)
                  }}
                  onToggle={() => toggle(note)}
                  onKind={() => {
                    // It leaves for the Todo board: the keyboard goes to the row beside it.
                    focus.beside(note.id, "line", addField)
                    onChange(note.id, { todo: true })
                  }}
                  onDelete={() => {
                    focus.beside(note.id, "line", addField)
                    onRemove([note.id])
                  }}
                  onStep={(by, part) => {
                    const spot = stepSpot(ids, note.id, by)
                    if (spot) move(note, spot, part)
                  }}
                />
              ))}
            </DragDropProvider>
          </div>
          {plain.length === 0 && (
            <p className="notes-empty" role="status">
              Notes you write here stay with this project.
            </p>
          )}
        </div>
        <span className="sr-only" aria-live="polite">
          {moved}
        </span>
      </div>
    </SidebarPanel>
  )
}
