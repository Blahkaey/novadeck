import { EditorView } from "@codemirror/view"

import { markedClass } from "./marks.js"

// What the editor changes of CodeMirror's own look. It reads the code viewer's tokens
// (`--code-*`, see ../code.css), so a file looks the same shown and edited, and its own
// `--editor-*` ones. CodeMirror mounts its styles outside every cascade layer, where no layered
// stylesheet can override them, so these go in as an editor theme, as the markdown viewer's do
// (../markdown/theme.ts). It fills its element and scrolls itself.
export const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--code-font-size, inherit)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--code-font, monospace)",
    lineHeight: "var(--code-line-height, 1.75)",
  },
  ".cm-content": { padding: "10px 0", caretColor: "currentColor" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "currentColor" },
  ".cm-selectionBackground": {
    background: "var(--editor-selection-bg, color-mix(in srgb, currentColor 18%, transparent))",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    background: "var(--editor-selection-bg, color-mix(in srgb, currentColor 18%, transparent))",
  },
  // The base theme's gutter is grey on light grey, in colours of its own. Here it sits flat
  // on the page, its numbers faded but the cursor's line's.
  ".cm-gutters": { border: "0", background: "transparent", color: "inherit" },
  ".cm-gutterElement": {
    color: "var(--code-number-fg, color-mix(in srgb, currentColor 55%, transparent))",
  },
  ".cm-gutterElement.cm-activeLineGutter": { background: "transparent", color: "inherit" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 14px 0 8px" },
  [`.${markedClass}`]: {
    background: "var(--editor-marked-bg, color-mix(in srgb, currentColor 8%, transparent))",
  },
})
