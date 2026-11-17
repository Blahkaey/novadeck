// How texts differ and merge: how far apart two versions are, line by line, and the merge
// of two sets of changes. Built on CodeMirror's state, so an app loads it where it loads an
// editor, not beside what it shows eagerly (see ./text.ts).

export { distance, merge } from "./sync/lines.js"
export type { Range } from "./sync/lines.js"
