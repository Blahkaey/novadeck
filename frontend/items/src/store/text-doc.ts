import type { ItemContent, PlanUnwritableReason } from "@novadeck/core/items"

// A text the person edits where it's read and the store saves back to its file, as it
// stands against that file: a plan (kinds/plan/plan-doc.ts), or a file the person opened in
// the project window (kinds/file/file-doc.ts), each with what its kind adds.
export type TextDoc = {
  readonly writable: boolean
  readonly truncated: boolean
  // The file as both sides last agreed on it, at `revision`, the backend's stamp: another
  // writer's changes and the person's edits merge against it.
  readonly base: string
  readonly revision: string
  // The file's line break, put back when saving. The editor and the merge work in LF.
  readonly eol: "\n" | "\r\n"
  // The file as the person sees it: `base` with their edits since.
  readonly text: string
  // The last save didn't reach the file; it's tried again.
  readonly unsaved: boolean
  // The backend said saving won't work until the item, its file or its folder changes, and
  // why: saves stop until the person asks for another try.
  readonly blocked: PlanUnwritableReason | null
  // Saves failed too many times in a row: they stop until the person retries.
  readonly stalled: boolean
}

// The person's text as the file would hold it, with the file's line breaks: what Copy my
// edits copies.
export const fileText = ({ text, eol }: Pick<TextDoc, "text" | "eol">): string =>
  eol === "\n" ? text : text.replaceAll("\n", eol)

// Whether the content says the file can't be read for now, which saves can't get past
// either, though trying again may help.
export const unreadableNow = (content: ItemContent | undefined): boolean =>
  content?.state === "unavailable" && content.reason === "unreadable"
