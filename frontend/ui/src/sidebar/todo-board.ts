import { boardColumns, type BoardColumn } from "@novadeck/core/notes"

import { closedShort } from "./history-rows"
import { spotIn, type Spot } from "./note-order"

// What the Todo board decides apart from its markup: how it lays its columns out, where a card
// dropped or moved goes, and what it says of that.

// Each column's name, as its heading and its tab say it.
export const columnLabels: Readonly<Record<BoardColumn, string>> = {
  todo: "To do",
  doing: "In progress",
  done: "Done",
}

// How wide the board must be to show its three columns side by side, in CSS pixels; under it,
// as in the sidebar, it shows one at a time with a switch between them.
export const wideBoard = 520

export type BoardLayout = "narrow" | "wide"

// The layout for a board `width` pixels wide.
export const boardLayout = (width: number): BoardLayout => (width >= wideBoard ? "wide" : "narrow")

// The column beside `column` on that side, left (-1) or right (1); undefined past either end.
export const columnBeside = (column: BoardColumn, by: -1 | 1): BoardColumn | undefined =>
  boardColumns[boardColumns.indexOf(column) + by]

// A value for each column, made by `of`.
export const byColumn = <T>(of: (column: BoardColumn) => T): Readonly<Record<BoardColumn, T>> => ({
  todo: of("todo"),
  doing: of("doing"),
  done: of("done"),
})

// Each column's cards by id, in their order.
export type BoardIds = Readonly<Record<BoardColumn, readonly string[]>>

// Where a dragged card is over: another card, or a column as a whole, at its end (the empty
// room under its cards) or its start (its tab, where the board shows one column at a time).
export type DropTarget =
  | { readonly kind: "card"; readonly column: BoardColumn; readonly id: string }
  | { readonly kind: "end" | "start"; readonly column: BoardColumn }

// A card's place on the board: its column, and the card it stands before (null for last).
export type CardSpot = { readonly column: BoardColumn } & Spot

// Where the card `id` from `from` goes, dropped on `target`: before the card it is over, or
// after it where both are in one column and it came from above, as a list being sorted makes
// room; last at a column's end; first at its start. Undefined where it would stay where it is.
export const dropSpot = (
  ids: BoardIds,
  id: string,
  from: BoardColumn,
  target: DropTarget,
): CardSpot | undefined => {
  const { column } = target
  const cards = ids[column]
  const rest = cards.filter((each) => each !== id)
  const at = (before: string | null): CardSpot | undefined => {
    const { index } = spotIn(rest, before)
    return column === from && cards.indexOf(id) === index ? undefined : { column, before, index }
  }
  if (target.kind !== "card") return at(target.kind === "end" ? null : (rest[0] ?? null))
  if (target.id === id) return undefined
  const below = column === from && cards.indexOf(id) < cards.indexOf(target.id)
  return at(below ? (cards[cards.indexOf(target.id) + 1] ?? null) : target.id)
}

// Where the card `id` goes moved to `column` from a menu or a key: first in it.
export const firstIn = (ids: BoardIds, id: string, column: BoardColumn): CardSpot | undefined => {
  if (ids[column][0] === id) return undefined
  return { column, before: ids[column].find((each) => each !== id) ?? null, index: 0 }
}

// What assistive technology hears once a card has moved: its words, then where it went, by its
// column and its place in it.
export const movedCardWords = (
  text: string,
  column: BoardColumn,
  index: number,
  count: number,
): string => `${text}: ${columnLabels[column]}, ${index + 1} of ${count}`

// When a done card was checked off, as it says under its line: the time for today, the date
// before.
export const doneWords = (doneAt: number, now: number): string => `Done ${closedShort(doneAt, now)}`

// What a column says where it has no cards.
export const emptyColumnWords: Readonly<Record<BoardColumn, string>> = {
  todo: "Nothing to do.",
  doing: "Nothing in progress.",
  done: "Nothing done yet.",
}

// What the board says while the project has no todos.
export const emptyBoardWords = "Todos you add here stay with this project."

// What the board says where the backend can't place its cards, as a runner from before the
// board: checking off and opening again still move them.
export const unplacedWords = "Moving cards needs the runner updated to this version of Novadeck."
