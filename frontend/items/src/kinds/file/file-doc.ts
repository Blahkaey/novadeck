import type { ItemContent, ItemId, PlanUnwritableReason, PlanVersion } from "@novadeck/core/items"
import type { Lines } from "@novadeck/viewers/editor"

import type { TextDoc } from "../../store/text-doc"

// A file the person opened in the project window, as they edit it: by its item and the path
// it was read at, so the window pointed at another file holds another document, and one
// file's text never lands in another.
export type FileDoc = TextDoc & {
  readonly item: ItemId
  readonly path: string
  // Lines another writer changed, merged into the person's edits: the editor moves them along
  // with the edits that follow.
  readonly marks: readonly Lines[]
}

// Where the store keeps a file's document: its item and path.
export const fileKey = (item: ItemId, path: string): string => JSON.stringify([item, path])

// A file's text as the editor holds it, with the line break saving puts back: a file that
// breaks every line with CRLF is edited in LF; any other keeps its text as it is, a lone CR
// and the CR of a mix of breaks staying text the editor shows, so a save writes back every
// break the person didn't touch as it was.
export const editedText = (raw: string): { readonly text: string; readonly eol: "\n" | "\r\n" } => {
  const breaks = raw.split("\n").length - 1
  return breaks > 0 && raw.split("\r\n").length - 1 === breaks
    ? { text: raw.replaceAll("\r\n", "\n"), eol: "\r\n" }
    : { text: raw, eol: "\n" }
}

// A file the item reports whole, to edit, as a version of it the store saves against: its path
// and its text, as a plan's that is never cut short and has no skill, as a save's answer
// carries a file's.
export const fileVersionOf = (
  content: ItemContent,
): { readonly path: string; readonly version: PlanVersion } | undefined => {
  if (content.state !== "ready" || content.content.kind !== "text") return undefined
  const { path, text, writable } = content.content
  return {
    path,
    version: {
      stamp: content.stamp,
      plan: { kind: "plan", text, truncated: false, writable, skill: false },
    },
  }
}

export const fileDocOf = (item: ItemId, path: string, { stamp, plan }: PlanVersion): FileDoc => {
  const { text, eol } = editedText(plan.text)
  return {
    item,
    path,
    writable: plan.writable,
    truncated: false,
    base: text,
    revision: stamp,
    eol,
    text,
    marks: [],
    unsaved: false,
    blocked: null,
    stalled: false,
  }
}

// Whether what the item holds says the file is no longer there, which saves wait out.
export const fileGone = (content: ItemContent | undefined): boolean =>
  content?.state === "unavailable" && (content.reason === "missing" || content.reason === "gone")

// Why what the item holds says the person's edits can't reach the file: it was deleted, isn't
// text any more, or is no longer one the window has whole to edit.
const heldBlockOf = (content: ItemContent | undefined): PlanUnwritableReason | null => {
  if (fileGone(content)) return "gone"
  if (content?.state === "unavailable") return content.reason === "binary" ? "not-text" : null
  return content?.content.kind === "file" ? (content.content.uneditable ?? null) : null
}

// Why the person's edits can't reach the file, if they can't: what the item holds says so, or
// a save said why.
export const fileBlockOf = (
  doc: FileDoc,
  content: ItemContent | undefined,
): PlanUnwritableReason | null => heldBlockOf(content) ?? doc.blocked
