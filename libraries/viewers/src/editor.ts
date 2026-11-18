import {
  defaultKeymap,
  history,
  historyField,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands"
import {
  bracketMatching,
  indentService,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language"
import {
  Annotation,
  Compartment,
  EditorState,
  Prec,
  StateEffect,
  Transaction,
  type Extension,
} from "@codemirror/state"
import {
  EditorView,
  drawSelection,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view"
import { classHighlighter } from "@lezer/highlight"

import { indentUnitOf } from "./editor/indentation.js"
import { loadSupport, loadedSupport } from "./editor/language.js"
import { currentMarks, markedLines, sameMarks, setMarks, type Lines } from "./editor/marks.js"
import { theme } from "./editor/theme.js"
import { languageOf, type Language } from "./highlight/languages.js"
import type { Mount, Viewer, ViewerState } from "./index.js"
import { lineChanges } from "./sync/lines.js"

export { markedClass, type Lines } from "./editor/marks.js"

// A file's text, edited in place: numbered lines, undo, indentation in the file's own unit
// and the line's kept on Enter, brackets matched, and highlighting once its language's parser
// has loaded, in the code viewer's `tok-*` classes (see ./code.css). Outside changes apply as
// a minimal line diff, outside the person's undo history, with the cursor kept; the person's
// edits alone reach `onEdit`. It fills its element and scrolls itself.

export type EditorContent = {
  /**
   * The text, its lines broken with `\n` alone: an app whose file uses `\r\n` converts on the
   * way, and a lone `\r` stays as it is, shown as a mark.
   */
  readonly text: string
  /**
   * The file's path, which tells its language and, for a Makefile, its indentation. Another
   * path is another file: the editor starts it afresh, with no undo history, at its top.
   */
  readonly path: string
  /** Whether the person can't edit it, which a file can turn after it opens. */
  readonly readOnly?: boolean
  /**
   * Lines another writer changed, as an agent's changes merged into the person's edits, each
   * drawn with `markedClass`. A change of text replaces them, and so do other marks; the
   * person's edits move them, and the same marks given again with the text the editor has,
   * as the app passing back the person's own edit, leave them where the edits moved them.
   */
  readonly marks?: readonly Lines[]
}

export type EditorOptions = {
  /** The person's edits, never `update()`'s: the whole text. */
  readonly onEdit: (text: string) => void
  /** Ctrl/⌘+S in the editor, read-only too, which the browser's own save never sees. */
  readonly onSave: () => void
}

export type EditorViewer = Viewer<EditorContent>

// Marks changes that came in through `update()`, which are not the person's edits.
const fromUpdate = Annotation.define<boolean>()

// What the content sets on a live editor: its language, once the parser has loaded, and
// whether the person can edit.
const grammar = new Compartment()
const writable = new Compartment()

// Enter keeps the line's indentation, in every language, as CodeMirror does for plain text:
// the parsers bring no rules of their own, and CodeMirror's guess from brackets alone puts an
// indented line of Python or YAML back at its start. The whole line's, so Enter at its start
// moves the line down as it was.
const keepIndentation = indentService.of((context, pos) => {
  const { text } = context.state.doc.lineAt(pos)
  return context.countColumn(text, text.search(/\S|$/))
})

const base: Extension = [
  // A lone `\r` is text, as the file has it, and an edit writes it back as it was.
  EditorState.lineSeparator.of("\n"),
  // Text pasted from a system that breaks lines with `\r\n` breaks them as the editor does,
  // so a `\r` of its line breaks never stays as text.
  EditorView.clipboardInputFilter.of((text) => text.replaceAll("\r\n", "\n")),
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  bracketMatching(),
  syntaxHighlighting(classHighlighter),
  keepIndentation,
  // Tab indents. Escape, then Tab, leaves the editor: CodeMirror's own way out.
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
  markedLines,
  theme,
]

// What the viewer holds of where it was, in which file: its text, selection and undo history
// as plain data, so a saved state keeps none of a viewer's callbacks; where it was scrolled;
// and its marks as they stood, with those the app had given.
type EditorSaved = {
  readonly editor: {
    readonly path: string
    readonly json: unknown
    readonly scroll: StateEffect<unknown>
    readonly marks: readonly Lines[]
    readonly given: readonly Lines[] | undefined
  }
}

// Another kind of viewer's state may come under the same id, as the code viewer's for a file
// shown before it could be edited.
const isEditorSaved = (state: unknown): state is EditorSaved & ViewerState =>
  (state as Partial<EditorSaved> | null)?.editor?.scroll instanceof StateEffect

const clamp = (value: number, least: number, most: number): number =>
  Math.min(Math.max(value, least), most)

export const mountEditor: Mount<EditorContent, EditorOptions, EditorViewer> = (
  element,
  { content, label, saved, onEdit, onSave },
) => {
  let shown = content
  // The marks the app last gave, as drawn.
  let given: readonly Lines[] | undefined
  // The language the editor has: none until its parser has loaded.
  let speaking: Language | undefined
  // A restored place CodeMirror hasn't put back yet, as for an editor out of sight, moved
  // along with the text: what the editor's state holds meanwhile.
  let pending: StateEffect<unknown> | undefined

  const own: Extension = [
    EditorView.contentAttributes.of({ "aria-label": label }),
    Prec.highest(
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            onSave()
            return true
          },
        },
      ]),
    ),
    EditorView.updateListener.of((update) => {
      if (pending && update.docChanged) pending = pending.map(update.changes)
      // CodeMirror puts a place back as it measures an editor with a size, and only tells of
      // it after: so an update of its own, rather than one of a change, with a size.
      if (pending && update.transactions.length === 0 && view.scrollDOM.clientHeight > 0)
        pending = undefined
      if (
        update.transactions.some(
          (transaction) => transaction.docChanged && !transaction.annotation(fromUpdate),
        )
      )
        onEdit(update.state.doc.toString())
    }),
  ]

  // A new state's: the indentation is the file's as it opens, read again only for another.
  const extensionsFor = (next: EditorContent): Extension => [
    base,
    own,
    indentUnit.of(indentUnitOf(next.text, next.path)),
    grammar.of([]),
    writable.of(EditorState.readOnly.of(next.readOnly === true)),
  ]

  const view = new EditorView({
    parent: element,
    state: EditorState.create({ doc: content.text, extensions: extensionsFor(content) }),
  })

  // A whole new state, plain and unmarked until the content says otherwise.
  const replace = (state: EditorState): void => {
    view.setState(state)
    speaking = undefined
    given = undefined
    pending = undefined
  }

  // The language the content is in: at once if its parser has loaded, or plain until it has.
  const speak = (next: EditorContent): void => {
    const language = languageOf(next.path)
    if (language === speaking) return
    speaking = language
    const known = language && loadedSupport(language)
    view.dispatch({ effects: grammar.reconfigure(known ?? []) })
    if (!language || known) return
    loadSupport(language).then(
      (support) => {
        // Unless it turned to another language meanwhile.
        if (speaking === language) view.dispatch({ effects: grammar.reconfigure(support) })
      },
      // A parser that can't load leaves the text plain.
      () => {},
    )
  }

  // The content as the app has it now. A text that differs applies as an outside change: a
  // minimal line diff, so the cursor and selection map through it and the place stays, kept
  // out of the person's history, since undoing it would only write the old text back.
  const sync = (next: EditorContent): void => {
    const doc = view.state.doc.toString()
    const changes = doc === next.text ? undefined : lineChanges(doc, next.text)
    const readOnly = next.readOnly === true
    const effects: StateEffect<unknown>[] = []
    if (changes || !sameMarks(given, next.marks)) effects.push(setMarks.of(next.marks ?? []))
    if (readOnly !== view.state.readOnly)
      effects.push(writable.reconfigure(EditorState.readOnly.of(readOnly)))
    shown = next
    given = next.marks
    if (effects.length > 0)
      view.dispatch({
        ...(changes === undefined ? {} : { changes }),
        effects,
        annotations: [fromUpdate.of(true), Transaction.addToHistory.of(false)],
      })
    speak(next)
  }

  // A state of the file it shows: one file's never opens in another.
  const isOwn = (state: ViewerState | undefined): state is EditorSaved & ViewerState =>
    isEditorSaved(state) && state.editor.path === shown.path

  // Takes the saved text, selection, history, place and marks; the content it has now applies
  // over them as `update()`'s does, so the app hears nothing and nothing it changed is lost.
  const restore = (state: ViewerState): void => {
    if (!isOwn(state)) return
    const { json, scroll, marks } = state.editor
    replace(
      EditorState.fromJSON(json, { extensions: extensionsFor(shown) }, { history: historyField }),
    )
    // CodeMirror holds a place until the editor has a size, as one opened out of sight, moving
    // it along with the text meanwhile; until it has put it back, the state keeps it too.
    view.dispatch({ effects: [scroll, setMarks.of(marks)] })
    pending = scroll
    given = state.editor.given
    sync(shown)
  }

  if (isOwn(saved)) restore(saved)
  else sync(content)

  return {
    update: (next) => {
      // Another file opens at its top: a new state leaves the scroller where it was.
      if (next.path !== shown.path) {
        replace(EditorState.create({ doc: next.text, extensions: extensionsFor(next) }))
        view.scrollDOM.scrollTo({ top: 0, left: 0 })
      }
      sync(next)
    },
    state: () =>
      ({
        editor: {
          path: shown.path,
          json: view.state.toJSON({ history: historyField }),
          scroll: pending ?? view.scrollSnapshot(),
          marks: currentMarks(view.state),
          given,
        },
      }) satisfies EditorSaved as unknown as ViewerState,
    restore,
    // The cursor goes there, a quarter of the way down, so what comes before it shows too. A
    // line or offset past the end goes to the end, and one that is no number nowhere.
    jumpTo: (target) => {
      if (Number.isNaN("offset" in target ? target.offset : target.line)) return
      const { doc } = view.state
      const at =
        "offset" in target
          ? clamp(target.offset, 0, doc.length)
          : doc.line(clamp(target.line, 1, doc.lines)).from
      view.dispatch({
        selection: { anchor: at },
        effects: EditorView.scrollIntoView(at, {
          y: "start",
          yMargin: view.scrollDOM.clientHeight / 4,
        }),
      })
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  }
}
