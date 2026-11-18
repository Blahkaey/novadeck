import { RangeSet, RangeValue, StateEffect, StateField, type EditorState } from "@codemirror/state"
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view"

// Lines another writer changed, as an agent's changes merged into the person's edits: each
// carries a class its app styles, and moves along with the person's edits.

/** Lines by number, from 1, both ends included. */
export type Lines = { readonly from: number; readonly to: number }

/** The class on each marked line. */
export const markedClass = "cm-editor-marked"

// Replaces the marked lines, as the app's latest content has them.
export const setMarks = StateEffect.define<readonly Lines[]>()

// A marked line, held as a range over the line and its break. Text inserted at either end
// stays outside it, so Enter at the start of a marked line leaves the mark on that line, and
// the range goes once all of it is deleted, rather than passing to the line after.
class Mark extends RangeValue {
  override startSide = 1
  override endSide = -1
}
const mark = new Mark()

// Each line once, however many of the marks hold it. A line past the end marks nothing, nor
// does an empty last line, which has no break to hold.
const rangesOf = (state: EditorState, marks: readonly Lines[]): RangeSet<Mark> => {
  const { doc } = state
  const numbers = new Set<number>()
  for (const { from, to } of marks)
    for (let number = Math.max(from, 1); number <= Math.min(to, doc.lines); number++)
      numbers.add(number)
  const ranges = [...numbers].flatMap((number) => {
    const line = doc.line(number)
    const end = Math.min(line.to + 1, doc.length)
    return end > line.from ? [mark.range(line.from, end)] : []
  })
  return RangeSet.of(ranges, true)
}

const marked = Decoration.line({ class: markedClass })

// Where a mark's own text starts: its first character that isn't space. Enter at the start
// of an indented marked line, or after its indentation, breaks the line inside the range,
// before its text, writing the indentation again after the break: the line the range starts
// in is left empty, or with only that indentation. A mark of only spaces starts where it does.
const textStart = (state: EditorState, from: number, to: number): number => {
  let at = from
  for (const text = state.doc.iterRange(from, to); !text.next().done; at += text.value.length) {
    const found = text.value.search(/\S/)
    if (found >= 0) return at + found
  }
  return from
}

// The line each mark's text is in, once, however the person's edits have joined them.
const draw = (state: EditorState, marks: RangeSet<Mark>): DecorationSet => {
  const starts = new Set<number>()
  for (const iterator = marks.iter(); iterator.value; iterator.next())
    starts.add(state.doc.lineAt(textStart(state, iterator.from, iterator.to)).from)
  return Decoration.set(
    [...starts].map((from) => marked.range(from)),
    true,
  )
}

export const markedLines = StateField.define<RangeSet<Mark>>({
  create: () => RangeSet.empty,
  update: (marks, transaction) => {
    for (const effect of transaction.effects)
      if (effect.is(setMarks)) return rangesOf(transaction.state, effect.value)
    return marks.map(transaction.changes)
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state) => draw(state, state.field(field))),
})

// The marked lines as they stand, moved along with the edits made since they were set.
export const currentMarks = (state: EditorState): Lines[] => {
  const marks: Lines[] = []
  for (const iterator = state.field(markedLines).iter(); iterator.value; iterator.next()) {
    const { number } = state.doc.lineAt(textStart(state, iterator.from, iterator.to))
    marks.push({ from: number, to: number })
  }
  return marks
}

// The same lines, given in the same order.
export const sameMarks = (one: readonly Lines[] = [], other: readonly Lines[] = []): boolean =>
  one.length === other.length &&
  one.every((lines, at) => lines.from === other[at]!.from && lines.to === other[at]!.to)
