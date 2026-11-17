import { noteLimits, type NoteAuthor } from "@novadeck/core/notes"

import { agentName } from "./history-rows"

// What the Notes panel says, apart from its markup.

// What the add field makes: a todo, which has a checkbox, or a plain note.
export type NoteKind = "todo" | "note"

// The add field's placeholder and name.
export const addWords = (kind: NoteKind): string =>
  kind === "todo" ? "Add a todo…" : "Add a note…"

// What the button before the add field says: what the field adds, and what a press changes.
export const kindWords = (kind: NoteKind): string =>
  kind === "todo" ? "Adding todos · switch to plain notes" : "Adding plain notes · switch to todos"

export const doneCount = (count: number): string =>
  `${count} done ${count === 1 ? "todo" : "todos"}`

// What Clear done's question says before it is answered: how many go, and that they don't
// come back.
export const clearDoneWords = (count: number): string =>
  `${doneCount(count)} ${count === 1 ? "is" : "are"} deleted for good. You can’t bring ${count === 1 ? "it" : "them"} back.`

// What the mark on a note an agent added says: the agent, and its terminal's handle when it
// did.
export const addedByWords = ({ agent, handle }: NoteAuthor): string =>
  `Added by ${agentName(agent)} · @${handle}`

// Where a note went among the open ones, for assistive technology.
export const movedWords = (text: string, index: number, count: number): string =>
  `${text}, ${index + 1} of ${count}`

// Whether a project holds as many notes as it keeps, so the add field takes no more.
export const notesFull = (count: number): boolean => count >= noteLimits.perProject

export const fullWords = `This project has ${noteLimits.perProject} notes, the most it keeps. Delete some to add more.`

// What the panel says above the list once a change didn't take.
export const unsavedWords = "Your last change wasn’t saved. The notes are as they were."
