import {
  Accessibility,
  Cursor,
  Feedback,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { DragDropProvider, useDroppable, type DragEndEvent } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import {
  boardCards,
  boardColumns,
  noteLimits,
  type BoardColumn,
  type Note,
  type NoteChange,
} from "@novadeck/core/notes"
import { Checkbox } from "@novadeck/toolkit/Checkbox"
import { ConfirmDialog } from "@novadeck/toolkit/ConfirmDialog"
import { ContextMenu, type ContextMenuAction } from "@novadeck/toolkit/ContextMenu"
import { sidebarRowClasses } from "@novadeck/toolkit/SidebarItem"
import { SubjectBar, SubjectDetail, SubjectName, SubjectSide } from "@novadeck/toolkit/SubjectBar"
import { Tab, TabList, TabPanel, Tabs } from "@novadeck/toolkit/Tabs"
import { Tooltip } from "@novadeck/toolkit/Tooltip"
import { ArrowRightLeft, ListTodo, ListX } from "lucide-react"
import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { stepSpot } from "./note-order"
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
import { boardUnsavedWords, clearDoneWords, doneCount, fullWords, notesFull } from "./notes-rows"
import {
  boardLayout,
  byColumn,
  columnBeside,
  columnLabels,
  doneWords,
  dropSpot,
  emptyBoardWords,
  emptyColumnWords,
  firstIn,
  movedCardWords,
  unplacedWords,
  type BoardIds,
  type CardSpot,
  type DropTarget,
} from "./todo-board"

// A card follows the pointer once it has moved a few pixels, so a click still edits it; the
// keyboard moves cards with Alt and the arrows and the Move menu instead, so dnd-kit adds no
// keyboard sensor and none of its screen reader markup. Cards stay where they are while one is
// dragged (no sortable plugins), and a line shows where it would land; the drop puts it there,
// at once, as its drop animation would only show it going back.
const sensors = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === "touch"
        ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
        : [new PointerActivationConstraints.Distance({ value: 6 })],
  }),
]
const transition = { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
const feedback = Feedback.configure({ dropAnimation: null })
const cursor = Cursor.configure({ cursor: "grabbing" })
// Over a card and its column at once, the card is where it lands.
const columnPriority = 1

// What each place a card can be dropped tells the drop: where that is on the board.
type DropData = { readonly drop: DropTarget }
const dropOf = (data: unknown): DropTarget | undefined =>
  (data as Partial<DropData> | undefined)?.drop

type Clearing = { readonly ids: readonly string[] }

const clearBar = ({ ids }: Clearing): React.JSX.Element => (
  <SubjectBar>
    <SubjectSide>
      <ListTodo size={14} strokeWidth={1.5} aria-hidden="true" />
      <SubjectName>{columnLabels.done}</SubjectName>
    </SubjectSide>
    <SubjectDetail end>{doneCount(ids.length)}</SubjectDetail>
  </SubjectBar>
)

// How a card moves where the backend can place it: one place up or down its column, or first
// into another column, each from the control `part`.
type CardMoves = {
  readonly step: (by: -1 | 1, part: Part) => void
  readonly column: (to: BoardColumn, part: Part) => void
}

// The keys that move a card, as its controls name them: Alt with up and down within its
// column, with left and right to the column beside it.
const moveKeys = (column: BoardColumn, index: number, count: number): string | undefined =>
  [
    ...(index > 0 ? ["Alt+ArrowUp"] : []),
    ...(index < count - 1 ? ["Alt+ArrowDown"] : []),
    ...(columnBeside(column, -1) ? ["Alt+ArrowLeft"] : []),
    ...(columnBeside(column, 1) ? ["Alt+ArrowRight"] : []),
  ].join(" ") || undefined

// A card's Move menu: up and down its column, then each column, which takes it first.
const moveItems = (
  move: CardMoves,
  column: BoardColumn,
  index: number,
  count: number,
): readonly ContextMenuAction[] => [
  { value: "up", label: "Move up", disabled: index === 0, onSelect: () => move.step(-1, "move") },
  {
    value: "down",
    label: "Move down",
    disabled: index === count - 1,
    onSelect: () => move.step(1, "move"),
  },
  ...boardColumns.map((to, at) => ({
    value: to,
    label: columnLabels[to],
    disabled: to === column,
    separated: at === 0,
    onSelect: () => move.column(to, "move"),
  })),
]

// One card: its checkbox, its line, which a click edits and a drag moves, the agent's mark
// where an agent added it, its Move menu, and a button that shows what is under it; on a done
// card, when it was checked off. Where it can't be moved (`move` undefined), no drag, menu or
// key moves it.
const Card = ({
  note,
  column,
  index,
  count,
  now,
  expanded,
  editing,
  dropBefore,
  onCheck,
  onEdit,
  onSaveLine,
  onSaveBody,
  onCancel,
  onToggle,
  onKind,
  onDelete,
  move,
}: {
  note: Note
  column: BoardColumn
  index: number
  count: number
  now: number
  expanded: boolean
  editing: Editing["part"] | null
  // A dragged card would land just before this one.
  dropBefore: boolean
  onCheck: (checked: boolean) => void
  onEdit: (part: Editing["part"]) => void
  onSaveLine: (text: string, keyboard: boolean) => void
  onSaveBody: (body: string, keyboard: boolean) => void
  onCancel: () => void
  onToggle: () => void
  onKind: () => void
  onDelete: () => void
  move: CardMoves | undefined
}): React.JSX.Element => {
  const { ref, handleRef, isDragSource } = useSortable({
    id: note.id,
    index,
    group: column,
    data: { drop: { kind: "card", column, id: note.id } } satisfies DropData,
    disabled: editing !== null || !move,
    plugins: [],
    transition,
  })
  const bodyId = useId()
  const keys = move && moveKeys(column, index, count)
  return (
    <div
      ref={ref}
      role="listitem"
      className={`${sidebarRowClasses} notes-row todo-card flex-col${isDragSource ? " dragging" : ""}`}
      data-note={note.id}
      data-column={column}
      data-drop={dropBefore ? "before" : undefined}
      // Alt and the arrows move the card, from any of its controls but a field being typed in.
      onKeyDown={(event) => {
        if (!move || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        const part = (event.target as HTMLElement).dataset.part
        if (part !== "check" && part !== "line" && part !== "details" && part !== "move") return
        const by = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1 } as const
        if (!Object.hasOwn(by, event.key)) return
        event.preventDefault()
        const step = by[event.key as keyof typeof by]
        if (event.key === "ArrowUp" || event.key === "ArrowDown") move.step(step, part)
        else {
          const to = columnBeside(column, step)
          if (to) move.column(to, part)
        }
      }}
    >
      {/* Side by side a column is too narrow to set a card's line beside its buttons: the line
          takes the card's width and the buttons go under it, on the right. */}
      <div className="notes-row-line flex min-w-0 items-start gap-2 py-2 pr-1.5 pl-2.5 group-data-[layout=wide]/board:flex-wrap group-data-[layout=wide]/board:justify-end">
        <Checkbox
          className="mt-px"
          checked={column === "done"}
          onChange={onCheck}
          aria-label={note.text}
          aria-keyshortcuts={keys}
          data-part="check"
        />
        {editing === "line" ? (
          <NoteLineInput text={note.text} onSave={onSaveLine} onCancel={onCancel} />
        ) : (
          <button
            ref={handleRef}
            type="button"
            className="notes-row-text min-w-0 flex-1 text-left text-body leading-[18px] group-data-[layout=wide]/board:basis-[calc(100%-2rem)]"
            data-part="line"
            aria-label={`Edit ${note.text}`}
            aria-keyshortcuts={keys}
            onClick={() => onEdit("line")}
          >
            {note.text}
          </button>
        )}
        {note.by && <AddedBy by={note.by} />}
        {move && (
          <ContextMenu
            label={`Move ${note.text}`}
            opensOn="click"
            placement="bottom-end"
            tooltip="Move to…"
            items={moveItems(move, column, index, count)}
            trigger={
              <button
                type="button"
                className="todo-card-move icon-button small dim quiet"
                data-part="move"
                aria-label={`Move ${note.text}`}
                aria-keyshortcuts={keys}
              >
                <ArrowRightLeft size={14} strokeWidth={1.6} />
              </button>
            }
          />
        )}
        <NoteDetailsButton note={note} expanded={expanded} body={bodyId} onToggle={onToggle} />
      </div>
      {note.doneAt !== null && (
        <p className="todo-card-date m-0 pr-2.5 pb-2 pl-[34px] text-caption">
          {doneWords(note.doneAt, now)}
        </p>
      )}
      {expanded && (
        <NoteDetails
          id={bodyId}
          note={note}
          editing={editing === "body"}
          kind="Make it a note"
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

// A column's cards, which a card dropped on the room under them joins last, and what the
// column says when it has none; Done's has the button that clears it.
const ColumnCards = ({
  column,
  count,
  quiet,
  dropEnd,
  onClear,
  children,
}: {
  column: BoardColumn
  count: number
  // The whole board is empty, and says so once instead of each column.
  quiet: boolean
  // A dragged card would land last here.
  dropEnd: boolean
  onClear: () => void
  children: ReactNode
}): React.JSX.Element => {
  const { ref } = useDroppable({
    id: `end:${column}`,
    data: { drop: { kind: "end", column } } satisfies DropData,
    collisionPriority: columnPriority,
  })
  return (
    <div
      ref={ref}
      className="todo-column-cards flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto pb-3"
      data-drop={dropEnd ? "end" : undefined}
    >
      {column === "done" && count > 0 && (
        <div className="flex shrink-0 justify-end">
          <Tooltip content="Clear done">
            <button
              type="button"
              className="notes-clear icon-button small dim quiet"
              aria-label="Clear done todos"
              onClick={onClear}
            >
              <ListX size={14} strokeWidth={1.6} />
            </button>
          </Tooltip>
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1" role="list" aria-label={columnLabels[column]}>
        {children}
      </div>
      {count === 0 && !quiet && <p className="notes-empty">{emptyColumnWords[column]}</p>}
    </div>
  )
}

// A column's tab, where the board shows one column at a time: a card dropped on it goes first
// in its column.
const ColumnTab = ({
  column,
  count,
  dropOn,
}: {
  column: BoardColumn
  count: number
  // A dragged card would land in this column.
  dropOn: boolean
}): React.JSX.Element => {
  const { ref } = useDroppable({
    id: `start:${column}`,
    data: { drop: { kind: "start", column } } satisfies DropData,
  })
  return (
    <Tab
      ref={ref}
      value={column}
      className="todo-tab flex min-w-0 flex-1 items-center justify-center gap-1.5 text-label font-medium"
      {...(dropOn && { "data-drop": "start" })}
    >
      {columnLabels[column]}
      <span className="sidebar-panel-count">{count}</span>
    </Tab>
  )
}

// The Todo board: a project's todos as cards in three columns, To do, In progress and Done,
// each in the person's order. A field at the top adds a card to To do; each card is checked off
// (to Done) or opened again (to To do), edited, opened for its details, made a plain note,
// deleted, or moved: dragged within its column or to another, or with its Move menu or Alt and
// the arrows, where the backend can place it; else only checking off and opening again move
// it, and a line says why. Done's button clears every done card after asking. Its width picks
// its layout: three columns side by side where there is room for them, else one at a time with
// a switch between them. It takes everything it shows and does as props, so any frame can hold
// it.
export const TodoBoard = ({
  projectId,
  notes,
  failed,
  now,
  onAdd,
  onChange,
  onPlace,
  onRemove,
}: {
  projectId: string
  // The project's notes, plain notes among them, in the person's order.
  notes: readonly Note[]
  // The person's last change didn't take, and the notes are as the backend has them.
  failed: boolean
  // The time done cards say when they were checked off against.
  now: number
  // Adds a todo with these words, first in To do.
  onAdd: (text: string) => void
  onChange: (id: string, change: NoteChange) => void
  // Puts a todo into a column, before a card of it (null: last); undefined where the backend
  // can't, as a runner from before the board.
  onPlace: ((id: string, column: BoardColumn, before: string | null) => void) | undefined
  onRemove: (ids: readonly string[]) => void
}): React.JSX.Element => {
  const cards = useMemo(
    () => byColumn((column) => boardCards(notes, projectId, column)),
    [notes, projectId],
  )
  const ids: BoardIds = useMemo(
    () => byColumn((column) => cards[column].map(({ id }) => id)),
    [cards],
  )
  const empty = boardColumns.every((column) => cards[column].length === 0)
  const full = notesFull(notes.filter((note) => note.projectId === projectId).length)
  const root = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  // Measured only while the board is in a document: parked out of one, as while the phone's
  // drawer is closed, it measures nothing, and keeps the width it had for when it shows again.
  useLayoutEffect(() => {
    const board = root.current
    if (!board) return undefined
    if (board.isConnected) setWidth(board.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => {
      if (entry && board.isConnected) setWidth(entry.contentRect.width)
    })
    observer.observe(board)
    return () => observer.disconnect()
  }, [])
  const layout = boardLayout(width)
  // The column shown where the board shows one at a time.
  const [shown, setShown] = useState<BoardColumn>("todo")
  const [draft, setDraft] = useState("")
  const { editing, setEditing, expanded, toggle } = useNoteEditing()
  const [clearing, setClearing] = useState<Clearing | null>(null)
  // Where a card went, for assistive technology.
  const [moved, setMoved] = useState("")
  // The card being dragged, and where it would land.
  const [dragged, setDragged] = useState<string | null>(null)
  const [over, setOver] = useState<DropTarget | null>(null)
  const focus = useRowFocus(root)
  const addField = (): HTMLElement | null =>
    root.current?.querySelector<HTMLElement>(".notes-add-input") ?? null
  const [frame, setFrame] = useState<HTMLDivElement | null>(null)
  const modifiers = useMemo(() => [RestrictToElement.configure({ element: frame })], [frame])

  // The card `id` and the column it stands in.
  const find = (id: string): { note: Note; column: BoardColumn } | undefined =>
    boardColumns
      .flatMap((column) => cards[column].map((note) => ({ note, column })))
      .find(({ note }) => note.id === id)
  const landing = (() => {
    const from = dragged === null ? undefined : find(dragged)
    return from && over ? dropSpot(ids, from.note.id, from.column, over) : undefined
  })()
  const headings = useId()

  const add = (): void => {
    if (draft.trim() === "" || full) return
    onAdd(draft)
    setDraft("")
  }
  // Puts a card in its spot, says where it went, shows its column, and gives its `part` the
  // focus back where one held it; none where the backend can't place a card.
  const place =
    onPlace &&
    ((note: Note, spot: CardSpot, part: Part | null): void => {
      onPlace(note.id, spot.column, spot.before)
      const count = ids[spot.column].filter((id) => id !== note.id).length + 1
      setMoved(movedCardWords(note.text, spot.column, spot.index, count))
      setShown(spot.column)
      if (part) focus.request(note.id, part)
    })
  const card = (note: Note, column: BoardColumn, index: number): React.JSX.Element => (
    <Card
      key={note.id}
      note={note}
      column={column}
      index={index}
      count={cards[column].length}
      now={now}
      expanded={expanded.has(note.id)}
      editing={editing?.id === note.id ? editing.part : null}
      dropBefore={landing?.column === column && landing.before === note.id}
      onCheck={(checked) => {
        focus.beside(note.id, "check", addField)
        onChange(note.id, { done: checked })
        const to = checked ? "done" : "todo"
        setMoved(movedCardWords(note.text, to, 0, cards[to].length + 1))
      }}
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
        // It leaves for the Notes panel: the keyboard goes to the card beside it.
        focus.beside(note.id, "line", addField)
        onChange(note.id, { todo: false })
      }}
      onDelete={() => {
        focus.beside(note.id, "line", addField)
        onRemove([note.id])
      }}
      move={
        place && {
          step: (by, part) => {
            const spot = stepSpot(ids[column], note.id, by)
            if (spot) place(note, { column, ...spot }, part)
          },
          column: (to, part) => {
            const spot = firstIn(ids, note.id, to)
            if (spot) place(note, spot, part)
          },
        }
      }
    />
  )
  const column = (each: BoardColumn): React.JSX.Element => (
    <ColumnCards
      column={each}
      count={cards[each].length}
      quiet={empty}
      dropEnd={landing?.column === each && landing.before === null}
      onClear={() => setClearing({ ids: ids.done })}
    >
      {cards[each].map((note, index) => card(note, each, index))}
    </ColumnCards>
  )
  return (
    <div
      ref={root}
      className="todo-board group/board flex min-h-0 min-w-0 flex-1 flex-col"
      data-layout={layout}
    >
      <form
        className="field quiet notes-add flex h-9 shrink-0 items-center gap-1.5 pr-2 pl-2.5"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <input
          className="field-input notes-add-input min-w-0 flex-1 text-control"
          aria-label="Add a todo…"
          placeholder="Add a todo…"
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
          {boardUnsavedWords}
        </p>
      )}
      {empty && (
        <p className="notes-empty" role="status">
          {emptyBoardWords}
        </p>
      )}
      {!place && <p className="notes-empty">{unplacedWords}</p>}
      <div ref={setFrame} className="todo-frame mt-2.5 flex min-h-0 min-w-0 flex-1 flex-col">
        <DragDropProvider
          sensors={sensors}
          modifiers={modifiers}
          plugins={(defaults) => [
            ...defaults.filter((plugin) => plugin !== Accessibility),
            feedback,
            cursor,
          ]}
          onDragStart={(event) => {
            const { source } = event.operation
            setDragged(source ? String(source.id) : null)
          }}
          onDragOver={(event) => setOver(dropOf(event.operation.target?.data) ?? null)}
          // Cards are dragged only where the backend places them.
          {...(place && {
            onDragEnd: (event: DragEndEvent) => {
              setDragged(null)
              setOver(null)
              const { source, target } = event.operation
              if (!isSortable(source)) return
              const from = find(String(source.id))
              if (!from) return
              const held = source.element?.contains(document.activeElement) ?? false
              const to = event.canceled ? undefined : dropOf(target?.data)
              const spot = to && dropSpot(ids, from.note.id, from.column, to)
              if (spot) place(from.note, spot, held ? "line" : null)
              else if (held) focus.request(from.note.id, "line")
            },
          })}
        >
          {layout === "wide" ? (
            <div className="todo-columns grid min-h-0 flex-1 grid-cols-3 gap-3">
              {boardColumns.map((each) => (
                <section
                  key={each}
                  className="todo-column flex min-h-0 min-w-0 flex-col gap-1.5"
                  aria-labelledby={`${headings}-${each}`}
                >
                  <h3
                    id={`${headings}-${each}`}
                    className="section-label m-0 flex h-7 shrink-0 items-center gap-1.5 px-0.5 text-label font-medium"
                  >
                    {columnLabels[each]}
                    <span className="sidebar-panel-count">{cards[each].length}</span>
                  </h3>
                  {column(each)}
                </section>
              ))}
            </div>
          ) : (
            <Tabs
              value={shown}
              onValueChange={(value) => {
                const next = boardColumns.find((each) => each === value)
                if (next) setShown(next)
              }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <TabList
                label="Columns"
                className="todo-tabs flex shrink-0"
                indicatorClassName="bottom-0 h-0.5"
              >
                {boardColumns.map((each) => (
                  <ColumnTab
                    key={each}
                    column={each}
                    count={cards[each].length}
                    dropOn={over?.kind === "start" && over.column === each && landing !== undefined}
                  />
                ))}
              </TabList>
              {boardColumns.map((each) => (
                <TabPanel key={each} value={each} className="mt-2 flex min-h-0 flex-1 flex-col">
                  {each === shown && column(each)}
                </TabPanel>
              ))}
            </Tabs>
          )}
        </DragDropProvider>
      </div>
      <span className="sr-only" role="status" aria-label="Board moves">
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
        returnFocus={() => root.current?.querySelector<HTMLElement>(".notes-clear") ?? addField()}
        widthClassName="w-[min(360px,calc(100vw-32px))]"
      />
    </div>
  )
}
