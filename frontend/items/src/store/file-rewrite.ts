import type { PlanVersion } from "@novadeck/core/items"
import type { Lines } from "@novadeck/viewers/editor"

import { editedText, type FileDoc } from "../kinds/file/file-doc"
import { fileText } from "./text-doc"

// What a file the person edits becomes when it changed under them. Pure: the merge code is
// given, as the store loads it only when a document changes.

type Sync = typeof import("@novadeck/viewers/sync")

// The lines of `text` the stretches (offsets) cover, each from the line it starts on to the
// line its last character is on.
export const linesOf = (
  text: string,
  stretches: readonly { readonly from: number; readonly to: number }[],
): Lines[] => {
  const starts = [0]
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) starts.push(at + 1)
  // The line `offset` is on: the last whose start is at or before it.
  const lineAt = (offset: number): number => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (starts[middle]! <= offset) low = middle
      else high = middle - 1
    }
    return low + 1
  }
  return stretches.map(({ from, to }) => ({
    from: lineAt(from),
    to: lineAt(Math.max(from, to - 1)),
  }))
}

// The file with another writer's version taken in. With nothing unsaved it is the new text;
// with edits unsaved or on their way, its changes merge into them line by line, its lines
// marked. `echo` says the version is the person's own save reported back; `unconfirmed` are
// the texts sent in saves whose answer never came.
//
// The version may break its lines otherwise than the document did, as a writer that
// normalises them does: the document's texts are taken into the version's form first, as the
// file held them, so no line is told apart by its break alone. A version that breaks every
// line with CRLF is edited in LF, as the document then is; any other keeps its breaks as
// they are.
export const fileRewritten = (
  doc: FileDoc,
  { stamp, plan: incoming }: PlanVersion,
  echo: boolean,
  unconfirmed: readonly string[],
  { distance, merge }: Sync,
): FileDoc => {
  const { text: theirs, eol } = editedText(incoming.text)
  // One of the document's texts as the version's form has it.
  const inForm = (text: string): string => {
    const held = fileText({ text, eol: doc.eol })
    return eol === "\r\n" ? held.replaceAll("\r\n", "\n") : held
  }
  const base = inForm(doc.base)
  const { writable } = incoming
  if (stamp === doc.revision && theirs === base && eol === doc.eol && writable === doc.writable)
    return doc
  const facts = { writable, base: theirs, revision: stamp, eol }
  const ours = inForm(doc.text)
  if (echo || theirs === ours) return { ...doc, ...facts, text: ours }
  if (ours === base) return { ...doc, ...facts, text: theirs, marks: [] }
  // A save whose answer never came may have been written: the version merges over whichever
  // the file now stands closest to, as a plan's rewrite does.
  const over = [base, ...unconfirmed.map(inForm)].reduce((closest, candidate) =>
    distance(candidate, theirs) < distance(closest, theirs) ? candidate : closest,
  )
  const written = merge(over, ours, theirs)
  return { ...doc, ...facts, text: written.text, marks: linesOf(written.text, written.changed) }
}
