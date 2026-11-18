import type { ItemId } from "@novadeck/core/items"

// What the person asked for that leaves the file the project window shows, with edits to it
// that can't be saved: the window showing another file, closing (or going with its session or
// project), or the file, or a folder holding it, renamed, moved or deleted.
export type LeaveAction = "switch" | "close" | "rename" | "move" | "delete"

// The question the person answers before going on: the window's file, by its item and the
// path the edits were made on, which what they asked for leaves with edits to it not saved yet.
export type LeaveAsk = {
  readonly itemId: ItemId
  readonly path: string
  // The file's name, as the question says it.
  readonly name: string
  readonly action: LeaveAction
  // Whether the edits are still being saved, which takes a while: what they asked for goes on
  // by itself once they're in the file, and the person may only stay meanwhile. Otherwise they
  // can't be saved.
  readonly waiting: boolean
}

// What going on does, as the question says it, and the verb its answers use.
const words: Record<
  LeaveAction,
  { readonly title: (name: string) => string; readonly doing: string; readonly verb: string }
> = {
  switch: { title: () => "Open another file?", doing: "opening another file", verb: "switch" },
  close: { title: (name) => `Close ${name}?`, doing: "closing it", verb: "close" },
  rename: { title: () => "Rename anyway?", doing: "renaming", verb: "rename" },
  move: { title: () => "Move anyway?", doing: "moving", verb: "move" },
  delete: { title: () => "Delete anyway?", doing: "deleting", verb: "delete" },
}

export const leaveTitle = ({ name, action, waiting }: LeaveAsk): string =>
  waiting ? `Saving your edits to ${name}…` : words[action].title(name)

export const leaveDescription = ({ name, action, waiting }: LeaveAsk): string => {
  const { doing } = words[action]
  return waiting
    ? `${doing[0]!.toUpperCase()}${doing.slice(1)} goes on once they're saved.`
    : `Your edits to ${name} couldn't be saved, and ${doing} loses them. Copy them first to keep them.`
}

export const leaveConfirm = (action: LeaveAction): string =>
  `Copy my edits and ${words[action].verb}`

// Going on without the edits, offered once they couldn't be copied: plainly a discard.
export const leaveDiscard = (action: LeaveAction): string => {
  const { verb } = words[action]
  return `${verb[0]!.toUpperCase()}${verb.slice(1)} without my edits`
}

// What the question says once the edits couldn't be copied: nothing was done, and the ways on.
export const leaveUncopied = ({ action }: LeaveAsk): string =>
  `Your edits couldn't be copied, so nothing was done. Try again, copy them from the editor yourself, or ${words[action].verb} without them.`
